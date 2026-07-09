/**
 * AI construction manager (M20) — roadmap test objective: "harness: AI
 * village survives 20 years unaided". Unit tests cover need evaluators and
 * build-target selection against synthetic villages; the harness test
 * founds one village with zero starting buildings and steps the kernel for
 * 172,800 ticks (20 years) with only the AI manager driving construction.
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
import { detectNeeds, foodNeed, type NeedContext } from './needs.js';
import { chooseBuildTarget, registerAiConstructionManager } from './manager.js';

const plain: TerrainAccessor = {
  width: 64,
  height: 64,
  tagsAt: () => ['open', 'farmable', 'mineable', 'woodland'],
  riverAt: () => false,
  movementCostAt: () => 1,
};

const GENEROUS_STOCK = { 'base:resource.wood': 2000, 'base:resource.stone': 500, 'base:resource.food': 200 };

function makeVillage(options: { seed?: number; starting?: StartingPopulation } = {}) {
  const kernel = new Kernel(options.seed ?? 11);
  const world = new World(512);
  const db = DefinitionDatabase.load(BASE_CONTENT_FILES);
  const game = registerVillageGameplay(kernel, world, db, plain, GENEROUS_STOCK);
  const popGame = registerPopulationGameplay(kernel, world, db, game, options.starting ?? { children: 6, adults: 15, elders: 2 });
  const econGame = registerEconomyGameplay(kernel, world, db, game);
  const Position = world.defineSoA('position', { x: 'f64', y: 'f64' });
  registerLogisticsGameplay(kernel, world, db, game, popGame, econGame, Position);
  kernel.attachGuard(world);
  kernel.addHashSource('world', (fold) => world.hash(fold));

  kernel.registerSystem({
    name: 'genesis',
    period: 0x7fffffff,
    phase: 1,
    access: {
      writes: [
        game.comps.VillageCore, game.comps.VillageName, game.comps.Stockpile, game.comps.BuildingCore,
        popGame.Population, econGame.StockLimits,
      ],
    },
    update(ctx) {
      const result = game.ops.found(ctx, 30, 30, 'Testholm', GENEROUS_STOCK);
      if (typeof result === 'string') throw new Error(result);
    },
  });

  return { kernel, world, db, game, popGame, econGame };
}

function ctxFor(v: ReturnType<typeof makeVillage>, villageIndex: number): NeedContext {
  return { world: v.world, comps: v.game.comps, ops: v.game.ops, popGame: v.popGame, db: v.db, villageIndex };
}

// ---------------------------------------------------------------- unit tests

test('needs: an empty village needs both food and housing', () => {
  const v = makeVillage();
  v.kernel.step(); // genesis founds the village
  let villageId = -1;
  v.world.query([v.popGame.Population]).forEach((_i, entity) => (villageId = entity as number));
  const vi = villageId & 0x3fffff;

  const needs = detectNeeds(ctxFor(v, vi));
  const food = needs.find((n) => n.kind === 'food');
  const housing = needs.find((n) => n.kind === 'housing');
  assert.ok(food !== undefined && food.ratio < 1);
  assert.ok(housing !== undefined && housing.ratio < 1);
});

test('needs: ratio reaches >= 1 once capacity meets the slack-buffered target', () => {
  const v = makeVillage({ starting: { children: 0, adults: 5, elders: 0 } });
  v.kernel.step();
  let villageId = -1;
  v.world.query([v.popGame.Population]).forEach((_i, entity) => (villageId = entity as number));
  const vi = villageId & 0x3fffff;

  // 5 people need 5*0.1*1.1 = 0.55 food/day — one farm (8/day) covers it.
  v.kernel.submit({ type: 'village.build', issuer: 1, payload: { villageId, def: 'base:building.farm', x: 32, y: 32 } });
  v.kernel.step();
  const b = v.world.write(v.game.comps.BuildingCore);
  v.world.query([v.game.comps.BuildingCore]).forEach((i) => {
    b.complete[i] = 1; // force-complete for this unit test (construction ticks are covered by the harness test)
  });

  const need = foodNeed(ctxFor(v, vi));
  assert.ok(need !== null && need.ratio >= 1);
});

test('chooseBuildTarget: picks the most under-provisioned need with a placeable candidate', () => {
  const v = makeVillage();
  v.kernel.step();
  let villageId = -1;
  v.world.query([v.popGame.Population]).forEach((_i, entity) => (villageId = entity as number));
  const vi = villageId & 0x3fffff;
  const core = v.world.read(v.game.comps.VillageCore);

  const needs = detectNeeds(ctxFor(v, vi));
  const intent = chooseBuildTarget(needs, v.world, v.db, v.game, villageId as never, vi, core.centerX[vi] as number, core.centerY[vi] as number, 12);
  assert.ok(intent !== null);
  assert.ok(intent.def === 'base:building.farm' || intent.def === 'base:building.house');
});

test('chooseBuildTarget: anti-churn — does not re-queue a def already under construction', () => {
  const v = makeVillage();
  v.kernel.step();
  let villageId = -1;
  v.world.query([v.popGame.Population]).forEach((_i, entity) => (villageId = entity as number));
  const vi = villageId & 0x3fffff;
  const core = v.world.read(v.game.comps.VillageCore);
  const centerX = core.centerX[vi] as number;
  const centerY = core.centerY[vi] as number;

  const needs = detectNeeds(ctxFor(v, vi));
  const first = chooseBuildTarget(needs, v.world, v.db, v.game, villageId as never, vi, centerX, centerY, 12);
  assert.ok(first !== null);
  v.kernel.submit({ type: 'village.build', issuer: 1, payload: { villageId, def: first.def, x: first.x, y: first.y } });
  v.kernel.step();

  const second = chooseBuildTarget(needs, v.world, v.db, v.game, villageId as never, vi, centerX, centerY, 12);
  assert.ok(second === null || second.def !== first.def);
});

// ---------------------------------------------------------------- harness

test('harness: AI village survives 20 years unaided', () => {
  const v = makeVillage();
  // Systems must be registered before the first step(), but the village
  // entity doesn't exist until genesis runs. It's still safe to bind here:
  // genesis is the very first spawn in a fresh World (EntityAllocator hands
  // out index 0, generation 0 to the first-ever spawn — core/ids.ts), so
  // the village's EntityId is deterministically 0.
  const villageId = 0 as never;
  registerAiConstructionManager(v.kernel, v.world, v.db, v.game, v.popGame, { issuer: 999, villageId });
  v.kernel.step(); // tick 1: genesis founds the village (phase 1, huge period)

  assert.ok(v.world.isAlive(villageId));

  let minPopulation = Infinity;
  const YEARS = 20;
  for (let i = 0; i < YEARS * TICKS_PER_YEAR; i++) {
    v.kernel.step();
    if (i % TICKS_PER_DAY === 0) {
      const pop = v.popGame.totalOf(0); // village index === entity id 0 (see above)
      minPopulation = Math.min(minPopulation, pop);
    }
  }

  const finalPopulation = v.popGame.totalOf(0);
  assert.ok(finalPopulation > 0, `village died out (min population observed: ${minPopulation})`);
  assert.ok(minPopulation > 0, 'village population hit zero at some point during the 20-year run');
});
