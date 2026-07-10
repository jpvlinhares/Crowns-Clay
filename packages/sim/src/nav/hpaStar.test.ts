/**
 * Hierarchical pathfinding (M26) — the roadmap T objective is "pathfinding
 * budget ≤20% at 200 armies": this proves the chunk-graph HPA* is not just
 * correct (avoids obstacles, reaches the exact tile, fails cleanly when
 * unreachable) but that it stays fast at army-scale distances where a naive
 * whole-map A* — the thing HPA* replaces for armies — would not.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { HierarchicalPathService, type HpaTerrain } from './hpaStar.js';

function walledTerrain(size: number, walls: readonly { x: number; gapY: number }[]): HpaTerrain {
  const blocked = (x: number, y: number): boolean => {
    for (const w of walls) if (x === w.x && y !== w.gapY) return true;
    return false;
  };
  return {
    width: size,
    height: size,
    passableAt: (x, y) => x >= 0 && y >= 0 && x < size && y < size && !blocked(x, y),
    stepCostAt: () => 1,
  };
}

function naiveAStar(terrain: HpaTerrain, fromX: number, fromY: number, toX: number, toY: number): boolean {
  const w = terrain.width;
  const from = fromY * w + fromX;
  const to = toY * w + toX;
  const open: { tile: number; f: number }[] = [{ tile: from, f: 0 }];
  const g = new Map<number, number>([[from, 0]]);
  const closed = new Set<number>();
  let found = from === to;
  while (!found && open.length > 0) {
    let best = 0;
    for (let i = 1; i < open.length; i++) {
      if ((open[i] as { f: number }).f < (open[best] as { f: number }).f) best = i;
    }
    const { tile } = open.splice(best, 1)[0] as { tile: number };
    if (tile === to) {
      found = true;
      break;
    }
    if (closed.has(tile)) continue;
    closed.add(tile);
    const tx = tile % w;
    const ty = Math.floor(tile / w);
    for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1]] as const) {
      const nx = tx + dx;
      const ny = ty + dy;
      if (!terrain.passableAt(nx, ny)) continue;
      const nb = ny * w + nx;
      if (closed.has(nb)) continue;
      const ng = (g.get(tile) as number) + 1;
      if (ng < (g.get(nb) ?? Infinity)) {
        g.set(nb, ng);
        open.push({ tile: nb, f: ng + Math.abs(nx - toX) + Math.abs(ny - toY) });
      }
    }
  }
  return found;
}

test('route: crosses each wall only at its gap, reaches the exact tile', () => {
  const size = 256;
  const walls = [{ x: 64, gapY: 100 }, { x: 128, gapY: 25 }, { x: 192, gapY: 150 }];
  const terrain = walledTerrain(size, walls);
  const hpa = new HierarchicalPathService(terrain);
  const path = hpa.route(0, 0, 250, 250);
  assert.ok(path !== null);
  const seen = new Set(walls.map((w) => w.x));
  let px = 0;
  let py = 0;
  for (const tile of path as number[]) {
    const tx = tile % size;
    const ty = Math.floor(tile / size);
    assert.equal(Math.abs(tx - px) + Math.abs(ty - py), 1, 'every step is one 4-neighbour move');
    assert.ok(terrain.passableAt(tx, ty), 'never steps on a blocked tile');
    const wall = walls.find((w) => w.x === tx);
    if (wall !== undefined) assert.equal(ty, wall.gapY, `crosses wall x=${tx} only at its gap`);
    px = tx;
    py = ty;
  }
  assert.equal(px, 250);
  assert.equal(py, 250);
  void seen;
});

test('route: an unreachable goal (fully enclosed) returns null cleanly', () => {
  const size = 64;
  const terrain: HpaTerrain = {
    width: size,
    height: size,
    passableAt: (x, y) => {
      if (x < 0 || y < 0 || x >= size || y >= size) return false;
      // a closed box with no gap around (20,20)-(24,24)
      const onBoxEdge = (x >= 19 && x <= 25 && (y === 19 || y === 25)) || (y >= 19 && y <= 25 && (x === 19 || x === 25));
      return !onBoxEdge;
    },
    stepCostAt: () => 1,
  };
  const hpa = new HierarchicalPathService(terrain);
  assert.equal(hpa.route(0, 0, 22, 22), null);
});

test('route: same tile and adjacent-tile trivial cases', () => {
  const terrain = walledTerrain(64, []);
  const hpa = new HierarchicalPathService(terrain);
  assert.deepEqual(hpa.route(5, 5, 5, 5), []);
  assert.deepEqual(hpa.route(5, 5, 6, 5), [5 * 64 + 6]); // tile index = y*width + x
});

test('route: deterministic — repeated calls on the same terrain agree', () => {
  const size = 128;
  const terrain = walledTerrain(size, [{ x: 64, gapY: 40 }]);
  const hpa = new HierarchicalPathService(terrain);
  const a = hpa.route(2, 2, 120, 100);
  const b = hpa.route(2, 2, 120, 100);
  assert.deepEqual(a, b);
});

// ---------------- the M26 T objective: pathfinding stays cheap at army scale ----------------

test('performance: HPA* resolves 200 army-scale routes far faster than naive whole-map A*', () => {
  const size = 512;
  const walls = [{ x: 128, gapY: 200 }, { x: 256, gapY: 50 }, { x: 384, gapY: 300 }];
  const terrain = walledTerrain(size, walls);
  const hpa = new HierarchicalPathService(terrain); // one-time build — never charged per-tick

  // deterministic pseudo-random long-distance queries (LCG, no @crowns/core dependency needed here)
  let seed = 0x5eed;
  const rand = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const queries: [number, number, number, number][] = [];
  for (let i = 0; i < 200; i++) {
    queries.push([Math.floor(rand() * size), Math.floor(rand() * size), Math.floor(rand() * size), Math.floor(rand() * size)]);
  }

  const hpaStart = performance.now();
  for (const [fx, fy, tx, ty] of queries) hpa.route(fx, fy, tx, ty);
  const hpaMs = performance.now() - hpaStart;

  // naive baseline over a SUBSET (it is far too slow to run all 200 in a test)
  const sample = queries.slice(0, 20);
  const naiveStart = performance.now();
  for (const [fx, fy, tx, ty] of sample) naiveAStar(terrain, fx, fy, tx, ty);
  const naiveMs = performance.now() - naiveStart;

  const hpaPerRoute = hpaMs / queries.length;
  const naivePerRoute = naiveMs / sample.length;
  // doc 11 §2: sim tick budget ≤10ms mean, pathfinding ≤20% of it (≤2ms). The
  // absolute bound is loosened here (shared CI hardware, JIT warm-up, running
  // after 200+ other tests) — the load-bearing, hardware-independent proof is
  // the RATIO: HPA* must decisively beat the naive whole-map A* it replaces.
  assert.ok(hpaPerRoute < 5, `HPA* averaged ${hpaPerRoute.toFixed(2)}ms/route, want < 5ms`);
  assert.ok(hpaPerRoute * 20 < naivePerRoute, `HPA* (${hpaPerRoute.toFixed(2)}ms) must beat naive A* (${naivePerRoute.toFixed(2)}ms) by ≥20×`);
});
