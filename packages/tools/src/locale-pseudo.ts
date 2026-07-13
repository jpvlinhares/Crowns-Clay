/**
 * en-XA pseudo-locale generator (roadmap M44; doc 10 §6: "en-XA (accented +
 * 30% expansion) for CI screenshot diffing"). Pure transform, no I/O — the
 * CLI wrapper (locale-tool.ts) handles reading/writing files.
 *
 * Preserves @crowns/core's `formatMessage` syntax (`{name}` placeholders and
 * `{n, plural, one{...} other{...}}` selectors) untouched: only the literal
 * text OUTSIDE those tokens is accented/expanded, so a resolved en-XA string
 * still formats correctly at runtime — the whole point of pseudo-localizing
 * is to exercise real string-length/character-set assumptions without
 * actually breaking interpolation.
 */
import type { LocaleTable } from '@crowns/core';

const ACCENTS: Readonly<Record<string, string>> = {
  a: 'ä', e: 'ë', i: 'ï', o: 'ö', u: 'ü',
  A: 'Ä', E: 'Ë', I: 'Ï', O: 'Ö', U: 'Ü',
};

export function accentize(text: string): string {
  return text.replace(/[aeiouAEIOU]/g, (c) => ACCENTS[c] ?? c);
}

const EXPANSION_RATIO = 0.3; // doc 10 §6's "30% expansion"
const FILLER = 'Ξ';

function expand(text: string): string {
  const padLen = Math.max(1, Math.ceil(text.length * EXPANSION_RATIO));
  return `${text} ${FILLER.repeat(padLen)}`;
}

// Mirrors @crowns/core locale.ts's PLURAL_RE/PLACEHOLDER_RE, as one
// alternation with a capture group so String.split() preserves the tokens
// verbatim in the output array instead of consuming them.
const TOKEN_RE = /(\{\w+,\s*plural,\s*(?:\w+\{[^{}]*\}\s*)+\}|\{\w+\})/g;

export function pseudoLocalizeTemplate(template: string): string {
  const parts = template.split(TOKEN_RE);
  const transformed = parts.map((part, i) => (i % 2 === 0 ? accentize(part) : part)).join('');
  return `⟦${expand(transformed)}⟧`;
}

export function buildEnXaTable(table: LocaleTable): LocaleTable {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(table)) out[key] = pseudoLocalizeTemplate(value);
  return out;
}
