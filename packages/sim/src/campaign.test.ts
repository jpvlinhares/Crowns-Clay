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
import { OCCUPATION_DAYS } from './game/occupation.js';
import { flatTerrain } from './ai/multiKingdomHarness.js';
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
    // These tests build capture-and-recapture histories. Taking a kingdom's OWN bound
    // capital is now (M55, A1) exclusively the siege system's business — its defence
    // layer makes it occupation-exempt regardless of `succession` (a layer village must
    // never be reachable by two routes at once, the exact duplication A1 retires). Taking
    // a village back that is NOT its current owner's bound capital (a village a kingdom
    // holds but does not call home) stays occupation's business — this is what lets the
    // SECOND capture in each test below stay unchanged. `succession: false` still governs
    // exactly one thing, the capital-death window (campaign.ts's narrowed comment) — the
    // capitals SECTION these tests verify is rule-independent either way
    // (succession.test.ts owns the capital-death chain itself).
    succession: false,
    // Keeps stay bare so the spatial assault below is deterministic — the same reason
    // succession.test.ts composes it out ("a 100-man column falls them deterministically").
    aiDefence: false,
  });
}

/** Command-level driver over a campaign composition (the siege.test.ts pattern). */
function warDriver(c: ReturnType<typeof composeCampaign>) {
  const events: { type: string; data: Record<string, number> }[] = [];
  for (const type of [
    'village.founded', 'village.occupied', 'army.created', 'village.rejected',
    'siege.begun', 'siege.captured',
  ]) {
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
  /** A 100-man column (10 spearman units) — crosses keep-only ground above the keep's
   * holdStrength (60), unlike `makeArmy`'s single unit. M55: taking a kingdom's own bound
   * capital is a siege now, so the column that does it needs real weight, the same reason
   * succession.test.ts's `makeColumn` exists. */
  const makeColumn = (kingdomIndex: number, atVillage: number): number => {
    submit('army.createArmy', { name: `T${kingdomIndex}col`, villageId: villageEntity(atVillage) }, kingdomIndex + 1);
    const created = events.filter((e) => e.type === 'army.created').at(-1);
    const armyId = created?.data['army'] ?? -1;
    assert.ok(armyId >= 0, 'column army created');
    const def = c.db.units.get('base:unit.spearman');
    assert.ok(def !== undefined);
    const defCode = c.militaryGame.ops.defCode('base:unit.spearman');
    assert.ok(defCode !== undefined);
    for (let i = 0; i < 10; i++) {
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
    }
    return armyId;
  };
  /** Step day-by-day until kingdom `winnerId` occupies dense village index `vi`. */
  const occupyUntil = (vi: number, winnerId: number, label: string): void => {
    for (let day = 0; day < 12; day++) {
      days(1);
      if (events.some((e) => e.type === 'village.occupied' && e.data['village'] === vi && e.data['kingdom'] === winnerId)) return;
    }
    assert.fail(`${label}: occupation never completed (rejections: ${JSON.stringify(events.filter((e) => e.type === 'village.rejected').slice(-3))})`);
  };
  /** M55: taking a kingdom's own bound capital is exclusively the siege system's business
   * (its defence layer makes it occupation-exempt). `armyId` must already be at the
   * castle's gates and its kingdom at war with the defender. */
  const siegeCapture = (armyId: number, castleVi: number, attackerIssuer: number, label: string): void => {
    const beforeBegun = events.filter((e) => e.type === 'siege.begun').length;
    submit('siege.begin', { armyId, villageId: villageEntity(castleVi) }, attackerIssuer);
    assert.equal(
      events.filter((e) => e.type === 'siege.begun').length,
      beforeBegun + 1,
      `${label}: siege.begin rejected (${JSON.stringify(events.filter((e) => e.type === 'village.rejected').slice(-2))})`,
    );
    submit('siege.assault', { armyId }, attackerIssuer);
    assert.ok(
      events.some((e) => e.type === 'siege.captured' && index(e.data['castle'] as number) === castleVi),
      `${label}: assault did not capture the castle (${JSON.stringify(events.filter((e) => e.type === 'village.rejected').slice(-2))})`,
    );
  };
  return { events, villageEntity, centreOf, days, submit, makeArmy, makeColumn, placeArmy, occupyUntil, siegeCapture };
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

  // war, then kingdom 0 takes V1 BY SIEGE (M55: V1 is still kingdom 1's own bound
  // capital here, so its defence layer makes it occupation-exempt) — kingdom 1's
  // binding must move to V2
  d.submit('kingdom.declareWar', { targetKingdom: 1 }, 1);
  assert.ok(original.diplomacyGame.state.isAtWar(k0Id, k1Id), 'at war');
  const a0 = d.makeColumn(0, v0 as number); // a bare keep needs real weight, not one unit
  const p1 = d.centreOf(v1 as number);
  d.placeArmy(a0, p1.x, p1.y);
  d.siegeCapture(a0, v1 as number, 1, 'kingdom 0 takes V1');
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
  const k1Id = original.kingdomGame.kingdomEntities()[1] as number;

  d.submit('kingdom.declareWar', { targetKingdom: 1 }, 1);
  // kingdom 1's army is raised while it still owns V1, then parked out of defender range
  const p1 = d.centreOf(v1 as number);
  const a1 = d.makeArmy(1, v1 as number);
  d.placeArmy(a1, p1.x + 12, p1.y);
  // kingdom 0 takes V1 BY SIEGE (M55: still kingdom 1's own bound capital, hence
  // occupation-exempt) — kingdom 1 now owns nothing: its binding is DELETED, its brain no-ops
  const a0 = d.makeColumn(0, v0 as number); // a bare keep needs real weight, not one unit
  d.placeArmy(a0, p1.x, p1.y);
  d.siegeCapture(a0, v1 as number, 1, 'kingdom 0 takes V1');
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

// ---------------- M56 (ADR-4 Amendment A1): the AI's siege-vs-occupy split survives the
// village-side fortification deletion ----------------

/** What M56 itself actually changed: castle-category defs are rejected in `ops.place()`
 * (new), `planCastleRing` and its village-map ring block are deleted, and castles.ts is gone.
 * It does NOT touch the AI's siege-vs-occupy DECISION logic in ai/military.ts — that branch
 * (`existingSiege !== undefined ? assault-or-lift : ... else if nearest.isCastle ? siege.begin
 * : nothing`) is unchanged code, M55's territory, already exercised by the M55 tests in this
 * file and in siege.test.ts, which are part of the full suite this milestone's own Done
 * criteria require green. So this test's job is a REGRESSION check — confirm the deletions
 * didn't collaterally break that path — not a test of new AI decision-making, which is why it
 * drives the siege directly (matching the proven `siegeCapture` pattern from the two tests
 * above) rather than waiting on the strategic planner and recruit economy to emergently choose
 * war. A fully emergent version was tried first and rejected after extensive empirical digging:
 * real worldgen's `fairPlacement` puts capitals ~116 tiles apart, and an unsupplied army —
 * fiat-spawned or recruited, a general attrition mechanic (armies.ts), unrelated to M56 —
 * attrits to zero over a march that long; switching to flat terrain fixed that but a
 * fiat-spawned army ALSO attrited to a handful of men just sitting at home, never clearing
 * WAR_MIN_STRENGTH, suggesting real recruits carry some supply/fatigue initialization a raw
 * component attach skips. None of that is what this milestone needs verified.
 *
 * Kingdom 1 needs THREE villages, not two — also learned empirically. With only two, capturing
 * the first triggers `rebindOnLoss` (campaign.ts), reassigning kingdom 1's capital binding to
 * its one remaining village; since the defence layer is still KINGDOM-indexed pre-M57
 * (re-keying to village is M57's job), that village immediately inherits
 * `spatialAssault.applicable` — correctly, given the current architecture — and would need
 * sieging too, never occupying. A genuinely non-capital village only stays that way for as
 * long as an "earlier" village remains alive to be the one that falls first, so proving
 * "sieged" and "occupied" as genuinely different outcomes needs a third, untouched village. */
const M56_MAP_SIZE = 80;

test('M56: post-deletion, an AI kingdom at war both besieges the enemy capital and occupies a genuinely non-capital village', () => {
  const c = composeCampaign({
    seed: 0x56a1,
    kingdomCount: 2,
    terrain: flatTerrain(M56_MAP_SIZE, M56_MAP_SIZE),
    mods: { sources: [] },
    settings: { mapSize: 'small', kingdomCount: 2, difficulty: 'fair', victory: [], defeatEnabled: false },
    victory: { enabled: [], defeatEnabled: false },
    aiDefence: false, // bare keeps: the capital siege is deterministic (established precedent)
    succession: false, // captures stay plain owner flips — no capitulation-window complexity
    // village.sendSettlers needs (SETTLER_PARTY.adults 20 + MIN_ADULTS_REMAINING 10) = 30
    // adults BEFORE it will send a party, and TWO parties are sent from this same capital
    // (a freshly-founded village has nowhere near enough population to send a second one
    // itself) — 60 clears both sends with room to spare.
    startingPopulation: { children: 16, adults: 60, elders: 4 },
    // Generous wood: the two sends are SEQUENTIAL (site-picking on perfectly flat, uniform-
    // score terrain always converges to the SAME "best" tile regardless of search radius —
    // confirmed empirically — so the second dispatch can only target a genuinely different
    // site once the first has actually founded and occupies its), and each carries 80 wood
    // (SETTLER_CARRY) — plenty left for the second even after the capital's own construction
    // manager spends some in between (unrelated to M56, but a real competing consumer).
    startingStock: { 'base:resource.wood': 400, 'base:resource.stone': 200, 'base:resource.food': 300, 'base:resource.tools': 50 },
  });
  c.kernel.step(); // genesis

  const k0Id = c.kingdomGame.kingdomEntities()[0] as number;
  const k1Id = c.kingdomGame.kingdomEntities()[1] as number;
  const capital = c.villageOf(1) as number;
  const home0 = c.villageOf(0) as number;
  assert.ok(capital !== null && home0 !== null);
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

  const events: { type: string; tick: number; data: Record<string, unknown> }[] = [];
  for (const type of [
    'village.founded', 'army.created', 'siege.begun', 'siege.captured', 'village.occupied', 'village.occupying', 'village.rejected',
  ]) {
    c.kernel.subscribe(type, (e) => events.push({ type, tick: e.tick, data: e.data as Record<string, unknown> }));
  }
  // kingdom 1's second and third villages — see file header for why THREE are needed. SEQUENTIAL:
  // the first must actually found (occupying its site) before `bestSiteNear` can pick anywhere
  // else, since flat, uniform-score terrain has no OTHER signal to break the tie on — confirmed
  // empirically, dispatching both at once had them target the identical "best" tile every time.
  const foundNextVillage = (label: string, known: ReadonlySet<number>): number => {
    const home = centreOf(capital);
    const site = bestSiteNear(c.game, c.db, home.x, home.y, VILLAGE_MIN_SPACING + 10);
    assert.ok(site !== null, `${label}: a site exists`);
    c.kernel.submit({
      type: 'village.sendSettlers',
      issuer: 2,
      payload: { villageId: villageEntity(capital), x: site.x, y: site.y, name: label },
    });
    c.kernel.step();
    let founded = -1;
    for (let day = 0; day < 15 && founded < 0; day++) {
      for (let t = 0; t < TICKS_PER_DAY; t++) c.kernel.step();
      const f = events.find((e) => e.type === 'village.founded' && e.data['kingdom'] === k1Id && !known.has(index(e.data['village'] as number)));
      if (f !== undefined) founded = index(f.data['village'] as number);
    }
    assert.ok(
      founded >= 0,
      `${label}: kingdom 1 founded it (rejections ${JSON.stringify(events.filter((e) => e.type === 'village.rejected').slice(-3))})`,
    );
    return founded;
  };
  const second = foundNextVillage('Second', new Set([capital]));
  const third = foundNextVillage('Third', new Set([capital, second]));
  c.fog.reveal(0, second); // see file-header note: scouting radius is unrelated to M56
  c.fog.reveal(0, third);

  const makeColumn = (atVillage: number, name: string): number => {
    c.kernel.submit({ type: 'army.createArmy', issuer: 1, payload: { name, villageId: villageEntity(atVillage) } });
    c.kernel.step();
    const armyId = (events.filter((e) => e.type === 'army.created').at(-1)?.data['army'] as number) ?? -1;
    assert.ok(armyId >= 0, `${name}: army created`);
    const def = c.db.units.get('base:unit.spearman');
    assert.ok(def !== undefined);
    const defCode = c.militaryGame.ops.defCode('base:unit.spearman');
    assert.ok(defCode !== undefined);
    for (let i = 0; i < 10; i++) {
      const unit = c.world.spawn();
      c.world.attach(unit, c.militaryGame.Unit, {
        def: defCode, kingdomId: k0Id, homeVillage: villageEntity(atVillage), armyId,
        count: def.popCost.count, progress: 1, complete: true, morale: def.stats.moraleBase,
      });
    }
    return armyId;
  };
  const placeArmy = (armyId: number, x: number, y: number): void => {
    const ai = index(armyId);
    const m = c.world.write(c.armiesGame.ArmyMovement);
    m.x[ai] = x;
    m.y[ai] = y;
    c.world.writeObj(c.armiesGame.ArmyPath).set(ai, []);
  };

  c.kernel.submit({ type: 'kingdom.declareWar', issuer: 1, payload: { targetKingdom: 1, casusBelli: true } });
  c.kernel.step();

  // Army A: marches on and besieges the capital — driven by the test, submitted with kingdom
  // 0's own issuer, exactly the M55 `siegeCapture` pattern above. This is the REGRESSION
  // check: `siege.begin` must still accept a real, layer-bearing capital as a target after
  // M56's deletions, and the assault must still resolve it.
  const armyA = makeColumn(home0, 'ArmyA');
  const capitalAt = centreOf(capital);
  placeArmy(armyA, capitalAt.x, capitalAt.y);
  c.kernel.submit({ type: 'siege.begin', issuer: 1, payload: { armyId: armyA, villageId: villageEntity(capital) } });
  c.kernel.step();
  c.kernel.submit({ type: 'siege.assault', issuer: 1, payload: { armyId: armyA } });
  c.kernel.step();

  // Army B: placed directly at the THIRD village — a genuinely non-capital village, per the
  // file header. No siege or occupation command is submitted for it: occupation.ts's daily
  // countdown is a PASSIVE presence check (committedCount(army) > 0, at war, unopposed), not a
  // conduct decision, so the test only needs to place the army and let ticks run. This is the
  // other half of the regression check: `occupation.exempt` must still correctly read this
  // village as NOT layer-eligible and let the countdown proceed.
  const armyB = makeColumn(home0, 'ArmyB');
  const thirdAt = centreOf(third);
  placeArmy(armyB, thirdAt.x, thirdAt.y);

  for (let day = 0; day < OCCUPATION_DAYS + 10; day++) {
    for (let t = 0; t < TICKS_PER_DAY; t++) c.kernel.step();
    if (events.some((e) => e.type === 'village.occupied' && index(e.data['village'] as number) === third && e.data['kingdom'] === k0Id)) break;
  }

  assert.ok(
    events.some((e) => e.type === 'siege.begun' && index(e.data['castle'] as number) === capital),
    'the capital siege was accepted (a real defence layer, correctly still siege-eligible after M56)',
  );
  assert.ok(
    events.some((e) => e.type === 'siege.captured' && index(e.data['castle'] as number) === capital),
    'the capital fell to the assault',
  );
  const occupied = events.find((e) => e.type === 'village.occupied' && index(e.data['village'] as number) === third && e.data['kingdom'] === k0Id);
  assert.ok(
    occupied !== undefined,
    `the third village was taken by occupation's countdown (${JSON.stringify(events.filter((e) => e.type === 'village.occupying').slice(-2))})`,
  );
  assert.ok(
    !events.some((e) => e.type === 'siege.begun' && index(e.data['castle'] as number) === third && e.tick <= (occupied?.tick ?? 0)),
    'the third village was never siege-eligible before it was occupied — it had no defence layer to besiege',
  );
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
