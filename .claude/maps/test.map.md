# test.map.md
# project: scrml
# updated: 2026-08-06T23:38:11-06:00  commit: 97576f35
# **SOURCE WALK IS AT `cf1849b2`; the stamp is `97576f35`, the true HEAD.** The two later commits are
# DOCS-ONLY (zero diff under compiler/ scripts/ stdlib/ package.json .github/).
# NOTE (S325/S326 INCREMENTAL pass): over `a3a34d80` -> `97576f35`. **+4 test files, and the two
# biggest are the two worth reading before writing a test in this repo** —
# `unit/mangler-region-fencing.test.js` (674L) and `integration/authed-server-fn-response-http.test.js`
# (764L). Both EXECUTE rather than grep emitted text, both pin their own residual, and the second one
# carries the window's sharpest testing lesson: **20 pre-existing test sites across 6 files ASSERTED
# THE BUG** and were CORRECTED, not preserved. Counts re-derived by `git ls-files` + `docs/FACTS.md`.

## Test Framework
Runner: `bun:test` (Bun's built-in test runner, no separate package dep)
Config: bunfig.toml (`[test] root="compiler/tests/", timeout=10000`)
Run all: `bun test compiler/tests/`
Run single: `bun test compiler/tests/unit/<file>.test.js`
Coverage: `bun test compiler/tests/ --coverage`
Browser DOM: happy-dom / @happy-dom/global-registrator (compiler/tests/browser/)
Browser tier ASSERTION: `bun scripts/browser-baseline.ts --check` (**not** `bun test compiler/tests/browser`)
E2E: Playwright (`@playwright/test`), separate config at e2e/playwright.config.ts, NOT part of `bun test`

## Test Categories (compiler/tests/, **1327** `*.test.js` total)

Fresh recursive `git ls-files` recount at `97576f35`, all 9 categories individually re-verified;
agrees with `docs/FACTS.md` (`test files | 1,327`), **which is the citable authority — do not
hardcode a competing number.** Net **+4** this pass (unit +2, integration +1, browser +1;
conformance / lsp / commands / self-host / e2e-render-map / top-level all unchanged).

| Category | Glob | Count | **Which gate runs it** |
|---|---|---|---|
| Unit | `compiler/tests/unit/**/*.test.js` | **874** | `gate` (blocking) + pre-commit + pre-push |
| Integration | `compiler/tests/integration/**/*.test.js` | **192** | `tracking` (non-blocking) + pre-commit + pre-push |
| Conformance | `compiler/tests/conformance/**/*.test.js` | 131 (unchanged for TWO windows) | `gate` (blocking) + pre-commit + pre-push |
| Browser | `compiler/tests/browser/**/*.test.js` | **91** | `gate` (BLOCKING) + `tracking` — via the NAME-SET check |
| LSP | `compiler/tests/lsp/**/*.test.js` | 11 | `tracking` only (non-blocking) |
| Commands | `compiler/tests/commands/**/*.test.js` | 8 | `tracking` only (non-blocking) |
| Self-host | `compiler/tests/self-host/**/*.test.js` | 4 | `tracking` only (non-blocking) |
| e2e-render-map | `compiler/tests/e2e-render-map/` | 2 | `tracking` only (non-blocking) |
| Parser-conformance + native-* | top-level `compiler/tests/*.test.js` | 14 | `gate` (blocking) + pre-commit (since S302) |

**New this pass — 4 files, and each one is worth knowing WHY it exists:**

| File | Tier | Lines | What it pins |
|---|---|---|---|
| `unit/mangler-region-fencing.test.js` | unit | **674** | #458 — all three mangler defects, in FIVE labelled sections, and it is the model to copy. **§1 EXECUTES the shipped `--embed-runtime` bundle** (`_scrml_replay` is invoked; pre-fence it was a `ReferenceError` on `log`) rather than grepping for a marker — the S265 execute-don't-grep rule applied to a codegen fix. **§2a tests the CLASSIFIER directly**, including that a `binding-pattern` is RECOGNISED and deliberately NOT acted on. **§2c is a NEGATIVE DEPENDENCY test** — the cross-file module-registry footer must stay `{publicName: emittedName}` and the importer's destructure verbatim. **§2f is a RESIDUAL MAP**: the shapes the fix does NOT reach (nested groups, spread, mixed `{get, post, n: 1}`, the ternary ALTERNATE) are pinned as failing-by-design in the SUITE, not merely described in prose — so the residual cannot silently drift. §2e pins the `__proto__` B.3.1 shape-preservation refusal. §3 asserts the `registerFnName` drop directly, satisfying invariant 27. |
| `integration/authed-server-fn-response-http.test.js` | integration | **764** | #452 — every server-fn route handler terminates in a `Response`, asserted **over real HTTP against a real server**, not against emitted text. Six describe blocks: `auth="required"` (including a VOID no-`return` body), `protect=` without an explicit `auth=` (**and it proves the predicate is WIDER than `auth=`** — the app has no source-level `auth=` yet still carries an auth gate), both gates together, a **no-auth CONTROL asserting the `useBaselineCsrf` path is UNCHANGED** including its double-submit `Set-Cookie`, session establishment (the sid cookie survives the envelope — the silent-drop this fix also closed), and the body-built-`Response` passthrough. That last block is exemplary: it pins the upstream `E-SCOPE-001` build-block **and** asserts the guard is emitted AHEAD of the envelope **and** EXECUTES to prove a body's 403 is not re-emitted as 200. It also pins ORDER — "the protect= egress redact runs BEFORE serialization, never after". |
| `unit/show-false-ssr-hidden-no-fouc.test.js` | unit | 197 | #450 §17.2 — 11 sections covering both directions: `display:none` IS emitted for an initial-false `show=`, and the element is **BYTE-INERT** for initial-true. §5-§7 pin the `style=` merge policy (merge into a static literal; author `display` wins; a reactive/interpolated style is never clobbered), §8-§9 pin the fail-inert cases (dotted path, reassigned/indeterminate cell), §11 pins that the client hydration controller still reveals. |
| `browser/g-each-shorthand-markup-fn-mount.browser.test.js` | browser | 152 | #456 — a `:`-shorthand `<each>` body whose child is a markup-returning fn call MOUNTS per row, asserted in the browser tier at runtime. |

**⚠ THE TESTING LESSON OF THIS WINDOW, and it is a repeat of the S276 shape — read it before you
"preserve" an existing assertion.** #452's landing corrected **20 tolerate-or-assert-bare test sites
across 6 files** (`integration/auth-csrf-synchronizer-token.test.js`,
`integration/csrf-canonical-delivery.test.js`, `integration/session-establishment-roundtrip.test.js`,
`integration/session-secure-b4b5-roundtrip.test.js`, `unit/session-context-gate-b2b3.test.js`,
`unit/session-establishment.test.js`). Those sites were not neutral — **they encoded the defect as
expected behaviour, because the oracle shared the implementation's blind spot.** A green suite over
them was evidence of nothing. When a fix requires editing existing assertions, that is a signal to
check whether the assertions were ever right, not a signal to minimise the diff.

**`compiler/tests/browser/FAILURE-BASELINE.json` is unchanged, and that is a CLAIM, not an omission** —
the browser tier gained a test and it passes, so the failure NAME SET did not move.

Carried from the prior pass, still true: `unit/error-handler-const-bind-r25-bug-49.test.js` and
`integration/nested-error-handler-no-invalid-js.test.js` have an incidental blanket
`errors.toHaveLength(0)` **NARROWED to exclude exactly one code** — the known-false-positive
`E-ASYNC-STDLIB-IN-SYNC-CALLBACK` firing described in error.map.md. Every subject assertion is
untouched, and any OTHER new diagnostic still fails them.

The top-level `conformance/` corpus moved **+2** this window — **857** cases, the two NEW
`value-decl-block-arm-{raw,variant}` pins from #447 (`docs/FACTS.md` is the authority).

## THE BROWSER TIER IS NOW GATED — and the mechanism generalizes

**Read this before adding a tier to a gate, or before "fixing" a browser test.**

`compiler/tests/browser` carries a DOCUMENTED FAILURE BASELINE and always exits 1. The consequence
was not "we lose browser coverage" — it was worse and two-sided:
1. **A real regression was invisible**, because a tier that always fails is indistinguishable from a
   tier that has REGRESSED. That is `pa-base` §8's "a gate that has never failed is
   indistinguishable from a gate that CANNOT fail", in its purest form.
2. **A failed step HALTS the job**, so every `tracking` step AFTER the browser step was skipped.
   Verified, not assumed: on run `30742472551` the `Within-node parser-parity + canary` step reports
   `skipped` and had therefore **never run at all** — the S302 gate-hole class recurring one job over.

**The fix is to gate on the WRONG THING LESS.** `scripts/browser-baseline.ts --check` asserts the
failure **NAME SET**: exit 0 while unchanged, exit 1 the moment a name joins or leaves it. It is now
a step in BOTH the blocking `gate` and `tracking`.

- **Key = `<suite> > <test name>` and nothing else.** Timings, pass/fail COUNTS, file paths and
  bun's file ordering are deliberately stripped — each would flap red for reasons no commit caused,
  and a count moving is not information about WHICH test moved.
- **BIDIRECTIONAL.** A name JOINING is a regression. **A name LEAVING means the baseline is STALE —
  prune it in the same commit that fixes the test.** A baseline nobody prunes silently re-acquires
  the blind spot it was built to remove.
- **Baseline artifact:** `compiler/tests/browser/FAILURE-BASELINE.json` — 48 failure names + 2
  `envExcluded` entries, `recordedAt` 2026-08-02, `@generated` by `--write`.
- **Do NOT record a new baseline to make a red check green.** `--write` is for a landing that
  legitimately moves the set, in the same commit.
- **Scope is the browser tier only.** lsp / commands / self-host carry their own undocumented
  baselines and have NO name-set assertion — `g-lsp-commands-selfhost-tiers-have-no-failure-name-set-assertion`
  (LOW). Extending the shape is mechanical.
- **Deliberately NOT in pre-push.** Local environments vary far more than CI, and it was exactly a
  local environment difference that made the first recorded baseline wrong.

**The two ORIGINAL gate-topology failure modes still stand** (build.map.md has the long form):
a tier that NOTHING blocking runs is where a regression hides (the 14 root-level files, fixed S302);
a blocking tier pointed at a tree with a documented failure baseline is structurally unpassable and
gets bypassed then deleted (pre-push, fixed S301). **The name-set shape is what reconciles them.**

## Coverage shapes worth knowing before writing a test here

**A grep-hit is not an assertion — and this now has a machine oracle.** A conformance case may
MENTION an E-code in `description`/`rationale` prose without asserting it; `notCodes` asserts ABSENCE
and does not prove the code can fire. **Only `expect.codes` is a positive pin**, and
`bun scripts/s34-census.ts --full` computes the pinned set that way (338 PINNED at this HEAD). Read
the `expected.json` before recording a code as covered.

**A §34 row is not evidence of a fire site, and now neither is an emitter string.** Two live shapes:
`E-CHANNEL-INSIDE-PAGE` was cataloged and never wired (S301); `E-MW-006` has a `code:` push that the
guarded shape cannot reach — **middleware is dropped silently** (ss63). Execute, or trace the caller.

**A RUNTIME-SURFACED code has no diagnostic to assert.** Three codes (`E-PARSEVARIANT-*`) are
implemented as a runtime enum VALUE, not a diagnostic push, so they appear in zero emitters while
being fully built. They were written up as the pre-freeze arc's sharpest false-claim case before the
runtime was checked. **Verify the runtime, not `result.errors`.**

**A runtime-only diagnostic cannot be asserted from `result.errors`.** `W-NAV-CHUNK-LOAD-FAILED` is
emitted by `runtime-template.js` inside the GENERATED app. Browser + conformance are its only coverage.

**Lint diagnostics are a THIRD stream.** `W-LINT-*` and the three `*-TAILWIND-*` codes return into
`lintDiagnostics[]` (the ghost-error lint pre-pass in `api.js`), not `errors[]`.

**Warning-partitioned codes need BOTH streams.** `W-`/`I-` codes with `severity:"info"|"warning"`
route to `result.warnings`; everything else to `result.errors`. `result.errors.filter(...)` alone is
the classic false-green.

**Emitted-text assertions are not execution proof — the trap has FOUR recorded occurrences now.**
S265 theme-switch, S268 component-root, GH #234, and **S307's `<engine>` audit port**, where the
registration emitted correctly and the log stayed empty because the raw cell name resolved in the
wrong chunk key space. **Only executing a transition caught it; grepping the bundle for the
registration passes either way.** Execute the bundle.

**An auto-GENERATED test artifact must not be able to report a false green.** §51.13's generator used
to emit `test("no qualifying machines", () => expect(true).toBe(true))` for an empty run — a passing
assertion verifying nothing, landing in an ADOPTER's suite as a green tick, and firing precisely for
the canonical modern `<engine>` state-child form. It is now `test.skip(...)` naming why. When you add
a generated-test path, make the empty case SKIP, never PASS.

**A structural-`if=` POSITIVE case is deliberately DOM-indistinguishable from no-`if=` at all.**
`if=true` MUST render exactly what an ungated element renders — that non-perturbation *is* the claim.
Discrimination comes from (a) the `codes` half (`notCodes: ["E-DG-002"]`) and (b) the `-absent-rt`
companion. **Write structural-gate cases in mounts/absent PAIRS with a `notCodes` on the positive
one**, or the positive case proves nothing.

**A gated `<engine>` case must exercise a transition WHILE the gate is false.** `if-on-engine-render-gate-mounts-rt`
has LOAD-BEARING input order: transition first, reveal second. An implementation that gated the
engine's CONSTRUCTION renders the `initial=` arm, and only that order catches it.

**A `-rt` suffix means the case EXECUTES** (`input` + `state` + `domAnchored` in `expected.json`).
A compile-only case cannot see a mount/unmount, hydration or teardown defect.

**A route-lifecycle test must exercise a NAVIGATION, not a mount.** The §20.8.8 contract's edges are
route-leave/route-enter, and the two are wired to nothing today. The verification the impl owes is
recorded in `docs/changes/route-region-teardown/SCOPING.md`; the single most important item there is
the NEGATIVE one — **a `<timer>` in the SHELL must SURVIVE navigation**, because the fix necessarily
touches where timers are CREATED and a misclassified shell timer silently killed by a nav is a worse
failure than the leak it closes.

**A migration/codemod test must assert the FAIL-CLOSED branch.** `scrml migrate`'s §51.9 projection
rewrite leaves the whole declaration untouched on any unparseable body line, because half-migrating a
projection silently drops mappings. Fixtures live in
`compiler/tests/commands/migrate-program-shape-fixtures/`.

**A re-parse that SWALLOWS sub-errors needs its own positive test, not just the happy path (NEW,
#396).** `ast-builder.js`'s `export` re-parse used to suppress every sub-error from its inner parse —
a top-level `E-FN-EQUALS-BODY` test would NOT have caught the exported form silently compiling to an
empty function. The fix's test coverage therefore pins BOTH shapes (top-level decl-body AND `export`)
at each of the four+one call sites, not one representative site — a lesson worth generalizing to any
future fix at a re-parse boundary.

**A choke-point CONSOLIDATION needs a regression pin proving the OLD bug classes stay fixed, not just
the new shape (#405).** `conf-CTRL-fnbody-autoawait-choke-point.test.js` exercises the unified
`injectFnBodyServerCallAwaits` across if/for/while AND `given`/match-block/`try` bodies in one file —
retiring `injectPromiseAwait` without this coverage would have re-opened `g-hash87-member-read-await-
misparen`-class regressions silently, since the retired function's bare-prefix mis-paren and its
scope-fencing were two INDEPENDENT defects a narrower test could miss one of.

**A reset-init-thunk fix needs an RT case proving `reset()` actually restores the DECLARED value, not
just that the fix compiles (#417).** `reactive/reset-init-after-assignment-rt` and its `-in-if`
sibling assert the EXECUTED post-`reset()` value (0), not merely the absence of a diagnostic — a
compile-only case cannot distinguish "clobbers the thunk" from "doesn't".

## §14.8.11 DB-authoritative tier — live-Postgres skip-graceful pattern

The three integration tests (`db-authoritative-pg`, `db-authoritative-p2-pg`, `db-migrate-pg`) and
the M1/P2 conformance pair run the ACTUAL negative test against a real Postgres — the ONLY proof that
separates real DB enforcement from an egress-JS-shaped gap (SPEC §14.8.11: "a half-shipped RLS 'looks
enforced and isn't' — worse than none"). They SKIP (not fail) when no live Postgres is reachable.
`schema-introspect-pg.test.js` originated the pattern. **Do not convert these to a mocked/in-memory
Postgres** — RLS/GRANT/SECURITY DEFINER behaviour is not faithfully mockable. Residual:
`g-dbauth-no-request-path-test` (MED) — the lock asserts EMISSION, not a login-over-HTTP round trip.
Related standing hazard: **session-auth full-bundle-over-HTTP conformance is cloud-runner-infra-flaky**
(passes local, fails cloud-only) — execute the shipped helper and assert wiring instead.

## Public-content + generated-artifact gates (NOT `bun test`, but CI-required)
`bun scripts/snippet-gate.js` — compiles every `.scrml` in the public snippet corpus
(`docs/tutorial-snippets`, `docs/readme-snippets`, `docs/website`). Proves a page COMPILES; proves
nothing about its PROSE.
`bun scripts/facts.ts --check` — fails if any generated figure in `docs/FACTS.md` is stale.
`bun run scripts/regen-spec-index.ts --check` — fails if `compiler/SPEC-INDEX.md`'s generated totals
block is stale. (Only the TOTALS are gated; the AUTHORED half is ungated and has rotted — see
non-compliance.report.md.)
`bun scripts/browser-baseline.ts --check` — **NEW, in BOTH gate and tracking.**
`bun scripts/s34-census.ts --check-new --base <ref>` — **NEW in `gate`**, the SPEC §34.0
row-provenance rule, DIFF-SCOPED so it is silent on the legacy corpus by construction.
`bun scripts/state.ts --check` — the `@gap` rollup; **THROWS on an unparsed marker or an unknown
status**, so it is a real gate. Its parser is exported + `import.meta.main`-gated specifically so
that guard is testable (`compiler/tests/unit/gap-marker-parser-s307.test.js`).

## CI test-tier mapping (see build.map.md for the full workflow)
`gate` (blocking, 12 steps): unit + conformance + the 14 root-level `*.test.js` + the TodoMVC
gauntlet compile-and-parse check + **browser NAME-SET** + snippet-gate + facts `--check` +
SPEC-INDEX totals `--check` + **§34.0 row-provenance**. Checkout is `fetch-depth: 0` (the §34.0 gate
needs merge-base).
`tracking` (non-blocking): integration + lsp + commands + **browser NAME-SET (replacing the raw run)**
+ the parser-conformance-within-node M6.x backlog. The live-PG tests run here, skip-graceful.
`windows` (non-blocking): unit + conformance on windows-latest.
Local pre-commit: unit + integration + conformance + root-level `*.test.js` (`--bail`, ~2min).
Local pre-push: unit + integration + conformance only — **NOT** the whole of `compiler/tests/` — and
**skipped entirely on a NEW-REF push** (the cloud `gate` on the PR is authority, S254). Plus gauntlet
+ fixture refresh + the ~0.3s generated-doc currency gate (+ snippet-gate on release-tag pushes only).
Verified S301 at 21597 pass / 0 fail on a clean checkout. **The hook's own comment now claims the
browser check "runs in CI `tracking` today" and that promoting it is bryan's call — bryan ruled
promote in the same window; that narration is stale, the hook's SCOPE is not.**

## Fixtures & Factories
compiler/tests/fixtures/ — 8 shared fixture files
compiler/tests/helpers/ — 3 shared test-helper modules
compiler/tests/browser/FAILURE-BASELINE.json — **NEW.** The browser tier's documented failure NAME
SET. `@generated`; regenerate with `bun scripts/browser-baseline.ts --write`.
compiler/tests/commands/migrate-program-shape-fixtures/ — `scrml migrate` (source-codemod, NOT
`db-migrate`) fixture set — the `<machine>` retirement codemod's regression surface.
compiler/tests/parser-conformance-within-node-allowlist.json — per-file native-vs-live divergence
allowlist. **Adding a FIELD to a structural AST node grows this if the native mirror is not paid.**
samples/compilation-tests/ — 12 fixture dirs compiled by `scripts/compile-test-samples.sh`
(`bun run pretest`) before the suite; dist/ is gitignored. **These go STALE** — a browser-test triage
starts by recompiling them, before comparing anything.
conformance/cases/ + conformance/adapters/ — the D3 corpus (**855 cases**) + per-impl adapters.
docs/tutorial-snippets/ + docs/readme-snippets/ + docs/website/ — the public snippet corpus; REAL
programs under a compile gate.

## Pattern
Bun's native `describe`/`test`/`expect` from `bun:test`. Files import directly from `compiler/src/*`
or `compiler/runtime/stdlib/*.js` (not through the public CLI) to unit-test internals — EXCEPT
`db-migrate-pg.test.js`/`db-authoritative-p2-pg.test.js`, which deliberately drive `runDbMigrate` /
the CLI surface (the acceptance gate is "proven THROUGH the CLI"). Naming ties a test file to its
originating bug/gap/session tag (`g-<slug>`, `ss<N>-<slug>`, `E-<CODE>-*`, `issue-<N>-<slug>`,
`i<issue#>-<slug>`, `gh<issue#>-<slug>`, `d<N>-<slug>`, `conf-<CODE>-<milestone>`) so a diagnostic
code or gap-id greps directly to its regression test. Assertions favor `toBe`/`toMatch`/`toThrow`
over mocks. A dated pattern (`<bug-slug>-YYYY-MM-DD.test.js`) is used for HIGH-severity security-fix
regressions with the root-cause narrative in a header docstring.

**Format-gated assertions.** The `esm-*.test.js` files establish the convention for the two client
module formats: assert the CLASSIC output is byte-unchanged AND assert the esm shape separately.

**DOM-shape assertions.** A top-level `<each>` renders as the comment fence
`<!--scrml-each:N-->` / `<!--/scrml-each:N-->` with rows as SIBLINGS between the anchors. An
`if=`-gated per-item root may be a `<!--scrml-if-row-->` COMMENT rather than an absent node — assert
the ELEMENT is gone, not that the child count dropped.

**A duplicate-node-id bug is invisible to every single-component test.** The S299 component-expander
defect needed TWO instantiations (or two different components) in ONE file. Anything keyed on
`node.id` — each fences, `_scrml_each_renderers`, chunk-namespace tokens — instantiate twice.

**An escalation/placement test must assert the ARTIFACT, not the diagnostic.** §12.2 Trigger 3 emits
NO code, so `result.errors`/`result.warnings` are both empty on success AND on failure. The
discriminating assertions are: does a `.server.js` exist, and is the identifier absent from the
client bundle. Copy the Trigger-3 evasion battery's shape.

**Byte-identity anti-regression.** Several landings are gated on "emits byte-identically when the
feature is not used" (the `<#`-scoped condition re-parse, the `stateChildRules` substitution, the
`serverFnPeerAliasNames` thread, D-5's client bundle, a project with no `pages/` segment under D-4).
Where that guarantee is claimed, assert it — and note one such guarantee has already been formally
RETIRED (zero-immutable-columns DB-authoritative byte-identity, S288).

**Browser-suite triage order.** Recompile `samples/compilation-tests/` fixtures FIRST (they go
stale), then compare the WHOLE suite rather than an isolated file — happy-dom global state leaks
between files, so a single-file run can be green while the suite is red, and vice versa. **Then run
`bun scripts/browser-baseline.ts` and diff NAMES**, which is the comparison a human was doing by hand.

## THE PRE-LAND GATE FOR CODEGEN — `corpus-emit-differential` (NEW #428), and it is NOT `bun test`

**If your task changes anything under `compiler/src/codegen/`, this is the gate.** It is not in
`ci.yml`, not in `bun test`, not in any git hook — it is run BY HAND, base-vs-head, before landing.
There was no routing row for this task shape before this pass and the absence cost a dispatch.

```
bun scripts/corpus-emit-differential.ts capture --compiler-root <abs checkout> \
    --label base-<sha> --work /scratch/base --manifest /scratch/base.manifest.json
bun scripts/corpus-emit-differential.ts capture --compiler-root <abs checkout> \
    --label head-<sha> --work /scratch/head --manifest /scratch/head.manifest.json
bun scripts/corpus-emit-differential.ts diff --base /scratch/base.manifest.json \
    --head /scratch/head.manifest.json [--json /scratch/diff.json]
```

Default roots `examples,samples,conformance,stdlib,benchmarks` (RECURSIVE; the 453 deliberate
exclusions are PRINTED with per-directory counts, so what is not measured is a visible decision rather
than an invisible default). Population at this HEAD: **1878 sources / 7254 artifacts.** Reported:
compile-failure delta, artifact-SET delta, artifact-CONTENT delta, syntax delta under three goggles,
and the bare-server-fn-site count. **Exit codes are three-valued and the third one is the point:**
0 = no differences; 1 = differences found; **2 = NOT A VALID COMPARISON** (different roots, an
enumeration disagreement, the same revision on both sides, differing check contexts, a
`--reuse-artifacts` manifest, or a VACUOUS run in which zero artifacts were compared). A capture NEVER
exits non-zero merely because sources failed to COMPILE — compile failure is DATA.

**Why the syntax half is a separate `node` subprocess, and why "simplifying" it re-breaks it:**
`node --check` on a bare `.js` **ACCEPTS a top-level stranded `await`** (Node resolves it by
module-syntax auto-detection and parses it as a module). **The compiler emits `<script src=…>` with NO
`type="module"`** — a CLASSIC SCRIPT, where the same bytes are a fatal SyntaxError and the whole bundle
is dead on arrival. That is the auto-await work's own dominant failure mode. **`node --check` is not
used here and must not be reintroduced.** Compounding it: **bun's `vm.Script` does not reject a
top-level `await` either**, so an in-process fix under Bun would have been a THIRD hollow gate.
`corpus-check-goggles.js` parses each artifact under BOTH goggles via `vm.Script` /
`vm.SourceTextModule` — source text and nothing else, unlike `node --check`, whose verdict is a
function of (content, extension, nearest `package.json` `"type"`), an input living OUTSIDE the artifact.
The EFFECTIVE goggle is derived from the emitted HTML's own `<script>` tag.

**The anti-pattern it exists to kill had shipped THREE times, and it reads exactly like success:** a
truncated enumeration produces no error, well-formed output, and every downstream count, ratio and
scoping decision inherits the truncation (`artifact-diff.mjs` compared 8 of 115 · `u1-corpus-emit.sh`
measured 329 of 1818 and reported "708/708 byte-identical" · that same script's `node --check` half
inherited the same population). `pa-base v2.13 §8` names it THE TRUNCATED PROBE. Every defense in the
tool is marked `HARD REQ n` at its site so a future editor can see what they would be removing.

## Tags
#scrml #map #test #bun-test #happy-dom #playwright #conformance #ci-gate #browser-baseline #failure-name-set #bidirectional-baseline #failure-baseline-json #skipped-step-behind-red-step #gate-topology #gate-hole #non-blocking-tier #documented-failure-baseline #cry-wolf #s34-census #expect-codes-only #pin-vs-mention #runtime-surfaced #e-mw-006-dead #e-channel-inside-page #execute-dont-grep #vacuous-test-skip #generated-test-artifact #property-tests #§51.13 #engine-audit #route-region #§20.8.8 #shell-timer-non-regression #migrate-codemod #fail-closed-codemod #rt-suffix #mounts-absent-pairs #not-codes-discrimination #structural-if #§17.1.2 #lint-diagnostics-stream #dbauth #live-pg-skip-graceful #cloud-ci-http-flaky #snippet-gate #facts-gate #spec-index-gate #§34.0 #gap-marker-parser #proven-gate #new-ref-push-skip #changelog-dereferenced #facts-md-authority #e-fn-equals-body #reparse-swallowed-errors #subparse-span-rebase #match-arm-autoawait #crossmodule-async-markup #conformance-855 #cps-choke-point-landed #w-if-in-each #corpus-emit-differential #corpus-check-goggles #pre-land-gate #codegen-task-shape #dual-goggle #node-check-blind-to-tla #bun-vm-script-blind #truncated-probe #hard-req-markers #1878-sources #7254-artifacts #exit-code-2-invalid-comparison #self-retiring-guard #async-name-provider #u1-browser-runtime-test #execute-dont-grep #failure-baseline-unchanged-is-a-claim #narrowed-blanket-assertion #reset-init-thunk-reassignment #each-nested-if-not-reactive #mangler-region-fencing #execute-dont-grep #residual-map-in-suite #negative-dependency-test #authed-server-fn-response-http #real-http-assertion #oracle-shared-the-blind-spot #s276-shape #tolerate-or-assert-bare #show-false-ssr #byte-inert #each-shorthand-markup-fn-mount #857-conformance

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [build.map.md](./build.map.md)
- [error.map.md](./error.map.md)
- [structure.map.md](./structure.map.md)
- [domain.map.md](./domain.map.md)
- [migrations.map.md](./migrations.map.md)
- [dependencies.map.md](./dependencies.map.md)
