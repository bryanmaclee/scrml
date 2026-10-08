# BRIEF — s457-sql-check-at-lowering (S457) — HIGH, security

CHANGE-ID: `s457-sql-check-at-lowering`. Agent: scrml-js-codegen-engineer, isolation worktree.

Gap: `docs/known-gaps.md` `g-sql-checker-and-lowering-read-different-text-s457` (HIGH) — read it IN FULL; it has three
executed repros (each compiles at exit 0 and emits a `DROP TABLE` that ran against SQLite). Root: the program-body SQL checks
(SPEC §8.1.2 one statement + the closed statement allow-list; §14.8.10 tenant checks — read both IN FULL) scan RAW scrml
text (`compiler/src/sql-in-expression-text.ts` `scanExpressionTextForSql`), while the emitter lowers REWRITTEN or
structurally-parsed text (`compiler/src/codegen/rewrite.ts` `rewriteSqlRefs` runs after `rewriteServerReactiveRefs`;
`compiler/src/codegen/emit-server.ts` `emitServerTemplateLit`; a template raw holding `__scrml_sql_ref__(…)` when `<#name>`
is present — `compiler/src/expression-parser.ts`). Loci are PA hypotheses — verify.
The S456 durable: "two readers of one text = a bypass; ONE reader whose answer is the runtime's". Fix the ROOT: every point
where a `?{…}` becomes a driver call (tagged template, `.unsafe`, any other lowering — ENUMERATE them all first, list in
progress.md) must run the program-body SQL checks on the exact SQL text that call will send, so a site the emitter lowers is a
site the checks read. The §8.1.2 one-statement guard is already enforced at codegen (`judgeDriverCall`,
`compiler/src/codegen/sql-one-statement-guard.ts`) — extend that pattern to the statement allow-list and the tenant checks;
keep the earlier checks if they give better diagnostics, but the lowering-point check is the authority. Diagnostics must point
at the source `?{` (not emitted JS) where possible.
Also fold in: the LOW perf residual `g-sql-site-locator-nested-paren-quadratic-s457` (CodeSoFar.tail: hand regexAllowedAfter
the units before the matching `(` plus `"()"`).
Note: a sibling branch (`s457-is-some-core`) also edits rewrite.ts (a new is-predicate pass); keep your rewrite.ts edits
local to the SQL lowering so a 3-way merge is clean.
Verification: the gap's three repros + the keyword list (`@in @delete @typeof @void @return @await @yield @else @finally @throw
@instanceof @do`) + `.unsafe` `ATTACH DATABASE` → refused at compile, nothing written; run against SQLite to show nothing
executes; all existing SQL/tenant tests; EMPIRICAL corpus differential (`scripts/corpus-emit-differential.ts`) — expected
inert (report any newly refused corpus program: that is a measured migration, STOP and report if non-zero).
Direction: newly-rejecting (conformance restoration to §8.1.2 / §14.8.10 as ruled S456).

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (F4) — path-discipline incidents to date: 4 (S99) + S385 stash race + S456 cookie-jar leak

1. `pwd` — MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. Otherwise STOP and report.
   `git rev-parse --show-toplevel` must equal `pwd`. `git status --short` must be clean.
2. Your base: `git fetch origin && git merge-base HEAD origin/main` must equal `git rev-parse origin/main`; if not, `git merge --ff-only origin/main`.
3. Fetch your brief: `git fetch origin brief/s457b && git checkout FETCH_HEAD -- docs/changes/s457-sql-check-at-lowering/` then commit it as your first commit:
   `WIP(s457-sql-check-at-lowering): start at $(pwd)` (the PA verifies the worktree prefix in this message).
4. `bun install` (worktrees do not inherit node_modules), then `bun run pretest` run plainly from the worktree CWD
   (NOT `bun --cwd <path> run …` — that silently no-ops). Verify `samples/compilation-tests/dist/` was populated.
5. Every Read/Edit/Write uses an ABSOLUTE path under YOUR worktree root. Never `cd` into `/home/bryan-maclee/scrmlMaster/scrml`
   (the main checkout). Use `git -C "$WT"`. Write NOTHING outside your worktree (scratch: `$WT/.tmp/`, delete before your final report).
   `TMPDIR` must NOT point inside any repo — leave it unset.
6. NEVER `git stash` (the stash is shared across every worktree). Base-vs-build flips by FILE COPY.
7. NEVER `pkill -f` / `killall` on a command string — kill only PIDs you started.
8. Commit after every meaningful change (WIP commits fine); keep `docs/changes/s457-sql-check-at-lowering/progress.md` (append-only, timestamped).
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
