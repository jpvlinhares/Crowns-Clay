import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { TerrainSnapshot } from '@crowns/protocol';
import { ChunkTracker, TerrainView } from './terrain.js';
import { chunkKey, CHUNK_PX, CHUNK_TILES } from './core.js';

function makeTerrain(width = 64, height = 64): TerrainSnapshot {
  const biome = new Uint8Array(width * height).fill(2);
  const river = new Uint8Array(width * height);
  biome[0] = 0; // one ocean tile
  river[10] = 1; // one river tile
  river[11] = 2; // one lake tile
  return {
    width,
    height,
    biome,
    river,
    palette: [
      { base: 0x2e5878, accent: 0x28506e, name: 'Ocean' },
      { base: 0x3a6a8a, accent: 0x427698, name: 'Coast' },
      { base: 0x8a8f5a, accent: 0x94985f, name: 'Plains' },
    ],
    riverColor: 0x4a86b0,
    lakeColor: 0x3f7aa4,
  };
}

// ---------------- terrain view ----------------

test('terrain view: palette resolution, overlays, variant determinism', () => {
  const view = new TerrainView(makeTerrain());
  assert.equal(view.colorAt(10, 0), 0x4a86b0, 'river overlay wins');
  assert.equal(view.colorAt(11, 0), 0x3f7aa4, 'lake overlay wins');
  assert.equal(view.nameAt(0, 0), 'Ocean');
  assert.equal(view.nameAt(5, 5), 'Plains');
  // variant blend: deterministic, stays between base and accent per channel
  const c1 = view.colorAt(5, 5);
  assert.equal(c1, view.colorAt(5, 5));
  const r = (c1 >> 16) & 0xff;
  assert.ok(r >= 0x8a && r <= 0x94, `blended red ${r.toString(16)} outside [base, accent]`);
  // unmapped biome code screams magenta instead of silently lying
  const t = makeTerrain();
  t.biome[42] = 9;
  assert.equal(new TerrainView(t).colorAt(42, 0), 0xff00ff);
});

// ---------------- chunk tracker: the dirty-rebake contract ----------------

const rectFor = (cx: number, cy: number) => ({
  x: cx * CHUNK_PX + 1,
  y: cy * CHUNK_PX + 1,
  w: CHUNK_PX / 2,
  h: CHUNK_PX / 2,
});

test('tracker: first sight bakes; steady state bakes nothing', () => {
  const tracker = new ChunkTracker(512, 512);
  const first = tracker.plan(rectFor(4, 4));
  assert.ok(first.bake.length > 0, 'unseen chunks must bake');
  assert.deepEqual(tracker.plan(rectFor(4, 4)).bake, [], 'steady camera bakes zero chunks');
});

test('tracker: invalidateTile rebakes exactly that chunk, only when visible', () => {
  const tracker = new ChunkTracker(512, 512);
  tracker.plan(rectFor(4, 4)); // cache the neighborhood
  const tx = 4 * CHUNK_TILES + 3;
  const ty = 4 * CHUNK_TILES + 7;
  tracker.invalidateTile(tx, ty);
  assert.equal(tracker.dirtyCount, 1);
  const plan = tracker.plan(rectFor(4, 4));
  assert.deepEqual(plan.bake, [chunkKey(4, 4)], 'exactly the invalidated chunk rebakes');
  assert.equal(tracker.dirtyCount, 0, 'dirtiness consumed by the rebake');
  assert.deepEqual(tracker.plan(rectFor(4, 4)).bake, [], 'and only once');
});

test('tracker: invalidating an uncached tile is a no-op (bakes fresh when needed)', () => {
  const tracker = new ChunkTracker(512, 512);
  tracker.plan(rectFor(4, 4));
  tracker.invalidateTile(15 * CHUNK_TILES, 15 * CHUNK_TILES); // far away, uncached
  assert.equal(tracker.dirtyCount, 0);
  tracker.invalidateTile(-5, 3); // out of bounds: ignored
  assert.equal(tracker.dirtyCount, 0);
});

test('tracker: dirty chunk that scrolled off-screen rebakes on return, not before', () => {
  const tracker = new ChunkTracker(512, 512);
  tracker.plan(rectFor(4, 4));
  tracker.invalidateTile(4 * CHUNK_TILES, 4 * CHUNK_TILES);
  const elsewhere = tracker.plan(rectFor(10, 10)); // camera left
  assert.ok(!elsewhere.bake.includes(chunkKey(4, 4)), 'off-screen dirty chunk must not bake');
  assert.ok(elsewhere.hide.includes(chunkKey(4, 4)), 'it hides instead');
  assert.equal(tracker.dirtyCount, 1, 'dirtiness persists while hidden');
  const back = tracker.plan(rectFor(4, 4));
  assert.ok(back.bake.includes(chunkKey(4, 4)), 'rebakes on return');
});

test('tracker: show/hide partitions the cache; eviction respects the budget and need', () => {
  const tracker = new ChunkTracker(512, 512, 20); // tiny budget
  tracker.plan(rectFor(0, 0));
  const plan2 = tracker.plan(rectFor(8, 8)); // far jump → old chunks not needed
  for (const key of plan2.show) assert.ok(!plan2.hide.includes(key), 'show/hide disjoint');
  if (tracker.cachedCount > 20) {
    assert.ok(plan2.evict.length === 0, 'eviction already applied within plan');
  }
  // after several jumps the cache stays at/under budget + current need
  tracker.plan(rectFor(0, 8));
  tracker.plan(rectFor(8, 0));
  assert.ok(tracker.cachedCount <= 20 + 42, `cache ${tracker.cachedCount} unbounded`);
  // evicted chunks bake fresh when needed again
  const back = tracker.plan(rectFor(0, 0));
  assert.ok(back.bake.length > 0, 'evicted chunks rebake on return');
});

test('tracker: invalidateAll marks every cached chunk', () => {
  const tracker = new ChunkTracker(512, 512);
  tracker.plan(rectFor(2, 2));
  const cached = tracker.cachedCount;
  tracker.invalidateAll();
  assert.equal(tracker.dirtyCount, cached);
  const plan = tracker.plan(rectFor(2, 2));
  assert.equal(plan.bake.length, cached, 'every visible cached chunk rebakes');
});
