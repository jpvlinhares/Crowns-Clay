/**
 * Command types — the ONLY write path into the simulation (TDD §4).
 * Player UI, AI kingdoms, content-event effects, the sandbox editor, and replays
 * all speak this shape; the kernel treats every issuer identically.
 */

/** 0 is reserved for the system/sandbox issuer; kingdoms are 1..n (player included). */
export type IssuerId = number;
export const SYSTEM_ISSUER: IssuerId = 0;

export interface Command<TPayload = unknown> {
  /** Namespaced command type, e.g. 'army.move', 'village.build'. */
  readonly type: string;
  /** Tick on which the command executes (stamped by the kernel on submit). */
  readonly tick: number;
  readonly issuer: IssuerId;
  /** Per-issuer monotonic sequence number — the determinism tiebreaker. */
  readonly seq: number;
  readonly payload: TPayload;
}

/** Draft submitted from outside the sim; the kernel stamps tick and seq. */
export interface CommandDraft<TPayload = unknown> {
  readonly type: string;
  readonly issuer: IssuerId;
  readonly payload: TPayload;
}

/**
 * Total deterministic ordering: (tick, issuer, seq) — TDD §5 rule 4.
 * Within one tick, lower issuer ids act first, then per-issuer submission order.
 */
export function compareCommands(a: Command, b: Command): number {
  return a.tick - b.tick || a.issuer - b.issuer || a.seq - b.seq;
}
