/**
 * Settlement needs (roadmap M20; doc 07 §5 "need detection"). A need is a
 * capacity ratio (actual/desired) plus a preference-ordered list of building
 * defs that would satisfy it. `chooseBuildTarget` (manager.ts) consumes a
 * list of these generically — food and housing are the first two
 * evaluators, but storage, production-chain bottlenecks, logistics, or any
 * future need is just another `NeedEvaluator` added to the list; nothing
 * else in the construction pipeline has to change.
 */
import type { DefinitionDatabase } from '@crowns/data';
import type { World } from '../ecs.js';
import type { VillageComponents, VillageOps } from '../game/villages.js';
import type { PopulationGameplay } from '../game/population.js';
import { FOOD_PER_PERSON_DAY } from '../game/population.js';

/** A 10% buffer so the manager builds ahead of the wire, not right at it. */
const NEED_SLACK = 1.1;

export interface SettlementNeed {
  readonly kind: string; // 'food' | 'housing' | future kinds
  /** actual/desired capacity; < 1 means under-provisioned, the sort key. */
  readonly ratio: number;
  /** Building def ids that would help, in preference order. */
  readonly candidates: readonly string[];
}

export type NeedEvaluator = (ctx: NeedContext) => SettlementNeed | null;

export interface NeedContext {
  readonly world: World;
  readonly comps: VillageComponents;
  readonly ops: VillageOps;
  readonly popGame: PopulationGameplay;
  readonly db: DefinitionDatabase;
  /** Dense entity index of the village (`entity & 0x3fffff`). */
  readonly villageIndex: number;
}

/** Sum of `recipes[].outputs[].perDay` for `resourceId`, over complete buildings of this village. */
export function productionCapacity(ctx: NeedContext, resourceId: string): number {
  const b = ctx.world.read(ctx.comps.BuildingCore);
  let total = 0;
  ctx.world.query([ctx.comps.BuildingCore]).forEach((i) => {
    if (((b.village[i] as number) & 0x3fffff) !== ctx.villageIndex) return;
    if ((b.complete[i] as number) !== 1) return;
    const def = ctx.ops.buildingDef(b.def[i] as number);
    for (const recipe of def.recipes ?? []) {
      for (const output of recipe.outputs) {
        if (output.resource === resourceId) total += output.perDay;
      }
    }
  });
  return total;
}

/** Sum of `housing.capacity` over complete buildings of this village. */
export function housingCapacity(ctx: NeedContext): number {
  const b = ctx.world.read(ctx.comps.BuildingCore);
  let total = 0;
  ctx.world.query([ctx.comps.BuildingCore]).forEach((i) => {
    if (((b.village[i] as number) & 0x3fffff) !== ctx.villageIndex) return;
    if ((b.complete[i] as number) !== 1) return;
    total += ctx.ops.buildingDef(b.def[i] as number).housing?.capacity ?? 0;
  });
  return total;
}

export const foodNeed: NeedEvaluator = (ctx) => {
  const population = ctx.popGame.totalOf(ctx.villageIndex);
  if (population <= 0) return null;
  const desired = population * FOOD_PER_PERSON_DAY * NEED_SLACK;
  const actual = productionCapacity(ctx, 'base:resource.food');
  return { kind: 'food', ratio: desired <= 0 ? 1 : actual / desired, candidates: ['base:building.farm', 'base:building.dock'] };
};

export const housingNeed: NeedEvaluator = (ctx) => {
  const population = ctx.popGame.totalOf(ctx.villageIndex);
  if (population <= 0) return null;
  const desired = population * NEED_SLACK;
  const actual = housingCapacity(ctx);
  return { kind: 'housing', ratio: desired <= 0 ? 1 : actual / desired, candidates: ['base:building.house'] };
};

export const DEFAULT_NEED_EVALUATORS: readonly NeedEvaluator[] = [foodNeed, housingNeed];

export function detectNeeds(ctx: NeedContext, evaluators: readonly NeedEvaluator[] = DEFAULT_NEED_EVALUATORS): SettlementNeed[] {
  const needs: SettlementNeed[] = [];
  for (const evaluate of evaluators) {
    const need = evaluate(ctx);
    if (need !== null) needs.push(need);
  }
  return needs;
}
