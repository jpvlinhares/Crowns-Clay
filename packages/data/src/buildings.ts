/**
 * ResourceDef + BuildingDef (roadmap M11; doc 06 §1–§2 subset). `produces` is
 * the M11 placeholder for full recipes (inputs arrive with chains at M13);
 * `workers` coupling arrives with population (M12). Costs reference resources
 * by id — checked in database integrity, not just shape.
 */
import { v, type Validator } from './validate.js';

export interface ResourceDef {
  readonly id: string;
  readonly name: string;
  readonly tier: 'raw' | 'processed' | 'finished';
  readonly basePrice: number;
}

export interface BuildingDef {
  readonly id: string;
  readonly name: string;
  readonly category: 'civic' | 'housing' | 'service' | 'storage' | 'production' | 'military';
  readonly footprint: { readonly w: number; readonly h: number };
  readonly cost: Readonly<Record<string, number>>;
  readonly buildTicks: number;
  readonly terrainTags: readonly string[];
  readonly housing?: { readonly capacity: number; readonly comfort: number };
  readonly serviceAura?: { readonly need: string; readonly strength: number; readonly radius: number };
  readonly storage?: { readonly capacity: number };
  readonly produces?: { readonly resource: string; readonly perDay: number };
  readonly workers?: { readonly required: number };
  readonly tags: readonly string[];
}

export const resourceValidator: Validator<ResourceDef> = v.object({
  id: v.id(),
  name: v.string({ minLength: 1 }),
  tier: v.literal('raw', 'processed', 'finished'),
  basePrice: v.number({ min: 0 }),
}) as Validator<ResourceDef>;

const costValidator: Validator<Record<string, number>> = (value, path, errors, file) => {
  const record = v.record()(value, path, errors, file);
  const out: Record<string, number> = {};
  for (const [key, amount] of Object.entries(record ?? {})) {
    v.id()(key, `${path}.${key} (key)`, errors, file);
    out[key] = v.number({ min: 1 })(amount, `${path}.${key}`, errors, file);
  }
  return out;
};

export const buildingValidator: Validator<BuildingDef> = v.object(
  {
    id: v.id(),
    name: v.string({ minLength: 1 }),
    category: v.literal('civic', 'housing', 'service', 'storage', 'production', 'military'),
    footprint: v.object({ w: v.number({ min: 1, max: 8, integer: true }), h: v.number({ min: 1, max: 8, integer: true }) }),
    cost: costValidator,
    buildTicks: v.number({ min: 1, integer: true }),
    terrainTags: v.array(v.string({ minLength: 1 }), { minItems: 1 }),
    housing: v.object({ capacity: v.number({ min: 1, integer: true }), comfort: v.number({ min: 0 }) }),
    serviceAura: v.object({ need: v.string({ minLength: 1 }), strength: v.number({ min: 0 }), radius: v.number({ min: 1, integer: true }) }),
    storage: v.object({ capacity: v.number({ min: 1, integer: true }) }),
    produces: v.object({ resource: v.id(), perDay: v.number({ min: 0 }) }),
    workers: v.object({ required: v.number({ min: 1, integer: true }) }),
    tags: v.array(v.string({ minLength: 1 })),
  },
  { optional: ['housing', 'serviceAura', 'storage', 'produces', 'workers'] },
) as Validator<BuildingDef>;
