# test.map.md
# project: scrml
# updated: 2026-07-09  commit: fbb4d9fd

## Test Framework
Runner: `bun:test` (Bun's built-in test runner, no separate package dep)
Config: bunfig.toml (`[test] root="compiler/tests/", timeout=10000`)
Run all: `bun test compiler/tests/`
Run single: `bun test compiler/tests/unit/<file>.test.js`
Coverage: `bun test compiler/tests/ --coverage`
Browser DOM: happy-dom / @happy-dom/global-registrator (compiler/tests/browser/)
E2E: Playwright (`@playwright/test`), separate config at e2e/playwright.config.ts, NOT part of `bun test`

## Test Categories (compiler/tests/, 1167 `*.test.js` total)
Unit: compiler/tests/unit/**/*.test.js — 803 files (largest category; one-file-per-bug/feature is the dominant naming convention, e.g. `g-<gap-id>.test.js`, `ss<N>-<slug>.test.js`, `stdlib-<mod>.test.js`)
Integration: compiler/tests/integration/**/*.test.js — 165 files (multi-stage pipeline behavior)
Conformance: compiler/tests/conformance/**/*.test.js — 113 files (locked-in compile-and-assert-shape corpus)
Browser: compiler/tests/browser/**/*.test.js — 63 files (happy-dom DOM assertions on emitted client bundles)
LSP: compiler/tests/lsp/**/*.test.js — 11 files (incl. semantic-tokens.test.js, 307L, the S247 LSP provider suite)
Commands: compiler/tests/commands/**/*.test.js — 8 files (CLI subcommand behavior)
Self-host: compiler/tests/self-host/**/*.test.js — 4 files
e2e-render-map: compiler/tests/e2e-render-map/ — 2 files + render-corpus-enumerator/detectors/harness support scripts
Parser-conformance: compiler/tests/parser-conformance*.test.js (top level, 0 counted by the `*.test.js` glob at this dir but present as named files) — native-parser vs live-pipeline parity, gated by parser-conformance-within-node-allowlist.json
Top-level D3 corpus: conformance/ (separate from compiler/tests/conformance/) — bridged via compiler/tests/conformance/corpus-bridge.test.js

## Fixtures & Factories
compiler/tests/fixtures/ — 8 shared fixture files
compiler/tests/helpers/ — 3 shared test-helper modules
compiler/tests/commands/migrate-program-shape-fixtures/ — migrate-command fixture set
samples/compilation-tests/ — 13 fixture dirs compiled by scripts/compile-test-samples.sh before the suite runs (gitignored dist/); count only per scope rules, not individually enumerated
conformance/cases/ + conformance/adapters/ — the D3 corpus cases + per-impl adapters (impl1-ts.ts etc.)

## Pattern
Bun's native `describe`/`test`/`expect` from `bun:test`. Files import directly from `compiler/src/*` or `compiler/runtime/stdlib/*.js` (not through the public CLI) to unit-test internals. Naming convention ties a test file to its originating bug/gap/session tag (`g-<slug>`, `ss<N>-<slug>`, `E-<CODE>-*`) so a diagnostic code or gap-id greps directly to its regression test. Assertions favor `toBe`/`toMatch`/`toThrow` with real runtime behavior over mocks — e.g. stdlib tests call the actual host shim against real Bun crypto/sqlite/fetch rather than stubbing. Numbered comment-tagged sub-tests (`C1`, `C2`...) inside one `describe` block are common for grouping related assertions on one function.

## Tags
#scrml #map #test #bun-test #happy-dom #playwright #conformance #stdlib-tests #lsp-tests

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [build.map.md](./build.map.md)
- [error.map.md](./error.map.md)
