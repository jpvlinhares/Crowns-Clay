/**
 * Military basics (roadmap M25; GDD §6; doc 06 §3; doc 08 §2/§7).
 *
 * RECRUITMENT is atomic and barracks-gated: a village needs a complete
 * building whose def names the unit in `military.recruits` (doc 06 §2). Like
 * every other reservation in this codebase (village placement, edicts), cost
 * is checked in full — population from the named cohort, resources from the
 * village stockpile, gold from the kingdom treasury — before anything is
 * deducted, so a rejected recruit order touches nothing (property-tested:
 * the M25 T objective, "recruit/disband population conservation").
 *
 * TRAINING advances hourly like construction (`progress` → `complete`); a
 * disbanded unit — trained or not — returns its FULL popCost, because the
 * population left the cohort at recruitment, not at training completion.
 *
 * UPKEEP settles once a season (gold from the treasury via the kingdom
 * ledger — GDD §6 "guns-vs-butter"; food from the unit's home village
 * stockpile). An unpayable unit DESERTS, mirroring how an unpayable edict
 * lapses (kingdom.ts): the population returns to its cohort, same as a
 * disband. The Marshal's `military.upkeepDiscount` modifier (kingdom.ts)
 * softens this.
 *
 * ARMIES are lightweight groupings (movement/stance/supply are game/armies.ts,
 * M26). A `Unit.armyId` foreign key mirrors how `Building` points at its
 * `village` rather than the reverse.
 *
 * `morale` (M27 delta): initialised to `def.stats.moraleBase` at recruitment;
 * combat (game/combat.ts) is the only system that ever changes it afterward.
 */
import type { EntityId } from '@crowns/core';
import type { DefinitionDatabase, UnitDef } from '@crowns/data';
import { Interner, invariant } from '@crowns/core';
import { ObjectComponent, SoAComponent, World, type Component } from '../ecs.js';
import type { Kernel, SimSystem, TickContext } from '../kernel.js';
import { TICKS_PER_SEASON } from '../time.js';
import type { VillageGameplay } from './villages.js';
import type { PopulationGameplay } from './population.js';
import type { KingdomGameplay } from './kingdom.js';

const index = (id: number): number => id & 0x3fffff;

// ---------------------------------------------------------------- components

export type UnitComponent = SoAComponent<{
  def: 'u32'; // interned unit-def code
  kingdomId: 'eid';
  homeVillage: 'eid';
  armyId: 'eid'; // 0 = unassigned
  count: 'u16'; // men in the unit (starts at def.popCost.count; combat casualties reduce it for real, M27)
  progress: 'f64'; // 0..1 training progress
  complete: 'bool'; // trained and drawing upkeep
  morale: 'f64'; // 0..100, ceiling def.stats.moraleBase — combat's "true HP" (GDD §8, M27)
}>;

export type ArmyComponent = SoAComponent<{ kingdomId: 'eid' }>;

// ---------------------------------------------------------------- ops

export class MilitaryOps {
  private readonly interner = new Interner();
  private readonly defByCode = new Map<number, UnitDef>();

  constructor(db: DefinitionDatabase) {
    for (const id of [...db.units.keys()].sort()) {
      this.defByCode.set(this.interner.intern(id) as number, db.units.get(id) as UnitDef);
    }
  }

  defCode(id: string): number | undefined {
    return this.interner.peek(id) as number | undefined;
  }

  unitDef(code: number): UnitDef {
    const def = this.defByCode.get(code);
    invariant(def !== undefined, `unknown unit code ${code}`);
    return def;
  }
}

const cohortField = (cohort: UnitDef['popCost']['cohort']): 'children' | 'adults' | 'elders' =>
  cohort === 'child' ? 'children' : cohort === 'elder' ? 'elders' : 'adults';

// ---------------------------------------------------------------- gameplay

export interface MilitaryGameplay {
  readonly Unit: UnitComponent;
  readonly Army: ArmyComponent;
  readonly ArmyName: ObjectComponent<string>;
  readonly ops: MilitaryOps;
  /** M53 (kingdom.ts's M34 `registerCharacterExtension` precedent): a LATER module that
   * attaches its own sibling components to Unit entities (defence.ts's DefencePost)
   * declares them here — the upkeep deserter despawn structurally detaches whatever
   * rides on the unit, and the access guard demands it declared. */
  registerUnitExtension(comp: Component): void;
}

export function registerMilitaryGameplay(
  kernel: Kernel,
  world: World,
  db: DefinitionDatabase,
  game: VillageGameplay,
  popGame: PopulationGameplay,
  kingdomGame: KingdomGameplay,
): MilitaryGameplay {
  const { VillageCore, BuildingCore, Stockpile } = game.comps;
  const { Population } = popGame;
  const { Kingdom, ledger, mods, VillageOwner } = kingdomGame;
  const ops = new MilitaryOps(db);

  const Unit: UnitComponent = world.defineSoA('unit', {
    def: 'u32', kingdomId: 'eid', homeVillage: 'eid', armyId: 'eid', count: 'u16', progress: 'f64', complete: 'bool', morale: 'f64',
  });
  const Army: ArmyComponent = world.defineSoA('army', { kingdomId: 'eid' });
  const ArmyName = world.defineObject<string>('armyName', (name, fold) => {
    for (let i = 0; i < name.length; i++) fold(name.charCodeAt(i));
  });

  const reject = (ctx: TickContext, what: string, reason: string): void => {
    ctx.events.publish({ type: 'village.rejected', tick: ctx.tick, data: { what, reason } });
  };

  const kingdomForIssuer = (issuer: number): EntityId | undefined => {
    const all = kingdomGame.kingdomEntities();
    return all[issuer - 1] ?? all[0];
  };

  /** Returns `count` population of `cohort` to a village's cohort (recruit-cost reversal). */
  const returnPopulation = (villageId: number, cohort: UnitDef['popCost']['cohort'], count: number): void => {
    const vi = index(villageId);
    if (!world.has(villageId as EntityId, Population)) return; // village gone; population is lost, not conjured
    const pop = world.write(Population);
    const field = cohortField(cohort);
    pop[field][vi] = (pop[field][vi] as number) + count;
  };

  // ---------------- commands ----------------

  kernel.registerCommand<{ villageId: number; unitDef: string }>('army.recruitUnit', (ctx, p, command) => {
    const villageId = p.villageId | 0;
    const village = villageId as EntityId;
    if (!world.isAlive(village) || !world.has(village, Population)) return reject(ctx, 'army.recruitUnit', 'no such village');
    const kingdomId = kingdomForIssuer(command.issuer);
    if (kingdomId === undefined) return reject(ctx, 'army.recruitUnit', 'no kingdom');
    if (VillageOwner !== undefined) {
      const owner = world.read(VillageOwner).kingdom[index(villageId)] as number;
      if (owner !== (kingdomId as number)) return reject(ctx, 'army.recruitUnit', 'village belongs to another kingdom');
    }
    const def = db.units.get(String(p.unitDef));
    if (def === undefined) return reject(ctx, 'army.recruitUnit', `unknown unit '${String(p.unitDef)}'`);
    const code = ops.defCode(def.id) as number;

    // barracks gate: a complete building in this village must train this unit
    const b = world.read(BuildingCore);
    let canTrain = false;
    world.query([BuildingCore]).forEach((i) => {
      if (canTrain || (b.complete[i] as number) !== 1 || index(b.village[i] as number) !== index(villageId)) return;
      const buildingDef = game.ops.buildingDef(b.def[i] as number);
      if (buildingDef.military?.recruits?.includes(def.id)) canTrain = true;
    });
    if (!canTrain) return reject(ctx, 'army.recruitUnit', `no building in this village trains '${def.id}'`);

    // check-all-then-deduct-all: population, resources, gold
    const field = cohortField(def.popCost.cohort);
    const pop = world.read(Population);
    const vi = index(villageId);
    if ((pop[field][vi] as number) < def.popCost.count) {
      return reject(ctx, 'army.recruitUnit', `insufficient ${def.popCost.cohort}s (${(pop[field][vi] as number).toFixed(0)}/${def.popCost.count})`);
    }
    const stock = world.readObj(Stockpile).get(vi);
    for (const [resId, amount] of Object.entries(def.cost)) {
      const have = stock.get(game.ops.resourceCode(resId) as number) ?? 0;
      if (have < amount) return reject(ctx, 'army.recruitUnit', `insufficient ${resId} (${have}/${amount})`);
    }
    const ki = index(kingdomId as number);
    const k = world.write(Kingdom);
    if ((k.treasury[ki] as number) < def.costGold) {
      return reject(ctx, 'army.recruitUnit', `insufficient gold (${(k.treasury[ki] as number).toFixed(0)}/${def.costGold})`);
    }

    world.write(Population)[field][vi] = (pop[field][vi] as number) - def.popCost.count;
    const mutStock = world.writeObj(Stockpile).get(vi);
    for (const [resId, amount] of Object.entries(def.cost)) {
      const rc = game.ops.resourceCode(resId) as number;
      mutStock.set(rc, (mutStock.get(rc) as number) - amount);
    }
    k.treasury[ki] = (k.treasury[ki] as number) - def.costGold;
    if (def.costGold > 0) ledger.record({ tick: ctx.tick, kind: 'unit-recruit', amount: -def.costGold, detail: def.id });

    const unit = world.spawn();
    world.attach(unit, Unit, {
      def: code, kingdomId: kingdomId as number, homeVillage: villageId, armyId: 0,
      count: def.popCost.count, progress: 0, complete: false, morale: def.stats.moraleBase,
    });
    ctx.events.publish({ type: 'army.unitRecruited', tick: ctx.tick, data: { unit: unit as number, def: def.id, villageId } });
  });

  kernel.registerCommand<{ unitId: number }>('army.disbandUnit', (ctx, p, command) => {
    const unit = (p.unitId | 0) as EntityId;
    if (!world.isAlive(unit) || !world.has(unit, Unit)) return reject(ctx, 'army.disbandUnit', 'no such unit');
    const u = world.read(Unit);
    const ui = index(unit as number);
    const kingdomId = kingdomForIssuer(command.issuer);
    if (kingdomId === undefined || (u.kingdomId[ui] as number) !== (kingdomId as number)) {
      return reject(ctx, 'army.disbandUnit', 'not your unit');
    }
    const def = ops.unitDef(u.def[ui] as number);
    returnPopulation(u.homeVillage[ui] as number, def.popCost.cohort, u.count[ui] as number);
    world.despawn(unit);
    ctx.events.publish({
      type: 'army.unitDisbanded', tick: ctx.tick,
      data: { unit: unit as number, def: def.id, count: u.count[ui] as number },
    });
  });

  kernel.registerCommand<{ name: string; villageId: number }>('army.createArmy', (ctx, p, command) => {
    const kingdomId = kingdomForIssuer(command.issuer);
    if (kingdomId === undefined) return reject(ctx, 'army.createArmy', 'no kingdom');
    const village = (p.villageId | 0) as EntityId;
    if (!world.isAlive(village) || !world.has(village, VillageCore)) return reject(ctx, 'army.createArmy', 'no such village');
    const vi = index(p.villageId);
    const core = world.read(VillageCore);
    const army = world.spawn();
    world.attach(army, Army, { kingdomId: kingdomId as number });
    world.attach(army, ArmyName, String(p.name ?? 'Unnamed Army'));
    ctx.events.publish({
      type: 'army.created', tick: ctx.tick,
      data: { army: army as number, x: core.centerX[vi] as number, y: core.centerY[vi] as number },
    });
  });

  kernel.registerCommand<{ unitId: number; armyId: number }>('army.assignUnit', (ctx, p, command) => {
    const unit = (p.unitId | 0) as EntityId;
    if (!world.isAlive(unit) || !world.has(unit, Unit)) return reject(ctx, 'army.assignUnit', 'no such unit');
    const kingdomId = kingdomForIssuer(command.issuer);
    const u = world.write(Unit);
    const ui = index(unit as number);
    if (kingdomId === undefined || (u.kingdomId[ui] as number) !== (kingdomId as number)) {
      return reject(ctx, 'army.assignUnit', 'not your unit');
    }
    const armyId = p.armyId | 0;
    if (armyId !== 0) {
      const army = armyId as EntityId;
      if (!world.isAlive(army) || !world.has(army, Army)) return reject(ctx, 'army.assignUnit', 'no such army');
      if ((world.read(Army).kingdomId[index(armyId)] as number) !== (kingdomId as number)) {
        return reject(ctx, 'army.assignUnit', 'not your army');
      }
    }
    u.armyId[ui] = armyId;
    ctx.events.publish({ type: 'army.unitAssigned', tick: ctx.tick, data: { unit: unit as number, armyId } });
  });

  kernel.registerCommand<{ armyId: number }>('army.disbandArmy', (ctx, p, command) => {
    const army = (p.armyId | 0) as EntityId;
    if (!world.isAlive(army) || !world.has(army, Army)) return reject(ctx, 'army.disbandArmy', 'no such army');
    const kingdomId = kingdomForIssuer(command.issuer);
    if (kingdomId === undefined || (world.read(Army).kingdomId[index(army as number)] as number) !== (kingdomId as number)) {
      return reject(ctx, 'army.disbandArmy', 'not your army');
    }
    const u = world.write(Unit);
    world.query([Unit]).forEach((i) => {
      if ((u.armyId[i] as number) === (army as number)) u.armyId[i] = 0;
    });
    world.despawn(army);
    ctx.events.publish({ type: 'army.disbanded', tick: ctx.tick, data: { army: army as number } });
  });

  // ---------------- hourly: training progress (mirrors constructionSystem) ----------------
  const training: SimSystem = {
    name: 'military-training',
    period: 1,
    access: { writes: [Unit] },
    update(ctx: TickContext): void {
      const u = world.write(Unit);
      world.query([Unit]).forEach((i, entity) => {
        if ((u.complete[i] as number) === 1) return;
        const def = ops.unitDef(u.def[i] as number);
        const next = Math.min(1, (u.progress[i] as number) + 1 / def.recruitTicks);
        u.progress[i] = next;
        if (next >= 1) {
          u.complete[i] = 1;
          ctx.events.publish({ type: 'army.unitTrained', tick: ctx.tick, data: { unit: entity as number, def: def.id } });
        }
      });
    },
  };

  // ---------------- seasonal: upkeep (gold + food); unpayable units desert ----------------
  // `upkeepWrites` is mutable for the same reason kingdom.ts's `agingWrites` is (M34's
  // extension-point precedent): a LATER module that attaches its own sibling components to
  // Unit entities (game/defence.ts's DefencePost, M52) must declare them here, because the
  // deserter despawn below structurally detaches whatever rides on the unit. Found the hard
  // way in the M53 balance matrix: a broke kingdom whose POSTED garrison deserted tripped
  // the access guard mid-campaign.
  const upkeepWrites: Component[] = [Kingdom, Population, Stockpile, Unit];
  const upkeep: SimSystem = {
    name: 'military-upkeep',
    period: TICKS_PER_SEASON,
    phase: 5,
    access: { writes: upkeepWrites, reads: [VillageCore, BuildingCore] },
    update(ctx: TickContext): void {
      const u = world.read(Unit);
      const k = world.write(Kingdom);
      const stocks = world.writeObj(Stockpile);
      const discount = Math.max(0, mods.mul('military.upkeepDiscount'));
      const deserters: EntityId[] = [];
      world.query([Unit]).forEach((i, entity) => {
        if ((u.complete[i] as number) !== 1) return;
        const def = ops.unitDef(u.def[i] as number);
        const ki = index(u.kingdomId[i] as number);
        const vi = index(u.homeVillage[i] as number);
        const gold = def.upkeepGold * discount;
        const food = def.upkeepFood * discount;
        const stock = stocks.tryGet(vi);
        const foodCode = game.ops.resourceCode('base:resource.food') as number;
        const haveFood = stock?.get(foodCode) ?? 0;
        if ((k.treasury[ki] as number) < gold || stock === undefined || haveFood < food) {
          deserters.push(entity);
          return;
        }
        k.treasury[ki] = (k.treasury[ki] as number) - gold;
        if (gold > 0) ledger.record({ tick: ctx.tick, kind: 'unit-upkeep', amount: -gold, detail: def.id });
        if (food > 0) stock.set(foodCode, haveFood - food);
      });
      for (const entity of deserters) {
        const ui = index(entity as number);
        const def = ops.unitDef(u.def[ui] as number);
        returnPopulation(u.homeVillage[ui] as number, def.popCost.cohort, u.count[ui] as number);
        ctx.events.publish({
          type: 'army.unitDeserted', tick: ctx.tick,
          data: { unit: entity as number, def: def.id, count: u.count[ui] as number },
        });
        world.despawn(entity);
      }
    },
  };

  kernel.registerSystem(training);
  kernel.registerSystem(upkeep);

  return {
    Unit,
    Army,
    ArmyName,
    ops,
    registerUnitExtension(comp: Component): void {
      upkeepWrites.push(comp);
    },
  };
}
