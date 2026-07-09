/**
 * AI construction manager (roadmap M20; doc 07 §5). Daily: detect needs
 * (needs.ts), pick the most under-provisioned one with a placeable,
 * not-already-queued candidate, and submit `village.build` through the same
 * Command Bus a player uses — one code path, replay-safe, command-logged.
 *
 * No direct ECS writes and no affordability pre-check: `village.build`
 * already validates and reserves cost atomically, rejecting (via
 * `village.rejected`) if unaffordable — the manager just tries again next
 * day. Economy-side actions (stock limits, job re-prioritization) aren't
 * needed for construction alone to keep a village fed and housed, so
 * they're not included here; add them as new needs if a future milestone
 * needs a village to survive under different pressures.
 */
import type { EntityId } from '@crowns/core';
import type { DefinitionDatabase } from '@crowns/data';
import type { Component, World } from '../ecs.js';
import type { Kernel, SimSystem } from '../kernel.js';
import { TICKS_PER_DAY } from '../time.js';
import { VILLAGE_RADIUS_T1, type VillageGameplay } from '../game/villages.js';
import type { PopulationGameplay } from '../game/population.js';
import { findBuildSite } from './placement.js';
import { detectNeeds, type NeedEvaluator, type SettlementNeed } from './needs.js';

const index = (id: number): number => id & 0x3fffff;

export interface BuildIntent {
  readonly villageId: number;
  readonly def: string;
  readonly x: number;
  readonly y: number;
}

/** True if the village already has an unfinished building of this def (anti-churn). */
function hasIncomplete(world: World, game: VillageGameplay, villageIndex: number, defCode: number): boolean {
  const b = world.read(game.comps.BuildingCore);
  let found = false;
  world.query([game.comps.BuildingCore]).forEach((i) => {
    if (found) return;
    if (index(b.village[i] as number) !== villageIndex) return;
    if ((b.def[i] as number) !== defCode) return;
    if ((b.complete[i] as number) !== 1) found = true;
  });
  return found;
}

/** Most under-provisioned satisfiable need, or null if nothing to build today. */
export function chooseBuildTarget(
  needs: readonly SettlementNeed[],
  world: World,
  db: DefinitionDatabase,
  game: VillageGameplay,
  villageId: EntityId,
  villageIndex: number,
  centerX: number,
  centerY: number,
  searchRadius: number,
): BuildIntent | null {
  for (const need of [...needs].sort((a, b) => a.ratio - b.ratio)) {
    if (need.ratio >= 1) continue; // satisfied
    for (const defId of need.candidates) {
      const def = db.buildings.get(defId);
      if (def === undefined) continue;
      if (hasIncomplete(world, game, villageIndex, game.ops.defCode(defId))) continue;
      const site = findBuildSite(game.ops, villageId, def, centerX, centerY, searchRadius);
      if (site === null) continue;
      return { villageId: villageId as number, def: defId, x: site.x, y: site.y };
    }
  }
  return null;
}

export interface AiConstructionOptions {
  readonly issuer: number;
  readonly villageId: EntityId;
  readonly searchRadius?: number;
  readonly needs?: readonly NeedEvaluator[];
  /** Extra components a custom `needs` evaluator reads (e.g. an external plan-state component). */
  readonly extraReads?: readonly Component[];
  /** Suffixes the system name (`ai-construction-${id}`) so multiple kingdoms can each register
   * one of these on the same kernel (M22) — the kernel enforces unique system names. Omit for
   * a single registration (the default name is unchanged, matching M20's existing call sites). */
  readonly id?: string;
}

/** Registers the daily construction-manager system, bound to one village. */
export function registerAiConstructionManager(
  kernel: Kernel,
  world: World,
  db: DefinitionDatabase,
  game: VillageGameplay,
  popGame: PopulationGameplay,
  options: AiConstructionOptions,
): void {
  const { VillageCore, BuildingCore } = game.comps;
  const searchRadius = options.searchRadius ?? VILLAGE_RADIUS_T1;

  const system: SimSystem = {
    name: options.id !== undefined ? `ai-construction-${options.id}` : 'ai-construction',
    period: TICKS_PER_DAY,
    phase: 6,
    access: { reads: [VillageCore, BuildingCore, popGame.Population, ...(options.extraReads ?? [])] },
    update(): void {
      if (!world.isAlive(options.villageId)) return;
      const villageIndex = index(options.villageId as number);
      const core = world.read(VillageCore);
      const needs = detectNeeds(
        { world, comps: game.comps, ops: game.ops, popGame, db, villageIndex },
        options.needs,
      );
      const intent = chooseBuildTarget(
        needs,
        world,
        db,
        game,
        options.villageId,
        villageIndex,
        core.centerX[villageIndex] as number,
        core.centerY[villageIndex] as number,
        searchRadius,
      );
      if (intent !== null) {
        kernel.submit({ type: 'village.build', issuer: options.issuer, payload: intent });
      }
    },
  };
  kernel.registerSystem(system);
}
