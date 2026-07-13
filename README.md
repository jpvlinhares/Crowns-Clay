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
| M36 — Personalities (7 archetypes tuned, perturbation, legibility) | ✅ |
| M37 — Victory & defeat (all 5 victory tracks, contestability broadcasts, defeat flow) | ✅ |
| M38 — Difficulty system (capability tiers, labelled modifiers, presets) | ✅ — **Phase 5 complete: depth** |
| M39 — Modding v1 complete (save↔mod reconciliation, in-game Mods screen, modding docs site) | ✅ — **Phase 6 begins: product** |
| M40 — Sandbox mode & editor (privileged commands, editor palette reusing M9, sandbox/ironman save flagging) | ✅ |
| M41 — Audio & music (cue tables, music director, mixing, placeholder purge plan) | ✅ |
| M42 — UI/UX pass 2 (tooltips/ledgers everywhere, keybinds, accessibility) | ✅ |
| M43 — Tutorial & onboarding (advisor-driven tutorial as event content, no engine scripting) | ✅ |
| M44 — Localization & PWA polish (locale extraction, pseudo-locale CI, service worker, quota UX) | ✅ — **Phase 6 complete: product** |
| M45 — Content complete (full building/unit/tech/event rosters, final art integration waves) | ✅ — **Phase 7 begins: ship** |
| M46 — Balance campaign (telemetry-free tuning via harness stats; economy/war/victory pacing) | ✅ |
| M47 — Hardening (stress ceilings, save-corpus torture, crash triage to zero-known-blockers) | ✅ |
| M47.5 — Architecture, design & release audit (roadmap revision R1 ratified) | ✅ |
| M47.6 — Unified campaign composition & new-game screen (`composeCampaign` on real worldgen) | ✅ — **Phase 7-INT: integration begins** |
| M47.7 — Player UI for diplomacy / military / research / victory (no injector-only actions) | ✅ |
| M47.8 — AI & balance on the real game (food-first jobs solver, multi-village AI, beliefs wired) | ✅ this commit |
| M47.9 — Recertification & truth pass (campaign crash triage, benchmark CI gate, ADRs) | ✅ this commit — **Phase 7-INT complete** |
| M48 — Release candidate → 1.0 | ⬜ entry gate OPEN (doc 12 R1: SC-1..6 verified against the unified composition) |

> **Honesty note (M47.5 audit; updated at M47.9):** Phase 7-INT closed the audit's central
> finding — the unified campaign (`composeCampaign`) IS the playable game now: real worldgen,
> multi-kingdom AI with content personalities, war/diplomacy/research/victory with player
> panels, save/load, new-game screen, all pinned by the `campaign-demo` golden and the
> `--real` balance/crash harnesses. **Still-true caveats for M48:** no art assets or asset
> pipeline (doc 10 §1–§5 unbuilt; the audio release lint correctly fails on 12 placeholders);
> characters (M34) are CUT from 1.0 by ADR-1 (doc 15); the knowledge model ships
> army-strength-beliefs-only by ADR-2; castles/sieges have AI conduct but no player build-UI
> beyond the shared build palette's wall pieces; doc 11 §1's hard stress ceilings (80 villages,
> 3,000 units, 600 characters) and `bench-econ-max` remain unverified/unbuilt; the benchmark CI
> gate is absolute-budget, not regression-vs-baseline. M42's "six systems without UI" is now
> two by design (characters — cut; sandbox editor — capped at the debug palette per GDD §17).

## Layout (TDD §3)

```
packages/
  core       pure utilities: seeded PRNG, interning, hashing, math   (deps: none)
  data       schemas, validators, content types                      (core)
  sim        kernel, ECS, systems, AI — HEADLESS, no DOM             (core, data, protocol)
  protocol   command & snapshot message types                        (core, data)
  render     WebGL renderer                                          (core, protocol)
  ui         HTML views/HUD                                          (core, protocol)
  audio      music director, mixing, cue playback                    (core, protocol)
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

### Tutorial & onboarding (M43)

The roadmap line reads as content-only ("advisor-driven tutorial as event content, no engine
scripting"), but scoping it surfaced two real, unclaimed prerequisites first: the M33 events
engine had never been composed into the actual playable game (`registerEventGameplay` only ever
ran inside the AI-vs-AI test harness, `packages/sim/src/ai/multiKingdomHarness.ts` — confirmed by
grep, zero call sites in `packages/app`), and no event-choice dialog UI existed anywhere (doc 05
§7 names "Event dialogs" as a distinct panel type; nothing had ever built one). Both were
genuinely M43's to close, not silently assumed away.

**Events, live in the game for the first time:** `registerEventGameplay(kernel, world, db, game,
popGame, kingdomGame)` is now wired into `packages/app/src/terra.ts`, with no diplomacy/research
hooks — both are OPTIONAL by the module's own design (`hasTech` always false, `opinionChange` a
no-op), the same graceful-degradation shape `victory.ts`'s `VictoryDeps` already established.
`EventState` gained its first-ever `save()`/`restore()` (previously only `fold()` for hashing
existed — nothing had ever needed to survive a save/load before) and a new `events` save section;
verified live — save mid-dialog, reload, load, and the exact same pending dialog reappears.
Wiring a whole new daily+weekly system in from tick 1 changes RNG consumption from the first tick,
so `terra-demo`'s golden replay and the save corpus fixture were both re-recorded — intentional,
called out here as the repo's own policy requires.

**"No engine scripting" held to the letter, not just the spirit:** the tutorial is 6 ordinary
`EventDef`s (`content/base/defs/events/tutorial.json5`) running through the EXACT SAME
`evaluatePredicate`/`applyEffect` engine every other pool uses — zero new predicate/effect kinds,
zero `scripts/hooks.js` (still unbuilt, still correctly out of scope per OQ-3's closed DSL-only
decision). The one addition, a `'tutorial'` entry in `EVENT_POOLS`/`DAILY_POOLS`, is vocabulary
growth doc 09 §8 explicitly reserves ("the vocabulary is additive... land later without a
rewrite"), not a new mechanism — confirmed harmless to the AI harness by running it directly
(8-kingdom 50-year survival, the 7-archetype fingerprint test, and the M33 harness's own
determinism check all still pass with the new pool in place — AI kingdoms fire and auto-answer
tutorial events same as any other, no special-casing needed).

**Ordering is emergent, not scripted** — Vision Philosophy #1 ("behaviour emerges from systems and
state, never hard-coded story beats") applies to the tutorial too: each step's trigger uses only
the existing closed vocabulary (`season`/`stat`/`chance`/`all`), chosen so the six land in a
sensible order as a real campaign unfolds — welcome (day 1) → economy check-in (`village.
foodSecurity ≥ 0.8`) → happiness/tax/edicts (season-paced through the first year) → **completion,
triggered by `village.tier ≥ 2`** — the SC-1 "stable, growing kingdom" signal itself, not a
stand-in for it. The Steward narrates throughout (GDD §2's existing office, not an invented
persona — the GDD names no tutorial-specific advisor, so reusing the one already tied to the
realm's day-to-day economy was the least invented choice available).

**The first event-choice dialog UI** (`packages/app/index.html`'s `#event-dialog-backdrop`,
`main.ts`'s `showNextEventDialog`): a modal (`role="dialog" aria-modal="true"`, M42's ARIA
precedent) fed by a small FIFO queue — `event.fired` (live) and a new `pendingEvents` field on
`snapshotFull`'s `kingdom` block (recovered via `EventGameplay.pendingChoices`) both feed it the
same way, so a dialog interrupted by a reload is never silently lost. Opening one auto-pauses
(GDD §1's urgent-pause tier, same "never rushed" pillar tooltips already serve) — resuming is
deliberate, not automatic. `UICatalog` gained an `events` projection (id → title/body/choice text)
mirroring the exact `buildings`/`edicts` pattern M18 established, so `@crowns/ui` still never
imports `@crowns/data` directly.

**The T objective — "new-player playtest ≥80% completion"** can't recruit a human tester from
here, so it's proven the way this project's playtest T-objectives always have been: a real sim
integration test (`packages/sim/src/game/events.test.ts`) drives the actual engine through all 6
steps in sequence — welcome, force `foodSecurity` healthy, let season advance naturally through
summer/autumn/winter, fund the treasury, force `village.tier` to 2 — and asserts every step fires
exactly once (`once: true` honored) and every fired step gets resolved, proving the full sequence
is mechanically completable end-to-end; then a hands-on browser walkthrough confirmed the same
sequence renders and resolves correctly for a real player, including the reload-recovery path.

### Recertification & truth pass (M47.9) — Phase 7-INT complete

Every M47-era certificate re-earned against the UNIFIED composition, plus the truth debts the
M47.5 audit named. **Crash triage:** the first 100-seed real-composition run FAILED — 11/100
campaigns died at tick 1 ("too close to another village center"): fairPlacement's "sectors are
naturally far apart" assumption never actually enforced GDD §13's own "minimum pairwise
distance", and crowded small maps converged two sectors' picks. Fixed from both ends (the
solver now rejects candidates inside `VILLAGE_MIN_SPACING`; genesis falls back to
`bestSiteNear` instead of throwing) — rerun: **100/100 campaigns crash-free** (4 kingdoms ×
25y × all four difficulties, 1609s); all committed fixtures verified byte-identical through
the fix. **Benchmark scenes** (doc 11 §6's named-but-fictional tools, finally real):
`bench-scenes.ts` runs war-max / ai-8k / late-campaign on the shipping composition and gates a
new CI job (`benchmarks`, ci.yml) on doc 11 §2's absolute budgets — measured: war-max 0.086
ms/tick mean (budget 10) · AI share 8.4% (budget 30%); ai-8k 0.181 ms / 11.6%; late-campaign
(20 organic years, then a measured year) 0.124 ms / 6.7%. Honest divergences recorded in doc
11 §6's M47.9 delta: absolute budgets rather than regression-vs-baseline, `bench-econ-max`
still unbuilt, war-max fields real-AI army sizes, not the 2,000-unit stress ceiling. **ADRs**
(new doc 15): ADR-1 cuts Characters (M34) from 1.0 (zero consumers; advisors are the 1.0
character surface); ADR-2 scopes the knowledge model to army-strength beliefs at 1.0; ADR-3
records the harness-first retrospective and binds the new rule — a gameplay milestone is done
when it's IN the shipping composition with a player surface. Final recertification on the
closing code: 398/398 tests, lint clean, all goldens + corpus byte-stable, balance matrix
green on all three R1 T objectives. **Phase 7-INT is complete; M48's entry gate is open.**

### AI & balance on the real game (M47.8)

The real-composition balance matrix (`bench-balance.js --real` — 2-kingdom duels AND 4-kingdom
fields × all 4 difficulties × seeds, on real worldgen with content personalities) drove this
whole milestone, and it earned its keep by failing loudly, three times, before passing:

**First run: zero wars ever, six peacetime starvations, Prosperity auto-won year 10 in all 8
runs.** Root causes, each fixed and re-verified: (1) start sites sit beyond scout range, so no
kingdom ever DISCOVERED another — closed with GDD §13's own "history seeding" (courts know their
neighbours' capitals from day one; later villages stay fog-hidden); (2) `foodNeed` trusted
DECLARED farm capacity while real-terrain biome modifiers made realized output lower — villages
"satisfied" the need on paper while starving (the M46 open finding, finally root-caused). The fix
took three iterations, each caught by a probe: security-EMA awareness alone → a 50-farm panic
pileup whose construction sites consumed every adult as builders; + pending-site capacity →
stable, until (3) population crossing exactly 30 let the M46 recruit floor pass and the AI gutted
10 of its 14 ADULTS for one spearman (the floor counted heads, not the workforce; the surplus
check was nameplate too) — recruit now requires 12 adults remaining AND a healthy realized
security EMA; (4) Prosperity's threshold (70) exactly equalled the fed-only happiness baseline,
so its streak began on day 1 of every campaign and no other track could ever fire — now 80
happiness + 15 years + a 60-head realm (prosperity means a GROWN realm, not subsistence
stability). **Final matrix: 16/16 campaigns, zero peacetime starvation, 19/19 wars ended, and
THREE victory types organically (conquest, prosperity, chronicle) — the R1 T objectives hold.**

The systems behind it (each campaign-default, harness-wrapper-opt-out so M22-M46 tests stay
pinned): **multi-village AI** (fog/war/discovery over ALL owned villages via a plain
event-maintained ownership index; settler-founded villages inherit their source's banner);
**occupation** (`game/occupation.ts` — an at-war army holding an undefended non-castle village 5
days takes it; the conquest path plain villages never had; hashed + saved state); **beliefs
consumed** (doc 07 §6: per-AI `KnowledgeModel` over rival strength, contact-refreshed,
confidence-decayed, deterministic noise — stale beliefs now cause honest mistakes); **grudges
consumed** (doc 07 §7: `PunitiveRaid` archetype scores the heaviest decayed memory and marches on
whoever wronged it); **industry chain** (`industryNeed` — the AI raises wood→planks→tools itself;
the 300-tool genesis warchest is now a 25-tool starter kit); **food-first jobs solver**
(builders → haulers → food → other production; the first fix attempt put food before haulers and
starved the carts — the famine test caught it). `crash-triage --real` gained the same real-
composition mode for M47.9. Fixtures: campaign-demo/campaign-tick500 re-recorded (intentional,
three times, once per behavioural fix); terra fixtures byte-identical throughout.

### Player UI for the dark systems (M47.7)

The M42 audit's named gap — six implemented systems with no player surface — closes for four of
them: **Diplomacy 🤝, Military ⚔, Research 📜, Victory 🏆** are real `PanelHost` panels now
(keybinds D/A/R/Y), fed by a new player-scoped, fog-gated projection (`PlayerPanels`,
`packages/protocol`) the worker emits on every day boundary, after every executed player command,
and on request — an undiscovered kingdom shows existence only, and "Known for…" personality tags
(doc 07 §9's legibility promise, finally rendered) appear only once scouted. Every action is an
ordinary command draft, exactly what the debug injector always sent — recruit (barracks-gated),
muster army, assign units, **march via armed map click** (mirrors the M18 build-arming pattern;
Esc cancels), besiege via clicking the target castle's buildings, assault/lift, gift/insult/
pacts/alliance/war/peace with tooltip'd consequences, and research selection. A **war report**
log renders battle/siege/war/peace events in the Military panel. **Campaign end screen**: victory
(yours or a rival's, named) and last-village defeat both raise a pausing modal with "Keep
playing" (GDD §16's sandbox-respecting ending). The new-game screen gained **Year limit** —
short Chronicle campaigns are now a product feature AND the injector-free path to a real end
screen. Victory grew live `tracksOf` progress (same math as the daily tracker, computed on
read) shown as percentages with the 80% contestability threshold tooltip'd. T objective
(`packages/app/src/warPanels.test.ts`): a port-driven session — the browser's exact transport —
picks research, builds a barracks, recruits militia, musters/assigns/marches an army (position
asserted to actually change), confirms diplomacy is fog-rejected toward unscouted rivals, and
runs a 1-year Chronicle campaign to a real declared winner; plus a hands-on browser walkthrough
of the same loop. **Honest scope:** siege UI is exercised against AI castles only when one
exists (AI builds walls under MilitaryBuildup); villages without defensive works still cannot be
occupied at all — a real conquest-path gap chartered to M47.8, not a UI omission. Characters and
sandbox-editor palettes remain debug-only pending the M47.9 ADR (characters are proposed CUT
from 1.0).

### Unified campaign composition & new-game screen (M47.6)

The M47.5 audit's central fix: ONE composition — `composeCampaign` (`packages/sim/src/campaign.ts`)
— wires the FULL game (real worldgen + fair placement, economy→siege stack, fog/scouting,
diplomacy, research, events, victory & defeat, difficulty, per-kingdom content-personality AI,
and save/load), and both the harness AND the live game are now thin consumers of it.
`composeMultiKingdom` pins the historical harness conditions (flat terrain, inert victory, no
calendar) as wrapper options — all 295 pre-existing sim tests, including the 8-kingdom/50-year
survival run, pass unchanged, which works because the kernel forks each system's PRNG by name, so
the appended systems (calendar, victory-tracker) never perturb existing streams. **New-game
screen** (`index.html`/`main.ts`): seed, map size, kingdoms (1–8), difficulty preset, victory
toggles, sandbox — the hardcoded `SEED` is gone; `?quickstart=terra|campaign` keeps the pinned
CI seeds. **Save/load grew real teeth:** every hash-contributing relational state gained a
section (research/victory/combat/siege/fog were previously unserialized — fog loss was invisible
to `stateHash` but would silently lobotomize loaded AI), the save header embeds the new-game
settings, and the load path recomposes from the header. Proven by `campaign.test.ts`'s strongest
check — a loaded session tracks the uninterrupted original hash-for-hash for 20 days — plus a
third corpus entry (`campaign-tick500-v1`) and a fourth golden scenario (`campaign-demo`, which
also rides the cross-engine browser-harness determinism CI for free). **Two real bugs surfaced
and fixed on the way:** victory.ts's event subscribers did ECS reads inside OTHER systems'
access-guarded scopes (crashed the moment a settler founded a village with the tracker attached —
the owner now rides on the `village.founded` event, and wonder completions drain through the
tracker's own unscoped update), and `bench-balance`/`crash-triage` were updated to use the
composition's own tracker instead of double-registering. Verified in-browser end-to-end: new
game → 4 kingdoms on real terrain → tutorial fires → save → load recovers the same campaign
(header-driven recomposition) mid-dialog. Fixture re-records: `campaign-demo` and
`campaign-tick500-v1` are NEW; terra/wanderers/calendar fixtures re-recorded byte-identical
(composition untouched). Inherited v1 gaps chartered to M47.8, not hidden: one village per AI
kingdom, free starting tools for AI, truth-based sensing.

### Architecture, design & release audit (M47.5)

A formal internal release review of M1–M47 against the full design set (docs 01–14), conducted as
a studio-director audit rather than an implementation milestone. **Verdict: Not Ready for Release
— roadmap revised before M48** (doc 12, revision R1). The engine-side verdict is strong
(determinism, boundaries, testing, modding, docs all at or above target); the release blocker is
a single structural finding: every Phase 3–5 system — multi-kingdom, war, diplomacy, research,
victory, difficulty, the entire "simulated rivals" USP — is verified only in the standalone AI
harness and is absent from the playable composition (`composeTerra`), which remains the Phase 2
economy sandbox on a hardcoded seed. Secondary findings: `ai/brain.ts` (knowledge model) and
`game/characters.ts` have zero non-test consumers; combat is a single-aggregate-line v1; the
doc 11 §6 benchmark CI gate is documented but unbuilt; the status table above previously carried
no caveats (now fixed). Full findings, scorecard, and risk register are in the audit report
delivered with this milestone; the actionable output is **Phase 7-INT (M47.6–M47.9)** in doc 12 —
unify the composition on real worldgen with a new-game screen, give the dark systems player UI,
fix the known balance defects on the real game, then recertify crash/benchmark/doc claims before
M48 freezes 1.0.

### Hardening (M47)

Three roadmap threads — stress ceilings, save-corpus torture, crash triage — with the T objective
("100 seeded full campaigns crash-free") doing double duty as the crash-triage deliverable itself.

**Crash triage, 100/100 clean.** A new tool, `packages/tools/src/crash-triage.ts` (`npm run
crash-triage -- [--seeds N] [--years N] [--kingdoms N]`), reuses M46's harness shape but tuned for
BREADTH: 100 distinct seeds, spread evenly across all four `DifficultyLevel`s, four kingdoms each
with a rotating spread of aggressive/peaceful/trusting/wary personality profiles, 25 years —
enough to exercise construction, recruitment, research, diplomacy, and (when a war catches fire)
sieges, without the full 40-100 year runtime M46's own balance runs use. All 100 completed without
a single uncaught exception, ~313 s total. "Crash" here is read at its narrowest, most literal:
an exception during `kernel.step()` — this tool doesn't judge pacing or balance, M46 already did.

**Save-corpus torture.** The corpus had exactly one entry and one verification shape (load, resume
100 ticks, check the hash) — proves a save survives ONE load, not that it's stable under repeated
real-world "save, quit, relaunch, load" use. `save-corpus.ts` gained `tortureCorpusEntry` (`npm run
save-corpus:torture`): chains N independent save→load round trips end to end, each cycle
re-saving from the FRESHLY LOADED session rather than the original, so a latent load-then-resave
defect would compound instead of hiding behind a single clean pass. Also added a SECOND corpus
entry, `terra-sandbox-v1` — composed with sandbox flags on, a genuinely different code path
(`SaveManager.setSandboxFlags`, M40) the original entry never touched. Both entries: verify clean,
and hold hash-stable across 5 torture cycles (500 ticks) each.

**Stress ceilings (doc 11 §1), partially verified, honestly scoped.** AI kingdoms (12 — a genuine
first: earlier balance-harness runs only ever went to 4) and active haul jobs (2,000, via
`bench-haul.js`'s existing CLI args) both run clean, comfortably inside the sim-tick budget. Map
size stress (768×768) needed a real, if small, code change: `worldgen/types.ts`'s `MapSize` union
only ever named small/medium/large — a `stress` entry was added (not player-selectable, no
world-creation UI exists to offer it; it exists purely so `bench-worldgen.js` has a size to
generate against) — 768² generates in 535 ms, no crash, no budget concern. **NOT independently
stress-tested:** villages (80), concurrent units (3,000), named characters (600) — each would need
either a purpose-built large-scale scenario or many decades of organic play to reach naturally,
and doc 11 §6's own named nightly benchmarks for exactly this (`bench-war-max`, `bench-ai-8k`,
`bench-late-campaign`) don't exist as tools yet either — a pre-existing gap this milestone didn't
create and didn't have the remaining budget to close. Flagged in doc 11 §1 directly rather than
silently assumed fine.

Build/lint/all 393 tests (392 + the new torture test)/golden replays/save corpus all green
throughout. Nothing here is browser-observable (pure sim/tools code, no UI surface), so no
in-browser check was run.

### Balance campaign (M46)

"Telemetry-free tuning via harness stats" (doc 01 §9: no player telemetry beyond opt-in local
diagnostics) meant building the thing that had never existed: a way to run a REAL, emergent,
multi-year AI economy and see what actually happens, rather than the engineered/forced-state
tests `victory.test.ts` always used ("whether the real economy organically reaches these states
is a separate balance concern (M46), not this milestone's" — that module's own words, quoted back
at it now that it's done).

**Difficulty presets, wired into a real composition for the first time.** M38 shipped four
`DifficultyPreset`s (Story/Fair/Hard/Brutal) with real hooks into the planner, scouting,
diplomacy, and kingdom-yield systems — but grepping the codebase found NOTHING actually applied
one: not `terra.ts` (the single-player composition), not the M24 nightly harness, nowhere. SC-2
("full campaign completable at every difficulty") was consequently untestable — there was no
"every difficulty" to run. `multiKingdomHarness.ts` now accepts an optional campaign-wide
`difficulty: DifficultyPreset`, threaded into the four levers that already had somewhere to
attach (appraisal noise/period, scouting radius, joint-war coordination, labelled yield). Left
genuinely OPTIONAL rather than defaulted to `FAIR_PRESET` — the first attempt defaulted it and
silently broke two existing tests (`multiKingdom.test.ts`'s 50-year survival, `difficulty.test.ts`'s
own T objective), because FAIR_PRESET's own doc claim ("every multiplier at its M19-M37 neutral
value") turns out not to match the actual code defaults (real `appraisalNoise` default is 0, not
FAIR's 0.12; real `jointWarCoordination` default is `'on'`, not FAIR's `'limited'`) — a real,
previously-invisible inconsistency this milestone's own tooling surfaced by being the first code
ever to exercise it, documented in `multiKingdomHarness.ts` rather than quietly patched over by
renumbering FAIR_PRESET (its Story>Fair>Hard>Brutal noise ordering is a deliberate, self-consistent
design — the mismatch is the doc claim, not the numbers). `knowledgeHalfLifeMultiplier` stays
unwired: `ai/brain.ts`'s sensor/confidence model was never part of this harness to begin with, a
pre-existing gap this milestone didn't create and isn't the one to close either.

**The balance harness itself** (`packages/tools/src/bench-balance.ts`, `npm run` has no shortcut
yet — invoke directly: `node packages/tools/dist/bench-balance.js [--years N] [--kingdoms N]
[--seeds N]`): runs one full AI-vs-AI campaign per (seed × difficulty), with the REAL
`VictoryGameplay` tracker attached (not engineered), and reports what happened — crash/no-crash,
which track won and in what year, kingdoms eliminated, final population/treasury spread. Required
exporting `composeMultiKingdom`/`registerVictoryGameplay`/the difficulty presets from `@crowns/sim`'s
public index for the first time (they'd only ever been reached via test-only relative imports).

**What the harness found, first run: total population collapse, every kingdom, every difficulty,
within 5 years — zero wars ever declared.** Not a war-economy problem; a peacetime one. Traced
with ad hoc instrumentation (event counts, per-checkpoint population/building snapshots) to
`ai/military.ts`: once the strategic planner favours `MilitaryBuildup` (driven by the `aggression`
weight alone — it needs no rival in sight), the manager submitted an unconditional
`army.recruitUnit` order EVERY DAY, forever, with no check on whether the village could still feed
itself. Recruiting costs `UnitDef.popCost` adults PERMANENTLY (10 for a spearman) — against a
starting population of ~45, two or three recruits is most of the adult workforce, and the farms
they used to staff never get replaced. **Fixed** with two gates before a recruit order is
submitted: a food-surplus ratio (production capacity ≥1.3× need) and a hard population floor
(recruiting must leave ≥20 behind) — two, not one, because the first alone wasn't enough: it
checks DECLARED recipe capacity (`ai/needs.ts`'s `productionCapacity`), not realized output after
workforce staffing, so a village could still pass the ratio check, recruit anyway, and then watch
its now-thinner workforce under-produce what the nominal number promised. Verified with the same
ad hoc instrumentation: a single-kingdom run that previously collapsed 45→4 by year 5 now holds
stable at 25 through the full 5 years tested; the full 4-kingdom mixed-personality matrix now
regularly reaches a real Prosperity victory around year 10, at every difficulty, instead of an
empty Chronicle fallback at the year cap.

**A second, deeper issue survived the fix, honestly flagged rather than chased into this
milestone's remaining time:** in the SAME 4-kingdom matrix, the two economy-leaning ("Builder")
kingdoms still eventually starve out over 10-20 years even with recruiting fully gated off (traced
directly — zero wars, zero recruits, zero settler dispatches for those kingdoms in the run that
showed it). Leading hypothesis, from reading `population.ts`'s own module doc ("hourly: jobs
solver — builders first, then production BY STABLE ORDER," not by need): the workforce allocator
has no concept of "feed the village first" — as a kingdom accumulates buildings (a `TechRace`-
favouring kingdom's construction manager was observed queuing 200+ times over the run that
starved), non-food production can end up competing for labour with zero priority given to farms,
and nothing currently protects food security the way M46's OWN military fix now protects it from
recruitment. This needs its own investigation (most likely a jobs-solver priority change, a larger
and riskier piece of economy.ts than a two-line recruit gate) — recorded here, in `victory.test.ts`'s
module doc, and in `ai/military.ts`'s own comments so the next session doesn't have to
re-derive it from scratch.

**SC-2, honestly scored:** better, not solved. Every difficulty now reaches a real victory well
inside the year cap in the harness (the literal "completable... without crashes" holds — nothing
throws, nothing hangs). But a 4-kingdom campaign where two kingdoms starve to zero population is a
soft-lock in spirit even where the kernel keeps running and a technicality-victory still fires —
calling SC-2 "passes" outright would overclaim what was actually verified.

Build/lint/all 392 tests/golden replays/save corpus stayed green throughout (the harness-exercised
code paths — `ai/military.ts`, `multiKingdomHarness.ts`, `game/victory.ts`'s new public export —
have no existing dedicated unit tests of their own yet; the verification here was the harness runs
themselves, not `node --test`). Nothing here is browser-observable (pure sim/AI/tools code, no UI
surface touches military recruitment or difficulty selection yet), so no in-browser check was run.

### Content complete (M45)

The roadmap line ("full building/unit/tech/event rosters, final art integration waves") names two
very different kinds of work, and only one of them was buildable this milestone. **Art integration
has zero infrastructure to integrate into** — confirmed at M44's research pass and unchanged since:
no atlas packer, no icon rasterizer, no art-src pipeline exist anywhere in the repo (doc 10's whole
§1-§5), and no actual art assets exist to wave in — there's no artist producing sprites in this
process. Calling that "done" would be dishonest; it stays an open gap, same posture doc 10's M44
delta already took with the service-worker cache-key story.

**What WAS real, buildable "content complete" work: closing the actual roster gaps against the
GDD.** A quick audit (`grep`-counting unique ids per content kind) found buildings (22) and techs
(72, already within M32's own 60-80 target) essentially complete, but the unit roster was thin:
GDD §6 names 10 unit types (militia, spearman, swordsman, archer, crossbowman, cavalry, knight,
ram, catapult, trebuchet); only 5 existed. The other 5 — swordsman, crossbowman, knight, ram,
trebuchet — are added now (`content/base/defs/units/core.json5`), each gated behind a warfare tech
that (per a second audit, grepping for empty `unlocks` blocks) had previously unlocked NOTHING:
Barracks Discipline, Siege Basics, Tower Emplacements, Combined Arms. "Trebuchet Engineering" had
an even odder gap — a tech with that exact name unlocked only the catapult; it now unlocks the
trebuchet too. All five slot into the existing `class`/`counters`/`cost` shape with **zero sim
code changes**: confirmed by grep that `game/siege.ts`'s bombard bonus keys off `unitDef.class ===
'siege'` generically, not a hardcoded catapult id, so the two new siege units get real siege
behaviour for free. Deliberately did NOT build the archery-range/stables/siege-workshop buildings
GDD §6 also names — every unit still recruits at the barracks, the same "v1 simplification" the
original catapult's own M29 comment already flagged, not a new corner cut this milestone.

Edicts got a smaller, more surgical fix: `edicts.ts`'s `MODIFIER_TARGETS` has named 5 stat paths
since M32, but only 3 of them had any edict actually using them — `kingdom.taxYield` and
`kingdom.researchYield` sat completely unused. Two new edicts (Merchant Charters, Scholarly
Endowment) close that, rather than inventing new mechanism for the GDD's other example edicts
("Conscription", "Open Borders") that don't map onto anything the closed vocabulary already
expresses — extending that vocabulary (and wiring the sim to consume a new stat path) is real
scope, deliberately left for whenever those systems actually need it, not manufactured here to
pad a roster.

**The T objective — "zero TEMP_/placeholder in release profile"** is where this milestone's
honesty matters most. M41 already built the actual gate (`packages/tools/src/audio-lint.js
--release`) with exactly this exit condition in mind (its own module doc says so verbatim: "in
`--release` mode it becomes the M45 exit gate"). Run now: **12 placeholder audio assets still
exist (9 cues + 3 playlists), and `--release` mode correctly fails with exit code 1.** That's not
a bug — no real audio has been produced (there's no sound designer in this process either), so the
gate SHOULD fail; a passing gate would mean either the mechanism is broken or someone quietly
deleted the placeholder flag without replacing the asset. The mechanism itself is verified
correct and will do its job the moment real audio lands, whenever that is (M46-M48, or post-1.0).
Reporting this as "done" would defeat the entire point of building a lint for it.

Build/lint/all 392 tests/golden replays/save corpus/all three benchmarks stayed green throughout —
this was purely additive content plus one doc/comment pass, no sim or presentation code touched,
so no fixture re-recording was needed and there was nothing to verify in-browser (military
recruitment has no player-facing UI yet — command-injector only, per M27's own scoping note — so
the new units are exercised only through the same automated DAG-validation/referential-integrity/
AI-harness tests that already covered the existing roster).

### Localization & PWA polish (M44)

Two independent roadmap threads, both starting from zero infrastructure (confirmed by exhaustive
grep before writing anything: no i18n table anywhere, no manifest/service-worker file anywhere).
Both landed as **infrastructure + a proof-of-concept slice**, not exhaustive coverage — this
codebase's established pattern for milestones with an unbounded surface (M39's mod docs shipped
one sample mod, not a library of them; M41 shipped placeholder audio, not final tracks).

**Locale core (`packages/core/src/locale.ts`):** `LocalizedText` is a branded string (same
nominal-typing trick `EntityId`/`InternedId` already use) — a locale KEY, never raw display text,
so an unconverted literal where a key is expected is a compile error. `formatMessage` is a real
ICU MessageFormat SUBSET: `{placeholder}` interpolation and `{var, plural, one{} other{}}` only
(English's two categories) — not gender, not the other CLDR plural categories. `Locale.resolve`
fails VISIBLE on a missing key (returns the key itself), matching the DSL evaluator's own "never
throw on bad content" discipline (`game/events.ts`) — a missing translation reads as an odd string
in the UI, never a blank or a crash.

**`EventDef.text`/choice text converted for real** (doc 06 §11's M33 delta explicitly deferred
this): `content/base/defs/events/*.json5` now hold locale KEYS
(`event.<pool>.<slug>.title`/`.body`/`.choice.<id>`), and `content/base/locale/en.json5` holds the
actual English. Resolution happens server-side, in `simPort.ts`'s catalog projection — the exact
"sim worker projects `DefinitionDatabase` once" shape `buildings`/`edicts` already use — so the
`UICatalog` the client receives has always been plain display strings; nothing downstream of that
projection changed. A curated ~10-key slice of `main.ts` UI-chrome strings (edict buttons, ledger
labels) converts through a SECOND table (`packages/app/src/locale/en.ts`) the same way, proving
one `Locale` class serves both content and hand-written presentation code.

**Tooling (`packages/tools/src/locale-*.ts`, `npm run locale:pack` / `locale:pseudo`):** a
translator-pack extractor (merges both English tables into a sorted key/english/context list) and
an en-XA pseudo-locale generator (accented + ~30% expansion, doc 10 §6) that carefully preserves
`{placeholder}`/plural syntax untouched — verified by unit test that a pseudo-localized template
still resolves correctly through the real `formatMessage`. `?locale=en-XA` on the running app
swaps BOTH tables end-to-end (verified in-browser: tutorial dialog and the Upgrade-tier button
both render the accented/expanded text with no overflow at this content length). A new
`no-restricted-syntax` ESLint rule bans raw `.textContent =`/`.innerText =` literals (2+ letters)
in `@crowns/ui` — that package turned out to already be clean (its one literal, `'×'`, is a glyph
the regex correctly ignores), so this is a guardrail against regression, not a fix for a violation.

**Honest gaps:** `main.ts`'s other ~250 literal strings aren't covered by any lint or locale table
— the curated slice proves the mechanism, it isn't a translation of the app. Mod-layer locale
merging (doc 09 §6) doesn't exist; only the base locale loads. `AIPersonalityDef.taunts`/
`voiceSet` stay flat strings (doc 06 §7) — still not rendered anywhere, so still not worth
converting. The CI en-XA screenshot step proves the pseudo-locale renders; it doesn't pixel-diff
against a committed baseline (no such tooling exists yet — a real open question, not silently
dropped).

**PWA shell (`packages/app/public/{manifest.webmanifest,icon.svg,sw.js}`):** hand-rolled, no
Workbox — the same zero-dependency-by-default posture as the JSON5 parser and combinator
validators. `sw.js` is cache-first over same-origin GETs with a versioned `CACHE_NAME` (a bump
swaps the whole cache atomically — "update = new SW + cache swap on next launch," doc 03 §9,
verbatim). Vite's `publicDir` was `false`; re-enabled pointing at `packages/app/public` so these
ship in `dist-web` unmodified. Verified in-browser: registers, takes control, and the shell (plus
every module the dev session actually requested) lands in the cache. A new CI job,
`pwa-offline-coldstart` (`.github/workflows/ci.yml`), is the real proof: build → serve → visit
online (populate the cache) → `context.setOffline(true)` → reload → assert the shell still
renders. Not keyed by content-manifest hashes yet (doc 10's asset pipeline — atlas packer,
transcode, manifest — hasn't landed; this is the pragmatic slice ahead of it).

**Quota UX (`packages/app/src/saveStore.ts`, doc 11 §3/§4, Risk R6):** `estimateStorage`/
`requestPersistence`/`isStorageTight`/`pruneAutosaveRing` implement the risk register's own
mitigation list verbatim — `persist()` requested once per session, quota checked at the same
cadence as the autosave scheduler (every season boundary), the R6 tripwire (quota <2×usage)
narrows the autosave ring from `AUTOSAVE_RING`(3) down to 1 and fires a ONE-SHOT
`storageAdvisory` protocol message the client turns into a toast pointing at the existing export
button (⇩) — never a second time per session, so it can't nag. Risk R6 is now marked "mitigated as
designed" in doc 13, not just "planned."

**Phase 6 gate (doc 12's global rule — benchmarks green, save corpus loads, AI harness green,
design-doc reconciliation, open questions due resolved):** `bench-ecs`/`bench-worldgen`/
`bench-haul` all comfortably inside doc 11 budgets (haul: 0.6 ms/tick average against a 10 ms
ceiling); save corpus and all 392 unit/system tests green; the AI harness ran clean as part of
that same suite; OQ-4 (the only open question due this phase) was already resolved at M39; docs
above are this milestone's reconciliation pass. **Phase 6 — Product is complete.**

### UI/UX pass 2 (M42)

The formal "legibility audit" doc 13's R10 pre-named this milestone for, run against the ACTUAL
gap between what the sim can do and what the player could see: a repo-wide grep found zero
tooltip mechanism (only sparse, mouse-only, unstyleable native `title=`), zero ARIA/focus
management anywhere, a 3-shortcut ad-hoc keybind surface with no legend, and — the real finding —
6 of ~10 implemented gameplay systems (military, diplomacy, siege, research, characters, events)
still have no player UI at all, only the M9 debug injector. This pass closes the tooltip/ledger/
keybind/accessibility gaps on the systems that already have panels (village/build/kingdom/mods —
exactly what the SC-1 "30-min competence" playtest exercises); it does NOT add new panels for
military/diplomacy/siege/research/characters/events — that's real, multi-milestone scope no
roadmap line past M42 currently claims, called out explicitly rather than silently skipped.

**Tooltips everywhere** (`packages/ui/src/tooltip.ts`, doc 01 §3 "legible depth... every number
inspectable via tooltips"): one delegated `TooltipController` — `mouseover`/`mouseout` AND
`focusin`/`focusout` listeners bound once on `document` — replaces native `title=` app-wide via a
`data-tooltip` attribute convention. Delegation means panels that `body.replaceChildren()` and
rebuild on every store change (`panels.ts`'s own standing doc comment) never need to re-wire
anything. Applied to: village tier/joy/food/goods rows, the tax-rate select (self-defeating-curve
warning), the upgrade button (live progress against `TIER2_REQUIREMENTS`, imported from
`@crowns/sim` so it can't drift from the real thresholds), every build-palette button (category,
footprint, tier — and WHY a locked one is locked), and every edict row (full modifier breakdown —
`CatalogEdict` gained a `modifiers` field so "no hidden modifiers" is literally true for edicts
now, not just asserted). Verifying this in-browser surfaced a real bug: a naive scroll-hide
listener fired when the browser auto-scrolled a newly-focused element into view, dismissing a
keyboard tooltip almost as soon as it appeared — fixed to reposition instead of hide.

**Ledgers everywhere**: `kingdom.rollup`'s daily roll-up system (`packages/sim/src/game/
kingdom.ts`) now attaches every `LedgerEntry` it records THAT rollup as a `ledger` delta on the
event — `KingdomLedger.entries()` already existed (M16) but nothing ever surfaced it. `UIStore`
gained a capped (`LEDGER_LOG_CAP` = 100, same bound `NotificationQueue`'s own log already uses)
scrollback buffer, rendered as a real itemized income/expense list in the Kingdom panel — GDD §2's
"Read the Ledger: full income/expense breakdown" literally, for the first time.

**Keybinds**: the 3 scattered, inconsistently-guarded `keydown` listeners this file had (one of
them — space/digit speed control — had NO text-entry guard at all, meaning typing digits into the
debug injector's JSON textarea also changed game speed) are now one `KEYBINDS` table + one
listener, which fixed that latent bug for free. New panel-toggle binds (`V`/`B`/`K`/`M`) and a
`?`-triggered help overlay (a genuine 5th `PanelHost` panel) double the table as its own
documentation — discoverability IS legibility (doc 01 §3). Space is explicitly NOT hijacked when
a `<button>`/`<select>` has focus, since that's its native activate/open key — global shortcuts
must yield to a focused control's own key handling, not fight it.

**Accessibility** (doc 05 §9 "accessibility hooks: full keyboard operability"): every icon-only
button gets a real `aria-label` (not just `title`, which many screen readers don't reliably expose
as the accessible name); toggle buttons (`speed`, `audio mute`, every panel) get `aria-pressed`;
every panel is a named `role="region"`; the toast host is `aria-live="polite"` with urgent toasts
individually `role="alert"` for assertive announcement; locked build buttons use `aria-disabled`
rather than native `disabled` — native `disabled` suppresses BOTH mouse and focus events in most
browsers, which would have made the "why is this locked" tooltip unreachable for the exact case
it matters most; `:focus-visible` styling makes keyboard focus visible for the first time anywhere
in the app. Full keyboard operability of the MAP itself (placing a building by keyboard, not
click) stays explicitly out of scope — the help overlay says so outright rather than pretending.

The T objective — **UX playtest vs. Vision SC-1** — can't recruit a human tester from here, so it's
proven the way this project's "playtest" T-objectives have been throughout: a real, hands-on
browser walkthrough of the early-game loop (found → build → tax → edict → ledger → keybind help),
checked for console errors and correct ARIA/focus/tooltip behavior at every step. SC-1's own
wording ("unaided (tutorialised)") acknowledges the tutorial itself is M43 — this pass is the UI
half of that bar, not the whole of it.

### Audio & music (M41)

The engine gains sound — a genuinely new subsystem: `@crowns/audio`, the ninth workspace package,
bound by the exact same "speaks only `@crowns/protocol`" boundary `render`/`ui` already live under
(`eslint.config.js`). Before this milestone the codebase had zero audio anywhere (not even a
scaffold — grep for `audio`/`music`/`sfx`/`cue` across 40 prior milestones turns up one doc-comment
anticipating it as a future Event Bus subscriber, `packages/protocol/src/events.ts`).

**Cue table & playlists are real content** (`packages/data/src/audio.ts`, doc 10 §3): `AudioCueDef`
(GameEvent type → a synthesized SFX blip) and `MusicPlaylistDef` (tension state, optionally
era/season-scoped, per doc 10's "playlist defs per era/season/tension state") join `TERRAIN_KINDS`
the same mechanical way every content-adding milestone since M32 has (new validator, new
`DefinitionDatabase` map, new integrity check, new `content/base/defs/` folder) — moddable for free,
doc 09's whole point. `gain` (normalized 0..1) is the **loudness-lint gate**: a v1 stand-in for doc
10's −16 LUFS build target, enforced at content load like every other numeric field AND by a
dedicated test (`packages/data/src/data.test.ts`) asserting the whole shipped roster — 9 cues, 3
playlists — sits inside the safe band, the roadmap's own "loudness lints" T objective by name.

**Tension state is pure and fully unit-tested** (`packages/audio/src/tension.ts`, doc 05 §8: "tension
from war/unrest events with hysteresis"): a single `heat` scalar rises on weighted war/unrest
GameEvents (`siege.begun`, `battle.resolved`, `diplomacy.warDeclared`, `village.starving`, …) and
decays linearly over elapsed ticks; `TensionState` (`calm`/`tense`/`combat`) only changes when heat
crosses a band's `enter` threshold going up or the SAME band's lower `exit` threshold going down —
the hysteresis margin doc 05 §8 asks for. Zero `AudioContext`, zero timers — the roadmap's "tension-
state transitions" T objective is 8 dedicated Node tests, including the flap-proofing case
(heat parked between a band's exit and enter thresholds must not bounce state) and a large-decay
case (must cascade through each intermediate band's own exit check, never skip straight to calm).

**Mixing & playback** (`packages/audio/src/{mixer,synth,audioDirector}.ts`, doc 05 §8): a real Web
Audio graph — three independently-volumed `GainNode` buses (music/worldSfx/uiSfx) under one master
mute gain. `synth.ts` is the placeholder generator doc 10 §3 asks for ("synthesised blips per cue
category ... generated bank") — but generated at RUNTIME rather than checked in as files, since no
binary asset pipeline exists yet for ANY content kind (not even sprites — doc 10 §1's own generator
is unbuilt); this keeps the "swap a placeholder for final art is a file swap, zero code change"
doctrine intact with zero binary assets and zero determinism risk (audio never touches sim state —
TDD §3). `AudioDirector.push(event)` is the audio-side mirror of `NotificationQueue.push` — wired
into `packages/app/src/main.ts`'s existing `ticked` event loop beside `notifications.push`, one line,
no new plumbing.

**Placeholder purge plan**: `node packages/tools/dist/audio-lint.js [--release]`
(`packages/tools/src/audio-lint.ts`) scans the merged content for `placeholder: true` cues/playlists
— warns in dev (today: all 12, honestly), fails in `--release` mode. This is the literal doc 10 §3
"build warns if TEMP_ assets remain at release profile" mechanism, ready to be M45's exit gate
("zero TEMP_/placeholder in release profile", doc 12) the moment real audio ships.

**Deliberately out of scope**: positional attenuation from camera distance (doc 05 §8) — every cue
plays at its authored gain regardless of distance, a real addition once world SFX cues exist in
numbers where it'd matter, not a rewrite. A real Asset Manager (doc 05 §12) stays unbuilt — nothing
needs one until real binary audio (or sprite) assets actually ship.

### Sandbox mode & editor (M40)

The toybox GDD §17 promises, built strictly on top of what's already in the live single-kingdom
demo — no new subsystem, no bypassed rulebook. **World-creation toggle:** since no "new game"
screen exists yet (the demo seed itself isn't player-chosen either), `?sandbox=1&ironman=1` on the
URL is today's world-creation surface (`packages/app/src/main.ts`), threaded through
`ToSimMessage.init`'s new `sandbox?: {ironman?}` field into `composeTerra`'s new `SandboxOptions`
param (`packages/app/src/terra.ts`) — a real, if minimal, front end for the flag; the mechanism
underneath doesn't care how it's set. **Privileged commands** (GDD §17: "kept in the input log →
still deterministic and save-compatible") are ordinary `kernel.registerCommand` entries gated by a
`sandboxEnabled` flag threaded into `registerVillageGameplay`/`registerKingdomGameplay` as a new
optional parameter (defaults `false` — every existing composition and test is untouched): `sandbox.
grantResource` (villages.ts, tops up a village's stockpile — the Stockpile object-component
mutation `reserveCost` already established), `sandbox.setTreasury` (kingdom.ts, writes `Kingdom.
treasury` directly via the existing `kingdomForIssuer` resolver), and `sandbox.editTerrain`
(terra.ts — the only module with `worldDef` in scope — a **land-only** biome repaint, Ocean/Coast
excluded in both directions so `worldDef.stats.landFraction` never needs touching; `biomeCounts`
bookkeeping updates in place, which the M8 `worldgen` hash source already reads live, so an edit
folds into replay hashes with zero new hash source). Off-sandbox, every `sandbox.*` command still
rejects by name through the same `village.rejected` convention every other domain uses — privilege
is enforced at the command handler, not just hidden in the UI (this codebase's long-standing "no
cheating, one rulebook" bar, same reasoning M11's placement validator states).

**Editor palette "reuses M9"** literally: no new panel. `simPort.ts`'s `debug op:'commands'`
handler now filters `sandbox.*` out of the injector's vocabulary entirely when the session isn't
sandboxed (a doomed-to-reject command shouldn't even be listed), and a small `🧪 SANDBOX EDITOR`
badge appears in the M9 debug panel when it is (`index.html`'s `#dbg-sandbox-badge`) — the entire
UI-effort footprint GDD §17's own "capped" instruction asks for. `sandbox.editTerrain` piggybacks
the renderer's existing M8 `ChunkTracker.invalidateTile` for the visual rebake — no new rendering
path.

**Save flagging** (doc 06 §13, finally real): `CampaignSaveHeader` gains `sandbox`/`ironman`
booleans, `SaveManager.setSandboxFlags`/`getSandboxFlags` mirroring M39's `modManifest` plumbing
exactly. `ironman` is recorded, not yet enforced — no mid-campaign difficulty-change command exists
to lock (doc 14 OQ-8's own M38 note already flagged this as unbuilt; M40 doesn't change that).

**Deliberately NOT wired this milestone** (none of it is named in the roadmap's M40 line, and each
would be real scope of its own): victory/defeat tracking (`game/victory.ts`, built M37, tested
standalone, still never composed into the live single-kingdom demo — GDD §17's "disables defeat
and (optionally) victory" stays aspirational until that composition gap closes, a PRE-EXISTING gap
this milestone didn't create and isn't chartered to fix); "spawn units" (Military isn't wired into
`composeTerra` either — no barracks in the demo); "trigger any event" (Events isn't wired in);
"possess an AI kingdom" (no second kingdom exists in a single-kingdom composition — meaningless
without M22's `kingdomCount > 1` AND a UI for it). "Spawn a building" needs no new command at all:
`sandbox.grantResource` then the ordinary `village.build` achieves it through the one
already-validated placement rulebook, deliberately not a second bypass path.

The T objective — **editor ops replay deterministically** — is proven the same way every other
milestone's determinism claim is: `packages/app/src/sandbox.test.ts` runs an identical sandboxed
session twice, submitting the same `sandbox.grantResource`/`sandbox.setTreasury`/`sandbox.
editTerrain` sequence, and asserts `kernel.stateHash()` matches exactly — plus coverage that the
vocabulary is hidden and every command rejects outside a sandboxed session in the first place.

### Modding v1 complete (M39) — Phase 6 begins: product

Modding closes the loop from "the base game is Mod Zero" (doc 09 §0) to a third party actually
being able to ship one. Three real gaps, all that was left after M10's loader/patch/override
pipeline: an in-game **Mods screen** (`packages/app/src/main.ts`'s 🧩 panel), **save↔mod
reconciliation** (OQ-4), and a **modding docs site** (`docs/modding/`) written for third-party
authors rather than engine contributors.

**Mods screen:** lists every mod bundled with the current build (base + `content/examples/*`),
lets the player check/uncheck and ↑/↓-reorder, and Apply recomposes the campaign at the same seed
(`ToSimMessage.setMods` → `composeTerra`'s new `ModSelection` param → `DefinitionDatabase.loadMods`)
— then renders the SAME `LoadReport` `mod-check.js` has always printed (order, disabled-with-
reasons, overrides-with-winner, patched-by) live in the panel. A real "installed mod library"
(IndexedDB import, File System Access folders) stays the doc 09 §8 Post-1.0 candidate it always
was — this milestone proves ordering/conflicts/reconciliation end-to-end against the mods actually
compiled into a build, which is the whole mechanism a library would sit on top of later.

**Save↔mod reconciliation (OQ-4 — ratified recommendation, shipped as written):**
`packages/data/src/mods.ts`'s `LoadReport` gained a `manifest: {modId, version, hash}[]` (hash =
`fnv1a32` over every enabled layer's sorted file contents — catches a rebalance that edits a def
without bumping `version`), embedded in every save's header
(`packages/sim/src/persistence.ts`'s `SaveManager.setModManifest`, doc 06 §13's `modManifest`
field, finally real). `reconcileModManifest` is a PURE comparison (missing / added / versionChanged
/ contentChanged) — best-effort, never a gate: `SaveManager.hydrate` doesn't consult it, doesn't
block. The ratified "hard-block only on missing def kinds or failed referential integrity" was
never a new mechanism to write — it's the pre-existing content-validation fatal path (doc 09 §3)
that already refuses a broken campaign, entirely independent of mod-set reconciliation. The
"automatic pre-load backup export": `simPort.ts`'s `loadFromPayload` downloads the untouched save
payload the instant reconciliation finds anything, before hydrate runs.

**Docs site (`docs/modding/`):** six documents (getting started, manifest reference, a full field
table per def kind, patches vs. overrides, load order & the Mods screen, validation &
troubleshooting) aimed at someone who has never opened this repo's engine source. Writing it
surfaced a real bug in the ORIGINAL design doc: doc 09 §6's own patch example (`cost.resources.
base:stone`) doesn't match the shipped `BuildingDef.cost` shape (a flat `Record`, doc 06 §2) — and
the patch op's dot-path navigation can't address a map key containing a `.`, which every content id
does. Doc 09 is corrected; the modding docs document the real limitation instead of the aspirational
example.

**The T objective — sample third-party mod built from docs alone:**
`content/examples/march-wardens/` was authored using ONLY `docs/modding/*` (no engine source
read while writing it) — a new building def (proving "add content" works) plus a patch to
`base:terrain.forest` that lands on the exact def `example:autumn-realm` already patches, on
purpose, with `loadAfter` declaring the ordering: `packages/data/src/mods.test.ts` proves both
mods' patches compose (`patched base:terrain.forest by example:autumn-realm, frontier:march-
wardens`) rather than one silently overwriting the other — real evidence the conflicts/ordering
system a third party actually depends on works, not just a loader unit test.

**Scripting (OQ-3), closed:** the formal ≥90%-expressiveness measurement M28 deferred to M32–M33
is done — all 10 def kinds, every content-breadth milestone through M38 (72 techs, 18 events
across all 6 pools, traits, 7 personalities), 100% JSON5/DSL, zero `scripts/` directory anywhere.
DSL-only is confirmed for 1.0; no scripting sandbox is built or planned pre-1.0 (doc 14 OQ-3).

### Difficulty system (M38) — Phase 5 complete: depth

AI capability and challenge are finally tunable (`packages/sim/src/ai/difficulty.ts`, GDD §14,
doc 07 §10): four presets — **Story, Fair, Hard, Brutal** — bundle doc 07 §10's table into
concrete values, mapped into EXISTING (mostly already-composable) options rather than new
subsystems. `appraisalNoise`/`periodMultiplier` are new, deterministic `ai/planner.ts` options
(jitter and re-eval-cadence multiplier, both neutral by default); knowledge decay reuses
`ai/brain.ts`'s `confidenceHalfLifeTicks` option, configurable since M19; scouting diligence is a
new `revealRadius` override; coordination is a new `jointWarCoordination` option on M35's
joint-war cascade (`off`/`limited` — vassals only, not voluntary allies — `on`); labelled
modifiers are a new per-kingdom `difficultyYieldOf` hook on the kingdom roll-up — deliberately a
KINGDOM-LEVEL tax/prosperity yield, not a raw `economy.ts` production one, since the shared,
single `StatModifiers` board (bound to kingdom 0 only since M22) can't express a per-kingdom
bonus. **Fair is the design-integrity benchmark**: both the AI's and the player's labelled yield
bonus are exactly 0 — genuinely cheat-free. "Manager quality tier" is the one doc 07 §10 row left
undocumented-into-code: `ai/needs.ts` only ever shipped 2 evaluators total (M20's own v1 slice),
so there's no smaller "basic" subset to switch a Story-tier AI to yet. The T objective —
**Fair-difficulty AI beats naive scripted baseline** — runs a Fair-preset AI kingdom (zero
bonus, full manager stack, aggression zeroed to isolate the economy comparison from an unrelated
self-destructive-war dynamic discovered while writing this test) against a kingdom governed by a
fixed, need-blind house-building script, over identical starting conditions: the AI kingdom
reliably outgrows it, robust across seeds — proving competence, not a numeric cheat, is the
actual advantage.

### Victory & defeat (M37)

Campaigns can now actually end (`packages/sim/src/game/victory.ts`, GDD §16, doc 08 §2 row 20): a
single daily `victory-tracker` system evaluates all five tracks — **Conquest** (control a village
share, or eliminate every rival), **Hegemony** (every surviving rival allied or vassal, sustained a
consecutive number of years — a broken pact resets the streak, no shortcut through a lapse),
**Legacy** (complete 3 distinct `wonder`-tagged monuments, `content/base/defs/buildings/
wonders.json5` — completable in any order, not a strict sequence despite GDD calling it a "chain",
a v1 simplification), **Prosperity** (sustained realm-wide happiness, same consecutive-streak
shape as Hegemony), and **Chronicle** (highest prestige — population + buildings + wonders + known
techs, nominal weights — among survivors at the year cap, doc 08 §1's 40-120 year target campaign
length). **Defeat** is the last-village rule (OQ-9): a kingdom that founded at least one village
and now owns none is out, and drops from every other kingdom's Hegemony/Conquest bookkeeping.
Crossing 80% of any enabled track's threshold broadcasts `victory.approaching` once — the
contestability signal GDD §16 asks for, though no AI archetype reacts to it yet (deliberately
deferred, "data/event now, AI consumption later," M35/M36's own precedent). `enabled:
VictoryType[]` and a separate `defeatEnabled` toggle are GDD §17's sandbox-mode knobs. The T
objective — **each victory achievable ≤ year cap** — is proven by engineering each condition
directly (reassigning village ownership, calling `DiplomacyState` directly, force-completing
wonders, forcing happiness) rather than waiting on an emergent AI economy to reach it: the same
"test the scoring function, not a chaotic multi-year simulation" lesson M36's blind fingerprint
test already learned. Building this surfaced a real, separate bug: three new wonder building ids
shifted every LATER building's alphabetically-sorted def code, silently corrupting the pinned
`terra-demo`/`terra-tick500-v1` fixtures — both intentionally re-recorded (`replay:record`,
`save-corpus record`) once the cause was confirmed, per TDD §13's own "re-recording must be
intentional, call it out" rule.

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
