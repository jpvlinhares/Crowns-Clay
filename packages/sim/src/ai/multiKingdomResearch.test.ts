/**
 * AI research (M32) — proves the `TechRace` archetype (ai/planner.ts) and
 * `registerAiResearchManager` (ai/research.ts) actually connect end-to-end in
 * the multi-kingdom harness: a tech-weighted AI kingdom builds a scholar
 * building and researches real techs, unprompted, purely from utility
 * scoring — the same "wire the deferred archetype real" pattern M23/M30/M31
 * each proved for their own mechanic.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TICKS_PER_YEAR } from '../time.js';
import { composeMultiKingdom } from './multiKingdomHarness.js';
import type { PersonalityWeights } from './planner.js';

const MAP_SIZE = 80;
const YEARS = 15;

// Low expansion/aggression, high tech: nothing else should outscore TechRace once the
// village is minimally developed (DevelopHeartland's own utility fades as growthHeadroom
// shrinks — the same weak→strong ladder mechanism M30's MilitaryBuildup/ConquestWar uses).
const SCHOLARLY: PersonalityWeights = { expansion: 0.1, economy: 0.6, riskTolerance: 0.3, aggression: 0, tech: 0.95 };

test('M32 harness: a tech-weighted AI kingdom researches real techs, unprompted', () => {
  const composed = composeMultiKingdom({
    seed: 5200,
    kingdomCount: 1,
    mapSize: MAP_SIZE,
    aiFromIndex: 0,
    weightsOf: () => SCHOLARLY,
  });
  composed.kernel.step(); // genesis

  const plans: string[] = [];
  composed.kernel.subscribe<{ chosenPlan: string }>('ai.planChosen', (e) => plans.push(e.data.chosenPlan));
  let completed = 0;
  composed.kernel.subscribe('research.completed', () => {
    completed += 1;
  });

  for (let i = 0; i < YEARS * TICKS_PER_YEAR; i++) composed.kernel.step();

  assert.ok(plans.includes('TechRace'), `expected TechRace to be chosen at least once; saw: ${[...new Set(plans)].join(', ')}`);
  assert.ok(completed > 0, `expected at least one completed tech over ${YEARS} years`);

  const kingdomId = composed.kingdomGame.kingdomEntities()[0] as never;
  assert.ok(composed.researchGame.coverageOf(kingdomId) > 0);
});

test('M32 harness: identical histories hash identically', () => {
  const stateHash = (): number => {
    const composed = composeMultiKingdom({
      seed: 61, kingdomCount: 1, mapSize: MAP_SIZE, aiFromIndex: 0,
      weightsOf: () => SCHOLARLY,
    });
    for (let i = 0; i < 3 * TICKS_PER_YEAR; i++) composed.kernel.step();
    return composed.kernel.stateHash();
  };
  assert.equal(stateHash(), stateHash());
});
