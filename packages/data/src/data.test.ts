import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseJson5Subset, v, formatErrors, type ValidationError } from './validate.js';
import { DefinitionDatabase } from './terrain.js';
import { BASE_CONTENT_FILES } from './generated/base-content.js';

// ---------------- parser ----------------

test('json5-subset: comments and trailing commas stripped, strings protected', () => {
  const src = `{
    // line comment with , and } inside
    "url": "http://x.test/a,b", /* block , } comment */
    "list": [1, 2, 3,],
    "quote": "not // a comment, honest",
    "esc": "say \\"hi\\", ok",
  }`;
  const parsed = parseJson5Subset('t.json5', src) as Record<string, unknown>;
  assert.equal(parsed['url'], 'http://x.test/a,b');
  assert.deepEqual(parsed['list'], [1, 2, 3]);
  assert.equal(parsed['quote'], 'not // a comment, honest');
  assert.equal(parsed['esc'], 'say "hi", ok');
});

test('json5-subset: parse failures carry the file name', () => {
  assert.throws(() => parseJson5Subset('broken.json5', '{ nope }'), /broken\.json5/);
});

// ---------------- validators ----------------

test('validators: path-precise readable errors', () => {
  const errors: ValidationError[] = [];
  const schema = v.object({
    id: v.id(),
    colors: v.object({ base: v.color() }),
    cost: v.number({ min: 0 }),
  });
  schema({ id: 'BadId', colors: { base: 42 }, cost: -1, extra: true }, '', errors, 'f.json5');
  const text = formatErrors(errors);
  assert.match(text, /f\.json5 \.id: expected namespaced id/);
  assert.match(text, /\.colors\.base: expected #rrggbb color/);
  assert.match(text, /\.cost: -1 below minimum 0/);
  assert.match(text, /\.extra: unknown field/);
  assert.equal(errors.length, 4);
});

test('validators: optional fields and literals', () => {
  const errors: ValidationError[] = [];
  const schema = v.object({ kind: v.literal('river', 'lake'), note: v.string() }, { optional: ['note'] });
  const ok = schema({ kind: 'lake' }, '', errors, 'f');
  assert.equal(errors.length, 0);
  assert.equal(ok.kind, 'lake');
  schema({ kind: 'swamp' }, '', errors, 'f');
  assert.match(formatErrors(errors), /expected one of river \| lake/);
});

// ---------------- definition database ----------------

test('mod zero: loads, covers every biome code exactly once, both overlays', () => {
  const db = DefinitionDatabase.load(BASE_CONTENT_FILES);
  assert.equal(db.terrainByCode.length, 10);
  for (let code = 0; code < 10; code++) {
    assert.equal(db.terrainByCode[code]?.biomeCode, code);
  }
  assert.equal(db.terrainById.get('base:terrain.forest')?.movementCost, 1.6);
  assert.equal(db.overlays.get('river')?.color, 0x4a86b0);
});

test('integrity: duplicate biome code and missing coverage are fatal with named ids', () => {
  const files = {
    'mod.json5': `{ "id": "x", "name": "X", "version": "1.0.0", "gameVersion": ">=0.1" }`,
    'defs/terrain/bad.json5': `[
      { "id": "x:terrain.a", "name": "A", "biomeCode": 0,
        "colors": { "base": "#000000", "accent": "#000000" },
        "movementCost": 1, "buildableTags": [], "defenseBonus": 0, "tags": [] },
      { "id": "x:terrain.b", "name": "B", "biomeCode": 0,
        "colors": { "base": "#000000", "accent": "#000000" },
        "movementCost": 1, "buildableTags": [], "defenseBonus": 0, "tags": [] },
    ]`,
    'defs/overlays/w.json5': `[
      { "id": "x:overlay.r", "kind": "river", "color": "#000000" },
      { "id": "x:overlay.l", "kind": "lake", "color": "#000000" },
    ]`,
  };
  assert.throws(
    () => DefinitionDatabase.load(files),
    (e: unknown) =>
      e instanceof Error &&
      /biome code 0 claimed by both 'x:terrain\.a' and 'x:terrain\.b'/.test(e.message) &&
      /biome code 1 has no terrain def/.test(e.message),
  );
});

test('validation failures are fatal and readable', () => {
  const files = {
    'mod.json5': `{ "id": "x", "name": "X", "version": "1.0.0", "gameVersion": ">=0.1" }`,
    'defs/terrain/bad.json5': `[{ "id": "x:terrain.a", "name": "", "biomeCode": 99,
      "colors": { "base": "nope", "accent": "#000000" },
      "movementCost": 1, "buildableTags": [], "defenseBonus": 0, "tags": [] }]`,
  };
  assert.throws(
    () => DefinitionDatabase.load(files),
    (e: unknown) =>
      e instanceof Error &&
      /x:defs\/terrain\/bad\.json5 \.name: string shorter than 1/.test(e.message) &&
      /\.biomeCode: 99 above maximum 9/.test(e.message) &&
      /\.colors\.base: expected #rrggbb/.test(e.message),
  );
});

// ---------------- audio: loudness lints (roadmap M41 T objective) ----------------

test('audio: the loudness-lint gate rejects a cue/playlist gain outside the safe band', () => {
  const files = {
    'mod.json5': `{ "id": "x", "name": "X", "version": "1.0.0", "gameVersion": ">=0.1" }`,
    'defs/cues/bad.json5': `[{ "id": "x:cue.a", "name": "A", "event": "village.founded",
      "bus": "worldSfx", "gain": 0.99, "waveform": "sine", "frequencyHz": 440,
      "durationMs": 200, "placeholder": true, "tags": [] }]`,
    'defs/playlists/bad.json5': `[{ "id": "x:playlist.a", "name": "A", "tension": "calm",
      "gain": 0.0, "trackIds": ["t"], "placeholder": true, "tags": [] }]`,
  };
  assert.throws(
    () => DefinitionDatabase.load(files),
    (e: unknown) =>
      e instanceof Error &&
      /x:defs\/cues\/bad\.json5 \.gain: 0\.99 above maximum 0\.85/.test(e.message) &&
      /x:defs\/playlists\/bad\.json5 \.gain: 0 below minimum 0\.05/.test(e.message),
  );
});

test('audio: base content ships cues/playlists wired to real events, all within the loudness-lint band', async () => {
  const { LOUDNESS_MIN_GAIN, LOUDNESS_MAX_GAIN } = await import('./audio.js');
  const db = DefinitionDatabase.load(BASE_CONTENT_FILES);
  assert.ok(db.audioCues.size > 0, 'base ships at least one SFX cue');
  assert.ok(db.musicPlaylists.size > 0, 'base ships at least one music playlist');
  for (const cue of db.audioCues.values()) {
    assert.ok(
      cue.gain >= LOUDNESS_MIN_GAIN && cue.gain <= LOUDNESS_MAX_GAIN,
      `${cue.id} gain ${cue.gain} outside the loudness-lint band`,
    );
    assert.ok(cue.event.length > 0, `${cue.id} must map to a real GameEvent type`);
  }
  for (const playlist of db.musicPlaylists.values()) {
    assert.ok(
      playlist.gain >= LOUDNESS_MIN_GAIN && playlist.gain <= LOUDNESS_MAX_GAIN,
      `${playlist.id} gain ${playlist.gain} outside the loudness-lint band`,
    );
  }
  // every tension state has at least a universal (no era/season) playlist — never a silent gap
  for (const tension of ['calm', 'tense', 'combat'] as const) {
    assert.ok(
      [...db.musicPlaylists.values()].some((p) => p.tension === tension && p.era === undefined && p.season === undefined),
      `no universal playlist for tension '${tension}'`,
    );
  }
});

// ---------------- tutorial content (roadmap M43) ----------------

test('tutorial: base content ships exactly 6 once-only steps in the tutorial pool, ending at village.tier ≥ 2', () => {
  const db = DefinitionDatabase.load(BASE_CONTENT_FILES);
  const tutorial = [...db.events.values()].filter((e) => e.pool === 'tutorial');
  assert.equal(tutorial.length, 6);
  for (const step of tutorial) {
    assert.ok(step.tags.includes('tutorial'), `${step.id} should carry the 'tutorial' tag too`);
    assert.equal(step.once, true, `${step.id} must be once:true — a tutorial step repeating is a bug`);
    assert.ok(step.choices.length >= 1, `${step.id} needs at least one choice (doc 09 §4 EventChoice)`);
    for (const choice of step.choices) assert.ok(choice.text.length > 0);
  }
  const completion = db.events.get('base:event.tutorial.complete');
  assert.deepEqual(completion?.trigger, { stat: 'village.tier', gte: 2 }, "the SC-1 completion signal is real progress, not a stand-in");
});
