/**
 * AI event answers (M33) — proves `registerAiEventAnswering` connects end-to-
 * end in the multi-kingdom harness: an AI kingdom answers its own pending
 * events, unprompted, purely by scoring `aiScoreHints` against its
 * personality weights (no player/test code ever submits `event.choose`).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TICKS_PER_YEAR } from '../time.js';
import { composeMultiKingdom } from './multiKingdomHarness.js';
import type { PersonalityWeights } from './planner.js';

const MAP_SIZE = 80;
const WEIGHTS: PersonalityWeights = { expansion: 0.4, economy: 0.5, riskTolerance: 0.5, aggression: 0.2, tech: 0.5 };

test('M33 harness: an AI kingdom answers its own events, unprompted', () => {
  const composed = composeMultiKingdom({
    seed: 3100,
    kingdomCount: 1,
    mapSize: MAP_SIZE,
    aiFromIndex: 0,
    weightsOf: () => WEIGHTS,
  });
  composed.kernel.step(); // genesis

  let fired = 0;
  let resolved = 0;
  composed.kernel.subscribe('event.fired', () => {
    fired += 1;
  });
  composed.kernel.subscribe('event.resolved', () => {
    resolved += 1;
  });

  for (let i = 0; i < 8 * TICKS_PER_YEAR; i++) composed.kernel.step();

  assert.ok(fired > 0, 'expected at least one event to fire over 8 years');
  assert.ok(resolved > 0, 'expected the AI to have resolved at least one event, unprompted');

  const kingdomId = composed.kingdomGame.kingdomEntities()[0] as never;
  assert.equal(composed.eventGame.pendingChoices(kingdomId).length, 0, 'a purely-scoring AI should not leave choices permanently unanswered');
});

test('M33 harness: identical histories hash identically', () => {
  const stateHash = (): number => {
    const composed = composeMultiKingdom({
      seed: 62, kingdomCount: 1, mapSize: MAP_SIZE, aiFromIndex: 0,
      weightsOf: () => WEIGHTS,
    });
    for (let i = 0; i < 3 * TICKS_PER_YEAR; i++) composed.kernel.step();
    return composed.kernel.stateHash();
  };
  assert.equal(stateHash(), stateHash());
});
