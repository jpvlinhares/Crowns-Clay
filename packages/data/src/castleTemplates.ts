/**
 * Castle-template defs (roadmap M52; doc 07 §5 — its "template-based skeletons"
 * finally load-bearing, per ADR-4 §1: templated AI defence over genuine planning).
 *
 * A template is a BUILD QUEUE over the defence layer (M49), offsets measured
 * from the keep centre: `ring` entries expand to a square perimeter at that
 * radius, `at` entries are explicit tile offsets. The AI defence manager
 * (sim/ai/defence.ts) walks the expanded queue one structure per day as the
 * capital's stores allow, SKIPPING tiles the local terrain refuses (rock and
 * water are free walls — that skip IS the terrain adaptation, doc 07 §5's
 * "adapted to local terrain"). `garrisonAnchors` are where idle soldiers get
 * posted, in order.
 *
 * Content, not code (doc 09 "Mod Zero"): total-conversion mods can ship their
 * own castle doctrine without touching the engine.
 */
import { v, type Validator } from './validate.js';

export interface CastleTemplatePlanEntry {
  /** Building def id — must carry a `defense` block (referential check at load). */
  readonly def: string;
  /** Square-perimeter ring at this radius from the keep centre. */
  readonly ring?: number;
  /** Explicit [dx, dy] offsets from the keep centre. */
  readonly at?: readonly (readonly [number, number])[];
}

export interface CastleTemplateDef {
  readonly id: string;
  readonly name: string;
  readonly desc?: string;
  /** Built in array order — the incremental build queue. */
  readonly plan: readonly CastleTemplatePlanEntry[];
  /** Garrison posting offsets from the keep centre, filled in order. */
  readonly garrisonAnchors: readonly (readonly [number, number])[];
  readonly tags?: readonly string[];
}

const offsetValidator: Validator<[number, number]> = (value, path, errors, file) => {
  const pair = v.array(v.number({ integer: true, min: -50, max: 50 }))(value, path, errors, file);
  if (Array.isArray(pair) && pair.length !== 2) {
    errors.push({ file, path, message: `expected [dx, dy], got ${pair.length} numbers` });
  }
  return pair as [number, number];
};

const planEntryValidator: Validator<CastleTemplatePlanEntry> = (value, path, errors, file) => {
  const entry = v.object(
    {
      def: v.string({ minLength: 1 }),
      ring: v.number({ min: 1, max: 45, integer: true }),
      at: v.array(offsetValidator, { minItems: 1 }),
    },
    { optional: ['ring', 'at'] },
  )(value, path, errors, file) as CastleTemplatePlanEntry;
  if (entry !== undefined && (entry.ring === undefined) === (entry.at === undefined)) {
    errors.push({ file, path, message: "a plan entry needs exactly one of 'ring' or 'at'" });
  }
  return entry;
};

export const castleTemplateValidator: Validator<CastleTemplateDef> = v.object(
  {
    id: v.id(),
    name: v.string({ minLength: 1 }),
    desc: v.string(),
    plan: v.array(planEntryValidator, { minItems: 1 }),
    garrisonAnchors: v.array(offsetValidator, { minItems: 1 }),
    tags: v.array(v.string()),
  },
  { optional: ['desc', 'tags'] },
) as Validator<CastleTemplateDef>;

/** Expand one plan entry to concrete [dx, dy] offsets, deterministic order. */
export function expandPlanEntry(entry: CastleTemplatePlanEntry): [number, number][] {
  if (entry.at !== undefined) return entry.at.map(([dx, dy]) => [dx, dy]);
  const r = entry.ring ?? 1;
  const out: [number, number][] = [];
  for (let i = -r; i <= r; i++) {
    out.push([i, -r], [i, r]);
    if (i > -r && i < r) out.push([-r, i], [r, i]);
  }
  // stable reading order: top row, bottom row, then sides — sort for determinism
  out.sort((a, b) => (a[1] - b[1]) || (a[0] - b[0]));
  return out;
}
