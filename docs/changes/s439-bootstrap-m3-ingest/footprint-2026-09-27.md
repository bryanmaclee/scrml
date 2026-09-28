# Footprint grade — bootstrap M3 item 3 (ingest shim), 2026-09-27

**Command:** `bun scripts/hybrid.ts --swap CG=compiler/self-host-v2/slice-m3/substitute.js --footprint --report <this file>`
**Tree:** branch tip `862102be3` (s439-bootstrap-m3-ingest) · **Exit code: 1** (a GRADED case failed — 2 of 29; see the fail list).

**What is graded:** a case whose ingested Core footprint lies within the implemented set, run through the UNCHANGED
conformance runner (`evaluateCase`: codes half + runtime half) with CG = ingest → Core → bootstrap printer, executed on
the bootstrap runtime (`slice-m1/runtime/runtime.js`). NOT-YET cases are never red. FRONT-END cases (the program is
rejected: an expected E- code, or impl#1's front end reports an error) are not graded: their codes are impl#1's front
end's, not the substitute's — they are bootstrap `analyze`'s queue. Codes-only graded cases exercise the substitute
only as "ingests, checks, prints, emits no stray code"; the 17 runtime-half cases are the real evidence.

**The two fails, classified:**
- `reactive/derived-no-dep-warn` — **real bootstrap gap.** `W-DERIVED-001` (a `const` that reads no cell) is emitted by
  impl#1's CODEGEN (`codegen/emit-logic.ts`). The bootstrap Core records the fact (`Field.Locked`, not `Derived`) but no
  bootstrap pass reports the lint. Owner: bootstrap `analyze` (in the S233 re-cut it is a front-end fact).
- `reactive/toggle-show` — **case defect, not a bootstrap defect.** The case's whole-tree `dom` contract bakes impl#1's
  internal `<template id="_scrml_scrml_tpl_2"></template>` marker; the bootstrap renders the semantically identical DOM
  without it (the same case's anchored assertion passes). `conformance/normalize.ts` strips comments, `<script>` and
  `data-scrml-*`, but not impl-private `<template>` elements. The fix belongs to the corpus or the normalizer (D3: the
  dom contract must be impl-neutral) — surfaced, not changed here.

**Proof the graded passes EXECUTE the bootstrap's output:** `print.scrml`'s `View.Dyn` hole was corrupted to print the
constant `"CORRUPT"` and the grade re-run: runtime-half passes went **16 → 2** (14 turned RED, each reporting
`got "CORRUPT"` or a dom mismatch). The two survivors contain no `Dyn` hole (`block-grammar/block-028-leading-equals-text-pos`
is static text; `reactive/if-top-level-absent` is a `Cond` whose arm is never taken). Restored; tree clean.

**Reading the not-yet table:** a reason is a legacy shape (or an impl#1 key on a mapped node) the shim does not map to
Core yet; a case can carry several. "carries unmapped key `k`" is the mechanized never-guess rule: the node kind is
mapped, but impl#1 carries a fact (`k`) the mapping does not account for. Counts cover every not-yet case (runtime and
codes-only).

---

# Footprint grade — CG=compiler/self-host-v2/slice-m3/substitute.js

Cases considered: **1047 of 1047** (a smaller first number means the run was truncated).

| bucket | cases |
|---|---|
| GRADED | 29 (runtime half 17 · codes-only 12) |
| — pass | 27 (runtime-half cases 16) |
| — fail | 2 |
| — xfail (impl1-ts mark, still failing as recorded) | 0 |
| — xpass (reported, not red) | 0 |
| NOT-YET (footprint outside the implemented set — never red) | 547 |
| FRONT-END (rejected program: expected E- code or impl#1 error — bootstrap analyze's queue, not graded) | 471 |
| graded cases run by the conformance runner | 29 of 29 |

## Implemented construct set (union of the graded cases' Core footprints)

`Attr.On` · `Attr.Static` · `Block` · `Decl` · `EditKind.Replace` · `Expr.Call` · `Expr.Lit.Bool` · `Expr.Lit.Int` · `Expr.Lit.Str` · `Expr.Local` · `Expr.Prim.Add` · `Expr.Prim.Concat` · `Expr.Prim.Gt` · `Expr.Prim.Mul` · `Expr.Prim.Not` · `Expr.Read` · `Field.Derived` · `Field.Let` · `Field.Locked` · `Fn` · `InstRef.Lexical` · `InstRef.Shared` · `Place.Cell` · `Program` · `Stmt.Eval` · `Stmt.If` · `Stmt.Let` · `Stmt.Return` · `Stmt.Write` · `View.Cond` · `View.Dyn` · `View.El` · `View.Text`

## Fail list (first diverging reason per case)

- `reactive/derived-no-dep-warn` — missing required codes: ["W-DERIVED-001"] (emitted ["E-DG-002"])
- `reactive/toggle-show` — runtime: dom (whole-tree) mismatch: ⏎ expected: "<button id=\"toggle\">Toggle</button><template id=\"_scrml_scrml_tpl_2\"></template><p id=\"panel\">Panel open</p>" ⏎ got:      "<button id=\"toggle\">Toggle</button><p id=\"panel\">Panel open</p>"

## Passing graded cases

- `auth/i-auth-redirect-unresolved-neg` (codes-only)
- `auth/w-auth-content-not-gated-neg` (codes-only)
- `auth/w-auth-login-missing-neg` (codes-only)
- `block-grammar/block-028-leading-equals-text-pos`
- `components/bind-non-primitive-type-clean` (codes-only)
- `components/malformed-component-body-clean` (codes-only)
- `control-flow/s437-r5-braced-else-block-comment-fn`
- `control-flow/s437-r5-braced-else-if-chain-comments-fn`
- `control-flow/s437-r5-braced-else-line-comment-fn`
- `control-flow/s437-r5-braced-else-ownline-comment-fn`
- `defer/identifier-untouched`
- `derived/chain`
- `derived/diamond`
- `markup-handler/multi-stmt-handler-attr-neg` (codes-only)
- `module/e-use-001-use-toplevel-clean` (codes-only)
- `module/e-use-002-use-before-markup-clean` (codes-only)
- `module/e-use-005-use-good-prefix-clean` (codes-only)
- `reactive/counter-increment`
- `reactive/decl-needs-initializer-neg`
- `reactive/derived-doubled`
- `reactive/dg-002-no-readers-neg` (codes-only)
- `reactive/if-top-level-absent`
- `reactive/multi-cell-interp`
- `reactive/name-collides-state-neg`
- `reactive/reset-handler`
- `reactive/textarea-rcdata-value-bind`
- `type-state-codes/e-state-undeclared-neg` (codes-only)

## Top not-yet reasons by case count (the M3/M4 work queue) — 145 distinct

| cases | reason |
|---|---|
| 212 | decl: type-decl |
| 170 | decl: a cell whose type the shim cannot infer from its initializer |
| 101 | decl: a cell annotated with a non-primitive type |
| 99 | expr: free identifier (not a local or parameter) |
| 90 | expr: missing structured `initExpr` |
| 89 | expr: array |
| 80 | markup: engine-decl |
| 80 | program: `<program db=…>` |
| 72 | stmt: write to a name that is not a program cell |
| 69 | expr: `@` name that is not a program cell |
| 66 | markup: each-block |
| 51 | decl: unannotated parameter (Core parameters are typed, D14) |
| 45 | expr: member access (other than `.length` of a string or sequence) |
| 44 | markup: element synthesized after name resolution (component expansion / meta emit) |
| 40 | markup: match-block |
| 40 | markup: state |
| 39 | cell declaration carries unmapped key `children` |
| 36 | function carries unmapped key `hasReturnType` |
| 36 | function carries unmapped key `returnTypeAnnotation` |
| 34 | decl: failable function (`!`) |
| 34 | function carries unmapped key `errorType` |
| 29 | expr handler carries unmapped key `handlerBlock` |
| 29 | return-stmt carries unmapped key `__enclosingFnCanFail` |
| 27 | markup: <page> (unknown) |
| 26 | stmt: fail-expr |
| 23 | decl: import-decl |
| 21 | decl: parameter of a non-primitive type |
| 21 | program: `<program auth=…>` |
| 20 | stmt: defer-stmt |
| 19 | cell declaration carries unmapped key `isServer` |
| 19 | expr: call of a function that is not a program function |
| 19 | markup: <signup> (unknown) |
| 19 | return-stmt carries unmapped key `sqlNode` |
| 19 | stmt: guarded-expr |
| 18 | if-stmt carries unmapped key `__enclosingFnCanFail` |
| 17 | local declaration carries unmapped key `sqlNode` |
| 16 | decl: let-decl |
| 16 | markup: <channel> (scrml-lifecycle) |
| 16 | stmt: sql |
| 13 | decl: server function |

## Cases ONE reason away from graded (by that reason)

| cases | the one reason |
|---|---|
| 28 | markup: element synthesized after name resolution (component expansion / meta emit) |
| 10 | file: a multi-file program (imports) |
| 6 | decl: type-decl |
| 6 | attr: `bind:` directive |
| 5 | markup: css-inline |
| 5 | program: `<program capabilities=…>` |
| 4 | markup: <page> (unknown) |
| 4 | markup: `${}` block containing if-stmt |
| 4 | stmt: defer-stmt |
| 4 | markup: <outlet> (unknown) |
| 4 | cell declaration carries unmapped key `reactivity` |
| 3 | markup: if-chain |
| 3 | decl: let-decl |
| 3 | decl: `@x = v` declaration form |
| 2 | program: `<program auth=…>` |
| 2 | decl: if-stmt |
| 2 | markup: `${}` block containing function-decl |
| 1 | markup: `${}` block containing let-decl |
| 1 | markup: <pre> (unknown) |
| 1 | markup: <channel> (scrml-lifecycle) |
| 1 | attr: value kind props-block |
| 1 | stmt: for-stmt |
| 1 | markup: <keyboard> (unknown) |
| 1 | stmt: expression statement lambda |
| 1 | program: `<program ratelimit=…>` |
| 1 | decl: const-decl |
| 1 | cell declaration carries unmapped key `defaultExpr` |
| 1 | expr: template literal with interpolation |
| 1 | markup: `${}` block containing type-decl |
| 1 | markup: theme-decl |
