# Bug 62 — engine `.advance(...)` / `@engine = .X` in Tier-1 `<each>` event handler emits raw → E-CODEGEN-INVALID-JS

change-id: s156-bug62-each-render-engine-ctx
agent: scrml-js-codegen-engineer

## 2026-06-02 — Phase 0 survey (COMPLETE)
- Startup verified: worktree=agent-adfbd1f27c0ac7c1b, ff'd main→f409f48c (only pa.md), bun install + pretest clean.
- Bug REPRODUCED at HEAD: `<li onclick=@phase.advance(.Active)>` inside `<each in=@cols as col>`
  → `E-CODEGEN-INVALID-JS: Unexpected character '@'` (raw `@phase.advance(.Active)` survives).
- Fire site CONFIRMED: emit-each.ts `renderTemplateAttrToJs` event-handler branch (lines 539-562) routes
  handler value through `rewriteIterValueExpr` (iter-scope only, no `.advance`/engine lowering).
- AST shapes confirmed:
  - `onclick=@phase.advance(.Active)` parses as `call-ref { name:"@phase.advance", args:[".Active"], argExprNodes:[...] }` — NO val.exprNode.
  - `onclick=${@phase = .Active}` parses as `expr { raw, exprNode: AssignExpr }` — HAS val.exprNode.
- Pattern-to-mirror CONFIRMED (emit-event-wiring.ts:330-486):
  - `.advance(.X)` (call) → emitExprField(node, fallback, {mode:"client", ...engineExprCtxExtras}) → C13 arm → `_scrml_engine_advance(...)` / `_scrml_engine_dispatch_message(...)`.
  - `@engine = .X` (assign) → rewriteBlockBody(body, null, engineRewriteCtx) → `_scrml_engine_direct_set(...)` (emitAssign has NO engine interception, so MUST use rewriteBlockBody).
- parseExprToNode(string) produces the exact structured CallExpr/AssignExpr the C13/write-guard arms match.
  `@.field` parses to a ParseError → MUST pre-rewrite `@.`/iter-scope (rewriteContextualSigil) to `col`/`col.field` BEFORE parseExprToNode. `@phase` engine sigil survives (rewriteContextualSigil only matches `@.`).
- emit ctx MUST be built from `ctx.fileAST` at codegen stage (same processed AST emit-event-wiring uses);
  raw buildAST gives empty engineVarNames.
- collect* helpers all exported from emit-engine.ts; rewriteBlockBody+EngineRewriteCtx from emit-control-flow.ts; emitExprField from emit-expr.ts; parseExprToNode from expression-parser.ts.

## Plan
1. Build engineRewriteCtx + engineExprCtxExtras once in emitEachBodyRenderForFile (mirror emit-event-wiring:330-364).
2. Thread down: emitEachReconcileLines → renderTemplateChildToJs → renderTemplateAttrToJs (+ nested-each inline path).
3. In renderTemplateAttrToJs event-handler branch: when engine ctx present, detect engine-relevant handler
   (advance-on-engine-var OR assign-to-engine-var). advance→parseExprToNode+emitExprField; assign→rewriteBlockBody.
   Non-engine handlers keep rewriteIterValueExpr (no regression).

## 2026-06-02 — Phase 1 fix (COMPLETE, committed d4e88235)
- emit-each.ts: added EachEngineCtx interface + buildEachEngineCtx(fileAST) + emitEngineHandlerBody(preRewritten, engineCtx) + rewriteIterScopeOnly(text, iterVarName).
- Threaded engineCtx through emitEachBodyRenderForFile → emitEachReconcileLines → renderTemplateChildToJs → renderTemplateAttrToJs (+ nested-each inline + renderEmptyChildToJs paths).
- Event-handler branch (case 2): call-ref + expr forms try emitEngineHandlerBody (iter-scope pre-lowered); fall back to rewriteIterValueExpr if not an engine transition. variable-ref (@handler) unchanged.
- Empirical: state plane → _scrml_engine_advance; message plane → _scrml_engine_dispatch_message({variant,data:{col:col}}); assign → _scrml_engine_direct_set. All node --check clean. Non-engine + engine-free unchanged.

## 2026-06-02 — Phase 2 tests (COMPLETE)
- compiler/tests/unit/each-engine-advance-bug62.test.js — 8 tests pass (state/msg/assign/non-regress/tree-shake).
- compiler/tests/browser/each-engine-advance-bug62.browser.test.js — 5 tests pass (happy-dom click drives full event→engine path).

## 2026-06-02 — Phase 3 R26 empirical verification (COMPLETE, ALL PASS)
- R26.1 STATE-plane reproducer: compile exit 0, node --check CLEAN, _scrml_engine_advance("phase",...) present, 0 raw @phase.advance.
- R26.2 MESSAGE-plane (<each in=@columns as col>, accepts=DragMsg, .advance(.Drop(col))): compile exit 0, node --check CLEAN, _scrml_engine_dispatch_message("dragPhase",{variant:"Drop",data:{col:col}},...) present, 0 raw @dragPhase.advance.
- R26.3 examples/25-triage-board.scrml (gold §51.0.S, Tier-0 lift): compile exit 0 (only pre-existing W-ENGINE-SELF-WRITE-DETECTED info lints), node --check CLEAN. Emitted client.js BYTE-IDENTICAL pre/post fix (lift path untouched) — no regression.

## DEFERRED (report-only, NOT fixed this dispatch — sibling filing)
- Tier-0 ${for…lift} path (emit-lift.js:529) has the IDENTICAL engine-.advance-in-handler gap with a WORSE symptom: `<li onclick=@phase.advance(.Active)>` inside a lift emits `_scrml_reactive_get("phase").advance("Active")` — node --check CLEAN (parse-gate does NOT catch it) but a SILENT RUNTIME miscompile (bare-variant string has no .advance method → TypeError on click). Root cause: emit-lift.js calls `emitExprField(null, handlerSource, { mode: "client" })` — null exprNode (no structured C13 detection) + no engineExprCtxExtras (no engineVarNames threaded). The Tier-1 fix's buildEachEngineCtx + emitEngineHandlerBody pattern is the template; emit-lift.js would need the same engine-ctx threading. The triage-board itself dodges this (uses a dropOn(col) fn-call handler, not a direct .advance), so it is currently latent.
