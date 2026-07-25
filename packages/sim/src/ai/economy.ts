/**
 * AI kingdom-economy manager (roadmap M-era; doc 07 §5 "Tier A #3"). Daily,
 * the capital-bound manager runs a kingdom's fiscal policy — the three levers
 * an AI kingdom otherwise never touched: the TAX RATE, standing EDICTS, and the
 * tier-2 UPGRADE. Same discipline as the other AI managers (manager.ts,
 * research.ts, military.ts): one small deterministic decision per day, no
 * precheck it can't cheaply make, and rejected commands are tolerated (the
 * command handler is the authority; a rejected order is retried unchanged or
 * simply skipped next day).
 *
 * TAX (plan-driven, no baseline — the deliberate "option 3" policy): a freshly
 * founded village starts at NORMAL (villages.ts), which taxes happiness for no
 * chosen reason. Instead the rate follows the strategic plan — HIGH while a
 * warlike plan needs gold for an army, a modest LOW under TechRace to fund
 * research edicts, and NONE otherwise so happiness (and thus growth and
 * prosperity) climbs on the +1/day no-tax drift. A happiness CLAMP overrides
 * the plan when the people are already suffering: never above LOW below 60 joy,
 * never above NONE below 45 — "high tax forever is self-defeating" (kingdom.ts)
 * made self-correcting.
 *
 * EDICTS follow the same "only when the plan asks, and only what income can
 * sustain" rule. Upkeep-bearing edicts are enacted ONLY while the kingdom is
 * taxing (warlike or TechRace) — so they ride real income and never enact-then-
 * lapse against a dry treasury. corvee-labor is the one free lever (upkeep 0):
 * a content kingdom (joy ≥ 70) takes it for the production boost and repeals it
 * the moment its happiness cost drags joy below the floor. One enact-or-repeal
 * per day; the EDICT_CAP (3) is respected. NB the enactEdict command does not
 * gate on research (kingdom.ts), so neither does this — the command is the
 * authority, exactly as the player's own Kingdom panel is.
 *
 * UPGRADE: submit village.upgrade once the slow-moving gates (tier 1, the
 * population and happiness thresholds) are cheaply satisfied; the remaining
 * distinct-building and material checks fall through to the command, which by
 * then the economy-depth needs (needs.ts: granary/quarry/well/tavern) have
 * usually met. Prechecking tier + pop + happiness keeps the daily order from
 * spamming a rejection for the ~100 growth days before it can possibly pass.
 */
import type { EntityId } from '@crowns/core';
import type { DefinitionDatabase } from '@crowns/data';
import type { Component, World } from '../ecs.js';
import type { Kernel, SimSystem } from '../kernel.js';
import { TICKS_PER_DAY } from '../time.js';
import type { VillageGameplay } from '../game/villages.js';
import type { PopulationGameplay } from '../game/population.js';
import { EDICT_CAP, TAX_RATES, type KingdomGameplay } from '../game/kingdom.js';
import { TIER2_REQUIREMENTS } from '../game/settlers.js';

const index = (id: number): number => id & 0x3fffff;

// Tax-rate indices into kingdom.ts's TAX_RATES (none/low/normal/high/punitive).
const TAX_NONE = 0;
const TAX_LOW = 1;
const TAX_HIGH = 3;

// Happiness bands (0..100). LOW: recovery floor — no tax, shed happiness-costing
// edicts. MID: comfort target — clamp tax to LOW. HIGH: content headroom — a free
// production edict is worth its happiness cost.
export const HAPPY_LOW = 45;
export const HAPPY_MID = 60;
export const HAPPY_HIGH = 70;

/** Plans that fund an army and therefore justify a heavy tax. */
const WARLIKE_PLANS = new Set(['MilitaryBuildup', 'ConquestWar', 'PunitiveRaid']);

// Edict ids (content/base/defs/edicts/core.json5), referenced by policy below.
const GRAIN_RESERVES = 'base:edict.grain-reserves';
const HARVEST_FESTIVAL = 'base:edict.harvest-festival';
const CORVEE_LABOR = 'base:edict.corvee-labor';
const MERCHANT_CHARTERS = 'base:edict.merchant-charters';
const SCHOLARLY_ENDOWMENT = 'base:edict.scholarly-endowment';

export interface AiEconomyOptions {
  readonly issuer: number;
  readonly villageId: EntityId; // the kingdom's capital (getter, re-resolved each tick)
  readonly kingdomId: EntityId; // the acting kingdom (getter)
  readonly getPlan: () => string;
  readonly id?: string;
  /** Extra components a custom `getPlan` reads (e.g. the planner's `AiPlanState`). */
  readonly extraReads?: readonly Component[];
}

/** The tax rate this plan+happiness wants — plan-driven, then clamped for joy. */
export function desiredTaxRate(plan: string, happiness: number): number {
  let rate = WARLIKE_PLANS.has(plan) ? TAX_HIGH : plan === 'TechRace' ? TAX_LOW : TAX_NONE;
  if (happiness < HAPPY_LOW) rate = TAX_NONE;
  else if (happiness < HAPPY_MID) rate = Math.min(rate, TAX_LOW);
  return rate;
}

export function registerAiEconomyManager(
  kernel: Kernel,
  world: World,
  db: DefinitionDatabase,
  game: VillageGameplay,
  popGame: PopulationGameplay,
  kingdomGame: KingdomGameplay,
  options: AiEconomyOptions,
): void {
  const { VillageCore } = game.comps;
  const { Population } = popGame;
  const { Kingdom, ActiveEdicts } = kingdomGame;

  // edict def id → stable code (the same sorted-id ordering kingdom.ts uses).
  const edictIds = [...db.edicts.keys()].sort();
  const edictCode = new Map(edictIds.map((id, i) => [id, i]));

  const system: SimSystem = {
    name: options.id !== undefined ? `ai-economy-${options.id}` : 'ai-economy',
    period: TICKS_PER_DAY,
    phase: 9,
    access: { reads: [VillageCore, Population, Kingdom, ActiveEdicts, ...(options.extraReads ?? [])] },
    update(): void {
      if (!world.isAlive(options.villageId)) return;
      const vi = index(options.villageId as number);
      const ki = index(options.kingdomId as number);
      const plan = options.getPlan();
      const happiness = world.read(Population).happiness[vi] as number;

      // ---- tax: idempotent, only submit on a change ----
      const wantTax = desiredTaxRate(plan, happiness);
      if ((world.read(VillageCore).taxRate[vi] as number) !== wantTax) {
        kernel.submit({ type: 'village.setTaxRate', issuer: options.issuer, payload: { villageId: options.villageId as number, rate: wantTax } });
      }

      // ---- edicts: one enact-or-repeal per day ----
      const active = world.readObj(ActiveEdicts).tryGet(ki);
      const isActive = (id: string): boolean => {
        const code = edictCode.get(id);
        return code !== undefined && active !== undefined && active.has(code);
      };

      // repeal first: corvée's happiness cost is sinking us — shed it before it lapses growth.
      if (isActive(CORVEE_LABOR) && happiness < HAPPY_LOW) {
        kernel.submit({ type: 'kingdom.repealEdict', issuer: options.issuer, payload: { edict: CORVEE_LABOR } });
        return; // one action per day
      }

      // desired standing edicts, most-wanted first. Upkeep-bearing ones ride tax income
      // only (wantTax > 0), so a taxing kingdom sustains them instead of enacting-then-lapsing.
      const wishlist: string[] = [];
      if (wantTax > TAX_NONE) {
        wishlist.push(GRAIN_RESERVES); // staple: halve spoilage while there's coin to keep it
        if (happiness < HAPPY_MID) wishlist.push(HARVEST_FESTIVAL); // tax is biting — cushion joy
        wishlist.push(MERCHANT_CHARTERS); // amplify the very income paying for the rest
      }
      if (plan === 'TechRace') wishlist.push(SCHOLARLY_ENDOWMENT); // research-pace lever (TechRace taxes LOW)
      if (happiness >= HAPPY_HIGH) wishlist.push(CORVEE_LABOR); // content headroom → free production

      const activeCount = active?.size ?? 0;
      if (activeCount < EDICT_CAP) {
        const treasury = world.read(Kingdom).treasury[ki] as number;
        for (const id of wishlist) {
          if (isActive(id)) continue;
          const def = db.edicts.get(id);
          if (def === undefined || treasury < def.upkeep) continue; // can't cover it — skip (matches command)
          kernel.submit({ type: 'kingdom.enactEdict', issuer: options.issuer, payload: { edict: id } });
          return; // one action per day
        }
      }

      // ---- upgrade: precheck the slow gates; let materials/distinct fall through to the command ----
      const core = world.read(VillageCore);
      if ((core.tier[vi] as number) !== 1) return; // already upgraded (or beyond)
      if (popGame.totalOf(vi) < TIER2_REQUIREMENTS.population) return;
      if (happiness < TIER2_REQUIREMENTS.happiness) return;
      kernel.submit({ type: 'village.upgrade', issuer: options.issuer, payload: { villageId: options.villageId as number } });
    },
  };
  kernel.registerSystem(system);
}
