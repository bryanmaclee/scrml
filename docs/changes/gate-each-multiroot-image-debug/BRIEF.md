# BRIEF — gate-each-multiroot-image-debug (S345-bryan dispatch)

DONE-PROBE: `test -f docs/changes/gate-each-multiroot-image-debug/FINDINGS.md`

## Context (PA-established facts — do not re-derive)
The cloud CI `gate` is deterministically RED on main: `compiler/tests/unit/each-multi-root.test.js:503`
(§5 "two lifts per iteration render both roots per item") — `api.count(".lhdr")` returns 0, expected 4.
- 4 consecutive cloud runs red today (3 PR re-runs + 1 fresh workflow_dispatch on main).
- The EXACT gate command (`bun test compiler/tests/unit compiler/tests/conformance`) is GREEN locally
  (19,038/0, same 1,030 files) on the same content and the same bun (1.3.14 build 0d9b296a).
- The ONLY diverging variable: the GitHub runner image — GREEN runs used ubuntu-24.04 `20260720.247.2`,
  RED runs use `20260810.271.1`. Image rollout began ~Aug 10, which exactly matches when the historical
  "flake" instances started (S338); intermittency = mixed-image runner pool, now saturated.
- The test harness is fully synchronous: compile → body.innerHTML → eval(runtime+clientJs) →
  dispatch DOMContentLoaded → querySelectorAll count. A 0-count means static HTML carried no .lhdr AND
  the evaled runtime rendered none.

## Task — localize the MECHANISM via a CI debug loop
Work on a throwaway branch `debug/gate-each-multiroot-image-20260810` cut from origin/main (from your
worktree: `git checkout -b debug/gate-each-multiroot-image-20260810 origin/main`). This branch NEVER
merges — you may freely add diagnostics to the test file and even a dedicated debug test file.

Iteration loop (expect ~4-6 min per round; budget ≤ 6 rounds):
1. Edit `compiler/tests/unit/each-multi-root.test.js` (and/or add `compiler/tests/unit/zz-debug-image.test.js`)
   to dump, in the §5 test: (a) whether compile errors were empty; (b) the emitted `clientJs` slice around
   the lift-render / mount code (grep for "lhdr" and print ±20 lines, and print whether "lhdr" appears at
   all); (c) `document.body.innerHTML` AFTER eval (truncate ~2KB); (d) wrap the eval in try/catch and print
   any error + stack; (e) `process.versions`, `process.platform`, and the resolved happy-dom version
   (`require("happy-dom/package.json").version`); (f) anything else your round-N hypothesis needs.
2. Commit (pre-commit hook runs ~5 min — let it; NEVER --no-verify), push:
   `git push -u origin debug/gate-each-multiroot-image-20260810`.
3. `gh workflow run ci.yml --ref debug/gate-each-multiroot-image-20260810`, then
   `gh run list --workflow ci.yml --branch debug/gate-each-multiroot-image-20260810 --limit 1` for the id,
   `gh run watch <id>` (or poll), then `gh run view --job <gate-job-id> --log | grep`-mine your output.
   (console.log from a bun test shows in the job log.)
4. Refine hypothesis, repeat.

## Deliverable
Write `docs/changes/gate-each-multiroot-image-debug/FINDINGS.md` IN YOUR WORKTREE (commit it to the debug
branch) answering:
- WHERE the render path diverges on the new image (compile output differs? eval throws? runtime branch
  taken? DOM API behaves differently? locale/ICU/readdir-order dependency?).
- VERDICT: TEST-HARNESS defect (environment assumption in the test) vs COMPILED-RUNTIME defect (the
  emitted bundle genuinely renders nothing under the new environment — adopter-relevant) vs TOOLCHAIN
  (bun/happy-dom interaction with the new OS libs).
- The minimal fix candidate (do NOT build the fix — this is diagnosis only).
- Raw evidence: the key log excerpts per round.

## Discipline (CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE)
- isolation: worktree. FIRST ACTION: `pwd` must start with
  `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`; `git rev-parse --show-toplevel` equals
  it; clean tree. Any failure: STOP + report.
- `bun install` at startup. Edit via Edit/Write on worktree-absolute paths only; never cd into or write to
  the main checkout. Echo pwd in your first commit message.
- Commit after every meaningful edit; append-only timestamped progress.md; NEVER --no-verify.
- You MAY push the debug branch and dispatch ci.yml runs (that is the task). You may NOT open a PR,
  merge anything, or push to any non-debug branch.
- If `gh workflow run` is rejected on the branch (422 target-ref issue), fall back to opening NO PR —
  instead report the constraint; do not improvise other trigger paths.
  (Note: ci.yml HAS `workflow_dispatch` on main since #454; a branch cut from current main carries it,
  so the dispatch should work.)

## Final report
FINDINGS.md content (verbatim or summarized) + branch name + FINAL_SHA + rounds used + the verdict line.
