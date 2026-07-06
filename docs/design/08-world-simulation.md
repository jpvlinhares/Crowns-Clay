# 08 — World Simulation Design

**This document is the source of truth for time, cadences, and update ordering.** Any rate quoted
elsewhere defers to the tables below.

## §1. Time Progression

| Unit | Definition | Real time @1× (10 tps) | @8× |
|---|---|---|---|
| Tick | 1 in-game hour | 0.1 s | 12.5 ms |
| Day | 24 ticks | 2.4 s | 0.3 s |
| Season | 90 days | ~3.6 min | ~27 s |
| Year | 4 seasons (360 days) | ~14.4 min | ~1.8 min |

Fixed timestep; speed changes multiply ticks/second, never tick length (TDD §6). Pause halts the
sim; UI and camera remain live. Target campaign length: 40–120 in-game years (Vision §2).

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

## §5. Population Growth

Daily cohort update: `births = adults × baseRate × foodSecurity × housing × health`,
`deaths = cohort × mortality(ageBand) × (famine|disease|winter modifiers)`; migration flows toward
prosperity/reputation and away from unrest/war (bounded per day). Aging promotes cohorts on year
boundaries. Named individuals resample from cohorts on demand [OQ-2].

## §6. Resource Production & Construction

Construction consumes stockpiled materials up front (reservation) then labor per hour until
`progress = 1`. Builder-labor is a village cohort allocation competing with production jobs via the
priority solver (GDD §4/§5) — guns-vs-butter is felt in the job board itself.

## §7. Military Movement

Per tick: armies advance along cached paths at `speed × terrain × season × fatigue`; supply check
daily (consume from wagons → forage → attrition + morale loss). Engagement detection on tile
co-occupancy or siege-radius entry creates `Engagement` (Engine §4). Zone-of-control: hostile
adjacency forces stance interaction (pass-by requires raid/march stance trade-offs).

## §8. Combat Resolution Timing

Active engagements resolve in combat sub-ticks (4 per tick) so battles span multiple ticks —
visible, interruptible (reinforce/withdraw), and pausable. Field battles typically last 2–12 ticks;
sieges persist as a state (bombard/starve phases) across days with assault windows resolved like
field battles against breach paths.

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

## §11. Determinism & Ordering Guarantees

All cadence gating derives from tick counters (never wall-clock); staggering offsets derive from
stable entity ids; cross-entity iteration is id-ordered (TDD §5). Seasonal autosave (system 19)
snapshots *between* ticks — saves never bisect a tick.
