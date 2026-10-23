# s469-engine-in-row — progress

Gap: `g-engine-inside-each-row-renders-nothing` (HIGH). Branch `s469-engine-in-row` off `c9f8cd25b`.

## Scope correction (load-bearing)

The brief asked for per-row engine instances "unless SPEC says otherwise". The SPEC does say otherwise:
§51.0.K — "An `<engine>` inside an `<each>` row is FORBIDDEN (S439 ruling #10) … SHALL be refused with
`E-COMPONENT-ENGINE-SCOPE` … **Nominal for this case on impl#1**". The ruling (user-voice S439 #10, "all recs":
"Rec: refuse it … Per-row state is spelled as an ordinary declaration, which gets a keyed instance per row under
§66.7. The error message should name that form.") post-dates the S429 "ruling-gated" note in the gap entry, which
was stale. So this dispatch implements the REFUSAL, not per-row engines.

## Done

- [x] Measured base: every row position renders no engine at exit 0 (row root, nested, if= element, multi-root,
      match arm in row, each in match arm, nested each, engine-in-engine); engine-with-if= in a row renders nothing
      for both passwords (fail CLOSED, silent). Top-level `<empty>` engine: the whole fallback vanishes.
- [x] `compiler/src/engine-in-each-row.ts` — shared code/message/markers.
- [x] SYM PASS 13.B `walkRejectEnginesInEachRows` (total descent, row = templateChildren, `<empty>` walked with
      the enclosing context, component-def skipped, outermost engine only).
- [x] emit-each backstop (`renderTemplateChildToJs` engine-decl; `<empty>` depth → E-CG-003).
- [x] emit-match backstop `refuseEnginesInRowScopedArms` + host-span stamp for codegen's arm-local parse.
- [x] Browser test `compiler/tests/browser/engine-in-each-row-refused-s469.browser.test.js` (28).
- [x] Security pack n25 (12 shapes; 467 → 479).
- [x] SPEC §17.1.2.3 provenance, §17.7.4 impl#1 note + ⚑ OPEN, §51.0.K, §34 row; SPEC-INDEX regen.
- [x] known-gaps: resolved entry + audit-table row; filed g-engine-in-each-empty-fallback-unrendered-s469 (LOW,
      ruling-gated) and g-component-each-row-engine-refusal-arm-local-span-s469 (LOW); state.ts --write.
- [x] corpus emit differential base `c9f8cd25b` vs head: VERDICT NO DIFFERENCES — 2860 sources, 8609 artifacts,
      0 diagnostic changes (no corpus source puts an engine in a row).
- [x] gate before commit 1: 36910 pass / 0 fail / 125 skip / 13 todo; every commit through the hook (plain).

## Commits

- `6dcb905ae` src + browser test · `253a9b7bf` security pack n25 · docs commit (SPEC + SPEC-INDEX + gaps + this file).
