# BRIEF — build the L1 e2e render-map harness (known-failure-map MVP)

Dispatched S202 (2026-06-17) · scrml-js-codegen-engineer · isolation:worktree · opus · bg.
Change-id: e2e-render-map-l1-2026-06-17. (NOTE: first Agent() call hit a transient classifier
outage; re-dispatched — this archived brief is the verbatim intent for both attempts.)

## Authority
DD `scrml-support/docs/deep-dives/e2e-known-failure-map-2026-06-17.md` (ADOPTED S202) — carries the
D0–D7 detector specs, the thin-build steps 1–5, the 3 acceptance bugs, the corpus, render-state
taxonomy, the 3 findings. THE SPEC. Build steps 1–4; DEFER step 5 (@gap ingestion).

## Build (DD thin-build)
1. Enumerate corpus — clone/extend corpus-enumerator.js (+benchmarks/); filter to `<program>`-UI apps
   (examples/ incl. 23-trucking-dispatch + Flux; samples/; gauntlet apps).
2. Per app: compileScrml({write:true}) → happy-dom mount (reuse each-runtime-bug-57.test.js helper) →
   D0–D7 detectors (compile-fail · mount-throws · `[object ` in DOM · literal `${` in text/attr ·
   undefined/null text · empty-render-where-seeded · console-errors · /is not defined/) → record state+smells.
3. Drive class-2/3 (db/server-fn) apps with a 1-line fixture cell-set; record EMPTY vs POPULATED as
   SEPARATE cells (board-class bug lives ONLY in populated; empty-db renders <empty> clean = looks green).
4. Baseline map JSON + green→red delta-gate (clone within-node allowlist pattern: baseline=allowlist,
   gate on regression-from-baseline NOT absolute-pass). Ship NON-GATING first.

## Validate detectors (real bugs now fixed → prove on synthetic)
3 tiny synthetic .scrml fixtures: (a) markup→textContent `[object ]`; (b) unbound loop member-ref
ReferenceError at mount; (c) literal `${}` in attr. PROVE each detector FIRES (D3 / D1+D7 / D4).

## CRITICAL — NO ERROR-CLASS SUPPRESSION
The DD found examples/test-examples.js's SERVER_EXAMPLES filter SUPPRESSES `_scrml_fetch_`/SyntaxError
(hides bug-2's class). Harness does the OPPOSITE: surface every error class; never filter/allowlist a
class to make an app "pass." Classify (compile-fail/throw/smell) but never hide.

## Acceptance (no DONE without)
(a) all 3 detector-validation fixtures fire; (b) harness runs the corpus + writes the baseline map;
(c) report INCLUDES THE MAP — state counts across N apps + notable red cells (the deliverable the user
wants); (d) no suppression.

## Gates
Full `bun run test` (no regression + harness runs); within-node untouched (no corpus .scrml edits;
the 3 synthetic fixtures are NEW files). Test infra only — NO compiler/src/ changes (STOP+report if needed).

## F4/path-discipline/commit: standard (worktree-absolute Bash edits, no cd-into-main, merge main at
startup, echo pwd in 1st commit, commit-per-unit, status-clean before DONE, progress.md per step).
