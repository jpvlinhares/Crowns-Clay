import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PixiRenderer } from './pixiRenderer.js';

// Pause-time placement ghosts (doc 05 §7): buildings placed while the sim is frozen can't
// commit until a tick runs (that would break determinism — see the driver note), so the
// renderer draws client-only "blueprint" ghosts and swaps them for the sim's real buildings on
// resume. These assert the reconciliation contract the app relies on, headless (no GL: addPlanned/
// clearPlanned only touch the scene graph, never the renderer, so no init() is needed).
const ghostCount = (r: PixiRenderer): number =>
  (r as unknown as { plannedGhosts: Map<string, unknown> }).plannedGhosts.size;

test('addPlanned tracks one ghost per origin tile and is idempotent', () => {
  const r = new PixiRenderer(64, 64, 800, 600);
  r.addPlanned(10, 12, 1, 1, 'housing');
  r.addPlanned(14, 12, 2, 1, 'storage');
  assert.equal(ghostCount(r), 2);
  // a second placement on the same origin tile is a no-op (the sim would reject the duplicate too)
  r.addPlanned(10, 12, 1, 1, 'housing');
  assert.equal(ghostCount(r), 2);
});

test('clearPlanned drops every ghost (the resume swap)', () => {
  const r = new PixiRenderer(64, 64, 800, 600);
  r.addPlanned(3, 4, 2, 2, 'production');
  r.addPlanned(9, 4, 1, 1, 'housing');
  assert.equal(ghostCount(r), 2);
  r.clearPlanned();
  assert.equal(ghostCount(r), 0);
  // idempotent: clearing again is harmless
  r.clearPlanned();
  assert.equal(ghostCount(r), 0);
});
