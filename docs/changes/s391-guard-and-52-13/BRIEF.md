# BRIEF — S391 stale-guard inversion + §52.13 diagnosis (scrml-js-codegen-engineer, isolation:worktree)

Archived verbatim per pa-base §5. Dispatched 2026-08-31 from main `63f4e3e5`.
NOTE: the worktree is cut from `origin/main` (S346), so this file does not exist inside the
agent's workspace; the brief is carried inline in the dispatch prompt and reproduced here.

Two tasks. TASK 1 is a WRITE. TASK 2 is REPORT-ONLY — do not fix it.

Both target `compiler/tests/commands/` and `compiler/tests/integration/`, the directories the
cloud `tracking` job is the only coverage for — and `tracking` is NOT a required check, which
is why both of these sat red without anyone acting.

## TASK 1 — invert the stale OUT-OF-SCOPE guard (WRITE)

`compiler/tests/integration/s385-channel-mount-in-match-arm.test.js` has a case titled
`OUT-OF-SCOPE GUARD — <each in=@undeclared> is still not checked`, asserting
`expect(hardErrors(result)).toEqual([])` around line 571.

That assertion was TRUE and correct when #781 landed — it recorded the honest scope boundary
of that arc. Then **#785 (`4bc6bc03`) landed the `<each>` opener scope check** under bryan's
4(b) mandate, and the fixture now correctly fires `E-STATE-UNDECLARED`. PA-verified on main:
`bun test compiler/tests/integration/s385-channel-mount-in-match-arm.test.js` → **20 pass, 1 fail**.

Invert it so it PINS the check that now exists rather than asserting its absence. Rename the
case so the title stops claiming the opposite of what it tests. Keep it in the same file and the
same describe block — it belongs with the arc that documented the boundary.

Do NOT simply delete it. A deleted guard is a coverage removal, and this project treats
"count what the check stops looking at" as mandatory before narrowing anything.

## TASK 2 — diagnose §52.13, REPORT ONLY, DO NOT FIX

`compiler/tests/commands/auth-protected-document-served.test.js:122` fails on main, locally,
in ~17ms — it is NOT a timing flake (the five dev-watcher failures in the same job ARE; they
pass locally in under four seconds total).

```
expect(await probe("/SECURE.html")).toEqual({ status: 302, leaked: false });
   Expected: { status: 302, leaked: false }
   Received: { status: 404, leaked: false }
```

The lowercase `/secure.html` correctly returns 302. The uppercase case-variant returns 404.
Nothing leaks in either case.

**The question I want answered, and it is a fork, not a bug report.** The test's own comment
says *"Unauthenticated document requests (incl. a case variant) redirect, no leak."* So its
INTENT is that a case variant must not bypass the gate. On Linux (case-sensitive fs) a 404 is
harmless. **On a case-insensitive filesystem — macOS, Windows — would the same request SERVE
the document?** If yes, the gate's correctness is platform-dependent and that is a real
finding; if no, the test's assertion is simply over-specified and the test is the defect.

Establish which, by execution where you can and by reading the dispatch path where you cannot:

1. Find the served-document dispatch and read how it resolves a request path to a file, and
   where the auth gate sits relative to that resolution.
2. Determine whether the 404 comes from the gate or from the file lookup — i.e. is the request
   gated-then-not-found, or not-found-before-gating? That ordering is the whole answer.
3. State plainly whether a case-insensitive filesystem would change the outcome. If you cannot
   test that here, say so and reason from the code with the reasoning shown.
4. Do NOT change any behaviour. Report the fork with both limbs and what each costs.

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (F4)

1. FIRST ACTION: `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`.
   Confirm `git rev-parse --show-toplevel` equals it and `git status --short` is clean. If ANY
   check fails, STOP and report — write nothing.
2. Every Read/Write/Edit uses an ABSOLUTE path under YOUR worktree root. Never a relative path
   (it resolves against the MAIN checkout), never a main-rooted absolute path.
3. NEVER `cd` into the main checkout. Use `git -C "$WORKTREE_ROOT"` and `--cwd=<path>`.
4. NEVER `git stash` — `refs/stash` is SHARED across every worktree and the PA is live in main.
   Base-vs-build flips by FILE COPY only.
5. NEVER a bare `pkill -f` / `killall` on a command string every checkout shares — it matches
   processes in OTHER checkouts and leaves no trace on your side.
6. `bun install` at your worktree root before any bun command. Note `bun --cwd <path> run <script>`
   with a SPACE silently no-ops at exit 0 — use `--cwd=<path>`, and never judge a bun invocation
   by exit code alone; check it produced its artifact.
7. Commit after each meaningful unit, keep an append-only `progress.md`. Branch + progress.md
   are the crash-recovery anchor.

## Verification you owe

- TASK 1: run the named test file and report the before/after counts. Bite-prove the inverted
  assertion — confirm it FAILS if you revert the scope check's effect, so it is not vacuous.
- Report whether the whole file is green, and what the `tracking` job's failure count should
  now be (it was 7).
- Any claim about a locus: state whether you TRACED it or merely located it.

## Report back

Worktree path, branch, FINAL commit SHA, files touched, the test counts, and the §52.13 fork
with both limbs. Do not fix §52.13.
