/**
 * Research (M32) — the roadmap test objective is "DAG validation; era pacing
 * sim" (doc 12): the tech tree's prerequisite graph must be acyclic and
 * tier/era-monotonic (validated at content load, terrain.ts), and the era
 * gate must actually pace progression — no beelining straight to a late-era
 * tech, and a bounded research budget lands at a sane, non-trivial fraction
 * of the tree, never violating era ordering along the way.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DefinitionDatabase, BASE_CONTENT_FILES, ERA_ORDER, type TechDef } from '@crowns/data';
import { Kernel } from '../kernel.js';
import { World } from '../ecs.js';
import { TICKS_PER_DAY } from '../time.js';
import { registerVillageGameplay, type TerrainAccessor } from './villages.js';
import { registerPopulationGameplay } from './population.js';
import { registerEconomyGameplay } from './economy.js';
import { registerKingdomGameplay, StatModifiers } from './kingdom.js';
import { registerResearchGameplay, ERA_BREADTH_FRACTION } from './research.js';

const plain: TerrainAccessor = {
  width: 64,
  height: 64,
  tagsAt: () => ['open', 'farmable', 'mineable', 'woodland'],
  riverAt: () => false,
  movementCostAt: () => 1,
};

function makeKingdom(options: { seed?: number; huts?: number; knownByNeighbor?: (kingdomId: number, techId: string) => boolean } = {}) {
  const kernel = new Kernel(options.seed ?? 41);
  const world = new World(512);
  const db = DefinitionDatabase.load(BASE_CONTENT_FILES);
  const mods = new StatModifiers();
  const game = registerVillageGameplay(kernel, world, db, plain, { 'base:resource.wood': 2000, 'base:resource.stone': 500 });
  const popGame = registerPopulationGameplay(kernel, world, db, game, { children: 8, adults: 20, elders: 3 }, mods);
  const econ = registerEconomyGameplay(kernel, world, db, game, mods);
  const kingdomGame = registerKingdomGameplay(kernel, world, db, game, popGame, econ, mods);
  const researchGame = registerResearchGameplay(kernel, world, db, game, kingdomGame, {
    knownByNeighbor: options.knownByNeighbor as never,
  });
  kernel.attachGuard(world);
  kernel.addHashSource('world', (fold) => world.hash(fold));

  const rejections: string[] = [];
  const events: { type: string; data: unknown }[] = [];
  kernel.subscribe<{ what: string; reason: string }>('village.rejected', (e) => rejections.push(`${e.data.what}: ${e.data.reason}`));
  for (const type of ['research.setActive', 'research.completed']) {
    kernel.subscribe(type, (e) => events.push({ type, data: e.data }));
  }

  const submit = (type: string, issuer: number, payload: unknown): void => {
    kernel.submit({ type, issuer, payload });
    kernel.step();
  };
  submit('village.found', 1, { x: 30, y: 30, name: 'Athenaeum' });
  let villageId = -1;
  world.query([popGame.Population]).forEach((_i, entity) => (villageId = entity as number));
  assert.ok(villageId >= 0);

  const placeNear = (defId: string): void => {
    const def = db.buildings.get(defId);
    assert.ok(def !== undefined);
    for (let r = 2; r <= 11; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          if (!game.ops.validatePlacement(def, 30 + dx, 30 + dy, villageId as never).ok) continue;
          submit('village.build', 1, { villageId, def: defId, x: 30 + dx, y: 30 + dy });
          return;
        }
      }
    }
    assert.fail(`no valid spot for ${defId}`);
  };
  for (let h = 0; h < (options.huts ?? 3); h++) placeNear('base:building.scribes-hut');

  const days = (n: number): void => {
    for (let t = 0; t < n * TICKS_PER_DAY; t++) kernel.step();
  };
  const kingdomId = kingdomGame.kingdomEntities()[0] as number;

  return { kernel, world, db, game, popGame, econ, kingdomGame, researchGame, villageId, kingdomId, days, submit, rejections, events };
}

// ---------------------------------------------------------------- DAG validation

test('content: the base tech tree is 60-80 nodes across all 4 branches and 3 eras', () => {
  const db = DefinitionDatabase.load(BASE_CONTENT_FILES);
  assert.ok(db.techs.size >= 60 && db.techs.size <= 80, `expected 60-80 techs, got ${db.techs.size}`);
  const branches = new Set([...db.techs.values()].map((t) => t.branch));
  assert.deepEqual([...branches].sort(), ['agriculture', 'construction', 'statecraft', 'warfare']);
  const eras = new Set([...db.techs.values()].map((t) => t.era));
  assert.deepEqual([...eras].sort(), ['early', 'high', 'late'].sort());
});

test('content: the tech DAG is acyclic and tier/era-monotonic along every prerequisite edge', () => {
  const db = DefinitionDatabase.load(BASE_CONTENT_FILES);
  const byId = db.techs;
  // explicit, independent re-check (not just "loading didn't throw") — Kahn's algorithm
  const inDegree = new Map<string, number>([...byId.keys()].map((id) => [id, 0]));
  for (const t of byId.values()) {
    for (const _pre of t.prerequisites) inDegree.set(t.id, (inDegree.get(t.id) as number) + 1);
  }
  const ready = [...inDegree.entries()].filter(([, d]) => d === 0).map(([id]) => id);
  const dependents = new Map<string, string[]>();
  for (const t of byId.values()) {
    for (const pre of t.prerequisites) dependents.set(pre, [...(dependents.get(pre) ?? []), t.id]);
  }
  let visited = 0;
  while (ready.length > 0) {
    const id = ready.pop() as string;
    visited++;
    for (const dep of dependents.get(id) ?? []) {
      const d = (inDegree.get(dep) as number) - 1;
      inDegree.set(dep, d);
      if (d === 0) ready.push(dep);
    }
  }
  assert.equal(visited, byId.size, 'every tech must be reachable in topological order (acyclic)');

  for (const t of byId.values()) {
    for (const preId of t.prerequisites) {
      const pre = byId.get(preId) as TechDef;
      assert.ok(pre.tier <= t.tier, `${t.id} (tier ${t.tier}) has higher-tier prerequisite ${preId} (tier ${pre.tier})`);
      assert.ok(ERA_ORDER.indexOf(pre.era) <= ERA_ORDER.indexOf(t.era), `${t.id} (${t.era}) has later-era prerequisite ${preId} (${pre.era})`);
    }
  }
});

test('content: unlocks reference real building/unit/edict ids', () => {
  const db = DefinitionDatabase.load(BASE_CONTENT_FILES);
  for (const t of db.techs.values()) {
    for (const id of t.unlocks?.buildings ?? []) assert.ok(db.buildings.has(id), `${t.id} unlocks unknown building ${id}`);
    for (const id of t.unlocks?.units ?? []) assert.ok(db.units.has(id), `${t.id} unlocks unknown unit ${id}`);
    for (const id of t.unlocks?.edicts ?? []) assert.ok(db.edicts.has(id), `${t.id} unlocks unknown edict ${id}`);
  }
});

/** Real terrain/overlays from base content — isolates these tests to just the tech-DAG
 * checks without also tripping the (unrelated) biome/overlay coverage integrity gates. */
function techsOnly(techs: readonly TechDef[]): () => DefinitionDatabase {
  return () => {
    const base = DefinitionDatabase.load(BASE_CONTENT_FILES);
    return DefinitionDatabase.fromValidated([...base.terrainByCode], [...base.overlays.values()], [], [], [], [], techs);
  };
}

test('DAG validation actually rejects a cycle (not just passing by construction)', () => {
  const base = [...DefinitionDatabase.load(BASE_CONTENT_FILES).techs.values()];
  const cyclic: TechDef[] = [
    { ...base[0] as TechDef, id: 'base:tech.cycle-a', prerequisites: ['base:tech.cycle-b'] },
    { ...base[0] as TechDef, id: 'base:tech.cycle-b', prerequisites: ['base:tech.cycle-a'] },
  ];
  assert.throws(techsOnly(cyclic), /cycle/);
});

test('DAG validation rejects a higher-tier prerequisite and an unknown unlock reference', () => {
  const base = DefinitionDatabase.load(BASE_CONTENT_FILES);
  const tier5 = [...base.techs.values()].find((t) => t.tier === 5) as TechDef;
  const tier1 = [...base.techs.values()].find((t) => t.tier === 1) as TechDef;
  const badTier: TechDef = { ...tier1, id: 'base:tech.bad-tier', prerequisites: [tier5.id] };
  assert.throws(techsOnly([tier5, badTier]), /higher-tier/);

  const badUnlock: TechDef = { ...tier1, id: 'base:tech.bad-unlock', prerequisites: [], unlocks: { buildings: ['base:building.does-not-exist'] } };
  assert.throws(techsOnly([badUnlock]), /unknown building/);
});

// ---------------------------------------------------------------- era pacing sim

test('era gate: cannot start a high-era tech before the prior era has enough breadth', () => {
  const { submit, rejections } = makeKingdom();
  const db = DefinitionDatabase.load(BASE_CONTENT_FILES);
  // even a 'high' tech whose own prerequisites happen to be met (impossible here with zero
  // early techs known, since every 'high' tech requires 'early' ones) would still need to
  // clear the era-breadth gate — the rejection reason names one or the other; either way,
  // nothing in 'high' or 'late' is reachable with zero techs known.
  const anyHigh = [...db.techs.values()].find((t) => t.era === 'high') as TechDef;
  submit('kingdom.setActiveResearch', 1, { techId: anyHigh.id });
  assert.ok(rejections.some((r) => r.includes("era 'high' not yet unlocked") || r.includes('missing prerequisites')));
});

test('kingdom.setActiveResearch: rejects unknown techs and grants a prerequisite-free early tech', () => {
  const { submit, rejections, events, researchGame, kingdomId } = makeKingdom();
  submit('kingdom.setActiveResearch', 1, { techId: 'base:tech.does-not-exist' });
  assert.ok(rejections.some((r) => r.includes("unknown tech")));

  const db = DefinitionDatabase.load(BASE_CONTENT_FILES);
  const rootTech = [...db.techs.values()].find((t) => t.tier === 1 && t.branch === 'agriculture') as TechDef;
  submit('kingdom.setActiveResearch', 1, { techId: rootTech.id });
  assert.ok(events.some((e) => e.type === 'research.setActive'));
  assert.equal(researchGame.activeResearch(kingdomId as never)?.techId, rootTech.id);
});

test('daily accrual: scholar buildings fund progress until the active tech completes', () => {
  const { submit, days, events, researchGame, kingdomId } = makeKingdom({ huts: 3 }); // 3 x 2 pts/day = 6/day
  days(10); // let construction complete and staff before measuring accrual
  const db = DefinitionDatabase.load(BASE_CONTENT_FILES);
  const rootTech = [...db.techs.values()].find((t) => t.tier === 1 && t.branch === 'agriculture') as TechDef; // cost 20
  submit('kingdom.setActiveResearch', 1, { techId: rootTech.id });

  days(2); // ~12 points — not yet enough
  assert.ok(!events.some((e) => e.type === 'research.completed'));
  const midProgress = researchGame.activeResearch(kingdomId as never)?.progress ?? 0;
  assert.ok(midProgress > 0 && midProgress < rootTech.cost, `expected partial progress, got ${midProgress}`);

  days(3); // total ~30 points — clears cost 20
  assert.ok(events.some((e) => e.type === 'research.completed'));
  assert.ok(researchGame.isKnown(kingdomId as never, rootTech.id));
  assert.equal(researchGame.activeResearch(kingdomId as never), undefined);
});

test('switching active research abandons progress on the old one (v1 simplification)', () => {
  const { submit, days, researchGame, kingdomId } = makeKingdom({ huts: 3 });
  days(10);
  const db = DefinitionDatabase.load(BASE_CONTENT_FILES);
  const [a, b] = [...db.techs.values()].filter((t) => t.tier === 1);
  submit('kingdom.setActiveResearch', 1, { techId: (a as TechDef).id });
  days(1);
  assert.ok((researchGame.activeResearch(kingdomId as never)?.progress ?? 0) > 0);
  submit('kingdom.setActiveResearch', 1, { techId: (b as TechDef).id });
  assert.equal(researchGame.activeResearch(kingdomId as never)?.progress, 0);
  assert.equal(researchGame.activeResearch(kingdomId as never)?.techId, (b as TechDef).id);
});

test('diffusion: a known-by-neighbor tech costs exactly (1 - diffusionDiscount) of the full price', () => {
  const db = DefinitionDatabase.load(BASE_CONTENT_FILES);
  const tech = [...db.techs.values()].find((t) => t.tier === 1) as TechDef;
  const { researchGame, kingdomId } = makeKingdom({ knownByNeighbor: () => true });
  const discounted = researchGame.costOf(kingdomId as never, tech.id);
  assert.ok(Math.abs(discounted - tech.cost * (1 - tech.diffusionDiscount)) < 1e-9);

  const { researchGame: noHook, kingdomId: kingdomId2 } = makeKingdom();
  assert.equal(noHook.costOf(kingdomId2 as never, tech.id), tech.cost);
});

test('era pacing sim: a bounded research budget reaches a real, non-trivial fraction of the tree without ever skipping a gate', () => {
  const { kernel, submit, days, events, researchGame, kingdomId } = makeKingdom({ huts: 6 }); // 12 pts/day
  const db = DefinitionDatabase.load(BASE_CONTENT_FILES);
  const total = db.techs.size;

  const completedByEra: Record<string, number> = { early: 0, high: 0, late: 0 };
  const totalByEra: Record<string, number> = { early: 0, high: 0, late: 0 };
  for (const t of db.techs.values()) totalByEra[t.era] = (totalByEra[t.era] as number) + 1;
  let violation: string | undefined;
  kernel.subscribe<{ techId: string }>('research.completed', (e) => {
    const t = db.techs.get(e.data.techId) as TechDef;
    completedByEra[t.era] = (completedByEra[t.era] as number) + 1;
    // at the moment ANY 'high' tech completes, 'early' must already have met the breadth bar
    // (and likewise late vs. high) — the live, running proof that the gate isn't just a
    // command-rejection formality but actually holds throughout a real simulated campaign.
    const eraIdx = ERA_ORDER.indexOf(t.era);
    if (eraIdx > 0) {
      const priorEra = ERA_ORDER[eraIdx - 1] as string;
      const fraction = (completedByEra[priorEra] as number) / (totalByEra[priorEra] as number);
      if (fraction < ERA_BREADTH_FRACTION - 1e-9) {
        violation = `${t.id} (${t.era}) completed with only ${(fraction * 100).toFixed(0)}% of ${priorEra} known`;
      }
    }
  });

  // greedy driver: each time nothing is active, start the cheapest currently-available tech
  const YEARS = 6;
  for (let y = 0; y < YEARS; y++) {
    for (let d = 0; d < 360; d++) {
      if (researchGame.activeResearch(kingdomId as never) === undefined) {
        const available = researchGame.availableTechs(kingdomId as never);
        if (available.length > 0) {
          const cheapest = [...available].sort(
            (x, z) => researchGame.costOf(kingdomId as never, x) - researchGame.costOf(kingdomId as never, z),
          )[0] as string;
          submit('kingdom.setActiveResearch', 1, { techId: cheapest });
        }
      }
      days(1);
    }
  }

  assert.equal(violation, undefined, violation);
  const knownCount = [...db.techs.keys()].filter((id) => researchGame.isKnown(kingdomId as never, id)).length;
  const fraction = knownCount / total;
  assert.ok(fraction > 0.3, `expected meaningful progress over ${YEARS} years, got ${(fraction * 100).toFixed(0)}%`);
  assert.ok(fraction < 1.0 || events.length > 0, 'sanity: some completion events must have fired');
});

// ---------------------------------------------------------------- determinism

test('determinism: research state folds identically for the same command sequence', () => {
  const run = (): number => {
    const { kernel, submit, days } = makeKingdom({ huts: 3 });
    const db = DefinitionDatabase.load(BASE_CONTENT_FILES);
    const rootTech = [...db.techs.values()].find((t) => t.tier === 1) as TechDef;
    submit('kingdom.setActiveResearch', 1, { techId: rootTech.id });
    days(5);
    return kernel.stateHash();
  };
  assert.equal(run(), run());
});
