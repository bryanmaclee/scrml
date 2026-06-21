# progress — g-tailwind-markup-block-scan-2026-06-21

Change: Tailwind JIT class collector skips MARKUP block-form (`<match>`/`<each>`) bodies.
Fix: add `match-block` + `each-block` branches to `visitNode` in
`compiler/src/codegen/collect-class-names.ts`, walking `bodyChildren` + (match) `armBodyChildren`.

- 2026-06-21T14:04:27Z START at /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a648b34b70d8dc273 (worktree). Startup verification clean: pwd under .claude/worktrees/agent-,
  toplevel==pwd, status clean, bun install + bun run pretest OK.
- 2026-06-21T14:04:27Z Read primary.map.md task-shape routing (compiler-source bug fix). Read target file +
  ast-builder.js match-block (~13541) / each-block (~14142) construction. Root cause CONFIRMED:
  match-block/each-block hit the generic fallback (lines 221-222) which only walks node.children/
  node.body; the walkable markup lives in bodyChildren (+ armBodyChildren for match), so it is
  never reached.
- 2026-06-21T14:04:27Z PRE-FIX R26 baseline (compiled 3 repros, grepped emitted CSS):
    Repro A: gap-2 PRESENT; rounded-full/rounded-lg/cursor-pointer/ml-6 MISSING
    Repro B: gap-2 PRESENT; rounded-xl/text-sky-500 MISSING
    Repro C: gap-2 PRESENT; tracking-wide/ml-6 MISSING (nested match-in-each)
  Matches the filed bug exactly.
- NEXT: add the two visitNode branches; re-run R26; assert all PRESENT; add regression test; full suite.

- 2026-06-21T14:09:50Z FIX applied: added match-block + each-block branches to visitNode
  (collect-class-names.ts), walking bodyChildren (+ armBodyChildren for match).
  Updated the top-of-file Recursion-scope doc comment. tsc --noEmit: clean.
  Committed a94f9678 (pre-commit gate: 17522 pass / 0 fail / 68 skip).
- 2026-06-21T14:09:50Z POST-FIX R26 (recompiled 3 repros + a 4th component-slot repro):
    Repro A: gap-2/rounded-full/rounded-lg/cursor-pointer/ml-6 ALL PRESENT (4 were MISSING)
    Repro B: gap-2/rounded-xl/text-sky-500 ALL PRESENT (2 were MISSING)
    Repro C (nested match-in-each): gap-2/tracking-wide/ml-6 ALL PRESENT
    Repro D (component slot in match arm): gap-2/px-2/tracking-widest/ml-8 ALL PRESENT
  CSS rule bodies verified well-formed (e.g. .rounded-full { border-radius: 9999px }).
- 2026-06-21T14:09:50Z Regression test authored: compiler/tests/integration/g-tailwind-markup-block-scan.test.js
  (6 tests / 30 expects — match arms, each body, nested, component slot, 2 regression guards).
  VALUE-asserting on emitted CSS text. Verified true regression guard: against pre-fix source
  4/6 FAIL (block-form cases), only the 2 static guards pass; against fixed source 6/6 pass.
- NEXT: full `bun run test` (NOT just pre-commit subset) + within-node parity check.

- 2026-06-21T14:18:07Z FULL SUITE (`bun run test` = bun test compiler/tests/): 24808 pass / 0 fail /
  210 skip / 1 todo across 25019 tests / 1045 files. Exit 0. [169s]
  within-node: NO OVER-BUDGET (grep clean). The canary's standing aggregate
  (1008 files w/ divergences, live-vs-native) is invariant to this change — codegen-
  output-only (CSS class collection), zero parser AST-shape effect, as predicted.
- DONE. Source fix a94f9678 + regression test c018a681. Status clean.
