# progress — s439-bootstrap-m3-ingest

## Phase 0 — measurement (2026-09-27, before any shim code)
Probe: every conformance case compiled by impl#1 with a capturing CG stand-in (`stageOverrides.CG`),
walking every `kind`-bearing object in the FileASTs CG receives (`<parentKey>:<kind>`).
- 1047 cases (1063 `.scrml` incl. aux fixtures); all 1047 reach CG.
- 306 have a runtime half; 301 of those expect no E-code and impl#1 reports no error.
- 471 expect an E-code or impl#1 errors (front-end-owned: the CG shim cannot grade them).
- 275 are codes-only and clean.
- 291 distinct `<key>:<kind>` pairs. Top among the 301 clean runtime cases: text/markup/logic (≈all),
  state-decl 263, bare-expr 243, function-decl 185, type-decl 120, call-ref attrs 115, each-block 61,
  engine-decl 48, match-block 31, sql 31, component-def 6.
- Estimate: a kind allowlist of the obvious Core counterparts (cells, markup, text, interpolation,
  functions, if/return, arithmetic/compare, call-ref/expr handlers) covers 29 of 301 clean runtime
  cases; widening with enums/arrays/each/const/let/ternary/index reaches 39. Core-mapping limits will
  cut this further (bind:value, meta, navigate, tool print use in-set kinds but out-of-Core semantics).
  Expected first-slice graded: roughly 15–35 runtime cases (5–12% of runtime cases). Borderline vs the
  <25 stop line; the kind-level ceiling (29–39) is above it, so CONTINUE, and report the real number.
- 2026-09-27T19:14:31-06:00 ingest.scrml (shim: legacy cells/const/functions/markup/handlers/if= → Core) + slice-m3/{bundle.scrml,substitute.js} (CG substitute: encode → ingest → check → print; executeClient). counter-increment ingests + prints.
- 2026-09-27 seam wiring (TS, harness only — no compiler/src change):
  - conformance/adapters/impl1-ts.ts: `setClientExecutor` (default null → impl#1's IIFE execution, textually unchanged,
    kept at its original indentation inside the `else`). The bootstrap artifact is an ES module over the bootstrap
    runtime, which the IIFE cannot run.
  - conformance/adapters/hybrid.ts: installHybrid(stageOverrides, executor?) / uninstall clears both.
  - scripts/hybrid.ts: runHybridConformance `only` + `executor`; `clientExecutorOf`; `--footprint` + `--report`;
    `classifyFootprint` (graded / not-yet / front-end), `runFootprintGrade`, `footprintTable`.
  - slice-m3/{harness.js, ingest.test.js (12), footprint.test.js (4)} green.
- First full grade: 1047 of 1047 considered; GRADED 28 (16 runtime · 12 codes-only), 26 pass, 2 fail; NOT-YET 548;
  FRONT-END 471. Fails: reactive/derived-no-dep-warn (W-DERIVED-001 is impl#1 CG's lint; the bootstrap CG does not
  emit it — real), reactive/toggle-show (the case's `dom` bakes impl#1's `<template id="_scrml_scrml_tpl_2">`
  marker — a case/normalizer defect, surfaced not fixed).
- PARSE_REENTRY sites in the shim: 0 (params carried structured `{name,typeAnnotation}`; the shim never reads
  `init`/`raw`/`args`/`expr` text fields).
- 2026-09-27T19:42:04-06:00 NOTE: commit a2453f5e5 carries the wrong message (it duplicates f19c4b19f's): it is the client-executor seam + footprint grader + slice-m3 tests commit. Next: primitive-typed cells `<x>: T = v` (§66.21 row 1) + post-NR-synthesized element label.
- 2026-09-27 FINAL grade (tip 862102be3): 1047 of 1047 · GRADED 29 (17 runtime · 12 codes-only) · pass 27 (16 runtime)
  · fail 2 · NOT-YET 547 · FRONT-END 471 · exit 1 → footprint-2026-09-27.md.
- Corruption proof: print.scrml `.Dyn` hole → constant "CORRUPT": runtime-half passes 16 → 2 (the two have no Dyn). Restored.
- Default pipeline unchanged: `bun conformance/run.ts` with the BASE impl1-ts.ts (8c55f5181, copied to a throwaway
  sibling dir, removed) vs the new one: both exit 0, 1040/1047 pass, 7 xfail; the 1047 per-case PASS/FAIL/XFAIL lines
  are identical (diff exit 0); the only text differences are stack-trace line numbers inside impl1-ts.ts.
- Suites: slice-m1 73/0 · slice-m2 74/0 · SLICE_CORE=lowered slice-m1 73/0 · slice-m3 18/0 · v2 lexer 337/0 ·
  hybrid-stage-swap + hybrid-xfail 26/0 · lint 28 files 0 violations · pre-commit (862102be3) 31981 pass / 0 fail.
- 2026-09-27T19:56:53-06:00 executeClient removes its per-run temp dir after the imports settle (no leak); slice-m3 18/0; reactive/ filter grade unchanged (11 graded, same 2 fails).

## Fix round 1 (review of 486771ae3, tag review/s439-ingest)
- merged origin/main (cb5641427); slice-m3 18/0 after merge.
- Item 2: conformance/cases/reactive/reset-handler — input inc,inc,reset,inc → end state 1 (≠ initial 0); description +
  rationale updated. impl#1 still PASSes it.
- Item 5: conformance/normalize.ts drops an element `<template id="_scrml_…">` (impl#1's if-guard anchor, README OQ1's
  named leak) from the whole-tree serialization; toggle-show `dom` corrected to the semantic tree. Invariance: pure
  impl#1 `bun conformance/run.ts` exit 0, 1040/1047 + 7 xfail, and the 1047 per-case outcome lines are IDENTICAL to the
  pre-fix run (diff exit 0) — toggle-show and reset-handler still PASS, no other case moved. (Round-1 note: the earlier
  invariance diff was taken on text passed through a `s/[0-9.]*ms//g` filter that also mangled names containing "ms";
  re-done on the raw lines: base vs round-1 identical, diff exit 0.)
- Item 4: `unmapped(n, what, read, redundant)` — every key is READ or REDUNDANT for a stated reason (identity / text
  twin / syntax / summary); the hoisted lists and configs on file + logic nodes are no longer "known" (non-empty →
  not-yet); `shorthandBodyRaw` likewise. Now read and checked: cell-decl `shape`, cell-write `shape/structuralForm/
  isConst/__enclosingFnCanFail`, element `resolvedCategory`, function `fnKind`/`isHandleEscapeHatch`. Witness
  `${ const Foo = <span>foo</span> }` → "top-level `${}` carries unmapped key `components`" (reproduced first: was []).
- Item 7: a `const` whose initializer contains a call → not-yet (§66.9 derived-ness not provable through a call).
  Reproduced first with `const <d>: int = dbl()` (was Field.Locked, notYet []).
- Items 3 / 6 / 8 / 9 (scripts/hybrid.ts): headline = RUNTIME passes; codes-only passes on their own line marked
  "front-end codes — NOT bootstrap evidence"; FRONT-END = an error-severity front-end diagnostic (not the `E-` prefix);
  a required code the front end does not emit → not-yet "expects code X, not emitted by impl#1's front end
  (CG/post-CG)"; "N of M" takes M from an independent `Bun.Glob("**/case.scrml")` enumeration; a throw inside
  footprint() → class `crashed`, a loud FAIL. `--only a,b` + `--json` for the footprint mode.
- Item 10 CORRECTION to the round-0 line above: the shim DOES read a text field — a call-ref's `args`, for its LENGTH
  only (compared with `argExprNodes` to detect arguments impl#1 carried only as text). It never reads the content of
  `init` / `raw` / `expr` / `condition` / `args`. Header of ingest.scrml says the same.
