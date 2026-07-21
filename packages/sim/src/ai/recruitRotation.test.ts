/**
 * AI roster adoption (1.0 content-completeness) — the class-rotation recruit
 * decision (`pickRosterRecruit`, ai/military.ts) is a PURE function, so the
 * "believable, not degenerate" behaviour is pinned directly:
 *
 *   - the rotation is a mixed template (two line slots, one ranged, one
 *     cavalry) — never mono-unit, never always-the-strongest;
 *   - each slot upgrades automatically as techs unlock (spearman→swordsman,
 *     archer→crossbowman, cavalry→knight);
 *   - a still-locked class never stalls the slot (falls back to the line);
 *   - siege engines appear only under ConquestWar, with an army raised, under
 *     the cap.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { pickRosterRecruit, RECRUIT_ROTATION, AI_SIEGE_CAP, AI_SIEGE_MIN_UNITS } from './military.js';

const GATED = new Set([
  'base:unit.swordsman', 'base:unit.crossbowman', 'base:unit.knight', 'base:unit.ram', 'base:unit.trebuchet',
]);
/** Early game: only the ungated (grandfathered) units are available. */
const earlyUnlocked = (defId: string): boolean => !GATED.has(defId);
const allUnlocked = (): boolean => true;

test('rotation early game: mixed spearman/archer/cavalry — never mono-unit, no locked units picked', () => {
  // slots follow the unit count; over one full cycle the composition is MIXED
  const picks = [0, 1, 2, 3].map((n) => pickRosterRecruit(n, 0, 'MilitaryBuildup', earlyUnlocked));
  assert.deepEqual(picks, [
    'base:unit.spearman', // slot 0 = line (swordsman locked → spearman)
    'base:unit.archer',   // slot 1 = ranged (crossbowman locked → archer)
    'base:unit.spearman', // slot 2 = line
    'base:unit.cavalry',  // slot 3 = cavalry (knight locked → cavalry)
  ]);
  // two line slots keep an infantry backbone; no gated unit is ever chosen while locked
  assert.equal(picks.filter((p) => p === 'base:unit.spearman').length, 2);
  assert.ok(picks.every((p) => !GATED.has(p)));
});

test('rotation upgrades automatically once techs unlock — strongest-per-slot', () => {
  const picks = [0, 1, 2, 3].map((n) => pickRosterRecruit(n, 0, 'MilitaryBuildup', allUnlocked));
  assert.deepEqual(picks, [
    'base:unit.swordsman',   // line upgrades
    'base:unit.crossbowman', // ranged upgrades
    'base:unit.swordsman',
    'base:unit.knight',      // cavalry upgrades
  ]);
});

test('a still-locked class never stalls the slot — falls back to the line', () => {
  // ranged fully locked (no archer either): the ranged slot must still recruit SOMETHING
  const noRanged = (defId: string): boolean =>
    defId !== 'base:unit.archer' && defId !== 'base:unit.crossbowman' && !GATED.has(defId);
  const rangedSlot = RECRUIT_ROTATION.indexOf('ranged');
  const pick = pickRosterRecruit(rangedSlot, 0, 'MilitaryBuildup', noRanged);
  assert.equal(pick, 'base:unit.spearman', 'locked ranged slot falls back to the line');
});

test('siege engines: only under ConquestWar, army raised, under the cap', () => {
  // not at war → no siege even with capacity
  assert.notEqual(pickRosterRecruit(AI_SIEGE_MIN_UNITS, 0, 'MilitaryBuildup', allUnlocked), 'base:unit.trebuchet');
  // too few units → build the line first, no siege yet
  assert.notEqual(pickRosterRecruit(AI_SIEGE_MIN_UNITS - 1, 0, 'ConquestWar', allUnlocked), 'base:unit.trebuchet');
  // at war, army raised, under cap → the best unlocked engine
  assert.equal(pickRosterRecruit(AI_SIEGE_MIN_UNITS, 0, 'ConquestWar', allUnlocked), 'base:unit.trebuchet');
  // at the cap → back to the rotation, no more engines
  assert.notEqual(pickRosterRecruit(AI_SIEGE_MIN_UNITS, AI_SIEGE_CAP, 'ConquestWar', allUnlocked), 'base:unit.trebuchet');
  // at war but only the ram unlocked → the ram (best AVAILABLE engine)
  const ramOnly = (defId: string): boolean => defId === 'base:unit.ram' || !GATED.has(defId);
  assert.equal(pickRosterRecruit(AI_SIEGE_MIN_UNITS, 0, 'ConquestWar', ramOnly), 'base:unit.ram');
});
