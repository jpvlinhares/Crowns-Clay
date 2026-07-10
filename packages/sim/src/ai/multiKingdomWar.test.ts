/**
 * AI at war (M30) — the roadmap T objective is "harness: wars start & end;
 * AI wins vs. passive baseline". Two AI kingdoms, fully AI-driven
 * (`aiFromIndex: 0`, same convention as M24): one aggressive (high
 * `aggression`, doc 07 §2's `MilitaryBuildup`/`ConquestWar` ladder), one a
 * pure economy "passive baseline" (`aggression: 0` — never touches
 * ai/military.ts at all, per its own "only spend effort a chosen plan asks
 * for" gate). A small map keeps both within M22's `SCOUT_REVEAL_RADIUS` so
 * they actually discover each other (the same fog mechanic M24's harness
 * uses, just at a distance small enough to fire). A larger starting
 * population is needed so raising even one unit (`popCost` 10, base
 * content) doesn't immediately gut the farm workforce it depends on to ever
 * raise a second (a real, working guns-vs-butter tension, not a bug — see
 * GDD §6 — but too severe at M22/M24's small starting cohorts to reach a
 * real war within a test-sized number of years). The passive kingdom keeps
 * a small token garrison (spawned directly, not by its own AI — a genuinely
 * `aggression: 0` kingdom never raises one) so contact with it is a real
 * combat.ts engagement rather than an unopposed walk-in with no lever to
 * observe (M27's engagement model needs two armies).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { EntityId } from '@crowns/core';
import { TICKS_PER_YEAR } from '../time.js';
import { composeMultiKingdom } from './multiKingdomHarness.js';
import type { PersonalityWeights } from './planner.js';

// fairPlacement's actual site distance for n=2 on this flat, uniform-score test terrain (verified
// empirically, not the naive 2×RING_RADIUS_FRACTION×size formula — ties on uniform terrain resolve
// to both sites landing near the same map edge): 29 tiles at size 100 — comfortably clears
// VILLAGE_MIN_SPACING (24) and stays under M22's SCOUT_REVEAL_RADIUS (48) for mutual discovery.
const MAP_SIZE = 100;
const YEARS = 25;
const STARTING_POPULATION = { children: 40, adults: 120, elders: 15 };
const GARRISON_UNIT_DEF = 'base:unit.militia';

const PASSIVE: PersonalityWeights = { expansion: 0.2, economy: 0.9, riskTolerance: 0.3, diplomacyTrust: 0.5, aggression: 0 };
const AGGRESSIVE: PersonalityWeights = { expansion: 0.3, economy: 0.6, riskTolerance: 0.7, diplomacyTrust: 0.2, aggression: 0.9 };

interface RunResult {
  readonly warEvents: string[];
  readonly passivePopulation: number;
  readonly passiveVillageAlive: boolean;
  readonly passiveOwnedByAggressor: boolean;
}

/** `kingdom0Weights` varies between the "war" and "peace baseline" runs; kingdom 1 (the
 * measured passive kingdom) is held identical across both for a fair comparison. */
function run(seed: number, kingdom0Weights: PersonalityWeights): RunResult {
  const composed = composeMultiKingdom({
    seed,
    kingdomCount: 2,
    mapSize: MAP_SIZE,
    aiFromIndex: 0,
    weightsOf: (k) => (k === 0 ? kingdom0Weights : PASSIVE),
    startingPopulation: STARTING_POPULATION,
  });

  composed.kernel.step(); // genesis

  // a token garrison for the passive kingdom — see file header
  const passiveVi = composed.villageOf(1) as number;
  const passiveKingdomId = composed.kingdomGame.kingdomEntities()[1] as EntityId;
  const garrisonCode = composed.militaryGame.ops.defCode(GARRISON_UNIT_DEF);
  const garrisonDef = composed.db.units.get(GARRISON_UNIT_DEF);
  assert.ok(garrisonCode !== undefined && garrisonDef !== undefined);
  const garrisonUnit = composed.world.spawn();
  composed.world.attach(garrisonUnit, composed.militaryGame.Unit, {
    def: garrisonCode, kingdomId: passiveKingdomId as number, homeVillage: passiveVi, armyId: 0,
    count: garrisonDef.popCost.count, progress: 1, complete: true, morale: garrisonDef.stats.moraleBase,
  });
  composed.kernel.submit({ type: 'army.createArmy', issuer: 2, payload: { name: 'Home Guard', villageId: passiveVi } });
  composed.kernel.step();
  let garrisonArmy = -1;
  const a = composed.world.read(composed.militaryGame.Army);
  composed.world.query([composed.armiesGame.ArmyMovement]).forEach((ai, entity) => {
    if ((a.kingdomId[ai] as number) === (passiveKingdomId as number)) garrisonArmy = entity as number;
  });
  assert.ok(garrisonArmy >= 0);
  composed.kernel.submit({ type: 'army.assignUnit', issuer: 2, payload: { unitId: garrisonUnit as number, armyId: garrisonArmy } });
  composed.kernel.step();

  const warEvents: string[] = [];
  for (const type of ['siege.begun', 'siege.captured', 'siege.ended', 'battle.resolved', 'army.attrition']) {
    composed.kernel.subscribe(type, () => warEvents.push(type));
  }

  for (let i = 0; i < YEARS * TICKS_PER_YEAR; i++) composed.kernel.step();

  const passiveVillageAlive = composed.world.isAlive(passiveVi as never);
  const passivePopulation = passiveVillageAlive ? composed.popGame.totalOf(passiveVi) : 0;
  const passiveOwnedByAggressor =
    !passiveVillageAlive ||
    (composed.kingdomGame.VillageOwner !== undefined
      ? (composed.world.read(composed.kingdomGame.VillageOwner).kingdom[passiveVi] as number) !== (passiveKingdomId as number)
      : false);

  return { warEvents, passivePopulation, passiveVillageAlive, passiveOwnedByAggressor };
}

test('M30 harness: an aggressive AI starts and resolves a war against a passive baseline', () => {
  const war = run(4100, AGGRESSIVE);

  // ---- wars start & end: `battle.resolved`/`siege.captured`/`siege.ended` only ever fire once
  // something (an engagement, a siege) both started AND concluded — proving both halves at once ----
  assert.ok(
    war.warEvents.some((e) => e === 'battle.resolved' || e === 'siege.captured' || e === 'siege.ended'),
    `expected at least one war to start and resolve over ${YEARS} years; saw events: ${war.warEvents.join(', ') || '(none)'}`,
  );

  // ---- AI wins vs. passive baseline: the SAME passive kingdom fares worse when attacked
  // than it would have at peace — the aggressor's war measurably cost it something ----
  const peace = run(4100, PASSIVE); // kingdom 0 ALSO passive — the baseline, nobody attacks anybody

  assert.ok(peace.passiveVillageAlive, 'sanity check: the passive kingdom must survive at peace');
  const worseOff =
    war.passiveOwnedByAggressor || !war.passiveVillageAlive || war.passivePopulation < peace.passivePopulation * 0.95;
  assert.ok(
    worseOff,
    `the attacked kingdom (pop ${war.passivePopulation}, captured=${war.passiveOwnedByAggressor}) should fare ` +
      `measurably worse than the same kingdom at peace (pop ${peace.passivePopulation})`,
  );
});

test('M30 harness: identical histories hash identically', () => {
  const stateHash = (): number => {
    const composed = composeMultiKingdom({
      seed: 99, kingdomCount: 2, mapSize: MAP_SIZE, aiFromIndex: 0,
      weightsOf: (k) => (k === 0 ? AGGRESSIVE : PASSIVE),
      startingPopulation: STARTING_POPULATION,
    });
    for (let i = 0; i < 2 * TICKS_PER_YEAR; i++) composed.kernel.step();
    return composed.kernel.stateHash();
  };
  assert.equal(stateHash(), stateHash());
});

// ---------------------------------------------------------------- M31: war diplomacy

// Both sides maximally war-minded (never voluntarily sue for peace, ai/military.ts's own
// de-escalation lever never fires) — isolates the "no forever-wars" guarantee to
// diplomacy.ts's exhaustion-driven FORCED peace alone, independent of any AI cooperation.
const BOTH_AGGRESSIVE: PersonalityWeights = { expansion: 0.3, economy: 0.5, riskTolerance: 0.8, diplomacyTrust: 0.1, aggression: 0.95 };

test('M31 harness: no forever-wars — a war between two kingdoms committed to fighting still ends', () => {
  const composed = composeMultiKingdom({
    seed: 777,
    kingdomCount: 2,
    mapSize: MAP_SIZE,
    aiFromIndex: 0,
    weightsOf: () => BOTH_AGGRESSIVE,
    startingPopulation: STARTING_POPULATION,
  });
  composed.kernel.step(); // genesis

  let declared = 0;
  let ended = 0;
  composed.kernel.subscribe('diplomacy.warDeclared', () => {
    declared += 1;
  });
  composed.kernel.subscribe('diplomacy.peaceForced', () => {
    ended += 1;
  });
  composed.kernel.subscribe<{ accepted: boolean }>('diplomacy.peaceProposed', (e) => {
    if (e.data.accepted) ended += 1;
  });

  for (let i = 0; i < YEARS * TICKS_PER_YEAR; i++) composed.kernel.step();

  assert.ok(declared > 0, 'expected the AI to formally declare war at some point over the run');
  assert.ok(ended > 0, 'expected the war to end (forced or accepted peace) despite neither side ever choosing to de-escalate');
});
