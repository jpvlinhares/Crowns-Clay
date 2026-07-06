import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Rng, gridIndex } from '@crowns/core';
import { generateWorld, worldHash } from './pipeline.js';
import { classifyTile, fillDepressions, stageHeightmap } from './stages.js';
import { hash01, fbm, valueNoise } from './noise.js';
import { Biome, DEFAULT_PARAMS, MAP_TILES, RiverMark, type WorldLayers } from './types.js';

/**
 * PINNED GOLDEN HASH — seed 42, medium, default params.
 * Changing ANY worldgen stage changes this value; that is the point. If the
 * change is intentional, update the literal AND call it out in the PR
 * (repo conventions; same rules as fixtures/golden — doc 12).
 */
const GOLDEN_SEED_42_MEDIUM = 0x77c44dce;

function emptyLayers(n: number): WorldLayers {
  return {
    elevation: new Float32Array(n),
    temperature: new Float32Array(n),
    moisture: new Float32Array(n),
    biome: new Uint8Array(n),
    river: new Uint8Array(n),
  };
}

// ---------------- noise ----------------

test('noise: pure functions of (seed, x, y) — order-free, bounded, seed-sensitive', () => {
  assert.equal(hash01(7, 100, 200), hash01(7, 100, 200));
  assert.notEqual(hash01(7, 100, 200), hash01(8, 100, 200));
  for (let i = 0; i < 2000; i++) {
    const v = fbm(99, i * 0.37, i * 0.61, 5);
    assert.ok(v >= 0 && v < 1, `fbm out of range: ${v}`);
  }
  // value noise interpolates: at lattice points it equals the lattice hash
  assert.equal(valueNoise(5, 10, 20), hash01(5, 10, 20));
});

// ---------------- stage isolation ----------------

test('heightmap stage: fills only elevation, in range, edges oceanic (continent)', () => {
  const size = MAP_TILES.small;
  const layers = emptyLayers(size * size);
  stageHeightmap(layers, size, size, Rng.fromSeed(1).fork('t'), DEFAULT_PARAMS.small);
  let borderWater = 0;
  let borderTotal = 0;
  for (let i = 0; i < size * size; i++) {
    const e = layers.elevation[i] as number;
    assert.ok(e >= 0 && e <= 1);
    const x = i % size;
    const y = (i / size) | 0;
    if (x < 2 || y < 2 || x >= size - 2 || y >= size - 2) {
      borderTotal++;
      if (e < DEFAULT_PARAMS.small.seaLevel) borderWater++;
    }
  }
  assert.ok(borderWater / borderTotal > 0.9, `continent rim not oceanic: ${borderWater}/${borderTotal}`);
  assert.equal(layers.temperature[1000], 0, 'heightmap must not touch other layers');
});

test('depression filling: afterwards every land tile has a strictly lower neighbor or is at sea', () => {
  const size = 96;
  const layers = emptyLayers(size * size);
  stageHeightmap(layers, size, size, Rng.fromSeed(3).fork('t'), { ...DEFAULT_PARAMS.small });
  const sea = DEFAULT_PARAMS.small.seaLevel;
  fillDepressions(layers.elevation, size, size, sea);
  let violations = 0;
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      const i = gridIndex(x, y, size);
      const e = layers.elevation[i] as number;
      if (e < sea) continue; // ocean drains by definition
      const lower =
        (layers.elevation[i - size] as number) < e ||
        (layers.elevation[i + size] as number) < e ||
        (layers.elevation[i - 1] as number) < e ||
        (layers.elevation[i + 1] as number) < e;
      if (!lower) violations++;
    }
  }
  assert.equal(violations, 0, `${violations} landlocked tiles remain after priority-flood`);
});

// ---------------- classification ----------------

test('biome classification: covers the (elev, temp, moist) space consistently', () => {
  const sea = 0.34;
  assert.equal(classifyTile(0.1, 0.5, 0.5, sea), Biome.Ocean);
  assert.equal(classifyTile(sea - 0.01, 0.5, 0.5, sea), Biome.Coast);
  assert.equal(classifyTile(0.85, 0.5, 0.5, sea), Biome.Mountains);
  assert.equal(classifyTile(0.85, 0.05, 0.5, sea), Biome.Snow);
  assert.equal(classifyTile(0.5, 0.05, 0.5, sea), Biome.Snow);
  assert.equal(classifyTile(0.5, 0.2, 0.5, sea), Biome.Tundra);
  assert.equal(classifyTile(0.38, 0.6, 0.8, sea), Biome.Marsh);
  assert.equal(classifyTile(0.55, 0.6, 0.6, sea), Biome.Forest);
  assert.equal(classifyTile(0.55, 0.6, 0.4, sea), Biome.Grassland);
  assert.equal(classifyTile(0.55, 0.6, 0.1, sea), Biome.Plains);
});

// ---------------- full pipeline properties ----------------

test('worldgen: seed-reproducible (identical hashes), seed-sensitive', () => {
  const a = worldHash(generateWorld(123, { size: 'small' }));
  const b = worldHash(generateWorld(123, { size: 'small' }));
  const c = worldHash(generateWorld(124, { size: 'small' }));
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test('worldgen: PINNED golden hash for seed 42 medium', () => {
  assert.equal(
    worldHash(generateWorld(42, { size: 'medium' })),
    GOLDEN_SEED_42_MEDIUM,
    'worldgen output changed — if intentional, re-pin and explain in the PR',
  );
});

test('worldgen: land fraction and biome variety within design bands (5 seeds)', () => {
  for (let seed = 1; seed <= 5; seed++) {
    const w = generateWorld(seed, { size: 'small' });
    assert.ok(
      w.stats.landFraction > 0.25 && w.stats.landFraction < 0.65,
      `seed ${seed}: land ${w.stats.landFraction} outside [0.25, 0.65]`,
    );
    const present = w.stats.biomeCounts.filter((c) => c > 0).length;
    assert.ok(present >= 5, `seed ${seed}: only ${present} biomes present`);
    // every tile classified consistently with the water partition
    for (let i = 0; i < w.width * w.height; i++) {
      const biome = w.layers.biome[i] as number;
      const isWaterBiome = biome === Biome.Ocean || biome === Biome.Coast;
      const isBelowSea = (w.layers.elevation[i] as number) < w.params.seaLevel;
      assert.equal(isWaterBiome, isBelowSea, `tile ${i}: water partition mismatch`);
    }
  }
});

test('worldgen: rivers flow monotonically downhill and reach the sea or a network', () => {
  for (const seed of [1, 5, 9]) {
    const w = generateWorld(seed, { size: 'small' });
    assert.ok(w.rivers.length >= 3, `seed ${seed}: too few rivers (${w.rivers.length})`);
    let reached = 0;
    for (const river of w.rivers) {
      if (river.endsIn !== 'lake') reached++;
      // monotone non-increasing elevation along the final carved terrain
      let prev = Infinity;
      for (let p = 0; p < river.points.length; p += 2) {
        const i = gridIndex(river.points[p] as number, river.points[p + 1] as number, w.width);
        const e = w.layers.elevation[i] as number;
        assert.ok(e <= prev + 1e-6, `seed ${seed}: river flows uphill at point ${p / 2}`);
        prev = e;
        assert.notEqual(w.layers.river[i], RiverMark.None, 'path tile must be marked');
      }
    }
    assert.ok(reached / w.rivers.length >= 0.8, `seed ${seed}: only ${reached}/${w.rivers.length} rivers drain`);
  }
});

test('worldgen: climate has a latitude gradient and an elevation lapse', () => {
  const w = generateWorld(7, { size: 'small' });
  const rowMean = (y: number): number => {
    let sum = 0;
    for (let x = 0; x < w.width; x++) sum += w.layers.temperature[gridIndex(x, y, w.width)] as number;
    return sum / w.width;
  };
  // north edge colder than the warm belt (55% south)
  assert.ok(rowMean(4) < rowMean(Math.floor(w.height * 0.55)) - 0.15, 'no latitude gradient');
  // elevation lapse: within the SAME latitude band (so latitude can't confound),
  // high ground must average colder than lowland
  const y0 = Math.floor(w.height * 0.4);
  const y1 = Math.floor(w.height * 0.7);
  let highSum = 0, highN = 0, lowSum = 0, lowN = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < w.width; x++) {
      const i = gridIndex(x, y, w.width);
      const e = w.layers.elevation[i] as number;
      if (e > 0.7) { highSum += w.layers.temperature[i] as number; highN++; }
      else if (e > w.params.seaLevel && e < 0.45) { lowSum += w.layers.temperature[i] as number; lowN++; }
    }
  }
  assert.ok(highN > 20 && lowN > 20, `not enough samples in band (high ${highN}, low ${lowN})`);
  assert.ok(highSum / highN < lowSum / lowN - 0.05, 'no elevation lapse within latitude band');
});
