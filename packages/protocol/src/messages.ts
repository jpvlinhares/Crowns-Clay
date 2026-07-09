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
  /** Owning village entity id (M18 — the player inspector's join key). */
  readonly village: number;
}

// ---- player-facing content catalog (M18): defs the UI may offer ----
// The ui package speaks protocol ONLY (TDD §3), so the sim worker projects
// the DefinitionDatabase into this display-ready shape once per session.
export interface CatalogBuilding {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly w: number;
  readonly h: number;
  readonly tier: number; // required village tier (1 = always)
  readonly cost: readonly [string, number][]; // display name → amount
}
export interface CatalogEdict {
  readonly id: string;
  readonly name: string;
  readonly upkeep: number;
}
export interface UICatalog {
  readonly buildings: readonly CatalogBuilding[];
  readonly edicts: readonly CatalogEdict[];
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
  // ---- save/load (M17; TDD §8) ----
  | { kind: 'save'; slot: string }
  | { kind: 'load'; slot: string }
  | { kind: 'exportSave' }
  | { kind: 'importSave'; payload: string }
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
  | {
      kind: 'snapshotFull';
      tick: number;
      world: WorldMeta;
      terrain?: TerrainSnapshot;
      entities: EntityRec[];
      buildings?: BuildingRec[];
      /** flat [x, y, level] triples (M14 roads) */
      roads?: number[];
      /** player-facing content catalog (M18) */
      catalog?: UICatalog;
      /** kingdom snapshot for panel bootstrapping (M18) */
      kingdom?: { activeEdicts: string[] };
      /** flat [x, y, kingdomIndex] triples, all currently-owned tiles (M22) */
      territory?: number[];
      /** flat [x, y] pairs, every tile ever revealed to the player's kingdom (M22) */
      fogRevealed?: number[];
    }
  | {
      kind: 'snapshotDelta';
      tick: number;
      spawned: EntityRec[];
      /** flat triples: [id, x, y, id, x, y, ...] */
      moved: number[];
      despawned: number[];
      /** daily village vitals for the HUD and village panel (sent when changed) */
      villageStats?: {
        id: number;
        name: string;
        population: number;
        food: number;
        happiness: number;
        /** other stocked goods (M13 chains): display name → floored amount */
        goods?: Record<string, number>;
        tier: number;
        taxRate: number;
        cx: number;
        cy: number;
      }[];
      buildingsAdded?: BuildingRec[];
      /** flat pairs: [id, progress, ...] for buildings under construction */
      buildingProgress?: number[];
      buildingsRemoved?: number[];
      /** flat [x, y, level] triples for road tiles added since last delta (M14) */
      roadsAdded?: number[];
      /** flat [x, y, kingdomIndex] triples, newly-owned tiles since last delta (M22) */
      territoryAdded?: number[];
      /** flat [x, y] pairs, newly-revealed tiles since last delta (M22) */
      fogRevealedAdded?: number[];
    }
  | { kind: 'hash'; tick: number; hash: number }
  // ---- save/load results (M17) ----
  | { kind: 'saveResult'; slot: string; ok: boolean; bytes: number; error?: string }
  | { kind: 'loadResult'; ok: boolean; tick: number; migrations?: string[]; error?: string }
  | { kind: 'exportResult'; payload: string }
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
