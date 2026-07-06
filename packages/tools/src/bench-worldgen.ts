/** Worldgen timing vs doc 11 §4 targets (Medium ≤ 5 s, Large ≤ 10 s). */
import { generateWorld, MAP_TILES, type MapSize } from '@crowns/sim';
declare const performance: { now(): number };

for (const size of Object.keys(MAP_TILES) as MapSize[]) {
  const t0 = performance.now();
  const world = generateWorld(1337, { size });
  const ms = performance.now() - t0;
  console.log(
    `${size.padEnd(6)} ${String(world.width).padStart(3)}² · ${ms.toFixed(0).padStart(5)} ms · land ${(world.stats.landFraction * 100).toFixed(1)}% · ${world.rivers.length} rivers`,
  );
}
