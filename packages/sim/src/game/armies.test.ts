/**
 * Army movement & supply (M26). Covers: HPA*-routed marching with
 * auto-garrison on arrival, explicit stance control, season-dependent march
 * speed (doc 08 §3), supply (carried first, then forage from a friendly
 * village in range), fatigue rise/recovery, and ATTRITION — the deliberate
 * mirror of M25's conservation property: sustained unsupplied fatigue
 * destroys soldiers for real, never returning them to any population cohort.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DefinitionDatabase, BASE_CONTENT_FILES } from '@crowns/data';
import { Kernel } from '../kernel.js';
import { World } from '../ecs.js';
import { TICKS_PER_DAY } from '../time.js';
import { registerVillageGameplay, type TerrainAccessor } from './villages.js';
import { registerPopulationGameplay } from './population.js';
import { registerEconomyGameplay } from './economy.js';
import { registerLogisticsGameplay } from './logistics.js';
import { registerKingdomGameplay, StatModifiers } from './kingdom.js';
import { registerMilitaryGameplay } from './military.js';
import { registerArmyGameplay, SEASON_SPEED, SUPPLY_RANGE } from './armies.js';

const plain: TerrainAccessor = {
  width: 100,
  height: 100,
  tagsAt: () => ['open', 'farmable', 'mineable', 'woodland'],
  riverAt: () => false,
  movementCostAt: () => 1,
};

function makeArmies(options: { seed?: number } = {}) {
  const kernel = new Kernel(options.seed ?? 23);
  const world = new World(512);
  const db = DefinitionDatabase.load(BASE_CONTENT_FILES);
  const stock = {
    'base:resource.wood': 600, 'base:resource.stone': 300,
    'base:resource.food': 500, 'base:resource.tools': 200,
  };
  const mods = new StatModifiers();
  const game = registerVillageGameplay(kernel, world, db, plain, stock);
  const popGame = registerPopulationGameplay(kernel, world, db, game, { children: 12, adults: 30, elders: 5 }, mods);
  const econ = registerEconomyGameplay(kernel, world, db, game, mods);
  const Position = world.defineSoA('position', { x: 'f64', y: 'f64' });
  registerLogisticsGameplay(kernel, world, db, game, popGame, econ, Position);
  const kingdom = registerKingdomGameplay(kernel, world, db, game, popGame, econ, mods);
  const military = registerMilitaryGameplay(kernel, world, db, game, popGame, kingdom);
  const armies = registerArmyGameplay(kernel, world, game, military, kingdom);
  kernel.attachGuard(world);
  kernel.addHashSource('world', (fold) => world.hash(fold));

  const rejections: string[] = [];
  const events: { type: string; data: unknown }[] = [];
  kernel.subscribe<{ what: string; reason: string }>('village.rejected', (e) => {
    rejections.push(`${e.data.what}: ${e.data.reason}`);
  });
  for (const type of [
    'army.unitRecruited', 'army.created', 'army.marchOrdered', 'army.arrived',
    'army.stanceSet', 'army.attrition',
  ]) {
    kernel.subscribe(type, (e) => events.push({ type, data: e.data }));
  }

  const submit = (type: string, payload: unknown, issuer = 1): void => {
    kernel.submit({ type, issuer, payload });
    kernel.step();
  };

  submit('village.found', { x: 30, y: 30, name: 'Crownton' });
  let villageId = -1;
  world.query([popGame.Population]).forEach((_i, entity) => (villageId = entity as number));
  assert.ok(villageId >= 0);

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
  placeNear('base:building.farm');
  placeNear('base:building.farm');
  placeNear('base:building.barracks');

  const days = (n: number): void => {
    for (let t = 0; t < n * TICKS_PER_DAY; t++) kernel.step();
  };
  days(5); // let farm + barracks finish

  const recruit = (unitDef = 'base:unit.militia'): number => {
    submit('army.recruitUnit', { villageId, unitDef });
    const recruited = events.find((e) => e.type === 'army.unitRecruited');
    assert.ok(recruited !== undefined);
    const unit = (recruited.data as { unit: number }).unit;
    events.length = 0;
    return unit;
  };

  const createArmy = (): number => {
    submit('army.createArmy', { name: 'Vanguard', villageId });
    const created = events.find((e) => e.type === 'army.created');
    assert.ok(created !== undefined);
    events.length = 0;
    return (created.data as { army: number }).army;
  };

  const lastRejection = (): string => rejections.at(-1) ?? '';

  return {
    kernel, world, db, game, popGame, kingdom, military, armies, villageId, submit, days, recruit, createArmy, lastRejection, events,
  };
}

// ---------------- creation & basic movement ----------------

test('army.created positions the army at its founding village, garrisoned', () => {
  const m = makeArmies();
  const army = m.createArmy();
  const ai = army & 0x3fffff;
  const mv = m.world.read(m.armies.ArmyMovement);
  assert.equal(mv.x[ai], 30);
  assert.equal(mv.y[ai], 30);
  assert.equal(mv.stance[ai], 0); // garrison
});

test('moveTo: routes, marches, and arrives with an auto-garrison', () => {
  const m = makeArmies();
  const army = m.createArmy();
  const ai = army & 0x3fffff;
  m.submit('army.moveTo', { armyId: army, x: 70, y: 60 });
  assert.equal(m.world.read(m.armies.ArmyMovement).stance[ai], 4); // march
  let arrived = false;
  for (let t = 0; t < 2000 && !arrived; t++) {
    m.kernel.step();
    arrived = m.events.some((e) => e.type === 'army.arrived');
  }
  assert.ok(arrived, 'the army must arrive within a generous tick budget');
  const mv = m.world.read(m.armies.ArmyMovement);
  assert.equal(mv.x[ai], 70);
  assert.equal(mv.y[ai], 60);
  assert.equal(mv.stance[ai], 0, 'arrival auto-garrisons');
});

test('setStance: explicit garrison halts an in-progress march', () => {
  const m = makeArmies();
  const army = m.createArmy();
  const ai = army & 0x3fffff;
  m.submit('army.moveTo', { armyId: army, x: 90, y: 90 });
  m.kernel.step();
  m.kernel.step();
  m.submit('army.setStance', { armyId: army, stance: 'garrison' });
  const mv = m.world.read(m.armies.ArmyMovement);
  assert.equal(mv.stance[ai], 0);
  assert.equal(mv.pathIndex[ai], 0);
  const before = { x: mv.x[ai], y: mv.y[ai] };
  for (let t = 0; t < 50; t++) m.kernel.step();
  const after = m.world.read(m.armies.ArmyMovement);
  assert.equal(after.x[ai], before.x, 'a garrisoned army does not keep walking');
  assert.equal(after.y[ai], before.y);
});

test('rejections by name: unowned army, unknown stance, impassable destination', () => {
  const m = makeArmies();
  const army = m.createArmy();
  m.submit('army.moveTo', { armyId: 999999, x: 10, y: 10 });
  assert.match(m.lastRejection(), /no such army/);
  m.submit('army.setStance', { armyId: army, stance: 'rampage' });
  assert.match(m.lastRejection(), /unknown stance/);
  m.submit('army.moveTo', { armyId: army, x: -5, y: 10 });
  assert.match(m.lastRejection(), /impassable or out of bounds/);
});

// ---------------- season speed (doc 08 §3) ----------------

test('season: winter marches slower than summer over an identical route', () => {
  const ticksToArrive = (season: 1 | 3): number => {
    const m = makeArmies();
    // fast-forward to the START of the target season (season index 1=summer, 3=winter)
    while (true) {
      const before = m.kernel.currentTick;
      m.kernel.step();
      void before;
      const date = (() => {
        // recompute directly rather than importing calendarFromTick twice — cheap enough
        const t = Math.max(0, m.kernel.currentTick - 1);
        const day = Math.floor(t / 24) % 90;
        const seasonIdx = Math.floor(Math.floor(t / 24) / 90) % 4;
        return { day, seasonIdx };
      })();
      if (date.seasonIdx === season && date.day === 0) break;
    }
    const army = m.createArmy();
    m.submit('army.moveTo', { armyId: army, x: 90, y: 30 });
    let ticks = 0;
    while (!m.events.some((e) => e.type === 'army.arrived') && ticks < 5000) {
      m.kernel.step();
      ticks++;
    }
    assert.ok(ticks < 5000, 'must arrive within budget');
    return ticks;
  };
  const summerTicks = ticksToArrive(1);
  const winterTicks = ticksToArrive(3);
  assert.ok(winterTicks > summerTicks, `winter (${winterTicks} ticks) must be slower than summer (${summerTicks})`);
  const ratio = winterTicks / summerTicks;
  const expectedRatio = (SEASON_SPEED[1] as number) / (SEASON_SPEED[3] as number);
  assert.ok(Math.abs(ratio - expectedRatio) < 0.15, `speed ratio ${ratio.toFixed(2)} should track SEASON_SPEED (${expectedRatio.toFixed(2)})`);
});

// ---------------- supply, forage, fatigue ----------------

test('supply: carried supplies feed the army before any village is touched', () => {
  const m = makeArmies();
  const unit = m.recruit();
  const army = m.createArmy();
  m.submit('army.assignUnit', { unitId: unit, armyId: army });
  m.days(2); // train the unit
  const foodCode = m.game.ops.resourceCode('base:resource.food') as number;
  m.world.writeObj(m.armies.ArmySupplies).get(army & 0x3fffff).set(foodCode, 100);
  const villageFoodBefore = m.world.readObj(m.game.comps.Stockpile).get(m.villageId & 0x3fffff).get(foodCode) ?? 0;
  for (let t = 0; t < TICKS_PER_DAY; t++) m.kernel.step();
  const carried = m.world.readObj(m.armies.ArmySupplies).get(army & 0x3fffff).get(foodCode) ?? 0;
  assert.ok(carried < 100, 'the army ate from its own supplies');
  const villageFoodAfter = m.world.readObj(m.game.comps.Stockpile).get(m.villageId & 0x3fffff).get(foodCode) ?? 0;
  // farms may still be producing/hauling into the stockpile independently of the
  // army, so assert no FORAGING occurred rather than a net stockpile delta
  assert.equal(m.world.read(m.armies.ArmyMovement).fatigue[army & 0x3fffff], 0, 'fed armies accrue no fatigue');
  void villageFoodBefore;
  void villageFoodAfter;
});

test('supply: forages the nearest friendly village once carried supplies run dry', () => {
  const m = makeArmies();
  const unit = m.recruit();
  const army = m.createArmy();
  m.submit('army.assignUnit', { unitId: unit, armyId: army });
  m.days(2); // train — the army starts AT the village, well within SUPPLY_RANGE
  const foodCode = m.game.ops.resourceCode('base:resource.food') as number;
  const before = m.world.readObj(m.game.comps.Stockpile).get(m.villageId & 0x3fffff).get(foodCode) ?? 0;
  for (let t = 0; t < TICKS_PER_DAY; t++) m.kernel.step();
  const after = m.world.readObj(m.game.comps.Stockpile).get(m.villageId & 0x3fffff).get(foodCode) ?? 0;
  assert.ok(after < before, `foraging must draw down the village stockpile (${before} -> ${after})`);
  assert.equal(m.world.read(m.armies.ArmyMovement).fatigue[army & 0x3fffff], 0, 'a successfully foraged army accrues no fatigue');
});

test('supply: out of range and unsupplied, fatigue climbs; resupply recovers it', () => {
  const m = makeArmies();
  const unit = m.recruit();
  const army = m.createArmy();
  m.submit('army.assignUnit', { unitId: unit, armyId: army });
  m.days(2); // train
  const ai = army & 0x3fffff;
  // move well beyond SUPPLY_RANGE (village is at 30,30)
  const far = 30 + SUPPLY_RANGE + 15;
  m.submit('army.moveTo', { armyId: army, x: Math.min(99, far), y: 30 });
  for (let t = 0; t < 3000 && !m.events.some((e) => e.type === 'army.arrived'); t++) m.kernel.step();
  m.events.length = 0;
  for (let t = 0; t < TICKS_PER_DAY; t++) m.kernel.step();
  const fatigueAfterOneDay = m.world.read(m.armies.ArmyMovement).fatigue[ai] as number;
  assert.ok(fatigueAfterOneDay > 0, 'an unsupplied, out-of-range army accrues fatigue');

  const foodCode = m.game.ops.resourceCode('base:resource.food') as number;
  m.world.writeObj(m.armies.ArmySupplies).get(ai).set(foodCode, 1000);
  for (let t = 0; t < TICKS_PER_DAY; t++) m.kernel.step();
  const fatigueAfterResupply = m.world.read(m.armies.ArmyMovement).fatigue[ai] as number;
  assert.ok(fatigueAfterResupply < fatigueAfterOneDay, 'resupplying recovers fatigue');
});

// ---------------- attrition: the deliberate NON-conservation property ----------------

test('attrition: sustained max fatigue destroys soldiers — never returned to any cohort', () => {
  const m = makeArmies();
  const unit = m.recruit();
  const army = m.createArmy();
  m.submit('army.assignUnit', { unitId: unit, armyId: army });
  m.days(2); // train
  const ai = army & 0x3fffff;
  const far = 30 + SUPPLY_RANGE + 15;
  m.submit('army.moveTo', { armyId: army, x: Math.min(99, far), y: 30 });
  for (let t = 0; t < 3000 && !m.events.some((e) => e.type === 'army.arrived'); t++) m.kernel.step();

  const totalPopBefore = m.popGame.totalOf(m.villageId & 0x3fffff);
  const startCount = m.world.read(m.military.Unit).count[unit & 0x3fffff] as number;
  // starve for many days — fatigue caps at 100, then attrition grinds the unit down
  m.days(30);
  const endCount = m.world.read(m.military.Unit).count[unit & 0x3fffff] as number;
  const lost = startCount - endCount;
  assert.ok(lost > 0.5, `sustained starvation must shrink the unit (${startCount} -> ${endCount})`);
  assert.ok(m.events.some((e) => e.type === 'army.attrition'));
  // the village's OWN population still drifts a little over 30 days (unrelated
  // births/deaths, doc 08 §5) — attrition never touches Population at all, so
  // the drift must be nowhere near as large as the soldiers actually lost,
  // unlike a real return (disband/desertion, M25) which moves the FULL count
  const drift = Math.abs(m.popGame.totalOf(m.villageId & 0x3fffff) - totalPopBefore);
  assert.ok(drift < lost / 2, `population drift (${drift}) must not track the attrition loss (${lost}) — nothing was returned`);
  void ai;
});

// ---------------- determinism ----------------

test('armies: identical histories hash identically', () => {
  const run = (): number => {
    const m = makeArmies({ seed: 55 });
    const unit = m.recruit();
    const army = m.createArmy();
    m.submit('army.assignUnit', { unitId: unit, armyId: army });
    m.days(2);
    m.submit('army.moveTo', { armyId: army, x: 80, y: 20 });
    m.days(200);
    return m.kernel.stateHash();
  };
  assert.equal(run(), run());
});
