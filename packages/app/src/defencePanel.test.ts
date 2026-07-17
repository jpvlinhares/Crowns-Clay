/**
 * M50 (Phase 8) T objective — the Castle panel's walkthrough, entirely
 * injector-free: every action below is a `{kind:'submit'}` draft with
 * issuer 1, the exact shape the panel buttons send, and every assertion
 * reads the `panels.defence` projection the panel renders from.
 *
 *   place a wall → it appears (and the map's ground refuses rock/water)
 *   demolish it → it disappears
 *   recruit a real unit (barracks → militia, the M47.7 path) → post it
 *   to a tile → the post appears → unpost → gone
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { FromSimMessage, PanelDefenceState, PlayerPanels, ToSimMessage, TransportPort } from '@crowns/protocol';
import { TICKS_PER_DAY } from '@crowns/sim';
import { connectKernelToPort } from './simPort.js';

interface Harness {
  send(message: ToSimMessage): void;
  step(ticks: number): void;
  latestPanels(): PlayerPanels;
  messages: FromSimMessage[];
  events(type: string): unknown[];
}

function boot(): Harness {
  const messages: FromSimMessage[] = [];
  let toSim: ((message: unknown) => void) | null = null;
  const port: TransportPort = {
    postMessage: (m) => messages.push(m as FromSimMessage),
    onMessage: (handler) => {
      toSim = handler;
    },
  };
  connectKernelToPort(port);
  const send = (m: ToSimMessage): void => toSim?.(m);
  send({
    kind: 'init',
    seed: 0xca57e,
    campaign: { mapSize: 'small', kingdomCount: 2, difficulty: 'fair', victory: ['chronicle'], yearLimit: 2 },
  });
  return {
    send,
    step: (ticks) => send({ kind: 'step', ticks }),
    latestPanels() {
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i] as FromSimMessage;
        if (m.kind === 'panels') return m.panels;
      }
      throw new Error('no panels message received');
    },
    messages,
    events(type: string) {
      return messages.flatMap((m) => (m.kind === 'ticked' ? m.events.filter((e) => e.type === type).map((e) => e.data) : []));
    },
  };
}

function decodeRle(pairs: readonly number[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let at = 0;
  for (let i = 0; i < pairs.length; i += 2) {
    out.fill(pairs[i] as number, at, at + (pairs[i + 1] as number));
    at += pairs[i + 1] as number;
  }
  return out;
}

/** First open, unoccupied tile scanning right from the keep — the same logic the canvas uses. */
function openTile(st: PanelDefenceState): { x: number; y: number } {
  const tiles = decodeRle(st.tiles, st.size * st.size);
  const centre = Math.floor(st.size / 2);
  const occupied = (tx: number, ty: number): boolean =>
    st.structures.some((r) => tx >= r.x && tx < r.x + r.w && ty >= r.y && ty < r.y + r.h);
  for (let r = 2; r < 40; r++) {
    const x = centre + r;
    if (tiles[centre * st.size + x] === 0 && !occupied(x, centre)) return { x, y: centre };
  }
  throw new Error('no open tile near the keep');
}

test('castle panel walkthrough: place → demolish → recruit → post → unpost, all injector-free', () => {
  const h = boot();
  h.step(1); // genesis: villages, keeps

  // ---- boot: the defence projection is present and coherent ----
  h.send({ kind: 'requestPanels' });
  let st = h.latestPanels().defence;
  assert.ok(st !== null, 'campaign panels carry the defence layer');
  assert.equal(st.size * st.size, decodeRle(st.tiles, st.size * st.size).length);
  assert.equal(st.structures.filter((s) => s.kind === 'keep').length, 1, 'the keep is pre-placed');
  assert.ok(st.buildable.length > 0, 'the build palette has defensive structures');
  assert.ok(st.buildable.every((b) => b.kind !== 'keep'), 'the keep is not on the palette');

  // ---- place a wall on open ground, exactly like a palette click ----
  const site = openTile(st);
  h.send({ kind: 'submit', drafts: [{ type: 'defence.build', issuer: 1, payload: { def: 'base:building.wall', x: site.x, y: site.y } }] });
  h.step(1);
  h.send({ kind: 'requestPanels' });
  st = h.latestPanels().defence;
  const wall = st?.structures.find((s) => s.defId === 'base:building.wall');
  assert.ok(wall !== undefined, `wall placed (rejections: ${JSON.stringify(h.events('defence.rejected').slice(-2))})`);
  assert.equal(wall.x, site.x);
  assert.ok(wall.hp > 0 && wall.hp === wall.maxHp);

  // ---- demolish it, like the ⛏ mode click ----
  h.send({ kind: 'submit', drafts: [{ type: 'defence.demolish', issuer: 1, payload: { structureId: wall.id } }] });
  h.step(1);
  h.send({ kind: 'requestPanels' });
  st = h.latestPanels().defence;
  assert.equal(st?.structures.some((s) => s.id === wall.id), false, 'wall demolished');

  // ---- a real garrison unit: barracks → militia (the M47.7 injector-free path) ----
  const full = h.messages.find((m) => m.kind === 'snapshotFull');
  assert.ok(full !== undefined && full.kind === 'snapshotFull');
  const centre = [...(full.buildings ?? [])].sort((a, b) => a.village - b.village)[0];
  assert.ok(centre !== undefined);
  const villageId = centre.village;
  outer: for (let r = 2; r <= 8; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        h.send({
          kind: 'submit',
          drafts: [{ type: 'village.build', issuer: 1, payload: { villageId, def: 'base:building.barracks', x: centre.x + dx, y: centre.y + dy } }],
        });
        h.step(1);
        if (h.events('building.placed').length > 0) break outer;
      }
    }
  }
  h.step(TICKS_PER_DAY * 30); // labor-driven construction
  h.send({ kind: 'submit', drafts: [{ type: 'army.recruitUnit', issuer: 1, payload: { villageId, unitDef: 'base:unit.militia' } }] });
  h.step(TICKS_PER_DAY * 3);
  h.send({ kind: 'requestPanels' });
  const unit = h.latestPanels().units.find((u) => u.complete && u.armyId === 0);
  assert.ok(unit !== undefined, `an idle complete unit exists (rejections: ${JSON.stringify(h.events('village.rejected').slice(-2))})`);

  // ---- post it to the layer, like the Garrison section's Post → map click ----
  st = h.latestPanels().defence;
  assert.ok(st !== null);
  const postAt = openTile(st);
  h.send({ kind: 'submit', drafts: [{ type: 'defence.post', issuer: 1, payload: { unitId: unit.id, x: postAt.x, y: postAt.y } }] });
  h.step(1);
  h.send({ kind: 'requestPanels' });
  st = h.latestPanels().defence;
  assert.deepEqual(
    st?.posts.map((p) => ({ unitId: p.unitId, x: p.x, y: p.y })),
    [{ unitId: unit.id, x: postAt.x, y: postAt.y }],
    'the post appears in the projection',
  );

  // ---- and unpost ----
  h.send({ kind: 'submit', drafts: [{ type: 'defence.unpost', issuer: 1, payload: { unitId: unit.id } }] });
  h.step(1);
  h.send({ kind: 'requestPanels' });
  st = h.latestPanels().defence;
  assert.equal(st?.posts.length, 0, 'unposted');
});

test('terra sessions carry no defence layer (panel shows its campaign-only hint)', () => {
  const messages: FromSimMessage[] = [];
  let toSim: ((message: unknown) => void) | null = null;
  const port: TransportPort = {
    postMessage: (m) => messages.push(m as FromSimMessage),
    onMessage: (handler) => {
      toSim = handler;
    },
  };
  connectKernelToPort(port);
  const send = (m: ToSimMessage): void => toSim?.(m);
  send({ kind: 'init', seed: 0x7e44a });
  send({ kind: 'step', ticks: 2 });
  const panels = messages.filter((m) => m.kind === 'panels');
  assert.equal(panels.length, 0, 'terra emits no panels projection at all — the panel hint path');
});
