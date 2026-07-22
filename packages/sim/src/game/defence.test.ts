/**
 * Defence layer core (M49) — the doc 12 Phase 8 T objectives:
 *
 *   1. layer save→load→resave hash-identical (structures, posts, AND maps);
 *   2. layout regeneration byte-stable (same seed ⇒ identical tiles, twice);
 *   3. a version-stamp mismatch falls back to the save's stored tiles.
 *
 * Plus the command rulebook: build/demolish/post/unpost validation, atomic
 * capital-stockpile costs, and the pre-placed keep.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { composeCampaign } from '../campaign.js';
import { TICKS_PER_DAY } from '../time.js';
import {
  DEFENCE_MAP_SIZE,
  DEFENCE_MAP_VERSION,
  DEFENCE_TILE,
  KEEP_CLEARING_RADIUS,
  decodeDefenceMap,
  defenceMapSeed,
  encodeDefenceMap,
  generateDefenceMap,
} from '../worldgen/defenceMap.js';
import { DEFENCE_KEEP_CENTRE, KEEP_DEF, REPAIR_DURATION_DAYS } from './defence.js';
import type { CampaignSettings } from '@crowns/protocol';

const SEED = 0xdef83;
const SETTINGS: CampaignSettings = {
  mapSize: 'small',
  kingdomCount: 2,
  difficulty: 'fair',
  victory: ['conquest'],
  defeatEnabled: true,
};

function compose(): ReturnType<typeof composeCampaign> {
  return composeCampaign({
    seed: SEED,
    kingdomCount: 2,
    mapSize: 'small',
    mods: { sources: [] },
    settings: SETTINGS,
  });
}

function driver(c: ReturnType<typeof composeCampaign>) {
  const events: { type: string; data: Record<string, unknown> }[] = [];
  for (const type of ['defence.built', 'defence.demolished', 'defence.posted', 'defence.unposted', 'defence.rejected', 'defence.repairStarted', 'defence.repaired', 'army.created']) {
    c.kernel.subscribe(type, (e) => events.push({ type, data: e.data as Record<string, unknown> }));
  }
  const submit = (type: string, payload: unknown, issuer = 1): void => {
    c.kernel.submit({ type, issuer, payload });
    c.kernel.step();
  };
  const lastRejection = (): string => {
    const r = events.filter((e) => e.type === 'defence.rejected').at(-1);
    return r === undefined ? '' : `${String(r.data['what'])}: ${String(r.data['reason'])}`;
  };
  /** 'defence.built' events for one def id — genesis keeps publish too, so filter. */
  const builtOf = (defId: string) => events.filter((e) => e.type === 'defence.built' && e.data['def'] === defId);
  return { events, submit, lastRejection, builtOf };
}

/** First open, unoccupied 1×1 tile scanning from the keep clearing outward. `vi` is a
 * VILLAGE dense index (M57: the layer is village-keyed, not kingdom-keyed). */
function openTileNear(c: ReturnType<typeof composeCampaign>, vi: number): { x: number; y: number } {
  const map = c.defenceGame.mapOf(vi);
  assert.ok(map !== undefined);
  const occ = c.defenceGame.occupancyOf(vi);
  for (let r = 2; r < 40; r++) {
    const x = DEFENCE_KEEP_CENTRE + r;
    const y = DEFENCE_KEEP_CENTRE;
    const t = y * DEFENCE_MAP_SIZE + x;
    if (map.tiles[t] === DEFENCE_TILE.open && !occ.has(t)) return { x, y };
  }
  assert.fail('no open tile near the keep clearing');
}

// ---------------- generation ----------------

test('defence maps: byte-stable regeneration, per-kingdom variety, open keep clearing', () => {
  const a = generateDefenceMap(defenceMapSeed(SEED, 0));
  const b = generateDefenceMap(defenceMapSeed(SEED, 0));
  assert.deepEqual([...a], [...b], 'same seed ⇒ byte-identical tiles');
  const other = generateDefenceMap(defenceMapSeed(SEED, 1));
  assert.notDeepEqual([...a], [...other], 'kingdoms get different ground');
  for (let dy = -KEEP_CLEARING_RADIUS; dy <= KEEP_CLEARING_RADIUS; dy++) {
    for (let dx = -KEEP_CLEARING_RADIUS; dx <= KEEP_CLEARING_RADIUS; dx++) {
      assert.equal(
        a[(DEFENCE_KEEP_CENTRE + dy) * DEFENCE_MAP_SIZE + (DEFENCE_KEEP_CENTRE + dx)],
        DEFENCE_TILE.open,
        'the keep clearing is always open ground',
      );
    }
  }
  const decoded = decodeDefenceMap(encodeDefenceMap(a));
  assert.deepEqual([...decoded], [...a], 'RLE round-trips exactly');
});

// ---------------- the rulebook ----------------

test('defence.build: pays atomically from the capital, spawns on open ground, rejects everything else', () => {
  const c = compose();
  const d = driver(c);
  c.kernel.step(); // genesis

  // the keep is pre-placed for every kingdom's capital
  const capitals = [c.villageOf(0) as number, c.villageOf(1) as number];
  for (const vi of capitals) {
    const occ = c.defenceGame.occupancyOf(vi);
    assert.ok(occ.size >= 4, `village ${vi} keep occupies its footprint`);
  }

  const capital = capitals[0] as number;
  const stone = (vi: number): number => c.econGame.totalOf(vi, c.game.ops.resourceCode('base:resource.stone') as number);
  const before = stone(capital);

  const site = openTileNear(c, capital);
  d.submit('defence.build', { villageId: capital, def: 'base:building.wall', x: site.x, y: site.y });
  assert.equal(d.builtOf('base:building.wall').length, 1, d.lastRejection());
  assert.equal(stone(capital), before - 8, 'wall cost left the VILLAGE stockpile atomically (M57: no longer kingdom-pooled)');

  // rejections: occupied, off-map, rock/water, non-defensive, second keep
  d.submit('defence.build', { villageId: capital, def: 'base:building.wall', x: site.x, y: site.y });
  assert.match(d.lastRejection(), /occupied/);
  d.submit('defence.build', { villageId: capital, def: 'base:building.wall', x: DEFENCE_MAP_SIZE, y: 0 });
  assert.match(d.lastRejection(), /out of bounds/);
  d.submit('defence.build', { villageId: capital, def: 'base:building.house', x: site.x + 2, y: site.y });
  assert.match(d.lastRejection(), /only defensive structures/);
  d.submit('defence.build', { villageId: capital, def: KEEP_DEF, x: site.x + 4, y: site.y });
  assert.match(d.lastRejection(), /keep stands where it was founded/);
});

test('defence.demolish: owner-gated, keep-protected, frees the ground', () => {
  const c = compose();
  const d = driver(c);
  c.kernel.step();
  const capital = c.villageOf(0) as number;
  const site = openTileNear(c, capital);
  d.submit('defence.build', { villageId: capital, def: 'base:building.wall', x: site.x, y: site.y });
  const built = d.builtOf('base:building.wall').at(-1);
  assert.ok(built !== undefined, d.lastRejection());
  const id = built.data['structure'] as number;

  d.submit('defence.demolish', { structureId: id }, 2);
  assert.match(d.lastRejection(), /not your structure/);
  d.submit('defence.demolish', { structureId: id }, 1);
  assert.ok(d.events.some((e) => e.type === 'defence.demolished'));
  // ground freed: the same tile builds again
  d.submit('defence.build', { villageId: capital, def: 'base:building.wall', x: site.x, y: site.y });
  assert.equal(d.builtOf('base:building.wall').length, 2, d.lastRejection());

  // the keep refuses demolition
  const occ = c.defenceGame.occupancyOf(capital);
  const keepTile = DEFENCE_KEEP_CENTRE * DEFENCE_MAP_SIZE + DEFENCE_KEEP_CENTRE;
  const keepId = occ.get(keepTile) ?? occ.get(keepTile - DEFENCE_MAP_SIZE - 1);
  assert.ok(keepId !== undefined, 'keep found at centre');
  d.submit('defence.demolish', { structureId: keepId }, 1);
  assert.match(d.lastRejection(), /keep cannot be demolished/);
});

test('defence.post: same soldier pool — complete, army-free, own units only', () => {
  const c = compose();
  const d = driver(c);
  c.kernel.step();

  // a complete, army-free unit for kingdom 0 (the siege.test.ts spawn idiom)
  const def = c.db.units.get('base:unit.spearman');
  assert.ok(def !== undefined);
  const unitCode = c.militaryGame.ops.defCode('base:unit.spearman');
  assert.ok(unitCode !== undefined);
  const unit = c.world.spawn();
  c.world.attach(unit, c.militaryGame.Unit, {
    def: unitCode,
    kingdomId: c.kingdomGame.kingdomEntities()[0] as number,
    homeVillage: (c.villageOf(0) as number),
    armyId: 0,
    count: def.popCost.count,
    progress: 1,
    complete: true,
    morale: def.stats.moraleBase,
  });

  const site = openTileNear(c, c.villageOf(0) as number);
  d.submit('defence.post', { unitId: unit as number, x: site.x, y: site.y }, 2);
  assert.match(d.lastRejection(), /not your unit/);
  d.submit('defence.post', { unitId: unit as number, x: site.x, y: site.y }, 1);
  assert.ok(d.events.some((e) => e.type === 'defence.posted'), d.lastRejection());

  // re-posting moves; unposting detaches
  d.submit('defence.post', { unitId: unit as number, x: site.x + 1, y: site.y }, 1);
  assert.equal(d.events.filter((e) => e.type === 'defence.posted').length, 2);
  d.submit('defence.unpost', { unitId: unit as number }, 1);
  assert.ok(d.events.some((e) => e.type === 'defence.unposted'));
  assert.ok(!c.world.has(unit, c.defenceGame.DefencePost));
});

// ---------------- the T objective: persistence & the version fallback ----------------

test('defence layer: save→load→resave hash-identical; structures, posts and maps survive', () => {
  const original = compose();
  const d = driver(original);
  original.kernel.step();
  const capital = original.villageOf(0) as number;
  const site = openTileNear(original, capital);
  d.submit('defence.build', { villageId: capital, def: 'base:building.wall', x: site.x, y: site.y });
  assert.equal(d.builtOf('base:building.wall').length, 1, d.lastRejection());
  for (let t = 0; t < TICKS_PER_DAY * 3; t++) original.kernel.step();

  const save = original.saves.snapshot();
  assert.ok(save.sections['defence'] !== undefined, 'defence section present');

  const loaded = compose();
  const report = loaded.saves.hydrate(JSON.parse(JSON.stringify(save)) as typeof save);
  assert.deepEqual(report, []);
  assert.equal(loaded.kernel.stateHash(), original.kernel.stateHash(), 'hash identical after hydration');
  assert.deepEqual(loaded.saves.snapshot().sections, save.sections, 'resave sections byte-identical');
  assert.equal(loaded.defenceGame.occupancyOf(capital).size, original.defenceGame.occupancyOf(capital).size, 'occupancy rebuilt');
  assert.deepEqual([...(loaded.defenceGame.mapOf(capital)?.tiles ?? [])], [...(original.defenceGame.mapOf(capital)?.tiles ?? [])]);

  // both sessions keep evolving in lockstep
  for (let t = 0; t < TICKS_PER_DAY * 5; t++) {
    original.kernel.step();
    loaded.kernel.step();
  }
  assert.equal(loaded.kernel.stateHash(), original.kernel.stateHash());
});

test('defence layer: a version-stamp mismatch falls back to the STORED tiles, never re-rolls', () => {
  const original = compose();
  original.kernel.step();
  const save = original.saves.snapshot();

  // simulate a save written by an older generator: bump the stamp down and
  // hand-corrupt one stored tile — if the loader regenerated from the seed,
  // the corruption would vanish; honoring the store proves the fallback.
  const mutated = JSON.parse(JSON.stringify(save)) as typeof save;
  const section = mutated.sections['defence'] as { version: number; data: { k: number; seed: number; version: number; tiles: number[] }[] };
  const capital = original.villageOf(0) as number;
  const entry = section.data.find((e) => e.k === capital);
  assert.ok(entry !== undefined);
  entry.version = DEFENCE_MAP_VERSION - 1;
  const tiles = decodeDefenceMap(entry.tiles);
  const probe = 5; // corner tile, outside the keep clearing
  tiles[probe] = tiles[probe] === DEFENCE_TILE.rock ? DEFENCE_TILE.open : DEFENCE_TILE.rock;
  entry.tiles = encodeDefenceMap(tiles);

  const loaded = compose();
  loaded.saves.hydrate(mutated);
  const map = loaded.defenceGame.mapOf(loaded.villageOf(0) as number);
  assert.ok(map !== undefined);
  assert.equal(map.version, DEFENCE_MAP_VERSION - 1, 'stored stamp preserved');
  assert.equal(map.tiles[probe], tiles[probe], 'stored tiles are the ground truth on mismatch');
  assert.notEqual(map.tiles[probe], generateDefenceMap(map.seed)[probe], 'demonstrably NOT regenerated');
});

test('pre-defence saves (1.0) load: absent section falls back to fresh generation', () => {
  const original = compose();
  original.kernel.step();
  const save = original.saves.snapshot();
  const stripped = JSON.parse(JSON.stringify(save)) as typeof save;
  delete stripped.sections['defence'];

  const loaded = compose();
  const report = loaded.saves.hydrate(stripped);
  assert.deepEqual(report, ['defence: absent (save predates this section) — composition fallback applies']);
  // M57: maps are now generated LAZILY by `defence-genesis` (villages are founded over
  // time, so eager per-kingdom generation no longer makes sense) — the resumed session
  // needs one tick for genesis to grant its capital a fresh layer.
  loaded.kernel.step();
  const map = loaded.defenceGame.mapOf(loaded.villageOf(0) as number);
  assert.ok(map !== undefined && map.version === DEFENCE_MAP_VERSION);
  assert.deepEqual([...map.tiles], [...generateDefenceMap(map.seed)]);
});

// ---------------- M58: repair ----------------

/** Damage a structure directly (bypassing assault.ts) for surgical repair-test setup —
 * same technique the suite already uses for garrison units (world.attach). Returns the
 * structure's entity id and its def (for cost-formula assertions). */
function damageKeep(c: ReturnType<typeof composeCampaign>, vi: number, fraction: number): number {
  const s = c.world.read(c.defenceGame.DefenceStructure);
  const fort = c.world.write(c.defenceGame.Fortification);
  let keepId = -1;
  c.world.query([c.defenceGame.DefenceStructure]).forEach((si, entity) => {
    if (keepId !== -1) return;
    if (((s.village[si] as number) & 0x3fffff) !== vi) return;
    if (c.game.ops.buildingDef(s.def[si] as number).id !== KEEP_DEF) return;
    keepId = entity as number;
    fort.hp[si] = (fort.maxHp[si] as number) * (1 - fraction);
  });
  assert.ok(keepId >= 0, 'keep found');
  return keepId;
}

test('defence.repair: pays def.cost × (1 − hp/maxHp) immediately; hp only returns after the window', () => {
  const c = compose();
  const d = driver(c);
  c.kernel.step(); // genesis
  const capital = c.villageOf(0) as number;
  damageKeep(c, capital, 0.5); // keep: 20 wood / 60 stone → half-damaged ⇒ 10 wood / 30 stone

  const resCode = (id: string): number => c.game.ops.resourceCode(id) as number;
  const stockOf = (res: string): number => c.econGame.totalOf(capital, resCode(res));
  const woodBefore = stockOf('base:resource.wood');
  const stoneBefore = stockOf('base:resource.stone');

  d.submit('defence.repair', { villageId: capital });
  assert.ok(d.events.some((e) => e.type === 'defence.repairStarted'), d.lastRejection());
  assert.equal(stockOf('base:resource.wood'), woodBefore - 10, 'wood repair cost committed immediately');
  assert.equal(stockOf('base:resource.stone'), stoneBefore - 30, 'stone repair cost committed immediately');

  const fort = c.world.read(c.defenceGame.Fortification);
  const s = c.world.read(c.defenceGame.DefenceStructure);
  const keepHp = (): number => {
    let hp = -1;
    c.world.query([c.defenceGame.DefenceStructure]).forEach((si) => {
      if (((s.village[si] as number) & 0x3fffff) === capital && c.game.ops.buildingDef(s.def[si] as number).id === KEEP_DEF) {
        hp = fort.hp[si] as number;
      }
    });
    return hp;
  };
  const maxHp = c.db.buildings.get(KEEP_DEF)?.defense?.hp as number;
  assert.equal(keepHp(), maxHp * 0.5, 'still damaged right after paying — the window has not elapsed');

  // just short of the window: still damaged
  for (let t = 0; t < REPAIR_DURATION_DAYS * TICKS_PER_DAY - TICKS_PER_DAY; t++) c.kernel.step();
  assert.equal(keepHp(), maxHp * 0.5, 'still damaged short of the window');

  // past the window: healed, and the completion event fired
  for (let t = 0; t < TICKS_PER_DAY * 2; t++) c.kernel.step();
  assert.equal(keepHp(), maxHp, 'healed to full once the window elapsed');
  assert.ok(d.events.some((e) => e.type === 'defence.repaired'));
});

test('defence.repair: refused while under siege — the exploit this rule exists to close', () => {
  const c = composeCampaign({
    seed: SEED, kingdomCount: 2, mapSize: 'small', mods: { sources: [] }, settings: SETTINGS,
    aiFromIndex: 2, // both manual — surgical siege setup
    succession: false,
  });
  const d = driver(c);
  c.kernel.step();
  const capital = c.villageOf(0) as number;
  damageKeep(c, capital, 0.5);

  // an enemy army sits at the capital and besieges it
  const defCode = c.militaryGame.ops.defCode('base:unit.spearman');
  const unitDef = c.db.units.get('base:unit.spearman');
  assert.ok(unitDef !== undefined && defCode !== undefined);
  const v1 = c.villageOf(1) as number;
  let v1Id = -1;
  let v0Id = -1;
  c.world.query([c.game.comps.VillageCore]).forEach((i, entity) => {
    if (i === v1) v1Id = entity as number;
    if (i === capital) v0Id = entity as number;
  });
  d.submit('army.createArmy', { name: 'Siege', villageId: v1Id }, 2);
  const attackerArmy = d.events.filter((e) => e.type === 'army.created').at(-1)?.data['army'] as number;
  assert.ok(attackerArmy >= 0, 'attacking army created');
  const unit = c.world.spawn();
  c.world.attach(unit, c.militaryGame.Unit, {
    def: defCode, kingdomId: c.kingdomGame.kingdomEntities()[1] as number, homeVillage: v1Id,
    armyId: attackerArmy, count: unitDef.popCost.count, progress: 1, complete: true, morale: unitDef.stats.moraleBase,
  });
  const core = c.world.read(c.game.comps.VillageCore);
  const m = c.world.write(c.armiesGame.ArmyMovement);
  const ai = attackerArmy & 0x3fffff;
  m.x[ai] = core.centerX[capital] as number;
  m.y[ai] = core.centerY[capital] as number;
  c.world.writeObj(c.armiesGame.ArmyPath).set(ai, []);
  d.submit('siege.begin', { armyId: attackerArmy, villageId: v0Id }, 2);
  assert.ok(c.siegeGame.state.siegeOfCastle(capital) !== undefined, 'siege active');

  d.submit('defence.repair', { villageId: capital }, 1);
  assert.match(d.lastRejection(), /siege/);
  assert.ok(!d.events.some((e) => e.type === 'defence.repairStarted'), 'no repair started under siege');

  // the siege lifts — repair is available again
  d.submit('siege.lift', { armyId: attackerArmy }, 2);
  d.submit('defence.repair', { villageId: capital }, 1);
  assert.ok(d.events.some((e) => e.type === 'defence.repairStarted'), d.lastRejection());
});

test('defence.repair: refused with nothing damaged, and refused mid-window (no double-billing)', () => {
  const c = compose();
  const d = driver(c);
  c.kernel.step();
  const capital = c.villageOf(0) as number;

  d.submit('defence.repair', { villageId: capital });
  assert.match(d.lastRejection(), /nothing to repair/);

  damageKeep(c, capital, 0.2);
  d.submit('defence.repair', { villageId: capital });
  assert.ok(d.events.some((e) => e.type === 'defence.repairStarted'), d.lastRejection());
  d.submit('defence.repair', { villageId: capital });
  assert.match(d.lastRejection(), /already repairing/);
});

test('defence.repair: paid from the VILLAGE\'s own stores, not pooled with any other village', () => {
  const c = compose();
  const d = driver(c);
  c.kernel.step();
  const v0 = c.villageOf(0) as number;
  const v1 = c.villageOf(1) as number;
  damageKeep(c, v0, 1); // fully ruined: full def.cost is the bill
  const stoneOf = (vi: number): number => c.econGame.totalOf(vi, c.game.ops.resourceCode('base:resource.stone') as number);
  const v0Before = stoneOf(v0);
  const v1Before = stoneOf(v1);
  d.submit('defence.repair', { villageId: v0 });
  assert.ok(d.events.some((e) => e.type === 'defence.repairStarted'), d.lastRejection());
  assert.equal(stoneOf(v0), v0Before - 60, "v0's own stockpile paid the keep's full stone cost");
  assert.equal(stoneOf(v1), v1Before, "v1's stockpile untouched — no kingdom pooling");
});

test('defence layer: an in-flight repair survives save→load and stays in lockstep', () => {
  const original = compose();
  const d = driver(original);
  original.kernel.step();
  const capital = original.villageOf(0) as number;
  damageKeep(original, capital, 0.3);
  d.submit('defence.repair', { villageId: capital });
  assert.ok(d.events.some((e) => e.type === 'defence.repairStarted'), d.lastRejection());
  for (let t = 0; t < TICKS_PER_DAY * 3; t++) original.kernel.step(); // mid-window

  const save = original.saves.snapshot();
  assert.ok(save.sections['defenceRepairs'] !== undefined, 'defenceRepairs section present');

  const loaded = compose();
  const report = loaded.saves.hydrate(JSON.parse(JSON.stringify(save)) as typeof save);
  assert.deepEqual(report, []);
  assert.equal(loaded.kernel.stateHash(), original.kernel.stateHash(), 'hash identical after hydration');
  assert.equal(
    loaded.defenceGame.repairingUntil(capital),
    original.defenceGame.repairingUntil(capital),
    'repair window survives the round trip',
  );

  for (let t = 0; t < TICKS_PER_DAY * (REPAIR_DURATION_DAYS + 2); t++) {
    original.kernel.step();
    loaded.kernel.step();
  }
  assert.equal(loaded.kernel.stateHash(), original.kernel.stateHash(), 'both sessions resolve the repair in lockstep');
  assert.equal(loaded.defenceGame.repairingUntil(capital), undefined, 'repair completed in both');
});
