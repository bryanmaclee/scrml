# test.map.md
# project: scrmlts
# updated: 2026-05-23T00:00:00Z  commit: 73dd816c

## Test Framework

Runner: `bun test` (Bun >=1.3.13 built-in; uses `bun:test` API)
Config: `bunfig.toml` — `[test] root="compiler/tests/", timeout=10000ms`
Browser tests: `@happy-dom/global-registrator` + `happy-dom`; e2e via `@playwright/test`
Run all: `bun test compiler/tests/` (preceded by `pretest` sample compilation)
Run single: `bun test compiler/tests/unit/<file>.test.js`
Run by name: `bun test compiler/tests/<file>.test.js -t "<test name>"`

## Volume (HEAD 73dd816c — S124 wrap state)

759 .test.js files (was 743 at S123 wrap; S124 added parser-conformance-within-node.test.js + m66-b2-engine-statechild-walker.test.js + updated parser-conformance-canary.test.js).

## Test Categories

| Category | Glob | Count |
|---|---|---|
| Unit | `compiler/tests/unit/**` | 535 |
| Integration | `compiler/tests/integration/**` | 77 |
| Conformance | `compiler/tests/conformance/**` | 105 |
| Browser | `compiler/tests/browser/**` | 12 |
| Commands | `compiler/tests/commands/**` | 6 |
| LSP | `compiler/tests/lsp/**` | 10 |
| Self-host | `compiler/tests/self-host/**` | 4 |
| E2E | `e2e/**` | Playwright (separate runner) |

## Parser-Conformance Suite (load-bearing for M5 swap / C1+C2 / M6 Wave 1)

Top-level files at `compiler/tests/`:

| File | What it tests |
|---|---|
| `parser-conformance-lexer.test.js` | native lexer vs Acorn (M1.x) |
| `parser-conformance-expr.test.js` | native Expr AST vs Acorn (M2.x) |
| `parser-conformance-stmt.test.js` | native Stmt AST vs Acorn (M3.x) |
| `parser-conformance-markup.test.js` | native markup Block tree; M6.6.b.1.5 attr tokenizer assertions |
| `parser-conformance-corpus.test.js` | bench corpus + .scrml smoke pass |
| `parser-conformance-canary.test.js` | dual-pipeline-canary harness; **updated M6.7 STOP** — canary closed with M6.7 corpus migrations |
| `parser-conformance-collect-hoisted.test.js` | collectHoisted hoist-synthesis (A3); M6.4a expanded |
| `parser-conformance-parse-file.test.js` | `nativeParseFile` FileAST assembler (C1) |
| `parser-conformance-within-node.test.js` | **NEW S124 M6.5.b.0** — within-node parity 7-class classifier; allowlist at `parser-conformance-within-node-allowlist.json` |

## S124 NEW Test Files

| File | What it tests |
|---|---|
| `compiler/tests/parser-conformance-within-node.test.js` | M6.5.b.0 — within-node divergence classifier (Wave 2 unblocked) |
| `compiler/tests/unit/m66-b2-engine-statechild-walker.test.js` | M6.6.b.2 + M6.6.b.3 — structural equality of native-walker vs legacy `parseEngineStateChildren` for every EngineStateChildEntry shape category |

## S123 NEW Test Files (from prior watermark)

| File | What it tests |
|---|---|
| `unit/v-kill-state-undeclared.test.js` | E-STATE-UNDECLARED (V-kill) |
| `unit/unit-cc-write-at-body-top.test.js` | E-WRITE-NOT-IN-LOGIC-CONTEXT (Unit CC) |
| `unit/runtime-chunk-dependencies.test.js` | `applyChunkDependencies` (6nz Bug P) |
| `unit/not-keyword.test.js` (MODIFIED) | GITI-017 `rewriteNotKeyword` regex awareness |

## S122 NEW Test Files (still load-bearing)

`m6-2a-markupvalue-bridge-source-aware.test.js`, `m6-3-emit-match-native-bareBody.test.js`, `m6.4a-native-p2-form1.test.js`, `m6-5-parser-workarounds-noop-under-native.test.js`, `i-fn-promotable.test.js`, `lint-ghost-patterns.test.js`, `reactive-compound-assign-and-postfix.test.js`, `arrow-object-literal-init-thunks.test.js`, `aliased-imports-local-name.test.js`.

Native-parser bridge unit tests: `translate-stmt-bridge.test.js` (R4 COMPLETE), `translate-expr-bridge.test.js`, `native-parser-core-decl-keywords.test.js`, `native-parser-scrml-extension-exprs.test.js`.

## Pre-commit Test Gate

`bun test compiler/tests/unit compiler/tests/integration compiler/tests/conformance --bail`
Browser tests are NOT in the pre-commit gate (run separately / in pre-push).

## Fixtures & Factories

| Path | Contents |
|---|---|
| `compiler/tests/fixtures/` | promote-match-canonical.scrml, promote-multi-file-app/ |
| `compiler/tests/helpers/` | expr.ts (ExprNode test helpers), extract-user-fns.js |
| `compiler/tests/parser-conformance-within-node-allowlist.json` | M6.5.b.0 within-node parity allowlist (known acceptable divergences) |
| `samples/compilation-tests/` | ~318 test-case directories driven by pretest (counted, not enumerated) |
| `docs/changes/m65-path-b-adapter-scoping/fixtures/` | 8 .scrml fixture files for M6.5 scoping empirical catalog |

## Pattern

Tests use `bun:test` (`describe` / `test` / `expect`). Compiler tests drive `compileScrml()` from `compiler/src/api.js` and assert on `result.errors` / `result.warnings` / `result.outputs`. Diagnostic-stream partition rule (S92/S93): W-* / I-* + severity warning/info → `result.warnings`; tests asserting on W-/I- codes MUST use a cross-stream helper, not `result.errors.filter`. `E-STATE-UNDECLARED` + `E-WRITE-NOT-IN-LOGIC-CONTEXT` ARE errors → assert on `result.errors` normally.

Parser-conformance tests diff native-parser output against the Acorn oracle. The dual-pipeline canary (`parser-conformance-canary.test.js`) diffs `nativeParseFile` FileAST against live `buildAST` FileAST. The within-node classifier (`parser-conformance-within-node.test.js`) tests at the sub-node field level (orthogonal axis to shape canary). M6.6.b.2 parity tests assert structural equality of `engine-statechild-walker.ts` output vs legacy `parseEngineStateChildren` output.

## Tags
#scrmlts #map #test #bun-test #parser-conformance #native-parser #dual-pipeline-canary #m6-wave1 #m6-6-b2 #m6-5-b0 #v-kill #unit-cc #r4-continuation #giti-017 #6nz-bug-p #m6-2b #s124

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [build.map.md](./build.map.md)
