/**
 * Army movement & supply (roadmap M26; GDD §6; doc 06 §3 Army state; doc 08 §7).
 *
 * PATHING uses the hierarchical HPA* service (nav/hpaStar.ts) — armies range
 * across the whole map, unlike haulers' village-radius A* (logistics.ts).
 * `army.moveTo` computes the route once and sets stance to `march`; arrival
 * auto-garrisons. Movement speed is `terrain (baked into the route) × season
 * × fatigue` (doc 08 §7) — season and fatigue are TEMPORAL multipliers on how
 * fast a fixed tile sequence is walked, not spatial costs, so they never
 * invalidate the (expensive-to-build-once) portal graph.
 *
 * SUPPLY (daily, GDD §6): an army's ration need is drawn first from its
 * carried `ArmySupplies`, then FORAGED from the nearest friendly village
 * within `SUPPLY_RANGE` tiles (draining that village's food stockpile — a
 * real cost, not a free depot). Failing both, `fatigue` climbs; sustained
 * max fatigue triggers ATTRITION — unlike disbanding or desertion (military.ts,
 * M25), attrition genuinely destroys soldiers: the lost `count` is NOT
 * returned to any population cohort. Winter roughly doubles both the
 * fatigue climb and the attrition rate (doc 08 §3's "winter: high w/o
 * supply").
 *
 * STANCES (garrison|patrol|raid|siege|march) are stored per doc 06 §3, but
 * only `garrison` (halts movement) and `march` (set automatically by
 * `army.moveTo`) have any effect yet — patrol/raid/siege stay inert until
 * their consuming systems land (zone-of-control needs hostile kingdoms, M31;
 * siege needs castles, M28), same "data now, active later" pattern as
 * Unit.stats awaiting Combat (M27).
 */
import type { EntityId } from '@crowns/core';
import { ObjectComponent, SoAComponent, World } from '../ecs.js';
import type { Kernel, SimSystem, TickContext } from '../kernel.js';
import { TICKS_PER_DAY, calendarFromTick } from '../time.js';
import { HierarchicalPathService, type HpaTerrain } from '../nav/hpaStar.js';
import { FOOD_PER_PERSON_DAY } from './population.js';
import type { VillageGameplay } from './villages.js';
import type { MilitaryGameplay } from './military.js';
import type { KingdomGameplay } from './kingdom.js';

const index = (id: number): number => id & 0x3fffff;

// ---------------------------------------------------------------- constants

export const STANCES = ['garrison', 'patrol', 'raid', 'siege', 'march'] as const;
export type Stance = (typeof STANCES)[number];
const GARRISON = 0;
const MARCH = 4;

/** doc 08 §3: spring mud / winter snow slow movement (season index: spring, summer, autumn, winter). */
export const SEASON_SPEED = [0.8, 1, 1, 0.7] as const;
/** doc 08 §3: winter roughly doubles unsupplied attrition. */
export const SEASON_ATTRITION_MULT = [1, 1, 1, 2] as const;

export const SUPPLY_RANGE = 20; // tiles (Chebyshev) — forage range from a friendly village
export const ARMY_RATION_PER_HEAD = FOOD_PER_PERSON_DAY; // soldiers eat like anyone else
export const FATIGUE_RISE_PER_DAY = 15; // unsupplied: 0 → 100 in ~7 days
export const FATIGUE_RECOVER_PER_DAY = 25; // supplied: recovers faster than it rises
export const ATTRITION_RATE_AT_MAX_FATIGUE = 0.05; // fraction of each unit's count lost per day, sustained

// ---------------------------------------------------------------- components

export type ArmyMovementComponent = SoAComponent<{
  x: 'f64';
  y: 'f64';
  pathIndex: 'u16';
  progress: 'f64';
  stance: 'u8';
  fatigue: 'f64'; // 0..100
}>;

export interface ArmyGameplay {
  readonly ArmyMovement: ArmyMovementComponent;
  readonly ArmyPath: ObjectComponent<number[]>;
  readonly ArmySupplies: ObjectComponent<Map<number, number>>;
  readonly paths: HierarchicalPathService;
}

// ---------------------------------------------------------------- registrar

export function registerArmyGameplay(
  kernel: Kernel,
  world: World,
  game: VillageGameplay,
  militaryGame: MilitaryGameplay,
  kingdomGame: KingdomGameplay,
): ArmyGameplay {
  const { VillageCore, Stockpile } = game.comps;
  const { Unit, Army } = militaryGame;
  const { VillageOwner } = kingdomGame;
  const terrain = game.terrain;
  const foodCode = game.ops.resourceCode('base:resource.food') as number;

  const hpaTerrain: HpaTerrain = {
    width: terrain.width,
    height: terrain.height,
    passableAt: (x, y) => terrain.movementCostAt(x, y) > 0 && !terrain.riverAt(x, y),
    stepCostAt: (x, y) => terrain.movementCostAt(x, y),
  };
  const paths = new HierarchicalPathService(hpaTerrain);

  const ArmyMovement: ArmyMovementComponent = world.defineSoA('armyMovement', {
    x: 'f64', y: 'f64', pathIndex: 'u16', progress: 'f64', stance: 'u8', fatigue: 'f64',
  });
  const ArmyPath = world.defineObject<number[]>('armyPath', (path, fold) => {
    for (const tile of path) fold(tile);
  });
  const ArmySupplies = world.defineObject<Map<number, number>>('armySupplies', (supplies, fold) => {
    for (const key of [...supplies.keys()].sort((a, b) => a - b)) {
      fold(key);
      fold(supplies.get(key) as number);
    }
  });

  const reject = (ctx: TickContext, what: string, reason: string, issuer: number): void => {
    ctx.events.publish({ type: 'village.rejected', tick: ctx.tick, data: { what, reason, issuer } });
  };

  // an army is positioned and given movement state the moment military.ts creates it
  kernel.subscribe<{ army: number; x: number; y: number }>('army.created', (event) => {
    const army = event.data.army as EntityId;
    world.attach(army, ArmyMovement, { x: event.data.x, y: event.data.y, pathIndex: 0, progress: 0, stance: GARRISON, fatigue: 0 });
    world.attach(army, ArmyPath, []);
    world.attach(army, ArmySupplies, new Map());
  });

  const kingdomForIssuer = (issuer: number): EntityId | undefined => {
    const all = kingdomGame.kingdomEntities();
    return all[issuer - 1] ?? all[0];
  };

  // ---------------- commands ----------------

  kernel.registerCommand<{ armyId: number; x: number; y: number }>('army.moveTo', (ctx, p, command) => {
    const army = (p.armyId | 0) as EntityId;
    if (!world.isAlive(army) || !world.has(army, ArmyMovement)) return reject(ctx, 'army.moveTo', 'no such army', command.issuer);
    const kingdomId = kingdomForIssuer(command.issuer);
    if (kingdomId === undefined || (world.read(Army).kingdomId[index(army as number)] as number) !== (kingdomId as number)) {
      return reject(ctx, 'army.moveTo', 'not your army', command.issuer);
    }
    const x = p.x | 0;
    const y = p.y | 0;
    if (x < 0 || y < 0 || x >= terrain.width || y >= terrain.height || !hpaTerrain.passableAt(x, y)) {
      return reject(ctx, 'army.moveTo', 'destination is impassable or out of bounds', command.issuer);
    }
    const ai = index(army as number);
    const m = world.write(ArmyMovement);
    const route = paths.route(Math.round(m.x[ai] as number), Math.round(m.y[ai] as number), x, y);
    if (route === null) return reject(ctx, 'army.moveTo', 'no route to that destination', command.issuer);
    world.writeObj(ArmyPath).set(ai, route);
    m.pathIndex[ai] = 0;
    m.progress[ai] = 0;
    m.stance[ai] = MARCH;
    ctx.events.publish({ type: 'army.marchOrdered', tick: ctx.tick, data: { army: army as number, x, y } });
  });

  kernel.registerCommand<{ armyId: number; stance: string }>('army.setStance', (ctx, p, command) => {
    const army = (p.armyId | 0) as EntityId;
    if (!world.isAlive(army) || !world.has(army, ArmyMovement)) return reject(ctx, 'army.setStance', 'no such army', command.issuer);
    const kingdomId = kingdomForIssuer(command.issuer);
    if (kingdomId === undefined || (world.read(Army).kingdomId[index(army as number)] as number) !== (kingdomId as number)) {
      return reject(ctx, 'army.setStance', 'not your army', command.issuer);
    }
    const stanceIndex = STANCES.indexOf(p.stance as Stance);
    if (stanceIndex === -1) return reject(ctx, 'army.setStance', `unknown stance '${String(p.stance)}' (${STANCES.join('/')})`, command.issuer);
    const ai = index(army as number);
    const m = world.write(ArmyMovement);
    m.stance[ai] = stanceIndex;
    if (stanceIndex === GARRISON) {
      world.writeObj(ArmyPath).set(ai, []);
      m.pathIndex[ai] = 0;
      m.progress[ai] = 0;
    }
    ctx.events.publish({ type: 'army.stanceSet', tick: ctx.tick, data: { army: army as number, stance: p.stance } });
  });

  // ---------------- every tick: walk the path (doc 08 §2 slot 3) ----------------
  const movement: SimSystem = {
    name: 'army-movement',
    period: 1,
    access: { writes: [ArmyMovement, ArmyPath] },
    update(ctx: TickContext): void {
      const m = world.write(ArmyMovement);
      const pathsOf = world.writeObj(ArmyPath);
      const w = terrain.width;
      const season = calendarFromTick(ctx.tick).season;
      const speedFactor = SEASON_SPEED[season] as number;
      world.query([ArmyMovement]).forEach((ai, entity) => {
        const path = pathsOf.tryGet(ai) ?? [];
        let pathIndex = m.pathIndex[ai] as number;
        if (pathIndex >= path.length) return;
        const fatigueFactor = 1 - ((m.fatigue[ai] as number) / 100) * 0.5; // up to −50% at max fatigue
        let progress = (m.progress[ai] as number) + speedFactor * fatigueFactor;
        while (pathIndex < path.length) {
          const tile = path[pathIndex] as number;
          const cost = paths.stepCost(tile % w, Math.floor(tile / w));
          if (progress < cost) break;
          progress -= cost;
          m.x[ai] = tile % w;
          m.y[ai] = Math.floor(tile / w);
          pathIndex++;
        }
        m.pathIndex[ai] = pathIndex;
        m.progress[ai] = pathIndex < path.length ? progress : 0;
        if (pathIndex >= path.length && path.length > 0) {
          m.stance[ai] = GARRISON; // arrived: settle in
          ctx.events.publish({ type: 'army.arrived', tick: ctx.tick, data: { army: entity as number, x: m.x[ai] as number, y: m.y[ai] as number } });
        }
      });
    },
  };

  // ---------------- daily: supply, forage, fatigue, attrition ----------------
  const supply: SimSystem = {
    name: 'army-supply',
    period: TICKS_PER_DAY,
    phase: 8,
    access: {
      writes: [ArmyMovement, ArmySupplies, Stockpile, Unit],
      reads: [Army, VillageCore, ...(VillageOwner !== undefined ? [VillageOwner] : [])],
    },
    update(ctx: TickContext): void {
      const m = world.write(ArmyMovement);
      const a = world.read(Army);
      const u = world.write(Unit);
      const supplies = world.writeObj(ArmySupplies);
      const stocks = world.writeObj(Stockpile);
      const core = world.read(VillageCore);
      const ownerOf = VillageOwner !== undefined ? world.read(VillageOwner) : null;
      const season = calendarFromTick(ctx.tick).season;
      const attritionMult = SEASON_ATTRITION_MULT[season] as number;

      // headcount per army (ascending unit order — deterministic regardless of assignment order)
      const headcount = new Map<number, number>();
      world.query([Unit]).forEach((ui) => {
        const armyId = u.armyId[ui] as number;
        if (armyId === 0 || (u.complete[ui] as number) !== 1) return;
        headcount.set(armyId, (headcount.get(armyId) ?? 0) + (u.count[ui] as number));
      });

      // village candidates for foraging, precomputed once (not per army). In
      // single-kingdom compositions (VillageOwner absent) every village is
      // friendly to the one kingdom that exists, matching kingdom.ts's own
      // "no VillageOwner ⇒ single kingdom owns everything" convention.
      const soleKingdom = kingdomGame.kingdomEntities()[0] as number | undefined;
      const villages: { vi: number; x: number; y: number; kingdomId: number }[] = [];
      world.query([VillageCore]).forEach((vi) => {
        const kingdomId = ownerOf !== null ? (ownerOf.kingdom[vi] as number) : soleKingdom;
        if (kingdomId === undefined) return;
        villages.push({ vi, x: core.centerX[vi] as number, y: core.centerY[vi] as number, kingdomId });
      });

      world.query([ArmyMovement, ArmySupplies]).forEach((ai, entity) => {
        const count = headcount.get(entity as number);
        if (count === undefined || count <= 0) return; // no complete units — nothing to feed, nothing to lose
        let need = count * ARMY_RATION_PER_HEAD;
        const carried = supplies.tryGet(ai);
        if (carried !== undefined) {
          const have = carried.get(foodCode) ?? 0;
          const eaten = Math.min(have, need);
          if (eaten > 0) carried.set(foodCode, have - eaten);
          need -= eaten;
        }
        if (need > 1e-9) {
          const kingdomId = a.kingdomId[ai] as number;
          const ax = m.x[ai] as number;
          const ay = m.y[ai] as number;
          let nearest: { vi: number } | null = null;
          let nearestDist = Infinity;
          for (const v of villages) {
            if (v.kingdomId !== kingdomId) continue;
            const dist = Math.max(Math.abs(v.x - ax), Math.abs(v.y - ay));
            if (dist <= SUPPLY_RANGE && dist < nearestDist) {
              nearestDist = dist;
              nearest = v;
            }
          }
          if (nearest !== null) {
            const stock = stocks.tryGet(nearest.vi);
            if (stock !== undefined) {
              const have = stock.get(foodCode) ?? 0;
              const foraged = Math.min(have, need);
              if (foraged > 0) stock.set(foodCode, have - foraged);
              need -= foraged;
            }
          }
        }
        if (need > 1e-9) {
          m.fatigue[ai] = Math.min(100, (m.fatigue[ai] as number) + FATIGUE_RISE_PER_DAY * attritionMult);
        } else {
          m.fatigue[ai] = Math.max(0, (m.fatigue[ai] as number) - FATIGUE_RECOVER_PER_DAY);
        }

        // sustained max fatigue grinds the army down — real losses, not returned to any cohort
        if ((m.fatigue[ai] as number) >= 100) {
          const rate = ATTRITION_RATE_AT_MAX_FATIGUE * attritionMult;
          let lost = 0;
          world.query([Unit]).forEach((ui) => {
            if ((u.armyId[ui] as number) !== (entity as number) || (u.complete[ui] as number) !== 1) return;
            const current = u.count[ui] as number;
            const loss = current * rate;
            u.count[ui] = Math.max(0, current - loss);
            lost += loss;
          });
          if (lost > 1e-9) {
            ctx.events.publish({ type: 'army.attrition', tick: ctx.tick, data: { army: entity as number, lost } });
          }
        }
      });
    },
  };

  kernel.registerSystem(movement);
  kernel.registerSystem(supply);

  return { ArmyMovement, ArmyPath, ArmySupplies, paths };
}
