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
