/**
 * Castles v1 (roadmap M28; GDD §7; doc 06 §4 `Village.isCastle`/`defenseGraph`).
 *
 * A castle is not a separate entity kind — it's what a Village BECOMES once
 * its walls actually close a loop ("Castles are special Village-like
 * entities", GDD §7): wall/gate/tower/keep are ordinary BuildingDefs (placed
 * via the existing `village.build`, no new command) carrying a `defense`
 * block (doc 06 §2). `isCastle` and the DEFENCE GRAPH are DERIVED state,
 * recomputed only when a defense-kind building completes or is demolished —
 * never per-tick.
 *
 * THE ENCLOSURE ALGORITHM (the M28 T objective) is a bounded flood-fill: seed
 * from every tile on the border of a search box around the village (the
 * "outside"), flow through anything that isn't a wall/gate/keep/tower tile,
 * and whatever the flood never reaches is ENCLOSED. Gates block the flood
 * exactly like walls — a defended chokepoint, not a hole (only a BREACH,
 * Sieges' concern at M29, would ever open one). The search box is bounded
 * (village radius + a fixed padding), so cost never scales with map size —
 * independent of the HPA* pathfinder (M26), which answers a different
 * question (army routes) over the whole map.
 *
 * DEFERRED past v1: wall material tiers (wood→stone→reinforced stays a
 * single stone tier), ranged tower arcs and wall/gate HP damage (Sieges,
 * M29), and enforcing `military.garrisonCap` against actually-garrisoned
 * armies (also Siege endurance math, M29) — the field is authored now so the
 * cap exists as content, matching the "data now, active later" pattern from
 * M25's `stats`/`counters`.
 */
import type { EntityId } from '@crowns/core';
import type { DefinitionDatabase } from '@crowns/data';
import { SoAComponent, World } from '../ecs.js';
import type { Kernel, SimSystem } from '../kernel.js';
import type { VillageGameplay } from './villages.js';

const index = (id: number): number => id & 0x3fffff;

export const CASTLE_SEARCH_PADDING = 2; // tiles beyond the village radius searched for enclosure

export interface DefenseNode {
  readonly building: number;
  readonly kind: 'wall' | 'gate' | 'tower' | 'keep';
  readonly x: number;
  readonly y: number;
  readonly hp: number;
  readonly maxHp: number;
}

export interface DefenseGraph {
  readonly nodes: readonly DefenseNode[];
  readonly enclosedTiles: ReadonlySet<number>; // tile index = y*width + x
}

/**
 * Pure: tiles in the box `[x0,x1]×[y0,y1]` NOT reachable from the box's own
 * border without crossing a tile in `wallTiles` are enclosed. Wall tiles
 * themselves are neither "outside" nor "enclosed" — they're the boundary.
 */
export function computeEnclosure(
  wallTiles: ReadonlySet<number>,
  width: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Set<number> {
  const inBox = (x: number, y: number): boolean => x >= x0 && x <= x1 && y >= y0 && y <= y1;
  const visited = new Set<number>();
  const queue: number[] = [];
  const seed = (x: number, y: number): void => {
    if (!inBox(x, y)) return;
    const t = y * width + x;
    if (visited.has(t) || wallTiles.has(t)) return;
    visited.add(t);
    queue.push(t);
  };
  for (let x = x0; x <= x1; x++) {
    seed(x, y0);
    seed(x, y1);
  }
  for (let y = y0; y <= y1; y++) {
    seed(x0, y);
    seed(x1, y);
  }
  let qi = 0;
  while (qi < queue.length) {
    const t = queue[qi] as number;
    qi++;
    const tx = t % width;
    const ty = Math.floor(t / width);
    seed(tx - 1, ty);
    seed(tx + 1, ty);
    seed(tx, ty - 1);
    seed(tx, ty + 1);
  }
  const enclosed = new Set<number>();
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const t = y * width + x;
      if (!visited.has(t) && !wallTiles.has(t)) enclosed.add(t);
    }
  }
  return enclosed;
}

// ---------------------------------------------------------------- components

export type FortificationComponent = SoAComponent<{ hp: 'f64'; maxHp: 'f64' }>;

export interface CastleGameplay {
  readonly Fortification: FortificationComponent;
  defenseGraphOf(villageId: number): DefenseGraph;
  isCastle(villageId: number): boolean;
}

export function registerCastleGameplay(kernel: Kernel, world: World, db: DefinitionDatabase, game: VillageGameplay): CastleGameplay {
  const { VillageCore, BuildingCore } = game.comps;
  const width = game.terrain.width;

  const Fortification: FortificationComponent = world.defineSoA('fortification', { hp: 'f64', maxHp: 'f64' });

  const graphs = new Map<number, DefenseGraph>();
  const EMPTY_GRAPH: DefenseGraph = { nodes: [], enclosedTiles: new Set() };

  const rebuild = (villageIndex: number): void => {
    const core = world.read(VillageCore);
    const b = world.read(BuildingCore);
    const nodes: DefenseNode[] = [];
    const wallTiles = new Set<number>();
    const fort = world.read(Fortification);
    world.query([BuildingCore]).forEach((i, entity) => {
      if (index(b.village[i] as number) !== villageIndex || (b.complete[i] as number) !== 1) return;
      const def = game.ops.buildingDef(b.def[i] as number);
      if (def.defense === undefined) return;
      const x = b.x[i] as number;
      const y = b.y[i] as number;
      const bi = index(entity as number);
      nodes.push({
        building: entity as number, kind: def.defense.kind, x, y,
        hp: (fort.hp[bi] as number) ?? def.defense.hp, maxHp: (fort.maxHp[bi] as number) ?? def.defense.hp,
      });
      for (let dy = 0; dy < def.footprint.h; dy++) {
        for (let dx = 0; dx < def.footprint.w; dx++) wallTiles.add((y + dy) * width + (x + dx));
      }
    });

    if (nodes.length === 0) {
      graphs.set(villageIndex, EMPTY_GRAPH);
      world.write(VillageCore).isCastle[villageIndex] = 0;
      return;
    }
    const cx = core.centerX[villageIndex] as number;
    const cy = core.centerY[villageIndex] as number;
    const radius = (core.radius[villageIndex] as number) + CASTLE_SEARCH_PADDING;
    const enclosedTiles = computeEnclosure(
      wallTiles, width,
      Math.max(0, cx - radius), Math.max(0, cy - radius),
      Math.min(width - 1, cx + radius), Math.min(game.terrain.height - 1, cy + radius),
    );
    graphs.set(villageIndex, { nodes: nodes.sort((a, z) => a.building - z.building), enclosedTiles });
    world.write(VillageCore).isCastle[villageIndex] = enclosedTiles.size > 0 ? 1 : 0;
  };

  // a defense-kind building tracks its own HP the moment it's placed (construction-in-progress included)
  kernel.subscribe<{ building: number; def: string }>('building.placed', (event) => {
    const def = db.buildings.get(event.data.def);
    if (def?.defense === undefined) return;
    world.attach(event.data.building as EntityId, Fortification, { hp: def.defense.hp, maxHp: def.defense.hp });
  });

  // `building.completed` fires from WITHIN construction's own access-guarded system —
  // a subscriber can't safely world.read/write there. Only mark the village dirty (a
  // plain Set op, no ECS access) and let castle-defense-rebuild (below) do the real
  // work under its OWN declared access, once construction's scope has closed.
  const dirty = new Set<number>();
  kernel.subscribe<{ building: number; def: string; village: number }>('building.completed', (event) => {
    const def = db.buildings.get(event.data.def);
    if (def?.defense === undefined) return;
    dirty.add(index(event.data.village));
  });
  kernel.subscribe<{ building: number; def: string; village: number }>('building.demolished', (event) => {
    const def = db.buildings.get(event.data.def);
    if (def?.defense === undefined) return;
    dirty.add(index(event.data.village));
  });

  const rebuildSystem: SimSystem = {
    name: 'castle-defense-rebuild',
    period: 1,
    access: { writes: [VillageCore], reads: [BuildingCore, Fortification] },
    update(): void {
      if (dirty.size === 0) return;
      for (const villageIndex of [...dirty].sort((a, b) => a - b)) rebuild(villageIndex);
      dirty.clear();
    },
  };
  kernel.registerSystem(rebuildSystem);

  return {
    Fortification,
    defenseGraphOf(villageId: number): DefenseGraph {
      return graphs.get(index(villageId)) ?? EMPTY_GRAPH;
    },
    isCastle(villageId: number): boolean {
      return (world.read(VillageCore).isCastle[index(villageId)] as number) === 1;
    },
  };
}
