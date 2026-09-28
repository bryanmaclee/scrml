# Footprint grade — bootstrap M3 item 3 (ingest shim), 2026-09-27 — FIX ROUND 1

**Command:** `bun scripts/hybrid.ts --swap CG=compiler/self-host-v2/slice-m3/substitute.js --footprint --report <this file>`
**Exit code: 0.** Wall time ~9 s (the full 1047-case grade).
**Certification:** `bun compiler/self-host-v2/slice-m3/bench/bite-matrix.js`. Exit 0, wall time ~146 s. The table is in
`bite-matrix-2026-09-27.md`.

## Headline

- **17 RUNTIME passes of 17 graded runtime-half cases.**
- **32 constructs CERTIFIED, 0 UNCERTIFIED.** A construct counts as implemented only if corrupting it kills at least one
  runtime pass.
- The 10 codes-only passes are listed separately. Every code they assert comes from impl#1's front end, and the
  substitute returns `errors: []`, so they are **not bootstrap evidence**. They never count toward certification.

## What changed from round 0 (29 graded, 27 pass, 2 fail)

- **Classification.** FRONT-END now means impl#1's front end rejects the program with an error-severity diagnostic.
  It no longer keys on the `E-` prefix. A case that requires a code the front end does not emit is now NOT-YET, with the
  reason "expects code X, not emitted by impl#1's front end (CG/post-CG)". FRONT-END went from 471 to 447.
  - `reactive/derived-no-dep-warn` expects `W-DERIVED-001`, which impl#1's CG emits. It moved from fail to NOT-YET, and
    the code is on the substitute's queue.
  - `reactive/dg-002-no-readers-pos` expects E-DG-002 at warning severity. It is now graded as codes-only.
- **Hoisted lists.** A hoisted `components` / `typeDecls` / … list is never a silent "known" key. The two
  `components/*-clean` cases that previously passed on an empty Core are now NOT-YET.
- **toggle-show.** It was a case defect. The normalizer now drops impl#1's private `<template id="_scrml_…">`
  anchor, and the case's `dom` is the semantic tree. It is now a runtime PASS, and it is the positive evidence for
  `View.Cond`.
- **reset-handler.** Its asserted end state is now 1, which differs from the initial state. A no-op handler or write
  now kills it.

---

# Footprint grade — CG=compiler/self-host-v2/slice-m3/substitute.js

Cases graded or classified: **1047 of 1047** case directories found by an independent enumeration.

**Headline: 17 RUNTIME passes of 17 graded runtime-half cases** (0 fail).

| bucket | cases |
|---|---|
| GRADED, runtime half — pass | 17 |
| GRADED, runtime half — fail | 0 |
| GRADED, codes-only — pass (front-end codes — NOT bootstrap evidence) | 10 |
| GRADED, codes-only — fail | 0 |
| — of which xfail (impl1-ts mark, failing as recorded) | 0 |
| — of which xpass (reported, not red) | 0 |
| CRASHED in footprint() (counted in the fails above) | 0 |
| NOT-YET (footprint outside the implemented set, or expects a CG-emitted code — never red) | 573 |
| FRONT-END (impl#1's front end rejects the program — bootstrap analyze's queue, not graded) | 447 |
| graded cases run by the conformance runner | 27 of 27 |

## Constructs exercised by passing RUNTIME cases (candidates — certified only by the bite matrix)

`Attr.On` · `Attr.Static` · `Block` · `Decl` · `EditKind.Replace` · `Expr.Call` · `Expr.Lit.Bool` · `Expr.Lit.Int` · `Expr.Lit.Str` · `Expr.Local` · `Expr.Prim.Add` · `Expr.Prim.Concat` · `Expr.Prim.Gt` · `Expr.Prim.Mul` · `Expr.Prim.Not` · `Expr.Read` · `Field.Derived` · `Field.Let` · `Fn` · `InstRef.Lexical` · `InstRef.Shared` · `Place.Cell` · `Program` · `Stmt.Eval` · `Stmt.If` · `Stmt.Let` · `Stmt.Return` · `Stmt.Write` · `View.Cond` · `View.Dyn` · `View.El` · `View.Text`

## Fail list (first diverging reason per case)

(none)

## Passing RUNTIME cases

- `block-grammar/block-028-leading-equals-text-pos`
- `control-flow/s437-r5-braced-else-block-comment-fn`
- `control-flow/s437-r5-braced-else-if-chain-comments-fn`
- `control-flow/s437-r5-braced-else-line-comment-fn`
- `control-flow/s437-r5-braced-else-ownline-comment-fn`
- `defer/identifier-untouched`
- `derived/chain`
- `derived/diamond`
- `reactive/counter-increment`
- `reactive/decl-needs-initializer-neg`
- `reactive/derived-doubled`
- `reactive/if-top-level-absent`
- `reactive/multi-cell-interp`
- `reactive/name-collides-state-neg`
- `reactive/reset-handler`
- `reactive/textarea-rcdata-value-bind`
- `reactive/toggle-show`

## Passing codes-only cases (front-end codes — NOT bootstrap evidence; never count toward certification)

- `auth/i-auth-redirect-unresolved-neg`
- `auth/w-auth-content-not-gated-neg`
- `auth/w-auth-login-missing-neg`
- `markup-handler/multi-stmt-handler-attr-neg`
- `module/e-use-001-use-toplevel-clean`
- `module/e-use-002-use-before-markup-clean`
- `module/e-use-005-use-good-prefix-clean`
- `reactive/dg-002-no-readers-neg`
- `reactive/dg-002-no-readers-pos`
- `type-state-codes/e-state-undeclared-neg`

## Top not-yet reasons by case count (the M3/M4 work queue) — 183 distinct

| cases | reason |
|---|---|
| 217 | file carries unmapped key `typeDecls` |
| 215 | decl: type-decl |
| 215 | top-level `${}` carries unmapped key `typeDecls` |
| 176 | decl: a cell whose type the shim cannot infer from its initializer |
| 103 | decl: a cell annotated with a non-primitive type |
| 101 | expr: free identifier (not a local or parameter) |
| 96 | expr: missing structured `initExpr` |
| 92 | expr: array |
| 87 | program: `<program db=…>` |
| 80 | file carries unmapped key `machineDecls` |
| 80 | markup: engine-decl |
| 75 | stmt: write to a name that is not a program cell |
| 70 | expr: `@` name that is not a program cell |
| 67 | markup: each-block |
| 52 | decl: unannotated parameter (Core parameters are typed, D14) |
| 47 | expr: member access (other than `.length` of a string or sequence) |
| 46 | markup: element synthesized after name resolution (component expansion / meta emit) |
| 44 | markup: state |
| 42 | cell declaration carries unmapped key `children` |
| 41 | markup: match-block |
| 37 | function carries unmapped key `hasReturnType` |
| 37 | function carries unmapped key `returnTypeAnnotation` |
| 36 | top-level `${}` carries unmapped key `components` |
| 34 | decl: failable function (`!`) |
| 34 | function carries unmapped key `errorType` |
| 29 | expr handler carries unmapped key `handlerBlock` |
| 29 | return-stmt carries unmapped key `__enclosingFnCanFail` |
| 27 | markup: <page> (unknown) |
| 26 | stmt: fail-expr |
| 23 | decl: import-decl |
| 23 | file carries unmapped key `imports` |
| 23 | top-level `${}` carries unmapped key `imports` |
| 21 | decl: parameter of a non-primitive type |
| 21 | program: `<program auth=…>` |
| 21 | return-stmt carries unmapped key `sqlNode` |
| 20 | file carries unmapped key `authConfig` |
| 20 | stmt: defer-stmt |
| 19 | cell declaration carries unmapped key `isServer` |
| 19 | expr: call of a function that is not a program function |
| 19 | markup: <signup> (unknown) |

## Cases ONE reason away from graded (by that reason)

| cases | the one reason |
|---|---|
| 10 | file: a multi-file program (imports) |
| 6 | attr: `bind:` directive |
| 5 | markup: css-inline |
| 5 | program: `<program capabilities=…>` |
| 5 | markup: element synthesized after name resolution (component expansion / meta emit) |
| 4 | markup: <page> (unknown) |
| 4 | markup: `${}` block containing if-stmt |
| 4 | stmt: defer-stmt |
| 4 | markup: <outlet> (unknown) |
| 4 | cell declaration carries unmapped key `reactivity` |
| 3 | markup: if-chain |
| 3 | decl: let-decl |
| 3 | decl: `@x = v` declaration form |
| 2 | top-level `${}` carries unmapped key `components` |
| 2 | decl: if-stmt |
| 2 | markup: `${}` block containing function-decl |
| 1 | markup: `${}` block containing let-decl |
| 1 | markup: <pre> (unknown) |
| 1 | attr: value kind props-block |
| 1 | stmt: for-stmt |
| 1 | markup: <keyboard> (unknown) |
| 1 | stmt: expression statement lambda |
| 1 | decl: const-decl |
| 1 | expects code W-DERIVED-001, not emitted by impl#1's front end (CG/post-CG) |
| 1 | cell declaration carries unmapped key `defaultExpr` |
| 1 | expr: template literal with interpolation |
| 1 | markup: theme-decl |
