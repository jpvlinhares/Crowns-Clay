/**
 * Notification queue (roadmap M18; GDD §1): "reports and events surface
 * simulation changes back to the player through a notification queue with
 * severity tiers (info / attention / urgent-pause)".
 *
 * Pure logic, no DOM: GameEvents map through a data-defined rule table to
 * notifications; repeats throttle per (type, subject) so a famine nags daily
 * instead of hourly (GDD §1 "notification fatigue vs. missed crises"); an
 * urgent notification raises a pause request the host consumes once.
 */
import type { GameEvent } from '@crowns/protocol';

export type Severity = 'info' | 'attention' | 'urgent';

export interface Notification {
  readonly id: number;
  readonly tick: number;
  readonly severity: Severity;
  readonly text: string;
}

interface Rule {
  readonly severity: Severity;
  readonly text: (data: Record<string, unknown>) => string;
  /** distinct subjects throttle independently (e.g. per village) */
  readonly subject?: (data: Record<string, unknown>) => string;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : String(v ?? '?'));
const shortId = (id: unknown): string => (typeof id === 'string' ? (id.split('.').pop() ?? id) : str(id));

/** Event → notification rules (data-defined; grows with the event roster). */
export const NOTIFICATION_RULES: Readonly<Record<string, Rule>> = {
  'village.starving': {
    severity: 'urgent',
    text: () => 'A village is STARVING — build farms or clear the roads',
    subject: (d) => str(d['village']),
  },
  'village.rejected': {
    severity: 'attention',
    text: (d) => `Order refused — ${str(d['what'])}: ${str(d['reason'])}`,
    subject: (d) => str(d['what']),
  },
  'kingdom.edictLapsed': {
    severity: 'attention',
    text: (d) => `Edict lapsed (treasury empty): ${shortId(d['edict'])}`,
  },
  'character.died': {
    severity: 'attention',
    text: (d) => `${str(d['name'])} has died, aged ${Math.floor(Number(d['age'] ?? 0))}`,
  },
  'kingdom.officeVacated': {
    severity: 'attention',
    text: (d) => `The ${str(d['office'])}'s seat stands empty`,
  },
  'settlers.turnedBack': {
    severity: 'attention',
    text: (d) => `Settlers turned back: ${str(d['reason'])}`,
  },
  'village.founded': {
    severity: 'info',
    text: (d) => `${str(d['name'])} founded`,
  },
  'settlers.dispatched': {
    severity: 'info',
    text: (d) => `Settlers set out for ${str(d['name'])}`,
  },
  'settlers.returned': {
    severity: 'info',
    text: () => 'The settler party is home again',
  },
  'village.upgraded': {
    severity: 'info',
    text: (d) => `A village rose to tier ${str(d['tier'])}`,
  },
  'building.demolished': {
    severity: 'info',
    text: (d) => `Razed the ${shortId(d['def'])}`,
    subject: (d) => str(d['building']),
  },
  'kingdom.edictEnacted': {
    severity: 'info',
    text: (d) => `Edict enacted: ${shortId(d['edict'])}`,
  },
  'kingdom.edictRepealed': {
    severity: 'info',
    text: (d) => `Edict repealed: ${shortId(d['edict'])}`,
  },
  // ---- modding (M39; OQ-4): save↔installed mod-set reconciliation ----
  'mods.reconciled': {
    severity: 'attention',
    text: (d) => str(d['summary']),
  },
  // ---- storage quota (roadmap M44; doc 11 §3/§4; Risk R6) ----
  'storage.quotaTight': {
    severity: 'attention',
    text: (d) => str(d['summary']),
  },
};

export const VISIBLE_CAP = 6; // toasts on screen
export const LOG_CAP = 50; // scrollback
const REPEAT_THROTTLE_TICKS = 24 * 5; // same (type, subject) at most every 5 days

export class NotificationQueue {
  private readonly log: Notification[] = [];
  private readonly lastShown = new Map<string, number>();
  private readonly dismissed = new Set<number>(); // ids hidden from the toast view by the player
  private nextId = 1;
  private pauseRequested = false;

  /** Feed every GameEvent through; returns the notification if one surfaced. */
  push(event: GameEvent): Notification | undefined {
    const rule = NOTIFICATION_RULES[event.type];
    if (rule === undefined) return undefined;
    const data = (event.data ?? {}) as Record<string, unknown>;
    const key = `${event.type}|${rule.subject?.(data) ?? ''}`;
    const last = this.lastShown.get(key);
    if (last !== undefined && event.tick - last < REPEAT_THROTTLE_TICKS) return undefined;
    this.lastShown.set(key, event.tick);
    const notification: Notification = {
      id: this.nextId++,
      tick: event.tick,
      severity: rule.severity,
      text: rule.text(data),
    };
    this.log.push(notification);
    if (this.log.length > LOG_CAP) {
      const removed = this.log.splice(0, this.log.length - LOG_CAP);
      for (const n of removed) this.dismissed.delete(n.id); // don't leak ids for rolled-off entries
    }
    if (rule.severity === 'urgent') this.pauseRequested = true;
    return notification;
  }

  /** Player manually dismissed a toast (× button): hide it from `visible()`. The scrollback
   * log (`all()`) keeps it — dismissing clears the on-screen toast, not the history. */
  dismiss(id: number): void {
    this.dismissed.add(id);
  }

  /** Newest-first toasts, capped for the screen; player-dismissed ones excluded. */
  visible(): readonly Notification[] {
    return this.log.filter((n) => !this.dismissed.has(n.id)).slice(-VISIBLE_CAP).reverse();
  }

  /** Full scrollback, newest first. */
  all(): readonly Notification[] {
    return [...this.log].reverse();
  }

  /** One-shot: did an urgent notification ask the host to pause? */
  takePauseRequest(): boolean {
    const requested = this.pauseRequested;
    this.pauseRequested = false;
    return requested;
  }
}
