/**
 * Victory & defeat (M37) — roadmap test objective: "each victory achievable
 * in harness ≤ year cap". Each of the 5 tracks (GDD §16) is engineered
 * directly (own conquest by reassigning VillageOwner, own alliances/vassals
 * by calling DiplomacyState directly, force-complete wonder buildings, force
 * happiness/tick advancement) rather than left to an emergent multi-year AI
 * economy — the same lesson M36's blind fingerprint test learned: this
 * proves the TRACKER logic correctly detects and bounds each condition,
 * which is what "victory & defeat" as a system means; whether the real
 * economy organically reaches these states is a separate balance concern
 * (M46), not this milestone's.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TICKS_PER_DAY, TICKS_PER_YEAR } from '../time.js';
import { composeMultiKingdom, type MultiKingdomComposition } from '../ai/multiKingdomHarness.js';
import { registerVictoryGameplay, DEFAULT_YEAR_LIMIT, type VictoryGameplay, type VictoryOptions } from './victory.js';

const STARTING_POPULATION = { children: 10, adults: 30, elders: 5 };

function makeRealm(kingdomCount: number, options: VictoryOptions, mapSize = 135) {
  const composed: MultiKingdomComposition = composeMultiKingdom({
    seed: 370,
    kingdomCount,
    mapSize,
    aiFromIndex: kingdomCount, // no AI at all — every state change in these tests is deliberate
    startingPopulation: STARTING_POPULATION,
  });
  const victoryGame: VictoryGameplay = registerVictoryGameplay(
    composed.kernel, composed.world, composed.db, composed.game, composed.popGame, composed.kingdomGame,
    { diplomacy: composed.diplomacyGame, research: composed.researchGame },
    options,
  );
  composed.kernel.step(); // tick 1: genesis (kingdoms + villages founded)

  const kingdomIds = composed.kingdomGame.kingdomEntities().map((e) => e as number);
  const villageOf = (k: number): number => composed.villageOf(k) as number;
  /** `composed.villageOf` returns a dense INDEX; commands like `village.build` need the actual
   * entity id, so resolve it by matching that index against a fresh query. */
  const villageEntityOf = (k: number): number => {
    const wantIndex = villageOf(k);
    let entityId = -1;
    composed.world.query([composed.game.comps.VillageCore]).forEach((vi, entity) => {
      if (vi === wantIndex) entityId = entity as number;
    });
    return entityId;
  };

  const events: { type: string; data: unknown }[] = [];
  for (const type of ['victory.achieved', 'victory.approaching', 'defeat.kingdom']) {
    composed.kernel.subscribe(type, (e) => events.push({ type, data: e.data }));
  }

  const days = (n: number): void => {
    for (let i = 0; i < n * TICKS_PER_DAY; i++) composed.kernel.step();
  };
  const years = (n: number): void => {
    for (let i = 0; i < n * TICKS_PER_YEAR; i++) composed.kernel.step();
  };

  return { ...composed, victoryGame, kingdomIds, villageOf, villageEntityOf, events, days, years };
}

// ---------------------------------------------------------------- conquest

test('conquest: controlling the required village share wins, within the year cap', () => {
  const r = makeRealm(3, { enabled: ['conquest'] });
  const [a, , c] = r.kingdomIds;
  // reassign every village to `a` directly — this test proves the TRACKER threshold math,
  // not that conquest emerges from real war
  const owner = r.world.write(r.kingdomGame.VillageOwner as NonNullable<typeof r.kingdomGame.VillageOwner>);
  r.world.query([r.game.comps.VillageCore]).forEach((vi) => {
    owner.kingdom[vi] = a as number;
  });
  r.days(1);
  assert.equal(r.victoryGame.winner()?.type, 'conquest');
  assert.equal(r.victoryGame.winner()?.kingdomId, a);
  assert.ok((r.victoryGame.winner()?.tick ?? Infinity) <= DEFAULT_YEAR_LIMIT * TICKS_PER_YEAR);
  void c;
});

test('conquest: eliminating every rival wins even below the village-share threshold', () => {
  const r = makeRealm(2, { enabled: ['conquest'], conquestShare: 0.99 }); // share alone is unreachable with 2 kingdoms
  const [a, b] = r.kingdomIds;
  const bVillage = r.villageOf(1);
  r.world.despawn(bVillage as never);
  r.days(1);
  assert.equal(r.victoryGame.winner()?.type, 'conquest');
  assert.equal(r.victoryGame.winner()?.kingdomId, a);
  assert.ok(r.victoryGame.isDefeated(b as never));
});

test('conquest: contestability broadcasts once progress crosses 80% of the threshold', () => {
  // 8 villages total: owning 4/8 (share 0.5) is 83% of the way to the 0.6 default threshold —
  // past APPROACHING_FRACTION (0.8) but short of actually winning. Needs 8 for the granularity;
  // 3-way splits can't land a discrete village count strictly between 48% and 60%.
  const r = makeRealm(8, { enabled: ['conquest'] }, 260);
  const [a] = r.kingdomIds;
  const owner = r.world.write(r.kingdomGame.VillageOwner as NonNullable<typeof r.kingdomGame.VillageOwner>);
  for (const k of [1, 2, 3]) owner.kingdom[r.villageOf(k)] = a as number; // a now owns 4 of 8
  r.days(1);
  assert.ok(r.events.some((e) => e.type === 'victory.approaching' && (e.data as { kingdomId: number }).kingdomId === a));
  assert.notEqual(r.victoryGame.winner()?.type, 'conquest', 'not yet at the full 0.6 threshold');
});

// ---------------------------------------------------------------- hegemony

test('hegemony: every rival allied or vassal, sustained for the required years, wins', () => {
  const r = makeRealm(3, { enabled: ['hegemony'], hegemonyYears: 1 });
  const [a, b, c] = r.kingdomIds;
  r.diplomacyGame.state.addPact(a as number, b as number, 'alliance');
  r.diplomacyGame.state.establishVassalage(c as number, a as number);
  r.years(1);
  r.days(1);
  assert.equal(r.victoryGame.winner()?.type, 'hegemony');
  assert.equal(r.victoryGame.winner()?.kingdomId, a);
});

test('hegemony: a broken alliance resets the streak — no shortcut through a lapse', () => {
  const r = makeRealm(3, { enabled: ['hegemony'], hegemonyYears: 1 });
  const [a, b, c] = r.kingdomIds;
  r.diplomacyGame.state.addPact(a as number, b as number, 'alliance');
  r.diplomacyGame.state.establishVassalage(c as number, a as number);
  const halfYear = Math.floor((TICKS_PER_YEAR / TICKS_PER_DAY) / 2);
  r.days(halfYear);
  r.diplomacyGame.state.removePact(a as number, b as number, 'alliance'); // lapse
  r.days(1);
  r.diplomacyGame.state.addPact(a as number, b as number, 'alliance'); // re-bound, but the streak restarts
  r.days(halfYear); // would have cleared a 1-year streak if it hadn't reset
  assert.notEqual(r.victoryGame.winner()?.type, 'hegemony');
});

// ---------------------------------------------------------------- legacy

test('legacy: completing the Grand Wonder chain (3 distinct wonders) wins', () => {
  const r = makeRealm(1, { enabled: ['legacy'], wonderCount: 3 });
  const [a] = r.kingdomIds;
  const vi = r.villageOf(0);
  r.world.write(r.game.comps.VillageCore).tier[vi] = 2; // wonders require villageTier 2 (the max reachable, M15)

  const stock = r.world.writeObj(r.game.comps.Stockpile).get(vi) as Map<number, number>;
  for (const resId of ['base:resource.stone', 'base:resource.tools', 'base:resource.planks']) {
    stock.set(r.game.ops.resourceCode(resId) as number, 10_000);
  }

  const core = r.world.read(r.game.comps.VillageCore);
  const cx = core.centerX[vi] as number;
  const cy = core.centerY[vi] as number;
  const wonders = ['base:building.wonder-observatory', 'base:building.wonder-cathedral', 'base:building.wonder-archive'];
  const offsets = [
    { x: -6, y: -6 }, { x: 6, y: -6 }, { x: 0, y: 6 },
  ];
  for (let i = 0; i < wonders.length; i++) {
    const def = wonders[i] as string;
    const off = offsets[i] as { x: number; y: number };
    r.kernel.submit({ type: 'village.build', issuer: 1, payload: { villageId: r.villageEntityOf(0), def, x: cx + off.x, y: cy + off.y } });
    r.kernel.step();
    // force-complete: the construction system finishes anything already at progress 1 on its next hourly tick
    const b = r.world.write(r.game.comps.BuildingCore);
    r.world.query([r.game.comps.BuildingCore]).forEach((bi) => {
      if (r.game.ops.buildingDef(b.def[bi] as number).id === def && (b.complete[bi] as number) !== 1) b.progress[bi] = 1;
    });
    r.kernel.step();
  }
  r.days(1); // the tracker itself runs on a daily cadence — give it a chance to observe the completions
  assert.equal(r.victoryGame.winner()?.type, 'legacy');
  assert.equal(r.victoryGame.winner()?.kingdomId, a);
});

// ---------------------------------------------------------------- prosperity

test('prosperity: sustained realm-wide happiness for the required years wins', () => {
  const r = makeRealm(1, { enabled: ['prosperity'], prosperityYears: 1, prosperityHappiness: 70 });
  const [a] = r.kingdomIds;
  const vi = r.villageOf(0);
  const daysPerYear = TICKS_PER_YEAR / TICKS_PER_DAY;
  // re-forced every day: happiness is a real, simulated stat (needs/tax-driven) that drifts on
  // its own — this test is about the TRACKER's streak logic, not sustaining a real economy
  for (let d = 0; d < daysPerYear + 1; d++) {
    r.world.write(r.popGame.Population).happiness[vi] = 80;
    r.days(1);
  }
  assert.equal(r.victoryGame.winner()?.type, 'prosperity');
  assert.equal(r.victoryGame.winner()?.kingdomId, a);
});

test('prosperity: a happiness dip resets the streak', () => {
  const r = makeRealm(1, { enabled: ['prosperity'], prosperityYears: 1, prosperityHappiness: 70 });
  const vi = r.villageOf(0);
  const halfYear = Math.floor((TICKS_PER_YEAR / TICKS_PER_DAY) / 2);
  r.world.write(r.popGame.Population).happiness[vi] = 80;
  r.days(halfYear);
  r.world.write(r.popGame.Population).happiness[vi] = 40; // dip
  r.days(1);
  r.world.write(r.popGame.Population).happiness[vi] = 80; // recovers, but the streak restarted
  r.days(halfYear);
  assert.notEqual(r.victoryGame.winner()?.type, 'prosperity');
});

// ---------------------------------------------------------------- chronicle

test('chronicle: at the year cap, the surviving kingdom with the highest prestige wins', () => {
  const r = makeRealm(2, { enabled: ['chronicle'], yearLimit: 1 });
  const [a, b] = r.kingdomIds;
  const viA = r.villageOf(0);
  r.world.write(r.popGame.Population).adults[viA] = 500; // clearly higher prestige than b
  r.years(1);
  r.days(1);
  assert.equal(r.victoryGame.winner()?.type, 'chronicle');
  assert.equal(r.victoryGame.winner()?.kingdomId, a);
  assert.ok(r.victoryGame.prestigeOf(a as never) > r.victoryGame.prestigeOf(b as never));
});

// ---------------------------------------------------------------- defeat

test('defeat: the last-village rule fires once, and a defeated kingdom drops out of Hegemony bookkeeping', () => {
  const r = makeRealm(3, { enabled: ['hegemony'], hegemonyYears: 1 });
  const [a, b, c] = r.kingdomIds;
  const bVillage = r.villageOf(1);
  r.world.despawn(bVillage as never);
  r.days(1);
  assert.ok(r.events.some((e) => e.type === 'defeat.kingdom' && (e.data as { kingdomId: number }).kingdomId === b));
  assert.ok(r.victoryGame.isDefeated(b as never));

  // a only needs to bind SURVIVING rivals (c) — b is gone, not a rival to satisfy
  r.diplomacyGame.state.establishVassalage(c as number, a as number);
  r.years(1);
  r.days(1);
  assert.equal(r.victoryGame.winner()?.type, 'hegemony');
  assert.equal(r.victoryGame.winner()?.kingdomId, a);
});

// ---------------------------------------------------------------- sandbox mode (GDD §17)

test('sandbox: enabled=[] never declares victory; defeatEnabled=false never declares defeat', () => {
  const r = makeRealm(2, { enabled: [], defeatEnabled: false });
  const [, b] = r.kingdomIds;
  const bVillage = r.villageOf(1);
  r.world.despawn(bVillage as never);
  r.years(2);
  assert.equal(r.victoryGame.winner(), null);
  assert.ok(!r.victoryGame.isDefeated(b as never));
});

// ---------------------------------------------------------------- determinism

test('determinism: victory tracking folds identically for the same sequence of state changes', () => {
  const run = (): number => {
    const r = makeRealm(3, { enabled: ['hegemony'], hegemonyYears: 1 });
    const [a, b, c] = r.kingdomIds;
    r.diplomacyGame.state.addPact(a as number, b as number, 'alliance');
    r.diplomacyGame.state.establishVassalage(c as number, a as number);
    r.years(1);
    r.days(1);
    return r.kernel.stateHash();
  };
  assert.equal(run(), run());
});
