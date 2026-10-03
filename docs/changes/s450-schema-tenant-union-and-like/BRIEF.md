# BRIEF — s450-schema-tenant-union-and-like

## Dispatch prompt (verbatim)

change-id: s450-schema-tenant-union-and-like

You BUILD two of bryan's RULED items in the `<schema>` tenant-floor area (impl#1, TypeScript compiler). Branch: `fix/s450-schema-tenant-union-and-like` (create it in your worktree from origin/main).

STEP 0: Read `C:/Users/pjoli/AppData/Local/Temp/claude/C--Users-pjoli-Documents-GitHub-scrml/1c5b95fc-0ea7-4b6f-86bc-c5b6fa09f3b1/scratchpad/common-block.md` IN FULL and obey it. Then commit THIS prompt verbatim + the common block as `docs/changes/s450-schema-tenant-union-and-like/BRIEF.md` (your first content commit), with `progress.md` beside it.

THE RULINGS (bryan, S447, "stamp all" — ledger scrml-support/user-voice-scrml.md §S447 "RULED — \"stamp all\""):
(i) `g-schema-commented-out-declaration-shadows-live-table` (docs/known-gaps.md, search the id): "commented-out `<schema>` copy: union over declarations + a loud diagnostic when same-name declarations disagree on `tenant_id` (new code)". Background from the routing note: a union over declarations alone OVER-scopes when a stale commented copy carries `tenant_id` (runtime: `SELECT *` silently returns `[]`). So: (a) the tenant-floor reading must union every declaration of a table (not first-wins, and not reading DSL inside `/* */` comments as a live declaration — read the gap entry for the exact mechanism), and (b) when two same-name declarations DISAGREE on whether the table carries `tenant_id`, fire a NEW loud diagnostic. Name the code in the `E-SCHEMA-*` family following §34 numbering conventions (check the next free number; S446 used E-SCHEMA-012/013/014), give it a §34 row and a SPEC sentence in the §39 / tenant-floor section where E-SCHEMA-012..014 live.
(ii) `g-schema-create-table-like-template-columns-not-declared`: "`CREATE TABLE x (LIKE tmpl INCLUDING|EXCLUDING …)` = a template reference, fail closed (E-SCHEMA-014)". Precisely: inside a CREATE TABLE column list, `LIKE <ident>` followed by `INCLUDING` | `EXCLUDING` | `,` | `)` is a template reference (a column NAMED `like` with a type is not — keep that working). A template reference makes the column set undeclarable to the floor → fail closed with the existing E-SCHEMA-014 (extend its §34 row / SPEC sentence to name the LIKE case).

Loci (PA-located-verify — symbols found by search, not traced; report whether they held): `compiler/src/schema-differ.js` — the read inside `schemaCreateTables` (comment-agnostic, first-wins per key), `parseSchemaBlock` (reads DSL inside `/* */`), `isTableLevelConstraint` (skips `LIKE x` as a constraint), `columnsFromDdlBody`. #1209 (S446, merged) is the most recent change in this area: read its diff (`git log --oneline -- compiler/src/schema-differ.js`) before editing — note its review REMOVED a naive union because of silent data loss and REVERTED a `"""` change as a security regression; do not reintroduce either.

Requirements:
- Tests: unit tests for both rulings incl. the negative shapes (a column named `like`; a commented-out copy that AGREES on tenant_id → no diagnostic; disagreeing → the new code; live + commented both lacking tenant_id → unchanged behaviour). Add conformance cases pinning both (codes half; see conformance/ for the case format and how codes cases are registered).
- Direction: (i) is newly-rejecting where declarations disagree + semantics-changed for the union; (ii) newly-rejecting. MEASURE on the corpus per the common block and report counts.
- Update both gap entries in docs/known-gaps.md: status=resolved, keep/refresh `locus=`, add `prov=ruling:user-voice-scrml.md-S447-stamp-all`; add the resolution line. Do not touch other gap entries. Run state.ts --write.
- SPEC.md amendment with the Provenance line; regen-spec-index.ts --write; facts.ts --write.
- Push the branch (`git push -u origin fix/s450-schema-tenant-union-and-like`). Do NOT open a PR (the PA reviews first).

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
