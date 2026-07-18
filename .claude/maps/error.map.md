# error.map.md
# project: scrml
# updated: 2026-07-18T08:36:53-06:00  commit: 99ae45ca

## Diagnostic Catalog (SPEC §34, `compiler/SPEC.md:17832-18650`)
776 distinct diagnostic codes cataloged (was 775 at the 0a79d838/S264 watermark; +1 this pass, NOT
independently re-derived from scratch — see caveat). §34 is a lookup index only — each code's
normative definition lives in the SPEC section that introduces it (cited in the table's Section
column). Do not enumerate all codes here; grep `compiler/SPEC.md` for a specific `E-XXX`/`W-XXX`
code, or read §34 directly for the full table.
**Caveat:** this pass's +1 delta is confirmed directly from the S265 source diff (one new catalog
row, `E-THEME-TOKEN-UNKNOWN` — see below); the map does NOT re-verify the full 775 baseline this
pass (incremental scope). An independent first-cell extraction of the CURRENT §34 table returns 758
distinct codes (627 E / 124 W / 6 I via `grep -oE '^\| [EWI]-[A-Za-z0-9-]+'` over the §34 line range)
— a persistent, unresolved discrepancy against the 775/776 figure carried in this map since at least
S255, whose extraction methodology was not fully re-derivable this pass. Treat the 776 figure as
"prior map + confirmed delta", NOT as independently re-verified; a full non-compliance/count audit
of this map's own methodology is advisable at the next FULL_COLD_START or NON_COMPLIANCE_ONLY pass.

## Diagnostic stream partition (how severity routes)
`W-` prefix + `severity:"info"|"warning"` -> `result.warnings` (non-fatal, CLI exit unchanged). Everything else -> `result.errors` (CLI exit 1). Tests asserting on `W-*`/`I-*` codes must check BOTH streams — `result.errors.filter(...)` silently misses warning-partitioned codes. Partition logic lives in `compiler/src/api.js` (`collectErrors`, severity-keyed pushes). The fatal `E-MARKUP-001` (§4.1) rides the same partition — `api.js` preserves it through `collectErrors` and routes it to `result.errors`.

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
| Schema | E-SCHEMA-* / W-SCHEMA-* | 12 | protect-analyzer.ts, type-system.ts |
| Error handling (`!{}`/fail) | E-ERROR-* | 9 | emit-logic.ts, type-system.ts |
| Functions | E-FN-* | 9 | type-system.ts |
| Route inference (client/server boundary) | E-ROUTE-* | — | route-inference.ts (§12.4 E-ROUTE-002 + E-ROUTE-005 client/server soundness) |
| Markup / element name | E-MARKUP-001 | 1 live | name-resolver.ts (§4.1 gate) + html-elements.js (`isKnownElementName` HTML∪SVG∪MathML∪custom union) |
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
| CSS (§65 native model) | E-STYLE-* / W-STYLE-* / E-THEME-* / E-DEFAULTS-* | 4 live (E-STYLE-001, E-STYLE-CONFLICT, W-STYLE-CONFLICT-POSSIBLE, **E-THEME-TOKEN-UNKNOWN NEW S265**) | codegen/css-conflict-check.ts, api.js Stage 3.4 (§65.2); codegen/emit-theme-reset.ts (§65.3.2/§65.6, NEW S265) |
| Enum case | E-ENUM-VARIANT-CASE / E-ENUM-TYPE-CASE | 2 | type-system.ts (§14.4) |

## New fire sites this window (S265, 0a79d838 -> 99ae45ca)
- **E-THEME-TOKEN-UNKNOWN** (§65.3.2 / §65.6 / §65.10, PR #95 "CSS Wave-1 emission") — NEW catalog
  row, now FIRES. Two decidable arms, both in `compiler/src/codegen/emit-theme-reset.ts`
  (`lowerCssValueRefs` / `emitThemeCss`, run inside `generateCss`): **(a) use-site** — a `@`-sigil
  reference in a `#{}` value (`color: @brand`) whose name resolves to neither an in-scope `<theme>`
  token nor a declared reactive/derived cell (a BARE identifier like `color: red` never fires — the
  `@` sigil is what makes this decidable and false-positive-free); **(b) variant re-bind** — a
  `<theme>` variant (`.Dark {...}`) or `@media` auto-bind re-binding a token name absent from the
  GLOBAL base token set (union across every `<theme>` block in scope). Partitions into `result.errors`.
- No other new catalog rows this window. The #82 (content-hash/cache), #29-D (bare `@var` bool-attr
  routing), and #27 (link-boost click-interception) PRs are behavior/codegen fixes that route through
  EXISTING diagnostic machinery (or add none) — no new codes.

## New fire sites S264 window (f079d0a9 -> 0a79d838 — for reference, three NAMED codes moved to firing, no new catalog rows)
- **E-MARKUP-001** (§4.1 "unknown HTML element name") — FIRES. Gate in `compiler/src/name-resolver.ts`: a markup opener whose name is neither a known element nor a defined component fails. Element-name knowledge is `isKnownElementName()` in `compiler/src/html-elements.js` — the UNION of the complete standard-HTML set, SVG, MathML, the curated `REGISTRY`, and the custom-element grammar. The gate excludes scrml-structural tags via `SCRML_NON_ELEMENT_TAGS`, derived from ast-builder.js's `STRUCTURAL_ELEMENT_PLACEMENT` + `RESERVED_CSS_ELEMENT_IDENTIFIERS` exports.
- **E-SQL-003** (§8.1.1) — FIRES. `compiler/src/ast-builder.js`'s `sqlBodyIsRuntimeExpr(query)` fires at `buildBlock case "sql"` when a `?{}` SQL template body is a pure runtime expression rather than a SQL literal.
- **E-SQL-004** (§44.7) — FIRES. `compiler/src/codegen/emit-server.ts` + `emit-tool.ts`: a `?{}` SQL block with no `db=` in any ancestor `<program>` is a fail-CLOSED error (a defensive `:memory:` stub still follows so the emitted file parses).

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

Line numbers not re-verified this incremental pass for files outside the S265 change set (api.js, attribute-registry.js, codegen/collect.ts, codegen/index.ts, component-expander.ts, codegen/emit-html.ts, codegen/emit-client.ts, codegen/emit-reactive-wiring.ts, codegen/emit-css.ts, html-elements.js, runtime-template.js — all of which DID change this window, but none of the ten Error-class definitions above live in those files).

## Runtime error classes (emitted into generated apps, compiler/src/runtime-template.js)
`_ScrmlError` (base) -> NetworkError, ValidationError, SQLError, AuthError, TimeoutError, ParseError, NotFoundError, ConflictError. These ship in the CLIENT bundle for generated apps' `!{}` error-handling / failable-fn machinery — not this compiler's own error handling. **runtime-template.js WAS touched this window (S265, adopter #27)** — it gained the §20.8.3 link-boost click-interception functions (`_scrml_link_ensure_click`, `_scrml_link_click_handler`), which are behavior, not new error classes; the `_ScrmlError` hierarchy itself is unchanged.

## Error Handling Patterns
Every pipeline stage returns/throws its own `<Stage>Error` class; `compiler/src/api.js` wraps each stage call and calls `collectErrors(stageName, result.errors, filePath)` to normalize into `{code, message, severity, stage, ...}` and partition error/warning streams. Generated scrml apps use `!{}` error-arm blocks + `fail`/`?` propagation (ErrorArm/FailExprNode/PropagateExprNode AST shapes — see schema.map.md) lowered to try/catch envelopes by emit-logic.ts.

## Global Error Boundaries
`<errors>` element (§55.8) — scrml-level component error boundary; ast-builder.js recognizes it as a structural element; codegen/emit-error-boundary.ts emits the boundary wiring (re-parses via block-splitter/ast-builder).

For the full per-session diagnostic-change narrative (S148 onward), see `docs/changelog.md` — not reproduced here.

## Tags
#scrml #map #error #diagnostics #e-sql-003 #e-sql-004 #e-markup-001 #semdiff #e-style-conflict #css65 #e-cg-001 #diagnostic-partition #result-warnings #outlet #server-shape #tool-serve #e-theme-token-unknown #link-boost

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [schema.map.md](./schema.map.md)
- [domain.map.md](./domain.map.md)
- [build.map.md](./build.map.md)
