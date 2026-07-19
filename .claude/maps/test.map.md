# test.map.md
# project: scrml
# updated: 2026-07-18T08:36:53-06:00  commit: 99ae45ca

## Test Framework
Runner: `bun:test` (Bun's built-in test runner, no separate package dep)
Config: bunfig.toml (`[test] root="compiler/tests/", timeout=10000`)
Run all: `bun test compiler/tests/`
Run single: `bun test compiler/tests/unit/<file>.test.js`
Coverage: `bun test compiler/tests/ --coverage`
Browser DOM: happy-dom / @happy-dom/global-registrator (compiler/tests/browser/)
E2E: Playwright (`@playwright/test`), separate config at e2e/playwright.config.ts, NOT part of `bun test`

## Test Categories (compiler/tests/, 1200 `*.test.js` total — up from 1194 at the 0a79d838/S264 watermark; +6 this window, all new files, see below)
Unit: compiler/tests/unit/**/*.test.js — 807 files (+2 this window: `css-wave1-emission.test.js`, `link-boost.test.js`). Largest category; one-file-per-bug/feature is the dominant naming convention, e.g. `g-<gap-id>.test.js`, `ss<N>-<slug>.test.js`, `stdlib-<mod>.test.js`, `issue-<N>-<slug>.test.js`.
Integration: compiler/tests/integration/**/*.test.js — 170 files (+1 this window: `i82-content-hash-cache-headers.test.js` — multi-stage assertion over `compileScrml({contentHashAssets:true})` output + the generated `_server.js`/`devCacheHeaders` cache-header behavior).
Conformance: compiler/tests/conformance/**/*.test.js — 117 files (unchanged this window; the new CSS-Wave-1 conformance coverage landed in the SEPARATE top-level `conformance/` D3 corpus, not here — see below).
Browser: compiler/tests/browser/**/*.test.js — 67 files (+3 this window: `browser-component-css-var.test.js` [regression cover for the `document.documentElement` CSS-var-bridge fix, PR #98], `browser-link-boost.test.js`, `browser-theme-switch.test.js`).
LSP: compiler/tests/lsp/**/*.test.js — 11 files (incl. semantic-tokens.test.js, the S247 LSP provider suite).
Commands: compiler/tests/commands/**/*.test.js — 8 files (CLI subcommand behavior).
Self-host: compiler/tests/self-host/**/*.test.js — 4 files.
e2e-render-map: compiler/tests/e2e-render-map/ — 2 files + render-corpus-enumerator/detectors/harness support scripts.
Parser-conformance: 14 compiler/tests/parser-conformance*.test.js files (top level) — native-parser vs live-pipeline parity, gated by parser-conformance-within-node-allowlist.json.
Top-level D3 corpus: conformance/ (separate from compiler/tests/conformance/) — 49 case dirs (up from 41 at the S264 watermark; +8 this window, all under a NEW `style/` cluster: descendant-combinator-{contraction-text,preserved}, flat-inline-token-{lowering-clean,unknown}, program-import-hoist-clean, reactive-cell-lowering-clean, reset-opt-out-clean, theme-emission-clean, theme-variant-rebind-unknown); bridged via compiler/tests/conformance/corpus-bridge.test.js.

## CI test-tier mapping (see build.map.md for the full workflow)
`gate` (blocking): unit + conformance + a TodoMVC gauntlet compile-and-parse check.
`tracking` (non-blocking): integration + lsp + commands + browser + the parser-conformance-within-node M6.x backlog.
`windows` (non-blocking): unit + conformance on windows-latest (surfaces OS-path-separator bugs the Linux gate can't see).
Local pre-commit: unit + integration + conformance (`--bail`, ~2min). Local pre-push: the full `bun test compiler/tests/` run + gauntlet + fixture refresh.
No CI workflow file changed this window — the new tests land in the existing tier structure (unit/integration/browser -> gate/tracking as usual).

## Fixtures & Factories
compiler/tests/fixtures/ — 8 shared fixture files
compiler/tests/helpers/ — 3 shared test-helper modules
compiler/tests/commands/migrate-program-shape-fixtures/ — migrate-command fixture set
samples/compilation-tests/ — 12 fixture dirs (~1244 files) compiled by scripts/compile-test-samples.sh before the suite runs (gitignored dist/); count only per scope rules, not individually enumerated
conformance/cases/ + conformance/adapters/ — the D3 corpus cases + per-impl adapters (impl1-ts.ts); +8 new `style/` cases this window (CSS Wave-1 emission coverage)

## Pattern
Bun's native `describe`/`test`/`expect` from `bun:test`. Files import directly from `compiler/src/*` or `compiler/runtime/stdlib/*.js` (not through the public CLI) to unit-test internals. Naming convention ties a test file to its originating bug/gap/session tag (`g-<slug>`, `ss<N>-<slug>`, `E-<CODE>-*`, `issue-<N>-<slug>`) so a diagnostic code or gap-id greps directly to its regression test. Assertions favor `toBe`/`toMatch`/`toThrow` with real runtime behavior over mocks. Numbered comment-tagged sub-tests (`C1`, `C2`...) inside one `describe` block are common for grouping related assertions on one function. A dated regression-test naming pattern (`<bug-slug>-YYYY-MM-DD.test.js`) is used for HIGH-severity security-fix regressions, with the root-cause narrative in a header docstring. New this window: an `i<issue#>-<slug>.test.js` integration-test naming convention (`i82-content-hash-cache-headers.test.js`) ties a test directly to its adopter-issue number.

## Tags
#scrml #map #test #bun-test #happy-dom #playwright #conformance #stdlib-tests #lsp-tests #ci-gate #real-db-adapter #css-wave1 #link-boost #content-hash

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [build.map.md](./build.map.md)
- [error.map.md](./error.map.md)
