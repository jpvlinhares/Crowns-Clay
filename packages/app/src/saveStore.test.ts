/**
 * Quota logic tests (roadmap M44; doc 11 §3/§4; Risk R6). The IndexedDB-backed
 * functions (putSlot/getSlot/pruneAutosaveRing) need a real browser and aren't
 * covered here — this exercises the PURE decision logic (tripwire, ring
 * selection) plus the graceful no-op behaviour when the Storage API is
 * absent, which is exactly Node's situation (no `navigator` global).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { estimateStorage, isStorageTight, requestPersistence, slotsToPrune } from './saveStore.js';

test('isStorageTight: Risk R6 tripwire is quota < 2×usage, checked at the boundary', () => {
  assert.equal(isStorageTight({ usageBytes: 100, quotaBytes: 199 }), true);
  assert.equal(isStorageTight({ usageBytes: 100, quotaBytes: 200 }), false, 'exactly 2x is NOT tight');
  assert.equal(isStorageTight({ usageBytes: 100, quotaBytes: 500 }), false);
  assert.equal(isStorageTight({ usageBytes: 0, quotaBytes: 0 }), false, 'zero usage is never tight');
});

test('slotsToPrune: keeps numbered slots under the new cap, manual/named slots always survive', () => {
  const slots = ['autosave-0', 'autosave-1', 'autosave-2', 'manual', 'autosave-10'];
  assert.deepEqual(slotsToPrune(slots, 3), ['autosave-10']);
  assert.deepEqual(slotsToPrune(slots, 1).sort(), ['autosave-1', 'autosave-10', 'autosave-2'].sort());
  assert.deepEqual(slotsToPrune(slots, 100), []);
});

test('estimateStorage/requestPersistence: never throw without a Storage API (Node has no navigator)', async () => {
  assert.equal(await estimateStorage(), null);
  assert.equal(await requestPersistence(), false);
});
