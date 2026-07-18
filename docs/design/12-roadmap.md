# 12 — Development Roadmap (48 Milestones to 1.0 + Post-1.0 Phase 8)

> **Revision R1 (M47.5 audit, 2026-07-11):** Phase 7 is split by four inserted integration
> milestones (M47.6–M47.9) before M48. See the change record at the end of this document.
>
> **Revision R2 (ADR-4 ratification, 2026-07-15):** Phase 8 — The Castle (M49–M54) appended as
> planned POST-1.0 scope. Nothing before M48 changes. See the change record.

**Conventions applying to every milestone (stated once, binding always):**

- **Definition of Done (global):** feature works per referenced GDD/TDD section · unit/system tests
  added & green · golden replays updated intentionally (never silently) · docs updated (design
  deltas + dev docs) · debug HUD/inspector coverage for new state · no new lint/boundary violations ·
  playable build tagged.
- Each milestone lists: **Goal · Key work · Test objective (T)**. "Builds on" is implied by order;
  explicit prerequisites noted only when non-linear.
- **Phase gates** (end of each phase): performance benchmarks green at current scale (doc 11 §6),
  save corpus loads, AI harness (once it exists) green, design-doc reconciliation review, open
  questions due that phase resolved (doc 14).
- Playability rule: from M12 onward the game must remain playable end-to-end at every milestone.

---

## Phase 0 — Foundations (M1–M6)

| M | Milestone | Goal / Key work | T (test objective) |
|---|---|---|---|
| M1 | Repo & toolchain | Vite+TS strict, packages per TDD §3, lint boundaries, CI skeleton | CI runs typecheck/lint/unit on PR |
| M2 | Core library | math, interned ids, seeded PRNG service, stable-order collections | PRNG determinism & distribution tests |
| M3 | Sim kernel shell | worker bootstrap, fixed-tick loop, command bus, event bus, protocol pkg | headless kernel ticks in Node; command round-trip |
| M4 | ECS store | SoA components, queries, declared-access enforcement | property tests on add/remove/query; perf micro-bench |
| M5 | Determinism harness | state hashing, command log, golden-replay runner | identical hash across 2 runs & across Chrome/Firefox/Node |
| M6 | Render bootstrap | Pixi scene, camera pan/zoom, chunk grid, snapshot→presentation mirror | 100k-tile pan at 60 fps (P1) |

## Phase 1 — A Living Village (M7–M12)

| M | Milestone | Goal / Key work | T |
|---|---|---|---|
| M7 | Worldgen v1 | heightmap→biome→rivers pipeline, seeded, Medium maps | stage unit tests; seed reproducibility |
| M8 | Terrain render + tiles | chunk baking, terrain defs (first content defs + validator core) | dirty-chunk rebake correctness; fps gate |
| M9 | Debug HUD & inspector | tick costs, entity inspector, command injector *(reused later as sandbox editor)* | inspector reflects live state |
| M10 | Definition DB & Mod Zero skeleton | JSON5 loader, schema validation, base content as a mod layer (doc 09 §1–§3) | invalid-def fixtures produce readable errors |
| M11 | Village core | Village entity, building placement/validation, construction, first 8 buildings | placement rules vs. fixtures; construction math |
| M12 | Population & needs v1 | cohorts, food need, jobs solver, happiness v1; **first playable loop** (feed a village) | pop growth curve tests; famine death-spiral floor |

## Phase 2 — Economy & Kingdom (M13–M18)

| M | Milestone | Goal / Key work | T |
|---|---|---|---|
| M13 | Production chains | 3-tier resources, recipes, stockpiles, spoilage | conservation property tests |
| M14 | Logistics | haulers, roads, job board, route cache | haul throughput bench; no starvation w/ roads |
| M15 | Multi-village & founding | settlers, site scoring, village tiers 1–2 | founding rules; tier upgrade fixtures |
| M16 | Kingdom layer | treasury, taxes, ledger UI, edicts v1, advisors v1 | ledger reconciles to the coin |
| M17 | Save/load v1 | codecs, IndexedDB slots, export/import, autosave | save→load→resave hash-identical; corpus started |
| M18 | UI pass 1 + HUD | panel framework, inspector→player UI, notifications | UX playtest: reach stable village unaided |

**Gate P2:** playable economy sandbox; doc 11 timings §4 (save/load, worldgen-Medium) green.

## Phase 3 — Rivals Awaken (M19–M24)

| M | Milestone | Goal / Key work | T |
|---|---|---|---|
| M19 | AI kernel & sensors | brain scheduling, knowledge model, fog of information | AI reads only via fog queries (access tests) |
| M20 | AI economy+construction managers | need detection, placement scoring, build queues | harness: AI village survives 20 years unaided |
| M21 | AI strategic planner v1 | plan archetypes (peaceful set), utility scoring, hysteresis | plan-switch stability; decision logs legible |
| M22 | Multiple kingdoms & borders | kingdom placement fairness, territory, scouting | fairness variance ≤ ±15%; fog UI |
| M23 | Diplomacy v1 | opinion, gifts/insults, NAP & trade pacts, deal evaluator | deal-value symmetry tests; exploit fuzzing |
| M24 | AI harness & nightly | headless AI-vs-AI campaigns, behaviour fingerprints, perf telemetry | nightly green: 8 AI kingdoms, 50 years, no crash |

## Phase 4 — War (M25–M31)

| M | Milestone | Goal / Key work | T |
|---|---|---|---|
| M25 | Military basics | units, recruitment (pop cost), armies, upkeep | recruit/disband population conservation |
| M26 | Movement & supply | army pathing (HPA*), stances, supply/attrition, seasons impact | pathfinding budget ≤20% at 200 armies |
| M27 | Field combat | resolver, morale/rout, auto-resolve policy, battle UI v1 | auto vs. manual parity ±10% over 1k sims |
| M28 | Castles v1 | castle grid, walls/gates/towers, defence graph *(resolve [OQ-3] now)* | enclosure algorithm fixtures |
| M29 | Sieges | phases, bombardment vs. graph, starvation, sorties, assault | siege pacing stats within design bands |
| M30 | AI at war | military manager, war plans, tactical policy, castle building AI | harness: wars start & *end*; AI wins vs. passive baseline |
| M31 | War diplomacy | casus belli, peace deals, ransom, war exhaustion | peace-deal evaluator sanity; no forever-wars in harness |

**Gate P4:** full loop village→kingdom→war→peace playable; benchmarks `bench-war-max` green.

## Phase 5 — Depth (M32–M38)

| M | Milestone | Goal / Key work | T |
|---|---|---|---|
| M32 | Research | tech tree data (60–80), scholars, era gates, diffusion | DAG validation; era pacing sim |
| M33 | Events engine | trigger DSL, pools, choices, AI event answers | DSL fuzzing; pacing governor bands |
| M34 | Characters | notables, traits, offices deep, marriages, heirs | lifecycle tests; advisor bonus math |
| M35 | Diplomacy v2 | alliances, joint wars, vassalage, reputation, memory/grudges | grudge persistence across save/load |
| M36 | Personalities | 7 archetypes tuned, perturbation, legibility UI | blind fingerprint test (Vision SC-6 proto) |
| M37 | Victory & defeat | all victory tracks, contestability broadcasts, defeat flow | each victory achievable in harness ≤ year cap |
| M38 | Difficulty system | capability tiers, labelled modifiers, presets | Fair-difficulty AI beats naive scripted baseline |

## Phase 6 — Product (M39–M44)

| M | Milestone | Goal / Key work | T |
|---|---|---|---|
| M39 | Modding v1 complete | patches, ordering UI, conflicts report, save-mod reconciliation ([OQ-4] resolved), docs site | sample third-party mod built from docs alone (Vision SC-5) |
| M40 | Sandbox mode & editor | privileged commands, editor palette (reuses M9), sandbox flagging | editor ops replay deterministically |
| M41 | Audio & music | cue tables, music director, mixing, placeholder purge plan | tension-state transitions; loudness lints |
| M42 | UI/UX pass 2 | ledgers/tooltips everywhere ("legibility" audit), keybinds, accessibility (keyboard-complete) | UX playtest vs. Vision SC-1 (30-min competence) |
| M43 | Tutorial & onboarding | advisor-driven tutorial as event content (no engine scripting) | new-player playtest ≥80% completion |
| M44 | Localization & PWA polish | locale extraction, pseudo-locale CI, service worker, quota UX | offline cold-start test; en-XA screenshot diff |

## Phase 7 — Ship (M45–M48)

| M | Milestone | Goal / Key work | T |
|---|---|---|---|
| M45 | Content complete | full building/unit/tech/event rosters, final art integration waves | zero `TEMP_`/placeholder in release profile |
| M46 | Balance campaign | telemetry-free tuning via harness stats + structured playtests; economy/war/victory pacing | all Vision SC pass internally |
| M47 | Hardening | stress ceilings (doc 11 §1 stress column), save-corpus torture, crash triage to zero-known-blockers | 100 seeded full campaigns crash-free |
| M47.5 | Architecture, design & release audit | formal internal release review of M1–M47 against the design set; verdict: Not Ready — integration gap between the playable composition (`composeTerra`) and the harness-only Phase 3–5 systems | audit delivered; roadmap revision R1 ratified |

### Phase 7-INT — Integration (M47.6–M47.9, inserted by revision R1)

The M47.5 audit found every Phase 3–5 system verified only in `composeMultiKingdom` (flat fake
terrain, one village per kingdom, never player-reachable) while the playable game remained the
Phase 2 economy sandbox on a hardcoded seed. This phase assembles the real game before M48
freezes it. The M12 playability rule is tightened for these milestones: a system counts as done
only when it is **in the unified campaign composition with a player surface**, not merely
harness-green.

| M | Milestone | Goal / Key work | T (test objective) |
|---|---|---|---|
| M47.6 | Unified campaign composition & new game | one `composeCampaign(options)` wiring the full stack — multi-kingdom + fair placement on REAL worldgen terrain, fog/scouting, diplomacy, military/combat/castles/sieges, research, events, victory/defeat, difficulty; `composeMultiKingdom` becomes a thin wrapper over it; new-game screen (seed, map size, kingdom count, difficulty preset, victory toggles, sandbox) replaces the hardcoded seed; golden fixtures intentionally re-recorded (`campaign` scenario joins/replaces `terra-demo`) | full campaign boots headless AND in browser; save→load→resave hash-identical on the unified composition; new-game options round-trip into the save header |
| M47.7 | Player UI for the dark systems | minimum viable panels on the existing `PanelHost` framework for diplomacy (opinion, deals, war/peace), military (recruit, armies, stances, siege surface), research (tree, active pick), and victory/defeat flow (tracks, `victory.approaching`, end-of-campaign screen); battle-report presentation honoring auto-resolve parity — no player-facing action may require the debug injector | hands-on walkthrough entirely injector-free: declare war → move army → win a siege → complete a research → reach a victory or defeat screen |
| M47.8 | AI & balance on the real game | jobs-solver food-first priority (closes the M46 Builder-starvation defect); multi-village AI kingdoms (fog/war-target/scouting plumbing drops the one-village assumption, `ExpandSettle` executes in campaigns, free-tools genesis crutch removed via one AI-built production chain); knowledge-model army-strength beliefs wired into the planner (or descoped by written ADR); memory consumed by one plan archetype (`PunitiveRaid`) | bench-balance matrix (seeds × all 4 difficulties) on the unified composition: no kingdom starves at peace; wars start AND end; ≥2 victory types reached organically inside the year cap |
| M47.9 | Recertification & truth pass | crash triage (100 seeds) rerun on the unified composition; `bench-war-max`/`bench-ai-8k`/`bench-late-campaign` built and the doc 11 §6 CI benchmark gate made real; README status-table honesty pass (caveats carried in the table itself); ADRs recorded: characters (M34) cut from 1.0, knowledge-model scope, harness-first decision retrospective; design-doc reconciliation | 100 campaigns crash-free on the unified composition; all three benchmark scenes green vs. doc 11 §2 at current content scale |

| M | Milestone | Goal / Key work | T |
|---|---|---|---|
| M48 | Release candidate → 1.0 | freeze, release notes, mod docs final, launch build — **entry gate: M47.6–M47.9 complete**; SC-1..6 verified against the unified campaign composition, not the sandbox | external RC playtest: SC-1..6 verified; ship |

## Phase 8 — The Castle (M49–M54, post-1.0 — added by revision R2)

Chartered by ADR-4 (doc 15, ratified 2026-07-15 with amendments). **1.0 ships the existing
castle/siege stack unchanged — nothing in this phase precedes M48.** Entry gate: 1.0 shipped ·
OQ-9's Phase-8 decision resolved (doc 14 — OQ-11 already CLOSED 2026-07-15: vassalage-first
defeat, permadeath as the ironman opt-in). The M12 playability rule and ADR-3's
composition rule bind here as everywhere: each milestone lands in the shipping campaign with a
player surface, not merely harness-green.

| M | Milestone | Goal / Key work | T (test objective) |
|---|---|---|---|
| M49 | Defence-layer core | per-kingdom ~100×100 defence map from `hash(worldSeed, kingdomId)` via a local-scale worldgen profile (terrain variety is load-bearing — ADR-4 §5); `DefenceStructure` components reusing `Fortification`; `DefenceOps` placement/cost reservation against the main economy; `defence.build/demolish/post` commands; persistence as seed + pipeline-version stamp | layer save→load→resave hash-identical; layout regeneration byte-stable across engines; version-stamp mismatch falls back to stored tiles |
| M50 | Defence view & build UI | second render scene (second `PixiRenderer` instance over the pure core), world↔defence view switch, snapshot layer routing in the protocol, build palette + garrison posting on `PanelHost` | place/demolish/post walkthrough injector-free; doc 11 fps gates hold with both scenes live |

**Gate P8 (verified 2026-07-18):** all six milestones shipped in the unified campaign composition
(no harness-only surface). Global DoD checks: `npm run build` clean · full suite 459/459 green
(incl. `intel.test.ts`) · `npm run lint` clean · `npm run replay:verify` all four golden replays
byte-stable (campaign-demo re-recorded intentionally at M54 for the new `garrisonStrength` fact
kind and player `KnowledgeModel`, per TDD §13 policy) · `npm run save-corpus:verify` all three
corpus saves resume clean. Doc 11 §2 sim budgets (`npm run bench:scenes all`): war-max 0.086
ms/tick, ai-8k 0.211 ms/tick, late-campaign 0.357 ms/tick — all ≤10 ms budget, AI share ≤13.4%
of a ≤30% budget, comfortable headroom at every scene. AI harness (`npm run bench:balance`): 12
campaigns (4 kingdoms × 100y × 4 difficulties × 3 seeds) all reach a victory before the year cap —
SC-2 holds. M50's "fps gates hold with both scenes live" T objective resolves by the M50 scoping
note's own architecture, not a live-render measurement: the defence view is a static 2D canvas
redrawn only on projection change (no second WebGL context, no per-frame cost), so there is no
second live scene to contend for frame budget — verified by reading the shipped code path, not
re-litigated here. Design-doc reconciliation: GDD §7 and doc 07 §5 both carry their Phase-8-shipped
deltas (M52 templates load-bearing, M54 knowledge-model second-consumer) — no outstanding rewrite.
Open questions: OQ-9 and OQ-11 both CLOSED in doc 14, Phase 8 entry gate satisfied per their own
records. **Phase 8 — The Castle is closed.** Outstanding work is 1.x balance backlog only (recorded
in the M54 scoping note below): AI-vs-AI war-cadence, the 34%-max origin-deviation watch item, and
combat.ts's pinned u16 rounding.

**1.x war-cadence backlog, part 1 (2026-07-18) — a real bug fixed, the actual bottleneck found
elsewhere.** Root-caused the M53/M54 "AI-vs-AI wars end without a capital siege" finding. Two
independent things were in play:

*Confirmed and fixed:* `ai/military.ts`'s `planCastleRing` (the AI's own capital fortification
loop) placed only 8 sparse points — 4 corners + 4 edge-midpoints — at `CASTLE_RING_RADIUS` (6).
That shape only actually CLOSES a loop at radius 1 (where it matches `castles.test.ts`'s fixture,
every point already adjacent); at radius 6 it left 5-tile gaps on every side, so `castles.ts`'s
4-connected flood-fill always found a way through and `isCastle` never flipped true for ANY
AI-built capital using this v1 path. Since `military.ts`'s own tactical-war gate refuses to even
attempt `siege.begin` against a target whose `AiWarTarget.isCastle` reads false
(`campaign.ts`'s `warTargetsFor`), this made non-spatial sieges against AI capitals structurally
unreachable regardless of any exhaustion-clock tuning. Fixed: `planCastleRing` now returns every
tile on the actual perimeter (all 8×radius tiles at Chebyshev distance `radius`), a genuinely
closed 4-connected ring at any radius. Verified: full suite green (459/459); `save-corpus` and all
four golden replays re-recorded intentionally (AI capital-fortification behaviour legitimately
changed, per TDD §13) and re-verified clean; `bench:scenes` sim-tick budgets re-checked, still
comfortably inside doc 11 §2 (late-campaign 0.487 ms/tick vs. 10 ms budget — the larger ring adds
real but modest per-day cost, no regression). `bench-balance.ts` gained `siege.begun`/
`siege.assaultBegun` counters (previously only `warsDeclared`/`warsEnded` existed — no way to see
which pipeline stage was actually stalling) so this and future war-cadence work is measurable, not
re-derived by reasoning alone.

*Found, NOT yet fixed — the actual dominant cause in the default matrix:* running the fixed code
through `npm run bench:balance` (12 campaigns, 4 kingdoms × 100y × 4 difficulties × 3 seeds, flat
harness) still shows `wars: 0 declared, 0 ended` — identically to the pre-fix baseline. Every
single run resolves to a `prosperity` victory by year 15–16, ending the campaign loop
(`victoryGame.winner() !== null` breaks the tick loop) long before the harness's own war machinery
(`WEIGHTS_A`/`WEIGHTS_B`, aggression 0.6/0.2) has any real runway to escalate. So in THIS
harness's default configuration, "no capital siege ever mounted" is explained by "no war is ever
even DECLARED" — a victory-pacing question (prosperity resolves too fast relative to any war
path), not narrowly a siege-timing question. The dedicated `multiKingdomWar.test.ts` (aggression
0.9, 2 kingdoms, small map) proves the underlying war→march→siege machinery itself works when
given a favourable setup, so the fix above is real and necessary but not sufficient to see war
activity in the STANDARD balance matrix. Deliberately left open pending a product call: whether to
retune the balance harness's own weight/victory presets to actually exercise war (closer to
`multiKingdomWar.test.ts`'s config), or to retune `prosperity`'s pacing itself, or both — a
felt-gameplay decision, not one to make by silently picking new constants.

**1.x war-cadence backlog, part 2 (2026-07-18) — weights retuned per product direction; the real
blocker is mutual discovery, not personality.** Replaced `bench-balance.ts`'s `WEIGHTS_A`/
`WEIGHTS_B` (aggression 0.6/0.2, never-once-declared-a-war) with `multiKingdomWar.test.ts`'s
AGGRESSIVE/PASSIVE pair verbatim (aggression 0.9/0) — the one weight combination in this repo
PROVEN to declare and win a war within a test-sized number of years. Re-ran the full 12-campaign
flat-harness matrix: **still `wars: 0 declared, 0 ended` at every difficulty, every seed** —
byte-identical symptom to the pre-retune baseline. Traced the actual cause: `ai/scouting.ts`'s
`registerScoutingSystem` is a purely STATIC distance-based fog reveal (`SCOUT_REVEAL_RADIUS=48`,
no active scout units, no radius growth over time — doc header: "adjacency-based reveal() until
scout/trade/envoy/battle systems land"), and `campaign.ts`'s `warTargetsFor` fog-gates every war
target (`if (!fog.isKnown(kingdomIndex, v.vi)) continue`) — an undiscovered rival is invisible to
the war-target list regardless of aggression. `composeMultiKingdom`'s own docstring confirms the
~130–150 tile inter-kingdom spacing on its 260-tile map is DELIBERATE ("scouting range is
deliberately much smaller than the inter-kingdom distance this produces, so newly founded kingdoms
start genuinely unrevealed to each other") — built for a founding-fairness test property, not for
war-cadence testing, and the two goals are now in direct tension in the same harness. Since
villages never expand into scouting range of a rival over a 100-year run either, kingdoms in this
harness's default configuration cannot discover each other at ANY point in the campaign, at any
aggression level — this is the dominant, structural blocker, ahead of both the exhaustion clock
and the (still-real, still-fixed) castle-ring bug from part 1. Verified: full suite still green
(459/459) after the weight change — no fixture depends on `bench-balance.ts`'s constants. NOT
attempted this pass: shrinking `mapSize` or growing `startingPopulation` for the flat harness (the
`mapSize`/`SCOUT_REVEAL_RADIUS` relationship is shared, load-bearing plumbing — `composeMultiKingdom`
is reused by other harness consumers that may rely on the "unrevealed at start" property, so this
needs its own scoped look rather than a same-session follow-on edit) — left open, same as part 1's
undecided lever, pending direction.

**1.x war-cadence backlog, part 3 (2026-07-18) — the discovery-distance fix, scoped to
`bench-balance.ts` only.** Confirmed empirically (a direct probe script, not the ring-geometry
formula alone — the flat harness's uniform terrain biases site selection in ways worth measuring
rather than deriving) that `mapSize: 65` gives all 6 pairwise inter-capital distances ≤
`SCOUT_REVEAL_RADIUS` (48) for `kingdomCount=4`, reproducibly across seeds 9000-9002, while all four
kingdoms still found cleanly clear of `VILLAGE_MIN_SPACING` (24). Changed only inside
`bench-balance.ts`'s own `composeMultiKingdom` call (was 260) — `composeMultiKingdom`'s shared
default (300) and every other consumer (`multiKingdom.test.ts`, `multiKingdomWar.test.ts`, etc.)
are untouched, so the "kingdoms start genuinely unrevealed" property those tests may rely on still
holds everywhere except this one tool's own invocation.

**Result — the fix chain compounds:** the same 12-campaign flat-harness matrix (parts 1+2's fixes
already in place, this one added) now shows **`wars: 31 declared, 31 ended` · `sieges: 3 begun, 0
assaulted`** — up from `0 declared / 0 begun` at every prior checkpoint in parts 1 and 2. Wars
finally happen once rivals can see each other; a few even reach `siege.begun`. Full suite still
green (459/459); no other fixture depends on this tool's map size.

**Still open — assaults never happen, even where a siege begins.** All 3 siege-starts came from
`story` difficulty specifically (1 per seed); `fair`/`hard`/`brutal` each show 2 wars declared but
0 sieges — an unexplained difficulty-correlated split worth a closer look before touching anything
else. And even where a siege DOES begin, it never reaches `siege.assaultBegun` — every war still
ends via the flat, unconditional exhaustion clock (`FORCED_PEACE_EXHAUSTION`, `diplomacy.ts`)
before an assault is ordered, or armies are resolving in the field via `combat.ts`'s automatic
proximity engagement before ever reaching the castle at all — not yet distinguished. This is now a
THIRD, deeper layer of the same backlog item (declare → discover ✓ fixed, reach a castle → some
✓, assault it → still 0) — left open pending direction, same discipline as parts 1 and 2: measured
and reported, not guessed at.

**M54 scoping note (shipped 2026-07-17) — PHASE 8 COMPLETE:** intel lands as ADR-4 §4 drew it.
Structures preview as a STALE SNAPSHOT per (observer, target) — `game/intel.ts`, refreshed only
on current-proximity contact with the target capital or by a besieging army (the camp is looking
at the walls), hash-folded and saved (optional section). Garrison strength is NEVER truth: a
`garrisonStrength` fact (appended FactKind — pack indexes stay save-compatible) through the same
belief sensors, and the PLAYER now carries a KnowledgeModel like every AI (kingdom 0's UI reads
its own noisy beliefs — the fog is symmetric in both directions). AI attackers consult
`estimateAssaultResistance` over snapshot + belief via the military manager's `assaultAdvice`
hook (assault / hold / lift at `ASSAULT_HOPELESS_FRACTION`); the battle report tells the
belief-error story ("believed ~40; met 85" — `believedGarrison`/`actualGarrison` on
`siege.assaultResolved`). The Castle panel gains the enemy-intel section (sepia-washed stale
canvas, "as of day N", believed garrison). Personality-tag template mapping ships (martial →
motte, economy → concentric, schemer → ridge-line, via TEMPLATE tags). The new
`bench-assault.ts` matrix (`npm run bench:assault`) drove three real fixes: (1) whole-man
casualty ROUNDING starved sustained chip damage (36 tower volleys into 60 men = zero loss; clash
winners fought free) — replaced by a per-unit FRACTIONAL ACCUMULATOR that carries remainders
between volleys, integrating chips into real men with no u16 hazard; (2) the WALK-PAST exploit —
a raid slipping past a thinly-spread garrison took the keep bare-handed — closed by the
LAST-STAND RALLY (surviving posts add their defence to the keep verdict; positioning still pays
because posts on the approach bleed the column earlier, under tower fire); (3) the origin-
dominance metric judges per-ORIGIN aggregates over contested configs with geography-sealed
origins masked out (a blocked approach is ADR-4 §5 pricing at its limit, not an artefact).
Bands (2 seeds): garrisoned templates repel 20-man raids at every origin; keep-only falls to a
host from every reachable origin; concentric > motte > ridge-line in cost-to-crack; max origin
deviation 34% (top-favoured across the four marginal configs — a content watch item, within
tolerance). DECISIONS RECORDED: combat.ts's own u16 rounding stays PINNED (field battles are
symmetric, its balance corpus is recorded; revisit only on cross-engine or matrix evidence) ·
geography-priced origins are DELIVERED EMERGENTLY by the terrain-bearing maps (the matrix
quantifies them; no explicit pricing mechanic needed) · AI-vs-AI conquest pacing (wars ending
before capital sieges are mounted) is inherited pre-Phase-8 war-cadence tuning, out of Phase 8's
scope — carried as a 1.x balance backlog item, not an open Phase 8 obligation.

**M53 scoping note (shipped 2026-07-17):** capital death activates exactly as OQ-9 item 2 ruled —
when a defence-layer capital falls (assault OR starvation: starving a capital out cannot dodge the
rule), the siege FREEZES instead of flipping ownership and a `CAPITULATION_WINDOW_DAYS` (5) window
opens. Vassalage-first (OQ-11): an AI loser decides through the SHIPPED `evaluateVassalageDeal`
with its war exhaustion floored at `CAPITAL_FALLEN_EXHAUSTION_FLOOR` (40 — the keep falling IS
hopelessness), so grinding wars end in submission while a lightning war can find a defiant court;
a human loser submits via `kingdom.proposeVassalage`, a human attacker gets
`siege.capitulationOffered` and accepts by `siege.acceptCapitulation` — silence until the deadline
is refusal. Capitulation spares the capital (owner unchanged; fealty + M35 tribute are the price);
refusal/expiry/`ironman` is DESTRUCTION: treasury transfers whole (ledger kind `loot`), goods carry
into the attacker's capital under `capOf` with the excess BURNED (`siege.sacked` reports both), the
capital is razed (`VillageOps.raze` — the twelfth-hour mechanism, policy stays in succession), the
REALM IS SEIZED (remaining villages pass to the conqueror via ordinary `village.occupied` events —
a decision the docs left open, resolved here: a dead kingdom must not linger as a zombie), armies
dissolve, and the defence layer resets to keep-only ground. New lords rise `NEW_LORD_COOLDOWN_DAYS`
(720) after ANY kingdom death near the slot's genesis heartland, politically blank-slated
(diplomacy reset, defeat mark cleared, founding treasury restored), suppressed while any survivor
sits at ≥80% of a victory track so conquest stays winnable. Occupation now EXEMPTS layer capitals
(the countdown was a rule bypass) and the AI military manager targets/assaults them spatially —
all switched by ONE `succession` flag so the harness wrapper (`succession: false`) keeps pinned
pre-M53 semantics. Siege save section v2 (+`fallenDeadline`, v1 migration); optional `succession`
section; no golden or corpus re-record was needed (the empty-state hash folds nothing). The
50-year T matrix caught a LATENT M52 crash: military-upkeep's deserter despawn detaches whatever
rides on the unit, and a broke kingdom's POSTED garrison tripped the access guard — fixed with
kingdom.ts's M34 extension-point pattern (`registerUnitExtension`; defence.ts declares
DefencePost). The matrix also confirms AI-vs-AI wars currently end (forced peace) without a
single capital siege being mounted — verified IDENTICAL under pre-M53 rules (same winner, same
tick), so it is inherited war pacing, not an M53 regression; it is squarely M54's balance-matrix
question ("conquest reachable in AI hands", alongside its owned tuning constants).

**M52 scoping note (shipped 2026-07-16):** castle templates ship as the ELEVENTH def kind
(`defs/castle-templates/`, three archetypes: motte / concentric / ridge-line) — doc 07 §5's
"template-based skeletons" finally load-bearing. Terrain adaptation is the skip rule: plan tiles
the local ground refuses (rock/water/occupied) are simply not built — nature already walls them.
Template choice is a seeded per-kingdom pick over the sorted ids (personality-TAG mapping is M54
content polish if the matrix wants it); the manager builds one structure and posts one idle unit
per day, with a stone reserve (`DEFENCE_STONE_RESERVE`) so fortification never starves ordinary
construction, and the M51 draft rule releases garrison to army assembly automatically. The
harness wrapper opts out (`aiDefence: false` — M22–M46 outcomes pinned). Two resolver findings
fixed while testing at scale: fractional casualties written to the u16 `Unit.count` truncated a
whole man per write (assault now applies WHOLE-man casualties; combat.ts carries the same latent
truncation but its balance is pinned — flagged for M54), and tower fire re-scaled count-relative
(a volley bites a 20-man raid, chips a 100-man host) so towers deter raids without melting hosts.

**M51 scoping note (shipped 2026-07-16):** the resolver models the army as ONE column walking
the flow field; garrison posts within `GARRISON_SUPPORT_RANGE` (2) of a contact join a single
defending line (piecemeal picket duels let a concentrated column eat a garrison unit-by-unit —
massing is the point of prepared ground). Capitals with a standing layer are SIEGE-ELIGIBLE
without world-map walls (`SpatialAssaultHook.applicable` — ADR-4 §6's castle-ness derivation);
non-capital castles keep the legacy breach-gated path verbatim. Interim loss rules unchanged
per doc 14 OQ-9 item 2: a spatial capture is still an owner flip (capital-death is M53). The
"battle-report replay" ships as a static trace overlay on the Castle panel's map (walk path +
breach marks) — animation is M54 polish if wanted. Geography-priced origins (ADR-4 §5's second
lever) are deferred to M54's balance matrix; origin is player-picked or derived from the
besieger's true approach. Tower fire consumes the `rangedArc` content field (inert since M29 —
its designed payoff). Fixed in passing, found by the new tests: `siege.captured` never updated
the composition's plain ownership index or the capital re-binding (a latent M47.8 gap — assault
captures were rare enough that nothing tripped it); both now subscribe to it.

**M50 scoping note (shipped 2026-07-16):** the defence view ships as a 2D-canvas scene INSIDE the
Castle panel, not a second `PixiRenderer` instance — a 100×100 static grid redrawn only when the
`panels` projection changes needs no WebGL context, no chunk cache, and no per-frame work (the
fps-gate leg of the T objective holds by construction: zero frame-loop cost). "Snapshot layer
routing" landed as a `defence` block on the existing `PlayerPanels` projection rather than a new
message kind, and the "view switch" is the PanelHost's own single-open toggle. Revisit a real
second scene at M51 only if assault-trace playback outgrows the canvas.
| M51 | Spatial assault resolution | deterministic flow-field resolver replacing `siege.assault`'s flat path (reuses combat.ts morale math + fortification HP math); keep points threshold; compact trace + battle-report replay; the warning chain (blocking auto-pause `siege.begun` notice deep-linking to the defence view); player bombard-target picker and sortie surface — closing the M47.7 gap (`siege.setTarget` is AI-only today and `siege.sortie` has no caller in the shipping game) | same seed + layouts + armies ⇒ identical outcome and trace across Chrome/Firefox/Node; GDD §8 siege-pacing bands still hold end-to-end |
| M52 | AI defence | doc 07 §5 archetype templates (motte/concentric/ridge-line) as Mod Zero content; deterministic terrain adaptation; incremental build through the existing build-queue discipline; plan-driven garrison assignment from the shared soldier pool | harness: every AI kingdom's layout repels the baseline raid its economy tier should repel; templates visibly differ across terrain seeds |
| M53 | Loss, loot & succession | capital-death rule per reopened OQ-9; defeat outcome per OQ-11's decision (vassalage-first via the shipped M35 mechanics; permadeath under the `ironman` flag); loot transfer under `capOf` with excess burned, ledger-explicit; new-lords-rising against world attrition | 50-year AI-vs-AI campaigns: kingdom count stays within the design band (vassal kingdoms persist; only refused capitulations destroy); conquest victory still reachable |
| M54 | Intel & balance | stale-snapshot structure preview keyed to last scouting contact; garrison strength via ADR-2 `armyStrength` beliefs (the knowledge model's second consumer); AI attackers preview through the same fog queries; dedicated attack/defence balance matrix | balance bands hold across seeds × difficulties; no single-origin dominant strategy; belief-error stories legible in the battle report |

---

## Dependency & Risk Notes

- Long-pole chains: ECS/determinism (M2–M5) → everything; AI harness (M24) is deliberately early —
  it de-risks R1 for all later AI work; combat (M27) precedes castles' siege value (M29).
- Technical-debt policy: refactor windows are built into gates; any "temporary" code carries a
  `DEBT(Mxx)` tag and CI counts them — the count must not grow across a phase.
- Open-question due dates: OQ-1,2 by M12 · OQ-5,10 by M26 · OQ-3 by M28 · OQ-6,7,8,9 by M32 ·
  OQ-4 by M39 (doc 14).

---

## Change Record (doc 00 freeze rules)

**R1 — Integration phase inserted before M48 (ratified 2026-07-11, from the M47.5 audit).**

- **Change:** four milestones (M47.6–M47.9, "Phase 7-INT") inserted between M47 and M48; M48
  gains an explicit entry gate (Phase 7-INT complete; SC-1..6 verified against the unified
  composition). Characters (M34's `game/characters.ts`) is cut from the 1.0 composition by ADR
  in M47.9 — code retained behind its module boundary for 1.x.
- **Why:** the M47.5 audit found the roadmap's letter satisfied while its substance was not:
  every Phase 3–5 system was verified only in a standalone harness (`composeMultiKingdom` — flat
  synthetic terrain, one village per kingdom, no player surface), while the playable game
  (`composeTerra`) remained the Phase 2 economy sandbox on a hardcoded seed with no rivals, war,
  diplomacy, research, victory, or new-game flow. Freezing at M48 would ship a vertical slice,
  not the designed game (Vision USP-1).
- **Affected documents:** this doc (12); README status table (honesty pass, M47.9); doc 11 §6
  (benchmark CI claim becomes true at M47.9); doc 13 (R1/R2/R8 realization risk reduced; no new
  risks added); docs 02/07 unchanged (no design change — this is integration of designed systems).
- **Affected milestones:** M48 deferred until M47.6–M47.9 complete. No completed milestone is
  reopened; their harness-level verification stands and is *recertified* at campaign level in
  M47.8/M47.9.
- **Risk impact:** adds ~4 milestones of schedule (accepted). Reduces the critical release risks
  named in the audit: integration shortfall (certain → addressed), unproven emergent balance on
  real terrain (R-B), unmeasured full-composition performance (R-C), UI scope owned by no
  milestone (R-D). Golden fixtures will be intentionally re-recorded at M47.6 per TDD §13's
  existing policy.

**R2 — Phase 8 ("The Castle") appended as post-1.0 scope (ratified 2026-07-15, ADR-4).**

- **Change:** six milestones (M49–M54, "Phase 8 — The Castle") appended after M48 as planned
  POST-1.0 scope: a per-kingdom castle-defence layer replacing the on-map defence graph, spatial
  assault resolution inside the existing siege phases, templated AI defence, and the
  loss/loot/succession/intel work around it. M48 and everything before it are unchanged —
  1.0 ships the existing castle/siege stack.
- **Why:** ADR-4 (doc 15) — the honest realization of Vision USP-4, deliberately kept out of 1.0
  by the M47.5 audit's own logic: a phase-sized combat rework at M47.9 would reopen M45 (content),
  M46 (balance), and M47 (hardening).
- **Affected documents:** this doc (12); doc 14 (OQ-9 reopened with pre-M48 groundwork decisions;
  OQ-11 added, owner-decided, due at Phase 8 entry); doc 15 (ADR-4 PROPOSED → ACCEPTED with
  amendments, defeat outcome carved out). GDD §7 and doc 07 §5 rewrites are deferred to Phase 8
  entry — no design-doc change before then.
- **Affected milestones:** none before M48; M48's entry gate is untouched. OQ-9's item 1 (make
  "capital" explicit, persisted state) is a pre-M48 DECISION, not scheduled work — if taken, it
  lands inside M48's freeze scope or is explicitly declined in the OQ-9 record.
- **Risk impact:** none to 1.0. Codifies post-1.0 scope so the defence layer reads as planned
  work rather than a gap.
