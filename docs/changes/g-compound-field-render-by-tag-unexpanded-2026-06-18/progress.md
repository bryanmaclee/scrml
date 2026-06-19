# progress — g-compound-field-render-by-tag-unexpanded

## 2026-06-18 — startup + reproduce
- WORKTREE_ROOT: /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-adf911416eeed3d19
- base HEAD a6e64126 (S207); descends from c553dd84 (current main) — verified `--is-ancestor` YES. No `git merge main` needed.
- bun install OK (204 pkgs). bun run pretest OK (13 samples compiled).
- REPRODUCED on HEAD:
  - compound-rbt.scrml `<form><uname/></form>` emits LITERAL `<uname />` (bug) + spurious `E-DG-002 @signup never consumed`.
  - toplevel-rbt.scrml `<form><uname/></form>` emits `<input type="text" id="u" required="" minlength="2" data-scrml-render-by-tag="_scrml_render_by_tag_1" />` (correct).
- Map finding (LOAD-BEARING): Bug 60 (S157) ALREADY added `enclosingCompoundStack` + `lookupQualifiedStateCell` fallback to emit-html.ts for render-by-tag inside compound wrappers (`<signupForm><userName/></>`). The new gap is that this mechanism does NOT cover the repro shape. Need to find WHY the stack-fallback misses here.

## next
- Read emit-html.ts render-by-tag resolution + enclosingCompoundStack push/pop + lookupQualifiedStateCell.
- Read SPEC §6.3 + §6.4 in full.

## 2026-06-18 — root cause + fix
- SPEC read: §6.3.5:2290 (`<formRes><name/></>` valid render-by-tag for member if it has a render-spec) + §6.4.1/6.4.2 (Shape-2 → expand to bound input). Fix is EXPAND, confirmed.
- ROOT CAUSE: emit-html.ts render-by-tag resolution (the Bug 60 path) resolves a member ONLY via the `enclosingCompoundStack` lexical fallback (`lookupQualifiedStateCell([enclosing, tag])`). The stack is populated ONLY while the markup walker is INSIDE the compound block-form wrapper. Our repro references `<uname/>` in a SIBLING `<form>` (non-lexical), so the stack is empty, both lookups miss, literal-tag fall-through.
- FIX 1 (symbol-table.ts adcc6856): NEW `lookupCompoundMembersByLeafName(scope, leafName)` — scans every compound parent in the scope chain, descends one level into `_scope`, collects non-synthesized members matching `leafName`. Returns ALL matches for caller ambiguity handling.
- FIX 2 (emit-html.ts 740112f0): step-3 fallback in the rbt resolver — exactly-one match resolves to the SAME Shape-2 bound-input expansion (keyed on qualifiedPath `signup.uname`); more-than-one fires NEW `E-CELL-AMBIGUOUS-MEMBER-RENDER` (no silent pick, §6.4) and leaves tag unexpanded.
- FIX 3 (dependency-graph.ts 740112f0): per-file compoundMemberToParent map; a member rbt credits the PARENT compound → spurious E-DG-002 cleared.
- R26 VERIFIED: compound-rbt.scrml now emits `<input type="text" id="u" required="" minlength="2" data-scrml-render-by-tag="_scrml_render_by_tag_1" />` (was literal `<uname />`); E-DG-002 GONE (only W-PROGRAM-SPA-INFERRED remains, same as toplevel). client.js binds + validity surface (signup.uname.errors/.isValid) wire on the qualified path. toplevel-rbt.scrml unchanged.
- TEST (b7o7wix3y): render-by-tag-compound-member-non-lexical.test.js — 11 cases, all pass.

## next
- Run FULL suite incl. browser (shared render-by-tag / scope-resolution path).
