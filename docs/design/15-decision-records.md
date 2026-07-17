# 15 — Architecture Decision Records

Formal records for decisions the doc 14 open-questions process did not capture —
created at M47.9 per doc 12 revision R1, following the same "context · options ·
decision · consequences" shape doc 14's Decision Log uses. New ADRs append here.

---

## ADR-1 — Characters (M34) are CUT from the 1.0 composition

**Context.** `game/characters.ts` (notables, traits, marriages, heirs) shipped at M34 and
passed its tests — but the M47.5 audit found it has ZERO consumers outside its own test file:
not the app, not the AI harness, not the unified campaign. No other system misses it: advisors
(the player-facing character slice) live in kingdom.ts independently; ransom (its one designed
combat hook) was already deferred by M31's own scoping note; dynastic defeat was declined at
OQ-9.

**Options.** (a) Wire it into the unified campaign plus a Characters panel — real,
multi-milestone scope (UI, AI marriage/heir behaviour, balance) against a system nothing
depends on; (b) delete the module; (c) keep the module behind its boundary, excluded from the
1.0 composition, and revisit post-1.0.

**Decision.** (c). The module stays, tested, unwired. 1.0's character surface is advisors
(kingdom.ts), exactly what the player already sees.

**Consequences.** GDD §2's deeper character promises (poaching, marriages between notables,
heirs among notables) are POST-1.0; docs and marketing must not claim them. The 1.x wiring
milestone inherits a tested foundation rather than a rewrite. Vision pillar 1's "named
villagers/notables" is served at 1.0 by advisors and the events system only.

---

## ADR-2 — Knowledge-model scope at 1.0: army-strength beliefs only

**Context.** Doc 07 §6 designs a full fog-of-information belief system (`brain.ts` +
`knowledge.ts`, M19). The M47.5 audit found it consumed by nothing: every AI read plain truth.
M47.8 wired ONE fact kind — `armyStrength` — through contact-refresh + confidence decay +
deterministic noise into the strategic planner (campaign.ts's `belief-sensors`).

**Options.** (a) Wire the full designed surface (treasury/techLevel/villageState/intent facts,
per-fact sources, the shadow-brain scheduling) pre-1.0; (b) army strength only, the axis that
actually drives war/peace decisions; (c) keep AI omniscient and delete the module.

**Decision.** (b). Army strength is where belief error creates the designed emergent behaviour
(attacking a foe believed weak) and the difficulty lever (doc 07 §10's knowledge-decay row —
whose `knowledgeHalfLifeMultiplier` preset field now finally has a live consumer path).
Where no contact fact exists yet, the planner falls back to the pre-M47.8 behaviour (truth for
discovered rivals) rather than inventing ignorance the UI can't explain.

**Consequences.** Treasury/tech/village-state facts and rumor/envoy sources remain "data-model
ready, unconsumed" — the same honestly-labelled state doc 14 OQ-6 chose for espionage. The
diplomacy panel's "Known for…" tags ship confidence-ungated (doc 07 §9 anticipated the caller
choosing its own threshold); gating them behind observed evidence is 1.x polish.

---

## ADR-3 — Retrospective: "harness-first, integrate later" (M19–M46)

**Context.** Recorded so the lesson survives the people who learned it. From M19 to M46, every
AI/war/depth system was verified in a standalone harness (`composeMultiKingdom` — flat synthetic
terrain, one village per kingdom, no saves, no victory) while the playable composition stayed
frozen "for golden-fixture safety." Each deferral was individually documented and locally
reasonable; their SUM was the M47.5 audit's central finding — a shipped game missing its own
unique selling proposition, and balance findings (M46's collapse) discovered years of milestones
after the code that caused them.

**Decision (already enacted by R1, recorded here).** One composition (`composeCampaign`) is the
product AND the harness substrate; the wrapper pins historical test conditions as explicit
opt-outs. Golden fixtures are re-recorded intentionally per milestone — the policy that always
existed and should have been trusted from M19.

**Consequences / the rule going forward.** A gameplay milestone's Definition of Done includes
composition into the SHIPPING game and a player-reachable surface, not only harness verification
(doc 12 R1's Phase 7-INT wording is binding). The M47.8 matrix demonstrated the cost of the old
way concretely: three shipping-composition defects (no discovery, nameplate-fed starvation, a
degenerate victory race) were invisible to every flat-terrain test and surfaced within MINUTES
of running the real thing.

---

## ADR-4 — ACCEPTED (ratified 2026-07-15, with amendments; defeat outcome carved out): Campaign castle-defence layer

**Status: ACCEPTED (2026-07-15), by the project owner, in the amended shape:** archetype
templates over genuine AI planning (§1) · assault-phase-only replacement preserving GDD §8 siege
pacing (§2) · capital-only defence, "capital death = kingdom death" (§6) · stale-snapshot intel
(§4) · terrain-bearing defence maps with geography-priced origins (§5) · loot obeys `capOf` with
excess burned (§3). **Carved out of this ratification: the defeat-outcome question
(vassalage-first vs. permadeath, §3)** — recorded as doc 14 OQ-11, owned by the project owner,
and explicitly NOT settled by this record; §3's recommendation on it was advisory input only.
*(OQ-11 was subsequently CLOSED the same day: the owner accepted the advisory input —
vassalage-first, permadeath as the ironman opt-in. See doc 14 OQ-11's decision record.)*
Ratification charters Phase 8 (doc 12 R2, post-1.0) and reopens OQ-9 IMMEDIATELY — the capital
rule touches 1.0-era state and saves, not just Phase 8 (doc 14, OQ-9 reopening delta). No
implementation code is chartered before Phase 8 **by this ADR**; **1.0 ships the existing
castle/siege stack unchanged.** *(Update 2026-07-16: OQ-9's pre-M48 item is resolved — the
existing runtime kingdom→capital binding will be persisted before M48, chartered by the OQ-9
record as a 1.0 DEFECT FIX against the M47.6 save→load→resume objective, not as ADR-4 scope: a
capture-and-recapture history makes the on-load re-derivation disagree with the runtime binding.
Pre-section saves fall back to derivation and may snap once on first load — accepted, recorded
in OQ-9. The full capital stamp — ECS component, UI crown marker, capital rules — remains
declined for 1.0 and lands in Phase 8.)* The body below is the design spike's assessment,
preserved as written.

**The proposal (as received).** A Campaign-only second spatial layer per kingdom: a ~100×100
defence map (keep at centre, generated once from a stable seed, persisted), on which the player
places walls/towers and positions garrison units. Military hiring stays on the village interface.
Sieges auto-resolve spatially: the attacker previews the defender's layout, picks one origin
(left/right/top/bottom), and the army walks toward the keep through structures and defenders;
reaching the keep above a points threshold destroys the settlement and transfers stored goods and
gold. Garrison draws from the same soldier pool as armies; defensive structures cost main-economy
resources under existing storage rules. Losing your kingdom is permadeath — player and AI alike.

**Headline verdict.** The layer itself is buildable on this architecture and is the honest
realization of Vision USP-4 ("castle-craft that matters") — the current enclosure ring is
mechanically real but shallow. But the proposal as written **collides with four shipped systems**
(the M28/M29 castle/siege stack it silently replaces, multi-village kingdoms, capture-based
conquest, and OQ-9's deliberate defeat design), and it is a phase of work, not a milestone. This
record proposes an amended shape that keeps the layer's core idea and resolves the collisions,
and places it post-1.0.

---

### §1. AI defence — templates, not planning (assessed first; it is NOT the largest cost)

Every AI kingdom needs a persisted defence layer and a credible layout on it. Three options:

- **(a) Genuine planning** — the AI evaluates candidate layouts by scoring them against the siege
  resolver (build a layout, simulate approaches, keep the best), sequenced under economy
  constraints. This is a layout optimizer whose inner loop is a full spatial sim ×4 origins,
  re-run as the economy affords each next structure. Cost: 2–3 milestones of AI work plus a
  permanent harness/perf burden — for output the player only ever sees as a static preview when
  attacking. Risk R1 (AI competence) at its worst.
- **(b) Procedural archetype templates** — exactly what doc 07 §5 already designed and M30
  explicitly deferred (`planCastleRing` is the admitted v1 stub of "motte / concentric /
  ridge-line templates adapted to local terrain"). A template is content data (Mod Zero, OQ-3
  DSL-only): a parameterized skeleton stamped onto the kingdom's generated defence terrain by a
  deterministic adaptor (snap to buildable tiles, thicken toward the origins the terrain leaves
  open), then built INCREMENTALLY through the existing build-queue discipline as the economy
  affords it — so a young kingdom has a palisade line and a rich one a concentric castle, with
  personality picking the archetype and the military plan picking the spend rate.
- **(c) Fixed stamped layouts** — templates without terrain adaptation or incremental growth.
  Cheapest, but every kingdom's castle is identical-at-a-tier and ignores its own map; scouting
  one teaches you all of them.

**Recommendation: (b).** It reuses the shipped needs-evaluator/build-command discipline
(`ai/manager.ts`, `ai/military.ts`), it is content-authorable and moddable, and it is the design
doc's own answer. Garrison assignment is a plan-driven fraction of the soldier pool posted to
template-designated anchor tiles (gate, towers, keep) — no spatial reasoning needed. Estimated
cost: ~1 milestone including template content, vs. 3+ for (a), and the delta in player-visible
quality is small because AI layouts are consumed as previews and resolution inputs, not watched
being built. Genuine planning can be a post-ship difficulty tier if the harness ever shows
templates are exploitable to the point of trivializing war.

### §2. Headless spatial resolution

**Execution model.** Resolution is a pure function, invoked from a command handler exactly like
`battle.autoResolve` runs `resolveSubRound` in a tight loop today:

- **Grid & pathing:** integer BFS/flow-field from the chosen origin edge toward the keep over the
  100×100 grid; walls impassable, gates/walls attackable at contact, towers project ranged
  attrition over a radius. All tie-breaks by tile index — no float ordering. 10k tiles is trivial;
  the whole resolution is sub-millisecond-to-milliseconds, safely inside one command dispatch.
- **Engagement math:** reuse combat.ts's morale-as-HP sub-round math (attack/defense aggregates,
  rout thresholds, casualty fraction) for unit-vs-unit contacts, and siege.ts's
  attack/armor-vs-`Fortification.hp` math for structure attacks. One combat vocabulary, one
  balance surface — a parallel damage model would fork GDD §8's parity guarantee.
- **Points threshold:** attacker strength = Σ surviving `count × stats.attack` (the same aggregate
  bombardment already uses); the keep's threshold = a `defense.holdStrength` field on the keep
  def (content, moddable), scaled by keep tier. Reaching the keep tile-adjacent with strength ≥
  threshold destroys the settlement; below it, the assault is repulsed with its casualties kept.
- **Determinism:** no conflict with the existing sim — the resolver draws from the command
  handler's named PRNG fork, defence-layer entities live in the same World (hashed like
  everything else), and the layer map is regenerated from its persisted seed. Two flags: (i) a
  worldgen-pipeline change would silently re-roll persisted layouts — the save must carry a
  defence-worldgen version stamp and fall back to stored tiles on mismatch; (ii) OQ-10's f64
  sentinel applies — keep path costs and tower-range checks in integers.
- **Instant vs. playback:** resolve INSTANTLY, but have the resolver emit a compact deterministic
  trace (wave positions, contacts, breaches, per-step losses). The UI replays the trace as
  presentation-only animation — the battle-report pattern M47.7 already established, at spatial
  fidelity. Playback-as-simulation (resolving over live ticks) is rejected: it would hold the
  whole kernel's pacing hostage to a battle the player cannot influence anyway.

**Design conflict flagged (the biggest one in the proposal):** as specced — preview, commit,
instant resolution — this DELETES siege pacing. GDD §8 is explicit that starving a castle takes
seasons and storming is a bloody choice among encircle/bombard/starve, and all of that shipped at
M29. **Amendment: the spatial resolution replaces the ASSAULT PHASE of the existing siege, not
the siege.** Encirclement, starvation countdown, sorties, and lifting stay exactly as shipped on
the world map; "commit the assault" is where the defence layer takes over from today's
`siege.assault` flat-resolver call. This keeps GDD §8 intact, keeps `ai/military.ts`'s tactical
policy shape, and — decisively — makes §3's warning problem solve itself.

### §3. Loss condition & world attrition

**World attrition.** With permanent elimination and AI-vs-AI wars, kingdom count is monotonically
decreasing; a long campaign trends toward an empty map. Verdict against the vision: partially
acceptable — campaigns are a 10–30 hour arc that ENDS (GDD §16; conquest victory requires
elimination), so attrition IS the designed endgame pressure. What breaks "one ruler among many"
is mid-game hollowing: rivals eliminated in year 8 of 30 leave a dead world for the remaining 22.
Options: (i) heirs/succession — contradicts the proposal's own "destroyed kingdom removes that
lord" and inherits nothing (the settlement is gone); (ii) **new lords rise** — after a cooldown,
a fresh lord (seeded personality, M36 archetypes) founds a claim on or near the vacant land using
the existing settlers/fair-placement machinery, with risings suppressed once any kingdom crosses
a victory-approaching threshold so conquest remains winnable; (iii) player-respawn — rejected
outright (it deletes the meaning of defeat); (iv) accept attrition bare. **Recommendation: (ii)**,
plus the already-shipped capitulation path (below) making total destruction the exception rather
than the default war outcome. Cost is modest — founding, placement, and personality assignment
all exist; the new part is the trigger and a "new banner rises" event.

**Player agency before death.** Under the §2 amendment this is structural, not bolted-on. The
kill chain is: war declaration (M31 casus belli, a notification today) → enemy army movement
visible under fog/scouting (M22) → `siege.begun` at your capital — a blocking, auto-pausing
notification (the pause-on-blocking-events mechanism is already in the app) → days-to-seasons of
encirclement during which the player can recall field armies (`army.moveTo`), recruit into the
garrison, sortie (`siege.sortie`), or sue for peace/offer vassalage (M35) → only then can the
attacker commit the assault. A run ending "from an attack the player neither foresaw nor
influenced" requires ignoring three escalating notices across multiple in-game days at the
current 24s/game-day pace. This sequencing is part of the feature's acceptance criteria, not
polish. One rule to add: an assault against a player capital that has never been previewed by the
player (no defence layer opened) still resolves — but the incoming-attack notice must deep-link
to the defence view, so the layer is discoverable before it is fatal.

*Ratification note (2026-07-15): the permadeath-verdict paragraph below was EXCLUDED from ADR-4's
acceptance — it is the spike's advisory assessment, recorded as doc 14 OQ-11 and owned by the
project owner. Update, same day: OQ-11 was CLOSED by the owner accepting this advisory input —
vassalage-first, permadeath as the ironman opt-in (doc 14 OQ-11's decision record is the
authoritative wording).*

**Permadeath verdict — stated plainly:** permadeath as the SOLE defeat outcome does not fit this
game, and OQ-9 already litigated why: the design deliberately chose last-village defeat softened
by capitulation/vassalage so that hopeless positions end in submission, not annihilation. A
30-hour progression run ending on one auto-resolved event — however well-telegraphed — converts
long-term investment into loss aversion (players will save-scum, which ironman then punishes).
**Recommendation:** defeat-by-siege first offers the shipped vassalage path (survive, diminished,
as a vassal — the run continues under a new political reality); refusal or an attacker who wants
blood makes it destruction and death. Permadeath-always ships as the existing `ironman` sandbox
flag, opt-in. Same rules for AI lords: capitulated AI kingdoms persist as vassals (feeding
diplomacy), destroyed ones are removed — which also throttles §3's attrition rate for free.

**Loot.** Gold: treasuries are uncapped ledgers — transfers whole, as a labelled ledger event
(M13's conservation property tests demand explicit movements). Goods: the attacker receives into
the capital's stockpile under `capOf` (BASE_STORAGE + granary/storehouse capacity ∧ player stock
limits) — existing rules, no exemption. Excess: converting to gold at a plunder rate is rejected
(it makes sacking a liquidity exploit that bypasses storage as a meaningful constraint);
**recommendation: excess is torched with the settlement** — reported in the battle summary
("carried off 400 grain; burned 900 more") so the loss is legible, thematic, and creates a real
incentive to build storage before campaigning. Loser side: everything not carried is destroyed
with the settlement — no ghost stockpiles.

### §4. Intel

Full free preview is wrong on three counts: it deletes any value scouting could add, it reads as
surveillance (the AI staring at your castle in real time), and it makes §5's weakest-side
min-maxing costless. Full scouting-gated ignorance is also wrong: attacking blind into an
auto-resolver feels like a slot machine. **Recommendation — split what is physically visible from
what is not:** structures (walls, towers, keep) preview as a snapshot AS OF the attacker's last
scouting contact — the M22 fog machinery already tracks reveal events; the layer just versions
its layout and serves the stale copy. Garrison strength is NEVER shown as truth: it comes through
the ADR-2 `armyStrength` belief (contact-refreshed, confidence-decayed, deterministically noisy) —
which makes this feature the knowledge model's second real consumer, exactly the direction ADR-2
pointed. The asymmetry resolves symmetrically: AI attackers consume the same fog queries against
the player's layout (they already sense through `FogRegistry`), so a player who keeps enemy
scouts out genuinely hides their walls. v1 floor if the snapshot plumbing slips: live structures
+ believed garrison — acceptable, but the stale-snapshot version is the design intent.

### §5. Four origins

With four origins, full information, and featureless ground, the dominant strategy is: attacker
hits the cheapest side, so the defender equalizes all four sides — every castle converges on a
symmetric ring, which is the existing `planCastleRing` with more steps. Two levers rescue it,
and both should be v1, not polish:

- **Terrain on the defence map.** The 100×100 map must inherit real local features from the
  kingdom's world-map site (river through the east half, rock outcrop, marsh) via the seeded
  worldgen pipeline at local scale. Unequal approaches make asymmetric investment optimal —
  the map, not the player, breaks the symmetry. A featureless defence map makes this whole layer
  a worse version of itself; treat terrain variety as load-bearing.
- **Origins priced by geography.** The origin is not a free menu: the besieging army physically
  arrives from a world-map direction; assaulting from any other origin costs a deterministic
  strength penalty (repositioning around a defended perimeter). Defenders then rationally fortify
  toward their actual borders and threats — layout decisions become geopolitical, which is
  exactly the texture a kingdom game wants.

With both levers, four origins is enough; more origins would only dilute wall-coverage decisions.
Assessment: interesting, conditional on terrain — flag it as the feature's fun-critical risk.

### §6. ECS / architecture fit

Supported, with specific work. The store and kernel need nothing structural: one `World` per
kernel is the rule, and the defence layer should live IN it — new SoA components
(`DefenceStructure` {kingdom, x, y, def-code}, reusing the existing `Fortification` HP component;
a cold component for garrison postings), so queries, declared-access enforcement, state hashing,
and persistence all come free. A second `World` would need its own hash/save/guard plumbing —
rejected. Required changes:

- **Placement ops:** `VillageOps` placement validation is bound to the world-map `TerrainAccessor`
  and village radii — not reusable as-is. A small parallel `DefenceOps` (bounds, occupancy,
  terrain-tag check against the kingdom's local accessor, atomic cost reservation via the
  existing stockpile path) plus a `defence.build`/`defence.demolish`/`defence.post` command
  family. The reservation and rejection idioms copy over directly.
- **Defence terrain:** one ~100×100 `TerrainAccessor` per kingdom, generated from
  `hash(worldSeed, kingdomId)` through a local-scale worldgen profile; persisted as seed +
  pipeline-version stamp (tiles stored only on version mismatch, per §2).
- **Renderer:** the render core is deliberately pure and instantiable (`Camera2D`, chunk baking,
  tile fields) — a second scene is cheap. The app needs a view switch (world ↔ defence view),
  a layer tag on the snapshot `EntityRec` stream so the mirror can route entities to the right
  scene, and a defence-view build palette on the existing `PanelHost`.
- **Persistence:** new save sections through the shipped `SaveManager` section pattern +
  `afterLoad` derived rebuilds (coverage caches), same shape as `SiegeState.save/restore`.
- **Composition:** all new systems APPEND in `composeCampaign` — the kernel's PRNG-fork-by-name
  makes appending behaviour-neutral for existing systems' draws (ADR-3's wrapper survives) —
  but new hash sources mean golden fixtures re-record intentionally, per standing policy.
- **Deletions the proposal implies but does not state:** world-map wall/tower placement, the
  enclosure algorithm as the `isCastle` derivation, and `siege.setTarget`/bombard-vs-graph all
  become dead once the defence layer is the fortification surface. Two parallel fortification
  systems must not ship; the amended design retires the on-map defence graph and derives
  `isCastle` (and siege eligibility) from "has a defence layer with a standing keep."
- **Constraint conflict flagged:** "one kingdom per lord, no second settlements" is NOT current
  truth — kingdoms are multi-village since M15 and M47.8 made AI expansion real, and today's
  `siege.captured` TRANSFERS the village (`VillageOwner` flip; Conquest/Hegemony victory math is
  village-share-based). The amendment reads the constraint as "one CROWN per lord": the defence
  layer guards the CAPITAL only; non-capital villages keep the existing occupation/capture path
  (M47.8's `occupation.ts`); losing the capital — not the last village — becomes the
  kingdom-death condition, which is a deliberate change to OQ-9's last-village rule and must be
  re-recorded there if ratified *(done at ratification — doc 14, OQ-9 reopening delta,
  2026-07-15; OQ-9's pre-M48 item has since resolved, 2026-07-16: the runtime capital binding is
  persisted before M48 as a 1.0 defect fix, so Phase 8 inherits an authoritative persisted
  capital identity rather than a derived guess — pre-section saves re-derive and may snap once
  on first load, accepted)*. Destruction-not-capture of the capital changes victory bookkeeping
  (a destroyed capital leaves the map; captured villages still count for share).

### §7. Scope, risk, and placement — post-1.0, unambiguous

Honest estimate, at the granularity this roadmap uses: **5–6 milestones** — (1) defence-layer
core: per-kingdom map gen, components, DefenceOps, commands, persistence; (2) defence view:
renderer scene, build palette, garrison posting UI; (3) resolution engine + deterministic trace +
battle report/replay presentation; (4) AI archetype templates, incremental build, garrison
assignment; (5) loss/succession/loot/vassalage integration + new-lords-rising; (6) intel wiring +
a dedicated balance-matrix pass. That is a Phase, not a feature — comparable to M28–M30, which it
partially replaces.

What it destabilises: siege.ts's assault path and its tests; combat parity guarantees (a second
resolution surface must be held to the same auto-vs-observed consistency); victory.ts's defeat
and share math (capital-death rule, destroyed-not-captured capitals); `ai/military.ts` tactical
policy; every golden replay (accepted, intentional re-record); and M45–M47's freshly recertified
content-complete/balance/hardening state — which is the decisive point. The project is at M47.9;
M48's entry gate is Phase 7-INT complete, and ADR-3's hard-won rule is that a system is done only
when composed AND surfaced AND balanced on the real game. Inserting a phase-sized combat rework
now reopens M45 (new content), M46 (new balance surface), and M47 (new crash surface) — it is
precisely the "one more system before we ship" failure mode the M47.5 audit exists to prevent.

**Decision (ratified 2026-07-15).** Ship 1.0 on the existing castle/siege stack, unchanged. This
feature is chartered as the headline of a post-1.0 phase ("Phase 8 — The Castle", doc 12 R2,
M49–M54), in the amended shape: defence layer as the capital's fortification surface replacing
the on-map defence graph · spatial resolution as the siege's assault phase, instant with a
replayable trace · templated AI layouts per doc 07 §5 · stale-snapshot structure intel + believed
garrisons · terrain-differentiated maps with geography-priced origins · loot under `capOf` with
excess burned · new lords rising against attrition. The defeat outcome at a fallen capital was
carved out as doc 14 OQ-11 — the one part of §3 this ratification did not adopt — and was
subsequently decided by the owner the same day: vassalage-first, permadeath as the ironman
opt-in.
Ratification re-opens OQ-9 immediately (doc 14 delta — its groundwork decisions are pre-M48, not
gated behind Phase 8); GDD §7's rewrite and doc 07 §5's elevation to load-bearing content happen
at Phase 8 entry.

**Consequences.** 1.0's castle-craft remains the shallow-but-real enclosure system — marketing
must not promise the layer. The 1.x phase inherits clean seams: the combat resolver,
fog/knowledge model, save sections, and render core all extend rather than fork. The main cost
carried forward is temporary duplication of fortification concepts in docs until GDD §7 is
rewritten at Phase 8 entry.
