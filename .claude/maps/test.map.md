# test.map.md
# project: scrml
# updated: 2026-07-31T03:18:23Z  commit: f96e6f30
# NOTE (S302 pass): counts re-derived; the "new test files this window / prior window" inventories
# (~80 lines re-telling `docs/changelog.md`) are DELETED. What replaces them is a section on the
# gate hole this window found, and three new coverage-shape rules. A per-file inventory is what
# `git log --diff-filter=A -- compiler/tests` is for.

## Test Framework
Runner: `bun:test` (Bun's built-in test runner, no separate package dep)
Config: bunfig.toml (`[test] root="compiler/tests/", timeout=10000`)
Run all: `bun test compiler/tests/`
Run single: `bun test compiler/tests/unit/<file>.test.js`
Coverage: `bun test compiler/tests/ --coverage`
Browser DOM: happy-dom / @happy-dom/global-registrator (compiler/tests/browser/)
E2E: Playwright (`@playwright/test`), separate config at e2e/playwright.config.ts, NOT part of `bun test`

## Test Categories (compiler/tests/, **1294** `*.test.js` total)

Fresh recursive `git ls-files` recount at `f96e6f30`, all 9 categories individually re-verified;
agrees with `docs/FACTS.md` (`test files | 1,294`). Net **+13** across this window, all additions.

| Category | Glob | Count | **Which gate runs it** |
|---|---|---|---|
| Unit | `compiler/tests/unit/**/*.test.js` | **855** | `gate` (blocking) + pre-commit + pre-push |
| Integration | `compiler/tests/integration/**/*.test.js` | **185** | `tracking` (non-blocking) + pre-commit + pre-push |
| Conformance | `compiler/tests/conformance/**/*.test.js` | **126** | `gate` (blocking) + pre-commit + pre-push |
| Browser | `compiler/tests/browser/**/*.test.js` | **89** | `tracking` only (non-blocking) |
| LSP | `compiler/tests/lsp/**/*.test.js` | 11 | `tracking` only (non-blocking) |
| Commands | `compiler/tests/commands/**/*.test.js` | 8 | `tracking` only (non-blocking) |
| Self-host | `compiler/tests/self-host/**/*.test.js` | 4 | `tracking` only (non-blocking) |
| e2e-render-map | `compiler/tests/e2e-render-map/` | 2 | `tracking` only (non-blocking) |
| Parser-conformance + native-* | top-level `compiler/tests/*.test.js` | **14** | **`gate` (blocking) + pre-commit — BOTH NEW THIS WINDOW.** See the gate-hole section below. |

The top-level `conformance/` corpus moved further: **756 -> 769 cases (+13)**.

## THE GATE HOLE THIS WINDOW FOUND — read before trusting "the suite is green"

**The 14 root-level `compiler/tests/*.test.js` files were outside EVERY blocking check.** Thirteen
had **no runner anywhere**; the fourteenth (`parser-conformance-within-node`) ran only in `tracking`,
which is `continue-on-error: true`. They are also outside the pre-commit hook's
unit/integration/conformance scope. Consequence, measured: **a 38-failure native-parity regression
passed pre-commit AND the required `gate`**, and surfaced only as a red `tracking` — the job everyone
correctly reads as the documented browser/serve-tool baseline.

**The transferable rule: a gate that is correctly non-blocking and habitually red is where a real
regression hides.** Two structural corollaries this repo now encodes:

1. **A non-blocking tier must not be the SOLE runner of anything.** Fixed by adding
   `bun test compiler/tests/*.test.js` to CI `gate` and to `scripts/git-hooks/pre-commit`. The files
   are deterministic (no dist / browser / network deps) and cost ~16s; green at wiring time at
   6394 tests / 0 fail.
2. **A blocking tier must not be pointed at a tree carrying a documented failure baseline.** pre-push
   used to run the WHOLE of `compiler/tests/`, where browser/lsp/self-host/commands carry ~42 known
   failures assessed by comparing failure-NAME SETS, not counts. An exit-code gate cannot express
   "the same names as before", so that scope made the hook structurally unpassable. See build.map.md
   — the two corollaries pull in opposite directions and both are load-bearing.

## What landed in the test suite this window — DEREFERENCED

The prior generations of this map inventoried each new test file per window (~80 lines). **Deleted.**
`git log --diff-filter=A --name-only d0763cff..HEAD -- compiler/tests` answers it faster and cannot go
stale. For narrative, `docs/changelog.md`. The 13 additions cluster in two arcs: seven `if=`
mount/structural browser tests + `unit/if-on-structural-elements.test.js` (§17.1.2), and three
cross-file/cross-module emit tests plus a corpus emitted-specifier resolution guard.

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

**A structural-`if=` POSITIVE case is deliberately DOM-indistinguishable from no-`if=` at all.**
`if=true` MUST render exactly what an ungated element renders — that non-perturbation *is* the claim
— so the `-mounts-rt` conformance cases cannot discriminate against the pre-widening baseline on
their DOM half. The discrimination is carried by (a) the `codes` half (`notCodes: ["E-DG-002"]` —
pre-widening the dependency graph never saw the predicate, so a cell read only there false-fired) and
(b) the `-absent-rt` companion case. **Write structural-gate cases in mounts/absent PAIRS, and put a
`notCodes` on the positive one**, or the positive case proves nothing.

**A gated `<engine>` case must exercise a transition WHILE the gate is false.** `§17.1.2.1` says the
engine "really is" at its current variant by the time it mounts. The case that pins this
(`if-on-engine-render-gate-mounts-rt`) has LOAD-BEARING input order: transition first, reveal second.
An implementation that gated the engine's CONSTRUCTION — deferring it to first mount or
re-initialising on mount — renders the `initial=` arm and only that input order catches it.

**A `-rt` suffix on a conformance case means it EXECUTES** (`input` + `state` + `domAnchored` in
`expected.json`), not merely that it compiles. A compile-only case cannot see a mount/unmount defect;
this window's whole `if=` family is `-rt` for that reason.

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
`gate` (blocking): unit + conformance + **the 14 root-level `compiler/tests/*.test.js` (NEW)** + the
TodoMVC gauntlet compile-and-parse check + snippet-gate + facts `--check` + SPEC-INDEX totals
`--check`.
`tracking` (non-blocking): integration + lsp + commands + browser + the parser-conformance-within-node
M6.x backlog. The live-PG DB-authoritative integration tests run here, skip-graceful.
`windows` (non-blocking): unit + conformance on windows-latest (surfaces OS-path-separator bugs the
Linux gate can't see — and this window's D-4 work is squarely in that class, since
`distRelativeServerSpecifier` and `isOutsideBase` split on the PLATFORM `sep` and normalize to `/`).
Local pre-commit: unit + integration + conformance + **root-level `*.test.js` (NEW)** (`--bail`, ~2min).
Local pre-push (**scope CHANGED this window**): unit + integration + conformance only — **NOT** the
whole of `compiler/tests/` — and **skipped entirely on a NEW-REF push** (the cloud `gate` on the PR is
authority, S254); it runs on an update to an existing remote ref and on any release tag. Plus
gauntlet + fixture refresh + the ~0.3s generated-doc currency gate (+ snippet-gate on release-tag
pushes only — it costs ~48s). Verified S301: that subset is 21597 pass / 0 fail on a clean checkout,
so the gate CAN go red for a real regression and green otherwise — which is the whole point.

## Fixtures & Factories
compiler/tests/fixtures/ — 8 shared fixture files
compiler/tests/helpers/ — 3 shared test-helper modules
compiler/tests/commands/migrate-program-shape-fixtures/ — `scrml migrate` (source-codemod, NOT `db-migrate`) fixture set
samples/compilation-tests/ — 12 fixture dirs compiled by `scripts/compile-test-samples.sh` (`bun run pretest`) before the suite; dist/ is gitignored. **These go STALE** — a browser-test triage starts by recompiling them, before comparing anything.
conformance/cases/ + conformance/adapters/ — the D3 corpus (**769 cases**, **+13 this window**: 10 `control-flow/if-*` + 2 `reactive/if-wiring-bearing-subtree-*` + 2 `channel/*` + 1 `server-db/first-class-fn-ref-server-helper-rt`; net +13 with one prior case's expectation updated) + per-impl adapters. The nine: `each/per-item-if-reactive/{create-time-absence,flip-false-true,flip-true-false,reorder-toggled}` (Tier-1 `<each>`) and `each/for-lift-per-item-if-reactive/{same four}` (Tier-0 `${for…lift}`) plus `reactive/if-top-level-absent`. **The two families are deliberately MIRRORED case-for-case** — the two tiers have separate emit paths (`emit-each.ts` vs `emit-lift.js`) that share one runtime helper (`_scrml_ifrow_apply`), so a fix landing in one tier and not the other is the expected failure mode and the corpus is shaped to catch it.
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
**NEW this window: an `if=`-gated per-item root may be a `<!--scrml-if-row-->` COMMENT rather than an
absent node** — the reconcile-tracked node is always present, so a test asserting "the row is gone"
must assert the ELEMENT is gone, not that the child count dropped.

**A duplicate-node-id bug is invisible to every single-component test.** The S299 component-expander
defect needed TWO instantiations (or two different components) in ONE file to reproduce; each
component tested alone was green. If you are testing anything keyed on `node.id` — each fences,
`_scrml_each_renderers`, chunk-namespace tokens — instantiate at least twice in the same file.

**An escalation/placement test must assert the ARTIFACT, not the diagnostic.** §12.2 Trigger 3 emits
NO code, so `result.errors`/`result.warnings` are both empty on success AND on failure. The
assertions that actually discriminate are: does a `.server.js` exist, and is the identifier absent
from the client bundle. The Trigger-3 evasion battery is built that way — copy its shape.

**Byte-identity anti-regression.** Several landings this window are gated on "emits byte-identically
when the feature is not used" (D-5's client bundle, the `on mount` wrap without a server call, a
project with no `pages/` segment under D-4, `outline-*`'s arbitrary forms). Where that guarantee is
claimed, assert it — and note that one such guarantee has already been formally RETIRED (the
zero-immutable-columns DB-authoritative byte-identity, S288), so do not assume an old one still holds.

**Browser-suite triage order.** Recompile `samples/compilation-tests/` fixtures FIRST (they go
stale), then compare the WHOLE suite rather than an isolated file — happy-dom global state leaks
between files, so a single-file run can be green while the suite is red, and vice versa.

## Tags
#scrml #map #test #bun-test #happy-dom #playwright #conformance #stdlib-tests #lsp-tests #ci-gate #esm-chunks #module-format #each-fence #snippet-gate #facts-gate #spec-index-gate #colorless-async #dbauth #db-migrate #live-pg-skip-graceful #acceptance-gate #browser-suite #reconcile-replace #gh234 #gh235 #gh237 #d4 #d5 #i225 #navigate-wave1c #sql-table-refs #tailwind-outline #e-pa-002 #lint-diagnostics-stream #execute-dont-grep #trigger-3 #escalation-server-only #evasion-battery #node-id-freshness #per-item-if #ifrow-apply #conformance-mirrored-tiers #w-auth-middleware-auto-injected #gate-hole #root-level-tests #non-blocking-tier #documented-failure-baseline #cry-wolf #rt-suffix #mounts-absent-pairs #not-codes-discrimination #structural-if #§17.1.2 #new-ref-push-skip #changelog-dereferenced

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [build.map.md](./build.map.md)
- [error.map.md](./error.map.md)
- [structure.map.md](./structure.map.md)
- [migrations.map.md](./migrations.map.md)
- [dependencies.map.md](./dependencies.map.md)
