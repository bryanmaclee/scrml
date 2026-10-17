# progress — s468-errorboundary-returned-error

- 2026-10-17T15:17 start at /home/bmacs/scrmlMaster/scrml/.claude/worktrees/agent-a3a683e4c47d6e0bd, base origin/main 5c43c3b8e. bun install (puppeteer postinstall failed — network), pretest OK.
- 2026-10-17T15:30 REPRODUCED on origin/main 5c43c3b8e (happy-dom, SCRML_RUNTIME + client.js), scratch harness
  `~/.cache/scrml-agent-tmp/s468-errorboundary-returned-error/repro/run.mjs`:
  - r1 (gap repro): `<errorBoundary fallback={<div id="fb">FALLBACK</>}> ${ const ok = check("wrong") } <p id="out">${ok ? "LOGGED IN" : "rejected"}</p> </>`
    -> compiles, 0 errors; renders `LOGGED IN`; no log. Emitted: `const ok = _scrml_check_3("wrong");` at module init, and the
    boundary's render fn tests only the interpolation's final value (`ok ? … : …`, a string).
  - r2: `${check("wrong") + "!"}` -> `[object Object]!`; `${check("wrong") ? "LOGGED IN" : "rejected"}` -> `LOGGED IN`.
  - r3: `${ @m = checkCode(@entry) }` inside a boundary: the error object is written to `@m`; `<p>${@m}</p>` OUTSIDE the
    boundary renders `[object Object]`. (`${v}` of a bound error inside the boundary IS caught — only because the
    interpolation's final value happens to be the envelope.)
- Governing sentences (SPEC §19.6.6): "`<errorBoundary>` SHALL catch error variants produced by any `!` function call made
  while RENDERING its direct or nested markup content (a `${…}` interpolation, for example)." and "Within an
  `<errorBoundary>`, a RENDER-time call to a `!` function without explicit match/propagation SHALL NOT trigger E-ERROR-002;
  the boundary satisfies the handling requirement." §19.6.3: "When a `!` function call inside an `<errorBoundary>` produces
  an error variant: 1. If the error variant has a `renders` clause (§19.2), the `renders` clause markup is displayed …
  2. … NO `renders` clause and the `<errorBoundary>` has a `fallback` attribute, the `fallback` markup is displayed."
  §19.6.6: "The compiler SHALL verify, at compile time, that every error variant reachable inside an `<errorBoundary>`
  either has a `renders` clause or is covered by the boundary's `fallback` attribute. Failure to satisfy this SHALL be
  E-ERROR-005." §19.6.4 / §19.6.6: "Nested `<errorBoundary>` elements SHALL follow inner-catches-first semantics."
- Locus trace: the hypothesis (codegen boundary lowering contains a thrown failure only) HELD and is REFINED: the boundary
  catch exists only in `emit-event-wiring.ts` (the per-interpolation `_scrml_eb_render_*` fn) and it tests the
  interpolation's FINAL value; nothing tests the result of the CALL. The set of calls the boundary must catch is decided
  in `type-system.ts` (`checkFailableCallsInValuePositions` / `checkFailableCallsInAttrValues` /
  `checkUnhandledFailableBareCall` exemption `renderTimeInBoundary`) and never reaches codegen. Statement-level boundary
  logic is emitted by `emit-reactive-wiring.ts` at module init, outside any catch.
- 2026-10-17T15:32 WIP start commit be015bc60 landed (hook baseline on origin/main + docs only: 37099 pass / 0 fail / 125 skip /
  13 todo, 37237 tests in 1587 files, 881 s). Pushed.
- 2026-10-17T15:45 FIX (root, not position): the boundary now tests the result AT THE CALL.
  - type-system.ts: the existing render-time-in-boundary exemption (value positions + whole-statement calls) now RECORDS
    each handled call (`boundaryHandlesCall`); after the walk `applyBoundaryCatchWraps` wraps each in place in the
    per-compilation placeholder `PH_EB_CHECK` (placeholder-nonce.ts). A call with no node (markup call-ref attr) or
    found in text the walk parsed itself (`FailableCallCandidate.fromText`, new in failable-value-calls.ts) cannot be
    wrapped -> E-ERROR-002 (fails closed). E-ERROR-005 coverage (`checkBoundaryCoverage`) now applies to every call the
    boundary handles, not only to a whole-statement call.
  - emit-expr.ts: the placeholder lowers to `_scrml_error_boundary_check(call)` ONLY inside a catch site
    (`withBoundaryCatchSite`); elsewhere refused E-ERROR-002. `refuseUnloweredBoundaryChecks` (called from codegen
    index.ts) refuses any wrapped call that no emitter lowered (an `<each>` row lowers from source text).
  - emit-event-wiring.ts: interpolation render fn = catch site; its catch routes a raised typed failure
    (`_scrml_error_boundary_failure`) into the existing renders -> fallback dispatch; host throws unchanged (§19.6.8).
  - emit-reactive-wiring.ts + NEW codegen/emit-boundary-logic.ts: a boundary `${}` block's module-init statements are a
    catch site; if any check was lowered, the emitted JS is wrapped in `_scrml_error_boundary_run(id, body, display)`, one
    per enclosing boundary, innermost inside; top-level declarations hoisted (acorn over our own emitted JS).
    Groups never span two boundary chains. A boundary display-interpolation holding a check is no longer re-evaluated at
    module init (it would run the call a 2nd time outside the slot catch) — emit-html `_boundaryRendered` mark.
  - runtime-template.js (errors chunk): `_scrml_error_boundary_check` / `_failure` / `_run` / `_show`.
- r1/r2/r3 after: r1 -> FALLBACK (no LOGGED IN), logged; r2 -> both FALLBACK; r3 -> inner fallback, renders for Empty,
  `@m` outside stays "init".
- Position sweep (shapes.mjs): template-literal `${}` -> E-ERROR-002 (fromText); value-form `${ if }` arm -> E-ERROR-002
  (codegen refusal); `!{}` arm value -> caught; `if (check())` statement -> caught; `<div if=…>` interpolation -> caught
  (render fn); `String(check())` -> caught; attribute `title=${…}` -> E-ERROR-002; `<each>` row -> E-ERROR-002
  (unlowered refusal); arrow body -> E-ERROR-002 (not render-time, unchanged).
- FOUND (out of scope, filed `g-lift-markup-failable-call-unchecked-s468`, HIGH): a `!` call in LIFTED markup is neither
  E-ERROR-002 nor caught — `lift <p>${check(it) ? "LOGGED IN" : "rejected"}</p>` renders LOGGED IN on origin/main
  5c43c3b8e AND on this branch, inside or outside a boundary (executed, happy-dom).
- Direction of change: semantics-changed (returned error in a boundary now caught; boundary interpolation with a handled
  call evaluated once, not twice) + newly-rejecting (render positions with no boundary catch site: attribute values,
  each rows, arm bodies, mount-deferred lift groups, text-carried positions; and E-ERROR-005 for value-position calls in a
  boundary without fallback). Corpus measurement: below.
