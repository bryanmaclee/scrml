# BRIEF — s450-handler-nested-server-write-await

change-id: s450-handler-nested-server-write-await

You BUILD bryan's RULED item (iii) in impl#1 codegen. Branch: `fix/s450-handler-nested-server-write-await` (create from origin/main in your worktree).

STEP 0: Read `C:/Users/pjoli/AppData/Local/Temp/claude/C--Users-pjoli-Documents-GitHub-scrml/1c5b95fc-0ea7-4b6f-86bc-c5b6fa09f3b1/scratchpad/common-block.md` IN FULL and obey it. Commit THIS prompt verbatim + the common block as `docs/changes/s450-handler-nested-server-write-await/BRIEF.md` with a `progress.md` beside it.

THE RULING (bryan, S447 "stamp all", ledger scrml-support/user-voice-scrml.md §S447): "(iii) nested-sequence stale read: keep the fire-and-forget skip only when the cell write is the handler's SOLE root statement, await in place everywhere else."

The defect (`g-handler-nested-sequence-server-write-stale-read`, docs/known-gaps.md — read it in full, incl. its happy-dom runtime probe): `${ if (@c) { @x = save(); @y = @x + 1 } }` in a handler still reads stale `@x` because #1217 (S446, merged — read its diff: `gh pr view 1217`, `gh pr diff 1217`) fixed only TOP-LEVEL ≥2-statement handler lists. Normative: SPEC §13.2 (auto-await) and §5.2.3 (event handler forms) — READ both sections in compiler/SPEC.md via SPEC-INDEX line ranges and quote the governing sentences in your SPEC amendment / commit.

Required behaviour after your change: a server-call write to a cell is fire-and-forget ONLY when that write is the handler's SOLE root statement (single-statement handler `onclick=@x = save()` and its braced single-statement form). In every other position — nested inside if/else/loop/match-arm/block bodies at any depth, or one of several root statements — the write is awaited in place before the next statement runs. This must hold for every handler emitter (the gap names emit-event-wiring.ts, emit-each.ts, emit-lift.js `handlerStatementListColor`) — enumerate ALL handler emitters by search and cover each; do not fix one position (base fork rule row 4: fix the root, not a position). A walk that hand-lists child keys misses `if-chain` nodes whose bodies hide under branches[].element/elseBranch — use a generic walk or descend those explicitly, and test an if/else-if/else chain.

Loci (PA-located-verify): `compiler/src/codegen/js-async-analysis.ts` (analyze, `arg1Skip`), handler emitters above. Report whether these held.

Tests: runtime tests (happy-dom, like #1217's) proving the nested read sees the new value for: if, if/else-chain, for/while body, match arm, nested block; plus the SOLE-root-statement case still fire-and-forget (unchanged); plus a 2-root-statement list (already fixed by #1217 — must stay fixed). Any new happy-dom test file needs the root afterAll unregister (see #1219 for the pattern — happy-dom globals leaked into later files before). Add a conformance case pinning the runtime half if the conformance format supports runtime effects (check conformance/).

Direction: semantics-changed (timing) — MEASURE: compile the corpus base vs branch and report which emitted files change (count + names), and spot-check that no adopter handler now awaits where it previously relied on fire-and-forget at the sole root.

SPEC: if §13.2/§5.2.3 do not already state the sole-root-statement rule, add it with the Provenance line. Update the gap entry (status=resolved, locus, prov=ruling:user-voice-scrml.md-S447-stamp-all); state.ts/facts.ts/regen-spec-index --write.

Push `git push -u origin fix/s450-handler-nested-server-write-await`. Do NOT open a PR.

Final report per the common block.

---

# COMMON BLOCK (verbatim)

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
