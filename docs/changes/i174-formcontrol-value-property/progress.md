# i174 — reactive `value=` on a form control targets the `.value` PROPERTY

GH adopter issue #174. Class: conformance-restoration (bug fix), semantics-changed-toward-contract.

Governing spec: SPEC §5.5.4 — `value=(expression)` on a form control is the exclusive owner of the
`.value` PROPERTY (conflicts with `bind:value`). SPEC §5 — a property-backed attribute SHALL be
emitted as a property assignment, not `setAttribute`; emitting `setAttribute` is a compiler defect.

## Bug
A reactive `value="${@cell}"` (template-string form) lowered to `setAttribute("value", …)` inside a
`_scrml_effect`. setAttribute sets only the HTML *attribute* (default value); once the user types, the
DOM `.value` property diverges, and a programmatic `@cell = ""` re-runs setAttribute but never clears
the visible field. Silent (clean compile).

## Loci
- **PRIMARY**: `compiler/src/codegen/emit-bindings.ts` template-attr path (~L885) — the string-literal
  `value="${@cell}"` form. Was unconditional `setAttribute`. FIXED.
- The paren `value=(expr)` form (emit-html.ts logic-binding → emit-event-wiring.ts `emitValueAttrApply`)
  was ALREADY correct (writes `.value` via `valueAttrIsFormValue`). Verified, unchanged.
- **each/loop path**: `compiler/src/codegen/emit-each.ts` `renderTemplateAttrToJs` (~L1607) — same
  setAttribute-for-value defect for `<input value="${@.x}">` inside `<each>`. FIXED symmetrically.
  (`<textarea>` BODY text already used `.value` via the RCDATA path; this covers the `value=` ATTRIBUTE.)

## Log
- 2026-07-24 — Baseline confirmed: repro emits `setAttribute("value", …)` (adopter symptom).
- 2026-07-24 — Fix 1 (emit-bindings.ts template-attr): form-control `value` → property assignment with
  caret-safe inequality guard. Verified: emits `.value =`, no setAttribute for value.
- 2026-07-24 — Fix 2 (emit-each.ts renderTemplateAttrToJs): per-item `value` on input/textarea/select
  → `.value =` property. Verified: emits `.value =`, `type=` stays setAttribute.
- 2026-07-24 — Axiom ① guard: when `bind:value` (the sanctioned two-way `.value` owner) coexists with a
  template `value=`, the value= falls back to setAttribute (no second `.value` writer). Both loci.
- 2026-07-24 — Tests: unit (value-attr-binding-i81, +5: template value input/textarea, non-value
  unchanged, each per-item, bind:value-defer) + browser (i174-formcontrol-value-property, 6: emit-shape,
  type-then-clear CANARY, programmatic-set, E-ATTR-WRITER-CONFLICT still-fires). All green.
- 2026-07-24 — DONE. Final pre-commit: 21217 pass / 6 fail (all 6 = documented baseline: self-host-smoke
  ×4, csrf B5, serve-tool R26 unnamed). Zero regressions. Clean tree.

## Result
- The adopter's type-then-clear symptom is fixed: `@name = ""` now clears a dirty field (executed-DOM
  canary asserts `input.value === ""`).
- The paren `value=(expr)` + `bind:value` E-ATTR-WRITER-CONFLICT floor is unaffected (verified).

## Deferred / named
- `checked`/`selected` reactive lowering: the paren/expr path DROPS them as HTML_BOOLEAN_ATTRS
  (emit-html.ts ~L3072 — presence-semantics; setAttribute("checked","false") still renders checked), and
  the template-string form `checked="${…}"` is degenerate (a template literal always yields a string, so
  `.checked = "false"` would be truthy). No property-backed reactive checked/selected lowering exists to
  correct; widening REACTIVE_BOOL_ATTRS to admit them is a separate dispatch-precedence design (already
  named in emit-html.ts REACTIVE_BOOL_ATTRS comment). Scope of i174 is `value`.
