/**
 * The roadmap T objective: "tension-state transitions" (doc 05 §8's
 * war/unrest-driven, hysteresis-gated music director input).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { GameEvent } from '@crowns/protocol';
import { TensionTracker, TENSE_ENTER, TENSE_EXIT, COMBAT_ENTER } from './tension.js';

const ev = (type: string, tick: number): GameEvent => ({ type, tick, data: {} });

test('tension: starts calm, and an unweighted event never moves it', () => {
  const t = new TensionTracker();
  assert.equal(t.current(), 'calm');
  t.push(ev('village.founded', 10));
  assert.equal(t.current(), 'calm');
  assert.equal(t.currentHeat(), 0);
});

test('tension: a single mid-weight event crosses into tense but not combat', () => {
  const t = new TensionTracker();
  t.push(ev('diplomacy.warDeclared', 1)); // weight 0.3, just under TENSE_ENTER (0.35)... plus decay
  assert.equal(t.current(), 'calm');
  t.push(ev('siege.assaultBegun', 2)); // +0.4 → well past TENSE_ENTER, short of COMBAT_ENTER
  assert.equal(t.current(), 'tense');
  assert.ok(t.currentHeat() < COMBAT_ENTER);
});

test('tension: a big spike jumps straight from calm to combat', () => {
  const t = new TensionTracker();
  t.push(ev('siege.begun', 1)); // +0.5
  t.push(ev('battle.resolved', 1)); // +0.35 → 0.85, clears COMBAT_ENTER (0.75) in one tick
  assert.equal(t.current(), 'combat');
});

test('tension: hysteresis — tense holds while heat sits between TENSE_EXIT and TENSE_ENTER', () => {
  const t = new TensionTracker();
  t.push(ev('siege.begun', 0)); // +0.5 → tense
  assert.equal(t.current(), 'tense');
  // decay just enough to land heat BELOW TENSE_ENTER but still ABOVE TENSE_EXIT —
  // re-crossing enter downward must NOT flap the state back to calm
  const ticksToMidBand = Math.ceil((0.5 - (TENSE_ENTER + TENSE_EXIT) / 2) / 0.0015);
  t.advance(ticksToMidBand);
  assert.ok(t.currentHeat() < TENSE_ENTER && t.currentHeat() > TENSE_EXIT, `heat ${t.currentHeat()} not mid-band`);
  assert.equal(t.current(), 'tense', 'must not flap back to calm just below the ENTER threshold');
});

test('tension: hysteresis — combat only drops to tense at COMBAT_EXIT, not immediately below COMBAT_ENTER', () => {
  const t = new TensionTracker();
  t.push(ev('siege.begun', 0));
  t.push(ev('battle.resolved', 0)); // heat 0.85 → combat
  assert.equal(t.current(), 'combat');
  // advance a modest number of ticks: heat decays but should still be ABOVE COMBAT_EXIT (0.5)
  t.advance(50); // 50 * 0.0015 = 0.075 decay → heat ≈ 0.775, still > COMBAT_ENTER even
  assert.equal(t.current(), 'combat', 'a small decay must not immediately drop out of combat');
  // advance enough ticks to cross below COMBAT_EXIT (0.5): need > (0.85-0.5)/0.0015 ≈ 234 more ticks
  t.advance(50 + 300);
  assert.equal(t.current(), 'tense', 'heat below COMBAT_EXIT drops exactly one band, not straight to calm');
  // and further decay eventually reaches calm via TENSE_EXIT
  t.advance(50 + 300 + 300);
  assert.equal(t.current(), 'calm');
});

test('tension: a reinforcing event before decay completes keeps state elevated (no premature calm)', () => {
  const t = new TensionTracker();
  t.push(ev('siege.begun', 0)); // → tense
  assert.equal(t.current(), 'tense');
  t.advance(50); // partial decay (heat 0.5 → 0.425), still tense (well above TENSE_EXIT)
  assert.equal(t.current(), 'tense');
  t.push(ev('village.founded', 50)); // unweighted — reinforces nothing, but proves decay alone hasn't dropped it
  assert.equal(t.current(), 'tense');
  assert.ok(t.currentHeat() > TENSE_EXIT);
});

test('tension: heat clamps at 1 — repeated max events never overflow', () => {
  const t = new TensionTracker();
  for (let i = 0; i < 20; i++) t.push(ev('siege.begun', i));
  assert.equal(t.currentHeat(), 1);
  assert.equal(t.current(), 'combat');
});

test('tension: advance() with no events still decays and can transition down', () => {
  const t = new TensionTracker();
  t.push(ev('siege.begun', 0));
  t.push(ev('battle.resolved', 0));
  assert.equal(t.current(), 'combat');
  const state = t.advance(10_000); // far more ticks than needed to fully decay to 0
  assert.equal(state, 'calm');
  assert.equal(t.currentHeat(), 0);
});
