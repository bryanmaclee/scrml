# BRIEF — GITI-033: `<each>` item-accessor `@.` dropped inside ternary-markup `${cond ? <markup> : ""}`

**Severity:** HIGH (adopter-blocker). Blocks giti `status.scrml` + `land.scrml` from compiling *at all*.
**Class:** loud — `E-CODEGEN-INVALID-LOGIC` (compiler emits JS it cannot itself parse).
**Family:** the last slice of the GITI-032 conditional-markup-lowering family. Sibling of Bug 72 (S158).
**SPEC status:** NO amendment. §17.7.3 (`@.` = innermost each scope, legal in *any* markup context) already
covers this; E-SYNTAX-064 correctly does NOT fire. Pure codegen-lowering gap. (Rule 4 check done.)
**Reproduced (R26 reverse-direction, PA-side @ `364def58`):** repro FAILS with
`createTextNode(String((@.) ?? ""))` → `Unexpected character '@'` at CG stage; the identical each block
OUTSIDE the ternary (the control) compiles clean. Repro + control in
`docs/changes/giti-033-each-in-ternary-markup/` (mirror of giti `ui/repros/repro-32`).

## Root cause (pinned to one gate)

When an `<each>` is nested inside a ternary-markup consequent (`${ show ? <ul><each in=strs>…</each></ul> : "" }`),
the consequent markup is lowered by `emitMarkupValueExpr` → `emitCreateElementFromMarkup`
(`compiler/src/codegen/emit-lift.js`). Its child-loop (emit-lift.js **1394–1402**) routes a `tag="each"`
child through `tryEmitNestedLiftEach` (emit-lift.js **382–388**):

```js
function tryEmitNestedLiftEach(eachMarkupNode, scopeVar, fragmentVar, engineCtx) {
  if (!scopeVar || typeof scopeVar !== "string") return null;   // ← THE GATE
  ...
  return each.emitNestedEachFromMarkup(eachMarkupNode, scopeVar, fragmentVar, "", engineCtx);
}
```

`scopeVar` is the **enclosing `for`-loop variable**. In the ternary-markup path there is no enclosing
`for` (the each iterates a module/const/`@cell` source, e.g. `strs`, `rows`, `d.files`), so `scopeVar`
is **null** → `tryEmitNestedLiftEach` returns null → the `<each>` falls through to
`emitCreateElementFromMarkup(child, …)`, which renders it as a **literal `<each>` element** and recurses
its `<li>${@.}</li>` body → `${@.}` reaches the bare-expr text-node path with **no iter-scope rewrite**
→ `createTextNode(String((@.) ?? ""))` → E-CODEGEN-INVALID-LOGIC.

The Bug 72 (S158) author *deliberately* gated on `scopeVar != null` — comment at emit-lift.js **365–367**:
> `scopeVar` is null at the top markup level (no enclosing `for`); a nested `<each>` there is malformed
> markup the caller still renders literally (no regression).

**That assumption is wrong.** A nested `<each>` whose source is module/const/`@cell` scope (not a for-loop
var) is valid scrml — the control proves it compiles at top level. The gate is too narrow.

## The fix (contained — reuse existing machinery, no fork)

The entire lowering machinery already exists (`eachBlockFromMarkupNode` + `emitNestedEachFromMarkup` +
`emitEachReconcileLines`, emit-each.ts 2072 / 2144 / 2195). It resolves the iteration source via
`rewriteIterValueExpr(inExprRaw, enclosingScopeVar)` (emit-each.ts 2165 → 937) which:
- collapses `@.` padding, runs `rewriteContextualSigil` (no-op on a source expr with no `@.`),
- runs `rewriteAtCellAccess` (`@cell` → `_scrml_reactive_get(...)` for reactive sources),
- and wraps the reconcile in a per-item `_scrml_effect` (emit-each.ts 2195) so a reactive `@cell` source
  re-renders and a const source runs once (byte-equivalent).

So a module/const/`@cell` source resolves correctly **with `enclosingScopeVar` = null** — a bare const
(`strs`) passes through, a `@cell` lowers to reactive-get, a ternary-scope binding (`d.files`) passes
through as a bare ref resolving in the emitted closure scope.

**Change:** loosen the `tryEmitNestedLiftEach` gate so a null `scopeVar` still routes through
`emitNestedEachFromMarkup` (passing `scopeVar` — possibly null — down). The dev owns the exact shape;
the intent is "route the nested each through the shared handler whether or not there is an enclosing
for-loop scope var."

### Preconditions the dev MUST verify before landing
1. **Null-safety of the source-resolution chain** with `enclosingScopeVar = null` — confirm
   `rewriteContextualSigil` / `rewriteIterValueExpr` / `emitNestedEachFromMarkup` do not assume a
   non-null iter var. (The source expr carries no `@.` so the rewrite is a no-op, but confirm no crash.)
2. **Per-item ATTRIBUTE interpolation** — the repro's `class="tag tag-${@.kind}"` is the known
   Landing-1 "best-effort" soft spot (PRIMER §6.3). `@.kind` inside an attribute template MUST lower to
   the iter binding, not leak. This is the highest-risk edge — test it explicitly.
3. **Reactive `@cell` source** (not just const) — the `_scrml_effect` wrap must subscribe + re-render on
   update. Add a case where the each iterates a reactive cell inside the ternary.
4. **Match-arm payload binding** (the DOMINANT real giti shape — corrected after inspecting
   status.scrml + land.scrml): `<match for=Phase on=@x>` → `<Loaded(d)>` payload arm → ternary-markup
   in the arm body → nested `<each in=d.field>` with `@.`/`class="tag tag-${@.kind}"`. `d` is a
   match-arm closure var; the inner source `d.field` must resolve in the match-arm render-fn scope
   (bare passthrough), the inner `@.` to the inner each's item (§17.7.3 innermost-wins). This lowers
   through emit-match.ts → emitMarkupValueExpr — a DIFFERENT entry than the `<main>`-direct minimal
   repro, so the module-const case is necessary-but-not-sufficient. **Acceptance:** `../giti/ui/status.scrml`
   + `../giti/ui/land.scrml` compile clean + `node --check` their emitted client.js (R26; read-only —
   do NOT edit giti).
5. **`<empty>` sub-element** inside a ternary-nested each renders on empty collection.

### Must NOT regress
- The Bug 72 `${for…lift}` path (scopeVar non-null) — byte-identical.
- Literal non-`each` markup children in a ternary consequent.
- The GITI-032 fix (multiple pure conditional-markup blocks in one arm — already landed S239).

## Gate (per `.pa-base/profile`)
- **Tests:** unit tests in `compiler/tests/unit/` covering the 5 preconditions above (bare `${@.}` string
  list · `${@.field}` · class-attr `${@.kind}` · reactive-cell source · nested-in-outer-each · `<empty>`).
  Full `bun test` delta must be zero vs the env-floor (this machine: `bun install` FIRST; 143 env-fails
  are the floor).
- **MERGE-BLOCKER:** a conformance case pinning it — codes-half (E-CODEGEN-INVALID-LOGIC does NOT fire on
  the valid source) + runtime-half (the emitted list renders the item values). `conformance/`.
- **R26 EMPIRICAL:** recompile the repro + control clean; giti re-runs `tests/manual/browser-paint.mjs`
  over all 7 pages (status + land must go green) on the post-fix baseline before claim-closed.
- **S239 ADVERSARIAL:** PA-side `/code-review high` (or finder fan-out) on the dispatch diff BEFORE
  landing — our own pipeline too. Land only if clean.

## Files (expected surface)
- `compiler/src/codegen/emit-lift.js` — the `tryEmitNestedLiftEach` gate (382–388) + child-loop (1394–1402).
- `compiler/src/codegen/emit-each.ts` — `emitNestedEachFromMarkup` (2144) / `rewriteIterValueExpr` (937)
  IF a null-scope path needs hardening.
- `compiler/tests/unit/` — new cases.
- `conformance/` — the merge-blocker case.

## Dispatch
Agent: `scrml-js-codegen-engineer` (canonical compiler-source dev, Opus). iso: worktree (S88/S99 path
discipline). Base: `364def58`. S67 file-delta landing. Brief = this file.
