/**
 * Scouting via distance-based fog reveal (roadmap M22; doc 07 §6). No unit
 * or combat system exists yet (M25), so this is the stand-in doc 07's own
 * scoping note already anticipated ("adjacency-based reveal() until scout/
 * trade/envoy/battle systems land"): a kingdom's fog reveals a foreign
 * village once it's within `SCOUT_REVEAL_RADIUS` of that kingdom's own
 * nearest village. The player's kingdom is just another entry in the
 * kingdom list — fog UI is meaningless without the player having its own
 * `FogRegistry` state, so it isn't special-cased.
 */
import type { Component } from '../ecs.js';
import type { Kernel, SimSystem } from '../kernel.js';
import { TICKS_PER_DAY } from '../time.js';
import { FogRegistry } from './fogQuery.js';

/** 1.5× the territory radius (M22) — "you can see just past your own borders". */
export const SCOUT_REVEAL_RADIUS = 48;

export interface ScoutTarget {
  readonly entityIndex: number;
  readonly x: number;
  readonly y: number;
}

export interface ScoutingKingdom {
  /** FogRegistry key for this kingdom. */
  readonly kingdomIndex: number;
  villages(): readonly ScoutTarget[];
}

export interface ScoutingOptions {
  /** Extra components the `kingdoms[].villages()` callbacks read from `world`. */
  readonly extraReads?: readonly Component[];
}

function chebyshev(a: ScoutTarget, b: ScoutTarget): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/** Daily adjacency-reveal: every kingdom scouts every other kingdom's villages within range. */
export function registerScoutingSystem(
  kernel: Kernel,
  fog: FogRegistry,
  kingdoms: readonly ScoutingKingdom[],
  options: ScoutingOptions = {},
): void {
  kernel.registerSystem({
    name: 'scouting',
    period: TICKS_PER_DAY,
    phase: 5,
    access: { reads: options.extraReads ?? [] },
    update(): void {
      for (const observer of kingdoms) {
        const ownVillages = observer.villages();
        if (ownVillages.length === 0) continue;
        for (const foreign of kingdoms) {
          if (foreign.kingdomIndex === observer.kingdomIndex) continue;
          for (const target of foreign.villages()) {
            let nearest = Infinity;
            for (const own of ownVillages) nearest = Math.min(nearest, chebyshev(own, target));
            if (nearest <= SCOUT_REVEAL_RADIUS) fog.reveal(observer.kingdomIndex, target.entityIndex);
          }
        }
      }
    },
  } satisfies SimSystem);
}
