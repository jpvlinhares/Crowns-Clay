# 09 — Modding Framework

**Principle: the base game is Mod Zero.** All content ships in the same format, loaded by the same
pipeline, subject to the same validation as third-party mods. If the base game needs a capability,
mods get it for free; if mods can't express something, neither can our designers — which is the
enforcement mechanism (Vision §4, TDD §3 hard rules).

## §1. Directory Structure

```
mymod/
├─ mod.json5                # manifest (required)
├─ defs/                    # content definitions (doc 06 *Def schemas)
│  ├─ buildings/*.json5
│  ├─ units/*.json5
│  ├─ resources/*.json5
│  ├─ techs/*.json5
│  ├─ events/*.json5
│  ├─ personalities/*.json5
│  ├─ edicts/ terrain/ seasons/ traits/ jobs/ castles/ victory/ ...
├─ patches/*.json5          # modifications to other mods' defs (§6)
├─ assets/
│  ├─ sprites/  audio/  music/  fonts/  icons/  ui-themes/
├─ locale/
│  ├─ en.json5  de.json5 ...
├─ scripts/                 # optional sandboxed hooks [OQ-3]
│  └─ hooks.js
└─ README.md
```

Manifest:

```json5
{ id: "aria:river-lords",         // namespace:name — namespace unique per author
  name: "River Lords", version: "1.2.0",
  gameVersion: ">=1.0 <2.0",      // semver range vs. game
  dependencies: [{ id: "aria:core-lib", version: "^2.0" }],
  loadAfter: ["base"], conflicts: ["x:total-war-overhaul"],
  tags: ["content","events"], description: "...", authors: [...] }
```

## §2. Supported File Formats

| Kind | Authoring | Runtime | Notes |
|---|---|---|---|
| Definitions/patches/locale | JSON5 (comments, trailing commas) | parsed to JSON | one schema family (doc 06) |
| Sprites | PNG (+ aseprite source optional) | atlased at load or pre-packed | doc 10 conventions |
| Audio | OGG (WAV accepted, transcoded warning) | decoded buffers | |
| Fonts | WOFF2/TTF | FontFace | |
| Scripts | JS (sandboxed) [OQ-3] | isolated runtime | capability-limited API |

## §3. Data Validation

- Every def kind has a published **JSON Schema** (generated from the same source as engine types —
  single source of truth, cannot drift).
- Validation at load: schema → referential integrity (all `Id<*Def>` resolve post-merge) → semantic
  lints (negative costs, recipe conservation sanity, unreachable techs, event triggers referencing
  unknown predicates).
- Errors are human-readable with file/line, and fall into: **fatal** (mod disabled, listed in the
  Mods screen with reasons) vs. **warning** (loaded, flagged). In dev mode the validation console
  live-reruns on file change (hot reload, TDD §12).

## §4. Predicates & Effects DSL

Event triggers/effects and requirement `custom` predicates use a small declarative expression form:

```json5
trigger: { all: [ {stat: "village.happiness", lt: 30},
                  {season: "winter"},
                  {not: {hasEdict: "base:grain-reserves"}} ] }
```

Vocabulary (comparators, stat paths, tag queries, counts, random-weight) is engine-defined,
documented, and versioned. This covers ~90% of desired mod logic without scripts; the scripted hook
layer [OQ-3] exists for the rest and is deliberately capability-limited (read-only queries + command
emission — the same rights as a player; no engine internals, no DOM, no network).

**M33 delta (packages/data/src/events.ts, game/events.ts):** ships exactly this vocabulary —
`all`/`any`/`not`, `season`, `hasEdict`, `hasTech`, `chance` (random-weight), and `stat` with five
comparators (`lt`/`lte`/`gt`/`gte`/`eq`) over a small CLOSED set of stat paths (`STAT_PATHS`) —
not open-ended reflection over arbitrary game state, so a typo'd path is a load-time validation
error (doc 09 §3's fatal-def-problem principle), never a silent always-false predicate at
runtime. `evaluatePredicate`/`applyEffect` (game/events.ts) additionally fail CLOSED on anything
structurally malformed that slips past validation (predicates false, effects no-op, never throw)
— fuzz-tested directly (roadmap M33's "DSL fuzzing" T objective) rather than only exercised
through real content. Tag queries and counts stay unimplemented — no content this milestone
needs them, and the vocabulary is additive (doc 09 §8) so they can land later without a rewrite.

## §5. Mod Loading & Dependency Resolution

1. Discover installed mods (imported into IndexedDB library; folder import via File System Access).
2. Resolve enablement set: check `gameVersion`, `dependencies`, `conflicts`.
3. Order: topological sort by dependencies, then explicit `loadAfter`, then user drag-order for
   remaining ties; cycles are fatal with a clear report.
4. Merge layers in order into the immutable **Definition Database** (Engine §13).
5. Validate merged result (§3) → transfer to sim worker at campaign start.

Per-save mod sets: the active set is embedded in every save (doc 06 §12) and re-imposed on load.

## §6. Override & Patch Rules

- **New id** → added. **Same id as an earlier layer** → *replace* by default.
- **Patch documents** modify without replacing (surgical, survives upstream updates):

```json5
{ patch: "base:building.granary",
  ops: [ { set: "cost.resources.base:stone", value: 40 },
         { mergeAppend: "tags", value: ["riverlords:food-hub"] },
         { remove: "serviceAura" } ] }
```

- Deterministic outcome: later layer wins; the Mods screen conflict report lists every id touched by
  ≥2 mods with final winner, so users can reorder informedly.
- Assets & locale keys follow the same layered id resolution (Engine §12).

## §7. Version Compatibility

- Game↔mod: manifest semver ranges gate loading (hard block on major mismatch, warn on untested
  minor).
- Def schemas are versioned with the same migration philosophy as saves: schema migrations can
  upgrade old-format defs at load where mechanical, else fatal-with-message.
- Save↔mod reconciliation on load (changed/missing mods) produces a report; policy details are
  **[OQ-4]** (recommended default in doc 14).

## §8. Future Extensibility

Reserved from day one so 1.x can grow without breaking format: manifest `capabilities` field
(mods declare needs; engine declines gracefully), `defs/` is namespaced-by-kind so new def kinds are
additive, DSL vocabulary is versioned, and worldgen stage tables (scatter, site scoring, biome maps)
are already def-driven — total-conversion worldgen becomes a data exercise. Post-1.0 candidates:
in-game mod browser/sharing, script API v2, custom UI panels via declarative layout defs.
