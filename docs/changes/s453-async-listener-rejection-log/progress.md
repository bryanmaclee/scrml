# progress — s453-async-listener-rejection-log

## 2026-10-04T10:29:59-06:00 — start
- Startup gate PASS: worktree root matches, tree clean, merge-base == origin/main (df6dad5a).
- bun install OK (218 pkgs); bun run pretest OK — samples/compilation-tests/dist/ has 34 files (verified, not by exit code).
- Brief + maps read. Next: verify the premises in source.

## 2026-10-04T10:46:20-06:00 — implemented + measured
- PREMISE VERDICTS: colorHandlerAsync seam HELD but REFINED — the right home is the shared primitive `colorAsyncFunctionExpr` (js-async-analysis.ts), called by BOTH colorHandlerAsync (emit-event-wiring: 3 paths) and colorActiveHandler (emit-each 1 site + emit-lift 13 sites). A 4th/5th registration family the brief did not name.
- Wrap shape: PA lean CONFIRMED (in-body try/catch, not an async IIFE).
- Boundary id: "<eventName> <placeholderId>" / "on<ev> <each> row" / "on<ev> lift row".
- Baseline reproduced (happy-dom, pruned runtime): rejection escaped, consoleErrors empty, 2 probes failed from the escaped rejection.
- Post-fix: log reached exactly once on all 5 registration paths; no unhandled rejection.
- BITE: unit 9/12 fail on base; browser 6/8 fail on base. Both green on head.
- DIFFERENTIAL: 44 of 44 async-coloured-listener artifacts changed, 57 of 57 listener sites wrapped (base 0 arms). 11309/11353 byte-identical. 0 diagnostic delta, 0 compile-outcome delta, 0 syntax delta, 0 .server.js/.html changed.
- R2 (arm factory) has ZERO corpus exposure — covered by dedicated tests only; a corpus differential could never have caught a miss there.
- Flipped the S450 pin in handler-nested-server-write-s450.browser.test.js (that is what it was placed for); widened its console.error capture past the settle.
- Next: Phase-3 R26 empirical, local suite, facts/state.

## 2026-10-04T10:54:30-06:00 — gates
- Invariant-67 check: 44 of 44 affected apps' PRUNED per-app runtimes DEFINE _scrml_error_boundary_log (2 of them carry it at the app root, not beside the page). 0 missing. The 'always-included errors chunk' claim is measured, not quoted.
- One artifact's textual diff inspected: the ONLY delta is 'try {' + the catch arm. Purely additive.
- R26 empirical base-vs-head: exit codes identical (1 on all four, pre-existing - 2 errors/28 warnings from <tableFor>/TS stage); async-listener-sites identical (0,5,6,6); catch-arms 0,0,0,0 -> 0,5,6,6. errorBoundary render ids present unchanged on BOTH sides.
- facts.ts --check PASS; state.ts --check PASS (after --write: FACTS +112 LOC/+2 test files; gap-counts LOW 257->256).
- Browser tier: 3 emit pins broke (they assert the text right after 'async function(event) {', now 'try {'). Threaded the try through each; subject of each pin unchanged. 4 handler-family files now 289/289.
- grep: no other test and no conformance expectation pins the emitted handler text.
- RESIDUAL, named not widened: a server-call write inside a SCHEDULER CALLBACK in a handler (setTimeout(() => { @x = save() })) is emitted as a detached 'async () => { await ... }' with NO catch arm, on BOTH sides. Pre-existing, unchanged by S453, and NOT an async event listener - an outer try/catch cannot see it and an IIFE wrapper would not either.

## 2026-10-04T11:12:38-06:00 — shape-space defect found and fixed
- A direct shape-table probe against colorAsyncFunctionExpr found a REAL defect the corpus could not: a PARENTHESIZED concise arrow body. Parens are not AST nodes, so acorn puts body.start on the inner node — '(e) => ({a: save()})' emitted '=> ({ try { ... } })', an object literal with a property named 'try' (SyntaxError).
- Fix: the concise-arrow slice walks outward over balanced wrapping parens, bounded so it can never reach the parse PREFIX/SUFFIX.
- The probe is now a COMMITTED gate (8 body shapes + catch-var rename + 2 inert controls); unit file 12 -> 23 tests.
- Lesson for the report: the 57 corpus listener sites are ALL block-bodied function(event){...}. A 44-of-44 / 57-of-57 differential is a complete-COVERAGE proof over the shapes the corpus contains, and says nothing about shapes it does not.
- tsc (the gate's exact cmd, run by hand - types-gate.ts itself exit(2)s on Windows, pre-existing): 253 diags total, ZERO in js-async-analysis.ts, none at my edit sites in emit-event-wiring.ts / emit-each.ts.

## 2026-10-04T11:40:40-06:00 — tier NAME-SET diff (the gate my memory requires on this box)
- Counts on this box are NOISE and this run proved it again: two passes of the SAME uic command on near-identical source gave DIFFERENT fail sets. Only the base-vs-head fail-NAME-SET diff is a valid read.
- base uic 27781 pass / 38 fail names; head uic 27800 pass / 42 fail names. RED ONLY IN HEAD = 4.
  * 3 genuine emit pins in unit/s441-async-escape-f4-f5.test.js (exact async-coloured text) -> try threaded; file now 127/127.
  * 1 = protect-scalar-egress 'rest-omit', a 5000ms TIMEOUT under suite load, not an assertion failure; its file runs 124/124 in 7.4s.
- base browser 1385 pass / 49 fail names; head 1392 pass / 50. RED ONLY IN HEAD = 1 = formfor-component-expand-in-arms-s177 §7d, also a 5000ms timeout under load; its file runs 13/13 in 1.9s.
- RED ONLY IN BASE = 0 in both tiers.
- The name-set diff EARNED ITS KEEP: 3 real pin regressions would have shipped on a count-only read (42 vs 38 looks like noise on this box).

## adjacent finding, NOT fixed (named, not widened)
- emit-event-wiring.ts ~:2430: the <errorBoundary> RENDER fn is invoked as '${renderFn}();' with no await and no .catch. When the boundary is async AND has no fallback=, its 'throw _eb_err' (after logging) escapes as an unobserved rejection. Different surface (a logic/render binding, not an event listener), pre-existing, outside ruling A3's words, and it LOGS before throwing - so lesser harm. Routed to the PA, not fixed here.

## 2026-10-04T13:44:27-06:00 — FIX ROUND (S239 review came back FIX)

### corrections to MY earlier claims in this file
- ⛑ ESCAPE-2 WAS WRONG, corrected. I wrote that a server-call write inside a setTimeout callback has 'NO catch arm, on BOTH sides'. Re-measured on the mounted page:
    * sole-root statement (the ordinary shape): KEEPS §13.2's detached .catch -> _scrml_error_boundary_log. LOGGED(1) ESCAPED(0), fetch confirmed made. It IS logged.
    * the emission that produced my wrong claim came from a TWO-root-statement handler, where the first write rejects and ABORTS the handler before the setTimeout is reached - so it was never evidence about the scheduler callback at all. I turned an emission observation into an unmeasured runtime claim.
    * the shape that does reach it with the skip off (@y = 1; setTimeout(() => { @x = netfail() }, 0)): 0 arms, LOGGED(0), no host unhandledrejection observed. Sync listener, so outside A3, and narrower than my note implied.
- BITE FIGURES re-measured on the files as they NOW stand (not carried): unit 24 of 28 fail pre-change; browser 7 of 9. (My '9 of 12' was stale the moment I added the shape table; the review's '19 of 23' was stale once I added the prologue cases.)
- FALSE-RESOLVED: the gap's own S441 reproducer still reproduces on 36558368 - reproduced it myself before editing. Entry back to open + narrowed; two siblings filed.

### new defect found IN MY OWN FIX
- A DIRECTIVE PROLOGUE cost the arm silently: the bail-to-null left the listener async with 0 arms, no diagnostic, exit 0. ANY string-literal first statement. Fixed by keeping the whole prologue outside the try. The bail's REASONING was right and its CONSEQUENCE was never measured - that is the lesson.

### bounded item that I did NOT ship, with the measurement that killed it
- Row boundary id discriminator: elVar is per-FACTORY-local, so two <each> blocks both emit _scrml_el_4. It discriminates within a row and nothing across blocks - it would have looked like a fix without being one. Reverted; filed as a nit; pinned the ambiguity in both directions.

### hardening note, comment only (not fixed, per instruction)
- The concise-arrow paren walk-out tests CHARACTERS, so it skips whitespace but not comments: (event) => ( /*x*/ save() /*y*/ ) would reproduce the try-as-object-property defect one layer out. Unreachable from scrml source today. Comment states the structural form is to ask the TREE for the extent, not the text.
