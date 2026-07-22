/**
 * Save-corpus recorder (roadmap M17; TDD §8/§13 "save corpus" row; M47
 * "save-corpus torture").
 *
 *   node packages/tools/dist/save-corpus.js record         # (re)write both corpus entries
 *   node packages/tools/dist/save-corpus.js verify          # what CI runs (also a test)
 *   node packages/tools/dist/save-corpus.js torture [cycles] # M47: repeated save/load, not just one
 *
 * Each corpus entry is a REAL campaign save plus the state hash the session
 * must reach after resuming RESUME_TICKS — pinned forever. Every future save
 * format bumps a version and adds migrations; the corpus proves old saves
 * keep loading (the M39 reconciliation work builds on this).
 *
 * M47 delta: `verifyCorpusEntry` proves a save survives ONE load; real bugs
 * (a derived cache rebuilt correctly the first time but not the second, say)
 * can hide behind that. `tortureCorpusEntry` chains `cycles` independent
 * save→load round trips end to end — each cycle re-saves from the FRESHLY
 * LOADED session, not the original, so a latent load-then-resave defect
 * compounds instead of hiding. A second corpus entry, `terra-sandbox-v1`,
 * exercises the sandbox/ironman save flags (`SaveManager.setSandboxFlags`,
 * M40) — a real code path the original `terra-tick500-v1` entry (never
 * sandboxed) never touches.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { composeTerra, composeCampaignForApp, DEFAULT_CAMPAIGN_SETTINGS } from '@crowns/app';
import type { CampaignSave } from '@crowns/sim';

export const CORPUS_DIR = 'fixtures/saves';
export const CORPUS_SEED = 0x7e44a; // the terra-demo world
export const CORPUS_SAVE_TICK = 500;
export const RESUME_TICKS = 100;
/** M47: a second seed/tick depth, composed with sandbox flags on — a distinct entry, not a
 * variant of the first, so the corpus covers a genuinely different code path. */
export const SANDBOX_CORPUS_SEED = 0x51de;
export const SANDBOX_CORPUS_SAVE_TICK = 300;

export interface CorpusEntry {
  readonly name: string;
  readonly save: CampaignSave;
  /** stateHash after RESUME_TICKS more ticks — the resume contract. */
  readonly resumeHash: number;
}

function recordEntry(name: string, seed: number, saveTick: number, sandbox?: { ironman?: boolean }): CorpusEntry {
  const session = composeTerra(seed, undefined, undefined, sandbox);
  for (let t = 0; t < saveTick; t++) session.kernel.step();
  const save = session.saves.snapshot();
  for (let t = 0; t < RESUME_TICKS; t++) session.kernel.step();
  return { name, save, resumeHash: session.kernel.stateHash() };
}

/** M47.6: recompose whatever composition a save's header says it came from —
 * campaign entries carry their new-game settings (doc 12 R1 round-trip). */
function sessionFor(save: CampaignSave): { kernel: import('@crowns/sim').Kernel; saves: import('@crowns/sim').SaveManager } {
  return save.header.campaign !== undefined
    ? composeCampaignForApp(save.header.seed, save.header.campaign)
    : composeTerra(save.header.seed);
}

/** M47.6: a THIRD corpus entry — the unified campaign composition (campaign-demo settings),
 * exercising every new save section (diplomacy, research, victory, combat, siege, fog). */
export const CAMPAIGN_CORPUS_SEED = 0xca47a1; // the campaign-demo world
export const CAMPAIGN_CORPUS_SAVE_TICK = 500;
export function recordCampaignCorpusEntry(): CorpusEntry {
  const session = composeCampaignForApp(CAMPAIGN_CORPUS_SEED, DEFAULT_CAMPAIGN_SETTINGS);
  for (let t = 0; t < CAMPAIGN_CORPUS_SAVE_TICK; t++) session.kernel.step();
  const save = session.saves.snapshot();
  for (let t = 0; t < RESUME_TICKS; t++) session.kernel.step();
  return { name: `campaign-tick${CAMPAIGN_CORPUS_SAVE_TICK}-v1`, save, resumeHash: session.kernel.stateHash() };
}

export function recordCorpusEntry(): CorpusEntry {
  return recordEntry(`terra-tick${CORPUS_SAVE_TICK}-v1`, CORPUS_SEED, CORPUS_SAVE_TICK);
}

/** M60 (ADR-4 Amendment A1): a synthesised M28-ERA save — the on-map castle era, before the
 * M51 defence layer. Current code cannot PRODUCE one (M56 deleted castle placement AND the
 * `castle-defense-rebuild` system), so we craft one from a real terra economy save and add the
 * three things that make it M28-era, each exercising a distinct load-time migration this
 * milestone owns:
 *   (1) grandfathered on-map castle buildings (wall/gate/tower) at their M28 footprint — all
 *       1×1 back then. The def has since grown (tower→3×3, gate→3×2), so this is exactly the
 *       state the footprint-reconciliation rule must honour: an already-placed instance keeps
 *       its stored w/h and does NOT retroactively swell over its neighbours (wall stays 1×1
 *       in both eras, the control). "Walls standing but inert" — occupancy-blocking,
 *       demolishable, no graph, no siege meaning (the derivation that gave them meaning is gone).
 *   (2) a village flagged isCastle=true — the deprecated M28 field, loaded but never re-derived.
 *   (3) `castle-defense-rebuild` re-injected into the kernel's systemRngs — the deleted system
 *       an M28 save still names. Its presence used to throw restoreState's composition-mismatch
 *       invariant BEFORE any grandfathering ran (the newly-exposed gate M56 discovered); the
 *       retired-name tolerance now discards it. */
export const LEGACY_M28_SEED = 0x1d28; // an M28-era economy world
export const LEGACY_M28_SAVE_TICK = 200;
export function recordLegacyM28CastleEntry(): CorpusEntry {
  const cc = composeTerra(LEGACY_M28_SEED);
  for (let t = 0; t < LEGACY_M28_SAVE_TICK; t++) cc.kernel.step();

  const VillageCore = cc.game.comps.VillageCore;
  const BuildingCore = cc.game.comps.BuildingCore;
  const vc = cc.world.read(VillageCore);
  let villageEntity = -1;
  let vi = -1;
  let cx = 0;
  let cy = 0;
  cc.world.query([VillageCore]).forEach((i, entity) => {
    if (villageEntity >= 0) return; // the founding village
    villageEntity = entity as number;
    vi = i;
    cx = vc.centerX[i] as number;
    cy = vc.centerY[i] as number;
  });
  cc.world.write(VillageCore).isCastle[vi] = 1; // the enclosure flag an M28 castle once set

  // a short grandfathered wall run with a gate and a tower, east of the keep — all stamped
  // at the M28 1×1 footprint they were placed with, regardless of the defs' current size
  const stamp = (defId: string, x: number, y: number): void => {
    const e = cc.world.spawn();
    cc.world.attach(e, BuildingCore, {
      def: cc.game.ops.defCode(defId), x, y, w: 1, h: 1,
      village: villageEntity, progress: 1, complete: true, workers: 0,
    });
  };
  stamp('base:building.wall', cx + 4, cy - 1);
  stamp('base:building.wall', cx + 4, cy);
  stamp('base:building.wall', cx + 4, cy + 1);
  stamp('base:building.gatehouse', cx + 4, cy + 2);
  stamp('base:building.tower', cx + 6, cy + 4);

  const crafted = JSON.parse(JSON.stringify(cc.saves.snapshot())) as CampaignSave;
  const kernelData = crafted.sections.kernel!.data as { systemRngs: { name: string; state: unknown }[] };
  // any well-formed RNG state — a retired name's stream is discarded on load, so the value
  // is inert; cloning an existing system's keeps it structurally valid.
  kernelData.systemRngs.push({ name: 'castle-defense-rebuild', state: { ...(kernelData.systemRngs[0]!.state as object) } });

  // pin the resume hash EXACTLY as verifyCorpusEntry recomputes it (fresh compose → hydrate →
  // resume RESUME_TICKS), so recording and verifying agree by construction.
  const session = sessionFor(crafted);
  session.saves.hydrate(crafted);
  for (let t = 0; t < RESUME_TICKS; t++) session.kernel.step();
  return { name: 'legacy-castle-m28-v1', save: crafted, resumeHash: session.kernel.stateHash() };
}

export function recordSandboxCorpusEntry(): CorpusEntry {
  return recordEntry('terra-sandbox-v1', SANDBOX_CORPUS_SEED, SANDBOX_CORPUS_SAVE_TICK, { ironman: false });
}

export function verifyCorpusEntry(entry: CorpusEntry): { ok: boolean; detail: string } {
  const session = sessionFor(entry.save);
  const migrations = session.saves.hydrate(entry.save);
  if (session.kernel.currentTick !== entry.save.header.tick) {
    return { ok: false, detail: `tick ${session.kernel.currentTick} ≠ header ${entry.save.header.tick}` };
  }
  for (let t = 0; t < RESUME_TICKS; t++) session.kernel.step();
  const hash = session.kernel.stateHash();
  if (hash !== entry.resumeHash) {
    return {
      ok: false,
      detail: `resume hash 0x${hash.toString(16)} ≠ pinned 0x${entry.resumeHash.toString(16)}`,
    };
  }
  return { ok: true, detail: `resumed ${RESUME_TICKS} ticks to 0x${hash.toString(16)} (${migrations.length} migrations)` };
}

/** M47 torture: `cycles` independent save→load round trips chained end to end, each one
 * re-saving from the freshly LOADED session (not the original) — proves the save format is
 * stable under REPEATED use, not just a single load. */
export function tortureCorpusEntry(entry: CorpusEntry, cycles: number): { ok: boolean; detail: string } {
  let payload: CampaignSave = entry.save;
  for (let cycle = 1; cycle <= cycles; cycle++) {
    const session = sessionFor(payload);
    session.saves.hydrate(payload);
    for (let t = 0; t < RESUME_TICKS; t++) session.kernel.step();
    const hashBeforeReload = session.kernel.stateHash();
    const resaved = session.saves.snapshot();
    // reload from the JUST-WRITTEN payload, in a FRESH session — the exact shape a real player's
    // "save, quit, relaunch, load" does, repeated `cycles` times
    const reloaded = sessionFor(payload);
    reloaded.saves.hydrate(JSON.parse(JSON.stringify(resaved)) as CampaignSave);
    const hashAfterReload = reloaded.kernel.stateHash();
    if (hashAfterReload !== hashBeforeReload) {
      return {
        ok: false,
        detail: `cycle ${cycle}/${cycles}: hash drifted across reload (0x${hashBeforeReload.toString(16)} → 0x${hashAfterReload.toString(16)})`,
      };
    }
    payload = resaved;
  }
  return { ok: true, detail: `${cycles} save/load cycles (${cycles * RESUME_TICKS} total ticks), hash stable throughout` };
}

const mode = process.argv[2];
if (mode === 'record') {
  mkdirSync(CORPUS_DIR, { recursive: true });
  for (const entry of [recordCorpusEntry(), recordSandboxCorpusEntry(), recordCampaignCorpusEntry(), recordLegacyM28CastleEntry()]) {
    const path = `${CORPUS_DIR}/${entry.name}.json`;
    writeFileSync(path, JSON.stringify(entry));
    console.log(`recorded ${path} · save tick ${entry.save.header.tick} · resume hash 0x${entry.resumeHash.toString(16)}`);
  }
  console.log('re-recording the corpus must be INTENTIONAL — call it out in the PR (TDD §13)');
} else if (mode === 'verify') {
  let failures = 0;
  for (const file of readdirSync(CORPUS_DIR).filter((f) => f.endsWith('.json')).sort()) {
    const entry = JSON.parse(readFileSync(`${CORPUS_DIR}/${file}`, 'utf8')) as CorpusEntry;
    const result = verifyCorpusEntry(entry);
    console.log(`${result.ok ? 'OK  ' : 'FAIL'} ${entry.name} · ${result.detail}`);
    if (!result.ok) failures++;
  }
  if (failures > 0) process.exit(1);
} else if (mode === 'torture') {
  const cycles = Math.max(1, Number(process.argv[3] ?? 5) | 0);
  let failures = 0;
  for (const file of readdirSync(CORPUS_DIR).filter((f) => f.endsWith('.json')).sort()) {
    const entry = JSON.parse(readFileSync(`${CORPUS_DIR}/${file}`, 'utf8')) as CorpusEntry;
    const result = tortureCorpusEntry(entry, cycles);
    console.log(`${result.ok ? 'OK  ' : 'FAIL'} ${entry.name} · ${result.detail}`);
    if (!result.ok) failures++;
  }
  if (failures > 0) process.exit(1);
}
