/**
 * Binds a composed simulation session to a TransportPort speaking the protocol
 * (TDD §1/§4). Transport-agnostic: the browser worker entry (sim.worker.ts)
 * and headless tools use the same bridge, so behaviour is identical everywhere.
 *
 * M6 session = the wanderers composition (also the golden-replay scenario):
 * the first thing the renderer shows is, deliberately, a world whose exact
 * evolution is pinned by committed fixtures.
 */
import type { FromSimMessage, TerrainSnapshot, ToSimMessage, TransportPort, UICatalog, WorldMeta } from '@crowns/protocol';
import { TickDriver, type CampaignSave, type Kernel, type SaveManager, type TickResult, type World } from '@crowns/sim';
import { SnapshotEmitter } from './snapshots.js';
import { BuildingEmitter, RoadEmitter, VillageStatsEmitter } from './buildingEmitter.js';
import { composeTerra } from './terra.js';
import { autosaveSlot, getSlot, putSlot } from './saveStore.js';

export interface SimSession {
  readonly kernel: Kernel;
  readonly driver: TickDriver;
  readonly emitter: SnapshotEmitter;
  readonly worldMeta: WorldMeta;
  readonly terrain: TerrainSnapshot;
  readonly world: World;
  readonly buildingEmitter: BuildingEmitter;
  readonly villageEmitter: VillageStatsEmitter;
  readonly roadEmitter: RoadEmitter;
  readonly saves: SaveManager;
  /** Player-facing content catalog (M18) — defs projected for the ui package. */
  readonly catalog: UICatalog;
  kingdomInfo(): { activeEdicts: string[] };
}

export function createSession(seed: number, clock?: () => number): SimSession {
  const c = composeTerra(seed, clock); // terrain demo (M8) — golden scenario 'terra-demo'
  const catalog: UICatalog = {
    buildings: [...c.db.buildings.values()]
      .filter((def) => !def.tags.includes('center')) // centres come from settlers, not the palette
      .map((def) => ({
        id: def.id,
        name: def.name,
        category: def.category,
        w: def.footprint.w,
        h: def.footprint.h,
        tier: def.requires?.villageTier ?? 1,
        cost: Object.entries(def.cost).map(([resId, amount]): [string, number] => [
          c.db.resources.get(resId)?.name ?? resId,
          amount,
        ]),
      })),
    edicts: [...c.db.edicts.values()].map((def) => ({ id: def.id, name: def.name, upkeep: def.upkeep })),
  };
  return {
    catalog,
    kingdomInfo() {
      const kingdom = c.kingdomGame.kingdomEntity();
      if (kingdom === null) return { activeEdicts: [] };
      const active = c.world.readObj(c.kingdomGame.ActiveEdicts).tryGet((kingdom as number) & 0x3fffff);
      const ids = [...c.db.edicts.keys()].sort();
      return { activeEdicts: [...(active?.keys() ?? [])].sort((a, b) => a - b).map((code) => ids[code] as string) };
    },
    kernel: c.kernel,
    driver: new TickDriver(c.kernel, { maxTicksPerAdvance: 32 }),
    emitter: new SnapshotEmitter(c.world, c.Position),
    worldMeta: { widthTiles: c.worldDef.width, heightTiles: c.worldDef.height },
    terrain: c.terrain,
    world: c.world,
    buildingEmitter: new BuildingEmitter(c.world, c.game),
    villageEmitter: new VillageStatsEmitter(c.world, c.game, c.popGame.Population, c.db),
    roadEmitter: new RoadEmitter(c.logiGame.roads),
    saves: c.saves,
  };
}

export function connectKernelToPort(port: TransportPort, clock?: () => number): void {
  let session: SimSession | null = null;
  let telemetryEvery = 0; // 0 = off
  let lastTelemetryTick = 0;
  let autosaveCounter = 0;

  const send = (message: FromSimMessage): void => port.postMessage(message);

  const sendFullSnapshot = (): void => {
    if (session === null) return;
    send({
      kind: 'snapshotFull',
      tick: session.kernel.currentTick,
      world: session.worldMeta,
      terrain: session.terrain,
      entities: session.emitter.full(),
      buildings: session.buildingEmitter.full(),
      roads: session.roadEmitter.full(),
      catalog: session.catalog,
      kingdom: session.kingdomInfo(),
    });
  };

  /** Rebuild the session from a save payload and hydrate it (TDD §8 load path). */
  const loadFromPayload = (payload: string): void => {
    try {
      const save = JSON.parse(payload) as CampaignSave;
      const next = createSession(save.header.seed, clock);
      const migrations = next.saves.hydrate(save); // throws on mismatch — old session stays live
      session = next;
      send({ kind: 'loadResult', ok: true, tick: session.kernel.currentTick, migrations });
      sendFullSnapshot();
    } catch (error) {
      send({
        kind: 'loadResult',
        ok: false,
        tick: session?.kernel.currentTick ?? 0,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  /** Serialize between ticks in the worker (doc 11: no main/sim stall). */
  const saveToSlot = (slot: string): void => {
    if (session === null) return;
    const payload = JSON.stringify(session.saves.snapshot());
    void putSlot(slot, payload)
      .then(() => send({ kind: 'saveResult', slot, ok: true, bytes: payload.length }))
      .catch((error: unknown) =>
        send({ kind: 'saveResult', slot, ok: false, bytes: 0, error: error instanceof Error ? error.message : String(error) }),
      );
  };
  const flush = (results: TickResult[]): void => {
    if (session === null || results.length === 0) return;
    send({
      kind: 'ticked',
      fromTick: (results[0] as TickResult).tick,
      toTick: (results[results.length - 1] as TickResult).tick,
      events: results.flatMap((r) => [...r.events]),
      executed: results.flatMap((r) => [...r.executed]),
    });
    // autosave scheduler (doc 05 §10): every season boundary, into the ring —
    // between ticks, in the worker, and only where IndexedDB exists
    if (typeof indexedDB !== 'undefined' && results.some((r) => r.events.some((e) => e.type === 'time.seasonStarted'))) {
      saveToSlot(autosaveSlot(autosaveCounter++));
    }
    const { spawned, moved, despawned } = session.emitter.delta();
    const b = session.buildingEmitter.delta();
    const villageStats = session.villageEmitter.delta();
    const roadsAdded = session.roadEmitter.delta();
    if (
      spawned.length > 0 || moved.length > 0 || despawned.length > 0 || villageStats.length > 0 ||
      b.added.length > 0 || b.progress.length > 0 || b.removed.length > 0 || roadsAdded.length > 0
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
        roadsAdded,
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
          sendFullSnapshot();
          return;
        case 'save':
          saveToSlot(message.slot);
          return;
        case 'load':
          void getSlot(message.slot)
            .then((payload) => {
              if (payload === undefined) {
                send({ kind: 'loadResult', ok: false, tick: session?.kernel.currentTick ?? 0, error: `slot '${message.slot}' is empty` });
                return;
              }
              loadFromPayload(payload);
            })
            .catch((error: unknown) =>
              send({ kind: 'loadResult', ok: false, tick: session?.kernel.currentTick ?? 0, error: error instanceof Error ? error.message : String(error) }),
            );
          return;
        case 'exportSave':
          if (session !== null) send({ kind: 'exportResult', payload: JSON.stringify(session.saves.snapshot()) });
          return;
        case 'importSave':
          loadFromPayload(message.payload);
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
