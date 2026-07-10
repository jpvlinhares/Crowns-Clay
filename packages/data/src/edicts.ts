/**
 * EdictDef (roadmap M16; GDD §2; doc 06 content kinds). Edicts are Modifier
 * bundles with a daily gold upkeep — "all numbers flow through Modifiers"
 * (doc 06 design intent), so tooltips, AI, and mods see one effect system.
 *
 * v1 stat paths are the ones the sim actually consumes (typos are validation
 * errors, not silent no-ops); the set grows as systems land (tech M32 reuses
 * this shape).
 */
import { v, type Validator } from './validate.js';

export const MODIFIER_TARGETS = [
  'village.happinessDrift', // add: daily happiness target shift
  'village.productionEfficiency', // mul: workforce efficiency multiplier
  'village.spoilage', // mul: decay-rate multiplier
  'kingdom.taxYield', // mul: tax income multiplier
  'kingdom.researchYield', // mul: research point accrual multiplier (M32, Scholar office)
] as const;

export type ModifierTarget = (typeof MODIFIER_TARGETS)[number];

export interface ModifierDef {
  readonly target: ModifierTarget;
  readonly op: 'add' | 'mul';
  readonly value: number;
}

export interface EdictDef {
  readonly id: string;
  readonly name: string;
  readonly upkeep: number; // gold per day
  readonly modifiers: readonly ModifierDef[];
  readonly tags?: readonly string[];
}

const modifierValidator: Validator<ModifierDef> = v.object({
  target: v.literal(...MODIFIER_TARGETS),
  op: v.literal('add', 'mul'),
  value: v.number({ min: -100, max: 100 }),
}) as Validator<ModifierDef>;

export const edictValidator: Validator<EdictDef> = v.object(
  {
    id: v.id(),
    name: v.string({ minLength: 1 }),
    upkeep: v.number({ min: 0 }),
    modifiers: v.array(modifierValidator, { minItems: 1 }),
    tags: v.array(v.string({ minLength: 1 })),
  },
  { optional: ['tags'] },
) as Validator<EdictDef>;
