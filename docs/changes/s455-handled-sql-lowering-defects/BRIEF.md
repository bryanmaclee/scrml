# BRIEF — s455-handled-sql-lowering-defects (archived verbatim at dispatch)

start at /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-ac6bfbe36dc5538d8

---

CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (path-discipline incidents to date are non-zero).
1. `pwd` MUST start with /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent- ; `git rev-parse --show-toplevel` == pwd; clean tree. `git fetch origin main`; `git merge-base HEAD origin/main` MUST equal `git rev-parse origin/main` (else `git merge --ff-only origin/main`; if that fails STOP). Expected base ≥ 61f4b8e5b (#1319).
2. Every Read/Write/Edit uses an ABSOLUTE path under YOUR worktree root; never write under /home/bryan-maclee/scrmlMaster/scrml/ outside it; never `cd` into the main checkout or another worktree.
3. NEVER `git stash`; NEVER `pkill -f` / `killall`; never `git -c core.hooksPath=…`.
4. `bun install`, then `bun run pretest` from your worktree cwd (NOT `bun --cwd … run`). Scratch under "$WT/.tmp/" (delete at end). TMPDIR, if set, → ~/.cache/scrml-agent-tmp/s455-sql-lowering.
5. First commit: archive THIS ENTIRE PROMPT verbatim as docs/changes/s455-handled-sql-lowering-defects/BRIEF.md (body `start at $(pwd)`); progress.md append-only, commit after each meaningful unit. Code + tests in ONE commit. Never --no-verify. Pre-commit timeout 300000. Types gate BLOCKING. Before pushing: s34-census --check-new, regen-spec-index --check, facts --check. Never put a status-bearing command behind a pipe.
6. Push as `fix/s455-handled-sql-lowering-defects` (normal push). If DENIED, report and stop. Do NOT open/merge a PR.

MAPS — REQUIRED FIRST READ: .claude/maps/primary.map.md (stamp f38697900; its #1305 block names compiler/src/codegen/sql-attempt.ts — the handled-`?{}` lowering). Post-map landings since: #1315 (R11 `scrml fix sql-failable`, rewrote 150 corpus read sites to `!{ _ :> not / [] }`), #1312/#1313/#1316/#1317/#1319 (foreign seal, tenant floor). Report whether the maps were load-bearing.

CONCURRENCY: a sibling may touch compiler/src/commands/build.js (a build-report line). Do NOT touch it. Do NOT edit docs/known-gaps.md — give entry text in your report.

TASK — impl#1 under the S435 freeze EXCEPTION bryan granted for #1305 (S454, verbatim "grant the exception." — user-voice-scrml.md §S454); these defects were introduced by / are in #1305's handled-`?{}` lowering, so fixing them is inside that exception. Gap: `g-impl1-handled-sql-lowering-defects-s455` in docs/known-gaps.md (HIGH) — READ IT IN FULL; reproducers: docs/changes/s455-scrml-fix-r11-sql-failable/phase0-probe.ts + progress.md. Governing: SPEC §19.8.3 / §19.8.4 (a handled `?{}` is a failable expression; the arm value replaces the result on failure; a success value flows exactly as unhandled) — read and QUOTE in progress.md.
REPRODUCE FIRST on your base (real bun:sqlite; success-row, success-no-row, forced failure), record SHA + outcome, then FIX THE ROOT for each:
 (1) HIGH silent-wrong: `lift ?{…}.all() !{…}` in a function body drops the success value (no lift/return emitted; the query is not attempt-wrapped so a failure still throws).
 (2) HIGH silent-wrong: `@c = ?{…}.get() !{…}` inside a function lowers to a server-side `_scrml_reactive_set` that never reaches the client cell (compare with the UNHANDLED `@c = ?{…}.get()` — the handled form must behave identically on success).
 (5) fail-open: a handled `?{}` inside `fn` drops E-FN-001 (fn body prohibits SQL) — a handled query must be refused in `fn` exactly like an unhandled one.
 (6) fail-open: E-CPS-MULTIBATCH-REORDER and E-REACTIVE-003 disappear when the query is handled (rails-crud-admin shape — see progress.md).
 (7) handled queries lose I-PROTECT-STRIP-001; one case gains E-PROTECT-006 — protect analysis must see a handled query exactly as an unhandled one.
 (3) `for (r of ?{}.all() !{…})` → E-PARSE-001; (8) W-TYPE-031-UNPROVEN extra; (9) E-RI-002 in body-split; (10) batching lost — fix if they share the root; otherwise list with a traced locus.
ROOT HYPOTHESIS (PA, verify): a guarded/handled `?{}` is a different AST node kind than a bare `?{}` (guarded-expr wrapping sql), and every analysis/lowering that pattern-matches on the bare sql node kind (fn-purity, protect, route/RI, CPS batching, lift/return emission, reactive-set placement) misses it. If so, the fix is ONE normalization (each analysis sees through the guard to the query), not per-site patches — state which analyses you changed and why that set is complete (enumerate every consumer of the sql node kind).
EVIDENCE: each repro executed base vs head; whole-corpus impl#1 emit differential (write:true) with every changed artifact explained (expected: files containing handled `?{}` — the R11 rewrite put many in the corpus, so CHECK that their success-path output is unchanged by execution on a sample of ≥8); conformance green; add conformance cases pinning (1)(2)(5).
FINAL REPORT (<500 words): FINAL_SHA; repro table base/head; root (held/refined/wrong) + the consumer enumeration; differential; tests; known-gaps text; maps load-bearing?; `git status` clean.
