/**
 * Save corpus (M17; TDD §13 "save corpus: every historical save version
 * loads & resumes — per-PR"). The committed fixture is a real campaign save;
 * this test hydrates it into a fresh session and resumes it to the pinned
 * hash. When the save format grows, old entries stay and migrations carry
 * them — this suite is where that promise is kept.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

import { verifyCorpusEntry, CORPUS_DIR, type CorpusEntry } from './save-corpus.js';

test('corpus: every committed save loads and resumes to its pinned hash', () => {
  const entries = readdirSync(CORPUS_DIR).filter((f) => f.endsWith('.json'));
  assert.ok(entries.length >= 1, 'the corpus must never be empty (TDD §13)');
  for (const file of entries) {
    const entry = JSON.parse(readFileSync(`${CORPUS_DIR}/${file}`, 'utf8')) as CorpusEntry;
    const result = verifyCorpusEntry(entry);
    assert.ok(result.ok, `${entry.name}: ${result.detail}`);
  }
});
