# BRIEF — s450-headless-serve-loopback

change-id: s450-headless-serve-loopback

You BUILD bryan's RULED item (iv). Branch: `fix/s450-headless-serve-loopback` (create from origin/main in your worktree).

STEP 0: Read `C:/Users/pjoli/AppData/Local/Temp/claude/C--Users-pjoli-Documents-GitHub-scrml/1c5b95fc-0ea7-4b6f-86bc-c5b6fa09f3b1/scratchpad/common-block.md` IN FULL and obey it. Commit THIS prompt verbatim + the common block as `docs/changes/s450-headless-serve-loopback/BRIEF.md` with `progress.md` beside it.

THE RULING (bryan, S447 "stamp all", ledger scrml-support/user-voice-scrml.md §S447): "(iv) generated headless serve targets default to loopback, prod stays all-interfaces."

Context: `g-generated-headless-and-prod-servers-bind-all-interfaces` (docs/known-gaps.md — read in full). #1207 (S446, merged — read `gh pr diff 1207`) made `scrml dev` / `scrml serve` bind loopback by default with `--host` to opt in, and refuses inet_aton shorthand + whitespace hosts. The generated HEADLESS server (`compiler/src/codegen/emit-tool.ts` emits it with no `hostname` — PA-located-verify) still binds every interface. The production server entry produced by `scrml build` STAYS all-interfaces (do not change it; but verify and record in a test that it does bind all-interfaces, so the ruling's other half is pinned).

Before coding: establish exactly which generated targets are "headless serve targets" — read SPEC §64 (standalone tool target, `<program kind="tool">`, long-running server form) and §40 and wherever the headless server is specified; find EVERY emitter path that produces a listening server that is not the `scrml build` prod entry (search for `Bun.serve`, `hostname`, `port` across compiler/src/codegen and compiler/src/commands). List them in your report with the decision for each. If any path is ambiguous between "headless" and "prod", STOP on that path and report it as an open question; build the unambiguous ones.

Required: those headless targets default `hostname` to loopback (match #1207's choice of loopback literal and IPv4/IPv6 handling exactly — reuse its helper if one exists rather than restating it), with an explicit opt-in mechanism consistent with #1207 (e.g. an env var / CLI flag the generated server honours — mirror what #1207 did for serve; if the generated server has no CLI, use the mechanism the SPEC/§64 specifies or report the fork). Apply #1207's host validation to that opt-in.

Tests: unit tests on the emitted server source (hostname present, loopback default, opt-in honoured, invalid host refused), plus one test pinning prod = all-interfaces. Use the per-process test temp root (do not create temp dirs that bypass os.tmpdir()).

Direction: semantics-changed (network binding) — MEASURE: compile every corpus program that produces a headless server (examples/, samples/, flogenceP src/ — flogence ships `kind="tool"` ports) base vs branch and list which emitted files change. ⚑ flogenceP's tools may be run in ways that need all-interfaces — report any port/tool in flogenceP that is a server and how it would be affected; do not edit flogenceP.

SPEC: amend the section that specifies the headless server's binding with the Provenance line; §34 row if a new diagnostic. Update the gap entry (status=resolved, locus, prov=ruling:user-voice-scrml.md-S447-stamp-all); state/facts/spec-index --write.

Push `git push -u origin fix/s450-headless-serve-loopback`. Do NOT open a PR.

Final report per the common block.

---

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
