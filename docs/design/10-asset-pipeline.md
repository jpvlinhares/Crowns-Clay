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

**Polish delta:** until the sprite generator/atlas exists, the live renderer draws vector
placeholder GLYPHS instead of bare coloured blocks — `drawBuildingIcon` in
`packages/render/src/pixiRenderer.ts` gives each building category a distinct silhouette (civic =
crenellated keep + pennant, housing = peaked cottage, service = market stall, storage = capped
silo, production = gambrel barn, military = watchtower + shield), and wanderers render as a small
person figure (head + tapered body) rather than a dot. Same "colour = category" doctrine, one
legibility tier up; a real sprite sheet still supersedes it by file swap.

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
  remain at release profile). The synthesised stand-in is now a real GENERATIVE THEME rather than a
  single sustained drone: `playPlaceholderTrack` runs a look-ahead-scheduled loop of bass, a chord
  pad, an arpeggiated melody and (tenser states) drums, with the mood keyed off the playlist's
  `trackId` prefix — `pastoral-*` (calm, D-major), `unease-*` (tense, A-minor), `war-drums-*`
  (combat, faster + a kit). Distinct pitched voices per tension state, still zero binary assets.

**M41 delta:** both placeholder forms shipped as RUNTIME SYNTHESIS (`packages/audio/src/synth.ts`)
rather than checked-in files — no OGG assets exist anywhere in the repo yet, for any content kind
(sprites' own placeholder generator, doc 09 §1, is equally unbuilt), so there was nothing to
transcode from. This is a strict reading of the doctrine above, not a deviation from it: cues/
playlists are referenced by logical id (`AudioCueDef`/`MusicPlaylistDef`, `content/base/defs/
cues|playlists/`) exactly as designed, each marked `placeholder: true` (a real field standing in
for the `TEMP_` filename convention, since there's no filename yet), and swapping in real audio
later only changes those content files plus `synth.ts`'s call sites — no engine rewrite. The
`TEMP_`/"build warns at release" mechanism is real: `node packages/tools/dist/audio-lint.js
[--release]` — warns in dev, fails in `--release` mode, the literal M45 gate ("zero TEMP_/
placeholder in release profile", doc 12) mechanism this milestone was asked to build.

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

**M44 delta (packages/core/src/locale.ts, packages/data/src/locale.ts, packages/tools/src/locale-*.ts):**
the real slice of this spec that shipped, plus the honest gaps against the full vision above:
- `Locale`/`LocalizedText`/`formatMessage` (`@crowns/core`) — a genuine ICU MessageFormat SUBSET,
  not the full spec: `{placeholder}` interpolation and `{var, plural, one{} other{}}` only (English's
  two categories), no gender, no CLDR's other plural categories (few/many/zero). Fail-visible on a
  missing key (returns the key itself) rather than blank/throw, matching the DSL evaluator's own
  "never throw on bad content" discipline (game/events.ts).
- `EventDef.text`/choice text converted to real `LocalizedText` keys, resolved server-side
  (`simPort.ts`'s catalog projection) against `content/base/locale/en.json5` — the first, and so
  far only, content-def kind actually converted (doc 06 §11's M33 delta note). A curated slice of
  `packages/app/src/main.ts` UI-chrome strings (~10 keys: edict buttons, ledger labels) converts
  the same way through a second table, `packages/app/src/locale/en.ts` — proof the same `Locale`
  class serves both content and hand-written UI copy, not exhaustive coverage of either.
- Extraction tool (`locale-tool.js pack`) merges both tables into a sorted key/english/context
  list. `locale-tool.js pseudo` regenerates the committed en-XA tables; `?locale=en-XA` on the
  running app swaps both content and UI-chrome text to it end-to-end (verified in-browser),
  and a CI job (`pwa-offline-coldstart`'s sibling wiring — see ci.yml) is the "en-XA screenshot"
  half of the roadmap line, though it currently just proves the pseudo-locale renders rather than
  diffing against a committed baseline image (no pixel-diff tooling exists yet — open question).
- **Not done:** the lint rule only covers `@crowns/ui` (a small, mostly string-free toolkit
  package) — `packages/app/src/main.ts`'s ~250 other literal strings are NOT covered by any lint
  and remain untranslated; mod-layer locale merging (doc 09 §6) doesn't exist, only the base
  locale loads; `AIPersonalityDef.taunts`/`voiceSet` stay flat strings (doc 06 §7 M36 delta) since
  neither renders in any UI yet.

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

**M44 delta:** the "service-worker cache (offline)" box exists now (`packages/app/public/sw.js`) —
but ahead of the atlas packer/content-manifest this diagram assumes, so it's a simpler cache-first
strategy over same-origin GETs, not one keyed by content-manifest hashes yet. Revisit the cache-key
scheme once the real asset pipeline (packer, transcode, manifest) lands.
