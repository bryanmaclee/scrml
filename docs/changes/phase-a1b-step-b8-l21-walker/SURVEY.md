# A1b B8 — Phase 0 SURVEY

Date: 2026-05-07. Branch: `phase-a1b-step-b8-l21-walker-derived-value-mutate`. Baseline: `bd3a0aa`.

## Scope

E-DERIVED-VALUE-MUTATE only (E-SYNTHESIZED-WRITE deferred to B11 per audit §1.3).

## (a) E-DERIVED-WRITE fire site

**Finding: NOT IMPLEMENTED YET.** Spec defines E-DERIVED-WRITE in §6.6.8 + §34, but no source-code firing exists in `compiler/src/**`. Only references found:

- `compiler/SPEC.md:2626 §6.6.8` — normative definition
- `compiler/SPEC.md:14202 §34` — catalog row
- `compiler/tests/integration/parse-mutation-shapes.test.js:43` — sibling-rule comment

**Impact on B8:** §6.6.18 normative says "SHALL run during the same pass that checks E-DERIVED-WRITE (§6.6.8)". Since E-DERIVED-WRITE has no fire site today, B8 cannot piggyback on an existing pass. **Decision:** B8 lands a fresh PASS 6 in `runSYM`, structured so that when E-DERIVED-WRITE is implemented later, it can join the same walker (single tree-walk for all derived-cell-receiver checks). Document this affordance in the pass header.

This is NOT a STOP-trigger because the spec constraint is satisfiable by the future E-DERIVED-WRITE implementation joining B8's pass. B8's walker structure is prepared for that join.

## (b) AST shape verification

Per `compiler/tests/integration/parse-mutation-shapes.test.js` (Step 10 finding) — scrml uses ESTree-flattened forms with TWO discriminator paths:

### Specialized-lowering kinds (statement position only)

1. **`reactive-array-mutation`** (ast-builder.js:3531) — `@name.method(args)` where `method` ∈ ARRAY_MUTATIONS list AND `name` is a single segment. Fields: `target` (string cell name), `method` (string), `argsExpr`.
2. **`reactive-nested-assign`** (ast-builder.js:3555) — `@obj.path.to.leaf = value` (PLAIN `=` ONLY). Fields: `target` (string cell name), `path` (string[]), `valueExpr`.

### Generic `bare-expr` kind (everything else)

`bare-expr` wraps a full ExprNode. Discriminator paths:

- **Compound assigns** (`+=`, `-=`, ..., 14 forms): `kind: "bare-expr"` → `exprNode.kind === "assign"` with `exprNode.op !== "="`. `exprNode.target.kind ∈ {"member", "index"}` with leaf ident name starting with `@`.
- **Computed-index assigns** (`@arr[0] = "x"`): `kind: "bare-expr"` → `exprNode.kind === "assign"` with `exprNode.target.kind === "index"`.
- **Delete** (`delete @obj.foo`): `kind: "bare-expr"` → `exprNode.kind === "unary"`, `exprNode.op === "delete"`, `exprNode.argument.kind ∈ {"member", "index"}`.
- **Compound-receiver method calls** (`@form.errors.push(x)`): `kind: "bare-expr"` → `exprNode.kind === "call"`, `exprNode.callee.kind === "member"`, leaf ident at receiver chain root has `@` prefix.

### Leaf ident traversal helper (test-file pattern)

```js
function leafIdent(node) {
  let cur = node;
  while (cur && typeof cur === "object") {
    if (cur.kind === "ident") return cur;
    if (cur.kind === "member") { cur = cur.object; continue; }
    if (cur.kind === "index")  { cur = cur.object; continue; }
    return null;
  }
  return null;
}
```

The leaf ident's `name` carries the `@`-prefix verbatim (e.g., `"@form"`).

## (c) Receiver-chain root resolution

Two reuse paths:

1. **PASS 3 stamps `_resolvedStateCell` on EACH `@`-prefixed IdentExpr** via `forEachIdentInExprNode`. The leaf ident at the receiver-chain root is therefore already annotated when B8 runs — B8 reads `(leaf as any)._resolvedStateCell` directly with no re-resolution.
2. **`lookupQualifiedStateCell(scope, path[])`** resolves multi-segment compound paths (e.g., `["form", "derivedField"]`) when B8 needs to check whether the LEAF of a compound-nav chain is a `const`-derived sub-cell. Used for case-3 (in-compound derived sub-cell).

For specialized-lowering kinds, `target` is a string and `path` is a string[]; B8 calls `lookupQualifiedStateCell(scope, [target, ...path?])` to find the leaf record.

For `bare-expr`, B8 walks `exprNode` to the leaf ident (using the helper above), strips the `@`, then collects path segments by walking the chain (member.property strings) to build a path[]; calls `lookupQualifiedStateCell` if multi-segment, else `_resolvedStateCell`.

## (d) `isConst` flag verification

Per `StateCellRecord.isConst` (symbol-table.ts:207): "Mirrors `ReactiveDeclNode.isConst`. True iff `const <x> = expr` derived form."

B5 already uses this to discriminate derived cells (line 1151, 1362, 1412). The flag is set at TAB by ast-builder for all `const <x> = ...` decls. B8 reads `record.isConst` to gate firing.

## ExprNode field surface in B8 walker

B8 must walk every ExprNode payload to reach embedded mutation forms (e.g., `if (cond) { @arr.push(1) }` — the bare-expr is in an `if-stmt.consequent`). The B3 walker already does this via `B3_EXPR_FIELDS` + structural recursion. B8 should:

- Walk the AST tree visiting body[]/children[]/consequent[]/alternate[]/arms[].body[].
- At each statement node, dispatch on `kind`:
  - `reactive-array-mutation` → case 1 check.
  - `reactive-nested-assign` → case 2 check (plain `=` form).
  - `bare-expr` → recurse into `exprNode` looking for assign/call/unary patterns.
- Inside ExprNode walks (B8 only inspects assign/call/unary at the TOP of an expression statement; nested mutations like `f(@arr.push(1))` are still mutations and SHOULD fire — B8 walks the whole ExprNode tree).

## Pass placement

PASS 6 in `runSYM`, after PASS 5 (B6 render-by-tag). Reads:
- PASS 1's `_scope` annotations (for currentScope tracking).
- PASS 3's `_resolvedStateCell` annotations (leaf-ident shortcut).

Writes: nothing structurally; pushes `SYMDiagnostic[]` entries onto the shared `errors[]` array.

## Wave-ordering caveat (audit §1.3)

E-SYNTHESIZED-WRITE deferred to B11 (synth-cell registry birthplace). B8 does NOT touch synth registry today; ships a structurally-correct E-DERIVED-VALUE-MUTATE walker that B11 can extend.

## Survey verdict

CLEAR — no STOP-trigger. Proceed to Phase 1 (constants modules).

Estimated remaining effort: 2.5-3.5h (Phase 0 done in ~30min).
