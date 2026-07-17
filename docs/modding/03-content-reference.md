# 03 — Content Reference

Eleven def kinds exist today. Each lives under its own `defs/<folder>/` path and has its own schema,
enforced at load. This doc gives the full field table for the two kinds most mods start with
(**terrain** and **building** — everything else follows the exact same shape/error conventions),
then a complete but terser field table for the rest.

There's no separate machine-readable schema file yet (a published JSON Schema per kind is a known
gap — tracked for a later pass, see doc 06's note); the tables below ARE the schema, kept in sync
with the engine's own validators by hand. If a field here and the game ever disagree, trust the
game's error message and file an issue — these tables are the intended contract.

Every kind shares two rules: `id` must be `namespace:kind.name`-shaped and globally unique after
merging (a repeat `id` REPLACES the earlier one — see doc 04), and unknown/misspelled fields are
rejected at load, not silently ignored.

## Terrain (`defs/terrain/*.json5`)

Ten biome codes exist (0–9) and EVERY code must be covered by exactly one terrain def after all
mods merge — this is why terrain is usually **overridden** (doc 04), not added fresh: you're
almost always reskinning an existing biome, not inventing an eleventh.

| Field | Type | Notes |
|---|---|---|
| `id` | string | e.g. `base:terrain.marsh` |
| `name` | string | |
| `biomeCode` | integer 0–9 | which of the 10 fixed biome slots this def fills |
| `colors.base` | `"#rrggbb"` | |
| `colors.accent` | `"#rrggbb"` | |
| `movementCost` | number 0–10 | multiplies army/hauler travel time over this terrain |
| `buildableTags` | string[] | tags a building's `terrainTags` (below) must intersect to place here |
| `defenseBonus` | number 0–1 | |
| `tags` | string[] | |

```json5
[
  {
    "id": "base:terrain.marsh",
    "name": "Peat Bog",
    "biomeCode": 9,
    "colors": { "base": "#6a5a3a", "accent": "#5f5234" },
    "movementCost": 2.5,
    "buildableTags": [],
    "defenseBonus": 0.15,
    "tags": ["wetland"],
  },
]
```

## Overlays (`defs/overlays/*.json5`)

Exactly two overlay kinds exist — `river` and `lake` — each must be covered by exactly one def.

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `kind` | `"river"` \| `"lake"` | |
| `color` | `"#rrggbb"` | |

## Resources (`defs/resources/*.json5`)

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `name` | string | |
| `tier` | `"raw"` \| `"processed"` \| `"finished"` | production-chain position |
| `category` | `"food"` \| `"material"` \| `"military"` \| `"luxury"` | |
| `basePrice` | number ≥ 0 | |
| `weight` | number ≥ 0 | hauling cost per unit |
| `decay` | number 0–1, *optional* | fraction lost per day (spoilage — food resources usually set this) |

## Buildings (`defs/buildings/*.json5`)

The biggest def kind, but every block below is optional except the first six — add only the
blocks your building actually needs.

| Field | Type | Notes |
|---|---|---|
| `id` | string | required |
| `name` | string | required |
| `category` | `"civic"` \| `"housing"` \| `"service"` \| `"storage"` \| `"production"` \| `"military"` \| `"castle"` | required |
| `footprint` | `{w, h}`, integers 1–8 | required |
| `cost` | `{ "resourceId": amount, ... }` | required — amounts are integers ≥ 1, keys must be real resource ids |
| `buildTicks` | integer ≥ 1 | required — construction duration |
| `terrainTags` | string[], ≥ 1 entry | required — must intersect a tile's terrain `buildableTags` to place there |
| `requires.villageTier` | integer 1–4 | *optional* — minimum village tier to build |
| `housing.capacity` | integer ≥ 1 | *optional* |
| `housing.comfort` | number ≥ 0 | *optional* |
| `serviceAura.need` | string | *optional* — which happiness-need this building lifts |
| `serviceAura.strength` | number ≥ 0 | |
| `serviceAura.radius` | integer ≥ 1 | tiles |
| `storage.capacity` | integer ≥ 1 | *optional* |
| `recipes` | `{inputs: Yield[], outputs: Yield[]}[]`, ≥ 1 entry | *optional* — see Recipes below |
| `workers.required` | integer ≥ 1 | *optional* |
| `military.recruits` | string[] (unit ids), ≥ 1 | *optional* — which units this building can train |
| `military.garrisonCap` | integer ≥ 1 | *optional* — defenders it can shelter without training them |
| `defense.hp` | integer ≥ 1 | *optional* — makes this a castle segment (doc 09's enclosure algorithm reads it) |
| `defense.armor` | number ≥ 0 | |
| `defense.kind` | `"wall"` \| `"gate"` \| `"tower"` \| `"keep"` | |
| `defense.rangedArc` | `{range, damage}`, *optional sub-field* | |
| `research.pointsPerDay` | number ≥ 0 | *optional* |
| `tags` | string[] | required (may be empty `[]`) |

A `Yield` (used in `recipes`) is `{ "resource": "<resource id>", "perDay": <number ≥ 0> }`.

```json5
[
  {
    "id": "mymod:building.watchtower",
    "name": "Watchtower",
    "category": "military",
    "footprint": { "w": 1, "h": 1 },
    "cost": { "base:resource.stone": 20, "base:resource.wood": 10 },
    "buildTicks": 48,
    "terrainTags": ["open"],
    "defense": { "hp": 180, "armor": 4, "kind": "tower" },
    "military": { "garrisonCap": 6 },
    "tags": ["mymod:frontier"],
  },
]
```

## Edicts (`defs/edicts/*.json5`)

Kingdom-wide policy: a daily gold upkeep plus one or more Modifiers against a CLOSED,
engine-versioned target list (a typo here is a load-time error, not a silent no-op).

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `name` | string | |
| `upkeep` | number ≥ 0 | gold/day |
| `modifiers` | `{target, op, value}[]`, ≥ 1 | see targets below |
| `tags` | string[] | *optional* |

Modifier `target` must be one of: `village.happinessDrift`, `village.productionEfficiency`,
`village.spoilage`, `kingdom.taxYield`, `kingdom.researchYield`. `op` is `"add"` or `"mul"`,
`value` is −100..100.

## Units (`defs/units/*.json5`)

| Field | Type | Notes |
|---|---|---|
| `id`, `name` | string | |
| `class` | `"infantry"` \| `"ranged"` \| `"cavalry"` \| `"siege"` \| `"support"` | |
| `stats.attack/defense` | number ≥ 0 | |
| `stats.hp` | number ≥ 1 | |
| `stats.speed` | number ≥ 0 | |
| `stats.moraleBase` | number 1–100 | |
| `counters` | `{ <class>: multiplier 0.1–3 }` | *optional* — attack multiplier vs. that class; missing = 1 |
| `cost` | `{ "resourceId": amount≥1, ... }` | one-time equipment cost |
| `costGold` | number ≥ 0 | one-time gold cost |
| `upkeepGold` / `upkeepFood` | number ≥ 0 | per season |
| `recruitTicks` | integer ≥ 1 | training duration |
| `popCost.cohort` | `"child"` \| `"adult"` \| `"elder"` | which cohort the recruit is drawn from |
| `popCost.count` | integer ≥ 1 | |
| `tags` | string[] | |

A building only trains a unit if the unit's id appears in that building's `military.recruits`.

## Techs (`defs/techs/*.json5`)

Nodes in one shared DAG, validated as a whole after merge: every `prerequisites` id must resolve,
`tier`/`era` may never DECREASE across a prerequisite edge (a tech can't require a later one), and
the full graph must be acyclic.

| Field | Type | Notes |
|---|---|---|
| `id`, `name`, `desc` | string | |
| `branch` | `"agriculture"` \| `"construction"` \| `"warfare"` \| `"statecraft"` | |
| `tier` | integer 1–5 | |
| `era` | `"early"` \| `"high"` \| `"late"` | |
| `cost` | number ≥ 1 | research points |
| `prerequisites` | string[] (tech ids) | |
| `unlocks.buildings/units/edicts` | string[], *optional* | must reference real ids |
| `unlocks.wallTier` | integer 1–3, *optional* | |
| `modifiers` | Modifier[], *optional* | same shape/targets as edicts |
| `diffusionDiscount` | number 0–1 | cost discount once a known rival already has this tech |
| `tags` | string[] | |

## Events (`defs/events/*.json5`)

The Predicates & Effects DSL (doc 09 §4) — declarative, no scripting.

| Field | Type | Notes |
|---|---|---|
| `id`, `name` | string | |
| `pool` | `"disaster"` \| `"opportunity"` \| `"character"` \| `"diplomatic"` \| `"unrest"` \| `"era"` | |
| `scope` | `"kingdom"` \| `"village"` \| `"world"` | |
| `trigger` | PredicateExpr | see below |
| `weight` | number | base selection weight within its pool |
| `weightModifiers` | `{condition, multiplier}[]`, *optional* | |
| `cooldownDays` | integer, *optional* | |
| `once` | boolean, *optional* | |
| `text.title` / `text.body` | string | |
| `choices` | EventChoice[] | see below |
| `tags` | string[] | |

**PredicateExpr** is one of: `{all: PredicateExpr[]}`, `{any: PredicateExpr[]}`,
`{not: PredicateExpr}`, `{season: "spring"|"summer"|"autumn"|"winter"}`,
`{hasEdict: "<edict id>"}`, `{hasTech: "<tech id>"}`, `{chance: 0..1}`, or a stat comparison
`{stat: "<path>", lt|lte|gt|gte|eq: number}` (exactly one comparator). `stat` must be one of the
CLOSED paths: `village.happiness`, `village.foodSecurity`, `village.tier`, `kingdom.treasury`.

**EventChoice**: `{id, text, requirements?: PredicateExpr, effects: EffectExpr[], aiScoreHints?: {axis: number}}`.

**EffectExpr** is one of: `{grantResource: {resource, amount}}`, `{removeResource: {resource, amount}}`,
`{modifier: {stat: <STAT_PATHS>, op: "add"|"mul", value}}` (an immediate one-time nudge, NOT a
persistent edict-style modifier), `{opinionChange: {delta}}`, or `{command: {type, payload}}` (an
escape hatch — submits any already-registered kernel command).

```json5
[
  {
    "id": "mymod:event.harvest-blight",
    "name": "Harvest Blight",
    "pool": "disaster",
    "scope": "village",
    "trigger": { "all": [{ "season": "autumn" }, { "chance": 0.05 }] },
    "weight": 1,
    "text": { "title": "Blight in the Fields", "body": "A grey mold spreads through the granary stores." },
    "choices": [
      {
        "id": "burn-it",
        "text": "Burn the infected stores",
        "effects": [{ "removeResource": { "resource": "base:resource.food", "amount": 20 } }],
      },
    ],
    "tags": [],
  },
]
```

## Traits (`defs/traits/*.json5`)

Small skill-delta bundles applied once to a notable character.

| Field | Type | Notes |
|---|---|---|
| `id`, `name`, `desc` | string | |
| `skillModifiers` | `{ stewardship?/martial?/diplomacy?/scholarship?: integer −5..5 }` | all optional |
| `tags` | string[] | |

## Personalities (`defs/personalities/*.json5`)

An AI kingdom archetype. `weights` covers all 8 axes: `expansion`, `aggression`, `economy`, `tech`,
`diplomacyTrust`, `riskTolerance`, `grudgeRetention`, `honor` (each 0–1, all required).

| Field | Type | Notes |
|---|---|---|
| `id`, `name`, `desc` | string | |
| `weights` | `{ <axis>: 0..1, ... }` (all 8) | |
| `preferences.favoredVictory` | victory-type strings[] | |
| `preferences.favoredUnits` | string[] | flavour/future-AI hook |
| `preferences.buildStyle` | string[] | freeform |
| `preferences.insultThreshold` | number −100..100 | |
| `preferences.giftReceptivity` | number 0–2 | |
| `planBiases` | `{ <PlanArchetype id>: multiplier 0..3 }` | *optional keys*, default 1 |
| `taunts` | `{ <trigger tag>: string[] }` | flavour lines |
| `tags` | string[] | |

## Castle templates (`defs/castle-templates/*.json5`)

An AI castle-layout archetype for the capital's defence layer (Phase 8): a build queue of
defensive structures placed as offsets from the keep centre, walked one structure per day as the
kingdom's stores allow. Tiles the local ground refuses (rock, water, occupied) are skipped —
that's the terrain adaptation. Every `plan[].def` must name a building carrying a `defense`
block (checked at load).

| Field | Type | Notes |
|---|---|---|
| `id`, `name`, `desc` | string | `desc` optional |
| `plan` | `{ def, ring }` or `{ def, at: [[dx,dy],…] }`[] | exactly one of `ring`/`at`; built in array order |
| `plan[].ring` | integer 1–45 | full square perimeter at that radius |
| `plan[].at` | `[dx, dy]` pairs, each −50..50 | explicit offsets |
| `garrisonAnchors` | `[dx, dy]` pairs | idle soldiers post here, in order |
| `tags` | string[] | optional |

## A note on scripting

There is no scripting layer. Everything mods can do goes through the def kinds above and the
Predicates & Effects DSL — deliberately: content authored this way is fully validated, sandboxed by
construction, and mod-order-safe. If something you want to build genuinely can't be expressed with
these kinds, that's useful information — say so when you file feedback.
