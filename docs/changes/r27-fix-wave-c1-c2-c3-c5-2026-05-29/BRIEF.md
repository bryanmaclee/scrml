# R27 fix-wave — C1 + C2 + C3 + C5 (BRIEF, archived per pa.md S136)

Dispatched S141 (2026-05-29) to `scrml-js-codegen-engineer`, `isolation: "worktree"`, model opus, background. Agent id `ad9c089eec0b7e248`. Baseline HEAD `feab1207` (v0.6.7). change-id `r27-fix-wave-c1-c2-c3-c5-2026-05-29`.

Bugs surfaced by gauntlet R27 (5-persona Expense-Approval), overseer-confirmed + PA minimal-repro confirmed. C1/C2/C5 emit INVALID JS at compile-exit-0 (S140 silent-miscompile class); C3 is a missing type alias.

## Disciplines mandated (full text in dispatch)
- MAPS-required-first-read block (primary.map.md + task-shape routing; currency HEAD feab1207).
- F4 startup verification (pwd prefix `/home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-`; git toplevel; `git merge origin/main` no-op safety; clean status; `bun install`; `bun run pretest`; first-commit embeds verbatim pwd).
- S126 path discipline: Bash-edits on worktree-absolute paths (NOT Edit/Write tools); never `cd` into main; `git -C "$WORKTREE_ROOT"`.
- S83 commit discipline: per-bug incremental commits in order C3→C1→C2→C5; clean `git status` before DONE; progress.md per bug.
- NO `--no-verify` (STOP+report on pretest race).
- S138 R26 Phase-3 empirical verification MANDATORY (HIGH codegen fixes).

## The 4 bugs
- **C3 (MED, do first):** bare `int` struct field → `asIs` → `E-SCHEMAFOR-NO-SQL-MAPPING`. Root: `BUILTIN_TYPES` type-system.ts:~623 missing `int`→`integer` alias (mirror existing `bool`→`boolean`). Repro `/tmp/pa-r27-int.scrml` + control `/tmp/pa-r27-int-control.scrml`.
- **C1 (HIGH):** two-bound `length(>=N,<=M)` in formFor/struct-field validator → `_scrml_validator_fire("length", value, { op: ">=", value: 2 , <= 120 })` malformed obj literal. Fix: lower to two AND-composed `_scrml_validator_fire` calls (or `{op:"between",min,max}` if runtime-validators.js supports it). Repro `/tmp/pa-r27-len2.scrml` (formFor locus; standalone Shape-2 cell does NOT repro).
- **C2 (HIGH):** `->`-arm value-return `match` → `/* match expression could not be compiled */ …;)` invalid JS; `=>` works; PRIMER §6.2 documents `->`. Fix: PA-decision — (a) lower `->` like `=>` (preferred if `->` canonical per SPEC §18.0.1/§6.2) OR (b) hard diagnostic on `->` + flag PRIMER doc-fix. NOT silent-stub. Quote SPEC. Repro `/tmp/pa-r27-match.scrml`.
- **C5 (HIGH):** `;` inside a string literal in an `!{}` arm body → splitter breaks the string → `_scrml_reactive_set("msg", "write failed);` + orphan `rolled back";`. Fix: make the arm-body statement-splitter string-literal-aware (skip `;` inside `"..."`/`'...'`/template literals). Repro `/tmp/pa-r27-semi.scrml`.

## Phase 3 (R26): re-compile all 5 gauntlet-r27 dev sources + the 4 minimal repros on post-fix baseline; confirm C1/C2/C5 invalid-JS patterns gone + node-check clean. (dev-3 has an unrelated environmental E-PA-002.) DO NOT mark DONE without Phase-3 passing.

## Final report: WORKTREE_PATH, FINAL_SHA, FILES_TOUCHED, per-bug fix+locus+test+repro-result, C2 glyph decision + SPEC quote, Phase-3 R26 table, full-suite delta, maps-feedback.
