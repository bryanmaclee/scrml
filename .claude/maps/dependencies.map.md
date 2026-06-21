# dependencies.map.md
# project: scrmlts
# updated: 2026-06-21  commit: 8569f774

## Runtime Dependencies (root package.json — v0.7.0)
@modelcontextprotocol/sdk@1.29.0 — MCP server SDK for scrml MCP integration
vscode-languageserver@^9.0.1 — LSP server protocol implementation
vscode-languageserver-textdocument@^1.0.11 — LSP text document utilities

## Dev / Build Dependencies (root package.json)
@happy-dom/global-registrator@^20.8.9 — DOM environment for browser tests
happy-dom@^20.8.9 — fast in-process DOM for Bun unit tests
marked@^14.1.3 — Markdown parser used by docs/build.ts
puppeteer@^24.40.0 — headless browser for e2e / Playwright support
@playwright/test@^1.49.0 — Playwright test framework for e2e tests

## Runtime Dependencies (compiler/package.json — compiler workspace)
acorn@^8.16.0 — JS parser used for escape-hatch expression parsing in ast-builder
astring@^1.9.0 — JS AST-to-source printer; used with acorn for re-serializing escape-hatch nodes

## Dev Dependencies (compiler/package.json)
@happy-dom/global-registrator@^20.8.9 — DOM environment for compiler browser tests

## Runtime Engine
bun>=1.3.13 — required runtime; no Node support (Bun-specific APIs used throughout)

## Internal Module Graph (major imports, compiler/src/)

| Module | Imports from |
|--------|-------------|
| cli.js | commands/compile.js, commands/dev.js, commands/build.js, commands/migrate.js, commands/promote.js |
| api.js | block-splitter.js, ast-builder.js, code-generator.js, module-resolver.js, component-expander.ts, type-system.ts, engine-graph.ts (S149 — buildEngineGraphJson); **S211: + lint-w-interp-in-raw-content.js (Stage 2.5 wiring, line 52)** |
| code-generator.js (codegen/index.ts) | codegen/emit-*.ts, codegen/srcmap-provenance.ts, codegen/build-source-map.ts, codegen/source-map.ts, dependency-graph.ts, auth-graph.ts, route-inference.ts |
| codegen/emit-client.ts | codegen/emit-*.ts, codegen/runtime-chunks.ts, codegen/context.ts; derives _scrml_modules key via moduleRegistryKey() |
| codegen/emit-engine.ts | codegen/emit-*.ts; emitEngineOpenerEffect() for §51.0.H Form 3 (S148); **S198-S199 engine-hydration arc emitEngineCellHydrationInit/emitEngineServerSourceHydration** |
| codegen/emit-reactive-wiring.ts | codegen/collect.ts, codegen/reactive-deps.ts, codegen/emit-engine.ts (require), codegen/emit-sync.ts, codegen/emit-channel.ts, codegen/emit-parse-variant.ts (`emitParseVariantDecodeIIFE` — S212 A2 W4); **S210 dual-table-fix: isModernEngine skip (empty machine.rules) for both buildMachineBindingsMap §51.3 write-guard and emitReactiveWiring §51.3 table emission — modern engines route exclusively via §51.0 engineBindings/emitEngineWriteGuard**; **S212 A2 W4: `buildApiEndpointRegistry` flattens `api-decl` nodes into `ApiEndpointForEmit` {base, method, path, reqShape, responseEnum}; `emitApiUrlExpr` lowers `${param}` path templates to `encodeURIComponent` substitutions; `emitRequestNode` api= branch emits the full §6.7.7 reactive surface (loading/data/error/stale, seq-guard, `refetch`, args-cell `_scrml_effect`, mounted cleanup); ENUM ResponseT drives `emitParseVariantDecodeIIFE` → automatic parseVariant decode (→ .data/::ParseError → .error); NO .server.js (§60.6 pure-client)** |
| codegen/emit-each.ts | codegen/context.ts; emitEachBodyRenderForFile() guards undefined cell pre-init (S152) |
| codegen/emit-server.ts | codegen/emit-*.ts, codegen/emit-channel.ts |
| codegen/emit-error-boundary.ts | block-splitter.js, ast-builder.js (re-parse pipeline) |
| codegen/emit-variant-guard.ts | **engine-statechild-grammar.ts** (ENGINE_STATE_CHILD_RESERVED_ATTRS + STATE_CHILD_STRUCTURAL_TAGS — ss2 item 3 SSOT dedup; replaces inline literal sets); codegen/emit-control-flow.ts (`rewriteBlockBody` — lazy require); codegen/emit-engine.ts (buildEngineBindingsMap/collectEngineVarNames — lazy require); **S212 Bug B: `emitArmWireFunction` now collects `wireableDirectives` (logic-bindings with `kind==="class-directive"` OR `kind==="attr-template"` tagged with the current arm's `armContextId`) and emits per-element `classList.toggle`/`setAttribute` + `_scrml_effect` pushed onto `_disposers` — torn down on next variant change** |
| codegen/emit-html.ts | (generates HTML; self-contained with registry callbacks); **S212 Bug A: on*=<bare-non-@-identifier> attr-value routes to `addEventBinding({bareRefHandler:true})` instead of literal attribute emission [emit-html.ts:1910-1931]**; **S212 Bug B: `class:` directive and interpolated string-literal attr inside a `registry.currentArmContext != null` context calls `registry.addLogicBinding({kind:"class-directive"/"attr-template", directiveSelector, directiveJsExpr, directiveRefs})` [emit-html.ts:1831-1882] so emitArmWireFunction can wire them per-mount** |
| codegen/emit-event-wiring.ts | (event wiring pass); **S212 Bug A: `binding.bareRefHandler` branch resolves `handlerName` through `fnNameMap` to `_scrml_<name>_N` and uses that reference DIRECTLY as the listener value (no `function(event){ fn(); }` wrap) [emit-event-wiring.ts:567-572]**; **S212 Bug B: arm-tagged `class-directive`/`attr-template` bindings are filtered OUT of global init emission [emit-event-wiring.ts:320] — a module-init `document.querySelector` on a stale/absent arm element would cache nothing** |
| codegen/emit-bindings.ts | expression-parser.ts, emit-expr.ts, collect.ts (getNodes), rewrite.js, emit-predicates.ts; **S212 Bug B: lowering helpers `lowerClassDirectiveCondition` + `lowerAttrTemplateValue` are now used by BOTH the top-level emit-bindings.ts pass AND the new arm-tagged path in emit-html.ts (same helpers → identical JS output shape)** |
| codegen/binding-registry.ts | (pure data; no imports); **S212 Bug A: `EventBinding.bareRefHandler?: boolean` field (line ~99)**; **S212 Bug B: `LogicBinding.kind` extended with `"class-directive"` and `"attr-template"` variants; `directiveSelector`/`directiveJsExpr`/`directiveRefs`/`className`/`attrName` carry the lowered directive data; arm-tagged logic-binding filter in `emitArmWireFunction` keyed on these kinds** |
| codegen/emit-expr.ts | codegen/rewrite.js (rewriteExpr/rewriteServerExpr chain), codegen/emit-parse-variant.ts, codegen/emit-control-flow.ts, symbol-table.ts (SYNTH_PROPERTY_NAMES), codegen/srcmap-provenance.ts, codegen/log-loc.ts (resolveLogLoc), emit-lift.js (emitMarkupValueExpr); **S210 ss3: paren-grouping preservation case added (BinaryExpr/TernaryExpr/AssignExpr wrapped in paren-receiver position — no new external deps)** |
| codegen/rewrite.ts | codegen/var-counter.ts (genVar), codegen/compat/parser-workarounds.js (splitBareExprStatements), expression-parser.ts (rewriteReactiveRefsAST/rewriteServerReactiveRefsAST), codegen/errors.ts (CGError), codegen/code-segments.ts (rewriteCodeSegments/regexAllowedAfter); **S210 ss3: parenthesized receiver preservation — paren-group before .method()/(args)/[idx] chains (no new external deps)** |
| codegen/build-source-map.ts | codegen/srcmap-provenance.ts, codegen/source-map.ts |
| engine-statechild-grammar.ts | (standalone — NO imports; pure constant exports: ENGINE_STATE_CHILD_RESERVED_ATTRS + STATE_CHILD_STRUCTURAL_TAGS; placed at compiler/src/ NOT codegen/ to be importable by both type-system and codegen layers without cycle) |
| engine-graph.ts | types/ast.ts (FileAST shapes via unknown); standalone — no codegen/ imports |
| auth-graph.ts | types/ast.ts, symbol-table.ts |
| type-system.ts | types/ast.ts, dependency-graph.ts, protect-analyzer.ts, **engine-statechild-grammar.ts** (ENGINE_STATE_CHILD_RESERVED_ATTRS + STATE_CHILD_STRUCTURAL_TAGS — ss2 item 3; type-system.ts:81); **S211 A2 W3: `checkApiDeclarations` (+346L; line 18053) fires E-API-PATH-PARAM-UNBOUND / E-API-ENDPOINT-UNKNOWN / E-API-REQ-SHAPE-MISMATCH; no new external imports — uses the existing typeRegistry + apiExemptTypeNames** |
| reachability/*.ts | types/reachability.ts, types/ast.ts |
| expression-parser.ts | acorn, astring, codegen/code-segments.ts (GITI-017 rewriteCodeSegments fence); **S210: acornNodeToExprNode regex-literal branch uses node.raw (not outer rawSource) — prevents wrong-span serializer bug in call-arg position**; **S210 ss3: @. sigil structuring — each-sigil `IdentExpr` leaf production (no new external imports; internal AST shape change only)** |
| lint-w-interp-in-raw-content.js | (standalone — no compiler/src imports; `runWInterpInRawContent` walks bsResults BS-output objects directly) |
| native-parser/*.js | (self-contained; no compiler/src imports) |
| commands/compile.js | api.js (compileScrml), engine-graph sidecar write site (--emit-engine-graph) |
| commands/dev.js | api.js (compileScrml); Bun.serve + per-file fs.watch (rewritten S152 — no recursive-dir) |
| commands/migrate.js | api.js (compileScrml), block-splitter.js, ast-builder.js (buildAST — for rewriteMatchArmArrows AST-driven walk) |

## Tags
#scrmlts #map #dependencies #bun #acorn #lsp #mcp #engine-graph #source-map #s149 #s152 #s209 #ss2 #engine-statechild-grammar #ssot-dedup #s210 #engine-name-dual-table #dual-table-fix #symbol-table-governed-cell #emit-reactive-wiring-modern-engine-skip #code-segments-template-hybrid #rewrite-code-segments #expression-parser-regex-literal-raw #ast-builder-collect-braced-body #tokenizer-shift-compound-assign #engine-statechild-comment-opacity #a2-api-decl #api-decl-node #ss3-paren-group #emit-expr-paren-receiver #rewrite-ts-paren-group #ss8-tailwind #ring-offset-arbitrary #tw-arbitrary-string #s211 #ss11 #w-interp-in-raw-content #lint-w-interp-in-raw-content #a2-w3 #api-decl-typer #check-api-declarations #e-api-path-param-unbound #e-api-endpoint-unknown #e-api-req-shape-mismatch #section-60-2 #section-60-4 #stage-2-5 #bs-lint-stage #s212 #a2-w4 #w-api-response-not-variant #api-endpoint-registry #emit-api-url-expr #emit-request-node-api-mode #parse-variant-decode #response-enum #seq-guard #refetch #mounted-cleanup #section-60-5 #section-60-6 #section-60-7 #g-bare-ref-event-handler #bare-ref-event-wiring #bare-ref-handler #on-event-literal-attr #g-match-arm-reactive-attr-effects #class-directive-arm-tagged #attr-template-arm-tagged #emit-arm-wire-function #directive-selector #directive-js-expr #lower-class-directive-condition #lower-attr-template-value #disposers #arm-tagged-logic-binding #emit-bindings-shared-lowering

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
