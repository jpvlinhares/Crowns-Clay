/**
 * AI personality wiring (roadmap M36; GDD §11; doc 06 §7; doc 07 §9).
 *
 * `AIPersonalityDef` (packages/data) is the mod-loadable content; this module
 * is the ONLY place it touches AI behaviour, since data/ never depends on
 * sim/ (TDD §3):
 *
 *   - `perturbWeights` adds small, seeded per-campaign jitter (doc 07 §9:
 *     "so two Warmongers differ") — pure function of (weights, rng), so
 *     identical seeds always perturb identically (determinism, TDD §5).
 *   - `toPlannerWeights`/`toDiplomacyPersonality` map the full 8-axis
 *     `AIPersonalityDef.weights` onto the narrower structural subsets
 *     planner.ts and diplomacy.ts already consume (`PersonalityWeights`,
 *     `DiplomacyPersonality`) — no changes needed to either module's own
 *     shape, just a wider source feeding it. `planBiases` rides along on
 *     `PersonalityWeights` itself (an optional field planner.ts's scoring
 *     loop multiplies in, M36 delta) rather than a separate channel.
 *   - `describePersonality` is the "legibility" T-adjacent piece (doc 07 §9:
 *     "the diplomacy screen surfaces observed traits... once the player has
 *     evidence"): a PURE function of weights → human-readable "Known for..."
 *     tags. Gating that behind the knowledge model's per-fact `confidence`
 *     (knowledge.ts, M19) is the CALLER's job — no new fact kind is added
 *     here, so a real UI can choose its own reveal threshold without this
 *     module needing to know about it.
 *
 * The blind fingerprint test (T objective, ai/multiKingdomPersonality.test.ts)
 * is the proof that these profiles are BEHAVIOURALLY distinct, not just
 * differently worded content.
 */
import type { Rng } from '@crowns/core';
import { PERSONALITY_AXES, type AIPersonalityDef, type PersonalityAxis } from '@crowns/data';
import type { PersonalityWeights } from './planner.js';
import type { DiplomacyPersonality } from '../game/diplomacy.js';

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

/** Small seeded jitter per axis (±`amount`, clamped 0..1) — deterministic given `rng`'s state,
 * so two kingdoms sharing an archetype diverge in a fixed, reproducible way per campaign seed. */
export function perturbWeights(
  weights: Readonly<Record<PersonalityAxis, number>>,
  rng: Rng,
  amount = 0.08,
): Record<PersonalityAxis, number> {
  const out = {} as Record<PersonalityAxis, number>;
  for (const axis of PERSONALITY_AXES) out[axis] = clamp01(weights[axis] + (rng.nextFloat() * 2 - 1) * amount);
  return out;
}

/** Maps the full 8-axis def onto planner.ts's structural subset, carrying `planBiases` along so
 * the SAME `PersonalityWeights` value drives both utility scoring and the archetype multiplier. */
export function toPlannerWeights(
  def: Pick<AIPersonalityDef, 'planBiases'>,
  weights: Readonly<Record<PersonalityAxis, number>>,
): PersonalityWeights {
  return {
    expansion: weights.expansion,
    economy: weights.economy,
    riskTolerance: weights.riskTolerance,
    diplomacyTrust: weights.diplomacyTrust,
    aggression: weights.aggression,
    tech: weights.tech,
    planBiases: def.planBiases,
  };
}

export function toDiplomacyPersonality(weights: Readonly<Record<PersonalityAxis, number>>): DiplomacyPersonality {
  return { diplomacyTrust: weights.diplomacyTrust };
}

// ---------------------------------------------------------------- legibility

interface AxisPhrase {
  readonly high?: string; // shown when the axis is >= HIGH_THRESHOLD
  readonly low?: string; // shown when the axis is <= LOW_THRESHOLD
}

const HIGH_THRESHOLD = 0.65;
const LOW_THRESHOLD = 0.35;
const MAX_TRAITS_SHOWN = 3;

const AXIS_PHRASES: Readonly<Record<PersonalityAxis, AxisPhrase>> = {
  expansion: { high: 'settling new lands', low: 'holding its borders' },
  aggression: { high: 'making war', low: 'avoiding conflict' },
  economy: { high: 'building prosperity' },
  tech: { high: 'pursuing knowledge' },
  diplomacyTrust: { high: 'seeking allies', low: 'distrusting foreigners' },
  riskTolerance: { high: 'bold gambits', low: 'cautious moves' },
  grudgeRetention: { high: 'holding grudges', low: 'forgiving quickly' },
  honor: { high: 'keeping its word', low: 'breaking promises' },
};

/**
 * Pure "Known for: ..." tags from the STRONGEST axes (by distance from neutral 0.5), highest
 * first, capped at `MAX_TRAITS_SHOWN`. Confidence-gating (only show once the player has
 * evidence, doc 07 §9) is left to the caller.
 */
export function describePersonality(weights: Readonly<Record<PersonalityAxis, number>>): readonly string[] {
  const candidates: { phrase: string; strength: number }[] = [];
  for (const axis of PERSONALITY_AXES) {
    const value = weights[axis];
    const phrases = AXIS_PHRASES[axis];
    if (value >= HIGH_THRESHOLD && phrases.high !== undefined) {
      candidates.push({ phrase: phrases.high, strength: value - 0.5 });
    } else if (value <= LOW_THRESHOLD && phrases.low !== undefined) {
      candidates.push({ phrase: phrases.low, strength: 0.5 - value });
    }
  }
  return candidates
    .sort((a, b) => b.strength - a.strength)
    .slice(0, MAX_TRAITS_SHOWN)
    .map((c) => c.phrase);
}
