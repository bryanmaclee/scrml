# g-attr-if-fn-call-misroute — SCOPE (S191, 2026-06-13)

**Gap:** `g-attr-if-fn-call-misroute` (MED, filed S188 cluster-A Phase-2, DEFERRED).
**Severity-shape:** silent-wrong-behavior on a core surface (`if=`).
**Disposition:** RULED build-it (approach a) — route `if=fn()` as a reactive conditional. User S191 ("g-attr build it" → "Proceed — close it cheap" after the survey reversal).

## The bug (R26-confirmed on HEAD 7ba053e6)

`<p if=isVisible()>` (a bare-CALL condition) compiles clean but the element **always renders**: the
`call-ref` value branch in `emit-html.ts:1761` unconditionally routes to `addEventBinding` for ANY
attribute name (it has only a `SERVER_ONLY_CALL` guard, no condition-attr gate). Emitted client.js:
`el.addEventListener("if", _scrml_if_handlers[id])` + `data-scrml-bind-if=…` with **no conditional
render logic** — `isVisible()` is wired as a nonexistent "if" DOM event, never used as a predicate.
No diagnostic.

Confirmed reproducer (`/tmp/g-attr-repro/repro.scrml`): `if=isVisible()` → `addEventListener("if",…)`;
`if=(isVisible())` + `if=@count` → correct `_scrml_effect`-wrapped mount/unmount conditionals.

## SPEC basis (Rule 4)

**§5.1 line 1352 (cluster-A normative, S188):** an unquoted *condition* attribute value — `if=`
(§17.1), `show=` (§17.2), `else-if=` (§17.1.1) — "admits ONLY the atomic forms: an identifier
reference (`@var`/`obj.prop`), **a call (`fn()`)**, or a prefix-`!` negation." So `if=fn()` is a
**spec-valid condition form** that SHALL render conditionally. The current event-binding routing
directly violates §5.1. No new error code — it should just work.

## Survey reversal (the fix is SMALL, not interprocedural)

The filed gap's premise ("requires inter-procedural reactive analysis of the function body; a bare
call carries no `@`-refs so a naive condExpr renders-once-never-updates") is a **misdiagnosis**:

1. **The runtime `_scrml_effect` does dynamic dependency tracking.** The conditional calls the function
   INSIDE the effect (`_scrml_effect(function(){ if (isVisible()) … })`), so whatever cells the fn
   reads (`_scrml_reactive_get("count")`) auto-subscribe at runtime. Zero compile-time read-set
   analysis. The paren form `if=(isVisible())` already works exactly this way (and is the gap's own
   stated workaround).
2. **The conditional codegen already handles empty refs.** `emit-event-wiring.ts:947` carries an
   explicit `FIX(IS-VARIANT-ATTR)` comment — "condExpr is valid even when refs is empty — emit the
   condition unconditionally"; the effect emission gates on `subscribeVars !== undefined` (NOT
   `.length > 0`). A bare call has no `@`-refs → exactly that case, already covered.

**Therefore the fix = a routing change in `emit-html.ts`'s `call-ref` branch, reusing the existing
conditional codegen. The runtime reactivity falls out of the existing `_scrml_effect`.**

## The fix (one locus)

`compiler/src/codegen/emit-html.ts` — the `call-ref` value branch (~1761). Add a leading guard
mirroring the `expr` branch directly above it (1707-1723):

```
} else if (val.kind === "call-ref") {
  if (name === "if" || name === "show") {
    // §5.1 line 1352: a bare call fn() is a valid atomic CONDITION form → route as a
    // reactive conditional, NOT an event binding. Mirror the val.kind==="expr" if/show branch.
    const placeholderId = genVar(`attr_${name}`);
    const dataAttr = name === "show" ? "data-scrml-bind-show" : "data-scrml-bind-if";
    parts.push(` ${dataAttr}="${placeholderId}"`);
    if (registry) {
      const condRaw = `${val.name}(${(val.args ?? []).join(", ")})`;       // e.g. "isVisible()" / "check(@x, 5)"
      registry.addLogicBinding({
        placeholderId,
        expr: condRaw,
        ...(name === "show" ? { isVisibilityToggle: true } : { isConditionalDisplay: true }),
        condExpr: condRaw,
        condExprNode: <synthesized CallExpr OR undefined-with-raw-fallback — see note>,
        refs: <extracted from val.argExprNodes, or [] — empty is fine per the IS-VARIANT-ATTR gate>,
        ...(transitionEnter ? { transitionEnter } : {}),
        ...(transitionExit ? { transitionExit } : {}),
      });
    }
  } else {
    ...existing addEventBinding path (unchanged — on*, etc.)...
  }
}
```

- **Scope = `if=` + `show=` only** (the predicate the expr branch uses at 1708). `else-if=` is
  if-chain-handled on a separate path and is NOT handled by the expr branch here either — leave it
  out (if the agent finds `else-if=fn()` ALSO reaches branch 1761 with a call-ref and mis-routes,
  fix it the same way; otherwise file a one-line follow-up note, don't expand scope).
- **`condExprNode`:** prefer synthesizing a `call` ExprNode (`{kind:"call", callee:{kind:"ident",
  name: val.name}, args: val.argExprNodes ?? []}`) so `emitExprField` + ref-extraction work
  identically to the expr branch. If raw-string fallback in `emitExprField(undefined, condRaw)` is
  verified to emit correct client JS, undefined is acceptable. Agent picks the cleaner of the two
  after reading `emitExprField`.
- **No new error code, no diagnostic** — `if=fn()` is spec-valid; it just compiles to the right thing.
- **ZERO change to the event-binding path** for non-condition attrs (the `else` keeps it intact).

## Tests (unit + a control regression)

- `if=fn()` → emits `data-scrml-bind-if` + an `_scrml_effect`-wrapped conditional that calls `fn()`;
  asserts `addEventListener("if"` is ABSENT.
- `show=fn()` → emits `data-scrml-bind-show` conditional (isVisibilityToggle); not event-bound.
- `if=fn(@x)` (call with a reactive arg) → conditional; the arg expr present in conditionCode.
- **Control regression:** `if=(fn())` (paren) + `if=@count` (varref) still emit conditionals (unchanged).
- A non-condition control: `onclick=fn()` STILL event-binds (the `else` path is untouched).

## R26 empirical verify (Phase 3 — MANDATORY, S138 codegen-fix doctrine)

Re-compile the reproducer (and/or a real adopter source) on the post-fix baseline; assert:
- `addEventListener("if"` is GONE from the emitted client.js for the `if=fn()` site.
- a `_scrml_effect`-wrapped conditional calling the fn is present (mount/unmount or display-toggle).
- `node --check` clean on the emitted JS.

## Out of scope
- `else-if=fn()` (chain-path) unless it demonstrably reaches branch 1761 (then same fix).
- Impure-`function`-in-condition footgun (a `function` with side effects re-runs them every reactive
  tick) — pre-existing for the expr form too; note as a candidate, don't address here.
- Any change to event-binding for `on*` attrs.
