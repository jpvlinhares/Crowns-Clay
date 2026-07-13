/**
 * Localization core (roadmap M44; doc 10 §6; doc 06 "LocalizedText"). Lives
 * in @crowns/core (zero internal deps, TDD §3) because both `@crowns/data`
 * (defs reference keys) and presentation (`@crowns/ui`/`@crowns/app`,
 * resolving them to display text) need it, and core is the one package
 * everything already depends on.
 *
 * `LocalizedText` is a BRANDED string (same nominal-typing trick `EntityId`/
 * `InternedId` already use, `ids.ts`) — a locale KEY, never raw display text,
 * so passing an unconverted literal where a key is expected is a compile
 * error, not a silent bug. `localeKey()` is the one sanctioned cast, for the
 * boundary where content authors write a key value.
 *
 * `formatMessage` is an ICU MessageFormat SUBSET (doc 10 §6 names full ICU;
 * this implements exactly two constructs — `{placeholder}` interpolation and
 * a simple `{var, plural, one{...} other{...}}` selector for English's
 * one/other split) — not gender, not gender+plural nesting, not arbitrary
 * CLDR plural categories. Anything else in a template is left verbatim
 * rather than thrown on: a malformed message should be visibly odd in the
 * UI, never a crash (the same "fail closed/visible, never throw" discipline
 * `events.ts`'s DSL evaluator already established for exactly this reason).
 */

export type LocalizedText = string & { readonly __localized: unique symbol };

/** The one sanctioned way to produce a `LocalizedText` from a plain string key. */
export function localeKey(raw: string): LocalizedText {
  return raw as LocalizedText;
}

/** key -> English (or translated) template string. One locale's whole table. */
export type LocaleTable = Readonly<Record<string, string>>;

export interface FormatParams {
  readonly [name: string]: string | number;
}

const PLURAL_RE = /\{(\w+),\s*plural,\s*((?:\w+\{[^{}]*\}\s*)+)\}/g;
const BRANCH_RE = /(\w+)\{([^{}]*)\}/g;
const PLACEHOLDER_RE = /\{(\w+)\}/g;

export function formatMessage(template: string, params: FormatParams = {}): string {
  let result = template.replace(PLURAL_RE, (whole: string, varName: string, branchesSrc: string) => {
    const value = params[varName];
    if (typeof value !== 'number') return whole; // unresolvable — leave the raw ICU-ish text visible
    const branches = new Map<string, string>();
    for (const m of branchesSrc.matchAll(BRANCH_RE)) branches.set(m[1] as string, m[2] as string);
    const branch = (value === 1 ? branches.get('one') : undefined) ?? branches.get('other') ?? '';
    return branch.replace(/#/g, String(value));
  });
  result = result.replace(PLACEHOLDER_RE, (whole: string, name: string) => {
    const value = params[name];
    return value === undefined ? whole : String(value);
  });
  return result;
}

/** Resolves keys against one loaded table. Missing keys resolve to the KEY ITSELF — fail
 * visible (doc 01 §3 "legible depth"): a missing translation reads as an odd string in the UI,
 * never a blank, a crash, or a silently-wrong fallback language. */
export class Locale {
  constructor(
    private readonly table: LocaleTable,
    private readonly id: string,
  ) {}

  localeId(): string {
    return this.id;
  }

  has(key: LocalizedText): boolean {
    return Object.prototype.hasOwnProperty.call(this.table, key as string);
  }

  resolve(key: LocalizedText, params?: FormatParams): string {
    const template = this.table[key as string];
    if (template === undefined) return key as string;
    return params === undefined ? template : formatMessage(template, params);
  }
}
