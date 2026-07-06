# 02 — Game Design Document (GDD)

Each system below is described by **Purpose · Player interactions · Internal mechanics ·
Dependencies · Balancing concerns**. Entity names in `code` refer to schemas in doc 06. Simulation
rates are defined authoritatively in doc 08; targets in doc 11.

**System dependency overview:**

```
 WorldGen ──► Terrain ──► Villages ──► Population ──► Economy ──► Kingdom Mgmt
                 │            │            │             │            │
                 ▼            ▼            ▼             ▼            ▼
              Pathing     Buildings     Military ◄── Research     Diplomacy
                 │            │            │             │            │
                 └────────► Castles ──► Combat ◄─────────┘            │
                                           │                          │
                              AI Kingdoms ◄┴──────────────────────────┘
                                           │
                          World Simulation (drives everything per tick)
```

---

## §1. Core Gameplay Loop

**Purpose.** Bind all systems into a rhythm of observe → decide → act → consequence (Vision §2),
where the world moves whether or not the player acts.

**Player interactions.** Pause/speed control (pause, 1×–8×); map navigation; selection & inspection
of any entity; issuing orders (construction, recruitment, army movement, diplomacy, research,
policies); responding to event popups and advisor reports.

**Internal mechanics.** The world advances in discrete simulation **ticks** (1 tick = 1 in-game
hour; see doc 08). Player orders are commands appended to the deterministic input log and executed
on tick boundaries. Reports and events surface simulation changes back to the player through a
notification queue with severity tiers (info / attention / urgent-pause).

**Dependencies.** Everything. The loop is the container; World Simulation (§12) is its engine.

**Balancing concerns.** Notification fatigue vs. missed crises — tune severity thresholds; ensure
"nothing demands attention" stretches exist at low speeds so 8× is desirable, not mandatory.

---

## §2. Kingdom Management

**Purpose.** The player's top-level identity and decision surface: treasury, laws, taxes, advisors,
and realm-wide policies.

**Player interactions.**
- Set **tax rate** per village (none/low/normal/high/punitive) and **ration policy**.
- Enact **edicts** (data-driven policies, e.g., *Conscription*, *Grain Reserves*, *Open Borders*)
  with upkeep costs and happiness/economic modifiers.
- Appoint **advisors** (notable `Character`s) to offices (Steward, Marshal, Chancellor, Scholar);
  advisor skill grants passive bonuses and unlocks automation (e.g., Steward can auto-manage a
  village).
- Read the **Ledger**: full income/expense breakdown, per-village and realm-wide.

**Internal mechanics.** Kingdom-level state (`Kingdom`) aggregates village outputs each economic
update. Taxes convert village prosperity into gold with a happiness cost curve. Edicts are
`Modifier` bundles applied to kingdom scope. Advisors are characters with skills 0–20; office bonus
= f(skill); characters age, die, and can be poached diplomatically.

**Dependencies.** Economy (§3) for money flows; Population (§4) for happiness; Diplomacy (§10) for
advisor poaching and edicts like Open Borders; AI (§11) uses the identical interface.

**Balancing concerns.** Tax curve must make "high tax forever" self-defeating (unrest, emigration);
advisor automation must be strictly ≤ a competent player (quality-of-life, not optimal play);
edict stacking caps to prevent modifier soup.

---

## §3. Resource Economy

**Purpose.** A tangible chain of goods that makes geography, logistics, and specialisation matter.

**Player interactions.** Assign workers to production buildings; set stockpile limits and priorities
per village; build roads and market routes; buy/sell at markets (internal and, via diplomacy, trade
pacts); view flow diagrams per resource.

**Internal mechanics.**
- **Resource tiers:** raw (grain, wood, stone, ore, hides, fish) → processed (flour, planks, cut
  stone, iron, leather, salted fish) → finished (bread, tools, weapons, armour, luxury goods).
- Buildings define recipes: inputs/tick → outputs/tick at workforce efficiency
  `eff = workers_present/workers_required × skill × season × terrain modifiers`.
- **Local-first storage:** each village has stockpiles; goods move via hauler jobs along roads with
  travel time — distance is a real cost, not a UI flourish.
- **Prices:** per-market prices drift with local supply/demand within data-defined bands; trade
  pacts create scheduled caravans between kingdoms.
- Food is consumed by population (§4); tools/weapons by buildings and military (§6).

**Dependencies.** Terrain (§13) gates resource nodes; Population supplies workers; Research (§9)
improves recipes; Military consumes equipment and food; Diplomacy enables external trade.

**Balancing concerns.** Chain length vs. tedium (cap at 3 tiers); prevent degenerate "sell
everything" strategies via price elasticity; hauling costs must matter without making sprawl
unplayable; food security must be the economy's heartbeat (famine as the core failure state).

---

## §4. Population

**Purpose.** People are the kingdom's fuel and its conscience: workforce, soldiers, taxpayers, and
the source of unrest.

**Player interactions.** Indirect rule: players set policies, wages/rations, and build housing and
services; villagers choose jobs and homes themselves. Players can inspect any villager (name, family,
job, needs, mood) and directly manage only **notables** (§2 advisors, §6 commanders).

**Internal mechanics.**
- Population simulated as **cohorts** per village (age band × occupation) for scale, with a sampled
  set of **named individuals** (~30/village) rendered and used for flavour, notables, and events.
  Cohort math is authoritative; individuals are projections of it **[OQ-2]**.
- **Needs:** food, shelter, warmth (seasonal), safety, faith, leisure — each 0–100. Weighted average
  = **happiness**; sustained low happiness → unrest events → emigration or revolt (§ event system).
- **Growth:** births/deaths per season from food security, healthcare buildings, and housing;
  immigration attracted by prosperity + reputation.
- Jobs auto-assigned by priority solver (player-tunable per-building priority 1–5).

**Dependencies.** Economy feeds and houses them; Village Development (§5) provides services;
Military recruits from cohorts (removing workers — a real trade-off); Events system expresses unrest.

**Balancing concerns.** Death-spiral protection (famine → fewer farmers → worse famine) via floor
mechanics (foraging, emergency imports, aid events); growth pacing so population, not gold, is the
long-run limiting resource; revolt frequency tuned to threaten neglect, not punish experimentation.

---

## §5. Village Development

**Purpose.** Villages are the atoms of the kingdom — distinct places that grow from hamlet to town
to city with visible character.

**Player interactions.** Found new villages (settler party + valid site); place buildings on the
village grid; upgrade the village centre to raise tier (Hamlet→Village→Town→City), each tier
unlocking building types and larger radius; designate specialisation (farming, mining, crafting,
trade) granting focus bonuses.

**Internal mechanics.** Each `Village` owns a local build grid over the world tile map; buildings
occupy footprints, require terrain tags (mine⇢ore tile, dock⇢coast), and connect via roads to the
village centre for full efficiency. Tier upgrade requirements: population, building variety,
stockpiled materials, and happiness threshold. Service buildings (well, church, tavern, bathhouse)
project need-satisfaction auras by radius.

**Dependencies.** Terrain for placement; Economy for materials; Population for growth requirements;
Castle system (§7) shares placement rules; AI uses identical founding/upgrading logic.

**Balancing concerns.** Wide (many villages) vs. tall (few big cities) must both be viable —
administrative overhead per village vs. tier bonuses; site scarcity so village placement is a
strategic decision; upgrade requirements must not stall into busywork.

---

## §6. Military

**Purpose.** Raise, equip, sustain, and move armed force — the sharp end of kingdom policy.

**Player interactions.** Build military buildings (barracks, archery range, stables, siege
workshop); recruit units (costs population from cohorts + equipment + gold); assemble units into
**armies** under a commander; move armies on the world map; set stances (garrison, patrol, raid,
siege); manage supply.

**Internal mechanics.**
- **Unit types** (data-defined): militia, spearmen, swordsmen, archers, crossbowmen, cavalry,
  knights, siege engines (ram, catapult, trebuchet). Stats: attack, defence, HP, speed, range,
  morale, upkeep, equipment requirements.
- **Quality:** unit strength = base × equipment tier × training level (drill over time at barracks)
  × commander bonus × morale.
- **Supply:** armies consume food from accompanying supply or forage; unsupplied armies lose morale
  then attrition. Supply range from friendly villages/depots along roads.
- **Upkeep:** wages + food per season; disbanded units return to population cohorts.

**Dependencies.** Population (recruitment pool); Economy (equipment chains, upkeep); Research
(unlocks unit types/upgrades); Combat (§8) resolves engagements; Castles (§7) for garrisons; AI
fields identical armies.

**Balancing concerns.** Standing army cost must force guns-vs-butter tension; counter triangle
(spear>cav>archer>infantry, siege vs. walls) clear but soft (soft counters ±30–50%, not hard nulls);
snowball control — war exhaustion and supply strain limit blitzkrieg map-painting.

---

## §7. Castle Construction

**Purpose.** Fortification as a designed artefact: player-built castles that mechanically shape
sieges (Vision USP-4).

**Player interactions.** Designate a castle site; place walls (wood→stone→reinforced), gatehouses,
towers, keep, moat segments, and interior buildings (garrison quarters, armoury, granary, well) on
the castle grid; upgrade wall segments individually; assign garrison.

**Internal mechanics.** Castles are special `Village`-like entities with a **defence graph**: wall
segments and gates are nodes with HP/armour; towers provide ranged coverage arcs; the enclosure
algorithm computes protected area. Sieges (§8) attack the graph: breaches create assault paths.
Granary + well determine siege endurance (days of autonomy). Construction consumes cut stone at
scale — castles are the economy's largest sink.

**Dependencies.** Economy (stone chain), Village system (shared placement), Military (garrison),
Combat (siege resolution), Research (fortification tiers), AI construction planner builds castles
too (AI Doc §5).

**Balancing concerns.** Castles must be strong but crackable — defender advantage ~3:1, countered by
siege tech and starvation; prevent turtle stalemates via victory conditions (§16) and siege
attrition on defenders; cost tuned so a realm supports few great castles, not walls everywhere.

---

## §8. Combat

**Purpose.** Resolve violence with tactical texture but strategic pacing — battles you can influence,
not micro-manage.

**Player interactions.** Pre-battle: choose formation, stance (aggressive/defensive/skirmish),
commit reserves, or retreat. During (real-time at sim speed): limited orders — advance, hold, flank,
target priority, withdraw. Sieges add: assault / bombard / starve-out choices and breach targeting.

**Internal mechanics.**
- **Field battles** resolve on a simplified battle-board abstraction of the local terrain (river,
  hill, forest modifiers) in combat sub-ticks. Units fight by lines (front/flank/reserve); damage =
  attack vs. defence with morale as the true HP — most battles end in rout, not annihilation.
  Casualties split kill/wound/capture; wounded recover, captives feed diplomacy (ransom).
- **Sieges:** phased — encircle → bombard/mine (vs. defence graph) → assault (breach paths) or
  starve (granary countdown). Sorties possible for defenders.
- **Auto-resolve** always available; must use the same math with a neutral commander policy so
  outcomes are consistent with manual play (critical for AI-vs-AI battles).

**Dependencies.** Military (unit stats), Castles (defence graph), Terrain (modifiers), AI tactical
layer (AI Doc §3), Events (battle aftermath), World sim (armies collide on the map).

**Balancing concerns.** Auto-resolve vs. manual outcome parity within ±10% expected casualties (else
manual becomes mandatory grind); morale tuning so elite-small vs. cheap-mass are both viable; siege
pacing — starving a castle should take seasons, storming should be bloody.

---

## §9. Research

**Purpose.** Long-horizon progression that differentiates kingdoms and paces content unlocks.

**Player interactions.** Choose one active research from an unlocked set; build scholar buildings
(scribe's hut → library → university) generating research points; acquire techs via diplomacy
(trade, espionage **[OQ-6]**) or scholars.

**Internal mechanics.** A data-defined DAG of ~60–80 `Technology` nodes in four branches —
**Agriculture & Craft**, **Construction**, **Warfare**, **Statecraft** — with cross-links. Cost
scales by tier; effects are `Modifier`s and unlock flags (buildings, units, edicts, wall tiers).
Era gates (Early/High/Late medieval) require breadth, discouraging pure beelines.

**Dependencies.** Economy funds scholars; every other system consumes unlock flags; AI weighs the
same tree via strategic goals (AI Doc §2).

**Balancing concerns.** No single mandatory path — each branch must offer a viable identity;
tech-behind kingdoms need catch-up (diffusion: cheaper cost for techs known by neighbours) to keep
late wars competitive; tempo such that a full campaign sees ~70% of the tree.

---

## §10. Diplomacy

**Purpose.** Make other kingdoms partners and problems — the interface where AI personality is most
visible.

**Player interactions.** Open a negotiation with any known kingdom; propose deals composed of
**clauses** (peace, non-aggression, trade pact, tribute, gift, ransom, marriage tie between notable
characters, military access, alliance, joint war, vassalage). Send envoys (improve relations),
insults, ultimatums. View each kingdom's **opinion** of you and its known grievances.

**Internal mechanics.**
- **Opinion score** (−100…+100) per kingdom-pair from stacked, decaying `OpinionModifier`s (gifts,
  border friction, broken promises, wars, shared enemies, personality affinity).
- Deals evaluated by AI as utility exchanges (AI Doc §4): every clause has a computed value to each
  side; deals accept when perceived value ≥ threshold shaped by personality and trust.
- **Treaties** are persistent objects with breach detection; breaking one emits reputation events.
- **Reputation** (public, global) vs. **opinion** (private, pairwise) — oathbreaking taints all
  future negotiations (AI Doc §7).
- **Casus belli:** wars declared without cause incur reputation and internal-happiness penalties.

**Dependencies.** AI kingdoms (§11) are the counterparties; Economy (trade values); Military (war
logic); Characters (marriages, envoys); Events (diplomatic incidents).

**Balancing concerns.** AI must be gameable-feeling but not exploitable (gift-spam caps, deal-value
sanity bounds); alliances must sometimes drag players into wars they don't want (teeth, not paper);
vassalage as an alternative to conquest must be economically meaningful.

---

## §11. AI Kingdoms

**Purpose.** Fully simulated rivals playing the same game — the game's signature feature. (Full
design: doc 07.)

**Player interactions.** Indirect: the player meets AI kingdoms through scouting, borders, trade,
diplomacy, and war. Direct inspection limited by **fog of information**: known facts decay in
accuracy (doc 07 §6).

**Internal mechanics (summary).** Each AI kingdom runs the identical simulation and issues the same
commands as a player, driven by a layered brain: strategic goal selection (utility-scored plans) →
domain managers (economy, construction, military, diplomacy, research) → tactical execution.
Personality (`AIPersonality`) weights the utility functions; memory and grudges persist across the
campaign.

**Dependencies.** Every gameplay system (AI consumes the same command API); Difficulty (§14) scales
AI planning quality and labelled bonuses; World sim schedules AI thinking (doc 08 §9).

**Balancing concerns.** AI competence floor (must survive and grow unaided on Normal); think-budget
vs. frame budget (doc 11); personality distinctness without stupidity (a Warmonger still eats).

---

## §12. World Simulation

**Purpose.** The clock and the physics of the world: time, seasons, and ordered system updates.
(Full design: doc 08.)

**Player interactions.** Speed control and pause; seasonal report; calendar UI. Otherwise invisible
by design — the player experiences it as "the world is alive."

**Internal mechanics (summary).** Fixed-timestep deterministic ticks (1 tick = 1 in-game hour); a
day = 24 ticks, a season = 90 days, a year = 4 seasons. Systems update at staggered cadences
(hauling every tick; economy hourly; population daily; AI strategy weekly — full table in doc 08).
Seasons modify yields, attrition, and movement (winter: −farming, +army attrition, frozen rivers
passable **[OQ-5]**).

**Dependencies.** Drives all systems; determinism contract (TDD §5) constrains all of them.

**Balancing concerns.** Season length vs. pacing (90 days ≈ 7 real minutes at 8×); winter must be a
strategic season, not a pause-and-wait; simulation depth vs. performance budget (doc 11).

---

## §13. World Generation

**Purpose.** Replayable, fair-enough, story-rich maps from a seed.

**Player interactions.** New-game screen: seed, map size (S/M/L), landmass style (continent,
archipelago, highlands), resource abundance, number of AI kingdoms, climate harshness. Advanced:
per-parameter overrides. Seeds shareable as strings.

**Internal mechanics.** Pipeline stages (each deterministic from seed): heightmap (layered noise) →
climate bands & moisture → biomes → rivers (downhill carving) → resource node scatter (biome-
weighted) → start-site scoring (food, water, buildables, spacing) → kingdom placement (fairness
solver: comparable start-site scores, minimum pairwise distance) → neutral features (ruins, sacred
sites, mountain passes) → history seeding (initial opinions, minor lore tags).

**Dependencies.** Terrain schema (doc 06); every placement rule in §5/§7; AI start logic; balance of
§14 depends on fairness solver.

**Balancing concerns.** Fairness vs. variety — start-score variance capped at ±15%; chokepoint
density (mountain passes, river crossings) tuned so geography matters militarily; resource scarcity
must force trade/war on smaller maps without soft-locking anyone.

---

## §14. Difficulty

**Purpose.** Serve newcomers through veterans without breaking the "same rules" promise.

**Player interactions.** Difficulty presets at new game (Story / Fair / Hard / Brutal) plus granular
toggles (AI planning quality, AI bonuses, disaster frequency, unrest sensitivity, combat lethality).
Locked after start (ironman) or adjustable (casual) **[OQ-8]**.

**Internal mechanics.** Two orthogonal axes:
1. **AI capability:** planning depth, reaction latency, and manager quality tiers (doc 07 §10) —
   preferred lever.
2. **Explicit labelled modifiers:** only at Hard/Brutal, AI gains visible, tooltipped bonuses
   (+15/30% yields); at Story, the *player* gets them. No hidden cheats at any level.

**Dependencies.** AI doc §10; every yield formula accepts difficulty modifiers via the standard
`Modifier` system.

**Balancing concerns.** "Fair" must be genuinely cheat-free and still challenging (AI competence is
the real work); Brutal must feel hard, not random; difficulty must not warp the economy's internal
logic (bonuses at edges, not middles, of formulas).

---

## §15. Progression

**Purpose.** A felt arc from mud to majesty across a campaign, plus meta-familiarity across
campaigns.

**Player interactions.** Within a campaign: village tiers, research eras, castle tiers, army
professionalisation, dynasty growth (heirs among notables), prestige rank titles (Chief → Lord →
Count → Duke → King) unlocking edicts and diplomatic weight. Across campaigns: **no power
meta-progression** — only cosmetic/registry unlocks (chronicle of past reigns, banner elements,
recorded achievements) to keep every campaign self-contained and mod-friendly.

**Internal mechanics.** Prestige = weighted score of population, buildings, tech, victories, wonders;
rank thresholds are data-defined. Era transitions (§9) re-theme music/UI accents and raise event
pools' stakes.

**Dependencies.** Research, Villages, Diplomacy (rank affects deal weight), Victory (§16 consumes
prestige), Events (era-gated pools).

**Balancing concerns.** Mid-game lull is the classic 4X failure — era transitions and escalating AI
plans (doc 07 §8) exist specifically to punctuate hours 5–15; rank bonuses must be honours, not
snowballs.

---

## §16. Victory Conditions

**Purpose.** Give campaigns endings worth pursuing while honouring sandbox players.

**Player interactions.** Chosen at world creation (any subset enabled): 
- **Conquest** — control ≥N% of settled villages or eliminate all rivals.
- **Hegemony** — all surviving kingdoms are allies or vassals for X years.
- **Legacy** — complete the Grand Wonder chain (massive multi-era economic project).
- **Prosperity** — reach prosperity/happiness thresholds realm-wide for X years.
- **Chronicle (score)** — highest prestige at year limit.
Defeat: lose your last village, or capital falls with no heir **[OQ-9]**.

**Internal mechanics.** Victory tracker evaluates conditions at daily cadence; approaching victories
broadcast world events ("X begins the Grand Cathedral") so AI and player can react — every victory
path must be *contestable*.

**Dependencies.** All scoring systems; AI must both pursue and counter victories (doc 07 §8);
Events broadcast progress.

**Balancing concerns.** Non-military paths must be genuinely faster than conquest for peaceful
builds but interruptible by war (defence still matters); year-limit default tuned to ~85% of
campaigns ending before the limit triggers.

---

## §17. Sandbox Mode

**Purpose.** The game as a toybox: no defeat, all knobs exposed.

**Player interactions.** Toggle at world creation: disables defeat and (optionally) victory;
unlocks the **World Editor palette** — spawn resources/units/buildings, edit terrain, adjust any
kingdom's state, trigger any event, possess an AI kingdom, free camera across all fog.

**Internal mechanics.** Sandbox actions are privileged commands in the same command stream (kept in
the input log → still deterministic and save-compatible). Saves are flagged `sandbox: true`
(excluded from achievements/chronicle records).

**Dependencies.** Command system (TDD §6); UI editor panels; save flagging.

**Balancing concerns.** None economically — but editor UX effort must be capped (it reuses debug
tooling from roadmap M9 rather than being a separate product).

---

## §18. Save System

**Purpose.** Never lose a kingdom; make saves portable, robust, and mod-aware. (Architecture: TDD §8.)

**Player interactions.** Manual save slots (unlimited within quota), autosave (per season +
rotating ring of 3), quicksave; export/import save as a single file; save browser with metadata
(map thumbnail, year, kingdom, mods, playtime); ironman mode (single rolling save).

**Internal mechanics (summary).** Versioned snapshot of full simulation state + command log tail;
compressed; stored in browser storage (IndexedDB) with quota monitoring and export prompts;
migration chain upgrades old saves; mod manifest embedded — loading with missing/changed mods
triggers a reconciliation report **[OQ-4]**.

**Dependencies.** Determinism (TDD §5), Modding (§19), every system's serialisation contract.

**Balancing concerns.** Not gameplay-balanced, but: autosave stalls must stay under targets (doc 11)
or players will disable them; ironman + browser storage risk (Risk R6) needs aggressive export UX.

---

## §19. Modding Support

**Purpose.** Content without code; the base game as proof (Vision §4). (Full design: doc 09.)

**Player interactions.** In-game Mods screen: install (file/folder import), enable/disable, order,
conflict report; per-save mod sets; creator tools: schema docs, validation console, hot-reload in
dev mode.

**Internal mechanics (summary).** All content (`defs/`) loaded from ordered mod layers with
patch/override semantics; JSON-schema validation with human-readable errors; scripted behaviour via
a sandboxed event-hook layer **[OQ-3]**; base game ships as Mod Zero in the same format.

**Dependencies.** Data model (doc 06) is the contract; Save system embeds mod state; every system
must read definitions, never hard-code content.

**Balancing concerns.** Not applicable to balance; the risk is engine leakage (content logic
sneaking into code) — enforced by the "Mod Zero" rule and code review checklist (TDD §13).

---

## Appendix A — Event System (cross-cutting)

Events are data-defined objects with **trigger conditions** (predicates over game state), **weights**
(personality/season/era-modulated), **effects** (modifiers, spawns, opinion changes), and optional
**choice menus**. Pools: disasters, opportunities, character, diplomatic incidents, unrest, era
milestones. Events are the voice of the simulation, never its puppeteer: they may only nudge state
through the same modifier/command channels as everything else. Scheduling cadence in doc 08 §10.

## Appendix B — Consistency Ledger

| Constant | Value | Owner |
|---|---|---|
| Tick | 1 in-game hour | doc 08 |
| Day / Season / Year | 24 ticks / 90 days / 4 seasons | doc 08 |
| Max AI kingdoms / villages / units | 8 / 60 / 2,000 | doc 11 |
| Opinion range | −100…+100 | GDD §10 / doc 07 |
| Advisor skill range | 0–20 | GDD §2 / doc 06 |
| Tech tree size | 60–80 nodes | GDD §9 |
