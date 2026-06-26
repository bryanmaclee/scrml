# Dispatch BRIEF — ss23 item 1: g-safecall-bang-handler-not-lowered-in-library-mode (MED)

**Agent:** scrml-js-codegen-engineer · **isolation:** worktree · **model:** opus · **change-id:** ss23-safecall-bang-library-mode-2026-06-26
**Land target (sPA-side):** `spa/ss23`. **Stated base:** origin/main `cf9f1109` (contains S145 library-mode shaping + df6f747b).

ONE gap: `safeCall(...) !{ | ::Thrown(...) :> … }` (§19 host-containment — the public try/catch replacement) lowers in PROGRAM mode but emits VERBATIM scrml `!{}` under `--mode library` → `E-CODEGEN-INVALID-JS`. PA reverse-R26 CONFIRMED on `df6f747b` (byte 238). Repro `/tmp/giti-triage/repro-26-f3-safecall-library.scrml`. Reporter: giti.

---

# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE
## Startup (BEFORE any other tool call)
1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. Else STOP (CWD-routing). Save WORKTREE_ROOT.
2. `git rev-parse --show-toplevel` == WORKTREE_ROOT.
3. **BASE-CURRENCY (S112):** `git -C "$WORKTREE_ROOT" fetch origin --quiet && git -C "$WORKTREE_ROOT" merge origin/main` (FF). Then `git -C "$WORKTREE_ROOT" merge-base --is-ancestor df6f747b HEAD` MUST succeed. Non-clean FF → STOP.
4. `git status --short` clean. 5. `bun install`. 6. `bun run pretest`. Baseline = `bun run test` (NOT bare `bun test`).
If ANY check fails: STOP, report, exit.

## Path discipline (EVERY edit)
- **S126:** Bash edits (`perl`/`python3`/heredoc) on worktree-absolute paths with `.claude/worktrees/agent-<id>/` — NOT Edit/Write. Echo path; re-verify `git diff`/`grep`.
- **NEVER `cd` into main.** `git -C "$WORKTREE_ROOT"` only. **Commit-message file:** UNIQUE (`msg-<agentid>-safecall.txt`), not bare `commitmsg.txt` (S220).
- **codegen/index.ts region note:** a sibling ss23 item (library-mode SQL W5a) may edit codegen/index.ts at the LIBRARY-AUTO-DETECT region (~L130/~L852). If your fix touches codegen/index.ts, keep it in the `!{}`/host-containment-lowering wiring region so the two reconcile cleanly.

## Commit discipline
- ONE commit (fix + coupled test). Clean tree. NEVER `--no-verify` (full hook ~108–180s; allow 300s).

---

## The gap (reproduce RED first)
Repro `/tmp/giti-triage/repro-26-f3-safecall-library.scrml`: a `safeCall(...) !{ | ::Thrown(...) :> … }` in a `--mode library` `.scrml`. Compile with `--mode library`; observe the emitted JS contains VERBATIM scrml `!{}` (byte 238) → `E-CODEGEN-INVALID-JS`. The SAME source compiles correctly in PROGRAM mode.

**Locate the lowering:** the `!{}` / §19 host-containment call-site-handler lowering (likely `emit-error-boundary.ts` + its caller). Find WHY it runs in program mode but not library mode — the library-mode emit path (codegen/index.ts ~L852 `if (mode === "library")`) likely routes through a different assembly that skips the `!{}` lowering pass, OR the lowering is gated on a program-mode-only precondition.

## Fix direction
Wire the EXISTING `!{}` call-site-handler lowering into the library-mode codegen path (it's program-mode-only today — this is "wire an existing lowering into a second path," not a new lowering). Reuse the program-mode lowering verbatim; ensure library-mode emission runs it. Do NOT re-implement the lowering or change program-mode behavior.

## Test (RED first)
- The repro compiles under `--mode library` to VALID JS (no `E-CODEGEN-INVALID-JS`, no verbatim `!{}`); the lowered host-containment behaves identically to program mode (the `::Thrown(...)` arm handles the failure). Adversarial (S215): multiple `!{}` in one library file; a `!{}` with multiple arms; nested. Regression: program-mode `!{}` unchanged; a library file with NO `!{}` unchanged.
- Paste RED (verbatim `!{}` / E-CODEGEN) + GREEN (valid lowered JS) + `node --check`.

## Verification
- `bun run test` GREEN, 0 regressions vs baseline (report counts).
- R26: recompile the repro under `--mode library`; valid lowered JS.

## Scope boundaries
- ONLY wiring the `!{}` lowering into library mode. Do NOT change program-mode, the lowering itself, or unrelated library-mode emission.
- If library-mode needs a structural change beyond running the existing pass, STOP + report.

## Report back
FINAL MESSAGE = structured return to sPA: commit SHA, RED→GREEN, the diff (+ which file/region — flag if codegen/index.ts), node --check proof, clean-tree confirmation, agent branch + tip SHA, base SHA.
