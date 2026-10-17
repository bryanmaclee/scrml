# progress — s468-structural-eq-everywhere (append-only)

- 2026-10-17 start at /home/bmacs/scrmlMaster/scrml/.claude/worktrees/agent-a297eb1130075596e, base 5c43c3b8e (== origin/main).
- Reproducer (executed, base 5c43c3b8e): `~/.cache/scrml-agent-tmp/s468-structural-eq-everywhere/repro/app.scrml`,
  `bun compiler/src/cli.js compile app.scrml -o dist`. Expected: every `==` on Point operands lowers to
  `_scrml_structural_eq`. Actual: typed fn body, plain fn `if`, const derived, markup `${}`, `if=` are all structural;
  the inline handler `onclick=${@msg = (@a == @b) ? "yes" : "no"}` emits
  `_scrml_cs_reactive_get("a") === _scrml_cs_reactive_get("b")` (reference equality — always false for two cells).
- Locus trace: emit-event-wiring.ts Case C routes `assign`/`unary`/`lambda` handler bodies (and fn-shorthand Case A, the
  node-less arrow Case B) through the STRING rewriter (`rewriteBlockBody` -> `emitExprField(null, raw)` ->
  `rewriteExprWithDerived` -> clientPasses). The final client pass, Pass 18 `rewriteEqualityOps`
  (codegen/rewrite.ts), regex-rewrites every `==` -> `===` and `!=` -> `!==`. Every string-fallback caller (28 call
  sites: event wiring, each handlers, variant guards, match arms, engine rules, when-handlers, escape hatches) inherits it.
  Hypothesis "emit-expr.ts / emit-event-wiring.ts == lowering" REFINED: emit-expr's structured `emitBinary` is correct;
  the root is the string pipeline's Pass 18.
- Governing sentence, §45.1: "`==` is scrml's sole equality operator. It performs structural value comparison."
  §45.8: "`==` SHALL perform deep structural comparison for structs and enums." §45.4: "`a == b` (primitives) ->
  `a === b` in JavaScript / `a == b` (structs) -> deep structural comparison function call / `a != b` -> negation of the above".
- Direction of change: semantics-changed (reference eq -> structural eq) for non-primitive operands at string-fallback sites.
