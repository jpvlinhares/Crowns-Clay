/**
 * Save/load v1 (roadmap M17; TDD §8).
 *
 *   World State ─► per-section codecs (schema-versioned) ─► CampaignSave
 *   Load: header check → per-section MigrationChain(v_old → … → v_now)
 *         → hydrate → afterLoad fixups (derived caches rebuild) → resume
 *
 * The manager is deliberately dumb about WHAT it saves: compositions register
 * sections (kernel, world, roads, …) and afterLoad hooks (occupancy rebuild,
 * kingdom re-binding). Loading happens into a FRESHLY COMPOSED session built
 * from the save's seed — registrars re-run the same code paths, so interners,
 * systems, and subscriptions are identical by construction; the save then
 * overwrites the dynamic state before the first tick. The T objective
 * (save → load → resave hash-identical) is enforced in persistence.test.ts
 * and the committed corpus (fixtures/saves/, TDD §13 "save corpus" row).
 *
 * Storage, compression, and slots are the APP's concern (doc 05 §10) — this
 * module produces and consumes plain JSON-safe objects.
 */
import { invariant } from '@crowns/core';
import { GAME_VERSION, type ModManifestEntry } from '@crowns/data';
import type { CampaignSettings } from '@crowns/protocol';
import type { Kernel } from './kernel.js';
import type { World } from './ecs.js';

export const SAVE_FORMAT_VERSION = 1;

export interface SaveSection {
  readonly key: string;
  /** Current schema version of this section's payload. */
  readonly version: number;
  /** Absence-tolerant: hydrate() SKIPS this section when the save predates it (the
   * composition's afterLoad fallback then applies) instead of refusing the load.
   * Default: required — a missing section is a corrupt/foreign save. */
  readonly optional?: boolean;
  save(): unknown;
  load(data: unknown): void;
}

/** Pure step in a section's migration chain: payload v → payload v+1. */
export type Migration = (data: unknown) => unknown;

export interface CampaignSaveHeader {
  readonly format: number;
  readonly gameVersion: string;
  readonly seed: number;
  readonly tick: number;
  /** The mod set active when this save was written (doc 06 §13, doc 09 §5). */
  readonly modManifest: readonly ModManifestEntry[];
  /** GDD §17 sandbox mode (roadmap M40) — excludes this save from achievements/chronicle. */
  readonly sandbox: boolean;
  /** Chronicle-locking hard mode (doc 06 §13) — recorded, not yet enforced (doc 14 OQ-8). */
  readonly ironman: boolean;
  /** M47.6: new-game options (map size, kingdoms, difficulty, victory toggles). The load path
   * recomposes the session FROM this before hydrating — the kernel's restoreState demands an
   * identical composition. Absent on pre-M47.6 saves and terra-composition saves. */
  readonly campaign?: CampaignSettings;
}

export interface SandboxFlags {
  readonly sandbox: boolean;
  readonly ironman: boolean;
}

export interface CampaignSave {
  readonly header: CampaignSaveHeader;
  readonly sections: Record<string, { version: number; data: unknown }>;
}

export class SaveManager {
  private readonly sections: SaveSection[] = [];
  private readonly migrations = new Map<string, Map<number, Migration>>();
  private readonly afterLoadHooks: (() => void)[] = [];
  private modManifest: readonly ModManifestEntry[] = [];
  private sandboxFlags: SandboxFlags = { sandbox: false, ironman: false };
  private campaignSettings: CampaignSettings | undefined;

  constructor(private readonly kernel: Kernel) {}

  /** The composition's active mod set (doc 09 §5) — embedded in every save from here on. */
  setModManifest(manifest: readonly ModManifestEntry[]): void {
    this.modManifest = manifest;
  }

  getModManifest(): readonly ModManifestEntry[] {
    return this.modManifest;
  }

  /** GDD §17 (roadmap M40) — embedded in every save from here on. */
  setSandboxFlags(flags: SandboxFlags): void {
    this.sandboxFlags = flags;
  }

  getSandboxFlags(): SandboxFlags {
    return this.sandboxFlags;
  }

  /** M47.6: the new-game options this session was composed from — round-tripped through the
   * header so a load can recompose the identical session (the T objective, doc 12 R1). */
  setCampaignSettings(settings: CampaignSettings): void {
    this.campaignSettings = settings;
  }

  getCampaignSettings(): CampaignSettings | undefined {
    return this.campaignSettings;
  }

  register(section: SaveSection): void {
    invariant(!this.sections.some((s) => s.key === section.key), `duplicate save section '${section.key}'`);
    this.sections.push(section);
  }

  /** Register the pure migration lifting `key` payloads from `fromVersion` to `fromVersion + 1`. */
  registerMigration(key: string, fromVersion: number, migrate: Migration): void {
    let chain = this.migrations.get(key);
    if (chain === undefined) this.migrations.set(key, (chain = new Map()));
    invariant(!chain.has(fromVersion), `duplicate migration '${key}' v${fromVersion}`);
    chain.set(fromVersion, migrate);
  }

  /** Post-hydration fixups: rebuild derived caches, re-bind closures. */
  afterLoad(hook: () => void): void {
    this.afterLoadHooks.push(hook);
  }

  snapshot(): CampaignSave {
    const sections: CampaignSave['sections'] = {};
    for (const s of this.sections) {
      sections[s.key] = { version: s.version, data: s.save() };
    }
    return {
      header: {
        format: SAVE_FORMAT_VERSION,
        gameVersion: GAME_VERSION,
        seed: this.kernel.seed,
        tick: this.kernel.currentTick,
        modManifest: this.modManifest,
        sandbox: this.sandboxFlags.sandbox,
        ironman: this.sandboxFlags.ironman,
        ...(this.campaignSettings !== undefined ? { campaign: this.campaignSettings } : {}),
      },
      sections,
    };
  }

  /**
   * Hydrate a freshly composed session. Returns a human-readable report of
   * migrations applied (empty = current-version save).
   */
  hydrate(save: CampaignSave): string[] {
    invariant(
      save.header.format === SAVE_FORMAT_VERSION,
      `save format v${save.header.format} unsupported (engine reads v${SAVE_FORMAT_VERSION})`,
    );
    invariant(
      save.header.seed === this.kernel.seed,
      `save seed ${save.header.seed} ≠ session seed ${this.kernel.seed} — compose the session from the save header`,
    );
    const report: string[] = [];
    for (const section of this.sections) {
      const stored = save.sections[section.key];
      if (stored === undefined && section.optional === true) {
        report.push(`${section.key}: absent (save predates this section) — composition fallback applies`);
        continue;
      }
      invariant(stored !== undefined, `save is missing section '${section.key}'`);
      let { version, data } = stored;
      while (version < section.version) {
        const step = this.migrations.get(section.key)?.get(version);
        invariant(step !== undefined, `no migration for section '${section.key}' v${version} → v${version + 1}`);
        data = step(data);
        report.push(`${section.key}: migrated v${version} → v${version + 1}`);
        version++;
      }
      invariant(
        version === section.version,
        `section '${section.key}' is v${version}, engine expects v${section.version}`,
      );
      section.load(data);
    }
    for (const hook of this.afterLoadHooks) hook();
    return report;
  }
}

// ---------------------------------------------------------------- mod reconciliation (OQ-4)

export interface ModReconciliationReport {
  /** In the save, not currently installed. */
  readonly missing: readonly ModManifestEntry[];
  /** Installed now, was not present in the save. */
  readonly added: readonly ModManifestEntry[];
  /** Same id, `version` differs. */
  readonly versionChanged: readonly { readonly saved: ModManifestEntry; readonly installed: ModManifestEntry }[];
  /** Same id and version, but content `hash` differs — a rebalance in place. */
  readonly contentChanged: readonly { readonly saved: ModManifestEntry; readonly installed: ModManifestEntry }[];
}

/**
 * Pure comparison of a save's embedded mod set against what's installed now
 * (doc 09 §7, OQ-4 — ratified: best-effort load + report, never blocking here).
 * `saved` may be `undefined` for pre-M39 saves (no modManifest in the header);
 * treated as an empty set — every installed mod reports as `added`, nothing
 * reports as `missing`/`changed`, since there's no baseline to compare against.
 */
export function reconcileModManifest(
  saved: readonly ModManifestEntry[] | undefined,
  installed: readonly ModManifestEntry[],
): ModReconciliationReport {
  const savedById = new Map((saved ?? []).map((m) => [m.modId, m]));
  const installedById = new Map(installed.map((m) => [m.modId, m]));
  const missing: ModManifestEntry[] = [];
  const versionChanged: { saved: ModManifestEntry; installed: ModManifestEntry }[] = [];
  const contentChanged: { saved: ModManifestEntry; installed: ModManifestEntry }[] = [];
  for (const s of savedById.values()) {
    const i = installedById.get(s.modId);
    if (i === undefined) missing.push(s);
    else if (i.version !== s.version) versionChanged.push({ saved: s, installed: i });
    else if (i.hash !== s.hash) contentChanged.push({ saved: s, installed: i });
  }
  const added = [...installedById.values()].filter((i) => !savedById.has(i.modId));
  return { missing, added, versionChanged, contentChanged };
}

/** True if a reconciliation report found anything worth telling the player about. */
export function modReconciliationHasFindings(report: ModReconciliationReport): boolean {
  return report.missing.length > 0 || report.versionChanged.length > 0 || report.contentChanged.length > 0;
}

// ---------------------------------------------------------------- stock sections

export function kernelSection(kernel: Kernel): SaveSection {
  return {
    key: 'kernel',
    version: 1,
    save: () => kernel.saveState(),
    load: (data) => kernel.restoreState(data as ReturnType<Kernel['saveState']>),
  };
}

export function worldSection(world: World): SaveSection {
  return {
    key: 'world',
    version: 1,
    save: () => world.saveState(),
    load: (data) => world.loadState(data as ReturnType<World['saveState']>),
  };
}
