/**
 * Victory & defeat (roadmap M37; GDD §16; doc 08 §2 slot 20).
 *
 * FIVE TRACKS, one daily system (`victory-tracker`, doc 08's row 20):
 *   - CONQUEST: control `conquestShare` of all currently-existing villages,
 *     or every rival kingdom is defeated (last-village rule, below).
 *   - HEGEMONY: every surviving rival is bound to this kingdom — an active
 *     `PACT_ALLIANCE` (game/diplomacy.ts, M35) or a sworn vassal — for
 *     `hegemonyYears` CONSECUTIVE years (a streak that resets the instant
 *     any rival breaks free); inert without a `diplomacy` dependency wired.
 *   - LEGACY: complete `wonderCount` distinct `wonder`-tagged buildings
 *     (content/base/defs/buildings/wonders.json5) anywhere in the kingdom —
 *     tracked incrementally off `building.completed` (event-driven, not a
 *     daily building scan), NOT a strict build order despite GDD §16 calling
 *     it a "chain" — a v1 simplification, same spirit as M28's fixed castle
 *     ring standing in for doc 07 §5's terrain-adapted templates.
 *   - PROSPERITY: average happiness across the kingdom's OWN villages stays
 *     at or above `prosperityHappiness` for `prosperityYears` CONSECUTIVE
 *     years (same streak-reset shape as Hegemony).
 *   - CHRONICLE: at `yearLimit` (doc 08 §1's "target campaign length: 40-120
 *     years" — this module's own year cap, and the T objective's), whichever
 *     SURVIVING kingdom has the highest `prestigeOf` (population + buildings
 *     + wonders + known techs, nominal weights — real balance tuning is
 *     M46's job) wins outright.
 *
 * DEFEAT (OQ-9, doc 14): last-village rule — a kingdom that has founded at
 * least one village and now owns none is defeated, dropped from every other
 * kingdom's Hegemony/Conquest bookkeeping. Dynastic (capital+heir) defeat
 * stays the deferred OPTIONAL rule doc 14 always said it'd be.
 *
 * CONTESTABILITY: crossing `APPROACHING_FRACTION` of any enabled track's
 * threshold broadcasts `victory.approaching` ONCE (per kingdom+type) — GDD
 * §16's "so AI and player can react." An AI CONSUMER of that broadcast (doc
 * 07 §8's containment consideration, raising war/alliance utility against
 * whoever's close to winning) is deliberately NOT wired this milestone —
 * "data/event now, AI consumption later", M35/M36's own precedent.
 *
 * GDD §17 (Sandbox Mode): `enabled: []` tracks no victory at all; a separate
 * `defeatEnabled: false` disables defeat independently — both toggles GDD
 * §17 promises.
 */
import type { EntityId } from '@crowns/core';
import type { DefinitionDatabase } from '@crowns/data';
import { VICTORY_TYPES, type VictoryType } from '@crowns/data';
import type { World } from '../ecs.js';
import type { Kernel, SimSystem, TickContext } from '../kernel.js';
import { TICKS_PER_DAY, TICKS_PER_YEAR } from '../time.js';
import type { VillageGameplay } from './villages.js';
import type { PopulationGameplay } from './population.js';
import type { KingdomGameplay } from './kingdom.js';
import type { DiplomacyGameplay } from './diplomacy.js';
import type { ResearchGameplay } from './research.js';

const index = (id: number): number => id & 0x3fffff;
const DAYS_PER_YEAR = TICKS_PER_YEAR / TICKS_PER_DAY; // 360 (doc 08 §1)

// ---------------------------------------------------------------- constants

export const DEFAULT_CONQUEST_SHARE = 0.6;
export const DEFAULT_HEGEMONY_YEARS = 10;
export const DEFAULT_PROSPERITY_HAPPINESS = 70;
export const DEFAULT_PROSPERITY_YEARS = 10;
export const DEFAULT_WONDER_COUNT = 3;
export const DEFAULT_YEAR_LIMIT = 100; // within doc 08 §1's 40-120 year target campaign length
export const APPROACHING_FRACTION = 0.8; // contestability broadcast threshold

// nominal prestige weights (GDD §15: "weighted score of population, buildings, tech, wonders");
// real tuning is a balance-campaign concern (M46), same "nominal value" precedent as M23's
// pactValue/napValue.
const PRESTIGE_POPULATION_WEIGHT = 1;
const PRESTIGE_BUILDING_WEIGHT = 10;
const PRESTIGE_TECH_WEIGHT = 15;
const PRESTIGE_WONDER_WEIGHT = 200;

// ---------------------------------------------------------------- options

export interface VictoryOptions {
  /** Chosen at world creation (GDD §16); empty disables victory entirely (GDD §17 sandbox). */
  readonly enabled: readonly VictoryType[];
  /** GDD §17 sandbox toggle, independent of `enabled`. Default true. */
  readonly defeatEnabled?: boolean;
  readonly yearLimit?: number;
  readonly conquestShare?: number;
  readonly hegemonyYears?: number;
  readonly prosperityHappiness?: number;
  readonly prosperityYears?: number;
  readonly wonderCount?: number;
}

/** Cross-module dependencies (game/ siblings, same reasoning research.ts/siege.ts already use
 * for KingdomGameplay) — omit either to keep that track permanently inert rather than crash. */
export interface VictoryDeps {
  readonly diplomacy?: DiplomacyGameplay; // Hegemony is inert without it
  readonly research?: ResearchGameplay; // Chronicle's prestige excludes tech coverage without it
}

export interface VictoryResult {
  readonly kingdomId: number;
  readonly type: VictoryType;
  readonly tick: number;
}

export interface VictoryGameplay {
  winner(): VictoryResult | null;
  isDefeated(kingdomId: EntityId): boolean;
  prestigeOf(kingdomId: EntityId): number;
}

// ---------------------------------------------------------------- registrar

export function registerVictoryGameplay(
  kernel: Kernel,
  world: World,
  db: DefinitionDatabase,
  game: VillageGameplay,
  popGame: PopulationGameplay,
  kingdomGame: KingdomGameplay,
  deps: VictoryDeps = {},
  options: VictoryOptions = { enabled: VICTORY_TYPES },
): VictoryGameplay {
  const enabled = new Set(options.enabled);
  const conquestShare = options.conquestShare ?? DEFAULT_CONQUEST_SHARE;
  const hegemonyDaysNeeded = (options.hegemonyYears ?? DEFAULT_HEGEMONY_YEARS) * DAYS_PER_YEAR;
  const prosperityHappiness = options.prosperityHappiness ?? DEFAULT_PROSPERITY_HAPPINESS;
  const prosperityDaysNeeded = (options.prosperityYears ?? DEFAULT_PROSPERITY_YEARS) * DAYS_PER_YEAR;
  const wonderCountNeeded = options.wonderCount ?? DEFAULT_WONDER_COUNT;
  const yearLimit = options.yearLimit ?? DEFAULT_YEAR_LIMIT;
  const defeatEnabled = options.defeatEnabled ?? true;

  const wonderDefIds = new Set([...db.buildings.values()].filter((b) => b.tags.includes('wonder')).map((b) => b.id));

  let winner: VictoryResult | null = null;
  const defeated = new Set<number>();
  const everFounded = new Set<number>();
  const hegemonyStreak = new Map<number, number>();
  const prosperityStreak = new Map<number, number>();
  const wondersCompleted = new Map<number, Set<string>>();
  const warnedApproaching = new Set<string>();
  let chronicleAwarded = false;

  // determinism (TDD §5): fold every bit of tracker state that affects future outcomes, sorted
  // for order-independence, same convention as DiplomacyState/ResearchState's own `fold`.
  kernel.addHashSource('victory', (fold) => {
    fold(winner === null ? 0 : 1);
    if (winner !== null) {
      fold(winner.kingdomId);
      fold(VICTORY_TYPES.indexOf(winner.type));
      fold(winner.tick);
    }
    fold(chronicleAwarded ? 1 : 0);
    for (const kingdomId of [...defeated].sort((a, b) => a - b)) fold(kingdomId);
    for (const kingdomId of [...everFounded].sort((a, b) => a - b)) fold(kingdomId);
    for (const kingdomId of [...hegemonyStreak.keys()].sort((a, b) => a - b)) {
      fold(kingdomId);
      fold(hegemonyStreak.get(kingdomId) as number);
    }
    for (const kingdomId of [...prosperityStreak.keys()].sort((a, b) => a - b)) {
      fold(kingdomId);
      fold(prosperityStreak.get(kingdomId) as number);
    }
    for (const kingdomId of [...wondersCompleted.keys()].sort((a, b) => a - b)) {
      fold(kingdomId);
      for (const defId of [...(wondersCompleted.get(kingdomId) as Set<string>)].sort()) {
        for (let i = 0; i < defId.length; i++) fold(defId.charCodeAt(i));
      }
    }
    for (const key of [...warnedApproaching].sort()) for (let i = 0; i < key.length; i++) fold(key.charCodeAt(i));
  });

  const ownerOfVillage = (vi: number): number =>
    kingdomGame.VillageOwner !== undefined
      ? (world.read(kingdomGame.VillageOwner).kingdom[vi] as number)
      : (kingdomGame.kingdomEntities()[0] as number);

  // ---- defeat bookkeeping: mark a kingdom as "has founded" the instant it happens, not on the
  // next daily scan — a village destroyed within the same day it was founded (or, in tests, a
  // village despawned before the tracker's next cadence) must still count as "had one, now has
  // none", the actual last-village rule, not an artifact of sampling timing. ----
  kernel.subscribe<{ village: number }>('village.founded', (event) => {
    everFounded.add(ownerOfVillage(index(event.data.village)));
  });

  // ---- legacy: track wonder completions as they happen (event-driven, not a daily scan) ----
  kernel.subscribe<{ building: number; def: string; village: number }>('building.completed', (event) => {
    if (!wonderDefIds.has(event.data.def)) return;
    const kingdomId = ownerOfVillage(index(event.data.village));
    const set = wondersCompleted.get(kingdomId) ?? new Set<string>();
    set.add(event.data.def);
    wondersCompleted.set(kingdomId, set);
  });

  const declare = (ctx: TickContext, kingdomId: number, type: VictoryType): void => {
    if (winner !== null) return;
    winner = { kingdomId, type, tick: ctx.tick };
    ctx.events.publish({ type: 'victory.achieved', tick: ctx.tick, data: { kingdomId, type } });
  };

  const maybeWarn = (ctx: TickContext, kingdomId: number, type: VictoryType, progress: number): void => {
    const key = `${kingdomId}:${type}`;
    if (progress >= APPROACHING_FRACTION && progress < 1 && !warnedApproaching.has(key)) {
      warnedApproaching.add(key);
      ctx.events.publish({ type: 'victory.approaching', tick: ctx.tick, data: { kingdomId, type, progress } });
    }
  };

  const prestigeOf = (kingdomId: number): number => {
    const pop = world.read(popGame.Population);
    let population = 0;
    let buildings = 0;
    const ownerOf = kingdomGame.VillageOwner !== undefined ? world.read(kingdomGame.VillageOwner) : null;
    world.query([game.comps.VillageCore, popGame.Population]).forEach((vi) => {
      if (ownerOf !== null && (ownerOf.kingdom[vi] as number) !== kingdomId) return;
      population += (pop.children[vi] as number) + (pop.adults[vi] as number) + (pop.elders[vi] as number);
    });
    const b = world.read(game.comps.BuildingCore);
    world.query([game.comps.BuildingCore]).forEach((bi) => {
      if ((b.complete[bi] as number) !== 1) return;
      if (ownerOf !== null && (ownerOf.kingdom[b.village[bi] as number] as number) !== kingdomId) return;
      buildings++;
    });
    const wonders = wondersCompleted.get(kingdomId)?.size ?? 0;
    let techs = 0;
    if (deps.research !== undefined) {
      for (const techId of db.techs.keys()) if (deps.research.isKnown(kingdomId as EntityId, techId)) techs++;
    }
    return (
      population * PRESTIGE_POPULATION_WEIGHT +
      buildings * PRESTIGE_BUILDING_WEIGHT +
      techs * PRESTIGE_TECH_WEIGHT +
      wonders * PRESTIGE_WONDER_WEIGHT
    );
  };

  const tracker: SimSystem = {
    name: 'victory-tracker',
    period: TICKS_PER_DAY,
    update(ctx: TickContext): void {
      if (winner !== null) return;
      const kingdoms = kingdomGame.kingdomEntities().map((e) => e as number);

      const villagesOf = new Map<number, number>();
      let totalVillages = 0;
      world.query([game.comps.VillageCore]).forEach((vi) => {
        totalVillages++;
        const owner = ownerOfVillage(vi);
        villagesOf.set(owner, (villagesOf.get(owner) ?? 0) + 1);
        everFounded.add(owner);
      });

      // ---- defeat: last-village rule (OQ-9) ----
      if (defeatEnabled) {
        for (const kingdomId of kingdoms) {
          if (defeated.has(kingdomId)) continue;
          if (everFounded.has(kingdomId) && (villagesOf.get(kingdomId) ?? 0) === 0) {
            defeated.add(kingdomId);
            ctx.events.publish({ type: 'defeat.kingdom', tick: ctx.tick, data: { kingdomId } });
          }
        }
      }
      const surviving = kingdoms.filter((k) => !defeated.has(k));

      for (const kingdomId of surviving) {
        if (enabled.has('conquest') && totalVillages > 0) {
          const share = (villagesOf.get(kingdomId) ?? 0) / totalVillages;
          const eliminatedAllRivals = kingdoms.length > 1 && surviving.length === 1;
          maybeWarn(ctx, kingdomId, 'conquest', share / conquestShare);
          if (share >= conquestShare || eliminatedAllRivals) {
            declare(ctx, kingdomId, 'conquest');
            continue;
          }
        }

        if (enabled.has('hegemony') && deps.diplomacy !== undefined && kingdoms.length > 1) {
          const diplomacy = deps.diplomacy;
          const rivals = surviving.filter((k) => k !== kingdomId);
          const allBound =
            rivals.length > 0 &&
            rivals.every(
              (rival) => diplomacy.state.hasPact(kingdomId, rival, 'alliance') || diplomacy.state.lordOf(rival) === kingdomId,
            );
          const streak = allBound ? (hegemonyStreak.get(kingdomId) ?? 0) + 1 : 0;
          hegemonyStreak.set(kingdomId, streak);
          maybeWarn(ctx, kingdomId, 'hegemony', streak / hegemonyDaysNeeded);
          if (streak >= hegemonyDaysNeeded) {
            declare(ctx, kingdomId, 'hegemony');
            continue;
          }
        }

        if (enabled.has('legacy')) {
          const completedCount = wondersCompleted.get(kingdomId)?.size ?? 0;
          maybeWarn(ctx, kingdomId, 'legacy', completedCount / wonderCountNeeded);
          if (completedCount >= wonderCountNeeded) {
            declare(ctx, kingdomId, 'legacy');
            continue;
          }
        }

        if (enabled.has('prosperity')) {
          const pop = world.read(popGame.Population);
          const ownerOf = kingdomGame.VillageOwner !== undefined ? world.read(kingdomGame.VillageOwner) : null;
          let sum = 0;
          let count = 0;
          world.query([game.comps.VillageCore, popGame.Population]).forEach((vi) => {
            if (ownerOf !== null && (ownerOf.kingdom[vi] as number) !== kingdomId) return;
            sum += pop.happiness[vi] as number;
            count++;
          });
          const avgHappiness = count > 0 ? sum / count : 0;
          const met = count > 0 && avgHappiness >= prosperityHappiness;
          const streak = met ? (prosperityStreak.get(kingdomId) ?? 0) + 1 : 0;
          prosperityStreak.set(kingdomId, streak);
          maybeWarn(ctx, kingdomId, 'prosperity', streak / prosperityDaysNeeded);
          if (streak >= prosperityDaysNeeded) {
            declare(ctx, kingdomId, 'prosperity');
            continue;
          }
        }
      }

      // ---- chronicle: highest prestige among survivors, exactly once, at the year cap ----
      if (enabled.has('chronicle') && !chronicleAwarded && ctx.tick >= yearLimit * TICKS_PER_YEAR) {
        chronicleAwarded = true;
        if (surviving.length > 0) {
          const best = surviving.reduce((a, b) => (prestigeOf(b) > prestigeOf(a) ? b : a));
          declare(ctx, best, 'chronicle');
        }
      }
    },
  };
  kernel.registerSystem(tracker);

  return {
    winner: () => winner,
    isDefeated: (kingdomId: EntityId) => defeated.has(kingdomId as number),
    prestigeOf: (kingdomId: EntityId) => prestigeOf(kingdomId as number),
  };
}
