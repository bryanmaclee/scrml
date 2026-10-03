# s449-bootstrap-form-validity — progress (append-only)

## 1. Core + runtime surface + the submit gate (child fields)

- **Core** (`core.scrml`): `Validator` (Req / LengthCmp / Min / Max / Pattern) and `Field.vals`;
  `SurfaceProp`, `ValidityOf` (OfField / OfDecl), `Expr.Validity` (a read — read-only by
  construction: no write capability names a surface), `Stmt.ResetSurface` (the surface half of
  `reset(@x)`), `Attr.Gate(values)` (the §55.17.3 gate on a gated `<form>`; `values` = the
  §55.17.6 names), `View.Errors(of, all)` (§55.8). `walk` / `measure` / `check` / `print` /
  `lower` / `ingest` total over them.
- **check** C14 (a surface resolves to its declaration; a program field has one only with
  validators; a compound only on a user declaration; `errors` only through `<errors>`), C15 (a
  Gate only on a `form`, once).
- **runtime** (`slice-m1/runtime/runtime.js`): `check.*` validators, `validity(inst, i)` (lazy
  per-field record: errors Derived, touched Cell, submitted = own for a top-level value, the
  instance's for a user declaration's field), `compound(inst)`, `errors(...)` (the `<errors>`
  view), `gate(scope, form)`; `bind(..., surface)` marks touched (change + first focus-out) and
  registers the control with the gate.
- **analyze**: `ValInfo.core` (each admitted validator as Core carries it); `Tables.gated`
  (`GateInfo { form, values }`) — every `<form>` whose composed subtree binds a validated value,
  author-written `novalidate` or not (S447 gate-calls item 1).
- **lower**: `Field.vals`; `Attr.Gate` first among a gated form's attributes, then `novalidate`.
- **Gate placement reading (agent, PA to confirm)**: which values gate a given submit is decided
  on the LIVE form — the controls inside it whose `bind:` targets a validated value. A static list
  could not name the instance a use / an `<each>` row / a slot renders. Consequence: a control not
  currently rendered (an `if=` region that is closed) does not gate — HTML's own constraint
  validation has the same reach.
- Test: `slice-m4/gate.test.js` — invalid → no submit + defaultPrevented; valid → submit;
  formnovalidate bypass; requestSubmit() gated; BITE: the same Core with the Gate stripped runs
  `save()` on `""`.
