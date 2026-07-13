# 02 — Manifest Reference

Every mod has exactly one `mod.json5` at its root. A missing or malformed manifest disables the
mod entirely (it can't be identified, so it can't be reported against anyone else's content either).

```json5
{
  "id": "aria:river-lords",
  "name": "River Lords",
  "version": "1.2.0",
  "gameVersion": ">=0.1 <1.0",
  "dependencies": [{ "id": "aria:core-lib", "version": "^1.0" }],
  "loadAfter": ["base"],
  "conflicts": ["someone:total-war-overhaul"],
  "tags": ["content", "events"],
  "authors": ["Aria"],
}
```

| Field | Type | Required | Meaning |
|---|---|---|---|
| `id` | string | yes | `namespace:name` — pick a namespace unique to you (your handle, studio name, …); every def you ship must be prefixed `yournamespace:`. |
| `name` | string | yes | Display name shown in the Mods screen. |
| `version` | string | yes | Semver (`major.minor.patch`, e.g. `"1.2.0"`; `"1.2"` is read as `"1.2.0"`). Bump it when you change your mod's content in a way another mod's `dependencies` range should notice. |
| `gameVersion` | string | yes | Semver *range* against the engine's own version (e.g. `">=0.1 <1.0"`). If it doesn't satisfy, your mod is disabled with a clear reason — never silently loaded against an incompatible engine. |
| `dependencies` | `{id, version}[]` | no | Other mods yours needs, and the semver range of their `version` you require. A missing, disabled, or version-mismatched dependency disables your mod too, with the exact reason named. |
| `loadAfter` | `string[]` | no | Mod ids your content should merge on top of, WITHOUT a hard dependency (your mod still loads if the named one is absent — this is ordering only, not a requirement). Use this to make sure your override/patch wins against a specific mod. |
| `conflicts` | `string[]` | no | Mod ids that can't be enabled alongside yours — if one is present and enabled, yours is disabled with a named reason (and vice versa isn't implied; conflicts are one-directional per manifest, so declare it on whichever side knows about the incompatibility). |
| `tags` | `string[]` | no | Freeform, shown in the Mods screen (`"content"`, `"cosmetic"`, `"total-conversion"`, …). |
| `authors` | `string[]` | no | Display credit. |

## Semver ranges

`gameVersion` and `dependencies[].version` use the same small range syntax:

- `"1.2.3"` — exact.
- `">=1.0"`, `"<2.0"`, `">=1.0 <2.0"` — comparators, space-separated (all must hold).
- `"^1.2.0"` — compatible-with (same major version, `>=1.2.0 <2.0.0`).
- `"~1.2.0"` — same major.minor (`>=1.2.0 <1.3.0`).

## Choosing your namespace and ids

Every def you ship needs an id in `yournamespace:kind.name` form — `mymod:building.watchtower`,
`mymod:resource.trinket`. The namespace is whatever you put before the colon in your manifest's
`id` (everything before the first `:`), and IT MUST be unique to you — the engine doesn't enforce
global uniqueness across every mod ever published, so pick something distinctive (a handle,
studio name) rather than something generic like `mod1`.

## What happens when your mod fails to load

Two different failure classes, and they behave differently (doc 06 has the full troubleshooting
guide):

- **Your manifest, or another mod's enablement chain, has a problem** (bad `gameVersion`, missing
  dependency, a conflict, a cycle) → YOUR MOD is disabled. Everyone else's content still loads.
  The Mods screen names the reason next to your mod.
- **Your content is malformed after merging** (a def fails its schema, references an id that
  doesn't exist, breaks a DAG/integrity rule) → the WHOLE campaign refuses to start. This is
  deliberate (doc 09 §3's "a broken content set must never half-load"): once your def is accepted
  as part of the merged database, it has to be valid, full stop.
