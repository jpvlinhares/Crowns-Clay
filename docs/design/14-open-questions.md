# 14 — Open Design Questions

Deliberately unresolved decisions. Each lists trade-offs, a recommendation, and a **due milestone**
(decision must be ratified before that milestone begins — doc 12). Recommendations are inputs, not
pre-decisions.

---

### OQ-1 — Direct vs. indirect control granularity (Due: M12)
Can the player directly assign an individual villager to a job/home, or only set priorities/policies
(pure indirect rule)?
**Trade-offs:** direct control aids tutorial clarity and player agency but invites micromanagement,
undermines the cohort model's authority, and doubles job-solver complexity; pure indirect keeps
scale and AI symmetry clean but can feel unresponsive in tiny early villages.
**Recommendation:** indirect-only, with per-*building* priority and worker caps as the granularity
floor (already in GDD §3/§4); revisit only if M12/M18 playtests show early-game frustration.

### OQ-2 — Named individuals: sampled projections vs. persistent agents (Due: M12)
Are the ~30 visible villagers per village resampled projections of cohorts, or persistent lightweight
agents with continuity (homes, families, deaths mourned)?
**Trade-offs:** projections are cheap and keep cohorts authoritative but risk "fake people" moments
(a named villager vanishing); persistent agents deepen attachment (Vision pillar 1) at real memory/
save cost and dual-bookkeeping bug surface.
**Recommendation:** hybrid — persistent identity records for notables + event-touched villagers
(bounded pool ~50/village), pure projection for the rest; cohort math stays authoritative.

### OQ-3 — Mod scripting: sandboxed JS vs. declarative-DSL-only at 1.0 (Due: M28) — CHECKPOINT PASSED
**Trade-offs:** scripts unlock total conversions and community creativity but carry sandbox
security/stability burden (Risk R9), API-freeze obligations, and support load; DSL-only is safe and
cheap but caps mod ambition, and bolting scripts on later risks API churn.
**Recommendation:** 1.0 ships DSL-only *if* Mod Zero authoring proves ≥90% expressiveness (measured
during M32–M33 content work); otherwise adopt QuickJS-in-WASM sandbox at M39. Decide with data.
**M28 due-date check:** every content kind shipped through M28 (terrain, resources, buildings,
edicts, units — 12 base `defs/` files, doc 09 §1) has been expressed entirely in the JSON5/DSL
layer; zero scripting has been needed, including for combat, castles, and army mechanics that
"feel" script-shaped (soft counters, enclosure-driven `isCastle`). No `scripts/` runtime exists yet.
The formal ≥90% measurement is still M32–M33's job (content breadth: tech tree, events, characters
hasn't landed), so the decision stays DSL-first and open only in the sense of "not yet load-bearing
data" — not reopened.

### OQ-4 — Save↔mod reconciliation policy (Due: M39)
When a save's mod set differs from installed mods (missing, changed version, rebalanced defs): block,
best-effort load with report, or per-change interactive resolution?
**Trade-offs:** blocking is safe but brutal (browser context makes reinstalling exact versions hard);
best-effort risks corrupted campaigns and support noise; interactive resolution is ideal but costly.
**Recommendation:** best-effort with a mandatory reconciliation report + automatic pre-load backup
export; hard-block only on missing def *kinds* or failed referential integrity.

### OQ-5 — Frozen rivers passable in winter (Due: M26)
**Trade-offs:** pro — superb strategic texture (winter invasions, seasonal defence planning), cheap
to implement (season modifier on tile passability); con — invalidates river-based castle/village
defence for a quarter of the year, punishing players who can't read it coming, and complicates AI
threat appraisal.
**Recommendation:** adopt, gated by climate: only in "harsh" climate bands/settings, with explicit
UI forecast ("the river will freeze in ~2 weeks") so it is play-aroundable information, not a gotcha.

### OQ-6 — Espionage system at 1.0 (Due: M32)
A spy/agent layer (steal tech, incite unrest, scout) was referenced as optional in GDD §9/§10.
**Trade-offs:** enriches the knowledge-model design (doc 07 §6 already supports intel as data) and
the Schemer personality; but it's a full extra system (UI, AI usage, balance) late in the plan —
classic R8 scope risk.
**Recommendation:** cut from 1.0; keep the knowledge model's `source: rumor|envoy` hooks so a 1.x
espionage module is purely additive. Chancellor office gets a passive "intelligence quality" bonus
as the 1.0 stand-in.

### OQ-7 — Battle interactivity ceiling (Due: M32, informed by M27)
Is the limited-orders battle layer (GDD §8) enough, or do playtests demand fuller tactical control
(unit-level micro) — or conversely, is even that too much and battles should be cinematic
auto-resolve only?
**Trade-offs:** more control deepens engagement but explodes UI/AI scope and violates the strategic
pacing pillar; pure auto-resolve is cheap and pace-true but discards castle-craft payoff visibility.
**Recommendation:** hold the designed middle (stance + 5-order vocabulary); ratify with M27 playtest
data before building battle UI polish in Phase 6.

### OQ-8 — Difficulty adjustable mid-campaign (Due: M32)
**Trade-offs:** adjustable respects player rescue ("this got too hard 20 hours in") but muddies
achievement/chronicle integrity and lets players ratchet around designed tension; locked preserves
integrity but abandons struggling players.
**Recommendation:** adjustable downward-only outside ironman, recorded in the chronicle ("difficulty
lowered, year 34"); ironman locks everything.

### OQ-9 — Defeat definition: last village vs. capital-and-heir (Due: M32)
**Trade-offs:** last-village is unambiguous but produces tedious mop-up endgames; capital+heir
(dynastic defeat) ends wars decisively and empowers the Character system, but adds rules players
must learn and edge cases (heirless by RNG).
**Recommendation:** last-village as the base rule, plus *capitulation mechanics* (AI offers/accepts
vassalage when hopeless) so mop-up rarely occurs in practice; revisit dynastic defeat as an optional
rule post-M34.
**M35 delta:** the capitulation mechanic is real now (`game/diplomacy.ts`'s `kingdom.proposeVassalage`,
`evaluateVassalageDeal`) — a kingdom losing badly enough (high war exhaustion against the proposer)
values submission over continued fighting, ending the underlying war outright. Deliberately NOT
wired to any defeat/victory condition yet (that's M37); this only proves the mechanism a
"mop-up rarely occurs" endgame needs.

### OQ-10 — Float determinism vs. fixed-point migration trigger (Due: M26)
Sim math is f64 under a strict policy (TDD §5). Define now the objective trigger for migrating hot
systems to integer fixed-point.
**Trade-offs:** fixed-point guarantees cross-engine identity but costs dev ergonomics and a risky
mid-project numeric migration; f64 is ergonomic and *likely* stable within JS engines, but "likely"
is not a guarantee across engine updates.
**Recommendation:** keep f64; the M5 cross-engine golden-replay CI is the sentinel. Trigger:
any reproducible cross-engine or cross-version hash divergence → migrate the diverging system(s)
(combat math and economy accumulators are pre-identified candidates) behind their existing module
boundaries.

---

## Decision Log Process

Each OQ is closed by a short written decision record (context, options, decision, consequences)
appended to this file and cross-referenced from the affected documents — keeping the design set
authoritative after freeze (doc 00 freeze rules).

---

## Decision Log

**DR-001 (ratified at design freeze):** All ten recommendations above are **accepted as written**
by the project owner. Binding consequences:

| OQ | Decision now in force |
|---|---|
| OQ-1 | Indirect control only; per-building priority & worker caps are the granularity floor |
| OQ-2 | Hybrid villagers: persistent identity for notables + event-touched pool (~50/village); cohorts authoritative |
| OQ-3 | DSL-first; scripting adopted at M39 only if Mod Zero expressiveness <90% (measured M32–M33) |
| OQ-4 | Best-effort save↔mod reconciliation + report + automatic pre-load backup; hard-block on integrity failure |
| OQ-5 | Frozen rivers passable, harsh-climate gated, with explicit freeze forecast UI |
| OQ-6 | Espionage cut from 1.0; knowledge-model hooks retained; Chancellor grants intelligence-quality bonus |
| OQ-7 | Battle interactivity fixed at stance + 5-order vocabulary; ratify with M27 playtest data |
| OQ-8 | Difficulty adjustable downward-only outside ironman, chronicled; ironman locks |
| OQ-9 | Last-village defeat + AI capitulation/vassalage mechanics; dynastic defeat deferred post-M34 |
| OQ-10 | f64 retained; cross-engine golden-replay CI is the sentinel; divergence triggers fixed-point migration of the diverging system |

Cross-references in docs 02, 07, 08, 09 remain valid; where a doc said "[OQ-n]", read the row above
as the resolved rule.
