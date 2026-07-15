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

**M39 due-date check — CLOSED, DSL-only ships at 1.0:** the formal measurement M28 deferred to
M32–M33 is in: 10 def kinds now exist (terrain, overlays, resources, buildings, edicts, units,
techs, events, traits, personalities — `packages/data/src/mods.ts`'s `TERRAIN_KINDS`), spanning
every content-breadth milestone through M38 (72 techs across 4 branches/3 eras, 18 events across
all 6 pools with a fuzzed Predicates & Effects DSL, character traits, 7 tuned AI personalities,
victory/difficulty tuning) — 100% expressed in JSON5/DSL, well clear of the ≥90% bar, and still zero
`scripts/` directory anywhere in the repo. Per the recommendation's own trigger ("adopt QuickJS-in-
WASM… otherwise"), the "otherwise" branch fires: **DSL-only is confirmed for 1.0.** No scripting
sandbox is built this milestone (or planned pre-1.0). §8's "script API v2" stays exactly what it
already was — a genuine POST-1.0 candidate, not a deferred M39 task.

### OQ-4 — Save↔mod reconciliation policy (Due: M39)
When a save's mod set differs from installed mods (missing, changed version, rebalanced defs): block,
best-effort load with report, or per-change interactive resolution?
**Trade-offs:** blocking is safe but brutal (browser context makes reinstalling exact versions hard);
best-effort risks corrupted campaigns and support noise; interactive resolution is ideal but costly.
**Recommendation:** best-effort with a mandatory reconciliation report + automatic pre-load backup
export; hard-block only on missing def *kinds* or failed referential integrity.

**M39 delta — CHECKPOINT PASSED:** the recommendation is implemented exactly as written.
`reconcileModManifest` (`packages/sim/src/persistence.ts`) is a pure comparison — never a gate —
between a save's embedded `modManifest` and the currently-installed set; `SaveManager.hydrate`
loads regardless of what it finds. The "hard-block" half was never a NEW mechanism to build: it's
the pre-existing content-validation fatal-error path (doc 09 §3) that already refuses to start a
campaign on a missing def kind or broken referential integrity, independent of save/mod
reconciliation entirely. The "automatic pre-load backup export" is real
(`packages/app/src/simPort.ts`'s `loadFromPayload`): the moment reconciliation finds anything
(`missing`/`versionChanged`/`contentChanged`), the untouched save payload downloads as a `.crown`
file before hydrate ever runs.

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
**M38 delta:** the presets themselves are real now (`ai/difficulty.ts`'s `DIFFICULTY_PRESETS`) —
Story/Fair/Hard/Brutal, chosen at composition time. Mid-campaign adjustment (the downward-only
rule, chronicle logging, ironman locking) stays a UI/save-flow concern this milestone doesn't
touch — presets are pure, static config here, not yet wired to a live "change difficulty" command.

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
**M37 delta — CHECKPOINT PASSED:** defeat is real now (`game/victory.ts`'s `victory-tracker`,
GDD §16): the last-village rule, exactly as recommended — a kingdom that founded at least one
village and now owns none is out. Dynastic (capital+heir) defeat stays the deferred OPTIONAL
rule this recommendation always said it'd be; nothing in M34's Character system or M37's tracker
forces it. Sandbox mode's independent `defeatEnabled` toggle (GDD §17) ships alongside it.

**ADR-4 ratification delta (2026-07-15) — REOPENED.** ADR-4 (doc 15, accepted with amendments)
makes the CAPITAL the defended-and-decisive settlement: Phase 8's defence layer guards the
capital only, and "capital death = kingdom death" replaces last-village as the kingdom-death
condition when that phase lands. This cannot be parked behind Phase 8, because "capital" is
barely real in the current codebase: it exists only as genesis bookkeeping — the kingdom→
first-village binding (`campaign.ts`'s `villageIndexByKingdom`, rebuilt from `VillageOwner` on
load and re-bound to the next-oldest village when the first is occupied), plus the
history-seeding reveal target. Nothing marks a capital in components, saves, victory math, or
the UI, and occupying a capital today is mechanically identical to occupying any other village.
**Decisions this needs, in order:**
1. *Pre-M48 (1.0) — RESOLVED (2026-07-16, project owner): Option A, minimal form.* The existing
   runtime kingdom→capital binding (`campaign.ts`'s `villageIndexByKingdom`) is PERSISTED before
   M48: a small save section (kingdom index → village index) restored in `afterLoad`, in the
   `SiegeState.save()/restore()` shape. **Chartered as a 1.0 DEFECT FIX, not new scope:** a
   divergence trace (2026-07-16) confirmed the runtime binding and the on-load re-derivation
   disagree across capture-and-recapture histories — the runtime rebind fires only when the
   bound capital is LOST and never resets on reconquest, while `afterLoad` re-derives
   "oldest still-owned village" — so a reload re-anchors the whole AI brain (construction/
   planner/research/events read their home village through this map, and the planner resumes
   from the re-derived village's stale `AiPlanState` slot, a hashed component) and can rename or
   flip the discovered-status of a rival in the diplomacy panel (`simPort.ts` names kingdoms by
   capital and fog-gates on it). That violates the M47.6 objective stated in `campaign.ts`'s own
   header: save→load→resume behaviourally identical to an uninterrupted run. Reachable in normal
   play (AI reconquest of a lost village is in-behaviour; any autosave after it triggers the
   divergence). No new ECS component and no new hash source — no state-hash change, no golden
   re-record. **Compatibility, explicitly accepted:** saves predating the new section fall back
   to today's derivation (oldest still-owned village), and any save already mid-divergence will
   re-derive — the capital SNAPS to the derived village on its first load under the fix. This
   one-time snap is accepted and recorded here rather than left implicit. The FULL stamp — an
   ECS component, a UI crown marker, capital rules — stays DECLINED for 1.0 and lands in
   Phase 8.
2. *Phase 8 entry:* ratify capital-death vs. last-village as the kingdom-death condition; define
   capital-capture semantics before the defence layer exists vs. after (today: owner flip + AI
   re-binding; under ADR-4: destruction); state the save-compatibility policy for 1.0 saves
   loaded under the new rule.
3. *With OQ-11 — since DECIDED (2026-07-15):* vassalage-first, permadeath as the ironman
   opt-in (see OQ-11's decision record below).

**Status:** items 1 and 3 resolved; item 2 is the sole remaining open piece of OQ-9 and the
sole open question gating Phase 8 entry.
**What depends on it:** `game/victory.ts` (defeat bookkeeping and the Conquest/Hegemony
village-share math once capitals can be DESTROYED rather than captured), `game/occupation.ts`
(whether a capital can be occupied like any village), diplomacy's capitulation/vassalage path
(what surrender protects), ADR-4's new-lords-rising trigger (fires on kingdom death), save
headers/migrations, and Phase 8's M53 loss-condition milestone, which cannot start until this
closes.

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

### OQ-11 — Defeat outcome when a capital falls: vassalage-first vs. permadeath (Owner: project owner · Due: Phase 8 entry, with OQ-9)
Raised by ADR-4 (doc 15) and EXPLICITLY EXCLUDED from its 2026-07-15 ratification: when a lord's
capital falls under Phase 8's defence layer, is the shipped capitulation/vassalage path offered
first (the run survives, diminished — OQ-9's original "mop-up rarely occurs" design), does the
lord die with the kingdom (permadeath, the proposal as received), or a mix (attacker's choice,
or permadeath only under the existing `ironman` sandbox flag)?
**Trade-offs:** vassalage-first preserves long-term progression and reuses shipped M35 mechanics,
but softens war's stakes; permadeath makes sieges genuinely terminal and matches the proposal's
intent, but ends a 10–30 h campaign on an auto-resolved event and invites save-scumming outside
ironman. The same choice governs AI lords, so it also sets Phase 8's world-attrition rate
(vassal kingdoms persist in the world; destroyed ones leave it).
**ADR-4's advisory input (not binding at ratification):** vassalage-first, with permadeath as
the ironman opt-in.
**Decision (2026-07-15, project owner) — CLOSED:** the advisory input is accepted as the rule.
A fallen capital offers the shipped capitulation/vassalage path FIRST — the lord (player or AI)
survives, diminished, as a vassal; per ADR-4 §3's mechanism, refusal by either side (the loser
declines submission, or the attacker wants blood) makes it destruction and death. Under the
`ironman` sandbox flag, a fallen capital ends the lord outright — permadeath is opt-in.
Sits outside DR-001 (which ratified OQ-1..10 only).
**Consequences:** M53 (loss & succession) implements vassalage-first as the default and
permadeath under ironman; the same rule governs AI lords, so Phase 8's world-attrition rate sits
in the softer band (vassal kingdoms persist in the world; only refused capitulations destroy a
kingdom) and new-lords-rising (ADR-4 §3) calibrates against that; OQ-9 becomes the only open
question gating Phase 8 entry.

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
| OQ-9 | Last-village defeat + AI capitulation/vassalage mechanics; dynastic defeat deferred post-M34 — **REOPENED 2026-07-15 by ADR-4 (see the OQ-9 delta above; rule unchanged for 1.0)** |
| OQ-10 | f64 retained; cross-engine golden-replay CI is the sentinel; divergence triggers fixed-point migration of the diverging system |

Cross-references in docs 02, 07, 08, 09 remain valid; where a doc said "[OQ-n]", read the row above
as the resolved rule.
