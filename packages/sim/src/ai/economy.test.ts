/**
 * AI kingdom-economy manager (M-era, economy.ts) — the fiscal policy that gave
 * an AI kingdom a reason to touch its tax rate, edicts and tier upgrade. Tests
 * cover the pure tax policy (plan → rate, clamped by happiness) and the daily
 * manager against a live single-kingdom world.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DefinitionDatabase, BASE_CONTENT_FILES } from '@crowns/data';
import { Kernel } from '../kernel.js';
import { World } from '../ecs.js';
import { TICKS_PER_DAY } from '../time.js';
import { registerVillageGameplay, type TerrainAccessor } from '../game/villages.js';
import { registerPopulationGameplay } from '../game/population.js';
import { registerEconomyGameplay } from '../game/economy.js';
import { registerLogisticsGameplay } from '../game/logistics.js';
import { registerSettlerGameplay } from '../game/settlers.js';
import { registerKingdomGameplay, StatModifiers } from '../game/kingdom.js';
import { registerAiEconomyManager, desiredTaxRate, HAPPY_HIGH } from './economy.js';

const plain: TerrainAccessor = {
  width: 64,
  height: 64,
  tagsAt: () => ['open', 'farmable', 'mineable', 'woodland'],
  riverAt: () => false,
  movementCostAt: () => 1,
};

// ---------------------------------------------------------------- pure policy

test('desiredTaxRate: plan-driven with no baseline — NONE for peaceful growth', () => {
  assert.equal(desiredTaxRate('DevelopHeartland', 60), 0); // NONE
  assert.equal(desiredTaxRate('ExpandSettle', 60), 0);
  assert.equal(desiredTaxRate('ForgeAlliance', 80), 0);
});

test('desiredTaxRate: warlike taxes HIGH, TechRace taxes LOW', () => {
  assert.equal(desiredTaxRate('MilitaryBuildup', 80), 3); // HIGH
  assert.equal(desiredTaxRate('ConquestWar', 80), 3);
  assert.equal(desiredTaxRate('PunitiveRaid', 80), 3);
  assert.equal(desiredTaxRate('TechRace', 80), 1); // LOW
});

test('desiredTaxRate: happiness clamp overrides the plan', () => {
  assert.equal(desiredTaxRate('ConquestWar', 59), 1, 'below 60 joy → at most LOW');
  assert.equal(desiredTaxRate('ConquestWar', 44), 0, 'below 45 joy → NONE, recover');
  assert.equal(desiredTaxRate('TechRace', 44), 0, 'clamp applies to LOW plans too');
  assert.equal(desiredTaxRate('DevelopHeartland', 30), 0, 'already NONE, stays NONE');
});

// ---------------------------------------------------------------- live manager

function makeKingdom() {
  const kernel = new Kernel(31);
  const world = new World(512);
  const db = DefinitionDatabase.load(BASE_CONTENT_FILES);
  const stock = { 'base:resource.wood': 600, 'base:resource.stone': 300, 'base:resource.food': 300 };
  const mods = new StatModifiers();
  const game = registerVillageGameplay(kernel, world, db, plain, stock);
  const popGame = registerPopulationGameplay(kernel, world, db, game, { children: 12, adults: 30, elders: 5 }, mods);
  const econ = registerEconomyGameplay(kernel, world, db, game, mods);
  const Position = world.defineSoA('position', { x: 'f64', y: 'f64' });
  const logi = registerLogisticsGameplay(kernel, world, db, game, popGame, econ, Position);
  registerSettlerGameplay(kernel, world, db, game, popGame, econ, logi, Position); // registers village.upgrade
  const kingdomGame = registerKingdomGameplay(kernel, world, db, game, popGame, econ, mods);
  kernel.attachGuard(world);

  const rejections: string[] = [];
  kernel.subscribe<{ what: string; reason: string }>('village.rejected', (e) => rejections.push(`${e.data.what}: ${e.data.reason}`));

  // Systems must be registered before the first tick — so the manager binds via lazy getters
  // (villageId/kingdomId only exist after genesis + found run on that first step). It early-returns
  // while `vId`/`kId` are still the -1 sentinel, exactly as it would for a not-yet-alive village.
  let plan = 'DevelopHeartland';
  let vId = -1;
  let kId = -1;
  registerAiEconomyManager(kernel, world, db, game, popGame, kingdomGame, {
    issuer: 1,
    get villageId(): never {
      return vId as never;
    },
    get kingdomId(): never {
      return kId as never;
    },
    getPlan: () => plan,
  });

  const submit = (type: string, payload: unknown): void => {
    kernel.submit({ type, issuer: 1, payload });
    kernel.step();
  };
  submit('village.found', { x: 30, y: 30, name: 'Crownton' });
  world.query([popGame.Population]).forEach((_i, entity) => (vId = entity as number));
  assert.ok(vId >= 0);
  const kingdomId = kingdomGame.kingdomEntities()[0];
  if (kingdomId === undefined) throw new Error('kingdom genesis did not run');
  kId = kingdomId;
  const vIndex = vId & 0x3fffff;
  const kIndex = kId & 0x3fffff;

  const taxRate = (): number => world.read(game.comps.VillageCore).taxRate[vIndex] as number;
  const setHappiness = (value: number): void => {
    world.write(popGame.Population).happiness[vIndex] = value;
  };
  const activeEdicts = (): string[] => {
    const active = world.readObj(kingdomGame.ActiveEdicts).tryGet(kIndex);
    const ids = [...db.edicts.keys()].sort();
    return [...(active?.keys() ?? [])].map((code) => ids[code] as string);
  };
  const setAdults = (n: number): void => {
    world.write(popGame.Population).adults[vIndex] = n;
  };
  // Run whole game-days (the manager is a once-per-day system) while PINNING happiness at the start
  // of every tick — the daily kingdom rollup drifts it otherwise, and these tests assert on a
  // controlled happiness band. The manager reads happiness after that same tick's rollup, so at most
  // one day's small drift separates the pinned value from what it sees; test margins absorb it.
  const runDays = (n: number, happiness: number): void => {
    for (let i = 0; i < n * TICKS_PER_DAY + 2; i++) {
      setHappiness(happiness);
      kernel.step();
    }
  };
  return { kernel, world, db, game, popGame, kingdomGame, rejections, vIndex, villageId: vId, kingdomId, taxRate, setHappiness, setAdults, activeEdicts, setPlan: (p: string) => (plan = p), step: () => kernel.step(), runDays };
}

test('manager: a fresh peaceful capital drops its NORMAL start tax to NONE', () => {
  const v = makeKingdom();
  assert.equal(v.taxRate(), 2, 'villages found at NORMAL');
  v.runDays(1, 65); // DevelopHeartland, comfortable joy
  assert.equal(v.taxRate(), 0, 'DevelopHeartland above 60 joy → NONE');
});

test('manager: a warlike plan taxes HIGH, then the happiness clamp reins it in', () => {
  const v = makeKingdom();
  v.setPlan('ConquestWar');
  v.runDays(1, 80);
  assert.equal(v.taxRate(), 3, 'ConquestWar at 80 joy → HIGH');

  v.runDays(1, 54); // joy has fallen under the tax pressure (in the [45,60) clamp band)
  assert.equal(v.taxRate(), 1, 'below 60 joy → clamp to LOW');
});

test('manager: a content peaceful kingdom takes the free corvée-labor edict', () => {
  const v = makeKingdom();
  v.runDays(1, HAPPY_HIGH + 8); // content headroom
  assert.ok(v.activeEdicts().includes('base:edict.corvee-labor'), `expected corvée active, got ${v.activeEdicts().join(',')}`);
});

test('manager: corvée is repealed once its happiness cost drags joy below the floor', () => {
  const v = makeKingdom();
  v.runDays(1, HAPPY_HIGH + 8);
  assert.ok(v.activeEdicts().includes('base:edict.corvee-labor'));

  v.runDays(1, 40); // below HAPPY_LOW (45)
  assert.ok(!v.activeEdicts().includes('base:edict.corvee-labor'), 'corvée shed to recover joy');
});

test('manager: submits the tier-2 upgrade only once the population and happiness gates are met', () => {
  const v = makeKingdom();
  v.runDays(1, 65);
  assert.ok(!v.rejections.some((r) => r.startsWith('village.upgrade')), 'no upgrade attempt below the population gate');

  // meet the slow gates: pop >= 60 and happiness >= 60. Materials/distinct are unmet
  // (this capital built nothing), so the command rejects — proving the manager submitted the order.
  v.setAdults(70);
  v.rejections.length = 0;
  v.runDays(1, 65);
  assert.ok(v.rejections.some((r) => r.startsWith('village.upgrade')), `expected an upgrade attempt, rejections: ${v.rejections.join(' | ')}`);
});
