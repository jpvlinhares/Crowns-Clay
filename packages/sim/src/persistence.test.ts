/**
 * Save/load v1 (M17) — the roadmap test objective is "save → load → resave
 * hash-identical" (doc 12; TDD §8): a hydrated session must carry the EXACT
 * state hash of the session it was saved from, resaving must reproduce the
 * byte-identical save, and both sessions must then evolve in lockstep —
 * through walking settlers, laden haulers, courts, edicts, and roads. The
 * migration chain and codec guards are exercised too. The committed corpus
 * (TDD §13) lives in fixtures/saves/ and is verified from @crowns/tools.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DefinitionDatabase, BASE_CONTENT_FILES, type ModManifestEntry } from '@crowns/data';
import { Kernel } from './kernel.js';
import { World } from './ecs.js';
import { TICKS_PER_DAY } from './time.js';
import { SaveManager, kernelSection, worldSection, reconcileModManifest, modReconciliationHasFindings } from './persistence.js';
import { registerVillageGameplay, type TerrainAccessor } from './game/villages.js';
import { registerPopulationGameplay } from './game/population.js';
import { registerEconomyGameplay } from './game/economy.js';
import { registerLogisticsGameplay } from './game/logistics.js';
import { registerSettlerGameplay } from './game/settlers.js';
import { registerKingdomGameplay, StatModifiers } from './game/kingdom.js';

const plain: TerrainAccessor = {
  width: 64,
  height: 64,
  tagsAt: () => ['open', 'farmable', 'mineable', 'woodland'],
  riverAt: () => false,
  movementCostAt: () => 1,
};

/** The full Phase-2 stack — every module that owns saveable state. */
function makeRealm(seed = 53) {
  const kernel = new Kernel(seed);
  const world = new World(512);
  const db = DefinitionDatabase.load(BASE_CONTENT_FILES);
  const stock = { 'base:resource.wood': 600, 'base:resource.stone': 300, 'base:resource.food': 250 };
  const mods = new StatModifiers();
  const game = registerVillageGameplay(kernel, world, db, plain, stock);
  const popGame = registerPopulationGameplay(kernel, world, db, game, { children: 20, adults: 60, elders: 8 }, mods);
  const econ = registerEconomyGameplay(kernel, world, db, game, mods);
  const Position = world.defineSoA('position', { x: 'f64', y: 'f64' });
  const logi = registerLogisticsGameplay(kernel, world, db, game, popGame, econ, Position);
  const settlers = registerSettlerGameplay(kernel, world, db, game, popGame, econ, logi, Position);
  const kingdom = registerKingdomGameplay(kernel, world, db, game, popGame, econ, mods);
  kernel.attachGuard(world);
  kernel.addHashSource('world', (fold) => world.hash(fold)); // logistics already registered 'roads'

  const saves = new SaveManager(kernel);
  saves.register(kernelSection(kernel));
  saves.register(worldSection(world));
  saves.register({
    key: 'roads',
    version: 1,
    save: () => logi.roads.list(),
    load: (data) => logi.roads.restore(data as number[]),
  });
  saves.afterLoad(() => {
    game.ops.rebuildDerived();
    kingdom.refreshAfterLoad();
  });

  const submit = (type: string, payload: unknown): void => {
    kernel.submit({ type, issuer: 1, payload });
    kernel.step();
  };
  const days = (n: number): void => {
    for (let t = 0; t < n * TICKS_PER_DAY; t++) kernel.step();
  };
  return { kernel, world, db, game, popGame, econ, logi, settlers, kingdom, mods, saves, submit, days };
}

/** Drive a realm into a deliberately messy mid-flight state. */
function liveIn(r: ReturnType<typeof makeRealm>): number {
  r.submit('village.found', { x: 40, y: 30, name: 'Saveton' });
  let villageId = -1;
  r.world.query([r.popGame.Population]).forEach((_i, e) => (villageId = e as number));
  r.submit('village.build', { villageId, def: 'base:building.farm', x: 36, y: 27 });
  r.submit('village.build', { villageId, def: 'base:building.sawmill', x: 44, y: 32 });
  r.submit('village.build', { villageId, def: 'base:building.house', x: 37, y: 32 });
  // a granary: food storage beyond the keep's 50-food larder (M-era) — needed to hold
  // the cargo a settler party carries (SETTLER_CARRY food) before it can be dispatched
  r.submit('village.build', { villageId, def: 'base:building.granary', x: 40, y: 33 });
  r.submit('village.buildRoad', { villageId, x: 42, y: 30 });
  r.submit('village.buildRoad', { villageId, x: 43, y: 30 });
  r.days(12); // build out, staff up, haul
  r.submit('kingdom.enactEdict', { edict: 'base:edict.corvee-labor' });
  let advisor = -1;
  r.world.query([r.kingdom.Character]).forEach((_i, e) => {
    if (advisor < 0) advisor = e as number;
  });
  r.submit('kingdom.appoint', { office: 'steward', characterId: advisor });
  r.submit('village.setTaxRate', { villageId, rate: 3 });
  r.days(3);
  // a settler party CAUGHT MID-WALK by the save
  r.submit('village.sendSettlers', { villageId, x: 12, y: 30, name: 'Loadstead' });
  for (let t = 0; t < 10; t++) r.kernel.step();
  return villageId;
}

// ---------------- the T objective ----------------

test('save→load→resave: hash-identical, byte-identical, then lockstep forever after', () => {
  const original = makeRealm();
  liveIn(original);
  const saved = original.saves.snapshot();
  const savedJson = JSON.stringify(saved);
  const hashAtSave = original.kernel.stateHash();

  // hydrate a FRESH session composed from the same seed
  const loaded = makeRealm();
  const report = loaded.saves.hydrate(JSON.parse(savedJson) as typeof saved);
  assert.deepEqual(report, [], 'current-version save needs no migrations');
  assert.equal(loaded.kernel.currentTick, original.kernel.currentTick, 'tick restored');
  assert.equal(loaded.kernel.stateHash(), hashAtSave, 'LOAD: state hash identical');

  // resave: byte-identical
  assert.equal(JSON.stringify(loaded.saves.snapshot()), savedJson, 'RESAVE: byte-identical');

  // both sessions evolve in lockstep — settlers arrive, edicts bill, advisors earn
  for (let day = 0; day < 10; day++) {
    original.days(1);
    loaded.days(1);
    assert.equal(loaded.kernel.stateHash(), original.kernel.stateHash(), `lockstep broke on day ${day + 1}`);
  }
  // the mid-walk party landed in both worlds
  const villages = (r: ReturnType<typeof makeRealm>): number => {
    let n = 0;
    r.world.query([r.game.comps.VillageCore]).forEach(() => n++);
    return n;
  };
  assert.equal(villages(loaded), 2, 'the saved settler party founded after load');
  assert.equal(villages(original), villages(loaded));
});

test('save→load: post-load commands go through rebuilt derived state', () => {
  const original = makeRealm();
  const villageId = liveIn(original);
  const savedJson = JSON.stringify(original.saves.snapshot());

  const loaded = makeRealm();
  loaded.saves.hydrate(JSON.parse(savedJson) as ReturnType<SaveManager['snapshot']>);

  // occupancy rebuilt: placing on the farm's tiles rejects; a fresh spot works
  const rejections: string[] = [];
  loaded.kernel.subscribe<{ what: string; reason: string }>('village.rejected', (e) => rejections.push(e.data.reason));
  loaded.submit('village.build', { villageId, def: 'base:building.house', x: 36, y: 27 });
  assert.ok(rejections.some((m) => m.includes('occupied')), 'occupancy survived the load');
  loaded.submit('village.build', { villageId, def: 'base:building.house', x: 33, y: 33 });
  assert.ok(!rejections.some((m) => m.includes('(33, 33)')), 'fresh ground still builds');

  // the modifier board was rebuilt: corvée is still ×1.15
  assert.ok(Math.abs(loaded.mods.mul('village.productionEfficiency') - 1.15) < 1e-9, 'edict modifiers rebuilt');
  // treasury API re-bound to the loaded kingdom entity
  assert.ok(loaded.kingdom.treasury() > 0, 'kingdom re-bound');
});

// ---------------- migration chain ----------------

test('migrations: an old section payload is lifted step by step, in order', () => {
  const kernel = new Kernel(1);
  const saves = new SaveManager(kernel);
  let loadedData: unknown;
  saves.register({
    key: 'thing',
    version: 3,
    save: () => ({ c: 3 }),
    load: (data) => (loadedData = data),
  });
  saves.registerMigration('thing', 1, (d) => ({ b: (d as { a: number }).a + 1 }));
  saves.registerMigration('thing', 2, (d) => ({ c: (d as { b: number }).b + 1 }));

  const save = saves.snapshot();
  save.sections['thing'] = { version: 1, data: { a: 1 } }; // simulate an old save
  const report = saves.hydrate(save);
  assert.deepEqual(loadedData, { c: 3 }, 'v1 → v2 → v3 chain applied');
  assert.deepEqual(report, ['thing: migrated v1 → v2', 'thing: migrated v2 → v3']);

  // a hole in the chain is a hard, named error
  const saves2 = new SaveManager(new Kernel(1));
  saves2.register({ key: 'thing', version: 3, save: () => 0, load: () => undefined });
  const stale = saves2.snapshot();
  stale.sections['thing'] = { version: 1, data: {} };
  assert.throws(() => saves2.hydrate(stale), /no migration for section 'thing' v1/);
});

// ---------------- guards ----------------

test('guards: wrong seed, wrong format, and missing sections refuse loudly', () => {
  const original = makeRealm();
  liveIn(original);
  const save = original.saves.snapshot();

  const wrongSeed = makeRealm(99);
  assert.throws(() => wrongSeed.saves.hydrate(save), /save seed 53 ≠ session seed 99/);

  const loaded = makeRealm();
  const wrongFormat = JSON.parse(JSON.stringify(save)) as typeof save;
  (wrongFormat.header as { format: number }).format = 999;
  assert.throws(() => loaded.saves.hydrate(wrongFormat), /save format v999 unsupported/);

  const missing = JSON.parse(JSON.stringify(save)) as typeof save;
  delete missing.sections['roads'];
  assert.throws(() => loaded.saves.hydrate(missing), /missing section 'roads'/);
});

// ---------------- mod-set embedding & reconciliation (M39; OQ-4) ----------------

test('SaveManager: the active mod set travels in the header, never blocking hydrate', () => {
  const r = makeRealm();
  const manifest: ModManifestEntry[] = [{ modId: 'base', version: '0.1.0', hash: 123 }];
  r.saves.setModManifest(manifest);
  const save = r.saves.snapshot();
  assert.deepEqual(save.header.modManifest, manifest);
  assert.deepEqual(r.saves.getModManifest(), manifest);

  // hydrating a session whose installed manifest DIFFERS from the save's still succeeds —
  // reconciliation is a separate, informational step (OQ-4: best-effort, never blocking)
  const loaded = makeRealm();
  loaded.saves.setModManifest([{ modId: 'base', version: '9.9.9', hash: 999 }]);
  assert.doesNotThrow(() => loaded.saves.hydrate(save));
});

test('reconcileModManifest: missing, added, version-changed, content-changed, and the clean case', () => {
  const a: ModManifestEntry = { modId: 'a', version: '1.0.0', hash: 111 };
  const b: ModManifestEntry = { modId: 'b', version: '1.0.0', hash: 222 };

  const clean = reconcileModManifest([a, b], [a, b]);
  assert.deepEqual(clean, { missing: [], added: [], versionChanged: [], contentChanged: [] });
  assert.equal(modReconciliationHasFindings(clean), false);

  const bGone = reconcileModManifest([a, b], [a]);
  assert.deepEqual(bGone.missing, [b]);
  assert.equal(modReconciliationHasFindings(bGone), true);

  const cAdded: ModManifestEntry = { modId: 'c', version: '1.0.0', hash: 333 };
  const added = reconcileModManifest([a], [a, cAdded]);
  assert.deepEqual(added.added, [cAdded]);
  assert.equal(modReconciliationHasFindings(added), false, 'a purely-additional mod is not a finding');

  const bBumped: ModManifestEntry = { modId: 'b', version: '2.0.0', hash: 222 };
  const versionChanged = reconcileModManifest([a, b], [a, bBumped]);
  assert.deepEqual(versionChanged.versionChanged, [{ saved: b, installed: bBumped }]);

  const bRebalanced: ModManifestEntry = { modId: 'b', version: '1.0.0', hash: 999 };
  const contentChanged = reconcileModManifest([a, b], [a, bRebalanced]);
  assert.deepEqual(contentChanged.contentChanged, [{ saved: b, installed: bRebalanced }]);

  // pre-M39 saves have no modManifest at all — treated as empty, never crashes
  const noBaseline = reconcileModManifest(undefined, [a, b]);
  assert.deepEqual(noBaseline, { missing: [], added: [a, b], versionChanged: [], contentChanged: [] });
  assert.equal(modReconciliationHasFindings(noBaseline), false);
});
