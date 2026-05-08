# test.map.md
# project: scrmlTS
# updated: 2026-05-08T00:00:00Z  commit: f59bbcc

## Test Framework
Runner:        Bun's built-in test runner (`bun test`).
Config:        `bunfig.toml` → `[test] root = "compiler/tests/"`, `timeout = 10000`.
Browser DOM:   `@happy-dom/global-registrator@^20.8.9` + `happy-dom@^20.8.9` (registered globally for browser tests).
E2E browser:   `puppeteer@^24.40.0` (used by `browser-todomvc.test.js`, `todomvc-e2e.test.js`).

Run all:           `bun test compiler/tests/`
Run single file:   `bun test compiler/tests/unit/<file>.test.js`
Run by name:       `bun test --test-name-pattern "<substring>" compiler/tests/`
Coverage:          `bun test compiler/tests/ --coverage`
Pre-test compile:  `bash scripts/compile-test-samples.sh` (auto-runs as `pretest` hook).

## Baseline (S69 close, commit f59bbcc)
**9,626 pass / 60 skip / 1 todo / 0 fail (full suite) across 469 files.**
**~8,870 pass (pre-commit subset).**
Net +385 from S67 close (a4eed93): S68 +184 (B11+B13+B12+B14+B15+B16+B17 landed), S69 +201 (B18+B19+B20+B21+B22 landed). 0 regressions cumulative.
S69 per-step delta: B18 +55 / B19 +13 / B20 +81 (includes match-arm payload-binding Form 1b bonus) / B21 +27 / B22 +25.

## Test Categories

### compiler/tests/unit/  (329 files)
Per-module unit tests. Largest bucket.
S68 new test files:
- `synth-validity-surface.test.js` (544 LOC) — B11 compound synth-cell registry (§6.11 + §55 surface).
- `derived-with-validators.test.js` — B13 E-DERIVED-WITH-VALIDATORS + Level-1 inline-override extraction.
- `per-field-synth-surface.test.js` (652 LOC) — B12 per-field synth cells + ScopeKind `"field"`.
- `engine-binding-b14.test.js` (547 LOC) — B14 engine binding + auto-declared variable + MOD engine-aware exportRegistry.
- `engine-statechild-b15.test.js` (524 LOC) — B15 state-child exhaustiveness + rule= typer + initial= validation.
- `derived-engine-rejections.test.js` — B16 E-DERIVED-ENGINE-* family + cycle detection.
- `engine-component-scope-b17.test.js` (324 LOC) — B17 E-COMPONENT-ENGINE-SCOPE.

S69 new test files:
- `multi-statement-handler-b18.test.js` (646 LOC) — B18 L19 E-MULTI-STATEMENT-HANDLER (markup-attr + engine state-child :-shorthand).
- `channel-placement-shared-b19.test.js` (342 LOC) — B19 E-CHANNEL-INSIDE-PROGRAM + E-CHANNEL-SHARED-MODIFIER.
- `bare-variant-inference-b20.test.js` (369 LOC) — B20 E-VARIANT-AMBIGUOUS + E-TYPE-063 (§14.10 bare-variant inference).
- `refinement-three-zone-b21.test.js` (448 LOC) — B21 refinement-type three-zone §53 (boundary-zone hook + trusted-zone scope upgrade).
- `reset-target-shape-b22.test.js` (451 LOC) — B22 E-RESET-INVALID-TARGET (reset(@cell) target-shape validation, multi-level compound nav).

S67 new test files (still present):
- `derived-circular-dep.test.js` (450 LOC) — E-DERIVED-CIRCULAR-DEP.
- `derived-value-mutate.test.js` (474 LOC) — E-DERIVED-VALUE-MUTATE, three mutation forms.
- `validator-arg-parsing.test.js` (385 LOC) — B9 ValidatorArg parsing.
- `validator-catalog.test.js` (227 LOC) — UNIVERSAL_CORE_PREDICATES catalog.
- `validator-circular-dep.test.js` (242 LOC) — E-VALIDATOR-CIRCULAR-DEP.
- `validator-type-check.test.js` (251 LOC) — E-TYPE-031 four shapes.

### compiler/tests/integration/  (31 files + per-test scratch dirs `_tmp_*`)
Cross-module integration. S68-S69 updates:
- `parse-shapes-v0next.test.js` — updated to assert structured ExprNodes (not raw strings) for validator args.
- `symbol-table.test.js` — updated for B11/B12/B13/B14+ pass additions.
Examples: `self-compilation.test.js`, `self-host-smoke.test.js`, `cross-file-components.test.js`, `expr-parity.test.js`, `expr-node-corpus-invariant.test.js`, `kickstarter-v2-smoke.test.js`, `oq-2-stdlib-runtime-resolution.test.js`, `parse-variant-runtime.test.js`, `parse-import-pinned.test.js`, `parse-mutation-shapes.test.js`, `parse-reset-keyword.test.js`, `lin-decl-emission.test.js`, `lin-enforcement-e2e.test.js`, `program-documentary-attrs.test.js`, `sql-001-bracket-matched.test.js`, `uvb-w1-pipeline.test.js`.

### compiler/tests/conformance/  (81 files)
- `block-grammar/` — block grammar conformance (largest sub-bucket).
- `s32-fn-state-machine/` — §54.6 / §33.6 fn purity inside state-machine transitions.
- `tab/` — TAB conformance fixtures.

### compiler/tests/browser/  (11 files)
happy-dom + puppeteer tests: `browser-bind-value`, `browser-class-binding`, `browser-components`, `browser-conditionals`, `browser-forms`, `browser-reactive-arrays`, `browser-todomvc`, `browser-todo`, `browser-transitions`, `runtime-behavior`, `todomvc-e2e`.

### compiler/tests/lsp/  (10 files)
LSP coverage L1+L2+L3+L4: `analysis`, `completions`, `document-symbols`, `hover`, `l3-component-prop-completions`, `l3-import-completions`, `l3-sql-completions`, `l4-code-actions`, `l4-signature-help`, `workspace-l2`.

### compiler/tests/self-host/  (4 files)
Self-host conformance tests that compile + run `compiler/self-host/*.scrml` mirrors: `ast.test.js`, `bpp.test.js`, `bs.test.js`, `tab.test.js`.

### compiler/tests/commands/  (3 files)
CLI subcommand tests: `build-adapters`, `init`, `library-mode-types`.

### compiler/tests/helpers/  (2 files)
Shared helpers: `expr.ts` (expression-fixture helper), `extract-user-fns.js` (test-input scrubber).

## Fixtures & Factories

samples/                          — `.scrml` programs used by integration + bench compiles.
samples/compilation-tests/        — large bucket of compile-only fixtures (counted only, not enumerated).
samples/gauntlet-r{11,13,14,15,18,19}/, samples/gauntlet-s19-phase4/  — gauntlet sample sets.
benchmarks/                       — perf-bench inputs.
compiler/tests/integration/_tmp_*/ — per-test scratch dirs (auto-created; not committed if .gitignored).

## Pattern

Tests use Bun's `test()` / `describe()` / `expect()` API. A typical compile-then-assert test imports `compileSource` (or similar) from `compiler/src/api.js`, runs the full pipeline against an inline `.scrml` source string or a `samples/` fixture, then asserts on the returned diagnostics, AST shape, or emitted JS/HTML/CSS strings. Browser tests register happy-dom globally via `@happy-dom/global-registrator` and exercise the runtime template against the emitted client bundle. Self-host tests build `compiler/self-host/dist/*` first, then assert that scrml-source-of-the-compiler produces the same outputs as the JS-source compiler against fixtures.

Two persistent self-host smoke failures (historical, deferred per user) — see master-list.md.

## Tags
#scrmlTS #map #test #bun-test #happy-dom #puppeteer #self-host #s67 #s68 #s69 #9626-pass #a1b-complete #b11 #b12 #b13 #b14 #b15 #b16 #b17 #b18 #b19 #b20 #b21 #b22 #synth-surface #engine-statechild #bare-variant #refinement-three-zone #reset-target

## Links
- [primary.map.md](./primary.map.md)
- [build.map.md](./build.map.md)
- [structure.map.md](./structure.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
