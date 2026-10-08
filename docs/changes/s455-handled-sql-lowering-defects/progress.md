# progress — s455-handled-sql-lowering-defects (append-only)

- start at /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-ac6bfbe36dc5538d8, base 61f4b8e5b (== origin/main)

## Governing (compiler/SPEC.md at 61f4b8e5b, quoted)
- §19.8.3: "A `?{}` query is a **failable expression everywhere**. Outside a `!` function it is treated exactly like a call to a `!` function whose error type is `SqlError` (§19.4.3) …"
- §19.8.3 (handling form 1): "**A `!{}` handler on the query** — written after the terminator (`.get()`, `.all()`, `.run()`), its arms match `SqlError` variants"
- §19.8.3: "**"No row" is not a failure.** A query that runs and matches nothing succeeds: `.get()` on zero rows returns `not`, and `.all()` on zero rows returns `[]`, in every context …"
- §19.8.4: "A `?{}` query SHALL be a failable expression in every context. Outside a `!` function it SHALL be handled at the site with a `!{}` handler or a `match` (§19.8.3) …"
- §19.8.4: "A query that runs and matches no row SHALL NOT be a failure: `.get()` SHALL return `not` and `.all()` SHALL return `[]`."
- (§19.8.3 has no sentence "the arm value replaces the result" verbatim; that is sql-attempt.ts's header paraphrase of form 1 + §19.4.3. Nothing in §19.8.3/§19.8.4 lets a handler change the SUCCESS value or the function's placement / purity / protect analysis — the handler only adds a failure path.)

## Maps
- primary.map.md (stamp f38697900) S454 row: four-stage path (extractHandledOperands → RI decl walk → E-TYPE-080 → emitSqlQueryShape / case "guarded-expr"). LOAD-BEARING for the codegen locus (emit-logic `case "guarded-expr"` + sql-attempt.ts). It does NOT name the statement-level guard shape (guarded-expr WRAPS the statement), which is where the defects live.

## Reproduction on base 61f4b8e5b (phase0-probe.ts, real bun:sqlite; cells r_notes (1 row) / r_empties (0 rows) / r_gone (table missing → failure))
| stmt-run | impl1 base err=[] codes=[] · handled err=[] codes=[] | base ["\"after\"","\"after\"","\"init\""] | handled ["\"after\"","\"after\"","\"after\""] | DIFF
| stmt-bare | impl1 base err=[] codes=[] · handled err=[] codes=[] | base ["\"after\"","\"after\"","\"init\""] | handled ["\"after\"","\"after\"","\"after\""] | DIFF
| stmt-bare-obj | impl1 base err=[] codes=[] · handled err=[] codes=[] | base ["\"after\"","\"after\"","\"init\""] | handled ["\"after\"","\"after\"","\"after\""] | DIFF
| stmt-get | impl1 base err=[] codes=[] · handled err=[] codes=[] | base ["\"after\"","\"after\"","\"init\""] | handled ["\"after\"","\"after\"","\"after\""] | DIFF
| stmt-in-if | impl1 base err=[] codes=[] · handled err=[] codes=[] | base ["\"after\"","\"after\"","\"init\""] | handled ["\"after\"","\"after\"","\"after\""] | DIFF
| stmt-in-for | impl1 base err=[] codes=[] · handled err=[] codes=[] | base ["\"after\"","\"after\"","\"init\""] | handled ["\"after\"","\"after\"","\"after\""] | DIFF
| const-get | impl1 base err=[] codes=[] · handled err=[] codes=[] | base ["\"hello\"","\"none\"","\"init\""] | handled ["\"hello\"","\"none\"","\"none\""] | DIFF
| let-get | impl1 base err=[] codes=[] · handled err=[] codes=[] | base ["\"hello\"","\"none\"","\"init\""] | handled ["\"hello\"","\"none\"","\"none\""] | DIFF
| const-all | impl1 base err=[] codes=[] · handled err=[] codes=[] | base ["\"n=1\"","\"n=0\"","\"init\""] | handled ["\"n=1\"","\"n=0\"","\"n=0\""] | DIFF
| let-all | impl1 base err=[] codes=[] · handled err=[] codes=[] | base ["\"n=1\"","\"n=0\"","\"init\""] | handled ["\"n=1\"","\"n=0\"","\"n=0\""] | DIFF
| const-bare | impl1 base err=[] codes=[] · handled err=[] codes=[] | base ["\"n=1\"","\"n=0\"","\"init\""] | handled ["\"n=1\"","\"n=0\"","\"n=0\""] | DIFF
| reassign-get | impl1 base err=[] codes=[] · handled err=[] codes=[] | base ["\"hello\"","\"none\"","\"init\""] | handled ["\"hello\"","\"none\"","\"none\""] | DIFF
| return-get | impl1 base err=[] codes=[] · handled err=[] codes=[] | base ["{\"body\":\"hello\"}","null","\"init\""] | handled ["{\"body\":\"hello\"}","null","null"] | DIFF
| return-all | impl1 base err=[] codes=[] · handled err=[] codes=[] | base ["[{\"id\":7}]","[]","\"init\""] | handled ["[{\"id\":7}]","[]","[]"] | DIFF
| lift-all | impl1 base err=[] codes=[] · handled err=[] codes=[] | base ["[{\"id\":7}]","[]","\"init\""] | handled ["null","null","\"init\""] | DIFF
| if-cond-get | impl1 base err=[] codes=[] · handled err=[] codes=[] | base ["\"yes\"","\"no\"","\"init\""] | handled ["\"yes\"","\"no\"","\"no\""] | DIFF
| for-of-all | impl1 base err=[] codes=[] · handled err=[E-PARSE-001,E-PARSE-001,E-PARSE-001] codes=[E-PARSE-001,] | base ["\"n=1\"","\"n=0\"","\"init\""] | handled ["\"n=1\"","\"n=1\"","\"init\""] | DIFF
| cell-get | impl1 base err=[] codes=[E-DG-002,] · handled err=[] codes=[E-DG-002,] | base ["{\"body\":\"hello\"}","null","\"init\""] | handled ["\"init\"","\"init\"","\"init\""] | DIFF
| split-stmt-run | impl1 base err=[] codes=[E-DG-002,] · handled err=[E-RI-002,E-RI-002,E-RI-002] codes=[E-DG-002,E-RI-002,] | base ["\"after\"","\"after\"","\"after\""] | handled ["\"init\"","\"init\"","\"init\""] | DIFF
| split-const-all | impl1 base err=[E-RI-002,E-RI-002,E-RI-002] codes=[E-DG-002,E-RI-002,] · handled err=[E-RI-002,E-RI-002,E-RI-002] codes=[E-DG-002,E-RI-002,] | base ["\"init\"","\"init\"","\"init\""] | handled ["\"init\"","\"init\"","\"init\""] | SAME
| split-const-get | impl1 base err=[E-RI-002,E-RI-002,E-RI-002] codes=[E-DG-002,E-RI-002,] · handled err=[E-RI-002,E-RI-002,E-RI-002] codes=[E-DG-002,E-RI-002,] | base ["\"init\"","\"init\"","\"init\""] | handled ["\"init\"","\"init\"","\"init\""] | SAME
- (1) lift-all: handled success → `null` (row and no-row) — value dropped. CONFIRMED.
- (2) cell-get: handled → cells stay "init" (server-side `_scrml_reactive_set`). CONFIRMED.
- (3) for-of-all: E-PARSE-001 ×3, and r_empties reads n=1 (the error-effect became the loop body). CONFIRMED.
- (9) split-stmt-run: handled → E-RI-002 ×3 and cells stay "init". CONFIRMED.
- (5) .tmp shape `fn bad() { ?{…}.get() !{ _ :> not } … }`: see below. (8) register.scrml 44+49 handled → W-TYPE-031-UNPROVEN 7→8 (`result`, line 82 = the caller's `const result = registerServer(...)`). (7) protect/strip-client-visible-runtime handled → I-PROTECT-STRIP-001 1→0.
- Base note (pre-existing, NOT a handled-form defect): split-stmt-run base r_gone = "after" — an UNHANDLED failing write in a CPS-split fn still runs the client continuation (the no-returnVar wrapper `await stub()` ignores the envelope).

## Root (refined)
`!{}` after a STATEMENT is parsed as `guarded-expr { guardedNode: <the statement>, arms }` — the handled `?{}` is not a different sql node kind; the whole STATEMENT is wrapped. Every consumer that classifies statements by kind (state-decl / sql / lift-expr / sqlNode) or recurses only through ARRAY-valued children never sees `guardedNode` (a single-object field). Fix = one shared predicate (`handledSqlGuardInner`, sql-attempt.ts) + each statement-classifying consumer sees through a sql-handling guard to its statement. Restricted to guards that handle a `?{}` (a guarded CALL keeps its current semantics — out of scope).

## Fix (commits 1st WIP → tests) — one predicate, every statement-classifying consumer
`handledSqlOfGuardedNode` / `handledSqlGuardInner` (codegen/sql-attempt.ts): the guarded STATEMENT's query through every
kind a `!{}` can guard (bare `sql`, decl/return/state-decl `sqlNode`, `lift-expr` `expr.node`, whole-operand sql-ref).
Restricted to guards on a `?{}` — a guarded CALL keeps its semantics (out of scope; same blind spots exist for it).

Consumers changed (each now sees the guarded statement exactly as the unhandled one):
- emit-logic `case "guarded-expr"`: lift-expr (1), server state-decl (2, whole-server path), yield-stmt, hoisted-site flag.
- route-inference: findReactiveAssignment (E-RI-002 detection), analyzeCPSEligibility tiering + returnVarName (2)(9)(6);
  a server-tier guard whose arm leaves / re-fails / writes a cell is unsplittable → E-RI-002 with a cause sentence.
- emit-server CPS stub (both CSRF arms + multi-batch return cell), emit-functions CPS client wrapper (single + multi-batch).
- monotonicity-analyzer classifyStatement (idempotency middleware parity).
- body-dg-builder collectStatementFacts (6: table edges → E-CPS-MULTIBATCH-REORDER parity).
- type-system: fn-body walk + local decls (5), E-TYPE-080 predicate (now also `lift`), inferReturnTypeFromBody (8).
- protect-flow: `_scrml_sql_attempt` modelled exactly; tag skeleton read off the attempt's `run` (7).
- scheduling nodeIsReadOnly (10).
- collect.isServerOnlyNode (W-CG-001 top-level parity; library/export server-operation detection; CPS client guard).
- dependency-graph: top-level sql blocks, reactive decls, hasLiftAfter, fn-body reactive refs.
- meta-checker: runtime-meta SQL walk + phase-mixing.
- emit-control-flow §8.10 hoist: a handled keyed read in a hoisted loop (NEW defect 11, found by the enumeration:
  base emitted `null /* client cannot evaluate */` → every row `not` even on success) — attempt-wrapped pre-fetch.
- ast-builder for-of head (3): the `!{}` BLOCK_REF inside the parenthesized head is part of the iterable (3 sites).

Consumers enumerated and NOT changed (they reach guardedNode already): route-inference walkBodyForTriggers /
controlFlowContainsServerTrigger / detectServerFreeClientCellReads / session-read scan / describeDeferServerReason
(generic object recursion or explicit guarded-expr arms); type-system SQL-write leak visit (generic), decl/state visits
(reached via visitNode(guardedNode)); batch-planner walkAst (generic); db-ownership, protect-analyzer, reserved-prefix,
emit-functions cell-read scan, emit-server peer/currentUser scans (generic); scheduling cell-write batching (`st.sqlNode`
exclusions — client fns only; a guard is conservatively excluded).

## Repro, base 61f4b8e5b vs head (real bun:sqlite)
| item | base | head |
|---|---|---|
| (1) lift-all | null,null (drops value; failure throws) | [{id:7}], [], [] |
| (2) cell-get | init,init,init | {body:hello}, null, null(arm) |
| (3) for-of-all | E-PARSE-001×3; empties n=1 | clean; n=1, n=0, n=0(arm) |
| (5) fn ×3 shapes | E-FN-001 3→0 | 3 = 3 |
| (6) rails-crud-admin r13 | REORDER 1→0, REACTIVE-003 3→0 | same as unhandled |
| (7) protect assign-refresh | STRIP 1→0, E-PROTECT-006 0→2 | same as unhandled |
| (8) register.scrml 44,49 | W-TYPE-031 7→8 | 7 = 7 |
| (9) split-stmt-run | E-RI-002×3, cells init | clean; after,after,after |
| (10) Promise.all caller | 1→0 | 1 = 1 |
| (11) hoisted loop (new) | none,none / throws | hello,none / none,none(arm) |
| top-level W-CG-001 (new) | 1→0 | 1 = 1 |
| yield (new) | `let r = yield <raw>` | attempt + `yield r` |

## Evidence — whole-corpus emit differential (write:true) + conformance
`scripts/corpus-emit-differential.ts` base = `git archive 61f4b8e5b` (+ the 5 new conformance cases copied in so both
sides enumerate the same 2367 sources) vs head working tree. Verdict line says INCOMPARABLE only because the archive side
has no git revision (same as the R11 run). Enumeration 2367 = 2367; compile outcome 1425 ok both; syntax delta 0/0;
bare server-fn sites 212 = 212.
- Diagnostic-code changes: 2 sources, both NEW cases (fn/sql-access-handled-reject gains E-FN-001; sql-handled-split-write-rt
  loses E-RI-002) — the fixes.
- 244 differing artifacts: 236 differ ONLY by the compiler-root path (`_scrml_project_root`; normalized → byte-identical);
  2 = host-import relative path (module/e-import-003, e-import-008 client.js); 6 = the 4 new runtime cases' own artifacts.
  ZERO other corpus artifacts changed — every R11-rewritten site in the corpus emits byte-identically (expected: the R11
  rule's gate kept every site whose impl#1 codes/batching a handled form changed, i.e. every defect-triggering shape, LISTED).
- Execution sample: 30 runtime conformance cases holding R11 handled reads (`!{ _ :> not }` / `!{ _ :> [] }`) — PASS on base
  AND head (identical success-path state). Full conformance: base 1283 pass + 50 xfail + 5 FAIL (the 5 new cases) →
  head 1288 pass + 50 xfail; every other case identical.

## Review F1 (S239 on 94265ab3) — fixed
`guardArmsAreValues` scanned arm TEXT (Rule 7; fail-open: `!{ _ :> fallback }` with a client local, and `!{ _ :> mark() }`
with a transitive cell write, were split and ReferenceError'd on the server; FP on `"mail admin@x.io"`). Now an AST
allow-list (`armExprIsPureValue`): lit (no live template), ident ∈ {fn params, arm binding}, array/object/unary/binary/
ternary/member/index of those; the empty block `{ }`; anything else (call, @cell, client local, block statements, fail,
lambda, assign) → refused, E-RI-002 naming the arm. Both repros → E-RI-002; literal-with-@ and param arms admitted and
correct at runtime (new conformance server-db/sql-handled-cell-write-arm-values-rt; 4 unit tests). Re-ran: unit file 18/18,
conformance 1289 + 50 xfail, differential = same as before plus the new case's own artifacts (236 path-only, 2 host-import
path, 8 = the new cases).
