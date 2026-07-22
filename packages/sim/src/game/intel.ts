/**
 * Defence intel (roadmap M54; ADR-4 §4). Split what is physically visible from
 * what is not:
 *
 *   - STRUCTURES (walls, towers, keep) preview as a SNAPSHOT as of the
 *     observer's last scouting contact with the target's capital — the layer
 *     serves the stale copy, never the live layout. Contact is CURRENT
 *     proximity (any observer village within scouting range of the target
 *     capital), not fog's permanent reveals — plus the obvious case: an army
 *     BESIEGING the capital is looking straight at the walls.
 *   - GARRISON strength is NEVER shown as truth: it travels as an ADR-2
 *     `garrisonStrength` belief (contact-refreshed, confidence-decayed,
 *     deterministically noisy) recorded by the same sensor cadence the
 *     `armyStrength` beliefs use — this module's consumers make the knowledge
 *     model's second real consumer (doc 07 §6's stated direction).
 *
 * The asymmetry resolves symmetrically: AI attackers consult the SAME snapshot
 * and the SAME belief through `estimateAssaultResistance` before committing an
 * assault (ai/military.ts's advice hook), so "attacking blind into an
 * auto-resolver" is a choice, not the only option — for man and machine alike.
 *
 * Snapshots are real sim state (the AI reads them): folded into the state hash
 * and serialized via an optional save section, like every relational class
 * since M47.6.
 */
import type { BuildingDef } from '@crowns/data';
import { World } from '../ecs.js';
import type { Kernel, SimSystem, TickContext } from '../kernel.js';
import { TICKS_PER_DAY } from '../time.js';
import type { VillageGameplay } from './villages.js';
import type { DefenceGameplay } from './defence.js';
import type { SiegeGameplay } from './siege.js';

const index = (id: number): number => id & 0x3fffff;

// ---------------------------------------------------------------- constants

/** Attack strength one garrisoned man adds to the resistance estimate — mirrors the
 * resolver's `count × stats.attack` keep verdict at the spearman baseline (attack 5). */
export const ESTIMATE_STRENGTH_PER_MAN = 5;
/** Estimated resistance a standing tower adds (chip fire over the approach). */
export const ESTIMATE_TOWER_RESISTANCE = 15;
/** Estimated resistance a wall segment adds (time under fire while breaking it). */
export const ESTIMATE_WALL_RESISTANCE = 2;
/** Below this fraction of the estimated resistance the escalade is HOPELESS —
 * the AI's counsel becomes 'lift' (walk away) rather than an eternal parked siege. */
export const ASSAULT_HOPELESS_FRACTION = 0.5;

// ---------------------------------------------------------------- state

export interface IntelStructureRec {
  readonly def: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface IntelSnapshot {
  /** Tick of the observation — the UI's "as of day N" and the staleness signal. */
  readonly tick: number;
  readonly structures: readonly IntelStructureRec[];
}

/** Per-(observer, target) stale structure snapshots — a plain relational class. */
export class IntelState {
  private readonly byObserver = new Map<number, Map<number, IntelSnapshot>>();

  get(observer: number, target: number): IntelSnapshot | undefined {
    return this.byObserver.get(observer)?.get(target);
  }

  set(observer: number, target: number, snapshot: IntelSnapshot): void {
    let inner = this.byObserver.get(observer);
    if (inner === undefined) this.byObserver.set(observer, (inner = new Map()));
    inner.set(target, snapshot);
  }

  fold(fold: (v: number) => void): void {
    for (const o of [...this.byObserver.keys()].sort((a, b) => a - b)) {
      const inner = this.byObserver.get(o) as Map<number, IntelSnapshot>;
      for (const t of [...inner.keys()].sort((a, b) => a - b)) {
        const snap = inner.get(t) as IntelSnapshot;
        fold(o);
        fold(t);
        fold(snap.tick);
        for (const s of snap.structures) {
          for (let i = 0; i < s.def.length; i++) fold(s.def.charCodeAt(i));
          fold(s.x);
          fold(s.y);
        }
      }
    }
  }

  save(): { o: number; t: number; tick: number; structures: IntelStructureRec[] }[] {
    const out: { o: number; t: number; tick: number; structures: IntelStructureRec[] }[] = [];
    for (const o of [...this.byObserver.keys()].sort((a, b) => a - b)) {
      const inner = this.byObserver.get(o) as Map<number, IntelSnapshot>;
      for (const t of [...inner.keys()].sort((a, b) => a - b)) {
        const snap = inner.get(t) as IntelSnapshot;
        out.push({ o, t, tick: snap.tick, structures: snap.structures.map((s) => ({ ...s })) });
      }
    }
    return out;
  }

  restore(data: readonly { o: number; t: number; tick: number; structures: readonly IntelStructureRec[] }[]): void {
    this.byObserver.clear();
    for (const d of data) this.set(d.o, d.t, { tick: d.tick, structures: d.structures.map((s) => ({ ...s })) });
  }
}

// ---------------------------------------------------------------- the estimate

/** Fog-symmetric expected assault resistance: the keep's hold threshold plus what the
 * SNAPSHOT shows standing plus what the observer BELIEVES the garrison musters. Both
 * inputs may be stale or noisy — honest mistakes are the design (doc 07 §6). */
export function estimateAssaultResistance(
  structures: readonly IntelStructureRec[],
  believedGarrison: number,
  defOf: (defId: string) => BuildingDef | undefined,
  keepHoldStrength: number,
): number {
  let resistance = keepHoldStrength;
  for (const s of structures) {
    const def = defOf(s.def);
    const kind = def?.defense?.kind;
    if (kind === 'tower') resistance += ESTIMATE_TOWER_RESISTANCE;
    else if (kind === 'wall' || kind === 'gate') resistance += ESTIMATE_WALL_RESISTANCE;
  }
  return resistance + Math.max(0, believedGarrison) * ESTIMATE_STRENGTH_PER_MAN;
}

// ---------------------------------------------------------------- registrar

export interface IntelOptions {
  readonly kingdomCount: number;
  /** Current-proximity contact radius (the belief sensors' own definition). */
  readonly contactRadius: number;
  kingdomIdOf(kingdomIndex: number): number | undefined;
  capitalOf(kingdomIndex: number): number | null;
  villagesOfKingdom(kingdomIndex: number): readonly { vi: number; x: number; y: number }[];
}

export interface IntelGameplay {
  readonly state: IntelState;
}

export function registerDefenceIntel(
  kernel: Kernel,
  world: World,
  game: VillageGameplay,
  defenceGame: DefenceGameplay,
  siegeGame: SiegeGameplay,
  options: IntelOptions,
): IntelGameplay {
  const { VillageCore } = game.comps;
  const { DefenceStructure } = defenceGame;
  const state = new IntelState();
  kernel.addHashSource('intel', (fold) => state.fold(fold));

  // M57: intel stays capital-scoped (kingdom-pair keyed, doc 07 §4) — the layer itself is
  // village-keyed now, so a snapshot's structures are the TARGET KINGDOM'S CAPITAL village's.
  const captureStructures = (targetKingdomIndex: number): IntelStructureRec[] => {
    const capitalVi = options.capitalOf(targetKingdomIndex);
    if (capitalVi === null) return [];
    const s = world.read(DefenceStructure);
    const out: IntelStructureRec[] = [];
    world.query([DefenceStructure]).forEach((si) => {
      if (index(s.village[si] as number) !== capitalVi) return;
      const def = game.ops.buildingDef(s.def[si] as number);
      out.push({ def: def.id, x: s.x[si] as number, y: s.y[si] as number, w: def.footprint.w, h: def.footprint.h });
    });
    return out.sort((a, b) => a.y - b.y || a.x - b.x || (a.def < b.def ? -1 : 1));
  };

  const system: SimSystem = {
    name: 'defence-intel',
    period: TICKS_PER_DAY,
    phase: 11, // the belief sensors' own stagger slot — intel and beliefs refresh together
    access: { reads: [DefenceStructure, VillageCore] },
    update(ctx: TickContext): void {
      const core = world.read(VillageCore);
      for (let o = 0; o < options.kingdomCount; o++) {
        const mine = options.villagesOfKingdom(o);
        const myId = options.kingdomIdOf(o);
        if (myId === undefined) continue;
        for (let t = 0; t < options.kingdomCount; t++) {
          if (t === o) continue;
          const capital = options.capitalOf(t);
          if (capital === null) continue;
          const cx = core.centerX[capital] as number;
          const cy = core.centerY[capital] as number;
          const proximity = mine.some((mv) => Math.max(Math.abs(mv.x - cx), Math.abs(mv.y - cy)) <= options.contactRadius);
          const besieging = siegeGame.state.siegeOfCastle(capital)?.attackerKingdom === myId;
          if (proximity || besieging) {
            state.set(o, t, { tick: ctx.tick, structures: captureStructures(t) });
          }
        }
      }
    },
  };
  kernel.registerSystem(system);

  return { state };
}
