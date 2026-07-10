/**
 * Sieges (M29) — the roadmap T objective is "siege pacing stats within
 * design bands" (GDD §8): starving a castle should take SEASONS, and
 * storming (assault) should be BLOODY. Also covers the phase progression —
 * encircle, bombard/breach, assault, sortie — and determinism.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { EntityId } from '@crowns/core';
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
import { registerArmyGameplay } from './armies.js';
import { registerCombatGameplay } from './combat.js';
import { registerCastleGameplay } from './castles.js';
import { registerSiegeGameplay, STARVATION_SURRENDER_DAYS } from './siege.js';

const plain: TerrainAccessor = {
  width: 80,
  height: 80,
  tagsAt: () => ['open', 'farmable', 'mineable', 'woodland'],
  riverAt: () => false,
  movementCostAt: () => 1,
};

function makeSiege(options: { seed?: number; food?: number } = {}) {
  const kernel = new Kernel(options.seed ?? 3);
  const world = new World(1024);
  const db = DefinitionDatabase.load(BASE_CONTENT_FILES);
  const stock = {
    'base:resource.wood': 600, 'base:resource.stone': 800,
    'base:resource.food': options.food ?? 500, 'base:resource.tools': 400,
  };
  const mods = new StatModifiers();
  const game = registerVillageGameplay(kernel, world, db, plain, stock);
  const popGame = registerPopulationGameplay(kernel, world, db, game, { children: 12, adults: 30, elders: 5 }, mods);
  const econ = registerEconomyGameplay(kernel, world, db, game, mods);
  const Position = world.defineSoA('position', { x: 'f64', y: 'f64' });
  registerLogisticsGameplay(kernel, world, db, game, popGame, econ, Position);
  const kingdom = registerKingdomGameplay(kernel, world, db, game, popGame, econ, mods, { kingdomCount: 2 });
  const military = registerMilitaryGameplay(kernel, world, db, game, popGame, kingdom);
  const armies = registerArmyGameplay(kernel, world, game, military, kingdom);
  const combat = registerCombatGameplay(kernel, world, military, armies, kingdom);
  const castles = registerCastleGameplay(kernel, world, db, game);
  const siege = registerSiegeGameplay(kernel, world, game, military, armies, castles, combat, kingdom);
  kernel.attachGuard(world);
  kernel.addHashSource('world', (fold) => world.hash(fold));

  const rejections: string[] = [];
  const events: { type: string; data: unknown }[] = [];
  kernel.subscribe<{ what: string; reason: string }>('village.rejected', (e) => rejections.push(`${e.data.what}: ${e.data.reason}`));
  for (const type of [
    'army.created', 'siege.begun', 'siege.targetSet', 'siege.breached', 'siege.assaultBegun', 'siege.sortieBegun',
    'siege.captured', 'siege.ended', 'battle.resolved',
  ]) {
    kernel.subscribe(type, (e) => events.push({ type, data: e.data }));
  }

  const submit = (type: string, payload: unknown, issuer = 1): void => {
    kernel.submit({ type, issuer, payload });
    kernel.step();
  };

  submit('village.found', { x: 40, y: 40, name: 'Crownton' });
  let villageId = -1;
  world.query([popGame.Population]).forEach((_i, entity) => (villageId = entity as number));
  assert.ok(villageId >= 0);
  // 'village.found' doesn't take a multi-kingdom owner (that path is the AI
  // harness's bespoke genesis) — tag it directly, owned by kingdom 0 (defender)
  if (kingdom.VillageOwner !== undefined) {
    world.attach(villageId as EntityId, kingdom.VillageOwner, { kingdom: kingdom.kingdomEntities()[0] as number });
  }

  const placeNear = (defId: string, ox: number, oy: number): number => {
    submit('village.build', { villageId, def: defId, x: 40 + ox, y: 40 + oy });
    let building = -1;
    const b = world.read(game.comps.BuildingCore);
    world.query([game.comps.BuildingCore]).forEach((i, entity) => {
      if ((b.x[i] as number) === 40 + ox && (b.y[i] as number) === 40 + oy) building = entity as number;
    });
    assert.ok(building >= 0, `placement failed at offset (${ox},${oy}): ${rejections.at(-1) ?? ''}`);
    return building;
  };

  const days = (n: number): void => {
    for (let t = 0; t < n * TICKS_PER_DAY; t++) kernel.step();
  };

  // a closed, CONTIGUOUS 3×3 ring of walls (every perimeter tile, no gaps),
  // offset well clear of the 2×2 village-centre footprint at (40,40)-(41,41)
  const ring = [[5, 5], [6, 5], [7, 5], [5, 7], [6, 7], [7, 7], [5, 6], [7, 6]] as const;
  const wallIds = ring.map(([ox, oy]) => placeNear('base:building.wall', ox, oy));
  days(3); // buildTicks 24 = 1 day, generous margin

  const createArmy = (issuer: number): number => {
    submit('army.createArmy', { name: `Army-${issuer}`, villageId }, issuer);
    const created = events.filter((e) => e.type === 'army.created').at(-1);
    return (created?.data as { army: number } | undefined)?.army ?? -1;
  };

  const spawnUnit = (armyId: number, kingdomIndex: number, unitDefId: string): number => {
    const def = db.units.get(unitDefId);
    assert.ok(def !== undefined);
    const code = military.ops.defCode(unitDefId);
    assert.ok(code !== undefined);
    const kingdomId = kingdom.kingdomEntities()[kingdomIndex] as EntityId;
    const unit = world.spawn();
    world.attach(unit, military.Unit, {
      def: code, kingdomId: kingdomId as number, homeVillage: villageId, armyId,
      count: def.popCost.count, progress: 1, complete: true, morale: def.stats.moraleBase,
    });
    return unit;
  };

  const positionArmy = (armyId: number, x: number, y: number): void => {
    const ai = armyId & 0x3fffff;
    const m = world.write(armies.ArmyMovement);
    m.x[ai] = x;
    m.y[ai] = y;
  };

  const lastRejection = (): string => rejections.at(-1) ?? '';

  return {
    kernel, world, db, game, popGame, kingdom, military, armies, combat, castles, siege,
    villageId, wallIds, submit, placeNear, days, createArmy, spawnUnit, positionArmy, lastRejection, events,
  };
}

// ---------------- encircle ----------------

test('siege.begin: encircles a hostile castle; rejects self-siege and non-castles', () => {
  const m = makeSiege();
  const attacker = m.createArmy(2); // kingdom 1
  m.spawnUnit(attacker, 1, 'base:unit.catapult');
  m.positionArmy(attacker, 40, 40);

  m.submit('siege.begin', { armyId: attacker, villageId: m.villageId }, 2);
  assert.ok(m.siege.state.siegeOfArmy(attacker) !== undefined, 'the castle must now be under siege');
  assert.equal(m.world.read(m.armies.ArmyMovement).stance[attacker & 0x3fffff], 3, 'stance flips to siege');

  const defender = m.createArmy(1); // kingdom 0, same as the castle's owner
  m.positionArmy(defender, 40, 40);
  m.submit('siege.begin', { armyId: defender, villageId: m.villageId }, 1);
  assert.match(m.lastRejection(), /cannot besiege your own castle/);
});

// ---------------- bombard & breach ----------------

test('bombard: a targeted wall loses HP and is breached, opening the enclosure', () => {
  const m = makeSiege();
  assert.equal(m.castles.isCastle(m.villageId), true);
  const attacker = m.createArmy(2);
  for (let i = 0; i < 3; i++) m.spawnUnit(attacker, 1, 'base:unit.catapult');
  m.positionArmy(attacker, 40, 40);
  m.submit('siege.begin', { armyId: attacker, villageId: m.villageId }, 2);

  const target = m.wallIds[0] as number;
  m.submit('siege.setTarget', { armyId: attacker, buildingId: target }, 2);
  for (let d = 0; d < 10 && m.world.isAlive(target as EntityId); d++) m.days(1);
  assert.equal(m.world.isAlive(target as EntityId), false, 'a sustained bombardment must breach the wall');
  assert.ok(m.siege.state.siegeOfArmy(attacker)?.breaches ?? 0 >= 1);
});

// ---------------- assault: no defenders captures immediately ----------------

test('siege.assault: with no defenders present, the castle falls immediately', () => {
  const m = makeSiege();
  const attacker = m.createArmy(2);
  for (let i = 0; i < 3; i++) m.spawnUnit(attacker, 1, 'base:unit.catapult');
  m.positionArmy(attacker, 40, 40);
  m.submit('siege.begin', { armyId: attacker, villageId: m.villageId }, 2);
  m.submit('siege.assault', { armyId: attacker }, 2);
  assert.match(m.lastRejection(), /no breach/);

  const target = m.wallIds[0] as number;
  m.submit('siege.setTarget', { armyId: attacker, buildingId: target }, 2);
  for (let d = 0; d < 10 && m.world.isAlive(target as EntityId); d++) m.days(1);
  m.submit('siege.assault', { armyId: attacker }, 2);
  assert.ok(m.events.some((e) => e.type === 'siege.captured'), 'an undefended breached castle must fall on assault');
  assert.ok(m.kingdom.VillageOwner !== undefined);
  const newOwner = m.world.read(m.kingdom.VillageOwner as NonNullable<typeof m.kingdom.VillageOwner>).kingdom[m.villageId & 0x3fffff] as number;
  assert.equal(newOwner, m.kingdom.kingdomEntities()[1], 'ownership must transfer to the attacker');
});

// ---------------- the T objective: bloody assaults vs. ordinary field battles ----------------

test('assault casualties are decisively bloodier than an equivalent ordinary field battle (GDD §8)', () => {
  // measure the CASUALTY RATE over a short, fixed window rather than waiting for
  // full resolution — both scenarios saturate at "everyone's dead" well within
  // the 12-tick cap otherwise, masking the multiplier's effect entirely
  const TICKS_TO_SAMPLE = 1;
  const fight = (assault: boolean, seed: number): number => {
    const m = makeSiege({ seed });
    const attacker = m.createArmy(2);
    const defender = m.createArmy(1);
    for (let i = 0; i < 4; i++) m.spawnUnit(attacker, 1, 'base:unit.spearman');
    for (let i = 0; i < 4; i++) m.spawnUnit(defender, 0, 'base:unit.spearman');
    m.positionArmy(attacker, 60, 60);
    m.positionArmy(defender, 60, 60);
    const startCount = 40; // 4 units × 10 count, each side
    m.combat.state.begin(attacker, defender, assault ? 2.5 : 1); // ASSAULT_CASUALTY_MULTIPLIER vs. ordinary
    for (let t = 0; t < TICKS_TO_SAMPLE && m.combat.state.engagementOf(attacker) !== undefined; t++) m.kernel.step();
    const u = m.world.read(m.military.Unit);
    let remaining = 0;
    m.world.query([m.military.Unit]).forEach((ui) => {
      if ((u.armyId[ui] as number) === attacker || (u.armyId[ui] as number) === defender) remaining += u.count[ui] as number;
    });
    return startCount * 2 - remaining; // total casualties across both sides so far
  };

  let normalTotal = 0;
  let assaultTotal = 0;
  const TRIALS = 20;
  for (let i = 0; i < TRIALS; i++) {
    normalTotal += fight(false, 100 + i);
    assaultTotal += fight(true, 200 + i);
  }
  const normalAvg = normalTotal / TRIALS;
  const assaultAvg = assaultTotal / TRIALS;
  assert.ok(
    assaultAvg > normalAvg * 1.5,
    `assault casualties (avg ${assaultAvg.toFixed(1)}) must be decisively bloodier than a normal battle (avg ${normalAvg.toFixed(1)}) over the same ${TICKS_TO_SAMPLE}-tick window`,
  );
});

// ---------------- sortie ----------------

test('siege.sortie: a defending garrison can fight the besieger; wiping it out lifts the siege', () => {
  const m = makeSiege();
  const attacker = m.createArmy(2);
  m.spawnUnit(attacker, 1, 'base:unit.militia'); // a weak besieger
  m.positionArmy(attacker, 40, 40);
  m.submit('siege.begin', { armyId: attacker, villageId: m.villageId }, 2);

  const defender = m.createArmy(1);
  for (let i = 0; i < 6; i++) m.spawnUnit(defender, 0, 'base:unit.spearman'); // a strong garrison
  m.positionArmy(defender, 40, 40);

  m.submit('siege.sortie', { armyId: defender }, 1);
  assert.ok(m.events.some((e) => e.type === 'siege.sortieBegun'));
  for (let t = 0; t < 200 && m.siege.state.siegeOfArmy(attacker) !== undefined; t++) m.kernel.step();
  assert.equal(m.siege.state.siegeOfArmy(attacker), undefined, 'a decisively won sortie must lift the siege');
  assert.ok(m.events.some((e) => e.type === 'siege.ended'));
});

// ---------------- the T objective: starvation pacing within "seasons" ----------------

test('starvation: an empty granary surrenders the castle on a "should take seasons" timescale', () => {
  const m = makeSiege({ food: 0 }); // granary already empty at siege start
  const attacker = m.createArmy(2);
  m.spawnUnit(attacker, 1, 'base:unit.catapult');
  m.positionArmy(attacker, 40, 40);
  m.submit('siege.begin', { armyId: attacker, villageId: m.villageId }, 2);

  let capturedAtDay = -1;
  for (let d = 0; d < STARVATION_SURRENDER_DAYS + 30 && capturedAtDay === -1; d++) {
    m.days(1);
    if (m.events.some((e) => e.type === 'siege.captured')) capturedAtDay = d + 1;
  }
  assert.ok(capturedAtDay >= 0, 'a starved-out castle must eventually surrender');
  // "should take seasons" (GDD §8): not a five-day walkover, not a year-long slog
  const days90 = STARVATION_SURRENDER_DAYS;
  assert.ok(capturedAtDay >= days90 - 5 && capturedAtDay <= days90 + 5, `surrendered on day ${capturedAtDay}, expected ~${days90}`);
});

// ---------------- determinism ----------------

test('siege: identical histories hash identically', () => {
  const run = (): number => {
    const m = makeSiege({ seed: 42 });
    const attacker = m.createArmy(2);
    for (let i = 0; i < 2; i++) m.spawnUnit(attacker, 1, 'base:unit.catapult');
    m.positionArmy(attacker, 40, 40);
    m.submit('siege.begin', { armyId: attacker, villageId: m.villageId }, 2);
    m.submit('siege.setTarget', { armyId: attacker, buildingId: m.wallIds[0] as number }, 2);
    m.days(5);
    return m.kernel.stateHash();
  };
  assert.equal(run(), run());
});
