# Bug 6.5.1 — match-arm named-binding parser gap

**Worktree:** `agent-a33ccb80ea2f745d3` (branch: `main`)
**Surfaced by:** Bug 6.5 dispatch (S87 a72ccd2, agent a5367677c236aa605, finding #1).
**Bug shape:** Form 1b parser at `compiler/src/ast-builder.js:5052-5111` collects payload binding names from `match-arm-block` patterns. The "first ident after `(` or `,`" heuristic picks the FIELD name `field` from `.V(field: local)` instead of the LOCAL binding name `local`. Both typer and codegen use this list, so the wrong name is bound into scope (E-SCOPE-001 on `local`, runtime ReferenceError if scope check were bypassed).

## Reproduction (pre-fix, confirmed)

```scrml
${
    type Status:enum = {
        Loading
        Success(name: string, count: int)
        Failed(reason: string)
    }
    @status: Status = .Loading
    @msg = ""
    function handle() {
        match @status {
            .Success(name: who, count: n) => { @msg = who + " found " + n }
            .Failed(reason: why) => { @msg = "Failed: " + why }
            _ => { @msg = "loading" }
        }
    }
}
```

→ `E-SCOPE-001: Undeclared identifier 'who' / 'n' / 'why'` (3 errors).

## Plan

1. Tighten `payloadBindings` collection in `ast-builder.js` Form 1b (lines 5077-5096) to handle named form `field: local` — push `local` (after the `:`) instead of `field`.
2. Mirror the typer's `extractPayloadBindings` (`type-system.ts:7316`) to use the same logic.
3. Add unit tests at `compiler/tests/unit/match-arm-named-binding-parser.test.js` covering: positional, named, named+positional mixed (per SPEC §18.7 — partial-named binding is valid), discard, multi-binding.
4. Verify reproduction generates valid JS with `const who`/`const n`/`const why`.
5. Regression-guard: full unit + integration + conformance suite passes.

## Steps

- [2026-05-12 START] Worktree verified clean; bun install + pretest pass.
- [2026-05-12 ANALYSIS] SPEC §18.7 reviewed — named form binds LOCAL (`.Rectangle(height: h, width: w) => w * h`). Mixed form NOT explicitly authorized but partial-named is. Bug confirmed in repro.
- [2026-05-12 PARSER] Form 1b binding-collector rewritten to walk top-level comma-segments. Named form (`IDENT : ...`) picks the IDENT after the colon; positional form picks the FIRST IDENT.
- [2026-05-12 SURFACED-DEEPER-BUG] Codegen for `match-arm-block` arms set `arm.binding = null` unconditionally (line 1260 of emit-control-flow.ts), so even with the parser fix, NO `const local = subject.data.field` lines were emitted. The brief framed this as "typer correctly binds local; codegen emits wrong const" — actual shape is "typer bound the WRONG NAME (so E-SCOPE-001 fired) and codegen emitted NO CONST lines (so even bypassing typer would runtime-ReferenceError)". Both layers needed fixing.
- [2026-05-12 PARSER+] Extended Form 1b AST node with `binding: string | null` carrying the raw paren-contents text, mirroring the inline form's `binding` field.
- [2026-05-12 CODEGEN] `emit-control-flow.ts` `match-arm-block` handler now threads `child.binding` into `arm.binding` so the existing `emitVariantBindingPrelude` machinery (used by inline arms since S22 §1a) emits the correct `const local = subject.data.field;` preludes for block arms too.
- [2026-05-12 COMMIT a75e7c5] Parser + codegen fix landed. Pre-commit hook ran full unit+integration+conformance: 10851 pass / 85 skip / 1 todo / 0 fail.
- [2026-05-12 TESTS] Added `compiler/tests/unit/match-arm-named-binding-parser.test.js` — 12 tests covering: positional, named-only, multi-named, mixed positional+named (per SPEC §18.7 partial-named), discard `_`, raw `binding` text capture, empty paren list, E2E codegen for positional + named + discard, E-SCOPE-001 regression, Bug 6.5 positional-only regression.
- [2026-05-12 VERIFY] Test deltas: unit 9124→9136 (+12), integration 1414 (no delta), conformance 313 (no delta). 0 regressions across all suites.

## Outcome

- Acceptance #1 (named binding correctly binds LOCAL): MET — repro emits `const who = m.data.name; const n = m.data.count; const why = m.data.reason;`.
- Acceptance #2 (positional binding still works): MET — §1, §8, §12 tests assert.
- Acceptance #3 (mixed shape): SPEC §18.7 supports partial-named (some fields named, some not bound at all); explicit MIXING of positional + named in the same paren list is not explicitly authorized in SPEC text, but our parser handles it gracefully (per-segment classification). §4 test confirms `.Ready(a, count: n)` parses to `["a", "n"]`. SPEC clarification: surfaced as open question below.
- Acceptance #4 (discard `_`): MET — `_` preserved as binding token in `payloadBindings` so codegen's `parseBindingList` discards via `discard: true` path; §5 + §11 assert no `const _ = ...` line.
- Acceptance #5 (unit tests): MET — 12 new tests at `compiler/tests/unit/match-arm-named-binding-parser.test.js` (target was +5 to +10; delivered 12).
- Acceptance #6 (regression guard): MET — 0 test failures across unit (9136 pass), integration (1414 pass), conformance (313 pass).
- Acceptance #7 (idiomatic-examples styling rule): N/A — no new fixture files; tests use inline scrml strings.

## Surfaced findings

1. **Codegen gap was deeper than brief framed.** Brief said "codegen prelude declares wrong const"; actual: codegen emitted ZERO const lines for `match-arm-block` arms. The Bug 1 fix-A projection at `emit-control-flow.ts:1432-1460` (`emitVariantBindingPrelude`) was wired only for inline arms (where `arm.binding` was populated from `match-arm-inline.binding`). Block arms (`match-arm-block`) set `arm.binding = null` at line 1260 — bypassing the prelude entirely. The fix wires it through the new AST `binding` field.

2. **Typer's `extractPayloadBindings` (`type-system.ts:7316`) has the SAME named-form bug** as the pre-fix ast-builder, but is currently UNUSED for scope binding — it feeds `parseArmPattern` only, whose `payloadBindings` field is consumed in just one place (E-SYNTAX-011 guard rejection at line 7477). No active scope binding is wrong because of this. Surfaced for future cleanup if any consumer ever wires it to scope-binding logic.

3. **SPEC §18.7 silent on mixed-form `.V(positional, field: local)`.** SPEC describes "Positional form" and "Named form" as two distinct forms but doesn't explicitly forbid mixing them in one paren list. Our parser handles mixed gracefully (per-segment classification), but the typer's downstream payload-typing assumes positional resolution maps left-to-right against declared field order — when a positional segment sits AFTER a named one, position-vs-named arity could get confusing. Recommend SPEC clarification: either (a) explicitly authorize mixed (with rule "named bindings consume the field by name regardless of position, positional bindings consume the next un-bound field in declaration order") OR (b) explicitly forbid mixed (parser + typer error E-MATCH-MIXED-BINDING). Currently neither is asserted.

## Open questions for PA

- Should mixed positional+named binding (`.V(a, field: local)`) be explicitly supported (with normative rule) or rejected (new error code)? Tests pass under the current "permissive" parser behavior, but the SPEC is silent.

