/**
 * Village occupation (M47.8; doc 12 R1 — makes the Conquest track reachable).
 *
 * Sieges (M29) only apply to CASTLES ("not a castle — nothing to besiege"),
 * which left plain villages literally unconquerable — the M47.7 audit note.
 * Occupation is the deliberately simple complement: an army standing in an
 * AT-WAR enemy village whose owner fields no defender nearby raises its
 * banner after `OCCUPATION_DAYS` consecutive days. Castles keep their full
 * siege treatment (walls mean the defence graph decides, not a countdown);
 * occupation explicitly skips any village whose enclosure is intact.
 *
 * The countdown map is real sim state: folded into stateHash and serialized
 * via save()/restore() like every other relational class (M47.6 discipline).
 * Composition-gated: the unified campaign registers it; the legacy AI
 * harness wrapper does NOT (its M22-M46 emergent-outcome tests were recorded
 * without it — same pinning reasoning as its inert victory tracker).
 */
import type { EntityId } from '@crowns/core';
import { World } from '../ecs.js';
import type { Kernel, SimSystem, TickContext } from '../kernel.js';
import { TICKS_PER_DAY } from '../time.js';
import type { VillageGameplay } from './villages.js';
import type { MilitaryGameplay } from './military.js';
import type { ArmyGameplay } from './armies.js';
import type { KingdomGameplay } from './kingdom.js';
import type { CastleGameplay } from './castles.js';

export const OCCUPATION_DAYS = 5; // consecutive days an unopposed army must hold the square
export const OCCUPATION_RADIUS = 2; // Chebyshev tiles from the village centre that count as "in it"
export const DEFENDER_RADIUS = 6; // an owner army this close contests the occupation

export interface OccupationOptions {
  /** War gate (game/diplomacy.ts): occupation requires a declared war, not mere hostility. */
  isAtWar(a: EntityId, b: EntityId): boolean;
  /** M53 (OQ-9 item 2): a defence-layer capital cannot be occupied by countdown — the layer
   * IS its fortification surface, so only a siege (and the capital-death chain) takes it.
   * Late-bound closure (the layer registers after occupation); default: nothing exempt. */
  exempt?(villageIndex: number): boolean;
}

interface Occupation {
  readonly village: number; // dense index
  readonly army: number; // entity id
  readonly kingdom: number; // attacker kingdom entity id
  days: number;
}

export class OccupationState {
  private readonly byVillage = new Map<number, Occupation>();

  get(villageIndex: number): Occupation | undefined {
    return this.byVillage.get(villageIndex);
  }

  set(o: Occupation): void {
    this.byVillage.set(o.village, o);
  }

  clear(villageIndex: number): void {
    this.byVillage.delete(villageIndex);
  }

  all(): Occupation[] {
    return [...this.byVillage.values()].sort((a, b) => a.village - b.village);
  }

  fold(fold: (v: number) => void): void {
    for (const o of this.all()) {
      fold(o.village);
      fold(o.army);
      fold(o.kingdom);
      fold(o.days);
    }
  }

  save(): { village: number; army: number; kingdom: number; days: number }[] {
    return this.all().map((o) => ({ ...o }));
  }

  restore(data: readonly { village: number; army: number; kingdom: number; days: number }[]): void {
    this.byVillage.clear();
    for (const d of data) this.byVillage.set(d.village, { ...d });
  }
}

export interface OccupationGameplay {
  readonly state: OccupationState;
}

export function registerOccupationGameplay(
  kernel: Kernel,
  world: World,
  game: VillageGameplay,
  militaryGame: MilitaryGameplay,
  armiesGame: ArmyGameplay,
  kingdomGame: KingdomGameplay,
  castleGame: CastleGameplay,
  options: OccupationOptions,
): OccupationGameplay {
  const { VillageCore } = game.comps;
  const { Army, Unit } = militaryGame;
  const { ArmyMovement } = armiesGame;
  const { VillageOwner } = kingdomGame;
  const state = new OccupationState();
  kernel.addHashSource('occupation', (fold) => state.fold(fold));

  const committedCount = (armyId: number): number => {
    const u = world.read(Unit);
    let total = 0;
    world.query([Unit]).forEach((ui) => {
      if ((u.armyId[ui] as number) === armyId && (u.complete[ui] as number) === 1) total += u.count[ui] as number;
    });
    return total;
  };

  const system: SimSystem = {
    name: 'occupation',
    period: TICKS_PER_DAY,
    phase: 9, // after movement/combat have settled the day's positions
    access: {
      reads: [VillageCore, Army, ArmyMovement, Unit],
      writes: [...(VillageOwner !== undefined ? [VillageOwner] : [])],
    },
    update(ctx: TickContext): void {
      if (VillageOwner === undefined) return; // single-kingdom: nothing to occupy
      const core = world.read(VillageCore);
      const owner = world.read(VillageOwner);
      const a = world.read(Army);
      const m = world.read(ArmyMovement);

      // armies by position, deterministic ascending entity order
      const armies: { id: number; kingdom: number; x: number; y: number }[] = [];
      world.query([Army, ArmyMovement]).forEach((ai, entity) => {
        armies.push({ id: entity as number, kingdom: a.kingdomId[ai] as number, x: m.x[ai] as number, y: m.y[ai] as number });
      });

      world.query([VillageCore]).forEach((vi) => {
        const ownerId = owner.kingdom[vi] as number;
        const cx = core.centerX[vi] as number;
        const cy = core.centerY[vi] as number;
        // castles are the siege system's business while their walls stand — and (M53) so
        // are defence-layer capitals, whose "walls" live on the layer, not the world map
        if ((core.isCastle[vi] as number) === 1 || (options.exempt?.(vi) ?? false)) {
          state.clear(vi);
          return;
        }
        const occupier = armies.find(
          (army) =>
            army.kingdom !== ownerId &&
            committedCount(army.id) > 0 &&
            Math.max(Math.abs(army.x - cx), Math.abs(army.y - cy)) <= OCCUPATION_RADIUS &&
            options.isAtWar(army.kingdom as EntityId, ownerId as EntityId),
        );
        const defended = armies.some(
          (army) =>
            army.kingdom === ownerId &&
            committedCount(army.id) > 0 &&
            Math.max(Math.abs(army.x - cx), Math.abs(army.y - cy)) <= DEFENDER_RADIUS,
        );
        if (occupier === undefined || defended) {
          state.clear(vi);
          return;
        }
        const current = state.get(vi);
        const days = current !== undefined && current.army === occupier.id ? current.days + 1 : 1;
        if (days >= OCCUPATION_DAYS) {
          state.clear(vi);
          world.write(VillageOwner).kingdom[vi] = occupier.kingdom;
          ctx.events.publish({
            type: 'village.occupied',
            tick: ctx.tick,
            data: { village: vi, kingdom: occupier.kingdom, from: ownerId, army: occupier.id },
          });
        } else {
          state.set({ village: vi, army: occupier.id, kingdom: occupier.kingdom, days });
          ctx.events.publish({
            type: 'village.occupying',
            tick: ctx.tick,
            data: { village: vi, kingdom: occupier.kingdom, days, needed: OCCUPATION_DAYS },
          });
        }
      });
    },
  };
  kernel.registerSystem(system);

  return { state };
}
