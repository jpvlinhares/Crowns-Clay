/**
 * AI defence manager (roadmap M52; doc 07 §5; ADR-4 §1 — templates over
 * genuine planning). Daily, per kingdom, ONE action, mirroring the
 * construction manager's anti-spam discipline (ai/manager.ts):
 *
 *   1. BUILD: walk the kingdom's castle-template plan (a content-defined
 *      build queue, data/castleTemplates.ts) and place the next missing
 *      structure through the ordinary `defence.build` command — one code
 *      path, replay-safe, command-logged. Tiles the local ground refuses
 *      (rock, water, out of bounds, already occupied) are SKIPPED — nature
 *      already walls the blocked ones (doc 07 §5's terrain adaptation).
 *      An unaffordable entry is retried tomorrow (the atomic-cost command
 *      rejects it harmlessly), with a stone reserve so fortification never
 *      starves construction of its material.
 *   2. POST: assign one idle, complete, army-free unit to the template's
 *      next free garrison anchor via `defence.post`. The M51 draft rule is
 *      the release valve: when the military manager assembles an army, the
 *      draft pulls posted units OFF the walls automatically — so garrison
 *      strength breathes with the kingdom's plans without this manager
 *      knowing about them.
 *
 * Template choice is personality-flavoured but deterministic: the
 * composition supplies `templateOf` (seeded per kingdom); this module never
 * draws randomness at all.
 */
import type { CastleTemplateDef, DefinitionDatabase } from '@crowns/data';
import { expandPlanEntry } from '@crowns/data';
import type { World } from '../ecs.js';
import type { Kernel, SimSystem } from '../kernel.js';
import { TICKS_PER_DAY } from '../time.js';
import { DEFENCE_MAP_SIZE, DEFENCE_TILE } from '../worldgen/defenceMap.js';
import { DEFENCE_KEEP_CENTRE, type DefenceGameplay } from '../game/defence.js';
import type { VillageGameplay } from '../game/villages.js';
import type { MilitaryGameplay } from '../game/military.js';
import type { KingdomGameplay } from '../game/kingdom.js';

/** Stone kept back for ordinary construction — fortification never drains the yard. */
export const DEFENCE_STONE_RESERVE = 60;

export interface AiDefenceOptions {
  readonly issuer: number;
  readonly kingdomIndex: number;
  readonly template: CastleTemplateDef;
  /** Dense village index of the capital (cost source), or null when landless. */
  readonly capitalOf: () => number | null;
  readonly id?: string;
}

interface PlanTarget {
  readonly def: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Expand a template to concrete, in-bounds layer targets (deterministic order). */
export function expandTemplate(db: DefinitionDatabase, template: CastleTemplateDef): PlanTarget[] {
  const out: PlanTarget[] = [];
  for (const entry of template.plan) {
    const def = db.buildings.get(entry.def);
    if (def === undefined) continue; // load-time integrity already forbids this
    for (const [dx, dy] of expandPlanEntry(entry)) {
      const x = DEFENCE_KEEP_CENTRE + dx;
      const y = DEFENCE_KEEP_CENTRE + dy;
      if (x < 0 || y < 0 || x + def.footprint.w > DEFENCE_MAP_SIZE || y + def.footprint.h > DEFENCE_MAP_SIZE) continue;
      out.push({ def: entry.def, x, y, w: def.footprint.w, h: def.footprint.h });
    }
  }
  return out;
}

export function registerAiDefenceManager(
  kernel: Kernel,
  world: World,
  db: DefinitionDatabase,
  game: VillageGameplay,
  militaryGame: MilitaryGameplay,
  kingdomGame: KingdomGameplay,
  defenceGame: DefenceGameplay,
  options: AiDefenceOptions,
): void {
  const { Stockpile } = game.comps;
  const { Unit } = militaryGame;
  const { DefencePost } = defenceGame;
  const k = options.kingdomIndex;
  const targets = expandTemplate(db, options.template);
  const stoneCode = game.ops.resourceCode('base:resource.stone') as number;

  const system: SimSystem = {
    name: options.id !== undefined ? `ai-defence-${options.id}` : 'ai-defence',
    period: TICKS_PER_DAY,
    phase: 8, // after the military manager's daily action, before occupation settles
    access: { reads: [Unit, DefencePost, Stockpile] },
    update(): void {
      const capital = options.capitalOf();
      if (capital === null) return; // landless: nothing to fortify from
      const map = defenceGame.mapOf(k);
      if (map === undefined) return;
      const occupancy = defenceGame.occupancyOf(k);

      // ---- 1. build: first plan target whose ground is free (skip = adaptation) ----
      const buildable = targets.find((t) => {
        for (let dy = 0; dy < t.h; dy++) {
          for (let dx = 0; dx < t.w; dx++) {
            const tile = (t.y + dy) * DEFENCE_MAP_SIZE + (t.x + dx);
            if (map.tiles[tile] !== DEFENCE_TILE.open || occupancy.has(tile)) return false;
          }
        }
        return true;
      });
      if (buildable !== undefined) {
        const def = db.buildings.get(buildable.def);
        const stock = world.readObj(Stockpile).tryGet(capital);
        const stoneCost = def?.cost['base:resource.stone'] ?? 0;
        const stoneHeld = stock?.get(stoneCode) ?? 0;
        // affordability + reserve gate here (a plain read) so the daily rejection stream
        // stays quiet; the command still enforces the REAL atomic cost on execution
        if (stoneHeld >= stoneCost + DEFENCE_STONE_RESERVE) {
          kernel.submit({
            type: 'defence.build',
            issuer: options.issuer,
            payload: { def: buildable.def, x: buildable.x, y: buildable.y },
          });
          // no return: posting is independent — a garrison must not wait 30+ days
          // behind the build queue (readiness beats masonry)
        }
      }

      // ---- 2. post: one idle unit to the next free anchor ----
      const kingdomId = kingdomGame.kingdomEntities()[k];
      if (kingdomId === undefined) return;
      const u = world.read(Unit);
      const post = world.read(DefencePost);
      const taken = new Set<number>();
      world.query([DefencePost, Unit]).forEach((pi) => {
        if ((u.kingdomId[pi] as number) === (kingdomId as number)) taken.add((post.y[pi] as number) * DEFENCE_MAP_SIZE + (post.x[pi] as number));
      });
      const anchor = options.template.garrisonAnchors
        .map(([dx, dy]) => ({ x: DEFENCE_KEEP_CENTRE + dx, y: DEFENCE_KEEP_CENTRE + dy }))
        .find((a) => {
          const tile = a.y * DEFENCE_MAP_SIZE + a.x;
          return map.tiles[tile] === DEFENCE_TILE.open && !occupancy.has(tile) && !taken.has(tile);
        });
      if (anchor === undefined) return;
      let idle: number | undefined;
      world.query([Unit]).forEach((ui, entity) => {
        if (idle !== undefined) return;
        if ((u.kingdomId[ui] as number) !== (kingdomId as number)) return;
        if ((u.complete[ui] as number) !== 1 || (u.armyId[ui] as number) !== 0 || (u.count[ui] as number) <= 0) return;
        if (world.has(entity, DefencePost)) return;
        idle = entity as number;
      });
      if (idle !== undefined) {
        kernel.submit({ type: 'defence.post', issuer: options.issuer, payload: { unitId: idle, x: anchor.x, y: anchor.y } });
      }
    },
  };
  kernel.registerSystem(system);
}
