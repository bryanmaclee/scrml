# BRIEF — s457-maps-noncompliance (S457)

CHANGE-ID: `s457-maps-noncompliance`. Agent: general-purpose, isolation worktree. Source: `.claude/maps/non-compliance.report.md`
`## Summary — S456 pass`. EXCEPTION to shared-doc rule 9: you MAY regenerate `docs/FACTS.md` via its generator only.

1. N-S455-1 — add `fix-client-server-call` and `fix-sql-failable` to `NOT_A_VERB` in `scripts/facts.ts` (~:89); run
   `bun scripts/facts.ts --write`; confirm `--check` passes and FACTS.md now matches the verbs `compiler/src/cli.js` dispatches
   (count them from cli.js and state the number).
2. N-S455-2 — `compiler/src/commands/fix.js` (~:59) `--help` text advertises a `.run() !{ _ :> {} }` rewrite. Read
   `fix-sql-failable.js` and write help text matching what it does now (reads rewritten to `!{ _ :> not }` / `!{ _ :> [] }`,
   every write LISTED for a human — ruling S455 "b your rec on R11"). Also check the other `fix` rules' help lines against code.
3. N-S455-3 — `bun scripts/bootstrap-conformance.ts --write`, confirm `--check` passes. Then make its `--check` run in CI as a
   BLOCKING step only for PRs touching `conformance/cases/**` or `compiler/self-host-v2/**` (read `.github/workflows/` first;
   follow how the existing `gate` steps are written; if a path-filtered blocking step is not expressible cleanly in the current
   workflow, STOP on this sub-item and report the options instead of restructuring CI).
4. Uncertain finding — `compiler/src/validators/ast-walk.ts` `walkFileAst` does not descend `EngineDeclNode.bodyChildren`.
   PROBE ONLY, do not change the walker: list every rule that uses `walkFileAst`; for the security-relevant one,
   E-ATTR-INTERP-EXECUTABLE (SPEC §5.2 says it applies in "engine state-children"), compile a minimal program with
   `<a href="javascript:${@x}">` inside an engine state-child body and inside a `<match>` arm, and report whether it fires.
   Report per rule: covered elsewhere / missed. Write the gap-entry text for the PA.
Verification: the pre-commit suite green; each `--check` passes; show the CI diff.

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (F4) — path-discipline incidents to date: 4 (S99) + S385 stash race + S456 cookie-jar leak

1. `pwd` — MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. Otherwise STOP and report.
   `git rev-parse --show-toplevel` must equal `pwd`. `git status --short` must be clean.
2. Your base: `git fetch origin && git merge-base HEAD origin/main` must equal `git rev-parse origin/main`; if not, `git merge --ff-only origin/main`.
3. Fetch your brief: `git fetch origin brief/s457 && git checkout FETCH_HEAD -- docs/changes/s457-maps-noncompliance/` then commit it as your first commit:
   `WIP(s457-maps-noncompliance): start at $(pwd)` (the PA verifies the worktree prefix in this message).
4. `bun install` (worktrees do not inherit node_modules), then `bun run pretest` run plainly from the worktree CWD
   (NOT `bun --cwd <path> run …` — that silently no-ops). Verify `samples/compilation-tests/dist/` was populated.
5. Every Read/Edit/Write uses an ABSOLUTE path under YOUR worktree root. Never `cd` into `/home/bryan-maclee/scrmlMaster/scrml`
   (the main checkout). Use `git -C "$WT"`. Write NOTHING outside your worktree (scratch: `$WT/.tmp/`, delete before your final report).
   `TMPDIR` must NOT point inside any repo — leave it unset.
6. NEVER `git stash` (the stash is shared across every worktree). Base-vs-build flips by FILE COPY.
7. NEVER `pkill -f` / `killall` on a command string — kill only PIDs you started.
8. Commit after every meaningful change (WIP commits fine); keep `docs/changes/s457-maps-noncompliance/progress.md` (append-only, timestamped).
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
