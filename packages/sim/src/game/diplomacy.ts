/**
 * Diplomacy v1 (roadmap M23; GDD §10; doc 06 §10; doc 07 §4).
 *
 * OPINION is per-kingdom-PAIR, not per-kingdom — it doesn't map onto ECS's
 * entity-component model (no "relation entity" exists), so `DiplomacyState`
 * is a plain class, like `RoadGrid`/`KingdomLedger`. It folds into
 * `stateHash()` via `kernel.addHashSource` rather than a component hasher,
 * and — like every other piece of sim state — is only ever mutated through
 * kernel-registered commands, never touched directly, so replays stay exact.
 *
 * GIFTS/INSULTS have an explicit anti-spam cooldown (GDD §10: "AI must be
 * gameable-feeling but not exploitable — gift-spam caps"): a repeat
 * gift/insult to the same kingdom within the cooldown window still costs
 * gold (gifts) but contributes ZERO additional opinion change.
 *
 * NAP/TRADE PACTS have no real economic or military effect yet (no trade
 * routes, no war) — their "value" in the deal evaluator is a nominal,
 * opinion-scaled constant, not a computed economic gain. `evaluateDeal` is
 * a pure function of (opinion, pact type, weights) — never of "who is
 * asking" — so evaluating the same proposal from either kingdom's
 * perspective always agrees (the roadmap's "deal-value symmetry" test
 * objective).
 *
 * Reputation (global, doc 07 §7), alliances, vassalage, and joint wars
 * (doc 06 §10's fuller clause list) are M35 "Diplomacy v2".
 */
import { clamp, type EntityId } from '@crowns/core';
import type { World } from '../ecs.js';
import type { Kernel, TickContext } from '../kernel.js';
import { TICKS_PER_DAY } from '../time.js';
import type { KingdomGameplay } from './kingdom.js';

const index = (id: number): number => id & 0x3fffff;

// ---------------------------------------------------------------- constants

export const GIFT_OPINION_PER_GOLD = 0.05; // 100 gold -> +5 opinion, before caps
export const MAX_GIFT_OPINION = 10; // no single gift swings opinion further
export const GIFT_COOLDOWN_TICKS = TICKS_PER_DAY * 7;
export const INSULT_OPINION_DELTA = -15;
export const INSULT_COOLDOWN_TICKS = TICKS_PER_DAY * 3;
export const BREAK_PACT_OPINION_PENALTY = -20;
export const ACCEPT_THRESHOLD = 15;

export const PACT_NAP = 1;
export const PACT_TRADE = 2;
export type PactType = 'nonAggression' | 'trade';
const pactBit = (type: PactType): number => (type === 'nonAggression' ? PACT_NAP : PACT_TRADE);

// ---------------------------------------------------------------- deal evaluator

/** Minimal structural subset of ai/planner.ts's `PersonalityWeights` — avoids a
 * game/ -> ai/ dependency (ai/ already depends on game/; the reverse would cycle). */
export interface DiplomacyPersonality {
  readonly diplomacyTrust: number; // 0..1
}

/** Friendlier relationships are cheaper to convince; clamped so trust never fully vanishes. */
export function trustFactor(opinion: number): number {
  return clamp(1 - opinion / 200, 0.6, 1.4);
}

/** More trusting personalities require a smaller perceived value to accept a deal. */
export function personalityMargin(weights: DiplomacyPersonality): number {
  return 1.2 - weights.diplomacyTrust * 0.4;
}

/** Nominal value of peace between two kingdoms — worth more the more tense the relationship. */
export function napValue(opinion: number): number {
  return clamp(20 - opinion / 10, 5, 30);
}

export const TRADE_VALUE = 15; // flat nominal value — no real trade-route economy yet (v1)

export function pactValue(opinion: number, type: PactType): number {
  return type === 'nonAggression' ? napValue(opinion) : TRADE_VALUE;
}

export interface DealEvaluation {
  readonly value: number;
  readonly threshold: number;
  readonly accept: boolean;
}

/**
 * Doc 07 §4: accept if value received >= value given x trustFactor x personality margin.
 * Pure function of (opinion, type, weights) only — never of which kingdom is proposing,
 * so it can't be gamed by asking from "the other side" (the symmetry test objective).
 */
export function evaluateDeal(opinion: number, type: PactType, weights: DiplomacyPersonality): DealEvaluation {
  const value = pactValue(opinion, type);
  const threshold = ACCEPT_THRESHOLD * trustFactor(opinion) * personalityMargin(weights);
  return { value, threshold, accept: value >= threshold };
}

// ---------------------------------------------------------------- state

export interface DiplomaticRelation {
  readonly opinion: number; // -100..100
  readonly pacts: number; // bitmask: PACT_NAP | PACT_TRADE
  readonly lastGiftTick: number;
  readonly lastInsultTick: number;
}

const NEVER = -1; // sentinel: no gift/insult has ever been sent this pair
const EMPTY_RELATION: DiplomaticRelation = { opinion: 0, pacts: 0, lastGiftTick: NEVER, lastInsultTick: NEVER };

function pairKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/** Pairwise opinion/pact state (doc 06 §10), keyed by raw kingdom EntityId, both orderings equal. */
export class DiplomacyState {
  private readonly relations = new Map<string, DiplomaticRelation>();

  private relationOf(a: number, b: number): DiplomaticRelation {
    return this.relations.get(pairKey(a, b)) ?? EMPTY_RELATION;
  }

  opinionOf(a: number, b: number): number {
    return this.relationOf(a, b).opinion;
  }

  hasPact(a: number, b: number, type: PactType): boolean {
    return (this.relationOf(a, b).pacts & pactBit(type)) !== 0;
  }

  addPact(a: number, b: number, type: PactType): void {
    const rel = this.relationOf(a, b);
    this.relations.set(pairKey(a, b), { ...rel, pacts: rel.pacts | pactBit(type) });
  }

  removePact(a: number, b: number, type: PactType): void {
    const rel = this.relationOf(a, b);
    this.relations.set(pairKey(a, b), { ...rel, pacts: rel.pacts & ~pactBit(type) });
  }

  /** Applies a gift's opinion effect (zero if within the anti-spam cooldown); returns the delta applied. */
  applyGift(a: number, b: number, gold: number, tick: number): number {
    const rel = this.relationOf(a, b);
    const onCooldown = rel.lastGiftTick !== NEVER && tick - rel.lastGiftTick < GIFT_COOLDOWN_TICKS;
    const delta = onCooldown ? 0 : clamp(gold * GIFT_OPINION_PER_GOLD, 0, MAX_GIFT_OPINION);
    this.relations.set(pairKey(a, b), { ...rel, opinion: clamp(rel.opinion + delta, -100, 100), lastGiftTick: tick });
    return delta;
  }

  /** Applies an insult's opinion effect (zero if within the anti-spam cooldown); returns the delta applied. */
  applyInsult(a: number, b: number, tick: number): number {
    const rel = this.relationOf(a, b);
    const onCooldown = rel.lastInsultTick !== NEVER && tick - rel.lastInsultTick < INSULT_COOLDOWN_TICKS;
    const delta = onCooldown ? 0 : INSULT_OPINION_DELTA;
    this.relations.set(pairKey(a, b), { ...rel, opinion: clamp(rel.opinion + delta, -100, 100), lastInsultTick: tick });
    return delta;
  }

  applyOpinionDelta(a: number, b: number, delta: number): void {
    const rel = this.relationOf(a, b);
    this.relations.set(pairKey(a, b), { ...rel, opinion: clamp(rel.opinion + delta, -100, 100) });
  }

  /** Sorted-key fold — deterministic regardless of mutation order (stateHash requirement). */
  fold(fold: (v: number) => void): void {
    for (const key of [...this.relations.keys()].sort()) {
      const [a, b] = key.split(':');
      fold(Number(a));
      fold(Number(b));
      const rel = this.relations.get(key) as DiplomaticRelation;
      fold(Math.round(rel.opinion * 1000));
      fold(rel.pacts);
      fold(rel.lastGiftTick);
      fold(rel.lastInsultTick);
    }
  }
}

// ---------------------------------------------------------------- registrar

export interface DiplomacyOptions {
  /** Fog gate (M22): can `observerIndex`'s kingdom act toward `target`? */
  hasDiscovered(observerIndex: number, target: EntityId): boolean;
  /** The target kingdom's own weights, for evaluating a proposal against it. */
  personalityOf(kingdom: EntityId): DiplomacyPersonality;
}

export interface DiplomacyGameplay {
  readonly state: DiplomacyState;
}

export function registerDiplomacyGameplay(
  kernel: Kernel,
  world: World,
  kingdomGame: KingdomGameplay,
  options: DiplomacyOptions,
): DiplomacyGameplay {
  const state = new DiplomacyState();
  kernel.addHashSource('diplomacy', (fold) => state.fold(fold));

  const kingdomAt = (i: number): EntityId | undefined => kingdomGame.kingdomEntities()[i];
  const indexForIssuer = (issuer: number): number => {
    const n = kingdomGame.kingdomEntities().length;
    return Math.max(0, Math.min(n - 1, issuer - 1));
  };
  const reject = (ctx: TickContext, what: string, reason: string): void => {
    ctx.events.publish({ type: 'village.rejected', tick: ctx.tick, data: { what, reason } });
  };

  kernel.registerCommand<{ targetKingdom: number; gold: number }>('kingdom.sendGift', (ctx, p, command) => {
    const senderIndex = indexForIssuer(command.issuer);
    const senderId = kingdomAt(senderIndex);
    const targetId = kingdomAt(p.targetKingdom | 0);
    if (senderId === undefined || targetId === undefined) return reject(ctx, 'kingdom.sendGift', 'no such kingdom');
    if (senderId === targetId) return reject(ctx, 'kingdom.sendGift', 'cannot gift yourself');
    if (!options.hasDiscovered(senderIndex, targetId)) return reject(ctx, 'kingdom.sendGift', 'kingdom not yet discovered');
    const gold = Math.max(0, p.gold);
    const k = world.write(kingdomGame.Kingdom);
    const si = index(senderId as number);
    const ti = index(targetId as number);
    if ((k.treasury[si] as number) < gold) {
      return reject(ctx, 'kingdom.sendGift', `insufficient gold (${(k.treasury[si] as number).toFixed(0)}/${gold})`);
    }
    k.treasury[si] = (k.treasury[si] as number) - gold;
    k.treasury[ti] = (k.treasury[ti] as number) + gold;
    const opinionDelta = state.applyGift(senderId as number, targetId as number, gold, ctx.tick);
    ctx.events.publish({
      type: 'diplomacy.giftSent',
      tick: ctx.tick,
      data: { from: senderId as number, to: targetId as number, gold, opinionDelta },
    });
  });

  kernel.registerCommand<{ targetKingdom: number }>('kingdom.sendInsult', (ctx, p, command) => {
    const senderIndex = indexForIssuer(command.issuer);
    const senderId = kingdomAt(senderIndex);
    const targetId = kingdomAt(p.targetKingdom | 0);
    if (senderId === undefined || targetId === undefined) return reject(ctx, 'kingdom.sendInsult', 'no such kingdom');
    if (senderId === targetId) return reject(ctx, 'kingdom.sendInsult', 'cannot insult yourself');
    if (!options.hasDiscovered(senderIndex, targetId)) return reject(ctx, 'kingdom.sendInsult', 'kingdom not yet discovered');
    const opinionDelta = state.applyInsult(senderId as number, targetId as number, ctx.tick);
    ctx.events.publish({
      type: 'diplomacy.insultSent',
      tick: ctx.tick,
      data: { from: senderId as number, to: targetId as number, opinionDelta },
    });
  });

  kernel.registerCommand<{ targetKingdom: number; pactType: PactType }>('kingdom.proposePact', (ctx, p, command) => {
    const proposerIndex = indexForIssuer(command.issuer);
    const proposerId = kingdomAt(proposerIndex);
    const targetIndex = p.targetKingdom | 0;
    const targetId = kingdomAt(targetIndex);
    if (proposerId === undefined || targetId === undefined) return reject(ctx, 'kingdom.proposePact', 'no such kingdom');
    if (proposerId === targetId) return reject(ctx, 'kingdom.proposePact', 'cannot pact with yourself');
    if (!options.hasDiscovered(proposerIndex, targetId) || !options.hasDiscovered(targetIndex, proposerId)) {
      return reject(ctx, 'kingdom.proposePact', 'kingdoms have not made contact');
    }
    const pactType: PactType = p.pactType === 'trade' ? 'trade' : 'nonAggression';
    if (state.hasPact(proposerId as number, targetId as number, pactType)) {
      return reject(ctx, 'kingdom.proposePact', 'pact already active');
    }
    const opinion = state.opinionOf(proposerId as number, targetId as number);
    const evaluation = evaluateDeal(opinion, pactType, options.personalityOf(targetId));
    if (evaluation.accept) state.addPact(proposerId as number, targetId as number, pactType);
    ctx.events.publish({
      type: 'diplomacy.pactProposed',
      tick: ctx.tick,
      data: {
        from: proposerId as number,
        to: targetId as number,
        pactType,
        value: evaluation.value,
        threshold: evaluation.threshold,
        accepted: evaluation.accept,
      },
    });
  });

  kernel.registerCommand<{ targetKingdom: number; pactType: PactType }>('kingdom.breakPact', (ctx, p, command) => {
    const senderIndex = indexForIssuer(command.issuer);
    const senderId = kingdomAt(senderIndex);
    const targetId = kingdomAt(p.targetKingdom | 0);
    if (senderId === undefined || targetId === undefined) return reject(ctx, 'kingdom.breakPact', 'no such kingdom');
    const pactType: PactType = p.pactType === 'trade' ? 'trade' : 'nonAggression';
    if (!state.hasPact(senderId as number, targetId as number, pactType)) {
      return reject(ctx, 'kingdom.breakPact', 'no such pact');
    }
    state.removePact(senderId as number, targetId as number, pactType);
    state.applyOpinionDelta(senderId as number, targetId as number, BREAK_PACT_OPINION_PENALTY);
    ctx.events.publish({
      type: 'diplomacy.pactBroken',
      tick: ctx.tick,
      data: { from: senderId as number, to: targetId as number, pactType },
    });
  });

  return { state };
}
