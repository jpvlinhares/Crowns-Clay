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
| M60 | Legacy saves & corpus | **corrected at M56 execution — a blocking prerequisite the original scoping missed**: `Kernel.restoreState` throws a composition-mismatch invariant on ANY saved system name it doesn't currently register, and an M28-era save's `systemRngs` names `castle-defense-rebuild` (deleted at M56) — it fails BEFORE building-level grandfathering ever runs, so "M28-era saves hydrate unchanged" (A1) was false; fix with either a no-op stub system registered under the dead name, or `restoreState` tolerance for unknown saved system names, THEN: grandfathered M28 structures load as inert ordinary buildings (occupancy-blocking, demolishable, no graph, no siege meaning); `isCastle` deprecated-in-schema; add an M28-era fixture save to the corpus; torture pass. **Resolved at M60 execution**: chose the tolerance option, scoped by name (`RETIRED_SYSTEM_NAMES`, currently `{ castle-defense-rebuild }`) rather than a stub system, so no future save ever gains a dead-name entry and an unrelated unregistered name still hits the hard mismatch guard. M59's fallout (a grown footprint could make an already-saved structure overlap a previously-legal neighbour once `afterLoad` rebuilds occupancy) is resolved by one rule applied at both layers: a standing structure occupies the footprint it was PLACED with. On the village map that's literal — `BuildingCore` already persists per-instance `w`/`h`, hashed — so `rebuildDerived`/`demolish`/`raze` read stored w/h, falling back to the live def only when none was ever recorded (stored 0). The defence layer has no such field to fall back on (`DefenceStructure` stores only def code + origin, by design — the roadmap forbids serialising a footprint there), so a grown-footprint overlap there is the accepted one-time snap, made coherent with first-writer-wins occupy + owner-guarded vacate. Both changes are behaviour-neutral for every save current code can produce (stored footprint always equals the live def's at placement time), confirmed by all four goldens and the three pre-existing corpus entries re-verifying byte-identical with no re-record. | an M28-era save LOADS AT ALL (the newly-exposed gate); it then resumes hash-stable with its walls standing-but-inert; corpus green including the new entry |
| M61 | Docs & balance recert | GDD §7 rewrite (single system), doc 06 §4 `defenseGraph`/`isCastle` removal, doc 07 §5 delta; bench-balance matrix re-run — war cadence with rings gone (AI castles are now only capitals); Gate P8.1 | balance bands hold; siege/capture cadence no worse than the war-cadence-part-7 baseline |

**Gate P8.1 (verified 2026-07-23):** all seven milestones (M55–M61) shipped, closing the ADR-4
Amendment A1 retirement chartered by R3. Global DoD checks: `npm run build` clean · `npm run lint`
clean (four `no-non-null-assertion` violations caught and fixed at M61's own gate check — none
had been run since M60 landed, i.e. this gate is what caught them, not a prior milestone) · full
suite 465/465 green · `npm run replay:verify` all four golden replays byte-stable (unchanged since
M59 — M60/M61 are both behaviour-neutral for every fixture current code can produce) ·
`npm run save-corpus:verify` all four corpus saves resume clean (including M60's new
`legacy-castle-m28-v1`). Doc 11 §2 sim budgets (`npm run bench:scenes all`): war-max 0.080
ms/tick, ai-8k 0.209 ms/tick, late-campaign 0.448 ms/tick — all ≤10 ms budget, comfortable
headroom at every scene (late-campaign up from Gate P8's 0.357 — larger M59 footprints mean more
occupancy tiles per structure — still far inside budget). Balance re-run on the SAME methodology
the war-cadence-part-7 baseline used (`npm run bench:balance`, the flat harness — the only place
war cadence is actually observable; the unified `--real` composition never once declares a war in
this matrix across 2- and 4-kingdom runs at every difficulty, a pre-existing prosperity-outpaces-
war pacing gap tracked separately, not moved by Phase 8.1): 12 campaigns (4 kingdoms × 100y × 4
difficulties × 3 seeds), `sieges: 24 begun, 0 assaulted, 23 captured` — well above part-7's 8
begun / 6 captured floor — 34 wars declared / 22 ended, both conquest and prosperity victory types
seen organically, zero peacetime starvation, all 12 campaigns reach a victory before the year cap
(SC-2 holds). `npm run bench:assault` — the matrix actually sensitive to M59's footprint/hp-per-
frontage rescale — still holds the M54 bands: garrisoned templates (`g30`/`g60`) repel a light
raid (`a20`) outright, a keep-only village (`g0`) falls to any host, 0% max origin deviation over
0 contested configs (no dominant approach despite the larger keep/tower sizes). Design-doc
reconciliation: GDD §7 rewritten as a single-system description (M28/Phase-8/Phase-8.1 history
compressed to one closing paragraph, no more delta-bolted-onto-primary structure), §8's two
orphaned "defence graph" references corrected alongside it; doc 06 §4's `isCastle`/`DefenseGraph`
block and §2's `category: castle` note rewritten to describe the retirement, `isCastle` kept
deprecated-in-schema rather than removed; doc 07 §5 gained the M55–M61 delta note the M52 entry
promised (`planCastleRing` deleted, template AI no longer capital-only). No outstanding rewrite.
**Phase 8.1 — One Castle is closed.** ADR-4 §6's "two parallel fortification systems must not
ship" now holds structurally: `game/castles.ts` and the legacy breach-gated assault path are
DELETED, not merely unreachable — there is exactly one castle/defence system in this repository.

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

## Phase 9 — The Game (M61.5–M67, post-1.0 — added by revision R5, CHARTERED)

Chartered by the **M61.5 release review** (2026-07-27) with ADR-5 and ADR-6 (doc 15). The verdict was
**Not Ready for Release**, on the same shape of finding as M47.5's: the letter of the roadmap is
satisfied and its substance is not. M47.5 found every Phase 3–5 system verified only in a standalone
harness. M61.5 found the successor failure one level up — systems verified only as FUNCTIONS. The
496-test suite, four byte-stable golden replays, four corpus saves and three benchmark scenes
between them never ask whether the COMPOSED GAME produces a good outcome, and the one tool that does
(`bench:balance --real`) was never a gate.

What that hid, measured on the shipping composition (16 campaigns × 60 years, 4 difficulties, 2
seeds): **11 wars declared, 4 sieges begun, 0 assaults resolved, 0 castles captured, 0 villages
occupied in 14 of 16 runs, 0 kingdoms eliminated, 0 capitulations, 0 new lords risen.** 13 of 16
campaigns end in a Prosperity victory in year 18–20 at EVERY difficulty. Villages stabilise around
~20:1 children-to-adults (measured: 374 children to 18 adults at year 40), so the adult workforce —
and with it food security, recruitment and war — never reaches scale. And `village.sendSettlers` has
no player surface at all, so the player is a permanent one-village kingdom while AI realms expand.

Consequence: Phases 4, 8 and 8.1 — the whole military/siege/castle investment, thirteen milestones —
are complete, tested, and never reached to a conclusion in the shipping game.

**Phase 9 adds NO new systems.** Every milestone repairs, surfaces, or measures something already
built. The M12 playability rule and ADR-3's composition rule bind as everywhere else.

| M | Milestone | Goal / Key work | T (test objective) |
|---|---|---|---|
| M61.5 | Release review (M1–M61) | formal internal review of the shipped game against the design set; four SIMULATION blockers named (no player expansion verb · inverted demographic pyramid · war that never concludes · victory monoculture); the art gap closed by repositioning rather than by work (ADR-6); Conquest's share rule ruled a defect (ADR-5) | review delivered; R5 ratified; ADR-5 and ADR-6 recorded |
| M62 | Balance instrumentation as a gate | `bench:balance --real` asserts outcome BANDS and exits non-zero; added to CI. Bands ratified 2026-07-27: (1) adult cohort — 10th-percentile village ≥30%, hard floor 15% on any village older than 10y; (2) war — ≥1 village changes hands in ≥50% of campaigns (GATED), aggregate rate REPORTED not gated; (3) victory timing — no victory before year 30 (GATED), median REPORTED; (4) monoculture — no single victory type in >60% of campaigns | the tool fails against HEAD on all four bands, and its failure report names which band broke — a gate written before the fixes cannot be reshaped to match them |
| M63 | The player's missing verbs | settler dispatch from the Village panel (target picker reusing the road-tool/footprint-preview pattern), surfacing `sendSettlers`' existing rejection vocabulary; **the missing ownership guard on `village.sendSettlers`** (`village.upgrade` has one, settlers.ts:264 does not — without it a player could dispatch settlers out of a rival's village); named save slots + a plain slot list (map thumbnails and mod metadata drop to post-release under ADR-6) | injector-free walkthrough: found a second village, save to a named slot, reload, resume · goldens and corpus verify BYTE-IDENTICAL (the guard is inert for AI issuers — verify, do not assume) |
| M64a | Demographic diagnosis | instrument the daily population update's per-village births / matured / senesced / deaths / migration / dispatch deltas and reconcile them against observed cohort change over 40 years. **Output is a written cause, not a fix** — nothing committed but a finding. Chartered separately because the review could NOT close the causal chain: the model's own constants imply a stable child:adult ratio of 1.3–2.5, not 20, and with 374 children maturation alone should feed ~27 adults/year into a cohort sitting at 18. Something removes adults that has not been found, and only two code paths write `pop.adults[]` | the observed cohort trajectory is fully explained by named terms; recalibrate-vs-redesign is DETERMINED, not guessed |
| ~~M64b~~ | *merged into M65 (owner-directed 2026-07-27, after the M64a finding)* | M64a proved the demographic inversion and the never-massing army are ONE defect — an unbounded recruiting policy — so splitting them would have paid two fixture re-records to fix one cause, and neither half's bands could go green without the other's change. The genuinely population-side residue (`SETTLER_PARTY`'s age mix, `FAMINE_MORTALITY`'s slope) folds into M65 as secondary scope | — |
| M65 | The military economy (was: war that concludes) | **Primary, per the M64a finding: give recruiting a CEILING.** Today every recruit gate is a FLOOR (`RECRUIT_MIN_ADULTS_REMAINING` 12, `RECRUIT_MIN_POPULATION_FLOOR` 20, `RECRUIT_MIN_FOOD_SECURITY` 0.95) with no notion of how large an army this kingdom should have, so it recruits at 10 adults/unit until it hits the floor, forever. Two coupled additions, both in `ai/military.ts`, no new system: (1) a WORKFORCE ceiling — army headcount capped as a fraction of the realm's adults, which is what makes M62's adult-cohort band structurally reachable; (2) an AFFORDABILITY ceiling — do not recruit what current upkeep capacity cannot sustain, which is what stops the recruit→desert→recruit churn (`military-upkeep` returned +695 adults to one village in 20 years; that is the churn, measured) and lets an army actually persist long enough to march. GDD §6's "standing army cost must force guns-vs-butter tension" is the design intent both serve. Secondary: `SETTLER_PARTY`'s 67%-adult mix; `FAMINE_MORTALITY`'s slope at mild hunger; `WAR_MIN_STRENGTH` (20) re-checked against what a capped army can actually field. Deferred unless the matrix demands them: the `MilitaryBuildup` plan monoculture (81% of plan-choices) and garrison-hold — both are war-CADENCE levers, and the cadence question cannot be read honestly until armies stop dissolving | M62's adult-cohort AND war bands both green — they are one fix, so they pass or fail together · 50-year age-structure property test green · food security ≥0.95 sustained in a developed village. Named baselines: flat harness 24 sieges begun / 23 captured (Gate P8.1); `--real` 4 begun / **0 captured**, 0/16 campaigns saw a village change hands (M61.5/M62) |
| M66 | Victory semantics & pacing | **SHIPPED as elimination-only Conquest + a re-paced Prosperity** (the taken-village share of ADR-5's option (b) was built, measured at 0 wins in 16 campaigns, and deleted — owner decision 2026-07-27; see the M66 scoping note). Prosperity happiness 80→75 and realm population 60→90, both set against measured joy/heads rather than guessed | M62's monoculture band GREEN (prosperity 56%); the year-30 and changing-hands bands hand to M67 · no fixture re-record — correct outcome, WRONG REASON as recorded ("victory state is not hashed"); it is hashed, but no fixture window is long enough for it to diverge. Corrected by M69 |
| M67 | Onboarding, docs & Gate P9 (INHERITS M66's two open bands) | tutorial extended for REACHABILITY (one event per major system naming the panel and its gate — the Keep→castle gate above all, currently thirteen milestones hidden behind an unexplained precondition); ADR sweep for the five cuts M61.5 found with no decision record — **markets & the trade economy, village tiers 3–4, village specialisation, the battle order vocabulary (OQ-7 was never ratified against M27 data as its own record required), the advisor appointment UI**; README status table brought to M61 + Phase 9; doc 07 §3's now-stale "roster adoption is INERT" note corrected (measured: the AI does raise barracks and does recruit a mixed roster); Gate P9. **Inherited from M66:** the earliest-victory floor (a y29 prosperity, one year under — weigh that the matrix runs 60y while the shipped cap is 100 before touching a ratified band) and the changing-hands band (13%, needs AI war competence, which no Phase 9 milestone owns) | every cut is either recorded or scheduled; docs carry no claim the build does not honour; Gate P9 recorded in this doc in Gate P8/P8.1 format |

**Phase 9 sequencing note — ordered by FIXTURE COST, not by importance.** M62, M63 and M64a are
hash-inert (tooling, app/UI, and a throwaway probe), so the whole first wave costs zero fixture
walks and no Opus fixture session. **M65 and M66** each move behaviour and each carries ONE
re-record. The two are deliberately **not batched with each other**: folding them into a single
re-record would save one diff walk and cost single-cause attribution on every moved hash — and a
wrong balance change hiding behind a right one inside a green re-recorded fixture is precisely the
silent-failure mode this project's hard-stop-before-record rule exists to catch.

*Revised after the M64a finding (2026-07-27):* the original three-re-record plan assumed M64b
(population) and M65 (war) were separate causes. They are not, so merging them REMOVES a re-record
rather than batching two — the merged M65 still has exactly one attributable cause, which is the
property the no-batching rule protects. Predicted scope: **M65** moves `terra-demo` +
`campaign-demo` and all four corpus resume hashes (recruiting changes AI behaviour in campaign
compositions; the settler/famine secondary scope reaches terra too — constants and gating only,
**no schema change, no migration**); **M66** moves `campaign-demo` + `campaign-tick500-v1` only,
plus a victory-section v1→v2 bump, and if a terra fixture moves under M66 that is a signal to stop,
not a nuisance to record.

*Corrected by M65's actual execution (2026-07-27):* M65 moved **two** fixtures, not six —
`campaign-demo` and `campaign-tick500-v1`. Terra stayed byte-identical because the settler/famine
secondary scope was never started (it defers with M64b's inherited scope), and because the
recruiting ceilings proved entirely hash-inert: no committed fixture runs long enough (3000 ticks
≈ 125 days) for a barracks to exist, let alone a recruit. The prediction was right in KIND and
wrong in BREADTH, on the safe side — the diff walk checked a wider set than actually moved.

**M67 scoping note (shipped 2026-07-27):** the phase's truth pass. Five ADRs recorded for cuts the
build had been carrying undocumented — **ADR-7** markets/prices/trade economy, **ADR-8** village
tiers 3–4, **ADR-9** village specialisation, **ADR-10** the battle order vocabulary (which also
CLOSES OQ-7, dangling since M27), **ADR-11** the advisor appointment UI. Every one was re-verified
against the code before being written, not trusted from the review's notes. ADR-11 additionally
CORRECTS ADR-1, which had justified cutting characters partly on the claim that advisors were
"exactly what the player already sees" — they are not: `kingdom.appoint` has zero callers in
`packages/app`, so the player sees a salary line for officials they can never meet. Recorded as a
correction rather than by editing ADR-1, matching how ADR-4's A1 corrections were handled.

Doc 07 §3's "roster adoption is currently INERT" caveat is retired: it claimed the AI never raises
a barracks, and M64a measured 190 units recruited across 4 kingdoms in 20 years as a genuine mixed
roster. README's status table, frozen at M54, now runs to M67 (13 rows, including M61.5 and all of
Phase 9).

**Reachability tutorial** — five steps naming the panels the old six-step economy tutorial never
mentioned (diplomacy, research, military, victory, and above all the KEEP, which gates the entire
castle layer and which nothing previously told the player about). The first trigger design was
WRONG and measurement caught it: `village.happiness >= 55` defers nothing, because a fresh village
is already content, so the diplomacy step fired at tick 10 — day one, ahead of the welcome message,
and inside the single-kingdom terra sandbox where there are no neighbours to talk to. All five are
now gated on `village.tier >= 2`, which is also the mechanically correct anchor (the Keep's own
`requires.villageTier: 2`), spread across distinct seasons. Known limitation recorded in the content
file: the DSL (OQ-3, DSL-only) has no predicate for "this composition has rivals", so a terra
sandbox reaching tier 2 still sees the campaign-half hints — tier 2 at least makes them late and
rare there.

**Fixtures re-recorded INTENTIONALLY (6).** Cause is event-code RE-INTERNING, not events firing:
`game/events.ts` assigns codes by position in `[...db.events.keys()].sort()` and folds those raw
code numbers into a registered hash source (`onceFired`/`lastFired`/`pending`), so five new ids
sorting into the middle of the block renumber every event after them. Verified directly that no new
tutorial event fires inside the 3000-tick window — only `welcome`/`happiness`/`economy`, exactly as
before — and that the two fixtures with no fired events (`calendar-baseline`, `wanderers`) are
untouched. Predicted six, moved exactly six.

**M68 scoping note (shipped 2026-07-29):** un-chartered follow-up work, raised by the owner
after M67 while reading the research panel. Three defects, one theme — content that claims an
effect it does not have.

1. *The joy panel's food factor read an EMA, not today's meal* (fixed in `buildingEmitter.ts`;
   food at 0 still showed +40.8 joy because the panel fed `foodSecurity` — a smoothed average —
   into the same helper the sim feeds today's `eaten/need`). Reproduced at +36.4 points on day 1.
2. *"Granary" renamed to "Warehouse"* (display name and the "Warehouse Design" tech; the id
   `base:building.granary` is unchanged, so no save or fixture sees it).
3. *Every `unlocks.buildings` claim in the tech tree was inert* — see **ADR-12**. Nine became real
   `BuildingDef.techBoost` effects at ×1.5; the other eight were deleted. The generalised
   `{ tech, multiplier, applies }` shape replaced the `outputBoost` field shipped hours earlier in
   the same phase: the Scribe's Hut has no recipes to boost, and rather than grow a second
   near-identical field (and then a third for storage, a fourth for garrisons) the discriminator
   went in while exactly two content entries and two tests depended on it.

**No fixture re-record.** Verified, not assumed: all 4 golden replays and all 4 corpus saves are
byte-identical. **(M70's isolation run later proved this was true and MEANINGLESS as evidence — see
the M70 isolation note. M68 moved four of five M62 bands over 60 years; the fixtures run 125 days.
The milestone's "no existing balance moves" claim was false and `bench:balance` was never run.)** Techs are coded by id (positional over `[...db.techs.keys()]`), and no id, tier,
cost or prerequisite moved — only `unlocks`, `desc`, and new `techBoost` fields, none of which is
folded into a hash source. The behavioural risk was Written Records: a tier-1, cost-20 tech that
now boosts the Scribe's Hut, and therefore plausibly *is* researched inside a fixture window.
It is not — `campaign-demo` and `campaign-tick500-v1` both verified green.

**What this milestone does NOT fix.** **58 of the 72 techs do nothing** beyond counting toward the
era-breadth gate and nudging the AI's `researchOpportunity` score, and eight buildings lost their
(fake) tech association without gaining a real one. Only two routes from a tech to a game effect
are wired at all: `BuildingDef.techBoost` (9 techs, new here) and `UnitDef.requiresTech` (5 techs,
M45). `TechDef.modifiers` is used by 0 of 72; `unlocks.edicts` (3) is not checked by
`kingdom.enactEdict`; `unlocks.wallTier` (2) has no reader outside the validator; and of the 8
`unlocks.units` claims only the 5 that coincide with a real `requiresTech` gate bite — Spear
Tactics, Archery Corps and Heavy Cavalry name pre-M45 units that were never gated.

The honest path for those eight buildings is the remaining four `applies` kinds — `storage`
(Warehouse ← Warehouse Design, a tech named for a building it never touched), `service` (Tavern,
Well), `garrison` (Barracks) and `defense` (Wall/Gatehouse/Tower/Keep) — each a real sim change in
a different system, deliberately not bundled here. ADR-12 records this rather than leaving it
implied.

*(A first pass at this note said 51. That count credited every tech declaring an `unlocks` block
with having an effect — which is precisely the assumption ADR-12 exists to refute. Re-derived from
content: 72 − |techBoost ∪ requiresTech| = 72 − 14 = 58.)*

---

**Gate P9 (assessed 2026-07-27) — NOT PASSED: 3 of 5 ratified bands green. Phase 9 is NOT closed.**

All eight milestones shipped (M61.5 · M62 · M63 · M64a · M65 · M66 · M67, with M64b merged into M65
by R6). Global DoD checks are green: `npm run build` clean · `npm run lint` clean · full suite
**496/496** · `npm run replay:verify` all four goldens byte-stable · `npm run save-corpus:verify`
all four corpus saves resume clean with **0 migrations** · `npm run save-corpus:torture` 5
save/load cycles per entry, hash stable throughout. Doc 11 §2 sim budgets
(`npm run bench:scenes all`): war-max 0.159 ms/tick, ai-8k 0.303, late-campaign 0.220 — all ≤10 ms,
AI share ≤10.3% of a 30% budget. `npm run bench:assault` holds the M54 bands unchanged: garrisoned
templates repel raids, a keep-only village falls to a host, 0% max origin deviation.

**The gate criterion is M62's five bands, ratified BEFORE the fixes they measure. Final state
(`bench:balance --real --years 60 --seeds 2`, run on the shipping tree):**

| Band | M62 baseline | Gate P9 | |
|---|---:|---:|:--|
| adult cohort p10 (≥30%) | 6.8% | **46.1%** | ✓ |
| oldest-village floor (≥15%) | 5.1% | **35.5%** | ✓ |
| monoculture (≤60% any type) | prosperity 88% | **prosperity 56%** | ✓ |
| earliest victory (≥y30) | y9 | y29 | ✗ |
| campaigns changing hands (≥50%) | 0% | 13% | ✗ |

**What Phase 9 achieved.** The three demographic and victory-shape bands went from catastrophic to
comfortable. Villages are staffed by adults instead of being 95% children; the player can found
villages at all (M63 — the build shipped 1.0 with no expansion verb); victory outcomes are genuinely
mixed rather than a single track winning 88-94% of campaigns; and `story/9000 k=4` produced
`destroyed 1, risen 2`, meaning M53's kingdom-death and new-lords machinery executed in the shipping
composition for the first time since it was written at Phase 8.

**Why it is not closed, stated plainly.** Two ratified bands fail, and neither was tuned to pass —
that discipline held throughout the phase.

- *Earliest victory y29 (need ≥30)* is a one-year miss on one campaign of sixteen. It is NOT closed
  by nudging Prosperity, because prosperity wins must land inside [30, 60] for this matrix and five
  already land at y54 with two at y58; making Prosperity harder risks pushing them past the cap and
  breaking the monoculture band M66 just fixed. Note the matrix runs `--years 60` while the shipped
  `DEFAULT_YEAR_LIMIT` is **100** — this squeeze is partly an artifact of the short matrix, and any
  fix should weigh that before touching a ratified band.
- *Changing hands 13% (need ≥50%)* is the real one, and it is **owned by no milestone in this
  roadmap**. It needs AI war competence — armies that mass, march, and take a defended castle. R5
  chartered Phase 9 as "NO new systems", so this was structurally out of scope from the day the
  phase was written. It is the same root cause that made ADR-5's taken-village Conquest unreachable
  (0 wins in 16 campaigns) and that leaves the entire Phase 8 + 8.1 castle layer — thirteen
  milestones — still unexercised to a conclusion in the shipping game.

**Two structural findings this phase surfaced, recorded for whoever works here next.**

1. ~~*The victory tracker is not a `kernel.addHashSource` contributor.*~~ **WRONG AS STATED —
   corrected by M69 (2026-08-02); the conclusion survives, the reason does not.** `victory.ts` HAS
   registered `addHashSource('victory', …)` since **M37**, unconditionally, and `composeCampaign`
   registers victory unconditionally too. The fold is thorough (winner, defeated, everFounded, both
   streak maps, wonders). Verified three ways rather than re-read: adding `fold(4242)` to that
   source diverges `campaign-demo` at tick 100, so it IS reached; yet dropping
   `DEFAULT_PROSPERITY_HAPPINESS` 75 → 5 moves NOTHING. The real defect is **window length** —
   `campaign-demo` runs 3000 ticks = **125 days**, and victory needs years (90 realm population,
   multi-year streaks, a 10-year hegemony), so tracker state never diverges that early. The
   practical conclusion is unchanged and still binding: **do not read a green corpus as evidence
   about victory behaviour** — `victory.test.ts` and `bench:balance` remain that subsystem's only
   guards. But the fix is a LONG-WINDOW fixture (or an explicit decision to rely on
   `bench:balance`), not a hash source, and M69 was chartered against the wrong one. See the M69
   scoping note. This correction is recorded here rather than by silently rewriting the finding,
   matching how R4 handled ADR-4's A1 predictions.
2. *Event codes are positional.* Adding any event renumbers every event sorting after it and
   invalidates every content-bearing fixture, even when the new events never fire. Hashing the event
   ID string rather than its sorted index would make content additions fixture-neutral. Same class
   as M56's "re-homing `Fortification` moved its registration order."

**The decision this gate hands to the owner.** Phase 9 delivered its milestones and did not meet its
own criterion; declaring it closed anyway would be precisely the M47.5 failure mode — the letter
satisfied, the substance missed — that this project's whole review culture exists to prevent. Three
ways forward, none of them mine to take: (a) charter a Phase 10 owning AI war competence, which is
the only path that makes the changing-hands band, ADR-5's retired Conquest share, and the dormant
castle layer all reachable by one body of work; (b) accept the two bands as unmet and ship on ADR-6's
technical-build framing, with the war layer documented as dormant — defensible, provided the docs say
so plainly; (c) re-ratify the bands themselves, which is legitimate only as an explicit owner
decision and never as a way to turn a failing gate green.

**M66 scoping note (shipped 2026-07-27) — CLOSED on the monoculture band; two bands hand to
M67.** Two changes shipped, both in `game/victory.ts`:

1. *Conquest is ELIMINATION-ONLY* (owner decision 2026-07-27, superseding ADR-5's option (b)).
   ADR-5 re-based the share clause on villages TAKEN BY FORCE to preserve a mid-length military
   track. That was built, measured, and retired in the same milestone: 60% of all villages taken
   by force is ~8 on a 4-kingdom map and the shipped AI manages ~2 occupations across the whole
   16-campaign matrix, so the clause fired in **0 of 16** runs. Option (b) did not survive contact
   with the AI's actual war competence. `DEFAULT_CONQUEST_SHARE`, the `conquestShare` option, and
   the `takenBy` take-history were all DELETED rather than left inert — a defined-but-dead lever is
   exactly the confusion the gatehouse carried from M28 to M59. Conquest progress is now "rivals
   defeated / rivals total", so contestability still broadcasts as a realm closes on the last
   holdout. Consequence accepted and recorded: the war track stays effectively dormant until AI
   war competence rises, which is the same root cause as the still-failing changing-hands band.
2. *Prosperity re-paced*: happiness 80 → 75, realm population 60 → 90. Measured first, not
   guessed: under M65's tax baseline a peaceful realm runs joy 77-83 and a high-tax warlike one
   61-68, so an 80 bar sat at the very top of the range and could never be held 15 consecutive
   years — Prosperity had stopped firing ENTIRELY and chronicle took 94% of wins by default. 75
   stays comfortably clear of the ~70 fed-only baseline M47.8 warned about, so it still demands
   real investment, while discriminating builder from warmonger the way the track intends.

**Measured (`bench:balance --real --years 60 --seeds 2`):**

| Band | M62 baseline | M65 | M66 |
|---|---:|---:|---:|
| adult cohort p10 (≥30%) | 6.8% ✗ | 45.1% ✓ | **46.1% ✓** |
| oldest-village floor (≥15%) | 5.1% ✗ | 27.9% ✓ | **35.5% ✓** |
| monoculture (≤60%) | prosperity 88% ✗ | chronicle 94% ✗ | **prosperity 56% ✓** |
| earliest victory (≥y30) | y9 ✗ | y29 ✗ | y29 ✗ |
| campaigns changing hands (≥50%) | 0% ✗ | 13% ✗ | 13% ✗ |

**Three of five bands now pass.** Victory outcomes are genuinely mixed for the first time —
prosperity 9, chronicle 7, firing at years 29/34/38/54/54/54/58/58 instead of never. And
`story/9000 k=4` produced **`destroyed 1, risen 2`** alongside 2 sieges and an occupation: M53's
kingdom-death and new-lords-rising machinery executing in the shipping composition for the first
time since it was written.

**A predicted null result, verified rather than assumed.** Removing the share clause was expected
to change matrix OUTCOMES not at all, because the clause already won nothing. The re-run
reproduced the previous run line-for-line — same winner, year, and populations in all 16
campaigns, same four band figures. Stated before running, confirmed after.

**Structural finding — the victory tracker is NOT a `kernel.addHashSource` contributor.** Its
state never folds into `stateHash()`, so no golden replay and no save-corpus resume hash can
detect a victory-logic regression, ever. M66's fixture-neutrality is therefore STRUCTURAL, not
luck, and `victory.test.ts` plus `bench:balance` are the only guards this subsystem has. Worth
knowing before anyone trusts a green corpus as evidence about victory behaviour.

**A test that passed for the wrong reason, found while changing the rule.** `conquest: controlling
the required village share wins` kept passing after the rule change — but via the ELIMINATION
clause, because reassigning every village to one kingdom starves the others into last-village
defeat. Its name claimed it proved share math; it proved nothing of the kind. Rewritten, and the
suite now carries an explicit regression test for the original defect (`holding most of the map
never wins while a rival still stands`).

**Handed to M67:** the two failing bands. *Earliest victory y29* — `hard/9000` fires prosperity
one year under the floor; a 15-year streak plus a 90-head gate lets a fast realm start its streak
at y14. Deliberately NOT tuned, because Prosperity wins must land inside [30, 60] for this matrix
and five already land at y54 with two at y58, so making Prosperity harder risks pushing them past
the cap and breaking the monoculture band M66 just fixed. Note also that the matrix runs
`--years 60` while the shipped `DEFAULT_YEAR_LIMIT` is **100** — the squeeze is partly an artifact
of the short matrix, which M67 should weigh before touching a ratified band. *Changing hands 13%*
— unchanged from M65 and not victory-shaped at all: it needs AI war competence (armies that mass,
march, and take a defended castle), which is the war-cadence work no milestone in this phase owns.

**Fixtures: NONE moved.** All four goldens and all four corpus saves byte-identical, no re-record,
and the victory section stays **v1** — the Conquest rule changed but its STATE did not, since
elimination reads the tracker's existing `defeated` set. A v2 section plus a `takenBy` migration
was built for option (b) and removed with it rather than shipped as dead weight in every future
save.

**M65 scoping note (shipped 2026-07-27) — CLOSED on its two demographic bands; the three
remaining bands hand to M66.** Three changes shipped, all in the AI layer, all flag-gated
(`recruitCeilings`, default true, harness wrapper opts out — the same convention every AI feature
since M47.8 uses):

1. *Workforce ceiling* (`MAX_ARMY_WORKFORCE_FRACTION`, `ai/military.ts`): army headcount homed at
   a village capped at a fraction of its POTENTIAL workforce (current adults + everyone already
   serving). This is the direct answer to M64a's finding.
2. *Affordability ceiling* (`canSustain`, an optional callback supplied by `campaign.ts`): don't
   recruit what `UPKEEP_SEASONS_BUFFER` (2) seasons of kingdom treasury + village food can't
   already sustain. `ai/military.ts` has no Kingdom/Stockpile access by design, so the composition
   computes it — and `extraReads` must carry both components or the access guard throws (a runtime
   check `tsc` cannot catch; found by running, not reading).
3. *Peacetime tax baseline* (`ai/economy.ts`): non-warlike plans tax NORMAL instead of NONE. See
   that module's doc for the full reasoning; this reverses a deliberate prior policy.

**Measured against the M62 bands** (`bench:balance --real --years 60 --seeds 2`):

| Band | M62 baseline | M65 |
|---|---:|---:|
| adult cohort p10 (≥30%) | 6.8% ✗ | **45.1% ✓** |
| oldest-village floor (≥15%) | 5.1% ✗ | **27.9% ✓** |
| campaigns changing hands (≥50%) | 0% ✗ | 13% ✗ |
| earliest victory (≥y30) | y9 ✗ | y29 ✗ |
| monoculture (≤60%) | prosperity 88% ✗ | chronicle 94% ✗ |

The two bands M65 was chartered to move are green. War is alive but rare for the first time in the
real composition — 3 wars declared, 2 eliminations, 2 occupations, and a **`conquest in year 29`**,
the first territorial victory this composition has ever produced (still 0 sieges: the castle layer
remains unexercised, inherited). The tax change also stopped Prosperity firing at all — taxation
costs happiness, so the ≥80-joy streak never sustains — which is why campaigns now run the full 60
years instead of ending at 18–20, why earliest-victory moved y9→y29, and why the monoculture FLIPPED
from prosperity to chronicle rather than dissolving. Populations grew markedly (92 → 105–182).

**Why the remaining three hand to M66 rather than staying open here.** All three are victory-shaped:
the monoculture is now an artifact of Prosperity never firing, and both it and the year-30 floor are
exactly what M66's Prosperity re-pacing exists to set. Chasing them from the military side would mean
tuning war constants to compensate for a victory-pacing defect — the wrong lever on the wrong
milestone. The changing-hands band is genuinely coupled to both (a campaign that ends at year 20
cannot show conquest; one that runs 60 years just did).

**Recorded against repeating it: the first `MAX_ARMY_WORKFORCE_FRACTION` was 0.15 and was a TOTAL
RECRUITING BLOCK, not a tight cap.** A fraction ceiling has a minimum viable village baked in —
the first unit needs `adults >= popCost / fraction`, i.e. 67 adults at 0.15 with `popCost` 10 —
and the shipping composition's villages hold ~30 adults at genesis and ~50 by year 20. It was
validated against a medium-map probe whose villages reached 322–343 adults and sailed past the
threshold. **The check to apply to any future balance constant: verify it against the scale the
SHIPPING composition actually reaches, not the scale a diagnostic probe reaches.** 0.30 admits the
first unit near 34 adults and `WAR_MIN_STRENGTH` near 47.

**Found in passing, NOT fixed (out of scope, reported not silently absorbed):** settler-founded
colonies starve to death within ~3 years. `SETTLER_CARRY`'s 60 food feeds a 30-person colony for
about 20 days and the construction manager does not raise a farm in time — a traced colony went
25 → 3 → 0.5 → dead between years 7 and 10 having completed only its village centre. This is
PRE-EXISTING and unrelated to M65's mechanism; M65 merely surfaces it far more often, because
richer source villages attempt far more foundings (14 in 20 years vs ~9 in 30 pre-change). It is
the likeliest remaining drag on the oldest-village floor and belongs with M64b's inherited
settler scope. Also noted for whoever reads the matrix next: **seed 9000 on `mapSize: 'small'`
never recruits in ANY configuration, before or after M65** — it is not a war-capable seed, so
diagnosing recruiting against it alone will mislead.

**Fixture impact — narrower than R6 predicted, and attribution was PROVEN rather than reasoned.**
Two fixtures move, both campaign-side: `campaign-demo` (diverges at tick 100) and
`campaign-tick500-v1`. R6 forecast terra fixtures moving too, but that was contingent on the
settler/famine secondary scope, which M65 did not start. The recruiting ceilings are **provably
hash-inert**: reverting ONLY the tax baseline while leaving both ceilings live at 0.30 returns all
eight fixtures to green, so 100% of the movement is the tax policy. Mechanically a village founds
at NORMAL, the old policy issued a day-1 `village.setTaxRate`→NONE and the new one issues nothing
(the idempotent check), so the hashed `VillageCore.taxRate` differs from the first sampled tick —
consistent with divergence at tick 100 (~day 4), far too early for any barracks or recruit.

**M64a FINDING (2026-07-27) — the population model is NOT the defect; AI recruiting is. The
M61.5 review attributed the symptom to the wrong subsystem.** M64a was chartered because the
review measured a ~20:1 child-to-adult ratio but could not close the causal chain — its own
arithmetic said the model's constants imply a stable ratio of 1.3–2.5, and that ~27 adults/year
of maturation should be refilling a cohort sitting at 18. That instinct was right: **nothing is
wrong with `population.ts`.**

*Method.* No source was edited. Every tick of a 20-year 4-kingdom campaign (seed 9000, medium map,
`aiFromIndex: 0`) was sampled for changes to `pop.adults[]`, bucketed by `tick % TICKS_PER_DAY`,
and each bucket matched to the system or command that owns that phase. Four writers appeared, and
every one is accounted for. Per-village, over 20 years:

| village | start | `population` (ph 3) | `army.recruitUnit` (ph 8) | `military-upkeep` (ph 5) | settler dispatch (ph 1) | = predicted | actual | children |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 28 | 15 | **+372.9** | **−834** | +695 | −60 | 188.89 | **188.89** | 389 |
| 30 | 15 | **+368.5** | **−314** | +20 | 0 | 89.51 | **89.51** | 431 |
| 32 | 15 | **+331.2** | **−306** | 0 | −20 | 20.21 | **20.21** | 340 |
| 34 | 15 | **+309.2** | **−290** | 0 | −20 | 14.21 | **14.21** | 294 |

Predicted equals actual to the decimal in all four cases — the trajectory is fully explained, which
is M64a's T objective.

*The cause.* `population.ts`'s daily update is a NET CONTRIBUTOR of +309 to +373 adults per village
over 20 years. What removes them is the AI military manager recruiting at `UnitDef.popCost` = **10
adults per unit** (militia/spearman/swordsman/archer/crossbowman all 10), gated only by
`RECRUIT_MIN_ADULTS_REMAINING = 12` — with **no cap on standing army size relative to workforce**.
The moment a village's adult cohort reaches ~22 and the food gates pass, 10 adults become a soldier;
the manager retries daily, so the cohort is clamped into a permanent 12–22 band. 190 units were
recruited across 4 kingdoms in 20 years. Children accumulate to 294–431 as the mechanical
consequence: births continue off the surviving adults (joy-scaled), maturation feeds adults, and
recruiting removes them again — the child cohort is a permanent waiting room.

*This also explains the "bimodality" the review flagged.* Villages 28/30 kept a workforce only
because their soldiers DESERTED BACK (`military-upkeep` returning +695 / +20 adults); 32/34 got
nothing back and were bled to 14–20 adults. The difference was never demographic — it was whether
the army an unaffordable upkeep dissolved happened to return its men.

*Counterfactual, already proven by the accounting:* with recruiting removed, the population system
alone takes a 15-adult village to ~324–388 adults against 294–431 children — an adult fraction of
**43–57%**, comfortably inside M62's ≥30% band. **M62's adult-cohort band is therefore not a
population-model gate at all; it is an AI-recruiting gate.**

*What remains genuinely in `population.ts`/`settlers.ts` scope,* both smaller than chartered and
neither responsible for the inversion: `SETTLER_PARTY`'s 67%-adult composition (visible above as the
−60/−20 columns) and `FAMINE_MORTALITY`'s slope at mild hunger (untested here — it was not a
material term in these runs, since these villages were rarely hungry).

*Consequence for the plan:* M64b and M65 now share one root cause, so their scopes overlap
substantially — see the M64b/M65 rows and the note below. **Nothing was committed but this
finding, per M64a's charter.**

**M63 scoping note (shipped 2026-07-27):** both halves shipped as chartered, both TOOLING/APP-LAYER
only — no golden or corpus re-record needed, confirmed (all four goldens, all four corpus saves,
byte-identical). *Settle tool:* `village.sendSettlers` never had an ownership guard —
`village.upgrade` (settlers.ts:431) already checked one, this command (settlers.ts:264) did not,
despite `campaign.ts:888` already wiring `settlerGame.setOwnershipGuard` for it — a gap that only
mattered once a player-facing dispatch surface could reach it. Fixed by mirroring
`village.upgrade`'s exact check; confirmed inert for the AI issuer (`ai/planner.ts`'s
`ExpandSettle` always dispatches with its own kingdom as issuer, from a village it owns). The
Village panel gained a "Found Village" armed-click tool (`main.ts`, mirroring the existing
`armedArmyAction`/`armedBuild` pattern exactly — same arm/disarm, same right-click/Escape cancel,
same mutual exclusion with Build/Road). **No live valid/invalid preview**: reusing the existing
`previewBuild` RPC was considered and rejected — it validates placement RELATIVE TO an owning
village's radius (`ops.validatePlacement(def, x, y, villageId)`), while founding validates a
GLOBAL site rule with no owning village (`dispatch`'s own call passes `null`) — building an
accurate live preview needs new sim surface, out of scope for "surface an existing verb." The
armed tool instead shows a neutral footprint outline (village-center's def size) and the founding
verdict itself surfaces through the pre-existing `village.rejected` toast, in the sim's own
words. Verified: build/lint/typecheck clean, full suite 496/496 unchanged, all fixtures
byte-identical, and a live walkthrough in the browser confirmed the arm→click→disarm cycle
resolves (the button correctly reverts to "Found Village" only after the click handler's settle
branch runs) — the sandboxed browser used for this session cannot compose/screenshot the canvas,
so the exact rejection toast text was not visually re-confirmed this session; `settlers.test.ts`
(unmodified, still green) is the authority for `dispatch`'s rejection-message behaviour.

*Named save slots:* the IndexedDB slot store (`saveStore.ts`) always supported arbitrary names —
only the toolbar hardcoded `'manual'`. Per ADR-6's trim, this ships as a plain list, not GDD §18's
full save browser: a text input names the slot `Save` writes to, and a new `listSlots` protocol
message (+ `slotsList` response) lets the worker peek at each stored slot's OWN header — `tick`
(via the already-exported `calendarFromTick`) and `campaign.kingdomCount` — to label the list
`{slot} — Year N · season · day D · K kingdom(s)`, falling back to a byte count if a slot's
payload doesn't parse. No new persisted state and no schema change: this is a read-only peek at
what saves already write. Confirmed live: the autosave that fires at the first season boundary
appeared in the list automatically with the correct detail line, and the save-result handler
refreshes the list after every save.

**M62 scoping note (shipped 2026-07-27):** shipped exactly as chartered — `bench-balance.ts` gains
a `VillageBand` sample (age since `village.founded`, adult fraction of cohorts) taken at each run's
final tick over every extant village, not just capitals, plus the four band computations and a
`balance-matrix` CI job (`--real --years 60 --seeds 2`, matching the figures this note records).
Both halves are TOOLING ONLY — no sim/app behaviour changed, so no golden or corpus re-record was
needed or attempted. Run against HEAD at the exact CI invocation:

```
M62 bands — adult cohort: p10 6.8% (oldest-village floor 5.1%) · war: 0/16 campaign(s) saw a
village change hands (0 total changes) · victory timing: earliest year 9, median 20 · monoculture:
prosperity at 88% of wins
M62 BAND FAIL: adult-cohort p10 6.8% < 30% floor · a village older than 10y has adult fraction 5.1%
< 15% hard floor · only 0% of campaigns saw a village change hands (need ≥50%) · a victory fired in
year 9 (need ≥30) · prosperity won 88% of campaigns (need ≤60% for any single type)
```

All four bands fail, exactly as the review predicted and sharper than its own estimates (88%
Prosperity monoculture measured here vs. ~81% estimated in the M61.5 review; 0% of campaigns saw a
village change hands, vs. the review's qualitative "0 captures/0 occupations in 14 of 16 runs" —
this run's larger per-campaign year count, 60 vs. the review's mixed sample, converts that to a
clean zero). The "earliest year 9" figure is itself Conquest's SHARE defect (a 2-kingdom campaign
out-settling its rival, ADR-5) — expect this specific number to move at M66 for a different reason
than the other three bands. **CI job added and EXPECTED RED** on this branch until M64b/M65/M66
land — recorded here so a future reader finds the explanation in the same place as the number,
not just in the job's own comment.

---

## Phase 10 — The War (M69–M75, post-1.0 — added by revision R7, CHARTERED)

Chartered from **Gate P9's own handover**, which named three ways forward and did not take one:
(a) charter a phase owning AI war competence, (b) ship on ADR-6's technical-build framing with the
war layer documented as dormant, (c) re-ratify the bands. **The owner took option (a) on 2026-08-02;
R7 is RATIFIED and Phase 10 is chartered.**

**The case for (a) over (b).** Gate P9 failed two of five ratified bands, and one of them —
`changing hands 13%` against `≥50%` — is downstream of a single missing capability. That same gap
already forced two other retreats this project has on record: ADR-5's taken-village Conquest clause
was **built, measured at 0 wins in 16 campaigns, and deleted** (M66), and Conquest is elimination-only
today not by design but because nothing else was reachable. Behind both sits the standing fact
Phase 9 opened with and closes with unchanged: **Phases 4, 8 and 8.1 — thirteen milestones of
military, siege and castle work — are complete, tested, and never reached to a conclusion in the
shipping game.** One body of work makes the band, the retired Conquest clause, and the dormant
castle layer all reachable. No other item on the backlog has that leverage.

**The measurement that scopes it.** ~~The assault code is not the defect... the flat harness reaches
24 sieges begun / 23 captured while the shipping composition reaches 4 begun / 0 captured.~~
**RETRACTED by M70/M70.5 — see R8 below.** That comparison was two spellings of the same outcome:
the harness sets `succession: false`, so a capital's fall publishes `siege.captured`, while the
shipping composition publishes `siege.capitalFallen`. `bench:balance` counted only the former. The
AI was concluding sieges the whole time, and the "0 assaults" beside it came from subscribing to
`siege.assaultBegun` — **an event no code in this repository publishes.**

**Phase 10 adds no new player-facing systems.** Unlike Phase 9's "NO new systems" rule, it does
change ARCHITECTURE in two places — event coding and modifier scope — because Gate P9 named both as
the standing tax on every other piece of work. Both land at the phase HEAD, before any behaviour
work, so their fixture cost is paid once. The M12 playability rule and ADR-3's composition rule bind
as everywhere else.

**Sequencing rationale (the M64a/R6 lesson, applied deliberately).** M70 is a diagnosis milestone
that commits **no fix** — the same shape as M64a, and for the same reason: Phase 9's one wrong turn
was a recruiting ceiling specified at 0.15 and validated against a probe at the wrong population
scale, which measured out as a total recruiting block. Diagnosis-before-fix is this project's proven
pattern and the phase's highest-risk milestone gets it. Conversely M71 is deliberately NOT split:
R6 dissolved M64b into M65 because two milestones would have paid two re-records for one root cause,
and the war-cadence levers M65 explicitly deferred belong to the same cause as the fix that enables
reading them.

| M | Milestone | Goal / Key work | T (test objective) |
|---|---|---|---|
| M69 | **SHIPPED** — Fixture economics & the victory blind spot (half re-scoped: the victory premise was wrong, see its note) | Gate P9's two structural findings, both paid at the phase head so later milestones inherit the cheaper regime. (1) **Hash event IDs by string, not sorted index** — `game/events.ts` codes events by position in `[...db.events.keys()].sort()`, so adding any event renumbers every event after it and invalidates every content-bearing fixture *even when the new events never fire* (M67 paid exactly this for five tutorial events). (2) **Register the victory tracker as a `kernel.addHashSource` contributor** — its state never folds into `stateHash()`, so no golden replay and no corpus resume can EVER detect a victory-logic regression; `victory.test.ts` and `bench:balance` are currently that subsystem's only guards | ONE intentional re-record, predicted hunk-by-hunk before recording · a deliberately-introduced victory-logic change is caught by `replay:verify` where it previously passed green — demonstrate the new guard actually guards · a new event added to base content moves NO fixture |
| M70 | **SHIPPED** — War diagnosis (finding only) | Explain the 24-begun/23-captured (flat harness) vs 4-begun/0-captured (`--real`) gap in named terms. Candidate paths to instrument, none pre-judged: `MilitaryBuildup` plan monoculture (**81% of plan-choices**, deferred by M65 as unreadable until armies stopped dissolving — they have); garrison-hold (deferred for the same reason, now due); `WAR_MIN_STRENGTH` (20) against what an M65-capped army actually fields; whether hosts mass or trickle; whether a besieger persists long enough to resolve; whether the AI ever chooses to assault at all | the begun-vs-captured gap is fully accounted for by named terms, reconciled against measured counts · recalibrate-vs-redesign is DETERMINED, not guessed · **no behaviour change in the commit** |
| M70.5 | **SHIPPED** (un-chartered) — Fix the instrument | Every war metric in `bench:balance` was wrong: `assaultsBegun` subscribed to an event **no code publishes**, `siegesCaptured` cannot fire in a composition with succession on, and the changing-hands band inherited both blindnesses | done — see its scoping note |
| M70.6 | **SHIPPED** (un-chartered) — Demographic diagnosis (finding only) | Settled whether M68's adult-fraction collapse is births or war consumption. **Births.** War refuted: the worst village never saw one | done — see its scoping note |
| M71 | **Decouple surplus from births** — the phase's real work | M70.6's cause, fixed. `population.ts`: `births = adults × BIRTH_RATE × fed × (0.5 + 0.5·shelter) × joyFactor` scales with food and joy and **saturates at nothing**, while `matured = children × MATURE_RATE` is FLAT. A village rich enough to fund a war therefore breeds children faster than maturation converts them, forever. This is the single coupling that makes the game's two equilibria mutually exclusive. Candidate directions, none pre-judged (M70.6 measured the cause, not the cure): saturate the `fed` term; make `MATURE_RATE` condition-responsive rather than flat; or give surplus a second sink (storage, trade, out-migration) so it need not become people. **Balance-affecting by construction — `bench:balance --real` is part of the DoD, not a follow-up** | **all five M62 bands green SIMULTANEOUSLY with M68's boosts left ON** — no tree state in this project's history has managed more than three (Gate P9: 3 · post-M68: 2 · boosts-off counterfactual: 3) · the matrix numbers appear in the scoping note, per M70.5's lesson |
| M72 | The severed approach | M70's bug, independent of everything above and confirmed at matrix scale. `resolveSpatialAssault` conflates *blocked by fortification* with *blocked by terrain*: its "fully walled off from this edge, enter anyway" fallback is right for a wall (breakable) and wrong for water (not). The column enters on an unreachable tile, `pickWallTarget` returns null, and the assault is repelled in round 1 with **zero casualties on either side** — identically, forever, because nothing is damaged. **59% of kingdom defence maps** have at least one fully severed approach edge (302 of 1600 edges, measured over 400 maps). The origin never changes either: `siege.ts` derives it from where the army stands. Fix the resolver (reachable origin, path around, or counsel `lift`), and teach the intel counsel to ask whether the keep is REACHABLE before it says `assault` into a river | assault repulse rate ≤50% matrix-wide (M70.5's new counter is the detector: `hard seed=9000` currently reports **19 assaults, 19 repelled**) · no campaign reports a siege with >5 assaults and 0 breaches |
| M73 | The earliest-victory band, decided | Unchanged from R7. Re-measure against the **shipped `DEFAULT_YEAR_LIMIT` of 100**, not the matrix's `--years 60`. Note this band has NEVER been green in any measured tree state (y29 at Gate P9, y28 boosts-off, y10 boosts-on), which is itself evidence the band or the measurement wants revisiting rather than the game. Output is an ADR either way | band green under an honest measurement, or an ADR records the restatement and why |
| M74 | Per-kingdom stat modifiers | Unchanged from R7. `StatModifiers` has been ONE board shared across every kingdom since M22 — why `TechDef.modifiers` is used by 0 of 72 techs and why `kingdom.researchYield` is read once outside the per-kingdom loop | a modifier granted to one kingdom is measurably absent from a rival's rollup · fixtures byte-identical while no content grants one (verify, do not assume) |
| M75 | The tech tree earns its cost | Unchanged from R7. **58 of 72 techs do nothing** (ADR-12). Grow `techBoost`'s `applies` vocabulary by `storage`/`service`/`garrison`/`defense`, then wire `TechDef.modifiers` on M74's per-kingdom board. **Every entry is a balance change — `bench:balance --real` per M70.5's lesson, no exceptions** | ≥36 of 72 techs have a measurable effect · no tech GATES a building (ADR-12's buff-not-gate rule) · M62 bands unmoved |
| M76 | Player agency & Gate P10 | Unchanged from R7's M75. **Advisor appointment** (ADR-11) and **`army.withdraw`** (ADR-10) — the two ADR-recorded surfaces the player cannot reach. Both are panels, not systems. Then Gate P10 | injector-free walkthrough: seat an advisor and watch the modifier land; withdraw from a battle in progress · Gate P10 recorded in Gate P8/P8.1/P9 format |

**M69 scoping note (shipped 2026-08-02) — BOTH halves shipped; the victory half via a route the
charter did not anticipate, because the charter's premise for it was wrong.**

*Shipped: event codes no longer reach any content-addressable surface.* The charter said "hash
event IDs by string." That was necessary and NOT sufficient. The positional code also leaked into
**three RNG fork names** — `event:${code}:…`, `event-roll:${code}:…`, `event-choose:${code}:…` —
and that leak dominated the fold: renumbering changed every roll, so the events that FIRED changed,
not merely how they hashed. A third leak sat inside the fold itself, where `lastFired` was sorted
as a STRING over `"kingdomId:code"`, so a renumber reordered the fold as well as revaluing it. All
three are fixed: fork names key on `def.id`, and `EventState.fold` takes a `stableKey` resolver
(`fnv1a32` of the def id, computed once at registration) and sorts numerically by it.

*Proven with a control, not asserted.* A never-firing probe event was inserted into the MIDDLE of
the sorted id list (so it renumbers everything after it) and final hashes were taken both ways:

| | terra-demo | campaign-demo |
|---|---|---|
| old code + probe | `0xee8edcd9` | `0x8b605306` |
| new code + probe | `0x69dd420b` | `0x77b06795` |
| new code, no probe | `0x69dd420b` | `0x77b06795` |

Adding an event moved fixtures before and moves nothing now — the chartered T objective, measured.

*Re-record: predicted 6 of 8, moved exactly 6 of 8.* `terra-demo`, `campaign-demo` and all four
corpus saves; `calendar-baseline` and `wanderers` byte-identical because neither composes events.
Every recorded hash matched its pre-record prediction exactly. Torture green (5 cycles each),
499/499 tests, build and lint clean.

*Two tests failed and NEITHER was this change breaking them* — both had been passing on the old RNG
stream by coincidence, which is worth recording as its own finding:

1. *`tutorial: all 6 steps are reachable`* counted fires by the `base:event.tutorial.` prefix and
   asserted `=== 6`. **M67 added five more events sharing that prefix**, gated on
   `village.tier >= 2` — which this test sets itself, at step 6. It passed only because the old
   stream happened not to roll one of them inside the remaining window. It now asserts the six
   NAMED steps each fire and resolve exactly once, which is the property its own assertion message
   always claimed. This was a latent M67 defect, surfaced by M69 rather than caused by it.
2. *`event.choose: a grantResource effect…`* waited 4000 ticks at seed 4 for a random merchant
   event. Widened to 40,000 rather than re-seeded — a wider window survives ANY future stream
   change, where seed-hunting only re-anchors the same coincidence.

*Delivered, by a different route: `campaign-long`, the first fixture that can see victory at all.*
Gate P9's structural finding (1) said the victory tracker is not a hash source. It is, and has been
since M37 — see the correction recorded at that finding — so registering it was a no-op and the
chartered work did not exist. The DEFECT was real but different: no fixture window is long enough
for victory state to diverge. Measured rather than argued, by perturbing `DEFAULT_PROSPERITY_HAPPINESS`
75 → 5 and reading the hash at each horizon:

| ticks | horizon | baseline | happiness 75→5 | |
|---:|---:|---|---|---|
| 3,000 | 0.3y | `0x77b06795` | `0x77b06795` | **blind** |
| 43,200 | 5.0y | `0x590bbee8` | `0x37e25415` | sees it |
| 86,400 | 10.0y | `0x006583c7` | `0x7867c656` | sees it |

`campaign-long` is therefore campaign-demo's world — same seed, same settings, same compose path —
run for **10 in-game years** (86,400 ticks, 60 samples, ~14 s each way at the measured
0.165 ms/tick). Ten rather than five deliberately: 10 is `DEFAULT_HEGEMONY_YEARS`, the shortest
horizon at which the hegemony path can declare at all. It currently never does — perturbing
`DEFAULT_HEGEMONY_YEARS` 10 → 3 changes nothing, because no kingdom in this seed ever holds the
share — and that is the point. **Phase 10 exists to make kingdoms conquer each other**, so a fixture
sized to today's behaviour would go blind exactly when M71 started working.

*The guard was proven, not assumed.* With the fixture recorded, `DEFAULT_PROSPERITY_HAPPINESS`
75 → 5 was re-applied: all four pre-existing goldens pass GREEN and `campaign-long` FAILS,
bracketed to tick 37,440 (year 4.3). That is M69's chartered T objective — "a deliberately-introduced
victory-logic change is caught by `replay:verify` where it previously passed green" — executed
literally. `packages/app/src/scenarios.test.ts` adds three recipe guards so the horizon cannot be
silently shortened back into blindness, the seeds cannot drift apart, and a duplicate scenario name
cannot quietly overwrite a fixture.

*Recording it was purely ADDITIVE* — one new file, zero existing fixtures touched, verified through
`git status`. Unlike part 1's re-record, nothing was overwritten.

*Cost, stated plainly.* `replay:verify` and `replay:record` each gain ~14 s. That is the price of
the only fixture in the repo that can see a victory-logic regression, and it is worth naming rather
than discovering in CI.

*What this still does NOT cover.* Hegemony, conquest and wonder victories are all unexercised in
this seed — the fixture watches the prosperity-streak, defeat and founding paths only. It is a
guard against regression, NOT evidence that the other three paths work.

*(Process note: this half was first written up as "re-scoped, not delivered" and handed to the owner
as a choice between a long-window fixture and relying on `bench:balance --real`. The owner chose the
fixture, same session — the interim write-up's 20-year/0.22 ms-per-tick sizing was superseded by the
5-year sensitivity measurement above, which showed a shorter and cheaper fixture suffices.)*

*Lesson for the phase.* The one charter item written from a code read rather than a measurement was
the one that was wrong, and it survived a release review, a gate assessment, and a ratified charter
before the first `grep` of the milestone caught it. The event half — written from M67's *measured*
re-record — was right in direction and still understated by two of its three causes.

**M70 scoping note (shipped 2026-08-02) — FINDING ONLY, nothing committed but this cause.**

The milestone asked why the flat harness reaches 24 sieges begun / 23 captured while the shipping
composition reaches 4 begun / 0 captured. **The answer is not AI competence, and it is not balance.
It is a hard bug in the assault resolver, and it is narrow.**

*Method.* Temporary telemetry on `ai/military.ts`'s war-path gates and on `resolveSpatialAssault`'s
exit condition, run over `composeCampaign` (the real composition) at 60 years × 3 seeds × hard.
All instrumentation was reverted; nothing but this note is committed.

*What the AI actually does — seed 9000, hard, 60 years.* It masses, marches, besieges and assaults.
14,289 war-path decisions; armies reach **72 men** against a `WAR_MIN_STRENGTH` of 20; 5 wars
declared, 4 sieges begun, **19 assaults ordered**. Zero command rejections. And **zero captures**.

*Why every one of those 19 assaults failed — identically.*

| | |
|---|---|
| exit reason | `no path and no wall to break`, **round 1**, all 19 |
| casualties | attacker `68 → 68`; defender `0 → 0` — **not a blow struck** |
| defence layer | **one structure: the keep.** 0 walls, 0 gates, 0 towers |
| entry tile | right edge, flow-field distance **-1 (unreachable)** |
| per-edge reachability | left **100/100**, right **0/100**, top 54, bottom 65 |
| map | 300 water tiles — one full-height strip severing the right edge from the keep |

`resolveSpatialAssault` **conflates "blocked by fortification" with "blocked by terrain."** Its
fallback comment says it plainly — *"fully walled off from this edge: enter at the edge anyway"* —
and that is right when the blocker is a wall, because a wall can be broken. Here the blocker is
WATER. The column enters on an unreachable tile, `pickWallTarget` returns null because the AI built
no walls, and the assault is "repelled" without a fight. Nothing is damaged, so the next assault is
identical, and the one after that, forever. The origin never changes either: `siege.ts` derives it
from where the army stands, and the army stands where it arrived.

*This is not seed 9000 being unlucky — it is a coin flip on every siege.* Reading
`generateDefenceMap` directly over 400 kingdom maps (100 worlds × 4 kingdoms):

- **59.0%** of kingdom defence maps have at least one **fully severed** approach edge
- **18.9%** of all approach edges (302 of 1600) are fully severed

The map generator draws `rng.int(0, 2)` water strips, each running **edge to edge**. Its comment
intends "each strip makes one whole approach expensive." It does not make it expensive; it makes it
**impossible**, and nothing downstream knows the difference.

*The control proves the rest of the war layer is sound.* Same code, same difficulty, other seeds:

| seed | defence layer | approach edges | sieges | outcome |
|---|---|---|---|---|
| 9000 | keep only | right **severed** | 4 | **0 captured**, 19 futile assaults |
| 9001 | 28 walls, 3 gates, 4 towers, keep | all open | 1 | 1 captured, 1 attacker host wiped |
| 9002 | keep only | all open | 16 | **15 of 15 assaults captured**, a kingdom destroyed |

Seed 9002 is the refutation of the charter's own framing: with an unsevered approach the AI takes
fifteen castles in sixty years. **The armies mass, march and win already.** R7 was written expecting
a strategic-competence gap; the measurement says otherwise, and that is exactly what M70 existed to
find out before M71 built the wrong thing.

*Secondary findings, real but not the blocker.*

1. **Plan monoculture, from the other side.** 11,605 of 14,289 war-path decisions (81%) exit at
   "not initiating and not committed" — the plan is not `ConquestWar`/`PunitiveRaid` and no war is
   already in progress. This is M65's deferred cadence lever, now readable as promised. It throttles
   how OFTEN war starts; it does not explain a siege that cannot conclude.
2. **`WAR_MIN_STRENGTH` is not binding.** 2,636 decisions exit under the 20-man floor, but armies
   reach 72. The gate delays the first march; it does not prevent it.
3. **The AI builds no walls in the real composition** — two of three seeds' defence layers hold the
   keep and nothing else. Harmless where the approach is open (9002 captures anyway) and a
   compounding factor where it is severed, since a wall would at least give the column something to
   break. Worth its own look; not the cause.
4. **`siege.assaultBegun` fires nowhere** — 0 in every run including the flat harness's 39 sieges,
   where 35 captured. It only fires for a defended garrison fight, so it is a misleading progress
   metric: Gate P9 and M61.5 both read "0 assaults" as "the AI never assaults", when the AI assaults
   constantly. `bench:balance` should report ORDERED assaults, not just engaged ones.

*What M71 should therefore fix, in priority order.* (1) The resolver must distinguish impassable
terrain from breakable fortification — pick a reachable origin, or path around, or counsel `lift`
when no route exists. (2) The intel counsel compares strength against resistance and never asks
whether the keep is REACHABLE, which is why it says `assault` 19 times into a river. (3) Only then
the cadence lever in finding 1. **The charter's own risk paragraph — "if M70's finding is that the
AI needs a strategic layer it does not have, M71 stops being a competence fix" — resolves the good
way: it needs no such layer.**

**M70 addendum (same day, 2026-08-02) — "0 captured" was a MEASUREMENT ARTIFACT, and the matrix
has moved a long way since Gate P9. Two corrections, one of them to the note above.**

*1. `siege.captured` cannot fire in the shipping composition.* `siege.ts`'s `capture()` checks
`capitalFall.claim` FIRST (M53): a defence-layer capital does not change hands, its fall is a
KINGDOM event. The siege freezes on `fallenDeadline` and publishes **`siege.capitalFallen`**, then
succession resolves it — capitulation spares, refusal or expiry destroys. `siege.captured` is only
reached for a non-capital castle, and the AI besieges capitals. The flat harness does not wire
`capitalFall`, so there the same assault publishes `siege.captured` — which is the ENTIRE source of
the "24 begun / 23 captured vs 4 begun / 0 captured" gap this milestone was chartered to explain.

`bench:balance` counts `siege.captured` only. Measured directly, 60y × hard × `composeCampaign`:

| seed | sieges begun | `siege.captured` | `siege.capitalFallen` | capitulations | kingdoms destroyed |
|---|---:|---:|---:|---:|---:|
| 9000 | 4 | **0** | **2** | 0 | 0 |
| 9001 | 1 | **0** | **1** | 0 | 1 |
| 9002 | 16 | **0** | **15** | 15 | 0 |

Eighteen capitals fell across three seeds and the metric reported zero every time. **M61.5's "0
castles captured", Gate P9's reading of it, and the framing of the M70 note above all inherited this
artifact.** The changing-hands band is affected too: it counts `occupations + siegesCaptured`, so a
capital that falls and capitulates is invisible unless it also produces an occupation.

*What still stands from the note above, unchanged:* seed 9000's nineteen assaults DID all fail in
round 1 against a severed approach, with no casualties on either side, and 59% of kingdom defence
maps have a fully severed approach edge. That bug is real, measured, and independent of this
artifact — the two capital falls at seed 9000 came from its other sieges, not from those nineteen
assaults. What changes is the note's framing: the shipping composition is NOT failing to conclude
sieges in general; it is failing on the severed-approach subset, and the metric hid the rest.

*2. The `--real` matrix has moved substantially since Gate P9.* One run of the gate's own command
(`bench:balance --real --years 60 --seeds 2`, 16 campaigns) on the current tree:

| Band | Gate P9 | now | |
|---|---:|---:|:--|
| adult cohort p10 (≥30%) | 46.1% | **28.5%** | ✗ regressed |
| oldest-village floor (≥15%) | 35.5% | **15.5%** | ✓ barely |
| monoculture (≤60% any type) | prosperity 56% | **chronicle 69%** | ✗ regressed |
| earliest victory (≥y30) | y29 | **y10** | ✗ regressed |
| campaigns changing hands (≥50%) | 13% | **87.5% (14/16)** | ✓ **passes** |

The band Phase 10 was chartered to fix now PASSES, and three that were green have gone red. This is
not tuning and nothing was tuned: no balance constant has been touched since Gate P9. The likely
cause is **M69 part 1**, which re-keyed every event RNG fork name from the positional code to the
def id — that perturbs the whole downstream stream, so every campaign now follows a different
history. **This is not isolated and must not be reported as established** until someone measures the
same matrix against the pre-M69 commit. Recorded here as an observation with its confounder named,
not as a finding.

*Consequence for R7.* M71's target is no longer obvious and the phase may need re-charting. The
honest reading is that Phase 10's central premise — "villages rarely change hands because the AI
cannot conclude a war" — is now doubtful on two independent grounds: the metric that produced it was
blind, and the current matrix disagrees with it. **Owner decision needed before M71 proceeds.**

**M70 isolation run (2026-08-02) — the confounder is ISOLATED, and it is not M69. It is M68, a
content change that shipped claiming "no existing balance moves."**

The M70 addendum above named M69's RNG re-key as the likely cause of the matrix swing and flagged
that it was not isolated. It has now been isolated by bisection: `bench:balance --real --years 60
--seeds 2` run at three commits, each in its own worktree, each verified to be genuinely at that
commit by checking its own goldens verify GREEN before running (the first attempt did not — a
symlinked `node_modules` resolved `@crowns/*` back to the root workspace and was silently running
new code, caught only because the old fixtures failed with hashes recognisable from M69).

| | `33b42ca` (M67, **Gate P9's own commit**) | `a0c57af` (pre-M69, **post-M68**) | `67a93e2` (current) |
|---|---:|---:|---:|
| adult cohort p10 (≥30%) | **46.1%** ✓ | 22.6% ✗ | 28.5% ✗ |
| oldest-village floor (≥15%) | **35.5%** ✓ | **5.2%** ✗ | 15.5% ✓ |
| monoculture (≤60%) | prosperity **56%** ✓ | conquest 38% ✓ | chronicle 69% ✗ |
| earliest victory (≥y30) | **y29** ✗ | y10 ✗ | y10 ✗ |
| changing hands (≥50%) | **13%** ✗ | 75% ✓ | 87.5% ✓ |
| wars declared | **5** | 56 | 56 |
| sieges begun | **2** | 32 | 39 |

**Gate P9 reproduces to the digit** — 46.1 / 35.5 / prosperity 56 / y29 / 13%, every figure it
recorded. The gate was sound and its numbers are honest. The entire swing lands between `33b42ca`
and `a0c57af`, a range whose ONLY sim-affecting commits are `69006f8` and `12cf856` — **M68's yield
boosts**. Everything else in the range is display-only or documentation.

*What M68 actually did.* It was scoped as a modest content reward: nine buildings gain ×1.5 on one
output once their kingdom knows a tech. Its commit says, in as many words, *"no existing balance
moves."* **That claim was false.** Over sixty years the boosts compound:

- **wars declared 5 → 56** and **sieges begun 2 → 32**. More food and tools feed more people, who
  feed more recruits, who make war affordable. M68 did by accident what Phase 10 was chartered to do
  on purpose — **the changing-hands band went 13% → 75% and now passes**.
- **adult cohort p10 46.1% → 22.6%** and **oldest-village floor 35.5% → 5.2%**. The same extra food
  raises BIRTHS, and both bands measure an adult *fraction*, not a count. M68 silently re-broke the
  demographic bands M64a diagnosed and M65 was built to fix — the two headline wins of Phase 9.
- **earliest victory y29 → y10.** A faster economy reaches every threshold sooner.

*Why nothing caught it.* M68's verification was 498 tests green, lint clean, and **all eight fixtures
byte-identical** — all true, and all irrelevant. The fixtures run 3000 ticks (**125 days**); these
effects need years. It is the SAME blind spot M69 part 2 was built to close for victory, in a
different subsystem, discovered two milestones later. `bench:balance` was never run for M68, because
M68 was filed as content, and content changes had never needed it.

**The process lesson, stated plainly: "buff-only, so no balance moves" is not an argument, it is a
hypothesis, and this project owns the tool that tests it.** A buff is a balance change by
definition — it moves the economy that feeds every other system. Any change to a yield, cost, rate
or threshold must run `bench:balance --real` before it ships, and its scoping note must carry the
numbers. Byte-identical fixtures are evidence about 125 days and nothing more.

*Consequences for R7.* Phase 10's chartered premise — "villages rarely change hands because the AI
cannot conclude a war" — **is dissolved**. It was true at Gate P9 (13%) and stopped being true the
moment M68 shipped (75%, now 87.5%). Combined with the `siege.captured`/`siege.capitalFallen`
measurement artifact recorded above, neither pillar of the charter survives contact with
measurement. What is left is a genuinely different problem, and the owner should re-charter against
it rather than let M71 proceed on a premise that no longer holds:

1. **M68 is an unreviewed balance change that is half regression and half accident.** It broke the
   two bands Phase 9 won and fixed the one Phase 10 was chartered for. Deciding what to keep is a
   design decision, not a bug fix — and it must be made explicitly, not inherited.
2. **The severed-approach assault bug (M70) is real and independent of all of this.** 59% of defence
   maps, measured; a siege that hits it can never resolve. Worth fixing regardless of the above.
3. **`bench:balance` is blind to capital falls** — it counts `siege.captured`, which the shipping
   composition can never publish because `succession: true` routes every capital fall to
   `siege.capitalFallen`. The flat harness sets `succession: false`
   (`ai/multiKingdomHarness.ts:109`), which is the whole of the "23 captured vs 0 captured" gap.
   Fix the instrument before trusting any war number from it.

**M70.5 scoping note (shipped 2026-08-02) — un-chartered: fix the instrument before trusting any
war number it has ever produced.**

M70 and its isolation run found that every war metric in `bench:balance` was wrong. R7 does not
contain this milestone; it is a prerequisite the diagnosis uncovered, taken first at owner direction
because the alternative is re-chartering a phase against numbers already known to be false.

*Three faults, all in the instrument, none in the game.*

1. **`assaultsBegun` subscribed to `siege.assaultBegun` — an event NO code in this repository
   publishes.** Not "rarely fires": never, in any composition, since the counter was written. It
   read 0 always, and **M61.5 and Gate P9 both read that 0 as "the AI never assaults"**, which is a
   load-bearing claim in the review that chartered Phase 9 and in the gate that failed to close it.
   M70 measured the truth by instrumenting the resolver directly: the AI assaults constantly (19
   assaults in one 60-year seed). The real event is `siege.assaultResolved`, and it carries
   `outcome: 'captured' | 'repelled'`. Now reported as **assaults resolved, of which repelled** —
   the repulse count is the number that would have exposed M70's severed-approach bug years ago.
2. **`siegesCaptured` cannot fire in the shipping composition.** `siege.ts`'s `capture()` consults
   `capitalFall.claim` first (M53): a capital's fall is a KINGDOM event, so it publishes
   `siege.capitalFallen` and succession resolves it. `siege.captured` is reachable only for a
   NON-capital castle, and the AI besieges capitals. The flat harness sets `succession: false`
   (`ai/multiKingdomHarness.ts:109`), so there the identical assault publishes `siege.captured`.
   **That one line is the entire "24 begun / 23 captured vs 4 begun / 0 captured" gap that chartered
   Phase 10.** New `capitalFalls` counter; both are now reported.
3. **The changing-hands band counted `occupations + siegesCaptured`,** so a capital that fell and
   capitulated was invisible to the band unless it also produced an occupation. Now
   `occupations + siegesCaptured + capitalFalls`. **The band's DEFINITION is unchanged** — "a
   village changed hands" — only the set of events allowed to evidence it. A ratified band with a
   corrected instrument is not a re-ratification, and this note exists so nobody later mistakes it
   for one.

*Also fixed: the same dead event name in the audio layer.* `TENSION_EVENT_WEIGHTS` carried
`'siege.assaultBegun': 0.4`, which had never once contributed heat — the music never reacted to an
assault. Re-pointed at `siege.assaultResolved` (it fires on repulse too, which is the right moment
for a spike) and `siege.capitalFallen` added at 0.5.

*Verification.* Same seed, before and after, `--real --years 25 --seeds 1 --kingdoms 2`: the old
instrument reported `sieges 2 begun, 0 assaulted, 0 captured`; the new one reports **`2 begun, 2
assaults resolved (0 repelled), 2 capitals fallen, 0 non-capital captures`**. Two successful sieges
that the tool had been scoring as nothing. 502/502 tests, lint clean, no sim code touched — the
goldens and corpus are untouched by construction.

*Independent confirmation, and the strongest evidence in this note.* A 60-year `--real` run on the
corrected tool reproduces M70's hand-instrumented finding **from the tool itself, with no temporary
telemetry**:

```
hard seed=9000 k=4 · sieges 4 assaults 19 (19 repelled) capitals fallen 2 captures 0
```

Four sieges, nineteen assaults, **all nineteen repelled** — the exact severed-approach campaign M70
diagnosed by patching `resolveSpatialAssault`. Across the 8-campaign run: `30 begun, 37 assaults
resolved (20 repelled), 23 capitals fallen, 0 non-capital captures`, where the old instrument would
have printed `30 begun, 0 assaulted, 0 captured`. Twenty repulses and twenty-three fallen capitals,
all previously scored as zero. **The repulse counter is now the standing detector for M70's bug** —
a healthy war layer resolves assaults, and a run reporting near-100% repulses in one campaign is the
signature of an unreachable keep.

**Everything downstream is now suspect and must be re-measured, not re-read.** Every war figure in
M61.5, M62, Gate P9, the M65 note and R7's charter came from this instrument. The demographic,
victory-timing and monoculture bands are unaffected (they never touched these counters); the
war-cadence findings are all provisional until re-run.

**M68 decision experiment (2026-08-02) — the boosts are ONE lever that trades three bands for one.
They are not separable as written.**

Run on the CORRECTED instrument (M70.5), `--real --years 60 --seeds 2`, 16 campaigns each. **A** is
the current tree. **B** is the same tree with M68's nine `techBoost` multipliers set to `1.0` — the
boosts still resolve, they just do nothing, so the ONLY variable between the runs is that number.
M69's RNG re-key, M70.5's counters and all other code are identical in both.

| Band | Gate P9 (`33b42ca`) | **A** — boosts ON | **B** — boosts OFF |
|---|---:|---:|---:|
| adult cohort p10 (≥30%) | 46.1% ✓ | **28.5%** ✗ | **45.1%** ✓ |
| oldest-village floor (≥15%) | 35.5% ✓ | 15.5% ✓ | **30.1%** ✓ |
| monoculture (≤60%) | prosperity 56% ✓ | **chronicle 69%** ✗ | chronicle 56% ✓ |
| earliest victory (≥y30) | y29 ✗ | **y10** ✗ | y28 ✗ |
| changing hands (≥50%) | 13% ✗ | **93.8%** ✓ | **13%** ✗ |
| villages changing hands (count) | 2 | **61** | 2 |
| bands green | 3 of 5 | **2 of 5** | **3 of 5** |

**B reproduces Gate P9 almost exactly** (45.1 vs 46.1, 30.1 vs 35.5, 56% vs 56%, y28 vs y29, 13% vs
13%). Neutralising nine numbers in a content file returns the whole game to the Phase 9 equilibrium.
That is a clean, decisive result: **M68's yield boosts are the entire difference between the two
equilibria**, and every effect the isolation run attributed to M68 is confirmed causally, not just
correlationally.

*The trade is real and it is one lever.* The war improvement is not free AI competence appearing
from nowhere — it is that richer kingdoms can afford armies. 61 villages change hands with the
boosts and 2 without. There is no setting of this lever that buys the war band without paying the
other three: it is the same surplus doing both.

**This is what Phase 10's real work is, and neither R7 nor any earlier document names it: war is
gated on economic surplus, and the only surplus large enough to fund war also wrecks the
demographic and pacing bands.** Decoupling those is the design problem. M71 as chartered ("the fix
per M70") does not address it.

*An open question that must be settled BEFORE any fix, because it has two different answers.* Why
does the adult FRACTION fall from 46% to 28% under the boosts? Two mechanisms are consistent with
the data and this experiment cannot separate them:

1. **Births.** More food raises the birth rate, so more children — and both bands measure an adult
   fraction, not an adult count. The cohort would be diluted, not depleted.
2. **War consumption.** A has ten times the war. Recruiting costs 10 adults per unit and casualties
   kill adults, so the cohort would be genuinely depleted, and the demographic "regression" would
   be a *symptom of the war working*, not a separate defect.

These demand opposite fixes — saturating the birth response versus capping the military draw — and
choosing wrong repeats M65's error of specifying a ceiling against the wrong measurement. The
settling measurement is M64a's method: per-village cohort accounting over a boosted run, attributing
every adult delta to births, maturation, senescence, deaths, recruitment and casualties. **That is
the next milestone, and it is a diagnosis, not a fix.**

**M70.6 scoping note (shipped 2026-08-02) — un-chartered DIAGNOSIS. Nothing committed but this
cause. It is BIRTHS, and the two competing hypotheses are settled by the same measurement.**

The M68 decision experiment left one question deciding what M71 builds: why does the adult FRACTION
fall from 46% to 28% under the boosts? Hypothesis (1) births — more food, more children, a diluted
cohort. Hypothesis (2) war consumption — A has ten times the war, and recruiting costs 10 adults a
unit. Opposite fixes. Method: M64a's — instrument every term that writes `pop.adults[]`
(`population.ts`'s daily update, `military.ts`'s recruit draw and return) plus per-village age,
population and war-event counts, over 60-year runs with the boosts on and off. All telemetry
reverted; goldens re-verified green afterwards.

*Verdict: hypothesis (1). Hypothesis (2) is refuted, and refuted by the cleanest possible evidence —
the worst village has never been touched by war.* Seed 9000, `fair`, boosts ON:

| village | age | adult fraction | population | children / adults | war events |
|---|---|---:|---:|---|---:|
| vi=28 | 60y | **28.5%** | 745 | 496 / 212 | **0** |
| vi=32 | 60y | 52.4% | 715 | 305 / 375 | 3 |
| vi=30 | 60y | 66.6% | 579 | 171 / 386 | 2 |

The 28.5% village — the one that IS the failing band figure — saw no war at all, while both
war-touched villages sit far higher. Aggregated across both difficulties: war-touched villages mean
**59.5%** adult, untouched **28.5%** (fair); 55.8% vs 56.3% (hard). **War does not deplete the adult
cohort; if anything the correlation runs the other way.** The recruit draw confirms it in absolute
terms — net adult drain to the army over 60 years is 1,769 at `fair`, against 3,313 matured and
10,673 net in-migration.

*What actually happens.* Villages do not multiply under the boosts — they GROW.

| | boosts ON | boosts OFF |
|---|---|---|
| villages (seed 9000 `fair`) | 3 | 4 |
| population each | 745 / 715 / 579 | 174 / 150 / 120 / 90 |
| adult fraction range | **28.5 – 66.6%** | 46.2 – 63.0% |
| births / matured (60y) | 5,162 / 3,313 | 1,349 / 726 |

`population.ts`: `births = adults × BIRTH_RATE × fed × (0.5 + 0.5·shelter) × joyFactor`, while
`matured = children × MATURE_RATE` is a FLAT rate. Births scale with food security and joy; nothing
saturates. The boosts raise `fed` to its ceiling and keep joy high, so a large well-fed village
breeds children faster than a fixed maturation rate can convert them, and the child pool inflates
against the adult base indefinitely. That is the whole mechanism, and it needs no war to appear.

**The design coupling to break, stated for M71:** food surplus has exactly one outlet — births —
and it is unbounded. Any economy strong enough to fund a war therefore also floods the child cohort.
Candidate directions, none measured yet and all belonging to a FIX milestone rather than this one:
saturate the `fed` term in the birth rate; make `MATURE_RATE` responsive to conditions rather than
flat; or give surplus a second sink (stockpiles, trade, migration out) so it need not become people.

*Scope of evidence, stated so nobody over-reads it.* Two configurations at ONE seed (9000, `fair`
and `hard`), against a band pooled over 16 campaigns. The mechanism is unambiguous and the war
hypothesis is cleanly refuted at this seed; the exact contribution split should be re-measured
across the matrix before any constant is chosen.

*Two of my own errors, recorded because both nearly became findings.* (1) A first pass filtered
villages at `total <= 0` and so counted razed slots carrying float residue — they report a
meaningless 98.2% adult fraction, which inflated "villages" from 3 to 21 and produced a bogus "91%
mean adult" and a bogus "5× more villages under boosts". `bench-balance` filters at `total < 1` and
was right all along; the probe was wrong. (2) The village-count claim that followed from it was
retracted before reaching any document. **Neither the instrument nor the game was at fault in
either case** — which is worth recording after M70.5, where both were.

**M71 scoping note (2026-08-03) — BUILT, MEASURED, and NOT SHIPPED. The problem it was chartered
to fix does not exist at the length the game actually runs.**

M71 was to break the food→births coupling M70.6 identified. A `FERTILITY_CEILING` was implemented
(one `Math.min` on the combined `fed × shelterTerm × joyFertility` multiplier) and bisected against
`bench:balance --real --years 60 --seeds 2`: baseline 2 of 5 bands, ceiling 1.0 → 2 of 5, 0.85 →
3 of 5, 0.7 → 3 of 5 but with `chronicle` at 100% (every campaign timing out — a scorecard pass on a
strictly worse game, and the reason band counting alone must never decide a milestone). 0.85 looked
like the answer.

**Then the clock was checked, and it was the wrong clock.** `bench-balance.ts:123` passes
`yearLimit: YEARS`, so `--years 60` does not merely truncate observation — it shortens the GAME's
victory clock from the shipped `DEFAULT_YEAR_LIMIT` of 100 to 60. Re-run at the shipped default
(`--real --seeds 2`, no `--years`):

| Band | baseline @ 60y | **baseline @ shipped 100y** | ceiling 0.85 @ 100y |
|---|---:|---:|---:|
| adult cohort p10 (≥30%) | 28.5% ✗ | **43.0%** ✓ | 22.8% ✗ |
| oldest-village floor (≥15%) | 15.5% ✓ | 15.5% ✓ | 9.4% ✗ |
| monoculture (≤60%) | 69% ✗ | **44%** ✓ | 50% ✓ |
| earliest victory (≥y30) | y10 ✗ | y10 ✗ | y15 ✗ |
| changing hands (≥50%) | 93.8% ✓ | 93.8% ✓ | 81.3% ✓ |
| **bands green** | **2 of 5** | **4 of 5** | **2 of 5** |

**The untouched tree is 4 of 5 at the configuration that ships**, and the fertility ceiling takes it
back to 2. M71 is therefore NOT SHIPPED: no code, no constant, no fixture re-record. The branch was
reverted and all eight fixtures re-verified green.

*Why the 60-year measurement misled.* M70.6 had already measured that villages are still in
demographic TRANSIENT at year 60 — and that finding was recorded and then under-weighted. A growing
village is child-heavy; maturation catches up over the following decades. Reading the adult-fraction
bands at year 60 reads a growth bulge, not a resting state. The same tree sits at 43.0% by year 100.
The lesson is narrower and sharper than M70.5's: **a band measured inside a system's transient
measures the transient.** Population's slowest term is `MATURE_RATE` at 14 years; nothing that
depends on it can be read at 60 years and called an equilibrium.

*What this invalidates.* Every band measurement in this project's history used `--years 60`:
M62's ratification, Gate P9, R7, R8, and all of M68–M71's analysis. Comparisons BETWEEN tree states
stayed fair, because the command was constant. Three specific conclusions were artifacts:

1. **M68's "demographic regression"** (recorded in the M68 isolation note) — at the shipped clock
   M68's tree is 4 of 5. The regression was the 60-year bulge, not the boosts.
2. **R8's "two equilibria and no path between them"** — the phase's founding premise. There is one
   equilibrium and it is healthy; the "poor" equilibrium was Gate P9's tree read on the same short
   clock, and the "rich" one was M68's read the same way.
3. **M71 itself** — chartered against a problem visible only on the wrong clock.

*What is actually left.* One band fails on the shipping configuration: **earliest victory y10**
(needs ≥y30). That is real, it is unaffected by the clock (an early win is early on any clock), and
it is the only measured defect remaining in the M62 set. M70's severed-approach assault bug (59% of
defence maps) also stands, independent of all of this.

**M72 scoping note (shipped 2026-08-03) — the severed approach. A castle behind a river is no
longer unassailable.**

M70's bug, fixed. `resolveSpatialAssault` considered only `input.origin` when choosing an entry
tile, and when no tile on that edge could reach the keep it entered there anyway — a fallback whose
own comment ("fully walled off from this edge … let wall-breaking open the field") is right for a
WALL, which can be broken, and wrong for WATER, which cannot. The column entered on an unreachable
tile, `pickWallTarget` returned null, and the assault was "repelled" in round one having struck no
blow and taken no casualty. Nothing was damaged, so the next attempt was identical — forever.

*The fix.* `pickEntry()` now returns the best REACHABLE tile: the requested origin first, else the
nearest reachable approach with the edges walked in a fixed order for determinism. `result.origin`
reports the edge the column ACTUALLY entered by, so a battle report cannot claim an attack from a
side the army could not reach. Marching around is what a besieging army would obviously do, and it
is always possible — measured over **800 kingdom defence maps** (200 worlds × 4 kingdoms):

| severed approach edges | maps | |
|---:|---:|---|
| 0 | 329 | 41.1% |
| 1 | 345 | 43.1% |
| 2 | 126 | 15.8% |
| 3 or 4 | **0** | **0%** |

At most two of four are ever cut, so a reachable edge always exists. The old "enter anyway" path is
KEPT but is now unreachable on base content — retained for mods whose maps could enclose a keep
entirely, and documented as such rather than deleted.

*Demonstrated on the campaign M70 diagnosed* (`hard`, seed 9000, 60 years), the same composition,
before and after:

| | sieges | assaults | captured | repelled | entry edge |
|---|---:|---:|---:|---:|---|
| M70 (before) | 4 | 19 | **0** | **19** | `right` — the severed one |
| M72 (after) | 3 | **1** | **1** | **0** | `bottom` |

Nineteen futile assaults became one successful one.

*Matrix effect: none, and that is the expected result.* On the shipped clock (`--real --seeds 2`)
every band is byte-identical to the R9 baseline — adult cohort 43.0% · floor 15.5% · monoculture
44% · earliest victory y10 · changing hands 93.8%, still **4 of 5** — with 84 total village changes
against 82. The war band was already saturated, so M72 could not raise it. **This milestone is a
correctness fix, not a balance fix**, and it is worth having on those terms: a castle that no army
can ever take is a broken game state whatever the aggregate statistics say.

*Two regression tests, and a third that was WRONG and had to be narrowed.* (1) A water strip across
the left approach; the same column that captures from an open edge must still capture, and must
report the edge it really used. (2) Every assault must reach the keep or meet a defence — M70's
failure traced `enter → repelled` and nothing else, a null event dressed as a defeat. The version
first written asserted "a repulse must cost casualties or breaches", and it FAILED: a column that
walks to an undefended keep and is turned away under `holdStrength` legitimately costs nothing, and
an existing test pins that rule. **The assertion was wrong, not the game** — widening the fix to
satisfy it would have smuggled a balance change into a bug fix. Narrowed to what actually matters:
arriving nowhere.

*No fixture re-record — and no fixture guard either.* All eight fixtures are byte-identical
(verified, not assumed): the windows are 125 days and 10 years, and neither contains an assault
against a severed approach. **The consequence must be stated rather than enjoyed: nothing in the
fixture set protects this change.** The two unit tests above are its only guard. That is exactly
the position M68 was in when it moved four bands unnoticed, and the difference here is only that
the tests were written deliberately rather than assumed unnecessary. 504/504 tests, lint clean.

**M73 scoping note (shipped 2026-08-03) — DECIDED. The band stands; it was reporting a real
defect, and the defect is a hole in M53's capital-death chain. See ADR-13.**

R9 left earliest victory as the only failing band on the shipping configuration, and it is
clock-independent (y10 at both the 60- and 100-year limits). The full per-campaign matrix at the
shipped clock shows **every early victory shares one signature, and all five are `k=2`**:

| difficulty | seed | victory | eliminated | sieges | assaults | capitals fallen | occupations | capitulated | risen |
|---|---|---|---|---:|---:|---:|---:|---:|---:|
| fair | 9000 | **conquest y10** | 1/2 | 0 | 0 | **0** | **1** | 0 | 0 |
| fair | 9001 | conquest y15 | 1/2 | 0 | 0 | **0** | **1** | 0 | 0 |
| hard | 9000 | conquest y18 | 1/2 | 0 | 0 | **0** | **1** | 0 | 0 |
| brutal | 9000 | conquest y26 | 1/2 | 0 | 0 | **0** | **1** | 0 | 0 |
| hard | 9001 | conquest y27 | 1/2 | 3 | 0 | **0** | **1** | 0 | 0 |

One occupation, no capital fallen, no capitulation offered, no new lord. Contrast the healthy `k=2`
runs — `chronicle y100 · sieges 1 assaults 1 capitals fallen 1 · destroyed 1 · risen 1` — where a
capital genuinely fell, succession resolved it, a new banner rose, and the campaign ran the full
hundred years.

*The mechanism, verified in code rather than inferred.* Two facts compose into the hole:

1. `game/defence.ts` gives a CAPITAL a defence map unconditionally from the first tick
   (`if (!options.isCapital(vi) && !keepBuilt.has(vi)) continue;`), so `applicable` is true
   immediately — a capital is siege-eligible from founding.
2. `campaign.ts` exempts a village from plain occupation only when it is
   `applicable && (villageGarrisoned(vi) || already under siege)`. An **ungarrisoned** capital is
   therefore NOT exempt: a field army walks in and `village.occupied` fires.

And `capitalFall.claim` — M53's capitulate-or-raise-a-new-lord window — is called from exactly ONE
place, `siege.ts`'s `capture()`. Occupation never reaches it. So a kingdom whose capital is taken
without a siege dies with no succession chance at all, and in a two-kingdom game the last-village
rule (`everFounded && villages === 0`, any cause) converts that immediately into a **conquest**
victory for a survivor who may never have fought a battle.

*The decision (ADR-13): the band is CORRECT and stays; the game is wrong.* The alternative reading —
that the band is mis-scoped because a two-kingdom duel legitimately ends fast — was considered and
rejected. `k=2` is a real player configuration (the new-game screen permits 1–8 kingdoms), the same
path exists at every kingdom count and merely fails to end the game there, and M53's design intent
is explicit that losing a capital opens a window rather than ending a realm. That only fortified,
garrisoned capitals get that window is an accident of where the hook was placed, not a decision
anyone recorded.

*Not fixed here.* Routing capital loss through `capitalFall.claim` regardless of how the capital
changed hands is a behaviour change that moves victory outcomes and will re-record fixtures. It
reopens M53's chain and deserves its own milestone rather than being absorbed into a decision
milestone — the same separation M64a→M65 and M70→M72 used. **Chartered as M77.**

**M77 scoping note (2026-08-03) — BUILT, MEASURED, NOT SHIPPED. The fix is right and cannot land
until the AI can storm a castle. It removed a crutch and exposed what the crutch was hiding.**

ADR-13 required capital loss to open M53's succession window however the capital changed hands.
Routing occupation INTO succession was rejected on inspection — succession's resolution is entirely
siege-centric (it scans `siegeGame.state.all()` for `fallenDeadline`; both its commands require a
siege record), so it would have meant synthesising sieges or refactoring succession. **The
implemented route was the inverse: make a capital non-occupiable, so every capital loss flows
through `siege.capture()`, which already calls the hook.** ADR-13's outcome line records the
substitution rather than leaving the record describing something that did not ship.

*It worked on its target.* Earliest victory moved **y10 → y25** — direct confirmation of M73's
diagnosis that the walk-in path was the cause, since nothing else changed.

*And it cost two bands*, measured on the shipped clock:

| Band | baseline | M77 |
|---|---:|---:|
| adult cohort p10 (≥30%) | 43.0% ✓ | 32.9% ✓ |
| oldest-village floor (≥15%) | 15.5% ✓ | **9.0%** ✗ |
| monoculture (≤60%) | chronicle 44% ✓ | prosperity 56% ✓ |
| earliest victory (≥y30) | **y10** ✗ | **y25** ✗ |
| changing hands (≥50%) | 93.8% ✓ | **38%** ✗ |
| **green** | **4 of 5** | **2 of 5** |

*Why, and it is the finding of this milestone.* The siege telemetry, against M72's baseline:

| | sieges begun | assaults resolved | repelled | capitals fallen |
|---|---:|---:|---:|---:|
| M72 baseline | 55 | 39 | 3 (8%) | **42** |
| M77 | **114** | 18 | **14 (78%)** | **4** |

Sieges doubled and captures collapsed by an order of magnitude. ~~**The AI cannot take a defended
castle.**~~ **WRONG — corrected by the M78 probe (2026-08-03), see the note below.** The castles are
not defended (garrison zero in every failed assault measured) and the AI arrives with 2.5–3× the
strength the keep verdict needs. The columns are annihilated by TOWER FIRE on the approach, before
they ever reach the keep. The claim was made from an aggregate repulse rate without measuring where
the repulses happened; it should not have been written.**
It remains true that** the AI never had to storm capitals before M77, because an ungarrisoned
capital could be walked into. Removing the walk-in path did not break the war layer; it revealed that the
war layer was being carried by a bypass. R7 suspected exactly this and could not prove it, because
the instrument was blind (M70.5) and the bypass masked it.

*A scoping error of mine, recorded because the measurement caught what the reasoning should have.*
The first implementation exempted every `applicable` village, not just capitals — a strictly larger
claim than M73's evidence supported, and I noted the widening in passing without acting on it.
Narrowing it to the owner's own bound capital produced **byte-identical** matrix results: in
practice the AI builds keeps only at capitals, so `applicable ⟹ isOwnCapital` throughout. The
narrowing was right in principle and a no-op in fact — which also retires the "sticky layer"
consequence I had flagged as a real widening. It was theoretical.

*Not shipped.* Reverted in full — `campaign.ts` and the two tests it moved (`succession.test.ts`'s
M57 pin, `campaign.test.ts`'s two capital-rebinding tests). Shipping a change that takes the game
from 4 of 5 bands to 2 of 5 because it is *more correct in principle* is precisely the trade this
project's discipline forbids. 504/504, all eight fixtures untouched.

**Dependency, now evidenced rather than suspected: M77 needs AI assault competence first.** Not
reachability (M72 fixed that — the repulses here are at the keep, not at a river), but STRENGTH:
armies that mass enough to clear `holdStrength` before they commit, or an assault counsel that
holds until they can. That is R7's original "war that concludes", finally resting on a measurement
instead of an artifact. Until it exists, capitals must stay occupiable and ADR-13's defect stays
open — a trade recorded here so nobody re-discovers M77 and ships it.

**M78 probe (2026-08-03) — FINDING ONLY. The blocker is not AI strength. It is a tower-fire death
spiral that annihilates the column on the approach, against castles with no garrison at all.**

M77 established that with the walk-in path removed, 14 of 18 assaults are repelled. The M77 note
concluded "the AI cannot take a defended castle." **That conclusion was wrong, and this probe was
run precisely because two milestones in a row had been rejected by measurement.** Method: instrument
the keep verdict and the assault exit reason, re-apply M77's exemption so columns must actually
storm, and run 100-year campaigns. All telemetry reverted; goldens re-verified green.

*First measurement kills the hypothesis.* Of the assaults in each campaign, only ONE reached the
keep — and when it did, it arrived overwhelming:

| seed / difficulty | strength | needed (`keepThreshold + rally`) | ratio | men | verdict |
|---|---:|---:|---:|---:|---|
| 9000 `fair` | 187 | 60 | **3.12×** | 30 | captured |
| 9000 `hard` | 200 | 68 | **2.94×** | 32 | captured |
| 9001 `fair` | 148 | 60 | **2.47×** | 24 | captured |

**Every assault that reaches the keep takes the castle, with two and a half to three times the
required strength.** Strength is not the problem.

*Where they actually fail.* The exit reason is identical in all three campaigns:

| | outcome | why | rounds | breaches | men before → after | **garrison** | reached keep |
|---|---|---|---:|---:|---|---:|---|
| 9000 `fair` | repelled | **attackers wiped** | 58 | 1 | **41 → 0** | **0** | no |
| 9000 `hard` | repelled | **attackers wiped** | 51 | 1 | **33 → 0** | **0** | no |
| 9001 `fair` | repelled | **attackers wiped** | 53 | 1 | **36 → 0** | **0** | no |
| (each campaign's other assault) | captured | — | 47 | 1 | 36–40 → 24–32 | 0–4 | yes |

**A column of 33–41 men is wiped to the LAST MAN against a castle defended by nobody.** The only
damage source present is tower fire, and it is a death spiral by construction:

```
damage = tower.damage / max(1, attackerCount()) * BASE_MORALE_DAMAGE * jitter
```

Damage per round scales INVERSELY with the surviving column, and `damageAttacker` converts that
morale loss straight into casualties. Forty men take `12/40` per tower per round; four men take
`12/4` — ten times the morale damage into a tenth of the force. The smaller the column, the faster
it dies. The intent is documented in the code ("towers deter raids; armies soak them") and the
deterrence half works; the soak half does not, because nothing bounds the spiral once a column
starts shrinking.

*It is a knife-edge, not a slope.* Captures reach the keep at round **47**; wipes are still
advancing at **51–58**. Both break exactly one wall. The difference between taking a castle and
losing every man is a handful of rounds of extra exposure — which is why the outcome looks random
in aggregate and produced a plausible-sounding "the AI can't fight" story.

*What M77 actually needs*, restated on evidence: not bigger armies and not better target selection,
but a tower-fire model that does not annihilate an unopposed column. Candidate directions, none
measured: cap total tower damage per assault; make the count-relative term saturate rather than
diverge as the column shrinks; or let a column that has taken heavy losses withdraw with survivors
instead of being ground to zero. **Any of these is a balance change and gets the M70.5 treatment —
matrix numbers in its scoping note, on the shipped clock.**

*Recorded because it is the third time in this phase.* M71, M77 and now M77's stated cause were all
rejected by measurement. In each case the measurement was cheap and the reasoning was confident.
The probe that overturned this one cost eight minutes.

**M78 scoping note (shipped 2026-08-03) — the tower death spiral is fixed. It was NOT M77's
blocker, and this note exists mostly to record how the wrong cause was chosen twice in a row.**

*What shipped.* `TOWER_EXPOSURE_FLOOR = 20` floors the divisor in the tower volley:

```
exposure = max(TOWER_EXPOSURE_FLOOR, attackerCount())
damage   = tower.damage / exposure * BASE_MORALE_DAMAGE * jitter
```

The pre-M78 form divided by the LIVE count, so damage per round diverged as men fell and fed
straight back into the casualty term. The M78 probe measured its end state: columns of 33, 36 and 41
men wiped **to the last man** on the approach, against castles holding **no garrison at all**, while
every column that reached the keep took it with 2.5–3× the strength required. Flooring the divisor
keeps the entire intended curve — a raiding party still suffers far more per man than a host, all
the way down to the floor — and removes only the divergence. Chosen over capping total damage (a
tower firing all day *should* grind a stalled column down; it must not accelerate as it succeeds)
and over a withdrawal rule (truncates the spiral without fixing it, and a withdrawn column still
fails the assault). A property test pins the curve rather than an outcome, because outcomes here sit
on a knife-edge — captures reached the keep at round 47, wipes were still advancing at 51–58 — and
an outcome test would be flaky by construction.

*Measured, on the shipped clock, both ways.*

| | adult p10 | floor | monoculture | earliest | changing hands | green |
|---|---:|---:|---:|---:|---:|---:|
| baseline | 43.0% | 15.5% | 44% | y10 | 93.8% | **4 of 5** |
| tower fix alone | 43.0% | 15.5% | 44% | y10 | 93.8% | **4 of 5** |
| M77 alone | 32.9% | 9.0% | 56% | y25 | 38% | 2 of 5 |
| **tower fix + M77** | 32.9% | 9.0% | 56% | y25 | 38% | **2 of 5** |

Inert on the shipping tree, and **inert on M77 too** — sieges 114, assaults 18, repelled 14,
capitals fallen 4, identical to M77 without it. Shipped anyway: it is a real unbounded-divergence
defect in a damage model, it is tested, it is fixture-neutral, and it would bite the moment anything
raises assault frequency. But it buys **no band**, and this note says so rather than implying value
it does not have.

*The actual blocker, which was visible in M77's own telemetry all along.* `114 sieges begun, 18
assaults resolved` — **at least 96 sieges never produced an assault at all.** Under the M72 baseline
the ratio is 39 assaults from 55 sieges (71%); under M77 it is 16%. The AI besieges and then holds.
`assaultAdvice` (campaign.ts, M54) counsels `assault` only when believed own strength ≥ estimated
resistance, `lift` when hopeless, and `hold` otherwise — so tripling the number of sieges against
capitals it must now actually storm parks almost all of them. **That is close to R7's original
"armies that mass", and it is the next thing to probe — the sieges that never assault, not the
assaults that fail.**

*Recorded because the pattern is now the phase's most useful output.* M77's cause has been wrong
twice: "the AI cannot take a defended castle" (refuted — castles undefended, AI 2.5–3× overstrength)
and "tower fire annihilates the column" (real, but 14 repulses out of a 96-siege stall). **Both times
the wrong cause was chosen by measuring the thing that was failing rather than counting the thing
that never happened.** The 96 missing assaults were in the very first M77 table and went unread. The
rule this phase has earned: *before explaining a failure, check the denominator — how many attempts
never reached the step you are explaining?*

**M79 probe (2026-08-03) — FINDING ONLY. TWO independent defects, and the dominant one is a
strength gate that silently abandons the army's own siege.**

M78 ended by naming the denominator nobody had counted: 114 sieges begun, 18 assaults resolved, so
**at least 96 sieges never produced an assault**. This probe counted the two places a siege can
stall — the war-path gates in `ai/military.ts` and every branch of `assaultAdvice` — under M77's
condition, over 100-year campaigns. All telemetry reverted; goldens re-verified green.

*Defect 1 — the strength gate blocks a besieging army from deciding its own siege. This is the
whole stall.*

| tally | `fair` 9000 | `hard` 9000 |
|---|---:|---:|
| **`GATE: besieging but under WAR_MIN_STRENGTH`** | **13,564** | **8,810** |
| `gate: field army under WAR_MIN_STRENGTH` | 1,081 | 148 |
| **reached the siege branch at all** | **40** | **12** |

`ai/military.ts` returns early on `committedCount(armyId) < WAR_MIN_STRENGTH` (20 men), and that
check sits ABOVE the existing-siege handling. The module already knows a committed army must not be
abandoned — the PLAN check immediately above it carries exactly that exemption, and its comment says
so ("a committed army … must see its war through regardless of the plan's second thoughts"). The
STRENGTH check has no such exemption. So an army musters 20+, marches, begins a siege, takes
attrition and upkeep desertion below 20 — and is **never consulted about that siege again.** It
cannot assault. It cannot lift. The siege stands until something else ends it. **Decision ticks lost
to this outnumber decisions actually made by roughly 340:1 and 730:1.**

*Defect 2 — the resistance estimate measures something the capture verdict does not use.* When the
counsel IS reached, the numbers are consistent and wrong:

| own | believed garrison | estimated resistance | ratio | branch |
|---:|---:|---:|---:|---|
| 171 | **0** | 184 | 0.93 | hold |
| 174 | 8 | 224 | 0.78 | hold |
| 236 | **0** | 365 | 0.65 | hold |
| 138 | **0** | 350 | 0.39 | lift |
| 254 | **0** | 184 | 1.38 | **assault** |

`estimateAssaultResistance` (game/intel.ts) sums `keepHoldStrength + ESTIMATE_TOWER_RESISTANCE per
tower + ESTIMATE_WALL_RESISTANCE per wall/gate + believedGarrison × ESTIMATE_STRENGTH_PER_MAN`. But
the actual capture verdict in `resolveSpatialAssault` is **`strength ≥ keepThreshold + rally`** —
keep hold plus the SURVIVING GARRISON's defence, and nothing else. **Walls and towers never enter
the verdict.** They slow and bleed the column on the approach; they do not raise the bar at the
keep.

So with a believed garrison of ZERO the estimator returns 184–365 against a true requirement of
**60**. It is inflated three- to six-fold by counting fortification that the verdict ignores. An army
at `own = 171` — nearly three times what taking the castle actually needs — is told to hold. Counsel
outcomes across both campaigns: **hold 21, lift 27, assault 4.**

*The two are independent and need different fixes.* Defect 1 is a missing exemption on one
comparison; defect 2 is a model mismatch between the estimator and the resolver. Fixing 1 alone
unblocks the decision loop but, with the estimate still inflated, most of those armies would simply
counsel `lift` — sieges would end instead of stalling, which is better but still not a war. Fixing 2
alone leaves the armies that most need re-deciding permanently unconsulted. **Both, and in that
order, is what M77 has been waiting for.**

*Method note, and the reason this probe found it.* M78 earned the rule "before explaining a failure,
check the denominator". Applied here it took one run: the dominant term was never in the assault
data at all, because the affected sieges never reached an assault to be measured. Both previous
causes for M77 were chosen by studying assaults that happened.

**M79 attempt (2026-08-03) — both defects FIXED and NOT SHIPPED. The fixes do exactly what they
were designed to do; the package costs a band nobody can yet attribute.**

M79's probe named two defects. Both were implemented, measured separately, and reverted.

*Fix 1 — the strength gate.* `committedCount < WAR_MIN_STRENGTH` moved BELOW the existing-siege
branch, so the floor gates MARCHING and never an army's decision about the siege it is already
conducting. One statement moved; the exemption the plan check one line above already grants was
simply missing here.

*Fix 2 — the resistance estimate.* `estimateAssaultResistance` now returns
`(keepHold + garrison × perMan) × (1 + attrition)` instead of adding tower/wall resistance in
keep-hold units. The dimensional argument is the justification: the resolver's verdict is
`strength ≥ keepThreshold + rally` and reads fortification nowhere, so walls and towers cannot
belong in that sum — what they do is remove a FRACTION of the column on the approach, which is a
multiplier. First-pass constants (`ESTIMATE_TOWER_ATTRITION = 0.15`, `ESTIMATE_WALL_ATTRITION =
0.01`) put a 4-tower/32-wall castle at ~115 where it read 184, and an 8-tower/92-wall one at ~187
where it read 365.

*Measured on the shipped clock, separately and together.*

| Band | baseline | gate only | gate + estimate |
|---|---:|---:|---:|
| adult cohort p10 (≥30%) | 43.0% ✓ | 43.0% ✓ | 35.5% ✓ |
| **oldest-village floor (≥15%)** | 15.5% ✓ | **10.8%** ✗ | **8.5%** ✗ |
| monoculture (≤60%) | 44% ✓ | 44% ✓ | 50% ✓ |
| earliest victory (≥y30) | y10 ✗ | y10 ✗ | y10 ✗ |
| changing hands (≥50%) | 93.8% (84) ✓ | 93.8% (**57**) ✓ | 87.5% (**78**) ✓ |
| **green** | **4 of 5** | 3 of 5 | **3 of 5** |

Both fixes behaved exactly as M79 predicted. The gate alone freed the stalled armies and they walked
away — changes fell 84 → 57, because the estimate was still inflated and the counsel said `lift`.
Adding the estimate fix converted those lifts back into assaults — changes recovered to 78. The
mechanism is confirmed end to end.

*And the package is 3 of 5 against a 4 of 5 baseline, on a band I could not attribute.* The
oldest-village floor is a MIN over every village older than ten years across all sixteen campaigns —
the noisiest statistic in the set, failed by one village. Probing `fair` seed 9000 found its worst
old village at **52.3%**, nowhere near the floor, so the 8.5% belongs to a campaign not yet
identified; the probe timed out before covering the rest.

**Not shipped.** The reasoning that would justify shipping — "more war legitimately costs an old
village its adults, and the band was ratified when war never happened" — is precisely the
restate-the-band-to-match-the-outcome move R8 and R9 forbid, and it is the same shape as the three
causes this phase has already got wrong by asserting instead of measuring. The fixes are correct,
understood, and cheap to re-apply; what is missing is one measurement.

**ANSWERED, same day, by attributing the minimum to its campaign** (temporary `VillageBand`
carrying population and village index; reverted):

```
FLOOR-FAIL  hard seed=9001 · vi=28 age=14y adult=8.5% pop=392 children=320
            · run: conquest y14 · occupations=3 capitalFalls=0 sieges=3
```

**Neither candidate. The village is not war-damaged and there is no new defect — the BAND's filter
is shorter than the system's slowest time constant.** The campaign ended at year 14 on a conquest
victory, and the village is fourteen years old: 392 people of whom **320 are children** and ~33 are
adults. That is a growing village measured inside its first maturation cycle, not a sacked one
(`capitalFalls=0`, and a sacked village does not hold 392 people).

`MATURE_RATE` is `1/(14 years)`. The band filters on `ageYears > 10`. **A village admitted at ten
years has not completed one cohort turnover**, so the "oldest-village floor" is not measuring old
villages at all — it is measuring whichever village happens to be youngest in the admitted set. And
because bands are read at campaign END, the band systematically penalises campaigns that finish
EARLY: M79's fixes made war decisive enough to end this one at y14, which is the entire reason the
floor moved 15.5% → 10.8% → 8.5%.

This is the same defect class as R9's 60-year clock, found by the rule R9 recorded: *check the
slowest term before choosing a window*. It was written for the victory clock and applies verbatim to
this filter.

**Consequence for M79's fixes: they are band-NEUTRAL, not a regression.** Excluding the immature
village, the package reads adult cohort 35.5% ✓ · monoculture 50% ✓ · changing hands 87.5% ✓ ·
earliest victory y10 ✗ — 4 of 5, the same as baseline, while fixing two measured defects and
recovering war activity the gate fix alone had suppressed.

**Still not shipped, and deliberately so.** The floor is a RATIFIED band; correcting its filter is
an owner decision, not mine, and this phase has three times shown my confident readings to be wrong.
Proposed as **ADR-14 (DRAFT)**: raise the filter to at least one full maturation cycle — 14 years
minimum, and 20 would be defensible since a cohort needs time to flow through, not merely to start.
Ratify it and both M79 fixes land unchanged on top; reject it and the fixes stay out with the reason
recorded. What must NOT happen is shipping them under the argument that "war legitimately costs an
old village its adults" — that argument is now measurably false.

**Gate P10's bands — RESTATED by R8 (2026-08-02). The originals were ratified at charter against a
premise that measurement dissolved; these are ratified now, before the fixes they measure, against
what is actually known.**

The sharpest statement of where the project stands: **no tree state in its history has had more
than three of the five M62 bands green at once.** Gate P9 had 3, the current tree has 2, the
boosts-off counterfactual has 3 — and they are not the same three. Phase 10 closes when five are
green together.

| # | Band | Status |
|---|---|---|
| 1 | villages changing hands in **≥50%** of campaigns | M62's, unchanged. Now measured on M70.5's corrected counter (occupations + non-capital captures + **capital falls**) — a corrected instrument, NOT a re-ratified band |
| 2 | adult cohort p10 **≥30%** | M62's, unchanged. Broken by M68; M71 owns it |
| 3 | oldest-village floor **≥15%** | M62's, unchanged |
| 4 | no single victory type in **>60%** of campaigns | M62's, unchanged. Broken by M68; M71 owns it |
| 5 | earliest victory **≥y30**, measured at the shipped 100-year cap | M62's, re-measured. **Never green in any tree state**; M73 decides whether the band or the measurement is wrong |
| 6 | assault repulse rate **≤50%** matrix-wide | **NEW (R8)**, replacing R7's unmeasurable "≥50% of sieges reach a resolution". M70.5 made repulses countable; M72 owns it |
| 7 | **≥36 of 72** techs have a measurable effect | R7's band 4, unchanged. M75 owns it |

Bands 1–5 must be green **simultaneously and with M68's boosts left ON** — that is the whole
difficulty, and splitting them across tree states is how this project spent Phase 9 believing it
had won two of them.

*(R7's original bands, superseded: they inherited "13% changing hands" as a war-competence problem
and a siege-resolution band that no counter could evaluate.)*

**R7's original band text, kept for the record:** This is M62's discipline
and the reason Phase 9's gate could not be reshaped to match its own outcomes. Five bands, run as
`bench:balance --real --years 60 --seeds 2` unless stated:

| # | Band | Source |
|---|---|---|
| 1 | villages changing hands in **≥50%** of campaigns | INHERITED from M62 unchanged — deliberately not restated |
| 2 | earliest victory **≥y30**, measured at the shipped 100-year cap | inherited; M72 may restate it, and if it does the restatement IS the deliverable (ADR required) |
| 3 | **≥50%** of sieges BEGUN reach a resolution — a capture or a lifted siege, never a stall | NEW. The 4-begun/0-resolved shape is the specific failure this phase exists to end |
| 4 | **≥36 of 72** techs have a measurable effect | NEW. Content band, gated, counted per ADR-12 |
| 5 | M62's three green bands (adult cohort p10 ≥30%, oldest-village floor ≥15%, monoculture ≤60%) STAY green | NEW as a REGRESSION guard — Phase 9 won these and Phase 10 must not spend them |

**Known risks, named now rather than discovered mid-phase.**

- *M71 is the phase and it is not de-risked by anything but M70.* If M70's finding is "the AI needs a
  strategic layer it does not have", M71 stops being a competence fix and the charter needs revising
  before it is executed, not during. That is the outcome M70 exists to surface EARLY and cheaply.
- *Two intentional re-records* (M69, M71), both predicted before recording per the standing rule.
  M73 and M74 are predicted fixture-NEUTRAL and must be verified as such, not assumed — M68's
  `techBoost` work was also predicted neutral and was, but only because Written Records happened not
  to be researched inside a fixture window.
- *Band 4 may be unreachable without M73.* If the per-kingdom board proves larger than scoped, M74
  falls back to the four `applies` kinds alone (~22 of 72) and band 4 fails honestly rather than
  being restated downward. A band lowered to match its outcome is the failure mode this project's
  review culture exists to prevent.
- *Gate P9's bands 4 and 5 were failed, not tuned.* Phase 10 inherits that discipline explicitly:
  no constant in `victory.ts`, `ai/military.ts` or `population.ts` moves to make a band green
  without an ADR saying so in its own words.

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

**R4 — two A1 predictions corrected by actually executing M56 (recorded 2026-07-22).**

- **Change:** doc 15's ADR-4 Amendment A1 "Saves & determinism" paragraph amended in place
  (struck claims kept visible, not silently rewritten) rather than reworded as if it had been
  right the first time. M60's roadmap row (this doc) gains an explicit prerequisite it was
  previously missing entirely.
- **Why:** M56's own re-record was preceded by a verification pass (per its execution prompt's
  discipline: explain every fixture change before recording, don't assume), which found two of
  A1's predictions didn't hold. (1) "M28-era saves hydrate unchanged" is false — `restoreState`
  throws a composition-mismatch invariant on a save naming a system that no longer exists
  (`castle-defense-rebuild`), before any building-level grandfathering logic runs; M28-era saves
  currently fail to load AT ALL, not "load with inert walls" as planned. (2) The stated REASON for
  campaign-demo's re-record — "AI ring-building disappears from recorded histories" — was itself
  wrong, though the re-record was correctly anticipated: a direct test (restoring only
  `Fortification`'s old component-registration position, changing nothing else) reproduced the old
  golden hashes exactly through tick 3000, proving the AI never built a single wall in that
  scenario. The actual cause is that `World.hash()` folds components in registration order, and
  re-homing `Fortification` from castles.ts into defence.ts moved where it registers — a
  consequence A1's determinism paragraph assumed away when it said re-homing was free.
- **Affected documents:** doc 15 (ADR-4 Amendment A1, "Saves & determinism"); this doc's M60 row.
- **Affected milestones:** M56 (closed, unaffected — the correction describes what shipped
  accurately, it doesn't reopen it); M60 gains a new blocking prerequisite (a stub system under
  the dead name, or `restoreState` tolerance for unknown saved system names) that must land before
  any M28-era-save grandfathering logic can be reached at all.
- **Risk impact:** lowers risk going forward — M60 would otherwise have discovered this gate live,
  mid-milestone, the same way M56 did. No behavioural change and no new re-record: this is a
  documentation correction only, traceable to the M56 commit's own verification trail.

**R5 — Phase 9 ("The Game") chartered from the M61.5 release review (ratified 2026-07-27).**

- **Change:** an audit milestone (M61.5) and seven repair milestones (M62, M63, M64a, M64b, M65,
  M66, M67 — "Phase 9 — The Game") appended as post-1.0 scope. No new systems: every milestone
  repairs, surfaces, or measures something already built. M62's outcome BANDS are ratified inside
  its own row and are binding — a gate written before the fixes so it cannot be reshaped to match
  them.
- **Why:** the M61.5 review found the M47.5 failure recurring one level up. R1 unified the
  composition; it never gated the composition's OUTCOMES. So a green 496-test suite, four
  byte-stable goldens, four clean corpus saves and three benchmark scenes at 3% of budget coexisted
  with a shipping game in which nothing is ever conquered (0 assaults, 0 captures, 0 eliminations
  across 16 × 60-year campaigns), 81% of campaigns end the same way in year 18–20, villages run at
  ~20:1 children-to-adults, and the player has no expansion verb at all. Freezing here would ship
  Phases 4, 8 and 8.1 — thirteen milestones of military, siege and castle work — as code the game
  never reaches.
- **Affected documents:** this doc (12); doc 15 (ADR-5 Conquest semantics, ADR-6 release
  positioning); GDD §16 rewrite lands inside M66, GDD §5's settler surface inside M63, and doc 07
  §3's stale roster-adoption note inside M67 — no design-doc change before those milestones.
  Doc 11's unmeasured-target admissions (render fps, memory, save size) are unchanged by this
  revision and remain open.
- **Affected milestones:** none reopened. Phase 8.1 stays closed — its castle system is not
  defective, it is unreachable, which is M65's problem and not a reopening of M55–M61.
- **Risk impact:** reduces the four release-blocking simulation risks the review named, and closes
  the art blocker by decision rather than by work (ADR-6) — which also trims M63's save browser and
  M67's tutorial to reachability-only. Adds three intentional re-records (M64b, M65, M66),
  deliberately unbatched so each moved hash has a single attributable cause. The one-time behaviour
  snap is Conquest's meaning changing under ADR-5: a save mid-campaign with a share-based Conquest
  in progress re-evaluates under the taken-village rule on first load — accepted, same class as
  OQ-9's re-derivation snap and A1's inert-walls snap.
  *(Amended by R6 below: M64b merged into M65, so R5's "three intentional re-records" is now two.)*

**R6 — M64b merged into M65 (owner-directed 2026-07-27, on the M64a finding).**

- **Change:** M64b ("population & economy repair") is dissolved into M65, which is renamed to
  "the military economy." M64a's own row is unchanged and stays closed — it delivered the finding
  that motivated this. Phase 9 is now M61.5 · M62 · M63 · M64a · M65 · M66 · M67.
- **Why:** M64a proved the ~20:1 child-to-adult inversion and the never-massing army are the SAME
  defect — recruiting at 10 adults/unit against floor-only gates, with no ceiling on army size.
  Two milestones would have paid two fixture re-records to fix one cause, and neither one's bands
  could have gone green alone: capping recruitment is what makes M62's adult-cohort band reachable,
  and the same cap plus an affordability check is what stops the recruit→desert→recruit churn that
  keeps armies from ever massing. Splitting a single cause across two commits is also exactly the
  attribution hazard the no-batching rule exists to prevent, pointed the other way.
- **Affected documents:** this doc (12) — M64b's row, M65's row, the Phase 9 sequencing note, and
  R5's re-record count. No ADR is affected: ADR-5 and ADR-6 concern M66 and release positioning
  respectively, neither of which this touches.
- **Affected milestones:** M64a closed and unaffected. M66 and M67 unaffected. M65 absorbs M64b's
  secondary scope (`SETTLER_PARTY`'s age mix, `FAMINE_MORTALITY`'s slope) and inherits its T
  objectives alongside its own.
- **Risk impact:** REDUCES total fixture risk (three intentional re-records become two) without
  weakening attribution, because the merged milestone still has exactly one root cause. Raises
  M65's blast radius: it now moves terra fixtures too (via the settler/famine secondary scope),
  where the pre-merge M65 would have moved only campaign fixtures — folded into the M65 prediction
  in the sequencing note above so the diff walk is checked against the wider set, not the narrower.

**R7 — Phase 10 ("The War") chartered from Gate P9's handover (ratified 2026-08-02).**

- **Change:** a seven-milestone Phase 10 (M69–M75) appended as post-1.0 scope, with its own five
  gate bands ratified at charter. Phase 9 remains CLOSED-NOT-PASSED and is not reopened — Phase 10
  is new scope, not a reopening.
- **Why:** Gate P9 named three ways forward and explicitly declined to choose between them. The
  owner chose option (a) against the written scope below, rather than against a sentence.
  The argument for it over option (b) is leverage, not ambition: one missing capability — AI war
  competence — is upstream of the failing changing-hands band, of ADR-5's taken-village Conquest
  clause (built, measured at 0/16, deleted at M66), and of thirteen milestones of military, siege
  and castle work that have never reached a conclusion in the shipping game. Option (b) is still
  defensible and is NOT argued against here; it simply requires the docs to say "dormant" plainly,
  which ADR-6 already licenses.
- **Scope discipline carried over:** the assault resolver is measurably NOT the defect (flat harness
  24 begun / 23 captured vs `--real` 4 begun / 0 captured), so this is a competence phase, not a
  systems phase. Two architecture changes are admitted — event-ID hashing and per-kingdom
  `StatModifiers` — both because Gate P9 named them as the standing tax on other work, and both
  scheduled at the phase head so their fixture cost is paid once.
- **Sequencing follows two Phase 9 lessons rather than restating them:** M70 commits a written cause
  and no fix (M64a's shape — Phase 9's one wrong turn was a ceiling specified at 0.15 and validated
  at the wrong population scale), and M71 is deliberately NOT split from that cause (R6's rule —
  two milestones would pay two re-records for one root cause).
- **Affected documents:** this doc (12) — new phase section and this record. No ADR changes: ADR-5,
  ADR-10, ADR-11 and ADR-12 are all *inputs* to this charter and none is amended by it. Doc 06 §8,
  doc 07 §3 and GDD §8 will need edits INSIDE M71/M74/M75, not before.
- **Affected milestones:** none shipped. M68 (un-chartered, shipped 2026-07-29) is unaffected and
  stays outside any phase; its `applies`-vocabulary follow-up is picked up by M74 rather than left
  implied.
- **Risk impact:** adds two intentional fixture re-records (M69, M71) and two predicted-neutral
  milestones that must be VERIFIED neutral (M73, M74). Concentrates the phase's risk in M71, which
  is de-risked by nothing except M70 — if M70 finds the AI needs a strategic layer it does not have,
  this charter needs revising before execution, not during, and M70 is scheduled early and cheap
  precisely to surface that. Band 4 (tech effectiveness) is the one band that may prove unreachable
  within scope; the charter states it fails honestly rather than being restated downward.


**R8 — Phase 10 re-chartered; R7's premise dissolved by its own first two milestones (ratified 2026-08-02).**

- **Change:** R7's M71–M75 are replaced. M69 and M70 shipped and stand; M70.5 and M70.6 are added
  as shipped un-chartered work. The new plan is **M71 decouple surplus from births · M72 the severed
  approach · M73 earliest-victory decided · M74 per-kingdom modifiers · M75 the tech tree · M76
  player agency & Gate P10.** Gate P10's bands are restated (seven, of which five must be green
  simultaneously). Phase 9 stays CLOSED-NOT-PASSED; this is not a reopening.
- **Why — R7 rested on two supports and measurement removed both.** (1) *"The AI cannot conclude a
  war."* False. `bench:balance` subscribed to `siege.assaultBegun`, an event **no code in this
  repository publishes**, so "0 assaults" was structural, not behavioural — the AI assaults
  constantly (19 in one 60-year seed). And `siege.captured` cannot fire where succession is on: a
  capital's fall publishes `siege.capitalFallen`. The flat harness sets `succession: false`
  (`ai/multiKingdomHarness.ts:109`), which is the ENTIRE "23 captured vs 0 captured" gap the charter
  was built on. (2) *"13% of campaigns change hands, and closing that needs AI war competence."* The
  13% was real, but the cause was not competence — it was money. M68's yield boosts alone move it to
  93.8%, measured by a counterfactual that neutralises nine multipliers and changes nothing else.
- **What replaced it.** The game has **two equilibria and no path between them**. Poor (Gate P9):
  demographics healthy, war never happens — 3 of 5 bands. Rich (post-M68): war works, demographics
  and pacing break — 2 of 5. One coupling separates them: `births` scales with food security and
  joy and **saturates at nothing**, while `MATURE_RATE` is flat, so any economy strong enough to
  fund a war floods the child cohort (M70.6, measured; the war-consumption alternative refuted —
  the worst village never saw a war). Breaking that coupling is the phase, and no earlier document
  names it.
- **The M68 decision, taken explicitly rather than inherited.** Its boosts are KEPT and M71 fixes
  the coupling, rather than reverting them. Reverting scores 3 of 5 and hands back a 13% war band —
  the original complaint — and the unbounded food→births coupling is a design flaw whether or not
  M68 exposed it. Recorded as a decision because the alternative is defensible: reverting is one
  content edit and restores Phase 9's equilibrium exactly.
- **Affected documents:** this doc (12). No ADR is amended: ADR-10, ADR-11 and ADR-12 remain inputs.
  Doc 06 §5 (population model) will need edits INSIDE M71, not before.
- **Affected milestones:** none shipped is reopened. M69/M70/M70.5/M70.6 stand as shipped. R7's
  M72–M75 survive as M73–M76 with their scope intact — only the war milestones changed.
- **Risk impact:** the phase's risk moves from "can the AI be taught to fight" (answered: it already
  can) to "can surplus be decoupled from births without breaking the economy that funds war" —
  narrower, but a live balance problem with no obvious safe constant. M71 is balance-affecting by
  construction, so `bench:balance --real` is in its DoD rather than after it, per M70.5's lesson.
  Two process guards now bind the phase: **no yield/cost/rate/threshold change ships without matrix
  numbers in its scoping note**, and **byte-identical fixtures are evidence about 125 days only.**

**R9 — the band-measurement command is corrected to the SHIPPED year limit; R8's premise is withdrawn (recorded 2026-08-03).**

- **Change:** the ratified balance command becomes `bench:balance --real --seeds 2` — i.e. the
  SHIPPED `DEFAULT_YEAR_LIMIT` of 100 — not `--real --years 60 --seeds 2`. `bench-balance.ts` passes
  `yearLimit: YEARS`, so `--years 60` shortened the game's own victory clock by 40% rather than
  merely truncating observation. **M71 is NOT SHIPPED** (see its scoping note) and Phase 10's
  milestone list is reduced accordingly.
- **Why:** on the shipped clock the untouched tree scores **4 of 5 bands** (adult cohort 43.0% ·
  oldest-village floor 15.5% · monoculture 44% · changing hands 93.8%; only earliest victory y10
  fails). On the 60-year clock the same tree scores 2 of 5. The difference is not noise and not
  tuning: `MATURE_RATE` is 1/(14 years), so villages are still in demographic transient at year 60
  — M70.6 measured exactly that — and the adult-fraction bands were reading a growth bulge.
- **What is withdrawn.** R8's founding premise — "the game has two equilibria and no path between
  them" — is **WITHDRAWN**. It was two readings of the same short clock. With it go R8's
  characterisation of M68 as half-regression (M68's tree is 4 of 5 at 100 years) and M71's charter.
  R8's other corrections STAND unchanged: the `siege.assaultBegun` and `siege.captured` instrument
  faults (M70.5), the severed-approach assault bug (M70), and the process guards on balance changes.
- **Affected documents:** this doc (12) — R8's premise paragraph, the Phase 10 milestone list, and
  Gate P10's bands, which must be re-ratified against the shipped clock before they gate anything.
  Doc 11 §6 should record the command change so nobody re-derives the short-clock numbers.
- **Affected milestones:** M69, M70, M70.5, M70.6 stand as shipped — none depended on the clock.
  M71 is cancelled with a finding. M72 (severed approach) is unaffected and remains the phase's
  clearest real defect. M73 keeps the earliest-victory question, which is now the ONLY failing band
  and is clock-independent; its `DEFAULT_PROSPERITY_POPULATION` sub-question is retired, since
  monoculture is green at 44%.
- **Risk impact:** removes a phase's worth of scope built on an artifact, at the cost of admitting
  every prior band number was measured on a configuration that does not ship. The forward guard is
  narrow and mechanical: **the gate command must not pass `--years`.** A third process rule joins
  M70.5's two — *a band measured inside a system's transient measures the transient; check the
  slowest term before choosing a window.* Population's is 14 years, so 60 was never enough.
