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
 * First valid tile for `def` on an expanding Chebyshev ring search around
 * (centerX, centerY), out to `maxRadius`. Deterministic: rings expand in
 * fixed (dy, dx) order, so the same village state always yields the same
 * site.
 */
export function findBuildSite(
  ops: VillageOps,
  villageId: EntityId,
  def: BuildingDef,
  centerX: number,
  centerY: number,
  maxRadius: number,
): BuildSite | null {
  for (let r = 1; r <= maxRadius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = centerX + dx;
        const y = centerY + dy;
        if (ops.validatePlacement(def, x, y, villageId).ok) return { x, y };
      }
    }
  }
  return null;
}
