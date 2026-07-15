# test.map.md
# project: scrml
# updated: 2026-07-14T18:58:34-06:00  commit: f079d0a9

## Test Framework
Runner: `bun:test` (Bun's built-in test runner, no separate package dep)
Config: bunfig.toml (`[test] root="compiler/tests/", timeout=10000`)
Run all: `bun test compiler/tests/`
Run single: `bun test compiler/tests/unit/<file>.test.js`
Coverage: `bun test compiler/tests/ --coverage`
Browser DOM: happy-dom / @happy-dom/global-registrator (compiler/tests/browser/)
E2E: Playwright (`@playwright/test`), separate config at e2e/playwright.config.ts, NOT part of `bun test`

## Test Categories (compiler/tests/, 1194 `*.test.js` total — up from 1167 at fbb4d9fd)
Unit: compiler/tests/unit/**/*.test.js — 805 files (largest category; one-file-per-bug/feature is the dominant naming convention, e.g. `g-<gap-id>.test.js`, `ss<N>-<slug>.test.js`, `stdlib-<mod>.test.js`, `issue-<N>-<slug>.test.js`)
Integration: compiler/tests/integration/**/*.test.js — 169 files (multi-stage pipeline behavior; new: serve-target-tool-r26.test.js, navigate-w-outlet-absent.test.js, url-comment-*.test.js)
Conformance: compiler/tests/conformance/**/*.test.js — 117 files (locked-in compile-and-assert-shape corpus; new: conf-AUTH-001, conf-FORM-bind-checked-non-checkbox, conf-FORM-select-coerce, conf-url-comment)
Browser: compiler/tests/browser/**/*.test.js — 64 files (happy-dom DOM assertions on emitted client bundles; new: browser-navigate-soft-nav.test.js)
LSP: compiler/tests/lsp/**/*.test.js — 11 files (incl. semantic-tokens.test.js, the S247 LSP provider suite)
Commands: compiler/tests/commands/**/*.test.js — 8 files (CLI subcommand behavior)
Self-host: compiler/tests/self-host/**/*.test.js — 4 files
e2e-render-map: compiler/tests/e2e-render-map/ — 2 files + render-corpus-enumerator/detectors/harness support scripts
Parser-conformance: 14 compiler/tests/parser-conformance*.test.js files (top level) — native-parser vs live-pipeline parity, gated by parser-conformance-within-node-allowlist.json
Top-level D3 corpus: conformance/ (separate from compiler/tests/conformance/) — 41 case dirs (incl. new api/ cluster: api-clean-pos, api-base-missing-neg, api-endpoint-*, api-method-invalid-neg, etc.); bridged via compiler/tests/conformance/corpus-bridge.test.js

## CI test-tier mapping (see build.map.md for the full workflow)
`gate` (blocking): unit + conformance + a TodoMVC gauntlet compile-and-parse check.
`tracking` (non-blocking): integration + lsp + commands + browser + the parser-conformance-within-node M6.x backlog.
`windows` (non-blocking): unit + conformance on windows-latest (surfaces OS-path-separator bugs the Linux gate can't see).
Local pre-commit: unit + integration + conformance (`--bail`, ~2min). Local pre-push: the full `bun test compiler/tests/` run + gauntlet + fixture refresh.

## Fixtures & Factories
compiler/tests/fixtures/ — 8 shared fixture files
compiler/tests/helpers/ — 3 shared test-helper modules
compiler/tests/commands/migrate-program-shape-fixtures/ — migrate-command fixture set
samples/compilation-tests/ — 12 fixture dirs (~1244 files) compiled by scripts/compile-test-samples.sh before the suite runs (gitignored dist/); count only per scope rules, not individually enumerated
conformance/cases/ + conformance/adapters/ — the D3 corpus cases + per-impl adapters (impl1-ts.ts); new real-DB adapter work (Bun.SQL in-memory seam, `sqlEngine` opt-in) landed this window per docs/changes/real-db-conformance-adapter-*

## Pattern
Bun's native `describe`/`test`/`expect` from `bun:test`. Files import directly from `compiler/src/*` or `compiler/runtime/stdlib/*.js` (not through the public CLI) to unit-test internals. Naming convention ties a test file to its originating bug/gap/session tag (`g-<slug>`, `ss<N>-<slug>`, `E-<CODE>-*`, `issue-<N>-<slug>`) so a diagnostic code or gap-id greps directly to its regression test. Assertions favor `toBe`/`toMatch`/`toThrow` with real runtime behavior over mocks — e.g. stdlib tests call the actual host shim against real Bun crypto/sqlite/fetch rather than stubbing (an opt-in `REDIS_TEST_URL`-gated tier exists for live Redis integration, skipped by default). Numbered comment-tagged sub-tests (`C1`, `C2`...) inside one `describe` block are common for grouping related assertions on one function. A dated regression-test naming pattern (`<bug-slug>-YYYY-MM-DD.test.js`, e.g. `jwt-auth-bypass-2026-07-11.test.js`) is used for HIGH-severity security-fix regressions, with the root-cause narrative in a header docstring.

## Tags
#scrml #map #test #bun-test #happy-dom #playwright #conformance #stdlib-tests #lsp-tests #ci-gate #real-db-adapter

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [build.map.md](./build.map.md)
- [error.map.md](./error.map.md)
