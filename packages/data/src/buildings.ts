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
  readonly category: 'civic' | 'housing' | 'service' | 'storage' | 'production' | 'military';
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

export const buildingValidator: Validator<BuildingDef> = v.object(
  {
    id: v.id(),
    name: v.string({ minLength: 1 }),
    category: v.literal('civic', 'housing', 'service', 'storage', 'production', 'military'),
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
    tags: v.array(v.string({ minLength: 1 })),
  },
  { optional: ['requires', 'housing', 'serviceAura', 'storage', 'recipes', 'workers'] },
) as Validator<BuildingDef>;
