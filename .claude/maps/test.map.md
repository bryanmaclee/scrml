# test.map.md
# project: scrml
# updated: 2026-07-28T17:22:00Z  commit: 115e8b1b

## Test Framework
Runner: `bun:test` (Bun's built-in test runner, no separate package dep)
Config: bunfig.toml (`[test] root="compiler/tests/", timeout=10000`)
Run all: `bun test compiler/tests/`
Run single: `bun test compiler/tests/unit/<file>.test.js`
Coverage: `bun test compiler/tests/ --coverage`
Browser DOM: happy-dom / @happy-dom/global-registrator (compiler/tests/browser/)
E2E: Playwright (`@playwright/test`), separate config at e2e/playwright.config.ts, NOT part of `bun test`

## Test Categories (compiler/tests/, **1278** `*.test.js` total)

Fresh recursive `git ls-files` recount this pass, all 9 categories individually re-verified; agrees
with `docs/FACTS.md` (`test files | 1,278`). **Net +20 across this window (`c700c435` ->
`115e8b1b`), all additions, zero deletions.** The prior map generation carried **1255** at its own
stamp and its own header flagged that figure as already stale by +3 — both are now superseded.

| Category | Glob | Count | Delta this window |
|---|---|---|---|
| Unit | `compiler/tests/unit/**/*.test.js` | **849** | **+9** |
| Integration | `compiler/tests/integration/**/*.test.js` | **184** | **+3** |
| Conformance | `compiler/tests/conformance/**/*.test.js` | **125** | **+1** |
| Browser | `compiler/tests/browser/**/*.test.js` | **81** | **+7** |
| LSP | `compiler/tests/lsp/**/*.test.js` | 11 | — |
| Commands | `compiler/tests/commands/**/*.test.js` | 8 | — |
| Self-host | `compiler/tests/self-host/**/*.test.js` | 4 | — |
| e2e-render-map | `compiler/tests/e2e-render-map/` | 2 | — |
| Parser-conformance + native-* | top-level `compiler/tests/{parser-conformance*,native-*}.test.js` | 14 | — |

**Browser is where this window's weight landed (+7 of 20)** — the arc was dominated by
client-runtime and reconcile defects that a compile-time assertion cannot catch. That is the
`execute-don't-grep` discipline showing up in the corpus shape, not an accident.

## The 20 new files, by landing

**Runtime chunks / client boot (GH #234, GH #235, navigate-wave1c)**
- `browser/errors-element-messages-chunk-gh234.browser.test.js` — an `<errors of=…/>` page with NO
  inline validator override must still ship the `messages` chunk. The regression lock for the
  `POST_EMIT_HELPER_CHUNK_GATES` bare-name entry.
- `integration/mpa-shell-child-dep-scripts-gh235.test.js` — a composed CHILD page carries the
  SHELL's transitive module `<script>`s, deps-before-bundle, de-duplicated, and exactly ONE runtime tag.
- `browser/browser-navigate-cross-chunk.test.js` + `conformance/conf-NAV-CROSS-CHUNK.test.js` +
  `unit/navigate-cross-chunk-loader.test.js` — the cross-chunk soft-nav loader: absolute-url keying
  (the `pages/reports` vs `pages/admin/reports` basename collision), deps-first ordering, the
  timeout/error hard-nav fallback, and the `_scrml_chunk_loading` DEPTH-COUNTER behaviour under two
  overlapping navigations.

**Coordinate space + server closure (D-4, D-5)**
- `unit/d4-dist-relative-server-specifier.test.js` — `distRelativeServerSpecifier` at every nesting
  depth, plus the two verbatim fallbacks (no `outputBaseDir`, endpoint outside the base).
- `integration/d4-server-import-dist-space.test.js` — the end-to-end shape: a `pages/` importer's
  emitted specifier resolves inside `dist/`, and `W-SERVER-IMPORT-UNEMITTED` now SEES a dangling
  target it was previously blind to.
- `integration/d5-server-closes-over-module-const.test.js` — a module `const` referenced from a
  server fn appears in `.server.js`; a client-only const does NOT (byte-identical emit); an
  unresolvable initializer is SKIPPED, not guessed.

**§13.2 `on mount` async scope (GH #237)**
- `unit/gh237-emitted-statement-await.test.js` — `scanEmittedCode`/`splitEmittedStatements` against
  the adversarial inputs: `for(;;)` headers, object literals in expression position, `} else {`
  continuations, template literals with re-entrant `${}`, and comments containing braces.
- `browser/gh237-onmount-server-fn-await.browser.test.js` — the fail-OPEN proof: an
  `if (u is not) { redirect("/login") }` guard inside `on mount` must actually take its deny branch.

**Per-item reconcile family (S293/S294) — all browser, all REPLACE-path**
- `browser/g-item-derived-local-stale-in-per-item-effect-paths.browser.test.js`
- `browser/g-lift-per-item-attribute-binding-not-reactive-on-reconcile.browser.test.js`
- `browser/g-lift-per-item-if-directive-not-reactive-on-reconcile.browser.test.js`
- `browser/g-nested-each-inner-binding-reads-outer-var-reconcile.browser.test.js`

**Form-control `value=` in arm bodies (i225)**
- `unit/variant-arm-value-property-i225.test.js` + `browser/variant-arm-value-property-i225.browser.test.js`
  — the arm-wire path writes the `.value` PROPERTY, inequality-guarded (caret safety), and falls
  through to `setAttribute` when a sibling `bind:value` owns the property.

**DB-authoritative + diagnostics quality (S292)**
- `unit/sql-table-refs.test.js` — the scanner's two-valued contract, including that each
  `UNRESOLVABLE` shape lands in `undetermined` rather than yielding a false-empty `tables`.
- `unit/dbauth-grant-queried-tables.test.js` — the `GRANT <exercised privs> ON <t> TO scrml_app`
  branch: gated on ≥1 db-authoritative table, least-privilege (SELECT fallback), never CRUD-blanket.
- `unit/e-pa-002-db-migrate-remedy.test.js` — `E-PA-002`'s message leads with the `<schema>` +
  `scrml db-migrate` remedy.
- `unit/tailwind-outline-family.test.js` — the `outline-*` registrations resolve and no longer
  false-fire `W-TAILWIND-UNRECOGNIZED-CLASS`; v3 semantics for `outline-none` and bare `outline`;
  `outline-hidden` deliberately absent.

Modified without a count delta this window: `unit/state-block-event-wiring.test.js` (the boot
dispatch changed from a bare `DOMContentLoaded` listener to the `_scrml_boot` IIFE, so the assertion
had to follow) and the schema-differ/db-migrate unit suites.

## Coverage shapes worth knowing before writing a test here

**A runtime-only diagnostic cannot be asserted from `result.errors`.** `W-NAV-CHUNK-LOAD-FAILED` is
emitted by `runtime-template.js` inside the GENERATED app, not by the compiler — it never enters
`result.errors`/`result.warnings`. Browser + conformance are its only coverage.

**Lint diagnostics are a THIRD stream.** `W-LINT-*` and the three `*-TAILWIND-*` codes return into
`lintDiagnostics[]` (the ghost-error lint pre-pass in `api.js`), not `errors[]`. A test filtering
`result.errors` silently misses them — as does one filtering `result.warnings`.

**Warning-partitioned codes need BOTH streams.** `W-`/`I-` codes with `severity:"info"|"warning"`
route to `result.warnings`; everything else to `result.errors`. `result.errors.filter(...)` alone is
the classic false-green.

**A grep-hit in an `expected.json` is not an assertion.** A conformance case may MENTION an E-code in
rationale prose without asserting it in `codes`/`notCodes`. Read the file before recording a code as
covered.

**Emitted-text assertions are not execution proof.** A client-runtime feature verified by grepping
the emitted bundle for a marker can be dead on arrival (a load-time `ReferenceError` aborts boot
before the marker's code ever runs — exactly the GH #234 shape). Execute the bundle.

## §14.8.11 DB-authoritative tier — live-Postgres skip-graceful pattern

The three integration tests (`db-authoritative-pg`, `db-authoritative-p2-pg`, `db-migrate-pg`) and
the M1/P2 conformance pair run the ACTUAL negative test against a real Postgres — the ONLY proof
that separates real DB enforcement from an egress-JS-shaped gap (SPEC §14.8.11: "a half-shipped RLS
'looks enforced and isn't' — worse than none"). They SKIP (not fail) when no live Postgres is
reachable, so the `gate` CI tier stays green while `tracking`/local-with-PG exercises the real
assertions. `schema-introspect-pg.test.js` originated the pattern. **Do not convert these to a
mocked/in-memory Postgres** — RLS/GRANT/SECURITY DEFINER behaviour is not faithfully mockable.
Residual gap: `g-dbauth-no-request-path-test` (MED) — the lock asserts EMISSION, not a real
login-over-HTTP → cookie → per-user-read round trip.

## Public-content gates (NOT `bun test`, but CI-required — see build.map.md)
`bun scripts/snippet-gate.js` — compiles every `.scrml` in the public snippet corpus. **Corpus
WIDENED this window to include `docs/website` (98 files)** alongside `docs/tutorial-snippets/` and
`docs/readme-snippets/`. A failure here means a published document is making a false claim — but the
gate only proves a page COMPILES, never that its PROSE is true.
`bun scripts/facts.ts --check` — fails if any generated figure in `docs/FACTS.md` is stale.
`bun run scripts/regen-spec-index.ts --check` — **NEW in CI `gate` this window**; fails if
`compiler/SPEC-INDEX.md`'s generated totals block is stale.

## CI test-tier mapping (see build.map.md for the full workflow)
`gate` (blocking): unit + conformance + the TodoMVC gauntlet compile-and-parse check + snippet-gate
+ facts `--check` + **SPEC-INDEX totals `--check`**.
`tracking` (non-blocking): integration + lsp + commands + browser + the parser-conformance-within-node
M6.x backlog. The live-PG DB-authoritative integration tests run here, skip-graceful.
`windows` (non-blocking): unit + conformance on windows-latest (surfaces OS-path-separator bugs the
Linux gate can't see — and this window's D-4 work is squarely in that class, since
`distRelativeServerSpecifier` and `isOutsideBase` split on the PLATFORM `sep` and normalize to `/`).
Local pre-commit: unit + integration + conformance (`--bail`, ~2min).
Local pre-push: the full `bun test compiler/tests/` run + gauntlet + fixture refresh + **the new
~0.3s generated-doc currency gate** (+ snippet-gate on release-tag pushes only — it costs ~48s).

## Fixtures & Factories
compiler/tests/fixtures/ — 8 shared fixture files
compiler/tests/helpers/ — 3 shared test-helper modules
compiler/tests/commands/migrate-program-shape-fixtures/ — `scrml migrate` (source-codemod, NOT `db-migrate`) fixture set
samples/compilation-tests/ — 12 fixture dirs compiled by `scripts/compile-test-samples.sh` (`bun run pretest`) before the suite; dist/ is gitignored. **These go STALE** — a browser-test triage starts by recompiling them, before comparing anything.
conformance/cases/ + conformance/adapters/ — the D3 corpus (**747 cases**, +1 this window) + per-impl adapters
docs/tutorial-snippets/ + docs/readme-snippets/ + docs/website/ — the public snippet corpus; REAL programs under a compile gate, functioning as a public-surface regression corpus

## Pattern
Bun's native `describe`/`test`/`expect` from `bun:test`. Files import directly from `compiler/src/*`
or `compiler/runtime/stdlib/*.js` (not through the public CLI) to unit-test internals — EXCEPT
`db-migrate-pg.test.js`/`db-authoritative-p2-pg.test.js`, which deliberately drive `runDbMigrate` /
the CLI surface (the acceptance gate is "proven THROUGH the CLI"). Naming ties a test file to its
originating bug/gap/session tag (`g-<slug>`, `ss<N>-<slug>`, `E-<CODE>-*`, `issue-<N>-<slug>`,
`i<issue#>-<slug>`, `gh<issue#>-<slug>`, `d<N>-<slug>`, `conf-<CODE>-<milestone>`) so a diagnostic
code or gap-id greps directly to its regression test. Assertions favor `toBe`/`toMatch`/`toThrow`
over mocks. Numbered comment-tagged sub-tests (`C1`, `C2`…) inside one `describe` are common. A dated
pattern (`<bug-slug>-YYYY-MM-DD.test.js`) is used for HIGH-severity security-fix regressions with the
root-cause narrative in a header docstring.

**Format-gated assertions.** The `esm-*.test.js` files establish the convention for the two client
module formats: assert the CLASSIC output is byte-unchanged AND assert the esm shape separately.

**DOM-shape assertions.** Any test asserting a top-level `<each>` renders must look for the comment
fence `<!--scrml-each:N-->` / `<!--/scrml-each:N-->` and rows as SIBLINGS between the anchors.

**Byte-identity anti-regression.** Several landings this window are gated on "emits byte-identically
when the feature is not used" (D-5's client bundle, the `on mount` wrap without a server call, a
project with no `pages/` segment under D-4, `outline-*`'s arbitrary forms). Where that guarantee is
claimed, assert it — and note that one such guarantee has already been formally RETIRED (the
zero-immutable-columns DB-authoritative byte-identity, S288), so do not assume an old one still holds.

**Browser-suite triage order.** Recompile `samples/compilation-tests/` fixtures FIRST (they go
stale), then compare the WHOLE suite rather than an isolated file — happy-dom global state leaks
between files, so a single-file run can be green while the suite is red, and vice versa.

## Tags
#scrml #map #test #bun-test #happy-dom #playwright #conformance #stdlib-tests #lsp-tests #ci-gate #esm-chunks #module-format #each-fence #snippet-gate #facts-gate #spec-index-gate #colorless-async #dbauth #db-migrate #live-pg-skip-graceful #acceptance-gate #browser-suite #reconcile-replace #gh234 #gh235 #gh237 #d4 #d5 #i225 #navigate-wave1c #sql-table-refs #tailwind-outline #e-pa-002 #lint-diagnostics-stream #execute-dont-grep

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [build.map.md](./build.map.md)
- [error.map.md](./error.map.md)
- [structure.map.md](./structure.map.md)
- [migrations.map.md](./migrations.map.md)
- [dependencies.map.md](./dependencies.map.md)
