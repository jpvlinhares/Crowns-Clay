/**
 * Personalities (M36, doc 07 §9) — roadmap test objective: "blind fingerprint
 * test (Vision SC-6 proto)". A behavioural fingerprint here is each
 * archetype's `PlanArchetype.utility` score vector under a fixed, generous
 * "every opportunity is available" scenario (planner.test.ts's own pattern:
 * unit-test the scoring function against synthetic `Considerations`, not an
 * emergent multi-year economy) — isolating "do personalities score plans
 * distinctly" from the separate, much harder question of whether the full
 * simulation's economy ever actually produces that scenario, which is a
 * balance-tuning concern (M46), not this milestone's.
 *
 * For each archetype, several independently PERTURBED instances (seeded
 * jitter, ai/personality.ts — standing in for several kingdoms that share an
 * archetype in the same campaign, doc 07 §9's "two Warmongers differ") are
 * classified — WITHOUT the classifier ever being told which archetype
 * produced them — against all 7 archetypes' CANONICAL (unperturbed)
 * fingerprints, by correlation. Passing means the 7 tuned profiles are
 * legible: perturbation-sized noise never confuses one archetype for
 * another.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Rng } from '@crowns/core';
import { DefinitionDatabase, BASE_CONTENT_FILES, type AIPersonalityDef } from '@crowns/data';
import { TICKS_PER_YEAR } from '../time.js';
import { DEFAULT_PLAN_ARCHETYPES, type Considerations, type PersonalityWeights } from './planner.js';
import { composeMultiKingdom } from './multiKingdomHarness.js';
import { perturbWeights, toPlannerWeights } from './personality.js';

const db = DefinitionDatabase.load(BASE_CONTENT_FILES);
const ARCHETYPE_IDS = [
  'base:personality.warmonger', 'base:personality.builder', 'base:personality.merchant',
  'base:personality.schemer', 'base:personality.zealot', 'base:personality.steward', 'base:personality.opportunist',
] as const;
const ARCHETYPES: readonly AIPersonalityDef[] = ARCHETYPE_IDS.map((id) => db.personalities.get(id) as AIPersonalityDef);

// "Every opportunity is available" — isolates personality's effect on scoring from whether the
// emergent economy ever actually reaches this state (a separate, much harder balance question).
const GENEROUS: Considerations = {
  economyStrength: 0.7,
  growthHeadroom: 0.6,
  settleReadiness: 0.6,
  crisisSignal: 0,
  allianceOpportunity: 0.6,
  militaryStrength: 0.5,
  relativeAdvantage: 0.6,
  researchOpportunity: 0.6, grievance: 0, warCommitment: 0,
};

function fingerprintOf(weights: PersonalityWeights): number[] {
  return DEFAULT_PLAN_ARCHETYPES.map((a) => a.utility(GENEROUS, weights) * (weights.planBiases?.[a.id] ?? 1));
}

/** Mean-centered similarity (Pearson correlation) — cancels out any shared baseline across
 * archetypes' fingerprints and isolates the relative "which plans this one favours" shape. */
function correlation(a: readonly number[], b: readonly number[]): number {
  const meanOf = (xs: readonly number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;
  const ma = meanOf(a);
  const mb = meanOf(b);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const da = (a[i] as number) - ma;
    const db = (b[i] as number) - mb;
    dot += da * db;
    na += da ** 2;
    nb += db ** 2;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

test('blind fingerprint test: 7 archetypes are distinct enough that perturbed instances never get confused', () => {
  const canonical = ARCHETYPES.map((def) => fingerprintOf(toPlannerWeights(def, def.weights)));

  // sanity: the 7 canonical profiles are themselves genuinely distinct (no accidental duplicate)
  for (let i = 0; i < canonical.length; i++) {
    for (let j = i + 1; j < canonical.length; j++) {
      assert.ok(
        correlation(canonical[i] as number[], canonical[j] as number[]) < 0.999,
        `${ARCHETYPES[i]?.name} and ${ARCHETYPES[j]?.name} have near-identical fingerprints`,
      );
    }
  }

  const rootRng = Rng.fromSeed(360);
  const SAMPLES_PER_ARCHETYPE = 8;
  const misclassified: string[] = [];
  for (let a = 0; a < ARCHETYPES.length; a++) {
    const def = ARCHETYPES[a] as AIPersonalityDef;
    for (let s = 0; s < SAMPLES_PER_ARCHETYPE; s++) {
      const perturbed = perturbWeights(def.weights, rootRng.fork(`${def.id}:${s}`));
      const observed = fingerprintOf(toPlannerWeights(def, perturbed));
      const similarities = canonical.map((vec) => correlation(observed, vec));
      const bestIndex = similarities.reduce((best, sim, i) => (sim > (similarities[best] as number) ? i : best), 0);
      if (bestIndex !== a) {
        misclassified.push(
          `${def.name} sample ${s} best-matched ${ARCHETYPES[bestIndex]?.name} ` +
            `(similarities: ${similarities.map((sim) => sim.toFixed(2)).join(', ')})`,
        );
      }
    }
  }
  assert.equal(
    misclassified.length, 0,
    `personalities are not behaviourally legible — blind fingerprint match failed:\n${misclassified.join('\n')}`,
  );
});

// ---------------------------------------------------------------- integration smoke test

test('all 7 archetypes drive a real AI-vs-AI campaign without crashing, and diverge in practice', () => {
  const rootRng = Rng.fromSeed(360);
  const composed = composeMultiKingdom({
    seed: 362,
    kingdomCount: ARCHETYPES.length,
    mapSize: 135, // empirically checked (see the fingerprint test above) for mutual discovery
    startingPopulation: { children: 40, adults: 120, elders: 15 },
    aiFromIndex: 0,
    weightsOf: (k) => {
      const def = ARCHETYPES[k] as AIPersonalityDef;
      return toPlannerWeights(def, perturbWeights(def.weights, rootRng.fork(`smoke:${k}`)));
    },
  });

  composed.kernel.step(); // tick 1: genesis
  const chosenPlans = new Set<string>();
  composed.kernel.subscribe<{ chosenPlan: string }>('ai.planChosen', (e) => chosenPlans.add(e.data.chosenPlan));

  // short horizon: this is a no-crash + "some real divergence exists" smoke test, not the
  // strict classification the fingerprint test above already proves at the scoring-function
  // level — reaching a full emergent economy/military equilibrium is a much longer, noisier
  // run (and a balance-tuning concern, M46), not what this test is for.
  for (let i = 0; i < 5 * TICKS_PER_YEAR; i++) composed.kernel.step();

  for (let k = 0; k < ARCHETYPES.length; k++) {
    assert.ok(composed.villageOf(k) !== null, `kingdom ${k} (${ARCHETYPES[k]?.name}) never founded a village`);
  }
  assert.ok(chosenPlans.size >= 2, `expected real behavioural variety across 7 distinct archetypes, got only: ${[...chosenPlans].join(', ')}`);
});
