/**
 * Loss, loot & succession (M53) — the capital-death chain end-to-end, through
 * ordinary commands over the real campaign composition:
 *
 *   1. vassalage-first: a trusting court submits; the capital keeps its banner,
 *      the war ends, the kingdom survives as a vassal (OQ-11's default);
 *   2. refusal → destruction: treasury looted (ledger-explicit), goods carried
 *      under capOf with the excess burned, the capital razed, the realm annexed,
 *      the armies dissolved, defeat marked;
 *   3. ironman: no window, no offer — the fall is immediately terminal (opt-in
 *      permadeath, binding AI lords too);
 *   4. a human attacker gets the homage offer and may accept it by command;
 *   5. new lords rise on the vacant heartland after the cooldown, politically
 *      blank-slated;
 *   6. occupation can no longer take a defence-layer capital by countdown, and
 *      a save with a frozen fallen siege round-trips (incl. the siege v1→v2
 *      migration).
 *
 * AI defence is composed OUT here (aiDefence: false): the castles stay keep-only
 * so a 100-man column falls them deterministically — these tests exercise the
 * OUTCOME chain, not the resolver (assault.test.ts owns that).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { composeCampaign } from '../campaign.js';
import { TICKS_PER_DAY } from '../time.js';
import { DEFAULT_PERSONALITY_WEIGHTS } from '../ai/planner.js';
import { STARTING_TREASURY } from './kingdom.js';
import { OCCUPATION_DAYS } from './occupation.js';
import { CAPITULATION_WINDOW_DAYS } from './succession.js';
import { bestSiteNear } from './settlers.js';
import type { CampaignSettings } from '@crowns/protocol';

const SEED = 0x53cc;
const index = (id: number): number => id & 0x3fffff;

const SETTINGS: CampaignSettings = {
  mapSize: 'small',
  kingdomCount: 2,
  difficulty: 'fair',
  victory: [],
  defeatEnabled: true,
};

/** Pacifist pinning (the M52 lesson: an armed AI conquers the test scenario) with a
 * chosen court temperament: trust 1 submits at the fallen-keep floor, trust 0 defies. */
const weights = (diplomacyTrust: number) => () => ({
  ...DEFAULT_PERSONALITY_WEIGHTS,
  aggression: 0,
  expansion: 0,
  riskTolerance: 0,
  diplomacyTrust,
});

function compose(opts?: {
  trust?: number;
  ironman?: boolean;
  aiFromIndex?: number;
}): ReturnType<typeof composeCampaign> {
  return composeCampaign({
    seed: SEED,
    kingdomCount: 2,
    mapSize: 'small',
    mods: { sources: [] },
    settings: SETTINGS,
    victory: { enabled: [], defeatEnabled: true }, // no track noise; risings never suppressed
    aiDefence: false, // keep-only castles: the fall is deterministic
    weightsOf: weights(opts?.trust ?? 1),
    aiFromIndex: opts?.aiFromIndex ?? 0, // default: ALL AI (the auto-resolution paths)
    ...(opts?.ironman === true ? { sandbox: { ironman: true } } : {}),
    startingPopulation: { children: 10, adults: 34, elders: 3 },
  });
}

function driver(c: ReturnType<typeof composeCampaign>) {
  const events: { type: string; tick: number; data: Record<string, unknown> }[] = [];
  for (const type of [
    'army.created', 'siege.begun', 'siege.capitalFallen', 'siege.capitulationOffered', 'siege.ended',
    'siege.sacked', 'kingdom.capitulated', 'kingdom.destroyed', 'kingdom.newLordRisen',
    'village.occupied', 'village.razed', 'defeat.kingdom', 'village.rejected',
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
  /** A 100-man column (10 spearman units): crosses keep-only ground above holdStrength 60. */
  const makeColumn = (kingdomIndex: number, atVillage: number): number => {
    submit('army.createArmy', { name: `T${kingdomIndex}`, villageId: villageEntity(atVillage) }, kingdomIndex + 1);
    const created = last('army.created');
    const armyId = (created?.data['army'] as number) ?? -1;
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
  const placeArmy = (armyId: number, x: number, y: number): void => {
    const ai = index(armyId);
    const m = c.world.write(c.armiesGame.ArmyMovement);
    m.x[ai] = x;
    m.y[ai] = y;
    c.world.writeObj(c.armiesGame.ArmyPath).set(ai, []);
  };
  /** March a fresh column of `attacker`'s onto `defender`'s capital and storm it. */
  const fellCapital = (attackerK: number, defenderK: number): { castle: number; army: number } => {
    const castle = c.villageOf(defenderK) as number;
    assert.ok(castle !== null);
    submit('kingdom.declareWar', { targetKingdom: defenderK, casusBelli: true }, attackerK + 1);
    const army = makeColumn(attackerK, c.villageOf(attackerK) as number);
    const at = centreOf(castle);
    placeArmy(army, at.x, at.y);
    submit('siege.begin', { armyId: army, villageId: villageEntity(castle) }, attackerK + 1);
    assert.ok(has('siege.begun'), `siege begun (${JSON.stringify(last('village.rejected')?.data)})`);
    submit('siege.assault', { armyId: army }, attackerK + 1);
    assert.ok(has('siege.capitalFallen'), `keep fell (${JSON.stringify(last('village.rejected')?.data)})`);
    return { castle, army };
  };
  return { events, villageEntity, centreOf, days, submit, has, last, makeColumn, placeArmy, fellCapital };
}

const ownerOf = (c: ReturnType<typeof composeCampaign>, vi: number): number => {
  const VillageOwner = c.kingdomGame.VillageOwner;
  assert.ok(VillageOwner !== undefined);
  return c.world.read(VillageOwner).kingdom[vi] as number;
};

// ---------------- 1. vassalage-first ----------------

test('capital fall, trusting court: capitulation — the banner survives as a vassal, war over', () => {
  const c = compose({ trust: 1 });
  const d = driver(c);
  c.kernel.step(); // genesis
  const k0 = c.kingdomGame.kingdomEntities()[0] as number;
  const k1 = c.kingdomGame.kingdomEntities()[1] as number;

  const { castle } = d.fellCapital(1, 0);
  assert.equal(ownerOf(c, castle), k0, 'the fall does NOT flip ownership — the fate is pending');

  d.days(2); // the succession daily pass evaluates and swears the loser in
  assert.ok(d.has('kingdom.capitulated'), 'the trusting court submitted');
  assert.ok(!d.has('kingdom.destroyed'), 'no destruction on the capitulation path');
  assert.equal(ownerOf(c, castle), k0, 'the capital keeps its banner');
  assert.equal(c.diplomacyGame.state.lordOf(k0), k1, 'fealty sworn to the conqueror');
  assert.ok(!c.diplomacyGame.state.isAtWar(k0, k1), 'the war ended with the homage');
  assert.equal(d.last('siege.ended')?.data['reason'], 'capitulated');
  assert.ok(!c.victoryGame.isDefeated(k0 as never), 'a vassal is not a defeated kingdom');
});

// ---------------- 2. refusal → destruction, loot under capOf ----------------

test('capital fall, defiant court: destruction — loot ledgered, excess burned, realm annexed', () => {
  const c = compose({ trust: 0 });
  const d = driver(c);
  c.kernel.step();
  const k0 = c.kingdomGame.kingdomEntities()[0] as number;
  const k1 = c.kingdomGame.kingdomEntities()[1] as number;
  const VillageOwner = c.kingdomGame.VillageOwner;
  assert.ok(VillageOwner !== undefined);

  // a second k0 village, so annexation has something to seize
  const cap0 = c.villageOf(0) as number;
  const home = d.centreOf(cap0);
  // wide box centred on the capital — validatePlacement's own min-spacing rule
  // excludes anything too close, so the best hit is a legal second settlement
  const site = bestSiteNear(c.game, c.db, home.x, home.y, 40);
  assert.ok(site !== null, 'a second founding site exists');
  d.submit('village.found', { x: site.x, y: site.y, name: 'Annexme' }, 1);
  let secondVi = -1;
  c.world.query([c.game.comps.VillageCore]).forEach((vi) => {
    if (vi !== cap0 && vi !== (c.villageOf(1) as number)) secondVi = vi;
  });
  assert.ok(secondVi >= 0, 'second village founded');
  c.world.attach(d.villageEntity(secondVi) as never, VillageOwner, { kingdom: k0 });

  // a worthwhile treasury and an overfull stockpile: stone beyond the winner's headroom must burn
  const K = c.world.write(c.kingdomGame.Kingdom);
  K.treasury[index(k0)] = 500;
  // the hoard dwarfs anything a few days of AI economy can produce or spend, so the
  // excess-over-capOf is guaranteed no matter how both stockpiles drift before the sack.
  // PLANKS: the winner starts at 0 of them under a 150 cap, so the sack demonstrably
  // BOTH carries (into real headroom) and burns (the rest) — stone would carry nothing,
  // since genesis starting stock already overfills the base stone cap.
  const planksCode = c.game.ops.resourceCode('base:resource.planks') as number;
  const cap1 = c.villageOf(1) as number;
  const hoard = 100_000;
  c.world.writeObj(c.game.comps.Stockpile).get(cap0).set(planksCode, hoard);

  const { castle } = d.fellCapital(1, 0);
  d.days(2); // trust 0 refuses at the exhaustion floor → destruction, no need to wait the window out

  assert.ok(d.has('kingdom.destroyed'), 'the defiant court burned');
  assert.ok(!d.has('kingdom.capitulated'));
  assert.equal(d.villageEntity(castle), -1, 'the capital was razed — gone from the world');
  assert.ok(d.has('village.razed'));

  // loot: gold whole + ledgered; stone carried to capOf, the rest burned and reported.
  // Daily flows (taxes, salaries) move both treasuries between setup and sack, so the
  // assertions target the sack's OWN accounting: the event, the ledger, the emptied loser.
  const sacked = d.last('siege.sacked');
  assert.ok(sacked !== undefined);
  const sackedGold = Number(sacked.data['gold']);
  assert.ok(sackedGold > 0, 'the treasury was worth sacking');
  assert.equal(c.world.read(c.kingdomGame.Kingdom).treasury[index(k0)], 0, 'the loser treasury emptied — transferred whole');
  assert.ok(
    c.kingdomGame.ledger.entries().some((e) => e.kind === 'loot' && e.amount === sackedGold),
    'the sack is ledger-explicit, at the exact sacked amount',
  );
  const planksLine = (sacked.data['loot'] as { res: string; carried: number; burned: number }[]).find(
    (l) => l.res === 'base:resource.planks',
  );
  assert.ok(planksLine !== undefined, 'planks reported in the sack');
  assert.ok(planksLine.carried > 0, 'headroom was filled — some of the hoard was carried off');
  assert.ok(planksLine.burned >= hoard * 0.9, `the overflow burned (burned ${planksLine.burned})`);
  assert.ok(
    (c.world.readObj(c.game.comps.Stockpile).tryGet(cap1)?.get(planksCode) ?? 0) <= c.econGame.capOf(cap1, planksCode),
    'the winner respected its own capOf',
  );

  // the realm is seized; the kingdom is dead
  assert.equal(ownerOf(c, secondVi), k1, 'the second village passed to the conqueror');
  d.days(1);
  assert.ok(c.victoryGame.isDefeated(k0 as never), 'last-village defeat follows the seizure');
  assert.ok(c.successionGame !== null && c.successionGame.state.deaths.has(0), 'the death tick is recorded');
  // its hosts dissolved
  let k0Units = 0;
  const u = c.world.read(c.militaryGame.Unit);
  c.world.query([c.militaryGame.Unit]).forEach((ui) => {
    if ((u.kingdomId[ui] as number) === k0) k0Units++;
  });
  assert.equal(k0Units, 0, 'no zombie units under a struck banner');
});

// ---------------- 3. ironman ----------------

test('ironman: a fallen capital ends the lord outright — no window, no offer, AI lords included', () => {
  const c = compose({ trust: 1, ironman: true }); // trust 1 WOULD submit — ironman never asks
  const d = driver(c);
  c.kernel.step();
  d.fellCapital(1, 0);
  d.days(2);
  assert.ok(d.has('kingdom.destroyed'), 'destroyed under ironman');
  assert.ok(!d.has('kingdom.capitulated'), 'no capitulation path under ironman');
  assert.ok(!d.has('siege.capitulationOffered'), 'no offer under ironman');
});

// ---------------- 4. the human attacker's choice ----------------

test('human attacker: homage is offered once, acceptance is a command, silence is the sack', () => {
  // aiFromIndex 1: kingdom 0 is human. The human fells the AI capital.
  const c = compose({ trust: 1, aiFromIndex: 1 });
  const d = driver(c);
  c.kernel.step();
  const k0 = c.kingdomGame.kingdomEntities()[0] as number;
  const k1 = c.kingdomGame.kingdomEntities()[1] as number;

  const { castle } = d.fellCapital(0, 1);
  d.days(2);
  assert.ok(d.has('siege.capitulationOffered'), 'the fallen court offered homage to the human');
  assert.ok(!d.has('kingdom.capitulated'), 'nothing auto-accepted on the human side');
  assert.equal(d.events.filter((e) => e.type === 'siege.capitulationOffered').length, 1, 'offered exactly once');

  d.submit('siege.acceptCapitulation', { castle }, 1);
  assert.ok(d.has('kingdom.capitulated'), 'acceptance by command');
  assert.equal(c.diplomacyGame.state.lordOf(k1), k0, 'the AI court is now the human lord\'s vassal');

  // and the silent variant: a fresh world where the human never answers
  const c2 = compose({ trust: 1, aiFromIndex: 1 });
  const d2 = driver(c2);
  c2.kernel.step();
  d2.fellCapital(0, 1);
  d2.days(CAPITULATION_WINDOW_DAYS + 2);
  assert.ok(d2.has('kingdom.destroyed'), 'silence until the deadline is refusal — the city burned');
});

// ---------------- 5. new lords rising ----------------

test('a new banner rises on the vacant heartland after the cooldown, politically blank', () => {
  const c = compose({ trust: 0 });
  const d = driver(c);
  c.kernel.step();
  const k0 = c.kingdomGame.kingdomEntities()[0] as number;
  const k1 = c.kingdomGame.kingdomEntities()[1] as number;

  d.fellCapital(1, 0);
  d.days(3);
  assert.ok(d.has('kingdom.destroyed'));
  d.days(1);
  assert.ok(c.victoryGame.isDefeated(k0 as never));

  // collapse the two-year mourning clock (the cooldown constant is design truth;
  // the test only fast-forwards the recorded death tick)
  assert.ok(c.successionGame !== null);
  c.successionGame.state.deaths.set(0, -(1 << 24));
  d.days(2);

  assert.ok(d.has('kingdom.newLordRisen'), 'a new banner rose');
  const risen = d.last('kingdom.newLordRisen');
  assert.equal(risen?.data['kingdom'], k0, 'in the dead slot');
  assert.ok(c.villageOf(0) !== null, 'the capital binding follows the riser');
  assert.ok(!c.victoryGame.isDefeated(k0 as never), 'the defeat mark cleared');
  assert.equal(c.diplomacyGame.state.lordOf(k0), undefined, 'no inherited fealty');
  assert.ok(!c.diplomacyGame.state.isAtWar(k0, k1), 'no inherited wars');
  assert.equal(c.diplomacyGame.state.opinionOf(k0, k1), 0, 'a blank ledger of grudges');
  assert.equal(c.world.read(c.kingdomGame.Kingdom).treasury[index(k0)], STARTING_TREASURY, 'the founding purse');
  assert.ok(!c.successionGame.state.deaths.has(0), 'the vacancy is filled');
});

// ---------------- 6. occupation exemption + persistence ----------------

test('a defence-layer capital cannot be occupied by countdown — the layer is the only way in', () => {
  const c = compose({ trust: 1 });
  const d = driver(c);
  c.kernel.step();

  const castle = c.villageOf(0) as number;
  d.submit('kingdom.declareWar', { targetKingdom: 0, casusBelli: true }, 2);
  const army = d.makeColumn(1, c.villageOf(1) as number);
  const at = d.centreOf(castle);
  d.placeArmy(army, at.x, at.y);
  d.days(OCCUPATION_DAYS + 3);
  assert.ok(
    !d.events.some((e) => e.type === 'village.occupied' && e.data['village'] === castle),
    'the countdown never takes a layer capital',
  );
});

test('a frozen fallen siege survives save/load in lockstep; siege v1 saves migrate', () => {
  const original = compose({ trust: 1, aiFromIndex: 1 }); // human attacker: the window stays open
  const d = driver(original);
  original.kernel.step();
  d.fellCapital(0, 1);
  d.days(1);

  const save = original.saves.snapshot();
  assert.ok(save.sections['succession'] !== undefined, 'succession section present');
  assert.equal(save.sections['siege']?.version, 3);

  const loaded = compose({ trust: 1, aiFromIndex: 1 });
  const report = loaded.saves.hydrate(JSON.parse(JSON.stringify(save)) as typeof save);
  assert.deepEqual(report, []);
  assert.equal(loaded.kernel.stateHash(), original.kernel.stateHash(), 'hash-identical after hydration');
  for (let t = 0; t < TICKS_PER_DAY * 3; t++) {
    original.kernel.step();
    loaded.kernel.step();
  }
  assert.equal(loaded.kernel.stateHash(), original.kernel.stateHash(), 'lockstep through the window');

  // a v1 siege section (pre-M53, pre-M55) migrates through BOTH steps: v1→v2 adds
  // fallenDeadline; v2→v3 drops the legacy breach-gated fields. A genuine v1 save
  // carries targetBuilding/breaches (the current save, post-M55, never does) — they are
  // synthesized back in here so the v2→v3 step is actually exercised, not a no-op on
  // fields that were never there.
  const v1 = JSON.parse(JSON.stringify(save)) as typeof save;
  const siegeSection = v1.sections['siege'] as { version: number; data: Record<string, number>[] };
  siegeSection.version = 1;
  for (const s of siegeSection.data) {
    delete s['fallenDeadline'];
    s['targetBuilding'] = 0;
    s['breaches'] = 0;
  }
  delete v1.sections['succession'];
  const migrated = compose({ trust: 1, aiFromIndex: 1 });
  const migrationReport = migrated.saves.hydrate(v1);
  assert.ok(migrationReport.some((line) => line.includes('siege: migrated v1 → v2')), JSON.stringify(migrationReport));
  assert.ok(migrationReport.some((line) => line.includes('siege: migrated v2 → v3')), JSON.stringify(migrationReport));
  const frozen = migrated.siegeGame.state.all().find((s) => s.fallenDeadline !== 0);
  assert.equal(frozen, undefined, 'a migrated v1 siege carries no fallen state');
  assert.ok(migrated.siegeGame.state.all().length > 0, 'the migrated siege survived the v1→v2→v3 chain');
});
