/**
 * Validator core (roadmap M8; doc 09 §3). Two dependency-free pieces:
 *
 * 1. `parseJson5Subset` — a single-pass cleaner for the authoring format:
 *    JSON plus line/block comments and trailing commas (string-aware, so
 *    "http://x" and "a, }" inside strings survive). Unquoted keys and
 *    single-quoted strings are NOT in the subset — deliberately small.
 *    Swapping in a full JSON5 parser at M10 is a one-function change.
 *
 * 2. Combinator validators — tiny schema builders producing path-precise,
 *    human-readable errors ("defs/terrain/water.json5 [1].colors.base:
 *    expected #rrggbb color, got 42"). Doc 09 promises readable errors as a
 *    feature; this is where they come from. The combinators are the single
 *    source of truth for def shapes until schema-generation lands (M10/M39).
 */

// ---------------------------------------------------------------- parsing

export class ContentParseError extends Error {
  constructor(
    readonly file: string,
    message: string,
  ) {
    super(`${file}: ${message}`);
    this.name = 'ContentParseError';
  }
}

/** Strip comments + trailing commas (string-aware), then JSON.parse. */
export function parseJson5Subset(file: string, source: string): unknown {
  let out = '';
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i] as string;
    if (c === '"') {
      // copy the string verbatim, honoring escapes
      out += c;
      i++;
      while (i < n) {
        const s = source[i] as string;
        out += s;
        i++;
        if (s === '\\') {
          if (i < n) {
            out += source[i] as string;
            i++;
          }
        } else if (s === '"') break;
      }
      continue;
    }
    if (c === '/' && source[i + 1] === '/') {
      while (i < n && source[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === ',') {
      // trailing comma? look ahead past whitespace/comments for } or ]
      let j = i + 1;
      for (;;) {
        while (j < n && /\s/.test(source[j] as string)) j++;
        if (source[j] === '/' && source[j + 1] === '/') {
          while (j < n && source[j] !== '\n') j++;
          continue;
        }
        if (source[j] === '/' && source[j + 1] === '*') {
          j += 2;
          while (j < n && !(source[j] === '*' && source[j + 1] === '/')) j++;
          j += 2;
          continue;
        }
        break;
      }
      if (source[j] === '}' || source[j] === ']') {
        i++; // drop the comma
        continue;
      }
    }
    out += c;
    i++;
  }
  try {
    return JSON.parse(out);
  } catch (error) {
    throw new ContentParseError(file, error instanceof Error ? error.message : String(error));
  }
}

// ---------------------------------------------------------------- validation

export interface ValidationError {
  readonly file: string;
  readonly path: string;
  readonly message: string;
}

export type Validator<T> = (value: unknown, path: string, errors: ValidationError[], file: string) => T;

const fail = (
  errors: ValidationError[],
  file: string,
  path: string,
  message: string,
): undefined => {
  errors.push({ file, path, message });
  return undefined;
};

export const v = {
  string(opts: { minLength?: number } = {}): Validator<string> {
    return (value, path, errors, file) => {
      if (typeof value !== 'string') return fail(errors, file, path, `expected string, got ${typeof value}`) as never;
      if (opts.minLength !== undefined && value.length < opts.minLength) {
        return fail(errors, file, path, `string shorter than ${opts.minLength}`) as never;
      }
      return value;
    };
  },

  number(opts: { min?: number; max?: number; integer?: boolean } = {}): Validator<number> {
    return (value, path, errors, file) => {
      if (typeof value !== 'number' || Number.isNaN(value)) {
        return fail(errors, file, path, `expected number, got ${typeof value}`) as never;
      }
      if (opts.integer === true && !Number.isInteger(value)) return fail(errors, file, path, `expected integer, got ${value}`) as never;
      if (opts.min !== undefined && value < opts.min) return fail(errors, file, path, `${value} below minimum ${opts.min}`) as never;
      if (opts.max !== undefined && value > opts.max) return fail(errors, file, path, `${value} above maximum ${opts.max}`) as never;
      return value;
    };
  },

  /** Namespaced content id: `namespace:kind.name` (doc 09 §1). */
  id(): Validator<string> {
    return (value, path, errors, file) => {
      if (typeof value !== 'string' || !/^[a-z0-9-]+:[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(value)) {
        return fail(errors, file, path, `expected namespaced id like 'base:terrain.plains', got ${JSON.stringify(value)}`) as never;
      }
      return value;
    };
  },

  /** '#rrggbb' → packed 0xrrggbb number. */
  color(): Validator<number> {
    return (value, path, errors, file) => {
      if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) {
        return fail(errors, file, path, `expected #rrggbb color, got ${JSON.stringify(value)}`) as never;
      }
      return parseInt(value.slice(1), 16);
    };
  },

  literal<const L extends readonly string[]>(...allowed: L): Validator<L[number]> {
    return (value, path, errors, file) => {
      if (typeof value !== 'string' || !allowed.includes(value)) {
        return fail(errors, file, path, `expected one of ${allowed.join(' | ')}, got ${JSON.stringify(value)}`) as never;
      }
      return value as L[number];
    };
  },

  array<T>(item: Validator<T>, opts: { minItems?: number } = {}): Validator<T[]> {
    return (value, path, errors, file) => {
      if (!Array.isArray(value)) return fail(errors, file, path, `expected array, got ${typeof value}`) as never;
      if (opts.minItems !== undefined && value.length < opts.minItems) {
        return fail(errors, file, path, `array needs at least ${opts.minItems} items`) as never;
      }
      return value.map((entry, index) => item(entry, `${path}[${index}]`, errors, file));
    };
  },

  /** Any plain object, passed through untouched (shape checked downstream). */
  record(): Validator<Record<string, unknown>> {
    return (value, path, errors, file) => {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return fail(errors, file, path, `expected object, got ${Array.isArray(value) ? 'array' : typeof value}`) as never;
      }
      return value as Record<string, unknown>;
    };
  },

  object<S extends Record<string, Validator<unknown>>>(
    fields: S,
    opts: { optional?: (keyof S)[] } = {},
  ): Validator<{ [K in keyof S]: S[K] extends Validator<infer T> ? T : never }> {
    const optional = new Set(opts.optional ?? []);
    return (value, path, errors, file) => {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return fail(errors, file, path, `expected object, got ${Array.isArray(value) ? 'array' : typeof value}`) as never;
      }
      const record = value as Record<string, unknown>;
      const result: Record<string, unknown> = {};
      for (const key of Object.keys(fields)) {
        if (!(key in record)) {
          if (!optional.has(key)) fail(errors, file, `${path}.${key}`, 'missing required field');
          continue;
        }
        result[key] = (fields[key] as Validator<unknown>)(record[key], `${path}.${key}`, errors, file);
      }
      for (const key of Object.keys(record)) {
        if (!(key in fields)) fail(errors, file, `${path}.${key}`, 'unknown field (systems must ignore unknown fields, but defs must not silently misspell known ones)');
      }
      return result as never;
    };
  },
};

export function formatErrors(errors: readonly ValidationError[]): string {
  return errors.map((e) => `  ${e.file} ${e.path}: ${e.message}`).join('\n');
}
