/**
 * Sieges (M29; M55 rewrite) — the roadmap T objective is "siege pacing stats
 * within design bands" (GDD §8): starving a castle should take SEASONS, and
 * storming should be BLOODY. Also covers the phase progression — encircle,
 * assault, sortie — and determinism.
 *
 * M55 (ADR-4 Amendment A1, Phase 8.1) moved these onto the REAL campaign
 * composition. They used to run on a hand-built harness that registered siege
 * WITHOUT a defence layer and took its castle-ness from an M28 world-map wall
 * enclosure. A1 retires that: `siege.begin` now requires a standing defence
 * layer, and the only place a layer and a siege are wired together is
 * `composeCampaign` — so a standalone harness could no longer reach a siege at
 * all, and one hand-rolled here would be a second, synthetic wiring of the
 * spatial hook, free to drift from the shipping one (ADR-3's documented
 * failure mode, and the reason its rule reads "composition into the SHIPPING
 * game, not only harness verification").
 *
 * Composition choices, and why:
 *   - `aiDefence: false` — castles stay KEEP-ONLY, so the spatial resolver's
 *     outcome is deterministic and these tests exercise siege PHASES rather
 *     than the resolver (assault.test.ts owns that).
 *   - `succession: false` — a capture stays a plain owner flip, which is the
 *     semantics every one of these tests was originally written against;
 *     succession.test.ts owns the capital-death chain.
 *   - pacifist weights — the M52 lesson: an armed AI conquers the scenario out
 *     from under the test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { composeCampaign } from '../campaign.js';
import { STARVATION_SURRENDER_DAYS } from './siege.js';
import { TICKS_PER_DAY } from '../time.js';
import { DEFAULT_PERSONALITY_WEIGHTS } from '../ai/planner.js';
import { bestSiteNear } from './settlers.js';
import { VILLAGE_MIN_SPACING } from './villages.js';
import type { CampaignSettings } from '@crowns/protocol';

const SEED = 0x51e6;
const index = (id: number): number => id & 0x3fffff;

const SETTINGS: CampaignSettings = {
  mapSize: 'small',
  kingdomCount: 2,
  difficulty: 'fair',
  victory: [],
  defeatEnabled: false,
};

/** Pacifist pinning: the AI must not prosecute its own wars during these scenarios. */
const pacifist = () => ({
  ...DEFAULT_PERSONALITY_WEIGHTS,
  aggression: 0,
  expansion: 0,
  riskTolerance: 0,
});

function compose(opts: { seed?: number } = {}): ReturnType<typeof composeCampaign> {
  return composeCampaign({
    seed: opts.seed ?? SEED,
    kingdomCount: 2,
    mapSize: 'small',
    mods: { sources: [] },
    settings: SETTINGS,
    victory: { enabled: [], defeatEnabled: false },
    aiDefence: false,
    succession: false,
    weightsOf: pacifist,
    // Neither kingdom is AI-conducted (aiFromIndex === kingdomCount, so the per-kingdom
    // conduct loop `for (k = aiFromIndex; k < kingdomCount; k++)` never runs). This is not
    // the same as pacifist weights: a siege ALREADY under way is `committedToWar` regardless
    // of aggression, so an AI-conducted attacker independently assaults or lifts an
    // existing siege every day, racing the test's own orchestration — invisible in tests
    // that resolve in one step, but it silently cycled the starvation test's siege through
    // lift/re-begin (confirmed empirically: daysStarving reset every time the AI relifted).
    // The old isolated harness had no AI at all on either side; this matches it exactly.
    aiFromIndex: 2,
    startingPopulation: { children: 10, adults: 34, elders: 3 },
  });
}

function driver(c: ReturnType<typeof composeCampaign>) {
  const events: { type: string; tick: number; data: Record<string, unknown> }[] = [];
  for (const type of [
    'army.created', 'village.founded', 'village.rejected',
    'siege.begun', 'siege.ended', 'siege.captured', 'siege.assaultResolved',
    'siege.assaultBegun', 'siege.sortieBegun',
  ]) {
    c.kernel.subscribe(type, (e) => events.push({ type, tick: e.tick, data: e.data as Record<string, unknown> }));
  }
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
  const has = (type: string): boolean => events.some((e) => e.type === type);
  const last = (type: string) => events.filter((e) => e.type === type).at(-1);
  const rejection = (what: string): string | undefined =>
    events.filter((e) => e.type === 'village.rejected' && e.data['what'] === what).at(-1)?.data['reason'] as
      | string
      | undefined;
  /** A 100-man column (10 spearman units) — crosses keep-only ground above holdStrength 60. */
  const makeColumn = (kingdomIndex: number, atVillage: number): number => {
    submit('army.createArmy', { name: `T${kingdomIndex}`, villageId: villageEntity(atVillage) }, kingdomIndex + 1);
    const armyId = (last('army.created')?.data['army'] as number) ?? -1;
    assert.ok(armyId >= 0, 'army created');
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
  /** Empty army at `atVillage`, no units — the old harness's `createArmy` granularity, for
   * tests that need to hand-size a force unit by unit (a weak besieger, a lone catapult). */
  const createArmy = (kingdomIndex: number, atVillage: number): number => {
    submit('army.createArmy', { name: `U${kingdomIndex}`, villageId: villageEntity(atVillage) }, kingdomIndex + 1);
    const armyId = (last('army.created')?.data['army'] as number) ?? -1;
    assert.ok(armyId >= 0, 'army created');
    return armyId;
  };
  /** One unit of `unitDefId` onto an existing army — the old harness's `spawnUnit`. */
  const spawnUnit = (armyId: number, kingdomIndex: number, unitDefId: string, atVillage: number): number => {
    const def = c.db.units.get(unitDefId);
    assert.ok(def !== undefined, `unknown unit def ${unitDefId}`);
    const defCode = c.militaryGame.ops.defCode(unitDefId);
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
    return unit;
  };
  const placeArmy = (armyId: number, x: number, y: number): void => {
    const ai = index(armyId);
    const m = c.world.write(c.armiesGame.ArmyMovement);
    m.x[ai] = x;
    m.y[ai] = y;
    c.world.writeObj(c.armiesGame.ArmyPath).set(ai, []);
  };
  /** Put a fresh column of `attackerK`'s at `castle`'s gates, at war, ready to besiege. */
  const marchOn = (attackerK: number, defenderK: number, castle: number): number => {
    submit('kingdom.declareWar', { targetKingdom: defenderK, casusBelli: true }, attackerK + 1);
    const army = makeColumn(attackerK, c.villageOf(attackerK) as number);
    const at = centreOf(castle);
    placeArmy(army, at.x, at.y);
    return army;
  };
  /** Found a second village through the real settler path. It has NO defence layer, which
   * is exactly what makes it un-besiegeable under M55. */
  const foundSecondVillage = (kingdomIndex: number): number => {
    const home = c.villageOf(kingdomIndex) as number;
    const at = centreOf(home);
    const site = bestSiteNear(c.game, c.db, at.x, at.y, VILLAGE_MIN_SPACING + 10);
    assert.ok(site !== null, 'a second-village site exists');
    submit(
      'village.sendSettlers',
      { villageId: villageEntity(home), x: site.x, y: site.y, name: 'Outlying' },
      kingdomIndex + 1,
    );
    const kId = c.kingdomGame.kingdomEntities()[kingdomIndex] as number;
    let founded = -1;
    for (let day = 0; day < 15 && founded < 0; day++) {
      days(1);
      const e = events.find(
        (x) => x.type === 'village.founded' && x.data['kingdom'] === kId && index(x.data['village'] as number) !== home,
      );
      if (e !== undefined) founded = index(e.data['village'] as number);
    }
    assert.ok(founded >= 0, `second village founded (rejected: ${rejection('village.sendSettlers') ?? 'n/a'})`);
    return founded;
  };
  return {
    events, villageEntity, centreOf, days, submit, has, last, rejection,
    makeColumn, createArmy, spawnUnit, placeArmy, marchOn, foundSecondVillage,
  };
}

// ---------------- encircle ----------------

test('siege.begin: the defence layer IS the castle — takes a layer-bearing capital, refuses your own and refuses a layer-less village', () => {
  const c = compose();
  const d = driver(c);
  c.kernel.step(); // genesis: keeps rise on the layer

  const v0 = c.villageOf(0);
  const v1 = c.villageOf(1);
  assert.ok(v0 !== null && v1 !== null);

  // A village with no layer: kingdom 1's outlying settlement. Founded BEFORE any siege
  // stands, so the settler party's ticks cannot advance one behind our back.
  const outlying = d.foundSecondVillage(1);

  const army = d.marchOn(0, 1, v1);

  // 1. your own capital has a layer too — ownership, not fortification, refuses this
  d.submit('siege.begin', { armyId: army, villageId: d.villageEntity(v0) }, 1);
  assert.ok(!d.has('siege.begun'), 'no siege opened against your own capital');
  assert.equal(d.rejection('siege.begin'), 'cannot besiege your own castle');

  // 2. a layer-less village is not a castle at all — it is occupation's business.
  //    Pre-M55 this was the M28 enclosure check; an enclosure now confers nothing.
  const outskirts = d.centreOf(outlying);
  d.placeArmy(army, outskirts.x, outskirts.y);
  d.submit('siege.begin', { armyId: army, villageId: d.villageEntity(outlying) }, 1);
  assert.ok(!d.has('siege.begun'), 'no siege opened against a village with no defence layer');
  assert.equal(d.rejection('siege.begin'), 'no defence layer — nothing to besiege');

  // 3. the hostile capital, whose layer stands: encircled
  const gates = d.centreOf(v1);
  d.placeArmy(army, gates.x, gates.y);
  d.submit('siege.begin', { armyId: army, villageId: d.villageEntity(v1) }, 1);
  assert.ok(d.has('siege.begun'), `siege begun (last rejection: ${d.rejection('siege.begin') ?? 'none'})`);
  assert.equal(index(d.last('siege.begun')?.data['castle'] as number), v1);
  assert.ok(c.siegeGame.state.siegeOfArmy(army) !== undefined, 'the siege is indexed by its army');
  assert.equal(
    c.world.read(c.armiesGame.ArmyMovement).stance[index(army)],
    3,
    'the besieger holds the siege stance',
  );
});

// M55: the old "bombard: a targeted wall loses HP and is breached" test is DROPPED, not
// converted — its mechanism (siege.setTarget, the daily bombard-vs-Fortification) is
// deleted with the legacy path it belonged to. Wall-breaking is now the spatial
// resolver's own business and is already covered there: assault.test.ts's "walls must be
// broken through — the trace shows wall-hits and breaches, and structures really fall".

// ---------------- assault: no defenders captures immediately ----------------

test('siege.assault: with no defenders present, the castle falls on the first assault', () => {
  const c = compose();
  const d = driver(c);
  c.kernel.step(); // genesis

  const v1 = c.villageOf(1);
  assert.ok(v1 !== null);
  const army = d.marchOn(0, 1, v1);
  d.submit('siege.begin', { armyId: army, villageId: d.villageEntity(v1) }, 1);
  assert.ok(d.has('siege.begun'), `siege begun (${d.rejection('siege.begin') ?? 'n/a'})`);

  // M55: there is no bombard-first precondition any more — the spatial resolver breaks
  // its own walls as it walks, so an undefended bare keep falls on the FIRST assault.
  d.submit('siege.assault', { armyId: army }, 1);
  assert.ok(d.has('siege.captured'), `an undefended castle must fall on assault (${d.rejection('siege.assault') ?? 'n/a'})`);
  assert.ok(c.kingdomGame.VillageOwner !== undefined);
  const newOwner = c.world.read(c.kingdomGame.VillageOwner as NonNullable<typeof c.kingdomGame.VillageOwner>).kingdom[v1] as number;
  assert.equal(newOwner, c.kingdomGame.kingdomEntities()[0], 'ownership transfers to the attacker');
});

// M55: the old "assault casualties are decisively bloodier than an ordinary field battle"
// test is NOT converted. It measured ASSAULT_CASUALTY_MULTIPLIER against combat.ts's
// ordinary Engagement resolver — both are deleted with the legacy path; the spatial
// resolver has its own bespoke combat math and never touches combat.ts at all. The GDD §8
// "storming should be bloody" objective this verified has no home post-M55: it is neither
// re-proven here nor superseded by an existing assault.test.ts test (checked — the closest,
// "a garrison bleeds the column", shows casualties occur but makes no bloodier-than-X
// comparison). Left open rather than silently dropped or worked around with a new
// comparison invented here — flagged in the handoff.

// ---------------- sortie ----------------

test('siege.sortie: a defending garrison can fight the besieger; wiping it out lifts the siege', () => {
  const c = compose();
  const d = driver(c);
  c.kernel.step(); // genesis

  const v0 = c.villageOf(0);
  const v1 = c.villageOf(1);
  assert.ok(v0 !== null && v1 !== null);

  d.submit('kingdom.declareWar', { targetKingdom: 1 }, 1);
  const attacker = d.createArmy(0, v0);
  d.spawnUnit(attacker, 0, 'base:unit.militia', v0); // a weak besieger
  const gates = d.centreOf(v1);
  d.placeArmy(attacker, gates.x, gates.y);
  d.submit('siege.begin', { armyId: attacker, villageId: d.villageEntity(v1) }, 1);
  assert.ok(d.has('siege.begun'), `siege begun (${d.rejection('siege.begin') ?? 'n/a'})`);

  const defender = d.createArmy(1, v1);
  for (let i = 0; i < 6; i++) d.spawnUnit(defender, 1, 'base:unit.spearman', v1); // a strong garrison
  d.placeArmy(defender, gates.x, gates.y);

  d.submit('siege.sortie', { armyId: defender }, 2);
  assert.ok(d.has('siege.sortieBegun'), 'sortie begun');
  for (let t = 0; t < 200 && c.siegeGame.state.siegeOfArmy(attacker) !== undefined; t++) c.kernel.step();
  assert.equal(c.siegeGame.state.siegeOfArmy(attacker), undefined, 'a decisively won sortie must lift the siege');
  assert.ok(d.has('siege.ended'), 'siege ended');
});

// ---------------- the T objective: starvation pacing within "seasons" ----------------

test('starvation: an empty granary surrenders the castle on a "should take seasons" timescale', () => {
  const c = compose();
  const d = driver(c);
  c.kernel.step(); // genesis

  const v1 = c.villageOf(1);
  assert.ok(v1 !== null);

  // The isolated pre-M55 harness had no real economy to speak of, so an empty granary
  // simply STAYED empty. This composition has a live economy, whose production is
  // deliberately out of scope for the SIEGE-PACING mechanic under test here (that's a
  // balance question, not this test's — its daysStarving counter is a pure function of
  // "food at/under threshold", not of what a real siege does to a real farm). Pinning the
  // stockpile empty once per DAY is not enough — the starvation check fires partway
  // through the day's tick block, after that day's production has already run, so a
  // once-daily pin still gets read as "fed" on the days production outpaces consumption
  // (confirmed empirically: daysStarving reset mid-run under a once-daily pin). Pinning
  // every tick isolates the counter exactly as the old harness did structurally.
  const foodCode = c.game.ops.resourceCode('base:resource.food') as number;
  const pinFoodEmpty = (): void => {
    c.world.writeObj(c.game.comps.Stockpile).get(v1).set(foodCode, 0);
  };
  pinFoodEmpty();

  const army = d.marchOn(0, 1, v1);
  d.submit('siege.begin', { armyId: army, villageId: d.villageEntity(v1) }, 1);
  assert.ok(d.has('siege.begun'), `siege begun (${d.rejection('siege.begin') ?? 'n/a'})`);

  let capturedAtDay = -1;
  for (let day = 0; day < STARVATION_SURRENDER_DAYS + 30 && capturedAtDay === -1; day++) {
    for (let t = 0; t < TICKS_PER_DAY; t++) {
      pinFoodEmpty();
      c.kernel.step();
    }
    if (d.has('siege.captured')) capturedAtDay = day + 1;
  }
  assert.ok(capturedAtDay >= 0, 'a starved-out castle must eventually surrender');
  // "should take seasons" (GDD §8): not a five-day walkover, not a year-long slog
  const days90 = STARVATION_SURRENDER_DAYS;
  assert.ok(
    capturedAtDay >= days90 - 5 && capturedAtDay <= days90 + 5,
    `surrendered on day ${capturedAtDay}, expected ~${days90}`,
  );
});

// ---------------- determinism ----------------

test('siege: identical histories hash identically', () => {
  const run = (): number => {
    const c = compose({ seed: 42 });
    const d = driver(c);
    c.kernel.step(); // genesis
    const v1 = c.villageOf(1);
    assert.ok(v1 !== null);
    const army = d.marchOn(0, 1, v1);
    d.submit('siege.begin', { armyId: army, villageId: d.villageEntity(v1) }, 1);
    d.submit('siege.assault', { armyId: army }, 1);
    d.days(5);
    return c.kernel.stateHash();
  };
  assert.equal(run(), run());
});
