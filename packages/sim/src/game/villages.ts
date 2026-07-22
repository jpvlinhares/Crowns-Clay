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
  /** Land movement cost (doc 06 TerrainDef); 0 = impassable (M14 haulers, M26 armies). */
  movementCostAt(x: number, y: number): number;
}

// ---------------------------------------------------------------- constants

export const VILLAGE_RADIUS_T1 = 12; // Chebyshev tiles from center (Hamlet)
export const VILLAGE_RADIUS_T2 = 16; // tier 2 (Village) — GDD §5 "larger radius"
export const VILLAGE_MIN_SPACING = 24; // between centers (GDD §13 site scarcity)
export const CENTER_DEF_ID = 'base:building.village-center';

// ---------------------------------------------------------------- components

export interface VillageComponents {
  readonly VillageCore: SoAComponent<{
    centerX: 'i32'; centerY: 'i32'; radius: 'u16'; tier: 'u8'; taxRate: 'u8';
    // M28 (game/castles.ts, DELETED at M56 — ADR-4 Amendment A1): was true once a village's
    // wall/gate enclosure actually closed. Stays in the save schema, deprecated, never set
    // true again — a format bump is not worth it for a field nothing writes or reads.
    isCastle: 'bool';
  }>;
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
    VillageCore: world.defineSoA('villageCore', {
      centerX: 'i32', centerY: 'i32', radius: 'u16', tier: 'u8', taxRate: 'u8', isCastle: 'bool',
    }),
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

/** M60 (ADR-4 A1): a standing building occupies the footprint it was PLACED with (its persisted
 * BuildingCore.w/h), so a later def-footprint change never retroactively resizes it (the M59
 * fallout). Falls back to the current def only for a pre-w/h save that recorded no per-instance
 * footprint (stored 0) — no building legitimately has a zero dimension, so 0 unambiguously means
 * "absent". Used by every occupancy read/write on load and demolish (one place, one rule). */
function footprintOf(storedW: number, storedH: number, def: BuildingDef): { w: number; h: number } {
  return storedW > 0 && storedH > 0 ? { w: storedW, h: storedH } : { w: def.footprint.w, h: def.footprint.h };
}

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

  /** Building footprint occupancy (roads and haulers route around it, M14). */
  isOccupied(x: number, y: number): boolean {
    return this.occupancy.has(this.tileIndex(x, y));
  }

  /**
   * Rebuild derived indices (occupancy, centers) from ECS state — the ECS is
   * authoritative; these maps are caches. Called after save hydration (M17).
   */
  rebuildDerived(): void {
    this.occupancy.clear();
    this.centers.length = 0;
    const b = this.world.read(this.comps.BuildingCore);
    this.world.query([this.comps.BuildingCore]).forEach((i, entity) => {
      const x = b.x[i] as number;
      const y = b.y[i] as number;
      // M60 (ADR-4 A1) footprint reconciliation: occupy the footprint the building was PLACED
      // with (its own persisted BuildingCore.w/h — hashed SoA fields), NOT the live def. A def
      // whose footprint grew since this save was written (M59 raised tower 1×1→3×3, gatehouse
      // 1×1→3×2) must not retroactively enlarge an already-standing instance and swallow a
      // previously-legal neighbour's tiles. For every building placed by current code stored ==
      // def, so this is a no-op there; it only bites a grandfathered M28-era structure. Fall
      // back to the def only for a pre-w/h save (stored 0 — no footprint was ever recorded).
      const { w, h } = footprintOf(b.w[i] as number, b.h[i] as number, this.buildingDef(b.def[i] as number));
      for (let dy = 0; dy < h; dy++) {
        for (let dx = 0; dx < w; dx++) {
          const tile = this.tileIndex(x + dx, y + dy);
          if (!this.occupancy.has(tile)) this.occupancy.set(tile, entity); // first-writer-wins keeps the cache single-valued under any residual overlap
        }
      }
    });
    const core = this.world.read(this.comps.VillageCore);
    this.world.query([this.comps.VillageCore]).forEach((vi, village) => {
      this.centers.push({ x: core.centerX[vi] as number, y: core.centerY[vi] as number, village });
    });
  }

  /** The single placement rulebook (player, AI, genesis — one code path). */
  validatePlacement(def: BuildingDef, x: number, y: number, village: EntityId | null): PlacementVerdict {
    // M56 (ADR-4 Amendment A1): the village map is not a fortification surface for anyone,
    // player or AI — defence lives exclusively on the M51 layer. This is POLICY, not
    // leak-patching (the earlier 2026-07-20 investigation found no leak — M28 was a
    // shipped, intentional mechanic — but A1 retires it, so the category is barred here now).
    if (def.category === 'castle') return no(`'${def.id}' is a castle structure — build it on the defence map`);
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
      // tier gating (M15; doc 06 Requirement): higher tiers unlock buildings
      const needTier = def.requires?.villageTier ?? 1;
      if ((core.tier[index] as number) < needTier) {
        return no(`requires village tier ${needTier} (currently ${core.tier[index] as number})`);
      }
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

  found(
    ctx: TickContext,
    x: number,
    y: number,
    name: string,
    startingStock: Readonly<Record<string, number>> | ReadonlyMap<number, number>,
    settlers?: { children: number; adults: number; elders: number },
    /** Tags the founded village with its owning kingdom (M22, multi-kingdom only) — the
     * component reference is passed in rather than imported, so villages.ts stays decoupled
     * from kingdom.ts. Omitted for every existing single-kingdom caller. */
    owner?: { component: SoAComponent<{ kingdom: 'eid' }>; kingdomId: EntityId },
  ): EntityId | string {
    const centerDef = this.db.buildings.get(CENTER_DEF_ID) as BuildingDef;
    const verdict = this.validatePlacement(centerDef, x, y, null);
    if (!verdict.ok) return verdict.reason;

    // settlers bring startingStock; the center consumes its cost from it —
    // checked and deducted BEFORE any entity exists (atomic founding)
    const stock = new Map<number, number>();
    if (startingStock instanceof Map) {
      for (const [code, amount] of startingStock) stock.set(code, amount);
    } else {
      for (const [resId, amount] of Object.entries(startingStock as Record<string, number>)) {
        stock.set(this.resourceCode(resId) as number, amount);
      }
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
      taxRate: 2, // 'normal' (M16 TAX_RATES; adjust via village.setTaxRate)
      isCastle: false, // deprecated M28 field (M56) — never set true again
    });
    this.world.attach(village, this.comps.VillageName, name);
    this.world.attach(village, this.comps.Stockpile, stock);
    if (owner !== undefined) this.world.attach(village, owner.component, { kingdom: owner.kingdomId as number });
    this.centers.push({ x, y, village });

    const placed = this.placeValidated(centerDef, x, y, village);
    ctx.events.publish({
      type: 'village.founded',
      tick: ctx.tick,
      // settler-founded villages carry their party's cohorts (M15);
      // absent → the composition's starting population applies.
      // M47.6: the owning kingdom rides on the event so subscribers (victory.ts's
      // defeat bookkeeping) never need an ECS read inside another system's
      // access-guarded scope.
      data: {
        village: village as number, name, x, y,
        ...(settlers !== undefined ? { settlers } : {}),
        ...(owner !== undefined ? { kingdom: owner.kingdomId as number } : {}),
      },
    });
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

  /** The village entity a building belongs to, or null if the building is gone. Used by the
   * ownership guard on `village.demolish` (the command carries a building id, not a village id). */
  villageOfBuilding(buildingId: number): number | null {
    if (!this.world.isAlive(buildingId as EntityId)) return null;
    return this.world.read(this.comps.BuildingCore).village[buildingId & 0x3fffff] as number;
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
    const villageId = core.village[index] as number;
    // M60: vacate the footprint this instance was PLACED with (stored w/h), matching what
    // rebuildDerived claimed — freeing def.footprint could clear tiles a grandfathered
    // neighbour still occupies, or miss tiles this building actually holds.
    const { w, h } = footprintOf(core.w[index] as number, core.h[index] as number, def);
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const tile = this.tileIndex(x + dx, y + dy);
        if (this.occupancy.get(tile) === building) this.occupancy.delete(tile); // only clear tiles THIS entity owns (overlap-safe)
      }
    }
    this.world.despawn(building);
    ctx.events.publish({ type: 'building.demolished', tick: ctx.tick, data: { building: buildingId, def: def.id, village: villageId } });
    return true;
  }

  /**
   * M53 (ADR-4 §3): remove a village from the world entirely — every building
   * despawned (occupancy vacated), the centre entry dropped, the village entity
   * itself despawned. "Everything not carried is destroyed with the settlement —
   * no ghost stockpiles": the caller owns the POLICY (loot first, ownership and
   * kingdom consequences); this is only the mechanism. Building rows are snapshotted
   * BEFORE the despawn loop — dense SoA storage swap-removes on despawn, so reading
   * component data after the first despawn would walk relocated rows.
   */
  raze(ctx: TickContext, villageId: number): true | string {
    const village = villageId as EntityId;
    if (!this.world.isAlive(village) || !this.world.has(village, this.comps.VillageCore)) return 'no such village';
    const vi = villageId & 0x3fffff;
    const name = this.world.readObj(this.comps.VillageName).tryGet(vi) ?? `village ${vi}`;
    const b = this.world.read(this.comps.BuildingCore);
    const doomed: { entity: number; x: number; y: number; w: number; h: number }[] = [];
    this.world.query([this.comps.BuildingCore]).forEach((i, entity) => {
      if (((b.village[i] as number) & 0x3fffff) !== vi) return;
      // M60: the whole village is being removed, so occupancy just needs coherent clearing —
      // vacate the placed footprint (stored w/h) so nothing is left dangling for any instance.
      const { w, h } = footprintOf(b.w[i] as number, b.h[i] as number, this.buildingDef(b.def[i] as number));
      doomed.push({ entity: entity as number, x: b.x[i] as number, y: b.y[i] as number, w, h });
    });
    for (const d of doomed) {
      for (let dy = 0; dy < d.h; dy++) {
        for (let dx = 0; dx < d.w; dx++) {
          const tile = this.tileIndex(d.x + dx, d.y + dy);
          if (this.occupancy.get(tile) === (d.entity as EntityId)) this.occupancy.delete(tile);
        }
      }
      this.world.despawn(d.entity as EntityId);
    }
    const at = this.centers.findIndex((c) => c.village === village);
    if (at >= 0) this.centers.splice(at, 1);
    this.world.despawn(village);
    ctx.events.publish({ type: 'village.razed', tick: ctx.tick, data: { village: villageId, name } });
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
            data: { building: entity as number, def: def.id, village: b.village[i] as number },
          });
        }
      });
    },
  };
}

// ---------------------------------------------------------------- registration

export interface VillageSettings {
  laborGated: boolean;
  /** Hauler slots per village claimed by the jobs solver (set by logistics, M14). */
  haulerTarget: number;
}

/** 1.x ownership guard: does the kingdom acting for `issuer` own `villageId`? Supplied by
 * kingdom.ts (which owns `VillageOwner`) via `setOwnershipGuard` after both layers exist. */
export type VillageOwnershipGuard = (issuer: number, villageId: number) => boolean;

export interface VillageGameplay {
  readonly comps: VillageComponents;
  readonly ops: VillageOps;
  readonly settings: VillageSettings;
  readonly terrain: TerrainAccessor;
  /** 1.x: inject the ownership authority for village-mutating commands (build/demolish here,
   * upgrade in settlers.ts, setTaxRate in kingdom.ts). Late-bound because kingdom.ts — which owns
   * `VillageOwner` — registers after this layer. Un-set ⇒ no restriction (single-kingdom/Terra). */
  setOwnershipGuard(guard: VillageOwnershipGuard): void;
}

export function registerVillageGameplay(
  kernel: Kernel,
  world: World,
  db: DefinitionDatabase,
  terrain: TerrainAccessor,
  startingStock: Readonly<Record<string, number>>,
  /** GDD §17 (roadmap M40): gates `sandbox.*` privileged commands. Defaults false so every
   * existing composition/test (issuer 0 or otherwise) is unaffected — sandbox editing must be
   * opted into at world creation, not merely available because a command type is registered. */
  sandboxEnabled = false,
): VillageGameplay {
  const comps = defineVillageComponents(world);
  const ops = new VillageOps(world, comps, db, terrain);
  const settings: VillageSettings = { laborGated: false, haulerTarget: 0 };

  // `issuer` rides along so the client can tell a PLAYER's own rejected order from an AI
  // kingdom's — the AI construction manager deliberately submits unaffordable orders and
  // relies on this rejection to retry later (see ai/manager.ts's module doc), so without an
  // issuer every AI kingdom's routine "insufficient wood" noise was indistinguishable from
  // the player's own and surfaced as a toast regardless of whose order it was.
  const rejected = (ctx: TickContext, what: string, reason: string, issuer: number): void => {
    ctx.events.publish({ type: 'village.rejected', tick: ctx.tick, data: { what, reason, issuer } });
  };

  // 1.x ownership guard (late-bound from kingdom.ts; un-set ⇒ allow, i.e. single-kingdom/Terra).
  let ownershipGuard: VillageOwnershipGuard | null = null;
  const ownsVillage = (issuer: number, villageId: number): boolean =>
    ownershipGuard === null || ownershipGuard(issuer, villageId);

  kernel.registerCommand<{ x: number; y: number; name: string }>('village.found', (ctx, p, command) => {
    const result = ops.found(ctx, p.x | 0, p.y | 0, String(p.name ?? 'Nameless'), startingStock);
    if (typeof result === 'string') rejected(ctx, 'village.found', result, command.issuer);
  });
  kernel.registerCommand<{ villageId: number; def: string; x: number; y: number }>('village.build', (ctx, p, command) => {
    if (!ownsVillage(command.issuer, p.villageId | 0)) return rejected(ctx, 'village.build', 'not your village', command.issuer);
    const result = ops.place(ctx, p.villageId | 0, String(p.def), p.x | 0, p.y | 0);
    if (typeof result === 'string') rejected(ctx, 'village.build', result, command.issuer);
  });
  kernel.registerCommand<{ buildingId: number }>('village.demolish', (ctx, p, command) => {
    const village = ops.villageOfBuilding(p.buildingId | 0);
    if (village !== null && !ownsVillage(command.issuer, village)) return rejected(ctx, 'village.demolish', 'not your village', command.issuer);
    const result = ops.demolish(ctx, p.buildingId | 0);
    if (typeof result === 'string') rejected(ctx, 'village.demolish', result, command.issuer);
  });

  // ---------------- sandbox editor (roadmap M40; GDD §17) ----------------
  // A privileged command, same bus as every player order — kept in the input
  // log, so a sandbox campaign still replays deterministically (GDD §17
  // "Internal mechanics"). Building/unit spawning is deliberately NOT a
  // separate bypass here: granting resources then issuing the ordinary
  // `village.build` achieves the same "spawn a building" outcome through the
  // one already-validated placement rulebook, rather than a second one.
  kernel.registerCommand<{ villageId: number; resource: string; amount: number }>('sandbox.grantResource', (ctx, p, command) => {
    if (!sandboxEnabled) return rejected(ctx, 'sandbox.grantResource', 'sandbox mode is not enabled', command.issuer);
    const village = p.villageId as EntityId;
    if (!world.isAlive(village) || !world.has(village, comps.VillageCore)) {
      return rejected(ctx, 'sandbox.grantResource', 'no such village', command.issuer);
    }
    if (!db.resources.has(String(p.resource))) {
      return rejected(ctx, 'sandbox.grantResource', `unknown resource '${String(p.resource)}'`, command.issuer);
    }
    const amount = Number(p.amount);
    if (!(amount > 0)) return rejected(ctx, 'sandbox.grantResource', 'amount must be a positive number', command.issuer);
    const stock = world.readObj(comps.Stockpile).tryGet((village as number) & 0x3fffff);
    if (stock === undefined) return rejected(ctx, 'sandbox.grantResource', 'village has no stockpile', command.issuer);
    const code = ops.resourceCode(String(p.resource)) as number;
    stock.set(code, (stock.get(code) ?? 0) + amount);
    ctx.events.publish({
      type: 'sandbox.resourceGranted',
      tick: ctx.tick,
      data: { village: p.villageId, resource: String(p.resource), amount },
    });
  });

  kernel.registerSystem(constructionSystem(world, comps, ops, settings));
  return {
    comps, ops, settings, terrain,
    setOwnershipGuard(guard: VillageOwnershipGuard): void { ownershipGuard = guard; },
  };
}
