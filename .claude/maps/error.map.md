# error.map.md
# project: scrml
# updated: 2026-07-19T21:52:34-06:00  commit: df2ac831

## Diagnostic Catalog (SPEC §34, `compiler/SPEC.md:18010-18723`)
780 distinct diagnostic codes cataloged (was 776 at the 99ae45ca/S265-wrap watermark; +4 this
window — see "New fire sites" below — NOT independently re-derived from scratch, see caveat).
§34 is a lookup index only — each code's normative definition lives in the SPEC section that
introduces it (cited in the table's Section column). Do not enumerate all codes here; grep
`compiler/SPEC.md` for a specific `E-XXX`/`W-XXX` code, or read §34 directly for the full table.
**Caveat:** this pass's +4 delta IS confirmed directly against the source diff (`git diff
99ae45ca..df2ac831 -- compiler/SPEC.md`, a `comm -13` set-diff over every `^| [EWI]-` catalog-row
first-cell — exactly 4 new codes: `E-ATTR-WRITER-CONFLICT`, `E-SESSION-CONTEXT`,
`E-SESSION-RESERVED-KEY`, `E-SESSION-VALUE`); the 776 baseline it is added to is carried
forward, NOT re-verified this pass (incremental scope, same caveat the map has carried since
~S255). An independent first-cell extraction of the CURRENT full §34 table returns a different
raw count than 780 (persistent, unresolved discrepancy — see prior-pass note below). Treat 780 as
"prior map + confirmed delta", NOT independently re-verified; a full count-methodology audit is
still owed at the next FULL_COLD_START or NON_COMPLIANCE_ONLY pass.

## Diagnostic stream partition (how severity routes)
`W-` prefix + `severity:"info"|"warning"` -> `result.warnings` (non-fatal, CLI exit unchanged). Everything else -> `result.errors` (CLI exit 1). Tests asserting on `W-*`/`I-*` codes must check BOTH streams — `result.errors.filter(...)` silently misses warning-partitioned codes. Partition logic lives in `compiler/src/api.js` (`collectErrors`, severity-keyed pushes).

## Diagnostic families by feature area (representative codes, not exhaustive)

| Area | Prefix(es) | Count | Fire site |
|---|---|---|---|
| Engine / state machine | E-ENGINE-* | 44 | symbol-table.ts, type-system.ts, engine-statechild-parser.ts |
| Type system | E-TYPE-* | 41 | type-system.ts (incl. E-TYPE-082, enum-variant construction payload-arity) |
| Component | E-COMPONENT-* | 22 | component-expander.ts, type-system.ts |
| Lifecycle annotations | E-LIFECYCLE-* / W-LIFECYCLE-* | 35 | type-system.ts (§14.12) |
| Realtime channel | E-CHANNEL-* | 18 | route-inference.ts, channel-watches.ts, emit-channel.ts (§38) |
| Syntax | E-SYNTAX-* | 14 | ast-builder.js, tokenizer.ts |
| Lint (info-tier) | W-LINT-* | 14 | lint-*.js modules |
| Foreign (`_{}` / `<foreign>`) | E-FOREIGN-* / W-FOREIGN-* | 15 | ast-builder.js, type-system.ts (§23) |
| Reactive cells | E-REACTIVE-* / E-STATE-* | 19 | type-system.ts |
| Codegen | E-CG-* | 11 | codegen/*.ts (incl. E-CG-001 protected-field egress) |
| Standalone tool | E-TOOL-* | 11 | ast-builder.js, tool-program.ts, type-system.ts, codegen/emit-tool.ts (§64, incl. E-TOOL-SERVE-*/E-TOOL-ROUTE-NEEDS-SERVE §64.9) |
| Meta (`^{}`) | E-META-* | 12 | meta-eval.ts, meta-checker.ts |
| Import | E-IMPORT-* | 10 | module-resolver.js |
| SQL | E-SQL-* | 10 | type-system.ts, sql-projection.ts, ast-builder.js (E-SQL-003 runtime-expr body), codegen/emit-server.ts + emit-tool.ts (E-SQL-004 `?{}`-without-`db=`) |
| Auth | E-AUTH-* / E-AUTH-GRAPH-* | 9 | auth-graph.ts, type-system.ts (§52) |
| Session (§20.5, NEW family this window) | E-SCOPE-012 / E-SESSION-* | 4 | type-system.ts (E-SCOPE-012, ident-walker), codegen/emit-expr.ts (E-SESSION-VALUE/E-SESSION-RESERVED-KEY sinks, drained by emit-server.ts), emit-server.ts (E-SESSION-CONTEXT context scan) |
| Schema | E-SCHEMA-* / W-SCHEMA-* | 12 | protect-analyzer.ts, type-system.ts |
| Error handling (`!{}`/fail) | E-ERROR-* | 9 | emit-logic.ts, type-system.ts |
| Functions | E-FN-* | 9 | type-system.ts |
| Route inference (client/server boundary) | E-ROUTE-* | — | route-inference.ts (§12.4 E-ROUTE-002 + E-ROUTE-005 client/server soundness) |
| Markup / element name | E-MARKUP-001 | 1 live | name-resolver.ts (§4.1 gate) + html-elements.js (`isKnownElementName` HTML∪SVG∪MathML∪custom union) |
| Control-flow-in-markup | E-CTRL-* / E-CONTROL-FLOW-IN-MARKUP | 8 | ast-builder.js |
| Protect-analyzer | E-PA-* | 7 | protect-analyzer.ts |
| Loops | E-LOOP-* | 7 | ast-builder.js, type-system.ts |
| Attributes | E-ATTR-* | 8 (+1 this window, E-ATTR-WRITER-CONFLICT) | attribute-registry.js, validators/attribute-*.ts, codegen/emit-html.ts (`analyzeWriterConflict`, NEW fire site this window) |
| API declarations | E-API-* | 7 | type-system.ts (§60) |
| CPS / batch | E-CPS-* | 6 | cps-batch-planner.ts, batch-planner.ts |
| Test blocks | E-TEST-* | 6 | codegen/emit-test.ts (§19.13) |
| Linear types | E-LIN-* | 6 | type-system.ts (§35) |
| Endpoint declarations | E-ENDPOINT-* | 6 | ast-builder.js, type-system.ts, emit-server.ts (§61) |
| Client Router / outlet | E-OUTLET-* / W-OUTLET-* | 3 | symbol-table.ts PASS 15.5 (§20.8) |
| Async/stdlib callback | E-ASYNC-* | 2 (unchanged; fire-site COVERAGE widened this window — see below) | async-stdlib-in-sync-callback guard, codegen/emit-server.ts, codegen/emit-expr.ts (client-mode sink) |
| Server-derived marshal | W-SERVER-* | 2 | server-fn / client-cell split, §6.6.9 |
| CSS (§65 native model) | E-STYLE-* / W-STYLE-* / E-THEME-* / E-DEFAULTS-* | 4 live (E-STYLE-001, E-STYLE-CONFLICT, W-STYLE-CONFLICT-POSSIBLE, E-THEME-TOKEN-UNKNOWN) | codegen/css-conflict-check.ts, api.js Stage 3.4 (§65.2); codegen/emit-theme-reset.ts (§65.3.2/§65.6) |
| Enum case | E-ENUM-VARIANT-CASE / E-ENUM-TYPE-CASE | 2 | type-system.ts (§14.4) |

## New fire sites this window (S266-S271, 99ae45ca -> df2ac831)
- **`E-ATTR-WRITER-CONFLICT`** (§5.5.3/§5.5.4, catalog addition S268, #81 writer-ownership Axiom
  ①) — a WHOLESALE reactive value writer (`class=(expr)`/`style=(expr)` — the whole attribute —
  or `value=(expr)` on a form control) shares a physical DOM surface with ANOTHER writer on the
  same element (a per-token composer like `class:name=`, or `if=`/`show=`/transitions on
  `style`, or `bind:value`). Both sites named in the message; the conflicting attribute is NOT
  emitted (byte-identical to pre-#81 behavior, so an ignored error degrades rather than breaks).
  Fires at `compiler/src/codegen/emit-html.ts`'s `analyzeWriterConflict`. Generic string
  attributes (`title=`, `id=`, `alt=`, `data-*`) have no per-token composer form and are always
  sole writers — no fire risk there.
- **`E-SCOPE-012`** (§20.5, flipped RESERVED -> LIVE this window) — `session` accessed outside a
  server-escalated function body (a client-side function, bare top-level `${ }` logic, or an
  `<endpoint>` arm). Fires in `type-system.ts`'s ident-walker (`checkLogicExprIdents`) — control
  reaches this branch only for a NON-server-context `session` reference, because a
  server-escalated fn body binds `session` into its scope chain (`annotateNodes`,
  `boundary === "server"`). Client-side session display uses the `@session` projection instead.
- **`E-SESSION-CONTEXT`** (§20.5.1, catalog addition this window) — `session.*` used in a
  server-escalated body that nonetheless has NO cookie-session request/response context: an SSE
  `server function*`, an `<endpoint>` arm, a `<machine>` method, a serverLoad cell, an in-process
  server-fn helper called by another server function, or a headless `kind="tool"` program.
- **`E-SESSION-VALUE`** (§20.5, catalog addition this window) — a BARE `session` value-use
  (returned, assigned, passed as an argument) rather than a member/index/call access. `session`
  is a request-scoped accessor, not a value. Fires in `codegen/emit-expr.ts:emitIdent`; the sink
  is reset at the start of server emission and drained by `emit-server.ts:generateServerJs`.
- **`E-SESSION-RESERVED-KEY`** (§20.5.1, catalog addition this window, B5) — a LITERAL
  `session.set("csrfToken", …)` — `csrfToken` is a compiler-owned session key (the §40.2
  server-authoritative CSRF synchronizer token); writing it would let a caller pin the token and
  defeat the double-submit check. Fires in `codegen/emit-expr.ts:emitCall`, drained by
  `emit-server.ts:generateServerJs`; a DYNAMIC-key write is additionally refused at RUNTIME (a
  no-op) by the emitted `_scrml_session_begin` setter guard in `emit-server.ts`.
- **`E-ASYNC-STDLIB-IN-SYNC-CALLBACK` fire-site coverage widened (no new code)** — the
  colorless-async Seam-A landing (GITI-037 fix + Phase-2 combinators) extends this EXISTING
  code's applicability to more shapes: a CLIENT-mode stdlib-async call in a non-awaitable
  position now also routes into the same fail-closed sink (previously server-only in practice),
  and the collection-combinator TRANSFORM (`some`/`every`/`find`/`filter`/`map`/`forEach`/
  `reduce`/`flatMap`) removes several shapes that used to hit this code by making them
  auto-await-able instead; `.sort` remains fail-closed (no async combinator exists for it).
- No other new catalog rows this window. GITI-038 (returned-closure transform) and GITI-039
  (markup-text-verbatim rejoin) are both parse/codegen COMPLETENESS fixes — they route through
  EXISTING diagnostic machinery (GITI-038 suppresses a `W-DEAD-FUNCTION` false-fire via a
  `_returnedInline` marker; GITI-039 fixes a false-POSITIVE `E-CODEGEN-INVALID-LOGIC`) and add no
  codes. Likewise i87 (§13.2 position-invariant auto-await, #87) is a codegen behavior change, no
  new code.

## New fire sites S265 window (0a79d838 -> 99ae45ca — for reference, carried from the prior pass)
- **E-THEME-TOKEN-UNKNOWN** (§65.3.2 / §65.6 / §65.10) — a `@`-sigil reference in a `#{}` value
  resolving to neither an in-scope `<theme>` token nor a declared reactive/derived cell, or a
  variant re-bind of a token absent from the global base token set. Fires in
  `compiler/src/codegen/emit-theme-reset.ts` (`lowerCssValueRefs` / `emitThemeCss`).

## semdiff (#6b P0) — a diagnostic-CONSUMING classifier, not a new code
`compiler/src/semdiff.ts` is not a new diagnostic code — it CONSUMES the compiler's diagnostic set. `classifySemdiff(base, head)` classifies a base-vs-head change by AXIS (`opaque`/`source`/`use-site`/`context`) + soundness TIER (`0` proven cosmetic / `2` behavioral), never a boolean "safe". One of its three P0 signals is a use-site diagnostic-set diff (`diffDiagnostics`) — a diagnostic that appears/disappears between versions is a Tier-2 `use-site` axis. Exposed as `scrml semdiff` (see build.map.md); pure/unit-tested. Consumers: giti MERGE, flogence REVIEW.

## Custom Error Classes (compiler-internal, one per pipeline stage)
| Class | File | Stage |
|---|---|---|
| BSError | compiler/src/block-splitter.js:59 | Block-splitter |
| TABError | compiler/src/ast-builder.js:2001 | AST builder |
| DGError | compiler/src/dependency-graph.ts:233 | Dependency graph |
| TSError | compiler/src/type-system.ts:702 | Type system |
| RIError | compiler/src/route-inference.ts:379 | Route inference |
| PAError | compiler/src/protect-analyzer.ts:127 | Protect analyzer |
| ModuleError | compiler/src/module-resolver.js:34 | Module resolution |
| MetaError | compiler/src/meta-checker.ts:67 | Meta checker |
| MetaEvalError | compiler/src/meta-eval.ts:54 | Meta eval |
| CGError | compiler/src/codegen/errors.ts:11 | Codegen (shared across all emit-*.ts) |

Line numbers not re-verified this incremental pass (this pass's diff touched type-system.ts/route-inference.ts/meta-eval.ts/ast-builder.js/codegen/collect.ts among the files above, but none of the ten Error-class declaration lines themselves; carried forward from the 99ae45ca watermark).

## Runtime error classes (emitted into generated apps, compiler/src/runtime-template.js)
`_ScrmlError` (base) -> NetworkError, ValidationError, SQLError, AuthError, TimeoutError, ParseError, NotFoundError, ConflictError. These ship in the CLIENT bundle for generated apps' `!{}` error-handling / failable-fn machinery — not this compiler's own error handling. Unchanged this window.

## Error Handling Patterns
Every pipeline stage returns/throws its own `<Stage>Error` class; `compiler/src/api.js` wraps each stage call and calls `collectErrors(stageName, result.errors, filePath)` to normalize into `{code, message, severity, stage, ...}` and partition error/warning streams. Generated scrml apps use `!{}` error-arm blocks + `fail`/`?` propagation (ErrorArm/FailExprNode/PropagateExprNode AST shapes — see schema.map.md) lowered to try/catch envelopes by emit-logic.ts.

## Global Error Boundaries
`<errors>` element (§55.8) — scrml-level component error boundary; ast-builder.js recognizes it as a structural element; codegen/emit-error-boundary.ts emits the boundary wiring (re-parses via block-splitter/ast-builder).

For the full per-session diagnostic-change narrative (S148 onward), see `docs/changelog.md` — not reproduced here.

## Tags
#scrml #map #error #diagnostics #semdiff #css65 #diagnostic-partition #result-warnings #outlet #server-shape #tool-serve #e-theme-token-unknown #link-boost #e-attr-writer-conflict #e-scope-012 #e-session-context #e-session-value #e-session-reserved-key #writer-ownership #session-establishment #colorless-async

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [schema.map.md](./schema.map.md)
- [domain.map.md](./domain.map.md)
- [build.map.md](./build.map.md)
- [auth.map.md](./auth.map.md)
