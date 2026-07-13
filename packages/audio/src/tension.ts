/**
 * Tension state (roadmap M41; doc 05 §8): "music director selects era/
 * season/tension-state playlists (tension from war/unrest events with
 * hysteresis)". Pure and DOM-free — no `AudioContext`, no timers — so it's
 * fully unit-testable in Node, the same "pure core, thin browser shell"
 * split `packages/render/src/terrain.ts`'s `ChunkTracker` already uses.
 *
 * A single `heat` scalar (0..1) rises on war/unrest GameEvents and decays
 * linearly over elapsed ticks; `TensionState` is HEAT PASSED THROUGH
 * SEPARATE up/down thresholds per band (classic hysteresis: entering
 * 'combat' takes more heat than leaving it keeps) — the "no flapping"
 * guarantee doc 05 §8 asks for, the same shape `ai/planner.ts`'s plan-switch
 * hysteresis bonus already establishes elsewhere in this codebase (a
 * different mechanism, same goal: don't reverse a state on a one-tick blip).
 */
import type { GameEvent } from '@crowns/protocol';

export const TENSION_STATES = ['calm', 'tense', 'combat'] as const;
export type TensionState = (typeof TENSION_STATES)[number];

/** Event type → heat contribution (0..1); anything unlisted contributes 0. */
export const TENSION_EVENT_WEIGHTS: Readonly<Record<string, number>> = {
  'diplomacy.warDeclared': 0.3,
  'diplomacy.joinedWar': 0.2,
  'siege.begun': 0.5,
  'siege.assaultBegun': 0.4,
  'siege.sortieBegun': 0.3,
  'siege.breached': 0.3,
  'battle.resolved': 0.35,
  'defeat.kingdom': 0.2,
  'village.starving': 0.15,
};

// heat ≥ *_ENTER crosses UP into that band; heat must fall to ≤ *_EXIT to drop back out —
// the gap between enter/exit is the hysteresis margin (doc 05 §8's "no flapping").
export const TENSE_ENTER = 0.35;
export const TENSE_EXIT = 0.15;
export const COMBAT_ENTER = 0.75;
export const COMBAT_EXIT = 0.5;

/** Heat lost per elapsed tick with no reinforcing events (linear decay). */
export const DECAY_PER_TICK = 0.0015;

export class TensionTracker {
  private heat = 0;
  private state: TensionState = 'calm';
  private lastTick = 0;

  /** Current state without advancing anything (e.g. for a debug readout). */
  current(): TensionState {
    return this.state;
  }

  currentHeat(): number {
    return this.heat;
  }

  /** Let heat decay for ticks that passed with no event (call periodically, e.g. per pump). */
  advance(tick: number): TensionState {
    this.decay(tick);
    return this.recompute();
  }

  /** Fold one GameEvent's heat contribution in, decaying for the elapsed ticks first. */
  push(event: GameEvent): TensionState {
    this.decay(event.tick);
    const weight = TENSION_EVENT_WEIGHTS[event.type] ?? 0;
    if (weight > 0) this.heat = Math.min(1, this.heat + weight);
    return this.recompute();
  }

  private decay(tick: number): void {
    const elapsed = Math.max(0, tick - this.lastTick);
    this.lastTick = tick;
    if (elapsed > 0) this.heat = Math.max(0, this.heat - DECAY_PER_TICK * elapsed);
  }

  /** Hysteresis: rising heat can jump straight from calm to combat on a big spike; falling
   * heat must cross the (lower) exit threshold of whichever band it's currently in — checked
   * repeatedly so a large single decay can still fall through multiple bands correctly (each
   * step still respects its own band's exit threshold; nothing skips a hysteresis check). */
  private recompute(): TensionState {
    let changed = true;
    while (changed) {
      changed = false;
      if (this.state === 'combat') {
        if (this.heat <= COMBAT_EXIT) {
          this.state = 'tense';
          changed = true;
        }
      } else if (this.state === 'tense') {
        if (this.heat >= COMBAT_ENTER) {
          this.state = 'combat';
          changed = true;
        } else if (this.heat <= TENSE_EXIT) {
          this.state = 'calm';
          changed = true;
        }
      } else {
        if (this.heat >= COMBAT_ENTER) {
          this.state = 'combat';
          changed = true;
        } else if (this.heat >= TENSE_ENTER) {
          this.state = 'tense';
          changed = true;
        }
      }
    }
    return this.state;
  }
}
