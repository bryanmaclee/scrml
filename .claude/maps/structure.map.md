# structure.map.md
# project: scrmlts
# updated: 2026-05-20T13:42:44-06:00  commit: 78faa65

## Entry Points
compiler/src/cli.js: CLI entry, subcommand router (compile/dev/build/serve/init/generate/migrate/promote); falls through to compile for a bare `.scrml` arg.
compiler/src/index.js: Thin legacy CLI wrapper — parses args, delegates to `compileScrml()` in api.js.
compiler/src/api.js: Programmatic compiler API — runs the full BS→TAB→CE→...→CG pipeline; consumed by CLI, tests, watch loops, LSP.
compiler/bin/scrml.js: npm `bin` shim — the `scrml` executable installed from package.json `bin`.
lsp/server.js: Language Server Protocol server (`bun run lsp/server.js --stdio`).
docs/build.ts: Static docs-site article builder (markdown → per-article HTML).

## Directory Ownership
compiler/             — The scrml compiler workspace; everything below is the toolchain.
compiler/src/         — TypeScript/JS compiler pipeline source (~126 files): tokenizer, AST builder, validators, type system, dependency graph, codegen.
compiler/src/codegen/ — Stage 8 Code Generator — IR, per-construct emit-*.ts modules, source maps, runtime chunking.
compiler/src/codegen/compat/ — Compatibility / progressive-enhancement codegen helpers.
compiler/src/commands/ — Implementations of the 8 CLI subcommands (compile, dev, build, serve, init, generate, migrate, promote).
compiler/src/reachability/ — Stage 7.6 Reachability Solver components (component-1..5, outer-fixpoint, gate-classifier); SPEC-anchored, impl deferred.
compiler/src/validators/ — Validation passes (attribute allowlist, attribute interpolation, try/catch + async-source lint, post-CE invariant, AST walk).
compiler/src/types/   — Shared TypeScript type declarations: ast.ts (AST node shapes), auth-graph.ts, reachability.ts.
compiler/native-parser/ — Self-host native lexer — paired `.scrml` source + `.js` build artifact for each lexer module (cursor, span, token, lex-mode, lex-in-*).
compiler/runtime/     — Client/server runtime support shipped into compiled output (idempotency.js, stdlib).
compiler/self-host/   — Self-hosting compiler modules authored in scrml (`.scrml`) with `.js` dist; ast/bs/bpp/cg/dg/ri/ts/tab/meta-checker/module-resolver.
compiler/tests/       — 728 test files across unit/integration/conformance/browser/lsp/self-host/commands/parser-conformance.
compiler/SPEC.md      — Authoritative language specification (28,489 lines, 57 sections + appendices).
compiler/SPEC-INDEX.md — Navigation map for SPEC.md — per-section line ranges, sizes, topic lookup.
compiler/PIPELINE.md  — Stage-contract document (2,906 lines) — 18-stage pipeline, lock enforcement map, failure-mode catalog.
stdlib/               — scrml standard library — 19 capability modules (auth, http, redis, time, fs, crypto, oauth, ...) authored in `.scrml`.
examples/             — 27 numbered canonical `.scrml` example programs + multi-file example dirs (22, 23); `VERIFIED.md` tracks compile status.
samples/              — Larger demo `.scrml` apps + gauntlet round dirs (r11..r19) + `compilation-tests/` (14 sub-dirs).
e2e/                  — Playwright end-to-end suite — fixtures, tests, two configs (app + docs).
benchmarks/           — Performance and bundle-size benchmarks; `RESULTS.md` is the curated committed result file.
docs/                 — Project docs: articles, audits, changes (per-feature SCOPING dirs), tutorial, primer, changelog.
editors/              — Editor integrations — VS Code extension + Neovim queries.
scripts/              — Build / maintenance scripts — spec regen, test-sample compile, git hooks, benchmarks, migration helpers.
lsp/                  — Standalone LSP server entry.
handOffs/             — Historical session hand-offs (out of scope for maps — see non-compliance scan).

## Ignored / Generated Paths
node_modules, compiler/node_modules, editors/vscode/node_modules — dependency installs
dist/, compiler/dist, examples/dist, samples/dist, editors/vscode/out — build artifacts
.git, .jj — VCS metadata
.claude — agent maps + worktrees (this directory)
.tmp/, compiler/tests/unit/__fixtures__/ — per-run scratchpads
e2e/test-results/, e2e/playwright-report/ (+ -docs variants) — generated test artifacts
*.db / *.db-journal / *.db-wal / *.db-shm — runtime SQLite databases (examples + benchmarks)
docs/articles/*/, docs/articles/index.html — generated article HTML (source: docs/articles/*.md)
docs/SEO-LAUNCH.md, docs/m1-benchmark-results.md — local-only drafts/dumps

## Tags
#scrmlts #map #structure #compiler #pipeline #monorepo-workspace

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [build.map.md](./build.map.md)
- [domain.map.md](./domain.map.md)
