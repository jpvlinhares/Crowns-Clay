# Crowns & Clay — Modding Docs

This is the reference for THIRD-PARTY mod authors. It doesn't assume you've read the engine's
internal design docs (`docs/design/`) or its source — everything you need to build, validate, and
ship a mod is here.

**The base game is Mod Zero.** Every building, resource, tech, event, and terrain type you see in a
default campaign is loaded through the exact same pipeline your mod will go through, from the exact
same file formats. If the base game can do something, your mod can too.

## Document Index

| # | Document | Read this for |
|---|---|---|
| 01 | [Getting Started](01-getting-started.md) | Directory layout, your first mod, validating it |
| 02 | [Manifest Reference](02-manifest.md) | Every `mod.json5` field, versioning, dependencies |
| 03 | [Content Reference](03-content-reference.md) | Every def kind you can add: fields, types, examples |
| 04 | [Patches & Overrides](04-patches-and-overrides.md) | Editing someone else's def without replacing it |
| 05 | [Load Order & Conflicts](05-load-order-and-conflicts.md) | How mods stack, the in-game Mods screen, reading a conflict report |
| 06 | [Validation & Troubleshooting](06-validation-and-troubleshooting.md) | Reading error messages, the `mod-check` console |

## The five-minute version

1. A mod is a folder with a `mod.json5` manifest and, usually, a `defs/` directory of `.json5` files.
2. Every def has a globally-unique `id` in `namespace:kind.name` form (yours, not `base:`).
3. New `id` → added to the game. Reused `id` from an earlier-loaded mod → your version **replaces**
   it entirely. Want to tweak one field instead of replacing the whole def? Use a **patch**
   (doc 04) — it survives the base game changing everything else about that def later.
4. Everything is validated at load time. A broken file disables just your mod, with a
   file-and-line error — it can never half-load into someone's campaign.
5. Players enable, order, and inspect conflicts for installed mods from the in-game **Mods
   screen** (🧩 in the toolbar) — see doc 05.

## Conventions used in these docs

- `defs/kind/anything.json5` — a path pattern; the filename after the kind folder doesn't matter,
  only the folder and extension.
- Every JSON5 example is exactly what you'd write on disk — comments and trailing commas included,
  since that's what the JSON5 parser accepts.
- Fields marked *optional* may be omitted entirely; everything else is required.
