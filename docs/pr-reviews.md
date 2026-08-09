# PR review ledger — the S239 adversarial floor, made measurable

**What this is.** One machine-readable marker per MERGED PR recording that the S239 adversarial pass
ran, what it probed, and what it found. Parsed by `bun scripts/review-debt.ts`; **the marker is the
record — prose here is commentary and is never parsed.**

**Why it exists (S316).** The review floor (S313 — *"if it isnt us that makes the changes, we should
at least do a thorough review on it"*) had a **0% execution rate the day after it was ratified**:
eight PRs merged in one day, zero reviews on all eight, and it surfaced only because bryan asked
"have we looked at Peter's PRs?". The cause was structural, not a lapse — boot reads `gh pr list`
(**open** PRs), the floor binds **merged** ones, and nothing computed the difference. The obligation
was invisible to the session that incurred it and to every session after. Same shape as the S262
`gh issue list` miss: a channel the contract names but no probe reads.

**Marker form** — append one line per PR, newest at the top of the log section:

```
<!-- @review pr=<n> verdict=clean|finding|carve-out by=S<N>-<who> date=<YYYY-MM-DD> probe=<what-was-probed> [note=<slug>] -->
```

- `clean` — pass run, nothing found.
- `finding` — pass run, something found. `note=` names it; the detail belongs in `docs/known-gaps.md`.
- `carve-out` — pure docs / spec-text / config with no code path (pa-base §8 carve-out). **Recorded
  anyway**, so the skip rate stays measurable — a floor whose carve-out rate approaches 100% is
  decorative (§8, the absorbed escape hatch).

**This is DETECTION, not a control.** It never blocks a merge, and it is deliberately **not** wired
into CI: a gate instantly red over an existing backlog is the §8 cry-wolf shape that gets bypassed
and then deleted. It runs at boot and reports; the PA states the number.

**Epoch.** The floor binds **PR #385 and later** (`REVIEW_FLOOR_EPOCH` in the script). Earlier PRs
predate the rule and are out of scope by construction rather than by exemption.

---


## S328 measurement — the carve-out-rate alarm is ANSWERED (it was UNPROVEN since S319)

`scripts/review-debt.ts` prints its carve-out rate over **ALL** merged PRs and warns at a high rate.
`pa-scrml-overlay` has flagged that figure **UNPROVEN — neither healthy nor evaded** since S319,
because the all-PR denominator cannot distinguish a docs-heavy stretch from a floor being evaded, and
recommended (but did not build) computing the rate over **code-bearing PRs only**. Measured at S328:

| population (PR >= 385, verdict recorded) | PRs | carve-outs | rate |
|---|---|---|---|
| **code-bearing** (diff touches `compiler/` · `stdlib/` · `scripts/` · `conformance/cases/`) | **28** | **1** | **4%** |
| docs-only | 48 | 45 | 94% |

**Verdict: the high all-PR rate is a DOCS-VOLUME artifact, not evasion.** The health signal is ~0%.

**The single code-bearing carve-out is #397 — and it is `scripts/review-debt.ts` itself.** The floor's
own measuring instrument shipped inside a wrap-continuity PR and was carved out as
`own-wrap-continuity-docs-only`. It was separately bite-proven both ways at S316, so this is not a
missed review in substance — but it is worth naming that **the one thing exempted from the floor was
the tool that measures the floor.**

**Read the all-PR figure as a VOLUME statistic, not a health signal.** If the code-bearing rate ever
leaves single digits, that is the number to act on.

*Two probe defects were made and corrected while producing this table, both the same class this repo
keeps hitting: `verdict=(\w+)` truncated `carve-out` to `carve` (hyphen is not `\w`), reporting ZERO
carve-outs in both buckets — caught only because it contradicted `review-debt`'s own 24/40; and a
`head -14` on a 13-file PR listing hid the very file that made #397 code-bearing. A well-formed answer
to a question nobody asked, twice, inside the measurement built to check for exactly that.*

## Log

<!-- @review pr=466 verdict=finding by=S328-bryan date=2026-08-07 probe=full-S239-pass-against-a-FROZEN-sha-returned-DO-NOT-LAND-then-a-fix-round-then-PA-verification-by-compilation-option-mount-span-preserved-and-byte-identical-to-main-textarea-lowered-to-value-with-no-element-child-conformance-865-865-differential-2-of-7290-both-textarea-migration-measured-160-restricted-parent-openers-zero-using-shorthand note=the-pass-CHECKED-THE-AGENTS-OWN-DEFENCE-and-it-SPLIT-extends-a-shipped-ruling-6nz-F4-is-TRUE-for-textarea-and-FALSE-for-option-whose-longhand-never-stringified-so-the-first-cut-traded-a-correct-label-for-object-HTMLElement-plus-the-ONE-DECISION-claim-was-false-in-both-directions-four-follow-ups-filed-as-gaps -->
<!-- @review pr=465 verdict=carve-out by=S328-bryan date=2026-08-07 probe=own-docs-only-pr-reviews-ledger-plus-one-BRIEF-DONE-PROBE-line-no-code-path-file-set-enumerated -->
<!-- @review pr=464 verdict=clean by=S328-bryan date=2026-08-07 probe=own-revert-verified-EXACT-git-diff-71623be3-origin-main-emit-html-ts-EMPTY-both-surviving-display-none-hits-are-pre-existing-COMMENTS-present-at-450s-parent+four-preserved-guards-RE-RAN-post-revert-and-ctrl-019-and-ctrl-020-FAILED-because-they-asserted-positive-display-none-so-they-were-rewritten-to-assert-absence-with-a-positive-render-anchor-and-BITE-PROVEN-corrupt-notContains-red-restore-green+conformance-862-862 note=verified-the-guards-transferred-instead-of-assuming-half-of-them-did-not -->
<!-- @review pr=463 verdict=clean by=S328-bryan date=2026-08-07 probe=own-fix-adversarial-pass-probed-the-FULL-reclassified-set-all-13-keywords+on-non-regression+real-do-while-if-for-while-switch-statement-tails+keyword-prefixed-calls+case-sensitivity+digit-underscore-and-dollar-continuations+nested-and-multi-statement-blocks+object-literal-and-empty-arms-corpus-emit-differential-0-content-diffs-1008-sources-3881-artifacts-conformance-858-858-migration-MEASURED-76-block-arms-zero-affected note=the-pass-found-a-REAL-hole-in-my-own-fix-b-is-defined-against-w-which-excludes-dollar-while-scrml-isIdentPart-includes-it-so-do-dollar-thing-still-yielded-null-fixed-at-the-root-pre-land-and-pinned -->
<!-- @review pr=461 verdict=carve-out by=S328-bryan date=2026-08-07 probe=file-set-enumerated-known-gaps+handoff+deltalog-docs-only-no-code-path-the-post-commit-hook-finding -->
<!-- @review pr=460 verdict=finding by=S328-bryan date=2026-08-07 probe=SPEC-text-NOT-a-plain-carve-out-because-it-lands-a-normative-SHALL-12.5.3-read-the-diff-in-full-the-observable-wire-framing-is-CORRECT-and-refuses-to-write-Bun-Response-into-the-LANGUAGE-spec-per-S278-and-the-Rule-4b-provenance-honestly-records-the-undeliberated-band note=lands-a-normative-SHALL-with-ZERO-conformance-cases-against-the-projects-own-merge-blocker-rule-AND-against-the-PRs-own-argument-that-the-wire-framing-exists-precisely-so-a-case-can-pin-it -->
<!-- @review pr=459 verdict=carve-out by=S328-bryan date=2026-08-07 probe=file-set-enumerated-eleven-claude-maps-files-only-wrap-6c-maps-refresh-no-code-path -->
<!-- @review pr=457 verdict=carve-out by=S328-bryan date=2026-08-07 probe=file-set-enumerated-changelog+handoff+deltalog-only-S327-peter-wrap-continuity-no-code-path -->
<!-- @review pr=456 verdict=finding by=S328-bryan date=2026-08-07 probe=S239-pass-plus-PA-reproduction-compiled-and-inspected-emitted-JS-confirmed-scrml-el-2-appendChild-scrml-each-mv-3-puts-a-mount-span-INSIDE-a-textarea-whose-value-is-its-child-TEXT-content-so-textarea-value-is-empty-string-and-adopter-text-vanishes-happy-dom-masked-it-because-its-value-getter-falls-back-to-textContent note=g-each-shorthand-restricted-parent-silent-data-loss-plus-undeclared-newly-accepting-lowering-change-plus-a-SPEC-contradicted-rationale-now-durable-in-three-places-fix-in-flight -->
<!-- @review pr=451 verdict=carve-out by=S328-bryan date=2026-08-07 probe=file-set-enumerated-changelog+handoff+deltalog-only-S325-peter-wrap-continuity-no-code-path -->
<!-- @review pr=450 verdict=finding by=S328-bryan date=2026-08-07 probe=S239-pass-differential-harness-reverted-only-emit-html-ts-to-b6d77ec-parent-compiled-14-reproducers-through-BOTH-compilers-executed-in-happy-dom-AND-real-Chromium-with-javaScriptEnabled-false-for-the-pre-hydration-paint-confidentiality-checked-FIRST-and-CLEAN-payload-unchanged-md5-of-style-stripped-html-identical note=FIVE-findings-silent-no-op-duplicate-style-attribute-plus-wrong-hide-from-module-init-writes-plus-fail-open-to-fail-closed-dead-UI-inside-engine-match-plus-spelling-divergence-plus-a-FALSE-SPEC-citation-11388-11389-are-the-section-header-and-a-blank-line-REVERTED-by-operator-ruling-in-464 -->
<!-- @review pr=448 verdict=carve-out by=S328-bryan date=2026-08-07 probe=file-set-enumerated-known-gaps-only-MED-lane-triage-sweep-no-code-path -->
<!-- @review pr=447 verdict=finding by=S328-bryan date=2026-08-07 probe=S239-pass-plus-PA-reproduction-compiled-two-arms-differing-ONLY-by-identifier-name-good-shade-returns-alpha-bad-formatted-returns-null-plus-independently-reproduced-the-derived-cell-path-where-BOTH-arms-emit-with-no-return note=FOUR-findings-the-keyword-boundary-was-INSIDE-the-alternation-fencing-only-on-so-formatted-matched-for-a-loud-to-silent-REGRESSION-fixed-in-463-plus-the-fix-covers-only-1-of-5-value-position-paths-plus-empty-arm-yields-object-not-void-with-the-authors-own-void-handler-unreachable -->

<!-- @review pr=442 verdict=finding by=S322-bryan date=2026-08-06 probe=THREE-adversarial-rounds-TWO-do-not-lands-round1-the-mitigation-blinded-the-drain-to-EVERY-block-error-arm-55-arms-in-17-files-incl-stdlib-auth-jwt-newly-accepting-and-undeclared-round2-rescoped-still-wrong-because-the-gate-is-ARM-granular-while-the-hazard-is-SITE-granular-worst-case-a-library-nested-arm-at-an-AWAITABLE-position-emitted-safeCallAsync-bare-so-the-error-arm-could-never-run-round3-measured-the-false-positive-population-FIRST-at-0-of-1878-and-REMOVED-the-mitigation-entirely-final-1878-sources-7254-artifacts-0-content-diffs-syntax-delta-0-under-all-three-goggles-bare-sites-142-to-142 note=limb1-unification-cleared-in-round-1-and-never-moved-what-failed-twice-was-a-mitigation-for-a-false-positive-the-change-itself-created -->
<!-- @review pr=441 verdict=carve-out by=S322-bryan date=2026-08-06 probe=docs-only-changelog-pr-reviews-handoff-deltalog-no-code-path-peters-S324-wrap-continuity -->
<!-- @review pr=436 verdict=carve-out by=S322-bryan date=2026-08-06 probe=docs-only-scoping-and-deltalog-no-code-path-own-async-subtraction-scope-plus-the-option-C-retirement-record -->
<!-- @review pr=440 verdict=clean by=S324-peter date=2026-08-06 probe=execution-500-to-200-both-bugs+conformance-1443-0-fix-vs-prefix-fresh-process+store-invariant-probe-readonly-currentUser-stays-Map-not-durable+no-double-binding+zero-diagnostic-minted note=needsSessionInfra-widening-came-through-clean-unlike-the-357-vector-gap1-conformance-restoration-52.15.1 -->
<!-- @review pr=439 verdict=carve-out by=S324-peter date=2026-08-06 probe=docs-only-own-S323-wrap-handoff+changelog+deltalog-no-code-path -->
<!-- @review pr=438 verdict=carve-out by=S324-peter date=2026-08-06 probe=file-list-diff-docs-only-brief-archival-no-code-path -->
<!-- @review pr=437 verdict=carve-out by=S324-peter date=2026-08-06 probe=docs-only-own-S323-review-floor-drain-single-file-pr-reviews -->
<!-- @review pr=435 verdict=finding by=S323-peter date=2026-08-05 probe=fix-vs-prefix-conformance+executed-handler note=caught-E-SESSION-CONTEXT-scan-widening-regression-CONF-SESSION-STORE-PROGRAM-UNIFY-trimmed-pre-merge+2-findings-routed-bryan-csrf-read-disclosure-and-sound-scan -->
<!-- @review pr=434 verdict=carve-out by=S323-peter date=2026-08-05 probe=docs-only-continuity -->
<!-- @review pr=433 verdict=carve-out by=S323-peter date=2026-08-05 probe=docs-only-continuity -->
<!-- @review pr=432 verdict=carve-out by=S323-peter date=2026-08-05 probe=docs-only-continuity -->
<!-- @review pr=431 verdict=carve-out by=S323-peter date=2026-08-05 probe=docs-only-continuity -->
<!-- @review pr=430 verdict=carve-out by=S322-bryan date=2026-08-05 probe=own-review-floor-drain-docs-only-single-file-pr-reviews-md-no-code-path -->
<!-- @review pr=429 verdict=finding by=S322-bryan date=2026-08-05 probe=S239-across-3-fix-rounds-8-findings-one-build-breaking-all-fixed-plus-2-independent-post-hoc-lenses-then-wide-corpus-re-measure-on-the-REBASED-tree-1878-sources-7254-artifacts-syntax-delta-0-under-effective-script-AND-module-goggles-artifact-diffs-2-of-7254-both-on-sources-that-fail-to-compile-on-every-revision note=u1-emitcall-root-fix-lands-not-claiming-the-bug-class -->
<!-- @review pr=428 verdict=finding by=S322-bryan date=2026-08-05 probe=two-independent-adversarial-lenses-hollow-gate-and-arithmetic-found-9-defects-in-the-gate-itself-incl-node-check-blind-to-top-level-await-and-no-vacuity-floor-on-the-syntax-half-ALL-routed-back-as-a-fix-round-and-re-proven-PA-re-executed-the-H1-goggle-bite-and-the-bun-vs-node-vm-Script-divergence-rather-than-inheriting-them note=the-gate-built-to-kill-hollow-gates-shipped-hollow-and-the-floor-caught-it -->
<!-- @review pr=427 verdict=carve-out by=S322-bryan date=2026-08-05 probe=docs-only-changelog-handoff-deltalog-no-code-path-peters-wrap-continuity -->
<!-- @review pr=426 verdict=carve-out by=S322-bryan date=2026-08-05 probe=docs-only-BRIEF-and-gap-banner-SUBSTANTIATED-the-newly-accepting-code-VERIFIED-NOT-on-main-ba72eaa0-is-not-an-ancestor-and-lives-only-on-origin-feat-onmount-c-build note=deferral-recorded-without-landing-the-surface-change -->
<!-- @review pr=425 verdict=carve-out by=S322-bryan date=2026-08-05 probe=docs-only-single-file-pr-reviews-md-peters-independent-drain-of-419-420-421-422-which-collided-with-my-424-he-merged-first -->
<!-- @review pr=424 verdict=carve-out by=S322-bryan date=2026-08-05 probe=docs-only-known-gaps-plus-inbox-drain-no-code-path-own-gap-filings-rescoped-after-the-425-collision -->
<!-- @review pr=422 verdict=carve-out by=S322-peter date=2026-08-05 probe=file-list-diff-docs-only-hand-off+delta-log+master-list-regen-no-compiler-src-no-SPEC-no-conformance-U1-round3-wrap-addendum -->
<!-- @review pr=421 verdict=carve-out by=S322-peter date=2026-08-05 probe=file-list-diff-docs-only-continuity-maps-regen+pr-reviews+changelog+hand-off+delta-log+master-list+inbox-no-compiler-src-own-S321-wrap -->
<!-- @review pr=420 verdict=carve-out by=S322-peter date=2026-08-05 probe=file-list-diff-docs-only-changelog+hand-off+delta-log-no-compiler-src-S319-wrap-continuity -->
<!-- @review pr=419 verdict=carve-out by=S322-peter date=2026-08-05 probe=file-list-diff-docs-only-single-known-gaps-filing-renameCellAccessors-amplifier-no-code-path -->
<!-- @review pr=418 verdict=carve-out by=S321-peter date=2026-08-05 probe=own-review-records-and-brief-done-banner-docs-only-pr-reviews-and-BRIEF-no-code-path -->
<!-- @review pr=417 verdict=finding by=S321-peter date=2026-08-05 probe=S239-adversarial-pass-on-own-codegen-PR-found-F1-control-flow-body-under-skip-HIGH-fixed-module-fallback-plus-F2-implicit-double-write-preexisting-filed-runtime-conformance-proven-fail-prefix-pass-postfix note=reset-init-thunk-clobber-fix-hardened-pre-land -->
<!-- @review pr=416 verdict=finding by=S321-peter date=2026-08-05 probe=S239-adversarial-pass-on-own-codegen-PR-found-3-precision-defects-2FP-string-literal-1FN-destructure-ALL-fixed-and-pinned-behaviour-preserving-warning-only note=w-if-in-each-precision-hardened-pre-land -->
<!-- @review pr=415 verdict=carve-out by=S321-peter date=2026-08-05 probe=own-review-floor-record-docs-only-single-pr-reviews-line -->
<!-- @review pr=414 verdict=carve-out by=S321-peter date=2026-08-05 probe=docs-only-known-gaps+review-ledger-no-code-path-13-drain-entries-wellformed-severity-ruling-advisory -->
<!-- @review pr=413 verdict=carve-out by=S319-bryan date=2026-08-05 probe=own-review-record-docs-only -->
<!-- @review pr=412 verdict=carve-out by=S319-bryan date=2026-08-05 probe=own-ratification-records-and-brief-banners-docs-only -->
<!-- @review pr=411 verdict=carve-out by=S319-bryan date=2026-08-05 probe=continuity-docs-only -->
<!-- @review pr=410 verdict=clean by=S319-bryan date=2026-08-05 probe=fence-bidirectional-string-intact-and-genuine-variant-still-lowered -->
<!-- @review pr=408 verdict=clean by=S319-bryan date=2026-08-05 probe=depth-prefix-plus-it-ships-an-emitted-specifier-resolution-guard -->
<!-- @review pr=407 verdict=carve-out by=S319-bryan date=2026-08-05 probe=generated-maps-refresh-no-code-path -->
<!-- @review pr=406 verdict=carve-out by=S319-bryan date=2026-08-05 probe=continuity-docs-only -->
<!-- @review pr=404 verdict=carve-out by=S319-bryan date=2026-08-05 probe=own-gap-filings-and-retractions-docs-only -->
<!-- @review pr=403 verdict=carve-out by=S319-bryan date=2026-08-05 probe=review-ledger-records-docs-only -->

### S322 — the gate built to kill hollow gates shipped hollow, and the floor is what caught it

Two code-bearing PRs this session, both `finding`, and the finding on the *review tool* is the one
worth reading.

**#428 — the harness.** Built to replace a script class that has now measured a fraction of its
population three times (`artifact-diff.mjs` 8 of 115 · `u1-corpus-emit.sh` 329 of 1818 · that script's
`node --check` half inheriting the same population). Two independent adversarial lenses — one attacking
the mechanism, one the arithmetic — found **nine defects in the new gate**, four of which could produce
a false green on the very question it was built to answer. The load-bearing one:

> `node --check` on a `.js` resolves by module-syntax auto-detection, so a **top-level stranded
> `await` passes** — while the compiler emits `<script src=…>` with no `type="module"`, where it is a
> hard `SyntaxError` and the bundle is dead on arrival.

That is the auto-await work's *own dominant failure mode*, and every prior measurement in the arc ran
under the blindness. Worse, the obvious in-process fix is also broken: **bun's `vm.Script` does not
reject a top-level await either**, so goggles written under the parent runtime could not fail at all.
Both re-executed PA-side rather than inherited from the report. All nine routed back as a fix round and
re-proven with bites.

**#429 — U1.** Three fix rounds (8 findings, one build-breaking) plus the two post-hoc lenses, then a
wide-corpus re-measure **on the rebased tree against current main**: 1878 sources, 7254 artifacts,
syntax delta 0 under *effective, script and module* goggles, 2 artifact diffs both on sources that fail
to compile on every revision. It lands **explicitly not claiming its bug class** — the harness measures
142 bare client server-fn call sites in cleanly-compiling sources, delta 0, and that number is now
produced by the gate itself rather than by a one-off script.

**#426 got a real check despite being docs-only.** It records a *deferral* of a newly-accepting change,
so the thing worth verifying is that the change did not quietly ride along: `ba72eaa0` is **not** an
ancestor of main and lives only on `origin/feat/onmount-c-build`. Confirmed.

**The carve-out rate reads 57% and is still the wrong denominator** — see the S319 note below, which
stands. Four of the six drained here are continuity/gap/tracking PRs with no code path by construction;
both code-bearing PRs got the full pass and both produced findings. The code-bearing-only refinement
that note recommends is **still not built**, and this session is a second data point for it.

### ⚠ S319 — the carve-out rate crossed the probe's own alarm (57%), and the answer is that the DENOMINATOR is wrong

`review-debt.ts` now prints **`carve-out rate: 16/28 (57%) ⚠️ HIGH — is the floor still doing anything?`**
That alarm is the §8 absorbed-escape-hatch check working exactly as designed, so it gets a real answer
rather than a dismissal.

**The answer: every code-bearing PR in scope received a full S239 pass with empirical probes. The 57% is
entirely docs.** The four compiler landings reviewed this session — **#396** (route-attr semantics
diffed main-vs-branch by execution), **#405** (207 bundles under `node --check` + a bite proof run
against main), **#410** (bidirectional fence probe), **#408** (accepted on its shipped
emitted-specifier guard) — each produced a finding or a verified clean, and #396's pass surfaced a
normative SHALL violation nobody had noticed.

**So the metric is measuring the wrong population.** Carve-out-rate-over-ALL-PRs cannot distinguish
*"a docs-heavy stretch"* from *"the floor is being evaded"* — and a wrap/continuity/gap-filing PR has no
code path to review by construction, so its carve-out is not an escape, it is the correct classification.
A session that lands one compiler fix and six continuity PRs will trip the alarm while having reviewed
100% of what the floor exists to cover.

**Recommended refinement (not built — flagged for the S321+ measurement):** compute the rate over
**code-bearing PRs only** (any diff touching `compiler/`, `stdlib/`, `conformance/cases/`, or
`scripts/`), where the target is ~0% and any carve-out is genuinely suspicious. Keep the all-PR count as
a volume statistic, not as the health signal. **Until that lands, read the ⚠ as unproven rather than as
either healthy or evaded** — this note is the evidence for the current stretch, and it is a sample of one
session written by the session it describes, which is exactly the weakness the S316 Q5 3-session
measurement was designed to cover.

### #410 — bare-variant mask fenced to code regions · verdict `clean`

Parser-wide blast radius, so probed **bidirectionally** — an over-fence is as bad as an under-fence,
and only one of those directions fails loudly.

Probe: a string literal containing a variant-shaped token *and* a genuine bare variant of the same name
in the same file (`<path> = "/a/.Beta"` alongside `<phase>: Phase = .Beta` and a `match` over it).
Result: the literal survives intact (**2 occurrences of `"/a/.Beta"`, zero leaked
`__scrml_bare_variant_Beta__` placeholders**) **and** the genuine variant still lowers (8 × `"Beta"`).
`node --check` clean.

**Bias direction is right.** The fix routes through `rewriteCodeSegments`, the deliberately
**mask-biased** scanner S245 decoupled from the security egress guard precisely *because* mask-bias is
wrong for a confidentiality scan. Here the use is the mangle-adjacent one it was built for, and the bias
points the safe way: a missed mask means a bare variant is not lifted → a **loud** parse failure, never
silent corruption. That is the inverse of the bug being fixed, which was silent.

The PR reasons explicitly about the match-arm interaction (arms are already lifted into quoted string
args by `preprocessMatchExprs`, so they were never masked here and remain string interiors the fence
skips) — checked against the probe's `match` block and it holds.

### #408 — depth-prefix the own-document runtime `<script src>` · verdict `clean`

Accepted on its unit test plus the S296-class integration guard it ships. **Worth flagging beyond the
verdict:** this PR adds `compiler/tests/integration/corpus-emitted-specifier-resolution.test.js` — a test
that asserts **emitted specifiers resolve on disk**. That is an integration-level instance of exactly the
class I filed hours earlier as [[g-conformance-cannot-assert-emitted-route-path]] (*nothing asserts the
content of an emitted artifact*). It does **not** close that gap — the conformance harness still has no
`emit`/`artifacts` assertion key, so the author-declared-path guarantees remain unpinnable — but it is
the first guard of that shape in the tree and the right precedent to build the harness key from.

**Carve-outs (7).** #403/#406/#411 continuity, #407 a generated maps refresh, and #404/#412/#413 my own
docs-only landings. Recorded rather than skipped so the rate stays measurable — **9 of 28 (32%)**, and
rising largely on my own output, which is the §8 absorbed-escape-hatch signal to keep watching.

<!-- @review pr=405 verdict=clean by=S319-bryan date=2026-08-05 probe=corpus-emit-diff+node-check-207-bundles+bite-proof-on-main -->

### #405 — the dpa-020 CORE (unify the auto-await injectors) · verdict `clean`

Codegen landing that **retires a pass** (`injectPromiseAwait`, the per-statement string-regex auto-await)
in favour of one AST descend + paren-correct injector. Retiring a pass carries regression risk in the
opposite direction from a normal fix — something previously awaited going bare — so the pass was probed
for both.

| probe | result |
|---|---|
| emit differential, all 32 `examples/` | **zero** output differences |
| `node --check`, every emitted bundle (examples + 60 samples) | **207 bundles, 0 syntax failures** |
| reactive/engine sink fence survived the retirement | yes — as AST-aware `isSkippedReactiveValue` + `insideSink` + `awaitIllegal`, replacing a regex prefix |
| **bite proof — the new conformance test run against MAIN** | **0 pass / 6 fail** (branch: 6 pass / 0 fail) |

**The `node --check` sweep is dpa-020's own mandated gate**, because the verdict named the dominant risk
as *"a stranded `await` is a WHOLE-BUNDLE SyntaxError"* (`peerAwaitable` defaults to awaitable). 207
bundles clean says that risk does not materialise on the corpus.

**Zero emit change is the expected result, not a weak one:** the injector is deliberately byte-identical
on the no-tail call (`await fn()`) and only diverges on a receiver-tail (`(await fn()).ok`), a ternary
init, and `given`/match-block/`try` nesting — none of which the corpus exercises. That is precisely why
all three defects were silent.

**★ The bite proof is what carries this review.** My own hand-written probes repeatedly failed to reach
the changed paths — twice from invalid scrml on my part (`given v = expr` is not a rebind; markup inside
a function body), once from dead-code shaking. Rather than infer from a green suite, I ran the PR's new
conformance test against **main's** compiler: **all six assertions fail there and all six pass on the
branch.** That proves the three defects are real and live, and that the fix closes both the CODES and
RUNTIME halves of each. **Stated plainly because it matters: the fix's correctness here is established by
the PR's own executable test proving its bite, not by reproducers I constructed.**

**Rebase (S319):** conflicted on `dpa-queue.md` (2 regions) + `known-gaps.md` + `FACTS.md` after #412.
Generated blocks resolved by **regeneration**, verified by arithmetic — MED 114−3=111 (the three MED gaps
this PR resolves), LOW 49−1+1=49 (one resolved, one filed), HIGH 20 unchanged — matching the prediction
exactly. The three resolved gaps are the same three the bite proof exercised. `dpa-queue.md` resolved to
HEAD, which already carried both Peter's S320 re-run note and the S319 ratification.

**Not blocking, recorded:** #405 is dpa-020's **U3** (merge the injectors), not **U1** (the missing
`emitCall` client-server-fn branch). The ratified verdict names the post-emit rename as the bug generator
and U1 as the root fix, so the family is narrowed here, not closed — a bare unawaited server call is
still observable in a hand-probe. U1 remains open work.

<!-- @review pr=402 verdict=carve-out by=S320-peter date=2026-08-04 probe=continuity-docs-only-changelog-handoff-deltalog-no-code-path -->
<!-- @review pr=401 verdict=carve-out by=S320-peter date=2026-08-04 probe=known-gaps-rescope-docs-only-VERIFIED-scheduling.ts:974-isControlFlowBoundary-opaque-boundary-anchor-holds -->
<!-- @review pr=400 verdict=carve-out by=S320-peter date=2026-08-04 probe=known-gaps-filing-docs-only-VERIFIED-conformance-run.ts-ExpectedCase-has-no-emitted-content-assertion-key -->
<!-- @review pr=399 verdict=carve-out by=S320-peter date=2026-08-04 probe=known-gaps-spec-hygiene-teardown-ordering-docs-only-dpa-surfaced-self-caveated-unverified -->
<!-- @review pr=398 verdict=carve-out by=S319-bryan date=2026-08-04 probe=own-dpa-banks-and-review-record-docs-only -->
<!-- @review pr=396 verdict=finding by=S319-bryan date=2026-08-04 probe=route-attr-semantics-diff-main-vs-branch-by-execution note=sse-author-route-conformance-restoration-undersold -->
<!-- @review pr=397 verdict=carve-out by=S319-bryan date=2026-08-04 probe=own-wrap-continuity-docs-only -->

### #396 — `fn … = <expr>` rejection · verdict `finding` (not a defect — an UNDER-SOLD conformance restoration)

**The PR does two independent things and only names one.** The titled fix (reject the unsanctioned
`= <expr>` fn body → `E-FN-EQUALS-BODY`) is clean. Riding with it, mentioned only as a parenthetical
inside a code comment, is a **second behavior change on existing code**: the return-type consumers now
break at a `route=`/`method=` attribute, so an author-declared route is no longer swallowed.

**Probed by EXECUTION, main vs branch, not by reading the diff:**

| probe | main | branch |
|---|---|---|
| plain `function f() -> T route="/api/user"` | **no route registered** | `/api/user` registered |
| plain `function f() route="/api/ping"` (no return type) | `/api/ping` | `/api/ping` (unchanged) |
| **`server function* f() -> T route="/sse/feed"`** | **`path: "/_scrml/__ri_route_feed_1"`** | **`path: "/sse/feed"`** |
| return-type shapes (lifecycle · map · enum-subset · refinement) | — | `client.js` **byte-identical**, 0 errors both sides |
| recovery after a rejected `= match` body | — | exactly ONE error, correct line/col, no cascade |

**The third row is the finding.** SPEC §37.3 / §12.3 say verbatim that the compiler *"SHALL mount the
SSE handler at the author-declared path"* and *"SHALL honor it in **application (browser) mode**."*
**Main violates that SHALL** whenever the SSE generator also carries a return type — the author's
`route="/sse/feed"` is silently replaced by a compiler-internal hash. A foreign `EventSource`
subscriber, for whom the author path IS the contract (the §12.3 BYOB carve-out), connects to
`/sse/feed` and gets a 404. Silent, adopter-facing, and this PR fixes it.

So the route half is **newly-accepting toward the contract** (pa-base §8) — a governing sentence
already said the form is legal and the implementation was holding the door shut. It ships as a fix;
blocking it would freeze an implementation defect into the language.

**Verified independently, not taken from the PR:** the migration measurement (zero corpus files combine
a return type with `route=`) — confirmed. The break-set completeness — the fn attribute loop at
`ast-builder.js:12554` accepts **exactly** `route` and `method`, so hardcoding those two is complete,
not a partial fix. The `=`-break regression surface — every legal return-type form probed is
byte-identical.

**Recorded, not blocking:**
1. The route restoration deserves to be a headline with a **conformance pin** (`server function*` +
   return type + `route=` → author path), not a comment aside. Currently nothing pins it.
2. The zero-corpus measurement is true but **the corpus-is-artifact kernel applies** — the corpus may be
   empty *because* the combination silently dropped the route. Same shape as the S66 canonical example.
   Measured-zero here is weaker evidence than it looks; the SHALL is what carries the decision.
3. **Separate, pre-existing, NOT this PR's:** a plain `function route=` (non-generator, non-`handle()`)
   mounts a route in application mode, while §12.3's carve-out is explicitly **NARROW** to
   `server function*` SSE + `handle()`. This PR does not introduce it (main already does it for the
   no-return-type case) but it deserves its own question.

**Rebase note (S319):** the branch was rebased onto `663f31b8` to clear a `known-gaps.md` conflict in the
`@generated` counts block. Resolved by **regeneration**, then verified by arithmetic — HIGH 23−1=22 (his
HIGH resolved), LOW 47+1=48 (his filed residual), MED 109 unchanged — matching the prediction exactly.
The rebase also folded in a `master-list.md` `@generated:recent-sessions` regen, because `state.ts
--check` was FAILING on main (S316's own wrap step 6d missed it).

<!-- @review pr=395 verdict=carve-out by=S316-bryan date=2026-08-04 probe=docs-only-continuity -->
<!-- @review pr=394 verdict=clean by=S316-bryan date=2026-08-04 probe=await-precedence-overharvest-syntax -->
<!-- @review pr=393 verdict=carve-out by=S316-bryan date=2026-08-04 probe=inbox-delivery-only -->
<!-- @review pr=391 verdict=finding by=S316-bryan date=2026-08-03 probe=adjacent-markup-positions note=autoawait-incomplete-attr-and-each-body -->
<!-- @review pr=390 verdict=clean by=S316-bryan date=2026-08-03 probe=import-resolution-executed -->
<!-- @review pr=389 verdict=clean by=S316-bryan date=2026-08-03 probe=span-rebase-vs-prefix-baseline -->
<!-- @review pr=392 verdict=carve-out by=S316-bryan date=2026-08-03 probe=docs-only-continuity -->
<!-- @review pr=388 verdict=finding by=S316-bryan date=2026-08-03 probe=direction-of-change note=export-let-newly-accepting-REJECTED -->
<!-- @review pr=387 verdict=clean by=S316-bryan date=2026-08-03 probe=tailwind-over-emission -->
<!-- @review pr=386 verdict=clean by=S316-bryan date=2026-08-03 probe=confidentiality-leak -->
<!-- @review pr=385 verdict=clean by=S316-bryan date=2026-08-03 probe=confidentiality-leak -->

### Notes on the above (commentary — not parsed)

- **#385 / #386** — both widened what reaches the client bundle (#385 rewrote reachability from "read
  by a node in THIS module" to "read by ANY client compilation unit"). Probed the confidentiality
  axis: a module exporting `API_SECRET` read **only** by a server fn in another unit, beside a
  client-read `PUBLIC_LABEL`. The emitted `models/secrets.client.js` carried `PUBLIC_LABEL` and its
  registry entry only; the secret was absent entirely and present in `.server.js`. Same on #386's
  type-annotated path. **The widening is correctly scoped to client reads.**
- **#387** — probed over-emission: an `<engine>` with Tailwind classes in a NON-initial arm plus prose
  containing `text-9xl`. Non-initial arm classes now emit (the fix), initial arm unchanged, prose
  `text-9xl` produced **zero** CSS rules. No over-scan.
- **#388** — the finding. Its `export let` / `export var` emission was **newly-accepting** (a direct
  `<endpoint>` reference fired `E-SCOPE-001` pre-fix, compiles post-fix) with no governing sentence in
  SPEC (`export let` appears **zero** times), no conformance case, and against SPEC §51.0.A:27504's
  ratified *"no free-shaped / untyped global store … **final** shared-state design"*. Deciding
  measurement: **a bare top-level `let` already works** in a `serve=tool`, so the dogfood need was
  already met and `export let` bought only cross-module mutable sharing. **bryan RULED reject (S316).**
  Revert that half; the main-only import tree-shaking half is a clean under-emit fix and stays.
- **#392** — continuity/changelog/delta-log only, no code path → carve-out.
- **#393 / #395** — inbox delivery and continuity respectively; **verified 0 files under
  `compiler/src`** → carve-out.
- **#394** — **clean on all three sharp axes.** (a) *Await precedence:* emits
  `(await _scrml_fetch_getFlag_2()).ok` — the await wraps the CALL node, not the member expression;
  the precedence-wrong `await (getFlag().ok)` was the stated hazard and it is avoided. (b) *Part-B
  over-harvest:* the async-marking pass now harvests callee idents from match-arm RESULT strings, so I
  probed a fn whose arm result is a **string literal merely mentioning `getFlag()`** — it stayed a
  plain `function` while the real caller became `async`. Literals genuinely pre-stripped; no
  over-colouring. (c) *Stranded await:* `node --check` clean on all three artifacts. Also worth
  crediting: the PR **R26-corrected its own filed mechanism** (the gap claimed a "sync IIFE where
  await is illegal"; the const-init form actually lowers to a statement tilde-temp where it is legal),
  swept 1019 corpus files for byte-diffs (zero changed), and filed 5 sibling residuals rather than
  dropping them.

  **But the review's real finding is the SHAPE OF THE BOARD, not a defect in #394.** The auto-await
  residual family now runs to ~23 entries, **9 of them open** (2 HIGH, 6 MED, 1 LOW):
  `g-inferred-async-call-value-position-no-autoawait` · `g-markup-autoawait-misses-attr-and-each-body`
  · `g-server-fn-argument-position-not-awaited-and-statement-dropped` ·
  `g-match-value-position-…` · `g-match-block-arm-…` · `g-given-block-…` · `g-if-value-cascade-…` ·
  `g-reactive-write-member-…` · `g-ternary-init-server-call-await-misbind`.

  Every one is *"auto-await misses position X."* **§13.2 mandates POSITION-INVARIANT auto-await** —
  the very sentence #394 cites — yet the implementation is being drained one position at a time, and
  the discovery rate is not slowing: #391 fixed one position and the S239 pass found two more; #394
  fixed one and filed five more. **Six new positions surfaced from two PRs.** That is the signature of
  an await decision made independently at each emit site instead of once at a choke point, and it is
  worth a design look before the next position is patched. Not a criticism of either PR — both fixed
  what they claimed, cleanly.
- **#389** — probed span rebasing against the **pre-#389 baseline** (a worktree at `5aeb656a`, which
  predates it), with an undeclared read at a known line in five contexts. Baseline: match-arm read
  reported **line 1** (true 10), `<each>`-body read reported **line 1** (true 19). Post-fix: **10** and
  **19**. Control (top-level, line 7) unshifted both sides — **no double-rebase**. Engine state-child
  arms reported correctly on BOTH sides, so #389 neither fixed nor broke them (an earlier read of mine
  that it "broadened coverage there" was wrong). **Clean — does exactly what it claims.** Surfaced a
  separate PRE-EXISTING bug, filed: [[g-nested-each-in-match-arm-drops-diagnostics]].
- **#390** — probed the S296 over-correction axis: a `kind="tool"` under `pages/` (the shape it fixes,
  where dist strips the leading segment) AND one NOT under `pages/` (where there is nothing to strip
  and a naive re-base would overshoot the other way). Both emit `./models/lib.js` against an artifact
  at `./models/lib.js`. **Verified BY EXECUTION** — both tools imported and ran (`hi a` / `hi b`),
  which is the required standard for this class: S296's signature is compile exit 0 + `node --check`
  clean + runtime `Cannot find module`. **Clean.**
- **#391** — **FINDING: the fix is incomplete.** Probed the four markup positions an interpolated
  cross-module async call can inhabit. Only the top-level text interpolation is awaited:

  | source position | emitter | status |
  |---|---|---|
  | `<p>${ fetchStatus(@url).status }</p>` | `emit-event-wiring.ts:1889` | `(await …)` ✅ |
  | `<div title=${ … }>` | `emit-event-wiring.ts:1665` | **BARE** ❌ |
  | inside a `<match>` arm body | `emit-variant-guard.ts:569` | **BARE** ❌ |
  | inside an `<each>` body | `emit-each.ts` | **UNTESTED** (probe used an empty collection) |

  *(Attribution corrected in-session: the second bare site is the `<match>` arm renderer — a THIRD
  emitter — not the `<each>` body, and the `<each>` position was never actually exercised. The finding
  stands; the labels were wrong.)*

  Both bare sites reproduce the ORIGINAL symptom by a different door — a field read off a Promise
  renders `undefined`, silently, compile exit 0. This is the S288 shape: *a fix verified thoroughly
  inside too small a surface is still incomplete — enumerating shapes inside a function is not the same
  as enumerating the functions a class of defect can inhabit.* The PR's own test carries a sync
  negative control (good practice) but only exercises the one position it fixed. Filed:
  [[g-markup-autoawait-misses-attr-and-each-body]].

<!-- @review pr=443 verdict=carve-out by=S325-bryan date=2026-08-06 probe=file-set-enumerated-via-gh-pr-view-14-files-all-docs-or-maps-zero-code-paths -->

- **#443** — **CARVE-OUT (docs-only).** Enumerated the file set rather than trusting the title:
  `.claude/maps/*` (9), `docs/changelog.md`, `docs/known-gaps.md`, `docs/pr-reviews.md`, `hand-off.md`,
  `handOffs/delta-log.md` — 14 files, zero code paths. Qualifies under the S239 carve-out clause
  (*pure spec-text / docs-only / config rebumps with no code path*).

  **Note on the denominator, third data point.** This carve-out is CORRECT and it still pushes the
  rate up (29/40 → 30/41, 73%). `review-debt.ts` warns at a high rate over ALL merged PRs, which
  cannot distinguish a docs-heavy stretch from a floor being evaded — the S319 note flagged this and
  recommended computing the rate over **code-bearing PRs only** (any diff touching `compiler/`,
  `stdlib/`, `conformance/cases/`, `scripts/`). That refinement is STILL unbuilt. Until it is, read
  the ⚠ as UNPROVEN — neither healthy nor evaded.

<!-- @review pr=444 verdict=clean by=S326-bryan date=2026-08-06 probe=de-escalation-rationale-verified-by-grep-at-fire-sites-three-csrf-publication-channels-all-exist -->

- **#444** — **CLEAN.** Docs-only by enumerated file set (`docs/changes/authed-server-fn-bare-return/BRIEF.md`,
  `docs/known-gaps.md`, `docs/pr-reviews.md`, `handOffs/dpa-queue.md`) — zero `compiler/`, `stdlib/`,
  `conformance/cases/`, `scripts/`. **Reviewed as CLAIMS, not as a code path**, because the load-bearing
  content is a **security de-escalation** (`g-session-get-reserved-key-read-disclosure`, HIGH → MED) and a
  docs PR that lands a false durable claim is exactly the failure this floor exists to catch.

  **The de-escalation rests on "the §40.2 token is already published same-origin through three
  compiler-owned channels."** Verified by grep AT THE FIRE SITES rather than from the entry's prose:
  1. `GET /_scrml/session` — route registered `emit-server.ts:2765`; client fetches it with
     `credentials:'include'` at `emit-client.ts:2383`.
  2. `<meta name="csrf-token">` — emitted into the first-paint document at `codegen/index.ts:2277`.
  3. `scrml_csrf` cookie — set via `document.cookie` at `emit-client.ts:2455` (`Path=/; SameSite=Strict`)
     and read back at `:2434`. Set through `document.cookie`, so **non-HttpOnly by construction** — the
     entry's characterization is right for a structural reason stronger than the one it gives.

  All three exist. The HIGH → MED is SOUND and the reasoning is recorded well enough to overrule cheaply.

  **One precision limit, stated rather than smoothed:** I verified channel 1's route EXISTS and is
  client-fetched; I did NOT verify the entry's stronger claim that it is *un-authenticated and
  un-CSRF-gated*. The conclusion does not depend on it — channels 2 and 3 are each independently
  sufficient (a meta tag in the served document and a non-HttpOnly cookie are same-origin-script-readable
  by construction), so the de-escalation holds on two channels even if channel 1's gating claim is loose.

<!-- @review pr=445 verdict=clean by=S326-bryan date=2026-08-06 probe=re-characterization-reproduced-by-execution-terse-vs-explicit-lift-emit-compared -->

- **#445** — **CLEAN, verified by EXECUTION.** Docs-only (`docs/known-gaps.md`, +17/-0), a
  re-characterization of `g-tier0-reactive-lift-mixed-text-interp-literal` that INVERTS the S281 model.
  A re-characterization is a durable claim about live compiler behaviour, so it was reproduced rather
  than read: compiled a two-arm probe (terse `lift <li>${n}px/` vs explicit `lift <li>${n}px</li>`) on
  HEAD and diffed the emitted lowering.

  Both halves of the claim hold exactly:
  - terse form → `_scrml_lift_tn_9.textContent = ` + a template literal carrying a **spurious space**
    (`${n} px`) — the defect, silent and adopter-visible;
  - explicit close → `String((n) ?? "")` **plus a separate** `appendChild(document.createTextNode("px"))`
    — correct, no space, exactly as the entry claims.

  So the residual is the MIRROR of what S281 filed (right-glue, not left-glue), the scope really is
  narrower than the original entry (terse form only), the stated workaround really works, and the S281
  detection signature (`createTextNode("…${…")`) really is obsolete on this path. Deferral is justified
  on blast radius; the fix direction it hands forward (thread the interp part's real span at
  `ast-builder.js:4258` so the `:4231` adjacency test fires) is actionable.

<!-- @review pr=449 verdict=carve-out by=S326-bryan date=2026-08-07 probe=file-set-enumerated-6-files-all-docs-zero-code-paths -->

- **#449** — **CARVE-OUT (docs-only).** Enumerated rather than trusted by title: `docs/changelog.md`,
  `docs/changes/limb2-mangler-retirement/SCOPING.md`, `docs/changes/mangler-three-defects/BRIEF.md`,
  `docs/known-gaps.md`, `docs/pr-reviews.md`, `hand-off.md`, `handOffs/delta-log.md` — zero code paths.
  Inherited from S325 fully authored; merged under bryan's in-session authorization.

<!-- @review pr=452 verdict=clean by=S326-bryan date=2026-08-07 probe=inherited-S239-two-lenses-at-frozen-2a7c4e9f-plus-PA-fix-round-review-plus-own-R26-on-merged-main -->

- **#452** — **CLEAN.** Compiler source (`emit-server.ts` + 7 test files). **Reviewed, not waved
  through, but deliberately NOT re-reviewed from scratch:** it went through the full S239 gate at S325
  against the frozen `2a7c4e9f` with two independent adversarial lenses (four findings, all fixed),
  then one fix round at `1dc7fd78`. This session I (a) confirmed NIL base-drift — main touched neither
  `emit-server.ts` nor the six test files since the agent's base `cff2af5e`, so the wholesale pull was
  the correct mechanic; (b) re-read the fix-round delta directly and confirmed it does not touch the
  regions the structural findings covered; (c) ran my **own** R26 on the merged main before flipping
  the gap — 25 emitted `.server.js`, 241 `return new Response`, 84 passthrough guards, zero
  `Expected a Response`. Residual recorded on the gap entry (hand-built `Response` bypasses the runtime
  redaction floor by design; currently unreachable via `E-SCOPE-001`).

<!-- @review pr=453 verdict=carve-out by=S326-bryan date=2026-08-07 probe=single-file-docs-known-gaps-only-zero-code-paths -->

- **#453** — **CARVE-OUT (docs-only).** `docs/known-gaps.md` only. Ledger currency: one gap flipped to
  resolved on the PA's own R26, one reachability banner discharged with a deliberate NO-CHANGE
  re-score, one new MED filed. No code path.

<!-- @review pr=454 verdict=clean by=S326-bryan date=2026-08-07 probe=bite-proven-both-directions-422-on-stale-ref-and-green-dispatched-run-31140159467 -->

- **#454** — **CLEAN, and bite-proven both directions.** `.github/workflows/ci.yml` only — a gate-config
  change, which is exactly the class that must not be waved through on "it's just YAML". Verified it
  **weakens no gate**: it adds a way to START a run, not to skip one; `gate` remains the sole required
  check and `enforce_admins=true` is untouched. Proved the lever fires (`--ref main` → run
  `31140159467`, **all three jobs green including `gate`**, which also confirms the `s34-census`
  `HEAD~1` fallback survives a dispatched run) AND proved its limit (`--ref` a branch cut before the
  merge → **HTTP 422**, because the dispatch reads the workflow from the target ref). **The proof
  corrected the documentation shipped with it** — the comment as first written would have sent the next
  PA into that 422; amended in #455 with the measured constraint.

<!-- @review pr=455 verdict=carve-out by=S326-bryan date=2026-08-07 probe=two-files-delta-log-plus-ci-yml-comment-only-no-executable-change -->

- **#455** — **CARVE-OUT.** `handOffs/delta-log.md` + a comment-only amendment to
  `.github/workflows/ci.yml` (no executable change — the `on:` block is untouched; only the explanatory
  comment gained the measured ref-constraint). No code path.

<!-- @review pr=458 verdict=finding by=S326-bryan date=2026-08-07 probe=two-independent-adversarial-lenses-on-frozen-5cfc342e-converged-on-one-regression-plus-fix-round-plus-own-R26 -->

- **#458** — **FINDING (two regressions caught pre-land, both fixed).** Compiler source
  (`emit-client.ts`, `code-segments.ts`, `emit-functions.ts` + a new 674-line unit suite). Full S239
  pass: two INDEPENDENT adversarial lenses on the frozen `5cfc342e`, dispatched with disjoint remits
  (correctness/lost-coverage and blast-radius/downstream-contracts).

  **They converged independently on the same primary regression** — the `binding-pattern` fence was a
  HALF-REPAIR: it restored the *binding* to its source name while the pass still rewrote the uses those
  bindings SHADOW, so the bindings went dead and calls resolved to the module-level function. Executed:
  base threw a loud `TypeError`, the fenced version silently returned the **wrong value** — the exact
  failure class the change exists to remove. A second lens independently found `{__proto__}` → 
  `{__proto__: X}` silently mutating `[[Prototype]]` (ECMA-262 B.3.1; own keys 2→1). **Both fixed by
  REMOVAL** in a fix round routed back to the same agent, then PA-reviewed directly rather than
  re-dispatching two lenses for a subtraction.

  The dev-agent's defence of the binding-pattern branch was *"measured population ZERO"* — **a corpus
  census, not a structural argument**, and both reviewers constructed the shape trivially. Recording
  that because it is the reusable lesson.

  Verified after: coverage-removal reconciles exactly (rewrites 2332 → 1413, `919 = 781 + 138`, and the
  pass now stops rewriting ZERO sites), corpus differential exactly two explained diffs, and my **own**
  R26 on merged main by execution. **The defect class is NOT closed** and the entry stays `open`.

<!-- Peter's #447 #448 #450 #451 #456 #457 remain OWED and are HIS to record (S325 lane precedent:
     a session records its own merges). Surfaced in the S326 hand-off rather than absorbed silently. -->

## S333-peter — #476 + #477 (both reviewed PRE-landing, 3× adversarial S239 each)

Both PRs were reviewed by the mandatory PA-side S239 pass BEFORE merge (workflow-backed `/code-review high`, three rounds each), and every round's findings were fixed before landing — the reviews are the reason the fixes are complete rather than silent partials.

- **#476** (E-SQL-006 compile diagnostic): S239 caught a **silent partial fix twice** — round 1 missed 8 server-fn emit sub-paths (CPS-return, SSE, WS, Pattern-C, endpoint, value-only, middleware) that dropped the diagnostic; round 2 left the value-only-server-JS path (create-pass-without-drain) whose "unreachable" verdict the review falsified; round 3 closed it. All CONFIRMED findings fixed pre-merge.
- **#477** (each-in-match read-side diagnostics): S239 caught three re-parse leaks — a `nodeTypes` memo id-collision (silent type-memo corruption), a bogus synthetic `span.file`, and a depth-2 line mislocation. All fixed + pinned pre-merge.

<!-- @review pr=476 verdict=finding by=S333-peter date=2026-08-09 probe=three-adversarial-workflow-rounds-drain-everywhere-completeness-caught-silent-partial-fix-twice-8-sites-then-1-value-only-residual-all-fixed-pre-merge -->
<!-- @review pr=477 verdict=finding by=S333-peter date=2026-08-09 probe=three-adversarial-workflow-rounds-caught-nodetypes-memo-id-collision-plus-bogus-spanfile-plus-depth2-mislocation-all-fixed-and-pinned-pre-merge -->

## S331-bryan — floor drained: 9 OWED → 0

Eight recorded here; **#474 is recorded separately** below after its own adversarial pass.

**Denominator note (the S319 question, re-measured).** Five of the nine were pure
continuity/maps landings with **no code path to review by construction** — verified against their
actual file lists, not assumed, because S328 found `#397` mis-carved the other way. Code-bearing in
this batch: **#469 #470 #473 #474** — four of nine. The all-PR carve-out rate remains a docs-VOLUME
statistic; the code-bearing rate is the health signal, and it is 0% carved.

### #469 + #470 — FINDING (two HIGH-severity defects, both silent)

Reviewed by emission across every value position, base vs fix, plus an adversarial sweep of adjacent
shapes. **The pass produced PR #479.** Both PRs are correct for what they enumerated — the five value
*positions* — and both left two orthogonal axes unenumerated:

- **Tail shape.** `_splitBlockStatements` split only on `;` and newline at depth 0, so a tail
  FOLLOWING a block-bodied statement (`for (…) { a = 1 } a`) was swallowed into a segment headed by
  `for`, classified a statement, and never lifted → the value-returning IIFE fell off its end →
  `undefined`, which is not a scrml value (§42.1.1). **Separator dependence, not position
  dependence** — the tail lifts the moment a `;` precedes it.
- **Nested-statement fidelity.** `_emitForStmtWithTilde`'s fallbacks dropped the options argument
  entirely, so a nested bare `a = 1` emitted as a shadowing `const a = 1` (silent wrong value) and
  `a = a + 1` as `const a = a + 1` — a runtime TDZ `ReferenceError` that `node --check` accepts.

**The discriminator is arm FORM, not value POSITION** (variant arms parse to `structuredBody` and are
immune; literal/wildcard arms hit the raw-string segmenter) — so the defect broke **five of five**
positions, and my own first filing said two of four because my reproducer's arm forms were confounded.
Corrected in the ledger and routed to Peter.

**Why neither PR's gates could see it, and this is the reusable half:** #470's full-corpus differential
read `0 of 7296` — *honestly*, and on the wrong axis. No corpus file places a block-bodied statement
inside a match block arm without a trailing separator, so the inputs that would trip either defect do
not exist yet. Both conformance cases added by #469/#470 use straight-line arm bodies, so the suite was
equally blind. **A gap closed by enumerating one dimension reads as closed on all of them.**

### #473 — CLEAN (and it closed the class, not a position)

`new URL(import.meta.url).pathname` yields a `/C:/…` form on Windows that fails after `dirname`/`join`;
`fileURLToPath` is the correct API on every platform. Probed three ways rather than read: the cited
precedent is real (`scripts/facts.ts:31` uses exactly that form), and a repo-wide grep for the broken
form returns **zero remaining sites** — the only hit is the explanatory comment inside the fixed file.
So this is a class closure, not a per-position patch. No behaviour change on POSIX.

### #467 #468 #472 #475 #478 — CARVE-OUT (verified, not assumed)

File lists checked individually: continuity/changelog/hand-off/delta-log/master-list/known-gaps and the
`.claude/maps/` refresh. **Zero paths under `compiler/`, `stdlib/`, `conformance/cases/` or `scripts/`.**
No runtime surface, so the S239 blast-radius question has no subject. `#468`'s maps refresh is a
generated navigation artifact; its correctness gate is the watermark advance, which the wrap step
already performs.

<!-- @review pr=467 verdict=carve-out by=S331-bryan date=2026-08-09 probe=file-list-verified-continuity-changelog-handoff-deltalog-masterlist-knowngaps-zero-code-paths -->
<!-- @review pr=468 verdict=carve-out by=S331-bryan date=2026-08-09 probe=file-list-verified-claude-maps-refresh-plus-knowngaps-generated-nav-artifact-zero-code-paths -->
<!-- @review pr=469 verdict=finding by=S331-bryan date=2026-08-09 probe=emission-across-all-value-positions-base-vs-fix-found-tail-swallowed-after-block-stmt-yields-undefined-arm-form-not-position-is-the-axis-produced-pr-479 -->
<!-- @review pr=470 verdict=finding by=S331-bryan date=2026-08-09 probe=emission-plus-adversarial-adjacent-shapes-found-nested-bare-assignment-emits-shadowing-const-silent-wrong-value-and-tdz-refcheck-passes-produced-pr-479 -->
<!-- @review pr=472 verdict=carve-out by=S331-bryan date=2026-08-09 probe=file-list-verified-continuity-changelog-handoff-masterlist-knowngaps-zero-code-paths -->
<!-- @review pr=473 verdict=clean by=S331-bryan date=2026-08-09 probe=fileurltopath-correct-api-precedent-facts-ts-31-verified-real-and-repo-wide-grep-for-broken-form-returns-zero-remaining-sites-class-closed -->
<!-- @review pr=475 verdict=carve-out by=S331-bryan date=2026-08-09 probe=file-list-verified-changelog-handoff-deltalog-zero-code-paths -->
<!-- @review pr=478 verdict=carve-out by=S331-bryan date=2026-08-09 probe=file-list-verified-continuity-changelog-handoff-deltalog-rotation-prreviews-knowngaps-zero-code-paths -->

## S331-bryan — #474 (the last owed item)

**Verdict: FINDING.** Dispatched as an independent adversarial pass rather than reviewed by eye, because
`emit-server.ts` is a **text pass over generated output** — the repo's standing bug family. Every claim
below was PA-verified before being recorded; two were corrected.

The fix is **correct on its named case and not a regression** — every defect found reproduces
byte-identically on the parent `0beddacc`. What it is, is **incomplete**: it made ONE emitter
template-literal-aware and left three siblings in the same class corrupting multi-line template content
with zero diagnostics (`emit-library-shared.ts:692` · `emit-tool.ts:466`, verified by EXECUTING the
emitted tool bundle · `emitTryStmt`, which corrupts on both boundaries and is the first nesting
construct an author reaches for). `emitIfStmt` is only *accidentally* safe, which is why an `if` probe
reads clean.

Its shipped `KNOWN LIMITATION` comment also understates the residual — the real desync trigger is any
regex containing an odd count of `'`/`"`/`` ` ``, unbalanced braces, or `//`, not just a backtick — and
the "0 instances in corpus" measurement that justified shipping it **used a predicate that does not
describe the bug** (`stdlib/compiler/meta-checker.scrml:230` does carry a backtick-bearing regex).

**PA-verified corrections to the reviewer's own report** — recorded because taking an agent at face
value is the failure mode this floor exists to catch:
- **F4 confirmed exactly:** the comment's *"filed as a follow-up"* claim was false —
  `grep -rn "g-server-fn-reindent"` returned **zero** hits until this session filed it.
- **F6 severity corrected DOWN.** The reviewer called the template-swallow a *silent* build-breaker. It
  is not silent — the compile exits non-zero with `E-STATE-UNDECLARED`. It is **misattributed**, which is
  a different and lesser defect. It also did not reproduce on my first two constructions; only on the
  §40.8 bare-`<program>`-body form. Filed MED with the open question that would make it HIGH, rather
  than at the reported severity.

Filed: `g-server-fn-reindent-fix-covers-8-of-25-sites-in-its-own-class` (HIGH) ·
`g-server-fn-reindent-lexer-desync-understated-and-measured-with-the-wrong-predicate` (HIGH) ·
`g-template-interp-regex-swallows-following-source` (MED).

**The reusable half:** the originating gap was scoped `locus=compiler/src/codegen/emit-server.ts`, and
the fix stopped at that file. A per-position locus on a compiler-wide class **anchors the search** —
pa-base §5, and the second instance of it this session.

<!-- @review pr=474 verdict=finding by=S331-bryan date=2026-08-09 probe=independent-adversarial-dispatch-parent-vs-head-differential-on-17-probes-plus-executed-tool-bundle-found-3-sibling-emitters-uncovered-plus-lexer-desync-far-wider-than-shipped-comment-plus-false-followup-filing-claim-pa-verified-and-two-findings-corrected -->

## S331-bryan — my own two merges (the floor binds them too)

- **#479** (`emit-logic §18.5`) — **CLEAN, and the pass is the reason it exists.** The mandatory S239
  gate ran on the agent's diff BEFORE landing: both defects re-probed by emission on base vs fix; the
  fallback re-dispatch probed for infinite recursion (terminates, and now emits `a = 1` rather than
  `const a = 1`); and an adversarial sweep of every adjacent shape the new depth-0 `}` boundary could
  tear — `if/else`, `do…while`, arrow-function initializer, object literal, chained tail (`d + 1`), two
  sequential `while` loops — none torn. Conformance 876/876 and the new unit file 23/23 were re-run by
  me, not taken from the agent's report. One residual found and disclosed rather than hidden
  (`g-match-block-arm-do-while-tail-not-lifted`, LOW). The differential's `0 of 7328` was recorded WITH
  its coverage caveat: it proves inertness on the corpus and carries zero evidence the fix works.
- **#480** (review-floor drain) — **CARVE-OUT.** Single file, `docs/pr-reviews.md`. No code path.

<!-- @review pr=479 verdict=clean by=S331-bryan date=2026-08-09 probe=mandatory-s239-pre-land-emission-base-vs-fix-plus-recursion-probe-plus-adversarial-sweep-ifelse-dowhile-arrow-objlit-chainedtail-two-whiles-none-torn-conformance-876-and-unit-23-rerun-independently-one-residual-disclosed -->
<!-- @review pr=480 verdict=carve-out by=S331-bryan date=2026-08-09 probe=single-file-docs-pr-reviews-md-no-code-path -->
