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
 * and Scholar hold their offices for M25/M32. Advisors draw a daily salary,
 * age, and die — death vacates the office by event.
 */
import type { EntityId } from '@crowns/core';
import type { DefinitionDatabase, EdictDef } from '@crowns/data';
import { ObjectComponent, SoAComponent, World } from '../ecs.js';
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
  readonly kind: 'tax' | 'edict-upkeep' | 'advisor-salary';
  readonly amount: number; // signed: income positive, expense negative
  readonly detail: string; // village name, edict id, office…
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
  kingdomEntity(): EntityId | null;
  treasury(): number;
  /** Re-bind the kingdom entity and rebuild the modifier board after save hydration (M17). */
  refreshAfterLoad(): void;
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
): KingdomGameplay {
  const { VillageCore, VillageName, BuildingCore } = game.comps;
  const { Population } = popGame;
  const index = (id: number): number => id & 0x3fffff;

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

  let kingdomId: EntityId | null = null;

  // ---------------- modifier board: edicts + offices, one rebuild ----------------
  const rebuildModifiers = (): void => {
    if (kingdomId === null) return;
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
    mods.rebuild(sources);
  };

  // ---------------- genesis: the kingdom and its notables ----------------
  const genesis: SimSystem = {
    name: 'kingdom-genesis',
    period: 0x7fffffff,
    phase: 1,
    access: { writes: [Kingdom, ActiveEdicts, Character, CharacterName] },
    update(ctx: TickContext): void {
      const kingdom = world.spawn();
      world.attach(kingdom, Kingdom, { treasury: STARTING_TREASURY, steward: 0, marshal: 0, chancellor: 0, scholar: 0 });
      world.attach(kingdom, ActiveEdicts, new Map());
      kingdomId = kingdom;
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
    },
  };

  // ---------------- commands ----------------
  const reject = (ctx: TickContext, what: string, reason: string): void => {
    ctx.events.publish({ type: 'village.rejected', tick: ctx.tick, data: { what, reason } });
  };

  kernel.registerCommand<{ villageId: number; rate: number }>('village.setTaxRate', (ctx, p) => {
    const village = p.villageId as EntityId;
    if (!world.isAlive(village)) return reject(ctx, 'village.setTaxRate', 'no such village');
    const rate = p.rate | 0;
    if (rate < 0 || rate >= TAX_RATES.length) {
      return reject(ctx, 'village.setTaxRate', `rate must be 0..${TAX_RATES.length - 1} (none/low/normal/high/punitive)`);
    }
    const core = world.write(VillageCore);
    core.taxRate[index(p.villageId)] = rate;
  });

  kernel.registerCommand<{ edict: string }>('kingdom.enactEdict', (ctx, p) => {
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

  kernel.registerCommand<{ edict: string }>('kingdom.repealEdict', (ctx, p) => {
    if (kingdomId === null) return reject(ctx, 'kingdom.repealEdict', 'no kingdom');
    const code = edictCode.get(String(p.edict));
    if (code === undefined) return reject(ctx, 'kingdom.repealEdict', `unknown edict '${String(p.edict)}'`);
    const active = world.writeObj(ActiveEdicts).tryGet(index(kingdomId as number));
    if (active === undefined || !active.has(code)) return reject(ctx, 'kingdom.repealEdict', 'not active');
    active.delete(code);
    rebuildModifiers();
    ctx.events.publish({ type: 'kingdom.edictRepealed', tick: ctx.tick, data: { edict: String(p.edict) } });
  });

  kernel.registerCommand<{ office: string; characterId: number }>('kingdom.appoint', (ctx, p) => {
    if (kingdomId === null) return reject(ctx, 'kingdom.appoint', 'no kingdom');
    const office = String(p.office) as Office;
    if (!OFFICES.includes(office)) return reject(ctx, 'kingdom.appoint', `unknown office '${String(p.office)}' (${OFFICES.join('/')})`);
    const character = p.characterId as EntityId;
    if (!world.isAlive(character) || !world.has(character, Character)) {
      return reject(ctx, 'kingdom.appoint', 'no such character');
    }
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

  // ---------------- daily roll-up (doc 08 slot 12) ----------------
  const rollup: SimSystem = {
    name: 'kingdom-rollup',
    period: TICKS_PER_DAY,
    phase: 6,
    access: {
      writes: [Kingdom, ActiveEdicts, Population],
      reads: [VillageCore, VillageName, BuildingCore, Character],
    },
    update(ctx: TickContext): void {
      if (kingdomId === null) return;
      const ki = index(kingdomId as number);
      const k = world.write(Kingdom);
      const pop = world.write(Population);
      const core = world.read(VillageCore);
      const names = world.readObj(VillageName);
      const b = world.read(BuildingCore);

      // production value per village: installed recipe output × staffing × price
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

      let taxes = 0;
      const taxYield = mods.mul('kingdom.taxYield');
      world.query([Population, VillageCore]).forEach((vi) => {
        const rate = TAX_RATES[core.taxRate[vi] as number] ?? TAX_RATES[2];
        const happiness = pop.happiness[vi] as number;
        const prosperity = (value.get(vi) ?? 0) * (0.5 + happiness / 200); // GDD §2 happiness factor
        const take = prosperity * rate.take * taxYield;
        if (take > 0) {
          k.treasury[ki] = (k.treasury[ki] as number) + take;
          taxes += take;
          ledger.record({ tick: ctx.tick, kind: 'tax', amount: take, detail: names.tryGet(vi) ?? `village ${vi}` });
        }
        // the tax-pressure curve: happiness drifts with the rate (bounded)
        pop.happiness[vi] = Math.max(0, Math.min(100, happiness + rate.happiness));
      });

      // edict upkeep — Chancellor discounts it; unpayable edicts LAPSE
      let upkeepTotal = 0;
      const chancellor = k.chancellor[ki] as number;
      const c = world.read(Character);
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
          ledger.record({ tick: ctx.tick, kind: 'edict-upkeep', amount: -cost, detail: def.id });
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
        ledger.record({ tick: ctx.tick, kind: 'advisor-salary', amount: -ADVISOR_SALARY, detail: office });
      }

      ctx.events.publish({
        type: 'kingdom.rollup',
        tick: ctx.tick,
        data: {
          treasury: k.treasury[ki] as number,
          taxes,
          upkeep: upkeepTotal,
          salaries,
          net: taxes - upkeepTotal - salaries,
        },
      });
    },
  };

  // ---------------- yearly: advisors age; the old may die ----------------
  const aging: SimSystem = {
    name: 'character-aging',
    period: TICKS_PER_YEAR,
    phase: 7,
    // despawn detaches the name too; the modifier rebuild reads active edicts
    access: { writes: [Kingdom, Character, CharacterName], reads: [ActiveEdicts] },
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
        if (kingdomId !== null) {
          const k = world.write(Kingdom);
          const ki = index(kingdomId as number);
          for (const office of OFFICES) {
            if ((k[office][ki] as number) === (character as number)) {
              k[office][ki] = 0;
              ctx.events.publish({ type: 'kingdom.officeVacated', tick: ctx.tick, data: { office } });
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
    kingdomEntity: () => kingdomId,
    treasury(): number {
      if (kingdomId === null) return 0;
      return world.read(Kingdom).treasury[index(kingdomId as number)] as number;
    },
    refreshAfterLoad(): void {
      kingdomId = null;
      world.query([Kingdom]).forEach((_i, entity) => {
        if (kingdomId === null) kingdomId = entity;
      });
      rebuildModifiers();
    },
  };
}
