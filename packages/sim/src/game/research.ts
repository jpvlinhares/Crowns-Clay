/**
 * Research (roadmap M32; GDD §9; doc 06 §8; doc 08 §2 slot 15).
 *
 * `ResearchState` is a plain relational class keyed by kingdom EntityId, not
 * an ECS component — same reasoning as `DiplomacyState`: a kingdom's known-
 * tech set and active-research progress don't need per-tick ECS access
 * guarding, and lazy per-kingdom defaults (`recordOf`) sidestep any genesis-
 * ordering dependency on `kingdom-genesis` (nothing needs to be attached
 * ahead of time). It folds into `stateHash()` via `kernel.addHashSource`,
 * mutated only through kernel-registered commands and its own daily system.
 *
 * SCHOLAR BUILDINGS (scribe's hut → library → university, content M32) each
 * carry a flat `research.pointsPerDay` — summed daily across a kingdom's
 * completed buildings (no workforce-efficiency gating yet, v1) and scaled by
 * `kingdom.researchYield` (the Scholar office's scholarship-skill bonus,
 * game/kingdom.ts). One kingdom researches one tech at a time
 * (`kingdom.setActiveResearch`); switching targets abandons any progress on
 * the previous one (v1 simplification — no partial-progress banking).
 *
 * ERA GATES (GDD §9: "require breadth, discouraging pure beelines"): starting
 * a tech in era E (E > early) requires the kingdom to already know at least
 * `ERA_BREADTH_FRACTION` of era E-1's techs — checked against the CONTENT's
 * actual per-era tech count, not a fixed number, so it stays correct however
 * many techs a mod adds per era.
 *
 * DIFFUSION (GDD §9 catch-up mechanic): an optional `knownByNeighbor` hook
 * (fog/diplomacy-shaped, same "inert without a wired context" pattern as
 * M23/M30/M31's cross-module options) — if true for a given (kingdom, tech)
 * pair, `costOf` charges `cost × (1 - diffusionDiscount)` instead of the full
 * price. Omit the hook for the standalone-kingdom default (never discounted).
 *
 * `unlocks` (buildings/units/edicts) are validated referentially at content
 * load (terrain.ts's DAG validation) and queryable via `hasUnlocked`, but
 * NOT enforced against `village.build`/`army.recruitUnit` yet — the same
 * "data now, active later" precedent M25 set for `BuildingDef.military.
 * garrisonCap`.
 */
import { Interner, type EntityId } from '@crowns/core';
import type { DefinitionDatabase, TechDef } from '@crowns/data';
import { ERA_ORDER } from '@crowns/data';
import type { World } from '../ecs.js';
import type { Kernel, SimSystem, TickContext } from '../kernel.js';
import { TICKS_PER_DAY } from '../time.js';
import type { VillageGameplay } from './villages.js';
import type { KingdomGameplay } from './kingdom.js';

const index = (id: number): number => id & 0x3fffff;

// ---------------------------------------------------------------- constants

/** Fraction of the PRIOR era's techs a kingdom must already know before starting any tech
 * in the next era (GDD §9's "require breadth" era gate). */
export const ERA_BREADTH_FRACTION = 0.6;

// ---------------------------------------------------------------- state

interface ResearchRecord {
  readonly known: ReadonlySet<number>; // interned tech codes
  readonly activeCode: number; // -1 = none active
  readonly progress: number; // accumulated research points toward activeCode's cost
}

const NONE_ACTIVE = -1;
const EMPTY_RECORD: ResearchRecord = { known: new Set(), activeCode: NONE_ACTIVE, progress: 0 };

/** Per-kingdom known techs + active research progress (doc 06 §5 `techsKnown`/`researchActive`). */
export class ResearchState {
  private readonly byKingdom = new Map<number, ResearchRecord>();

  private recordOf(kingdomId: number): ResearchRecord {
    return this.byKingdom.get(kingdomId) ?? EMPTY_RECORD;
  }

  isKnown(kingdomId: number, techCode: number): boolean {
    return this.recordOf(kingdomId).known.has(techCode);
  }

  knownCodes(kingdomId: number): ReadonlySet<number> {
    return this.recordOf(kingdomId).known;
  }

  active(kingdomId: number): { readonly code: number; readonly progress: number } | undefined {
    const rec = this.recordOf(kingdomId);
    return rec.activeCode === NONE_ACTIVE ? undefined : { code: rec.activeCode, progress: rec.progress };
  }

  /** Switching to a different tech than the current active one abandons its progress (v1). */
  setActive(kingdomId: number, techCode: number): void {
    const rec = this.recordOf(kingdomId);
    this.byKingdom.set(kingdomId, { ...rec, activeCode: techCode, progress: 0 });
  }

  /** Adds research points to the active tech; returns the new progress total (0 if none active). */
  addProgress(kingdomId: number, amount: number): number {
    const rec = this.recordOf(kingdomId);
    if (rec.activeCode === NONE_ACTIVE) return 0;
    const progress = rec.progress + amount;
    this.byKingdom.set(kingdomId, { ...rec, progress });
    return progress;
  }

  /** Moves the active tech into `known` and clears the active slot. */
  completeActive(kingdomId: number): void {
    const rec = this.recordOf(kingdomId);
    if (rec.activeCode === NONE_ACTIVE) return;
    const known = new Set(rec.known);
    known.add(rec.activeCode);
    this.byKingdom.set(kingdomId, { known, activeCode: NONE_ACTIVE, progress: 0 });
  }

  /** Sorted-key fold — deterministic regardless of mutation order (stateHash requirement). */
  fold(fold: (v: number) => void): void {
    for (const kingdomId of [...this.byKingdom.keys()].sort((a, b) => a - b)) {
      fold(kingdomId);
      const rec = this.byKingdom.get(kingdomId) as ResearchRecord;
      for (const code of [...rec.known].sort((a, b) => a - b)) fold(code);
      fold(rec.activeCode);
      fold(Math.round(rec.progress * 1000));
    }
  }
}

// ---------------------------------------------------------------- registrar

export interface ResearchGameplayOptions {
  /** Fog/diplomacy hook (M31-style, optional): does a known neighbour kingdom already have
   * this tech? Cheapens the cost by the tech's `diffusionDiscount`. Omit for the standalone-
   * kingdom default (never discounted). */
  knownByNeighbor?(kingdomId: EntityId, techId: string): boolean;
}

export interface ResearchGameplay {
  readonly state: ResearchState;
  techCode(id: string): number | undefined;
  techById(code: number): TechDef;
  isKnown(kingdomId: EntityId, techId: string): boolean;
  activeResearch(kingdomId: EntityId): { readonly techId: string; readonly progress: number } | undefined;
  /** Prerequisites met AND era-breadth requirement satisfied, not yet known — the unlocked
   * set a player/AI may `kingdom.setActiveResearch` into right now. */
  availableTechs(kingdomId: EntityId): readonly string[];
  /** Fraction (0..1) of the whole tech tree this kingdom already knows — feeds the AI
   * planner's `TechRace` consideration (ai/planner.ts's `AiResearchContext`, M32). */
  coverageOf(kingdomId: EntityId): number;
  costOf(kingdomId: EntityId, techId: string): number;
  /** Convenience query over known techs' `unlocks` — NOT enforced elsewhere yet (v1, see module doc). */
  hasUnlocked(kingdomId: EntityId, defId: string): boolean;
}

export function registerResearchGameplay(
  kernel: Kernel,
  world: World,
  db: DefinitionDatabase,
  game: VillageGameplay,
  kingdomGame: KingdomGameplay,
  options: ResearchGameplayOptions = {},
): ResearchGameplay {
  const state = new ResearchState();
  kernel.addHashSource('research', (fold) => state.fold(fold));

  // tech codes: sorted def ids → stable indices (mirrors villages.ts's interner pattern)
  const interner = new Interner();
  const techIds = [...db.techs.keys()].sort();
  for (const id of techIds) interner.intern(id);
  const techCode = (id: string): number | undefined => interner.peek(id) as number | undefined;
  const techById = (code: number): TechDef => db.techs.get(techIds[code] as string) as TechDef;

  // techs grouped by era, for the breadth check's denominator
  const codesByEra = new Map<string, number[]>();
  for (const id of techIds) {
    const def = db.techs.get(id) as TechDef;
    const list = codesByEra.get(def.era) ?? [];
    list.push(techCode(id) as number);
    codesByEra.set(def.era, list);
  }

  const eraBreadthSatisfied = (kingdomId: number, era: string): boolean => {
    const eraIndex = ERA_ORDER.indexOf(era as (typeof ERA_ORDER)[number]);
    if (eraIndex <= 0) return true;
    const priorCodes = codesByEra.get(ERA_ORDER[eraIndex - 1] as string) ?? [];
    if (priorCodes.length === 0) return true;
    const knownCount = priorCodes.filter((code) => state.isKnown(kingdomId, code)).length;
    return knownCount / priorCodes.length >= ERA_BREADTH_FRACTION;
  };

  const prerequisitesMet = (kingdomId: number, def: TechDef): boolean =>
    def.prerequisites.every((preId) => {
      const preCode = techCode(preId);
      return preCode !== undefined && state.isKnown(kingdomId, preCode);
    });

  const costOf = (kingdomId: EntityId, techId: string): number => {
    const code = techCode(techId);
    if (code === undefined) return Infinity;
    const def = techById(code);
    const discounted = options.knownByNeighbor?.(kingdomId, techId) ?? false;
    return discounted ? def.cost * (1 - def.diffusionDiscount) : def.cost;
  };

  const kingdomAt = (i: number): EntityId | undefined => kingdomGame.kingdomEntities()[i];
  const indexForIssuer = (issuer: number): number => {
    const n = kingdomGame.kingdomEntities().length;
    return Math.max(0, Math.min(n - 1, issuer - 1));
  };
  const reject = (ctx: TickContext, what: string, reason: string): void => {
    ctx.events.publish({ type: 'village.rejected', tick: ctx.tick, data: { what, reason } });
  };

  kernel.registerCommand<{ techId: string }>('kingdom.setActiveResearch', (ctx, p, command) => {
    const kingdomId = kingdomAt(indexForIssuer(command.issuer));
    if (kingdomId === undefined) return reject(ctx, 'kingdom.setActiveResearch', 'no kingdom');
    const techId = String(p.techId);
    const code = techCode(techId);
    if (code === undefined) return reject(ctx, 'kingdom.setActiveResearch', `unknown tech '${techId}'`);
    const ki = kingdomId as number;
    if (state.isKnown(ki, code)) return reject(ctx, 'kingdom.setActiveResearch', 'already known');
    const def = techById(code);
    if (!eraBreadthSatisfied(ki, def.era)) {
      return reject(
        ctx,
        'kingdom.setActiveResearch',
        `era '${def.era}' not yet unlocked (need ${Math.round(ERA_BREADTH_FRACTION * 100)}% of the prior era known first)`,
      );
    }
    if (!prerequisitesMet(ki, def)) {
      const missing = def.prerequisites.filter((preId) => {
        const preCode = techCode(preId);
        return preCode === undefined || !state.isKnown(ki, preCode);
      });
      return reject(ctx, 'kingdom.setActiveResearch', `missing prerequisites: ${missing.join(', ')}`);
    }
    state.setActive(ki, code);
    ctx.events.publish({ type: 'research.setActive', tick: ctx.tick, data: { kingdom: ki, techId } });
  });

  // ---------------- daily accrual (doc 08 §2 slot 15) ----------------
  const { BuildingCore } = game.comps;
  const progressSystem: SimSystem = {
    name: 'research-progress',
    period: TICKS_PER_DAY,
    phase: 9,
    access: {
      reads: [BuildingCore, ...(kingdomGame.VillageOwner !== undefined ? [kingdomGame.VillageOwner] : [])],
    },
    update(ctx: TickContext): void {
      const kingdomIds = kingdomGame.kingdomEntities();
      if (kingdomIds.length === 0) return;
      const b = world.read(BuildingCore);
      const ownerOf = kingdomGame.VillageOwner !== undefined ? world.read(kingdomGame.VillageOwner) : null;
      const pointsByKingdom = new Map<number, number>();
      world.query([BuildingCore]).forEach((i) => {
        if ((b.complete[i] as number) !== 1) return;
        const def = game.ops.buildingDef(b.def[i] as number);
        if (def.research === undefined) return;
        const vi = index(b.village[i] as number);
        const kingdomId = ownerOf !== null ? (ownerOf.kingdom[vi] as number) : (kingdomIds[0] as number);
        pointsByKingdom.set(kingdomId, (pointsByKingdom.get(kingdomId) ?? 0) + def.research.pointsPerDay);
      });
      const researchYield = kingdomGame.mods.mul('kingdom.researchYield');
      for (const kingdomId of kingdomIds) {
        const ki = kingdomId as number;
        const active = state.active(ki);
        if (active === undefined) continue;
        const points = (pointsByKingdom.get(ki) ?? 0) * researchYield;
        if (points <= 0) continue;
        const def = techById(active.code);
        const cost = costOf(kingdomId as EntityId, def.id);
        const progress = state.addProgress(ki, points);
        if (progress >= cost) {
          state.completeActive(ki);
          ctx.events.publish({ type: 'research.completed', tick: ctx.tick, data: { kingdom: ki, techId: def.id } });
        }
      }
    },
  };
  kernel.registerSystem(progressSystem);

  return {
    state,
    techCode,
    techById,
    isKnown(kingdomId: EntityId, techId: string): boolean {
      const code = techCode(techId);
      return code !== undefined && state.isKnown(kingdomId as number, code);
    },
    activeResearch(kingdomId: EntityId): { readonly techId: string; readonly progress: number } | undefined {
      const active = state.active(kingdomId as number);
      if (active === undefined) return undefined;
      return { techId: techById(active.code).id, progress: active.progress };
    },
    availableTechs(kingdomId: EntityId): readonly string[] {
      const ki = kingdomId as number;
      const out: string[] = [];
      for (const id of techIds) {
        const code = techCode(id) as number;
        if (state.isKnown(ki, code)) continue;
        const def = techById(code);
        if (!eraBreadthSatisfied(ki, def.era)) continue;
        if (!prerequisitesMet(ki, def)) continue;
        out.push(id);
      }
      return out;
    },
    costOf,
    coverageOf(kingdomId: EntityId): number {
      return techIds.length === 0 ? 0 : state.knownCodes(kingdomId as number).size / techIds.length;
    },
    hasUnlocked(kingdomId: EntityId, defId: string): boolean {
      const ki = kingdomId as number;
      for (const code of state.knownCodes(ki)) {
        const def = techById(code);
        if (def.unlocks?.buildings?.includes(defId)) return true;
        if (def.unlocks?.units?.includes(defId)) return true;
        if (def.unlocks?.edicts?.includes(defId)) return true;
      }
      return false;
    },
  };
}
