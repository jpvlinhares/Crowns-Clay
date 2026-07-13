/**
 * Events engine (roadmap M33; GDD Appendix A; doc 06 §11; doc 08 §10;
 * doc 09 §4). Daily, `opportunity`/`character`/`diplomatic`/`unrest`/`era`/
 * `tutorial` (M43 — additive vocabulary, same engine, doc 09 §8) pools are
 * evaluated per kingdom; weekly, `disaster` alone (doc 08 §10's exact split). Each event's `weight` is a per-evaluation FIRE PROBABILITY
 * (`weight * BASE_EVENT_RATE`, small on purpose — a weight of 3 is a few
 * times a season, not a few times a day), scaled by `weightModifiers` and the
 * PACING GOVERNOR (`pacingMultiplier`, the "pacing governor bands" T
 * objective): under-band seasons get boosted, over-band seasons get
 * dampened, keeping event pressure inside a target range without ever
 * picking WHICH event fires (GDD App. A: "never the puppeteer"). Independent
 * per-candidate rolls can pass together; `pool-events` then only lets ONE
 * actually fire per pool per evaluation (doc 08 §10's "max-1-fire").
 *
 * `evaluatePredicate`/`applyEffect` are pure-ish functions over an
 * `EventContext` (the roadmap's "DSL fuzzing" T objective targets these
 * directly) — unrecognized or malformed shapes fail CLOSED (predicates
 * false, effects no-op) rather than throwing, so a fuzzer can never crash
 * the resolver, only prove it's inert on garbage input.
 *
 * A representative village stands in for a kingdom's "village.*" stats (the
 * lowest dense-index village it owns, or the first village that exists at
 * all in a single-kingdom composition) — a real multi-village aggregate is
 * future work, same v1-slice spirit as every other milestone's simplifying
 * cut. `scope` (kingdom/village/world) is metadata only this milestone; every
 * event resolves against its kingdom's representative village regardless.
 */
import { Interner, type EntityId, type Rng } from '@crowns/core';
import type { DefinitionDatabase, EventDef, EventPool, StatPath } from '@crowns/data';
import { EVENT_POOLS } from '@crowns/data';
import type { World } from '../ecs.js';
import type { Kernel, SimSystem, TickContext } from '../kernel.js';
import { TICKS_PER_DAY, TICKS_PER_SEASON, calendarFromTick } from '../time.js';
import type { VillageGameplay } from './villages.js';
import type { PopulationGameplay } from './population.js';
import type { KingdomGameplay } from './kingdom.js';

const index = (id: number): number => id & 0x3fffff;
const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

// ---------------------------------------------------------------- constants

const DAILY_POOLS: readonly EventPool[] = ['opportunity', 'character', 'diplomatic', 'unrest', 'era', 'tutorial'];
const WEEKLY_POOLS: readonly EventPool[] = ['disaster'];
const TICKS_PER_WEEK = TICKS_PER_DAY * 7;

// Every pool must be scheduled somewhere (doc 08 §10) — a forgotten pool would silently never
// fire; this fails loudly at import time instead (mirrors TERRAIN_BIOME_CODES's cross-check).
if (DAILY_POOLS.length + WEEKLY_POOLS.length !== EVENT_POOLS.length) {
  throw new Error('game/events.ts: DAILY_POOLS + WEEKLY_POOLS must cover every EVENT_POOLS entry exactly once');
}

/** Weight 1 -> ~1%/day (daily pools) or ~1%/week (weekly pools) before modifiers/governor. */
export const BASE_DAILY_RATE = 0.01;
export const BASE_WEEKLY_RATE = 0.03;

/** Target events/kingdom/season band the pacing governor holds pressure inside (GDD App. A). */
export const PACING_TARGET_MIN = 1;
export const PACING_TARGET_MAX = 5;
const BOOST_MULTIPLIER = 2.5;
const DAMPEN_MULTIPLIER = 0.15;

/** Pure — the pacing governor's whole policy: boost while under-band, dampen once at/over it,
 * else leave weights alone. Exported directly for unit testing (the T objective). */
export function pacingMultiplier(firedThisSeason: number, min = PACING_TARGET_MIN, max = PACING_TARGET_MAX): number {
  if (firedThisSeason < min) return BOOST_MULTIPLIER;
  if (firedThisSeason >= max) return DAMPEN_MULTIPLIER;
  return 1;
}

// ---------------------------------------------------------------- predicate/effect evaluation

export interface EventContext {
  statOf(stat: StatPath): number | undefined;
  season(): string;
  hasEdict(id: string): boolean;
  hasTech(id: string): boolean;
  chance(threshold: number): boolean;
}

/** Pure function of (expr, ctx) — never throws, fails closed on anything malformed (the "DSL
 * fuzzing" T objective's core safety property). */
export function evaluatePredicate(expr: unknown, ctx: EventContext): boolean {
  if (typeof expr !== 'object' || expr === null) return false;
  const e = expr as Record<string, unknown>;
  if (Array.isArray(e['all'])) return (e['all'] as unknown[]).every((child) => evaluatePredicate(child, ctx));
  if (Array.isArray(e['any'])) return (e['any'] as unknown[]).some((child) => evaluatePredicate(child, ctx));
  if ('not' in e) return !evaluatePredicate(e['not'], ctx);
  if (typeof e['season'] === 'string') return ctx.season() === e['season'];
  if (typeof e['hasEdict'] === 'string') return ctx.hasEdict(e['hasEdict']);
  if (typeof e['hasTech'] === 'string') return ctx.hasTech(e['hasTech']);
  if (typeof e['chance'] === 'number') return ctx.chance(e['chance']);
  if (typeof e['stat'] === 'string') {
    const value = ctx.statOf(e['stat'] as StatPath);
    if (value === undefined) return false;
    if (typeof e['lt'] === 'number') return value < e['lt'];
    if (typeof e['lte'] === 'number') return value <= e['lte'];
    if (typeof e['gt'] === 'number') return value > e['gt'];
    if (typeof e['gte'] === 'number') return value >= e['gte'];
    if (typeof e['eq'] === 'number') return value === e['eq'];
    return false;
  }
  return false;
}

export interface EventEffectContext {
  grantResource(resource: string, amount: number): void;
  removeResource(resource: string, amount: number): void;
  nudgeStat(stat: StatPath, op: 'add' | 'mul', value: number): void;
  applyOpinionDelta(delta: number): void;
  submitCommand(type: string, payload: Readonly<Record<string, unknown>>): void;
}

/** Applies one effect through `ctx` — malformed/unrecognized shapes are a silent no-op, same
 * fail-closed guarantee as `evaluatePredicate`. */
export function applyEffect(effect: unknown, ctx: EventEffectContext): void {
  if (typeof effect !== 'object' || effect === null) return;
  const e = effect as Record<string, unknown>;
  if (typeof e['grantResource'] === 'object' && e['grantResource'] !== null) {
    const g = e['grantResource'] as Record<string, unknown>;
    if (typeof g['resource'] === 'string' && typeof g['amount'] === 'number') ctx.grantResource(g['resource'], g['amount']);
    return;
  }
  if (typeof e['removeResource'] === 'object' && e['removeResource'] !== null) {
    const g = e['removeResource'] as Record<string, unknown>;
    if (typeof g['resource'] === 'string' && typeof g['amount'] === 'number') ctx.removeResource(g['resource'], g['amount']);
    return;
  }
  if (typeof e['modifier'] === 'object' && e['modifier'] !== null) {
    const m = e['modifier'] as Record<string, unknown>;
    if (typeof m['stat'] === 'string' && (m['op'] === 'add' || m['op'] === 'mul') && typeof m['value'] === 'number') {
      ctx.nudgeStat(m['stat'] as StatPath, m['op'], m['value']);
    }
    return;
  }
  if (typeof e['opinionChange'] === 'object' && e['opinionChange'] !== null) {
    const o = e['opinionChange'] as Record<string, unknown>;
    if (typeof o['delta'] === 'number') ctx.applyOpinionDelta(o['delta']);
    return;
  }
  if (typeof e['command'] === 'object' && e['command'] !== null) {
    const c = e['command'] as Record<string, unknown>;
    if (typeof c['type'] === 'string' && typeof c['payload'] === 'object' && c['payload'] !== null) {
      ctx.submitCommand(c['type'], c['payload'] as Record<string, unknown>);
    }
  }
}

// ---------------------------------------------------------------- state

interface PendingEvent {
  readonly eventCode: number;
  readonly firedTick: number;
}

/** Per-kingdom fired history (cooldowns, once-flags, season pressure) + pending (unanswered)
 * event instances — a plain relational class, same reasoning as `DiplomacyState`/`ResearchState`. */
export class EventState {
  private readonly lastFired = new Map<string, number>(); // `${kingdomId}:${eventCode}` -> tick
  private readonly onceFired = new Set<number>(); // eventCode (global — `once` is realm-wide)
  private readonly seasonCount = new Map<number, number>(); // kingdomId -> fires this season
  private readonly pending = new Map<number, PendingEvent[]>(); // kingdomId -> awaiting a choice

  private key(kingdomId: number, code: number): string {
    return `${kingdomId}:${code}`;
  }

  canFire(kingdomId: number, code: number, tick: number, cooldownTicks: number, once: boolean): boolean {
    if (once && this.onceFired.has(code)) return false;
    const last = this.lastFired.get(this.key(kingdomId, code));
    return last === undefined || tick - last >= cooldownTicks;
  }

  seasonFireCount(kingdomId: number): number {
    return this.seasonCount.get(kingdomId) ?? 0;
  }

  resetSeasonCounts(): void {
    this.seasonCount.clear();
  }

  markFired(kingdomId: number, code: number, tick: number, once: boolean): void {
    this.lastFired.set(this.key(kingdomId, code), tick);
    this.seasonCount.set(kingdomId, this.seasonFireCount(kingdomId) + 1);
    if (once) this.onceFired.add(code);
    const list = this.pending.get(kingdomId) ?? [];
    list.push({ eventCode: code, firedTick: tick });
    this.pending.set(kingdomId, list);
  }

  pendingOf(kingdomId: number): readonly PendingEvent[] {
    return this.pending.get(kingdomId) ?? [];
  }

  resolve(kingdomId: number, code: number): boolean {
    const list = this.pending.get(kingdomId);
    if (list === undefined) return false;
    const i = list.findIndex((p) => p.eventCode === code);
    if (i < 0) return false;
    list.splice(i, 1);
    return true;
  }

  /** Sorted-key fold — deterministic regardless of mutation order (stateHash requirement). */
  fold(fold: (v: number) => void): void {
    for (const key of [...this.lastFired.keys()].sort()) {
      const [kingdomId, code] = key.split(':');
      fold(Number(kingdomId));
      fold(Number(code));
      fold(this.lastFired.get(key) as number);
    }
    for (const code of [...this.onceFired].sort((a, b) => a - b)) fold(code);
    for (const kingdomId of [...this.seasonCount.keys()].sort((a, b) => a - b)) {
      fold(kingdomId);
      fold(this.seasonCount.get(kingdomId) as number);
    }
    for (const kingdomId of [...this.pending.keys()].sort((a, b) => a - b)) {
      fold(kingdomId);
      for (const p of this.pending.get(kingdomId) as PendingEvent[]) {
        fold(p.eventCode);
        fold(p.firedTick);
      }
    }
  }

  /** Plain-JSON-safe snapshot (roadmap M43 — the first composition to save/load this state). */
  save(): EventStateSave {
    return {
      lastFired: [...this.lastFired.entries()],
      onceFired: [...this.onceFired],
      seasonCount: [...this.seasonCount.entries()],
      pending: [...this.pending.entries()],
    };
  }

  restore(data: EventStateSave): void {
    this.lastFired.clear();
    for (const [key, tick] of data.lastFired) this.lastFired.set(key, tick);
    this.onceFired.clear();
    for (const code of data.onceFired) this.onceFired.add(code);
    this.seasonCount.clear();
    for (const [kingdomId, count] of data.seasonCount) this.seasonCount.set(kingdomId, count);
    this.pending.clear();
    for (const [kingdomId, list] of data.pending) this.pending.set(kingdomId, list);
  }
}

export interface EventStateSave {
  readonly lastFired: readonly (readonly [string, number])[];
  readonly onceFired: readonly number[];
  readonly seasonCount: readonly (readonly [number, number])[];
  readonly pending: readonly (readonly [number, PendingEvent[]])[];
}

// ---------------------------------------------------------------- registrar

export interface EventDiplomacyHook {
  /** Applies `delta` between `kingdomId` and every kingdom it's in contact with. */
  applyOpinionDelta(kingdomId: EntityId, delta: number): void;
}

export interface EventResearchHook {
  isKnown(kingdomId: EntityId, techId: string): boolean;
}

export interface EventGameplayOptions {
  /** Opinion-change effect hook (M23-style, optional) — no-op without one wired. */
  readonly diplomacy?: EventDiplomacyHook;
  /** `hasTech` predicate hook (M32-style, optional) — always false without one wired. */
  readonly research?: EventResearchHook;
  /** Issuer number for a kingdom index — the `command` effect's escape hatch and AI answers.
   * Defaults to `kingdomIndex + 1` (player=1, AI kingdoms 2..n, every other module's convention). */
  readonly issuerFor?: (kingdomIndex: number) => number;
}

export interface EventGameplay {
  readonly state: EventState;
  eventCode(id: string): number | undefined;
  eventById(code: number): EventDef;
  /** `{eventId, choices}` for every unanswered event instance this kingdom is holding. */
  pendingChoices(kingdomId: EntityId): readonly { readonly eventId: string; readonly choiceIds: readonly string[] }[];
}

export function registerEventGameplay(
  kernel: Kernel,
  world: World,
  db: DefinitionDatabase,
  game: VillageGameplay,
  popGame: PopulationGameplay,
  kingdomGame: KingdomGameplay,
  options: EventGameplayOptions = {},
): EventGameplay {
  const state = new EventState();
  kernel.addHashSource('events', (fold) => state.fold(fold));

  const interner = new Interner();
  const eventIds = [...db.events.keys()].sort();
  for (const id of eventIds) interner.intern(id);
  const eventCode = (id: string): number | undefined => interner.peek(id) as number | undefined;
  const eventById = (code: number): EventDef => db.events.get(eventIds[code] as string) as EventDef;

  const edictIds = [...db.edicts.keys()].sort();
  const edictCode = new Map(edictIds.map((id, i) => [id, i]));

  const issuerFor = options.issuerFor ?? ((k: number): number => k + 1);
  const reject = (ctx: TickContext, what: string, reason: string): void => {
    ctx.events.publish({ type: 'village.rejected', tick: ctx.tick, data: { what, reason } });
  };

  /** Lowest dense-index village owned by `kingdomId` (or the first village at all, single-
   * kingdom compositions where `VillageOwner` doesn't exist) — see module doc's v1 note. */
  const representativeVillage = (kingdomId: number): number | undefined => {
    const owner = kingdomGame.VillageOwner !== undefined ? world.read(kingdomGame.VillageOwner) : null;
    let best: number | undefined;
    world.query([game.comps.VillageCore]).forEach((vi) => {
      if (owner !== null && (owner.kingdom[vi] as number) !== kingdomId) return;
      if (best === undefined || vi < best) best = vi;
    });
    return best;
  };

  const contextFor = (kingdomId: number, vi: number | undefined, seasonName: string, rng: Rng): EventContext => ({
    statOf(stat: StatPath): number | undefined {
      if (stat === 'kingdom.treasury') return world.read(kingdomGame.Kingdom).treasury[index(kingdomId)] as number;
      if (vi === undefined) return undefined;
      if (stat === 'village.tier') return world.read(game.comps.VillageCore).tier[vi] as number;
      if (stat === 'village.happiness') return world.read(popGame.Population).happiness[vi] as number;
      if (stat === 'village.foodSecurity') return world.read(popGame.Population).foodSecurity[vi] as number;
      return undefined;
    },
    season: () => seasonName,
    hasEdict(id: string): boolean {
      const c = edictCode.get(id);
      if (c === undefined) return false;
      const active = world.readObj(kingdomGame.ActiveEdicts).tryGet(index(kingdomId));
      return active?.has(c) ?? false;
    },
    hasTech(id: string): boolean {
      return options.research?.isKnown(kingdomId as EntityId, id) ?? false;
    },
    chance(threshold: number): boolean {
      return rng.chance(threshold);
    },
  });

  const effectContextFor = (kingdomId: number, vi: number | undefined): EventEffectContext => ({
    grantResource(resource: string, amount: number): void {
      if (vi === undefined) return;
      const code = game.ops.resourceCode(resource);
      if (code === undefined) return;
      const stock = world.writeObj(game.comps.Stockpile).get(vi);
      stock.set(code, (stock.get(code) ?? 0) + Math.max(0, amount));
    },
    removeResource(resource: string, amount: number): void {
      if (vi === undefined) return;
      const code = game.ops.resourceCode(resource);
      if (code === undefined) return;
      const stock = world.writeObj(game.comps.Stockpile).get(vi);
      stock.set(code, Math.max(0, (stock.get(code) ?? 0) - Math.max(0, amount)));
    },
    nudgeStat(stat: StatPath, op: 'add' | 'mul', value: number): void {
      const ki = index(kingdomId);
      if (stat === 'kingdom.treasury') {
        const k = world.write(kingdomGame.Kingdom);
        k.treasury[ki] = op === 'add' ? (k.treasury[ki] as number) + value : (k.treasury[ki] as number) * value;
        return;
      }
      if (vi === undefined) return;
      if (stat === 'village.happiness') {
        const p = world.write(popGame.Population);
        const next = op === 'add' ? (p.happiness[vi] as number) + value : (p.happiness[vi] as number) * value;
        p.happiness[vi] = Math.max(0, Math.min(100, next));
        return;
      }
      if (stat === 'village.foodSecurity') {
        const p = world.write(popGame.Population);
        const next = op === 'add' ? (p.foodSecurity[vi] as number) + value : (p.foodSecurity[vi] as number) * value;
        p.foodSecurity[vi] = clamp01(next);
      }
      // village.tier is deliberately not nudgeable — the settler tier-upgrade path (settlers.ts)
      // is the one rulebook for that, same "one code path" principle as placement.
    },
    applyOpinionDelta(delta: number): void {
      options.diplomacy?.applyOpinionDelta(kingdomId as EntityId, delta);
    },
    submitCommand(type: string, payload: Readonly<Record<string, unknown>>): void {
      const kingdomIndex = kingdomGame.kingdomEntities().indexOf(kingdomId as EntityId);
      kernel.submit({ type, issuer: issuerFor(kingdomIndex < 0 ? 0 : kingdomIndex), payload });
    },
  });

  kernel.registerCommand<{ eventId: string; choiceId: string }>('event.choose', (ctx, p, command) => {
    const kingdomIndex = Math.max(0, Math.min(kingdomGame.kingdomEntities().length - 1, command.issuer - 1));
    const kingdomId = kingdomGame.kingdomEntities()[kingdomIndex];
    if (kingdomId === undefined) return reject(ctx, 'event.choose', 'no kingdom');
    const code = eventCode(String(p.eventId));
    if (code === undefined) return reject(ctx, 'event.choose', `unknown event '${String(p.eventId)}'`);
    const ki = kingdomId as number;
    if (!state.pendingOf(ki).some((pe) => pe.eventCode === code)) {
      return reject(ctx, 'event.choose', 'no such pending event for this kingdom');
    }
    const def = eventById(code);
    const choice = def.choices.find((c) => c.id === p.choiceId);
    if (choice === undefined) return reject(ctx, 'event.choose', `unknown choice '${String(p.choiceId)}'`);
    const vi = representativeVillage(ki);
    const calendar = calendarFromTick(ctx.tick);
    if (choice.requirements !== undefined) {
      const rng = ctx.rng.fork(`event-choose:${code}:${ki}:${ctx.tick}`);
      const evalCtx = contextFor(ki, vi, calendar.seasonName, rng);
      if (!evaluatePredicate(choice.requirements, evalCtx)) {
        return reject(ctx, 'event.choose', 'requirements not met');
      }
    }
    const effectCtx = effectContextFor(ki, vi);
    for (const effect of choice.effects) applyEffect(effect, effectCtx);
    state.resolve(ki, code);
    ctx.events.publish({ type: 'event.resolved', tick: ctx.tick, data: { kingdom: ki, eventId: def.id, choiceId: choice.id } });
  });

  // Season-boundary detection is self-contained (a pure function of `ctx.tick`) rather than
  // subscribing to time.ts's `time.seasonStarted` — that event only fires if the composition
  // also registers `CalendarSystem`, which this module has no way to require or verify; deriving
  // it from the tick directly (also naturally save/load-safe — no closure history to restore)
  // avoids that fragile cross-module registration-order dependency entirely.
  const isFirstDayOfSeason = (tick: number): boolean =>
    Math.floor(tick / TICKS_PER_SEASON) !== Math.floor((tick - TICKS_PER_DAY) / TICKS_PER_SEASON);

  const evaluatePools = (ctx: TickContext, pools: readonly EventPool[], baseRate: number): void => {
    const calendar = calendarFromTick(ctx.tick);
    for (const kingdomId of kingdomGame.kingdomEntities()) {
      const ki = kingdomId as number;
      const vi = representativeVillage(ki);
      const governorMultiplier = pacingMultiplier(state.seasonFireCount(ki));
      for (const pool of pools) {
        const candidates = eventIds
          .map((id) => eventCode(id) as number)
          .filter((code) => eventById(code).pool === pool)
          .filter((code) => {
            const def = eventById(code);
            const cooldownTicks = (def.cooldownDays ?? 0) * TICKS_PER_DAY;
            return state.canFire(ki, code, ctx.tick, cooldownTicks, def.once === true);
          });
        const passed: number[] = [];
        const passedWeights: number[] = [];
        for (const code of candidates) {
          const def = eventById(code);
          const rng = ctx.rng.fork(`event:${code}:${ki}:${ctx.tick}`);
          const evalCtx = contextFor(ki, vi, calendar.seasonName, rng);
          if (!evaluatePredicate(def.trigger, evalCtx)) continue;
          let weight = def.weight;
          for (const wm of def.weightModifiers ?? []) {
            if (evaluatePredicate(wm.condition, evalCtx)) weight *= wm.multiplier;
          }
          weight *= governorMultiplier;
          const roll = ctx.rng.fork(`event-roll:${code}:${ki}:${ctx.tick}`).chance(weight * baseRate);
          if (roll) {
            passed.push(code);
            passedWeights.push(weight);
          }
        }
        if (passed.length === 0) continue;
        const chosen =
          passed.length === 1 ? (passed[0] as number) : ctx.rng.fork(`event-pick:${pool}:${ki}:${ctx.tick}`).pickWeighted(passed, passedWeights);
        const def = eventById(chosen);
        state.markFired(ki, chosen, ctx.tick, def.once === true);
        ctx.events.publish({
          type: 'event.fired',
          tick: ctx.tick,
          data: { kingdom: ki, eventId: def.id, choiceIds: def.choices.map((c) => c.id) },
        });
      }
    }
  };

  const dailySystem: SimSystem = {
    name: 'events-daily',
    period: TICKS_PER_DAY,
    phase: 10,
    access: {
      reads: [game.comps.VillageCore, kingdomGame.ActiveEdicts, ...(kingdomGame.VillageOwner !== undefined ? [kingdomGame.VillageOwner] : [])],
      writes: [popGame.Population, kingdomGame.Kingdom, game.comps.Stockpile],
    },
    update(ctx: TickContext): void {
      if (isFirstDayOfSeason(ctx.tick)) state.resetSeasonCounts();
      evaluatePools(ctx, DAILY_POOLS, BASE_DAILY_RATE);
    },
  };
  kernel.registerSystem(dailySystem);

  const weeklySystem: SimSystem = {
    name: 'events-weekly',
    period: TICKS_PER_WEEK,
    phase: 3,
    access: {
      reads: [game.comps.VillageCore, kingdomGame.ActiveEdicts, ...(kingdomGame.VillageOwner !== undefined ? [kingdomGame.VillageOwner] : [])],
      writes: [popGame.Population, kingdomGame.Kingdom, game.comps.Stockpile],
    },
    update(ctx: TickContext): void {
      evaluatePools(ctx, WEEKLY_POOLS, BASE_WEEKLY_RATE);
    },
  };
  kernel.registerSystem(weeklySystem);

  return {
    state,
    eventCode,
    eventById,
    pendingChoices(kingdomId: EntityId): readonly { readonly eventId: string; readonly choiceIds: readonly string[] }[] {
      return state.pendingOf(kingdomId as number).map((p) => ({
        eventId: eventById(p.eventCode).id,
        choiceIds: eventById(p.eventCode).choices.map((c) => c.id),
      }));
    },
  };
}
