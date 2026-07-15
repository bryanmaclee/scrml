# error.map.md
# project: scrml
# updated: 2026-07-14T18:58:34-06:00  commit: f079d0a9

## Diagnostic Catalog (SPEC §34, `compiler/SPEC.md:17807-18621`)
766 distinct diagnostic codes cataloged: 636 `E-*` (Error), 124 `W-*` (Warning/Info-partitioned), 6 `I-*`. Up from 753 (626/121/6) at the fbb4d9fd watermark — 13 new codes, 0 removed (all verified with fire sites in compiler/src, see below). §34 is a lookup index only — each code's normative definition lives in the SPEC section that introduces it (cited in the table's Section column). Do not enumerate all codes here; grep `compiler/SPEC.md` for a specific `E-XXX`/`W-XXX` code, or read §34 directly for the full table.

## Diagnostic stream partition (how severity routes)
`W-` prefix + `severity:"info"|"warning"` -> `result.warnings` (non-fatal, CLI exit unchanged). Everything else -> `result.errors` (CLI exit 1). Tests asserting on `W-*`/`I-*` codes must check BOTH streams — `result.errors.filter(...)` silently misses warning-partitioned codes. Partition logic lives in `compiler/src/api.js` (`collectErrors`, severity-keyed pushes).

## Diagnostic families by feature area (representative codes, not exhaustive — recomputed directly from the §34 table this pass)

| Area | Prefix(es) | Count | Fire site |
|---|---|---|---|
| Engine / state machine | E-ENGINE-* | 44 | symbol-table.ts, type-system.ts, engine-statechild-parser.ts |
| Type system | E-TYPE-* | 41 | type-system.ts (incl. new E-TYPE-082, enum-variant construction payload-arity) |
| Component | E-COMPONENT-* | 22 | component-expander.ts, type-system.ts |
| Lifecycle annotations | E-LIFECYCLE-* / W-LIFECYCLE-* | 35 | type-system.ts (§14.12) |
| Realtime channel | E-CHANNEL-* | 18 | route-inference.ts, channel-watches.ts, emit-channel.ts (§38) |
| Syntax | E-SYNTAX-* | 14 | ast-builder.js, tokenizer.ts |
| Lint (info-tier) | W-LINT-* | 14 | lint-*.js modules |
| Foreign (`_{}` / `<foreign>`) | E-FOREIGN-* / W-FOREIGN-* | 15 | ast-builder.js, type-system.ts (§23) — +1 E / +1 W this window (capability-decl checks) |
| Reactive cells | E-REACTIVE-* / E-STATE-* | 19 | type-system.ts |
| Codegen | E-CG-* | 11 | codegen/*.ts (incl. E-CG-001 protected-field egress) |
| Standalone tool | E-TOOL-* | 11 | ast-builder.js, tool-program.ts, type-system.ts, codegen/emit-tool.ts (§64) — +5 this window (E-TOOL-SERVE-*/E-TOOL-ROUTE-NEEDS-SERVE, §64.9) |
| Meta (`^{}`) | E-META-* | 12 | meta-eval.ts, meta-checker.ts |
| Import | E-IMPORT-* | 10 | module-resolver.js |
| SQL | E-SQL-* | 10 | type-system.ts, sql-projection.ts |
| Auth | E-AUTH-* / E-AUTH-GRAPH-* | 9 | auth-graph.ts, type-system.ts (§52) |
| Schema | E-SCHEMA-* / W-SCHEMA-* | 12 | protect-analyzer.ts, type-system.ts (E-SCHEMA-001/002/004 + W-SCHEMA-001 wired this window) |
| Error handling (`!{}`/fail) | E-ERROR-* | 9 | emit-logic.ts, type-system.ts |
| Functions | E-FN-* | 9 | type-system.ts |
| Control-flow-in-markup | E-CTRL-* / E-CONTROL-FLOW-IN-MARKUP | 8 | ast-builder.js |
| Protect-analyzer | E-PA-* | 7 | protect-analyzer.ts |
| Loops | E-LOOP-* | 7 | ast-builder.js, type-system.ts |
| Attributes | E-ATTR-* | 7 | attribute-registry.js, validators/attribute-*.ts |
| API declarations | E-API-* | 7 | type-system.ts (§60) |
| CPS / batch | E-CPS-* | 6 | cps-batch-planner.ts, batch-planner.ts |
| Test blocks | E-TEST-* | 6 | codegen/emit-test.ts (§19.13) |
| Linear types | E-LIN-* | 6 | type-system.ts (§35) |
| Endpoint declarations | E-ENDPOINT-* | 6 | ast-builder.js, type-system.ts, emit-server.ts (§61) |
| Client Router / outlet | E-OUTLET-* / W-OUTLET-* | 3 | symbol-table.ts PASS 15.5 (§20.8, NEW this window) |
| Async/stdlib callback | E-ASYNC-* | 2 | (§ async-stdlib-in-sync-callback guard, NEW this window) |
| Server-derived marshal | W-SERVER-* | 2 | (server-fn / client-cell split, §6.6.9) |
| CSS (§65 native model) | E-STYLE-* / W-STYLE-* / E-THEME-* / E-DEFAULTS-* | 3 live (E-STYLE-001, E-STYLE-CONFLICT, W-STYLE-CONFLICT-POSSIBLE), 0 reserved-named | codegen/css-conflict-check.ts, api.js Stage 3.4 (§65) |
| Enum case | E-ENUM-VARIANT-CASE / E-ENUM-TYPE-CASE | 2 | type-system.ts (§14.4) |

## New diagnostics since the last watermark (fbb4d9fd -> f079d0a9, +13 codes, all verified with fire sites)
- **E-TOOL-SERVE-MISPLACED / -PORT-INVALID / -AUTH-UNSUPPORTED / -MAIN-EXITS / E-TOOL-ROUTE-NEEDS-SERVE** (§64.9) — the `<program kind="tool" serve=PORT>` listener-owning headless serve-target (Track A Fork 1A, Units 1+2, LANDED this window). A serve= tool emits a compiler-owned `Bun.serve({port, fetch, websocket?})` harness hosting its `<endpoint>`/SSE routes; cookie-session auth is unsupported on this headless shape (fail-closed); `main`'s return type must be dropped when `serve=` supplies the live-process handle instead. Fire sites: attribute-registry.js, symbol-table.ts, tool-program.ts, codegen/emit-tool.ts, codegen/emit-server.ts.
- **E-OUTLET-DUPLICATE / E-OUTLET-OUTSIDE-SHELL / W-OUTLET-ABSENT-SOFT-NAV-DISABLED** (§20.8, the Client Router / soft navigation) — `<outlet>` persistent-shell region + `<a>` link-boost soft-nav, landed Wave-1a/1b this window. V1 supports exactly one flat `<outlet>` per shell. Fire site: symbol-table.ts (`<outlet>` placement pass). NOTE: the SPEC §20.8 banner itself still reads "Nominal / spec-ahead (S250)" for the section as a whole — keep-alive (§20.8.4, W-KEEPALIVE-* codes) has NO fire site / no tests yet and remains genuinely spec-ahead; the outlet+soft-nav core (§20.8.1-3) is landed and current-truth.
- **E-TYPE-082** (§18, enum-variant construction payload-arity — "fail-arity ruling") — mint this window.
- **E-ASYNC-STDLIB-IN-SYNC-CALLBACK** — guards against a sync-classified callback silently swallowing an async `scrml:*` stdlib call (same defense-in-depth family as the STDLIB-EXPORT-SEED fail-closed fix, see dependencies.map.md).
- **E-FOREIGN-CAPABILITY-UNKNOWN / W-FOREIGN-UNDECLARED-CAPABILITY** (§23.5 capability vocab) — capability-declaration checks wired this window.
- **W-SERVER-DERIVED-MARSHAL** (§6.6.9, server-fn / client-cell read split — "THE SPLIT") — CPS marshal boundary warning.

## Prior-window diagnostics (still current, unchanged this pass)
- **E-STYLE-CONFLICT** / **W-STYLE-CONFLICT-POSSIBLE** — the §65 CSS Wave-1 conflict checker. `checkCssConflicts` in `compiler/src/codegen/css-conflict-check.ts`, run post-CE as pipeline Stage 3.4 in `compiler/src/api.js`.
- **E-ENUM-VARIANT-CASE** / **E-ENUM-TYPE-CASE** (§14.4) — lowercase enum type/variant name reject.
- **E-CG-001** (protected-field egress) — acorn-EXACT fail-closed scan (`compiler/src/codegen/egress-field-scan.ts`).
- **E-CHANNEL-WATCHES-*** family (§38.13 `<channel watches=>` realtime primitive).

For the full per-session diagnostic-change narrative (S148 onward), see `docs/changelog.md` — not reproduced here.

## Custom Error Classes (compiler-internal, one per pipeline stage — line numbers re-verified this pass, several shifted)
| Class | File | Stage |
|---|---|---|
| BSError | compiler/src/block-splitter.js:59 | Block-splitter |
| TABError | compiler/src/ast-builder.js:1996 (was :1931 — file grew +573/-? lines this window) | AST builder |
| DGError | compiler/src/dependency-graph.ts:233 | Dependency graph |
| TSError | compiler/src/type-system.ts:702 (was :694) | Type system |
| RIError | compiler/src/route-inference.ts:379 | Route inference |
| PAError | compiler/src/protect-analyzer.ts:127 | Protect analyzer |
| ModuleError | compiler/src/module-resolver.js:34 | Module resolution |
| MetaError | compiler/src/meta-checker.ts:67 | Meta checker |
| MetaEvalError | compiler/src/meta-eval.ts:54 | Meta eval |
| CGError | compiler/src/codegen/errors.ts:11 | Codegen (shared across all emit-*.ts) |

## Runtime error classes (emitted into generated apps, compiler/src/runtime-template.js — line numbers shifted +361 this window)
`_ScrmlError` (base, line 3018) -> NetworkError (3026), ValidationError (3034), SQLError (3042), AuthError (3050), TimeoutError (3058), ParseError (3066), NotFoundError (3074), ConflictError (3082). These ship in the CLIENT bundle for generated apps' `!{}` error-handling / failable-fn machinery — not this compiler's own error handling.

## Error Handling Patterns
Every pipeline stage returns/throws its own `<Stage>Error` class; `compiler/src/api.js` wraps each stage call and calls `collectErrors(stageName, result.errors, filePath)` to normalize into `{code, message, severity, stage, ...}` and partition error/warning streams. Generated scrml apps use `!{}` error-arm blocks + `fail`/`?` propagation (ErrorArm/FailExprNode/PropagateExprNode AST shapes — see schema.map.md) lowered to try/catch envelopes by emit-logic.ts.

## Global Error Boundaries
`<errors>` element (§55.8) — scrml-level component error boundary; ast-builder.js recognizes it as a structural element; codegen/emit-error-boundary.ts emits the boundary wiring (re-parses via block-splitter/ast-builder).

## Tags
#scrml #map #error #diagnostics #e-style-conflict #css65 #e-cg-001 #enum-case #diagnostic-partition #result-warnings #outlet #server-shape #tool-serve

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [schema.map.md](./schema.map.md)
- [domain.map.md](./domain.map.md)
