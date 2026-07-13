/**
 * Named benchmark scenes (M47.9; doc 11 §6 — the tools that section has CLAIMED
 * as "nightly CI" enforcement since design freeze, built for real at last).
 *
 *   node packages/tools/dist/bench-scenes.js war-max | ai-8k | late-campaign | all
 *
 * Every scene runs the UNIFIED campaign composition (the shipping game — real
 * worldgen, content personalities, occupation/beliefs/grudges) with an injected
 * observational clock, and asserts doc 11 §2's sim budgets:
 *   - mean tick cost ≤ SIM_TICK_BUDGET_MS (10 ms @8× ceilings), and
 *   - the AI systems' share of that mean ≤ AI_SHARE_BUDGET (30%),
 * exiting non-zero on a breach — the CI gate consumes the exit code.
 *
 * HONEST SCOPE (doc 11 §1's M47 note still applies): these are absolute-budget
 * gates on deterministic scenes, not regression-vs-rolling-baseline (no baseline
 * store exists); and "war-max" fields the armies the real AI actually raises
 * under its own recruit gates, not doc 11 §1's 2,000-unit stress ceiling — a
 * purpose-built ceiling scenario remains future work, flagged where doc 11
 * already flags it.
 */
import { performance } from 'node:perf_hooks';
import {
  composeCampaign,
  DIFFICULTY_PRESETS,
  TICKS_PER_YEAR,
  type CampaignComposition,
  type PersonalityWeights,
} from '@crowns/sim';

export const SIM_TICK_BUDGET_MS = 10; // doc 11 §2: ≤10 ms mean @8× ceilings
export const AI_SHARE_BUDGET = 0.3; // doc 11 §2: AI ≤ 30% of the tick budget

const WARLIKE: PersonalityWeights = { expansion: 0.5, economy: 0.4, riskTolerance: 0.8, diplomacyTrust: 0.15, aggression: 0.95 };
const clock = (): number => performance.now(); // kernel telemetry is opt-in: no clock, no measurement

interface SceneResult {
  readonly name: string;
  readonly ticks: number;
  readonly meanTickMs: number;
  readonly aiShare: number;
  readonly ok: boolean;
  readonly detail: string;
}

/** Mean tick cost + AI-system share over `ticks`, measured via kernel telemetry. */
function measure(name: string, c: CampaignComposition, warmupTicks: number, ticks: number): SceneResult {
  for (let t = 0; t < warmupTicks; t++) c.kernel.step();
  const t0 = performance.now();
  for (let t = 0; t < ticks; t++) c.kernel.step();
  const wallMs = performance.now() - t0;
  const meanTickMs = wallMs / ticks;
  // AI share: amortize each ai-* system's avg per-call cost by call frequency (the M24
  // harness's own convention — per-call cost isn't comparable to a per-tick mean directly).
  const telemetry = c.kernel.getTelemetry();
  let aiMsPerTick = 0;
  for (const s of telemetry.systems) {
    if (!/^ai-|^belief-|^multi-kingdom-genesis/.test(s.name)) continue;
    aiMsPerTick += s.avgMs * (s.calls / Math.max(1, warmupTicks + ticks));
  }
  const aiShare = meanTickMs > 0 ? aiMsPerTick / meanTickMs : 0;
  const ok = meanTickMs <= SIM_TICK_BUDGET_MS && aiShare <= AI_SHARE_BUDGET;
  return {
    name, ticks, meanTickMs, aiShare, ok,
    detail: `mean ${meanTickMs.toFixed(3)} ms/tick (budget ${SIM_TICK_BUDGET_MS}) · AI share ${(aiShare * 100).toFixed(1)}% (budget ${AI_SHARE_BUDGET * 100}%)`,
  };
}

/** Two committed warmongers on a small map: recruitment, marching, battles, sieges, occupation. */
function warMax(): SceneResult {
  const c = composeCampaign({
    seed: 0xbe11a, clock, kingdomCount: 2, mapSize: 'small', aiFromIndex: 0,
    weightsOf: () => WARLIKE,
    difficulty: DIFFICULTY_PRESETS.fair,
    startingPopulation: { children: 12, adults: 40, elders: 5 },
    victory: { enabled: ['conquest'], yearLimit: 40 },
  });
  // warm up 3 years (economies build, armies raise, wars ignite), measure year 4
  return measure('bench-war-max', c, TICKS_PER_YEAR * 3, TICKS_PER_YEAR);
}

/** Doc 11 §1's kingdom ceiling: 8 fully-AI kingdoms on a medium map. */
function ai8k(): SceneResult {
  const c = composeCampaign({
    seed: 0xa18c, clock, kingdomCount: 8, mapSize: 'medium', aiFromIndex: 0,
    personalities: 'content',
    difficulty: DIFFICULTY_PRESETS.fair,
    startingPopulation: { children: 10, adults: 30, elders: 5 },
    victory: { enabled: ['conquest', 'hegemony', 'legacy', 'prosperity', 'chronicle'], yearLimit: 100 },
  });
  return measure('bench-ai-8k', c, TICKS_PER_YEAR * 2, TICKS_PER_YEAR);
}

/** Late-campaign state: 20 years of organic 4-kingdom play, then measure a full year. */
function lateCampaign(): SceneResult {
  const c = composeCampaign({
    seed: 0x1a7e, clock, kingdomCount: 4, mapSize: 'small', aiFromIndex: 0,
    personalities: 'content',
    difficulty: DIFFICULTY_PRESETS.fair,
    startingPopulation: { children: 10, adults: 30, elders: 5 },
    victory: { enabled: [], defeatEnabled: false }, // sandbox rules: nothing may end the run early
  });
  return measure('bench-late-campaign', c, TICKS_PER_YEAR * 20, TICKS_PER_YEAR);
}

const SCENES: Record<string, () => SceneResult> = {
  'war-max': warMax,
  'ai-8k': ai8k,
  'late-campaign': lateCampaign,
};

const which = process.argv[2] ?? 'all';
const names = which === 'all' ? Object.keys(SCENES) : [which];
let failures = 0;
for (const name of names) {
  const scene = SCENES[name];
  if (scene === undefined) {
    console.error(`unknown scene '${name}' — known: ${Object.keys(SCENES).join(', ')}, all`);
    process.exit(2);
  }
  const t0 = performance.now();
  const result = scene();
  console.log(`${result.ok ? 'OK  ' : 'FAIL'} ${result.name} · ${result.detail} (${((performance.now() - t0) / 1000).toFixed(1)}s total)`);
  if (!result.ok) failures++;
}
if (failures > 0) {
  console.error(`${failures} scene(s) over budget (doc 11 §2)`);
  process.exitCode = 1;
} else {
  console.log('all benchmark scenes inside doc 11 §2 sim budgets');
}
