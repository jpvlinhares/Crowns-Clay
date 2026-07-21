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

// ---- roster adoption (1.0 content-completeness): once the AI can recruit the full GDD §6
// roster, it should ACTUALLY field a mixed army as its warfare techs unlock better units —
// not spam one unit type, and not degenerate into always-the-strongest. A stateless class
// ROTATION does both: the slot is chosen by the kingdom's current unit count, and each slot
// takes the best UNLOCKED unit of its class (strongest-first), so composition upgrades
// automatically without any scoring to tune. Two line slots keep an infantry backbone.
// GATED on the composition supplying `isUnitUnlocked` — the harness wrapper does NOT, so it
// keeps the pinned single-unit RECRUIT_ORDER behaviour byte-identical.
export const RECRUIT_ROTATION = ['line', 'ranged', 'line', 'cavalry'] as const;
export const RECRUIT_BY_CLASS: Readonly<Record<string, readonly string[]>> = {
  line: ['base:unit.swordsman', 'base:unit.spearman', 'base:unit.militia'],
  ranged: ['base:unit.crossbowman', 'base:unit.archer'],
  cavalry: ['base:unit.knight', 'base:unit.cavalry'],
  siege: ['base:unit.trebuchet', 'base:unit.ram', 'base:unit.catapult'],
};
/** Siege engines the AI keeps at most, and only while actually prosecuting a ConquestWar
 * with an army already raised — they're dead weight outside a siege and costly in adults. */
export const AI_SIEGE_CAP = 2;
/** The AI keeps building line/ranged/cavalry before it invests in a siege train. */
export const AI_SIEGE_MIN_UNITS = 4;

/**
 * Today's recruit choice from the class rotation — a PURE function of (own composition,
 * plan, unlock predicate), so the decision is testable in isolation and deterministic.
 * A ConquestWar with an army already raised adds a siege engine (under the cap); otherwise
 * the rotation slot (chosen by unit count) picks the best UNLOCKED unit of its class, falling
 * back to the line — then militia — so a still-locked slot never stalls recruiting. Affordability
 * is deliberately NOT modelled here: the recruit command enforces it (reject-and-retry), and
 * the caller's food/workforce gates already guarantee population for any unit.
 */
export function pickRosterRecruit(
  totalUnits: number,
  siegeUnits: number,
  plan: string,
  unlocked: (defId: string) => boolean,
): string {
  const bestOfClass = (cls: string): string | undefined => (RECRUIT_BY_CLASS[cls] ?? []).find(unlocked);
  if (plan === 'ConquestWar' && totalUnits >= AI_SIEGE_MIN_UNITS && siegeUnits < AI_SIEGE_CAP) {
    const engine = bestOfClass('siege');
    if (engine !== undefined) return engine;
  }
  const slot = RECRUIT_ROTATION[totalUnits % RECRUIT_ROTATION.length] as string;
  return bestOfClass(slot) ?? bestOfClass('line') ?? 'base:unit.militia';
}
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

/** Full closed square perimeter at Chebyshev distance `radius` (every tile on the ring, not just
 * its 8 corners/midpoints) — a v1 simplification of doc 07 §5's terrain-adapted castle templates.
 * 1.x war-cadence fix: the previous 8-point version only actually CLOSED at radius 1 (matching
 * castles.test.ts's fixture, where corner and edge-midpoint tiles are already adjacent); at
 * `CASTLE_RING_RADIUS`'s radius 6 those 8 points left 5-tile gaps on every side, so
 * `castles.ts`'s 4-connected flood-fill always found a way through and `isCastle` never flipped
 * true for any AI-built capital — the balance matrix's confirmed "no capital sieges ever mounted"
 * finding traces here: `military.ts`'s own tactical-war gate never even attempts `siege.begin`
 * against a target whose `AiWarTarget.isCastle` reads false (campaign.ts's `warTargetsFor`).
 * Tiles are ordered walking the perimeter so the AI's one-wall-per-day build queue closes the
 * loop visibly, edge by edge, rather than jumping between distant points. */
export function planCastleRing(centerX: number, centerY: number, radius: number): readonly { x: number; y: number }[] {
  const r = radius;
  const tiles: { x: number; y: number }[] = [];
  for (let x = centerX - r; x <= centerX + r; x++) tiles.push({ x, y: centerY - r }); // top edge, left→right
  for (let y = centerY - r + 1; y <= centerY + r; y++) tiles.push({ x: centerX + r, y }); // right edge, top→bottom
  for (let x = centerX + r - 1; x >= centerX - r; x--) tiles.push({ x, y: centerY + r }); // bottom edge, right→left
  for (let y = centerY + r - 1; y >= centerY - r + 1; y--) tiles.push({ x: centerX - r, y }); // left edge, bottom→top
  return tiles;
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
  /** 1.0 roster adoption: true when this kingdom may recruit `defId` (ungated units always;
   * tech-gated units once the kingdom knows the tech). PRESENCE switches the recruiter from
   * the pinned single-unit RECRUIT_ORDER to the class rotation — omit it (the harness wrapper)
   * to keep the old behaviour byte-identical. */
  readonly isUnitUnlocked?: (defId: string) => boolean;
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
  /** M54 (ADR-4 §4): fog-symmetric assault counsel from the composition's intel —
   * 'assault' when believed resistance is clearable, 'hold' while the estimate says
   * wait (starve, gather intel, reinforce), 'lift' when the siege looks hopeless.
   * Omitted (pre-M54 compositions / harness): assault immediately, the M53 behaviour. */
  readonly assaultAdvice?: (castleVillageIndex: number) => 'assault' | 'hold' | 'lift';
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
  const { Unit, Army, ops } = military;
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

  // ---- roster adoption (1.0): pick the recruit for today, given the kingdom's own units and
  // its unlocked techs. Pure over declared reads (Unit) — pop/gold affordability is left to the
  // recruit command (reject-and-retry, the pre-existing discipline), and the daily food/workforce
  // gates above already guarantee pop for any unit (all cost ≤ 10 adults). Returns null = skip. ----
  const unlocked = (defId: string): boolean => options.isUnitUnlocked?.(defId) ?? true;
  const ownUnits = (siegeOnly = false): number => {
    const u = world.read(Unit);
    let n = 0;
    world.query([Unit]).forEach((ui) => {
      if ((u.kingdomId[ui] as number) !== (options.kingdomId as number)) return;
      if (siegeOnly && ops.unitDef(u.def[ui] as number).class !== 'siege') return;
      n++;
    });
    return n;
  };
  const pickRecruit = (plan: string): string => pickRosterRecruit(ownUnits(), ownUnits(true), plan, unlocked);

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
          // roster adoption wired ⇒ the class rotation picks a mixed army from the unlocked
          // roster; otherwise (the harness) the pinned single-unit RECRUIT_ORDER, byte-identical.
          const defId = options.isUnitUnlocked !== undefined ? pickRecruit(plan) : (RECRUIT_ORDER[0] as string);
          kernel.submit({ type: 'army.recruitUnit', issuer: options.issuer, payload: { villageId: options.villageId as number, unitDef: defId } });
          // rejected silently (unaffordable etc.) is fine — retried next day
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

      // tactical war conduct (doc 07 §3). ConquestWar/PunitiveRaid both INITIATE and conduct war;
      // MilitaryBuildup CONDUCTS a war already in progress but never opens a new front.
      // 1.x war-cadence fix: ai/planner.ts routinely reverts an aggressor to MilitaryBuildup the
      // instant its army marches out — the marching army stops counting toward at-home military
      // strength, so ConquestWar's utility (aggression × relativeAdvantage × militaryStrength)
      // drops below MilitaryBuildup's — which used to STRAND a committed army at the enemy's gate,
      // idle, until the flat 90-day forced-peace clock (diplomacy.ts) ended the war with no siege
      // ever mounted. A committed army (already besieging, or already at war with a known target)
      // must see its war through regardless of the plan's second thoughts; under MilitaryBuildup it
      // still never DECLARES a new war (target selection below is restricted to at-war enemies).
      if (options.warTargets === undefined) return;
      const initiatesWar = plan === 'ConquestWar' || plan === 'PunitiveRaid';
      const existingSiege = siegeGame.state.siegeOfArmy(armyId);
      const diplomacy = options.diplomacy;
      const allTargets = options.warTargets();
      const atWarTargets = diplomacy === undefined ? [] : allTargets.filter((t) => diplomacy.isAtWar(t.kingdomId as EntityId));
      const committedToWar = existingSiege !== undefined || atWarTargets.length > 0;
      if (!initiatesWar && !committedToWar) return;
      if (committedCount(armyId) < WAR_MIN_STRENGTH) return;

      if (existingSiege !== undefined) {
        // M53: a fallen capital's fate belongs to succession — the army waits
        if (existingSiege.fallenDeadline !== 0) return;
        // M55 (A1): every siege is spatial now, so there is no bombard-vs-assault choice
        // left to make — a besieging army assaults, waits, or walks away. This also retires
        // the 1.x war-cadence part-4 bug for good rather than by fix: the old ordering
        // (`if (targetBuilding===0) setTarget else if (breaches) assault`) re-aimed at the
        // next wall every day and never reached the assault, so sieges bombarded 9+ walls to
        // rubble and issued zero assaults. With no walls to aim at, the failure mode is gone.
        // M54: intel may still counsel otherwise — 'hold' waits at the walls (the siege camp
        // refreshes the snapshot within a day); 'lift' walks away from a hopeless escalade
        // instead of feeding it men.
        if (existingSiege.assaultEngagementArmy === 0) {
          const advice = options.assaultAdvice?.(existingSiege.castle) ?? 'assault';
          if (advice === 'assault') {
            kernel.submit({ type: 'siege.assault', issuer: options.issuer, payload: { armyId } });
          } else if (advice === 'lift') {
            kernel.submit({ type: 'siege.lift', issuer: options.issuer, payload: { armyId } });
          }
        }
        return;
      }

      // ConquestWar/PunitiveRaid may march on any known enemy (declaring war below as needed); a
      // MilitaryBuildup continuation marches ONLY on enemies it is already at war with, so it
      // finishes the war ConquestWar started without silently becoming a second ConquestWar.
      let targets = initiatesWar ? allTargets : atWarTargets;
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
