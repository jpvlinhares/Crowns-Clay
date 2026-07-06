/**
 * Render core — the PURE half of the renderer (roadmap M6; TDD §7).
 * Camera math, chunk visibility, the snapshot→presentation mirror, and the
 * placeholder tile field are all DOM-free and fully unit-tested headlessly;
 * pixiRenderer.ts is the thin WebGL shell around them.
 */
import { fnv1a32, clamp } from '@crowns/core';
import type { EntityRec } from '@crowns/protocol';

// ---------------------------------------------------------------- constants

export const TILE_PX = 16; // world pixels per tile at zoom 1
export const CHUNK_TILES = 32; // tiles per chunk edge (TDD §7 layer 1)
export const CHUNK_PX = TILE_PX * CHUNK_TILES;

// ---------------------------------------------------------------- camera

export interface WorldRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * 2D camera over world pixels. (x, y) is the world point at the viewport
 * center; zoom is screen px per world px. Deterministic, side-effect-free.
 */
export class Camera2D {
  x: number;
  y: number;
  zoom = 1;

  constructor(
    public viewportW: number,
    public viewportH: number,
    public readonly worldW: number,
    public readonly worldH: number,
    public readonly minZoom = 0.25,
    public readonly maxZoom = 4,
  ) {
    this.x = worldW / 2;
    this.y = worldH / 2;
    this.clampToWorld();
  }

  setViewport(w: number, h: number): void {
    this.viewportW = w;
    this.viewportH = h;
    this.clampToWorld();
  }

  /** Pan by a screen-space delta (drag): world delta shrinks as zoom grows. */
  pan(dxScreen: number, dyScreen: number): void {
    this.x -= dxScreen / this.zoom;
    this.y -= dyScreen / this.zoom;
    this.clampToWorld();
  }

  /** Zoom by `factor`, keeping the world point under (screenX, screenY) fixed. */
  zoomAt(screenX: number, screenY: number, factor: number): void {
    const before = this.screenToWorld(screenX, screenY);
    this.zoom = clamp(this.zoom * factor, this.minZoom, this.maxZoom);
    const after = this.screenToWorld(screenX, screenY);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
    this.clampToWorld();
  }

  screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    return {
      x: this.x + (screenX - this.viewportW / 2) / this.zoom,
      y: this.y + (screenY - this.viewportH / 2) / this.zoom,
    };
  }

  worldToScreen(worldX: number, worldY: number): { x: number; y: number } {
    return {
      x: (worldX - this.x) * this.zoom + this.viewportW / 2,
      y: (worldY - this.y) * this.zoom + this.viewportH / 2,
    };
  }

  /** World-space rectangle currently visible. */
  visibleRect(): WorldRect {
    const w = this.viewportW / this.zoom;
    const h = this.viewportH / this.zoom;
    return { x: this.x - w / 2, y: this.y - h / 2, w, h };
  }

  private clampToWorld(): void {
    // Keep the center inside the world; when zoomed out beyond the world size,
    // lock to world center on that axis (small maps sit centered, no jitter).
    const halfW = Math.min(this.viewportW / this.zoom, this.worldW) / 2;
    const halfH = Math.min(this.viewportH / this.zoom, this.worldH) / 2;
    this.x = this.worldW <= this.viewportW / this.zoom ? this.worldW / 2 : clamp(this.x, halfW, this.worldW - halfW);
    this.y = this.worldH <= this.viewportH / this.zoom ? this.worldH / 2 : clamp(this.y, halfH, this.worldH - halfH);
  }
}

// ---------------------------------------------------------------- chunks

export interface ChunkRange {
  readonly cx0: number;
  readonly cy0: number;
  readonly cx1: number; // inclusive
  readonly cy1: number;
}

/** Chunk indices intersecting a world rect, clamped to the map, with margin. */
export function visibleChunks(
  rect: WorldRect,
  mapWidthTiles: number,
  mapHeightTiles: number,
  marginChunks = 1,
): ChunkRange {
  const maxCx = Math.ceil(mapWidthTiles / CHUNK_TILES) - 1;
  const maxCy = Math.ceil(mapHeightTiles / CHUNK_TILES) - 1;
  return {
    cx0: clamp(Math.floor(rect.x / CHUNK_PX) - marginChunks, 0, maxCx),
    cy0: clamp(Math.floor(rect.y / CHUNK_PX) - marginChunks, 0, maxCy),
    cx1: clamp(Math.floor((rect.x + rect.w) / CHUNK_PX) + marginChunks, 0, maxCx),
    cy1: clamp(Math.floor((rect.y + rect.h) / CHUNK_PX) + marginChunks, 0, maxCy),
  };
}

export function chunkKey(cx: number, cy: number): number {
  return cy * 4096 + cx; // maps ≤ 4096 chunks/edge — far beyond doc 11 ceilings
}

// ---------------------------------------------------------------- tile field

/**
 * Placeholder terrain (replaced by real TerrainDefs at M8): a deterministic
 * hash-noise field over tile coordinates yielding a small medieval-ish palette.
 * Same (x, y) → same color, everywhere, forever — chunk baking depends on it.
 */
const PALETTE = [0x4f7d43, 0x577f3f, 0x5d8a48, 0x6b8f4e, 0x8a8f5a, 0x7d7a52] as const;
const WATER = 0x3a6a8a;

export function tileColor(x: number, y: number): number {
  const h = fnv1a32(`${x},${y}`);
  // sparse "lakes": ~4% of tiles, clustered by coarse cell
  const coarse = fnv1a32(`${x >> 3},${y >> 3}`);
  if (coarse % 25 === 0 && h % 3 !== 0) return WATER;
  return PALETTE[h % PALETTE.length] as number;
}

// ---------------------------------------------------------------- mirror

interface MirrorEntity {
  kind: number;
  prevX: number;
  prevY: number;
  curX: number;
  curY: number;
}

export interface RenderableEntity {
  readonly id: number;
  readonly kind: number;
  readonly x: number; // tile-space, interpolated
  readonly y: number;
}

/**
 * Presentation mirror (TDD §4): applies snapshot fulls/deltas from the sim and
 * serves interpolated positions to the renderer. Never authoritative.
 */
export class PresentationMirror {
  private readonly entities = new Map<number, MirrorEntity>();

  applyFull(records: readonly EntityRec[]): void {
    this.entities.clear();
    for (const r of records) {
      this.entities.set(r.id, { kind: r.kind, prevX: r.x, prevY: r.y, curX: r.x, curY: r.y });
    }
  }

  applyDelta(delta: {
    spawned: readonly EntityRec[];
    moved: readonly number[];
    despawned: readonly number[];
  }): void {
    // advance interpolation base: what was current becomes previous
    for (const e of this.entities.values()) {
      e.prevX = e.curX;
      e.prevY = e.curY;
    }
    for (const r of delta.spawned) {
      this.entities.set(r.id, { kind: r.kind, prevX: r.x, prevY: r.y, curX: r.x, curY: r.y });
    }
    for (let i = 0; i + 2 < delta.moved.length + 1; i += 3) {
      const e = this.entities.get(delta.moved[i] as number);
      if (e !== undefined) {
        e.curX = delta.moved[i + 1] as number;
        e.curY = delta.moved[i + 2] as number;
      }
    }
    for (const id of delta.despawned) this.entities.delete(id);
  }

  /** Interpolated view at alpha ∈ [0,1] between the last two sim states. */
  view(alpha: number, out: RenderableEntity[] = []): RenderableEntity[] {
    out.length = 0;
    const a = clamp(alpha, 0, 1);
    for (const [id, e] of this.entities) {
      out.push({
        id,
        kind: e.kind,
        x: e.prevX + (e.curX - e.prevX) * a,
        y: e.prevY + (e.curY - e.prevY) * a,
      });
    }
    return out;
  }

  get size(): number {
    return this.entities.size;
  }
}
