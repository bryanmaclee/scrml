# test.map.md
# project: scrmlts
# updated: 2026-05-18T00:00:00-06:00  commit: dae8ff1

## Test Framework

| Field | Value |
|-------|-------|
| Runner | bun:test (built-in) |
| Config | bunfig.toml (`root = "compiler/tests/"`, `timeout = 10000`) |
| Pretest | `bash scripts/compile-test-samples.sh` — compiles ~311 sample fixtures |
| Run all | `bun test compiler/tests/` |
| Run subset | `bun test compiler/tests/unit` / `compiler/tests/integration` / `compiler/tests/conformance` |
| Run single | `bun test compiler/tests/unit/<file>.test.js` |
| Run native-parser lexer | `bun test compiler/tests/parser-conformance-lexer.test.js` |
| With bail | `bun test ... --bail` (used by pre-commit hook) |
| Coverage | `bun test compiler/tests/ --coverage` |

## Test Counts (S101 / v0.3.1 era, 2026-05-18)

Pre-commit subset (unit + integration + conformance): **12,645 pass / 88 skip / 1 todo / 0 fail / 658 files**
Full suite (`bun run test`): **15,468+ pass / 0 fail** (S101 per invocation context)
Native-parser conformance: **97 pass / 0 skip / 0 fail** (parser-conformance-lexer.test.js, M1.4)

Prior watermarks: S100 close — 15,444 pass / 172 skip / 1 todo / 0 fail / 689 files (full); S92 close — 12,694 pass / 638 files (pre-commit subset)

## New Tests Since S92 Baseline

**M1.x native-parser conformance (NEW S99-S103):**
- compiler/tests/parser-conformance-lexer.test.js — M1.1-M1.4 bench-corpus + inline micro-corpus. Acorn vs `lex.js` token-by-token comparison. As of M1.4: 97 pass / 0 skip / 0 fail. Bench-corpus `expr-literals.js` retains `"M1.2-string-template-regex"` skip pending M1.5 regex-token normalizer
- compiler/tests/parser-conformance.test.js — top-level parser conformance driver (Acorn vs native at parse level)
- compiler/tests/parser-conformance/bench/ — conformance bench corpus files
- compiler/tests/parser-conformance/parsers.js — Acorn + native-parser adapter shims
- compiler/tests/parser-conformance/tier-diff.js — token shape normalizer

**§4.17 raw-content conformance (NEW S101):**
- compiler/tests/conformance/conf-raw-content-pre-code.test.js — `<pre>` / `<code>` raw-content body passthrough + E-CTX-001 unclosed-element diagnostic

**S93-S103 compiler bug fixes (test coverage added per dispatch):**
- Various unit tests for scope-walker gaps, parseParamList default-value handling, export function synth stubs, `is some`/`is not` preprocessor, E-SWITCH-FORBIDDEN post-parse walker — per docs/changes/heads-up-s95-bugs/

## A-5 Integration Fixtures  [compiler/tests/integration/fixtures/a5/]

| Fixture | Used by |
|---------|---------|
| fixtures/a5/multipage-multirole/routes/{index,loads,admin}.scrml | A-5.1 FX-1 cornerstone |
| fixtures/a5/cross-file/app.scrml + components/header.scrml | A-5.2 FX-2 cross-file |
| fixtures/a5/lint-large-initial-chunk.scrml | A-5.4 FX-7 W-CG-CHUNK-LARGE fixture |
| fixtures/a5/lint-no-prefetch/routes/{index,other}.scrml | A-5.4 FX-8a W-CG-CHUNK-NO-PREFETCH |
| fixtures/a5/lint-prefetch-unresolved/routes/{about,index}.scrml | A-5.4 FX-8b W-CG-CHUNK-PREFETCH-UNRESOLVED |
| fixtures/a5/runtime-fallback-async-gate.scrml | A-5.4 FX-5 W-AUTH-RUNTIME-FALLBACK |

## Test Categories

| Category | Path | Approx Count |
|----------|------|--------------|
| Unit (named) | compiler/tests/unit/ (top-level .test.*) | ~390 files |
| Unit (gauntlet-s*) | compiler/tests/unit/gauntlet-s*/ | ~64 files |
| Integration | compiler/tests/integration/ | ~52 files |
| Conformance (top-level) | compiler/tests/conformance/ (top-level) | ~26 files (+conf-raw-content-pre-code S101) |
| Conformance (subtrees) | compiler/tests/conformance/block-grammar, s32-fn-state-machine, tab | ~77 files |
| Parser conformance | compiler/tests/parser-conformance-lexer.test.js + parser-conformance.test.js | 2 test files + bench corpus |
| Browser | compiler/tests/browser/ | 11 files |
| LSP | compiler/tests/lsp/ | 10 files |
| Self-host | compiler/tests/self-host/ | 4 files |
| Commands | compiler/tests/commands/ | 6 files |
| E2E (Playwright) | e2e/tests/ | 5 spec files (3-browser) |

## Unit Test Coverage Highlights (additions since S92 in brackets)

**M1.x Native Parser Conformance [NEW S99-S103]**
parser-conformance-lexer.test.js [M1.1 skeleton → M1.2 strings+templates+§51.0.Q.1 → M1.3 comments → M1.4 regex; 97 pass at M1.4; Acorn bench-corpus token-by-token comparison; DD §D4 P3 regex-vs-division discrimination at Ident/RParen/return sites included]

**§4.17 Raw-content Conformance [NEW S101]**
conf-raw-content-pre-code.test.js [§4.17 `<pre>`/`<code>` passthrough + E-CTX-001 unclosed]

**A-5 Wave-Close Polish [S92]**
codegen-chunk-lint-polish.test.js [Q-OPEN-5 chunkSizeBudgetBytes + Q-OPEN-6 W-CG-CHUNK-PREFETCH-UNRESOLVED split],
codegen-chunk-manifest-compiler-identity.test.js [Q-OPEN-4 getCompilerIdentity() + fallback contract],
compile-chunk-size-budget.test.js [--chunk-size-budget CLI flag, command-level]

**A-5 Integration [S92]**
multipage-multirole-integration.test.js [A-5.1 3-EP × 3-role FX-1 cornerstone],
cross-file-expansion-integration.test.js [A-5.2 cross-file MOD+CE end-to-end],
negative-cascade-integration.test.js [A-5.3 diagnostic cascade FX-3 + FX-4],
lint-family-e2e-integration.test.js [A-5.4 W-AUTH-RUNTIME-FALLBACK + W-CG-CHUNK-* family],
determinism-integration.test.js [A-5.5 cross-wave determinism 10-run + explicit budget],
trucking-dispatch-smoke-integration.test.js [A-5.5 reference-app compile-smoke F-6]

**A-2 Reachability — S91**
reachability-solver-outer-fixpoint.test.js [A-2.7 outer fixed-point + E-CLOSURE-001, 29 tests],
reachability-record-determinism.test.js [A-2.8 canonical JSON, 21 tests]

**A-3 AuthGraph [S91]**
auth-graph-login-missing.test.ts [W-AUTH-LOGIN-MISSING + W-AUTH-PAGE-INFERRED],
auth-graph-spec-40-9-9-worked-example.test.js [§40.9.9 Driver/Admin/viewer per-role worked-example]

**A-4 Route Splitter [S91]**
codegen-route-splitter.test.js [A-4.1/A-4.2/A-4.3 orchestrator + atom-emitter, 43 tests],
codegen-route-splitter-tier-n.test.js [A-4.5 tier-N dispatch, 14 tests],
chunk-content-addressing.test.js [A-4.6 FNV-1a hash, 19 tests],
codegen-html-augmentation.test.js [A-4.7 HTML augmenter + W-CG-CHUNK-* lints, 31 tests],
initial-chunk-emission.test.js [A-4.2/A-4.6, 20 integration tests],
tier1-idle-prefetch.test.js [A-4.3, 9 integration tests],
tier2-hover-prefetch.test.js [A-4.4, 21 integration tests]

**Generate Auth [S91]**
generate-auth.test.js [scrml generate auth CLI, 12 tests]

**Codegen / Wire Format [S90 baseline]**
wire-format-encoder-decoder.test.js [integration], conf-WIRE-FORMAT-DECODER.test.js [conformance]

**AST / Tokenizer / Parser**
ast-builder-*.test.js, tokenizer-*.test.js, expression-parser.test.js, block-splitter.test.js

**Pipeline Stages**
code-generator.test.js, type-system.test.js, dependency-graph.test.js, protect-analyzer.test.js,
route-inference.test.js, batch-planner.test.js, symbol-table.test.js, binding-registry.test.js,
name-resolver (p1e-name-resolver.test.js), module-resolver.test.js,
dg-markup-read-node-a12.test.js, dg-markup-read-emission-a13.test.js,
dg-markup-read-emission-a14.test.js, dg-markup-read-emission-a15.test.js

**Auth / Session**
session-auth.test.js, state-authority-codegen.test.js, state-authority-parsing.test.js,
stdlib-auth.test.js, stdlib-oauth.test.js, stdlib-oauth-presets.test.js
f-auth-002-export-modifiers.test.js [integration]

**Codegen Emitters**
emit-match.test.js, emit-test.test.js, emit-library.test.js, emit-lift.test.js,
emit-logic.test.js, engine-body-render.test.js, engine-body-children.test.js,
emit-expr-engine-routing-option-a.test.js, match-arm-*.test.js

**Conformance (§34 error codes)**
conf-AUTH-003..005, conf-CG-001-warn, conf-CG-010, conf-CG-014,
conf-WIRE-FORMAT-DECODER, conf-INPUT-001..005, conf-CTRL-011,
conf-ERROR-008, conf-IMPORT-007, conf-LIFECYCLE-015, conf-LOOP-005..007, conf-META-EVAL-002,
conf-TRY-CATCH-IN-SCRML-SOURCE, conf-raw-content-pre-code (S101);
block-grammar/conf-001..047 (47 files); s32-fn-state-machine/; tab/

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
| compiler/tests/commands/migrate-program-shape-fixtures/ | 7 bucket-classification fixtures |
| compiler/tests/integration/fixtures/a5/ | A-5 integration fixtures: multipage-multirole, cross-file, lint-large-initial-chunk, lint-no-prefetch, lint-prefetch-unresolved, runtime-fallback-async-gate |
| compiler/tests/parser-conformance/bench/ | JS-subset bench corpus files; expr-literals.js retains M1.5-pending skip |
| samples/compilation-tests/ | ~311 .scrml fixtures compiled by pretest; dist/ gitignored |
| e2e/ | Playwright: dev-server-fixture.ts; 02-counter, 03-contact-book, 05-multi-step-form, 14-mario, todomvc specs |

## Pattern

Tests use `bun:test` (`describe`, `test`, `expect`). Unit tests for pipeline passes:
1. Construct a minimal scrml source string or AST fragment (V5-strict `<x> = 0` at top-level, `@x = 0` inside `${...}`)
2. Run the target stage function directly
3. Assert on the returned structure using `expect().toEqual()`, `expect().toContain()`, `expect().toMatchObject()`

Native-parser tests import `lex.js` directly (not the .scrml shadow), compare Token[] against Acorn's tokenizer output via normalizer; milestone-gated SKIP annotations mark forward-milestone work.

Integration tests run `compileScrml()` from `api.js` and assert on output HTML, client JS, server JS, and (when `emitPerRoute: true`) chunk payloads, chunks.json manifest, and diagnostic arrays. Cross-stream helper `allDiags(r) = [...r.errors, ...r.warnings]` is canonical for W-*/I-* assertions (single-stream filter silently misses W-* codes — S92 cornerstone finding).

## Tags
#scrmlts #map #test #bun #conformance #unit #integration #s101 #v0.3.1 #approach-a5 #approach-a2 #approach-a3 #approach-a4 #reachability #auth-graph #wire-format #playwright #e2e #route-splitter #generate-auth #q-open-4 #q-open-5 #q-open-6 #native-parser #m1-4 #parser-conformance #raw-content

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [build.map.md](./build.map.md)
- [error.map.md](./error.map.md)
