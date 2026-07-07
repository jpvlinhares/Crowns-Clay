/**
 * Production chains (M13) — the conservation invariant is the milestone's
 * test objective (roadmap doc 12; doc 08 §4; TDD §13): every unit of resource
 * produced, consumed, eaten, spoiled, or spent on construction reconciles
 * against stockpile deltas over ANY tick window, under fuzzed compositions
 * and mid-run commands. Plus: the 3-tier chain works end to end, spoilage
 * follows ResourceDef.decay exactly, and stock limits clamp without waste.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Rng } from '@crowns/core';
import { DefinitionDatabase, BASE_CONTENT_FILES } from '@crowns/data';
import { Kernel } from '../kernel.js';
import { World } from '../ecs.js';
import { TICKS_PER_DAY } from '../time.js';
import { registerVillageGameplay, type TerrainAccessor } from './villages.js';
import { registerPopulationGameplay } from './population.js';
import { registerEconomyGameplay, BASE_STORAGE, type ResourceFlows } from './economy.js';
import { registerLogisticsGameplay } from './logistics.js';

const plain: TerrainAccessor = {
  width: 64,
  height: 64,
  tagsAt: () => ['open', 'farmable', 'mineable', 'woodland'],
  riverAt: () => false,
  movementCostAt: () => 1,
};

const START_POP = { children: 12, adults: 30, elders: 5 };

function makeEconomy(options: { food?: number; wood?: number; stone?: number; buildings?: string[]; seed?: number } = {}) {
  const kernel = new Kernel(options.seed ?? 7);
  const world = new World(256);
  const db = DefinitionDatabase.load(BASE_CONTENT_FILES);
  const stock = {
    'base:resource.wood': options.wood ?? 500,
    'base:resource.stone': options.stone ?? 200,
    'base:resource.food': options.food ?? 200,
  };
  const game = registerVillageGameplay(kernel, world, db, plain, stock);
  const popGame = registerPopulationGameplay(kernel, world, db, game, START_POP);
  const econ = registerEconomyGameplay(kernel, world, db, game);
  const Position = world.defineSoA('position', { x: 'f64', y: 'f64' });
  const logi = registerLogisticsGameplay(kernel, world, db, game, popGame, econ, Position);
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
  submit('village.found', { x: 30, y: 30, name: 'Ledgerton' });
  let villageId = -1;
  world.query([popGame.Population]).forEach((_i, entity) => (villageId = entity as number));
  assert.ok(villageId >= 0, 'village founded');
  const vi = villageId & 0x3fffff;

  const placeNear = (defId: string): void => {
    const def = db.buildings.get(defId);
    assert.ok(def !== undefined);
    for (let r = 2; r <= 11; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          if (!game.ops.validatePlacement(def, 30 + dx, 30 + dy, villageId as never).ok) continue;
          submit('village.build', { villageId, def: defId, x: 30 + dx, y: 30 + dy });
          return;
        }
      }
    }
    assert.fail(`no valid spot for ${defId}`);
  };
  for (const defId of options.buildings ?? []) placeNear(defId);

  const days = (n: number): void => {
    for (let t = 0; t < n * TICKS_PER_DAY; t++) kernel.step();
  };
  const code = (id: string): number => game.ops.resourceCode(id) as number;
  const stockOf = (resourceCode: number): number =>
    world.readObj(game.comps.Stockpile).get(vi).get(resourceCode) ?? 0;
  /** Village-total per resource: stockpile + building inventories + hauler carry (M14). */
  const totalSnapshot = (): Map<number, number> => {
    const out = new Map<number, number>();
    for (const id of db.resources.keys()) {
      const c = code(id);
      out.set(c, logi.totalOf(vi, c));
    }
    return out;
  };

  return { kernel, world, db, game, popGame, econ, logi, villageId, vi, days, submit, placeNear, code, stockOf, totalSnapshot, rejections };
}

/** Δstock must equal produced − consumed − eaten − spoiled − built, per resource. */
function assertReconciles(
  before: Map<number, number>,
  after: Map<number, number>,
  flows: ReadonlyMap<number, ResourceFlows>,
  label: string,
): void {
  const codes = new Set([...before.keys(), ...after.keys(), ...flows.keys()]);
  for (const code of codes) {
    const delta = (after.get(code) ?? 0) - (before.get(code) ?? 0);
    const f = flows.get(code) ?? { produced: 0, consumed: 0, eaten: 0, spoiled: 0, built: 0 };
    const explained = f.produced - f.consumed - f.eaten - f.spoiled - f.built;
    assert.ok(
      Math.abs(delta - explained) < 1e-6,
      `${label}: resource ${code} delta ${delta} ≠ ledger ${explained} ` +
        `(p ${f.produced} c ${f.consumed} e ${f.eaten} s ${f.spoiled} b ${f.built})`,
    );
    assert.ok((after.get(code) ?? 0) > -1e-9, `${label}: resource ${code} went negative`);
  }
}

// ---------------- the 3-tier chain ----------------

test('chain: wood → planks → tools across all three tiers', () => {
  const v = makeEconomy({ wood: 600, buildings: ['base:building.sawmill', 'base:building.workshop'] });
  // the content set really spans the tiers (GDD §3 cap: exactly three)
  assert.equal(v.db.resources.get('base:resource.wood')?.tier, 'raw');
  assert.equal(v.db.resources.get('base:resource.planks')?.tier, 'processed');
  assert.equal(v.db.resources.get('base:resource.tools')?.tier, 'finished');

  v.days(20); // build out, then convert
  const planks = v.stockOf(v.code('base:resource.planks'));
  const tools = v.stockOf(v.code('base:resource.tools'));
  assert.ok(planks > 0, 'sawmill produced planks');
  assert.ok(tools > 1, `workshop produced tools (got ${tools.toFixed(2)})`);

  // recipe ratios hold exactly in the ledger: 6 wood → 4 planks; 3 planks + 1 stone → 2 tools
  const flows = v.econ.ledger.of(v.vi);
  const woodConsumed = flows.get(v.code('base:resource.wood'))?.consumed ?? 0;
  const planksMade = flows.get(v.code('base:resource.planks'))?.produced ?? 0;
  const planksUsed = flows.get(v.code('base:resource.planks'))?.consumed ?? 0;
  const toolsMade = flows.get(v.code('base:resource.tools'))?.produced ?? 0;
  assert.ok(Math.abs(woodConsumed / planksMade - 6 / 4) < 1e-9, 'sawmill ratio conserved');
  assert.ok(Math.abs(planksUsed / toolsMade - 3 / 2) < 1e-9, 'workshop ratio conserved');
});

test('chain: a starved recipe consumes nothing — no inputs vanish without outputs', () => {
  // workshop with NO sawmill: planks never exist, so stone must not be consumed
  // either — haulers may MOVE stone into the workshop's buffer, never destroy it
  const v = makeEconomy({ buildings: ['base:building.workshop'] });
  v.days(5); // complete construction
  v.econ.ledger.drain();
  const stoneBefore = v.logi.totalOf(v.vi, v.code('base:resource.stone'));
  v.days(10);
  assert.equal(v.logi.totalOf(v.vi, v.code('base:resource.tools')), 0, 'no tools without planks');
  const stoneAfter = v.logi.totalOf(v.vi, v.code('base:resource.stone'));
  assert.ok(Math.abs(stoneAfter - stoneBefore) < 1e-9, 'stone moved at most, never consumed');
  const flows = v.econ.ledger.of(v.vi);
  assert.equal(flows.get(v.code('base:resource.stone'))?.consumed ?? 0, 0);
});

// ---------------- conservation property (the M13 test objective) ----------------

test('conservation: fuzzed compositions and commands reconcile over every window', () => {
  const menu = [
    'base:building.farm', 'base:building.lumber-camp', 'base:building.quarry',
    'base:building.sawmill', 'base:building.workshop', 'base:building.house',
    'base:building.granary',
  ];
  const limitTargets = ['base:resource.food', 'base:resource.wood', 'base:resource.planks', 'base:resource.tools'];
  for (let run = 0; run < 5; run++) {
    const rng = Rng.fromSeed(0x13c0de + run);
    const buildings: string[] = [];
    for (let n = rng.int(1, 5); n > 0; n--) buildings.push(menu[rng.int(0, menu.length - 1)] as string);
    const v = makeEconomy({
      seed: 100 + run,
      food: rng.int(20, 400),
      wood: rng.int(200, 600),
      stone: rng.int(50, 300),
      buildings,
    });
    v.econ.ledger.drain(); // discard founding-era flows; reconcile windows from here
    let before = v.totalSnapshot();
    for (let window = 0; window < 40; window++) {
      // sprinkle commands mid-run: limits move, buildings appear, roads pave
      // (each submit steps a tick; totals must reconcile regardless)
      if (rng.int(0, 3) === 0) {
        v.submit('village.setStockLimit', {
          villageId: v.villageId,
          resource: limitTargets[rng.int(0, limitTargets.length - 1)],
          limit: rng.int(0, 2) === 0 ? -1 : rng.int(0, 200),
        });
      }
      if (rng.int(0, 4) === 0) {
        v.submit('village.buildRoad', { villageId: v.villageId, x: 30 + rng.int(-8, 8), y: 30 + rng.int(-8, 8) });
      }
      if (rng.int(0, 9) === 0) v.placeNear(menu[rng.int(0, menu.length - 1)] as string);
      for (let t = rng.int(1, 30); t > 0; t--) v.kernel.step();
      const after = v.totalSnapshot();
      assertReconciles(before, after, v.econ.ledger.drain().get(v.vi) ?? new Map(), `run ${run} window ${window}`);
      before = after;
    }
  }
});

// ---------------- spoilage ----------------

test('spoilage: decaying stock follows (1 − decay)^days exactly when nothing else moves', () => {
  const v = makeEconomy({ food: 100, buildings: [] });
  const decay = v.db.resources.get('base:resource.food')?.decay ?? 0;
  assert.ok(decay > 0, 'base food must spoil (M13)');
  // empty the village: nobody eats, nothing produces — only spoilage moves food
  const p = v.world.write(v.popGame.Population);
  p.children[v.vi] = 0;
  p.adults[v.vi] = 0;
  p.elders[v.vi] = 0;
  v.econ.ledger.drain();
  const start = v.stockOf(v.code('base:resource.food'));
  v.days(10);
  const expected = start * Math.pow(1 - decay, 10);
  const got = v.stockOf(v.code('base:resource.food'));
  assert.ok(Math.abs(got - expected) < 1e-9, `food ${got} ≠ ${expected}`);
  const spoiled = v.econ.ledger.of(v.vi).get(v.code('base:resource.food'))?.spoiled ?? 0;
  assert.ok(Math.abs(spoiled - (start - got)) < 1e-9, 'ledger accounts every spoiled unit');
  // non-decaying resources never spoil
  assert.equal(v.econ.ledger.of(v.vi).get(v.code('base:resource.wood'))?.spoiled ?? 0, 0);
});

// ---------------- stockpile limits ----------------

test('limits: production clamps at the player limit and wastes no inputs', () => {
  const v = makeEconomy({ wood: 600, buildings: ['base:building.sawmill'] });
  v.submit('village.setStockLimit', { villageId: v.villageId, resource: 'base:resource.planks', limit: 10 });
  v.days(30); // sawmill (48 ticks) completes, produces, hits the limit, stops
  assert.ok(Math.abs(v.stockOf(v.code('base:resource.planks')) - 10) < 1e-9, 'planks pinned at the limit');
  const flows = v.econ.ledger.of(v.vi);
  const woodConsumed = flows.get(v.code('base:resource.wood'))?.consumed ?? 0;
  const planksMade = flows.get(v.code('base:resource.planks'))?.produced ?? 0;
  assert.ok(Math.abs(woodConsumed - planksMade * 1.5) < 1e-9, 'no wood consumed past the clamp');

  // raising the limit resumes production; clearing (< 0) restores the storage cap
  v.submit('village.setStockLimit', { villageId: v.villageId, resource: 'base:resource.planks', limit: -1 });
  v.days(5);
  assert.ok(v.stockOf(v.code('base:resource.planks')) > 10, 'cleared limit → production resumes');
});

test('limits: storage capacity still caps production (granary raises it)', () => {
  // wood: no decay and nothing eats it — the cap is the only brake
  const bare = makeEconomy({ wood: 100, buildings: ['base:building.lumber-camp'] });
  bare.days(40);
  assert.ok(bare.stockOf(bare.code('base:resource.wood')) <= BASE_STORAGE + 1e-9, 'no storage → base cap');
  const stored = makeEconomy({ wood: 100, buildings: ['base:building.lumber-camp', 'base:building.granary'] });
  stored.days(40);
  assert.ok(stored.stockOf(stored.code('base:resource.wood')) > BASE_STORAGE, 'granary lifts the cap');
});

test('limits: rejections name the reason', () => {
  const v = makeEconomy();
  v.submit('village.setStockLimit', { villageId: v.villageId, resource: 'base:resource.mithril', limit: 5 });
  assert.ok(v.rejections.some((r) => r.includes("unknown resource 'base:resource.mithril'")));
  v.submit('village.setStockLimit', { villageId: 999999, resource: 'base:resource.food', limit: 5 });
  assert.ok(v.rejections.some((r) => r.includes('no such village')));
});

// ---------------- determinism ----------------

test('economy: identical histories hash identically', () => {
  const run = (): number => {
    const v = makeEconomy({ seed: 42, wood: 600, buildings: ['base:building.sawmill', 'base:building.workshop', 'base:building.farm'] });
    v.submit('village.setStockLimit', { villageId: v.villageId, resource: 'base:resource.planks', limit: 25 });
    v.days(60);
    return v.kernel.stateHash();
  };
  assert.equal(run(), run());
});
