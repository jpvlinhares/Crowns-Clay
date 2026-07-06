import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Kernel, type SimSystem, type TickContext } from './kernel.js';
import { recordReplay, verifyReplay, type ReplayScenario } from './harness.js';

function tinyScenario(overrides: Partial<ReplayScenario> = {}): ReplayScenario {
  return {
    name: 'tiny',
    seed: 11,
    ticks: 50,
    hashEvery: 10,
    build(): Kernel {
      const kernel = new Kernel(this.seed);
      let acc = 0;
      const drifter: SimSystem = {
        name: 'drifter',
        period: 1,
        update(ctx: TickContext): void {
          acc = (acc + ctx.rng.int(0, 9)) >>> 0;
        },
        hash(fold): void {
          fold(acc);
        },
      };
      kernel.registerSystem(drifter);
      kernel.registerCommand<{ add: number }>('drift.add', (_c, p) => {
        acc = (acc + p.add) >>> 0;
      });
      return kernel;
    },
    script: [{ atTick: 25, draft: { type: 'drift.add', issuer: 1, payload: { add: 1000 } } }],
    ...overrides,
  };
}

test('harness: record → verify round-trips green', () => {
  const scenario = tinyScenario();
  const record = recordReplay(scenario);
  assert.equal(record.samples.length, 5);
  assert.equal(record.commandCount, 1);
  const result = verifyReplay(scenario, record);
  assert.ok(result.ok, 'verification must pass against its own recording');
});

test('harness: recording is process-stable (two records identical)', () => {
  const a = recordReplay(tinyScenario());
  const b = recordReplay(tinyScenario());
  assert.deepEqual(a, b);
});

test('harness: verify reports the FIRST divergent sample on engine change', () => {
  const record = recordReplay(tinyScenario());
  // "engine change": same shape, different seed → hashes diverge from the start
  const changed = tinyScenario({ seed: 12 });
  const shapeSafe = { ...changed, seed: 11, build: changed.build } as ReplayScenario;
  // keep declared seed matching the record but build with a drifted recipe:
  const divergent: ReplayScenario = {
    ...tinyScenario(),
    script: [{ atTick: 25, draft: { type: 'drift.add', issuer: 1, payload: { add: 1001 } } }],
  };
  void shapeSafe;
  const result = verifyReplay(divergent, record);
  assert.ok(!result.ok);
  if (!result.ok) {
    assert.equal(result.reason, 'hash-divergence');
    assert.equal(result.tick, 30, 'first sample at/after the tampered tick 25');
    assert.notEqual(result.expected, result.actual);
  }
});

test('harness: shape mismatches are rejected before running', () => {
  const record = recordReplay(tinyScenario());
  const different = tinyScenario({ ticks: 60 });
  const result = verifyReplay(different, record);
  assert.ok(!result.ok && result.reason === 'shape-mismatch');
});

test('harness: scripted commands change the trajectory (script is load-bearing)', () => {
  const withScript = recordReplay(tinyScenario());
  const withoutScript = recordReplay(tinyScenario({ script: [] }));
  assert.notEqual(withScript.finalHash, withoutScript.finalHash);
});
