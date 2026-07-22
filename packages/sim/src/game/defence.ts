/**
 * Defence layer core (roadmap M49; ADR-4; GDD §7 Phase 8 delta). Campaign-only.
 *
 * M57 (ADR-4 Amendment A1, ratified option (C)): the layer is keyed to a VILLAGE,
 * not a kingdom. Any village with a completed `base:building.keep` (M57: recategorised
 * from 'castle' to 'military' — an ordinary village-map building again) grows its own
 * ~100×100 defence map (worldgen/defenceMap.ts) with the keep pre-placed at centre.
 * A kingdom's CAPITAL is the one preserved political exception (A1): it gets the layer
 * and the cost-free genesis keep UNCONDITIONALLY, whether or not it has actually built
 * a village-map Keep — "the crown's seat is fortified by right." Every other village
 * earns its layer by building one. Players (M50 UI) and AI templates (M52) place
 * defensive structures and post garrison units here; the M51 spatial resolver consumes
 * the layout as the siege ASSAULT phase's input.
 *
 * DESIGN CONSTRAINTS (ADR-4 §6, amended at M57):
 *   - same World, no second store: structures are ordinary entities carrying
 *     `DefenceStructure` (+ `Fortification`, the HP component — re-homed here
 *     from the deleted castles.ts at M56, one damage vocabulary for M51), so
 *     queries, access guards, state hashing, and worldSection persistence all
 *     apply unmodified;
 *   - structures cost MAIN-ECONOMY resources, drawn atomically from the
 *     STRUCTURE'S OWN VILLAGE stockpile (M57: no longer pooled through a
 *     kingdom's capital — a sacked frontier hamlet's castle is its own burden,
 *     matching M58 repair's "paid from the village's own stores" rule), the
 *     check-all-then-deduct-all idiom of army.recruitUnit, recorded on the
 *     village ledger under the existing 'built' flow;
 *   - garrison comes from the SAME soldier pool: `defence.post` assigns a
 *     complete, army-free Unit to a layer tile via `DefencePost`. (A posted
 *     unit can still be drafted by army-assembly commands — M51 defines the
 *     conflict rule when the resolver starts consuming posts; until then a
 *     draft simply strands a stale post, which unpost clears.)
 *   - M49 simplification, documented: defence structures complete INSTANTLY
 *     on payment. Build pacing (progress ticks) arrives with the M50 surface
 *     if playtests want it; the atomic-cost contract is what M49 pins.
 *   - M57: a keep-bearing village's FREE tiered core (an owning kingdom's
 *     assigned template's `tier`-tagged entries, materialised as the village
 *     reaches that village-tier) is genesis-derived, additive, idempotent by
 *     presence — see `defence-genesis` below. Everything past the free core is
 *     "ambition": paid, one-per-day, via the ordinary `defence.build` command.
 *
 * Maps regenerate from their seed on load; a DEFENCE_MAP_VERSION mismatch
 * falls back to the save's stored tiles (see restore()).
 */
import type { EntityId } from '@crowns/core';
import type { BuildingDef, CastleTemplateDef, DefinitionDatabase } from '@crowns/data';
import { expandPlanEntry } from '@crowns/data';
import { SoAComponent, World } from '../ecs.js';
import type { Kernel, TickContext } from '../kernel.js';
import { TICKS_PER_DAY } from '../time.js';
import {
  DEFENCE_MAP_SIZE,
  DEFENCE_MAP_VERSION,
  DEFENCE_TILE,
  decodeDefenceMap,
  defenceMapSeed,
  digestDefenceMap,
  encodeDefenceMap,
  generateDefenceMap,
} from '../worldgen/defenceMap.js';
import type { VillageGameplay } from './villages.js';
import type { EconomyGameplay } from './economy.js';
import type { MilitaryGameplay } from './military.js';

const index = (id: number): number => id & 0x3fffff;

export const KEEP_DEF = 'base:building.keep';
export const DEFENCE_KEEP_CENTRE = Math.floor(DEFENCE_MAP_SIZE / 2);
/** M58 (ADR-4 A1): the strike-again-before-they-recover window a Repair order buys —
 * cost is paid immediately, but hp only returns at the end of this window (a defender
 * who just paid for repairs is still weak for this long). Balance material, alongside
 * ASSAULT_WALL_DAMAGE/DEFENCE_STONE_RESERVE — tunable without touching the mechanism. */
export const REPAIR_DURATION_DAYS = 10;

// ---------------------------------------------------------------- components

/** A structure standing on some village's defence layer (not on the world map).
 * M57: `village` is the OWNING VILLAGE's dense index — re-keyed from a kingdom index
 * (kept as the FIELD NAME 'village' rather than the old 'kingdom' via a world-section
 * migration; see `registerMigration('world', 1, ...)` in campaign.ts and this module's
 * `remapLegacyOwners`, which fixes the STORED VALUES up in afterLoad once the
 * kingdom→capital-village binding is known — a pure Migration function has no access to
 * that binding, only the section's own payload). */
export type DefenceStructureComponent = SoAComponent<{
  village: 'u32'; // owning village, dense index
  def: 'u32'; // interned building-def code (villages.ts interner)
  x: 'u16';
  y: 'u16';
}>;

/** A garrison assignment: this Unit stands at (x, y) of its village's layer. */
export type DefencePostComponent = SoAComponent<{ x: 'u16'; y: 'u16' }>;

/** Structure HP — re-homed here from castles.ts at M56 (the layer is its only consumer
 * since M55 retired the village-map fortification path that used to share it). */
export type FortificationComponent = SoAComponent<{ hp: 'f64'; maxHp: 'f64' }>;

// ---------------------------------------------------------------- state

export interface DefenceMapState {
  readonly village: number; // dense village index
  seed: number;
  version: number;
  tiles: Uint8Array;
  digest: number;
}

export interface DefenceGameplay {
  readonly DefenceStructure: DefenceStructureComponent;
  readonly DefencePost: DefencePostComponent;
  readonly Fortification: FortificationComponent;
  mapOf(villageIndex: number): DefenceMapState | undefined;
  /** Occupied layer tiles (footprint-expanded) for one village: tile → structure entity. */
  occupancyOf(villageIndex: number): ReadonlyMap<number, number>;
  /** M51: a BREACH — the assault resolver levels a structure (occupancy maintained). */
  removeStructure(entity: number): void;
  save(): { k: number; seed: number; version: number; tiles: number[] }[];
  restore(data: readonly { k: number; seed: number; version: number; tiles: readonly number[] }[]): void;
  /** afterLoad: rebuild the occupancy index from DefenceStructure components. */
  rebuildDerived(): void;
  /** afterLoad, PRE-M57 saves only: `DefenceStructure.village` and the map keys still hold
   * raw KINGDOM indices (the world-section migration renames the field but cannot touch
   * values — it has no access to the kingdom→capital-village binding, only its own
   * payload). Campaign.ts calls this once, after `villageIndexByKingdom` is restored,
   * gated on `saves.originalVersionOf('defence')` predating v2. No-op on a current save. */
  remapLegacyOwners(capitalOfKingdom: (kingdomIndex: number) => number | null): void;
  /** 1.x ownership guard for defence.build/demolish/post/unpost — late-bound because
   * kingdom.ts (which owns `VillageOwner`) registers after this layer. Un-set ⇒ no
   * restriction (single-kingdom/Terra). Takes a DENSE VILLAGE INDEX, never a full entity
   * id — matching every other accessor here. */
  setOwnershipGuard(guard: (issuer: number, villageIndex: number) => boolean): void;
  /** M58: `def.cost × (1 − hp/maxHp)` summed over the village's structures, per resource
   * id, rounded up to whole units at the total (never per-structure — avoids compounding
   * ceil bias). Empty map = nothing damaged. Pure/read-only: the panel, the AI's
   * affordability pre-check, and `defence.repair`'s real atomic charge all share this one
   * formula, so none of them can drift from the others. */
  repairCostOf(villageIndex: number): ReadonlyMap<string, number>;
  /** M58: the tick this village's in-flight repair completes, or undefined if it isn't
   * currently repairing (never started, or already resolved). */
  repairingUntil(villageIndex: number): number | undefined;
  /** M58: repair-window state, keyed by village dense index. Optional section (absent on
   * pre-M58 saves — nothing was ever mid-repair before this milestone existed). */
  saveRepairs(): readonly { readonly v: number; readonly until: number }[];
  restoreRepairs(data: readonly { readonly v: number; readonly until: number }[]): void;
}

export interface DefenceOptions {
  readonly worldSeed: number;
  /** Every currently-alive village, dense index, stable ascending order — drives
   * per-village map generation and the genesis sweep. Re-queried each genesis tick
   * (villages are founded, and razed, over a campaign's life). */
  readonly villageIndices: () => readonly number[];
  /** A1's one preserved political exception: a capital gets the layer and the
   * cost-free genesis keep UNCONDITIONALLY. Every other village earns it by building
   * a completed `base:building.keep` (checked internally via BuildingCore). */
  readonly isCapital: (villageIndex: number) => boolean;
  /** The FREE tiered core's archetype for this village (its owning kingdom's assigned
   * template), or undefined for no additive core — the village still gets the bare
   * cost-free keep if eligible, just no template-derived ring around it. */
  readonly templateOf: (villageIndex: number) => CastleTemplateDef | undefined;
  /** M58: is this village currently besieged? `defence.repair` is blocked while true — a
   * stone-rich defender who could out-repair the bombardment would otherwise be
   * unbreakable. `siegeGame` already exists by the time this layer registers (campaign.ts
   * registration order), so this is a plain closure, not a late-bound setter. */
  readonly isUnderSiege: (villageIndex: number) => boolean;
}

// ---------------------------------------------------------------- register

export function registerDefenceGameplay(
  kernel: Kernel,
  world: World,
  db: DefinitionDatabase,
  game: VillageGameplay,
  econGame: EconomyGameplay,
  militaryGame: MilitaryGameplay,
  options: DefenceOptions,
): DefenceGameplay {
  const { Stockpile, BuildingCore, VillageCore } = game.comps;
  const { Unit } = militaryGame;
  const Fortification: FortificationComponent = world.defineSoA('fortification', { hp: 'f64', maxHp: 'f64' });
  const size = DEFENCE_MAP_SIZE;

  const DefenceStructure: DefenceStructureComponent = world.defineSoA('defenceStructure', {
    village: 'u32',
    def: 'u32',
    x: 'u16',
    y: 'u16',
  });
  const DefencePost: DefencePostComponent = world.defineSoA('defencePost', { x: 'u16', y: 'u16' });
  // military-upkeep's deserter despawn detaches DefencePost from posted units — it must
  // declare the component it cannot import (the M34 extension-point pattern; found by the
  // M53 balance matrix when a broke kingdom's posted garrison deserted).
  militaryGame.registerUnitExtension(DefencePost);

  // ---- maps: generated lazily per village, the first tick that village is eligible ----
  const maps = new Map<number, DefenceMapState>();
  const ensureMap = (vi: number): DefenceMapState => {
    let m = maps.get(vi);
    if (m === undefined) {
      const seed = defenceMapSeed(options.worldSeed, vi);
      const tiles = generateDefenceMap(seed);
      m = { village: vi, seed, version: DEFENCE_MAP_VERSION, tiles, digest: digestDefenceMap(tiles) };
      maps.set(vi, m);
    }
    return m;
  };

  // ---- derived occupancy: village → (tile index → structure entity) ----
  const occupancy = new Map<number, Map<number, number>>();
  const occupancyFor = (vi: number): Map<number, number> => {
    let m = occupancy.get(vi);
    if (m === undefined) occupancy.set(vi, (m = new Map()));
    return m;
  };
  const footprintTiles = (def: BuildingDef, x: number, y: number): number[] => {
    const out: number[] = [];
    for (let dy = 0; dy < def.footprint.h; dy++) {
      for (let dx = 0; dx < def.footprint.w; dx++) out.push((y + dy) * size + (x + dx));
    }
    return out;
  };
  const occupy = (vi: number, entity: number, def: BuildingDef, x: number, y: number): void => {
    const m = occupancyFor(vi);
    for (const t of footprintTiles(def, x, y)) m.set(t, entity);
  };
  const vacate = (vi: number, def: BuildingDef, x: number, y: number): void => {
    const m = occupancyFor(vi);
    for (const t of footprintTiles(def, x, y)) m.delete(t);
  };

  const keepDef = db.buildings.get(KEEP_DEF);
  if (keepDef === undefined) throw new Error(`defence layer: missing '${KEEP_DEF}' def`);
  const keepOrigin = DEFENCE_KEEP_CENTRE - Math.floor(keepDef.footprint.w / 2);
  const keepCode = game.ops.defCode(KEEP_DEF);
  const spawnStructure = (vi: number, def: BuildingDef, x: number, y: number): number => {
    const entity = world.spawn();
    world.attach(entity, DefenceStructure, { village: vi, def: game.ops.defCode(def.id), x, y });
    world.attach(entity, Fortification, { hp: def.defense?.hp ?? 1, maxHp: def.defense?.hp ?? 1 });
    occupy(vi, entity as number, def, x, y);
    return entity as number;
  };

  // ---- M58: repair. `def.cost × (1 − hp/maxHp)` summed over the village's structures —
  // no repair-cost table, the def's own build cost IS the repair cost (self-balancing:
  // towers hurt more than wall segments). repairingUntil is keyed by village dense index;
  // ONE field per village, matching the roadmap's shape ("the strike-again-before-they-
  // recover window survives" instant repair would delete). ----
  const repairingUntil = new Map<number, number>();
  const repairCostOf = (vi: number): Map<string, number> => {
    const totals = new Map<string, number>(); // resource id → fractional total (pre-ceil)
    const s = world.read(DefenceStructure);
    const fort = world.read(Fortification);
    world.query([DefenceStructure]).forEach((si) => {
      if (index(s.village[si] as number) !== vi) return;
      const hp = fort.hp[si] as number;
      const maxHp = fort.maxHp[si] as number;
      if (maxHp <= 0 || hp >= maxHp) return;
      const missing = 1 - hp / maxHp;
      const def = game.ops.buildingDef(s.def[si] as number);
      for (const [resId, amount] of Object.entries(def.cost)) {
        totals.set(resId, (totals.get(resId) ?? 0) + amount * missing);
      }
    });
    // ceil at the TOTAL, not per-structure — many small fragments ceiling individually
    // would compound into a materially larger bill than the formula actually prices.
    const out = new Map<string, number>();
    for (const [resId, amount] of totals) {
      const whole = Math.ceil(amount);
      if (whole > 0) out.set(resId, whole);
    }
    return out;
  };

  // ---- genesis: every eligible village's layer materialises, idempotent by presence.
  // Eligible = a capital (A1's exception, unconditional) OR carries a COMPLETED
  // village-map Keep. Two things happen per eligible village, both cost-free:
  //   1. the keep itself, unconditionally (the mechanism the codebase already reuses —
  //      "restores what the Keep def already is", ADR-4 A1 option (C));
  //   2. the owning kingdom's assigned template's TIER-TAGGED entries whose tier is at
  //      or below the village's current tier — additive, so a tier-up spawns only the
  //      newly-unlocked entries (presence-checked per tile) and heals/duplicates nothing.
  // Spawned from a SYSTEM (not at registration): the load path hydrates into a freshly
  // composed session whose world must be EMPTY (ecs loadState invariant), so genesis-owned
  // entities may only appear once ticking starts.
  const keepBearingVillages = (): Set<number> => {
    const out = new Set<number>();
    const b = world.read(BuildingCore);
    world.query([BuildingCore]).forEach((bi) => {
      if ((b.def[bi] as number) !== keepCode || (b.complete[bi] as number) !== 1) return;
      out.add(index(b.village[bi] as number));
    });
    return out;
  };
  kernel.registerSystem({
    name: 'defence-genesis',
    period: 1,
    access: { reads: [BuildingCore, VillageCore], writes: [DefenceStructure, Fortification] },
    update(ctx: TickContext): void {
      const keepBuilt = keepBearingVillages();
      const s = world.read(DefenceStructure);
      const core = world.read(VillageCore);
      for (const vi of options.villageIndices()) {
        if (!options.isCapital(vi) && !keepBuilt.has(vi)) continue;
        ensureMap(vi);
        const present = new Set<number>(); // tiles already occupied by THIS village's structures
        world.query([DefenceStructure]).forEach((si) => {
          if (index(s.village[si] as number) === vi) present.add((s.y[si] as number) * size + (s.x[si] as number));
        });
        // 1. the keep, unconditional
        const keepTile = keepOrigin * size + keepOrigin;
        if (!present.has(keepTile)) {
          const keep = spawnStructure(vi, keepDef, keepOrigin, keepOrigin);
          ctx.events.publish({ type: 'defence.built', tick: ctx.tick, data: { village: vi, structure: keep, def: KEEP_DEF, x: keepOrigin, y: keepOrigin } });
        }
        // 2. the free tiered core — additive by tier, presence-checked per tile
        const template = options.templateOf(vi);
        if (template === undefined) continue;
        const tier = core.tier[vi] as number;
        for (const entry of template.plan) {
          if (entry.tier === undefined || entry.tier > tier) continue;
          const entryDef = db.buildings.get(entry.def);
          if (entryDef === undefined) continue;
          const map = maps.get(vi) as DefenceMapState;
          const occ = occupancyFor(vi);
          for (const [dx, dy] of expandPlanEntry(entry)) {
            const x = DEFENCE_KEEP_CENTRE + dx;
            const y = DEFENCE_KEEP_CENTRE + dy;
            if (x < 0 || y < 0 || x + entryDef.footprint.w > size || y + entryDef.footprint.h > size) continue;
            const tile = y * size + x;
            if (map.tiles[tile] !== DEFENCE_TILE.open || occ.has(tile)) continue; // terrain/occupancy skip — same adaptation ai/defence.ts uses
            const built = spawnStructure(vi, entryDef, x, y);
            ctx.events.publish({ type: 'defence.built', tick: ctx.tick, data: { village: vi, structure: built, def: entry.def, x, y } });
          }
        }
      }
    },
  });

  // ---- village.razed cleanup: a razed village's layer is orphaned entities and stale
  // map state. Reactive (not an explicit per-caller reset call, M57 simplification over
  // the old resetKingdom): whoever razes a village (succession's capital-death chain,
  // sandbox tooling, ...) gets this for free, subscriber discipline (state only). ----
  kernel.subscribe<{ village: number }>('village.razed', (event) => {
    const vi = index(event.data.village);
    const s = world.read(DefenceStructure);
    const doomed: { entity: number; def: BuildingDef; x: number; y: number }[] = [];
    world.query([DefenceStructure]).forEach((si, entity) => {
      if (index(s.village[si] as number) !== vi) return;
      doomed.push({ entity: entity as number, def: game.ops.buildingDef(s.def[si] as number), x: s.x[si] as number, y: s.y[si] as number });
    });
    for (const d of doomed) {
      vacate(vi, d.def, d.x, d.y);
      world.despawn(d.entity as EntityId);
    }
    maps.delete(vi);
    occupancy.delete(vi);
    repairingUntil.delete(vi); // M58: a razed village's in-flight repair is moot
  });

  // ---- helpers ----
  // Late-bound (kingdom.ts registers after this layer, same pattern as villages.ts's own
  // setOwnershipGuard) — takes a DENSE VILLAGE INDEX throughout, matching every other
  // accessor in this module (never a full entity id). Un-set ⇒ no restriction
  // (single-kingdom/Terra).
  let ownershipGuard: ((issuer: number, villageIndex: number) => boolean) | null = null;
  const ownsVillage = (issuer: number, villageIndex: number): boolean => ownershipGuard === null || ownershipGuard(issuer, villageIndex);
  const reject = (ctx: TickContext, what: string, reason: string): void => {
    ctx.events.publish({ type: 'defence.rejected', tick: ctx.tick, data: { what, reason } });
  };
  const buildable = (vi: number, def: BuildingDef, x: number, y: number): string | null => {
    const map = maps.get(vi);
    if (map === undefined) return 'no defence layer for this village';
    if (x < 0 || y < 0 || x + def.footprint.w > size || y + def.footprint.h > size) return 'out of bounds';
    const occ = occupancyFor(vi);
    for (const t of footprintTiles(def, x, y)) {
      if (map.tiles[t] !== DEFENCE_TILE.open) return 'not open ground (rock or water)';
      if (occ.has(t)) return 'tile already occupied';
    }
    return null;
  };

  // ---------------- commands ----------------

  kernel.registerCommand<{ villageId: number; def: string; x: number; y: number }>('defence.build', (ctx, p, command) => {
    const villageId = p.villageId | 0;
    if (!world.isAlive(villageId as EntityId) || !world.has(villageId as EntityId, VillageCore)) {
      return reject(ctx, 'defence.build', 'no such village');
    }
    const vi = index(villageId);
    if (!ownsVillage(command.issuer, vi)) return reject(ctx, 'defence.build', 'not your village');
    const def = db.buildings.get(String(p.def));
    if (def === undefined) return reject(ctx, 'defence.build', `unknown building '${String(p.def)}'`);
    if (def.defense === undefined) return reject(ctx, 'defence.build', 'only defensive structures (wall/gate/tower/keep) belong on the defence layer');
    if (def.id === KEEP_DEF) return reject(ctx, 'defence.build', 'the keep stands where it was founded');
    const x = p.x | 0;
    const y = p.y | 0;
    const why = buildable(vi, def, x, y);
    if (why !== null) return reject(ctx, 'defence.build', why);

    // cost: check-all-then-deduct-all from the STRUCTURE'S OWN VILLAGE stockpile (M57:
    // no longer pooled through a kingdom capital — see the module doc comment)
    const stock = world.readObj(Stockpile).tryGet(vi);
    if (stock === undefined) return reject(ctx, 'defence.build', 'village has no stockpile');
    for (const [resId, amount] of Object.entries(def.cost)) {
      const have = stock.get(game.ops.resourceCode(resId) as number) ?? 0;
      if (have < amount) return reject(ctx, 'defence.build', `insufficient ${resId} (${have}/${amount})`);
    }
    const mutStock = world.writeObj(Stockpile).get(vi);
    for (const [resId, amount] of Object.entries(def.cost)) {
      const rc = game.ops.resourceCode(resId) as number;
      mutStock.set(rc, (mutStock.get(rc) as number) - amount);
      econGame.ledger.record(vi, rc, 'built', amount);
    }

    const entity = spawnStructure(vi, def, x, y);
    ctx.events.publish({ type: 'defence.built', tick: ctx.tick, data: { village: vi, structure: entity, def: def.id, x, y } });
  });

  kernel.registerCommand<{ structureId: number }>('defence.demolish', (ctx, p, command) => {
    const id = p.structureId | 0;
    if (!world.isAlive(id as EntityId) || !world.has(id as EntityId, DefenceStructure)) {
      return reject(ctx, 'defence.demolish', 'no such structure');
    }
    const s = world.read(DefenceStructure);
    const si = index(id);
    const vi = index(s.village[si] as number);
    if (!ownsVillage(command.issuer, vi)) return reject(ctx, 'defence.demolish', 'not your structure');
    const def = game.ops.buildingDef(s.def[si] as number);
    if (def.id === KEEP_DEF) return reject(ctx, 'defence.demolish', 'the keep cannot be demolished');
    vacate(vi, def, s.x[si] as number, s.y[si] as number);
    world.despawn(id as EntityId);
    ctx.events.publish({ type: 'defence.demolished', tick: ctx.tick, data: { village: vi, structure: id, def: def.id } });
  });

  kernel.registerCommand<{ unitId: number; x: number; y: number }>('defence.post', (ctx, p, command) => {
    const unitId = p.unitId | 0;
    if (!world.isAlive(unitId as EntityId) || !world.has(unitId as EntityId, Unit)) {
      return reject(ctx, 'defence.post', 'no such unit');
    }
    const u = world.read(Unit);
    const ui = index(unitId);
    const homeVillage = index(u.homeVillage[ui] as number);
    if (!ownsVillage(command.issuer, homeVillage)) return reject(ctx, 'defence.post', 'not your unit');
    if ((u.complete[ui] as number) !== 1) return reject(ctx, 'defence.post', 'the unit is still training');
    if ((u.armyId[ui] as number) !== 0) return reject(ctx, 'defence.post', 'the unit marches with an army — disband it from the army first');
    const x = p.x | 0;
    const y = p.y | 0;
    const map = maps.get(homeVillage);
    if (map === undefined || x < 0 || y < 0 || x >= size || y >= size) return reject(ctx, 'defence.post', 'out of bounds');
    if (map.tiles[y * size + x] !== DEFENCE_TILE.open) return reject(ctx, 'defence.post', 'not open ground');
    if (world.has(unitId as EntityId, DefencePost)) {
      const post = world.write(DefencePost);
      post.x[ui] = x;
      post.y[ui] = y;
    } else {
      world.attach(unitId as EntityId, DefencePost, { x, y });
    }
    ctx.events.publish({ type: 'defence.posted', tick: ctx.tick, data: { village: homeVillage, unit: unitId, x, y } });
  });

  kernel.registerCommand<{ unitId: number }>('defence.unpost', (ctx, p, command) => {
    const unitId = p.unitId | 0;
    if (!world.isAlive(unitId as EntityId) || !world.has(unitId as EntityId, DefencePost)) {
      return reject(ctx, 'defence.unpost', 'the unit is not posted');
    }
    const u = world.read(Unit);
    const homeVillage = index(u.homeVillage[index(unitId)] as number);
    if (!ownsVillage(command.issuer, homeVillage)) return reject(ctx, 'defence.unpost', 'not your unit');
    world.detach(unitId as EntityId, DefencePost);
    ctx.events.publish({ type: 'defence.unposted', tick: ctx.tick, data: { village: homeVillage, unit: unitId } });
  });

  kernel.registerCommand<{ villageId: number }>('defence.repair', (ctx, p, command) => {
    const villageId = p.villageId | 0;
    if (!world.isAlive(villageId as EntityId) || !world.has(villageId as EntityId, VillageCore)) {
      return reject(ctx, 'defence.repair', 'no such village');
    }
    const vi = index(villageId);
    if (!ownsVillage(command.issuer, vi)) return reject(ctx, 'defence.repair', 'not your village');
    // load-bearing (ADR-4 A1): otherwise a stone-rich defender out-repairs the bombardment
    // and is unbreakable — this is the one rule that becomes an exploit if missed.
    if (options.isUnderSiege(vi)) return reject(ctx, 'defence.repair', 'cannot repair while under siege');
    const already = repairingUntil.get(vi);
    if (already !== undefined && already > ctx.tick) return reject(ctx, 'defence.repair', 'already repairing');
    const cost = repairCostOf(vi);
    if (cost.size === 0) return reject(ctx, 'defence.repair', 'nothing to repair');

    // cost: check-all-then-deduct-all from the VILLAGE'S OWN stockpile (never the
    // kingdom's — the same asymmetry defence.build's cost already draws)
    const stock = world.readObj(Stockpile).tryGet(vi);
    if (stock === undefined) return reject(ctx, 'defence.repair', 'village has no stockpile');
    for (const [resId, amount] of cost) {
      const have = stock.get(game.ops.resourceCode(resId) as number) ?? 0;
      if (have < amount) return reject(ctx, 'defence.repair', `insufficient ${resId} (${have}/${amount})`);
    }
    const mutStock = world.writeObj(Stockpile).get(vi);
    for (const [resId, amount] of cost) {
      const rc = game.ops.resourceCode(resId) as number;
      mutStock.set(rc, (mutStock.get(rc) as number) - amount);
      econGame.ledger.record(vi, rc, 'built', amount);
    }

    // commits immediately; hp only returns once the window elapses (the strike-again-
    // before-they-recover beat instant repair would delete)
    const completesAt = ctx.tick + REPAIR_DURATION_DAYS * TICKS_PER_DAY;
    repairingUntil.set(vi, completesAt);
    ctx.events.publish({
      type: 'defence.repairStarted',
      tick: ctx.tick,
      data: { village: vi, completesAt, cost: [...cost.entries()] },
    });
  });

  // ---- M58: repair completion — daily, idempotent (only villages with an elapsed window
  // do anything). Heals every structure of that village back to maxHp in one step; instant
  // per-structure regeneration was rejected precisely to keep the vulnerability window
  // real (see the command above). ----
  kernel.registerSystem({
    name: 'defence-repair',
    period: TICKS_PER_DAY,
    access: { reads: [DefenceStructure], writes: [Fortification] },
    update(ctx: TickContext): void {
      if (repairingUntil.size === 0) return;
      const s = world.read(DefenceStructure);
      const fort = world.write(Fortification);
      for (const [vi, until] of [...repairingUntil.entries()]) {
        if (ctx.tick < until) continue;
        world.query([DefenceStructure]).forEach((si) => {
          if (index(s.village[si] as number) !== vi) return;
          fort.hp[si] = fort.maxHp[si] as number;
        });
        repairingUntil.delete(vi);
        ctx.events.publish({ type: 'defence.repaired', tick: ctx.tick, data: { village: vi } });
      }
    },
  });

  // ---- M51 conflict rule: drafting a posted unit into an army pulls it OFF the walls —
  // one soldier pool, one place at a time. Subscriber touches component state only (the
  // codebase's standing subscriber discipline). ----
  kernel.subscribe<{ unit: number; armyId: number }>('army.unitAssigned', (event) => {
    if (world.isAlive(event.data.unit as EntityId) && world.has(event.data.unit as EntityId, DefencePost)) {
      world.detach(event.data.unit as EntityId, DefencePost);
    }
  });

  // ---------------- determinism: maps + repair windows fold into the state hash ----------------
  kernel.addHashSource('defence', (fold) => {
    for (const vi of [...maps.keys()].sort((a, b) => a - b)) {
      const m = maps.get(vi) as DefenceMapState;
      fold(m.village);
      fold(m.seed);
      fold(m.version);
      fold(m.digest);
    }
    for (const vi of [...repairingUntil.keys()].sort((a, b) => a - b)) {
      fold(vi);
      fold(repairingUntil.get(vi) as number);
    }
  });

  return {
    DefenceStructure,
    DefencePost,
    Fortification,
    mapOf: (vi) => maps.get(vi),
    occupancyOf: (vi) => occupancyFor(vi),
    removeStructure(entity: number): void {
      if (!world.isAlive(entity as EntityId) || !world.has(entity as EntityId, DefenceStructure)) return;
      const s = world.read(DefenceStructure);
      const si = index(entity);
      vacate(index(s.village[si] as number), game.ops.buildingDef(s.def[si] as number), s.x[si] as number, s.y[si] as number);
      world.despawn(entity as EntityId);
    },
    save: () =>
      [...maps.keys()].sort((a, b) => a - b).map((vi) => {
        const m = maps.get(vi) as DefenceMapState;
        return { k: vi, seed: m.seed, version: m.version, tiles: encodeDefenceMap(m.tiles) };
      }),
    restore(data): void {
      for (const entry of data) {
        // current pipeline ⇒ regenerate from the seed (byte-stable, tested);
        // version mismatch ⇒ the generator changed since this save — its stored
        // tiles are the ground truth the player built on (ADR-4: never re-roll).
        const tiles = entry.version === DEFENCE_MAP_VERSION ? generateDefenceMap(entry.seed) : decodeDefenceMap(entry.tiles);
        maps.set(entry.k, {
          village: entry.k,
          seed: entry.seed,
          version: entry.version,
          tiles,
          digest: digestDefenceMap(tiles),
        });
      }
    },
    rebuildDerived(): void {
      occupancy.clear();
      const s = world.read(DefenceStructure);
      world.query([DefenceStructure]).forEach((si, entity) => {
        const def = game.ops.buildingDef(s.def[si] as number);
        occupy(index(s.village[si] as number), entity as number, def, s.x[si] as number, s.y[si] as number);
      });
    },
    remapLegacyOwners(capitalOfKingdom: (kingdomIndex: number) => number | null): void {
      // 1. structures: the world-section migration renamed the FIELD (kingdom → village)
      // but could not touch the VALUE — it still holds the old raw kingdom index.
      const s = world.write(DefenceStructure);
      world.query([DefenceStructure]).forEach((si) => {
        const stale = s.village[si] as number;
        const real = capitalOfKingdom(stale);
        if (real !== null) s.village[si] = real;
      });
      // 2. map state: 'defence' section entries are still keyed by kingdom index too.
      const remapped = new Map<number, DefenceMapState>();
      for (const [k, m] of maps) {
        const real = capitalOfKingdom(k) ?? k;
        remapped.set(real, { ...m, village: real });
      }
      maps.clear();
      for (const [k, m] of remapped) maps.set(k, m);
    },
    setOwnershipGuard(guard: (issuer: number, villageIndex: number) => boolean): void {
      ownershipGuard = guard;
    },
    repairCostOf: (vi) => repairCostOf(vi),
    repairingUntil: (vi) => repairingUntil.get(vi),
    saveRepairs: () =>
      [...repairingUntil.entries()].sort((a, b) => a[0] - b[0]).map(([v, until]) => ({ v, until })),
    restoreRepairs(data): void {
      repairingUntil.clear();
      for (const { v, until } of data) repairingUntil.set(v, until);
    },
  };
}
