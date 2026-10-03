# BRIEF — s450-attr-multi-statement

## Prompt (verbatim)

change-id: s450-attr-multi-statement

You BUILD bryan's RULED item (v). Branch: `fix/s450-attr-multi-statement` (create from origin/main in your worktree).

STEP 0: Read `C:/Users/pjoli/AppData/Local/Temp/claude/C--Users-pjoli-Documents-GitHub-scrml/1c5b95fc-0ea7-4b6f-86bc-c5b6fa09f3b1/scratchpad/common-block.md` IN FULL and obey it. Commit THIS prompt verbatim + the common block as `docs/changes/s450-attr-multi-statement/BRIEF.md` with `progress.md` beside it.

THE RULING (bryan, S447 "stamp all", ledger scrml-support/user-voice-scrml.md §S447): "(v) `E-ATTR-MULTI-STATEMENT`: a multi-statement value in a non-handler attribute is an error." (fail closed). Today `title=(f(); "t")` silently DROPS the attribute.

Prior work: a retired S432 hold carried an attempt — refs `origin/hold/s432-expr-handler-multi-stmt` (may be deleted) and `origin/hold/s432-expr-handler-multi-stmt-alt` @121fb74c. Fetch them (`git fetch origin '+refs/heads/hold/s432-expr-handler-multi-stmt*:refs/remotes/origin/hold/s432-expr-handler-multi-stmt*'`) and read their diffs vs their merge-base for the E-ATTR-MULTI-STATEMENT part ONLY — the handler half of that hold was superseded by #1106 + #1212 (merged) and must NOT be re-applied. Use the hold as reference, not as a patch: main has moved a long way.

Normative reading first: SPEC §5 (attribute quoting semantics, §5.2.3 event handler forms — L19 REVERSED S435: inline block handlers `onclick={ s1; s2 }` are legal; E-MULTI-STATEMENT-HANDLER covers only the unbraced bare `;` sequence in handlers) and §7.2.2 (statement termination, S447 dpa-063 — newline ends a statement; `;` is a separator; E-STMT-MISSING-SEMICOLON). Quote the governing sentences. Define precisely what "a multi-statement value in a non-handler attribute" is for every attribute value form (parenthesized `(a; b)`, braced `{ a; b }`, `${ a; b }` interpolation in an attribute, newline-separated statements inside parens/braces) and which attributes are "handlers" (on* event attributes, and any other attribute the SPEC treats as a statement position — check bind:, if=, show=, effect=, rule=, `<each>`/`<match>` attributes). If a form's classification is not decided by the SPEC or the ruling, STOP on that form and report it; build the decided ones.

Required: emit `E-ATTR-MULTI-STATEMENT` (new code; §34 row; SPEC sentence in §5 with the Provenance line) at compile time for each decided form, with a message naming the attribute and the fix (a single expression, or move the statements into a function). The attribute must never be silently dropped any more. Handler attributes keep their current behaviour exactly (do not regress #1106/#1212).

Tests: unit tests for each decided form (fires), the handler forms (do not fire), single-expression attribute values incl. ones containing `;` inside a string literal or a nested function body/arrow block (must NOT fire — use the parsed tree, not text: a regex over source text in a post-AST stage needs a one-line justification per Rule 7), and a conformance codes case.

Direction: newly-rejecting — MEASURE the corpus base vs branch: list every program that now fails with the new code (count + file:line). Non-zero adopter hits are a finding to report, not something to migrate yourself.

Update/record: if a known-gaps entry exists for this (search `E-ATTR-MULTI-STATEMENT`, `multi-statement value`, `title=(`), resolve it with locus + prov=ruling:user-voice-scrml.md-S447-stamp-all; if none exists, add one resolved entry with locus/prov in the most recent S446/S450 section. state/facts/spec-index --write.

Push `git push -u origin fix/s450-attr-multi-statement`. Do NOT open a PR.

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
