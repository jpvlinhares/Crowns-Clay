/**
 * Tick driver (TDD §6): fixed timestep with accumulator, speed multipliers, and
 * time DILATION under load — when the per-advance tick budget is exhausted,
 * leftover accumulated time is discarded, so the sim slows down rather than
 * changing tick content. Determinism is untouched by host speed.
 */
import { invariant } from '@crowns/core';
import type { Kernel, TickResult } from './kernel.js';
import { TICKS_PER_DAY } from './time.js';

/**
 * Real-time length of one in-game DAY at normal speed (speed 1), in seconds. This is the
 * single pace knob: production and growth are expressed PER GAME-DAY (recipe `perDay` rates
 * divided across `TICKS_PER_DAY`; cohort births/deaths run once per game-day), so stretching
 * the day stretches all of them proportionally — no per-building retuning, and tick CONTENT
 * (hence determinism) is untouched. Higher = slower felt pace. Config value.
 */
export const REAL_SECONDS_PER_DAY = 24;
/** Ticks executed per real second at normal speed — derived so day-length is the only knob. */
export const BASE_TICKS_PER_SECOND = TICKS_PER_DAY / REAL_SECONDS_PER_DAY;
export type Speed = 0 | 1 | 2 | 4 | 8;

export interface DriverOptions {
  /** Hard cap on ticks executed per advance() call — the dilation budget. */
  readonly maxTicksPerAdvance?: number;
}

export class TickDriver {
  private accumulatorMs = 0;
  private currentSpeed: Speed = 1;
  private readonly maxTicksPerAdvance: number;

  constructor(
    private readonly kernel: Kernel,
    options: DriverOptions = {},
  ) {
    this.maxTicksPerAdvance = options.maxTicksPerAdvance ?? 16;
    invariant(this.maxTicksPerAdvance >= 1, 'maxTicksPerAdvance must be >= 1');
  }

  get speed(): Speed {
    return this.currentSpeed;
  }

  setSpeed(speed: Speed): void {
    this.currentSpeed = speed;
    if (speed === 0) this.accumulatorMs = 0; // pausing clears pending time
  }

  /** Advance by real elapsed milliseconds; returns the ticks executed. */
  advance(realDtMs: number): TickResult[] {
    invariant(realDtMs >= 0, 'advance: negative dt');
    if (this.currentSpeed === 0) return [];
    const tickDtMs = 1000 / (BASE_TICKS_PER_SECOND * this.currentSpeed);
    this.accumulatorMs += realDtMs;

    const results: TickResult[] = [];
    while (this.accumulatorMs >= tickDtMs && results.length < this.maxTicksPerAdvance) {
      results.push(this.kernel.step());
      this.accumulatorMs -= tickDtMs;
    }
    // Dilation: budget hit with time still owed → drop it (slow down, never spiral).
    if (this.accumulatorMs >= tickDtMs) this.accumulatorMs = 0;
    return results;
  }
}
