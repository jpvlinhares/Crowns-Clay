/**
 * Castles v1 (M28) — the roadmap T objective is "enclosure algorithm
 * fixtures": hand-built wall/gate configurations must enclose exactly the
 * tiles a human would expect. Also covers the derived `isCastle` flag
 * (flips on when walls close a loop, off again on demolish) and determinism.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DefinitionDatabase, BASE_CONTENT_FILES } from '@crowns/data';
import { Kernel } from '../kernel.js';
import { World } from '../ecs.js';
import { TICKS_PER_DAY } from '../time.js';
import { registerVillageGameplay, type TerrainAccessor } from './villages.js';
import { registerCastleGameplay, computeEnclosure } from './castles.js';

// ---------------- the T objective: enclosure algorithm fixtures ----------------

const W = 20; // fixture grid width, small and hand-checkable

function tile(x: number, y: number): number {
  return y * W + x;
}

test('enclosure: a closed 3×3 ring encloses exactly its one interior tile', () => {
  const walls = new Set<number>();
  for (let x = 4; x <= 6; x++) {
    walls.add(tile(x, 4));
    walls.add(tile(x, 6));
  }
  walls.add(tile(4, 5));
  walls.add(tile(6, 5));
  const enclosed = computeEnclosure(walls, W, 0, 0, W - 1, 9);
  assert.deepEqual(enclosed, new Set([tile(5, 5)]));
});

test('enclosure: a ring with a single gap encloses nothing — the interior leaks to the outside', () => {
  const walls = new Set<number>();
  for (let x = 4; x <= 6; x++) walls.add(tile(x, 4)); // top row, no gap
  walls.add(tile(4, 5)); // left side
  // right side (x=6, y=5) deliberately OMITTED — the gap
  for (let x = 4; x <= 6; x++) walls.add(tile(x, 6)); // bottom row
  const enclosed = computeEnclosure(walls, W, 0, 0, W - 1, 9);
  assert.equal(enclosed.size, 0, 'a single-tile gap must connect the interior to the outside');
});

test('enclosure: a gate tile blocks the flood exactly like a wall (a defended chokepoint, not a hole)', () => {
  const walls = new Set<number>();
  for (let x = 4; x <= 6; x++) walls.add(tile(x, 4));
  walls.add(tile(4, 5));
  walls.add(tile(6, 5)); // this would be a "gatehouse" building in the real game — same graph role
  for (let x = 4; x <= 6; x++) walls.add(tile(x, 6));
  const enclosed = computeEnclosure(walls, W, 0, 0, W - 1, 9);
  assert.deepEqual(enclosed, new Set([tile(5, 5)]), 'gates count as boundary tiles for enclosure');
});

test('enclosure: a larger 5×5 ring encloses its full 3×3 interior', () => {
  const walls = new Set<number>();
  for (let x = 2; x <= 6; x++) {
    walls.add(tile(x, 2));
    walls.add(tile(x, 6));
  }
  for (let y = 2; y <= 6; y++) {
    walls.add(tile(2, y));
    walls.add(tile(6, y));
  }
  const enclosed = computeEnclosure(walls, W, 0, 0, W - 1, 9);
  const expected = new Set<number>();
  for (let x = 3; x <= 5; x++) for (let y = 3; y <= 5; y++) expected.add(tile(x, y));
  assert.deepEqual(enclosed, expected);
});

test('enclosure: no walls at all encloses nothing', () => {
  assert.equal(computeEnclosure(new Set(), W, 0, 0, W - 1, 9).size, 0);
});

test('enclosure: wall tiles themselves are never counted as enclosed', () => {
  const walls = new Set<number>();
  for (let x = 4; x <= 6; x++) {
    walls.add(tile(x, 4));
    walls.add(tile(x, 6));
  }
  walls.add(tile(4, 5));
  walls.add(tile(6, 5));
  const enclosed = computeEnclosure(walls, W, 0, 0, W - 1, 9);
  for (const w of walls) assert.equal(enclosed.has(w), false);
});

// ---------------- integration: real buildings, derived isCastle ----------------

const plain: TerrainAccessor = {
  width: 64,
  height: 64,
  tagsAt: () => ['open', 'farmable', 'mineable', 'woodland'],
  riverAt: () => false,
  movementCostAt: () => 1,
};

function makeCastle(options: { seed?: number } = {}) {
  const kernel = new Kernel(options.seed ?? 5);
  const world = new World(512);
  const db = DefinitionDatabase.load(BASE_CONTENT_FILES);
  const stock = { 'base:resource.wood': 200, 'base:resource.stone': 400 };
  // no population/economy registered — construction runs unlabored (game.settings.laborGated
  // defaults to false), keeping this test focused purely on the defence graph
  const game = registerVillageGameplay(kernel, world, db, plain, stock);
  const castles = registerCastleGameplay(kernel, world, db, game);
  kernel.attachGuard(world);
  kernel.addHashSource('world', (fold) => world.hash(fold));

  const rejections: string[] = [];
  const events: { type: string; data: unknown }[] = [];
  kernel.subscribe<{ what: string; reason: string }>('village.rejected', (e) => rejections.push(`${e.data.what}: ${e.data.reason}`));
  for (const type of ['building.completed', 'building.demolished']) {
    kernel.subscribe(type, (e) => events.push({ type, data: e.data }));
  }

  const submit = (type: string, payload: unknown): void => {
    kernel.submit({ type, issuer: 1, payload });
    kernel.step();
  };

  submit('village.found', { x: 30, y: 30, name: 'Crownton' });
  let villageId = -1;
  world.query([game.comps.VillageCore]).forEach((_i, entity) => (villageId = entity as number));
  assert.ok(villageId >= 0);

  const build = (defId: string, x: number, y: number): number => {
    submit('village.build', { villageId, def: defId, x, y });
    let building = -1;
    const b = world.read(game.comps.BuildingCore);
    world.query([game.comps.BuildingCore]).forEach((i, entity) => {
      if ((b.x[i] as number) === x && (b.y[i] as number) === y) building = entity as number;
    });
    assert.ok(building >= 0, `placement failed at (${x},${y}): ${rejections.at(-1) ?? ''}`);
    return building;
  };

  const days = (n: number): void => {
    for (let t = 0; t < n * TICKS_PER_DAY; t++) kernel.step();
  };

  const isCastle = (): boolean => (world.read(game.comps.VillageCore).isCastle[villageId & 0x3fffff] as number) === 1;

  return { kernel, world, db, game, castles, villageId, submit, build, days, isCastle, rejections, events };
}

test('a closed ring of wall buildings makes the village a castle; a demolished wall un-does it', () => {
  const m = makeCastle();
  assert.equal(m.isCastle(), false, 'a village with no fortifications is not a castle');

  // a 3×3 ring of walls, offset from the village centre (30,30), well inside the search box
  const ringTiles: [number, number][] = [];
  for (let x = 20; x <= 22; x++) {
    ringTiles.push([x, 20]);
    ringTiles.push([x, 22]);
  }
  ringTiles.push([20, 21]);
  ringTiles.push([22, 21]);
  const wallIds = ringTiles.map(([x, y]) => m.build('base:building.wall', x, y));
  m.days(3); // buildTicks 24 = 1 day, unlabored — generous margin
  assert.equal(m.isCastle(), true, 'a closed wall loop must flip isCastle on');

  const graph = m.castles.defenseGraphOf(m.villageId);
  assert.equal(graph.nodes.length, 8);
  assert.deepEqual(graph.enclosedTiles, new Set([21 * m.game.terrain.width + 21]));

  // demolish an edge-middle wall (21,20), not a corner — removing a corner tile
  // doesn't actually open a 4-neighbour path (both its orthogonal neighbours are
  // still walls), so it wouldn't test the enclosure breaking at all
  m.submit('village.demolish', { buildingId: wallIds[2] });
  assert.equal(m.isCastle(), false, 'breaking the ring must flip isCastle back off');
});

test('a gatehouse in the ring still closes the loop', () => {
  const m = makeCastle({ seed: 6 });
  const ringTiles: [number, number, string][] = [
    [20, 20, 'base:building.wall'], [21, 20, 'base:building.wall'], [22, 20, 'base:building.wall'],
    [20, 22, 'base:building.wall'], [21, 22, 'base:building.wall'], [22, 22, 'base:building.wall'],
    [20, 21, 'base:building.gatehouse'], [22, 21, 'base:building.wall'],
  ];
  for (const [x, y, def] of ringTiles) m.build(def, x, y);
  m.days(3);
  assert.equal(m.isCastle(), true);
});

// ---------------- determinism ----------------

test('castles: identical histories hash identically', () => {
  const run = (): number => {
    const m = makeCastle({ seed: 9 });
    m.build('base:building.wall', 20, 20);
    m.build('base:building.wall', 21, 20);
    m.build('base:building.wall', 20, 21);
    m.days(3);
    return m.kernel.stateHash();
  };
  assert.equal(run(), run());
});
