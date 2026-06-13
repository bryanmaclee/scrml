# g-legacy-derived-projection-plain-cell — test-truth + clearer E-ENGINE-004 (RULED S190)

change-id: `legacy-derived-projection-plain-cell-2026-06-13`
Dispatched S190 (2026-06-13). Agent: `scrml-js-codegen-engineer`, isolation:worktree, model opus.
Closes `g-legacy-derived-projection-plain-cell` (LOW). User ruling S190 (decision pass): "Test-truth + clearer error."

Small, focused fix — a diagnostic-message improvement + a test-honesty fix. NO language behavior change, NO codegen change, NO SPEC change.

## MAPS — REQUIRED FIRST READ
Read `.claude/maps/primary.map.md` in full. This is a compiler-source diagnostic + test fix (error map + structure map). Maps watermark `a00624f5`; HEAD `f0030049` (the S190 derived-engine-expression-form landing touched type-system.ts — grep/Read current source, don't trust line numbers blindly).

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (S99/S126)
1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-`. Else STOP. Save WORKTREE_ROOT.
2. `git rev-parse --show-toplevel` == WORKTREE_ROOT. 3. `git status --short` clean. 4. `bun install`. 5. `bun run pretest`. Baseline via `bun run test`.
- **Apply ALL edits via Bash** (perl/python3/heredoc) on worktree-absolute paths incl. the `.claude/worktrees/agent-<id>/` segment — NOT Edit/Write. Echo path before each write; re-verify after.
- **NEVER `cd` into main.** `git -C "$WORKTREE_ROOT"`, run bun from WORKTREE_ROOT, worktree-absolute paths only.
- First commit message includes verbatim `pwd`. Keep file-writes and `git add`/`commit` as SEPARATE Bash calls (a prior dispatch died on a denied compound `printf >> && git add`).
- Commit per sub-unit; `git status` clean before DONE; update `docs/changes/legacy-derived-projection-plain-cell-2026-06-13/progress.md` (heredoc) each step.

## THE BUG (confirmed at HEAD)
The LEGACY §51.9 `derived=@machineVar` 1:1 projection requires a MACHINE-bound source (§51.9.3). Over a PLAIN enum cell (`@order: Phase` where `Phase` is a `:enum`), `<engine for=Health derived=@order>` fires **`E-ENGINE-004`** ("Derived machine references source variable '@order', but no machine-bound reactive with that name was found in scope") through the full `compile()` pipeline — `type-system.ts:5354-5355` (in `validateDerivedMachines`). **BUT** `compiler/tests/unit/c14-derived-engines.test.js` exercises this exact plain-cell shape (`@order: Phase` + `derived=@order`) and PASSES — because its `runUpToSYM` + `generateClientJs(makeTestCtx(...))` path drives codegen DIRECTLY, skipping `validateDerivedMachines`. So the test masks that the shape errors full-pipeline. (PRE-EXISTING; the S190 derived-engine-expression-form build changed NOTHING in the §51.9 legacy path.)

## RULING (S190): test-truth + clearer error. KEEP the §51.9.3 machine-source requirement (NO language widening).

**Fix 1 — clearer E-ENGINE-004 message (`type-system.ts:5354-5355`).** When a `derived=@var` legacy-projection source `@var` is NOT machine-bound (a plain enum/struct cell), the current message only says "name a reactive variable whose type is a machine." EXTEND it to ALSO steer to the modern §51.0.J **`derived=match @var { .SourceVariant => .TargetVariant, ... }`** form, which DOES work over a plain enum cell (landed S190 `f0030049`, PA-verified: `derived=match @order {...}` over `@order: Phase` compiles + subscribes). Keep the existing machine-bound guidance too. Do NOT change WHICH cases fire — only the message text. (The plain-cell case still correctly errors; we make the diagnostic helpful.)

**Fix 2 — c14 test honesty (`c14-derived-engines.test.js`).** The plain-cell tests (the `@order: Phase` + `derived=@order` substrate tests, ~lines 349/391/444/707) pass only via the codegen-direct shortcut. Make them reflect full-pipeline reality WITHOUT losing the legacy-derived-substrate codegen coverage. **Survey + pick the cleanest** of:
  (a) change the test source to a MACHINE-bound cell (the legacy form's actual requirement — e.g. the auto-cell of a sibling `<engine>`/`<machine>`) so the legacy `derived=@machineVar` substrate is exercised full-pipeline-VALID; OR
  (b) keep the codegen-direct unit tests for the substrate BUT add a full-pipeline test (driving real `compile()`) asserting the plain-cell `derived=@var` shape fires `E-ENGINE-004` — documenting the §51.9.3 boundary as intended behavior.
  Do NOT just delete the coverage. Prefer (a) if a machine-bound source is clean in the harness; else (b). Explain your choice.

## NO SPEC CHANGE
The §51.9.3 machine-source rule + the §34 E-ENGINE-004 row already exist; this is impl-message + test only. **Do NOT edit `compiler/SPEC.md` or `compiler/SPEC-INDEX.md`** — the PA has an uncommitted SPEC edit in flight on a DIFFERENT section (§52); a SPEC edit here would collide at file-delta. If you believe the §34 row or §51.9 prose needs a tweak, FLAG it in your report for the PA to land separately.

## R26 (verify before DONE)
- plain-cell `<engine for=Health derived=@order>` with `@order: SomeEnum` (plain) → `E-ENGINE-004` WITH the improved message (mentions `derived=match`). 
- machine-bound legacy form (`examples/14-mario-state-machine.scrml`, `derived=@marioState`) → STILL compiles clean (no regression).
- modern `derived=match @order {...}` over a plain enum cell → STILL compiles clean.
- `node --check` on emitted JS; full suite `bun run test` 0 fail (the c14 tests must be green under your fix). Report counts.

## REPORT
WORKTREE_PATH, FINAL_SHA, BRANCH, FILES_TOUCHED; the message change + the c14 approach chosen (a/b) + why; R26 table; full-suite counts; any §34/§51.9 SPEC tweak FLAGGED (not edited); maps-consulted; `git status` clean + first-commit pwd echo.
