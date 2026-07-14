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
- **Initial camera framing:** on every full snapshot (new game or load) the camera opens centred on
  the PLAYER's own starting village, not the geometric map centre. The sim reports the player
  kingdom's home tile (`snapshotFull.kingdom.home`, from the kingdom-index-0 village centre — the
  same "player is kingdom 0" convention the fog/territory emitters use); `Camera2D.centerOn` /
  `PixiRenderer.centerOnTile` apply it. Fallback chain: home → building-footprint centroid → map
  centre, so single-village and building-only compositions still frame sensibly.

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
  the Command Bus only. Panel taxonomy: HUD (clock/notifications), Inspector (any entity),
  Ledgers, Diplomacy table, Research tree, Army orders, Build palettes, Event dialogs, Menus.
- **Interfaces:** `pick()` from renderer for world selection; localisation service for all strings
  (doc 10 §6); input focus arbitration with the Input Mapper (typing ≠ hotkeys).
- **Panel host (`@crowns/ui` `PanelHost`):** all on-demand windows dock on the **right** and obey a
  **single-open invariant** — opening one (toolbar glyph, hotkey, or a selection that reveals a panel)
  closes whichever was showing, so a side never stacks. Every panel — Village, Building inspector,
  Kingdom, Joy/capacity (future) — registers here rather than being bespoke, inheriting the dock and
  single-open for free. **Kingdom resources are NOT always-on:** treasury/net/ledger live in the
  on-demand **Kingdom** panel (👑), fed from the `kingdom.rollup` event, not the top bar.
- **Re-render focus guard:** panel bodies are rebuilt wholesale on every store change (which fires per
  snapshot delta). A rebuild must not clobber an *editable* control the player is mid-interaction with
  — replacing a live `<select>` snaps its open dropdown shut (the "tax selector closes the instant it
  opens" defect, which only survived while paused because pausing halts the deltas). The village/kingdom
  renders skip while an editable control (`SELECT`/`INPUT`/`TEXTAREA`) inside the panel holds focus;
  the next delta after it blurs redraws with fresh data. Focused *buttons* still re-render (they want
  the fresh state and suffer no clobber).
- **HUD stat layout:** the top bar is a fixed-column stat grid (fps · tick · date · folk) where each
  value sits in a reserved, right-aligned, tabular-numeral slot, so a changing count never reflows its
  neighbours. Per-village vitals render as one bordered fixed-column chip per village on their own
  full-width row (built via DOM, not string concat), keeping numbers legibly in place — the "grids,
  text doesn't move even with different counts" requirement.
- **Building inspector + demolish:** clicking a building opens the Building panel (name · category ·
  footprint · construction %). **Capacity gauges (M-era):** any completed building carrying capacity
  shows a used/total bar sourced from live state — housing → village occupants / Σ housing (bar turns
  amber when occupants exceed shelter), storage → each stocked good's amount / the per-resource
  stockpile cap (`BASE_STORAGE + Σ storage.capacity`), plus the building's own contribution. The
  numbers are projected straight from the def (`storage.capacity`/`housing.capacity` onto `BuildingRec`,
  and village totals onto `villageStats`), so modded capacity-bearing buildings surface it for free —
  no new capacity data is invented, only what the sim already tracks is surfaced. The panel also
  offers a two-click-confirm **🧹 Demolish** that issues the
  `village.demolish` command (the same command a besieger's breach uses). Village-centre buildings
  are disabled up-front (the sim also refuses them, surfacing `village.rejected` as a toast); a
  successful raze emits `building.demolished`, which the notification table shows and the building
  emitter streams as a removal so the sprite disappears. No refund — matches `village.build`'s
  trust-the-issuer model (there is no adversarial client in this single-player design).
- **Building footprint preview:** arming a def in the Build panel enters placement mode; a cursor-
  following **outline** (per-tile grid + bolder boundary, no fill so terrain shows through — no ghost
  sprite) marks exactly the tiles the footprint will occupy, sized straight from the def's
  `footprint` (any size, any modded def, zero per-building code). Validity is authoritative: the
  client sends a read-only `previewBuild {seq, villageId, def, x, y}` probe when the hovered tile
  changes, the worker answers `buildPreview {seq, x, y, w, h, ok}` by running the sim's single
  `VillageOps.validatePlacement` rulebook (terrain tags, rivers, occupancy, village radius, tier —
  and any future rule), and the outline recolours **green (valid) / red (invalid)**. A monotonic
  `seq` discards replies the cursor has already moved past; drawing happens immediately on move
  (real-time position) while the verdict colour follows within a frame. Renderer surface:
  `PixiRenderer.show/hideFootprintPreview` over a topmost outline-only layer.
- **Continuous building mode:** arming a def stays armed after every placement attempt (success OR
  failure), RTS-style, so the player drops copy after copy without re-picking from the palette; the
  footprint preview keeps following the cursor and re-validating throughout. Placement mode exits
  only on an explicit cancel: **Esc**, **right-click** (a `contextmenu` handler that also suppresses
  the browser menu), re-selecting/picking a different building in the palette, or arming another
  tool (an army order clears the armed build). Only the primary mouse button places — right/middle
  never do.
- **Dismissible notifications:** every toast carries a **× close button** (`NotificationQueue.dismiss(id)`)
  that removes it from the on-screen `visible()` set immediately while leaving the scrollback `all()`
  history intact; automatic roll-off (VISIBLE_CAP) is unchanged. Applies to every severity tier, not
  just build refusals.

**M43 delta:** **Event dialogs** are real — `packages/app/index.html`'s `#event-dialog-backdrop`,
a modal fed by `event.fired`/a `pendingEvents` recovery field, first built to carry the tutorial
(roadmap M43) but generic from the start: any pool's event uses the identical dialog, verified
live in-browser with a real (non-tutorial) `opportunity` event. **Ledgers** and **Build palettes**
were already real (M16/M18); **Diplomacy table**, **Research tree**, and **Army orders** remain
unbuilt — those systems are still debug-injector-only, a named gap neither M42 nor M43 closed and
no later roadmap milestone currently claims (doc 13 R10's own M42 delta already flagged this).

## §8. Audio Subsystem (main thread)

- Event-driven: GameEvents map to SFX cues through a data-defined cue table (mod-replaceable);
  music director selects era/season/tension-state playlists (tension from war/unrest events with
  hysteresis). Positional attenuation for world SFX from camera distance. Web Audio graph: music /
  world SFX / UI SFX buses with independent volume.

**M41 delta:** real now, `@crowns/audio` (roadmap M41). The cue table and playlists are genuine
new `@crowns/data` content kinds (`AudioCueDef`/`MusicPlaylistDef`, doc 09's "data, hence
moddable" promise), projected to the presentation side as a protocol `AudioCatalog` — the exact
`UICatalog` pattern M18 established, so `@crowns/audio` never imports `@crowns/data` directly.
Tension is a pure `heat` scalar (war/unrest GameEvent weights, linear decay) crossing separate
up/down thresholds per band — the hysteresis this section asks for, fully unit-tested without any
`AudioContext`. Positional attenuation is NOT built this milestone — every cue/playlist plays at
its authored gain regardless of camera distance; a real addition later, not a rewrite, once world
SFX cues actually exist in numbers where it'd matter.

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
