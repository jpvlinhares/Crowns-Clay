/**
 * Loss, loot & succession (roadmap M53; ADR-4 §3; doc 14 OQ-9 item 2 + OQ-11).
 *
 * CAPITAL DEATH: when a defence-layer capital falls (spatial assault OR
 * starvation — starving a capital out must not dodge the rule), siege.ts's
 * `CapitalFallHook` freezes the siege instead of flipping ownership and this
 * module resolves the fall inside a CAPITULATION WINDOW:
 *
 *   - VASSALAGE-FIRST (OQ-11's decision): the loser may swear to the attacker
 *     and survive, diminished — the capital keeps its banner, the war ends,
 *     the shipped M35 tribute stream is the price. An AI loser decides through
 *     the SAME `evaluateVassalageDeal` the diplomacy command uses, with its
 *     war exhaustion floored at `CAPITAL_FALLEN_EXHAUSTION_FLOOR` (the keep
 *     falling IS hopelessness): long grinding wars end in submission, a
 *     lightning war finds a defiant court — "refusal by either side makes it
 *     destruction". A human loser submits via the ordinary
 *     `kingdom.proposeVassalage`; a human ATTACKER is offered the homage
 *     (`siege.capitulationOffered`) and accepts via `siege.acceptCapitulation`
 *     — silence until the deadline is refusal ("wants blood" by default).
 *   - DESTRUCTION (refusal, expiry, or the `ironman` flag — permadeath is the
 *     opt-in, and it binds AI lords too, same-rules-for-everyone): the
 *     treasury transfers whole (ledger kind 'loot'), goods are carried into
 *     the attacker's capital under `capOf` with the EXCESS BURNED (reported in
 *     `siege.sacked` — "carried off 400 grain; burned 900 more"), the capital
 *     is razed, every other village of the realm passes to the conqueror (the
 *     realm is seized — the kingdom dies rather than lingering as a zombie),
 *     its armies dissolve, and its defence layer resets to keep-only ground.
 *
 * NEW LORDS RISING (ADR-4 §3 world attrition): `NEW_LORD_COOLDOWN_DAYS` after
 * a kingdom death (capital destruction or last-village defeat alike), a fresh
 * banner rises in the dead slot — a village founded near the slot's genesis
 * heartland via the same `bestSiteNear` fallback genesis itself uses, with a
 * clean political slate (diplomacy reset, defeat mark cleared, starting
 * treasury restored). Risings are SUPPRESSED once any surviving kingdom
 * crosses the victory-approaching threshold, so conquest stays winnable.
 *
 * Heavy world mutations (razing, annexation, founding) run through OWN
 * commands (`succession.destroy` / `succession.rise`) submitted by the daily
 * system — commands execute unscoped, so the system never has to declare the
 * entire component surface a village teardown touches. The commands re-check
 * validity themselves (they are the rulebook, whoever submits): a player
 * submitting `succession.destroy` on a capital they felled is simply choosing
 * blood explicitly, and an early `succession.rise` is rejected.
 */
import type { EntityId } from '@crowns/core';
import type { DefinitionDatabase } from '@crowns/data';
import { World } from '../ecs.js';
import type { Kernel, SimSystem, TickContext } from '../kernel.js';
import { TICKS_PER_DAY } from '../time.js';
import type { VillageGameplay } from './villages.js';
import type { EconomyGameplay } from './economy.js';
import type { PopulationGameplay } from './population.js';
import type { MilitaryGameplay } from './military.js';
import type { CombatGameplay } from './combat.js';
import type { KingdomGameplay } from './kingdom.js';
import { STARTING_TREASURY } from './kingdom.js';
import type { SiegeGameplay, CapitalFallHook } from './siege.js';
import type { DiplomacyGameplay, DiplomacyPersonality } from './diplomacy.js';
import { evaluateVassalageDeal } from './diplomacy.js';
import type { VictoryGameplay } from './victory.js';
import { APPROACHING_FRACTION } from './victory.js';
import type { DefenceGameplay } from './defence.js';
import { bestSiteNear } from './settlers.js';

const index = (id: number): number => id & 0x3fffff;

// ---------------------------------------------------------------- constants

/** Days a fallen capital's fate hangs — long enough for a paused player to decide,
 * short enough that the sword falls the same season it was raised. */
export const CAPITULATION_WINDOW_DAYS = 5;
/** The keep falling IS hopelessness: the loser's vassalage evaluation runs on at least
 * this much war exhaustion, so a long war's submission never gets MORE defiant because
 * the end came suddenly. Fresh blitz wars stay below acceptance for mid-trust courts —
 * lightning conquest finds defiance, and defiance means destruction. */
export const CAPITAL_FALLEN_EXHAUSTION_FLOOR = 40;
/** Days after a kingdom death before a new banner may rise on the vacant heartland. */
export const NEW_LORD_COOLDOWN_DAYS = 720; // two years
/** Search radius around the slot's genesis site for the riser's founding claim. */
export const NEW_LORD_SEARCH_RADIUS = 32;

// ---------------------------------------------------------------- state

/** Relational succession state (mirrors OccupationState): folded + serialized. */
export class SuccessionState {
  /** Fallen castles whose homage offer has been put to a HUMAN attacker (publish-once). */
  readonly offered = new Set<number>();
  /** Kingdom slot → tick of its death (capital destruction or last-village defeat). */
  readonly deaths = new Map<number, number>();

  fold(fold: (v: number) => void): void {
    for (const castle of [...this.offered].sort((a, b) => a - b)) fold(castle);
    for (const k of [...this.deaths.keys()].sort((a, b) => a - b)) {
      fold(k);
      fold(this.deaths.get(k) as number);
    }
  }

  save(): { offered: number[]; deaths: [number, number][] } {
    return {
      offered: [...this.offered].sort((a, b) => a - b),
      deaths: [...this.deaths.entries()].sort((a, b) => a[0] - b[0]),
    };
  }

  restore(data: { offered: readonly number[]; deaths: readonly (readonly [number, number])[] }): void {
    this.offered.clear();
    for (const c of data.offered) this.offered.add(c);
    this.deaths.clear();
    for (const [k, tick] of data.deaths) this.deaths.set(k, tick);
  }
}

// ---------------------------------------------------------------- options

export interface SuccessionOptions {
  /** OQ-11: permadeath opt-in — no window, no offer, a fallen capital burns. Binds AI lords too. */
  readonly ironman: boolean;
  /** Kingdoms below this index are human: their choices arrive as commands, never auto-evaluated. */
  readonly aiFromIndex: number;
  /** True when this village index is a defence-layer capital (the capital-death predicate —
   * the same closure the spatial-assault hook uses). */
  applies(castleVillageIndex: number): boolean;
  /** The composition's capital binding (conquest history — villageIndexByKingdom). */
  capitalOf(kingdomIndex: number): number | null;
  /** Every village currently flying kingdom k's banner (dense indices). */
  villagesOfKingdom(kingdomIndex: number): readonly { vi: number }[];
  /** The kingdom's diplomacy personality, for the capitulation evaluators. */
  weightsOf(kingdomIndex: number): DiplomacyPersonality;
  /** Slot k's genesis heartland — new banners rise near where the old one first flew. */
  homeSiteOf(kingdomIndex: number): { x: number; y: number };
  /** Founding name for slot k's riser village. */
  newLordNameOf(kingdomIndex: number): string;
  /** Founding stock for a riser (the composition's genesis startingStock). */
  readonly startingStock: Readonly<Record<string, number>> | ReadonlyMap<number, number>;
  /** Composition hooks: capital-binding bookkeeping the maps outside this module own. */
  onKingdomDeath(kingdomIndex: number): void;
  onNewLord(kingdomIndex: number, villageIndex: number): void;
}

export interface SuccessionGameplay {
  readonly state: SuccessionState;
}

// ---------------------------------------------------------------- registrar

export function registerSuccessionGameplay(
  kernel: Kernel,
  world: World,
  db: DefinitionDatabase,
  game: VillageGameplay,
  econGame: EconomyGameplay,
  popGame: PopulationGameplay,
  kingdomGame: KingdomGameplay,
  militaryGame: MilitaryGameplay,
  combatGame: CombatGameplay,
  siegeGame: SiegeGameplay,
  diplomacyGame: DiplomacyGameplay,
  victoryGame: VictoryGameplay,
  defenceGame: DefenceGameplay,
  capitalFall: CapitalFallHook,
  options: SuccessionOptions,
): SuccessionGameplay {
  const { VillageCore, Stockpile } = game.comps;
  const { Unit, Army } = militaryGame;
  const { Kingdom, VillageOwner, ledger } = kingdomGame;
  if (VillageOwner === undefined) throw new Error('succession requires a multi-kingdom campaign');
  const { Population } = popGame;
  const diplomacy = diplomacyGame.state;
  const state = new SuccessionState();
  kernel.addHashSource('succession', (fold) => state.fold(fold));

  // resource code → id, for legible sack reports
  const resourceIdByCode = new Map<number, string>();
  for (const id of [...db.resources.keys()].sort()) resourceIdByCode.set(game.ops.resourceCode(id) as number, id);

  const kingdoms = (): readonly EntityId[] => kingdomGame.kingdomEntities();
  const kingdomIndexOf = (id: number): number => kingdoms().indexOf(id as EntityId);
  const isAi = (k: number): boolean => k >= options.aiFromIndex;

  const reject = (ctx: TickContext, what: string, reason: string): void => {
    ctx.events.publish({ type: 'village.rejected', tick: ctx.tick, data: { what, reason } });
  };

  const ownerOf = (castleVi: number): number => world.read(VillageOwner).kingdom[castleVi] as number;

  const committedCount = (armyId: number): number => {
    const u = world.read(Unit);
    let total = 0;
    world.query([Unit]).forEach((ui) => {
      if ((u.armyId[ui] as number) === armyId && (u.complete[ui] as number) === 1) total += u.count[ui] as number;
    });
    return total;
  };

  // ---- the hook: siege.ts calls this instead of capturing a layer capital ----
  capitalFall.claim = (ctx, fall) => {
    if (!options.applies(fall.castle)) return null;
    // ironman: the window is already over — the daily pass destroys without an offer
    return options.ironman ? ctx.tick : ctx.tick + CAPITULATION_WINDOW_DAYS * TICKS_PER_DAY;
  };

  // ---- vassalage-first: swear the loser to the attacker (both sides already agreed) ----
  const capitulate = (ctx: TickContext, castle: number, vassalId: number, lordId: number): void => {
    diplomacy.breakVassalage(vassalId); // conquest transfers fealty if a third lord held it
    diplomacy.establishVassalage(vassalId, lordId);
    if (diplomacy.isAtWar(vassalId, lordId)) diplomacy.makePeace(vassalId, lordId);
    state.offered.delete(castle);
    ctx.events.publish({ type: 'kingdom.capitulated', tick: ctx.tick, data: { castle, vassal: vassalId, lord: lordId } });
    siegeGame.endFallen(ctx, castle, 'capitulated');
  };

  // ---- kingdom death bookkeeping shared by destruction and last-village defeat ----
  kernel.subscribe<{ kingdomId: number }>('defeat.kingdom', (event) => {
    const k = kingdomIndexOf(event.data.kingdomId);
    if (k >= 0 && !state.deaths.has(k)) state.deaths.set(k, event.tick);
  });

  // ---------------- succession.destroy: the sack (unscoped command context) ----------------
  kernel.registerCommand<{ castle: number }>('succession.destroy', (ctx, p) => {
    const castle = index(p.castle | 0);
    const s = siegeGame.state.siegeOfCastle(castle);
    if (s === undefined || s.fallenDeadline === 0) return reject(ctx, 'succession.destroy', 'no fallen capital here');
    const defenderId = ownerOf(castle);
    const defenderK = kingdomIndexOf(defenderId);
    const attackerId = s.attackerKingdom;
    const attackerK = kingdomIndexOf(attackerId);
    if (defenderK < 0 || attackerK < 0) return reject(ctx, 'succession.destroy', 'no such kingdom');
    const name = world.readObj(game.comps.VillageName).tryGet(castle) ?? `village ${castle}`;

    // 1. gold: the treasury transfers WHOLE, ledger-explicit (ADR-4 §3 — M13's
    // conservation discipline demands labelled movements, not silent drift)
    const k = world.write(Kingdom);
    const di = index(defenderId);
    const ai = index(attackerId);
    const gold = k.treasury[di] as number;
    if (gold > 0) {
      k.treasury[di] = 0;
      k.treasury[ai] = (k.treasury[ai] as number) + gold;
      ledger.record({ tick: ctx.tick, kind: 'loot', amount: gold, detail: `sack of ${name}` });
      ledger.record({ tick: ctx.tick, kind: 'loot', amount: -gold, detail: `sack of ${name} (lost)` });
    }

    // 2. goods: carried into the attacker's capital under capOf — existing storage rules,
    // no exemption; the EXCESS BURNS with the settlement (a real reason to build granaries
    // before campaigning). No attacker capital → everything burns.
    const winnerCapital = options.capitalOf(attackerK);
    const loot: { res: string; carried: number; burned: number }[] = [];
    const stock = world.readObj(Stockpile).tryGet(castle);
    if (stock !== undefined) {
      const caps = econGame.capsView();
      const winnerStock = winnerCapital !== null ? world.writeObj(Stockpile).tryGet(winnerCapital) : undefined;
      for (const code of [...stock.keys()].sort((a, b) => a - b)) {
        const amount = stock.get(code) as number;
        if (amount <= 0) continue;
        let carried = 0;
        if (winnerCapital !== null && winnerStock !== undefined) {
          const headroom = Math.max(0, caps(winnerCapital, code) - (winnerStock.get(code) ?? 0));
          carried = Math.min(amount, headroom);
          if (carried > 0) {
            winnerStock.set(code, (winnerStock.get(code) ?? 0) + carried);
            econGame.ledger.record(winnerCapital, code, 'looted', carried);
          }
        }
        loot.push({ res: resourceIdByCode.get(code) ?? String(code), carried, burned: amount - carried });
      }
    }

    // 3. politics die with the realm: vassals freed, its own fealty broken, wars ended
    for (const vassal of diplomacy.vassalsOf(defenderId)) {
      diplomacy.breakVassalage(vassal);
      ctx.events.publish({ type: 'diplomacy.vassalageBroken', tick: ctx.tick, data: { vassal, lord: defenderId, byRebellion: false } });
    }
    diplomacy.breakVassalage(defenderId);
    for (const { a, b } of diplomacy.activeWars()) {
      if (a === defenderId || b === defenderId) diplomacy.makePeace(a, b);
    }

    // 4. the realm is seized: every OTHER village passes to the conqueror — the same
    // village.occupied event occupation publishes, so every ownership subscriber
    // (indices, capital re-binding, notifications) follows without new plumbing
    const owner = world.write(VillageOwner);
    for (const v of options.villagesOfKingdom(defenderK)) {
      if (v.vi === castle) continue;
      owner.kingdom[v.vi] = attackerId;
      ctx.events.publish({
        type: 'village.occupied',
        tick: ctx.tick,
        data: { village: v.vi, kingdom: attackerId, from: defenderId, army: s.attackerArmy },
      });
    }

    // 5. the capital burns (whatever was not carried is destroyed with it)
    game.ops.raze(ctx, castle);

    // 6. its hosts dissolve: units and armies despawn (rows snapshotted first — dense
    // SoA storage swap-removes on despawn), engagements and their own sieges closed out
    const u = world.read(Unit);
    const doomedUnits: number[] = [];
    world.query([Unit]).forEach((ui, entity) => {
      if ((u.kingdomId[ui] as number) === defenderId) doomedUnits.push(entity as number);
    });
    for (const unit of doomedUnits) world.despawn(unit as EntityId);
    const a = world.read(Army);
    const doomedArmies: number[] = [];
    world.query([Army]).forEach((aIdx, entity) => {
      if ((a.kingdomId[aIdx] as number) === defenderId) doomedArmies.push(entity as number);
    });
    for (const army of doomedArmies) {
      const engagement = combatGame.state.engagementOf(army);
      if (engagement !== undefined) combatGame.state.end(engagement);
      const ownSiege = siegeGame.state.siegeOfArmy(army);
      if (ownSiege !== undefined) {
        siegeGame.state.end(ownSiege);
        ctx.events.publish({ type: 'siege.ended', tick: ctx.tick, data: { castle: ownSiege.castle, army, reason: 'besieger destroyed' } });
      }
      world.despawn(army as EntityId);
    }

    // 7. the record: sack report, death mark, composition bookkeeping — the castle's
    // defence layer burned with it too: M57 re-keyed the layer to the VILLAGE, so
    // `game.ops.raze(ctx, castle)` at step 5 already cleared it (defence.ts subscribes to
    // `village.razed` itself; no explicit reset call needed here any more).
    state.deaths.set(defenderK, state.deaths.get(defenderK) ?? ctx.tick);
    state.offered.delete(castle);
    options.onKingdomDeath(defenderK);
    ctx.events.publish({
      type: 'siege.sacked',
      tick: ctx.tick,
      data: { castle, name, attacker: attackerId, defender: defenderId, gold, loot },
    });
    ctx.events.publish({ type: 'kingdom.destroyed', tick: ctx.tick, data: { kingdom: defenderId, by: attackerId, castle } });
    siegeGame.endFallen(ctx, castle, 'destroyed');
  });

  // ---------------- siege.acceptCapitulation: a human attacker takes the homage ----------------
  kernel.registerCommand<{ castle: number }>('siege.acceptCapitulation', (ctx, p, command) => {
    const castle = index(p.castle | 0);
    const s = siegeGame.state.siegeOfCastle(castle);
    if (s === undefined || s.fallenDeadline === 0) return reject(ctx, 'siege.acceptCapitulation', 'no fallen capital here');
    const issuerKingdom = kingdoms()[command.issuer - 1] ?? kingdoms()[0];
    if (issuerKingdom === undefined || (issuerKingdom as number) !== s.attackerKingdom) {
      return reject(ctx, 'siege.acceptCapitulation', 'not your siege');
    }
    if (!state.offered.has(castle)) return reject(ctx, 'siege.acceptCapitulation', 'no homage has been offered');
    capitulate(ctx, castle, ownerOf(castle), s.attackerKingdom);
  });

  // ---------------- succession.rise: a new banner on the vacant heartland ----------------
  kernel.registerCommand<{ kingdomIndex: number }>('succession.rise', (ctx, p) => {
    const kIdx = p.kingdomIndex | 0;
    const deathTick = state.deaths.get(kIdx);
    if (deathTick === undefined) return reject(ctx, 'succession.rise', 'that kingdom is not vacant');
    if (ctx.tick < deathTick + NEW_LORD_COOLDOWN_DAYS * TICKS_PER_DAY) {
      return reject(ctx, 'succession.rise', 'the land still mourns — cooldown not elapsed');
    }
    if (victoryGame.winner() !== null) return reject(ctx, 'succession.rise', 'the campaign is decided');
    const kingdomId = kingdoms()[kIdx];
    if (kingdomId === undefined) return reject(ctx, 'succession.rise', 'no such kingdom slot');
    const home = options.homeSiteOf(kIdx);
    const site = bestSiteNear(game, db, home.x, home.y, NEW_LORD_SEARCH_RADIUS);
    if (site === null) return reject(ctx, 'succession.rise', 'no valid founding site near the old heartland');
    const result = game.ops.found(ctx, site.x, site.y, options.newLordNameOf(kIdx), options.startingStock, undefined, {
      component: VillageOwner,
      kingdomId,
    });
    if (typeof result === 'string') return reject(ctx, 'succession.rise', result);
    // a clean slate: no inherited wars, grudges, fealty, or defeat mark — and the
    // modest founding treasury every genesis lord started with
    diplomacy.resetKingdom(kingdomId as number);
    victoryGame.revive(kingdomId);
    const k = world.write(Kingdom);
    k.treasury[index(kingdomId as number)] = STARTING_TREASURY;
    state.deaths.delete(kIdx);
    options.onNewLord(kIdx, index(result as number));
    ctx.events.publish({
      type: 'kingdom.newLordRisen',
      tick: ctx.tick,
      data: { kingdom: kingdomId as number, village: result as number, x: site.x, y: site.y },
    });
  });

  // ---------------- daily: resolve fallen capitals, then let new banners rise ----------------
  const system: SimSystem = {
    name: 'succession',
    period: TICKS_PER_DAY,
    phase: 10, // after occupation (9) has settled the day's ownership
    access: { reads: [VillageCore, Population, VillageOwner, Unit] },
    update(ctx: TickContext): void {
      // ---- fallen capitals ----
      for (const s of siegeGame.state.all()) {
        if (s.fallenDeadline === 0) continue;
        // reprieve: the besieger was destroyed during the window — the fall lapses
        if (committedCount(s.attackerArmy) <= 0) {
          state.offered.delete(s.castle);
          siegeGame.endFallen(ctx, s.castle, 'besieger destroyed');
          continue;
        }
        const defenderId = ownerOf(s.castle);
        const attackerId = s.attackerKingdom;
        // mercy before the axe: fealty sworn by ANY path (auto-evaluated, player
        // command, pre-emptive submission) spares the capital
        if (diplomacy.lordOf(defenderId) === attackerId) {
          capitulate(ctx, s.castle, defenderId, attackerId);
          continue;
        }
        if (ctx.tick >= s.fallenDeadline) {
          kernel.submit({ type: 'succession.destroy', issuer: 0, payload: { castle: s.castle } });
          continue;
        }
        const defenderK = kingdomIndexOf(defenderId);
        const attackerK = kingdomIndexOf(attackerId);
        if (defenderK < 0 || attackerK < 0) continue;
        // an attacker who is itself a vassal cannot take vassals (M35 rule) — no offer
        // is possible; the window simply expires into destruction
        if (diplomacy.isVassal(attackerId)) continue;
        if (isAi(defenderK)) {
          const exhaustion = Math.max(diplomacy.warExhaustionOf(defenderId, attackerId), CAPITAL_FALLEN_EXHAUSTION_FLOOR);
          const submits = evaluateVassalageDeal('vassal', exhaustion, options.weightsOf(defenderK)).accept;
          if (!submits) {
            // the loser declines submission — destruction, no need to wait out the window
            kernel.submit({ type: 'succession.destroy', issuer: 0, payload: { castle: s.castle } });
            continue;
          }
          if (isAi(attackerK)) {
            const takes = evaluateVassalageDeal('lord', exhaustion, options.weightsOf(attackerK)).accept;
            if (takes) capitulate(ctx, s.castle, defenderId, attackerId);
            else kernel.submit({ type: 'succession.destroy', issuer: 0, payload: { castle: s.castle } }); // wants blood
          } else if (!state.offered.has(s.castle)) {
            // the homage is put to the human attacker exactly once; silence is refusal
            state.offered.add(s.castle);
            ctx.events.publish({
              type: 'siege.capitulationOffered',
              tick: ctx.tick,
              data: { castle: s.castle, vassal: defenderId, lord: attackerId, deadline: s.fallenDeadline },
            });
          }
        }
        // a human defender's move arrives as kingdom.proposeVassalage — caught by the
        // lordOf check above on the next pass; nothing to evaluate here
      }

      // ---- new lords rising ----
      if (state.deaths.size === 0 || victoryGame.winner() !== null) return;
      // suppression: once anyone nears a victory track, no new banners — conquest
      // must stay winnable (ADR-4 §3). Live progress, not the one-shot warning set.
      let suppressed = false;
      for (const kingdomId of kingdoms()) {
        if (victoryGame.isDefeated(kingdomId)) continue;
        for (const track of victoryGame.tracksOf(kingdomId, ctx.tick)) {
          if (track.progress >= APPROACHING_FRACTION) {
            suppressed = true;
            break;
          }
        }
        if (suppressed) break;
      }
      if (suppressed) return;
      for (const [kIdx, deathTick] of [...state.deaths.entries()].sort((a, b) => a[0] - b[0])) {
        if (ctx.tick < deathTick + NEW_LORD_COOLDOWN_DAYS * TICKS_PER_DAY) continue;
        kernel.submit({ type: 'succession.rise', issuer: 0, payload: { kingdomIndex: kIdx } });
      }
    },
  };
  kernel.registerSystem(system);

  return { state };
}
