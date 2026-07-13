/**
 * UI Store (roadmap M18; doc 05 §7): the single main-thread mirror of what
 * the panels show — fed EXCLUSIVELY by snapshot deltas and GameEvents, never
 * by reaching into the sim. Pure TypeScript (no DOM): the panels subscribe
 * and re-render; commands go the other way through the Command Bus.
 */
import type { UICatalog } from '@crowns/protocol';

export interface VillageInfo {
  readonly id: number;
  readonly name: string;
  readonly population: number;
  readonly food: number;
  readonly happiness: number;
  readonly goods: Record<string, number>;
  readonly tier: number;
  readonly taxRate: number;
  readonly cx: number;
  readonly cy: number;
}

export interface KingdomInfo {
  readonly treasury: number;
  readonly taxes: number;
  readonly upkeep: number;
  readonly salaries: number;
  readonly net: number;
}

/** One itemized ledger entry (M42; GDD §2 "Read the Ledger: full income/expense breakdown"). */
export interface LedgerRow {
  readonly tick: number;
  readonly kind: string;
  readonly amount: number; // signed: income positive, expense negative
  readonly detail: string;
}

/** Newest-first scrollback cap — same bound NotificationQueue's LOG_CAP already uses. */
export const LEDGER_LOG_CAP = 100;

export interface UIState {
  villages: Map<number, VillageInfo>;
  kingdom: KingdomInfo | null;
  activeEdicts: Set<string>;
  catalog: UICatalog | null;
  /** building def armed for placement (build palette), or null */
  armedBuild: string | null;
  /** selected village (panel focus), or null */
  selectedVillage: number | null;
  /** newest-last itemized ledger scrollback, capped at LEDGER_LOG_CAP (M42) */
  ledger: LedgerRow[];
}

export type StoreListener = (state: UIState) => void;

export class UIStore {
  readonly state: UIState = {
    villages: new Map(),
    kingdom: null,
    activeEdicts: new Set(),
    catalog: null,
    armedBuild: null,
    selectedVillage: null,
    ledger: [],
  };

  private readonly listeners: StoreListener[] = [];

  subscribe(listener: StoreListener): void {
    this.listeners.push(listener);
  }

  private emit(): void {
    for (const l of this.listeners) l(this.state);
  }

  /** Full snapshot bootstrap (init or a loaded save): reset volatile slices. */
  applyFull(catalog: UICatalog | undefined, kingdom: { activeEdicts: string[] } | undefined): void {
    if (catalog !== undefined) this.state.catalog = catalog;
    this.state.villages.clear();
    this.state.kingdom = null;
    this.state.activeEdicts = new Set(kingdom?.activeEdicts ?? []);
    this.state.armedBuild = null;
    this.state.selectedVillage = null;
    this.state.ledger = [];
    this.emit();
  }

  applyVillageStats(stats: readonly VillageInfo[]): void {
    if (stats.length === 0) return;
    for (const s of stats) this.state.villages.set(s.id, s);
    if (this.state.selectedVillage === null && this.state.villages.size > 0) {
      this.state.selectedVillage = [...this.state.villages.keys()].sort((a, b) => a - b)[0] as number;
    }
    this.emit();
  }

  applyRollup(kingdom: KingdomInfo): void {
    this.state.kingdom = kingdom;
    this.emit();
  }

  appendLedger(entries: readonly LedgerRow[]): void {
    if (entries.length === 0) return;
    this.state.ledger.push(...entries);
    if (this.state.ledger.length > LEDGER_LOG_CAP) {
      this.state.ledger.splice(0, this.state.ledger.length - LEDGER_LOG_CAP);
    }
    this.emit();
  }

  applyEdictChange(edict: string, active: boolean): void {
    if (active) this.state.activeEdicts.add(edict);
    else this.state.activeEdicts.delete(edict);
    this.emit();
  }

  armBuild(defId: string | null): void {
    this.state.armedBuild = defId;
    this.emit();
  }

  selectVillage(id: number | null): void {
    this.state.selectedVillage = id;
    this.emit();
  }

  selectedVillage(): VillageInfo | null {
    if (this.state.selectedVillage === null) return null;
    return this.state.villages.get(this.state.selectedVillage) ?? null;
  }

  /** Village whose centre is nearest to a tile (Chebyshev) — placement target. */
  villageNear(x: number, y: number): VillageInfo | null {
    let best: VillageInfo | null = null;
    let bestDistance = Infinity;
    for (const v of [...this.state.villages.values()].sort((a, b) => a.id - b.id)) {
      const d = Math.max(Math.abs(v.cx - x), Math.abs(v.cy - y));
      if (d < bestDistance) {
        bestDistance = d;
        best = v;
      }
    }
    return best;
  }
}
