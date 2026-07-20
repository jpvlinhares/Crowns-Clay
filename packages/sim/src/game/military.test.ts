/**
 * Military basics (M25) — the roadmap test objective is "recruit/disband
 * population conservation": population removed at recruitment (regardless of
 * training progress) is always fully restored on disband or desertion. Also
 * covers barracks-gating, atomic cost checks (rejections by name), training
 * progress, seasonal upkeep (gold + food, ledger-reconciled), desertion when
 * upkeep is unpayable, army grouping, and determinism.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DefinitionDatabase, BASE_CONTENT_FILES } from '@crowns/data';
import { Kernel } from '../kernel.js';
import { World } from '../ecs.js';
import { TICKS_PER_DAY, TICKS_PER_SEASON } from '../time.js';
import { registerVillageGameplay, type TerrainAccessor } from './villages.js';
import { registerPopulationGameplay } from './population.js';
import { registerEconomyGameplay } from './economy.js';
import { registerLogisticsGameplay } from './logistics.js';
import { registerKingdomGameplay, StatModifiers, STARTING_TREASURY, OFFICES } from './kingdom.js';
import { registerMilitaryGameplay } from './military.js';

const plain: TerrainAccessor = {
  width: 64,
  height: 64,
  tagsAt: () => ['open', 'farmable', 'mineable', 'woodland'],
  riverAt: () => false,
  movementCostAt: () => 1,
};

function makeMilitary(options: { seed?: number; barracks?: boolean; farms?: number; isTechKnown?: (kingdomId: never, techId: string) => boolean } = {}) {
  const kernel = new Kernel(options.seed ?? 17);
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
  registerLogisticsGameplay(kernel, world, db, game, popGame, econ, Position); // farms feed the village via haulers (M14)
  const kingdom = registerKingdomGameplay(kernel, world, db, game, popGame, econ, mods);
  const military = registerMilitaryGameplay(kernel, world, db, game, popGame, kingdom,
    options.isTechKnown !== undefined ? { isTechKnown: options.isTechKnown as (kingdomId: never, techId: string) => boolean } : {});
  kernel.attachGuard(world);
  kernel.addHashSource('world', (fold) => world.hash(fold));

  const rejections: string[] = [];
  const events: { type: string; data: unknown }[] = [];
  kernel.subscribe<{ what: string; reason: string }>('village.rejected', (e) => {
    rejections.push(`${e.data.what}: ${e.data.reason}`);
  });
  for (const type of [
    'army.unitRecruited', 'army.unitDisbanded', 'army.unitTrained', 'army.unitDeserted',
    'army.created', 'army.unitAssigned', 'army.disbanded',
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

  const days = (n: number): void => {
    for (let t = 0; t < n * TICKS_PER_DAY; t++) kernel.step();
  };

  // farms keep the village self-sufficient in food (no production otherwise),
  // so unit food upkeep is tested in isolation from starvation dynamics
  for (let f = 0; f < (options.farms ?? 2); f++) placeNear('base:building.farm');
  if (options.barracks ?? true) {
    placeNear('base:building.barracks');
  }
  days(5); // buildTicks: farm 72 (3d), barracks 96 (4d)

  const ki = (kingdom.kingdomEntity() as number) & 0x3fffff;
  const totalPop = (): number => popGame.totalOf(vi);
  const treasury = (): number => world.read(kingdom.Kingdom).treasury[ki] as number;
  const setTreasury = (amount: number): void => {
    world.write(kingdom.Kingdom).treasury[ki] = amount;
  };
  const toolsOf = (): number => world.readObj(game.comps.Stockpile).get(vi).get(game.ops.resourceCode('base:resource.tools') as number) ?? 0;
  const setTools = (amount: number): void => {
    world.writeObj(game.comps.Stockpile).get(vi).set(game.ops.resourceCode('base:resource.tools') as number, amount);
  };
  const lastRejection = (): string => rejections.at(-1) ?? '';
  const reconciles = (): void => {
    const expected = STARTING_TREASURY + kingdom.ledger.sum();
    assert.ok(Math.abs(treasury() - expected) < 1e-9, `treasury ${treasury()} must equal start + ledger sum ${expected}`);
  };

  return {
    kernel, world, db, game, popGame, econ, kingdom, military, villageId, vi, days, submit, placeNear,
    totalPop, treasury, setTreasury, toolsOf, setTools, lastRejection, reconciles, rejections, events,
  };
}

function recruit(m: ReturnType<typeof makeMilitary>, unitDef = 'base:unit.militia'): number {
  m.submit('army.recruitUnit', { villageId: m.villageId, unitDef });
  const recruited = m.events.find((e) => e.type === 'army.unitRecruited');
  assert.ok(recruited !== undefined, `recruit failed: ${m.lastRejection()}`);
  return (recruited.data as { unit: number }).unit;
}

// ---------------- the T objective: recruit/disband population conservation ----------------

test('recruit/disband: population conservation, even mid-training', () => {
  const m = makeMilitary();
  const before = m.totalPop();
  const unit = recruit(m);
  assert.equal(before - m.totalPop(), 10); // militia popCost.count
  m.submit('army.disbandUnit', { unitId: unit });
  assert.equal(m.totalPop(), before, 'disbanding an untrained unit fully restores its population');
});

test('recruit/disband: conservation holds after training completes too', () => {
  const m = makeMilitary();
  const before = m.totalPop();
  const unit = recruit(m);
  m.days(2); // militia recruitTicks = 24 (1 day) — well past training
  assert.equal((m.world.read(m.military.Unit).complete[unit & 0x3fffff] as number), 1);
  m.submit('army.disbandUnit', { unitId: unit });
  assert.equal(m.totalPop(), before);
});

test('recruit: rejected atomically when the barracks is missing', () => {
  const m = makeMilitary({ barracks: false });
  const beforePop = m.totalPop();
  const beforeGold = m.treasury();
  const beforeTools = m.toolsOf();
  m.submit('army.recruitUnit', { villageId: m.villageId, unitDef: 'base:unit.militia' });
  assert.match(m.lastRejection(), /no building in this village trains/);
  assert.equal(m.totalPop(), beforePop);
  assert.equal(m.treasury(), beforeGold);
  assert.equal(m.toolsOf(), beforeTools);
});

test('recruit tech gate (1.0): default-open recruits everything; a wired hook gates only requiresTech units', () => {
  // default-open (no hook — the harness/test path): the M45 roster, now in the Barracks
  // recruits list, trains regardless of tech. Swordsman carries requiresTech but no hook
  // is wired, so it recruits — grandfathering the ungated compositions byte-identical.
  const open = makeMilitary();
  open.submit('army.recruitUnit', { villageId: open.villageId, unitDef: 'base:unit.swordsman' });
  assert.ok(open.events.some((e) => e.type === 'army.unitRecruited'), `default-open should recruit swordsman: ${open.lastRejection()}`);

  // hook wired, tech NOT known: the gated unit is rejected by tech name; an UNGATED unit
  // (spearman has no requiresTech) is unaffected — the gate is consulted only when declared.
  const gated = makeMilitary({ isTechKnown: () => false });
  gated.submit('army.recruitUnit', { villageId: gated.villageId, unitDef: 'base:unit.swordsman' });
  assert.match(gated.lastRejection(), /requires the .* technology/);
  assert.ok(!gated.events.some((e) => e.type === 'army.unitRecruited'), 'gated unit did not recruit');
  gated.submit('army.recruitUnit', { villageId: gated.villageId, unitDef: 'base:unit.spearman' });
  assert.ok(gated.events.some((e) => e.type === 'army.unitRecruited'), `ungated spearman recruits despite the closed hook: ${gated.lastRejection()}`);

  // hook wired, tech known: the gate opens
  const known = makeMilitary({ isTechKnown: (_k, techId) => techId === 'base:tech.warfare-t2-3' });
  known.submit('army.recruitUnit', { villageId: known.villageId, unitDef: 'base:unit.swordsman' });
  assert.ok(known.events.some((e) => e.type === 'army.unitRecruited'), `known tech opens the gate: ${known.lastRejection()}`);
});

test('recruit: rejections by name — unknown unit, unknown village', () => {
  const m = makeMilitary();
  m.submit('army.recruitUnit', { villageId: m.villageId, unitDef: 'base:unit.nonexistent' });
  assert.match(m.lastRejection(), /unknown unit/);
  m.submit('army.recruitUnit', { villageId: 999999, unitDef: 'base:unit.militia' });
  assert.match(m.lastRejection(), /no such village/);
});

test('recruit: insufficient population, gold, and resources reject atomically by name', () => {
  const m = makeMilitary();
  // insufficient gold: drain the treasury below militia's costGold (10)
  m.setTreasury(5);
  const goldBefore = m.totalPop();
  m.submit('army.recruitUnit', { villageId: m.villageId, unitDef: 'base:unit.militia' });
  assert.match(m.lastRejection(), /insufficient gold/);
  assert.equal(m.totalPop(), goldBefore);
  m.setTreasury(100);

  // insufficient resources: drain tools below militia's cost (5)
  m.setTools(0);
  m.submit('army.recruitUnit', { villageId: m.villageId, unitDef: 'base:unit.militia' });
  assert.match(m.lastRejection(), /insufficient base:resource.tools/);
  m.setTools(200);

  // insufficient population: recruit until adults run out (30 / 10 per unit = 3)
  recruit(m);
  recruit(m);
  recruit(m);
  const popBefore = m.totalPop();
  const goldBefore2 = m.treasury();
  m.submit('army.recruitUnit', { villageId: m.villageId, unitDef: 'base:unit.militia' });
  assert.match(m.lastRejection(), /insufficient adults/);
  assert.equal(m.totalPop(), popBefore, 'rejected recruit must not touch population');
  assert.equal(m.treasury(), goldBefore2, 'rejected recruit must not touch gold');
});

// ---------------- training ----------------

test('training: a freshly recruited unit is untrained; completes after recruitTicks', () => {
  const m = makeMilitary();
  const unit = recruit(m);
  const ui = unit & 0x3fffff;
  assert.equal(m.world.read(m.military.Unit).complete[ui] as number, 0);
  m.days(2); // militia recruitTicks = 24 ticks = 1 day
  assert.equal(m.world.read(m.military.Unit).complete[ui] as number, 1);
  assert.ok(m.events.some((e) => e.type === 'army.unitTrained' && (e.data as { unit: number }).unit === unit));
});

// ---------------- upkeep ----------------

test('upkeep: seasonal gold and food deduct once trained; ledger reconciles', () => {
  const m = makeMilitary();
  const unit = recruit(m);
  m.days(2); // train
  // the kingdom also taxes daily (kingdom.ts), so isolate the upkeep entry
  // in the ledger rather than netting a 90-day treasury delta against taxes
  for (let t = 0; t < TICKS_PER_SEASON; t++) m.kernel.step();
  assert.equal(m.world.isAlive(unit as never), true, 'a fed, funded unit does not desert');
  const upkeepEntries = m.kingdom.ledger.entries().filter((e) => e.kind === 'unit-upkeep');
  assert.equal(upkeepEntries.length, 1, 'exactly one seasonal upkeep charge');
  assert.equal(upkeepEntries[0]?.amount, -2, 'militia upkeepGold is 2, undiscounted (no Marshal)');
  m.reconciles();
});

test('upkeep: an unpayable unit deserts, returning its population, at the seasonal roll-up', () => {
  const m = makeMilitary();
  const unit = recruit(m);
  m.days(2); // train
  // military-upkeep (phase 5 mod TICKS_PER_SEASON) and the daily kingdom tax
  // roll-up (phase 6 mod TICKS_PER_DAY) never land on the same tick — see
  // military.ts's phase choice — so re-zeroing every tick guarantees the
  // treasury is empty at whichever tick upkeep actually fires, without
  // needing to precompute the exact offset within the season. The exact
  // firing tick is otherwise data-dependent, so capture the pop delta across
  // JUST that tick rather than assuming it's the loop's last iteration.
  let delta: number | null = null;
  for (let t = 0; t < TICKS_PER_SEASON && delta === null; t++) {
    m.setTreasury(0);
    const popBefore = m.totalPop();
    const eventsBefore = m.events.length;
    m.kernel.step();
    if (m.events.slice(eventsBefore).some((e) => e.type === 'army.unitDeserted')) {
      delta = m.totalPop() - popBefore;
    }
  }
  assert.ok(delta !== null, 'the unit must desert within one season of an empty treasury');
  assert.ok(Math.abs((delta as number) - 10) < 0.5, 'desertion returns the unit\'s full popCost (10)');
  assert.equal(m.world.isAlive(unit as never), false);
});

// ---------------- armies ----------------

test('armies: create, assign, and disband ungroups without destroying units', () => {
  const m = makeMilitary();
  const unit = recruit(m);
  m.submit('army.createArmy', { name: 'First Legion', villageId: m.villageId });
  const created = m.events.find((e) => e.type === 'army.created');
  assert.ok(created !== undefined);
  const armyId = (created.data as { army: number }).army;

  m.submit('army.assignUnit', { unitId: unit, armyId });
  assert.equal(m.world.read(m.military.Unit).armyId[unit & 0x3fffff] as number, armyId);

  m.submit('army.disbandArmy', { armyId });
  assert.ok(m.events.some((e) => e.type === 'army.disbanded'));
  assert.equal(m.world.isAlive(unit as never), true, 'disbanding an army does not destroy its units');
  assert.equal(m.world.read(m.military.Unit).armyId[unit & 0x3fffff] as number, 0, 'units are ungrouped');
});

// ---------------- the Marshal (kingdom.ts office hook, M25) ----------------

test('the Marshal discounts unit upkeep by martial skill', () => {
  const m = makeMilitary();
  recruit(m);
  m.days(2); // train
  let marshal = -1;
  m.world.query([m.kingdom.Character]).forEach((_i, entity) => {
    if (marshal === -1) marshal = entity as number;
  });
  assert.ok(marshal >= 0);
  m.submit('kingdom.appoint', { office: OFFICES[1], characterId: marshal }); // 'marshal'
  const martial = m.world.read(m.kingdom.Character).martial[marshal & 0x3fffff] as number;
  // isolate the upkeep ledger entry — daily taxes also move the treasury
  for (let t = 0; t < TICKS_PER_SEASON; t++) m.kernel.step();
  const upkeepEntries = m.kingdom.ledger.entries().filter((e) => e.kind === 'unit-upkeep');
  assert.equal(upkeepEntries.length, 1);
  const expected = -2 * (1 - martial / 100); // militia upkeepGold = 2
  assert.ok(Math.abs((upkeepEntries[0]?.amount ?? 0) - expected) < 1e-9, `paid ${upkeepEntries[0]?.amount} must reflect the Marshal's discount (expected ${expected})`);
});

// ---------------- determinism ----------------

test('military: identical histories hash identically', () => {
  const run = (): number => {
    const m = makeMilitary({ seed: 99 });
    const unit = recruit(m);
    m.submit('army.createArmy', { name: 'First Legion', villageId: m.villageId });
    const created = m.events.find((e) => e.type === 'army.created') as { data: { army: number } };
    m.submit('army.assignUnit', { unitId: unit, armyId: created.data.army });
    m.days(1);
    recruit(m, 'base:unit.spearman');
    m.days(400);
    return m.kernel.stateHash();
  };
  assert.equal(run(), run());
});
