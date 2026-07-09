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
  FOG_UNREVEALED_ALPHA,
  PresentationMirror,
  TILE_PX,
  chunkKey,
  kingdomColor,
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
  private readonly roadLayer = new Container();
  private readonly roadTiles = new Set<number>();
  private readonly scratch: RenderableEntity[] = [];
  // territory tint (M22): flat [x, y, kingdomIndex] triples, add-only (mirrors roads)
  private readonly territoryLayer = new Container();
  private readonly territoryTiles = new Set<number>();
  // fog of information (M22): dark overlay per chunk, punched out per revealed tile.
  // Inactive until addFogRevealed() is actually called — a composition that never reports
  // fog data (e.g. the single-kingdom terra-demo session) must render normally, not as an
  // all-dark map with nothing ever revealed.
  private readonly fogLayer = new Container();
  private readonly fogGraphics = new Map<number, Graphics>();
  private readonly revealedTiles = new Set<number>();
  private fogActive = false;

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

  // ---------- road layer (M14): flat [x, y, level] triples, add-only ----------

  addRoads(triples: readonly number[]): void {
    for (let i = 0; i + 2 < triples.length; i += 3) {
      const x = triples[i] as number;
      const y = triples[i + 1] as number;
      const tile = y * this.widthTiles + x;
      if (this.roadTiles.has(tile)) continue;
      this.roadTiles.add(tile);
      const g = new Graphics();
      // packed-earth track: a dusty plate with a worn center line
      g.rect(0, 0, TILE_PX, TILE_PX).fill({ color: 0x9a7d52, alpha: 0.55 });
      g.rect(TILE_PX * 0.3, TILE_PX * 0.3, TILE_PX * 0.4, TILE_PX * 0.4).fill({ color: 0x82683f, alpha: 0.7 });
      g.x = x * TILE_PX;
      g.y = y * TILE_PX;
      this.roadLayer.addChild(g);
    }
  }

  setRoads(triples: readonly number[]): void {
    this.roadLayer.removeChildren().forEach((child) => child.destroy());
    this.roadTiles.clear();
    this.addRoads(triples);
  }

  // ---------- territory layer (M22): flat [x, y, kingdomIndex] triples, add-only ----------

  addTerritory(triples: readonly number[]): void {
    for (let i = 0; i + 2 < triples.length; i += 3) {
      const x = triples[i] as number;
      const y = triples[i + 1] as number;
      const kingdomIndex = triples[i + 2] as number;
      const tile = y * this.widthTiles + x;
      if (this.territoryTiles.has(tile)) continue;
      this.territoryTiles.add(tile);
      const g = new Graphics();
      g.rect(0, 0, TILE_PX, TILE_PX).fill({ color: kingdomColor(kingdomIndex), alpha: 0.22 });
      g.x = x * TILE_PX;
      g.y = y * TILE_PX;
      this.territoryLayer.addChild(g);
    }
  }

  setTerritory(triples: readonly number[]): void {
    this.territoryLayer.removeChildren().forEach((child) => child.destroy());
    this.territoryTiles.clear();
    this.addTerritory(triples);
  }

  // ---------- fog-of-information layer (M22): flat [x, y] pairs, add-only reveal ----------

  /** Marks tiles as revealed (never re-hidden in this MVP) and re-bakes any affected chunk.
   * The first call activates the fog layer for every currently-visible chunk too — before
   * this, the layer stays inactive (see `fogActive`), so a composition with no fog data
   * (e.g. single-kingdom terra-demo) never shows an all-dark map. */
  addFogRevealed(pairs: readonly number[]): void {
    if (pairs.length === 0) return;
    const activating = !this.fogActive;
    this.fogActive = true;
    const affectedChunks = new Set<number>();
    for (let i = 0; i + 1 < pairs.length; i += 2) {
      const x = pairs[i] as number;
      const y = pairs[i + 1] as number;
      this.revealedTiles.add(y * this.widthTiles + x);
      affectedChunks.add(chunkKey(Math.floor(x / CHUNK_TILES), Math.floor(y / CHUNK_TILES)));
    }
    if (activating) {
      // bake fog for every terrain chunk already on screen, not just the ones just revealed
      for (const key of this.chunkGraphics.keys()) this.bakeFogChunk(key);
    } else {
      for (const key of affectedChunks) {
        if (this.fogGraphics.has(key)) this.bakeFogChunk(key);
      }
    }
  }

  /** Last-known record for a building sprite (M18 player inspector join). */
  buildingRec(id: number): BuildingRec | null {
    return this.buildingSprites.get(id)?.rec ?? null;
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

  async init(resizeTo: HTMLElement | Window): Promise<HTMLCanvasElement> {
    await this.app.init({ background: 0x14120f, resizeTo, antialias: false });
    this.worldLayer.addChild(this.terrainLayer);
    this.worldLayer.addChild(this.territoryLayer); // tint, over terrain, under roads
    this.worldLayer.addChild(this.roadLayer); // under buildings, over terrain
    this.worldLayer.addChild(this.buildingLayer);
    this.worldLayer.addChild(this.entityLayer);
    this.worldLayer.addChild(this.fogLayer); // topmost — obscures everything unrevealed
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
    for (const key of plan.bake) {
      this.bakeChunk(key);
      if (this.fogActive) this.bakeFogChunk(key); // fog is keyed identically to terrain chunks
    }
    for (const key of plan.show) {
      const g = this.chunkGraphics.get(key);
      if (g !== undefined) g.visible = true;
      const fg = this.fogGraphics.get(key);
      if (fg !== undefined) fg.visible = true;
    }
    for (const key of plan.hide) {
      const g = this.chunkGraphics.get(key);
      if (g !== undefined) g.visible = false;
      const fg = this.fogGraphics.get(key);
      if (fg !== undefined) fg.visible = false;
    }
    for (const key of plan.evict) {
      const g = this.chunkGraphics.get(key);
      if (g !== undefined) {
        this.terrainLayer.removeChild(g);
        g.destroy();
        this.chunkGraphics.delete(key);
      }
      const fg = this.fogGraphics.get(key);
      if (fg !== undefined) {
        this.fogLayer.removeChild(fg);
        fg.destroy();
        this.fogGraphics.delete(key);
      }
    }
  }

  /** (Re)draw one chunk's fog overlay: a dark rect per tile not yet in `revealedTiles`. */
  private bakeFogChunk(key: number): void {
    const cx = key % 4096;
    const cy = (key / 4096) | 0;
    let g = this.fogGraphics.get(key);
    if (g === undefined) {
      g = new Graphics();
      g.x = cx * CHUNK_PX;
      g.y = cy * CHUNK_PX;
      this.fogLayer.addChild(g);
      this.fogGraphics.set(key, g);
    } else {
      g.clear();
    }
    const tx0 = cx * CHUNK_TILES;
    const ty0 = cy * CHUNK_TILES;
    for (let ty = 0; ty < CHUNK_TILES; ty++) {
      const wy = ty0 + ty;
      if (wy >= this.heightTiles) break;
      for (let tx = 0; tx < CHUNK_TILES; tx++) {
        const wx = tx0 + tx;
        if (wx >= this.widthTiles) break;
        if (this.revealedTiles.has(wy * this.widthTiles + wx)) continue; // punched out
        g.rect(tx * TILE_PX, ty * TILE_PX, TILE_PX, TILE_PX).fill({ color: 0x000000, alpha: FOG_UNREVEALED_ALPHA });
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
