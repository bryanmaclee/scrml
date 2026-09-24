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

## Round 3 (re-review of b61e3ac4) — Rule 7: structure, not text
- merged origin/main (#1046 b904818d, #1045 4b8ccdb8) as b120fcb8 — no conflicts; SPEC-INDEX regen unchanged; defer suite green.
- 1 (H1): lint-defer's text scanner (`blankLiterals` / `scanRawControlFlow` / `afterArmArrow`) DELETED. New `validators/defer-structure.ts`: text-carried arm/handler bodies are PARSED (block-splitter + ast-builder, the `_emitNestedGuardedArmBody` precedent; match arms split by codegen's own `parseMatchArm`) and walked by the SAME structural walker; unparseable -> E-DEFER-CONTROL-FLOW "could not be verified" (fail closed). Lambda / on-mount `defer` detection also switched from a regex to a native-parser parse (`textContainsDeferStatement`). Unit tests: tree-vs-handler-arm-vs-match-arm parity over 13 bodies (regex with `'` / `"` / `[/*]`, backtick in template, `{ return: 1 }`, EOL ternary, keywords in strings, lambda boundary, inner loop).
- 2 (H2+M1): lower-defer hoisting analysis structural — declared names via `iterDestructuredNames` (type-system), references via a scope-aware tree walk (`functionFreeRefs`; unknown -> keep inside). Same rule applied to the CPS-wrapper hoist. Conformance `hoist-structural` + no-defer twin `hoist-structural-twin` (identical trace); adversarial name-only revert -> "OUTER;D1;D2;".
- 3 (H3): a deferred `!{}` handler must carry `| _ :>` (E-DEFER-UNHANDLED-FAILABLE, lint-defer) and the lowering never emits the unmatched-error `return` inside a `finally` (`EmitLogicOpts.inDeferredBody`). Conformance `server-callee-error-total-handler` + twin (server callee answers CpsError/ServerError; @out = "OK" in both). Unit: adversarial removal of the guard fails the lowering test.
- SPEC §19.16.3 (rule 1 parse-verify + fail closed; rule 3 totality), §19.16.6 (structural hoisting), §19.16.8 (native divergence for handler arms stated), §19.13/§34 rows; index regenerated.

## Pre-existing (recorded, not fixed) — round 3 additions
- h11/h12: a `//` comment inside a `!{}` handler arm reaches the tree with its `//` stripped (`handler: "{\n return here\n…"`) — the front-end mangles it; codegen would emit that text as code. The defer checker now reports what codegen would emit (a `return`), which is at least not silent.
- h08: `for await` inside a handler arm slips past E-FOR-AWAIT-NOT-IN-SCRML (handler text is never walked by the async/await validator).
- native: `!{}` handler arms are dropped (`arms: []`) -> native compiles of deferred handlers get E-TYPE-080 + (now) E-DEFER-UNHANDLED-FAILABLE; §19.16.8 records the divergence.
- block-level nested function called before its declaration inside an `if` block -> E-SCOPE-001 (scope checker does not hoist block-level fn decls).

## Round 4 (re-review of 28cd5bb9) — replace the lowering: a per-block defer STACK
- merged origin/main (#1042-#1049) as 6157ba78: conflicts in compiler/src/api.js (import lines — kept both: runDeferChecks + forbidden-js-native) and SPEC-INDEX.md (regenerated + §19 note re-added); P5 seam test + defer suite green after merge.
- N1/N2 root cause = splitting the block at the defer and guessing what may move. REPLACED: each block with defers lowers to `const _scrml_defers_N = []; try { <whole block, in place> } finally { <run stack LIFO; all run; first host error rethrown> }`; each `defer S` -> `_scrml_defers_N.push(() => { S })` at its position. DELETED: hoisting analysis, functionFreeRefs, mayReferenceAny, listDeclaredNames/bindingNames, tail-name sets, the CPS-wrapper hoist. CPS wrappers: same stack, try opened at the TOP of the wrapper walk, finally after the LAST batch await. Closures are `async` + awaited iff the host body is async (server handler / SSE async generator / CPS wrapper / async client fn; a nested fn re-emits async when its body awaits).
- N3: fnOpts for a nested function-decl resets inDeferredBody + deferStack (+ deferAsync). Adversarial: removing the reset -> nested-fn-handler-in-defer gets "work;past;".
- host error in a deferred statement: SPEC'd (§19.16.2) run all remaining LIFO, then rethrow the FIRST; executed unit test + conformance deferred-host-error-runs-rest.
- conformance (+7): stack-arrow-helper-before-defer(+twin, 4), stack-fn-calls-fn-before-defer(+twin, "21"), nested-fn-handler-in-defer(+twin), deferred-host-error-runs-rest. Unit tests updated to the stack shape + executed runner tests (LIFO, errors, async).
- SPEC §19.16.6 rewritten (stack; "never moved on a guess" struck), §19.16.2 host-error rule.

## Pre-existing base bugs found by the round-3/4 reviewer (recorded, not fixed)
- `!{}` arm handler text is cut at the FIRST `}` — the rest of a multi-brace arm body is dropped.
- `| else :>` handler arm emits invalid JS (use `| _ :>`).
- `let v = f()?` followed by a newline merges with the next line (ASI).
- labelled loops lose their labels in emission (labelled `break`/`continue` target the wrong loop / fail).
- (ours, cosmetic) the scheduled client-fn body loop indents only the first line of a multi-line statement, so `const _scrml_defers_N = [];` is indented but the `try {` block is not.

## Round 5 (re-review of d80eb34c)
- main unchanged since the round-4 merge (origin/main b22f5e83 is an ancestor of HEAD) — no merge.
- F1 HIGH: E-DEFER-LATER-SHADOW (lint-defer `checkLaterShadow`): a deferred statement whose free identifier (from its TREE; its own declarations, lambda / nested-fn params bound; text arm bodies parsed) is (re)declared by a later let/const/lin in its enclosing block chain -> compile error naming the binding + both lines. Later `function` decls excluded (hoisted — in scope at the defer). Unanalysable + later decls present -> fails closed. Covers the shadow, TDZ-behind-early-return, enclosing-block and destructured variants.
- F2 MED: new validators/lint-redeclare.ts, E-SCOPE-REDECLARE (§7.3.3): let/const/lin/function redeclaring a same-block binding or (top-level block) a parameter; nested-block shadowing legal; fn-vs-fn left alone; file scope stays E-SCOPE-010. Corpus measured by COMPILING all 2616 tracked .scrml (base d80eb34c vs build): 0 files newly flagged, 0 output diffs (11 stdlib async/await code diffs = the known extraction-path harness artifact, as in rounds 1/5).
- F3/F4: E-DEFER-UNSUPPORTED-SITE — `defer` in a bare `{ }` block (live: bare-expr text; native: the bridge's Block flatten marks a direct Defer `inBareBlock`) or a single-statement match / handler arm; found by PARSING the text (native parser), not word matching. §19.16.2 amended (bare blocks are not stage-1 defer sites; structural bare-block parsing = a separate arc).
- F5: `yield` / `yield*` in a deferred body -> E-DEFER-CONTROL-FLOW (yield-stmt; escape-hatch parsed with the native parser inside a probe generator). §19.16.3 rule 1 amended.
- conformance +8 (defer: later-shadow-neg (4), later-shadow-ok (runtime), unsupported-site-neg (2), yield-in-defer-neg, scope-redeclare-with-defer-neg; fn: scope-redeclare-neg (3), scope-redeclare-nested-ok (runtime)). Unit +18.

## Noted, not fixed (round 5)
- brace-less `if (c) defer X` registers on the if-branch's own (implicit) block, so X runs when that branch exits — consistent with §19.16.2 but a footgun; candidate warning.
- F6 (pre-existing HIGH, reviewer filing as a gap): a nested function that becomes `async` because it calls a server fn is invoked WITHOUT await (`let r = inner()`), so its `!{}` tests a Promise and a transport error is silently lost.
- FOUND + FIXED this round (not in the review): a `defer` directly in an arm of a VALUE-producing match/if/for (value-form expression, or a `match` that is a `fn`'s implicit-return tail) lost the arm's value (`let k = match m { .A :> { defer D(); let t = 7; t } }` left k null — the tail was captured into a fresh tilde var inside the try). Now E-DEFER-UNSUPPORTED-SITE (§19.16.2 amended); conformance value-arm-site-neg. A braced `match` STATEMENT arm that is not a value tail stays a defer site.
- pre-existing (seen while probing): in a block, `D("a;")` followed by `1` on the next line merges into ONE statement (the `1` is swallowed) — the known newline-merge class.
- round 5 commit attempt 1 was stopped by the pre-commit hook: bare-assign-sql-init §6 — a keywordless `w = ?{…}` is carried as a const-decl tagged `_bareAssign` (an ASSIGNMENT); lint-redeclare flagged it as a redeclaration of `let w`. Both new checks now skip `_bareAssign` decls.
