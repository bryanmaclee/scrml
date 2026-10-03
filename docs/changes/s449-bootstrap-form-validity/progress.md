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
- Landed `fa7abce52`; full pre-commit gate 29857 pass / 58 skip / 12 todo / 0 fail.

## 2. Surface reads, `<errors of=…/>`, Edge A flipped, §55.5.2 dead rule, reset, I-FORM-SUBMIT-GATED

- **analyze**: `NameFact.NSurface(of, prop)`; `resolveMember` — compound `@d.isValid` /
  `.submitted` (§55.5); field `@x.isValid` / `.touched` (+ `.submitted` on a top-level value)
  (§55.5.1 / §55.6). Refused, filed: `errors` as a VALUE (no ValidationError type in the
  bootstrap) and the compound `touched` / `errors` MAPS. `@signup.f.submitted` → E-SCOPE-001
  (§55.6 "A child field has no `submitted` of its own" — SPEC names no code: agent pick).
  E-VALIDITY-NO-SURFACE only for a top-level value with no validators (§55.5.1 rule 2).
  E-SYNTHESIZED-WRITE also for a field surface property (§55.5.1 rule 7).
- `ElemFact.MErrors` + `resolveErrors` (§55.8): `of=` a field / compound / validated top-level
  value; `all`; E-ERRORS-001 / -002 (the §34 rows); E-VALIDITY-NO-SURFACE for a no-validator
  top-level value; body override + unknown attributes refused (E-BOOTSTRAP-UNSUPPORTED). `errors`
  left the structural-refusal list.
- **Edge A reversed**: `topLevelValidatorsLower()` removed (S447 ruled) — a program cell's
  validators take the child-field path; they lower onto every control that binds it and gate.
- **E-VALIDATOR-DEAD narrowed to §55.5.2**: dead only when locked (no write grant) AND no bind
  AND no use-site seed (server / persist= are refused where written). A `let` value set from
  logic is LIVE.
- **reset** (§55.13): `reset(@x)` and a `reset-on=` reset lower to `Write` + `ResetSurface`
  (touched → false; a top-level value's submitted → false; a child field's compound submitted
  unchanged). check C13 admits the trailing ResetSurface.
- **I-FORM-SUBMIT-GATED** (§55.17.6): in a new non-fatal `TypedProgram.infos` stream (SPEC: "As an
  `I-` code it is non-fatal and reports in the warnings stream"), so a gated program still
  compiles clean; `frontEnd` returns it as `infos`. `data-scrml-gated` from `Attr.Gate.values`.
- Superseded pins flipped (validators.test.js (1)/(5), failclosed.test.js `errors`), each with the
  governing sentence in a comment.
- Gates: m1 99, m2 448, m3 60, m4 535 (was 504), codec 92, m1-lowered 99, lexer 337.
- Landed `3f2682f6e`; full pre-commit gate green.

## 3. E-VALIDITY-RESERVED-NAME, conformance cases, gaps filed

- §55.5.3 case 1 in `fieldOf` (child field / attribute; a top-level value's own name is "Not
  affected"); case 2 unreachable in the bootstrap (validators only on string / number values).
  Verified the silent shadow first (`${@f.errors}` read a field named `errors`).
- 8 conformance cases in `conformance/cases/forms/` (codes half + runtime half), executed by the
  bootstrap in gate.test.js; impl#1 xfail under the new carried gap `g-impl1-form-gate-surface-s449`
  (signatures captured with `--xfail-signature`). `bun conformance/run.ts`: 1244/1286 + 42 xfail,
  0 FAIL.
- known-gaps: `g-bootstrap-validated-form-fields-fail-open-no-surface-no-gate` → resolved (marker
  edited in place in §S447 + a one-line pointer); new section `## §S449-bootstrap-form-validity` at
  the end: the LANDED summary, `g-bootstrap-validity-errors-value-and-messages-unbuilt` (MED),
  `g-bootstrap-gate-reach-live-dom-reading` (LOW, PA reading), `g-bootstrap-validity-spec-silences-s449`
  (LOW), `g-impl1-form-gate-surface-s449` (MED, carried).
- Gates: m4 544.
