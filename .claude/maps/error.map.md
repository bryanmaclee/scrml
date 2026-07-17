# error.map.md
# project: scrml
# updated: 2026-07-17T14:48:56-06:00  commit: 0a79d838

## Diagnostic Catalog (SPEC §34, `compiler/SPEC.md:17832-18649`)
775 distinct diagnostic codes cataloged: 641 `E-*` (Error), 127 `W-*` (Warning/Info-partitioned), 7 `I-*` (recomputed this pass directly from the §34 table by first-cell extraction). Up from 766 (636/124/6) at the f079d0a9 (S255) watermark — net +9. The map watermark was S255, not S263, so the bulk of the +9 accrued across S256-S263 §34 maintenance (the #83/#85 catalog cleanup: retire 6 dead codes + reserve 10 spec-ahead + repoint E-CTX-002; plus conformance-driven mints E-CTRL-010 / E-LIN-004/005 / E-ROUTE-005 …). The S264 window (this pass) added NO new catalog rows — its three source PRs wired FIRE SITES to already-NAMED codes (E-SQL-003, E-SQL-004, E-MARKUP-001), moving them from reserved/named to firing (see "New fire sites this window" below). §34 is a lookup index only — each code's normative definition lives in the SPEC section that introduces it (cited in the table's Section column). Do not enumerate all codes here; grep `compiler/SPEC.md` for a specific `E-XXX`/`W-XXX` code, or read §34 directly for the full table.

## Diagnostic stream partition (how severity routes)
`W-` prefix + `severity:"info"|"warning"` -> `result.warnings` (non-fatal, CLI exit unchanged). Everything else -> `result.errors` (CLI exit 1). Tests asserting on `W-*`/`I-*` codes must check BOTH streams — `result.errors.filter(...)` silently misses warning-partitioned codes. Partition logic lives in `compiler/src/api.js` (`collectErrors`, severity-keyed pushes). The fatal `E-MARKUP-001` (§4.1) rides the same partition — `api.js:1578-1580` preserves it through `collectErrors` and routes it to `result.errors` (see gate below).

## Diagnostic families by feature area (representative codes, not exhaustive — recomputed directly from the §34 table)

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
| Schema | E-SCHEMA-* / W-SCHEMA-* | 12 | protect-analyzer.ts, type-system.ts |
| Error handling (`!{}`/fail) | E-ERROR-* | 9 | emit-logic.ts, type-system.ts |
| Functions | E-FN-* | 9 | type-system.ts |
| Route inference (client/server boundary) | E-ROUTE-* | — | route-inference.ts (§12.4 E-ROUTE-002 + E-ROUTE-005 client/server soundness, landed S263) |
| Markup / element name | E-MARKUP-001 | 1 live | name-resolver.ts (§4.1 gate) + html-elements.js (`isKnownElementName` HTML∪SVG∪MathML∪custom union) — NOW FIRING (S264) |
| Control-flow-in-markup | E-CTRL-* / E-CONTROL-FLOW-IN-MARKUP | 8 | ast-builder.js |
| Protect-analyzer | E-PA-* | 7 | protect-analyzer.ts |
| Loops | E-LOOP-* | 7 | ast-builder.js, type-system.ts |
| Attributes | E-ATTR-* | 7 | attribute-registry.js, validators/attribute-*.ts |
| API declarations | E-API-* | 7 | type-system.ts (§60) |
| CPS / batch | E-CPS-* | 6 | cps-batch-planner.ts, batch-planner.ts |
| Test blocks | E-TEST-* | 6 | codegen/emit-test.ts (§19.13) |
| Linear types | E-LIN-* | 6 | type-system.ts (§35) |
| Endpoint declarations | E-ENDPOINT-* | 6 | ast-builder.js, type-system.ts, emit-server.ts (§61) |
| Client Router / outlet | E-OUTLET-* / W-OUTLET-* | 3 | symbol-table.ts PASS 15.5 (§20.8) |
| Async/stdlib callback | E-ASYNC-* | 2 | async-stdlib-in-sync-callback guard |
| Server-derived marshal | W-SERVER-* | 2 | server-fn / client-cell split, §6.6.9 |
| CSS (§65 native model) | E-STYLE-* / W-STYLE-* / E-THEME-* / E-DEFAULTS-* | 3 live (E-STYLE-001, E-STYLE-CONFLICT, W-STYLE-CONFLICT-POSSIBLE) | codegen/css-conflict-check.ts, api.js Stage 3.4 (§65) |
| Enum case | E-ENUM-VARIANT-CASE / E-ENUM-TYPE-CASE | 2 | type-system.ts (§14.4) |

## New fire sites this window (S264, f079d0a9 -> 0a79d838 — NO new catalog rows; three NAMED codes moved to firing)
- **E-MARKUP-001** (§4.1 "unknown HTML element name", PR #93) — now FIRES. Gate in `compiler/src/name-resolver.ts:452-467`: a markup opener whose name is neither a known element nor a defined component fails. Element-name knowledge is the NEW `isKnownElementName()` in `compiler/src/html-elements.js:1066` — the UNION of the complete standard-HTML set, SVG (camelCase + lowercased mirror), MathML, the curated `REGISTRY`, and the custom-element (hyphenated-lowercase) grammar, erring toward zero false positives (the sibling E-MARKUP-002 was retired over 205 corpus false-positives). The gate also excludes scrml-structural tags via `SCRML_NON_ELEMENT_TAGS` — a set DERIVED (not hand-copied) from `ast-builder.js`'s two NEW exports `STRUCTURAL_ELEMENT_PLACEMENT` (§4.15 locus-restricted structural elements) and `RESERVED_CSS_ELEMENT_IDENTIFIERS` (§65 theme/defaults), so a new structural element auto-excludes without a parallel edit. Only all-lowercase ASCII names (`isPlausibleHtmlElementName`) are candidates — camelCase state/channel cells never fire. `api.js` routes it to `result.errors` (fatal).
- **E-SQL-003** (§8.1.1, PR #92) — now FIRES. `compiler/src/ast-builder.js`: new `sqlBodyIsRuntimeExpr(query)` helper (`:13328`) + fire at `buildBlock case "sql"` (`:17354`) when a `?{}` SQL template body is a pure runtime expression rather than a SQL literal.
- **E-SQL-004** (§44.7, PR #90) — now FIRES. `compiler/src/codegen/emit-server.ts:3936-4003` + `emit-tool.ts:421-434`: a `?{}` SQL block with no `db=` in any ancestor `<program>` is a fail-CLOSED error (previously shipped a silent `:memory:` fallback). A defensive `:memory:` stub still follows the diagnostic so the emitted file parses.

## New analysis surface this window (S264) — semdiff (#6b P0), a diagnostic-CONSUMING classifier
`compiler/src/semdiff.ts` (PR #91) is not a new diagnostic code — it is a new module that CONSUMES the compiler's diagnostic set. `classifySemdiff(base, head)` classifies a base-vs-head change by AXIS (`opaque` / `source` / `use-site` / `context`) + soundness TIER (`0` proven cosmetic / `2` behavioral), never a boolean "safe". One of its three P0 signals is a use-site diagnostic-set diff (`diffDiagnostics`) — a diagnostic that appears/disappears between versions is a Tier-2 `use-site` axis (delivers giti's `E-TYPE-063` rename↔use separator). An opaque region (foreign `_{}` block, unresolved import, dynamic dispatch) is forced Tier-2 by construction. Exposed as `scrml semdiff` (see build.map.md); the classifier is pure/unit-tested. Consumers: giti MERGE, flogence REVIEW.

## Custom Error Classes (compiler-internal, one per pipeline stage)
| Class | File | Stage |
|---|---|---|
| BSError | compiler/src/block-splitter.js:59 | Block-splitter |
| TABError | compiler/src/ast-builder.js:2001 (was :1996 — file grew +278 this window) | AST builder |
| DGError | compiler/src/dependency-graph.ts:233 | Dependency graph |
| TSError | compiler/src/type-system.ts:702 | Type system |
| RIError | compiler/src/route-inference.ts:379 | Route inference |
| PAError | compiler/src/protect-analyzer.ts:127 | Protect analyzer |
| ModuleError | compiler/src/module-resolver.js:34 | Module resolution |
| MetaError | compiler/src/meta-checker.ts:67 | Meta checker |
| MetaEvalError | compiler/src/meta-eval.ts:54 | Meta eval |
| CGError | compiler/src/codegen/errors.ts:11 | Codegen (shared across all emit-*.ts) |

## Runtime error classes (emitted into generated apps, compiler/src/runtime-template.js)
`_ScrmlError` (base) -> NetworkError, ValidationError, SQLError, AuthError, TimeoutError, ParseError, NotFoundError, ConflictError. These ship in the CLIENT bundle for generated apps' `!{}` error-handling / failable-fn machinery — not this compiler's own error handling. (Line numbers not re-verified this incremental pass — runtime-template.js was not in the S264 change set; re-verify on a full refresh.)

## Error Handling Patterns
Every pipeline stage returns/throws its own `<Stage>Error` class; `compiler/src/api.js` wraps each stage call and calls `collectErrors(stageName, result.errors, filePath)` to normalize into `{code, message, severity, stage, ...}` and partition error/warning streams. Generated scrml apps use `!{}` error-arm blocks + `fail`/`?` propagation (ErrorArm/FailExprNode/PropagateExprNode AST shapes — see schema.map.md) lowered to try/catch envelopes by emit-logic.ts.

## Global Error Boundaries
`<errors>` element (§55.8) — scrml-level component error boundary; ast-builder.js recognizes it as a structural element; codegen/emit-error-boundary.ts emits the boundary wiring (re-parses via block-splitter/ast-builder).

For the full per-session diagnostic-change narrative (S148 onward), see `docs/changelog.md` — not reproduced here.

## Tags
#scrml #map #error #diagnostics #e-sql-003 #e-sql-004 #e-markup-001 #semdiff #e-style-conflict #css65 #e-cg-001 #diagnostic-partition #result-warnings #outlet #server-shape #tool-serve

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [schema.map.md](./schema.map.md)
- [domain.map.md](./domain.map.md)
- [build.map.md](./build.map.md)
