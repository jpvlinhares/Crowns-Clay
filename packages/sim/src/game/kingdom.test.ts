/**
 * Kingdom layer (M16) — the roadmap test objective is "ledger reconciles to
 * the coin" (doc 12): the treasury must equal starting gold plus the signed
 * sum of every ledger entry, through tax-rate changes, edicts enacted /
 * repealed / lapsed, and advisors hired and buried. Plus: the tax curve is
 * self-defeating at punitive rates (GDD §2), every edict modifier is
 * observable in the sim, and the whole layer stays deterministic.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DefinitionDatabase, BASE_CONTENT_FILES } from '@crowns/data';
import { Kernel } from '../kernel.js';
import { World } from '../ecs.js';
import { TICKS_PER_DAY, TICKS_PER_YEAR } from '../time.js';
import { registerVillageGameplay, type TerrainAccessor } from './villages.js';
import { registerPopulationGameplay } from './population.js';
import { registerEconomyGameplay } from './economy.js';
import { registerLogisticsGameplay } from './logistics.js';
import {
  registerKingdomGameplay,
  StatModifiers,
  STARTING_TREASURY,
  EDICT_CAP,
  ADVISOR_SALARY,
  OFFICES,
} from './kingdom.js';

const plain: TerrainAccessor = {
  width: 64,
  height: 64,
  tagsAt: () => ['open', 'farmable', 'mineable', 'woodland'],
  riverAt: () => false,
  movementCostAt: () => 1,
};

function makeKingdom(options: { seed?: number; farms?: number; houses?: number; food?: number } = {}) {
  const kernel = new Kernel(options.seed ?? 31);
  const world = new World(512);
  const db = DefinitionDatabase.load(BASE_CONTENT_FILES);
  const stock = { 'base:resource.wood': 600, 'base:resource.stone': 300, 'base:resource.food': options.food ?? 300 };
  const mods = new StatModifiers();
  const game = registerVillageGameplay(kernel, world, db, plain, stock);
  const popGame = registerPopulationGameplay(kernel, world, db, game, { children: 12, adults: 30, elders: 5 }, mods);
  const econ = registerEconomyGameplay(kernel, world, db, game, mods);
  const Position = world.defineSoA('position', { x: 'f64', y: 'f64' });
  const logi = registerLogisticsGameplay(kernel, world, db, game, popGame, econ, Position);
  const kingdom = registerKingdomGameplay(kernel, world, db, game, popGame, econ, mods);
  kernel.attachGuard(world);
  kernel.addHashSource('world', (fold) => world.hash(fold));

  const rejections: string[] = [];
  const events: { type: string; data: unknown }[] = [];
  kernel.subscribe<{ what: string; reason: string }>('village.rejected', (e) => {
    rejections.push(`${e.data.what}: ${e.data.reason}`);
  });
  for (const type of ['kingdom.rollup', 'kingdom.edictLapsed', 'character.died', 'kingdom.officeVacated']) {
    kernel.subscribe(type, (e) => events.push({ type, data: e.data }));
  }

  const submit = (type: string, payload: unknown): void => {
    kernel.submit({ type, issuer: 1, payload });
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
  for (let f = 0; f < (options.farms ?? 2); f++) placeNear('base:building.farm');
  for (let h = 0; h < (options.houses ?? 6); h++) placeNear('base:building.house');

  const days = (n: number): void => {
    for (let t = 0; t < n * TICKS_PER_DAY; t++) kernel.step();
  };
  const happiness = (): number => {
    const p = world.read(popGame.Population);
    return p.happiness[vi] as number;
  };
  const reconciles = (): void => {
    const expected = STARTING_TREASURY + kingdom.ledger.sum();
    assert.ok(
      Math.abs(kingdom.treasury() - expected) < 1e-9,
      `treasury ${kingdom.treasury()} must equal start + ledger sum ${expected}`,
    );
  };

  return { kernel, world, db, game, popGame, econ, logi, kingdom, mods, villageId, vi, days, submit, placeNear, happiness, reconciles, rejections, events };
}

// ---------------- the T objective: ledger reconciles to the coin ----------------

test('ledger: the treasury reconciles to the coin through a turbulent season', () => {
  const k = makeKingdom({ farms: 3, houses: 8 });
  k.days(10); // construction, staffing, first tax days
  k.reconciles();

  // pick an advisor and seat them; enact and later repeal edicts; swing taxes
  let advisor = -1;
  k.world.query([k.kingdom.Character]).forEach((_i, entity) => {
    if (advisor < 0) advisor = entity as number;
  });
  k.submit('kingdom.appoint', { office: 'steward', characterId: advisor });
  k.submit('kingdom.enactEdict', { edict: 'base:edict.harvest-festival' });
  k.submit('kingdom.enactEdict', { edict: 'base:edict.grain-reserves' });
  k.days(20);
  k.reconciles();

  k.submit('village.setTaxRate', { villageId: k.villageId, rate: 3 }); // high
  k.submit('kingdom.repealEdict', { edict: 'base:edict.harvest-festival' });
  k.days(30);
  k.reconciles();

  k.submit('village.setTaxRate', { villageId: k.villageId, rate: 0 }); // none
  k.days(30);
  k.reconciles();

  // all three flow kinds appeared, and every entry is signed correctly
  const kinds = new Set(k.kingdom.ledger.entries().map((e) => e.kind));
  assert.deepEqual([...kinds].sort(), ['advisor-salary', 'edict-upkeep', 'tax']);
  for (const e of k.kingdom.ledger.entries()) {
    assert.ok(e.kind === 'tax' ? e.amount > 0 : e.amount < 0, `${e.kind} signed`);
  }
});

// ---------------- the tax curve (GDD §2: high tax forever is self-defeating) ----------------

test('taxes: punitive rates bleed happiness and eat their own base', () => {
  const normal = makeKingdom({ seed: 41 });
  const punitive = makeKingdom({ seed: 41 });
  punitive.submit('village.setTaxRate', { villageId: punitive.villageId, rate: 4 });
  normal.days(120);
  punitive.days(120);

  assert.ok(
    punitive.happiness() < normal.happiness() - 15,
    `punitive happiness ${punitive.happiness().toFixed(0)} far below normal ${normal.happiness().toFixed(0)}`,
  );
  // the punitive take decays from its peak as the happiness factor collapses
  const takes = punitive.events
    .filter((e) => e.type === 'kingdom.rollup')
    .map((e) => (e.data as { taxes: number }).taxes)
    .filter((t) => t > 0);
  const peak = Math.max(...takes.slice(0, 40));
  const late = takes.slice(-10).reduce((a, b) => a + b, 0) / 10;
  assert.ok(late < peak * 0.8, `late take ${late.toFixed(2)} decays below peak ${peak.toFixed(2)}`);
  normal.reconciles();
  punitive.reconciles();
});

// ---------------- edicts v1 ----------------

test('edicts: rejections by name, then every modifier is observable in the sim', () => {
  // one farm, light stores: the stockpile never hits its cap, so production
  // runs uninterrupted and the corvée effect is measured cleanly
  const k = makeKingdom({ farms: 1, food: 100 });
  k.days(8);

  k.submit('kingdom.enactEdict', { edict: 'base:edict.moon-tax' });
  assert.ok(k.rejections.some((m) => m.includes("unknown edict 'base:edict.moon-tax'")));

  // corvée: +15% production, measured at the farm gate
  k.econ.ledger.drain();
  k.days(5);
  const foodCode = k.game.ops.resourceCode('base:resource.food') as number;
  const baseProduced = k.econ.ledger.drain().get(k.vi)?.get(foodCode)?.produced ?? 0;
  k.submit('kingdom.enactEdict', { edict: 'base:edict.corvee-labor' });
  k.econ.ledger.drain();
  k.days(5);
  const corveeProduced = k.econ.ledger.drain().get(k.vi)?.get(foodCode)?.produced ?? 0;
  assert.ok(
    Math.abs(corveeProduced / baseProduced - 1.15) < 0.02,
    `corvée lifts production ~15% (${baseProduced.toFixed(1)} → ${corveeProduced.toFixed(1)})`,
  );

  // grain reserves: spoilage halves
  k.submit('kingdom.enactEdict', { edict: 'base:edict.grain-reserves' });
  assert.ok(Math.abs(k.mods.mul('village.spoilage') - 0.5) < 1e-9, 'spoilage modifier live');

  // stacking cap
  k.submit('kingdom.enactEdict', { edict: 'base:edict.harvest-festival' });
  k.submit('kingdom.enactEdict', { edict: 'base:edict.harvest-festival' });
  assert.ok(
    k.rejections.some((m) => m.includes(`edict cap reached (${EDICT_CAP})`)) ||
      k.rejections.some((m) => m.includes('already enacted')),
    'cap or duplicate enforced',
  );

  // repeal: the modifier leaves the board
  k.submit('kingdom.repealEdict', { edict: 'base:edict.corvee-labor' });
  assert.ok(Math.abs(k.mods.mul('village.productionEfficiency') - 1) < 1e-9, 'corvée gone after repeal');
  k.reconciles();
});

test('edicts: an unpayable edict lapses at the roll-up, by event', () => {
  const k = makeKingdom();
  k.days(5);
  k.submit('kingdom.enactEdict', { edict: 'base:edict.harvest-festival' }); // upkeep 6/day
  // drain the treasury below one day of upkeep and stop all income
  k.submit('village.setTaxRate', { villageId: k.villageId, rate: 0 });
  const ki = (k.kingdom.kingdomEntity() as number) & 0x3fffff;
  k.world.write(k.kingdom.Kingdom).treasury[ki] = 3;
  k.days(3);
  assert.ok(k.events.some((e) => e.type === 'kingdom.edictLapsed'), 'edict lapsed');
  assert.ok(Math.abs(k.mods.add('village.happinessDrift')) < 1e-9, 'its modifier left the board');
});

// ---------------- advisors v1 ----------------

test('advisors: a steward multiplies the take, draws a salary, and dies in office', () => {
  const k = makeKingdom({ farms: 3 });
  k.days(10);

  // the candidate pool exists with doc 06 skills
  const candidates: number[] = [];
  k.world.query([k.kingdom.Character]).forEach((_i, entity) => candidates.push(entity as number));
  assert.ok(candidates.length >= 4, 'a court to choose from');

  // pick the best steward deterministically
  const c = k.world.read(k.kingdom.Character);
  const best = candidates.reduce((a, b) =>
    (c.stewardship[b & 0x3fffff] as number) > (c.stewardship[a & 0x3fffff] as number) ? b : a,
  );
  const skill = c.stewardship[best & 0x3fffff] as number;

  // measure a taxed window without, then with, the steward
  const takeOver = (days: number): number => {
    const before = k.kingdom.ledger.entries().length;
    k.days(days);
    return k.kingdom.ledger.entries().slice(before).filter((e) => e.kind === 'tax').reduce((s, e) => s + e.amount, 0);
  };
  const bare = takeOver(10);
  k.submit('kingdom.appoint', { office: 'steward', characterId: best });
  const boosted = takeOver(10);
  const ratio = boosted / bare;
  assert.ok(
    ratio > 1 + skill / 200 && ratio < (1 + skill / 100) * 1.1,
    `steward (skill ${skill}) lifts take: ×${ratio.toFixed(3)}`,
  );
  assert.ok(
    k.kingdom.ledger.entries().some((e) => e.kind === 'advisor-salary' && e.amount === -ADVISOR_SALARY),
    'salary drawn',
  );

  // death vacates the office (forced age, deterministic mortality roll)
  k.world.write(k.kingdom.Character).age[best & 0x3fffff] = 105; // mortality capped at 50%/year
  for (let years = 0; years < 8 && !k.events.some((e) => e.type === 'character.died'); years++) {
    for (let t = 0; t < TICKS_PER_YEAR; t += TICKS_PER_DAY * 30) k.days(30);
  }
  assert.ok(k.events.some((e) => e.type === 'character.died'), 'the old steward passed');
  assert.ok(k.events.some((e) => e.type === 'kingdom.officeVacated'), 'office vacated');
  k.reconciles();

  // appointment validation
  k.submit('kingdom.appoint', { office: 'archmage', characterId: candidates[0] });
  assert.ok(k.rejections.some((m) => m.includes("unknown office 'archmage'")));
  assert.deepEqual([...OFFICES], ['steward', 'marshal', 'chancellor', 'scholar']);
});

// ---------------- determinism ----------------

test('kingdom: identical histories hash identically', () => {
  const run = (): number => {
    const k = makeKingdom({ seed: 77 });
    k.days(15);
    let advisor = -1;
    k.world.query([k.kingdom.Character]).forEach((_i, entity) => {
      if (advisor < 0) advisor = entity as number;
    });
    k.submit('kingdom.appoint', { office: 'chancellor', characterId: advisor });
    k.submit('kingdom.enactEdict', { edict: 'base:edict.corvee-labor' });
    k.submit('village.setTaxRate', { villageId: k.villageId, rate: 3 });
    k.days(45);
    return k.kernel.stateHash();
  };
  assert.equal(run(), run());
});
