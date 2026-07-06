/**
 * ASCII worldgen preview (M7): renders a generated map to the terminal for
 * instant inspection of continents, climate bands, and river courses.
 *
 *   node packages/tools/dist/worldgen-preview.js [seed] [size] [landmass]
 */
import { generateWorld, worldHash, Biome, BIOME_NAMES, RiverMark, type MapSize, type LandmassStyle } from '@crowns/sim';

const seed = Number(process.argv[2] ?? 42) | 0;
const size = (process.argv[3] ?? 'medium') as MapSize;
const landmass = (process.argv[4] ?? 'continent') as LandmassStyle;

const world = generateWorld(seed, { size, landmass });

const GLYPH: Record<number, string> = {
  [Biome.Ocean]: '~',
  [Biome.Coast]: '-',
  [Biome.Plains]: '.',
  [Biome.Grassland]: ',',
  [Biome.Forest]: 'T',
  [Biome.Hills]: 'n',
  [Biome.Mountains]: '^',
  [Biome.Tundra]: ':',
  [Biome.Snow]: '*',
  [Biome.Marsh]: '%',
};

const COLS = 110;
const step = Math.max(1, Math.round(world.width / COLS));
const lines: string[] = [];
for (let y = 0; y < world.height; y += step * 2) {
  let line = '';
  for (let x = 0; x < world.width; x += step) {
    const i = y * world.width + x;
    line +=
      (world.layers.river[i] as number) !== RiverMark.None
        ? 'r'
        : (GLYPH[world.layers.biome[i] as number] ?? '?');
  }
  lines.push(line);
}
console.log(lines.join('\n'));

const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;
console.log(`\nseed ${seed} · ${size} (${world.width}²) · ${landmass} · hash 0x${worldHash(world).toString(16)}`);
console.log(`land ${pct(world.stats.landFraction)} · rivers ${world.rivers.length} (${world.stats.riverTiles} tiles, endings: ${world.rivers.map((r) => r.endsIn[0]).join('')})`);
console.log(
  world.stats.biomeCounts
    .map((count, id) => `${BIOME_NAMES[id]} ${pct(count / (world.width * world.height))}`)
    .join(' · '),
);
