# CROWNS & CLAY — Milestone 1: Architecture & Design Freeze

**Status:** DRAFT FOR FREEZE · **Version:** 1.0 · **Scope:** Design only — no implementation

*Crowns & Clay* (working title) is a single-player, browser-based, offline-capable medieval kingdom
management and grand-strategy game with fully simulated AI rival kingdoms, deep moddability, and a
data-driven engine. This documentation set is the authoritative reference for all future development.

## Document Index

| # | Document | Contents |
|---|----------|----------|
| 01 | [Vision Document](01-vision.md) | Core loop, player experience, philosophy, USPs, goals, constraints, success criteria |
| 02 | [Game Design Document](02-gdd.md) | Every gameplay system: purpose, interactions, mechanics, dependencies, balancing |
| 03 | [Technical Design Document](03-tdd.md) | Architecture, subsystems, data flow, game loop, pipelines, testing |
| 04 | [Technology Stack](04-tech-stack.md) | Candidate stack evaluation, pros/cons, final recommendation |
| 05 | [Engine Architecture](05-engine-architecture.md) | Subsystem design and inter-subsystem communication |
| 06 | [Data Model](06-data-model.md) | Implementation-independent schemas for all major entities |
| 07 | [AI Design Document](07-ai-design.md) | Strategic/tactical/economic AI, personality, memory, reputation, planning |
| 08 | [World Simulation Design](08-world-simulation.md) | Tick model, seasons, update frequencies, simulation priorities |
| 09 | [Modding Framework](09-modding.md) | Data-driven content, mod loading, overrides, versioning |
| 10 | [Asset Pipeline](10-asset-pipeline.md) | Sprites, animation, audio, fonts, localization, placeholder workflow |
| 11 | [Performance Targets](11-performance-targets.md) | Measurable goals and how the architecture supports them |
| 12 | [Development Roadmap](12-roadmap.md) | 48 milestones from empty repo to feature-complete game |
| 13 | [Risk Assessment](13-risks.md) | Largest technical risks and mitigation strategies |
| 14 | [Open Design Questions](14-open-questions.md) | Unresolved choices, trade-offs, recommendations |

## Reading Order

- **Everyone:** 01 → 02 (skim) → 14
- **Engineers:** 03 → 04 → 05 → 06 → 08 → 11 → 09
- **AI programmers:** 07 → 08 → 06
- **Producers:** 01 → 12 → 13

## Cross-Referencing Conventions

- Systems are referenced as `GDD §n`, `TDD §n`, etc.
- All entity names in `code style` refer to schemas in the Data Model (doc 06).
- Every simulation rate/limit quoted in any document must match doc 08 (simulation) and doc 11 (targets); those two documents are the source of truth for numbers.
- Anything marked **[OQ-n]** is an open question tracked in doc 14 and must be resolved before the milestone that consumes it (see roadmap).

## Freeze Rules

After freeze, changes to these documents require a written change proposal noting: affected documents, affected roadmap milestones, and risk impact. The GDD and TDD may not diverge silently.
