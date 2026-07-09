/**
 * Multiple kingdoms & borders (M22) — roadmap test objective: "fairness
 * variance ≤ ±15%; fog UI". Covers the fairness algorithm directly, the
 * per-kingdom AI wiring (M20/M21 reused), and the scouting fog-reveal
 * mechanism (tested standalone, since fairly-placed kingdoms are — by
 * design — usually too far apart to see each other from genesis).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DefinitionDatabase, BASE_CONTENT_FILES } from '@crowns/data';
import { registerVillageGameplay } from '../game/villages.js';
import { World } from '../ecs.js';
import { Kernel } from '../kernel.js';
import { TICKS_PER_DAY, TICKS_PER_YEAR } from '../time.js';
import { scoreKingdomSites, FAIRNESS_VARIANCE_BAND } from '../worldgen/fairPlacement.js';
import { composeMultiKingdom, flatTerrain } from './multiKingdomHarness.js';
import { FogRegistry } from './fogQuery.js';
import { registerScoutingSystem, SCOUT_REVEAL_RADIUS, type ScoutingKingdom } from './scouting.js';

function makeVillageGame(mapSize = 300) {
  const kernel = new Kernel(1);
  const world = new World(512);
  const db = DefinitionDatabase.load(BASE_CONTENT_FILES);
  const game = registerVillageGameplay(kernel, world, db, flatTerrain(mapSize, mapSize), {});
  return { game, db };
}

// ---------------------------------------------------------------- fairness

test('fairness: scoreKingdomSites keeps variance within the ±15% band', () => {
  const { game, db } = makeVillageGame();
  const result = scoreKingdomSites(game, db, 3);
  assert.equal(result.sites.length, 3);
  assert.ok(result.variance <= FAIRNESS_VARIANCE_BAND, `variance ${result.variance} exceeds the band`);
});

test('fairness: deterministic — the same terrain always yields the same sites', () => {
  const a = makeVillageGame();
  const b = makeVillageGame();
  const resultA = scoreKingdomSites(a.game, a.db, 4);
  const resultB = scoreKingdomSites(b.game, b.db, 4);
  assert.deepEqual(resultA, resultB);
});

// ---------------------------------------------------------------- multi-kingdom harness

test('harness: kingdoms are founded at distinct, fairness-checked sites', () => {
  const composed = composeMultiKingdom({ kingdomCount: 3 });
  composed.kernel.step(); // genesis (kingdom + village founding, both phase 1)

  assert.equal(composed.kingdomGame.kingdomEntities().length, 3);
  for (let k = 0; k < 3; k++) {
    assert.ok(composed.villageOf(k) !== null, `kingdom ${k} has no village`);
  }
  assert.ok(composed.placement.variance <= FAIRNESS_VARIANCE_BAND);
});

test('harness: each AI kingdom (not the player) grows real buildings over time', () => {
  const composed = composeMultiKingdom({ kingdomCount: 3 });
  composed.kernel.step(); // genesis

  for (let i = 0; i < TICKS_PER_YEAR; i++) composed.kernel.step();

  const b = composed.world.read(composed.game.comps.BuildingCore);
  for (let k = 1; k < 3; k++) {
    const villageIndex = composed.villageOf(k);
    assert.ok(villageIndex !== null);
    let count = 0;
    composed.world.query([composed.game.comps.BuildingCore]).forEach((i) => {
      if (((b.village[i] as number) & 0x3fffff) === villageIndex) count++;
    });
    assert.ok(count > 1, `kingdom ${k}'s village has only its center built after a year`); // center + at least one AI-built structure
  }
});

// ---------------------------------------------------------------- scouting

test('scouting: reveals a foreign village once within range, not before', () => {
  const kernel = new Kernel(7);
  const fog = new FogRegistry(() => 4); // fixed small word count — no ECS entities needed for this test

  const kingdoms: ScoutingKingdom[] = [
    { kingdomIndex: 0, villages: () => [{ entityIndex: 10, x: 0, y: 0 }] },
    { kingdomIndex: 1, villages: () => [{ entityIndex: 20, x: SCOUT_REVEAL_RADIUS - 1, y: 0 }] }, // within range
    { kingdomIndex: 2, villages: () => [{ entityIndex: 30, x: SCOUT_REVEAL_RADIUS + 50, y: 0 }] }, // out of range
  ];
  registerScoutingSystem(kernel, fog, kingdoms);

  for (let i = 0; i < TICKS_PER_DAY; i++) kernel.step(); // one day — the scouting cadence

  assert.ok(fog.isKnown(0, 20), 'kingdom 1 is within range and should be revealed to kingdom 0');
  assert.ok(!fog.isKnown(0, 30), 'kingdom 2 is out of range and should not be revealed to kingdom 0');
  assert.ok(fog.isKnown(1, 10), 'reveal is symmetric here — kingdom 1 also sees kingdom 0, within range');
});

test('scouting: no reveal before the villages are within range', () => {
  const kernel = new Kernel(7);
  const fog = new FogRegistry(() => 4);
  const kingdoms: ScoutingKingdom[] = [
    { kingdomIndex: 0, villages: () => [{ entityIndex: 10, x: 0, y: 0 }] },
    { kingdomIndex: 1, villages: () => [{ entityIndex: 20, x: SCOUT_REVEAL_RADIUS + 1, y: 0 }] },
  ];
  registerScoutingSystem(kernel, fog, kingdoms);
  for (let i = 0; i < TICKS_PER_DAY; i++) kernel.step();
  assert.ok(!fog.isKnown(0, 20));
});

// ---------------------------------------------------------------- diplomacy (M23)

test('ForgeAlliance: a diplomacy-leaning AI kingdom proposes and gets a pact accepted', () => {
  // Fairly-placed kingdoms are usually too far apart to have scouted each other yet (by
  // design — see the module doc comment) — force contact directly via the shared FogRegistry
  // so the ForgeAlliance path can be exercised without waiting out real scouting range.
  const composed = composeMultiKingdom({
    kingdomCount: 3,
    weightsOf: (k) => (k === 1 ? { expansion: 0, economy: 0, riskTolerance: 0.5, diplomacyTrust: 1 } : { expansion: 0.5, economy: 0.5, riskTolerance: 0.5, diplomacyTrust: 0.5 }),
  });
  composed.kernel.step(); // genesis: kingdoms + villages founded

  const village1 = composed.villageOf(1);
  const village2 = composed.villageOf(2);
  assert.ok(village1 !== null && village2 !== null);
  composed.fog.reveal(1, village2 as number);
  composed.fog.reveal(2, village1 as number);

  const proposals: { chosenPlan?: string; from?: number; to?: number; accepted?: boolean }[] = [];
  composed.kernel.subscribe('ai.planChosen', (e) => proposals.push(e.data as never));
  composed.kernel.subscribe('diplomacy.pactProposed', (e) => proposals.push(e.data as never));

  for (let i = 0; i < TICKS_PER_DAY * 7 * 4; i++) composed.kernel.step(); // up to 4 weekly evaluations

  const planChoices = proposals.filter((p) => p.chosenPlan !== undefined);
  assert.ok(planChoices.some((p) => p.chosenPlan === 'ForgeAlliance'), 'expected kingdom 1 to choose ForgeAlliance');
  const pactEvents = proposals.filter((p) => p.accepted !== undefined);
  assert.ok(pactEvents.length > 0, 'expected a pact proposal to have been evaluated');
  assert.ok(pactEvents.some((p) => p.accepted === true), 'expected at least one accepted pact');

  const kingdomIds = composed.kingdomGame.kingdomEntities();
  assert.ok(
    composed.diplomacyGame.state.hasPact(kingdomIds[1] as number, kingdomIds[2] as number, 'nonAggression'),
    'expected a non-aggression pact between kingdoms 1 and 2',
  );
});
