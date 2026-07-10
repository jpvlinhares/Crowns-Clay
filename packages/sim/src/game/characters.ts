/**
 * Characters & dynasty (roadmap M34; GDD §15 "dynasty growth"; doc 06 §6).
 *
 * NOTABLES: this module never spawns its own character pool — it deepens the
 * SAME entities kingdom.ts's genesis already creates (the fixed six-advisor
 * pool), attaching sibling components (`CharacterTraits`, `CharacterGender`,
 * `CharacterLoyalty`) the moment they exist, exactly the way armies.ts (M26)
 * added `ArmyMovement` alongside military.ts's (M25) bare `Army{kingdomId}`.
 * kingdom.ts itself needed exactly one change for this (`MIN_OFFICE_AGE` on
 * `kingdom.appoint`) — everything else here is purely additive.
 *
 * TRAITS (content/base/defs/traits): each notable gets `TRAITS_PER_CHARACTER`
 * distinct traits at assignment time; their `skillModifiers` are applied
 * ONCE, directly onto kingdom.ts's own `Character` skill fields (clamped
 * 0..20) — so the existing Steward/Marshal/Chancellor/Scholar bonus math in
 * game/kingdom.ts deepens for free, with no changes to that module's formulas
 * ("offices deep" from a trait's perspective, not the office's).
 *
 * MARRIAGES & HEIRS: `CharacterRelations` is a plain relational class (mirrors
 * `DiplomacyState`/`ResearchState` — no per-tick ECS access needed for a
 * handful of pairwise facts). `character.marry` is a single, immediate
 * command (no courtship state, same shape as `kingdom.proposePact`) that
 * rejects self-marriage, remarriage, and any parent/child or sibling pairing.
 * Once a year, `characters-lifecycle`: (1) widows anyone whose spouse died
 * since last check, applying a one-time loyalty penalty — grief, not a new
 * mechanic; (2) rolls a birth chance for every still-married, fertile-age
 * couple, spawning a child whose skills are the parents' blended average (±
 * jitter, clamped) and who inherits one parent trait plus one fresh one — a
 * living pool that grows the appointable roster past the fixed genesis six,
 * closing the loop `MIN_OFFICE_AGE` opened; (3) drifts loyalty for seated
 * officeholders and, below a floor, gives a chance they resign the seat
 * outright — the same "guns vs. butter" lapse/desertion shape M16/M25 already
 * established, now for court politics.
 *
 * Marriage here is deliberately kingdom-agnostic (either party, any realm) —
 * using it as a diplomatic alliance clause (`Treaty.Clause.marriage`, GDD
 * §10) is M35 "Diplomacy v2"'s job to build on top, not this milestone's.
 */
import type { EntityId } from '@crowns/core';
import type { DefinitionDatabase } from '@crowns/data';
import { SKILL_NAMES, type SkillName } from '@crowns/data';
import { ObjectComponent, SoAComponent, World } from '../ecs.js';
import type { Kernel, SimSystem, TickContext } from '../kernel.js';
import { TICKS_PER_YEAR } from '../time.js';
import { OFFICES, MIN_OFFICE_AGE, type KingdomGameplay } from './kingdom.js';

const index = (id: number): number => id & 0x3fffff;

// ---------------------------------------------------------------- constants

export const TRAITS_PER_CHARACTER = 2;
export const GENDERS = ['female', 'male'] as const;
export type Gender = (typeof GENDERS)[number];

const LOYALTY_MIN_GENESIS = 40;
const LOYALTY_MAX_GENESIS = 90;
const CHILD_LOYALTY = 60;
export const GRIEF_LOYALTY_PENALTY = 15;
export const LOYALTY_RESIGN_FLOOR = 15;
export const LOYALTY_RESIGN_CHANCE = 0.2; // per year, while below the floor
const LOYALTY_DRIFT_RANGE = 4; // yearly random walk, officeholders only: ±this

export const MIN_MARRIAGE_AGE = MIN_OFFICE_AGE;
export const MIN_FERTILE_AGE = MIN_OFFICE_AGE;
export const MAX_FERTILE_AGE = 45;
export const HEIR_BIRTH_CHANCE = 0.12; // per fertile married couple, per year

const SKILL_MIN = 0;
const SKILL_MAX = 20;
const clampSkill = (v: number): number => Math.max(SKILL_MIN, Math.min(SKILL_MAX, v));

const CHILD_NAMES = [
  'Alaric', 'Brenna', 'Corwin', 'Dagny', 'Eldric', 'Freya',
  'Gareth', 'Helka', 'Ivor', 'Jorunn', 'Kendric', 'Liesel',
] as const;

// ---------------------------------------------------------------- state

/** Marriages and lineage — pairwise facts, not per-tick ECS state (mirrors DiplomacyState). */
export class CharacterRelations {
  private readonly marriageOf = new Map<number, number>(); // both directions
  private readonly parentsOf_ = new Map<number, readonly [number, number]>(); // childId -> [parentA, parentB]

  isMarried(id: number): boolean {
    return this.marriageOf.has(id);
  }

  spouseOf(id: number): number | undefined {
    return this.marriageOf.get(id);
  }

  parentsOf(id: number): readonly [number, number] | undefined {
    return this.parentsOf_.get(id);
  }

  marry(a: number, b: number): void {
    this.marriageOf.set(a, b);
    this.marriageOf.set(b, a);
  }

  /** Dissolves whichever marriage `id` is in (either party); returns the (former) spouse. */
  widow(id: number): number | undefined {
    const spouse = this.marriageOf.get(id);
    if (spouse === undefined) return undefined;
    this.marriageOf.delete(id);
    this.marriageOf.delete(spouse);
    return spouse;
  }

  recordBirth(child: number, parentA: number, parentB: number): void {
    this.parentsOf_.set(child, [parentA, parentB]);
  }

  isParentChild(a: number, b: number): boolean {
    const pa = this.parentsOf_.get(a);
    const pb = this.parentsOf_.get(b);
    return (pa !== undefined && (pa[0] === b || pa[1] === b)) || (pb !== undefined && (pb[0] === a || pb[1] === a));
  }

  areSiblings(a: number, b: number): boolean {
    const pa = this.parentsOf_.get(a);
    const pb = this.parentsOf_.get(b);
    if (pa === undefined || pb === undefined) return false;
    return pa[0] === pb[0] || pa[0] === pb[1] || pa[1] === pb[0] || pa[1] === pb[1];
  }

  /** Every married pair, each once (lower id first), in stable id order. */
  couples(): readonly (readonly [number, number])[] {
    const seen = new Set<number>();
    const out: (readonly [number, number])[] = [];
    for (const a of [...this.marriageOf.keys()].sort((x, y) => x - y)) {
      if (seen.has(a)) continue;
      const b = this.marriageOf.get(a) as number;
      seen.add(a);
      seen.add(b);
      out.push(a < b ? [a, b] : [b, a]);
    }
    return out;
  }

  fold(fold: (v: number) => void): void {
    for (const a of [...this.marriageOf.keys()].sort((x, y) => x - y)) {
      fold(a);
      fold(this.marriageOf.get(a) as number);
    }
    for (const child of [...this.parentsOf_.keys()].sort((x, y) => x - y)) {
      const parents = this.parentsOf_.get(child) as readonly [number, number];
      fold(child);
      fold(parents[0]);
      fold(parents[1]);
    }
  }
}

// ---------------------------------------------------------------- components

export type CharacterGenderComponent = SoAComponent<{ gender: 'u8' }>;
export type CharacterLoyaltyComponent = SoAComponent<{ loyalty: 'u8' }>;

export interface CharactersGameplay {
  readonly CharacterTraits: ObjectComponent<readonly number[]>; // sorted trait codes
  readonly CharacterGender: CharacterGenderComponent;
  readonly CharacterLoyalty: CharacterLoyaltyComponent;
  readonly relations: CharacterRelations;
  traitIdOf(code: number): string;
}

// ---------------------------------------------------------------- registrar

export function registerCharactersGameplay(
  kernel: Kernel,
  world: World,
  db: DefinitionDatabase,
  kingdomGame: KingdomGameplay,
): CharactersGameplay {
  const { Character, CharacterName, Kingdom } = kingdomGame;

  const traitIds = [...db.traits.keys()].sort();
  const traitById = (code: number) => db.traits.get(traitIds[code] as string);

  const CharacterTraits = world.defineObject<readonly number[]>('characterTraits', (codes, fold) => {
    for (const c of codes) fold(c);
  });
  const CharacterGender: CharacterGenderComponent = world.defineSoA('characterGender', { gender: 'u8' });
  const CharacterLoyalty: CharacterLoyaltyComponent = world.defineSoA('characterLoyalty', { loyalty: 'u8' });
  // kingdom.ts's yearly character-aging despawns dead characters and must declare every
  // attached component to do so (the access guard's declared-access enforcement, M4) — since
  // these three are attached AFTER kingdom.ts registers that system, they're declared here.
  kingdomGame.registerCharacterExtension(CharacterTraits);
  kingdomGame.registerCharacterExtension(CharacterGender);
  kingdomGame.registerCharacterExtension(CharacterLoyalty);

  const relations = new CharacterRelations();
  kernel.addHashSource('characterRelations', (fold) => relations.fold(fold));

  /** `count` trait codes not already in `exclude`, deterministic via `rng`. */
  const rollUniqueTraitCodes = (rng: TickContext['rng'], count: number, exclude: readonly number[]): number[] => {
    const codes = [...exclude];
    const limit = Math.min(traitIds.length, exclude.length + count);
    while (codes.length < limit) {
      const code = rng.int(0, traitIds.length - 1);
      if (!codes.includes(code)) codes.push(code);
    }
    return codes.slice(exclude.length);
  };

  /** Applies every trait's skillModifiers onto the character's stored (0..20) skill fields. */
  const applyTraitDeltas = (charIndex: number, codes: readonly number[]): void => {
    const c = world.write(Character);
    for (const code of codes) {
      const def = traitById(code);
      if (def === undefined) continue;
      for (const skill of SKILL_NAMES) {
        const delta = def.skillModifiers[skill];
        if (delta === undefined) continue;
        c[skill][charIndex] = clampSkill((c[skill][charIndex] as number) + delta);
      }
    }
  };

  // ---------------- genesis: deepen kingdom.ts's fixed advisor pool ----------------
  const genesis: SimSystem = {
    name: 'characters-genesis',
    period: 0x7fffffff,
    phase: 1, // registered after kingdom-genesis (same phase, later registration order): runs right after it
    access: { writes: [Character, CharacterTraits, CharacterGender, CharacterLoyalty] },
    update(ctx: TickContext): void {
      if (traitIds.length === 0) return;
      world.query([Character], [CharacterTraits]).forEach((i, entity) => {
        const codes = rollUniqueTraitCodes(ctx.rng, TRAITS_PER_CHARACTER, []).sort((a, b) => a - b);
        applyTraitDeltas(i, codes);
        world.attach(entity, CharacterTraits, codes);
        world.attach(entity, CharacterGender, { gender: ctx.rng.int(0, 1) });
        world.attach(entity, CharacterLoyalty, { loyalty: ctx.rng.int(LOYALTY_MIN_GENESIS, LOYALTY_MAX_GENESIS) });
      });
    },
  };

  // ---------------- commands ----------------
  const reject = (ctx: TickContext, what: string, reason: string): void => {
    ctx.events.publish({ type: 'village.rejected', tick: ctx.tick, data: { what, reason } });
  };

  kernel.registerCommand<{ characterA: number; characterB: number }>('character.marry', (ctx, p) => {
    const a = (p.characterA | 0) as EntityId;
    const b = (p.characterB | 0) as EntityId;
    if ((a as number) === (b as number)) return reject(ctx, 'character.marry', 'a character cannot marry themselves');
    if (!world.isAlive(a) || !world.has(a, Character)) return reject(ctx, 'character.marry', 'no such character (A)');
    if (!world.isAlive(b) || !world.has(b, Character)) return reject(ctx, 'character.marry', 'no such character (B)');
    if (relations.isMarried(a as number)) return reject(ctx, 'character.marry', 'character A is already married');
    if (relations.isMarried(b as number)) return reject(ctx, 'character.marry', 'character B is already married');
    const c = world.read(Character);
    const ageA = c.age[index(a as number)] as number;
    const ageB = c.age[index(b as number)] as number;
    if (ageA < MIN_MARRIAGE_AGE || ageB < MIN_MARRIAGE_AGE) {
      return reject(ctx, 'character.marry', `both must be at least ${MIN_MARRIAGE_AGE}`);
    }
    if (relations.isParentChild(a as number, b as number)) return reject(ctx, 'character.marry', 'parent and child cannot marry');
    if (relations.areSiblings(a as number, b as number)) return reject(ctx, 'character.marry', 'siblings cannot marry');
    relations.marry(a as number, b as number);
    ctx.events.publish({ type: 'character.married', tick: ctx.tick, data: { characterA: a as number, characterB: b as number } });
  });

  // ---------------- yearly: widowing, heirs, and court loyalty ----------------
  const lifecycle: SimSystem = {
    name: 'characters-lifecycle',
    period: TICKS_PER_YEAR,
    // SAME phase as kingdom.ts's character-aging (7): identical period+phase fire on the
    // identical tick, and the kernel runs systems in registration order within a tick — since
    // this module is always registered after kingdom.ts, aging's despawns (this tick's deaths)
    // are already applied by the time this runs.
    phase: 7,
    access: { writes: [Character, CharacterName, CharacterTraits, CharacterGender, CharacterLoyalty, Kingdom] },
    update(ctx: TickContext): void {
      const c = world.read(Character);
      const loyalty = world.write(CharacterLoyalty);

      for (const [pa, pb] of relations.couples()) {
        const aliveA = world.isAlive(pa as EntityId);
        const aliveB = world.isAlive(pb as EntityId);
        if (!aliveA || !aliveB) {
          relations.widow(pa);
          const survivor = aliveA ? pa : aliveB ? pb : undefined;
          if (survivor !== undefined && world.has(survivor as EntityId, CharacterLoyalty)) {
            const li = index(survivor);
            loyalty.loyalty[li] = Math.max(0, (loyalty.loyalty[li] as number) - GRIEF_LOYALTY_PENALTY);
          }
          continue;
        }
        const ageA = c.age[index(pa)] as number;
        const ageB = c.age[index(pb)] as number;
        if (ageA < MIN_FERTILE_AGE || ageA > MAX_FERTILE_AGE) continue;
        if (ageB < MIN_FERTILE_AGE || ageB > MAX_FERTILE_AGE) continue;
        if (!ctx.rng.chance(HEIR_BIRTH_CHANCE)) continue;

        const traitsA = world.readObj(CharacterTraits).tryGet(index(pa)) ?? [];
        const traitsB = world.readObj(CharacterTraits).tryGet(index(pb)) ?? [];
        const donorPools = [traitsA, traitsB].filter((pool) => pool.length > 0);
        const inherited = donorPools.length > 0 ? [ctx.rng.pick(ctx.rng.pick(donorPools))] : [];
        const codes = [...inherited, ...rollUniqueTraitCodes(ctx.rng, TRAITS_PER_CHARACTER - inherited.length, inherited)].sort(
          (x, y) => x - y,
        );

        const blended: Partial<Record<SkillName, number>> = {};
        for (const skill of SKILL_NAMES) {
          const avg = ((c[skill][index(pa)] as number) + (c[skill][index(pb)] as number)) / 2;
          blended[skill] = clampSkill(Math.round(avg + ctx.rng.int(-2, 2)));
        }
        const child = world.spawn();
        world.attach(child, Character, { age: 0, ...blended });
        world.attach(child, CharacterName, ctx.rng.pick(CHILD_NAMES) as string);
        world.attach(child, CharacterGender, { gender: ctx.rng.int(0, 1) });
        world.attach(child, CharacterLoyalty, { loyalty: CHILD_LOYALTY });
        world.attach(child, CharacterTraits, codes);
        applyTraitDeltas(index(child as number), codes);
        relations.recordBirth(child as number, pa, pb);
        ctx.events.publish({ type: 'character.born', tick: ctx.tick, data: { characterId: child as number, parentA: pa, parentB: pb } });
      }

      // court loyalty: seated officeholders drift yearly; below the floor, they may resign
      for (const kingdomId of kingdomGame.kingdomEntities()) {
        const k = world.write(Kingdom);
        const ki = index(kingdomId as number);
        for (const office of OFFICES) {
          const seat = k[office][ki] as number;
          if (seat === 0 || !world.isAlive(seat as EntityId) || !world.has(seat as EntityId, CharacterLoyalty)) continue;
          const li = index(seat);
          const current = Math.max(0, Math.min(100, (loyalty.loyalty[li] as number) + ctx.rng.int(-LOYALTY_DRIFT_RANGE, LOYALTY_DRIFT_RANGE)));
          loyalty.loyalty[li] = current;
          if (current < LOYALTY_RESIGN_FLOOR && ctx.rng.chance(LOYALTY_RESIGN_CHANCE)) {
            k[office][ki] = 0;
            ctx.events.publish({ type: 'kingdom.officeVacated', tick: ctx.tick, data: { office } });
            ctx.events.publish({ type: 'character.resigned', tick: ctx.tick, data: { characterId: seat, office } });
          }
        }
      }
    },
  };

  kernel.registerSystem(genesis);
  kernel.registerSystem(lifecycle);

  return {
    CharacterTraits,
    CharacterGender,
    CharacterLoyalty,
    relations,
    traitIdOf: (code: number) => traitIds[code] as string,
  };
}
