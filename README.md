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
| M18 — UI pass 1 + HUD (panel framework, player panels, build palette, notifications) | ✅ this commit — **no fixture changes** (presentation is hash-inert) · **Phase 2 complete: playable economy sandbox** |
| M19 — AI kernel & sensors (brain scheduling, knowledge model, fog of information) | next — Phase 3 begins |

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
Chancellor discounts edict upkeep; Marshal and Scholar hold their seats for M25/M32. Advisors draw
2 gold/day, age yearly, and die — vacating the office by event, with the books still balanced.

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
