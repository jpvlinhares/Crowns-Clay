/**
 * AI research manager (roadmap M32; doc 07 §4). Daily, and only while the
 * strategic planner's active plan is `TechRace` (planner.ts) — same "only
 * spend effort a chosen plan asks for" discipline as M20's construction
 * manager and M30's military manager.
 *
 * ONE ACTION PER DAY: raise a scribe's hut if the village has no scholar
 * building yet → otherwise, if nothing is actively being researched, start
 * the cheapest currently-available tech (`ResearchGameplay.availableTechs`,
 * already era/prerequisite-gated). No "best tech" scoring beyond cost — a v1
 * simplification, same spirit as M25's cheapest-fallback recruit order.
 */
import type { EntityId } from '@crowns/core';
import type { DefinitionDatabase } from '@crowns/data';
import type { Component, World } from '../ecs.js';
import type { Kernel, SimSystem } from '../kernel.js';
import { TICKS_PER_DAY } from '../time.js';
import { VILLAGE_RADIUS_T1, type VillageGameplay } from '../game/villages.js';
import type { ResearchGameplay } from '../game/research.js';
import { findBuildSite } from './placement.js';

const index = (id: number): number => id & 0x3fffff;

export const SCHOLAR_BUILDING_DEF = 'base:building.scribes-hut';

export interface AiResearchOptions {
  readonly issuer: number;
  readonly villageId: EntityId;
  readonly kingdomId: EntityId;
  readonly getPlan: () => string;
  readonly id?: string;
  readonly searchRadius?: number;
  /** Extra components a custom `getPlan` reads (e.g. the planner's `AiPlanState` component). */
  readonly extraReads?: readonly Component[];
}

function hasBuildingOfDef(world: World, game: VillageGameplay, villageIndex: number, defCode: number): boolean {
  const b = world.read(game.comps.BuildingCore);
  let found = false;
  world.query([game.comps.BuildingCore]).forEach((i) => {
    if (found) return;
    if (index(b.village[i] as number) !== villageIndex) return;
    if ((b.def[i] as number) === defCode) found = true;
  });
  return found;
}

export function registerAiResearchManager(
  kernel: Kernel,
  world: World,
  db: DefinitionDatabase,
  game: VillageGameplay,
  researchGame: ResearchGameplay,
  options: AiResearchOptions,
): void {
  const { VillageCore, BuildingCore } = game.comps;
  const searchRadius = options.searchRadius ?? VILLAGE_RADIUS_T1;

  const system: SimSystem = {
    name: options.id !== undefined ? `ai-research-${options.id}` : 'ai-research',
    period: TICKS_PER_DAY,
    phase: 8,
    access: { reads: [VillageCore, BuildingCore, ...(options.extraReads ?? [])] },
    update(): void {
      if (!world.isAlive(options.villageId)) return;
      if (options.getPlan() !== 'TechRace') return;
      const vi = index(options.villageId as number);
      const hutCode = game.ops.defCode(SCHOLAR_BUILDING_DEF);
      if (!hasBuildingOfDef(world, game, vi, hutCode)) {
        const def = db.buildings.get(SCHOLAR_BUILDING_DEF);
        if (def === undefined) return;
        const core = world.read(VillageCore);
        const cx = core.centerX[vi] as number;
        const cy = core.centerY[vi] as number;
        const site = findBuildSite(game.ops, options.villageId, def, cx, cy, searchRadius);
        if (site !== null) {
          kernel.submit({
            type: 'village.build',
            issuer: options.issuer,
            payload: { villageId: options.villageId as number, def: SCHOLAR_BUILDING_DEF, x: site.x, y: site.y },
          });
        }
        return; // one action per day
      }

      if (researchGame.activeResearch(options.kingdomId) !== undefined) return;
      const available = researchGame.availableTechs(options.kingdomId);
      if (available.length === 0) return;
      const cheapest = [...available].sort(
        (a, b) => researchGame.costOf(options.kingdomId, a) - researchGame.costOf(options.kingdomId, b),
      )[0] as string;
      kernel.submit({ type: 'kingdom.setActiveResearch', issuer: options.issuer, payload: { techId: cheapest } });
    },
  };
  kernel.registerSystem(system);
}
