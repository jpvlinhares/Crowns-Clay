/**
 * Logistics (M14) — the roadmap test objective is "haul throughput bench; no
 * starvation w/ roads" (doc 12): hauling is load-bearing (goods only reach the
 * table by cart), roads raise throughput enough to feed a village its
 * cart-limited food supply, the path service prefers paved ground and its
 * route cache invalidates on road changes, and the whole thing stays
 * deterministic. The wall-clock half of the bench lives in
 * `packages/tools/bench-haul.ts` (doc 11 §2: 1,200 active haul jobs).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DefinitionDatabase, BASE_CONTENT_FILES } from '@crowns/data';
import { Kernel } from '../kernel.js';
import { World } from '../ecs.js';
import { TICKS_PER_DAY } from '../time.js';
import { registerVillageGameplay, type TerrainAccessor } from './villages.js';
import { registerPopulationGameplay, FORAGE_FLOOR, type StartingPopulation } from './population.js';
import { registerEconomyGameplay } from './economy.js';
import { registerLogisticsGameplay, PathService, RoadGrid, ROAD_SPEED } from './logistics.js';

/** Open plain with one impassable river column at x = 45. */
const plain: TerrainAccessor = {
  width: 64,
  height: 64,
  tagsAt: () => ['open', 'farmable', 'mineable', 'woodland'],
  riverAt: (x) => x === 45,
  movementCostAt: (x) => (x === 45 ? 0 : 1),
};

const DEFAULT_POP: StartingPopulation = { children: 12, adults: 30, elders: 5 };

function makeVillage(options: {
  haulerTarget?: number;
  food?: number;
  stone?: number;
  pop?: StartingPopulation;
  buildings?: { def: string; x: number; y: number }[];
  roadTo?: { x: number; y: number }[];
} = {}) {
  const kernel = new Kernel(11);
  const world = new World(512);
  const db = DefinitionDatabase.load(BASE_CONTENT_FILES);
  const stock = {
    'base:resource.wood': 500,
    'base:resource.stone': options.stone ?? 300,
    'base:resource.food': options.food ?? 100,
  };
  const game = registerVillageGameplay(kernel, world, db, plain, stock);
  const popGame = registerPopulationGameplay(kernel, world, db, game, options.pop ?? DEFAULT_POP);
  const econ = registerEconomyGameplay(kernel, world, db, game);
  const Position = world.defineSoA('position', { x: 'f64', y: 'f64' });
  const logi = registerLogisticsGameplay(kernel, world, db, game, popGame, econ, Position, {
    haulerTarget: options.haulerTarget ?? 4,
  });
  kernel.attachGuard(world);
  kernel.addHashSource('world', (fold) => world.hash(fold));

  const rejections: string[] = [];
  kernel.subscribe<{ what: string; reason: string }>('village.rejected', (e) => {
    rejections.push(`${e.data.what}: ${e.data.reason}`);
  });

  const submit = (type: string, payload: unknown): void => {
    kernel.submit({ type, issuer: 1, payload });
    kernel.step();
  };
  submit('village.found', { x: 30, y: 30, name: 'Cartholm' });
  let villageId = -1;
  world.query([popGame.Population]).forEach((_i, entity) => (villageId = entity as number));
  assert.ok(villageId >= 0, 'village founded');
  const vi = villageId & 0x3fffff;

  for (const b of options.buildings ?? []) {
    submit('village.build', { villageId, def: b.def, x: b.x, y: b.y });
  }
  // pave straight-line roads centre → each waypoint (same rulebook as players)
  for (const target of options.roadTo ?? []) {
    const route = logi.paths.route(30, 30, target.x, target.y) ?? [];
    for (const tile of route) {
      submit('village.buildRoad', { villageId, x: tile % plain.width, y: Math.floor(tile / plain.width) });
    }
  }

  const days = (n: number): void => {
    for (let t = 0; t < n * TICKS_PER_DAY; t++) kernel.step();
  };
  const code = (id: string): number => game.ops.resourceCode(id) as number;
  const stockOf = (c: number): number => world.readObj(game.comps.Stockpile).get(vi).get(c) ?? 0;
  const security = (): number => {
    const p = world.read(popGame.Population);
    return p.foodSecurity[vi] as number;
  };
  const haulerCount = (): number => {
    let n = 0;
    world.query([logi.Hauler]).forEach(() => n++);
    return n;
  };

  return { kernel, world, db, game, popGame, econ, logi, villageId, vi, days, submit, code, stockOf, security, haulerCount, rejections };
}

// ---------------- hauling is load-bearing ----------------

test('haul: without haulers, food rots at the farm and the village starves', () => {
  const distantFarms = [
    { def: 'base:building.farm', x: 41, y: 29 },
    { def: 'base:building.farm', x: 41, y: 32 },
  ];
  const carted = makeVillage({ haulerTarget: 4, food: 60, buildings: distantFarms });
  const stranded = makeVillage({ haulerTarget: 0, food: 60, buildings: distantFarms });
  carted.days(60);
  stranded.days(60);
  // same farms, same production capacity — only the carts differ
  assert.ok(carted.security() > 0.95, `carted village fed (security ${carted.security().toFixed(2)})`);
  assert.ok(
    stranded.security() <= FORAGE_FLOOR + 0.05,
    `stranded village pinned at the forage floor (security ${stranded.security().toFixed(2)})`,
  );
  // and the stranded farm STALLED once its outbox filled (nothing hauls it away)
  const foodCode = stranded.code('base:resource.food');
  assert.equal(stranded.stockOf(foodCode), 0, 'no food ever reached the stranded stockpile');
});

// ---------------- the T objective: no starvation with roads ----------------

test('roads: a cart-limited village starves on mud and eats on pavement', () => {
  // 120 mouths eat 12/day; two distant farms make 16/day; ONE hauler carries
  // 10 food/trip over ~11 tiles — mud throughput ~10/day loses, road ~15 wins
  const pop: StartingPopulation = { children: 30, adults: 80, elders: 10 };
  const farms = [
    { def: 'base:building.farm', x: 41, y: 29 },
    { def: 'base:building.farm', x: 41, y: 32 },
  ];
  const mud = makeVillage({ haulerTarget: 1, pop, food: 150, buildings: farms });
  const paved = makeVillage({
    haulerTarget: 1, pop, food: 150, buildings: farms,
    roadTo: [{ x: 41, y: 29 }, { x: 41, y: 32 }],
  });
  mud.days(90);
  paved.days(90);
  assert.ok(paved.security() > 0.95, `paved village never starves (security ${paved.security().toFixed(2)})`);
  assert.ok(mud.security() < 0.9, `mud village cannot keep up (security ${mud.security().toFixed(2)})`);
});

// ---------------- roads: command, cost, rejections ----------------

test('roads: paving costs stone through the ledger; bad tiles are rejected by name', () => {
  const v = makeVillage();
  const stoneCode = v.code('base:resource.stone');
  const before = v.stockOf(stoneCode);
  v.econ.ledger.drain();
  v.submit('village.buildRoad', { villageId: v.villageId, x: 35, y: 30 });
  assert.equal(v.stockOf(stoneCode), before - 1, 'a road tile costs 1 stone');
  assert.ok((v.econ.ledger.of(v.vi).get(stoneCode)?.built ?? 0) >= 1, 'the ledger saw the spend');
  assert.equal(v.logi.roads.levelAt(35, 30), 1);

  v.submit('village.buildRoad', { villageId: v.villageId, x: 35, y: 30 });
  assert.ok(v.rejections.some((r) => r.includes('road already present')), 'no double paving');
  v.submit('village.buildRoad', { villageId: v.villageId, x: 45, y: 30 });
  assert.ok(v.rejections.some((r) => r.includes('impassable')), 'rivers refuse pavement');
  v.submit('village.buildRoad', { villageId: v.villageId, x: 30, y: 30 });
  assert.ok(v.rejections.some((r) => r.includes('occupied')), 'building footprints refuse pavement');
});

// ---------------- path service & route cache ----------------

test('paths: roads cut travel cost and the route cache invalidates on change', () => {
  const roads = new RoadGrid(plain.width, plain.height);
  const paths = new PathService(plain, roads);
  const cost = (route: number[]): number =>
    route.reduce((sum, tile) => sum + paths.stepCost(tile % plain.width, Math.floor(tile / plain.width)), 0);

  const muddy = paths.route(10, 10, 20, 10);
  assert.ok(muddy !== null && muddy.length === 10, 'straight line on open plain');
  const muddyCost = cost(muddy);
  assert.ok(Math.abs(muddyCost - 10) < 1e-9, 'plain tiles cost 1 each');

  for (let x = 11; x <= 20; x++) roads.set(x, 10, 1); // pave the same line
  const pavedRoute = paths.route(10, 10, 20, 10);
  assert.ok(pavedRoute !== null);
  const pavedCost = cost(pavedRoute);
  assert.ok(Math.abs(pavedCost - 10 / ROAD_SPEED(1)) < 1e-9, `cache refreshed: cost ${pavedCost.toFixed(2)} at road speed`);

  // rivers block: the column at x=45 is impassable, so cross-river routes detour or fail
  assert.equal(paths.route(44, 0, 46, 0), null, 'no route across the river wall');
});

// ---------------- staffing follows the jobs solver ----------------

test('staffing: hauler entities mirror the population slot, and layoffs conserve cargo', () => {
  const v = makeVillage({ haulerTarget: 4, buildings: [{ def: 'base:building.farm', x: 35, y: 29 }] });
  v.days(2);
  assert.equal(v.haulerCount(), 4, 'four haulers on staff');
  const foodCode = v.code('base:resource.food');
  const totalBefore = v.logi.totalOf(v.vi, foodCode);
  // the village empties: every hauler is laid off, any carried food lands in the stockpile
  const p = v.world.write(v.popGame.Population);
  p.adults[v.vi] = 0;
  p.children[v.vi] = 0;
  p.elders[v.vi] = 0;
  v.days(1);
  assert.equal(v.haulerCount(), 0, 'no adults, no haulers');
  const totalAfter = v.logi.totalOf(v.vi, foodCode);
  // nobody ate (pop 0) — spoilage is the only sink, so totals only decayed
  assert.ok(totalAfter <= totalBefore && totalAfter > totalBefore * 0.9, 'cargo conserved through layoffs');
});

// ---------------- determinism ----------------

test('logistics: identical histories hash identically (roads in the hash)', () => {
  const run = (): number => {
    const v = makeVillage({
      haulerTarget: 3,
      buildings: [
        { def: 'base:building.farm', x: 40, y: 29 },
        { def: 'base:building.sawmill', x: 26, y: 36 },
      ],
      roadTo: [{ x: 40, y: 29 }],
    });
    v.days(45);
    return v.kernel.stateHash();
  };
  assert.equal(run(), run());
});
