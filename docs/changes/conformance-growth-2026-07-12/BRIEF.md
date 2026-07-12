# Conformance coverage-growth — 2026-07-12

Verify-harden coverage growth: 19 new conformance cases across five disjoint thin
domains, each pinning REAL (adapter-captured) diagnostic behavior for previously
unpinned, implemented codes — NOT speculative "should-happen" oracles. Every case
was compiled through `conformance/adapters/impl1-ts.ts` and its `expected.json`
matched to the actual emitted codes; the whole suite went 356 -> 375, all green.

- **error-boundary (§19.6, +4):** the E-ERROR-005 static-exhaustiveness FIRE cases
  (no-fallback+no-renders; partial per-variant coverage; innermost-boundary-governs
  under nesting) — all previously only pinned as *notCodes* — plus the boundary-absent
  E-ERROR-002 contrast (unhandled `!`-call with no boundary).
- **capability (§23.5, +4):** the §23.5.2 repeated-token arg-union (clean); the §23.5.3
  whole-list unknown-token scan (valid+`teleport` still fires E-FOREIGN-CAPABILITY-UNKNOWN);
  and the §23.5.5 presence-nudge lint on a `_{}` INLINE block (undeclared fires / covered
  silent) — the existing cases only exercised the `use foreign:` sidecar.
- **lifecycle (§51.0.H, +5):** the three `effect=` lifecycle-hook error codes, all
  implemented + none previously in conformance — E-ENGINE-EFFECT-AMBIGUOUS (multi-target
  rule=), E-ENGINE-EFFECT-NOT-INTERPOLATED (missing `${}`), E-ENGINE-EFFECT-ON-DERIVED
  (boot effect on a derived engine) — plus two clean-compile guards (effect=+<onTransition>
  co-existence; <onTransition> once/if= built-ins).
- **loop (§49.9, +2):** the SPEC's own E-LOOP-001 / E-LOOP-002 worked examples (bare
  break / continue outside any loop).
- **table-for (§41.16, +4):** PICK-INVALID-FIELD, OMIT-INVALID-FIELD, PICK-OMIT-CONFLICT
  (valid fields — exercises mutual-exclusivity, not field-validity), NO-PRIMARY-KEY
  (`selectable=` on a struct with no `id`/`selectedBy`).

**Findings surfaced for PA triage (NOT papered over — verify-harden):**

1. **E-LOOP-003 is intentionally DISABLED in source** (`compiler/src/type-system.ts`
   ~L18188): "braceless if-bodies cause the ast-builder to absorb the next token as a
   label ... Re-enable when braceless-if parsing is fixed." So `break <undefined/non-loop
   label>` emits E-SCOPE-001 or nothing, never E-LOOP-003. Documented trade-off, not a
   fresh bug — but a live SPEC(§49.9)-vs-impl gap. E-LOOP-004 shares that disabled path
   and is absent from source entirely.
2. **E-LOOP-007 is inverted relative to SPEC §49.4.4.** The impl heuristic fires
   E-LOOP-007 on the lift/`~` accumulator forms the SPEC calls the VALID exception
   (`let x = while(){ lift }`, `~x = while(){ lift }`) and stays SILENT on the SPEC's own
   E-LOOP-007 example (`let x = while(){ ... }` WITHOUT lift). Entangled with the parser
   escape-hatch; no clean case authored.
3. **Minor (soft) — `capabilities=[db("x")]`:** the §23.5.2 grammar makes `db` presence-only
   (boolean, no args); the compiler silently accepts `db("x")` with args, no diagnostic.
   Grammar-vs-lenient-accept, no stated "SHALL be an error", so left unpinned.
4. **Minor (soft) — `capabilities=` on a non-`<program>` element** (e.g. `<div>`) falls
   through to general-expression handling and emits a confusing E-SCOPE-001 (`network`
   undeclared). SPEC is silent on off-`<program>` placement, so not SPEC-correct-confident;
   left unpinned.

All work touched ONLY `conformance/cases/` (data) + this BRIEF; stayed inside the allowed
domains (capability / error-boundary / lifecycle / loop / table-for) and never touched the
forbidden set (outlet / navigate·§20 / reactive / server-fn / derived).
