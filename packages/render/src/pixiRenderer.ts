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
const INK = 0x1a1409; // dark outline/detail ink shared by building glyphs
const HIGHLIGHT = 0xf0e2b0; // light accent (flags, details)

/** Multiply each RGB channel by `f` (f<1 darkens, f>1 lightens). */
function shade(color: number, f: number): number {
  const r = Math.min(255, Math.round(((color >> 16) & 0xff) * f));
  const g = Math.min(255, Math.round(((color >> 8) & 0xff) * f));
  const b = Math.min(255, Math.round((color & 0xff) * f));
  return (r << 16) | (g << 8) | b;
}

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
  // planned placements (pause-time): client-only "blueprint" ghosts for buildings placed while
  // the sim is frozen — the real building can't commit until a tick runs (that would break
  // determinism), so we draw the intent here and swap it for the sim's building on resume.
  private readonly plannedLayer = new Container();
  private readonly plannedGhosts = new Map<string, Graphics>();
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
  // footprint preview (building placement): a single outline-only Graphics that
  // follows the cursor; topmost so it reads over everything, terrain still visible.
  private readonly previewLayer = new Container();
  private readonly previewGraphic = new Graphics();

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

  /** M-era: keeps the cached rec's `paused` flag current so the inspector (buildingRec) reflects
   * it. No sprite redraw — pausing has no map-visual today, only inspector/panel state. */
  updateBuildingPaused(id: number, paused: boolean): void {
    const entry = this.buildingSprites.get(id);
    if (entry === undefined) return;
    entry.rec = { ...entry.rec, paused };
  }

  removeBuilding(id: number): void {
    const entry = this.buildingSprites.get(id);
    if (entry === undefined) return;
    this.buildingLayer.removeChild(entry.g);
    entry.g.destroy();
    this.buildingSprites.delete(id);
  }

  // ---------- planned placements (pause-time blueprint ghosts) ----------

  /**
   * Draw a translucent "blueprint" ghost for a building placed while the sim is paused —
   * the placement is committed as a queued command but can't appear in the sim until a tick
   * runs, so this shows the intent (at 0% progress) without any construction actually advancing.
   * Keyed by origin tile; a second placement on the same tile is a no-op. Cleared on resume
   * (clearPlanned), once the sim's real buildings take over.
   */
  addPlanned(x: number, y: number, w: number, h: number, category: string): void {
    const key = `${x},${y}`;
    if (this.plannedGhosts.has(key)) return;
    const color = CATEGORY_COLORS[category] ?? 0xcccccc;
    const g = new Graphics();
    const pw = w * TILE_PX;
    const ph = h * TILE_PX;
    // faint footprint plate + a blueprint-blue dashed-feel outline so it reads as "planned",
    // distinct from a real under-construction building (which is category-tinted and opaquer)
    g.roundRect(1, 1, pw - 2, ph - 2, 2).fill({ color: shade(color, 0.55), alpha: 0.22 });
    g.roundRect(1, 1, pw - 2, ph - 2, 2).stroke({ color: 0x6aa9ff, width: 1.5, alpha: 0.85 });
    drawBuildingIcon(g, category, pw, ph, color, 0.35);
    g.x = x * TILE_PX;
    g.y = y * TILE_PX;
    this.plannedLayer.addChild(g);
    this.plannedGhosts.set(key, g);
  }

  /** Cancel one planned ghost by origin-tile key (the player clicked it while paused). */
  removePlanned(key: string): void {
    const g = this.plannedGhosts.get(key);
    if (g === undefined) return;
    this.plannedLayer.removeChild(g);
    g.destroy();
    this.plannedGhosts.delete(key);
  }

  /** Drop every planned ghost (called on resume, after the sim's real buildings have landed). */
  clearPlanned(): void {
    for (const g of this.plannedGhosts.values()) {
      this.plannedLayer.removeChild(g);
      g.destroy();
    }
    this.plannedGhosts.clear();
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
    const built = rec.progress >= 1;
    const alpha = built ? 1 : 0.4;
    g.clear();
    // footprint plate: a shaded ground tile the icon sits on (translucent while building)
    g.roundRect(1, 1, w - 2, h - 2, 2).fill({ color: shade(color, 0.55), alpha: alpha * 0.9 });
    g.roundRect(1, 1, w - 2, h - 2, 2).stroke({ color: INK, width: 1.2, alpha });
    drawBuildingIcon(g, rec.category, w, h, color, alpha);
    if (!built) {
      // construction bar along the bottom edge
      g.rect(2, h - 3, (w - 4) * rec.progress, 2).fill(HIGHLIGHT);
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
    this.worldLayer.addChild(this.plannedLayer); // pause-time placement ghosts, over real buildings
    this.worldLayer.addChild(this.entityLayer);
    this.worldLayer.addChild(this.fogLayer); // topmost — obscures everything unrevealed
    this.previewLayer.addChild(this.previewGraphic);
    this.previewLayer.visible = false;
    this.worldLayer.addChild(this.previewLayer); // above fog — placement guide is always visible
    this.app.stage.addChild(this.worldLayer);
    return this.app.canvas;
  }

  resize(w: number, h: number): void {
    this.camera.setViewport(w, h);
  }

  /** Open the camera centred on a tile (e.g. the player's starting village). */
  centerOnTile(tileX: number, tileY: number): void {
    this.camera.centerOn((tileX + 0.5) * TILE_PX, (tileY + 0.5) * TILE_PX);
  }

  /**
   * Footprint placement preview (building placement mode): draw ONLY the outline of a
   * `w`×`h` footprint anchored at tile (x, y) — every occupied tile bordered, plus a
   * bolder outer boundary — tinted green when placement is valid, red when not. No fill,
   * so the terrain stays fully visible. Generic: any footprint size, any (modded) def.
   */
  showFootprintPreview(x: number, y: number, w: number, h: number, valid: boolean): void {
    const color = valid ? 0x54d15a : 0xe25555;
    const g = this.previewGraphic;
    g.clear();
    // per-tile grid so each occupied cell is unambiguous
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        g.rect((x + dx) * TILE_PX, (y + dy) * TILE_PX, TILE_PX, TILE_PX);
      }
    }
    g.stroke({ color, width: 1, alpha: 0.65 });
    // bolder outer boundary
    g.rect(x * TILE_PX, y * TILE_PX, w * TILE_PX, h * TILE_PX).stroke({ color, width: 2.5, alpha: 0.95 });
    this.previewLayer.visible = true;
  }

  /** Leave building placement mode: remove the footprint outline. */
  hideFootprintPreview(): void {
    this.previewLayer.visible = false;
    this.previewGraphic.clear();
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
        // a little person silhouette (round head + tapered body) reads as a
        // character far better than the old bare dot — see doc 10 §asset placeholders
        const color = ENTITY_COLORS[e.id % ENTITY_COLORS.length] as number;
        const s = TILE_PX * 0.44;
        dot
          .poly([-s * 0.62, s * 0.85, 0, -s * 0.05, s * 0.62, s * 0.85])
          .fill(color)
          .stroke({ color: INK, width: 1.2 });
        dot
          .circle(0, -s * 0.55, s * 0.42)
          .fill(color)
          .stroke({ color: INK, width: 1.2 });
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

/**
 * Draw a simple, category-distinct glyph centred in a building footprint, so a
 * keep, a cottage, a market, a silo, a barn and a watchtower are all legible at
 * a glance instead of six identically-shaped coloured blocks. Vector-only (no
 * asset bank) — the placeholder-art strategy of doc 10 §3, one tier up from the
 * old flat rectangle. All shapes derive from the footprint (w, h) so they scale
 * with any building size.
 */
function drawBuildingIcon(g: Graphics, category: string, w: number, h: number, color: number, alpha: number): void {
  const light = shade(color, 1.3);
  const dark = shade(color, 0.75);
  const pad = Math.max(1.5, Math.min(w, h) * 0.13);
  const x0 = pad;
  const y0 = pad;
  const iw = w - pad * 2;
  const ih = h - pad * 2;
  const cx = w / 2;
  const f = (c: number) => ({ color: c, alpha });
  const line = (x1: number, y1: number, x2: number, y2: number, wd: number) =>
    g.moveTo(x1, y1).lineTo(x2, y2).stroke({ color: INK, width: wd, alpha });

  switch (category) {
    case 'housing': {
      // cottage: peaked roof, walls, a dark door
      const roofH = ih * 0.44;
      const by = y0 + roofH;
      const bh = ih - roofH;
      g.poly([x0, by, cx, y0, x0 + iw, by]).fill(f(dark));
      g.rect(x0 + iw * 0.14, by, iw * 0.72, bh).fill(f(light));
      g.rect(cx - iw * 0.11, by + bh * 0.42, iw * 0.22, bh * 0.58).fill(f(INK));
      break;
    }
    case 'civic': {
      // keep / town hall: crenellated block, arched door, a pennant on a mast
      const by = y0 + ih * 0.34;
      const bw = iw * 0.62;
      const bx = cx - bw / 2;
      g.rect(bx, by, bw, y0 + ih - by).fill(f(light));
      const merlon = bw / 5;
      for (let i = 0; i < 5; i += 2) g.rect(bx + i * merlon, by - ih * 0.13, merlon, ih * 0.13).fill(f(light));
      g.rect(cx - iw * 0.09, by + ih * 0.26, iw * 0.18, ih * 0.4).fill(f(INK));
      line(cx, y0, cx, by - ih * 0.13, 1); // mast
      g.poly([cx, y0, cx + iw * 0.24, y0 + ih * 0.08, cx, y0 + ih * 0.16]).fill(f(HIGHLIGHT)); // pennant
      break;
    }
    case 'service': {
      // market stall: a striped awning over a counter on two posts
      const awH = ih * 0.34;
      g.rect(x0 + iw * 0.08, y0 + awH, iw * 0.06, ih - awH).fill(f(dark)); // left post
      g.rect(x0 + iw * 0.86, y0 + awH, iw * 0.06, ih - awH).fill(f(dark)); // right post
      g.rect(x0, y0 + ih * 0.62, iw, ih * 0.2).fill(f(light)); // counter
      g.poly([x0, y0 + awH, cx, y0, x0 + iw, y0 + awH]).fill(f(light)); // awning
      for (let i = 0; i < 4; i++) line(x0 + iw * (0.2 + i * 0.2), y0 + awH * 0.55, x0 + iw * (0.2 + i * 0.2), y0 + awH, 1);
      break;
    }
    case 'storage': {
      // granary / silo: a rounded body with binding hoops and a small cap
      const bx = cx - iw * 0.32;
      const bw = iw * 0.64;
      g.poly([cx - iw * 0.4, y0 + ih * 0.24, cx, y0, cx + iw * 0.4, y0 + ih * 0.24]).fill(f(dark)); // cap
      g.roundRect(bx, y0 + ih * 0.22, bw, ih * 0.78, Math.min(bw, ih) * 0.18).fill(f(light)); // body
      line(bx, y0 + ih * 0.46, bx + bw, y0 + ih * 0.46, 1);
      line(bx, y0 + ih * 0.72, bx + bw, y0 + ih * 0.72, 1);
      break;
    }
    case 'production': {
      // barn / workshop: wide gambrel roof + a cross-braced door
      const roofH = ih * 0.36;
      const by = y0 + roofH;
      g.poly([x0, by, x0 + iw * 0.2, y0, x0 + iw * 0.8, y0, x0 + iw, by]).fill(f(dark)); // roof
      g.rect(x0 + iw * 0.06, by, iw * 0.88, ih - roofH).fill(f(light)); // walls
      const dx = cx - iw * 0.16;
      const dw = iw * 0.32;
      const dy = by + (ih - roofH) * 0.28;
      const dh = (ih - roofH) * 0.72;
      g.rect(dx, dy, dw, dh).fill(f(dark)); // door
      line(dx, dy, dx + dw, dy + dh, 1); // brace
      line(dx + dw, dy, dx, dy + dh, 1);
      break;
    }
    case 'military': {
      // watchtower: tall crenellated tower with a shield device
      const bw = iw * 0.5;
      const bx = cx - bw / 2;
      const by = y0 + ih * 0.2;
      g.rect(bx, by, bw, y0 + ih - by).fill(f(light));
      const merlon = bw / 5;
      for (let i = 0; i < 5; i += 2) g.rect(bx + i * merlon, by - ih * 0.12, merlon, ih * 0.12).fill(f(light));
      // shield
      const sw = iw * 0.26;
      const sy = by + ih * 0.24;
      g.poly([cx - sw / 2, sy, cx + sw / 2, sy, cx + sw / 2, sy + ih * 0.16, cx, sy + ih * 0.34, cx - sw / 2, sy + ih * 0.16])
        .fill(f(HIGHLIGHT))
        .stroke({ color: INK, width: 1, alpha });
      break;
    }
    default: {
      g.circle(cx, h / 2, Math.min(iw, ih) * 0.32).fill(f(light));
    }
  }
}
