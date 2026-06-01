# inline-sql-in-branch-cps-2026-06-01 — progress

## 2026-06-01T19:03:51Z — Phase 0 START + scope confirmation
- Worktree: /home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-a8ceba2fdd08a56b4 (HEAD 5082ff3c, base==main, clean).
- Startup verified: pwd ok, toplevel ok, bun install ok, bun run pretest ok.
- Reproduced all four probes:
  - P1 (top-level inline ?{} in client fn): COMPILES (works). Confirmed.
  - P2 (?{} in if-branch + following @cell write): E-RI-002. Confirmed.
  - P3 (server-fn-call in match arm + following @cell): COMPILES (works). Confirmed.
  - repro (inline ?{} in match arms + following @items=?{SELECT}): E-CG-006 + E-CODEGEN-INVALID-JS. Confirmed.

## Root cause located
- `analyzeCPSEligibility` (route-inference.ts:1377) classifies tier on the TOP-LEVEL
  statement grain only. It calls `isServerTriggerStatement` (route-inference.ts:1557),
  which checks node.kind==="sql" / bare-expr / let-/const-decl but does NOT recurse into
  nested control-flow bodies (if consequent/alternate, match-stmt body, for/while body).
- By contrast `walkBodyForTriggers` (route-inference.ts:828) — the FUNCTION-level
  escalation analysis — DOES recurse (generic array-recursion fallback L1252), so a nested
  ?{} escalates the WHOLE fn to server. That asymmetry is the bug:
  * whole-fn escalates (walkBodyForTriggers sees nested ?{})
  * but CPS split (analyzeCPSEligibility) does NOT see the nested ?{} as a server stmt,
    so the control-flow stmt is classified CLIENT.
  * P2: no reactive-server stmt -> hasServer=false -> CPS returns null -> whole-fn
    escalation wins -> E-RI-002 on the client @-write.
  * repro: @items=?{SELECT} is reactive-server so CPS IS eligible, BUT the match-stmt is
    classified client -> emitted into client wrapper raw -> nested ?{} leaks -> E-CG-006 +
    E-CODEGEN-INVALID-JS.
- P3 works because the arm calls a SEPARATE server-escalated fn (doAdd); the call lowers to
  a client-side fetch regardless of CPS, and the match-stmt stays validly client.

## Fix plan (tractable boundary-recognition extension; NOT the deferred conditional-tier rework)
- Extend `isServerTriggerStatement` to recognize a control-flow statement (if/match/for/
  while/switch) that CONTAINS a server-only resource (nested ?{} or detectServerOnlyResource
  hit, or protected-field access) anywhere in its nested bodies — WITHOUT descending into
  nested function-decl. Mirror walkBodyForTriggers's recursion discipline.
- Effect: the control-flow stmt's index lands in serverStmtIndices. Existing machinery then:
  * client wrapper (emit-functions.ts:831) replaces it with the single server-stub call;
  * server stub (emit-server.ts:1219) emits the control-flow stmt (with nested ?{})
    server-side via emitLogicNode (already handles control-flow+SQL on the server);
  * following @-writes stay client as the continuation.
- SPEC grounding: §12.2 Trigger 1/3 (?{} escalates), §19.9.9.1 tier table ("server = own
  ?{} SQL ... or other server-only resource"), control-anchors edge explicitly fences a
  control-flow stmt as a server batch (anticipates control-flow being server-tier).
- P3 (server-fn-call-in-arm) machinery proves the split path generalizes.

## Phase 0 VERDICT: tractable. Proceeding to fix.

## 2026-06-01T19:22:03Z — Fix landed + tests
- Commit 890152ed: classification fix (isServerTriggerStatement recurses into
  control-flow nested bodies → control-flow stmt classified server-tier). Closed P2
  (if-branch was E-RI-002) fully. Pre-commit gate PASS (15467 pass / 0 fail).
- Surfaced a PRE-EXISTING match-stmt server-emit defect: a match-stmt emitted inside a
  server batch wrapped in a SYNC IIFE (breaking nested `await _scrml_sql`) and rewrote
  `@cell` reads via `_scrml_reactive_get` (client) instead of `_scrml_body[...]` (server).
  Confirmed pre-existing via git-stash: a pure server fn (no CPS) with a match+nested ?{}
  ALSO produced E-CODEGEN-INVALID-JS on baseline.
- Commit df099544: coupled emit fix in emit-control-flow.ts — emitMatchExpr threads
  server-mode (opts.boundary==='server') into the arm EmitExprContext + rewriteBlockBody
  (new optional mode param, default 'client'), and async-wraps the IIFE as
  `await (async function(){...})()` in server mode. Pre-commit gate PASS.
- R26 empirical (all on post-fix baseline):
  * match-arm repro (user S152 shape): COMPILES; server emits async-IIFE match with
    INSERT/UPDATE/DELETE + `_scrml_body["draft"]`; `@items=?{SELECT}` returned to client;
    client.js zero SQL leak + parses as classic script (vm.Script). WAS E-CG-006 +
    E-CODEGEN-INVALID-JS.
  * P2 (if-branch): COMPILES; was E-RI-002.
  * P1 (top-level): COMPILES (regression-clean).
  * P3 (server-fn-call in arm): COMPILES (regression-clean).
  * pure-server match (named-fn): COMPILES (pre-existing defect closed as side-effect).
- New unit test compiler/tests/unit/inline-sql-in-branch-cps.test.js: 12 tests, all pass
  (match arm / if branch / for body / + regression P1 / P3 / named-fn).
- Targeted regression sweep: route-inference + ext1-m1-1..5 + s144 + a9-ext4 + bug-56 (312
  pass); match/control-flow + cg-006 + sql-runtime (410 pass). 0 fail.
