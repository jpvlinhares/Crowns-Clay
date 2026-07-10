/**
 * Difficulty system (roadmap M38; GDD §14; doc 07 §10). Two orthogonal
 * levers, in GDD §14's stated order of preference:
 *
 * (1) AI CAPABILITY (preferred lever) — `DifficultyPreset` bundles the five
 * doc 07 §10 rows as concrete values a composition threads into EXISTING,
 * already-composable options (no new plumbing needed for most of them):
 *   - `appraisalNoise`/`periodMultiplier` → `ai/planner.ts`'s
 *     `AiStrategicPlannerOptions` (M38 additions, default neutral).
 *   - `knowledgeHalfLifeMultiplier` → `ai/brain.ts`'s existing
 *     `confidenceHalfLifeTicks` option (already configurable since M19).
 *   - `scoutingRadiusMultiplier` → `ai/scouting.ts`'s new `revealRadius`
 *     option (M38 addition, default `SCOUT_REVEAL_RADIUS`).
 *   - `jointWarCoordination` → `game/diplomacy.ts`'s new
 *     `DiplomacyOptions.jointWarCoordination` (M38 addition, default 'on').
 *   - `managerQuality` is DOCUMENTED but not wired by this module: doc 07
 *     §5/§20's own "basic" tier would mean a composition omits the
 *     military/research managers entirely for a Story-tier AI kingdom —
 *     `ai/needs.ts` only ever shipped 2 evaluators total (M20's own v1
 *     slice), so there's no smaller subset to switch to at that lever.
 *     "Data now, active later" (M35/M36/M37's own precedent).
 *
 * (2) LABELLED MODIFIERS (visible, tooltipped, GDD §14: "no hidden cheats at
 * any level") — `aiYieldBonus`/`playerYieldBonus` feed
 * `game/kingdom.ts`'s new `difficultyYieldOf` hook. FAIR is the design-
 * integrity benchmark: BOTH are exactly 0 — the T objective ("Fair-difficulty
 * AI beats naive scripted baseline") is specifically about proving AI
 * COMPETENCE alone, with no numeric help, is a real threat.
 *
 * OQ-8 (doc 14): downward-only mid-campaign adjustment outside ironman is a
 * UI/save-flow concern this module doesn't touch — presets here are pure,
 * static config, chosen at composition time.
 */

export const DIFFICULTY_LEVELS = ['story', 'fair', 'hard', 'brutal'] as const;
export type DifficultyLevel = (typeof DIFFICULTY_LEVELS)[number];

export interface DifficultyPreset {
  readonly level: DifficultyLevel;
  /** 0..1, ai/planner.ts's `appraisalNoise` — higher is less sharp AI judgement. */
  readonly appraisalNoise: number;
  /** Multiplies the planner's weekly re-eval period — >1 reacts slower. */
  readonly periodMultiplier: number;
  /** Multiplies `ai/brain.ts`'s `DEFAULT_CONFIDENCE_HALF_LIFE_TICKS` — >1 forgets slower. */
  readonly knowledgeHalfLifeMultiplier: number;
  /** Multiplies `ai/scouting.ts`'s `SCOUT_REVEAL_RADIUS` — >1 discovers rivals sooner. */
  readonly scoutingRadiusMultiplier: number;
  /** doc 07 §5/§20 "heuristic depth" — documented, not wired (see module doc above). */
  readonly managerQuality: 'basic' | 'full';
  /** game/diplomacy.ts's `DiplomacyOptions.jointWarCoordination`. */
  readonly jointWarCoordination: 'off' | 'limited' | 'on';
  /** GDD §14 labelled bonus applied to AI kingdoms via `difficultyYieldOf` — 0 at Story/Fair. */
  readonly aiYieldBonus: number;
  /** GDD §14 labelled bonus applied to the PLAYER kingdom — only nonzero at Story. */
  readonly playerYieldBonus: number;
}

export const STORY_PRESET: DifficultyPreset = {
  level: 'story',
  appraisalNoise: 0.3,
  periodMultiplier: 1.5,
  knowledgeHalfLifeMultiplier: 0.5,
  scoutingRadiusMultiplier: 0.7,
  managerQuality: 'basic',
  jointWarCoordination: 'off',
  aiYieldBonus: 0,
  playerYieldBonus: 0.15,
};

/** The design-integrity benchmark (doc 07 §10): every multiplier at its M19-M37 neutral value,
 * both labelled bonuses exactly 0 — genuinely cheat-free, AI competence is the only lever. */
export const FAIR_PRESET: DifficultyPreset = {
  level: 'fair',
  appraisalNoise: 0.12,
  periodMultiplier: 1,
  knowledgeHalfLifeMultiplier: 1,
  scoutingRadiusMultiplier: 1,
  managerQuality: 'full',
  jointWarCoordination: 'limited',
  aiYieldBonus: 0,
  playerYieldBonus: 0,
};

export const HARD_PRESET: DifficultyPreset = {
  level: 'hard',
  appraisalNoise: 0.05,
  periodMultiplier: 0.75,
  knowledgeHalfLifeMultiplier: 2,
  scoutingRadiusMultiplier: 1.3,
  managerQuality: 'full',
  jointWarCoordination: 'on',
  aiYieldBonus: 0.15,
  playerYieldBonus: 0,
};

export const BRUTAL_PRESET: DifficultyPreset = {
  level: 'brutal',
  appraisalNoise: 0,
  periodMultiplier: 0.5,
  knowledgeHalfLifeMultiplier: 2,
  scoutingRadiusMultiplier: 1.3,
  managerQuality: 'full',
  jointWarCoordination: 'on',
  aiYieldBonus: 0.3,
  playerYieldBonus: 0,
};

export const DIFFICULTY_PRESETS: Readonly<Record<DifficultyLevel, DifficultyPreset>> = {
  story: STORY_PRESET,
  fair: FAIR_PRESET,
  hard: HARD_PRESET,
  brutal: BRUTAL_PRESET,
};
