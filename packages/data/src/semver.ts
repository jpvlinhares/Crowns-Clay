/**
 * Dependency-free semver subset for mod compatibility gating (doc 09 §7).
 * Supports the range vocabulary Mod manifests actually use: exact versions,
 * comparators (>= > <= < =), caret (^), and space-separated conjunctions
 * (">=0.1 <1.0"). Partial versions pad with zeros ("0.1" → 0.1.0).
 */

export type Version = readonly [number, number, number];

export function parseVersion(text: string): Version | null {
  const m = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(text.trim());
  if (m === null) return null;
  return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)];
}

export function compareVersions(a: Version, b: Version): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** True iff `version` satisfies every space-separated comparator in `range`. */
export function satisfies(versionText: string, range: string): boolean {
  const version = parseVersion(versionText);
  if (version === null) return false;
  for (const token of range.trim().split(/\s+/)) {
    if (token.length === 0) continue;
    const m = /^(>=|<=|>|<|=|\^)?(.+)$/.exec(token);
    if (m === null) return false;
    const op = m[1] ?? '=';
    const bound = parseVersion(m[2] as string);
    if (bound === null) return false;
    const cmp = compareVersions(version, bound);
    switch (op) {
      case '>=': if (cmp < 0) return false; break;
      case '>': if (cmp <= 0) return false; break;
      case '<=': if (cmp > 0) return false; break;
      case '<': if (cmp >= 0) return false; break;
      case '=': if (cmp !== 0) return false; break;
      case '^': {
        // npm caret semantics: >=bound, <next breaking version
        if (cmp < 0) return false;
        const upper: Version =
          bound[0] > 0 ? [bound[0] + 1, 0, 0] : bound[1] > 0 ? [0, bound[1] + 1, 0] : [0, 0, bound[2] + 1];
        if (compareVersions(version, upper) >= 0) return false;
        break;
      }
    }
  }
  return true;
}
