/**
 * ECS micro-benchmark (roadmap M4 test objective; budgets from doc 11).
 *
 *   node packages/tools/dist/bench-ecs.js [entities] [iterations]
 *
 * Scenario: N entities with Position+Velocity (SoA f64), 30% also carrying a
 * Health component to exercise query filtering. Measures:
 *   1. spawn+attach throughput
 *   2. full-query integration pass (pos += vel) — the shape of every hot system
 *   3. filtered query (all: pos,vel; none: health)
 *   4. world.hash() cost (determinism harness overhead, M5)
 *
 * Context for the numbers: at 8× speed the sim runs 80 ticks/sec with a ≤10 ms
 * tick budget (doc 11 §2). A movement-style pass over 100k entities must
 * therefore cost well under 1 ms. This is a report, not a CI gate — the nightly
 * benchmark scenes (doc 11 §6) arrive with real content.
 */
import { World } from '@crowns/sim';

declare const performance: { now(): number };

const N = Math.max(1000, Number(process.argv[2] ?? 100_000) | 0);
const ITER = Math.max(1, Number(process.argv[3] ?? 100) | 0);

const world = new World(N);
const Position = world.defineSoA('position', { x: 'f64', y: 'f64' });
const Velocity = world.defineSoA('velocity', { dx: 'f64', dy: 'f64' });
const Health = world.defineSoA('health', { current: 'u16', max: 'u16' });

// 1) build
let t0 = performance.now();
for (let i = 0; i < N; i++) {
  const e = world.spawn();
  world.attach(e, Position, { x: i % 512, y: (i / 512) | 0 });
  world.attach(e, Velocity, { dx: (i % 7) - 3, dy: (i % 5) - 2 });
  if (i % 10 < 3) world.attach(e, Health, { current: 100, max: 100 });
}
const buildMs = performance.now() - t0;

// 2) integration pass over all movers
const movers = world.query([Position, Velocity]);
const pos = world.write(Position);
const vel = world.read(Velocity);
let checksum = 0;
t0 = performance.now();
for (let it = 0; it < ITER; it++) {
  movers.forEach((i) => {
    pos.x[i] = (pos.x[i] as number) + (vel.dx[i] as number);
    pos.y[i] = (pos.y[i] as number) + (vel.dy[i] as number);
  });
}
const integrateMs = (performance.now() - t0) / ITER;
movers.forEach((i) => (checksum += pos.x[i] as number));

// 3) filtered query
const unhurt = world.query([Position, Velocity], [Health]);
t0 = performance.now();
let filtered = 0;
for (let it = 0; it < ITER; it++) {
  filtered = unhurt.count();
}
const filterMs = (performance.now() - t0) / ITER;

// 4) hash
t0 = performance.now();
let h = 0;
world.hash((v) => (h = (h * 31 + v) >>> 0));
const hashMs = performance.now() - t0;

const perEntityNs = (ms: number): string => ((ms * 1e6) / N).toFixed(1);
console.log(`ECS micro-bench · ${N.toLocaleString()} entities · ${ITER} iterations\n`);
console.log(`spawn+attach        ${buildMs.toFixed(1).padStart(8)} ms   ${perEntityNs(buildMs)} ns/entity`);
console.log(`integrate pass      ${integrateMs.toFixed(3).padStart(8)} ms   ${perEntityNs(integrateMs)} ns/entity   (budget context: ≤10 ms tick)`);
console.log(`filtered count      ${filterMs.toFixed(3).padStart(8)} ms   (${filtered.toLocaleString()} matches)`);
console.log(`world.hash          ${hashMs.toFixed(1).padStart(8)} ms   (dev/M5 harness only)`);
console.log(`\nchecksum ${checksum.toFixed(0)} · hash 0x${h.toString(16)}`);
