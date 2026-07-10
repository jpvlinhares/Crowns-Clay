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
              // M25 delta: `military.recruits` implemented (barracks gates recruitment
              // by def id). M28 delta: `garrisonCap` implemented as content (keep/tower)
              // but not yet enforced against actual garrisons (Sieges, M29);
              // `drillRate` (training-quality) stays deferred.
              defense?: { hp: number, armor: number, kind: wall|gate|tower|keep,
                          rangedArc?: {range, damage} },
              // M28 delta: implemented — `kind` feeds the defence graph/enclosure
              // algorithm (game/castles.ts); `rangedArc` stays inert until Sieges (M29).
              // `category: castle` implemented; `monument` is unclaimed content past this.
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

// M25 delta (game/military.ts): "basics" slice only — recruitment (barracks-gated,
// atomic pop/resource/gold check), training (`progress`/`complete`, hourly, mirrors
// construction), armies as a lightweight `Unit.armyId` grouping (no pos/path/stance/
// supplies/fatigue yet — those are Movement, M26), and seasonal upkeep (gold via the
// kingdom ledger, food via the home village stockpile; unpayable units DESERT,
// returning population, mirroring an unpayable edict lapsing). `cost` folds the
// doc's separate `equipment` list into one flat resource map (mirrors BuildingDef);
// `stats`/`counters`/`abilities`/`training`/`experience`/`equipmentTier` stay inert
// content until Combat (M27). The Marshal office (kingdom.ts) discounts upkeep by
// martial skill, same shape as the Steward's tax bonus.
//
// M26 delta (game/armies.ts): `pos`/`path`/`stance`/`fatigue` land. Pathing is
// hierarchical HPA* (nav/hpaStar.ts) — a chunk-graph built once at load, so a
// long route never re-walks the whole map. `stance` stores all five values but
// only `garrison` (halts movement) and `march` (set by `army.moveTo`, cleared
// on arrival) do anything yet — patrol/raid/siege wait on hostile kingdoms
// (M31) and castles (M28). `supplies` is drawn first, then FORAGED from the
// nearest friendly village within range (a real stockpile cost, not a free
// depot — full road-network depots are Castles/Sieges, M28/M29). Unsupplied
// fatigue climbs and, sustained at max, triggers ATTRITION: `Unit.count`
// shrinks for real — unlike disband/desertion (M25), attrition never returns
// population to any cohort. `commanderId`/`units` (the reverse of `armyId`)
// are not modelled — mirrors `Building.village` over a `Village.buildings`
// list elsewhere in this doc.
//
// M27 delta (game/combat.ts): `stats.moraleBase` and `counters` activate.
// `Unit.morale` (added this milestone) starts at `moraleBase` and IS the
// "true HP" GDD §8 describes — sub-round damage subtracts from it, not from
// `stats.hp` (hp stays authored content, unconsumed — a per-soldier
// durability nuance deferred past v1). A routed unit's `armyId` clears (it
// survives, unlike `Unit.count` casualties, which are real and never
// returned — the same irreversible loss as armies.ts's starvation
// attrition). `Engagement` (doc 06's Combat kinds) is a plain relational
// class (`CombatState`, mirrors `DiplomacyState`) keyed by army pair, not an
// ECS entity — combat has no state of its own beyond which two armies are
// fighting and how many ticks have elapsed. Front/flank/reserve lines,
// formation orders, and equipmentTier/experience/training stay inert.
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

// M28 delta (game/castles.ts): a castle is NOT a separate entity kind — any Village
// becomes one the moment its wall/gate/tower/keep buildings (ordinary BuildingDefs
// with the new `defense` block, doc 06 §2) close a loop. `isCastle` and `DefenseGraph`
// are DERIVED (recomputed on building.completed/demolished, never per-tick), not
// authored state — no `edges` list; the enclosure algorithm is a bounded flood-fill
// (village radius + a fixed padding) rather than a persisted graph traversal.
// `enclosedArea` is a tile-index Set, not a Footprint rect (real castles aren't
// rectangles). `autonomyDays` (siege endurance) is `SiegeState`'s concern — both stay
// undefined until Sieges (M29). `military.garrisonCap` (BuildingDef, doc 06 §2) is
// authored on keep/tower content now but not yet enforced against actual garrisons —
// same "data now, active later" pattern as M25's unit `stats`.
//
// M29 delta (game/siege.ts): `SiegeState` lands as a plain relational class keyed by
// castle (mirrors DiplomacyState/CombatState), not a Village field — one attacker per
// castle at a time (v1). Phases: ENCIRCLE (`siege.begin`, army stance → `siege`,
// GDD §7's fifth stance, inert since M26) → BOMBARD (daily; besieger attack, siege-class
// units at `SIEGE_BOMBARD_BONUS`×, vs. the targeted segment's armor; at 0 HP the
// segment is demolished via the same `VillageOps.demolish` a player uses, so castles.ts's
// existing enclosure rebuild fires with no new plumbing) → ASSAULT/SORTIE (both reuse
// combat.ts's resolver exactly; `Engagement.casualtyMultiplier` makes assaults bloody,
// GDD §8) or STARVE (a season-scale granary countdown once the stockpile sits near
// empty). `autonomyDays` isn't a stored countdown — it's however long
// `STARVATION_SURRENDER_DAYS` takes to elapse while the food stockpile stays at/near
// zero. Capture transfers `VillageOwner` (M22) if multi-kingdom; single-kingdom
// compositions can't besiege at all (nothing to capture from). Multiple simultaneous
// besiegers, mining, and ransom (Characters, M34) stay out of scope.
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

**M32 delta:** `techsKnown`/`researchActive` implemented in `ResearchState` (§8's delta note),
not as literal `Kingdom` fields — keyed by kingdom EntityId in a plain class alongside
`DiplomacyState`, the same "relational, not entity-component" reasoning throughout this doc.

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

// M34 delta (game/characters.ts): deepens the SAME character entities kingdom.ts's genesis
// already creates, rather than spawning its own pool — `gender`/`loyalty` and up to
// `TRAITS_PER_CHARACTER` (2) trait codes land as sibling ECS components (`CharacterGender`,
// `CharacterLoyalty`, `CharacterTraits`), declared to kingdom.ts's yearly despawn via a new
// `registerCharacterExtension` hook (the access guard requires every attached component
// declared, and kingdom.ts can't import a module that depends on it). A trait's
// `skillModifiers` apply ONCE, directly onto `Character`'s own stored skill fields — so
// kingdom.ts's existing Steward/Marshal/Chancellor/Scholar bonus math deepens for free.
// `relationships` is a plain relational class (`CharacterRelations`, mirrors
// `DiplomacyState`) covering exactly `spouse` (via `character.marry`, kingdom-agnostic — using
// it as a diplomatic alliance clause is M35's job) and `parent` (recorded at birth); `rival` is
// unmodelled (no content generates it yet). Heirs: once a year, every married, fertile-age
// couple rolls `HEIR_BIRTH_CHANCE`; a birth blends the parents' current (post-trait) skills ±
// jitter, inherits one parent trait plus one fresh one, and starts too young for
// `kingdom.appoint` (`MIN_OFFICE_AGE`, kingdom.ts) until it ages in — the notable pool now
// grows past the fixed genesis six. Widowing (spouse death) applies a one-time loyalty
// penalty; seated officeholders' loyalty also drifts yearly and, below a floor, may resign the
// seat outright — the same lapse/desertion shape M16/M25 already established, now for court
// politics. `role`/`alive` stay unmodelled: office/commander roles are already derivable
// (`Kingdom.<office>` / `Army.commanderId`), a living character's aliveness is `world.isAlive`,
// and `commander(armyId)` itself is still inert (doc 06 §3's M26 delta) — Army.commanderId
// stays unwired past this milestone too.

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

**M32 delta (packages/data/src/techs.ts, game/research.ts):** ships 72 base techs (60-80
target), 18 per branch, tiers 1-5 mapped to early/early/high/high/late — `modifiers` reuses
edicts.ts's `ModifierDef`/`MODIFIER_TARGETS` verbatim ("tech M32 reuses this shape", that
module's own comment), gaining a `kingdom.researchYield` target for the Scholar office
(game/kingdom.ts). **DAG validation** (the T objective) runs at content load
(`DefinitionDatabase.fromValidated`, packages/data/src/terrain.ts): prerequisites must
reference real techs, tier/era must be non-decreasing along every prerequisite edge, unlocks
must reference real building/unit/edict ids, and the prerequisite graph must be acyclic
(Kahn's algorithm) — any violation is a load-time integrity failure, same severity as a
duplicate terrain id. Kingdom-side state (`ResearchState`, game/research.ts) is a plain
relational class keyed by kingdom EntityId — same reasoning as `DiplomacyState`: lazy
per-kingdom defaults need no genesis-system ordering. One kingdom researches one tech at a
time (`kingdom.setActiveResearch`); **era gates** (GDD §9 "require breadth") check the
CONTENT's actual per-era tech count — `ERA_BREADTH_FRACTION` (0.6) of the prior era must be
known before starting the next. `unlocks` are validated referentially but NOT enforced against
`village.build`/`army.recruitUnit` yet (`hasUnlocked` is a queryable convenience) — the same
"data now, active later" precedent M25 set for `BuildingDef.military.garrisonCap`. `ransom`
(GDD §9 diplomacy acquisition) stays out of scope (Characters, M34); the era pacing sim T
objective is proven in game/research.test.ts (a bounded budget reaches real coverage without
ever completing a later-era tech before its era's breadth gate clears).

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

// M23 delta (game/diplomacy.ts): implemented slice = pairwise `DiplomacyState`
// (opinion, pact bitmask, gift/insult cooldowns) as a plain relational class, not
// per-kingdom ECS state — same reasoning as `KingdomLedger`/`CombatState`. No
// `Treaty`/`Clause` object model yet — pacts are a 2-bit mask (`PACT_NAP`/`PACT_TRADE`),
// evaluated by a pure `evaluateDeal(opinion, type, weights)` (deal-value symmetry).
// `opinionModifiers` (decaying, per-source) and `embassies` stay unmodelled (v1: only
// gifts/insults/pact-break move opinion, no decay-over-time term). Reputation, alliances,
// vassalage, marriage, and joint wars are M35 "Diplomacy v2".
//
// M31 delta (game/diplomacy.ts): `atWar`/`warExhaustion` (0..100) land on the SAME
// relation record, not a separate `Treaty`. `kingdom.declareWar` sets `atWar` (auto-
// breaking any NAP — holding one while declaring war IS the betrayal) with an opinion
// penalty scaled by `casusBelli` (a trust-the-input claim, no verification — a real
// reputation system is M35). War exhaustion climbs a fixed amount/day while `atWar`;
// at `FORCED_PEACE_EXHAUSTION` peace is imposed unconditionally — the roadmap's
// "no forever-wars" GUARANTEE, not an AI tendency. Short of that cap,
// `kingdom.proposePeace` evaluates through `evaluatePeaceDeal` (same
// value-vs-threshold shape as `evaluateDeal`) — `tribute` (flat one-time gold) is this
// milestone's stand-in for `Clause.ransom`, which stays Character-scoped (M34) and out
// of scope. Note: declaring war does NOT itself gate `combat.ts`/`siege.ts` engagement —
// those already treat any two kingdoms without an active NAP as hostile (M27/M30); `atWar`
// is the negotiable, exhaustion-tracked diplomatic layer on top, not a new combat trigger.

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

**M33 delta (packages/data/src/events.ts, game/events.ts):** ships 18 base events (3 per
pool × 6 pools) — `EventDef.text` drops `LocalizedText` for a flat `{title, body}` pair (no
locale system yet); `EffectExpr` implements grant/remove resource, an immediate one-time
`modifier` nudge (targets the SAME closed `STAT_PATHS` vocabulary triggers read — `village.
happiness`, `village.foodSecurity`, `village.tier`, `kingdom.treasury` — applied directly, NOT
a persistent `StatModifiers` entry; a real timed-buff/expiry system is future work), `opinionChange`
(optional diplomacy hook, inert without one), and `command` (an escape hatch: submits any
already-registered kernel command). `spawn`/`startEvent` stay out of scope (`spawn` needs
Characters, M34; `startEvent` needs an event-chaining scheduler this milestone doesn't build).
`PredicateExpr` (doc 09 §4) is a small closed vocabulary — `all`/`any`/`not`, `season`,
`hasEdict`, `hasTech` (ties directly into M32's `techsKnown`), `chance`, and `stat` with five
comparators — validated at content load (`terrain.ts`'s `DefinitionDatabase`, alongside DAG-
style referential checks: `hasEdict`/`hasTech`/resource references must be real). `EventState`
is a plain relational class keyed by kingdom EntityId (same reasoning as `DiplomacyState`/
`ResearchState`), tracking fired-history (cooldowns, `once`-flags), per-season fire counts (the
pacing governor's input), and pending (unanswered) event instances — `kingdom.setActiveResearch`-
style one-command-per-decision (`event.choose`), not an authored `EventInstance` schedule.

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
