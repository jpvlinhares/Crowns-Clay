/**
 * Deterministic PRNG service (TDD §5, rule 1).
 *
 * - Algorithm: xoshiro128** (32-bit ops only — identical results in every JS engine),
 *   seeded via splitmix32.
 * - `Math.random` is banned in @crowns/sim; all randomness flows through instances of `Rng`.
 * - Streams: a root Rng is forked per-system / per-entity by *stable string keys*
 *   (e.g. `fork('combat')`, `fork('event:base:harsh-winter')`) so adding a consumer
 *   never perturbs the draw sequence of another (determinism isolation).
 * - State is serializable for save files (doc 06 §12 `rngState`).
 */

import { fnv1a32 } from './hash.js';

export interface RngState {
  readonly s0: number;
  readonly s1: number;
  readonly s2: number;
  readonly s3: number;
}

function splitmix32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x9e3779b9) >>> 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    return (t ^ (t >>> 15)) >>> 0;
  };
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

export class Rng {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;

  private constructor(s0: number, s1: number, s2: number, s3: number) {
    this.s0 = s0 >>> 0;
    this.s1 = s1 >>> 0;
    this.s2 = s2 >>> 0;
    this.s3 = s3 >>> 0;
    // xoshiro requires a non-zero state; splitmix seeding makes this all but
    // impossible, but guard the invariant anyway.
    if ((this.s0 | this.s1 | this.s2 | this.s3) === 0) this.s3 = 1;
  }

  /** Create from an integer seed (campaign seed) — stable across platforms. */
  static fromSeed(seed: number): Rng {
    const sm = splitmix32(seed >>> 0);
    return new Rng(sm(), sm(), sm(), sm());
  }

  /** Create from a human-shareable seed string (world seeds, GDD §13). */
  static fromString(seed: string): Rng {
    return Rng.fromSeed(fnv1a32(seed));
  }

  static fromState(state: RngState): Rng {
    return new Rng(state.s0, state.s1, state.s2, state.s3);
  }

  state(): RngState {
    return { s0: this.s0, s1: this.s1, s2: this.s2, s3: this.s3 };
  }

  /**
   * Fork an independent stream by stable key. Forking reads NO draws from the
   * parent — it derives purely from (parent state, key) — so fork order is
   * irrelevant and adding forks never shifts sibling sequences.
   */
  fork(key: string): Rng {
    const k = fnv1a32(key);
    const sm = splitmix32((this.s0 ^ Math.imul(k, 0x9e3779b9)) >>> 0);
    return new Rng(sm() ^ this.s1, sm() ^ this.s2, sm() ^ this.s3, sm() ^ k);
  }

  /** Uniform uint32. */
  nextUint32(): number {
    const result = (Math.imul(rotl(Math.imul(this.s1, 5) >>> 0, 7), 9)) >>> 0;
    const t = (this.s1 << 9) >>> 0;
    this.s2 ^= this.s0;
    this.s3 ^= this.s1;
    this.s1 ^= this.s2;
    this.s0 ^= this.s3;
    this.s2 ^= t;
    this.s3 = rotl(this.s3, 11);
    return result;
  }

  /** Uniform float in [0, 1) with exactly 32 bits of entropy (f64-exact, deterministic). */
  nextFloat(): number {
    return this.nextUint32() / 0x1_0000_0000;
  }

  /** Uniform integer in [min, max] inclusive, bias-free via rejection sampling. */
  int(min: number, max: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
      throw new RangeError(`Rng.int: invalid range [${min}, ${max}]`);
    }
    const span = max - min + 1;
    if (span > 0x1_0000_0000) throw new RangeError('Rng.int: range exceeds 2^32');
    if (span === 0x1_0000_0000) return min + this.nextUint32();
    const limit = 0x1_0000_0000 - (0x1_0000_0000 % span);
    let x = this.nextUint32();
    while (x >= limit) x = this.nextUint32();
    return min + (x % span);
  }

  /** Bernoulli trial. */
  chance(p: number): boolean {
    return this.nextFloat() < p;
  }

  /** Uniform pick from a non-empty array. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError('Rng.pick: empty array');
    return items[this.int(0, items.length - 1)] as T;
  }

  /** Weighted pick; weights must be non-negative and sum > 0. */
  pickWeighted<T>(items: readonly T[], weights: readonly number[]): T {
    if (items.length === 0 || items.length !== weights.length) {
      throw new RangeError('Rng.pickWeighted: bad arguments');
    }
    let total = 0;
    for (const w of weights) {
      if (!(w >= 0)) throw new RangeError('Rng.pickWeighted: negative or NaN weight');
      total += w;
    }
    if (total <= 0) throw new RangeError('Rng.pickWeighted: zero total weight');
    let r = this.nextFloat() * total;
    for (let i = 0; i < items.length; i++) {
      r -= weights[i] as number;
      if (r < 0) return items[i] as T;
    }
    return items[items.length - 1] as T; // float edge
  }

  /** In-place Fisher–Yates shuffle. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      const tmp = items[i] as T;
      items[i] = items[j] as T;
      items[j] = tmp;
    }
    return items;
  }
}
