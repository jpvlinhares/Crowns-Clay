/**
 * Determinism harness (roadmap M5; TDD §5 rule 5, §13 "golden replay").
 *
 * A ReplayScenario is a pure recipe: seed + kernel composition + scripted
 * commands. Recording runs it and samples the state hash every `hashEvery`
 * ticks (plus the final tick) into a ReplayRecord — the "golden" fixture.
 * Verification re-runs the recipe from scratch and compares at every sample,
 * reporting the FIRST divergent tick, which brackets a regression to a window
 * of at most `hashEvery` ticks.
 *
 * The same functions run under Node (CI + local) and in browsers (unbundled
 * via import map — tools/browser-harness), which is the OQ-10 sentinel: any
 * engine producing a different hash trips the fixed-point migration decision.
 */
import { invariant } from '@crowns/core';
import type { CommandDraft } from '@crowns/protocol';
import type { Kernel } from './kernel.js';

export interface ScheduledCommand {
  /** The command is submitted so that it EXECUTES on this tick. */
  readonly atTick: number;
  readonly draft: CommandDraft;
}

export interface ReplayScenario {
  readonly name: string;
  readonly seed: number;
  readonly ticks: number;
  /** Hash sampling period; divergence localization granularity. */
  readonly hashEvery: number;
  /** Fully composed, un-stepped kernel (systems registered, guard attached). */
  build(): Kernel;
  readonly script?: readonly ScheduledCommand[];
}

export interface HashSample {
  readonly tick: number;
  readonly hash: number;
}

export interface ReplayRecord {
  readonly scenario: string;
  readonly seed: number;
  readonly ticks: number;
  readonly hashEvery: number;
  readonly commandCount: number;
  readonly samples: readonly HashSample[];
  readonly finalHash: number;
}

export type VerifyResult =
  | { readonly ok: true; readonly finalHash: number }
  | {
      readonly ok: false;
      readonly tick: number;
      readonly expected: number;
      readonly actual: number;
      readonly reason: 'hash-divergence' | 'shape-mismatch';
    };

function runScenario(
  scenario: ReplayScenario,
  onSample: (sample: HashSample) => void,
): { finalHash: number; commandCount: number } {
  invariant(scenario.ticks >= 1, `scenario '${scenario.name}': ticks must be >= 1`);
  invariant(scenario.hashEvery >= 1, `scenario '${scenario.name}': hashEvery must be >= 1`);
  const kernel = scenario.build();
  invariant(kernel.currentTick === 0, `scenario '${scenario.name}': build() returned a stepped kernel`);
  invariant(kernel.seed === scenario.seed, `scenario '${scenario.name}': kernel seed mismatch`);

  // Deterministic script indexing: group by execution tick, preserve array order.
  const byTick = new Map<number, CommandDraft[]>();
  for (const s of scenario.script ?? []) {
    invariant(s.atTick >= 1 && s.atTick <= scenario.ticks, `script tick ${s.atTick} out of range`);
    const list = byTick.get(s.atTick);
    if (list === undefined) byTick.set(s.atTick, [s.draft]);
    else list.push(s.draft);
  }

  let commandCount = 0;
  for (let t = 1; t <= scenario.ticks; t++) {
    const drafts = byTick.get(t);
    if (drafts !== undefined) {
      for (const draft of drafts) {
        kernel.submit(draft); // current tick is t-1 → stamps execution tick t
        commandCount++;
      }
    }
    kernel.step();
    if (t % scenario.hashEvery === 0 || t === scenario.ticks) {
      onSample({ tick: t, hash: kernel.stateHash() });
    }
  }
  return { finalHash: kernel.stateHash(), commandCount };
}

export function recordReplay(scenario: ReplayScenario): ReplayRecord {
  const samples: HashSample[] = [];
  const { finalHash, commandCount } = runScenario(scenario, (s) => samples.push(s));
  return {
    scenario: scenario.name,
    seed: scenario.seed,
    ticks: scenario.ticks,
    hashEvery: scenario.hashEvery,
    commandCount,
    samples,
    finalHash,
  };
}

export function verifyReplay(scenario: ReplayScenario, record: ReplayRecord): VerifyResult {
  if (
    record.scenario !== scenario.name ||
    record.seed !== scenario.seed ||
    record.ticks !== scenario.ticks ||
    record.hashEvery !== scenario.hashEvery
  ) {
    return { ok: false, tick: 0, expected: 0, actual: 0, reason: 'shape-mismatch' };
  }
  const expected = new Map<number, number>(record.samples.map((s) => [s.tick, s.hash]));
  let failure: VerifyResult | null = null;
  runScenario(scenario, ({ tick, hash }) => {
    if (failure !== null) return;
    const want = expected.get(tick);
    if (want === undefined) {
      failure = { ok: false, tick, expected: -1, actual: hash, reason: 'shape-mismatch' };
    } else if (want !== hash) {
      failure = { ok: false, tick, expected: want, actual: hash, reason: 'hash-divergence' };
    }
  });
  return failure ?? { ok: true, finalHash: record.finalHash };
}
