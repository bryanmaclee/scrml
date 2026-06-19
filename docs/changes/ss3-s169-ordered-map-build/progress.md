# s169-ordered-unordered-build — progress

Branch: worktree-agent-a6eb2c2fd9ba6086b
Base: main a99246e2 (merged in), worktree base 254346e0.

## 2026-06-19 — Step 0: F4 startup + R26 reproduce
- Worktree confirmed: .claude/worktrees/agent-a6eb2c2fd9ba6086b. Merged current main (a99246e2). node_modules + compiler/node_modules symlinked.
- Canonical reproducer shape: top-level `<div>` HTML fragment with `${...}` logic + `${@m.size}` reactive reads (the `page Repro { div { } }` block shape renders static, no client emit).
- R26 CONFIRMED on real source. All `@ordered` maps emit `_scrml_map_from_entries(..., false)`:
  - r1 decl-init literal: ordered `m` emits false (BUG); non-ordered `n` emits false (correct).
  - r2 empty `[:]`: ordered `m` emits false (BUG).
  - r3 reassign in event handler `@m = [...]`: emits false (BUG) + `[:]` init emits false (BUG).
  - r4 nested value-map: outer ordered emits false (BUG); inner value-map emits false (correct, out of scope).

## 2026-06-19 — Step 1: core implementation (commit 2309d5fd)
- reactive-deps.ts: added + exported `collectOrderedMapVarNames(fileAST)` — strict `@ordered`-typed subset of `collectMapVarNames` (annotation must `isMapTypeAnnotation` AND `.trim().endsWith("@ordered")`).
- emit-expr.ts: EmitExprContext gains `orderedMapVarNames` (file-level set) + `emitMapLitOrdered` (transient per-emission flag). `emitMapLit` emits `ordered` flag for both empty + non-empty branches; recurses into entry keys/values with the flag CLEARED (nested map-VALUE literals stay unordered — out-of-scope v1 gap). `emitAssign` sets `emitMapLitOrdered:true` on the RHS for a plain `=` reassignment to a cell in `orderedMapVarNames`.
- emit-logic.ts: state-decl arm + C5 `_emitInitThunkSidecar` lower the init/reassign RHS ordered when the cell is `@ordered`. KEY CORRECTION: `isInit` is TRUE for any non-engine/non-machine reassignment (it is not a reassignment discriminator), so the predicate keys on `node.typeAnnotation` (decl annotation) OR `node.name ∈ opts.orderedMapVarNames` (covers reassignment in fn bodies — AST builder emits a state-decl, not an assign ExprNode). Added `isMapTypeAnnotation` import + `EmitLogicOpts.orderedMapVarNames`.
- Threaded `orderedMapVarNames` parallel to `mapVarNames` at every site: emit-reactive-wiring.ts (collect + both emitOpts branches + type), emit-event-wiring.ts (collect + engineExprCtxExtras spread → inline `onclick=${@m=[...]}`), emit-functions.ts (collect + 3 spreads + scheduleStatements call), scheduling.ts (new final positional param + spread). emit-each.ts (read-context iterable) + emit-client.ts (chunk-gate already inclusive) need NO change — confirmed.
- R26 RE-VERIFIED on real source: r1 ordered `m`→true (reactive_set + init_set) / non-ordered `n`→false; r2 `[:]`→true; r3 reassign-in-fn-body→true + init→true; r4 outer→true / nested-inner→false; r5 inline `onclick=${@m=[...]}`→true. All `node --check` valid. Existing 89 map canaries green.
- SIDEBAR: a sibling ss3 dispatch committed 0030ba5f (type-system g-bare-literal-attr-value) onto this same branch; my WIP c6f4f2a8 preserved, my fix sits on top. Sibling's working-tree progress.md left untouched.
