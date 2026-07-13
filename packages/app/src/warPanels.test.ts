/**
 * M47.7 (doc 12 R1) — "no player-facing action may require the debug injector."
 *
 * Drives a REAL campaign session through the exact transport the browser UI
 * uses (`connectKernelToPort` + `{kind:'submit'}` drafts with issuer 1 — the
 * same shape every panel button sends), and asserts the `panels` projection
 * reflects each action: research picked, barracks built, militia recruited,
 * army mustered, unit assigned, march ordered (position actually changes),
 * diplomacy commands fog-gated, and a real end-of-campaign winner at the
 * year cap (the new-game screen's short-game `yearLimit`).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { FromSimMessage, PlayerPanels, ToSimMessage, TransportPort } from '@crowns/protocol';
import { TICKS_PER_DAY, TICKS_PER_YEAR } from '@crowns/sim';
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
    seed: 0x477e57,
    campaign: { mapSize: 'small', kingdomCount: 2, difficulty: 'fair', victory: ['chronicle'], yearLimit: 1 },
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

test('campaign panels: research, military, diplomacy, and a real end screen — all injector-free', () => {
  const h = boot();

  // ---- boot: panels arrive with the full projection shape ----
  const p0 = h.latestPanels();
  assert.equal(p0.kingdoms.length, 1, 'one rival kingdom');
  // M47.8: GDD §13 history seeding — courts know their neighbours' capitals from day one
  assert.equal(p0.kingdoms[0]?.discovered, true, 'rival capital known at genesis (history seeding)');
  assert.ok((p0.kingdoms[0]?.knownFor.length ?? 0) > 0, 'personality legibility tags surface once discovered (doc 07 §9)');
  assert.notEqual(p0.research, null);
  assert.ok((p0.research?.available.length ?? 0) > 0, 'starting techs available');
  assert.deepEqual(p0.victory?.tracks.map((t) => t.type), ['chronicle']);
  assert.equal(p0.victory?.winner, null);

  // ---- research: pick the first available tech, exactly like the panel button ----
  const firstTech = p0.research?.available[0]?.techId as string;
  h.send({ kind: 'submit', drafts: [{ type: 'kingdom.setActiveResearch', issuer: 1, payload: { techId: firstTech } }] });
  h.step(2);
  assert.equal(h.latestPanels().research?.active?.techId, firstTech, 'active research reflects the pick');

  // ---- military: build a barracks near the village centre (spiral, same as genesis) ----
  const full = h.messages.find((m) => m.kind === 'snapshotFull');
  assert.ok(full !== undefined && full.kind === 'snapshotFull');
  // genesis founds kingdom 0's village FIRST — the player's centre is the building
  // with the lowest owning-village id ('center' is a def tag, not a wire category)
  const centre = [...(full.buildings ?? [])].sort((a, b) => a.village - b.village)[0];
  assert.ok(centre !== undefined, 'player centre building present in the snapshot');
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
  assert.ok(h.events('building.placed').length > 0, 'barracks placement accepted');
  h.step(TICKS_PER_DAY * 30); // construction is labor-driven — give it a month

  // ---- recruit militia, wait out training, muster an army, assign, march ----
  h.send({ kind: 'submit', drafts: [{ type: 'army.recruitUnit', issuer: 1, payload: { villageId, unitDef: 'base:unit.militia' } }] });
  h.step(TICKS_PER_DAY * 3);
  let p = h.latestPanels();
  assert.ok(p.units.length > 0, `militia recruited (rejections: ${JSON.stringify(h.events('village.rejected').slice(-2))})`);
  assert.equal(p.units[0]?.complete, true, 'militia finished training (24 ticks)');

  h.send({ kind: 'submit', drafts: [{ type: 'army.createArmy', issuer: 1, payload: { name: 'First Host', villageId } }] });
  h.step(1);
  p = h.latestPanels();
  assert.equal(p.armies.length, 1, 'army mustered');
  const armyId = p.armies[0]?.id as number;

  h.send({ kind: 'submit', drafts: [{ type: 'army.assignUnit', issuer: 1, payload: { unitId: p.units[0]?.id, armyId } }] });
  h.step(1);
  p = h.latestPanels();
  assert.equal(p.units[0]?.armyId, armyId, 'unit assigned to the army');
  assert.ok((p.armies[0]?.strength ?? 0) > 0, 'army strength counts the assigned unit');

  const startX = p.armies[0]?.x as number;
  h.send({ kind: 'submit', drafts: [{ type: 'army.moveTo', issuer: 1, payload: { armyId, x: startX + 12, y: p.armies[0]?.y } }] });
  h.step(TICKS_PER_DAY * 2);
  p = h.latestPanels();
  assert.notEqual(p.armies[0]?.x, startX, 'the army actually marched (HPA* pathing, M26)');

  // ---- diplomacy: the rival is known (history seeding), so a gift actually LANDS ----
  const opinionBefore = h.latestPanels().kingdoms[0]?.opinion ?? 0;
  h.send({ kind: 'submit', drafts: [{ type: 'kingdom.sendGift', issuer: 1, payload: { targetKingdom: 1, gold: 25 } }] });
  h.step(2);
  assert.ok(h.events('diplomacy.giftSent').length > 0, 'gift executed');
  assert.ok((h.latestPanels().kingdoms[0]?.opinion ?? 0) > opinionBefore, 'opinion moved — the panel reflects it');

  // ---- the end screen's substance: run to the year cap — Chronicle crowns a real winner ----
  h.step(TICKS_PER_YEAR + TICKS_PER_DAY);
  p = h.latestPanels();
  assert.notEqual(p.victory?.winner, null, 'chronicle winner declared at the year cap');
  assert.ok(h.events('victory.achieved').length > 0, 'victory.achieved broadcast for the client end screen');
});
