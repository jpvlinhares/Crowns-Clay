# 04 — Technology Stack Evaluation

Evaluation criteria (from the brief): browser performance · offline capability · long-term
maintainability · developer experience · AI integration · modding support · rendering performance ·
scalability.

## §1. Candidate Stacks

### Option A — TypeScript + PixiJS (WebGL) + Web Workers + IndexedDB *(recommended)*

| Pros | Cons |
|---|---|
| First-class browser citizen: zero install, PWA offline, portable saves | JS GC pauses require discipline (pools, typed arrays) on hot paths |
| TypeScript: strict typing at scale, superb refactoring, huge hiring/knowledge pool | Single-threaded JS per context → must architect around workers deliberately |
| PixiJS: mature, batch-oriented 2D WebGL renderer with proven 10k+ sprite scenes | Peak numeric throughput below native/WASM |
| Workers give real sim/render isolation (TDD §1) | Determinism needs a strict discipline layer (TDD §5) |
| Modding trivially natural: JSON content + sandboxed JS hooks share the platform language | |
| Debugging/profiling in browser devtools is best-in-class DX | |

### Option B — Rust → WebAssembly core + TS/WebGL shell

| Pros | Cons |
|---|---|
| Highest sim throughput & memory control; no GC | Slower iteration (compile times) hurts the tuning-heavy genre |
| Determinism easier (integer math, no JIT surprises) | Two-language codebase: FFI boundary tax on every feature; smaller contributor pool |
| Strong typing & fearless refactors | Modding scripting becomes a hard problem (embed interpreter in WASM) |
| | Browser devtools story for WASM still weaker; team velocity risk dominates |

### Option C — Unity (WebGL export)

| Pros | Cons |
|---|---|
| Full engine: editor, animation, audio out of the box | Web export is Unity's weakest target: large payloads (30–100 MB+), long loads, memory ceilings |
| Large ecosystem | Threads/GC in WebGL export are constrained; poor fit for worker-isolated sim |
| | Licensing/runtime-fee volatility conflicts with a multi-year project |
| | Modding on WebGL export is severely restricted (no runtime C# loading) |

### Option D — Godot 4 (Web export)

| Pros | Cons |
|---|---|
| Open source, no fees; decent 2D | Web export maturing but heavy (WASM+threads requirements, SharedArrayBuffer/CORS headers) |
| GDScript fast iteration | Sim-scale performance for 2,000+ agents in GDScript is doubtful; C# web export unsupported/limited |
| | Modding & save portability harder than plain web platform |

### Option E — Plain Canvas2D + vanilla JS

| Pros | Cons |
|---|---|
| Simplest possible start | Canvas2D cannot hit sprite counts in doc 11 (no batching) |
| | No typing at this codebase scale = maintainability failure |

## §2. Scoring Matrix (1–5)

| Criterion | A: TS+Pixi | B: Rust/WASM | C: Unity | D: Godot | E: Canvas |
|---|---|---|---|---|---|
| Browser performance | 4 | 5 | 2 | 3 | 1 |
| Offline capability | 5 | 5 | 3 | 3 | 5 |
| Maintainability (multi-year) | 5 | 4 | 3 | 3 | 1 |
| Developer experience/velocity | 5 | 3 | 4 | 4 | 3 |
| AI integration (sim-scale custom AI) | 4 | 5 | 3 | 2 | 2 |
| Modding support | 5 | 2 | 1 | 2 | 4 |
| Rendering performance (2D) | 4 | 4 | 3 | 3 | 1 |
| Scalability (map/entities) | 4 | 5 | 3 | 3 | 1 |
| **Total /40** | **36** | **33** | **22** | **23** | **18** |

## §3. Recommendation & Rationale

**Adopt Option A**, with **Option B held as a surgical escape hatch**: the module-boundary design
(TDD §3) keeps hot numeric kernels (pathfinding, combat math) behind narrow interfaces so that an
individual subsystem could be ported to WASM later *if profiling proves it necessary* — we buy
Rust's ceiling as an option without paying its velocity cost up front.

The decisive arguments:
1. **This genre lives on iteration.** Balance-heavy simulation games succeed through thousands of
   tuning cycles; TS + hot-reloaded JSON content (TDD §12) maximises cycles/day.
2. **Modding is a pillar, not a feature** (Vision USP-3). The web platform makes data + sandboxed
   script mods natural; every other option fights it.
3. **The performance risk is bounded and architectural, not linguistic.** Doc 11 targets are within
   demonstrated PixiJS/Worker envelopes given SoA data layout and time-slicing (TDD §10); Risk R2/R3
   carry the mitigation plan and the WASM fallback trigger.

## §4. Concrete Stack (v1 pinned at M1, reviewed each phase gate)

| Layer | Choice | Notes / alternative kept warm |
|---|---|---|
| Language | TypeScript (strict) | — |
| Rendering | PixiJS v8 (WebGL2, WebGPU-ready) | raw WebGL wrapper if Pixi ever blocks us |
| Sim threading | Web Worker (+ optional pathfinding sub-worker) | SharedArrayBuffer *not* required at 1.0 (hosting simplicity) |
| UI | HTML/CSS + lightweight reactive lib (Preact + signals) | UI is replaceable by design (TDD §3) |
| State persistence | IndexedDB (`idb` wrapper) + File System Access/download for export | OPFS considered post-1.0 |
| Compression | native `CompressionStream` (gzip) | fflate polyfill for Safari gaps |
| Data formats | JSON5 authoring → JSON runtime; JSON Schema validation (Ajv) | see doc 09 |
| Audio | WebAudio via Howler-class thin wrapper | — |
| Build | Vite + TypeScript + ESLint + Prettier + Vitest + Playwright | — |
| Offline | PWA service worker (Workbox) | — |
| Mod scripting | Sandboxed hook layer **[OQ-3: QuickJS-in-WASM vs. declarative-only]** | decision due M28 |
