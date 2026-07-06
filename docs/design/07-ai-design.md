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
