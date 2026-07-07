/**
 * Haul throughput benchmark (roadmap M14 test objective; budgets doc 11 §2).
 *
 *   node packages/tools/dist/bench-haul.js [villages] [haulersPerVillage]
 *
 * Scenario: a grid of villages on an open plain, each with distant farms and
 * a full hauler staff — the doc 11 "active haul jobs" row targets 1,200
 * (stress 2,000). Default 64 villages × 20 haulers = 1,280 active carts.
 * Measures average tick cost and the logistics systems' share via kernel
 * telemetry (injected clock — the sim itself never reads wall time).
 * This is a report, not a CI gate (nightly benchmark scenes: doc 11 §6).
 */
import {
  Kernel,
  World,
  registerVillageGameplay,
  registerPopulationGameplay,
  registerEconomyGameplay,
  registerLogisticsGameplay,
  type TerrainAccessor,
  type TickContext,
} from '@crowns/sim';
import { DefinitionDatabase, BASE_CONTENT_FILES } from '@crowns/data';

const VILLAGES = Math.max(1, Number(process.argv[2] ?? 64) | 0);
const HAULERS = Math.max(1, Number(process.argv[3] ?? 20) | 0);

const side = Math.ceil(Math.sqrt(VILLAGES));
const SPACING = 26; // > VILLAGE_MIN_SPACING
const size = side * SPACING + 24;

const plain: TerrainAccessor = {
  width: size,
  height: size,
  tagsAt: () => ['open', 'farmable', 'mineable', 'woodland'],
  riverAt: () => false,
  movementCostAt: () => 1,
};

const kernel = new Kernel(0xbe9c4, { clock: () => performance.now() });
const world = new World(VILLAGES * (HAULERS + 8) + 64);
const db = DefinitionDatabase.load(BASE_CONTENT_FILES);
const stock = { 'base:resource.wood': 2000, 'base:resource.stone': 2000, 'base:resource.food': 400 };
const game = registerVillageGameplay(kernel, world, db, plain, stock);
const popGame = registerPopulationGameplay(kernel, world, db, game, { children: 40, adults: 140, elders: 20 });
const econ = registerEconomyGameplay(kernel, world, db, game);
const Position = world.defineSoA('position', { x: 'f64', y: 'f64' });
registerLogisticsGameplay(kernel, world, db, game, popGame, econ, Position, { haulerTarget: HAULERS });

kernel.registerSystem({
  name: 'bench-genesis',
  period: 0x7fffffff,
  phase: 1,
  access: {
    writes: [
      Position,
      game.comps.VillageCore, game.comps.VillageName, game.comps.Stockpile, game.comps.BuildingCore,
      popGame.Population, econ.StockLimits, econ.BuildingInventory,
    ],
  },
  update(ctx: TickContext): void {
    let founded = 0;
    for (let gy = 0; gy < side && founded < VILLAGES; gy++) {
      for (let gx = 0; gx < side && founded < VILLAGES; gx++) {
        const cx = 12 + gx * SPACING;
        const cy = 12 + gy * SPACING;
        const village = game.ops.found(ctx, cx, cy, `Bench-${founded}`, stock);
        if (typeof village === 'string') continue;
        founded++;
        // distant farms: every pickup is a real walk
        for (const [dx, dy] of [[9, -1], [9, 3], [-9, -1], [-9, 3], [0, 9], [0, -10]] as const) {
          game.ops.place(ctx, village as number, 'base:building.farm', cx + dx, cy + dy);
        }
      }
    }
  },
});
kernel.attachGuard(world);

// settle: construction completes, staff spawns, jobs flow
const SETTLE = 24 * 8;
for (let t = 0; t < SETTLE; t++) kernel.step();

let active = 0;
world.query([Position]).forEach(() => active++);

const TICKS = 500;
const t0 = performance.now();
for (let t = 0; t < TICKS; t++) kernel.step();
const elapsed = performance.now() - t0;

const telemetry = kernel.getTelemetry();
const share = (name: string): string => {
  const s = telemetry.systems.find((x) => x.name === name);
  return s === undefined ? 'n/a' : `${s.avgMs.toFixed(3)} ms`;
};

console.log(`bench-haul: ${VILLAGES} villages × ${HAULERS} haulers (${active} cart entities)`);
console.log(`  ${TICKS} ticks in ${elapsed.toFixed(0)} ms → ${(elapsed / TICKS).toFixed(3)} ms/tick avg`);
console.log(`  haul-board ${share('haul-board')} · haul-move ${share('haul-move')} · production ${share('production')} · jobs ${share('jobs')}`);
console.log(`  budget context (doc 11 §2): ≤10 ms/tick at 8× speed; haul jobs target 1,200 (stress 2,000)`);
