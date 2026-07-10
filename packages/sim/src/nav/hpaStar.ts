/**
 * Hierarchical pathfinding (roadmap M26; TDD §10; doc 11 §5, Risk R4).
 *
 * Haulers (logistics.ts) stay on flat 4-neighbour A* — village-radius searches
 * don't need more (that module's own comment says so). ARMIES range across
 * the whole map, so a naive A* per order would blow the pathfinding budget at
 * scale (200 armies, doc 12 M26 T objective). This is the "chunk-graph HPA* +
 * local A*" doc 03 §10 promises:
 *
 *   1. Partition the map into fixed CHUNK×CHUNK tiles. For every pair of
 *      orthogonally-adjacent chunks, scan their shared edge for contiguous
 *      passable-both-sides runs ("entrances"); the run's midpoint becomes a
 *      PORTAL — a pair of nodes, one tile per side, joined by a one-step edge.
 *   2. Within each chunk, cache the shortest path between every pair of its
 *      own portals via local A* BOUNDED to that chunk's tile rectangle (cheap:
 *      a fixed-size search regardless of map size).
 *   3. A short route (start/goal near each other, or same chunk) just runs one
 *      unbounded local A* — doc 03's "+ local A* for short routes" half.
 *   4. A long route temporarily links the start/goal to their own chunk's
 *      portals (one more bounded local search each), then runs Dijkstra over
 *      the STATIC portal graph — small regardless of map size — and stitches
 *      the winning portal sequence's cached segments into one tile path.
 *
 * The portal graph is built once at construction (map terrain is static this
 * session) — the one-time cost is amortised like terrain generation itself,
 * never charged against the per-tick pathfinding budget.
 */

export const HPA_CHUNK = 16; // independent of render's CHUNK_TILES (sim never imports render, TDD §3)
const SHORT_ROUTE_TILES = HPA_CHUNK * 2; // Chebyshev distance below which a direct local A* is cheaper than the hierarchy

export interface HpaTerrain {
  readonly width: number;
  readonly height: number;
  /** True if a tile can be entered at all (movement cost > 0, not a river). */
  passableAt(x: number, y: number): boolean;
  /** Per-tile traversal cost (≥ some positive minimum on passable tiles). */
  stepCostAt(x: number, y: number): number;
}

/**
 * Binary min-heap keyed by `f`, tie-broken by `id` (deterministic pop order —
 * both A* and Dijkstra below rely on it). A linear-scan "find the smallest"
 * is O(n) per pop — fine for a handful of open nodes, but the abstract portal
 * graph and any large open local search can reach thousands of nodes, where
 * O(n) per pop becomes O(n²) overall. The heap keeps every op O(log n).
 */
class MinHeap<T extends { f: number; id: number }> {
  private readonly items: T[] = [];

  get size(): number {
    return this.items.length;
  }

  push(item: T): void {
    const items = this.items;
    items.push(item);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.before(items[i] as T, items[parent] as T)) {
        [items[i], items[parent]] = [items[parent] as T, items[i] as T];
        i = parent;
      } else break;
    }
  }

  pop(): T | undefined {
    const items = this.items;
    if (items.length === 0) return undefined;
    const top = items[0] as T;
    const last = items.pop() as T;
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let smallest = i;
        if (l < items.length && this.before(items[l] as T, items[smallest] as T)) smallest = l;
        if (r < items.length && this.before(items[r] as T, items[smallest] as T)) smallest = r;
        if (smallest === i) break;
        [items[i], items[smallest]] = [items[smallest] as T, items[i] as T];
        i = smallest;
      }
    }
    return top;
  }

  private before(a: T, b: T): boolean {
    return a.f < b.f || (a.f === b.f && a.id < b.id);
  }
}

interface Bounds {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number; // inclusive
  readonly y1: number; // inclusive
}

const NEIGHBORS = [[0, -1], [-1, 0], [1, 0], [0, 1]] as const;

/** Deterministic 4-neighbour A*, optionally bounded to a tile rectangle. */
function localAStar(
  terrain: HpaTerrain,
  fromTile: number,
  toTile: number,
  bounds: Bounds | null,
): { path: number[]; cost: number } | null {
  const w = terrain.width;
  const toX = toTile % w;
  const toY = Math.floor(toTile / w);
  const inBounds = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < w && y < terrain.height &&
    (bounds === null || (x >= bounds.x0 && x <= bounds.x1 && y >= bounds.y0 && y <= bounds.y1));

  const open = new MinHeap<{ tile: number; f: number; id: number }>();
  open.push({ tile: fromTile, f: 0, id: fromTile });
  const gScore = new Map<number, number>([[fromTile, 0]]);
  const cameFrom = new Map<number, number>();
  const closed = new Set<number>();
  let found = fromTile === toTile;
  let popped: { tile: number; f: number; id: number } | undefined;
  while (!found && (popped = open.pop()) !== undefined) {
    const { tile } = popped;
    if (tile === toTile) {
      found = true;
      break;
    }
    if (closed.has(tile)) continue;
    closed.add(tile);
    const tx = tile % w;
    const ty = Math.floor(tile / w);
    for (const [dx, dy] of NEIGHBORS) {
      const nx = tx + dx;
      const ny = ty + dy;
      if (!inBounds(nx, ny) || !terrain.passableAt(nx, ny)) continue;
      const neighbor = ny * w + nx;
      if (closed.has(neighbor)) continue;
      const g = (gScore.get(tile) as number) + terrain.stepCostAt(nx, ny);
      if (g < (gScore.get(neighbor) ?? Infinity)) {
        gScore.set(neighbor, g);
        cameFrom.set(neighbor, tile);
        const h = Math.abs(nx - toX) + Math.abs(ny - toY); // admissible: min step cost is 1
        open.push({ tile: neighbor, f: g + h, id: neighbor });
      }
    }
  }
  if (!found) return null;
  const path: number[] = [];
  for (let tile = toTile; tile !== fromTile; tile = cameFrom.get(tile) as number) path.push(tile);
  path.reverse();
  return { path, cost: gScore.get(toTile) ?? 0 };
}

// ---------------------------------------------------------------- portal graph

interface PortalNode {
  readonly id: number;
  readonly tile: number;
  readonly chunk: number;
}

interface Edge {
  readonly to: number; // portal id
  readonly cost: number;
  readonly segment: readonly number[]; // tiles from this portal to `to`, exclusive of this portal
}

export class HierarchicalPathService {
  private readonly chunksX: number;
  private readonly chunksY: number;
  private readonly portalsByChunk = new Map<number, PortalNode[]>();
  private readonly edgesByPortal = new Map<number, Edge[]>();
  private nextPortalId = 0;

  constructor(private readonly terrain: HpaTerrain) {
    this.chunksX = Math.ceil(terrain.width / HPA_CHUNK);
    this.chunksY = Math.ceil(terrain.height / HPA_CHUNK);
    this.buildEntrances();
    this.buildIntraChunkEdges();
  }

  stepCost(x: number, y: number): number {
    return this.terrain.stepCostAt(x, y);
  }

  private chunkOf(x: number, y: number): number {
    return Math.floor(y / HPA_CHUNK) * this.chunksX + Math.floor(x / HPA_CHUNK);
  }

  private chunkBounds(chunk: number): Bounds {
    const cx = chunk % this.chunksX;
    const cy = Math.floor(chunk / this.chunksX);
    const x0 = cx * HPA_CHUNK;
    const y0 = cy * HPA_CHUNK;
    return {
      x0, y0,
      x1: Math.min(this.terrain.width, x0 + HPA_CHUNK) - 1,
      y1: Math.min(this.terrain.height, y0 + HPA_CHUNK) - 1,
    };
  }

  private addPortal(tile: number, chunk: number): PortalNode {
    const node: PortalNode = { id: this.nextPortalId++, tile, chunk };
    const list = this.portalsByChunk.get(chunk);
    if (list === undefined) this.portalsByChunk.set(chunk, [node]);
    else list.push(node);
    this.edgesByPortal.set(node.id, []);
    return node;
  }

  private link(a: PortalNode, b: PortalNode, cost: number, segment: readonly number[]): void {
    // `segment` is a→b, exclusive of a, inclusive of b. The reverse edge b→a
    // needs the same tiles walked backwards, exclusive of b, inclusive of a:
    // drop the trailing b.tile, reverse what's left, then land on a.tile.
    (this.edgesByPortal.get(a.id) as Edge[]).push({ to: b.id, cost, segment });
    const reversed = [...segment].slice(0, -1).reverse().concat(a.tile);
    (this.edgesByPortal.get(b.id) as Edge[]).push({ to: a.id, cost, segment: reversed });
  }

  /**
   * Scan every chunk-pair boundary for contiguous passable-both-sides runs →
   * one portal pair per run. Each boundary is scanned ONE CHUNK-ROW/COLUMN
   * SEGMENT AT A TIME (not the full map-spanning line) — every chunk needs
   * its own entrance to its neighbours, otherwise most chunks end up with no
   * portal at all and every query touching them falls back to an unbounded
   * whole-map search (the bug this comment is here to keep from recurring).
   */
  private buildEntrances(): void {
    const w = this.terrain.width;
    const h = this.terrain.height;
    // vertical boundaries (chunk[cx] | chunk[cx+1]), one scan per chunk row
    for (let cx = 0; cx < this.chunksX - 1; cx++) {
      const x = (cx + 1) * HPA_CHUNK - 1; // last column of the left chunk
      const xRight = x + 1;
      if (xRight >= w) continue;
      for (let cy = 0; cy < this.chunksY; cy++) {
        const y0 = cy * HPA_CHUNK;
        const y1 = Math.min(h, y0 + HPA_CHUNK);
        this.scanEdge(
          (t: number) => ({ x, y: t }),
          (t: number) => ({ x: xRight, y: t }),
          y0, y1,
        );
      }
    }
    // horizontal boundaries (chunk[cy] | chunk[cy+1]), one scan per chunk column
    for (let cy = 0; cy < this.chunksY - 1; cy++) {
      const y = (cy + 1) * HPA_CHUNK - 1;
      const yDown = y + 1;
      if (yDown >= h) continue;
      for (let cx = 0; cx < this.chunksX; cx++) {
        const x0 = cx * HPA_CHUNK;
        const x1 = Math.min(w, x0 + HPA_CHUNK);
        this.scanEdge(
          (t: number) => ({ x: t, y }),
          (t: number) => ({ x: t, y: yDown }),
          x0, x1,
        );
      }
    }
  }

  /** Scans tile indices `[start, end)` along one chunk-pair boundary segment. */
  private scanEdge(
    sideA: (t: number) => { x: number; y: number },
    sideB: (t: number) => { x: number; y: number },
    start: number,
    end: number,
  ): void {
    let runStart = -1;
    const flush = (runEnd: number): void => {
      if (runStart === -1) return;
      const mid = runStart + Math.floor((runEnd - runStart) / 2);
      const a = sideA(mid);
      const b = sideB(mid);
      const chunkA = this.chunkOf(a.x, a.y);
      const chunkB = this.chunkOf(b.x, b.y);
      const nodeA = this.addPortal(a.y * this.terrain.width + a.x, chunkA);
      const nodeB = this.addPortal(b.y * this.terrain.width + b.x, chunkB);
      this.link(nodeA, nodeB, this.terrain.stepCostAt(b.x, b.y), [nodeB.tile]);
      runStart = -1;
    };
    for (let t = start; t < end; t++) {
      const a = sideA(t);
      const b = sideB(t);
      const open = this.terrain.passableAt(a.x, a.y) && this.terrain.passableAt(b.x, b.y);
      if (open && runStart === -1) runStart = t;
      else if (!open && runStart !== -1) flush(t - 1);
    }
    flush(end - 1);
  }

  /** Cache the shortest path between every pair of a chunk's own portals, bounded to that chunk. */
  private buildIntraChunkEdges(): void {
    for (const [chunk, portals] of [...this.portalsByChunk.entries()].sort((a, b) => a[0] - b[0])) {
      const bounds = this.chunkBounds(chunk);
      for (let i = 0; i < portals.length; i++) {
        for (let j = i + 1; j < portals.length; j++) {
          const a = portals[i] as PortalNode;
          const b = portals[j] as PortalNode;
          const found = localAStar(this.terrain, a.tile, b.tile, bounds);
          if (found === null) continue;
          this.link(a, b, found.cost, found.path);
        }
      }
    }
  }

  /** Dijkstra over the static portal graph, from temporary start/goal edges to real portals. */
  private abstractRoute(
    startEdges: readonly { portal: number; cost: number; segment: readonly number[] }[],
    goalPortalIds: ReadonlySet<number>,
  ): { portalPath: number[]; segments: (readonly number[])[]; cost: number } | null {
    const dist = new Map<number, number>();
    const prevPortal = new Map<number, number>();
    const prevSegment = new Map<number, readonly number[]>();
    const visited = new Set<number>();
    const frontier = new MinHeap<{ portal: number; f: number; id: number }>();
    for (const e of startEdges) {
      if (!dist.has(e.portal) || (dist.get(e.portal) as number) > e.cost) {
        dist.set(e.portal, e.cost);
        prevSegment.set(e.portal, e.segment);
        frontier.push({ portal: e.portal, f: e.cost, id: e.portal });
      }
    }
    let winner = -1;
    let popped: { portal: number; f: number; id: number } | undefined;
    while ((popped = frontier.pop()) !== undefined) {
      const { portal, f: d } = popped;
      if (visited.has(portal)) continue;
      visited.add(portal);
      if (goalPortalIds.has(portal)) {
        winner = portal;
        break;
      }
      for (const edge of this.edgesByPortal.get(portal) ?? []) {
        if (visited.has(edge.to)) continue;
        const nd = d + edge.cost;
        if (!dist.has(edge.to) || (dist.get(edge.to) as number) > nd) {
          dist.set(edge.to, nd);
          prevPortal.set(edge.to, portal);
          prevSegment.set(edge.to, edge.segment);
          frontier.push({ portal: edge.to, f: nd, id: edge.to });
        }
      }
    }
    if (winner === -1) return null;
    const portalPath: number[] = [];
    const segments: (readonly number[])[] = [];
    for (let p = winner; ; ) {
      portalPath.push(p);
      const seg = prevSegment.get(p);
      if (seg !== undefined) segments.push(seg);
      const prev = prevPortal.get(p);
      if (prev === undefined) break;
      p = prev;
    }
    portalPath.reverse();
    segments.reverse();
    return { portalPath, segments, cost: dist.get(winner) as number };
  }

  /** Tile-index path from → to (exclusive of `from`), or null if unreachable. */
  route(fromX: number, fromY: number, toX: number, toY: number): number[] | null {
    const w = this.terrain.width;
    const fromTile = fromY * w + fromX;
    const toTile = toY * w + toX;
    if (fromTile === toTile) return [];
    if (!this.terrain.passableAt(fromX, fromY) || !this.terrain.passableAt(toX, toY)) return null;

    if (Math.max(Math.abs(toX - fromX), Math.abs(toY - fromY)) <= SHORT_ROUTE_TILES) {
      const direct = localAStar(this.terrain, fromTile, toTile, null);
      return direct === null ? null : direct.path;
    }

    const fromChunk = this.chunkOf(fromX, fromY);
    const toChunk = this.chunkOf(toX, toY);
    const fromPortals = this.portalsByChunk.get(fromChunk) ?? [];
    const toPortals = this.portalsByChunk.get(toChunk) ?? [];
    if (fromPortals.length === 0 || toPortals.length === 0) {
      // an isolated chunk (no crossable edge) — only a direct local search can help
      const direct = localAStar(this.terrain, fromTile, toTile, null);
      return direct === null ? null : direct.path;
    }

    const fromBounds = this.chunkBounds(fromChunk);
    const startEdges: { portal: number; cost: number; segment: readonly number[] }[] = [];
    for (const portal of fromPortals) {
      const found = localAStar(this.terrain, fromTile, portal.tile, fromBounds);
      if (found !== null) startEdges.push({ portal: portal.id, cost: found.cost, segment: found.path });
    }
    if (startEdges.length === 0) return null;

    const toBounds = this.chunkBounds(toChunk);
    const goalTails = new Map<number, readonly number[]>(); // portal id → segment from that portal to the true goal
    const goalPortalIds = new Set<number>();
    for (const portal of toPortals) {
      const found = localAStar(this.terrain, portal.tile, toTile, toBounds);
      if (found !== null) {
        goalPortalIds.add(portal.id);
        goalTails.set(portal.id, found.path);
      }
    }
    if (goalPortalIds.size === 0) return null;

    const result = this.abstractRoute(startEdges, goalPortalIds);
    if (result === null) return null;

    const path: number[] = [];
    for (const segment of result.segments) path.push(...segment);
    const tail = goalTails.get(result.portalPath[result.portalPath.length - 1] as number) ?? [];
    path.push(...tail);
    return path;
  }
}
