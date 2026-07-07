/**
 * Save-corpus recorder (roadmap M17; TDD §8/§13 "save corpus" row).
 *
 *   node packages/tools/dist/save-corpus.js record   # (re)write the corpus entry
 *   node packages/tools/dist/save-corpus.js verify   # what CI runs (also a test)
 *
 * Each corpus entry is a REAL campaign save plus the state hash the session
 * must reach after resuming RESUME_TICKS — pinned forever. Every future save
 * format bumps a version and adds migrations; the corpus proves old saves
 * keep loading (the M39 reconciliation work builds on this).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { composeTerra } from '@crowns/app';
import type { CampaignSave } from '@crowns/sim';

export const CORPUS_DIR = 'fixtures/saves';
export const CORPUS_SEED = 0x7e44a; // the terra-demo world
export const CORPUS_SAVE_TICK = 500;
export const RESUME_TICKS = 100;

export interface CorpusEntry {
  readonly name: string;
  readonly save: CampaignSave;
  /** stateHash after RESUME_TICKS more ticks — the resume contract. */
  readonly resumeHash: number;
}

export function recordCorpusEntry(): CorpusEntry {
  const session = composeTerra(CORPUS_SEED);
  for (let t = 0; t < CORPUS_SAVE_TICK; t++) session.kernel.step();
  const save = session.saves.snapshot();
  for (let t = 0; t < RESUME_TICKS; t++) session.kernel.step();
  return { name: `terra-tick${CORPUS_SAVE_TICK}-v1`, save, resumeHash: session.kernel.stateHash() };
}

export function verifyCorpusEntry(entry: CorpusEntry): { ok: boolean; detail: string } {
  const session = composeTerra(entry.save.header.seed);
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

const mode = process.argv[2];
if (mode === 'record') {
  const entry = recordCorpusEntry();
  mkdirSync(CORPUS_DIR, { recursive: true });
  const path = `${CORPUS_DIR}/${entry.name}.json`;
  writeFileSync(path, JSON.stringify(entry));
  console.log(`recorded ${path} · save tick ${entry.save.header.tick} · resume hash 0x${entry.resumeHash.toString(16)}`);
  console.log('re-recording the corpus must be INTENTIONAL — call it out in the PR (TDD §13)');
} else if (mode === 'verify') {
  const entry = JSON.parse(readFileSync(`${CORPUS_DIR}/terra-tick${CORPUS_SAVE_TICK}-v1.json`, 'utf8')) as CorpusEntry;
  const result = verifyCorpusEntry(entry);
  console.log(`${result.ok ? 'OK  ' : 'FAIL'} ${entry.name} · ${result.detail}`);
  if (!result.ok) process.exit(1);
}
