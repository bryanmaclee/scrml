# S385 — gap drafts for `known-gaps.md`

Drafted here for the PA to file. `known-gaps.md` is PA-owned; this dispatch does
not write it. Both gaps were REPRODUCED on this branch, not inferred.

---

## GAP-S385-EACH-KEY-DESTRUCTURE — `<each as (k,v) key=k>` emits a ReferenceError + TDZ

**Severity:** high — clean compile, guaranteed crash on first render.
**Stage:** codegen (`compiler/src/codegen/emit-each.ts`).
**Found:** S385 round 3, while re-reviewing a test that was ASSERTING this shape
compiles clean. The assertion was pinning the crash.

### Reproducer

```scrml
<program>
  <m> = { a: 1, b: 2 }
  <each in=@m.entries() as (k, v) key=k><li>${k}: ${v}</li></each>
</program>
```

Compiles **exit 0, zero diagnostics**. Emitted client JS:

```js
_scrml_reconcile_list(
  _mount,
  _items,
  (_scrml_each_item, _scrml_each_idx) => k,      // (1) `k` is FREE -> ReferenceError
  (_scrml_each_item, _scrml_each_idx) => {
    const _itemFrag = document.createDocumentFragment();
    const _scrml_each_key_1 = k;                 // (2) read here...
    const k = _scrml_each_item.key;              //     ...declared AFTER -> TDZ
    const v = _scrml_each_item.value;
```

Two independent fires. (1) is a `ReferenceError: k is not defined` from the key
function on the first reconcile. (2) is a `ReferenceError: Cannot access 'k'
before initialization` in the item factory.

### Root cause

`emit-each.ts`:

| line | what |
|---|---|
| ~3160 | `const keyFnBody = resolveKeyFnBody(node, iterVarName, iterIdxName);` |
| ~3164 | `(${iterVarName}, ${iterIdxName}) => ${keyFnBody},` — standalone key fn |
| ~3172 | `const ${_eachKeyVar} = ${keyFnBody};` — inside the item factory |
| ~3184 | `emitDestructureBindingLines(destructure, iterVarName, …)` — bindings emitted |

`keyFnBody` is computed and consumed **before** the `as (k, v)` destructure
bindings exist. The key fn's parameters are `(iterVarName, iterIdxName)` —
`_scrml_each_item` / `_scrml_each_idx` — so a `key=` expression naming a
destructure local closes over nothing.

### Scope — narrow

Requires `key=` to REFERENCE a destructure name. Verified: with `as (k, v)` and no
`key=`, the default key expression (`item?.id != null ? item.id : idx`) never
mentions `k`/`v` and the same source emits correctly. Single-name `as r` with
`key=r.id` is also fine — `r` IS `iterVarName`, so it is the fn's own parameter.

### Why it was not fixed in S385

Not a line move, which was the bar set for touching codegen in a type-system
dispatch. Reordering `emitDestructureBindingLines` above line 3172 fixes fire (2)
only. Fire (1) needs the standalone arrow to gain a **block body** carrying the
bindings —

```js
(_scrml_each_item, _scrml_each_idx) => {
  const k = _scrml_each_item.key;
  const v = _scrml_each_item.value;
  return k;
}
```

— or the key expression rewritten against `_scrml_each_item.key`. Either is an
emitted-shape change, so the differential is not byte-identical and it wants its
own landing plus its own emitted-output review.

### Test anchor

`compiler/tests/unit/each-opener-expr-undeclared-read.test.js` §5 carries a
`test.todo` naming this gap, sited exactly where the bad assertion used to be so
it cannot be silently reinstated.

### NOT a type-system bug

`k` is genuinely in scope for `key=` — S385's scope check is correct to accept it
(that is ORDERING TRAP C in the same file). Do not "fix" this by rejecting the
shape in the typer; the shape is legal and the lowering is wrong.

---

## GAP-S385-EACH-ITER-SHAPE-UNFIRED — `E-EACH-ITER-SHAPE` is cited but never implemented

**Severity:** medium — a malformed `<each>` opener compiles silently.
**Stage:** PASS / type-system (nothing owns it today).

### Reproducer

```scrml
<program>
  <rows> = [1, 2, 3]
  <each in=@rows of=@somethingElse as r><li>${r}</li></each>
</program>
```

Compiles **exit 0**, zero diagnostics. `of=` is silently discarded.

Both-absent (`<each as r>`, neither `in=` nor `of=`) is the other half of the same
missing check.

### The false backstop

`compiler/src/ast-builder.js:16911` states:

> Exactly one of in=/of= is required at the type-system layer; ast-builder records
> what was present and downstream PASS / TS surfaces missing-or-both as
> **E-EACH-ITER-SHAPE** (added §34 row at step 9 of this dispatch).

That code does not exist:

```
$ grep -rn E-EACH-ITER-SHAPE compiler/src compiler/native-parser compiler/tests
compiler/src/ast-builder.js:16911:   ... as E-EACH-ITER-SHAPE (added §34 row at
compiler/native-parser/parse-file.js:1029:   ... missing-or-both as E-EACH-ITER-SHAPE.
```

Two comments, zero implementation, zero tests. `iterShape` tie-breaks to `"in"`
(`ast-builder.js:16917`) and `emit-each.ts` lowers `in=` only, so the `of=` text is
dead but unreported.

### Interaction with S385

S385 gates its opener-expression scope check on `iterShape`, so it deliberately
does NOT report an undeclared cell inside a dead `of=` — naming a typo in text the
compiler is about to discard points away from the real mistake. That is an
under-fire chosen over a misleading over-fire, and it is pinned by §6 of the test
file with a comment saying so. Closing THIS gap is what makes that choice free.

### Also worth checking when this is filed

Whether `E-EACH-ITER-SHAPE` was ever added to the §34 diagnostic table in SPEC.md.
If SPEC lists it, the SPEC and the implementation disagree and SPEC wins (Rule 4).
If SPEC does not list it, the comments are citing a code that was designed and
never landed.

---

## Surfaced, lower priority (not drafted as formal gaps)

- **A failed compile still writes artifacts.** `scrml compile` exits 1 on an
  undeclared read but still writes `.client.js` / `.html` / `.css` / runtime,
  including JS that throws on load. Exit code gates CI; a dev server or a
  stale-artifact consumer may not be.
- **`key=${…}` is not a lowerable form.** `<each in=@rows as r key=${@a}>` with
  `@a` DECLARED fails `E-CODEGEN-INVALID-LOGIC`. Confirmed pre-existing by
  stashing the S385 change and re-running. The `${…}` unwrapping S385 inherited
  from the `<match on=>` precedent is therefore handling a shape codegen cannot
  lower on `<each>` anyway — harmless, but the two should agree eventually.
- **Interpolated attribute values are not scope-checked** —
  `<div class="c-${@undeclared}">` compiles clean. Same SPEC §6.1.2 sentence,
  different path (attribute interpolation, not structural opener).
- **`E-SCOPE-001` attribute message mis-suggests** — advises `@@name` when the
  value already starts with `@`.
