/**
 * 1.x ownership guard: village-mutating commands act only on the ISSUER's own villages.
 *
 * The bug this pins: the player (issuer 1 = kingdom 0) could set the tax rate and upgrade the
 * tier of AI-owned settlements because `village.setTaxRate`/`village.upgrade`/`village.build`/
 * `village.demolish` never checked ownership. The guard lives on the ACTION (the command), so it
 * holds no matter how the command is reached — the UI hiding the controls is defence-in-depth on
 * top of this, not the guard itself.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { composeMultiKingdom } from '../ai/multiKingdomHarness.js';

const PLAYER_ISSUER = 1; // kingdom index 0
const AI_ISSUER = 2; // kingdom index 1

function setup() {
  const c = composeMultiKingdom({ seed: 4242, kingdomCount: 2, mapSize: 80 });
  c.kernel.step(); // genesis founds each kingdom's capital
  const playerVi = c.villageOf(0) as number;
  const aiVi = c.villageOf(1) as number;
  const rejections: string[] = [];
  c.kernel.subscribe<{ what: string; reason: string }>('village.rejected', (e) => {
    if (e.data.reason === 'not your village') rejections.push(e.data.what);
  });
  const taxRateOf = (vi: number): number =>
    c.world.read(c.game.comps.VillageCore).taxRate[vi & 0x3fffff] as number;
  return { c, playerVi, aiVi, rejections, taxRateOf };
}

test('ownership: the player cannot set the tax rate of an AI-owned village', () => {
  const { c, playerVi, aiVi, rejections, taxRateOf } = setup();
  const before = taxRateOf(aiVi);
  const other = before === 4 ? 0 : 4; // pick a different rate so a change would be visible

  // player tries to tax a rival's settlement — rejected, rate untouched
  c.kernel.submit({ type: 'village.setTaxRate', issuer: PLAYER_ISSUER, payload: { villageId: aiVi, rate: other } });
  c.kernel.step();
  assert.equal(taxRateOf(aiVi), before, "AI village tax rate must be unchanged by the player");
  assert.ok(rejections.includes('village.setTaxRate'), 'the cross-kingdom tax command was rejected');

  // player CAN tax its own village
  const ownBefore = taxRateOf(playerVi);
  const ownNew = ownBefore === 4 ? 0 : 4;
  c.kernel.submit({ type: 'village.setTaxRate', issuer: PLAYER_ISSUER, payload: { villageId: playerVi, rate: ownNew } });
  c.kernel.step();
  assert.equal(taxRateOf(playerVi), ownNew, 'the player can tax its own village');

  // and the OWNER (AI issuer) can tax its own village — the guard is per-owner, not player-only
  c.kernel.submit({ type: 'village.setTaxRate', issuer: AI_ISSUER, payload: { villageId: aiVi, rate: other } });
  c.kernel.step();
  assert.equal(taxRateOf(aiVi), other, 'the AI can tax its own village');
});

test('ownership: the player cannot build on or upgrade an AI-owned village', () => {
  const { c, aiVi, rejections } = setup();
  c.kernel.submit({ type: 'village.build', issuer: PLAYER_ISSUER, payload: { villageId: aiVi, def: 'base:building.house', x: 0, y: 0 } });
  c.kernel.submit({ type: 'village.upgrade', issuer: PLAYER_ISSUER, payload: { villageId: aiVi } });
  c.kernel.step();
  assert.ok(rejections.includes('village.build'), 'the cross-kingdom build was rejected');
  assert.ok(rejections.includes('village.upgrade'), 'the cross-kingdom upgrade was rejected');
});
