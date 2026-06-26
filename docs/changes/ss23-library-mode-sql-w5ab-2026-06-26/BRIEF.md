# Dispatch BRIEF — ss23 item 2: g-library-mode-sql-no-db-context — W5a/W5b (MED, SURVEY-FIRST / STOP-IF-BIGGER)

**Agent:** scrml-js-codegen-engineer · **isolation:** worktree · **model:** opus · **change-id:** ss23-library-mode-sql-w5ab-2026-06-26
**Land target (sPA-side):** `spa/ss23`. **Stated base:** origin/main `cf9f1109` (contains S145 library-mode shaping + §21.5.1 modifier parsing + the SCOPE doc).

THE BIG ONE: a library `.scrml` (no `<program>`) can't run `?{}` SQL — SQL needs a db-resolution scope and a library has no `<program db>` ancestor. §44.7.1 ratifies the fix (the library declares its OWN `<db src>`). **This is the STOP-IF-MATERIALLY-BIGGER item (~13-24h est.) — SURVEY FIRST, then decide.**

---

# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE
## Startup (BEFORE any other tool call)
1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. Else STOP. Save WORKTREE_ROOT.
2. `git rev-parse --show-toplevel` == WORKTREE_ROOT.
3. **BASE-CURRENCY (S112):** `git -C "$WORKTREE_ROOT" fetch origin --quiet && git -C "$WORKTREE_ROOT" merge origin/main` (FF). Then `git -C "$WORKTREE_ROOT" merge-base --is-ancestor df6f747b HEAD` MUST succeed. Non-clean FF → STOP.
4. `git status --short` clean. 5. `bun install`. 6. `bun run pretest`. Baseline = `bun run test`.
If ANY check fails: STOP, report, exit.

## Path discipline (EVERY edit)
- **S126:** Bash edits on worktree-absolute paths; NOT Edit/Write. Echo path; re-verify. **NEVER `cd` into main.** **Commit-message file:** UNIQUE (`msg-<agentid>-libsql.txt`).
- **codegen/index.ts region note:** a sibling ss23 item (safecall `!{}` library-mode) may edit codegen/index.ts at the `!{}`/host-containment region. Keep YOUR W5a auto-detect edit in the LIBRARY-CLASSIFICATION region (~L130/~L852 `mode: "browser"|"library"`) so the two reconcile cleanly.

## Commit discipline
- ONE commit per landed sub-step (W5a likely standalone). Clean tree. NEVER `--no-verify` (full hook ~108–180s; allow 300s).

---

## PHASE 0 — SURVEY FIRST (do this BEFORE writing any W5b code; report the real scope)
**READ:** `docs/changes/library-mode-db-w5ab-2026-06-25/SCOPE.md` (W5a/W5b sub-steps — the authoritative breakdown) + SPEC §44.7.1 (module-with-db-context, ratified) + §21.5. Survey the existing `<program db>`/`?{}` resolution infra (route-inference.ts, emit-server.ts, db-driver.ts, module-resolver.ts, codegen/index.ts) — the fix EXTENDS this infra, so the real scope is likely LESS than the 13-24h headline.

Produce a SCOPE FINDING covering:
- **W5a (auto-detect-library, ~3-6h):** classify a no-`<program>`, exports-bearing file as `library` WITHOUT the `--mode library` flag. Where does mode get decided (codegen/index.ts ~L130/L852)? Is W5a a contained classification change? **If W5a is a clean standalone — LAND IT** (one commit) and report.
- **W5b (~10-18h):** cross-file `?{}`-resolve against the file's own `<db src>` + cross-file db-context travel + narrow `E-SQL-009` to the no-`<db>` case. Is this a contained extension of `<program db>` resolution, or a multi-file db-context-travel SUBSYSTEM?

## DECISION RULE (the STOP-if-bigger governor)
- If **W5a** is a clean standalone classification change → **LAND W5a** (commit), then assess W5b.
- If **W5b** is a contained extension reachable in this dispatch (the survey shows the infra mostly exists + the change is localized) → build + land it too.
- If **W5b** is a multi-step subsystem (cross-file db-context travel that needs new resolution machinery / a SPEC sub-ruling / touches 4+ files structurally) → **STOP, report the W5b scope finding (sub-step breakdown + est.), and PARK W5b** for the PA to dispatch as its own list. Do NOT build a subsystem in one shot.

Land what is cleanly landable (likely W5a, possibly W5b-part); park the rest with a precise scope finding. A partial, clean, tested landing + an accurate W5b scope is the WIN here — NOT a heroic half-built subsystem.

## Fix direction (per the SCOPE doc — follow it)
- W5a: extend the mode-classification (codegen/index.ts) to auto-detect library (no `<program>` + has exports). Reuse the existing `--mode library` shaping (S145) — auto-detect just SETS the mode the existing path already handles.
- W5b: thread `<db src>` resolution so a library file's `?{}` resolves against its OWN `<db src>` (the §44.7.1 module-with-db-context), reusing the `<program db>` resolution (route-inference.ts / db-driver.ts / module-resolver.ts); narrow `E-SQL-009` (currently fires for the no-`<db>` case) so it only fires when there's genuinely no `<db>` in scope.

## Test (RED first, per landed sub-step)
- W5a: a no-`<program>` exports file is classified `library` without the flag (compile WITHOUT `--mode library`, assert library shaping: no `.server.js` route-wrapper per S145, exports emitted). Regression: a `<program>` file still classifies as program/browser; an explicit `--mode library` still works.
- W5b (if landed): a library file with its own `<db src>` runs `?{}` against it (no E-SQL-009); the SQL resolves + emits valid JS. Regression: a library `?{}` with NO `<db>` still fires the (narrowed) E-SQL-009; program-mode `?{}` unchanged.
- Paste RED→GREEN per landed sub-step.

## Verification
- `bun run test` GREEN, 0 regressions vs baseline (report counts) for each landed sub-step.
- R26: recompile the relevant repro per sub-step.

## Report back
FINAL MESSAGE = structured return to sPA: the **SCOPE FINDING** (W5a + W5b real scope vs the 13-24h headline), what you LANDED (W5a and/or W5b-part, per-commit SHA + RED→GREEN) vs what you PARKED (W5b sub-step breakdown + est. + why), the diffs (flag codegen/index.ts region = library-classification), clean-tree confirmation, agent branch + tip SHA(s), base SHA. **flogence is the consumer** — note what's unblocked.
