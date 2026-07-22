/**
 * Spatial assault resolution (M51) — the doc 12 Phase 8 T objectives:
 *
 *   1. same seed + same layouts + same armies ⇒ identical outcome AND trace
 *      (the cross-engine leg rides the golden CI, like every determinism
 *      contract since M5);
 *   2. GDD §8 pacing/shape: walls must actually be broken through, towers
 *      grind the column, a garrison can repel outright, and the keep's hold
 *      threshold decides marginal assaults;
 *   3. integration: a capital with a defence layer is siege-eligible without
 *      world-map walls, capture flips ownership AND the composition's
 *      ownership/capital bookkeeping, and a repulse leaves the siege standing.
 *
 * All scenarios drive REAL campaigns through ordinary commands (issuer 1 =
 * player attacker, issuer 2 = the defending kingdom's own layer/garrison
 * orders) with AI disabled (aiFromIndex: 2) for surgical control.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { composeCampaign } from '../campaign.js';
import { DEFENCE_MAP_SIZE, DEFENCE_TILE } from '../worldgen/defenceMap.js';
import { DEFENCE_KEEP_CENTRE } from './defence.js';

const SEED = 0xa55a17;

function compose(): ReturnType<typeof composeCampaign> {
  return composeCampaign({
    seed: SEED,
    kingdomCount: 2,
    mapSize: 'small',
    aiFromIndex: 2, // both kingdoms manual — surgical scenarios
    mods: { sources: [] },
    // These tests exercise the RESOLVER and the plain owner-flip capture path
    // (the M47.8/M51 bookkeeping gap). M53's capital-death chain intercepts that
    // capture for layer capitals — switched off here; succession.test.ts owns it.
    succession: false,
    // Pin a full stone reserve so the AI raises a whole castle to assault (these test the
    // wall-breach RESOLVER, not economy pacing — decoupled from the 1.x leaner-start default).
    startingStock: { 'base:resource.wood': 2000, 'base:resource.stone': 500, 'base:resource.food': 300, 'base:resource.tools': 25 },
  });
}

interface Driver {
  c: ReturnType<typeof composeCampaign>;
  events: { type: string; data: Record<string, unknown> }[];
  submit(type: string, payload: unknown, issuer?: number): void;
  days(n: number): void;
  villageEntity(vi: number): number;
  centreOf(vi: number): { x: number; y: number };
  makeArmy(kingdomIndex: number, atVillage: number, spearmen: number): number;
  placeArmy(armyId: number, x: number, y: number): void;
  spawnGarrison(kingdomIndex: number, atVillage: number, spearmen: number): number[];
  resolved(): Record<string, unknown> | undefined;
}

function driver(c: ReturnType<typeof composeCampaign>): Driver {
  const events: { type: string; data: Record<string, unknown> }[] = [];
  for (const type of ['army.created', 'siege.begun', 'siege.captured', 'siege.ended', 'siege.assaultResolved', 'village.rejected', 'defence.rejected', 'defence.built']) {
    c.kernel.subscribe(type, (e) => events.push({ type, data: e.data as Record<string, unknown> }));
  }
  const submit = (type: string, payload: unknown, issuer = 1): void => {
    c.kernel.submit({ type, issuer, payload });
    c.kernel.step();
  };
  const days = (n: number): void => {
    for (let t = 0; t < n * 24; t++) c.kernel.step();
  };
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
  const spawnUnits = (kingdomIndex: number, atVillage: number, armyId: number, spearmen: number): number[] => {
    const def = c.db.units.get('base:unit.spearman');
    assert.ok(def !== undefined);
    const code = c.militaryGame.ops.defCode('base:unit.spearman');
    assert.ok(code !== undefined);
    const out: number[] = [];
    for (let i = 0; i < spearmen; i++) {
      const unit = c.world.spawn();
      c.world.attach(unit, c.militaryGame.Unit, {
        def: code,
        kingdomId: c.kingdomGame.kingdomEntities()[kingdomIndex] as number,
        homeVillage: villageEntity(atVillage),
        armyId,
        count: def.popCost.count,
        progress: 1,
        complete: true,
        morale: def.stats.moraleBase,
      });
      out.push(unit as number);
    }
    return out;
  };
  const makeArmy = (kingdomIndex: number, atVillage: number, spearmen: number): number => {
    submit('army.createArmy', { name: `A${kingdomIndex}`, villageId: villageEntity(atVillage) }, kingdomIndex + 1);
    const created = events.filter((e) => e.type === 'army.created').at(-1);
    const armyId = (created?.data['army'] as number | undefined) ?? -1;
    assert.ok(armyId >= 0, 'army created');
    spawnUnits(kingdomIndex, atVillage, armyId, spearmen);
    return armyId;
  };
  const placeArmy = (armyId: number, x: number, y: number): void => {
    const ai = armyId & 0x3fffff;
    const m = c.world.write(c.armiesGame.ArmyMovement);
    m.x[ai] = x;
    m.y[ai] = y;
    c.world.writeObj(c.armiesGame.ArmyPath).set(ai, []);
  };
  const spawnGarrison = (kingdomIndex: number, atVillage: number, spearmen: number): number[] => spawnUnits(kingdomIndex, atVillage, 0, spearmen);
  const resolved = (): Record<string, unknown> | undefined => events.filter((e) => e.type === 'siege.assaultResolved').at(-1)?.data;
  return { c, events, submit, days, villageEntity, centreOf, makeArmy, placeArmy, spawnGarrison, resolved };
}

/** Boot to genesis and stand a player army at kingdom 1's capital, siege begun. */
function besiegeCapital(d: Driver, spearmen: number): { v1: number; armyId: number } {
  d.c.kernel.step(); // genesis
  const v1 = d.c.villageOf(1) as number;
  assert.ok(v1 !== null);
  const v0 = d.c.villageOf(0) as number;
  const armyId = d.makeArmy(0, v0, spearmen);
  const p = d.centreOf(v1);
  d.placeArmy(armyId, p.x + 1, p.y);
  d.submit('siege.begin', { armyId, villageId: d.villageEntity(v1) }, 1);
  assert.ok(
    d.events.some((e) => e.type === 'siege.begun'),
    `siege eligible via the defence layer (rejections: ${JSON.stringify(d.events.filter((e) => e.type === 'village.rejected').slice(-2))})`,
  );
  return { v1, armyId };
}

const openTileNearKeep = (c: ReturnType<typeof composeCampaign>, vi: number, r: number): { x: number; y: number } => {
  const map = c.defenceGame.mapOf(vi);
  assert.ok(map !== undefined);
  const occ = c.defenceGame.occupancyOf(vi);
  for (let dx = r; dx < 45; dx++) {
    const x = DEFENCE_KEEP_CENTRE + dx;
    const t = DEFENCE_KEEP_CENTRE * DEFENCE_MAP_SIZE + x;
    if (map.tiles[t] === DEFENCE_TILE.open && !occ.has(t)) return { x, y: DEFENCE_KEEP_CENTRE };
  }
  assert.fail('no open tile');
};

// ---------------- outcomes ----------------

test('assault: a strong column takes an unwalled capital; ownership and capital bookkeeping follow', () => {
  const d = driver(compose());
  const { armyId } = besiegeCapital(d, 3); // 30 men, strength 150 ≥ holdStrength 60
  d.submit('siege.assault', { armyId, origin: 'left' }, 1);
  const r = d.resolved();
  assert.ok(r !== undefined, 'assault resolved spatially');
  assert.equal(r['outcome'], 'captured');
  assert.ok(Array.isArray(r['trace']) && (r['trace'] as unknown[]).length > 2, 'trace present');
  assert.ok(d.events.some((e) => e.type === 'siege.captured'), 'castle captured');
  // the composition's plain bookkeeping followed the capture (the M47.8 latent gap, closed)
  assert.equal(d.c.villageOf(1), null, 'the loser owned only its capital — binding deleted');
});

test('assault: a token column is repelled at the keep threshold; the siege stands', () => {
  const d = driver(compose());
  const { armyId } = besiegeCapital(d, 1); // 10 men, strength 50 < holdStrength 60
  d.submit('siege.assault', { armyId, origin: 'left' }, 1);
  const r = d.resolved();
  assert.ok(r !== undefined);
  assert.equal(r['outcome'], 'repelled');
  assert.ok(!d.events.some((e) => e.type === 'siege.captured'));
  assert.ok(d.c.siegeGame.state.siegeOfArmy(armyId) !== undefined, 'the siege outside continues');
});

test('assault: a garrison bleeds the column — and a big one repels it outright', () => {
  // baseline: no garrison
  const a = driver(compose());
  const sa = besiegeCapital(a, 3);
  a.submit('siege.assault', { armyId: sa.armyId, origin: 'left' }, 1);
  const baselineLoss = (a.resolved()?.['attackerLoss'] as number) ?? 0;

  // same world, but the defender posts a garrison AT THE KEEP'S GATES — every column
  // must come keep-adjacent to win, so a keep-side post always meets it (the resolver
  // legitimately flanks anything that doesn't actually gate the approach)
  const b = driver(compose());
  const sb = besiegeCapital(b, 3);
  // ring EVERY side-adjacent keep tile: whatever face the flow field approaches, the
  // column meets a post (the resolver legitimately picks the nearest keep face, which
  // depends on this seed's terrain — the fixture must not guess it)
  const keepLo = DEFENCE_KEEP_CENTRE - 1; // keep footprint x/y ∈ {keepLo, keepLo+1}
  const ringSpots: { x: number; y: number }[] = [];
  for (const o of [0, 1]) {
    ringSpots.push({ x: keepLo - 1, y: keepLo + o });
    ringSpots.push({ x: keepLo + 2, y: keepLo + o });
    ringSpots.push({ x: keepLo + o, y: keepLo - 1 });
    ringSpots.push({ x: keepLo + o, y: keepLo + 2 });
  }
  const garrison = b.spawnGarrison(1, sb.v1, ringSpots.length);
  for (const [i, unit] of garrison.entries()) {
    const spot = ringSpots[i] as { x: number; y: number };
    b.submit('defence.post', { unitId: unit, x: spot.x, y: spot.y }, 2);
  }
  b.submit('siege.assault', { armyId: sb.armyId, origin: 'left' }, 1);
  const r = b.resolved();
  assert.ok(r !== undefined);
  assert.ok((r['trace'] as { kind: string }[]).some((t) => t.kind === 'clash'), 'the garrison fought');
  assert.equal(r['outcome'], 'repelled', 'a full keep-ring garrison repels a 3-unit column (defender advantage)');
  assert.ok((r['attackerLoss'] as number) > baselineLoss, 'the garrison cost the attacker real casualties');
});

test('assault: walls must be broken through — the trace shows wall-hits and breaches, and structures really fall', () => {
  const d = driver(compose());
  const { v1, armyId } = besiegeCapital(d, 4);
  // the defender CLOSES A RING around the keep — a mere line gets flanked (correctly),
  // so the fixture must genuinely gate every approach. Radius 5 inside the guaranteed
  // keep clearing: all-open ground, ~40 walls, well inside the starting stone.
  const before = d.c.defenceGame.occupancyOf(v1).size;
  const ringR = 5;
  for (let i = -ringR; i <= ringR; i++) {
    for (const [x, y] of [
      [DEFENCE_KEEP_CENTRE + i, DEFENCE_KEEP_CENTRE - ringR],
      [DEFENCE_KEEP_CENTRE + i, DEFENCE_KEEP_CENTRE + ringR],
      [DEFENCE_KEEP_CENTRE - ringR, DEFENCE_KEEP_CENTRE + i],
      [DEFENCE_KEEP_CENTRE + ringR, DEFENCE_KEEP_CENTRE + i],
    ] as const) {
      d.submit('defence.build', { villageId: v1, def: 'base:building.wall', x, y }, 2);
    }
  }
  const built = d.events.filter((e) => e.type === 'defence.built' && e.data['def'] === 'base:building.wall').length;
  assert.ok(built >= 30, `wall ring built (${built})`);
  d.submit('siege.assault', { armyId, origin: 'left' }, 1);
  const r = d.resolved();
  assert.ok(r !== undefined);
  const kinds = new Set((r['trace'] as { kind: string }[]).map((t) => t.kind));
  assert.ok(kinds.has('wall'), 'the column hit the wall line');
  assert.ok((r['breaches'] as number) >= 1, 'at least one breach opened');
  assert.ok(d.c.defenceGame.occupancyOf(v1).size < before + built, 'breached segments are really gone');
  assert.equal(r['outcome'], 'captured', 'the line alone cannot stop 4 units without a garrison');
});

test('assault: towers grind the column (rangedArc content finally live)', () => {
  const a = driver(compose());
  const sa = besiegeCapital(a, 3);
  a.submit('siege.assault', { armyId: sa.armyId, origin: 'left' }, 1);
  const baselineLoss = (a.resolved()?.['attackerLoss'] as number) ?? 0;

  const b = driver(compose());
  const sb = besiegeCapital(b, 3);
  // two towers on the west lane
  b.submit('defence.build', { villageId: sb.v1, def: 'base:building.tower', x: DEFENCE_KEEP_CENTRE - 10, y: DEFENCE_KEEP_CENTRE - 2 }, 2);
  b.submit('defence.build', { villageId: sb.v1, def: 'base:building.tower', x: DEFENCE_KEEP_CENTRE - 14, y: DEFENCE_KEEP_CENTRE + 2 }, 2);
  b.submit('siege.assault', { armyId: sb.armyId, origin: 'left' }, 1);
  const r = b.resolved();
  assert.ok(r !== undefined);
  assert.ok((r['trace'] as { kind: string }[]).some((t) => t.kind === 'tower'), 'tower fire in the trace');
  assert.ok((r['attackerLoss'] as number) > baselineLoss, 'towers cost the attacker more than open ground');
});

// ---------------- determinism (T objective) ----------------

test('assault: same seed + same layout + same army ⇒ identical outcome, trace, and state hash', () => {
  const run = (): { trace: string; hash: number } => {
    const d = driver(compose());
    const { v1, armyId } = besiegeCapital(d, 2);
    const site = openTileNearKeep(d.c, v1, 4);
    d.submit('defence.build', { villageId: v1, def: 'base:building.tower', x: site.x, y: site.y }, 2);
    d.submit('siege.assault', { armyId, origin: 'bottom' }, 1);
    const r = d.resolved();
    assert.ok(r !== undefined);
    return { trace: JSON.stringify(r), hash: d.c.kernel.stateHash() };
  };
  const first = run();
  const second = run();
  assert.equal(first.trace, second.trace, 'identical resolved event, trace included');
  assert.equal(first.hash, second.hash, 'identical post-assault state hash');
});

// ---------------- conflict rule ----------------

test('drafting a posted unit into an army pulls it off the walls', () => {
  const d = driver(compose());
  d.c.kernel.step();
  const v0 = d.c.villageOf(0) as number;
  const [unit] = d.spawnGarrison(0, v0, 1);
  assert.ok(unit !== undefined);
  const site = openTileNearKeep(d.c, v0, 3);
  d.submit('defence.post', { unitId: unit, x: site.x, y: site.y }, 1);
  assert.ok(d.c.world.has(unit as never, d.c.defenceGame.DefencePost), 'posted');
  d.submit('army.createArmy', { name: 'Levy', villageId: d.villageEntity(v0) }, 1);
  const armyId = d.events.filter((e) => e.type === 'army.created').at(-1)?.data['army'] as number;
  d.submit('army.assignUnit', { unitId: unit, armyId }, 1);
  assert.ok(!d.c.world.has(unit as never, d.c.defenceGame.DefencePost), 'the draft cleared the post — one soldier pool, one place at a time');
});
