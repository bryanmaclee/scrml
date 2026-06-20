# dependencies.map.md
# project: scrmlts
# updated: 2026-06-20T00:00:00-06:00  commit: 5c68e87e

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
| api.js | block-splitter.js, ast-builder.js, code-generator.js, module-resolver.js, component-expander.ts, type-system.ts, engine-graph.ts (S149 — buildEngineGraphJson) |
| code-generator.js (codegen/index.ts) | codegen/emit-*.ts, codegen/srcmap-provenance.ts, codegen/build-source-map.ts, codegen/source-map.ts, dependency-graph.ts, auth-graph.ts, route-inference.ts |
| codegen/emit-client.ts | codegen/emit-*.ts, codegen/runtime-chunks.ts, codegen/context.ts; derives _scrml_modules key via moduleRegistryKey() |
| codegen/emit-engine.ts | codegen/emit-*.ts; emitEngineOpenerEffect() for §51.0.H Form 3 (S148); **S198-S199 engine-hydration arc emitEngineCellHydrationInit/emitEngineServerSourceHydration** |
| codegen/emit-reactive-wiring.ts | codegen/collect.ts, codegen/reactive-deps.ts, codegen/emit-engine.ts (require), codegen/emit-sync.ts, codegen/emit-channel.ts; **S210 dual-table-fix: isModernEngine skip (empty machine.rules) for both buildMachineBindingsMap §51.3 write-guard and emitReactiveWiring §51.3 table emission — modern engines route exclusively via §51.0 engineBindings/emitEngineWriteGuard** |
| codegen/emit-each.ts | codegen/context.ts; emitEachBodyRenderForFile() guards undefined cell pre-init (S152) |
| codegen/emit-server.ts | codegen/emit-*.ts, codegen/emit-channel.ts |
| codegen/emit-error-boundary.ts | block-splitter.js, ast-builder.js (re-parse pipeline) |
| codegen/emit-variant-guard.ts | **engine-statechild-grammar.ts** (ENGINE_STATE_CHILD_RESERVED_ATTRS + STATE_CHILD_STRUCTURAL_TAGS — ss2 item 3 SSOT dedup; replaces inline literal sets) |
| codegen/build-source-map.ts | codegen/srcmap-provenance.ts, codegen/source-map.ts |
| engine-statechild-grammar.ts | (standalone — NO imports; pure constant exports: ENGINE_STATE_CHILD_RESERVED_ATTRS + STATE_CHILD_STRUCTURAL_TAGS; placed at compiler/src/ NOT codegen/ to be importable by both type-system and codegen layers without cycle) |
| engine-graph.ts | types/ast.ts (FileAST shapes via unknown); standalone — no codegen/ imports |
| auth-graph.ts | types/ast.ts, symbol-table.ts |
| type-system.ts | types/ast.ts, dependency-graph.ts, protect-analyzer.ts, **engine-statechild-grammar.ts** (ENGINE_STATE_CHILD_RESERVED_ATTRS + STATE_CHILD_STRUCTURAL_TAGS — ss2 item 3; type-system.ts:81) |
| reachability/*.ts | types/reachability.ts, types/ast.ts |
| expression-parser.ts | acorn, astring, codegen/code-segments.ts (GITI-017 rewriteCodeSegments fence); **S210: acornNodeToExprNode regex-literal branch uses node.raw (not outer rawSource) — prevents wrong-span serializer bug in call-arg position** |
| native-parser/*.js | (self-contained; no compiler/src imports) |
| commands/compile.js | api.js (compileScrml), engine-graph sidecar write site (--emit-engine-graph) |
| commands/dev.js | api.js (compileScrml); Bun.serve + per-file fs.watch (rewritten S152 — no recursive-dir) |
| commands/migrate.js | api.js (compileScrml), block-splitter.js, ast-builder.js (buildAST — for rewriteMatchArmArrows AST-driven walk) |

## Tags
#scrmlts #map #dependencies #bun #acorn #lsp #mcp #engine-graph #source-map #s149 #s152 #s209 #ss2 #engine-statechild-grammar #ssot-dedup #s210 #engine-name-dual-table #dual-table-fix #symbol-table-governed-cell #emit-reactive-wiring-modern-engine-skip #code-segments-template-hybrid #rewrite-code-segments #expression-parser-regex-literal-raw #ast-builder-collect-braced-body #tokenizer-shift-compound-assign #engine-statechild-comment-opacity

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
