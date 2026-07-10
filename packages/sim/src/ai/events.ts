/**
 * AI event answers (roadmap M33; GDD Appendix A; doc 06 §11 `aiScoreHints`).
 * Daily: for every pending (unanswered) event instance a kingdom holds,
 * score each choice as `Σ aiScoreHints[axis] * weights[axis]` over shared
 * axis names (unknown axes default to neutral 0.5, the same "no opinion"
 * default `PersonalityWeights` itself uses for its own optional axes) and
 * submit `event.choose` for the highest scorer. A choice whose requirements
 * aren't met is simply rejected by the command handler and retried
 * unchanged next day — same "rejected silently is fine" tolerance M25's
 * recruit-order fallback and M30's build-one-per-day manager both already
 * accept, not a new risk this module introduces.
 */
import type { EntityId } from '@crowns/core';
import type { Kernel, SimSystem } from '../kernel.js';
import { TICKS_PER_DAY } from '../time.js';
import type { EventGameplay } from '../game/events.js';

export interface AiEventOptions {
  readonly issuer: number;
  readonly kingdomId: EntityId;
  readonly weights: Readonly<Record<string, number | undefined>>;
  readonly id?: string;
}

export function registerAiEventAnswering(kernel: Kernel, eventGame: EventGameplay, options: AiEventOptions): void {
  const system: SimSystem = {
    name: options.id !== undefined ? `ai-events-${options.id}` : 'ai-events',
    period: TICKS_PER_DAY,
    phase: 11,
    update(): void {
      for (const pending of eventGame.pendingChoices(options.kingdomId)) {
        const code = eventGame.eventCode(pending.eventId);
        if (code === undefined) continue;
        const def = eventGame.eventById(code);
        let best: { id: string; score: number } | undefined;
        for (const choice of def.choices) {
          let score = 0;
          for (const [axis, hint] of Object.entries(choice.aiScoreHints ?? {})) {
            score += hint * (options.weights[axis] ?? 0.5);
          }
          if (best === undefined || score > best.score) best = { id: choice.id, score };
        }
        if (best !== undefined) {
          kernel.submit({ type: 'event.choose', issuer: options.issuer, payload: { eventId: pending.eventId, choiceId: best.id } });
        }
      }
    },
  };
  kernel.registerSystem(system);
}
