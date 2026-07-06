/**
 * Deterministic 2D noise for worldgen (GDD §13; Engine §6).
 *
 * Coordinate-hashed value noise + fBm: every sample is a pure function of
 * (seed, x, y) with 32-bit integer mixing only — no sequential PRNG draws, so
 * sampling order is irrelevant and stages can evaluate lazily or in parallel
 * without determinism risk (TDD §5).
 */

/** Integer lattice hash → [0, 1). Stable across engines (imul/xor/shift only). */
export function hash01(seed: number, x: number, y: number): number {
  let h = (seed ^ Math.imul(x | 0, 0x9e3779b1) ^ Math.imul(y | 0, 0x85ebca77)) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h = h ^ (h >>> 15);
  return (h >>> 0) / 0x1_0000_0000;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t); // smoothstep
}

/** Bilinear-smoothed value noise over the integer lattice → [0, 1). */
export function valueNoise(seed: number, x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const v00 = hash01(seed, x0, y0);
  const v10 = hash01(seed, x0 + 1, y0);
  const v01 = hash01(seed, x0, y0 + 1);
  const v11 = hash01(seed, x0 + 1, y0 + 1);
  const top = v00 + (v10 - v00) * fx;
  const bottom = v01 + (v11 - v01) * fx;
  return top + (bottom - top) * fy;
}

/** Fractal Brownian motion: `octaves` layers of value noise → [0, 1). */
export function fbm(
  seed: number,
  x: number,
  y: number,
  octaves: number,
  lacunarity = 2,
  gain = 0.5,
): number {
  let amplitude = 1;
  let frequency = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise((seed + o * 0x1013) | 0, x * frequency, y * frequency) * amplitude;
    norm += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return sum / norm;
}
