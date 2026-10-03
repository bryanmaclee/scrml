# BRIEF — s450-transaction-in-function-body

## Dispatch prompt (verbatim)

change-id: s450-transaction-in-function-body

aM-blocking HIGH (blocks the adopter's db.js → `?{}` migration). Branch: `fix/s450-transaction-in-function-body` (create from origin/main in your worktree).

STEP 0: Read `C:/Users/pjoli/AppData/Local/Temp/claude/C--Users-pjoli-Documents-GitHub-scrml/1c5b95fc-0ea7-4b6f-86bc-c5b6fa09f3b1/scratchpad/common-block.md` IN FULL and obey it. Commit THIS prompt verbatim + the common block as `docs/changes/s450-transaction-in-function-body/BRIEF.md` with `progress.md` beside it.

Defect: `g-transaction-block-not-recognized-inside-a-function-body` (docs/known-gaps.md — read in full). `transaction { … }` compiles at the top level of a `${}` logic block but inside a FUNCTION body fails `E-SCOPE-001 Undeclared identifier transaction`. Reproduced on main @bc4bca1f with the committed sample `samples/compilation-tests/gauntlet-s20-sql/sql-transaction-001.scrml` (PA triage).

GOVERNING SENTENCES (compiler/SPEC.md §19.10.2–§19.10.4, ~line 17821; re-read them yourself):
- §19.10.2's normative example is `function transferFunds(from, to, amount)! -> TransferError { transaction { … fail TransferError::InsufficientFunds(…) … ?{…}.run() } }`.
- §19.10.3: "`transaction { }` is syntactic sugar. The compiler SHALL emit `?{BEGIN}` at the start of the block, `?{COMMIT}` at the end of normal completion, and `?{ROLLBACK}` before any `fail` statement within the block." + SQL-error auto-rollback in a `!` function.
- §19.10.4: "`transaction { }` SHALL be valid only inside `!` functions. Using `transaction` in a non-`!` function SHALL be a compile error (E-ERROR-001 applies)"; never left open; no nesting (E-ERROR-007); explicit `?{BEGIN}`… stays valid.
So accepting it inside a `!` function body is CONFORMANCE RESTORATION (newly-accepting toward the contract — a bug fix, not a widening).

Required:
1. `transaction { }` parses and lowers correctly inside function bodies (incl. nested statement positions inside the function: if/else, loops, match arms — check what §19.10 allows; the block itself is a statement). Lowering per §19.10.3 incl. ROLLBACK before every `fail` in the block (at any depth inside it), COMMIT on normal completion, rollback on SQL error, and correct behaviour for `return` from inside the block (the SPEC is silent on `return`-inside-transaction — if so, record "searched §19.10, §8.9 — no governing sentence" and STOP on that shape: report it, and make the implementation fail closed for it rather than guess, e.g. leave it as a clear compile error naming the gap).
2. §19.10.4 checks: non-`!` function → E-ERROR-001; nested → E-ERROR-007.
3. Loci (PA-located-verify; from the gap): `compiler/src/ast-builder.js` — the transaction-block handler (~13707) is not reached from a function body because `collectExpr` (~4417) funnels the statement into `parseExpression` (`expression-parser.ts` ~3015). ⚑ fn/function decls parse at FIVE duplicated ast-builder.js sites incl. an `export` re-parse that swallows errors — make sure every function-body path reaches the handler (fix the root, not one site). Report whether the loci held.
4. ⚑ TOP-LEVEL: §19.10.4 says valid ONLY inside `!` functions, yet the top level of `${}` accepts it today. Do NOT change top-level behaviour in this branch. Instead MEASURE: count corpus programs (examples/, samples/, aM `C:/Users/pjoli/Documents/GitHub/assetManagement/app/src`, flogenceP `src/`, read-only) that use `transaction {` at top level vs in functions, and report it — the PA routes the top-level question.
5. Tests: unit + an end-to-end server runtime test against a real bun:sqlite db proving commit, rollback-on-fail (state unchanged), rollback-on-SQL-error; E-ERROR-001/E-ERROR-007 cases; the committed sample compiles. Conformance cases (codes + runtime halves if the format supports runtime).
6. Empirical R26: compile aM's real source and confirm nothing regresses (aM currently doesn't use it in functions because it couldn't).
7. Update the gap entry (status=resolved, locus, prov=spec:§19.10.2-§19.10.4); state/facts/spec-index --write.

Push `git push -u origin fix/s450-transaction-in-function-body`. Do NOT open a PR.

Final report per the common block.

## Common block (verbatim)

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (path-discipline incidents this project: many; keep yours at 0)
1. `pwd` MUST start with `C:/Users/pjoli/Documents/GitHub/scrml/.claude/worktrees/agent-` (or the /c/... form). `git rev-parse --show-toplevel` must equal it. Base check: `git fetch origin && git merge-base HEAD origin/main` == `git rev-parse origin/main` (your worktree is cut from origin/main). If ANY check fails: STOP, report, exit.
2. `bun install` then `bun run pretest` FROM THE WORKTREE CWD (never `bun --cwd <path> run …` — it silently no-ops; check that samples/compilation-tests/dist/ was produced).
3. Every Read/Edit/Write uses an ABSOLUTE path under YOUR worktree root. NEVER write a path under C:/Users/pjoli/Documents/GitHub/scrml/ that is not inside your worktree. NEVER `cd` into the main checkout. Use `git -C <worktree>` / `--cwd=<worktree>` forms.
4. NEVER `git stash` (refs/stash is shared across every worktree — use file copies for A/B). NEVER `pkill -f`/`killall` on a shared command string — kill by captured PID only.
5. Private scratch ONLY under `<your-worktree>/.tmp/` (delete before final report). Do NOT set TMPDIR inside any repo. Other agents are live in sibling worktrees — do not read or write their worktrees or the main checkout's working files.
6. First commit message: `WIP(<change-id>): start at $(pwd)` (literal pwd).
7. Commit after EVERY meaningful change (WIP commits fine); append timestamped lines to `docs/changes/<change-id>/progress.md`. Clean `git status` before your final report.
8. This is a Windows CRLF checkout: scrml's @generated regen scripts (`scripts/facts.ts`, `scripts/state.ts`, `scripts/regen-spec-index.ts`) can misbehave on CRLF — if a `--check` fails right after `--write`, strip CR from the target file and re-run. The cloud gate runs `facts.ts --check`, `state.ts --check` AND `regen-spec-index.ts --check`; run all three `--write` then `--check` before your final commit.
9. Commit hook: pre-commit runs `bun test compiler/tests/{unit,integration,conformance} --bail` (~2-5 min); commit FOREGROUND with a long timeout (≥ 600000 ms). Never `--no-verify`. Known Windows-local baseline flakes (fail identically on main): `lift-engine-advance-bug65` §1 (5-s node --check timeout), self-host-smoke ×3, csrf B5, expr-node timeout. If the hook fails ONLY on those, re-run once; if it still fails on them, report it — do not bypass.
10. Commit messages: `-F <file>` for anything containing `${}` or backticks. End every commit message with the line: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## MAPS — REQUIRED FIRST READ
Read `.claude/maps/primary.map.md` first (stamp: commit 6a592ed5c, 2026-10-02) and follow its Task-Shape Routing to the 2-4 maps relevant to your task. Landings since the stamp (factor them in; treat map content as a verify-against-source hypothesis): #1231–#1239 (S447 wrap, S449: §6.15 value positions do not write [bootstrap], <effect> deps, protect egress r9, auth/session E-SESSION-AMBIENT-SERVER + E-AUTH-ATTR-INVALID, §47.14 data-root containment). In your final report state whether the maps were load-bearing ("not load-bearing" is a valid answer).

## LANGUAGE-SURFACE DISCIPLINE (Peter's lane — bryan holds language authority; these items are RULED by bryan, you are executing a stamp)
- Quote the governing ruling in your SPEC amendment as `> **Provenance:** ruling:user-voice-scrml.md S447 "stamp all" — <the ruled sentence>`. Any new code gets a §34 row in the same change (named codes land with their impl).
- Classify the change's direction (inert / newly-rejecting / newly-accepting / semantics-changed) and MEASURE the migration: compile the real corpus on base AND on your branch and report the count + files that change. Corpus: `examples/`, `samples/`, and the adopters `C:/Users/pjoli/Documents/GitHub/assetManagement/app/src` and `C:/Users/pjoli/Documents/GitHub/flogenceP/src` (READ-ONLY — compile with `--output-dir` pointed into your `.tmp/`, never into those repos). Command: `bun <worktree>/compiler/bin/scrml.js compile <src-or-dir> --output-dir <worktree>/.tmp/<x>`.
- If you hit a shape the ruling does not decide, STOP at that point and report it as an open question — do not decide new language surface yourself.
- Do not touch: `compiler/self-host-v2/**`, `compiler/native-parser/**`, §14.8.9 protect-egress code, auth/session code, `.claude/maps/`, `docs/pr-reviews.md`.

## STOP RULE (written before review, binding)
If your change makes something that passed on base fail (a test, a corpus program, an example) and that is not a direct, intended consequence of the ruling, you do not widen the fix to chase it: narrow, revert that part, or stop and report. A self-made regression is never resolved by expanding scope.

## FINAL REPORT (keep it short)
WORKTREE_PATH · BRANCH · FINAL_SHA · files touched · direction-of-change class + measured corpus delta (counts + files) · tests run + results (exact numbers) · new codes · open questions · maps load-bearing? · anything you did NOT do.
