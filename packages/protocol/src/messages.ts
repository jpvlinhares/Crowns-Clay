/**
 * Main-thread ⇄ sim-worker message envelope (TDD §1/§4). Transport-agnostic:
 * carried over postMessage in the browser, or any TransportPort in tests/tools.
 */
import type { Command, CommandDraft } from './commands.js';
import type { GameEvent } from './events.js';

export interface TransportPort {
  postMessage(message: unknown): void;
  onMessage(handler: (message: unknown) => void): void;
}

/** One renderable entity in the snapshot stream (grows with real content). */
export interface EntityRec {
  readonly id: number;
  readonly kind: number;
  readonly x: number; // tile-space, fractional allowed
  readonly y: number;
}

export interface WorldMeta {
  readonly widthTiles: number;
  readonly heightTiles: number;
}

/** A placed building for the render layer (static; progress streams in deltas). */
export interface BuildingRec {
  readonly id: number;
  readonly name: string;
  readonly category: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly progress: number; // 0..1
}

/** Render-ready terrain: worldgen layers + palette resolved from TerrainDefs. */
export interface TerrainSnapshot {
  readonly width: number;
  readonly height: number;
  readonly biome: Uint8Array; // biome code per tile
  readonly river: Uint8Array; // 0 none · 1 river · 2 lake
  /** indexed by biome code */
  readonly palette: readonly { readonly base: number; readonly accent: number; readonly name: string }[];
  readonly riverColor: number;
  readonly lakeColor: number;
}

// ---- to sim ----
export type ToSimMessage =
  | { kind: 'init'; seed: number }
  | { kind: 'submit'; drafts: CommandDraft[] }
  | { kind: 'setSpeed'; speed: 0 | 1 | 2 | 4 | 8 }
  | { kind: 'step'; ticks: number } // dev/headless driving
  | { kind: 'pump'; dtMs: number } // real-time driving: main thread forwards frame time
  | { kind: 'requestHash' }
  // ---- debug channel (M9; becomes the sandbox editor transport, GDD §17) ----
  | { kind: 'debug'; op: 'telemetry'; enabled: boolean; everyTicks?: number }
  | { kind: 'debug'; op: 'inspect'; entityId: number }
  | { kind: 'debug'; op: 'commands' };

// ---- from sim ----
export type FromSimMessage =
  | { kind: 'ready'; seed: number }
  | {
      kind: 'ticked';
      fromTick: number;
      toTick: number;
      events: GameEvent[];
      /** Commands executed in this batch (echo for logs/debug UI). */
      executed: Command[];
    }
  | { kind: 'snapshotFull'; tick: number; world: WorldMeta; terrain?: TerrainSnapshot; entities: EntityRec[]; buildings?: BuildingRec[] }
  | {
      kind: 'snapshotDelta';
      tick: number;
      spawned: EntityRec[];
      /** flat triples: [id, x, y, id, x, y, ...] */
      moved: number[];
      despawned: number[];
      /** daily village vitals for the HUD (few villages; sent when changed) */
      villageStats?: { id: number; name: string; population: number; food: number; happiness: number }[];
      buildingsAdded?: BuildingRec[];
      /** flat pairs: [id, progress, ...] for buildings under construction */
      buildingProgress?: number[];
      buildingsRemoved?: number[];
    }
  | { kind: 'hash'; tick: number; hash: number }
  | {
      kind: 'debugTelemetry';
      tick: number;
      tickMsLast: number;
      tickMsAvg: number;
      systems: { name: string; lastMs: number; avgMs: number; calls: number }[];
      entityCount: number;
    }
  | {
      kind: 'debugEntity';
      inspection: {
        id: number;
        index: number;
        alive: boolean;
        components: { name: string; data: Record<string, unknown> }[];
      };
    }
  | { kind: 'debugCommands'; types: string[] }
  | { kind: 'rejected'; draft: CommandDraft; reason: string }
  | { kind: 'fatal'; message: string };
