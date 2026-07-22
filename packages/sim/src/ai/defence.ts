/**
 * AI defence manager (roadmap M52; doc 07 §5; ADR-4 §1 — templates over
 * genuine planning). Daily, per kingdom, ONE action, mirroring the
 * construction manager's anti-spam discipline (ai/manager.ts):
 *
 *   1. BUILD: walk the kingdom's castle-template plan (a content-defined
 *      build queue, data/castleTemplates.ts) and place the next missing
 *      "ambition" (untagged, never-free) structure through the ordinary
 *      `defence.build` command — one code path, replay-safe, command-logged.
 *      M57: the template's TIER-tagged entries are genesis-derived and free
 *      (defence-genesis, game/defence.ts) — this manager only ever pays for
 *      what's left after that, which `defence.build`'s own occupancy check
 *      naturally skips (an already-materialised tile just isn't "buildable").
 *      Tiles the local ground refuses (rock, water, out of bounds, already
 *      occupied) are SKIPPED — nature already walls the blocked ones (doc 07
 *      §5's terrain adaptation). An unaffordable entry is retried tomorrow
 *      (the atomic-cost command rejects it harmlessly), with a stone reserve
 *      so fortification never starves construction of its material.
 *   2. POST: assign one idle, complete, army-free unit whose HOME is this
 *      village to the template's next free garrison anchor via
 *      `defence.post`. The M51 draft rule is the release valve: when the
 *      military manager assembles an army, the draft pulls posted units OFF
 *      the walls automatically — so garrison strength breathes with the
 *      kingdom's plans without this manager knowing about them.
 *
 * v1 inheritance (campaign.ts file-top doc comment): each AI kingdom still
 * operates its FIRST village only, so `villageOf` targets exactly that one —
 * never a second AI-founded castle village (none exist yet). M57 generalised
 * the underlying MECHANISM (any keep-bearing village materialises a layer);
 * this manager's own scope stays where the rest of the AI stack already is.
 *
 * Template choice is personality-flavoured but deterministic: the
 * composition supplies `template` (seeded per kingdom, hoisted above the
 * defence layer's own registration so genesis can share the same
 * assignment); this module never draws randomness at all.
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

const index = (id: number): number => id & 0x3fffff;

/** Stone kept back for ordinary construction — fortification never drains the yard. */
export const DEFENCE_STONE_RESERVE = 60;

export interface AiDefenceOptions {
  readonly issuer: number;
  readonly template: CastleTemplateDef;
  /** Dense index of the village this manager fortifies (cost + layer source), or null
   * when landless. M57: village-keyed, not kingdom-keyed — see the module doc comment. */
  readonly villageOf: () => number | null;
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
  defenceGame: DefenceGameplay,
  options: AiDefenceOptions,
): void {
  const { Stockpile } = game.comps;
  const { Unit } = militaryGame;
  const { DefencePost } = defenceGame;
  const targets = expandTemplate(db, options.template);
  const stoneCode = game.ops.resourceCode('base:resource.stone') as number;

  const system: SimSystem = {
    name: options.id !== undefined ? `ai-defence-${options.id}` : 'ai-defence',
    period: TICKS_PER_DAY,
    phase: 8, // after the military manager's daily action, before occupation settles
    access: { reads: [Unit, DefencePost, Stockpile] },
    update(): void {
      const village = options.villageOf();
      if (village === null) return; // landless: nothing to fortify from
      const map = defenceGame.mapOf(village);
      if (map === undefined) return; // no layer yet (no capital grant, no completed Keep)
      const occupancy = defenceGame.occupancyOf(village);

      // ---- 1. build: first plan target whose ground is free (skip = adaptation; this
      // naturally skips whatever defence-genesis already materialised for free) ----
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
        const stock = world.readObj(Stockpile).tryGet(village);
        const stoneCost = def?.cost['base:resource.stone'] ?? 0;
        const stoneHeld = stock?.get(stoneCode) ?? 0;
        // affordability + reserve gate here (a plain read) so the daily rejection stream
        // stays quiet; the command still enforces the REAL atomic cost on execution
        if (stoneHeld >= stoneCost + DEFENCE_STONE_RESERVE) {
          kernel.submit({
            type: 'defence.build',
            issuer: options.issuer,
            payload: { villageId: village, def: buildable.def, x: buildable.x, y: buildable.y },
          });
          // no return: posting is independent — a garrison must not wait 30+ days
          // behind the build queue (readiness beats masonry)
        }
      }

      // ---- 2. post: one idle unit whose HOME is this village to the next free anchor ----
      const u = world.read(Unit);
      const post = world.read(DefencePost);
      const taken = new Set<number>();
      world.query([DefencePost, Unit]).forEach((pi) => {
        if (index(u.homeVillage[pi] as number) === village) taken.add((post.y[pi] as number) * DEFENCE_MAP_SIZE + (post.x[pi] as number));
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
        if (index(u.homeVillage[ui] as number) !== village) return;
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
