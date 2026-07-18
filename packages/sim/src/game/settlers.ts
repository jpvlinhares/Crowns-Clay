/**
 * Multi-village & founding (roadmap M15; GDD §5, §13; doc 08 §2 slot 3).
 *
 * SETTLER PARTIES are real entities: `village.sendSettlers` deducts cohorts
 * and cargo from the source village, spawns a party at its centre, and the
 * party WALKS (path service, road-aware — doc 08 slot 3) to the chosen site.
 * Founding happens on ARRIVAL through the same `VillageOps.found` rulebook as
 * genesis and everything else — and the site is validated again there: if it
 * was claimed en route, the party turns around and re-merges at home. People
 * and goods are conserved through the whole round trip (TDD §13).
 *
 * SITE SCORING (GDD §13: food, water, buildables, spacing) is a pure function
 * over the terrain — shared by the demo's genesis, the player's judgement,
 * and the future AI settler dispatch (doc 07 §Economy: "same worldgen
 * scorer"). Score ranks candidates; VALIDITY stays the validator's job.
 *
 * VILLAGE TIERS (GDD §5): `village.upgrade` raises Hamlet → Village when the
 * village earns it — population, building variety, stockpiled materials, and
 * happiness — consuming the materials atomically. Tier 2 widens the radius
 * and unlocks tier-gated buildings (doc 06 Requirement.villageTier).
 */
import type { EntityId } from '@crowns/core';
import type { DefinitionDatabase } from '@crowns/data';
import { ObjectComponent, SoAComponent, World } from '../ecs.js';
import type { Kernel, SimSystem, TickContext } from '../kernel.js';
import { VILLAGE_RADIUS_T2, type TerrainAccessor, type VillageGameplay, type VillageOwnershipGuard } from './villages.js';
import type { PopulationGameplay, StartingPopulation } from './population.js';
import type { EconomyGameplay } from './economy.js';
import type { LogisticsGameplay } from './logistics.js';

// ---------------------------------------------------------------- constants

/** The party a settler dispatch always sends (GDD §5 "settler party"). */
export const SETTLER_PARTY: StartingPopulation = { children: 8, adults: 20, elders: 2 };
/** What the party carries — the new village's founding stock. */
export const SETTLER_CARRY: Readonly<Record<string, number>> = {
  'base:resource.wood': 80,
  'base:resource.stone': 30,
  'base:resource.food': 60,
};
/** The source must remain a living village after the party leaves. */
export const MIN_ADULTS_REMAINING = 10;

/** Tier 1 → 2 requirements (GDD §5: pop, variety, materials, happiness). */
export const TIER2_REQUIREMENTS = {
  population: 60,
  distinctBuildings: 4, // completed, excluding the centre
  materials: { 'base:resource.wood': 60, 'base:resource.stone': 40 } as Readonly<Record<string, number>>,
  happiness: 60,
};

export const SITE_SCORE_RADIUS = 6;
/** Woodland is scored over the tier-1 village build radius (VILLAGE_RADIUS_T1) — that's the
 * region a Lumber Camp can actually be placed in. Kept local to avoid a villages.ts import cycle. */
export const WOODLAND_SCORE_RADIUS = 12;
/** Having a few forest tiles in reach is what matters (a Lumber Camp needs one); beyond this the
 * bonus plateaus so the founder doesn't chase forest-heavy, farm-poor sites. */
export const WOODLAND_SCORE_CAP = 8;
/** Strong enough to pull the capital toward reachable forest over a marginally better-fed but
 * wood-free pocket, but bounded so food still dominates among wood-adjacent sites. */
export const WOODLAND_SCORE_WEIGHT = 20;

// ---------------------------------------------------------------- site scoring

/**
 * Pure site score (GDD §13): food potential (farmable tiles), buildable
 * ground (open tiles), water access (river or coast within reach), and
 * woodland access (forest within reach — a Lumber Camp's only valid ground, so
 * a wood-free start soft-locks the raw-materials chain). Spacing and legality
 * are the validator's job — this only RANKS.
 */
export function scoreSite(terrain: TerrainAccessor, x: number, y: number): number {
  let farmable = 0;
  let open = 0;
  let water = 0;
  for (let dy = -SITE_SCORE_RADIUS; dy <= SITE_SCORE_RADIUS; dy++) {
    for (let dx = -SITE_SCORE_RADIUS; dx <= SITE_SCORE_RADIUS; dx++) {
      const tx = x + dx;
      const ty = y + dy;
      if (tx < 0 || ty < 0 || tx >= terrain.width || ty >= terrain.height) continue;
      const tags = terrain.tagsAt(tx, ty);
      if (tags.includes('farmable')) farmable++;
      if (tags.includes('open')) open++;
      if (terrain.riverAt(tx, ty) || tags.includes('dockable')) water++;
    }
  }
  // Woodland is scored over the whole tier-1 BUILD radius (a Lumber Camp can go
  // anywhere in it), not the tight radius-6 core the other terms use — a wood-free
  // start soft-locks the raw-materials chain, so this is a strong pull toward at
  // least SOME forest in reach, then plateaus (a forest-choked spot is no better a
  // capital). Food still dominates the ranking among wood-adjacent sites.
  let woodland = 0;
  for (let dy = -WOODLAND_SCORE_RADIUS; dy <= WOODLAND_SCORE_RADIUS; dy++) {
    for (let dx = -WOODLAND_SCORE_RADIUS; dx <= WOODLAND_SCORE_RADIUS; dx++) {
      const tx = x + dx;
      const ty = y + dy;
      if (tx < 0 || ty < 0 || tx >= terrain.width || ty >= terrain.height) continue;
      if (terrain.tagsAt(tx, ty).includes('woodland')) woodland++;
    }
  }
  // food is the economy's heartbeat (GDD §3) — weight it highest; water is a bounded bonus.
  return farmable * 3 + open * 1 + Math.min(water, 6) * 4 + Math.min(woodland, WOODLAND_SCORE_CAP) * WOODLAND_SCORE_WEIGHT;
}

/**
 * Best-scoring VALID centre site within a Chebyshev search radius of (cx, cy).
 * Deterministic tie-break: higher score, then lower y, then lower x.
 */
export function bestSiteNear(
  game: VillageGameplay,
  db: DefinitionDatabase,
  cx: number,
  cy: number,
  searchRadius: number,
): { x: number; y: number; score: number } | null {
  const centerDef = db.buildings.get('base:building.village-center');
  if (centerDef === undefined) return null;
  let best: { x: number; y: number; score: number } | null = null;
  for (let y = Math.max(1, cy - searchRadius); y <= Math.min(game.terrain.height - 2, cy + searchRadius); y++) {
    for (let x = Math.max(1, cx - searchRadius); x <= Math.min(game.terrain.width - 2, cx + searchRadius); x++) {
      if (!game.ops.validatePlacement(centerDef, x, y, null).ok) continue;
      const score = scoreSite(game.terrain, x, y);
      if (best === null || score > best.score) best = { x, y, score };
    }
  }
  return best;
}

// ---------------------------------------------------------------- components

export type SettlerPartyComponent = SoAComponent<{
  source: 'eid';
  targetX: 'i32';
  targetY: 'i32';
  children: 'f64';
  adults: 'f64';
  elders: 'f64';
  returning: 'bool';
  pathIndex: 'u16';
  progress: 'f64';
}>;

/** M47.8: the owner a settler-founded village inherits from its source village. */
export interface FoundingOwner {
  readonly component: SoAComponent<{ kingdom: 'eid' }>;
  readonly kingdomId: EntityId;
}
export type FoundingOwnerResolver = (sourceVillageIndex: number) => FoundingOwner | undefined;

export interface SettlerGameplay {
  readonly SettlerParty: SettlerPartyComponent;
  readonly SettlerCargo: ObjectComponent<Map<number, number>>;
  readonly SettlerName: ObjectComponent<string>;
  /** Total people across every village and walking party (conservation tests). */
  totalPopulation(): number;
  /**
   * M47.8 (doc 12 R1 "multi-village AI"): settler-founded villages inherit their source's
   * OWNER. The kingdom module registers after this one, so ownership arrives as a late-bound
   * hook plus a mutable access extension — the exact `registerCharacterExtension` precedent
   * kingdom.ts documents (a later module extends an earlier system's declared writes).
   */
  setFoundingOwner(resolver: FoundingOwnerResolver, ownerComponent: SoAComponent<{ kingdom: 'eid' }>): void;
  /** 1.x ownership guard for `village.upgrade` — same late-bound injection as `setFoundingOwner`,
   * supplied by kingdom.ts. Un-set ⇒ no restriction (single-kingdom / Terra). */
  setOwnershipGuard(guard: VillageOwnershipGuard): void;
}

// ---------------------------------------------------------------- registrar

export function registerSettlerGameplay(
  kernel: Kernel,
  world: World,
  db: DefinitionDatabase,
  game: VillageGameplay,
  popGame: PopulationGameplay,
  econ: EconomyGameplay,
  logi: LogisticsGameplay,
  Position: SoAComponent<{ x: 'f64'; y: 'f64' }>,
): SettlerGameplay {
  const { VillageCore, VillageName, Stockpile, BuildingCore } = game.comps;
  const { Population } = popGame;
  const terrain = game.terrain;
  const index = (id: number): number => id & 0x3fffff;

  const SettlerParty: SettlerPartyComponent = world.defineSoA('settlerParty', {
    source: 'eid',
    targetX: 'i32',
    targetY: 'i32',
    children: 'f64',
    adults: 'f64',
    elders: 'f64',
    returning: 'bool',
    pathIndex: 'u16',
    progress: 'f64',
  });
  const SettlerCargo = world.defineObject<Map<number, number>>('settlerCargo', (cargo, fold) => {
    for (const key of [...cargo.keys()].sort((a, b) => a - b)) {
      fold(key);
      fold(cargo.get(key) as number);
    }
  });
  const SettlerName = world.defineObject<string>('settlerName', (name, fold) => {
    for (let i = 0; i < name.length; i++) fold(name.charCodeAt(i));
  });

  const centerDef = db.buildings.get('base:building.village-center');

  // ---------------- dispatch: village.sendSettlers ----------------
  const dispatch = (ctx: TickContext, villageId: number, x: number, y: number, name: string): true | string => {
    const village = villageId as EntityId;
    if (!world.isAlive(village) || centerDef === undefined) return 'no such village';
    const vi = index(villageId);
    const pop = world.write(Population);
    if ((pop.adults[vi] as number) - SETTLER_PARTY.adults < MIN_ADULTS_REMAINING) {
      return `source village too small (needs ${SETTLER_PARTY.adults + MIN_ADULTS_REMAINING} adults, has ${Math.floor(pop.adults[vi] as number)})`;
    }
    if ((pop.children[vi] as number) < SETTLER_PARTY.children || (pop.elders[vi] as number) < SETTLER_PARTY.elders) {
      return 'source village lacks the party cohorts';
    }
    // the site must look valid NOW — the rulebook validates again on arrival
    const verdict = game.ops.validatePlacement(centerDef, x, y, null);
    if (!verdict.ok) return verdict.reason;
    // walkable at all?
    const core = world.read(VillageCore);
    const route = logi.paths.route(core.centerX[vi] as number, core.centerY[vi] as number, x, y);
    if (route === null) return `no walkable route to (${x}, ${y})`;
    // cargo: checked in full, then deducted atomically
    const stock = world.writeObj(Stockpile).tryGet(vi);
    if (stock === undefined) return 'no such village';
    const cargo = new Map<number, number>();
    for (const [resId, amount] of Object.entries(SETTLER_CARRY)) {
      const code = game.ops.resourceCode(resId) as number;
      const have = stock.get(code) ?? 0;
      if (have < amount) return `insufficient ${resId} (${have}/${amount})`;
      cargo.set(code, amount);
    }
    for (const [code, amount] of cargo) {
      stock.set(code, (stock.get(code) as number) - amount);
      econ.ledger.record(vi, code, 'settled', amount);
    }
    pop.children[vi] = (pop.children[vi] as number) - SETTLER_PARTY.children;
    pop.adults[vi] = (pop.adults[vi] as number) - SETTLER_PARTY.adults;
    pop.elders[vi] = (pop.elders[vi] as number) - SETTLER_PARTY.elders;

    const party = world.spawn();
    world.attach(party, SettlerParty, {
      source: villageId,
      targetX: x, targetY: y,
      children: SETTLER_PARTY.children, adults: SETTLER_PARTY.adults, elders: SETTLER_PARTY.elders,
      returning: false, pathIndex: 0, progress: 0,
    });
    world.attach(party, Position, { x: core.centerX[vi] as number, y: core.centerY[vi] as number });
    world.attach(party, SettlerCargo, cargo);
    world.attach(party, SettlerName, name);
    world.attach(party, logi.HaulerPath, route); // reuse the path component (one mover contract)
    ctx.events.publish({
      type: 'settlers.dispatched',
      tick: ctx.tick,
      data: { party: party as number, from: villageId, x, y, name },
    });
    return true;
  };

  kernel.registerCommand<{ villageId: number; x: number; y: number; name: string }>(
    'village.sendSettlers',
    (ctx, p) => {
      const result = dispatch(ctx, p.villageId | 0, p.x | 0, p.y | 0, String(p.name ?? 'Newholm'));
      if (typeof result === 'string') {
        ctx.events.publish({ type: 'village.rejected', tick: ctx.tick, data: { what: 'village.sendSettlers', reason: result } });
      }
    },
  );

  // ---------------- movement: parties walk, found or return ----------------
  // M47.8: `moveWrites` stays a LIVE array reference — setFoundingOwner appends the
  // late-defined VillageOwner component so founding-with-owner passes the access guard
  // (same mutable-declaration mechanism as kingdom.ts's registerCharacterExtension).
  let foundingOwner: FoundingOwnerResolver | null = null;
  // 1.x ownership guard (late-bound from kingdom.ts; un-set ⇒ allow, i.e. single-kingdom/Terra).
  let ownershipGuard: VillageOwnershipGuard | null = null;
  const moveWrites = [
    SettlerParty, SettlerCargo, SettlerName, Position, logi.HaulerPath,
    // arrival founding spawns a village + centre and fires subscriptions:
    VillageCore, VillageName, Stockpile, BuildingCore,
    Population, econ.StockLimits, econ.BuildingInventory,
  ];
  const movement: SimSystem = {
    name: 'settler-move',
    period: 1,
    access: {
      writes: moveWrites,
    },
    update(ctx: TickContext): void {
      const s = world.write(SettlerParty);
      const pos = world.write(Position);
      const pathsOf = world.writeObj(logi.HaulerPath);
      const names = world.readObj(SettlerName);
      const cargoes = world.writeObj(SettlerCargo);
      const w = terrain.width;
      const done: EntityId[] = [];

      world.query([SettlerParty, Position]).forEach((pi, party) => {
        const path = pathsOf.tryGet(pi) ?? [];
        let pathIndex = s.pathIndex[pi] as number;
        if (pathIndex < path.length) {
          let progress = (s.progress[pi] as number) + 1;
          while (pathIndex < path.length) {
            const tile = path[pathIndex] as number;
            const cost = logi.paths.stepCost(tile % w, Math.floor(tile / w));
            if (progress < cost) break;
            progress -= cost;
            pos.x[pi] = tile % w;
            pos.y[pi] = Math.floor(tile / w);
            pathIndex++;
          }
          s.pathIndex[pi] = pathIndex;
          s.progress[pi] = pathIndex < path.length ? progress : 0;
          if (pathIndex < path.length) return; // still walking
        }

        const cargo = cargoes.tryGet(pi) ?? new Map<number, number>();
        const party_ = { children: s.children[pi] as number, adults: s.adults[pi] as number, elders: s.elders[pi] as number };

        if ((s.returning[pi] as number) === 1) {
          // home again: re-merge people and cargo (conservation)
          const sourceVi = index(s.source[pi] as number);
          const source = s.source[pi] as unknown as EntityId;
          if (world.isAlive(source)) {
            const pop = world.write(Population);
            pop.children[sourceVi] = (pop.children[sourceVi] as number) + party_.children;
            pop.adults[sourceVi] = (pop.adults[sourceVi] as number) + party_.adults;
            pop.elders[sourceVi] = (pop.elders[sourceVi] as number) + party_.elders;
            const stock = world.writeObj(Stockpile).tryGet(sourceVi);
            if (stock !== undefined) {
              for (const [code, amount] of cargo) {
                stock.set(code, (stock.get(code) ?? 0) + amount);
                econ.ledger.record(sourceVi, code, 'settled', -amount); // the outflow came back
              }
            }
            ctx.events.publish({ type: 'settlers.returned', tick: ctx.tick, data: { party: party as number, to: s.source[pi] as number } });
            done.push(party);
          }
          // source dead: the party camps where it stands (a later milestone's
          // migration/refugee rules pick this up — doc 08 §5)
          return;
        }

        // at the target: found through the ONE rulebook — validated again.
        // M47.8: the new village flies its source's banner (owner resolved NOW, not at
        // dispatch — if the source fell mid-march, the party founds unowned, a refugee
        // village; doc 08 §5's migration rules can adopt it later).
        const owner = world.isAlive(s.source[pi] as unknown as EntityId)
          ? foundingOwner?.(index(s.source[pi] as number))
          : undefined;
        const founded = game.ops.found(
          ctx,
          s.targetX[pi] as number,
          s.targetY[pi] as number,
          names.tryGet(pi) ?? 'Newholm',
          cargo,
          party_,
          owner,
        );
        if (typeof founded === 'string') {
          // site lost en route: turn the party around
          ctx.events.publish({
            type: 'settlers.turnedBack',
            tick: ctx.tick,
            data: { party: party as number, reason: founded },
          });
          const sourceVi = index(s.source[pi] as number);
          const core = world.read(VillageCore);
          const route = logi.paths.route(
            Math.round(pos.x[pi] as number), Math.round(pos.y[pi] as number),
            core.centerX[sourceVi] as number, core.centerY[sourceVi] as number,
          );
          s.returning[pi] = 1;
          s.pathIndex[pi] = 0;
          s.progress[pi] = 0;
          pathsOf.set(pi, route ?? []);
          return;
        }
        done.push(party);
      });
      for (const party of done) world.despawn(party);
    },
  };

  // ---------------- tiers: village.upgrade (GDD §5) ----------------
  const upgrade = (ctx: TickContext, villageId: number): true | string => {
    const village = villageId as EntityId;
    if (!world.isAlive(village)) return 'no such village';
    const vi = index(villageId);
    const core = world.write(VillageCore);
    if ((core.tier[vi] as number) !== 1) return `already tier ${core.tier[vi] as number} (tiers 3–4 arrive later)`;
    const pop = world.read(Population);
    const total = (pop.children[vi] as number) + (pop.adults[vi] as number) + (pop.elders[vi] as number);
    if (total < TIER2_REQUIREMENTS.population) {
      return `needs population ${TIER2_REQUIREMENTS.population} (has ${Math.floor(total)})`;
    }
    if ((pop.happiness[vi] as number) < TIER2_REQUIREMENTS.happiness) {
      return `needs happiness ${TIER2_REQUIREMENTS.happiness} (has ${Math.round(pop.happiness[vi] as number)})`;
    }
    const b = world.read(BuildingCore);
    const distinct = new Set<number>();
    world.query([BuildingCore]).forEach((i) => {
      if (index(b.village[i] as number) !== vi || (b.complete[i] as number) !== 1) return;
      const def = game.ops.buildingDef(b.def[i] as number);
      if (!def.tags.includes('center')) distinct.add(b.def[i] as number);
    });
    if (distinct.size < TIER2_REQUIREMENTS.distinctBuildings) {
      return `needs ${TIER2_REQUIREMENTS.distinctBuildings} distinct completed buildings (has ${distinct.size})`;
    }
    const stock = world.writeObj(Stockpile).tryGet(vi);
    if (stock === undefined) return 'no such village';
    for (const [resId, amount] of Object.entries(TIER2_REQUIREMENTS.materials)) {
      const have = stock.get(game.ops.resourceCode(resId) as number) ?? 0;
      if (have < amount) return `insufficient ${resId} (${have}/${amount})`;
    }
    for (const [resId, amount] of Object.entries(TIER2_REQUIREMENTS.materials)) {
      const code = game.ops.resourceCode(resId) as number;
      stock.set(code, (stock.get(code) as number) - amount);
      econ.ledger.record(vi, code, 'built', amount);
    }
    core.tier[vi] = 2;
    core.radius[vi] = VILLAGE_RADIUS_T2;
    ctx.events.publish({ type: 'village.upgraded', tick: ctx.tick, data: { village: villageId, tier: 2 } });
    return true;
  };

  kernel.registerCommand<{ villageId: number }>('village.upgrade', (ctx, p, command) => {
    if (ownershipGuard !== null && !ownershipGuard(command.issuer, p.villageId | 0)) {
      ctx.events.publish({ type: 'village.rejected', tick: ctx.tick, data: { what: 'village.upgrade', reason: 'not your village' } });
      return;
    }
    const result = upgrade(ctx, p.villageId | 0);
    if (typeof result === 'string') {
      ctx.events.publish({ type: 'village.rejected', tick: ctx.tick, data: { what: 'village.upgrade', reason: result } });
    }
  });

  kernel.registerSystem(movement);

  return {
    SettlerParty,
    SettlerCargo,
    SettlerName,
    setFoundingOwner(resolver: FoundingOwnerResolver, ownerComponent: SoAComponent<{ kingdom: 'eid' }>): void {
      foundingOwner = resolver;
      if (!moveWrites.some((c) => c === (ownerComponent as unknown))) moveWrites.push(ownerComponent as never);
    },
    setOwnershipGuard(guard: VillageOwnershipGuard): void { ownershipGuard = guard; },
    totalPopulation(): number {
      let total = 0;
      const pop = world.read(Population);
      world.query([Population, VillageCore]).forEach((vi) => {
        total += (pop.children[vi] as number) + (pop.adults[vi] as number) + (pop.elders[vi] as number);
      });
      const s = world.read(SettlerParty);
      world.query([SettlerParty]).forEach((pi) => {
        total += (s.children[pi] as number) + (s.adults[pi] as number) + (s.elders[pi] as number);
      });
      return total;
    },
  };
}
