/**
 * Translator-pack extraction (roadmap M44; doc 10 §6: "extraction tool
 * producing translator packs [key/english/context]"). Pure aggregation, no
 * I/O — combines every locale source this codebase has: content defs'
 * en.json5 (doc 06 "LocalizedText": EventDef.text/choice text) and the
 * curated UI-chrome slice (@crowns/app's EN_LOCALE, M44 task #48).
 */
import type { LocaleTable } from '@crowns/core';

export interface TranslatorPackEntry {
  readonly key: string;
  readonly english: string;
  readonly context: string;
}

export interface TranslatorPackSource {
  /** Human-readable origin, shown to translators (e.g. 'content:event', 'app:ui-chrome'). */
  readonly context: string;
  readonly table: LocaleTable;
}

export function buildTranslatorPack(sources: readonly TranslatorPackSource[]): TranslatorPackEntry[] {
  const entries: TranslatorPackEntry[] = [];
  for (const { context, table } of sources) {
    for (const [key, english] of Object.entries(table)) entries.push({ key, english, context });
  }
  return entries.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}
