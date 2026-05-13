# Bug 6.5 — match-arm payload binding for inline-markup arms

## Goal
Fix gap where `.Variant(binding) => { lift <markup>...${binding}... }` arms emit
the lifted markup but skip the `const binding = subject.data.<field>` prelude.

## Root cause
`compiler/src/codegen/emit-control-flow.ts:emitMatchExpr`, in the
`match-arm-block` AST-node ingestion (lines 1256-1266), constructs a `MatchArm`
with `binding: null` — DROPPING the `child.payloadBindings: string[]` already
captured by the AST builder (`ast-builder.js` Form 1b).

The downstream prelude emitter `emitVariantBindingPrelude` early-returns on
`!arm.binding`, so the `const msg = subject.data.msg;` line never appears.

The legacy text-based path (`parseMatchArm`) extracts the binding via regex and
works correctly. The inline AST path (`matchArmInlineToMatchArm`) also works.
Only the `match-arm-block` AST path drops the binding.

## Plan
1. Wire `child.payloadBindings.join(", ")` into `arm.binding` in the
   `match-arm-block` branch of `emitMatchExpr`.
2. Add unit tests covering: single binding, multi binding, no-binding regression,
   and Bug-6.5 specific lift-markup scenario.
3. Verify `examples/16-remote-data` regenerated `.client.js` carries
   `const msg = _scrml_match_*.data.message;` before the lift markup.

## Steps
- [2026-05-12 step 1] Reproduced bug on `examples/16-remote-data.scrml`. Generated
  `.client.js` line 78 emits bare `String(msg ?? "")` with no `const msg = ...`
  prelude. Maps consulted: primary.map.md, structure.map.md.
- [2026-05-12 step 2] Identified gap at `emit-control-flow.ts:1256-1266` —
  `match-arm-block` ingestion drops `child.payloadBindings`.
- [2026-05-12 step 3] Applied fix in `compiler/src/codegen/emit-control-flow.ts`
  match-arm-block ingestion (commit 32f9140). Verified repro CLOSED on
  `examples/16-remote-data.client.js` line 73:
  `else if (_scrml_tag_8 === "Failed") { const msg = _scrml_match_7.data.message; _scrml_lift(...)`.
  Pre-commit hook: 10851 pass / 0 fail.
- [2026-05-12 step 4] Added 5 unit tests at
  `compiler/tests/unit/match-arm-inline-markup-payload.test.js`:
  single-binding, multi-binding, no-binding regression, discard binding,
  Bug-6.5 repro shape. All 5 pass.
- [2026-05-12 step 5] Verified no regression across full unit suite (9129 pass /
  0 fail) + integration + conformance (1727 pass / 0 fail). Surfaced finding:
  named-binding form `.Variant(field: local)` has a pre-existing AST-builder
  parser limitation (Form 1b heuristic picks first ident `field` not `local`)
  that is OUT OF SCOPE for Bug 6.5 — surfaced as open question for PA.

## Surfaced findings

1. **Named-binding parser gap (B20 follow-up).** `ast-builder.js` Form 1b's
   `payloadBindings` collection (lines 5077-5096) walks tokens with a "first
   ident after `(` or `,` is the binding" heuristic. For `.V(field: local)`,
   this picks `field` (the source field name) instead of `local`. Inside the
   arm body the typer DOES bind `local` (the user-facing scope is correct),
   but the codegen prelude declares `const field = subject.data.field`
   instead of `const local = subject.data.field`, producing a runtime
   ReferenceError on `local`. Affects ALL match-arm-block named-binding
   shapes (not just lift-markup ones). Recommend separate dispatch.

2. **Pre-existing inline-markup arm content elision in `Ready(rows)` arm of
   `examples/16-remote-data`.** Generated lift body for `Ready(rows)` arm
   creates `<ul>` but no `<li>` children — suggests the inner
   `for (let r of rows)` lift loop is silently dropped. Note: also fires the
   prelude-comment `/* §1a: cannot positionally bind 'rows' — variant 'Ready'
   field order unknown */` because `Ready(rows)` declares no field type
   annotation in the source. Both are SEPARATE bugs from Bug 6.5; the brief
   said do not edit the fixture. Surfaced for triage.

