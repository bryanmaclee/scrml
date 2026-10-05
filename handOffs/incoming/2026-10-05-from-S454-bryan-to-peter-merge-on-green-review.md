---
from: scrml@asus-vivobook
to: scrml
date: 2026-10-05
subject: "(for Peter) #1297 merge-on-green.sh — post-merge S239 review: gate/windows fail closed; 2 HIGH on the tracking half"
needs: action
---

Post-merge review of #1297 (stubbed `gh` for every scenario; only read-only real-gh calls). **gate + windows fail CLOSED
across 11 stub scenarios** (red / pending / skipped / absent / duplicated / errored / empty rollup / UNKNOWN cap / null
base run / moved head all refuse non-zero). `.gitattributes` clean (9 files, all already LF; no byte change on
Linux/macOS). No `jq` dependency; bounded UNKNOWN loop; bash-3.2-safe. The findings are on the `tracking` half:

1. **HIGH — the tracking name-set can never contain the three `continue-on-error` steps** (Types gate, Bootstrap
   conformance count, Bootstrap severity): the Actions API reports a failed continue-on-error step's `conclusion` as
   `success`, and the script selects `conclusion=="failure"`. Evidence: main run 37262137044 — tracking log shows
   `Types gate … ##[error]Process completed with exit code 1`, `gh run view --json jobs` lists every tracking step
   `success`. So a NEW types regression in a PR prints "tracking name set byte-identical ✓". Fix options: give those
   steps an `id:` and a final step that prints the `steps.<id>.outcome` set for the script to read; or drop the
   step-level flag.
2. **HIGH — `tracking` IN_PROGRESS is not refused.** `TRACKING_STATE` is printed, never checked; a partial set can equal
   main's and the PR merges (stub: gate+windows SUCCESS, tracking IN_PROGRESS → `VERDICT: green`, merge called, rc 0).
3. MED — requires a `gh` with `pr checks --json` (gh 2.45, the Ubuntu package, refuses EVERY PR — fails closed, but no
   min version is stated or checked).
4. MED — base reference run not filtered to push events (`gh run list --branch main` lacks `--event push`; the contract
   says "main's newest push run").
5. LOW — no `--match-head-commit "$HEAD_SHA"` on `gh pr merge` (defence in depth; branch protection strict +
   enforce_admins already blocks a moved head server-side).
6. LOW — unquoted `set -- $PR_INFO` shifts fields when one is empty (still refuses, wrong message). NIT — `gh_q` merges
   stderr into parsed stdout; no `--base` check; no gh call timeouts.

⚑ **Related, and bigger than the script — bryan's side is raising it:** finding 1's evidence surfaced that the **Types
gate has been red on main for a long time** (29 new TS diagnostics back through ≥32 merges; 30 since #1293), invisible
because of continue-on-error in the non-required `tracking` job. Today's S454 PRs added none.

Your script, your call on the fix; findings 1–2 matter most because they make the "tracking byte-identical" line
unreliable. Ledger marker recorded on bryan's side as `verdict=finding`.

— S454-bryan (PA)
