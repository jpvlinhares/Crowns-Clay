/**
 * Wanderers world composition — shared VERBATIM by the golden-replay scenario
 * (scenarios.ts) and the M6 render demo session (simPort.ts). Any change here
 * changes golden hashes and must be re-recorded + called out in the PR.
 */
import type { EntityId } from '@crowns/core';
import {
  CalendarSystem,
  Kernel,
  TICKS_PER_DAY,
  World,
  type SimSystem,
  type TickContext,
  type SoAComponent,
} from '@crowns/sim';

export interface WanderersComposition {
  readonly kernel: Kernel;
  readonly world: World;
  readonly Position: SoAComponent<{ x: 'f64'; y: 'f64' }>;
  readonly Energy: SoAComponent<{ value: 'f64' }>;
  readonly widthTiles: number;
  readonly heightTiles: number;
}

export function composeWanderers(seed: number): WanderersComposition {
  const built = buildWanderers(seed);
  return { ...built, widthTiles: 512, heightTiles: 512 };
}

function buildWanderers(seed: number): Omit<WanderersComposition, 'widthTiles' | 'heightTiles'> {
  const kernel = new Kernel(seed);
  const world = new World(512);
  const Position = world.defineSoA('position', { x: 'f64', y: 'f64' });
  const Energy = world.defineSoA('energy', { value: 'f64' });

  const spawnOne = (x: number, y: number): void => {
    const e = world.spawn();
    world.attach(e, Position, { x, y });
    world.attach(e, Energy, { value: 100 });
  };

  const genesis: SimSystem = {
    name: 'genesis',
    period: 0x7fffffff, // fires on tick 1 only within any practical run length
    phase: 1,
    access: { writes: [Position, Energy] },
    update(ctx: TickContext): void {
      for (let n = 0; n < 200; n++) spawnOne(ctx.rng.int(0, 511), ctx.rng.int(0, 511));
    },
  };

  const movement: SimSystem = {
    name: 'movement',
    period: 1,
    access: { writes: [Position], reads: [Energy] },
    update(ctx: TickContext): void {
      const pos = world.write(Position);
      world.query([Position, Energy]).forEach((i) => {
        pos.x[i] = ((((pos.x[i] as number) + ctx.rng.int(-2, 2)) % 512) + 512) % 512;
        pos.y[i] = ((((pos.y[i] as number) + ctx.rng.int(-2, 2)) % 512) + 512) % 512;
      });
    },
  };

  const metabolism: SimSystem = {
    name: 'metabolism',
    period: TICKS_PER_DAY,
    phase: 5, // staggered off the day boundary (doc 08 §2)
    access: { writes: [Energy, Position] }, // despawn/replace touches both
    update(ctx: TickContext): void {
      const energy = world.write(Energy);
      const dead: EntityId[] = [];
      world.query([Energy]).forEach((i, entity) => {
        energy.value[i] = (energy.value[i] as number) - ctx.rng.int(1, 5);
        if ((energy.value[i] as number) <= 0) dead.push(entity);
      });
      for (const entity of dead) {
        world.despawn(entity);
        spawnOne(ctx.rng.int(0, 511), ctx.rng.int(0, 511)); // circle of life
      }
    },
  };

  kernel.registerSystem(genesis);
  kernel.registerSystem(new CalendarSystem());
  kernel.registerSystem(movement);
  kernel.registerSystem(metabolism);
  kernel.attachGuard(world);
  kernel.addHashSource('world', (fold) => world.hash(fold));

  kernel.registerCommand<{ dx: number; dy: number }>('wanderers.nudgeAll', (_ctx, payload) => {
    const pos = world.write(Position);
    world.query([Position]).forEach((i) => {
      pos.x[i] = ((((pos.x[i] as number) + payload.dx) % 512) + 512) % 512;
      pos.y[i] = ((((pos.y[i] as number) + payload.dy) % 512) + 512) % 512;
    });
  });
  kernel.registerCommand<{ below: number }>('wanderers.cullWeak', (ctx, payload) => {
    const energy = world.read(Energy);
    const cull: EntityId[] = [];
    world.query([Energy]).forEach((i, entity) => {
      if ((energy.value[i] as number) < payload.below) cull.push(entity);
    });
    for (const entity of cull) world.despawn(entity);
    ctx.events.publish({ type: 'wanderers.culled', tick: ctx.tick, data: { count: cull.length } });
  });

  return { kernel, world, Position, Energy };
}

