/**
 * UI pass 1 (M18): the store mirrors protocol traffic faithfully, and the
 * notification queue implements GDD §1's severity tiers — urgent pauses,
 * repeats throttle per subject, the log caps. (The DOM panel shell is
 * exercised in the browser; logic lives here where node:test can reach it.)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { GameEvent } from '@crowns/protocol';
import { UIStore, LEDGER_LOG_CAP } from './store.js';
import { NotificationQueue, VISIBLE_CAP, LOG_CAP } from './notifications.js';

const village = (id: number, over: Partial<Parameters<UIStore['applyVillageStats']>[0][number]> = {}) => ({
  id,
  name: `V${id}`,
  population: 40,
  food: 100,
  happiness: 60,
  goods: {},
  tier: 1,
  taxRate: 2,
  cx: id * 30,
  cy: 30,
  ...over,
});

const event = (type: string, tick: number, data: Record<string, unknown> = {}): GameEvent =>
  ({ type, tick, data }) as GameEvent;

// ---------------- store ----------------

test('store: mirrors villages, selects a default, and finds placement targets', () => {
  const store = new UIStore();
  let notified = 0;
  store.subscribe(() => notified++);

  store.applyVillageStats([village(7), village(3)]);
  assert.equal(store.state.villages.size, 2);
  assert.equal(store.state.selectedVillage, 3, 'lowest id selected by default');
  assert.ok(notified > 0);

  // nearest centre wins placement (Chebyshev)
  assert.equal(store.villageNear(95, 31)?.id, 3, 'V3 centre (90,30) is nearest');
  assert.equal(store.villageNear(200, 30)?.id, 7);

  // a full snapshot (load) resets volatile slices but keeps the catalog
  store.applyFull({ buildings: [], edicts: [], events: [] }, { activeEdicts: ['base:edict.corvee-labor'] });
  assert.equal(store.state.villages.size, 0);
  assert.ok(store.state.activeEdicts.has('base:edict.corvee-labor'));
  assert.equal(store.state.selectedVillage, null);
});

test('store: edict toggles and rollups land in state', () => {
  const store = new UIStore();
  store.applyRollup({ treasury: 120, taxes: 5, upkeep: 2, salaries: 2, net: 1 });
  assert.equal(store.state.kingdom?.treasury, 120);
  store.applyEdictChange('base:edict.harvest-festival', true);
  assert.ok(store.state.activeEdicts.has('base:edict.harvest-festival'));
  store.applyEdictChange('base:edict.harvest-festival', false);
  assert.ok(!store.state.activeEdicts.has('base:edict.harvest-festival'));
});

test('store: ledger appends newest-last, caps at LEDGER_LOG_CAP, and resets on a full snapshot (M42)', () => {
  const store = new UIStore();
  store.appendLedger([{ tick: 1, kind: 'tax', amount: 5, detail: 'Firstholm' }]);
  store.appendLedger([{ tick: 2, kind: 'edict-upkeep', amount: -1, detail: 'base:edict.corvee-labor' }]);
  assert.deepEqual(store.state.ledger.map((r) => r.tick), [1, 2]);

  for (let n = 0; n < LEDGER_LOG_CAP + 10; n++) {
    store.appendLedger([{ tick: 100 + n, kind: 'tax', amount: 1, detail: 'V' }]);
  }
  assert.equal(store.state.ledger.length, LEDGER_LOG_CAP, 'log capped');
  assert.equal(store.state.ledger.at(-1)?.tick, 100 + LEDGER_LOG_CAP + 9, 'newest entry retained');
  assert.equal(store.state.ledger[0]?.tick, 100 + 10, 'oldest entries trimmed first');

  // an empty delta (no rollup activity yet) is a safe no-op, not a spurious notify
  let notified = 0;
  store.subscribe(() => notified++);
  store.appendLedger([]);
  assert.equal(notified, 0);

  store.applyFull({ buildings: [], edicts: [], events: [] }, undefined);
  assert.deepEqual(store.state.ledger, []);
});

// ---------------- notifications (GDD §1 severity tiers) ----------------

test('notifications: severity tiers, urgent pause, and per-subject throttling', () => {
  const queue = new NotificationQueue();

  // unknown events surface nothing
  assert.equal(queue.push(event('time.dayStarted', 24)), undefined);

  // urgent: starving raises a one-shot pause request
  const starving = queue.push(event('village.starving', 100, { village: 5 }));
  assert.equal(starving?.severity, 'urgent');
  assert.ok(queue.takePauseRequest(), 'urgent requests a pause');
  assert.ok(!queue.takePauseRequest(), 'the request is one-shot');

  // the SAME village nagging hourly is throttled…
  assert.equal(queue.push(event('village.starving', 124, { village: 5 })), undefined);
  // …but a DIFFERENT village cries out immediately
  assert.equal(queue.push(event('village.starving', 124, { village: 9 }))?.severity, 'urgent');
  // and after the throttle window the first village nags again
  assert.equal(queue.push(event('village.starving', 100 + 24 * 5, { village: 5 }))?.severity, 'urgent');

  // attention + info tiers map per the rule table
  assert.equal(queue.push(event('kingdom.edictLapsed', 200, { edict: 'base:edict.harvest-festival' }))?.severity, 'attention');
  const founded = queue.push(event('village.founded', 300, { name: 'Newholm' }));
  assert.equal(founded?.severity, 'info');
  assert.ok(founded?.text.includes('Newholm'));
});

test('notifications: visible toasts cap and the log rolls over', () => {
  const queue = new NotificationQueue();
  for (let n = 0; n < LOG_CAP + 10; n++) {
    queue.push(event('village.founded', n * 1000, { name: `V${n}` }));
  }
  assert.equal(queue.visible().length, VISIBLE_CAP);
  assert.equal(queue.all().length, LOG_CAP, 'log capped');
  assert.ok(queue.visible()[0]?.text.includes(`V${LOG_CAP + 9}`), 'newest first');
});

test('notifications: manual dismiss hides a toast but keeps the scrollback', () => {
  const queue = new NotificationQueue();
  queue.push(event('village.founded', 1000, { name: 'Alpha' }));
  const b = queue.push(event('village.founded', 2000, { name: 'Bravo' }));
  assert.equal(queue.visible().length, 2);

  queue.dismiss(b?.id ?? -1);
  assert.deepEqual(queue.visible().map((n) => n.text.includes('Alpha')), [true], 'only the un-dismissed toast shows');
  assert.equal(queue.all().length, 2, 'dismiss clears the toast, not the history');

  // dismissing pulls an older toast up into the visible window (not just leaving a gap)
  const queue2 = new NotificationQueue();
  for (let n = 0; n < VISIBLE_CAP + 1; n++) queue2.push(event('village.founded', n * 1000, { name: `V${n}` }));
  const newest = queue2.visible()[0];
  queue2.dismiss(newest?.id ?? -1);
  assert.equal(queue2.visible().length, VISIBLE_CAP, 'an older toast fills the freed slot');
  assert.ok(!queue2.visible().some((n) => n.id === newest?.id), 'the dismissed one is gone');
});
