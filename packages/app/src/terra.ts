/**
 * "Terra" composition (roadmap M8): the wanderers pattern on a REAL generated
 * world — worldgen runs inside the composition, Mod Zero terrain defs validate
 * at startup, creatures spawn on land and refuse to step into water. This is
 * the demo session AND golden scenario 'terra-demo' (fixtures pin worldgen +
 * kernel + ECS + content pipeline together).
 */
import type { EntityId } from '@crowns/core';
import { BASE_CONTENT_FILES, DefinitionDatabase } from '@crowns/data';
import type { TerrainSnapshot } from '@crowns/protocol';
import {
  Biome,
  CalendarSystem,
  Kernel,
  TICKS_PER_DAY,
  World,
  generateWorld,
  registerVillageGameplay,
  registerPopulationGameplay,
  type SimSystem,
  type SoAComponent,
  type TerrainAccessor,
  type TickContext,
  type VillageGameplay,
  type PopulationGameplay,
  type WorldDef,
} from '@crowns/sim';

export interface TerraComposition {
  readonly kernel: Kernel;
  readonly world: World;
  readonly Position: SoAComponent<{ x: 'f64'; y: 'f64' }>;
  readonly worldDef: WorldDef;
  readonly terrain: TerrainSnapshot;
  readonly game: VillageGameplay;
  readonly popGame: PopulationGameplay;
}

const CREATURES = 150;

/** Best 'open'-tagged 2×2 site nearest map center — deterministic spiral scan. */
function findFoundingSite(
  width: number,
  height: number,
  terrain: TerrainAccessor,
): { x: number; y: number } | null {
  const cx = width >> 1;
  const cy = height >> 1;
  const fits = (x: number, y: number): boolean => {
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        if (!terrain.tagsAt(x + dx, y + dy).includes('open')) return false;
        if (terrain.riverAt(x + dx, y + dy)) return false;
      }
    }
    return true;
  };
  for (let r = 0; r < Math.min(width, height) >> 1; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 1 && y >= 1 && x < width - 2 && y < height - 2 && fits(x, y)) return { x, y };
      }
    }
  }
  return null;
}

export function composeTerra(seed: number, clock?: () => number): TerraComposition {
  const db = DefinitionDatabase.load(BASE_CONTENT_FILES); // Mod Zero gate: invalid content = no game
  const worldDef = generateWorld(seed, { size: 'medium' });
  const { width, height } = worldDef;
  const biome = worldDef.layers.biome;

  const isLand = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    const b = biome[y * width + x] as number;
    return b !== Biome.Ocean && b !== Biome.Coast;
  };

  const kernel = new Kernel(seed, clock !== undefined ? { clock } : {});
  const world = new World(512);
  const Position = world.defineSoA('position', { x: 'f64', y: 'f64' });
  const Energy = world.defineSoA('energy', { value: 'f64' });

  // village gameplay (M11): defs from Mod Zero, placement over the real terrain
  const terrainAccessor: TerrainAccessor = {
    width,
    height,
    tagsAt(x, y) {
      return db.terrainByCode[biome[y * width + x] as number]?.buildableTags ?? [];
    },
    riverAt(x, y) {
      return (worldDef.layers.river[y * width + x] as number) !== 0;
    },
  };
  const STARTING_STOCK = { 'base:resource.wood': 220, 'base:resource.stone': 80, 'base:resource.food': 120 };
  const game = registerVillageGameplay(kernel, world, db, terrainAccessor, STARTING_STOCK);
  const popGame = registerPopulationGameplay(kernel, world, db, game, { children: 12, adults: 30, elders: 5 });

  const spawnOnLand = (ctx: TickContext): void => {
    for (let attempt = 0; attempt < 64; attempt++) {
      const x = ctx.rng.int(0, width - 1);
      const y = ctx.rng.int(0, height - 1);
      if (!isLand(x, y)) continue;
      const e = world.spawn();
      world.attach(e, Position, { x, y });
      world.attach(e, Energy, { value: 100 });
      return;
    }
  };

  const genesis: SimSystem = {
    name: 'genesis',
    period: 0x7fffffff,
    phase: 1,
    access: {
      writes: [
        Position, Energy,
        game.comps.VillageCore, game.comps.VillageName, game.comps.Stockpile, game.comps.BuildingCore,
        popGame.Population, // the founded event attaches settlers inside this scope
      ],
    },
    update(ctx: TickContext): void {
      for (let n = 0; n < CREATURES; n++) spawnOnLand(ctx);
      // found the starter settlement on the best open site near map center,
      // then queue a spread of the M11 buildings — the demo builds itself
      const site = findFoundingSite(width, height, terrainAccessor);
      if (site === null) return;
      const village = game.ops.found(ctx, site.x, site.y, 'Firstholm', STARTING_STOCK);
      if (typeof village === 'string') return;
      // place each building at the first VALID spot on a deterministic spiral
      // around the center — the one-rulebook validator decides, genesis obeys
      const placeNear = (defId: string): void => {
        const def = db.buildings.get(defId);
        if (def === undefined) return;
        for (let r = 2; r <= 10; r++) {
          for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
              if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
              const x = site.x + dx;
              const y = site.y + dy;
              if (!game.ops.validatePlacement(def, x, y, village as never).ok) continue;
              const result = game.ops.place(ctx, village as number, defId, x, y);
              if (typeof result !== 'string') return;
              return; // affordable check failed: stop trying this def
            }
          }
        }
      };
      for (const defId of [
        'base:building.house', 'base:building.house', 'base:building.house',
        'base:building.well', 'base:building.granary', 'base:building.farm',
        'base:building.lumber-camp', 'base:building.quarry',
      ]) {
        placeNear(defId);
      }
    },
  };

  const movement: SimSystem = {
    name: 'movement',
    period: 1,
    access: { writes: [Position], reads: [Energy] },
    update(ctx: TickContext): void {
      const pos = world.write(Position);
      world.query([Position, Energy]).forEach((i) => {
        const nx = (pos.x[i] as number) + ctx.rng.int(-1, 1);
        const ny = (pos.y[i] as number) + ctx.rng.int(-1, 1);
        if (isLand(nx, ny)) {
          pos.x[i] = nx;
          pos.y[i] = ny;
        } // water blocks the step: creatures hug coastlines and river banks
      });
    },
  };

  const metabolism: SimSystem = {
    name: 'metabolism',
    period: TICKS_PER_DAY,
    phase: 5,
    access: { writes: [Energy, Position] },
    update(ctx: TickContext): void {
      const energy = world.write(Energy);
      const dead: EntityId[] = [];
      world.query([Energy]).forEach((i, entity) => {
        energy.value[i] = (energy.value[i] as number) - ctx.rng.int(1, 5);
        if ((energy.value[i] as number) <= 0) dead.push(entity);
      });
      for (const entity of dead) {
        world.despawn(entity);
        spawnOnLand(ctx);
      }
    },
  };

  // Debug/sandbox commands (M9 → GDD §17): privileged writes through the SAME
  // command bus as everything else, so injector actions land in the command
  // log and replay deterministically. Handler registration is hash-inert.
  kernel.registerCommand<{ x: number; y: number; count?: number }>('debug.spawn', (ctx, payload) => {
    const count = Math.min(100, Math.max(1, payload.count ?? 1));
    for (let n = 0; n < count; n++) {
      const e = world.spawn();
      world.attach(e, Position, { x: payload.x, y: payload.y });
      world.attach(e, Energy, { value: 100 });
    }
    ctx.events.publish({ type: 'debug.spawned', tick: ctx.tick, data: { count, x: payload.x, y: payload.y } });
  });
  kernel.registerCommand<{ entityId: number }>('debug.smite', (ctx, payload) => {
    const id = payload.entityId as EntityId;
    if (world.isAlive(id)) {
      world.despawn(id);
      ctx.events.publish({ type: 'debug.smitten', tick: ctx.tick, data: { entityId: payload.entityId } });
    } else {
      ctx.events.publish({ type: 'debug.miss', tick: ctx.tick, data: { entityId: payload.entityId } });
    }
  });

  kernel.registerSystem(genesis);
  kernel.registerSystem(new CalendarSystem());
  kernel.registerSystem(movement);
  kernel.registerSystem(metabolism);
  kernel.attachGuard(world);
  kernel.addHashSource('world', (fold) => world.hash(fold));
  kernel.addHashSource('worldgen', (fold) => {
    // pin the terrain itself into replay hashes (cheap: land fraction + counts)
    fold(Math.round(worldDef.stats.landFraction * 1e6));
    for (const c of worldDef.stats.biomeCounts) fold(c);
    fold(worldDef.stats.riverTiles);
  });

  const terrain: TerrainSnapshot = {
    width,
    height,
    biome: worldDef.layers.biome,
    river: worldDef.layers.river,
    palette: db.terrainByCode.map((t) => ({ base: t.colors.base, accent: t.colors.accent, name: t.name })),
    riverColor: (db.overlays.get('river')?.color ?? 0x4a86b0),
    lakeColor: (db.overlays.get('lake')?.color ?? 0x3f7aa4),
  };
  return { kernel, world, Position, worldDef, terrain, game, popGame };
}
