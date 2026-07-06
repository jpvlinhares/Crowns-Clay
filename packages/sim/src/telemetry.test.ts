import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Kernel, type SimSystem, type TickContext } from './kernel.js';
import { World } from './ecs.js';

/** Fake clock: each read advances by a scripted step — fully deterministic. */
function fakeClock(stepMs = 1): { clock: () => number; reads: () => number } {
  let t = 0;
  let reads = 0;
  return {
    clock: () => {
      reads++;
      t += stepMs;
      return t;
    },
    reads: () => reads,
  };
}

function busySystem(name: string, period = 1): SimSystem {
  return {
    name,
    period,
    update(ctx: TickContext): void {
      ctx.rng.int(0, 9);
    },
  };
}

test('telemetry: per-system costs recorded on the system cadence', () => {
  const { clock } = fakeClock(2);
  const kernel = new Kernel(1, { clock });
  kernel.registerSystem(busySystem('everyTick', 1));
  kernel.registerSystem(busySystem('daily', 24));
  kernel.registerCommand('noop', () => undefined);
  kernel.submit({ type: 'noop', issuer: 1, payload: {} });
  for (let t = 0; t < 48; t++) kernel.step();

  const telemetry = kernel.getTelemetry();
  const byName = new Map(telemetry.systems.map((s) => [s.name, s]));
  assert.equal(byName.get('everyTick')?.calls, 48);
  assert.equal(byName.get('daily')?.calls, 2, 'cadence-gated system measured only when it runs');
  assert.equal(byName.get('commands')?.calls, 1, 'command dispatch measured only on ticks with commands');
  assert.ok((byName.get('everyTick')?.lastMs ?? 0) > 0);
  assert.ok(telemetry.tickMsLast > 0 && telemetry.tickMsAvg > 0);
  assert.equal(telemetry.systems[0]?.name, 'commands', 'stable row order: commands first, then registration order');
  assert.equal(telemetry.systems[1]?.name, 'everyTick');
});

test('telemetry: state hash is clock-blind (observability never feeds the sim)', () => {
  const run = (withClock: boolean): number => {
    const kernel = new Kernel(77, withClock ? { clock: fakeClock(3).clock } : {});
    kernel.registerSystem(busySystem('a'));
    kernel.registerSystem(busySystem('b', 5));
    for (let t = 0; t < 200; t++) kernel.step();
    return kernel.stateHash();
  };
  assert.equal(run(true), run(false), 'identical hashes with and without telemetry');
});

test('telemetry: without a clock, nothing is measured (zero-overhead default)', () => {
  const kernel = new Kernel(2);
  kernel.registerSystem(busySystem('a'));
  for (let t = 0; t < 10; t++) kernel.step();
  const t = kernel.getTelemetry();
  assert.equal(t.systems.find((s) => s.name === 'a')?.calls, 0);
  assert.equal(t.tickMsLast, 0);
});

test('inspector: reflects LIVE state across mutations, both component kinds', () => {
  const world = new World(64);
  const Position = world.defineSoA('position', { x: 'f64', y: 'f64' });
  const Name = world.defineObject<string>('name');
  const e = world.spawn();
  world.attach(e, Position, { x: 3, y: 4 });
  world.attach(e, Name, 'Aldric');

  const first = world.inspect(e);
  assert.equal(first.alive, true);
  assert.deepEqual(
    first.components.map((c) => c.name),
    ['position', 'name'],
  );
  assert.deepEqual(first.components[0]?.data, { x: 3, y: 4 });
  assert.deepEqual(first.components[1]?.data, { value: 'Aldric' });

  // mutate → re-inspect shows current values (the M9 test objective)
  world.write(Position).x[first.index] = 99;
  world.writeObj(Name).set(first.index, 'Aldric the Bold');
  const second = world.inspect(e);
  assert.equal(second.components[0]?.data['x'], 99);
  assert.equal(second.components[1]?.data['value'], 'Aldric the Bold');

  world.detach(e, Name);
  assert.deepEqual(world.inspect(e).components.map((c) => c.name), ['position']);
  world.despawn(e);
  const gone = world.inspect(e);
  assert.equal(gone.alive, false);
  assert.deepEqual(gone.components, []);
});

test('kernel: commandTypes lists the injector vocabulary sorted', () => {
  const kernel = new Kernel(3);
  kernel.registerCommand('z.last', () => undefined);
  kernel.registerCommand('a.first', () => undefined);
  assert.deepEqual(kernel.commandTypes(), ['a.first', 'z.last']);
});
