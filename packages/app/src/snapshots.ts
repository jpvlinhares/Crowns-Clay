/**
 * Snapshot emitter (TDD §4, minimal M6 form): after each tick batch, diff the
 * world's renderable entities against the last emission and produce a compact
 * delta (spawned / moved-as-flat-triples / despawned). A per-component
 * DirtyTracker replaces this diffing at scale (doc 11 interest management);
 * at M6 entity counts, diffing is simpler and provably correct.
 */
import { entityIndex } from '@crowns/core';
import type { EntityRec } from '@crowns/protocol';
import type { SoAComponent, World } from '@crowns/sim';

interface Tracked {
  x: number;
  y: number;
}

export class SnapshotEmitter {
  private readonly last = new Map<number, Tracked>();

  constructor(
    private readonly world: World,
    private readonly Position: SoAComponent<{ x: 'f64'; y: 'f64' }>,
    private readonly kind = 0,
  ) {}

  private scan(cb: (id: number, x: number, y: number) => void): void {
    const pos = this.world.read(this.Position);
    this.world.query([this.Position]).forEach((index, entity) => {
      cb(entity as number, pos.x[index] as number, pos.y[index] as number);
    });
  }

  full(): EntityRec[] {
    this.last.clear();
    const entities: EntityRec[] = [];
    this.scan((id, x, y) => {
      this.last.set(id, { x, y });
      entities.push({ id, kind: this.kind, x, y });
    });
    return entities;
  }

  delta(): { spawned: EntityRec[]; moved: number[]; despawned: number[] } {
    const spawned: EntityRec[] = [];
    const moved: number[] = [];
    const seen = new Set<number>();
    this.scan((id, x, y) => {
      seen.add(id);
      const prev = this.last.get(id);
      if (prev === undefined) {
        this.last.set(id, { x, y });
        spawned.push({ id, kind: this.kind, x, y });
      } else if (prev.x !== x || prev.y !== y) {
        prev.x = x;
        prev.y = y;
        moved.push(id, x, y);
      }
    });
    const despawned: number[] = [];
    for (const id of this.last.keys()) {
      if (!seen.has(id)) despawned.push(id);
    }
    for (const id of despawned) this.last.delete(id);
    return { spawned, moved, despawned };
  }
}

/** Entity ids are opaque to the renderer; index exposed for debug HUDs only. */
export const debugIndexOf = entityIndex;
