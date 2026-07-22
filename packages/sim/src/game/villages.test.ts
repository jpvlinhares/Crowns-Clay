import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { EntityId } from '@crowns/core';
import { DefinitionDatabase, BASE_CONTENT_FILES } from '@crowns/data';
import { Kernel } from '../kernel.js';
import { World } from '../ecs.js';
import {
  registerVillageGameplay,
  VILLAGE_MIN_SPACING,
  VILLAGE_RADIUS_T1,
  type TerrainAccessor,
} from './villages.js';

/**
 * Fixture terrain (32×32), hand-built for the placement matrix:
 *   x < 4            → water (ocean tags)
 *   x === 4          → dockable coast strip
 *   y < 6 (x ≥ 5)    → forest (woodland only)
 *   y ≥ 26 (x ≥ 5)   → hills (open + mineable)
 *   elsewhere        → grassland (open + farmable)
 *   river column     → x === 20 (grassland underneath, but river-blocked)
 */
function fixtureTerrain(): TerrainAccessor {
  return {
    width: 32,
    height: 32,
    tagsAt(x, y) {
      if (x < 4) return ['water', 'deep-water'];
      if (x === 4) return ['water', 'shallow-water', 'dockable'];
      if (y < 6) return ['woodland'];
      if (y >= 26) return ['open', 'mineable'];
      return ['open', 'farmable'];
    },
    riverAt(x, _y) {
      return x === 20;
    },
    movementCostAt(x, _y) {
      return x <= 4 ? 0 : 1; // water is impassable to carts (M14)
    },
  };
}

const STOCK = { 'base:resource.wood': 200, 'base:resource.stone': 100, 'base:resource.food': 50 };

function makeGame(sandboxEnabled = false) {
  const kernel = new Kernel(42);
  const world = new World(128);
  const db = DefinitionDatabase.load(BASE_CONTENT_FILES);
  const game = registerVillageGameplay(kernel, world, db, fixtureTerrain(), STOCK, sandboxEnabled);
  kernel.attachGuard(world);
  kernel.addHashSource('world', (fold) => world.hash(fold));
  const events: { type: string; data: unknown }[] = [];
  for (const type of [
    'village.founded', 'village.rejected', 'building.placed', 'building.completed', 'building.demolished',
    'sandbox.resourceGranted',
  ]) {
    kernel.subscribe(type, (e) => events.push({ type: e.type, data: e.data }));
  }
  const submit = (type: string, payload: unknown): void => {
    kernel.submit({ type, issuer: 1, payload });
    kernel.step();
  };
  const lastRejection = (): string =>
    (events.filter((e) => e.type === 'village.rejected').at(-1)?.data as { reason: string } | undefined)?.reason ?? '';
  return { kernel, world, game, events, submit, lastRejection };
}

function foundedVillage(g: ReturnType<typeof makeGame>, x = 12, y = 14): number {
  g.submit('village.found', { x, y, name: 'Testholm' });
  const founded = g.events.find((e) => e.type === 'village.founded');
  assert.ok(founded !== undefined, `founding failed: ${g.lastRejection()}`);
  return (founded.data as { village: number }).village;
}

// ---------------- placement matrix (the M11 test objective) ----------------

test('placement: founding requires open land and center spacing', () => {
  const g = makeGame();
  g.submit('village.found', { x: 1, y: 10, name: 'Atlantis' });
  assert.match(g.lastRejection(), /lacks terrain tag 'open'/);
  g.submit('village.found', { x: 30, y: 10, name: 'Edge' }); // 2×2 footprint at x=30..31 ok; y 10 grass
  assert.ok(g.events.some((e) => e.type === 'village.founded'));
  g.submit('village.found', { x: 30 - VILLAGE_MIN_SPACING + 2, y: 12, name: 'Crowded' });
  assert.match(g.lastRejection(), /too close to another village center/);
});

test('placement: terrain tags gate every footprint tile', () => {
  const g = makeGame();
  const village = foundedVillage(g);
  // farm on grassland ok
  g.submit('village.build', { villageId: village, def: 'base:building.farm', x: 8, y: 12 });
  assert.ok(g.events.some((e) => e.type === 'building.placed'));
  // farm with one footprint tile spilling into hills (not farmable) fails
  g.submit('village.build', { villageId: village, def: 'base:building.farm', x: 8, y: 25 });
  assert.match(g.lastRejection(), /tile \(8, 26\) lacks terrain tag 'farmable'/);
  // quarry needs mineable → hills only
  g.submit('village.build', { villageId: village, def: 'base:building.quarry', x: 10, y: 12 });
  assert.match(g.lastRejection(), /lacks terrain tag 'mineable'/);
  // lumber camp in forest — but forest at y<6 is outside radius from (12,14)? 14-6=8 ≤ 12 ok
  g.submit('village.build', { villageId: village, def: 'base:building.lumber-camp', x: 12, y: 4 });
  assert.ok(g.events.filter((e) => e.type === 'building.placed').length >= 2, g.lastRejection());
  // dock on the dockable strip
  g.submit('village.build', { villageId: village, def: 'base:building.dock', x: 4, y: 13 });
  assert.ok(g.events.filter((e) => e.type === 'building.placed').length >= 3, g.lastRejection());
});

test('placement: rivers block, occupancy blocks, radius blocks, bounds block', () => {
  const g = makeGame();
  const village = foundedVillage(g);
  g.submit('village.build', { villageId: village, def: 'base:building.house', x: 20, y: 12 });
  assert.match(g.lastRejection(), /river at \(20, 12\)/);
  // overlap with the village center footprint (12..13, 14..15)
  g.submit('village.build', { villageId: village, def: 'base:building.house', x: 13, y: 15 });
  assert.match(g.lastRejection(), /occupied/);
  // outside the tier-1 radius
  const farY = 14 + VILLAGE_RADIUS_T1 + 1;
  g.submit('village.build', { villageId: village, def: 'base:building.house', x: 12, y: farY });
  assert.match(g.lastRejection(), /outside village radius/);
  // out of bounds
  g.submit('village.build', { villageId: village, def: 'base:building.granary', x: 31, y: 12 });
  assert.match(g.lastRejection(), /out of bounds/);
  // unknown village / unknown def
  g.submit('village.build', { villageId: 999999, def: 'base:building.house', x: 10, y: 12 });
  assert.match(g.lastRejection(), /no such village/);
  g.submit('village.build', { villageId: village, def: 'base:building.castle', x: 10, y: 12 });
  assert.match(g.lastRejection(), /unknown building/);
});

// ---------------- M56 (ADR-4 Amendment A1): the village map is not a fortification surface ----------------

test('placement: a castle-category def is rejected on the village map, for player AND AI issuers alike', () => {
  const g = makeGame();
  const village = foundedVillage(g);
  // ops.place()/validatePlacement() has no issuer parameter at all — the guard is the SAME
  // code path regardless of who calls it. Issuer 1 stands in for the player (the harness's
  // own `submit` convention); issuer 2 stands in for an AI kingdom — proving there is no
  // special-cased allowlist for either.
  for (const issuer of [1, 2]) {
    g.kernel.submit({ type: 'village.build', issuer, payload: { villageId: village, def: 'base:building.wall', x: 9, y: 12 } });
    g.kernel.step();
    assert.match(g.lastRejection(), /is a castle structure — build it on the defence map/, `issuer ${issuer}`);
  }
  assert.ok(!g.events.some((e) => e.type === 'building.placed'), 'no castle structure was ever placed on the village map');
});

// ---------------- M60 (ADR-4 Amendment A1): footprint reconciliation ----------------

test('rebuildDerived: a standing building occupies the footprint it was PLACED with, not the live def', () => {
  // simulates a grandfathered M28-era tower: current code can no longer PLACE a castle
  // structure on the village map (M56) and the def's footprint has since grown (M59: tower
  // 1×1 → 3×3), but a save recorded before both changes still has to load without the
  // instance retroactively swelling over whatever a player built next to it.
  const g = makeGame();
  const village = foundedVillage(g);
  const towerDef = g.game.ops.buildingDef(g.game.ops.defCode('base:building.tower'));
  assert.equal(towerDef.footprint.w, 3, 'precondition: the tower def is 3×3 today (M59)');

  const grandfathered = g.world.spawn();
  g.world.attach(grandfathered, g.game.comps.BuildingCore, {
    def: g.game.ops.defCode('base:building.tower'), x: 9, y: 12, w: 1, h: 1, // its M28 footprint
    village, progress: 1, complete: true, workers: 0,
  });
  g.game.ops.rebuildDerived();

  assert.ok(g.game.ops.isOccupied(9, 12), 'the tower still occupies its own tile');
  assert.ok(!g.game.ops.isOccupied(10, 13), 'a tile only inside the CURRENT 3×3 footprint stays free — the stored 1×1 governs');

  // a neighbour can be placed on a tile the live 3×3 footprint would have claimed
  g.submit('village.build', { villageId: village, def: 'base:building.house', x: 10, y: 12 });
  assert.ok(
    g.events.some((e) => e.type === 'building.placed' && (e.data as { def: string }).def === 'base:building.house'),
    g.lastRejection(),
  );

  // demolishing the grandfathered tower frees exactly the tile it actually held (not the
  // neighbour's, and not a phantom 3×3 block)
  g.submit('village.demolish', { buildingId: grandfathered as number });
  assert.ok(!g.game.ops.isOccupied(9, 12), 'demolish vacated the stored footprint');
  assert.ok(g.game.ops.isOccupied(10, 12), 'the neighbour built on the reclaimed tile is untouched');
});

// ---------------- cost reservation ----------------

test('costs: reserved in full at placement; insufficiency rejects atomically', () => {
  const g = makeGame();
  const village = foundedVillage(g);
  const stock = g.world.readObj(g.game.comps.Stockpile).get(village & 0x3fffff);
  const wood = g.game.ops.resourceCode('base:resource.wood') as number;
  const stone = g.game.ops.resourceCode('base:resource.stone') as number;
  // founding already reserved the center's cost (40 wood, 10 stone)
  assert.equal(stock.get(wood), 200 - 40);
  assert.equal(stock.get(stone), 100 - 10);

  g.submit('village.build', { villageId: village, def: 'base:building.house', x: 9, y: 12 });
  assert.equal(stock.get(wood), 200 - 40 - 20);

  // drain wood, then attempt a granary (30 wood + 5 stone): must reject and
  // leave BOTH resources untouched (atomic check-then-deduct)
  stock.set(wood, 10);
  const stoneBefore = stock.get(stone) as number;
  g.submit('village.build', { villageId: village, def: 'base:building.granary', x: 9, y: 17 });
  assert.match(g.lastRejection(), /insufficient base:resource.wood \(10\/30\)/);
  assert.equal(stock.get(wood), 10, 'no partial deduction');
  assert.equal(stock.get(stone), stoneBefore, 'other resources untouched');
});

// ---------------- M62: rejection events carry their issuer ----------------

test('village.rejected carries the ISSUER, so a player order and an AI order are distinguishable', () => {
  // the AI construction manager deliberately submits unaffordable orders and relies on this
  // rejection to retry later (ai/manager.ts's module doc) — before M62 the rejection event
  // carried no issuer, so the client could not tell an AI kingdom's routine "insufficient
  // wood" from the player's own failed order, and surfaced both as toasts.
  const g = makeGame();
  const village = foundedVillage(g);

  g.kernel.submit({ type: 'village.build', issuer: 1, payload: { villageId: village, def: 'base:building.house', x: 9, y: 20 } });
  g.kernel.step();
  const stock = g.world.readObj(g.game.comps.Stockpile).get(village & 0x3fffff);
  stock.set(g.game.ops.resourceCode('base:resource.wood') as number, 0); // force the next order to fail

  g.kernel.submit({ type: 'village.build', issuer: 1, payload: { villageId: village, def: 'base:building.house', x: 9, y: 22 } });
  g.kernel.step();
  const playerRejection = g.events.filter((e) => e.type === 'village.rejected').at(-1);
  assert.equal((playerRejection?.data as { issuer: number }).issuer, 1, 'the player\'s own order carries issuer 1');

  // issuer 2 stands in for an AI kingdom (the harness convention used throughout this repo,
  // e.g. villages.test.ts's own castle-rejection test above) — same village, same shortage,
  // a DIFFERENT issuer submitting the identical failing order.
  g.kernel.submit({ type: 'village.build', issuer: 2, payload: { villageId: village, def: 'base:building.house', x: 9, y: 22 } });
  g.kernel.step();
  const aiRejection = g.events.filter((e) => e.type === 'village.rejected').at(-1);
  assert.equal((aiRejection?.data as { issuer: number }).issuer, 2, 'a different issuer\'s order carries ITS issuer, not the player\'s');
});

// ---------------- construction math ----------------

test('construction: completes in exactly buildTicks with a single completed event', () => {
  const g = makeGame();
  const village = foundedVillage(g);
  g.submit('village.build', { villageId: village, def: 'base:building.house', x: 9, y: 12 }); // buildTicks 48
  const placedTick = g.kernel.currentTick;
  // the placement tick already ran construction once after the command
  for (let t = 0; t < 46; t++) g.kernel.step();
  assert.equal(g.events.filter((e) => e.type === 'building.completed').length, 0, 'not complete at buildTicks-1');
  g.kernel.step();
  const completed = g.events.filter(
    (e) => (e.data as { def?: string }).def === 'base:building.house' && e.type === 'building.completed',
  );
  assert.equal(completed.length, 1, 'exactly one completion event');
  assert.equal(g.kernel.currentTick - placedTick + 1, 48, 'took exactly buildTicks hourly steps');
  for (let t = 0; t < 20; t++) g.kernel.step();
  assert.equal(
    g.events.filter((e) => e.type === 'building.completed' && (e.data as { def?: string }).def === 'base:building.house').length,
    1,
    'completion fires once, ever',
  );
});

test('construction: village center (96 ticks) and progress values are monotone in [0,1]', () => {
  const g = makeGame();
  const village = foundedVillage(g);
  const b = g.world.read(g.game.comps.BuildingCore);
  const centerIndex = g.world.query([g.game.comps.BuildingCore]).collect()[0] as number;
  let prev = 0;
  for (let t = 0; t < 96; t++) {
    g.kernel.step();
    const p = b.progress[centerIndex] as number;
    assert.ok(p >= prev && p <= 1, `progress not monotone: ${prev} → ${p}`);
    prev = p;
  }
  assert.equal(b.complete[centerIndex], 1);
  void village;
});

// ---------------- demolish ----------------

test('demolish: frees occupancy for rebuilding; centers are protected', () => {
  const g = makeGame();
  const village = foundedVillage(g);
  g.submit('village.build', { villageId: village, def: 'base:building.house', x: 9, y: 12 });
  const placed = g.events.find((e) => e.type === 'building.placed');
  const buildingId = (placed?.data as { building: number }).building;

  // occupied while standing
  g.submit('village.build', { villageId: village, def: 'base:building.well', x: 9, y: 12 });
  assert.match(g.lastRejection(), /occupied/);

  g.submit('village.demolish', { buildingId });
  assert.ok(g.events.some((e) => e.type === 'building.demolished'));
  g.submit('village.build', { villageId: village, def: 'base:building.well', x: 9, y: 12 });
  assert.ok(
    g.events.some((e) => e.type === 'building.placed' && (e.data as { def: string }).def === 'base:building.well'),
    g.lastRejection(),
  );

  const centerId = (g.events.find((e) => e.type === 'building.placed' && (e.data as { def: string }).def === 'base:building.village-center')?.data as { building: number } | undefined)?.building
    ?? g.world.query([g.game.comps.BuildingCore]).collect()[0] as number;
  g.submit('village.demolish', { buildingId: g.world.entityAt(centerId & 0x3fffff) as number });
  assert.match(g.lastRejection(), /cannot demolish a village center|no such building/);
  void village;
});

// ---------------- sandbox editor (roadmap M40; GDD §17) ----------------

test('sandbox.grantResource: rejected outside a sandboxed session', () => {
  const g = makeGame(false);
  const village = foundedVillage(g);
  g.submit('sandbox.grantResource', { villageId: village, resource: 'base:resource.wood', amount: 100 });
  assert.match(g.lastRejection(), /sandbox mode is not enabled/);
});

test('sandbox.grantResource: adds to the stockpile, rejects unknown resource/village/non-positive amount', () => {
  const g = makeGame(true);
  const village = foundedVillage(g);
  const code = g.game.ops.resourceCode('base:resource.wood') as number;
  const before = g.world.readObj(g.game.comps.Stockpile).get(village & 0x3fffff)?.get(code) ?? 0;
  g.submit('sandbox.grantResource', { villageId: village, resource: 'base:resource.wood', amount: 250 });
  const after = g.world.readObj(g.game.comps.Stockpile).get(village & 0x3fffff)?.get(code) ?? 0;
  assert.equal(after, before + 250);
  assert.ok(g.events.some((e) => e.type === 'sandbox.resourceGranted'));

  g.submit('sandbox.grantResource', { villageId: village, resource: 'nonexistent:resource', amount: 10 });
  assert.match(g.lastRejection(), /unknown resource/);
  g.submit('sandbox.grantResource', { villageId: 999999, resource: 'base:resource.wood', amount: 10 });
  assert.match(g.lastRejection(), /no such village/);
  g.submit('sandbox.grantResource', { villageId: village, resource: 'base:resource.wood', amount: -5 });
  assert.match(g.lastRejection(), /positive number/);
});

// ---------------- determinism ----------------

test('villages: identical command sequences hash identically (village state in the fold)', () => {
  const run = (): number => {
    const g = makeGame();
    const village = foundedVillage(g);
    g.submit('village.build', { villageId: village, def: 'base:building.farm', x: 8, y: 12 });
    g.submit('village.build', { villageId: village, def: 'base:building.house', x: 9, y: 17 });
    for (let t = 0; t < 100; t++) g.kernel.step();
    return g.kernel.stateHash();
  };
  assert.equal(run(), run());
});

// keep TypeScript honest about the fixture's entity typing
const _t: EntityId | null = null;
void _t;
