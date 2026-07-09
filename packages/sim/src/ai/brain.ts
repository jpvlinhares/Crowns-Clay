/**
 * Brain scheduling skeleton (roadmap M19; doc 07 §1, §11; doc 08 §9).
 *
 * Spawns `kingdomCount` lightweight "shadow" AI kingdoms — marker entities
 * carrying only identity + a knowledge model, enough for fog-of-information
 * to mean something (a foreign subject to observe) without retrofitting the
 * full economy (kingdom.ts's ledger/edicts/rollup stay player-only; see doc
 * 07 §5 for the real per-kingdom economy work, which lands with the M20/M21
 * managers that actually need to act on it).
 *
 * Each AI kingdom gets sensor/appraisal/strategic systems on the doc 08 §9
 * cadence (daily, staggered by kingdom slot; weekly re-planning). Appraisal
 * and strategic bodies are deliberately empty here — situation scoring and
 * plan archetypes are M20/M21 (doc 07 §1); this milestone only proves the
 * schedule runs and that confidence decays (doc 07 §6).
 */
import { entityIndex, type EntityId } from '@crowns/core';
import { ObjectComponent, SoAComponent, World } from '../ecs.js';
import type { Kernel, SimSystem, TickContext } from '../kernel.js';
import { TICKS_PER_DAY } from '../time.js';
import { FogRegistry } from './fogQuery.js';
import { hashKnowledge, KnowledgeModel } from './knowledge.js';

const DEFAULT_CONFIDENCE_HALF_LIFE_TICKS = TICKS_PER_DAY * 30;

export interface AiKingdomInfo {
  readonly slot: number; // stagger key (doc 08 §9); stable across save/load
  readonly entity: EntityId;
  readonly index: number; // dense entity index — the fog/knowledge storage key
}

export interface AiKernelOptions {
  readonly kingdomCount: number;
  /** Ticks between confidence halving (doc 07 §6). Defaults to 30 days. */
  readonly confidenceHalfLifeTicks?: number;
}

export interface AiGameplay {
  readonly AiKingdom: SoAComponent<{ tag: 'u8' }>;
  readonly Knowledge: ObjectComponent<number[]>;
  readonly fog: FogRegistry;
  kingdoms(): readonly AiKingdomInfo[];
  knowledgeOf(kingdom: AiKingdomInfo): KnowledgeModel;
}

export function registerAiKernel(kernel: Kernel, world: World, options: AiKernelOptions): AiGameplay {
  const AiKingdom = world.defineSoA('aiKingdom', { tag: 'u8' });
  const Knowledge = world.defineObject<number[]>('knowledge', hashKnowledge);
  const fog = new FogRegistry(() => world.queryWordCount);
  const halfLife = options.confidenceHalfLifeTicks ?? DEFAULT_CONFIDENCE_HALF_LIFE_TICKS;

  const infos: AiKingdomInfo[] = [];

  const genesis: SimSystem = {
    name: 'ai-genesis',
    period: 0x7fffffff, // runs once, tick 1 — same convention as kingdom-genesis
    phase: 2,
    access: { writes: [AiKingdom, Knowledge] },
    update(): void {
      for (let slot = 0; slot < options.kingdomCount; slot++) {
        const entity = world.spawn();
        world.attach(entity, AiKingdom, { tag: 1 });
        world.attach(entity, Knowledge, []);
        infos.push({ slot, entity, index: entityIndex(entity) });
      }
    },
  };
  kernel.registerSystem(genesis);

  // Per-slot systems are registered up front (entities don't exist until
  // genesis runs on tick 1); the slot number IS the stagger key.
  for (let slot = 0; slot < options.kingdomCount; slot++) {
    kernel.registerSystem({
      name: `ai-sensors-${slot}`,
      period: TICKS_PER_DAY,
      phase: slot % TICKS_PER_DAY,
      access: { reads: [AiKingdom], writes: [Knowledge] },
      update(ctx: TickContext): void {
        const info = infos[slot];
        if (info === undefined) return; // genesis hasn't run yet
        const view = world.writeObj(Knowledge);
        const model = KnowledgeModel.unpack(view.tryGet(info.index) ?? []);
        model.decayAll(ctx.tick, halfLife);
        view.set(info.index, model.pack());
      },
    });
    kernel.registerSystem({
      name: `ai-appraisal-${slot}`,
      period: TICKS_PER_DAY,
      phase: slot % TICKS_PER_DAY,
      access: { reads: [Knowledge] },
      update(): void {
        // M19 stub: situation appraisal / utility scoring is M20/M21.
      },
    });
    kernel.registerSystem({
      name: `ai-strategic-${slot}`,
      period: TICKS_PER_DAY * 7,
      phase: slot % 7,
      access: {},
      update(): void {
        // M19 stub: plan archetypes / strategic planner is M21.
      },
    });
  }

  return {
    AiKingdom,
    Knowledge,
    fog,
    kingdoms: () => infos,
    knowledgeOf(kingdom: AiKingdomInfo): KnowledgeModel {
      return KnowledgeModel.unpack(world.readObj(Knowledge).tryGet(kingdom.index) ?? []);
    },
  };
}
