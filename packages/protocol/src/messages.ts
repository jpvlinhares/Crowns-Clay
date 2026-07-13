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
  /** M42 legibility: every modifier this edict applies, for a real tooltip (doc 01 §3 "no hidden modifiers"). */
  readonly modifiers: readonly { readonly target: string; readonly op: 'add' | 'mul'; readonly value: number }[];
}
/** M43: display text for an EventDef's dialog — the first event-choice UI this app has ever had. */
export interface CatalogEvent {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly choices: readonly {
    readonly id: string;
    readonly text: string;
    /** What this choice GAINS or COSTS, as signed player-facing chips derived from its effects
     * (grant/remove resource, stat/treasury nudge, standing) — so each option states its outcome,
     * not just its label. Omitted when the choice has no mechanical effect; optional so
     * older/modded projections stay compatible. */
    readonly outcomes?: readonly { readonly label: string; readonly kind: 'gain' | 'loss' | 'neutral' }[];
  }[];
}
/** A recruitable unit (M47.7 — the Military panel's palette; projected from UnitDefs). */
export interface CatalogUnit {
  readonly id: string;
  readonly name: string;
  readonly unitClass: string;
  readonly popCost: number;
  readonly costGold: number;
  readonly upkeepGold: number;
  readonly cost: readonly (readonly [string, number])[]; // resolved resource names
  readonly recruitTicks: number;
}

export interface UICatalog {
  readonly buildings: readonly CatalogBuilding[];
  readonly edicts: readonly CatalogEdict[];
  readonly events: readonly CatalogEvent[];
  /** M47.7: absent on pre-campaign catalogs. */
  readonly units?: readonly CatalogUnit[];
}

// ---- player panels (M47.7; doc 12 R1 "minimum viable panels") ----
// Live, player-scoped projections of diplomacy/military/research/victory state.
// Fog-gated server-side: undiscovered kingdoms carry no intel beyond existence.
export interface PanelKingdomRec {
  readonly index: number; // kingdom index (the payload id diplomacy commands take)
  readonly name: string;
  readonly discovered: boolean;
  readonly defeated: boolean;
  readonly opinion: number;
  readonly reputation: number;
  readonly atWar: boolean;
  readonly warExhaustion: number;
  readonly pacts: readonly string[];
  /** "Known for…" legibility tags (doc 07 §9), only once discovered. */
  readonly knownFor: readonly string[];
  readonly vassalOfPlayer: boolean;
  readonly playerIsVassal: boolean;
}
export interface PanelUnitRec {
  readonly id: number;
  readonly name: string; // unit def display name
  readonly count: number;
  readonly complete: boolean;
  readonly armyId: number; // 0 = unassigned
}
export interface PanelArmyRec {
  readonly id: number;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly stance: string;
  readonly strength: number; // committed troops across assigned units
  readonly siegeOf: number | null; // villageId under siege by this army
  readonly inBattle: boolean;
}
export interface PanelResearchState {
  readonly active: { readonly techId: string; readonly name: string; readonly progress: number; readonly cost: number } | null;
  readonly available: readonly { readonly techId: string; readonly name: string; readonly branch: string; readonly cost: number }[];
  readonly knownCount: number;
  readonly totalCount: number;
}
export interface PanelVictoryState {
  readonly tracks: readonly { readonly type: string; readonly progress: number }[];
  readonly prestige: number;
  readonly winner: { readonly kingdomIndex: number; readonly type: string } | null;
  readonly playerDefeated: boolean;
}
export interface PlayerPanels {
  readonly kingdoms: readonly PanelKingdomRec[];
  readonly units: readonly PanelUnitRec[];
  readonly armies: readonly PanelArmyRec[];
  readonly research: PanelResearchState | null;
  readonly victory: PanelVictoryState | null;
}

// ---- audio (M41; doc 10 §3, doc 05 §8) ----
// The cue table is data (doc 10 §3: "hence moddable") — the sim worker projects
// the DefinitionDatabase's cues/playlists into this display-ready shape once,
// exactly like UICatalog, so @crowns/audio (presentation) never imports @crowns/data.
export type AudioBus = 'music' | 'worldSfx' | 'uiSfx';
export type SynthWaveform = 'sine' | 'square' | 'triangle' | 'sawtooth' | 'noise';
export interface AudioCue {
  readonly id: string;
  readonly event: string;
  readonly bus: AudioBus;
  readonly gain: number;
  readonly waveform: SynthWaveform;
  readonly frequencyHz: number;
  readonly durationMs: number;
  readonly placeholder: boolean;
}
export interface MusicPlaylist {
  readonly id: string;
  readonly tension: 'calm' | 'tense' | 'combat';
  readonly era?: string;
  readonly season?: string;
  readonly gain: number;
  readonly trackIds: readonly string[];
  readonly placeholder: boolean;
}
export interface AudioCatalog {
  readonly cues: readonly AudioCue[];
  readonly playlists: readonly MusicPlaylist[];
}

// ---- modding (M39; doc 09) ----
/** A bundled mod the Mods screen can offer, before it's selected. */
export interface AvailableMod {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly tags: readonly string[];
}
/** Resolved layer order + conflicts for the CURRENT composition (doc 09 §5/§6). */
export interface ModReport {
  readonly order: readonly string[];
  readonly disabled: readonly { readonly id: string; readonly reasons: readonly string[] }[];
  readonly overrides: readonly { readonly defId: string; readonly layers: readonly string[]; readonly winner: string }[];
  readonly patched: readonly { readonly defId: string; readonly by: readonly string[] }[];
}
/** A save↔installed mod-set reconciliation summary (OQ-4 — best-effort, informational). */
export interface ModReconciliation {
  readonly missing: readonly { readonly modId: string; readonly version: string }[];
  readonly added: readonly { readonly modId: string; readonly version: string }[];
  readonly versionChanged: readonly { readonly modId: string; readonly saved: string; readonly installed: string }[];
  readonly contentChanged: readonly { readonly modId: string; readonly version: string }[];
}

// ---- campaign settings (M47.6; GDD §13/§14/§16 new-game options) ----
/**
 * Everything the new-game screen chooses beyond the seed. Travels on `init`
 * AND inside every save header (persistence.ts), so loading a save recomposes
 * the exact session it was written from — the kernel's restoreState refuses
 * anything else. Absent ⇒ the classic single-kingdom terra composition.
 */
export interface CampaignSettings {
  readonly mapSize: 'small' | 'medium' | 'large';
  /** Total kingdoms including the player's (kingdom 0). */
  readonly kingdomCount: number;
  /** Difficulty preset id (GDD §14); absent = neutral pre-M38 behaviour ("fair" semantics
   * but with every lever at its code default — see multiKingdomHarness's FAIR_PRESET note). */
  readonly difficulty?: 'story' | 'fair' | 'hard' | 'brutal';
  /** Enabled victory tracks (GDD §16); absent = all five. Empty = none (GDD §17 sandbox). */
  readonly victory?: readonly string[];
  /** GDD §17: defeat can be disabled independently of victory. Absent = true. */
  readonly defeatEnabled?: boolean;
  /** Campaign length in years for the Chronicle track (M47.7) — short games are a product
   * feature (and the injector-free path to a real end screen). Absent = the sim default. */
  readonly yearLimit?: number;
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
  // sandbox (roadmap M40; GDD §17): a world-creation-time toggle, absent = normal play
  | {
      kind: 'init';
      seed: number;
      mods?: { enabled: string[]; order: string[] };
      sandbox?: { ironman?: boolean };
      /** Content locale id (roadmap M44; doc 10 §6) — 'en' (default) or 'en-XA' pseudo-locale for
       * CI screenshot diffing (`?locale=en-XA`). Resolves EventDef.text/choice text only; UI-chrome
       * strings pick their own table client-side (main.ts). */
      locale?: string;
      /** M47.6: full multi-kingdom campaign options from the new-game screen.
       * Absent = the classic single-kingdom terra composition (terra-demo). */
      campaign?: CampaignSettings;
    }
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
  // ---- modding (M39): recompose the current campaign with a new mod set/order ----
  | { kind: 'setMods'; enabled: string[]; order: string[] }
  // ---- debug channel (M9; becomes the sandbox editor transport, GDD §17) ----
  | { kind: 'debug'; op: 'telemetry'; enabled: boolean; everyTicks?: number }
  | { kind: 'debug'; op: 'inspect'; entityId: number }
  | { kind: 'debug'; op: 'commands' }
  // ---- player panels (M47.7): client asks for a fresh projection (e.g. on panel open) ----
  | { kind: 'requestPanels' }
  // ---- building footprint preview: "is this def placeable at (x,y) for this village?"
  // A read-only validity probe answered by the sim's one placement rulebook, so the
  // outline preview honours every current and future placement rule automatically.
  // `seq` lets the client discard responses older than the cursor's current tile. ----
  | { kind: 'previewBuild'; seq: number; villageId: number; def: string; x: number; y: number };

// ---- from sim ----
export type FromSimMessage =
  | { kind: 'ready'; seed: number; availableMods: readonly AvailableMod[]; modReport: ModReport; sandbox: boolean }
  // ---- player panels (M47.7): emitted daily, after player commands, and on request ----
  | { kind: 'panels'; tick: number; panels: PlayerPanels }
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
      /** cue table + music playlists (M41) */
      audio?: AudioCatalog;
      /** kingdom snapshot for panel bootstrapping (M18) */
      /** M43: unresolved event dialogs from BEFORE this snapshot (e.g. a save loaded mid-tutorial) —
       * the app can't otherwise recover them, since it only reacts to freshly-published `event.fired`. */
      kingdom?: {
        activeEdicts: string[];
        pendingEvents?: readonly { readonly eventId: string; readonly choiceIds: readonly string[] }[];
        /** M47.6: the PLAYER's kingdom entity id — clients filter per-kingdom GameEvents
         * (event.fired carries the kingdom entity id) to their own kingdom with this. */
        id?: number;
        /** Tile-space centre of the player's own starting village, so the client can
         * open the camera there rather than on the geometric map centre. */
        home?: { readonly x: number; readonly y: number };
      };
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
  | { kind: 'loadResult'; ok: boolean; tick: number; migrations?: string[]; modReport?: ModReconciliation; error?: string }
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
  // ---- building footprint preview: verdict for a previewBuild probe. Carries the
  // footprint (w, h) so the renderer can draw purely from the reply, and `seq`+(x,y)
  // so the client ignores any reply the cursor has already moved past. ----
  | { kind: 'buildPreview'; seq: number; x: number; y: number; w: number; h: number; ok: boolean }
  | { kind: 'fatal'; message: string }
  // ---- storage quota (roadmap M44; doc 11 §3/§4; Risk R6) ----
  // Sent when the tripwire fires (quota estimate < 2× current usage) — a real advisory, not a
  // per-autosave spam: the worker throttles to once per session per severity level (simPort.ts).
  | { kind: 'storageAdvisory'; usageBytes: number; quotaBytes: number; persisted: boolean };
