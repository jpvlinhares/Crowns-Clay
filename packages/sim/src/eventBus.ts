/**
 * Intra-sim + outward event channel (Engine §0). Delivery is synchronous and in
 * subscription order — subscriptions happen only during setup, in fixed code
 * order, so delivery order is deterministic. Every event published during a
 * tick is also collected for the outward TickResult.
 */
import { invariant } from '@crowns/core';
import type { GameEvent } from '@crowns/protocol';

type Listener = (event: GameEvent<never>) => void;

export class EventBus {
  private readonly listeners = new Map<string, Listener[]>();
  private collecting: GameEvent[] | null = null;

  subscribe<TData>(type: string, listener: (event: GameEvent<TData>) => void): void {
    const list = this.listeners.get(type);
    if (list === undefined) this.listeners.set(type, [listener as Listener]);
    else list.push(listener as Listener);
  }

  publish<TData>(event: GameEvent<TData>): void {
    invariant(this.collecting !== null, 'EventBus.publish outside a tick');
    this.collecting.push(event as GameEvent);
    const list = this.listeners.get(event.type);
    if (list === undefined) return;
    for (const listener of list) listener(event as GameEvent<never>);
  }

  beginTick(): void {
    this.collecting = [];
  }

  endTick(): GameEvent[] {
    invariant(this.collecting !== null, 'EventBus.endTick without beginTick');
    const events = this.collecting;
    this.collecting = null;
    return events;
  }
}
