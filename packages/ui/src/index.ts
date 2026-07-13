/**
 * @crowns/ui — main-thread panel framework, UI store, and notifications
 * (roadmap M18; doc 05 §7). Speaks @crowns/protocol ONLY (TDD §3): state in
 * via snapshot deltas + GameEvents, orders out via command drafts.
 */
export { UIStore, LEDGER_LOG_CAP, type UIState, type VillageInfo, type KingdomInfo, type LedgerRow, type StoreListener } from './store.js';
export {
  NotificationQueue,
  NOTIFICATION_RULES,
  VISIBLE_CAP,
  LOG_CAP,
  type Notification,
  type Severity,
} from './notifications.js';
export { PanelHost, type Panel } from './panels.js';
export { TooltipController } from './tooltip.js';
