/**
 * ResourceDef + BuildingDef (roadmap M11/M13; doc 06 §1–§2 subset). M13 brings
 * the full 3-tier resource schema (category, hauling weight, spoilage decay)
 * and replaces the M11 `produces` placeholder with real recipes — inputs and
 * outputs in units/day (doc 06 §2 `Yield`; the sim batches hourly, doc 08 §4).
 * Costs and recipe yields reference resources by id — checked in database
 * integrity, not just shape.
 */
import { v, type Validator } from './validate.js';

export interface ResourceDef {
  readonly id: string;
  readonly name: string;
  readonly tier: 'raw' | 'processed' | 'finished';
  readonly category: 'food' | 'material' | 'military' | 'luxury';
  readonly basePrice: number;
  readonly weight: number; // hauling cost per unit (consumed by logistics, M14)
  readonly decay?: number; // fraction lost per day (food spoilage, doc 06 §1)
}

/** One resource flow inside a recipe, in units per in-game day. */
export interface Yield {
  readonly resource: string;
  readonly perDay: number;
}

export interface Recipe {
  readonly inputs: readonly Yield[];
  readonly outputs: readonly Yield[];
}

export interface BuildingDef {
  readonly id: string;
  readonly name: string;
  readonly category: 'civic' | 'housing' | 'service' | 'storage' | 'production' | 'military' | 'castle';
  readonly footprint: { readonly w: number; readonly h: number };
  readonly cost: Readonly<Record<string, number>>;
  readonly buildTicks: number;
  readonly terrainTags: readonly string[];
  /** Doc 06 Requirement subset — village tier gating arrives M15; tech gating M32. */
  readonly requires?: { readonly villageTier?: number };
  readonly housing?: { readonly capacity: number; readonly comfort: number };
  readonly serviceAura?: { readonly need: string; readonly strength: number; readonly radius: number };
  readonly storage?: { readonly capacity: number };
  readonly recipes?: readonly Recipe[];
  readonly workers?: { readonly required: number };
  /** M25: which unit defs this building can train (barracks); M28: garrisonCap caps how
   * many troops the village can shelter as defenders (keeps/towers — no recruits of their
   * own). doc 06 §2; drillRate (training-quality) stays deferred. */
  readonly military?: { readonly recruits?: readonly string[]; readonly garrisonCap?: number };
  /** M28: wall/gate/tower/keep segments (doc 06 §2). `kind` feeds the defence graph
   * and enclosure algorithm (game/castles.ts); `rangedArc` (inert since M29) is consumed by
   * the M51 spatial assault — tower fire on the storming column. `holdStrength` (M51, keeps
   * only): the surviving attacker strength required at the keep to take the castle. */
  readonly defense?: {
    readonly hp: number;
    readonly armor: number;
    readonly kind: 'wall' | 'gate' | 'tower' | 'keep';
    readonly rangedArc?: { readonly range: number; readonly damage: number };
    readonly holdStrength?: number;
  };
  /** M32: scholar buildings (scribe's hut → library → university, GDD §9) generate
   * research points daily; game/research.ts sums this across a kingdom's completed,
   * owned buildings. No workforce-efficiency gating yet (v1: flat per-building rate,
   * same simplification precedent as serviceAura's flat strength). */
  readonly research?: { readonly pointsPerDay: number };
  readonly tags: readonly string[];
}

export const resourceValidator: Validator<ResourceDef> = v.object(
  {
    id: v.id(),
    name: v.string({ minLength: 1 }),
    tier: v.literal('raw', 'processed', 'finished'),
    category: v.literal('food', 'material', 'military', 'luxury'),
    basePrice: v.number({ min: 0 }),
    weight: v.number({ min: 0 }),
    decay: v.number({ min: 0, max: 1 }),
  },
  { optional: ['decay'] },
) as Validator<ResourceDef>;

const costValidator: Validator<Record<string, number>> = (value, path, errors, file) => {
  const record = v.record()(value, path, errors, file);
  const out: Record<string, number> = {};
  for (const [key, amount] of Object.entries(record ?? {})) {
    v.id()(key, `${path}.${key} (key)`, errors, file);
    out[key] = v.number({ min: 1 })(amount, `${path}.${key}`, errors, file);
  }
  return out;
};

const yieldValidator: Validator<Yield> = v.object({
  resource: v.id(),
  perDay: v.number({ min: 0 }),
}) as Validator<Yield>;

const recipeValidator: Validator<Recipe> = v.object({
  inputs: v.array(yieldValidator),
  outputs: v.array(yieldValidator, { minItems: 1 }),
}) as Validator<Recipe>;

const defenseValidator = v.object(
  {
    hp: v.number({ min: 1 }),
    armor: v.number({ min: 0 }),
    kind: v.literal('wall', 'gate', 'tower', 'keep'),
    rangedArc: v.object({ range: v.number({ min: 1 }), damage: v.number({ min: 0 }) }),
    holdStrength: v.number({ min: 0 }),
  },
  { optional: ['rangedArc', 'holdStrength'] },
);

export const buildingValidator: Validator<BuildingDef> = v.object(
  {
    id: v.id(),
    name: v.string({ minLength: 1 }),
    category: v.literal('civic', 'housing', 'service', 'storage', 'production', 'military', 'castle'),
    footprint: v.object({ w: v.number({ min: 1, max: 8, integer: true }), h: v.number({ min: 1, max: 8, integer: true }) }),
    cost: costValidator,
    buildTicks: v.number({ min: 1, integer: true }),
    terrainTags: v.array(v.string({ minLength: 1 }), { minItems: 1 }),
    requires: v.object({ villageTier: v.number({ min: 1, max: 4, integer: true }) }, { optional: ['villageTier'] }),
    housing: v.object({ capacity: v.number({ min: 1, integer: true }), comfort: v.number({ min: 0 }) }),
    serviceAura: v.object({ need: v.string({ minLength: 1 }), strength: v.number({ min: 0 }), radius: v.number({ min: 1, integer: true }) }),
    storage: v.object({ capacity: v.number({ min: 1, integer: true }) }),
    recipes: v.array(recipeValidator, { minItems: 1 }),
    workers: v.object({ required: v.number({ min: 1, integer: true }) }),
    military: v.object(
      { recruits: v.array(v.id(), { minItems: 1 }), garrisonCap: v.number({ min: 1, integer: true }) },
      { optional: ['recruits', 'garrisonCap'] },
    ),
    defense: defenseValidator as unknown as Validator<BuildingDef['defense']>,
    research: v.object({ pointsPerDay: v.number({ min: 0 }) }),
    tags: v.array(v.string({ minLength: 1 })),
  },
  { optional: ['requires', 'housing', 'serviceAura', 'storage', 'recipes', 'workers', 'military', 'defense', 'research'] },
) as Validator<BuildingDef>;
