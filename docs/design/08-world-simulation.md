# 08 — World Simulation Design

**This document is the source of truth for time, cadences, and update ordering.** Any rate quoted
elsewhere defers to the tables below.

## §1. Time Progression

| Unit | Definition | Real time @1× (1 tps) | @8× |
|---|---|---|---|
| Tick | 1 in-game hour | 1 s | 125 ms |
| Day | 24 ticks | 24 s | 3 s |
| Season | 90 days | 36 min | 4.5 min |
| Year | 4 seasons (360 days) | 2.4 h | 18 min |

Fixed timestep; speed changes multiply ticks/second, never tick length (TDD §6). Pause halts the
sim; UI and camera remain live. Target campaign length: 40–120 in-game years (Vision §2).

**Felt pace is one knob:** `REAL_SECONDS_PER_DAY` (config, default **24**) sets how long an in-game
day takes at normal speed; the driver derives its rate as `BASE_TICKS_PER_SECOND = TICKS_PER_DAY /
REAL_SECONDS_PER_DAY` (= 1 tps by default). Because production and growth are expressed **per
game-day** (recipe `perDay` rates split across `TICKS_PER_DAY`; births/deaths/needs run once per
game-day) rather than on real-time timers, stretching the day scales the felt speed of everything
proportionally — with no per-building retuning and no change to tick content (determinism untouched;
the rate is presentation-only, so goldens are unaffected).

**Starting setup is data-driven** (`DEFAULT_STARTING_SETUP` in `terra.ts`, overridable per compose):
the player begins with the **keep only** (no pre-built farm/quarry/etc.) and `{ 200 wood, 100 stone,
50 food }` in the stockpile — the 50 food being the keep's larder (§4). Genesis funds the keep's own
cost on top of that stock, so the player is left holding exactly the configured resources once the
centre is placed (conservation intact).

## §2. Update Pipeline & Frequencies

Systems execute in this fixed order each tick; most bodies internally gate on their cadence
(`tick % period == phaseOffset`) with **phase staggering** so daily/weekly systems spread across
different ticks rather than spiking together.

| # | System | Cadence | Notes |
|---|--------|---------|-------|
| 1 | Command intake & validation | every tick | drains Command Bus (TDD §4) |
| 2 | Time & calendar | every tick | day/season/year events |
| 3 | Movement (armies, haulers, settlers) | every tick | path following; engagement detection |
| 4 | Combat resolution | every tick while engagements active | sub-ticked internally |
| 5 | Logistics (hauler jobs, caravans) | every tick | job board matching amortised |
| 6 | Production (building recipes) | hourly (1 tick) batched per village | staggered by village id |
| 7 | Construction progress | hourly | labor-driven |
| 8 | Needs & consumption | daily | food eaten, warmth, services |
| 9 | Happiness & unrest | daily | rolls unrest thresholds |
| 10 | Population (births/deaths/migration, job solver) | daily | cohort math |
| 11 | Markets & prices | daily | drift within bands |
| 12 | Kingdom economy roll-up (taxes, upkeep, ledger) | daily | treasury deltas |
| 13 | AI: sensors & appraisal | daily (staggered per kingdom) | doc 07 §1 |
| 14 | AI: domain managers | daily (staggered) | budget-sliced |
| 15 | Research progress | daily | points accrual |
| 16 | Diplomacy (opinion decay, treaty checks, envoys) | daily | breach detection |
| 17 | AI: strategic re-planning | weekly (7 days) + alarm events | doc 07 §2 |
| 18 | Event system evaluation | daily pools; disaster pool weekly | §10 |
| 19 | Seasonal transition | per season | modifier swap, autosave, report |
| 20 | Victory/defeat evaluation | daily | GDD §16 |
| 21 | Snapshot delta emission | every tick | interest-managed (TDD §4) |

**M23 delta (game/diplomacy.ts):** row 16 is command-driven, not a cadence system — gifts/
insults/pacts resolve the instant the command runs (with anti-spam cooldowns, not decay); no
system registered gates on `daily` yet. **M31 delta:** the first cadence system lands here —
`diplomacy-war-exhaustion` runs daily, accruing `warExhaustion` for every active war and forcing
peace unconditionally at the cap (the "no forever-wars" GUARANTEE — doc 07's alarm-event list
gains `war declared`/`treaty broken`, already anticipated by §9 below).

**M32 delta (game/research.ts):** row 15 lands exactly as designed — `research-progress` runs
daily, summing completed scholar buildings' `pointsPerDay` per kingdom (scaled by the Scholar
office's `kingdom.researchYield` modifier, game/kingdom.ts) into the active tech's progress;
completion swaps it into `known` and clears the active slot. `kingdom.setActiveResearch` itself
is command-driven (like row 16's gifts/pacts), not cadence-gated — only the accrual is daily.

**M47.8 delta (doc 12 R1):** the HOURLY jobs solver (population.ts — a finer cadence than row
10's daily cohort math, per that module's own doc) gains an explicit staffing priority: builders
→ haulers → FOOD production → other production. Previously production staffed in bare entity
order, which let an accumulating building roster out-compete farms for hands — the M46
Builder-starvation defect, root-caused and closed here. Two new daily campaign systems join the
pipeline: `occupation` (phase 9 — undefended at-war non-castle villages change hands after 5
unopposed days; the Conquest path plain villages never had) and `belief-sensors` (phase 11 —
contact-refresh + confidence decay for AI `armyStrength` beliefs, doc 07 §6). Both are
campaign-composition systems; the legacy AI-harness wrapper pins its recorded M22-M46 conditions
and runs neither.

**M37 delta (game/victory.ts):** row 20 lands exactly as designed too — `victory-tracker` runs
daily, evaluating all five GDD §16 tracks plus the last-village defeat rule (doc 06 §12). Legacy's
wonder-completion bookkeeping is the one piece that ISN'T daily-polled: it's event-driven off
`building.completed`, same "don't scan everything every day when an event already tells you"
reasoning Legacy's own module doc gives.

**Simulation priority rule:** if the per-frame tick budget is exceeded (TDD §6), time dilates —
but *within* a tick, systems 1–5 (interaction-critical) are never internally degraded; amortisable
systems (5, 6, 13, 14, pathfinding) shed load first by narrowing their per-tick slice.

## §3. Seasons

Season modifiers are data-defined (`SeasonDef`, moddable) applied as scoped `Modifier`s at
transition:

| Season | Farming | Movement | Army attrition | Other |
|---|---|---|---|---|
| Spring | sow (yield pending) | mud −20% speed | normal | flood events pool ↑ |
| Summer | growth/harvest ×1.2 | normal | heat minor | war season (AI aggression consideration ↑) |
| Autumn | harvest spike | normal | normal | market surplus; festival events |
| Winter | ~0 field output | snow −30%; frozen rivers passable **[OQ-5]** | high w/o supply | fuel need active; siege endurance bites |

Design intent: winter is a strategic actor — campaigns end or gamble; granaries decide survival.

## §4. Economy Updates

Hourly production per village: `output = Σ recipes(building) × eff` (GDD §3), stockpiles clamp at
limits, spoilage applies daily to decaying goods. Daily roll-up computes village prosperity
(production value + trade + happiness factor) feeding taxes. Conservation invariant: every unit of
resource created/consumed/moved reconciles in the ledger (property-tested, TDD §13).

**Storage caps are per-resource:** `cap(vi, code) = base(code) + Σ storage.capacity` of completed
storage buildings, then floored by any player-set stock limit. Every good's base is `BASE_STORAGE`
(150) **except food**, whose base is the keep's small larder `KEEP_FOOD_BUFFER` (50, a config value).
So a village can hold only 50 food until it raises a **granary** — surplus food has nowhere to go and
simply can't be stored (haulers can't deposit past the cap, so the farm's overflow stalls in its
outbox rather than accumulating). This makes a granary an early priority (GDD §3). Food alone carries
the reduced base; wood/stone/planks/tools are unchanged. The cap is deposit-time (not a retroactive
purge), so it is fully deterministic.

Production overflows into per-building outboxes (`OUTBOX_DAYS`) which haulers drain into the
stockpile. **A hauler that reaches a full stockpile must NOT park indefinitely** holding its cargo:
when a resource's consumers are also saturated it stays capped forever, and a hauler frozen on it is a
hauler that never carries food again — the classic "starve amid full warehouses" deadlock (haulers
freeze one by one as each stockpile caps, until the farm outbox strands and the village starves).
Instead the hauler deposits what fits, **returns the remainder to the source outbox, and goes idle**
(matter conserved) — free to service the always-hungry food route (`game/logistics.ts`, `TO_DROPOFF`).

## §5. Population Growth

Daily cohort update (`game/population.ts`):
`births = adults × BIRTH_RATE × foodSecurity × (0.5 + 0.5·shelter) × joyFactor`,
`deaths = cohort × mortality(ageBand) × (famine|disease|winter modifiers)`. Aging promotes cohorts on
year boundaries. Named individuals resample from cohorts on demand [OQ-2].

**Joy is a main driver of population (M-era).** `joyFactor = min(2, happiness/JOY_NEUTRAL)` scales
fertility (a happy village births ~2× a neutral one; a miserable one ≈0). On top of natural
demographics, a **net-migration** term keys on the same `happiness` stat around the neutral pivot
`JOY_NEUTRAL = 50`: `migration = total × JOY_MIGRATION_RATE × (happiness − 50)/50`. Above neutral a
content village **draws settlers in — but only into spare housing** (`min(migration, housingCap − total)`,
so capacity gates immigration); below neutral an unhappy village **bleeds people who leave** (emigration,
ungated). Migration is applied pro-rata across cohorts so the age pyramid is preserved, and is fully
deterministic (a pure function of state — no RNG). `JOY_MIGRATION_RATE`/`BIRTH_RATE` magnitudes are
tuned against day-length in the pace pass.

The target, fertility, and migration formulas are exported as pure helpers (`joyContributions`,
`joyTarget`, `joyFertility`, `joyMigration`) that the needs/population systems call with their exact
expressions — so the UI's Joy panel breaks joy down (Food/Shelter/Services/Edicts contributions,
net migrants/day, fertility ×) using the very numbers the sim applies, with no second implementation
to drift. Contribution weights are named constants (`HAPPINESS_FOOD_WEIGHT` 0.7, `HAPPINESS_SHELTER_WEIGHT`
0.3, `SERVICE_JOY_CAP` 15) rather than inline literals.

**Starvation is lethal.** `foodSecurity` is a daily EMA of the fed fraction — now tracking **real,
un-floored nutrition** so a village with no food trends toward `0`, which halts births and drives
famine mortality at full strength (`famine = FAMINE_MORTALITY × (1 − foodSecurity)`): people genuinely
die when the granaries run dry, a steady decline (bounded per day, never an instant cliff) rather than
the earlier hard floor. The **forage floor** (`FORAGE_FLOOR`, GDD §4) still applies — but only to
*morale*: foragers scrape the hedgerows so happiness never cliffs on hunger alone, while *survival*
sees true nutrition.

`foodSecurity` is **seeded at its maximum `1.0`** so a brand-new village reads as fed rather than
starving (this seed is load-bearing: `RECRUIT_MIN_FOOD_SECURITY`, `CRISIS_FOOD_SECURITY`, and births
all key on it). Consequence for content authors: an event/tutorial trigger that keys on *high* food
security (`foodSecurity gte …`) is trivially true on day 1 from that seed, so it must be **gated** (e.g.
by season) or it fires from the initial state — the "Bountiful Harvest" (autumn) and tutorial
"Granaries Are Full" (summer) events both do this. Low-water triggers (`lt …`, e.g. starvation/unrest)
need no such gate; the max seed never satisfies them.

## §6. Resource Production & Construction

Construction consumes stockpiled materials up front (reservation) then labor per hour until
`progress = 1`. Builder-labor is a village cohort allocation competing with production jobs via the
priority solver (GDD §4/§5) — guns-vs-butter is felt in the job board itself.

## §7. Military Movement

Per tick: armies advance along cached paths at `speed × terrain × season × fatigue`; supply check
daily (consume from wagons → forage → attrition + morale loss). Engagement detection on tile
co-occupancy or siege-radius entry creates `Engagement` (Engine §4). Zone-of-control: hostile
adjacency forces stance interaction (pass-by requires raid/march stance trade-offs).

**M25 delta (military basics, before Movement lands):** recruitment training progress runs hourly,
alongside Construction progress (slot 7) — mirrors `progress → complete`. Upkeep (wages + food,
GDD §6) settles once a season, deliberately phased so it never lands on the same tick as the daily
Kingdom roll-up (slot 12): an unpayable unit deserts at that check the same way an unpayable edict
lapses.

**M26 delta (game/armies.ts):** movement runs every tick (slot 3, as designed) — `speed × terrain ×
season × fatigue` exactly as this section always said, except TERRAIN is baked into the route
itself (hierarchical HPA*, nav/hpaStar.ts — one chunk-graph build per session, never a per-tick
cost) while season and fatigue are temporal multipliers applied when walking that fixed tile
sequence, so neither ever forces a graph rebuild. Supply settles daily (phased clear of the
population/needs and kingdom-rollup slots): carried supplies first, then forage from the nearest
FRIENDLY village within range (draining its food stockpile — a real cost); failing both, fatigue
climbs and, sustained at max, triggers attrition (`Unit.count` shrinks for real, GDD §6's
guns-vs-butter made literal). Engagement detection, zone-of-control stance trade-offs, and true
road-network supply lines wait on Combat (M27) and Castles (M28), both landed; formal war state
(M31) is now modelled too, but combat/siege hostility still runs on the pre-existing "no active
NAP ⇒ hostile" gate rather than requiring a declared war — zone-of-control and road-network
supply remain their own, still-deferred, work.

## §8. Combat Resolution Timing

Active engagements resolve in combat sub-ticks (4 per tick) so battles span multiple ticks —
visible, interruptible (reinforce/withdraw), and pausable. Field battles typically last 2–12 ticks;
sieges persist as a state (bombard/starve phases) across days with assault windows resolved like
field battles against breach paths.

**M27 delta (game/combat.ts):** implemented per this section exactly — `combat-detection` (doc 08
§7's tile-co-occurrence, widened to a small radius) then `combat-resolution`, both every tick,
running `SUBROUNDS_PER_TICK = 4` sub-rounds per call, capped at `MAX_ENGAGEMENT_TICKS = 12`. Morale
is the true HP (GDD §8): sub-round damage (attack × soft counter × morale fraction, vs. defense)
subtracts from it; a unit below `ROUT_MORALE_THRESHOLD` may rout — survives, leaves the army — and
a fraction of the same damage also costs real casualties (`Unit.count`). `battle.autoResolve` calls
the IDENTICAL sub-round function in a tight loop instead of across real ticks — the same code path,
not a parallel one — which is what makes "auto vs. manual parity" (the T objective) hold by
construction rather than by tuning. Front/flank/reserve lines, formation orders, and kill/wound/
capture casualty splitting stay a single aggregate line and one "casualties" number until a later
milestone gives tactical depth and ransom something to consume.

**M29 delta (game/siege.ts):** exactly this section's "sieges persist as a state (bombard/starve
phases) across days" — `siege-bombard` runs DAILY (not sub-ticked; sieges pace in days/seasons per
GDD §8's own balancing note), damaging the targeted defence-graph segment (castles.ts) until
breached (demolished, same code path a player's `village.demolish` uses). Assault/sortie windows
are literally combat.ts engagements — `siege-assault-watch` polls them every tick rather than
reacting to `battle.resolved`, since event subscribers in this codebase never publish further
events (only ever mutate component state); capture/lift need to publish, so that logic lives in a
system's own tick context instead. Starvation is a daily granary check, capitulating after
`STARVATION_SURRENDER_DAYS` (a season) at/near zero food — the T objective, "siege pacing stats
within design bands", is exactly this number matched against GDD §8's "should take seasons".

## §9. AI Decision Frequency

Per doc 07 §1/§11: sensors+appraisal daily, managers daily, strategy weekly, all staggered per
kingdom (kingdom k thinks on `day % 7 == k % 7`), with **alarm events** (war declared, siege begun,
famine, treaty broken) triggering immediate out-of-band re-appraisal next tick — responsive without
per-tick cost.

## §10. Event Scheduling

- Daily: kingdom/village pools evaluated with per-pool max-1-fire and per-event cooldowns.
- Weekly: disaster pool (weight scaled by climate harshness setting & season).
- On-trigger: alarm-style content events (aftermaths, milestones) fired directly by GameEvents.
- Global pacing governor: target event pressure band (events/kingdom/season) modulates pool weights
  to avoid silence or spam — a *pacing* aid only; it may never force specific outcomes (GDD App. A).

**M33 delta (game/events.ts):** exactly this section, per-kingdom. `opportunity`/`character`/
`diplomatic`/`unrest`/`era` run daily; `disaster` alone runs weekly (doc 08 §10's own split).
Each candidate event with a passing trigger rolls independently at `weight × BASE_*_RATE ×
weightModifiers × pacingMultiplier` (small on purpose — weight 3 is a few times a SEASON, not a
few times a day); if more than one roll passes in the same pool the same evaluation, only one
actually fires (`pool-events`' own weighted pick) — the "max-1-fire" rule. `pacingMultiplier`
(the roadmap's "pacing governor bands" T objective) is a pure function of one kingdom's fires-
this-season count: boosts (×2.5) under `PACING_TARGET_MIN`, dampens (×0.15) at/over
`PACING_TARGET_MAX`, neutral (×1) inside the band — it scales WHETHER something fires, never
WHICH event (GDD App. A's "never the puppeteer" holds by construction: the multiplier has no
event-identity in scope). Season-boundary detection (for resetting the per-season counter) is a
pure function of `ctx.tick` (`Math.floor(tick / TICKS_PER_SEASON)` changing), not a subscription
to `time.ts`'s `CalendarSystem` events — this module has no way to require that system also be
registered, so deriving the boundary directly avoids a fragile cross-module ordering dependency.
"On-trigger" alarm-style events stay out of scope this milestone (every event here is pool/
cadence-driven; M31's `diplomacy.warDeclared`-style alarm events are the existing precedent for
that shape, not owned by events.ts).

**Special-event levers (`SpecialEventTuning`, `DEFAULT_SPECIAL_EVENT_TUNING`):** the six flavour
pools (`opportunity`/`character`/`diplomatic`/`unrest`/`era`/`disaster`) are "special"; the
`tutorial` pool is ordinary onboarding and is exempt from both levers below. Both are independent,
data-driven, and overridable per composition via `EventGameplayOptions.specialEvents`:
- **Start gate** (`startGateMonths`, default **6**): special pools do not roll until
  `ctx.tick ≥ startGateMonths × TICKS_PER_MONTH` (6 × 720 = 4320 ticks); tutorial is never gated, so
  a new realm is still guided. Measured: with the default, the first special event lands right at
  month ~6 and zero fire before it.
- **Frequency** (`avgPerMonth`, default **0.5** — one every ~two months): special pools' per-tick
  fire probability is `weight × BASE_*_RATE × (avgPerMonth / SPECIAL_BASELINE_PER_MONTH)`, and they
  **bypass the pacing governor** (whose boost/dampen would otherwise skew the average and act as soft
  spacing). `SPECIAL_BASELINE_PER_MONTH` is the measured baseline (~1 special event/month at the raw
  default rates), so `avgPerMonth = X ⇒ ~X special events/month` — probabilistic, natural month-to-
  month variance, no hard cap or enforced spacing. Current effective rate BEFORE this change was
  ~0.9–1.0/month starting from month ~1; AFTER it is ~`avgPerMonth`/month starting at month 6.
The pacing governor now governs only the ordinary (tutorial) pool; special events set their own
cadence, so ordinary events are provably untouched by either lever (unit-tested).

## §11. Determinism & Ordering Guarantees

All cadence gating derives from tick counters (never wall-clock); staggering offsets derive from
stable entity ids; cross-entity iteration is id-ordered (TDD §5). Seasonal autosave (system 19)
snapshots *between* ticks — saves never bisect a tick.
