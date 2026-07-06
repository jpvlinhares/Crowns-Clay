import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { Command } from '@crowns/protocol';
import { Kernel, type SimSystem, type TickContext } from './kernel.js';
import { TickDriver } from './driver.js';
import {
  CalendarSystem,
  calendarFromTick,
  TICKS_PER_DAY,
  TICKS_PER_SEASON,
  TICKS_PER_YEAR,
  type SeasonStartedData,
} from './time.js';

/** Test system: counts its own runs, applies 'counter.add' commands, uses its rng. */
class CounterSystem implements SimSystem {
  readonly name = 'counter';
  value = 0;
  runs: number[] = [];
  constructor(
    readonly period: number = 1,
    readonly phase: number = 0,
  ) {}
  update(ctx: TickContext): void {
    this.runs.push(ctx.tick);
    this.value += ctx.rng.int(0, 3); // exercises deterministic per-system rng
  }
  hash(fold: (v: number) => void): void {
    fold(this.value);
    fold(this.runs.length);
  }
}

function makeKernel(seed = 42): { kernel: Kernel; counter: CounterSystem } {
  const kernel = new Kernel(seed);
  const counter = new CounterSystem();
  kernel.registerSystem(counter);
  kernel.registerCommand<{ amount: number }>('counter.add', (_ctx, payload) => {
    counter.value += payload.amount;
  });
  return { kernel, counter };
}

// ---------------- cadence ----------------

test('kernel: cadence gating runs systems at period/phase (doc 08 §2)', () => {
  const kernel = new Kernel(1);
  const daily = new CounterSystem(24, 3);
  kernel.registerSystem(daily);
  for (let i = 0; i < 60; i++) kernel.step();
  assert.deepEqual(daily.runs, [3, 27, 51]);
});

test('kernel: setup after first tick is rejected', () => {
  const { kernel } = makeKernel();
  kernel.step();
  assert.throws(() => kernel.registerSystem(new CounterSystem()));
  assert.throws(() => kernel.registerCommand('late.command', () => undefined));
});

// ---------------- command round-trip ----------------

test('kernel: command round-trip — submit → execute next tick → event → log', () => {
  const { kernel, counter } = makeKernel();
  const seen: number[] = [];
  kernel.subscribe<{ value: number }>('counter.changed', (e) => seen.push(e.data.value));
  kernel.registerCommand<{ to: number }>('counter.set', (ctx, payload) => {
    counter.value = payload.to;
    ctx.events.publish({ type: 'counter.changed', tick: ctx.tick, data: { value: payload.to } });
  });

  const stamped = kernel.submit({ type: 'counter.set', issuer: 1, payload: { to: 99 } });
  assert.equal(stamped.tick, 1);
  assert.equal(stamped.seq, 0);

  const result = kernel.step();
  assert.equal(counter.value >= 99, true, 'handler ran before system update');
  assert.deepEqual(seen, [99], 'event delivered to subscriber');
  assert.equal(result.executed.length, 1);
  assert.ok(result.events.some((e) => e.type === 'counter.changed'), 'event in tick result');
  assert.equal(kernel.commandLog().length, 1);
});

test('kernel: unknown command type is rejected via event, not executed', () => {
  const { kernel } = makeKernel();
  let rejected = 0;
  kernel.subscribe('command.rejected', () => rejected++);
  kernel.submit({ type: 'no.such.command', issuer: 1, payload: {} });
  const result = kernel.step();
  assert.equal(rejected, 1);
  assert.equal(result.executed.length, 0);
  assert.equal(kernel.commandLog().length, 0);
});

// ---------------- deterministic ordering ----------------

test('kernel: same-tick commands execute in (issuer, seq) order regardless of enqueue order', () => {
  const kernel = new Kernel(7);
  const order: string[] = [];
  kernel.registerCommand<{ label: string }>('trace', (_ctx, payload) => order.push(payload.label));
  // enqueueExact lets us scramble arrival order for the same tick
  const cmd = (issuer: number, seq: number, label: string): Command => ({
    type: 'trace',
    tick: 1,
    issuer,
    seq,
    payload: { label },
  });
  kernel.enqueueExact(cmd(2, 0, 'i2s0'));
  kernel.enqueueExact(cmd(1, 1, 'i1s1'));
  kernel.enqueueExact(cmd(1, 0, 'i1s0'));
  kernel.step();
  assert.deepEqual(order, ['i1s0', 'i1s1', 'i2s0']);
});

test('kernel: enqueueExact refuses commands at or before the current tick', () => {
  const { kernel } = makeKernel();
  kernel.step(); // now at tick 1
  assert.throws(() =>
    kernel.enqueueExact({ type: 'counter.add', tick: 1, issuer: 1, seq: 0, payload: { amount: 1 } }),
  );
});

test('kernel: future-dated commands wait for their tick', () => {
  const { kernel, counter } = makeKernel();
  kernel.enqueueExact({ type: 'counter.add', tick: 3, issuer: 1, seq: 0, payload: { amount: 1000 } });
  kernel.step();
  kernel.step();
  assert.ok(counter.value < 1000, 'must not execute early');
  kernel.step();
  assert.ok(counter.value >= 1000, 'must execute at its tick');
});

// ---------------- replay determinism (TDD §5) ----------------

test('kernel: replaying the command log reproduces identical state hashes', () => {
  const a = makeKernel(2024);
  const hashesA: number[] = [];
  a.kernel.submit({ type: 'counter.add', issuer: 1, payload: { amount: 5 } });
  for (let t = 0; t < 50; t++) {
    if (t === 10) a.kernel.submit({ type: 'counter.add', issuer: 2, payload: { amount: 7 } });
    if (t === 10) a.kernel.submit({ type: 'counter.add', issuer: 1, payload: { amount: -2 } });
    a.kernel.step();
    hashesA.push(a.kernel.stateHash());
  }

  // Replay: same seed, same registrations, exact command log.
  const b = makeKernel(2024);
  for (const command of a.kernel.commandLog()) b.kernel.enqueueExact(command);
  const hashesB: number[] = [];
  for (let t = 0; t < 50; t++) {
    b.kernel.step();
    hashesB.push(b.kernel.stateHash());
  }
  assert.deepEqual(hashesB, hashesA);
});

test('kernel: different seeds produce different state trajectories', () => {
  const a = makeKernel(1);
  const b = makeKernel(2);
  for (let t = 0; t < 20; t++) {
    a.kernel.step();
    b.kernel.step();
  }
  assert.notEqual(a.kernel.stateHash(), b.kernel.stateHash());
});

// ---------------- calendar ----------------

test('calendar: date math and boundary events', () => {
  assert.deepEqual(calendarFromTick(1), {
    year: 0, season: 0, seasonName: 'spring', day: 0, hour: 0,
  });
  assert.equal(calendarFromTick(TICKS_PER_DAY).hour, 23);
  assert.equal(calendarFromTick(TICKS_PER_DAY + 1).day, 1);
  assert.equal(calendarFromTick(TICKS_PER_SEASON + 1).seasonName, 'summer');
  assert.equal(calendarFromTick(TICKS_PER_YEAR + 1).year, 1);

  const kernel = new Kernel(3);
  kernel.registerSystem(new CalendarSystem());
  let days = 0;
  const seasons: string[] = [];
  let years = 0;
  kernel.subscribe('time.dayStarted', () => days++);
  kernel.subscribe<SeasonStartedData>('time.seasonStarted', (e) =>
    seasons.push(e.data.date.seasonName),
  );
  kernel.subscribe('time.yearStarted', () => years++);
  for (let t = 0; t < TICKS_PER_SEASON * 2; t++) kernel.step(); // two seasons
  assert.equal(days, 180);
  assert.deepEqual(seasons, ['spring', 'summer']);
  assert.equal(years, 1);
});

// ---------------- driver ----------------

test('driver: speed multiplies tick throughput', () => {
  const { kernel } = makeKernel();
  const driver = new TickDriver(kernel, { maxTicksPerAdvance: 1000 });
  driver.setSpeed(1);
  assert.equal(driver.advance(1000).length, 10); // 10 tps
  driver.setSpeed(8);
  assert.equal(driver.advance(1000).length, 80); // 80 tps
});

test('driver: pause executes nothing and clears owed time', () => {
  const { kernel } = makeKernel();
  const driver = new TickDriver(kernel);
  driver.setSpeed(0);
  assert.equal(driver.advance(5000).length, 0);
  driver.setSpeed(1);
  assert.equal(driver.advance(0).length, 0, 'no backlog after unpausing');
});

test('driver: budget exhaustion dilates time instead of spiraling (TDD §6)', () => {
  const { kernel } = makeKernel();
  const driver = new TickDriver(kernel, { maxTicksPerAdvance: 4 });
  driver.setSpeed(8); // owes 80 ticks for 1s, budget allows 4
  assert.equal(driver.advance(1000).length, 4);
  // owed time was dropped: a tiny next frame owes at most one new tick's worth
  assert.equal(driver.advance(12.5).length, 1);
  assert.equal(driver.advance(0).length, 0);
});
