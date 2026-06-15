COMPLETE THE RENDER-EXPRESSION PRIMITIVE `<render of=X/>` — RECOVERY DISPATCH (the prior agent crashed on an environmental socket error after Layers 1+2). You are scrml-js-codegen-engineer in an isolated worktree. change-id: `render-expr-primitive-2026-06-15`. Authority + full design context: `docs/changes/render-expr-primitive-2026-06-15/BRIEF.md` (the original brief — READ IT for the design, the surface `<render of=X/>`, the codegen reuse plan, and the SPEC plan). This recovery brief tells you WHAT'S ALREADY DONE and WHAT REMAINS.

# MAPS — REQUIRED FIRST READ
Read `.claude/maps/primary.map.md` in full; routing "new feature / compiler-source". Maps watermark `4646ec13`; live main HEAD `d472a407` (S196 landed W2 + prereq-bugs P + a §51.0.S SPEC edit). The render-expr Layers 1+2 are on the branch you FF-merge (below). Verify map content on touched files against source.
Feedback in final report: "Maps consulted: [list]; load-bearing finding: <one sentence>" OR "not load-bearing".

# STARTUP VERIFICATION + FF-MERGE THE PRIOR PROGRESS (BEFORE any other tool call)
1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-`. Else STOP (S90). Save WORKTREE_ROOT.
2. `git -C "$WORKTREE_ROOT" rev-parse --show-toplevel` == WORKTREE_ROOT. 3. `git -C "$WORKTREE_ROOT" status --short` clean.
4. **FF-MERGE THE PRIOR (CRASHED) AGENT'S BRANCH — it carries Layers 1+2:** `git -C "$WORKTREE_ROOT" merge --no-edit worktree-agent-aae6f6598c479a2c6`. This branch is based on current main `d472a407` (has the Bug-1 prereq fix) + two render-expr commits (Layer 1 parser, Layer 2 typer). The merge should be a clean fast-forward. If it conflicts, STOP and report.
5. **VERIFY Layers 1+2 are present** after the merge:
   - Layer 1 (parser): `grep -n 'render' "$WORKTREE_ROOT"/compiler/src/html-elements.js "$WORKTREE_ROOT"/compiler/src/attribute-registry.js` — `render` must be REGISTRY-registered (mirroring `errors`).
   - Layer 2 (typer): `grep -n 'E-RENDER-NO-CLAUSE\|E-RENDER-NOT-ENUM\|E-RENDER-NO-OF' "$WORKTREE_ROOT"/compiler/src/type-system.ts` — the exhaustiveness fence must be present in `annotateNodes`.
   If either is missing, STOP and report.
6. `bun install`. 7. `bun run pretest`.
## Path discipline (EVERY edit) — S99/S126
- ALL edits via Bash (perl/python3/heredoc) on WORKTREE_ROOT-absolute paths INCLUDING the `.claude/worktrees/agent-<id>/` segment — NOT Edit/Write tools. Echo path before; verify via git diff/grep after.
- NEVER `cd` anywhere; `git -C "$WORKTREE_ROOT"`, `--cwd "$WORKTREE_ROOT"`, worktree-absolute paths only.

# COMMIT DISCIPLINE (S83) — commit per layer; crash-recovery is WHY
First commit message includes startup `pwd`: `WIP(render-expr-recovery): start at <pwd>`. Commit Layer 3 once codegen tests pass; Layer 4 once SPEC + the §34 rows land. Before DONE: `git -C "$WORKTREE_ROOT" status` clean. Final report: WORKTREE_PATH, FINAL_SHA, FILES_TOUCHED, per-layer status, the new §34 code names, deferred items.

# WHAT IS ALREADY DONE (verify, do NOT redo)
- **Layer 1 — PARSER (committed `57777f8d`):** `<render of=X/>` registered as a scrml structural element in `html-elements.js` REGISTRY + `attribute-registry.js` ELEMENT_ATTR_REGISTRY (mirroring `<errors>`), with completeness-test exclusions. NOT an HTML element.
- **Layer 2 — TYPER (committed, PA-salvaged; full pre-commit suite 24,315 pass / 0 fail against it):** the exhaustiveness fence in `type-system.ts annotateNodes` for `<render of=X/>`. Fires **E-RENDER-NO-OF** (missing `of=`), **E-RENDER-NO-CLAUSE** (a reachable variant of the held enum lacks a `renders` clause — REUSES the E-ERROR-005 §19.6.6 per-variant logic), **E-RENDER-NOT-ENUM** (`of=` target resolves to a non-enum). Conservative on `asIs`/unknown (no false fence fire). ALSO: match-arm payload bindings now resolve to their CONCRETE variant-field type (was `asIs`) so `<render of=binding/>` resolves the held value's static enum type via the scope chain. **These three codes are NOT YET in §34 — you add the rows in Layer 4.**

# WHAT REMAINS — Layers 3 + 4 + tests + R26

## Layer 3 — CODEGEN (the meat — not started)
Build per the original BRIEF.md "Layer 3" section verbatim. Summary:
- Emit the per-variant `renders` switch against `<value>.data`. REUSE `allVariantRenderExprs` (emit-html.ts:637-647) + `emitBoundaryMarkupExpr` (emit-error-boundary.ts:132 — `dataExpr` is ALREADY a parameter; boundary sites pass `"_eb_result.data"`). For `<render of=X/>`, pass `<X>.data` as `dataExpr`.
- Dispatch on `<X>.variant` → `el.innerHTML = (renderExpr)` (same switch shape as emit-event-wiring.ts:1086-1092).
- **CRITICAL — SIDESTEP the `__scrml_error` gate** (emit-event-wiring.ts:1084). New fire site calls the shared markup emitter DIRECTLY against the held value; never pretend held=thrown; do NOT widen value-match or `<errorBoundary>`.
- Mirror the `<errors of=expr/>` dispatch (emit-html.ts:901-990) + its reactive consumer. Re-fire when `X` (held cell or match-arm bound payload) changes. The bound payload is already threaded (the arm render fn receives `{variant,data}`); the Layer-2 binding-type change makes the typer see its enum type.

## Layer 4 — SPEC (per Rule 4 — read §19.2 / §19.6.6 / §4.15 / §24.4 / §34 IN FULL first)
- **§34** — add the THREE rows the typer already emits: `E-RENDER-NO-OF`, `E-RENDER-NO-CLAUSE`, `E-RENDER-NOT-ENUM` (Error; cross-ref the new §19.x + §19.6.6). Per Rule 4 the rows MUST land (the codes are already wired).
- **§19.2** — amend: `renders` fires via `<render of=>` from a HELD value, not only via `<errorBoundary>`. "a value's display contract, fireable wherever you hold the value."
- **NEW §19.x subsection** — define `<render of=X/>`: grammar, semantics (dispatch X to its enum's per-variant `renders` markup), the exhaustiveness fence (reuse §19.6.6 E-ERROR-005), codegen-reuse note, explicit boundaries (SIDESTEPS catch; `<errorBoundary>` unchanged §19.6.1; does NOT generalize `renders` to non-error enums — option d rejected). Cross-ref §18.0.1 + §13.5.
- **§4.15** structural-element registry + **§24.4** — register `<render>` (mirror the S162 `<each>` add).

## TESTS + R26 (S138 mandate — HIGH-impact codegen on the canonical route)
- Add typer tests for the fence (E-RENDER-NO-CLAUSE fires on a variant missing `renders`; E-RENDER-NOT-ENUM on a non-enum `of=`; clean pass when all variants have `renders`) — the salvaged typer may lack dedicated tests.
- Codegen tests: the per-variant switch dispatches on `X.variant` against `X.data`.
- `bun --cwd "$WORKTREE_ROOT" run test` (full suite) — zero new failures.
- **Empirical R26:** compile a real `.scrml` (the LoadError/Phase shape from the original BRIEF.md), confirm: (a) emitted JS has the per-variant renders switch on `err.variant`/`err.data` (NOT `_eb_result`); (b) `node --check` exit 0; (c) the fence FIRES (a variant missing `renders` → compile error); (d) `<errorBoundary>` codegen UNCHANGED (diff vs pre-change). DO NOT mark DONE without empirical R26.
- If a within-node canary moves, report it; PA decides the rebump.
- PA lands via S67 file-delta + S147 coherence. Leave the worktree intact.
