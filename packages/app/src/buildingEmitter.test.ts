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
  INERT_MODIFIERS,
  BASE_STORAGE,
  KEEP_FOOD_BUFFER,
  JOY_NEUTRAL,
  TICKS_PER_DAY,
  type TerrainAccessor,
} from '@crowns/sim';
import { TerritoryEmitter, BuildingEmitter, VillageStatsEmitter } from './buildingEmitter.js';

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

test('BuildingEmitter + VillageStatsEmitter: capacity is projected from defs and live state (M-era)', () => {
  const kernel = new Kernel(3);
  const world = new World(128);
  const db = DefinitionDatabase.load(BASE_CONTENT_FILES);
  const game = registerVillageGameplay(kernel, world, db, plain, {
    'base:resource.wood': 500, 'base:resource.stone': 200, 'base:resource.food': 100,
  });
  const popGame = registerPopulationGameplay(kernel, world, db, game, { children: 0, adults: 20, elders: 0 });
  registerEconomyGameplay(kernel, world, db, game);
  kernel.attachGuard(world);

  const submit = (type: string, payload: unknown): void => { kernel.submit({ type, issuer: 1, payload }); kernel.step(); };
  submit('village.found', { x: 40, y: 40, name: 'Cap' });
  let vid = -1;
  world.query([popGame.Population]).forEach((_i, e) => (vid = e as number));

  const placeNear = (defId: string): void => {
    const def = db.buildings.get(defId);
    assert.ok(def);
    for (let r = 2; r <= 10; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      if (!game.ops.validatePlacement(def, 40 + dx, 40 + dy, vid as never).ok) continue;
      submit('village.build', { villageId: vid, def: defId, x: 40 + dx, y: 40 + dy });
      return;
    }
    assert.fail(`no spot for ${defId}`);
  };
  placeNear('base:building.house');   // housing.capacity 5
  placeNear('base:building.granary'); // storage.capacity 400
  for (let t = 0; t < 6 * TICKS_PER_DAY; t++) kernel.step(); // let both finish construction

  // BuildingEmitter surfaces each def's own capacity contribution, generically.
  const recs = new BuildingEmitter(world, game).full();
  const house = recs.find((r) => r.name === 'House');
  const granary = recs.find((r) => r.name === 'Granary');
  assert.equal(house?.housingCapacity, 5, 'house projects its housing capacity');
  assert.equal(house?.storageCapacity, 0, 'a house has no storage capacity');
  assert.equal(granary?.storageCapacity, 400, 'granary projects its storage capacity');

  // VillageStatsEmitter surfaces the POOLED village totals used for the used/total gauges.
  // single-kingdom stub: no VillageOwner ⇒ every village reads as owned (the 1.x owned flag)
  const soloKingdom = { VillageOwner: undefined, kingdomEntities: () => [] } as unknown as import('@crowns/sim').KingdomGameplay;
  const stats = new VillageStatsEmitter(world, game, popGame.Population, db, INERT_MODIFIERS, soloKingdom).delta();
  const v = stats.find((s) => s.name === 'Cap');
  assert.ok(v, 'village stats emitted');
  assert.equal(v.housing, 5, 'village housing total = Σ completed housing capacity');
  assert.equal(v.stockCap, BASE_STORAGE + 400, 'village stock cap = BASE_STORAGE + Σ completed storage capacity');
  assert.equal(v.foodCap, KEEP_FOOD_BUFFER + 400, 'food cap = keep buffer + granary capacity (smaller base than other goods)');

  // Joy breakdown is projected from live state (M-era): food + shelter factors present,
  // level in range, neutral pivot exposed, and the population effect surfaced.
  assert.ok(v.joy, 'joy breakdown emitted');
  assert.equal(v.joy.neutral, JOY_NEUTRAL);
  assert.ok(v.joy.level >= 0 && v.joy.level <= 100, 'joy level in 0..100');
  const labels = v.joy.factors.map((f) => f.label);
  assert.deepEqual(labels.slice(0, 2), ['Food', 'Shelter'], 'food and shelter are the base drivers');
  // no active edicts and no joy auras here → only the two base factors
  assert.equal(v.joy.factors.length, 2, 'no service auras or edicts → just food + shelter');
  assert.equal(typeof v.joy.migrationPerDay, 'number');
  assert.ok(v.joy.fertility >= 0 && v.joy.fertility <= 2, 'fertility multiplier in 0..2');
});

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
