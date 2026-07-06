/**
 * ECS store (Engine §2; roadmap M4).
 *
 * Archetype-lite Structure-of-Arrays:
 *  - Numeric ("hot") components live in typed arrays keyed by dense entity index —
 *    cache-coherent iteration for cohort/hauling/combat math (TDD §10).
 *  - Complex ("cold") components (names, inventories) live in ObjectComponents.
 *  - Membership is one bitset per component; queries AND bitsets and iterate set
 *    bits in ascending index order — deterministic by construction (TDD §5 rule 2).
 *
 * Declared-access enforcement (Engine §2): while a system runs inside an access
 * scope, acquiring component views via world.read()/world.write() — and any
 * structural change (attach/detach/despawn) — is checked against the system's
 * declaration. Enforcement is at ACQUISITION granularity: hot loops then work on
 * raw typed arrays with zero per-element cost. The kernel opens/closes scopes
 * around each system update (kernel.ts AccessGuard).
 */

import {
  EntityAllocator,
  entityIndex,
  hashCombine,
  hashF64,
  invariant,
  type EntityId,
} from '@crowns/core';

// ---------------------------------------------------------------- field types

export type FieldType = 'f64' | 'f32' | 'i32' | 'u32' | 'u16' | 'u8' | 'bool' | 'eid';

type ArrayFor<T extends FieldType> = T extends 'f64'
  ? Float64Array
  : T extends 'f32'
    ? Float32Array
    : T extends 'i32'
      ? Int32Array
      : T extends 'u32' | 'eid'
        ? Uint32Array
        : T extends 'u16'
          ? Uint16Array
          : Uint8Array; // 'u8' | 'bool'

export type SoASchema = Record<string, FieldType>;
export type SoAViews<S extends SoASchema> = { readonly [K in keyof S]: ArrayFor<S[K]> };
export type SoAInit<S extends SoASchema> = Partial<Record<keyof S, number | boolean>>;

const CTORS: Record<FieldType, new (n: number) => Float64Array | Float32Array | Int32Array | Uint32Array | Uint16Array | Uint8Array> = {
  f64: Float64Array,
  f32: Float32Array,
  i32: Int32Array,
  u32: Uint32Array,
  eid: Uint32Array,
  u16: Uint16Array,
  u8: Uint8Array,
  bool: Uint8Array,
};

// ---------------------------------------------------------------- components

/** Opaque component handle; `cid` doubles as the PRNG-free deterministic order key. */
export abstract class Component {
  constructor(
    readonly cid: number,
    readonly name: string,
  ) {}
}

export class SoAComponent<S extends SoASchema> extends Component {
  /** @internal field arrays, index-addressed. */
  fields: Record<string, ArrayFor<FieldType>>;
  readonly fieldNames: readonly string[];

  constructor(cid: number, name: string, readonly schema: S, capacity: number) {
    super(cid, name);
    this.fieldNames = Object.keys(schema).sort(); // stable, declaration-order-free
    this.fields = {};
    for (const f of this.fieldNames) {
      this.fields[f] = new CTORS[schema[f] as FieldType](capacity);
    }
  }

  /** @internal */
  grow(capacity: number): void {
    for (const f of this.fieldNames) {
      const old = this.fields[f] as ArrayFor<FieldType>;
      const grown = new CTORS[this.schema[f] as FieldType](capacity);
      grown.set(old);
      this.fields[f] = grown;
    }
  }

  /** @internal zero the slot (recycled indices must not leak stale values). */
  clearAt(index: number): void {
    for (const f of this.fieldNames) (this.fields[f] as ArrayFor<FieldType>)[index] = 0;
  }
}

export class ObjectComponent<T> extends Component {
  /** @internal */
  readonly store = new Map<number, T>();
  constructor(
    cid: number,
    name: string,
    /** Optional determinism contribution for world.hash(). */
    readonly hasher?: (value: T, fold: (v: number) => void) => void,
  ) {
    super(cid, name);
  }
}

export interface EntityInspection {
  readonly id: number;
  readonly index: number;
  readonly alive: boolean;
  readonly components: { readonly name: string; readonly data: Record<string, unknown> }[];
}

export interface ObjectView<T> {
  get(index: number): T;
  tryGet(index: number): T | undefined;
}
export interface ObjectMutView<T> extends ObjectView<T> {
  set(index: number, value: T): void;
}

// ---------------------------------------------------------------- access scope

export interface SystemAccess {
  readonly reads?: readonly Component[];
  readonly writes?: readonly Component[];
}

class AccessScope {
  private readonly readable = new Set<number>();
  private readonly writable = new Set<number>();
  constructor(
    readonly label: string,
    access: SystemAccess,
  ) {
    for (const c of access.writes ?? []) {
      this.writable.add(c.cid);
      this.readable.add(c.cid);
    }
    for (const c of access.reads ?? []) this.readable.add(c.cid);
  }
  checkRead(c: Component): void {
    invariant(
      this.readable.has(c.cid),
      `access violation: '${this.label}' reads '${c.name}' without declaring it`,
    );
  }
  checkWrite(c: Component): void {
    invariant(
      this.writable.has(c.cid),
      `access violation: '${this.label}' writes '${c.name}' without declaring it`,
    );
  }
}

// ---------------------------------------------------------------- world

export class World {
  private readonly allocator = new EntityAllocator();
  private capacity: number;
  private wordCount: number;
  private readonly components: Component[] = [];
  /** One membership bitset (Uint32Array of `wordCount`) per component, cid-indexed. */
  private masks: Uint32Array[] = [];
  private scope: AccessScope | null = null;

  constructor(initialCapacity = 1024) {
    this.capacity = Math.max(64, initialCapacity);
    this.wordCount = Math.ceil(this.capacity / 32);
  }

  // ---- definition (setup time) ----

  defineSoA<S extends SoASchema>(name: string, schema: S): SoAComponent<S> {
    this.assertNewComponent(name);
    invariant(Object.keys(schema).length > 0, `component '${name}': empty schema`);
    const comp = new SoAComponent(this.components.length, name, schema, this.capacity);
    this.components.push(comp);
    this.masks.push(new Uint32Array(this.wordCount));
    return comp;
  }

  defineObject<T>(name: string, hasher?: (value: T, fold: (v: number) => void) => void): ObjectComponent<T> {
    this.assertNewComponent(name);
    const comp = new ObjectComponent<T>(this.components.length, name, hasher);
    this.components.push(comp);
    this.masks.push(new Uint32Array(this.wordCount));
    return comp;
  }

  private assertNewComponent(name: string): void {
    invariant(this.scope === null, `defineComponent('${name}') inside a system scope`);
    invariant(!this.components.some((c) => c.name === name), `duplicate component '${name}'`);
  }

  // ---- entity lifecycle ----

  spawn(): EntityId {
    const id = this.allocator.allocate();
    this.ensureCapacity(entityIndex(id) + 1);
    return id;
  }

  despawn(entity: EntityId): void {
    invariant(this.allocator.isAlive(entity), `despawn: stale entity ${entity}`);
    const index = entityIndex(entity);
    for (const comp of this.components) {
      if (!this.maskGet(comp.cid, index)) continue;
      this.scope?.checkWrite(comp);
      this.detachAt(comp, index);
    }
    this.allocator.free(entity);
  }

  isAlive(entity: EntityId): boolean {
    return this.allocator.isAlive(entity);
  }

  get liveCount(): number {
    return this.allocator.liveCount;
  }

  /** Reconstruct the EntityId at a dense index (valid while any component bit is set). */
  entityAt(index: number): EntityId {
    return this.allocator.currentId(index);
  }

  // ---- component membership ----

  attach<S extends SoASchema>(entity: EntityId, comp: SoAComponent<S>, init?: SoAInit<S>): void;
  attach<T>(entity: EntityId, comp: ObjectComponent<T>, init: T): void;
  attach(entity: EntityId, comp: Component, init?: unknown): void {
    invariant(this.allocator.isAlive(entity), `attach(${comp.name}): stale entity ${entity}`);
    this.scope?.checkWrite(comp);
    const index = entityIndex(entity);
    invariant(!this.maskGet(comp.cid, index), `attach: entity already has '${comp.name}'`);
    this.maskSet(comp.cid, index);
    if (comp instanceof SoAComponent) {
      comp.clearAt(index);
      if (init !== undefined) {
        for (const [field, value] of Object.entries(init as Record<string, number | boolean>)) {
          const arr = comp.fields[field];
          invariant(arr !== undefined, `attach: unknown field '${field}' on '${comp.name}'`);
          arr[index] = typeof value === 'boolean' ? (value ? 1 : 0) : value;
        }
      }
    } else if (comp instanceof ObjectComponent) {
      invariant(init !== undefined, `attach(${comp.name}): object components require a value`);
      (comp as ObjectComponent<unknown>).store.set(index, init);
    }
  }

  detach(entity: EntityId, comp: Component): void {
    invariant(this.allocator.isAlive(entity), `detach(${comp.name}): stale entity ${entity}`);
    this.scope?.checkWrite(comp);
    const index = entityIndex(entity);
    invariant(this.maskGet(comp.cid, index), `detach: entity lacks '${comp.name}'`);
    this.detachAt(comp, index);
  }

  private detachAt(comp: Component, index: number): void {
    this.maskClear(comp.cid, index);
    if (comp instanceof ObjectComponent) (comp as ObjectComponent<unknown>).store.delete(index);
    // SoA slots are zeroed on next attach; membership bit is authoritative.
  }

  has(entity: EntityId, comp: Component): boolean {
    if (!this.allocator.isAlive(entity)) return false;
    this.scope?.checkRead(comp);
    return this.maskGet(comp.cid, entityIndex(entity));
  }

  // ---- data access (checked at acquisition; loops then run on raw arrays) ----

  read<S extends SoASchema>(comp: SoAComponent<S>): SoAViews<S> {
    this.scope?.checkRead(comp);
    return comp.fields as SoAViews<S>;
  }

  write<S extends SoASchema>(comp: SoAComponent<S>): SoAViews<S> {
    this.scope?.checkWrite(comp);
    return comp.fields as SoAViews<S>;
  }

  readObj<T>(comp: ObjectComponent<T>): ObjectView<T> {
    this.scope?.checkRead(comp);
    return {
      get: (index) => {
        const v = comp.store.get(index);
        invariant(v !== undefined, `readObj(${comp.name}): index ${index} has no value`);
        return v;
      },
      tryGet: (index) => comp.store.get(index),
    };
  }

  writeObj<T>(comp: ObjectComponent<T>): ObjectMutView<T> {
    this.scope?.checkWrite(comp);
    const view = this.readObj(comp);
    return { ...view, set: (index, value) => void comp.store.set(index, value) };
  }

  // ---- queries ----

  query(all: readonly Component[], none: readonly Component[] = []): Query {
    invariant(all.length > 0, 'query: at least one component required');
    for (const c of all) this.scope?.checkRead(c);
    for (const c of none) this.scope?.checkRead(c);
    return new Query(this, all, none);
  }

  /** @internal */
  queryMasks(comps: readonly Component[]): Uint32Array[] {
    return comps.map((c) => this.masks[c.cid] as Uint32Array);
  }
  /** @internal */
  get queryWordCount(): number {
    return this.wordCount;
  }

  // ---- access guard (kernel AccessGuard implementation) ----

  enter(label: string, access: SystemAccess): void {
    invariant(this.scope === null, `enter('${label}'): scope '${this.scope?.label}' still open`);
    this.scope = new AccessScope(label, access);
  }

  exit(): void {
    invariant(this.scope !== null, 'exit() without enter()');
    this.scope = null;
  }

  // ---- debug inspection (M9; the inspector's data source) ----

  /**
   * Reflect an entity's full component state for the debug inspector. Reads
   * live arrays — no caching — so repeated calls always show current values
   * ("inspector reflects live state", roadmap M9). Unscoped by design: the
   * inspector runs from the message handler, outside system scopes.
   */
  inspect(entity: EntityId): EntityInspection {
    const alive = this.allocator.isAlive(entity);
    const index = entityIndex(entity);
    const components: EntityInspection['components'] = [];
    if (alive) {
      for (const comp of this.components) {
        if (!this.maskGet(comp.cid, index)) continue;
        const data: Record<string, unknown> = {};
        if (comp instanceof SoAComponent) {
          for (const f of comp.fieldNames) data[f] = (comp.fields[f] as ArrayFor<FieldType>)[index];
        } else if (comp instanceof ObjectComponent) {
          data['value'] = (comp.store as Map<number, unknown>).get(index);
        }
        components.push({ name: comp.name, data });
      }
    }
    return { id: entity as number, index, alive, components };
  }

  // ---- determinism ----

  /** Fold live structure + all component data into a state hash (cid order, index order). */
  hash(fold: (v: number) => void): void {
    fold(this.allocator.liveCount);
    for (const comp of this.components) {
      const mask = this.masks[comp.cid] as Uint32Array;
      let h = 0;
      for (let w = 0; w < this.wordCount; w++) h = hashCombine(h, mask[w] as number);
      fold(h);
      if (comp instanceof SoAComponent) {
        let vh = 0;
        forEachSetBit([mask], [], this.wordCount, (index) => {
          for (const f of comp.fieldNames) {
            vh = hashF64(vh, (comp.fields[f] as ArrayFor<FieldType>)[index] as number);
          }
        });
        fold(vh);
      } else if (comp instanceof ObjectComponent && comp.hasher !== undefined) {
        let vh = 0;
        forEachSetBit([mask], [], this.wordCount, (index) => {
          comp.hasher?.((comp.store as Map<number, never>).get(index) as never, (v) => {
            vh = hashCombine(vh, v);
          });
        });
        fold(vh);
      }
    }
  }

  // ---- internals ----

  private ensureCapacity(needed: number): void {
    if (needed <= this.capacity) return;
    let next = this.capacity;
    while (next < needed) next *= 2;
    this.capacity = next;
    this.wordCount = Math.ceil(next / 32);
    this.masks = this.masks.map((old) => {
      const grown = new Uint32Array(this.wordCount);
      grown.set(old);
      return grown;
    });
    for (const comp of this.components) {
      if (comp instanceof SoAComponent) comp.grow(next);
    }
  }

  private maskGet(cid: number, index: number): boolean {
    return (((this.masks[cid] as Uint32Array)[index >>> 5] as number) & (1 << (index & 31))) !== 0;
  }
  private maskSet(cid: number, index: number): void {
    const mask = this.masks[cid] as Uint32Array;
    const w = index >>> 5;
    mask[w] = ((mask[w] as number) | (1 << (index & 31))) >>> 0;
  }
  private maskClear(cid: number, index: number): void {
    const mask = this.masks[cid] as Uint32Array;
    const w = index >>> 5;
    mask[w] = ((mask[w] as number) & ~(1 << (index & 31))) >>> 0;
  }
}

// ---------------------------------------------------------------- query

/** Iterate indices present in ALL of `all` and NONE of `none`, ascending. */
function forEachSetBit(
  all: readonly Uint32Array[],
  none: readonly Uint32Array[],
  wordCount: number,
  cb: (index: number) => void,
): void {
  for (let w = 0; w < wordCount; w++) {
    let word = (all[0] as Uint32Array)[w] as number;
    for (let i = 1; i < all.length && word !== 0; i++) word &= (all[i] as Uint32Array)[w] as number;
    for (let i = 0; i < none.length && word !== 0; i++) word &= ~((none[i] as Uint32Array)[w] as number);
    while (word !== 0) {
      const bit = word & -word; // lowest set bit
      cb((w << 5) + (31 - Math.clz32(bit)));
      word ^= bit;
    }
  }
}

export class Query {
  private readonly all: Uint32Array[];
  private readonly none: Uint32Array[];

  /** @internal use world.query() */
  constructor(
    private readonly world: World,
    allComps: readonly Component[],
    noneComps: readonly Component[],
  ) {
    this.all = world.queryMasks(allComps);
    this.none = world.queryMasks(noneComps);
  }

  /** Deterministic ascending-index iteration. */
  forEach(cb: (index: number, entity: EntityId) => void): void {
    forEachSetBit(this.all, this.none, this.world.queryWordCount, (index) =>
      cb(index, this.world.entityAt(index)),
    );
  }

  count(): number {
    let n = 0;
    forEachSetBit(this.all, this.none, this.world.queryWordCount, () => n++);
    return n;
  }

  collect(): number[] {
    const out: number[] = [];
    forEachSetBit(this.all, this.none, this.world.queryWordCount, (i) => out.push(i));
    return out;
  }
}
