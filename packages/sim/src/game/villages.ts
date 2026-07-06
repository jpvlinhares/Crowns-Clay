/**
 * Village core gameplay (roadmap M11; GDD §5; doc 08 §2 slot 7).
 *
 * One placement validator serves player commands, the future AI construction
 * manager, and scripted genesis alike (Engine §5: "shares the player's
 * placement validator — one code path, no cheating placements").
 *
 * M11 scope lines, marked where they couple to later milestones:
 *  - construction advances at 1/buildTicks per hour (labor coupling → M12)
 *  - materials are reserved in full at placement (doc 08 §6)
 *  - production/housing/service fields validate but sleep until M12–M13
 */
import { Interner, invariant, type EntityId, type InternedId } from '@crowns/core';
import type { BuildingDef, DefinitionDatabase } from '@crowns/data';
import { ObjectComponent, SoAComponent, World } from '../ecs.js';
import type { Kernel, SimSystem, TickContext } from '../kernel.js';

// ---------------------------------------------------------------- terrain

/** What placement needs to know about the map — worldgen-agnostic by design. */
export interface TerrainAccessor {
  readonly width: number;
  readonly height: number;
  tagsAt(x: number, y: number): readonly string[];
  riverAt(x: number, y: number): boolean;
}

// ---------------------------------------------------------------- constants

export const VILLAGE_RADIUS_T1 = 12; // Chebyshev tiles from center (tiering → M15)
export const VILLAGE_MIN_SPACING = 24; // between centers (GDD §13 site scarcity)
export const CENTER_DEF_ID = 'base:building.village-center';

// ---------------------------------------------------------------- components

export interface VillageComponents {
  readonly VillageCore: SoAComponent<{ centerX: 'i32'; centerY: 'i32'; radius: 'u16'; tier: 'u8' }>;
  readonly VillageName: ObjectComponent<string>;
  readonly Stockpile: ObjectComponent<Map<number, number>>; // interned resource → amount
  readonly BuildingCore: SoAComponent<{
    def: 'u32'; // interned def id
    x: 'i32';
    y: 'i32';
    w: 'u8';
    h: 'u8';
    village: 'eid';
    progress: 'f64'; // 0..1
    complete: 'bool';
    workers: 'u16'; // assigned by the jobs solver (M12); builders for sites
  }>;
}

export function defineVillageComponents(world: World): VillageComponents {
  return {
    VillageCore: world.defineSoA('villageCore', { centerX: 'i32', centerY: 'i32', radius: 'u16', tier: 'u8' }),
    VillageName: world.defineObject<string>('villageName', (name, fold) => {
      for (let i = 0; i < name.length; i++) fold(name.charCodeAt(i));
    }),
    Stockpile: world.defineObject<Map<number, number>>('stockpile', (stock, fold) => {
      for (const key of [...stock.keys()].sort((a, b) => a - b)) {
        fold(key);
        fold(stock.get(key) as number);
      }
    }),
    BuildingCore: world.defineSoA('buildingCore', {
      def: 'u32', x: 'i32', y: 'i32', w: 'u8', h: 'u8', village: 'eid', progress: 'f64', complete: 'bool', workers: 'u16',
    }),
  };
}

// ---------------------------------------------------------------- placement

export type PlacementVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

const no = (reason: string): PlacementVerdict => ({ ok: false, reason });

export class VillageOps {
  private readonly interner = new Interner();
  private readonly defByCode = new Map<number, BuildingDef>();
  /** tile index → building entity (derived state; rebuilt on load, M17). */
  private readonly occupancy = new Map<number, EntityId>();
  private readonly centers: { x: number; y: number; village: EntityId }[] = [];

  constructor(
    private readonly world: World,
    private readonly comps: VillageComponents,
    private readonly db: DefinitionDatabase,
    private readonly terrain: TerrainAccessor,
  ) {
    // intern all def + resource ids in sorted order → stable codes (TDD §5)
    for (const id of [...db.buildings.keys()].sort()) {
      this.defByCode.set(this.interner.intern(id) as number, db.buildings.get(id) as BuildingDef);
    }
    for (const id of [...db.resources.keys()].sort()) this.interner.intern(id);
  }

  resourceCode(id: string): InternedId {
    const code = this.interner.peek(id);
    invariant(code !== undefined, `unknown resource '${id}'`);
    return code;
  }

  buildingDef(code: number): BuildingDef {
    const def = this.defByCode.get(code);
    invariant(def !== undefined, `unknown building code ${code}`);
    return def;
  }

  defCode(id: string): number {
    const code = this.interner.peek(id);
    invariant(code !== undefined && this.defByCode.has(code as number), `unknown building '${id}'`);
    return code as number;
  }

  private tileIndex(x: number, y: number): number {
    return y * this.terrain.width + x;
  }

  /** The single placement rulebook (player, AI, genesis — one code path). */
  validatePlacement(def: BuildingDef, x: number, y: number, village: EntityId | null): PlacementVerdict {
    const { w, h } = def.footprint;
    if (x < 0 || y < 0 || x + w > this.terrain.width || y + h > this.terrain.height) {
      return no('out of bounds');
    }
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const tx = x + dx;
        const ty = y + dy;
        if (this.riverBlocked(def, tx, ty)) return no(`river at (${tx}, ${ty})`);
        const tags = this.terrain.tagsAt(tx, ty);
        for (const required of def.terrainTags) {
          if (!tags.includes(required)) {
            return no(`tile (${tx}, ${ty}) lacks terrain tag '${required}'`);
          }
        }
        if (this.occupancy.has(this.tileIndex(tx, ty))) return no(`tile (${tx}, ${ty}) occupied`);
      }
    }
    const isCenter = def.tags.includes('center');
    if (isCenter) {
      for (const c of this.centers) {
        if (Math.max(Math.abs(c.x - x), Math.abs(c.y - y)) < VILLAGE_MIN_SPACING) {
          return no(`too close to another village center (min spacing ${VILLAGE_MIN_SPACING})`);
        }
      }
    } else {
      if (village === null || !this.world.isAlive(village)) return no('no such village');
      const core = this.world.read(this.comps.VillageCore);
      const index = (village as number) & 0x3fffff;
      const cx = core.centerX[index] as number;
      const cy = core.centerY[index] as number;
      const radius = core.radius[index] as number;
      // every footprint corner inside the village radius
      const far = Math.max(
        Math.max(Math.abs(cx - x), Math.abs(cy - y)),
        Math.max(Math.abs(cx - (x + w - 1)), Math.abs(cy - (y + h - 1))),
      );
      if (far > radius) return no(`outside village radius (${far} > ${radius})`);
    }
    return { ok: true };
  }

  private riverBlocked(def: BuildingDef, x: number, y: number): boolean {
    // river/lake tiles are unbuildable unless the def is explicitly aquatic
    return this.terrain.riverAt(x, y) && !def.terrainTags.some((t) => t === 'dockable' || t === 'water');
  }

  /** Deduct a building's full cost from the stockpile, or report what's short. */
  private reserveCost(village: EntityId, def: BuildingDef): PlacementVerdict {
    const stock = this.world.readObj(this.comps.Stockpile).get((village as number) & 0x3fffff);
    for (const [resId, amount] of Object.entries(def.cost)) {
      const have = stock.get(this.resourceCode(resId) as number) ?? 0;
      if (have < amount) return no(`insufficient ${resId} (${have}/${amount})`);
    }
    for (const [resId, amount] of Object.entries(def.cost)) {
      const code = this.resourceCode(resId) as number;
      stock.set(code, (stock.get(code) as number) - amount);
    }
    return { ok: true };
  }

  found(ctx: TickContext, x: number, y: number, name: string, startingStock: Readonly<Record<string, number>>): EntityId | string {
    const centerDef = this.db.buildings.get(CENTER_DEF_ID) as BuildingDef;
    const verdict = this.validatePlacement(centerDef, x, y, null);
    if (!verdict.ok) return verdict.reason;

    // settlers bring startingStock; the center consumes its cost from it —
    // checked and deducted BEFORE any entity exists (atomic founding)
    const stock = new Map<number, number>();
    for (const [resId, amount] of Object.entries(startingStock)) {
      stock.set(this.resourceCode(resId) as number, amount);
    }
    for (const [resId, amount] of Object.entries(centerDef.cost)) {
      const have = stock.get(this.resourceCode(resId) as number) ?? 0;
      if (have < amount) return `insufficient ${resId} to found (${have}/${amount})`;
    }
    for (const [resId, amount] of Object.entries(centerDef.cost)) {
      const code = this.resourceCode(resId) as number;
      stock.set(code, (stock.get(code) as number) - amount);
    }

    const village = this.world.spawn();
    this.world.attach(village, this.comps.VillageCore, {
      centerX: x, centerY: y, radius: VILLAGE_RADIUS_T1, tier: 1,
    });
    this.world.attach(village, this.comps.VillageName, name);
    this.world.attach(village, this.comps.Stockpile, stock);
    this.centers.push({ x, y, village });

    const placed = this.placeValidated(centerDef, x, y, village);
    ctx.events.publish({ type: 'village.founded', tick: ctx.tick, data: { village: village as number, name, x, y } });
    void placed;
    return village;
  }

  place(ctx: TickContext, villageId: number, defId: string, x: number, y: number): EntityId | string {
    const village = villageId as EntityId;
    const def = this.db.buildings.get(defId);
    if (def === undefined) return `unknown building '${defId}'`;
    const verdict = this.validatePlacement(def, x, y, village);
    if (!verdict.ok) return verdict.reason;
    const paid = this.reserveCost(village, def);
    if (!paid.ok) return paid.reason;
    const building = this.placeValidated(def, x, y, village);
    ctx.events.publish({
      type: 'building.placed', tick: ctx.tick,
      data: { building: building as number, def: defId, x, y, village: villageId },
    });
    return building;
  }

  private placeValidated(def: BuildingDef, x: number, y: number, village: EntityId): EntityId {
    const building = this.world.spawn();
    this.world.attach(building, this.comps.BuildingCore, {
      def: this.defCode(def.id), x, y, w: def.footprint.w, h: def.footprint.h,
      village: village as number, progress: 0, complete: false,
    });
    for (let dy = 0; dy < def.footprint.h; dy++) {
      for (let dx = 0; dx < def.footprint.w; dx++) {
        this.occupancy.set(this.tileIndex(x + dx, y + dy), building);
      }
    }
    return building;
  }

  demolish(ctx: TickContext, buildingId: number): true | string {
    const building = buildingId as EntityId;
    if (!this.world.isAlive(building)) return 'no such building';
    const core = this.world.read(this.comps.BuildingCore);
    const index = buildingId & 0x3fffff;
    const def = this.buildingDef(core.def[index] as number);
    if (def.tags.includes('center')) return 'cannot demolish a village center';
    const x = core.x[index] as number;
    const y = core.y[index] as number;
    for (let dy = 0; dy < def.footprint.h; dy++) {
      for (let dx = 0; dx < def.footprint.w; dx++) {
        this.occupancy.delete(this.tileIndex(x + dx, y + dy));
      }
    }
    this.world.despawn(building);
    ctx.events.publish({ type: 'building.demolished', tick: ctx.tick, data: { building: buildingId } });
    return true;
  }
}

// ---------------------------------------------------------------- system

export const BUILDERS_PER_SITE = 2;

/**
 * Hourly construction progress (doc 08 §2 slot 7). When population gameplay is
 * registered it flips `settings.laborGated`: progress then scales by assigned
 * builders / BUILDERS_PER_SITE (assigned by the jobs solver, one-hour lag on
 * fresh sites). Ungated (tests, minimal compositions): full speed.
 */
export function constructionSystem(
  world: World,
  comps: VillageComponents,
  ops: VillageOps,
  settings: VillageSettings,
): SimSystem {
  return {
    name: 'construction',
    period: 1,
    access: { writes: [comps.BuildingCore] },
    update(ctx: TickContext): void {
      const b = world.write(comps.BuildingCore);
      world.query([comps.BuildingCore]).forEach((i, entity) => {
        if ((b.complete[i] as number) === 1) return;
        const def = ops.buildingDef(b.def[i] as number);
        const labor = settings.laborGated
          ? Math.min(1, (b.workers[i] as number) / BUILDERS_PER_SITE)
          : 1;
        const next = Math.min(1, (b.progress[i] as number) + labor / def.buildTicks);
        b.progress[i] = next;
        if (next >= 1) {
          b.complete[i] = 1;
          ctx.events.publish({
            type: 'building.completed', tick: ctx.tick,
            data: { building: entity as number, def: def.id },
          });
        }
      });
    },
  };
}

// ---------------------------------------------------------------- registration

export interface VillageSettings {
  laborGated: boolean;
}

export interface VillageGameplay {
  readonly comps: VillageComponents;
  readonly ops: VillageOps;
  readonly settings: VillageSettings;
}

export function registerVillageGameplay(
  kernel: Kernel,
  world: World,
  db: DefinitionDatabase,
  terrain: TerrainAccessor,
  startingStock: Readonly<Record<string, number>>,
): VillageGameplay {
  const comps = defineVillageComponents(world);
  const ops = new VillageOps(world, comps, db, terrain);
  const settings: VillageSettings = { laborGated: false };

  const rejected = (ctx: TickContext, what: string, reason: string): void => {
    ctx.events.publish({ type: 'village.rejected', tick: ctx.tick, data: { what, reason } });
  };

  kernel.registerCommand<{ x: number; y: number; name: string }>('village.found', (ctx, p) => {
    const result = ops.found(ctx, p.x | 0, p.y | 0, String(p.name ?? 'Nameless'), startingStock);
    if (typeof result === 'string') rejected(ctx, 'village.found', result);
  });
  kernel.registerCommand<{ villageId: number; def: string; x: number; y: number }>('village.build', (ctx, p) => {
    const result = ops.place(ctx, p.villageId | 0, String(p.def), p.x | 0, p.y | 0);
    if (typeof result === 'string') rejected(ctx, 'village.build', result);
  });
  kernel.registerCommand<{ buildingId: number }>('village.demolish', (ctx, p) => {
    const result = ops.demolish(ctx, p.buildingId | 0);
    if (typeof result === 'string') rejected(ctx, 'village.demolish', result);
  });

  kernel.registerSystem(constructionSystem(world, comps, ops, settings));
  return { comps, ops, settings };
}
