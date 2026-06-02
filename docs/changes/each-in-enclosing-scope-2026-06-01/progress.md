# Progress — each-in-enclosing-scope-2026-06-01

## Startup (S153)
- pwd: /home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-a2de0ea4a61d8bde6
- Worktree base was stale (4e1f9492); merged main -> ff to c89c1cb1 (S153 each/engine/match/colon fixes present).
- bun install + bun run pretest OK.

## Next
- SURVEY: collectEachBlocks + emitEachBodyRenderForFile (emit-each.ts), R28-1b match-child handling, component-render path.

## SURVEY (confirmed both roots)

### Bug A — nested each (CONFIRMED empirically)
Repro compiles clean (only SPA info-lint). Emitted client.js (repro-1-nested-each):
- OUTER each `_scrml_each_render_14()`: factory body has `// each: unhandled template child kind="each-block"` — inner each DROPPED from per-item factory (renderTemplateChildToJs line ~332 fallthrough).
- INNER each `_scrml_each_render_12()`: emitted at MODULE SCOPE with `const _items = g.items;` (g undefined) + module-scope register/invoke/subscribe (lines 60-64). Runtime ReferenceError.
- HTML: only outer each_14 mount div emitted (inner each is inside outer's templateChildren = imperatively rendered, NOT in static HTML walk → no inner mount). So fix is JS-only.

ROOT: collectEachBlocks (emit-each.ts:71) recurses into templateChildren (line 88) → nested inner each gets its own module-scope render fn via emitEachBodyRenderForFile (808). renderTemplateChildToJs (157) has NO each-block branch → inner DROPPED from outer factory.

FIX (mirror R28-1b match precedent at emit-each.ts:303-328):
  1. Add each-block branch to renderTemplateChildToJs: create item-local mount el, append to fragment, inline-emit the inner each's reconcile (source g.items valid in OUTER factory scope where g bound). Refactor reconcile emission into reusable helper.
  2. Mark nested each-blocks in collectEachBlocks; emitEachBodyRenderForFile SKIPS module-scope render fn + dispatchers for nested.
Inner @. resolves to INNER iter var (rewriteContextualSigil takes iterVar param; innermost wins).

### R28-1b precedent (reference for both)
- collectMatchBlocks (emit-match.ts:103) stamps enclosingEachIterVar on match nested in each.
- emitMatchBodyRenderForFile (888) sets itemScopedDispatch:true when isInEach → emit-variant-guard emits dispatch fn taking (_mount,_v), NO module-scope trigger. Match render fns ARE item-agnostic (take payloads) so stay module-scope; only trigger suppressed.
- KEY DIFFERENCE for each: each render fn reads `_items=<source>` which references OUTER iter var (g.items) — NOT item-agnostic. So inner each cannot have a module-scope render fn; must emit ENTIRELY inline in outer factory.

### Bug B — component each (to survey after A lands)
Component body rendered by component render fn (props scope). Each lifted to module-scope render fn can't see `items` prop + doesn't resolve @.. Survey emit-functions.ts component-render path after A.

## Bug A — DONE
Fix (emit-each.ts):
1. EachBlockAstNode: +isNested, +enclosingEachIterVar fields.
2. collectEachBlocks: walker threads enclosingEachIterVar; entering an each's templateChildren sets the inner iter var; nested each-blocks stamped isNested.
3. emitEachBodyRenderForFile: skips isNested each-blocks (no module-scope render fn / dispatcher).
4. NEW emitEachReconcileLines helper — shared empty-guard + reconcile emission (module-scope + nested-inline call sites in lockstep).
5. renderTemplateChildToJs: NEW each-block branch — emits inner each INLINE in outer factory (item-local mount + inline reconcile, source resolved in outer scope via rewriteIterValueExpr, wrapped in arrow-IIFE so the empty-guard return short-circuits only the inner build). Inner @. binds to INNER iter var.

Mechanism: mirrors R28-1b <match>-in-<each> (item-local mount + inline per-item render), adapted to an each whose render is NON-item-agnostic (inner source depends on outer iter var → cannot be a module-scope fn).

Verify:
- repro-1-nested-each: compiles clean, node --check PASS, NO module-scope `const _items = g.items;`, NO unhandled-kind comment, inner each inline.
- happy-dom (nested-each-in-enclosing-scope.browser.test.js): 7 pass — renders alpha/beta (1 group), alpha/beta/gamma (2 groups), outer-reactivity re-render (zeta).
- Anchors (anchor-errorboundary-each, anchor-if-each): compile clean, node --check PASS, keep module-scope render fn reading top-level cell `todos` (non-nested untouched).
- each/match/engine/R28 suite: 193 pass / 0 fail.
- each-block §8 test updated (was LOCKING the bug — asserted "2 render fns" = the phantom-double-handling defect).

## Next: Bug B — component each (survey emit-functions.ts component-render path)

## Bug B — SURVEY (root deeper than brief anticipated; bounded + clean)

Brief guessed: emit the each scoped to the component's render fn (emit-functions.ts).
ACTUAL architecture: components are INLINED at expansion (component-expander.ts, Stage 3.2).
There is NO separate component-render scope — the each becomes a top-level each at the call site.

THREE coordinated roots (all in/around component-expander.ts re-parse path):

ROOT 1 — each-block NOT promoted during CE re-parse.
  parseComponentBody → reparseSynthesizedFile defaults to the NATIVE parser
  (sourceNeedsLiveFallback doesn't trigger on <each>). The native parser does NOT
  promote <each> to an each-block node — it leaves [markup] tag=each. The legacy
  BS+TAB path DOES promote it correctly (probed both). So the each-block is never
  created; <li>${@.name}</li> survives as flattened markup, @. unresolved →
  E-SCOPE-001 on key + bare `.name` leak (E-CODEGEN-INVALID-JS).
  FIX 1: add <each / <match detection to sourceNeedsLiveFallback (route to legacy
  re-parse — purpose-built divergence guard; legacy already handles each promotion).

ROOT 2 — prop not substituted into each-block fields.
  substituteProps handles text/markup/logic but NOT each-block; falls into generic
  array-recursion (recurses children but NOT string fields inExprRaw/keyExprRaw).
  After expansion: each-block inExprRaw="items" (the PROP) — codegen emits
  `const _items = items;` (items undefined at module scope). Need items → @todos.
  FIX 2: add each-block branch to substituteProps — substitute props in
  inExprRaw/ofExprRaw/keyExprRaw/asName + recurse templateChildren/bodyChildren/emptyChild.

ROOT 3 — keyExprRaw space-padded `@ . id` (tokenization artifact).
  CE re-parse input from normalizeTokenizedRaw leaves `@ . id` inside the each opener.
  codegen rewriteContextualSigil only matches `@.ident` (no interior space) → emits
  the raw `@ . id` (invalid JS). Top-level each gets clean `@.id` (original source).
  FIX 3: normalizeTokenizedRaw collapses `@ . ident` → `@.ident` (tokenized-form only;
  real source has no space — same specificity argument as the existing `< / >` collapse).

All three are bounded + localized. Proceeding (architecture admits a clean fix —
just in component-expander.ts, not emit-functions.ts as the brief guessed).

## Bug B — DONE
Fix (component-expander.ts — all three roots):
- FIX 1: sourceNeedsLiveFallback +case 3 — `<each>`/`<match>` bodies route to legacy BS+TAB re-parse (promotes the structural each-block/match-block node the native parser leaves as [markup]).
- FIX 2: substituteProps +each-block/match-block branch — substitute props in in=/of=/key=/as=/on= string fields (NEW substitutePropsInRawExpr helper, leading-ident word-boundary replace that skips member-access tails + @.member) + recurse template/body/arms/empty children.
- FIX 3: normalizeTokenizedRaw +collapse tokenized `@ . ident` → `@.ident` (so the re-parsed each-block carries clean keyExprRaw matching the top-level path).

Verify:
- repro-2-component-each: compiles clean (no E-SCOPE-001, no E-CODEGEN-INVALID-JS), node --check PASS. `const _items = _scrml_reactive_get("todos")` (prop substituted), keyFn `=> _scrml_each_item.id`, body `_scrml_each_item.name`.
- happy-dom (component-each-in-prop-scope.browser.test.js): 6 pass — renders alpha/beta + prop-cell reactivity re-render (zeta).
- Component-with-match body also fixed by FIX 1 (separate latent gap; produces proper match render fns) — net improvement.
- component + each suite: 232 pass / 0 fail. each/match/engine/R28: 154 pass / 0 fail.

Reused Bug-A infra? Partially — the each-block survives + becomes a top-level each at the call site, so Bug-A's codegen (module-scope render fn) handles it; no NEW codegen needed. Bug B was entirely a component-expander re-parse + prop-substitution fix (different file than the brief guessed — components are INLINED, no separate component-render scope).

## CLOSE — both bugs DONE
- Bug A commit: 8f83ec95 (emit-each.ts — nested each inline in outer factory)
- Bug B commit: 45def3e5 (component-expander.ts — each survives expansion + prop subst + sigil collapse)
- Full suite (bun run test): 22807 tests across 873 files, 0 fail (baseline 0 fail).
  unit+integration+conformance: 15600/0-fail. browser: 336/0-fail.
- New tests: nested-each-in-enclosing-scope.browser.test.js (7), component-each-in-prop-scope.browser.test.js (6).
- Anchors (each in errorBoundary / under if=, top-level cell source) preserved.

## Follow-ups (surfaced, NOT closed)
- Native parser does NOT promote <each>/<match> to structural nodes (Bug-B FIX 1 routes AROUND via legacy fallback). When native parser becomes the default (M5-swap), it must promote these — else ALL each/match break, not just component bodies. Surface to PA.
- Deeper nesting (each-in-each-in-each): Bug-A is recursive (renderTemplateChildToJs's each-block branch calls emitEachReconcileLines which walks templateChildren via renderTemplateChildToJs) — should work but untested beyond 2 levels.
- each-in-match-arm-in-each / each-in-snippet: not exercised here; potential adjacent gaps.
