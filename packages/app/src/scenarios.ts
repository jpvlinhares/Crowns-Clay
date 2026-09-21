/**
 * Golden replay scenarios (roadmap M5). These are the repository's canonical
 * determinism probes: together they exercise every deterministic surface built
 * so far — kernel tick loop, command stamping/ordering, per-system PRNG forks,
 * cadence gating, ECS structure/values, access-guarded execution, and hash
 * sources. Real gameplay scenes join this list as systems land (economy at
 * M13, war at M27, ... — doc 11 §6).
 *
 * RULES: a scenario recipe may never change silently. Changing one (or the
 * engine in a hash-affecting way) requires re-recording fixtures via
 * `node packages/tools/dist/replay.js record all` and calling the change out
 * in the PR (repo conventions, doc 12).
 */
import {
  CalendarSystem,
  Kernel,
  TICKS_PER_DAY,
  type ReplayScenario,
  type ScheduledCommand,
} from '@crowns/sim';
import type { CampaignSettings } from '@crowns/protocol';
import { composeWanderers } from './wanderers.js';
import { composeTerra } from './terra.js';
import { composeCampaignForApp } from './simPort.js';

// ---------------------------------------------------------------- scenario 1

/** Kernel + calendar only: the minimal tick/rng/log surface. Two in-game years. */
export const calendarBaseline: ReplayScenario = {
  name: 'calendar-baseline',
  seed: 0xc0ffee,
  ticks: TICKS_PER_DAY * 360 * 2,
  hashEvery: 720,
  build(): Kernel {
    const kernel = new Kernel(this.seed);
    kernel.registerSystem(new CalendarSystem());
    return kernel;
  },
};

// ---------------------------------------------------------------- scenario 2

/**
 * "Wanderers": a genesis system seeds 200 creatures on tick 1 (everything stays
 * inside the deterministic pipeline — no setup back doors); they roam a torus
 * every tick, burn energy daily (staggered phase), die and are replaced; and
 * scripted multi-issuer commands nudge and cull mid-run. One deterministic knot
 * of ECS + access guard + multi-system rng + command ordering.
 */
const wanderersScript: readonly ScheduledCommand[] = [
  { atTick: 100, draft: { type: 'wanderers.nudgeAll', issuer: 1, payload: { dx: 10, dy: -7 } } },
  { atTick: 500, draft: { type: 'wanderers.cullWeak', issuer: 1, payload: { below: 80 } } },
  { atTick: 500, draft: { type: 'wanderers.nudgeAll', issuer: 2, payload: { dx: -3, dy: 3 } } },
  { atTick: 2500, draft: { type: 'wanderers.cullWeak', issuer: 2, payload: { below: 60 } } },
];

export const wanderers: ReplayScenario = {
  name: 'wanderers',
  seed: 0x5eed1,
  ticks: 5000,
  hashEvery: 100,
  build(): Kernel {
    return composeWanderers(this.seed).kernel;
  },
  script: wanderersScript,
};

/** Worldgen + content pipeline + kernel + ECS in one pinned knot (M8). */
export const terraDemo: ReplayScenario = {
  name: 'terra-demo',
  seed: 0x7e44a,
  ticks: 3000,
  hashEvery: 100,
  build(): Kernel {
    return composeTerra(this.seed).kernel;
  },
};

// ---------------------------------------------------------------- scenario 4

/** The new-game screen's default settings — pinned here so the golden scenario
 * and the app's "Begin campaign" button compose the identical session (M47.6). */
export const DEFAULT_CAMPAIGN_SETTINGS: CampaignSettings = {
  mapSize: 'medium',
  kingdomCount: 4,
  difficulty: 'fair',
};

/**
 * The UNIFIED campaign (M47.6; doc 12 revision R1): real worldgen, 4 kingdoms
 * (player + 3 content-personality AI), the full economy/war/diplomacy/research/
 * events/victory stack, composed through the exact same code path the browser
 * worker uses (`composeCampaignForApp`). This golden pins the game the player
 * actually plays — the M47.5 audit's central demand.
 */
export const campaignDemo: ReplayScenario = {
  name: 'campaign-demo',
  seed: 0xca47a1,
  ticks: 3000,
  hashEvery: 100,
  build(): Kernel {
    return composeCampaignForApp(this.seed, DEFAULT_CAMPAIGN_SETTINGS).kernel;
  },
};

// ---------------------------------------------------------------- scenario 5

/**
 * "campaign-long" (M69): the SAME world as `campaign-demo` — same seed, same settings, same
 * compose path — run for TEN IN-GAME YEARS instead of 125 days. It exists for one reason:
 * `campaign-demo` is too SHORT to see the victory tracker.
 *
 * The tracker has folded into `stateHash()` since M37, but victory state needs YEARS to diverge
 * (90 realm population, a 15-year prosperity streak, a 10-year hegemony), so at 3000 ticks it is
 * always empty and always identical. Gate P9 read that as "victory is not a hash source"; M69
 * measured it instead. Dropping `DEFAULT_PROSPERITY_HAPPINESS` 75 → 5 moves NOTHING at 3000 ticks
 * and moves every horizon from 5 years on:
 *
 *   ticks    horizon   baseline     happiness 75→5
 *    3,000      0.3y   0x77b06795   0x77b06795   ← blind
 *   43,200      5.0y   0x590bbee8   0x37e25415
 *   86,400     10.0y   0x006583c7   0x7867c656
 *
 * TEN years rather than five, deliberately: 10 is `DEFAULT_HEGEMONY_YEARS`, so this is the
 * shortest horizon at which the hegemony path CAN declare at all. It currently never does —
 * perturbing `DEFAULT_HEGEMONY_YEARS` 10 → 3 changes nothing here, because no kingdom in this
 * seed ever holds the required share — and that is precisely the point: Phase 10 exists to make
 * kingdoms conquer each other, so a fixture that stopped short of 10 years would go blind exactly
 * when M71 started working. Sized so it stops being blind rather than sized to today's behaviour.
 *
 * Cost: ~14 s to record and ~14 s to verify, measured at 0.165 ms/tick. That is the price of the
 * only fixture in the repo that can see a victory-logic regression at all.
 */
export const campaignLong: ReplayScenario = {
  name: 'campaign-long',
  seed: 0xca47a1, // deliberately campaign-demo's seed: the first 3000 ticks must agree with it
  ticks: TICKS_PER_DAY * 360 * 10,
  hashEvery: 1440, // one sample per two in-game months — 60 samples bracket a regression tightly
  build(): Kernel {
    return composeCampaignForApp(this.seed, DEFAULT_CAMPAIGN_SETTINGS).kernel;
  },
};

export const scenarios: readonly ReplayScenario[] = [
  calendarBaseline,
  wanderers,
  terraDemo,
  campaignDemo,
  campaignLong,
];

export function scenarioByName(name: string): ReplayScenario | undefined {
  return scenarios.find((s) => s.name === name);
}
