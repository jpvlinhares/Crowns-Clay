/**
 * Defence intel (M54; ADR-4 §4) — the staleness contract, end-to-end:
 *
 *   1. no contact ⇒ no snapshot (you know nothing you have not seen);
 *   2. a besieging army IS contact — the camp observes within a day;
 *   3. after contact ends, the snapshot FREEZES: new walls stay invisible
 *      until the next contact re-observes them;
 *   4. garrison strength arrives as a belief — exact at fresh contact
 *      (confidence 1 ⇒ zero noise), never read from live state;
 *   5. the estimate is fog-symmetric arithmetic over snapshot + belief;
 *   6. snapshots survive save/load in lockstep.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { composeCampaign } from '../campaign.js';
import { TICKS_PER_DAY } from '../time.js';
import { SCOUT_REVEAL_RADIUS } from '../ai/scouting.js';
import { estimateAssaultResistance, ESTIMATE_TOWER_RESISTANCE, ESTIMATE_WALL_RESISTANCE, ESTIMATE_STRENGTH_PER_MAN } from './intel.js';
import { DEFENCE_KEEP_CENTRE, KEEP_DEF } from './defence.js';
import { DEFENCE_MAP_SIZE, DEFENCE_TILE } from '../worldgen/defenceMap.js';

const SEED = 0x1471;
const index = (id: number): number => id & 0x3fffff;

function compose(): ReturnType<typeof composeCampaign> {
  return composeCampaign({
    seed: SEED,
    kingdomCount: 2,
    mapSize: 'small',
    aiFromIndex: 2, // both manual — intel changes only when THIS test creates contact
    aiDefence: false,
    mods: { sources: [] },
  });
}

function driver(c: ReturnType<typeof composeCampaign>) {
  const submit = (type: string, payload: unknown, issuer: number): void => {
    c.kernel.submit({ type, issuer, payload });
    c.kernel.step();
  };
  const days = (n: number): void => {
    for (let t = 0; t < n * TICKS_PER_DAY; t++) c.kernel.step();
  };
  const villageEntity = (vi: number): number => {
    let id = -1;
    c.world.query([c.game.comps.VillageCore]).forEach((i, entity) => {
      if (i === vi) id = entity as number;
    });
    return id;
  };
  const centreOf = (vi: number): { x: number; y: number } => {
    const core = c.world.read(c.game.comps.VillageCore);
    return { x: core.centerX[vi] as number, y: core.centerY[vi] as number };
  };
  const makeArmy = (kingdomIndex: number, atVillage: number): number => {
    submit('army.createArmy', { name: `T${kingdomIndex}`, villageId: villageEntity(atVillage) }, kingdomIndex + 1);
    let armyId = -1;
    const a = c.world.read(c.militaryGame.Army);
    c.world.query([c.militaryGame.Army]).forEach((ai, entity) => {
      if ((a.kingdomId[ai] as number) === (c.kingdomGame.kingdomEntities()[kingdomIndex] as number)) armyId = entity as number;
    });
    const def = c.db.units.get('base:unit.spearman');
    const defCode = c.militaryGame.ops.defCode('base:unit.spearman');
    assert.ok(def !== undefined && defCode !== undefined);
    const unit = c.world.spawn();
    c.world.attach(unit, c.militaryGame.Unit, {
      def: defCode,
      kingdomId: c.kingdomGame.kingdomEntities()[kingdomIndex] as number,
      homeVillage: villageEntity(atVillage),
      armyId,
      count: def.popCost.count,
      progress: 1,
      complete: true,
      morale: def.stats.moraleBase,
    });
    return armyId;
  };
  const placeArmy = (armyId: number, x: number, y: number): void => {
    const ai = index(armyId);
    const m = c.world.write(c.armiesGame.ArmyMovement);
    m.x[ai] = x;
    m.y[ai] = y;
    c.world.writeObj(c.armiesGame.ArmyPath).set(ai, []);
  };
  return { submit, days, villageEntity, centreOf, makeArmy, placeArmy };
}

const openTileNear = (c: ReturnType<typeof composeCampaign>, k: number): { x: number; y: number } => {
  const map = c.defenceGame.mapOf(k);
  assert.ok(map !== undefined);
  const occ = c.defenceGame.occupancyOf(k);
  for (let r = 2; r < 40; r++) {
    const x = DEFENCE_KEEP_CENTRE + r;
    const t = DEFENCE_KEEP_CENTRE * DEFENCE_MAP_SIZE + x;
    if (map.tiles[t] === DEFENCE_TILE.open && !occ.has(t)) return { x, y: DEFENCE_KEEP_CENTRE };
  }
  assert.fail('no open tile');
};

test('intel: nothing without contact; a siege camp observes; the snapshot freezes when contact ends', () => {
  const c = compose();
  const d = driver(c);
  c.kernel.step(); // genesis
  assert.ok(c.intelGame !== null);
  const intel = c.intelGame;

  // precondition (seed-pinned): the capitals sit beyond proximity-contact range,
  // so THIS test's siege is the only contact vector
  const p0 = d.centreOf(c.villageOf(0) as number);
  const p1 = d.centreOf(c.villageOf(1) as number);
  const dist = Math.max(Math.abs(p0.x - p1.x), Math.abs(p0.y - p1.y));
  assert.ok(dist > SCOUT_REVEAL_RADIUS, `capitals beyond contact range (${dist} > ${SCOUT_REVEAL_RADIUS})`);

  d.days(2);
  assert.equal(intel.state.get(0, 1), undefined, 'no contact ⇒ no snapshot');
  assert.equal(c.believedGarrisonOf(0, 1), undefined, 'no contact ⇒ no garrison belief');

  // the besieging army IS contact
  const castle = c.villageOf(1) as number;
  const army = d.makeArmy(0, c.villageOf(0) as number);
  d.placeArmy(army, p1.x, p1.y);
  d.submit('siege.begin', { armyId: army, villageId: d.villageEntity(castle) }, 1);
  d.days(2);
  const first = intel.state.get(0, 1);
  assert.ok(first !== undefined, 'the camp observed within a day');
  assert.ok(first.structures.some((s) => s.def === KEEP_DEF), 'the keep is in the snapshot');
  const wallsBefore = first.structures.length;

  // contact ends; the defender builds — the snapshot must NOT see it
  d.submit('siege.lift', { armyId: army }, 1);
  d.placeArmy(army, p0.x, p0.y);
  const stock = c.world.writeObj(c.game.comps.Stockpile).get(castle);
  stock.set(c.game.ops.resourceCode('base:resource.stone') as number, 10_000);
  const site = openTileNear(c, 1);
  d.submit('defence.build', { def: 'base:building.wall', x: site.x, y: site.y }, 2);
  d.days(3);
  const stale = intel.state.get(0, 1);
  assert.ok(stale !== undefined);
  assert.equal(stale.structures.length, wallsBefore, 'the new wall is INVISIBLE — the snapshot froze');
  assert.equal(stale.tick, first.tick, 'as-of tick unchanged since contact ended');

  // re-contact re-observes
  d.placeArmy(army, p1.x, p1.y);
  d.submit('siege.begin', { armyId: army, villageId: d.villageEntity(castle) }, 1);
  d.days(2);
  const fresh = intel.state.get(0, 1);
  assert.ok(fresh !== undefined);
  assert.equal(fresh.structures.length, wallsBefore + 1, 'the wall appears on re-contact');
  assert.ok(fresh.tick > stale.tick);
});

test('garrison belief: exact at fresh contact (confidence 1 ⇒ no noise), absent without observation', () => {
  const c = compose();
  const d = driver(c);
  c.kernel.step();

  // a 10-man garrison posted on the defender's layer
  const def = c.db.units.get('base:unit.spearman');
  const defCode = c.militaryGame.ops.defCode('base:unit.spearman');
  assert.ok(def !== undefined && defCode !== undefined);
  const unit = c.world.spawn();
  c.world.attach(unit, c.militaryGame.Unit, {
    def: defCode,
    kingdomId: c.kingdomGame.kingdomEntities()[1] as number,
    homeVillage: d.villageEntity(c.villageOf(1) as number),
    armyId: 0,
    count: 10,
    progress: 1,
    complete: true,
    morale: def.stats.moraleBase,
  });
  const site = openTileNear(c, 1);
  d.submit('defence.post', { unitId: unit as number, x: site.x, y: site.y }, 2);

  const castle = c.villageOf(1) as number;
  const p1 = d.centreOf(castle);
  const army = d.makeArmy(0, c.villageOf(0) as number);
  d.placeArmy(army, p1.x, p1.y);
  d.submit('siege.begin', { armyId: army, villageId: d.villageEntity(castle) }, 1);
  d.days(2);
  // fresh contact: confidence 1 ⇒ believedValue's noise term vanishes — exact
  assert.equal(c.believedGarrisonOf(0, 1), 10, 'freshly observed garrison is exact');
});

test('estimateAssaultResistance: keep + walls + towers + believed men, and nothing else', () => {
  const c = compose();
  const holdStrength = c.db.buildings.get(KEEP_DEF)?.defense?.holdStrength ?? 0;
  assert.ok(holdStrength > 0);
  const defOf = (id: string) => c.db.buildings.get(id);
  const wall = { def: 'base:building.wall', x: 0, y: 0, w: 1, h: 1 };
  const tower = { def: 'base:building.tower', x: 0, y: 0, w: 1, h: 1 };
  assert.equal(c.db.buildings.get('base:building.tower')?.defense?.kind, 'tower');

  assert.equal(estimateAssaultResistance([], 0, defOf, holdStrength), holdStrength);
  assert.equal(
    estimateAssaultResistance([wall, wall], 0, defOf, holdStrength),
    holdStrength + 2 * ESTIMATE_WALL_RESISTANCE,
  );
  assert.equal(
    estimateAssaultResistance([tower], 20, defOf, holdStrength),
    holdStrength + ESTIMATE_TOWER_RESISTANCE + 20 * ESTIMATE_STRENGTH_PER_MAN,
  );
});

test('intel survives save/load: snapshot identical, sessions stay in lockstep', () => {
  const original = compose();
  const d = driver(original);
  original.kernel.step();
  const castle = original.villageOf(1) as number;
  const p1 = d.centreOf(castle);
  const army = d.makeArmy(0, original.villageOf(0) as number);
  d.placeArmy(army, p1.x, p1.y);
  d.submit('siege.begin', { armyId: army, villageId: d.villageEntity(castle) }, 1);
  d.days(2);
  assert.ok(original.intelGame !== null && original.intelGame.state.get(0, 1) !== undefined);

  const save = original.saves.snapshot();
  assert.ok(save.sections['intel'] !== undefined, 'intel section present');
  const loaded = compose();
  const report = loaded.saves.hydrate(JSON.parse(JSON.stringify(save)) as typeof save);
  assert.deepEqual(report, []);
  assert.equal(loaded.kernel.stateHash(), original.kernel.stateHash());
  assert.deepEqual(loaded.intelGame?.state.save(), original.intelGame.state.save());
  for (let t = 0; t < TICKS_PER_DAY * 3; t++) {
    original.kernel.step();
    loaded.kernel.step();
  }
  assert.equal(loaded.kernel.stateHash(), original.kernel.stateHash(), 'lockstep after load');
});
