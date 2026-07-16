/**
 * Sieges (roadmap M29; GDD §7/§8; doc 08 §8). Phased, per GDD: encircle →
 * bombard (vs. the defence graph, castles.ts) → assault (breach paths) or
 * starve (granary countdown). Sorties let a defending garrison fight back.
 *
 * ENCIRCLE: `siege.begin` sets the besieging army's stance to `siege`
 * (armies.ts's fifth stance, inert since M26 — this is its payoff) and halts
 * it at the castle. One attacker per castle at a time (v1).
 *
 * BOMBARD (daily — sieges pace in days/seasons, not combat sub-ticks):
 * besieger attack (siege-class units count `SIEGE_BOMBARD_BONUS`×) divided by
 * the targeted wall/gate/tower/keep's armor comes off its `Fortification.hp`
 * (castles.ts). At 0 hp the segment is BREACHED — demolished via the same
 * `VillageOps.demolish` a player would use, so castles.ts's existing
 * completed/demolished-driven enclosure rebuild fires with no new plumbing.
 *
 * ASSAULT reuses combat.ts's exact resolver — `Engagement.casualtyMultiplier`
 * set to `ASSAULT_CASUALTY_MULTIPLIER` makes it bloody (GDD §8) without a
 * parallel combat implementation. A SORTIE is the same idea at multiplier 1
 * (the defender's gambit, not a designed bloodbath). `siege-assault-watch`
 * polls the engagement each tick rather than reacting to `battle.resolved`:
 * event subscribers in this codebase never publish further events (they only
 * ever touch component state), so capture/lift — which must themselves
 * publish — happen from a system's own tick context instead.
 *
 * STARVE: while besieged, a castle gets no outside supply (no cross-village
 * trade exists in this codebase at all, so this is already true by
 * construction — the new part is COUNTING it). Once the castle's food
 * stockpile has sat at/near zero for `STARVATION_SURRENDER_DAYS` (a season,
 * GDD §8 "starving a castle should take seasons"), the defenders capitulate:
 * captured with no bloody assault at all.
 *
 * DEFERRED: multiple simultaneous besiegers per castle, mining (vs. bombard),
 * mid-siege reinforcement logistics beyond what armies.ts already models,
 * and ransoming captured troops (Characters, M34).
 */
import type { EntityId } from '@crowns/core';
import { World } from '../ecs.js';
import type { Kernel, SimSystem, TickContext } from '../kernel.js';
import { TICKS_PER_DAY } from '../time.js';
import type { VillageGameplay } from './villages.js';
import type { MilitaryGameplay } from './military.js';
import { STANCES, type ArmyGameplay } from './armies.js';
import type { CombatGameplay } from './combat.js';
import type { CastleGameplay } from './castles.js';
import type { KingdomGameplay } from './kingdom.js';

const index = (id: number): number => id & 0x3fffff;

// ---------------------------------------------------------------- constants

export const SIEGE_RANGE = 1; // tiles (Chebyshev) — besieger must be at the castle
export const BASE_BOMBARD_DAMAGE = 40; // tuning: attack/armor ratio → wall HP lost per day
export const SIEGE_BOMBARD_BONUS = 3; // siege-class units count this much vs. the defence graph
export const ASSAULT_CASUALTY_MULTIPLIER = 2.5; // GDD §8: "storming should be bloody"
export const STARVATION_THRESHOLD = 5; // food units — "the granary is effectively empty"
export const STARVATION_SURRENDER_DAYS = 90; // GDD §8: "should take seasons"

const SIEGE_STANCE_INDEX = STANCES.indexOf('siege');

// ---------------------------------------------------------------- state

interface Siege {
  readonly castle: number; // villageId
  readonly attackerArmy: number;
  readonly attackerKingdom: number;
  targetBuilding: number; // 0 = none picked
  breaches: number;
  daysStarving: number;
  assaultEngagementArmy: number; // 0 = no assault/sortie currently in progress
}

/** Active sieges — a plain relational class (mirrors CombatState/DiplomacyState), not an entity. */
export class SiegeState {
  private readonly byCastle = new Map<number, Siege>();
  private readonly byArmy = new Map<number, Siege>();

  siegeOfCastle(castleId: number): Siege | undefined {
    return this.byCastle.get(castleId);
  }

  siegeOfArmy(armyId: number): Siege | undefined {
    return this.byArmy.get(armyId);
  }

  begin(castle: number, attackerArmy: number, attackerKingdom: number): Siege {
    const s: Siege = { castle, attackerArmy, attackerKingdom, targetBuilding: 0, breaches: 0, daysStarving: 0, assaultEngagementArmy: 0 };
    this.byCastle.set(castle, s);
    this.byArmy.set(attackerArmy, s);
    return s;
  }

  end(s: Siege): void {
    this.byCastle.delete(s.castle);
    this.byArmy.delete(s.attackerArmy);
  }

  all(): Siege[] {
    return [...this.byCastle.values()].sort((a, b) => a.castle - b.castle);
  }

  fold(fold: (v: number) => void): void {
    for (const s of this.all()) {
      fold(s.castle);
      fold(s.attackerArmy);
      fold(s.attackerKingdom);
      fold(s.targetBuilding);
      fold(s.breaches);
      fold(s.daysStarving);
      fold(s.assaultEngagementArmy);
    }
  }

  /** Save/restore (M47.6): `begin()` re-links both index maps, then the mutable
   * progress fields are copied over — same shape as CombatState's own pair. */
  save(): { castle: number; attackerArmy: number; attackerKingdom: number; targetBuilding: number; breaches: number; daysStarving: number; assaultEngagementArmy: number }[] {
    return this.all().map((s) => ({ ...s }));
  }

  restore(data: readonly { castle: number; attackerArmy: number; attackerKingdom: number; targetBuilding: number; breaches: number; daysStarving: number; assaultEngagementArmy: number }[]): void {
    this.byCastle.clear();
    this.byArmy.clear();
    for (const d of data) {
      const s = this.begin(d.castle, d.attackerArmy, d.attackerKingdom);
      s.targetBuilding = d.targetBuilding;
      s.breaches = d.breaches;
      s.daysStarving = d.daysStarving;
      s.assaultEngagementArmy = d.assaultEngagementArmy;
    }
  }
}

// ---------------------------------------------------------------- gameplay

export type SpatialAssaultOutcome = 'captured' | 'repelled';

/** M51 (ADR-4 §2): the assault phase resolves SPATIALLY on the defender's capital
 * defence layer when one exists. Late-bound (`current` filled by the composition —
 * defence registers after siege); returning null means "not applicable" (non-capital
 * castle, no layer) and the legacy breach-and-engagement path runs unchanged. */
export interface SpatialAssaultHook {
  current?: (
    ctx: TickContext,
    siege: { castle: number; attackerArmy: number; attackerKingdom: number },
    origin: 'left' | 'right' | 'top' | 'bottom',
  ) => SpatialAssaultOutcome | null;
  /** True when this village index is siege-eligible via its defence layer (a capital with a
   * standing keep) even without a world-map wall enclosure — ADR-4 §6: castle-ness derives
   * from the layer once it is the fortification surface. */
  applicable?: (castleVillageIndex: number) => boolean;
}

export interface SiegeGameplay {
  readonly state: SiegeState;
}

export function registerSiegeGameplay(
  kernel: Kernel,
  world: World,
  game: VillageGameplay,
  militaryGame: MilitaryGameplay,
  armiesGame: ArmyGameplay,
  castleGame: CastleGameplay,
  combatGame: CombatGameplay,
  kingdomGame: KingdomGameplay,
  spatial?: SpatialAssaultHook,
): SiegeGameplay {
  const { VillageCore, BuildingCore, Stockpile } = game.comps;
  const { Unit, Army, ops } = militaryGame;
  const { ArmyMovement, ArmyPath } = armiesGame;
  const { Fortification } = castleGame;
  const { VillageOwner } = kingdomGame;
  const state = new SiegeState();
  kernel.addHashSource('siege', (fold) => state.fold(fold));

  const reject = (ctx: TickContext, what: string, reason: string): void => {
    ctx.events.publish({ type: 'village.rejected', tick: ctx.tick, data: { what, reason } });
  };

  const kingdomForIssuer = (issuer: number): EntityId | undefined => {
    const all = kingdomGame.kingdomEntities();
    return all[issuer - 1] ?? all[0];
  };

  const ownerOfVillage = (villageId: number): number | undefined => {
    if (VillageOwner === undefined) return undefined;
    return world.read(VillageOwner).kingdom[index(villageId)] as number;
  };

  const committedCount = (armyId: number): number => {
    const u = world.read(Unit);
    let total = 0;
    world.query([Unit]).forEach((ui) => {
      if ((u.armyId[ui] as number) === armyId && (u.complete[ui] as number) === 1) total += u.count[ui] as number;
    });
    return total;
  };

  /** Any hostile-to-the-attacker garrison army standing at the castle (ascending order). */
  const defenderAt = (castle: number, defenderKingdom: number): number | undefined => {
    const a = world.read(Army);
    const m = world.read(ArmyMovement);
    const core = world.read(VillageCore);
    const ci = index(castle);
    const cx = core.centerX[ci] as number;
    const cy = core.centerY[ci] as number;
    let found: number | undefined;
    world.query([ArmyMovement]).forEach((ai, entity) => {
      if (found !== undefined) return;
      if ((a.kingdomId[ai] as number) !== defenderKingdom) return;
      if (committedCount(entity as number) <= 0) return;
      const dist = Math.max(Math.abs((m.x[ai] as number) - cx), Math.abs((m.y[ai] as number) - cy));
      if (dist <= SIEGE_RANGE) found = entity as number;
    });
    return found;
  };

  const endSiege = (ctx: TickContext, s: Siege, reason: string): void => {
    state.end(s);
    ctx.events.publish({ type: 'siege.ended', tick: ctx.tick, data: { castle: s.castle, army: s.attackerArmy, reason } });
  };

  const capture = (ctx: TickContext, s: Siege): void => {
    const ci = index(s.castle);
    // `from` (M51): the dispossessed owner — the composition's ownership index and
    // capital re-binding consume it exactly like village.occupied's loser field.
    const from = VillageOwner !== undefined ? (world.read(VillageOwner).kingdom[ci] as number) : 0;
    if (VillageOwner !== undefined) world.write(VillageOwner).kingdom[ci] = s.attackerKingdom;
    ctx.events.publish({ type: 'siege.captured', tick: ctx.tick, data: { castle: s.castle, kingdom: s.attackerKingdom, from } });
    endSiege(ctx, s, 'captured');
  };

  // ---------------- commands ----------------

  kernel.registerCommand<{ armyId: number; villageId: number }>('siege.begin', (ctx, p, command) => {
    const armyId = p.armyId | 0;
    if (!world.isAlive(armyId as EntityId) || !world.has(armyId as EntityId, ArmyMovement)) {
      return reject(ctx, 'siege.begin', 'no such army');
    }
    const kingdomId = kingdomForIssuer(command.issuer);
    if (kingdomId === undefined || (world.read(Army).kingdomId[index(armyId)] as number) !== (kingdomId as number)) {
      return reject(ctx, 'siege.begin', 'not your army');
    }
    const villageId = p.villageId | 0;
    if (!world.isAlive(villageId as EntityId) || !world.has(villageId as EntityId, VillageCore)) {
      return reject(ctx, 'siege.begin', 'no such village');
    }
    // castle-ness: a world-map wall enclosure (M28), or — M51, ADR-4 §6 — a capital whose
    // defence layer stands (the layer IS the fortification surface for capitals)
    if ((world.read(VillageCore).isCastle[index(villageId)] as number) !== 1 && !(spatial?.applicable?.(index(villageId)) ?? false)) {
      return reject(ctx, 'siege.begin', 'not a castle — nothing to besiege');
    }
    const owner = ownerOfVillage(villageId);
    if (owner === undefined) return reject(ctx, 'siege.begin', 'sieges require a multi-kingdom campaign');
    if (owner === (kingdomId as number)) return reject(ctx, 'siege.begin', 'cannot besiege your own castle');
    if (state.siegeOfCastle(index(villageId)) !== undefined) return reject(ctx, 'siege.begin', 'already under siege');
    if (state.siegeOfArmy(armyId) !== undefined) return reject(ctx, 'siege.begin', 'this army is already besieging somewhere');
    const core = world.read(VillageCore);
    const ai = index(armyId);
    const m = world.read(ArmyMovement);
    const dist = Math.max(
      Math.abs((m.x[ai] as number) - (core.centerX[index(villageId)] as number)),
      Math.abs((m.y[ai] as number) - (core.centerY[index(villageId)] as number)),
    );
    if (dist > SIEGE_RANGE) return reject(ctx, 'siege.begin', 'the army must be at the castle to besiege it');

    world.write(ArmyMovement).stance[ai] = SIEGE_STANCE_INDEX;
    world.writeObj(ArmyPath).set(ai, []);
    state.begin(index(villageId), armyId, kingdomId as number);
    // `defender` (owner kingdom entity, M51): the app's warning chain pauses and deep-links
    // to the Castle panel when the encircled castle is the player's (ADR-4 §3).
    ctx.events.publish({ type: 'siege.begun', tick: ctx.tick, data: { castle: villageId, army: armyId, defender: owner } });
  });

  kernel.registerCommand<{ armyId: number; buildingId: number }>('siege.setTarget', (ctx, p) => {
    const s = state.siegeOfArmy(p.armyId | 0);
    if (s === undefined) return reject(ctx, 'siege.setTarget', 'this army is not besieging anything');
    const buildingId = p.buildingId | 0;
    if (!world.isAlive(buildingId as EntityId) || !world.has(buildingId as EntityId, BuildingCore)) {
      return reject(ctx, 'siege.setTarget', 'no such building');
    }
    const b = world.read(BuildingCore);
    const bi = index(buildingId);
    if (index(b.village[bi] as number) !== s.castle) return reject(ctx, 'siege.setTarget', 'that building is not part of the besieged castle');
    const def = game.ops.buildingDef(b.def[bi] as number);
    if (def.defense === undefined) return reject(ctx, 'siege.setTarget', 'only wall/gate/tower/keep segments can be targeted');
    s.targetBuilding = buildingId;
    ctx.events.publish({ type: 'siege.targetSet', tick: ctx.tick, data: { castle: s.castle, buildingId } });
  });

  kernel.registerCommand<{ armyId: number }>('siege.lift', (ctx, p, command) => {
    const armyId = p.armyId | 0;
    const kingdomId = kingdomForIssuer(command.issuer);
    const s = state.siegeOfArmy(armyId);
    if (s === undefined) return reject(ctx, 'siege.lift', 'this army is not besieging anything');
    if (kingdomId === undefined || s.attackerKingdom !== (kingdomId as number)) return reject(ctx, 'siege.lift', 'not your siege');
    endSiege(ctx, s, 'lifted');
  });

  kernel.registerCommand<{ armyId: number; origin?: string }>('siege.assault', (ctx, p, command) => {
    const armyId = p.armyId | 0;
    const kingdomId = kingdomForIssuer(command.issuer);
    const s = state.siegeOfArmy(armyId);
    if (s === undefined) return reject(ctx, 'siege.assault', 'this army is not besieging anything');
    if (kingdomId === undefined || s.attackerKingdom !== (kingdomId as number)) return reject(ctx, 'siege.assault', 'not your siege');
    if (s.assaultEngagementArmy !== 0) return reject(ctx, 'siege.assault', 'an assault is already under way');

    // ---- M51 (ADR-4 §2): a capital with a defence layer resolves SPATIALLY — the walk
    // handles walls itself, so no breach precondition; casualties and breaches are the
    // resolver's, and a repulse leaves the siege standing exactly like an inconclusive
    // legacy assault. Origin: the player's pick, else derived from where the besieger
    // stands relative to the castle (deterministic).
    if (spatial?.current !== undefined) {
      const origin = ((): 'left' | 'right' | 'top' | 'bottom' => {
        if (p.origin === 'left' || p.origin === 'right' || p.origin === 'top' || p.origin === 'bottom') return p.origin;
        const core = world.read(VillageCore);
        const m = world.read(ArmyMovement);
        const ai = index(armyId);
        const dx = (m.x[ai] as number) - (core.centerX[s.castle] as number);
        const dy = (m.y[ai] as number) - (core.centerY[s.castle] as number);
        return Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'top' : 'bottom';
      })();
      const outcome = spatial.current(ctx, { castle: s.castle, attackerArmy: s.attackerArmy, attackerKingdom: s.attackerKingdom }, origin);
      if (outcome !== null) {
        if (outcome === 'captured') capture(ctx, s);
        return;
      }
    }

    // ---- legacy path (non-capital castles): breach-gated flat engagement ----
    if (s.breaches <= 0) return reject(ctx, 'siege.assault', 'no breach — bombard the walls first');
    const defender = defenderAt(s.castle, ownerOfVillage(s.castle) as number);
    if (defender === undefined) {
      capture(ctx, s);
      return;
    }
    combatGame.state.begin(s.attackerArmy, defender, ASSAULT_CASUALTY_MULTIPLIER);
    s.assaultEngagementArmy = defender;
    ctx.events.publish({ type: 'siege.assaultBegun', tick: ctx.tick, data: { castle: s.castle, army: armyId, defender } });
  });

  kernel.registerCommand<{ armyId: number }>('siege.sortie', (ctx, p, command) => {
    const armyId = p.armyId | 0; // the DEFENDING garrison army
    if (!world.isAlive(armyId as EntityId) || !world.has(armyId as EntityId, ArmyMovement)) {
      return reject(ctx, 'siege.sortie', 'no such army');
    }
    const kingdomId = kingdomForIssuer(command.issuer);
    if (kingdomId === undefined || (world.read(Army).kingdomId[index(armyId)] as number) !== (kingdomId as number)) {
      return reject(ctx, 'siege.sortie', 'not your army');
    }
    let target: Siege | undefined;
    for (const s of state.all()) {
      if (s.assaultEngagementArmy !== 0) continue;
      if ((ownerOfVillage(s.castle) as number | undefined) !== (kingdomId as number)) continue;
      const ci = index(s.castle);
      const core = world.read(VillageCore);
      const m = world.read(ArmyMovement);
      const ai = index(armyId);
      const dist = Math.max(
        Math.abs((m.x[ai] as number) - (core.centerX[ci] as number)),
        Math.abs((m.y[ai] as number) - (core.centerY[ci] as number)),
      );
      if (dist <= SIEGE_RANGE) target = s;
    }
    if (target === undefined) return reject(ctx, 'siege.sortie', 'no besieging army in range to sortie against');
    combatGame.state.begin(target.attackerArmy, armyId, 1);
    target.assaultEngagementArmy = armyId;
    ctx.events.publish({ type: 'siege.sortieBegun', tick: ctx.tick, data: { castle: target.castle, defender: armyId } });
  });

  // ---------------- every tick: watch assault/sortie engagements for their outcome ----------------
  // Event subscribers in this codebase never publish further events (they only ever touch
  // component state) — capture/lift must themselves publish, so this polls the engagement's
  // resolution from a system's own tick context instead of reacting to `battle.resolved`.
  const assaultWatch: SimSystem = {
    name: 'siege-assault-watch',
    period: 1,
    access: { writes: [...(VillageOwner !== undefined ? [VillageOwner] : [])], reads: [Unit] },
    update(ctx: TickContext): void {
      for (const s of state.all()) {
        if (s.assaultEngagementArmy === 0) continue;
        if (combatGame.state.engagementOf(s.attackerArmy) !== undefined) continue; // still fighting
        const attackerLeft = committedCount(s.attackerArmy);
        const defenderLeft = committedCount(s.assaultEngagementArmy);
        s.assaultEngagementArmy = 0;
        if (attackerLeft > 0 && defenderLeft <= 0) {
          capture(ctx, s);
        } else if (attackerLeft <= 0) {
          // the besieger was wiped out (assault repelled, or a sortie routed them
          // entirely) — nothing left to besiege with
          endSiege(ctx, s, 'besieger destroyed');
        }
        // otherwise inconclusive (both sides still have survivors) — the siege
        // simply continues; the attacker may bombard again or retry the assault
      }
    },
  };

  // ---------------- daily: bombard the target, and starvation (doc 08 §3/§8) ----------------
  const siegeSystem: SimSystem = {
    name: 'siege-bombard',
    period: TICKS_PER_DAY,
    access: {
      writes: [Fortification, BuildingCore, ...(VillageOwner !== undefined ? [VillageOwner] : [])],
      reads: [Unit, Army, Stockpile],
    },
    update(ctx: TickContext): void {
      for (const s of state.all()) {
        if (s.targetBuilding !== 0) {
          if (!world.isAlive(s.targetBuilding as EntityId)) {
            s.targetBuilding = 0;
          } else {
            const b = world.read(BuildingCore);
            const bi = index(s.targetBuilding);
            const def = game.ops.buildingDef(b.def[bi] as number);
            let attackTotal = 0;
            const u = world.read(Unit);
            world.query([Unit]).forEach((ui) => {
              if ((u.armyId[ui] as number) !== s.attackerArmy || (u.complete[ui] as number) !== 1) return;
              const unitDef = ops.unitDef(u.def[ui] as number);
              const bonus = unitDef.class === 'siege' ? SIEGE_BOMBARD_BONUS : 1;
              attackTotal += (u.count[ui] as number) * unitDef.stats.attack * bonus;
            });
            const damage = (attackTotal / Math.max(1, def.defense?.armor ?? 1)) * BASE_BOMBARD_DAMAGE;
            const fort = world.write(Fortification);
            const hp = Math.max(0, (fort.hp[bi] as number) - damage);
            fort.hp[bi] = hp;
            if (hp <= 0) {
              const target = s.targetBuilding;
              s.targetBuilding = 0;
              s.breaches++;
              game.ops.demolish(ctx, target);
              ctx.events.publish({ type: 'siege.breached', tick: ctx.tick, data: { castle: s.castle, building: target } });
            }
          }
        }

        const stock = world.readObj(Stockpile).tryGet(s.castle);
        const foodCode = game.ops.resourceCode('base:resource.food') as number;
        const food = stock?.get(foodCode) ?? 0;
        if (food <= STARVATION_THRESHOLD) {
          s.daysStarving++;
          if (s.daysStarving >= STARVATION_SURRENDER_DAYS) capture(ctx, s);
        } else {
          s.daysStarving = 0;
        }
      }
    },
  };

  kernel.registerSystem(assaultWatch);
  kernel.registerSystem(siegeSystem);

  return { state };
}
