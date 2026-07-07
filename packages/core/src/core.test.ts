import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Rng } from './prng.js';
import { fnv1a32, hashCombine, hashF64 } from './hash.js';
import { Interner, EntityAllocator, entityIndex, entityGeneration, type EntityId } from './ids.js';
import { clamp, lerp, remap, gridIndex, inBounds } from './math.js';
import { iterSortedNumeric, StableMap } from './ordered.js';
import { invariant, InvariantViolation } from './invariant.js';

// ---------------- PRNG: determinism ----------------

test('rng: identical seeds produce identical sequences', () => {
  const a = Rng.fromSeed(12345);
  const b = Rng.fromSeed(12345);
  for (let i = 0; i < 1000; i++) assert.equal(a.nextUint32(), b.nextUint32());
});

test('rng: different seeds diverge', () => {
  const a = Rng.fromSeed(1);
  const b = Rng.fromSeed(2);
  let same = 0;
  for (let i = 0; i < 100; i++) if (a.nextUint32() === b.nextUint32()) same++;
  assert.ok(same < 3, `sequences nearly identical (${same}/100 collisions)`);
});

test('rng: string seeds are stable', () => {
  const a = Rng.fromString('crowns-and-clay');
  const b = Rng.fromString('crowns-and-clay');
  assert.equal(a.nextUint32(), b.nextUint32());
});

test('rng: state round-trip resumes the exact sequence (save/load contract)', () => {
  const a = Rng.fromSeed(777);
  for (let i = 0; i < 57; i++) a.nextUint32();
  const snapshot = a.state();
  const expected = Array.from({ length: 20 }, () => a.nextUint32());
  const restored = Rng.fromState(snapshot);
  const actual = Array.from({ length: 20 }, () => restored.nextUint32());
  assert.deepEqual(actual, expected);
});

test('rng: forks are key-stable and independent of fork order & parent draws', () => {
  const p1 = Rng.fromSeed(42);
  const p2 = Rng.fromSeed(42);
  // p1: fork combat first, then economy; p2: opposite order after burning draws on neither
  const c1 = p1.fork('combat');
  const e1 = p1.fork('economy');
  const e2 = p2.fork('economy');
  const c2 = p2.fork('combat');
  assert.equal(c1.nextUint32(), c2.nextUint32(), 'combat stream differs by fork order');
  assert.equal(e1.nextUint32(), e2.nextUint32(), 'economy stream differs by fork order');
  // and distinct keys give distinct streams
  assert.notEqual(
    Rng.fromSeed(42).fork('combat').nextUint32(),
    Rng.fromSeed(42).fork('economy').nextUint32(),
  );
});

// ---------------- PRNG: distribution sanity ----------------

test('rng: nextFloat in [0,1) and roughly uniform', () => {
  const rng = Rng.fromSeed(99);
  const buckets = new Array<number>(10).fill(0);
  const N = 50_000;
  for (let i = 0; i < N; i++) {
    const f = rng.nextFloat();
    assert.ok(f >= 0 && f < 1);
    buckets[Math.floor(f * 10)] = (buckets[Math.floor(f * 10)] ?? 0) + 1;
  }
  for (const count of buckets) {
    // expected 5000 per bucket; allow ±10%
    assert.ok(Math.abs(count - N / 10) < N / 100, `bucket count ${count} out of tolerance`);
  }
});

test('rng: int(min,max) covers bounds inclusively and stays in range', () => {
  const rng = Rng.fromSeed(7);
  const seen = new Set<number>();
  for (let i = 0; i < 10_000; i++) {
    const v = rng.int(3, 9);
    assert.ok(v >= 3 && v <= 9);
    seen.add(v);
  }
  assert.equal(seen.size, 7, 'not all values in [3,9] were produced');
  assert.throws(() => rng.int(5, 4));
});

test('rng: pickWeighted respects weights and rejects bad input', () => {
  const rng = Rng.fromSeed(1234);
  const counts = { a: 0, b: 0 };
  for (let i = 0; i < 30_000; i++) counts[rng.pickWeighted(['a', 'b'] as const, [9, 1])]++;
  const ratio = counts.a / counts.b;
  assert.ok(ratio > 7 && ratio < 11, `weighted ratio ${ratio.toFixed(2)} outside [7,11]`);
  assert.throws(() => rng.pickWeighted(['a'], [0]));
  assert.throws(() => rng.pickWeighted(['a'], [-1]));
});

test('rng: shuffle is a permutation and seed-stable', () => {
  const base = [1, 2, 3, 4, 5, 6, 7, 8];
  const s1 = Rng.fromSeed(5).shuffle(base.slice());
  const s2 = Rng.fromSeed(5).shuffle(base.slice());
  assert.deepEqual(s1, s2);
  assert.deepEqual(s1.slice().sort((a, b) => a - b), base);
});

// ---------------- hashing ----------------

test('hash: fnv1a32 matches known vectors', () => {
  // Canonical FNV-1a 32-bit test vectors (byte == code unit for ASCII).
  assert.equal(fnv1a32(''), 0x811c9dc5);
  assert.equal(fnv1a32('a'), 0xe40c292c);
  assert.equal(fnv1a32('foobar'), 0xbf9cf968);
});

test('hash: combine and f64 hashing are order-sensitive and stable', () => {
  const h1 = hashCombine(hashCombine(0, 1), 2);
  const h2 = hashCombine(hashCombine(0, 2), 1);
  assert.notEqual(h1, h2);
  assert.equal(hashF64(0, 0.1), hashF64(0, 0.1));
  assert.notEqual(hashF64(0, 0.1), hashF64(0, 0.2));
  assert.notEqual(hashF64(0, 0), hashF64(0, -0), 'must distinguish ±0 bit patterns');
});

// ---------------- ids ----------------

test('interner: round-trips, dedupes, serializes', () => {
  const it = new Interner();
  const a = it.intern('base:building.granary');
  const b = it.intern('base:building.granary');
  const c = it.intern('base:unit.spearman');
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(it.resolve(a), 'base:building.granary');
  assert.equal(it.peek('missing'), undefined);
  const restored = Interner.fromArray(it.toArray());
  assert.equal(restored.peek('base:unit.spearman'), c);
});

test('entity allocator: generational recycling invalidates stale ids', () => {
  const alloc = new EntityAllocator();
  const e1 = alloc.allocate();
  assert.ok(alloc.isAlive(e1));
  alloc.free(e1);
  assert.ok(!alloc.isAlive(e1), 'freed id must be stale');
  const e2 = alloc.allocate(); // recycles the index with a bumped generation
  assert.equal(entityIndex(e2), entityIndex(e1));
  assert.notEqual(entityGeneration(e2), entityGeneration(e1));
  assert.ok(alloc.isAlive(e2));
  assert.ok(!alloc.isAlive(e1), 'stale id must remain dead after recycle');
  assert.throws(() => alloc.free(e1));
  assert.equal(alloc.liveCount, 1);
  assert.throws(() => alloc.free(999999 as EntityId));
});

// ---------------- math / ordered / invariant ----------------

test('math helpers', () => {
  assert.equal(clamp(5, 0, 3), 3);
  assert.equal(clamp(-1, 0, 3), 0);
  assert.equal(lerp(0, 10, 0.5), 5);
  assert.equal(remap(5, 0, 10, 0, 100), 50);
  assert.equal(gridIndex(3, 2, 10), 23);
  assert.ok(inBounds(0, 0, 5, 5) && !inBounds(5, 0, 5, 5) && !inBounds(-1, 2, 5, 5));
});

test('ordered iteration is key-sorted regardless of insertion order', () => {
  const m = new Map<number, string>([
    [30, 'c'],
    [10, 'a'],
    [20, 'b'],
  ]);
  assert.deepEqual(Array.from(iterSortedNumeric(m), ([k]) => k), [10, 20, 30]);
  const sm = new StableMap<string, number>();
  sm.set('z', 1).set('a', 2);
  assert.deepEqual(Array.from(sm.entries(), ([k]) => k), ['z', 'a'], 'insertion order pinned');
});

test('invariant throws typed violations', () => {
  invariant(true, 'fine');
  assert.throws(() => invariant(false, 'boom'), (e: unknown) => e instanceof InvariantViolation);
});
