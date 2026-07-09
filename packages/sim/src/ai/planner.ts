/**
 * AI strategic planner v1 (roadmap M21; doc 07 §2). Weekly (doc 08 §9): score
 * plan archetypes from considerations × personality weights, apply
 * hysteresis (a bonus for staying on the current plan) to argmax-select the
 * major plan, bridge the choice into M20's construction manager
 * (`planAwareNeeds`) and M15's settler dispatch, and publish a decision-log
 * event every week so "why this plan?" is always answerable (doc 13 R1).
 *
 * Only 3 archetypes ship: DevelopHeartland, ExpandSettle, Recover — the rest
 * of doc 07 §2's list (ConquestWar, ForgeAlliance, TechRace, ...) needs
 * systems that don't exist yet (military M25, diplomacy M23, tech M32);
 * `DEFAULT_PLAN_ARCHETYPES` is an extensible array so those append later
 * without a rewrite, mirroring M20's `NeedEvaluator` list.
 *
 * `PersonalityWeights` here is a minimal in-code subset (not the content-
 * defined, mod-loadable `AIPersonalityDef` of doc 06 §7 — that full system,
 * with 7 tuned archetypes and perturbation, is M36).
 *
 * Standalone and single-village-bound, like M20: a village steering itself
 * needs no fog, so this doesn't touch M19's brain.ts/AiKingdom/Knowledge,
 * and it isn't wired into terra.ts/scenarios.ts (golden-fixture safety).
 */
import type { EntityId } from '@crowns/core';
import type { DefinitionDatabase } from '@crowns/data';
import { SoAComponent, World } from '../ecs.js';
import type { Kernel, SimSystem, TickContext } from '../kernel.js';
import { TICKS_PER_DAY } from '../time.js';
import type { VillageGameplay } from '../game/villages.js';
import type { PopulationGameplay } from '../game/population.js';
import { bestSiteNear, MIN_ADULTS_REMAINING, SETTLER_CARRY, SETTLER_PARTY } from '../game/settlers.js';
import { detectNeeds, DEFAULT_NEED_EVALUATORS, type NeedContext, type NeedEvaluator } from './needs.js';

const index = (id: number): number => id & 0x3fffff;
const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

// ---------------------------------------------------------------- personality (v1 subset)

export interface PersonalityWeights {
  readonly expansion: number; // 0..1
  readonly economy: number; // 0..1
  readonly riskTolerance: number; // 0..1
  /** How readily this kingdom trusts diplomatic overtures (M23); optional, defaults to 0.5. */
  readonly diplomacyTrust?: number; // 0..1
}

export const DEFAULT_PERSONALITY_WEIGHTS: PersonalityWeights = {
  expansion: 0.5,
  economy: 0.5,
  riskTolerance: 0.5,
  diplomacyTrust: 0.5,
};

// ---------------------------------------------------------------- considerations

export interface Considerations {
  readonly economyStrength: number; // realized welfare: avg(foodSecurity, happiness/100)
  readonly growthHeadroom: number; // unmet construction capacity, from detectNeeds
  readonly settleReadiness: number; // spare adults/cohorts/cargo for a settler party
  readonly crisisSignal: number; // 1 if actually starving/unhappy, else 0
  readonly allianceOpportunity: number; // 0..1: is there a known, non-hostile, not-yet-pacted foreign kingdom (M23)
}

const CRISIS_FOOD_SECURITY = 0.6;
const CRISIS_HAPPINESS = 30;
/** Below this opinion, a kingdom isn't considered an alliance candidate. */
const ALLIANCE_MIN_OPINION = -20;

/** Diplomacy context (M23) a planner reads to score `ForgeAlliance` — optional and additive;
 * omitted entirely by callers with no diplomacy wiring (M21's existing single-village tests). */
export interface AiDiplomacyContext {
  /** Foreign kingdoms this kingdom has discovered (M22 scouting). */
  knownKingdoms(): readonly EntityId[];
  opinionOf(target: EntityId): number;
  hasPact(target: EntityId, type: 'nonAggression' | 'trade'): boolean;
  /** Dense kingdom index (0..n-1) for a target — the `targetKingdom` field diplomacy.ts's
   * commands expect. */
  kingdomIndexOf(target: EntityId): number;
}

export function computeConsiderations(
  ctx: NeedContext,
  popGame: PopulationGameplay,
  diplomacy?: AiDiplomacyContext,
): Considerations {
  const pop = ctx.world.read(popGame.Population);
  const vi = ctx.villageIndex;
  const foodSecurity = pop.foodSecurity[vi] as number;
  const happiness = pop.happiness[vi] as number;

  const needs = detectNeeds(ctx);
  const foodRatio = needs.find((n) => n.kind === 'food')?.ratio ?? 0;
  const housingRatio = needs.find((n) => n.kind === 'housing')?.ratio ?? 0;

  const adults = pop.adults[vi] as number;
  const children = pop.children[vi] as number;
  const elders = pop.elders[vi] as number;
  const adultsSurplus = adults - (MIN_ADULTS_REMAINING + SETTLER_PARTY.adults);
  const cohortsOk = children >= SETTLER_PARTY.children && elders >= SETTLER_PARTY.elders;
  const stock = ctx.world.readObj(ctx.comps.Stockpile).tryGet(vi);
  const cargoOk = Object.entries(SETTLER_CARRY).every(
    ([resId, amount]) => (stock?.get(ctx.ops.resourceCode(resId) as number) ?? 0) >= amount,
  );

  let allianceOpportunity = 0;
  if (diplomacy !== undefined) {
    const candidates = diplomacy
      .knownKingdoms()
      .filter((k) => !diplomacy.hasPact(k, 'nonAggression') && diplomacy.opinionOf(k) > ALLIANCE_MIN_OPINION);
    if (candidates.length > 0) {
      const bestOpinion = Math.max(...candidates.map((k) => diplomacy.opinionOf(k)));
      allianceOpportunity = clamp01((bestOpinion + 100) / 200);
    }
  }

  return {
    economyStrength: clamp01((foodSecurity + happiness / 100) / 2),
    growthHeadroom: clamp01(1 - Math.min(foodRatio, housingRatio)),
    settleReadiness: cohortsOk && cargoOk ? clamp01(adultsSurplus / SETTLER_PARTY.adults) : 0,
    crisisSignal: foodSecurity < CRISIS_FOOD_SECURITY || happiness < CRISIS_HAPPINESS ? 1 : 0,
    allianceOpportunity,
  };
}

// ---------------------------------------------------------------- plan archetypes

export interface PlanArchetype {
  readonly id: string;
  utility(considerations: Considerations, weights: PersonalityWeights): number;
}

const developHeartland: PlanArchetype = {
  id: 'DevelopHeartland',
  utility: (c, w) => clamp01(w.economy * c.growthHeadroom + (1 - w.economy) * c.economyStrength * 0.3),
};

const expandSettle: PlanArchetype = {
  id: 'ExpandSettle',
  utility: (c, w) =>
    clamp01(w.expansion * c.settleReadiness * c.economyStrength - (1 - w.riskTolerance) * (1 - c.economyStrength) * 0.2),
};

const recover: PlanArchetype = {
  id: 'Recover',
  utility: (c) => c.crisisSignal,
};

/** M23: real now that diplomacy exists — inert (`allianceOpportunity` always 0) when no
 * `diplomacy` context is wired in (M21's existing single-village tests). */
const forgeAlliance: PlanArchetype = {
  id: 'ForgeAlliance',
  utility: (c, w) => clamp01((w.diplomacyTrust ?? 0.5) * c.allianceOpportunity),
};

export const DEFAULT_PLAN_ARCHETYPES: readonly PlanArchetype[] = [developHeartland, expandSettle, recover, forgeAlliance];

// ---------------------------------------------------------------- construction bridge

/**
 * Wraps `DEFAULT_NEED_EVALUATORS` (needs.ts) so `Recover` biases construction
 * toward food, without any changes to manager.ts/needs.ts. Pass the result
 * as `registerAiConstructionManager`'s `needs` option, and its village's
 * `AiPlanState` as `extraReads` so the daily construction system is allowed
 * to read it.
 */
const RECOVER_FOOD_URGENCY = 0.5;

export function planAwareNeeds(getPlan: () => string): readonly NeedEvaluator[] {
  return DEFAULT_NEED_EVALUATORS.map(
    (evaluate): NeedEvaluator =>
      (ctx) => {
        const need = evaluate(ctx);
        if (need === null || need.kind !== 'food' || getPlan() !== 'Recover') return need;
        return { ...need, ratio: need.ratio * RECOVER_FOOD_URGENCY };
      },
  );
}

// ---------------------------------------------------------------- the weekly system

export interface AiStrategicPlannerOptions {
  readonly issuer: number;
  readonly villageId: EntityId;
  readonly searchRadius?: number;
  readonly weights?: PersonalityWeights;
  readonly archetypes?: readonly PlanArchetype[];
  /** Suffixes the system name (`ai-strategic-planner-${id}`) so multiple kingdoms can each
   * register one of these on the same kernel (M22) — the kernel enforces unique system names.
   * Omit for a single registration (matches M21's existing call sites). */
  readonly id?: string;
  /** Share one `AiPlanState` component across multiple registrations (M22) — the component is
   * already village-index-keyed, so this is safe; get it once via `defineAiPlanState(world)`.
   * Omit to have this call define its own (M21's existing single-registration behaviour). */
  readonly sharedPlanState?: SoAComponent<{ plan: 'u8'; adoptedTick: 'u32' }>;
  /** Diplomacy context (M23) — omit for no `ForgeAlliance` behaviour (M21's existing tests). */
  readonly diplomacy?: AiDiplomacyContext;
}

export interface AiStrategicPlanner {
  readonly AiPlanState: SoAComponent<{ plan: 'u8'; adoptedTick: 'u32' }>;
  currentPlan(): string;
}

const HYSTERESIS_BONUS = 0.15;
const DEFAULT_SETTLE_SEARCH_RADIUS = 40;

/** Defines the shared `AiPlanState` component once, to pass into multiple
 * `registerAiStrategicPlanner` calls via `sharedPlanState` (M22 multi-kingdom). */
export function defineAiPlanState(world: World): SoAComponent<{ plan: 'u8'; adoptedTick: 'u32' }> {
  return world.defineSoA('aiPlanState', { plan: 'u8', adoptedTick: 'u32' });
}

export function registerAiStrategicPlanner(
  kernel: Kernel,
  world: World,
  db: DefinitionDatabase,
  game: VillageGameplay,
  popGame: PopulationGameplay,
  options: AiStrategicPlannerOptions,
): AiStrategicPlanner {
  const AiPlanState: SoAComponent<{ plan: 'u8'; adoptedTick: 'u32' }> = options.sharedPlanState ?? defineAiPlanState(world);
  const weights = options.weights ?? DEFAULT_PERSONALITY_WEIGHTS;
  const archetypes = options.archetypes ?? DEFAULT_PLAN_ARCHETYPES;
  const searchRadius = options.searchRadius ?? DEFAULT_SETTLE_SEARCH_RADIUS;

  const currentPlan = (): string => {
    if (!world.isAlive(options.villageId) || !world.has(options.villageId, AiPlanState)) {
      return (archetypes[0] as PlanArchetype).id;
    }
    const vi = index(options.villageId as number);
    const state = world.read(AiPlanState);
    return (archetypes[state.plan[vi] as number] ?? (archetypes[0] as PlanArchetype)).id;
  };

  const system: SimSystem = {
    name: options.id !== undefined ? `ai-strategic-planner-${options.id}` : 'ai-strategic-planner',
    period: TICKS_PER_DAY * 7,
    phase: 0,
    access: {
      reads: [game.comps.VillageCore, game.comps.BuildingCore, popGame.Population, game.comps.Stockpile],
      writes: [AiPlanState],
    },
    update(ctx: TickContext): void {
      if (!world.isAlive(options.villageId)) return;
      const vi = index(options.villageId as number);
      if (!world.has(options.villageId, AiPlanState)) {
        world.attach(options.villageId, AiPlanState, { plan: 0, adoptedTick: ctx.tick });
      }
      const state = world.write(AiPlanState);
      const previousIndex = state.plan[vi] as number;
      const previousId = (archetypes[previousIndex] ?? (archetypes[0] as PlanArchetype)).id;

      const needCtx: NeedContext = { world, comps: game.comps, ops: game.ops, popGame, db, villageIndex: vi };
      const considerations = computeConsiderations(needCtx, popGame, options.diplomacy);

      const scores: Record<string, number> = {};
      let bestIndex = previousIndex;
      let bestScore = -Infinity;
      archetypes.forEach((archetype, i) => {
        const raw = archetype.utility(considerations, weights);
        scores[archetype.id] = raw;
        const effective = raw + (i === previousIndex ? HYSTERESIS_BONUS : 0);
        if (effective > bestScore) {
          bestScore = effective;
          bestIndex = i;
        }
      });

      if (bestIndex !== previousIndex) {
        state.plan[vi] = bestIndex;
        state.adoptedTick[vi] = ctx.tick;
      }
      const chosen = archetypes[bestIndex] as PlanArchetype;

      ctx.events.publish({
        type: 'ai.planChosen',
        tick: ctx.tick,
        data: { villageId: options.villageId as number, chosenPlan: chosen.id, previousPlan: previousId, scores },
      });

      if (chosen.id === 'ExpandSettle') {
        const core = world.read(game.comps.VillageCore);
        const site = bestSiteNear(game, db, core.centerX[vi] as number, core.centerY[vi] as number, searchRadius);
        if (site !== null) {
          kernel.submit({
            type: 'village.sendSettlers',
            issuer: options.issuer,
            payload: { villageId: options.villageId as number, x: site.x, y: site.y, name: `Settlement-${ctx.tick}` },
          });
        }
      }

      if (chosen.id === 'ForgeAlliance' && options.diplomacy !== undefined) {
        const diplomacy = options.diplomacy;
        const candidates = diplomacy
          .knownKingdoms()
          .filter((k) => !diplomacy.hasPact(k, 'nonAggression'))
          .sort((a, b) => diplomacy.opinionOf(b) - diplomacy.opinionOf(a));
        const target = candidates[0];
        if (target !== undefined) {
          kernel.submit({
            type: 'kingdom.proposePact',
            issuer: options.issuer,
            payload: { targetKingdom: diplomacy.kingdomIndexOf(target), pactType: 'nonAggression' },
          });
        }
      }
    },
  };
  kernel.registerSystem(system);

  return { AiPlanState, currentPlan };
}
