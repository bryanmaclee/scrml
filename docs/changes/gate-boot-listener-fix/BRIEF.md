# BRIEF — gate-boot-listener-fix (S345-bryan dispatch) — THE REPO-WIDE GATE UNBLOCKER

DONE-PROBE: grep -c 'once: true' compiler/src/codegen/emit-event-wiring.ts compiler/src/codegen/emit-variant-guard.ts compiler/src/codegen/emit-client.ts | awk -F: '{s+=$2} END {exit (s>=3)?0:1}'

## Context (diagnosis is COMPLETE — do not re-derive)
Read FIRST: `git show debug/gate-each-multiroot-image-20260810:docs/changes/gate-each-multiroot-image-debug/FINDINGS.md`
(the branch is on origin; fetch if needed). One-line verdict: TEST-HARNESS defect — stale cross-file
DOMContentLoaded `_scrml_boot` listeners on the shared happy-dom document, re-fired by
`each-multi-root.test.js`'s own dispatch, resolving the un-namespaced `_scrml_logic_1` selector onto
§5's span and overwriting the CORRECTLY-RENDERED lift output. The 20260810 runner image only
reshuffled bun's readdir file order so the writer (engine-body-render, pos 660) now precedes the
victim (pos 719). Cloud gate deterministically red repo-wide; every landing queued behind this.

## Build BOTH fixes (the diagnosis's candidates 1 + 2)
1. **Emitter `{ once: true }`** on the emitted DOMContentLoaded boot registrations at:
   - `compiler/src/codegen/emit-event-wiring.ts:2262` (`_scrml_boot`)
   - `compiler/src/codegen/emit-variant-guard.ts:1341` (`_fire`)
   - `compiler/src/codegen/emit-client.ts:2706` (link-boost)
   DOMContentLoaded fires exactly once per real document, so `once` is production-identical; it
   removes the stale-listener hazard under any once-per-eval harness. Verify the line numbers hold
   (they are review-asserted loci — check, refine if drifted, report if wrong).
2. **Harness hermeticity** in `compiler/tests/unit/each-multi-root.test.js`: fresh happy-dom
   window/document per `compileAndLoad` (copy the immune pattern from
   `conformance/adapters/impl1-ts.ts` `run()`, ~lines 390-455 — unregister + register a fresh window).

## Plus a bounded census (report-mostly)
Grep `compiler/tests/` for other files that BOTH eval compiled bundles against the shared global
document AND dispatch `DOMContentLoaded` (the class: any such file is both victim and writer).
Enumerate them in your report (`N of M` style). Apply the fresh-window fix ONLY where it is a
mechanical drop-in like fix 2; otherwise list them — the emitter `{once:true}` already protects the
class and a wholesale harness migration is not this dispatch.

## Explicitly NOT this dispatch
- Chunk-namespacing the logic-placeholder ids (candidate 4) — a real adopter-surface gap the PA
  files separately. Do not build.
- The CI file-order pin (candidate 3) — masks the class, do not build.
- Do not touch docs/known-gaps.md (concurrently owned).

## Verification before DONE
- Full gated suite green locally (`bun test compiler/tests/unit compiler/tests/conformance` — the
  exact cloud gate command — plus the full pre-commit on commit).
- Emitted-artifact check: compile 6-8 representative corpus samples (pick ones whose client JS
  contains DOMContentLoaded registrations — at least one engine-bearing, one nav/link-boost-bearing)
  pre/post; diff artifacts and assert the ONLY changes are the addEventListener options — paste the
  diff lines in the report. `node --check` each changed artifact.
- Runtime bite: in a scratch harness, eval an affected bundle against a happy-dom document, dispatch
  DOMContentLoaded TWICE, assert the boot ran once (listener census before/after — the debug branch's
  ZZDEBUG census code shows how).
- The ultimate empirical proof is the fix PR's own cloud gate run on the RED image — the PA runs
  that; your job is everything before it.

## Mechanics (CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE)
- isolation: worktree. FIRST ACTION: pwd prefix `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`;
  toplevel equals it; clean tree; `bun install`. Branch: `git checkout -b fix/gate-boot-listener origin/main`.
- Edit via Edit/Write on worktree-absolute paths only; never touch the main checkout. Echo pwd in the
  first commit message. Commit per meaningful unit; progress.md append-only; NEVER --no-verify;
  commit timeout ≥ 8 min. `git push -u origin fix/gate-boot-listener` at the end (and after the first
  substantive commit).

## Final report
FINAL_SHA · branch · files touched · whether the three asserted loci held · the artifact diff lines ·
the double-dispatch bite result · the harness-class census (N of M, which fixed vs listed) ·
full-suite counts.
