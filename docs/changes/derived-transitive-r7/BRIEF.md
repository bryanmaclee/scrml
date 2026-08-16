# dtr-r7 — the S239 fix round for round 6 (BRIEF, archived at dispatch)

Base: `dtr-r6` @ `ff0cbdd8` (pushed to origin). Review base `2709e540`.
Three adversarial lenses returned DO-NOT-LAND. Four blockers, all PA-confirmed by execution.
Full brief text was passed verbatim in the dispatch prompt; this is the archival copy.

## Blockers
B-1  Trigger-3 param-default TEXT SCAN silently relocates client code to the server AND drops the
     default (value becomes null). Contradicts unamended §12.4. FIX VERIFIED by PA: pass "structural"
     for the param-default roots only. Arc suites 138/0; a reviewer measured the full gate 22,435/0.
     MUST add a pin — currently unpinned in BOTH directions.
B-2  The containment universal that replaced the struck agreement claim is itself FALSE (refuted by
     the section's own Residual 4). Bound it.
B-3  §12.2 gains a placement position with ZERO normative text; §12.2's "not a function body therefore
     does not escalate" note is now false; §19575's "every parameter default" is false (destructured
     defaults are not scanned).
B-4  §6.6.4 is a false citation at 6 sites incl. the shipped diagnostic string.

## Also
F1   nested-function-decl guard has zero coverage; removing it opens an exit-0 argon2id client leak.
F2   conf §7 tautology (assertRefusedOrStubFree called after the assertion it depends on).
F6   the mandated corpus differential was run with an untracked scratchpad script.
