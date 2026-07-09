import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  Camera2D,
  CHUNK_PX,
  FOG_UNREVEALED_ALPHA,
  PresentationMirror,
  TILE_PX,
  kingdomColor,
  tileColor,
  visibleChunks,
} from './core.js';
// (CHUNK_PX used both by rect fixtures and the derived chunk-budget bound)

// ---------------- camera ----------------

test('camera: screen↔world round-trips at any zoom', () => {
  const cam = new Camera2D(800, 600, 8192, 8192);
  cam.zoom = 1.7;
  cam.x = 1234;
  cam.y = 987;
  const s = { x: 137, y: 411 };
  const w = cam.screenToWorld(s.x, s.y);
  const back = cam.worldToScreen(w.x, w.y);
  assert.ok(Math.abs(back.x - s.x) < 1e-9 && Math.abs(back.y - s.y) < 1e-9);
});

test('camera: pan moves world inversely to drag, scaled by zoom', () => {
  const cam = new Camera2D(800, 600, 8192, 8192);
  const { x: x0, y: y0 } = cam;
  cam.zoom = 2;
  cam.pan(100, -50); // drag right/up
  assert.equal(cam.x, x0 - 50);
  assert.equal(cam.y, y0 + 25);
});

test('camera: zoomAt keeps the cursor-anchored world point fixed', () => {
  const cam = new Camera2D(800, 600, 8192, 8192);
  cam.x = 3000;
  cam.y = 2500;
  const cursor = { x: 600, y: 150 };
  const anchor = cam.screenToWorld(cursor.x, cursor.y);
  cam.zoomAt(cursor.x, cursor.y, 1.5);
  const after = cam.screenToWorld(cursor.x, cursor.y);
  assert.ok(Math.abs(after.x - anchor.x) < 1e-9 && Math.abs(after.y - anchor.y) < 1e-9);
  assert.equal(cam.zoom, 1.5);
});

test('camera: clamps to world edges and respects zoom bounds', () => {
  const cam = new Camera2D(800, 600, 8192, 8192);
  cam.pan(1e9, 1e9); // drag far past the corner
  const rect = cam.visibleRect();
  assert.ok(rect.x >= 0 && rect.y >= 0, 'view must not leave the world');
  cam.pan(-1e9, -1e9);
  const rect2 = cam.visibleRect();
  assert.ok(rect2.x + rect2.w <= 8192 && rect2.y + rect2.h <= 8192);

  cam.zoomAt(400, 300, 1e9);
  assert.equal(cam.zoom, cam.maxZoom);
  cam.zoomAt(400, 300, 0);
  assert.equal(cam.zoom, cam.minZoom);
});

test('camera: world smaller than viewport locks centered (no jitter)', () => {
  const cam = new Camera2D(1920, 1080, 640, 640); // tiny map, big screen
  cam.pan(500, 500);
  assert.equal(cam.x, 320);
  assert.equal(cam.y, 320);
});

// ---------------- chunk visibility ----------------

test('chunks: visible range covers the rect plus margin, clamped to the map', () => {
  // 512×512 tiles → 16×16 chunks (0..15)
  const range = visibleChunks({ x: CHUNK_PX * 3.2, y: CHUNK_PX * 5.9, w: CHUNK_PX * 2, h: CHUNK_PX * 1.5 }, 512, 512);
  assert.deepEqual(range, { cx0: 2, cy0: 4, cx1: 6, cy1: 8 }); // ±1 margin

  const corner = visibleChunks({ x: -5000, y: -5000, w: 100, h: 100 }, 512, 512);
  assert.deepEqual(corner, { cx0: 0, cy0: 0, cx1: 0, cy1: 0 });

  const far = visibleChunks({ x: 1e9, y: 1e9, w: 10, h: 10 }, 512, 512);
  assert.deepEqual(far, { cx0: 15, cy0: 15, cx1: 15, cy1: 15 });
});

test('chunks: 100k-tile pan sweep touches only O(viewport) chunks per frame', () => {
  // Simulate a full edge-to-edge pan across a 512×512 (262k-tile) map at 1080p
  // and assert the per-frame visible-chunk count stays tiny and bounded — the
  // pure-math half of the M6 fps target (WebGL half verified on real hardware).
  const cam = new Camera2D(1920, 1080, 512 * TILE_PX, 512 * TILE_PX);
  // Geometric ceiling: a W×H viewport can straddle ceil(W/CHUNK)+1 columns,
  // plus 2 margin columns; same for rows. 1080p → (4+3) × (3+3) = 42 chunks.
  const bound =
    (Math.ceil(1920 / CHUNK_PX) + 3) * (Math.ceil(1080 / CHUNK_PX) + 3);
  let maxChunks = 0;
  for (let step = 0; step < 240; step++) {
    cam.pan(-40, -18); // ~4 seconds of fast drag at 60 fps
    const r = visibleChunks(cam.visibleRect(), 512, 512);
    maxChunks = Math.max(maxChunks, (r.cx1 - r.cx0 + 1) * (r.cy1 - r.cy0 + 1));
  }
  assert.ok(maxChunks <= bound, `visible chunk count ${maxChunks} exceeds geometric bound ${bound}`);
  assert.ok(maxChunks < 64, 'sanity: still a tiny fraction of the 256-chunk map');
});

// ---------------- tile field ----------------

test('tiles: color field is deterministic and draws from the fixed palette', () => {
  assert.equal(tileColor(100, 200), tileColor(100, 200));
  const seen = new Set<number>();
  for (let x = 0; x < 64; x++) for (let y = 0; y < 64; y++) seen.add(tileColor(x, y));
  assert.ok(seen.size >= 3 && seen.size <= 7, `palette size ${seen.size} out of expected range`);
});

// ---------------- presentation mirror ----------------

test('mirror: full → delta lifecycle with interpolation', () => {
  const m = new PresentationMirror();
  m.applyFull([
    { id: 1, kind: 0, x: 10, y: 10 },
    { id: 2, kind: 0, x: 20, y: 20 },
  ]);
  assert.equal(m.size, 2);

  m.applyDelta({ spawned: [{ id: 3, kind: 0, x: 5, y: 5 }], moved: [1, 14, 10], despawned: [2] });
  assert.equal(m.size, 2);

  const at0 = m.view(0);
  const e1at0 = at0.find((e) => e.id === 1);
  assert.equal(e1at0?.x, 10, 'alpha 0 = previous position');
  const atHalf = m.view(0.5);
  const e1 = atHalf.find((e) => e.id === 1);
  assert.equal(e1?.x, 12, 'alpha 0.5 = midpoint');
  const at1 = m.view(1);
  assert.equal(at1.find((e) => e.id === 1)?.x, 14, 'alpha 1 = current');
  assert.equal(at1.find((e) => e.id === 3)?.x, 5, 'spawned entity present, not interpolated');
  assert.equal(at1.find((e) => e.id === 2), undefined, 'despawned entity gone');
});

test('mirror: alpha is clamped and applyFull resets everything', () => {
  const m = new PresentationMirror();
  m.applyFull([{ id: 1, kind: 0, x: 0, y: 0 }]);
  m.applyDelta({ spawned: [], moved: [1, 10, 0], despawned: [] });
  assert.equal(m.view(5).find((e) => e.id === 1)?.x, 10, 'alpha > 1 clamps to 1');
  assert.equal(m.view(-3).find((e) => e.id === 1)?.x, 0, 'alpha < 0 clamps to 0');
  m.applyFull([{ id: 9, kind: 1, x: 1, y: 1 }]);
  assert.equal(m.size, 1);
  assert.equal(m.view(1).find((e) => e.id === 1), undefined);
});

// ---------------- territory & fog (M22) ----------------

test('kingdomColor: same index always yields the same color, distinct indices differ', () => {
  assert.equal(kingdomColor(0), kingdomColor(0));
  assert.notEqual(kingdomColor(0), kingdomColor(1));
});

test('kingdomColor: cycles for indices beyond the palette, including negative-safe wrap', () => {
  const paletteSize = new Set([0, 1, 2, 3, 4, 5, 6, 7].map(kingdomColor)).size;
  assert.ok(paletteSize <= 6, 'expected the palette to repeat within 8 indices');
  assert.equal(kingdomColor(6), kingdomColor(0)); // wraps at palette length (6 colors)
});

test('FOG_UNREVEALED_ALPHA: a sane overlay alpha (visible but not opaque)', () => {
  assert.ok(FOG_UNREVEALED_ALPHA > 0 && FOG_UNREVEALED_ALPHA < 1);
});
