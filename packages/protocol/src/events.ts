/**
 * GameEvents — the outward/broadcast channel (Engine §0). Sim systems publish;
 * other sim systems, AI sensors, UI, and audio subscribe. Events describe what
 * happened; they never mutate state themselves.
 */
export interface GameEvent<TData = unknown> {
  readonly type: string; // namespaced, e.g. 'time.seasonStarted', 'command.rejected'
  readonly tick: number;
  readonly data: TData;
}
