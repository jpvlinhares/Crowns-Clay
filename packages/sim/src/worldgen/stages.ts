/**
 * Worldgen stages (GDD §13; Engine §6). Each stage is a pure function over the
 * layer arrays, independently seeded by a stable fork key — so stages are
 * unit-testable in isolation and mod-replaceable later (doc 09 §8).
 *
 * Pipeline order: heightmap → climate → biomes → rivers → biome refresh.
 * The refresh re-runs classification after rivers carve elevation and raise
 * riverside moisture, so shores turn marshy/green — the "rivers make valleys
 * fertile" loop closes inside worldgen itself.
 */
import { Rng, clamp, gridIndex } from '@crowns/core';
import { fbm, hash01 } from './noise.js';
import {
  Biome,
  RiverMark,
  type BiomeId,
  type RiverPath,
  type WorldGenParams,
  type WorldLayers,
} from './types.js';

const NOISE_SCALE = 1 / 48; // lattice cells ≈ 48 tiles → continents, not static

// ---------------------------------------------------------------- heightmap

/** Layered fBm + landmass shaping. Elevation ∈ [0,1]; map edges trend to ocean. */
export function stageHeightmap(
  layers: WorldLayers,
  width: number,
  height: number,
  rng: Rng,
  params: WorldGenParams,
): void {
  const seed = rng.nextUint32() | 0;
  const cx = width / 2;
  const cy = height / 2;
  const maxR = Math.sqrt(cx * cx + cy * cy);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let e = fbm(seed, x * NOISE_SCALE, y * NOISE_SCALE, 5);
      // ridged detail for mountain texture
      const ridge = 1 - Math.abs(2 * fbm(seed ^ 0x5f37, x * NOISE_SCALE * 2, y * NOISE_SCALE * 2, 4) - 1);
      e = e * 0.75 + ridge * 0.25;

      const dx = (x - cx) / maxR;
      const dy = (y - cy) / maxR;
      const r = Math.sqrt(dx * dx + dy * dy); // 0 center → ~1 corner
      switch (params.landmass) {
        case 'continent':
          e -= Math.pow(r, 1.9) * 0.72; // single mass, oceanic rim
          break;
        case 'archipelago':
          e -= 0.22; // global lowering → islands where peaks survive
          e -= Math.pow(r, 3) * 0.3;
          break;
        case 'highlands':
          e = e * 0.7 + 0.3; // raised interior, little ocean
          e -= Math.pow(r, 2.5) * 0.35;
          break;
      }
      layers.elevation[gridIndex(x, y, width)] = clamp(e, 0, 1);
    }
  }
}

// ---------------------------------------------------------------- climate

/**
 * Temperature: latitude band (warm belt just south of center) − elevation lapse
 * − harshness shift + noise. Moisture: fBm + proximity-to-water bonus (BFS from
 * all water tiles, deterministic row-major seeding).
 */
export function stageClimate(
  layers: WorldLayers,
  width: number,
  height: number,
  rng: Rng,
  params: WorldGenParams,
): void {
  const tSeed = rng.nextUint32() | 0;
  const mSeed = rng.nextUint32() | 0;
  const sea = params.seaLevel;

  for (let y = 0; y < height; y++) {
    const latitude = y / height;
    const band = 1 - Math.abs(latitude - 0.55) * 1.7; // warm belt at 55% south
    for (let x = 0; x < width; x++) {
      const i = gridIndex(x, y, width);
      const elev = layers.elevation[i] as number;
      const lapse = Math.max(0, elev - sea) * 0.55;
      const jitter = (fbm(tSeed, x * NOISE_SCALE * 1.5, y * NOISE_SCALE * 1.5, 3) - 0.5) * 0.2;
      layers.temperature[i] = clamp(band - lapse - params.climateHarshness * 0.18 + jitter, 0, 1);
      layers.moisture[i] = clamp(fbm(mSeed, x * NOISE_SCALE * 1.3, y * NOISE_SCALE * 1.3, 4), 0, 1);
    }
  }

  // coastal humidity: multi-source BFS from water, bonus fades over 10 tiles
  const RANGE = 10;
  const dist = new Int16Array(width * height).fill(-1);
  let queue: number[] = [];
  for (let i = 0; i < width * height; i++) {
    if ((layers.elevation[i] as number) < sea) {
      dist[i] = 0;
      queue.push(i);
    }
  }
  for (let d = 1; d <= RANGE && queue.length > 0; d++) {
    const next: number[] = [];
    for (const i of queue) {
      const x = i % width;
      const y = (i / width) | 0;
      const neighbors = [
        y > 0 ? i - width : -1,
        x < width - 1 ? i + 1 : -1,
        y < height - 1 ? i + width : -1,
        x > 0 ? i - 1 : -1,
      ];
      for (const n of neighbors) {
        if (n >= 0 && dist[n] === -1) {
          dist[n] = d;
          next.push(n);
          const bonus = 0.18 * (1 - d / RANGE);
          layers.moisture[n] = clamp((layers.moisture[n] as number) + bonus, 0, 1);
        }
      }
    }
    queue = next;
  }
}

// ---------------------------------------------------------------- biomes

export function classifyTile(
  elevation: number,
  temperature: number,
  moisture: number,
  seaLevel: number,
): BiomeId {
  if (elevation < seaLevel - 0.03) return Biome.Ocean;
  if (elevation < seaLevel) return Biome.Coast;
  if (elevation >= 0.78) return temperature < 0.1 ? Biome.Snow : Biome.Mountains;
  if (temperature < 0.13) return Biome.Snow;
  if (elevation >= 0.64) return Biome.Hills;
  if (temperature < 0.26) return Biome.Tundra;
  if (moisture > 0.7 && elevation < seaLevel + 0.09) return Biome.Marsh;
  if (moisture > 0.55) return Biome.Forest;
  if (moisture > 0.36) return Biome.Grassland;
  return Biome.Plains;
}

export function stageBiomes(layers: WorldLayers, width: number, height: number, params: WorldGenParams): void {
  const n = width * height;
  for (let i = 0; i < n; i++) {
    layers.biome[i] = classifyTile(
      layers.elevation[i] as number,
      layers.temperature[i] as number,
      layers.moisture[i] as number,
      params.seaLevel,
    );
  }
}


// ------------------------------------------------------- depression filling

/**
 * Priority-flood depression filling (Barnes et al. 2014): raise every inland
 * bowl to its spill level (+ε), so steepest descent from ANY land tile reaches
 * the ocean. This is what makes rivers actually arrive at the sea instead of
 * drowning in noise bowls. Deterministic: min-heap keyed (elevation, index).
 * Distinct lakes return as a deliberate worldgen feature later (neutral
 * features stage, GDD §13) rather than as drainage accidents.
 */
export function fillDepressions(
  elevation: Float32Array,
  width: number,
  height: number,
  seaLevel: number,
): void {
  const n = width * height;
  const EPS = 1e-5;
  const processed = new Uint8Array(n);

  // binary min-heap over (elev, index), index breaks ties
  const heapE = new Float64Array(n + 1);
  const heapI = new Int32Array(n + 1);
  let heapSize = 0;
  const less = (a: number, b: number): boolean =>
    (heapE[a] as number) < (heapE[b] as number) ||
    ((heapE[a] as number) === (heapE[b] as number) && (heapI[a] as number) < (heapI[b] as number));
  const swap = (a: number, b: number): void => {
    const te = heapE[a] as number; heapE[a] = heapE[b] as number; heapE[b] = te;
    const ti = heapI[a] as number; heapI[a] = heapI[b] as number; heapI[b] = ti;
  };
  const push = (e: number, i: number): void => {
    heapSize++;
    heapE[heapSize] = e;
    heapI[heapSize] = i;
    for (let c = heapSize; c > 1 && less(c, c >> 1); c >>= 1) swap(c, c >> 1);
  };
  const pop = (): number => {
    const top = heapI[1] as number;
    heapE[1] = heapE[heapSize] as number;
    heapI[1] = heapI[heapSize] as number;
    heapSize--;
    let c = 1;
    for (;;) {
      let m = c;
      const l = c * 2;
      const r = l + 1;
      if (l <= heapSize && less(l, m)) m = l;
      if (r <= heapSize && less(r, m)) m = r;
      if (m === c) break;
      swap(c, m);
      c = m;
    }
    return top;
  };

  // seeds: every ocean tile and every border tile (both drain "off the world")
  for (let i = 0; i < n; i++) {
    const x = i % width;
    const y = (i / width) | 0;
    const isBorder = x === 0 || y === 0 || x === width - 1 || y === height - 1;
    if (isBorder || (elevation[i] as number) < seaLevel) {
      processed[i] = 1;
      push(elevation[i] as number, i);
    }
  }

  while (heapSize > 0) {
    const i = pop();
    const spill = elevation[i] as number;
    const x = i % width;
    const y = (i / width) | 0;
    const neighbors = [
      y > 0 ? i - width : -1,
      x < width - 1 ? i + 1 : -1,
      y < height - 1 ? i + width : -1,
      x > 0 ? i - 1 : -1,
    ];
    for (const ni of neighbors) {
      if (ni < 0 || processed[ni] === 1) continue;
      processed[ni] = 1;
      if ((elevation[ni] as number) <= spill) elevation[ni] = spill + EPS; // raise bowl floor
      push(elevation[ni] as number, ni);
    }
  }
}

// ---------------------------------------------------------------- rivers

const DIRS: readonly (readonly [number, number])[] = [
  [0, -1], [1, 0], [0, 1], [-1, 0], // N E S W — fixed order (determinism)
];

/**
 * Springs on high ground flow strictly downhill (carving guarantees monotonic
 * non-increasing elevation along the path); a walk ends in the ocean, by
 * merging into an earlier river, or by pooling into a lake when boxed in.
 * Riverside tiles gain moisture; the caller re-runs biome classification.
 */
export function stageRivers(
  layers: WorldLayers,
  width: number,
  height: number,
  rng: Rng,
  params: WorldGenParams,
): RiverPath[] {
  const sea = params.seaLevel;
  const idx = (x: number, y: number): number => gridIndex(x, y, width);

  fillDepressions(layers.elevation, width, height, sea); // guaranteed drainage

  // spring candidates: land tiles in the high band, deterministic scan order
  const candidates: number[] = [];
  for (let y = 2; y < height - 2; y++) {
    for (let x = 2; x < width - 2; x++) {
      const e = layers.elevation[idx(x, y)] as number;
      if (e >= 0.6 && e <= 0.95) candidates.push(idx(x, y));
    }
  }

  const springs: number[] = [];
  const MIN_SPACING = 14;
  let guard = 0;
  while (springs.length < params.riverCount && candidates.length > 0 && guard++ < params.riverCount * 40) {
    const pick = candidates[rng.int(0, candidates.length - 1)] as number;
    const px = pick % width;
    const py = (pick / width) | 0;
    const tooClose = springs.some((s) => {
      const sx = s % width;
      const sy = (s / width) | 0;
      return Math.max(Math.abs(sx - px), Math.abs(sy - py)) < MIN_SPACING;
    });
    if (!tooClose) springs.push(pick);
  }

  const rivers: RiverPath[] = [];
  const maxSteps = width * 4;
  for (const spring of springs) {
    let x = spring % width;
    let y = (spring / width) | 0;
    const points: number[] = [];
    const visited = new Set<number>();
    let endsIn: RiverPath['endsIn'] = 'lake';

    for (let step = 0; step < maxSteps; step++) {
      const i = idx(x, y);
      if ((layers.elevation[i] as number) < sea) {
        endsIn = 'ocean';
        break;
      }
      if ((layers.river[i] as number) === RiverMark.River && !visited.has(i)) {
        endsIn = 'merge'; // joined an earlier river's network
        break;
      }
      visited.add(i);
      points.push(x, y);
      layers.river[i] = RiverMark.River;

      // steepest-descent neighbor not yet visited by this river
      let bestI = -1;
      let bestE = Infinity;
      let bestX = 0;
      let bestY = 0;
      for (const [dx, dy] of DIRS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const ni = idx(nx, ny);
        if (visited.has(ni)) continue;
        const ne = layers.elevation[ni] as number;
        if (ne < bestE) {
          bestE = ne;
          bestI = ni;
          bestX = nx;
          bestY = ny;
        }
      }
      const here = layers.elevation[i] as number;
      if (bestI === -1 || bestE > here + 0.045) {
        layers.river[i] = RiverMark.Lake; // a genuine wall: pool into a lake
        endsIn = 'lake';
        break;
      }
      // carve THROUGH shallow bowls: downstream is always strictly lower, so a
      // walk can never oscillate and every path is monotonically descending
      if (bestE >= here) layers.elevation[bestI] = here - 0.0015;
      x = bestX;
      y = bestY;
    }
    if (points.length >= 6) rivers.push({ points, endsIn }); // drop 1–2 tile stubs
  }

  // riverside humidity (Chebyshev radius 2) — biome refresh happens in pipeline
  for (const river of rivers) {
    for (let p = 0; p < river.points.length; p += 2) {
      const rx = river.points[p] as number;
      const ry = river.points[p + 1] as number;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = rx + dx;
          const ny = ry + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const ni = idx(nx, ny);
          const falloff = 0.16 * (1 - Math.max(Math.abs(dx), Math.abs(dy)) / 3);
          layers.moisture[ni] = clamp((layers.moisture[ni] as number) + falloff, 0, 1);
        }
      }
    }
  }
  return rivers;
}

/** Tiny deterministic per-tile variation source for renderers (M8). */
export function tileVariant(seed: number, x: number, y: number, variants: number): number {
  return Math.floor(hash01(seed, x, y) * variants);
}
