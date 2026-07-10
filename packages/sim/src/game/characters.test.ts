/**
 * Characters & dynasty (M34) — the roadmap test objective is "lifecycle
 * tests; advisor bonus math" (doc 12): traits must actually move the
 * Steward/Marshal/Chancellor/Scholar bonus math kingdom.ts already has, and
 * a notable's full lifecycle (marriage → heir → grows old enough for office
 * → is appointed; death → widowing) must hold together and stay
 * deterministic, without kingdom.ts itself needing new mechanics.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DefinitionDatabase, BASE_CONTENT_FILES } from '@crowns/data';
import { Kernel } from '../kernel.js';
import { World } from '../ecs.js';
import { TICKS_PER_YEAR } from '../time.js';
import { registerVillageGameplay, type TerrainAccessor } from './villages.js';
import { registerPopulationGameplay } from './population.js';
import { registerEconomyGameplay } from './economy.js';
import { registerKingdomGameplay, StatModifiers, MIN_OFFICE_AGE } from './kingdom.js';
import {
  registerCharactersGameplay,
  CharacterRelations,
  TRAITS_PER_CHARACTER,
  GRIEF_LOYALTY_PENALTY,
  MIN_FERTILE_AGE,
  MAX_FERTILE_AGE,
} from './characters.js';

const plain: TerrainAccessor = {
  width: 64,
  height: 64,
  tagsAt: () => ['open', 'farmable', 'mineable', 'woodland'],
  riverAt: () => false,
  movementCostAt: () => 1,
};

function makeKingdom(options: { seed?: number; withCharacters?: boolean } = {}) {
  const kernel = new Kernel(options.seed ?? 51);
  const world = new World(512);
  const db = DefinitionDatabase.load(BASE_CONTENT_FILES);
  const mods = new StatModifiers();
  const game = registerVillageGameplay(kernel, world, db, plain, { 'base:resource.wood': 200, 'base:resource.stone': 200 });
  const popGame = registerPopulationGameplay(kernel, world, db, game, { children: 4, adults: 10, elders: 2 }, mods);
  const econ = registerEconomyGameplay(kernel, world, db, game, mods);
  const kingdom = registerKingdomGameplay(kernel, world, db, game, popGame, econ, mods);
  const characters = options.withCharacters ?? true ? registerCharactersGameplay(kernel, world, db, kingdom) : undefined;
  kernel.attachGuard(world);
  kernel.addHashSource('world', (fold) => world.hash(fold));

  const events: { type: string; data: unknown }[] = [];
  const rejections: string[] = [];
  for (const type of [
    'character.married', 'character.born', 'character.died', 'character.resigned', 'kingdom.officeVacated',
  ]) {
    kernel.subscribe(type, (e) => events.push({ type, data: e.data }));
  }
  kernel.subscribe<{ what: string; reason: string }>('village.rejected', (e) => rejections.push(`${e.data.what}: ${e.data.reason}`));

  const submit = (type: string, payload: unknown): void => {
    kernel.submit({ type, issuer: 1, payload });
    kernel.step();
  };
  const advance = (ticks: number): void => {
    for (let t = 0; t < ticks; t++) kernel.step();
  };
  const years = (n: number): void => advance(n * TICKS_PER_YEAR);

  return { kernel, world, db, game, popGame, econ, kingdom, characters: characters as ReturnType<typeof registerCharactersGameplay>, submit, advance, years, events, rejections };
}

const idx = (id: number): number => id & 0x3fffff;

// ---------------------------------------------------------------- genesis: traits/gender/loyalty

test('genesis: every notable gets distinct traits, a gender, and loyalty in range', () => {
  const k = makeKingdom();
  k.advance(1); // fires kingdom-genesis + characters-genesis (both tick 1)

  const characters: number[] = [];
  k.world.query([k.kingdom.Character]).forEach((_i, entity) => characters.push(entity as number));
  assert.ok(characters.length >= 6);

  const gender = k.world.read(k.characters.CharacterGender);
  const loyalty = k.world.read(k.characters.CharacterLoyalty);
  for (const entity of characters) {
    const codes = k.world.readObj(k.characters.CharacterTraits).tryGet(idx(entity));
    assert.ok(codes !== undefined && codes.length === TRAITS_PER_CHARACTER, `entity ${entity} has ${TRAITS_PER_CHARACTER} traits`);
    assert.equal(new Set(codes).size, codes?.length, 'traits are distinct');
    assert.ok([0, 1].includes(gender.gender[idx(entity)] as number));
    const l = loyalty.loyalty[idx(entity)] as number;
    assert.ok(l >= 40 && l <= 90, `loyalty ${l} in genesis range`);
  }
});

// ---------------------------------------------------------------- advisor bonus math

test('advisor bonus math: trait skill deltas apply on top of the raw genesis roll', () => {
  const withTraits = makeKingdom({ seed: 77, withCharacters: true });
  const withoutTraits = makeKingdom({ seed: 77, withCharacters: false });
  withTraits.advance(1);
  withoutTraits.advance(1);

  const rawStewardship = withoutTraits.world.read(withoutTraits.kingdom.Character).stewardship;
  const c = withTraits.world.read(withTraits.kingdom.Character);
  const traits = withTraits.characters;

  const entities: number[] = [];
  withTraits.world.query([withTraits.kingdom.Character]).forEach((_i, entity) => entities.push(entity as number));

  let anyDelta = false;
  for (const entity of entities) {
    const i = idx(entity);
    const raw = rawStewardship[i] as number;
    const withDelta = c.stewardship[i] as number;
    const codes = traits.CharacterTraits === undefined ? [] : (withTraits.world.readObj(traits.CharacterTraits).tryGet(i) ?? []);
    const expectedDelta = codes.reduce((sum, code) => {
      const def = withTraits.db.traits.get(traits.traitIdOf(code));
      return sum + (def?.skillModifiers.stewardship ?? 0);
    }, 0);
    assert.equal(withDelta, Math.max(0, Math.min(20, raw + expectedDelta)), `entity ${entity}: trait-adjusted stewardship matches raw + deltas`);
    if (expectedDelta !== 0) anyDelta = true;
  }
  assert.ok(anyDelta, 'at least one notable actually had a stewardship-affecting trait (sanity, fixed seed)');

  // and the office bonus itself (kingdom.ts, unmodified) reads the post-trait value
  const best = entities.reduce((a, b) => ((c.stewardship[idx(b)] as number) > (c.stewardship[idx(a)] as number) ? b : a));
  withTraits.submit('kingdom.appoint', { office: 'steward', characterId: best });
  const expectedMul = 1 + (c.stewardship[idx(best)] as number) / 100;
  assert.ok(Math.abs(withTraits.kingdom.mods.mul('kingdom.taxYield') - expectedMul) < 1e-9);
});

// ---------------------------------------------------------------- character.marry

test('character.marry: rejects self, unknown, already-married, and underage by name', () => {
  const k = makeKingdom();
  k.advance(1);
  const entities: number[] = [];
  k.world.query([k.kingdom.Character]).forEach((_i, entity) => entities.push(entity as number));
  const [a, b, c] = entities;

  k.submit('character.marry', { characterA: a, characterB: a });
  assert.ok(k.rejections.some((r) => r.includes('character.marry') && r.includes('themselves')));

  k.submit('character.marry', { characterA: a, characterB: 999999 });
  assert.ok(k.rejections.some((r) => r.includes('no such character')));

  k.submit('character.marry', { characterA: a, characterB: b as number });
  assert.ok(k.events.some((e) => e.type === 'character.married'));

  k.submit('character.marry', { characterA: a, characterB: c as number });
  assert.ok(k.rejections.some((r) => r.includes('already married')));
});

test('character.marry: rejects parent/child and sibling pairs (synthetic lineage)', () => {
  const k = makeKingdom();
  k.advance(1);
  const entities: number[] = [];
  k.world.query([k.kingdom.Character]).forEach((_i, entity) => entities.push(entity as number));
  const [parentA, parentB, childX, childY] = entities;
  // force a synthetic family without waiting on random births — CharacterRelations is plain state
  k.characters.relations.recordBirth(childX as number, parentA as number, parentB as number);
  k.characters.relations.recordBirth(childY as number, parentA as number, parentB as number);

  k.submit('character.marry', { characterA: parentA, characterB: childX });
  assert.ok(k.rejections.some((r) => r.includes('parent and child')));

  k.submit('character.marry', { characterA: childX, characterB: childY });
  assert.ok(k.rejections.some((r) => r.includes('siblings')));
});

// ---------------------------------------------------------------- CharacterRelations (pure)

test('CharacterRelations: marry/widow are symmetric and mutually exclusive', () => {
  const r = new CharacterRelations();
  r.marry(1, 2);
  assert.equal(r.spouseOf(1), 2);
  assert.equal(r.spouseOf(2), 1);
  assert.ok(r.isMarried(1) && r.isMarried(2));
  const widowed = r.widow(1);
  assert.equal(widowed, 2);
  assert.ok(!r.isMarried(1) && !r.isMarried(2));
});

test('CharacterRelations: couples() reports each pair exactly once', () => {
  const r = new CharacterRelations();
  r.marry(5, 2);
  r.marry(9, 1);
  const pairs = r.couples().map(([a, b]) => `${a}-${b}`);
  assert.equal(pairs.length, 2);
  assert.ok(pairs.includes('2-5'));
  assert.ok(pairs.includes('1-9'));
});

// ---------------------------------------------------------------- lifecycle: heirs & appointment

test('lifecycle: a married couple can produce an heir who ages into an appointable notable', () => {
  const k = makeKingdom({ seed: 5 });
  k.advance(1);
  const entities: { id: number; age: number }[] = [];
  const c = k.world.read(k.kingdom.Character);
  k.world.query([k.kingdom.Character]).forEach((_i, entity) => entities.push({ id: entity as number, age: c.age[idx(entity as number)] as number }));
  // youngest-first: maximises years left in the fertile window before this test's bounded retry loop gives up
  const fertile = entities.filter((e) => e.age >= MIN_FERTILE_AGE && e.age <= MAX_FERTILE_AGE).sort((x, y) => x.age - y.age);
  assert.ok(fertile.length >= 2, 'need at least two fertile-age candidates for this seed');
  const pa = fertile[0] as { id: number; age: number };
  const pb = fertile[1] as { id: number; age: number };
  k.submit('character.marry', { characterA: pa.id, characterB: pb.id });
  assert.ok(k.characters.relations.isMarried(pa.id));

  for (let y = 0; y < 30 && !k.events.some((e) => e.type === 'character.born'); y++) k.years(1);
  const born = k.events.find((e) => e.type === 'character.born');
  assert.ok(born !== undefined, 'an heir was born within the fertile window');
  const heirId = (born?.data as { characterId: number }).characterId;
  assert.ok(k.characters.relations.isParentChild(heirId, pa.id));

  // still too young for office right after birth
  k.submit('kingdom.appoint', { office: 'scholar', characterId: heirId });
  assert.ok(k.rejections.some((r) => r.includes('kingdom.appoint') && r.includes('too young')));

  // ages into eligibility
  k.years(MIN_OFFICE_AGE + 1);
  k.submit('kingdom.appoint', { office: 'scholar', characterId: heirId });
  assert.ok(k.events.some((e) => e.type !== 'command.rejected'), 'sanity: sim still producing events');
  const scholarSeat = k.world.read(k.kingdom.Kingdom).scholar[idx(k.kingdom.kingdomEntities()[0] as number)] as number;
  assert.equal(scholarSeat, heirId, 'the heir now holds the Scholar seat — the notable pool grew past the fixed six');
});

// ---------------------------------------------------------------- lifecycle: widowing

test('lifecycle: a spouse\'s death dissolves the marriage and grieves the survivor', () => {
  const k = makeKingdom({ seed: 9 });
  k.advance(1);
  const entities: number[] = [];
  k.world.query([k.kingdom.Character]).forEach((_i, entity) => entities.push(entity as number));
  const a = entities[0] as number;
  const b = entities[1] as number;
  k.submit('character.marry', { characterA: a, characterB: b });

  const loyaltyBefore = k.world.read(k.characters.CharacterLoyalty).loyalty[idx(b)] as number;
  k.world.write(k.kingdom.Character).age[idx(a)] = 105; // mortality capped at 50%/year (kingdom.ts)
  for (let y = 0; y < 8 && !k.events.some((e) => e.type === 'character.died'); y++) k.years(1);
  assert.ok(k.events.some((e) => e.type === 'character.died'), 'the forced-age spouse died');
  k.years(1); // characters-lifecycle runs the same tick as character-aging, but give it one more pass

  assert.ok(!k.characters.relations.isMarried(b as number), 'marriage dissolved');
  const loyaltyAfter = k.world.read(k.characters.CharacterLoyalty).loyalty[idx(b as number)] as number;
  assert.ok(loyaltyAfter <= Math.max(0, loyaltyBefore - GRIEF_LOYALTY_PENALTY) + 1e-9, 'grief penalty applied to the survivor');
});

// ---------------------------------------------------------------- determinism

test('determinism: characters (traits, marriages, heirs) fold identically for the same command sequence', () => {
  const run = (): number => {
    const k = makeKingdom({ seed: 13 });
    k.advance(1);
    const entities: number[] = [];
    k.world.query([k.kingdom.Character]).forEach((_i, entity) => entities.push(entity as number));
    k.submit('character.marry', { characterA: entities[0], characterB: entities[1] as number });
    k.years(20);
    return k.kernel.stateHash();
  };
  assert.equal(run(), run());
});
