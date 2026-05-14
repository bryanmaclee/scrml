# domain.map.md
# project: scrmlts
# updated: 2026-05-13T23:00:00Z  commit: 71305fe

## Core Concepts

| Concept | Definition |
|---------|------------|
| scrml | Single-file, full-stack reactive web language: one .scrml file contains markup, CSS, logic, server functions, SQL, and state — the compiler splits it into HTML + client JS + server JS |
| Pipeline | 12+ ordered stages (BS → TAB → NR → MOD → CE → UVB → PA → RI → TS → META → DG → CG) plus Stage 3.007 LINT-TRY-CATCH [S89] + Stage 3.105 STDLIB-EXPORT-SEED [S89] + Stage 7.6 reachability scaffold [S89] |
| Reactive cell (@var) | Mutable reactive variable declared with `@name = expr` or `<name> = expr` (structural form); all subscriptions update on set |
| Derived cell | Const-derived reactive variable (`const <name> = expr`); recomputed when deps change; shape:"derived" in AST |
| State-decl (Shape 1/2/3) | Shape 1: plain cell with initExpr; Shape 2: render-spec (bound input element); Shape 3: derived expression |
| Engine | State machine over a reactive cell (`<engine>` tag); governs legal transitions via rule= attributes; variant-guarded markup rendering via emit-variant-guard.ts |
| State child | AST node inside an `<engine>` body representing a named variant; body is walkable AST |
| Variant-guarded render | Per-variant conditional HTML rendering dispatched by `emitVariantGuardedRender()`; dispatcher swaps innerHTML on variant change |
| Engine self-write (§51.0.F.1) | Assigning `@var = .CurrentVariant` where `.CurrentVariant` is currently-active state is a runtime NO-OP. Lint W-ENGINE-SELF-WRITE-DETECTED fires when statically detectable. |
| Match block | Pattern-match expression (`match expr { .A => ..., .B => ... }`); also match-as-expression and match-block-form |
| Logic block (${ }) | Imperative code block; contains let/const/reactive decls, function defs, SQL blocks, control flow |
| Meta block (^{ }) | Compile-time code execution block; evaluated at CG Stage 8; `meta.emit()` inserts HTML at the block's DOM position |
| Error-effect block (!{ }) | Pattern-matched error handler; arms match on error type |
| SQL block (?{ }) | Inline SQL query with chained method; compiled to server-only prepared statement |
| Tilde-decl (~name) | Must-use variable; E-TILDE-001 if dropped |
| Lin-decl (lin name) | Immutable linear-type variable; must be consumed exactly once (§35.2) |
| Server function | `server function name(params)` — compiled to HTTP route handler; called from client via auto-generated fetch |
| Component | Reusable markup definition; expanded at Stage 3.2 CE |
| Channel | Real-time pub/sub topic (`<channel>` tag); WebSocket/SSE backed |
| PURE-CHANNEL-FILE | A .scrml file containing `<channel>` at file top and NO `<program>`. Canonical per §38.12.6. |
| Validator | Predicate on a state cell; synthesizes validity surface (@x.isValid, @x.errors, @x.touched, @x.submitted) |
| Batch Planner | Stage 7.5; coalesces SQL calls within a logic block into batched queries |
| Protect Analyzer | Stage 4 PA; identifies protected fields requiring write guards |
| Route Inference | Stage 5 RI; infers HTTP method + path for server functions and channels |
| Dependency Graph | Stage 7 DG; builds reactive cell dependency graph; detects cycles; annotates hasLift. A-1.2..A-1.5 all active. |
| MarkupReadDGNode (A-1.2) | Per-interpolation markup-context read node (S88 A-1.2). Enables §40.9.3 closure analysis. |
| Approach A (v0.3) | 5-sub-wave reachability system. A-1 CLOSED (S89). A-2 in progress. A-3 SCOPED. |
| Approach A-1 (CLOSED S89) | All sub-phases A-1.1..A-1.8 closed: markup-read DG nodes, 4+3+engine edge emission, consumer audit, ceiling remeasurement (523 nodes vs 256 ceiling = 2.04x), docs. |
| Approach A-2 (reachability solver) | A-2.1: types/reachability.ts (247 LOC) + reachability-solver.ts (152 LOC) + --emit-reachability CLI flag. A-2.2: Component 1 (entry-point detection + gate-classifier + worst-case-union; +82 tests). A-2.3+ pending. |
| A-3 §40 auth-graph | SCOPING complete at docs/changes/a3-auth-graph-scoping/SCOPING.md. Implementation pending. |
| §13.2 auto-await (CLOSED S89) | End-to-end: SPEC §13.2.1/§13.2.2 stdlib Promise<T> + typer extension classifying 37 stdlib functions (STDLIB-EXPORT-SEED Stage 3.105) + verifyPassword + verifyJwt one-line auto-await. E-PROG-004 demoted Error→Info. |
| STDLIB-EXPORT-SEED (Stage 3.105) | api.js augments exportRegistry with stdlib metadata post-TAB so auto-await classifier sees stdlib signatures without compiling stdlib AST. |
| §36 input devices (CLOSED S89) | End-to-end: SPEC Phases 1-4 + parser/typer + regression + conformance (conf-INPUT-001..005) + integration + input-canvas-demo sample. E-INPUT-005 + W-INPUT-001 in catalog. |
| null/undefined eradication (S89) | ABSOLUTE. `null` and `undefined` do NOT exist in scrml. SPEC §42 + §42.1.1 normative. `""` / `0` / `false` are DEFINED values. Canonical absence: `not`. E-SYNTAX-042 (hard error) + W-ABSENCE-IN-SCRML-SOURCE (info lint, renamed from W-NULL-IN-SCRML-SOURCE S89). Corpus sweep: 21 stdlib files / 124 sites (8c608a7). |
| §42.1.1 Defined Values vs. Absence | NEW S89 normative SPEC subsection. `""` / `0` / `false` / `[]` / `{}` are defined values — NOT absence. Only `null`/`undefined` are absence tokens (both banned in scrml source). |
| M-7C-D-12 runtime sentinel | SCOPING at docs/changes/m-7c-d-12-runtime-sentinel-scoping/SCOPING.md. Option ε ratified: runtime JS `null` is scrml absence sentinel. 5 tracks / 33-45h aggregate. Pending 3-OQ disposition. |
| LIFT-1..5 fixes (S88 CLOSED) | All 5 LIFT-template codegen bug families closed at S88. All regression tests passing. |
| emit-variant-guard.ts (NEW S89) | Factored codegen helper: variant-guarded markup render dispatcher. Variant-source-agnostic; engine consumer passes `_scrml_reactive_get(varName)` accessor and state-child arms[]. |
| W-TRY-CATCH-IN-SCRML-SOURCE (NEW S89) | Stage 3.007 lint walker. Fires on stdlib/http lines 65/264 (tracked as migration backlog). |
| Wave 4 adopter content (CLOSED S89) | T-track tutorial 11/11 PASS (13 edits, 4 sub-tasks). 17 D-track articles classified. |
| scrml:host (S88) | Stdlib module: `safeCall`, `safeCallAsync`, `HostError`. try/catch lives ONLY in compiler/runtime/stdlib/host.js — never in scrml source. |
| Adopter override surface | `<program>` attributes: `idempotency-store`, `idempotency-ttl`, `batch-in-list-cap`, `cors-max-age`, `channel-reconnect`. Raw strings on MiddlewareConfig. |
| Self-host | Compiler compiled with itself; dist artifacts gitignored. Self-host is a from-scratch rewrite SHOWCASING scrml advantages — not a mechanical TS port. |
| Tier system | Tier 1 (basic reactive): if/for/match; Tier 2 (engines): state machines; Tier 3 (positional sugar): compound state shorthand |

## v0.3.0 Status (as of S89 close — 71305fe)

**CLOSED at S88/S89:**
- LIFT-1..5 (all codegen bug families) — S88 ✓
- Approach A wave A-1 (A-1.1..A-1.8 inclusive; consumer audit + ceiling remeasurement) — S89 ✓
- §36 input devices chain (SPEC + parser/typer + regression + conformance + integration + sample) — S89 ✓
- §13.2 auto-await chain (Sub-A + Sub-B + Sub-E; STDLIB-EXPORT-SEED pass) — S89 ✓
- Wave 4 adopter content (T-track 11/11 + D-track 17 articles) — S89 ✓
- Null/undefined eradication (SPEC §42.1.1, W-ABSENCE rename, corpus + stdlib sweep) — S89 ✓
- A-5.5 — closed ahead of schedule S89 ✓
- scrml:host + Phase 3a stdlib migration — S88 ✓

**In Progress / Pending:**
- Approach A-2 through A-5 (A-2.1 scaffold + A-2.2 Component 1 done; A-2.3+ pending)
- M-7C-D-12 runtime sentinel implementation (SCOPING done; pending 3-OQ disposition)
- A-3 §40 auth-graph (SCOPING done; implementation pending)
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
- `===` / `!==` are NOT valid in scrml source (E-EQ-004). Canonical forms: `==` / `!=`
- `bun:` and `node:` prefixed imports are server-context-only (E-IMPORT-007)
- Input state ids must be unique within their scope (E-INPUT-005)

## Domain Events (Compiler Pipeline)

| Event | When | Where |
|-------|------|-------|
| CompileContext populated | After analysis, before emission | codegen/index.ts |
| BindingRegistry seal | After HTML emit, before client JS emit | codegen/index.ts |
| `pushArmContext / popArmContext` | Around each engine state-child body emit | emit-variant-guard.ts |
| `drainMachineCodegenErrors` | After all machine emission, before CG output | codegen/emit-machines.ts |
| channel placement pre-check | UVB Stage 3.3 | validators/ast-walk.ts |
| LINT-TRY-CATCH walk | Stage 3.007 [NEW S89] | validators/lint-try-catch.ts |
| STDLIB-EXPORT-SEED | Stage 3.105 [NEW S89] | api.js |

## Aggregates

| Aggregate | File | Owns |
|-----------|------|------|
| FileAST | compiler/src/types/ast.ts | All ASTNodes for one .scrml file |
| CompileContext | compiler/src/codegen/context.ts | BindingRegistry, FileAnalysis, EncodingContext, error list |
| BindingRegistry | compiler/src/codegen/binding-registry.ts | EventBinding[], LogicBinding[] |
| FileAnalysis | compiler/src/codegen/analyze.ts | Pre-computed AST slices (fnNodes, markupNodes, topLevelLogic, etc.) |
| ReachabilityRecord | compiler/src/types/reachability.ts | closures Map<EntryPointId, RolePlayableSurface> — Stage 7.6 output [S89] |

## Task-Shape Routing

| Task shape | Where to look |
|------------|---------------|
| null/absence migration | docs/changes/null-eradication-*, undefined-eradication-*, stdlib-phase-1-5-null-sweep; SPEC §42.1.1 |
| Approach A continuation | A-2.3 onward: reachability-solver.ts, compiler/src/reachability/, types/reachability.ts; docs/changes/a2-2-component-1/ |
| §13.2 async stdlib gaps | stdlib/http/index.scrml lines 65/264 (W-TRY-CATCH fires); docs/changes/§13.2-impl-phase-D-E/ |
| M-7C-D-12 sentinel impl | docs/changes/m-7c-d-12-runtime-sentinel-scoping/SCOPING.md; 3-OQ prerequisite |
| A-3 auth-graph | docs/changes/a3-auth-graph-scoping/SCOPING.md |
| §36 input follow-on | docs/changes/§36-impl-phase-1..4/ closed; no open sub-phases at S89 close |

## Tags
#scrmlts #map #domain #concepts #pipeline #engine #reactive #s89 #v0.3 #approach-a #approach-a2 #reachability #lift-fixes-complete #safecall #stdlib-host #null-eradication #input-devices #auto-await #wave4-closed

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [schema.map.md](./schema.map.md)
- [error.map.md](./error.map.md)
