# Crowns & Clay — 1.0.0-rc.1 (M48 release candidate)

*Cut 2026-07-16 from the unified campaign composition (doc 12, Phase 7-INT complete).*

Crowns & Clay is a browser-based medieval kingdom-management game with fully simulated AI
rivals: one deterministic simulation, the same rules for the player and every AI lord, playable
offline as a PWA. This release candidate is the build proposed to become 1.0 after the external
RC playtest (the M48 T objective).

## What's in 1.0

- **A living world:** seeded worldgen (heightmap → climate → biomes → rivers), fair multi-kingdom
  placement, fog of information and scouting, seasons, and a pausable real-time clock at 1×–8×.
- **The economy:** villages with placement-validated construction, 3-tier production chains,
  haulers/roads/logistics, spoilage, joy, multi-village founding via settler parties, and a
  kingdom layer (treasury, taxes, edicts, advisors) that reconciles to the coin.
- **War:** barracks-gated recruitment, army movement (hierarchical pathfinding) with supply and
  attrition, morale-driven field combat with auto-resolve parity, castles as enclosure-derived
  fortifications, phased sieges (encircle → bombard → assault or starve), village occupation,
  and war diplomacy (casus belli, exhaustion, peace deals, vassalage).
- **Rivals with character:** seven tuned AI personalities playing the same game — economy
  management, expansion, research, diplomacy with memory and grudges, war plans — under
  labelled-difficulty presets (Story / Fair / Hard / Brutal; no hidden cheating).
- **Depth:** a 72-tech research tree across three eras, a systemic events engine with choices
  the AI also answers, five victory tracks plus defeat, and an advisor-driven tutorial.
- **Product:** save/load with versioned sections and migration chains (export/import as a
  single `.crown` file), full modding (10 data-driven def kinds, patches/overrides, load-order
  and conflicts reports, save↔mod reconciliation), sandbox mode with an editor palette, audio
  direction, localization architecture with pseudo-locale CI, and an offline-capable PWA shell.

## Verification (this RC, on the shipping composition)

- 426 automated tests green across all packages.
- 4/4 golden replays verify at their pinned cross-engine hashes (determinism contract, TDD §5).
- Save corpus: every committed save loads, resumes to its pinned hash, and survives 5
  save/load torture cycles hash-stable (SC-4).
- Benchmark scenes (doc 11 §6): `bench-war-max` 0.088 ms/tick, `bench-ai-8k` 0.195 ms/tick,
  `bench-late-campaign` 0.177 ms/tick — all far inside the 10 ms budget, AI share ≤ 30% (SC-3).
- Balance matrix: 24 full AI-vs-AI campaigns (4 difficulties × seeds × 2–4 kingdoms) all reach
  a victory inside the year cap; wars start and end; zero peacetime starvation (SC-2).
- Crash triage: 100 seeded campaigns, 4 kingdoms × 25 years across all difficulties —
  crash-free.
- Browser smoke test on the production build: campaign boots from the new-game screen, panels
  and tutorial events populate, terrain renders, in-browser save/load roundtrips.

**Remaining before 1.0 ships (the M48 exit gate):** the external RC playtest verifying the two
human criteria — SC-1 (a new player reaches a stable kingdom in 30 minutes unaided) and SC-6
(blind testers attribute distinct personalities to AI kingdoms) — plus the final version flip
described below.

## Known limitations (carried honestly into 1.0)

- **Placeholder art and audio.** No art-asset pipeline was built (doc 10); visuals are the
  placeholder tile/glyph look, and the audio release lint intentionally fails on 12 placeholder
  cues. This is the shipped aesthetic for 1.0, not a regression.
- **Characters are cut** (ADR-1): notables/marriages/heirs exist as tested code but are not in
  the 1.0 composition. The character surface is advisors.
- **AI knowledge model ships army-strength beliefs only** (ADR-2); other fact kinds read truth.
- **Castle building UI is minimal:** wall pieces through the shared build palette; the
  dedicated castle-defence layer is post-1.0 (Phase 8, ADR-4).
- **Player-led siege bombardment has no target picker yet** — `siege.setTarget` is AI-only, so
  a player attacker wins sieges by starvation (or by assaulting after a defender sortie); a fix
  is queued. AI-vs-AI and defensive sieges are unaffected.
- Doc 11 §1's hard stress ceilings (80 villages / 3,000 units) and `bench-econ-max` remain
  unverified/unbuilt; the benchmark gate is absolute-budget, not regression-vs-baseline.

## Save compatibility

Save format v1, section-versioned with migration chains. Saves from this RC load in 1.0.
Older saves missing the `capitals` section (added 2026-07-16) load via a derivation fallback;
a save made mid-capital-divergence re-derives once on first load (doc 14, OQ-9).

## Versioning note for the final ship commit

`GAME_VERSION` stays `0.1.0` in this RC because Mod Zero and both example mods pin
`gameVersion: ">=0.1 <1.0"` — bumping the engine version alone would disable the base game.
The final 1.0 commit must flip `GAME_VERSION` to `1.0.0` AND widen the manifest ranges
(base + examples + docs/modding examples) in the same change.

## After 1.0

Phase 8 — The Castle (M49–M54, doc 12 R2, chartered by ADR-4): a per-kingdom castle-defence
layer, spatial siege assaults, templated AI castles, and capital-based loss rules
(vassalage-first; permadeath as the ironman opt-in).
