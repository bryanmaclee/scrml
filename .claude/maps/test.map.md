# test.map.md
# project: scrmlts
# updated: 2026-05-20T13:42:44-06:00  commit: 78faa65

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

## Test Categories  [compiler/tests/ — 728 total .test.js/.test.ts files]
unit         — compiler/tests/unit/**            — 514 files — per-pass / per-construct unit tests (largest bucket)
integration  — compiler/tests/integration/**     —  75 files — multi-stage pipeline + canonical-corpus smoke tests
conformance  — compiler/tests/conformance/**     — 105 files — one test per SPEC §34 error code + block-grammar subdir
browser      — compiler/tests/browser/**         —  12 files — runtime behavior under happy-dom
lsp          — compiler/tests/lsp/**             —  10 files — language-server feature tests
commands     — compiler/tests/commands/**        —   6 files — CLI subcommand tests (init/migrate/promote/...)
self-host    — compiler/tests/self-host/**       —   4 files — self-hosting compiler-module tests
parser-conformance — compiler/tests/parser-conformance/ — harness (corpus-enumerator, parsers, tier-diff, bench)
                     driven by 2 root test files: parser-conformance.test.js, parser-conformance-lexer.test.js
e2e          — e2e/tests/**.spec.ts              —   6 files — Playwright (02-counter, 03-contact-book,
                                                   05-multi-step-form, 14-mario, todomvc, docs-website)

## Fixtures & Factories
compiler/tests/fixtures/ — promote-match-canonical.scrml; promote-multi-file-app/ (CLI promote fixtures)
compiler/tests/helpers/  — expr.ts (expression test helper); extract-user-fns.js (scans compiled
                            client.js for user-defined fns, filtering `_scrml_*` compiler internals)
compiler/tests/unit/__fixtures__/ — runtime-written scratchpads, gitignored, regenerated per run
e2e/fixtures/ — db-fixture.ts (per-test SQLite), dev-server-fixture.ts (boots a dev server)
samples/compilation-tests/ — 14 sub-dirs compiled by the `pretest` hook and `bench`/`security` scripts

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
named `conf-<CODE>.test.js`, one per SPEC §34 error code.

## Tags
#scrmlts #map #test #bun-test #playwright #conformance

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [build.map.md](./build.map.md)
- [error.map.md](./error.map.md)
