/**
 * Unified campaign composition (M47.6) — the doc 12 revision-R1 T objectives:
 *
 *   1. the full campaign boots headless (real worldgen, N kingdoms, full
 *      stack) and ticks deterministically;
 *   2. save → load → resave is hash-identical, AND a loaded session stays
 *      hash-identical to the uninterrupted original over a long resume —
 *      the stronger check, which catches any state a section forgot
 *      (fog was exactly such a state before this milestone);
 *   3. new-game options round-trip into the save header.
 *
 * The resume window deliberately crosses daily AND weekly cadences so every
 * AI system, the victory tracker, and the calendar all fire on both sides.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  composeCampaign,
  contentPersonalityWeights,
  difficultyFromSettings,
  victoryFromSettings,
  type ComposeCampaignOptions,
} from './campaign.js';
import { TICKS_PER_DAY } from './time.js';
import { FAIR_PRESET } from './ai/difficulty.js';
import { BASE_CONTENT_FILES, DefinitionDatabase } from '@crowns/data';
import type { CampaignSettings } from '@crowns/protocol';

const SETTINGS: CampaignSettings = {
  mapSize: 'small',
  kingdomCount: 3,
  difficulty: 'fair',
  victory: ['conquest', 'prosperity', 'chronicle'],
  defeatEnabled: true,
};

const SEED = 0xca47a;

function compose(): ReturnType<typeof composeCampaign> {
  const difficulty = difficultyFromSettings(SETTINGS);
  const options: ComposeCampaignOptions = {
    seed: SEED,
    kingdomCount: SETTINGS.kingdomCount,
    mapSize: SETTINGS.mapSize,
    ...(difficulty !== undefined ? { difficulty } : {}),
    victory: victoryFromSettings(SETTINGS),
    mods: { sources: [] },
    settings: SETTINGS,
    villageNameOf: (k) => (k === 0 ? 'Firstholm' : `Kingdom-${k}`),
  };
  return composeCampaign(options);
}

test('campaign boots on real worldgen: N kingdoms founded at fair sites, full stack registered', () => {
  const c = composeCampaign({
    seed: SEED,
    kingdomCount: 3,
    mapSize: 'small',
    // content personalities drive the AI kingdoms — the app path
    weightsOf: contentPersonalityWeights(DefinitionDatabase.load(BASE_CONTENT_FILES), SEED),
    mods: { sources: [] },
    settings: SETTINGS,
  });
  assert.ok(c.worldDef !== null, 'worldgen ran');
  assert.ok(c.terrainSnapshot !== null, 'terrain snapshot projected');
  assert.ok(c.modReport !== null, 'mod report present when composed with mods');
  c.kernel.step(); // genesis
  for (let k = 0; k < 3; k++) {
    assert.notEqual(c.villageOf(k), null, `kingdom ${k} founded a village`);
  }
  assert.ok(c.placement.variance <= 0.6, `placement variance sane (got ${c.placement.variance})`);
  // full stack present: a few spot checks that only exist when the whole game is wired
  assert.ok(c.kernel.commandTypes().includes('kingdom.declareWar'), 'war commands registered');
  assert.ok(c.kernel.commandTypes().includes('kingdom.setActiveResearch') || c.kernel.commandTypes().some((t) => t.startsWith('kingdom.')), 'kingdom commands registered');
  assert.equal(c.victoryGame.winner(), null);
  // run a month — daily & weekly systems all fire, nothing throws
  for (let t = 0; t < TICKS_PER_DAY * 30; t++) c.kernel.step();
});

test('campaign is deterministic: identical options ⇒ identical hashes', () => {
  const a = compose();
  const b = compose();
  for (let t = 0; t < TICKS_PER_DAY * 10; t++) {
    a.kernel.step();
    b.kernel.step();
  }
  assert.equal(a.kernel.stateHash(), b.kernel.stateHash());
});

test('save → load → resave is hash-identical, and a loaded session tracks the original exactly (R1 T objective)', () => {
  const original = compose();
  const SAVE_TICK = TICKS_PER_DAY * 12 + 7; // mid-day, mid-week: pending queues may be non-empty
  for (let t = 0; t < SAVE_TICK; t++) original.kernel.step();
  const save = original.saves.snapshot();

  // resave immediately from a hydrated session: identical hash, identical re-snapshot
  const loaded = compose();
  const migrations = loaded.saves.hydrate(JSON.parse(JSON.stringify(save)) as typeof save);
  assert.deepEqual(migrations, []);
  assert.equal(loaded.kernel.stateHash(), original.kernel.stateHash(), 'hash identical right after hydration');
  assert.deepEqual(loaded.saves.snapshot().sections, save.sections, 'resave sections byte-identical');

  // the stronger divergence check: resume BOTH for 20 more days, comparing along the way —
  // any state a section forgot (fog, pending wonders, engagements) shows up here
  for (let day = 0; day < 20; day++) {
    for (let t = 0; t < TICKS_PER_DAY; t++) {
      original.kernel.step();
      loaded.kernel.step();
    }
    assert.equal(
      loaded.kernel.stateHash(),
      original.kernel.stateHash(),
      `loaded session diverged from the uninterrupted original by day ${day + 1} after the save`,
    );
  }
});

test('new-game options round-trip into the save header (R1 T objective)', () => {
  const c = compose();
  c.kernel.step();
  const save = c.saves.snapshot();
  assert.deepEqual(save.header.campaign, SETTINGS);
  assert.equal(save.header.seed, SEED);
  // and the resolver helpers reproduce the exact composition inputs
  assert.equal(difficultyFromSettings(save.header.campaign), FAIR_PRESET);
  assert.deepEqual(victoryFromSettings(save.header.campaign), {
    enabled: ['conquest', 'prosperity', 'chronicle'],
    defeatEnabled: true,
  });
});
