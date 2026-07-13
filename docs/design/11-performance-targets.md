# 11 — Performance Targets

**Reference hardware profiles** (benchmarks run on both, nightly — TDD §13):

- **P1 “Mid-2020 laptop”** (primary gate): 4-core mobile CPU, integrated GPU, 8 GB RAM,
  Chrome & Firefox current.
- **P2 “Comfort desktop”**: 8-core, discrete GPU, 16 GB — must have generous headroom.

## §1. Scale Ceilings (design-supported maxima, Large map)

| Metric | Target | Stress test |
|---|---|---|
| AI kingdoms | **8** | 12 must degrade gracefully (slower AI cadence), not crash |
| Villages (world total) | **60** | 80 |
| Concurrent units (soldiers in Unit stacks) | **2,000** | 3,000 |
| Rendered dynamic sprites on screen | 1,500 | 2,500 (LOD markers beyond) |
| Map size (Large) | 512×512 tiles | 768×768 |
| Named characters | 400 | 600 |
| Active haul jobs | 1,200 | 2,000 |

**M47 verification status** (roadmap "stress ceilings" line): AI kingdoms (12, `bench-balance.js
--kingdoms 12`) and active haul jobs (2,000, `bench-haul.js 100 20`) both run clean, well inside
the sim-tick budget (§2). Map size (768×768, new `stress` `MapSize`, `bench-worldgen.js`)
generates in 535 ms — no crash, no budget concern. **Not independently stress-tested this
milestone:** villages (80), concurrent units (3,000), named characters (600) — each needs either
a purpose-built large-scale scenario (no `bench-war-max`/`bench-ai-8k`/`bench-late-campaign` tool
named below exists yet either) or many decades of organic AI play to reach naturally; the M47
crash-triage campaigns (100 seeds × 25 years, 4 kingdoms) exercise real but moderate counts of
all three, not their stress ceilings specifically. Flagged as a real gap, not silently assumed
fine.

## §2. Frame Rate & Simulation Throughput (on P1)

| Metric | Target |
|---|---|
| Render frame rate | 60 fps sustained; never <45 fps in benchmark scenes |
| Sim rate @8× (80 tps) | maintained at scale ceilings; time-dilation onset only beyond stress levels |
| Sim tick budget (worker) | ≤ 10 ms mean @8× ceilings; AI share ≤ 30%, pathfinding ≤ 20% of budget |
| Input→visible response | ≤ 100 ms for orders; ≤ 16 ms for camera |
| Battle with 40 units + castle | ≥ 55 fps, sim budget held |

## §3. Memory

| Metric | Target (P1) |
|---|---|
| Total JS heap (both threads) | ≤ 512 MB steady state, Large map |
| GPU textures (atlases) | ≤ 256 MB |
| Save file size, year-50 Large campaign | ≤ 15 MB compressed |
| IndexedDB footprint (slots + autosaves + assets cache) | warn ≥ 400 MB, managed ring |

## §4. Timings

| Metric | Target |
|---|---|
| World generation (Large) | ≤ 10 s with progress UI (Medium ≤ 5 s) |
| Save (autosave, background) | ≤ 2 s total, ≤ 50 ms max main/sim stall |
| Load (Large, year-50) | ≤ 5 s to interactive |
| Cold start (cached PWA) → main menu | ≤ 3 s; first-ever visit ≤ 15 s on 10 Mbps |
| Mod validation (base + 5 mods) | ≤ 2 s |

## §5. How the Architecture Supports These Targets

| Target area | Load-bearing decisions |
|---|---|
| 60 fps under sim load | sim isolated in worker (TDD §1); render interpolation decouples fps from tps (TDD §6) |
| 2,000 units / 60 villages | SoA ECS typed arrays (Engine §2); cohort population math instead of per-villager agents (GDD §4); staggered cadences so daily systems amortise (doc 08 §2) |
| AI ≤ 30% budget @8 kingdoms | time-sliced resumable planners, staggered think days, cached evaluations (doc 07 §11) |
| Pathfinding ≤ 20% | hierarchical HPA* + route/flow-field caches (TDD §10, Risk R4) |
| Render scale | chunk-baked terrain, static batching, culling, sprite LOD (TDD §7) |
| Save/load & stalls | between-tick sliced serialisation + native CompressionStream (TDD §8) |
| Worldgen ≤ 10 s | staged pure pipeline, typed-array tile ops, progress streaming (Engine §6) |
| Memory ceilings | interned ids, defs referenced not copied (doc 06), LRU asset budgets (Engine §12) |

## §6. Enforcement

- Benchmark scenes are **saves in the test corpus** (deterministic — TDD §5): `bench-econ-max`,
  `bench-war-max`, `bench-ai-8k`, `bench-late-campaign`. Nightly CI fails on >10% regression vs.
  rolling baseline; per-system tick-cost telemetry on the debug HUD keeps costs visible daily.
  **M47.9 delta — made true, with two honest divergences from the sentence above:**
  `bench-war-max`/`bench-ai-8k`/`bench-late-campaign` exist now
  (`packages/tools/src/bench-scenes.ts`) and run as a CI job (`benchmarks`, ci.yml) on every PR,
  gating on §2's ABSOLUTE sim budgets (mean tick ≤10 ms, AI share ≤30%) over the unified
  campaign composition. Divergences: (1) they are deterministic composed scenes, not corpus
  saves, and the gate is absolute-budget, not regression-vs-rolling-baseline (no baseline store
  exists — a 1.x improvement, not silently claimed); (2) `bench-econ-max` remains unbuilt, and
  war-max fields the armies the real AI raises under its own recruit gates, not §1's
  2,000-unit stress ceiling (§1's M47 note already flags that gap).
- Every roadmap phase gate (doc 12) includes “targets §2–§4 green at current content scale”; scale
  ceilings themselves are phased in (they are meaningless before content exists).
- Budget governance: any system exceeding its share for 2 consecutive nightly runs opens a
  mandatory perf task before new features land in that system.
