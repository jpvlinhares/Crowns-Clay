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
