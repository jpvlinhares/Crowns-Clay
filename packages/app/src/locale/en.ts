/**
 * Base English locale table for presentation-layer ("UI chrome") strings
 * (roadmap M44; doc 10 §6). Distinct from content/base/locale/en.json5:
 * that one backs EventDef.text/choice text loaded through @crowns/data's
 * content pipeline; this one backs literal strings written directly in
 * main.ts, which isn't content and never goes through JSON5 validation.
 *
 * Deliberately a CURATED SLICE, not exhaustive extraction of every literal
 * in main.ts (~250+ of them, mostly debug/dev-tool chrome or already
 * interpolated with live sim data) — proves the @crowns/core Locale
 * plumbing works for hand-written UI strings too, not just content defs.
 */
import type { LocaleTable } from '@crowns/core';

export const EN_LOCALE: LocaleTable = {
  'ui.village.upgrade-tier': 'Upgrade tier',
  'ui.kingdom.edict.repeal': 'Repeal',
  'ui.kingdom.edict.enact': 'Enact',
  'ui.mods.apply': 'Apply',
  'ui.kingdom.ledger.heading': 'Ledger',
  'ui.ledger.kind.tax': 'tax',
  'ui.ledger.kind.edict-upkeep': 'edict upkeep',
  'ui.ledger.kind.advisor-salary': 'advisor salary',
  'ui.ledger.kind.unit-recruit': 'unit recruited',
  'ui.ledger.kind.unit-upkeep': 'unit upkeep',
};
