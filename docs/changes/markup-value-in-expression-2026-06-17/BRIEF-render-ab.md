# BRIEF (render layer) — markup-as-value `${}` interpolation render wiring

**Dispatched:** 2026-06-17 (S201). **Agent:** `scrml-js-codegen-engineer` (isolation:worktree, background, opus). **agentId:** a78fccd56adff7793. **change-id:** `markup-value-in-expression-2026-06-17`.

The RENDER layer of the markup-as-value arc. The CODEGEN layer (forms a/b lower to DOM-node values) is in an unpushed local commit `2b4ea4d8`; this agent FF-merges it (STEP 0) then fixes the display wiring (`${node}` → `textContent=` coerces to "[object HTMLSpanElement]" → make it node-aware). First render dispatch (a8d6aea1e590a2100) was stopped + re-dispatched here after it branched from the stale pushed base (`268a27c5`, lacking the a/b codegen). Archived per pa.md S136.

NOTE: this is a continuation of the dispatched render-wiring fix. The full prompt is the corrected re-dispatch (adds the STEP-0 FF-merge of `2b4ea4d8`). Key content:
- **STEP 0:** `git -C "$WORKTREE_ROOT" merge --ff-only 2b4ea4d8` (codegen is in an unpushed local FF-child of origin/main 268a27c5); verify `case "markup-value"` in emit-expr.ts + `emitMarkupValueExpr` in emit-lift.js present; build TodoMVC dist.
- **Bug:** `${markup}` interpolation renders `el.textContent = <DOM node>` → "[object HTMLSpanElement]"; all 4 forms (a/b/c/d, incl. the (d) control); pre-existing.
- **Fix:** `_scrml_render_value(el, v)` runtime helper in the `core` chunk (`v instanceof Node ? el.replaceChildren(v) : el.textContent = String(v)`); change the `${}` interpolation-display emit (static + `_scrml_effect` reactive) to call it. String path BYTE-IDENTICAL. `replaceChildren` precedent: emit-each.ts:1378.
- **Phase 3 R26 RENDER-LEVEL (happy-dom, not just node --check):** all 4 forms render the markup, not "[object ...]"; string interpolation still renders its text (regression).
- **S198:** FULL `bun run test` + within-node + TodoMVC; string path byte-identical (huge blast radius — every `${}`).
- Extend `g-markup-value-in-expression.test.js` with render-level assertions; gap `g-markup-value-ternary-fnreturn-codegen` RESOLVED once render works.
- Path discipline S99/S126; commit per layer; FINAL_SHA descends from 2b4ea4d8 → PA file-deltas the RENDER files only (codegen already staged on main).
