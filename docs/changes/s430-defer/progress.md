# s430-defer progress
- 2026-09-24T06:55:50-06:00 start, base f554e171
- 2026-09-24 live parser (77c3c015) + native parser (a7c5e705) landed: contextual `defer` -> live `defer-stmt {body[], blockForm}`.
- checks: validators/lint-defer.ts (E-DEFER-OUTSIDE-FUNCTION / -NESTED / -CONTROL-FLOW) wired in api.js; RI: defer-stmt tiered by its body, E-DEFER-SERVER-IN-SPLIT; TS: E-DEFER-UNHANDLED-FAILABLE replaces E-ERROR-002 inside deferred bodies.
- codegen: codegen/lower-defer.ts (defer -> try-stmt{deferLowered}; skips CPS-split top level), emitDeferScope, fn tail, CPS wrappers open try at defer / close after last batch.
- conformance/cases/defer/* (17 cases, codes + runtime incl. CPS after-last-continuation + intermediate-batch failure). Adversarial: naive top-level lowering FAILS cps-after-last-continuation ("start;D;").
- adapter fix: impl1-ts ROUTE_RE greedy capture never matched multi-batch routes (pre-existing).
- 2026-09-24T07:53:46-06:00 SPEC §19.16 written (compiler/SPEC.md, after §19.15) + §19.13 rows + §34 rows (824 census); SPEC-INDEX regenerated. Lambda/on-mount defer -> E-DEFER-OUTSIDE-FUNCTION (stage-1 limitation: lambda bodies are raw text in both front-ends). lin: counted at defer position (sound).
- 2026-09-24T08:09:52-06:00 corpus A/B (2577 tracked .scrml, base f554e171 vs build): 0 output diffs; 11 code diffs all stdlib E-ASYNC/E-AWAIT carve-out = harness artifact (base extracted outside repo root). Full suite: 59 fail = 48 browser FAILURE-BASELINE + 3 self-host tab parity (fail on base too) + 8 load flakes (pass in isolation). Added fn-prohibition-applies-neg case; live BLOCK_REF lead narrowed to ?{} (native parity).

## Fix round (adversarial review of e0eab761)
- merged origin/main (#1042 3676d2ae, #1044 a9c982dd, #1043 585261d9) as fa130767; only conflict SPEC-INDEX.md (regenerated); code files auto-merged clean, defer suite green after merge.
- F3 HIGH: lint-defer now scans raw-TEXT bodies inside a deferred body (value-form match arms `bare-expr` / `match-arm-inline.result`, `!{}` handler arm `.handler`, native `rawArms`) with a brace-aware scanner (`scanRawControlFlow`: strings/comments blanked; `=> {` / `function(){}` / method bodies skipped; loops/switch are break/continue targets; legacy `=>` arm arrow stripped first). if-expr arms were already structural.
- F1 MED: lower-defer hoists later function-decls in front of the try (unless the body mentions a let/const/lin/tilde binding declared after the defer — then it stays with the binding); CPS wrappers hoist later client function-decls before opening the defer try.
- F2 MED: emitDeferScope keeps the live tildeContext for the try body; emitFnShortcutBody's deferred-tail recursion inherits it.
- F4 MED: route-inference E-DEFER-SERVER-IN-SPLIT limb 2 — any defer nested in a top-level statement placed in a server batch fails closed.
- F5 LOW: message names the concrete trigger (callee "placed server-side" / `?{}` query / server-only resource).
- F6 LOW: hint + SPEC example use `!{ | _ :> … }` (verified compiles; runs at exit). SPEC split worked example replaced with the verified cps-after-last-continuation shape (the old one hit the pre-existing split `let … = ?{}.get()` drop).
- conformance: cps-intermediate-batch-failure -> cps-batch0-failure; NEW cps-batch1-failure (batch 0 ok, batch 1 fails -> "start;mid;D;") via a new per-batch `serverStub` directive `{ "__batches": [...] }` (adapter + README). NEW control-flow-in-value-arms-neg, function-hoist-across-defer, tilde-across-defer, server-block-nested-neg. Adversarial revert of F1/F2 fixes makes the new unit + conformance tests fail.

## Pre-existing items (reviewer list + found this round) — a queue, not fixed here
- raw `?` emission: a `?` in an expression-child position is emitted raw in some paths (reviewer).
- labelled `break` / `continue`: label handling (reviewer).
- single-batch CPS wrapper keeps running after a server `__scrml_error` when there is no return cell (reviewer; also found round 1).
- a `return` in a match-STATEMENT arm returns only from the arm's IIFE, not from the function (reviewer) — defer now rejects it inside deferred bodies regardless.
- a bare call to a SERVER fn is not counted failable for E-ERROR-002 / E-DEFER-UNHANDLED-FAILABLE (reviewer).
- native parser: `!{}` handler arms are dropped (`guarded-expr.arms: []`) -> E-TYPE-080 + no handling; `match <literal> { … }` mis-parses; `let k = if (…) {…}` value-form if is E-EXPR-UNEXPECTED KwIf.
- nested `function` declared inside an `if` block and called before it: E-SCOPE-001 (scope checker does not hoist block-level fn decls) — independent of defer.
- a nested function declared inside a CPS-split function is placed server-side / missing: `@x = @x + label()` became a reactive-server stmt calling `label()` server-side where `label` is not defined.
- multi-line statements in a function body are indented only on their first line (emit-functions scheduled-body loop).
