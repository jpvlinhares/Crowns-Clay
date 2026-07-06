# 01 — Vision Document

**Working title:** Crowns & Clay
**Genre:** Kingdom management / grand strategy, single-player, pausable real-time
**Platform:** Browser (desktop-first), fully offline-capable, installable as a PWA
**Comparables:** *Majesty* (indirect rule), *Banished* (economy), *Crusader Kings* (AI actors with personality), *RimWorld* (moddability, emergent stories), *Stronghold* (castles & sieges)

---

## 1. Premise

You are the ruler of one small kingdom on a procedurally generated continent shared with rival AI
kingdoms. You grow villages into a realm: manage the economy, raise armies, build castles, research
technologies, and negotiate — or fight — your neighbours. The AI kingdoms play the same game you do,
with the same rules, resources, and constraints.

## 2. Core Gameplay Loop

```
        ┌────────────────────────────────────────────────────┐
        │                                                    │
        ▼                                                    │
  OBSERVE the world ──► DECIDE priorities ──► ACT            │
  (map, reports,        (economy? military?   (build, tax,   │
   advisors, rumors)     tech? diplomacy?)     recruit,      │
                                               negotiate,    │
                                               research)     │
        ▲                                          │
        │                                          ▼
  CONSEQUENCES ◄── WORLD SIMULATES (seasons pass, AI kingdoms
  (growth, unrest,     act, economies shift, wars break out)
   opportunity, crisis)
```

- **Minute-to-minute:** queue buildings, adjust taxes/rations, position armies, respond to events.
- **Session-to-session:** complete a season/year of growth, finish a war, unlock a research tier.
- **Campaign arc:** from a single muddy village to a dominant realm, ~10–30 hours per map.

## 3. Target Player Experience

| Pillar | The player should feel… | Design consequence |
|---|---|---|
| **Stewardship** | "This kingdom is *mine*; its people are real." | Named villagers/notables, visible daily life, needs-driven population |
| **Consequence** | Every decision echoes: taxes, wars, betrayals. | Persistent AI memory & reputation (AI Doc §6–7) |
| **Legible depth** | Deep systems that are always explainable. | Every number inspectable via tooltips/ledgers; no hidden modifiers |
| **Living opponents** | Rivals feel like characters, not scripts. | Personality-driven, non-cheating (on default difficulty) AI |
| **Ownership of pace** | Never rushed; pausable, adjustable speed. | Pausable real-time with 1×/2×/4×/8× speeds |

**Target audience:** strategy/management players (Banished, RimWorld, CK, Anno audiences), age 13+,
comfortable with complexity, playing 30–120 minute sessions on desktop browsers.

## 4. Design Philosophy

1. **Simulation over script.** Behaviour emerges from systems and state, never from hard-coded story
   beats. Events are systemic triggers, not railroads.
2. **Same rules for AI and player.** Difficulty comes from AI skill and starting conditions, not
   invisible cheating (explicit, labelled bonuses only at high difficulty — GDD §14).
3. **Data-driven everything.** Every building, unit, tech, event, and personality is content data,
   not engine code. The base game is "Mod Zero" (Modding Doc §1).
4. **Legibility is a feature.** If the player can't discover *why* something happened, the system is
   incomplete.
5. **Determinism.** Given a seed and an input log, the simulation replays identically. This powers
   testing, debugging, save integrity, and future replay/multiplayer options (TDD §5).
6. **Playable early, playable always.** After the bootstrap milestones, the game must never be in an
   unplayable state for more than one milestone (Roadmap principles).

## 5. Unique Selling Points

1. **Truly simulated rival kingdoms** — AI opponents that manage economies, build castles, remember
   betrayals, and pursue personality-driven long-term plans under the same rules as the player.
2. **A full grand-strategy sim in the browser** — zero install, offline-capable, save files portable
   as a single file; runs on a mid-range laptop.
3. **Radical moddability** — 100% of content defined in human-readable data files; total-conversion
   mods possible without touching engine code.
4. **Castle-craft that matters** — player-designed fortifications interact mechanically with siege
   combat rather than being decoration.
5. **Deterministic, inspectable world** — shareable world seeds, reproducible histories, full ledger
   transparency.

## 6. Project Goals

| Goal | Measure |
|---|---|
| G1. Ship a feature-complete 1.0 per this design | All GDD systems implemented; roadmap M48 done |
| G2. Emergent-story engine | Playtesters unpromptedly recount AI-driven anecdotes |
| G3. Sustainable codebase | New content requires zero engine changes; new dev productive in <1 week |
| G4. Healthy mod ecosystem | ≥1 total-conversion mod feasible with docs alone |
| G5. Performance on modest hardware | Targets in doc 11 met on a 2020 mid-range laptop, Chrome/Firefox |

## 7. Project Constraints

- **Platform:** modern evergreen browsers (Chrome, Firefox, Edge, Safari ≥ last 2 major versions); no server dependency for gameplay; storage limited to browser quotas (Risk R6).
- **Team:** small team / long timeline; architecture must favour maintainability over micro-optimisation until profiling says otherwise.
- **Art:** 2D sprites only; placeholder-first pipeline (doc 10); no 3D.
- **Scope guards:** single-player only at 1.0 (determinism keeps multiplayer *possible*, not planned); no real-money features; English-first with localization architecture from day one.
- **Content rating:** stylised medieval violence; no gore, no explicit content.

## 8. Success Criteria (Milestone-1-testable at 1.0)

1. A new player reaches a stable, growing kingdom within 30 minutes unaided (tutorialised).
2. A full campaign (start → victory) is completable at every difficulty without crashes or soft-locks.
3. All performance targets (doc 11) pass on reference hardware in automated benchmark scenes.
4. Save → load → resave produces byte-identical simulation state (determinism check).
5. A sample mod (new building + unit + tech + event chain) installs and functions using only the modding docs.
6. Blind playtest: ≥70% of testers correctly attribute distinct personalities to at least two AI kingdoms.

## 9. Non-Goals (explicitly out of scope for 1.0)

Multiplayer; mobile-touch UI; 3D rendering; procedural narrative text generation; account systems,
cloud saves, telemetry beyond opt-in local diagnostics; console/native builds.
