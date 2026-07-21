# Phase 8.1 — milestone prompts (M55–M61)

Each prompt is self-contained and states its own intended model on line 1, so the model can warn
you if you pasted it into the wrong one. Ratified scope is ADR-4 Amendment A1 option (C), doc 15;
plan is doc 12 Phase 8.1.

---

## M55 — Single siege path (vertical slice)

```
RUN THIS ON OPUS. If you are not Opus, tell me before starting so I can switch.

Crowns & Clay, branch phase-2-economy-kingdom. Implement M55 of Phase 8.1.

Read docs/design/12-roadmap.md "Phase 8.1 — One Castle" and docs/design/15-decision-records.md
"ADR-4 Amendment A1" before doing anything. A1 is RATIFIED as option (C); M55 is the vertical
slice that proves ONE siege-resolution path before any deletion breadth.

Work: siege.begin eligibility becomes "has a standing defence layer" only. Delete the legacy
breach-gated assault branch, siege.setTarget, the daily bombard-vs-Fortification, and the
breaches/targetBuilding fields. Ship the siege save v2->v3 migration (fields dropped; a saved
active siege of a layer-less castle is lifted by the migration and logged). Encirclement,
starvation, sortie and lift stay EXACTLY as shipped — ADR-4 §2's pacing amendment is untouched.

Done when: the full suite is green with the legacy path deleted; a siege v2 save migrates and
resumes hash-stable; and both directions work end-to-end in a real campaign — player besieges AI,
AI besieges player.

Discipline: this repo has golden-replay and save-corpus determinism contracts, so a wrong change
can bake itself into a re-recorded fixture and look green. STOP before running any re-record
command and WAIT for me — then walk the diff and give me a one-sentence explanation for every
change in it. If you cannot explain one in a sentence, say so plainly; that is the signal
something is wrong, not a formality. Commit this milestone alone. Do not start M56.

Model handoff — this is a HARD STOP, not a notification. The moment the design calls are settled
and only propagation, test-fixing and doc sweeps remain: STOP, summarise what is left in a few
lines, and WAIT for my reply. Do not carry on into the grind on Opus. Separately, STOP and WAIT
before running ANY fixture re-record command — I will put you back on Opus for that diff.
```

---

## M56 — Retire village-side fortification

```
RUN THIS ON SONNET. If you are not Sonnet, tell me — this milestone is deletion against a precise
list and doesn't need Opus.

Crowns & Clay, branch phase-2-economy-kingdom. Implement M56 of Phase 8.1. M55 must be committed
first.

Read docs/design/12-roadmap.md "Phase 8.1 — One Castle" and docs/design/15-decision-records.md
"ADR-4 Amendment A1" first. A1 is RATIFIED as option (C).

Work, mostly deletion: reject category 'castle' in village ops.place() and drop it from the build
catalog (policy, not leak-patching). Delete planCastleRing and ai/military.ts's castle-ring block.
Delete castles.ts's enclosure / defence-graph / isCastle derivation, re-homing the Fortification
component into the defence module. AiWarTarget.isCastle redefines to defence-layer eligibility.
Occupation drops its isCastle exemption (the layer hook stays). Delete castles.test.ts with its
mechanic and add rejection coverage.

NOTE: the Keep is recategorised castle->military in M57, not here. In M56 the keep is still
castle-category, so expect it to be rejected on the village map until M57 lands. Don't "fix" that.

Done when: a castle-category def is rejected by village placement for player AND AI issuers, and
in one campaign an AI both besieges a capital and occupies a non-capital.

Discipline: this repo has golden-replay and save-corpus determinism contracts, so a wrong change
can bake itself into a re-recorded fixture and look green. STOP before running any re-record
command and WAIT for me — then walk the diff and give me a one-sentence explanation for every
change in it. If you cannot explain one in a sentence, say so plainly; that is the signal
something is wrong, not a formality. Commit this milestone alone.

Escape valve — a HARD STOP, not a notification. If you hit a decision the docs don't already
settle: STOP, state the decision and the options you see, and WAIT for my reply. Do not improvise
it, do not pick the "obvious" one, and do not work around it. A judgment call made mid-grind is
exactly how a plan drifts from what was ratified.
```

---

## M57 — Keep-gated derived layers (the (C) core)

```
RUN THIS ON OPUS. If you are not Opus, tell me before starting so I can switch — this is the
hardest milestone in the phase.

Crowns & Clay, branch phase-2-economy-kingdom. Implement M57 of Phase 8.1 — the core of ratified
option (C). M55 and M56 must be committed first.

Read docs/design/12-roadmap.md "Phase 8.1 — One Castle" (the M57 row and the open-item paragraph)
and docs/design/15-decision-records.md "ADR-4 Amendment A1" — especially option (C) and the
"Saves & determinism" paragraph — before touching code.

Four pieces of work:
1. Re-key the defence layer from KINGDOM to VILLAGE: defenceMapSeed, DefenceStructure.kingdom,
   occupancyFor(k), the { k, seed, version, tiles }[] save section, AiDefenceOptions, and
   defence-genesis's kingdomCount loop. Ship the section migration: a shipped per-kingdom layer
   maps onto that kingdom's CAPITAL village, and the capital's cost-free genesis keep is preserved
   so no existing save loses its defences.
2. Recategorise base:building.keep from 'castle' to 'military' so M56's placement guard needs no
   allowlist. The Keep becomes a normal village-map building; its requires.villageTier 2 gate,
   cost, storage and garrisonCap already exist and stay.
3. Generalise defence-genesis from "every kingdom has a keep" to "every keep-bearing village has
   its derived template materialised", keeping it idempotent-by-presence — that property is what
   makes tier-up spawn only new entries while healing nothing and duplicating nothing.
4. Derived templates as CONTENT, additive by tier, with a validator enforcing additivity. Plus one
   defence SettlementNeed proposing the Keep when a settlement is threatened, in the shape of
   foodNeed/housingNeed, feeding the existing chooseBuildTarget — it replaces planCastleRing.

Done when: building a Keep in a non-capital village materialises its layer and makes that village
assault-resolved instead of occupation-flipped; a tier-up spawns only the NEW template entries,
healing nothing and duplicating nothing; and a Phase-8 save migrates onto its capital with
defences intact.

Keep this straight: capital status stays POLITICAL (M53 annexation), never military. The
occupation split is garrison-based, not walls-based — an undefended village still flips by
countdown even with a Keep.

Discipline: this repo has golden-replay and save-corpus determinism contracts, so a wrong change
can bake itself into a re-recorded fixture and look green. STOP before running any re-record
command and WAIT for me — then walk the diff and give me a one-sentence explanation for every
change in it. If you cannot explain one in a sentence, say so plainly; that is the signal
something is wrong, not a formality. Commit this milestone alone.

Model handoff — this is a HARD STOP, not a notification. The moment the design calls are settled
and only propagation, test-fixing and doc sweeps remain: STOP, summarise what is left in a few
lines, and WAIT for my reply. Do not carry on into the grind on Opus. Separately, STOP and WAIT
before running ANY fixture re-record command — I will put you back on Opus for that diff.
```

---

## M58 — Keep-panel repair

```
RUN THIS ON SONNET. If you are not Sonnet, tell me — the formula, the three rules and the state
shape are all already specified, so this is execution.

Crowns & Clay, branch phase-2-economy-kingdom. Implement M58 of Phase 8.1. M57 must be committed
first.

Read the M58 row in docs/design/12-roadmap.md "Phase 8.1 — One Castle" first.

This closes a PRE-EXISTING M51 gap: assault.ts writes damage into Fortification.hp and never
despawns the structure, and nothing anywhere restores hp — so a capital that survives three sieges
is permanently a ruin.

Work: a Repair action on the Keep's village panel. Cost is def.cost x (1 - hp/maxHp) summed over
the village's structures — no repair-cost table, the def's own build cost IS the repair cost.
Three rules are load-bearing:
- BLOCKED while a siege is active on that village (otherwise a stone-rich defender out-repairs the
  bombardment and is unbreakable — this is the one that becomes an exploit if missed).
- Paid from the VILLAGE's own stores, not the kingdom's.
- Mirrored in the M52 AI daily defence manager, below its existing stone reserve, or AI castles
  decay permanently across a long campaign while the player's do not.

Shape: the action commits stone immediately and sets ONE field per village (repairingUntil), so
the strike-again-before-they-recover window survives. Don't make it instant.

Done when: a damaged layer returns to full only after the window elapses; repair is refused during
an active siege; and an AI castle damaged across two wars gets repaired without player input.

Discipline: this repo has golden-replay and save-corpus determinism contracts, so a wrong change
can bake itself into a re-recorded fixture and look green. STOP before running any re-record
command and WAIT for me — then walk the diff and give me a one-sentence explanation for every
change in it. If you cannot explain one in a sentence, say so plainly; that is the signal
something is wrong, not a formality. Commit this milestone alone.

Escape valve — a HARD STOP, not a notification. If you hit a decision the docs don't already
settle: STOP, state the decision and the options you see, and WAIT for my reply. Do not improvise
it, do not pick the "obvious" one, and do not work around it. A judgment call made mid-grind is
exactly how a plan drifts from what was ratified.
```

---

## M59 — Footprints, readability & zoom

```
RUN THIS ON SONNET, except for the blocking pre-work below. That pre-work is an Opus decision:
STOP before it and WAIT for me to switch you, rather than deciding it yourself.

Crowns & Clay, branch phase-2-economy-kingdom. Implement M59 of Phase 8.1. M57 must be committed
first.

Read the M59 row in docs/design/12-roadmap.md plus its THREE detail blocks ("sizes, and why they
are not free parameters", "hp must move with footprint", "the gatehouse needs a role") and the
"Phase 8.1 open item" paragraph. The detail blocks contain the sizes, the hp table and the traps —
follow them rather than re-deriving.

BLOCKING PRE-WORK (this is the Opus part) — a HARD STOP: resolve the open item first, and if you
are still on Sonnet, STOP and WAIT for me to switch you before deciding it. Under (C) the Keep exists
at two scales — a 2x2 village-map building where cost and the tier gate live, and a substantial
defence-map structure — but def.footprint is one field on one def. Resolve as either a separate
defence-map def spawned by the derivation, or an optional second footprint field. Do not start the
sizing until this is decided.

Then: footprints as CONTENT values (Keep 7x7, Tower 3x3, Gatehouse 3x2 with a 2x3 orientation
twin, Wall stays 1x1), hp re-scaled per frontage tile per the table, tile scale as config. Give
the gatehouse an actual role: toughness-aware pickWallTarget, garrisonCap 8, and gatehouse entries
on each wall face of all three templates. Readability: ground visible around structures, keep drawn
as a distinct structure not a flat block, wall segments joined. Zoom to ~3x tile scale with a
viewport offset and pan.

Two traps already diagnosed, don't rediscover them: (1) placement is ORIGIN-anchored, so any tower
above 1x1 collides with its own wall ring and ai/defence.ts SKIPS occupied tiles rather than
failing — towers silently vanish unless you centre-anchor first. (2) The current click math is
proportional over the whole canvas and is correct only while the entire map is visible; zoom
requires tile-pixel arithmetic plus the viewport offset. The render side is ALREADY footprint-driven
(draw, hit-test and origin clamping all use w/h) — verify, don't rewrite.

Done when: placement, hit-test and draw agree at multi-tile footprints AND at scale; a click at any
pan offset resolves to the tile under the cursor; footprint and scale values changed in content
alone shift behaviour with no code edit; every template still builds all its towers; and the
gatehouse is no longer dominated by the wall.

This is a BALANCE change in a rendering change's clothes — footprints are occupancy on the assault
flow field. Don't run the balance recert here; M61 does that.

Discipline: this repo has golden-replay and save-corpus determinism contracts, so a wrong change
can bake itself into a re-recorded fixture and look green. STOP before running any re-record
command and WAIT for me — then walk the diff and give me a one-sentence explanation for every
change in it. If you cannot explain one in a sentence, say so plainly; that is the signal
something is wrong, not a formality. Commit this milestone alone.
```

---

## M60 — Legacy saves & corpus

```
RUN THIS ON OPUS. If you are not Opus, tell me before starting so I can switch — migration
correctness is the silent-failure case this repo is most vulnerable to.

Crowns & Clay, branch phase-2-economy-kingdom. Implement M60 of Phase 8.1. M55-M59 must all be
committed first — M60 deliberately follows every behaviour change so it absorbs them all at once.

Read the M60 row in docs/design/12-roadmap.md and the "Saves & determinism" paragraph of ADR-4
Amendment A1 in docs/design/15-decision-records.md first.

Work: M28-era saves must hydrate unchanged. Their standing wall/gate/tower/keep buildings load as
INERT ordinary buildings — occupancy-blocking, demolishable, no graph, no siege meaning
("grandfathered ruins") — and previously-enclosed villages become occupiable. Both are accepted
one-time behaviour snaps, same class as OQ-9's re-derivation snap. VillageCore.isCastle stays in
the schema, deprecated and never set true again. Add an M28-era fixture save to the corpus and run
a torture pass.

Also absorb M59's fallout: raising a footprint changes what an ALREADY-SAVED structure occupies
when afterLoad rebuilds occupancy from defs, so previously-legal neighbours can now overlap. That
needs a load-time reconciliation rule — decide it and implement it here.

Done when: an M28-era save loads and resumes hash-stable with its walls standing but inert, and
the corpus is green including the new entry.

Discipline: this repo has golden-replay and save-corpus determinism contracts, so a wrong change
can bake itself into a re-recorded fixture and look green. STOP before running any re-record
command and WAIT for me — then walk the diff and give me a one-sentence explanation for every
change in it. If you cannot explain one in a sentence, say so plainly; that is the signal
something is wrong, not a formality. Commit this milestone alone.

A wrong migration produces a GREEN re-recorded fixture — that is the whole hazard here.

Model handoff — this is a HARD STOP, not a notification. The moment the design calls are settled
and only propagation, test-fixing and doc sweeps remain: STOP, summarise what is left in a few
lines, and WAIT for my reply. Do not carry on into the grind on Opus. Separately, STOP and WAIT
before running ANY fixture re-record command — I will put you back on Opus for that diff.

Stay on Opus for the migration itself and for every fixture diff; the Sonnet stretch is
mechanical test-fixing only.
```

---

## M61 — Docs & balance recert (closes the phase)

```
RUN THIS ON OPUS. If you are not Opus, tell me before starting so I can switch — reading balance
output is judgment, not execution.

Crowns & Clay, branch phase-2-economy-kingdom. Implement M61 of Phase 8.1 — the closing milestone.
M55-M60 must all be committed first.

Read the M61 row in docs/design/12-roadmap.md, ADR-4 Amendment A1 in
docs/design/15-decision-records.md, and the R3 entry in doc 12's Change Record first.

Docs: rewrite GDD §7 for a single castle system, remove doc 06 §4's defenceGraph/isCastle, and
write doc 07 §5's delta. A1's "shipped delta" wording lands here, not earlier. Update the README
status table if it claims anything M28-shaped.

Balance: re-run the bench-balance matrix. Two things moved and both need reading, not just
running — village-map wall rings are gone entirely (AI fortification is now derived from keeps),
and M59 re-scaled every structure's hp per frontage tile while changing what blocks the assault
flow field.

Done when: balance bands hold, siege/capture cadence is no worse than the war-cadence-part-7
baseline, and Gate P8.1 is recorded in doc 12 the way Gate P8 was.

If the balance numbers do NOT hold, do not tune silently to make them pass — report what moved and
in which direction, and let me decide. A quietly-tuned band is worse than a failed gate.

Discipline: this repo has golden-replay and save-corpus determinism contracts, so a wrong change
can bake itself into a re-recorded fixture and look green. STOP before running any re-record
command and WAIT for me — then walk the diff and give me a one-sentence explanation for every
change in it. If you cannot explain one in a sentence, say so plainly; that is the signal
something is wrong, not a formality. Commit this milestone alone. Then record the phase as closed.

Model handoff — this is a HARD STOP, not a notification. The moment the design calls are settled
and only propagation, test-fixing and doc sweeps remain: STOP, summarise what is left in a few
lines, and WAIT for my reply. Do not carry on into the grind on Opus. Separately, STOP and WAIT
before running ANY fixture re-record command — I will put you back on Opus for that diff.

Stay on Opus for the balance reading; the doc rewrites are the grind you hand off.
```
