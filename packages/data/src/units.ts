/**
 * UnitDef (roadmap M25; GDD §6; doc 06 §3). M25 "basics" scope: raise, cost,
 * and sustain a unit. `stats.moraleBase` and `counters` activate with Combat
 * (M27, game/combat.ts); training-quality, equipment tiers, and abilities are
 * doc 06 §3's fuller shape and stay inert content past that. `cost` folds the
 * doc's separate `equipment` list into one resource map (mirrors
 * BuildingDef.cost — one flat resource ledger, not two).
 */
import { v, type Validator } from './validate.js';

export interface UnitDef {
  readonly id: string;
  readonly name: string;
  readonly class: 'infantry' | 'ranged' | 'cavalry' | 'siege' | 'support';
  readonly stats: {
    readonly attack: number;
    readonly defense: number;
    readonly hp: number;
    readonly speed: number;
    readonly moraleBase: number; // starting/ceiling morale (M27: combat's "true HP", GDD §8)
  };
  /** Soft counters (M27, GDD §6 "clear but soft"): multiplier on this unit's attack
   * vs. the named enemy class, e.g. `{ cavalry: 1.4 }` for a spear line. Missing
   * entries default to 1 (no counter). */
  readonly counters?: Readonly<Partial<Record<UnitDef['class'], number>>>;
  readonly cost: Readonly<Record<string, number>>; // one-time resource cost (equipment)
  readonly costGold: number; // one-time gold cost to recruit
  readonly upkeepGold: number; // gold per season, paid from the kingdom treasury
  readonly upkeepFood: number; // food per season, paid from the home village stockpile
  readonly recruitTicks: number; // ticks in training before the unit joins active service
  readonly popCost: { readonly cohort: 'child' | 'adult' | 'elder'; readonly count: number };
  readonly tags: readonly string[];
}

export const UNIT_CLASSES = ['infantry', 'ranged', 'cavalry', 'siege', 'support'] as const;

const costValidator: Validator<Record<string, number>> = (value, path, errors, file) => {
  const record = v.record()(value, path, errors, file);
  const out: Record<string, number> = {};
  for (const [key, amount] of Object.entries(record ?? {})) {
    v.id()(key, `${path}.${key} (key)`, errors, file);
    out[key] = v.number({ min: 1 })(amount, `${path}.${key}`, errors, file);
  }
  return out;
};

const countersValidator: Validator<Partial<Record<UnitDef['class'], number>>> = v.object(
  Object.fromEntries(UNIT_CLASSES.map((c) => [c, v.number({ min: 0.1, max: 3 })])),
  { optional: [...UNIT_CLASSES] },
) as Validator<Partial<Record<UnitDef['class'], number>>>;

export const unitValidator: Validator<UnitDef> = v.object(
  {
    id: v.id(),
    name: v.string({ minLength: 1 }),
    class: v.literal(...UNIT_CLASSES),
    stats: v.object({
      attack: v.number({ min: 0 }),
      defense: v.number({ min: 0 }),
      hp: v.number({ min: 1 }),
      speed: v.number({ min: 0 }),
      moraleBase: v.number({ min: 1, max: 100 }),
    }),
    counters: countersValidator,
    cost: costValidator,
    costGold: v.number({ min: 0 }),
    upkeepGold: v.number({ min: 0 }),
    upkeepFood: v.number({ min: 0 }),
    recruitTicks: v.number({ min: 1, integer: true }),
    popCost: v.object({
      cohort: v.literal('child', 'adult', 'elder'),
      count: v.number({ min: 1, integer: true }),
    }),
    tags: v.array(v.string({ minLength: 1 })),
  },
  { optional: ['counters'] },
) as Validator<UnitDef>;
