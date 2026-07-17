/**
 * Knowledge model (roadmap M19; doc 07 §6). AI (and, eventually, the player
 * UI) reasons over BELIEFS, never authoritative state — a fact records what a
 * kingdom last observed, with a confidence that decays until refreshed.
 *
 * Facts are packed as a flat number[] rather than stored as a class instance:
 * the ECS object-component save codec (ecs.ts) only knows
 * `string | number[] | Map<number,number>`, and a fact needs several floats
 * per entry — packing keeps knowledge storage inside that codec for free.
 */
import type { Rng } from '@crowns/core';

// 'garrisonStrength' (M54, ADR-4 §4) is APPENDED — pack() stores kinds positionally,
// so appending keeps every pre-M54 save's fact indexes decoding unchanged.
export type FactKind = 'armyStrength' | 'treasury' | 'techLevel' | 'villageState' | 'intent' | 'garrisonStrength';
export type FactSource = 'scout' | 'trade' | 'envoy' | 'battle' | 'rumor';

const FACT_KINDS: readonly FactKind[] = ['armyStrength', 'treasury', 'techLevel', 'villageState', 'intent', 'garrisonStrength'];
const FACT_SOURCES: readonly FactSource[] = ['scout', 'trade', 'envoy', 'battle', 'rumor'];
const FIELDS_PER_FACT = 6;

export interface KnowledgeFact {
  readonly subject: number; // EntityId of whatever the fact is about
  readonly kind: FactKind;
  readonly value: number;
  readonly confidence: number; // 0..1
  readonly lastUpdated: number; // tick
  readonly source: FactSource;
}

function factKey(subject: number, kind: FactKind): string {
  return `${subject}:${kind}`;
}

/** One kingdom's beliefs. Construct via `unpack`; persist via `pack`. */
export class KnowledgeModel {
  private readonly facts = new Map<string, KnowledgeFact>();

  static unpack(packed: readonly number[]): KnowledgeModel {
    const model = new KnowledgeModel();
    for (let i = 0; i + FIELDS_PER_FACT <= packed.length; i += FIELDS_PER_FACT) {
      const fact: KnowledgeFact = {
        subject: packed[i] as number,
        kind: FACT_KINDS[packed[i + 1] as number] as FactKind,
        value: packed[i + 2] as number,
        confidence: packed[i + 3] as number,
        lastUpdated: packed[i + 4] as number,
        source: FACT_SOURCES[packed[i + 5] as number] as FactSource,
      };
      model.facts.set(factKey(fact.subject, fact.kind), fact);
    }
    return model;
  }

  /** Sorted-key order — stable regardless of record() call order (determinism). */
  pack(): number[] {
    const out: number[] = [];
    for (const key of [...this.facts.keys()].sort()) {
      const f = this.facts.get(key) as KnowledgeFact;
      out.push(f.subject, FACT_KINDS.indexOf(f.kind), f.value, f.confidence, f.lastUpdated, FACT_SOURCES.indexOf(f.source));
    }
    return out;
  }

  /** Overwrite-on-refresh: a newer observation replaces the prior belief entirely. */
  record(fact: KnowledgeFact): void {
    this.facts.set(factKey(fact.subject, fact.kind), fact);
  }

  get(subject: number, kind: FactKind): KnowledgeFact | undefined {
    return this.facts.get(factKey(subject, kind));
  }

  all(): readonly KnowledgeFact[] {
    return [...this.facts.values()];
  }

  /**
   * Confidence halves every `halfLifeTicks` elapsed since the fact's last
   * update. Advances `lastUpdated` to `tick` so repeated calls compose
   * correctly (each call decays only the newly-elapsed span, not the whole
   * history again).
   */
  decayAll(tick: number, halfLifeTicks: number): void {
    for (const [key, fact] of this.facts) {
      const elapsed = tick - fact.lastUpdated;
      if (elapsed <= 0) continue;
      this.facts.set(key, {
        ...fact,
        confidence: fact.confidence * Math.pow(0.5, elapsed / halfLifeTicks),
        lastUpdated: tick,
      });
    }
  }

  /**
   * believedValue = value ± noise(1-confidence) — deterministic PRNG fork
   * keyed by (subject, kind, tick), matching the kernel's own
   * `system:<name>` fork convention. Returns undefined if never observed.
   */
  believedValue(subject: number, kind: FactKind, tick: number, rng: Rng): number | undefined {
    const fact = this.get(subject, kind);
    if (fact === undefined) return undefined;
    const noise = rng.fork(`fact:${subject}:${kind}:${tick}`).nextFloat() * 2 - 1; // [-1, 1)
    return fact.value + noise * (1 - fact.confidence) * fact.value;
  }
}

/** ObjectComponent hasher for the packed form — already sorted, so this folds deterministically. */
export function hashKnowledge(packed: readonly number[], fold: (v: number) => void): void {
  for (const n of packed) fold(n);
}
