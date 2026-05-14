# structure.map.md
# project: scrmlts
# updated: 2026-05-13T23:00:00Z  commit: 71305fe

## Entry Points
compiler/src/cli.js            — CLI entry; routes compile/dev/build/serve/migrate/promote/init subcommands
compiler/src/api.js            — programmatic API; orchestrates full BS→TAB→NR→MOD→CE→PA→RI→TS→META→DG→CG pipeline (includes Stage 3.007 LINT-TRY-CATCH + Stage 3.105 STDLIB-EXPORT-SEED passes added S89)
compiler/bin/scrml.js          — installed binary (points to cli.js via package.json `bin`)
lsp/server.js                  — Language Server Protocol server; started via `scrml lsp --stdio`
compiler/src/codegen/index.ts  — Stage 8 CG entry point; runCG() exported

## Directory Ownership

compiler/                      — workspace root; compiler/package.json declares acorn + astring deps
compiler/src/                  — all pipeline stage implementations: tokenizer, block-splitter, ast-builder, type-system, etc.
compiler/src/codegen/          — Stage 8 (CG) emitters; 30+ emit-*.ts files + IR, BindingRegistry, CompileContext, errors; emit-variant-guard.ts [NEW S89] factored variant-dispatch helper
compiler/src/codegen/compat/   — integration shim: parser-workarounds.js (setBPPOverrides hook for self-hosted BPP modules)
compiler/src/commands/         — CLI subcommand implementations: compile.js, dev.js, build.js, serve.js, migrate.js, init.js, promote.js
compiler/src/types/            — AST type definitions (ast.ts — single source of truth, ~1,828 LOC); reachability.ts [NEW S89 A-2.1] — RSInput/RSOutput/ChunkPlan type surface (247 LOC)
compiler/src/validators/       — UVB sub-passes: post-ce-invariant.ts, attribute-interpolation.ts, attribute-allowlist.ts, ast-walk.ts, lint-try-catch.ts [NEW S89], lint-async-user-source.ts
compiler/src/reachability/     — NEW S89 A-2.1: Component 1 sub-modules (component-1.ts, entry-points.ts, gate-classifier.ts)
compiler/runtime/              — server-side runtime JS shims; copied to dist/_scrml/ at compile time
compiler/runtime/stdlib/       — hand-written ES modules for stdlib (auth.js, crypto.js, store.js, host.js [S88])
compiler/tests/                — 604 test files (bun test); organized by category
compiler/tests/unit/           — unit tests (~433 files) covering individual pipeline passes
compiler/tests/conformance/    — conformance tests (~101 files in 4 subtrees) testing SPEC §34 error-code compliance; conf-INPUT-001..005 [NEW S89]
compiler/tests/integration/    — integration tests (~41 files) covering multi-stage scenarios; input-canvas-integration.test.js + input-frame-accurate.test.js [NEW S89]
compiler/tests/browser/        — browser-environment tests (11 files, happy-dom)
compiler/tests/lsp/            — LSP server protocol tests (10 files)
compiler/tests/self-host/      — compiler self-host tests (4 files)
compiler/tests/commands/       — CLI command tests (4 files)
compiler/tests/fixtures/       — shared test fixtures
compiler/tests/helpers/        — test utilities (expr.ts, extract-user-fns.js)
compiler/self-host/            — self-hosted compiler; dist/tab.js is gitignored (built locally)
compiler/SPEC.md               — authoritative language spec (27,037 lines; §42.1.1 Defined-Values-vs-Absence normative subsection added S89; §36 E-INPUT-005 + W-INPUT-001 added S89)
compiler/SPEC-INDEX.md         — spec section index (313 lines); read this first for navigation
compiler/PIPELINE.md           — stage pipeline contracts (v0.7.1; authoritative; 2,758 lines)
lsp/                           — LSP server (hover, diagnostics, completion, workspace management)
stdlib/                        — scrml standard library source .scrml files organized by module name (21 modules including scrml:host)
stdlib/host/                   — S88: scrml:host module (index.scrml + runtime shim in compiler/runtime/stdlib/host.js)
samples/                       — sample .scrml programs; samples/compilation-tests/ has ~289 .scrml fixtures including input-canvas-demo.scrml [NEW S89]
scripts/                       — build, test, and maintenance scripts (shell + .ts)
scripts/git-hooks/             — pre-commit hook (source-controlled; activate via git config core.hooksPath scripts/git-hooks)
docs/                          — project documentation: articles, audits, changelog, changes dirs, curation, pinned-discussions
docs/changes/                  — active dispatch directories (~50 entries including S89: §36-impl-phase-1..4, §13.2-impl-phase-A..D-E, a1-closeout, a2-1..2, a2-reachability-solver-scoping, a3-auth-graph-scoping, null-eradication-*, undefined-eradication-*, m-7c-d-12-runtime-sentinel-scoping, stdlib-phase-1-5-null-sweep, wave-4-t-track, wave-4-d-track, w-try-catch-lint)
docs/audits/                   — audit snapshots: null-audit-compiler-src-2026-05-13.md, undefined-audit-compiler-src-2026-05-13.md, articles-currency-table-2026-05-13.md, scope-c-findings-tracker.md, self-host-spec-conformance-2026-05-11.md, happy-dom-perf-regression-s87-2026-05-12.md [S89 additions]
editors/                       — editor integrations (VSCode extension, neovim)
examples/                      — standalone scrml usage examples
benchmarks/                    — performance benchmarks (todomvc-react, todomvc-svelte, fullstack-react, sql-batching)
e2e/                           — Playwright e2e test suite (3-browser; 5 spec files)
handOffs/                      — historical hand-offs (read-only; current session hand-off at hand-off.md)

## Notable New Files (S89 — 2026-05-13)

**§36 input devices chain:**
compiler/tests/conformance/conf-INPUT-001..005.test.js — §36 input-device conformance suite (5 new files)
compiler/tests/integration/input-canvas-integration.test.js — canvas input integration test
compiler/tests/integration/input-frame-accurate.test.js — frame-accurate input test
compiler/tests/unit/input-state-types.test.js — input state type unit tests
samples/compilation-tests/input-canvas-demo.scrml — canvas input demo sample

**§13.2 auto-await chain:**
compiler/tests/unit/auto-await-promise-stdlib.test.js — §13.2 Sub-Phase B stdlib Promise<T> auto-await
compiler/tests/integration/oq-2-stdlib-runtime-resolution.test.js — OQ-2 stdlib runtime resolution

**Approach A-2 reachability:**
compiler/src/types/reachability.ts — RSInput/RSOutput/ChunkPlan/ReachabilityRecord types (247 LOC; A-2.1)
compiler/src/reachability-solver.ts — runReachabilitySolver() entry point (152 LOC; A-2.1)
compiler/src/reachability/component-1.ts — Component 1 implementation (A-2.2)
compiler/src/reachability/entry-points.ts — entry-point detection (A-2.2)
compiler/src/reachability/gate-classifier.ts — gate classification (A-2.2)
compiler/tests/unit/reachability-solver-scaffold.test.js — A-2.1 scaffold tests
compiler/tests/unit/reachability-entry-points.test.ts — A-2.2 entry-point tests
compiler/tests/unit/reachability-gate-classifier.test.ts — A-2.2 gate classifier tests
compiler/tests/unit/reachability-solver-component-1.test.ts — +82 tests A-2.2 Component 1

**Codegen factored helper:**
compiler/src/codegen/emit-variant-guard.ts — variant-guarded markup render dispatcher helper (engine + future match-block-form consumers)

**W-TRY-CATCH lint:**
compiler/src/validators/lint-try-catch.ts — W-TRY-CATCH-IN-SCRML-SOURCE walker (Stage 3.007)

**Wave 4 / content:**
compiler/tests/unit/todomvc-fixture-edit-mode.test.js — todomvc edit-mode markup fixture + anchor test (landed post-LIFT-5)
compiler/tests/unit/api-js-stdlib-enum-reexport.test.js — stdlib enum re-export tests

## Notable Modified Files (S89)

compiler/src/api.js               — Stage 3.007 LINT-TRY-CATCH pass added; Stage 3.105 STDLIB-EXPORT-SEED TAB-only pass added (§13.2 Sub-Phase B); --emit-reachability CLI flag wired
compiler/src/codegen/emit-html.ts — E-INPUT-005 duplicate input-state-id-within-scope check (§36 Phase 2.B)
compiler/src/ast-builder.js       — §36 input device AST support; W-TRY-CATCH-IN-SCRML-SOURCE walker support
stdlib/auth/jwt.scrml             — verifyJwt migrated to one-line auto-await (§13.2 Sub-Phase D-E)
stdlib/auth/password.scrml        — verifyPassword already migrated S88; confirmed clean
stdlib/*/index.scrml (21 files)   — null→not/is-some/is-not sweep: 21 files / 124 sites (stdlib Phase 1.5, 8c608a7)
compiler/SPEC.md                  — §42 §42.1.1 normative "Defined Values vs. Absence" + W-ABSENCE-IN-SCRML-SOURCE catalog rename + §36 E-INPUT-005 + W-ABSENCE catalog additions; SPEC grew to 27,037 lines

## Ignored / Generated Paths
node_modules/, compiler/node_modules/, dist/, compiler/dist/self-host/, compiler/self-host/dist/,
build/, .git/, .jj/, samples/compilation-tests/dist/, handOffs/

## Tags
#scrmlts #map #structure #compiler #cli #pipeline #s89 #v0.3 #approach-a #approach-a2 #input-devices #auto-await #null-eradication #reachability

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [dependencies.map.md](./dependencies.map.md)
- [build.map.md](./build.map.md)
