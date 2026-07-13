# 01 — Getting Started

## Directory layout

```
mymod/
├─ mod.json5              # manifest — required, see doc 02
├─ defs/                  # your content, one folder per kind (doc 03)
│  ├─ buildings/*.json5
│  ├─ resources/*.json5
│  ├─ terrain/*.json5
│  ├─ edicts/*.json5
│  ├─ units/*.json5
│  ├─ techs/*.json5
│  ├─ events/*.json5
│  ├─ traits/*.json5
│  ├─ personalities/*.json5
│  └─ overlays/*.json5
└─ patches/*.json5        # surgical edits to OTHER mods' defs (doc 04)
```

You don't need every folder — a mod that only patches base-game colors needs nothing but
`mod.json5` and a `patches/` file. A mod that adds a new building needs `mod.json5` and one file
under `defs/buildings/`.

Each `defs/<kind>/*.json5` file holds a JSON5 **array** of defs of that kind — not a single object,
even if you're only adding one:

```json5
// defs/buildings/my-building.json5
[
  { "id": "mymod:building.watchtower", /* ...fields, see doc 03... */ },
]
```

File names inside a kind folder are yours to choose (`my-building.json5`, `wave-1.json5`,
whatever) — the loader reads every `.json5` file under the folder, so split content however keeps
your repo organized.

## Your first mod

A minimal, complete, loadable mod — a new resource nobody else defines:

```json5
// mod.json5
{
  "id": "example:tinker",
  "name": "Tinker's Trinkets",
  "version": "1.0.0",
  "gameVersion": ">=0.1 <1.0",
  "authors": ["you"],
}
```

```json5
// defs/resources/trinkets.json5
[
  {
    "id": "example:resource.trinket",
    "name": "Trinket",
    "tier": "finished",
    "category": "luxury",
    "basePrice": 12,
    "weight": 0.5,
  },
]
```

That's a real, loadable mod: an id, a manifest, one new def. Nothing references it yet (no building
produces it), which is fine — mods can add content in any order across releases.

## Validating locally

Before shipping, run your mod through the same validator the game uses, from a checkout of the
engine repo:

```bash
node packages/tools/dist/mod-check.js --with-examples
```

`--with-examples` layers every mod under `content/examples/` (including yours, if you drop your mod
folder there) on top of the base game and prints:

- the resolved load order,
- any mod that got disabled and exactly why,
- every def id touched by more than one layer, and who won,
- every def a patch touched, and which mod patched it.

If nothing's printed but `OK · layers: ...`, your content is valid. If it's invalid, you get a
file-and-line error (doc 06) — never a silent skip.

`--watch` re-runs on every save under `content/` — the fast loop for iterating on a mod without
restarting the game.

## Loading in-game

Once installed, your mod appears in the **Mods screen** (🧩 toolbar icon): check it on, order it
relative to other installed mods if it matters (doc 05), and hit Apply. The campaign restarts at
the same seed with your content merged in.
