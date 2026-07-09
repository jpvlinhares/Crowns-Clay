# 06 — Data Model

Implementation-independent schemas for all major entities. Notation is pseudo-schema (`?` optional,
`[]` list, `Map<K,V>` keyed collection, `Id<T>` reference). Two categories:

- **Definitions** (`*Def`) — static content loaded from mod data files (doc 09); immutable at
  runtime; identified by namespaced string ids (`base:building.granary`).
- **State** — mutable simulation entities; identified by integer entity ids; serialised by the save
  system with per-schema `version` for migrations (TDD §8).

Extensibility rules: every Def carries `tags: string[]` and `props: Map<string, scalar>` for
mod-added data; systems must ignore unknown fields; effects are expressed through the shared
`Modifier` primitive rather than bespoke fields wherever possible.

## §0. Shared Primitives

```
Modifier      { target: StatPath, op: add|mul|set, value: number,
                scope: kingdom|village|unit|building, duration?: ticks, source: Id }
Cost          { resources: Map<Id<ResourceDef>, number>, gold?: number, labor?: number }
Requirement   { tech?: Id<TechDef>[], building?: Id<BuildingDef>[], terrainTags?: string[],
                villageTier?: number, custom?: PredicateRef }
Yield         { resource: Id<ResourceDef>, perDay: number }
Requirement   // M15 delta: villageTier gating implemented (placement
              // validator); tech/building/custom predicates arrive M32+.
              // M13 delta: yields are authored in units/day (human-legible in
              // content); the hourly production system batches perDay/24 and
              // scales whole recipes by min(workforce eff, input availability,
              // output headroom) so clamping never breaks conservation.
Rect / Point / Footprint   — grid geometry primitives
LocalizedText  = key into localization tables (never raw strings in defs)
```

## §1. ResourceDef

```
ResourceDef { id, name: LocalizedText, tier: raw|processed|finished,
              category: food|material|military|luxury,
              basePrice: number, priceBand: [min,max],
              weight: number,              // hauling cost
              decay?: perDayFraction,      // food spoilage
              tags, props }
```

## §2. BuildingDef & Building (state)

```
BuildingDef { id, name, desc, category: housing|production|service|military|castle|monument,
              footprint: Footprint, cost: Cost, buildTicks: number,
              requires: Requirement, terrainTags: string[],
              workers?: { required: number, jobs: Id<JobDef> },
              recipes?: [{ inputs: Yield[], outputs: Yield[] }],
              serviceAura?: { need: NeedType, strength: number, radius: number },
              housing?: { capacity: number, comfort: number },
              military?: { recruits: Id<UnitDef>[], drillRate: number, garrisonCap: number },
              defense?: { hp: number, armor: number, kind: wall|gate|tower|keep,
                          rangedArc?: {range, damage} },
              upgradesTo?: Id<BuildingDef>, modifiers?: Modifier[], spriteId, tags, props }

Building(state) { id, defId, villageId, pos, rotation, condition: 0..1,
                  progress: 0..1,            // under construction
                  workersAssigned: number, priority: 1..5,
                  inventory: Map<Id<ResourceDef>, number>, disabled?: bool, version }
```

## §3. UnitDef & Unit (state)

```
UnitDef { id, name, class: infantry|ranged|cavalry|siege|support,
          stats: { attack, defense, hp, speed, range, moraleBase },
          counters: Map<UnitClass, multiplier>,           // soft counters, GDD §6
          cost: Cost, upkeep: Cost, recruitTicks, popCost: {cohort: adult, count},
          equipment: Id<ResourceDef>[], requires: Requirement,
          abilities?: string[] (charge|volley|shieldwall|breach),
          spriteId, tags, props }

Unit(state) { id, defId, kingdomId, armyId?, count: number,       // men in the unit
              strength: 0..1, morale: 0..100, training: 0..100,
              equipmentTier: 0..3, experience: number, version }

Army(state) { id, kingdomId, name, commanderId?: Id<Character>,
              units: Id<Unit>[], pos, path?: Point[], stance: garrison|patrol|raid|siege|march,
              supplies: Map<Id<ResourceDef>, number>, fatigue: 0..100, version }
```

## §4. Village (state)

```
Village { id, kingdomId, name, center: Point, radius: number,
          tier: 1..4,                       // hamlet..city
          specialization?: farming|mining|crafting|trade,
          buildings: Id<Building>[], grid: OccupancyIndex,
          stockpile: Map<Id<ResourceDef>, number>, stockLimits: Map<Id, number>,
          cohorts: Cohort[], notables: Id<Character>[],
          happiness: 0..100, needSatisfaction: Map<NeedType, 0..100>,
          taxRate: enum, rationPolicy: enum, prosperity: number,
          isCastle: bool, defenseGraph?: DefenseGraph, siegeState?: SiegeState, version }

Cohort  { ageBand: child|adult|elder, occupation: Id<JobDef>|idle,
          count: number, skill: 0..100 }
DefenseGraph { nodes: [{buildingId, kind, hp, armor}], edges: [...],
               enclosedArea: Footprint, autonomyDays: number }
```

## §5. Kingdom (state) & PlayerProfile

```
// M16 delta: implemented slice = treasury + offices (as entity refs) +
// active edicts; ONE kingdom until borders/kingdom placement (M22), so
// villages are implicitly the player's — Village.kingdomId lands at M22.
Kingdom { id, name, bannerDef, isPlayer: bool, aiPersonalityId?: Id<AIPersonalityDef>,
          capitalVillageId, villages: Id<Village>[], armies: Id<Army>[],
          treasury: number, edicts: Id<EdictDef>[], offices: Map<Office, Id<Character>>,
          techsKnown: Id<TechDef>[], researchActive?: {techId, progress},
          prestige: number, rank: 1..5, warExhaustion: 0..100,
          reputation: -100..100,                       // global, public
          diplomacy: Map<Id<Kingdom>, DiplomaticState>,
          knowledge: KnowledgeModel,                    // fog of information, AI doc §6
          eliminated?: bool, version }

Player  { settings: {...}, chronicle: ChronicleEntry[],   // meta, outside sim state
          keybinds, unlockedCosmetics: string[] }
```

**M19 delta — `KnowledgeModel` (fog of information, AI doc §6):** implemented as a
per-kingdom collection of `KnowledgeFact`, packed as a flat `number[]` (the ECS
object-component save codec only knows `string | number[] | Map<number,number>`,
and a fact needs several floats):

```
KnowledgeFact { subject: Id, kind: armyStrength|treasury|techLevel|villageState|intent,
                value: number, confidence: 0..1, lastUpdated: tick,
                source: scout|trade|envoy|battle|rumor }
```

Facts are overwritten on refresh (one fact per `(subject, kind)`), decay in
confidence over elapsed ticks (`decayAll`), and are read only through
`believedValue = value ± noise(1−confidence)` — deterministic PRNG fork keyed
by `(subject, kind, tick)`, never the authoritative value directly. Fog
enforcement (which entities a kingdom may query at all) is a separate,
entity-level mechanism — see `packages/sim/src/ai/fogQuery.ts` — layered on
top of the ECS's existing component-level declared-access checks, not folded
into them. M19 ships the mechanism and a brain-scheduling skeleton (sensor /
appraisal / strategic systems on the doc 08 §9 cadence, staggered per
kingdom); situation appraisal and plan scoring that actually *use* believed
values are M20/M21.

## §6. Character (notables)

```
Character { id, kingdomId, name, age, gender, alive: bool,
            skills: { stewardship, martial, diplomacy, scholarship: 0..20 },
            traits: Id<TraitDef>[],           // brave, greedy, pious...
            role?: advisor(office)|commander(armyId)|heir|envoy,
            relationships: [{characterId, kind: spouse|parent|rival, opinion}],
            loyalty: 0..100, version }
```

## §7. AIPersonalityDef

```
AIPersonalityDef { id, name, desc,
   weights: { expansion, aggression, economy, tech, diplomacyTrust,
              riskTolerance, grudgeRetention, honor: 0..1 },
   preferences: { favoredVictory: VictoryType[], favoredUnits: tags[],
                  buildStyle: tags[], insultThreshold, giftReceptivity },
   planBiases: Map<PlanArchetype, multiplier>,      // AI doc §2
   taunts/voiceSet: LocalizedText groups, tags, props }
```

## §8. TechDef

```
TechDef { id, name, desc, branch: agri|construction|warfare|statecraft,
          tier: 1..5, era: early|high|late, cost: researchPoints,
          prerequisites: Id<TechDef>[],
          unlocks: { buildings?: Id[], units?: Id[], edicts?: Id[], wallTier?: n },
          modifiers?: Modifier[], diffusionDiscount: 0..1, tags, props }
```

## §9. Terrain

```
TerrainDef { id, name, biome, movementCost, buildableTags: string[],
             yields?: Yield modifiers, defenseBonus?: number, spriteSet, tags }

WorldTile (state, SoA arrays) { terrainId, elevation, moisture, riverMask,
             resourceNodeId?, ownerKingdomId?, roadLevel: 0..3, improvements? }
             // M14 delta: roadLevel lives in a dedicated hashed RoadGrid
             // (packages/sim logistics) until WorldTile becomes mutable ECS
             // state; levels 2–3 unlock with research (M32). Road factor:
             // movement speed × (1 + 0.5·level).

WorldDef (worldgen output) { seed, size, params, tiles, resourceNodes,
             startSites: [{pos, score}], neutralFeatures[] }
```

## §10. Diplomacy Objects

```
DiplomaticState { opinion: -100..100, opinionModifiers: [{srcEvent, value, decayPerDay}],
                  trust: 0..100, treaties: Id<Treaty>[], atWar: bool,
                  knownSince: tick, embassies?: {...} }

Treaty { id, parties: Id<Kingdom>[], clauses: Clause[], signedTick,
         duration?: ticks, breached?: {byKingdom, tick} , version }
Clause = peace|nonAggression|trade{route}|tribute{amount,interval}|gift{...}
        |access|alliance|jointWar{target}|vassalage{lord,vassal}|marriage{charA,charB}
        |ransom{characterId,amount}
```

## §11. EventDef & scheduled EventInstance

```
EventDef { id, pool: disaster|opportunity|character|diplomatic|unrest|era,
           trigger: PredicateExpr,            // over game state (data-defined DSL, doc 09 §4)
           weight: number, weightModifiers: [{condition, multiplier}],
           cooldown?: days, once?: bool, scope: kingdom|village|world,
           text: LocalizedText, choices: [{ text, requirements?, effects: EffectExpr[] ,
                                            aiScoreHints: Map<personalityAxis, value> }],
           tags, props }
EffectExpr = grant/remove resource | Modifier | spawn | opinionChange | startEvent | command
```

## §12. Save File

```
SaveFile { header: { magic, saveVersion, gameVersion, timestamp, playtime,
                     kingdomName, year/season, mapThumb: blob,
                     modManifest: [{modId, version, hash}], sandbox: bool, ironman: bool },
           worldDef: compressed WorldDef,
           state:   { schemaVersions: Map<component, v>, blobs: per-component streams },
           cmdLogTail: Command[],             // since last snapshot, for integrity check
           rngState: PRNG snapshot,
           chronicle: ChronicleEntry[] }
```

## §13. Entity-Relationship Overview

```
 Kingdom 1──* Village 1──* Building ──uses──► BuildingDef
    │            │  1──* Cohort               ▲ (all *Defs live in the
    │            └──* Character               │  immutable Definition DB,
    │ 1──* Army 1──* Unit ──► UnitDef         │  layered by mods)
    │ 1──1 KnowledgeModel                     │
    ├──* DiplomaticState *──1 Treaty          │
    └──1 AIPersonalityDef?  ...──────────────-┘
 World: WorldTile[SoA] · resource nodes · neutral features
 Content: ResourceDef · TechDef · EdictDef · TraitDef · EventDef · TerrainDef · JobDef
```

Design intent: *state references defs, never copies them* (saves stay small, mods can rebalance
existing saves within reconciliation rules [OQ-4]); *all numbers flow through Modifiers* so tools,
tooltips, AI, and mods see one uniform effect system.
