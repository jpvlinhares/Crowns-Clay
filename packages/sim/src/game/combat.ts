/**
 * Field combat (roadmap M27; GDD §8; doc 08 §2 slot 4, §8).
 *
 * ENGAGEMENT DETECTION (doc 08 §7): every tick, after movement, any two
 * armies from DIFFERENT kingdoms that are neither already fighting nor at
 * peace (an active non-aggression pact, if diplomacy is composed — an
 * optional dependency, mirrors economy.ts's INERT_MODIFIERS pattern) and are
 * within `ENGAGEMENT_RADIUS` tiles of each other are locked into a fight.
 * Empty armies (no complete units) never engage.
 *
 * RESOLUTION runs in COMBAT SUB-TICKS — 4 per tick (doc 08 §8) — via
 * `resolveSubRound`, a single function shared by BOTH paths:
 *   - the tick-driven system, which calls it 4× per tick, spread over up to
 *     `MAX_ENGAGEMENT_TICKS` real ticks (GDD §8 "typically 2–12 ticks"),
 *     publishing incremental events so a player could reinforce or withdraw;
 *   - `battle.autoResolve`, a command that calls the SAME function in a tight
 *     loop to immediate completion.
 * Because both paths are the identical function, "auto vs. manual parity"
 * (the M27 T objective) holds by construction, not by coincidence — the test
 * proves it empirically over many randomised battles rather than asserting
 * it as an architectural accident.
 *
 * MORALE is the true HP (GDD §8): each sub-round, aggregate attack (count ×
 * stats.attack × soft counter vs. the enemy's largest class × current morale
 * fraction) divides into the enemy's aggregate defense, and the result is
 * subtracted from enemy morale, spread across their units by count share. A
 * unit whose morale drops under `ROUT_MORALE_THRESHOLD` may ROUT — it
 * survives (retreats, `armyId` cleared) rather than being annihilated,
 * matching "most battles end in rout, not annihilation". A fraction of the
 * damage also converts to real CASUALTIES (`Unit.count` shrinks) — the same
 * irreversible loss as army.ts's starvation attrition, not a disband/desert
 * (M25/M26) that returns population.
 *
 * DEFERRED (not this milestone): front/flank/reserve lines and formation
 * orders (GDD's "pre-battle" player interactions) — v1 fights as one
 * aggregate line per side; kill/wound/capture casualty splitting and ransom
 * (captives feed diplomacy per GDD) stay a single "casualties" number until
 * Characters (M34) gives capture something to mean. `Engagement.casualtyMultiplier`
 * (M29 hook, game/siege.ts) is the one field this module exposes for a later
 * milestone to tune — sieges reuse this exact resolver for assaults/sorties
 * rather than duplicating combat math.
 */
import type { EntityId, Rng } from '@crowns/core';
import { World } from '../ecs.js';
import type { Kernel, SimSystem, TickContext } from '../kernel.js';
import type { MilitaryGameplay } from './military.js';
import type { ArmyGameplay } from './armies.js';
import type { KingdomGameplay } from './kingdom.js';

const index = (id: number): number => id & 0x3fffff;

// ---------------------------------------------------------------- constants

export const ENGAGEMENT_RADIUS = 1; // tiles (Chebyshev) — doc 08 §7 tile co-occupancy
export const SUBROUNDS_PER_TICK = 4; // doc 08 §8
export const MAX_ENGAGEMENT_TICKS = 12; // GDD §8: field battles typically last 2–12 ticks
export const ROUT_MORALE_THRESHOLD = 20;
export const ROUT_CHANCE_PER_SUBROUND = 0.25; // per under-threshold unit, per sub-round
export const BASE_MORALE_DAMAGE = 18; // tuning constant: attack/defense ratio → morale lost per sub-round
export const CASUALTY_FRACTION_OF_DAMAGE = 0.15; // share of morale damage that also costs real headcount

/** Optional cross-module hook (mirrors DiplomacyOptions) — absent ⇒ always hostile. */
export interface CombatOptions {
  hasNonAggressionPact?(kingdomA: EntityId, kingdomB: EntityId): boolean;
}

// ---------------------------------------------------------------- state

export interface Engagement {
  readonly armyA: number;
  readonly armyB: number;
  ticks: number;
  /** M29 (siege.ts): >1 makes casualties bloodier — GDD §8 "storming should be
   * bloody". Field battles and sorties leave this at 1 (ordinary combat math). */
  casualtyMultiplier: number;
}

/** Active field engagements — a plain relational class (like DiplomacyState), not an entity. */
export class CombatState {
  private readonly byArmy = new Map<number, Engagement>();

  engagementOf(armyId: number): Engagement | undefined {
    return this.byArmy.get(armyId);
  }

  begin(armyA: number, armyB: number, casualtyMultiplier = 1): Engagement {
    const e: Engagement = { armyA, armyB, ticks: 0, casualtyMultiplier };
    this.byArmy.set(armyA, e);
    this.byArmy.set(armyB, e);
    return e;
  }

  end(e: Engagement): void {
    this.byArmy.delete(e.armyA);
    this.byArmy.delete(e.armyB);
  }

  /** All active engagements, ascending by the lower army id (deterministic). */
  all(): Engagement[] {
    const seen = new Set<Engagement>();
    for (const e of this.byArmy.values()) seen.add(e);
    return [...seen].sort((a, b) => Math.min(a.armyA, a.armyB) - Math.min(b.armyA, b.armyB));
  }

  /** Sorted-key fold — deterministic regardless of Map iteration/mutation order. */
  fold(fold: (v: number) => void): void {
    for (const e of this.all()) {
      fold(e.armyA);
      fold(e.armyB);
      fold(e.ticks);
      fold(Math.round(e.casualtyMultiplier * 1000));
    }
  }
}

// ---------------------------------------------------------------- gameplay

export interface CombatGameplay {
  readonly state: CombatState;
}

export function registerCombatGameplay(
  kernel: Kernel,
  world: World,
  militaryGame: MilitaryGameplay,
  armiesGame: ArmyGameplay,
  kingdomGame: KingdomGameplay,
  options: CombatOptions = {},
): CombatGameplay {
  const { Unit, Army, ops } = militaryGame;
  const { ArmyMovement } = armiesGame;
  const state = new CombatState();
  kernel.addHashSource('combat', (fold) => state.fold(fold));

  const reject = (ctx: TickContext, what: string, reason: string): void => {
    ctx.events.publish({ type: 'village.rejected', tick: ctx.tick, data: { what, reason } });
  };

  const kingdomForIssuer = (issuer: number): EntityId | undefined => {
    const all = kingdomGame.kingdomEntities();
    return all[issuer - 1] ?? all[0];
  };

  const committedCount = (armyId: number): number => {
    const u = world.read(Unit);
    let total = 0;
    world.query([Unit]).forEach((ui) => {
      if ((u.armyId[ui] as number) === armyId && (u.complete[ui] as number) === 1) total += u.count[ui] as number;
    });
    return total;
  };

  const dominantClass = (armyId: number): string | undefined => {
    const u = world.read(Unit);
    const byClass = new Map<string, number>();
    world.query([Unit]).forEach((ui) => {
      if ((u.armyId[ui] as number) !== armyId || (u.complete[ui] as number) !== 1) return;
      const cls = ops.unitDef(u.def[ui] as number).class;
      byClass.set(cls, (byClass.get(cls) ?? 0) + (u.count[ui] as number));
    });
    let best: string | undefined;
    let bestCount = 0;
    for (const [cls, count] of [...byClass.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      if (count > bestCount) {
        best = cls;
        bestCount = count;
      }
    }
    return best;
  };

  /** One combat sub-round (doc 08 §8) — shared by the tick system and auto-resolve. */
  function resolveSubRound(e: Engagement, rng: Rng): void {
    const u = world.write(Unit);
    const enemyClassOf = new Map<number, string | undefined>([
      [e.armyA, dominantClass(e.armyB)],
      [e.armyB, dominantClass(e.armyA)],
    ]);

    const attackOf = (armyId: number): number => {
      const enemyClass = enemyClassOf.get(armyId);
      let total = 0;
      world.query([Unit]).forEach((ui) => {
        if ((u.armyId[ui] as number) !== armyId || (u.complete[ui] as number) !== 1) return;
        const def = ops.unitDef(u.def[ui] as number);
        const counter = enemyClass !== undefined ? (def.counters?.[enemyClass as never] ?? 1) : 1;
        const moraleFraction = 0.5 + 0.5 * ((u.morale[ui] as number) / Math.max(1, def.stats.moraleBase));
        total += (u.count[ui] as number) * def.stats.attack * counter * moraleFraction;
      });
      return total;
    };
    const defenseOf = (armyId: number): number => {
      let total = 0;
      world.query([Unit]).forEach((ui) => {
        if ((u.armyId[ui] as number) !== armyId || (u.complete[ui] as number) !== 1) return;
        total += (u.count[ui] as number) * ops.unitDef(u.def[ui] as number).stats.defense;
      });
      return total;
    };

    const attackA = attackOf(e.armyA);
    const attackB = attackOf(e.armyB);
    const defenseA = Math.max(1, defenseOf(e.armyA));
    const defenseB = Math.max(1, defenseOf(e.armyB));
    const damageToB = (attackA / defenseB) * BASE_MORALE_DAMAGE * (0.85 + rng.nextFloat() * 0.3);
    const damageToA = (attackB / defenseA) * BASE_MORALE_DAMAGE * (0.85 + rng.nextFloat() * 0.3);

    const applyDamage = (armyId: number, damage: number): void => {
      if (damage <= 0) return;
      const total = committedCount(armyId);
      if (total <= 0) return;
      const routed: EntityId[] = [];
      world.query([Unit]).forEach((ui, entity) => {
        if ((u.armyId[ui] as number) !== armyId || (u.complete[ui] as number) !== 1) return;
        const share = (u.count[ui] as number) / total;
        const moraleLoss = damage * share;
        u.morale[ui] = Math.max(0, (u.morale[ui] as number) - moraleLoss);
        const casualties = Math.min(u.count[ui] as number, moraleLoss * CASUALTY_FRACTION_OF_DAMAGE * e.casualtyMultiplier);
        u.count[ui] = Math.max(0, (u.count[ui] as number) - casualties);
        if ((u.morale[ui] as number) < ROUT_MORALE_THRESHOLD && rng.nextFloat() < ROUT_CHANCE_PER_SUBROUND) {
          routed.push(entity);
        }
      });
      for (const entity of routed) u.armyId[index(entity as number)] = 0; // survives, leaves the fight
    };
    applyDamage(e.armyB, damageToB);
    applyDamage(e.armyA, damageToA);
  }

  /** True once one side has nothing left committed, or the tick cap is hit. */
  function isResolved(e: Engagement): boolean {
    return committedCount(e.armyA) <= 0 || committedCount(e.armyB) <= 0 || e.ticks >= MAX_ENGAGEMENT_TICKS;
  }

  function finalize(ctx: TickContext, e: Engagement): void {
    const countA = committedCount(e.armyA);
    const countB = committedCount(e.armyB);
    const winner = countA === countB ? 0 : countA > countB ? e.armyA : e.armyB;
    state.end(e);
    ctx.events.publish({
      type: 'battle.resolved', tick: ctx.tick,
      data: { armyA: e.armyA, armyB: e.armyB, remainingA: countA, remainingB: countB, winner },
    });
  }

  // ---------------- detection: proximity + hostility (doc 08 §7) ----------------
  const detection: SimSystem = {
    name: 'combat-detection',
    period: 1,
    access: { reads: [ArmyMovement, Army, Unit] },
    update(): void {
      const m = world.read(ArmyMovement);
      const a = world.read(Army);
      const armies: number[] = [];
      world.query([ArmyMovement]).forEach((_ai, entity) => armies.push(entity as number));
      armies.sort((x, y) => x - y);
      for (let i = 0; i < armies.length; i++) {
        const armyA = armies[i] as number;
        if (state.engagementOf(armyA) !== undefined) continue;
        if (committedCount(armyA) <= 0) continue;
        for (let j = i + 1; j < armies.length; j++) {
          const armyB = armies[j] as number;
          if (state.engagementOf(armyB) !== undefined) continue;
          const kA = a.kingdomId[index(armyA)] as number;
          const kB = a.kingdomId[index(armyB)] as number;
          if (kA === kB) continue;
          if (options.hasNonAggressionPact?.(kA as EntityId, kB as EntityId)) continue;
          if (committedCount(armyB) <= 0) continue;
          const ai = index(armyA);
          const bi = index(armyB);
          const dist = Math.max(Math.abs((m.x[ai] as number) - (m.x[bi] as number)), Math.abs((m.y[ai] as number) - (m.y[bi] as number)));
          if (dist <= ENGAGEMENT_RADIUS) state.begin(armyA, armyB);
        }
      }
    },
  };

  // ---------------- resolution: 4 sub-rounds per tick while engaged (doc 08 §8) ----------------
  const resolution: SimSystem = {
    name: 'combat-resolution',
    period: 1,
    access: { writes: [Unit], reads: [Army, ArmyMovement] },
    update(ctx: TickContext): void {
      for (const e of state.all()) {
        for (let s = 0; s < SUBROUNDS_PER_TICK && !isResolved(e); s++) resolveSubRound(e, ctx.rng);
        e.ticks++;
        if (isResolved(e)) finalize(ctx, e);
      }
    },
  };

  kernel.registerSystem(detection);
  kernel.registerSystem(resolution);

  // ---------------- commands ----------------

  kernel.registerCommand<{ armyId: number }>('army.withdraw', (ctx, p, command) => {
    const armyId = p.armyId | 0;
    if (!world.isAlive(armyId as EntityId) || !world.has(armyId as EntityId, Army)) {
      return reject(ctx, 'army.withdraw', 'no such army');
    }
    const kingdomId = kingdomForIssuer(command.issuer);
    if (kingdomId === undefined || (world.read(Army).kingdomId[index(armyId)] as number) !== (kingdomId as number)) {
      return reject(ctx, 'army.withdraw', 'not your army');
    }
    const e = state.engagementOf(armyId);
    if (e === undefined) return reject(ctx, 'army.withdraw', 'not engaged in a battle');
    state.end(e);
    ctx.events.publish({ type: 'battle.withdrawn', tick: ctx.tick, data: { army: armyId } });
  });

  kernel.registerCommand<{ armyId: number }>('battle.autoResolve', (ctx, p, command) => {
    const armyId = p.armyId | 0;
    const e = state.engagementOf(armyId);
    if (e === undefined) return reject(ctx, 'battle.autoResolve', 'not engaged in a battle');
    const kingdomId = kingdomForIssuer(command.issuer);
    const a = world.read(Army);
    const belongsToIssuer =
      kingdomId !== undefined &&
      ((a.kingdomId[index(e.armyA)] as number) === (kingdomId as number) || (a.kingdomId[index(e.armyB)] as number) === (kingdomId as number));
    if (!belongsToIssuer) return reject(ctx, 'battle.autoResolve', 'not your battle');
    let rounds = 0;
    while (!isResolved(e) && rounds < MAX_ENGAGEMENT_TICKS * SUBROUNDS_PER_TICK) {
      resolveSubRound(e, ctx.rng);
      rounds++;
    }
    e.ticks = MAX_ENGAGEMENT_TICKS;
    finalize(ctx, e);
  });

  return { state };
}
