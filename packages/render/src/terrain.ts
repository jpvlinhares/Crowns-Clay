/**
 * TerrainView + ChunkTracker (roadmap M8; TDD §7 layer 1).
 *
 * TerrainView resolves per-tile colors from the TerrainSnapshot: def palette
 * base↔accent blended by a deterministic variant hash (subtle texture without
 * assets), rivers/lakes overriding from overlay defs.
 *
 * ChunkTracker is the PURE bookkeeping of the chunk cache — which chunks must
 * exist for a camera rect, which are dirty and need a rebake, which to prune.
 * The Pixi shell executes its verdicts; correctness (the M8 test objective:
 * "dirty-chunk rebake correctness") is proven here, headlessly.
 */
import type { TerrainSnapshot } from '@crowns/protocol';
import { chunkKey, visibleChunks, CHUNK_TILES, type WorldRect } from './core.js';

// deterministic per-tile variant (mirror of sim's tileVariant; render-local copy
// keeps the presentation packages off @crowns/sim per TDD §3 boundaries)
function variant01(x: number, y: number): number {
  let h = (Math.imul(x | 0, 0x9e3779b1) ^ Math.imul(y | 0, 0x85ebca77)) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x2c1b3c6d);
  h = h ^ (h >>> 15);
  return (h >>> 0) / 0x1_0000_0000;
}

function blend(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  return (
    ((ar + (br - ar) * t) << 16) |
    (((ag + (bg - ag) * t) | 0) << 8) |
    ((ab + (bb - ab) * t) | 0)
  ) >>> 0;
}

export class TerrainView {
  constructor(private readonly terrain: TerrainSnapshot) {}

  get width(): number {
    return this.terrain.width;
  }
  get height(): number {
    return this.terrain.height;
  }

  colorAt(x: number, y: number): number {
    const i = y * this.terrain.width + x;
    const river = this.terrain.river[i] as number;
    if (river === 1) return this.terrain.riverColor;
    if (river === 2) return this.terrain.lakeColor;
    const code = this.terrain.biome[i] as number;
    const entry = this.terrain.palette[code];
    if (entry === undefined) return 0xff00ff; // unmapped code: loud magenta
    return blend(entry.base, entry.accent, variant01(x, y));
  }

  nameAt(x: number, y: number): string {
    const code = this.terrain.biome[y * this.terrain.width + x] as number;
    return this.terrain.palette[code]?.name ?? `biome ${code}`;
  }
}

// ---------------------------------------------------------------- tracker

export interface ChunkPlan {
  /** Chunks to bake this frame: absent-but-needed, or present-but-dirty. */
  readonly bake: number[];
  /** Visibility verdict for every cached chunk. */
  readonly show: number[];
  readonly hide: number[];
  /** Chunks to destroy (cache over budget, not currently needed). */
  readonly evict: number[];
}

export class ChunkTracker {
  private readonly cached = new Set<number>();
  private readonly dirty = new Set<number>();

  constructor(
    private readonly widthTiles: number,
    private readonly heightTiles: number,
    private readonly maxCached = 512,
  ) {}

  /** Mark one tile's chunk as needing a rebake (terrain changed under it). */
  invalidateTile(x: number, y: number): void {
    if (x < 0 || y < 0 || x >= this.widthTiles || y >= this.heightTiles) return;
    const key = chunkKey(Math.floor(x / CHUNK_TILES), Math.floor(y / CHUNK_TILES));
    if (this.cached.has(key)) this.dirty.add(key);
    // not cached → nothing to do: it will bake fresh when first needed
  }

  invalidateAll(): void {
    for (const key of this.cached) this.dirty.add(key);
  }

  /** One frame's verdicts for a camera rect. Mutates internal cache state. */
  plan(rect: WorldRect): ChunkPlan {
    const range = visibleChunks(rect, this.widthTiles, this.heightTiles);
    const needed = new Set<number>();
    const bake: number[] = [];
    for (let cy = range.cy0; cy <= range.cy1; cy++) {
      for (let cx = range.cx0; cx <= range.cx1; cx++) {
        const key = chunkKey(cx, cy);
        needed.add(key);
        if (!this.cached.has(key)) {
          this.cached.add(key);
          bake.push(key);
        } else if (this.dirty.has(key)) {
          this.dirty.delete(key);
          bake.push(key);
        }
      }
    }
    const show: number[] = [];
    const hide: number[] = [];
    for (const key of this.cached) (needed.has(key) ? show : hide).push(key);

    const evict: number[] = [];
    if (this.cached.size > this.maxCached) {
      for (const key of this.cached) {
        if (needed.has(key)) continue;
        evict.push(key);
        this.cached.delete(key);
        this.dirty.delete(key);
        if (this.cached.size <= this.maxCached) break;
      }
    }
    return { bake, show, hide, evict };
  }

  get cachedCount(): number {
    return this.cached.size;
  }
  get dirtyCount(): number {
    return this.dirty.size;
  }
}
