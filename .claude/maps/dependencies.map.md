# dependencies.map.md
# project: scrml
# updated: 2026-07-18T08:36:53-06:00  commit: 99ae45ca

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

No dependency-manifest change this window (S265) — package.json/compiler/package.json untouched.

## Internal Module Graph — compiler pipeline (compiler/src/api.js is the spine)

| Stage | Module(s) | Feeds |
|---|---|---|
| CLI dispatch | cli.js | commands/{compile,dev,build,serve,migrate,promote,generate,init,introspect,semdiff}.js |
| Split | block-splitter.js | ast-builder.js, native-parser/parse-file.js |
| Parse (live) | ast-builder.js, expression-parser.ts | type-system.ts, symbol-table.ts, codegen |
| Parse (native, canary) | native-parser/*.js (paired w/ *.scrml) | native-walker/*, native-parser-canary/within-node-classifier.ts, lsp/handlers.js |
| Component expand | component-expander.ts | validators/post-ce-invariant.ts, attribute-interpolation.ts, attribute-allowlist.ts |
| Protect / route infer | protect-analyzer.ts, route-inference.ts | codegen/protect-egress.ts, codegen/egress-field-scan.ts (E-CG-001) |
| Type check | type-system.ts, meta-checker.ts | dependency-graph.ts, auth-graph.ts |
| Reachability / batch | reachability-solver.ts, batch-planner.ts, cps-batch-planner.ts | codegen |
| Name/symbol resolve | name-resolver.ts, symbol-table.ts | codegen |
| Codegen dispatch | code-generator.js (= codegen/index.ts) | codegen/emit-*.ts (client, server, html, css, each, match, engine, ssr, channel, worker, functions, validators, library, table-for, form-for, tool, test, theme-reset [NEW S265]) |
| Tool serve-harness | tool-program.ts, codegen/emit-tool.ts, codegen/emit-server.ts | §64.9 `serve=` listener-owning headless target |
| CSS emission | codegen/emit-css.ts (`generateCss`, emit-css.ts:382 — invoked from codegen/index.ts:1146), codegen/emit-theme-reset.ts (NEW S265) | §65 Wave-1: built-in `@layer reset`, `:where()`-flat, `<theme>` token→`:root` lowering + `@`-sigil use-site check; the flat-inline `#{}`→`style=""` path runs the same lowering in emit-html.ts; the §65.6 runtime theme-switch reflection is emitted in emit-client.ts (`emitThemeSwitchReflection`) |
| CSS conflict check | codegen/css-conflict-check.ts | run post-CE at api.js Stage 3.4 over `collectCssBlocks`; emits E-STYLE-CONFLICT / W-STYLE-CONFLICT-POSSIBLE |
| Content-hash asset naming (NEW S265) | api.js pre-pass (`fnv1aHash`, gated on `contentHashAssets`) | build.js's `generateServerEntry` (cache-header policy); see build.map.md |
| Validate emit | codegen/validate-emit.ts | final artifact sanity (single-JS-expression checks etc.) |
| Meta-eval | meta-eval.ts | `^{}` meta-block execution |

## Internal Module Graph — supporting layers

| Module | Role |
|---|---|
| codegen/reactive-deps.ts | cross-cutting reactive-cell/request/set/map dependency collectors, consumed by most emit-*.ts |
| codegen/collect.ts | FileAST-shape collectors (server var decls, load-kind classification, CSS-variable-bridge collection). Theme-token-aware (S265 #95): `@name` refs matching a `<theme>` token are excluded from the §25 JS bridge (they lower to `var(--name)` in emit-theme-reset.ts, not a JS `setProperty`). §25-bridge FIX (S265 #98, `bf316828`): `collectCssVariableBridges(nodes)` dropped its `isScoped` param, the `CSSVariableBridge` interface dropped its `scoped` field, and the `_constructorScoped` node flag was removed — a reactive CSS custom property (`#{prop:@cell}`) is no longer per-instance "scoped". Its emitted wiring (`emit-reactive-wiring.ts:882`) now ALWAYS targets `document.documentElement` (:root); the prior `bridge.scoped` ternary targeted an undefined `_scrml_el` stub that threw `ReferenceError` at bundle load (components are compile-time INLINED → the cell is global; the :root custom property inherits into the component's inline `var(--scrml-name)`, §65.3.1 / §25.5). |
| codegen/emit-theme-reset.ts (NEW S265) | §65 CSS Wave-1 EMISSION half (the §65.2 conflict-CHECKER stays in css-conflict-check.ts). 9 exports: `collectThemeContext` (single-walk gather of theme-decls + `<program>` node + declared cell names), `emitThemeCss` (`<theme>` base→`:root` + `.Variant`/`@media` selectors, returns `{css, tokenNames}`), `emitResetLayer` (the built-in `@layer reset`; `<program reset="none">` opt-out), `wrapSelectorWhere` (`:where()`-flat of unconditional arms only), `lowerCssValueRefs` (`@name`→`var(--name)` token / `var(--scrml-name)` cell / else `E-THEME-TOKEN-UNKNOWN`), `collectThemeTokenNames`, `themeVariantAttr` (the `data-scrml-theme-<cell>` name shared by emit-css.ts's variant selector and emit-client.ts's runtime reflection effect), plus `RESET_LAYER_CSS` (const) and the `ThemeContext` interface. Imported by emit-css.ts, emit-html.ts, emit-client.ts, and codegen/collect.ts. |
| codegen/binding-registry.ts | pure data registry for event/logic bindings, no imports |
| codegen/log-loc.ts | source-location resolver, standalone |
| codegen/route-splitter.ts | per-route chunk manifest serialization (`serializeChunksManifest`) |
| codegen/mcp-descriptors.ts | MCP tool descriptor synthesis (`buildMcpDescriptors`) |
| engine-statechild-grammar.ts | pure constants shared by type-system.ts + codegen (no cycle) |
| channel-watches.ts | shared §38.13 `watches=` schema/RowChange derivation, consumed by symbol-table.ts (SYM validation) + type-system.ts (typer synthesis) |
| theme-body-parser.ts | §65 `<theme>`/`<defaults>` BODY-FORM parser (declaration side); emit-theme-reset.ts owns EMISSION (see above) — the two are a parse/emit pair, not overlapping. |
| module-resolver.js | resolves `scrml:*` stdlib imports + relative imports; STDLIB_ROOT via `fileURLToPath` |

## Defense-in-depth: stdlib async classification (api.js STDLIB-EXPORT-SEED)
A server-only `scrml:*` re-export whose {kind, isAsync} cannot be resolved now FAILS CLOSED (defaults to async) instead of fail-open to sync — hardened after the 2026-07-11 jwt-auth-bypass regression. Root cause was two parser bugs (block-splitter.js JSDoc comment-scan leak + tokenizer.ts regex-vs-divide misclassification on a leading `=`), both fixed; this seed is the standing backstop for the whole `scrml:*` re-export surface, not just auth. Unchanged this window.

## stdlib module pairing (compiler/runtime/stdlib/*.js <-> stdlib/*/index.scrml)
21 modules: auth, compiler, cron, crypto, data, format, fs, host, http, math, mcp, oauth (+5 provider sub-modules: discord/github/google/microsoft/pkce), path, process, random, redis, regex, router, store, test, time. Each ships BOTH a canonical `.scrml` source (stdlib/<mod>/) and a JS host shim (compiler/runtime/stdlib/<mod>.js) that the emitted client/server bundles import at `scrml:<mod>`. Unchanged this window.

## Tags
#scrml #map #dependencies #module-graph #stdlib #css-conflict-check #pipeline #bun #acorn #server-shape #tool-serve #theme-reset #content-hash #css-var-bridge #css-wave1

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [structure.map.md](./structure.map.md)
