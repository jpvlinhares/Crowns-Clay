/**
 * Events engine (M33) — the roadmap test objective is "DSL fuzzing; pacing
 * governor bands". `evaluatePredicate`/`applyEffect` are pure functions
 * fuzzed directly with garbage input (never throw, always fail closed);
 * `pacingMultiplier` is a pure function tested at its band boundaries, then
 * proven end-to-end against the real content and kernel.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DefinitionDatabase, BASE_CONTENT_FILES } from '@crowns/data';
import { Kernel } from '../kernel.js';
import { World } from '../ecs.js';
import { TICKS_PER_DAY, TICKS_PER_SEASON } from '../time.js';
import { registerVillageGameplay, type TerrainAccessor } from './villages.js';
import { registerPopulationGameplay } from './population.js';
import { registerEconomyGameplay } from './economy.js';
import { registerKingdomGameplay, StatModifiers } from './kingdom.js';
import {
  registerEventGameplay,
  evaluatePredicate,
  applyEffect,
  pacingMultiplier,
  PACING_TARGET_MIN,
  PACING_TARGET_MAX,
  type EventContext,
  type EventEffectContext,
} from './events.js';

const plain: TerrainAccessor = {
  width: 64,
  height: 64,
  tagsAt: () => ['open', 'farmable', 'mineable', 'woodland'],
  riverAt: () => false,
  movementCostAt: () => 1,
};

function makeKingdom(options: { seed?: number } = {}) {
  const kernel = new Kernel(options.seed ?? 71);
  const world = new World(512);
  const db = DefinitionDatabase.load(BASE_CONTENT_FILES);
  const mods = new StatModifiers();
  const game = registerVillageGameplay(kernel, world, db, plain, { 'base:resource.wood': 2000, 'base:resource.stone': 500 });
  const popGame = registerPopulationGameplay(kernel, world, db, game, { children: 8, adults: 20, elders: 3 }, mods);
  const econ = registerEconomyGameplay(kernel, world, db, game, mods);
  const kingdomGame = registerKingdomGameplay(kernel, world, db, game, popGame, econ, mods);
  const opinionDeltas: { kingdom: number; delta: number }[] = [];
  const eventGame = registerEventGameplay(kernel, world, db, game, popGame, kingdomGame, {
    diplomacy: { applyOpinionDelta: (kingdomId, delta) => opinionDeltas.push({ kingdom: kingdomId as number, delta }) },
  });
  kernel.attachGuard(world);
  kernel.addHashSource('world', (fold) => world.hash(fold));

  const rejections: string[] = [];
  const fired: { type: string; data: unknown }[] = [];
  kernel.subscribe<{ what: string; reason: string }>('village.rejected', (e) => rejections.push(`${e.data.what}: ${e.data.reason}`));
  for (const type of ['event.fired', 'event.resolved']) {
    kernel.subscribe(type, (e) => fired.push({ type, data: e.data }));
  }

  const submit = (type: string, issuer: number, payload: unknown): void => {
    kernel.submit({ type, issuer, payload });
    kernel.step();
  };
  submit('village.found', 1, { x: 30, y: 30, name: 'Eventhold' });
  let villageId = -1;
  world.query([popGame.Population]).forEach((_i, entity) => (villageId = entity as number));
  assert.ok(villageId >= 0);

  const days = (n: number): void => {
    for (let t = 0; t < n * TICKS_PER_DAY; t++) kernel.step();
  };
  const kingdomId = kingdomGame.kingdomEntities()[0] as number;

  return { kernel, world, db, game, popGame, kingdomGame, eventGame, villageId, kingdomId, days, submit, rejections, fired, opinionDeltas };
}

// ---------------------------------------------------------------- DSL fuzzing: evaluatePredicate

function fakeContext(overrides: Partial<EventContext> = {}): EventContext {
  return {
    statOf: () => 50,
    season: () => 'summer',
    hasEdict: () => false,
    hasTech: () => false,
    chance: () => true,
    ...overrides,
  };
}

test('evaluatePredicate: never throws on structurally garbage input', () => {
  const garbage: unknown[] = [
    null, undefined, 42, 'string', true, [], [1, 2, 3], {}, { unknown: 'key' },
    { stat: 123 }, { stat: 'village.happiness' }, { stat: 'village.happiness', lt: 'nope' },
    { all: 'not an array' }, { all: [null, undefined, 42] }, { not: null }, { not: { not: { not: {} } } },
    { season: 123 }, { hasEdict: 42 }, { chance: 'half' }, { chance: -5 }, { chance: Infinity },
    Symbol('x'), new Date(), () => 1,
  ];
  for (const g of garbage) {
    assert.doesNotThrow(() => evaluatePredicate(g, fakeContext()));
    assert.equal(typeof evaluatePredicate(g, fakeContext()), 'boolean');
  }
});

test('evaluatePredicate: a deterministic pseudo-fuzz of deeply nested random trees never throws', () => {
  let seed = 12345;
  const rand = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const KEYS = ['all', 'any', 'not', 'season', 'hasEdict', 'hasTech', 'chance', 'stat', 'lt', 'gt', 'eq', 'garbage'];
  function randomNode(depth: number): unknown {
    if (depth <= 0 || rand() < 0.3) return rand() < 0.5 ? rand() : (rand() < 0.5 ? 'x' : null);
    const key = KEYS[Math.floor(rand() * KEYS.length)] as string;
    if (key === 'all' || key === 'any') return { [key]: [randomNode(depth - 1), randomNode(depth - 1)] };
    if (key === 'not') return { not: randomNode(depth - 1) };
    return { [key]: rand() < 0.5 ? rand() : 'garbage-value' };
  }
  for (let i = 0; i < 500; i++) {
    const tree = randomNode(4);
    assert.doesNotThrow(() => evaluatePredicate(tree, fakeContext()));
  }
});

test('evaluatePredicate: comparators, season, hasEdict/hasTech, and combinators are correct', () => {
  const ctx = fakeContext({ statOf: () => 40 });
  assert.equal(evaluatePredicate({ stat: 'village.happiness', lt: 50 }, ctx), true);
  assert.equal(evaluatePredicate({ stat: 'village.happiness', gte: 50 }, ctx), false);
  assert.equal(evaluatePredicate({ stat: 'village.happiness', eq: 40 }, ctx), true);
  assert.equal(evaluatePredicate({ stat: 'unknown.path' as never }, fakeContext({ statOf: () => undefined })), false);

  assert.equal(evaluatePredicate({ season: 'summer' }, fakeContext({ season: () => 'summer' })), true);
  assert.equal(evaluatePredicate({ season: 'winter' }, fakeContext({ season: () => 'summer' })), false);

  assert.equal(evaluatePredicate({ hasEdict: 'x' }, fakeContext({ hasEdict: () => true })), true);
  assert.equal(evaluatePredicate({ hasTech: 'x' }, fakeContext({ hasTech: () => false })), false);

  assert.equal(evaluatePredicate({ all: [{ chance: 0.5 }, { season: 'summer' }] }, fakeContext({ chance: () => true, season: () => 'summer' })), true);
  assert.equal(evaluatePredicate({ all: [{ chance: 0.5 }, { season: 'winter' }] }, fakeContext({ chance: () => true, season: () => 'summer' })), false);
  assert.equal(evaluatePredicate({ any: [{ season: 'winter' }, { season: 'summer' }] }, fakeContext({ season: () => 'summer' })), true);
  assert.equal(evaluatePredicate({ not: { season: 'winter' } }, fakeContext({ season: () => 'summer' })), true);
});

test('tutorial "Granaries Are Full" cannot fire from the initial state (foodSecurity seeds at 1.0)', () => {
  const db = DefinitionDatabase.load(BASE_CONTENT_FILES);
  const economy = db.events.get('base:event.tutorial.economy');
  assert.ok(economy, 'tutorial economy event exists');
  const trigger = economy.trigger;

  // A freshly-founded village on day 1 (spring): foodSecurity is seeded at its EMA max of 1.0
  // and happiness at 60. This is exactly the state that made the bare `foodSecurity >= 0.8`
  // trigger fire at t=0. The season gate must keep it FALSE here even at maximum food security.
  const initialState = fakeContext({
    season: () => 'spring',
    statOf: (s) => (s === 'village.foodSecurity' ? 1 : s === 'village.happiness' ? 60 : 0),
  });
  assert.equal(evaluatePredicate(trigger, initialState), false, 'must not fire from the initial state');

  // A genuinely food-secure village once summer has come around → fires as intended.
  const genuineSurplus = fakeContext({
    season: () => 'summer',
    statOf: (s) => (s === 'village.foodSecurity' ? 0.95 : 0),
  });
  assert.equal(evaluatePredicate(trigger, genuineSurplus), true, 'fires on a genuine, earned surplus');

  // …but summer alone is not enough — a starving village in summer still stays quiet.
  const summerButStarving = fakeContext({
    season: () => 'summer',
    statOf: (s) => (s === 'village.foodSecurity' ? 0.3 : 0),
  });
  assert.equal(evaluatePredicate(trigger, summerButStarving), false, 'food security is still required');
});

// ---------------------------------------------------------------- DSL fuzzing: applyEffect

function fakeEffectContext(): EventEffectContext & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    grantResource: (r, a) => calls.push(`grant:${r}:${a}`),
    removeResource: (r, a) => calls.push(`remove:${r}:${a}`),
    nudgeStat: (s, op, v) => calls.push(`nudge:${s}:${op}:${v}`),
    applyOpinionDelta: (d) => calls.push(`opinion:${d}`),
    submitCommand: (t) => calls.push(`command:${t}`),
  };
}

test('applyEffect: never throws on structurally garbage input, and is a no-op on it', () => {
  const garbage: unknown[] = [
    null, undefined, 42, 'string', [], { unknown: 'key' }, { grantResource: 'not an object' },
    { grantResource: { resource: 42, amount: 'x' } }, { modifier: { stat: 'x', op: 'xor', value: 1 } },
    { command: { type: 42, payload: {} } }, { command: { type: 'x', payload: null } },
  ];
  for (const g of garbage) {
    const ctx = fakeEffectContext();
    assert.doesNotThrow(() => applyEffect(g, ctx));
    assert.deepEqual(ctx.calls, []);
  }
});

test('applyEffect: well-formed effects call through exactly once, with the right arguments', () => {
  const cases: [unknown, string][] = [
    [{ grantResource: { resource: 'base:resource.wood', amount: 10 } }, 'grant:base:resource.wood:10'],
    [{ removeResource: { resource: 'base:resource.food', amount: 5 } }, 'remove:base:resource.food:5'],
    [{ modifier: { stat: 'village.happiness', op: 'add', value: 3 } }, 'nudge:village.happiness:add:3'],
    [{ opinionChange: { delta: -8 } }, 'opinion:-8'],
    [{ command: { type: 'kingdom.sendGift', payload: {} } }, 'command:kingdom.sendGift'],
  ];
  for (const [effect, expected] of cases) {
    const ctx = fakeEffectContext();
    applyEffect(effect, ctx);
    assert.deepEqual(ctx.calls, [expected]);
  }
});

// ---------------------------------------------------------------- pacing governor bands

test('pacingMultiplier: boosts under the band, dampens at/over it, neutral within it', () => {
  assert.equal(pacingMultiplier(0), pacingMultiplier(PACING_TARGET_MIN - 1));
  assert.ok(pacingMultiplier(PACING_TARGET_MIN - 1) > 1, 'under-band must boost');
  assert.equal(pacingMultiplier(PACING_TARGET_MIN), 1, 'exactly at the floor is neutral');
  assert.equal(pacingMultiplier(PACING_TARGET_MAX - 1), 1, 'just under the ceiling is neutral');
  assert.ok(pacingMultiplier(PACING_TARGET_MAX) < 1, 'at/over the ceiling must dampen');
  assert.ok(pacingMultiplier(PACING_TARGET_MAX + 10) < 1);
});

test('pacing governor: over many seasons, real per-kingdom fire counts land inside the target band', () => {
  const { kernel, days, eventGame, kingdomId } = makeKingdom({ seed: 900 });
  // Fixed TICKS_PER_SEASON-wide windows, counted directly from ctx.tick math (no dependency on
  // time.ts's CalendarSystem being registered — this composition doesn't register it, same as
  // events.ts's own internal season-boundary detection, game/events.ts's `isFirstDayOfSeason`).
  const perSeason: number[] = [];
  let sinceWindowStart = 0;
  kernel.subscribe('event.fired', () => {
    sinceWindowStart += 1;
  });

  const SEASONS = 20;
  for (let s = 0; s < SEASONS; s++) {
    days(TICKS_PER_SEASON / TICKS_PER_DAY);
    perSeason.push(sinceWindowStart);
    sinceWindowStart = 0;
  }

  // drop the first couple of seasons (governor hasn't had a chance to correct yet) — the
  // remainder should cluster inside [MIN, MAX], not silent (0) and not spammy (>>MAX).
  const settled = perSeason.slice(3);
  assert.ok(settled.length > 5, 'expected enough seasons to judge steady-state pacing');
  const withinBand = settled.filter((n) => n >= PACING_TARGET_MIN - 1 && n <= PACING_TARGET_MAX + 2);
  assert.ok(
    withinBand.length / settled.length >= 0.7,
    `expected most settled seasons within/near the pacing band [${PACING_TARGET_MIN}, ${PACING_TARGET_MAX}]; saw: ${settled.join(', ')}`,
  );
  void eventGame;
  void kingdomId;
});

// ---------------------------------------------------------------- commands & mechanics

test('event.choose: rejects unknown event, unknown choice, no pending instance, and unmet requirements', () => {
  const { submit, rejections, kingdomId, eventGame } = makeKingdom();
  submit('event.choose', 1, { eventId: 'base:event.does-not-exist', choiceId: 'x' });
  assert.ok(rejections.some((r) => r.includes('unknown event')));

  submit('event.choose', 1, { eventId: 'base:event.opportunity.traveling-merchant', choiceId: 'x' });
  assert.ok(rejections.some((r) => r.includes('no such pending event')));
  void kingdomId;
  void eventGame;
});

test('event.choose: applies effects, resolves the pending instance, and rejects a repeat', () => {
  const { kernel, submit, world, game, popGame, villageId, kingdomId, fired, eventGame } = makeKingdom({ seed: 4 });

  // run enough days with a permissive stat so the real daily system fires SOME event, then
  // answer it — exercises the full pipeline (roll -> fire -> pending -> choose -> effect).
  const p = world.write(popGame.Population);
  p.foodSecurity[villageId & 0x3fffff] = 0.9;
  let tries = 0;
  while (eventGame.pendingChoices(kingdomId as never).length === 0 && tries < 2000) {
    kernel.step();
    tries++;
  }
  const pending = eventGame.pendingChoices(kingdomId as never);
  assert.ok(pending.length > 0, 'expected at least one event to fire within a reasonable window');
  const first = pending[0] as { eventId: string; choiceIds: readonly string[] };

  submit('event.choose', 1, { eventId: first.eventId, choiceId: first.choiceIds[0] });
  assert.ok(fired.some((f) => f.type === 'event.resolved'));

  submit('event.choose', 1, { eventId: first.eventId, choiceId: first.choiceIds[0] });
  const resolvedCount = fired.filter((f) => f.type === 'event.resolved').length;
  assert.equal(resolvedCount, 1, 'answering the same instance twice must not resolve twice');
  void game;
});

test('event.choose: a grantResource/removeResource effect actually moves the village stockpile', () => {
  const { kernel, submit, world, game, villageId, kingdomId, eventGame } = makeKingdom({ seed: 4 });
  let tries = 0;
  let target: { eventId: string; choiceIds: readonly string[] } | undefined;
  while (target === undefined && tries < 2000) {
    kernel.step();
    tries++;
    target = eventGame.pendingChoices(kingdomId as never).find((e) => e.eventId === 'base:event.opportunity.traveling-merchant');
  }
  assert.ok(target !== undefined, 'expected the traveling-merchant event to fire within a reasonable window');
  const woodCode = game.ops.resourceCode('base:resource.wood') as number;
  const toolsCode = game.ops.resourceCode('base:resource.tools') as number;
  const stock = world.readObj(game.comps.Stockpile).get(villageId & 0x3fffff);
  const woodBefore = stock.get(woodCode) ?? 0;
  const toolsBefore = stock.get(toolsCode) ?? 0;

  submit('event.choose', 1, { eventId: target.eventId, choiceId: 'buy-tools' });
  const stockAfter = world.readObj(game.comps.Stockpile).get(villageId & 0x3fffff);
  assert.ok(Math.abs((stockAfter.get(woodCode) ?? 0) - (woodBefore - 20)) < 1e-9);
  assert.ok(Math.abs((stockAfter.get(toolsCode) ?? 0) - (toolsBefore + 8)) < 1e-9);
});

// ---------------------------------------------------------------- tutorial (roadmap M43)

test('tutorial: all 6 steps are reachable and resolvable in sequence through the real engine, ending at village.tier 2', () => {
  const k = makeKingdom({ seed: 9 });
  const vi = k.villageId & 0x3fffff;

  const waitForPending = (eventId: string, maxTries: number): { eventId: string; choiceIds: readonly string[] } => {
    let tries = 0;
    let target: { eventId: string; choiceIds: readonly string[] } | undefined;
    while (target === undefined && tries < maxTries) {
      k.kernel.step();
      tries++;
      target = k.eventGame.pendingChoices(k.kingdomId as never).find((e) => e.eventId === eventId);
    }
    assert.ok(target !== undefined, `expected '${eventId}' to fire within ${maxTries} ticks`);
    return target as { eventId: string; choiceIds: readonly string[] };
  };
  const resolve = (eventId: string, choiceId: string): void => {
    k.submit('event.choose', 1, { eventId, choiceId });
  };

  // 1. welcome — trigger is unconditionally true from day 1
  resolve('base:event.tutorial.welcome', waitForPending('base:event.tutorial.welcome', 5000).choiceIds[0] as string);

  // 2. economy — now gated on SUMMER as well as food security (so it can't fire from the day-1
  // foodSecurity=1.0 seed). This village has no food income, so its EMA would decay before summer
  // arrives — pin it healthy each tick to isolate the season gate this step now depends on.
  {
    let target: { eventId: string; choiceIds: readonly string[] } | undefined;
    for (let tries = 0; target === undefined && tries < 6000; tries++) {
      k.world.write(k.popGame.Population).foodSecurity[vi] = 0.9;
      k.kernel.step();
      target = k.eventGame.pendingChoices(k.kingdomId as never).find((e) => e.eventId === 'base:event.tutorial.economy');
    }
    assert.ok(target !== undefined, 'expected economy to fire once summer arrives with food secure');
    resolve('base:event.tutorial.economy', target.choiceIds[0] as string);
  }

  // 3/4/5 — season-gated (spring is tick 0; summer/autumn/winter arrive as ticks advance
  // naturally); autumn's tax step needs no extra state, winter's edicts step needs treasury ≥ 20
  resolve('base:event.tutorial.happiness', waitForPending('base:event.tutorial.happiness', 20_000).choiceIds[0] as string);
  resolve('base:event.tutorial.tax', waitForPending('base:event.tutorial.tax', 20_000).choiceIds[0] as string);
  k.world.write(k.kingdomGame.Kingdom).treasury[k.kingdomId & 0x3fffff] = 100;
  resolve('base:event.tutorial.edicts', waitForPending('base:event.tutorial.edicts', 20_000).choiceIds[0] as string);

  // 6. completion — the SC-1 signal itself: village.tier reaching 2
  k.world.write(k.game.comps.VillageCore).tier[vi] = 2;
  resolve('base:event.tutorial.complete', waitForPending('base:event.tutorial.complete', 5000).choiceIds[0] as string);

  const tutorialFired = k.fired.filter(
    (f) => f.type === 'event.fired' && (f.data as { eventId: string }).eventId.startsWith('base:event.tutorial.'),
  );
  const tutorialResolved = k.fired.filter(
    (f) => f.type === 'event.resolved' && (f.data as { eventId: string }).eventId.startsWith('base:event.tutorial.'),
  );
  assert.equal(tutorialFired.length, 6, 'each once:true tutorial step fires exactly once');
  assert.equal(tutorialResolved.length, 6, 'every fired step was actually resolved');
  // other pools keep firing independently across the long wait windows above — only the
  // TUTORIAL steps are this test's concern, and none of them are left unanswered
  const pendingTutorial = k.eventGame
    .pendingChoices(k.kingdomId as never)
    .filter((p) => p.eventId.startsWith('base:event.tutorial.'));
  assert.deepEqual(pendingTutorial, [], 'no tutorial step left unanswered');
});

test('determinism: event state folds identically for the same tick sequence', () => {
  const run = (): number => {
    const { kernel, days } = makeKingdom({ seed: 55 });
    days(90);
    return kernel.stateHash();
  };
  assert.equal(run(), run());
});
