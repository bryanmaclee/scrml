# BRIEF — s422-e-auth-005-multifile (archived verbatim)

> Archived by the dispatched agent rather than by the PA at dispatch time (the
> `docs/changes/<id>/BRIEF.md` convention). Reproduced verbatim below.

---

Rebase and finish PR #770 — `E-AUTH-005` over-fires on every multi-file page. change-id: `s422-e-auth-005-multifile`.

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (FIRST, before anything)

1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. If not, STOP and report.
2. `git rev-parse --show-toplevel` MUST equal it; `git status --short` clean. Set `WORKTREE_ROOT="$(pwd)"`.
3. `bun install` (worktrees do not inherit node_modules — the hook fails "cannot find package 'acorn'" otherwise).
4. `bun run pretest` — run it PLAINLY from the worktree CWD. `bun --cwd <path> run pretest` SILENTLY NO-OPS and exits 0; verify the artifact exists rather than trusting the exit code.
5. NEVER `cd` into `/home/bryan-maclee/scrmlMaster/scrml`. Use `git -C "$WORKTREE_ROOT"` and worktree-absolute paths.
6. NEVER `git stash` — `refs/stash` is SHARED across every worktree including the main checkout. Do base-vs-build flips by FILE COPY.
7. NEVER a bare `pkill -f` / `killall` — every checkout shares the command string; you would kill a suite or hook in another tree with no trace. Kill by PID captured at launch.
8. NEVER bypass a git hook. No `--no-verify`, and **no `core.hooksPath` override** — that is the same violation wearing a different hat, and an agent did exactly it earlier today. If a hook is slow, batch your commits.
9. Your worktree is cut from `origin/main`, not the dispatcher's HEAD. Confirm: `git fetch origin && git log --oneline -1 origin/main`.
10. Commit after each unit; keep `$WORKTREE_ROOT/docs/changes/s422-e-auth-005-multifile/progress.md` append-only + timestamped. Branch + progress.md are the ONLY crash anchor.

## MAPS — REQUIRED FIRST READ

`.claude/maps/primary.map.md` was refreshed to watermark `787d4cb4` and merged to main an hour ago, so it is CURRENT (main is 1-2 docs-only commits ahead). Read it first and follow its Task-Shape Routing to the 2-4 maps for a type-system change. Treat map content as a verify-against-source hypothesis. Report which map content was load-bearing, including "none was."

## The defect — PA-REPRODUCED BY EXECUTION on `f95321bf`, with a control

`E-AUTH-005` fires on every `<var server>` in a page file of a multi-file app.

| case | result |
|---|---|
| `<var server>` in a SINGLE file that carries `<program db=>` | compiles clean |
| identical decl in a PAGE file whose `<program db=>` is in a sibling entry file | **`E-AUTH-005`**, FAILED |

Repro (two files):
```
app.scrml:          <program db="sqlite:./app.db"> + <schema> + <page>
pages/notes.scrml:  <page>  <notes server> = ?{ select id, body from notes }  </page>
```
Compile `pages/notes.scrml` → `E-AUTH-005: 'server @notes' declared in a client-only context`.

**Locus — TRACED, not searched, but still verify it:** `hasProgramDbAttr` (`compiler/src/type-system.ts:8516`) reads only `fileAST.nodes` — the CURRENT file's AST — and looks for a `markup`/`tag === "program"` node carrying a `db` attr. Fire site is `:11488`. Under the canonical multi-file layout exactly one `<program>` exists and it is in the ENTRY file, so the predicate returns false for every page file.

**Why it matters:** §52.4.2 pt 5 makes `<var server>` the only route to an SSR-prerendered cell, so server-rendered page data is structurally unavailable to every multi-file app.

## THE GATE THAT DECIDES WHETHER THIS IS A FIX AT ALL — do this BEFORE writing code

This change is **newly-ACCEPTING**: programs that are refused today would compile. Per base §8 a newly-accepting change **SHALL NOT ship as a bug fix** unless it restores conformance with a normative sentence that ALREADY EXISTS. So your first deliverable is the governing-sentence gate, and it produces one of two outcomes:

1. **Quote the governing sentence**, with its section reference, that says a page file in a multi-file application inherits the entry file's `<program>` context (look at §40.8 one-program-per-application, §52.11, §52.4.2, §12, and the multi-file layout rules). → It is conformance restoration. Proceed and build.
2. **"Searched §X, §Y, §Z — no governing sentence found."** → **STOP. Do not write the fix.** That makes it a RULING, which is bryan's call and not something this dispatch can take. Report outcome 2 with the sections you searched and end there.

Outcome 2 is a first-class, valuable result. Do not manufacture a sentence to reach outcome 1.

## If outcome 1 — the build

The existing attempt is on `fix/e-auth-005-multifile-page-server-context`, **191 commits behind**. Fetch and READ it (`git fetch origin fix/e-auth-005-multifile-page-server-context`), but treat it as a hypothesis, not a base — the front end has changed underneath it. Re-implementing against current main may well be cheaper than rebasing; you decide and say which you did and why.

**Do not over-fix.** `E-AUTH-005` must STILL fire where it should: a genuinely client-only context with no `db=` anywhere in the application. Your test set must pin BOTH directions — the multi-file page now compiles AND the true client-only case still errors. A fix that simply suppresses the diagnostic is worse than the bug.

## Verification — all of it required

- **Both-direction tests** as above, plus a conformance case if the shape warrants one.
- **R26 empirical:** recompile real multi-file apps on your post-fix baseline — `examples/22-multifile`, `examples/23-trucking-dispatch`, `benchmarks/fullstack-scrml`, `benchmarks/per-route-roles`. Report before/after diagnostics per app. Do NOT mark done on "tests pass".
- **Direction classification** (base §8): diff artifacts AND diagnostics over the real corpus and state which class this lands in. If anything beyond the intended shape newly compiles, that is a finding — report it, do not absorb it.
- Full local suite green before you report.

## Report back

Branch, final SHA, the governing-sentence outcome (quoted, or the recorded search), whether the locus hypothesis held / was refined / was wrong, what you re-implemented vs rebased, the both-direction test results, the R26 per-app table, the direction classification, and explicitly anything you could NOT verify.
