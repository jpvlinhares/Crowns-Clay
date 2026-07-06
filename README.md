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
| M12 — Population & needs v1 (cohorts, jobs solver, labor-gated construction, famine floor) | ✅ this commit — **Phase 1 complete: the first playable loop** · terra fixture re-recorded (settlers added) |
| M13 — Production chains (3-tier resources, recipes, spoilage) | next — Phase 2 begins |

## Layout (TDD §3)

```
packages/
  core       pure utilities: seeded PRNG, interning, hashing, math   (deps: none)
  data       schemas, validators, content types                      (core)
  sim        kernel, ECS, systems, AI — HEADLESS, no DOM             (core, data, protocol)
  protocol   command & snapshot message types                        (core, data)
  render     WebGL renderer                                          (core, protocol)
  ui         HTML views/HUD                                          (core, protocol)
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
on completion). All 8 building defs and 3 resources live in `content/base/defs/`; placement runs
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
