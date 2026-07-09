# error.map.md
# project: scrml
# updated: 2026-07-09  commit: fbb4d9fd

## Diagnostic Catalog (SPEC §34, `compiler/SPEC.md:17620-18422`)
753 distinct diagnostic codes cataloged: 626 `E-*` (Error), 121 `W-*` (Warning/Info-partitioned), 6 `I-*`. §34 is a lookup index only — each code's normative definition lives in the SPEC section that introduces it (cited in the table's Section column). Do not enumerate all codes here; grep `compiler/SPEC.md` for a specific `E-XXX`/`W-XXX` code, or read §34 directly for the full table.

## Diagnostic stream partition (how severity routes)
`W-` prefix + `severity:"info"|"warning"` -> `result.warnings` (non-fatal, CLI exit unchanged). Everything else -> `result.errors` (CLI exit 1). Tests asserting on `W-*`/`I-*` codes must check BOTH streams — `result.errors.filter(...)` silently misses warning-partitioned codes. Partition logic lives in `compiler/src/api.js` (`collectErrors`, severity-keyed pushes, e.g. lines ~1036-1062, ~1567-1568 for the §65 conflict checker).

## Diagnostic families by feature area (representative codes, not exhaustive — counts from the §34 table)

| Area | Prefix(es) | Count | Fire site |
|---|---|---|---|
| Type system | E-TYPE-* | 36 | type-system.ts |
| Component | E-COMPONENT-* | 21 | component-expander.ts, type-system.ts |
| Lifecycle annotations | E-LIFECYCLE-* / W-LIFECYCLE-* | 33 | type-system.ts (§14.12) |
| Engine / state machine | E-ENGINE-* | 20 | symbol-table.ts, type-system.ts, engine-statechild-parser.ts |
| Lint (info-tier) | W-LINT-* | 14 | lint-*.js modules |
| Syntax | E-SYNTAX-* | 13 | ast-builder.js, tokenizer.ts |
| Codegen | E-CG-* | 11 | codegen/*.ts (incl. E-CG-001 protected-field egress) |
| Meta (`^{}`) | E-META-* | 10 | meta-eval.ts, meta-checker.ts |
| SQL | E-SQL-* | 9 | type-system.ts, sql-projection.ts |
| Schema | E-SCHEMA-* / W-SCHEMA-* | 12 | protect-analyzer.ts, type-system.ts |
| Import | E-IMPORT-* | 9 | module-resolver.js |
| Foreign (`_{}` / `<foreign>`) | E-FOREIGN-* | 9+ | ast-builder.js, type-system.ts (§23) |
| Error handling (`!{}`/fail) | E-ERROR-* | 9 | emit-logic.ts, type-system.ts |
| Functions | E-FN-* | 8 | type-system.ts |
| Protect-analyzer | E-PA-* | 7 | protect-analyzer.ts |
| Loops | E-LOOP-* | 7 | ast-builder.js, type-system.ts |
| Control-flow-in-markup | E-CTRL-* / E-CONTROL-FLOW-IN-MARKUP | 8 | ast-builder.js |
| Realtime channel | E-CHANNEL-* | 7+ | route-inference.ts, channel-watches.ts, emit-channel.ts (§38) |
| CPS / batch | E-CPS-* | 7 | cps-batch-planner.ts, batch-planner.ts |
| Standalone tool | E-TOOL-* | 6 | ast-builder.js, type-system.ts (§64) |
| Test blocks | E-TEST-* | 6 | codegen/emit-test.ts (§19.13) |
| Reactive cells | E-REACTIVE-* / E-STATE-* | 10 | type-system.ts |
| Linear types | E-LIN-* | 6 | type-system.ts (§35) |
| Attributes | E-ATTR-* | 6 | attribute-registry.js, validators/attribute-*.ts |
| Auth | E-AUTH-* / E-AUTH-GRAPH-* | 9 | auth-graph.ts, type-system.ts (§52) |
| API declarations | E-API-* | 7 | type-system.ts (§60) |
| Endpoint declarations | E-ENDPOINT-* | 6 | ast-builder.js, type-system.ts, emit-server.ts (§61) |
| CSS (§65 native model) | E-STYLE-* / W-STYLE-* / E-THEME-* / E-DEFAULTS-* | 3 live + several reserved | codegen/css-conflict-check.ts, api.js Stage 3.4 (§65) |
| Enum case | E-ENUM-VARIANT-CASE / E-ENUM-TYPE-CASE | 2 | type-system.ts:1737/1869 (§14.4) |

## New / notable diagnostics since the last watermark (66a3afb1 -> fbb4d9fd)
- **E-STYLE-CONFLICT** (Error, §65.2) / **W-STYLE-CONFLICT-POSSIBLE** (Info->warnings, §65.2.4) — the §65 CSS Wave-1 conflict checker. LANDED and wired: `checkCssConflicts` in `compiler/src/codegen/css-conflict-check.ts`, run post-CE as pipeline Stage 3.4 in `compiler/src/api.js`. Ratified R1-R3 Wave-1 calibration carve-outs (universal/bare-root floor-layer, class×class soft-in-Wave-1, program-scope file-bounded soft). §65.11 dry-run corpus (83 files): 0 hard fires, ~35 soft.
- **E-ENUM-VARIANT-CASE** / **E-ENUM-TYPE-CASE** (Error, §14.4) — lowercase enum type/variant name reject. `type-system.ts:1737` (type) / `:1869` (variant).
- **E-CG-001** (protected-field egress) — hardened to an acorn-EXACT fail-closed scan (`compiler/src/codegen/egress-field-scan.ts`), replacing the prior regex-based scan that could be evaded via regex/division ambiguity (g-ecg001-protected-field-regex-division-evasion, HIGH severity fix).
- **E-CHANNEL-WATCHES-UNKNOWN-TABLE** and siblings (E-CHANNEL-WATCHES-DRIVER / -CLIENT-WRITE / -BROADCAST) — §38.13 `<channel watches=>` realtime primitive; the table-shape resolver now also reads §52 `authority="server"` collections, not just `<schema>` blocks (channel-watches.ts `collectSchemaTables`).
- **E-TOOL-001..006** (§64 Standalone Tool Target) and **E-FOREIGN-LANG-DUPLICATE** / **E-FOREIGN-LANG-IN-PROGRAM** (§23.6 library foreign-lang decl) — both landed this window.
- **E-ENDPOINT-MULTI-STATEMENT-ARM** and the E-ENDPOINT-* family (§61, typed-inbound `<endpoint>`) — carried from a prior window, still current.
- W-INPUT-STATE-MARKUP-NONREACTIVE, W-RENDER-SHADOWED, W-EQ-PAYLOAD-VARIANT, W-INTERP-IN-RAW-CONTENT — Info-tier lints from recent windows, still firing.

For the full per-session diagnostic-change narrative (S148 onward), see `docs/changelog.md` — not reproduced here.

## Custom Error Classes (compiler-internal, one per pipeline stage)
| Class | File | Stage |
|---|---|---|
| BSError | compiler/src/block-splitter.js:59 | Block-splitter |
| TABError | compiler/src/ast-builder.js:1931 | AST builder |
| DGError | compiler/src/dependency-graph.ts:233 | Dependency graph |
| TSError | compiler/src/type-system.ts:694 | Type system |
| RIError | compiler/src/route-inference.ts:379 | Route inference |
| PAError | compiler/src/protect-analyzer.ts:127 | Protect analyzer |
| ModuleError | compiler/src/module-resolver.js:34 | Module resolution |
| MetaError | compiler/src/meta-checker.ts:67 | Meta checker |
| MetaEvalError | compiler/src/meta-eval.ts:54 | Meta eval |
| CGError | compiler/src/codegen/errors.ts:11 | Codegen (shared across all emit-*.ts) |

## Runtime error classes (emitted into generated apps, compiler/src/runtime-template.js)
`_ScrmlError` (base, line 2657) -> NetworkError, ValidationError, SQLError, AuthError, TimeoutError, ParseError, NotFoundError, ConflictError (lines 2665-2729). These ship in the CLIENT bundle for generated apps' `!{}` error-handling / failable-fn machinery — not this compiler's own error handling.

## Error Handling Patterns
Every pipeline stage returns/throws its own `<Stage>Error` class; `compiler/src/api.js` wraps each stage call and calls `collectErrors(stageName, result.errors, filePath)` to normalize into `{code, message, severity, stage, ...}` and partition error/warning streams. Generated scrml apps use `!{}` error-arm blocks + `fail`/`?` propagation (ErrorArm/FailExprNode/PropagateExprNode AST shapes — see schema.map.md) lowered to try/catch envelopes by emit-logic.ts.

## Global Error Boundaries
`<errors>` element (§55.8) — scrml-level component error boundary; ast-builder.js recognizes it as a structural element; codegen/emit-error-boundary.ts emits the boundary wiring (re-parses via block-splitter/ast-builder).

## Tags
#scrml #map #error #diagnostics #e-style-conflict #css65 #e-cg-001 #enum-case #diagnostic-partition #result-warnings

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [schema.map.md](./schema.map.md)
- [domain.map.md](./domain.map.md)
