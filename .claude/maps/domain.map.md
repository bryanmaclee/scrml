# domain.map.md
# project: scrmlts
# updated: 2026-05-18T00:00:00-06:00  commit: dae8ff1

## Core Concepts

| Concept | Definition |
|---------|------------|
| scrml | Single-file, full-stack reactive web language: one .scrml file contains markup, CSS, logic, server functions, SQL, and state — the compiler splits it into HTML + client JS + server JS |
| Pipeline | 12+ ordered stages (BS → TAB → NR → MOD → CE → UVB → PA → RI → TS → META → DG → BP → RS → CG) plus Stage 3.007 LINT-TRY-CATCH + Stage 3.105 STDLIB-EXPORT-SEED + Stage 7.55 AuthGraph + Stage 7.6 Reachability Solver |
| Reactive cell (@var) | Mutable reactive variable declared with `@name = expr`; all subscriptions update on set |
| Derived cell | Const-derived reactive variable (`const <name> = expr`); recomputed when deps change; shape:"derived" in AST |
| Engine | State machine over a reactive cell (`<engine>` tag); governs legal transitions via rule= attributes; variant-guarded markup rendering |
| State child | AST node inside an `<engine>` body representing a named variant; body is walkable AST; may carry payload binding per §51.0.B.1 (S98) |
| Payload binding on state-child | §51.0.B.1 (S98 SPEC-only): three forms — bare-attribute, named, parenthesized; positional + named semantics inherit from §18.7; reserved-name precedence rule; unit-variant rejection. Track 2 (compiler wiring) pending. |
| Match block | Pattern-match expression (`match expr { .A => ..., .B => ... }`); match-as-expression and match-block-form |
| Logic block (${ }) | Imperative code block; contains let/const/reactive decls, function defs, SQL blocks, control flow |
| Meta block (^{ }) | Compile-time code execution block; evaluated at CG Stage 8; `meta.emit()` inserts HTML at the block's DOM position |
| Error-effect block (!{ }) | Pattern-matched error handler; arms match on error type |
| SQL block (?{ }) | Inline SQL query with chained method; compiled to server-only prepared statement |
| Server function | `server function name(params)` — compiled to HTTP route handler; called from client via auto-generated fetch |
| Component | Reusable markup definition; expanded at Stage 3.2 CE |
| Channel | Real-time pub/sub topic (`<channel>` tag); WebSocket/SSE backed |
| PURE-CHANNEL-FILE | A .scrml file containing `<channel>` at file top and NO `<program>`. Canonical per §38.12.6 |
| Validator | Predicate on a state cell; synthesizes validity surface (@x.isValid, @x.errors, @x.touched, @x.submitted) |
| Batch Planner | Stage 7.5 BP; coalesces SQL calls within a logic block into batched queries |
| Protect Analyzer | Stage 4 PA; identifies protected fields requiring write guards |
| Route Inference | Stage 5 RI; infers HTTP method + path for server functions and channels; produces RouteMap |
| Dependency Graph | Stage 7 DG; builds reactive cell dependency graph; detects cycles; all A-1 edges (markup-read etc.) active |
| MarkupReadDGNode (A-1.2) | Per-interpolation markup-context read node (S88 A-1.2); enables §40.9.3 closure analysis |
| AuthGraph | Stage 7.55: derived AFTER RI (needs RouteMap), BEFORE RS. Output: `gates: Map<MarkupNodeId, AuthGate>`, `roleEnum`, `gateToEntryPoint`, `redirectTargets`, `errors`. Four sub-phases A-3.1..A-3.4 CLOSED S90; wired into api.js pipeline at A-3.5 (S91). Full set: runAuthGraph() + resolveRoleEnum() + classifyGates() + crossRefRedirects() + checkLoginMissing() |
| `<auth>` element | `<auth role="admin">...</auth>` — sub-page component gate (SPEC §40.9.9). Registered in html-elements.js; `role=` attribute registered with supportsInterpolation: true |
| AuthSiteKind | "program-auth" \| "page-auth" \| "auth-role-block" \| "channel-auth" — four gate declaration sites |
| RoleClassification | Per-gate: closed_form (gated_for_role: Set<RoleVariant>) or runtime-fallback (gate_expr) |
| Reachability Solver | Stage 7.6 RS; five-component union + per-role ChunkPlan emission. A-2.1..A-2.8 ALL CLOSED at S91. Outer fixed-point operator (A-2.7) + canonical JSON serialization (A-2.8) complete |
| ChunkPlan | Per-(entry-point, role) chunk decomposition: initialChunk + prefetchTier1 + prefetchTier2 + prefetchTierN |
| Per-Route Artifact Splitter | A-4 wave FULLY CLOSED S91. route-splitter.ts orchestrates per-(EP, role, tier) chunk emission from ChunkPlan atoms. Output: per-file `<route>/<Role>.<tier>.<8-char-hash>.js` + `chunks.json` manifest |
| ChunkKey | (entryPointId, role, tier) tuple uniquely identifying one emitted JS chunk artifact |
| ChunkOutput | One emitted chunk: payloadJs (atom-composed JS), chunkHash (FNV-1a base36 8-char, SPEC §47.5), filename, byteSize |
| getCompilerIdentity() | Reads scrmlTS package.json `version` lazily, returns `"scrml-" + V` (e.g. `"scrml-0.3.1"`); cached after first call; fallback `"scrml-unknown"` on read failure. Populates `chunks.json` `compiler` field (Q-OPEN-4, CLOSED S92) |
| FNV-1a hash | Shared 32-bit base36 hash primitive at `codegen/fnv1a-hash.ts` (SPEC §47.1.3 normative). Two call sites: per-binding type-encoding (§47.1.2) and per-chunk content-addressing (§47.5). Pure-PURE; deterministic |
| Tier-1 idle prefetch | `_scrml_prefetch_tier1(chunkUrl)`: requestIdleCallback browser-side + setTimeout(fn,1) Safari fallback; wired in IIFE tail when (EP,role) admits non-empty tier-1 |
| Tier-2 hover prefetch | `_scrml_prefetch_tier2(routePath, role)`: mouseenter+focus once-listeners on `[data-scrml-prefetch]` anchors; `<a href="/internal">` wiring injects data-scrml-prefetch for exact RouteMap.pages matches |
| Tier-N on-demand dispatch | `_scrml_fetch_chunk(epId, role, tier)`: returns Promise<string> for registered tuples, JS null for unregistered; structural-scaffolding only in v0.3 (never fires per OQ-A2-B + OQ-A4-D) |
| augmentHtmlForChunks | emit-html.ts ~295 LOC: injects `_SCRML_CHUNKS` inline manifest + `<link rel="modulepreload">` + role-detection bootstrap (localStorage > cookie > `<meta scrml-role>` > `"_anonymous"`) into each route's HTML file |
| W-CG-CHUNK-* lint family | Five warning codes fired by route-splitter.ts emitChunkLints(): W-CG-CHUNK-EMPTY + W-CG-CHUNK-LARGE + W-CG-CHUNK-NO-PREFETCH + W-CG-CHUNK-PREFETCH-UNRESOLVED + W-CG-CHUNK-MISSING-ROLE |
| Q-OPEN-5 chunkSizeBudgetBytes | Soft byte budget for W-CG-CHUNK-LARGE. Default 100,000 bytes. Configurable via `--chunk-size-budget=N` CLI flag (CLOSED S92) |
| Q-OPEN-6 prefetch split | W-CG-CHUNK-NO-PREFETCH (Info, case 1: no internal links) vs W-CG-CHUNK-PREFETCH-UNRESOLVED (Warning, case 2: internal-shaped links present but unresolved). Discriminated by `ctx.hasInternalLinks` flag. CLOSED S92 |
| `scrml generate auth` | CLI subcommand: scaffolds adopter-owned `stdlib/auth/templates/login.scrml` into project at configured loginRedirect path. Resolution path for W-AUTH-LOGIN-MISSING. Never overwrites existing adopter edits |
| Wire Format (§57) | scrml absence (`not`) encodes as `{"__scrml_absent": true}` over the wire for `T | not` return types. Dual-decoder: accepts envelope + raw JSON null. Clean-break at v1.0 |
| null / undefined eradication | ABSOLUTE. `null` and `undefined` do NOT exist in scrml. `""` / `0` / `false` are DEFINED values. Canonical absence: `not`. SPEC §42 + §42.1.1 normative |
| Tier system | Tier 1 (basic reactive): if/for/match; Tier 2 (engines): state machines; Tier 3 (positional sugar): compound state shorthand |
| Self-host | Compiler compiled with itself; dist artifacts gitignored. Self-host is a from-scratch rewrite SHOWCASING scrml advantages — not a mechanical TS port. Post-v1.0 timeline |
| scrml:host | Stdlib module: `safeCall`, `safeCallAsync`, `HostError`. try/catch lives ONLY in compiler/runtime/stdlib/host.js — never in scrml source |
| Raw-content elements (§4.17) | `<pre>` and `<code>` — bodies are a single text run. scrml tokens (`${...}`, `<TagName>`, brace sigils) NOT recognized inside. `RAW_CONTENT_ELEMENTS` Set in block-splitter.js. S101 landing, companion §24.3.1 cross-ref |
| Tailwind typography plugin (§26.6) | `prose` / `prose-{color}` / `prose-{size}` / `not-prose` opt-out. §26.6.1 base prose styling with `:where()`+`:not(:where([class~="not-prose"] *))` selectors. §26.6.2 color variants (slate/gray/zinc/neutral/stone). §26.6.3 size variants (sm/base/lg/xl/2xl). Implemented in tailwind-classes.js +415 LOC (S100) |
| fn mutual recursion / hoisting (§48.6.4) | `fn` declarations at file scope hoist per §6.9, mirroring `function`; mutual recursion supported without source-order constraints; `pinned fn` opt-out (parser-recognition implementation-pending). S98 SPEC-only landing |
| Native parser (Mn series) | `compiler/native-parser/` — bottom-up scrml-native lexer replacing Acorn pre-v1.0. M1.1 (S99) + M1.2 strings/templates/§51.0.Q.1 nested-engine (S100) + M1.3 line/block comments (S102) + M1.4 regex (S103). M1 LADDER COMPLETE: all 7 LexMode state-children have substantive body dispatchers. Acorn is the conformance oracle, not the design template. Design authority: scrml-native-parser-design-2026-05-17.md |
| §51.0.Q.1 nested engine | SPEC-canonical pattern for composite state-children containing an inner `<engine>` over the same type. `var=innerLexMode` is the canonical disambiguation (SPEC §51.0.C + §51.0.Q.1). Exemplified in `lex-mode.scrml` InTemplateBody state-child. |
| Named timers (§51.0.M.1) | `<onTimeout name=IDENT after=DURATION to=.Variant>` — addressable timer; `cancelTimer("IDENT")` from event-handler inside same state-child body. E-TIMER-NAME-DUPLICATE + E-TIMER-NAME-INVALID diagnostics. SHIPPED S79 A5-6 Feature 1 |
| MPA shell-composition $& fix | S100 `01eeda9` + S101 `d77a60d`: `String.prototype.replace` second argument dollar-sign backreferences (`$&`, `$N`, `$'`, `` $` ``) silently substituted in multipage body replace calls; fixed by converting to function-form replace in codegen/index.ts:1214, component-expander.ts:2169, commands/generate.js:242 |
| PIPELINE.md | v0.7.2 (S101 2026-05-18) — adds Stage 2 (BS) v0.next addendum for §4.17 raw-content elements. v0.7.1 (S101) was the prose-pass; v0.7.2 is the §4.17 contract addendum. No downstream stage contract changes |

## v0.3.x Status (HEAD dae8ff1, 2026-05-18)

**v0.3.1** — v0.3.0 patch tag `cbe1b1e`. v0.3.x patch arc (S93+). All Approach A sub-waves CLOSED (v0.3.0 baseline).

**CLOSED at S93-S99 (post-v0.3.0 patch arc):**
- S93-S99: 6+ substantive compiler bugs closed (scope-walker gaps, parseParamList default-value, export function synth stubs, `is some`/`is not` preprocessor, E-SWITCH-FORBIDDEN); B1 §51.0.B.1 payload-binding compiler-feature wiring Track 2 CLOSED S99

**CLOSED at S99:**
- §51.0.B.1 payload-binding compiler wiring (Track 2) ✓
- Day-30 reference build-out (11 pages shipped) ✓

**CLOSED at S100 (v0.3.x):**
- §26.6 Tailwind typography plugin (tailwind-classes.js +415 LOC) ✓
- MPA shell-composition `$&` regex-injection bug fix (codegen/index.ts) ✓
- M1.2 native-parser: strings + template literals + §51.0.Q.1 nested-engine (M1.2 stress test) ✓

**CLOSED at S101-S103 (v0.3.1 era):**
- §4.17 raw-content elements (`<pre>` / `<code>`) — BS stage + PIPELINE.md v0.7.2 + SPEC §24.3.1 ✓
- $& body-replace function-form fix at component-expander.ts + commands/generate.js ✓
- M1.3 native-parser: line comments + block comments (S102) ✓
- M1.4 native-parser: regex body dispatcher; M1 LADDER COMPLETE (S103) ✓

**Pending (post-v0.3.1):**
- M1.5 native-parser: flip `expr-literals.js` to "full" disposition (regex-token normalizer extension)
- M2: expression parser in scrml; ParseContext engine
- §51.0.B.1 Track 2 compiler-feature (parser + typer + codegen wiring) — SPEC landed S98; compiler wiring CLOSED S99
- stdlib/http async migration (4 try-catch sites tracked by W-TRY-CATCH lint)

## Business Invariants

- No SQL execution calls may appear in client JS output (E-CG-006)
- No server-environment access (process.env, Bun.env) may appear in client JS output
- Engine transitions must match a declared rule= arm or throw E-ENGINE-001-RT at runtime
- Exception (§51.0.F.1): engine self-writes are runtime NO-OPs — no E-ENGINE-INVALID-TRANSITION
- Lin-declared variables must be consumed exactly once; unconsumed or double-consumed raises E-LIN-* at compile time
- Tilde-declared variables must be used; E-TILDE-001 on drop
- Batch Planner excludes .nobatch() SQL nodes from all coalescing candidate sets (§8.9.1)
- `null` / `undefined` are NOT valid scrml tokens in any context (SPEC §42, E-SYNTAX-042)
- `""` / `0` / `false` / `[]` / `{}` are DEFINED values — NOT absence (SPEC §42.1.1)
- `===` / `!==` are NOT valid in scrml source (E-EQ-004)
- `bun:` and `node:` prefixed imports are server-context-only (E-IMPORT-007)
- Server-function return types `T | not` encode absence as `{"__scrml_absent": true}` wire envelope (SPEC §57)
- `<auth>` blocks without `role=` AND without `check=` are malformed gates (E-AUTH-GRAPH-004)
- Apps using `<auth role=...>` variant-referencing gates with no app-scope role enum get E-CLOSURE-002
- Chunk hash MUST NOT equal CHUNK_HASH_PLACEHOLDER ("00000000") at chunk surface — regression-guard invariant (A-4.6 assertion)
- Two builds of the same source MUST produce byte-identical chunk payloads AND byte-identical chunk hashes (§40.9.8 determinism normative)
- W-CG-CHUNK-NO-PREFETCH and W-CG-CHUNK-PREFETCH-UNRESOLVED are mutually exclusive per Q-OPEN-6 (hasInternalLinks discriminator)
- `<pre>` and `<code>` bodies are NOT parsed for scrml tokens — they are raw-content text runs (§4.17)
- Engine state-child payload-binding MUST NOT shadow reserved attribute names {rule, effect, history, internal:rule} — E-ENGINE-PAYLOAD-RESERVED-COLLISION (§51.0.B.1)
- Engine state-child payload binding on a UNIT variant (no payload fields) raises E-ENGINE-PAYLOAD-ON-UNIT-VARIANT (§51.0.B.1)

## Diagnostic First-Fire-Sites (S90 + S91 + S92 — unchanged; new codes at S98)

| Code | Severity | File | Description | Session |
|------|----------|------|-------------|---------|
| W-CG-UNDEFINED-INTERPOLATION | warning | codegen/lint-undefined-interpolation.ts | Bare `undefined` in compiled JS (M-7C-D-12 Track 3) | S90 |
| I-AUTH-REDIRECT-UNRESOLVED | info | auth-graph.ts crossRefRedirects() | Gate redirect target not in RouteMap.pages (A-3.4) | S90 |
| E-AUTH-GRAPH-002 | error | auth-graph.ts resolveRoleEnum() | Multiple role enums in same compilation unit (A-3.2) | S90 |
| W-AUTH-RUNTIME-FALLBACK | info | reachability/component-4.ts | Async-only auth check; static classification impossible (A-2.5) | S90 |
| E-CLOSURE-002 | error | reachability/component-4.ts | Auth-role-block gates with no app-scope role enum (A-2.5) | S90 |
| W-AUTH-PAGE-INFERRED | info | auth-graph.ts classifyGates() | Page lacks explicit auth= with program auth=required (A-3.3) | S90 |
| E-CLOSURE-001 | error | reachability/outer-fixpoint.ts | Fixed-point non-termination; iteration cap reached (A-2.7) | S91 |
| W-AUTH-LOGIN-MISSING | warning | auth-graph.ts checkLoginMissing() | Auth gates present but no login page at loginRedirect path; two-tier severity (A-3.5) | S91 |
| W-CG-CHUNK-EMPTY | warning | codegen/route-splitter.ts emitChunkLints() | Entry-point produces zero non-empty chunks (A-4.7) | S91 |
| W-CG-CHUNK-LARGE | warning | codegen/route-splitter.ts emitChunkLints() | Initial chunk exceeds soft size budget (A-4.7, Q-OPEN-5 configurable) | S91 |
| W-CG-CHUNK-NO-PREFETCH | info | codegen/route-splitter.ts emitChunkLints() | Multi-route app, no internal links at all — Info (Q-OPEN-6 case 1) | S91/S92 |
| W-CG-CHUNK-PREFETCH-UNRESOLVED | warning | codegen/route-splitter.ts emitChunkLints() | Internal-shaped links present but unresolved — Warning (Q-OPEN-6 case 2) | S92 |
| W-CG-CHUNK-MISSING-ROLE | warning | codegen/route-splitter.ts emitChunkLints() | `<auth role=X>` role not in reachability record (A-4.7) | S91 |
| E-ENGINE-PAYLOAD-ON-UNIT-VARIANT | error | SPEC §51.0.B.1 — compiler wiring pending Track 2 | Payload binding on a unit-variant state-child | S98 |
| E-ENGINE-PAYLOAD-ARITY-MISMATCH | error | SPEC §51.0.B.1 — compiler wiring pending Track 2 | Binding count != variant payload field count | S98 |
| E-ENGINE-PAYLOAD-RESERVED-COLLISION | error | SPEC §51.0.B.1 — compiler wiring pending Track 2 | Payload binding name shadows reserved state-child attribute | S98 |

## Domain Events (Compiler Pipeline)

| Event | When | Where |
|-------|------|-------|
| CompileContext populated | After analysis, before emission | codegen/index.ts |
| BindingRegistry seal | After HTML emit, before client JS emit | codegen/index.ts |
| `pushArmContext / popArmContext` | Around each engine state-child body emit | emit-variant-guard.ts |
| `drainMachineCodegenErrors` | After all machine emission | codegen/emit-machines.ts |
| channel placement pre-check | UVB Stage 3.3 | validators/ast-walk.ts |
| LINT-TRY-CATCH walk | Stage 3.007 | validators/lint-try-catch.ts |
| STDLIB-EXPORT-SEED | Stage 3.105 | api.js |
| wire-format encoder injection | Post-server-JS emit, if return type includes `| not` | codegen/emit-server.ts |
| lint-undefined-interpolation scan | Post-CG emission, before output write | codegen/lint-undefined-interpolation.ts |
| emitPerRouteChunks | Post-emit phase, when emitPerRoute=true | codegen/index.ts → route-splitter.ts |
| emitChunkLints | Post-per-route-emission, per entry-point | codegen/route-splitter.ts |
| augmentHtmlForChunks | Post-emit, when emitPerRoute=true + chunks manifest ready | codegen/emit-html.ts |
| raw-content element passthrough | BS Stage 2: RAW_CONTENT_ELEMENTS.has(lowerTagName) — body becomes text run | block-splitter.js |

## Aggregates

| Aggregate | File | Owns |
|-----------|------|------|
| FileAST | compiler/src/types/ast.ts | All ASTNodes for one .scrml file |
| CompileContext | compiler/src/codegen/context.ts | BindingRegistry, FileAnalysis, EncodingContext, error list, hasPrefetchableLinks, hasInternalLinks |
| BindingRegistry | compiler/src/codegen/binding-registry.ts | EventBinding[], LogicBinding[] |
| FileAnalysis | compiler/src/codegen/analyze.ts | Pre-computed AST slices |
| AuthGraph | compiler/src/types/auth-graph.ts | gates Map, roleEnum, gateToEntryPoint, redirectTargets, errors — Stage 7.55 output |
| ReachabilityRecord | compiler/src/types/reachability.ts | closures Map<EntryPointId, RolePlayableSurface> — Stage 7.6 output |
| ChunksManifest | compiler/src/codegen/route-splitter.ts | Map<ChunkKey, ChunkOutput> + compiler identity field — per-route artifact index |

## Task-Shape Routing

| Task shape | Where to look |
|------------|---------------|
| A-2 Reachability Solver | FULLY CLOSED S91 — reachability-solver.ts + reachability/ submodule (8 files) |
| A-3 AuthGraph | FULLY CLOSED S91 — auth-graph.ts (runAuthGraph + resolveRoleEnum + classifyGates + crossRefRedirects + checkLoginMissing); types/auth-graph.ts |
| A-4 per-route artifact splitter | FULLY CLOSED S91 — codegen/route-splitter.ts + codegen/atom-emitter.ts + codegen/fnv1a-hash.ts + codegen/emit-html.ts augmentHtmlForChunks + runtime-template.js + runtime-chunks.ts |
| A-5 integration tests | FULLY CLOSED S92 — compiler/tests/integration/ (6 new files) + fixtures/a5/ + 2 unit + 1 command test |
| Q-OPEN-4 compiler identity | CLOSED S92 — getCompilerIdentity() in route-splitter.ts; package.json sources chunks.json `compiler` field |
| Q-OPEN-5 chunk size budget | CLOSED S92 — --chunk-size-budget=N CLI flag; chunkSizeBudgetBytes through compileScrml/runCG/emitPerRouteChunks |
| Q-OPEN-6 prefetch split | CLOSED S92 — W-CG-CHUNK-NO-PREFETCH (Info) vs W-CG-CHUNK-PREFETCH-UNRESOLVED (Warning); ctx.hasInternalLinks discriminator |
| W-AUTH-LOGIN-MISSING resolution path | `scrml generate auth` CLI (commands/generate.js) → writes stdlib/auth/templates/login.scrml to project |
| §51.0.B.1 payload-binding | SPEC landed S98 (Track 1); compiler wiring (Track 2) CLOSED S99 |
| §51.0.M.1 named timers + cancelTimer | SHIPPED S79 A5-6 Feature 1 — engine-statechild-parser.ts + emit-variant-guard.ts + binding-registry.ts + runtime-template.js |
| §26.6 typography plugin | CLOSED S100 — tailwind-classes.js buildProseRule/buildProseColorRule/buildProseSizeRule (SPEC §26.6.1-§26.6.5) |
| §4.17 raw-content elements | CLOSED S101 — block-splitter.js RAW_CONTENT_ELEMENTS Set + PIPELINE.md v0.7.2 + SPEC §24.3.1 cross-ref |
| §48.6.4 fn mutual recursion / hoisting | SPEC-only S98 — parser-recognition implementation-pending (normative semantics specified) |
| MPA shell-composition $& fix | CLOSED S100/S101 — codegen/index.ts:1214 + component-expander.ts:2169 + commands/generate.js:242 |
| Native parser M1 ladder | CLOSED S103 — compiler/native-parser/ all 7 LexMode state-children active (M1.4). Next: M1.5 regex-token normalizer |
| stdlib/http async migration | stdlib/http/index.scrml lines 65/264 (W-TRY-CATCH fires) |
| null/absence migration | docs/changes/null-eradication-*, undefined-eradication-*, stdlib-phase-1-5-null-sweep |
| Chunk content-addressing | codegen/fnv1a-hash.ts (FNV-1a primitive) + route-splitter.ts computeChunkHash/finalizeChunkHash |
| Per-binding name encoding | codegen/type-encoding.ts (re-exports fnv1aHash from fnv1a-hash.ts; callers byte-identical) |
| HTML augmentation | codegen/emit-html.ts:augmentHtmlForChunks (per-route script injection + link hints + role bootstrap) |
| Canonical JSON reachability | reachability-solver.ts:serializeReachabilityRecord (A-2.8) — stratified comparator + canonical diagnostic order |

## Tags
#scrmlts #map #domain #concepts #pipeline #engine #reactive #s101 #v0.3.1 #approach-a #approach-a2 #approach-a3 #approach-a4 #approach-a5 #reachability #auth-graph #wire-format #null-eradication #route-splitter #fnv1a-hash #chunk-prefetch #generate-auth #q-open-4 #q-open-5 #q-open-6 #native-parser #m1-4 #m1-ladder-complete #raw-content #typography #payload-binding #named-timers #spec-51-0-b-1 #spec-4-17 #spec-26-6 #spec-48-6-4

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [error.map.md](./error.map.md)
- [schema.map.md](./schema.map.md)
- [test.map.md](./test.map.md)
