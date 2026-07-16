/**
 * Defence layer core (roadmap M49; ADR-4; GDD §7 Phase 8 delta). Campaign-only.
 *
 * Each kingdom's CAPITAL owns one persistent ~100×100 defence map
 * (worldgen/defenceMap.ts) with the keep pre-placed at centre. Players (M50
 * UI) and AI templates (M52) place defensive structures and post garrison
 * units here; the M51 spatial resolver consumes the layout as the siege
 * ASSAULT phase's input. Until M53, nothing on this layer changes loss rules
 * (doc 14 OQ-9: capital-death activates at M53, not before).
 *
 * DESIGN CONSTRAINTS (ADR-4 §6):
 *   - same World, no second store: structures are ordinary entities carrying
 *     `DefenceStructure` (+ the castles.ts `Fortification` HP component, one
 *     damage vocabulary for M51), so queries, access guards, state hashing,
 *     and worldSection persistence all apply unmodified;
 *   - structures cost MAIN-ECONOMY resources, drawn atomically from the
 *     kingdom's capital stockpile under existing storage rules (the
 *     check-all-then-deduct-all idiom of army.recruitUnit), recorded on the
 *     village ledger under the existing 'built' flow;
 *   - garrison comes from the SAME soldier pool: `defence.post` assigns a
 *     complete, army-free Unit to a layer tile via `DefencePost`. (A posted
 *     unit can still be drafted by army-assembly commands — M51 defines the
 *     conflict rule when the resolver starts consuming posts; until then a
 *     draft simply strands a stale post, which unpost clears.)
 *   - M49 simplification, documented: defence structures complete INSTANTLY
 *     on payment. Build pacing (progress ticks) arrives with the M50 surface
 *     if playtests want it; the atomic-cost contract is what M49 pins.
 *
 * Maps regenerate from their seed on load; a DEFENCE_MAP_VERSION mismatch
 * falls back to the save's stored tiles (see restore()).
 */
import type { EntityId } from '@crowns/core';
import type { BuildingDef, DefinitionDatabase } from '@crowns/data';
import { SoAComponent, World } from '../ecs.js';
import type { Kernel, TickContext } from '../kernel.js';
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
import type { KingdomGameplay } from './kingdom.js';
import type { MilitaryGameplay } from './military.js';
import type { CastleGameplay } from './castles.js';

const index = (id: number): number => id & 0x3fffff;

export const KEEP_DEF = 'base:building.keep';
export const DEFENCE_KEEP_CENTRE = Math.floor(DEFENCE_MAP_SIZE / 2);

// ---------------------------------------------------------------- components

/** A structure standing on some kingdom's defence layer (not on the world map). */
export type DefenceStructureComponent = SoAComponent<{
  kingdom: 'u16'; // kingdom INDEX (dense, 0-based) — not an entity id
  def: 'u32'; // interned building-def code (villages.ts interner)
  x: 'u16';
  y: 'u16';
}>;

/** A garrison assignment: this Unit stands at (x, y) of its kingdom's layer. */
export type DefencePostComponent = SoAComponent<{ x: 'u16'; y: 'u16' }>;

// ---------------------------------------------------------------- state

export interface DefenceMapState {
  readonly kingdom: number;
  seed: number;
  version: number;
  tiles: Uint8Array;
  digest: number;
}

export interface DefenceGameplay {
  readonly DefenceStructure: DefenceStructureComponent;
  readonly DefencePost: DefencePostComponent;
  mapOf(kingdomIndex: number): DefenceMapState | undefined;
  /** Occupied layer tiles (footprint-expanded) for one kingdom: tile → structure entity. */
  occupancyOf(kingdomIndex: number): ReadonlyMap<number, number>;
  /** M51: a BREACH — the assault resolver levels a structure (occupancy maintained). */
  removeStructure(entity: number): void;
  save(): { k: number; seed: number; version: number; tiles: number[] }[];
  restore(data: readonly { k: number; seed: number; version: number; tiles: readonly number[] }[]): void;
  /** afterLoad: rebuild the occupancy index from DefenceStructure components. */
  rebuildDerived(): void;
}

export interface DefenceOptions {
  readonly worldSeed: number;
  readonly kingdomCount: number;
  /** Dense village index of the kingdom's capital (cost source), or null. */
  readonly capitalOf: (kingdomIndex: number) => number | null;
}

// ---------------------------------------------------------------- register

export function registerDefenceGameplay(
  kernel: Kernel,
  world: World,
  db: DefinitionDatabase,
  game: VillageGameplay,
  econGame: EconomyGameplay,
  kingdomGame: KingdomGameplay,
  militaryGame: MilitaryGameplay,
  castleGame: CastleGameplay,
  options: DefenceOptions,
): DefenceGameplay {
  const { Stockpile } = game.comps;
  const { Unit } = militaryGame;
  const { Fortification } = castleGame;
  const size = DEFENCE_MAP_SIZE;

  const DefenceStructure: DefenceStructureComponent = world.defineSoA('defenceStructure', {
    kingdom: 'u16',
    def: 'u32',
    x: 'u16',
    y: 'u16',
  });
  const DefencePost: DefencePostComponent = world.defineSoA('defencePost', { x: 'u16', y: 'u16' });

  // ---- maps: generated once per kingdom from the stable seed ----
  const maps = new Map<number, DefenceMapState>();
  for (let k = 0; k < options.kingdomCount; k++) {
    const seed = defenceMapSeed(options.worldSeed, k);
    const tiles = generateDefenceMap(seed);
    maps.set(k, { kingdom: k, seed, version: DEFENCE_MAP_VERSION, tiles, digest: digestDefenceMap(tiles) });
  }

  // ---- derived occupancy: kingdom → (tile index → structure entity) ----
  const occupancy = new Map<number, Map<number, number>>();
  const occupancyFor = (k: number): Map<number, number> => {
    let m = occupancy.get(k);
    if (m === undefined) occupancy.set(k, (m = new Map()));
    return m;
  };
  const footprintTiles = (def: BuildingDef, x: number, y: number): number[] => {
    const out: number[] = [];
    for (let dy = 0; dy < def.footprint.h; dy++) {
      for (let dx = 0; dx < def.footprint.w; dx++) out.push((y + dy) * size + (x + dx));
    }
    return out;
  };
  const occupy = (k: number, entity: number, def: BuildingDef, x: number, y: number): void => {
    const m = occupancyFor(k);
    for (const t of footprintTiles(def, x, y)) m.set(t, entity);
  };
  const vacate = (k: number, def: BuildingDef, x: number, y: number): void => {
    const m = occupancyFor(k);
    for (const t of footprintTiles(def, x, y)) m.delete(t);
  };

  // ---- the keep: pre-placed at centre for every kingdom, cost-free genesis ground.
  // Spawned from a SYSTEM (not at registration): the load path hydrates into a freshly
  // composed session whose world must be EMPTY (ecs loadState invariant), so genesis-owned
  // entities may only appear once ticking starts. The check is idempotent by presence, which
  // doubles as the pre-Phase-8 save fallback: a 1.0 save carries no keeps, so they rise on
  // its first resumed tick (its defence layers were empty by definition).
  const keepDef = db.buildings.get(KEEP_DEF);
  if (keepDef === undefined) throw new Error(`defence layer: missing '${KEEP_DEF}' def`);
  const keepOrigin = DEFENCE_KEEP_CENTRE - Math.floor(keepDef.footprint.w / 2);
  const keepCode = game.ops.defCode(KEEP_DEF);
  const spawnStructure = (k: number, def: BuildingDef, x: number, y: number): number => {
    const entity = world.spawn();
    world.attach(entity, DefenceStructure, { kingdom: k, def: game.ops.defCode(def.id), x, y });
    world.attach(entity, Fortification, { hp: def.defense?.hp ?? 1, maxHp: def.defense?.hp ?? 1 });
    occupy(k, entity as number, def, x, y);
    return entity as number;
  };
  let keepsEnsured = false;
  kernel.registerSystem({
    name: 'defence-genesis',
    period: 1,
    access: { writes: [DefenceStructure, Fortification] },
    update(ctx: TickContext): void {
      if (keepsEnsured) return;
      const hasKeep = new Set<number>();
      const s = world.read(DefenceStructure);
      world.query([DefenceStructure]).forEach((si) => {
        if ((s.def[si] as number) === keepCode) hasKeep.add(s.kingdom[si] as number);
      });
      for (let k = 0; k < options.kingdomCount; k++) {
        if (hasKeep.has(k)) continue;
        const keep = spawnStructure(k, keepDef, keepOrigin, keepOrigin);
        ctx.events.publish({ type: 'defence.built', tick: ctx.tick, data: { kingdom: k, structure: keep, def: KEEP_DEF, x: keepOrigin, y: keepOrigin } });
      }
      keepsEnsured = true;
    },
  });

  // ---- helpers ----
  const reject = (ctx: TickContext, what: string, reason: string): void => {
    ctx.events.publish({ type: 'defence.rejected', tick: ctx.tick, data: { what, reason } });
  };
  const kingdomIndexForIssuer = (issuer: number): number | undefined => {
    const k = issuer - 1;
    return k >= 0 && k < options.kingdomCount ? k : undefined;
  };
  const buildable = (k: number, def: BuildingDef, x: number, y: number): string | null => {
    const map = maps.get(k);
    if (map === undefined) return 'no defence map for this kingdom';
    if (x < 0 || y < 0 || x + def.footprint.w > size || y + def.footprint.h > size) return 'out of bounds';
    const occ = occupancyFor(k);
    for (const t of footprintTiles(def, x, y)) {
      if (map.tiles[t] !== DEFENCE_TILE.open) return 'not open ground (rock or water)';
      if (occ.has(t)) return 'tile already occupied';
    }
    return null;
  };

  // ---------------- commands ----------------

  kernel.registerCommand<{ def: string; x: number; y: number }>('defence.build', (ctx, p, command) => {
    const k = kingdomIndexForIssuer(command.issuer);
    if (k === undefined) return reject(ctx, 'defence.build', 'no kingdom');
    const def = db.buildings.get(String(p.def));
    if (def === undefined) return reject(ctx, 'defence.build', `unknown building '${String(p.def)}'`);
    if (def.defense === undefined) return reject(ctx, 'defence.build', 'only defensive structures (wall/gate/tower/keep) belong on the defence layer');
    if (def.id === KEEP_DEF) return reject(ctx, 'defence.build', 'the keep stands where it was founded');
    const x = p.x | 0;
    const y = p.y | 0;
    const why = buildable(k, def, x, y);
    if (why !== null) return reject(ctx, 'defence.build', why);

    // cost: check-all-then-deduct-all from the CAPITAL's stockpile (main economy)
    const capital = options.capitalOf(k);
    if (capital === null) return reject(ctx, 'defence.build', 'kingdom has no capital to draw materials from');
    const stock = world.readObj(Stockpile).tryGet(capital);
    if (stock === undefined) return reject(ctx, 'defence.build', 'kingdom has no capital to draw materials from');
    for (const [resId, amount] of Object.entries(def.cost)) {
      const have = stock.get(game.ops.resourceCode(resId) as number) ?? 0;
      if (have < amount) return reject(ctx, 'defence.build', `insufficient ${resId} (${have}/${amount})`);
    }
    const mutStock = world.writeObj(Stockpile).get(capital);
    for (const [resId, amount] of Object.entries(def.cost)) {
      const rc = game.ops.resourceCode(resId) as number;
      mutStock.set(rc, (mutStock.get(rc) as number) - amount);
      econGame.ledger.record(capital, rc, 'built', amount);
    }

    const entity = spawnStructure(k, def, x, y);
    ctx.events.publish({ type: 'defence.built', tick: ctx.tick, data: { kingdom: k, structure: entity, def: def.id, x, y } });
  });

  kernel.registerCommand<{ structureId: number }>('defence.demolish', (ctx, p, command) => {
    const k = kingdomIndexForIssuer(command.issuer);
    if (k === undefined) return reject(ctx, 'defence.demolish', 'no kingdom');
    const id = p.structureId | 0;
    if (!world.isAlive(id as EntityId) || !world.has(id as EntityId, DefenceStructure)) {
      return reject(ctx, 'defence.demolish', 'no such structure');
    }
    const s = world.read(DefenceStructure);
    const si = index(id);
    if ((s.kingdom[si] as number) !== k) return reject(ctx, 'defence.demolish', 'not your structure');
    const def = game.ops.buildingDef(s.def[si] as number);
    if (def.id === KEEP_DEF) return reject(ctx, 'defence.demolish', 'the keep cannot be demolished');
    vacate(k, def, s.x[si] as number, s.y[si] as number);
    world.despawn(id as EntityId);
    ctx.events.publish({ type: 'defence.demolished', tick: ctx.tick, data: { kingdom: k, structure: id, def: def.id } });
  });

  kernel.registerCommand<{ unitId: number; x: number; y: number }>('defence.post', (ctx, p, command) => {
    const k = kingdomIndexForIssuer(command.issuer);
    if (k === undefined) return reject(ctx, 'defence.post', 'no kingdom');
    const unitId = p.unitId | 0;
    if (!world.isAlive(unitId as EntityId) || !world.has(unitId as EntityId, Unit)) {
      return reject(ctx, 'defence.post', 'no such unit');
    }
    const u = world.read(Unit);
    const ui = index(unitId);
    const kingdomId = kingdomGame.kingdomEntities()[k];
    if (kingdomId === undefined || (u.kingdomId[ui] as number) !== (kingdomId as number)) {
      return reject(ctx, 'defence.post', 'not your unit');
    }
    if ((u.complete[ui] as number) !== 1) return reject(ctx, 'defence.post', 'the unit is still training');
    if ((u.armyId[ui] as number) !== 0) return reject(ctx, 'defence.post', 'the unit marches with an army — disband it from the army first');
    const x = p.x | 0;
    const y = p.y | 0;
    const map = maps.get(k);
    if (map === undefined || x < 0 || y < 0 || x >= size || y >= size) return reject(ctx, 'defence.post', 'out of bounds');
    if (map.tiles[y * size + x] !== DEFENCE_TILE.open) return reject(ctx, 'defence.post', 'not open ground');
    if (world.has(unitId as EntityId, DefencePost)) {
      const post = world.write(DefencePost);
      post.x[ui] = x;
      post.y[ui] = y;
    } else {
      world.attach(unitId as EntityId, DefencePost, { x, y });
    }
    ctx.events.publish({ type: 'defence.posted', tick: ctx.tick, data: { kingdom: k, unit: unitId, x, y } });
  });

  kernel.registerCommand<{ unitId: number }>('defence.unpost', (ctx, p, command) => {
    const k = kingdomIndexForIssuer(command.issuer);
    if (k === undefined) return reject(ctx, 'defence.unpost', 'no kingdom');
    const unitId = p.unitId | 0;
    if (!world.isAlive(unitId as EntityId) || !world.has(unitId as EntityId, DefencePost)) {
      return reject(ctx, 'defence.unpost', 'the unit is not posted');
    }
    const u = world.read(Unit);
    const kingdomId = kingdomGame.kingdomEntities()[k];
    if (kingdomId === undefined || (u.kingdomId[index(unitId)] as number) !== (kingdomId as number)) {
      return reject(ctx, 'defence.unpost', 'not your unit');
    }
    world.detach(unitId as EntityId, DefencePost);
    ctx.events.publish({ type: 'defence.unposted', tick: ctx.tick, data: { kingdom: k, unit: unitId } });
  });

  // ---- M51 conflict rule: drafting a posted unit into an army pulls it OFF the walls —
  // one soldier pool, one place at a time. Subscriber touches component state only (the
  // codebase's standing subscriber discipline). ----
  kernel.subscribe<{ unit: number; armyId: number }>('army.unitAssigned', (event) => {
    if (world.isAlive(event.data.unit as EntityId) && world.has(event.data.unit as EntityId, DefencePost)) {
      world.detach(event.data.unit as EntityId, DefencePost);
    }
  });

  // ---------------- determinism: maps fold into the state hash ----------------
  kernel.addHashSource('defence', (fold) => {
    for (const k of [...maps.keys()].sort((a, b) => a - b)) {
      const m = maps.get(k) as DefenceMapState;
      fold(m.kingdom);
      fold(m.seed);
      fold(m.version);
      fold(m.digest);
    }
  });

  return {
    DefenceStructure,
    DefencePost,
    mapOf: (k) => maps.get(k),
    occupancyOf: (k) => occupancyFor(k),
    removeStructure(entity: number): void {
      if (!world.isAlive(entity as EntityId) || !world.has(entity as EntityId, DefenceStructure)) return;
      const s = world.read(DefenceStructure);
      const si = index(entity);
      vacate(s.kingdom[si] as number, game.ops.buildingDef(s.def[si] as number), s.x[si] as number, s.y[si] as number);
      world.despawn(entity as EntityId);
    },
    save: () =>
      [...maps.keys()].sort((a, b) => a - b).map((k) => {
        const m = maps.get(k) as DefenceMapState;
        return { k, seed: m.seed, version: m.version, tiles: encodeDefenceMap(m.tiles) };
      }),
    restore(data): void {
      for (const entry of data) {
        // current pipeline ⇒ regenerate from the seed (byte-stable, tested);
        // version mismatch ⇒ the generator changed since this save — its stored
        // tiles are the ground truth the player built on (ADR-4: never re-roll).
        const tiles = entry.version === DEFENCE_MAP_VERSION ? generateDefenceMap(entry.seed) : decodeDefenceMap(entry.tiles);
        maps.set(entry.k, {
          kingdom: entry.k,
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
        occupy(s.kingdom[si] as number, entity as number, def, s.x[si] as number, s.y[si] as number);
      });
    },
  };
}
