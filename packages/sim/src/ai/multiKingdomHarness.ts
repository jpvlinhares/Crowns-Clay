/**
 * Multi-kingdom AI harness (roadmap M22-M46) — since M47.6 a THIN WRAPPER over
 * the unified campaign composition (`campaign.ts`, doc 12 revision R1).
 *
 * Everything this file used to wire by hand (villages→siege stack, fog,
 * scouting, diplomacy, research, events, per-kingdom AI, difficulty levers)
 * now lives in `composeCampaign`; this wrapper pins exactly the HARNESS
 * conditions the M22-M46 tests were recorded against:
 *   - flat synthetic terrain (every tile farmable/mineable — no worldgen),
 *   - the harness's historical starting stock & population,
 *   - an INERT victory tracker (`enabled: [], defeatEnabled: false`) unless a
 *     caller (bench-balance, crash-triage) opts real tracks in via `victory`,
 *   - no calendar system (the harness never registered one).
 *
 * Behaviour parity holds because campaign.ts preserves the harness's original
 * registration order and the kernel forks each system's PRNG by name — the
 * appended systems (victory-tracker) and passive additions (SaveManager
 * sections, fog hash source) never perturb pre-existing streams. Emergent-
 * outcome tests (50-year survival, fingerprints, war/peace cycles) are the
 * proof in CI.
 *
 * M46's FAIR_PRESET note still applies verbatim: `difficulty` stays OPTIONAL
 * and un-defaulted — FAIR_PRESET's documented "neutral" values do not match
 * the code defaults (appraisalNoise 0.12 vs 0, jointWarCoordination 'limited'
 * vs 'on'), so defaulting it would silently change pre-M46 outcomes.
 */
import { composeCampaign, type CampaignComposition } from '../campaign.js';
import type { TerrainAccessor } from '../game/villages.js';
import type { VictoryOptions } from '../game/victory.js';
import type { PersonalityWeights } from './planner.js';
import type { DifficultyPreset } from './difficulty.js';

export const flatTerrain = (width: number, height: number): TerrainAccessor => ({
  width,
  height,
  tagsAt: () => ['open', 'farmable', 'mineable', 'woodland'],
  riverAt: () => false,
  movementCostAt: () => 1,
});

// The harness's historical per-kingdom genesis stock (see campaign.ts's
// DEFAULT_CAMPAIGN_STOCK doc for why tools are included).
const KINGDOM_STARTING_STOCK = {
  'base:resource.wood': 2000, 'base:resource.stone': 500, 'base:resource.food': 300, 'base:resource.tools': 300,
};

/** The harness's public shape, unchanged for its M22-M46 consumers (note `eventGame`,
 * campaign.ts's `eventsGame` under the harness's historical name). */
export interface MultiKingdomComposition {
  readonly kernel: CampaignComposition['kernel'];
  readonly world: CampaignComposition['world'];
  readonly db: CampaignComposition['db'];
  readonly game: CampaignComposition['game'];
  readonly popGame: CampaignComposition['popGame'];
  readonly kingdomGame: CampaignComposition['kingdomGame'];
  readonly diplomacyGame: CampaignComposition['diplomacyGame'];
  readonly militaryGame: CampaignComposition['militaryGame'];
  readonly armiesGame: CampaignComposition['armiesGame'];
  readonly combatGame: CampaignComposition['combatGame'];
  readonly castleGame: CampaignComposition['castleGame'];
  readonly siegeGame: CampaignComposition['siegeGame'];
  readonly researchGame: CampaignComposition['researchGame'];
  readonly eventGame: CampaignComposition['eventsGame'];
  /** M47.6: the victory tracker — inert unless `MultiKingdomOptions.victory` enables tracks. */
  readonly victoryGame: CampaignComposition['victoryGame'];
  readonly fog: CampaignComposition['fog'];
  readonly placement: CampaignComposition['placement'];
  readonly saves: CampaignComposition['saves'];
  villageOf(kingdomIndex: number): number | null;
}

export interface MultiKingdomOptions {
  readonly seed?: number;
  readonly kingdomCount: number;
  readonly mapSize?: number;
  /** Per-kingdom-index (0..n-1) personality weights; default for every kingdom if omitted. */
  readonly weightsOf?: (kingdomIndex: number) => PersonalityWeights;
  /** First kingdom index to AI-drive (default 1 — kingdom 0 is "the player," inert). Pass 0 for
   * a fully-AI campaign (M24). */
  readonly aiFromIndex?: number;
  /** Observational clock for perf telemetry (M24) — omitted means zero measurement overhead. */
  readonly clock?: () => number;
  /** Starting cohorts (default `{children:6, adults:15, elders:2}`, M22/M24's original). */
  readonly startingPopulation?: { readonly children: number; readonly adults: number; readonly elders: number };
  /** M46: campaign-wide difficulty preset. OPTIONAL and un-defaulted — see module doc. */
  readonly difficulty?: DifficultyPreset;
  /** M47.6: real victory tracking for tools (bench-balance, crash-triage). Omitted = inert
   * tracker, byte-identical harness behaviour for every pre-M47.6 test. */
  readonly victory?: VictoryOptions;
}

/** Kingdom placements far enough apart that fairness naturally holds; scouting range (M22
 * SCOUT_REVEAL_RADIUS) is deliberately much smaller than the inter-kingdom distance this
 * produces, so newly founded kingdoms start genuinely unrevealed to each other. */
export function composeMultiKingdom(options: MultiKingdomOptions): MultiKingdomComposition {
  const size = options.mapSize ?? 300;
  const c = composeCampaign({
    seed: options.seed ?? 2200,
    kingdomCount: options.kingdomCount,
    terrain: flatTerrain(size, size),
    startingStock: KINGDOM_STARTING_STOCK,
    calendar: false,
    // M47.8 systems stay OFF here: occupation and belief-based sensing did not exist when
    // the M22-M46 emergent-outcome tests were recorded (same pinning as the inert tracker).
    occupation: false,
    beliefs: false,
    industry: false,
    grudges: false,
    historySeeding: false,
    victory: options.victory ?? { enabled: [], defeatEnabled: false },
    ...(options.aiFromIndex !== undefined ? { aiFromIndex: options.aiFromIndex } : {}),
    ...(options.weightsOf !== undefined ? { weightsOf: options.weightsOf } : {}),
    ...(options.clock !== undefined ? { clock: options.clock } : {}),
    ...(options.startingPopulation !== undefined ? { startingPopulation: options.startingPopulation } : {}),
    ...(options.difficulty !== undefined ? { difficulty: options.difficulty } : {}),
  });
  return {
    kernel: c.kernel,
    world: c.world,
    db: c.db,
    game: c.game,
    popGame: c.popGame,
    kingdomGame: c.kingdomGame,
    diplomacyGame: c.diplomacyGame,
    militaryGame: c.militaryGame,
    armiesGame: c.armiesGame,
    combatGame: c.combatGame,
    castleGame: c.castleGame,
    siegeGame: c.siegeGame,
    researchGame: c.researchGame,
    eventGame: c.eventsGame,
    victoryGame: c.victoryGame,
    fog: c.fog,
    placement: c.placement,
    saves: c.saves,
    villageOf: c.villageOf,
  };
}
