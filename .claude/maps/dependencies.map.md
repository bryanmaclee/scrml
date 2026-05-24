# dependencies.map.md
# project: scrmlts
# updated: 2026-05-23T00:00:00Z  commit: 73dd816c

## Runtime Dependencies (root package.json)

`vscode-languageserver@^9.0.1` — LSP server framework for lsp/server.js
`vscode-languageserver-textdocument@^1.0.11` — text-document model for the LSP

## Runtime Dependencies (compiler/package.json)

`acorn@^8.16.0` — JS expression/statement parser; drives live TAB-stage `parseExprToNode` (ESTree nodes); native-parser conformance ORACLE
`astring@^1.9.0` — ESTree → JS source generator; used by codegen to print expressions

## Dev / Build Dependencies (root)

`@happy-dom/global-registrator@^20.8.9` — registers happy-dom globals for browser-mode unit tests
`happy-dom@^20.8.9` — DOM implementation for non-Playwright browser tests
`@playwright/test@^1.49.0` — e2e test runner (e2e/)
`puppeteer@^24.40.0` — headless browser automation (benchmarks / browser tests)
`marked@^14.1.3` — markdown renderer for docs:build

## Runtime / Toolchain

Bun >=1.3.13 — required engine; test runner (`bun test`), bundler, package manager (bun.lock). No npm/pnpm lockfile. package.json version: 0.6.0.

## Internal Module Graph (pipeline orchestration)

```
api.js → block-splitter.js, ast-builder.js, compute-pgo-flags.ts, compute-program-config.ts,
         component-expander.ts, protect-analyzer.ts, route-inference.ts, monotonicity-analyzer.ts,
         idempotency-store-resolver.ts, type-system.ts, meta-checker.ts, meta-eval.ts,
         dependency-graph.ts, batch-planner.ts, reachability-solver.ts, auth-graph.ts,
         code-generator.js, module-resolver.js, name-resolver.ts, symbol-table.ts
api.js → native-parser/parse-file.js (nativeParseFile) — C2 routing behind --parser=scrml-native
api.js → validators/{post-ce-invariant, attribute-interpolation, attribute-allowlist,
         lint-try-catch, lint-async-user-source}.ts
api.js → lint-ghost-patterns.js, lint-i-match-promotable.js, lint-i-fn-promotable.js,
         tailwind-classes.js, gauntlet-phase1-checks.js, gauntlet-phase3-eq-checks.js
code-generator.js → codegen/index.ts (runCG) → codegen/emit-*.ts (~55 emitters)
codegen/index.ts → codegen/route-splitter.ts, codegen/ir.ts, codegen/source-map.ts,
                   codegen/runtime-chunks.ts
reachability-solver.ts → reachability/{component-1..5, entry-points, gate-classifier,
                          outer-fixpoint}.ts
cli.js → commands/{compile, dev, build, migrate, promote, generate, init, serve}.js → api.js
symbol-table.ts → engine-statechild-parser.ts (legacy fallback, parseRuleAttrValue only)
symbol-table.ts → native-walker/engine-statechild-walker.ts (M6.6.b.2 primary path)
native-walker/engine-statechild-walker.ts → engine-statechild-parser.ts (parseRuleAttrValue)
native-walker/engine-statechild-walker.ts → native-parser/collect-hoisted.js (isEngineBlock)
```

## Native-parser Internal Module Graph

```
lex.js → lex-mode.js, lex-in-{code,single-string,double-string,template,
          line-comment,block-comment,regex}.js, char-classify.js
parse-expr.js → ast-expr.js, token.js, token-cursor.js, parse-ctx.js, parse-mode.js
parse-stmt.js → ast-stmt.js, ast-expr.js, parse-expr.js, token.js, parse-ctx.js,
                block-context.js, body-mode.js
parse-markup.js → tag-frame.js (M6.6.b.1.5 attr tokenizer extensions), body-mode.js,
                  display-text-literal.js, parse-seam.js, parse-css-body.js,
                  parse-sql-body.js, parse-state-body.js, parse-error-body.js,
                  delegation-frame.js
parse-file.js → parse-markup.js, collect-hoisted.js, translate-stmt.js, parse-state-body.js
translate-stmt.js → ast-stmt.js, translate-expr.js
translate-expr.js → ast-expr.js
collect-hoisted.js → ast-stmt.js
```

## Stdlib Runtime Shim Layout (compiler/runtime/stdlib/)

Top-level (18): auth, crypto, data, host, store, cron, format, fs, http, oauth, path, process, redis, regex, router, test, time, compiler (umbrella).
Subdirectories:
- `oauth/` — discord, github, google, microsoft, pkce (5 providers).
- `compiler/` — 13 per-stage thunks (bs, tab, mod, ce, bpp, pa, ri, ts, mc, me, dg, cg, expr) — each throws at call time with W-STDLIB-COMPILER-DEFERRED attribution.

## Tags
#scrmlts #map #dependencies #bun #acorn #native-parser #m5-swap #bridge #stdlib-shims #m6-6-b2 #native-walker

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [structure.map.md](./structure.map.md)
- [build.map.md](./build.map.md)
