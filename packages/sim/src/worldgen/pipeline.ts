/**
 * Worldgen pipeline (Engine §6): pure `seed + params → WorldDef`, stages
 * independently seeded by stable fork keys, progress streamed for the loading
 * UI. Runs once at campaign start; output hydrates the ECS (M11+), then the
 * generator is released.
 */
import { Rng } from '@crowns/core';
import { stageBiomes, stageClimate, stageHeightmap, stageRivers } from './stages.js';
import {
  BIOME_COUNT,
  DEFAULT_PARAMS,
  MAP_TILES,
  RiverMark,
  type ProgressFn,
  type WorldDef,
  type WorldGenParams,
  type WorldLayers,
} from './types.js';

export function generateWorld(
  seed: number,
  paramsIn?: Partial<WorldGenParams>,
  onProgress?: ProgressFn,
): WorldDef {
  const size = paramsIn?.size ?? 'medium';
  const params: WorldGenParams = { ...DEFAULT_PARAMS[size], ...paramsIn, size };
  const width = MAP_TILES[params.size];
  const height = width;
  const n = width * height;

  const layers: WorldLayers = {
    elevation: new Float32Array(n),
    temperature: new Float32Array(n),
    moisture: new Float32Array(n),
    biome: new Uint8Array(n),
    river: new Uint8Array(n),
  };

  const root = Rng.fromSeed(seed).fork('worldgen');
  onProgress?.('heightmap', 0);
  stageHeightmap(layers, width, height, root.fork('heightmap'), params);
  onProgress?.('climate', 0.25);
  stageClimate(layers, width, height, root.fork('climate'), params);
  onProgress?.('biomes', 0.5);
  stageBiomes(layers, width, height, params);
  onProgress?.('rivers', 0.65);
  const rivers = stageRivers(layers, width, height, root.fork('rivers'), params);
  stageBiomes(layers, width, height, params); // refresh: carving + riverside humidity
  onProgress?.('finalize', 0.9);

  const biomeCounts = new Array<number>(BIOME_COUNT).fill(0);
  let land = 0;
  let riverTiles = 0;
  for (let i = 0; i < n; i++) {
    biomeCounts[layers.biome[i] as number] = (biomeCounts[layers.biome[i] as number] as number) + 1;
    if ((layers.elevation[i] as number) >= params.seaLevel) land++;
    if ((layers.river[i] as number) !== RiverMark.None) riverTiles++;
  }
  onProgress?.('finalize', 1);
  return {
    seed,
    params,
    width,
    height,
    layers,
    rivers,
    stats: { landFraction: land / n, biomeCounts, riverTiles },
  };
}

/** Fold every layer into a single u32 — worldgen's determinism fingerprint. */
export function worldHash(world: WorldDef): number {
  let h = 0x811c9dc5;
  const fold = (v: number): void => {
    h ^= v & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= (v >>> 8) & 0xff;
    h = Math.imul(h, 0x01000193);
  };
  const el = world.layers.elevation;
  for (let i = 0; i < el.length; i++) {
    fold(Math.round((el[i] as number) * 1e6));
    fold(Math.round((world.layers.moisture[i] as number) * 1e6));
    fold(Math.round((world.layers.temperature[i] as number) * 1e6));
    fold(world.layers.biome[i] as number);
    fold(world.layers.river[i] as number);
  }
  return h >>> 0;
}
