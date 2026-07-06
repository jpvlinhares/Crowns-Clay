/**
 * Population & needs v1 (roadmap M12; GDD §4; doc 08 §2 slots 6, 8–10, §5).
 *
 * Cohort math is authoritative (f64 counts; fractional people accumulate
 * deterministically). Daily flow, phase-staggered per doc 08:
 *
 *   hourly: jobs solver (builders first, then production by stable order)
 *           → production (perDay/24 × workforce efficiency, storage-capped)
 *   daily : needs (eat → fed fraction with the FORAGE FLOOR → happiness EMA)
 *           → population (births · maturation · senescence · deaths)
 *
 * The famine floor (GDD §4 death-spiral protection): fed never drops below
 * FORAGE_FLOOR — foragers scrape the hedgerows — so starvation mortality is
 * elevated but BOUNDED: population declines, decelerates, and never cliffs.
 */
import type { EntityId } from '@crowns/core';
import type { BuildingDef, DefinitionDatabase } from '@crowns/data';
import { SoAComponent, World } from '../ecs.js';
import type { Kernel, SimSystem, TickContext } from '../kernel.js';
import { TICKS_PER_DAY } from '../time.js';
import { BUILDERS_PER_SITE, type VillageGameplay } from './villages.js';

// ---------------------------------------------------------------- constants
// (exported so curve tests assert against the same numbers the sim uses)

export const FOOD_PER_PERSON_DAY = 0.1;
export const FORAGE_FLOOR = 0.4; // minimum fed fraction under famine
export const BASE_STORAGE = 150; // per resource, before storage buildings

export const BIRTH_RATE = 0.00025; // per adult per day at full food & shelter (tuned M12: ~4%/yr net fed growth)
export const MATURE_RATE = 1 / (14 * 360); // children → adults
export const SENESCE_RATE = 1 / (35 * 360); // adults → elders
export const DEATH_CHILD = 0.00003; // base daily mortality
export const DEATH_ADULT = 0.00002;
export const DEATH_ELDER = 0.0004;
export const FAMINE_MORTALITY = 0.004; // extra daily mortality at fed = 0
export const HAPPINESS_ALPHA = 0.08; // daily EMA

export interface StartingPopulation {
  readonly children: number;
  readonly adults: number;
  readonly elders: number;
}

// ---------------------------------------------------------------- components

export type PopulationComponent = SoAComponent<{
  children: 'f64';
  adults: 'f64';
  elders: 'f64';
  happiness: 'f64'; // 0..100
  foodSecurity: 'f64'; // 0..1, EMA of fed fraction
}>;

export interface PopulationGameplay {
  readonly Population: PopulationComponent;
  totalOf(villageIndex: number): number;
}

// ---------------------------------------------------------------- registrar

export function registerPopulationGameplay(
  kernel: Kernel,
  world: World,
  db: DefinitionDatabase,
  game: VillageGameplay,
  starting: StartingPopulation,
): PopulationGameplay {
  const Population: PopulationComponent = world.defineSoA('population', {
    children: 'f64',
    adults: 'f64',
    elders: 'f64',
    happiness: 'f64',
    foodSecurity: 'f64',
  });
  const { VillageCore, Stockpile, BuildingCore } = game.comps;
  const foodCode = game.ops.resourceCode('base:resource.food') as number;
  game.settings.laborGated = true; // construction now needs builders

  // newly founded villages receive their settlers (decoupled via the event bus;
  // founding scopes must declare Population in their writes)
  kernel.subscribe<{ village: number }>('village.founded', (event) => {
    const village = event.data.village as EntityId;
    world.attach(village, Population, {
      children: starting.children,
      adults: starting.adults,
      elders: starting.elders,
      happiness: 60,
      foodSecurity: 1,
    });
  });

  const index = (id: number): number => id & 0x3fffff;
  const defOf = (b: { def: ArrayLike<number> }, i: number): BuildingDef =>
    game.ops.buildingDef(b.def[i] as number);

  // ---------------- hourly: jobs solver ----------------
  const jobs: SimSystem = {
    name: 'jobs',
    period: 1,
    access: { writes: [BuildingCore], reads: [Population, VillageCore] },
    update(): void {
      const pop = world.read(Population);
      const b = world.write(BuildingCore);
      // available adults per village
      const available = new Map<number, number>();
      world.query([Population, VillageCore]).forEach((vi) => {
        available.set(vi, Math.floor(pop.adults[vi] as number));
      });
      // builders first (construction is the village's urgent work),
      // then production — both in ascending entity order (deterministic)
      for (const pass of ['sites', 'production'] as const) {
        world.query([BuildingCore]).forEach((i) => {
          const vi = index(b.village[i] as number);
          const pool = available.get(vi);
          if (pool === undefined) {
            b.workers[i] = 0;
            return;
          }
          const complete = (b.complete[i] as number) === 1;
          if (pass === 'sites' ? complete : !complete) return;
          const required = complete ? (defOf(b, i).workers?.required ?? 0) : BUILDERS_PER_SITE;
          const assigned = Math.min(required, pool);
          b.workers[i] = assigned;
          available.set(vi, pool - assigned);
        });
      }
    },
  };

  // ---------------- hourly: production ----------------
  const production: SimSystem = {
    name: 'production',
    period: 1,
    access: { writes: [Stockpile], reads: [BuildingCore, VillageCore] },
    update(): void {
      const b = world.read(BuildingCore);
      // storage caps per village (recomputed cheaply; buildings are few)
      const caps = new Map<number, number>();
      world.query([BuildingCore]).forEach((i) => {
        if ((b.complete[i] as number) !== 1) return;
        const vi = index(b.village[i] as number);
        caps.set(vi, (caps.get(vi) ?? BASE_STORAGE) + (defOf(b, i).storage?.capacity ?? 0));
      });
      const stocks = world.writeObj(Stockpile);
      world.query([BuildingCore]).forEach((i) => {
        if ((b.complete[i] as number) !== 1) return;
        const def = defOf(b, i);
        if (def.produces === undefined) return;
        const required = def.workers?.required ?? 0;
        const efficiency = required === 0 ? 1 : (b.workers[i] as number) / required;
        if (efficiency <= 0) return;
        const vi = index(b.village[i] as number);
        const stock = stocks.tryGet(vi);
        if (stock === undefined) return;
        const code = game.ops.resourceCode(def.produces.resource) as number;
        const cap = caps.get(vi) ?? BASE_STORAGE;
        const current = stock.get(code) ?? 0;
        stock.set(code, Math.min(cap, current + (def.produces.perDay / TICKS_PER_DAY) * efficiency));
      });
    },
  };

  // ---------------- daily: needs (eat, forage floor, happiness) ----------------
  const needs: SimSystem = {
    name: 'needs',
    period: TICKS_PER_DAY,
    phase: 2,
    access: { writes: [Population, Stockpile], reads: [BuildingCore, VillageCore] },
    update(ctx: TickContext): void {
      const pop = world.write(Population);
      const stocks = world.writeObj(Stockpile);
      const b = world.read(BuildingCore);
      // housing capacity per village
      const housing = new Map<number, number>();
      world.query([BuildingCore]).forEach((i) => {
        if ((b.complete[i] as number) !== 1) return;
        const vi = index(b.village[i] as number);
        housing.set(vi, (housing.get(vi) ?? 0) + (defOf(b, i).housing?.capacity ?? 0));
      });
      world.query([Population, VillageCore]).forEach((vi, village) => {
        const total =
          (pop.children[vi] as number) + (pop.adults[vi] as number) + (pop.elders[vi] as number);
        if (total <= 0) return;
        const stock = stocks.get(vi);
        const need = total * FOOD_PER_PERSON_DAY;
        const have = stock.get(foodCode) ?? 0;
        const eaten = Math.min(have, need);
        stock.set(foodCode, have - eaten);
        // FORAGE FLOOR: below it, foragers make up the difference (GDD §4)
        const fed = Math.max(FORAGE_FLOOR, need > 0 ? eaten / need : 1);
        pop.foodSecurity[vi] =
          (pop.foodSecurity[vi] as number) * (1 - HAPPINESS_ALPHA) + fed * HAPPINESS_ALPHA;

        const shelter = Math.min(1, (housing.get(vi) ?? 0) / total);
        const target = (fed * 0.7 + shelter * 0.3) * 100;
        pop.happiness[vi] =
          (pop.happiness[vi] as number) * (1 - HAPPINESS_ALPHA) + target * HAPPINESS_ALPHA;
        if (fed <= FORAGE_FLOOR && eaten < need) {
          ctx.events.publish({
            type: 'village.starving',
            tick: ctx.tick,
            data: { village: village as number },
          });
        }
      });
    },
  };

  // ---------------- daily: population flows ----------------
  const population: SimSystem = {
    name: 'population',
    period: TICKS_PER_DAY,
    phase: 3,
    access: { writes: [Population], reads: [VillageCore, BuildingCore] },
    update(): void {
      const pop = world.write(Population);
      const b = world.read(BuildingCore);
      const housing = new Map<number, number>();
      world.query([BuildingCore]).forEach((i) => {
        if ((b.complete[i] as number) !== 1) return;
        const vi = index(b.village[i] as number);
        housing.set(vi, (housing.get(vi) ?? 0) + (defOf(b, i).housing?.capacity ?? 0));
      });
      world.query([Population, VillageCore]).forEach((vi) => {
        const children = pop.children[vi] as number;
        const adults = pop.adults[vi] as number;
        const elders = pop.elders[vi] as number;
        const total = children + adults + elders;
        if (total <= 0) return;
        const fed = pop.foodSecurity[vi] as number;
        const shelter = Math.min(1, (housing.get(vi) ?? 0) / total);
        const famine = FAMINE_MORTALITY * (1 - fed);

        const births = adults * BIRTH_RATE * fed * (0.5 + 0.5 * shelter);
        const matured = children * MATURE_RATE;
        const senesced = adults * SENESCE_RATE;
        const deadChildren = children * (DEATH_CHILD + famine * 1.5);
        const deadAdults = adults * (DEATH_ADULT + famine);
        const deadElders = elders * (DEATH_ELDER + famine * 2);

        pop.children[vi] = Math.max(0, children + births - matured - deadChildren);
        pop.adults[vi] = Math.max(0, adults + matured - senesced - deadAdults);
        pop.elders[vi] = Math.max(0, elders + senesced - deadElders);
      });
    },
  };

  kernel.registerSystem(jobs);
  kernel.registerSystem(production);
  kernel.registerSystem(needs);
  kernel.registerSystem(population);

  return {
    Population,
    totalOf(villageIndex: number): number {
      const pop = world.read(Population);
      return Math.floor(
        (pop.children[villageIndex] as number) +
          (pop.adults[villageIndex] as number) +
          (pop.elders[villageIndex] as number),
      );
    },
  };
}
