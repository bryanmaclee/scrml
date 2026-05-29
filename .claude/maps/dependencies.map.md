# dependencies.map.md
# project: scrmlts
# updated: 2026-05-29T00:00:00-06:00  commit: 9ab7aa38

## Runtime Dependencies (root package.json — v0.6.10)

`@modelcontextprotocol/sdk@1.29.0` — MCP server SDK; used for the `scrml:compiler` MCP bridge (stdlib/compiler/)
`vscode-languageserver@^9.0.1` — LSP server protocol library; used in lsp/server.js
`vscode-languageserver-textdocument@^1.0.11` — LSP text document helper; used in lsp/

## Dev / Build Dependencies (root package.json)

`@happy-dom/global-registrator@^20.8.9` — DOM simulation for browser-facing unit tests; used in compiler/tests/browser/
`@playwright/test@^1.49.0` — end-to-end test runner; used in e2e/
`happy-dom@^20.8.9` — browser environment simulation
`marked@^14.1.3` — markdown parser; used in docs/build.ts for site generation
`puppeteer@^24.40.0` — headless Chromium; used in benchmark runners

## Compiler Sub-Package Dependencies (compiler/package.json — v0.2.0)

`acorn@^8.16.0` — JavaScript parser; SPEC §22.12 — Acorn = conformance oracle ONLY; scrml-native parser at compiler/native-parser/ is the replacement arc (M6 will remove Acorn); ALSO used by `compiler/src/codegen/validate-emit.ts` as the in-process emitted-JS parse gate (E-CODEGEN-INVALID-JS backstop, S141 ratified)
`astring@^1.9.0` — JavaScript AST-to-string emitter; used in codegen expression emission

## Internal Module Graph (key import relationships)

`compiler/src/api.js` → all pipeline stages (BS, TAB, CE, NR, SYM, PA, RI, MC, ME, TS, DG, BP, AG, RS, CG) + all linters + `./codegen/validate-emit.ts` (line 36; validateEmittedArtifacts called at line 1919 when `validateEmit` option is true)
`compiler/src/codegen/validate-emit.ts` → `acorn` (in-process Acorn parse), `./errors.ts` (CGError); exports `EmitArtifact` interface, `validateEmittedArtifact`, `validateEmittedArtifacts`; NEW S141 — emitted-JS parse gate backstop (E-CODEGEN-INVALID-JS)
`compiler/src/codegen/index.ts` → `./reactive-deps.ts` (collectDerivedVarNames + collectSynthCellKeys), `./context.ts` (CompileContext), `./emit-html.ts`, `./emit-client.js`, `./emit-server.ts`, `./binding-registry.ts`, `./emit-control-flow.ts`
`compiler/src/codegen/*.ts` → `compiler/src/types/ast.ts`, `./ir.ts`, `./context.ts`, `./errors.ts`, `./scheduling.ts`
`compiler/src/codegen/context.ts` → `./binding-registry.ts`, `./errors.ts`, `./type-encoding.ts`, `./analyze.ts`, `../types/reachability.ts`; exposes `CompileContext.synthCellKeys: Set<string>` (Bug 61, S140)
`compiler/src/codegen/reactive-deps.ts` → `./collect.ts`, `../expression-parser.ts`; exports `collectDerivedVarNames`, `collectSynthCellKeys` (Bug 61 collector — dotted synth-cell keys for `@compound.<synthProp>` read routing), `extractReactiveDeps`, `extractReactiveDepsTransitive`, `iterableHasReactiveRefs`
`compiler/src/codegen/emit-expr.ts` → reads `ctx.synthCellKeys` via `EmitExprContext.synthCellKeys` to gate `@<compound>.<synthProp>` member chains to `_scrml_reactive_get("<dotted>")` (Bug 61 over-fire guard)
`compiler/src/codegen/emit-event-wiring.ts` → threads `synthCellKeys: ctx.synthCellKeys` into all `emitExprField` call sites (Bug 61 propagation); emits formFor submit handler setting compound cell + `submitted` flag (Bug 58); identifier sanitizer added S141 fix-wave
`compiler/src/codegen/emit-logic.ts` → threads `synthCellKeys` through logic-body and compound-parent emission paths (Bug 61); S141 fix-wave updates
`compiler/src/codegen/emit-control-flow.ts` → carries `synthCellKeys` in `EmitControlFlowOpts`; threads into if-chain + nested emit paths (Bug 61); NEW S141: emits hard `E-CG-003` diagnostic on no-arm-lowerable `<match>` expression (line 1621), replaces prior silent stub that produced invalid JS
`compiler/src/codegen/emit-variant-guard.ts` → threads `synthCellKeys` into variant-guard expr emission (Bug 61)
`compiler/src/codegen/emit-validators.ts` → carries `synthCellKeys` in validator emit opts (Bug 61); S141 fix-wave updates (C1 two-bound length validator)
`compiler/src/codegen/emit-form-for.ts` → Bug 58: tags synthesized compound decl with `_cellKind:"compound-parent"`, sets `formForSubmitCell` on submit binding, converts validator args to structured ExprNode form; outputs `[compoundStateDecl, formElement]`; S141 fix-wave updates
`compiler/src/codegen/emit-html.ts` → Bug 58: propagates formFor compound cell name into `BindingEntry.formForSubmitCell` during HTML walk; routes compound state-decl context into validity-surface pass
`compiler/src/codegen/emit-bindings.ts` → Bug 58: `_flatBindKey` forces flat dotted-key write on formFor synth bindings; S141 fix-wave updates (empty-${})
`compiler/src/codegen/emit-each.ts` → S141 fix-wave updates (each-block keyFn)
`compiler/src/codegen/emit-client.ts` → Bug 57: `case "each-block"` chunk-gate adds `reconciliation` + `deep_reactive` chunks (was missing, causing ReferenceError on `_scrml_reconcile_list`); threads `clientEmitTotals` (PGO P2.1)
`compiler/src/codegen/emit-lift.js` → Bug 59: string-form + AST-form per-row event handlers emitted correctly for `<tableFor>` rows; S141 fix-wave updates (await-let tilde)
`compiler/src/codegen/rewrite.ts` → S141 fix-wave updates (class:-variant lowering)
`compiler/src/codegen/scheduling.ts` → S141 fix-wave updates
`compiler/src/type-system.ts` → Bug 58: collects compound state-decls synthesized during `<formFor>` expansion and routes them into the §55 validity-surface pass so `isValid`/`errors`/`touched`/`submitted` cells are declared; imports `./codegen/context.ts`, `./types/ast.ts`, `./symbol-table.ts`; S141 fix-wave updates
`compiler/src/ast-builder.js` → S141 fix-wave updates
`compiler/src/symbol-table.ts` → `./types/ast.ts`; S141 fix-wave updates
`compiler/src/validator-arg-parser.ts` → S141 fix-wave updates
`compiler/src/route-inference.ts` → `./types/ast.ts`, `./codegen/scheduling.ts`
`compiler/src/batch-planner.ts` → `./body-dg-builder.ts`, `./cps-batch-planner.ts`
`compiler/src/cps-batch-planner.ts` → `./scheduling.ts` (Bug 55 fix: isStatementShapeStmt guard), `./body-dg-builder.ts` (Bug 56 fix: body-DG reads folded in)
`compiler/src/auth-graph.ts` → `./types/auth-graph.ts`, `./route-inference.ts`
`compiler/native-parser/parse-file.js` → `./lex.js`, `./parse-stmt.js`, `./parse-expr.js`, `./parse-markup.js`, `./translate-stmt.js`, `./translate-expr.js`
`compiler/self-host/*.scrml` → compiled by scrmlTS pipeline; not yet live in production path

## Tags
#scrmlts #map #dependencies #bun #acorn #mcp #lsp #bug57 #bug58 #bug59 #bug61 #validate-emit #e-codegen-invalid-js #v0.6.10

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
