/**
 * Deterministic iteration helpers (TDD §5 rule 2): sim code must never iterate
 * a Map/Set/object in engine-defined ("whatever") order over keys that came from
 * hashing — use these to make ordering explicit and stable.
 */

/** Numeric-ascending key iteration over a Map<number, V>. */
export function* iterSortedNumeric<V>(map: ReadonlyMap<number, V>): IterableIterator<[number, V]> {
  const keys = Array.from(map.keys()).sort((a, b) => a - b);
  for (const k of keys) yield [k, map.get(k) as V];
}

/** Lexicographic key iteration over a Map<string, V> (code-unit order, locale-free). */
export function* iterSortedLex<V>(map: ReadonlyMap<string, V>): IterableIterator<[string, V]> {
  const keys = Array.from(map.keys()).sort();
  for (const k of keys) yield [k, map.get(k) as V];
}

/** Stable insertion-order map with O(1) delete that preserves determinism. */
export class StableMap<K, V> {
  private readonly map = new Map<K, V>();

  set(key: K, value: V): this {
    this.map.set(key, value);
    return this;
  }
  get(key: K): V | undefined {
    return this.map.get(key);
  }
  has(key: K): boolean {
    return this.map.has(key);
  }
  delete(key: K): boolean {
    return this.map.delete(key);
  }
  get size(): number {
    return this.map.size;
  }
  /** JS Maps already guarantee insertion order — we rely on and pin that here. */
  *entries(): IterableIterator<[K, V]> {
    yield* this.map.entries();
  }
}
