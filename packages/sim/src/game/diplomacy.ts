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
 *
 * WAR (M31; doc 06 §10 `atWar`): `kingdom.declareWar` sets it, auto-breaking any
 * active non-aggression pact (declaring war while one holds IS the betrayal —
 * one opinion penalty, not two competing states). CASUS BELLI: a declaration
 * with `casusBelli: true` (the declarer's claim of just cause — this v1 has no
 * way to verify a claim, same trust-the-input shape as every other command)
 * costs less opinion than one without; a full reputation system (public,
 * cross-kingdom) is M35, so the only cost modelled is the pairwise opinion hit
 * — no internal-happiness penalty (that would need diplomacy.ts to depend on
 * population.ts, which it deliberately doesn't).
 *
 * WAR EXHAUSTION climbs daily while `atWar` and is the T objective's
 * "no forever-wars" GUARANTEE, not just an AI tendency: at `FORCED_PEACE_EXHAUSTION`
 * peace is imposed unconditionally, no proposal needed. Short of that,
 * `kingdom.proposePeace` evaluates through `evaluatePeaceDeal` — the same
 * (value ≥ threshold × trust × personality margin) shape as `evaluateDeal`,
 * so a peace offer is exactly as symmetric/ungameable as a NAP proposal.
 * RANSOM (GDD §10's `ransom{characterId,amount}` clause) is Character-scoped
 * (M34) and stays out of scope; `tribute` (a flat one-time gold transfer as
 * part of a peace deal) is this milestone's stand-in for "paying to end it".
 *
 * DIPLOMACY V2 (M35; GDD §10; doc 07 §7):
 *
 * ALLIANCE is a third pact bit (`PACT_ALLIANCE`), evaluated by the SAME
 * `evaluateDeal` every pact type already uses — no new evaluator, just a
 * third `pactValue` branch. JOINT WARS ("teeth, not paper"): the moment
 * `kingdom.declareWar` executes, every kingdom allied with EITHER belligerent
 * is cascaded into the war on that belligerent's side automatically — no
 * proposal, no opt-out, one level deep (an ally-of-an-ally is NOT dragged in
 * transitively, a deliberate v1 bound against single-command world wars).
 * Honoring the cascade nets the joining kingdom a reputation gain and a
 * positive memory entry. `jointWarCoordination` (M38, doc 07 §10) narrows
 * this per difficulty: 'on' (default) is the M35 behaviour above; 'limited'
 * drops voluntary allies from the cascade (only obligated vassals still
 * join); 'off' cascades nobody.
 *
 * VASSALAGE is asymmetric, so it doesn't fit the symmetric pact bitmask —
 * `vassalOf: Map<vassal, lord>`, at most one lord per vassal (no chains
 * modelled). `kingdom.proposeVassalage` runs either direction (submit, or
 * impose) through `evaluateVassalageDeal`: a would-be LORD nearly always
 * accepts (a free tribute stream); a would-be VASSAL only accepts when it's
 * losing a war against the proposer (war exhaustion IS the motivation,
 * same "ending it has value" shape `evaluatePeaceDeal` already uses) — the
 * OQ-9 "AI offers/accepts vassalage when hopeless" capitulation path. Once
 * established: the vassal cannot `kingdom.declareWar` independently, pays a
 * seasonal tribute automatically, and is cascaded into the lord's wars by
 * the SAME joint-war mechanic alliances use.
 *
 * REPUTATION is GLOBAL per kingdom (0..100, default neutral), unlike
 * pairwise opinion — it moves on public acts (breaking a pact, an
 * unprovoked war) and factors into every deal's threshold via
 * `reputationFactor`, exactly the way GDD §10 describes ("oathbreaking
 * taints all future negotiations"). `reputationFactor(DEFAULT_REPUTATION)`
 * is EXACTLY 1 and every M23/M31 call site keeps its 3-argument form — this
 * is additive, no behaviour change to a single existing test.
 *
 * MEMORY/GRUDGES: a bounded (`MEMORY_CAP`), per-kingdom-pair list of
 * `MemoryEntry` recorded on significant acts (pact broken, war declared,
 * alliance honored) — NOT on gifts/insults, which already have their own
 * cooldown-gated opinion channel. Entries are stored raw (event, valence,
 * weight, tick); `effectiveMemoryWeight` is a PURE, personality-scaled
 * (`grudgeRetention`) exponential decay computed on read, so the stored
 * data itself never mutates from the passage of time — which is exactly
 * what makes it trivial to serialize. `diplomacySection` is the T
 * objective: a `SaveSection` (persistence.ts, M17) proving grudges (and
 * every other pairwise/global fact this module owns) round-trip a
 * save/load cycle byte-for-byte — the first save section any relational
 * (non-ECS) game/ state has ever gotten, since M23/M31/M32/M34's
 * DiplomacyState/ResearchState/CharacterRelations never needed one.
 */
import { clamp, type EntityId } from '@crowns/core';
import type { World } from '../ecs.js';
import type { Kernel, SimSystem, TickContext } from '../kernel.js';
import { TICKS_PER_DAY, TICKS_PER_SEASON } from '../time.js';
import type { KingdomGameplay } from './kingdom.js';
import type { SaveSection } from '../persistence.js';

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
export const PACT_ALLIANCE = 4; // M35: mutual defense — triggers the joint-war cascade
export type PactType = 'nonAggression' | 'trade' | 'alliance';
const pactBit = (type: PactType): number => (type === 'nonAggression' ? PACT_NAP : type === 'trade' ? PACT_TRADE : PACT_ALLIANCE);

export const WAR_DECLARED_OPINION_PENALTY = -15; // with a claimed casus belli
export const WAR_DECLARED_NO_CAUSE_PENALTY = -35; // unprovoked (GDD §10)
export const WAR_EXHAUSTION_PER_DAY = 100 / 90; // reaches the cap in one season, unaided
export const FORCED_PEACE_EXHAUSTION = 100; // the "no forever-wars" guarantee — imposed, not proposed
export const PEACE_BASE_VALUE = 20; // nominal value of "the fighting stops", scaled by exhaustion
export const TRIBUTE_GOLD_TO_VALUE = 0.1; // 100 gold of tribute ~ 10 value

// ---------------------------------------------------------------- M35: reputation

export const DEFAULT_REPUTATION = 70; // neutral-good starting point (0..100)
export const REPUTATION_MIN = 0;
export const REPUTATION_MAX = 100;
export const UNPROVOKED_WAR_REPUTATION_PENALTY = -20;
export const CASUS_BELLI_WAR_REPUTATION_PENALTY = -8;
export const BREAK_NAP_REPUTATION_PENALTY = -10;
export const BREAK_ALLIANCE_REPUTATION_PENALTY = -18; // breaking an alliance is worse oathbreaking
export const HONOR_ALLIANCE_REPUTATION_GAIN = 5;

/** Low reputation raises every deal's threshold (GDD §10: "oathbreaking taints all future
 * negotiations"); neutral at `DEFAULT_REPUTATION`, so every pre-M35 call site is unaffected. */
export function reputationFactor(reputation: number): number {
  return clamp(1 + (DEFAULT_REPUTATION - reputation) / 100, 0.8, 1.4);
}

// ---------------------------------------------------------------- M35: vassalage

export const VASSALAGE_LORD_VALUE = 25; // a free tribute stream — a would-be lord nearly always accepts
export const VASSALAGE_SUBMIT_BASE_VALUE = 3; // reluctance to submit outside of a losing war
export const VASSALAGE_SUBMIT_FULL_VALUE = 30; // value of submission at maximum war exhaustion
export const VASSAL_TRIBUTE_FRACTION = 0.1; // fraction of the vassal's treasury, per season
export const BREAK_VASSALAGE_OPINION_PENALTY = -25; // rebellion, when the VASSAL breaks free

/** A would-be LORD nearly always accepts (free tribute + military support); a would-be VASSAL
 * only accepts in proportion to how badly it's losing a war against the proposer — the
 * "capitulation when hopeless" path (OQ-9). Pure function of (perspective, exhaustion, weights). */
export function evaluateVassalageDeal(
  perspective: 'lord' | 'vassal',
  warExhaustionAgainstProposer: number,
  weights: DiplomacyPersonality,
): DealEvaluation {
  const value =
    perspective === 'lord'
      ? VASSALAGE_LORD_VALUE
      : VASSALAGE_SUBMIT_BASE_VALUE +
        (clamp(warExhaustionAgainstProposer, 0, 100) / 100) * (VASSALAGE_SUBMIT_FULL_VALUE - VASSALAGE_SUBMIT_BASE_VALUE);
  const threshold = ACCEPT_THRESHOLD * personalityMargin(weights);
  return { value, threshold, accept: value >= threshold };
}

// ---------------------------------------------------------------- M35: memory & grudges

export const MEMORY_CAP = 5; // bounded top-K by weight, per kingdom-pair

export interface MemoryEntry {
  readonly event: string; // short tag: 'pactBroken' | 'unprovokedWar' | 'warWithCause' | 'honoredAlliance' | ...
  readonly valence: number; // -1..1
  readonly weight: number; // importance; decays on READ, never mutated in storage
  readonly tick: number;
}

/** Personality-scaled (`grudgeRetention` 0..1) exponential decay — pure, computed on read so the
 * STORED entry never changes (trivial to serialize exactly as recorded). */
export function effectiveMemoryWeight(entry: MemoryEntry, currentTick: number, grudgeRetention: number): number {
  const days = Math.max(0, (currentTick - entry.tick) / TICKS_PER_DAY);
  const halfLifeDays = 10 + clamp(grudgeRetention, 0, 1) * 90; // 10 (forgetful) .. 100 (grudge-holder) days
  return entry.weight * Math.pow(0.5, days / halfLifeDays);
}

function pushMemory(memories: readonly MemoryEntry[], entry: MemoryEntry): readonly MemoryEntry[] {
  const next = [...memories, entry];
  if (next.length <= MEMORY_CAP) return next;
  return [...next].sort((a, b) => b.weight - a.weight || b.tick - a.tick || b.event.localeCompare(a.event)).slice(0, MEMORY_CAP);
}

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

/** Alliance is a bigger ask than NAP/trade (mutual defense, joint-war exposure) — needs decent,
 * not just non-hostile, relations to be worth it. */
export function allianceValue(opinion: number): number {
  return clamp(10 + opinion / 4, 10, 40);
}

export function pactValue(opinion: number, type: PactType): number {
  if (type === 'nonAggression') return napValue(opinion);
  if (type === 'trade') return TRADE_VALUE;
  return allianceValue(opinion);
}

export interface DealEvaluation {
  readonly value: number;
  readonly threshold: number;
  readonly accept: boolean;
}

/**
 * Doc 07 §4: accept if value received >= value given x trustFactor x personality margin.
 * Pure function of (opinion, type, weights[, reputation]) only — never of which kingdom is
 * proposing, so it can't be gamed by asking from "the other side" (the symmetry test
 * objective). `reputation` (M35) defaults to `DEFAULT_REPUTATION`, whose `reputationFactor`
 * is exactly 1 — every pre-M35 call site is untouched.
 */
export function evaluateDeal(
  opinion: number,
  type: PactType,
  weights: DiplomacyPersonality,
  reputation: number = DEFAULT_REPUTATION,
): DealEvaluation {
  const value = pactValue(opinion, type);
  const threshold = ACCEPT_THRESHOLD * trustFactor(opinion) * personalityMargin(weights) * reputationFactor(reputation);
  return { value, threshold, accept: value >= threshold };
}

/** Nominal value of a peace offer: worse a war has gone (`exhaustion`) plus any `tribute` gold
 * sweetening it, against the SAME threshold shape `evaluateDeal` uses — pure function of
 * (exhaustion, tribute, weights[, reputation]) only, same "not who's asking" guarantee. */
export function evaluatePeaceDeal(
  exhaustion: number,
  tribute: number,
  weights: DiplomacyPersonality,
  reputation: number = DEFAULT_REPUTATION,
): DealEvaluation {
  const value = (clamp(exhaustion, 0, 100) / 100) * PEACE_BASE_VALUE + Math.max(0, tribute) * TRIBUTE_GOLD_TO_VALUE;
  const threshold = ACCEPT_THRESHOLD * personalityMargin(weights) * reputationFactor(reputation);
  return { value, threshold, accept: value >= threshold };
}

// ---------------------------------------------------------------- state

export interface DiplomaticRelation {
  readonly opinion: number; // -100..100
  readonly pacts: number; // bitmask: PACT_NAP | PACT_TRADE | PACT_ALLIANCE
  readonly lastGiftTick: number;
  readonly lastInsultTick: number;
  readonly atWar: boolean; // M31
  readonly warExhaustion: number; // 0..100, M31
  readonly memories: readonly MemoryEntry[]; // M35, bounded to MEMORY_CAP
}

const NEVER = -1; // sentinel: no gift/insult has ever been sent this pair
const EMPTY_MEMORIES: readonly MemoryEntry[] = [];
const EMPTY_RELATION: DiplomaticRelation = {
  opinion: 0, pacts: 0, lastGiftTick: NEVER, lastInsultTick: NEVER, atWar: false, warExhaustion: 0,
  memories: EMPTY_MEMORIES,
};

function pairKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/** Pairwise opinion/pact state (doc 06 §10), keyed by raw kingdom EntityId, both orderings equal. */
export class DiplomacyState {
  private readonly relations = new Map<string, DiplomaticRelation>();
  private readonly reputation = new Map<number, number>();
  private readonly vassalOf = new Map<number, number>();

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

  isAtWar(a: number, b: number): boolean {
    return this.relationOf(a, b).atWar;
  }

  warExhaustionOf(a: number, b: number): number {
    return this.relationOf(a, b).warExhaustion;
  }

  /** Auto-breaks any active NAP/alliance between the pair — holding one while declaring war on
   * the SAME kingdom is the betrayal. */
  declareWar(a: number, b: number): void {
    const rel = this.relationOf(a, b);
    this.relations.set(pairKey(a, b), { ...rel, atWar: true, warExhaustion: 0, pacts: rel.pacts & ~(PACT_NAP | PACT_ALLIANCE) });
  }

  /** Ends the war (proposed peace accepted, or exhaustion forced it) — exhaustion resets for next time. */
  makePeace(a: number, b: number): void {
    const rel = this.relationOf(a, b);
    this.relations.set(pairKey(a, b), { ...rel, atWar: false, warExhaustion: 0 });
  }

  /** Daily accrual while at war; returns the new value (callers check it against the forced-peace cap). */
  advanceWarExhaustion(a: number, b: number, amount: number): number {
    const rel = this.relationOf(a, b);
    const warExhaustion = clamp(rel.warExhaustion + amount, 0, 100);
    this.relations.set(pairKey(a, b), { ...rel, warExhaustion });
    return warExhaustion;
  }

  /** Every pair currently at war, ascending key order (deterministic). */
  activeWars(): { a: number; b: number }[] {
    const out: { a: number; b: number }[] = [];
    for (const key of [...this.relations.keys()].sort()) {
      const rel = this.relations.get(key) as DiplomaticRelation;
      if (!rel.atWar) continue;
      const [a, b] = key.split(':');
      out.push({ a: Number(a), b: Number(b) });
    }
    return out;
  }

  // ---------------- M35: memory & grudges ----------------

  /** Records a significant act (pact broken, war declared, alliance honored, ...); bounded to
   * MEMORY_CAP by weight (see `pushMemory`). */
  recordMemory(a: number, b: number, event: string, valence: number, weight: number, tick: number): void {
    const rel = this.relationOf(a, b);
    this.relations.set(pairKey(a, b), { ...rel, memories: pushMemory(rel.memories, { event, valence, weight, tick }) });
  }

  memoriesOf(a: number, b: number): readonly MemoryEntry[] {
    return this.relationOf(a, b).memories;
  }

  // ---------------- M35: reputation (global per kingdom, not pairwise) ----------------

  reputationOf(kingdomId: number): number {
    return this.reputation.get(kingdomId) ?? DEFAULT_REPUTATION;
  }

  adjustReputation(kingdomId: number, delta: number): number {
    const next = clamp(this.reputationOf(kingdomId) + delta, REPUTATION_MIN, REPUTATION_MAX);
    this.reputation.set(kingdomId, next);
    return next;
  }

  // ---------------- M35: vassalage (asymmetric — not part of the symmetric pact bitmask) ----------------

  lordOf(vassal: number): number | undefined {
    return this.vassalOf.get(vassal);
  }

  isVassal(kingdomId: number): boolean {
    return this.vassalOf.has(kingdomId);
  }

  /** Every vassal currently sworn to `lord`, ascending id order (deterministic). */
  vassalsOf(lord: number): number[] {
    return [...this.vassalOf.entries()].filter(([, l]) => l === lord).map(([v]) => v).sort((x, y) => x - y);
  }

  establishVassalage(vassal: number, lord: number): void {
    this.vassalOf.set(vassal, lord);
  }

  /** Either party may dissolve it; returns the (former) lord, or undefined if none existed. */
  breakVassalage(vassal: number): number | undefined {
    const lord = this.vassalOf.get(vassal);
    this.vassalOf.delete(vassal);
    return lord;
  }

  /** M53 (new-lords-rising): a fresh banner inherits NOTHING of the dead kingdom's politics —
   * every pairwise relation, the global reputation, and any vassalage (as vassal or lord)
   * involving this kingdom id is erased back to the blank-slate defaults. */
  resetKingdom(kingdomId: number): void {
    const suffix = `:${kingdomId}`;
    const prefix = `${kingdomId}:`;
    for (const key of [...this.relations.keys()]) {
      if (key.startsWith(prefix) || key.endsWith(suffix)) this.relations.delete(key);
    }
    this.reputation.delete(kingdomId);
    this.vassalOf.delete(kingdomId);
    for (const [vassal, lord] of [...this.vassalOf.entries()]) {
      if (lord === kingdomId) this.vassalOf.delete(vassal);
    }
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
      fold(rel.atWar ? 1 : 0);
      fold(Math.round(rel.warExhaustion * 1000));
      for (const m of rel.memories) {
        fold(Math.round(m.valence * 1000));
        fold(Math.round(m.weight * 1000));
        fold(m.tick);
        for (let i = 0; i < m.event.length; i++) fold(m.event.charCodeAt(i));
      }
    }
    for (const kingdomId of [...this.reputation.keys()].sort((a, b) => a - b)) {
      fold(kingdomId);
      fold(Math.round((this.reputation.get(kingdomId) as number) * 1000));
    }
    for (const vassal of [...this.vassalOf.keys()].sort((a, b) => a - b)) {
      fold(vassal);
      fold(this.vassalOf.get(vassal) as number);
    }
  }

  // ---------------- M35: save/load (persistence.ts, T objective: grudge persistence) ----------------

  /** Plain JSON-safe snapshot — every relation (incl. memories), all reputations, all vassalage. */
  saveState(): unknown {
    return {
      relations: [...this.relations.entries()].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)),
      reputation: [...this.reputation.entries()].sort((x, y) => x[0] - y[0]),
      vassalOf: [...this.vassalOf.entries()].sort((x, y) => x[0] - y[0]),
    };
  }

  loadState(data: unknown): void {
    const { relations, reputation, vassalOf } = data as {
      relations: [string, DiplomaticRelation][];
      reputation: [number, number][];
      vassalOf: [number, number][];
    };
    this.relations.clear();
    for (const [key, rel] of relations) this.relations.set(key, rel);
    this.reputation.clear();
    for (const [kingdomId, rep] of reputation) this.reputation.set(kingdomId, rep);
    this.vassalOf.clear();
    for (const [vassal, lord] of vassalOf) this.vassalOf.set(vassal, lord);
  }
}

// ---------------------------------------------------------------- registrar

export interface DiplomacyOptions {
  /** Fog gate (M22): can `observerIndex`'s kingdom act toward `target`? */
  hasDiscovered(observerIndex: number, target: EntityId): boolean;
  /** The target kingdom's own weights, for evaluating a proposal against it. */
  personalityOf(kingdom: EntityId): DiplomacyPersonality;
  /** M38 difficulty lever (doc 07 §10 "coordination"): 'on' (default, M35's original behaviour)
   * cascades both allies AND vassals into a new war; 'limited' cascades only vassals (an
   * obligation, not a choice); 'off' cascades neither — allies/vassals never auto-join. */
  readonly jointWarCoordination?: 'off' | 'limited' | 'on';
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
    const pactType: PactType = p.pactType === 'trade' ? 'trade' : p.pactType === 'alliance' ? 'alliance' : 'nonAggression';
    if (state.hasPact(proposerId as number, targetId as number, pactType)) {
      return reject(ctx, 'kingdom.proposePact', 'pact already active');
    }
    const opinion = state.opinionOf(proposerId as number, targetId as number);
    const evaluation = evaluateDeal(opinion, pactType, options.personalityOf(targetId), state.reputationOf(proposerId as number));
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
    const pactType: PactType = p.pactType === 'trade' ? 'trade' : p.pactType === 'alliance' ? 'alliance' : 'nonAggression';
    if (!state.hasPact(senderId as number, targetId as number, pactType)) {
      return reject(ctx, 'kingdom.breakPact', 'no such pact');
    }
    state.removePact(senderId as number, targetId as number, pactType);
    state.applyOpinionDelta(senderId as number, targetId as number, BREAK_PACT_OPINION_PENALTY);
    // M35: breaking an alliance is worse oathbreaking than dropping a NAP/trade pact — a bigger,
    // GLOBAL reputation hit (not just pairwise opinion) plus a grudge memory for the betrayed side.
    const reputationPenalty = pactType === 'alliance' ? BREAK_ALLIANCE_REPUTATION_PENALTY : BREAK_NAP_REPUTATION_PENALTY;
    state.adjustReputation(senderId as number, reputationPenalty);
    state.recordMemory(senderId as number, targetId as number, 'pactBroken', -0.7, pactType === 'alliance' ? 8 : 5, ctx.tick);
    ctx.events.publish({
      type: 'diplomacy.pactBroken',
      tick: ctx.tick,
      data: { from: senderId as number, to: targetId as number, pactType },
    });
  });

  // ---------------- war (M31) ----------------

  /** M35: the moment a war starts, every kingdom allied with (or vassal to) EITHER belligerent
   * is cascaded in on that belligerent's side — automatic, unconditional, one level deep (an
   * ally-of-an-ally is not dragged in transitively — "teeth, not paper" without single-command
   * world wars). Honoring the call nets a small reputation gain and a positive memory. */
  const cascadeJointWar = (ctx: TickContext, a: number, b: number): void => {
    const coordination = options.jointWarCoordination ?? 'on';
    if (coordination === 'off') return;
    const kingdoms = kingdomGame.kingdomEntities().map((e) => e as number);
    for (const [belligerent, opponent] of [
      [a, b],
      [b, a],
    ] as const) {
      const reinforcements = kingdoms
        .filter(
          (k) =>
            k !== a &&
            k !== b &&
            (state.lordOf(k) === belligerent || (coordination === 'on' && state.hasPact(k, belligerent, 'alliance'))),
        )
        .sort((x, y) => x - y);
      for (const ally of reinforcements) {
        if (state.isAtWar(ally, opponent)) continue;
        state.declareWar(ally, opponent);
        state.adjustReputation(ally, HONOR_ALLIANCE_REPUTATION_GAIN);
        state.recordMemory(ally, belligerent, 'honoredAlliance', 0.4, 6, ctx.tick);
        ctx.events.publish({ type: 'diplomacy.joinedWar', tick: ctx.tick, data: { kingdom: ally, side: belligerent, against: opponent } });
      }
    }
  };

  kernel.registerCommand<{ targetKingdom: number; casusBelli?: boolean }>('kingdom.declareWar', (ctx, p, command) => {
    const declarerIndex = indexForIssuer(command.issuer);
    const declarerId = kingdomAt(declarerIndex);
    const targetId = kingdomAt(p.targetKingdom | 0);
    if (declarerId === undefined || targetId === undefined) return reject(ctx, 'kingdom.declareWar', 'no such kingdom');
    if (declarerId === targetId) return reject(ctx, 'kingdom.declareWar', 'cannot declare war on yourself');
    if (!options.hasDiscovered(declarerIndex, targetId)) return reject(ctx, 'kingdom.declareWar', 'kingdom not yet discovered');
    if (state.isAtWar(declarerId as number, targetId as number)) return reject(ctx, 'kingdom.declareWar', 'already at war');
    if (state.lordOf(declarerId as number) !== undefined) {
      return reject(ctx, 'kingdom.declareWar', 'a vassal cannot declare war independently');
    }
    const casusBelli = p.casusBelli === true;
    state.declareWar(declarerId as number, targetId as number);
    state.applyOpinionDelta(
      declarerId as number, targetId as number,
      casusBelli ? WAR_DECLARED_OPINION_PENALTY : WAR_DECLARED_NO_CAUSE_PENALTY,
    );
    state.adjustReputation(declarerId as number, casusBelli ? CASUS_BELLI_WAR_REPUTATION_PENALTY : UNPROVOKED_WAR_REPUTATION_PENALTY);
    state.recordMemory(
      declarerId as number, targetId as number,
      casusBelli ? 'warWithCause' : 'unprovokedWar',
      -1, casusBelli ? 6 : 10, ctx.tick,
    );
    cascadeJointWar(ctx, declarerId as number, targetId as number);
    ctx.events.publish({
      type: 'diplomacy.warDeclared',
      tick: ctx.tick,
      data: { from: declarerId as number, to: targetId as number, casusBelli },
    });
  });

  kernel.registerCommand<{ targetKingdom: number; tribute?: number }>('kingdom.proposePeace', (ctx, p, command) => {
    const proposerIndex = indexForIssuer(command.issuer);
    const proposerId = kingdomAt(proposerIndex);
    const targetId = kingdomAt(p.targetKingdom | 0);
    if (proposerId === undefined || targetId === undefined) return reject(ctx, 'kingdom.proposePeace', 'no such kingdom');
    if (!state.isAtWar(proposerId as number, targetId as number)) return reject(ctx, 'kingdom.proposePeace', 'not at war');
    const tribute = Math.max(0, p.tribute ?? 0);
    const ki = index(proposerId as number);
    const k = world.write(kingdomGame.Kingdom);
    if (tribute > 0 && (k.treasury[ki] as number) < tribute) {
      return reject(ctx, 'kingdom.proposePeace', `insufficient gold for tribute (${(k.treasury[ki] as number).toFixed(0)}/${tribute})`);
    }
    const exhaustion = state.warExhaustionOf(proposerId as number, targetId as number);
    const evaluation = evaluatePeaceDeal(exhaustion, tribute, options.personalityOf(targetId), state.reputationOf(proposerId as number));
    if (evaluation.accept) {
      if (tribute > 0) {
        k.treasury[ki] = (k.treasury[ki] as number) - tribute;
        k.treasury[index(targetId as number)] = (k.treasury[index(targetId as number)] as number) + tribute;
      }
      state.makePeace(proposerId as number, targetId as number);
    }
    ctx.events.publish({
      type: 'diplomacy.peaceProposed',
      tick: ctx.tick,
      data: {
        from: proposerId as number, to: targetId as number, tribute,
        value: evaluation.value, threshold: evaluation.threshold, accepted: evaluation.accept,
      },
    });
  });

  // daily: war exhaustion climbs; at the cap, peace is FORCED (the "no forever-wars" guarantee)
  const warExhaustionSystem: SimSystem = {
    name: 'diplomacy-war-exhaustion',
    period: TICKS_PER_DAY,
    update(ctx: TickContext): void {
      for (const { a, b } of state.activeWars()) {
        const exhaustion = state.advanceWarExhaustion(a, b, WAR_EXHAUSTION_PER_DAY);
        if (exhaustion >= FORCED_PEACE_EXHAUSTION) {
          state.makePeace(a, b);
          ctx.events.publish({ type: 'diplomacy.peaceForced', tick: ctx.tick, data: { a, b } });
        }
      }
    },
  };
  kernel.registerSystem(warExhaustionSystem);

  // ---------------- vassalage (M35) ----------------

  kernel.registerCommand<{ counterpart: number; asVassal: boolean }>('kingdom.proposeVassalage', (ctx, p, command) => {
    const proposerIndex = indexForIssuer(command.issuer);
    const proposerId = kingdomAt(proposerIndex);
    const counterpartIndex = p.counterpart | 0;
    const counterpartId = kingdomAt(counterpartIndex);
    if (proposerId === undefined || counterpartId === undefined) return reject(ctx, 'kingdom.proposeVassalage', 'no such kingdom');
    if (proposerId === counterpartId) return reject(ctx, 'kingdom.proposeVassalage', 'cannot vassalize yourself');
    if (!options.hasDiscovered(proposerIndex, counterpartId) || !options.hasDiscovered(counterpartIndex, proposerId)) {
      return reject(ctx, 'kingdom.proposeVassalage', 'kingdoms have not made contact');
    }
    const vassal = p.asVassal ? (proposerId as number) : (counterpartId as number);
    const lord = p.asVassal ? (counterpartId as number) : (proposerId as number);
    if (state.isVassal(vassal)) return reject(ctx, 'kingdom.proposeVassalage', 'already a vassal');
    if (state.isVassal(lord)) return reject(ctx, 'kingdom.proposeVassalage', 'a vassal cannot itself hold vassals');
    const perspective = p.asVassal ? 'lord' : 'vassal'; // the COUNTERPART evaluates the offer
    const evaluation = evaluateVassalageDeal(
      perspective,
      state.warExhaustionOf(vassal, lord),
      options.personalityOf(counterpartId),
    );
    if (evaluation.accept) {
      state.establishVassalage(vassal, lord);
      if (state.isAtWar(vassal, lord)) state.makePeace(vassal, lord);
    }
    ctx.events.publish({
      type: 'diplomacy.vassalageProposed',
      tick: ctx.tick,
      data: {
        from: proposerId as number, to: counterpartId as number, vassal, lord,
        value: evaluation.value, threshold: evaluation.threshold, accepted: evaluation.accept,
      },
    });
  });

  kernel.registerCommand<{ counterpart: number }>('kingdom.breakVassalage', (ctx, p, command) => {
    const senderIndex = indexForIssuer(command.issuer);
    const senderId = kingdomAt(senderIndex);
    const counterpartId = kingdomAt(p.counterpart | 0);
    if (senderId === undefined || counterpartId === undefined) return reject(ctx, 'kingdom.breakVassalage', 'no such kingdom');
    const senderIsVassal = state.lordOf(senderId as number) === (counterpartId as number);
    const senderIsLord = state.lordOf(counterpartId as number) === (senderId as number);
    if (!senderIsVassal && !senderIsLord) return reject(ctx, 'kingdom.breakVassalage', 'no such vassalage');
    const vassal = senderIsVassal ? (senderId as number) : (counterpartId as number);
    state.breakVassalage(vassal);
    if (senderIsVassal) state.applyOpinionDelta(senderId as number, counterpartId as number, BREAK_VASSALAGE_OPINION_PENALTY); // rebellion
    ctx.events.publish({
      type: 'diplomacy.vassalageBroken',
      tick: ctx.tick,
      data: { vassal, lord: senderIsVassal ? (counterpartId as number) : (senderId as number), byRebellion: senderIsVassal },
    });
  });

  // seasonal: every vassal pays its lord a fraction of its treasury
  const vassalTributeSystem: SimSystem = {
    name: 'diplomacy-vassal-tribute',
    period: TICKS_PER_SEASON,
    access: { writes: [kingdomGame.Kingdom] },
    update(ctx: TickContext): void {
      const k = world.write(kingdomGame.Kingdom);
      for (const kingdomId of kingdomGame.kingdomEntities().map((e) => e as number)) {
        const lord = state.lordOf(kingdomId);
        if (lord === undefined) continue;
        const vi = index(kingdomId);
        const li = index(lord);
        const tribute = (k.treasury[vi] as number) * VASSAL_TRIBUTE_FRACTION;
        if (tribute <= 0) continue;
        k.treasury[vi] = (k.treasury[vi] as number) - tribute;
        k.treasury[li] = (k.treasury[li] as number) + tribute;
        ctx.events.publish({ type: 'diplomacy.vassalTribute', tick: ctx.tick, data: { vassal: kingdomId, lord, tribute } });
      }
    },
  };
  kernel.registerSystem(vassalTributeSystem);

  return { state };
}

/** M35 T objective: a `SaveSection` (persistence.ts, M17) proving every fact this module owns —
 * opinion, pacts, war, reputation, vassalage, and (the milestone's headline) grudge memory —
 * round-trips a save/load cycle exactly. */
export function diplomacySection(state: DiplomacyState): SaveSection {
  return {
    key: 'diplomacy',
    version: 1,
    save: () => state.saveState(),
    load: (data) => state.loadState(data),
  };
}
