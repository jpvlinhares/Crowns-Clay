/**
 * Standalone multi-kingdom composition (roadmap M22). NOT wired into
 * terra.ts/scenarios.ts — same golden-fixture-safety reasoning as M19-M21:
 * the `kingdom.ts` retrofit itself is provably safe for `terra-demo`
 * (additive/opt-in), so there's no reason to also risk the pinned scenario
 * by wiring multi-kingdom demo content into it.
 *
 * Founds `kingdomCount` kingdoms at fairness-checked start sites
 * (worldgen/fairPlacement.ts), tags each village with its owning kingdom,
 * registers a construction manager + strategic planner (M20/M21, reused
 * as-is) for every AI kingdom (kingdoms `aiFromIndex..n-1`; default 1,
 * leaving kingdom 0 as an inert "player" — pass `aiFromIndex: 0` for a
 * fully-AI campaign, M24), and wires daily scouting (fog reveal) between
 * every kingdom pair, player included.
 */
import type { EntityId } from '@crowns/core';
import { DefinitionDatabase, BASE_CONTENT_FILES } from '@crowns/data';
import { Kernel } from '../kernel.js';
import { World } from '../ecs.js';
import { registerVillageGameplay, type TerrainAccessor } from '../game/villages.js';
import { registerPopulationGameplay } from '../game/population.js';
import { registerEconomyGameplay } from '../game/economy.js';
import { registerLogisticsGameplay } from '../game/logistics.js';
import { registerSettlerGameplay } from '../game/settlers.js';
import { registerKingdomGameplay, StatModifiers } from '../game/kingdom.js';
import { registerDiplomacyGameplay, type DiplomacyPersonality } from '../game/diplomacy.js';
import { registerMilitaryGameplay } from '../game/military.js';
import { registerArmyGameplay } from '../game/armies.js';
import { registerCombatGameplay } from '../game/combat.js';
import { registerCastleGameplay } from '../game/castles.js';
import { registerSiegeGameplay } from '../game/siege.js';
import { registerResearchGameplay } from '../game/research.js';
import { registerEventGameplay } from '../game/events.js';
import { scoreKingdomSites, type FairPlacementResult } from '../worldgen/fairPlacement.js';
import { registerAiConstructionManager, type AiConstructionOptions } from './manager.js';
import {
  defineAiPlanState,
  registerAiStrategicPlanner,
  DEFAULT_PERSONALITY_WEIGHTS,
  type AiDiplomacyContext,
  type AiMilitaryContext,
  type AiResearchContext,
  type AiStrategicPlannerOptions,
  type PersonalityWeights,
} from './planner.js';
import { registerAiMilitaryManager, type AiWarTarget } from './military.js';
import { registerAiResearchManager } from './research.js';
import { registerAiEventAnswering } from './events.js';
import { FogRegistry } from './fogQuery.js';
import { registerScoutingSystem, type ScoutingKingdom } from './scouting.js';

const index = (id: number): number => id & 0x3fffff;

export const flatTerrain = (width: number, height: number): TerrainAccessor => ({
  width,
  height,
  tagsAt: () => ['open', 'farmable', 'mineable', 'woodland'],
  riverAt: () => false,
  movementCostAt: () => 1,
});

// 'base:resource.tools' (M30): the construction AI (manager.ts) only ever queues food/housing
// buildings (its own documented scoping note) — no toolmaking chain gets built, so without a
// starting allowance recruitment would be permanently stuck at "insufficient tools" for every
// AI kingdom, forever. A one-time stockpile is enough to raise and sustain a real war party
// (recruitment cost is one-time; only gold/food upkeep recurs, M25) without needing production.
const KINGDOM_STARTING_STOCK = {
  'base:resource.wood': 2000, 'base:resource.stone': 500, 'base:resource.food': 300, 'base:resource.tools': 300,
};

export interface MultiKingdomComposition {
  readonly kernel: Kernel;
  readonly world: World;
  readonly db: DefinitionDatabase;
  readonly game: ReturnType<typeof registerVillageGameplay>;
  readonly popGame: ReturnType<typeof registerPopulationGameplay>;
  readonly kingdomGame: ReturnType<typeof registerKingdomGameplay>;
  readonly diplomacyGame: ReturnType<typeof registerDiplomacyGameplay>;
  readonly militaryGame: ReturnType<typeof registerMilitaryGameplay>;
  readonly armiesGame: ReturnType<typeof registerArmyGameplay>;
  readonly combatGame: ReturnType<typeof registerCombatGameplay>;
  readonly castleGame: ReturnType<typeof registerCastleGameplay>;
  readonly siegeGame: ReturnType<typeof registerSiegeGameplay>;
  readonly researchGame: ReturnType<typeof registerResearchGameplay>;
  readonly eventGame: ReturnType<typeof registerEventGameplay>;
  readonly fog: FogRegistry;
  readonly placement: FairPlacementResult;
  villageOf(kingdomIndex: number): number | null;
}

export interface MultiKingdomOptions {
  readonly seed?: number;
  readonly kingdomCount: number;
  readonly mapSize?: number;
  /** Per-kingdom-index (0..n-1) personality weights; default for every kingdom if omitted. */
  readonly weightsOf?: (kingdomIndex: number) => PersonalityWeights;
  /** First kingdom index to AI-drive (default 1 — kingdom 0 is "the player," inert). Pass 0 for
   * a fully-AI campaign (M24). */
  readonly aiFromIndex?: number;
  /** Observational clock for perf telemetry (M24) — omitted means zero measurement overhead,
   * matching the kernel's own "no clock, no cost" contract. */
  readonly clock?: () => number;
  /** Starting cohorts (default `{children:6, adults:15, elders:2}`, M22/M24's original). A
   * campaign that recruits (M30) needs enough spare adults that a single unit's `popCost` (10,
   * base content) doesn't gut the farm workforce it depends on to ever recruit a second one. */
  readonly startingPopulation?: { readonly children: number; readonly adults: number; readonly elders: number };
}

/** Kingdom placements far enough apart that fairness naturally holds; scouting range (M22
 * SCOUT_REVEAL_RADIUS) is deliberately much smaller than the inter-kingdom distance this
 * produces, so newly founded kingdoms start genuinely unrevealed to each other. */
export function composeMultiKingdom(options: MultiKingdomOptions): MultiKingdomComposition {
  const size = options.mapSize ?? 300;
  const terrain = flatTerrain(size, size);
  const kernel = new Kernel(options.seed ?? 2200, options.clock !== undefined ? { clock: options.clock } : {});
  const world = new World(1024);
  const db = DefinitionDatabase.load(BASE_CONTENT_FILES);

  const game = registerVillageGameplay(kernel, world, db, terrain, KINGDOM_STARTING_STOCK);
  const popGame = registerPopulationGameplay(kernel, world, db, game, options.startingPopulation ?? { children: 6, adults: 15, elders: 2 });
  const econGame = registerEconomyGameplay(kernel, world, db, game);
  const Position = world.defineSoA('position', { x: 'f64', y: 'f64' });
  const logiGame = registerLogisticsGameplay(kernel, world, db, game, popGame, econGame, Position);
  registerSettlerGameplay(kernel, world, db, game, popGame, econGame, logiGame, Position);
  const statMods = new StatModifiers();
  const kingdomGame = registerKingdomGameplay(kernel, world, db, game, popGame, econGame, statMods, {
    kingdomCount: options.kingdomCount,
  });

  // War stack (M25-M29), reused as-is for AI-vs-AI campaigns (M30).
  const militaryGame = registerMilitaryGameplay(kernel, world, db, game, popGame, kingdomGame);
  const armiesGame = registerArmyGameplay(kernel, world, game, militaryGame, kingdomGame);
  const combatGame = registerCombatGameplay(kernel, world, militaryGame, armiesGame, kingdomGame);
  const castleGame = registerCastleGameplay(kernel, world, db, game);
  const siegeGame = registerSiegeGameplay(kernel, world, game, militaryGame, armiesGame, castleGame, combatGame, kingdomGame);

  kernel.attachGuard(world);
  kernel.addHashSource('world', (fold) => world.hash(fold));

  const placement = scoreKingdomSites(game, db, options.kingdomCount);
  const villageIndexByKingdom = new Map<number, number>(); // kingdomIndex (0..n-1) -> village dense index

  kernel.registerSystem({
    name: 'multi-kingdom-genesis',
    period: 0x7fffffff,
    phase: 1, // same tick as kingdom-genesis (also phase 1); registered after it, so it runs second
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
        const result = game.ops.found(ctx, site.x, site.y, `Kingdom-${k}`, KINGDOM_STARTING_STOCK, undefined, owner);
        if (typeof result === 'string') throw new Error(`multi-kingdom genesis: ${result}`);
        villageIndexByKingdom.set(k, index(result as number));
      });
      if (placement.variance > 0.3) {
        ctx.events.publish({
          type: 'kingdom.placementUnfair',
          tick: ctx.tick,
          data: { variance: placement.variance },
        });
      }
    },
  });

  // Scouting: every kingdom (player included) reveals foreign villages within range.
  const fog = new FogRegistry(() => world.queryWordCount);
  const scoutingKingdoms: ScoutingKingdom[] = [];
  for (let k = 0; k < options.kingdomCount; k++) {
    scoutingKingdoms.push({
      kingdomIndex: k,
      villages(): { entityIndex: number; x: number; y: number }[] {
        const vi = villageIndexByKingdom.get(k);
        if (vi === undefined || !world.isAlive(vi as never)) return [];
        const core = world.read(game.comps.VillageCore);
        return [{ entityIndex: vi, x: core.centerX[vi] as number, y: core.centerY[vi] as number }];
      },
    });
  }
  registerScoutingSystem(kernel, fog, scoutingKingdoms, { extraReads: [game.comps.VillageCore] });

  // Diplomacy (M23): fog-gated gifts/insults/pacts between any two kingdoms, player included.
  const weightsOf = (k: number): PersonalityWeights => options.weightsOf?.(k) ?? DEFAULT_PERSONALITY_WEIGHTS;
  const diplomacyGame = registerDiplomacyGameplay(kernel, world, kingdomGame, {
    hasDiscovered(observerIndex: number, target: EntityId): boolean {
      const targetIndex = kingdomGame.kingdomEntities().indexOf(target);
      const targetVi = targetIndex < 0 ? undefined : villageIndexByKingdom.get(targetIndex);
      return targetVi !== undefined && fog.isKnown(observerIndex, targetVi);
    },
    personalityOf(kingdomId: EntityId): DiplomacyPersonality {
      const idx = kingdomGame.kingdomEntities().indexOf(kingdomId);
      return { diplomacyTrust: (idx < 0 ? DEFAULT_PERSONALITY_WEIGHTS : weightsOf(idx)).diplomacyTrust ?? 0.5 };
    },
  });

  const diplomacyContextFor = (kingdomIndex: number): AiDiplomacyContext => ({
    knownKingdoms(): EntityId[] {
      const out: EntityId[] = [];
      for (let other = 0; other < options.kingdomCount; other++) {
        if (other === kingdomIndex) continue;
        const otherVi = villageIndexByKingdom.get(other);
        const otherId = kingdomGame.kingdomEntities()[other];
        if (otherVi !== undefined && otherId !== undefined && fog.isKnown(kingdomIndex, otherVi)) out.push(otherId);
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
  });

  // Military (M30): fog-gated believed strength for the planner's MilitaryBuildup/ConquestWar
  // considerations, and concrete war targets for the tactical manager — same shape convention as
  // diplomacyContextFor above.
  const committedStrengthOf = (kingdomId: number): number => {
    const u = world.read(militaryGame.Unit);
    let total = 0;
    world.query([militaryGame.Unit]).forEach((ui) => {
      if ((u.kingdomId[ui] as number) === kingdomId && (u.complete[ui] as number) === 1) total += u.count[ui] as number;
    });
    return total;
  };
  const militaryContextFor = (kingdomIndex: number): AiMilitaryContext => ({
    ownStrength(): number {
      const myId = kingdomGame.kingdomEntities()[kingdomIndex];
      return myId === undefined ? 0 : committedStrengthOf(myId as number);
    },
    knownRivalStrengths(): number[] {
      const out: number[] = [];
      for (let other = 0; other < options.kingdomCount; other++) {
        if (other === kingdomIndex) continue;
        const otherVi = villageIndexByKingdom.get(other);
        const otherId = kingdomGame.kingdomEntities()[other];
        if (otherVi !== undefined && otherId !== undefined && fog.isKnown(kingdomIndex, otherVi)) {
          out.push(committedStrengthOf(otherId as number));
        }
      }
      return out;
    },
  });
  const warTargetsFor = (kingdomIndex: number): readonly AiWarTarget[] => {
    const out: AiWarTarget[] = [];
    const core = world.read(game.comps.VillageCore);
    for (let other = 0; other < options.kingdomCount; other++) {
      if (other === kingdomIndex) continue;
      const otherVi = villageIndexByKingdom.get(other);
      const otherId = kingdomGame.kingdomEntities()[other];
      if (otherVi === undefined || otherId === undefined || !fog.isKnown(kingdomIndex, otherVi)) continue;
      if (!world.isAlive(otherVi as never)) continue;
      out.push({
        kingdomId: otherId as number,
        villageId: otherVi,
        x: core.centerX[otherVi] as number,
        y: core.centerY[otherVi] as number,
        isCastle: castleGame.isCastle(otherVi),
      });
    }
    return out;
  };

  // Research (M32): diffusion discount if a DISCOVERED neighbour already knows the tech —
  // `researchGameRef` breaks the construction-order cycle (the hook needs `.isKnown`, which
  // doesn't exist until `registerResearchGameplay` returns); a boxed property (not a `let`
  // rebinding) keeps this a single, never-reassigned `const` for lint's `prefer-const`.
  const researchGameRef: { current?: ReturnType<typeof registerResearchGameplay> } = {};
  const researchGame = registerResearchGameplay(kernel, world, db, game, kingdomGame, {
    knownByNeighbor(kingdomId: EntityId, techId: string): boolean {
      const myIndex = kingdomGame.kingdomEntities().indexOf(kingdomId);
      if (myIndex < 0 || researchGameRef.current === undefined) return false;
      for (let other = 0; other < options.kingdomCount; other++) {
        if (other === myIndex) continue;
        const otherVi = villageIndexByKingdom.get(other);
        const otherId = kingdomGame.kingdomEntities()[other];
        if (otherVi === undefined || otherId === undefined || !fog.isKnown(myIndex, otherVi)) continue;
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

  // Events (M33): opinionChange reuses the same diplomacy state every other module writes to;
  // hasTech reuses the just-registered research state.
  const eventGame = registerEventGameplay(kernel, world, db, game, popGame, kingdomGame, {
    diplomacy: {
      applyOpinionDelta(kingdomId: EntityId, delta: number): void {
        const myIndex = kingdomGame.kingdomEntities().indexOf(kingdomId);
        if (myIndex < 0) return;
        for (let other = 0; other < options.kingdomCount; other++) {
          if (other === myIndex) continue;
          const otherVi = villageIndexByKingdom.get(other);
          const otherId = kingdomGame.kingdomEntities()[other];
          if (otherVi === undefined || otherId === undefined || !fog.isKnown(myIndex, otherVi)) continue;
          diplomacyGame.state.applyOpinionDelta(kingdomId as number, otherId as number, delta);
        }
      },
    },
    research: { isKnown: (kingdomId, techId) => researchGame.isKnown(kingdomId, techId) },
  });

  // AI wiring: every kingdom but the player's (index 0, issuer 1) gets a manager + planner.
  // Genesis (registered above) hasn't run yet, so each AI kingdom's village EntityId isn't
  // known at registration time. It's still safe to bind now: this composition spawns nothing
  // before genesis, and genesis spawns kingdoms/advisors/villages in a fixed order in a fresh
  // World, so each village's dense index (== its EntityId, since generation is 0 pre-despawn)
  // is deterministic. `villageIndexByKingdom` is populated by genesis on tick 1; every AI
  // system here only reads it from tick 2 onward (period TICKS_PER_DAY or *7), so it's always
  // populated by the time it's used.
  const sharedPlanState = defineAiPlanState(world);
  const aiFromIndex = options.aiFromIndex ?? 1;
  for (let k = aiFromIndex; k < options.kingdomCount; k++) {
    const managerOptions: AiConstructionOptions = {
      issuer: k + 1,
      id: String(k),
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
      diplomacy: diplomacyContextFor(k),
      military: militaryContextFor(k),
      research: researchContextFor(k),
      extraReads: [militaryGame.Unit],
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
    registerAiEventAnswering(kernel, eventGame, {
      issuer: k + 1,
      id: String(k),
      weights: weightsOf(k) as unknown as Readonly<Record<string, number | undefined>>,
      get kingdomId(): EntityId {
        return (kingdomGame.kingdomEntities()[k] ?? 0) as EntityId;
      },
    });
    registerAiMilitaryManager(kernel, world, db, game, militaryGame, armiesGame, castleGame, siegeGame, {
      issuer: k + 1,
      id: String(k),
      getPlan: () => planner.currentPlan(),
      warTargets: () => warTargetsFor(k),
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

  return {
    kernel,
    world,
    db,
    game,
    popGame,
    kingdomGame,
    diplomacyGame,
    militaryGame,
    armiesGame,
    combatGame,
    castleGame,
    siegeGame,
    researchGame,
    eventGame,
    fog,
    placement,
    villageOf: (kingdomIndex: number) => villageIndexByKingdom.get(kingdomIndex) ?? null,
  };
}
