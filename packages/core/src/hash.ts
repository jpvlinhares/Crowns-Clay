/**
 * Hashing utilities: PRNG stream forking (prng.ts), string interning buckets,
 * and per-tick state hashing for the determinism harness (TDD §5 rule 5, built M5).
 */

/** FNV-1a 32-bit over a string's UTF-16 code units. Stable across platforms. */
export function fnv1a32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** FNV-1a 32-bit over bytes. */
export function fnv1a32Bytes(bytes: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i] as number;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Order-dependent hash combiner (for building state hashes incrementally). */
export function hashCombine(seed: number, value: number): number {
  let h = seed >>> 0;
  h ^= (value >>> 0) + 0x9e3779b9 + ((h << 6) >>> 0) + (h >>> 2);
  return h >>> 0;
}

/** Hash an f64 by its exact bit pattern (deterministic across engines). */
const f64buf = new Float64Array(1);
const u32view = new Uint32Array(f64buf.buffer);
export function hashF64(seed: number, value: number): number {
  f64buf[0] = value;
  return hashCombine(hashCombine(seed, u32view[0] as number), u32view[1] as number);
}
