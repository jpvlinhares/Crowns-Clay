/**
 * Identity utilities (Engine §2 "string-free hot paths").
 *
 * - `Interner`: bidirectional string↔int mapping. All content ids
 *   (`base:building.granary`) are interned once at definition-load; systems and
 *   components carry only ints.
 * - `EntityAllocator`: generational entity ids — dense index for SoA storage,
 *   generation counter to invalidate stale references after recycling.
 */

export type InternedId = number & { readonly __interned: unique symbol };
export type EntityId = number & { readonly __entity: unique symbol };

export class Interner {
  private readonly byString = new Map<string, number>();
  private readonly byId: string[] = [];

  intern(text: string): InternedId {
    const existing = this.byString.get(text);
    if (existing !== undefined) return existing as InternedId;
    const id = this.byId.length;
    this.byString.set(text, id);
    this.byId.push(text);
    return id as InternedId;
  }

  /** Lookup without creating; returns undefined if never interned. */
  peek(text: string): InternedId | undefined {
    return this.byString.get(text) as InternedId | undefined;
  }

  resolve(id: InternedId): string {
    const s = this.byId[id];
    if (s === undefined) throw new RangeError(`Interner.resolve: unknown id ${id}`);
    return s;
  }

  get size(): number {
    return this.byId.length;
  }

  /** Serialization: the full table, index-ordered (save files, doc 06 §12). */
  toArray(): readonly string[] {
    return this.byId.slice();
  }

  static fromArray(strings: readonly string[]): Interner {
    const it = new Interner();
    for (const s of strings) it.intern(s);
    return it;
  }
}

const INDEX_BITS = 22; // 4M live entities max (doc 11 ceilings ≪ this)
const INDEX_MASK = (1 << INDEX_BITS) - 1;
const GEN_MASK = 0xff; // 8-bit generation, wraps

export function entityIndex(id: EntityId): number {
  return id & INDEX_MASK;
}
export function entityGeneration(id: EntityId): number {
  return (id >>> INDEX_BITS) & GEN_MASK;
}

export class EntityAllocator {
  private generations: number[] = [];
  private freeList: number[] = []; // LIFO; deterministic recycle order

  allocate(): EntityId {
    let index: number;
    if (this.freeList.length > 0) {
      index = this.freeList.pop() as number;
    } else {
      index = this.generations.length;
      if (index > INDEX_MASK) throw new RangeError('EntityAllocator: index space exhausted');
      this.generations.push(0);
    }
    const gen = this.generations[index] as number;
    return (((gen & GEN_MASK) << INDEX_BITS) | index) as EntityId;
  }

  free(id: EntityId): void {
    const index = entityIndex(id);
    if (!this.isAlive(id)) throw new RangeError(`EntityAllocator.free: stale or invalid id ${id}`);
    this.generations[index] = ((this.generations[index] as number) + 1) & GEN_MASK;
    this.freeList.push(index);
  }

  isAlive(id: EntityId): boolean {
    const index = entityIndex(id);
    const gen = this.generations[index];
    return gen !== undefined && (gen & GEN_MASK) === entityGeneration(id);
  }

  get liveCount(): number {
    return this.generations.length - this.freeList.length;
  }

  /**
   * Reconstruct the full EntityId currently occupying a dense index.
   * Used by ECS queries (index-first iteration) to hand systems a valid id.
   * The caller must know the index is live (e.g. from a component bitset).
   */
  currentId(index: number): EntityId {
    const gen = this.generations[index];
    if (gen === undefined) throw new RangeError(`EntityAllocator.currentId: index ${index} never allocated`);
    return (((gen & GEN_MASK) << INDEX_BITS) | index) as EntityId;
  }
}

export interface EntityIndexResolver {
  currentId(index: number): EntityId;
}
