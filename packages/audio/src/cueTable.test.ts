import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { AudioCue } from '@crowns/protocol';
import { buildCueIndex, resolveCue } from './cueTable.js';

const cue = (id: string, event: string): AudioCue => ({
  id,
  event,
  bus: 'worldSfx',
  gain: 0.5,
  waveform: 'sine',
  frequencyHz: 440,
  durationMs: 200,
  placeholder: true,
});

test('cueTable: resolves a cue by GameEvent type, doc 10 §3\'s "maps GameEvents to cue ids"', () => {
  const index = buildCueIndex([cue('base:cue.a', 'village.founded'), cue('base:cue.b', 'siege.begun')]);
  assert.equal(resolveCue(index, 'siege.begun')?.id, 'base:cue.b');
  assert.equal(resolveCue(index, 'village.founded')?.id, 'base:cue.a');
});

test('cueTable: an event with no cue resolves to undefined, not a crash', () => {
  const index = buildCueIndex([cue('base:cue.a', 'village.founded')]);
  assert.equal(resolveCue(index, 'kingdom.rollup'), undefined);
});

test('cueTable: first-declared cue wins on a duplicate event mapping (deterministic, load-order-stable)', () => {
  const index = buildCueIndex([cue('base:cue.first', 'battle.resolved'), cue('base:cue.second', 'battle.resolved')]);
  assert.equal(resolveCue(index, 'battle.resolved')?.id, 'base:cue.first');
});
