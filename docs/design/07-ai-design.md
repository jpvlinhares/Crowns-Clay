# 07 — AI Design Document

**Prime directive:** AI decisions emerge from *game state × personality × memory* through utility
evaluation — never from scripted behaviour trees keyed to story beats. An AI kingdom is a player
substitute: it perceives through the same (fog-limited) queries, and acts only through the same
Command Bus as a human (Engine §0, §3).

## §1. Decision-Making Architecture (overview)

```
                         ┌────────────── per AI kingdom ───────────────┐
  Game state ─queries─►  │ SENSORS (fog-filtered) ─► KNOWLEDGE MODEL   │
  GameEvents ─────────►  │        │                        │           │
                         │        ▼                        ▼           │
                         │  SITUATION APPRAISAL ◄── MEMORY & GRUDGES   │
                         │        │  (threat, opportunity, economy)    │
                         │        ▼                                    │
                         │  STRATEGIC PLANNER — scores Plan archetypes │
                         │        │  (utility × personality × memory)  │
                         │        ▼ active Plans (1 major + minors)    │
                         │  DOMAIN MANAGERS                            │
                         │   Economy · Construction · Military ·       │
                         │   Diplomacy · Research                      │
                         │        │ (each turns plan goals into        │
                         │        ▼  concrete tasks)                   │
                         │  COMMAND EMISSION ─► Command Bus            │
                         └─────────────────────────────────────────────┘
```

Layers run at staggered cadences (doc 08 §9): appraisal daily, strategic re-planning weekly (or on
alarm events like "war declared"), managers daily, tactical combat per combat sub-tick.

**Why utility scoring (not behaviour trees / FSMs / GOAP-pure):** utility composes personality
weights naturally, degrades gracefully as systems are added, is data-tunable (doc 09), and its
inputs/outputs are loggable — every decision can answer "why?" in the debug inspector (a hard
requirement: un-debuggable AI is unshippable AI). Plans add just enough GOAP-like commitment to
prevent utility dithering.

## §2. High-Level Strategic AI

- **Plan archetypes** (data-defined, extensible): `DevelopHeartland`, `ExpandSettle`,
  `EconomicAscendancy`, `MilitaryBuildup`, `ConquestWar(target)`, `PunitiveRaid(target)`,
  `FortifyBorder(direction)`, `TechRace(branch)`, `ForgeAlliance(target)`, `PrepareVictory(type)`,
  `Recover`.
- Each archetype exposes `utility(state, knowledge, personality, memory) → score` plus resource
  reservations and manager goal-sets. The planner keeps **one major plan** (hysteresis: switching
  cost term prevents flip-flopping) and up to two minor plans.
- Utility inputs are normalised 0–1 **considerations** (own economy strength, relative military
  power vs. each neighbour *as believed, §6*, border threat, tech position, treasury trend, unrest,
  victory progress of all kingdoms) combined multiplicatively with personality weights
  (`AIPersonalityDef.weights`, doc 06 §7) and plan biases.
- Long-term commitment: plans carry **milestone ladders** (e.g., ConquestWar: secure ally → stockpile
  supplies → raise army to 1.3× believed target strength → declare with casus belli → siege plan).
  Progress persists in save state; plans survive save/load.

**M21 scoping note:** ships exactly 3 real archetypes — `DevelopHeartland`, `ExpandSettle`, `Recover`
(`packages/sim/src/ai/planner.ts`) — as an extensible array (`DEFAULT_PLAN_ARCHETYPES`), mirroring
M20's `NeedEvaluator` list. The rest of the roster above needs systems that don't exist yet
(`ConquestWar`/`PunitiveRaid`/`MilitaryBuildup`/`FortifyBorder` → military M25; `ForgeAlliance` →
diplomacy M23; `TechRace`/`PrepareVictory` → tech M32/victory M37) — shipping them as stubs
returning a constant utility would be untestable fake behaviour, so they're deferred rather than
faked. `utility(considerations, weights)` here uses a minimal in-code `PersonalityWeights` (3 axes:
`expansion`, `economy`, `riskTolerance`) — **not** the content-defined, mod-loadable
`AIPersonalityDef` of doc 06 §7 (7 tuned archetypes, preferences, planBiases, taunts, perturbation),
which is explicitly M36. Hysteresis is a fixed additive bonus (`HYSTERESIS_BONUS = 0.15`) applied to
the current plan's score before argmax, not milestone ladders (none of the 3 shipped archetypes has
one; that mechanism awaits `ConquestWar`). Persisted state is just `{plan, adoptedTick}` (a plain SoA
component) — per-evaluation scores are ephemeral, published each week via a `GameEvent`
(`ai.planChosen`) as the decision log, not stored. Standalone and single-village-bound like M20 (not
routed through `brain.ts`'s shadow-kingdom/fog machinery, not wired into `terra.ts`/`scenarios.ts`).

**M30 scoping note:** `MilitaryBuildup` and `ConquestWar` land (`packages/sim/src/ai/military.ts`
executes them; `PunitiveRaid`/`FortifyBorder` stay deferred — two archetypes prove the ladder
without doubling the surface area). `PersonalityWeights` gains `aggression` (default 0.5, like
`diplomacyTrust`); `Considerations` gains `militaryStrength` (own committed troops, normalised
against `MILITARY_STRENGTH_NORM = 40`) and `relativeAdvantage` (own vs. the strongest known rival's
strength). Both are computed from PLAIN committed-troop counts, not "believed" strength through
`brain.ts`'s Knowledge Model — same standalone simplification as M21/M23. Inert defaults matter
here: no `military` context wired in ⇒ `militaryStrength = 1` ("nothing to build") and
`relativeAdvantage = 0` ("no case for war"), so both archetypes score exactly 0 wherever the war
stack isn't composed — verified against a real regression (adding them un-gated initially crowded
out `ExpandSettle` in M24's own fingerprint test). The ladder itself is emergent from utility scoring
(`MilitaryBuildup` wins while weak, `ConquestWar` overtakes it once strong AND advantaged) rather
than doc 07 §2's authored milestone ladder (secure ally → stockpile → raise army → declare →
siege) — deferred, same spirit as M21 shipping hysteresis instead of ladders for its 3 archetypes.

**M32 scoping note:** `TechRace` lands (`packages/sim/src/ai/research.ts` executes it;
`PrepareVictory` stays deferred to Victory, M37). `PersonalityWeights` gains `tech` (default
0.5); `Considerations` gains `researchOpportunity` — fraction of the tech tree still unknown
(`1 - coverage`), read from `game/research.ts`'s `ResearchState` via the same
plain-committed-count convention M30 used (not "believed" through the Knowledge Model). Inert
default: no `research` context wired in ⇒ `researchOpportunity = 0` ("nothing to race toward"),
so the archetype scores exactly 0 wherever the research stack isn't composed (M20/M21/M23/M30's
existing tests, unchanged). `TechRace`'s utility rewards a strong economy AND real headroom left
in the tree together — a kingdom that already knows everything has nothing left to race for, the
same "fades as its own precondition is satisfied" shape `DevelopHeartland` already has via
`growthHeadroom`.

## §3. Tactical AI (battles & manoeuvre)

- **Operational layer** (map): army movement scored by objective value × path risk (believed enemy
  strength along route, supply reach, season); retreat thresholds from personality riskTolerance ×
  morale; relief-army logic for own sieges.
- **Battle layer:** the combat resolver (Engine §4) accepts an order policy; AI policy scores the
  small order vocabulary (advance/hold/flank/target/withdraw) per combat sub-tick from line status,
  morale differentials, terrain, and breach opportunities. The same policy object with neutral
  personality *is* the auto-resolver — guaranteeing GDD §8 parity.
- **Siege conduct:** choose bombard vs. starve vs. assault by expected-cost model (time value from
  strategic plan urgency vs. casualty estimate from defence graph state).

**M30 scoping note:** `packages/sim/src/ai/military.ts`'s tactical policy is a straight-line v1 —
nearest known war target, `army.moveTo` (M26 HPA*), `siege.begin`/`siege.setTarget`/`siege.assault`
the moment a breach opens (castle targets), or nothing extra at all for a non-castle village
(combat.ts's own proximity detection, M27, engages automatically once armies are adjacent — no
separate "attack" order exists). No expected-cost model, no path-risk scoring, no relief-army logic,
and no retreat threshold: those all need levers this milestone doesn't add — the "battle layer"
order vocabulary beyond `withdraw` (advance/hold/flank/target) isn't a resolvable choice in
combat.ts yet (M27's own deferral), so there is nothing for a policy to score between. One action
per day, in priority order (mirrors M20's build-one-per-day anti-spam pattern): barracks → recruit →
assemble/garrison → fortify → march/siege.

**M31 delta:** `AiMilitaryOptions` gains an optional `diplomacy` hook (`AiWarDiplomacy`) tying
tactics to `game/diplomacy.ts`'s new war state. Marching on a target the kingdom isn't already
formally at war with issues `kingdom.declareWar` (`casusBelli: true` — this v1 has no real casus-
belli tracking of its own, so a deliberate `ConquestWar` commitment is treated as "claimed just
cause", same trust-the-input shape as every other AI-issued command) the moment that target is
picked, ahead of the march/siege order. The reverse lever — de-escalation — fires when the
strategic planner drops out of `MilitaryBuildup`/`ConquestWar` entirely (economy won out, or the
war looks lost): the manager sues for a tribute-free `kingdom.proposePeace` with every kingdom it's
still at war with. It's a weak offer (`evaluatePeaceDeal` needs meaningful exhaustion or tribute to
clear threshold) and may well be rejected, but that's fine by design — `diplomacy.ts`'s exhaustion-
driven FORCED peace is the actual "no forever-wars" guarantee (doc 06 §10, doc 08 §8), not this
AI's cooperation. Combat/siege engagement itself is unchanged by any of this (still the pre-
existing "no active NAP ⇒ hostile" gate, M27/M30) — `atWar` layers negotiable, tracked diplomatic
state on top, it isn't a new prerequisite for the fighting to start.

## §4. Economic & Event-Response AI

- **Economy Manager** turns plan reservations into targets: food security first (N seasons of
  reserve by personality risk), then plan-driven chains (war → weapons/supply chains; ascendancy →
  luxury/trade). Uses the same ledgers/price data the player sees; responds to shortage events by
  re-prioritising jobs, adjusting stock limits, buying via trade.
- **Deal evaluation (diplomacy manager):** every treaty clause has a value function (gold-equivalent
  utility to this kingdom given state/plan); accept if `Σ(value received) ≥ Σ(value given) ×
  trustFactor × personality margin`. This one mechanism powers proposals, counter-offers,
  ultimatum responses, and ransom haggling.
- **Event choices:** `EventDef.choices.aiScoreHints` + effect simulation (apply effects virtually,
  score resulting state) — AI answers content events in-character.

**M23 scoping note:** ships pairwise **opinion**, **gifts/insults**, and **NAP/trade pacts** only
(`packages/sim/src/game/diplomacy.ts`) — reputation (global, §7), alliances, vassalage, and joint
wars (doc 06 §10's fuller clause list) are M35 "Diplomacy v2". `DiplomacyState` is a plain class
keyed by kingdom-EntityId pair (relational data doesn't map onto ECS's entity-component model),
folding into `stateHash()` via `kernel.addHashSource` like `RoadGrid` — mutated only through
kernel-registered commands (`kingdom.sendGift`, `kingdom.sendInsult`, `kingdom.proposePact`,
`kingdom.breakPact`), fog-gated by M22's `FogRegistry` (a kingdom can't act toward one it hasn't
scouted). The deal-evaluator formula above is made concrete as
`trustFactor(opinion) = clamp(1 - opinion/200, 0.6, 1.4)`,
`personalityMargin(weights) = 1.2 - weights.diplomacyTrust * 0.4`, and a nominal, opinion-scaled
pact value (`napValue`/`TRADE_VALUE`) rather than a computed economic gain — NAP/trade pacts have
no real economic or military effect yet (no trade routes, no war). `evaluateDeal` is a pure
function of (opinion, pact type, weights) only, never of "who is asking" — the roadmap's
"deal-value symmetry" test objective. Gifts/insults have an explicit anti-spam cooldown (GDD §10:
"gift-spam caps") — a repeat within the cooldown window costs gold as normal (gifts) but
contributes zero additional opinion change; every attempt (even a no-op one) refreshes the
cooldown clock, so spam can't escape it by attempting more often. `PersonalityWeights` (planner.ts,
M21) gains an optional `diplomacyTrust` axis (default 0.5); `ForgeAlliance` (§2's 4th archetype,
previously deferred pending this milestone) is now real, scored by a new `allianceOpportunity`
consideration that's inert (always 0) without a wired `diplomacy` context — additive, no M21 test
changes behaviour.

**M31 scoping note:** ships **casus belli**, **peace deals**, and **war exhaustion**
(`kingdom.declareWar`, `kingdom.proposePeace`, `evaluatePeaceDeal`) — **ransom** (doc 06 §10's
`Clause.ransom{characterId,amount}`) stays Character-scoped and out of scope until M34; `tribute`
(a flat one-time gold transfer, part of `kingdom.proposePeace`'s payload) is this milestone's
stand-in. `atWar`/`warExhaustion` join the SAME `DiplomaticRelation` record opinion/pacts already
live on, not a separate object. `evaluatePeaceDeal(exhaustion, tribute, weights)` is pure — same
"never who's asking" symmetry guarantee as `evaluateDeal` — and war exhaustion accrues on a fixed
daily cadence (doc 08 §2 row 16's first real cadence system) regardless of whether either side ever
proposes anything: at `FORCED_PEACE_EXHAUSTION` peace lands unconditionally. That unconditional
cap — not any AI accepting a deal — is what makes "no forever-wars" a guarantee rather than a
tendency; verified in the harness with two kingdoms that never voluntarily de-escalate (both
`aggression: 0.95`) and still see their war forced to peace.

**M32 scoping note:** `packages/sim/src/ai/research.ts`'s manager is a straight-line v1 like
M30's tactical policy — one action per day, only while `TechRace` is the active plan: raise a
scribe's hut if the village has none, else start the CHEAPEST currently-available tech
(`ResearchGameplay.availableTechs`, already era/prerequisite-gated) if nothing is active. No
"best tech" value scoring beyond cost — a real value function (branch fit, unlock relevance to
the current plan) is deferred, same spirit as M25's cheapest-fallback recruit order. Diffusion
(`knownByNeighbor`, game/research.ts) is wired fog-gated in the harness: a tech already known by
any DISCOVERED rival costs less, the same catch-up mechanic GDD §9 calls for, using M22's
existing `FogRegistry` rather than a new discovery channel.

**M33 scoping note:** ships exactly the bullet above — `registerAiEventAnswering`
(`packages/sim/src/ai/events.ts`) scores every pending event's choices as
`Σ aiScoreHints[axis] * weights[axis]` over shared axis names (an unscored axis defaults to
neutral 0.5, same "no opinion" default `PersonalityWeights`'s own optional axes already use) and
submits `event.choose` for the top scorer — no effect-simulation step (doc 07's "apply effects
virtually, score resulting state" is a fuller model than one milestone's scope; scoring the
content-authored hints directly is the v1 slice, same "data now, active later" spirit as M25's
`garrisonCap`). A choice whose requirements aren't met is simply rejected and retried unchanged
next day — an acceptable v1 gap (documented, not silently swallowed): a mis-scored choice can sit
rejected indefinitely rather than falling back to a second-best option.

## §5. Construction AI

- Shares the player's placement validator (one code path, no cheating placements). Pipeline:
  **need detection** (housing pressure, service gaps, recipe bottlenecks from economy manager) →
  **site scoring** per candidate tile (terrain fit, adjacency, road distance, aura coverage,
  future-expansion reservation) → build queue respecting plan reservations.
- **Castle planning:** template-based skeletons (data-defined castle layout archetypes: motte,
  concentric, ridge-line) adapted to local terrain by the site scorer, then upgraded incrementally —
  produces believable, terrain-aware castles without a full architectural solver (Risk R1
  mitigation).
- Village founding: settler dispatch scored by start-site scores (same worldgen scorer, §GDD 13)
  × distance × threat.

**M20 scoping note:** the construction manager ships as an extensible **settlement-needs evaluator**
system (`packages/sim/src/ai/needs.ts`): a `NeedEvaluator` returns a capacity ratio (actual/desired)
plus a preference-ordered candidate building list, and `chooseBuildTarget`
(`packages/sim/src/ai/manager.ts`) consumes any list of these generically — adding a future need
(storage, production-chain bottlenecks, logistics, maintenance, military supply) is just another
evaluator, no rewrite of the scoring/build-queue/placement pipeline. Only **food** and **housing**
ship now: verified against the real content defs, farms have zero ongoing input cost, so keeping
food-production and housing capacity in step with population is sufficient for a village to survive
indefinitely unaided — storage/spoilage and production-chain bottlenecks are not load-bearing for
survival and are deferred until a milestone actually needs them. (A ledger-based bottleneck check was
considered and dropped: `ResourceLedger.of()` returns cumulative flows since the last `drain()`, not
per-day flows, so a naive `produced === 0` check would misbehave — fix that first if this is revisited.)
Site scoring is nearest-valid-tile via spiral search (`findBuildSite`, extracted from `terra.ts`'s demo
genesis pattern) — richer scoring (adjacency, road distance, aura coverage) is deferred; the manager
runs decoupled from M19's `AiKingdom`/`Knowledge`/fog machinery (a village managing itself needs no
fog) and is not wired into `terra.ts`/`scenarios.ts`, for the same golden-fixture-safety reason M19
stayed decoupled. Settler dispatch (M22 multi-kingdom) remains out of scope.

**M30 scoping note (castle planning):** `packages/sim/src/ai/military.ts`'s `planCastleRing` is a
FIXED small ring around the village centre — not doc 07 §5's terrain-adapted archetype templates
(motte/concentric/ridge-line); a v1 simplification, same spirit as M20 shipping only 2 of the
listed need types. It queues via the ordinary `village.build` command (one wall segment per day,
same anti-churn discipline as the food/housing evaluators), not through `chooseBuildTarget`'s
capacity-ratio model — a wall isn't a "need" with a satisfiable ratio, it's a fixed set of
positions to fill in. Only runs while `MilitaryBuildup`/`ConquestWar` is the active plan, after the
barracks and one recruit/army-assembly action for the day are already handled.

## §6. Knowledge Model (fog of information)

AI (and player UI) operate on **beliefs, not truth**:

```
KnowledgeFact { subject, kind: armyStrength|treasury|techLevel|villageState|intent,
                value, confidence: 0..1, lastUpdated: tick, source: scout|trade|envoy|battle|rumor }
```

- Facts refresh via contact (borders, trade routes, envoys, scouts, battles) and **decay in
  confidence** over time; stale beliefs cause honest AI mistakes (attacking a stronger foe it
  believed weak) — a deliberate emergence and difficulty lever (§10).
- The planner consumes `believedValue = value ± noise(1−confidence)` (deterministic noise from PRNG
  fork). No AI reads authoritative state directly — enforced by the query API surface (Engine §3).

**M19 scoping note:** M19 ("brain scheduling, knowledge model, fog of information") ships exactly
§1's sensor/knowledge layer and this §6 model, plus the cadence skeleton (staggered daily
sensors/appraisal, weekly strategic re-plan) — as lightweight "shadow" AI kingdoms (identity +
knowledge only, no ledger/edicts/economy) so fog has a foreign subject to observe without
retrofitting kingdom.ts's economy ahead of need. Situation appraisal, plan-archetype utility
scoring, and domain managers (the rest of §1's pipeline) are explicitly deferred to M20/M21; M19's
appraisal/strategic systems are scheduled no-ops. Real contact events (scout/trade/envoy/battle)
don't exist yet either — `FogRegistry.reveal()` is exercised directly by tests until those systems
land.

**M22 scoping note:** the `kingdom.ts` multi-kingdom retrofit finally lands, additive and opt-in
(`registerKingdomGameplay(..., { kingdomCount })`, default 1 — `terra.ts`'s zero-arg call stays the
exact single-kingdom code path it always ran, byte-identical `world.hash()`/RNG draws, so the
pinned `terra-demo` golden replay is untouched). A new `VillageOwner` component (defined lazily,
only when `kingdomCount > 1`) tags each village's owning kingdom; `StatModifiers`/`ledger` stay ONE
shared board across all kingdoms even when multi-kingdom — real per-kingdom economy boards are out
of scope (M20's manager/M21's planner never read treasury/ledger/edicts, so this is inert, not a
gap). **Kingdom placement fairness** (`packages/sim/src/worldgen/fairPlacement.ts`) reuses
`scoreSite` (settlers.ts) verbatim as the "start-site score" — deterministic angular-sector
candidate generation, zero RNG, fairness measured as `(max-min)/mean(scores) <= 0.30` (the ±15%
band as one comparison), widening the search radius in fixed steps on a miss and reporting the
achieved variance rather than throwing or silently swallowing it. **Territory** is deliberately
lightweight: on-demand nearest-owned-village-within-radius (`TERRITORY_RADIUS = 32`), not a
Voronoi/flood-fill — the GDD frames borders as a fog/knowledge concept, not a hard mechanical
boundary. **Scouting** is `FogRegistry.reveal()` gated by Chebyshev distance
(`SCOUT_REVEAL_RADIUS = 48`) between kingdoms' own villages, daily cadence — the doc's own
anticipated stand-in, not literal scout units (no military system until M25); the player's kingdom
is included in the same reveal loop as any AI kingdom, since fog UI is meaningless without the
player having its own fog state. **AI wiring**: M20's construction manager and M21's strategic
planner are reused unmodified in behavior — both gained an optional `id` suffix for their system
names (kernel enforces unique names) and the planner gained an optional `sharedPlanState` so one
`AiPlanState` component (already village-index-keyed) serves every kingdom. **Fog UI** is a map
overlay only (territory tint + dimmed/unrevealed tiles in `packages/render`), mirroring the
existing road-overlay pattern (`RoadEmitter`/`addRoads`) exactly — no new UI panel. Like M19-M21,
this milestone's multi-kingdom composition is standalone
(`packages/sim/src/ai/multiKingdomHarness.ts`), not wired into `terra.ts`/`scenarios.ts`.

## §7. Memory, Grudges & Reputation

- **Episodic memory:** significant GameEvents involving the kingdom are recorded as
  `MemoryEntry{event, subjects, valence, weight, tick}` with personality-scaled decay
  (`grudgeRetention`); memory feeds opinion modifiers, plan utilities (PunitiveRaid targets whoever
  wronged us), and dialogue flavour references.
- **Opinion (pairwise)** per GDD §10; **Reputation (global)** moves on public acts: oathbreaking,
  unprovoked wars, honoring alliances, ransoming vs. executing captives. Low reputation raises every
  AI's trustFactor cost in §4 deals — betrayal is a whole-campaign price.
- Memory is bounded (top-K by weight per relationship) and fully serialised — grudges survive
  save/load, which is the point.

## §8. Long-Term Planning & Victory Pursuit

- Victory tracker feeds appraisal: each AI scores its own best victory path (personality
  `favoredVictory`) and others' progress; `PrepareVictory` plans pursue its own, and a
  **containment consideration** raises war/alliance utility against any kingdom (player included)
  approaching a win — making every victory contestable (GDD §16).
- Decade-scale behaviours emerge from plan ladders + memory, not scripts: a humiliated Warmonger
  fortifies, rebuilds, seeks allies against you, and returns.

## §9. Personality System

- `AIPersonalityDef` (doc 06 §7) weights every utility axis; shipped archetypes (data, hence
  moddable): **Warmonger, Builder, Merchant, Schemer, Zealot, Steward, Opportunist** — plus small
  per-campaign random perturbation of weights (seeded) so two Warmongers differ.
- Personality must be *legible*: it biases weights, taunt/voice sets, deal thresholds, and event
  choices; the diplomacy screen surfaces observed traits ("Known for: holding grudges") once the
  player has evidence (knowledge model), directly serving Vision success criterion 6.

## §10. Difficulty Scaling (capability-first)

| Lever (in order of preference) | Story | Fair | Hard | Brutal |
|---|---|---|---|---|
| Plan re-eval latency / appraisal noise | high noise | normal | low | minimal |
| Knowledge decay & scouting diligence | fast decay | normal | slow | slow |
| Manager quality tier (heuristic depth) | basic | full | full | full |
| Coordination (allied AI joint planning) | off | limited | on | on |
| Labelled modifiers (visible, GDD §14) | +player | none | +15% AI | +30% AI |

No hidden information access at any difficulty; "Fair" is the design-integrity benchmark.

## §11. Performance & Determinism Envelope

- All AI computation is tick-budgeted, resumable, and deterministic (Engine §3); per-kingdom think
  slices round-robin. Budget: see doc 11 (AI ≤ 30% of tick budget at 8 kingdoms).
- Expensive evaluations cache by state-hash of their inputs (invalidated by relevant GameEvents).
- **AI harness** (TDD §13): nightly headless AI-only campaigns assert survival, growth curves,
  war frequency bands, and per-personality behavioural fingerprints (e.g., Warmonger initiates ≥2×
  wars of Builder) — regression-testing *character*, not just correctness.

**M24 scoping note:** ships as `packages/sim/src/ai/multiKingdom.test.ts` — a `.test.ts` file that
runs on every `npm test`, not a new scheduled workflow. "Nightly" stays the testing-*tier* concept
TDD §13's table already names (distinct from per-PR tiers); no `.github/workflows` cron exists in
this repo, and none was added — the harness's determinism/reproducibility needs are better served
by running on every PR than by a separate scheduled job right now. The fingerprint substitutes two
generic `PersonalityWeights` profiles ("expansion-leaning" / "economy-leaning") for the doc's
Warmonger/Builder example and measures `ExpandSettle` plan-choice frequency instead of war
frequency, since no war system exists until M25 and named personality archetypes are M36 — same
comparative, regression-testing-character shape, using mechanics that actually exist. The perf
check amortizes each AI system's `avgMs` by its actual call frequency (`calls / totalTicks`) before
comparing to the tick average — a system's average per-call cost isn't directly comparable to a
per-tick average when it runs on a daily/weekly cadence, not every tick. Measured: at 8 kingdoms
over 50 years, this is the first place any AI milestone this phase has verified doc 11's "AI ≤ 30%
of tick budget at 8 kingdoms" target against a real run rather than just citing it. The test takes
noticeably longer than earlier AI harness tests (~15-25s vs. sub-second) — accepted deliberately
(confirmed with user) as the cost of the literal Phase 3 gate scenario, rather than shrinking the
scenario or splitting it into a separate slow tier.
