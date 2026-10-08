# BRIEF — s457-no-artifacts-on-error (S457 ruling 1a)

CHANGE-ID: `s457-no-artifacts-on-error`. Agent: scrml-js-codegen-engineer, isolation worktree.

Ruling (user-voice-scrml.md §S457, "1a"): S435 impl#1-freeze exception granted — a compile that reports ANY Error-severity
diagnostic writes NO artifact, in every entry point (`scrml compile`, `scrml build`, `scrml serve` POST /compile outputs,
`scrml dev` / `--watch` recompiles, any other writer). Governing: SPEC §2.2.1 (S451 5(b)) "a compile that reports any error
SHALL NOT produce a runnable artifact" — quote it. Gap: `g-impl1-artifacts-written-on-error-s451` (read it; locus
`compiler/src/commands/refusal-gate.js` APPLICATION_SCOPE_REFUSALS + validate-emit.ts).
Design notes (decide, record in progress.md): a FAILED compile must not leave a previous successful build's artifacts in
place looking current either — decide between (i) leave the output dir untouched and report clearly (recommended: safer for
`dev`, where an unchanged last-good build keeps serving), and (ii) delete stale outputs; state which and why, per entry point.
`serve` returns no `outputs` (or an empty set) on error. Warnings/Info never block.
MEASURE FIRST: which tests, scripts and tools rely on error-path artifacts (grep tests that compile a failing program and then
read its output; conformance runner; bootstrap-conformance; corpus-emit-differential; LSP). Update them to the new contract
(assert on diagnostics, not artifacts) — list every one in progress.md. If something legitimately needs the partial output
(e.g. a debugging flag), propose an explicit opt-in flag rather than keeping the default; do not add one silently.
Verification: a refused program (e.g. a quoted `onclick="${@x}"`, a `javascript:` literal URL, a §8.1.2 multi-statement body)
produces no files through each entry point; a successful compile is byte-identical to before; full suite incl. the browser
tier (`bun run test` and the CI "Browser tier failure NAME-SET gate" step from .github/workflows/ci.yml, run exactly);
conformance; corpus differential. Direction: newly-rejecting at the tooling level (no language-surface change).

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (F4) — path-discipline incidents to date: 4 (S99) + S385 stash race + S456 cookie-jar leak

1. `pwd` — MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. Otherwise STOP and report.
   `git rev-parse --show-toplevel` must equal `pwd`. `git status --short` must be clean.
2. Your base: `git fetch origin && git merge-base HEAD origin/main` must equal `git rev-parse origin/main`; if not, `git merge --ff-only origin/main`.
3. Fetch your brief: `git fetch origin brief/s457c && git checkout FETCH_HEAD -- docs/changes/s457-no-artifacts-on-error/` then commit it as your first commit:
   `WIP(s457-no-artifacts-on-error): start at $(pwd)` (the PA verifies the worktree prefix in this message).
4. `bun install` (worktrees do not inherit node_modules), then `bun run pretest` run plainly from the worktree CWD
   (NOT `bun --cwd <path> run …` — that silently no-ops). Verify `samples/compilation-tests/dist/` was populated.
5. Every Read/Edit/Write uses an ABSOLUTE path under YOUR worktree root. Never `cd` into `/home/bryan-maclee/scrmlMaster/scrml`
   (the main checkout). Use `git -C "$WT"`. Write NOTHING outside your worktree (scratch: `$WT/.tmp/`, delete before your final report).
   `TMPDIR` must NOT point inside any repo — leave it unset.
6. NEVER `git stash` (the stash is shared across every worktree). Base-vs-build flips by FILE COPY.
7. NEVER `pkill -f` / `killall` on a command string — kill only PIDs you started.
8. Commit after every meaningful change (WIP commits fine); keep `docs/changes/s457-no-artifacts-on-error/progress.md` (append-only, timestamped).
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
