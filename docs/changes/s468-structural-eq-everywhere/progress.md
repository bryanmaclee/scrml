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
- 2026-10-17 second reproducer (adjacent positions) found two MORE raw-text roots: `<each>` per-item text path
  (`emit-each.ts` `rewriteIterValueExpr`) shipped JS LOOSE `it == _scrml_cs_reactive_get("sel")` (no equality pass at
  all); library-module verbatim block (`emit-library.ts`) shipped `export const SAME = { a: 1 } == { a: 1 }` (false).
  Server raw-text passes (`serverPasses`) also have no equality pass, but no server raw-text `==` reached the corpus
  and server-fn match arms / for bodies / ternaries all go through the structured path (repro3) — residual, reported.
- Fix: NEW `compiler/src/codegen/string-equality-lowering.ts` — `lowerEqualityOps` parses the (already JS-shaped)
  text with acorn (expression, else module body; top-level return/await allowed) and rewrites each `==`/`!=`
  BinaryExpression in place with emitBinary's rule (`isStaticallyPrimitiveEstree` = ESTree twin of
  `isStaticallyPrimitive`). Wired into rewrite.ts Pass 18 (unparsed -> legacy `===`), emit-each.ts
  rewriteIterValueExpr and emit-library.ts verbatim block (unparsed -> unchanged). Rule 7: the string pipeline holds no
  ExprNode; acorn's tree is the tree.
- Primitive proof (how `===` survives): both operands must be, on the parsed tree, a non-regex Literal, a
  TemplateLiteral, a Unary/Update/Binary expression (all yield JS primitives), a Logical/Conditional whose branches are
  all such, a non-computed `.length/.size/.byteLength/.name` member, or a nested `_scrml_structural_eq(...)` call.
  Same conservative rule as emit-expr `isStaticallyPrimitive`; anything else (identifiers, cell reads, members, calls)
  takes the helper, which is also correct for primitives.
- Direction: semantics-changed (reference / loose eq -> §45 structural) at raw-text sites. Corpus differential
  (base 5c43c3b8e archive vs head; roots examples,samples,conformance/cases,stdlib; 2840 sources, 8562 artifacts):
  0 compile-outcome changes, 0 diagnostic-code changes, effective syntax delta 0; 227 content diffs = 167 path-noise
  only (project-root string differs between the two checkouts) + 50 real in 30 sources. Every real changed line
  inspected (classify.ts): each is `===`/loose `==` -> `_scrml_structural_eq` (or `(a === b)` paren-wrap of an
  already-primitive pair), plus companion runtime-hash changes in .html/.scrml-client-assets.json and one ADDED
  `_scrml/_global.js` for the library module whose inlined helper reads host globals. Unparsed inputs logged with
  SCRML_EQ_FALLBACK_LOG=1: 10, all in 3 compile-FAILING fixtures or `<each>` predicate text later lowered structurally
  by lowerEachExpr — 0 artifact-producing legacy fallbacks.
- Tests: unit `compiler/tests/unit/s468-string-equality-lowering.test.js` (23); integration
  `compiler/tests/integration/s468-structural-eq-everywhere.test.js` (5; happy-dom with the TREE-SHAKEN emitted runtime;
  all 4 browser tests FAIL on base 5c43c3b8e, verified). 11 pinned `===` expectations in 10 existing test files updated to
  the §45.4 form (each pinned reference/loose equality on a non-provably-primitive operand).
