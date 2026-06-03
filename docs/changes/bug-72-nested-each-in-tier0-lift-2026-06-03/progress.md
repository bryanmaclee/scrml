
## S158 finish (agent-ace86d07fd97b5085) — 2026-06-03

- Startup verified: worktree base 1a72c81c, clean, bun install + pretest OK.
- STEP 1: transplanted aaf169de WIP patch (emit-each.ts +185, emit-lift.js +81). Commit 8c062398. Pre-commit hook green.
- Baseline R26: repro FAILS with E-CODEGEN-INVALID-JS at `...createTextNode(String((@ .) ?? ""))); _scrml_lift`; control PASSES. Confirms PA pinpoint.
- TRACE: repro takes the **reactive DocumentFragment fallback** path (emit-control-flow.ts:464+), NOT the consolidated directReturn path. Leak = `emitLiftExpr(child, {...})` at line 467 with no scopeVar.
- FIX (emit-control-flow.ts): threaded `scopeVar: varName` through all 5 lift sub-paths of emitForStmt — reactive directReturn consolidated (456), reactive fallback lift-expr child (467, THE leak), reactive fallback if-stmt child (477), non-reactive consolidated (532); added `IfOpts.scopeVar` + threaded into emitIfStmt's two consolidated calls (314/328) for nested-each-inside-if-inside-for.
- FIX (emit-lift.js): emitConsolidatedLift now reads `opts.scopeVar` and threads it into emitCreateElementFromMarkup (1596) + the complex-logic lift-expr child (1790).
- Inner `for-stmt` child (485) deliberately NOT given parent scopeVar — inner for self-sets its own iter var as scopeVar (innermost-scope rule §17.7.3).
- R26 PASS: repro compiles exit 0; client.js has 0 raw sigils; inner `@.` lowered to `_scrml_each_item`; node --check OK; control still clean.

## Survey-breadth discovery — per-item @. ATTR value (2nd leak)
- Unit test §5 (`<td title=@.>`) surfaced a SECOND leak: `createTextNode(`${@.} <`)`.
- TRACE: with `title=@.` present, the lift-expr drops from `{kind:"markup"}` AST to `{kind:"expr"}` STRING (emitLiftExpr expr-string branch) → emitCreateElementFromExprString treats `<each>` as a literal element → raw `@.` leaks.
- ROOT CAUSE (ast-builder.js): `parseLiftTag` → `_parseLiftAttrValue` returns null on a bare `@`-sigil attr value. The tokenizer emits `@` as a standalone PUNCT token (text="@"), NOT covered by the IDENT/KEYWORD/AT_IDENT branch. null → parseLiftTag bails the entire tag → string fallback (ast-builder.js:5490).
- FIX (ast-builder.js): added a `PUNCT "@"` branch in `_parseLiftAttrValue` (mirrors the paren-branch), collecting `@.field`/`@.` + call args into an `{kind:"expr"}` attr value. Keeps the lift on the structured markup path where the codegen scopeVar fix lowers the inner each `@.` correctly.
- Verified: attr-case repro now emits `setAttribute("title", String(_scrml_each_item))` + `createTextNode(String(_scrml_each_item))`; 0 raw sigils; node --check OK; no-attr repro + control still clean.
- Regression: 221/221 pass across new test + 14 each/lift/bug70/bug62/bug65 suites.

## Tests landed
- Unit: compiler/tests/unit/each-in-tier0-lift-bug72.test.js — 7 cases (interp/inner-iter-var/of=N/as-alias/attr-value/if-in-for/no-regression). PASS.
- Browser (happy-dom): compiler/tests/browser/each-in-tier0-lift-bug72.browser.test.js — 3 cases (cells render with correct text proving inner @. resolves at runtime; reactivity re-render; per-item title=@. attr). PASS.
  - NOTE: lifted for-loop content mounts at the `data-scrml-logic` span; happy-dom relocates the bare-span-in-tbody out of <table> (invalid HTML), so the test queries the logic-span subtree, not `table td`. The cells DO render correctly — verified via raw outerHTML dump: `<td>a1</td><td>a2</td>`.
