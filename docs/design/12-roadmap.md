# 12 — Development Roadmap (48 Milestones)

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
| M48 | Release candidate → 1.0 | freeze, release notes, mod docs final, launch build | external RC playtest: SC-1..6 verified; ship |

---

## Dependency & Risk Notes

- Long-pole chains: ECS/determinism (M2–M5) → everything; AI harness (M24) is deliberately early —
  it de-risks R1 for all later AI work; combat (M27) precedes castles' siege value (M29).
- Technical-debt policy: refactor windows are built into gates; any "temporary" code carries a
  `DEBT(Mxx)` tag and CI counts them — the count must not grow across a phase.
- Open-question due dates: OQ-1,2 by M12 · OQ-5,10 by M26 · OQ-3 by M28 · OQ-6,7,8,9 by M32 ·
  OQ-4 by M39 (doc 14).
