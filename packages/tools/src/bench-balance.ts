/**
 * Balance harness (roadmap M46; doc 01 §8 SC-2 "a full campaign is completable
 * at every difficulty without crashes or soft-locks"; doc 12's "telemetry-free
 * tuning via harness stats + structured playtests").
 *
 *   node packages/tools/dist/bench-balance.js [--years N] [--kingdoms N] [--seeds N]
 *
 * "Telemetry-free" (doc 01 §9: no player telemetry beyond opt-in local
 * diagnostics) means exactly this: a deterministic, local, seed-driven
 * harness stands in for live player analytics. Runs one full AI-vs-AI
 * campaign per (seed × difficulty) — every `DifficultyLevel` from M38's
 * `DIFFICULTY_PRESETS`, now actually wired into a real composition for the
 * first time (see `multiKingdomHarness.ts`'s M46 delta) — with the real
 * `VictoryGameplay` tracker (M37) attached, and reports what actually
 * happened: crash/no-crash, which victory track fired and in what year (if
 * any), how many kingdoms were eliminated, and the final population/treasury
 * spread. This is pacing data a human can read and decide from — not a
 * black-box tuner; no numeric constant in this repo is touched automatically.
 */
import {
  BASE_CONTENT_FILES,
  DefinitionDatabase,
} from '@crowns/data';
import {
  composeCampaign,
  composeMultiKingdom,
  DIFFICULTY_LEVELS,
  DIFFICULTY_PRESETS,
  DEFAULT_YEAR_LIMIT,
  TICKS_PER_YEAR,
  type DifficultyLevel,
  type PersonalityWeights,
} from '@crowns/sim';

const argValue = (flag: string, fallback: number): number => {
  const i = process.argv.indexOf(flag);
  if (i === -1) return fallback;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) ? v : fallback;
};

/**
 * ADR-14: a village is only SETTLED once a birth cohort has flowed through to adulthood.
 * `MATURE_RATE` is `1/(14 years)`, so the pre-ADR-14 filter of 10 years admitted villages that
 * cannot yet HAVE a healthy adult fraction — births pile into the child bucket for over a decade
 * before maturation delivers. The floor was therefore measuring whichever admitted village was
 * YOUNGEST, and since bands are read at campaign END it penalised campaigns that finished early:
 * `hard` seed 9001 ended on a y14 conquest and its 14-year-old village (392 people, 320 of them
 * children, ZERO capital falls in the run) failed a band it was arithmetically unable to pass.
 * 20 years, not the bare 14, so a cohort has time to flow through rather than merely begin.
 * The floor's VALUE (15%) is untouched — only this threshold, which M62's measurement never set.
 */
export const SETTLED_VILLAGE_YEARS = 20;

const YEARS = argValue('--years', DEFAULT_YEAR_LIMIT);
const KINGDOMS = argValue('--kingdoms', 4);
const SEEDS = argValue('--seeds', 3);
const SEED_BASE = 9000;
/** M47.8 (doc 12 R1): `--real` runs the matrix on the UNIFIED campaign composition —
 * real worldgen terrain, content personalities, occupation, beliefs, grudges, the
 * industry chain, no tools crutch — the game the player actually plays, not the flat
 * harness the M46 numbers were tuned on. */
const REAL = process.argv.includes('--real');

// 1.x war-cadence backlog (2026-07-18): the original "generic Warmonger/Builder stand-in"
// pair (aggression 0.6/0.2, citing multiKingdom.test.ts's naming convention) never once
// declared a war across the whole matrix — every campaign raced to a `prosperity` victory
// by year 15-16 before either weight profile's war machinery had real runway. Replaced with
// `multiKingdomWar.test.ts`'s AGGRESSIVE/PASSIVE pair verbatim — the one weight combination
// in this repo PROVEN (by that test) to actually declare war and win it against a real
// opposing army within a test-sized number of years, not just reasoned to. Same alternating
// convention (even index = aggressive, odd = passive), so a 4-kingdom run still mixes
// aggressive-vs-aggressive and aggressive-vs-passive matchups.
const WEIGHTS_A: PersonalityWeights = { expansion: 0.3, economy: 0.6, riskTolerance: 0.7, diplomacyTrust: 0.2, aggression: 0.9 };
const WEIGHTS_B: PersonalityWeights = { expansion: 0.2, economy: 0.9, riskTolerance: 0.3, diplomacyTrust: 0.5, aggression: 0 };

// Entity-index mask, same convention as campaign.ts/victory.ts's own `index()`.
const index = (id: number): number => id & 0x3fffff;

/** M62 (doc 12 Phase 9, ADR-ratified 2026-07-27): one measurement per village, taken at the
 * run's final tick — age in years since `village.founded`, and the adult share of its cohorts.
 * Feeds the adult-cohort band below; not itself a pass/fail record. */
interface VillageBand {
  /** ADR-14: carried so a floor failure is attributable in ONE run instead of sixteen probes. */
  readonly total: number;
  readonly children: number;
  readonly vi: number;
  readonly ageYears: number;
  readonly adultFraction: number;
}

interface RunResult {
  readonly seed: number;
  readonly difficulty: DifficultyLevel;
  readonly crashed: boolean;
  readonly error?: string;
  readonly winner: { readonly type: string; readonly year: number } | null;
  readonly kingdomsEliminated: number;
  readonly finalPopulations: readonly number[];
  readonly finalTreasuries: readonly number[];
  /** M47.8 war-cycle telemetry: wars must start AND end (the R1 T objective). */
  readonly warsDeclared: number;
  readonly warsEnded: number;
  readonly occupations: number;
  /** M53 loss-chain telemetry (the M53 T objective): vassal kingdoms persist, only
   * refused capitulations destroy, new banners refill the map. */
  readonly capitulations: number;
  readonly destructions: number;
  readonly risings: number;
  /** War-cadence telemetry: does a declared war REACH a siege, does a siege REACH an assault,
   * and does an assault RESOLVE? All three stages are counted separately so a stall can be
   * attributed to one of them instead of guessed at.
   *
   * M70.5 rewrote this block after the M70 isolation run found every war number here was wrong:
   *
   *  - `assaultsResolved`/`assaultsRepelled` replace `assaultsBegun`, which subscribed to
   *    **`siege.assaultBegun` — an event NO code in this repository publishes.** It read 0 in
   *    every run of every composition ever made, and M61.5 and Gate P9 both read that 0 as
   *    "the AI never assaults". Measured after the fix: the AI assaults constantly. The real
   *    event is `siege.assaultResolved`, carrying `outcome: 'captured' | 'repelled'`.
   *  - `capitalFalls` is new and is the ONLY capture signal the shipping composition can emit.
   *    `siege.captured` fires only for a NON-capital castle: `siege.ts`'s `capture()` consults
   *    `capitalFall.claim` first (M53), and a capital's fall is a KINGDOM event
   *    (`siege.capitalFallen`) resolved by succession. The AI besieges capitals. The flat
   *    harness sets `succession: false` (`ai/multiKingdomHarness.ts`), so THERE the identical
   *    assault publishes `siege.captured` — which is the whole of the "23 captured vs 0
   *    captured" gap that chartered Phase 10. Counting only `siegesCaptured` made every
   *    successful war in the real composition invisible. */
  readonly siegesBegun: number;
  readonly assaultsResolved: number;
  readonly assaultsRepelled: number;
  readonly siegesCaptured: number;
  readonly capitalFalls: number;
  /** M62: per-village age/adult-fraction snapshot at the run's final tick. */
  readonly villageBands: readonly VillageBand[];
}

function runOne(seed: number, level: DifficultyLevel, kingdomCount: number): RunResult {
  try {
    const victory = { enabled: ['conquest', 'hegemony', 'legacy', 'prosperity', 'chronicle'] as const, yearLimit: YEARS };
    const composed = REAL
      ? composeCampaign({
          seed,
          kingdomCount,
          mapSize: 'small',
          aiFromIndex: 0, // fully AI — a real emergent economy/war, not an engineered scenario
          personalities: 'content',
          difficulty: DIFFICULTY_PRESETS[level],
          startingPopulation: { children: 10, adults: 30, elders: 5 },
          victory,
        })
      : composeMultiKingdom({
          seed,
          kingdomCount,
          // 1.x war-cadence backlog, part 3 (2026-07-18): the previous 260 put adjacent
          // kingdoms ~130-150 tiles apart against a STATIC 48-tile scouting radius
          // (ai/scouting.ts's SCOUT_REVEAL_RADIUS, no active exploration) — rivals could
          // never discover each other for an entire 100-year run, at any aggression, which
          // is what part 2's weight retune ran into. 65 was picked by direct measurement
          // (not derived from `fairPlacement`'s ring formula alone — the flat harness's
          // uniform terrain biases site selection in ways worth checking empirically): at
          // kingdomCount=4 it gives all 6 pairwise inter-capital distances <= 48 tiles,
          // reproducibly across seeds 9000-9002, while still founding all four kingdoms
          // cleanly clear of VILLAGE_MIN_SPACING (24). Tuned for kingdomCount=4 (this
          // tool's default and the only count exercised so far) — a different `--kingdoms`
          // value may need its own recalibration.
          mapSize: 65,
          aiFromIndex: 0,
          weightsOf: (k) => (k % 2 === 0 ? WEIGHTS_A : WEIGHTS_B),
          difficulty: DIFFICULTY_PRESETS[level],
          startingPopulation: { children: 10, adults: 30, elders: 5 },
          // M47.6: the composition owns the tracker now (campaign.ts) — no second registration
          victory,
        });
    const victoryGame = composed.victoryGame;

    let eliminated = 0;
    let warsDeclared = 0;
    let warsEnded = 0;
    let occupations = 0;
    composed.kernel.subscribe('defeat.kingdom', () => {
      eliminated++;
    });
    composed.kernel.subscribe('diplomacy.warDeclared', () => warsDeclared++);
    composed.kernel.subscribe('diplomacy.peaceForced', () => warsEnded++);
    composed.kernel.subscribe<{ accepted: boolean }>('diplomacy.peaceProposed', (e) => {
      if (e.data.accepted) warsEnded++;
    });
    composed.kernel.subscribe('village.occupied', () => occupations++);
    let capitulations = 0;
    let destructions = 0;
    let risings = 0;
    composed.kernel.subscribe('kingdom.capitulated', () => capitulations++);
    composed.kernel.subscribe('kingdom.destroyed', () => destructions++);
    composed.kernel.subscribe('kingdom.newLordRisen', () => risings++);
    let siegesBegun = 0;
    let assaultsResolved = 0;
    let assaultsRepelled = 0;
    let siegesCaptured = 0;
    let capitalFalls = 0;
    composed.kernel.subscribe('siege.begun', () => siegesBegun++);
    composed.kernel.subscribe<{ outcome: string }>('siege.assaultResolved', (e) => {
      assaultsResolved++;
      if (e.data.outcome !== 'captured') assaultsRepelled++;
    });
    composed.kernel.subscribe('siege.captured', () => siegesCaptured++);
    composed.kernel.subscribe('siege.capitalFallen', () => capitalFalls++);
    // M62: every village's founding tick, capital or settled — `ops.found` is the ONE path
    // both take (villages.ts), so this single subscription covers both without a genesis vs.
    // settler-founded distinction.
    const foundedTick = new Map<number, number>();
    composed.kernel.subscribe<{ village: number }>('village.founded', (e) => {
      foundedTick.set(index(e.data.village), e.tick);
    });

    composed.kernel.step(); // genesis
    const totalTicks = YEARS * TICKS_PER_YEAR;
    for (let t = 0; t < totalTicks; t++) {
      composed.kernel.step();
      if (victoryGame.winner() !== null) break;
    }

    const winner = victoryGame.winner();
    const finalPopulations: number[] = [];
    const finalTreasuries: number[] = [];
    const kingdomIds = composed.kingdomGame.kingdomEntities();
    const treasuryCol = composed.world.read(composed.kingdomGame.Kingdom).treasury;
    for (let k = 0; k < kingdomCount; k++) {
      const vi = composed.villageOf(k);
      finalPopulations.push(vi === null ? 0 : composed.popGame.totalOf(vi as never));
      const kid = kingdomIds[k];
      finalTreasuries.push(kid === undefined ? 0 : (treasuryCol[(kid as number) & 0x3fffff] as number));
    }

    // M62: one age/adult-fraction sample per extant village at the run's final tick — every
    // village any kingdom still holds, not just capitals (a settled hamlet is exactly the
    // village the adult-cohort band exists to catch).
    const currentTick = composed.kernel.currentTick;
    const villageBands: VillageBand[] = [];
    const popCols = composed.world.read(composed.popGame.Population);
    composed.world.query([composed.game.comps.VillageCore, composed.popGame.Population]).forEach((vi) => {
      const children = popCols.children[vi] as number;
      const adults = popCols.adults[vi] as number;
      const elders = popCols.elders[vi] as number;
      const total = children + adults + elders;
      if (total < 1) return; // razed/never-populated slot — nothing to measure
      const founded = foundedTick.get(vi) ?? 0;
      villageBands.push({ ageYears: (currentTick - founded) / TICKS_PER_YEAR, adultFraction: adults / total, total, children, vi });
    });

    return {
      seed,
      difficulty: level,
      crashed: false,
      winner: winner === null ? null : { type: winner.type, year: Math.floor(winner.tick / TICKS_PER_YEAR) },
      kingdomsEliminated: eliminated,
      finalPopulations,
      finalTreasuries,
      warsDeclared,
      warsEnded,
      occupations,
      capitulations,
      destructions,
      risings,
      siegesBegun,
      assaultsResolved,
      assaultsRepelled,
      siegesCaptured,
      capitalFalls,
      villageBands,
    };
  } catch (error) {
    return {
      seed,
      difficulty: level,
      crashed: true,
      error: error instanceof Error ? error.message : String(error),
      winner: null,
      kingdomsEliminated: 0,
      finalPopulations: [],
      finalTreasuries: [],
      warsDeclared: 0,
      warsEnded: 0,
      occupations: 0,
      capitulations: 0,
      destructions: 0,
      risings: 0,
      siegesBegun: 0,
      assaultsResolved: 0,
      assaultsRepelled: 0,
      siegesCaptured: 0,
      capitalFalls: 0,
      villageBands: [],
    };
  }
}

/** Nearest-rank percentile over an ALREADY-SORTED ascending array (deterministic; no
 * interpolation — the bands below are spaced widely enough that the distinction never matters). */
function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * (sorted.length - 1))));
  return sorted[i] as number;
}

// Load once, up front, purely to fail loudly (Mod Zero gate) before burning minutes on campaigns.
DefinitionDatabase.load(BASE_CONTENT_FILES);

const results: RunResult[] = [];
// M47.8: the REAL matrix spans field sizes too — 2-kingdom duels are where Conquest gets
// room to finish before Prosperity's streak does (elimination = conquest, GDD §16).
const KINGDOM_COUNTS = REAL ? [2, KINGDOMS] : [KINGDOMS];
for (const kc of KINGDOM_COUNTS) {
for (const level of DIFFICULTY_LEVELS) {
  for (let i = 0; i < SEEDS; i++) {
    const seed = SEED_BASE + i;
    const t0 = Date.now();
    const r = runOne(seed, level, kc);
    const ms = Date.now() - t0;
    results.push(r);
    if (r.crashed) {
      console.error(`CRASH  ${level.padEnd(6)} seed=${seed} · ${r.error} (${ms}ms)`);
    } else {
      const outcome = r.winner === null ? `no winner by year ${YEARS} (SOFT-LOCK RISK)` : `${r.winner.type} in year ${r.winner.year}`;
      console.log(
        `OK     ${level.padEnd(6)} seed=${seed} k=${kc} · ${outcome} · eliminated=${r.kingdomsEliminated}/${kc} · ` +
          `wars ${r.warsDeclared}/${r.warsEnded} ended · sieges ${r.siegesBegun} assaults ${r.assaultsResolved} (${r.assaultsRepelled} repelled) capitals fallen ${r.capitalFalls} captures ${r.siegesCaptured} · ` +
          `occupations ${r.occupations} · ` +
          `capitulated ${r.capitulations} · destroyed ${r.destructions} · risen ${r.risings} · ` +
          `pop=[${r.finalPopulations.map((p) => p.toFixed(0)).join(',')}] (${ms}ms)`,
      );
    }
  }
}
}

console.log(`\n${results.length} campaign(s): ${KINGDOMS} kingdoms × ${YEARS}y × ${DIFFICULTY_LEVELS.length} difficulties × ${SEEDS} seed(s)${REAL ? ' · REAL composition' : ' · flat harness'}`);
const crashes = results.filter((r) => r.crashed);
const noWinner = results.filter((r) => !r.crashed && r.winner === null);
// M47.8 R1 T objectives, evaluated across the whole matrix:
const clean = results.filter((r) => !r.crashed);
const starvedAtPeace = clean.filter((r) => r.warsDeclared === 0 && r.finalPopulations.some((p) => p <= 0));
const warsStarted = clean.reduce((n, r) => n + r.warsDeclared, 0);
const warsEnded = clean.reduce((n, r) => n + r.warsEnded, 0);
const totalSieges = clean.reduce((n, r) => n + r.siegesBegun, 0);
const totalAssaults = clean.reduce((n, r) => n + r.assaultsResolved, 0);
const totalRepelled = clean.reduce((n, r) => n + r.assaultsRepelled, 0);
const totalCapitalFalls = clean.reduce((n, r) => n + r.capitalFalls, 0);
const totalCaptures = clean.reduce((n, r) => n + r.siegesCaptured, 0);
const victoryTypes = new Set(clean.filter((r) => r.winner !== null).map((r) => r.winner?.type));
console.log(`wars: ${warsStarted} declared, ${warsEnded} ended · sieges: ${totalSieges} begun, ${totalAssaults} assaults resolved (${totalRepelled} repelled), ${totalCapitalFalls} capitals fallen, ${totalCaptures} non-capital captures · victory types seen: [${[...victoryTypes].join(', ')}] · peacetime starvation: ${starvedAtPeace.length} run(s)`);
if (crashes.length > 0) {
  console.error(`FAIL: ${crashes.length} campaign(s) crashed (SC-2 violation)`);
  process.exitCode = 1;
} else if (noWinner.length > 0) {
  console.warn(`warning: ${noWinner.length} campaign(s) reached the year cap with no winner — see per-run detail above`);
} else {
  console.log('all campaigns reached a victory before the year cap, at every difficulty — SC-2 holds');
}
if (REAL) {
  const failures: string[] = [];
  if (starvedAtPeace.length > 0) failures.push(`${starvedAtPeace.length} kingdom-starved-at-peace run(s)`);
  if (warsStarted > 0 && warsEnded === 0) failures.push('wars start but never end');
  if (victoryTypes.size < 2) failures.push(`only ${victoryTypes.size} victory type(s) reached organically (need ≥2)`);
  if (failures.length > 0) {
    console.error(`R1 T-OBJECTIVE FAIL: ${failures.join(' · ')}`);
    process.exitCode = 1;
  } else {
    console.log('R1 T objectives hold: no peacetime starvation · wars start AND end · ≥2 victory types organically');
  }

  // ---- M62 (doc 12 Phase 9): outcome bands, ratified 2026-07-27, written BEFORE the fixes
  // they gate — a band reshaped after the fact to match whatever the fixes produced would
  // defeat the entire point of measuring the composed game instead of its functions. ----
  const allBands = clean.flatMap((r) => r.villageBands);
  const fractions = allBands.map((b) => b.adultFraction).sort((a, b) => a - b);
  const p10AdultFraction = percentile(fractions, 10);
  const oldVillages = allBands.filter((b) => b.ageYears > SETTLED_VILLAGE_YEARS);
  const minOldFraction = oldVillages.length > 0 ? Math.min(...oldVillages.map((b) => b.adultFraction)) : null;
  // ADR-14: name the village that DEFINES the floor, every run — the band is a `min`, so without
  // this a failure costs a bisection to attribute (M79 spent one finding a 14-year-old village).
  const floorVillage = oldVillages.reduce<VillageBand | null>((a, b) => (a === null || b.adultFraction < a.adultFraction ? b : a), null);

  // M70.5: `capitalFalls` belongs in this band and its absence was silently deflating it. A
  // capital that falls to an assault IS a village changing hands — it just publishes
  // `siege.capitalFallen` instead of `siege.captured`, because succession owns a capital's fate
  // (M53). The band's definition is unchanged ("a village changed hands"); only the set of events
  // that can evidence it is corrected. Ratified band, corrected instrument — NOT a re-ratification.
  const changesIn = (r: RunResult): number => r.occupations + r.siegesCaptured + r.capitalFalls;
  const changedHandsRuns = clean.filter((r) => changesIn(r) > 0).length;
  const changedHandsShare = clean.length > 0 ? changedHandsRuns / clean.length : 0;
  const totalChanges = clean.reduce((n, r) => n + changesIn(r), 0);

  const winners = clean.filter((r): r is RunResult & { winner: NonNullable<RunResult['winner']> } => r.winner !== null);
  const winnerYears = winners.map((r) => r.winner.year).sort((a, b) => a - b);
  const minWinYear = winnerYears.length > 0 ? (winnerYears[0] as number) : null;
  const medianWinYear = winnerYears.length > 0 ? percentile(winnerYears, 50) : null;

  const typeCounts = new Map<string, number>();
  for (const r of winners) typeCounts.set(r.winner.type, (typeCounts.get(r.winner.type) ?? 0) + 1);
  let maxTypeShare = 0;
  let maxTypeLabel = 'none';
  for (const [type, count] of typeCounts) {
    const share = winners.length > 0 ? count / winners.length : 0;
    if (share > maxTypeShare) { maxTypeShare = share; maxTypeLabel = type; }
  }

  console.log(
    `\nM62 bands — adult cohort: p10 ${(p10AdultFraction * 100).toFixed(1)}% ` +
      `(settled-village floor ${minOldFraction === null ? `n/a, no village >${SETTLED_VILLAGE_YEARS}y` : `${(minOldFraction * 100).toFixed(1)}% — vi=${String(floorVillage?.vi)} age=${floorVillage?.ageYears.toFixed(0)}y pop=${floorVillage?.total.toFixed(0)} children=${floorVillage?.children.toFixed(0)}`}) · ` +
      `war: ${changedHandsRuns}/${clean.length} campaign(s) saw a village change hands ` +
      `(${totalChanges} total changes — reported, not gated) · ` +
      `victory timing: earliest year ${minWinYear ?? 'n/a'}, median ${medianWinYear ?? 'n/a'} (reported) · ` +
      `monoculture: ${maxTypeLabel} at ${(maxTypeShare * 100).toFixed(0)}% of wins`,
  );

  const m62Failures: string[] = [];
  if (p10AdultFraction < 0.30) {
    m62Failures.push(`adult-cohort p10 ${(p10AdultFraction * 100).toFixed(1)}% < 30% floor`);
  }
  if (minOldFraction !== null && minOldFraction < 0.15) {
    m62Failures.push(`a SETTLED village (>${SETTLED_VILLAGE_YEARS}y) has adult fraction ${(minOldFraction * 100).toFixed(1)}% < 15% hard floor — vi=${String(floorVillage?.vi)} age=${floorVillage?.ageYears.toFixed(0)}y pop=${floorVillage?.total.toFixed(0)}`);
  }
  if (changedHandsShare < 0.5) {
    m62Failures.push(`only ${(changedHandsShare * 100).toFixed(0)}% of campaigns saw a village change hands (need ≥50%)`);
  }
  if (minWinYear !== null && minWinYear < 30) {
    m62Failures.push(`a victory fired in year ${minWinYear} (need ≥30)`);
  }
  if (maxTypeShare > 0.6) {
    m62Failures.push(`${maxTypeLabel} won ${(maxTypeShare * 100).toFixed(0)}% of campaigns (need ≤60% for any single type)`);
  }
  if (m62Failures.length > 0) {
    console.error(`M62 BAND FAIL: ${m62Failures.join(' · ')}`);
    process.exitCode = 1;
  } else {
    console.log('M62 bands hold: adult cohorts staffed, war changes hands, no early runaway, no victory monoculture');
  }
}
