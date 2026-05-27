# test.map.md
# project: scrmlts
# updated: 2026-05-27T04:14:32Z  commit: f6c98ed8

## Test Framework

Runner: `bun test` (Bun >=1.3.13 built-in; uses `bun:test` API)
Config: `bunfig.toml` — `[test] root="compiler/tests/", timeout=10000ms`
Browser tests: `@happy-dom/global-registrator` + `happy-dom`; e2e via `@playwright/test`
Run all: `bun test compiler/tests/` (preceded by `pretest` sample compilation)
Run single: `bun test compiler/tests/unit/<file>.test.js`
Run by name: `bun test compiler/tests/<file>.test.js -t "<test name>"`

## Volume (HEAD f6c98ed8 — S135)

801 .test.js/.test.ts files under `compiler/tests/` (was 780 at watermark 3a660c7c; +21 net since S134 close — 3 new unit files this delta + prior S135 commits). Major new-test clusters this delta: Q6-narrow reset × lifecycle (25 tests), lifecycle source-form follow-ups (17 tests), structural-in-logic-body E-STRUCTURAL-ELEMENT-MISPLACED (19 tests).

## Test Categories

| Category | Glob | Count |
|---|---|---|
| Unit | `compiler/tests/unit/**` | 566 |
| Integration | `compiler/tests/integration/**` | 88 |
| Conformance | `compiler/tests/conformance/**` | 105 |
| Browser | `compiler/tests/browser/**` | 12 |
| Commands | `compiler/tests/commands/**` | 6 |
| LSP | `compiler/tests/lsp/**` | 10 |
| Self-host | `compiler/tests/self-host/**` | 4 |
| Top-level parser-conformance | `compiler/tests/*.test.js` | 10 |
| E2E | `e2e/**` | Playwright (separate runner) |

## S135 NEW Test Files

| File | Tests | What it tests |
|---|---|---|
| `unit/lifecycle-shape1-reset.test.js` | 25 | Q6-narrow (§6.8.3) — `reset(@cell)` × lifecycle per-access state management: pre-type reset reverts to "pre" + fires E-TYPE-001 on subsequent post-transition access; post-type reset maintains/advances to "post"; cancel-then-apply ordering (§6.8.2/§6.8.3); `default=` composition; discrimination interaction. Uses direct-AST construction (bypasses parser tokenization) + `compileScrml` end-to-end. |
| `unit/lifecycle-shape1-source-form.test.js` | 17 | Source-form Shape 1 variant-progression lifecycle: bare-dot `(.Draft to .Published)` + qualified-enum `(Article.Draft to Article.Published)` forms via `compileScrml`; validates Fix #1 (findTopLevelArrow whitespace tolerance) + Fix #3 (parseLifecycleReturnAnnotation qualified-enum stripping + diagnostic text); Fix #3 companion (TRANSITION_CALL_RE `@` prefix tolerance); regression-pin for presence-progression (already worked). |
| `unit/structural-in-logic-body.test.js` | 19 | E-STRUCTURAL-ELEMENT-MISPLACED fire for `${...}` logic-body silent-swallow class: all 9 structural elements (`<schema>`, `<engine>`, `<channel>`, `<page>`, `<auth>`, `<errors>`, `<onTransition>`, `<onTimeout>`, `<onIdle>`); inner-fallback fire (nested logic body); negative regressions (HTML elements / reactive-decl / PascalCase component / self-closing var-ref / canonical placement); multi-fire case. Driver: `compileScrml` end-to-end. |

## S131 NEW Test Files — Iteration (`<each>`)

| File | What it tests |
|---|---|
| `unit/each-block.test.js` | each-block codegen — `<each in=>` / `<each of=N>` mount HTML + body render; `@.` sigil; `as name` alias; `<empty>` sub-element; key= inference + W-EACH-KEY-001; nested each-blocks |
| `integration/bug-17-tailwind-lift-iteration-scan.test.js` | tailwind class scan across lift/iteration sites |

## S130-S131 NEW Test Files — Lifecycle Annotation

| File | What it tests |
|---|---|
| `unit/type-system-lifecycle.test.js` | Landing 1 — `(A to B)` registry build + E-TYPE-001 access-before-transition |
| `unit/type-system-lifecycle-landing-2.test.js` | Landing 2 — E-TYPE-LIFECYCLE-ON-ENGINE-CELL + `->`→`to` glyph migration + W-LIFECYCLE-LEGACY-ARROW |
| `unit/type-system-lifecycle-landing-2-5.test.js` | Landing 2.5 — fn-return transition-marker; E-TYPE-LIFECYCLE-VARIANT-NOT-TRANSITIONED |
| `integration/lifecycle-access-pipeline.test.js` | Landing 1 end-to-end through compileScrml |
| `integration/lifecycle-landing-2-pipeline.test.js` | Landing 2 end-to-end |
| `integration/lifecycle-landing-2-5-pipeline.test.js` | Landing 2.5 end-to-end |

## S131 NEW Test Files — ~snapshot codegen fix (Bug 15)

| File | What it tests |
|---|---|
| `integration/tilde-snapshot-codegen-fix.test.js` | orphan `~` sigil no longer leaks into emitted JS (bare-expr Phase 3 fast-path skip + emitIdent defensive fallback) |

## S130-S131 NEW Test Files — MCP-V0.D/E

| File | What it tests |
|---|---|
| `integration/mcp-program-attr.test.js` | MCP-V0.D — `<program mcp>` opt-in: auto-`emitPerRoute`, mcpAutoActivated/mcpMode surface, dev-only vs always boot gate |
| `integration/mcp-v0-e2e.test.js` | MCP-V0.E — end-to-end over a real compiled multi-page app fixture; series-complete close |

## S127-S129 NEW Test Files — Native-parser M6.5/M6.7 D-class

| File | What it tests |
|---|---|
| `unit/m65-b2-1-statedecl-boundary.test.js` | M6.5.b.2.1 — newline-as-stmt-separator for consecutive structural state-decls |
| `unit/m65-b3-hoist-gap.test.js` | M6.5.b.3 — hoist-recursion regression-lock (Class C gap already CLOSED) |
| `unit/m65-b4-sql-promotion.test.js` + `integration/m65-b4-sql-leak.test.js` | M6.5.b.4 — bare `?{}` → kind:"sql" (server-SQL-to-client leak fix) |
| `unit/m65-b56-shape-span-normalize.test.js` | M6.5.b.5/b.6 — native→live FileAST shape (Class F) + span.file (Class G) |
| `unit/m67-c1-component-parity.test.js` | M6.7-C1 — native component-def raw bodyText-relative span (same-file E-COMPONENT-020) |
| `unit/m67-c2-codegen-output-parity.test.js` | M6.7-C2 — native `server @var = expr` codegen parity (mount-hydrate flip) |
| `unit/m67-d1-arrow-callarg-parse.test.js` | M6.7-D1 — parsePrimary accepts null/undefined |
| `unit/m67-d2-server-function-parse.test.js` | M6.7-D2 — server/pure modifier on `function` |
| `unit/m67-d3-match-arm-parse.test.js` | M6.7-D3 — parseMatchArm accepts `:>` colon-arrow |
| `unit/m67-d6-string-import-parse.test.js` | M6.7-D6 — parseNamedImportSpecifiers accepts string-literal specifier |
| `unit/m67-d7-given-form-parse.test.js` | M6.7-D7 — `given` presence-guard (§42.2.3) |
| `unit/m67-d8a-i-function-return-type.test.js` | M6.7-D8a-i — parseFunctionDecl accepts `-> ReturnType` annotation |

## Parser-Conformance Suite (load-bearing for M5 swap / C1+C2 / M6)

Top-level files at `compiler/tests/`:

| File | What it tests |
|---|---|
| `parser-conformance-lexer.test.js` | native lexer vs Acorn |
| `parser-conformance-expr.test.js` | native Expr AST vs Acorn; M6.5.b.1 match-arm + M6.7-D3 `:>` |
| `parser-conformance-stmt.test.js` | native Stmt AST vs Acorn |
| `parser-conformance-markup.test.js` | native markup Block tree |
| `parser-conformance-corpus.test.js` | bench corpus + .scrml smoke pass |
| `parser-conformance-canary.test.js` | dual-pipeline canary; M6.7 STOP — flag flip reverted; C/D-class fixes landed |
| `parser-conformance-collect-hoisted.test.js` | collectHoisted hoist-synthesis (A3) |
| `parser-conformance-parse-file.test.js` | `nativeParseFile` FileAST assembler (C1) |
| `parser-conformance-within-node.test.js` | within-node parity 7-class classifier; allowlist rebased (M6.5/M6.7 D-class moved ~13 fixtures by parseFunctionDecl fix) |

## S127 Test Files — MCP-V0.A descriptor-extractor (still load-bearing)

| File | What it tests |
|---|---|
| `unit/mcp-descriptors-engines.test.js` | `collectEngineDescriptors` — variants, rules map, cellKey, primary vs derived |
| `unit/mcp-descriptors-forms.test.js` | `collectFormDescriptors` — nested compoundKeys, per-field descriptors |
| `unit/mcp-descriptors-channels.test.js` | `collectChannelDescriptors` — name/topic defaults, §38.4 cells |
| `unit/mcp-descriptors-serverfns.test.js` | `collectServerFnDescriptors` — isServer filter, dispatchable:false, file dedupe |
| `unit/mcp-descriptors-degenerate-spa.test.js` | empty/degenerate app → well-formed empty sidecars |
| `unit/mcp-runtime-helpers.test.js` | MCP-V0.B shim — install/loadSidecars/getCurrentVariant/getFormStatus/getChannelState |
| `integration/mcp-descriptors-runtime-integration.test.js` | compileScrml emits sidecars → fed into B runtime helpers end-to-end |
| `integration/mcp-server-tools.test.js` | the 11-tool surface over a real compiled fixture (Sub-unit C) |
| `integration/bug-w-binary-precedence-parens.test.js` | Bug W precedence-paren re-insertion |
| `integration/giti-019-lift-loop-coalesce-parens.test.js` | GITI-019 `?? ""` coalesce-guard parenthesization |
| `unit/not-return-statement-glue.test.js` | 6nz-S `[ \t]+` + keyword-exclusion (`return not` no longer glues) |

### S127 helper
`compiler/tests/helpers/mcp-sidecar-compile.js` — `makeSidecarTmpRoot(label)` / `cleanupSidecarTmpRoot(root)` / `compileAndReadSidecars(source, tmpRoot)`: drives `compileScrml()` on inline source into a tmp dir and reads back emitted .json sidecars. Backbone of the MCP-V0.A + .D/.E suites.

## S123-S125 Test Files (still load-bearing)

| File | What it tests |
|---|---|
| `unit/m65-b2-structural-state-decl.test.js` | M6.5.b.2 structural state-decl `<ident>` LHS |
| `unit/m66-b2-engine-statechild-walker.test.js` | M6.6.b.2/b.3 native-walker vs legacy structural equality |
| `unit/v-kill-state-undeclared.test.js` | E-STATE-UNDECLARED (V-kill) |
| `unit/unit-cc-write-at-body-top.test.js` | E-WRITE-NOT-IN-LOGIC-CONTEXT (Unit CC) |
| `unit/runtime-chunk-dependencies.test.js` | `applyChunkDependencies` (6nz Bug P) |

## Pre-commit Test Gate

`bun test compiler/tests/unit compiler/tests/integration compiler/tests/conformance --bail`
Browser tests are NOT in the pre-commit gate (run separately / in pre-push).

## Fixtures & Factories

| Path | Contents |
|---|---|
| `compiler/tests/fixtures/` | promote-match-canonical.scrml, promote-multi-file-app/, MCP-V0.E multi-page app fixture |
| `compiler/tests/unit/__fixtures__/structural-in-logic-body/` | S135 fixture dir for structural-in-logic-body tests (dist output) |
| `compiler/tests/helpers/` | expr.ts, extract-user-fns.js, mcp-sidecar-compile.js |
| `compiler/tests/parser-conformance-within-node-allowlist.json` | within-node parity allowlist (rebased; M6.5/M6.7 D-class) |
| `samples/compilation-tests/` | ~318 test-case directories driven by pretest (counted, not enumerated) |

## Pattern

Tests use `bun:test` (`describe` / `test` / `expect`). Compiler tests drive `compileScrml()` from `compiler/src/api.js` and assert on `result.errors` / `result.warnings` / `result.outputs`. Diagnostic-stream partition rule (S92/S93): W-* / I-* + severity warning/info → `result.warnings`; tests asserting on W-/I- codes MUST use a cross-stream helper. `E-TYPE-001` + lifecycle/E-TYPE-LIFECYCLE-* + `E-STRUCTURAL-ELEMENT-MISPLACED` + E-STATE-UNDECLARED + E-WRITE-NOT-IN-LOGIC-CONTEXT ARE errors → assert on `result.errors`; `W-EACH-*` + `W-LIFECYCLE-LEGACY-ARROW` are warnings → assert on `result.warnings`.

S135 lifecycle-shape1-reset and lifecycle-shape1-source-form tests use a combination of direct-AST construction (bypasses parser to test tracker logic in isolation) and `compileScrml` end-to-end (source-form paths). `structural-in-logic-body.test.js` is `compileScrml`-only.

Parser-conformance tests diff native-parser output against the Acorn oracle. The dual-pipeline canary diffs `nativeParseFile` FileAST against live `buildAST` FileAST. MCP tests drive `compileScrml` via `compileAndReadSidecars(source, tmpRoot)` and assert on emitted .json shapes; runtime-shim tests import the shim module directly, fake the runtime via `install({...})`, point `loadSidecars()` at a tmp dir, and `_resetForTests()` between cases.

## Tags
#scrmlts #map #test #bun-test #parser-conformance #native-parser #m6-wave1 #m6-7-dclass #iteration #each #lifecycle #lifecycle-reset-aware #structural-in-logic-body #snapshot-fix #mcp-v0 #mcp-program-attr #v-kill #unit-cc #s131 #s135

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [build.map.md](./build.map.md)
