/**
 * Production chains (roadmap M13/M14; GDD §3; doc 05 §5; doc 08 §4).
 *
 * The Economy subsystem: recipe production, stockpile limits, and spoilage —
 * with a resource LEDGER so every unit created, consumed, eaten, spoiled, or
 * spent on construction reconciles against stock deltas (the conservation
 * invariant, property-tested per TDD §13).
 *
 * M14 makes storage LOCAL-FIRST (GDD §3): buildings hold their own inventory
 * (doc 06 §2 Building state). Recipes draw inputs from and deposit outputs to
 * the building's inventory; HAULERS (logistics.ts) move goods between
 * inventories and the village-centre stockpile, so distance is a real cost.
 * The population still eats from the centre stockpile — food rotting in a
 * far-off farm outbox feeds nobody.
 *
 * Recipe batching (hourly, doc 08 §2 slot 6): a whole recipe scales by ONE
 * fraction — min(workforce efficiency, input availability, outbox headroom) —
 * so inputs are never consumed for output that clamping would discard, and
 * outputs never appear without their inputs. The outbox cap (OUTBOX_DAYS of
 * output) stalls production when hauling falls behind, propagating stockpile
 * limits upstream naturally.
 *
 * Spoilage (daily, staggered after needs eat): decaying resources lose
 * `decay` of their stock per day — in stockpiles AND building inventories —
 * granaries decide survival (doc 08 §3).
 */
import type { EntityId } from '@crowns/core';
import type { BuildingDef, DefinitionDatabase } from '@crowns/data';
import { ObjectComponent, World } from '../ecs.js';
import type { Kernel, SimSystem } from '../kernel.js';
import { TICKS_PER_DAY } from '../time.js';
import type { VillageGameplay } from './villages.js';

// 1.x: raised 150→200 (materials) and 50→150 (food) so the campaign starting kit (wood 200 /
// food 150, DEFAULT_CAMPAIGN_STOCK) sits within cap at start instead of over it, and Terra's own
// 200-wood start likewise stops sitting over the old 150 cap. A granary/storage building is still
// needed to hoard beyond these; production rates and yields are unchanged.
export const BASE_STORAGE = 200; // per resource, before storage buildings
export const OUTBOX_DAYS = 2; // building inventory holds this many days of output before stalling
// The keep's built-in FOOD larder. Food beyond this needs granary (storage) capacity to be
// held; without it, the surplus spoils (GDD §3 — a granary is an early priority). Food is the
// only resource with a reduced base cap; every other good still starts from BASE_STORAGE.
export const KEEP_FOOD_BUFFER = 150;

/**
 * Read-side of the kingdom's StatModifiers board (M16) — structural so the
 * economy stays independent of the kingdom module. Inert without a kingdom.
 */
export interface StatModifierView {
  add(target: string): number;
  mul(target: string): number;
}

export const INERT_MODIFIERS: StatModifierView = { add: () => 0, mul: () => 1 };

// ---------------------------------------------------------------- ledger

export interface ResourceFlows {
  produced: number; // recipe outputs
  consumed: number; // recipe inputs
  eaten: number; // population needs (published by the needs system)
  spoiled: number; // daily decay
  built: number; // construction costs reserved at placement
  settled: number; // carried away by settler parties (M15) — returns count negative
  looted: number; // sack plunder received into this village's stockpile (M53)
}

const zeroFlows = (): ResourceFlows => ({ produced: 0, consumed: 0, eaten: 0, spoiled: 0, built: 0, settled: 0, looted: 0 });

/**
 * Per-village, per-resource flow accounting since the last drain. Derived
 * bookkeeping (never hashed): feeds conservation tests now, UI ledgers and
 * the AI economy manager later (doc 05 §5).
 */
export class ResourceLedger {
  private readonly flows = new Map<number, Map<number, ResourceFlows>>();

  record(villageIndex: number, resourceCode: number, kind: keyof ResourceFlows, amount: number): void {
    if (amount === 0) return;
    let village = this.flows.get(villageIndex);
    if (village === undefined) this.flows.set(villageIndex, (village = new Map()));
    let entry = village.get(resourceCode);
    if (entry === undefined) village.set(resourceCode, (entry = zeroFlows()));
    entry[kind] += amount;
  }

  /** Flows for one village since the last drain (empty map if none). */
  of(villageIndex: number): ReadonlyMap<number, ResourceFlows> {
    return this.flows.get(villageIndex) ?? new Map();
  }

  /** Return all accumulated flows and reset the ledger. */
  drain(): Map<number, Map<number, ResourceFlows>> {
    const out = new Map(this.flows);
    this.flows.clear();
    return out;
  }
}

// ---------------------------------------------------------------- gameplay

export interface EconomyGameplay {
  /** Per-resource stock limits set by the player (interned code → cap). */
  readonly StockLimits: ObjectComponent<Map<number, number>>;
  /** Per-building local storage (doc 06 §2 `inventory`; code → amount). */
  readonly BuildingInventory: ObjectComponent<Map<number, number>>;
  readonly ledger: ResourceLedger;
  /** Effective cap for a resource in a village (storage ∧ player limit). */
  capOf(villageIndex: number, resourceCode: number): number;
  /**
   * Batch variant of capOf: snapshots storage capacities ONCE, then answers
   * per (village, resource) in O(1) — the job board asks hundreds of times a
   * tick (doc 11 §2 haul-jobs budget).
   */
  capsView(): (villageIndex: number, resourceCode: number) => number;
  /** Total of a resource across stockpile + building inventories (conservation scope). */
  totalOf(villageIndex: number, resourceCode: number): number;
}

export function registerEconomyGameplay(
  kernel: Kernel,
  world: World,
  db: DefinitionDatabase,
  game: VillageGameplay,
  mods: StatModifierView = INERT_MODIFIERS,
): EconomyGameplay {
  const { VillageCore, Stockpile, BuildingCore } = game.comps;
  const ledger = new ResourceLedger();

  const foldSortedMap = (map: Map<number, number>, fold: (n: number) => void): void => {
    for (const key of [...map.keys()].sort((a, b) => a - b)) {
      fold(key);
      fold(map.get(key) as number);
    }
  };
  const StockLimits = world.defineObject<Map<number, number>>('stockLimits', foldSortedMap);
  const BuildingInventory = world.defineObject<Map<number, number>>('buildingInventory', foldSortedMap);

  const index = (id: number): number => id & 0x3fffff;
  const defOf = (b: { def: ArrayLike<number> }, i: number): BuildingDef =>
    game.ops.buildingDef(b.def[i] as number);
  const foodCode = game.ops.resourceCode('base:resource.food') as number;
  // food alone has the smaller keep buffer; every other resource keeps BASE_STORAGE
  const baseCapFor = (code: number): number => (code === foodCode ? KEEP_FOOD_BUFFER : BASE_STORAGE);

  // decaying resources, resolved once (defs are immutable after load)
  const decayByCode: [number, number][] = [];
  for (const id of [...db.resources.keys()].sort()) {
    const decay = db.resources.get(id)?.decay ?? 0;
    if (decay > 0) decayByCode.push([game.ops.resourceCode(id) as number, decay]);
  }

  // new villages start with unlimited (absent) per-resource limits
  kernel.subscribe<{ village: number }>('village.founded', (event) => {
    world.attach(event.data.village as EntityId, StockLimits, new Map());
  });

  // construction costs flow through the ledger (placement reserved them
  // atomically in VillageOps; the def is the authority on what was paid),
  // and recipe buildings get their local inventory (publisher scopes that
  // place buildings must declare BuildingInventory in their writes)
  kernel.subscribe<{ building: number; def: string; village: number }>('building.placed', (event) => {
    const def = db.buildings.get(event.data.def);
    if (def === undefined) return;
    for (const [resId, amount] of Object.entries(def.cost)) {
      ledger.record(index(event.data.village), game.ops.resourceCode(resId) as number, 'built', amount);
    }
    if (def.recipes !== undefined) {
      world.attach(event.data.building as EntityId, BuildingInventory, new Map());
    }
  });

  // population needs report what they ate (see population.ts needs system)
  kernel.subscribe<{ village: number; eaten: number; resource: number }>('village.fed', (event) => {
    ledger.record(index(event.data.village), event.data.resource, 'eaten', event.data.eaten);
  });

  // Σ storage.capacity (granaries/storehouses) per village — the building contribution
  // ON TOP of each resource's base cap (BASE_STORAGE, or KEEP_FOOD_BUFFER for food).
  const storageCaps = (): Map<number, number> => {
    const caps = new Map<number, number>();
    const b = world.read(BuildingCore);
    world.query([VillageCore]).forEach((vi) => caps.set(vi, 0));
    world.query([BuildingCore]).forEach((i) => {
      if ((b.complete[i] as number) !== 1) return;
      const vi = index(b.village[i] as number);
      if (caps.has(vi)) caps.set(vi, (caps.get(vi) as number) + (defOf(b, i).storage?.capacity ?? 0));
    });
    return caps;
  };

  const limitOf = (vi: number, code: number, buildingStorage: number): number => {
    const cap = baseCapFor(code) + buildingStorage;
    const limit = world.readObj(StockLimits).tryGet(vi)?.get(code);
    return limit === undefined ? cap : Math.min(cap, limit);
  };

  // ---------------- hourly: recipe production (local-first, M14) ----------------
  const production: SimSystem = {
    name: 'production',
    period: 1,
    access: { writes: [BuildingInventory], reads: [BuildingCore, VillageCore] },
    update(): void {
      const b = world.read(BuildingCore);
      const inventories = world.writeObj(BuildingInventory);
      world.query([BuildingCore, BuildingInventory]).forEach((i, entity) => {
        if ((b.complete[i] as number) !== 1) return;
        const def = defOf(b, i);
        if (def.recipes === undefined) return;
        const required = def.workers?.required ?? 0;
        // edicts like Corvée Labor scale the workforce (M16 modifier board)
        const efficiency =
          (required === 0 ? 1 : (b.workers[i] as number) / required) * mods.mul('village.productionEfficiency');
        if (efficiency <= 0) return;
        const vi = index(b.village[i] as number);
        const inventory = inventories.tryGet((entity as number) & 0x3fffff);
        if (inventory === undefined) return;
        for (const recipe of def.recipes) {
          // one batch fraction for the whole recipe: efficiency ∧ inputs ∧ outbox headroom
          let fraction = efficiency;
          for (const y of recipe.inputs) {
            const perTick = y.perDay / TICKS_PER_DAY;
            if (perTick <= 0) continue;
            const code = game.ops.resourceCode(y.resource) as number;
            fraction = Math.min(fraction, (inventory.get(code) ?? 0) / perTick);
          }
          for (const y of recipe.outputs) {
            const perTick = y.perDay / TICKS_PER_DAY;
            if (perTick <= 0) continue;
            const code = game.ops.resourceCode(y.resource) as number;
            const outboxCap = y.perDay * OUTBOX_DAYS;
            fraction = Math.min(fraction, Math.max(0, outboxCap - (inventory.get(code) ?? 0)) / perTick);
          }
          if (fraction <= 0) continue;
          for (const y of recipe.inputs) {
            const code = game.ops.resourceCode(y.resource) as number;
            const amount = (y.perDay / TICKS_PER_DAY) * fraction;
            inventory.set(code, Math.max(0, (inventory.get(code) ?? 0) - amount));
            ledger.record(vi, code, 'consumed', amount);
          }
          for (const y of recipe.outputs) {
            const code = game.ops.resourceCode(y.resource) as number;
            const amount = (y.perDay / TICKS_PER_DAY) * fraction;
            inventory.set(code, (inventory.get(code) ?? 0) + amount);
            ledger.record(vi, code, 'produced', amount);
          }
        }
      });
    },
  };

  // ---------------- daily: spoilage (after needs eat, phase stagger) ----------------
  const spoilage: SimSystem = {
    name: 'spoilage',
    period: TICKS_PER_DAY,
    phase: 4,
    access: { writes: [Stockpile, BuildingInventory], reads: [VillageCore, BuildingCore] },
    update(): void {
      if (decayByCode.length === 0) return;
      // Grain Reserves and kin halve the rot (M16 modifier board)
      const decayScale = Math.max(0, mods.mul('village.spoilage'));
      const rot = (vi: number, store: Map<number, number>): void => {
        for (const [code, decay] of decayByCode) {
          const amount = store.get(code) ?? 0;
          if (amount <= 0) continue;
          const spoiled = amount * Math.min(1, decay * decayScale);
          store.set(code, amount - spoiled);
          ledger.record(vi, code, 'spoiled', spoiled);
        }
      };
      const stocks = world.writeObj(Stockpile);
      world.query([VillageCore]).forEach((vi) => {
        const stock = stocks.tryGet(vi);
        if (stock !== undefined) rot(vi, stock);
      });
      // goods rot in farm outboxes too — hauling delays have teeth (M14)
      const b = world.read(BuildingCore);
      const inventories = world.writeObj(BuildingInventory);
      world.query([BuildingCore, BuildingInventory]).forEach((i, entity) => {
        const inventory = inventories.tryGet((entity as number) & 0x3fffff);
        if (inventory !== undefined) rot(index(b.village[i] as number), inventory);
      });
    },
  };

  // GDD §3 player interaction: per-village stockpile limits. limit < 0 clears.
  kernel.registerCommand<{ villageId: number; resource: string; limit: number }>(
    'village.setStockLimit',
    (ctx, p, command) => {
      const reject = (reason: string): void => {
        ctx.events.publish({ type: 'village.rejected', tick: ctx.tick, data: { what: 'village.setStockLimit', reason, issuer: command.issuer } });
      };
      const village = p.villageId as EntityId;
      if (!world.isAlive(village)) return reject('no such village');
      if (!db.resources.has(String(p.resource))) return reject(`unknown resource '${String(p.resource)}'`);
      const limits = world.writeObj(StockLimits).tryGet(index(p.villageId));
      if (limits === undefined) return reject('no such village');
      const code = game.ops.resourceCode(String(p.resource)) as number;
      if (p.limit < 0) limits.delete(code);
      else limits.set(code, p.limit);
    },
  );

  kernel.registerSystem(production);
  kernel.registerSystem(spoilage);

  return {
    StockLimits,
    BuildingInventory,
    ledger,
    capOf(vi: number, code: number): number {
      return limitOf(vi, code, storageCaps().get(vi) ?? 0);
    },
    capsView(): (vi: number, code: number) => number {
      const caps = storageCaps();
      return (vi, code) => limitOf(vi, code, caps.get(vi) ?? 0);
    },
    totalOf(vi: number, code: number): number {
      let total = world.readObj(Stockpile).tryGet(vi)?.get(code) ?? 0;
      const b = world.read(BuildingCore);
      const inventories = world.readObj(BuildingInventory);
      world.query([BuildingCore, BuildingInventory]).forEach((i, entity) => {
        if (index(b.village[i] as number) !== vi) return;
        total += inventories.tryGet((entity as number) & 0x3fffff)?.get(code) ?? 0;
      });
      return total;
    },
  };
}
