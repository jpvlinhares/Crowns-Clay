/**
 * Field combat (M27) — the roadmap T objective is "auto vs. manual parity
 * ±10% over 1k sims": auto-resolve must use the identical math as the
 * tick-driven path with a neutral (no extra orders) commander policy. Since
 * both paths call the SAME `resolveSubRound` (combat.ts), this is proven
 * empirically across many randomised battles rather than merely asserted.
 *
 * Also covers: engagement detection (proximity + hostility, NAP exemption),
 * resolution (a stronger force wins, morale drives rout, casualties are
 * real), withdraw, and determinism.
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
import { registerCombatGameplay, MAX_ENGAGEMENT_TICKS } from './combat.js';

const plain: TerrainAccessor = {
  width: 80,
  height: 80,
  tagsAt: () => ['open', 'farmable', 'mineable', 'woodland'],
  riverAt: () => false,
  movementCostAt: () => 1,
};

function makeCombat(options: { seed?: number; kingdomCount?: number } = {}) {
  const kernel = new Kernel(options.seed ?? 1);
  const world = new World(512);
  const db = DefinitionDatabase.load(BASE_CONTENT_FILES);
  const stock = { 'base:resource.wood': 600, 'base:resource.stone': 300, 'base:resource.food': 500, 'base:resource.tools': 200 };
  const mods = new StatModifiers();
  const game = registerVillageGameplay(kernel, world, db, plain, stock);
  const popGame = registerPopulationGameplay(kernel, world, db, game, { children: 12, adults: 30, elders: 5 }, mods);
  const econ = registerEconomyGameplay(kernel, world, db, game, mods);
  const Position = world.defineSoA('position', { x: 'f64', y: 'f64' });
  registerLogisticsGameplay(kernel, world, db, game, popGame, econ, Position);
  const kingdom = registerKingdomGameplay(kernel, world, db, game, popGame, econ, mods, { kingdomCount: options.kingdomCount ?? 2 });
  const military = registerMilitaryGameplay(kernel, world, db, game, popGame, kingdom);
  const armies = registerArmyGameplay(kernel, world, game, military, kingdom);
  const combat = registerCombatGameplay(kernel, world, military, armies, kingdom);
  kernel.attachGuard(world);
  kernel.addHashSource('world', (fold) => world.hash(fold));

  const events: { type: string; data: unknown }[] = [];
  const rejections: string[] = [];
  kernel.subscribe<{ what: string; reason: string }>('village.rejected', (e) => rejections.push(`${e.data.what}: ${e.data.reason}`));
  for (const type of ['battle.resolved', 'battle.withdrawn', 'army.created']) {
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

  const createArmy = (issuer: number): number => {
    submit('army.createArmy', { name: `Army-${issuer}`, villageId }, issuer);
    const created = events.filter((e) => e.type === 'army.created').at(-1);
    assert.ok(created !== undefined);
    return (created.data as { army: number }).army;
  };

  /** Spawns a ready-to-fight unit directly (bypasses recruit/training ticks — those
   * mechanics are M25's own test scope; combat only needs a complete, positioned unit). */
  const spawnUnit = (armyId: number, kingdomIndex: number, unitDefId: string): number => {
    const def = db.units.get(unitDefId);
    assert.ok(def !== undefined, `unknown unit '${unitDefId}'`);
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

  const days = (n: number): void => {
    for (let t = 0; t < n * TICKS_PER_DAY; t++) kernel.step();
  };

  const lastRejection = (): string => rejections.at(-1) ?? '';

  return {
    kernel, world, db, game, popGame, kingdom, military, armies, combat,
    villageId, submit, createArmy, spawnUnit, positionArmy, days, lastRejection, events,
  };
}

// ---------------- detection ----------------

test('detection: adjacent hostile armies (different kingdoms) engage automatically', () => {
  const m = makeCombat();
  const armyA = m.createArmy(1);
  const armyB = m.createArmy(2);
  m.spawnUnit(armyA, 0, 'base:unit.spearman');
  m.spawnUnit(armyB, 1, 'base:unit.militia');
  m.positionArmy(armyA, 40, 40);
  m.positionArmy(armyB, 40, 41); // adjacent (Chebyshev 1)
  m.kernel.step();
  // a lopsided 1-unit-vs-1-unit fight can both start AND finish within this one
  // tick (4 sub-rounds, doc 08 §8) — either outcome proves detection fired
  const engaged = m.combat.state.engagementOf(armyA) !== undefined;
  const alreadyResolved = m.events.some((e) => e.type === 'battle.resolved');
  assert.ok(engaged || alreadyResolved, 'proximity + hostility must trigger an engagement');
});

test('detection: same-kingdom armies never engage, however close', () => {
  const m = makeCombat({ kingdomCount: 1 });
  const armyA = m.createArmy(1);
  const armyB = m.createArmy(1);
  m.spawnUnit(armyA, 0, 'base:unit.spearman');
  m.spawnUnit(armyB, 0, 'base:unit.militia');
  m.positionArmy(armyA, 40, 40);
  m.positionArmy(armyB, 40, 40);
  m.kernel.step();
  assert.equal(m.combat.state.engagementOf(armyA), undefined);
});

test('detection: distant hostile armies do not engage', () => {
  const m = makeCombat();
  const armyA = m.createArmy(1);
  const armyB = m.createArmy(2);
  m.spawnUnit(armyA, 0, 'base:unit.spearman');
  m.spawnUnit(armyB, 1, 'base:unit.militia');
  m.positionArmy(armyA, 10, 10);
  m.positionArmy(armyB, 60, 60);
  m.kernel.step();
  assert.equal(m.combat.state.engagementOf(armyA), undefined);
});

// ---------------- resolution ----------------

test('resolution: a decisively stronger force wins; battle.resolved names the winner', () => {
  const m = makeCombat();
  const armyA = m.createArmy(1);
  const armyB = m.createArmy(2);
  for (let i = 0; i < 6; i++) m.spawnUnit(armyA, 0, 'base:unit.spearman'); // 60 spearmen
  m.spawnUnit(armyB, 1, 'base:unit.militia'); // 10 militia
  m.positionArmy(armyA, 40, 40);
  m.positionArmy(armyB, 40, 40);
  let resolved = false;
  for (let t = 0; t < MAX_ENGAGEMENT_TICKS + 2 && !resolved; t++) {
    m.kernel.step();
    resolved = m.events.some((e) => e.type === 'battle.resolved');
  }
  assert.ok(resolved, 'the battle must conclude within the doc 08 §8 tick cap');
  const result = m.events.find((e) => e.type === 'battle.resolved')?.data as { winner: number; remainingA: number; remainingB: number };
  assert.equal(result.winner, armyA, 'the far stronger force must win');
  assert.ok(result.remainingB < 10, 'the losing side must take real casualties');
});

test('resolution: rout survives — a routed unit leaves the army but is not destroyed', () => {
  const m = makeCombat();
  const armyA = m.createArmy(1);
  const armyB = m.createArmy(2);
  for (let i = 0; i < 8; i++) m.spawnUnit(armyA, 0, 'base:unit.spearman');
  const weakUnit = m.spawnUnit(armyB, 1, 'base:unit.militia');
  m.positionArmy(armyA, 40, 40);
  m.positionArmy(armyB, 40, 40);
  for (let t = 0; t < MAX_ENGAGEMENT_TICKS + 2 && m.world.read(m.military.Unit).armyId[weakUnit & 0x3fffff] === armyB; t++) m.kernel.step();
  assert.equal(m.world.isAlive(weakUnit as EntityId), true, 'a routed unit survives — GDD §8 "rout, not annihilation"');
});

// ---------------- withdraw ----------------

test('army.withdraw ends the engagement early; rejects for a non-owner or unengaged army', () => {
  const m = makeCombat();
  const armyA = m.createArmy(1);
  const armyB = m.createArmy(2);
  // evenly matched, large forces on both sides — many sub-rounds before either
  // side could plausibly rout or run out, so the engagement survives long
  // enough to test a mid-battle withdraw (begin() bypasses proximity timing,
  // isolating this test from exactly how fast detection happens to resolve it)
  for (let i = 0; i < 5; i++) m.spawnUnit(armyA, 0, 'base:unit.spearman');
  for (let i = 0; i < 5; i++) m.spawnUnit(armyB, 1, 'base:unit.spearman');
  // apart, so detection doesn't immediately re-engage them the instant withdraw ends it
  m.positionArmy(armyA, 10, 10);
  m.positionArmy(armyB, 70, 70);
  m.combat.state.begin(armyA, armyB);
  assert.ok(m.combat.state.engagementOf(armyA) !== undefined);
  m.submit('army.withdraw', { armyId: armyA }, 2); // wrong kingdom
  assert.match(m.lastRejection(), /not your army/);
  m.submit('army.withdraw', { armyId: armyA }, 1);
  assert.equal(m.combat.state.engagementOf(armyA), undefined, 'withdraw must end the engagement');
  m.submit('army.withdraw', { armyId: armyA }, 1);
  assert.match(m.lastRejection(), /not engaged/);
});

// ---------------- the M27 T objective: auto vs. manual parity ----------------

test('auto vs. manual parity: aggregate outcomes agree within ±10% over many battles', () => {
  const TRIALS = 150; // representative of "1k sims" at test-suite-friendly speed (same scaling
  // rationale as M26's 200-army benchmark) — both paths share one resolver, so the property
  // holds at any sample size; more trials only tighten the statistical noise floor.

  const runBattle = (seed: number, auto: boolean): { winner: 'A' | 'B' | 'draw'; remainingA: number; remainingB: number } => {
    const m = makeCombat({ seed });
    const armyA = m.createArmy(1);
    const armyB = m.createArmy(2);
    for (let i = 0; i < 3; i++) m.spawnUnit(armyA, 0, 'base:unit.spearman');
    for (let i = 0; i < 3; i++) m.spawnUnit(armyB, 1, 'base:unit.militia');
    m.positionArmy(armyA, 40, 40);
    m.positionArmy(armyB, 70, 70); // far apart — engage only via the explicit begin() below,
    // isolating the RESOLVER comparison from the (already-tested) detection system
    m.combat.state.begin(armyA, armyB);
    if (auto) {
      m.submit('battle.autoResolve', { armyId: armyA }, 1);
    } else {
      for (let t = 0; t < MAX_ENGAGEMENT_TICKS + 1 && m.events.every((e) => e.type !== 'battle.resolved'); t++) m.kernel.step();
    }
    const result = m.events.find((e) => e.type === 'battle.resolved')?.data as
      | { winner: number; remainingA: number; remainingB: number }
      | undefined;
    assert.ok(result !== undefined, `battle must resolve (auto=${auto}, seed=${seed})`);
    const winner = result.winner === armyA ? 'A' : result.winner === armyB ? 'B' : 'draw';
    return { winner, remainingA: result.remainingA, remainingB: result.remainingB };
  };

  let manualAWins = 0;
  let manualTotalRemaining = 0;
  let autoAWins = 0;
  let autoTotalRemaining = 0;
  for (let i = 0; i < TRIALS; i++) {
    const seed = 1000 + i;
    const manual = runBattle(seed, false);
    const auto = runBattle(seed + 1, true); // different seed — comparing AGGREGATES, not one battle twice
    if (manual.winner === 'A') manualAWins++;
    if (auto.winner === 'A') autoAWins++;
    manualTotalRemaining += manual.remainingA + manual.remainingB;
    autoTotalRemaining += auto.remainingA + auto.remainingB;
  }

  const manualWinRate = manualAWins / TRIALS;
  const autoWinRate = autoAWins / TRIALS;
  assert.ok(
    Math.abs(manualWinRate - autoWinRate) <= 0.1,
    `A's win rate: manual ${manualWinRate.toFixed(2)} vs auto ${autoWinRate.toFixed(2)} — must agree within ±10 points`,
  );

  const manualAvgRemaining = manualTotalRemaining / TRIALS;
  const autoAvgRemaining = autoTotalRemaining / TRIALS;
  const relDiff = Math.abs(manualAvgRemaining - autoAvgRemaining) / Math.max(1, manualAvgRemaining);
  assert.ok(
    relDiff <= 0.1,
    `avg. remaining troops: manual ${manualAvgRemaining.toFixed(2)} vs auto ${autoAvgRemaining.toFixed(2)} — must agree within ±10%`,
  );
});

// ---------------- determinism ----------------

test('combat: identical histories hash identically', () => {
  const run = (): number => {
    const m = makeCombat({ seed: 77 });
    const armyA = m.createArmy(1);
    const armyB = m.createArmy(2);
    for (let i = 0; i < 4; i++) m.spawnUnit(armyA, 0, 'base:unit.spearman');
    for (let i = 0; i < 4; i++) m.spawnUnit(armyB, 1, 'base:unit.archer');
    m.positionArmy(armyA, 40, 40);
    m.positionArmy(armyB, 40, 40);
    for (let t = 0; t < MAX_ENGAGEMENT_TICKS + 5; t++) m.kernel.step();
    return m.kernel.stateHash();
  };
  assert.equal(run(), run());
});
