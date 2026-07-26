# test.map.md
# project: scrml
# updated: 2026-07-26T07:00:00Z  commit: f8a138e9

## Test Framework
Runner: `bun:test` (Bun's built-in test runner, no separate package dep)
Config: bunfig.toml (`[test] root="compiler/tests/", timeout=10000`)
Run all: `bun test compiler/tests/`
Run single: `bun test compiler/tests/unit/<file>.test.js`
Coverage: `bun test compiler/tests/ --coverage`
Browser DOM: happy-dom / @happy-dom/global-registrator (compiler/tests/browser/)
E2E: Playwright (`@playwright/test`), separate config at e2e/playwright.config.ts, NOT part of `bun test`

## Test Categories (compiler/tests/, **1255** `*.test.js` total — fresh `git ls-files` recount this pass, all 9 categories individually re-verified)

Counts are RECURSIVE `git ls-files` counts at this commit and agree with `docs/FACTS.md`-derivable
totals. **Net +21 across this window (`a0344d75` -> `f8a138e9` — this map's own prior stamp; the
intervening `1c5c2aee` chunk-namespacing pass explicitly did NOT re-verify this map, per its own
header note).** Of the +21: **+9 attributable to the S287 §14.8.11 DB-authoritative tier** (listed
below, individually); the remaining +12 is the chunk-namespacing/Peter's-#171-#175 window (already
folded into these totals; see structure.map.md's prior-window narrative for that breakdown — not
re-itemized here to avoid duplicating a map).

Unit: compiler/tests/unit/**/*.test.js — **840** files. **+4 this pass (DB-authoritative tier,
S287):** `db-authoritative-wrap.test.js` (`wrapPrincipalTxn`'s scope-aware rewrite — the `_scrml_req`
brace-scope tracking, module-level infra helpers correctly NOT wrapped), `db-migrate.test.js`
(`parseArgs`/`classifyStatement` + the CLI's pre-flight/plan/apply-shape unit surface),
`schema-differ-p2-ddl.test.js` (`generateSecdefDDL`/`generateScrmlHasCapDDL`/the S3 column-scoped
GRANT reshape), `schema-differ-p2-parse.test.js` (the brace-depth-aware `parseSchemaBlock`/`fn`
declaration parse). PLUS 2 MODIFIED (no count delta): `schema-differ.test.js`,
`schema-introspect-pg.test.js`.
Integration: compiler/tests/integration/**/*.test.js — **180** files. **+3 this pass:**
`db-authoritative-pg.test.js` (M1 the reads-authoritative RLS negative test, live-PG skip-graceful),
`db-authoritative-p2-pg.test.js` (P2 the doubled negative test — immutable-column DENY, SECDEF cap
gate both ways, hardening assertions), `db-migrate-pg.test.js` (M2 the migration-apply seam proven
THROUGH the CLI — turnkey-from-source).
Conformance: compiler/tests/conformance/**/*.test.js — **124** files. **+2 this pass:**
`conf-DBAUTH-M1.test.js`, `conf-DBAUTH-P2.test.js`.
Browser: compiler/tests/browser/**/*.test.js — **72** files. Unchanged this pass (no browser-DOM
surface in the DB-authoritative tier — it is server/deploy-side only).
LSP: compiler/tests/lsp/**/*.test.js — **11** files. Unchanged.
Commands: compiler/tests/commands/**/*.test.js — **8** files. Unchanged in count (the new
`db-migrate` CLI unit-tests live in `compiler/tests/unit/`, not this directory — see above).
Self-host: compiler/tests/self-host/**/*.test.js — **4** files. Unchanged.
e2e-render-map: compiler/tests/e2e-render-map/ — **2** files + render-corpus-enumerator/detectors/harness support scripts. Unchanged.
Parser-conformance + native-*: **14** top-level `compiler/tests/{parser-conformance*,native-*}.test.js` files (11 `parser-conformance*` + 3 `native-*`) — native-parser vs live-pipeline parity, gated by parser-conformance-within-node-allowlist.json. Unchanged; `compiler/native-parser/` has ZERO diff since `df2ac831` and carries no obligation for the DB-authoritative tier (emit-time + a standalone CLI, outside this layer).
Top-level D3 corpus: `conformance/` (separate from compiler/tests/conformance/) — bridged via compiler/tests/conformance/corpus-bridge.test.js. Not re-verified this pass (no DB-authoritative case dir added there — the tier's conformance coverage lives in `compiler/tests/conformance/conf-DBAUTH-{M1,P2}.test.js` instead).

## §14.8.11 DB-authoritative tier — live-Postgres skip-graceful pattern (NEW S287)

The three new integration tests (`db-authoritative-pg`, `db-authoritative-p2-pg`, `db-migrate-pg`)
and the M1/P2 conformance pair run the ACTUAL negative test against a real Postgres — the ONLY proof
that separates real DB enforcement from an egress-JS-shaped gap (SPEC §14.8.11: "a half-shipped RLS
'looks enforced and isn't' — worse than none"). They follow the SAME skip-graceful convention the
pre-existing `schema-introspect-pg.test.js` established: skip (not fail) when no live Postgres is
reachable, so the `gate` CI tier (which has none) stays green while `tracking`/local-with-PG
exercises the real assertions. Do not convert these to a mocked/in-memory Postgres — the acceptance
gate SPEC requires a REAL PG16 (RLS/GRANT/SECURITY DEFINER behavior is not faithfully mockable).

## Public-content gates (NOT `bun test`, but CI-required — see build.map.md)
`bun scripts/snippet-gate.js` — compiles every `.scrml` in the public snippet corpus
(`docs/tutorial-snippets/`, `docs/readme-snippets/`; 12 files). A compile failure here means a
published document is making a false claim.
`bun scripts/facts.ts --check` — fails if any generated figure in `docs/FACTS.md` is stale.
Both run in CI `gate`; snippet-gate also runs in the release-tag `pre-push` hook.

## CI test-tier mapping (see build.map.md for the full workflow)
`gate` (blocking): unit + conformance + the TodoMVC gauntlet compile-and-parse check + snippet-gate + facts `--check`.
`tracking` (non-blocking): integration + lsp + commands + browser + the parser-conformance-within-node M6.x backlog. **The three new live-PG DB-authoritative integration tests run here, skip-graceful.**
`windows` (non-blocking): unit + conformance on windows-latest (surfaces OS-path-separator bugs the Linux gate can't see).
Local pre-commit: unit + integration + conformance (`--bail`, ~2min). Local pre-push: the full `bun test compiler/tests/` run + gauntlet + fixture refresh (+ snippet-gate on release-tag pushes).

## Fixtures & Factories
compiler/tests/fixtures/ — 8 shared fixture files
compiler/tests/helpers/ — 3 shared test-helper modules
compiler/tests/commands/migrate-program-shape-fixtures/ — migrate-command (source-codemod `scrml migrate`, NOT `db-migrate`) fixture set
samples/compilation-tests/ — 12 fixture dirs compiled by scripts/compile-test-samples.sh before the suite runs (gitignored dist/); count only per scope rules
conformance/cases/ + conformance/adapters/ — the D3 corpus cases + per-impl adapters (impl1-ts.ts)
docs/tutorial-snippets/ + docs/readme-snippets/ — the public snippet corpus; these are REAL programs under a compile gate, not fixtures, but they function as a public-surface regression corpus

## Pattern
Bun's native `describe`/`test`/`expect` from `bun:test`. Files import directly from `compiler/src/*`
or `compiler/runtime/stdlib/*.js` (not through the public CLI) to unit-test internals — EXCEPT the
new `db-migrate-pg.test.js`/`db-authoritative-p2-pg.test.js`, which deliberately drive
`runDbMigrate`/the CLI surface directly (the acceptance gate is "proven THROUGH the CLI", not just
the underlying `diffSchema`/`schema-differ.js` functions in a harness). Naming ties a test file to
its originating bug/gap/session tag (`g-<slug>`, `ss<N>-<slug>`, `E-<CODE>-*`, `issue-<N>-<slug>`,
`i<issue#>-<slug>`, `conf-<CODE>-<milestone>` for the new DB-authoritative conformance pair) so a
diagnostic code or gap-id greps directly to its regression test. Assertions favor
`toBe`/`toMatch`/`toThrow` over mocks. Numbered comment-tagged sub-tests (`C1`, `C2`…) inside one
`describe` are common. A dated pattern (`<bug-slug>-YYYY-MM-DD.test.js`) is used for HIGH-severity
security-fix regressions with the root-cause narrative in a header docstring.

**Format-gated assertions.** The `esm-*.test.js` files establish the convention for the two client
module formats: assert the CLASSIC output is byte-unchanged AND assert the esm shape separately.

**DOM-shape assertions.** Any test asserting a top-level `<each>` renders must look for the comment
fence `<!--scrml-each:N-->` / `<!--/scrml-each:N-->` and rows as SIBLINGS between the anchors.

**Live-PG skip-graceful (NEW pattern name, S287 — see the dedicated section above).** A test needing
a REAL Postgres connection (RLS/GRANT/SECURITY DEFINER cannot be faithfully mocked) skips rather than
fails when unreachable; `schema-introspect-pg.test.js` originated the pattern, the three new
DB-authoritative integration tests follow it.

## Tags
#scrml #map #test #bun-test #happy-dom #playwright #conformance #stdlib-tests #lsp-tests #ci-gate #esm-chunks #module-format #each-fence #foster-safe #snippet-gate #facts-gate #colorless-async #content-hash #dbauth #db-migrate #live-pg-skip-graceful #acceptance-gate

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [build.map.md](./build.map.md)
- [error.map.md](./error.map.md)
- [structure.map.md](./structure.map.md)
- [migrations.map.md](./migrations.map.md)
