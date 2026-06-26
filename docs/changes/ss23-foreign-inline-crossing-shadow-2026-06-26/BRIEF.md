# Dispatch BRIEF — ss23 item 3: g-foreign-inline-crossing-shadow (LOW)

**Agent:** scrml-js-codegen-engineer · **isolation:** worktree · **model:** opus · **change-id:** ss23-foreign-inline-crossing-shadow-2026-06-26
**Land target (sPA-side):** `spa/ss23`. **Stated base:** origin/main `cf9f1109`.

ONE gap (LOW): an inline `_{}` foreign block with an `in:{x}` crossing name that SHADOWS a slice-local `const x` emits `(async (x) => { const x = ... })(...)` → invalid JS, currently caught as a MISLEADING "compiler defect" `E-CODEGEN-INVALID-JS` — but it's AUTHOR error. Independent rider (the `_{}` emitter, `emit-logic.ts`), not library-mode SQL.

---

# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE
## Startup (BEFORE any other tool call)
1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. Else STOP. Save WORKTREE_ROOT.
2. `git rev-parse --show-toplevel` == WORKTREE_ROOT.
3. **BASE-CURRENCY (S112):** `git -C "$WORKTREE_ROOT" fetch origin --quiet && git -C "$WORKTREE_ROOT" merge origin/main` (FF). Then `git -C "$WORKTREE_ROOT" merge-base --is-ancestor df6f747b HEAD` MUST succeed. Non-clean FF → STOP.
4. `git status --short` clean. 5. `bun install`. 6. `bun run pretest`. Baseline = `bun run test`.
If ANY check fails: STOP, report, exit.

## Path discipline (EVERY edit)
- **S126:** Bash edits on worktree-absolute paths; NOT Edit/Write. Echo path; re-verify. **NEVER `cd` into main.** **Commit-message file:** UNIQUE (`msg-<agentid>-foreign.txt`).
- This item is INDEPENDENT of the sibling library-mode items (it's the `_{}` foreign-inline emitter in emit-logic.ts, not the library-mode SQL/`!{}` path) — but if you touch emit-logic.ts, note WHICH region (a sibling item 3 vs the `_{}` region) for clean reconcile.

## Commit discipline
- ONE commit (fix + coupled test). Clean tree. NEVER `--no-verify`.

---

## The gap (reproduce RED first)
A slice with `const x = …` then an inline `_{ in:{x} … }` foreign block whose crossing name `x` collides with the local `const x`. Emits `(async (x) => { const x = ... })(...)` — a redeclaration → invalid JS → currently surfaces as `E-CODEGEN-INVALID-JS` framed as a COMPILER DEFECT (misleading; the user wrote a shadowing crossing name). Construct the repro; confirm the misleading E-CODEGEN-INVALID-JS.

## Fix direction
Add a PRE-EMIT syntactic scan in the `_{}` foreign-inline emitter (emit-logic.ts): detect when an `in:{...}` crossing name collides with a slice-local binding in scope, and emit a CLEAR diagnostic — `W-FOREIGN-CROSSING-SHADOW` (warning) or `E-FOREIGN-006` (error) — that NAMES the shadow (author error), instead of letting it fall through to the misleading post-emit `E-CODEGEN-INVALID-JS`. Pick warning-vs-error to match the severity convention of the sibling `E-FOREIGN-*` family (grep the existing E-FOREIGN codes; if crossing-shadow always produces invalid JS, an ERROR that stops emission is appropriate; if it's recoverable, a warning). State your choice + why in the commit body.

## Test (RED first)
- The shadow repro now emits the clear `W-FOREIGN-CROSSING-SHADOW`/`E-FOREIGN-006` (naming the shadowed name), NOT the misleading `E-CODEGEN-INVALID-JS`. Regression: a NON-shadowing `_{ in:{y} }` (crossing name distinct from locals) compiles clean; existing `_{}` foreign-inline tests stay green.
- Paste RED (misleading E-CODEGEN) + GREEN (clear diagnostic).

## Verification
- `bun run test` GREEN, 0 regressions vs baseline (report counts).
- R26: recompile the repro; clear diagnostic, root cause named.

## Scope boundaries
- ONLY the pre-emit crossing-shadow scan + clear diagnostic. Do NOT redesign the `_{}` emitter or the foreign-inline semantics.
- If detecting the shadow soundly needs full scope analysis (not a syntactic scan of in-scope slice-locals), STOP + report.

## Report back
FINAL MESSAGE = structured return: commit SHA, RED→GREEN, the diff, the warning-vs-error decision + why, clean-tree confirmation, agent branch + tip SHA, base SHA.
