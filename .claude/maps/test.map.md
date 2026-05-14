# test.map.md
# project: scrmlts
# updated: 2026-05-13T23:00:00Z  commit: 71305fe

## Test Framework

| Field | Value |
|-------|-------|
| Runner | bun:test (built-in) |
| Config | bunfig.toml (`root = "compiler/tests/"`, `timeout = 10000`) |
| Pretest | `bash scripts/compile-test-samples.sh` — compiles ~289 sample fixtures |
| Run all | `bun test compiler/tests/` |
| Run subset | `bun test compiler/tests/unit` / `compiler/tests/integration` / `compiler/tests/conformance` |
| Run single | `bun test compiler/tests/unit/<file>.test.js` |
| With bail | `bun test ... --bail` (used by pre-commit hook) |
| Coverage | `bun test compiler/tests/ --coverage` |

## Test Counts (S89 close, 2026-05-13)
604 files; **12,065 pass / 117 skip / 1 todo / 0 fail** (+148 pass, +14 files vs S88 close at 9b98118)
Current shipped tag: v0.2.6 (`efbd1e8`). HEAD `71305fe` is on v0.3.0 cut path (untagged).

## New Tests Since S88 Baseline (9b98118)

**§36 input devices chain (CLOSED S89 Phases 1-4):**
- conf-INPUT-001..005.test.js: §36 conformance suite — 5 new conformance files
- input-state-types.test.js: input state type unit tests
- input-frame-accurate.test.js: frame-accurate input integration test
- input-canvas-integration.test.js: canvas input integration test

**§13.2 auto-await chain (CLOSED S89 Sub-A + Sub-B + Sub-E):**
- auto-await-promise-stdlib.test.js: §13.2 Sub-Phase B stdlib Promise<T> auto-await classifier tests
- api-js-stdlib-enum-reexport.test.js: STDLIB-EXPORT-SEED pass + stdlib enum re-export tests
- oq-2-stdlib-runtime-resolution.test.js: OQ-2 stdlib runtime resolution integration test

**Approach A-2 reachability solver (A-2.1 scaffold + A-2.2 Component 1):**
- reachability-solver-scaffold.test.js: A-2.1 module scaffold tests
- reachability-entry-points.test.ts: A-2.2 entry-point detection tests
- reachability-gate-classifier.test.ts: A-2.2 gate classification tests
- reachability-solver-component-1.test.ts: +82 tests — A-2.2 Component 1 full suite

**TodoMVC edit-mode (post-LIFT-5):**
- todomvc-fixture-edit-mode.test.js: edit-mode markup fixture + anchor test

## Test Categories

| Category | Path | Approx Count |
|----------|------|--------------|
| Unit (named) | compiler/tests/unit/ (top-level .test.*) | ~372 files |
| Unit (gauntlet-s*) | compiler/tests/unit/gauntlet-s*/  | ~61 files |
| Integration | compiler/tests/integration/ | ~41 files |
| Conformance (top-level) | compiler/tests/conformance/ | ~20 files |
| Conformance (block-grammar, s32-fn-state-machine, tab) | compiler/tests/conformance/*/ | ~81 files |
| Browser | compiler/tests/browser/ | 11 files |
| LSP | compiler/tests/lsp/ | 10 files |
| Self-host | compiler/tests/self-host/ | 4 files |
| Commands | compiler/tests/commands/ | 4 files |
| E2E (Playwright) | e2e/tests/ | 5 spec files (3-browser) |

## Unit Test Coverage Highlights (S89 additions in brackets)

**AST / Tokenizer / Parser**
ast-builder-*.test.js, tokenizer-*.test.js, expression-parser.test.js, block-splitter.test.js, bs-comment-skip.test.js

**Pipeline Stages**
code-generator.test.js, type-system.test.js, dependency-graph.test.js, protect-analyzer.test.js,
route-inference.test.js, batch-planner.test.js, symbol-table.test.js, binding-registry.test.js,
name-resolver (p1e-name-resolver.test.js), module-resolver.test.js,
dg-markup-read-node-a12.test.js [S88 A-1.2], dg-markup-read-emission-a13.test.js [S88 A-1.3],
dg-markup-read-emission-a14.test.js [S88 A-1.4], dg-markup-read-emission-a15.test.js [S88 A-1.5]

**Approach A-2 Reachability [NEW S89]**
reachability-solver-scaffold.test.js [A-2.1],
reachability-entry-points.test.ts [A-2.2],
reachability-gate-classifier.test.ts [A-2.2],
reachability-solver-component-1.test.ts [A-2.2 +82 tests]

**§36 Input Devices [NEW S89]**
input-state-types.test.js, conf-INPUT-001..005.test.js [conformance],
input-frame-accurate.test.js [integration], input-canvas-integration.test.js [integration]

**§13.2 Auto-await [NEW S89]**
auto-await-promise-stdlib.test.js, api-js-stdlib-enum-reexport.test.js,
oq-2-stdlib-runtime-resolution.test.js [integration]

**Codegen Emitters**
emit-match.test.js, emit-test.test.js, emit-library.test.js, emit-lift.test.js,
emit-logic.test.js, engine-body-render.test.js, engine-body-children.test.js,
emit-expr-engine-routing-option-a.test.js, match-arm-*.test.js,
lift-li-text-template.test.js, lift-5-reconciler-ambient.test.js [S88 LIFT-5],
todomvc-fixture-edit-mode.test.js [S89 edit-mode anchor]

**scrml:host / safeCall [S88]**
safe-call.test.js (24 tests), safe-call-async.test.js (20 tests)

**Engine / State Machines**
machine-codegen.test.js, machine-parsing.test.js, engine-*.test.js (8 files),
computed-delay.test.js, timeout.test.js, engine-ontimeout-end-to-end.test.js, engine-self-write-option-d.test.js

**Conformance (§34 error codes)**
conf-INPUT-001..005 [S89 §36], conf-AUTH-003..005, conf-CG-001-warn, conf-CG-010, conf-CG-014,
conf-CTRL-011, conf-ERROR-008, conf-IMPORT-007, conf-LIFECYCLE-015, conf-LOOP-005..007,
conf-META-EVAL-002; block-grammar/conf-001..047 (47 files); s32-fn-state-machine/; tab/

**Stdlib**
stdlib-auth.test.js, stdlib-cron.test.js, stdlib-format.test.js, stdlib-fs.test.js,
stdlib-http.test.js, stdlib-oauth.test.js, stdlib-path.test.js, stdlib-process.test.js,
stdlib-redis.test.js, stdlib-regex.test.js, stdlib-router.test.js, stdlib-store.test.js, stdlib-time.test.js

## Fixtures & Factories

| Path | Contents |
|------|----------|
| compiler/tests/fixtures/ | promote-match-canonical.scrml, expr.ts (ExprNode builders), extract-user-fns.js |
| compiler/tests/helpers/ | expr.ts — structured ExprNode test construction utilities |
| compiler/tests/unit/__fixtures__/ | per-test scrml/JS snippet fixtures |
| compiler/tests/unit/_tmp_*/ | temporary snapshot directories (bug regression fixtures) |
| compiler/tests/commands/migrate-program-shape-fixtures/ | 7 bucket-classification fixtures for migrate --program-shape |
| samples/compilation-tests/ | ~289 .scrml fixtures compiled by pretest; dist/ gitignored; input-canvas-demo.scrml [S89] |
| e2e/ | Playwright: dev-server-fixture.ts; 02-counter, 03-contact-book, 05-multi-step-form, 14-mario, todomvc specs |

## Pattern

Tests use `bun:test` (`describe`, `test`, `expect`). Unit tests for pipeline passes:
1. Construct a minimal scrml source string or AST fragment
2. Run the target stage function directly (`splitBlocks`, `buildAST`, `runDG`, `runReachabilitySolver`, etc.)
3. Assert on the returned structure using `expect().toEqual()`, `expect().toContain()`, `expect().toMatchObject()`

Integration tests run `compileScrml()` from `api.js` and assert on output HTML, client JS, and server JS strings. Conformance tests assert that a given input produces a specific SPEC §34 error code from the pipeline error array.

## Tags
#scrmlts #map #test #bun #conformance #unit #integration #s89 #approach-a2 #reachability #input-devices #auto-await #playwright #e2e

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [build.map.md](./build.map.md)
- [error.map.md](./error.map.md)
