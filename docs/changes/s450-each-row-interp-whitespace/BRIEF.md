# BRIEF — s450-each-row-interp-whitespace

## Prompt (verbatim)

change-id: s450-each-row-interp-whitespace

aM-reported silent rendering bug. Branch: `fix/s450-each-row-interp-whitespace` (create from origin/main in your worktree).

STEP 0: Read `C:/Users/pjoli/AppData/Local/Temp/claude/C--Users-pjoli-Documents-GitHub-scrml/1c5b95fc-0ea7-4b6f-86bc-c5b6fa09f3b1/scratchpad/common-block.md` IN FULL and obey it. Commit THIS prompt verbatim + the common block as `docs/changes/s450-each-row-interp-whitespace/BRIEF.md` with `progress.md` beside it.

Defect (PA triage, reproduced on main @bc4bca1f in happy-dom; repro + harness at `C:/Users/pjoli/AppData/Local/Temp/claude/C--Users-pjoli-Documents-GitHub-scrml/1c5b95fc-0ea7-4b6f-86bc-c5b6fa09f3b1/scratchpad/am-triage/` — look for `r07-ws` and `harness.mjs`; read-only, copy into your .tmp): inside an `<each>` row, `${a} ${b}` renders `PeterOliver` — the whitespace-only text between two adjacent interpolations is dropped. Top-level `${a} ${b}`, `Name: ${x}`, and `${a + " " + b}` all render correctly. aM documented it at `C:/Users/pjoli/Documents/GitHub/assetManagement/docs/scrml-finding-adjacent-interpolation-whitespace.md` (read-only).

GOVERNING SENTENCE: compiler/SPEC.md §4.18.5 — whitespace is kept exactly in both text-mode productions (S442: the free-text collapse claim deleted; whitespace-only text between elements kept too). Read §4.18.5 and quote it in your commit. This makes the fix conformance restoration (semantics-changed toward the contract).

Locus (PA-located, searched-not-traced): `compiler/src/codegen/emit-each.ts` row-body text emission — each interpolation becomes its own `_scrml_each_tn_*` text node and the whitespace-only text between them is not emitted. Report whether it held.

Fix the CLASS: find every place a row/template body drops whitespace-only text nodes — `<each>` row bodies (bare-body and `:`-shorthand), and check the siblings: `<match>` block arms, engine state-child bodies, `if=` branches inside rows, component bodies rendered per row, lift bodies. Known nearby ledger entries to check and cross-reference (they may be the same class): `g-lift-markup-adjacent-text-leading-space-dropped`, `g-ast-markup-text-interp-adjacent-space-dropped` in docs/known-gaps.md. If the root is upstream (AST builder dropping whitespace-only text), fix it there once rather than per emitter — but measure: a root fix may change many emitted files. Note §4.18 distinguishes free-text bodies (whitespace kept) from code-default bodies (engine state-child / match arm / `:`-shorthand: a bare run is CODE, display text is a `"…"` literal) — whitespace between two `${}` in a code-default body may be governed differently; read §4.18.1/§4.18.5 and decide per production from the text, and STOP and report any production the text does not decide.

Tests: happy-dom runtime tests (row text content exactly `"Peter Oliver"`; leading/trailing/multiple spaces; newline + indentation between interpolations in a multi-line row — check what §4.18.5 says that should render as); keyed reconciliation still works after an update; root afterAll unregister for happy-dom (pattern from #1219). Conformance runtime case if supported.

Direction: semantics-changed — MEASURE: build examples/, samples/, aM `C:/Users/pjoli/Documents/GitHub/assetManagement/app/src`, flogenceP `src/` (read-only) base vs branch; report the count of emitted files whose output changes and characterize the change (only whitespace text nodes added?). A large unexpected delta is a STOP-and-report.

File/resolve the ledger: add a resolved gap entry (or resolve the matching existing one) with locus + prov=adopter:assetManagement-scrml-finding-adjacent-interpolation-whitespace + spec:§4.18.5. state/facts/spec-index --write.

Push `git push -u origin fix/s450-each-row-interp-whitespace`. Do NOT open a PR.

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
