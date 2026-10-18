# s469-value-form-if-for-failable — progress

Security fix (§19.4.3, E-ERROR-002 fail-open). Base: origin/main a74a32eca.

## Hole
A value-form `if` / `for` on a declaration (`const ok = if (c) { lift … } else { lift … }`,
`const vs = for (x of xs) { lift f(x) }`) is carried as `ifExpr` / `forExpr` with `init: ""`
(ast-builder.js, let/const in parseOneStatement and in the body loop). `failable-value-calls.ts`
never read either key (`isExprNodeValue` rejects `if-expr` / `for-expr`; neither is a
STATEMENT_CHILD_KEY), and type-system's `visitNode` descends only array-valued keys, so the
condition, the body statements and the `lift` operands were never checked. The walk did not read
a `lift-expr` anywhere either (its `expr` is a `{kind:"expr"}` wrapper), so a rendered
`${ for (…) { lift check(x) ? "LOGGED IN" : "rejected" } }` also got through.

Reproduced on base: all 8 brief repros compile clean (wrong password -> LOGGED IN). These also got
through on base: `const { ok = check(p) } = {}` (destructuring default; the decl `name` pattern was
never read), a bare call / nested `if` inside a value-form body, and the top-level rendered `for` lift.

## Fix (log)
- WIP 1: the walker reads `ifExpr` / `forExpr` as statements (condition / iterable as values,
  bodies as statements). A `lift-expr` operand is a value position, and its `!{}` guard handles it.
  `lift-expr` was added to VALUE_POSITION_STMT_KINDS (main walk). A failable fn read as a VALUE in a
  lift operand is refused (`refKind: "fn-value"`). E-IMPL1-FAILABLE-FN-VALUE does NOT exist on
  main (it lands with #1444), so per the brief the read is refused with E-ERROR-002 (fn-value wording).
- Decl keys are classified (`DECL_KEY_CLASSES`). An unclassified key is read conservatively in
  full (`opaque`), so it fails closed.
