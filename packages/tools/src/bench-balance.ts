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
  /** 1.x war-cadence backlog telemetry: does a declared war ever actually REACH a siege,
   * and does a mounted siege ever REACH an assault? Distinguishes "never marches" from
   * "arrives but never assaults" — the roadmap's "no capital sieges mounted" finding had
   * no counter to confirm which stage was stalling. */
  readonly siegesBegun: number;
  readonly assaultsBegun: number;
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
          mapSize: 260,
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
    let assaultsBegun = 0;
    composed.kernel.subscribe('siege.begun', () => siegesBegun++);
    composed.kernel.subscribe('siege.assaultBegun', () => assaultsBegun++);

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
      assaultsBegun,
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
      assaultsBegun: 0,
    };
  }
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
          `wars ${r.warsDeclared}/${r.warsEnded} ended · sieges ${r.siegesBegun} assaults ${r.assaultsBegun} · ` +
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
const totalAssaults = clean.reduce((n, r) => n + r.assaultsBegun, 0);
const victoryTypes = new Set(clean.filter((r) => r.winner !== null).map((r) => r.winner?.type));
console.log(`wars: ${warsStarted} declared, ${warsEnded} ended · sieges: ${totalSieges} begun, ${totalAssaults} assaulted · victory types seen: [${[...victoryTypes].join(', ')}] · peacetime starvation: ${starvedAtPeace.length} run(s)`);
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
}
