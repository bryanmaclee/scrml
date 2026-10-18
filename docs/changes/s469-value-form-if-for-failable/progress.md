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
- WIP 1 committed (hook: 37629 pass / 0 fail / 125 skip).
- EXECUTED the "handled" value forms and found two codegen miscompiles that made trusting them
  fail open:
  (a) `lift check(p) !{ … }` lowers the guard against `_scrml_lift(...)`'s result, not the call's.
      In a value-form `for` a wrong password LOGGED IN; in a value-form `if` a right one was rejected.
  (b) a `match check(p) { … }` inside a value-form body is lowered as a plain-value match
      (`_scrml_match === "Denied"`). The cause: TS `visitNode` never visits value-form bodies, so
      `__matchSubjectFailable` is never stamped. Executed: a wrong password logged in. The same
      match in a statement-form body is fine.
  Both are now refused (`refKind: "lift-guard"`, everywhere; `FnCtx.inValueForm`: no match head or
  arm `?` is trusted inside a value-form body; `<errorBoundary>` does not exempt a call there).
  A statement `!{}` and `?` inside a value-form body were EXECUTED and are correct, so they stay
  handlers.
- WIP 2 committed (hook: 37668 pass / 0 fail / 125 skip). New pack: 39 tests.
- CORPUS (scripts/corpus-emit-differential.ts; roots examples, samples, conformance/cases, stdlib;
  base = git archive of origin/main a74a32eca; head = 08bc1716): 2851 / 2851 sources; compile
  1705 ok / 1146 failed on BOTH; failure-set delta 0 / 0; diagnostic changes 0 code / 0 text.
  171 artifact diffs, all `*.server.js`, and each differs only in the embedded
  `_scrml_project_root` path (archive dir vs worktree), so there are no client artifact diffs.
  => newly-rejecting: 0 corpus sites. ("NOT A VALID COMPARISON" is printed only because the base
  is an archive, so its git rev-parse is unknown.)
- known-gaps: there was no entry for this hole, so it is filed RESOLVED
  (`g-value-form-if-for-failable-call-unchecked-s469`). Also filed:
  `g-value-form-body-not-visited-by-type-system-s469` (HIGH, open; executed: `lift nosuchname` and
  `const q: number = "str"` inside a value-form body compile clean, and the other TS checks there
  are unaudited) and `g-lift-guard-applied-to-lift-not-call-s469` (MED, open, refused).
  Regenerated with `bun scripts/state.ts --write` and `bun scripts/facts.ts --write`; both `--check`
  PASS, and spec-index `--check` PASS. No SPEC edit.

## Not closed (residuals)
- Lifted MARKUP / SQL in a value-form body is not read by this walk
  (`g-lift-markup-failable-call-unchecked-s468`, already open).
- A lift operand that is neither an expression nor a statement list the front-end parses is
  skipped (a compile error elsewhere in every case tried).
- `fnValueRefs` does not read template-literal interpolation text (`lift \`${check}\``), which
  stringifies the function, so it is not a call path.
