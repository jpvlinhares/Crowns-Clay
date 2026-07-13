# 04 — Patches & Overrides

Two ways to change a def that isn't yours, and they behave very differently.

## Override: same id in `defs/`

If your mod ships a def under `defs/<kind>/` whose `id` already exists in an earlier-loaded layer,
your version **completely replaces** it — every field, not just the ones you wrote. This is
simplest when you're genuinely reskinning something (a total-conversion terrain palette, a
from-scratch rebalance of one building) but it's brittle: if the base game later adds a field to
that def kind, your override doesn't have it, and if the base def's OTHER fields change in a
balance patch, your override silently keeps the old values forever.

```json5
// defs/terrain/marsh.json5 — full replacement, every field re-specified
[
  {
    "id": "base:terrain.marsh",
    "name": "Peat Bog",
    "biomeCode": 9,
    "colors": { "base": "#6a5a3a", "accent": "#5f5234" },
    "movementCost": 2.5,
    "buildableTags": [],
    "defenseBonus": 0.15,
    "tags": ["wetland", "example:peat"],
  },
]
```

## Patch: `patches/*.json5`

A patch names a target id and a short list of surgical operations — it never replaces the def, so
it automatically tracks every field you didn't touch across future base-game updates.

```json5
// patches/my-patch.json5
[
  {
    "patch": "base:building.granary",
    "ops": [
      { "set": "buildTicks", "value": 96 },
      { "mergeAppend": "tags", "value": ["mymod:food-hub"] },
      { "remove": "serviceAura" },
    ],
  },
]
```

Three ops:

| Op | Effect |
|---|---|
| `{ "set": "<dot.path>", "value": <anything> }` | writes `value` at that path, creating intermediate objects as needed |
| `{ "mergeAppend": "<dot.path>", "value": <item or array> }` | appends to the array at that path (errors if it isn't one) |
| `{ "remove": "<dot.path>" }` | deletes the key at that path |

`<dot.path>` walks the def's own JSON structure the same way `colors.base` reaches
`{colors: {base: ...}}` above. **Caveat:** the path splits on every `.`, so it can't address a
`Record` key that itself contains a `.` — and content ids do (`base:resource.stone`). That rules
out patching a single entry inside `cost`/`recipes` maps by key; if you need to change what
something costs, override the def instead (previous section).

**Patches apply in mod load order, after every layer's own `defs/` have been merged** — so a patch
can target ANY def from ANY earlier-loaded mod (including one that was itself already patched by a
mod loaded before yours). A patch whose target doesn't exist in any loaded layer is a fatal error
naming the missing target — it never silently no-ops.

## Which one should I use?

- **Patch** by default. It's smaller, it's obviously scoped to what you actually changed, and it
  keeps working when the thing you patched gets new fields later.
- **Override** only when you're genuinely replacing the whole thing — a different piece of art at
  the same terrain slot, a building redesigned from the ground up — where tracking upstream field
  additions wouldn't even make sense.

## Determinism

Whichever mechanism, the outcome is fully deterministic from the resolved load order (doc 05):
later layer always wins a same-id conflict, patches always apply in layer order after all
`defs/` merges. Nothing here depends on file names, folder scan order, or anything else you don't
control from `mod.json5`.
