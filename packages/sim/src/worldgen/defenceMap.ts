/**
 * Defence-layer map generation (roadmap M49; ADR-4 §5/§6; GDD §7 Phase 8 delta).
 *
 * Each kingdom's CAPITAL owns one ~100×100 defence map: keep at centre, the
 * rest terrain the player (or an AI template, M52) fortifies. Terrain variety
 * is LOAD-BEARING (ADR-4 §5): featureless ground makes every castle a
 * symmetric ring, so maps carry water and rock features that leave the four
 * approaches unequally defensible.
 *
 * Determinism contract (the M49 T objective):
 *   - generated ONCE from `defenceMapSeed(worldSeed, kingdomIndex)` via a
 *     dedicated `Rng` stream — never from a tick-coupled stream, so the same
 *     map regenerates byte-identically at load time, on any engine;
 *   - `DEFENCE_MAP_VERSION` stamps every save; a mismatch means this
 *     generator changed since the save was written, and the loader must use
 *     the save's stored tiles instead of regenerating (permanent player
 *     structures depend on tile-exact ground).
 *
 * Integer-only feature carving (no float comparisons order-sensitive ways):
 * water strips (a river crossing one axis) and rock blobs, with a guaranteed
 * OPEN disc around the keep so the centre is always buildable and reachable.
 */
import { Rng, fnv1a32 } from '@crowns/core';

export const DEFENCE_MAP_SIZE = 100;
export const DEFENCE_MAP_VERSION = 1;
/** Radius of guaranteed-open ground around the keep (Chebyshev). */
export const KEEP_CLEARING_RADIUS = 8;

export const DEFENCE_TILE = {
  open: 0, // buildable, passable
  rock: 1, // blocks building and movement — natural wall
  water: 2, // blocks building and movement — natural moat
} as const;
export type DefenceTileCode = (typeof DEFENCE_TILE)[keyof typeof DEFENCE_TILE];

/** Stable per-kingdom map seed — string-hashed so neither operand truncates. */
export function defenceMapSeed(worldSeed: number, kingdomIndex: number): number {
  return fnv1a32(`defence:${worldSeed >>> 0}:${kingdomIndex}`);
}

const CENTRE = Math.floor(DEFENCE_MAP_SIZE / 2);

/** Generate the tile field for one kingdom. Pure of everything but the seed. */
export function generateDefenceMap(seed: number): Uint8Array {
  const rng = Rng.fromSeed(seed);
  const size = DEFENCE_MAP_SIZE;
  const tiles = new Uint8Array(size * size); // all OPEN

  // 0–2 water strips: a "river" crossing the full map along one axis, drifting
  // by ±1 per row/column — each strip makes one whole approach expensive.
  const strips = rng.int(0, 2);
  for (let s = 0; s < strips; s++) {
    const vertical = rng.chance(0.5);
    const width = rng.int(2, 3);
    let at = rng.int(10, size - 10 - width);
    for (let along = 0; along < size; along++) {
      at = Math.max(2, Math.min(size - 2 - width, at + rng.int(-1, 1)));
      for (let w = 0; w < width; w++) {
        const x = vertical ? at + w : along;
        const y = vertical ? along : at + w;
        tiles[y * size + x] = DEFENCE_TILE.water;
      }
    }
  }

  // 2–5 rock blobs: random-walk splats — free anchors for walls.
  const blobs = rng.int(2, 5);
  for (let b = 0; b < blobs; b++) {
    let x = rng.int(5, size - 6);
    let y = rng.int(5, size - 6);
    const steps = rng.int(20, 60);
    for (let i = 0; i < steps; i++) {
      tiles[y * size + x] = DEFENCE_TILE.rock;
      if (rng.chance(0.6)) tiles[y * size + Math.max(0, x - 1)] = DEFENCE_TILE.rock;
      if (rng.chance(0.6)) tiles[Math.max(0, y - 1) * size + x] = DEFENCE_TILE.rock;
      x = Math.max(1, Math.min(size - 2, x + rng.int(-1, 1)));
      y = Math.max(1, Math.min(size - 2, y + rng.int(-1, 1)));
    }
  }

  // the keep's clearing: the centre is always open ground
  for (let dy = -KEEP_CLEARING_RADIUS; dy <= KEEP_CLEARING_RADIUS; dy++) {
    for (let dx = -KEEP_CLEARING_RADIUS; dx <= KEEP_CLEARING_RADIUS; dx++) {
      tiles[(CENTRE + dy) * size + (CENTRE + dx)] = DEFENCE_TILE.open;
    }
  }

  return tiles;
}

/** FNV digest of a tile field — the immutable hash-source contribution. */
export function digestDefenceMap(tiles: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < tiles.length; i++) {
    h ^= tiles[i] as number;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Run-length encode ([code, count, ...]) — defence maps are mostly open ground. */
export function encodeDefenceMap(tiles: Uint8Array): number[] {
  const out: number[] = [];
  let i = 0;
  while (i < tiles.length) {
    const code = tiles[i] as number;
    let run = 1;
    while (i + run < tiles.length && tiles[i + run] === code) run++;
    out.push(code, run);
    i += run;
  }
  return out;
}

export function decodeDefenceMap(data: readonly number[]): Uint8Array {
  const tiles = new Uint8Array(DEFENCE_MAP_SIZE * DEFENCE_MAP_SIZE);
  let at = 0;
  for (let i = 0; i < data.length; i += 2) {
    const code = data[i] as number;
    const run = data[i + 1] as number;
    tiles.fill(code, at, at + run);
    at += run;
  }
  return tiles;
}
