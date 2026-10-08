# BRIEF — s457-reexport-and-dev-tenant-check (S457) — REPRODUCE FIRST

CHANGE-ID: `s457-reexport-and-dev-tenant-check`. Agent: scrml-js-codegen-engineer, isolation worktree. Two independent items.
For EACH: reproduce on current main FIRST. If it does not reproduce, STOP that item and report NOT-REPRODUCED with the exact
commands and output — do not fix a ghost.

A. `g-server-reexport-of-scrml-module-fails-to-link-s456` (MED, reviewer-executed, PA-unverified). `export { w as helper } from "./c.scrml"`
   in a `.scrml` module is not emitted in its `.server.js`, so an importer's server artifact fails to link ("Export named 'helper'
   not found"). Locus: not traced (emit-server re-export emission). Build a 3-file reproducer (c.scrml defines a server-touching
   function, b.scrml re-exports it, a.scrml imports from b and calls it), compile, run the server artifact under bun. Check the
   client artifact too, and `export * from`. Governing text: SPEC §21 (re-export) — quote it.
B. `g-tenant-startup-check-built-server-only-s456` (MED). The S456 undeclared-tenant-table startup check (`E-DEPLOY-DB-TENANT-UNDECLARED`,
   `/_scrml/health` 503) runs only in the `_server.js` that `scrml build` writes; `scrml dev` does not run it. Locus (hypothesis):
   `compiler/src/commands/dev.js` + `compiler/src/codegen/tenant-startup-check.ts`. Governing ruling: user-voice S456
   "b, startup check lands with it" (the check is part of the floor, not of the build command) and SPEC §14.8.10 — quote it.
   Make `scrml dev` run the same check (same code, not a copy) and refuse to serve the same way. A `scrml compile` module served
   by a foreign host: report what is feasible (e.g. an exported check the host must call) — do NOT design an API; describe options.
Verification: reproducer before/after for each; tests; empirical run of `scrml dev` against a SQLite db holding an undeclared
`tenant_id` table (refuses) and a clean one (serves).

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (F4) — path-discipline incidents to date: 4 (S99) + S385 stash race + S456 cookie-jar leak

1. `pwd` — MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. Otherwise STOP and report.
   `git rev-parse --show-toplevel` must equal `pwd`. `git status --short` must be clean.
2. Your base: `git fetch origin && git merge-base HEAD origin/main` must equal `git rev-parse origin/main`; if not, `git merge --ff-only origin/main`.
3. Fetch your brief: `git fetch origin brief/s457 && git checkout FETCH_HEAD -- docs/changes/s457-reexport-and-dev-tenant-check/` then commit it as your first commit:
   `WIP(s457-reexport-and-dev-tenant-check): start at $(pwd)` (the PA verifies the worktree prefix in this message).
4. `bun install` (worktrees do not inherit node_modules), then `bun run pretest` run plainly from the worktree CWD
   (NOT `bun --cwd <path> run …` — that silently no-ops). Verify `samples/compilation-tests/dist/` was populated.
5. Every Read/Edit/Write uses an ABSOLUTE path under YOUR worktree root. Never `cd` into `/home/bryan-maclee/scrmlMaster/scrml`
   (the main checkout). Use `git -C "$WT"`. Write NOTHING outside your worktree (scratch: `$WT/.tmp/`, delete before your final report).
   `TMPDIR` must NOT point inside any repo — leave it unset.
6. NEVER `git stash` (the stash is shared across every worktree). Base-vs-build flips by FILE COPY.
7. NEVER `pkill -f` / `killall` on a command string — kill only PIDs you started.
8. Commit after every meaningful change (WIP commits fine); keep `docs/changes/s457-reexport-and-dev-tenant-check/progress.md` (append-only, timestamped).
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
