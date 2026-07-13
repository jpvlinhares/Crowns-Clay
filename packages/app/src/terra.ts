/**
 * "Terra" composition (roadmap M8): the wanderers pattern on a REAL generated
 * world — worldgen runs inside the composition, Mod Zero terrain defs validate
 * at startup, creatures spawn on land and refuse to step into water. This is
 * the demo session AND golden scenario 'terra-demo' (fixtures pin worldgen +
 * kernel + ECS + content pipeline together).
 */
import { Locale, type EntityId } from '@crowns/core';
import { BASE_CONTENT_FILES, DefinitionDatabase, loadLocaleTable, type LoadReport, type ModSource } from '@crowns/data';
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
  registerEconomyGameplay,
  registerLogisticsGameplay,
  registerSettlerGameplay,
  registerKingdomGameplay,
  registerEventGameplay,
  StatModifiers,
  SaveManager,
  kernelSection,
  worldSection,
  bestSiteNear,
  type SimSystem,
  type SoAComponent,
  type TerrainAccessor,
  type TickContext,
  type VillageGameplay,
  type PopulationGameplay,
  type EconomyGameplay,
  type LogisticsGameplay,
  type SettlerGameplay,
  type KingdomGameplay,
  type EventGameplay,
  type WorldDef,
} from '@crowns/sim';

/** Selects the mod layers a session composes with (roadmap M39; doc 09 §5). */
export interface ModSelection {
  /** Base always leads; these are additional layers, in the order given (tie-break only). */
  readonly sources: readonly ModSource[];
  readonly order?: readonly string[];
}

/** World-creation sandbox toggle (roadmap M40; GDD §17). Presence enables it. */
export interface SandboxOptions {
  /** Chronicle-locking hard mode (doc 06 §13's `ironman: bool`) — recorded, not yet enforced
   * anywhere (no mid-campaign difficulty-change command exists yet, doc 14 OQ-8's own M38 note). */
  readonly ironman?: boolean;
}

export interface TerraComposition {
  readonly db: DefinitionDatabase;
  /** The resolved layer order, conflicts, and mod identity (Mods screen + save embedding). */
  readonly modReport: LoadReport;
  /** English base locale (roadmap M44; doc 10 §6) — resolves EventDef.text/choice LocalizedText
   * keys for the catalog projection. Base only for now: mod-provided translation layers and
   * runtime locale switching are out of this milestone's proof-of-concept scope (doc 14). */
  readonly locale: Locale;
  readonly sandbox: boolean;
  readonly kernel: Kernel;
  readonly world: World;
  readonly Position: SoAComponent<{ x: 'f64'; y: 'f64' }>;
  readonly worldDef: WorldDef;
  readonly terrain: TerrainSnapshot;
  readonly game: VillageGameplay;
  readonly popGame: PopulationGameplay;
  readonly econGame: EconomyGameplay;
  readonly logiGame: LogisticsGameplay;
  readonly settlerGame: SettlerGameplay;
  readonly kingdomGame: KingdomGameplay;
  /** Events engine (roadmap M33, wired into the live game at M43) — tutorial + gameplay events. */
  readonly eventsGame: EventGameplay;
  readonly saves: SaveManager;
}

const CREATURES = 150;
const FOUNDING_SEARCH_RADIUS = 24; // genesis picks the best-scoring site near map centre (M15)

export function composeTerra(
  seed: number,
  clock?: () => number,
  mods?: ModSelection,
  sandbox?: SandboxOptions,
  localeId = 'en',
): TerraComposition {
  const sandboxEnabled = sandbox !== undefined;
  // Mod Zero gate: invalid content = no game. Base always leads the layer order;
  // additional layers (Mods screen selection, M39) merge on top of it.
  const sources: ModSource[] = [{ files: BASE_CONTENT_FILES }, ...(mods?.sources ?? [])];
  const { db, report } = DefinitionDatabase.loadMods(sources, { userOrder: ['base', ...(mods?.order ?? [])] });
  // roadmap M44: `?locale=en-XA` (doc 10 §6) swaps in the pseudo-locale table for CI screenshot
  // diffing — falls back to the empty table (fail-visible key-echo) for any other unknown id.
  const locale = new Locale(loadLocaleTable(BASE_CONTENT_FILES, `locale/${localeId}.json5`), localeId);
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
    movementCostAt(x, y) {
      return db.terrainByCode[biome[y * width + x] as number]?.movementCost ?? 0;
    },
  };
  const STARTING_STOCK = { 'base:resource.wood': 265, 'base:resource.stone': 160, 'base:resource.food': 120 };
  const statMods = new StatModifiers(); // one board: kingdom writes, economy/population read (M16)
  const game = registerVillageGameplay(kernel, world, db, terrainAccessor, STARTING_STOCK, sandboxEnabled);
  const popGame = registerPopulationGameplay(kernel, world, db, game, { children: 12, adults: 30, elders: 5 }, statMods);
  const econGame = registerEconomyGameplay(kernel, world, db, game, statMods);
  const logiGame = registerLogisticsGameplay(kernel, world, db, game, popGame, econGame, Position);
  const settlerGame = registerSettlerGameplay(kernel, world, db, game, popGame, econGame, logiGame, Position);
  const kingdomGame = registerKingdomGameplay(kernel, world, db, game, popGame, econGame, statMods, { sandboxEnabled });
  // M43: no diplomacy/research hooks — this is a single-kingdom composition with neither module
  // wired in; both are OPTIONAL per registerEventGameplay's own design (hasTech always false,
  // opinionChange a no-op), the same graceful-degradation shape every optional cross-module hook
  // in this codebase already uses (e.g. victory.ts's VictoryDeps).
  const eventsGame = registerEventGameplay(kernel, world, db, game, popGame, kingdomGame);

  // save/load (M17): sections cover all dynamic state; worldgen re-derives
  // from the seed, and derived caches rebuild in afterLoad hooks (TDD §8)
  const saves = new SaveManager(kernel);
  saves.setModManifest(report.manifest); // doc 09 §5: the active mod set travels with every save
  saves.setSandboxFlags({ sandbox: sandboxEnabled, ironman: sandbox?.ironman ?? false }); // doc 06 §13
  saves.register(kernelSection(kernel));
  saves.register(worldSection(world));
  saves.register({
    key: 'roads',
    version: 1,
    save: () => logiGame.roads.list(),
    load: (data) => logiGame.roads.restore(data as number[]),
  });
  // M43: the first save/load-capable composition the events engine has ever run in — without
  // this, a save→reload would replay 'welcome' after the player already reached tier 2.
  saves.register({
    key: 'events',
    version: 1,
    save: () => eventsGame.state.save(),
    load: (data) => eventsGame.state.restore(data as ReturnType<typeof eventsGame.state.save>),
  });
  saves.afterLoad(() => {
    game.ops.rebuildDerived();
    kingdomGame.refreshAfterLoad();
  });

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
        econGame.StockLimits, // …and the economy attaches its limits map (M13)
        econGame.BuildingInventory, // …and recipe buildings their inventories (M14)
      ],
    },
    update(ctx: TickContext): void {
      for (let n = 0; n < CREATURES; n++) spawnOnLand(ctx);
      // found the starter settlement on the best-SCORING valid site near map
      // center (M15 site scorer: food, water, buildables — GDD §13), then
      // queue a spread of the M11 buildings — the demo builds itself
      const site = bestSiteNear(game, db, width >> 1, height >> 1, FOUNDING_SEARCH_RADIUS);
      if (site === null) return;
      const village = game.ops.found(ctx, site.x, site.y, 'Firstholm', STARTING_STOCK);
      if (typeof village === 'string') return;
      // place each building at the first VALID spot on a deterministic spiral
      // around the center — the one-rulebook validator decides, genesis obeys
      const placed: { x: number; y: number }[] = [];
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
              if (typeof result !== 'string' && def.recipes !== undefined) placed.push({ x, y });
              return; // placed, or affordable check failed: stop trying this def
            }
          }
        }
      };
      for (const defId of [
        'base:building.house', 'base:building.house', 'base:building.house',
        'base:building.well', 'base:building.granary', 'base:building.farm',
        'base:building.lumber-camp', 'base:building.quarry',
        'base:building.sawmill', 'base:building.workshop', // the M13 chain: wood → planks → tools
      ]) {
        placeNear(defId);
      }
      // pave the haul routes (M14): a road along the cart path from the centre
      // to every production building — same rulebook and stone as the player
      for (const target of placed) {
        const route = logiGame.paths.route(site.x, site.y, target.x, target.y) ?? [];
        for (const tile of route) {
          logiGame.buildRoad(ctx, village as number, tile % width, Math.floor(tile / width));
        }
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

  // ---------------- sandbox editor: terrain (roadmap M40; GDD §17) ----------------
  // Land-only repaint (never Ocean/Coast, in either direction): keeps worldDef.stats.landFraction
  // exactly correct with zero extra bookkeeping, so the ONLY stat that needs updating in step is
  // biomeCounts — which the 'worldgen' hash source below already reads live off this same array,
  // so an edit is folded into replay hashes automatically, no new hash source needed.
  const rejectSandbox = (ctx: TickContext, what: string, reason: string): void => {
    ctx.events.publish({ type: 'village.rejected', tick: ctx.tick, data: { what, reason } });
  };
  kernel.registerCommand<{ x: number; y: number; biomeCode: number }>('sandbox.editTerrain', (ctx, payload) => {
    if (!sandboxEnabled) return rejectSandbox(ctx, 'sandbox.editTerrain', 'sandbox mode is not enabled');
    const x = payload.x | 0;
    const y = payload.y | 0;
    const code = payload.biomeCode | 0;
    if (x < 0 || y < 0 || x >= width || y >= height) return rejectSandbox(ctx, 'sandbox.editTerrain', 'out of bounds');
    if (db.terrainByCode[code] === undefined) return rejectSandbox(ctx, 'sandbox.editTerrain', `unknown biome code ${code}`);
    if (code === Biome.Ocean || code === Biome.Coast) {
      return rejectSandbox(ctx, 'sandbox.editTerrain', 'cannot paint water (land-only edits)');
    }
    const i = y * width + x;
    const oldCode = biome[i] as number;
    if (oldCode === Biome.Ocean || oldCode === Biome.Coast) {
      return rejectSandbox(ctx, 'sandbox.editTerrain', 'cannot repaint a water tile');
    }
    if (oldCode === code) return;
    biome[i] = code;
    worldDef.stats.biomeCounts[oldCode] = (worldDef.stats.biomeCounts[oldCode] as number) - 1;
    worldDef.stats.biomeCounts[code] = (worldDef.stats.biomeCounts[code] as number) + 1;
    ctx.events.publish({ type: 'sandbox.terrainEdited', tick: ctx.tick, data: { x, y, biomeCode: code } });
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
  return {
    db, modReport: report, locale, sandbox: sandboxEnabled, kernel, world, Position, worldDef, terrain,
    game, popGame, econGame, logiGame, settlerGame, kingdomGame, eventsGame, saves,
  };
}
