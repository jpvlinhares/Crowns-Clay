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
  for (const entry of [recordCorpusEntry(), recordSandboxCorpusEntry(), recordCampaignCorpusEntry()]) {
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
