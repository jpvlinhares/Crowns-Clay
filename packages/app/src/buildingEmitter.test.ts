/** Territory/fog overlay emitter (M22) — mirrors RoadEmitter's add-only full()/delta() contract. */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DefinitionDatabase, BASE_CONTENT_FILES } from '@crowns/data';
import {
  Kernel,
  World,
  FogRegistry,
  registerVillageGameplay,
  registerPopulationGameplay,
  registerEconomyGameplay,
  registerKingdomGameplay,
  StatModifiers,
  type TerrainAccessor,
} from '@crowns/sim';
import { TerritoryEmitter } from './buildingEmitter.js';

const plain: TerrainAccessor = {
  width: 128,
  height: 128,
  tagsAt: () => ['open', 'farmable', 'mineable', 'woodland'],
  riverAt: () => false,
  movementCostAt: () => 1,
};

function makeTwoKingdoms() {
  const kernel = new Kernel(9);
  const world = new World(256);
  const db = DefinitionDatabase.load(BASE_CONTENT_FILES);
  const game = registerVillageGameplay(kernel, world, db, plain, { 'base:resource.wood': 200, 'base:resource.stone': 50 });
  const popGame = registerPopulationGameplay(kernel, world, db, game, { children: 2, adults: 5, elders: 1 });
  const econGame = registerEconomyGameplay(kernel, world, db, game);
  const kingdomGame = registerKingdomGameplay(kernel, world, db, game, popGame, econGame, new StatModifiers(), {
    kingdomCount: 2,
  });
  kernel.attachGuard(world);
  kernel.addHashSource('world', (fold) => world.hash(fold));

  kernel.registerSystem({
    name: 'genesis',
    period: 0x7fffffff,
    phase: 1,
    access: {
      writes: [
        game.comps.VillageCore, game.comps.VillageName, game.comps.Stockpile, game.comps.BuildingCore,
        popGame.Population, econGame.StockLimits,
        ...(kingdomGame.VillageOwner !== undefined ? [kingdomGame.VillageOwner] : []),
      ],
    },
    update(ctx) {
      const kingdomIds = kingdomGame.kingdomEntities();
      const stock = { 'base:resource.wood': 200, 'base:resource.stone': 50 };
      const ownerA = kingdomGame.VillageOwner !== undefined ? { component: kingdomGame.VillageOwner, kingdomId: kingdomIds[0] as never } : undefined;
      const ownerB = kingdomGame.VillageOwner !== undefined ? { component: kingdomGame.VillageOwner, kingdomId: kingdomIds[1] as never } : undefined;
      game.ops.found(ctx, 30, 30, 'A', stock, undefined, ownerA);
      game.ops.found(ctx, 90, 90, 'B', stock, undefined, ownerB);
    },
  });

  return { kernel, world, game, kingdomGame };
}

test('TerritoryEmitter: single-kingdom composition emits nothing (VillageOwner undefined)', () => {
  const kernel = new Kernel(1);
  const world = new World(64);
  const db = DefinitionDatabase.load(BASE_CONTENT_FILES);
  const game = registerVillageGameplay(kernel, world, db, plain, { 'base:resource.wood': 200 });
  const popGame = registerPopulationGameplay(kernel, world, db, game, { children: 1, adults: 2, elders: 0 });
  const econGame = registerEconomyGameplay(kernel, world, db, game);
  const kingdomGame = registerKingdomGameplay(kernel, world, db, game, popGame, econGame, new StatModifiers());
  assert.equal(kingdomGame.VillageOwner, undefined);

  const emitter = new TerritoryEmitter(world, game, kingdomGame, null);
  const full = emitter.full();
  assert.deepEqual(full.territory, []); // no VillageOwner component → nothing to tint
});

test('TerritoryEmitter: territory tints each kingdom\'s own tiles, fog reveals only the player\'s village', () => {
  const { kernel, world, game, kingdomGame } = makeTwoKingdoms();
  kernel.step(); // genesis: kingdoms + both villages founded

  const fog = new FogRegistry(() => world.queryWordCount);
  const emitter = new TerritoryEmitter(world, game, kingdomGame, fog);

  const full = emitter.full();
  assert.ok(full.territory.length > 0, 'expected some tinted territory tiles');
  const kingdomIndices = new Set<number>();
  for (let i = 0; i + 2 < full.territory.length; i += 3) kingdomIndices.add(full.territory[i + 2] as number);
  assert.deepEqual([...kingdomIndices].sort(), [0, 1]);

  // fog: only the player's own village (kingdom 0) is visible before any scouting reveal
  assert.equal(full.fogRevealed.length, 2); // one [x, y] pair
  assert.equal(full.fogRevealed[0], 30);
  assert.equal(full.fogRevealed[1], 30);

  // delta is empty once full() has already reported everything (nothing changed)
  const delta = emitter.delta();
  assert.deepEqual(delta.territoryAdded, []);
  assert.deepEqual(delta.fogRevealedAdded, []);

  // once kingdom 0 scouts kingdom 1's village
  const kingdomIds = kingdomGame.kingdomEntities();
  const owner = world.read(kingdomGame.VillageOwner as NonNullable<typeof kingdomGame.VillageOwner>);
  let villageBIndex = -1;
  world.query([game.comps.VillageCore]).forEach((vi) => {
    if ((owner.kingdom[vi] as number) === (kingdomIds[1] as number)) villageBIndex = vi;
  });
  assert.ok(villageBIndex >= 0);
  fog.reveal(0, villageBIndex);
  const delta2 = emitter.delta();
  assert.equal(delta2.fogRevealedAdded.length, 2);
});
