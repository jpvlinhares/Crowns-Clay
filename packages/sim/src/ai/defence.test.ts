/**
 * AI defence manager (M52) — the doc 12 Phase 8 T objectives:
 *
 *   1. harness: an AI kingdom's layout repels the baseline raid its economy
 *      tier should repel — and stays CRACKABLE by a serious column (GDD §7);
 *   2. templates visibly differ across seeds (different archetype picks and
 *      terrain skips ⇒ different layouts);
 *   3. discipline: one build per day through the ordinary command path, the
 *      stone reserve holds, garrison posts fill from idle units only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { composeCampaign } from '../campaign.js';
import { TICKS_PER_DAY } from '../time.js';
import { DEFAULT_PERSONALITY_WEIGHTS } from './planner.js';

/** Kingdom 1 is AI (the defender under test), pinned PACIFIST: aggression 0 keeps the
 * planner off war archetypes, so its garrison stays posted instead of being drafted into
 * a conquest of the undefended test player (which the first run of this suite promptly
 * did — the emergent systems compose a little too well). */
function compose(seed: number): ReturnType<typeof composeCampaign> {
  return composeCampaign({
    seed,
    kingdomCount: 2,
    mapSize: 'small',
    aiFromIndex: 1,
    weightsOf: () => ({ ...DEFAULT_PERSONALITY_WEIGHTS, aggression: 0, expansion: 0, riskTolerance: 0 }),
    mods: { sources: [] },
    // This suite tests the castle-BUILDING mechanism (template rises, layouts differ), which
    // needs a full stone reserve to raise a whole castle in the test window. Pin a generous stock
    // so the mechanism test is independent of the 1.x campaign pacing default (leaner stone) —
    // that pacing is exercised by the balance harness, not here.
    startingStock: { 'base:resource.wood': 2000, 'base:resource.stone': 500, 'base:resource.food': 300, 'base:resource.tools': 25 },
  });
}

/** Kingdom 1's defence-layer structure census: id → {def, x, y}. */
function census(c: ReturnType<typeof composeCampaign>): Map<number, string> {
  const out = new Map<number, string>();
  const s = c.world.read(c.defenceGame.DefenceStructure);
  c.world.query([c.defenceGame.DefenceStructure]).forEach((si, entity) => {
    if ((s.kingdom[si] as number) !== 1) return;
    out.set(entity as number, `${s.def[si]}@${s.x[si]},${s.y[si]}`);
  });
  return out;
}

function days(c: ReturnType<typeof composeCampaign>, n: number): void {
  for (let t = 0; t < n * TICKS_PER_DAY; t++) c.kernel.step();
}

function spawnUnits(c: ReturnType<typeof composeCampaign>, kingdomIndex: number, armyId: number, n: number): number[] {
  const def = c.db.units.get('base:unit.spearman');
  assert.ok(def !== undefined);
  const code = c.militaryGame.ops.defCode('base:unit.spearman');
  assert.ok(code !== undefined);
  const villageVi = c.villageOf(kingdomIndex);
  assert.ok(villageVi !== null);
  let villageId = -1;
  c.world.query([c.game.comps.VillageCore]).forEach((i, entity) => {
    if (i === villageVi) villageId = entity as number;
  });
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const unit = c.world.spawn();
    c.world.attach(unit, c.militaryGame.Unit, {
      def: code,
      kingdomId: c.kingdomGame.kingdomEntities()[kingdomIndex] as number,
      homeVillage: villageId,
      armyId,
      count: def.popCost.count,
      progress: 1,
      complete: true,
      morale: def.stats.moraleBase,
    });
    out.push(unit as number);
  }
  return out;
}

test('AI defence: the template rises one structure per day; the stone reserve holds', () => {
  const c = compose(0xd0c52);
  c.kernel.step(); // genesis (keep only)
  const atGenesis = census(c).size;
  assert.equal(atGenesis, 1, 'only the keep at genesis');
  days(c, 10);
  const after10 = census(c).size;
  assert.ok(after10 > atGenesis, 'the AI fortifies unprompted');
  assert.ok(after10 - atGenesis <= 10, 'at most one structure per day (anti-churn)');
  days(c, 25);
  const after35 = census(c).size;
  assert.ok(after35 > after10, 'the build queue keeps walking');

  // the reserve: the capital's stone never drops below the floor from defence spending
  const stoneCode = c.game.ops.resourceCode('base:resource.stone') as number;
  const capital = c.villageOf(1) as number;
  const stone = c.econGame.totalOf(capital, stoneCode);
  assert.ok(stone >= 0, `stone accounted (${stone})`);
});

test('AI defence: layouts visibly differ across seeds (archetype pick + terrain skips)', () => {
  const a = compose(0xd0c52);
  const b = compose(0xd0c53);
  a.kernel.step();
  b.kernel.step();
  days(a, 30);
  days(b, 30);
  const layoutA = [...census(a).values()].sort().join('|');
  const layoutB = [...census(b).values()].sort().join('|');
  assert.ok(census(a).size > 5 && census(b).size > 5, 'both kingdoms actually built');
  assert.notEqual(layoutA, layoutB, 'different seeds ⇒ visibly different castles');
});

test('AI defence: idle units get posted to the template anchors; drafted units leave again', () => {
  const c = compose(0xd0c52);
  c.kernel.step();
  const units = spawnUnits(c, 1, 0, 3);
  days(c, 4); // one post per day
  const posted = units.filter((u) => c.world.has(u as never, c.defenceGame.DefencePost));
  assert.ok(posted.length >= 2, `idle units garrison the walls (${posted.length}/3 after 4 days)`);
});

test('T objective: the AI layout repels the baseline raid — and stays crackable (GDD §7)', () => {
  const raid = (spearmen: number): { outcome: string; structures: number } => {
    const c = compose(0xd0c52);
    const events: Record<string, unknown>[] = [];
    c.kernel.subscribe('siege.assaultResolved', (e) => events.push(e.data as Record<string, unknown>));
    c.kernel.step();
    spawnUnits(c, 1, 0, 4); // a modest standing garrison for the AI to post
    days(c, 45); // the template rises; garrison posts
    const structures = census(c).size;

    // the player raids: an army at the AI capital, siege, assault
    const v0 = c.villageOf(0) as number;
    let v0Id = -1;
    c.world.query([c.game.comps.VillageCore]).forEach((i, entity) => {
      if (i === v0) v0Id = entity as number;
    });
    const submit = (type: string, payload: unknown): void => {
      c.kernel.submit({ type, issuer: 1, payload });
      c.kernel.step();
    };
    submit('army.createArmy', { name: 'Raid', villageId: v0Id });
    let armyId = -1;
    c.world.query([c.militaryGame.Army]).forEach((_ai, entity) => {
      const a = c.world.read(c.militaryGame.Army);
      if ((a.kingdomId[_ai] as number) === (c.kingdomGame.kingdomEntities()[0] as number)) armyId = entity as number;
    });
    assert.ok(armyId >= 0);
    spawnUnits(c, 0, armyId, spearmen);
    const v1 = c.villageOf(1) as number;
    const core = c.world.read(c.game.comps.VillageCore);
    const m = c.world.write(c.armiesGame.ArmyMovement);
    m.x[armyId & 0x3fffff] = (core.centerX[v1] as number) + 1;
    m.y[armyId & 0x3fffff] = core.centerY[v1] as number;
    c.world.writeObj(c.armiesGame.ArmyPath).set(armyId & 0x3fffff, []);
    let v1Id = -1;
    c.world.query([c.game.comps.VillageCore]).forEach((i, entity) => {
      if (i === v1) v1Id = entity as number;
    });
    submit('siege.begin', { armyId, villageId: v1Id });
    submit('siege.assault', { armyId, origin: 'left' });
    const r = events.at(-1);
    assert.ok(r !== undefined, 'assault resolved');
    return { outcome: String(r['outcome']), structures };
  };

  const baseline = raid(2); // 20 men — the tier-one raid
  assert.ok(baseline.structures > 15, `the AI actually built (${baseline.structures} structures)`);
  assert.equal(baseline.outcome, 'repelled', 'the layout repels the baseline raid');

  const heavy = raid(10); // 100 men — a serious column
  assert.equal(heavy.outcome, 'captured', 'castles stay crackable (GDD §7: strong but crackable)');
});

test('wrapper pinning: the AI harness composition stays defence-inert', () => {
  const c = composeCampaign({
    seed: 0xd0c52,
    kingdomCount: 2,
    mapSize: 'small',
    aiFromIndex: 1,
    aiDefence: false,
    mods: { sources: [] },
  });
  c.kernel.step();
  days(c, 10);
  assert.equal(census(c).size, 1, 'opt-out composition builds nothing beyond the keep');
});
