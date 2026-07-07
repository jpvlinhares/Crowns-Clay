import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Rng, type EntityId } from '@crowns/core';
import { World, type SystemAccess } from './ecs.js';
import { Kernel, type SimSystem, type TickContext } from './kernel.js';

const POS = { x: 'f64', y: 'f64' } as const;
const HP = { current: 'u16', max: 'u16', regenerating: 'bool' } as const;

function makeWorld() {
  const world = new World(64);
  const Position = world.defineSoA('position', POS);
  const Health = world.defineSoA('health', HP);
  const Name = world.defineObject<string>('name', (v, fold) => {
    for (let i = 0; i < v.length; i++) fold(v.charCodeAt(i));
  });
  return { world, Position, Health, Name };
}

// ---------------- lifecycle & membership ----------------

test('ecs: spawn/attach/detach/despawn lifecycle', () => {
  const { world, Position, Name } = makeWorld();
  const e = world.spawn();
  assert.ok(world.isAlive(e));
  assert.equal(world.has(e, Position), false);

  world.attach(e, Position, { x: 3, y: 4 });
  world.attach(e, Name, 'Aldric');
  assert.ok(world.has(e, Position));
  assert.throws(() => world.attach(e, Position), /already has/);

  world.detach(e, Position);
  assert.equal(world.has(e, Position), false);
  assert.throws(() => world.detach(e, Position), /lacks/);

  world.despawn(e);
  assert.equal(world.isAlive(e), false);
  assert.equal(world.has(e, Name), false, 'despawn clears membership');
  assert.throws(() => world.attach(e, Position), /stale/);
  assert.equal(world.liveCount, 0);
});

test('ecs: SoA init values apply, unset fields zero, recycled slots start clean', () => {
  const { world, Position, Health } = makeWorld();
  const e1 = world.spawn();
  world.attach(e1, Position, { x: 7 });
  const pos = world.read(Position);
  assert.equal(pos.x[0], 7);
  assert.equal(pos.y[0], 0, 'unset field defaults to zero');

  world.attach(e1, Health, { current: 10, max: 10, regenerating: true });
  assert.equal(world.read(Health).regenerating[0], 1, 'bool stored as 0/1');

  // dirty the slot, despawn, respawn into the same index — must be clean
  world.write(Position).x[0] = 999;
  world.despawn(e1);
  const e2 = world.spawn();
  world.attach(e2, Position);
  assert.equal(world.read(Position).x[0], 0, 'recycled slot zeroed on attach');
  assert.notEqual(e2, e1, 'generation bumped');
});

test('ecs: object components round-trip and require a value', () => {
  const { world, Name } = makeWorld();
  const e = world.spawn();
  world.attach(e, Name, 'Berta');
  const names = world.writeObj(Name);
  assert.equal(names.get(0), 'Berta');
  names.set(0, 'Berta the Bold');
  assert.equal(world.readObj(Name).get(0), 'Berta the Bold');
  assert.equal(world.readObj(Name).tryGet(5), undefined);
  assert.throws(() => world.readObj(Name).get(5), /no value/);
});

// ---------------- queries ----------------

test('ecs: query all/none semantics with deterministic ascending order', () => {
  const { world, Position, Health, Name } = makeWorld();
  const both: number[] = [];
  const posOnly: number[] = [];
  for (let i = 0; i < 40; i++) {
    const e = world.spawn();
    world.attach(e, Position, { x: i });
    if (i % 3 === 0) world.attach(e, Health, { current: i });
    if (i % 5 === 0) world.attach(e, Name, `n${i}`);
    if (i % 3 === 0) both.push(i);
    else posOnly.push(i);
  }
  const qBoth = world.query([Position, Health]).collect();
  assert.deepEqual(qBoth, both);
  const qNone = world.query([Position], [Health]).collect();
  assert.deepEqual(qNone, posOnly);
  assert.equal(world.query([Position, Health, Name]).count(), 3); // i = 0, 15, 30

  // forEach hands back valid entity ids
  world.query([Position, Health]).forEach((index, entity) => {
    assert.ok(world.isAlive(entity));
    assert.equal(world.read(Position).x[index], index);
  });
});

test('ecs: growth beyond initial capacity preserves data and membership', () => {
  const { world, Position } = makeWorld(); // capacity 64
  const ids: EntityId[] = [];
  for (let i = 0; i < 1000; i++) {
    const e = world.spawn();
    world.attach(e, Position, { x: i * 2, y: -i });
    ids.push(e);
  }
  assert.equal(world.query([Position]).count(), 1000);
  const pos = world.read(Position);
  assert.equal(pos.x[777], 777 * 2);
  assert.equal(pos.y[777], -777);
  assert.ok(ids.every((e) => world.isAlive(e)));
});

// ---------------- model-based fuzz (roadmap M4 test objective) ----------------

test('ecs: 5000 random ops agree with a naive reference model', () => {
  const { world, Position, Health } = makeWorld();
  const comps = [Position, Health] as const;
  const rng = Rng.fromSeed(0xec5);

  // naive model: entity -> { alive, hasPos, hasHp, x }
  interface Model { id: EntityId; alive: boolean; has: [boolean, boolean]; x: number; }
  const model: Model[] = [];
  const live = (): Model[] => model.filter((m) => m.alive);

  for (let op = 0; op < 5000; op++) {
    const roll = rng.int(0, 99);
    if (roll < 25 || live().length === 0) {
      const id = world.spawn();
      model.push({ id, alive: true, has: [false, false], x: 0 });
    } else if (roll < 35) {
      const m = rng.pick(live());
      world.despawn(m.id);
      m.alive = false;
      m.has = [false, false];
    } else if (roll < 65) {
      const m = rng.pick(live());
      const c = rng.int(0, 1);
      if (!m.has[c]) {
        const x = rng.int(0, 1000);
        if (c === 0) world.attach(m.id, Position, { x });
        else world.attach(m.id, Health, { current: x });
        m.has[c] = true;
        if (c === 0) m.x = x;
      }
    } else if (roll < 80) {
      const m = rng.pick(live());
      const c = rng.int(0, 1);
      if (m.has[c]) {
        world.detach(m.id, comps[c] as (typeof comps)[number]);
        m.has[c] = false;
      }
    } else {
      const m = rng.pick(live());
      if (m.has[0]) {
        const x = rng.int(0, 1000);
        world.write(Position).x[m.id & 0x3fffff] = x; // index bits
        m.x = x;
      }
    }
  }

  // full reconciliation
  assert.equal(world.liveCount, live().length);
  for (const m of model) {
    assert.equal(world.isAlive(m.id), m.alive, `alive mismatch for ${m.id}`);
    if (!m.alive) continue;
    assert.equal(world.has(m.id, Position), m.has[0]);
    assert.equal(world.has(m.id, Health), m.has[1]);
    if (m.has[0]) assert.equal(world.read(Position).x[m.id & 0x3fffff], m.x);
  }
  const expectBoth = live()
    .filter((m) => m.has[0] && m.has[1])
    .map((m) => m.id & 0x3fffff)
    .sort((a, b) => a - b);
  assert.deepEqual(world.query([Position, Health]).collect(), expectBoth);
  const expectPosNotHp = live().filter((m) => m.has[0] && !m.has[1]).length;
  assert.equal(world.query([Position], [Health]).count(), expectPosNotHp);
});

// ---------------- access enforcement ----------------

test('ecs: declared-access scope permits declared, rejects undeclared', () => {
  const { world, Position, Health, Name } = makeWorld();
  const e = world.spawn();
  world.attach(e, Position);
  world.attach(e, Health);
  world.attach(e, Name, 'x');

  const access: SystemAccess = { reads: [Health], writes: [Position] };
  world.enter('mover', access);
  // allowed: declared write (implies read), declared read
  world.write(Position).x[0] = 5;
  assert.equal(world.read(Position).x[0], 5, 'write access implies read');
  assert.ok(world.read(Health).current);
  assert.ok(world.query([Position, Health]).count() === 1);
  // rejected: undeclared read, undeclared write, write on read-only, structural on undeclared
  assert.throws(() => world.readObj(Name), /access violation/);
  assert.throws(() => world.write(Health), /access violation/);
  assert.throws(() => world.attach(world.spawn(), Health), /access violation/);
  assert.throws(() => world.despawn(e), /access violation/, 'despawn touches undeclared Name');
  world.exit();

  // unscoped: everything allowed again
  world.write(Health).current[0] = 3;
  assert.throws(() => world.exit(), /without enter/);
});

test('ecs: kernel opens/closes access scopes around declared systems', () => {
  const { world, Position, Health } = makeWorld();
  const kernel = new Kernel(9);
  kernel.attachGuard(world);
  const e = world.spawn();
  world.attach(e, Position, { x: 1 });
  world.attach(e, Health, { current: 5 });

  const wellBehaved: SimSystem = {
    name: 'mover',
    period: 1,
    access: { writes: [Position] },
    update(_ctx: TickContext): void {
      const pos = world.write(Position);
      pos.x[0] = (pos.x[0] as number) + 1;
    },
  };
  const violator: SimSystem = {
    name: 'sneaky',
    period: 2, // runs on even ticks only
    access: { reads: [Position] },
    update(): void {
      world.write(Health).current[0] = 0; // undeclared write
    },
  };
  kernel.registerSystem(wellBehaved);
  kernel.registerSystem(violator);

  kernel.step(); // tick 1: only mover
  assert.equal(world.read(Position).x[0], 2);
  assert.throws(() => kernel.step(), /access violation: 'sneaky' writes 'health'/);
  // scope must not leak after the throw
  world.write(Health).current[0] = 5;
});

// ---------------- determinism hash ----------------

test('ecs: world hash reflects structure and values, stable across identical histories', () => {
  const build = (): World => {
    const { world, Position, Name } = makeWorld();
    for (let i = 0; i < 10; i++) {
      const e = world.spawn();
      world.attach(e, Position, { x: i, y: i * 2 });
      if (i % 2 === 0) world.attach(e, Name, `v${i}`);
    }
    return world;
  };
  const hashOf = (w: World): number => {
    let h = 0;
    w.hash((v) => (h = (h * 31 + v) >>> 0));
    return h;
  };
  const a = build();
  const b = build();
  assert.equal(hashOf(a), hashOf(b), 'identical histories hash identically');

  const { world: c, Position: PosC } = (() => {
    const made = makeWorld();
    for (let i = 0; i < 10; i++) {
      const e = made.world.spawn();
      made.world.attach(e, made.Position, { x: i, y: i * 2 });
      if (i % 2 === 0) made.world.attach(e, made.Name, `v${i}`);
    }
    return { world: made.world, Position: made.Position };
  })();
  c.write(PosC).y[3] = 123; // one value change
  assert.notEqual(hashOf(a), hashOf(c), 'value change must change the hash');
});
