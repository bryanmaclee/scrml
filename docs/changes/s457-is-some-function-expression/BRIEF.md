# BRIEF — s457-is-some-function-expression (S457, adopter issue #1333)

CHANGE-ID: `s457-is-some-function-expression`. Agent: scrml-js-codegen-engineer, isolation worktree.

Adopter issue https://github.com/bryanmaclee/scrml/issues/1333 (read it: `gh issue view 1333`). Gap entry:
`docs/known-gaps.md` heading `G-IS-SOME-IN-A-FUNCTION-EXPRESSION-BODY-EMITS-AN-UNDEFINED-HELPER` (~:18869) — read it in full.
Symptom: `is some` / `is not` inside a `function (v) { … }` expression passed as an argument (e.g. `.then(function (v) { if (v is some) … })`)
emits `__scrml_is_some__(v)` into the client bundle, defined nowhere → ReferenceError at runtime (silently swallowed by a
`.catch`). At function top level it lowers correctly. Locus hypothesis (issue's): the expression-parser placeholder
(`compiler/src/expression-parser.ts` ~:1652, `case "is-some"`) is not rewritten when it sits inside a nested function-expression
body. Verify by tracing how the top-level case IS rewritten and why the nested body bypasses it.
Fix the ROOT for every position the placeholder can reach: function expressions, arrow functions (expression and block body),
methods in object literals, nested functions in `function`/`fn` bodies, `<each>` rows, handlers, engine bodies, `when`/effect
bodies, server and client artifacts, and `__scrml_is_not__` as well. Add a fail-closed guard: no `__scrml_is_some__` /
`__scrml_is_not__` (or any `__scrml_*__` placeholder) may reach an emitted artifact — make codegen error loudly if one does.
Governing text: SPEC §42 (`is some` / `is not`, §42.2) — quote it in progress.md. Direction expected: semantics-changed toward the
contract (a ReferenceError path now runs) — state it.
Verification: the issue's reproducer compiled + run in happy-dom (`@msg` becomes "some"); unit tests per position above;
EMPIRICAL: `grep -r '__scrml_is_\(some\|not\)__'` over every emitted artifact of a full corpus compile (samples/, examples/,
conformance/) = 0, before vs after counts reported.

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (F4) — path-discipline incidents to date: 4 (S99) + S385 stash race + S456 cookie-jar leak

1. `pwd` — MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. Otherwise STOP and report.
   `git rev-parse --show-toplevel` must equal `pwd`. `git status --short` must be clean.
2. Your base: `git fetch origin && git merge-base HEAD origin/main` must equal `git rev-parse origin/main`; if not, `git merge --ff-only origin/main`.
3. Fetch your brief: `git fetch origin brief/s457 && git checkout FETCH_HEAD -- docs/changes/s457-is-some-function-expression/` then commit it as your first commit:
   `WIP(s457-is-some-function-expression): start at $(pwd)` (the PA verifies the worktree prefix in this message).
4. `bun install` (worktrees do not inherit node_modules), then `bun run pretest` run plainly from the worktree CWD
   (NOT `bun --cwd <path> run …` — that silently no-ops). Verify `samples/compilation-tests/dist/` was populated.
5. Every Read/Edit/Write uses an ABSOLUTE path under YOUR worktree root. Never `cd` into `/home/bryan-maclee/scrmlMaster/scrml`
   (the main checkout). Use `git -C "$WT"`. Write NOTHING outside your worktree (scratch: `$WT/.tmp/`, delete before your final report).
   `TMPDIR` must NOT point inside any repo — leave it unset.
6. NEVER `git stash` (the stash is shared across every worktree). Base-vs-build flips by FILE COPY.
7. NEVER `pkill -f` / `killall` on a command string — kill only PIDs you started.
8. Commit after every meaningful change (WIP commits fine); keep `docs/changes/s457-is-some-function-expression/progress.md` (append-only, timestamped).
   A clean `git status` + committed branch tip before your final report is mandatory. Do not push; the PA lands.
9. Do NOT edit these shared, PA-owned docs: `docs/known-gaps.md`, `docs/FACTS.md`, `compiler/SPEC-INDEX.md`, `docs/changelog.md`,
   `master-list.md`, `hand-off.md`, `docs/pr-reviews.md`, `handOffs/**`. Put the gap-entry text you would write (new entries,
   status flips with resolved-by) in your final report; the PA applies it. (Brief 3 is the one exception, named there.)
10. Never `--no-verify`, never change `core.hooksPath`, never disable a hook. If the pre-commit hook fails, fix the cause or report.

## MAPS — REQUIRED FIRST READ
Read `.claude/maps/primary.map.md` first (stamp `ba2712973`, 2026-10-07; HEAD since then adds only the S456 wrap + maps PRs —
no source change), follow its Task-Shape Routing to the 2-4 maps for your task, treat map content as a hypothesis to verify
against source. In your final report say which map entry was load-bearing (or "not load-bearing").

## Rules of the house (short)
- SPEC `compiler/SPEC.md` is normative. Read the governing section IN FULL (offset/limit) before changing behaviour.
- A locus named below is a PA HYPOTHESIS (located, not traced). Verify it; report whether it held, was refined, or was wrong.
- No `null`/`undefined` in scrml source; `not` is absence. No try/catch/async/await in scrml source.
- Before DONE: run `bun test compiler/tests/unit compiler/tests/integration compiler/tests/conformance` (0 fail is the contract)
  plus `bun conformance/run.ts`, and the empirical check named in your brief (an emitted-artifact check, not "tests pass").
- Final report: worktree path · branch · FINAL_SHA · files touched · tests run + results · empirical check output ·
  direction-of-change class (inert / newly-rejecting / newly-accepting / semantics-changed) with the measurement ·
  gap-entry text for the PA · anything deferred.
