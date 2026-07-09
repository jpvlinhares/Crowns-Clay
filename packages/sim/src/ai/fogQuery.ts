/**
 * Fog-of-information query surface (roadmap M19; doc 07 §6; Engine §0/§3).
 *
 * `world.query()` (ecs.ts) enforces COMPONENT-level declared access — which
 * components a system may touch — but says nothing about which ENTITIES a
 * given kingdom has actually observed. `fogQuery` adds that second axis: it
 * wraps `world.query()` (so component access checks still apply) and
 * intersects the result with a per-kingdom known-entity bitset. This is the
 * ONLY sanctioned way for AI code to read entities outside its own kingdom —
 * the roadmap's M19 test objective ("AI reads only via fog queries") is
 * proved by asserting no file under this directory calls `world.query(`
 * directly except this one (see fogQuery.test.ts).
 */
import type { EntityId } from '@crowns/core';
import type { Component, World } from '../ecs.js';

export class FogRegistry {
  private readonly known = new Map<number, Uint32Array>();

  /** @param wordCount current `world.queryWordCount` — masks grow lazily alongside it. */
  constructor(private readonly wordCount: () => number) {}

  private maskFor(kingdom: number): Uint32Array {
    const needed = this.wordCount();
    const existing = this.known.get(kingdom);
    if (existing !== undefined && existing.length >= needed) return existing;
    const grown = new Uint32Array(needed);
    if (existing !== undefined) grown.set(existing);
    this.known.set(kingdom, grown);
    return grown;
  }

  /** Mark a dense entity index as known to `kingdom` (contact established). */
  reveal(kingdom: number, entityIndex: number): void {
    const mask = this.maskFor(kingdom);
    const w = entityIndex >>> 5;
    mask[w] = ((mask[w] as number) | (1 << (entityIndex & 31))) >>> 0;
  }

  isKnown(kingdom: number, entityIndex: number): boolean {
    const mask = this.known.get(kingdom);
    if (mask === undefined) return false;
    const w = entityIndex >>> 5;
    if (w >= mask.length) return false;
    return ((mask[w] as number) & (1 << (entityIndex & 31))) !== 0;
  }
}

export interface FogQuery {
  forEach(cb: (index: number, entity: EntityId) => void): void;
  count(): number;
  collect(): number[];
}

/** Fog-filtered view of `world.query(all, none)`, scoped to one kingdom. */
export function fogQuery(
  world: World,
  kingdom: number,
  fog: FogRegistry,
  all: readonly Component[],
  none: readonly Component[] = [],
): FogQuery {
  const inner = world.query(all, none);
  return {
    forEach(cb) {
      inner.forEach((index, entity) => {
        if (fog.isKnown(kingdom, index)) cb(index, entity);
      });
    },
    count() {
      let n = 0;
      inner.forEach((index) => {
        if (fog.isKnown(kingdom, index)) n++;
      });
      return n;
    },
    collect() {
      const out: number[] = [];
      inner.forEach((index) => {
        if (fog.isKnown(kingdom, index)) out.push(index);
      });
      return out;
    },
  };
}
