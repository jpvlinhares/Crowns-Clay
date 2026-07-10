/**
 * Diplomacy v1 (M23) — roadmap test objective: "deal-value symmetry tests;
 * exploit fuzzing". Covers opinion clamping and gift-spam caps under fuzzed
 * command sequences, deal-evaluator symmetry, affordability, and fog-gating.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DefinitionDatabase, BASE_CONTENT_FILES } from '@crowns/data';
import { Kernel } from '../kernel.js';
import { World } from '../ecs.js';
import { registerVillageGameplay, type TerrainAccessor } from './villages.js';
import { registerPopulationGameplay } from './population.js';
import { registerEconomyGameplay } from './economy.js';
import { registerKingdomGameplay, StatModifiers } from './kingdom.js';
import { TICKS_PER_DAY } from '../time.js';
import {
  registerDiplomacyGameplay,
  evaluateDeal,
  evaluatePeaceDeal,
  trustFactor,
  personalityMargin,
  DiplomacyState,
  GIFT_COOLDOWN_TICKS,
  INSULT_COOLDOWN_TICKS,
  MAX_GIFT_OPINION,
  WAR_DECLARED_OPINION_PENALTY,
  WAR_DECLARED_NO_CAUSE_PENALTY,
  WAR_EXHAUSTION_PER_DAY,
  FORCED_PEACE_EXHAUSTION,
  type DealEvaluation,
} from './diplomacy.js';

const plain: TerrainAccessor = {
  width: 64,
  height: 64,
  tagsAt: () => ['open', 'farmable', 'mineable', 'woodland'],
  riverAt: () => false,
  movementCostAt: () => 1,
};

function makeTwoKingdoms(discovered = true) {
  const kernel = new Kernel(3);
  const world = new World(256);
  const db = DefinitionDatabase.load(BASE_CONTENT_FILES);
  const game = registerVillageGameplay(kernel, world, db, plain, {});
  const popGame = registerPopulationGameplay(kernel, world, db, game, { children: 2, adults: 5, elders: 1 });
  const econGame = registerEconomyGameplay(kernel, world, db, game);
  const kingdomGame = registerKingdomGameplay(kernel, world, db, game, popGame, econGame, new StatModifiers(), {
    kingdomCount: 2,
  });
  kernel.attachGuard(world);
  kernel.addHashSource('world', (fold) => world.hash(fold));

  const diplomacyGame = registerDiplomacyGameplay(kernel, world, kingdomGame, {
    hasDiscovered: () => discovered,
    personalityOf: () => ({ diplomacyTrust: 0.5 }),
  });

  kernel.registerSystem({
    name: 'genesis',
    period: 0x7fffffff,
    phase: 1,
    access: { writes: [kingdomGame.Kingdom] }, // no villages needed for these tests
    update() {
      const k = world.write(kingdomGame.Kingdom);
      const a = kingdomGame.kingdomEntities()[0] as number;
      k.treasury[a & 0x3fffff] = 500;
    },
  });

  return { kernel, world, kingdomGame, diplomacyGame };
}

const submit = (kernel: Kernel, type: string, issuer: number, payload: unknown): void => {
  kernel.submit({ type, issuer, payload });
  kernel.step();
};

// ---------------------------------------------------------------- deal evaluator symmetry

test('evaluateDeal: a pure function of (opinion, type, weights) — no notion of "who is asking"', () => {
  const weights = { diplomacyTrust: 0.7 };
  const a: DealEvaluation = evaluateDeal(20, 'nonAggression', weights);
  const b: DealEvaluation = evaluateDeal(20, 'nonAggression', weights);
  assert.deepEqual(a, b);
});

test('DiplomacyState: opinion is symmetric regardless of argument order', () => {
  const state = new DiplomacyState();
  state.applyGift(1, 2, 100, 10);
  assert.equal(state.opinionOf(1, 2), state.opinionOf(2, 1));
  state.applyInsult(2, 1, 20);
  assert.equal(state.opinionOf(1, 2), state.opinionOf(2, 1));
});

test('trustFactor / personalityMargin stay within their documented bounds', () => {
  for (const opinion of [-100, -50, 0, 50, 100]) {
    const tf = trustFactor(opinion);
    assert.ok(tf >= 0.6 && tf <= 1.4);
  }
  for (const trust of [0, 0.5, 1]) {
    const margin = personalityMargin({ diplomacyTrust: trust });
    assert.ok(margin >= 0.8 - 1e-9 && margin <= 1.2 + 1e-9); // floating-point epsilon
  }
});

// ---------------------------------------------------------------- peace-deal evaluator sanity (M31)

test('evaluatePeaceDeal: a pure function of (exhaustion, tribute, weights) — no notion of "who is asking"', () => {
  const weights = { diplomacyTrust: 0.7 };
  const a: DealEvaluation = evaluatePeaceDeal(50, 100, weights);
  const b: DealEvaluation = evaluatePeaceDeal(50, 100, weights);
  assert.deepEqual(a, b);
});

test('evaluatePeaceDeal: value rises monotonically with exhaustion and with tribute', () => {
  const weights = { diplomacyTrust: 0.5 };
  const low = evaluatePeaceDeal(10, 0, weights);
  const high = evaluatePeaceDeal(90, 0, weights);
  assert.ok(high.value > low.value);

  const noTribute = evaluatePeaceDeal(50, 0, weights);
  const withTribute = evaluatePeaceDeal(50, 200, weights);
  assert.ok(withTribute.value > noTribute.value);
});

test('evaluatePeaceDeal: exhaustion is clamped to [0, 100] and tribute never reduces value', () => {
  const weights = { diplomacyTrust: 0.5 };
  assert.equal(evaluatePeaceDeal(-50, 0, weights).value, 0);
  assert.equal(evaluatePeaceDeal(150, 0, weights).value, evaluatePeaceDeal(100, 0, weights).value);
  assert.equal(evaluatePeaceDeal(50, -100, weights).value, evaluatePeaceDeal(50, 0, weights).value);
});

test('evaluatePeaceDeal: a fully exhausted war (100) alone clears the base threshold regardless of trust', () => {
  for (const trust of [0, 0.5, 1]) {
    const evaluation = evaluatePeaceDeal(100, 0, { diplomacyTrust: trust });
    assert.ok(evaluation.accept, `exhaustion=100 should be enough to accept peace at trust=${trust}`);
  }
});

// ---------------------------------------------------------------- opinion clamping & exploit fuzzing

test('exploit fuzzing: opinion never leaves [-100, 100] under a fuzzed gift/insult sequence', () => {
  const state = new DiplomacyState();
  let tick = 0;
  // deterministic pseudo-fuzz: alternate large gifts and insults at varying, sometimes-rapid intervals
  for (let i = 0; i < 500; i++) {
    tick += (i * 37) % 11; // irregular, sometimes zero, spacing
    if (i % 3 === 0) state.applyGift(1, 2, 10_000, tick); // absurdly large gift
    else state.applyInsult(1, 2, tick);
    const opinion = state.opinionOf(1, 2);
    assert.ok(opinion >= -100 && opinion <= 100, `opinion left bounds at i=${i}: ${opinion}`);
  }
});

test('exploit fuzzing (gift-spam cap): rapid repeat gifts within the cooldown gain nothing beyond one gift', () => {
  const state = new DiplomacyState();
  const soloGiftDelta = state.applyGift(1, 2, 100, 0);
  assert.ok(soloGiftDelta > 0);

  const spammed = new DiplomacyState();
  let total = 0;
  for (let i = 0; i < 50; i++) total += spammed.applyGift(1, 2, 100, i); // 50 gifts, 1 tick apart — all within cooldown after the first
  assert.equal(total, soloGiftDelta, 'spamming within the cooldown should add nothing beyond the first gift');
  assert.ok(spammed.opinionOf(1, 2) <= MAX_GIFT_OPINION);
});

test('gift/insult: a gift after the cooldown window elapses grants a fresh delta', () => {
  const state = new DiplomacyState();
  const first = state.applyGift(1, 2, 100, 0);
  // note: every attempt (even a no-op one) refreshes the cooldown clock — a stronger anti-spam
  // property (an attacker can't escape the cooldown by attempting more often) — so recovery is
  // checked relative to the LAST attempt, not the original gift.
  const afterCooldown = state.applyGift(1, 2, 100, GIFT_COOLDOWN_TICKS + 1);
  assert.ok(first > 0);
  assert.ok(afterCooldown > 0);
});

test('gift/insult: an attempt during the cooldown refreshes the clock (no escaping via more attempts)', () => {
  const state = new DiplomacyState();
  state.applyGift(1, 2, 100, 0);
  const duringCooldown = state.applyGift(1, 2, 100, GIFT_COOLDOWN_TICKS - 1);
  const stillOnCooldown = state.applyGift(1, 2, 100, GIFT_COOLDOWN_TICKS + 1); // < COOLDOWN since the prior attempt
  assert.equal(duringCooldown, 0);
  assert.equal(stillOnCooldown, 0);
});

test('insult: a repeat within the cooldown adds nothing further; recovers after the cooldown elapses', () => {
  const state = new DiplomacyState();
  const first = state.applyInsult(1, 2, 0);
  const second = state.applyInsult(1, 2, INSULT_COOLDOWN_TICKS - 1);
  assert.ok(first < 0);
  assert.equal(second, 0);

  const recovered = new DiplomacyState();
  recovered.applyInsult(1, 2, 0);
  const afterCooldown = recovered.applyInsult(1, 2, INSULT_COOLDOWN_TICKS + 1);
  assert.ok(afterCooldown < 0);
});

// ---------------------------------------------------------------- commands: affordability & fog-gating

test('kingdom.sendGift: rejects atomically when the treasury cannot cover it', () => {
  const { kernel, world, kingdomGame, diplomacyGame } = makeTwoKingdoms();
  kernel.step(); // genesis: treasury seeded to 500

  const rejections: string[] = [];
  kernel.subscribe<{ what: string; reason: string }>('village.rejected', (e) => rejections.push(e.data.reason));

  submit(kernel, 'kingdom.sendGift', 1, { targetKingdom: 1, gold: 10_000 });
  assert.ok(rejections.some((r) => r.includes('insufficient')));

  const kingdomIds = kingdomGame.kingdomEntities();
  const treasuryOf = (i: number): number => world.read(kingdomGame.Kingdom).treasury[(kingdomIds[i] as number) & 0x3fffff] as number;
  assert.equal(treasuryOf(0), 500); // unaffected by the rejected gift
  assert.equal(diplomacyGame.state.opinionOf(kingdomIds[0] as number, kingdomIds[1] as number), 0);
});

test('kingdom.sendGift: succeeds within budget and moves gold + opinion together', () => {
  const { kernel, world, kingdomGame, diplomacyGame } = makeTwoKingdoms();
  kernel.step();
  const kingdomIds = kingdomGame.kingdomEntities();
  const treasuryOf = (i: number): number => world.read(kingdomGame.Kingdom).treasury[(kingdomIds[i] as number) & 0x3fffff] as number;

  // kingdom 1 keeps its own kingdom-genesis starting treasury (100) — the test's custom
  // genesis only overrides kingdom 0's, to 500.
  const targetBefore = treasuryOf(1);
  submit(kernel, 'kingdom.sendGift', 1, { targetKingdom: 1, gold: 100 });
  assert.equal(treasuryOf(0), 400);
  assert.equal(treasuryOf(1), targetBefore + 100);
  assert.ok(diplomacyGame.state.opinionOf(kingdomIds[0] as number, kingdomIds[1] as number) > 0);
});

test('diplomacy commands: reject against a kingdom not yet discovered (M22 fog gate)', () => {
  const { kernel, kingdomGame } = makeTwoKingdoms(false); // hasDiscovered always false
  kernel.step();

  const rejections: string[] = [];
  kernel.subscribe<{ what: string; reason: string }>('village.rejected', (e) => rejections.push(e.data.reason));

  submit(kernel, 'kingdom.sendGift', 1, { targetKingdom: 1, gold: 10 });
  submit(kernel, 'kingdom.sendInsult', 1, { targetKingdom: 1 });
  submit(kernel, 'kingdom.proposePact', 1, { targetKingdom: 1, pactType: 'nonAggression' });

  assert.equal(rejections.filter((r) => r.includes('not yet discovered') || r.includes('not made contact')).length, 3);
  void kingdomGame;
});

test('kingdom.proposePact: accepted pacts are queryable and rejects a duplicate proposal', () => {
  const { kernel, kingdomGame, diplomacyGame } = makeTwoKingdoms();
  kernel.step();
  const kingdomIds = kingdomGame.kingdomEntities();

  const proposals: { accepted: boolean }[] = [];
  kernel.subscribe<{ accepted: boolean }>('diplomacy.pactProposed', (e) => proposals.push(e.data));

  submit(kernel, 'kingdom.proposePact', 1, { targetKingdom: 1, pactType: 'nonAggression' });
  assert.equal(proposals.length, 1);
  assert.ok(proposals[0]?.accepted); // opinion 0 -> napValue(0)=20 >= threshold(15*1*1=15)
  assert.ok(diplomacyGame.state.hasPact(kingdomIds[0] as number, kingdomIds[1] as number, 'nonAggression'));

  const rejections: string[] = [];
  kernel.subscribe<{ what: string; reason: string }>('village.rejected', (e) => rejections.push(e.data.reason));
  submit(kernel, 'kingdom.proposePact', 1, { targetKingdom: 1, pactType: 'nonAggression' });
  assert.ok(rejections.some((r) => r.includes('already active')));
});

test('kingdom.breakPact: removes the pact and applies an opinion penalty', () => {
  const { kernel, kingdomGame, diplomacyGame } = makeTwoKingdoms();
  kernel.step();
  const kingdomIds = kingdomGame.kingdomEntities();
  submit(kernel, 'kingdom.proposePact', 1, { targetKingdom: 1, pactType: 'nonAggression' });
  const opinionBefore = diplomacyGame.state.opinionOf(kingdomIds[0] as number, kingdomIds[1] as number);

  submit(kernel, 'kingdom.breakPact', 1, { targetKingdom: 1, pactType: 'nonAggression' });
  assert.ok(!diplomacyGame.state.hasPact(kingdomIds[0] as number, kingdomIds[1] as number, 'nonAggression'));
  assert.ok(diplomacyGame.state.opinionOf(kingdomIds[0] as number, kingdomIds[1] as number) < opinionBefore);
});

// ---------------------------------------------------------------- war & peace (M31)

test('DiplomacyState: declareWar/makePeace/advanceWarExhaustion — symmetric, clamped, and auto-breaks NAP', () => {
  const state = new DiplomacyState();
  state.addPact(1, 2, 'nonAggression');
  state.declareWar(2, 1); // argument order reversed vs. the pact call — still resolves the same pair
  assert.ok(state.isAtWar(1, 2));
  assert.ok(state.isAtWar(2, 1));
  assert.ok(!state.hasPact(1, 2, 'nonAggression'));

  state.advanceWarExhaustion(1, 2, 40);
  state.advanceWarExhaustion(2, 1, 40);
  assert.equal(state.warExhaustionOf(1, 2), 80);
  assert.equal(state.warExhaustionOf(2, 1), 80);

  const clamped = state.advanceWarExhaustion(1, 2, 1000);
  assert.equal(clamped, 100);

  assert.deepEqual(state.activeWars(), [{ a: 1, b: 2 }]);

  state.makePeace(2, 1);
  assert.ok(!state.isAtWar(1, 2));
  assert.equal(state.warExhaustionOf(1, 2), 0);
  assert.deepEqual(state.activeWars(), []);
});

test('kingdom.declareWar: a claimed casus belli costs less opinion than an unprovoked declaration', () => {
  const { kernel, kingdomGame, diplomacyGame } = makeTwoKingdoms();
  kernel.step();
  const kingdomIds = kingdomGame.kingdomEntities();
  submit(kernel, 'kingdom.declareWar', 1, { targetKingdom: 1, casusBelli: true });
  const withCause = diplomacyGame.state.opinionOf(kingdomIds[0] as number, kingdomIds[1] as number);
  assert.equal(withCause, WAR_DECLARED_OPINION_PENALTY);

  const { kernel: kernel2, kingdomGame: kingdomGame2, diplomacyGame: diplomacyGame2 } = makeTwoKingdoms();
  kernel2.step();
  const kingdomIds2 = kingdomGame2.kingdomEntities();
  submit(kernel2, 'kingdom.declareWar', 1, { targetKingdom: 1 });
  const withoutCause = diplomacyGame2.state.opinionOf(kingdomIds2[0] as number, kingdomIds2[1] as number);
  assert.equal(withoutCause, WAR_DECLARED_NO_CAUSE_PENALTY);
  assert.ok(withCause > withoutCause);
});

test('kingdom.declareWar: sets atWar, auto-breaks an active NAP, and rejects a duplicate declaration', () => {
  const { kernel, kingdomGame, diplomacyGame } = makeTwoKingdoms();
  kernel.step();
  const kingdomIds = kingdomGame.kingdomEntities();
  submit(kernel, 'kingdom.proposePact', 1, { targetKingdom: 1, pactType: 'nonAggression' });
  assert.ok(diplomacyGame.state.hasPact(kingdomIds[0] as number, kingdomIds[1] as number, 'nonAggression'));

  submit(kernel, 'kingdom.declareWar', 1, { targetKingdom: 1, casusBelli: true });
  assert.ok(diplomacyGame.state.isAtWar(kingdomIds[0] as number, kingdomIds[1] as number));
  assert.ok(!diplomacyGame.state.hasPact(kingdomIds[0] as number, kingdomIds[1] as number, 'nonAggression'));

  const rejections: string[] = [];
  kernel.subscribe<{ what: string; reason: string }>('village.rejected', (e) => rejections.push(e.data.reason));
  submit(kernel, 'kingdom.declareWar', 1, { targetKingdom: 1 });
  assert.ok(rejections.some((r) => r.includes('already at war')));
});

test('kingdom.declareWar: rejects self-war and a not-yet-discovered target', () => {
  const { kernel: k1 } = makeTwoKingdoms();
  k1.step();
  const rej1: string[] = [];
  k1.subscribe<{ what: string; reason: string }>('village.rejected', (e) => rej1.push(e.data.reason));
  submit(k1, 'kingdom.declareWar', 1, { targetKingdom: 0 });
  assert.ok(rej1.some((r) => r.includes('cannot declare war on yourself')));

  const { kernel: k2 } = makeTwoKingdoms(false); // hasDiscovered always false
  k2.step();
  const rej2: string[] = [];
  k2.subscribe<{ what: string; reason: string }>('village.rejected', (e) => rej2.push(e.data.reason));
  submit(k2, 'kingdom.declareWar', 1, { targetKingdom: 1 });
  assert.ok(rej2.some((r) => r.includes('not yet discovered')));
});

test('kingdom.proposePeace: rejects when not at war, and when tribute exceeds the treasury', () => {
  const { kernel } = makeTwoKingdoms();
  kernel.step();
  const rejections: string[] = [];
  kernel.subscribe<{ what: string; reason: string }>('village.rejected', (e) => rejections.push(e.data.reason));

  submit(kernel, 'kingdom.proposePeace', 1, { targetKingdom: 1 });
  assert.ok(rejections.some((r) => r.includes('not at war')));

  submit(kernel, 'kingdom.declareWar', 1, { targetKingdom: 1, casusBelli: true });
  submit(kernel, 'kingdom.proposePeace', 1, { targetKingdom: 1, tribute: 10_000 });
  assert.ok(rejections.some((r) => r.includes('insufficient gold for tribute')));
});

test('kingdom.proposePeace: a weak offer is rejected (war continues); a sweetened one ends the war and pays tribute', () => {
  const { kernel, world, kingdomGame, diplomacyGame } = makeTwoKingdoms();
  kernel.step();
  const kingdomIds = kingdomGame.kingdomEntities();
  const treasuryOf = (i: number): number => world.read(kingdomGame.Kingdom).treasury[(kingdomIds[i] as number) & 0x3fffff] as number;

  submit(kernel, 'kingdom.declareWar', 1, { targetKingdom: 1, casusBelli: true });
  assert.ok(diplomacyGame.state.isAtWar(kingdomIds[0] as number, kingdomIds[1] as number));

  // fresh war (exhaustion 0), no tribute: value 0 < threshold — a weak offer is rejected, war continues
  const proposals: { accepted: boolean }[] = [];
  kernel.subscribe<{ accepted: boolean }>('diplomacy.peaceProposed', (e) => proposals.push(e.data));
  submit(kernel, 'kingdom.proposePeace', 1, { targetKingdom: 1 });
  assert.equal(proposals[0]?.accepted, false);
  assert.ok(diplomacyGame.state.isAtWar(kingdomIds[0] as number, kingdomIds[1] as number));

  // sweeten it with enough tribute to clear the threshold
  const targetBefore = treasuryOf(1);
  const proposerBefore = treasuryOf(0);
  submit(kernel, 'kingdom.proposePeace', 1, { targetKingdom: 1, tribute: 300 });
  assert.equal(proposals[1]?.accepted, true);
  assert.ok(!diplomacyGame.state.isAtWar(kingdomIds[0] as number, kingdomIds[1] as number));
  assert.equal(treasuryOf(0), proposerBefore - 300);
  assert.equal(treasuryOf(1), targetBefore + 300);
});

test('war exhaustion: a war neither side ends is FORCED to peace once exhaustion caps out (no forever-wars)', () => {
  const { kernel, kingdomGame, diplomacyGame } = makeTwoKingdoms();
  kernel.step();
  const kingdomIds = kingdomGame.kingdomEntities();
  submit(kernel, 'kingdom.declareWar', 1, { targetKingdom: 1, casusBelli: true });
  assert.ok(diplomacyGame.state.isAtWar(kingdomIds[0] as number, kingdomIds[1] as number));

  const forced: unknown[] = [];
  kernel.subscribe('diplomacy.peaceForced', (e) => forced.push(e));

  // reaches FORCED_PEACE_EXHAUSTION in ~90 days, unaided by any peace proposal from either side
  const days = Math.ceil(FORCED_PEACE_EXHAUSTION / WAR_EXHAUSTION_PER_DAY) + 1;
  for (let i = 0; i < days * TICKS_PER_DAY; i++) kernel.step();

  assert.ok(forced.length > 0, 'expected the war to be forcibly ended by exhaustion');
  assert.ok(!diplomacyGame.state.isAtWar(kingdomIds[0] as number, kingdomIds[1] as number));
});

test('determinism: DiplomacyState.fold produces the same hash for the same sequence of commands', () => {
  const run = (): number => {
    const { kernel } = makeTwoKingdoms();
    kernel.step();
    submit(kernel, 'kingdom.sendGift', 1, { targetKingdom: 1, gold: 50 });
    submit(kernel, 'kingdom.proposePact', 1, { targetKingdom: 1, pactType: 'nonAggression' });
    return kernel.stateHash();
  };
  assert.equal(run(), run());
});
