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

**1.x war-cadence backlog, part 4 (2026-07-18) — root cause found: the strategic planner abandons
a war it already committed to.** Traced with a hand-built event probe (subscribing to
`diplomacy.warDeclared`/`army.arrived`/`army.unitDeserted`/`siege.begun` on a live composition,
plus temporary `console.error` tracing inside `ai/military.ts`'s daily decision loop — reverted
before commit, not shipped) against a guaranteed worst-case scenario: two kingdoms, BOTH on
`multiKingdomWar.test.ts`'s proven AGGRESSIVE weights, both capitals confirmed `isCastle=true`
with a genuine 48-node defence graph (part 1's fix working correctly). War was declared, both
armies marched, both `army.arrived` at the enemy capital — and still no `siege.begun`. The trace
pinpointed it exactly: **the moment the army arrives, every subsequent daily tick logs `bail:
plan=MilitaryBuildup`** — `ai/military.ts`'s tactical-war-conduct block is gated on `plan ===
'ConquestWar' || plan === 'PunitiveRaid'` (military.ts's own tactical-conduct guard), but
`ai/planner.ts`'s weekly re-evaluation had already flipped the active plan back to
`MilitaryBuildup` (its utility function, `aggression × relativeAdvantage × militaryStrength`, can
drop below `MilitaryBuildup`'s once the committed army marches away and stops counting toward
at-home military strength). `MilitaryBuildup` still passes the OUTER plan guard (so barracks/
recruit/fortify keep running), but the tactical block's narrower guard excludes it — the module's
existing "war fell out of favor" branch (top of the daily loop) only fires for a plan OUTSIDE all
three war-adjacent plans, so it never catches this case either. Net effect: an army already at the
enemy's gate is silently abandoned — no `siege.begin`, no peace proposal, nothing — until the flat
exhaustion clock forces peace 90 days after declaration regardless (confirmed: `diplomacy.
peaceForced` fired at day 1455.0, exactly 90 days after `warDeclared` at day 1365.3). This is why
`bench:balance`'s matrix shows wars that start, armies that arrive, and yet an assault rate of
zero — not a siege-duration or exhaustion-timing problem as originally framed, but the strategic
layer discarding tactical progress mid-execution. (Also separately confirmed real and working as
designed, ruled out as the cause here: `game/military.ts`'s seasonal upkeep desertion, which
periodically wipes an under-resourced army — visible in the same trace at days 630 and 1350 — but
is a distinct, pre-existing, intentional mechanic, not what stalled this particular war.) This is
a strategic/tactical-layer coordination bug, not a constant to retune — left open pending
direction on the right fix shape: let a committed army finish its war under `MilitaryBuildup` too,
route a plan-revert into the existing "sue for peace" branch, or add a `planner.ts` hysteresis
term for an active siege — same discipline as parts 1-3, reported rather than guessed at.

**1.x war-cadence backlog, part 5 (2026-07-18) — the part-4 fix implemented; correct but currently
inert, because the operative blocker is upstream.** Took the first of part 4's three options:
`ai/military.ts`'s tactical-war-conduct block now runs under `MilitaryBuildup` too, but ONLY for an
army already committed to a war (an existing siege, or a known target the kingdom is already at war
with), and under that plan it never DECLARES a new war — target selection is restricted to at-war
enemies (`initiatesWar ? allTargets : atWarTargets`). This removes the traced failure mode where the
planner reverts a marching aggressor to `MilitaryBuildup` and silently strands its army at the
enemy gate.

**Empirically, the fix changes nothing currently observable:** the 12-campaign flat-harness matrix
is byte-identical to the pre-fix run (`wars: 31 declared, 31 ended · sieges: 3 begun, 0
assaulted`); all four golden replays, all three save-corpus entries, and all 459 tests are
unchanged (0 migrations, same hashes) — so no fixture re-record was needed, and the fix is inert
across the entire pinned corpus. A single-scenario probe (2 kingdoms, both AGGRESSIVE, seed 9000)
shows why: the army built to full strength (30 troops, ≥ `WAR_MIN_STRENGTH`) and sat IDLE from day
540 to 1350 — 800+ days — because the planner stayed in `MilitaryBuildup` that entire window and
never entered `ConquestWar` to declare a war; when it finally did flip to `ConquestWar` (~day
1365), seasonal upkeep desertion had just wiped the army to zero (day 1350), so the war was
declared with no army to prosecute it, and `committedCount < WAR_MIN_STRENGTH` correctly refused to
siege. The part-4 abandonment case (declared-while-full, then plan reverts) simply never arises in
these seeds because full-strength-army and `ConquestWar`-plan and at-war never coincide.

So the part-4 fix is real, correct, and a PREREQUISITE (once the upstream issues clear, without it
armies would still abandon their wars) — but on its own it is necessary-not-sufficient, exactly
like part 1's castle-ring fix. The now-dominant, still-open blockers, both traced and named here
for whoever picks this up: (1) **planner cadence** — `ai/planner.ts`'s `ConquestWar` utility
(`aggression × relativeAdvantage × militaryStrength`) rarely beats `MilitaryBuildup`'s in a
symmetric matchup (`relativeAdvantage ≈ 0.5` caps it), so a kingdom hoards a full idle army for
years instead of committing it; (2) **desertion vs. buildup timing** — `game/military.ts`'s
seasonal upkeep desertion periodically zeroes an army whose economy can't sustain its upkeep, and
in the flat harness the rare `ConquestWar` windows keep landing right after a wipe. Both are
felt-gameplay tuning calls (planner utility weights; upkeep affordability / recruit pacing), not
mechanical bugs — kept as the open head of this backlog item, reported not guessed at.

**1.x war-cadence backlog, part 6 (2026-07-18) — ConquestWar commitment bonus: implemented, works
as designed, still zero aggregate assault change (the blocker is now one layer deeper again).**
Addressed blocker (1) from part 5. `ai/planner.ts` gains a `warCommitment` consideration (0..1, fed
from `campaign.ts`'s military context: 1 while the kingdom is at war with any rival) and
ConquestWar's utility becomes `aggression × (relativeAdvantage × militaryStrength + warCommitment)`
— ADDITIVE, so at peace (`warCommitment=0`) it is byte-for-byte the M30 weak→strong ladder (no
premature wars; a new unit test pins both the unchanged-at-peace and the sticky-at-war halves), but
once at war it lifts ConquestWar decisively above `MilitaryBuildup`+hysteresis and `TechRace`,
aggression-scaled so a warlike kingdom commits hard and a lukewarm one dragged in stays ambivalent.

**It works — and it is inert in the aggregate.** A single-scenario probe (2 kingdoms, AGGRESSIVE,
seed 9000, `ai.planChosen` trace) confirms the mechanism: before, ConquestWar sat at ~0.225 and the
plan reverted to `MilitaryBuildup` the week after any war fired; now the plan flips to `ConquestWar`
at declaration (day 1365) and STAYS there for the entire war until forced peace ends it (day 1455),
instead of abandoning the army. But the 12-campaign matrix is once again byte-identical (`wars: 31
declared, 31 ended · sieges: 3 begun, 0 assaulted`), and all pinned fixtures are UNCHANGED — full
suite 460/460 (the +1 is the new planner test), golden replays and save corpus green, no re-record
needed; `bench:scenes` budgets green; lint clean.

**The now-dominant blocker, freshly traced and named for whoever picks this up: mutual-march field
collision.** With the plan finally sticky, both aggressors rebuild and march AT THE SAME TIME — each
straight for the OTHER's (now undefended, because its army also left) capital. Their columns cross
in open field and annihilate each other before either reaches a wall: `battle.resolved` fires at day
1366.2 with `remainingA:0, remainingB:0` (a dead draw), a full half-day BEFORE the `army.arrived`
events at 1366.9. No army survives to besiege anyone. This is a combat/movement-layer question, a
different subsystem from parts 1-6's planner/tactical/discovery work — candidate directions, none
taken (this is a felt-gameplay design call, not a mechanical bug): garrison-hold logic (leave a
defensive force at the capital rather than committing the whole army), staggered/reactive war
declaration (don't let both sides commit on the same tick), or letting the tactical layer prefer an
undefended enemy capital over a field intercept. Parts 5 and 6 are both correct, both prerequisites
(without them a surviving army would still abandon its war), and both currently masked by this
deeper blocker — the honest state of the war-cadence chain: declare ✓ · discover ✓ (part 3) · commit
the plan ✓ (part 6) · keep conducting ✓ (part 5) · reach the castle alive ✗ (open). Reported, not
guessed at.

**1.x war-cadence backlog, part 7 (2026-07-18) — THE FIRST FIX THAT MOVES THE OUTCOME: a
siege-conduct ordering bug, found by tracing the real matrix instead of the symmetric probe.**
Setting out to build the garrison-hold option from part 6, a trace of the ACTUAL matrix scenario
(4 kingdoms, the AGGRESSIVE/PASSIVE weights, `story`/seed 9000 — the config that produced the
lone siege) revealed the matrix's real blocker is NOT the 2-kingdom mutual-march (that pathology is
specific to my symmetric AGGRESSIVE-vs-AGGRESSIVE probe, which is not what the matrix runs). It is a
clean logic bug in `ai/military.ts`'s siege-conduct branch: it checked `if (targetBuilding === 0)
setTarget else if (breaches > 0) assault` — but a breach RESETS `targetBuilding` to 0, so after
every breach the first arm re-fired and re-aimed at the next wall, and the assault arm was
unreachable. The trace showed a siege bombarding NINE walls to rubble (buildings 84/86/88/95/98/…)
over days 847-855 and issuing zero assaults, while a single `siege.assault` against that undefended
capital would have CAPTURED it outright on the first breach (`siege.ts`'s legacy path: no defender
⇒ `capture`). Fix: check `breaches > 0` FIRST — bombard only until a breach opens, then storm it
(exactly `military.ts`'s own documented intent, "the moment a breach opens"). One reordered branch.

**Measured, real, and the first non-inert result in this whole backlog:** the 12-campaign matrix
goes from `sieges: 3 begun, 0 captured · eliminated 0/4 everywhere` to **`sieges: 8 begun, 6
captured` with `eliminated=1/4` in all three `story` campaigns** — kingdoms are now actually
conquered (`pop=[0,…]`), capitals fall, and the extra sieges come from the captured seats being
fought over again. (`assaults` stays 0 by definition: the matrix's losers are PASSIVE kingdoms with
no garrison army, so their capitals capture outright without a defended-garrison assault — a new
`siege.captured` counter in `bench-balance.ts` is what makes this visible; `assaultsBegun` would
only tick on a defended capital, which needs either garrison-hold or an aggressive-vs-aggressive war
that survives the field.) Verified: full suite 460/460, golden replays and save corpus green (the
fix is inert across every pinned fixture — no siege in them reaches a breach — so no re-record);
`bench:scenes` budgets green; lint clean.

**Pivot noted honestly:** this was requested as "pursue garrison-hold," but tracing the real matrix
before building showed garrison-hold would not have moved the matrix's zero-assault/zero-conquest
number — the ordering bug did. Garrison-hold remains a valid, separate improvement for the symmetric
AGGRESSIVE-vs-AGGRESSIVE mutual-annihilation case (part 6's probe) and for producing DEFENDED-castle
assaults (a real `siege.assaultBegun` rather than a walkover capture), but it is no longer on the
critical path to "wars produce conquest." War-cadence chain now: declare ✓ · discover ✓ · commit ✓ ·
keep conducting ✓ · reach the castle ✓ (vs a passive foe) · **take the castle ✓ (part 7)**. Still
open, lower priority: `fair`/`hard`/`brutal` produce 0 sieges (only `story` does — a
difficulty-correlated war-window question); defended-capital assaults (needs garrison-hold); and
conquest becoming a WINNING condition (prosperity still resolves by year 15 before a conqueror can
sweep the map — the victory-pacing item from part 1, still open).

**1.x war-cadence backlog, part 8 (2026-07-18) — AI roster adoption shipped for 1.0; correct,
tested, and DORMANT for a newly-measured upstream reason.** Context: 1.0 content-completeness made
the M45 roster (swordsman/crossbowman/knight/ram/trebuchet) recruitable at last — previously they
were defined and tech-unlocked but absent from the Barracks `recruits` list, so nothing could ever
train them. The player half is a `UnitDef.requiresTech` gate enforced by the recruit command
(default-open hook; campaign wires `researchGame.isKnown`). The AI half, requested explicitly
rather than deferred, is a stateless class ROTATION in `ai/military.ts` (`pickRosterRecruit`, a
pure function): slot = own unit count % 4 over `[line, ranged, line, cavalry]`, each slot taking
the best UNLOCKED unit of its class, with siege engines only under `ConquestWar` with an army
raised and under a 2-engine cap. This is deliberately mechanism-not-scoring — it yields mixed
armies with an infantry backbone that upgrade themselves as warfare techs land, without adding a
utility surface to tune. Gated on `rosterAdoption` (harness wrapper opts out) so the pinned
M22–M46 outcomes stay byte-identical.

**Measured status — the rotation currently changes nothing, and the reason is new information.**
A/B runs (rotation on vs off; `fair`/`brutal`/no-difficulty; 50–60 years; conquest-only and full
victory sets; 3 and 4 kingdoms) are IDENTICAL in winner, year, wars, and recruits — because in the
REAL composition (`composeCampaign`, content personalities, i.e. the only place the rotation is
switched on) **the AI never builds a barracks at all**: a plan trace shows 17,386 `village.build`
rejections for `insufficient base:resource.wood (0/20)`. The AI is resource-starved long before
military ambition is the binding constraint, so no recruit of any kind is ever issued. Note the
complementary asymmetry that hid this until now: the flat harness matrix from parts 1–7 DOES fight
(wars, sieges, conquests) but pins `rosterAdoption: false` by design, while the real composition
has it on and cannot militarize — so AI roster adoption is unobservable in both today. This is why
the change carries zero golden/corpus drift: nothing it touches ever executes.

**Recorded as accepted for 1.0, not forgotten:** (1) the rotation ships and will activate on its
own once the economy blocker clears — no further AI work is needed to make adoption real, and the
blocker is squarely an economy/worldgen concern (village start sites without reachable wood), not
an AI one; (2) AI TECH-PRIORITY tuning is explicitly DEFERRED post-1.0 — the research manager
researches cheapest-available-first and only under `TechRace`, so cheap gates (Barracks Discipline,
Siege Basics) land on a normal timeline while the capstones (Combined Arms → Knight, Trebuchet
Engineering → Trebuchet) stay late and personality-flavoured. Making warmongers prioritise the
warfare branch means changing the plan→manager mapping that the M46-pinned pacing rests on; that is
the balance rabbit hole this backlog exists to keep out of the freeze. Consequence accepted for
1.0: even once the AI recruits, knights and trebuchets will be rare in AI armies.

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

## Phase 8.1 — One Castle (M55–M61, post-1.0 — added by revision R3, CHARTERED)

Chartered by ADR-4 Amendment A1 (doc 15): the M28 on-map castle mechanic is retired ENTIRELY —
one castle/defence system, the M51 layer; no wall, gatehouse or tower buildable on the village map
by anyone. The A1 scope fork was **ratified by the owner on 2026-07-21 as option (C): keep-gated
derived layers** — defence is gated on the Keep as an ordinary village-map building (recategorised
out of `castle`), layouts are DERIVED from content templates rather than hand-built, they
strengthen with village tier, and the layer is uniform across capitals and non-capitals. Capital
status stays POLITICAL (M53 annexation), not military. Implementation is chartered; the milestones
below are ordered so that the vertical slice proves the single resolution path before any deletion
breadth (M55), every behaviour change lands before the save/corpus pass that has to absorb them
(M60), and balance recert closes the phase AFTER the footprint change that moves the numbers
(M61).

| M | Milestone | Goal / Key work | T (test objective) |
|---|---|---|---|
| M55 | Single siege path (vertical slice) | `siege.begin` eligibility = standing defence layer only; delete the legacy assault branch, `siege.setTarget`, the bombard-vs-`Fortification` daily, `breaches`/`targetBuilding`; siege save v2→v3 migration (fields dropped; saved sieges of layer-less castles lifted); encirclement/starvation/sortie/lift unchanged (ADR-4 §2 pacing intact); player-besieges-AI and AI-besieges-player both resolve end-to-end through M51 | full suite green with the legacy path deleted; a siege v2 save migrates and resumes hash-stable; goldens/corpus re-recorded intentionally |
| M56 | Retire village-side fortification | reject `category: 'castle'` in `ops.place()` + drop from the build catalog (policy, per A1); delete `planCastleRing` and `ai/military.ts`'s ring block; delete castles.ts enclosure/defense-graph/`isCastle` derivation, re-homing `Fortification` into the defence module; `AiWarTarget.isCastle` := layer eligibility; occupation drops its `isCastle` exemption (the layer hook stays); delete `castles.test.ts`, add rejection coverage | a castle def is rejected by village placement for player AND AI issuers; in one campaign an AI both besieges a capital and occupies a non-capital |
| M57 | Keep-gated derived layers (the (C) core) | re-key the layer from kingdom to VILLAGE — `defenceMapSeed`, `DefenceStructure.kingdom`, `occupancyFor(k)`, the `{ k, seed, version, tiles }[]` save section, `AiDefenceOptions`, `defence-genesis`'s `kingdomCount` loop — with a section migration mapping a shipped per-kingdom layer onto that kingdom's capital village; recategorise `base:building.keep` from `castle` to `military` so M56's placement guard needs no allowlist; generalise `defence-genesis` to materialise a keep-bearing village's DERIVED template idempotently-by-presence; derived templates as content, ADDITIVE by tier with a validator enforcing it; a defence `SettlementNeed` proposing the Keep, replacing `planCastleRing` | building a Keep in a non-capital village materialises its layer and makes the village assault-resolved instead of occupation-flipped; a village tier-up spawns only the NEW template entries, healing nothing and duplicating nothing; a Phase-8 save's per-kingdom layer migrates onto its capital with defences intact |
| M58 | Keep-panel repair | Repair action on the Keep's village panel costing `def.cost × (1 − hp/maxHp)` summed over the village's structures — no repair-cost table; BLOCKED while a siege is active on that village; paid from the VILLAGE's stores; commits stone immediately and sets one `repairingUntil` field so the strike-again-before-they-recover window survives; mirrored in the M52 daily manager below its stone reserve | a damaged layer returns to full only after the repair window elapses; repair is refused during an active siege; an AI castle damaged across two wars is repaired without player input; closes the PRE-EXISTING M51 gap (assault.ts:469 writes damage and never despawns; nothing restored hp) |
| M59 | Footprints, readability & zoom | real multi-tile footprints on the layer as CONTENT values (Keep 7×7, Tower 3×3, Gatehouse 3×2 + a 2×3 orientation twin, Wall stays 1×1) with hp re-scaled per frontage tile; gatehouse given an actual role (toughness-aware `pickWallTarget`, garrison cap, entries in all three templates); tile scale as config; render readability (ground visible around structures, keep drawn as a distinct structure not a flat block, wall segments joined rather than separate squares); ~3× tile scale with a viewport offset and pan | placement, hit-test and draw all agree at multi-tile footprints and at scale; a click at any pan offset resolves to the tile under the cursor; footprint/scale values changed in content alone shift behaviour with no code edit; every template still builds all its towers (no silent skips); the gatehouse is no longer dominated by the wall |
| M60 | Legacy saves & corpus | grandfathered M28 structures: load as inert ordinary buildings (occupancy-blocking, demolishable, no graph, no siege meaning); `isCastle` deprecated-in-schema; add an M28-era fixture save to the corpus; torture pass | the M28-era save loads and resumes hash-stable with its walls standing-but-inert; corpus green including the new entry |
| M61 | Docs & balance recert | GDD §7 rewrite (single system), doc 06 §4 `defenseGraph`/`isCastle` removal, doc 07 §5 delta; bench-balance matrix re-run — war cadence with rings gone (AI castles are now only capitals); Gate P8.1 | balance bands hold; siege/capture cadence no worse than the war-cadence-part-7 baseline |

**M59 detail — sizes, and why they are not free parameters.** The map is 100×100 with a 17×17
guaranteed-open centre (`KEEP_CLEARING_RADIUS = 8`); a finished concentric castle spans only
~21–23 tiles, so the keep has offsets −3..+3 before it meets ring 4 or the motte's ±3 garrison
anchors. Two constraints decide the numbers. (1) **Odd sizes centre, even sizes do not** — the
keep is placed at `CENTRE − floor(w/2)`, so today's 2×2 sits half a tile off-centre (invisible at
1×1, obvious at 3× zoom); 5×5 and 7×7 centre exactly. (2) **Any tower above 1×1 silently deletes
towers from AI castles** — placement is ORIGIN-anchored so footprints grow toward +x/+y, a 2×2
tower at concentric's (−6,−6) covers (−5,−5) which is a ring-5 wall corner, walls are plan entry
#1, and `ai/defence.ts` SKIPS occupied tiles rather than failing. Tower size is therefore gated on
centre-anchored placement, not on picking a number. 7×7 keep additionally needs the motte's ±3
anchors pushed outward; 5×5 is the zero-template-churn fallback.

**M59 detail — hp must move with footprint.** A multi-tile structure is ONE entity with ONE hp
pool, so three separate walls (3 × 200 hp, broken one at a time) are not the same as one 3-wide
structure at 200. Enlarging a footprint without re-scaling hp makes every structure dramatically
weaker per tile of frontage. Target values:

| | Footprint | Frontage | hp | hp/frontage | Cost |
|---|---|---|---|---|---|
| Wall | 1×1 | 1 | 200 | 200 | 8 stone |
| Gatehouse | 3×2 / 2×3 | 3 | 450 | 150 — the deliberate soft spot | 20 wood + 35 stone |
| Tower | 3×3 | 3 | 750 | 250 | 70 stone |
| Keep | 7×7 | 7 | 1400 | 200 | unchanged (cost lives on the village-map def) |

**M59 detail — the gatehouse needs a role, not just a size.** As shipped it is STRICTLY DOMINATED
by the wall: costlier (15 wood + 10 stone vs 8 stone), less hp (150 vs 200), less armour (3 vs 5),
no compensating mechanic — there is no reason to build one. It is also mechanically inert on the
layer: `pickWallTarget` (assault.ts:329) scores blockers purely by Manhattan distance to the keep
centre and ignores hp and armour entirely, and grepping `'gate'` across the sim finds only the
type union and `intel.ts` treating it exactly like a wall. (The content file's "a real chokepoint,
not a hole" describes M28's ENCLOSURE algorithm, which A1 deletes.) No shipped template contains a
gatehouse either, so AI castles are solid gateless rings. Three fixes, all inside M59: rotation
via TWO DEFS with swapped footprints (the schema has no orientation field), surfaced in the UI as
one palette button with a rotate toggle so the twin stays an implementation detail; a
toughness-aware `pickWallTarget` weighing hp/armour alongside distance so the column actually
prefers the gate; and `military: { garrisonCap: 8 }` plus gatehouse entries on each wall face of
all three templates, which is what finally gives AI castles gates.

**Phase 8.1 open item (from A1, must resolve before M59 begins).** Under (C) the Keep exists at
TWO scales — a 2×2 village-map building (where cost and the `requires.villageTier` gate live) and
a substantial central structure on the defence map — but `def.footprint` is one field on one def.
Resolve as either a separate defence-map def spawned by the derivation, or an optional second
footprint field. The two values must not be conflated: village-map footprint prices the
investment, defence-map footprint is occupancy on the assault flow field.

Interaction notes: the FOOTPRINT work at M59 is sequenced after M56/M57 because it is only
cleanly defence-only once village-side fortification is gone and the layer is village-keyed. Its render side is already footprint-driven
and needs no fix — draw uses `r.w/r.h` (main.ts:1199), the hit-test spans the footprint
(main.ts:1171), and the build click clamps the origin by `w`/`h` (main.ts:1263). What multi-tile
footprints DO expose: (1) click-to-place treats the click as the ORIGIN, invisible at 1×1 but
wrong-feeling for a large keep — needs centre-anchoring or a hover preview; (2) the current click
math is proportional over the whole canvas and is correct ONLY while the entire map is visible —
zoom/pan requires it to become tile-pixel arithmetic plus the viewport offset; (3) raising a
footprint changes what an ALREADY-SAVED structure occupies when `afterLoad` rebuilds occupancy
from defs, so previously-legal neighbours can overlap — needs a load-time reconciliation rule.
Determinism, seeded generation and map dimensions are genuinely untouched (`generateDefenceMap`
never reads building defs; `DEFENCE_MAP_SIZE` is unchanged) and the save FORMAT is untouched
(footprints are not serialised — `DefenceStructure` stores the def code and origin), but
BEHAVIOUR is not: placement/collision outcomes shift, so AI template building diverges and
goldens/corpus re-record — fold that into M57's re-record rather than paying it twice, and note
M60 (saves & corpus) deliberately follows M59 so it absorbs the footprint change too. The 1.x war-cadence backlog's remaining items are unaffected except that
`planCastleRing`'s part-1 fix is superseded by its deletion.

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

**R3 — M28 retirement chartered as Phase 8.1 ("One Castle") (owner-directed 2026-07-20, ADR-4
Amendment A1; scope option (C) RATIFIED 2026-07-21).**

- **Change:** seven milestones (M55–M61, "Phase 8.1 — One Castle") chartered as post-1.0
  scope: retire the M28 on-map castle mechanic entirely — single siege-resolution path (M51),
  village-side wall/gatehouse/tower placement removed for player and AI, legacy saves
  grandfathered, docs and real multi-tile footprints with readability and zoom
  on the layer, legacy saves grandfathered, docs and balance recertified. **The A1 scope fork was
  RATIFIED by the owner on 2026-07-21 as option (C)** — defence gated on the Keep as an ordinary
  village building (recategorised out of `castle`), layouts DERIVED from content templates rather
  than hand-built, strengthening with village tier, uniform across capitals and non-capitals — so
  (C)'s core lands as M57 and its Keep-panel repair as M58, and the phase is now CHARTERED for
  implementation rather than plan-only. Milestone order was corrected at ratification: balance
  recert (M61) now follows the footprint change (M59) that moves the numbers, and the save/corpus
  pass (M60) follows every behaviour change it has to absorb.
- **Why:** ADR-4 §6 ruled "two parallel fortification systems must not ship", but Phase 8 as
  shipped kept M28 alive as the non-capital path (the M51 scoping note's explicit grandfather).
  The 2026-07-20 investigation showed the coexistence is now load-bearing confusion: castle defs
  placeable on village maps through the ordinary catalog, an AI fortification loop
  (`planCastleRing`) whose part-1 fix serviced a mechanic slated for deletion, and a forked
  `siege.assault`.
- **Affected documents:** this doc (12); doc 15 (ADR-4 Amendment A1); GDD §7, doc 06 §4, and
  doc 07 §5 rewrites land inside M58, not before.
- **Affected milestones:** none shipped; Phase 8 (M49–M54) remains closed — this is new scope,
  not a reopening. The 1.x war-cadence backlog is unaffected except part 1's `planCastleRing`
  fix, superseded by deletion at M56.
- **Risk impact:** removes a standing two-system design risk and the M28 balance surface.
  Adds a one-time save-behaviour snap for M28-era saves (walls become inert; ex-castles become
  occupiable) — accepted, same class as OQ-9's re-derivation snap. Goldens/corpus re-record
  intentionally at M55/M56; M59's footprint change re-records too and should be folded into
  M56's rather than paid twice. Under (C), re-keying the layer kingdom→village is subsystem-wide
  and carries the phase's main regression risk; against it, (C) closes a pre-existing M51 gap
  (no repair path exists — damaged structures persist at hp 0 forever) that (A) and (B) leave open.
  M59 is a BALANCE change in a rendering change's clothes and needs the bench-balance matrix
  re-run with it, not after: footprints are occupancy on the assault flow field, so a larger tower
  blocks more approach and covers more ground with its `rangedArc`, a larger keep is reachable
  from more directions, and hp-per-frontage re-scaling moves every breach cost. It also fixes two
  pre-existing content faults surfaced on 2026-07-21 — a gatehouse strictly dominated by the wall,
  and templates that build no gates at all — either of which is worth correcting independently.
