# test.map.md
# project: scrmlts
# updated: 2026-05-21T09:04:37-06:00  commit: 092fa90a

## Test Framework
Runner: `bun test` (Bun built-in test runner)
Config: bunfig.toml — `[test] root = "compiler/tests/", timeout = 10000`
DOM: @happy-dom/global-registrator preloads happy-dom globals for DOM-touching tests
E2E runner: @playwright/test (separate — e2e/playwright.config.ts)
Run all: `bun test compiler/tests/`  (npm: `bun run test`)
Run with coverage: `bun test compiler/tests/ --coverage`
Run single file: `bun test compiler/tests/unit/<name>.test.js`
Run a subtree: `bun test compiler/tests/conformance`
Run e2e: `bun run e2e`  (or `playwright test --config=e2e/playwright.config.ts`)
Pre-test hook: `bash scripts/compile-test-samples.sh` runs automatically before `test`.

## Test Categories  [compiler/tests/ — 732 total .test.js/.test.ts files]
unit         — compiler/tests/unit/**            — ~514 files — per-pass / per-construct unit tests (largest bucket)
integration  — compiler/tests/integration/**     —  ~75 files — multi-stage pipeline + canonical-corpus smoke tests
conformance  — compiler/tests/conformance/**     — ~105 files — one test per SPEC §34 error code + block-grammar subdir
browser      — compiler/tests/browser/**         —  ~12 files — runtime behavior under happy-dom
lsp          — compiler/tests/lsp/**             —  ~10 files — language-server feature tests
commands     — compiler/tests/commands/**        —   ~6 files — CLI subcommand tests (init/migrate/promote/...)
self-host    — compiler/tests/self-host/**       —   ~4 files — self-hosting compiler-module tests
parser-conformance — compiler/tests/parser-conformance-*.test.js — 6 root files (see below)
e2e          — e2e/tests/**.spec.ts              —   6 files — Playwright (02-counter, 03-contact-book,
                                                   05-multi-step-form, 14-mario, todomvc, docs-website)

Full-suite pass counts:
  S113 close: 17,812 / 0 fail / 169 skip / 1 todo
  S114 close: 17,842 / 0 fail / 173 skip / 1 todo  (net +30 pass / +4 skip; 0 regressions)

## Native-Parser Conformance Suite
Six root test files drive the scrml-native parser (compiler/native-parser/)
against an Acorn-style oracle + inline micro-corpora. They are the single source
of truth for current native-parser pass/skip/fail status.

parser-conformance-lexer.test.js  — M1.1-M1.5 lexer; runs bench corpus + inline
  micro-corpus through both Acorn's tokenizer and native-parser/lex.js; asserts
  kind+text+span per token. `expr-literals.js` flipped to `full` byte-identical
  disposition at S102 (`bcb48c9f`); M1.5 verified S113.
parser-conformance-expr.test.js   — M2 (M2.1-M2.4) + M4 (async/yield ops, K3/K4/K5
  token closures, MarkupValue ExprKind); exercises native-parser/parse-expr.js +
  ast-expr.js; conformance Tier 1 (node-kind sequence) + Tier 2 (ident/literal values).
  +21 tests landing with MK4 (markup-as-value corpus).
parser-conformance-stmt.test.js   — M3 (M3.1-M3.4: substrate, control-flow,
  functions/classes/import/export/try-throw, error-recovery + full statement
  conformance); exercises native-parser/parse-stmt.js + ast-stmt.js.
  Tier 1+2 vs Acorn-oracle.
parser-conformance-markup.test.js — MK1 (BlockContext) + MK2 (TagFrame engine +
  closer-form pairing) + MK3 (BodyMode + DisplayTextLiteral §4.18 native quoted-text)
  + MK4 (markup↔JS seam — deep-nesting smoke; cross-seam error attribution; peak
  delegation depth; §65/§66 canonical worked-example). +13 tests at MK4 close.
  Exercises native-parser/parse-markup.js + parse-ctx.js + tag-frame.js +
  body-mode.js + display-text-literal.js + parse-seam.js + delegation-frame.js.
parser-conformance-corpus.test.js — MK4 §65-§66 corpus smoke (Tier 1+2 strict diff
  vs live pipeline). Histogram: clean-3 → 535 of 1000 .scrml corpus files after
  MK4 C3+C4; explicit Tier 1+2 promotion to M5+ scope (requires downstream routing).
parser-conformance.test.js  — older parser-conformance harness driver (predates
  the five native-parser suites; uses the same harness modules).

### Harness  [compiler/tests/parser-conformance/]
corpus-enumerator.js — enumerates corpus files
parsers.js           — parser adapter (Acorn oracle + native-parser entry)
tier-diff.js         — Tier 1/2 diff comparator
bench/               — 12 JS corpus files (expr-arrow, expr-async-await,
                       expr-literals, expr-optional-chain, expr-spread-rest,
                       expr-template-literal, expr-yield-generator, stmt-control-flow,
                       stmt-import-export, stmt-try-catch, decl-class, decl-destructure) —
                       the JS-subset corpus
markup-bench/        — 8 `.scrml` corpus files: comments-html, comments-line,
                       css-block, foreign-code, logic-basic, logic-nested-braces,
                       markup-tags, multi-context — the markup-layer corpus

## Fixtures & Factories
compiler/tests/fixtures/ — promote-match-canonical.scrml; promote-multi-file-app/ (CLI promote fixtures)
compiler/tests/helpers/  — expr.ts (expression test helper); extract-user-fns.js (scans compiled
                            client.js for user-defined fns, filtering `_scrml_*` compiler internals)
compiler/tests/unit/__fixtures__/ — runtime-written scratchpads, gitignored, regenerated per run
compiler/tests/parser-conformance/bench/ + markup-bench/ — native-parser conformance corpora
e2e/fixtures/ — db-fixture.ts (per-test SQLite), dev-server-fixture.ts (boots a dev server)
samples/compilation-tests/ — sub-dirs compiled by the `pretest` hook and `bench`/`security` scripts

## Pattern
Unit tests are `describe`/`test`/`expect` from `bun:test`. The dominant pattern
compiles a snippet through a slice of the pipeline (commonly
`splitBlocks()` → `buildAST()`, or `compileScrml()`/`compileInline()` for
end-to-end) and asserts on the resulting AST shape, the emitted JS, or the
returned diagnostic stream. Each test file's docblock names the SPEC section
or phase step it covers. Tests routinely assert AST-shape contracts plus an
anti-test guard (`assertNoHtmlFragmentMatching`) to defeat deceptive-success
where a construct silently parses as plain markup. Diagnostic-stream tests
must check the correct bucket — W-*/I- codes land in `result.warnings`, not
`result.errors` (see error.map.md partition rule). Conformance tests are
named `conf-<CODE>.test.js`, one per SPEC §34 error code. The native-parser
conformance suites instead diff native-parser output against an Acorn oracle
(JS layer) or the live block-splitter (markup layer) and assert per-tier
parity; new tests land alongside their owning M-/MK-sub-step.

## Tags
#scrmlts #map #test #bun-test #playwright #conformance #native-parser #mk4

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [build.map.md](./build.map.md)
- [error.map.md](./error.map.md)
