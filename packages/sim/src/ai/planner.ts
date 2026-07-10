/**
 * AI strategic planner v1 (roadmap M21; doc 07 §2). Weekly (doc 08 §9): score
 * plan archetypes from considerations × personality weights, apply
 * hysteresis (a bonus for staying on the current plan) to argmax-select the
 * major plan, bridge the choice into M20's construction manager
 * (`planAwareNeeds`) and M15's settler dispatch, and publish a decision-log
 * event every week so "why this plan?" is always answerable (doc 13 R1).
 *
 * M21 shipped 3 archetypes (DevelopHeartland, ExpandSettle, Recover);
 * ForgeAlliance (M23), MilitaryBuildup/ConquestWar (M30), and TechRace (M32)
 * joined once their underlying systems (diplomacy/military/research) landed
 * — `DEFAULT_PLAN_ARCHETYPES` is an extensible array exactly so each could
 * append without a rewrite, mirroring M20's `NeedEvaluator` list. The rest of
 * doc 07 §2's list (PunitiveRaid, FortifyBorder, PrepareVictory, ...) stays
 * deferred pending their own systems.
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
import { SoAComponent, World, type Component } from '../ecs.js';
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
  /** How readily this kingdom builds up and commits military force (M30); optional, defaults to 0.5. */
  readonly aggression?: number; // 0..1
  /** How readily this kingdom invests in research over other priorities (M32); optional, defaults to 0.5. */
  readonly tech?: number; // 0..1
}

export const DEFAULT_PERSONALITY_WEIGHTS: PersonalityWeights = {
  expansion: 0.5,
  economy: 0.5,
  riskTolerance: 0.5,
  diplomacyTrust: 0.5,
  aggression: 0.5,
  tech: 0.5,
};

// ---------------------------------------------------------------- considerations

export interface Considerations {
  readonly economyStrength: number; // realized welfare: avg(foodSecurity, happiness/100)
  readonly growthHeadroom: number; // unmet construction capacity, from detectNeeds
  readonly settleReadiness: number; // spare adults/cohorts/cargo for a settler party
  readonly crisisSignal: number; // 1 if actually starving/unhappy, else 0
  readonly allianceOpportunity: number; // 0..1: is there a known, non-hostile, not-yet-pacted foreign kingdom (M23)
  readonly militaryStrength: number; // 0..1: own committed troops, normalised (M30)
  readonly relativeAdvantage: number; // 0..1: own strength vs. the strongest known rival's (M30); 0 if none known
  readonly researchOpportunity: number; // 0..1: how much of the tech tree is left to research (M32)
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

/** Military context (M30) a planner reads to score `MilitaryBuildup`/`ConquestWar` — optional
 * and additive, same shape convention as `AiDiplomacyContext`. Strength is a plain committed-
 * troop count read directly (this planner stays standalone from M19's Knowledge Model, like
 * M21/M23 before it — not "believed" strength through fog uncertainty). */
export interface AiMilitaryContext {
  ownStrength(): number;
  /** Committed troop counts of every known, non-allied rival (M22 scouting; empty ⇒ neutral 0.5 advantage). */
  knownRivalStrengths(): readonly number[];
}

const MILITARY_STRENGTH_NORM = 40; // committed troop count treated as "fully built up" (a handful of units)

/** Research context (M32) a planner reads to score `TechRace` — optional and additive, same
 * shape convention as `AiDiplomacyContext`/`AiMilitaryContext`. */
export interface AiResearchContext {
  /** Fraction (0..1) of the tech tree this kingdom already knows. */
  coverage(): number;
}

export function computeConsiderations(
  ctx: NeedContext,
  popGame: PopulationGameplay,
  diplomacy?: AiDiplomacyContext,
  military?: AiMilitaryContext,
  research?: AiResearchContext,
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

  // inert defaults: militaryStrength=1 ("no need to build up" — building up isn't even a concept
  // without a military module) and relativeAdvantage=0 ("no case for war" — conquering nothing
  // known scores as nothing to conquer, not a coin-flip). Both keep militaryBuildup/conquestWar
  // at exactly 0 wherever no military context is wired in (every M20/M21/M23 test) or no rival
  // is known yet (nothing to size up against) — never a false readiness signal.
  let militaryStrength = 1;
  let relativeAdvantage = 0;
  if (military !== undefined) {
    const ownStrength = military.ownStrength();
    militaryStrength = clamp01(ownStrength / MILITARY_STRENGTH_NORM);
    const rivals = military.knownRivalStrengths();
    if (rivals.length > 0) {
      const bestRival = Math.max(...rivals);
      relativeAdvantage = ownStrength + bestRival <= 0 ? 0.5 : clamp01(ownStrength / (ownStrength + bestRival));
    }
  }

  // inert default: researchOpportunity=0 ("nothing to race toward" — without a research module,
  // there's no tree to have headroom in) wherever no research context is wired in.
  const researchOpportunity = research === undefined ? 0 : clamp01(1 - research.coverage());

  return {
    economyStrength: clamp01((foodSecurity + happiness / 100) / 2),
    growthHeadroom: clamp01(1 - Math.min(foodRatio, housingRatio)),
    settleReadiness: cohortsOk && cargoOk ? clamp01(adultsSurplus / SETTLER_PARTY.adults) : 0,
    crisisSignal: foodSecurity < CRISIS_FOOD_SECURITY || happiness < CRISIS_HAPPINESS ? 1 : 0,
    allianceOpportunity,
    militaryStrength,
    relativeAdvantage,
    researchOpportunity,
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

/** M30: real now that military exists — inert (`militaryStrength` always 0) when no `military`
 * context is wired in. Wants to build up specifically while WEAK — the natural lead-in to
 * `conquestWar` below, a ladder that emerges from utility scoring rather than an authored
 * milestone sequence (doc 07 §2's fuller "ConquestWar ladder" stays deferred — v1 scope). */
const militaryBuildup: PlanArchetype = {
  id: 'MilitaryBuildup',
  utility: (c, w) => clamp01((w.aggression ?? 0.5) * (1 - c.militaryStrength) * c.economyStrength),
};

/** M30: wants to actually go to war only once ALREADY strong and advantaged — otherwise
 * `militaryBuildup` (above) keeps outscoring it, so the two form a natural weak→strong ladder
 * without any explicit state machine. Target selection (which rival, where) is the AI military
 * manager's job (ai/military.ts) once this plan is chosen, mirroring how `expandSettle` picks its
 * site only in the planner system's `update()`, not in the archetype's own utility function. */
const conquestWar: PlanArchetype = {
  id: 'ConquestWar',
  utility: (c, w) => clamp01((w.aggression ?? 0.5) * c.relativeAdvantage * c.militaryStrength),
};

/** M32: real now that research exists — inert (`researchOpportunity` always 0) when no
 * `research` context is wired in. Wants a strong economy funding it AND real headroom left
 * in the tree — a kingdom that's already researched everything has nothing left to race for. */
const techRace: PlanArchetype = {
  id: 'TechRace',
  utility: (c, w) => clamp01((w.tech ?? 0.5) * c.researchOpportunity * c.economyStrength),
};

export const DEFAULT_PLAN_ARCHETYPES: readonly PlanArchetype[] = [
  developHeartland, expandSettle, recover, forgeAlliance, militaryBuildup, conquestWar, techRace,
];

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
  /** Military context (M30) — omit for no `MilitaryBuildup`/`ConquestWar` behaviour. */
  readonly military?: AiMilitaryContext;
  /** Research context (M32) — omit for no `TechRace` behaviour. */
  readonly research?: AiResearchContext;
  /** Extra components a custom `military`/`diplomacy` context reads (e.g. game/military.ts's `Unit`). */
  readonly extraReads?: readonly Component[];
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
      reads: [game.comps.VillageCore, game.comps.BuildingCore, popGame.Population, game.comps.Stockpile, ...(options.extraReads ?? [])],
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
      const considerations = computeConsiderations(needCtx, popGame, options.diplomacy, options.military, options.research);

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
