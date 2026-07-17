/**
 * Logistics (roadmap M14; GDD §3 "local-first storage"; doc 05 §5; doc 08 §2
 * slots 3 & 5).
 *
 * Haulers are REAL entities: adults claimed from the jobs solver (population
 * `haulers` slot), spawned at the village centre, walking the map with travel
 * time — distance is a cost you can watch. Goods sit in building inventories
 * (economy.ts) until a hauler carries them to the centre stockpile, and recipe
 * inputs only arrive by cart, so a far-flung farm without roads genuinely
 * starves the village the docs promised it would.
 *
 * ROADS are world-tile state (doc 06 WorldTile.roadLevel 0..3): each level
 * multiplies hauler speed by (1 + 0.5·level). `village.buildRoad` costs stone
 * through the same stockpile as construction — one economy, no side doors.
 *
 * The PATH SERVICE is a deterministic 4-neighbour A* over terrain movement
 * cost ÷ road factor, with a ROUTE CACHE keyed by endpoint tiles and
 * invalidated whenever any road changes (doc 05 §5 — the HPA* upgrade for
 * army-scale maps is M26, Risk R4; village-radius searches don't need it).
 *
 * The JOB BOARD matches idle haulers to work each tick (amortised: no idle
 * haulers, no scan): pickups (building outbox ≥ threshold, stockpile has
 * headroom counting in-flight carry) then deliveries (recipe inputs below a
 * buffer, stockpile has stock) — all in ascending entity order (TDD §5).
 */
import type { EntityId } from '@crowns/core';
import type { DefinitionDatabase } from '@crowns/data';
import { ObjectComponent, SoAComponent, World } from '../ecs.js';
import type { Kernel, SimSystem, TickContext } from '../kernel.js';
import type { VillageGameplay } from './villages.js';
import type { PopulationGameplay } from './population.js';
import type { EconomyGameplay } from './economy.js';

// ---------------------------------------------------------------- constants

export const HAULER_CAPACITY_WEIGHT = 10; // units carried = capacity / resource weight
export const PICKUP_MIN_WEIGHT = 4; // don't dispatch a cart for crumbs
export const DELIVERY_BUFFER_DAYS = 2; // keep this many days of inputs at the building
export const ROAD_COST_STONE = 1; // per tile per level
export const ROAD_SPEED = (level: number): number => 1 + 0.5 * level;
export const MAX_ROAD_LEVEL = 3;

// hauler state machine
const IDLE = 0;
const TO_PICKUP = 1;
const TO_DROPOFF = 2;
const TO_DELIVERY = 3;

// ---------------------------------------------------------------- roads

/** Mutable road state over the world grid (doc 06 WorldTile.roadLevel). */
export class RoadGrid {
  private readonly levels: Uint8Array;
  /** Bumped on every change — the route cache watches this. */
  version = 0;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.levels = new Uint8Array(width * height);
  }

  levelAt(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
    return this.levels[y * this.width + x] as number;
  }

  set(x: number, y: number, level: number): void {
    this.levels[y * this.width + x] = level;
    this.version++;
  }

  /** Deterministic fold of all road tiles (ascending index) for state hashing. */
  fold(fold: (n: number) => void): void {
    for (let i = 0; i < this.levels.length; i++) {
      const level = this.levels[i] as number;
      if (level > 0) {
        fold(i);
        fold(level);
      }
    }
  }

  /** All road tiles as [x, y, level] triples (snapshot mirror, ascending index). */
  list(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.levels.length; i++) {
      const level = this.levels[i] as number;
      if (level > 0) out.push(i % this.width, Math.floor(i / this.width), level);
    }
    return out;
  }

  /** Restore from saved triples (M17). Bumps version so route caches drop. */
  restore(triples: readonly number[]): void {
    this.levels.fill(0);
    for (let i = 0; i + 2 < triples.length; i += 3) {
      this.levels[(triples[i + 1] as number) * this.width + (triples[i] as number)] = triples[i + 2] as number;
    }
    this.version++;
  }
}

// ---------------------------------------------------------------- pathing

interface TerrainLike {
  readonly width: number;
  readonly height: number;
  riverAt(x: number, y: number): boolean;
  movementCostAt(x: number, y: number): number;
}

/**
 * Deterministic 4-neighbour A* with a route cache. Tile step cost =
 * movementCost / roadFactor; water/rivers are impassable to carts.
 */
export class PathService {
  private readonly cache = new Map<number, number[] | null>();
  private cacheVersion = -1;

  constructor(
    private readonly terrain: TerrainLike,
    private readonly roads: RoadGrid,
  ) {}

  private passable(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.terrain.width || y >= this.terrain.height) return false;
    return this.terrain.movementCostAt(x, y) > 0 && !this.terrain.riverAt(x, y);
  }

  /** Per-tile traversal cost (lower on roads). */
  stepCost(x: number, y: number): number {
    return this.terrain.movementCostAt(x, y) / ROAD_SPEED(this.roads.levelAt(x, y));
  }

  /** Tile-index path from → to (exclusive of `from`), or null if unreachable. */
  route(fromX: number, fromY: number, toX: number, toY: number): number[] | null {
    if (this.cacheVersion !== this.roads.version) {
      this.cache.clear();
      this.cacheVersion = this.roads.version;
    }
    const w = this.terrain.width;
    const from = fromY * w + fromX;
    const to = toY * w + toX;
    const key = from * this.terrain.width * this.terrain.height + to;
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit === null ? null : [...hit];

    const open: { tile: number; f: number }[] = [{ tile: from, f: 0 }];
    const gScore = new Map<number, number>([[from, 0]]);
    const cameFrom = new Map<number, number>();
    const closed = new Set<number>();
    let found = false;
    while (open.length > 0) {
      // deterministic priority pop: lowest f, tie-break lowest tile index
      let best = 0;
      for (let i = 1; i < open.length; i++) {
        const a = open[i] as { tile: number; f: number };
        const b = open[best] as { tile: number; f: number };
        if (a.f < b.f || (a.f === b.f && a.tile < b.tile)) best = i;
      }
      const { tile } = open.splice(best, 1)[0] as { tile: number; f: number };
      if (tile === to) {
        found = true;
        break;
      }
      if (closed.has(tile)) continue;
      closed.add(tile);
      const tx = tile % w;
      const ty = Math.floor(tile / w);
      for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1]] as const) {
        const nx = tx + dx;
        const ny = ty + dy;
        if (!this.passable(nx, ny)) continue;
        const neighbor = ny * w + nx;
        if (closed.has(neighbor)) continue;
        const g = (gScore.get(tile) as number) + this.stepCost(nx, ny);
        if (g < (gScore.get(neighbor) ?? Infinity)) {
          gScore.set(neighbor, g);
          cameFrom.set(neighbor, tile);
          // admissible heuristic: manhattan × cheapest conceivable step
          const h = (Math.abs(nx - toX) + Math.abs(ny - toY)) / ROAD_SPEED(MAX_ROAD_LEVEL);
          open.push({ tile: neighbor, f: g + h });
        }
      }
    }
    if (!found) {
      this.cache.set(key, null);
      return null;
    }
    const path: number[] = [];
    for (let tile = to; tile !== from; tile = cameFrom.get(tile) as number) path.push(tile);
    path.reverse();
    this.cache.set(key, path);
    return [...path];
  }
}

// ---------------------------------------------------------------- components

export type HaulerComponent = SoAComponent<{
  village: 'eid';
  state: 'u8'; // IDLE | TO_PICKUP | TO_DROPOFF | TO_DELIVERY
  building: 'eid'; // job target (pickup source or delivery destination)
  carryCode: 'u32';
  carryAmount: 'f64';
  pathIndex: 'u16';
  progress: 'f64'; // fractional movement toward the next path tile
}>;

export interface LogisticsGameplay {
  readonly Hauler: HaulerComponent;
  readonly HaulerPath: ObjectComponent<number[]>;
  readonly roads: RoadGrid;
  readonly paths: PathService;
  /** Total of a resource across stockpile + inventories + hauler carry. */
  totalOf(villageIndex: number, resourceCode: number): number;
  /** Shared road-building code path (commands, genesis, future AI). */
  buildRoad(ctx: TickContext, villageId: number, x: number, y: number): true | string;
}

// ---------------------------------------------------------------- registrar

export function registerLogisticsGameplay(
  kernel: Kernel,
  world: World,
  db: DefinitionDatabase,
  game: VillageGameplay,
  popGame: PopulationGameplay,
  econ: EconomyGameplay,
  Position: SoAComponent<{ x: 'f64'; y: 'f64' }>,
  options: { haulerTarget?: number } = {},
): LogisticsGameplay {
  const { VillageCore, Stockpile, BuildingCore } = game.comps;
  const { Population } = popGame;
  const { BuildingInventory, ledger } = econ;
  const terrain = game.terrain;
  game.settings.haulerTarget = options.haulerTarget ?? 4;

  const roads = new RoadGrid(terrain.width, terrain.height);
  const paths = new PathService(terrain, roads);
  kernel.addHashSource('roads', (fold) => roads.fold(fold));

  const Hauler: HaulerComponent = world.defineSoA('hauler', {
    village: 'eid',
    state: 'u8',
    building: 'eid',
    carryCode: 'u32',
    carryAmount: 'f64',
    pathIndex: 'u16',
    progress: 'f64',
  });
  const HaulerPath = world.defineObject<number[]>('haulerPath', (path, fold) => {
    for (const tile of path) fold(tile);
  });

  const index = (id: number): number => id & 0x3fffff;
  const weightOf = new Map<number, number>();
  for (const id of [...db.resources.keys()].sort()) {
    weightOf.set(game.ops.resourceCode(id) as number, db.resources.get(id)?.weight ?? 1);
  }
  const capacityUnits = (code: number): number => HAULER_CAPACITY_WEIGHT / (weightOf.get(code) ?? 1);

  // ---------------- roads: one rulebook for command, genesis, AI ----------------
  const stoneCode = game.ops.resourceCode('base:resource.stone') as number;

  const buildRoad = (ctx: TickContext, villageId: number, x: number, y: number): true | string => {
    const village = villageId as EntityId;
    if (!world.isAlive(village)) return 'no such village';
    if (x < 0 || y < 0 || x >= terrain.width || y >= terrain.height) return 'out of bounds';
    if (terrain.movementCostAt(x, y) <= 0 || terrain.riverAt(x, y)) return `tile (${x}, ${y}) is impassable`;
    if (game.ops.isOccupied(x, y)) return `tile (${x}, ${y}) occupied`;
    const level = roads.levelAt(x, y);
    if (level >= 1) return `road already present at (${x}, ${y})`; // levels 2–3 unlock later (research, M32)
    const stock = world.writeObj(Stockpile).tryGet(index(villageId));
    if (stock === undefined) return 'no such village';
    const have = stock.get(stoneCode) ?? 0;
    if (have < ROAD_COST_STONE) return `insufficient base:resource.stone (${have}/${ROAD_COST_STONE})`;
    stock.set(stoneCode, have - ROAD_COST_STONE);
    ledger.record(index(villageId), stoneCode, 'built', ROAD_COST_STONE);
    roads.set(x, y, 1);
    ctx.events.publish({ type: 'road.built', tick: ctx.tick, data: { x, y, level: 1, village: villageId } });
    return true;
  };

  kernel.registerCommand<{ villageId: number; x: number; y: number }>('village.buildRoad', (ctx, p) => {
    const result = buildRoad(ctx, p.villageId | 0, p.x | 0, p.y | 0);
    if (typeof result === 'string') {
      ctx.events.publish({ type: 'village.rejected', tick: ctx.tick, data: { what: 'village.buildRoad', reason: result } });
    }
  });

  // ---------------- staffing: hauler entities mirror the jobs-solver slot ----------------
  const staffing: SimSystem = {
    name: 'haul-staffing',
    period: 1,
    access: { writes: [Hauler, HaulerPath, Position, Stockpile], reads: [Population, VillageCore] },
    update(): void {
      const pop = world.read(Population);
      const core = world.read(VillageCore);
      const h = world.read(Hauler);
      // current haulers per village (ascending entity order — despawn newest last)
      const byVillage = new Map<number, EntityId[]>();
      world.query([Hauler]).forEach((i, entity) => {
        const vi = index(h.village[i] as number);
        const list = byVillage.get(vi);
        if (list === undefined) byVillage.set(vi, [entity]);
        else list.push(entity);
      });
      world.query([Population, VillageCore]).forEach((vi, village) => {
        const target = Math.floor(pop.haulers[vi] as number);
        const current = byVillage.get(vi) ?? [];
        for (let n = current.length; n < target; n++) {
          const hauler = world.spawn();
          world.attach(hauler, Hauler, {
            village: village as number, state: IDLE, building: 0, carryCode: 0, carryAmount: 0, pathIndex: 0, progress: 0,
          });
          world.attach(hauler, Position, { x: core.centerX[vi] as number, y: core.centerY[vi] as number });
          world.attach(hauler, HaulerPath, []);
        }
        for (let n = current.length; n > target; n--) {
          const hauler = current[n - 1] as EntityId;
          // a laid-off hauler hands any load straight to the stockpile (conservation)
          const hi = index(hauler as number);
          const carry = h.carryAmount[hi] as number;
          if (carry > 0) {
            const stock = world.writeObj(Stockpile).tryGet(vi);
            if (stock !== undefined) {
              const code = h.carryCode[hi] as number;
              stock.set(code, (stock.get(code) ?? 0) + carry);
            }
          }
          world.despawn(hauler);
        }
      });
    },
  };

  // ---------------- job board: match idle haulers (amortised) ----------------
  const board: SimSystem = {
    name: 'haul-board',
    period: 1,
    access: {
      writes: [Hauler, HaulerPath],
      reads: [BuildingCore, BuildingInventory, VillageCore, Stockpile, Position, econ.StockLimits],
    },
    update(): void {
      const h = world.write(Hauler);
      const idle: number[] = [];
      world.query([Hauler]).forEach((i, entity) => {
        if ((h.state[i] as number) === IDLE) idle.push(entity as number);
      });
      if (idle.length === 0) return; // amortised: nothing to match

      const b = world.read(BuildingCore);
      const core = world.read(VillageCore);
      const inventories = world.readObj(BuildingInventory);
      const stocks = world.readObj(Stockpile);
      const pos = world.read(Position);
      const pathsOf = world.writeObj(HaulerPath);
      const capOf = econ.capsView(); // one storage snapshot for the whole scan

      // in-flight claims: outbound pickups by (building, code), inbound to each
      // stockpile by (village, code), outbound deliveries by (building, code).
      // numeric keys — this runs every tick at haul-job scale (doc 11 §2)
      const key = (id: number, code: number): number => id * 1024 + code;
      const pickupClaims = new Map<number, number>();
      const inbound = new Map<number, number>();
      const deliveryClaims = new Map<number, number>();
      world.query([Hauler]).forEach((i) => {
        const state = h.state[i] as number;
        const vi = index(h.village[i] as number);
        const code = h.carryCode[i] as number;
        if (state === TO_PICKUP) {
          const k = key(h.building[i] as number, code);
          pickupClaims.set(k, (pickupClaims.get(k) ?? 0) + capacityUnits(code));
          inbound.set(key(vi, code), (inbound.get(key(vi, code)) ?? 0) + capacityUnits(code));
        } else if (state === TO_DROPOFF) {
          inbound.set(key(vi, code), (inbound.get(key(vi, code)) ?? 0) + (h.carryAmount[i] as number));
        } else if (state === TO_DELIVERY) {
          const k = key(h.building[i] as number, code);
          deliveryClaims.set(k, (deliveryClaims.get(k) ?? 0) + (h.carryAmount[i] as number));
        }
      });

      // job lists per village, ascending building order (deterministic) —
      // haulers serve their OWN village; cross-village trade is caravans (M16+)
      interface Job { kind: typeof TO_PICKUP | typeof TO_DELIVERY; building: number; code: number }
      const jobsByVillage = new Map<number, Job[]>();
      const pushJob = (vi: number, job: Job): void => {
        const list = jobsByVillage.get(vi);
        if (list === undefined) jobsByVillage.set(vi, [job]);
        else list.push(job);
      };
      world.query([BuildingCore, BuildingInventory]).forEach((i, entity) => {
        if ((b.complete[i] as number) !== 1) return;
        const def = game.ops.buildingDef(b.def[i] as number);
        if (def.recipes === undefined) return;
        const vi = index(b.village[i] as number);
        const inventory = inventories.tryGet((entity as number) & 0x3fffff);
        const stock = stocks.tryGet(vi);
        if (inventory === undefined || stock === undefined) return;
        const outputs = new Set<number>();
        const inputs = new Map<number, number>(); // code → perDay
        for (const recipe of def.recipes) {
          for (const y of recipe.outputs) outputs.add(game.ops.resourceCode(y.resource) as number);
          for (const y of recipe.inputs) {
            const code = game.ops.resourceCode(y.resource) as number;
            inputs.set(code, (inputs.get(code) ?? 0) + y.perDay);
          }
        }
        // pickups: outbox worth a trip AND the stockpile can still take it
        for (const code of [...outputs].sort((a, c) => a - c)) {
          const available = (inventory.get(code) ?? 0) - (pickupClaims.get(key(entity as number, code)) ?? 0);
          if (available * (weightOf.get(code) ?? 1) < PICKUP_MIN_WEIGHT) continue;
          const headroom = capOf(vi, code) - (stock.get(code) ?? 0) - (inbound.get(key(vi, code)) ?? 0);
          if (headroom <= 0) continue;
          pushJob(vi, { kind: TO_PICKUP, building: entity as number, code });
        }
        // deliveries: input buffer low AND the stockpile has stock to send
        for (const [code, perDay] of [...inputs.entries()].sort((a, c) => a[0] - c[0])) {
          const buffered = (inventory.get(code) ?? 0) + (deliveryClaims.get(key(entity as number, code)) ?? 0);
          if (buffered >= perDay * DELIVERY_BUFFER_DAYS) continue;
          if ((stock.get(code) ?? 0) <= 0) continue;
          pushJob(vi, { kind: TO_DELIVERY, building: entity as number, code });
        }
      });
      if (jobsByVillage.size === 0) return;

      // assignment: idle haulers in entity order take their village's jobs in board order
      const cursors = new Map<number, number>();
      for (const haulerId of idle) {
        const hi = index(haulerId);
        const homeVi = index(h.village[hi] as number);
        const villageJobs = jobsByVillage.get(homeVi);
        if (villageJobs === undefined) continue;
        const cursor = cursors.get(homeVi) ?? 0;
        if (cursor >= villageJobs.length) continue;
        cursors.set(homeVi, cursor + 1);
        const job = villageJobs[cursor] as Job;
        const bi = index(job.building);
        const vi = homeVi;
        const hx = Math.round(pos.x[hi] as number);
        const hy = Math.round(pos.y[hi] as number);
        // pickups walk to the building first; deliveries load at the centre first
        const target =
          job.kind === TO_PICKUP
            ? { x: b.x[bi] as number, y: b.y[bi] as number }
            : { x: core.centerX[vi] as number, y: core.centerY[vi] as number };
        const route = paths.route(hx, hy, target.x, target.y);
        if (route === null) continue; // unreachable: leave the job for another day
        h.state[hi] = job.kind === TO_PICKUP ? TO_PICKUP : TO_DELIVERY;
        h.building[hi] = job.building;
        h.carryCode[hi] = job.code;
        h.carryAmount[hi] = 0;
        h.pathIndex[hi] = 0;
        h.progress[hi] = 0;
        pathsOf.set(index(haulerId), route);
        // register the fresh claim so the next idle hauler sees it
        if (job.kind === TO_PICKUP) {
          pickupClaims.set(key(job.building, job.code), (pickupClaims.get(key(job.building, job.code)) ?? 0) + capacityUnits(job.code));
          inbound.set(key(vi, job.code), (inbound.get(key(vi, job.code)) ?? 0) + capacityUnits(job.code));
        } else {
          deliveryClaims.set(key(job.building, job.code), (deliveryClaims.get(key(job.building, job.code)) ?? 0) + capacityUnits(job.code));
        }
      }
    },
  };

  // ---------------- movement: walk paths, transfer at endpoints ----------------
  const movement: SimSystem = {
    name: 'haul-move',
    period: 1,
    access: {
      writes: [Hauler, HaulerPath, Position, Stockpile, BuildingInventory],
      reads: [BuildingCore, VillageCore, econ.StockLimits],
    },
    update(): void {
      const h = world.write(Hauler);
      const pos = world.write(Position);
      const core = world.read(VillageCore);
      const b = world.read(BuildingCore);
      const stocks = world.writeObj(Stockpile);
      const inventories = world.writeObj(BuildingInventory);
      const pathsOf = world.writeObj(HaulerPath);
      const w = terrain.width;
      let capOf: ((vi: number, code: number) => number) | null = null; // lazy: arrivals only

      world.query([Hauler, Position]).forEach((hi) => {
        const state = h.state[hi] as number;
        if (state === IDLE) return;
        const path = pathsOf.tryGet(hi) ?? [];
        let pathIndex = h.pathIndex[hi] as number;

        // walk: spend one tick of movement, possibly crossing several road tiles
        if (pathIndex < path.length) {
          let progress = (h.progress[hi] as number) + 1;
          while (pathIndex < path.length) {
            const tile = path[pathIndex] as number;
            const cost = paths.stepCost(tile % w, Math.floor(tile / w));
            if (progress < cost) break;
            progress -= cost;
            pos.x[hi] = tile % w;
            pos.y[hi] = Math.floor(tile / w);
            pathIndex++;
          }
          h.pathIndex[hi] = pathIndex;
          h.progress[hi] = pathIndex < path.length ? progress : 0;
          if (pathIndex < path.length) return; // still en route
        }

        // arrived: transfer per state
        const vi = index(h.village[hi] as number);
        const code = h.carryCode[hi] as number;
        const stock = stocks.tryGet(vi);
        if (stock === undefined) return;
        if (state === TO_PICKUP) {
          const bi = index(h.building[hi] as number);
          const inventory = inventories.tryGet(index(h.building[hi] as number));
          if (inventory === undefined) {
            h.state[hi] = IDLE;
            return;
          }
          const amount = Math.min(capacityUnits(code), inventory.get(code) ?? 0);
          inventory.set(code, (inventory.get(code) ?? 0) - amount);
          h.carryAmount[hi] = amount;
          h.state[hi] = TO_DROPOFF;
          h.pathIndex[hi] = 0;
          h.progress[hi] = 0;
          const route = paths.route(b.x[bi] as number, b.y[bi] as number, core.centerX[vi] as number, core.centerY[vi] as number);
          pathsOf.set(hi, route ?? []);
        } else if (state === TO_DROPOFF) {
          // unload up to the effective cap
          capOf ??= econ.capsView();
          const headroom = Math.max(0, capOf(vi, code) - (stock.get(code) ?? 0));
          const dropped = Math.min(h.carryAmount[hi] as number, headroom);
          stock.set(code, (stock.get(code) ?? 0) + dropped);
          h.carryAmount[hi] = (h.carryAmount[hi] as number) - dropped;
          // A FULL stockpile must NOT park the hauler here forever: a resource whose
          // consumers are also saturated stays capped indefinitely, and a hauler frozen
          // on it is a hauler that never carries food again — the village starves amid
          // full warehouses (root cause of the M-era famine deadlock). Instead, hand the
          // remainder back to the source outbox and free the hauler (matter conserved).
          if ((h.carryAmount[hi] as number) > 1e-9) {
            const inventory = inventories.tryGet(index(h.building[hi] as number));
            // source building gone mid-trip: leave the load on the stockpile (conserved)
            (inventory ?? stock).set(code, ((inventory ?? stock).get(code) ?? 0) + (h.carryAmount[hi] as number));
          }
          h.carryAmount[hi] = 0;
          h.carryCode[hi] = 0;
          h.state[hi] = IDLE;
        } else if (state === TO_DELIVERY) {
          if ((h.carryAmount[hi] as number) === 0) {
            // at the centre: load up (bounded by need buffer, capacity, stock)
            const bi = index(h.building[hi] as number);
            const def = game.ops.buildingDef(b.def[bi] as number);
            let perDay = 0;
            for (const recipe of def.recipes ?? []) {
              for (const y of recipe.inputs) {
                if ((game.ops.resourceCode(y.resource) as number) === code) perDay += y.perDay;
              }
            }
            const amount = Math.min(capacityUnits(code), stock.get(code) ?? 0, perDay * DELIVERY_BUFFER_DAYS);
            if (amount <= 0) {
              h.state[hi] = IDLE;
              return;
            }
            stock.set(code, (stock.get(code) ?? 0) - amount);
            h.carryAmount[hi] = amount;
            h.pathIndex[hi] = 0;
            h.progress[hi] = 0;
            const route = paths.route(core.centerX[vi] as number, core.centerY[vi] as number, b.x[bi] as number, b.y[bi] as number);
            pathsOf.set(hi, route ?? []);
          } else {
            // at the building: hand the inputs over
            const inventory = inventories.tryGet(index(h.building[hi] as number));
            if (inventory !== undefined) {
              inventory.set(code, (inventory.get(code) ?? 0) + (h.carryAmount[hi] as number));
            } else {
              // building vanished mid-trip: return the load to the stockpile
              stock.set(code, (stock.get(code) ?? 0) + (h.carryAmount[hi] as number));
            }
            h.carryAmount[hi] = 0;
            h.carryCode[hi] = 0;
            h.state[hi] = IDLE;
          }
        }
      });
    },
  };

  kernel.registerSystem(staffing);
  kernel.registerSystem(board);
  kernel.registerSystem(movement);

  return {
    Hauler,
    HaulerPath,
    roads,
    paths,
    buildRoad,
    totalOf(vi: number, code: number): number {
      let total = econ.totalOf(vi, code);
      const h = world.read(Hauler);
      world.query([Hauler]).forEach((hi) => {
        if (index(h.village[hi] as number) !== vi) return;
        if ((h.carryCode[hi] as number) === code) total += h.carryAmount[hi] as number;
      });
      return total;
    },
  };
}
