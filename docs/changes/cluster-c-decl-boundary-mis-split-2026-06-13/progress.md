# cluster-c-decl-boundary-mis-split progress

## 2026-06-13 — startup
- pwd: /home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-a3dc49d147e9cdfa5
- git toplevel == pwd; status clean; HEAD ea7eea43 (verified).
- bun install OK; bun run pretest OK (13 samples compiled).
- Read .claude/maps/primary.map.md in full. Task shape = compiler-source bug fix (LIVE block-splitter/ast-builder + diagnostic + new §34 code). Routing: error.map.md + structure.map.md LIVE-pipeline + domain.map.md.
- NEXT: survey ast-builder.js parseLogicBody/collectExpr + block-splitter.js to confirm fix loci for Bug 1 (${}-RHS split) and Bug 2 (markup-const raw-capture over-extent). Re-confirm both repros at HEAD.

## 2026-06-13 — Bug 1 (E-DECL-RHS-INTERP-WRAPPED) DONE
- Root: tryParseStructuralDecl (ast-builder.js ~:5064) collectExpr returns the literal `${...}` text as the RHS string for `const <x> = ${...}` / `<x> = ${...}` / typed; safeParseExprToNode parses it to bare `$` ident → misleading E-SCOPE-001 cascade.
- BS layer: outer logic body splits at the inner `${`, but parseLogicBody re-pairs the trailer into the `${...}` literal init.
- Fix: detect trimmed RHS starts with `${` and ends `}` at the post-collectExpr site; push E-DECL-RHS-INTERP-WRAPPED (new §34 code) naming cause + bare-form fix; recover by unwrapping inner expr (suppresses orphan-$ cascade). Message preserves typeAnnotation.
- SPEC: §34 row added after E-CELL-RENDER-SPEC-NOT-BINDABLE; §6.2 normative "RHS is a bare expression — no ${} wrapper" subsection + §34 cross-ref.
- Verified: t3/p5a/p5b fire the new code (no E-SCOPE-001); t4 (bare RHS control) stays CLEAN.
- Baseline pre-commit subset (clean HEAD): 16836 pass / 90 skip / 1 todo / 0 fail.
- NEXT: Bug 2 survey + fix (collectExpr markup-RHS over-consumption / angleDepth re-open after close-tag). Then tests for both. Then SPEC-INDEX note + R26.

## 2026-06-13 — Bug 2 (markup-const over-consumes sibling decl) DONE
- Root cause has TWO layers:
  1. collectExpr (ast-builder.js) markup-RHS over-consumption: after a markup element's close `>`, the `>` was read as a binary operator (RHS context) so the following sibling decl/fn was vacuumed into the markup const's raw. Fix: markupEverOpened/markupRootClosed tracking — once the top-level markup root fully closes (`</tag>` / `/>` / void `>`), break BEFORE the next sibling. Deferred-to-`>` for close-tag + self-close (the decrement is at `<`/`/`, the textual end is the `>`).
  2. defChildren vacuum (ast-builder.js ~:14107): a component-def vacuumed ALL following siblings (until next component-def/import/export/type) into defChildren and dropped them from body — silent loss for cells/deriveds, E-SCOPE-001 for fns. Fix: DEF_CHILD_STOP_KINDS adds state-decl/function-decl/const-decl/let-decl (file-scope decls are NOT component-scoped children; SQL/CSS/markup siblings still attach).
- ALSO fixed a latent pre-existing miscount EXPOSED by (1): the anonymous closer `</>` (`<` `/` `>`) was double-decremented — the close-tag `<`+`/` branch AND the self-close `/`+`>` branch both fired. Guard: self-close skips when lastTok is `<` (genuine self-close has `/` preceded by tag content). Harmless before (nothing acted on the miscount); the markupRootClosed boundary made it observable (closed multi-line component roots one level early).
- Verified parse + wiring: c5/p1/p2/p3/p4/p6(self-close br)/p7/c5c(nested-interp)/vbr(inner void br) all correct; controls c6/c4 clean. node --check OK on all emitted JS.
- Full pre-commit subset: 16836 pass / 0 fail (back to baseline; 22 transient failures from the multi-root/anon-closer interaction all resolved by the anon-closer guard).
- NEXT: regression tests (cluster-c-decl-boundary.test.js), R26 flagship + full suite, SPEC-INDEX note.

## 2026-06-13 — Regression tests DONE
- compiler/tests/unit/cluster-c-decl-boundary.test.js (19 tests, 0 fail).
  - Bug 1: derived/plain/typed wrapped-RHS fire E-DECL-RHS-INTERP-WRAPPED (no E-SCOPE-001 $); message names cause+fix; bare-expr control clean; markup-typed-derived ${@x} interp does NOT false-fire.
  - Bug 2: AST + emitted-JS for const-then-cell (Ada wired), multi-cell, const-then-derived, const-then-fn (no E-SCOPE-001), Shape-2 bindable (input EXPANDS, no literal <userName), two-consts, self-close <br/>, nested-interp, inner-void <br>; controls cell-first + bare-top-level + multi-line single-root component-def.
  - Uses cross-stream hasCode() helper (W-/I- partition) + compileScrml emitted-JS checks.
- NEXT: R26 flagship (examples/23-trucking-dispatch) + full suite; SPEC-INDEX §34 note.

## 2026-06-13 — R26 + SPEC-INDEX DONE
- R26: flagship examples/23-trucking-dispatch compiles exit-0 (only pre-existing W-SQL-ROW-UNTYPED/auth info; no E-DECL-RHS-INTERP-WRAPPED, no new errors); node --check OK on all td JS. 1003 trucking-dispatch-related tests pass. Full suite (bun run test): 24084 pass / 223 skip / 1 todo / 0 fail (baseline 24065 + 19 new).
- SPEC-INDEX: ran scripts/regen-spec-index.ts — sections-table line-ranges re-synced for the +13L §6.2 growth (table rows only; footer count + header changelog note are PA wrap-step, left untouched).
- All 4 commits clean: Bug1 (8866f7fd), Bug2 (c3a13134), tests (556a3e79), + this.
