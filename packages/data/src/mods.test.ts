import { test } from 'node:test';
import assert from 'node:assert/strict';

import { satisfies, parseVersion, compareVersions } from './semver.js';
import { resolveLoadOrder, loadModLayers, parseModManifestPreview, type ModManifest, type ModSource } from './mods.js';
import { DefinitionDatabase, TERRAIN_KINDS } from './terrain.js';
import { BASE_CONTENT_FILES } from './generated/base-content.js';

// ---------------- semver ----------------

test('semver: parsing, comparison, ranges, caret', () => {
  assert.deepEqual(parseVersion('1.2.3'), [1, 2, 3]);
  assert.deepEqual(parseVersion('0.1'), [0, 1, 0]);
  assert.equal(parseVersion('nope'), null);
  assert.ok(compareVersions([1, 0, 0], [0, 9, 9]) > 0);

  assert.ok(satisfies('0.1.0', '>=0.1 <1.0'));
  assert.ok(!satisfies('1.0.0', '>=0.1 <1.0'));
  assert.ok(satisfies('2.5.1', '^2.0'));
  assert.ok(!satisfies('3.0.0', '^2.0'));
  assert.ok(satisfies('0.1.7', '^0.1'), 'caret on 0.x pins the minor');
  assert.ok(!satisfies('0.2.0', '^0.1'));
  assert.ok(satisfies('1.2.3', '=1.2.3') && satisfies('1.2.3', '1.2.3'));
  assert.ok(satisfies('1.2.4', '>1.2.3') && !satisfies('1.2.3', '>1.2.3'));
});

// ---------------- order resolution ----------------

const manifest = (id: string, extra: Partial<ModManifest> = {}): ModManifest => ({
  id,
  name: id,
  version: '1.0.0',
  gameVersion: '>=0.1',
  dependencies: [],
  loadAfter: [],
  conflicts: [],
  tags: [],
  authors: [],
  ...extra,
});

test('order: dependencies before dependents, loadAfter honored, user order breaks ties', () => {
  const { order, disabled } = resolveLoadOrder(
    [
      manifest('c', { loadAfter: ['b'] }),
      manifest('b', { dependencies: [{ id: 'a', version: '^1.0' }] }),
      manifest('a'),
      manifest('z'),
      manifest('y'),
    ],
    '0.1.0',
    ['z', 'y'], // user prefers z before y
  );
  assert.equal(disabled.size, 0);
  assert.ok(order.indexOf('a') < order.indexOf('b'), 'dependency first');
  assert.ok(order.indexOf('b') < order.indexOf('c'), 'loadAfter honored');
  assert.ok(order.indexOf('z') < order.indexOf('y'), 'user order breaks ties');
});

test('order: disable reasons — game version, missing/version-mismatched dep, cascade, conflict', () => {
  const { order, disabled } = resolveLoadOrder(
    [
      manifest('old', { gameVersion: '>=9.0' }),
      manifest('needsGhost', { dependencies: [{ id: 'ghost', version: '^1.0' }] }),
      manifest('needsOld', { dependencies: [{ id: 'old', version: '^1.0' }] }),
      manifest('picky', { dependencies: [{ id: 'lib', version: '^2.0' }] }),
      manifest('lib'), // 1.0.0
      manifest('warlike', { conflicts: ['lib'] }),
      manifest('fine'),
    ],
    '0.1.0',
  );
  assert.deepEqual(order.sort(), ['fine', 'lib']);
  assert.match((disabled.get('old') ?? []).join(), /requires game >=9\.0, running 0\.1\.0/);
  assert.match((disabled.get('needsGhost') ?? []).join(), /missing dependency 'ghost'/);
  assert.match((disabled.get('needsOld') ?? []).join(), /dependency 'old' is disabled/);
  assert.match((disabled.get('picky') ?? []).join(), /version 1\.0\.0 does not satisfy \^2\.0/);
  assert.match((disabled.get('warlike') ?? []).join(), /conflicts with enabled mod 'lib'/);
});

test('order: cycles disable every member with the chain named', () => {
  const { order, disabled } = resolveLoadOrder(
    [
      manifest('a', { loadAfter: ['b'] }),
      manifest('b', { loadAfter: ['a'] }),
      manifest('solo'),
    ],
    '0.1.0',
  );
  assert.deepEqual(order, ['solo']);
  assert.match((disabled.get('a') ?? []).join(), /dependency cycle: a → b|dependency cycle: b → a/);
  assert.ok(disabled.has('b'));
});

// ---------------- layering: override + patch ----------------

const modFiles = (id: string, files: Record<string, string>, extra = ''): ModSource => ({
  files: {
    'mod.json5': `{ "id": "${id}", "name": "${id}", "version": "1.0.0", "gameVersion": ">=0.1", "loadAfter": ["base"]${extra} }`,
    ...files,
  },
});

test('layers: base + override mod → later layer wins, report names the winner', () => {
  const override = modFiles('re-ocean', {
    'defs/terrain/ocean.json5': `[{
      "id": "base:terrain.ocean", "name": "Wine-Dark Sea", "biomeCode": 0,
      "colors": { "base": "#402038", "accent": "#381c30" },
      "movementCost": 0, "buildableTags": ["water"], "defenseBonus": 0, "tags": ["water"],
    }]`,
  });
  const { db, report } = DefinitionDatabase.loadMods([{ files: BASE_CONTENT_FILES }, override]);
  assert.equal(db.terrainById.get('base:terrain.ocean')?.name, 'Wine-Dark Sea');
  assert.equal(db.terrainById.get('base:terrain.ocean')?.colors.base, 0x402038);
  const conflict = report.overrides.find((o) => o.defId === 'base:terrain.ocean');
  assert.deepEqual(conflict, { defId: 'base:terrain.ocean', layers: ['base', 're-ocean'], winner: 're-ocean' });
  assert.deepEqual(report.order, ['base', 're-ocean']);
});

test('layers: patch ops (set / mergeAppend / remove) survive-upstream-style edits', () => {
  const patcher = modFiles('tint', {
    'patches/forest.json5': `[{
      "patch": "base:terrain.forest",
      "ops": [
        { "set": "colors.base", "value": "#204a20" },
        { "mergeAppend": "tags", "value": ["tint:autumnal", "tint:special"] },
        { "remove": "defenseBonus" },
        { "set": "defenseBonus", "value": 0.25 },
      ],
    }]`,
  });
  const { db, report } = DefinitionDatabase.loadMods([{ files: BASE_CONTENT_FILES }, patcher]);
  const forest = db.terrainById.get('base:terrain.forest');
  assert.equal(forest?.colors.base, 0x204a20);
  assert.deepEqual(forest?.tags, ['harvest-wood', 'tint:autumnal', 'tint:special']);
  assert.equal(forest?.defenseBonus, 0.25);
  assert.deepEqual(report.patched, [{ defId: 'base:terrain.forest', by: ['tint'] }]);
});

test('layers: patch failures are fatal and precise — missing target, bad path, bad op', () => {
  const broken = modFiles('bad', {
    'patches/p.json5': `[
      { "patch": "base:terrain.ghost", "ops": [{ "set": "x", "value": 1 }] },
      { "patch": "base:terrain.forest", "ops": [
        { "mergeAppend": "movementCost", "value": 1 },
        { "frobnicate": "x" },
      ] },
    ]`,
  });
  assert.throws(
    () => DefinitionDatabase.loadMods([{ files: BASE_CONTENT_FILES }, broken]),
    (e: unknown) =>
      e instanceof Error &&
      /patch target 'base:terrain\.ghost' does not exist/.test(e.message) &&
      /mergeAppend target 'movementCost' is not an array/.test(e.message) &&
      /unknown op \(use set \| mergeAppend \| remove\)/.test(e.message),
  );
});

test('layers: a patched def must still validate (merged-result validation)', () => {
  const saboteur = modFiles('sab', {
    'patches/p.json5': `[{ "patch": "base:terrain.forest", "ops": [{ "set": "movementCost", "value": -5 }] }]`,
  });
  assert.throws(
    () => DefinitionDatabase.loadMods([{ files: BASE_CONTENT_FILES }, saboteur]),
    /movementCost: -5 below minimum 0/,
  );
});

test('layers: disabled mods contribute nothing', () => {
  const tooNew = modFiles('future', {
    'defs/terrain/ocean.json5': `[{ "id": "base:terrain.ocean", "name": "NOPE", "biomeCode": 0,
      "colors": { "base": "#000000", "accent": "#000000" },
      "movementCost": 0, "buildableTags": [], "defenseBonus": 0, "tags": [] }]`,
  });
  const files = { ...tooNew.files, 'mod.json5': (tooNew.files['mod.json5'] ?? '').replace('>=0.1', '>=9.0') };
  const { db, report } = DefinitionDatabase.loadMods([{ files: BASE_CONTENT_FILES }, { files }]);
  assert.equal(db.terrainById.get('base:terrain.ocean')?.name, 'Ocean');
  assert.match(report.disabled.find((d) => d.id === 'future')?.reasons.join() ?? '', /requires game >=9\.0/);
});

test('loadModLayers: generic kinds API round-trips', () => {
  const { defs } = loadModLayers([{ files: BASE_CONTENT_FILES }], TERRAIN_KINDS);
  assert.equal((defs.get('terrain') as Map<string, unknown>).size, 10);
  assert.equal((defs.get('overlay') as Map<string, unknown>).size, 2);
});

// ---------------- manifest (M39; doc 09 §5 save embedding) ----------------

test('manifest: one entry per enabled layer, in order, with a stable content hash', () => {
  const patcher = modFiles('tint', {
    'patches/forest.json5': `[{ "patch": "base:terrain.forest", "ops": [{ "set": "defenseBonus", "value": 0.3 }] }]`,
  });
  const { report } = DefinitionDatabase.loadMods([{ files: BASE_CONTENT_FILES }, patcher]);
  assert.deepEqual(report.manifest.map((m) => m.modId), ['base', 'tint']);
  const tint = report.manifest.find((m) => m.modId === 'tint');
  assert.equal(tint?.version, '1.0.0');
  assert.equal(typeof tint?.hash, 'number');

  // same files, same hash — content hashing is deterministic, not run-order dependent
  const { report: again } = DefinitionDatabase.loadMods([{ files: BASE_CONTENT_FILES }, patcher]);
  assert.equal(again.manifest.find((m) => m.modId === 'tint')?.hash, tint?.hash);

  // editing a file (a "rebalance" that doesn't bump version) changes the hash
  const rebalanced = modFiles('tint', {
    'patches/forest.json5': `[{ "patch": "base:terrain.forest", "ops": [{ "set": "defenseBonus", "value": 0.9 }] }]`,
  });
  const { report: changed } = DefinitionDatabase.loadMods([{ files: BASE_CONTENT_FILES }, rebalanced]);
  assert.notEqual(changed.manifest.find((m) => m.modId === 'tint')?.hash, tint?.hash);
});

test('parseModManifestPreview: identifies a mod without running the full pipeline; null on garbage', () => {
  const preview = parseModManifestPreview(modFiles('preview-me', {}).files);
  assert.deepEqual(preview, { id: 'preview-me', name: 'preview-me', version: '1.0.0', tags: [] });
  assert.equal(parseModManifestPreview({}), null, 'no mod.json5');
  assert.equal(parseModManifestPreview({ 'mod.json5': '{ not json5 ]' }), null, 'malformed');
});

// ---------------- shipped sample third-party mod (M39 T objective) ----------------

test('example mod: march-wardens (third-party, authored from docs/modding/* alone) stacks with autumn-realm', async () => {
  const { EXAMPLE_MOD_FILES } = await import('./generated/base-content.js');
  const autumn = EXAMPLE_MOD_FILES['autumn-realm'];
  const wardens = EXAMPLE_MOD_FILES['march-wardens'];
  assert.ok(autumn !== undefined && wardens !== undefined, 'both example mods embedded');
  const { db, report } = DefinitionDatabase.loadMods([
    { files: BASE_CONTENT_FILES },
    { files: autumn },
    { files: wardens },
  ]);
  assert.deepEqual(report.order, ['base', 'example:autumn-realm', 'frontier:march-wardens'], 'loadAfter honored');
  assert.equal(report.disabled.length, 0);

  // new content (doc 03): a building neither base nor autumn-realm defines
  assert.ok(db.buildings.has('frontier:building.watchtower'));

  // both third-party mods patch the SAME def, different fields — composes, doesn't collide (doc 04/05)
  const forestPatchers = report.patched.find((p) => p.defId === 'base:terrain.forest');
  assert.deepEqual(forestPatchers?.by, ['example:autumn-realm', 'frontier:march-wardens']);
  const forest = db.terrainById.get('base:terrain.forest');
  assert.equal(forest?.defenseBonus, 0.2, "march-wardens' patch applied");
  assert.ok(forest?.tags.includes('example:autumnal') && forest.tags.includes('frontier:watched'), 'both patches’ tags present');

  assert.equal(report.manifest.length, 3);
});

// ---------------- shipped example mod stays loadable (living documentation) ----------------

test('example mod: autumn-realm layers onto base — override + patches verified', async () => {
  const { EXAMPLE_MOD_FILES } = await import('./generated/base-content.js');
  const autumn = EXAMPLE_MOD_FILES['autumn-realm'];
  assert.ok(autumn !== undefined, 'example mod embedded');
  const { db, report } = DefinitionDatabase.loadMods([{ files: BASE_CONTENT_FILES }, { files: autumn }]);
  assert.deepEqual(report.order, ['base', 'example:autumn-realm']);
  assert.equal(db.terrainById.get('base:terrain.marsh')?.name, 'Peat Bog', 'override applied');
  assert.equal(db.terrainById.get('base:terrain.forest')?.colors.base, 0x8a5a28, 'patch applied');
  assert.ok(db.terrainById.get('base:terrain.forest')?.tags.includes('example:autumnal'));
  assert.equal(db.terrainById.get('base:terrain.forest')?.movementCost, 1.6, 'patch left gameplay fields tracking base');
  assert.equal(report.disabled.length, 0);
});
