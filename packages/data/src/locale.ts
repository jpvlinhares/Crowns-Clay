/**
 * Loads a locale table (roadmap M44; doc 10 §6) from a content source's raw
 * files. Locale tables are flat key -> template maps, not id-keyed defs, so
 * they skip loadModLayers' def-merge pipeline entirely — a straight JSON5
 * parse of a single file, keyed by path (e.g. `locale/en.json5`) the same
 * way `BASE_CONTENT_FILES` keys everything else by path relative to
 * `content/base/`.
 */
import { parseJson5Subset } from './validate.js';

export function parseLocaleTable(file: string, raw: string): Readonly<Record<string, string>> {
  const parsed = parseJson5Subset(file, raw);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${file}: expected a flat object of locale key -> string`);
  }
  const table: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== 'string') throw new Error(`${file}: locale value for '${key}' must be a string, got ${typeof value}`);
    table[key] = value;
  }
  return table;
}

/** Missing file -> empty table rather than a startup crash: a locale gap should surface as
 * `Locale.resolve`'s key-echo fail-visible behaviour, not take down content loading. */
export function loadLocaleTable(files: Readonly<Record<string, string>>, path: string): Readonly<Record<string, string>> {
  const raw = files[path];
  return raw === undefined ? {} : parseLocaleTable(path, raw);
}
