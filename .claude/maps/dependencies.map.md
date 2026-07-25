# dependencies.map.md
# project: scrml
# updated: 2026-07-25T16:00:00Z  commit: 1c5c2aee

## Runtime Dependencies — root package.json (v0.7.1)
@modelcontextprotocol/sdk@1.29.0 — MCP server SDK for the scrml MCP integration
pg@^8.22.0 — bundled Postgres client; drives §38.13 realtime LISTEN bridge + `scrml introspect`
vscode-languageserver@^9.0.1 — LSP server protocol implementation
vscode-languageserver-textdocument@^1.0.11 — LSP text document utilities

## Runtime Dependencies — compiler/package.json (compiler workspace, v0.2.0)
acorn@^8.16.0 — JS parser for escape-hatch (`_{}`) expressions + the E-CG-001 acorn-exact egress scan + the NEW chunk-namespace cell-accessor-rename pass
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

No dependency-manifest change at this HEAD — root `package.json` and `compiler/package.json` are untouched by every landing in this window. **The chunk-namespacing BUG-6 arc is first-party and adds ZERO external dependency**: `codegen/cell-accessor-rename.ts` reuses the already-present `acorn` (module-first / script-fallback parse), `codegen/chunk-namespace.ts` uses only Node `fs`/`path` + the in-repo `fnv1a-hash.ts`. Peter's #171-#175 adopter/codegen fixes and the #155 tag-canonicalizer likewise add none.

## Internal Module Graph — compiler pipeline (compiler/src/api.js is the spine)

| Stage | Module(s) | Feeds |
|---|---|---|
| CLI dispatch | cli.js | commands/{compile,dev,build,serve,migrate,promote,generate,init,introspect,semdiff}.js |
| Split | block-splitter.js | ast-builder.js, native-parser/parse-file.js |
| Parse (live) | ast-builder.js, expression-parser.ts | type-system.ts, symbol-table.ts, codegen. Carries the GITI-038/039 `return-stmt.fnExprNode` structural parse + `joinWithNewlines` span-adjacency rejoin (see schema.map.md). |
| Parse (native, canary) | native-parser/*.js (paired w/ *.scrml) | native-walker/*, native-parser-canary/within-node-classifier.ts, lsp/handlers.js |
| Tag-canonicalize (Stage 3.055 TC, NEW #155) | tag-canonicalizer.ts | landmark-tag.ts + api.js — a capitalized tag (`<Button>`) emits what the §15.X registry resolved it to (§4.2/§4.3 casing-irrelevant). |
| Component expand | component-expander.ts | validators/post-ce-invariant.ts, attribute-interpolation.ts, attribute-allowlist.ts. `substitutePropsInLogicStmt`/`expandComponentNode` carry the GITI-038 fnExprNode + #81 `_componentPropNames` work. **This window (#173): no dead client destructure for a static-component import (`g-static-component-import-dead-destructure`).** |
| Protect / route infer | protect-analyzer.ts, route-inference.ts | codegen/protect-egress.ts, codegen/egress-field-scan.ts (E-CG-001). `collectFunctionNodes`/`walkBodyForTriggers` descend into `fnExprNode` (GITI-038); `AuthMiddleware.sessionSecure?` (§20.5.1). |
| Type check | type-system.ts, meta-checker.ts | dependency-graph.ts, auth-graph.ts. `annotateNodes` binds the `session` server builtin (§20.5, E-SCOPE-012). The SSR auth-scoped omission LINT fires `I-SSR-AUTH-SCOPED-CLIENT-HYDRATED` off the shared `codegen/sql-lex.ts` row-scope predicate (§52.15.5, #120). `E-ERROR-010` dedicated (#121). |
| Reachability / batch | reachability-solver.ts, batch-planner.ts, cps-batch-planner.ts | codegen |
| Name/symbol resolve | name-resolver.ts, symbol-table.ts | codegen. **symbol-table.ts PASS 15.5 owns the `<outlet>` placement pass** (E-OUTLET-OUTSIDE-SHELL / E-OUTLET-DUPLICATE / **E-OUTLET-AND-MAIN**, #124). |
| Codegen dispatch | code-generator.js (= codegen/index.ts) | codegen/emit-*.ts (client, server, html, css, each, match, engine, ssr, channel, worker, functions, validators, library, table-for, form-for, tool, test, theme-reset, async-combinators) |
| **Chunk namespacing — BUG-6 multi-chunk isolation (NEW #180, closes #27, S280/S282)** | codegen/chunk-namespace.ts (token state + `nsId`/`nsName`/`nsCellKey`/`buildCellOwnerMap`/`assertChunkTokensDistinct`/`resolveProjectRoot`) + codegen/cell-accessor-rename.ts (`renameCellAccessors` — the Acorn-splice callee-rename pass) + codegen/fnv1a-hash.ts (the shared token hash) | Wired ENTIRELY from codegen/index.ts, per-file: :1243 `resolveProjectRoot` (walk up for `scrml.toml`/`.git`, else filesystem-root fallback), :1252 `assertChunkTokensDistinct` (D2 — a token collision is a HARD compile error, explicitly NOT `E-CG-010`), :1290/:1573 `setChunkNamespaceState`, :1969 `buildCellOwnerMap` (cross-file imported cells key under the EXPORTER's token, §51.0), :1971 `chunkNamespaceToken`, :1973 `addCellScopePrologue` (calls `renameCellAccessors(body, CELL_SCOPE_ACCESSORS)` at :667, then prepends the `buildCellScopePrologue` wrappers at :598), :2019 `wrapChunkBodyInIife` (NEW — top-level `const`/`function` chunk-local; `import`/`export`/`_scrml_modules[...]=` hoisted OUTSIDE; gated `moduleFormat !== "esm"`), :2324 `resetChunkNamespaceState`. **NO emitter emits `_scrml_cs_` or a namespaced token directly** — `nsId`/`nsName`/`nsCellKey` are called AT the emit sites (emit-each, emit-engine, emit-ssr-render, emit-match) but the `_scrml_cs_` accessor rename is a post-hoc bundle pass. Ordering is load-bearing: rename runs on the BODY before the prologue is prepended, so the prologue's real-accessor refs are never renamed. Runtime (runtime-template.js) splits the `<token>$` key prefix. semdiff.ts's `canonicalizeChunkNamespaceToken` neutralizes the path-derived token in the emit-identity compare. |
| **`<each>` mount FENCE + the range-aware reconciler (#131) + i175 bind:value-in-each** | codegen/emit-each.ts (`emitEachMountHtml` :385 -> `<!--scrml-each:${nsId(N)}--><!--/scrml-each:${nsId(N)}-->` — the id is NAMESPACED this window; render-fn names + renderer-registry keys + match-dispatch ids all pass through `nsId`; **the per-item `bind:*` value-side wiring for OUTER/shared reactive cells landed #175/i175 at :1539/:1997**) | runtime-template.js (`_scrml_reconcile_list` :1652 branches on `container.nodeType === 8`; `_scrml_each_end` :1963, `_scrml_find_each_anchor` :1989, `_scrml_each_clear` :2006, `_scrml_each_append` :2019, `_scrml_remount_each` :2131) + codegen/emit-ssr-render.ts (SSR fills BETWEEN the fences) + codegen/emit-match.ts / emit-variant-guard.ts (arm remount). The mount is a COMMENT — invisible to `querySelector` — so every locator is a SHOW_COMMENT TreeWalker mirroring `_scrml_find_if_marker` (:1381). |
| **ESM chunks — the second client module format (`--module-format=esm`, U1-U3)** | codegen/runtime-esm.ts (`toEsmRuntime` :304, `deriveTopLevelExportNames` :256, `LIFT_TARGET_GLOBAL` :71) + codegen/emit-client-esm.ts (`toEsmClientChunk` :270) | Consumed ONLY from codegen/index.ts, all `moduleFormat === "esm"`-gated: transform the assembled+sliced runtime (before the content hash so esm gets its own cache key), the per-route chunk transform with a `../`-depth runtime URL, `type="module"` on the emitted `<script>` tags, the esm-vs-classic cross-file tag split. `classic` (the default) is a no-op through all of these; the classic byte output is unchanged by the arc. Note: the #180 IIFE hoist is classic-ONLY (esm already has module scope). api.js's `rewriteChunkImportRefs` content-hashes in-chunk `import` specifiers on the BUILD path only. |
| Cross-file dep `<script src>` depth | codegen/index.ts `computeDependencyClientScripts` + codegen/utils.ts `stripPagesPrefix` | BOTH the dep path and the entry dist dir go through `toDistRel()` so the `pages/` strip is symmetric. Three pre-existing gaps remain open on this surface (see non-compliance.report.md). |
| **Client Router — landmark + shell composition (#124, S276, §20.8.1.1/§40.8.2)** | codegen/emit-html.ts (`treeHasAuthorMain` :1005, the `tag === "outlet"` emit branch) + codegen/index.ts (`findOutletMarkedOpenTag`/`findBareMainOpenTag` slot detection, `retagOpenTag` :699, `findMatchingCloseIdx` :724, the per-page `routeOwnsLandmark`/`slotShouldPromote` decisions) | TWO STAGES, one invariant, communicating ONLY through the emitted `data-scrml-outlet` marker — there is no shared AST state, because **`<outlet>` is not a dedicated AST node** (a `kind: "markup"` node with `tag: "outlet"`). The runtime is the third party (`runtime-template.js` `querySelector("[data-scrml-outlet]")`). See domain.map.md. |
| Confidentiality — tenant-row floor (#117/#118, §14.8.10) | codegen/tenant-egress.ts (`buildTenantContext`, `resolveTenantScoping`, `classifyTenantWrite`, `detectTenantRawEgress`, `rewriteSelectAddTenantId`, `rewriteInsertAddTenantId`) | consumed by codegen/emit-server.ts: E-TENANT-WRITE/AGG/RAW-EGRESS hard-fails + I-TENANT-STRIP/ACROSS. The ROW-level twin of protect-egress.ts (§14.8.9 column floor). See error.map.md + domain.map.md. |
| SSR auth-scoped omission + SQL-interp classifier (#120, §52.15.5) | codegen/sql-lex.ts (`liveSqlInterpolations`, `liveSqlInterpolationExprs`, `sqlHasLiveInterpolation`) | the SINGLE LIVE-vs-INERT `${}` classifier, imported by codegen/collect.ts AND codegen/rewrite.ts so they CANNOT diverge; the omission itself is emitted in type-system.ts (the lint) + codegen/emit-server.ts (the SSR-seed drop + per-cell /__mountHydrate gate). |
| Colorless-async classification | codegen/emit-library-shared.ts (`computeAsyncFnNames`, `computeNestedAsyncFnHolders`), codegen/scheduling.ts (`buildCalleeImportMap`, `injectPromiseAwait`), codegen/emit-expr.ts (`setServerAsyncClassifier`, `clientAsyncFnNames`) | emit-library.ts, emit-server.ts, emit-tool.ts, emit-logic.ts, emit-control-flow.ts, emit-functions.ts — see "Colorless-async" section below |
| **Batch-hoist / server-call fencing (§19.9.9.2, Peter #171/#172)** | codegen/emit-server.ts + codegen/scheduling.ts | #171 completed the #165 batch-hoist fence (full control-transfer set + filler-distance across control-flow guards); #172 makes a client side-effect between two server calls a batch boundary. |
| Reactive value= form-control write (Peter #174) | codegen/emit-bindings.ts | a reactive `value=` on a form control writes the `.value` PROPERTY (not the attribute). |
| Tool serve-harness | tool-program.ts, codegen/emit-tool.ts, codegen/emit-server.ts | §64.9 `serve=` listener-owning headless target |
| CSS emission | codegen/emit-css.ts (`generateCss`, emit-css.ts:382 — invoked from codegen/index.ts:1146), codegen/emit-theme-reset.ts | §65 Wave-1: built-in `@layer reset`, `:where()`-flat, `<theme>` token→`:root` lowering; the §65.6 runtime theme-switch reflection is emitted in emit-client.ts (`emitThemeSwitchReflection`) |
| CSS conflict check | codegen/css-conflict-check.ts | run post-CE at api.js Stage 3.4 over `collectCssBlocks`; emits E-STYLE-CONFLICT / W-STYLE-CONFLICT-POSSIBLE |
| Reactive-attr writer-ownership (S268, #81) | codegen/emit-html.ts (`analyzeWriterConflict`) | detects two writers on ONE physical DOM surface and emits `E-ATTR-WRITER-CONFLICT`, or a `LogicBinding` with `isReactiveValueAttr`/`valueAttrName`/`valueAttrKey` (codegen/binding-registry.ts) when there is no conflict |
| Session establishment (S266/S266-pass2) | compute-program-config.ts, route-inference.ts (`AuthMiddleware.sessionSecure`), codegen/emit-server.ts, codegen/emit-expr.ts | §20.5 `session.*` server builtin — see auth.map.md |
| Content-hash asset naming | api.js pre-pass (`fnv1aHash`, gated on `contentHashAssets`) | build.js's `generateServerEntry` (cache-header policy); see build.map.md |
| Validate emit | codegen/validate-emit.ts | final artifact sanity (single-JS-expression checks etc.) |
| Meta-eval | meta-eval.ts | `^{}` meta-block execution. `serializeNode`'s return-stmt case serializes `fnExprNode` (GITI-038). |

## Colorless-async (Seam-A / Phase-2 combinators — S267/S269/S271, GITI-037/GITI-038)

A plain (non-`?{}`) function calling a Promise-returning host primitive (`safeCallAsync`, a `scrml:auth`/`scrml:http` async export) — directly, transitively through a local peer, or as a returned closure — is compiler-classified `async` and auto-awaited; there is no `async`/`await` in scrml source (§13.1/§13.2). Landed in 3 units:

- **Seam-A Phase-1 (`1c577da5`, GITI-037 fix)** — unified the async classifiers onto `computeAsyncFnNames` (codegen/emit-library-shared.ts), closing 3 seed-holes. No-silent-leak backstop: a stdlib-async call in a non-awaitable position drains into a fatal `E-ASYNC-STDLIB-IN-SYNC-CALLBACK`.
- **Phase-2 combinator transform (`9c950dfe`, FORK 1)** — the async-aware collection-callback combinator rewrite. `codegen/async-combinators.ts`: `ASYNC_COMBINATOR_METHODS` (`some`/`every`/`find`/`filter`/`map`/`forEach`/`reduce`/`flatMap`; `.sort` fail-closed), `callbackReachesAsync`, `asyncCombinatorHelperBlock` (emits the on-use `_scrml_someAsync`… helpers as a module FOOTER). Consumed by `emit-library.ts`'s `withAsyncCombinators`.
- **GITI-038 fix (`72ba19d6`) — Q1/Q2 async-classification split.** `computeAsyncFnNames` gained a `guardNestedFnValues` param: Q1 (own-signature async) a nested closure's async call does NOT color its factory; Q2 (needs AST re-emission) `computeNestedAsyncFnHolders` identifies factories whose returned closure (`fnExprNode`) itself needs `async`+`await`. `emit-logic.ts`'s `return-stmt` case emits `fnExprNode` inline via the `function-decl` case.
- **i87 §13.2 position-invariant auto-await (`d8c814d5`, #87, S267)** — a server-fn/stdlib-async call one block deep inside an `if`/`else`/`for`/`while`/`do-while` body now gets its `await`. `EmitLogicOpts.awaitNestedPromises` gates `codegen/scheduling.ts`'s `injectPromiseAwait`, called from `emitLogicBody`.

## Internal Module Graph — supporting layers

| Module | Role |
|---|---|
| codegen/chunk-namespace.ts (NEW #180, S280/S282) | per-compilation-unit namespace for the runtime-global token space (N1 node-ids / N2 cell-keys / N3 type-names / N4 engine-names). Owns the module-level state + `nsId`/`nsName`/`nsCellKey`/`stripNsName`, the `fnv1aHash`-of-project-relative-path token (`chunkNamespaceToken`), the project-root walk (`resolveProjectRoot`, filesystem-root fallback), the cross-file cell owner map (`buildCellOwnerMap`), and the D2 distinctness guard (`assertChunkTokensDistinct` — a hard error, not `E-CG-010`). Imported ONLY by codegen/index.ts + the emit sites that call `nsId`. |
| codegen/cell-accessor-rename.ts (NEW #180) | `renameCellAccessors` — the Acorn-parse + range-SPLICE pass that rewrites every cell-accessor CALL in the assembled chunk body to its `_scrml_cs_` chunk-local wrapper. Only the callee moves; the store-key argument stays byte-identical. The SOLE producer of `_scrml_cs_*` — no emitter emits it. `CS_PREFIX`, `AccessorRenameResult{code,used,valueReferences}`. Imported ONLY by codegen/index.ts. |
| codegen/fnv1a-hash.ts | the shared FNV-1a 32-bit -> 8-char base36 primitive (§47.1.3 normative). **THREE call-site classes now**: §47.1.2 per-binding type-encoding, §47.5 per-chunk content-address, and (NEW) the chunk-NAMESPACE token — the only site that enforces token distinctness. Every token starts with `0`. |
| codegen/sql-lex.ts (NEW #120, S274) | pure SQL-lexer-grade LIVE-vs-INERT `${}` classifier (§52.15.5). One function feeds BOTH `collect.ts` and `rewrite.ts` so a `${}` the classifier ignores is the SAME `${}` the emitter does not bind. |
| codegen/tenant-egress.ts (NEW #117/#118, S273) | the §14.8.10 tenant-row isolation floor — the ROW-level twin of protect-egress.ts (§14.8.9). Consumed by codegen/emit-server.ts. |
| codegen/index.ts (= code-generator.js) | the codegen dispatcher AND the owner of the chunk-namespace WIRING (`CELL_SCOPE_ACCESSORS`, `buildCellScopePrologue`, `addCellScopePrologue`, `wrapChunkBodyInIife`) AND (since #124) §40.8.2 multi-file shell composition (slot location by attribute NAME, `findMatchingCloseIdx` depth-counted close scan, per-composed-document landmark demotion/re-promotion). |
| codegen/emit-html.ts | markup emission; owns `analyzeWriterConflict` (#81, E-ATTR-WRITER-CONFLICT) and the §20.8.1.1 landmark decision (`treeHasAuthorMain`). |
| codegen/emit-bindings.ts | event/logic binding emission; **this window (#174): a reactive `value=` on a form control writes the `.value` property.** |
| codegen/reactive-deps.ts | cross-cutting reactive-cell/request/set/map dependency collectors, consumed by most emit-*.ts |
| codegen/collect.ts | FileAST-shape collectors; imports `sql-lex.ts` for the §52.15.5 row-scope predicate + the GITI-038 fnExprNode descent + the #98 `collectCssVariableBridges` :root retarget. |
| codegen/rewrite.ts | imports `sql-lex.ts` — `extractSqlParams` binds `$N` params off the SAME live-interpolation set the classifier uses. |
| codegen/emit-theme-reset.ts | §65 CSS Wave-1 EMISSION half (the §65.2 conflict-CHECKER stays in css-conflict-check.ts). Imported by emit-css.ts, emit-html.ts, emit-client.ts, codegen/collect.ts. |
| codegen/async-combinators.ts (S269) | pure async-combinator classification + runtime-helper-block synthesis; imported by emit-library.ts only |
| codegen/binding-registry.ts | pure data registry for event/logic bindings, no imports. Carries (#81) `isReactiveValueAttr`/`valueAttrName`/`valueAttrIsFormValue`/`valueAttrKey` on `LogicBinding`. |
| codegen/log-loc.ts | source-location resolver, standalone |
| codegen/route-splitter.ts | per-route chunk manifest serialization (`serializeChunksManifest`) |
| codegen/mcp-descriptors.ts | MCP tool descriptor synthesis (`buildMcpDescriptors`) |
| tag-canonicalizer.ts (NEW #155) | Stage 3.055 TC — a capitalized tag emits its registry-resolved kind (§4.2/§4.3). Imported by landmark-tag.ts + api.js. |
| engine-statechild-grammar.ts | pure constants shared by type-system.ts + codegen (no cycle) |
| channel-watches.ts | shared §38.13 `watches=` schema/RowChange derivation, consumed by symbol-table.ts + type-system.ts |
| theme-body-parser.ts | §65 `<theme>`/`<defaults>` BODY-FORM parser (declaration side); emit-theme-reset.ts owns EMISSION |
| module-resolver.js | resolves `scrml:*` stdlib imports + relative imports; STDLIB_ROOT via `fileURLToPath`. Also consulted by chunk-namespace.ts `resolveExporterPath` for the cross-file cell owner map. |
| semdiff.ts | emit-identity Tier-0 compare; **this window: `canonicalizeChunkNamespaceToken` (:686)** discovers each chunk-namespace token from its structural emission sites (prologue banner, engine names, mount attribute) and replaces it with a stable placeholder, so two byte-identical programs at different paths are not flagged behavioral. |

## Defense-in-depth: stdlib async classification (api.js STDLIB-EXPORT-SEED)
A server-only `scrml:*` re-export whose {kind, isAsync} cannot be resolved FAILS CLOSED (defaults to async) instead of fail-open to sync — hardened after the 2026-07-11 jwt-auth-bypass regression. Unchanged this window.

## stdlib module pairing (compiler/runtime/stdlib/*.js <-> stdlib/*/index.scrml)
21 modules: auth, compiler, cron, crypto, data, format, fs, host, http, math, mcp, oauth (+5 provider sub-modules: discord/github/google/microsoft/pkce), path, process, random, redis, regex, router, store, test, time. Each ships BOTH a canonical `.scrml` source (stdlib/<mod>/) and a JS host shim (compiler/runtime/stdlib/<mod>.js). Unchanged this window.

## Tags
#scrml #map #dependencies #module-graph #stdlib #chunk-namespace #cell-accessor-rename #cs-prefix #ns-token #fnv1a #iife-hoist #semdiff #css-conflict-check #pipeline #bun #acorn #sql-lex #tenant-egress #tenant-floor #ssr-auth-scoped #theme-reset #content-hash #css-wave1 #colorless-async #async-combinators #writer-ownership #bind-value #batch-hoist #session-establishment #outlet #one-landmark #shell-composition #e-outlet-and-main #esm-chunks #module-format #runtime-esm #emit-client-esm #each-fence #foster-safe #dep-script-depth #tag-canonicalizer

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [structure.map.md](./structure.map.md)
- [schema.map.md](./schema.map.md)
- [error.map.md](./error.map.md)
- [domain.map.md](./domain.map.md)
- [auth.map.md](./auth.map.md)
