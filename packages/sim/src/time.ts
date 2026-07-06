/**
 * Time constants and the Calendar system (doc 08 §1; pipeline slot 2 in §2).
 * 1 tick = 1 in-game hour. The calendar is derived state (pure function of the
 * tick) and therefore contributes nothing to the state hash.
 */
import type { SimSystem, TickContext } from './kernel.js';

export const TICKS_PER_DAY = 24;
export const DAYS_PER_SEASON = 90;
export const SEASONS_PER_YEAR = 4;
export const TICKS_PER_SEASON = TICKS_PER_DAY * DAYS_PER_SEASON; // 2,160
export const TICKS_PER_YEAR = TICKS_PER_SEASON * SEASONS_PER_YEAR; // 8,640

export const SEASON_NAMES = ['spring', 'summer', 'autumn', 'winter'] as const;
export type SeasonName = (typeof SEASON_NAMES)[number];

export interface CalendarDate {
  readonly year: number;
  readonly season: number; // 0..3
  readonly seasonName: SeasonName;
  readonly day: number; // 0..89 within season
  readonly hour: number; // 0..23
}

/** Tick 1 is hour 0 of day 0 of spring, year 0. */
export function calendarFromTick(tick: number): CalendarDate {
  const t = Math.max(0, tick - 1);
  const hour = t % TICKS_PER_DAY;
  const absoluteDay = Math.floor(t / TICKS_PER_DAY);
  const day = absoluteDay % DAYS_PER_SEASON;
  const absoluteSeason = Math.floor(absoluteDay / DAYS_PER_SEASON);
  const season = absoluteSeason % SEASONS_PER_YEAR;
  const year = Math.floor(absoluteSeason / SEASONS_PER_YEAR);
  return { year, season, seasonName: SEASON_NAMES[season] as SeasonName, day, hour };
}

export interface DayStartedData { readonly date: CalendarDate; }
export interface SeasonStartedData { readonly date: CalendarDate; }
export interface YearStartedData { readonly date: CalendarDate; }

/** Publishes time.dayStarted / time.seasonStarted / time.yearStarted at boundaries. */
export class CalendarSystem implements SimSystem {
  readonly name = 'calendar';
  readonly period = 1;

  update(ctx: TickContext): void {
    if ((ctx.tick - 1) % TICKS_PER_DAY !== 0) return;
    const date = calendarFromTick(ctx.tick);
    ctx.events.publish({ type: 'time.dayStarted', tick: ctx.tick, data: { date } });
    if (date.day === 0) {
      ctx.events.publish({ type: 'time.seasonStarted', tick: ctx.tick, data: { date } });
      if (date.season === 0) {
        ctx.events.publish({ type: 'time.yearStarted', tick: ctx.tick, data: { date } });
      }
    }
  }
}
