/**
 * Economy-depth need evaluators (M-era, needs.ts): the granary/quarry/service
 * evaluators that grew the AI's build list past food+housing so an AI capital
 * actually develops. Each is a pure `(ctx) => need | null`, unit-tested against
 * a synthetic village with buildings force-completed (construction ticks are
 * the harness test's job, manager.test.ts).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DefinitionDatabase, BASE_CONTENT_FILES } from '@crowns/data';
import { Kernel } from '../kernel.js';
import { World } from '../ecs.js';
import { registerVillageGameplay, type TerrainAccessor } from '../game/villages.js';
import { registerPopulationGameplay, type StartingPopulation } from '../game/population.js';
import { registerEconomyGameplay } from '../game/economy.js';
import { registerLogisticsGameplay } from '../game/logistics.js';
import {
  storageNeed,
  stoneNeed,
  serviceNeed,
  STONE_MIN_POP,
  STONE_NEED_RATIO,
  SERVICE_MIN_POP,
  STORAGE_MIN_POP,
  type NeedContext,
} from './needs.js';

const plain: TerrainAccessor = {
  width: 64,
  height: 64,
  tagsAt: () => ['open', 'farmable', 'mineable', 'woodland'],
  riverAt: () => false,
  movementCostAt: () => 1,
};

const STOCK = { 'base:resource.wood': 2000, 'base:resource.stone': 500, 'base:resource.food': 200 };

function makeVillage(starting: StartingPopulation) {
  const kernel = new Kernel(11);
  const world = new World(512);
  const db = DefinitionDatabase.load(BASE_CONTENT_FILES);
  const game = registerVillageGameplay(kernel, world, db, plain, STOCK);
  const popGame = registerPopulationGameplay(kernel, world, db, game, starting);
  const econGame = registerEconomyGameplay(kernel, world, db, game);
  const Position = world.defineSoA('position', { x: 'f64', y: 'f64' });
  registerLogisticsGameplay(kernel, world, db, game, popGame, econGame, Position);
  kernel.attachGuard(world);

  kernel.registerSystem({
    name: 'genesis',
    period: 0x7fffffff,
    phase: 1,
    access: { writes: [game.comps.VillageCore, game.comps.VillageName, game.comps.Stockpile, game.comps.BuildingCore, popGame.Population, econGame.StockLimits] },
    update(ctx) {
      const result = game.ops.found(ctx, 30, 30, 'Testholm', STOCK);
      if (typeof result === 'string') throw new Error(result);
    },
  });
  kernel.step(); // genesis founds the village (entity id 0)

  const vi = 0;
  const ctx: NeedContext = { world, comps: game.comps, ops: game.ops, popGame, db, villageIndex: vi };
  const buildComplete = (defId: string): void => {
    kernel.submit({ type: 'village.build', issuer: 1, payload: { villageId: 0, def: defId, x: 32, y: 32 } });
    kernel.step();
    const b = world.write(game.comps.BuildingCore);
    world.query([game.comps.BuildingCore]).forEach((i) => {
      if ((game.ops.buildingDef(b.def[i] as number).id === defId)) b.complete[i] = 1;
    });
  };
  const setStock = (resId: string, amount: number): void => {
    const stock = world.writeObj(game.comps.Stockpile).tryGet(vi);
    assert.ok(stock !== undefined);
    stock.set(game.ops.resourceCode(resId) as number, amount);
  };
  const setHappiness = (value: number): void => {
    world.write(popGame.Population).happiness[vi] = value;
  };
  return { kernel, world, db, game, popGame, ctx, buildComplete, setStock, setHappiness };
}

// ---------------------------------------------------------------- stoneNeed

test('stoneNeed: a stoneless village wants a quarry at the fixed early ratio', () => {
  const v = makeVillage({ children: 4, adults: STONE_MIN_POP, elders: 0 });
  const need = stoneNeed(v.ctx);
  assert.ok(need !== null);
  assert.equal(need.ratio, STONE_NEED_RATIO);
  assert.deepEqual(need.candidates, ['base:building.quarry']);
});

test('stoneNeed: fires regardless of how much stone is stockpiled (income, not reserve)', () => {
  const v = makeVillage({ children: 4, adults: STONE_MIN_POP, elders: 0 });
  v.setStock('base:resource.stone', 9999); // a fat pile does NOT satisfy the need — it never refills
  const need = stoneNeed(v.ctx);
  assert.ok(need !== null && need.ratio === STONE_NEED_RATIO);
});

test('stoneNeed: silent below the population floor and once a quarry exists', () => {
  const tiny = makeVillage({ children: 0, adults: STONE_MIN_POP - 1, elders: 0 });
  assert.equal(stoneNeed(tiny.ctx), null, 'below population floor');

  const v = makeVillage({ children: 4, adults: STONE_MIN_POP, elders: 0 });
  v.buildComplete('base:building.quarry');
  assert.equal(stoneNeed(v.ctx), null, 'already mines stone');
});

// ---------------------------------------------------------------- storageNeed

test('storageNeed: wants a granary once a good passes its storage cap fraction', () => {
  const v = makeVillage({ children: 4, adults: STORAGE_MIN_POP, elders: 0 });
  v.setStock('base:resource.wood', 10); // drain the generous starting pile below any cap fraction
  v.setStock('base:resource.stone', 10);
  v.setStock('base:resource.food', 10);
  assert.equal(storageNeed(v.ctx), null, 'ample headroom — no granary yet');
  v.setStock('base:resource.stone', 190); // > 0.85 * BASE_STORAGE(200) = 170
  const need = storageNeed(v.ctx);
  assert.ok(need !== null);
  assert.deepEqual(need.candidates, ['base:building.granary']);
  assert.ok(need.ratio < 1);
});

test('storageNeed: silent below the population floor', () => {
  const v = makeVillage({ children: 0, adults: STORAGE_MIN_POP - 1, elders: 0 });
  v.setStock('base:resource.stone', 190);
  assert.equal(storageNeed(v.ctx), null);
});

// ---------------------------------------------------------------- serviceNeed

test('serviceNeed: wants well then tavern while happiness sits below target', () => {
  const v = makeVillage({ children: 5, adults: SERVICE_MIN_POP, elders: 0 });
  v.setHappiness(50); // below SERVICE_TARGET (65)
  const first = serviceNeed(v.ctx);
  assert.ok(first !== null);
  assert.deepEqual(first.candidates, ['base:building.well', 'base:building.tavern']);

  v.buildComplete('base:building.well');
  const second = serviceNeed(v.ctx);
  assert.ok(second !== null);
  assert.deepEqual(second.candidates, ['base:building.tavern'], 'well built — only the tavern remains');
});

test('serviceNeed: satisfied once happiness reaches the comfort target', () => {
  const v = makeVillage({ children: 5, adults: SERVICE_MIN_POP, elders: 0 });
  v.setHappiness(80);
  assert.equal(serviceNeed(v.ctx), null);
});
