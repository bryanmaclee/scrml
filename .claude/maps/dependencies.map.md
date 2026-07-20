# dependencies.map.md
# project: scrml
# updated: 2026-07-19T21:52:34-06:00  commit: df2ac831

## Runtime Dependencies — root package.json (v0.7.1)
@modelcontextprotocol/sdk@1.29.0 — MCP server SDK for the scrml MCP integration
pg@^8.22.0 — bundled Postgres client; drives §38.13 realtime LISTEN bridge + `scrml introspect`
vscode-languageserver@^9.0.1 — LSP server protocol implementation
vscode-languageserver-textdocument@^1.0.11 — LSP text document utilities

## Runtime Dependencies — compiler/package.json (compiler workspace, v0.2.0)
acorn@^8.16.0 — JS parser for escape-hatch (`_{}`) expressions + the E-CG-001 acorn-exact egress scan
astring@^1.9.0 — JS AST-to-source printer, paired with acorn for re-serializing escape-hatch nodes

## Dev / Build Dependencies — root package.json
@happy-dom/global-registrator@^20.8.9 — DOM environment for browser-suite Bun tests
happy-dom@^20.8.9 — fast in-process DOM used by compiler/tests/browser
@playwright/test@^1.49.0 — Playwright e2e framework (e2e/)
marked@^14.1.3 — Markdown parser used by docs/build.ts
puppeteer@^24.40.0 — headless browser support for e2e/docs tooling

## Dev Dependencies — compiler/package.json
@happy-dom/global-registrator@^20.8.9 — DOM environment for compiler-workspace browser tests

## Editor-tooling Dev Dependencies — editors/vscode/package.json
vscode-textmate, vscode-oniguruma — bundled TextMate-grammar test harness (tokenize.js / regression-scan.js); not part of the compiler pre-commit gate, needs its own `npm i`.

## CI-only External Actions (not npm deps — GitHub Actions)
actions/checkout@v4/v6, oven-sh/setup-bun@v2, anthropics/claude-code-action@v1 — see build.map.md / infra.map.md for CI wiring; anthropics/claude-code-action needs the `ANTHROPIC_API_KEY` repo secret to activate.

## Runtime Engine
bun>=1.3.13 — required; no Node support (Bun-specific APIs used throughout: Bun.serve, bun:sqlite, Bun.$, Bun.SQL).

No dependency-manifest change this window (S266-S271) — package.json/compiler/package.json untouched.

## Internal Module Graph — compiler pipeline (compiler/src/api.js is the spine)

| Stage | Module(s) | Feeds |
|---|---|---|
| CLI dispatch | cli.js | commands/{compile,dev,build,serve,migrate,promote,generate,init,introspect,semdiff}.js |
| Split | block-splitter.js | ast-builder.js, native-parser/parse-file.js |
| Parse (live) | ast-builder.js, expression-parser.ts | type-system.ts, symbol-table.ts, codegen. **This window (GITI-038/039):** the `return-stmt` handler parses a returned `function`/`async function` STRUCTURALLY into `fnExprNode` instead of stripping it (see schema.map.md); `collectExpr`'s `joinWithNewlines` gained a `partSpans`-driven span-adjacency rejoin scoped to markup regions (literal markup text stays verbatim) + an `angleDepth`-guarded `;` statement-break. |
| Parse (native, canary) | native-parser/*.js (paired w/ *.scrml) | native-walker/*, native-parser-canary/within-node-classifier.ts, lsp/handlers.js |
| Component expand | component-expander.ts | validators/post-ce-invariant.ts, attribute-interpolation.ts, attribute-allowlist.ts. `substitutePropsInLogicStmt`'s return-stmt case now also substitutes props inside `fnExprNode` (GITI-038); `expandComponentNode` stamps `_componentPropNames` on an expanded root (#81 S239 finding 7 — distinguishes a call-site PROP from the definition's own reactive attrs for emit-html's writer-conflict analysis). |
| Protect / route infer | protect-analyzer.ts, route-inference.ts | codegen/protect-egress.ts, codegen/egress-field-scan.ts (E-CG-001). `collectFunctionNodes`/`walkBodyForTriggers` now descend into `fnExprNode` (GITI-038); `AuthMiddleware` gained `sessionSecure?: boolean` (§20.5.1 session-cookie Secure mode). |
| Type check | type-system.ts, meta-checker.ts | dependency-graph.ts, auth-graph.ts. `annotateNodes` binds the `session` server builtin into scope when `boundary==="server"` and fires `E-SCOPE-012` for a non-server `session` reference (§20.5); both `annotateNodes` and `checkLinear`'s return-stmt handlers now visit `fnExprNode` (GITI-038). |
| Reachability / batch | reachability-solver.ts, batch-planner.ts, cps-batch-planner.ts | codegen |
| Name/symbol resolve | name-resolver.ts, symbol-table.ts | codegen |
| Codegen dispatch | code-generator.js (= codegen/index.ts) | codegen/emit-*.ts (client, server, html, css, each, match, engine, ssr, channel, worker, functions, validators, library, table-for, form-for, tool, test, theme-reset, **async-combinators [NEW S269]**) |
| Colorless-async classification | codegen/emit-library-shared.ts (`computeAsyncFnNames`, `computeNestedAsyncFnHolders`), codegen/scheduling.ts (`buildCalleeImportMap`, `injectPromiseAwait` [NEW S267/#87]), codegen/emit-expr.ts (`setServerAsyncClassifier`, `clientAsyncFnNames`) | emit-library.ts, emit-server.ts, emit-tool.ts, emit-logic.ts, emit-control-flow.ts, emit-functions.ts — see "Colorless-async" section below |
| Tool serve-harness | tool-program.ts, codegen/emit-tool.ts, codegen/emit-server.ts | §64.9 `serve=` listener-owning headless target |
| CSS emission | codegen/emit-css.ts (`generateCss`, emit-css.ts:382 — invoked from codegen/index.ts:1146), codegen/emit-theme-reset.ts | §65 Wave-1: built-in `@layer reset`, `:where()`-flat, `<theme>` token→`:root` lowering + `@`-sigil use-site check; the flat-inline `#{}`→`style=""` path runs the same lowering in emit-html.ts; the §65.6 runtime theme-switch reflection is emitted in emit-client.ts (`emitThemeSwitchReflection`) |
| CSS conflict check | codegen/css-conflict-check.ts | run post-CE at api.js Stage 3.4 over `collectCssBlocks`; emits E-STYLE-CONFLICT / W-STYLE-CONFLICT-POSSIBLE |
| Reactive-attr writer-ownership (NEW S268, #81) | codegen/emit-html.ts (`analyzeWriterConflict`) | detects two writers on ONE physical DOM surface (`class=(expr)` vs `class:name=`, `style=(expr)` vs `if=`/`show=`, `value=(expr)` vs `bind:value`) and emits `E-ATTR-WRITER-CONFLICT` naming both sites, or a `LogicBinding` with `isReactiveValueAttr`/`valueAttrName`/`valueAttrKey` (codegen/binding-registry.ts) when there is no conflict |
| Session establishment (NEW S266/S266-pass2) | compute-program-config.ts (`session-secure=` parse), route-inference.ts (`AuthMiddleware.sessionSecure`), codegen/emit-server.ts (`_secureCookieMode`/`_sessionCookieName`/`_scrml_read_session_id`/`_scrml_session_begin`), codegen/emit-expr.ts (the `E-SESSION-VALUE`/`E-SESSION-RESERVED-KEY` sinks, drained post server-emit) | §20.5 `session.*` server builtin — see auth.map.md |
| Content-hash asset naming | api.js pre-pass (`fnv1aHash`, gated on `contentHashAssets`) | build.js's `generateServerEntry` (cache-header policy); see build.map.md |
| Validate emit | codegen/validate-emit.ts | final artifact sanity (single-JS-expression checks etc.) |
| Meta-eval | meta-eval.ts | `^{}` meta-block execution. `serializeNode`'s return-stmt case now serializes `fnExprNode` as a named function expression (GITI-038). |

## Colorless-async (Seam-A / Phase-2 combinators — S267/S269/S271, GITI-037/GITI-038)

A plain (non-`?{}`) function calling a Promise-returning host primitive (`safeCallAsync`, a `scrml:auth`/`scrml:http` async export) — directly, transitively through a local peer, or as a returned closure — is compiler-classified `async` and auto-awaited; there is no `async`/`await` in scrml source (§13.1/§13.2). Landed in 3 units:

- **Seam-A Phase-1 (`1c577da5`, GITI-037 fix)** — unified the async classifiers onto `computeAsyncFnNames` (codegen/emit-library-shared.ts), closing 3 seed-holes where a plain fn calling a Promise-returning stdlib primitive silently leaked the Promise. `EmitLogicOpts` (emit-logic.ts) gained `clientAsyncFnNames`/`clientAsyncBody`, forwarded into `EmitExprContext` so `emit-expr.ts`'s `emitCall` awaits a plain-ident call to a transitively-async CLIENT peer. No-silent-leak backstop: a stdlib-async call in a non-awaitable position (a sync `.some`/`.find`/`.map` callback body or a param default) is recorded into a `syncCallSink` and drained into a fatal `E-ASYNC-STDLIB-IN-SYNC-CALLBACK` rather than leaked.
- **Phase-2 combinator transform (`9c950dfe`, FORK 1)** — the async-aware collection-callback combinator rewrite. NEW `compiler/src/codegen/async-combinators.ts` (246 lines): `ASYNC_COMBINATOR_METHODS`/`ASYNC_COMBINATOR_METHOD_ORDER` (`some`/`every`/`find`/`filter`/`map`/`forEach`/`reduce`/`flatMap`; `.sort` fail-closed — no async combinator), `callbackReachesAsync`, `isAsyncCombinatorCall`, `asyncCombinatorHelperBlock` (emits the on-use `_scrml_someAsync`…`_scrml_flatMapAsync` runtime helpers as a module FOOTER — JS fn decls hoist, so user code can appear first). Consumed by `emit-library.ts`'s `withAsyncCombinators`.
- **GITI-038 fix (`72ba19d6`) — Q1/Q2 async-classification split.** `computeAsyncFnNames` gained a `guardNestedFnValues` param: **Q1 (own-signature async)** — a nested returned/held closure's async call does NOT color its ENCLOSING factory. **Q2 (needs AST re-emission)** — `computeNestedAsyncFnHolders` (emit-library-shared.ts) identifies factories whose returned closure (`fnExprNode`) itself needs `async`+`await`; those factories stay non-async but MUST leave the whole-block verbatim-text-splice path (`pruneServerFnsAndLowerGuarded`'s `extraRemovals` param) so the structured `emitLibraryFnMember` path re-emits the closure with its own derived `async` keyword. `emit-logic.ts`'s `return-stmt` case emits `fnExprNode` inline via the `function-decl` case for this same reason (see schema.map.md).
- **i87 §13.2 position-invariant auto-await (`d8c814d5`, #87, S267)** — a server-fn/stdlib-async call one block deep inside an `if`/`else`/`for`/`while`/`do-while` body now gets its `await` (previously only a top-level statement did). `EmitLogicOpts.awaitNestedPromises` (emit-logic.ts) gates `codegen/scheduling.ts`'s NEW `injectPromiseAwait` export, called from `emitLogicBody`; set only by the control-flow body-opts (emit-control-flow.ts's `emitIfStmt`/`emitForStmt`/`emitWhileStmt`/`emitDoWhileStmt`), never at the top level (which routes through `scheduleStatements`) or in a match-arm body (a sync IIFE where `await` is illegal).

## Internal Module Graph — supporting layers

| Module | Role |
|---|---|
| codegen/reactive-deps.ts | cross-cutting reactive-cell/request/set/map dependency collectors, consumed by most emit-*.ts |
| codegen/collect.ts | FileAST-shape collectors (server var decls, load-kind classification, CSS-variable-bridge collection). `isServerOnlyNode` now scans `fnExprNode`'s body too (GITI-038, E-CG-006 defense-in-depth). Theme-token-aware (#95): `@name` refs matching a `<theme>` token are excluded from the §25 JS bridge. §25-bridge FIX (#98, `bf316828`): `collectCssVariableBridges(nodes)` dropped its `isScoped` param, the `CSSVariableBridge` interface dropped its `scoped` field — a reactive CSS custom property (`#{prop:@cell}`) is no longer per-instance "scoped"; its wiring (`emit-reactive-wiring.ts:882`) always targets `document.documentElement` (:root). |
| codegen/emit-theme-reset.ts | §65 CSS Wave-1 EMISSION half (the §65.2 conflict-CHECKER stays in css-conflict-check.ts). 9 exports: `collectThemeContext`, `emitThemeCss`, `emitResetLayer`, `wrapSelectorWhere`, `lowerCssValueRefs`, `collectThemeTokenNames`, `themeVariantAttr`, plus `RESET_LAYER_CSS` (const) and the `ThemeContext` interface. Imported by emit-css.ts, emit-html.ts, emit-client.ts, and codegen/collect.ts. |
| codegen/async-combinators.ts (NEW S269) | pure async-combinator classification + runtime-helper-block synthesis (see "Colorless-async" above); imported by emit-library.ts only |
| codegen/binding-registry.ts | pure data registry for event/logic bindings, no imports. Gained (#81, S268) `isReactiveValueAttr`/`valueAttrName`/`valueAttrIsFormValue`/`valueAttrKey` fields on `LogicBinding` — the reactive VALUE-attribute counterpart to the pre-existing `isReactiveBoolAttr` (presence-toggle) fields; see error.map.md `E-ATTR-WRITER-CONFLICT`. |
| codegen/log-loc.ts | source-location resolver, standalone |
| codegen/route-splitter.ts | per-route chunk manifest serialization (`serializeChunksManifest`) |
| codegen/mcp-descriptors.ts | MCP tool descriptor synthesis (`buildMcpDescriptors`) |
| engine-statechild-grammar.ts | pure constants shared by type-system.ts + codegen (no cycle) |
| channel-watches.ts | shared §38.13 `watches=` schema/RowChange derivation, consumed by symbol-table.ts (SYM validation) + type-system.ts (typer synthesis) |
| theme-body-parser.ts | §65 `<theme>`/`<defaults>` BODY-FORM parser (declaration side); emit-theme-reset.ts owns EMISSION — the two are a parse/emit pair, not overlapping. |
| module-resolver.js | resolves `scrml:*` stdlib imports + relative imports; STDLIB_ROOT via `fileURLToPath` |

## Defense-in-depth: stdlib async classification (api.js STDLIB-EXPORT-SEED)
A server-only `scrml:*` re-export whose {kind, isAsync} cannot be resolved now FAILS CLOSED (defaults to async) instead of fail-open to sync — hardened after the 2026-07-11 jwt-auth-bypass regression. Root cause was two parser bugs (block-splitter.js JSDoc comment-scan leak + tokenizer.ts regex-vs-divide misclassification on a leading `=`), both fixed; this seed is the standing backstop for the whole `scrml:*` re-export surface, not just auth. Unchanged this window.

## stdlib module pairing (compiler/runtime/stdlib/*.js <-> stdlib/*/index.scrml)
21 modules: auth, compiler, cron, crypto, data, format, fs, host, http, math, mcp, oauth (+5 provider sub-modules: discord/github/google/microsoft/pkce), path, process, random, redis, regex, router, store, test, time. Each ships BOTH a canonical `.scrml` source (stdlib/<mod>/) and a JS host shim (compiler/runtime/stdlib/<mod>.js) that the emitted client/server bundles import at `scrml:<mod>`. Unchanged this window.

## Tags
#scrml #map #dependencies #module-graph #stdlib #css-conflict-check #pipeline #bun #acorn #server-shape #tool-serve #theme-reset #content-hash #css-var-bridge #css-wave1 #colorless-async #giti-037 #giti-038 #giti-039 #async-combinators #writer-ownership #session-establishment #position-invariant-await

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [structure.map.md](./structure.map.md)
- [schema.map.md](./schema.map.md)
- [error.map.md](./error.map.md)
- [auth.map.md](./auth.map.md)
