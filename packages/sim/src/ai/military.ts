/**
 * AI military manager & tactical policy (roadmap M30; doc 07 §3/§4/§5).
 * Daily, and only while the strategic planner's active plan is
 * `MilitaryBuildup` or `ConquestWar` (planner.ts, M30) — a peaceful kingdom
 * never touches any of this, the same "only spend effort a chosen plan asks
 * for" discipline as M20's construction manager.
 *
 * ONE ACTION PER DAY, in priority order (mirrors manager.ts's build-one-
 * per-day anti-spam pattern): raise a barracks if missing → recruit a unit →
 * assemble/garrison it into an army → fortify (queue the next missing wall
 * segment of a basic ring) → tactical war conduct.
 *
 * TACTICAL POLICY (doc 07 §3, v1 slice): pick the nearest known war target
 * (`AiMilitaryOptions.warTargets` — fog-gated, supplied by the composition,
 * same shape convention as diplomacy's `knownKingdoms`); march the army
 * there (`army.moveTo`, M26 HPA*); once at a castle, `siege.begin`, target
 * the nearest wall, and `siege.assault` the moment a breach opens. Field
 * contact against a non-castle village is left to combat.ts's own proximity
 * detection — no separate "attack" order exists (M27's design). The
 * "battle layer" order vocabulary (advance/hold/flank/target/withdraw, doc
 * 07 §3) stays mostly unimplemented past `withdraw` — those orders don't
 * exist as resolvable levers in combat.ts yet (M27's own deferral), so there
 * is nothing for a tactical policy to choose between; retreat-on-losing
 * thresholds are the same gap and stay deferred here too.
 *
 * CASTLE-BUILDING AI (doc 07 §5): a fixed small ring around the village
 * centre (`planCastleRing`), not the doc's terrain-adapted archetype
 * templates (motte/concentric/ridge-line) — a v1 simplification, same
 * spirit as M20 shipping only 2 of doc 07 §5's need types.
 */
import type { EntityId } from '@crowns/core';
import type { DefinitionDatabase } from '@crowns/data';
import type { Component, World } from '../ecs.js';
import type { Kernel, SimSystem } from '../kernel.js';
import { TICKS_PER_DAY } from '../time.js';
import { VILLAGE_RADIUS_T1, type VillageGameplay } from '../game/villages.js';
import type { MilitaryGameplay } from '../game/military.js';
import type { ArmyGameplay } from '../game/armies.js';
import type { CastleGameplay } from '../game/castles.js';
import type { SiegeGameplay } from '../game/siege.js';
import { FOOD_PER_PERSON_DAY, type PopulationGameplay } from '../game/population.js';
import { productionCapacity } from './needs.js';
import { findBuildSite } from './placement.js';

const index = (id: number): number => id & 0x3fffff;

export const BARRACKS_DEF = 'base:building.barracks';
export const RECRUIT_ORDER = ['base:unit.spearman', 'base:unit.militia'] as const; // preference order, cheapest fallback
export const WAR_MIN_STRENGTH = 20; // committed troop count before marching to war
/** M46 balance fix (doc 01 §8 SC-2): recruiting costs `UnitDef.popCost` ADULTS, permanently,
 * whether or not the war they were raised for ever happens — an unconditional daily recruit
 * order with no regard for whether the village can still feed itself was found, via the M46
 * balance harness (`bench-balance.js`), to reliably famine-collapse EVERY AI kingdom within 5
 * years, at every difficulty, with zero wars ever declared (recruiting alone did it). Requiring
 * real food surplus — not just break-even — before recruiting is the minimal fix: it defers
 * MilitaryBuildup, it never cancels it outright (the daily loop retries once the economy catches
 * up), so an aggressive personality still builds an army, just not by starving its own farms. */
export const RECRUIT_FOOD_SURPLUS_RATIO = 1.3;
/** M46 balance fix, second gate: `productionCapacity` (ai/needs.ts) reports DECLARED recipe
 * capacity for complete buildings, not realized output after workforce staffing — so the food
 * ratio alone still let a real harness run recruit its way into a spiral once one recruit
 * thinned the farm's actual workforce below what nominal capacity assumed. A floor below which
 * the village simply never recruits, regardless of nominal food math, is the blunter backstop
 * that actually held up under the M46 balance harness. */
export const RECRUIT_MIN_POPULATION_FLOOR = 20;
/** M47.8: recruiting eats ADULTS — at least this many must remain to run farms/haul/build. */
export const RECRUIT_MIN_ADULTS_REMAINING = 12;
/** M47.8: realized-hunger gate — no levies from a village whose security EMA is sagging. */
export const RECRUIT_MIN_FOOD_SECURITY = 0.95;
export const WALL_DEF = 'base:building.wall';
export const CASTLE_RING_RADIUS = 6;
const WAR_STANCE_CONTACT_RANGE = 1; // Chebyshev — "arrived" for tactical purposes

/** Fixed 3×3-at-`radius` perimeter (mirrors castles.test.ts's proven fixture shape) — a v1
 * simplification of doc 07 §5's terrain-adapted castle templates. */
export function planCastleRing(centerX: number, centerY: number, radius: number): readonly { x: number; y: number }[] {
  const r = radius;
  return [
    { x: centerX - r, y: centerY - r }, { x: centerX, y: centerY - r }, { x: centerX + r, y: centerY - r },
    { x: centerX - r, y: centerY + r }, { x: centerX, y: centerY + r }, { x: centerX + r, y: centerY + r },
    { x: centerX - r, y: centerY }, { x: centerX + r, y: centerY },
  ];
}

export interface AiWarTarget {
  readonly kingdomId: number;
  readonly villageId: number;
  readonly x: number;
  readonly y: number;
  readonly isCastle: boolean;
}

/** Ties the tactical manager to game/diplomacy.ts's war state (M31) — kept structural (not a
 * direct `DiplomacyState` reference) for the same reason `AiDiplomacyContext` (planner.ts) is:
 * ai/ already depends on game/, and this narrows the surface to just what tactics needs. */
export interface AiWarDiplomacy {
  isAtWar(target: EntityId): boolean;
  declareWar(target: EntityId): void;
  proposePeace(target: EntityId, tribute: number): void;
}

export interface AiMilitaryOptions {
  readonly issuer: number;
  readonly villageId: EntityId;
  readonly kingdomId: EntityId;
  readonly getPlan: () => string;
  /** M47.8: the kingdom this AI holds its heaviest grudge against (doc 07 §7) — a PunitiveRaid
   * prefers that kingdom's villages over merely-nearest targets. Optional and additive. */
  readonly grudgeTarget?: () => EntityId | null;
  /** Known (fog-gated) hostile villages worth marching on — omit for buildup-only behaviour
   * (recruit/assemble/fortify, never marches to war). */
  readonly warTargets?: () => readonly AiWarTarget[];
  /** War declaration/peace-suing (M31) — omit to keep the M30 behaviour (combat starts on
   * contact with no formal declaration, and never ends until the target is gone). */
  readonly diplomacy?: AiWarDiplomacy;
  /** M53: true when this besieged castle resolves SPATIALLY (a defence-layer capital) —
   * the walk handles walls itself, so assault immediately instead of waiting for a
   * bombardment breach that can never open (no world-map defence graph to bombard). */
  readonly spatialSiege?: (castleVillageIndex: number) => boolean;
  readonly id?: string;
  readonly searchRadius?: number;
  /** Extra components a custom `getPlan` reads (e.g. the planner's `AiPlanState` component). */
  readonly extraReads?: readonly Component[];
}

function hasBuildingOfDef(world: World, game: VillageGameplay, villageIndex: number, defCode: number, completeOnly: boolean): boolean {
  const b = world.read(game.comps.BuildingCore);
  let found = false;
  world.query([game.comps.BuildingCore]).forEach((i) => {
    if (found) return;
    if (index(b.village[i] as number) !== villageIndex) return;
    if ((b.def[i] as number) !== defCode) return;
    if (completeOnly && (b.complete[i] as number) !== 1) return;
    found = true;
  });
  return found;
}

export function registerAiMilitaryManager(
  kernel: Kernel,
  world: World,
  db: DefinitionDatabase,
  game: VillageGameplay,
  popGame: PopulationGameplay,
  military: MilitaryGameplay,
  armies: ArmyGameplay,
  castleGame: CastleGameplay,
  siegeGame: SiegeGameplay,
  options: AiMilitaryOptions,
): void {
  const { VillageCore, BuildingCore } = game.comps;
  const { Unit, Army } = military;
  const { ArmyMovement } = armies;
  const searchRadius = options.searchRadius ?? VILLAGE_RADIUS_T1;

  const ownArmy = (): number | undefined => {
    const a = world.read(Army);
    let found: number | undefined;
    world.query([Army]).forEach((ai, entity) => {
      if (found === undefined && (a.kingdomId[ai] as number) === (options.kingdomId as number)) found = entity as number;
    });
    return found;
  };

  const committedCount = (armyId: number): number => {
    const u = world.read(Unit);
    let total = 0;
    world.query([Unit]).forEach((ui) => {
      if ((u.armyId[ui] as number) === armyId && (u.complete[ui] as number) === 1) total += u.count[ui] as number;
    });
    return total;
  };

  const system: SimSystem = {
    name: options.id !== undefined ? `ai-military-${options.id}` : 'ai-military',
    period: TICKS_PER_DAY,
    phase: 7,
    access: { reads: [VillageCore, BuildingCore, Unit, Army, ArmyMovement, popGame.Population, ...(options.extraReads ?? [])] },
    update(): void {
      if (!world.isAlive(options.villageId)) return;
      const plan = options.getPlan();
      // M47.8: PunitiveRaid (doc 07 §7) is war conduct too — same buildup/march machinery,
      // but the grudge target outranks the merely-nearest one (below).
      if (plan !== 'MilitaryBuildup' && plan !== 'ConquestWar' && plan !== 'PunitiveRaid') {
        // war fell out of favor with the planner (economy/other archetype won out) — sue for
        // peace with anyone still at war (M31); a weak, tribute-free offer, but the exhaustion-
        // driven FORCED peace (diplomacy.ts) guarantees the war ends regardless of acceptance.
        if (options.diplomacy !== undefined && options.warTargets !== undefined) {
          for (const target of options.warTargets()) {
            if (options.diplomacy.isAtWar(target.kingdomId as EntityId)) {
              options.diplomacy.proposePeace(target.kingdomId as EntityId, 0);
            }
          }
        }
        return;
      }
      const vi = index(options.villageId as number);
      const core = world.read(VillageCore);
      const cx = core.centerX[vi] as number;
      const cy = core.centerY[vi] as number;

      const barracksCode = game.ops.defCode(BARRACKS_DEF);
      const hasBarracks = hasBuildingOfDef(world, game, vi, barracksCode, false);
      if (!hasBarracks) {
        const def = db.buildings.get(BARRACKS_DEF);
        if (def === undefined) return;
        const site = findBuildSite(game.ops, options.villageId, def, cx, cy, searchRadius);
        if (site !== null) {
          kernel.submit({ type: 'village.build', issuer: options.issuer, payload: { villageId: options.villageId as number, def: BARRACKS_DEF, x: site.x, y: site.y } });
        }
        return; // one action per day
      }

      if (hasBuildingOfDef(world, game, vi, barracksCode, true)) {
        const population = popGame.totalOf(vi);
        const foodNeeded = population * FOOD_PER_PERSON_DAY;
        const foodProduced = productionCapacity({ world, comps: game.comps, ops: game.ops, popGame, db, villageIndex: vi }, 'base:resource.food');
        const hasFoodSurplus = foodNeeded <= 0 || foodProduced / foodNeeded >= RECRUIT_FOOD_SURPLUS_RATIO;
        const nextUnitPopCost = db.units.get(RECRUIT_ORDER[0])?.popCost.count ?? 0;
        const staysAboveFloor = population - nextUnitPopCost >= RECRUIT_MIN_POPULATION_FLOOR;
        // M47.8 (real-composition matrix findings): the M46 gates were still nameplate-based.
        // Recruiting consumes ADULTS — the workforce — so the floor must hold in adults, not
        // total heads (a 30-person village with 14 adults passed the old floor, recruited 10 of
        // them, and famine-collapsed at year 10, both kingdoms, every seed). And declared farm
        // capacity means nothing if the village is REALIZED-hungry: gate on the security EMA too.
        const pop = world.read(popGame.Population);
        const adultsAfter = (pop.adults[vi] as number) - nextUnitPopCost;
        const keepsWorkforce = adultsAfter >= RECRUIT_MIN_ADULTS_REMAINING;
        const actuallyFed = (pop.foodSecurity[vi] as number) >= RECRUIT_MIN_FOOD_SECURITY;
        if (hasFoodSurplus && staysAboveFloor && keepsWorkforce && actuallyFed) {
          for (const defId of RECRUIT_ORDER) {
            kernel.submit({ type: 'army.recruitUnit', issuer: options.issuer, payload: { villageId: options.villageId as number, unitDef: defId } });
            break; // rejected silently (unaffordable etc.) is fine — retried next day
          }
        }
        // neither gate met: skip recruiting today, retried tomorrow — MilitaryBuildup stays the
        // active plan (a deferral, not a cancellation); the food-need evaluator (ai/needs.ts) the
        // CONSTRUCTION manager already reads keeps queueing farms in parallel regardless. TWO
        // gates, not one: `productionCapacity` reports DECLARED recipe capacity for complete
        // buildings, not realized output after workforce staffing (economy.ts's own efficiency
        // scaling) — a food ratio alone still let the M46 balance harness observe a long-stable
        // 25-population village take a 3rd recruit, then spiral to 4 over the next nine months
        // once that recruit itself thinned the farm's workforce below what nominal capacity
        // assumed. The population floor is the blunter, harness-verified-effective backstop.
      }

      const armyId = ownArmy();
      if (armyId === undefined) {
        kernel.submit({ type: 'army.createArmy', issuer: options.issuer, payload: { name: 'Warhost', villageId: options.villageId as number } });
        return;
      }

      const u = world.read(Unit);
      let assignedOne = false;
      world.query([Unit]).forEach((ui, entity) => {
        if (assignedOne) return;
        if ((u.homeVillage[ui] as number) !== (options.villageId as number)) return;
        if ((u.armyId[ui] as number) !== 0 || (u.complete[ui] as number) !== 1) return;
        kernel.submit({ type: 'army.assignUnit', issuer: options.issuer, payload: { unitId: entity as number, armyId } });
        assignedOne = true;
      });
      if (assignedOne) return;

      // castle-building AI (doc 07 §5): queue the next missing ring segment, one per day
      const ring = planCastleRing(cx, cy, CASTLE_RING_RADIUS);
      const wallDef = db.buildings.get(WALL_DEF);
      if (wallDef !== undefined) {
        const b = world.read(BuildingCore);
        const missing = ring.find(({ x, y }) => {
          let occupied = false;
          world.query([BuildingCore]).forEach((i) => {
            if (occupied) return;
            if ((b.x[i] as number) === x && (b.y[i] as number) === y) occupied = true;
          });
          return !occupied && game.ops.validatePlacement(wallDef, x, y, options.villageId).ok;
        });
        if (missing !== undefined) {
          kernel.submit({ type: 'village.build', issuer: options.issuer, payload: { villageId: options.villageId as number, def: WALL_DEF, x: missing.x, y: missing.y } });
          return;
        }
      }

      // tactical war conduct (doc 07 §3) — ConquestWar and PunitiveRaid (M47.8)
      if ((plan !== 'ConquestWar' && plan !== 'PunitiveRaid') || options.warTargets === undefined) return;
      if (committedCount(armyId) < WAR_MIN_STRENGTH) return;

      const existingSiege = siegeGame.state.siegeOfArmy(armyId);
      if (existingSiege !== undefined) {
        // M53: a fallen capital's fate belongs to succession — the army waits
        if (existingSiege.fallenDeadline !== 0) return;
        // M53: spatial capitals have no bombardable world-map graph — assault directly
        if (options.spatialSiege?.(existingSiege.castle) ?? false) {
          if (existingSiege.assaultEngagementArmy === 0) {
            kernel.submit({ type: 'siege.assault', issuer: options.issuer, payload: { armyId } });
          }
          return;
        }
        if (existingSiege.targetBuilding === 0) {
          const graph = castleGame.defenseGraphOf(existingSiege.castle);
          const node = graph.nodes[0];
          if (node !== undefined) {
            kernel.submit({ type: 'siege.setTarget', issuer: options.issuer, payload: { armyId, buildingId: node.building } });
          }
        } else if (existingSiege.breaches > 0 && existingSiege.assaultEngagementArmy === 0) {
          kernel.submit({ type: 'siege.assault', issuer: options.issuer, payload: { armyId } });
        }
        return;
      }

      let targets = options.warTargets();
      if (targets.length === 0) return;
      // M47.8 (doc 07 §7): a PunitiveRaid marches on WHOEVER WRONGED US, not whoever's closest —
      // narrow the target list to the grudge-holder's villages when the composition supplies one.
      if (plan === 'PunitiveRaid' && options.grudgeTarget !== undefined) {
        const grudge = options.grudgeTarget();
        if (grudge !== null) {
          const held = targets.filter((t) => t.kingdomId === (grudge as number));
          if (held.length > 0) targets = held;
        }
      }
      const ai = index(armyId);
      const m = world.read(ArmyMovement);
      const ax = m.x[ai] as number;
      const ay = m.y[ai] as number;
      const nearest = [...targets].sort(
        (a, b) =>
          Math.max(Math.abs(a.x - ax), Math.abs(a.y - ay)) - Math.max(Math.abs(b.x - ax), Math.abs(b.y - ay)),
      )[0] as AiWarTarget;
      if (options.diplomacy !== undefined && !options.diplomacy.isAtWar(nearest.kingdomId as EntityId)) {
        options.diplomacy.declareWar(nearest.kingdomId as EntityId);
      }
      const dist = Math.max(Math.abs(nearest.x - ax), Math.abs(nearest.y - ay));
      if (dist > WAR_STANCE_CONTACT_RANGE) {
        kernel.submit({ type: 'army.moveTo', issuer: options.issuer, payload: { armyId, x: nearest.x, y: nearest.y } });
      } else if (nearest.isCastle) {
        kernel.submit({ type: 'siege.begin', issuer: options.issuer, payload: { armyId, villageId: nearest.villageId } });
      }
      // a non-castle village at contact range needs no order — combat.ts's own
      // proximity detection (M27) engages automatically
    },
  };
  kernel.registerSystem(system);
}
