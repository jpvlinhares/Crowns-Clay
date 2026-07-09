/**
 * Fog-of-information access control (M19 test objective: "AI reads only via
 * fog queries"). Two properties: (1) a fog-filtered query never yields an
 * entity a kingdom hasn't been shown, across many ticks and world growth;
 * (2) nothing under this directory bypasses the wrapper by calling
 * `world.query(` directly — the static check that makes (1) load-bearing
 * rather than incidental.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, sep } from 'node:path';

import { World } from '../ecs.js';
import { FogRegistry, fogQuery } from './fogQuery.js';

test('fogQuery: never returns an entity outside the known set, across many ticks', () => {
  const world = new World(64);
  const Village = world.defineSoA('village', { pop: 'u32' });
  const fog = new FogRegistry(() => world.queryWordCount);

  const home = world.spawn();
  world.attach(home, Village, { pop: 10 });
  const seenNeighbor = world.spawn();
  world.attach(seenNeighbor, Village, { pop: 20 });
  const hiddenNeighbor = world.spawn();
  world.attach(hiddenNeighbor, Village, { pop: 30 });

  const kingdomA = 1;
  const indices = world.query([Village]).collect(); // dense indices, in spawn order
  const [homeIdx, neighborIdx] = indices;
  fog.reveal(kingdomA, homeIdx as number);
  fog.reveal(kingdomA, neighborIdx as number);

  for (let tick = 0; tick < 50; tick++) {
    const seen = fogQuery(world, kingdomA, fog, [Village]).collect();
    assert.ok(seen.every((i) => i === homeIdx || i === neighborIdx));
    assert.ok(!seen.includes(indices[2] as number)); // hiddenNeighbor never leaks
  }
});

test('fogQuery: an unrevealed kingdom sees nothing', () => {
  const world = new World(64);
  const Village = world.defineSoA('village', { pop: 'u32' });
  world.attach(world.spawn(), Village, { pop: 10 });
  const fog = new FogRegistry(() => world.queryWordCount);
  assert.equal(fogQuery(world, 42, fog, [Village]).count(), 0);
});

test('fogQuery: bitset grows correctly alongside world entity capacity', () => {
  const world = new World(8); // tiny initial capacity — forces growth
  const Marker = world.defineSoA('marker', { tag: 'u8' });
  const fog = new FogRegistry(() => world.queryWordCount);
  const kingdom = 1;
  let last = 0;
  for (let n = 0; n < 200; n++) {
    const e = world.spawn();
    world.attach(e, Marker, { tag: 1 });
    last = n;
  }
  const indices = world.query([Marker]).collect();
  fog.reveal(kingdom, indices[last] as number);
  const seen = fogQuery(world, kingdom, fog, [Marker]).collect();
  assert.deepEqual(seen, [indices[last]]);
});

test('fogQuery: brain.ts (foreign-kingdom observation) never bypasses fogQuery to call world.query( directly', () => {
  // Tests run against compiled output (dist/); walk back to the .ts sources
  // so this check is meaningful regardless of where the test executes from.
  // Scoped to brain.ts specifically: that's the module whose contract is
  // "reads about OTHER kingdoms only through fog" (doc 07 §6). Files like
  // manager.ts/needs.ts (M20) read a kingdom's OWN village state, which
  // needs no fog by design — see docs/design/07-ai-design.md's M20 note.
  const here = dirname(fileURLToPath(import.meta.url)).replace(`${sep}dist${sep}`, `${sep}src${sep}`);
  const source = readFileSync(join(here, 'brain.ts'), 'utf8');
  assert.ok(!source.includes('world.query('));
});
