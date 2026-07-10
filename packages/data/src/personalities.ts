/**
 * AIPersonalityDef (roadmap M36; GDD §11; doc 06 §7; doc 07 §9). Content, not
 * code — the same "one effect system, tooltips/AI/mods all see it" reasoning
 * edicts.ts states for its own shape. `weights` are the 8 axes doc 06 §7
 * defines; `planBiases` are per-`PlanArchetype` multipliers (ai/planner.ts) —
 * this is the ONLY way this package touches AI behaviour, since data/ never
 * depends on sim/ (TDD §3). `favoredVictory` stays a freeform tag (no
 * `VictoryType` enum exists until M37) and `taunts`/`voiceSet` drop
 * `LocalizedText` for flat strings (no locale system until M44) — both the
 * same "ship the real shape once its dependency lands" pattern M32/M33 used.
 */
import { v, type Validator } from './validate.js';

export const PERSONALITY_AXES = [
  'expansion', 'aggression', 'economy', 'tech', 'diplomacyTrust', 'riskTolerance', 'grudgeRetention', 'honor',
] as const;
export type PersonalityAxis = (typeof PERSONALITY_AXES)[number];

export interface AIPersonalityDef {
  readonly id: string;
  readonly name: string;
  readonly desc: string;
  readonly weights: Readonly<Record<PersonalityAxis, number>>; // 0..1 each
  readonly preferences: {
    readonly favoredVictory: readonly string[]; // freeform tags (GDD §16 victory names) — M37 unwired
    readonly favoredUnits: readonly string[]; // unit class/tag preference, flavour + future AI hook
    readonly buildStyle: readonly string[]; // freeform tags
    readonly insultThreshold: number; // -100..100: opinion below which this personality favours insults over talk
    readonly giftReceptivity: number; // 0..2: how much a gift's opinion effect lands, from this personality's view
  };
  readonly planBiases: Readonly<Record<string, number>>; // PlanArchetype id -> utility multiplier (default 1)
  readonly taunts: Readonly<Record<string, readonly string[]>>; // trigger tag -> flavour lines
  readonly tags: readonly string[];
}

const weightsValidator: Validator<Record<PersonalityAxis, number>> = v.object(
  Object.fromEntries(PERSONALITY_AXES.map((a) => [a, v.number({ min: 0, max: 1 })])),
) as Validator<Record<PersonalityAxis, number>>;

const planBiasesValidator: Validator<Record<string, number>> = (value, path, errors, file) => {
  const record = v.record()(value, path, errors, file);
  const out: Record<string, number> = {};
  // keys are PlanArchetype ids ('DevelopHeartland', ...) — not namespaced content ids, so v.id() doesn't apply
  for (const [key, mult] of Object.entries(record ?? {})) {
    out[key] = v.number({ min: 0, max: 3 })(mult, `${path}.${key}`, errors, file);
  }
  return out;
};

const tauntsValidator: Validator<Record<string, readonly string[]>> = (value, path, errors, file) => {
  const record = v.record()(value, path, errors, file);
  const out: Record<string, readonly string[]> = {};
  for (const [key, lines] of Object.entries(record ?? {})) {
    out[key] = v.array(v.string({ minLength: 1 }), { minItems: 1 })(lines, `${path}.${key}`, errors, file);
  }
  return out;
};

export const personalityValidator: Validator<AIPersonalityDef> = v.object({
  id: v.id(),
  name: v.string({ minLength: 1 }),
  desc: v.string({ minLength: 1 }),
  weights: weightsValidator,
  preferences: v.object({
    favoredVictory: v.array(v.string({ minLength: 1 })),
    favoredUnits: v.array(v.string({ minLength: 1 })),
    buildStyle: v.array(v.string({ minLength: 1 })),
    insultThreshold: v.number({ min: -100, max: 100 }),
    giftReceptivity: v.number({ min: 0, max: 2 }),
  }),
  planBiases: planBiasesValidator,
  taunts: tauntsValidator,
  tags: v.array(v.string({ minLength: 1 })),
}) as Validator<AIPersonalityDef>;
