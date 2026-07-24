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
import { BASE_STORAGE, KEEP_FOOD_BUFFER } from '../game/economy.js';

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
  // M47.8 (doc 12 R1): `productionCapacity` is DECLARED recipe output — on real worldgen
  // terrain, biome modifiers and staffing make REALIZED output lower, so a village could
  // "satisfy" this need on paper while slowly starving (the M46 open finding, root-caused
  // by the real-composition balance matrix). The foodSecurity EMA is the realized truth:
  // when the village is actually under-fed, the need is real no matter the nameplate —
  // BUT only if no relief is already under way: without the under-construction check, a
  // security dip queued 40+ farms in days, whose SITES then consumed every adult as
  // builders and starved the fields entirely (the matrix probe's own death spiral).
  // Pending relief counts: sites already queued contribute their declared output to the
  // ratio, so the manager builds ONE farm and waits for it rather than queuing a new site
  // every day while the first is still scaffolding (the 50-site pileup the matrix probe hit).
  const candidates = ['base:building.farm', 'base:building.dock'];
  const b = ctx.world.read(ctx.comps.BuildingCore);
  let underConstruction = 0;
  let pendingOutput = 0;
  ctx.world.query([ctx.comps.BuildingCore]).forEach((i) => {
    if (((b.village[i] as number) & 0x3fffff) !== ctx.villageIndex) return;
    if ((b.complete[i] as number) === 1) return;
    const def = ctx.ops.buildingDef(b.def[i] as number);
    if (!candidates.includes(def.id)) return;
    underConstruction++;
    for (const recipe of def.recipes ?? []) {
      for (const output of recipe.outputs) {
        if (output.resource === 'base:resource.food') pendingOutput += output.perDay;
      }
    }
  });
  const withPending = desired <= 0 ? 1 : (actual + pendingOutput) / desired;
  const security = ctx.world.read(ctx.popGame.Population).foodSecurity[ctx.villageIndex] as number;
  const ratio = underConstruction === 0 && security < 0.95 ? Math.min(withPending, security) : withPending;
  return { kind: 'food', ratio, candidates };
};

export const housingNeed: NeedEvaluator = (ctx) => {
  const population = ctx.popGame.totalOf(ctx.villageIndex);
  if (population <= 0) return null;
  const desired = population * NEED_SLACK;
  const actual = housingCapacity(ctx);
  return { kind: 'housing', ratio: desired <= 0 ? 1 : actual / desired, candidates: ['base:building.house'] };
};

/**
 * M47.8 (doc 12 R1 "free-tools genesis crutch removed via one AI-built production chain"):
 * once a village has hands to spare, it raises the wood→planks→tools chain — the equipment
 * source recruitment (M25) actually consumes. Ratio = chain completeness (0/3..3/3), so
 * chooseBuildTarget naturally prioritises whichever link is missing, in dependency order.
 * NOT in DEFAULT_NEED_EVALUATORS: the M20-M46 harness tests were recorded with two evaluators
 * (their own scoping note) — the unified campaign passes this explicitly.
 */
export const industryNeed: NeedEvaluator = (ctx) => {
  const population = ctx.popGame.totalOf(ctx.villageIndex);
  if (population < 25) return null; // subsistence first — don't starve the farms for a workshop
  const b = ctx.world.read(ctx.comps.BuildingCore);
  const chain = ['base:building.lumber-camp', 'base:building.sawmill', 'base:building.workshop'];
  const built = new Set<string>();
  ctx.world.query([ctx.comps.BuildingCore]).forEach((i) => {
    if (((b.village[i] as number) & 0x3fffff) !== ctx.villageIndex) return;
    const id = ctx.ops.buildingDef(b.def[i] as number).id;
    if (chain.includes(id)) built.add(id); // in-progress counts — don't queue duplicates
  });
  if (built.size >= chain.length) return null;
  return {
    kind: 'industry',
    ratio: built.size / chain.length,
    candidates: chain.filter((id) => !built.has(id)),
  };
};

// ---------------------------------------------------------------- M-era: economy-depth needs
// Three additions that close the "AI only ever builds farm/house/industry, then goes silent"
// coverage gap (granary + quarry were STRUCTURALLY unreachable — no evaluator ever named them).
// Each mirrors industryNeed's shape and is passed explicitly by the campaign (never in
// DEFAULT_NEED_EVALUATORS, which the M20-M46 harness pins to two evaluators). Population floors
// keep amenities from ever out-competing subsistence; chooseBuildTarget's ratio-sort does the rest.

export const STORAGE_MIN_POP = 20;
/** Build more storage once ANY good passes this fraction of its village cap (spoilage/outbox-stall). */
export const STORAGE_TRIGGER = 0.85;

/**
 * M-era: a granary once the stockpile is filling up — the AI's cap was otherwise pinned at
 * BASE_STORAGE forever (granary was the only storage building and no evaluator named it). Cap per
 * resource mirrors economy.ts exactly: food draws on the small keep larder, everything else on
 * BASE_STORAGE, both raised by the pooled storage.capacity of complete buildings.
 */
export const storageNeed: NeedEvaluator = (ctx) => {
  const population = ctx.popGame.totalOf(ctx.villageIndex);
  if (population < STORAGE_MIN_POP) return null;
  const stock = ctx.world.readObj(ctx.comps.Stockpile).tryGet(ctx.villageIndex);
  if (stock === undefined) return null;
  const b = ctx.world.read(ctx.comps.BuildingCore);
  let extra = 0;
  ctx.world.query([ctx.comps.BuildingCore]).forEach((i) => {
    if (((b.village[i] as number) & 0x3fffff) !== ctx.villageIndex) return;
    if ((b.complete[i] as number) !== 1) return;
    extra += ctx.ops.buildingDef(b.def[i] as number).storage?.capacity ?? 0;
  });
  const foodCode = ctx.ops.resourceCode('base:resource.food') as number;
  let maxUtil = 0;
  for (const [code, held] of stock) {
    const cap = (code === foodCode ? KEEP_FOOD_BUFFER : BASE_STORAGE) + extra;
    if (cap > 0) maxUtil = Math.max(maxUtil, held / cap);
  }
  if (maxUtil < STORAGE_TRIGGER) return null; // ample headroom — no granary wanted yet
  return { kind: 'storage', ratio: 1 - Math.min(1, maxUtil), candidates: ['base:building.granary'] };
};

export const STONE_MIN_POP = 12;
/** Fixed urgency for a stoneless village's first quarry — moderate, so famine (ratio→0) still wins. */
export const STONE_NEED_RATIO = 0.4;

/**
 * M-era: the first quarry, built early — the quarry is the ONLY stone source, so an AI that never
 * built one could never regenerate stone and eventually stalled every stone-costing build (barracks,
 * tier upgrade, defence). It fires the moment the village has no stone source at all (regardless of
 * how fat the starting pile is), because that starting stone is finite and never refills. The ratio
 * is a fixed, moderate 0.4: urgent enough to secure permanent stone income near genesis, but still
 * above a starving food/housing need (ratio→0) so it never rushes a quarry ahead of survival. Fires
 * at most once (productionCapacity > 0 afterwards).
 */
export const stoneNeed: NeedEvaluator = (ctx) => {
  const population = ctx.popGame.totalOf(ctx.villageIndex);
  if (population < STONE_MIN_POP) return null;
  if (productionCapacity(ctx, 'base:resource.stone') > 0) return null; // already mines stone
  return { kind: 'stone', ratio: STONE_NEED_RATIO, candidates: ['base:building.quarry'] };
};

export const SERVICE_MIN_POP = 25;
/** Happiness the AI builds services toward — comfortably above the tier-2 upgrade gate (60). */
export const SERVICE_TARGET = 65;

/**
 * M-era: a well then a tavern while happiness sits below the comfort target — joy drives growth
 * AND gates the tier-2 upgrade, so amenities compound. Each is built at most once (like
 * industryNeed's chain), so the joy aura climbs toward its cap (SERVICE_JOY_CAP) without spamming
 * amenities past the point they help. Well first: cheap, stone-only; tavern needs planks from the
 * industry chain, so it naturally follows once that chain exists.
 */
export const serviceNeed: NeedEvaluator = (ctx) => {
  const population = ctx.popGame.totalOf(ctx.villageIndex);
  if (population < SERVICE_MIN_POP) return null;
  const happiness = ctx.world.read(ctx.popGame.Population).happiness[ctx.villageIndex] as number;
  if (happiness >= SERVICE_TARGET) return null;
  const services = ['base:building.well', 'base:building.tavern'];
  const b = ctx.world.read(ctx.comps.BuildingCore);
  const built = new Set<string>();
  ctx.world.query([ctx.comps.BuildingCore]).forEach((i) => {
    if (((b.village[i] as number) & 0x3fffff) !== ctx.villageIndex) return;
    const id = ctx.ops.buildingDef(b.def[i] as number).id;
    if (services.includes(id)) built.add(id); // in-progress counts — don't double-queue
  });
  const remaining = services.filter((id) => !built.has(id));
  if (remaining.length === 0) return null;
  return { kind: 'service', ratio: happiness / SERVICE_TARGET, candidates: remaining };
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
