# Crowns & Clay

Browser-based medieval kingdom management game with fully simulated AI rivals.
**The design documents in [`docs/design/`](docs/design/00-README.md) are the authoritative
reference** — read `00-README.md` first. This repository implements them, milestone by milestone
(roadmap: `docs/design/12-roadmap.md`).

## Status

| Milestone | State |
|---|---|
| M1 — Repo & toolchain | ✅ this commit |
| M2 — Core library (PRNG, ids, hashing, math, ordered iteration) | ✅ |
| M3 — Sim kernel shell (kernel, command/event buses, tick driver, calendar, worker bridge, headless runner) | ✅ |
| M4 — ECS store (SoA components, bitset queries, declared-access enforcement, model-based fuzz, micro-bench) | ✅ |
| M5 — Determinism harness (golden replays, tamper-locating verify, cross-engine CI sentinel) | ✅ — **Phase 0 complete** |
| M6 — Render bootstrap (PixiJS chunked scene, camera, snapshot mirror, HUD — first visible build) | ✅ |
| M7 — Worldgen v1 (heightmap → climate → biomes → rivers, priority-flood drainage, pinned golden hash) | ✅ |
| M8 — Terrain render + TerrainDefs (Mod Zero content, validator core, dirty-chunk rebake, terrain demo) | ✅ |
| M9 — Debug HUD & inspector (per-system tick costs, live entity inspector, command injector) | ✅ |
| M10 — Mod loader (manifests, semver gating, dependency ordering, override/patch layers, validation console) | ✅ |
| M11 — Village core (8 BuildingDefs, one-rulebook placement, atomic costs, construction, visible buildings) | ✅ |
| M12 — Population & needs v1 (cohorts, jobs solver, labor-gated construction, famine floor) | ✅ — **Phase 1 complete: the first playable loop** |
| M13 — Production chains (3-tier resources, recipes, stockpile limits, spoilage, conservation ledger) | ✅ — **Phase 2 begins** |
| M14 — Logistics (hauler entities, roads, job board, route cache, local-first storage) | ✅ |
| M15 — Multi-village & founding (settler parties, site scoring, village tiers 1–2) | ✅ |
| M16 — Kingdom layer (treasury, taxes, gold ledger, edicts v1, advisors v1) | ✅ |
| M17 — Save/load v1 (versioned codecs, IndexedDB slots, export/import, autosave, save corpus) | ✅ |
| M18 — UI pass 1 + HUD (panel framework, player panels, build palette, notifications) | ✅ — **no fixture changes** (presentation is hash-inert) · **Phase 2 complete: playable economy sandbox** |
| M19 — AI kernel & sensors (brain scheduling, knowledge model, fog of information) | ✅ — **Phase 3 begins** |
| M20 — AI economy & construction manager (settlement-needs evaluators, build queues) | ✅ |
| M21 — AI strategic planner v1 (plan archetypes, utility scoring, hysteresis) | ✅ |
| M22 — Multiple kingdoms & borders (kingdom placement fairness, territory, scouting) | ✅ |
| M23 — Diplomacy v1 (opinion, gifts/insults, NAP & trade pacts, deal evaluator) | ✅ |
| M24 — AI harness & nightly (8-kingdom AI-vs-AI campaign, behavioural fingerprints, perf telemetry) | ✅ — **Phase 3 complete: rivals awaken** |
| M25 — Military basics (barracks-gated recruitment, training, armies, seasonal upkeep) | ✅ — **Phase 4 begins: war** |
| M26 — Movement & supply (hierarchical HPA* army pathing, stances, supply/forage/attrition, seasons) | ✅ |
| M27 — Field combat (resolver, morale/rout, auto-resolve policy, battle "UI" via the command injector) | ✅ |
| M28 — Castles v1 (wall/gate/tower/keep, defence graph, enclosure algorithm) | ✅ — resolves [OQ-3] |
| M29 — Sieges (phases, bombardment vs. graph, starvation, sorties, assault) | ✅ |
| M30 — AI at war (military manager, war plans, tactical policy, castle-building AI) | ✅ |
| M31 — War diplomacy (casus belli, peace deals, war exhaustion) | ✅ — **Phase 4 complete: war** |
| M32 — Research (tech tree data, scholars, era gates, diffusion) | ✅ — **Phase 5 begins: depth** |
| M33 — Events engine (trigger DSL, pools, choices, AI event answers) | ✅ |
| M34 — Characters (notables, traits, offices deep, marriages, heirs) | ✅ |
| M35 — Diplomacy v2 (alliances, joint wars, vassalage, reputation, memory/grudges) | ✅ |
| M36 — Personalities (7 archetypes tuned, perturbation, legibility) | ✅ this commit |

## Layout (TDD §3)

```
packages/
  core       pure utilities: seeded PRNG, interning, hashing, math   (deps: none)
  data       schemas, validators, content types                      (core)
  sim        kernel, ECS, systems, AI — HEADLESS, no DOM             (core, data, protocol)
  protocol   command & snapshot message types                        (core, data)
  render     WebGL renderer                                          (core, protocol)
  ui         HTML views/HUD                                          (core, protocol)
  app        composition root, worker wiring                         (all)
  tools      dev/debug/asset/mod tooling                             (all)
```

Dependency direction is enforced twice: TypeScript project references (illegal imports don't
build) and ESLint `no-restricted-imports` rules (`eslint.config.js`). `@crowns/sim` additionally
bans `Math.random`, `Date.now`, and DOM globals (determinism contract, TDD §5).

## Run the visible build (M6)

```bash
npm install     # first run also removes the offline bootstrap shims (postinstall)
npm run dev     # Vite dev server → http://localhost:5173
```

You'll see the wanderers world — the same seed and composition pinned by the golden fixtures —
rendered on a REAL generated world (M8): worldgen runs at session start, Mod Zero's TerrainDefs
color every biome, rivers and lakes draw from overlay defs, and the creatures respect the terrain —
they spawn on land and refuse to step into water, so you'll see them hug coastlines and river
banks. Drag to pan, wheel to zoom (cursor-anchored), space to pause, 1–4 for speed. The sim runs in
a Web Worker (TDD §1); the main thread only pumps frame time, mirrors snapshot deltas, and draws
with interpolation.

The M6 fps target (100k-tile pan at 60 fps on P1 hardware) has its pure-math half — visible-chunk
counts bounded at O(viewport), ~42 chunks at 1080p — verified in tests here; confirm the WebGL half
via the HUD fps counter on your machine.

## Getting started

```bash
npm ci            # installs typescript, eslint, prettier (dev deps)
npm run build     # tsc -b (project references)
npm test          # build + node --test (zero-dependency test runner)
npm run lint
```

### Watch the simulation run (M3)

```bash
npm run build
node packages/tools/dist/headless.js 720 12345   # [in-game days] [seed]
```

This boots the exact session composition the browser worker will use (`@crowns/app`), streams
season events for two in-game years, and prints the final state hash. Re-running with the same
seed must print the same hash — that's the determinism contract, live.

### ECS micro-benchmark (M4)

```bash
node packages/tools/dist/bench-ecs.js 100000 100   # [entities] [iterations]
```

Reference result (CI-class hardware): a Position+Velocity integration pass over 100k entities in
~1.5 ms — the game's design ceiling is 2,000 units (doc 11 §1), so hot-loop headroom is ~50×.
`world.hash()` is dev/CI-harness-only cost and is sampled, never per-tick in release.

### Personalities (M36)

AI kingdoms have real, tuned identities now (`content/base/defs/personalities/core.json5`,
`packages/sim/src/ai/personality.ts`, GDD §11, doc 07 §9): the 7 archetypes doc 07 §9 always
promised — **Warmonger, Builder, Merchant, Schemer, Zealot, Steward, Opportunist** — each a full
8-axis weight profile plus `planBiases` (per-`PlanArchetype` utility multipliers). `ai/
personality.ts` is the ONLY place this content touches AI behaviour, since `@crowns/data` never
depends on `sim/`: `perturbWeights` adds small seeded jitter so two kingdoms sharing an archetype
still diverge ("two Warmongers differ"); `toPlannerWeights`/`toDiplomacyPersonality` map the full
weights onto the narrow structural subsets `ai/planner.ts`/`game/diplomacy.ts` already consume —
`planBiases` rides along as a new, optional `PersonalityWeights` field the planner's scoring loop
multiplies in, defaulting to 1 so no milestone before this one changed behaviour. The T objective
— **blind fingerprint test** — takes each archetype's `PlanArchetype.utility` score vector under a
fixed, generous "every opportunity available" scenario as its fingerprint (the same "unit-test the
scoring function against synthetic `Considerations`" pattern M21's own tests already use, not an
emergent multi-year economy — whether the real simulation ever reaches that generous scenario is a
separate, much harder balance question for M46, not this one): several perturbed instances per
archetype are classified — without the classifier ever being told which archetype produced them —
against all 7 canonical fingerprints by correlation, and every one lands correctly, proving the
profiles are behaviourally distinct, not just differently worded flavour text. A companion smoke
test drives all 7 through a real, short AI-vs-AI campaign to confirm nothing crashes and real
divergence shows up in practice. `describePersonality` is the pure "Known for..." legibility
piece — confidence-gating it behind the knowledge model (M19) for a real diplomacy screen is left
to a future UI.

### Diplomacy v2 (M35)

Kingdoms can now truly entangle each other (`packages/sim/src/game/diplomacy.ts`, GDD §10, doc
07 §7): **alliances** are a third pact type (`PACT_ALLIANCE`), evaluated by the exact same
`evaluateDeal` NAP/trade already use — needing better relations to form, since a mutual-defense
commitment is a bigger ask. **Joint wars** are the payoff: the instant a war starts, every
kingdom allied with (or vassal to) either belligerent is cascaded onto that side automatically —
no proposal, no opt-out, one level deep so a single declaration can't chain into a world war —
"teeth, not paper" (GDD §10). **Vassalage** is asymmetric (a `vassalOf` map, not the symmetric
pact bitmask): `evaluateVassalageDeal` has a would-be LORD accept almost unconditionally (a free
tribute stream) while a would-be VASSAL only submits in proportion to how badly it's losing a war
against the proposer — the OQ-9 "AI capitulates when hopeless" path, ending the underlying war
outright. A vassal can't `kingdom.declareWar` independently and pays a seasonal tribute
automatically. **Reputation** is GLOBAL per kingdom (unlike pairwise opinion) — it drops on
oathbreaking (breaking an alliance costs more than dropping a NAP) and unprovoked wars, then
multiplies every deal's threshold via `reputationFactor`, which is exactly 1 at the default value
— every M23/M31 call site is untouched by this. **Memory/grudges**: a bounded (5), per-kingdom-pair
list of significant acts (pact breaks, war declarations, honored alliances — not gifts/insults,
which already have their own channel), with `effectiveMemoryWeight` a pure, personality-scaled
(`grudgeRetention`) exponential decay computed on read, never mutating stored data. That's what
makes the T objective — **grudge persistence across save/load** — simple: `diplomacySection`
(persistence.ts) is the first save section any relational (non-ECS) game/ state has ever needed
(M23/M31/M32/M34's equivalents never did), proving every fact this module owns — including
grudges — round-trips a save/load cycle exactly. AI consumption of reputation/grudges (a
memory-driven plan archetype) stays deliberately out of scope this milestone.

### Characters (M34)

The realm's advisors are notables now, not just skill rolls (`content/base/defs/traits/core.json5`,
`packages/sim/src/game/characters.ts`, GDD §15): this module deepens the SAME six characters
kingdom.ts's genesis already spawns — it never runs its own pool — attaching **traits** (2 per
notable, 12 base, each a small skill-delta bundle applied once, directly onto `Character`'s
stored skill fields) alongside **gender** and **loyalty**. That's the **advisor bonus math** T
objective: kingdom.ts's existing Steward/Marshal/Chancellor/Scholar formulas need zero changes to
read the trait-adjusted values — proven by running the identical seed with and without this
module registered and diffing the two. The one real coupling problem this surfaced: kingdom.ts's
yearly death check despawns characters, and the ECS access guard requires every attached
component declared up front — including ones a LATER module attaches, which kingdom.ts can't
import (the dependency only runs one way). `KingdomGameplay.registerCharacterExtension` is the
fix, a small mutable-array escape hatch kingdom.ts exposes so characters.ts can declare its own
sibling components after the fact. `character.marry` (kingdom-agnostic — using marriage as a
diplomatic alliance clause is M35's job) rejects self-marriage, remarriage, and any parent/child
or sibling pairing via a plain `CharacterRelations` class (mirrors `DiplomacyState`). The second T
objective, **lifecycle tests**: married, fertile-age couples roll a birth chance yearly, and a
child — skills blended from both parents ± jitter, one inherited trait plus one fresh one — starts
too young for `kingdom.appoint` (a new `MIN_OFFICE_AGE` gate) until it ages in, growing the
appointable pool past the fixed genesis six; widowing applies a one-time grief penalty to loyalty,
and a seated officeholder whose loyalty drifts below a floor may resign the seat outright — the
same lapse/desertion shape M16/M25 already established, now for court politics. `role` and `alive`
stay unmodelled (derivable from existing state); `Army.commanderId` (doc 06 §3) and `ransom` (doc
06 §10) remain out of scope, waiting on a captivity concept this milestone doesn't add.

### Events engine (M33)

The realm now has a voice (`packages/data/src/events.ts`, `packages/sim/src/game/events.ts`,
GDD Appendix A): 18 base events across all 6 pools (disaster, opportunity, character,
diplomatic, unrest, era), each a small **trigger DSL** predicate tree (`all`/`any`/`not`,
`season`, `hasEdict`, `hasTech` — a direct tie into M32's tech tree — `chance`, and `stat`
comparators over a closed set of paths) plus a choice menu whose effects flow through the same
grant/remove/nudge/opinion/command channels every other system already uses — "events nudge,
never puppeteer" (GDD App. A). `evaluatePredicate`/`applyEffect` are pure and fail **closed** on
anything malformed rather than throwing, verified directly by the **DSL fuzzing** T objective
(500+ random and hand-picked garbage trees, never a crash). `opportunity`/`character`/
`diplomatic`/`unrest`/`era` pools evaluate daily; `disaster` alone weekly (doc 08 §10). The
second T objective, the **pacing governor**, is a pure function of one kingdom's fires-this-
season count — boosting pool weights when a kingdom's gone quiet, dampening them once it's had
plenty — proven by running the real content for 20 seasons and checking the actual per-season
fire count settles inside the target band, not silent and not spammy. `registerAiEventAnswering`
closes the loop: an AI kingdom scores every pending choice as `Σ aiScoreHints[axis] ×
personalityWeight[axis]` and answers unprompted — proven in the harness with zero player/test
code ever calling `event.choose` directly. `spawn`/`startEvent` effects and tag-query/count
predicates stay out of scope — Characters (M34) landed without adding an event-authored spawn
effect (heirs arrive via a yearly system, not events), and no content needs the rest yet.

### Research (M32) — Phase 5 begins: depth

Kingdoms can now advance through a real tech tree (`packages/data/src/techs.ts`,
`packages/sim/src/game/research.ts`, GDD §9): 72 base `TechDef`s (60-80 target), 18 per branch
across **Agriculture & Craft**, **Construction**, **Warfare**, and **Statecraft**, tiers 1-5
mapped to the early/high/late medieval eras. The T objective — **DAG validation** — runs at
content load: prerequisites must reference real techs, tier/era must never decrease along a
prerequisite edge, unlocks must reference real building/unit/edict ids, and the whole graph must
be acyclic (Kahn's algorithm) — any violation fails exactly like a duplicate terrain id, before
the game ever starts. **Scholar buildings** (scribe's hut → library → university) generate
research points daily, funding one active research at a time (`kingdom.setActiveResearch`) —
switching targets abandons progress, a deliberate v1 simplification. **Era gates** (GDD §9:
"require breadth, discouraging pure beelines") check the content's actual per-era tech count: 60%
of an era must be known before starting the next, proven — the second T objective, **era pacing
sim** — with a bounded research budget that reaches real, non-trivial tree coverage while never
once completing a later-era tech ahead of its gate. **Diffusion** (the GDD's catch-up mechanic)
discounts a tech's cost once a discovered rival already knows it. The long-deferred `TechRace`
plan archetype (doc 07 §2) is real now too: a tech-weighted AI kingdom raises a scribe's hut and
researches unprompted, purely from utility scoring, the same "wire the archetype real once its
system lands" pattern M23/M30/M31 each proved for diplomacy, military, and war. `unlocks` are
validated referentially but not yet enforced against `village.build`/`army.recruitUnit` — the
same "data now, active later" precedent M25 set for `garrisonCap`.

### War diplomacy (M31) — Phase 4 complete: war

Wars can now be declared, negotiated, and — critically — forced to end
(`packages/sim/src/game/diplomacy.ts`, GDD §10): `kingdom.declareWar` sets a formal `atWar` flag on
the same pairwise relation record opinion/pacts already live on, auto-breaking any active
non-aggression pact (holding one while declaring war *is* the betrayal) and costing less opinion
with a claimed **casus belli** than an unprovoked declaration. **War exhaustion** climbs a fixed
amount every day a war continues; at its cap, peace is **imposed unconditionally** — the roadmap's
"no forever-wars" guarantee, proven in the harness with two AI kingdoms that never voluntarily
de-escalate (`aggression: 0.95` on both sides) and still see their war forced to peace. Short of
that cap, `kingdom.proposePeace` evaluates through `evaluatePeaceDeal` — the identical
value-vs-threshold shape as M23's `evaluateDeal`, so a peace offer is exactly as ungameable as a NAP
proposal — with an optional flat **tribute** (gold) sweetening it; **ransom** stays out of scope
until Characters (M34). The AI wiring is intentionally light: the tactical manager declares war the
moment it marches on a target, and sues for a (likely-too-weak) tribute-free peace the moment its
strategic plan drops out of `MilitaryBuildup`/`ConquestWar` — the actual guarantee is the
unconditional exhaustion cap, not AI cooperation. Combat and siege hostility are unchanged: they
still run on M27/M30's pre-existing "no active NAP ⇒ hostile" gate, so `atWar` is a negotiable,
tracked diplomatic layer on top of the fighting, not a new prerequisite for it to start.

### AI at war (M30)

AI kingdoms fight now (`packages/sim/src/ai/military.ts`, doc 07 §2/§3/§5): the strategic planner
(M21) gains two real archetypes — **MilitaryBuildup** and **ConquestWar** — that emerge as a
weak→strong ladder purely from utility scoring (build up while under-strength, go to war once
strong AND advantaged) rather than an authored milestone sequence. Both stay at exactly 0 utility
wherever no military context is wired in — verified against a real regression caught while building
this: adding them un-gated briefly crowded `ExpandSettle` out of M24's own 8-kingdom fingerprint
test. Once `ConquestWar` is active, the **military manager** raises a barracks, recruits, assembles
an army, queues a basic defensive wall ring (**castle-building AI**, a fixed template — not doc
07 §5's terrain-adapted motte/concentric/ridge-line skeletons), and marches on the nearest known
rival — `siege.begin`/`siege.setTarget`/`siege.assault` against a castle, or nothing extra against
an open village (combat.ts's own proximity detection engages automatically, M27). The harness test
— "wars start & end; AI wins vs. passive baseline" — runs an aggressive kingdom against a pure-economy
one and confirms both a real war concludes (not a forever-stalemate) and the attacked kingdom fares
measurably worse than the identical kingdom left at peace.

### Sieges (M29)

Castles can now fall (`packages/sim/src/game/siege.ts`, GDD §7/§8): `siege.begin` **encircles** a
hostile castle, flipping the besieging army's stance to `siege` (armies.ts's fifth stance, inert
since M26 — its payoff). **Bombard** runs daily, not sub-ticked — sieges pace in days/seasons, not
combat rounds — chipping away at a targeted wall/gate/tower/keep's HP (siege-class units, e.g. the
new Catapult, count triple) until it's breached and demolished through the exact same code path a
player's own `village.demolish` uses, so castles.ts's enclosure rebuild fires with zero new
plumbing. **Assault** and **sortie** don't reimplement combat — they open a real combat.ts
engagement with `Engagement.casualtyMultiplier` cranked up for assaults, so "storming should be
bloody" (GDD §8) is one number, not a parallel resolver. **Starve**: an empty granary capitulates
the castle after `STARVATION_SURRENDER_DAYS` (a season) — the T objective, "siege pacing stats
within design bands", is this number matched directly against GDD §8's own pacing target. Winning
an assault or starving a castle out transfers ownership (`VillageOwner`, M22).

### Castles v1 (M28)

A castle isn't a new entity kind — it's what a **Village becomes** the moment its fortifications
close a loop (`packages/sim/src/game/castles.ts`, GDD §7): wall, gatehouse, tower, and keep are
ordinary `BuildingDef`s (a new `defense` block: hp, armor, kind) placed through the existing
`village.build` — no new command. The T objective, the **enclosure algorithm**, is a bounded
flood-fill: seed from the border of a search box around the village, flow through anything that
isn't a wall/gate tile, and whatever the flood never reaches is enclosed — gates block it exactly
like walls, a defended chokepoint, not a hole. `isCastle` and the defence graph are **derived**,
recomputed only when a defense-kind building completes or is demolished, never per-tick. This also
resolves **[OQ-3](docs/design/14-open-questions.md)** at its due milestone: 12 base content files
through M28, zero scripting needed — the DSL-only path holds, pending the real ≥90%-expressiveness
measurement at M32–M33.

### Field combat (M27)

Armies that meet now fight (`packages/sim/src/game/combat.ts`, GDD §8): any two hostile armies
(different kingdoms, no active non-aggression pact) within a tile of each other lock into an
**Engagement** and resolve in **combat sub-ticks** — 4 per tick, capped at 12 ticks, matching the
GDD's "typically 2–12 ticks". **Morale is the true HP**: each sub-round, aggregate attack (scaled
by a soft counter — spearmen vs. cavalry — and the attacker's own morale fraction) divides into the
defender's aggregate defense and comes off morale, spread by count share; a unit under 20 morale may
**rout** — it survives and leaves the army, "rout, not annihilation" — while a slice of the same
damage also costs real **casualties** (`Unit.count`, never returned, the same one-way loss as
M26's starvation attrition). `army.withdraw` lets a side disengage early. The T objective — auto vs.
manual parity ±10% — holds structurally: `battle.autoResolve` calls the exact same sub-round
function in a tight loop instead of across real ticks, so a 150-battle statistical comparison is a
regression guard, not a tuning exercise. "Battle UI v1" is the existing debug-HUD command injector,
same precedent as every mechanics milestone since M19 — no dedicated panel yet.

### Movement & supply (M26)

Armies can now go somewhere (`packages/sim/src/game/armies.ts`, `packages/sim/src/nav/hpaStar.ts`):
`army.moveTo` routes them with a **hierarchical HPA\*** pathfinder — a chunk-graph built once per
session so a cross-map order never re-walks the whole terrain — and marches at
`terrain × season × fatigue` (spring mud and winter snow slow everyone down, doc 08 §3). Arrival
auto-garrisons; `army.setStance` sets any of the five GDD stances, though only `garrison` and
`march` do anything until hostile kingdoms (M31) and castles (M28) give the rest meaning. **Supply**
draws from an army's carried stock first, then **forages** the nearest friendly village in range —
a real stockpile cost, not a free depot — and an army that finds neither climbs **fatigue**;
sustained at max, it triggers **attrition**: soldiers are actually lost, never returned to any
cohort, the deliberate mirror of M25's population-conservation property. The T objective —
pathfinding budget ≤20% at 200 armies — is a benchmark test: the hierarchical router resolves 200
army-scale routes roughly 400× faster than the naive whole-map A* it replaces.

### Military basics (M25) — Phase 4 begins: war

The realm can now raise arms (`packages/sim/src/game/military.ts`, GDD §6): a **Barracks**
(`base:building.barracks`) trains **militia**, **spearmen**, and **archers** (`defs/units/core.json5`)
— recruitment is barracks-gated and atomic, checking population (a named cohort), resources
(equipment), and gold together before deducting any of them, exactly like village placement and
edicts before it. Population removed at recruitment is conserved: a disbanded unit — trained or
not — always returns its full popCost, the M25 T objective. **Training** advances hourly like
construction (`progress → complete`). **Upkeep** (wages + food) settles once a season through the
kingdom's existing gold ledger and the unit's home village stockpile; an unpayable unit **deserts**,
returning its population, the same way an unpayable edict lapses — real guns-vs-butter tension.
**Armies** are a lightweight `Unit.armyId` grouping (create/assign/disband) — no position, path, or
stance yet; those are Movement (M26). A newly-relevant office: the **Marshal** discounts unit
upkeep by martial skill, the same shape as the Steward's tax bonus.

### AI harness & nightly (M24) — Phase 3 complete: rivals awaken

The Phase 3 gate: a headless, 8-kingdom AI-vs-AI campaign runs 50 simulated years in one test
(`packages/sim/src/ai/multiKingdom.test.ts`), driving every kingdom (no inert "player" seat) through
the full M19–M23 stack at once — construction, planning, scouting, diplomacy — and asserting three
things doc 11/13 have named since M19 but nothing had measured yet: **no crash** across the full
run, **survival** (every kingdom's population stays above zero), and a **behavioural fingerprint** —
expansion-leaning kingdoms choose `ExpandSettle` measurably more often than economy-leaning ones,
the same regression-testing-character idea as the design doc's "Warmonger wars more than Builder"
example, standing in with mechanics that actually exist (war is M25; named personality archetypes
are M36). **Perf telemetry** sums each AI system's tick cost, amortized by how often it actually
runs, and checks it stays under doc 11's 30%-of-tick-budget ceiling at 8 kingdoms — genuinely
verified now, not just cited. "Nightly" stays the doc's testing-*tier* concept (TDD §13) rather than
a new scheduled workflow: the harness runs on every `npm test` (deliberately, ~15–25s of the ~27s
suite — the literal gate scenario, not shrunk to fit a speed budget).

### Diplomacy v1 (M23)

Kingdoms can now deal with each other, not just watch (`packages/sim/src/game/diplomacy.ts`):
**opinion** is pairwise (−100..100, per kingdom pair, not per kingdom), moved by **gifts** (gold ⇄
opinion, capped and cooled down so spamming small gifts can't inflate it — GDD §10's own "gift-spam
caps" concern) and **insults** (a flat penalty, same cooldown discipline), and **NAP/trade pacts**
are proposed and accepted or rejected by a **deal evaluator** — `accept if value ≥ threshold ×
trustFactor(opinion) × personalityMargin(weights)` (doc 07 §4), a pure function of opinion and
personality only, never of who's asking (the roadmap's "deal-value symmetry" test objective). Every
kingdom is fog-gated (M22): you can't gift, insult, or propose to a kingdom you haven't scouted.
`ForgeAlliance` — the strategic planner's fourth archetype, deferred at M21 pending this milestone —
is real now: an AI kingdom with a nearby, non-hostile, unpacted neighbor will propose a
non-aggression pact on its own initiative. Reputation, alliances, vassalage, and joint wars are
M35 "Diplomacy v2" — trade pacts have no real economic engine to plug into yet (no trade routes),
so their value is deliberately nominal, not faked depth.

### Multiple kingdoms & borders (M22)

`kingdom.ts`'s long-deferred multi-kingdom retrofit lands, additive and opt-in
(`registerKingdomGameplay(..., { kingdomCount })`, default 1) — the `terra-demo` golden replay's
RNG draws and component set stay byte-identical, since `kingdomCount === 1` is the exact
single-kingdom path the module always ran, not a new path that happens to match. N kingdoms are
founded at **fairness-checked** start sites (`packages/sim/src/worldgen/fairPlacement.ts`):
deterministic angular sectors around the map center, scored by the same site scorer M15's settlers
use, retried at a wider radius if the spread of scores exceeds doc 13's ±15% band. Each AI kingdom
gets its own village, M20's construction manager, and M21's strategic planner — real opponents for
the first time. **Scouting** is Chebyshev-distance fog reveal (`packages/sim/src/ai/scouting.ts`) —
the stand-in doc 07 §6 always intended for a system with no military units yet — and the **fog
UI** is a map overlay (territory tint per kingdom, a dark punched-out-as-you-explore layer for
unrevealed tiles), mirroring the existing road-overlay pattern in the renderer exactly.

### AI strategic planner v1 (M21)

A weekly utility-scoring layer above M20's construction manager (`packages/sim/src/ai/planner.ts`):
each AI kingdom scores three real plan archetypes — `DevelopHeartland`, `ExpandSettle`, `Recover` —
against its own considerations (welfare, unmet construction, settler readiness, crisis) and a small
personality-weights object, picks the best with **hysteresis** (a bonus for staying on the current
plan so it doesn't flip week to week), and publishes a `ai.planChosen` decision-log event every
single evaluation — legible by construction, the doc 13 Risk R1 "why?" requirement met from day
one. Choosing `ExpandSettle` submits a real `village.sendSettlers` command through the same bus a
player uses. The rest of doc 07 §2's archetype list (`ConquestWar`, `ForgeAlliance`, `TechRace`, …)
needs systems that don't exist yet — they're deferred to the milestones that build those systems,
not faked as stub utilities that would undermine the plan-switch-stability test itself.

### AI economy & construction manager (M20)

The first AI that actually keeps a village alive: `packages/sim/src/ai/manager.ts`'s daily
construction manager detects unmet **settlement needs** (food, housing — an extensible evaluator
list, not hardcoded) and queues buildings through `village.build`, the identical command path a
player uses. The test objective is literal: a standalone-harness village survives 20 years
(172,800 ticks) completely unaided. Verified against the real content defs: farms have zero
ongoing input cost, so keeping food-production and housing capacity in step with population is
sufficient — no storage/production-chain depth is load-bearing for survival, so none was built
prematurely.

### AI kernel & sensors (M19) — Phase 3 begins

The foundation the whole AI arc sits on (`packages/sim/src/ai/`): a **fog-of-information** query
wrapper (`fogQuery.ts`) that's the *only* sanctioned way to read entities outside your own kingdom
(enforced by a static test, not just convention), a **knowledge model** (`knowledge.ts`) of
per-subject beliefs that decay in confidence and are read only through
`believedValue = value ± noise(1−confidence)` — deterministic noise from a PRNG fork, never the
authoritative value directly — and a **brain-scheduling** skeleton (`brain.ts`) running lightweight
"shadow" AI kingdoms on the doc 08 §9 cadence (daily sensors/appraisal, weekly strategy). Real
situation appraisal and plan scoring are M20/M21; M19 proves the scaffolding and the access
discipline it all has to obey.

### UI pass 1 (M18) — the game is now played, not injected

`@crowns/ui` wakes up (doc 05 §7): a dependency-free **panel framework** (PanelHost + toolbar,
left dock), a **UI Store** fed exclusively by snapshot deltas and GameEvents, and a
**notification queue** implementing GDD §1's severity tiers — info toasts, attention alerts
(every refused order now surfaces by name), and **urgent-pause**: a starving village stops the
clock. Repeats throttle per (event, subject) so a famine nags daily, not hourly. The ui package
speaks `@crowns/protocol` ONLY (TDD §3 boundary, lint-enforced): the sim worker projects the
DefinitionDatabase into a display-ready **catalog** in the full snapshot.

Three panels ship: **Village** (vitals, goods, tax-rate select, tier upgrade — click any building
to focus its village), **Build** (every placeable def with costs, tier-locked entries greyed;
click to arm, click the map to place — shift keeps placing, Esc cancels), and **Kingdom**
(treasury, per-edict enact/repeal). Every control issues real commands through the same bus as
the debug injector — the M9 panel (backtick) still works, untouched, for the sandbox path.

### Save/load v1 (M17)

Campaigns persist (TDD §8). A save is plain JSON: header (format, game version, seed, tick) plus
**schema-versioned sections** — the kernel (tick, every PRNG stream in canonical form, issuer
sequences, pending commands, the executed log), the whole ECS world (allocator, per-component
SoA + tagged cold-value codec), and roads. Worldgen re-derives from the seed; derived caches
(placement occupancy, route caches, the kingdom's modifier board) rebuild in afterLoad hooks.
Loading composes a FRESH session from the save's seed and hydrates it — same registrars, same code
paths, no second rulebook.

The T objective holds: **save → load → resave is hash-identical AND byte-identical**, then both
sessions evolve in lockstep — mid-walk settler parties arrive on schedule, laden haulers deliver,
edicts keep billing. Old saves migrate through per-section **MigrationChains** (pure v→v+1 steps,
holes are hard errors), and the **save corpus** (TDD §13) is live: `fixtures/saves/` holds a real
tick-500 campaign that CI hydrates and resumes to a pinned hash on every PR.

In the browser: 💾/📂 buttons (slot via IndexedDB, in the sim worker — no main-thread stall),
⇩/⇧ export/import as a `.crown` file, and an **autosave ring** (3 slots) that fires on every
season boundary. Corpus tooling: `node packages/tools/dist/save-corpus.js record|verify`.

### Kingdom layer (M16)

The realm has a crown: a kingdom entity with a gold **treasury**, and the HUD's new coin line —
`⛁ 320 (+8.3/day · tax 8.3 − upkeep 0)` — is fed by the daily roll-up (doc 08 slot 12). **Taxes**
convert village prosperity (installed production value × staffing × a happiness factor) into gold
at five rates (`village.setTaxRate`, 0–4); higher rates bleed happiness daily, which shrinks the
factor — the punitive take provably decays from its own peak (GDD §2's self-defeating curve).
Every gold movement is a **ledger** entry, and the T objective holds to the coin:
`treasury === starting gold + Σ ledger`, through rate swings, edicts, and funerals.

**Edicts v1** are content (`defs/edicts/*.json5`, a new mod-layerable kind): Modifier bundles with
daily upkeep — Harvest Festival (+5 joy drift), Corvée Labor (×1.15 production, −4 joy), Grain
Reserves (×0.5 spoilage) — enacted/repealed by command, capped at 3, and LAPSING by event when the
treasury can't pay. All effects flow through one **StatModifiers board** that economy and
population read (doc 06: "all numbers flow through Modifiers").

**Advisors v1**: a court of six named notables (doc 06 §6 slice — skills 0–20, deterministic from
the campaign seed). Appoint them (`kingdom.appoint`): a Steward multiplies tax yield by skill, a
Chancellor discounts edict upkeep, a Marshal discounts unit upkeep by martial skill (M25); Scholar
holds the seat for M32. Advisors draw 2 gold/day, age yearly, and die — vacating the office by
event, with the books still balanced.

### Multi-village & founding (M15)

The map is no longer a one-village world. `village.sendSettlers` (injector-ready:
`{ "villageId": …, "x": …, "y": …, "name": "Weststead" }`) deducts a settler party — 8 children,
20 adults, 2 elders, carrying wood/stone/food — and the party WALKS: a real entity on the path
service, roads and all. Founding happens on **arrival through the same rulebook as genesis**, and
the site is validated again there — claimed en route, the party turns around and re-merges at
home, people and cargo conserved to the decimal (TDD §13). Sites are ranked by the pure **site
scorer** (GDD §13: farmable tiles ×3, open ground, bounded water bonus) — genesis now founds
Firstholm on the best-scoring site near map centre, and the same scorer will drive AI settler
dispatch (doc 07).

**Tiers:** `village.upgrade` raises Hamlet → Village when the village earns it — population ≥ 60,
4 distinct completed buildings, wood 60 + stone 40 (consumed atomically), happiness ≥ 60 — every
missing requirement rejects by name. Tier 2 widens the radius (12 → 16) and unlocks tier-gated
buildings via `requires.villageTier` (doc 06): the **tavern** is the first, its joy aura lifting
village happiness (flat bonus until needs v2). Tiers 3–4 (Town, City) arrive with later phases.

### Logistics (M14)

Storage is now **local-first** (GDD §3): recipes fill each building's own inventory, and goods
only reach the village stockpile by CART. Haulers are real entities — adults claimed from the same
jobs solver as builders and farmhands (capped at 20% of the pool), spawned at the centre, visibly
walking pickup and delivery routes. The job board matches idle haulers each tick in stable order,
counting in-flight claims so two carts never chase one crate; the path service is a deterministic
4-neighbour A* over `terrain movementCost ÷ road factor` with a route cache invalidated on road
changes. Roads (`village.buildRoad`, 1 stone/tile — try the injector) multiply cart speed ×1.5:
the tests prove a cart-limited village **starves on mud and eats on pavement** — distance is a
real cost, exactly as the docs demand. Conservation still holds to 1e-9 at village scope
(stockpile + inventories + carried); hauling redistributes, never creates.

Throughput bench (doc 11 §2 — target 1,200 active haul jobs, stress 2,000):

```bash
node packages/tools/dist/bench-haul.js            # 64 villages × 20 haulers = 1,280 carts
node packages/tools/dist/bench-haul.js 100 20     # 2,000-cart stress ceiling
```

Reference result (CI-class hardware): ~0.6 ms/tick at 1,280 carts, ~0.9 ms at 2,000 — against the
10 ms tick budget.

### Production chains (M13)

The 3-tier economy is live (GDD §3): **wood (raw) → sawmill → planks (processed) → workshop →
tools (finished)**. Buildings define real recipes — inputs and outputs in units/day — and the
hourly production system scales each recipe by ONE batch fraction,
`min(workforce efficiency, input availability, output headroom)`, so a starved or clamped recipe
consumes nothing: no inputs vanish without outputs, ever. Food now **spoils** (3%/day) — granaries
matter — and `village.setStockLimit` (try it in the M9 injector) caps any resource per village
below its storage capacity.

Every unit moved is accounted in the **resource ledger**: produced, consumed, eaten, spoiled, or
spent on construction. The conservation invariant (doc 08 §4) is property-tested — fuzzed building
compositions with mid-run limit/build commands must reconcile stock deltas against ledger flows
over every window, to 1e-6. Watch the HUD: `Firstholm: pop 47 · food 118 · joy 64 · wood 68 ·
planks 82 · tools 100` — and when the workshop runs the quarryless village out of stone, it stalls
honestly instead of conjuring tools.

### Population & the first playable loop (M12)

Firstholm now LIVES: 47 settlers (cohort math — children/adults/elders as f64 counts) eat
`0.1 food/person/day`, staff the farm through an hourly jobs solver (builders claim labor first,
then production, in stable order), and construction is labor-gated — no adults, no progress. The
HUD shows daily vitals: `Firstholm: pop 47 · food 118 · joy 64`. Births scale with food security
and shelter; children mature, adults age, elders pass — a fed village grows ~4%/year with a sane
population pyramid (curve-tested over two simulated years).

**The famine floor** (GDD §4 death-spiral protection): when the granary empties, foragers hold the
fed fraction at 0.4 — mortality is elevated but BOUNDED. The test starves a village for a full
year: population declines without ever losing >1% in a day, holds above 30% of its start, and once
relief farms complete, the curve troughs and turns. Feed the village or watch it wither — the loop
the whole design builds on is now playable.

### Village core (M11)

The demo now founds **Firstholm** at the best open site near map center and builds itself out:
houses, a well, a granary, a farm — watch the construction bars fill (translucent plates turn solid
on completion). All building defs and resources (10 and 5 since M13) live in `content/base/defs/`; placement runs
through ONE validator shared by commands, scripted genesis, and the future AI (no cheating
placements, Engine §5): terrain-tag gating per footprint tile, river blocking, occupancy, village
radius, and center spacing. Costs are reserved atomically at placement — insufficient stockpile
rejects with `insufficient base:resource.wood (10/30)` and touches nothing.

Try the M9 injector (backtick): `village.build` with
`{ "villageId": <click the village center to find its id>, "def": "base:building.house", "x": …, "y": … }` —
rejections surface as `village.rejected` events with the exact reason. Buildings are clickable and
inspectable like any entity.

### Mod loader & validation console (M10)

Multi-mod layering per doc 09 is live. Manifests gate on game version (semver-lite), dependencies
resolve topologically (then `loadAfter`, then user order), cycles and conflicts disable mods with
named reasons, later layers REPLACE same-id defs, and `patches/*.json5` apply surgical ops
(`set` / `mergeAppend` / `remove`) that survive base-game updates. Merged results re-validate —
a patch that breaks a def is fatal with a mod-prefixed path. The load report names every override
winner and patch author.

```bash
node packages/tools/dist/mod-check.js                    # validate base content
node packages/tools/dist/mod-check.js --with-examples    # layer the shipped example mod
node packages/tools/dist/mod-check.js --watch            # designer loop: revalidate on save
```

`content/examples/autumn-realm/` is living documentation: one override (marsh → Peat Bog) and one
patch set (autumn tints on forest/grassland) — kept loadable by a test forever.

### Debug panel (M9)

Press **`** (backtick) in the browser build to open the debug panel: a per-system cost table with
EMA bars (telemetry measured via an *injected* clock — the sim never reads wall time itself, and a
test proves state hashes are identical with telemetry on or off), a live entity inspector
(click any creature; values refresh ~4 Hz; shift-click shows the tile's terrain def), and a command
injector that submits arbitrary commands through the same bus as everything else — injected
actions land in the command log and replay deterministically. Try `debug.spawn` with
`{ "x": 190, "y": 190, "count": 20 }`. This panel is the seed of the sandbox editor (GDD §17).

### Content & Mod Zero (M8)

All terrain is defined in `content/base/defs/**.json5` — the base game ships as **Mod Zero**
(doc 09), parsed and validated by the dependency-free validator core in `@crowns/data` at every
session start. Errors are path-precise ("defs/terrain/water.json5 [1].colors.base: expected
#rrggbb color"); integrity checks enforce unique ids and exact biome-code coverage. Edit a color in
the defs and the world changes — no engine code involved. `npm run gen:content` re-embeds the files
(source of truth stays on disk; dev hot-reload replaces embedding at M10).

The golden scenario `terra-demo` pins worldgen + content pipeline + kernel + ECS together in one
fixture. Chunk rendering now runs through a pure `ChunkTracker` whose dirty-rebake contract
(invalidate a tile → exactly that chunk rebakes, only while visible, dirtiness surviving off-screen)
is fully unit-tested.

### Worldgen preview & bench (M7)

```bash
node packages/tools/dist/worldgen-preview.js 42 medium continent   # ASCII map + stats
node packages/tools/dist/bench-worldgen.js                         # timings vs doc 11 §4
```

The pipeline (`packages/sim/src/worldgen/`) is pure `seed + params → WorldDef`: coordinate-hashed
fBm heightmap with landmass shaping (continent / archipelago / highlands), latitude+lapse climate
with coastal-humidity BFS, biome classification, and priority-flood depression filling so every
river traced from a highland spring provably reaches the ocean or merges into a network (monotone
descent is property-tested). Seed 42/medium carries a **pinned golden hash** in the test suite —
any stage change trips it. Large maps generate in ~0.5 s against the 10 s budget.

### Golden replays (M5)

```bash
npm run replay:verify        # verify committed fixtures — CI runs this on every PR
npm run replay:record        # re-record after an INTENTIONAL hash-affecting change
```

Fixtures live in `fixtures/golden/`. A failure names the first divergent tick, bracketing the
regression to a `hashEvery`-tick window. Scenario recipes live in `packages/app/src/scenarios.ts`
and may never change silently — re-recording must be called out in the PR.

**Cross-engine sentinel (OQ-10):** `packages/tools/browser-harness/index.html` runs the identical
compiled modules in a browser via import map (no bundler) and verifies the same fixtures; CI runs
it under Chromium and Firefox. Locally: `python3 -m http.server 8080` from the repo root, then open
`http://localhost:8080/packages/tools/browser-harness/`. Any engine hashing differently from the
committed Node fixtures triggers the OQ-10 fixed-point migration decision (docs/design/14).

Requires Node ≥ 20. Tests use the built-in `node:test` runner — a deliberate deviation from the
TDD's Vitest default for the headless packages: zero dependencies, identical assertions, and it
runs in constrained/offline environments. Vitest is still planned where it earns its keep
(browser-mode tests for `render`/`ui`, from M6). `packages/core/src/node-shims.d.ts` exists only
for offline bootstrap; once `@types/node` is installed it can be deleted.

## Determinism rules (short form — full contract TDD §5)

1. All randomness through `Rng` (`@crowns/core`), forked per system by stable string keys.
2. No wall-clock, no unordered-map iteration over hashed keys — use `iterSortedNumeric`/`iterSortedLex`.
3. The sim is a pure function of (state, commands); every mutation enters via a Command.

## Contributing workflow

Branch → PR → CI green (typecheck, lint, tests) → review. Golden-replay hash changes (from M5 on)
must be intentional and called out in the PR description. Temporary code carries a `DEBT(Mxx)` tag;
the count may not grow across a phase (roadmap policy).
