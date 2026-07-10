/**
 * EventDef (roadmap M33; GDD Appendix A; doc 06 §11; doc 09 §4 Predicates &
 * Effects DSL). Events are data-defined nudges — trigger conditions
 * (`PredicateExpr`, a small declarative expression tree), a weight, and a
 * choice menu whose effects (`EffectExpr`) flow through the same modifier/
 * command channels as everything else ("never the puppeteer", GDD App. A).
 *
 * `PredicateExpr`'s vocabulary (doc 09 §4: "comparators, stat paths, tag
 * queries, counts, random-weight") is intentionally small and versioned —
 * `STAT_PATHS` is the exact, closed set of paths the sim resolver
 * (game/events.ts) understands; anything else fails validation rather than
 * silently evaluating false at runtime (doc 09 §3's "def-level problems are
 * FATAL" principle). `EVENT_SEASON_NAMES` mirrors sim/time.ts's
 * `SEASON_NAMES` exactly — cross-checked by a test in @crowns/sim, the same
 * pattern `TERRAIN_BIOME_CODES` already uses for worldgen's `BIOME_COUNT`.
 *
 * `EffectExpr` implements 4 of doc 06 §11's 6 kinds this milestone: grant/
 * remove resource, an immediate one-time stat nudge (`modifier` — targets the
 * SAME closed `STAT_PATHS` vocabulary triggers read, applied directly and
 * immediately, NOT a persistent `StatModifiers`/edict-style entry; a real
 * timed-buff/expiry system is future work), opinion change (optional
 * diplomacy hook, inert without one — same pattern M23/M30/M31/M32 each used
 * for their own optional cross-module context), and `command` (an escape
 * hatch: submits any already-registered kernel command, reusing every
 * command handler that already exists rather than inventing new effect
 * kinds per feature). `spawn` and `startEvent` stay out of scope — `spawn`
 * needs the Character system (M34); `startEvent` needs an event-chaining
 * scheduler this milestone doesn't build.
 */
import { v, type Validator } from './validate.js';

export const EVENT_POOLS = ['disaster', 'opportunity', 'character', 'diplomatic', 'unrest', 'era'] as const;
export type EventPool = (typeof EVENT_POOLS)[number];

export const EVENT_SCOPES = ['kingdom', 'village', 'world'] as const;
export type EventScope = (typeof EVENT_SCOPES)[number];

/** Mirrors sim/time.ts's `SEASON_NAMES` — cross-checked by a test in @crowns/sim (data has no
 * sim dependency, TDD §3 direction). */
export const EVENT_SEASON_NAMES = ['spring', 'summer', 'autumn', 'winter'] as const;
export type EventSeasonName = (typeof EVENT_SEASON_NAMES)[number];

/** The closed, versioned set of stat paths a trigger/requirement may test (doc 09 §4). */
export const STAT_PATHS = [
  'village.happiness',
  'village.foodSecurity',
  'village.tier',
  'kingdom.treasury',
] as const;
export type StatPath = (typeof STAT_PATHS)[number];

// ---------------------------------------------------------------- predicates

export interface StatPredicate {
  readonly stat: StatPath;
  readonly lt?: number;
  readonly lte?: number;
  readonly gt?: number;
  readonly gte?: number;
  readonly eq?: number;
}
export interface SeasonPredicate {
  readonly season: EventSeasonName;
}
export interface HasEdictPredicate {
  readonly hasEdict: string;
}
export interface HasTechPredicate {
  readonly hasTech: string;
}
/** Deterministic random draw (doc 09 §4 "random-weight") — 0..1, true if the resolver's draw
 * for this event/tick is below the threshold. */
export interface ChancePredicate {
  readonly chance: number;
}
export interface AllPredicate {
  readonly all: readonly PredicateExpr[];
}
export interface AnyPredicate {
  readonly any: readonly PredicateExpr[];
}
export interface NotPredicate {
  readonly not: PredicateExpr;
}

export type PredicateExpr =
  | StatPredicate
  | SeasonPredicate
  | HasEdictPredicate
  | HasTechPredicate
  | ChancePredicate
  | AllPredicate
  | AnyPredicate
  | NotPredicate;

const STAT_COMPARATORS = ['lt', 'lte', 'gt', 'gte', 'eq'] as const;

/** Hand-rolled (not `v.object`) — `PredicateExpr` is a tagged union, not one fixed shape. */
export const predicateValidator: Validator<PredicateExpr> = (value, path, errors, file) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    errors.push({ file, path, message: `expected a predicate object, got ${Array.isArray(value) ? 'array' : typeof value}` });
    return { all: [] };
  }
  const obj = value as Record<string, unknown>;
  if ('all' in obj) return { all: v.array(predicateValidator, { minItems: 1 })(obj['all'], `${path}.all`, errors, file) };
  if ('any' in obj) return { any: v.array(predicateValidator, { minItems: 1 })(obj['any'], `${path}.any`, errors, file) };
  if ('not' in obj) return { not: predicateValidator(obj['not'], `${path}.not`, errors, file) };
  if ('season' in obj) return { season: v.literal(...EVENT_SEASON_NAMES)(obj['season'], `${path}.season`, errors, file) };
  if ('hasEdict' in obj) return { hasEdict: v.id()(obj['hasEdict'], `${path}.hasEdict`, errors, file) };
  if ('hasTech' in obj) return { hasTech: v.id()(obj['hasTech'], `${path}.hasTech`, errors, file) };
  if ('chance' in obj) return { chance: v.number({ min: 0, max: 1 })(obj['chance'], `${path}.chance`, errors, file) };
  if ('stat' in obj) {
    const stat = v.literal(...STAT_PATHS)(obj['stat'], `${path}.stat`, errors, file);
    const present = STAT_COMPARATORS.filter((c) => c in obj);
    if (present.length !== 1) {
      errors.push({ file, path, message: `stat predicate needs exactly one of ${STAT_COMPARATORS.join('/')}, got ${present.length}` });
      return { stat };
    }
    const cmp = present[0] as (typeof STAT_COMPARATORS)[number];
    return { stat, [cmp]: v.number()(obj[cmp], `${path}.${cmp}`, errors, file) } as PredicateExpr;
  }
  errors.push({ file, path, message: 'unrecognized predicate (expected one of: all/any/not/season/hasEdict/hasTech/chance/stat)' });
  return { all: [] };
};

// ---------------------------------------------------------------- effects

export interface GrantResourceEffect {
  readonly grantResource: { readonly resource: string; readonly amount: number };
}
export interface RemoveResourceEffect {
  readonly removeResource: { readonly resource: string; readonly amount: number };
}
/** An immediate, one-time nudge to a `STAT_PATHS` value (NOT a persistent `StatModifiers`
 * entry — see module doc). Same closed vocabulary triggers read, so one resolver in
 * game/events.ts serves both. */
export interface StatNudgeEffect {
  readonly modifier: { readonly stat: StatPath; readonly op: 'add' | 'mul'; readonly value: number };
}
export interface OpinionChangeEffect {
  readonly opinionChange: { readonly delta: number };
}
/** Escape hatch: submits any already-registered kernel command as this event's kingdom. */
export interface CommandEffect {
  readonly command: { readonly type: string; readonly payload: Readonly<Record<string, unknown>> };
}

export type EffectExpr = GrantResourceEffect | RemoveResourceEffect | StatNudgeEffect | OpinionChangeEffect | CommandEffect;

export const effectValidator: Validator<EffectExpr> = (value, path, errors, file) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    errors.push({ file, path, message: `expected an effect object, got ${Array.isArray(value) ? 'array' : typeof value}` });
    return { command: { type: '', payload: {} } };
  }
  const obj = value as Record<string, unknown>;
  if ('grantResource' in obj) {
    return {
      grantResource: v.object({ resource: v.id(), amount: v.number({ min: 0 }) })(obj['grantResource'], `${path}.grantResource`, errors, file),
    };
  }
  if ('removeResource' in obj) {
    return {
      removeResource: v.object({ resource: v.id(), amount: v.number({ min: 0 }) })(obj['removeResource'], `${path}.removeResource`, errors, file),
    };
  }
  if ('modifier' in obj) {
    return {
      modifier: v.object({ stat: v.literal(...STAT_PATHS), op: v.literal('add', 'mul'), value: v.number({ min: -1000, max: 1000 }) })(
        obj['modifier'],
        `${path}.modifier`,
        errors,
        file,
      ),
    };
  }
  if ('opinionChange' in obj) {
    return { opinionChange: v.object({ delta: v.number({ min: -100, max: 100 }) })(obj['opinionChange'], `${path}.opinionChange`, errors, file) };
  }
  if ('command' in obj) {
    return { command: v.object({ type: v.string({ minLength: 1 }), payload: v.record() })(obj['command'], `${path}.command`, errors, file) };
  }
  errors.push({ file, path, message: 'unrecognized effect (expected one of: grantResource/removeResource/modifier/opinionChange/command)' });
  return { command: { type: '', payload: {} } };
};

// ---------------------------------------------------------------- EventDef

export interface EventChoice {
  readonly id: string;
  readonly text: string;
  readonly requirements?: PredicateExpr;
  readonly effects: readonly EffectExpr[];
  /** AI personality-axis scores for this choice (doc 06 §11) — e.g. `{ economy: 0.8 }`. */
  readonly aiScoreHints?: Readonly<Record<string, number>>;
}

export interface WeightModifier {
  readonly condition: PredicateExpr;
  readonly multiplier: number;
}

export interface EventDef {
  readonly id: string;
  readonly name: string;
  readonly pool: EventPool;
  readonly scope: EventScope;
  readonly trigger: PredicateExpr;
  readonly weight: number;
  readonly weightModifiers?: readonly WeightModifier[];
  readonly cooldownDays?: number;
  readonly once?: boolean;
  readonly text: { readonly title: string; readonly body: string };
  readonly choices: readonly EventChoice[];
  readonly tags: readonly string[];
}

const numericRecordValidator: Validator<Record<string, number>> = (value, path, errors, file) => {
  const record = v.record()(value, path, errors, file);
  const out: Record<string, number> = {};
  for (const [key, amount] of Object.entries(record ?? {})) {
    out[key] = v.number()(amount, `${path}.${key}`, errors, file);
  }
  return out;
};

const weightModifierValidator: Validator<WeightModifier> = v.object({
  condition: predicateValidator,
  multiplier: v.number({ min: 0, max: 10 }),
}) as Validator<WeightModifier>;

const choiceValidator: Validator<EventChoice> = v.object(
  {
    id: v.string({ minLength: 1 }),
    text: v.string({ minLength: 1 }),
    requirements: predicateValidator,
    effects: v.array(effectValidator),
    aiScoreHints: numericRecordValidator,
  },
  { optional: ['requirements', 'aiScoreHints'] },
) as Validator<EventChoice>;

export const eventValidator: Validator<EventDef> = v.object(
  {
    id: v.id(),
    name: v.string({ minLength: 1 }),
    pool: v.literal(...EVENT_POOLS),
    scope: v.literal(...EVENT_SCOPES),
    trigger: predicateValidator,
    weight: v.number({ min: 0 }),
    weightModifiers: v.array(weightModifierValidator),
    cooldownDays: v.number({ min: 0 }),
    once: v.boolean(),
    text: v.object({ title: v.string({ minLength: 1 }), body: v.string({ minLength: 1 }) }),
    choices: v.array(choiceValidator, { minItems: 1 }),
    tags: v.array(v.string({ minLength: 1 })),
  },
  { optional: ['weightModifiers', 'cooldownDays', 'once'] },
) as Validator<EventDef>;
