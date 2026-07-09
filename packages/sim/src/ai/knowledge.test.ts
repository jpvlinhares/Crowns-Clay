/**
 * Knowledge model (M19) — doc 07 §6: facts refresh on record, confidence
 * decays over elapsed ticks, and believed values are deterministic (same
 * seed + same tick ⇒ same noise) despite being derived, never authoritative.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Rng } from '@crowns/core';
import { KnowledgeModel, hashKnowledge, type KnowledgeFact } from './knowledge.js';

const treasuryFact: KnowledgeFact = {
  subject: 7,
  kind: 'treasury',
  value: 500,
  confidence: 1,
  lastUpdated: 100,
  source: 'scout',
};

test('knowledge: record then get round-trips, and pack/unpack preserves it', () => {
  const model = new KnowledgeModel();
  model.record(treasuryFact);
  assert.deepEqual(model.get(7, 'treasury'), treasuryFact);

  const restored = KnowledgeModel.unpack(model.pack());
  assert.deepEqual(restored.get(7, 'treasury'), treasuryFact);
  assert.equal(restored.get(7, 'armyStrength'), undefined);
});

test('knowledge: record overwrites the prior belief for the same (subject, kind)', () => {
  const model = new KnowledgeModel();
  model.record(treasuryFact);
  model.record({ ...treasuryFact, value: 900, confidence: 0.8, lastUpdated: 150 });
  assert.equal(model.all().length, 1);
  assert.equal(model.get(7, 'treasury')?.value, 900);
});

test('knowledge: pack() order is stable regardless of record() call order', () => {
  const a = new KnowledgeModel();
  a.record({ ...treasuryFact, subject: 1, kind: 'treasury' });
  a.record({ ...treasuryFact, subject: 2, kind: 'armyStrength' });

  const b = new KnowledgeModel();
  b.record({ ...treasuryFact, subject: 2, kind: 'armyStrength' });
  b.record({ ...treasuryFact, subject: 1, kind: 'treasury' });

  assert.deepEqual(a.pack(), b.pack());
});

test('knowledge: confidence halves every half-life elapsed, floors nothing below zero', () => {
  const model = new KnowledgeModel();
  model.record(treasuryFact); // confidence 1, lastUpdated tick 100
  model.decayAll(100 + 30, 30); // one half-life elapsed
  assert.ok(Math.abs((model.get(7, 'treasury')?.confidence ?? 0) - 0.5) < 1e-9);
  model.decayAll(100 + 60, 30); // two half-lives total from origin
  assert.ok(Math.abs((model.get(7, 'treasury')?.confidence ?? 0) - 0.25) < 1e-9);
});

test('knowledge: decayAll is a no-op for facts not yet due (elapsed <= 0)', () => {
  const model = new KnowledgeModel();
  model.record(treasuryFact);
  model.decayAll(100, 30); // same tick as lastUpdated
  assert.equal(model.get(7, 'treasury')?.confidence, 1);
});

test('knowledge: believedValue is undefined for unobserved subjects', () => {
  const model = new KnowledgeModel();
  assert.equal(model.believedValue(999, 'treasury', 100, Rng.fromSeed(1)), undefined);
});

test('knowledge: believedValue is deterministic for a fixed seed and tick', () => {
  const model = new KnowledgeModel();
  model.record({ ...treasuryFact, confidence: 0.4 }); // low confidence ⇒ noisy belief
  const rngA = Rng.fromSeed(42);
  const rngB = Rng.fromSeed(42);
  const believedA = model.believedValue(7, 'treasury', 200, rngA);
  const believedB = model.believedValue(7, 'treasury', 200, rngB);
  assert.equal(believedA, believedB);
  assert.notEqual(believedA, treasuryFact.value); // noise actually perturbs it
});

test('knowledge: full confidence yields zero noise (believedValue === value)', () => {
  const model = new KnowledgeModel();
  model.record({ ...treasuryFact, confidence: 1 });
  assert.equal(model.believedValue(7, 'treasury', 200, Rng.fromSeed(9)), treasuryFact.value);
});

test('knowledge: hashKnowledge folds every packed number in order', () => {
  const packed = [1, 2, 3];
  const seen: number[] = [];
  hashKnowledge(packed, (v) => seen.push(v));
  assert.deepEqual(seen, packed);
});
