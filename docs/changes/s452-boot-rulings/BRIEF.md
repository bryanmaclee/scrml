# BRIEF — s452-boot-rulings (archived verbatim at dispatch)

start at /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-aa2d89b9342ffbdbb

---

CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (path-discipline incidents to date are non-zero; this block exists because of them).
1. `pwd` MUST start with /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent- . `git rev-parse --show-toplevel` MUST equal pwd. Clean tree. `git fetch origin main`, then `git merge-base HEAD origin/main` MUST equal `git rev-parse origin/main` (if not: `git merge --ff-only origin/main`; if that fails, STOP and report). Expected base: main at or after 488abeedc (#1270).
2. Every Read/Write/Edit uses an ABSOLUTE path under YOUR worktree root. NEVER write a path under /home/bryan-maclee/scrmlMaster/scrml/ that is not inside your worktree. NEVER `cd` into the main checkout. Translate any path quoted below to your worktree root before writing.
3. NEVER `git stash` (shared across every worktree). NEVER `pkill -f`/`killall`; kill only by captured PID.
4. `bun install` first; then `bun run pretest` from your worktree cwd (NOT `bun --cwd … run`, which silently no-ops). Scratch under "$WT/.tmp/" (delete before final report). TMPDIR, if set, → ~/.cache/scrml-agent-tmp/s452-boot-rulings, never inside a repo.
5. Commit after each meaningful unit (WIP commits fine; code + its test in ONE commit); keep docs/changes/s452-boot-rulings/progress.md append-only, timestamped. First commit: archive THIS ENTIRE PROMPT verbatim as docs/changes/s452-boot-rulings/BRIEF.md; its body says `start at $(pwd)`. Never --no-verify; never touch hooks/core.hooksPath. Pre-commit runs ~2 min: timeout 300000. The worktree guard rejects compound shell commands containing `git` — run git commands singly.
6. Push your branch as `feat/s452-boot-rulings` at the end (normal push). Do NOT open or merge a PR.

MAPS — REQUIRED FIRST READ: .claude/maps/primary.map.md (stamp d3e660a08, 2026-10-04). Post-map landings: #1269 (SPEC `| _ err :>` whole-error binder), #1270 (bootstrap diagnostics carry §34 severity from one generated table — compiler/self-host-v2/severity.scrml + scripts/gen-bootstrap-severity.ts; a new §34 row for a bootstrap code CHANGES that table and turns slice-m4/severity.test.js red until you regenerate; `hasError` in lower.scrml now fails closed), #1271 (S451 wrap docs). Follow the map's Task-Shape Routing; treat map content as a hypothesis. Report whether the map was load-bearing.

AUTHORING scrml: the bootstrap (compiler/self-host-v2/*.scrml) is written in scrml. Read scrml-support/docs/gauntlets/BRIEFING-ANTI-PATTERNS.md (at /home/bryan-maclee/scrmlMaster/scrml-support/ — read-only) before writing scrml, and mirror the surrounding bootstrap code's idiom exactly.

TASK — implement the S451 error-model rulings in the bootstrap compiler (compiler/self-host-v2/). The rulings are ALREADY in compiler/SPEC.md (normative, landed #1266–#1269). impl#1 (compiler/src/) is FROZEN — do not touch it.

Pattern to mirror: the Ue landing (#1265) — read docs/changes/s451-boot-ue/DESIGN.md (the Core additions: Attempt / Failable / ErrArm etc.) and its progress.md first. Before code, write docs/changes/s452-boot-rulings/DESIGN.md quoting the governing SPEC sentence for EACH item (section + quote — Rule-4 gate) and naming where in the bootstrap it is decided. Loci I name are PA-located hypotheses; report whether each held.

Items (each a newly-rejecting compile error unless noted; message text as SPEC gives it):
1. E-ERROR-012 — in a VALUE position (`let r = f() !{…}`, `@x = f() !{…}`, any position whose result is used; also `match` on a failable result in value position) every arm SHALL yield a value of the success type or leave (`return`/`fail`; `break`/`continue` count as leaving); fall-through is an error. Statement position is fine. SPEC §19 near "falls through" (grep `E-ERROR-012`). Today the bootstrap refuses this shape as an internal "Ue2"-style refusal — replace that refusal with the real diagnostic.
2. E-ERROR-013 — `!{}` on a call that cannot fail. Today refused generically; make it the named code.
3. E-ERROR-014 — a free-standing `!{}` in markup not attached to a call (grep SPEC).
4. E-ERROR-015 — manual transaction SQL (`?{BEGIN}`, `?{COMMIT}`, `?{ROLLBACK}`, `?{SAVEPOINT}`, …) where no enclosing function is declared `!` (§19.10.4, §34 row).
5. E-MATCH-BARE-BINDER — an arm whose whole pattern is a bare identifier (`err :>`, `| err :>` in `!{}`), `_ <name>` on a NON-failable `match`, and `else <name>` (§18.2).
6. The whole-error binder `| _ err :>` — binds the WHOLE error value in a `!{}` arm and in a `match` on a failable result (§18.6.1, #1269). Implement the binding end to end (Core + lowering + printed JS), with a runtime test that the bound value is the whole error (variant + payload).
7. `<db src>` resolution per §8.1.1 as amended S451: a `?{}` runs on its NEAREST enclosing database scope (`<program db=>` or `<db src=>`); a `<db src>` that is the single DIRECT CHILD of a `<program>` without `db=` supplies that program's database (ruling 11a); an unscoped `?{}` is E-SQL-004 regardless of database count. U1a refuses `<db src>` today — lift that refusal for the resolution half (which database a query belongs to + E-SQL-004). If printing a second database's connection needs U1c (the server artifact), keep the PRINT refused with a clear refusal and say so; the analysis must be complete either way.
OUT OF SCOPE: E-SQL-011 (cross-database envelope) — needs U1e (transactions); leave it, note it in progress.md. Any SPEC.md change — if the SPEC is silent or self-contradictory on something you need, STOP that item and report it (do not decide it).
Also owed in your lane: §34 rows for the bootstrap codes `E-PARSE-ARM` and `E-PARSE-SQL-CHAIN` are missing (gap `g-bootstrap-s34-rows-owed-s451`) — do NOT add SPEC rows; just list every bootstrap-emitted code with no §34 row in your report.

Tests: unit tests per code beside the existing slice-m4 tests (run self-host-v2 tests BY PATH — bunfig's test root is compiler/tests/; see .github/workflows/ci.yml for how slice-* run). Use conformance cases under conformance/cases/ where a case already pins the shape (grep the code names); the SPEC lists the 13 conformance files with E-ERROR-012 fall-through arms — do NOT migrate those cases in this dispatch, but report how the bootstrap counter grades them.
Verification (Phase 3 — DO NOT report done without it): (a) for each code, a minimal .scrml reproducer compiled through the bootstrap showing the code fires and NO artifact (Core) is produced; (b) a near-miss that must still compile (statement-position fall-through; `| _ :>`; `| _ err :>`; a `<db src>` direct-child program) compiles and runs; (c) `bun scripts/bootstrap-conformance.ts` before vs after — PASS must not drop below 119; report gains/losses by case, and regenerate docs/bootstrap-conformance.md (`--check` must pass); (d) `bun scripts/gen-bootstrap-severity.ts --check` current.

FINAL REPORT (concise, <700 words): worktree path, FINAL_SHA (== pushed tip), files touched, per item: done/refused/stopped + governing sentence ref + locus held/refined/wrong, test counts, counter before/after with case diff, bootstrap codes lacking §34 rows, deferred items, `git status` clean.
