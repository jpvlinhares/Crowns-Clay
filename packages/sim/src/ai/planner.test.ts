/**
 * AI strategic planner v1 (M21) — roadmap test objective: "plan-switch
 * stability; decision logs legible". Unit tests cover archetype utilities
 * against synthetic considerations; a hysteresis test proves small deltas
 * near a boundary don't flip the plan while a real crisis does; a
 * settler-dispatch integration test proves ExpandSettle actually founds a
 * village; a longer-horizon harness checks the decision log never thrashes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DefinitionDatabase, BASE_CONTENT_FILES } from '@crowns/data';
import { Kernel } from '../kernel.js';
import { World } from '../ecs.js';
import { TICKS_PER_DAY, TICKS_PER_YEAR } from '../time.js';
import { registerVillageGameplay, type TerrainAccessor } from '../game/villages.js';
import { registerPopulationGameplay, type StartingPopulation } from '../game/population.js';
import { registerEconomyGameplay } from '../game/economy.js';
import { registerLogisticsGameplay } from '../game/logistics.js';
import { registerSettlerGameplay } from '../game/settlers.js';
import {
  computeConsiderations,
  planAwareNeeds,
  registerAiStrategicPlanner,
  DEFAULT_PERSONALITY_WEIGHTS,
  DEFAULT_PLAN_ARCHETYPES,
  type Considerations,
  type PlanArchetype,
} from './planner.js';
import { registerAiConstructionManager } from './manager.js';
import type { NeedContext } from './needs.js';

const plain: TerrainAccessor = {
  width: 128,
  height: 128,
  tagsAt: () => ['open', 'farmable', 'mineable', 'woodland'],
  riverAt: () => false,
  movementCostAt: () => 1,
};

const GENEROUS_STOCK = { 'base:resource.wood': 4000, 'base:resource.stone': 1000, 'base:resource.food': 400 };

function makeVillage(options: { seed?: number; starting?: StartingPopulation } = {}) {
  const kernel = new Kernel(options.seed ?? 21);
  const world = new World(1024);
  const db = DefinitionDatabase.load(BASE_CONTENT_FILES);
  const game = registerVillageGameplay(kernel, world, db, plain, GENEROUS_STOCK);
  const popGame = registerPopulationGameplay(kernel, world, db, game, options.starting ?? { children: 6, adults: 15, elders: 2 });
  const econGame = registerEconomyGameplay(kernel, world, db, game);
  const Position = world.defineSoA('position', { x: 'f64', y: 'f64' });
  const logiGame = registerLogisticsGameplay(kernel, world, db, game, popGame, econGame, Position);
  const settlerGame = registerSettlerGameplay(kernel, world, db, game, popGame, econGame, logiGame, Position);
  kernel.attachGuard(world);
  kernel.addHashSource('world', (fold) => world.hash(fold));

  kernel.registerSystem({
    name: 'genesis',
    period: 0x7fffffff,
    phase: 1,
    access: {
      writes: [game.comps.VillageCore, game.comps.VillageName, game.comps.Stockpile, game.comps.BuildingCore, popGame.Population, econGame.StockLimits],
    },
    update(ctx) {
      const result = game.ops.found(ctx, 60, 60, 'Testholm', GENEROUS_STOCK);
      if (typeof result === 'string') throw new Error(result);
    },
  });

  return { kernel, world, db, game, popGame, econGame, logiGame, settlerGame };
}

function ctxFor(v: ReturnType<typeof makeVillage>, villageIndex: number): NeedContext {
  return { world: v.world, comps: v.game.comps, ops: v.game.ops, popGame: v.popGame, db: v.db, villageIndex };
}

const archetypeById = (id: string): PlanArchetype => DEFAULT_PLAN_ARCHETYPES.find((a) => a.id === id) as PlanArchetype;

// ---------------------------------------------------------------- unit tests: utilities

test('utility: DevelopHeartland rises with growthHeadroom, weighted by economy', () => {
  const low: Considerations = {
    economyStrength: 0.5, growthHeadroom: 0.1, settleReadiness: 0, crisisSignal: 0,
    allianceOpportunity: 0, militaryStrength: 0, relativeAdvantage: 0.5, researchOpportunity: 0,
  };
  const high: Considerations = { ...low, growthHeadroom: 0.9 };
  const utility = archetypeById('DevelopHeartland').utility;
  assert.ok(utility(high, DEFAULT_PERSONALITY_WEIGHTS) > utility(low, DEFAULT_PERSONALITY_WEIGHTS));
});

test('utility: ExpandSettle rises with settleReadiness and the expansion weight', () => {
  const c: Considerations = {
    economyStrength: 0.8, growthHeadroom: 0.2, settleReadiness: 0.8, crisisSignal: 0,
    allianceOpportunity: 0, militaryStrength: 0, relativeAdvantage: 0.5, researchOpportunity: 0,
  };
  const utility = archetypeById('ExpandSettle').utility;
  const lowExpansion = utility(c, { ...DEFAULT_PERSONALITY_WEIGHTS, expansion: 0.1 });
  const highExpansion = utility(c, { ...DEFAULT_PERSONALITY_WEIGHTS, expansion: 0.9 });
  assert.ok(highExpansion > lowExpansion);
});

test('utility: Recover is a hard 1 under crisis, 0 otherwise', () => {
  const utility = archetypeById('Recover').utility;
  const neutral = { militaryStrength: 0, relativeAdvantage: 0.5, researchOpportunity: 0 } as const;
  assert.equal(utility({ economyStrength: 0.9, growthHeadroom: 0.1, settleReadiness: 0.5, crisisSignal: 0, allianceOpportunity: 0, ...neutral }, DEFAULT_PERSONALITY_WEIGHTS), 0);
  assert.equal(utility({ economyStrength: 0.1, growthHeadroom: 0.9, settleReadiness: 0, crisisSignal: 1, allianceOpportunity: 0, ...neutral }, DEFAULT_PERSONALITY_WEIGHTS), 1);
});

test('utility: TechRace rises with researchOpportunity and the tech weight; inert without a research context', () => {
  const c: Considerations = {
    economyStrength: 0.8, growthHeadroom: 0.2, settleReadiness: 0, crisisSignal: 0,
    allianceOpportunity: 0, militaryStrength: 0, relativeAdvantage: 0.5, researchOpportunity: 0.9,
  };
  const utility = archetypeById('TechRace').utility;
  const lowTech = utility(c, { ...DEFAULT_PERSONALITY_WEIGHTS, tech: 0.1 });
  const highTech = utility(c, { ...DEFAULT_PERSONALITY_WEIGHTS, tech: 0.9 });
  assert.ok(highTech > lowTech);
  assert.equal(utility({ ...c, researchOpportunity: 0 }, DEFAULT_PERSONALITY_WEIGHTS), 0);
});

test('considerations: a fresh, well-stocked, empty village is not in crisis', () => {
  const v = makeVillage();
  v.kernel.step(); // genesis founds the village (phase 1, huge period)
  const c = computeConsiderations(ctxFor(v, 0), v.popGame);
  assert.equal(c.crisisSignal, 0); // full stockpile + foodSecurity 1.0, despite zero buildings
  assert.ok(c.growthHeadroom > 0.9); // still nothing built
});

// ---------------------------------------------------------------- hysteresis

test('hysteresis: a small utility delta near a boundary does not switch plans', () => {
  const v = makeVillage();
  const planner = registerAiStrategicPlanner(v.kernel, v.world, v.db, v.game, v.popGame, { issuer: 998, villageId: 0 as never });
  v.kernel.step(); // genesis
  v.kernel.step(); // arbitrary settle tick

  // Force the current plan to DevelopHeartland by running one week with defaults.
  for (let i = 0; i < TICKS_PER_DAY * 7; i++) v.kernel.step();
  const firstPlan = planner.currentPlan();

  // Run several more weeks under near-identical (still empty) conditions —
  // scores barely move week to week, so the plan should not thrash.
  for (let week = 0; week < 5; week++) {
    for (let i = 0; i < TICKS_PER_DAY * 7; i++) v.kernel.step();
    assert.equal(planner.currentPlan(), firstPlan, `plan changed unexpectedly in week ${week}`);
  }
});

test('hysteresis: an induced famine switches the plan to Recover', () => {
  const v = makeVillage();
  const planner = registerAiStrategicPlanner(v.kernel, v.world, v.db, v.game, v.popGame, { issuer: 998, villageId: 0 as never });
  v.kernel.step(); // genesis

  // Starve the village directly: drain the food stockpile to zero.
  const stock = v.world.writeObj(v.game.comps.Stockpile).get(0);
  stock.set(v.game.ops.resourceCode('base:resource.food') as number, 0);

  for (let i = 0; i < TICKS_PER_DAY * 30; i++) v.kernel.step(); // ~a month of starvation
  assert.equal(planner.currentPlan(), 'Recover');
});

// ---------------------------------------------------------------- settler dispatch

test('ExpandSettle: a prosperous, populous village actually dispatches settlers', () => {
  const v = makeVillage({ starting: { children: 10, adults: 40, elders: 5 } });
  const planner = registerAiStrategicPlanner(v.kernel, v.world, v.db, v.game, v.popGame, {
    issuer: 998,
    villageId: 0 as never,
    weights: { expansion: 1, economy: 0.2, riskTolerance: 1 },
  });
  // Realistic pairing: without construction, growthHeadroom never shrinks
  // (no houses/farms ever get built), so DevelopHeartland keeps its
  // hysteresis-bonused lead forever — the construction manager is what lets
  // growthHeadroom fall as the village fills in, which is what lets
  // ExpandSettle's utility overtake it.
  registerAiConstructionManager(v.kernel, v.world, v.db, v.game, v.popGame, {
    issuer: 999,
    villageId: 0 as never,
    needs: planAwareNeeds(() => planner.currentPlan()),
    extraReads: [planner.AiPlanState],
  });
  v.kernel.step(); // genesis

  let dispatched = false;
  v.kernel.subscribe('settlers.dispatched', () => {
    dispatched = true;
  });

  for (let week = 0; week < 20 && !dispatched; week++) {
    for (let i = 0; i < TICKS_PER_DAY * 7; i++) v.kernel.step();
  }

  assert.ok(dispatched, 'expected a village.sendSettlers dispatch within 20 weeks');
});

// ---------------------------------------------------------------- longer-horizon harness

test('harness: decision log is coherent and never thrashes over several years', () => {
  const v = makeVillage();
  const planner = registerAiStrategicPlanner(v.kernel, v.world, v.db, v.game, v.popGame, { issuer: 998, villageId: 0 as never });
  registerAiConstructionManager(v.kernel, v.world, v.db, v.game, v.popGame, {
    issuer: 999,
    villageId: 0 as never,
    needs: planAwareNeeds(() => planner.currentPlan()),
    extraReads: [planner.AiPlanState],
  });
  v.kernel.step(); // genesis

  const decisions: { tick: number; chosenPlan: string }[] = [];
  v.kernel.subscribe<{ villageId: number; chosenPlan: string; previousPlan: string; scores: Record<string, number> }>(
    'ai.planChosen',
    (e) => decisions.push({ tick: e.tick, chosenPlan: e.data.chosenPlan }),
  );

  for (let i = 0; i < TICKS_PER_YEAR * 3; i++) v.kernel.step();

  assert.ok(decisions.length > 0);
  assert.equal(decisions[0]?.chosenPlan, 'DevelopHeartland');

  // No plan should revert within any 3-consecutive-week window (thrash check).
  for (let i = 2; i < decisions.length; i++) {
    const a = decisions[i - 2]?.chosenPlan;
    const b = decisions[i - 1]?.chosenPlan;
    const c = decisions[i]?.chosenPlan;
    if (a === c && a !== b) {
      assert.fail(`plan thrashed: ${a} -> ${b} -> ${c} around tick ${decisions[i]?.tick}`);
    }
  }
});
