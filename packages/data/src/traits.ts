/**
 * TraitDef (roadmap M34; GDD §15 "dynasty growth"; doc 06 §6 `Character.traits`).
 *
 * A trait is a small, fixed bundle of skill deltas ("brave" +martial,
 * "greedy" +stewardship/-diplomacy, ...) — deliberately NOT routed through
 * edicts.ts's kingdom-wide `ModifierDef`/`StatModifiers` board: a trait
 * belongs to one notable, not the realm, so game/characters.ts applies its
 * `skillModifiers` directly to that character's stored skill fields once, at
 * assignment time (clamped 0..20) — the existing office-bonus math in
 * game/kingdom.ts (Steward/Marshal/Chancellor/Scholar) then reads those
 * fields exactly as it always has, with zero changes to that module.
 */
import { v, type Validator } from './validate.js';

export const SKILL_NAMES = ['stewardship', 'martial', 'diplomacy', 'scholarship'] as const;
export type SkillName = (typeof SKILL_NAMES)[number];

export interface TraitDef {
  readonly id: string;
  readonly name: string;
  readonly desc: string;
  readonly skillModifiers: Readonly<Partial<Record<SkillName, number>>>;
  readonly tags: readonly string[];
}

const skillModifiersValidator: Validator<Partial<Record<SkillName, number>>> = v.object(
  Object.fromEntries(SKILL_NAMES.map((s) => [s, v.number({ min: -5, max: 5, integer: true })])),
  { optional: [...SKILL_NAMES] },
) as Validator<Partial<Record<SkillName, number>>>;

export const traitValidator: Validator<TraitDef> = v.object({
  id: v.id(),
  name: v.string({ minLength: 1 }),
  desc: v.string({ minLength: 1 }),
  skillModifiers: skillModifiersValidator,
  tags: v.array(v.string({ minLength: 1 })),
}) as Validator<TraitDef>;
