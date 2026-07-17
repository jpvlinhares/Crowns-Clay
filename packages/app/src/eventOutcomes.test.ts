import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { EffectExpr } from '@crowns/data';

import { choiceOutcomes } from './eventOutcomes.js';

// A trivial resource-id → display-name resolver for the tests.
const name = (id: string): string => id.split('.').pop() ?? id;

test('choiceOutcomes: a trade lists both what is spent and what is gained, in author order', () => {
  const effects: EffectExpr[] = [
    { removeResource: { resource: 'base:resource.wood', amount: 20 } },
    { grantResource: { resource: 'base:resource.tools', amount: 8 } },
  ];
  assert.deepEqual(choiceOutcomes(effects, name), [
    { label: '−20 wood', kind: 'loss' },
    { label: '+8 tools', kind: 'gain' },
  ]);
});

test('choiceOutcomes: treasury and stat nudges are signed and classified', () => {
  const effects: EffectExpr[] = [
    { modifier: { stat: 'kingdom.treasury', op: 'add', value: -20 } }, // pay 20 gold
    { modifier: { stat: 'village.happiness', op: 'add', value: 3 } }, // gain happiness
    { modifier: { stat: 'village.happiness', op: 'add', value: -4 } }, // suffer happiness
  ];
  assert.deepEqual(choiceOutcomes(effects, name), [
    { label: '−20 Gold', kind: 'loss' },
    { label: '+3 happiness', kind: 'gain' },
    { label: '−4 happiness', kind: 'loss' },
  ]);
});

test('choiceOutcomes: mul modifiers and opinion changes are classified by direction', () => {
  const effects: EffectExpr[] = [
    { modifier: { stat: 'kingdom.treasury', op: 'mul', value: 0.5 } },
    { opinionChange: { delta: -5 } },
    { opinionChange: { delta: 8 } },
  ];
  assert.deepEqual(choiceOutcomes(effects, name), [
    { label: '×0.5 Gold', kind: 'loss' },
    { label: '−5 standing', kind: 'loss' },
    { label: '+8 standing', kind: 'gain' },
  ]);
});

test('choiceOutcomes: a no-effect choice yields no outcomes (the UI shows "No effect")', () => {
  assert.deepEqual(choiceOutcomes([], name), []);
  // the command escape-hatch has no reliable human description and is skipped
  const cmd: EffectExpr[] = [{ command: { type: 'kingdom.something', payload: {} } }];
  assert.deepEqual(choiceOutcomes(cmd, name), []);
});
