import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DefinitionDatabase, BASE_CONTENT_FILES } from '@crowns/data';
import { Kernel } from '../kernel.js';
import { World } from '../ecs.js';
import { TICKS_PER_DAY } from '../time.js';
import { registerVillageGameplay, type TerrainAccessor } from './villages.js';
import { registerPopulationGameplay, FOOD_PER_PERSON_DAY, JOY_NEUTRAL } from './population.js';
import { registerEconomyGameplay, type StatModifierView } from './economy.js';
import { registerLogisticsGameplay } from './logistics.js';

/** Open farmable plain everywhere — population math without terrain noise. */
const plain: TerrainAccessor = {
  width: 64,
  height: 64,
  tagsAt: () => ['open', 'farmable', 'mineable', 'woodland'],
  riverAt: () => false,
  movementCostAt: () => 1,
};

const START_POP = { children: 12, adults: 30, elders: 5 };

function makeVillage(options: { food?: number; farms?: number; houses?: number; mods?: StatModifierView } = {}) {
  const kernel = new Kernel(7);
  const world = new World(256);
  const db = DefinitionDatabase.load(BASE_CONTENT_FILES);
  const stock = {
    'base:resource.wood': 500,
    'base:resource.stone': 200,
    'base:resource.food': options.food ?? 200,
  };
  const game = registerVillageGameplay(kernel, world, db, plain, stock);
  const popGame = registerPopulationGameplay(kernel, world, db, game, START_POP, options.mods);
  const econ = registerEconomyGameplay(kernel, world, db, game);
  const Position = world.defineSoA('position', { x: 'f64', y: 'f64' });
  const logi = registerLogisticsGameplay(kernel, world, db, game, popGame, econ, Position);
  kernel.attachGuard(world);
  kernel.addHashSource('world', (fold) => world.hash(fold));

  const submit = (type: string, payload: unknown): void => {
    kernel.submit({ type, issuer: 1, payload });
    kernel.step();
  };
  submit('village.found', { x: 30, y: 30, name: 'Curveton' });
  let villageId = -1;
  kernel.subscribe('village.founded', () => undefined);
  // find the village entity (only Population carrier)
  world.query([popGame.Population]).forEach((_i, entity) => (villageId = entity as number));
  assert.ok(villageId >= 0, 'village founded');
  const vi = villageId & 0x3fffff;

  /** First validator-approved spot on a spiral around the center (like genesis). */
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
  for (let f = 0; f < (options.farms ?? 0); f++) placeNear('base:building.farm');
  for (let h = 0; h < (options.houses ?? 0); h++) placeNear('base:building.house');

  const days = (n: number): void => {
    for (let t = 0; t < n * TICKS_PER_DAY; t++) kernel.step();
  };
  void placeNear;
  const pop = () => {
    const p = world.read(popGame.Population);
    return {
      children: p.children[vi] as number,
      adults: p.adults[vi] as number,
      elders: p.elders[vi] as number,
      total: (p.children[vi] as number) + (p.adults[vi] as number) + (p.elders[vi] as number),
      happiness: p.happiness[vi] as number,
      foodSecurity: p.foodSecurity[vi] as number,
    };
  };
  const food = (): number => {
    const s = world.readObj(game.comps.Stockpile).get(vi);
    return s.get(game.ops.resourceCode('base:resource.food') as number) ?? 0;
  };
  return { kernel, world, game, popGame, econ, logi, villageId, vi, days, pop, food, submit, placeNear };
}

// ---------------- consumption & production coupling ----------------

test('needs: daily consumption is pop × ration; farms replace what is eaten', () => {
  // start UNDER the 150 storage cap, or production clamps and the delta reads 0
  const v = makeVillage({ food: 60, farms: 1, houses: 4 });
  const foodCode = v.game.ops.resourceCode('base:resource.food') as number;
  v.days(6); // farm (72 ticks) completes; workers staff it; haulers walk the route
  v.econ.ledger.drain(); // reconcile just the next day's flows
  const before = v.logi.totalOf(v.vi, foodCode); // stockpile + farm outbox + carts (M14)
  const total = v.pop().total;
  v.days(1);
  const flows = v.econ.ledger.of(v.vi).get(foodCode);
  assert.ok(flows !== undefined, 'ledger tracked food flows');
  // one fully-staffed farm: +8/day; consumption ≈ total × ration; and the
  // village-total delta reconciles against the ledger (M13 conservation,
  // doc 08 §4 — hauling only redistributes, it never creates or destroys)
  assert.ok(Math.abs(flows.produced - 8) < 0.01, `farm produced ${flows.produced.toFixed(2)} ≠ ~8`);
  const expectedEaten = total * FOOD_PER_PERSON_DAY;
  assert.ok(Math.abs(flows.eaten - expectedEaten) < 0.05, `eaten ${flows.eaten.toFixed(2)} ≠ ~${expectedEaten.toFixed(2)}`);
  const delta = v.logi.totalOf(v.vi, foodCode) - before;
  const reconciled = flows.produced - flows.eaten - flows.spoiled;
  assert.ok(Math.abs(delta - reconciled) < 1e-9, `total delta ${delta} must reconcile to ${reconciled}`);
});

test('jobs: understaffed production scales by workforce efficiency', () => {
  const v = makeVillage({ food: 60, farms: 1 });
  v.days(6);
  // farm requires 4; strand the village with 2 workers (2.9: floor survives drift)
  const p = v.world.write(v.popGame.Population);
  p.adults[v.vi] = 2.9;
  p.children[v.vi] = 0;
  p.elders[v.vi] = 0;
  v.days(1); // let the jobs solver settle on the reduced pool
  v.econ.ledger.drain();
  v.days(1);
  const foodCode = v.game.ops.resourceCode('base:resource.food') as number;
  const produced = v.econ.ledger.of(v.vi).get(foodCode)?.produced ?? 0;
  assert.ok(Math.abs(produced - 4) < 0.05, `2/4 workers should yield ~4/day, got ${produced.toFixed(2)}`);
});

test('construction: labor-gated sites stall with no adults and resume with them', () => {
  const v = makeVillage({ food: 500 });
  const p = v.world.write(v.popGame.Population);
  p.adults[v.vi] = 0; // nobody to build (children/elders don't)
  v.placeNear('base:building.house');
  v.days(4); // 96 ticks ≫ buildTicks 48
  const b = v.world.read(v.game.comps.BuildingCore);
  // find THE HOUSE (the center is also stalled — grab by def, not by index)
  const houseIndex = v.world
    .query([v.game.comps.BuildingCore])
    .collect()
    .find((i) => v.game.ops.buildingDef(b.def[i] as number).id === 'base:building.house') as number;
  assert.ok((b.progress[houseIndex] as number) < 0.05, 'no builders → no progress');
  p.adults[v.vi] = 10;
  v.days(3); // 72 ticks; house needs 48 with its 2 builders
  assert.equal(b.complete[houseIndex], 1, 'builders restored → construction completes');
});

// ---------------- growth curves (the M12 test objective) ----------------

test('growth: a fed, housed village grows a few percent per year with a sane pyramid', () => {
  const v = makeVillage({ food: 300, farms: 2, houses: 10 });
  const start = v.pop().total;
  v.days(720); // two years
  const end = v.pop();
  const growth = end.total / start - 1;
  // joy-driven growth (fertility × happiness, plus migration into spare housing)
  assert.ok(growth > 0.08 && growth < 0.4, `2-year growth ${(growth * 100).toFixed(1)}% outside (8%, 40%)`);
  assert.ok(end.adults > end.children && end.adults > end.elders, 'adults remain the largest cohort');
  assert.ok(end.happiness > 70, `fed+housed happiness ${end.happiness.toFixed(0)} should exceed 70`);
  assert.ok(end.foodSecurity > 0.95);
});

test('growth: proportional to food security — the fed village outgrows the hungry one', () => {
  const fed = makeVillage({ food: 300, farms: 2, houses: 10 });
  const hungry = makeVillage({ food: 20, farms: 0, houses: 10 }); // starves after ~4 days
  fed.days(360);
  hungry.days(360);
  assert.ok(
    fed.pop().total > hungry.pop().total * 1.2,
    `fed ${fed.pop().total.toFixed(1)} should clearly exceed hungry ${hungry.pop().total.toFixed(1)}`,
  );
});

// ---------------- starvation (people die when the food is gone) ----------------

test('starvation: no food is lethal — a steady, un-floored decline, then recovery', () => {
  const v = makeVillage({ food: 10, houses: 8 }); // no farms: famine in days
  const start = v.pop().total;
  let previous = start;
  let worstDailyLoss = 0;
  for (let day = 0; day < 360; day++) {
    v.days(1);
    const now = v.pop().total;
    worstDailyLoss = Math.max(worstDailyLoss, (previous - now) / previous);
    previous = now;
  }
  const afterFamineYear = v.pop();
  // people genuinely die when the granaries run dry: most of the village is lost
  assert.ok(afterFamineYear.total < start * 0.4, `starvation should be lethal: ${afterFamineYear.total.toFixed(1)} of ${start}`);
  // …but it is a decline, not an instant cliff — no single day wipes the village
  assert.ok(worstDailyLoss < 0.015, `single-day loss ${(worstDailyLoss * 100).toFixed(2)}% is a cliff`);
  // real (un-floored) nutrition craters toward zero with no food
  assert.ok(afterFamineYear.foodSecurity < 0.1, `security ${afterFamineYear.foodSecurity.toFixed(2)} should crater with no food`);
  // foragers still soften MORALE (GDD §4): happiness sits above the pure-hunger floor
  assert.ok(afterFamineYear.happiness < 62, `starving happiness ${afterFamineYear.happiness.toFixed(0)} should sit low`);

  // relief: build farms — mortality tails off through the security EMA, so the
  // curve dips a little more, TROUGHS, then turns: assert the turn, not the day
  v.placeNear('base:building.farm');
  v.placeNear('base:building.farm');
  let trough = v.pop().total;
  for (let day = 0; day < 360; day++) {
    v.days(1);
    trough = Math.min(trough, v.pop().total);
  }
  assert.ok(v.pop().total > trough * 1.01, `population must rise off the trough (${v.pop().total.toFixed(1)} vs ${trough.toFixed(1)})`);
  assert.ok(v.pop().foodSecurity > 0.8, 'food security climbs back');
});

// ---------------- migration (joy is a main driver) ----------------

test('migration: joy draws settlers into spare housing (immigration)', () => {
  const roomy = makeVillage({ food: 400, farms: 3, houses: 30 }); // lots of spare housing
  const tight = makeVillage({ food: 400, farms: 3, houses: 10 }); // little spare housing
  const start = roomy.pop().total;
  roomy.days(360);
  tight.days(360);
  // a happy village with room draws newcomers — it outgrows an equally-fed but
  // cramped one, and rises well past what a year of births alone could add
  assert.ok(roomy.pop().total > tight.pop().total * 1.3, `roomy ${roomy.pop().total.toFixed(1)} should outdraw tight ${tight.pop().total.toFixed(1)}`);
  assert.ok(roomy.pop().total > start * 1.4, `immigration should visibly grow the village (${roomy.pop().total.toFixed(1)} from ${start})`);
  assert.ok(roomy.pop().happiness > JOY_NEUTRAL, 'a village drawing settlers is a happy one');
});

test('migration: unhappy villages (joy < neutral) bleed people even when well fed', () => {
  // a fed, housed village can't naturally fall below neutral joy (food alone floors
  // morale), so isolate EMIGRATION with a standing discontent modifier — the loss is
  // people leaving, not famine.
  const gloom: StatModifierView = { add: (t) => (t === 'village.happinessDrift' ? -70 : 0), mul: () => 1 };
  const v = makeVillage({ food: 400, farms: 3, houses: 10, mods: gloom });
  const start = v.pop().total;
  v.days(360);
  const end = v.pop();
  assert.ok(end.happiness < JOY_NEUTRAL, `discontent should hold joy below neutral (${end.happiness.toFixed(0)})`);
  assert.ok(end.foodSecurity > 0.9, 'the village is well fed — the loss is emigration, not starvation');
  assert.ok(end.total < start * 0.95, `an unhappy village should shrink via emigration (${end.total.toFixed(1)} from ${start})`);
});

// ---------------- determinism ----------------

test('population: identical histories hash identically', () => {
  const run = (): number => {
    const v = makeVillage({ food: 200, farms: 1, houses: 3 });
    v.days(200);
    return v.kernel.stateHash();
  };
  assert.equal(run(), run());
});
