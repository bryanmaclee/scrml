# test.map.md
# project: scrml
# updated: 2026-07-22T17:10:00Z  commit: a0344d75

## Test Framework
Runner: `bun:test` (Bun's built-in test runner, no separate package dep)
Config: bunfig.toml (`[test] root="compiler/tests/", timeout=10000`)
Run all: `bun test compiler/tests/`
Run single: `bun test compiler/tests/unit/<file>.test.js`
Coverage: `bun test compiler/tests/ --coverage`
Browser DOM: happy-dom / @happy-dom/global-registrator (compiler/tests/browser/)
E2E: Playwright (`@playwright/test`), separate config at e2e/playwright.config.ts, NOT part of `bun test`

## Test Categories (compiler/tests/, **1234** `*.test.js` total)
Counts are RECURSIVE `git ls-files` counts at this commit and agree with `docs/FACTS.md` (generated,
`--check`-gated in CI). Prior map generations used a single-level glob and under-counted by 14 —
the top-level `parser-conformance*.test.js` files were invisible to it.

Unit: compiler/tests/unit/**/*.test.js — **828** files. **+4 net this window**: `esm-runtime-module-format.test.js` (U1 — the ES-module runtime shape + derived export surface), `esm-client-chunk-format.test.js` (U2 — chunk export/import rewriting, incl. the namespace-import requirement), `esm-script-tag-module-format.test.js` (U3 — `type="module"` tag emission), `each-mount-fence-foster-safe.test.js` (#131 — the comment-fence mount survives `<table>`/`<select>` insertion modes), `colorless-async-discard-hof.test.js` (the E-ASYNC-STDLIB-IN-SYNC-CALLBACK discard-HOF narrowing); **−1 DELETED**: `each-table-foster-warn-s272.test.js`, removed with the `W-EACH-TABLE-FOSTER` lint it pinned (its warned condition can no longer occur under the fence model). Largest category; one-file-per-bug/feature is the dominant naming convention (`g-<gap-id>.test.js`, `ss<N>-<slug>.test.js`, `stdlib-<mod>.test.js`, `issue-<N>-<slug>.test.js`, `i<issue#>-<slug>.test.js`).
Integration: compiler/tests/integration/**/*.test.js — **176** files. No file added or removed this window; `ssr-a-terminus.test.js`, `ssr-b-substrate.test.js` and `serve-target-tool-r26.test.js` were MODIFIED (SSR fence-fill assertions; the serve-tool test was re-driven through `Server.fetch` instead of a real socket for determinism).
Conformance: compiler/tests/conformance/**/*.test.js — **122** files. Unchanged in count.
Browser: compiler/tests/browser/**/*.test.js — **69** files. **+1**: `esm-chunk-module-linkage.browser.test.js`. Ten existing `each-*`/`nested-each-*`/`ssr-a-terminus-hydration` browser tests were MODIFIED to the fence-shaped DOM (they previously asserted on the `<div data-scrml-each-mount>` wrapper).
LSP: compiler/tests/lsp/**/*.test.js — **11** files. Unchanged.
Commands: compiler/tests/commands/**/*.test.js — **8** files. Unchanged.
Self-host: compiler/tests/self-host/**/*.test.js — **4** files. Unchanged.
e2e-render-map: compiler/tests/e2e-render-map/ — **2** files + render-corpus-enumerator/detectors/harness support scripts. Unchanged.
Parser-conformance: **14** top-level `compiler/tests/parser-conformance*.test.js` files — native-parser vs live-pipeline parity, gated by parser-conformance-within-node-allowlist.json. Unchanged. `compiler/native-parser/` has had ZERO diff since `df2ac831`; these tests do NOT cover the each-fence model (an emit-time concern outside the parser's layer) and are NOT confirmed to cover GITI-038/039 or `E-SCRIPT-001` (a confirmed native-parser gap). See non-compliance.report.md.
Top-level D3 corpus: `conformance/` (separate from compiler/tests/conformance/) — **51 case dirs / 745 `expected.json` assertions**; bridged via compiler/tests/conformance/corpus-bridge.test.js. This window: 8 `cases/each/*/expected.json` files updated to the fence-shaped expected output (`as-alias`, `count-reactive`, `empty-fallback`, `empty-teardown`, `keyed-reconcile`, `nested`, `per-item-reactivity`, `render-static`) — a one-line change each, no new case dir.

## Public-content gates (NOT `bun test`, but CI-required — see build.map.md)
`bun scripts/snippet-gate.js` — compiles every `.scrml` in the public snippet corpus
(`docs/tutorial-snippets/`, `docs/readme-snippets/`; 12 files). A compile failure here means a
published document is making a false claim.
`bun scripts/facts.ts --check` — fails if any generated figure in `docs/FACTS.md` is stale.
Both run in CI `gate`; snippet-gate also runs in the release-tag `pre-push` hook.

## CI test-tier mapping (see build.map.md for the full workflow)
`gate` (blocking): unit + conformance + the TodoMVC gauntlet compile-and-parse check + snippet-gate + facts `--check`.
`tracking` (non-blocking): integration + lsp + commands + browser + the parser-conformance-within-node M6.x backlog.
`windows` (non-blocking): unit + conformance on windows-latest (surfaces OS-path-separator bugs the Linux gate can't see).
Local pre-commit: unit + integration + conformance (`--bail`, ~2min). Local pre-push: the full `bun test compiler/tests/` run + gauntlet + fixture refresh (+ snippet-gate on release-tag pushes).

## Fixtures & Factories
compiler/tests/fixtures/ — 8 shared fixture files
compiler/tests/helpers/ — 3 shared test-helper modules
compiler/tests/commands/migrate-program-shape-fixtures/ — migrate-command fixture set
samples/compilation-tests/ — 12 fixture dirs compiled by scripts/compile-test-samples.sh before the suite runs (gitignored dist/); count only per scope rules
conformance/cases/ + conformance/adapters/ — the D3 corpus cases + per-impl adapters (impl1-ts.ts)
docs/tutorial-snippets/ + docs/readme-snippets/ — the public snippet corpus; these are REAL programs under a compile gate, not fixtures, but they function as a public-surface regression corpus

## Pattern
Bun's native `describe`/`test`/`expect` from `bun:test`. Files import directly from `compiler/src/*`
or `compiler/runtime/stdlib/*.js` (not through the public CLI) to unit-test internals. Naming ties a
test file to its originating bug/gap/session tag (`g-<slug>`, `ss<N>-<slug>`, `E-<CODE>-*`,
`issue-<N>-<slug>`, `i<issue#>-<slug>`) so a diagnostic code or gap-id greps directly to its
regression test. Assertions favor `toBe`/`toMatch`/`toThrow` over mocks. Numbered comment-tagged
sub-tests (`C1`, `C2`…) inside one `describe` are common. A dated pattern
(`<bug-slug>-YYYY-MM-DD.test.js`) is used for HIGH-severity security-fix regressions with the
root-cause narrative in a header docstring.

**Format-gated assertions (NEW).** The three `esm-*.test.js` files establish the convention for the
two client module formats: assert the CLASSIC output is byte-unchanged AND assert the esm shape
separately, by compiling the same source twice with `moduleFormat: "classic"` and `"esm"`. A test
that asserts on emitted client JS without pinning `moduleFormat` is asserting on the default only.

**DOM-shape assertions (CHANGED).** Any test asserting a top-level `<each>` renders must look for
the comment fence `<!--scrml-each:N-->` / `<!--/scrml-each:N-->` and rows as SIBLINGS between the
anchors — `querySelector('[data-scrml-each-mount]')` no longer finds a top-level mount (it survives
only on the nested-each runtime `<div>`). `each-mount-fence-foster-safe.test.js` is the pin.

## Tags
#scrml #map #test #bun-test #happy-dom #playwright #conformance #stdlib-tests #lsp-tests #ci-gate #esm-chunks #module-format #each-fence #foster-safe #snippet-gate #facts-gate #colorless-async #content-hash

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [build.map.md](./build.map.md)
- [error.map.md](./error.map.md)
- [structure.map.md](./structure.map.md)
