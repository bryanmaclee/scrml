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
