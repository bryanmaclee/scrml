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
- Item 1: slice-m3/bench/bite-matrix.js — 40 named corruptions (printer, runtime, ingest shim) on a .tmp/ MIRROR, each
  re-grading the clean run's runtime passes via `hybrid.ts --footprint --only … --json`; exits 1 on a site found ≠1×
  or a clean mirror that does not reproduce (probed: a bogus site → exit 1, "site found 0× — NOT RUN (hollow)").
  Reproduced the review first: round-0 grade + `Cond test const false` → no pass died (toggle-show was a FAIL then).
  Result now: 17 runtime passes; 32 constructs CERTIFIED, 0 UNCERTIFIED. Round-1 finding: corrupting sharedJs's getter
  FALLBACK bit nothing (unreached — a function's shared instance is its prologue local); the mutation now targets
  instJs's `.Shared` arm (14 die). The shim's derived→Seeded MODE corruption bites nothing: the printer chooses
  derived vs seeded by `wcap`, never by FieldMode (recorded in the matrix, not hidden).
- CI: `bun test ./compiler/self-host-v2/slice-m3/` added to the "Bootstrap slice" gate step (wall 2.5 s). Full grade
  (~9 s) and bite matrix (~146 s) are NOT in CI.
- §5 re-run: slice-m1 73/0 · slice-m2 74/0 · lowered slice-m1 73/0 · slice-m3 22/0 · lexer 337/0 · hybrid 26/0 ·
  lint 0 violations · footprint grade exit 0 · bite matrix exit 0 · impl#1 conformance exit 0 1040/1047 + 7 xfail,
  per-case lines identical to the pre-fix run.

## Round 2 (re-review of b1bda6170)
- merged origin/main (833884ca7).
- Item 1: normalize.ts strips a `<template>` only when its id matches `^_scrml_scrml_(chain_)?tpl_\d+$` (verified
  loci: codegen/emit-html.ts:1579 `genVar("scrml_tpl")`, :1911/:1949 `genVar("scrml_chain_tpl")`; genVar spells
  `_scrml_<base>_<n>`, codegen/var-counter.ts:17) AND it has no live child nodes. FINDING while implementing: impl#1's
  anchor is NOT empty in the content sense — it carries the arm's markup in its `content` fragment
  (`<template id="_scrml_scrml_tpl_2"><p id="panel">Panel open</p></template>`, toggle-show's page). A first cut that
  also required an empty `content` turned toggle-show RED on impl#1 (caught by the invariance diff). And per the HTML
  spec a template's children — parsed or appended — always go to `content`, so "no child nodes" is a guard that can
  never distinguish; the exact impl#1 id is the real discriminator. Unit test
  compiler/tests/unit/conformance-normalize-template-anchor.test.js (3): impl anchors stripped (incl. with content),
  the review's `_scrml_x` author template kept, near-miss ids kept; bite-checked (a prefix matcher → red).
- Item 2: toggle-show description + rationale describe the semantic tree.
- Item 3: README OQ1 — the pipeline list gains the anchor strip + a paragraph stating it is keyed to impl#1's private
  naming, an impl-private exclusion (not a language rule), author templates kept, impls without the anchor
  unaffected; the leak bullet is struck and marked DISSOLVED.
- Item 4: bench/bite-lib.js `judgeDeaths` — a KILL is a case still GRADED whose run FAILED; reclassified / crashed /
  absent cases are listed "NOT a bite". slice-m3/bite.test.js (2). Matrix re-run: the same 32 certified, 0 NOT-a-bite rows.
- Item 5: "Mirror reproduced it" reads its own `mirrorOk` flag.
- Item 6: new case conformance/cases/reactive/reset-handler-nonzero-initial (`<count> = 5`, click reset → 0,
  #display "Count: 0"): PASS on impl#1; graded (18 runtime passes); On-drop and Write-noop kill it (bite matrix).
- Invariance (raw lines): pure impl#1 `bun conformance/run.ts` exit 0, 1041/1048 + 7 xfail; the 1047 prior per-case
  lines are identical to round 1's, plus one new line `PASS reactive/reset-handler-nonzero-initial [runtime]`.

## Surfaced, not done
- 4 runtime cases pass impl#1 conformance while impl#1 emits error-severity diagnostics on them:
  block-grammar/block-029-leading-equals-quote-prose-pos (E-MARKUP-001×3), defer/nested-fn-handler-in-defer (+twin)
  (E-TYPE-080), engine/message-payload (E-ENGINE-MSG-ARM-NOT-EXHAUSTIVE×2). The runner's `codes` check is subset-only,
  so undeclared error-severity codes are never asserted absent. The conformance runner's concern — not fixed here.
- Constructs certified by a single case: Concat/Local/Let/Return (defer/identifier-untouched), Not (toggle-show),
  Gt (else-if chain) — thin evidence.
- CG-emitted codes (W-DERIVED-001 etc.) sit on the not-yet queue with no bootstrap owner.
