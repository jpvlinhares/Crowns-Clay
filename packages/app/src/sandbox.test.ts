/**
 * Sandbox mode & editor (roadmap M40; GDD §17) — the T objective is "editor
 * ops replay deterministically": privileged sandbox.* commands are ordinary
 * entries in the SAME command log every other order goes through, so a
 * scripted sequence of them must hash-reproduce exactly like any other
 * gameplay history (harness.ts's own golden-replay guarantee, exercised here
 * at the protocol layer via the same in-process harness debug.test.ts uses).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { FromSimMessage, ToSimMessage, TransportPort } from '@crowns/protocol';
import { connectKernelToPort } from './simPort.js';

const SEED = 0x7e44a; // terra-demo's own seed — a real founded village + terrain by tick 1

/** In-process transport harness: drive the bridge exactly like a worker host. */
function harness(clock?: () => number) {
  const inbox: FromSimMessage[] = [];
  let toSim: ((m: unknown) => void) | null = null;
  const port: TransportPort = {
    postMessage: (m) => inbox.push(m as FromSimMessage),
    onMessage: (h) => {
      toSim = h;
    },
  };
  connectKernelToPort(port, clock);
  return {
    send: (m: ToSimMessage) => toSim?.(m),
    inbox,
    take: <K extends FromSimMessage['kind']>(kind: K) =>
      inbox.filter((m): m is Extract<FromSimMessage, { kind: K }> => m.kind === kind),
  };
}

/** A founded village id from the full snapshot's placed buildings (genesis runs on tick 1). */
function villageIdOf(full: Extract<FromSimMessage, { kind: 'snapshotFull' }>): number {
  const village = full.buildings?.[0]?.village;
  assert.ok(village !== undefined, 'genesis should have placed at least one building by the first snapshot');
  return village;
}

/** A land tile + a different land biome code to repaint it to, read off the real terrain snapshot. */
function pickTerrainEdit(full: Extract<FromSimMessage, { kind: 'snapshotFull' }>): { x: number; y: number; biomeCode: number } {
  const terrain = full.terrain;
  assert.ok(terrain !== undefined);
  const { width, height, biome } = terrain;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const code = biome[y * width + x] as number;
      if (code >= 2) return { x, y, biomeCode: code === 3 ? 2 : 3 }; // land (Ocean=0/Coast=1 excluded)
    }
  }
  throw new Error('fixture world has no land tile — worldgen regression, not a sandbox bug');
}

test('sandbox.* commands are absent from the injector vocabulary and reject when not sandboxed', () => {
  const h = harness();
  h.send({ kind: 'init', seed: SEED });
  assert.equal(h.take('ready')[0]?.sandbox, false);

  h.send({ kind: 'debug', op: 'commands' });
  const types = h.take('debugCommands')[0]?.types ?? [];
  assert.ok(!types.some((t) => t.startsWith('sandbox.')), `sandbox.* leaked into a non-sandboxed vocabulary: ${types.join(',')}`);

  const village = villageIdOf(h.take('snapshotFull')[0] as Extract<FromSimMessage, { kind: 'snapshotFull' }>);
  h.send({ kind: 'submit', drafts: [{ type: 'sandbox.grantResource', issuer: 0, payload: { villageId: village, resource: 'base:resource.wood', amount: 500 } }] });
  h.send({ kind: 'step', ticks: 1 });
  const rejection = h.take('ticked').at(-1)?.events.find((e) => e.type === 'village.rejected');
  assert.match((rejection?.data as { reason: string } | undefined)?.reason ?? '', /sandbox mode is not enabled/);
});

test('sandbox editor: privileged commands are offered and mutate real state when sandboxed', () => {
  const h = harness();
  h.send({ kind: 'init', seed: SEED, sandbox: { ironman: true } });
  assert.equal(h.take('ready')[0]?.sandbox, true);

  h.send({ kind: 'debug', op: 'commands' });
  const types = h.take('debugCommands')[0]?.types ?? [];
  for (const t of ['sandbox.grantResource', 'sandbox.setTreasury', 'sandbox.editTerrain']) {
    assert.ok(types.includes(t), `expected '${t}' in the sandboxed vocabulary: ${types.join(',')}`);
  }

  const full = h.take('snapshotFull')[0] as Extract<FromSimMessage, { kind: 'snapshotFull' }>;
  const village = villageIdOf(full);
  const edit = pickTerrainEdit(full);

  h.send({
    kind: 'submit',
    drafts: [
      { type: 'sandbox.grantResource', issuer: 0, payload: { villageId: village, resource: 'base:resource.wood', amount: 500 } },
      { type: 'sandbox.setTreasury', issuer: 1, payload: { amount: 9999 } },
      { type: 'sandbox.editTerrain', issuer: 0, payload: edit },
    ],
  });
  h.send({ kind: 'step', ticks: 1 });
  const events = h.take('ticked').at(-1)?.events ?? [];
  assert.ok(!events.some((e) => e.type === 'village.rejected'), JSON.stringify(events.filter((e) => e.type === 'village.rejected')));
  assert.ok(events.some((e) => e.type === 'sandbox.resourceGranted'));
  assert.ok(events.some((e) => e.type === 'sandbox.treasurySet'));
  const terrainEdited = events.find((e) => e.type === 'sandbox.terrainEdited');
  assert.deepEqual(terrainEdited?.data, edit);
});

// ---------------- the T objective ----------------

test('sandbox: editor ops replay deterministically', () => {
  const script: ToSimMessage[] = [
    { kind: 'step', ticks: 1 }, // let genesis found the village before targeting it
  ];
  const run = (): number => {
    const h = harness();
    h.send({ kind: 'init', seed: SEED, sandbox: {} });
    for (const m of script) h.send(m);
    const full = h.take('snapshotFull')[0] as Extract<FromSimMessage, { kind: 'snapshotFull' }>;
    const village = villageIdOf(full);
    const edit = pickTerrainEdit(full);
    h.send({
      kind: 'submit',
      drafts: [
        { type: 'sandbox.grantResource', issuer: 0, payload: { villageId: village, resource: 'base:resource.stone', amount: 321 } },
        { type: 'sandbox.setTreasury', issuer: 1, payload: { amount: 4242 } },
        { type: 'sandbox.editTerrain', issuer: 0, payload: edit },
      ],
    });
    h.send({ kind: 'step', ticks: 50 });
    h.send({ kind: 'requestHash' });
    return h.take('hash').at(-1)?.hash ?? Number.NaN;
  };
  const first = run();
  const second = run();
  assert.ok(Number.isFinite(first));
  assert.equal(first, second);
});
