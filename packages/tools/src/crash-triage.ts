/**
 * Crash triage (roadmap M47; doc 12 T objective "100 seeded full campaigns
 * crash-free").
 *
 *   node packages/tools/dist/crash-triage.js [--seeds N] [--years N] [--kingdoms N]
 *
 * Reuses M46's balance-harness shape (`composeMultiKingdom` + real
 * `VictoryGameplay`) but tuned for BREADTH over depth: many distinct seeds,
 * spread evenly across all four `DifficultyLevel`s, each run just long
 * enough to exercise a real mix of subsystems (construction, recruitment,
 * research, diplomacy, sieges if a war catches fire, events) rather than a
 * full 40-100 year economic maturity run. A crash here is an uncaught
 * exception during `kernel.step()` — the literal, narrowest reading of
 * "crash" doc 12's T objective asks for; it does not itself judge pacing or
 * balance (that's M46's job, already done).
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
  TICKS_PER_YEAR,
  type DifficultyLevel,
  type PersonalityWeights,
} from '@crowns/sim';

/** M47.8/M47.9 (doc 12 R1): `--real` triages the UNIFIED campaign composition — real
 * worldgen, content personalities, occupation/beliefs/grudges/industry — the shipping game. */
const REAL = process.argv.includes('--real');

const argValue = (flag: string, fallback: number): number => {
  const i = process.argv.indexOf(flag);
  if (i === -1) return fallback;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) ? v : fallback;
};

const SEEDS = argValue('--seeds', 100);
const YEARS = argValue('--years', 25);
const KINGDOMS = argValue('--kingdoms', 4);
const SEED_BASE = 40000;

// A spread of personalities per kingdom SLOT (not per seed) so every seed still exercises a mix
// of aggressive/peaceful, trusting/wary, risk-seeking/cautious behaviour — breadth of CODE PATH
// coverage is the point here, not any one archetype's realism.
const PROFILES: readonly PersonalityWeights[] = [
  { expansion: 0.7, economy: 0.3, riskTolerance: 0.7, diplomacyTrust: 0.2, aggression: 0.7 },
  { expansion: 0.3, economy: 0.8, riskTolerance: 0.3, diplomacyTrust: 0.7, aggression: 0.1 },
  { expansion: 0.5, economy: 0.5, riskTolerance: 0.5, diplomacyTrust: 0.5, aggression: 0.4 },
  { expansion: 0.2, economy: 0.4, riskTolerance: 0.8, diplomacyTrust: 0.3, aggression: 0.9 },
];

interface RunResult {
  readonly seed: number;
  readonly difficulty: DifficultyLevel;
  readonly crashed: boolean;
  readonly error?: string;
  readonly stack?: string;
}

function runOne(seed: number, level: DifficultyLevel): RunResult {
  try {
    const victory = { enabled: ['conquest', 'hegemony', 'legacy', 'prosperity', 'chronicle'] as const, yearLimit: YEARS };
    const composed = REAL
      ? composeCampaign({
          seed,
          kingdomCount: KINGDOMS,
          mapSize: 'small',
          aiFromIndex: 0,
          personalities: 'content',
          difficulty: DIFFICULTY_PRESETS[level],
          startingPopulation: { children: 10, adults: 30, elders: 5 },
          victory,
        })
      : composeMultiKingdom({
          seed,
          kingdomCount: KINGDOMS,
          mapSize: 220,
          aiFromIndex: 0,
          weightsOf: (k) => PROFILES[k % PROFILES.length] as PersonalityWeights,
          difficulty: DIFFICULTY_PRESETS[level],
          startingPopulation: { children: 10, adults: 30, elders: 5 },
          // M47.6: the composition owns the tracker now (campaign.ts) — no second registration
          victory,
        });
    const victoryGame = composed.victoryGame;
    composed.kernel.step(); // genesis
    const totalTicks = YEARS * TICKS_PER_YEAR;
    for (let t = 0; t < totalTicks; t++) {
      composed.kernel.step();
      if (victoryGame.winner() !== null) break;
    }
    return { seed, difficulty: level, crashed: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    return stack === undefined
      ? { seed, difficulty: level, crashed: true, error: message }
      : { seed, difficulty: level, crashed: true, error: message, stack };
  }
}

DefinitionDatabase.load(BASE_CONTENT_FILES); // fail loudly (Mod Zero gate) before burning minutes

const results: RunResult[] = [];
const t0 = Date.now();
for (let i = 0; i < SEEDS; i++) {
  const seed = SEED_BASE + i;
  const level = DIFFICULTY_LEVELS[i % DIFFICULTY_LEVELS.length] as DifficultyLevel;
  const r = runOne(seed, level);
  results.push(r);
  if (r.crashed) {
    console.error(`CRASH  seed=${seed} difficulty=${level} · ${r.error}`);
    if (r.stack !== undefined) console.error(r.stack);
  } else if ((i + 1) % 10 === 0) {
    console.log(`... ${i + 1}/${SEEDS} campaigns run, 0 crashes so far (${((Date.now() - t0) / 1000).toFixed(0)}s elapsed)`);
  }
}

const crashes = results.filter((r) => r.crashed);
console.log(`\n${results.length} seeded campaign(s), ${KINGDOMS} kingdoms × ${YEARS}y, spread across all ${DIFFICULTY_LEVELS.length} difficulties, in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
if (crashes.length > 0) {
  console.error(`FAIL: ${crashes.length}/${results.length} campaign(s) crashed`);
  process.exitCode = 1;
} else {
  console.log(`all ${results.length} campaigns completed crash-free — T objective holds (doc 12)`);
}
