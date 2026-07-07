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
import { GAME_VERSION } from '@crowns/data';
import type { Kernel } from './kernel.js';
import type { World } from './ecs.js';

export const SAVE_FORMAT_VERSION = 1;

export interface SaveSection {
  readonly key: string;
  /** Current schema version of this section's payload. */
  readonly version: number;
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
}

export interface CampaignSave {
  readonly header: CampaignSaveHeader;
  readonly sections: Record<string, { version: number; data: unknown }>;
}

export class SaveManager {
  private readonly sections: SaveSection[] = [];
  private readonly migrations = new Map<string, Map<number, Migration>>();
  private readonly afterLoadHooks: (() => void)[] = [];

  constructor(private readonly kernel: Kernel) {}

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
