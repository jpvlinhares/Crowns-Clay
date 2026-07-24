/**
 * Building placement search (roadmap M20; doc 07 §5). Reuses the ONE
 * placement rulebook (`VillageOps.validatePlacement`, villages.ts) that
 * also validates player and genesis placements — "one code path, no
 * cheating placements". This extracts the spiral-search pattern that
 * `terra.ts`'s demo genesis duplicates ad-hoc, as a reusable helper.
 *
 * Richer site scoring (adjacency, road distance, aura coverage — doc 07 §5)
 * is deferred: nearest-valid-tile is sufficient for a village to survive,
 * since `validatePlacement` already enforces the safety-critical terrain
 * constraints (farms need farmable ground, etc.); no consumer needs finer
 * scoring yet.
 */
import type { EntityId } from '@crowns/core';
import type { BuildingDef } from '@crowns/data';
import type { VillageOps } from '../game/villages.js';

export interface BuildSite {
  readonly x: number;
  readonly y: number;
}

/**
 * Scarce harvester terrains the worldgen guarantee patches exactly ONE buildable block of per
 * capital (worldgen/resourceGuarantee.ts): `mineable` for the quarry, `woodland` for the lumber
 * camp. A building that doesn't itself need one of these must leave it free — a house squatting the
 * only mineable block is precisely what blocks a quarry from ever being built.
 */
export const RESERVED_HARVESTER_TAGS = ['mineable', 'woodland'] as const;

/** True if any tile under `def`'s footprint at (x,y) carries a tag the placement should avoid. */
function footprintTouchesTag(ops: VillageOps, def: BuildingDef, x: number, y: number, avoid: readonly string[]): boolean {
  const { w, h } = def.footprint;
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const tags = ops.tagsAt(x + dx, y + dy);
      for (const tag of avoid) if (tags.includes(tag)) return true;
    }
  }
  return false;
}

/**
 * First valid tile for `def` on an expanding Chebyshev ring search around
 * (centerX, centerY), out to `maxRadius`. Deterministic: rings expand in
 * fixed (dy, dx) order, so the same village state always yields the same
 * site.
 *
 * Two-pass reservation: a building that does NOT itself need a scarce harvester terrain
 * (RESERVED_HARVESTER_TAGS) first tries to avoid squatting one — so the single guaranteed
 * mineable/woodland block stays open for the quarry / lumber camp. If no reserved-free tile exists
 * in range, it falls back to the plain first-valid search (never blocks a needed build outright).
 * A harvester placing ITSELF (its `terrainTags` include the reserved tag) skips the reservation —
 * it has to sit on that ground.
 */
export function findBuildSite(
  ops: VillageOps,
  villageId: EntityId,
  def: BuildingDef,
  centerX: number,
  centerY: number,
  maxRadius: number,
): BuildSite | null {
  const avoid = RESERVED_HARVESTER_TAGS.filter((tag) => !def.terrainTags.includes(tag));

  const search = (respectReserved: boolean): BuildSite | null => {
    for (let r = 1; r <= maxRadius; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = centerX + dx;
          const y = centerY + dy;
          if (!ops.validatePlacement(def, x, y, villageId).ok) continue;
          if (respectReserved && footprintTouchesTag(ops, def, x, y, avoid)) continue;
          return { x, y };
        }
      }
    }
    return null;
  };

  if (avoid.length === 0) return search(false); // this building IS a harvester — it must sit here
  return search(true) ?? search(false); // prefer leaving harvester ground free, else take any valid tile
}
