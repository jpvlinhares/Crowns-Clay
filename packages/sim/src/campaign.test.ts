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
import { bestSiteNear } from './game/settlers.js';
import { VILLAGE_MIN_SPACING } from './game/villages.js';
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

// ---------------- OQ-9 item 1 (doc 14): the capital binding is HISTORY, not derivable ----------------
//
// The 'capitals' save section exists because the runtime kingdom→capital binding re-binds when
// a capital is LOST and deliberately does not snap back on reconquest, while the old on-load
// re-derivation always picked the oldest still-owned village. These tests build the real
// divergent histories through ordinary commands and prove a loaded session now tracks the
// uninterrupted original — in the binding itself, in the AI's observable behaviour (plan
// choices and construction siting), and in the state hash. Both were LIVE save/load
// divergences before the section existed; the plain hash-identity test above cannot see them
// (the binding is not a hash source — only its behavioural consequences are).

const WAR_SETTINGS: CampaignSettings = {
  mapSize: 'small',
  kingdomCount: 2,
  difficulty: 'fair',
  victory: ['conquest', 'prosperity', 'chronicle'],
  defeatEnabled: true,
};

/** Kingdom 0 is the manual "player" (no AI), kingdom 1 is AI-driven. The raised starting
 * population lets the test dispatch a real settler party (20 adults + 10 remaining). */
function composeWar(): ReturnType<typeof composeCampaign> {
  const difficulty = difficultyFromSettings(WAR_SETTINGS);
  return composeCampaign({
    seed: SEED,
    kingdomCount: 2,
    mapSize: 'small',
    ...(difficulty !== undefined ? { difficulty } : {}),
    victory: victoryFromSettings(WAR_SETTINGS),
    mods: { sources: [] },
    settings: WAR_SETTINGS,
    startingPopulation: { children: 10, adults: 34, elders: 3 },
    // These tests build capture-and-recapture histories by OCCUPYING capitals — the
    // pre-M53 rule. M53's capital-death package (occupation exemption + fall window)
    // is switched off so the divergence scenarios stay constructible; the capitals
    // SECTION they verify is rule-independent (succession.test.ts owns the new rules).
    succession: false,
  });
}

/** Command-level driver over a campaign composition (the siege.test.ts pattern). */
function warDriver(c: ReturnType<typeof composeCampaign>) {
  const events: { type: string; data: Record<string, number> }[] = [];
  for (const type of ['village.founded', 'village.occupied', 'army.created', 'village.rejected']) {
    c.kernel.subscribe(type, (e) => events.push({ type, data: e.data as Record<string, number> }));
  }
  const index = (id: number): number => id & 0x3fffff;
  const villageEntity = (vi: number): number => {
    let id = -1;
    c.world.query([c.game.comps.VillageCore]).forEach((i, entity) => {
      if (i === vi) id = entity as number;
    });
    return id;
  };
  const centreOf = (vi: number): { x: number; y: number } => {
    const core = c.world.read(c.game.comps.VillageCore);
    return { x: core.centerX[vi] as number, y: core.centerY[vi] as number };
  };
  const days = (n: number): void => {
    for (let t = 0; t < n * TICKS_PER_DAY; t++) c.kernel.step();
  };
  const submit = (type: string, payload: unknown, issuer: number): void => {
    c.kernel.submit({ type, issuer, payload });
    c.kernel.step();
  };
  /** One army of ONE spearman unit (10 men) — deliberately under ai/military.ts's
   * WAR_MIN_STRENGTH so the AI never marches the armies this test positions by hand. */
  const makeArmy = (kingdomIndex: number, atVillage: number): number => {
    submit('army.createArmy', { name: `T${kingdomIndex}`, villageId: villageEntity(atVillage) }, kingdomIndex + 1);
    const created = events.filter((e) => e.type === 'army.created').at(-1);
    const armyId = created?.data['army'] ?? -1;
    assert.ok(armyId >= 0, 'army created');
    const def = c.db.units.get('base:unit.spearman');
    assert.ok(def !== undefined);
    const defCode = c.militaryGame.ops.defCode('base:unit.spearman');
    assert.ok(defCode !== undefined);
    const unit = c.world.spawn();
    c.world.attach(unit, c.militaryGame.Unit, {
      def: defCode,
      kingdomId: c.kingdomGame.kingdomEntities()[kingdomIndex] as number,
      homeVillage: villageEntity(atVillage),
      armyId,
      count: def.popCost.count,
      progress: 1,
      complete: true,
      morale: def.stats.moraleBase,
    });
    return armyId;
  };
  const placeArmy = (armyId: number, x: number, y: number): void => {
    const ai = index(armyId);
    const m = c.world.write(c.armiesGame.ArmyMovement);
    m.x[ai] = x;
    m.y[ai] = y;
    c.world.writeObj(c.armiesGame.ArmyPath).set(ai, []); // drop any stale march order
  };
  /** Step day-by-day until kingdom `winnerId` occupies dense village index `vi`. */
  const occupyUntil = (vi: number, winnerId: number, label: string): void => {
    for (let day = 0; day < 12; day++) {
      days(1);
      if (events.some((e) => e.type === 'village.occupied' && e.data['village'] === vi && e.data['kingdom'] === winnerId)) return;
    }
    assert.fail(`${label}: occupation never completed (rejections: ${JSON.stringify(events.filter((e) => e.type === 'village.rejected').slice(-3))})`);
  };
  return { events, villageEntity, centreOf, days, submit, makeArmy, placeArmy, occupyUntil };
}

/** Resume both sessions `daysN` days in lockstep: hashes must match daily, and the AI's
 * observable behaviour (plan choices, construction siting) must be identical streams. */
function assertLockstep(
  original: ReturnType<typeof composeCampaign>,
  loaded: ReturnType<typeof composeCampaign>,
  daysN: number,
): void {
  const track = (c: ReturnType<typeof composeCampaign>): string[] => {
    const out: string[] = [];
    for (const type of ['ai.planChosen', 'building.placed', 'village.founded']) {
      c.kernel.subscribe(type, (e) => out.push(`${e.tick} ${type} ${JSON.stringify(e.data)}`));
    }
    return out;
  };
  const originalLog = track(original);
  const loadedLog = track(loaded);
  for (let day = 0; day < daysN; day++) {
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
  assert.deepEqual(loadedLog, originalLog, 'AI behaviour (plans, construction, founding) identical after load');
}

test('capitals section: a re-bound capital survives save/load after the old one is re-taken', () => {
  const original = composeWar();
  const d = warDriver(original);
  original.kernel.step(); // genesis
  const v0 = original.villageOf(0);
  const v1 = original.villageOf(1);
  assert.ok(v0 !== null && v1 !== null);
  const k0Id = original.kingdomGame.kingdomEntities()[0] as number;
  const k1Id = original.kingdomGame.kingdomEntities()[1] as number;

  // kingdom 1 founds a second village (V2) through the real settler path
  const home = d.centreOf(v1 as number);
  const site = bestSiteNear(original.game, original.db, home.x, home.y, VILLAGE_MIN_SPACING + 10);
  assert.ok(site !== null, 'a second-village site exists near kingdom 1');
  d.submit('village.sendSettlers', { villageId: d.villageEntity(v1 as number), x: site.x, y: site.y, name: 'Second' }, 2);
  let v2 = -1;
  for (let day = 0; day < 15 && v2 < 0; day++) {
    d.days(1);
    const founded = d.events.find(
      (e) => e.type === 'village.founded' && e.data['kingdom'] === k1Id && ((e.data['village'] as number) & 0x3fffff) !== v1,
    );
    if (founded !== undefined) v2 = (founded.data['village'] as number) & 0x3fffff;
  }
  assert.ok(v2 >= 0, `kingdom 1 founded its second village (last rejections: ${JSON.stringify(d.events.filter((e) => e.type === 'village.rejected').slice(-2))})`);
  assert.ok(v2 > (v1 as number), 'the second village has the higher dense index (founded later)');

  // war, then kingdom 0 occupies V1 — kingdom 1's binding must move to V2
  d.submit('kingdom.declareWar', { targetKingdom: 1 }, 1);
  assert.ok(original.diplomacyGame.state.isAtWar(k0Id, k1Id), 'at war');
  const a0 = d.makeArmy(0, v0 as number);
  const p1 = d.centreOf(v1 as number);
  d.placeArmy(a0, p1.x + 2, p1.y);
  d.occupyUntil(v1 as number, k0Id, 'kingdom 0 takes V1');
  assert.equal(original.villageOf(1), v2, 'binding moved to the second village on losing the capital');

  // kingdom 1 re-takes its original capital — the binding must NOT snap back
  d.placeArmy(a0, p1.x + 9, p1.y); // out of DEFENDER_RADIUS, clear of engagements
  const a1 = d.makeArmy(1, v2);
  d.placeArmy(a1, p1.x - 2, p1.y);
  d.occupyUntil(v1 as number, k1Id, 'kingdom 1 re-takes V1');
  assert.equal(original.villageOf(1), v2, 'runtime binding held through the reconquest');

  // save mid-divergence-history, load, and prove the binding (and everything downstream) holds
  const save = original.saves.snapshot();
  const loaded = composeWar();
  const report = loaded.saves.hydrate(JSON.parse(JSON.stringify(save)) as typeof save);
  assert.deepEqual(report, [], 'current save needs no migrations/fallbacks');
  assert.equal(loaded.kernel.stateHash(), original.kernel.stateHash(), 'hash identical after hydration');
  assert.equal(loaded.villageOf(1), v2, 'capital binding survived the reload (pre-section: snapped back to the re-derived oldest village)');
  assert.equal(loaded.villageOf(0), original.villageOf(0));

  // the diplomacy panel's inputs (simPort names rivals by capital and fog-gates on it) are stable
  const capName = (c: ReturnType<typeof composeCampaign>): string | undefined =>
    c.world.readObj(c.game.comps.VillageName).tryGet(c.villageOf(1) as number);
  assert.equal(capName(loaded), capName(original), 'rival display name stable across reload');
  assert.equal(loaded.fog.isKnown(0, v2), original.fog.isKnown(0, v2), 'rival discovered-gating stable across reload');

  assertLockstep(original, loaded, 20);
});

test('capitals section: a kingdom that lost every village and re-took one stays un-bound after load', () => {
  const original = composeWar();
  const d = warDriver(original);
  original.kernel.step(); // genesis
  const v0 = original.villageOf(0);
  const v1 = original.villageOf(1);
  assert.ok(v0 !== null && v1 !== null);
  const k0Id = original.kingdomGame.kingdomEntities()[0] as number;
  const k1Id = original.kingdomGame.kingdomEntities()[1] as number;

  d.submit('kingdom.declareWar', { targetKingdom: 1 }, 1);
  // kingdom 1's army is raised while it still owns V1, then parked out of defender range
  const p1 = d.centreOf(v1 as number);
  const a1 = d.makeArmy(1, v1 as number);
  d.placeArmy(a1, p1.x + 12, p1.y);
  // kingdom 0 takes V1 — kingdom 1 now owns nothing: its binding is DELETED, its brain no-ops
  const a0 = d.makeArmy(0, v0 as number);
  d.placeArmy(a0, p1.x + 2, p1.y);
  d.occupyUntil(v1 as number, k0Id, 'kingdom 0 takes V1');
  assert.equal(original.villageOf(1), null, 'losing the last village deletes the binding');

  // kingdom 1's surviving army re-takes V1 — the winner side never re-binds (current rule)
  d.placeArmy(a0, p1.x - 9, p1.y);
  d.placeArmy(a1, p1.x + 2, p1.y);
  d.occupyUntil(v1 as number, k1Id, 'kingdom 1 re-takes V1');
  assert.equal(original.villageOf(1), null, 'reconquest does not resurrect the binding at runtime');

  const save = original.saves.snapshot();
  const loaded = composeWar();
  loaded.saves.hydrate(JSON.parse(JSON.stringify(save)) as typeof save);
  assert.equal(loaded.kernel.stateHash(), original.kernel.stateHash(), 'hash identical after hydration');
  assert.equal(loaded.villageOf(1), null, 'reload does not resurrect the binding either (pre-section: it re-derived and revived the brain)');

  assertLockstep(original, loaded, 15);
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
