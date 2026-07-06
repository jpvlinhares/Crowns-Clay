# 13 — Risk Assessment

Scored **Likelihood × Impact** (H/M/L). Each risk names its owner-mechanism in the design and its
early-warning tripwire.

## R1 — AI complexity (L: H · I: H) — *the* project risk

Fully simulated, non-cheating, personality-rich AI is the hardest deliverable; failure modes:
incompetent AI (dies alone), illegible AI (feels random), or budget-devouring AI.
**Mitigations:** utility architecture chosen for tunability & explainability (doc 07 §1); decision
logs + "why?" inspector from day one; AI harness with behavioural fingerprints built *early* (M24)
so every later system lands on a regression net; capability tiers mean the competence bar is Fair,
not Brutal; template-based castle/settlement planning avoids open-ended solvers (doc 07 §5).
**Tripwire:** harness survival/growth stats trending down two nights running blocks feature merges.

## R2 — Simulation performance at scale (L: M · I: H)

2,000 units + 60 villages + 8 brains in JavaScript.
**Mitigations:** worker isolation (TDD §1); SoA/typed arrays and cohort math (Engine §2, GDD §4);
staggered cadences (doc 08 §2); per-system budgets with telemetry and CI benchmark gates (doc 11 §6);
WASM escape hatch pre-designed behind module boundaries (doc 04 §3).
**Tripwire:** any benchmark scene >10% regression fails CI; budget breach for 2 nights opens a
mandatory perf task.

## R3 — Rendering performance (L: M · I: M)

Large maps + thousands of sprites on integrated GPUs.
**Mitigations:** chunk-baked terrain, static batching, culling, LOD/ambient-marker tiers (TDD §7);
HTML UI keeps text off the GPU path; render benchmarks in nightly (doc 11).
**Tripwire:** <45 fps in any benchmark scene on P1.

## R4 — Pathfinding cost (L: H · I: M)

Haulers + armies over 512² maps can dominate ticks.
**Mitigations:** hierarchical HPA* with chunk graph; route caches & flow fields for recurring
village routes; time-sliced resumable searches with a hard 20% budget; road network deliberately
concentrates traffic onto cacheable corridors (a *design* mitigation).
**Tripwire:** pathfinding budget share alarms on debug HUD/nightly telemetry.

## R5 — Save-file growth & migration burden (L: M · I: M)

Decades-long campaigns accrete state; schema churn breaks old saves.
**Mitigations:** defs referenced not copied (doc 06); bounded histories (memory top-K, event-log
retention caps); per-component versioned codecs + migration chain + permanent save corpus in CI
(TDD §8, §13); 15 MB target tracked in benchmarks.
**Tripwire:** corpus load failure or save-size trend breaching target.

## R6 — Browser storage limits & eviction (L: M · I: H for the affected player)

Quota ceilings; Safari eviction of "unused" origin data can delete saves.
**Mitigations:** `navigator.storage.persist()`; quota monitoring with early warnings; autosave ring
pruning; aggressive, friendly **export-to-file UX** (single-file saves, doc 06 §12) surfaced at
season autosaves and ironman; docs set expectation that file export is the durable copy.
**Tripwire:** quota estimate <2× current footprint triggers in-game advisory.

## R7 — Determinism drift across browsers/updates (L: M · I: H)

Float behaviour or engine updates could de-sync replays/saves-integrity checks.
**Mitigations:** determinism contract & bans (TDD §5); cross-engine golden replays in CI (Chrome,
Firefox, Node) from M5; fixed-point fallback pre-scoped for hot math **[OQ-10]**; command-log tail
in saves detects corruption on load rather than mid-campaign.
**Tripwire:** cross-engine hash mismatch in CI.

## R8 — Scope creep in a systems-rich design (L: H · I: H)

Every system invites depth; the GDD is already large.
**Mitigations:** design freeze with change-control (doc 00); explicit non-goals (Vision §9);
roadmap phase gates with reconciliation reviews; "Mod Zero" pushes content ambitions into data
where they're cheap; Open-Questions process prevents silent scope decisions (doc 14).
**Tripwire:** milestone slipping >25% or DEBT-tag count rising across a phase (doc 12).

## R9 — Modding sandbox security & stability (L: M · I: M)

Scripted mods executing in players' browsers.
**Mitigations:** declarative DSL covers most needs without code (doc 09 §4); scripts (if adopted,
[OQ-3]) run capability-limited in an isolated runtime with no DOM/network and player-equivalent
rights only; validation & crash-isolation (a throwing hook disables its mod, not the game).
**Tripwire:** decision checkpoint at M28; DSL coverage stats from Mod Zero authoring.

## R10 — UI complexity for a deep sim (L: M · I: M)

Grand-strategy UIs sink teams; illegible UI voids the "legibility" pillar.
**Mitigations:** HTML/CSS UI for iteration speed and i18n (TDD §7); panel framework early (M18) and
a dedicated second pass with a formal legibility audit (M42); inspector-first development means
every datum already has a surface before bespoke UI exists.
**Tripwire:** UX playtest failures against Vision SC-1.
