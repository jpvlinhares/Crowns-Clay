import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { EffectExpr } from '@crowns/data';

import { choicePaymentCost } from './eventCost.js';

// A trivial resource-id → display-name resolver for the tests.
const name = (id: string): string => id.split('.').pop() ?? id;

test('choicePaymentCost: surfaces removeResource spends as [name, amount]', () => {
  const effects: EffectExpr[] = [
    { removeResource: { resource: 'base:resource.wood', amount: 20 } },
    { grantResource: { resource: 'base:resource.tools', amount: 8 } }, // a gain, not a cost
  ];
  assert.deepEqual(choicePaymentCost(effects, name), [['wood', 20]]);
});

test('choicePaymentCost: negative treasury modifier reads as gold spent', () => {
  const effects: EffectExpr[] = [
    { modifier: { stat: 'kingdom.treasury', op: 'add', value: -50 } },
    { modifier: { stat: 'village.happiness', op: 'add', value: 6 } }, // an outcome, not a cost
  ];
  assert.deepEqual(choicePaymentCost(effects, name), [['Gold', 50]]);
});

test('choicePaymentCost: multiple spends are all listed, in order', () => {
  const effects: EffectExpr[] = [
    { removeResource: { resource: 'base:resource.tools', amount: 5 } },
    { modifier: { stat: 'kingdom.treasury', op: 'add', value: -20 } },
  ];
  assert.deepEqual(choicePaymentCost(effects, name), [['tools', 5], ['Gold', 20]]);
});

test('choicePaymentCost: non-payment effects yield an empty cost (free choices show nothing)', () => {
  const effects: EffectExpr[] = [
    { grantResource: { resource: 'base:resource.food', amount: 25 } },
    { modifier: { stat: 'village.happiness', op: 'add', value: -4 } }, // a penalty is not a payment
    { modifier: { stat: 'kingdom.treasury', op: 'mul', value: 0.5 } }, // proportional, not a fixed price
    { opinionChange: { delta: -5 } },
  ];
  assert.deepEqual(choicePaymentCost(effects, name), []);
  assert.deepEqual(choicePaymentCost([], name), []);
});
