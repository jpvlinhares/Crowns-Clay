/**
 * Unified campaign composition (roadmap M47.6; doc 12 revision R1).
 *
 * ONE function wires the FULL game — real worldgen terrain, fair multi-kingdom
 * placement, the whole economy/war/diplomacy/research/events stack, victory &
 * defeat, difficulty, per-kingdom AI, and save/load — closing the M47.5 audit's
 * central finding: every Phase 3-5 system previously lived only in the
 * standalone AI harness (flat synthetic terrain, no saves, no victory, no
 * player surface) while the playable game remained the Phase 2 sandbox.
 *
 * DESIGN CONSTRAINTS (why the wiring below looks exactly like the old
 * multiKingdomHarness body):
 *   - `composeMultiKingdom` is now a thin wrapper over this function, and its
 *     M22-M46 tests assert emergent 50-year outcomes — so the registration
 *     ORDER of every pre-existing system and component is preserved verbatim
 *     from the harness. New systems (calendar, victory-tracker) are APPENDED,
 *     which is behaviour-neutral for existing streams: the kernel forks each
 *     system's PRNG by name (kernel.ts), so added systems never perturb
 *     another system's draws.
 *   - New relational-state save sections (diplomacy, research, victory,
 *     combat, siege, fog, events, roads) plus afterLoad rebuilds of DERIVED
 *     state (village occupancy, castle defence graphs, kingdom bindings, the
 *     kingdom→village index) make save→load→resume behaviourally identical to
 *     an uninterrupted run — the R1 T objective, proven in campaign.test.ts.
 *   - The kingdom→capital binding (`villageOf`) carries conquest HISTORY (it re-binds
 *     when a capital is lost and does not snap back on reconquest), so it is saved in
 *     its own 'capitals' section (OQ-9 item 1, doc 14); only saves predating that
 *     section fall back to re-deriving oldest-still-owned from `VillageOwner`.
 *
 * Known, deliberate v1 inheritances (chartered to M47.8, doc 12 R1): each AI
 * kingdom still operates its FIRST village only, and AI kingdoms still receive
 * a starting tools allowance because the construction manager builds no
 * production chains yet.
 */
import { Locale, Rng, type EntityId } from '@crowns/core';
import {
  BASE_CONTENT_FILES,
  DefinitionDatabase,
  loadLocaleTable,
  VICTORY_TYPES,
  type AIPersonalityDef,
  type LoadReport,
  type ModSource,
} from '@crowns/data';
import type { CampaignSettings, TerrainSnapshot } from '@crowns/protocol';
import { Kernel, type TickContext } from './kernel.js';
import { World, type SoAComponent } from './ecs.js';
import { CalendarSystem, TICKS_PER_DAY } from './time.js';
import { describePersonality, perturbWeights, toPlannerWeights } from './ai/personality.js';
import { KnowledgeModel } from './ai/knowledge.js';
import { registerOccupationGameplay } from './game/occupation.js';
import { registerDefenceGameplay } from './game/defence.js';
import { generateWorld } from './worldgen/pipeline.js';
import { Biome, type MapSize, type WorldDef } from './worldgen/types.js';
import { registerVillageGameplay, VILLAGE_MIN_SPACING, type TerrainAccessor, type VillageGameplay } from './game/villages.js';
import { bestSiteNear } from './game/settlers.js';
import { registerPopulationGameplay } from './game/population.js';
import { registerEconomyGameplay } from './game/economy.js';
import { registerLogisticsGameplay } from './game/logistics.js';
import { registerSettlerGameplay } from './game/settlers.js';
import { registerKingdomGameplay, StatModifiers } from './game/kingdom.js';
import { registerDiplomacyGameplay, diplomacySection, effectiveMemoryWeight, type DiplomacyPersonality } from './game/diplomacy.js';
import { foodNeed, housingNeed, industryNeed } from './ai/needs.js';
import { registerMilitaryGameplay } from './game/military.js';
import { registerArmyGameplay } from './game/armies.js';
import { registerCombatGameplay } from './game/combat.js';
import { registerCastleGameplay } from './game/castles.js';
import { registerSiegeGameplay, type SpatialAssaultHook } from './game/siege.js';
import { publishAssaultResolved, resolveSpatialAssault } from './game/assault.js';
import { registerResearchGameplay } from './game/research.js';
import { registerEventGameplay } from './game/events.js';
import { registerVictoryGameplay, type VictoryOptions } from './game/victory.js';
import { scoreKingdomSites, type FairPlacementResult } from './worldgen/fairPlacement.js';
import { SaveManager, kernelSection, worldSection } from './persistence.js';
import { registerAiConstructionManager, type AiConstructionOptions } from './ai/manager.js';
import {
  defineAiPlanState,
  registerAiStrategicPlanner,
  DEFAULT_PERSONALITY_WEIGHTS,
  type AiDiplomacyContext,
  type AiMilitaryContext,
  type AiResearchContext,
  type AiStrategicPlannerOptions,
  type PersonalityWeights,
} from './ai/planner.js';
import { registerAiMilitaryManager, type AiWarTarget } from './ai/military.js';
import { registerAiResearchManager } from './ai/research.js';
import { registerAiEventAnswering } from './ai/events.js';
import { FogRegistry } from './ai/fogQuery.js';
import { registerScoutingSystem, SCOUT_REVEAL_RADIUS, type ScoutingKingdom } from './ai/scouting.js';
import { DIFFICULTY_PRESETS, type DifficultyPreset } from './ai/difficulty.js';

const index = (id: number): number => id & 0x3fffff;

/**
 * Default per-kingdom starting stockpile. M47.8: the free-tools CRUTCH is gone —
 * the 300-tool warchest that made toolmaking unnecessary forever. What remains is
 * a modest starter kit (25 tools ≈ a few militia's equipment, same for player and
 * AI — one rulebook); sustained recruitment now requires the wood→planks→tools
 * chain the construction manager raises itself (`industryNeed`, ai/needs.ts).
 * (The harness wrapper keeps its historical 300-tool stock — tests pinned to it.)
 */
export const DEFAULT_CAMPAIGN_STOCK: Readonly<Record<string, number>> = {
  'base:resource.wood': 2000,
  'base:resource.stone': 500,
  'base:resource.food': 300,
  'base:resource.tools': 25,
};

/** Grudge weights normalise against the heaviest recordable memory (unprovoked war = 10). */
const GRUDGE_NORM_WEIGHT = 10;

export const DEFAULT_CAMPAIGN_POPULATION = { children: 6, adults: 15, elders: 2 } as const;

/** All five tracks on, defeat on — the product default (GDD §16). */
export const DEFAULT_CAMPAIGN_VICTORY: VictoryOptions = { enabled: VICTORY_TYPES };

export interface ComposeCampaignOptions {
  readonly seed: number;
  /** Total kingdoms including the player's (kingdom 0, issuer 1). */
  readonly kingdomCount: number;
  /** Real worldgen (GDD §13). Mutually exclusive with `terrain`; one is required. */
  readonly mapSize?: MapSize;
  /** Externally supplied accessor (the harness's flat terrain). No worldgen runs. */
  readonly terrain?: TerrainAccessor;
  /** First AI-driven kingdom index (default 1 — kingdom 0 is the player, inert). */
  readonly aiFromIndex?: number;
  /** Per-kingdom personality weights; see `contentPersonalityWeights` for the content-driven
   * default the app uses. Omitted ⇒ DEFAULT_PERSONALITY_WEIGHTS for every kingdom. */
  readonly weightsOf?: (kingdomIndex: number) => PersonalityWeights;
  /** 'content' assigns the M36 archetypes (seeded round-robin + perturbation) to AI kingdoms —
   * the product path. Ignored when `weightsOf` is given. Default: neutral weights (harness). */
  readonly personalities?: 'content' | 'default';
  readonly clock?: () => number;
  readonly startingPopulation?: { readonly children: number; readonly adults: number; readonly elders: number };
  readonly startingStock?: Readonly<Record<string, number>>;
  /** M38/M46 difficulty preset, applied to every AI lever that has somewhere to attach. */
  readonly difficulty?: DifficultyPreset;
  /** Victory & defeat configuration (GDD §16/§17). Default: all five tracks, defeat on.
   * The harness wrapper passes `{ enabled: [], defeatEnabled: false }` — an inert tracker. */
  readonly victory?: VictoryOptions;
  /** Calendar system (time.dayStarted/seasonStarted events — HUD date, autosave cadence).
   * Default true; the harness wrapper opts out to stay byte-identical with its M22-M46 runs. */
  readonly calendar?: boolean;
  /** Village occupation (M47.8 — the non-castle conquest path). Default true; the harness
   * wrapper opts out (its M22-M46 emergent-outcome tests were recorded without it). */
  readonly occupation?: boolean;
  /** Believed rival strength via the knowledge model (M47.8; doc 07 §6): AI planners read
   * contact-refreshed, confidence-decayed beliefs instead of true troop counts. Default true;
   * the harness wrapper opts out (plain-count sensing is its pinned M30 behaviour). */
  readonly beliefs?: boolean;
  /** AI builds the wood→planks→tools chain (M47.8 `industryNeed`). Default true; the harness
   * wrapper opts out (its tests pinned M20's two-evaluator manager + a tools allowance). */
  readonly industry?: boolean;
  /** Grudge memory feeds the planner (M47.8 `PunitiveRaid`; doc 07 §7). Default true; the
   * harness wrapper opts out (its M30-M46 war-cycle tests predate memory consumption). */
  readonly grudges?: boolean;
  /** GDD §13 "history seeding": kingdoms start mutually AWARE of each other's capitals
   * (medieval realms knew their neighbours) — later villages stay fog-hidden until scouted.
   * Without it, start sites sit beyond scout range and no kingdom ever discovers another —
   * zero diplomacy, zero war, forever (the real-composition matrix's own finding, M47.8).
   * Default true; the harness wrapper opts out (its tests pinned unrevealed starts). */
  readonly historySeeding?: boolean;
  /** Mod layers beyond base (doc 09 §5). When set, content loads through `loadMods` and the
   * resulting manifest embeds in every save. Omitted ⇒ plain base load (harness path). */
  readonly mods?: { readonly sources: readonly ModSource[]; readonly order?: readonly string[] };
  /** GDD §17 sandbox mode — enables the privileged sandbox.* command family. */
  readonly sandbox?: { readonly ironman?: boolean };
  readonly localeId?: string;
  readonly villageNameOf?: (kingdomIndex: number) => string;
  /** New-game settings to embed in every save header (the R1 round-trip objective). */
  readonly settings?: CampaignSettings;
}

export interface CampaignComposition {
  readonly kernel: Kernel;
  readonly world: World;
  readonly db: DefinitionDatabase;
  /** null when composed without `mods` (the harness path). */
  readonly modReport: LoadReport | null;
  readonly locale: Locale;
  readonly sandbox: boolean;
  readonly Position: SoAComponent<{ x: 'f64'; y: 'f64' }>;
  /** null when composed with an external `terrain` accessor (no worldgen ran). */
  readonly worldDef: WorldDef | null;
  readonly terrainSnapshot: TerrainSnapshot | null;
  readonly game: VillageGameplay;
  readonly statMods: StatModifiers; // modifier board (edicts/offices) — read for the Joy panel drift
  readonly popGame: ReturnType<typeof registerPopulationGameplay>;
  readonly econGame: ReturnType<typeof registerEconomyGameplay>;
  readonly logiGame: ReturnType<typeof registerLogisticsGameplay>;
  readonly settlerGame: ReturnType<typeof registerSettlerGameplay>;
  readonly kingdomGame: ReturnType<typeof registerKingdomGameplay>;
  readonly diplomacyGame: ReturnType<typeof registerDiplomacyGameplay>;
  readonly militaryGame: ReturnType<typeof registerMilitaryGameplay>;
  readonly armiesGame: ReturnType<typeof registerArmyGameplay>;
  readonly combatGame: ReturnType<typeof registerCombatGameplay>;
  readonly castleGame: ReturnType<typeof registerCastleGameplay>;
  readonly siegeGame: ReturnType<typeof registerSiegeGameplay>;
  /** M49 (Phase 8): the per-kingdom castle-defence layer. */
  readonly defenceGame: ReturnType<typeof registerDefenceGameplay>;
  readonly researchGame: ReturnType<typeof registerResearchGameplay>;
  readonly eventsGame: ReturnType<typeof registerEventGameplay>;
  readonly victoryGame: ReturnType<typeof registerVictoryGameplay>;
  readonly fog: FogRegistry;
  readonly placement: FairPlacementResult;
  readonly saves: SaveManager;
  villageOf(kingdomIndex: number): number | null;
  /** M47.7: "Known for…" legibility tags (doc 07 §9) for an AI kingdom — empty for the
   * player, for default-weight kingdoms, and for anything not content-personality-driven. */
  personalityTagsOf(kingdomIndex: number): readonly string[];
}

/**
 * Content-personality assignment for AI kingdoms (M36 archetypes, seeded
 * perturbation): deterministic per (seed, kingdomIndex). Kingdom 0 (player)
 * gets neutral defaults — it is never AI-driven. The full perturbed axis
 * record rides along for the diplomacy panel's "Known for…" legibility tags
 * (doc 07 §9, M47.7) — same draws as before, nothing about the RNG changed.
 */
export function contentPersonalityAssigner(
  db: DefinitionDatabase,
  seed: number,
): (kingdomIndex: number) => { readonly def: AIPersonalityDef; readonly weights: Readonly<Record<string, number>> } | null {
  const archetypes = [...db.personalities.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
  const rng = Rng.fromSeed(seed).fork('campaign:personalities');
  const offset = archetypes.length > 0 ? rng.int(0, archetypes.length - 1) : 0;
  return (k: number) => {
    if (k === 0 || archetypes.length === 0) return null;
    const def = archetypes[(offset + k) % archetypes.length] as AIPersonalityDef;
    return { def, weights: perturbWeights(def.weights, rng.fork(`kingdom:${k}`)) };
  };
}

export function contentPersonalityWeights(
  db: DefinitionDatabase,
  seed: number,
): (kingdomIndex: number) => PersonalityWeights {
  const assign = contentPersonalityAssigner(db, seed);
  return (k: number): PersonalityWeights => {
    const a = assign(k);
    return a === null ? DEFAULT_PERSONALITY_WEIGHTS : toPlannerWeights(a.def, a.weights as never);
  };
}

/** Resolve a header/init difficulty id to the preset object (undefined stays undefined). */
export function difficultyFromSettings(settings: CampaignSettings | undefined): DifficultyPreset | undefined {
  return settings?.difficulty !== undefined ? DIFFICULTY_PRESETS[settings.difficulty] : undefined;
}

/** Victory options from settings (GDD §16/§17): absent list = all five; empty = none. */
export function victoryFromSettings(settings: CampaignSettings | undefined): VictoryOptions {
  if (settings === undefined) return DEFAULT_CAMPAIGN_VICTORY;
  return {
    enabled: (settings.victory ?? DEFAULT_CAMPAIGN_VICTORY.enabled) as VictoryOptions['enabled'],
    defeatEnabled: settings.defeatEnabled ?? true,
    ...(settings.yearLimit !== undefined ? { yearLimit: settings.yearLimit } : {}),
  };
}

export function composeCampaign(options: ComposeCampaignOptions): CampaignComposition {
  const aiFromIndex = options.aiFromIndex ?? 1;
  const difficulty = options.difficulty;
  const startingStock = options.startingStock ?? DEFAULT_CAMPAIGN_STOCK;
  const sandboxEnabled = options.sandbox !== undefined;

  // ---- content (Mod Zero gate; doc 09) ----
  let db: DefinitionDatabase;
  let modReport: LoadReport | null = null;
  if (options.mods !== undefined) {
    const sources: ModSource[] = [{ files: BASE_CONTENT_FILES }, ...options.mods.sources];
    const loaded = DefinitionDatabase.loadMods(sources, { userOrder: ['base', ...(options.mods.order ?? [])] });
    db = loaded.db;
    modReport = loaded.report;
  } else {
    db = DefinitionDatabase.load(BASE_CONTENT_FILES);
  }
  const localeId = options.localeId ?? 'en';
  const locale = new Locale(loadLocaleTable(BASE_CONTENT_FILES, `locale/${localeId}.json5`), localeId);

  // ---- terrain: real worldgen (GDD §13) or an externally supplied accessor ----
  let worldDef: WorldDef | null = null;
  let terrain: TerrainAccessor;
  if (options.terrain !== undefined) {
    terrain = options.terrain;
  } else {
    if (options.mapSize === undefined) throw new Error('composeCampaign: one of mapSize or terrain is required');
    worldDef = generateWorld(options.seed, { size: options.mapSize });
    const { width, height, layers } = worldDef;
    terrain = {
      width,
      height,
      tagsAt: (x, y) => db.terrainByCode[layers.biome[y * width + x] as number]?.buildableTags ?? [],
      riverAt: (x, y) => (layers.river[y * width + x] as number) !== 0,
      movementCostAt: (x, y) => db.terrainByCode[layers.biome[y * width + x] as number]?.movementCost ?? 0,
    };
  }

  const kernel = new Kernel(options.seed, options.clock !== undefined ? { clock: options.clock } : {});
  const world = new World(1024);

  // ---- gameplay stack, in the harness's exact registration order (see module doc) ----
  const game = registerVillageGameplay(kernel, world, db, terrain, startingStock, sandboxEnabled);
  const statMods = new StatModifiers();
  const popGame = registerPopulationGameplay(
    kernel, world, db, game,
    options.startingPopulation ?? DEFAULT_CAMPAIGN_POPULATION,
    statMods,
  );
  const econGame = registerEconomyGameplay(kernel, world, db, game, statMods);
  const Position = world.defineSoA('position', { x: 'f64', y: 'f64' });
  const logiGame = registerLogisticsGameplay(kernel, world, db, game, popGame, econGame, Position);
  const settlerGame = registerSettlerGameplay(kernel, world, db, game, popGame, econGame, logiGame, Position);
  const kingdomGameRef: { current?: ReturnType<typeof registerKingdomGameplay> } = {};
  const kingdomGame = registerKingdomGameplay(kernel, world, db, game, popGame, econGame, statMods, {
    kingdomCount: options.kingdomCount,
    sandboxEnabled,
    difficultyYieldOf(kingdomId) {
      if (difficulty === undefined) return 1;
      const idx = kingdomGameRef.current?.kingdomEntities().indexOf(kingdomId) ?? -1;
      const bonus = idx >= 0 && idx < aiFromIndex ? difficulty.playerYieldBonus : difficulty.aiYieldBonus;
      return 1 + bonus;
    },
  });
  kingdomGameRef.current = kingdomGame;

  // War stack (M25-M29).
  const militaryGame = registerMilitaryGameplay(kernel, world, db, game, popGame, kingdomGame);
  const armiesGame = registerArmyGameplay(kernel, world, game, militaryGame, kingdomGame);
  const combatGame = registerCombatGameplay(kernel, world, militaryGame, armiesGame, kingdomGame);
  const castleGame = registerCastleGameplay(kernel, world, db, game);
  // M51 (ADR-4 §2): late-bound spatial-assault hook — the defence layer registers further
  // down (it needs the capital bindings), so siege gets a ref it can call at command time.
  const spatialAssault: SpatialAssaultHook = {};
  const siegeGame = registerSiegeGameplay(kernel, world, game, militaryGame, armiesGame, castleGame, combatGame, kingdomGame, spatialAssault);

  kernel.attachGuard(world);
  kernel.addHashSource('world', (fold) => world.hash(fold));
  if (worldDef !== null) {
    const stats = worldDef.stats;
    kernel.addHashSource('worldgen', (fold) => {
      fold(Math.round(stats.landFraction * 1e6));
      for (const c of stats.biomeCounts) fold(c);
      fold(stats.riverTiles);
    });
  }

  // ---- multi-kingdom genesis at fairness-checked sites (M22) ----
  const placement = scoreKingdomSites(game, db, options.kingdomCount);
  const villageIndexByKingdom = new Map<number, number>();
  const villageNameOf = options.villageNameOf ?? ((k: number): string => `Kingdom-${k}`);

  // M47.8 (multi-village AI): every fog/war/discovery surface below ranges over ALL of a
  // kingdom's villages, not just its founding capital. Ownership lives in a PLAIN index map
  // maintained by events (founded/occupied) — never an ECS read — so callers inside OTHER
  // systems' access-guarded scopes (diplomacy hooks in the planner, event effects) stay legal:
  // the exact subscriber discipline castles.ts/victory.ts document. VillageOwner (the
  // component) remains the authoritative record; this map is rebuilt from it after load.
  const ownerIndexByVillage = new Map<number, number>(); // village dense index → kingdom index
  kernel.subscribe<{ village: number; kingdom?: number }>('village.founded', (event) => {
    const kingdomIndex =
      event.data.kingdom !== undefined ? kingdomGame.kingdomEntities().indexOf(event.data.kingdom as EntityId) : 0;
    ownerIndexByVillage.set(index(event.data.village), kingdomIndex < 0 ? 0 : kingdomIndex);
  });
  kernel.subscribe<{ village: number; kingdom: number }>('village.occupied', (event) => {
    const winnerIndex = kingdomGame.kingdomEntities().indexOf(event.data.kingdom as EntityId);
    if (winnerIndex >= 0) ownerIndexByVillage.set(index(event.data.village), winnerIndex);
  });
  // M51: siege captures transfer ownership too — the index must follow (a latent M47.8 gap:
  // assault captures were rare enough in the shipping composition that no test tripped it).
  kernel.subscribe<{ castle: number; kingdom: number }>('siege.captured', (event) => {
    const winnerIndex = kingdomGame.kingdomEntities().indexOf(event.data.kingdom as EntityId);
    if (winnerIndex >= 0) ownerIndexByVillage.set(index(event.data.castle), winnerIndex);
  });
  /** Guard-free ownership + fog check — safe from ANY scope. */
  const anyVillageKnown = (observerIndex: number, targetIndex: number): boolean => {
    for (const [vi, k] of ownerIndexByVillage) {
      if (k === targetIndex && fog.isKnown(observerIndex, vi)) return true;
    }
    return false;
  };
  /** Villages + centre coords for one kingdom. Reads VillageCore — callers are systems that
   * already declare it (scouting, belief-sensors, the military manager, occupation). */
  const villagesOfKingdom = (k: number): { vi: number; x: number; y: number }[] => {
    const core = world.read(game.comps.VillageCore);
    const out: { vi: number; x: number; y: number }[] = [];
    for (const [vi, owner] of [...ownerIndexByVillage.entries()].sort((a, b) => a[0] - b[0])) {
      if (owner !== k || !world.isAlive(vi as never)) continue;
      out.push({ vi, x: core.centerX[vi] as number, y: core.centerY[vi] as number });
    }
    return out;
  };

  kernel.registerSystem({
    name: 'multi-kingdom-genesis',
    period: 0x7fffffff,
    phase: 1,
    access: {
      writes: [
        game.comps.VillageCore, game.comps.VillageName, game.comps.Stockpile, game.comps.BuildingCore,
        popGame.Population, econGame.StockLimits,
        ...(kingdomGame.VillageOwner !== undefined ? [kingdomGame.VillageOwner] : []),
      ],
    },
    update(ctx) {
      const kingdomIds = kingdomGame.kingdomEntities();
      placement.sites.forEach((site, k) => {
        const kingdomId = kingdomIds[k];
        if (kingdomId === undefined) return;
        const owner =
          kingdomGame.VillageOwner !== undefined ? { component: kingdomGame.VillageOwner, kingdomId } : undefined;
        let result = game.ops.found(ctx, site.x, site.y, villageNameOf(k), startingStock, undefined, owner);
        if (typeof result === 'string') {
          // M47.9 defence-in-depth: fairPlacement enforces pairwise spacing now, but if the
          // one-rulebook validator still refuses (a previous founding claimed overlapping
          // ground first), fall back to the best valid site nearby instead of killing the
          // campaign at tick 1 — the 11/100 triage genesis crash, closed from both ends.
          const fallback = bestSiteNear(game, db, site.x, site.y, VILLAGE_MIN_SPACING + 8);
          if (fallback !== null) result = game.ops.found(ctx, fallback.x, fallback.y, villageNameOf(k), startingStock, undefined, owner);
        }
        if (typeof result === 'string') throw new Error(`campaign genesis: ${result}`);
        villageIndexByKingdom.set(k, index(result as number));
      });
      if (placement.variance > 0.3) {
        ctx.events.publish({ type: 'kingdom.placementUnfair', tick: ctx.tick, data: { variance: placement.variance } });
      }
      // GDD §13 history seeding (M47.8): every court knows where its neighbours' CAPITALS
      // stand from day one — diplomacy and war need a counterparty. Fog still hides every
      // village founded after this.
      if (options.historySeeding ?? true) {
        for (let a = 0; a < options.kingdomCount; a++) {
          for (let b = 0; b < options.kingdomCount; b++) {
            if (a === b) continue;
            const capital = villageIndexByKingdom.get(b);
            if (capital !== undefined) fog.reveal(a, capital);
          }
        }
      }
    },
  });

  // ---- scouting & fog (M22) ----
  const fog = new FogRegistry(() => world.queryWordCount);
  const scoutingKingdoms: ScoutingKingdom[] = [];
  for (let k = 0; k < options.kingdomCount; k++) {
    scoutingKingdoms.push({
      kingdomIndex: k,
      villages(): { entityIndex: number; x: number; y: number }[] {
        // M47.8: every owned village scouts (and is scoutable), not just the capital
        return villagesOfKingdom(k).map((v) => ({ entityIndex: v.vi, x: v.x, y: v.y }));
      },
    });
  }
  registerScoutingSystem(kernel, fog, scoutingKingdoms, {
    extraReads: [game.comps.VillageCore],
    ...(difficulty !== undefined ? { revealRadius: SCOUT_REVEAL_RADIUS * difficulty.scoutingRadiusMultiplier } : {}),
  });

  // ---- diplomacy (M23/M35) ----
  const contentAssign = options.weightsOf === undefined && options.personalities === 'content'
    ? contentPersonalityAssigner(db, options.seed)
    : null;
  const contentWeights = contentAssign === null
    ? null
    : (k: number): PersonalityWeights | undefined => {
        const a = contentAssign(k);
        return a === null ? undefined : toPlannerWeights(a.def, a.weights as never);
      };
  const weightsOf = (k: number): PersonalityWeights =>
    options.weightsOf?.(k) ?? contentWeights?.(k) ?? DEFAULT_PERSONALITY_WEIGHTS;
  const diplomacyGame = registerDiplomacyGameplay(kernel, world, kingdomGame, {
    hasDiscovered(observerIndex: number, target: EntityId): boolean {
      const targetIndex = kingdomGame.kingdomEntities().indexOf(target);
      return targetIndex >= 0 && anyVillageKnown(observerIndex, targetIndex); // M47.8: any village counts
    },
    personalityOf(kingdomId: EntityId): DiplomacyPersonality {
      const idx = kingdomGame.kingdomEntities().indexOf(kingdomId);
      return { diplomacyTrust: (idx < 0 ? DEFAULT_PERSONALITY_WEIGHTS : weightsOf(idx)).diplomacyTrust ?? 0.5 };
    },
    ...(difficulty !== undefined ? { jointWarCoordination: difficulty.jointWarCoordination } : {}),
  });

  const diplomacyContextFor = (kingdomIndex: number): AiDiplomacyContext => ({
    knownKingdoms(): EntityId[] {
      const out: EntityId[] = [];
      for (let other = 0; other < options.kingdomCount; other++) {
        if (other === kingdomIndex) continue;
        const otherId = kingdomGame.kingdomEntities()[other];
        if (otherId !== undefined && anyVillageKnown(kingdomIndex, other)) out.push(otherId);
      }
      return out;
    },
    opinionOf(target: EntityId): number {
      const myId = kingdomGame.kingdomEntities()[kingdomIndex];
      return myId === undefined ? 0 : diplomacyGame.state.opinionOf(myId as number, target as number);
    },
    hasPact(target: EntityId, type: 'nonAggression' | 'trade'): boolean {
      const myId = kingdomGame.kingdomEntities()[kingdomIndex];
      return myId !== undefined && diplomacyGame.state.hasPact(myId as number, target as number, type);
    },
    kingdomIndexOf(target: EntityId): number {
      return kingdomGame.kingdomEntities().indexOf(target);
    },
    // M47.8 (doc 07 §7 consumed): the heaviest decayed NEGATIVE memory this kingdom holds
    // against any DISCOVERED rival — fuels PunitiveRaid. Weight normalised against the
    // war-declaration weight so a fresh betrayal reads ~1.0 and fades with grudgeRetention.
    strongestGrudge(): { target: EntityId; weight: number } | null {
      if (!(options.grudges ?? true)) return null; // harness wrapper: memory stays unconsumed
      const myId = kingdomGame.kingdomEntities()[kingdomIndex];
      if (myId === undefined) return null;
      const retention = weightsOf(kingdomIndex).grudgeRetention ?? 0.5;
      let best: { target: EntityId; weight: number } | null = null;
      for (let other = 0; other < options.kingdomCount; other++) {
        if (other === kingdomIndex) continue;
        const otherId = kingdomGame.kingdomEntities()[other];
        if (otherId === undefined || !anyVillageKnown(kingdomIndex, other)) continue;
        for (const entry of diplomacyGame.state.memoriesOf(myId as number, otherId as number)) {
          if (entry.valence >= 0) continue;
          const weight = Math.min(1, effectiveMemoryWeight(entry, kernel.currentTick, retention) / GRUDGE_NORM_WEIGHT);
          if (weight > (best?.weight ?? 0)) best = { target: otherId, weight };
        }
      }
      return best;
    },
  });

  // ---- military contexts (M30) ----
  const committedStrengthOf = (kingdomId: number): number => {
    const u = world.read(militaryGame.Unit);
    let total = 0;
    world.query([militaryGame.Unit]).forEach((ui) => {
      if ((u.kingdomId[ui] as number) === kingdomId && (u.complete[ui] as number) === 1) total += u.count[ui] as number;
    });
    return total;
  };
  // ---- believed rival strength (M47.8; doc 07 §6 — the knowledge model, finally consumed) ----
  // Each AI kingdom carries a KnowledgeModel over 'armyStrength' facts: refreshed on CONTACT
  // (any own village within scouting range of a rival village — current proximity, unlike
  // fog's permanent reveals), confidence-decaying otherwise, read through believedValue's
  // deterministic noise (keyed rng fork of (observer, target, tick) — no persistent stream,
  // nothing extra to save beyond the packed facts themselves). Stale beliefs cause honest AI
  // mistakes — a deliberate emergence and difficulty lever (doc 07 §6/§10).
  const beliefsEnabled = options.beliefs ?? true;
  const beliefModels = new Map<number, KnowledgeModel>();
  const BELIEF_HALF_LIFE = TICKS_PER_DAY * 30; // brain.ts's own M19 default
  const believedStrengthOf = (observerIndex: number, targetIndex: number): number | undefined => {
    const model = beliefModels.get(observerIndex);
    const targetId = kingdomGame.kingdomEntities()[targetIndex];
    if (model === undefined || targetId === undefined) return undefined;
    const rng = Rng.fromSeed(options.seed).fork(`belief:${observerIndex}:${targetIndex}:${kernel.currentTick}`);
    const believed = model.believedValue(targetId as number, 'armyStrength', kernel.currentTick, rng);
    return believed === undefined ? undefined : Math.max(0, believed);
  };
  if (beliefsEnabled) {
    for (let k = aiFromIndex; k < options.kingdomCount; k++) beliefModels.set(k, new KnowledgeModel());
    const contactRadius = SCOUT_REVEAL_RADIUS * (difficulty?.scoutingRadiusMultiplier ?? 1);
    kernel.registerSystem({
      name: 'belief-sensors',
      period: TICKS_PER_DAY,
      phase: 11,
      access: {
        reads: [
          game.comps.VillageCore, militaryGame.Unit,
          ...(kingdomGame.VillageOwner !== undefined ? [kingdomGame.VillageOwner] : []),
        ],
      },
      update(ctx: TickContext): void {
        for (const [k, model] of beliefModels) {
          model.decayAll(ctx.tick, BELIEF_HALF_LIFE);
          const mine = villagesOfKingdom(k);
          if (mine.length === 0) continue;
          for (let other = 0; other < options.kingdomCount; other++) {
            if (other === k) continue;
            const otherId = kingdomGame.kingdomEntities()[other];
            if (otherId === undefined) continue;
            const contact = villagesOfKingdom(other).some((tv) =>
              mine.some((mv) => Math.max(Math.abs(mv.x - tv.x), Math.abs(mv.y - tv.y)) <= contactRadius),
            );
            if (contact) {
              model.record({
                subject: otherId as number,
                kind: 'armyStrength',
                value: committedStrengthOf(otherId as number),
                confidence: 1,
                lastUpdated: ctx.tick,
                source: 'scout',
              });
            }
          }
        }
      },
    });
    kernel.addHashSource('beliefs', (fold) => {
      for (const [k, model] of beliefModels) {
        fold(k);
        for (const v of model.pack()) fold(Math.round(v * 1000));
      }
    });
  }

  const militaryContextFor = (kingdomIndex: number): AiMilitaryContext => ({
    ownStrength(): number {
      const myId = kingdomGame.kingdomEntities()[kingdomIndex];
      return myId === undefined ? 0 : committedStrengthOf(myId as number);
    },
    knownRivalStrengths(): number[] {
      const out: number[] = [];
      for (let other = 0; other < options.kingdomCount; other++) {
        if (other === kingdomIndex) continue;
        const otherId = kingdomGame.kingdomEntities()[other];
        if (otherId === undefined || !anyVillageKnown(kingdomIndex, other)) continue;
        // M47.8 (doc 07 §6): BELIEVED strength when the knowledge model is composed —
        // contact-refreshed, confidence-decayed, deterministic-noise — else plain truth
        // (the harness wrapper's pinned M30 behaviour).
        out.push(believedStrengthOf(kingdomIndex, other) ?? committedStrengthOf(otherId as number));
      }
      return out;
    },
  });
  const warTargetsFor = (kingdomIndex: number): readonly AiWarTarget[] => {
    // M47.8: EVERY known enemy village is a target, not just the capital
    const out: AiWarTarget[] = [];
    for (let other = 0; other < options.kingdomCount; other++) {
      if (other === kingdomIndex) continue;
      const otherId = kingdomGame.kingdomEntities()[other];
      if (otherId === undefined) continue;
      for (const v of villagesOfKingdom(other)) {
        if (!fog.isKnown(kingdomIndex, v.vi)) continue;
        out.push({
          kingdomId: otherId as number,
          villageId: v.vi,
          x: v.x,
          y: v.y,
          isCastle: castleGame.isCastle(v.vi),
        });
      }
    }
    return out;
  };

  // ---- research (M32) ----
  const researchGameRef: { current?: ReturnType<typeof registerResearchGameplay> } = {};
  const researchGame = registerResearchGameplay(kernel, world, db, game, kingdomGame, {
    knownByNeighbor(kingdomId: EntityId, techId: string): boolean {
      const myIndex = kingdomGame.kingdomEntities().indexOf(kingdomId);
      if (myIndex < 0 || researchGameRef.current === undefined) return false;
      for (let other = 0; other < options.kingdomCount; other++) {
        if (other === myIndex) continue;
        const otherId = kingdomGame.kingdomEntities()[other];
        if (otherId === undefined || !anyVillageKnown(myIndex, other)) continue;
        if (researchGameRef.current.isKnown(otherId, techId)) return true;
      }
      return false;
    },
  });
  researchGameRef.current = researchGame;

  const researchContextFor = (kingdomIndex: number): AiResearchContext => ({
    coverage(): number {
      const myId = kingdomGame.kingdomEntities()[kingdomIndex];
      return myId === undefined ? 0 : researchGame.coverageOf(myId);
    },
  });

  // ---- events (M33/M43) ----
  const eventsGame = registerEventGameplay(kernel, world, db, game, popGame, kingdomGame, {
    diplomacy: {
      applyOpinionDelta(kingdomId: EntityId, delta: number): void {
        const myIndex = kingdomGame.kingdomEntities().indexOf(kingdomId);
        if (myIndex < 0) return;
        for (let other = 0; other < options.kingdomCount; other++) {
          if (other === myIndex) continue;
          const otherId = kingdomGame.kingdomEntities()[other];
          if (otherId === undefined || !anyVillageKnown(myIndex, other)) continue;
          diplomacyGame.state.applyOpinionDelta(kingdomId as number, otherId as number, delta);
        }
      },
    },
    research: { isKnown: (kingdomId, techId) => researchGame.isKnown(kingdomId, techId) },
  });

  // ---- per-kingdom AI (M19-M33), kingdoms aiFromIndex..n-1 ----
  const sharedPlanState = defineAiPlanState(world);
  for (let k = aiFromIndex; k < options.kingdomCount; k++) {
    const dctx = diplomacyContextFor(k);
    const managerOptions: AiConstructionOptions = {
      issuer: k + 1,
      id: String(k),
      // M47.8: campaigns build the toolmaking chain themselves (no genesis tools crutch);
      // the harness wrapper opts out (its tests pinned M20's two-evaluator manager).
      ...(options.industry ?? true ? { needs: [foodNeed, housingNeed, industryNeed] } : {}),
      get villageId(): EntityId {
        return (villageIndexByKingdom.get(k) ?? 0) as EntityId;
      },
    };
    registerAiConstructionManager(kernel, world, db, game, popGame, managerOptions);
    const plannerOptions: AiStrategicPlannerOptions = {
      issuer: k + 1,
      id: String(k),
      sharedPlanState,
      weights: weightsOf(k),
      diplomacy: dctx,
      military: militaryContextFor(k),
      research: researchContextFor(k),
      extraReads: [militaryGame.Unit],
      ...(difficulty !== undefined
        ? { appraisalNoise: difficulty.appraisalNoise, periodMultiplier: difficulty.periodMultiplier }
        : {}),
      get villageId(): EntityId {
        return (villageIndexByKingdom.get(k) ?? 0) as EntityId;
      },
    };
    const planner = registerAiStrategicPlanner(kernel, world, db, game, popGame, plannerOptions);
    registerAiResearchManager(kernel, world, db, game, researchGame, {
      issuer: k + 1,
      id: String(k),
      getPlan: () => planner.currentPlan(),
      extraReads: [planner.AiPlanState],
      get villageId(): EntityId {
        return (villageIndexByKingdom.get(k) ?? 0) as EntityId;
      },
      get kingdomId(): EntityId {
        return (kingdomGame.kingdomEntities()[k] ?? 0) as EntityId;
      },
    });
    registerAiEventAnswering(kernel, eventsGame, {
      issuer: k + 1,
      id: String(k),
      weights: weightsOf(k) as unknown as Readonly<Record<string, number | undefined>>,
      get kingdomId(): EntityId {
        return (kingdomGame.kingdomEntities()[k] ?? 0) as EntityId;
      },
    });
    registerAiMilitaryManager(kernel, world, db, game, popGame, militaryGame, armiesGame, castleGame, siegeGame, {
      issuer: k + 1,
      id: String(k),
      getPlan: () => planner.currentPlan(),
      warTargets: () => warTargetsFor(k),
      grudgeTarget: () => dctx.strongestGrudge?.()?.target ?? null, // M47.8: PunitiveRaid aims here
      diplomacy: {
        isAtWar(target: EntityId): boolean {
          const myId = kingdomGame.kingdomEntities()[k];
          return myId !== undefined && diplomacyGame.state.isAtWar(myId as number, target as number);
        },
        declareWar(target: EntityId): void {
          const targetIndex = kingdomGame.kingdomEntities().indexOf(target);
          if (targetIndex < 0) return;
          kernel.submit({ type: 'kingdom.declareWar', issuer: k + 1, payload: { targetKingdom: targetIndex, casusBelli: true } });
        },
        proposePeace(target: EntityId, tribute: number): void {
          const targetIndex = kingdomGame.kingdomEntities().indexOf(target);
          if (targetIndex < 0) return;
          kernel.submit({ type: 'kingdom.proposePeace', issuer: k + 1, payload: { targetKingdom: targetIndex, tribute } });
        },
      },
      extraReads: [planner.AiPlanState],
      get villageId(): EntityId {
        return (villageIndexByKingdom.get(k) ?? 0) as EntityId;
      },
      get kingdomId(): EntityId {
        return (kingdomGame.kingdomEntities()[k] ?? 0) as EntityId;
      },
    });
  }

  // ---- APPENDED systems (M47.6): behaviour-neutral for the pre-existing stack ----
  if (options.calendar ?? true) kernel.registerSystem(new CalendarSystem());
  const victoryGame = registerVictoryGameplay(
    kernel, world, db, game, popGame, kingdomGame,
    { diplomacy: diplomacyGame, research: researchGame },
    options.victory ?? DEFAULT_CAMPAIGN_VICTORY,
  );
  kernel.addHashSource('fog', (fold) => fog.fold(fold));

  // ---- M47.8: settler-founded villages fly their source's banner ----
  if (kingdomGame.VillageOwner !== undefined) {
    const VillageOwner = kingdomGame.VillageOwner;
    settlerGame.setFoundingOwner((sourceVi) => {
      const kingdomId = world.read(VillageOwner).kingdom[sourceVi] as number;
      return kingdomId !== 0 ? { component: VillageOwner, kingdomId: kingdomId as EntityId } : undefined;
    }, VillageOwner);
  }

  // ---- M47.8: occupation — the non-castle conquest path (campaign-only; wrapper opts out) ----
  const occupationGame = (options.occupation ?? true)
    ? registerOccupationGameplay(kernel, world, game, militaryGame, armiesGame, kingdomGame, castleGame, {
        isAtWar: (a, b) => diplomacyGame.state.isAtWar(a as number, b as number),
      })
    : null;
  // ---- M49 (Phase 8, ADR-4): the per-kingdom castle-defence layer — maps, keep,
  // defence.build/demolish/post commands, 'defence' hash source. Appended registration:
  // no periodic systems, so existing streams and cadences are untouched.
  const defenceGame = registerDefenceGameplay(kernel, world, db, game, econGame, kingdomGame, militaryGame, castleGame, {
    worldSeed: options.seed,
    kingdomCount: options.kingdomCount,
    capitalOf: (k) => villageIndexByKingdom.get(k) ?? null,
  });
  // The spatial assault applies to CAPITALS with a defence layer (ADR-4 §6: the layer guards
  // the capital only); every other castle keeps the legacy breach-and-engagement path.
  // `applicable` additionally makes such capitals SIEGE-ELIGIBLE without a world-map wall
  // enclosure — the layer is their castle-ness. Interim loss rules unchanged (doc 14 OQ-9
  // item 2): a capture is still an owner flip; capital-death arrives at M53.
  spatialAssault.applicable = (castleVi) => {
    if (kingdomGame.VillageOwner === undefined) return false;
    const ownerId = world.read(kingdomGame.VillageOwner).kingdom[castleVi] as number;
    const k = kingdomGame.kingdomEntities().indexOf(ownerId as EntityId);
    return k >= 0 && villageIndexByKingdom.get(k) === castleVi && defenceGame.mapOf(k) !== undefined;
  };
  spatialAssault.current = (ctx, siege, origin) => {
    if (kingdomGame.VillageOwner === undefined) return null;
    const ownerId = world.read(kingdomGame.VillageOwner).kingdom[siege.castle] as number;
    const k = kingdomGame.kingdomEntities().indexOf(ownerId as EntityId);
    if (k < 0 || villageIndexByKingdom.get(k) !== siege.castle) return null;
    if (defenceGame.mapOf(k) === undefined) return null;
    const result = resolveSpatialAssault({
      world,
      rng: ctx.rng,
      game,
      militaryGame,
      castleGame,
      defenceGame,
      defenderKingdomIndex: k,
      defenderKingdomId: ownerId,
      attackerArmy: siege.attackerArmy,
      origin,
    });
    publishAssaultResolved(ctx.events, ctx.tick, siege.castle, siege.attackerArmy, ownerId, result);
    return result.outcome;
  };

  // a fallen capital re-binds the loser's AI to its next-oldest village (or none) —
  // whether it fell to occupation or to a siege capture (M51)
  const rebindOnLoss = (village: number, from: number): void => {
    const loserIndex = kingdomGame.kingdomEntities().indexOf(from as EntityId);
    if (loserIndex < 0 || villageIndexByKingdom.get(loserIndex) !== village) return;
    const remaining = villagesOfKingdom(loserIndex).filter((v) => v.vi !== village);
    if (remaining.length > 0) villageIndexByKingdom.set(loserIndex, (remaining[0] as { vi: number }).vi);
    else villageIndexByKingdom.delete(loserIndex);
  };
  kernel.subscribe<{ village: number; from: number }>('village.occupied', (event) => rebindOnLoss(event.data.village, event.data.from));
  kernel.subscribe<{ castle: number; from: number }>('siege.captured', (event) => rebindOnLoss(event.data.castle, event.data.from));

  // ---- sandbox terrain editing (M40) — only meaningful over real worldgen ----
  if (worldDef !== null) {
    const wd = worldDef;
    const biome = wd.layers.biome;
    const { width, height } = wd;
    const rejectSandbox = (ctx: TickContext, what: string, reason: string): void => {
      ctx.events.publish({ type: 'village.rejected', tick: ctx.tick, data: { what, reason } });
    };
    kernel.registerCommand<{ x: number; y: number; biomeCode: number }>('sandbox.editTerrain', (ctx, payload) => {
      if (!sandboxEnabled) return rejectSandbox(ctx, 'sandbox.editTerrain', 'sandbox mode is not enabled');
      const x = payload.x | 0;
      const y = payload.y | 0;
      const code = payload.biomeCode | 0;
      if (x < 0 || y < 0 || x >= width || y >= height) return rejectSandbox(ctx, 'sandbox.editTerrain', 'out of bounds');
      if (db.terrainByCode[code] === undefined) return rejectSandbox(ctx, 'sandbox.editTerrain', `unknown biome code ${code}`);
      if (code === Biome.Ocean || code === Biome.Coast) return rejectSandbox(ctx, 'sandbox.editTerrain', 'cannot paint water (land-only edits)');
      const i = y * width + x;
      const oldCode = biome[i] as number;
      if (oldCode === Biome.Ocean || oldCode === Biome.Coast) return rejectSandbox(ctx, 'sandbox.editTerrain', 'cannot repaint a water tile');
      if (oldCode === code) return;
      biome[i] = code;
      wd.stats.biomeCounts[oldCode] = (wd.stats.biomeCounts[oldCode] as number) - 1;
      wd.stats.biomeCounts[code] = (wd.stats.biomeCounts[code] as number) + 1;
      ctx.events.publish({ type: 'sandbox.terrainEdited', tick: ctx.tick, data: { x, y, biomeCode: code } });
    });
  }

  // ---- save/load (TDD §8): every hash-contributing state has a section ----
  const saves = new SaveManager(kernel);
  if (modReport !== null) saves.setModManifest(modReport.manifest);
  saves.setSandboxFlags({ sandbox: sandboxEnabled, ironman: options.sandbox?.ironman ?? false });
  if (options.settings !== undefined) saves.setCampaignSettings(options.settings);
  saves.register(kernelSection(kernel));
  saves.register(worldSection(world));
  saves.register({
    key: 'roads',
    version: 1,
    save: () => logiGame.roads.list(),
    load: (data) => logiGame.roads.restore(data as number[]),
  });
  saves.register({
    key: 'events',
    version: 1,
    save: () => eventsGame.state.save(),
    load: (data) => eventsGame.state.restore(data as ReturnType<typeof eventsGame.state.save>),
  });
  saves.register(diplomacySection(diplomacyGame.state));
  saves.register({
    key: 'research',
    version: 1,
    save: () => researchGame.state.save(),
    load: (data) => researchGame.state.restore(data as ReturnType<typeof researchGame.state.save>),
  });
  saves.register({
    key: 'victory',
    version: 1,
    save: () => victoryGame.save(),
    load: (data) => victoryGame.restore(data as ReturnType<typeof victoryGame.save>),
  });
  saves.register({
    key: 'combat',
    version: 1,
    save: () => combatGame.state.save(),
    load: (data) => combatGame.state.restore(data as ReturnType<typeof combatGame.state.save>),
  });
  saves.register({
    key: 'siege',
    version: 1,
    save: () => siegeGame.state.save(),
    load: (data) => siegeGame.state.restore(data as ReturnType<typeof siegeGame.state.save>),
  });
  saves.register({
    key: 'fog',
    version: 1,
    save: () => fog.save(),
    load: (data) => fog.restore(data as ReturnType<typeof fog.save>),
  });
  if (occupationGame !== null) {
    saves.register({
      key: 'occupation',
      version: 1,
      save: () => occupationGame.state.save(),
      load: (data) => occupationGame.state.restore(data as ReturnType<typeof occupationGame.state.save>),
    });
  }
  // OQ-9 item 1 (doc 14, 2026-07-16): the kingdom→capital binding is HISTORY, not derivable —
  // a capital that re-bound when conquered must not snap back if the old one is re-taken.
  // Optional: saves predating this section fall back to afterLoad's oldest-still-owned
  // derivation (the historical rule), accepting a one-time snap if already mid-divergence.
  let restoredCapitals: readonly (readonly [number, number])[] | null = null;
  saves.register({
    key: 'capitals',
    version: 1,
    optional: true,
    save: () => [...villageIndexByKingdom.entries()].sort((a, b) => a[0] - b[0]),
    load: (data) => {
      restoredCapitals = data as [number, number][];
    },
  });
  // M49: defence maps travel as seed + version stamp + RLE tiles; restore() regenerates from
  // the seed when the pipeline version matches and falls back to the stored tiles when it
  // doesn't (ADR-4: permanent structures depend on tile-exact ground — never re-roll).
  // Optional: pre-Phase-8 saves get freshly generated maps (their layers were empty by
  // definition; structures/posts live in worldSection regardless).
  saves.register({
    key: 'defence',
    version: 1,
    optional: true,
    save: () => defenceGame.save(),
    load: (data) => defenceGame.restore(data as ReturnType<typeof defenceGame.save>),
  });
  if (beliefsEnabled) {
    saves.register({
      key: 'beliefs',
      version: 1,
      save: () => [...beliefModels.entries()].map(([k, model]) => ({ kingdom: k, facts: model.pack() })),
      load: (data) => {
        const entries = data as readonly { kingdom: number; facts: number[] }[];
        beliefModels.clear();
        for (const e of entries) beliefModels.set(e.kingdom, KnowledgeModel.unpack(e.facts));
      },
    });
  }
  saves.afterLoad(() => {
    game.ops.rebuildDerived();
    kingdomGame.refreshAfterLoad();
    castleGame.rebuildDerived();
    defenceGame.rebuildDerived();
    // genesis only runs on tick 1 — after hydration the plain ownership map is re-derived
    // from VillageOwner (the authoritative record). The kingdom→capital binding is NOT
    // derivable (it carries conquest history): the 'capitals' section restores it; only
    // saves predating that section fall back to the historical oldest-still-owned rule.
    villageIndexByKingdom.clear();
    ownerIndexByVillage.clear();
    const owner = kingdomGame.VillageOwner !== undefined ? world.read(kingdomGame.VillageOwner) : null;
    const kingdomIds = kingdomGame.kingdomEntities();
    world.query([game.comps.VillageCore]).forEach((vi) => {
      const k = owner !== null ? kingdomIds.indexOf(owner.kingdom[vi] as EntityId) : 0;
      if (k >= 0) {
        ownerIndexByVillage.set(vi, k);
        if (restoredCapitals === null && !villageIndexByKingdom.has(k)) villageIndexByKingdom.set(k, vi);
      }
    });
    if (restoredCapitals !== null) {
      for (const [k, vi] of restoredCapitals) villageIndexByKingdom.set(k, vi);
      restoredCapitals = null;
    }
  });

  // ---- render-ready terrain snapshot (protocol), when worldgen ran ----
  const terrainSnapshot: TerrainSnapshot | null =
    worldDef === null
      ? null
      : {
          width: worldDef.width,
          height: worldDef.height,
          biome: worldDef.layers.biome,
          river: worldDef.layers.river,
          palette: db.terrainByCode.map((t) => ({ base: t.colors.base, accent: t.colors.accent, name: t.name })),
          riverColor: db.overlays.get('river')?.color ?? 0x4a86b0,
          lakeColor: db.overlays.get('lake')?.color ?? 0x3f7aa4,
        };

  return {
    kernel, world, db, modReport, locale, sandbox: sandboxEnabled, Position, worldDef, terrainSnapshot,
    game, statMods, popGame, econGame, logiGame, settlerGame, kingdomGame, diplomacyGame, militaryGame, armiesGame,
    combatGame, castleGame, siegeGame, defenceGame, researchGame, eventsGame, victoryGame, fog, placement, saves,
    villageOf: (kingdomIndex: number) => villageIndexByKingdom.get(kingdomIndex) ?? null,
    personalityTagsOf: (kingdomIndex: number): readonly string[] => {
      const a = contentAssign?.(kingdomIndex);
      return a == null ? [] : describePersonality(a.weights as never);
    },
  };
}
