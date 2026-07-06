import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { FromSimMessage, ToSimMessage, TransportPort } from '@crowns/protocol';
import { connectKernelToPort } from './simPort.js';

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

test('debug channel: commands list, live inspection, telemetry stream', () => {
  let t = 0;
  const h = harness(() => ++t);
  h.send({ kind: 'init', seed: 0x7e44a });

  // vocabulary
  h.send({ kind: 'debug', op: 'commands' });
  const types = h.take('debugCommands')[0]?.types ?? [];
  assert.ok(types.includes('debug.spawn') && types.includes('debug.smite'), `got: ${types.join(',')}`);

  // find a live entity from the full snapshot, inspect it
  const full = h.take('snapshotFull')[0];
  assert.ok(full !== undefined && full.entities.length > 0);
  const target = full.entities[0]?.id as number;
  h.send({ kind: 'debug', op: 'inspect', entityId: target });
  const before = h.take('debugEntity')[0]?.inspection;
  assert.equal(before?.alive, true);
  assert.ok(before?.components.some((c) => c.name === 'position'));

  // telemetry samples once per flush whenever the interval elapsed
  h.send({ kind: 'debug', op: 'telemetry', enabled: true, everyTicks: 5 });
  for (let batch = 0; batch < 5; batch++) h.send({ kind: 'step', ticks: 5 });
  const telemetry = h.take('debugTelemetry');
  assert.equal(telemetry.length, 5, `expected 5 reports, got ${telemetry.length}`);
  // a sub-interval batch produces no extra report
  h.send({ kind: 'step', ticks: 2 });
  assert.equal(h.take('debugTelemetry').length, 5);
  const last = telemetry[telemetry.length - 1];
  assert.ok((last?.entityCount ?? 0) > 0);
  assert.ok(last?.systems.some((s) => s.name === 'movement' && s.calls > 0));
  h.send({ kind: 'debug', op: 'telemetry', enabled: false });
  for (let batch = 0; batch < 5; batch++) h.send({ kind: 'step', ticks: 5 });
  assert.equal(h.take('debugTelemetry').length, 5, 'no reports after disable');
});

test('debug channel: injector commands mutate the world through the command log', () => {
  const h = harness();
  h.send({ kind: 'init', seed: 0x7e44a });
  const countBefore = h.take('snapshotFull')[0]?.entities.length ?? 0;

  h.send({ kind: 'submit', drafts: [{ type: 'debug.spawn', issuer: 0, payload: { x: 50, y: 50, count: 7 } }] });
  h.send({ kind: 'step', ticks: 1 });
  const ticked = h.take('ticked').at(-1);
  assert.ok(ticked?.executed.some((c) => c.type === 'debug.spawn'), 'command in the executed echo (and the log)');
  assert.ok(ticked?.events.some((e) => e.type === 'debug.spawned'));
  const spawnedDelta = h.take('snapshotDelta').at(-1);
  assert.ok((spawnedDelta?.spawned.length ?? 0) >= 7, 'snapshot delta carries the new entities');

  // smite one of them; the delta reports the despawn
  const victim = spawnedDelta?.spawned[0]?.id as number;
  h.send({ kind: 'submit', drafts: [{ type: 'debug.smite', issuer: 0, payload: { entityId: victim } }] });
  h.send({ kind: 'step', ticks: 1 });
  assert.ok(h.take('snapshotDelta').at(-1)?.despawned.includes(victim));
  h.send({ kind: 'debug', op: 'inspect', entityId: victim });
  assert.equal(h.take('debugEntity').at(-1)?.inspection.alive, false);
  void countBefore;
});
