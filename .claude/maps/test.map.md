# test.map.md
# project: scrml
# updated: 2026-08-24T09:45:00-06:00  commit: b9e97f1b
# generated-at: b9e97f1b (the watermark IS `origin/main` and IS the working tip).
# **INCREMENTAL over `728bdc92` -> `b9e97f1b` (S371-bryan).** Ancestry CHECKED (invariant 48);
# outbound MAP-STAMP check run at WRITE time.
#
# **+1 test file, ZERO deleted — 1,386 -> 1,387** (`docs/FACTS.md` at this watermark). The new file
# is `compiler/tests/unit/wdead-each-opener-expr-reachability.test.js` (#688). Conformance corpus
# **FLAT at 883 for the FIFTH window running**. §34 **FLAT at 812** (`compiler/SPEC.md` untouched).
#
# ⚑ **THE ONE THING TO READ IN THIS MAP THIS PASS IS THE NEW SECTION "WHICH RUNTIME EACH TIER
# ACTUALLY EXECUTES".** The conformance (b) half runs the FULL `SCRML_RUNTIME` monolith, not the
# pruned artifact the browser loads — so **all 883 cases are blind to chunk pruning BY
# CONSTRUCTION**, and a shipped case (`each/ternary-markup-giti033`) passes while its page is dead.
# Measured, PA-reproduced, and it changes what "the suite is green" is evidence of.
#
# **Carried from S368 — the +8 / 1,378 -> 1,386 recount narrative below is LAST window's.**
#
# ⚑ **A CORRECTION TO THE PRIOR GENERATION OF THIS MAP, AND IT IS THE KIND THIS MAP SET EXISTS TO
# CATCH: ITS CATEGORY BREAKDOWN DID NOT SUM TO ITS OWN TOTAL, WHILE CLAIMING IT DID.** The prior
# header wrote *"The category sum re-checks: 885+196+132+92+11+8+4+2 = 1330, +14 top-level = 1378."*
# **That arithmetic gives 1,344, not 1,378** — a 34-file shortfall stated as a verification. Every
# category below was RE-COUNTED RECURSIVELY at this watermark and the sum is now checked by
# execution: **901+213+133+94+14+14+11+4+2 = 1,386.** ⚠ **The likely cause is the counting method,
# not a typo: several categories hold `*.test.js` files in SUBDIRECTORIES, so a non-recursive count
# undercounts.** Count recursively, then add.
#
# ─── WHAT THIS WINDOW ADDED, AND WHY EACH ONE IS A MERGE-BLOCKER RATHER THAN A REGRESSION TEST ───
#
# ⚑ **`integration/stdlib-client-registry.test.js` (37 cases, #669) — AND ITS TIER IS THE LESSON.**
# It was authored in `compiler/tests/browser/` and **DELIBERATELY MOVED TO `integration/`**, because
# `.git/hooks/pre-commit:39` runs unit + integration + conformance + root `*.test.js` and
# **`compiler/tests/browser/` IS NOT IN THAT SET** — so the merge-blocker proving the feature is not
# DOA was itself outside the merge gate. The browser tier is not load-bearing for any of it: 14
# integration tests already register happy-dom the same way, including this feature's own predecessor
# `integration/bug-18-scrml-stdlib-client-import.test.js`. **The WHOLE file moved, not just the new
# regression.** ⚠ **Before you call a test a merge-blocker, check which TIER it is in.**
#   Its four sections are worth knowing because they are a template for "the emitted artifact is
#   DEAD" testing, a class a grep-level assertion structurally cannot see (before the fix, every
#   text-level check anyone would write PASSED while the page was dead):
#     §1  every client-registered module EXECUTES, and its registry entry carries REAL exports
#         (an empty object would also "load" — asserting load is not asserting function).
#     §1b **THE PARTITION** — every shim on disk is client-registered XOR escalation-server-only,
#         with **no unclassified third state**. This is the assertion that stops the next module
#         hiding the way 17 did, and the module lists are DERIVED from `RUNTIME_CHUNK_ORDER` and
#         `ESCALATION_SERVER_ONLY_MODULES`, never hand-copied, so a chunk added tomorrow is executed
#         automatically.
#     §2  the gate FIRES for all 8 chunkless server-only modules + a submodule specifier.
#     §3  the gate does NOT over-fire — a server-only stdlib reached only from a `server function`
#         compiles clean (this pins the post-prune placement fix).
#     §4  **INSTRUMENT INTEGRITY** — the harness is fed a deliberately-DOA bundle and MUST report it.
#         **A harness that swallowed the throw would make §1 vacuous.** Invariant 59, applied to a
#         test harness rather than a CI step.
#
#   · `unit/s365-asis-unknown-split.test.js` (#665) — the §7.5/§14.7 split + `W-TYPE-031-UNPROVEN`.
#   · `integration/each-inline-value-form-if-interp.test.js` (#670, 5 cases, **bite-proven: 3 fail
#     pre-fix**).
#   · `integration/value-form-if-empty-string-branch.test.js` (#672).
#   · `integration/value-form-if-fn-condition-reactive.test.js` (#673, 4 cases, **bite-proven: 2 fail
#     pre-fix** — fn-condition + else-if cascade; plus direct-read and static non-regressions).
#   · `integration/each-cross-file-imported-markup-fn-mount.test.js` +
#     `browser/each-cross-file-imported-markup-fn-mount.browser.test.js` (#658).
#   · `integration/library-mode-fn-match-object-arm-lowering.test.js` (#664).
#   · `integration/trucking-dispatch-smoke-integration.test.js`.
#
# **`compiler/tests/TYPES-BASELINE.json` IS NEW AND IS NOT A TEST FILE.** It is
# `scripts/types-gate.ts`'s baseline — a **name->COUNT map**, keyed
# `<relative file> :: <TS code> :: <message head>` with line and column deliberately stripped.
# ⚠ **The COUNT half was a mid-build correction and it is the reusable part:** because the key strips
# line numbers, the NINE live `MarkupValueExpr` exhaustive-switch `never` failures in
# `expression-parser.ts` collapsed into ONE entry under a bare set — so a TENTH would have joined an
# existing entry and the gate would have stayed GREEN, on a defect class whose entire signal is *how
# many switches did this member fall through*. Regenerate with `bun scripts/types-gate.ts --write`;
# `--check` is red when a name JOINS **or LEAVES** the set, or when a count GROWS. build.map.md.
#
# **CARRIED, UNCHANGED — the conformance `expect` vocabulary is a DECLARED TABLE** (`EXPECT_SHAPES`
# at `conformance/run.ts:179`, enforced by `validateExpectContainers` at `:218`, EXPORTED on purpose:
# *"a validator that can only be reached by running the whole corpus is indistinguishable from one
# that never fires."*), and **#646's "five gates reporting green while measuring nothing"** with the
# unconditional `bracketed !== parsed` refusal in `state.ts` + `delta-lint.ts` (exit 1 = the log is
# wrong, exit 2 = the instrument is broken; 2 is NOT reachable as a PASS).
#
# ⚠ **THE COUNTING CAVEAT CARRIES.** `docs/FACTS.md`'s `test files` figure counts **`*.test.js` under
# `compiler/tests` only** — it EXCLUDES the **15** `*.test.ts` files in the same tree and excludes
# `conformance/`. Three populations, three right answers; name the one you mean.
#
# ⚠ **INVARIANT 56 CARRIES AND IS STILL THE FIRST THING TO CHECK ON ANY `(fail)`.** bun does not read
# `bunfig.toml [test] timeout`; the real per-test budget is bun's default **5000 ms** everywhere. A
# synchronous test that overruns still runs its assertions to completion — they PASS — and bun then
# reports `(fail) <name>`, **the same marker an assertion failure produces**. Declare `{ timeout }` at
# the site for anything multi-second. Several old test comments still cite "the bunfig default 10s",
# a number that was NEVER in force (non-compliance.report.md N11).
#

## Test Framework
Runner: `bun:test` (Bun's built-in test runner, no separate package dep)
Config: bunfig.toml (`[test] root="compiler/tests/"` — **NO timeout key, deliberately (#537); the
per-test budget is bun's DEFAULT 5000 ms everywhere.** The old `timeout = 10000` was never read —
declare a site-level `{ timeout }` on any legitimately-slow test; per-run override is the CLI flag
`bun test --timeout <ms>`. ⚠ bun marks a TIMED-OUT test with the same `(fail) <name>` marker as an
assertion failure — the tell is the `^ this test timed out after Nms.` line after the marker)
Run all: `bun test compiler/tests/`
Run single: `bun test compiler/tests/unit/<file>.test.js`
Coverage: `bun test compiler/tests/ --coverage`
Browser DOM: happy-dom / @happy-dom/global-registrator (compiler/tests/browser/)
Browser tier ASSERTION: `bun scripts/browser-baseline.ts --check` (**not** `bun test compiler/tests/browser`)
E2E: Playwright (`@playwright/test`), separate config at e2e/playwright.config.ts, NOT part of `bun test`

## Test Categories (compiler/tests/, **1,387** `*.test.js` total, +1 this window)

⚑ **S371: the per-category table below is LAST window's recount at `728bdc92`, carried. This window added exactly ONE file — `unit/wdead-each-opener-expr-reachability.test.js` — so `unit` is +1 and every other category is unchanged; the categories were NOT re-counted this pass.** Fresh RECURSIVE recount at `728bdc92`, all 9 categories individually re-verified; agrees with
`docs/FACTS.md` (which reads `test files | 1,387` at THIS watermark — **FACTS is the citable
authority; do not hardcode a competing number**). Net **+8** this pass, decomposing as **unit +16 · integration +17 · conformance
+1 · browser +2 · commands +6** against the prior map's figures.

⚑ **THOSE PER-CATEGORY DELTAS ARE MOSTLY A RECOUNT, NOT NEW TESTS — and that is the finding.** Only
EIGHT files were added by this window's PRs. The rest of the apparent movement is the prior map's
breakdown having been non-recursive: **its own stated sum (885+196+132+92+11+8+4+2 = 1330, +14 =
"1378") is arithmetically 1,344**, a 34-file shortfall published as a verification. **This one sums
by execution: 901+213+133+94+14+14+11+4+2 = 1,386.** Treat the prior per-category numbers as
superseded, not as a baseline to diff against.

**ZERO deletions, fourth window running.**

Carried: the conformance-TIER row counts `compiler/tests/conformance/*.test.js` — the artifact-level
harnesses — and is a DIFFERENT number from the 883 conformance CASES under `conformance/cases/`;
**do not reconcile them.**

| Category | Glob | Count | **Which gate runs it** |
|---|---|---|---|
| Unit | `compiler/tests/unit/**/*.test.js` | **901** | `gate` (blocking) + pre-commit + pre-push |
| Integration | `compiler/tests/integration/**/*.test.js` | **213** | `tracking` (non-blocking) + **pre-commit** + pre-push |
| Conformance | `compiler/tests/conformance/**/*.test.js` | **133** | `gate` (blocking) + pre-commit + pre-push |
| Browser | `compiler/tests/browser/**/*.test.js` | **94** | `gate` (BLOCKING) + `tracking` — via the NAME-SET check. ⚠ **NOT in the pre-commit set** (`.git/hooks/pre-commit:39`) |
| Commands | `compiler/tests/commands/**/*.test.js` | **14** | `tracking` only (non-blocking) |
| Parser-conformance + native-* | top-level `compiler/tests/*.test.js` | 14 | `gate` (blocking) + pre-commit (since S302) |
| LSP | `compiler/tests/lsp/**/*.test.js` | 11 | `tracking` only (non-blocking) |
| Self-host | `compiler/tests/self-host/**/*.test.js` | 4 | `tracking` only (non-blocking) |
| e2e-render-map | `compiler/tests/e2e-render-map/` | 2 | `tracking` only (non-blocking) |
| *(not a test file)* | `compiler/tests/TYPES-BASELINE.json` | — | read by `bun scripts/types-gate.ts --check` (`tracking`, non-blocking) |

**ADDED THIS WINDOW — 8 files, ZERO deleted. Every one is a merge-blocker for a SILENT-WRONG defect
(clean compile, exit 0, wrong or missing output), which is why they are integration/unit and not
browser:**

| File | Tier | What it pins |
|---|---|---|
| `integration/stdlib-client-registry.test.js` | integration | **#669, 37 cases.** §41 client stdlib registry. Loads the emitted runtime + client as TWO CLASSIC SCRIPTS IN ONE SHARED SCOPE and asserts the page is not DOA — **a grep-level assertion structurally cannot see this class**; before the fix every text-level check anyone would write PASSED while the page was dead. Four sections: §1 every registered module EXECUTES with real exports · **§1b the PARTITION (client-registered XOR escalation-server-only, no third state — this is what stops the next module hiding the way 17 did; lists DERIVED from `RUNTIME_CHUNK_ORDER` + `ESCALATION_SERVER_ONLY_MODULES`, never hand-copied)** · §2 the gate FIRES for all 8 chunkless modules + a submodule · §3 the gate does NOT over-fire on a server-fn-only use (pins the post-prune placement) · **§4 INSTRUMENT INTEGRITY — feed the harness a deliberately-DOA bundle; it MUST report it, or §1 is vacuous.** ⚑ **Authored in `browser/`, MOVED to `integration/`** because `browser/` is not in the pre-commit set. Merge-blocker proof: baseline exit 0 / sabotage exit 1 (partition test + both chunk-set pins) / restore exit 0. |
| `unit/s365-asis-unknown-split.test.js` | unit | **#665.** §7.5/§14.7 `asIs`/`unknown` split + `W-TYPE-031-UNPROVEN` + the required `UnknownType.reason`. |
| `integration/each-inline-value-form-if-interp.test.js` | integration | **#670 §17.6, 5 cases, BITE-PROVEN: 3 fail pre-fix.** A value-form `${ if c { a } else { b } }` as the SOLE content of an interp inside an `<each>` body rendered an EMPTY text node at exit 0. |
| `integration/value-form-if-empty-string-branch.test.js` | integration | **#672 §17.6.** A value-form `if` branch that is the empty-string literal `""` rendered nothing — the parser's blank-token skip ate a MEANINGFUL expression statement. |
| `integration/value-form-if-fn-condition-reactive.test.js` | integration | **#673, 4 cases, BITE-PROVEN: 2 fail pre-fix** (fn-condition + else-if cascade; plus direct-read and static non-regressions). A value-form `if` whose CONDITION is a fn call was a stale one-shot. |
| `integration/each-cross-file-imported-markup-fn-mount.test.js` | integration | **#658 §1.4/§7.4.** A cross-file IMPORTED markup fn mounts in an `<each>` interp instead of stringifying. |
| `browser/each-cross-file-imported-markup-fn-mount.browser.test.js` | browser | **#658**, the executed-DOM twin. ⚠ **Browser tier — NOT in the pre-commit set.** |
| `integration/library-mode-fn-match-object-arm-lowering.test.js` | integration | **#664 §18.** A library-mode `fn` `match` object-literal arm is a returned VALUE, not silent `undefined`. |
| `integration/trucking-dispatch-smoke-integration.test.js` | integration | Corpus smoke over `examples/23-trucking-dispatch`. |

**PRIOR WINDOW (`c93a692c` -> `c96e7012`) — 5 added + 2 reworked substantially in place, ZERO deleted:**

| File | Tier | Lines | What it pins |
|---|---|---|---|
| `unit/lint-ghost-patterns-skip-cursor.test.js` | unit | **141** | **#537 — `makeSkipCursor` == `skipPastRanges` for every non-decreasing query sequence**, pinned against SEEDED-RANDOM range sets and walks, plus the `from`-offset binary-search seek. The oracle (`skipPastRanges`) stays EXPORTED with zero src callers precisely so this pin can exist — the model for replacing a hot path: keep the contract's reference implementation and equivalence-test the fast one against it. |
| `unit/dev-compile-failure-serves-error.test.js` | unit | **212** | **#518 (adopter #517)** — while the last compile is failing, `scrml dev`'s fetch handler serves the REAL compile error at every non-infra request (HTML overlay with hot-reload for `Accept: text/html`, JSON otherwise) and resumes on success. Drives the handler through both states via the EXPORTED `noteCompileResult()` — no real compile, no server. |
| `unit/each-body-decl-unsupported-positions.test.js` | unit | **95** | **#516 §17.7.3** — `E-EACH-BODY-DECL-UNSUPPORTED` fires at ANY body position (the old guard inspected `body[0]` only) and for the full name-binding decl set incl. `lin` and `~`/`var` (`var nm = 1` at a NON-first position was SILENT — the "tilde fails loud" belief held only for the first-position case). `type-decl` stays excluded (compile-time-only). |
| `unit/issue-debt.test.js` | unit | **117** | **#536** — `issue-debt.ts`'s pure `classify()`: anchored `#<n>` mention matching (`#51` ≠ `#519`; `issues/<n>` URL counts), HOMED-GAP/-DPA/-BOTH/OWED partition, the SILENT (0-comment >2-day) flag, deterministic `--now` age. No network, no fs. |
| `integration/g-tool-import-prune-dollar-prefixed.test.js` | integration | **83** | **#515 §64** — a `$`-prefixed local imported from a `.scrml` lib SURVIVES the tool import prune (the `\b` predicate judged it dead → dropped import → runtime `ReferenceError`). Pins the shared predicate `localServerImportNameUsed` at the tool site. |
| `browser/flagship-hos-engine-under-if.browser.test.js` | browser | reworked | **#531/#534/#527/#537 — the hermeticity + budget rework** (see header): `mkdtemp` unique output dir, sorted app walk, loud compile failure, artifact LOCATION by suffix search, and the whole-app compile in a `beforeAll` with an explicit 60 s site-declared budget, run before happy-dom registers. |
| `browser/browser-todomvc.test.js` | browser | reworked | **#530** — reads the runtime file the emitted PAGE references (the `<script src>` in the html), not whatever readdir returned first; same readdir-order class as flagship-hos. |

**Prior pass — 5 added + 1 grown substantially in place, ZERO deleted:**

| File | Tier | Lines | What it pins |
|---|---|---|---|
| `unit/route-inference-derived-server-only-reach.test.js` | unit | **836** (**+459 in place**, was 379) | **#500 §6.6.19 — the POSITION AXIS, and it is the model to copy when a defect is "an enumeration missed a member".** The added §9 asserts the refusal SEPARATELY in each of six shapes (`for`-lift body · `while`-lift body · `<each>` row body · `<engine>` state-child body · loop-inside-conditional · each of those inside a `kind="tool"` program, where the §64 carve-out must hold INSTEAD). **A single "it works when nested" case would have passed against the broken walk for five of the six.** It also asserts the walk's own properties directly — termination on a shared subtree, single-visit on a node reachable by two paths — **which is why the fix had to EXPORT `collectDerivedCellDecls`**: routing those assertions through `runRI` hits `collectFileLevelBindingRoots` (`:2600`, no `seen` set) and blows the stack first. |
| `unit/request-ref-is-some-each-attr-misroute.test.js` | unit | **111** | **#511 §6.7.7** — a `<#request>.data is some` predicate in a PER-ITEM `<each>` body attribute routes to `_scrml_request_<id>`, not the §36 input-state registry. **The pre-fix failure was a SILENT MISCOMPILE** — clean compile, then `undefined.data` → runtime TypeError — so the assertion has to be on the EMITTED TEXT, not on a diagnostic. Pins the gate too: a non-request `<#id>` stays byte-identical. |
| `unit/request-ref-is-some-for-lift-attr-misroute.test.js` | unit | **115** | **#512 §6.7.7** — the same predicate in a Tier-0 `${for…lift}` ATTRIBUTE. **A separate file for what looks like the same bug, and correctly so: the failure mode is the OPPOSITE.** This path failed LOUD (`E-CODEGEN-INVALID-LOGIC`, no bundle written) because the escape-hatch node took the string fallback and mangled the `is some` LHS. Same class, two mechanisms, two files. |
| `integration/timer-poll-module-init.test.js` | integration | **125** | **#510 §6.7.5/§6.7.6/§6.7.8** — a `<timer>`/`<poll>`/`<timeout>` body does NOT run at module init, and `<poll>` DOES fire an immediate first tick. **There is no diagnostic to assert here** — the correct behaviour is an ABSENCE of an emission — so this pins emitted-artifact shape. It must also assert the two EXCLUSIONS (`<request>` and `<channel>` bodies still emit), because the fix is a deny-set and a deny-set's danger is over-inclusion. |
| `integration/g-tool-over-imports-all-lib-exports.test.js` | integration | **70** | **S339 §64** — a headless `kind="tool"` importing a local `.scrml` lib emits only the specifiers its body references. Pins a CROSS-STAGE interaction (the component-expander's helper-bind augmentation vs the tool emitter) that no type binds. |
| `conformance/conf-DERIVED-SERVER-ONLY-REACH-artifacts.test.js` | conformance | **275** | **#500 §6.6.19** — the ARTIFACT-level assertion behind the position axis: for each leaking shape, that no `.server.js` is emitted and no server-only symbol reaches the client bundle. **This is the tier that would have caught the original S337 leak**; the unit tier alone asserts the diagnostic, not the artifact. |

**Two passes back — 6 added, ZERO deleted:**

| File | Tier | Lines | What it pins |
|---|---|---|---|
| `unit/route-inference-derived-server-only-reach.test.js` | unit | **379** | **#486 §6.6.19** — `E-DERIVED-SERVER-ONLY-REACH`. The largest of the six and the one to read as a model for a **newly-rejecting** code: it pins the positive fire, the shadowing negative (a local binding of the same name does NOT fire), the string-literal negative (a name inside a `"…"` is not a reference, §12.4), the `kind="tool"` carve-out, the bare-REFERENCE form (`[@x].map(hashPassword)`, not just a call), depth (lambda body / nested fn / escape-hatch raw text), and **the prescribed fix compiling clean**. |
| `unit/match-block-arm-tail-after-block-statement.test.js` | unit | **318** | **#479 §18.5** — a block-arm tail after a `}`-terminated block statement is a VALUE. `{ let a = 0; for (…) { a = 1 } a }` used to split into TWO segments and classify VOID, so the arm evaluated to `undefined` — **a value that does not exist in scrml (§42.1.1)**, with no diagnostic. **It also pins the three gates that keep the new `}` boundary from over-firing**: an object-literal / arrow initializer (`const o = { … }`) is NOT split; `} else` / `} while` / `} catch` / `} finally` are NOT split; and a brace-continuation expression (`{ … }.a`, `{ … }[0]`, `{ … } + 1`) is NOT split. |
| `unit/g-nested-each-in-match-arm-diagnostics.test.js` | unit | **232** | **#477 §6.1.1** — read-side diagnostics fire inside an `<each>` in a `<match>` arm. The arm body was BLANKED by the ast-builder (S153 double-emit avoidance), silencing `E-STATE-UNDECLARED` for the nested read **and** for a direct read merely sharing the arm. Pins the span rebase to file-absolute coordinates at depth 2. |
| `unit/request-ref-is-some-value-bool-class-attr-misroute.test.js` | unit | **200** | **#484** — `<#request>.data is some` in `value=` / a Boolean attr / `class=` / `class:x=` routes to `_scrml_request_<id>`, not the §36 input-state registry. |
| `integration/g-server-fn-reindent-template-literal.test.js` | integration | **102** | **#474 §48** — the server-fn body reindent is template-literal-aware. A blind `code.split("\n").map(l => indent + l)` corrupted the COOKED VALUE of a multi-line template literal (the added indent becomes data, not layout). |
| `unit/state-gap-integrity.test.js` | unit | **92** | **#485** — `scripts/state.ts`'s own ledger integrity: the `@gap` attribute bag matches `[\s\S]*?` so a marker whose `prov=`/`locus=` contains a literal `>` is not TRUNCATED and silently dropped from the count; duplicate `@gap` ids are deduped for counting and **THROW LOUD on conflicting sev/status**; and heading-vs-marker status drift is DETECTED (WARN-only). **A probe's own defects are in scope for the review floor — this is the test that says so.** |

**Three passes back — 2 added, 1 DELETED:**

| File | Tier | Lines | What it pins |
|---|---|---|---|
| `unit/match-block-arm-keyword-prefixed-tail.test.js` | unit | **190** | **#463 §18.5** — a block-arm tail merely PREFIXED by a statement keyword (`formatted`/`for`, `doc`/`do`, `letter`/`let`, `constant`/`const`) is a VALUE, not a statement. Pre-fix all four silently yielded `null` with no diagnostic. **It pins BOTH consumers of `_blockTailIsValueExpr`** (structured/variant-arm AND raw/literal-arm), the `on`-prefixed NO-CHANGE anchor (the one keyword that always had a fence), **the `$`-continuation anchors** (`do$…`, `on$…` — the reason the fence is `(?![A-Za-z0-9_$])` and not `\b`), and **the opposite direction**: a block whose last segment IS an assignment statement still produces void. |
| `browser/g-each-shorthand-rcdata-parent.browser.test.js` | browser | **295** | **#466 §4.14/§17.7.6** — a `:`-shorthand `<each>` body inside an RCDATA parent (`<textarea>`) must not receive a mounted element child. Browser-tier runtime assertion, paired with three conformance cases. |
| ~~`unit/show-false-ssr-hidden-no-fouc.test.js`~~ | unit | ~~197~~ | **DELETED at #464 with the code it tested.** It asserted a `display:none` the compiler no longer emits. **The disposition is the lesson: a test whose subject is REVERTED is deleted, not skipped** — a skipped test is a claim held in abeyance, and there is no abeyance here. Its replacement asserts the opposite (`ctrl-017..ctrl-020`, below). |

**Prior pass, retained for reference — the 4 files added at `97576f35`:**

| File | Tier | Lines | What it pins |
|---|---|---|---|
| `unit/mangler-region-fencing.test.js` | unit | **674** | #458 — all three mangler defects, in FIVE labelled sections, and it is the model to copy. **§1 EXECUTES the shipped `--embed-runtime` bundle** (`_scrml_replay` is invoked; pre-fence it was a `ReferenceError` on `log`) rather than grepping for a marker — the S265 execute-don't-grep rule applied to a codegen fix. **§2a tests the CLASSIFIER directly**, including that a `binding-pattern` is RECOGNISED and deliberately NOT acted on. **§2c is a NEGATIVE DEPENDENCY test** — the cross-file module-registry footer must stay `{publicName: emittedName}` and the importer's destructure verbatim. **§2f is a RESIDUAL MAP**: the shapes the fix does NOT reach (nested groups, spread, mixed `{get, post, n: 1}`, the ternary ALTERNATE) are pinned as failing-by-design in the SUITE, not merely described in prose — so the residual cannot silently drift. §2e pins the `__proto__` B.3.1 shape-preservation refusal. §3 asserts the `registerFnName` drop directly, satisfying invariant 27. |
| `integration/authed-server-fn-response-http.test.js` | integration | **764** | #452 — every server-fn route handler terminates in a `Response`, asserted **over real HTTP against a real server**, not against emitted text. Six describe blocks: `auth="required"` (including a VOID no-`return` body), `protect=` without an explicit `auth=` (**and it proves the predicate is WIDER than `auth=`** — the app has no source-level `auth=` yet still carries an auth gate), both gates together, a **no-auth CONTROL asserting the `useBaselineCsrf` path is UNCHANGED** including its double-submit `Set-Cookie`, session establishment (the sid cookie survives the envelope — the silent-drop this fix also closed), and the body-built-`Response` passthrough. That last block is exemplary: it asserts the guard is emitted AHEAD of the envelope **and** EXECUTES to prove a body's 403 is not re-emitted as 200. It also pins ORDER — "the protect= egress redact runs BEFORE serialization, never after". **CORRECTION (S355, `a7e99e8f` / #590):** this row previously said the block "pins the upstream `E-SCOPE-001` build-block" — that pin was FLIPPED in the same commit that allowlisted `Response`/`Request`/`Headers` (`type-system.ts:7290`, adopter #471). The block now asserts the shape compiles clean and the passthrough guard is LOAD-BEARING, not that it is unreachable. |
| ~~`unit/show-false-ssr-hidden-no-fouc.test.js`~~ | unit | ~~197~~ | **GONE — deleted at #464.** It pinned the #450 `show=`-false `display:none` injection; **that behaviour was reverted in full and this file no longer exists.** Do not resurrect it from this row. |
| `browser/g-each-shorthand-markup-fn-mount.browser.test.js` | browser | 152 | #456 — a `:`-shorthand `<each>` body whose child is a markup-returning fn call MOUNTS per row, asserted in the browser tier at runtime. |

**⚠ A STANDING TESTING LESSON (S326 window, #452 — a repeat of the S276 shape); read it before you
"preserve" an existing assertion.** #452's landing corrected **20 tolerate-or-assert-bare test sites
across 6 files** (`integration/auth-csrf-synchronizer-token.test.js`,
`integration/csrf-canonical-delivery.test.js`, `integration/session-establishment-roundtrip.test.js`,
`integration/session-secure-b4b5-roundtrip.test.js`, `unit/session-context-gate-b2b3.test.js`,
`unit/session-establishment.test.js`). Those sites were not neutral — **they encoded the defect as
expected behaviour, because the oracle shared the implementation's blind spot.** A green suite over
them was evidence of nothing. When a fix requires editing existing assertions, that is a signal to
check whether the assertions were ever right, not a signal to minimise the diff.

**`compiler/tests/browser/FAILURE-BASELINE.json` is unchanged AGAIN this window, and that is a CLAIM,
not an omission** — the flagship-hos rework and the todomvc fix changed HOW two browser tests obtain
their subject, not whether they pass, so the failure NAME SET did not move. (The flagship-hos name's
intermittent cloud JOINS were the #537 timeout, not a set change — see the header.)

Carried from the prior pass, still true: `unit/error-handler-const-bind-r25-bug-49.test.js` and
`integration/nested-error-handler-no-invalid-js.test.js` have an incidental blanket
`errors.toHaveLength(0)` **NARROWED to exclude exactly one code** — the known-false-positive
`E-ASYNC-STDLIB-IN-SYNC-CALLBACK` firing described in error.map.md. Every subject assertion is
untouched, and any OTHER new diagnostic still fails them.

The top-level `conformance/` corpus sits at **883** cases at `c93a692c` (`docs/FACTS.md` is the
authority; FLAT this window — zero cases added or removed). The S331-window +15 and the S341-window
+3 below are retained as reading material on case-authoring shape, not as current deltas. **54 category directories, unchanged — `derived/` is
NOT new** (it dates to the S231 D3 suite, `e86a76d0`; only three cases were added into it).
**The fifteen split as SEVEN negative, five positive-fire, three fidelity:**

| case | count | what it is |
|---|---|---|
| `sql/prepare-{server-fn,cps-return,pattern-c-cell,sse-generator,ws-onserver}-e-sql-006-neg` | 5 | **the #476 emit-path matrix, all NEGATIVE.** One per server-fn emit path, each asserting the `.prepare()` does NOT reach the artifact. **The matrix IS the fix**: the bug was a sink drained on one path and not the others, so a single case would have proved nothing. |
| `derived/e-derived-server-only-reach-pos` | 1 | **the #486 positive fire** — `codes: ["E-DERIVED-SERVER-ONLY-REACH"]` **plus `notCodes: ["E-ROUTE-005","E-ROUTE-002"]`**, discriminating it from the two codes a reader would most likely confuse it with (E-ROUTE-005 is the unplaceable single-FUNCTION shape and additionally needs a client-only DOM global). |
| `derived/e-derived-server-only-reach-neg` | 1 | the boundary — a derived RHS that does NOT reach an escalation server-only binding stays clean. |
| `derived/e-derived-server-only-reach-fn-path` | 1 | **the diagnostic's OWN prescribed fix, asserted to compile clean.** Move the call into a `function`, write the result to a plain cell. **A newly-rejecting code without a case proving its escape hatch works has shipped a dead end.** |
| `match-block/block-arm-tail-after-block-statement` | 1 | #479 — the `}`-as-separator fix (see the unit test row above). |
| `match-block/block-arm-nested-assignment-fidelity` | 1 | #479 — a nested assignment inside a block arm keeps its `opts`; no shadowing `const`, no TDZ self-reference. |
| `match-block/value-form-block-arm-all-paths` · `value-form-block-arm-derived-reactive` · `member-assign-tail-voids-all-paths` | 3 | **#469/#470 — the ALL-PATHS trio, and the reason the §18.5 four-route table exists.** `member-assign-tail-voids-all-paths` is the one to read: a member/index-assignment tail formerly LIFTED on the raw path and VOIDED on the structured path — **two routes disagreeing about the same source** — and the case asserts all paths now agree on void. |
| `lifecycle/request-data-is-some-value-bool-class-attr-rt` | 1 | #484, an **`-rt` case, so it EXECUTES** — the mis-route was a runtime `TypeError`, not a compile error, so a compile-only case could not have caught it. |
| `type-state-codes/e-state-undeclared-nested-each-in-match-arm-pos` | 1 | #477 — `E-STATE-UNDECLARED` fires inside an `<each>` in a `<match>` arm. |

**Prior window's eight, retained — the split that made the "not eight of a kind" point:**

| case | count | what it is |
|---|---|---|
| `match-block/value-decl-block-arm-keyword-prefixed-tail` | 1 | **a FIX pin** (#463) — nine `domAnchored` anchors covering both classifier consumers, the `on` no-change anchor, both `$`-continuation anchors, and the statement-tail void direction |
| `control-flow/ctrl-017..ctrl-020` | 4 | **REGRESSION GUARDS FOR A REVERT** (#464) — each asserts `count: 0` for `[style*="display:none"]` and `[style*="display: none"]`. `ctrl-017` variant-render · `ctrl-018` module-init write fail-open · `ctrl-019` spelling parity · `ctrl-020` no duplicate `style` |
| `each/shorthand-restricted-textarea` | 1 | **the #466 merge-blocker** — a `:`-shorthand body calling a MIXED-return fn inside `<textarea>`; asserts `textarea *` count 0 and `value: "alpha"` |
| `each/shorthand-longhand-parity-rcdata` | 1 | **the §4.14 byte-identity contract stated as a RUNTIME case** — the same body written FOUR ways (shorthand/bare × mixed-return-call/member-expr), all four required to agree on DOM shape |
| `each/shorthand-option-label-preserved` | 1 | **a COUNTER-GATE, and the most instructive of the eight.** It exists to FAIL if anyone re-widens the RCDATA mount refusal to `<option>` — the first #466 attempt did exactly that and replaced a correct label with `"[object HTMLElement]"`. **A case whose job is to block a plausible future "fix" is worth more than one that pins the current behaviour.** |

**Pattern worth copying: four of these eight pin the ABSENCE of behaviour.** `ctrl-017..ctrl-020`
were authored as part of a REVERT, not a feature. When you back something out, the corpus is where
you record that the back-out was intentional — otherwise the next agent reads the missing emission as
a gap and re-lands it.


## THE CONFORMANCE `expect` VOCABULARY IS NOW A DECLARED TABLE (NEW #652, `conformance/run.ts:179`)

Before this window the `expect` block's key set was implicit — a typo'd container name was silently ignored and the case passed while asserting nothing. `EXPECT_SHAPES` makes the whole vocabulary enumerable and `validateExpectContainers(ex)` refuses anything outside it, naming the known keys in the diagnostic.

| key | kind | empty | half |
|---|---|---|---|
| `codes` | stringArray | — | (a) codes |
| `notCodes` | stringArray | — | (a) codes |
| `notCodePrefixes` | stringArray | — | (a) codes |
| `severity` | record, values `error`/`warning`/`info` | **reject** | (a) codes |
| `codeCounts` | record | **reject** | (a) codes |
| `input` | objectArray | — | (b) runtime |
| `dom` | string | — | (b) runtime |
| `domAnchored` | objectArray | — | (b) runtime |
| `state` | record | **reject** | (b) runtime |
| `serverStub` | record | **allow** | (b) runtime — a MOCK TABLE, not an assertion |
| `serverDb` | record | **allow** | (b) runtime — a SEED, not an assertion |
| `sqlEngine` | enum `stub` \| `real` | — | (b) runtime |
| `ssr` | boolean | — | (b) runtime |
| `firstPaint` | record | **reject** | (b) runtime |
| `stdout` | string | — | (b) runtime |

**The `empty` column is the load-bearing one.** An empty `{}` is REJECTED for every container that is an ASSERTION (`severity`, `codeCounts`, `state`, `firstPaint`) — an empty assertion asserts nothing and reads green. It is ALLOWED only for `serverStub` and `serverDb`, which are inputs (a mock table and a seed), where empty is a meaningful value.

**`validateExpectContainers` is EXPORTED and is driven directly by `compiler/tests/conformance/expect-container-policy.test.js`** (NEW, 316 lines). The reason is written at the export site and is the window's generalisable rule: *a validator that can only be reached by running the whole corpus is indistinguishable from one that never fires.* Called from the case runner at `run.ts:418`.

⚠ **Related, and it is the standing trap when auditing conformance coverage: a grep-match for an E-code inside a case directory is NOT proof the case asserts it.** The hit may be rationale PROSE. Read the `expected.json` and confirm the code appears in a `codes` / `notCodes` container before recording "already covered".

## INSTRUMENT INTEGRITY — the `bracketed !== parsed` refusal (NEW #646/#652)

**Five gates were reporting green while measuring nothing** (#646). The fix pattern is worth copying into any new probe that parses a population out of a text file:

- `scripts/delta-lint.ts` (NEW this window) counts `[NNNN]`-bracketed lines in the live scope and separately counts regex matches. **`refuseUnparsedEntries()` / `refuseDegenerateScope()` exit 2 if the two disagree, or if the scope is empty.**
- `scripts/state.ts` gained the same guard — `refuseUnparsedDeltaEntries()` (`:706`), called from `runWrite` (`:352`), `runCheck` (`:454`) and `runDigest` (`:803`); `parseDeltaLog` (`:659`) returns `bracketed`, `unparsed` and `scopeStart` so the diagnostic can print REAL file line numbers.
- **Exit codes are partitioned on purpose: 1 = "the log is wrong", 2 = "the instrument is broken".** Neither is reachable as a PASS.
- **What made it necessary:** the shared entry shape was `[NNNN] <kind> · <body>` (three tokens) while the writing convention had drifted to `[NNNN] <emoji> <kind> · <body>` (four). The narrow regex could not parse the four-token form, so four live entries (`[561] [562] [565] [727]`) were invisible to the gate AND to the digest. The regex now carries an OPTIONAL marker token (`delta-lint.ts:72`).
- **Pre-existing debt is BASELINED, not enforced** — `handOffs/delta-log-dupes.baseline.json` carries nine known collisions so the gate is not instantly red for reasons no change caused; only a NEW duplicate fails. The baseline may shrink and must never grow silently.
- **The companion is `.gitattributes` `merge=union` on the delta log.** It trades a merge conflict for a duplicate, which is only the right trade because this gate is loud about duplicates. **The two land together; neither is sufficient alone.**
- **Deliberately NOT a monotonicity check** — under union-merge two sessions' entries interleave by content, not by number. Enforcing order would fail every honest concurrent merge.

## WHICH RUNTIME EACH TIER ACTUALLY EXECUTES — read this before believing a green runtime half

⚑ **NEW S371-bryan, PA-MEASURED AT THIS WATERMARK. EXECUTING `SCRML_RUNTIME` IS NOT TESTING WHAT
SHIPS.**

There are TWO different runtime artifacts and they are not interchangeable:

| artifact | what it is | who loads it |
|---|---|---|
| `SCRML_RUNTIME` (`compiler/src/runtime-template.js:547`) | the MONOLITHIC template string — every chunk, always | **nothing in production** |
| `scrml-runtime.<hash>.js` | the PRUNED per-app assembly — `assembleRuntime(chunkNames)` (`codegen/runtime-chunks.ts:541`) over `RUNTIME_CHUNKS` (`:467`), chunk set chosen by `detectRuntimeChunks` (`codegen/emit-client.ts:828`) | **the browser, always** |

**Tier-by-tier, measured (not inferred):**

| tier | what it executes | can it catch a chunk-pruning defect? |
|---|---|---|
| **conformance (b) half** — `conformance/adapters/impl1-ts.ts:467` and `:924` | `"(function () {\n" + SCRML_RUNTIME + "\n" + clientJs + …` — the FULL monolith | **NO. All 883 cases, by construction.** |
| **browser tier** — 94 files in `compiler/tests/browser/` | **SPLIT: 25 import `SCRML_RUNTIME`; 66 read `result.runtimeFilename` (the emitted pruned artifact); 2 do both; 5 neither** | **only the 66** |

**THE PROOF IS A SHIPPED CONFORMANCE CASE, NOT A HYPOTHETICAL.**
`conformance/cases/each/ternary-markup-giti033` compiles exit 0 and PASSES its own suite. Its
`page.client.js` contains BARE calls to `_scrml_each_clear` (`:31`, `:101`, `:159`) and
`_scrml_resolve_item` (`:46`, `:54`, `:66`, …) — both defined in the **`reconciliation`** chunk,
which is **not in the emitted runtime** for that file. First each render → `ReferenceError` → dead
page. Reproduced by compiling the case standalone and diffing the client's `_scrml_*` reference set
against the emitted runtime.

⚑ **A SYMBOL DIFF ALONE OVER-REPORTS — READ THE CALL SITE.** Two further symbols are also absent from
the pruned runtime, `_scrml_register_rehydrator` (`:213`) and `_scrml_chunk_loading` (`:220`, both
`utilities`), **and both are `typeof`-guarded at their call sites, so they are HARMLESS.** Only the
two BARE-CALL `reconciliation` symbols kill the page. A probe that counts unresolved names without
reading the call site reports 4 defects where there is 1.

**HOW TO ACTUALLY VERIFY A CLIENT-RUNTIME FEATURE** (the S265 theme-switch lesson, extended):
1. Compile the target to a real `dist/`.
2. Execute **the emitted `scrml-runtime.<hash>.js`**, not the template.
3. Assert on observed DOM/behaviour, not on the presence of a marker in emitted text.

**And when you write the claim down, name which runtime you ran.** "The runtime executed it" is not
a result — it is ambiguous between the two artifacts above, and the ambiguity has already shipped a
dead page past a green suite. primary.map.md invariant 67.

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
`gate` (blocking, **13 steps** — `bun scripts/delta-lint.ts` added #652): unit + conformance + the root-level `*.test.js` (**where the parser-conformance canary is actually gated**) + the TodoMVC
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
conformance/cases/ + conformance/adapters/ — the D3 corpus (**883 cases** at `c93a692c`, FLAT this window; re-derived by `find conformance/cases -name expected.json | wc -l`, which is exactly `facts.ts`'s own definition, and `docs/FACTS.md` is the authority) + per-impl adapters. **The prior window's +3 (`each/each-body-decl-unsupported-pos`, `ssr/i-ssr-each-client-rendered-subset-pos`, `derived/e-derived-server-only-reach-nested-loop`) are landed and carried.**
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
`bun scripts/browser-baseline.ts` and diff NAMES**, which is the comparison a human was doing by hand —
**and READ the reason excerpt it prints beside each new name (#537): `took N ms` + `^ this test timed
out after 5000ms.` means a TIMEOUT, not an assertion failure, and the two wear the same `(fail)`
marker.**

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
#scrml #map #test #which-runtime-executed #scrml-runtime-vs-template #chunk-pruning #conformance-blind-spot #ternary-markup-giti033 #reconciliation-chunk #types-baseline #stdlib-client-registry #instrument-integrity #test-tier-vs-merge-gate #bite-proof #recursive-recount #bun-test #happy-dom #playwright #conformance #ci-gate #browser-baseline #failure-name-set #bidirectional-baseline #failure-baseline-json #skipped-step-behind-red-step #gate-topology #gate-hole #non-blocking-tier #documented-failure-baseline #cry-wolf #s34-census #expect-codes-only #pin-vs-mention #runtime-surfaced #e-mw-006-dead #e-channel-inside-page #execute-dont-grep #vacuous-test-skip #generated-test-artifact #property-tests #§51.13 #engine-audit #route-region #§20.8.8 #shell-timer-non-regression #migrate-codemod #fail-closed-codemod #rt-suffix #mounts-absent-pairs #not-codes-discrimination #structural-if #§17.1.2 #lint-diagnostics-stream #dbauth #live-pg-skip-graceful #cloud-ci-http-flaky #snippet-gate #facts-gate #spec-index-gate #§34.0 #gap-marker-parser #proven-gate #new-ref-push-skip #changelog-dereferenced #facts-md-authority #e-fn-equals-body #reparse-swallowed-errors #subparse-span-rebase #match-arm-autoawait #crossmodule-async-markup #conformance-855 #cps-choke-point-landed #w-if-in-each #corpus-emit-differential #corpus-check-goggles #pre-land-gate #codegen-task-shape #dual-goggle #node-check-blind-to-tla #bun-vm-script-blind #truncated-probe #hard-req-markers #1878-sources #7254-artifacts #exit-code-2-invalid-comparison #self-retiring-guard #async-name-provider #u1-browser-runtime-test #execute-dont-grep #failure-baseline-unchanged-is-a-claim #narrowed-blanket-assertion #reset-init-thunk-reassignment #each-nested-if-not-reactive #mangler-region-fencing #execute-dont-grep #residual-map-in-suite #negative-dependency-test #authed-server-fn-response-http #real-http-assertion #oracle-shared-the-blind-spot #s276-shape #tolerate-or-assert-bare #show-false-ssr-REVERTED #ctrl-017-020-revert-guard #counter-gate-case #test-deleted-with-reverted-code #keyword-prefixed-tail #rcdata-restricted-parent #880-conformance #1334-tests #neg-case-is-the-assertion #escape-hatch-case #prescribed-fix-compiles-clean #emit-path-matrix #e-sql-006-neg-matrix #all-paths-trio #member-assign-tail-voids #two-routes-disagreeing #§18.5-four-routes #expected-json-is-the-assertion #rationale-prose-is-not #derived-dir-not-new #probe-defects-in-scope #state-gap-integrity #1339-tests #883-conformance #position-axis #enumeration-missed-a-member #export-for-testability #cannot-isolate-the-subject #collect-file-level-binding-roots-no-seen-set #same-class-opposite-failure-modes #silent-miscompile-vs-fail-loud #assert-emitted-text-not-a-diagnostic #absence-of-emission-has-no-code #deny-set-danger-is-over-inclusion #artifact-tier-catches-the-leak #facts-counts-only-test-js #1361-is-not-a-contradiction #conformance-tier-vs-conformance-cases #read-the-expected-json #notcodeprefixes #1378-tests #expect-shapes #validate-expect-containers #expect-vocabulary #empty-assertion-rejected #serverstub-is-input #instrument-integrity #bracketed-vs-parsed #refuse-unparsed-entries #refuse-degenerate-scope #exit-2-instrument-broken #delta-lint #delta-log-baseline #merge-union-gitattributes #optional-marker-token #grep-match-is-not-assertion #invariant-56-timeout

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
