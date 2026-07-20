# test.map.md
# project: scrml
# updated: 2026-07-19T21:52:34-06:00  commit: df2ac831

## Test Framework
Runner: `bun:test` (Bun's built-in test runner, no separate package dep)
Config: bunfig.toml (`[test] root="compiler/tests/", timeout=10000`)
Run all: `bun test compiler/tests/`
Run single: `bun test compiler/tests/unit/<file>.test.js`
Coverage: `bun test compiler/tests/ --coverage`
Browser DOM: happy-dom / @happy-dom/global-registrator (compiler/tests/browser/)
E2E: Playwright (`@playwright/test`), separate config at e2e/playwright.config.ts, NOT part of `bun test`

## Test Categories (compiler/tests/, 1221 `*.test.js` total, directly counted via `git ls-files` at this watermark)
Unit: compiler/tests/unit/**/*.test.js — 821 files. +8 net-new this window: `colorless-async-combinators.test.js`, `colorless-async-seam-a.test.js`, `giti-039-markup-text-verbatim.test.js`, `i87-nested-server-call-autoawait.test.js`, `session-context-gate-b2b3.test.js`, `session-establishment.test.js`, `session-secure-b4b5.test.js`, `value-attr-binding-i81.test.js` (813 confirmed-at-99ae45ca + 8 = 821, reconciling the prior map's stale 807 baseline). Largest category; one-file-per-bug/feature is the dominant naming convention, e.g. `g-<gap-id>.test.js`, `ss<N>-<slug>.test.js`, `stdlib-<mod>.test.js`, `issue-<N>-<slug>.test.js`. GITI-038 itself has NO dedicated new unit file — its coverage extends `colorless-async-seam-a.test.js` + `integration/nested-fn-sql-escalation-regression.test.js` (both MODIFIED, not added).
Integration: compiler/tests/integration/**/*.test.js — 173 files. +2 this window: `session-establishment-roundtrip.test.js`, `session-secure-b4b5-roundtrip.test.js`. 6 pre-existing files MODIFIED this window (auth-csrf-synchronizer-token, csrf-canonical-delivery, g-markup-session-read-undeclared, nested-fn-sql-escalation-regression, server-fn-calls-server-fn, server-load-authority) to track the §20.5/colorless-async landings.
Conformance: compiler/tests/conformance/**/*.test.js — 120 files. +2 this window: `conf-ATTR-WRITER-CONFLICT.test.js` (#81), `conf-CTRL-i87-nested-server-autoawait.test.js` (#87).
Browser: compiler/tests/browser/**/*.test.js — 68 files. +1 this window: `browser-i81-component-root-crash.test.js` (regression cover for a writer-conflict-analyzer crash the S239 pass caught, finding 1/4).
LSP: compiler/tests/lsp/**/*.test.js — 11 files (incl. semantic-tokens.test.js, the S247 LSP provider suite). Unchanged.
Commands: compiler/tests/commands/**/*.test.js — 8 files (CLI subcommand behavior). Unchanged.
Self-host: compiler/tests/self-host/**/*.test.js — 4 files. Unchanged.
e2e-render-map: compiler/tests/e2e-render-map/ — 2 files + render-corpus-enumerator/detectors/harness support scripts. Unchanged.
Parser-conformance: 14 compiler/tests/parser-conformance*.test.js files (top level) — native-parser vs live-pipeline parity, gated by parser-conformance-within-node-allowlist.json. Unchanged this window — **NOT confirmed to cover the GITI-038/039 fixes** (both landed in the LIVE `ast-builder.js` pipeline only); flagged in non-compliance.report.md as a parity-drift check item, not a confirmed gap.
Top-level D3 corpus: conformance/ (separate from compiler/tests/conformance/) — 51 case dirs, UNCHANGED this window (only 2 existing case files modified: `auth/auth-async-stdlib-sync-callback-neg/{case.scrml,expected.json}`, tracking the colorless-async classifier change); bridged via compiler/tests/conformance/corpus-bridge.test.js.

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
conformance/cases/ + conformance/adapters/ — the D3 corpus cases + per-impl adapters (impl1-ts.ts); unchanged this window (2 existing cases modified, no new dirs)

## Pattern
Bun's native `describe`/`test`/`expect` from `bun:test`. Files import directly from `compiler/src/*` or `compiler/runtime/stdlib/*.js` (not through the public CLI) to unit-test internals. Naming convention ties a test file to its originating bug/gap/session tag (`g-<slug>`, `ss<N>-<slug>`, `E-<CODE>-*`, `issue-<N>-<slug>`) so a diagnostic code or gap-id greps directly to its regression test. Assertions favor `toBe`/`toMatch`/`toThrow` with real runtime behavior over mocks. Numbered comment-tagged sub-tests (`C1`, `C2`...) inside one `describe` block are common for grouping related assertions on one function. A dated regression-test naming pattern (`<bug-slug>-YYYY-MM-DD.test.js`) is used for HIGH-severity security-fix regressions, with the root-cause narrative in a header docstring. The `i<issue#>-<slug>.test.js` integration-test naming convention (`i82-content-hash-cache-headers.test.js`) ties a test directly to its adopter-issue number — this window adds no new `i<N>` integration files but reuses the pattern in unit/ (`value-attr-binding-i81.test.js`, `i87-nested-server-call-autoawait.test.js`). Security-fix regressions this window (session establishment, both passes) followed the EMPIRICAL-verification pattern per hand-off.md: real-HTTP-drive assertions, not just AST-shape checks.

## Tags
#scrml #map #test #bun-test #happy-dom #playwright #conformance #stdlib-tests #lsp-tests #ci-gate #real-db-adapter #css-wave1 #link-boost #content-hash #giti-038 #giti-039 #colorless-async #writer-ownership #session-establishment

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [build.map.md](./build.map.md)
- [error.map.md](./error.map.md)
- [structure.map.md](./structure.map.md)
