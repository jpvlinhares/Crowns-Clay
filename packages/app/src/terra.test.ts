/** Starting setup (M-era pace pass): the player begins with the KEEP ONLY and a modest,
 * data-driven stock. Guards against the demo silently pre-building a whole village again. */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { composeTerra, DEFAULT_STARTING_SETUP } from './terra.js';

test('terra start: keep only, with the data-driven starting stock', () => {
  const c = composeTerra(0x7e44a); // same seed as the terra-demo golden — founds reliably
  c.kernel.step(); // genesis founds the settlement

  let vi = -1;
  c.world.query([c.popGame.Population]).forEach((v) => (vi = v));
  assert.ok(vi >= 0, 'the starter village was founded');

  // exactly ONE building — the keep (village centre). No farm/granary/quarry/etc.
  let buildings = 0;
  c.world.query([c.game.comps.BuildingCore]).forEach(() => buildings++);
  assert.equal(buildings, 1, 'the player starts with the keep only');

  // starting stock matches the data-driven default (200 wood / 100 stone / 50 food)
  const stock = c.world.readObj(c.game.comps.Stockpile).get(vi);
  assert.equal(stock.get(c.game.ops.resourceCode('base:resource.wood') as number), 200);
  assert.equal(stock.get(c.game.ops.resourceCode('base:resource.stone') as number), 100);
  assert.equal(stock.get(c.game.ops.resourceCode('base:resource.food') as number), 50);

  assert.deepEqual([...DEFAULT_STARTING_SETUP.buildings], [], 'default setup pre-builds nothing');
});
