/**
 * Golden-scenario RECIPE guards (M69). The fixtures themselves prove determinism; these tests
 * pin the properties of the recipes that make those fixtures worth having, and that a later
 * edit could quietly remove without failing anything else.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TICKS_PER_DAY } from '@crowns/sim';
import { scenarios, campaignDemo, campaignLong } from './scenarios.js';

const TICKS_PER_YEAR = TICKS_PER_DAY * 360;

test('scenario names are unique (a duplicate would silently overwrite a fixture)', () => {
  const names = scenarios.map((s) => s.name);
  assert.deepEqual([...new Set(names)].sort(), [...names].sort());
});

// The reason campaign-long exists. Victory state needs YEARS to diverge, so campaign-demo's
// 3000 ticks (125 days) cannot see a victory-logic regression — measured in M69, not assumed:
// dropping DEFAULT_PROSPERITY_HAPPINESS 75 -> 5 leaves campaign-demo byte-identical. Ten years
// is DEFAULT_HEGEMONY_YEARS, the shortest horizon at which the hegemony path can declare at all.
// Shortening this scenario re-blinds the only fixture in the repo that watches victory.
test('campaign-long runs at least DEFAULT_HEGEMONY_YEARS, or victory goes unwatched again', () => {
  assert.ok(
    campaignLong.ticks >= 10 * TICKS_PER_YEAR,
    `campaign-long must cover >= 10 in-game years, got ${(campaignLong.ticks / TICKS_PER_YEAR).toFixed(1)}y`,
  );
});

// Same seed and same compose path, so the two campaign goldens are the SAME world at two
// horizons. That makes campaign-long a strict superset probe: any divergence between them
// inside the first 3000 ticks is a harness bug, not a gameplay difference.
test('campaign-long is campaign-demo\'s world, only longer', () => {
  assert.equal(campaignLong.seed, campaignDemo.seed);
  assert.ok(campaignLong.ticks > campaignDemo.ticks);
});
