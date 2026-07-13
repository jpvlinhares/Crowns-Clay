# 05 — Load Order & Conflicts

## How order is decided

1. **Enablement** — every mod is checked against `gameVersion`, `dependencies`, and `conflicts`
   (doc 02). This runs to a fixpoint: disabling one mod can cascade (a mod depending on a
   just-disabled mod is disabled too), until nothing more changes.
2. **Order** — among the mods left enabled, `base` always leads. After that: dependency edges
   first (a dependency always loads before its dependent), then `loadAfter` edges, then whatever
   order the player set in the Mods screen for anything left tied. A dependency cycle disables
   every mod in the cycle, naming the chain.
3. **Merge** — layers apply in that resolved order. Same `id` in a later layer replaces the
   earlier one (doc 04); patches then apply in the same order, on top of the merged result.
4. **Validate** — the WHOLE merged result is checked (doc 06) before anything reaches a campaign.

Nothing here is influenced by file names, folder scan order, or which mod happened to install
first — only by the manifest fields above and the player's explicit ordering choice.

## The in-game Mods screen

🧩 in the toolbar opens the Mods screen. It lists every mod bundled with the current build, each
with:

- a checkbox — enable/disable,
- ↑ / ↓ — reorder relative to other enabled mods (this only matters for mods without a
  `dependencies`/`loadAfter` edge between them — those are always honored first, per above),
- an **Apply** button — recomposes the campaign at the same seed with your selection, and reports
  back the resolved load order plus the full conflicts report described below.

Applying restarts the campaign's content (not its terrain — worldgen is seed-derived and doesn't
depend on mods) with the new def set. This is deliberate: a building that no longer exists, or
whose recipe just changed shape, can't be safely reconciled into an in-progress campaign's live
entities — starting fresh with the new content is the only version that's fully correct.

## Reading the conflicts report

Every load (in-game or via `mod-check.js`, doc 01) produces:

- **order** — the final layer sequence, `base` first.
- **disabled** — any mod that didn't make it, and the exact reason (bad game-version range, a
  missing/mismatched dependency, an active conflict, or a cycle).
- **overrides** — every def `id` provided by ≥2 layers, the layers that provided it in order, and
  which one won (always the last).
- **patched** — every def `id` any patch touched, and which mod(s) patched it.

This is how you find out, before shipping, whether your mod steps on someone else's content (or
someone else's on yours) — and exactly who wins if it does.

## Designing to avoid unwanted conflicts

- Namespace every id you author (doc 02) — accidental id collisions between two unrelated mods are
  the most common source of a surprise override.
- Reach for a **patch** over an **override** whenever you can (doc 04) — patches only touch the
  fields you name, so two mods patching different fields of the same def compose cleanly; two
  mods overriding the same def can't both win.
- If your mod is DESIGNED to sit on top of another (a reskin, a rebalance, a compatibility patch),
  declare `loadAfter` explicitly rather than relying on the player to order you correctly.
