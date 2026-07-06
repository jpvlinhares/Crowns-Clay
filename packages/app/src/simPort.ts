/**
 * Binds a composed simulation session to a TransportPort speaking the protocol
 * (TDD §1/§4). Transport-agnostic: the browser worker entry (sim.worker.ts)
 * and headless tools use the same bridge, so behaviour is identical everywhere.
 *
 * M6 session = the wanderers composition (also the golden-replay scenario):
 * the first thing the renderer shows is, deliberately, a world whose exact
 * evolution is pinned by committed fixtures.
 */
import type { FromSimMessage, TerrainSnapshot, ToSimMessage, TransportPort, WorldMeta } from '@crowns/protocol';
import { TickDriver, type Kernel, type TickResult, type World } from '@crowns/sim';
import { SnapshotEmitter } from './snapshots.js';
import { BuildingEmitter, VillageStatsEmitter } from './buildingEmitter.js';
import { composeTerra } from './terra.js';

export interface SimSession {
  readonly kernel: Kernel;
  readonly driver: TickDriver;
  readonly emitter: SnapshotEmitter;
  readonly worldMeta: WorldMeta;
  readonly terrain: TerrainSnapshot;
  readonly world: World;
  readonly buildingEmitter: BuildingEmitter;
  readonly villageEmitter: VillageStatsEmitter;
}

export function createSession(seed: number, clock?: () => number): SimSession {
  const c = composeTerra(seed, clock); // terrain demo (M8) — golden scenario 'terra-demo'
  return {
    kernel: c.kernel,
    driver: new TickDriver(c.kernel, { maxTicksPerAdvance: 32 }),
    emitter: new SnapshotEmitter(c.world, c.Position),
    worldMeta: { widthTiles: c.worldDef.width, heightTiles: c.worldDef.height },
    terrain: c.terrain,
    world: c.world,
    buildingEmitter: new BuildingEmitter(c.world, c.game),
    villageEmitter: new VillageStatsEmitter(c.world, c.game, c.popGame.Population),
  };
}

export function connectKernelToPort(port: TransportPort, clock?: () => number): void {
  let session: SimSession | null = null;
  let telemetryEvery = 0; // 0 = off
  let lastTelemetryTick = 0;

  const send = (message: FromSimMessage): void => port.postMessage(message);
  const flush = (results: TickResult[]): void => {
    if (session === null || results.length === 0) return;
    send({
      kind: 'ticked',
      fromTick: (results[0] as TickResult).tick,
      toTick: (results[results.length - 1] as TickResult).tick,
      events: results.flatMap((r) => [...r.events]),
      executed: results.flatMap((r) => [...r.executed]),
    });
    const { spawned, moved, despawned } = session.emitter.delta();
    const b = session.buildingEmitter.delta();
    const villageStats = session.villageEmitter.delta();
    if (
      spawned.length > 0 || moved.length > 0 || despawned.length > 0 || villageStats.length > 0 ||
      b.added.length > 0 || b.progress.length > 0 || b.removed.length > 0
    ) {
      send({
        kind: 'snapshotDelta',
        tick: session.kernel.currentTick,
        spawned,
        moved,
        despawned,
        villageStats,
        buildingsAdded: b.added,
        buildingProgress: b.progress,
        buildingsRemoved: b.removed,
      });
    }
    // sampling stream: at most one report per flush, whenever the interval has
    // elapsed since the last report (flushes are per-batch, not per-tick)
    if (telemetryEvery > 0 && session.kernel.currentTick >= lastTelemetryTick + telemetryEvery) {
      lastTelemetryTick = session.kernel.currentTick;
      const t = session.kernel.getTelemetry();
      send({
        kind: 'debugTelemetry',
        tick: session.kernel.currentTick,
        tickMsLast: t.tickMsLast,
        tickMsAvg: t.tickMsAvg,
        systems: t.systems.map((s) => ({ ...s })),
        entityCount: session.world.liveCount,
      });
    }
  };

  port.onMessage((raw) => {
    const message = raw as ToSimMessage;
    try {
      switch (message.kind) {
        case 'init':
          session = createSession(message.seed, clock);
          send({ kind: 'ready', seed: message.seed });
          // Genesis runs on tick 1; step it so the first full snapshot is populated.
          flushlessFirstTick(session);
          send({
            kind: 'snapshotFull',
            tick: session.kernel.currentTick,
            world: session.worldMeta,
            terrain: session.terrain,
            entities: session.emitter.full(),
            buildings: session.buildingEmitter.full(),
          });
          return;
        case 'submit':
          for (const draft of message.drafts) session?.kernel.submit(draft);
          return;
        case 'setSpeed':
          session?.driver.setSpeed(message.speed);
          return;
        case 'pump':
          if (session !== null) flush(session.driver.advance(message.dtMs));
          return;
        case 'step': {
          if (session === null) return;
          const results: TickResult[] = [];
          for (let i = 0; i < message.ticks; i++) results.push(session.kernel.step());
          flush(results);
          return;
        }
        case 'debug': {
          if (session === null) return;
          if (message.op === 'telemetry') {
            telemetryEvery = message.enabled ? Math.max(1, message.everyTicks ?? 10) : 0;
            lastTelemetryTick = session.kernel.currentTick;
          } else if (message.op === 'inspect') {
            send({
              kind: 'debugEntity',
              inspection: session.world.inspect(message.entityId as never),
            });
          } else if (message.op === 'commands') {
            send({ kind: 'debugCommands', types: session.kernel.commandTypes() });
          }
          return;
        }
        case 'requestHash':
          if (session !== null) {
            send({
              kind: 'hash',
              tick: session.kernel.currentTick,
              hash: session.kernel.stateHash(),
            });
          }
          return;
      }
    } catch (error) {
      send({ kind: 'fatal', message: error instanceof Error ? error.message : String(error) });
    }
  });
}

function flushlessFirstTick(session: SimSession): void {
  if (session.kernel.currentTick === 0) session.kernel.step();
}
