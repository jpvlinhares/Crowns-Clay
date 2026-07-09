/**
 * Brain scheduling skeleton (M19) — genesis spawns exactly `kingdomCount`
 * shadow AI kingdoms, and confidence decays deterministically through the
 * scheduled sensor system (not just the unit-level knowledge API already
 * covered in knowledge.test.ts).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Kernel } from '../kernel.js';
import { World } from '../ecs.js';
import { TICKS_PER_DAY } from '../time.js';
import { registerAiKernel, type AiGameplay } from './brain.js';

function makeAiKernel(kingdomCount: number, seed = 1): { kernel: Kernel; world: World; ai: AiGameplay } {
  const kernel = new Kernel(seed);
  const world = new World(64);
  const ai = registerAiKernel(kernel, world, { kingdomCount });
  kernel.attachGuard(world);
  kernel.addHashSource('world', (fold) => world.hash(fold));
  return { kernel, world, ai };
}

/** ai-genesis has phase 2 on a huge period, so it fires on tick 2. */
function stepUntilGenesis(kernel: Kernel, ai: AiGameplay): void {
  for (let i = 0; i < 5 && ai.kingdoms().length === 0; i++) kernel.step();
}

test('brain: genesis spawns exactly kingdomCount shadow AI kingdoms', () => {
  const { kernel, ai } = makeAiKernel(3);
  stepUntilGenesis(kernel, ai);
  assert.equal(ai.kingdoms().length, 3);
  assert.deepEqual(
    ai.kingdoms().map((k) => k.slot),
    [0, 1, 2],
  );
});

test('brain: confidence set at genesis decays after enough scheduled sensor ticks', () => {
  const { kernel, world, ai } = makeAiKernel(1);
  stepUntilGenesis(kernel, ai);

  const kingdom = ai.kingdoms()[0];
  assert.ok(kingdom !== undefined);

  // Seed a fact directly through the Knowledge component the way a future
  // sensor (M20+) would, then let the scheduled ai-sensors system decay it.
  const model = ai.knowledgeOf(kingdom);
  model.record({ subject: 5, kind: 'treasury', value: 100, confidence: 1, lastUpdated: kernel.currentTick, source: 'rumor' });
  world.writeObj(ai.Knowledge).set(kingdom.index, model.pack());

  const halfLifeDays = 30; // default half-life in brain.ts
  for (let i = 0; i < halfLifeDays * TICKS_PER_DAY; i++) kernel.step();

  const after = ai.knowledgeOf(kingdom).get(5, 'treasury');
  assert.ok(after !== undefined);
  assert.ok(Math.abs(after.confidence - 0.5) < 0.05); // ~one half-life elapsed
});

test('brain: deterministic — same seed replays to the same knowledge state', () => {
  const run = (): number[] => {
    const { kernel, world, ai } = makeAiKernel(2, 77);
    stepUntilGenesis(kernel, ai);
    for (const kingdom of ai.kingdoms()) {
      const model = ai.knowledgeOf(kingdom);
      model.record({ subject: 1, kind: 'armyStrength', value: 42, confidence: 0.9, lastUpdated: kernel.currentTick, source: 'scout' });
      world.writeObj(ai.Knowledge).set(kingdom.index, model.pack());
    }
    for (let i = 0; i < TICKS_PER_DAY * 10; i++) kernel.step();
    return ai.kingdoms().flatMap((k) => ai.knowledgeOf(k).pack());
  };
  assert.deepEqual(run(), run());
});
