/**
 * Worldgen output types — the M7 slice of doc 06 §9 `WorldDef`. Resource nodes,
 * start sites, and neutral features join at their roadmap milestones; the shape
 * here is forward-compatible (they are additive fields).
 */

export const MAP_TILES = { small: 256, medium: 384, large: 512 } as const;
export type MapSize = keyof typeof MAP_TILES;

export type LandmassStyle = 'continent' | 'archipelago' | 'highlands';

export interface WorldGenParams {
  readonly size: MapSize;
  readonly landmass: LandmassStyle;
  /** Elevation below this is water. */
  readonly seaLevel: number;
  /** Springs attempted; actual rivers may merge or be fewer. */
  readonly riverCount: number;
  /** 0..1 — shifts temperature bands colder and harshens winters (doc 08 §3). */
  readonly climateHarshness: number;
}

export const DEFAULT_PARAMS: { [S in MapSize]: WorldGenParams } = {
  small: { size: 'small', landmass: 'continent', seaLevel: 0.34, riverCount: 6, climateHarshness: 0.5 },
  medium: { size: 'medium', landmass: 'continent', seaLevel: 0.34, riverCount: 10, climateHarshness: 0.5 },
  large: { size: 'large', landmass: 'continent', seaLevel: 0.34, riverCount: 16, climateHarshness: 0.5 },
};

/** Biome codes (u8). M8 binds these to data-driven TerrainDefs (doc 06 §9). */
export const Biome = {
  Ocean: 0,
  Coast: 1, // shallows / shoreline water
  Plains: 2,
  Grassland: 3,
  Forest: 4,
  Hills: 5,
  Mountains: 6,
  Tundra: 7,
  Snow: 8,
  Marsh: 9,
} as const;
export type BiomeId = (typeof Biome)[keyof typeof Biome];
export const BIOME_COUNT = 10;
export const BIOME_NAMES = [
  'ocean', 'coast', 'plains', 'grassland', 'forest',
  'hills', 'mountains', 'tundra', 'snow', 'marsh',
] as const;

/** River layer codes (u8). */
export const RiverMark = { None: 0, River: 1, Lake: 2 } as const;

export interface WorldLayers {
  readonly elevation: Float32Array; // [0,1]
  readonly temperature: Float32Array; // [0,1]
  readonly moisture: Float32Array; // [0,1]
  readonly biome: Uint8Array; // BiomeId
  readonly river: Uint8Array; // RiverMark
}

export interface RiverPath {
  /** Flat [x0,y0, x1,y1, ...] in flow order, spring → terminus. */
  readonly points: number[];
  readonly endsIn: 'ocean' | 'lake' | 'merge';
}

export interface WorldDef {
  readonly seed: number;
  readonly params: WorldGenParams;
  readonly width: number;
  readonly height: number;
  readonly layers: WorldLayers;
  readonly rivers: RiverPath[];
  readonly stats: {
    readonly landFraction: number;
    readonly biomeCounts: number[]; // indexed by BiomeId
    readonly riverTiles: number;
  };
}

export type WorldGenStage = 'heightmap' | 'climate' | 'biomes' | 'rivers' | 'finalize';
export type ProgressFn = (stage: WorldGenStage, fraction: number) => void;
