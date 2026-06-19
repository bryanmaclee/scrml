# TASK: fix `g-compound-field-render-by-tag-unexpanded` (MED) — `<field/>` for a compound member emits a literal tag instead of the bound input

**Change-id:** `g-compound-field-render-by-tag-unexpanded-2026-06-18` (the dir + repros already exist). progress.md + commits reference it.

## The bug (PA-verified on HEAD — REAL)
A Shape-2 decl-coupled field (`<field validators> = <input.../>`) declared as a CHILD of a Variant-C compound (`<form> <field req> = <input/> </>`) and referenced in markup via render-by-tag (`<field/>`) is NOT expanded to its bound input — the compiler emits a LITERAL `<field />` into the SSR HTML, SILENTLY (exit 0, NO diagnostic). The IDENTICAL field at TOP LEVEL expands correctly.

**Repros on disk** (`docs/changes/g-compound-field-render-by-tag-unexpanded-2026-06-18/repro/`):
- `compound-rbt.scrml`: `<signup><uname req length(>=2)> = <input/></>` + `<uname/>` → emits literal `<uname />` (+ a spurious `E-DG-002 @signup never consumed` warning, a downstream symptom).
- `toplevel-rbt.scrml`: same field at top level → expands to `<input type="text" id="u" required minlength=2 data-scrml-render-by-tag=...>`.
PA-verified: compile both → the divergence reproduces; the literal `<uname />` in compound's emitted HTML is the bug.

## Spec intent — Rule-4 CONFIRMED: the fix is EXPAND, not diagnose
SPEC §6.3 (line ~2290) explicitly blesses `<formRes><name/></>` — render-by-tag for a compound MEMBER `name` IS valid when the member has a render-spec. So the silent literal-tag emit is a genuine bug; the member `<field/>` SHALL expand to its bound input. **Read SPEC §6.4 (Render-By-Tag Semantics, ~line 2301) + §6.3 in full** before fixing — confirm the legal-position rules for a compound-member `<field/>` reference and any ambiguity handling.

## Root (diagnosed — verify against live source)
Render-by-tag resolution walks every `<tag/>` MarkupNode and resolves it against the cell registry. The resolver (the B6 / SYM PASS-5 path, see PRIMER §13.7 + `compiler/src/symbol-table.ts`) uses **file-scope `lookupStateCell`**, which finds top-level cells but does NOT descend into Variant-C compound MEMBERS (those live in the compound parent's `_scope`). So a `<uname/>` whose decl is a compound member isn't found → treated as an unknown element → emitted as a literal tag. **B12's `lookupQualifiedStateCell` DOES descend through compound scopes** (it's how `@signup.uname` resolves). The fix: make the render-by-tag resolution ALSO find a bare `<member/>` that resolves to an in-scope compound member, and route it to the same bound-input expansion the top-level case uses.

- **Locus candidates** (investigate; the depth-of-survey discount applies — find the real surface): `compiler/src/symbol-table.ts` (the PASS-5 render-by-tag resolution / `lookupStateCell` vs `lookupQualifiedStateCell`), `compiler/src/codegen/emit-html.ts` (where `<field/>` expands to the bound `<input ... data-scrml-render-by-tag>` — confirm the expansion reads the resolved cell's render-spec + binding), `compiler/src/codegen/emit-bindings.ts` / `binding-registry.ts` (the bind wiring). The top-level path WORKS — trace what it does for a top-level Shape-2 `<field/>` and make the compound-member case reach the same expansion.
- **Ambiguity:** if a bare `<member/>` could match members in MORE THAN ONE in-scope compound (same member name), that's ambiguous — handle per §6.4 (a diagnostic, NOT a silent pick or silent drop). In the single-compound common case it's unambiguous. State your ambiguity handling in the report.
- The spurious `E-DG-002 @signup never consumed` should CLEAR once `<uname/>` correctly consumes the compound member (verify it does).
- Per `feedback_dont_soft_classify_bugs`: a silently-dropped input element is a BUG.

---
# MAPS — REQUIRED FIRST READ: `.claude/maps/primary.map.md` in full + §Task-Shape Routing (compiler-source codegen/symbol-table). Maps lag HEAD — verify against live source. Report maps feedback.

# STARTUP VERIFICATION + PATH DISCIPLINE
Worktree under `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-<id>/`.
1. `pwd` MUST start with that prefix (else STOP — S90); save `WORKTREE_ROOT`. 2. `git rev-parse --show-toplevel` == it. 3. `git log -1` base descends from `c553dd84` (current main); if BEHIND `git merge main`. 4. `bun install`. 5. `bun run pretest`. 6. Reproduce FIRST: compile both repros, confirm compound emits literal `<uname />` + toplevel expands to `<input>`.
- ALL edits via Bash (perl/python3/heredoc) on worktree-absolute paths incl. `.claude/worktrees/agent-<id>/` — NOT Edit/Write; echo path before, `git diff` after. NEVER `cd` into main (use `git -C "$WORKTREE_ROOT"`, `bun --cwd "$WORKTREE_ROOT"`).
- Commit after each edit; first commit msg embeds `pwd`. `git status` clean before DONE. Update progress.md each step. Never `--no-verify`.
- DO NOT TOUCH: `docs/known-gaps.md` (PA flips the gap at landing); `compiler/src/codegen/emit-each.ts`, `compiler/src/tokenizer.ts`, `compiler/src/block-analysis*.ts`, `scripts/dock.ts` (other landed/in-flight work).

# PHASE 3 — MANDATORY R26 (no DONE without):
1. **The fix:** compile `compound-rbt.scrml` → the compound member `<uname/>` now EXPANDS to `<input ... data-scrml-render-by-tag=...>` (same shape as `toplevel-rbt.scrml`'s output), NOT a literal `<uname />`. The spurious `E-DG-002` is GONE. Paste before/after emitted HTML for both repros.
2. **Regression test:** add a test (find the render-by-tag / decl-coupled test file — grep `render-by-tag` / `data-scrml-render-by-tag` in `compiler/tests/`) asserting compound-member render-by-tag expands + the validity surface (`@signup.uname.errors` etc.) still wires. Keep the top-level case green.
3. **FULL suite green** (`bun --cwd "$WORKTREE_ROOT" run test`) — this touches the SHARED render-by-tag / scope-resolution path, so the full suite (browser incl.) is the regression gate. Record pass/skip/fail. (If a within-node fixture shifts, re-baseline per M6.5.b.)

End: DO NOT mark DONE without the before/after HTML (literal→`<input>`) + E-DG-002 cleared + full suite green.

# FINAL REPORT: WORKTREE_PATH / FINAL_SHA / BASE_SHA (+merged main?) / FILES_TOUCHED / root cause (one paragraph: the exact resolver gap + how you made the compound-member case reach the expansion) / ambiguity handling / R26 before-after HTML + E-DG-002 + suite counts / maps feedback / deferred items.

Commit after each change; WIP commits expected; progress.md each step.
