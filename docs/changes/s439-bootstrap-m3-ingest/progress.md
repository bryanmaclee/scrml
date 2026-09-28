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
