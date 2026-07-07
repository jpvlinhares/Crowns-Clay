# 03 — Technical Design Document (TDD)

Stack assumed: TypeScript / WebGL-2D / Web Workers / IndexedDB — evaluated and justified in doc 04.
This document defines architecture independent of library choices wherever possible.

---

## §1. Overall Architecture

**Style: deterministic simulation core + thin presentation shell, communicating by messages.**

```
┌─────────────────────────── Browser ────────────────────────────┐
│                                                                │
│  MAIN THREAD (Presentation)          SIM WORKER (Authority)    │
│  ┌──────────────────────────┐        ┌──────────────────────┐  │
│  │ UI Layer (views, HUD)    │        │ Simulation Kernel    │  │
│  │ Renderer (WebGL scene)   │ cmds ─►│  ├ Tick Scheduler    │  │
│  │ Input Mapper             │◄─ snap │  ├ System Pipeline   │  │
│  │ Audio Engine             │  shots │  ├ ECS World State   │  │
│  │ Presentation State       │        │  ├ AI Kernel         │  │
│  └──────────────────────────┘        │  └ Command Log       │  │
│        ▲            ▲                └──────────┬───────────┘  │
│        │            │                           │              │
│  ┌─────┴─────┐ ┌────┴──────┐          ┌────────▼───────────┐   │
│  │ Asset Mgr │ │ Mod Loader│          │ Persistence (IDB)  │   │
│  └───────────┘ └───────────┘          └────────────────────┘   │
└────────────────────────────────────────────────────────────────┘
```

**Why:**
- **Sim in a Worker** keeps 60 fps rendering immune to simulation spikes (AI thinking, economy
  updates) and vice versa — the single most important browser-specific decision (Risk R2).
- **Message boundary = determinism boundary.** Only commands enter the sim; only snapshots/events
  leave. Nothing in the presentation layer can mutate authoritative state, which makes determinism
  (§5), save integrity, and future multiplayer structurally enforced rather than disciplined.
- **Kernel is headless.** The sim compiles and runs under Node/CI without a browser → fast automated
  testing (§13) and reproducible benchmarks.

## §2. Major Engine Subsystems

(Design detail per subsystem in doc 05.)

| Subsystem | Thread | Responsibility |
|---|---|---|
| Simulation Kernel | worker | tick loop, system ordering, world state |
| ECS Store | worker | entity/component storage & queries |
| AI Kernel | worker | strategic/tactical AI with time-sliced budget |
| Combat Resolver | worker | battle & siege resolution |
| Economy Engine | worker | production, hauling, markets |
| World Generator | worker (temp) | seed → world pipeline |
| Event System | worker | triggers, pools, scheduling |
| Persistence | worker | snapshot, migrate, save/load |
| Renderer | main | WebGL scene graph, tilemap, sprites, effects |
| UI Layer | main | HTML/reactive views, HUD, menus |
| Input Mapper | main | raw input → semantic commands |
| Audio Engine | main | music/SFX playback, mixing |
| Asset Manager | main | load/cache/atlas textures, audio, fonts |
| Mod Loader | main→worker | read, validate, merge content layers |
| Platform Services | main | storage quota, file import/export, PWA |

## §3. Module Boundaries

Enforced by package structure and lint rules (dependency direction is checked in CI):

```
@game/core        pure utilities, math, PRNG, ids        (depends on: nothing)
@game/data        schemas, validators, content types      (core)
@game/sim         kernel, ECS, systems, AI, combat        (core, data)   ← NO DOM/WebGL imports
@game/protocol    command & snapshot message types        (core, data)
@game/render      renderer, camera, effects               (core, protocol)
@game/ui          views, HUD, menus                       (core, protocol)
@game/app         composition root, worker wiring         (all)
@game/tools       dev/debug/asset/mod tooling             (all)
```

**Hard rules:** `sim` never imports `render`/`ui`/DOM APIs; `render`/`ui` never import `sim`
internals — both sides speak only `protocol`. Content values (numbers, names, effects) live only in
`data`-validated definition files, never in code (the "Mod Zero" rule).

## §4. Data Flow

```
 Input event ─► Input Mapper ─► Command{type, payload, issuer}
      └─ validated (UI-side sanity) ─► postMessage ─► SIM: enqueue
 Tick N: kernel drains queue ─► validates (authoritative) ─► appends to CommandLog
        ─► systems execute in fixed order (doc 08 §2) ─► state mutations
        ─► DirtyTracker collects changes ─► Snapshot Delta + GameEvents ─► main
 Main: Presentation State applies delta ─► Renderer interpolates ─► UI binds views
```

- **Commands** are the *only* write path (player, AI, events, sandbox editor, and replay all use it).
- **Snapshots** are read-only projections: a full snapshot on load, then per-tick deltas
  (interest-managed: off-screen regions ship at reduced cadence — supports doc 11 targets).
- **GameEvents** (battle-started, treaty-broken…) drive notifications, audio stingers, and the UI
  event feed without the UI polling state.

## §5. Determinism Contract

The simulation is a pure function: `state' = tick(state, commands)`. Rules (binding for all sim
code, checked by tests §13):

1. Single seeded PRNG service, forked per-system by stable keys; `Math.random` banned in `sim`.
2. No wall-clock reads, no floating iteration over unordered maps; all collections iterate in
   stable (id-sorted or insertion) order.
3. Floating-point policy: sim math uses f64 with no fused/vectorised fast-math shortcuts; identical
   code path on all platforms (single JS engine class makes this tractable) **[OQ-10: integer
   fixed-point fallback if cross-browser drift observed]**.
4. Commands are timestamped by tick and sequence-numbered; ties resolved by (tick, issuer, seq).
5. The command log + seed replays to a bit-identical state hash (per-tick FNV state hash in dev).

**Payoff:** golden-replay regression tests, save-integrity verification, bug repro by log file, and
a preserved option for lockstep multiplayer post-1.0.

## §6. Game Loop

**Simulation (worker):** fixed timestep. Base rate 10 ticks/sec at speed 1×; speeds multiply ticks
executed per real second (8× ⇒ 80 tps) with a per-frame execution budget — if the budget is
exceeded, sim time dilates (slows) rather than dropping ticks, preserving determinism.

**Presentation (main):** `requestAnimationFrame` at display rate; entity positions interpolate
between the last two received sim states; UI updates are event-driven, not per-frame.

```
worker loop:                        main loop (rAF):
  accumulate real dt                  apply pending snapshot deltas
  while (acc ≥ tickDt && budget):     interpolate transforms (α)
      drainCommands()                 render scene
      runSystemPipeline()             flush UI bindings
      emitDeltas()
```

**Why fixed timestep:** determinism (§5), stable balance math (rates are per-tick), and simple
speed scaling. **Why time dilation over tick-dropping:** dropped ticks would silently change
outcomes between fast and slow machines.

## §7. Rendering Pipeline

Layered 2D over a chunked tile world:

1. **Terrain layer:** map divided into 32×32-tile chunks baked to cached textures; only dirty chunks
   re-bake (terrain rarely changes) → near-zero steady-state terrain cost.
2. **Static objects:** buildings/resources as static sprite batches per chunk, rebuilt on change.
3. **Dynamic sprites:** units/villagers/effects in per-texture-atlas batches, y-sorted, frustum-
   culled by chunk; population beyond an LOD threshold renders as ambient "activity" markers rather
   than individuals (supports doc 11 unit counts).
4. **Overlay layer:** territory borders, routes, range auras (vector/instanced primitives).
5. **UI:** HTML/CSS composited above canvas (crisp text, accessibility, rapid iteration) — not
   drawn in WebGL. **Why:** browser text/layout beats any in-engine UI for dev speed and i18n.

Camera: pan/zoom with integer-snapped rendering at 100% zoom to keep pixel art crisp; zoom LOD
switches sprite detail tiers (doc 10).

## §8. Save/Load Architecture

```
World State ─► Serializer (per-component codecs, schema-versioned)
            ─► Snapshot {header, modManifest, stateBlobs, cmdLogTail}
            ─► CompressionStream(gzip) ─► IndexedDB (chunked blobs)
                                        └► File export (.crown single file)
Load: header → version check → MigrationChain(v_old→…→v_now) → validate vs. active mods
      → reconciliation report if mods differ → hydrate ECS → resume
```

- **Versioned codecs:** every component schema carries a version; migrations are pure functions
  registered in an ordered chain; CI keeps a corpus of historical saves that must always load (§13).
  *(M17 delta: versions live per SECTION — kernel/world/roads — with per-section MigrationChains;
  per-component versions ride inside the world section. Compression/chunked blobs deferred until
  save sizes demand them; the quota strategy lands with PWA polish, M44.)*
- **Autosave without stall:** serialization runs in the sim worker between ticks, sliced across
  frames; compression via native `CompressionStream`. Target: doc 11 (§ save/load).
- **Quota strategy:** monitor `navigator.storage.estimate()`; warn, prune autosave ring, and prompt
  file export before quota pressure (Risk R6). `persist()` requested to resist eviction.

## §9. Networking Considerations (offline title)

1.0 is offline; architecture keeps doors open at negligible cost:
- Command-stream determinism (§5) is exactly the lockstep-multiplayer substrate.
- `protocol` messages are serialisable and transport-agnostic (postMessage today, socket someday).
- No gameplay code may assume a local user (`issuer` field on every command).
- PWA service worker handles offline asset caching and version updates (update = new SW + cache
  swap on next launch; saves are never stored in caches).
- Explicitly deferred: netcode, matchmaking, server authority, cheating concerns.

## §10. Performance & Memory Management

Principles (targets in doc 11):
- **Budgeted systems:** every sim system reports per-tick cost; AI and pathfinding are time-sliced
  with hard per-tick budgets and resumable jobs.
- **Data-oriented hot paths:** cohort economics, hauling, and pathfinding operate on typed-array
  component stores (Struct-of-Arrays ECS, doc 05 §13); GC pressure minimised via object pools for
  per-tick scratch and message buffers (transferables across the worker boundary).
- **Hierarchical pathfinding:** chunk-graph HPA* for long routes + local A*; flow-field caching for
  common village routes (Risk R4).
- **Memory ceilings:** texture atlas budget, snapshot ring size, and event-log retention all capped
  with LRU eviction; per-subsystem memory reported on the debug HUD.

## §11. Asset Pipeline (technical hooks)

(Authoring workflow in doc 10.) Build-time tools pack sprites into atlases with generated metadata,
transcode audio, subset fonts, and emit a **content manifest** (hashes → cache keys for the service
worker). Runtime Asset Manager resolves logical ids (`sprite:building/granary@2`) through the mod
layer chain, so mods replace assets by id without engine changes.

## §12. Build System

- **Tooling:** Vite (dev server + HMR for UI/render, worker bundling), TypeScript strict mode,
  ESLint (+dependency-boundary rules §3), Prettier.
- **Pipelines (CI):** typecheck → lint → unit tests → sim headless tests (golden replays, save
  corpus) → asset build → bundle → benchmark scene (fail on regression >10% vs. baseline) →
  deployable static bundle + PWA manifest.
- **Dev ergonomics:** hot-reload for content defs (mod loader watch mode) so designers tune numbers
  without rebuilds; debug HUD & console (tick cost graphs, entity inspector, command injector) built
  early (roadmap M9) and reused as the sandbox editor (GDD §17).

## §13. Logging & Testing Strategy

**Logging:** ring-buffer structured logger in both threads (level-filtered, category-tagged);
crash/assert dumps bundle log tail + seed + command log tail into an exportable diagnostic file
(opt-in, local only). Sim assertions compile out of release builds except invariant guards.

**Testing pyramid:**

| Layer | What | Gate |
|---|---|---|
| Unit | core math, PRNG, codecs, utility scoring | per-PR |
| System | each sim system vs. fixture worlds (economy conservation, pop growth curves) | per-PR |
| Property | invariants under random command fuzz (no negative stockpiles; opinion bounds; conservation of population) | per-PR |
| Golden replay | seeded campaigns replayed to expected state hash per tick | per-PR |
| Save corpus | every historical save version loads & resumes | per-PR |
| AI harness | headless AI-vs-AI campaigns at high speed; assert survival/growth/balance stats | nightly |
| Benchmark | doc 11 scenes on reference profiles | nightly |
| Playtest builds | tagged milestone builds + feedback template | per milestone |

**Why headless-first:** the worker-isolated kernel (§1) makes >90% of gameplay logic testable
without a browser — this is the load-bearing quality decision of the whole project.
