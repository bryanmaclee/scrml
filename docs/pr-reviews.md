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
<!-- @review pr=541 verdict=carve-out by=S346-bryan date=2026-08-16 probe=file-set-verified-single-path-docs-pr-reviews-md-marker-recording-only-zero-code-paths-STRUCTURAL-NOTE-a-floor-binding-MERGED-PRs-can-never-read-zero-at-the-moment-a-floor-recording-PR-merges-so-this-row-is-always-owed-to-the-NEXT-session-batch note=the-instruments-own-recursion-cf-S328-397 -->
<!-- @review pr=538 verdict=carve-out by=S346-bryan date=2026-08-16 probe=file-set-verified-two-paths-pr-reviews-md-and-delta-log-md-marker-recording-only-zero-code-paths note=review-ledger-bookkeeping -->
<!-- @review pr=536 verdict=clean by=S346-bryan date=2026-08-16 probe=PA-read-the-classifier-mentions-is-hash-anchored-left-and-negative-lookahead-right-so-51-does-not-match-519-nor-519-match-5190-verified-by-bun-e-pagination-auto-widens-with-a-rows-lt-limit-completeness-proof-detection-only-exit-0-not-in-CI-pure-classifier-over-strings-with-injected-now-12-unit-tests-red-proven-twice-by-the-author-unanchored-includes-mutant-3-fail-and-label-swap-4-fail note=live-probe-reads-3-open-3-homed-0-OWED-on-main -->
<!-- @review pr=540 verdict=carve-out by=S346-bryan date=2026-08-16 probe=file-set-verified-wrap-continuity-only-hand-off-rotation-changelog-master-list-delta-log-zero-code-paths note=session-wrap -->
<!-- @review pr=539 verdict=clean by=S346-bryan date=2026-08-16 probe=dispatched-S239-adversarial-pass-CLEAN-TO-LAND-0-blockers-all-probes-completed-latency-bounded-36-of-36-configs-max-250ms-1000-events-one-tick-0-spurious-compiles-o-eq-source-dir-1-compile-no-loop-watch-counts-FALL-20-to-1-and-36-to-8-new-import-rewatch-works-both-pins-mutation-proven-RED-plus-PA-reproduced-the-starvation-A-B-102ms-vs-never-and-hardened-F1-snapshot-identity-with-ctimeMs-bite-proven note=3-non-blocking-findings-filed-midwrite-500-self-heals-orphaned-dev-servers-cleaned-internal-compiler-error-uncatalogued-by-design -->
<!-- @review pr=537 verdict=clean by=S346-bryan date=2026-08-15 probe=PA-DIRECT-S239-ghost-lint-output-identity-1906-scrml-59-diags-byte-identical-harness-BITE-PROVEN-mutant-diverges-on-unterminated-string-baseline-48-names-unchanged-3-consecutive-cloud-greens note=already-recorded-restated-here-after-the-rebase -->
<!-- @review pr=537 verdict=clean by=S346-bryan date=2026-08-15 probe=PA-DIRECT-S239-the-agent-died-on-a-session-limit-ghost-lint-output-identity-over-1906-scrml-in-samples-examples-benchmarks-conformance-stdlib-59-diags-byte-identical-main-vs-fix-harness-BITE-PROVEN-a-skipping-disabled-mutant-fires-2-lints-on-an-unterminated-string-where-both-fire-0-plus-FAILURE-BASELINE-json-byte-identical-48-names-not-re-recorded-local-browser-gate-PASS-and-3-consecutive-cloud-workflow-dispatch-greens-vs-5-of-8-red-before note=residuals-stated-in-the-PR-beforeAll-budget-failure-naming-and-REASON-parser-edge-cases-not-verified -->
<!-- @review pr=535 verdict=carve-out by=S346-bryan date=2026-08-15 probe=file-set-verified-docs-changes-BRIEFs-known-gaps-pr-reviews-dpa-queue-delta-log-plus-one-repro-scrml-under-docs-changes-that-no-test-enumerates-verified-every-readdirSync-in-compiler-tests-browser-is-over-its-own-outDir-zero-compiler-or-scripts-paths note=S346-PA-curation-docs-only -->
<!-- @review pr=534 verdict=finding by=S346-bryan date=2026-08-15 probe=second-pages-x-hos-scrml-fails-loud-found-2-html-with-119-file-tree-and-empty-out-dir-lists-0-files-but-endsWith-hos-html-false-positives-on-echos-scrml-PA-verified-bun-e-and-the-stray-scrml-layout-shift-mechanism-REFUTED-strays-at-root-and-pages-leave-driver-hos-path-unchanged note=suffix-false-positive-LOW-and-mechanism-claim-refuted -->
<!-- @review pr=531 verdict=finding by=S346-bryan date=2026-08-15 probe=mkdtemp-dir-never-removed-PA-verified-215-dirs-442MB-under-tmp-today-ext4-not-tmpfs-REGRESSION-by-this-PR-and-loud-fail-throws-naming-codes-E-CTX-003-E-STATE-UNDECLARED-while-77-warnings-0-errors-does-not-throw note=disk-leak-regression-LOW -->
<!-- @review pr=530 verdict=finding by=S346-bryan date=2026-08-15 probe=regex-parses-referenced-hash-proven-by-empty-and-noop-runtime-bites-33-25-3-fail-but-a-DANGLING-referenced-runtime-passes-36-36-via-the-silent-try-catch-SCRML_RUNTIME-source-fallback-PA-verified-at-83-88-and-wrong-version-runtimes-pass-36-36 note=oracle-shares-blind-spot-pre-existing-MED -->
<!-- @review pr=527 verdict=clean by=S346-bryan date=2026-08-15 probe=per-level-utf16-sort-equals-scanDirectory-order-0-of-115-artifacts-differ-and-input-order-flips-79-of-115-artifact-bytes-but-the-premise-assertion-is-TRUE-in-12-of-12-orders note=causal-claim-for-the-cloud-red-not-reproduced-hos-ids-move-engine-mount-in-template-never-flips -->
<!-- @review pr=528 verdict=finding by=S346-bryan date=2026-08-15 probe=scanDirectory-already-results-sort-since-initial-commit-44c10543-so-the-walk-sort-is-INERT-and-compileScrml-inputFiles-FORWARD-vs-REVERSED-still-differs-79-of-115-at-the-merge-PA-REPRODUCED-at-2709e540-app-server-js-__ri_route__sessionStore_1-vs-63-CLI-argv-glob-collation-locale-dependent note=defect-mislocated-route-url-nondeterminism-STILL-OPEN-filed-HIGH -->
<!-- @review pr=526 verdict=clean by=S346-bryan date=2026-08-15 probe=six-app-artifact-diff-parent-vs-merge-only-the-once-true-tokens-happydom-double-DCL-parent-click-increments-by-2-merge-by-1-no-production-second-dispatcher-runtime-template-has-no-DCL-listener note=self-host-cg-parts-DCL-registration-still-unonced-pre-existing-LOW -->
<!-- @review pr=524 verdict=clean by=S346-bryan date=2026-08-15 probe=win32-simulated-toRel-through-the-full-pipeline-summary-json-listing-byte-identical-and-the-parent-reproduces-Peters-153-261-51-headline-plus-the-json-absolute-path-leak note=json-hits-and-listing-order-readdir-dependent-pre-existing-LOW -->
<!-- @review pr=532 verdict=carve-out by=S346-bryan date=2026-08-15 probe=file-set-verified-single-path-.github-workflows-ci-yml-no-compiler-code-path-plus-coverage-removal-count-what-it-stops-running-branch-pushes-without-a-PR-now-run-NO-gate-the-PR-gate-remains-the-required-check-and-workflow_dispatch-covers-ad-hoc-branch-runs-bite-proven-S345-its-own-PR-produced-ONE-gate-run-not-two note=ci-trigger-scope-only -->
<!-- @review pr=533 verdict=carve-out by=S346-bryan date=2026-08-15 probe=file-set-verified-via-gh-pr-view-json-files-eight-paths-changelog-four-BRIEFs-hand-off-delta-log-rotated-hand-off-zero-code-paths-the-S345-wrap-PR note=wrap-continuity-docs-only -->
<!-- @review pr=525 verdict=carve-out by=S346-bryan date=2026-08-15 probe=file-set-verified-via-gh-pr-view-json-files-single-path-docs-known-gaps-md-the-S345-Q2-filing-batch-40-entries-plus-2-recharacterisations-zero-code-paths note=gap-ledger-filing-only -->
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

## S335-peter — the floor's next return: a HIGH confidentiality leak in freshly-merged code

Seven PRs owed (#481–#487; #488 is bryan's OPEN wrap, not yet in scope). Four code-bearing got an
independent adversarial pass (satellite fan-out, then I ground-truthed the one HIGH myself on committed
HEAD `ddb924b3`); three are docs/bank/continuity carve-outs. **bryan is WRAPPED — the floor is a shared
surface, safe to take only because he is not live** ([[review-floor-is-shared-surface-collides-with-live-bryan]]).

- **#486** (bryan, `route-inference §12.2`) — **FINDING, HIGH, CONFIRMED FIRSTHAND.** The fix closes the
  derived-cell-RHS server-only-reach leak at top level and in plain `${…}` child blocks, but **misses a
  derived cell nested in a `for`-loop `lift` body** — exit 0, no `.server.js`, and `Bun.password`
  (argon2id) + the secret ship to the browser. I reproduced it on HEAD (control: the identical top-level
  cell correctly fires `E-DERIVED-SERVER-ONLY-REACH`). This is the standing *verify-the-CLASS-not-the-
  instance* lesson — the fix's own evasion tests probe RHS *shape*, never a nesting-*position* variant. It
  is a new position in the already-tracked `g-cell-initialiser-and-markup-interp-server-only-reach-do-not-
  escalate` family (locus `route-inference.ts:1086`, `pending-bryan-escalate-vs-refuse`). **Bryan's lane:
  reviewed + filed + routed (`incoming/…486-high-leak-for-loop-lift-body.md`); NOT fixed by me** — the
  family shares one substrate and its escalate-vs-refuse ruling is his and unresolved. Gap filed
  `g-derived-server-only-reach-misses-for-loop-lift-body` (HIGH). Two lower same-review finds relayed to
  bryan (satellite-reported, NOT independently confirmed): escape-hatch rawscan over-fires as a hard
  refusal on the derived path (LOW/latent); the conformance cases gate the diagnostic CODE, not the
  emitted-bundle leak facts (why the HIGH slipped a green suite).
- **#481** (bryan, `scripts/review-debt.ts`) — **FINDING, LOW/latent.** The floor's own instrument: its
  code-bearing classifier whitelists `compiler|stdlib|scripts|conformance/cases` but not `lsp/`,
  `editors/`, `dashboard/`, `e2e/`, or the conformance *harness* — a PR landing solely in those trees is
  silently carve-out-invisible. Core arithmetic reconciled EXACT against an independent reimplementation
  (98 in-scope, 91 recorded, owed set byte-identical); the headline `limit 40→150` fix provably enumerates
  the full population. Does not bite today (no in-scope PR touches those dirs alone). Gap deferred to the
  ledger-hygiene pass.
- **#484** (peter) — **CLEAN.** Independent re-review (14 executed-emit probes across the gated
  value/bool/class regime + ungated if=/show=, both filed siblings, and over-gating cases); the S312
  input-state path verified non-regressing; siblings correctly still-broken. Unit 8/8, conformance case 1/1.
- **#485** (peter) — **CLEAN.** Parser-fix boundary holds both ways (11-case probe: adjacent/multi-line/
  angle-in-body/arrow-in-body markers; unclosed still fails LOUD via the count cross-check); dedup throws
  only on real conflicts; drift is genuinely WARN-only (cannot flip the gate). `bun scripts/state.ts`
  exit 0 → HIGH 26 · MED 126 · LOW 56, no throw. One dormant out-of-scope note (the malformed cross-check
  hard-codes `id=` first) → deferred to the ledger-hygiene pass. Test 6/6.
- **#482** (bryan, `#474` findings + floor-to-zero) — **CARVE-OUT.** `docs/known-gaps.md` +
  `docs/pr-reviews.md`; no code path.
- **#483** (bryan, `bank(dpa-024)`) — **CARVE-OUT.** `handOffs/dpa-queue.md`; deliberation bank, no code.
- **#487** (peter, `continuity(S334)` wrap) — **CARVE-OUT.** `changelog`/`hand-off`/`delta-log`; continuity, no code.

<!-- @review pr=486 verdict=finding by=S335-peter date=2026-08-09 probe=independent-satellite-adversarial-then-PA-groundtruthed-on-committed-HEAD-ddb924b3-real-emit-for-loop-lift-body-derived-cell-ships-Bun.password-argon2id-plus-secret-to-client-no-server-js-control-top-level-fires-E-DERIVED-SERVER-ONLY-REACH-new-position-in-pending-bryan-family-routed-not-fixed -->
<!-- @review pr=481 verdict=finding by=S335-peter date=2026-08-09 probe=full-read-plus-ran-and-hand-reconciled-counts-exact-against-independent-reimpl-98-in-scope-91-recorded-owed-set-byte-identical-limit-40to150-enumerates-full-population-LOW-latent-codebearing-whitelist-misses-lsp-editors-dashboard-e2e-conformance-harness-not-biting-today -->
<!-- @review pr=484 verdict=clean by=S335-peter date=2026-08-09 probe=independent-14-executed-emit-probes-gated-value-bool-class-plus-ungated-if-show-plus-both-filed-siblings-plus-over-gating-s312-input-state-nonregressing-unit-8of8-conformance-1of1 -->
<!-- @review pr=485 verdict=clean by=S335-peter date=2026-08-09 probe=independent-11-case-parser-boundary-probe-both-ways-adjacent-multiline-angle-arrow-unclosed-fails-loud-dedup-throws-on-real-conflict-drift-warn-only-ran-state-ts-exit0-HIGH26-MED126-LOW56-test-6of6-one-dormant-out-of-scope-note-deferred -->
<!-- @review pr=482 verdict=carve-out by=S335-peter date=2026-08-09 probe=docs-known-gaps-and-pr-reviews-md-no-code-path -->
<!-- @review pr=483 verdict=carve-out by=S335-peter date=2026-08-09 probe=handoffs-dpa-queue-md-deliberation-bank-no-code-path -->
<!-- @review pr=487 verdict=carve-out by=S335-peter date=2026-08-09 probe=changelog-handoff-deltalog-continuity-wrap-no-code-path -->
<!-- @review pr=489 verdict=carve-out by=S335-peter date=2026-08-09 probe=self-the-review-floor-drain-PR-docs-pr-reviews-and-known-gaps-md-detection-only-no-code-path -->
<!-- @review pr=490 verdict=carve-out by=S335-peter date=2026-08-09 probe=self-the-ledger-hygiene-PR-docs-known-gaps-and-pr-reviews-md-ledger-flips-and-filings-no-code-path -->
<!-- @review pr=491 verdict=carve-out by=S336-peter date=2026-08-09 probe=S335-wrap-PR-continuity-handoff-changelog-deltalog-pr-reviews-no-code-path -->
<!-- @review pr=492 verdict=finding by=S336-peter date=2026-08-09 probe=independent-adversarial-falsify-scripts-boot-ts-found-3-all-fixed-and-reverified-unanchored-pickup-indexOf-false-passes-on-codespan-mention-MED-now-anchored-linestart-plus-windows-trailing-backslash-strip-plus-item7-mandate-comment-bite-proven-in-sandbox -->
<!-- @review pr=493 verdict=carve-out by=S337-bryan date=2026-08-10 probe=S336-wrap-continuity-docs-only-no-compiler-stdlib-conformance-scripts-path-VERIFIED-file-set-not-assumed-plus-reran-state-ts-check-on-merged-main-confirming-the-gap-count-regen-26-126-56-to-27-122-58-is-correct -->
<!-- @review pr=494 verdict=carve-out by=S337-bryan date=2026-08-10 probe=S336-wrap-followup-three-docs-files-changelog-handoff-deltalog-no-code-path-file-set-verified -->
<!-- @review pr=495 verdict=carve-out by=S337-bryan date=2026-08-10 probe=SELF-REVIEW-S337-own-PR-claude-maps-nav-map-regen-only-generated-navigation-artifacts-no-compiler-stdlib-conformance-scripts-path-content-is-project-mapper-output-not-hand-authored -->
<!-- @review pr=496 verdict=carve-out by=S337-bryan date=2026-08-10 probe=SELF-REVIEW-S337-own-PR-continuity-relanding-of-488-purely-additive-167-insertions-0-deletions-verified-no-deletion-of-peter-S334-S336-work-plus-delta-log-duplicate-id-set-diffed-byte-identical-to-main-after-renumber -->
<!-- @review pr=497 verdict=carve-out by=S337-bryan date=2026-08-10 probe=SELF-REVIEW-own-PR-docs-pr-reviews-md-markers-only-no-code-path -->
<!-- @review pr=498 verdict=finding by=S337-bryan date=2026-08-10 probe=independent-adversarial-scripts-boot-ts-THREE-rounds-r1-found-my-fix-was-right-by-accident-one-line-section-capture-under-m-r2-found-a-FAIL-OPEN-pending-scope-that-printed-full-read-set-present-over-an-absent-read-r3-converged-to-a-machine-readable-ledger-marker-deleting-the-prose-scan-entirely-bite-proven-both-directions -->
<!-- @review pr=499 verdict=finding by=S337-bryan date=2026-08-10 probe=PA-executed-scripts-dpa-debt-ts-rather-than-read-caught-2-bugs-unanchored-contains-match-flagged-dpa-022-023-as-UNRUN-because-their-cells-NARRATE-that-string-third-unanchored-match-instance-this-session-plus-ratification-lives-in-column-3-so-col2-only-reading-reported-RATIFIED-S319-items-as-owed-bite-proven-synthetic-UNRUN-row -->
<!-- @review pr=500 verdict=finding by=S337-bryan date=2026-08-10 probe=independent-adversarial-route-inference-6-findings-sharpest-was-parent-loc-spans-in-the-skip-list-are-not-RI-time-node-fields-so-dead-entries-were-FAIL-OPEN-SURFACE-and-TWO-TESTS-PINNED-THAT-MISS-AS-CORRECT-measured-six-entry-list-trimmed-list-and-NO-list-all-collect-the-same-68-cells-plus-a-tmpdir-race-a-readdir-guard-a-depth-cap-and-a-false-order-comment -->
<!-- @review pr=502 verdict=carve-out by=S337-bryan date=2026-08-10 probe=SELF-REVIEW-own-PR-dpa-queue-md-deliberation-bank-no-code-path-verified-visible-to-the-dpa-probe-as-1-UNRUN -->
<!-- @review pr=504 verdict=finding by=S338-bryan date=2026-08-11 probe=S337-wrap-continuity-file-set-VERIFIED-6-docs-files-no-compiler-stdlib-conformance-scripts-path-plus-reran-state-ts-check-on-merged-main-PASS-BUT-the-hand-off-carries-a-FALSE-STATE-CLAIM-it-flags-worktree-a90924554f6a7f288-classify-write-as-NOT-LANDED-AND-EASY-TO-LOSE-when-the-work-is-on-fix-classify-write-land-e566d0bd-and-PUSHED-same-for-g263-round-2-on-fix-g263-seed-convergence-land-1cf602c1-pushed-both-are-PR-less-not-unlanded-corrected-in-board-S338-bryan-md note=wrap-handoff-false-at-risk-claim -->
<!-- @review pr=505 verdict=carve-out by=S338-bryan date=2026-08-11 probe=SELF-REVIEW-inherited-PR-2-files-delta-log-and-dpa-queue-md-deliberation-results-landing-no-code-path-file-set-verified-plus-EXECUTED-scripts-dpa-debt-ts-on-merged-main-confirming-dpa-025-reads-ADVISORY-not-UNRUN-to-the-probe-that-drains-it -->
<!-- @review pr=506 verdict=carve-out by=S338-bryan date=2026-08-11 probe=SELF-REVIEW-own-PR-docs-pr-reviews-md-markers-only-file-set-verified-single-file-no-compiler-stdlib-conformance-scripts-path-plus-EXECUTED-scripts-review-debt-ts-pre-and-post-confirming-113-of-113-recorded-0-OWED-rather-than-reading-the-ledger -->
<!-- @review pr=503 verdict=carve-out by=S338-bryan date=2026-08-11 probe=SELF-REVIEW-inherited-PR-dpa-queue-md-only-deliberation-bank-no-code-path-BUT-NOT-A-BARE-CARVE-OUT-the-rebase-hit-a-REAL-3-way-conflict-with-505-on-the-dpa-025-row-resolved-by-keeping-505s-newer-COMPLETE-ADVISORY-row-and-adding-026-then-VERIFIED-BY-EXECUTING-dpa-debt-ts-which-reported-26-queued-1-UNRUN-dpa-026-4-ADVISORY-not-by-reading-the-file-plus-a-windows-check-FAILED-on-this-docs-only-PR-single-test-module-linkage-EXECUTES-6039ms-timeout-shaped-did-NOT-merge-past-it-re-fired-via-rebase-and-it-PASSED-flake-confirmed-by-execution-not-argument -->
<!-- @review pr=522 verdict=carve-out by=S344-peter date=2026-08-13 probe=S343-bryan-wrap-file-set-VERIFIED-changelog-hand-off-delta-log-plus-read-moves-no-compiler-stdlib-scripts-conformance-path-plus-git-groundtruthed-the-sharp-state-claim-8ad13b84-fix-g263-seed-convergence-land-is-NOT-an-ancestor-of-origin-main-HOLDS-and-review-derived-transitive-r1-r2-tags-are-local-only-to-bryan-per-delta-log-1460-so-unverifiable-by-fact-not-by-defect -->
<!-- @review pr=521 verdict=carve-out by=S344-peter date=2026-08-13 probe=S341-peter-wrap-file-set-VERIFIED-changelog-known-gaps-delta-log-no-code-path-scanned-hand-off-prose-for-false-not-landed-or-at-risk-state-claims-NONE -->
<!-- @review pr=520 verdict=carve-out by=S344-peter date=2026-08-13 probe=S341-peter-to-bryan-inbox-single-handOffs-incoming-message-md-no-code-path -->
<!-- @review pr=514 verdict=carve-out by=S344-peter date=2026-08-13 probe=S341-bryan-maps-refresh-13-claude-maps-are-project-mapper-GENERATED-generated-at-stamps-plus-docs-changes-brief-progress-NO-scripts-or-hook-path-so-the-stamp-durability-rule-landed-as-docs-not-code -->
<!-- @review pr=513 verdict=carve-out by=S344-peter date=2026-08-13 probe=S338-bryan-wrap-file-set-VERIFIED-changelog-hand-off-delta-log-hand-off-s339-incoming-master-list-no-code-path-the-NOT-LANDED-line-is-the-lesson-quote-of-the-504-mistake-not-a-new-false-claim-and-zero-arcs-merged-holds-g263-confirmed-not-on-main -->
<!-- @review pr=518 verdict=clean by=S344-peter date=2026-08-13 probe=independent-worktree-adversarial-ran-dev-compile-failure-serves-error-test-13of13-plus-drove-buildServeConfig-fetch-noteCompileResult-buildCompileErrorResponse-directly-short-circuit-sits-after-infra-live-reload-and-log-and-before-BOTH-route-dispatch-AND-static-500-not-404-covers-both-branches-fail-fix-fail-toggles-content-type-html-vs-json-correct-underlying-ungated-write-disk-clobber-latent-but-explicitly-disclosed-not-masked -->
<!-- @review pr=516 verdict=clean by=S344-peter date=2026-08-13 probe=independent-worktree-adversarial-reproduced-the-515-hole-on-515-state-var-and-tilde-decl-at-body1-silent-then-fires-post-516-ran-a-full-silent-hole-detector-over-let-const-function-lin-var-tilde-bare-assign-state-use-enum-engine-reactive-snippet-render-NO-decl-kind-still-slips-silent-guard-set-plus-E-SCOPE-001-cover-the-class-sample-flip-honest-SPEC-17.7.3-fail-closed-aligned -->
<!-- @review pr=515 verdict=clean by=S344-peter date=2026-08-13 probe=independent-worktree-adversarial-EXECUTED-emitted-tool-8-name-shapes-dollar-underscore-renamed-nested-member-string-dead-mixed-all-live-print-42-dead-dropped-monotone-safe-old-only-over-KEPT-non-references-prune-applicability-unchanged-plus-each-body-decl-guard-fires-all-positions-note-pinned-integration-test-asserts-presence-not-execution-test-strength-gap-not-a-defect -->
<!-- @review pr=512 verdict=finding by=S344-peter date=2026-08-13 probe=independent-worktree-adversarial-shipped-fix-reparseLiftAttrRequestRef-at-3-attr-value-sites-1448-if-1530-classNAME-1713-setAttribute-is-CORRECT-non-request-lift-byte-identical-pre-post-BUT-the-PR-body-claim-event-handler-all-correct-and-completes-the-class-is-FALSIFIED-a-req-leading-event-handler-in-a-lift-onclick-misroutes-emit-lift-1684-unpatched-PA-confirmed-structurally note=overstated-completes-class-eventhandler-reqref-misroute-filed-as-gap-preexisting-not-a-512-regression -->
<!-- @review pr=511 verdict=clean by=S344-peter date=2026-08-13 probe=independent-worktree-adversarial-compiled-each-body-class-bool-if-show-classNAME-mid-string-request-refs-at-parent-b0e432d-all-registry-misroute-vs-HEAD-all-_scrml_request-data-non-request-each-client-byte-identical-pre-post-gate-rawReferencesRegisteredRequest-correct-unregistered-typo-not-made-worse -->
<!-- @review pr=510 verdict=clean by=S344-peter date=2026-08-13 probe=independent-worktree-adversarial-compile-diff-parent-4076e0fb-vs-HEAD-tick-tag-body-beforeWiring-1-to-0-no-module-init-run-poll-immediate-fires-exactly-once-running-gated-no-double-fire-on-immediate-plus-interval-or-resume-channel-and-request-exclusions-provably-correct-channel-sole-run-byte-identical-E-MARKUP-001-timeout-false-positive-gone-nested-and-each-siblings-clean-pin-7of7 -->
<!-- @review pr=508 verdict=finding by=S344-peter date=2026-08-13 probe=independent-worktree-adversarial-compile-diff-at-merged-508-1bfa8544-vs-HEAD-shipped-TWO-HIGH-silent-miscompiles-MISSED-by-508-landing-review-each-body-decl-guard-body0-only-plus-3-kind-allowlist-so-decl-at-body1-or-var-tilde-emits-dangling-String-nm-exit-0-zero-diagnostics-list-renders-empty-AND-tool-import-b-word-boundary-predicate-drops-dollar-prefixed-local-runtime-ReferenceError-BOTH-already-REMEDIATED-on-HEAD-by-515-and-516-gaps-filed-and-fixed-SSR-lint-emit-ssr-render-and-282-ledger-arcs-clean note=two-high-silent-miscompiles-caught-retroactively-both-remediated-515-516 -->
<!-- @review pr=507 verdict=finding by=S344-peter date=2026-08-13 probe=independent-worktree-adversarial-plus-PA-ran-the-script-code-bearing-artifact-is-scripts-source-text-regex-census-ts-cross-OS-separator-bug-PRE_AST_MARKERS-forward-slash-commands-migrate-promote-native-parser-matched-via-rel-includes-against-join-built-OS-sep-paths-and-rel-strip-hardcodes-slash-so-on-windows-commands-migrate-27-plus-promote-2-misclassify-POST-AST-headline-261-51-windows-vs-232-49-authority-host-OS-dependent-plus-abs-path-leak-in-default-output note=crossos-census-separator-misclassifies-preast-MED-plus-LOW-path-leak-filed-as-gap -->
<!-- @review pr=523 verdict=carve-out by=S345-bryan date=2026-08-14 probe=file-set-verified-via-gh-pr-view-json-files-six-paths-changelog-known-gaps-pr-reviews-hand-off-delta-log-inbox-message-zero-code-paths-docs-only-review-floor-drain-PR note=the-floor-drain-PR-itself-docs-only-carve-out -->
<!-- @review pr=542 verdict=carve-out by=S347-bryan date=2026-08-16 probe=file-set-verified-via-gh-pr-view-json-files-fifteen-paths-thirteen-claude-maps-project-mapper-GENERATED-plus-docs-pr-reviews-plus-handOffs-delta-log-ZERO-code-paths-no-scripts-no-compiler-no-conformance-no-hook-so-S346-wrap-6c-maps-refresh-is-docs-only note=the-floor-recording-recursion-a-floor-binding-MERGED-PRs-can-never-read-0-at-the-instant-a-floor-recording-PR-merges -->
<!-- @review pr=543 verdict=carve-out by=S347-bryan date=2026-08-16 probe=file-set-verified-via-gh-pr-view-json-files-two-paths-handOffs-dpa-queue-md-plus-docs-pr-reviews-md-ZERO-code-paths-no-compiler-no-scripts-no-conformance-docs-only-deliberation-bank note=the-floor-recording-recursion-again-each-floor-recording-docs-PR-mints-exactly-one-new-debt-self-drains-at-rate-one -->
<!-- @review pr=544 verdict=carve-out by=S347-bryan date=2026-08-17 probe=file-set-verified-docs-only-known-gaps-pr-reviews-delta-log-dpa-queue-changes-SCOPING-plus-a-rebase-onto-nine-concurrent-peter-landings-conflicts-resolved-additively-for-append-only-streams-and-by-REGENERATION-for-the-generated-rollup-zero-code-paths note=merging-two-generated-blocks-textually-would-have-produced-a-count-matching-neither-tree -->

<!-- @review pr=545 verdict=carve-out by=S349-peter date=2026-08-17 probe=file-set-verified-via-gh-pr-view-json-files-two-paths-docs-changelog-md-plus-handOffs-delta-log-md-ZERO-code-paths-docs-only-sliding-doors-audit-coverage-close-wrap note=continuity-wrap-carve-out -->
<!-- @review pr=547 verdict=clean by=S349-peter date=2026-08-17 probe=PA-read-the-diff-corpus-enumerator-js-enumerateScrmlCorpus-and-enumerateBenchCorpus-now-sort-by-POSIX-normalized-relpath-using-CODE-UNIT-comparison-a-lt-b-NOT-localeCompare-so-Windows-and-Linux-enumerate-identically-relpaths-are-unique-so-no-tie-instability-allowlist-is-relpath-KEYED-so-this-reorders-REPORTING-only-not-parity-pass-fail-the-i-mod-STEP-exemplar-sample-now-tests-the-same-20-files-per-machine note=test-enumeration-determinism-no-adopter-blast-radius-clean -->
<!-- @review pr=548 verdict=clean by=S349-peter date=2026-08-17 probe=PA-read-the-diff-render-corpus-enumerator-walkDir-and-validate-emit-gate-walkScrml-walkJs-and-census-walk-now-readdirSync-sort-default-UTF16-code-unit-OS-stable-plus-entries-sort-by-name-code-unit-clears-the-S345-order-dependency-sweep-tail-4-sites note=LOW-residual-the-chosen-appScrml-or-programFiles-0-entry-pick-still-ties-on-IDENTICAL-basenames-in-a-pathological-multi-program-app-lacking-app-scrml-pre-existing-and-narrower-not-a-548-regression -->
<!-- @review pr=549 verdict=carve-out by=S349-peter date=2026-08-17 probe=file-set-verified-single-path-docs-known-gaps-md-ZERO-code-paths-docs-only-gaps-ledger-filing-of-g-bare-arrow-binding-false-e-mu-001-RULING-NEEDED note=gaps-filing-docs-only-carve-out-the-underlying-bare-arrow-must-use-bug-is-routed-to-bryan-not-fixed-in-this-PR -->
<!-- @review pr=551 verdict=carve-out by=S349-peter date=2026-08-17 probe=file-set-verified-two-paths-docs-changelog-md-plus-handOffs-delta-log-md-ZERO-code-paths-docs-only-continuity-2-wrap note=continuity-wrap-carve-out -->
<!-- @review pr=552 verdict=clean by=S349-peter date=2026-08-17 probe=PA-read-the-diff-corpus-zero-debt-test-js-pins-the-PURE-classifier-contract-matchVocab-word-boundaried-no-yagni-inside-yagnitude-case-insensitive-parseMarkers-marker-SHAPE-only-not-prose-markerCloses-blast-radius-data-and-load-bearing-plus-overruled-close-bare-load-bearing-does-NOT-markerViolates-self-reported-load-bearing-never-silently-closed-by-a-sibling-artifactDate-filename-first-then-frontmatter-injected-epoch-no-disk-network-clock-20of20 note=self-authored-R1-probe-adversary-is-the-suite-plus-the-run-1-bite-proof-on-real-corpus-script-only-not-compiler-src-no-adopter-blast-radius-clean -->
<!-- @review pr=553 verdict=carve-out by=S349-peter date=2026-08-17 probe=file-set-verified-four-paths-docs-changelog-known-gaps-hand-off-plus-handOffs-delta-log-ZERO-code-paths-docs-only-S348-peter-wrap-R6-retrigger-continuity note=continuity-wrap-carve-out-the-R6-ledger-update-is-docs-the-decl-span-overshoot-fix-is-a-deferred-dual-parser-lockstep-follow-up -->
<!-- @review pr=554 verdict=carve-out by=S349-peter date=2026-08-17 probe=file-set-verified-four-paths-docs-changelog-pr-reviews-plus-hand-off-plus-master-list-ZERO-code-paths-docs-only-S347-bryan-wrap-the-seven-rulings-are-EXECUTED-into-HELD-branches-not-landed-on-main-so-main-received-docs-only note=the-three-code-branches-comment-token-215984b9-D2D3D4-45fc29b5-dtr-r7-152dfa47-are-on-bryans-own-remote-NOT-origin-so-origin-main-is-docs-only-here -->
<!-- @review pr=546 verdict=finding by=S349-peter date=2026-08-17 probe=independent-adversarial-satellite-plus-PA-verified-the-input-order-canonicalisation-sorts-the-NATIVE-separator-resolvedInputFiles-map-resolve-f-sort-at-api-js-so-backslash-0x5C-sorts-AFTER-digits-while-slash-0x2F-sorts-BEFORE-a-nested-subdir-entry-vs-a-prefix-colliding-sibling-sub-slash-a-vs-sub2-FLIPS-order-across-OS-and-ids-mint-in-traversal-order-so-a-windows-client-and-linux-server-disagree-on-a-ri-route-fetch-URL-the-exact-58-two-machines-divergence-546s-OWN-comment-cites-as-motivation-left-open-on-the-separator-axis-dedup-key-was-separator-canonical-PathKeyedSet-but-the-sort-key-was-not note=MED-cross-OS-the-same-machine-argv-order-claim-546-made-HOLDS-and-is-well-tested-the-refutation-is-the-broader-cross-machine-58-goal-the-diff-invokes-FIXED-in-follow-up-PR-556-separator-canonical-sort-key-plus-synthetic-cross-OS-pin -->
<!-- @review pr=550 verdict=finding by=S349-peter date=2026-08-17 probe=independent-adversarial-satellite-plus-PA-reproduced-on-HEAD-both-site-and-class-stripRedundantCode-covers-dev-js-error-492-lint-455-and-throw-433-but-MISSES-the-fourth-diagnostic-site-the-non-fatal-warning-loop-dev-js-469-which-prepends-bracket-code-then-prints-w-message-RAW-so-self-prefixed-W-star-warnings-W-PROGRAM-001-W-CONST-AT-DEPRECATED-W-PROGRAM-SPA-INFERRED-W-STATE-BLOCK-BARE-WRITE-DECL-all-verified-in-ast-builder-js-double-print-their-code-AND-the-redundant-prefix-eats-the-120-char-slice-the-exact-class-550-claimed-to-close-dev-js-has-4-sites-fix-covered-3 note=LOW-dev-mode-warning-cosmetics-plus-minor-truncation-no-miscompile-FIXED-in-follow-up-PR-555-mirrors-the-3-sibling-sites-plus-regression-test-disclosed-residuals-semdiff-js-364-out-of-scope-per-550-and-dev-js-644-browser-overlay-HTML-different-surface -->
<!-- @review pr=555 verdict=clean by=S351-peter date=2026-08-18 probe=PA-read-the-diff-dev-js-469-warning-loop-now-routes-w-message-through-stripRedundantCode-w-code-w-message-BEFORE-the-120-char-slice-mirroring-the-3-verified-sibling-sites-error-492-lint-455-throw-433-strip-then-slice-is-the-correct-order-so-the-slice-sees-real-content-helper-passes-undefined-null-message-through-unchanged-tested-plus-a-new-W-PROGRAM-001-self-prefix-regression-test-pins-the-warning-path-diagnostic-format-8of8-completes-the-4th-site-550-missed note=the-fix-that-completed-the-550-finding-verified-clean-on-its-own-diff -->
<!-- @review pr=556 verdict=clean by=S351-peter date=2026-08-18 probe=PA-read-the-diff-adversarially-compileScrml-seed-sort-swapped-from-native-sort-to-sort-compareInputPathsCanonical-which-folds-backslash-to-slash-for-the-compare-KEY-only-code-unit-ka-lt-kb-host-independent-values-stay-native-for-the-filePath-contract-so-a-Windows-and-Linux-host-sort-the-same-logical-SET-into-the-same-ORDER-same-id-mint-order-closing-the-58-cross-OS-flip-ties-return-0-ONLY-for-same-logical-path-different-separator-which-PathKeyedSet-dedups-anyway-so-the-tie-is-benign-not-a-stability-hole-POSIX-identical-on-CI-no-backslash-to-fold-zero-gate-regression-determinism-27of27-plus-a-SYNTHETIC-9-cross-OS-pin-feeds-both-separator-spellings-directly-so-it-runs-on-either-host-which-8-single-host-could-not note=the-fix-that-completed-the-546-finding-verified-clean-FACTS-md-is-the-regenerated-derived-count -->
<!-- @review pr=557 verdict=carve-out by=S351-peter date=2026-08-18 probe=file-set-verified-via-gh-pr-diff-name-only-six-paths-docs-changelog-known-gaps-pr-reviews-plus-hand-off-plus-handOffs-delta-log-plus-incoming-S349-peter-dpa030-OQ-memo-ZERO-code-paths-docs-only-S349-peter-wrap note=continuity-wrap-carve-out-the-incoming-memo-is-a-delivery-to-bryan-not-code -->
<!-- @review pr=558 verdict=carve-out by=S351-peter date=2026-08-18 probe=file-set-verified-via-gh-pr-diff-name-only-single-path-handOffs-delta-log-md-ONLY-1542-dpa-029-Q1-bank-ZERO-code-paths-docs-only-S349-peter-close note=continuity-close-carve-out-delta-log-only -->
<!-- @review pr=560 verdict=finding by=S351-peter date=2026-08-18 probe=PA-authored-fix-run-through-THREE-independent-S239-satellite-rounds-before-merge-round1-found-build-js-744-and-dev-js-488-formatters-read-filePath-or-span-file-never-the-flat-file-field-so-the-source-file-stamped-on-file-was-dropped-on-scrml-build-and-dev-the-two-most-common-surfaces-opposite-of-519-intent-FIXED-added-or-e-file-mirroring-compile-js-plus-regression-pin-round2-found-the-emitted-star-span-fields-were-dead-zero-readers-DROPPED-per-operator-plus-relaxed-an-over-strong-scrml-suffix-test-assertion-round3-CONVERGED-material-items-are-pre-existing-broader-than-519-filed-as-g-emit-gate-source-anchor-synthetic-artifact-and-cli-truncation-LOW note=PA-reproduced-every-claim-scrml-compile-shows-full-snippet-build-dev-restore-the-file-issue-519-closed-with-SHA-a6a90df6 -->
<!-- @review pr=561 verdict=clean by=S351-peter date=2026-08-18 probe=PA-read-the-diff-resolveWho-slugified-git-user-name-Peter-to-peter-to-a-nonexistent-pa-profile-peter-md-failing-boot-gate-read-set-items-6b-and-7-every-Peter-boot-fix-adds-SLUG_ALIAS-peter-to-pjoliver11-applied-after-the-first-token-split-additive-and-no-op-for-bryan-ryan-anyone-whose-first-token-IS-their-slug-keeps-real-name-commit-authorship-verified-bun-scripts-boot-ts-now-reports-BOOT-GATE-PASS-was-FAIL-2-read-set-files-missing note=trivial-additive-lane-tooling-no-op-for-others-no-findings-boot-gate-flips-green -->
<!-- @review pr=562 verdict=finding by=S351-peter date=2026-08-18 probe=PA-authored-convergence-fix-satellite-built-worktree-iso-then-PA-VERIFIED-INDEPENDENTLY-not-relayed-8of8-parsed-node-lift-positions-route-while-do-while-lift-each-in-for-if-while-do-while-lift-each-in-each-GATE-holds-non-request-hash-id-stays-on-registry-never-over-routes-6-suite-fails-identical-on-main-self-host-parity-plus-CSRF-S239-round-found-4-altitude-findings-2-HARDENED-finding4-prefer-then-fallback-changed-to-UNION-authoritative-finding2-duplicated-fallback-rule-unified-into-one-helper-2-FILED-as-g-request-id-threading-not-fully-consolidated-LOW note=HIGH-family-reopened-3x-511-512-this-CONVERGED-to-single-per-file-currentFileRequestIds-sibling-string-fallback-seam-filed-g-request-ref-mixed-string-attr-in-lift-misroute-MED-SHA-662ff57e -->

<!-- @review pr=563 verdict=carve-out by=S352-bryan date=2026-08-19 probe=file-set-verified-via-gh-pr-diff-name-only-four-paths-docs-changelog-plus-docs-pr-reviews-plus-hand-off-plus-handOffs-delta-log-ZERO-code-paths-docs-only-S351-peter-wrap note=continuity-wrap-carve-out-drained-at-S352-boot-the-floor-had-carried-it-1-OWED -->
<!-- @review pr=564 verdict=carve-out by=S352-bryan date=2026-08-19 probe=file-set-verified-via-gh-pr-diff-name-only-seven-paths-docs-changelog-plus-docs-known-gaps-plus-hand-off-plus-handOffs-delta-log-plus-handOffs-dpa-queue-plus-two-handOffs-incoming-read-moves-ZERO-code-paths-docs-only-S350-bryan-wrap note=continuity-wrap-carve-out-merged-at-S352-boot-it-had-sat-OPEN-since-0808-itself-an-instance-of-the-delivery-bottleneck-S350-named -->
<!-- @review pr=565 verdict=carve-out by=S352-bryan date=2026-08-19 probe=file-set-verified-via-gh-pr-diff-name-only-two-paths-docs-pr-reviews-plus-handOffs-delta-log-ZERO-code-paths-the-gc-fix-itself-was-local-git-object-state-not-repo-content note=continuity-carve-out-self-recorded-at-wrap -->
<!-- @review pr=566 verdict=carve-out by=S352-bryan date=2026-08-19 probe=file-set-verified-two-paths-handOffs-dpa-queue-plus-handOffs-delta-log-ZERO-code-paths-dpa-033-ratification-banking note=continuity-carve-out -->
<!-- @review pr=567 verdict=carve-out by=S352-bryan date=2026-08-19 probe=file-set-verified-two-paths-handOffs-dpa-queue-plus-handOffs-delta-log-ZERO-code-paths-dpa-035-bank-plus-M4-disposition note=continuity-carve-out-the-M4-finding-itself-was-PA-verified-by-execution-all-four-cells-but-this-PR-carries-no-code -->
<!-- @review pr=568 verdict=carve-out by=S352-bryan date=2026-08-19 probe=file-set-verified-three-paths-docs-known-gaps-plus-handOffs-dpa-queue-plus-handOffs-delta-log-ZERO-code-paths-dpa-029-Q1-ruling-plus-the-stale-16KB-margin-correction note=continuity-carve-out-the-globalThis-Response-leak-premise-was-PA-reproduced-by-execution-before-the-ruling-not-relayed -->
<!-- @review pr=569 verdict=carve-out by=S352-bryan date=2026-08-19 probe=file-set-verified-single-path-handOffs-delta-log-md-ONLY-1584-the-gate-ruling-ZERO-code-paths note=continuity-carve-out-delta-log-only -->
<!-- @review pr=570 verdict=carve-out by=S352-bryan date=2026-08-19 probe=file-set-verified-two-paths-handOffs-dpa-queue-plus-handOffs-delta-log-ZERO-code-paths-dpa-032-plus-dpa-035-ratifications-rebased-through-a-delta-log-append-collision-resolved-additively-1584-and-1585-both-kept note=continuity-carve-out -->
<!-- @review pr=571 verdict=clean by=S352-bryan date=2026-08-19 probe=PA-REPRODUCED-THE-BITE-INDEPENDENTLY-not-relayed-inserted-2960-B-of-high-entropy-comment-at-the-mount-chunk-shell-only-region-of-runtime-template-js-NEW-ratchet-FAILED-measured-28963-B-ceiling-26268-B-over-by-2695-B-while-the-PRE-EXISTING-only-gzip-assertion-in-the-tree-stayed-19-pass-0-fail-completely-blind-then-restored-and-re-ran-8-pass-0-fail-ALSO-ran-the-ratchet-file-alone-8-pass-and-the-full-suite-reproducing-the-authors-30041-pass-53-fail-exactly-and-a-FIRST-probe-of-mine-using-repetitive-filler-slipped-through-silently-which-is-correct-behaviour-the-ratchet-gates-shipped-gzip-bytes-not-source-bytes-and-that-property-is-now-recorded note=no-compiler-src-change-test-plus-docs-only-the-band-is-188-B-equals-2x-the-measured-94-B-implementation-delta-with-the-gzip-FNAME-header-and-zlib-level-axes-closed-by-gzipping-an-in-memory-Buffer-at-explicit-level-9 -->
<!-- @review pr=572 verdict=carve-out by=S352-bryan date=2026-08-19 probe=file-set-verified-two-paths-handOffs-dpa-queue-plus-handOffs-delta-log-ZERO-code-paths-dpa-022-ratification-banking note=continuity-carve-out-its-mechanism-gap-premise-was-PA-reproduced-by-execution-both-sides-before-the-ruling -->

<!-- @review pr=573 verdict=carve-out by=S354-peter date=2026-08-19 probe=file-set-verified-via-gh-pr-diff-name-only-single-path-docs-known-gaps-md-ONLY-ZERO-code-files-files-g-lifecycle-read-detector-requires-a-dot-MED-then-PA-read-the-diff-adversarially-the-filed-gap-is-grounded-not-a-false-gap-reproduced-by-execution-BOTH-sides-same-annotation-struct-field-read-through-a-dot-at-u-passwordHash-fires-E-TYPE-001-while-a-bare-Shape-1-cell-read-at-status-Compiled-exit-0-so-the-detector-is-dot-requiring-and-a-no-op-on-100pct-of-markup-typed-and-Shape-1-positions-locus-type-system-ts-25193-runLifecycleAccessCheck-honest-MED-severity-zero-tracked-scrml-carries-a-Shape-1-lifecycle-annotation-and-the-documented-passwordHash-security-case-goes-through-a-dot-and-DOES-fire-so-no-data-loss-path-correctly-tagged-a-Rule-7-instance-S338 note=docs-only-gap-filing-carve-out-the-MED-gap-itself-is-PA-reproduced-both-sides-with-a-real-locus-not-relayed -->
<!-- @review pr=574 verdict=carve-out by=S354-peter date=2026-08-19 probe=file-set-verified-via-gh-pr-diff-name-only-five-paths-docs-changelog-plus-docs-pr-reviews-plus-hand-off-plus-handOffs-delta-log-plus-master-list-ZERO-code-paths-docs-only-S352-bryan-wrap note=continuity-wrap-carve-out-six-rulings-plus-the-gc-fix-were-git-object-state-and-continuity-not-repo-code -->
<!-- @review pr=575 verdict=carve-out by=S354-peter date=2026-08-19 probe=file-set-verified-via-gh-pr-diff-name-only-five-paths-two-BRIEFs-channel-nested-program-precedence-plus-dpa-034-editions-reground-plus-docs-known-gaps-plus-handOffs-delta-log-plus-handOffs-dpa-queue-ZERO-code-paths-then-PA-read-the-diff-the-three-rulings-are-SPEC-grounded-channel-in-nested-program-ruled-b-cites-the-more-specific-normative-4-12-1-724-same-grammar-rules-plus-718-separate-compilation-unit-against-flat-38-40-blast-radius-MEASURED-zero-of-2260-scrml-and-the-sweep-CORRECTS-two-STALE-ruling-gated-labels-to-open-g-e-import-007-RULED-S297-plus-g-onmount-request-RULED-S313-both-SPEC-half-landed-a-positive-correction-not-a-defect note=docs-only-bank-carve-out-rulings-cite-normative-SPEC-and-the-diff-fixes-two-stale-operator-queue-labels -->
<!-- @review pr=576 verdict=carve-out by=S354-peter date=2026-08-19 probe=file-set-verified-via-gh-pr-diff-name-only-single-path-handOffs-dpa-queue-md-ONLY-ZERO-code-paths-dpa-034-round-2-queue-content-that-had-been-leaked-to-local-main-and-never-pushed-now-recovered-onto-the-continuity-PR note=continuity-recovery-carve-out-dpa-queue-only -->
<!-- @review pr=577 verdict=carve-out by=S354-peter date=2026-08-19 probe=file-set-verified-via-gh-pr-diff-name-only-single-path-docs-known-gaps-md-ONLY-ZERO-code-files-files-two-HIGH-gaps-then-PA-read-the-diff-adversarially-BOTH-grounded-g-tenant-raw-egress-is-a-byte-identical-twin-verified-by-READING-source-a-detectTenantRawEgress-carrying-all-three-defects-the-14-8-9-sibling-gate-was-just-fixed-for-globalThis-Response-bypass-plus-body-wide-not-value-scoped-acrossTenants-suppressor-plus-source-text-regex-in-post-AST-Rule-7-locus-tenant-egress-ts-371-on-the-tenant-ROW-isolation-floor-and-g-dev-watcher-tests-leak-server-processes-PA-MEASURED-by-execution-89-orphaned-scrml-dev-servers-inotify-max-user-instances-128-fs-watch-0-of-3-handles-EMFILE-making-the-pre-commit-bail-gate-un-passable-machine-wide-gap-counts-regenerated-HIGH-48-to-50-MED-156-to-157-generated-by-state-ts note=docs-only-gap-filing-carve-out-both-HIGHs-carry-loci-and-reproduction-one-by-source-reading-one-by-execution-not-relayed -->

<!-- S356-peter review-floor drain (2026-08-20): 14 OWED (#578,#582-#594) — 6 carve-outs recorded here, 8 code-bearing dispatched to independent read-only S239 satellites -->
<!-- @review pr=594 verdict=carve-out by=S356-peter date=2026-08-20 probe=file-set-verified-via-gh-pr-diff-name-only-seven-paths-four-claude-maps-dependencies-domain-structure-test-GENERATED-by-project-mapper-plus-docs-changelog-plus-hand-off-plus-handOffs-delta-log-ZERO-code-paths-no-compiler-scripts-conformance-hook-S355-peter-wrap note=continuity-wrap-carve-out-the-four-maps-are-project-mapper-generated-navigation-not-hand-authored-code -->
<!-- @review pr=593 verdict=carve-out by=S356-peter date=2026-08-20 probe=file-set-verified-via-gh-pr-diff-name-only-single-path-docs-known-gaps-md-ONLY-ZERO-code-paths-the-HIGH-g-handle-onion-applied-per-route-not-top-level-custom-paths-404-is-FILED-and-ROUTED-TO-BRYAN-the-underlying-architectural-fix-emit-server-3625-plus-build-425-wrap-top-level-dispatch-in-the-onion-plus-a-40-3-semantics-ruling-are-bryans-lane-this-PR-carries-no-code note=docs-only-gap-filing-carve-out-the-fix-is-bryans-architectural-lane-not-touched-here -->
<!-- @review pr=589 verdict=carve-out by=S356-peter date=2026-08-20 probe=file-set-verified-via-gh-pr-diff-name-only-three-paths-docs-changelog-plus-hand-off-plus-handOffs-delta-log-ZERO-code-paths-S354-peter-cont-wrap-delta-1598-1601 note=continuity-wrap-carve-out -->
<!-- @review pr=586 verdict=carve-out by=S356-peter date=2026-08-20 probe=file-set-verified-via-gh-pr-diff-name-only-four-paths-docs-changelog-plus-docs-pr-reviews-plus-hand-off-plus-handOffs-delta-log-ZERO-code-paths-S354-peter-wrap note=continuity-wrap-carve-out-the-pr-reviews-path-is-the-floor-recording-recursion-each-wrap-that-records-reviews-mints-one-new-owed-row -->
<!-- @review pr=585 verdict=carve-out by=S356-peter date=2026-08-20 probe=file-set-verified-via-gh-pr-diff-name-only-single-path-docs-known-gaps-md-ONLY-ZERO-code-paths-chore-gaps-reconcile-flip-1-verified-stale-open-gap-sweep-S354 note=docs-only-ledger-reconcile-carve-out -->
<!-- @review pr=578 verdict=carve-out by=S356-peter date=2026-08-20 probe=file-set-verified-via-gh-pr-diff-name-only-five-paths-compiler-SPEC-INDEX-md-plus-compiler-SPEC-md-plus-docs-FACTS-md-plus-two-docs-changes-dpa-034-progress-md-and-language-version-lifecycle-RULING-md-ZERO-EXECUTABLE-code-no-compiler-src-scripts-conformance-test-hook-this-is-bryans-dpa-034-no-editions-reground-a-RULED-LANGUAGE-DESIGN-decision-strike-the-population-premise-authority-is-bryans-per-the-HARD-BOUNDARY-not-a-compute-lane-correctness-review note=spec-doc-only-carve-out-language-authority-is-bryans-already-ruled-dpa-034-peter-lane-verifies-zero-executable-code-not-the-ruling -->

<!-- @review pr=591 verdict=clean by=S356-peter date=2026-08-20 probe=independent-read-only-S239-satellite-diffed-2c1f458d-one-token-close-brace-paren-to-brace-once-true-paren-at-section-emit-wiring-1483-matching-the-inline-anon-open-1199-confirmed-all-three-main-codegen-DCL-siblings-emit-once-true-emit-event-wiring-2268-emit-client-2719-emit-variant-guard-1344-grepped-whole-self-host-tree-for-DOMContentLoaded-1199-is-the-ONLY-DCL-registration-animationend-already-onced-node-check-clean-verified-the-two-readdir-legs-actually-sorted-at-HEAD-generate-155-dev-944-so-the-gaps-all-3-legs-closed-claim-holds-DCL-fires-once-natively-so-once-is-production-identical-fresh-registration-not-reused note=clean-latent-non-defect-flagged-self-host-emitEventWiring-still-emits-inline-anon-function-DCL-wrapper-vs-mains-named-scrml-boot-eager-chunk-loading-fast-path-a-pre-existing-structural-port-lag-not-introduced-or-worsened-here-outside-the-once-leg-scope -->
<!-- @review pr=587 verdict=clean by=S356-peter date=2026-08-20 probe=independent-read-only-S239-satellite-read-diff-plus-_emitInitThunkSidecar-emit-logic-1042-1104-plus-per-file-tracker-reset-setStructuralDeclNamesForFile-994-1000-compiled-8-double-write-variants-2-of-3-writes-write-reset-call-write-reads-interleaved-single-SSE-bind-must-keep-thunk-write-in-if-then-top-level-two-distinct-implicit-cells-first-write-expression-then-reassign-two-file-compile-file2-x-not-suppressed-by-file1-x-every-case-emitted-exactly-one-init_set-keyed-to-FIRST-write-SSE-single-bind-kept-thunk-cross-file-reset-works-regression-8of8-first-appearance-wins-is-correct-6-8-baseline-no-semantics-change note=clean-one-theoretical-non-filable-sqlNode-plain-shape-edge-adds-name-to-tracker-before-skip-pre-existing-SQL-init-reset-carve-out-not-a-#587-regression -->
<!-- @review pr=584 verdict=clean by=S356-peter date=2026-08-20 probe=independent-read-only-S239-satellite-git-show-0990737d-read-state-ts-117-225-gapMarkersFrom-gapCountsFromTokens-ran-state-gap-integrity-test-8of8-adversarial-parseGapMarkers-probes-dup-agree-dup-conflict-prefix-ids-g-foo-vs-g-foo-bar-mixed-attr-order-both-directions-bad-sev-missing-status-id-later-placeholder-id-later-live-recount-real-known-gaps-722-tok-HIGH-47-MED-148-LOW-68-NOM-7-exactly-matches-HEAD-generated-table-order-independence-is-TRUE-not-residual-no-false-negative-introduced-invalid-sev-and-missing-status-still-throw-loud-3-stale-open-flips-verified-against-HEAD-guards-not-assumed note=clean-one-non-filable-double-id-marker-edge-still-throws-fail-loud-not-a-regression-language-surface-no -->
<!-- @review pr=588 verdict=finding by=S356-peter date=2026-08-20 probe=independent-read-only-S239-satellite-read-scheduling-ts-injectHandleRequestAwaits-plus-_REQUEST_ASYNC_METHODS-662-plus-emit-server-3120-hook-live-compiled-handle-body-request-bytes-emitted-BARE-0-errors-control-request-arrayBuffer-correctly-awaited-aliased-const-r-request-r-json-emitted-BARE-PA-INDEPENDENTLY-VERIFIED-set-contents-on-HEAD-662-formData-json-text-arrayBuffer-blob-omits-bytes finding=MED-g-handle-request-bytes-omitted-from-autoawait-set-scheduling-ts-662-bytes-a-standard-Promise-Uint8Array-body-read-omitted-so-request-bytes-emits-floating-unawaited-promise-the-exact-formdata-unawaited-class-#588-closed-for-5-methods-secondary-aliased-receiver-one-hop-not-awaited-name-scoped-predicate-LANGUAGE-SURFACE-no-PETER-LANE-within-ruled-autoawait-mandate note=class-incomplete-fix-missed-one-member-filed-MED -->
<!-- @review pr=592 verdict=finding by=S356-peter date=2026-08-20 probe=independent-read-only-S239-satellite-ran-added-test-4of4-then-compiled-variants-via-compiler-API-int-bare-0-42-float-requote-1-5-1-0-to-1-hex-0x10-to-16-exp-1e21-to-quoted-collision-0-and-quoted-0-empty-str-mixed-ident-hyphen-all-correct-bigint-0n-and-neg-1-still-error-primary-fix-sound-no-valid-key-newly-broken finding=LOW-g-object-literal-bigint-key-fails-codegen-a-bigint-literal-key-0n-still-trips-E-CODEGEN-INVALID-LOGIC-no-emit-same-class-#592-closed-for-int-float-hex-exp-one-exotic-edge-distinct-pre-existing-bug-not-a-#592-regression-LANGUAGE-SURFACE-no-bigint-keys-intended-valid-JS-PETER-LANE-codegen note=class-incomplete-fix-missed-bigint-edge-primary-numeric-key-fix-well-covered-and-semantics-faithful -->
<!-- @review pr=590 verdict=finding by=S356-peter date=2026-08-20 probe=independent-read-only-S239-satellite-read-full-a7e99e8f-diff-CONFIRMED-CORE-SECURITY-LOGIC_SCOPE_GLOBAL_ALLOWLIST-adds-only-Response-Request-Headers-File-FormData-Blob-absent-still-fire-E-SCOPE-001-exclusion-airtight-flipped-authed-server-403-passthrough-guard-still-emitted-in-order-and-executed-load-bearing-detectProtectedRawEgress-296-still-source-scans-new-Response-for-E-PROTECT-004-floor-unweakened-ran-emitObjectKey-BARE_OBJECT_KEY-against-29-keys-content-type-0-1-5-space-empty-cafe-unicode-09-007-if-class-0x10-1e3-__proto__-28-correct finding=LOW-g-emitobjectkey-proto-emitted-bare-prototype-setter-quoted-source-key-__proto__-matches-BARE_OBJECT_KEY-emits-bare-__proto__-the-JS-prototype-setter-creates-NO-own-property-silently-changes-object-shape-pre-existing-but-#590-rewrote-exactly-this-function-claiming-only-adds-quotes-LANGUAGE-SURFACE-no-PETER-LANE-codegen note=core-security-CONFIRMED-SOUND-allowlist-minimal-exclusion-airtight-403-guard-load-bearing-E-PROTECT-004-orthogonal-only-defect-is-LOW-__proto__-emit-secondary-non-filed-allowlist-scope-broader-than-handle-body-but-benign-newly-accepting-conformance-justified-per-SPEC-14-8-9-40 -->
<!-- @review pr=583 verdict=finding by=S356-peter date=2026-08-20 probe=independent-read-only-S239-satellite-read-diff-ran-guard-test-3of3-Bun-1-3-14-Node-24-Windows-verified-process-kill-highPid-0-throws-ESRCH-under-node-and-bun-on-windows-grepped-commands-for-spawn-fork-serve-only-one-Bun-serve-in-runDev-analyzed-two-guard-signals-vs-windows-process-semantics-PLUS-PA-INDEPENDENTLY-VERIFIED-on-committed-state-win32-process-kill-deadPid-0-throws-ESRCH-and-read-dev-984-1057-guard finding=MED-g-dev-orphan-guard-collapses-on-windows-pid-reuse-dev-js-984-991-process-ppid-neq-launchPpid-985-is-POSIX-reparent-signal-never-fires-on-win32-detection-collapses-to-PID-reuse-vulnerable-process-kill-launchPpid-0-987-orphaned-scrml-dev-never-self-exits-leak-class-#583-claims-to-close-stays-open-on-windows-secondary-bare-catch-return-true-989-treats-EPERM-as-gone-false-positive-kill-of-live-parent-only-ESRCH-should-mean-gone-LANGUAGE-SURFACE-no-readdir-sort-legs-CLEAN-basenames-no-separators-OS-stable note=windows-specific-hole-in-a-fix-PETER-WINDOWS-CANARY-LANE-tests-never-exercise-real-reparent-or-reuse-so-3of3-green-does-not-catch-it -->
<!-- @review pr=582 verdict=finding by=S356-peter date=2026-08-20 probe=independent-read-only-S239-satellite-git-show-782-diff-plus-3-resolved-gap-bodies-confirmed-all-six-variant-regex-sites-now-test-masked-tv-RESET_CALL_RE-got-lookbehind-plus-isMemberResetCall-guard-processStatementText-scans-maskStringLiteralSpans-THEN-probed-SIBLING-checkLifecycleFieldAccess-24700-25195-own-raw-text-scanners-extractAccesses-FIELD_WRITE_RE-24815-FIELD_REF_RE-24820-at-25144-plus-handleResetTextMatches-24997-NOT-masked-built-and-ran-bun-repros-on-HEAD-passwordHash-not-to-string-fixture-control-fires-1-write-spelling-in-string-launders-real-read-0-read-spelling-in-string-false-fires-1-PLUS-PA-INDEPENDENTLY-CONFIRMED-on-committed-state-no-maskStringLiteralSpans-call-in-24781-25200-and-25141-text-statementText-fed-raw-to-extractAccesses finding=HIGH-g-lifecycle-field-access-tracker-scans-unmasked-text-string-launder-type-system-25141-25144-plus-25135-25137-the-parallel-lifecycle-text-tracker-#582-masked-ONE-of-TWO-string-literal-launders-a-real-pre-transition-read-of-a-protected-field-E-TYPE-001-clean-and-read-spelling-false-fires-the-class-#582-headlines-as-closed-LANGUAGE-SURFACE-no-per-satellite-completion-of-#582s-ratified-masking-BUT-PA-NOTE-the-false-fire-fix-is-newly-accepting-owes-bryan-a-language-surface-review-at-landing note=HIGH-class-closure-claim-is-the-defect-#582-masked-checkLifecycleBindingAccess-not-the-parallel-checkLifecycleFieldAccess-fix-is-mechanical-route-text-and-bareText-through-existing-maskStringLiteralSpans -->


<!-- @review pr=599 verdict=clean by=S357-peter date=2026-08-20 probe=PA-authored-tooling-fix-verified-two-sided-root-caused-the-red-cloud-gate-on-main-to-scripts-browser-baseline-ts-spawnSync-maxBuffer-64MB-overflowed-by-the-148MB-browser-tier-raw-output-48-baseline-happy-dom-node-dumps-ENOBUFS-killed-bun-before-its-N-pass-line-so-ranOk-guard-fired-HARNESS-DID-NOT-RUN-reproduced-on-clean-main-locally-AND-on-docs-only-595-so-not-a-code-regression-fix-512MB-verified-check-now-runs-tier-fully-PASS-name-set-matches-48-baseline-0-diff-exit-0-proving-both-the-fix-and-no-hidden-browser-regression-CI-gate-green-on-599-itself note=infra-tooling-PA-authored-self-verified-plus-CI-gate-authority-the-durable-fix-stop-capturing-148MB-of-dumps-stream-filter-or-suppress-at-source-left-as-follow-up -->
<!-- @review pr=595 verdict=carve-out by=S357-peter date=2026-08-20 probe=docs-only-review-floor-drain-known-gaps-md-plus-pr-reviews-md-no-compiler-source-touched-records-the-578-594-review-batch-14-OWED-to-0-the-drain-itself-is-the-artifact-not-a-code-change note=docs-only-carve-out-per-8-cry-wolf-no-executable-surface -->
<!-- @review pr=596 verdict=clean by=S357-peter date=2026-08-20 probe=independent-worktree-isolated-S239-satellite-reproduced-defect-pre-fix-reverting-only-type-system-ts-yields-3of7-red-in-the-new-integration-test-launder-write-spelling-in-string-suppressed-real-E-TYPE-001-plus-read-spelling-false-fire-restoring-turns-all-7-green-test-bites-verified-all-four-raw-text-scan-sites-25140-25150-25330-25494-in-checkLifecycleFieldAccess-runLifecycleAccessCheck-now-route-through-maskStringLiteralSpans-grepped-whole-function-body-no-missed-statementText-readInitText-sites-10-additional-adversarial-class-probes-escaped-quotes-concat-real-writes-in-template-interp-correctly-NOT-masked-decoy-in-sibling-string-both-seeding-paths-all-correct-over-broad-suppression-check-real-world-readme-fixture-tasks-app-scrml-compiles-0-errors-full-suite-22394-pass-6-fail-all-6-fail-identically-on-base-main-1d245134-zero-new note=HIGH-fix-class-complete-per-satellite-completes-582s-ratified-masking-on-the-parallel-checkLifecycleFieldAccess-tracker-582-had-masked-only-checkLifecycleBindingAccess -->
<!-- @review pr=597 verdict=clean by=S357-peter date=2026-08-20 probe=independent-worktree-isolated-S239-satellite-fix-A-request-bytes-autoawait-_REQUEST_ASYNC_METHODS-now-complete-formData-json-text-arrayBuffer-blob-bytes-full-Fetch-Body-mixin-set-compiled-live-probe-arrayBuffer-blob-bytes-all-emit-await-clone-sync-stays-bare-no-over-match-non-request-receiver-shape-formData-and-shadowed-local-request-bytes-both-stay-bare-scoped-by-requestParamName-plus-AST-predicate-aliased-receiver-one-hop-NOT-awaited-pre-existing-disclosed-separate-open-gap-not-claimed-here-fix-B-orphan-guard-launchingProcessGone-catch-narrows-to-ESRCH-test-exercises-EPERM-non-ESRCH-path-expects-alive-both-tests-bite-red-before-green-when-their-source-reverted-regression-two-full-runs-failures-all-pre-existing-environmental-reset-to-origin-main-reproduced-identical-neither-new-test-in-any-failure-list note=both-fixes-class-complete-for-stated-mandate-both-documented-residuals-aliased-receiver-and-windows-pid-reuse-honestly-disclosed-as-separate-open-gaps -->
<!-- @review pr=600 verdict=carve-out by=S357-peter date=2026-08-20 probe=docs-only-continuity-wrap-hand-off-changelog-delta-log-1606-1612-plus-4-review-markers-no-executable-surface-recovers-stranded-S356 note=docs-only-carve-out-per-8-cry-wolf -->
<!-- @review pr=601 verdict=clean by=S357-peter date=2026-08-20 probe=PA-authored-test-harness-fix-root-caused-and-verified-two-sided-the-ss22-ss39-tracking-fails-x18-are-a-strip-bug-not-codegen-assertValidJs-stripModuleSyntax-deleted-whole-import-export-LINES-orphaning-a-multiline-export-const-ri-route-object-body-into-statement-position-lenient-bun-1-3-vm-Script-tolerated-strict-bun-1-4-0-rejects-Unexpected-token-colon-verified-WITHOUT-1-4-0-bun-1-3-14-strict-new-Function-reproduces-exact-CI-error-on-OLD-strip-and-accepts-NEW-strip-both-files-13of13-plus-8of8-locally-then-CI-1-4-0-on-601-confirmed-ss22-ss39-GONE-from-tracking note=test-infra-only-no-compiler-source-CI-1-4-0-is-authority-fix-strips-export-KEYWORD-keeps-declaration -->
<!-- @review pr=602 verdict=clean by=S357-peter date=2026-08-20 probe=PA-authored-test-fix-reproduced-on-bun-1-4-0-upgraded-local-to-match-CI-the-auth-AND-protect-Body-is-disturbed-or-locked-fail-is-at-the-TEST-line-575-res-clone-text-AFTER-expectJsonResponse-already-consumed-res-json-line-571-a-Response-body-reads-once-1-4-0-throws-ERR_BODY_ALREADY_USED-on-clone-after-read-inspected-emitted-server-js-request-body-read-exactly-ONCE-compiler-not-at-fault-fix-capture-raw-wire-bytes-via-clone-BEFORE-the-json-read-verified-file-17of18-the-1-is-preexisting-windows-EBUSY-afterAll-teardown-Linux-green-CI-602-tracking-dropped-auth-item note=test-only-clone-before-consume-same-1-4-0-strictness-class-as-601 -->
<!-- @review pr=603 verdict=clean by=S357-peter date=2026-08-20 probe=PA-authored-test-fix-root-caused-on-bun-1-4-0-the-7-R26-fails-are-happy-dom-plus-1-4-0-not-codegen-serve-target-tool-r26-drove-SRV-fetch-new-Request-url-init-but-the-integration-suite-registers-happy-dom-globally-GlobalRegistrator-which-overrides-global-Request-passing-a-happy-dom-Request-to-bun-native-Bun-serve-fetch-throws-ERR_INVALID_ARG_TYPE-fetch-expects-a-string-received-Object-under-1-4-0-passes-in-ISOLATION-10of10-fails-only-full-suite-confirmed-by-experiment-native-Request-OK-happy-dom-Request-THROWS-url-init-string-form-OK-fix-call-SRV-fetch-url-init-all-7-sites-verified-24of0-with-happy-dom-polluted-bug-18-first-10of0-isolated-CI-603-tracking-dropped-to-4-dev-watcher-only note=test-only-Server-fetch-accepts-string-RequestInit-natively-sidesteps-polluted-global -->
<!-- @review pr=604 verdict=clean by=S357-peter date=2026-08-20 probe=independent-worktree-isolated-S239-satellite-VERDICT-CLEAN-1-arg-bearing-path-BYTE-IDENTICAL-vs-base-a0a4ca1e-diff-exit-0-only-no-arg-line-changes-json-to-json-catch-2-zero-param-cell-read-case-_scrml_body-stays-defined-no-ReferenceError-confirmed-on-real-valid-shapes-session-and-loadNames-emit-_scrml_body-session-rows-with-catch-intact-return-count-plus-1-is-E-REACTIVE-003-separate-by-design-rejection-3-endpoint-accepts-site-stayed-STRICT-no-catch-4-runtime-no-arg-CSRF-valid-no-body-POST-200-pong-empty-string-body-200-no-CSRF-403-arg-bearing-no-body-still-throws-unchanged-5-test-BITES-revert-emit-server-keep-test-1pass-2fail-restore-3pass-0fail-plus-CI-gate-green-unit-conformance-gauntlet finding=none note=codegen-hot-path-fix-scoped-to-zero-param-only-catch-keeps-binding-defined-vs-naive-delete-guard-that-would-ReferenceError-the-cell-read-case-arg-wire-semantics-untouched-no-bryan-ruling-needed -->
<!-- @review pr=605 verdict=carve-out by=S358-peter date=2026-08-21 probe=docs-only-continuity-the-S357-post-wrap-touch-up-pr-reviews-md-plus-hand-off-md-plus-delta-log-md-no-code-path-records-the-5-marker-burst-and-the-POST-WRAP-section note=docs-continuity-carve-out-per-8-cry-wolf-the-wrap-PR-recording-review-markers-is-itself-unreviewable-code -->
<!-- @review pr=606 verdict=clean by=S358-peter date=2026-08-21 probe=PA-reviewed-the-worktree-agent-delta-browser-baseline-ts-streaming-rewrite-spawnSync-maxBuffer-to-spawn-plus-readline-bounded-25-line-context-window-flushedThrough-dedup-non-anchored-FAIL_MARKER-summary-retention-downstream-untouched-VERIFIED-the-proven-filter-48of48-names-vs-a-real-155MB-tier-capture-0-missing-0-extra-155MB-to-45KB-independent-check-PASS-48-asserted-exit-0-write-byte-identical-baseline-parseOk-oracle-holds-as-the-loud-marker-drop-safety-net-REVIEW-FINDING-the-agent-version-lacked-a-child-on-error-guard-so-a-spawn-stream-failure-would-hang-the-gate-added-child-on-error-merged-end-so-it-fails-loud-HARNESS-DID-NOT-RUN-parity-with-old-spawnSync-gate-job-printed-PASS-48-asserted-in-the-exact-CI-env-that-broke-at-S357 finding=hang-vs-loud-on-spawn-error-fixed-in-landing note=tooling-only-no-language-surface-coverage-removal-blind-spot-closed-by-construction-parseOk-catches-any-future-marker-drop-loud -->
<!-- @review pr=607 verdict=clean by=S358-peter date=2026-08-21 probe=PA-authored-CODE_BEARING_RE-widened-to-add-lsp-editors-e2e-dashboard-source-trees-each-verified-to-hold-real-source-vscode-extension-ts-neovim-lua-e2e-10-files-dashboard-app-scrml-plus-broadened-conformance-cases-to-conformance-so-the-harness-run-ts-driver-ts-counts-VERIFIED-re-ran-review-debt-code-bearing-rate-STAYED-2of90-zero-in-scope-PR-touches-those-dirs-alone-today-so-the-latent-hole-closes-with-no-retroactive-re-classification note=tooling-only-no-language-surface-review-floor-instrument-completeness -->
<!-- @review pr=608 verdict=clean by=S358-peter date=2026-08-21 probe=PA-authored-E-PA-005-message-text-two-strings-in-protect-analyzer-ts-back-tick-space-db-to-back-tick-db-plus-a-not-toContain-space-db-regression-pin-mirroring-the-E-PA-002-a9044329-pin-VERIFIED-blast-radius-clean-no-other-test-or-conformance-asserts-the-message-string-protect-analyzer-tests-and-the-e-pa-005-conformance-cases-pin-the-CODE-and-the-conformance-descriptions-already-use-db-the-space-form-uses-elsewhere-in-tests-are-deliberate-deprecation-migration-inputs-untouched-protect-analyzer-46of46 note=message-text-only-no-code-path-no-language-surface-diagnostic-trust-fix -->
<!-- @review pr=609 verdict=clean by=S358-peter date=2026-08-21 probe=PA-authored-completes-the-family-sweep-608-fixed-only-E-PA-005-a-post-merge-coherence-grep-found-two-more-live-diagnostic-messages-still-emitting-space-db-E-PA-006-protect-analyzer-1001-and-sibling-class-E-TYPE-050-type-system-7124-both-space-db-to-db-each-with-a-not-toContain-space-db-pin-VERIFIED-blast-radius-clean-no-test-conformance-asserts-these-message-strings-all-pin-the-CODE-protect-analyzer-46of46-type-system-245of245 note=message-text-only-no-language-surface-correct-the-class-not-the-instance-discipline -->

<!-- @review pr=610 verdict=carve-out by=S359-peter date=2026-08-21 probe=docs-only-continuity-wrap-S358-peter-changelog-plus-known-gaps-plus-pr-reviews-plus-hand-off-plus-delta-log-no-code-no-spec-surface-the-one-substantive-edit-is-the-two-gap-marker-flips-g-review-debt-codebearing-whitelist-607-and-g-e-pa-messages-deprecated-space-form-608-plus-609-both-open-to-resolved-with-RESOLVED-annotations-accurately-provenanced-to-the-landed-PRs-they-record-gap-bodies-preserved-not-dropped-LOW-count-generated-regen-70-to-68-matches-the-2-resolutions-review-floor-markers-605-609-recorded note=docs-continuity-carve-out-per-8-cry-wolf-the-wrap-PR-recording-its-own-session-markers-is-itself-unreviewable-code -->
<!-- @review pr=611 verdict=clean by=S360-peter date=2026-08-21 probe=PA-authored-two-zero-behaviour-change-hygiene-fixes-reviewed-two-sided-FIX1-ci-yml-tracking-step-relabel-VERIFIED-the-load-bearing-claim-the-canary-parser-conformance-canary-test-js-EXISTS-at-compiler-tests-root-and-IS-run-by-the-blocking-gate-job-Root-level-parser-native-conformance-S302-step-bun-test-compiler-tests-star-test-js-ci-yml-126-127-while-the-tracking-step-190-runs-ONLY-parser-conformance-within-node-test-js-so-dropping-plus-canary-from-that-steps-name-is-truthful-not-coverage-losing-name-string-plus-comment-only-no-run-change-zero-CI-behaviour-change-FIX2-beforeAll-30000-second-arg-valid-bun-syntax-the-130-exitCode-assertion-still-fires-inside-the-hook-so-a-real-compile-error-or-hang-still-fails-at-30s-only-the-false-timeout-flake-removed-no-accepted-failure-set-change-KNOWN-GAPS-both-open-to-resolved-flips-match-the-code-gap-counts-MED-149-to-148-LOW-68-to-67-coherent finding=none note=code-bearing-hygiene-real-S239-pass-the-30s-ceiling-is-a-hang-catch-not-a-perf-budget-this-hook-gates-compile-correctness-not-time -->
<!-- @review pr=612 verdict=carve-out by=S360-peter date=2026-08-21 probe=docs-only-continuity-S359-peter-wrap-changelog-plus-known-gaps-plus-pr-reviews-plus-hand-off-plus-delta-log-1625-1632-no-code-no-spec-surface-the-substantive-edits-are-the-six-deep-dive-ledger-dispositions-fn-anon-corrected-proto-reconfirm-todomvc-routed-string-escape-corrected-css-hash-refined-anon-fn-return-type-consolidated-spot-checked-coherent-plus-accurately-provenanced-to-delta-log-1628-1631-and-the-routed-bryan-lane-queue-gap-bodies-corrected-in-place-not-dropped note=docs-continuity-carve-out-per-8-cry-wolf-ledger-navigation-not-gate-surface-findings-were-repro-verified-during-S359 -->
<!-- @review pr=613 verdict=carve-out by=S360-peter date=2026-08-21 probe=docs-only-continuity-S359-post-wrap-known-gaps-plus-hand-off-plus-delta-log-1633-1636-no-code-no-spec-surface-records-4-post-wrap-deep-dives-7-to-10-incl-TWO-confidentiality-gate-finding-ledger-entries-g-namespace-signal-computed-bracket-E-CG-006-static-property-blind-and-g-cli-emits-artifacts-on-failed-compile-locus-traced-api-js-2962-2967-both-differential-repro-backed-in-delta-log-1633-1634-and-routed-to-bryan-security-lineage-spot-checked-provenance-coherent-gap-bodies-corrected-in-place note=docs-continuity-carve-out-the-security-findings-are-ledger-RECORDS-of-repro-verified-S359-work-not-code-changes-no-gate-surface-to-review-here-independent-re-repro-is-a-fresh-deep-dive-not-a-review-floor-obligation -->
<!-- @review pr=614 verdict=carve-out by=S360-peter date=2026-08-21 probe=docs-only-continuity-S359-post-wrap-2-known-gaps-2-plus-1-plus-delta-log-1637-2-lines-no-code-no-spec-surface-records-deep-dive-11-g-flat-css-block-plus-author-style-emits-two-style-attributes-confirmed-locus-emit-html-ts-2897-impact-sharpened-to-silent-author-style-loss-provenanced-to-delta-log-1637-routed-to-bryan note=docs-continuity-carve-out-per-8-cry-wolf-ledger-only -->
<!-- @review pr=615 verdict=carve-out by=S360-peter date=2026-08-21 probe=docs-only-continuity-S359-post-wrap-3-known-gaps-plus-hand-off-plus-delta-log-1638-1640-no-code-no-spec-surface-records-deep-dives-12-to-14-etype046-null-deref-safety-fn-param-shippable-null-deref-cleanup-reserved-keyword-non-uniform-family-and-e-route-001-object-literal-value-position-fix-choice-b-complete-all-provenanced-to-delta-log-1638-1640-and-routed-to-bryan note=docs-continuity-carve-out-per-8-cry-wolf-ledger-only-findings-repro-verified-during-S359 -->
<!-- @review pr=616 verdict=carve-out by=S360-peter date=2026-08-21 probe=docs-only-the-review-floor-drain-PR-itself-pr-reviews-md-only-no-code-no-spec-surface-records-the-611-615-markers-the-inherent-one-PR-tail-8-cry-wolf note=docs-continuity-carve-out-a-drain-PR-recording-its-own-markers-is-unreviewable-code -->
<!-- @review pr=617 verdict=clean by=S360-peter date=2026-08-21 probe=PA-authored-codegen-fix-rewriteResetCalls-added-to-clientPasses-pass-9.75-S239-adversarial-pass-RAN-on-the-diff-and-caught-3-real-fragilities-string-blindness-F2-corrupted-reset-in-a-string-literal-and-lookbehind-F3-at-prefix-both-FIXED-by-a-string-aware-char-scan-mirroring-rewriteReactiveRefs-plus-at-in-the-negative-lookbehind-non-canonical-target-F1-reset-at-a-0-scoped-out-and-routed-substrate-F4-and-shadow-F6-routed-independently-re-repro-d-on-HEAD-both-sides-collision-and-by-reference-plus-CLASS-checked-reset-is-the-sole-keyword-missing-a-client-pre-pass-tare-off-main-regression-verified-via-stash-base-has-identical-6-baseline-fails-14-of-14-new-tests-incl-the-ledger-named-cleanup-form-string-literal-non-rewrite-and-F1-F2-F3-guards-cloud-gate-green-after-a-FACTS-md-regen finding=3-fragilities-F2-F3-fixed-F1-F4-F6-scoped-and-routed note=code-bearing-emit-correctness-parity-6.8-imposes-no-body-position-restriction-so-not-newly-accepting-rejecting-peter-lane -->
<!-- @review pr=619 verdict=clean by=S360-peter date=2026-08-21 probe=PA-authored-codegen-fix-emit-server-ts-4623-endpoint-prologue-json-to-text-so-the-41.13-decode-IIFE-owns-the-JSON-parse-and-routes-a-throw-to-Malformed-400-S239-adversarial-pass-RAN-on-the-diff-confirmed-product-code-correct-verified-the-IIFE-emit-parse-variant-ts-206-214-and-the-decode-error-envelope-4583-and-no-self-host-endpoint-copy-two-TEST-quality-findings-both-fixed-runtime-test-no-longer-noops-under-happy-dom-driven-via-a-duck-typed-req-since-handler-reads-only-text-and-brittle-whole-file-not-toContain-json-dropped-for-the-positive-text-check-independently-re-verified-on-HEAD-drove-handler-valid-200-missing-unknown-400-byte-identical-malformed-notjson-empty-400-Malformed-class-checked-4623-is-the-sole-endpoint-prologue-site-3901-4111-are-the-server-fn-604-surface-untouched-scrml_body-consumed-only-by-the-IIFE-regression-verified-via-stash-full-suite-22413-pass finding=2-test-quality-both-fixed note=code-bearing-61.3-61.5-41.13-conformance-to-a-settled-SHALL-peter-lane-no-new-language-surface-mirrors-604-family -->
<!-- @review pr=618 verdict=carve-out by=S360-peter date=2026-08-21 probe=docs-only-continuity-ledger-batch-1-known-gaps-plus-delta-log-plus-pr-reviews-no-code-no-spec-surface-records-the-S360-deep-dive-batch-1-corrections-C-resolved-A-B-locus-traced-routed-D-downgraded-all-provenanced-to-delta-log-1628-1640-and-the-landed-617-plus-gap-counts-regen-47-to-45-via-state-ts note=docs-continuity-carve-out-per-8-cry-wolf-a-ledger-PR-recording-its-own-session-corrections-is-unreviewable-code -->
<!-- @review pr=620 verdict=carve-out by=S360-peter date=2026-08-21 probe=docs-only-continuity-ledger-batch-2-known-gaps-plus-delta-log-plus-pr-reviews-no-code-no-spec-surface-records-E-resolved-619-F-built-routed-branch-ref-G-locus-corrected-routed-plus-619-review-marker-plus-gap-counts-regen-45-to-44-all-provenanced note=docs-continuity-carve-out-per-8-cry-wolf-ledger-only -->
<!-- @review pr=621 verdict=carve-out by=S361-peter date=2026-08-21 probe=docs-only-the-S360-wrap-PR-itself-hand-off-plus-changelog-plus-delta-log-1641-1649-plus-known-gaps-plus-pr-reviews-no-code-no-spec-surface-records-the-S360-session-2-HIGH-codegen-fixes-617-619-already-independently-reviewed-clean-4-HIGHs-routed-turnkey-1-downgraded-and-the-inherent-continuity-tail-8-cry-wolf note=docs-continuity-carve-out-a-wrap-PR-recording-its-own-session-state-is-unreviewable-code-the-two-code-PRs-617-619-carry-their-own-clean-markers -->
<!-- @review pr=622 verdict=clean by=S361-peter date=2026-08-21 probe=PA-authored-codegen-fix-adds-shared-maskStringLiteralSpans-to-codegen-utils-and-applies-it-at-BOTH-server-only-stdlib-prune-sites-emit-client-2941-chunk-prune-and-3696-read-line-prune-S239-adversarial-pass-RAN-on-the-diff-and-caught-the-defect-is-TWO-vector-string-literal-closed-here-but-the-SHADOW-vector-client-local-const-shadowing-the-import-is-real-code-masking-cannot-touch-so-i-did-NOT-false-resolve-kept-gap-open-narrowed-and-routed-the-RI-consult-substrate-fix-to-bryans-derived-transitive-arc-independently-reproduced-both-vectors-on-HEAD-leak-96648-vs-63780-runtime-delta-between-AST-identical-sources-differing-only-in-a-label-string-genuine-client-use-and-template-interp-NOT-over-stripped-adversarial-selective-multi-module-prune-verified-comments-probed-and-not-a-live-vector-full-suite-22413-pass-6-preexisting-baseline-fail-none-codegen-7-new-two-sided-pins finding=two-vector-scope-string-half-landed-shadow-half-routed note=code-bearing-12-hard-split-conformance-settled-SHALL-no-language-surface-peter-lane-PARTIAL-by-design -->
<!-- @review pr=623 verdict=carve-out by=S361-peter date=2026-08-21 probe=docs-only-continuity-review-markers-621-622-plus-for-loop-lift-stale-HIGH-resolved-plus-delta-log-1650-1653-no-code-no-spec-surface note=docs-continuity-carve-out-per-8-cry-wolf -->
<!-- @review pr=624 verdict=clean by=S361-peter date=2026-08-21 probe=PA-authored-codegen-converge-adds-shared-regex-aware-indentBodyLines-to-utils-and-routes-emit-server-8-sites-plus-emit-tool-plus-emit-library-shared-through-it-S239-adversarial-pass-RAN-13-prototype-cases-plus-12-committed-pins-and-CAUGHT-two-S331-over-claims-emitTryStmt-is-DEAD-CODE-try-errors-and-failable-uses-inline-dispatch-verified-in-control-015-emitted-client-and-the-8-of-25-was-2-real-sites-plus-found-a-SEPARATE-preexisting-gated-arm-body-invalid-logic-finding-filed-MED-output-byte-identical-for-non-template-bodies-full-suite-22432-pass-6-preexisting-baseline-fail-none-codegen finding=two-S331-overclaims-corrected-plus-one-separate-MED-filed note=code-bearing-48-settled-SHALL-faithful-cooked-template-no-language-surface-peter-lane -->
<!-- @review pr=625 verdict=carve-out by=S361-peter date=2026-08-22 probe=docs-only-continuity-batch-2-machine-stale-HIGH-resolved-param-default-and-5c-verified-routed-annotations-plus-624-clean-marker-plus-delta-log-1654-1655-no-code-no-spec-surface note=docs-continuity-carve-out-per-8-cry-wolf -->
<!-- @review pr=626 verdict=carve-out by=S361-peter date=2026-08-22 probe=docs-only-continuity-staleness-spotcheck-3-stale-HIGHs-resolved-1-false-resolved-caught-dedup-plus-625-marker-plus-delta-log-1656-no-code-no-spec-surface note=docs-continuity-carve-out-per-8-cry-wolf -->
<!-- @review pr=627 verdict=clean by=S361-peter date=2026-08-22 probe=PA-authored-codegen-emit-each-collectMarkupReturningFnNames-transitive-fixpoint-plus-new-fnBodyReturnsCallToMarkupFn-reusing-interpMayYieldNode-fail-safe-only-widens-set-string-returning-fns-not-over-wrapped-verified-wrap-mounts-plain-stays-String-deeper-chain-wrap2-wrap-badge-closes-3-new-pins-plus-adjacent-each-markup-browser-11-0-full-suite-22435-pass-6-preexisting-baseline-none-codegen note=code-bearing-1.4-7.4-markup-as-value-objectively-broken-emit-no-language-surface-peter-lane-two-residuals-imported-and-struct-field-kept-open -->
<!-- @review pr=628 verdict=carve-out by=S362-peter date=2026-08-22 probe=docs-only-continuity-S361-MED-deep-dive-batch-known-gaps-md-1-stale-closed-3-peter-lane-buildables-annotated-turnkey-plus-pr-reviews-md-markers-plus-delta-log-1657-1658-no-code-no-spec-surface note=docs-continuity-carve-out-per-8-cry-wolf-ledger-only -->
<!-- @review pr=629 verdict=carve-out by=S362-peter date=2026-08-22 probe=docs-only-the-S361-wrap-PR-itself-hand-off-md-plus-changelog-md-no-code-no-spec-surface-records-the-S361-session-3-code-fixes-622-624-627-already-independently-clean-marked-6-stale-gaps-resolved-10-routed-turnkey-HIGH-44-to-37-MED-150-to-149-the-inherent-continuity-tail note=docs-continuity-carve-out-a-wrap-PR-recording-its-own-session-state-is-unreviewable-code-the-three-code-PRs-carry-their-own-clean-markers -->
<!-- @review pr=630 verdict=clean by=S362-peter date=2026-08-22 probe=PA-authored-codegen-fix-request-ref-event-handler-seam-two-emit-sites-emit-lift-1684-reparseLiftAttrRequestRef-mirrors-non-event-L1713-for-forlift-plus-emit-event-wiring-854-reparseRequestRefEscapeHatch-requestIds-already-in-engineExprCtxExtras-for-toplevel-S239-adversarial-pass-RAN-forked-code-review-high-and-CAUGHT-a-real-regression-i-introduced-multi-statement-handler-reload-semicolon-other-routed-the-ref-but-SILENTLY-DROPPED-the-trailing-statement-misroute-to-truncation-tradedown-GUARDED-at-shared-substrate-rawHasTopLevelStatementSep-skips-reparse-on-a-top-level-semicolon-byte-identical-for-single-expression-value-bool-class-if-seams-also-dropped-2-vacuous-test-cases-review-flagged-non-leading-call-arg-and-SSR-routed-each-both-pass-prefix-verified-repro-first-and-root-derived-on-HEAD-registry-undeclared-in-request-only-bundle-so-ReferenceError-at-click-silent-exit-0-byte-identity-non-request-handlers-stash-proven-unit-17631-0-conformance-883-883-sibling-request-ref-suite-35-0-integration-baseline-unchanged-26-base-vs-25-26-fixed-preexisting-auth-session-selfhost-flakes-convergent-root-fix-shouldSkipExprParse-routed-to-bryan-not-landed-parser-surface finding=one-regression-caught-and-guarded-plus-two-vacuous-tests-dropped-plus-one-architectural-convergence-routed note=code-bearing-6.7.7-settled-SHALL-request-ref-routing-no-language-surface-peter-lane-convergence-substrate-routed-to-bryan -->
<!-- @review pr=632 verdict=clean by=S362-peter date=2026-08-22 probe=PA-authored-codegen-fix-reactive-attr-drop-on-registry-absent-render-elements-new-isStandardHtmlRenderElement-predicate-html-elements-js-STANDARD_HTML_ELEMENTS-minus-metadata-drives-new-unknown-plus-null-match-arm-branches-in-valueAttrElementIsLowerable-emit-html-does-NOT-bloat-curated-REGISTRY-src-documented-blast-radius-S239-adversarial-pass-RAN-forked-code-review-high-and-caught-THREE-issues-all-fixed-1-null-match-arm-body-path-still-dropped-these-elements-extended-it-2-predicate-lowercased-admitting-mixed-case-typos-dataList-tBody-made-CASE-SENSITIVE-fail-closed-3-template-inert-over-included-added-to-non-rendering-set-verified-repro-first-and-root-derived-on-HEAD-base-vs-fixed-stash-diff-proved-F2-F3-were-my-regressions-and-fixed-them-component-directive-typo-stays-refused-notareal-fires-E-MARKUP-001-zero-phantom-bindings-byte-identical-for-html-builtin-null-elements-17-case-merge-blocker-unit-17648-0-conformance-883-883-integration-baseline-unchanged-auth-session-selfhost-preexisting-flakes finding=three-S239-issues-all-fixed-null-branch-completeness-plus-case-sensitivity-plus-template-exclusion note=code-bearing-5.5-settled-SHALL-reactive-attr-on-render-elements-no-language-surface-peter-lane -->
<!-- @review pr=634 verdict=clean by=S362-peter date=2026-08-22 probe=PA-authored-type-system-fix-E-FN-003-outer-scope-mutation-ASSIGN_RE-heuristic-false-fires-on-equals-inside-fn-body-string-or-template-literal-base64-padding-fix-masks-literal-interiors-before-the-regex-S239-adversarial-pass-RAN-forked-code-review-high-and-CAUGHT-that-my-first-cut-reimplemented-the-existing-hoisted-maskStringLiteralSpans-inline-and-buggier-missed-strings-nested-in-interp-bodies-and-miscounted-braces-in-nested-strings-3-findings-ALL-FIXED-by-swapping-to-the-existing-correct-helper-nested-string-in-interp-edge-case-pinned-in-test-repro-first-on-HEAD-corrected-the-stated-emit-server-locus-to-type-system-GATE-real-outer-mutation-still-fires-unit-clean-1-intermittent-timeout-flake-conformance-883-883-4-case-merge-blocker finding=S239-caught-a-buggier-inline-reimpl-of-an-existing-helper-fixed-by-reuse note=code-bearing-48.3.3-false-positive-diagnostic-on-valid-code-no-language-surface-peter-lane-batch-of-6-scouted-1-clean-3-fragile-traced-2-nonrepro -->
<!-- @review pr=631 verdict=carve-out by=S362-peter date=2026-08-22 probe=docs-only-continuity-the-630-review-marker-plus-delta-log-1660-recording-the-request-ref-event-handler-land-the-convergent-fix-routing-and-the-bryan-lane-queue-thematic-reconsolidation-no-code-no-spec-surface note=docs-continuity-carve-out-per-8-cry-wolf -->
<!-- @review pr=633 verdict=carve-out by=S362-peter date=2026-08-22 probe=docs-only-continuity-the-632-review-marker-plus-markup-value-attr-interp-multi-seam-trace-annotation-plus-delta-log-1662-no-code-no-spec-surface note=docs-continuity-carve-out-per-8-cry-wolf -->
<!-- @review pr=635 verdict=carve-out by=S363-peter date=2026-08-22 probe=docs-only-the-S362-wrap-PR-itself-hand-off-md-plus-pr-reviews-md-630-632-634-clean-markers-plus-delta-log-1659-1664-no-code-no-spec-surface-records-the-S362-session-3-code-fixes-630-632-634-already-independently-clean-marked-convergent-fix-and-9-group-queue-routed-4-fragile-arcs-traced-HIGH-37-MED-149-to-146-the-inherent-continuity-tail note=docs-continuity-carve-out-a-wrap-PR-recording-its-own-session-state-is-unreviewable-code-the-three-code-PRs-carry-their-own-clean-markers -->
<!-- @review pr=636 verdict=clean by=S364-peter date=2026-08-22 probe=recording-the-S363-owed-marker-code-PR-g-library-mode-match-expr-fails-codegen-new-emitControlFlowLibraryFns-routes-sync-non-sql-library-fns-containing-a-match-through-the-structured-emitLibraryFnMember-browser-parity-IIFE-mirrors-emitAsyncLibraryFns-prune-spans-append-lines-match-ONLY-by-design-if-value-is-bryans-language-fork-S239-adversarial-forked-code-review-high-RAN-IN-S363-and-came-back-SOUND-byte-identical-no-op-on-match-free-files-all-fn-positions-return-let-const-helper-statement-nested-R26-runtime-verified-residual-if-in-let-NOT-routed-loud-to-silent-wrong-filed-not-prejudged finding=none-S239-sound note=code-bearing-2.2.1-settled-SHALL-library-mode-lowering-no-language-surface-peter-lane-S239-performed-in-S363-marker-recorded-S364 -->
<!-- @review pr=637 verdict=clean by=S364-peter date=2026-08-22 probe=recording-the-S363-owed-marker-code-PR-g-failable-arm-body-multiline-template-invalid-logic-S362-ASI-trace-was-a-MISATTRIBUTION-real-two-part-root-parseErrorTokens-re-quoted-every-arm-handler-STRING-token-as-double-quotes-ignoring-isTemplate-plus-emitArmAssign-split-newline-bearing-arm-body-as-multi-statement-fix-shared-reemitHandlerStringToken-re-emits-isTemplate-tokens-with-backticks-converged-3-sites-plus-isExpressionBody-single-unit-assign-interp-survives-single-and-multi-line-R26-verified-S239-adversarial-forked-code-review-high-RAN-IN-S363-and-came-back-SOUND-plain-string-arm-byte-identical-to-base-UNMASKED-a-pre-existing-escaped-delimiter-template-bug-verified-independent-and-pre-existing-filed-separately-not-caused-by-this-fix finding=none-S239-sound-unmasked-preexisting-bug-filed-separately note=code-bearing-19-settled-SHALL-failable-arm-lowering-no-language-surface-peter-lane-S239-performed-in-S363-marker-recorded-S364 -->
<!-- @review pr=638 verdict=carve-out by=S364-peter date=2026-08-22 probe=docs-only-continuity-arc-3-reactive-member-auto-await-route-to-bryan-plus-arc-4-markup-value-scanner-full-3-scanner-1-emit-seam-map-plus-5-residual-gap-filings-plus-636-637-review-markers-plus-delta-log-1665-1669-no-code-no-spec-surface note=docs-continuity-carve-out-per-8-cry-wolf-ledger-and-routing-only -->
<!-- @review pr=639 verdict=carve-out by=S364-peter date=2026-08-22 probe=docs-only-the-S363-wrap-PR-itself-hand-off-md-plus-changelog-md-plus-known-gaps-md-gap-counts-no-code-no-spec-surface-records-the-S363-session-2-code-fixes-636-637-already-clean-marked-1-arc-routed-1-arc-mapped-plus-parked-5-residual-gaps-HIGH-37-MED-147-LOW-68-the-inherent-continuity-tail note=docs-continuity-carve-out-a-wrap-PR-recording-its-own-session-state-is-unreviewable-code-the-two-code-PRs-carry-their-own-clean-markers -->
<!-- @review pr=581 verdict=clean by=S365-bryan date=2026-08-22 probe=tooling-plus-continuity-the-new-delta-lint-gate-BITE-PROVEN-LIVE-during-its-own-land-merge-the-union-merge-of-origin-main-produced-4-real-sequence-collisions-S354-bryan-and-S364-peter-both-claiming-1671-1674-lint-went-RED-named-all-4-with-line-numbers-I-renumbered-the-UNMERGED-side-mine-to-1682-1685-leaving-the-siblings-already-merged-entries-untouched-and-lint-returned-PASS-1384-distinct-max-1685-then-CONFIRMED-EXECUTING-in-the-cloud-gate-job-97107635577-printing-the-identical-numbers-not-merely-green-plus-state-ts-check-PASS-and-facts-ts-check-PASS note=the-gate-caught-a-real-defect-in-the-very-commit-that-shipped-it-red-then-green-both-directions-observed-NB-delta-lint-fix-would-have-renumbered-the-WRONG-side-it-keeps-first-in-file-order-which-was-mine-the-already-merged-side-must-win -->
<!-- @review pr=641 verdict=clean by=S365-bryan date=2026-08-22 probe=EXECUTED-the-emitted-library-module-rather-than-grepping-it-compiled-export-const-OBJ-match-with-object-arms-plus-an-fn-path-twin-then-imported-the-artifact-in-node-decl-path-OBJ-returns-x-1-CORRECT-so-the-fix-holds-at-runtime-not-just-in-emitted-text-and-the-fn-path-pickObj-returns-undefined-for-both-the-matching-and-wildcard-arm-which-REPRODUCES-the-MED-residual-peter-filed-alongside-it-g-library-fn-match-object-or-block-arm-body-returns-undefined-a-known-filed-gap-not-a-regression-introduced-here note=verified-by-my-own-execution-not-by-relaying-the-authors-S239-report-per-reviews-are-claims-not-results-also-observed-in-passing-the-compile-FAILED-with-E-TYPE-025-on-an-untyped-fn-param-yet-still-wrote-a-complete-artifact-that-imports-and-runs-which-is-the-already-ruled-S354-Q3-write-on-failure-gap-still-live-on-main-not-a-finding-against-this-PR -->
<!-- @review pr=642 verdict=carve-out by=S365-bryan date=2026-08-22 probe=docs-only-continuity-the-S364-wrap-PR-itself-file-set-VERIFIED-by-gh-pr-diff-name-only-changelog-md-known-gaps-md-pr-reviews-md-hand-off-md-delta-log-md-zero-code-zero-spec-surface-the-sessions-one-code-PR-641-carries-its-own-clean-marker-above note=docs-continuity-carve-out-per-8-cry-wolf-a-wrap-PR-recording-its-own-session-state-has-no-code-path-to-review-file-set-checked-rather-than-assumed -->
<!-- CORRECTION to @review pr=581 (by=S365-bryan date=2026-08-22) — NOT a second review marker; the pr=581 verdict above stands as clean, but its probe= over-states what was proven. The bite proof I recorded was real and both-directional (RED on four genuine sequence collisions during the land-merge, GREEN after the renumber) but it was conducted ENTIRELY IN THE CANONICAL FORMAT. The S239 pass on instrument-integrity found, and I reproduced, that delta-lint returns exit 0 PASS over a delta-log that still CONTAINS a duplicate once the ' · ' separator drifts to ' - ', and over an empty file — because its parser matches zero entries and concludes there is nothing to check. Filed HIGH as g-delta-lint-gate-vacuous-on-zero-population and routed into the instrument-integrity fix round. The reusable lesson: proving a gate BITES is not the same as proving it cannot be SILENCED, and a gate proven only on well-formed input is unproven against the degenerate case. -->
<!-- @review pr=643 verdict=carve-out by=S365-bryan date=2026-08-22 probe=docs-only-file-set-VERIFIED-by-gh-pr-diff-name-only-exactly-two-files-docs-pr-reviews-md-and-handOffs-delta-log-md-zero-code-zero-spec-surface-this-is-the-review-floor-drain-PR-itself-recording-markers-for-581-641-642 note=the-inherent-self-referential-tail-a-PR-that-drains-the-floor-owes-its-own-marker-recorded-here-rather-than-in-a-PR-that-would-owe-another-one -->
<!-- @review pr=644 verdict=carve-out by=S365-bryan date=2026-08-22 probe=docs-only-file-set-VERIFIED-by-gh-pr-diff-name-only-three-files-known-gaps-md-pr-reviews-md-delta-log-md-zero-code-zero-spec-surface-carries-the-three-S239-verdicts-two-filed-and-PA-reproduced-HIGHs-and-the-self-correction-to-the-581-marker note=continuity-carve-out-the-REVIEWED-artifacts-are-the-three-branches-themselves-each-of-which-got-a-full-adversarial-pass-recorded-in-delta-log-1687-1688-1689-this-PR-only-transcribes-them -->
<!-- @review pr=646 verdict=finding by=S365-bryan date=2026-08-22 probe=TWO-full-adversarial-passes-the-second-REQUIRED-because-a-fix-round-invalidates-the-review-that-produced-it-pass-1-d2f16aca-to-d1a1857e-returned-LAND-conditional-on-five-items-with-13-gates-corrupted-and-confirmed-RED-then-GREEN-and-the-BASE-behaviour-recorded-beside-each-five-of-them-previously-reported-green-while-measuring-nothing-pass-2-d1a1857e-to-c25d7a82-re-derived-all-five-conditions-both-extras-and-BOTH-merges-of-origin-main-verdict-LAND-zero-branch-only-test-failures-conformance-883-of-883-merge-integrity-checked-by-SET-DIFF-not-trust-gap-id-census-730-730-736-740-740-with-09d133ff-vs-c25d7a82-identical-and-the-delta-log-blob-byte-identical-to-origin-main-with-comm-empty-both-directions-so-nothing-renumbered-and-nothing-dropped-PA-independently-verified-the-delta-lint-guard-by-execution-pristine-0-real-duplicate-1-separator-drift-2-empty-file-2-exit-codes-measured-directly-never-through-a-pipe note=verdict-is-finding-not-clean-because-the-re-review-surfaced-two-HIGHs-I-then-reproduced-and-filed-g-delta-lint-partially-blind-on-emoji-kind-entries-4-live-entries-invisible-to-both-the-gate-and-the-digest-projection-and-g-delta-lint-fix-corrupts-log-under-partial-blindness-BOTH-ARE-PRE-EXISTING-AT-ORIGIN-MAIN-and-neither-is-a-regression-from-this-delta-so-they-do-not-block-the-land-they-are-filed-as-follow-ups-also-notable-this-PR-fixes-a-hollow-gate-that-I-myself-landed-in-581-earlier-the-same-day-and-had-recorded-as-bite-proven -->
<!-- @review pr=645 verdict=carve-out by=S365-bryan date=2026-08-22 probe=docs-only-file-set-VERIFIED-by-gh-pr-diff-name-only-three-files-known-gaps-md-pr-reviews-md-delta-log-md-zero-code-zero-spec-surface-it-records-the-F1-ratelimit-fix-verification-two-filed-gaps-and-the-two-corrections-the-dispatched-agent-made-to-my-own-brief note=continuity-carve-out-the-REVIEWED-artifact-is-the-F1-fix-itself-on-branch-handle-onion-46ca6d63-which-I-verified-by-executing-my-own-reproducer-4-of-4-assets-200-and-by-an-adversarial-oracle-check-revert-emit-server-flips-7-of-9-tests-red-while-the-2-counter-tests-stay-green-that-branch-does-NOT-land-yet-and-owes-its-own-re-review -->
<!-- @review pr=649 verdict=clean by=S365-bryan date=2026-08-23 probe=EXECUTED-the-emitted-library-module-rather-than-grepping-it-authored-the-gaps-exact-shape-a-bare-fn-library-file-with-NO-trailing-newline-export-fn-twice-n-return-n-times-2-confirmed-by-od-that-the-source-genuinely-lacks-the-final-newline-then-compiled-in-library-mode-and-imported-the-artifact-in-node-emitted-tail-carries-the-complete-export-function-twice-n-return-n-times-2-with-its-closing-brace-intact-node-check-passes-and-twice-21-returns-42-at-runtime note=peter-lane-codegen-fix-verified-by-my-own-execution-not-by-relaying-the-authors-report-the-gaps-failure-mode-was-a-truncated-final-closing-brace-so-the-decisive-test-is-that-the-module-both-PARSES-and-RUNS-which-it-does -->
<!-- @review pr=647 verdict=carve-out by=S365-bryan date=2026-08-23 probe=docs-only-file-set-VERIFIED-by-gh-pr-diff-name-only-three-files-known-gaps-md-pr-reviews-md-delta-log-md-zero-code-zero-spec-surface-it-files-the-two-delta-lint-HIGHs-and-banks-the-instrument-integrity-re-review-verdict note=continuity-carve-out-the-REVIEWED-artifact-is-the-instrument-integrity-branch-itself-which-received-two-full-adversarial-passes-recorded-at-delta-log-1691 -->
<!-- @review pr=648 verdict=carve-out by=S365-bryan date=2026-08-23 probe=docs-only-single-file-VERIFIED-by-gh-pr-diff-name-only-docs-known-gaps-md-only-a-heading-drift-sweep-aligning-20-stale-gap-headings-to-their-verified-markers-zero-code-zero-spec-surface-and-the-markers-themselves-are-the-machine-readable-half-so-a-heading-realignment-cannot-change-what-any-probe-reads note=peter-lane-ledger-hygiene-carve-out -->
<!-- @review pr=650 verdict=carve-out by=S365-bryan date=2026-08-23 probe=docs-only-file-set-VERIFIED-by-gh-pr-diff-name-only-three-files-changelog-md-hand-off-md-delta-log-md-the-S366-peter-wrap-PR-itself-zero-code-zero-spec-surface-the-sessions-code-PR-649-carries-its-own-clean-marker-above-probed-by-execution note=docs-continuity-carve-out-a-wrap-PR-recording-its-own-session-state-has-no-code-path-to-review -->
<!-- @review pr=652 verdict=finding by=S365-bryan date=2026-08-23 probe=TWO-full-adversarial-passes-the-second-REQUIRED-because-a-fix-round-invalidates-the-review-that-produced-it-pass-2-verified-the-load-bearing-property-by-PER-CASE-verdict-vector-diff-across-all-883-conformance-cases-not-the-aggregate-with-non-vacuity-cross-runs-base-compiler-plus-branch-expected-json-and-the-inverse-both-875-of-883-proving-the-8-edited-assertions-genuinely-discriminate-rather-than-being-loosened-plus-a-corpus-container-audit-cross-checked-two-ways-466-empty-codes-arrays-404-empty-notCodes-31-empty-input-0-empty-records-0-nulls-PA-independently-verified-the-delta-lint-guard-and-the-narrow-widen-by-execution note=verdict-is-finding-not-clean-because-the-pass-surfaced-a-MEDIUM-I-fixed-IN-this-branch-before-landing-the-sibling-wrapper-conformance-corpus-test-js-lacked-the-shapeErrors-assertion-its-twin-got-a-regression-in-ONE-direction-since-notCodePrefixes-empty-object-used-to-throw-there-loudly-and-after-the-container-policy-returned-clean-looking-bite-proven-both-ways-planted-severity-empty-object-883-pass-1-fail-exit-1-restored-884-pass-0-fail-exit-0 -->
<!-- @review pr=651 verdict=carve-out by=S365-bryan date=2026-08-23 probe=docs-only-file-set-VERIFIED-by-gh-pr-diff-name-only-known-gaps-md-delta-log-md-hand-off-md-deferral-queue-md-and-generated-siblings-zero-code-zero-spec-surface-it-banks-the-Q2-through-Q9-operator-rulings-the-Q1-arc-result-and-the-new-tracked-deferral-queue-artifact note=continuity-carve-out-the-REVIEWED-artifacts-are-the-branches-those-rulings-were-executed-on-each-of-which-carries-its-own-adversarial-pass-the-two-findings-this-PR-files-Q5-auth-and-the-type-annotation-three-defects-were-both-PA-REPRODUCED-by-execution-before-filing -->
<!-- @review pr=654 verdict=finding by=S365-bryan date=2026-08-23 probe=THREE-full-adversarial-passes-each-required-because-a-fix-round-invalidates-the-review-that-produced-it-pass-1-a0e30329-to-b70db793-DO-NOT-LAND-2-HIGH-the-sharp-one-PA-REPRODUCED-independently-ratelimit-had-been-hoisted-from-per-route-to-per-request-so-a-program-ratelimit-3-per-min-app-429s-its-OWN-client-bundle-on-the-first-page-load-4-assets-main-serves-all-4-at-200-branch-429s-the-4th-pass-2-to-459003df-DO-NOT-LAND-2-NEW-HIGH-both-created-by-the-same-hoist-that-fixed-the-CSP-problem-38-transitions-silently-lost-on-EVERY-soft-navigation-because-nav-sync-head-syncs-title-description-canonical-and-NOT-stylesheets-PA-confirmed-structurally-and-headers-strict-refusing-the-dev-hot-reload-script-pass-3-to-3b5ecbee-LAND-all-eight-findings-reproduce-as-closed-by-execution-zero-branch-attributable-regressions-conformance-883-of-883-failing-NAME-SET-vs-main-empty-in-the-NEW-direction note=verdict-finding-not-clean-the-three-passes-returned-DO-NOT-LAND-twice-and-caught-4-HIGH-total-every-one-past-a-green-suite-PLUS-a-PROCESS-finding-one-commit-was-made-with-the-pre-commit-hook-DISABLED-via-core-hooksPath-not-no-verify-and-the-re-review-proved-that-commits-tree-was-RED-under-the-real-gate-it-is-orphaned-not-in-history-and-the-re-commit-under-the-real-hook-is-what-caught-the-underlying-leak-PA-required-the-disclosure-be-added-to-progress-md-because-a-transcript-disclosure-evaporates-and-that-file-does-not-ALSO-the-cloud-gate-rejected-the-branch-for-a-missing-34-0-emitter-provenance-note-on-E-MW-007-which-the-local-subset-does-not-run -->
