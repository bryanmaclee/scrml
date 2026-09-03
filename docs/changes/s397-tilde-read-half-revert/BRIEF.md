# S397 — `~` arm-body arc: REVERT the read half, keep the ruled write half

## RULING THIS IMPLEMENTS (bryan, S397: "your rec" on Q1)

Ship the **write half** of the S395 `~` arm-body arc — which is bryan's ratified limb (a),
§17.6.2 governs an if-as-expression arm body — and **REVERT the read half**, which is unruled
and emits invalid JS. Mark SPEC §32.2.1's read clause Nominal/spec-ahead. The boundary question
the read half keeps colliding with is banked as **dpa-040** and is NOT yours to decide here.

## PROVENANCE OF THE PREMISE — read this, it corrects the hand-off

The S395 hand-off states the read half "**DELETES A DOM LIFT**". **PA-verified at the branch tip
`c2ad6f49` this session: it does NOT.** Both base and branch emit the loop's
`_scrml_lift(() => …createElement("li")…)` identically. That claim describes an earlier round; the
agent's own round-4 record reverted it. **Do not go looking for it.**

**What DOES reproduce at the tip, and is the whole reason for this revert:**
a `~` read inside an arm resolves to an accumulator minted inside a *nested block*, and the read is
emitted *outside* that block — a reference to a `let` binding from outside its scope.

## THE STARTING POINT — files, and the base-drift filter

Held branch: **`worktree-agent-ac264a1015c0da19d` @ `c2ad6f49`** (branch-base `8f3c5b74`).
It is BEHIND `origin/main`. Take **only** these paths from it:

```
compiler/src/codegen/emit-logic.ts
compiler/SPEC.md
compiler/SPEC-INDEX.md
compiler/tests/unit/bare-expr-in-if-arm-rebinds-tilde-context.test.js
conformance/cases/control-flow/ctrl-025-arm-body-statement-is-side-effect-pos/
conformance/cases/control-flow/ctrl-026-arm-body-nested-value-form-decl-pos/
conformance/cases/control-flow/ctrl-027-arm-body-tilde-read-and-recovery-pos/
```

⚑⚑ **DO NOT take `conformance/normalize.ts`.** PA-verified: `git diff 8f3c5b74..<held-branch> --
conformance/normalize.ts` is **EMPTY** — the branch never touched it. The +26 you will see against
`origin/main` is **pure base drift** and taking it **REVERTS #822 (`ae2741e7`)**, a landed
conformance fix. Same for `compiler/src/commands/dev.js` and the two dev/auth test files — all
base drift from #823. PA-verified: the four files above have **0** intervening commits on main
since the branch base, so a wholesale checkout of those is safe.

## WHAT TO KEEP (the write half — ruled, reviewed, do not touch)

In `emit-logic.ts`:
- the `tildeContext` shape gaining **`liftVar`** (the arm's RESULT, written only by `lift` / the
  §17.6.10 sugar) and **`armBody`**;
- the `!opts.tildeContext.armBody` guards on both bare-expr handlers;
- `const liftTarget = opts.tildeContext.liftVar ?? opts.tildeContext.var` in the `lift` handler;
- the nested-value-form-declaration guard (`if (opts.tildeContext && !opts.tildeContext.armBody)`
  before `opts.tildeContext.var = tildeVar`);
- the dead-allocation guard `if (!tildeCtx.var && !tildeCtx.liftVar)`;
- `armBody: true` at its **single** site, `emitIfExprDecl` (round 4 already pulled it out of
  `emitForExprDecl` and `emitMatchExprDecl` — leave that revert in place).

**Acceptance for the write half — this is the fix and it must survive:** for
`const label = if (@n > 0) { note(~) lift "pos" } else { lift "neg" }`, base emits
`const label = _scrml_tilde_4;` where `_scrml_tilde_4` is never assigned `"pos"`/`"neg"` (both arms
write a *different* var, block-scoped to the then-branch and leaking as an implicit global in the
else). The branch emits `const label = _scrml_tilde_5;` with `let _scrml_tilde_5 = null;` declared
before the `if` and both arms assigning it. **That is correct and must stay correct.**

## WHAT TO REVERT (the read half)

The widening in **`nodeContainsTildeRef`** — the block added on the branch:

```ts
for (const field of ["ifExpr", "forExpr", "matchExpr"]) {
  const sub = node[field];
  if (sub && typeof sub === "object" && nodeContainsTildeRef(sub)) return true;
}
```

⚑ **This locus is PA-LOCATED-VERIFY, not traced.** It is where the widening was *added*; confirm by
execution that removing it is what changes the two probes below, and **report whether the hypothesis
held, was refined, or was wrong.** If removing it alone does not close the block-scope escape, say
so and stop — do not widen the revert on your own authority.

Consequence, intended: a `~` read inside an arm stops resolving to an enclosing accumulator and
falls back to the pre-existing orphan behaviour. **That is the point** — the read half is unruled.

## SPEC + TESTS

1. **SPEC §32.2.1** — mark the **read** clause `Nominal / spec-ahead`, beside the `E-TILDE-001`
   clause already marked so. Carry a `provenance:` line citing this ruling (base Rule 4b). Keep the
   write-half SPEC reconciliation the arc landed (§17.6.2 vs §32.2 carve-out) — that is ruled.
2. **`ctrl-027-arm-body-tilde-read-and-recovery-pos`** is a READ-half case. It will not hold.
   Re-scope it to the write half, or convert it to a scope-boundary case pinning the orphan
   fallback. **Do not delete a conformance case to make a suite green** — §62.2 makes the corpus the
   versioned contract; state what you did and why in `progress.md`.
3. `ctrl-025` and `ctrl-026` are write-half and **must stay green**.
4. In the unit test file, any assertion pinning read-half behaviour gets re-scoped the same way.
   ⚑ **Do NOT reach for `test.failing`** — it passes when the body fails for ANY reason and will
   mask an unrelated break (S395, and the PA was the one who got this wrong).

## VERIFICATION GATES — every row EXECUTED, none inferred

Two reproducers are staged for you (copy them in; they are outside the repo):
- `/tmp/claude-1000/-home-bryan-maclee-scrmlMaster-scrml/5cf45dca-5232-419c-b9a0-b485ab23eff1/scratchpad/repro.scrml` — DOM lift + in-arm `~`
- `/tmp/claude-1000/-home-bryan-maclee-scrmlMaster-scrml/5cf45dca-5232-419c-b9a0-b485ab23eff1/scratchpad/repro-while.scrml` — the block-scope escape

| gate | required result |
|---|---|
| `repro-while` emit | **no reference to a `let _scrml_tilde_N` declared inside the `while` block from outside it.** This is the defect; prove it is gone by reading the emit, not by exit code |
| `repro` emit | the loop's `_scrml_lift(() => …createElement("li")…)` present and intact |
| `repro` / `repro-while` | `const label = <the liftVar>`, and that var declared before the `if` — the write half still fixed |
| dead allocation | the body-level `let _scrml_tilde_N = [];` that base does not emit should be **gone** with the widening; if it survives, report it |
| `ctrl-025` / `ctrl-026` | green |
| corpus differential | vs `origin/main`, full corpus, artifacts + per-file diagnostic sets. Expect changes ONLY in files this arc adds. **Re-run from scratch; do not reuse a prior number.** ⚑ A deleted `.git` invalidated this exact probe at S395 (PROJECT_ROOT_MARKER → every chunk hashed an absolute path → 1021 phantom diffs) — sanity-check the run before quoting it |
| R26 | recompile `scrml-support/docs/gauntlets/gauntlet-r25/dev-*.scrml`; zero artifact diffs vs base |
| suite | `bun run test`; `comm -13` against the base baseline empty |

**Report a MOVEMENT TABLE** (shape · base · after · direction), as round 4 did. **Nothing may move
loud → silent.** A row moving silent → loud is acceptable only if you name it.

## WORKSPACE RULES

- Startup gate: `pwd` starts with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`;
  `git rev-parse --show-toplevel` equals it; clean tree. If not — **STOP and report.**
- `bun install` (worktrees do not inherit `node_modules`). Then run `pretest` **plainly from the
  worktree CWD** — ⚑ `bun --cwd <path> run <script>` **silently no-ops and exits 0**; use `--cwd=`
  with the `=` or just `cd`-free plain invocation from the worktree root.
- Assert your base: `git merge-base HEAD origin/main` should equal `origin/main`.
- Get this brief: `git fetch origin fix/s397-tilde-read-half-revert && git checkout FETCH_HEAD -- docs/changes/s397-tilde-read-half-revert/`
- ⚑⚑ **NEVER `git stash`** — `refs/stash` is SHARED across every worktree including the PA's main
  checkout. Do base-vs-build flips by **file copy**. (S385: a real cross-worktree stash collision.)
- ⚑ **Never a bare `pkill -f` / `killall`** on a command string every checkout shares — it kills the
  PA's suite in main with no trace. Kill by PID captured at launch, or filter on cwd.
- Writes: Edit/Write on **worktree-absolute paths only**. Never `cd` into the main checkout; use
  `git -C "$WORKTREE_ROOT"`.
- Commit after each meaningful unit (WIP commits expected) + append-only timestamped
  `docs/changes/s397-tilde-read-half-revert/progress.md`. The branch + progress.md are the crash anchor.
- Do **NOT** use `--no-verify`, and do not alter `core.hooksPath`.

## MAPS — REQUIRED FIRST READ

Read `.claude/maps/primary.map.md` FIRST (stamp `8e278c73`, 2026-09-03) and follow its Task-Shape
Routing to the codegen maps. HEAD is `a18c13c7`; the only landings past the stamp are #825/#826
(the mapper's own tail) and #827 (docs-only), so map content is current for compiler source.
Treat map claims as **verify-against-source hypotheses**. Report whether the maps were load-bearing —
"not load-bearing" is a valid and useful answer.
