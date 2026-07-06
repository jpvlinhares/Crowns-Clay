/**
 * Simulation kernel (TDD §1, §4–§6; Engine §2).
 *
 * The kernel is headless and host-agnostic: it never touches DOM, wall-clock,
 * or Math.random. One call to `step()` executes exactly one tick:
 *
 *   drain due commands (sorted by tick, issuer, seq) → dispatch to handlers
 *   → run system pipeline in registration order (cadence-gated, doc 08 §2)
 *   → return the tick's events.
 *
 * Determinism: state' = tick(state, commands). Same seed + same command log
 * ⇒ identical `stateHash()` at every tick (verified in kernel.test.ts and,
 * from M5, by cross-engine golden replays).
 */

import { Rng, hashCombine, invariant } from '@crowns/core';
import {
  compareCommands,
  SYSTEM_ISSUER,
  type Command,
  type CommandDraft,
  type GameEvent,
  type IssuerId,
} from '@crowns/protocol';
import { EventBus } from './eventBus.js';

export interface TickContext {
  readonly tick: number;
  /** Publish-only view of the event bus for this tick. */
  readonly events: Pick<EventBus, 'publish'>;
  /** This system's (or handler's) private deterministic stream. */
  readonly rng: Rng;
}

export interface SimSystem {
  /** Unique name; also the PRNG fork key (`system:<name>`). */
  readonly name: string;
  /** Cadence in ticks: 1 = every tick, 24 = daily, ... (doc 08 §2). */
  readonly period: number;
  /** Stagger offset within the period (doc 08 phase staggering). */
  readonly phase?: number;
  /**
   * Declared component access (Engine §2). When both a guard is attached and a
   * system declares access, the kernel opens an enforcement scope around
   * update(): undeclared reads/writes throw. Systems without a declaration run
   * unscoped (tightened once all systems migrate).
   */
  readonly access?: GuardedAccess;
  update(ctx: TickContext): void;
  /** Optional determinism contribution: fold this system's state into the hash. */
  hash?(fold: (value: number) => void): void;
}

/** Shape-only view of ecs.SystemAccess — keeps kernel decoupled from the store. */
export interface GuardedAccess {
  readonly reads?: readonly { readonly cid: number; readonly name: string }[];
  readonly writes?: readonly { readonly cid: number; readonly name: string }[];
}

/** Implemented by ecs.World; the kernel brackets each declared system with it. */
export interface AccessGuard {
  enter(label: string, access: GuardedAccess): void;
  exit(): void;
}

export type CommandHandler<TPayload = unknown> = (
  ctx: TickContext,
  payload: TPayload,
  command: Command<TPayload>,
) => void;

export interface TickResult {
  readonly tick: number;
  readonly events: readonly GameEvent[];
  readonly executed: readonly Command[];
}

export interface SystemTelemetry {
  readonly name: string;
  readonly lastMs: number;
  readonly avgMs: number; // exponential moving average over executed runs
  readonly calls: number;
}

export interface KernelOptions {
  /**
   * Observational clock for per-system cost telemetry (TDD §10). INJECTED so
   * the sim package never reads wall time itself: timings are measured around
   * system updates but can never feed back into state — stateHash() is
   * clock-blind by construction (telemetry.test.ts proves it). No clock →
   * zero measurement overhead.
   */
  readonly clock?: () => number;
}

interface RegisteredSystem {
  readonly system: SimSystem;
  readonly rng: Rng;
}

export class Kernel {
  private readonly rootRng: Rng;
  private readonly commandRng: Rng;
  private readonly systems: RegisteredSystem[] = [];
  private readonly handlers = new Map<string, CommandHandler<never>>();
  private readonly bus = new EventBus();

  /** Commands awaiting their execution tick, kept sorted lazily at drain. */
  private pending: Command[] = [];
  /** Append-only log of executed commands (save/replay substrate, TDD §5 rule 5). */
  private readonly log: Command[] = [];
  private readonly nextSeqByIssuer = new Map<IssuerId, number>();

  private tick = 0;
  private sealed = false;
  private guard: AccessGuard | null = null;
  private readonly hashSources: { name: string; contribute: (fold: (v: number) => void) => void }[] = [];

  private readonly clock: (() => number) | null;
  private readonly telemetry = new Map<string, { lastMs: number; avgMs: number; calls: number }>();
  private lastTickMs = 0;
  private avgTickMs = 0;

  constructor(
    public readonly seed: number,
    options: KernelOptions = {},
  ) {
    this.rootRng = Rng.fromSeed(seed);
    this.commandRng = this.rootRng.fork('commands');
    this.clock = options.clock ?? null;
  }

  get currentTick(): number {
    return this.tick;
  }

  // ---------- setup (before first step) ----------

  registerSystem(system: SimSystem): void {
    invariant(!this.sealed, `registerSystem(${system.name}) after first tick`);
    invariant(system.period >= 1, `system ${system.name}: period must be >= 1`);
    invariant(
      !this.systems.some((r) => r.system.name === system.name),
      `duplicate system name '${system.name}'`,
    );
    this.systems.push({ system, rng: this.rootRng.fork(`system:${system.name}`) });
  }

  /**
   * Register an additional state-hash contributor (e.g. the ecs World), folded
   * after system contributions in registration order. Determinism harness (M5).
   */
  addHashSource(name: string, contribute: (fold: (v: number) => void) => void): void {
    invariant(!this.sealed, `addHashSource(${name}) after first tick`);
    invariant(!this.hashSources.some((s) => s.name === name), `duplicate hash source '${name}'`);
    this.hashSources.push({ name, contribute });
  }

  /** Attach the declared-access enforcer (typically the ecs World). */
  attachGuard(guard: AccessGuard): void {
    invariant(!this.sealed, 'attachGuard after first tick');
    this.guard = guard;
  }

  registerCommand<TPayload>(type: string, handler: CommandHandler<TPayload>): void {
    invariant(!this.sealed, `registerCommand(${type}) after first tick`);
    invariant(!this.handlers.has(type), `duplicate command handler '${type}'`);
    this.handlers.set(type, handler as CommandHandler<never>);
  }

  subscribe<TData>(type: string, listener: (event: GameEvent<TData>) => void): void {
    this.bus.subscribe(type, listener);
  }

  // ---------- command intake ----------

  /**
   * External intake: stamps the draft for the NEXT tick with the issuer's next
   * sequence number. This is what UI/AI/editor use.
   */
  submit<TPayload>(draft: CommandDraft<TPayload>): Command<TPayload> {
    const seq = this.nextSeqByIssuer.get(draft.issuer) ?? 0;
    this.nextSeqByIssuer.set(draft.issuer, seq + 1);
    const command: Command<TPayload> = {
      type: draft.type,
      issuer: draft.issuer,
      payload: draft.payload,
      tick: this.tick + 1,
      seq,
    };
    this.pending.push(command as Command);
    return command;
  }

  /**
   * Exact intake for replays: the command already carries (tick, issuer, seq).
   * Rejects commands scheduled at or before the current tick.
   */
  enqueueExact(command: Command): void {
    invariant(
      command.tick > this.tick,
      `enqueueExact: tick ${command.tick} not after current ${this.tick}`,
    );
    this.pending.push(command);
    const seq = this.nextSeqByIssuer.get(command.issuer) ?? 0;
    if (command.seq >= seq) this.nextSeqByIssuer.set(command.issuer, command.seq + 1);
  }

  /** Executed-command log (immutable view). */
  commandLog(): readonly Command[] {
    return this.log;
  }

  /** Registered command types (the injector's vocabulary), sorted. */
  commandTypes(): string[] {
    return Array.from(this.handlers.keys()).sort();
  }

  /** Per-system cost telemetry in registration order (+ 'commands' pseudo-row). */
  getTelemetry(): { tickMsLast: number; tickMsAvg: number; systems: SystemTelemetry[] } {
    const systems: SystemTelemetry[] = [];
    const row = (name: string): void => {
      const t = this.telemetry.get(name);
      systems.push(t === undefined ? { name, lastMs: 0, avgMs: 0, calls: 0 } : { name, ...t });
    };
    row('commands');
    for (const { system } of this.systems) row(system.name);
    return { tickMsLast: this.lastTickMs, tickMsAvg: this.avgTickMs, systems };
  }

  private record(name: string, ms: number): void {
    const t = this.telemetry.get(name);
    if (t === undefined) this.telemetry.set(name, { lastMs: ms, avgMs: ms, calls: 1 });
    else {
      t.lastMs = ms;
      t.avgMs = t.avgMs * 0.95 + ms * 0.05;
      t.calls++;
    }
  }

  // ---------- the tick ----------

  step(): TickResult {
    this.sealed = true;
    this.tick += 1;
    this.bus.beginTick();
    const tickStart = this.clock?.() ?? 0;

    // 1) Drain commands due this tick in total deterministic order (TDD §5 rule 4).
    const due: Command[] = [];
    const later: Command[] = [];
    for (const c of this.pending) (c.tick <= this.tick ? due : later).push(c);
    this.pending = later;
    due.sort(compareCommands);

    const executed: Command[] = [];
    const cmdStart = this.clock?.() ?? 0;
    for (const command of due) {
      const handler = this.handlers.get(command.type);
      if (handler === undefined) {
        this.bus.publish({
          type: 'command.rejected',
          tick: this.tick,
          data: { command, reason: `unknown command type '${command.type}'` },
        });
        continue;
      }
      const ctx: TickContext = { tick: this.tick, events: this.bus, rng: this.commandRng };
      handler(ctx, command.payload as never, command as Command<never>);
      this.log.push(command);
      executed.push(command);
    }

    if (this.clock !== null && due.length > 0) this.record('commands', this.clock() - cmdStart);

    // 2) System pipeline in registration order, cadence-gated (doc 08 §2).
    for (const { system, rng } of this.systems) {
      const phase = system.phase ?? 0;
      if (this.tick % system.period !== phase % system.period) continue;
      const ctx: TickContext = { tick: this.tick, events: this.bus, rng };
      const t0 = this.clock?.() ?? 0;
      if (this.guard !== null && system.access !== undefined) {
        this.guard.enter(system.name, system.access);
        try {
          system.update(ctx);
        } finally {
          this.guard.exit();
        }
      } else {
        system.update(ctx);
      }
      if (this.clock !== null) this.record(system.name, this.clock() - t0);
    }

    if (this.clock !== null) {
      this.lastTickMs = this.clock() - tickStart;
      this.avgTickMs = this.avgTickMs * 0.95 + this.lastTickMs * 0.05;
    }
    return { tick: this.tick, events: this.bus.endTick(), executed };
  }

  // ---------- determinism ----------

  /** Order-sensitive fold of tick, RNG streams, and every system's declared state. */
  stateHash(): number {
    let h = 0x9dc5c0de;
    const fold = (v: number): void => {
      h = hashCombine(h, v);
    };
    fold(this.tick);
    const rs = this.rootRng.state();
    fold(rs.s0); fold(rs.s1); fold(rs.s2); fold(rs.s3);
    const cs = this.commandRng.state();
    fold(cs.s0); fold(cs.s1); fold(cs.s2); fold(cs.s3);
    fold(this.log.length);
    for (const { system } of this.systems) system.hash?.(fold);
    for (const source of this.hashSources) source.contribute(fold);
    return h >>> 0;
  }
}

export { SYSTEM_ISSUER };
