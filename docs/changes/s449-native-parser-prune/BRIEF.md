change-id: s449-native-parser-prune

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (path-discipline incidents to date: track yours, report 0 or N)
1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`; `git rev-parse --show-toplevel` equals it; clean tree; `git fetch origin` then `git merge-base HEAD origin/main` == `git rev-parse origin/main` (if behind: `git merge --ff-only origin/main`). Any other failure: STOP and report.
2. `bun install`; `bun run pretest` (plainly from the worktree CWD).
3. EVERY Write/Edit uses an absolute path UNDER your worktree root. Never `cd` into /home/bryan-maclee/scrmlMaster/scrml (main). NEVER `git stash`. NEVER a bare `pkill -f`. Scratch in `<worktree>/.tmp/` (deleted at end); `TMPDIR` never inside a repo.
4. First commit: this prompt verbatim → docs/changes/s449-native-parser-prune/BRIEF.md, message `WIP(s449-native-parser-prune): start at $(pwd)`. Commit after each deletion batch; progress.md append-only. Never --no-verify, never touch core.hooksPath. Long timeout on foreground commits.
5. MEMORY GATE: check `free -g` "available" before each commit / full run; if < 6 wait (≤10 polls, 60 s).

MAPS — REQUIRED FIRST READ: /home/bryan-maclee/scrmlMaster/scrml/.claude/maps/primary.map.md (stamp 6a592ed5c; main since landed #1231–#1235). Hypothesis only; report whether load-bearing.
Model: Opus.
RULING AUTHORITY: /home/bryan-maclee/scrmlMaster/scrml-support/user-voice-scrml.md §S449 item 6 — read verbatim. Data pack (read IN FULL first; every number in it was measured at 2d6d8cd43 — re-measure before relying): /home/bryan-maclee/scrmlMaster/scrml-support/docs/deep-dives/native-parser-fate-2026-10-02.md. Parallel siblings: auth agent (compiler/src auth/session files, §52.13.2), SPEC-text agent (§4.11.3, §6.7.*, §6.8.4, §6.14, §18.16, §34 lifecycle rows), bootstrap agent (compiler/self-host-v2/**), protect round 9 (protect-flow.ts). Your SPEC edits: §22.12 and the §34.1 intro ONLY. docs/known-gaps.md shared — append in `## §S449-native-parser-prune`.

## The ruling (item 6 = (b))
compiler/native-parser is FROZEN as part of impl#1 (security fixes only; divergences filed not fixed). It is NOT deleted: impl#1 imports it in production (meta-eval.ts, component-expander.ts, ast-builder.js, block-splitter.js, api.js, native-walker/*). PRUNE what nothing uses:
1. the `.scrml` mirrors under compiler/native-parser/ and their compiled output (pack: 25 of 37 don't compile; nothing consumes them) — verify zero consumers by grep across the repo + package.json `files` + CI before deleting;
2. the within-node parity test and its allowlist (compiler/tests/conformance/parser-conformance-within-node-allowlist.json + the test that reads it) and the parity CI step;
3. the M6 flip harness (find it — pack names it);
4. the full-pipeline `--parser=scrml-native` CLI flag and the tests that exist ONLY to drive the full pipeline through it (pack: 29 files). ⚠ SORT ONE BY ONE: a test that covers a function impl#1 calls in production (component re-parse, `^{}` meta, `<match>` arm markup, class/dynamic-import rejection, defer/yield lint, body-top prose) STAYS — re-point it to exercise that function directly or through the default pipeline, don't delete coverage of a live path. Record each of the 29 + the 14 root-level native/parser test files in progress.md as KEEP / RE-POINT / DELETE with the reason.
5. KEEP `lex.js` and whatever the bootstrap's lexer-oracle gate compares against (check ci.yml "lexer oracle").
6. SPEC: rewrite §22.12's M6 / "Retirement is total" paragraph to the frozen-impl#1 status (provenance S449 item 6, supersedes the M6 claim — note S249 had already ruled "don't do M5/M6"); fix the §34.1 intro (pack: it says 81 codes, lists 82; state that these codes are impl#1 parse diagnostics emitted via the native parser on the paths impl#1 routes through it — informative for other implementations). Move native-parser planning docs that are not current truth to scrml-support/archive/ ONLY if the pack lists them and you confirm nothing links them (otherwise list them for the PA).
7. Known gaps whose locus is the native parser (pack: 24 open): re-label as impl#1-frozen where appropriate (one bulk note in your §S449 section is fine — don't rewrite 24 entries); close any that were ONLY about the mirrors/parity harness you deleted, with the reason.

## Verification (mandatory — this is a deletion PR; the risk is silently deleting live coverage)
- Before/after: `bun test compiler/tests/{unit,integration,conformance}` pass/skip/fail counts AND the coverage claim: for each production-reached native function listed above, name the surviving test that exercises it.
- `bun run test` (full, incl. browser/lsp) once at the end if memory allows; else the CI-equivalent jobs from .github/workflows/ci.yml.
- CI wall-time saved (the parity step + deleted tests) measured locally.
- `bun scripts/facts.ts --write/--check`; SPEC-INDEX regen.
- Do NOT open a PR; push `git push origin HEAD:refs/heads/wip/s449-native-parser-prune` after each batch.
Final report: worktree, FINAL_SHA, lines deleted by category, the KEEP/RE-POINT/DELETE table summary (counts + any judgement calls), surviving-coverage list, test counts before/after, CI time saved, gaps touched, path-discipline incidents.
