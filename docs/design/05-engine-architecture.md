# 05 — Engine Architecture

High-level design of each subsystem and how they communicate. Thread placement and boundary rules
are defined in TDD §1–§4; this document details the internals and the contracts between them.

## §0. Communication Fabric (read first)

Three channels, and only these three:

| Channel | Direction | Carries | Used by |
|---|---|---|---|
| **Command Bus** | inward (→ sim) | `Command{tick, issuer, type, payload, seq}` | player UI, AI kernel, event effects, sandbox editor, replays |
| **Event Bus** | outward + intra-sim | `GameEvent{type, tick, subjects, data}` | all sim systems publish; sim systems, AI sensors, UI, audio subscribe |
| **Snapshot Stream** | outward (sim → main) | full snapshot + per-tick deltas | renderer, UI bindings |

Rules: sim systems never call each other directly for effects — they mutate their own components
and publish events; cross-system *reads* go through typed ECS queries. This keeps coupling
inspectable and makes every interaction loggable/replayable.

```
            ┌────────────── SIM WORKER ──────────────┐
 UI ─cmd─►  │ CommandBus ─► System Pipeline ─► ECS   │
 AI ─cmd─►  │        ▲            │ publish          │ ─deltas─► Renderer
 Events─►   │        │        EventBus ──────────────┼─events──► UI / Audio / AI sensors
            └────────┴──────────(subscribe)──────────┘
```

## §1. Rendering Subsystem (main thread)

- **Scene model:** layered (terrain chunks / static batches / dynamic sprites / overlays), detailed
  in TDD §7. Owns a **Presentation ECS** — a lightweight mirror populated from snapshot deltas with
  interpolation state; never authoritative.
- **Interfaces:** consumes Snapshot Stream; subscribes to GameEvents for one-shot VFX; exposes
  `pick(screenXY) → entityRef` to the UI; reads camera state from Input.
- **Extensibility:** all drawables resolve sprites via Asset Manager logical ids → mod-replaceable.

## §2. Simulation Subsystem (worker)

- **Kernel:** fixed-tick scheduler (TDD §6) executing an ordered **System Pipeline** (order table in
  doc 08 §2). Each system declares reads/writes (component sets) — declared access is enforced in
  dev builds to catch hidden coupling.
- **ECS store:** archetype-lite Structure-of-Arrays: components in typed arrays keyed by dense
  entity indices; string-free hot paths (ids are interned ints). Queries are precompiled bitset
  filters. **Why SoA:** cache-coherent iteration for cohort/hauling math; compact snapshot deltas.
- **Interfaces:** Command Bus in; Event Bus + Snapshot out; Persistence hooks (serialise/hydrate per
  component codec).

## §3. AI Subsystem (worker)

- Layered brains per AI kingdom (full design doc 07): Sensors (subscribe to Event Bus + fog-filtered
  queries) → Strategic Planner → Domain Managers → command emission via the same Command Bus as the
  player.
- **Scheduling:** time-sliced by the kernel with a per-tick budget; planners are resumable
  coroutine-style jobs (state machines) so a think can span many ticks deterministically (budget
  slicing is tick-count based, not wall-clock — determinism, TDD §5).
- **Interfaces:** *no privileged state access* — AI reads through the same query API filtered by its
  knowledge model (doc 07 §6).

## §4. Combat Subsystem (worker)

- **Resolver:** consumes an `Engagement` (armies + site + castle defence graph) and runs combat
  sub-ticks inside the owning sim tick; emits casualty/morale mutations and battle GameEvents.
  Manual-battle player orders arrive as commands targeted at the engagement.
- Field battles and sieges share one resolver with different site graphs (open-field graph vs.
  castle defence graph — GDD §7/§8), guaranteeing auto-resolve parity because there is only one
  implementation.
- **Interfaces:** Military components in; events out; deterministic PRNG fork per engagement.

## §5. Economy Subsystem (worker)

- Three cooperating systems: **Production** (building recipes × workforce), **Logistics** (hauler
  job board + route cache over the path service), **Markets** (price drift, trade caravans).
- Stockpiles are components on villages; conservation invariants asserted per economic update
  (property tests, TDD §13).
- **Interfaces:** consumes Population workforce data and Terrain modifiers via queries; publishes
  shortage/surplus events consumed by AI economy manager, event system, and UI ledgers.

## §6. World Generation Subsystem (worker, transient)

- Pure pipeline `seed + params → WorldDef` (stages in GDD §13) executed once at campaign start in
  the sim worker with progress events streamed to the loading UI. No live-game responsibilities;
  output hydrates the ECS then the generator is released.
- Each stage independently seeded → stages are unit-testable and mod-replaceable (mods may override
  scatter tables and site-scoring weights — doc 09).

## §7. UI Subsystem (main thread, HTML)

- Reactive views bound to a **UI Store** fed by snapshot deltas and GameEvents; issues commands via
  the Command Bus only. Panel taxonomy: HUD (clock/resources/notifications), Inspector (any entity),
  Ledgers, Diplomacy table, Research tree, Army orders, Build palettes, Event dialogs, Menus.
- **Interfaces:** `pick()` from renderer for world selection; localisation service for all strings
  (doc 10 §6); input focus arbitration with the Input Mapper (typing ≠ hotkeys).

## §8. Audio Subsystem (main thread)

- Event-driven: GameEvents map to SFX cues through a data-defined cue table (mod-replaceable);
  music director selects era/season/tension-state playlists (tension from war/unrest events with
  hysteresis). Positional attenuation for world SFX from camera distance. Web Audio graph: music /
  world SFX / UI SFX buses with independent volume.

## §9. Input Subsystem (main thread)

- Raw events → **semantic actions** (`camera.pan`, `order.move`, `ui.confirm`) through a rebindable
  keymap (data file, hence moddable); context stack (world / battle / menu / text-entry) resolves
  ambiguity. Emits either camera/presentation intents (handled on main) or gameplay commands
  (forwarded to sim). Accessibility hooks: full keyboard operability, remap UI.

## §10. Saving Subsystem (worker)

- Per TDD §8: component codecs + migration chain + compression + IndexedDB/file export. Exposes
  `save(slot)`, `load(slot)`, `export()`, `import(file)`, and an autosave scheduler subscribed to
  season-change events. Publishes progress events for UI.

## §11. Event System (worker) — content events

- Distinct from the low-level Event Bus: this is the *content* engine for GDD Appendix A. Holds
  trigger predicates compiled from data defs, evaluates pools on its cadence (doc 08 §10), applies
  effects **by emitting commands/modifiers**, and raises choice dialogs to the UI (player) or the
  AI decision layer (AI kingdoms answer event choices via utility scoring — doc 07 §4).

## §12. Resource (Asset) Manager (main thread)

- Resolves logical asset ids through the mod layer chain → concrete URLs → loads via fetch/decode →
  caches (atlas textures, audio buffers, fonts) with LRU budget. Provides preload manifests per
  scene (menu/world/battle) and hot-swap in dev mode. Service-worker cache keys come from the
  content manifest hashes (TDD §11).

## §13. Modding Framework (loader on main, definitions consumed in worker)

- Loads mod layers → validates → merges into the **Definition Database** (immutable, id-keyed)
  which is transferred to the sim worker at campaign start and referenced by all systems. Scripted
  hooks (if adopted, [OQ-3]) execute inside the worker in a sandbox with a capability-limited API
  (read queries + command emission only — same rights as a player). Full design: doc 09.

## §14. Cross-Subsystem Scenario Trace (worked example)

*"Player orders an army to besiege an AI castle":*

1. Input: right-click on castle → semantic `order.siege` → Command Bus.
2. Sim tick N: Military system validates, sets army path (path service), publishes `ArmyMarching`.
3. AI sensors (defender) receive event (fog-checked) → Strategic planner re-scores threats →
   Military manager issues garrison/relief commands via Command Bus.
4. Armies meet: Movement system creates `Engagement`; Combat resolver runs siege phases across
   ticks; bombardment mutates the castle defence graph; events stream out.
5. UI shows battle panel (snapshot deltas + events); audio director raises tension state.
6. Resolution: casualties applied, captives created, `SiegeEnded` event → Diplomacy opinions shift,
   Event system may fire aftermath content, Chronicle records the entry, autosave on next season.

One feature, every subsystem, only the three sanctioned channels.
