/**
 * AI harness & nightly (M24, Phase 3 gate) — roadmap test objective:
 * "nightly green: 8 AI kingdoms, 50 years, no crash". This is a `.test.ts`
 * file, not a separate slow tool (per user direction): the estimated
 * runtime fits comfortably inside `npm test`, extrapolating from M20's
 * single-village 20-year harness.
 *
 * "Nightly" here stays the doc's testing-*tier* concept (TDD §13) — no new
 * scheduled CI workflow. Behavioural fingerprints substitute real M19-M23
 * mechanics (settlement expansion) for the doc's war-frequency example
 * (doc 07 §11: "Warmonger initiates ≥2× wars of Builder"), since no war
 * system exists until M25 and named personality archetypes are M36 — two
 * generic weight profiles stand in for "Warmonger" and "Builder".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TICKS_PER_YEAR } from '../time.js';
import { composeMultiKingdom } from './multiKingdomHarness.js';
import type { PersonalityWeights } from './planner.js';

const KINGDOM_COUNT = 8;
const YEARS = 50;
/** doc 11 §2: "AI ≤ 30% of tick budget at 8 kingdoms". */
const AI_TICK_BUDGET_SHARE = 0.3;

/** Stands in for a "Warmonger"-like archetype (M36 hasn't shipped named archetypes yet):
 * expansion-leaning, low trust in diplomacy. Low `aggression` (M30) keeps this test's
 * fingerprint about PEACEFUL expansion vs. economy focus — MilitaryBuildup/ConquestWar get
 * their own dedicated fingerprint test (multiKingdomWar.test.ts). */
const EXPANSIONIST: PersonalityWeights = { expansion: 0.9, economy: 0.2, riskTolerance: 0.7, diplomacyTrust: 0.3, aggression: 0.1 };
/** Stands in for a "Builder"-like archetype: economy-leaning, high trust in diplomacy. */
const BUILDER: PersonalityWeights = { expansion: 0.1, economy: 0.9, riskTolerance: 0.3, diplomacyTrust: 0.7, aggression: 0.1 };

test('M24 harness: 8 AI kingdoms survive 50 years without crashing', () => {
  const composed = composeMultiKingdom({
    kingdomCount: KINGDOM_COUNT,
    mapSize: 600, // room for 8 fair sectors without crowding
    aiFromIndex: 0, // fully AI-driven campaign — no inert "player" kingdom
    weightsOf: (k) => (k % 2 === 0 ? EXPANSIONIST : BUILDER),
    clock: () => performance.now(),
  });

  composed.kernel.step(); // tick 1: genesis (kingdoms + villages founded)

  // ai.planChosen carries villageId, not kingdomIndex — build the reverse map once genesis has run.
  const kingdomOfVillage = new Map<number, number>();
  for (let k = 0; k < KINGDOM_COUNT; k++) {
    const vi = composed.villageOf(k);
    if (vi !== null) kingdomOfVillage.set(vi, k);
  }
  assert.equal(kingdomOfVillage.size, KINGDOM_COUNT, 'expected every kingdom to have founded a village');

  const planChoices: { kingdomIndex: number; chosenPlan: string }[] = [];
  composed.kernel.subscribe<{ villageId: number; chosenPlan: string }>('ai.planChosen', (e) => {
    const kingdomIndex = kingdomOfVillage.get(e.data.villageId & 0x3fffff);
    if (kingdomIndex !== undefined) planChoices.push({ kingdomIndex, chosenPlan: e.data.chosenPlan });
  });

  // ---- no crash: run the full 50-year campaign; an uncaught exception fails the test directly ----
  for (let i = 0; i < YEARS * TICKS_PER_YEAR; i++) composed.kernel.step();

  // ---- survival ----
  const dead: number[] = [];
  for (let k = 0; k < KINGDOM_COUNT; k++) {
    const vi = composed.villageOf(k);
    if (vi === null || composed.popGame.totalOf(vi) <= 0) dead.push(k);
  }
  assert.equal(dead.length, 0, `kingdom(s) died over 50 years: ${dead.join(', ')}`);

  // ---- behavioural fingerprint: expansionists lean into ExpandSettle more than builders ----
  const kingdomsOf = (parity: 0 | 1): number[] =>
    Array.from({ length: KINGDOM_COUNT }, (_, k) => k).filter((k) => k % 2 === parity);
  const expandRate = (kingdoms: readonly number[]): number => {
    const total = planChoices.filter((p) => kingdoms.includes(p.kingdomIndex)).length;
    const expandChoices = planChoices.filter((p) => kingdoms.includes(p.kingdomIndex) && p.chosenPlan === 'ExpandSettle').length;
    return total === 0 ? 0 : expandChoices / total;
  };
  const expansionistRate = expandRate(kingdomsOf(0));
  const builderRate = expandRate(kingdomsOf(1));
  assert.ok(
    expansionistRate > builderRate,
    `expected expansion-leaning kingdoms (ExpandSettle rate ${expansionistRate.toFixed(2)}) to choose ExpandSettle ` +
      `more often than builder-leaning kingdoms (${builderRate.toFixed(2)}) — behavioural fingerprint regressed`,
  );

  // ---- perf telemetry: AI's share of the tick budget stays within doc 11's 8-kingdom target ----
  // `system.avgMs` is a per-CALL average (only sampled on ticks that system actually ran, e.g.
  // daily/weekly cadences) — comparing it directly against `tickMsAvg` (a per-TICK average over
  // every tick, including ticks no AI system ran) would overstate AI's share. Amortize each
  // system's cost by how often it actually runs (`calls / totalTicks`) before summing.
  const telemetry = composed.kernel.getTelemetry();
  const totalTicks = composed.kernel.currentTick;
  const isAiSystem = (name: string): boolean =>
    name.startsWith('ai-construction') || name.startsWith('ai-strategic-planner') || name === 'scouting';
  const aiMs = telemetry.systems
    .filter((s) => isAiSystem(s.name))
    .reduce((sum, s) => sum + s.avgMs * (s.calls / totalTicks), 0);
  const aiShare = telemetry.tickMsAvg > 0 ? aiMs / telemetry.tickMsAvg : 0;
  assert.ok(
    aiShare <= AI_TICK_BUDGET_SHARE,
    `AI systems consumed ${(aiShare * 100).toFixed(1)}% of the average tick, exceeding the ` +
      `${(AI_TICK_BUDGET_SHARE * 100).toFixed(0)}% target (doc 11 §2, 8 kingdoms)`,
  );
});
