/**
 * AI build-site search (placement.ts). The reservation rule: a building that doesn't itself need
 * scarce harvester terrain (mineable/woodland) must not squat the single guaranteed block of it —
 * a house on the only mineable tile is exactly what blocks a quarry from ever being built.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DefinitionDatabase, BASE_CONTENT_FILES } from '@crowns/data';
import { Kernel } from '../kernel.js';
import { World } from '../ecs.js';
import { registerVillageGameplay, type TerrainAccessor } from '../game/villages.js';
import { findBuildSite } from './placement.js';

const CENTER = 30;

/** Terrain that is plain 'open'/'farmable' everywhere except a 2×2 `mineable` block whose top-left
 * is (mineX, mineY) — the "only stone source". `allMineable` makes the whole map mineable (the
 * fallback case: nowhere is reserved-free). */
function terrainWith(mineX: number, mineY: number, allMineable = false): TerrainAccessor {
  return {
    width: 64,
    height: 64,
    riverAt: () => false,
    movementCostAt: () => 1,
    tagsAt: (x, y) => {
      if (allMineable) return ['open', 'farmable', 'mineable'];
      const inBlock = x >= mineX && x <= mineX + 1 && y >= mineY && y <= mineY + 1;
      return inBlock ? ['open', 'farmable', 'mineable'] : ['open', 'farmable'];
    },
  };
}

const STOCK = { 'base:resource.wood': 2000, 'base:resource.stone': 500, 'base:resource.food': 200 };

function foundVillage(terrain: TerrainAccessor) {
  const kernel = new Kernel(7);
  const world = new World(512);
  const db = DefinitionDatabase.load(BASE_CONTENT_FILES);
  const game = registerVillageGameplay(kernel, world, db, terrain, STOCK);
  kernel.attachGuard(world);
  kernel.registerSystem({
    name: 'genesis',
    period: 0x7fffffff,
    phase: 1,
    access: { writes: [game.comps.VillageCore, game.comps.VillageName, game.comps.Stockpile, game.comps.BuildingCore] },
    update(ctx) {
      const r = game.ops.found(ctx, CENTER, CENTER, 'Testholm', STOCK);
      if (typeof r === 'string') throw new Error(r);
    },
  });
  kernel.step();
  let villageId = -1;
  world.query([game.comps.VillageCore]).forEach((_i, e) => (villageId = e as number));
  return { game, db, villageId: villageId as never };
}

const overlapsBlock = (site: { x: number; y: number }, def: { footprint: { w: number; h: number } }, mineX: number, mineY: number): boolean => {
  for (let dy = 0; dy < def.footprint.h; dy++)
    for (let dx = 0; dx < def.footprint.w; dx++) {
      const x = site.x + dx, y = site.y + dy;
      if (x >= mineX && x <= mineX + 1 && y >= mineY && y <= mineY + 1) return true;
    }
  return false;
};

test('findBuildSite: a house leaves the only mineable block free for the quarry', () => {
  const mineX = CENTER + 2, mineY = CENTER; // a 2×2 mineable block near the centre
  const v = foundVillage(terrainWith(mineX, mineY));
  const house = v.db.buildings.get('base:building.house');
  const quarry = v.db.buildings.get('base:building.quarry');
  assert.ok(house !== undefined && quarry !== undefined);

  const houseSite = findBuildSite(v.game.ops, v.villageId, house, CENTER, CENTER, 12);
  assert.ok(houseSite !== null);
  assert.ok(!overlapsBlock(houseSite, house, mineX, mineY), 'house avoided the mineable block');

  const quarrySite = findBuildSite(v.game.ops, v.villageId, quarry, CENTER, CENTER, 12);
  assert.ok(quarrySite !== null, 'quarry still finds the reserved block');
  assert.ok(overlapsBlock(quarrySite, quarry, mineX, mineY), 'quarry landed on the mineable block');
});

test('findBuildSite: falls back to any valid tile when everything is reserved terrain', () => {
  const v = foundVillage(terrainWith(0, 0, true)); // whole map mineable — no reserved-free tile exists
  const house = v.db.buildings.get('base:building.house');
  assert.ok(house !== undefined);
  const site = findBuildSite(v.game.ops, v.villageId, house, CENTER, CENTER, 12);
  assert.ok(site !== null, 'house is still placed rather than blocked outright');
});
