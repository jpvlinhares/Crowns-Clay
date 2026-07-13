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
