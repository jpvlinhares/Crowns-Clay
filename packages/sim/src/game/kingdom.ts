/**
 * Kingdom layer (roadmap M16; GDD §2; doc 06 §5–§6; doc 08 §2 slot 12).
 *
 * TREASURY & TAXES: the daily roll-up converts each village's prosperity —
 * production value (installed recipe output × staffing × base prices) times a
 * happiness factor — into gold at the village's tax rate. Higher rates bleed
 * happiness daily, which shrinks the prosperity factor AND the workforce:
 * "high tax forever" is self-defeating by construction (GDD §2 balancing).
 *
 * THE LEDGER is the T objective: every gold movement (tax, edict upkeep,
 * advisor salary) is an entry, and the treasury reconciles to their sum — to
 * the coin. Reads feed the HUD via the daily `kingdom.rollup` event.
 *
 * EDICTS v1 are content (defs/edicts/*.json5): Modifier bundles with daily
 * upkeep, enacted/repealed by command, capped at EDICT_CAP (modifier-soup
 * guard), and LAPSING when the treasury can't pay. All effects flow through
 * one StatModifiers board that economy and population read — "all numbers
 * flow through Modifiers" (doc 06).
 *
 * ADVISORS v1: notable characters (doc 06 §6 slice — named, aged, skilled
 * 0–20) spawned deterministically at kingdom genesis. Appointing a Steward
 * multiplies tax yield by skill; Chancellor discounts edict upkeep; Marshal
 * discounts unit upkeep by martial skill (game/military.ts, M25); Scholar
 * multiplies research point accrual by scholarship skill (game/research.ts,
 * M32). Advisors draw a daily salary, age, and die — death vacates the
 * office by event.
 *
 * M34 hooks for the notable/heir system (game/characters.ts), which deepens
 * these SAME character entities rather than spawning its own: (1)
 * `kingdom.appoint` rejects characters below `MIN_OFFICE_AGE`, so a freshly
 * born heir can't take a seat immediately; (2) `registerCharacterExtension`
 * lets that module declare its sibling components (traits/gender/loyalty) to
 * `character-aging`'s yearly despawn, which must declare every component it
 * detaches (the access guard's declared-access enforcement, M4) — kingdom.ts
 * can't import characters.ts to do this itself (the dependency only runs one
 * way). Trait skill deltas are applied directly onto `Character`'s stored
 * skill fields, so the office-bonus math above needed no changes at all.
 *
 * M38 hook: `KingdomGameplayOptions.difficultyYieldOf` is an optional
 * per-kingdom multiplier on daily tax/prosperity yield (GDD §14's "labelled
 * modifiers") — defaults to a flat 1 (today's exact formula, no prior
 * behaviour changes). Deliberately a KINGDOM-LEVEL yield, not a raw
 * resource-production one (economy.ts is untouched) — the shared, single
 * `StatModifiers` board this module already has (bound to kingdom 0 only,
 * per the M22 note above) can't express a per-kingdom bonus, so this rides
 * alongside it instead of through it.
 */
import type { EntityId } from '@crowns/core';
import type { DefinitionDatabase, EdictDef } from '@crowns/data';
import { ObjectComponent, SoAComponent, World, type Component } from '../ecs.js';
import type { Kernel, SimSystem, TickContext } from '../kernel.js';
import { TICKS_PER_DAY, TICKS_PER_YEAR } from '../time.js';
import type { VillageGameplay } from './villages.js';
import type { PopulationGameplay } from './population.js';
import type { EconomyGameplay } from './economy.js';

// ---------------------------------------------------------------- constants

export const STARTING_TREASURY = 100;
export const EDICT_CAP = 3;
export const ADVISOR_SALARY = 2; // gold per day per seated advisor
export const ADVISOR_POOL = 6; // candidates at kingdom genesis
export const MIN_OFFICE_AGE = 16; // M34: a freshly born heir (game/characters.ts) can't hold office yet

/** Tax rates (GDD §2): fraction of prosperity taken; daily happiness drift. */
export const TAX_RATES = [
  { name: 'none', take: 0, happiness: +1 },
  { name: 'low', take: 0.08, happiness: 0 },
  { name: 'normal', take: 0.15, happiness: -0.5 },
  { name: 'high', take: 0.25, happiness: -2 },
  { name: 'punitive', take: 0.4, happiness: -8 },
] as const;

export const OFFICES = ['steward', 'marshal', 'chancellor', 'scholar'] as const;
export type Office = (typeof OFFICES)[number];

const ADVISOR_NAMES = [
  'Aldric', 'Berta', 'Cedric', 'Dagmar', 'Edwin', 'Frida',
  'Godwin', 'Hilda', 'Ivo', 'Jutta', 'Konrad', 'Lioba',
] as const;

// ---------------------------------------------------------------- modifiers

/** One resolved view per stat path: (base + Σadd) × Πmul. Inert by default. */
export class StatModifiers {
  private readonly adds = new Map<string, number>();
  private readonly muls = new Map<string, number>();

  add(target: string): number {
    return this.adds.get(target) ?? 0;
  }

  mul(target: string): number {
    return this.muls.get(target) ?? 1;
  }

  /** Rebuild from modifier sources (edicts, offices) — called on any change. */
  rebuild(sources: readonly { readonly target: string; readonly op: 'add' | 'mul'; readonly value: number }[]): void {
    this.adds.clear();
    this.muls.clear();
    for (const m of sources) {
      if (m.op === 'add') this.adds.set(m.target, (this.adds.get(m.target) ?? 0) + m.value);
      else this.muls.set(m.target, (this.muls.get(m.target) ?? 1) * m.value);
    }
  }
}

// ---------------------------------------------------------------- ledger

export interface LedgerEntry {
  readonly tick: number;
  readonly kind: 'tax' | 'edict-upkeep' | 'advisor-salary' | 'unit-recruit' | 'unit-upkeep' | 'loot';
  readonly amount: number; // signed: income positive, expense negative
  readonly detail: string; // village name, edict id, office, unit def…
}

/** Every gold movement, in order. The treasury reconciles to its sum. */
export class KingdomLedger {
  private readonly log: LedgerEntry[] = [];

  record(entry: LedgerEntry): void {
    this.log.push(entry);
  }

  entries(): readonly LedgerEntry[] {
    return this.log;
  }

  sum(): number {
    let total = 0;
    for (const e of this.log) total += e.amount;
    return total;
  }
}

// ---------------------------------------------------------------- components

export type KingdomComponent = SoAComponent<{
  treasury: 'f64';
  steward: 'eid';
  marshal: 'eid';
  chancellor: 'eid';
  scholar: 'eid';
}>;

export type CharacterComponent = SoAComponent<{
  age: 'f64';
  stewardship: 'u8';
  martial: 'u8';
  diplomacy: 'u8';
  scholarship: 'u8';
}>;

export interface KingdomGameplay {
  readonly Kingdom: KingdomComponent;
  readonly ActiveEdicts: ObjectComponent<Map<number, number>>; // edict code → enacted tick
  readonly Character: CharacterComponent;
  readonly CharacterName: ObjectComponent<string>;
  readonly ledger: KingdomLedger;
  readonly mods: StatModifiers;
  /** Village → owning kingdom (M22); only defined when `kingdomCount > 1` was requested. */
  readonly VillageOwner?: SoAComponent<{ kingdom: 'eid' }>;
  /** 1.x ownership guard: does `issuer`'s kingdom own `villageId`? True when there's no
   * `VillageOwner` (single-kingdom / Terra). The action-side authority for village-mutating
   * commands, injected into settler/village command handlers via their `setOwnershipGuard`. */
  ownsVillage(issuer: number, villageId: number): boolean;
  kingdomEntity(): EntityId | null;
  /** All kingdom entities, player first (issuer 1), then AI kingdoms in spawn order (M22). */
  kingdomEntities(): readonly EntityId[];
  treasury(): number;
  /** Re-bind the kingdom entities and rebuild the modifier board after save hydration (M17). */
  refreshAfterLoad(): void;
  /**
   * M34 extension point: declare a component a LATER module attaches to `Character` entities
   * (game/characters.ts's traits/gender/loyalty), so `character-aging`'s yearly despawn — which
   * must declare every component it detaches — stays valid without kingdom.ts importing that
   * module (the dependency only runs one way).
   */
  registerCharacterExtension(comp: Component): void;
}

export interface KingdomGameplayOptions {
  /**
   * Number of kingdoms to found (M22). Defaults to 1 — the exact single-
   * kingdom code path this module has always run, so existing single-
   * kingdom compositions (terra.ts, tests) are byte-identical: no new
   * component, no extra spawn, no extra RNG draw. `VillageOwner` and
   * per-kingdom tax/office scoping only activate when this is `> 1`.
   */
  readonly kingdomCount?: number;
  /** M38 difficulty lever (GDD §14 "labelled modifiers"): an optional per-kingdom multiplier on
   * daily tax/prosperity yield — e.g. 1.15 for a visible +15% AI bonus at Hard, 1.3 at Brutal, or
   * a player-side bonus at Story. Omit (or return 1) for zero-modifier "Fair" behaviour — the
   * exact pre-M38 formula. This is a KINGDOM-LEVEL (treasury/prosperity) yield, not a raw
   * resource-production one (game/economy.ts's production system is untouched) — a deliberate,
   * bounded reading of "yields" that needed no changes to the shared, single `StatModifiers`
   * board (M22's own scoping note: that board is bound to kingdom 0 only). */
  readonly difficultyYieldOf?: (kingdomId: EntityId) => number;
  /** GDD §17 (roadmap M40): gates `sandbox.*` privileged commands. Defaults false — opt-in at
   * world creation, the same reasoning villages.ts's own `sandboxEnabled` param documents. */
  readonly sandboxEnabled?: boolean;
}

// ---------------------------------------------------------------- registrar

export function registerKingdomGameplay(
  kernel: Kernel,
  world: World,
  db: DefinitionDatabase,
  game: VillageGameplay,
  popGame: PopulationGameplay,
  econ: EconomyGameplay,
  mods: StatModifiers,
  options: KingdomGameplayOptions = {},
): KingdomGameplay {
  const { VillageCore, VillageName, BuildingCore } = game.comps;
  const { Population } = popGame;
  const index = (id: number): number => id & 0x3fffff;
  const kingdomCount = options.kingdomCount ?? 1;
  const difficultyYieldOf = options.difficultyYieldOf ?? (() => 1);
  const sandboxEnabled = options.sandboxEnabled ?? false;
  const VillageOwner: SoAComponent<{ kingdom: 'eid' }> | undefined =
    kingdomCount > 1 ? world.defineSoA('villageOwner', { kingdom: 'eid' }) : undefined;

  const Kingdom: KingdomComponent = world.defineSoA('kingdom', {
    treasury: 'f64',
    steward: 'eid',
    marshal: 'eid',
    chancellor: 'eid',
    scholar: 'eid',
  });
  const ActiveEdicts = world.defineObject<Map<number, number>>('activeEdicts', (edicts, fold) => {
    for (const key of [...edicts.keys()].sort((a, b) => a - b)) {
      fold(key);
      fold(edicts.get(key) as number);
    }
  });
  const Character: CharacterComponent = world.defineSoA('character', {
    age: 'f64',
    stewardship: 'u8',
    martial: 'u8',
    diplomacy: 'u8',
    scholarship: 'u8',
  });
  const CharacterName = world.defineObject<string>('characterName', (name, fold) => {
    for (let i = 0; i < name.length; i++) fold(name.charCodeAt(i));
  });

  const ledger = new KingdomLedger();

  // edict codes: sorted def ids → stable indices
  const edictIds = [...db.edicts.keys()].sort();
  const edictCode = new Map(edictIds.map((id, i) => [id, i]));
  const edictById = (code: number): EdictDef => db.edicts.get(edictIds[code] as string) as EdictDef;

  const kingdomIds: EntityId[] = [];
  /** Resolve the acting kingdom for a command from its issuer (1=player, 2..n=AI, M22); falls
   * back to the player's kingdom for issuer 0 or an out-of-range issuer, preserving today's
   * single-kingdom behaviour when kingdomCount is 1 (every existing test uses issuer: 1). */
  const kingdomForIssuer = (issuer: number): EntityId | null => kingdomIds[issuer - 1] ?? kingdomIds[0] ?? null;

  /** 1.x ownership guard: does the kingdom acting on `issuer`'s behalf own `villageId`? True in
   * single-kingdom compositions (no `VillageOwner` — Terra, most unit tests: no ownership concept,
   * so no restriction). This is the ACTION-side authority for village-mutating commands
   * (setTaxRate/upgrade/build/demolish) — the player (issuer 1 = kingdom 0) can only touch its own
   * settlements, AI (issuer k+1 = kingdom k) only its own, no matter how the command was reached. */
  const ownsVillage = (issuer: number, villageId: number): boolean => {
    if (VillageOwner === undefined) return true;
    const kingdomId = kingdomForIssuer(issuer);
    if (kingdomId === null) return false;
    if (!world.isAlive(villageId as EntityId) || !world.has(villageId as EntityId, VillageOwner)) return false;
    return (world.read(VillageOwner).kingdom[index(villageId)] as number) === (kingdomId as number);
  };

  // ---------------- modifier board: edicts + offices, one rebuild ----------------
  // NB: the modifier board (`mods`) is shared across all kingdoms (M22 scoping note,
  // docs/design/07-ai-design.md) — only the player's kingdom (kingdomIds[0]) ever enacts
  // edicts or appoints offices today, so this stays bound to it regardless of kingdomCount.
  const rebuildModifiers = (): void => {
    const kingdomId = kingdomIds[0];
    if (kingdomId === undefined) return;
    const ki = index(kingdomId as number);
    const sources: { target: string; op: 'add' | 'mul'; value: number }[] = [];
    const active = world.readObj(ActiveEdicts).tryGet(ki);
    for (const code of [...(active?.keys() ?? [])].sort((a, b) => a - b)) {
      for (const m of edictById(code).modifiers) sources.push(m);
    }
    const k = world.read(Kingdom);
    const c = world.read(Character);
    const steward = k.steward[ki] as number;
    if (steward !== 0 && world.isAlive(steward as EntityId)) {
      // Steward: tax yield ×(1 + stewardship/100) — up to +20% at skill 20
      sources.push({ target: 'kingdom.taxYield', op: 'mul', value: 1 + (c.stewardship[index(steward)] as number) / 100 });
    }
    const marshal = k.marshal[ki] as number;
    if (marshal !== 0 && world.isAlive(marshal as EntityId)) {
      // Marshal (M25): unit upkeep ×(1 − martial/100) — up to −20% at skill 20
      sources.push({ target: 'military.upkeepDiscount', op: 'mul', value: 1 - (c.martial[index(marshal)] as number) / 100 });
    }
    const scholar = k.scholar[ki] as number;
    if (scholar !== 0 && world.isAlive(scholar as EntityId)) {
      // Scholar (M32): research point accrual ×(1 + scholarship/100) — up to +20% at skill 20
      sources.push({ target: 'kingdom.researchYield', op: 'mul', value: 1 + (c.scholarship[index(scholar)] as number) / 100 });
    }
    mods.rebuild(sources);
  };

  // ---------------- genesis: the kingdom and its notables ----------------
  const genesis: SimSystem = {
    name: 'kingdom-genesis',
    period: 0x7fffffff,
    phase: 1,
    access: { writes: [Kingdom, ActiveEdicts, Character, CharacterName] },
    update(ctx: TickContext): void {
      for (let k = 0; k < kingdomCount; k++) {
        const kingdom = world.spawn();
        world.attach(kingdom, Kingdom, { treasury: STARTING_TREASURY, steward: 0, marshal: 0, chancellor: 0, scholar: 0 });
        world.attach(kingdom, ActiveEdicts, new Map());
        kingdomIds.push(kingdom);
        for (let n = 0; n < ADVISOR_POOL; n++) {
          const character = world.spawn();
          world.attach(character, Character, {
            age: 25 + ctx.rng.int(0, 30),
            stewardship: ctx.rng.int(2, 18),
            martial: ctx.rng.int(2, 18),
            diplomacy: ctx.rng.int(2, 18),
            scholarship: ctx.rng.int(2, 18),
          });
          world.attach(character, CharacterName, ADVISOR_NAMES[ctx.rng.int(0, ADVISOR_NAMES.length - 1)] as string);
        }
        ctx.events.publish({ type: 'kingdom.founded', tick: ctx.tick, data: { kingdom: kingdom as number } });
      }
    },
  };

  // ---------------- commands ----------------
  const reject = (ctx: TickContext, what: string, reason: string): void => {
    ctx.events.publish({ type: 'village.rejected', tick: ctx.tick, data: { what, reason } });
  };

  kernel.registerCommand<{ villageId: number; rate: number }>('village.setTaxRate', (ctx, p, command) => {
    const village = p.villageId as EntityId;
    if (!world.isAlive(village)) return reject(ctx, 'village.setTaxRate', 'no such village');
    if (!ownsVillage(command.issuer, p.villageId)) return reject(ctx, 'village.setTaxRate', 'not your village');
    const rate = p.rate | 0;
    if (rate < 0 || rate >= TAX_RATES.length) {
      return reject(ctx, 'village.setTaxRate', `rate must be 0..${TAX_RATES.length - 1} (none/low/normal/high/punitive)`);
    }
    const core = world.write(VillageCore);
    core.taxRate[index(p.villageId)] = rate;
  });

  kernel.registerCommand<{ edict: string }>('kingdom.enactEdict', (ctx, p, command) => {
    const kingdomId = kingdomForIssuer(command.issuer);
    if (kingdomId === null) return reject(ctx, 'kingdom.enactEdict', 'no kingdom');
    const code = edictCode.get(String(p.edict));
    if (code === undefined) return reject(ctx, 'kingdom.enactEdict', `unknown edict '${String(p.edict)}'`);
    const ki = index(kingdomId as number);
    const active = world.writeObj(ActiveEdicts).tryGet(ki);
    if (active === undefined) return reject(ctx, 'kingdom.enactEdict', 'no kingdom');
    if (active.has(code)) return reject(ctx, 'kingdom.enactEdict', 'already enacted');
    if (active.size >= EDICT_CAP) return reject(ctx, 'kingdom.enactEdict', `edict cap reached (${EDICT_CAP})`);
    const k = world.write(Kingdom);
    const upkeep = edictById(code).upkeep;
    if ((k.treasury[ki] as number) < upkeep) {
      return reject(ctx, 'kingdom.enactEdict', `treasury cannot cover upkeep (${(k.treasury[ki] as number).toFixed(0)}/${upkeep})`);
    }
    active.set(code, ctx.tick);
    rebuildModifiers();
    ctx.events.publish({ type: 'kingdom.edictEnacted', tick: ctx.tick, data: { edict: String(p.edict) } });
  });

  kernel.registerCommand<{ edict: string }>('kingdom.repealEdict', (ctx, p, command) => {
    const kingdomId = kingdomForIssuer(command.issuer);
    if (kingdomId === null) return reject(ctx, 'kingdom.repealEdict', 'no kingdom');
    const code = edictCode.get(String(p.edict));
    if (code === undefined) return reject(ctx, 'kingdom.repealEdict', `unknown edict '${String(p.edict)}'`);
    const active = world.writeObj(ActiveEdicts).tryGet(index(kingdomId as number));
    if (active === undefined || !active.has(code)) return reject(ctx, 'kingdom.repealEdict', 'not active');
    active.delete(code);
    rebuildModifiers();
    ctx.events.publish({ type: 'kingdom.edictRepealed', tick: ctx.tick, data: { edict: String(p.edict) } });
  });

  kernel.registerCommand<{ office: string; characterId: number }>('kingdom.appoint', (ctx, p, command) => {
    const kingdomId = kingdomForIssuer(command.issuer);
    if (kingdomId === null) return reject(ctx, 'kingdom.appoint', 'no kingdom');
    const office = String(p.office) as Office;
    if (!OFFICES.includes(office)) return reject(ctx, 'kingdom.appoint', `unknown office '${String(p.office)}' (${OFFICES.join('/')})`);
    const character = p.characterId as EntityId;
    if (!world.isAlive(character) || !world.has(character, Character)) {
      return reject(ctx, 'kingdom.appoint', 'no such character');
    }
    const age = world.read(Character).age[index(character)] as number;
    if (age < MIN_OFFICE_AGE) return reject(ctx, 'kingdom.appoint', `too young for office (age ${age} < ${MIN_OFFICE_AGE})`);
    const k = world.write(Kingdom);
    const ki = index(kingdomId as number);
    // one office per person: vacate any seat they already hold
    for (const seat of OFFICES) {
      if ((k[seat][ki] as number) === (p.characterId | 0)) k[seat][ki] = 0;
    }
    k[office][ki] = p.characterId;
    rebuildModifiers();
    ctx.events.publish({ type: 'kingdom.appointed', tick: ctx.tick, data: { office, characterId: p.characterId } });
  });

  // ---------------- sandbox editor (roadmap M40; GDD §17) ----------------
  kernel.registerCommand<{ amount: number }>('sandbox.setTreasury', (ctx, p, command) => {
    if (!sandboxEnabled) return reject(ctx, 'sandbox.setTreasury', 'sandbox mode is not enabled');
    const kingdomId = kingdomForIssuer(command.issuer);
    if (kingdomId === null) return reject(ctx, 'sandbox.setTreasury', 'no kingdom');
    const amount = Number(p.amount);
    if (!Number.isFinite(amount) || amount < 0) return reject(ctx, 'sandbox.setTreasury', 'amount must be a non-negative number');
    const ki = index(kingdomId as number);
    world.write(Kingdom).treasury[ki] = amount;
    ctx.events.publish({ type: 'sandbox.treasurySet', tick: ctx.tick, data: { kingdom: kingdomId as number, amount } });
  });

  // ---------------- daily roll-up (doc 08 slot 12) ----------------
  const rollup: SimSystem = {
    name: 'kingdom-rollup',
    period: TICKS_PER_DAY,
    phase: 6,
    access: {
      writes: [Kingdom, ActiveEdicts, Population],
      reads: [VillageCore, VillageName, BuildingCore, Character, ...(VillageOwner !== undefined ? [VillageOwner] : [])],
    },
    update(ctx: TickContext): void {
      if (kingdomIds.length === 0) return;
      const k = world.write(Kingdom);
      const pop = world.write(Population);
      const core = world.read(VillageCore);
      const names = world.readObj(VillageName);
      const b = world.read(BuildingCore);
      const c = world.read(Character);
      // village → owning kingdom, when multi-kingdom (M22); undefined when kingdomCount is 1,
      // in which case every village taxes into the single kingdom — today's exact behaviour.
      const ownerOf = VillageOwner !== undefined ? world.read(VillageOwner) : null;

      // production value per village: installed recipe output × staffing × price (shared
      // across kingdoms — computed once, not per kingdom)
      const value = new Map<number, number>();
      world.query([BuildingCore]).forEach((i) => {
        if ((b.complete[i] as number) !== 1) return;
        const def = game.ops.buildingDef(b.def[i] as number);
        if (def.recipes === undefined) return;
        const required = def.workers?.required ?? 0;
        const efficiency = required === 0 ? 1 : (b.workers[i] as number) / required;
        if (efficiency <= 0) return;
        let dayValue = 0;
        for (const recipe of def.recipes) {
          for (const y of recipe.outputs) {
            dayValue += y.perDay * (db.resources.get(y.resource)?.basePrice ?? 0);
          }
        }
        const vi = index(b.village[i] as number);
        value.set(vi, (value.get(vi) ?? 0) + dayValue * efficiency);
      });

      for (const kingdomId of kingdomIds) {
        const ki = index(kingdomId as number);
        let taxes = 0;
        // M42 legibility: every entry recorded THIS rollup, for the Kingdom panel's itemized
        // ledger view (GDD §2: "Read the Ledger: full income/expense breakdown") — a small
        // per-kingdom-per-day slice of `ledger`, not the whole unbounded log.
        const ledgerDelta: LedgerEntry[] = [];
        const record = (entry: LedgerEntry): void => {
          ledger.record(entry);
          ledgerDelta.push(entry);
        };
        const taxYield = mods.mul('kingdom.taxYield') * difficultyYieldOf(kingdomId);
        world.query([Population, VillageCore]).forEach((vi) => {
          if (ownerOf !== null && (ownerOf.kingdom[vi] as number) !== (kingdomId as number)) return;
          const rate = TAX_RATES[core.taxRate[vi] as number] ?? TAX_RATES[2];
          const happiness = pop.happiness[vi] as number;
          const prosperity = (value.get(vi) ?? 0) * (0.5 + happiness / 200); // GDD §2 happiness factor
          const take = prosperity * rate.take * taxYield;
          if (take > 0) {
            k.treasury[ki] = (k.treasury[ki] as number) + take;
            taxes += take;
            record({ tick: ctx.tick, kind: 'tax', amount: take, detail: names.tryGet(vi) ?? `village ${vi}` });
          }
          // the tax-pressure curve: happiness drifts with the rate (bounded)
          pop.happiness[vi] = Math.max(0, Math.min(100, happiness + rate.happiness));
        });

        // edict upkeep — Chancellor discounts it; unpayable edicts LAPSE
        let upkeepTotal = 0;
        const chancellor = k.chancellor[ki] as number;
        const discount =
          chancellor !== 0 && world.isAlive(chancellor as EntityId)
            ? 1 - (c.diplomacy[index(chancellor)] as number) / 100 // up to −20%
            : 1;
        const active = world.writeObj(ActiveEdicts).tryGet(ki);
        if (active !== undefined) {
          for (const code of [...active.keys()].sort((a, z) => a - z)) {
            const def = edictById(code);
            const cost = def.upkeep * discount;
            if (cost === 0) continue;
            if ((k.treasury[ki] as number) < cost) {
              active.delete(code);
              ctx.events.publish({ type: 'kingdom.edictLapsed', tick: ctx.tick, data: { edict: def.id, reason: 'treasury empty' } });
              continue;
            }
            k.treasury[ki] = (k.treasury[ki] as number) - cost;
            upkeepTotal += cost;
            record({ tick: ctx.tick, kind: 'edict-upkeep', amount: -cost, detail: def.id });
          }
          rebuildModifiers(); // lapses (and steward death below) change the board
        }

        // advisor salaries: every seated advisor draws pay
        let salaries = 0;
        for (const office of OFFICES) {
          const seat = k[office][ki] as number;
          if (seat === 0) continue;
          if (!world.isAlive(seat as EntityId)) {
            k[office][ki] = 0; // vacated by death (aging system below)
            continue;
          }
          k.treasury[ki] = (k.treasury[ki] as number) - ADVISOR_SALARY;
          salaries += ADVISOR_SALARY;
          record({ tick: ctx.tick, kind: 'advisor-salary', amount: -ADVISOR_SALARY, detail: office });
        }

        ctx.events.publish({
          type: 'kingdom.rollup',
          tick: ctx.tick,
          data: {
            // M47.6: which kingdom this roll-up belongs to (0 = player), so a multi-kingdom
            // client can filter its HUD to its own treasury instead of showing whichever
            // kingdom happened to roll up last. Additive — single-kingdom readers unchanged.
            kingdomIndex: kingdomIds.indexOf(kingdomId),
            treasury: k.treasury[ki] as number,
            taxes,
            upkeep: upkeepTotal,
            salaries,
            net: taxes - upkeepTotal - salaries,
            ledger: ledgerDelta,
          },
        });
      }
    },
  };

  // ---------------- yearly: advisors age; the old may die ----------------
  // `agingWrites` is mutable so a later module that attaches its OWN sibling components to
  // these same Character entities (game/characters.ts, M34: traits/gender/loyalty) can extend
  // it via `registerCharacterExtension` — despawn() detaches every attached component and the
  // access guard requires all of them declared, but kingdom.ts can't import a module that
  // depends on it (wrong direction), so the extension point runs the other way.
  const agingWrites: Component[] = [Kingdom, Character, CharacterName];
  const aging: SimSystem = {
    name: 'character-aging',
    period: TICKS_PER_YEAR,
    phase: 7,
    // despawn detaches the name too; the modifier rebuild reads active edicts
    access: { writes: agingWrites, reads: [ActiveEdicts] },
    update(ctx: TickContext): void {
      const c = world.write(Character);
      const names = world.readObj(CharacterName);
      const dead: EntityId[] = [];
      world.query([Character]).forEach((i, entity) => {
        const age = (c.age[i] as number) + 1;
        c.age[i] = age;
        // mortality climbs past 60: ~2% at 62, ~20% at 80
        const chance = age <= 60 ? 0 : Math.min(0.5, (age - 60) * 0.01);
        if (chance > 0 && ctx.rng.nextFloat() < chance) dead.push(entity);
      });
      for (const character of dead) {
        const ci = index(character as number);
        ctx.events.publish({
          type: 'character.died',
          tick: ctx.tick,
          data: { characterId: character as number, name: names.tryGet(ci) ?? 'unknown', age: c.age[ci] as number },
        });
        if (kingdomIds.length > 0) {
          const k = world.write(Kingdom);
          for (const kingdomId of kingdomIds) {
            const ki = index(kingdomId as number);
            for (const office of OFFICES) {
              if ((k[office][ki] as number) === (character as number)) {
                k[office][ki] = 0;
                ctx.events.publish({ type: 'kingdom.officeVacated', tick: ctx.tick, data: { office } });
              }
            }
          }
        }
        world.despawn(character);
      }
      if (dead.length > 0) rebuildModifiers();
    },
  };

  kernel.registerSystem(genesis);
  kernel.registerSystem(rollup);
  kernel.registerSystem(aging);

  return {
    Kingdom,
    ActiveEdicts,
    Character,
    CharacterName,
    ledger,
    mods,
    ...(VillageOwner !== undefined ? { VillageOwner } : {}),
    /** 1.x ownership guard for village-mutating commands — see the `ownsVillage` definition. */
    ownsVillage,
    kingdomEntity: () => kingdomIds[0] ?? null,
    kingdomEntities: () => kingdomIds,
    treasury(): number {
      const kingdomId = kingdomIds[0];
      if (kingdomId === undefined) return 0;
      return world.read(Kingdom).treasury[index(kingdomId as number)] as number;
    },
    refreshAfterLoad(): void {
      kingdomIds.length = 0;
      world.query([Kingdom]).forEach((_i, entity) => kingdomIds.push(entity));
      rebuildModifiers();
    },
    registerCharacterExtension(comp: Component): void {
      agingWrites.push(comp);
    },
  };
}
