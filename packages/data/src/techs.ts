/**
 * TechDef (roadmap M32; GDD §9; doc 06 §8). A data-defined DAG of ~60-80 nodes
 * across four branches, gated by tier (1..5) and era (early/high/late) —
 * `unlocks` reuses `BuildingDef`/`UnitDef`/`EdictDef` ids directly (no new
 * unlock-flag type) and `modifiers` reuses edicts.ts's `ModifierDef` shape
 * verbatim ("tech M32 reuses this shape", edicts.ts's own module comment).
 *
 * DAG shape is validated at load time (terrain.ts's `DefinitionDatabase`,
 * alongside the existing cross-kind referential checks): prerequisites must
 * reference real techs, tier/era must be monotonically non-decreasing along
 * every prerequisite edge (a tech can't require a LATER tech), and the
 * prerequisite graph must be acyclic — the roadmap's "DAG validation" T
 * objective. `unlocks` are validated referentially (must name real building/
 * unit/edict ids) but enforcement — actually gating placement/recruitment on
 * `techsKnown` — stays deferred, the same "data now, active later" precedent
 * M25 set for `BuildingDef.military.garrisonCap`.
 */
import { v, type Validator } from './validate.js';
import { MODIFIER_TARGETS, type ModifierDef } from './edicts.js';

export const TECH_BRANCHES = ['agriculture', 'construction', 'warfare', 'statecraft'] as const;
export type TechBranch = (typeof TECH_BRANCHES)[number];

/** Ordered early → late; index comparison is how DAG validation and era-gating
 * both check "not later than" (doc 06 §8's era, GDD §9's era gates). */
export const ERA_ORDER = ['early', 'high', 'late'] as const;
export type Era = (typeof ERA_ORDER)[number];

export interface TechUnlocks {
  readonly buildings?: readonly string[];
  readonly units?: readonly string[];
  readonly edicts?: readonly string[];
  readonly wallTier?: number;
}

export interface TechDef {
  readonly id: string;
  readonly name: string;
  readonly desc: string;
  readonly branch: TechBranch;
  readonly tier: number; // 1..5
  readonly era: Era;
  readonly cost: number; // research points
  readonly prerequisites: readonly string[];
  readonly unlocks?: TechUnlocks;
  readonly modifiers?: readonly ModifierDef[];
  readonly diffusionDiscount: number; // 0..1: fraction off cost once a known neighbour has it (GDD §9 catch-up)
  readonly tags: readonly string[];
}

const modifierValidator: Validator<ModifierDef> = v.object({
  target: v.literal(...MODIFIER_TARGETS),
  op: v.literal('add', 'mul'),
  value: v.number({ min: -100, max: 100 }),
}) as Validator<ModifierDef>;

const unlocksValidator: Validator<TechUnlocks> = v.object(
  {
    buildings: v.array(v.id(), { minItems: 1 }),
    units: v.array(v.id(), { minItems: 1 }),
    edicts: v.array(v.id(), { minItems: 1 }),
    wallTier: v.number({ min: 1, max: 3, integer: true }),
  },
  { optional: ['buildings', 'units', 'edicts', 'wallTier'] },
) as Validator<TechUnlocks>;

export const techValidator: Validator<TechDef> = v.object(
  {
    id: v.id(),
    name: v.string({ minLength: 1 }),
    desc: v.string({ minLength: 1 }),
    branch: v.literal(...TECH_BRANCHES),
    tier: v.number({ min: 1, max: 5, integer: true }),
    era: v.literal(...ERA_ORDER),
    cost: v.number({ min: 1 }),
    prerequisites: v.array(v.id()),
    unlocks: unlocksValidator,
    modifiers: v.array(modifierValidator, { minItems: 1 }),
    diffusionDiscount: v.number({ min: 0, max: 1 }),
    tags: v.array(v.string({ minLength: 1 })),
  },
  { optional: ['unlocks', 'modifiers'] },
) as Validator<TechDef>;
