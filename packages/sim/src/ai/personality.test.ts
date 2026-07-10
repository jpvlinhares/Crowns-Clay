/**
 * AI personality wiring (M36) — covers the pure adapter layer: seeded
 * perturbation, the planner/diplomacy weight mappings, and legibility tags.
 * The T objective itself (blind fingerprint test) lives in
 * multiKingdomPersonality.test.ts, which needs the full multi-kingdom harness.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Rng } from '@crowns/core';
import { DefinitionDatabase, BASE_CONTENT_FILES, PERSONALITY_AXES, type AIPersonalityDef } from '@crowns/data';
import { perturbWeights, toPlannerWeights, toDiplomacyPersonality, describePersonality } from './personality.js';

const db = DefinitionDatabase.load(BASE_CONTENT_FILES);
const warmonger = db.personalities.get('base:personality.warmonger') as AIPersonalityDef;
const builder = db.personalities.get('base:personality.builder') as AIPersonalityDef;

test('content: exactly 7 base personality archetypes, each with a full weight/preference/planBias set', () => {
  assert.equal(db.personalities.size, 7);
  for (const def of db.personalities.values()) {
    for (const axis of PERSONALITY_AXES) {
      const value = def.weights[axis];
      assert.ok(value >= 0 && value <= 1, `${def.id}.${axis} in [0,1]`);
    }
    assert.ok(Object.keys(def.planBiases).length > 0, `${def.id} has at least one plan bias`);
  }
});

test('perturbWeights: deterministic for the same rng state, and stays within amount of the base', () => {
  const a = perturbWeights(warmonger.weights, Rng.fromSeed(99));
  const b = perturbWeights(warmonger.weights, Rng.fromSeed(99));
  assert.deepEqual(a, b);
  for (const axis of PERSONALITY_AXES) {
    assert.ok(Math.abs(a[axis] - warmonger.weights[axis]) <= 0.08 + 1e-9, `${axis} within perturbation amount`);
    assert.ok(a[axis] >= 0 && a[axis] <= 1, `${axis} stays in [0,1] after perturbation`);
  }
});

test('perturbWeights: two forks of the same root diverge (so two Warmongers differ, doc 07 §9)', () => {
  const root = Rng.fromSeed(7);
  const a = perturbWeights(warmonger.weights, root.fork('kingdom:0'));
  const b = perturbWeights(warmonger.weights, root.fork('kingdom:1'));
  assert.notDeepEqual(a, b);
});

test('toPlannerWeights: carries planBiases through unchanged and maps every planner axis', () => {
  const weights = toPlannerWeights(warmonger, warmonger.weights);
  assert.equal(weights.expansion, warmonger.weights.expansion);
  assert.equal(weights.economy, warmonger.weights.economy);
  assert.equal(weights.riskTolerance, warmonger.weights.riskTolerance);
  assert.equal(weights.diplomacyTrust, warmonger.weights.diplomacyTrust);
  assert.equal(weights.aggression, warmonger.weights.aggression);
  assert.equal(weights.tech, warmonger.weights.tech);
  assert.deepEqual(weights.planBiases, warmonger.planBiases);
});

test('toDiplomacyPersonality: projects just diplomacyTrust', () => {
  assert.deepEqual(toDiplomacyPersonality(warmonger.weights), { diplomacyTrust: warmonger.weights.diplomacyTrust });
});

test('describePersonality: a Warmonger reads as aggressive and distrustful, a Builder does not', () => {
  const warmongerTags = describePersonality(warmonger.weights);
  const builderTags = describePersonality(builder.weights);
  assert.ok(warmongerTags.includes('making war'));
  assert.ok(!builderTags.includes('making war'));
  assert.ok(builderTags.includes('building prosperity'));
});

test('describePersonality: capped at 3 tags, strongest axis first', () => {
  const allHigh: Record<string, number> = {};
  for (const axis of PERSONALITY_AXES) allHigh[axis] = 0.9;
  allHigh.honor = 0.99; // the single strongest axis
  const tags = describePersonality(allHigh as never);
  assert.ok(tags.length <= 3);
  assert.equal(tags[0], 'keeping its word');
});

test('describePersonality: a neutral (all-0.5) profile has nothing distinctive to say', () => {
  const neutral: Record<string, number> = {};
  for (const axis of PERSONALITY_AXES) neutral[axis] = 0.5;
  assert.deepEqual(describePersonality(neutral as never), []);
});
