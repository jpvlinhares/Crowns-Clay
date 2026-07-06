/**
 * PixiJS shell around the pure render core (TDD §7). Layers:
 *   1. terrain  — one Graphics per chunk, drawn ONCE and cached; only chunks
 *                 intersecting the camera exist (lazy create + LRU-ish prune)
 *   2. entities — one Graphics dot per entity from the PresentationMirror
 *   3. overlay  — reserved (borders/routes, later milestones)
 * Camera transforms are applied to a single world container, so panning/zoom
 * costs O(visible chunks) bookkeeping, not O(tiles) — this is what makes the
 * 100k-tile pan target trivial to hold.
 */
import { Application, Container, Graphics } from 'pixi.js';
import {
  Camera2D,
  CHUNK_PX,
  CHUNK_TILES,
  PresentationMirror,
  TILE_PX,
  tileColor,
  type RenderableEntity,
} from './core.js';
import { ChunkTracker, TerrainView } from './terrain.js';
import type { BuildingRec } from '@crowns/protocol';

const ENTITY_COLORS = [0xe8d8a0, 0xd8b060, 0xc09048, 0xa8d0e0] as const;
const CATEGORY_COLORS: Record<string, number> = {
  civic: 0xb08a3e,
  housing: 0x9a6a4a,
  service: 0x6a8ab0,
  storage: 0x8a7a52,
  production: 0x7a9a5a,
  military: 0x9a5a5a,
};

export class PixiRenderer {
  readonly app = new Application();
  readonly camera: Camera2D;
  readonly mirror = new PresentationMirror();

  private readonly worldLayer = new Container();
  private readonly terrainLayer = new Container();
  private readonly entityLayer = new Container();
  private readonly chunkGraphics = new Map<number, Graphics>();
  private readonly tracker: ChunkTracker;
  private readonly entitySprites = new Map<number, Graphics>();
  private readonly buildingLayer = new Container();
  private readonly buildingSprites = new Map<number, { g: Graphics; rec: BuildingRec }>();
  private readonly scratch: RenderableEntity[] = [];

  constructor(
    private readonly widthTiles: number,
    private readonly heightTiles: number,
    viewportW: number,
    viewportH: number,
    /** Data-driven terrain (M8). Omitted → legacy hash-noise placeholder. */
    private readonly terrain: TerrainView | null = null,
  ) {
    this.camera = new Camera2D(viewportW, viewportH, widthTiles * TILE_PX, heightTiles * TILE_PX);
    this.tracker = new ChunkTracker(widthTiles, heightTiles);
  }

  /** Terrain changed under a tile (construction, seasons — later milestones). */
  invalidateTile(x: number, y: number): void {
    this.tracker.invalidateTile(x, y);
  }

  /** Nearest entity within `radiusPx` of a screen point, or null (M9 picking). */
  pickEntity(screenX: number, screenY: number, radiusPx = 14): number | null {
    let best: number | null = null;
    let bestDist = radiusPx * radiusPx;
    for (const e of this.mirror.view(1, this.scratch)) {
      const s = this.camera.worldToScreen((e.x + 0.5) * TILE_PX, (e.y + 0.5) * TILE_PX);
      const dx = s.x - screenX;
      const dy = s.y - screenY;
      const d = dx * dx + dy * dy;
      if (d < bestDist) {
        bestDist = d;
        best = e.id;
      }
    }
    return best;
  }

  /** Screen point → tile coordinates (clamped check left to callers). */
  tileAt(screenX: number, screenY: number): { x: number; y: number } {
    const w = this.camera.screenToWorld(screenX, screenY);
    return { x: Math.floor(w.x / TILE_PX), y: Math.floor(w.y / TILE_PX) };
  }

  stats(): { chunksCached: number; entitySprites: number; buildings: number } {
    return {
      chunksCached: this.tracker.cachedCount,
      entitySprites: this.entitySprites.size,
      buildings: this.buildingSprites.size,
    };
  }

  // ---------- building layer (M11): rare adds/removes, alpha = construction ----------

  setBuildings(records: readonly BuildingRec[]): void {
    for (const { g } of this.buildingSprites.values()) {
      this.buildingLayer.removeChild(g);
      g.destroy();
    }
    this.buildingSprites.clear();
    for (const rec of records) this.addBuilding(rec);
  }

  addBuilding(rec: BuildingRec): void {
    const g = new Graphics();
    this.drawBuilding(g, rec);
    g.x = rec.x * TILE_PX;
    g.y = rec.y * TILE_PX;
    this.buildingLayer.addChild(g);
    this.buildingSprites.set(rec.id, { g, rec });
  }

  updateBuildingProgress(id: number, progress: number): void {
    const entry = this.buildingSprites.get(id);
    if (entry === undefined) return;
    entry.rec = { ...entry.rec, progress };
    this.drawBuilding(entry.g, entry.rec);
  }

  removeBuilding(id: number): void {
    const entry = this.buildingSprites.get(id);
    if (entry === undefined) return;
    this.buildingLayer.removeChild(entry.g);
    entry.g.destroy();
    this.buildingSprites.delete(id);
  }

  /** Screen point → building id (footprint hit-test), or null. */
  pickBuilding(screenX: number, screenY: number): number | null {
    const t = this.tileAt(screenX, screenY);
    for (const [id, { rec }] of this.buildingSprites) {
      if (t.x >= rec.x && t.x < rec.x + rec.w && t.y >= rec.y && t.y < rec.y + rec.h) return id;
    }
    return null;
  }

  private drawBuilding(g: Graphics, rec: BuildingRec): void {
    const color = CATEGORY_COLORS[rec.category] ?? 0xcccccc;
    const w = rec.w * TILE_PX;
    const h = rec.h * TILE_PX;
    g.clear();
    // footprint plate: translucent while under construction, solid when done
    g.rect(1, 1, w - 2, h - 2).fill({ color, alpha: rec.progress >= 1 ? 1 : 0.35 });
    g.rect(1, 1, w - 2, h - 2).stroke({ color: 0x201808, width: 1.5 });
    if (rec.progress < 1) {
      // construction bar along the bottom edge
      g.rect(2, h - 4, (w - 4) * rec.progress, 2).fill(0xe8d8a0);
    }
  }

  terrainNameAt(tileX: number, tileY: number): string | null {
    if (this.terrain === null) return null;
    if (tileX < 0 || tileY < 0 || tileX >= this.terrain.width || tileY >= this.terrain.height) return null;
    return this.terrain.nameAt(tileX, tileY);
  }

  async init(resizeTo: unknown): Promise<HTMLCanvasElement> {
    await this.app.init({ background: 0x14120f, resizeTo, antialias: false });
    this.worldLayer.addChild(this.terrainLayer);
    this.worldLayer.addChild(this.buildingLayer);
    this.worldLayer.addChild(this.entityLayer);
    this.app.stage.addChild(this.worldLayer);
    return this.app.canvas;
  }

  resize(w: number, h: number): void {
    this.camera.setViewport(w, h);
  }

  /** Per-frame: cull/create chunks, place entity dots, apply camera transform. */
  render(alpha: number): void {
    this.syncChunks();
    this.syncEntities(alpha);
    const topLeft = this.camera.visibleRect();
    this.worldLayer.scale.set(this.camera.zoom);
    this.worldLayer.x = -topLeft.x * this.camera.zoom;
    this.worldLayer.y = -topLeft.y * this.camera.zoom;
  }

  /** Execute the ChunkTracker's verdicts (bake/show/hide/evict — terrain.ts). */
  private syncChunks(): void {
    const plan = this.tracker.plan(this.camera.visibleRect());
    for (const key of plan.bake) this.bakeChunk(key);
    for (const key of plan.show) {
      const g = this.chunkGraphics.get(key);
      if (g !== undefined) g.visible = true;
    }
    for (const key of plan.hide) {
      const g = this.chunkGraphics.get(key);
      if (g !== undefined) g.visible = false;
    }
    for (const key of plan.evict) {
      const g = this.chunkGraphics.get(key);
      if (g !== undefined) {
        this.terrainLayer.removeChild(g);
        g.destroy();
        this.chunkGraphics.delete(key);
      }
    }
  }

  /** (Re)draw one chunk; afterwards it's a cached display object. */
  private bakeChunk(key: number): void {
    const cx = key % 4096;
    const cy = (key / 4096) | 0;
    let g = this.chunkGraphics.get(key);
    if (g === undefined) {
      g = new Graphics();
      g.x = cx * CHUNK_PX;
      g.y = cy * CHUNK_PX;
      this.terrainLayer.addChild(g);
      this.chunkGraphics.set(key, g);
    } else {
      g.clear(); // dirty rebake: redraw in place
    }
    const tx0 = cx * CHUNK_TILES;
    const ty0 = cy * CHUNK_TILES;
    for (let ty = 0; ty < CHUNK_TILES; ty++) {
      const wy = ty0 + ty;
      if (wy >= this.heightTiles) break;
      for (let tx = 0; tx < CHUNK_TILES; tx++) {
        const wx = tx0 + tx;
        if (wx >= this.widthTiles) break;
        const color = this.terrain !== null ? this.terrain.colorAt(wx, wy) : tileColor(wx, wy);
        g.rect(tx * TILE_PX, ty * TILE_PX, TILE_PX, TILE_PX).fill(color);
      }
    }
  }

  private syncEntities(alpha: number): void {
    const view = this.mirror.view(alpha, this.scratch);
    const seen = new Set<number>();
    for (const e of view) {
      seen.add(e.id);
      let dot = this.entitySprites.get(e.id);
      if (dot === undefined) {
        dot = new Graphics();
        dot
          .circle(0, 0, TILE_PX * 0.35)
          .fill(ENTITY_COLORS[e.id % ENTITY_COLORS.length] as number)
          .stroke({ color: 0x201808, width: 1.5 });
        this.entitySprites.set(e.id, dot);
        this.entityLayer.addChild(dot);
      }
      dot.x = (e.x + 0.5) * TILE_PX;
      dot.y = (e.y + 0.5) * TILE_PX;
    }
    for (const [id, dot] of this.entitySprites) {
      if (!seen.has(id)) {
        this.entityLayer.removeChild(dot);
        dot.destroy();
        this.entitySprites.delete(id);
      }
    }
  }
}
