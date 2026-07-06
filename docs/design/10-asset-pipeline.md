# 10 — Asset Pipeline

**Placeholder-first doctrine:** every asset class defines a programmatic or trivial placeholder
form so gameplay never waits on art, and *all* assets are referenced by **logical id** resolved
through the mod layer chain (Engine §12) — replacing a placeholder with final art is a file swap,
at any stage, with zero code changes. (This is the mechanism behind the brief's requirement.)

## §1. Sprites

- **Style target:** 2D pixel-adjacent sprites; base tile 32×32 px with @2 detail tier for zoom-in
  (LOD switch, TDD §7). Buildings occupy footprint × tile multiples; units 32×48.
- **Authoring:** Aseprite (source `.ase` kept in repo `art-src/`), exported PNG per convention:
  `sprites/<category>/<name>/<variant>@<tier>.png` + optional 9-slice/anchor metadata json.
- **Build step:** atlas packer (per category) → atlas PNG + frames manifest + content hash into the
  content manifest (TDD §11). Dev mode loads loose files unpacked for hot-swap.
- **Placeholders:** generated tinted-shape sprites from a template sheet (colour = category,
  glyph = initial), produced by a tool script — every new BuildingDef/UnitDef automatically has a
  visible placeholder the moment its def exists.

## §2. Animations

- Frame-based (no bones at 1.0): animation defs `{frames[], fps, loop, events?}` in metadata json
  beside the sheet; unit rigs standardise state names (`idle, walk, attack, die, work`) so any
  conforming sheet drops in. Placeholder: 2-frame bob generated from the static placeholder.

## §3. Audio & Music

- SFX: OGG, mono ≤3 s, loudness-normalised (build lint −16 LUFS target); cue table maps GameEvents →
  cue ids (Engine §8) — data, hence moddable. Placeholder: synthesised blips per cue category
  (generated bank checked in).
- Music: OGG stereo, playlist defs per era/season/tension state with intro/loop points metadata.
  Placeholder: 4 royalty-free temp tracks tagged clearly `TEMP_` (build warns if `TEMP_` assets
  remain at release profile).

## §4. Fonts

- UI is HTML (TDD §7): WOFF2 webfonts, subset per shipped locales at build time; one display face,
  one text face, one tabular-numerals face for ledgers. Fallback stacks defined so missing glyphs
  degrade legibly. Licensing gate: only OFL/owned fonts enter `assets/fonts` (checked by manifest
  lint).

## §5. Icons & UI Themes

- Icons: SVG source → rasterised sizes at build (crisp at UI scales); logical ids
  (`icon:resource/grain`). Placeholder: auto-generated letter tokens.
- UI theme = CSS custom-property token sheet (colours, spacing, panel chrome sprites) as a def kind
  (`ui-themes/`) — reskinnable by mods without touching markup.

## §6. Localization

- **All player-visible strings are keys** (doc 06 `LocalizedText`) — enforced by lint (no string
  literals in UI components). Locale files per mod layer merge like other defs (doc 09 §6).
- Format: ICU MessageFormat for plurals/gender; pseudo-locale (`en-XA`, accented + 30% expansion)
  runs in CI screenshots to catch overflow early. Source-of-truth English lives beside defs;
  extraction tool produces translator packs (key, english, context note).

## §7. Workflow Summary

```
art-src/ (ase, svg, wav, midi)            defs reference logical ids only
     │  export / generate                          │
     ▼                                             ▼
assets/ (png, ogg, woff2, json meta) ──► build: validate → pack atlases →
transcode → subset → hash → content-manifest ──► runtime Asset Manager
     ▲                                             │
placeholder generators (auto per new def)          └─► service-worker cache (offline)
```

**Definition of done for any asset:** logical id registered · placeholder auto-exists · final asset
passes build lints (size, loudness, licence, naming) · swap verified in-game with hot reload.
