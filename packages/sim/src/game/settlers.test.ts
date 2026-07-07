/**
 * Multi-village & founding (M15) — the roadmap test objectives are "founding
 * rules" and "tier upgrade fixtures" (doc 12): every dispatch precondition
 * rejects by name, parties walk with travel time and found through the ONE
 * placement rulebook (re-validated on arrival; a lost site turns the party
 * around with people and cargo conserved — TDD §13 population conservation),
 * the site scorer ranks food/water/buildables (GDD §13), and tier 1 → 2
 * enforces population, variety, materials, and happiness (GDD §5).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DefinitionDatabase, BASE_CONTENT_FILES } from '@crowns/data';
import { Kernel } from '../kernel.js';
import { World } from '../ecs.js';
import { TICKS_PER_DAY } from '../time.js';
import { registerVillageGameplay, VILLAGE_RADIUS_T2, type TerrainAccessor } from './villages.js';
import { registerPopulationGameplay, type StartingPopulation } from './population.js';
import { registerEconomyGameplay } from './economy.js';
import { registerLogisticsGameplay } from './logistics.js';
import {
  registerSettlerGameplay,
  scoreSite,
  bestSiteNear,
  SETTLER_PARTY,
  SETTLER_CARRY,
  TIER2_REQUIREMENTS,
} from './settlers.js';

/** Open plain; a river column at x = 45 splits off the far east. */
const plain: TerrainAccessor = {
  width: 64,
  height: 64,
  tagsAt: () => ['open', 'farmable', 'mineable', 'woodland'],
  riverAt: (x) => x === 45,
  movementCostAt: (x) => (x === 45 ? 0 : 1),
};

const BIG_POP: StartingPopulation = { children: 20, adults: 60, elders: 8 };

function makeRealm(options: { pop?: StartingPopulation; home?: { x: number; y: number } } = {}) {
  const kernel = new Kernel(23);
  const world = new World(512);
  const db = DefinitionDatabase.load(BASE_CONTENT_FILES);
  const stock = { 'base:resource.wood': 500, 'base:resource.stone': 300, 'base:resource.food': 300 };
  const game = registerVillageGameplay(kernel, world, db, plain, stock);
  const popGame = registerPopulationGameplay(kernel, world, db, game, options.pop ?? BIG_POP);
  const econ = registerEconomyGameplay(kernel, world, db, game);
  const Position = world.defineSoA('position', { x: 'f64', y: 'f64' });
  const logi = registerLogisticsGameplay(kernel, world, db, game, popGame, econ, Position);
  const settlers = registerSettlerGameplay(kernel, world, db, game, popGame, econ, logi, Position);
  kernel.attachGuard(world);
  kernel.addHashSource('world', (fold) => world.hash(fold));

  const rejections: string[] = [];
  const events: string[] = [];
  kernel.subscribe<{ what: string; reason: string }>('village.rejected', (e) => {
    rejections.push(`${e.data.what}: ${e.data.reason}`);
  });
  for (const type of ['settlers.dispatched', 'settlers.turnedBack', 'settlers.returned', 'village.upgraded', 'village.founded']) {
    kernel.subscribe(type, () => events.push(type));
  }

  const submit = (type: string, payload: unknown): void => {
    kernel.submit({ type, issuer: 1, payload });
    kernel.step();
  };
  const home = options.home ?? { x: 40, y: 30 };
  submit('village.found', { x: home.x, y: home.y, name: 'Homestead' });
  let villageId = -1;
  world.query([popGame.Population]).forEach((_i, entity) => (villageId = entity as number));
  assert.ok(villageId >= 0);
  const vi = villageId & 0x3fffff;

  const days = (n: number): void => {
    for (let t = 0; t < n * TICKS_PER_DAY; t++) kernel.step();
  };
  const code = (id: string): number => game.ops.resourceCode(id) as number;
  const stockOf = (villageIndex: number, c: number): number =>
    world.readObj(game.comps.Stockpile).tryGet(villageIndex)?.get(c) ?? 0;
  const popOf = (villageIndex: number) => {
    const p = world.read(popGame.Population);
    return {
      children: p.children[villageIndex] as number,
      adults: p.adults[villageIndex] as number,
      elders: p.elders[villageIndex] as number,
      happiness: p.happiness[villageIndex] as number,
    };
  };
  const villages = (): number[] => {
    const out: number[] = [];
    world.query([game.comps.VillageCore]).forEach((i) => out.push(i));
    return out;
  };
  const parties = (): number => {
    let n = 0;
    world.query([settlers.SettlerParty]).forEach(() => n++);
    return n;
  };

  return { kernel, world, db, game, popGame, econ, logi, settlers, villageId, vi, home, days, submit, code, stockOf, popOf, villages, parties, rejections, events };
}

// ---------------- founding rules (the M15 test objective) ----------------

test('founding: dispatch preconditions reject by name', () => {
  const r = makeRealm();
  // too close to home (spacing is the validator's rule)
  r.submit('village.sendSettlers', { villageId: r.villageId, x: r.home.x + 10, y: r.home.y, name: 'TooClose' });
  assert.ok(r.rejections.some((m) => m.includes('too close to another village center')));
  // unreachable: across the impassable river column (and far enough to clear spacing)
  r.submit('village.sendSettlers', { villageId: r.villageId, x: 50, y: 5, name: 'FarShore' });
  assert.ok(r.rejections.some((m) => m.includes('no walkable route')));
  // cargo short: drain the wood
  const stock = r.world.readObj(r.game.comps.Stockpile).get(r.vi);
  const woodCode = r.code('base:resource.wood');
  const wood = stock.get(woodCode) ?? 0;
  stock.set(woodCode, 10);
  r.submit('village.sendSettlers', { villageId: r.villageId, x: 12, y: 30, name: 'Broke' });
  assert.ok(r.rejections.some((m) => m.includes('insufficient base:resource.wood')));
  stock.set(woodCode, wood);
  // cohorts short: a small village must keep its adults
  const p = r.world.write(r.popGame.Population);
  p.adults[r.vi] = SETTLER_PARTY.adults + 5; // < party + MIN_ADULTS_REMAINING
  r.submit('village.sendSettlers', { villageId: r.villageId, x: 12, y: 30, name: 'Empty' });
  assert.ok(r.rejections.some((m) => m.includes('source village too small')));
  assert.equal(r.parties(), 0, 'nothing dispatched');
});

test('founding: a party walks out, founds on arrival, and everyone is accounted for', () => {
  const r = makeRealm();
  const totalBefore = r.settlers.totalPopulation();
  const sourceBefore = r.popOf(r.vi);
  r.submit('village.sendSettlers', { villageId: r.villageId, x: 12, y: 30, name: 'Newholm' });
  assert.equal(r.parties(), 1, 'party on the road');
  // people left the source and are conserved globally while walking
  assert.ok(Math.abs(r.popOf(r.vi).adults - (sourceBefore.adults - SETTLER_PARTY.adults)) < 1e-9);
  assert.ok(Math.abs(r.settlers.totalPopulation() - totalBefore) < 1e-9, 'conserved on the road');
  // travel time is real: not founded yet after a few ticks
  for (let t = 0; t < 5; t++) r.kernel.step();
  assert.equal(r.villages().length, 1, 'still walking (distance is a cost)');

  r.days(3); // ~28 tiles at 1 tile/tick — ample
  assert.equal(r.parties(), 0, 'party dissolved into the new village');
  assert.equal(r.villages().length, 2, 'Newholm founded');
  assert.ok(r.events.includes('village.founded'));

  // the new village carries the party cohorts and the cargo minus the centre
  // cost (± a few days of ordinary demographic drift, which is legitimate)
  const newVi = r.villages().find((v) => v !== r.vi) as number;
  const newPop = r.popOf(newVi);
  assert.ok(Math.abs(newPop.adults - SETTLER_PARTY.adults) < 0.5, 'party adults settled');
  assert.ok(Math.abs(newPop.children - SETTLER_PARTY.children) < 0.5);
  const centerCost = r.db.buildings.get('base:building.village-center')?.cost ?? {};
  const expectedWood = (SETTLER_CARRY['base:resource.wood'] ?? 0) - (centerCost['base:resource.wood'] ?? 0);
  assert.ok(Math.abs(r.stockOf(newVi, r.code('base:resource.wood')) - expectedWood) < 1e-9, 'cargo net of centre cost');
  assert.ok(Math.abs(r.settlers.totalPopulation() - totalBefore) < 1, 'population conserved end to end (± drift)');
});

test('founding: a site claimed en route turns the party around, conserving everything', () => {
  const r = makeRealm();
  const woodCode = r.code('base:resource.wood');
  const sourceBefore = r.popOf(r.vi);
  const woodBefore = r.stockOf(r.vi, woodCode);
  r.submit('village.sendSettlers', { villageId: r.villageId, x: 12, y: 30, name: 'Doomed' });
  // while the party walks, a rival claim lands right next to its target
  r.submit('village.found', { x: 12, y: 32, name: 'Squatter' });
  assert.equal(r.villages().length, 2, 'squatter founded first');
  r.days(6); // walk there, turn around, walk home
  assert.ok(r.events.includes('settlers.turnedBack'), 'party gave up on the lost site');
  assert.ok(r.events.includes('settlers.returned'), 'party made it home');
  assert.equal(r.parties(), 0);
  assert.equal(r.villages().length, 2, 'no third village');
  // people and cargo back where they started (± demographic drift over the
  // round trip); the ledger's settled flow nets exactly zero
  assert.ok(Math.abs(r.popOf(r.vi).adults - sourceBefore.adults) < 0.5, 'adults restored');
  assert.ok(Math.abs(r.stockOf(r.vi, woodCode) - woodBefore) < 1e-9, 'cargo restored');
  const settled = r.econ.ledger.of(r.vi).get(woodCode)?.settled ?? 0;
  assert.ok(Math.abs(settled) < 1e-9, 'ledger settled flow nets zero');
});

// ---------------- site scoring (GDD §13) ----------------

test('scoring: food and water rank sites; bestSiteNear picks the winner deterministically', () => {
  const coastal: TerrainAccessor = {
    width: 64,
    height: 64,
    // west half barren rock; east half farmland; a shoreline at x = 58
    tagsAt: (x) => {
      if (x >= 58) return ['water', 'dockable'];
      if (x >= 30) return ['open', 'farmable'];
      return ['open'];
    },
    riverAt: () => false,
    movementCostAt: (x) => (x >= 58 ? 0 : 1),
  };
  const barren = scoreSite(coastal, 15, 30);
  const farmland = scoreSite(coastal, 40, 30);
  const shore = scoreSite(coastal, 52, 30); // farmland AND water in reach
  assert.ok(farmland > barren, `farmland ${farmland} beats rock ${barren}`);
  assert.ok(shore > barren, 'water access counts');

  const kernel = new Kernel(5);
  const world = new World(128);
  const db = DefinitionDatabase.load(BASE_CONTENT_FILES);
  const game = registerVillageGameplay(kernel, world, db, coastal, {});
  const best = bestSiteNear(game, db, 32, 30, 20);
  assert.ok(best !== null);
  assert.ok(best.x >= 30, `best site (${best.x}, ${best.y}) sits in the farmland, not the rock`);
  // determinism: same query, same answer
  const again = bestSiteNear(game, db, 32, 30, 20);
  assert.deepEqual(best, again);
});

// ---------------- tier upgrade fixtures (the M15 test objective) ----------------

test('tiers: every requirement gates by name, then the upgrade lands and unlocks', () => {
  const r = makeRealm({ pop: { children: 10, adults: 30, elders: 5 } });
  const expectReject = (needle: string): void => {
    r.submit('village.upgrade', { villageId: r.villageId });
    assert.ok(
      r.rejections.some((m) => m.includes(needle)),
      `expected rejection '${needle}', got: ${r.rejections.at(-1) ?? 'none'}`,
    );
    r.rejections.length = 0;
  };

  expectReject('needs population 60'); // 45 people

  const p = r.world.write(r.popGame.Population);
  p.adults[r.vi] = 60;
  p.children[r.vi] = 15;
  p.happiness[r.vi] = 50;
  expectReject('needs happiness 60');

  p.happiness[r.vi] = 75;
  expectReject('distinct completed buildings'); // nothing built yet

  // four distinct buildings, walked to completion by the construction system
  for (const [def, x, y] of [
    ['base:building.house', 38, 28], ['base:building.well', 42, 28],
    ['base:building.farm', 36, 32], ['base:building.granary', 42, 32],
  ] as const) {
    r.submit('village.build', { villageId: r.villageId, def, x, y });
  }
  r.days(6);
  const stock = r.world.readObj(r.game.comps.Stockpile).get(r.vi);
  const woodCode = r.code('base:resource.wood');
  const stoneCode = r.code('base:resource.stone');
  stock.set(woodCode, 10); // materials short
  expectReject('insufficient base:resource.wood');

  stock.set(woodCode, 200);
  const woodBefore = stock.get(woodCode) as number;
  r.submit('village.upgrade', { villageId: r.villageId });
  assert.ok(r.events.includes('village.upgraded'), 'upgrade landed');
  const core = r.world.read(r.game.comps.VillageCore);
  assert.equal(core.tier[r.vi], 2, 'tier 2');
  assert.equal(core.radius[r.vi], VILLAGE_RADIUS_T2, 'radius widened');
  assert.equal(
    stock.get(woodCode),
    woodBefore - (TIER2_REQUIREMENTS.materials['base:resource.wood'] ?? 0),
    'materials consumed',
  );
  void stoneCode;

  // repeat upgrade is refused — tiers 3–4 are later milestones
  r.submit('village.upgrade', { villageId: r.villageId });
  assert.ok(r.rejections.some((m) => m.includes('already tier 2')));
});

test('tiers: gated buildings refuse at tier 1 and rise at tier 2', () => {
  const r = makeRealm({ pop: { children: 15, adults: 60, elders: 5 } });
  // tavern at tier 1: the ONE rulebook says no
  r.submit('village.build', { villageId: r.villageId, def: 'base:building.tavern', x: 38, y: 28 });
  assert.ok(r.rejections.some((m) => m.includes('requires village tier 2')));

  // meet tier 2: variety + happiness + materials (population already suffices)
  const p = r.world.write(r.popGame.Population);
  p.happiness[r.vi] = 75;
  for (const [def, x, y] of [
    ['base:building.house', 38, 26], ['base:building.well', 42, 26],
    ['base:building.farm', 36, 32], ['base:building.granary', 42, 32],
  ] as const) {
    r.submit('village.build', { villageId: r.villageId, def, x, y });
  }
  r.days(6);
  r.submit('village.upgrade', { villageId: r.villageId });
  assert.ok(r.events.includes('village.upgraded'));

  // now the tavern goes up (give the stockpile its planks), and joy follows
  const stock = r.world.readObj(r.game.comps.Stockpile).get(r.vi);
  stock.set(r.code('base:resource.planks'), 20);
  const happinessBefore = r.popOf(r.vi).happiness;
  r.submit('village.build', { villageId: r.villageId, def: 'base:building.tavern', x: 38, y: 28 });
  r.days(10); // build (72 ticks) + EMA drift
  assert.ok(
    r.popOf(r.vi).happiness > happinessBefore + 2,
    `tavern lifts joy (${happinessBefore.toFixed(1)} → ${r.popOf(r.vi).happiness.toFixed(1)})`,
  );
});

// ---------------- determinism ----------------

test('settlers: identical histories hash identically', () => {
  const run = (): number => {
    const r = makeRealm();
    r.submit('village.sendSettlers', { villageId: r.villageId, x: 12, y: 30, name: 'Newholm' });
    r.days(10);
    r.submit('village.upgrade', { villageId: r.villageId }); // rejected — also deterministic
    r.days(5);
    return r.kernel.stateHash();
  };
  assert.equal(run(), run());
});
