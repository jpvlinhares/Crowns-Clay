# 06 — Validation & Troubleshooting

## Two failure classes

| | Scope of failure | Example | Where you see it |
|---|---|---|---|
| **Mod-level** | Just your mod is disabled; everyone else's content still loads | bad `gameVersion` range, missing dependency, active conflict, dependency cycle | Mods screen, next to your mod's entry; `mod-check.js`'s `DISABLED` lines |
| **Content-level** | The WHOLE campaign refuses to start | a def fails its field schema, an id reference doesn't resolve, a DAG/integrity rule breaks | a fatal error naming the file, path, and problem |

Content-level errors are fatal on purpose (doc 09 §3): once your def is accepted into the merged
database, every other def and every system trusts it's internally consistent. A campaign never
half-loads with one broken building silently missing.

## Reading a content-level error

Errors are file-and-path precise:

```
defs/buildings/watchtower.json5 [0].footprint.w: expected a number ≤ 8, got 12
defs/buildings/watchtower.json5 [0].terrainTags: expected at least 1 item(s)
```

The `[0]` is the def's index within that file's array (files hold arrays, doc 01) — the FIRST def
in the file, in this case. The path after it (`footprint.w`) walks straight into the field table
in doc 03.

Referential-integrity errors look slightly different, since they're checked after every kind
merges, not per-file:

```
mymod:building.watchtower: military.recruits references unknown unit 'mymod:unit.longbowman'
```

— you defined the building but not the unit it wants to train, or the unit's id doesn't match.

## Reading a patch error

```
mymod:patches/rebalance.json5 (patch 'base:building.granary') op[1]: mergeAppend target 'tags' is not an array
```

Patch errors name the patch file, the target def, and which operation (by index) failed — see
doc 04 for the three op kinds and the dot-path caveat around ids containing `.`.

## The local validation loop

```bash
node packages/tools/dist/mod-check.js --with-examples
node packages/tools/dist/mod-check.js --with-examples --watch   # revalidate on every save
```

This is the SAME pipeline the game runs, reading straight from disk (no build step for content —
only for engine changes). Get a clean `OK · layers: ...` here before you ever load your mod
in-browser.

## Common mistakes

- **Forgot the array wrapper.** Every `defs/<kind>/*.json5` file is an array, even for one def:
  `[{ ... }]`, not `{ ... }`.
- **Unnamespaced id.** `id: "watchtower"` instead of `id: "mymod:building.watchtower"` — always
  `yournamespace:kind.name`.
- **Referencing an id that doesn't exist yet.** If your def references another mod's content
  (`base:resource.stone` in a `cost` map, a unit id in `military.recruits`), that referenced id
  has to resolve in the FINAL merged database — check the spelling against doc 03's examples and
  the real base-game content under `content/base/defs/`.
- **A patch targeting nothing.** `"patch": "base:building.grannary"` (typo) — the patch's target
  must already exist in some loaded layer BEFORE patches apply; there's no "create if missing".
- **Missing biome/overlay coverage.** If you're overriding terrain, you replace ONE `biomeCode`'s
  def — you can't add an eleventh, and every one of the 10 codes still needs exactly one def after
  all mods merge, so a mod that mis-sets `biomeCode` breaks someone else's coverage, not just its
  own def.
