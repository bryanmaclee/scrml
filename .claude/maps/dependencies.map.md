# dependencies.map.md
# project: scrml
# updated: 2026-07-14T18:58:34-06:00  commit: f079d0a9

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

## Internal Module Graph — compiler pipeline (compiler/src/api.js is the spine)

| Stage | Module(s) | Feeds |
|---|---|---|
| CLI dispatch | cli.js | commands/{compile,dev,build,serve,migrate,promote,generate,init,introspect}.js |
| Split | block-splitter.js | ast-builder.js, native-parser/parse-file.js |
| Parse (live) | ast-builder.js, expression-parser.ts | type-system.ts, symbol-table.ts, codegen |
| Parse (native, canary) | native-parser/*.js (paired w/ *.scrml) | native-walker/*, native-parser-canary/within-node-classifier.ts, lsp/handlers.js |
| Component expand | component-expander.ts | validators/post-ce-invariant.ts, attribute-interpolation.ts, attribute-allowlist.ts |
| Protect / route infer | protect-analyzer.ts, route-inference.ts | codegen/protect-egress.ts, codegen/egress-field-scan.ts (E-CG-001) |
| Type check | type-system.ts, meta-checker.ts | dependency-graph.ts, auth-graph.ts |
| Reachability / batch | reachability-solver.ts, batch-planner.ts, cps-batch-planner.ts | codegen |
| Name/symbol resolve | name-resolver.ts, symbol-table.ts | codegen |
| Codegen dispatch | code-generator.js (= codegen/index.ts) | codegen/emit-*.ts (client, server, html, css, each, match, engine, ssr, channel, worker, functions, validators, library, table-for, form-for, tool, test) |
| Tool serve-harness | tool-program.ts, codegen/emit-tool.ts, codegen/emit-server.ts | §64.9 `serve=` listener-owning headless target (Fork 1A, Unit 1+2, landed this window) |
| CSS conflict check | codegen/css-conflict-check.ts | run post-CE at api.js Stage 3.4 over `collectCssBlocks`; emits E-STYLE-CONFLICT / W-STYLE-CONFLICT-POSSIBLE |
| Validate emit | codegen/validate-emit.ts | final artifact sanity (single-JS-expression checks etc.) |
| Meta-eval | meta-eval.ts | `^{}` meta-block execution |

## Internal Module Graph — supporting layers

| Module | Role |
|---|---|
| codegen/reactive-deps.ts | cross-cutting reactive-cell/request/set/map dependency collectors, consumed by most emit-*.ts |
| codegen/collect.ts | FileAST-shape collectors (server var decls, load-kind classification) |
| codegen/binding-registry.ts | pure data registry for event/logic bindings, no imports |
| codegen/log-loc.ts | source-location resolver, standalone |
| codegen/route-splitter.ts | per-route chunk manifest serialization (`serializeChunksManifest`) |
| codegen/mcp-descriptors.ts | MCP tool descriptor synthesis (`buildMcpDescriptors`) |
| engine-statechild-grammar.ts | pure constants shared by type-system.ts + codegen (no cycle) |
| channel-watches.ts | shared §38.13 `watches=` schema/RowChange derivation, consumed by symbol-table.ts (SYM validation) + type-system.ts (typer synthesis) |
| theme-body-parser.ts | §65 `<theme>`/`<defaults>` body-form parser |
| module-resolver.js | resolves `scrml:*` stdlib imports + relative imports; STDLIB_ROOT via `fileURLToPath` |

## Defense-in-depth: stdlib async classification (api.js STDLIB-EXPORT-SEED)
A server-only `scrml:*` re-export whose {kind, isAsync} cannot be resolved now FAILS CLOSED (defaults to async) instead of fail-open to sync — hardened after the 2026-07-11 jwt-auth-bypass regression (an unresolved `verifyJwt` export was misclassified sync, emitted unawaited, and its always-truthy Promise defeated the `if (!result.valid)` guard). Root cause was two parser bugs (block-splitter.js JSDoc comment-scan leak + tokenizer.ts regex-vs-divide misclassification on a leading `=`), both fixed; this seed is the standing backstop for the whole `scrml:*` re-export surface, not just auth.

## stdlib module pairing (compiler/runtime/stdlib/*.js <-> stdlib/*/index.scrml)
21 modules: auth, compiler, cron, crypto, data, format, fs, host, http, math, mcp, oauth (+5 provider sub-modules: discord/github/google/microsoft/pkce), path, process, random, redis, regex, router, store, test, time. Each ships BOTH a canonical `.scrml` source (stdlib/<mod>/) and a JS host shim (compiler/runtime/stdlib/<mod>.js) that the emitted client/server bundles import at `scrml:<mod>`.

## Tags
#scrml #map #dependencies #module-graph #stdlib #css-conflict-check #pipeline #bun #acorn #server-shape #tool-serve

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [structure.map.md](./structure.map.md)
