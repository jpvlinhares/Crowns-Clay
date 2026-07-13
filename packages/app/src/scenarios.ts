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

export const scenarios: readonly ReplayScenario[] = [calendarBaseline, wanderers, terraDemo, campaignDemo];

export function scenarioByName(name: string): ReplayScenario | undefined {
  return scenarios.find((s) => s.name === name);
}
