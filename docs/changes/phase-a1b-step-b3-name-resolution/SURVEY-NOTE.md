# Phase A1b Step B3 — Survey note

**Branch:** `main` (no isolation, per S64 hand-off note 43).
**Baseline:** `cf69028`. Test counts: **8959 / 44 / 1 / 0 / 9004 / 442**.

---

## Q1: What does the compiler today do with `@name` references in expressions?

**Lots, but no explicit "resolved-target" annotation.**

- **Tokenizer** (`tokenizer.ts:845-851`) recognizes `@` as either prefix on an
  identifier (`AT_IDENT`) or bare `@` punct.
- **Expression parser** (`expression-parser.ts:89, 486+, 552, 607`) preserves
  the `@` verbatim in `IdentExpr.name` (e.g. `@count` → `ident.name === "@count"`).
  Confirmed via `types/ast.ts:1271-1276` IdentExpr docblock: "For reactive vars,
  includes `@`".
- **Dependency graph** (`dependency-graph.ts:217-240, 1458-1618`) sweeps every
  ExprNode tree (`exprNode`, `initExpr`, `condExpr`, `valueExpr`, `iterExpr`,
  `headerExpr`) collecting `@`-prefixed idents as reactive REFERENCES — used to
  build the dep graph for reactivity wiring. Does NOT fire any "unresolved" error.
- **Type-system §2a** (`type-system.ts:2870-2999`) walks logic-context
  ExprNodes and fires E-SCOPE-001 on bare (non-`@`) idents that don't resolve.
  Crucially: line 2949 explicitly **skips** `@`-prefixed idents — comment says
  "validated by the DG sweep".
- **DG sweep does NOT validate.** Despite the type-system comment, the DG sweep
  only collects references for graph construction; it never errors on
  unresolved `@name`. This is the gap — but it's intentional today: any
  `@undeclared` would produce broken JS at runtime, but the compiler's "resolution
  fail" path is implicit.
- **Codegen** (`emit-expr.ts:137, 360, 420; emit-html.ts; emit-bindings.ts;
  reactive-deps.ts:269; rewrite.ts:698`) all consume `@`-prefixed idents
  pragmatically by string-prefix-checking and rewriting to runtime calls.

## Q2: Existing annotated-AST convention?

Mixed — both **direct property assignment** on AST nodes AND `Object.defineProperty`
with `enumerable: false` for back-pointers that introduce cycles.

- **Direct (enumerable):** NR uses `node.resolvedKind` / `node.resolvedCategory`
  (name-resolver.ts). Phase 2 (parseVariant) uses
  `(call as Record<string, unknown>).parseVariantEnum = enumType`
  (type-system.ts:7746).
- **Non-enumerable (cycle-safe):** B1's SYM uses `Object.defineProperty(node,
  "_record", { enumerable: false, ... })` because `_record → record.scope →
  scope.stateCells.get(name) → record` is a cycle.

**B3 decision: use `Object.defineProperty` non-enumerable.** The B3 annotation
back-points an IdentExpr to a `StateCellRecord`, which back-points to its
`scope`, which contains a `stateCells: Map → StateCellRecord` cycle. Mirrors B1.

Field name: **`_resolvedStateCell`** — underscore prefix matches B1's
compiler-internal annotation convention (`_scope`, `_record`).

## Q3: Existing "resolution failed" diagnostic?

Per A1b plan line 228: **B3 → "(resolution-fail catch-all; existing infra)"**.

- **E-SCOPE-001** (type-system.ts:2870-2999) is the existing catch-all for
  bare-ident undeclared. It explicitly skips `@`-prefix today.
- **No dedicated `@`-undeclared diagnostic exists.** DG sweep just collects;
  emitted JS would silently reference an undefined runtime symbol.

**B3 scope decision:** B3 RECORDS resolved-target on the IdentExpr (the affirmative
case). For the negative case, **B3 sets `_resolvedStateCell` to `null` on
`@`-prefixed IdentExprs that fail lookup**, which downstream A1b steps (B5+, B7,
B10, B22) can detect. **B3 does NOT fire a new error code** — keeps to brief
authority "resolution-fail catch-all; existing infra". A future tightening
dispatch may convert null-marker into E-SCOPE-001-style firing across `@`-refs;
not in B3's scope.

This deliberately keeps B3 small and additive. The annotation contract is what
B5+ needs.

## Q4: Does B1's `lookupStateCell` cover B3's needs?

**Yes, exactly.** `lookupStateCell(scope, name)` walks parent chain. B3 calls it
with `name.slice(1)` (strip the `@`) at each `@`-prefixed IdentExpr.

For compound nav (`@formRes.name`), the IdentExpr is the BASE of a MemberExpr —
so the walker hits `@formRes` IdentExpr first. We resolve the **base cell only**
at B3. Property access (`.name`) is a path traversal that B5+ may re-resolve via
`lookupQualifiedStateCell` if it needs the leaf. For B3's "resolved target on
ExprNode" contract, root-cell resolution is what's needed — matches A1b plan
B3's wording ("resolves to state cell"; root-cell is the cell).

For `@formRes` directly (no `.name`), it resolves to the compound parent.

## Q5: B3's actual surface area vs the 4-6h estimate

**Survey discount candidate.** Surface is ~half the estimate:

1. PASS 3 in symbol-table.ts (parallel to PASS 1 + PASS 2): walk every
   ExprNode-bearing field on every AST node; for each `@`-prefixed IdentExpr,
   call `lookupStateCell(currentScope, name.slice(1))`; annotate with
   `_resolvedStateCell`. Re-uses the existing AST recursion shape (PASS 2's
   walker) + `forEachIdentInExprNode`.
2. EXPR_FIELDS list is already defined in type-system.ts:7732 — copy it.
3. Public API addition: optional helper `getResolvedStateCell(ident)` for
   readers; `_resolvedStateCell` field is the contract.
4. Tests: ~8-12 tests in new `compiler/tests/unit/at-name-resolution.test.js`.
5. NO error-code wiring (uses existing infra; B3 records, doesn't fire).

**Estimate revised: ~2-3 h.** Depth-of-survey discount #8 candidate confirmed.

## Q6: Concurrency considerations

- **Phase 2 parseVariant** in type-system.ts:7715-7800 uses the same EXPR_FIELDS
  shape and walks every ExprNode payload. Same locus, but different concern
  (annotates CallExpr, not IdentExpr) — orthogonal, no field collision.
- **B2 PASS 2** (symbol-table.ts:472-537) walks AST; B3 PASS 3 will mirror that
  walker but ALSO walks ExprNode payloads. Fresh `visited` WeakSet per pass.
- **DG sweep** runs at Stage 4 (after CE); B3 runs at Stage 3.06 SYM (BEFORE CE).
  No race; DG can read `_resolvedStateCell` if it wants but doesn't need to —
  it independently re-collects via `forEachIdentInExprNode`.
- **Codegen** runs at later stages and currently does string-prefix checks on
  `@`-name. If we wanted to ride the resolution decoration, we'd need codegen
  rework — out of scope for B3.

## Implementation plan

1. **Chunk 1:** Extend `symbol-table.ts` — add PASS 3 (`walkExprResolveAtNames`)
   that walks ExprNode payloads on AST nodes, calls `forEachIdentInExprNode` on
   each, and annotates `@`-prefixed IdentExprs with `_resolvedStateCell` via
   `Object.defineProperty(enumerable: false)`. Add public helper
   `getResolvedStateCell(ident): StateCellRecord | null`. Update docblock.
   **Commit.**

2. **Chunk 2:** Add `compiler/tests/unit/at-name-resolution.test.js` — ~10
   tests covering happy paths, compound nav, failure (null), discrimination
   (bare name not resolved), call/property access, B5-shaped read assertion.
   **Commit.**

3. **Chunk 3:** Run full suite; verify zero regressions. If any test that
   previously emitted unresolved-`@` patterns now sees `_resolvedStateCell:
   null`, that's expected (annotation, no error). Update progress.md, commit.

## Decision summary

- **Field name:** `_resolvedStateCell` (non-enumerable Object.defineProperty)
- **Pass location:** PASS 3 in symbol-table.ts (Stage 3.06 SYM, post-PASS-2)
- **Negative case:** annotate `null` (no new error code; brief authority)
- **API:** add `getResolvedStateCell(ident)` helper
- **Tests:** new file at `compiler/tests/unit/at-name-resolution.test.js`
