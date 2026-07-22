/**
 * Sieges (roadmap M29; GDD §7/§8; doc 08 §8). Phased, per GDD: encircle →
 * assault (spatially, on the defender's defence layer) or starve (granary
 * countdown). Sorties let a defending garrison fight back.
 *
 * M55 (ADR-4 Amendment A1, Phase 8.1): there is ONE siege-resolution path.
 * `siege.begin` requires a STANDING DEFENCE LAYER — M28's world-map wall
 * enclosure no longer confers castle-ness, so `siege.setTarget`, the daily
 * bombard-vs-`Fortification`, `breaches`/`targetBuilding` and the breach-gated
 * flat assault are all gone. Encirclement, starvation, sortie and lift are
 * untouched (ADR-4 §2's pacing amendment stands).
 *
 * ENCIRCLE: `siege.begin` sets the besieging army's stance to `siege`
 * (armies.ts's fifth stance, inert since M26 — this is its payoff) and halts
 * it at the castle. One attacker per castle at a time (v1).
 *
 * ASSAULT is resolved by the M51 spatial resolver (assault.ts) walking the
 * defender's layer — it breaks walls itself, so there is no breach
 * precondition. A SORTIE is still combat.ts's ordinary resolver at multiplier
 * 1 (the defender's gambit, not a designed bloodbath). `siege-assault-watch`
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
import type { KingdomGameplay } from './kingdom.js';

const index = (id: number): number => id & 0x3fffff;

// ---------------------------------------------------------------- constants

export const SIEGE_RANGE = 1; // tiles (Chebyshev) — besieger must be at the castle
/** Siege-class units count this much toward an assault's wall-breaking (assault.ts). */
export const SIEGE_BOMBARD_BONUS = 3;
export const STARVATION_THRESHOLD = 5; // food units — "the granary is effectively empty"
export const STARVATION_SURRENDER_DAYS = 90; // GDD §8: "should take seasons"

const SIEGE_STANCE_INDEX = STANCES.indexOf('siege');

// ---------------------------------------------------------------- state

interface Siege {
  readonly castle: number; // villageId
  readonly attackerArmy: number;
  readonly attackerKingdom: number;
  daysStarving: number;
  assaultEngagementArmy: number; // 0 = no assault/sortie currently in progress
  /** M53 (OQ-9/OQ-11): tick by which a fallen capital's fate resolves; 0 = not fallen.
   * While set, the siege is FROZEN (no bombard, no starvation, no further assault) —
   * the succession module owns the outcome (capitulation or destruction). */
  fallenDeadline: number;
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
    const s: Siege = { castle, attackerArmy, attackerKingdom, daysStarving: 0, assaultEngagementArmy: 0, fallenDeadline: 0 };
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
      fold(s.daysStarving);
      fold(s.assaultEngagementArmy);
      fold(s.fallenDeadline);
    }
  }

  /** Save/restore (M47.6): `begin()` re-links both index maps, then the mutable
   * progress fields are copied over — same shape as CombatState's own pair.
   * v2 (M53) adds `fallenDeadline`; v3 (M55) DROPS `targetBuilding`/`breaches`
   * with the legacy breach-gated path. The campaign registers both migrations. */
  save(): { castle: number; attackerArmy: number; attackerKingdom: number; daysStarving: number; assaultEngagementArmy: number; fallenDeadline: number }[] {
    return this.all().map((s) => ({ ...s }));
  }

  restore(data: readonly { castle: number; attackerArmy: number; attackerKingdom: number; daysStarving: number; assaultEngagementArmy: number; fallenDeadline: number }[]): void {
    this.byCastle.clear();
    this.byArmy.clear();
    for (const d of data) {
      const s = this.begin(d.castle, d.attackerArmy, d.attackerKingdom);
      s.daysStarving = d.daysStarving;
      s.assaultEngagementArmy = d.assaultEngagementArmy;
      s.fallenDeadline = d.fallenDeadline;
    }
  }
}

// ---------------------------------------------------------------- gameplay

export type SpatialAssaultOutcome = 'captured' | 'repelled';

/** M51 (ADR-4 §2): the assault phase resolves SPATIALLY on the defender's defence
 * layer. Late-bound (`current` filled by the composition — defence registers after
 * siege). M55: this is now the ONLY resolution path, so a null return is no longer a
 * fall-through to a legacy path — it means the layer vanished under a siege that
 * `applicable` had already admitted, and the assault is refused rather than resolved. */
export interface SpatialAssaultHook {
  current?: (
    ctx: TickContext,
    siege: { castle: number; attackerArmy: number; attackerKingdom: number },
    origin: 'left' | 'right' | 'top' | 'bottom',
  ) => SpatialAssaultOutcome | null;
  /** True when this village index is siege-eligible: it has a standing defence layer.
   * M55 (A1): this is the SOLE eligibility test — castle-ness derives from the layer,
   * never from a world-map wall enclosure. */
  applicable?: (castleVillageIndex: number) => boolean;
}

/** M53 (OQ-9 item 2 / OQ-11): capital death. When a capture would land on a defence-layer
 * capital, the succession module CLAIMS the fall instead of letting ownership flip: `claim`
 * returns the deadline tick of the capitulation window (or the current tick under `ironman`
 * — an already-expired window is immediate destruction), or null to decline (not a layer
 * capital → the ordinary capture proceeds). Late-bound like SpatialAssaultHook: succession
 * registers after siege. */
export interface CapitalFallHook {
  claim?: (
    ctx: TickContext,
    fall: { castle: number; attackerArmy: number; attackerKingdom: number; defender: number },
  ) => number | null;
}

export interface SiegeGameplay {
  readonly state: SiegeState;
  /** M53: succession's exits from a fallen siege — spare it (capitulation; owner keeps the
   * castle) or close it after destruction (the castle no longer exists). Publishes the same
   * `siege.ended` every other exit uses. */
  endFallen(ctx: TickContext, castle: number, reason: 'capitulated' | 'destroyed' | 'besieger destroyed'): void;
}

export function registerSiegeGameplay(
  kernel: Kernel,
  world: World,
  game: VillageGameplay,
  militaryGame: MilitaryGameplay,
  armiesGame: ArmyGameplay,
  combatGame: CombatGameplay,
  kingdomGame: KingdomGameplay,
  spatial?: SpatialAssaultHook,
  capitalFall?: CapitalFallHook,
): SiegeGameplay {
  const { VillageCore, Stockpile } = game.comps;
  const { Unit, Army } = militaryGame;
  const { ArmyMovement, ArmyPath } = armiesGame;
  const { VillageOwner } = kingdomGame;
  const state = new SiegeState();
  kernel.addHashSource('siege', (fold) => state.fold(fold));

  const reject = (ctx: TickContext, what: string, reason: string, issuer: number): void => {
    ctx.events.publish({ type: 'village.rejected', tick: ctx.tick, data: { what, reason, issuer } });
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

  const endSiege = (ctx: TickContext, s: Siege, reason: string): void => {
    state.end(s);
    ctx.events.publish({ type: 'siege.ended', tick: ctx.tick, data: { castle: s.castle, army: s.attackerArmy, reason } });
  };

  const capture = (ctx: TickContext, s: Siege): void => {
    const ci = index(s.castle);
    // `from` (M51): the dispossessed owner — the composition's ownership index and
    // capital re-binding consume it exactly like village.occupied's loser field.
    const from = VillageOwner !== undefined ? (world.read(VillageOwner).kingdom[ci] as number) : 0;
    // M53: a defence-layer capital does not change hands — its fall is a KINGDOM event.
    // The hook claims it, the siege freezes, and succession resolves the window
    // (capitulation spares, refusal/expiry destroys). Starvation captures route here
    // too: starving a capital out must not dodge the capital-death rule.
    if (s.fallenDeadline === 0 && capitalFall?.claim !== undefined) {
      const deadline = capitalFall.claim(ctx, { castle: s.castle, attackerArmy: s.attackerArmy, attackerKingdom: s.attackerKingdom, defender: from });
      if (deadline !== null) {
        s.fallenDeadline = deadline;
        ctx.events.publish({
          type: 'siege.capitalFallen',
          tick: ctx.tick,
          data: { castle: s.castle, army: s.attackerArmy, attacker: s.attackerKingdom, defender: from, deadline },
        });
        return;
      }
    }
    if (VillageOwner !== undefined) world.write(VillageOwner).kingdom[ci] = s.attackerKingdom;
    ctx.events.publish({ type: 'siege.captured', tick: ctx.tick, data: { castle: s.castle, kingdom: s.attackerKingdom, from } });
    endSiege(ctx, s, 'captured');
  };

  // ---------------- commands ----------------

  kernel.registerCommand<{ armyId: number; villageId: number }>('siege.begin', (ctx, p, command) => {
    const armyId = p.armyId | 0;
    if (!world.isAlive(armyId as EntityId) || !world.has(armyId as EntityId, ArmyMovement)) {
      return reject(ctx, 'siege.begin', 'no such army', command.issuer);
    }
    const kingdomId = kingdomForIssuer(command.issuer);
    if (kingdomId === undefined || (world.read(Army).kingdomId[index(armyId)] as number) !== (kingdomId as number)) {
      return reject(ctx, 'siege.begin', 'not your army', command.issuer);
    }
    const villageId = p.villageId | 0;
    if (!world.isAlive(villageId as EntityId) || !world.has(villageId as EntityId, VillageCore)) {
      return reject(ctx, 'siege.begin', 'no such village', command.issuer);
    }
    // M55 (A1): castle-ness IS the defence layer. A world-map wall enclosure confers
    // nothing — an unfortified village at contact range is combat.ts's and occupation's
    // business, not the siege system's.
    if (!(spatial?.applicable?.(index(villageId)) ?? false)) {
      return reject(ctx, 'siege.begin', 'no defence layer — nothing to besiege', command.issuer);
    }
    const owner = ownerOfVillage(villageId);
    if (owner === undefined) return reject(ctx, 'siege.begin', 'sieges require a multi-kingdom campaign', command.issuer);
    if (owner === (kingdomId as number)) return reject(ctx, 'siege.begin', 'cannot besiege your own castle', command.issuer);
    if (state.siegeOfCastle(index(villageId)) !== undefined) return reject(ctx, 'siege.begin', 'already under siege', command.issuer);
    if (state.siegeOfArmy(armyId) !== undefined) return reject(ctx, 'siege.begin', 'this army is already besieging somewhere', command.issuer);
    const core = world.read(VillageCore);
    const ai = index(armyId);
    const m = world.read(ArmyMovement);
    const dist = Math.max(
      Math.abs((m.x[ai] as number) - (core.centerX[index(villageId)] as number)),
      Math.abs((m.y[ai] as number) - (core.centerY[index(villageId)] as number)),
    );
    if (dist > SIEGE_RANGE) return reject(ctx, 'siege.begin', 'the army must be at the castle to besiege it', command.issuer);

    world.write(ArmyMovement).stance[ai] = SIEGE_STANCE_INDEX;
    world.writeObj(ArmyPath).set(ai, []);
    state.begin(index(villageId), armyId, kingdomId as number);
    // `defender` (owner kingdom entity, M51): the app's warning chain pauses and deep-links
    // to the Castle panel when the encircled castle is the player's (ADR-4 §3).
    ctx.events.publish({ type: 'siege.begun', tick: ctx.tick, data: { castle: villageId, army: armyId, defender: owner } });
  });

  kernel.registerCommand<{ armyId: number }>('siege.lift', (ctx, p, command) => {
    const armyId = p.armyId | 0;
    const kingdomId = kingdomForIssuer(command.issuer);
    const s = state.siegeOfArmy(armyId);
    if (s === undefined) return reject(ctx, 'siege.lift', 'this army is not besieging anything', command.issuer);
    if (kingdomId === undefined || s.attackerKingdom !== (kingdomId as number)) return reject(ctx, 'siege.lift', 'not your siege', command.issuer);
    endSiege(ctx, s, 'lifted');
  });

  kernel.registerCommand<{ armyId: number; origin?: string }>('siege.assault', (ctx, p, command) => {
    const armyId = p.armyId | 0;
    const kingdomId = kingdomForIssuer(command.issuer);
    const s = state.siegeOfArmy(armyId);
    if (s === undefined) return reject(ctx, 'siege.assault', 'this army is not besieging anything', command.issuer);
    if (kingdomId === undefined || s.attackerKingdom !== (kingdomId as number)) return reject(ctx, 'siege.assault', 'not your siege', command.issuer);
    if (s.assaultEngagementArmy !== 0) return reject(ctx, 'siege.assault', 'an assault is already under way', command.issuer);
    if (s.fallenDeadline !== 0) return reject(ctx, 'siege.assault', 'the capital has already fallen — its fate is being decided', command.issuer);

    // ---- M51 (ADR-4 §2) / M55 (A1): the ONE path. The walk handles walls itself, so
    // there is no breach precondition; casualties and breaches are the resolver's, and a
    // repulse leaves the siege standing. Origin: the player's pick, else derived from
    // where the besieger stands relative to the castle (deterministic).
    if (spatial?.current === undefined) return reject(ctx, 'siege.assault', 'no defence layer to assault', command.issuer);
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
    // null = the layer went away under a siege `applicable` had admitted; refuse rather
    // than silently no-op, so the condition is visible instead of looking like a repulse.
    if (outcome === null) return reject(ctx, 'siege.assault', 'the defence layer is gone', command.issuer);
    if (outcome === 'captured') capture(ctx, s);
  });

  kernel.registerCommand<{ armyId: number }>('siege.sortie', (ctx, p, command) => {
    const armyId = p.armyId | 0; // the DEFENDING garrison army
    if (!world.isAlive(armyId as EntityId) || !world.has(armyId as EntityId, ArmyMovement)) {
      return reject(ctx, 'siege.sortie', 'no such army', command.issuer);
    }
    const kingdomId = kingdomForIssuer(command.issuer);
    if (kingdomId === undefined || (world.read(Army).kingdomId[index(armyId)] as number) !== (kingdomId as number)) {
      return reject(ctx, 'siege.sortie', 'not your army', command.issuer);
    }
    let target: Siege | undefined;
    for (const s of state.all()) {
      if (s.assaultEngagementArmy !== 0 || s.fallenDeadline !== 0) continue;
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
    if (target === undefined) return reject(ctx, 'siege.sortie', 'no besieging army in range to sortie against', command.issuer);
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

  // ---------------- daily: starvation (doc 08 §3/§8) ----------------
  // The registered NAME stays `siege-bombard` although M55 removed the bombard. A system
  // name is not a label here: `KernelSaveState.systemRngs` is keyed by it, so every save
  // carries this string and `restoreState` rejects a composition that no longer registers
  // it (the exact "composition mismatch" invariant). Renaming would also orphan this
  // system's named PRNG fork — the very property A1 leaned on when it argued determinism
  // is unaffected "because surviving systems' draws don't shift". Renaming is therefore a
  // SAVE-BREAKING change, and doing it here would land a landmine in M60, whose whole job
  // is loading M28-era saves. If the name is to be fixed, M60 should introduce a
  // system-name migration first and rename behind it.
  const siegeSystem: SimSystem = {
    name: 'siege-bombard',
    period: TICKS_PER_DAY,
    access: {
      writes: [...(VillageOwner !== undefined ? [VillageOwner] : [])],
      // VillageCore: pre-existing gap (predates M55, confirmed against HEAD), only ever
      // exercised now that a test drives a starvation capture through composeCampaign's
      // real subscriber chain rather than the old isolated harness. `capture()` publishes
      // `siege.captured`; campaign.ts's `rebindOnLoss` subscriber reacts SYNCHRONOUSLY and
      // reads VillageCore (via `villagesOfKingdom`) — the access-guard requires the
      // publishing SYSTEM to declare it, since a system's declared scope is what the guard
      // checks for everything that runs inside its update, subscribers included.
      reads: [Unit, Army, Stockpile, VillageCore],
    },
    update(ctx: TickContext): void {
      for (const s of state.all()) {
        if (s.fallenDeadline !== 0) continue; // M53: a fallen capital's siege is frozen
        // M55: a siege whose castle has no standing layer cannot be resolved by any path,
        // so it lifts rather than hanging forever. In practice this fires only on LOAD —
        // it is what carries the v2→v3 migration's "saved sieges of layer-less castles are
        // lifted" clause, which the pure-data migration function cannot see the world to do.
        if (!(spatial?.applicable?.(s.castle) ?? false)) {
          endSiege(ctx, s, 'lifted — no defence layer');
          continue;
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

  return {
    state,
    endFallen(ctx: TickContext, castle: number, reason: 'capitulated' | 'destroyed' | 'besieger destroyed'): void {
      const s = state.siegeOfCastle(index(castle));
      if (s === undefined || s.fallenDeadline === 0) return;
      endSiege(ctx, s, reason);
    },
  };
}
