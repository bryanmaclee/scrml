# Tranche 3 — end-to-end SQL-row type-flow (the "connecting middle")

change-id: typed-sql-row-tranche3-2026-06-08
worktree: /home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-acdf67ab0b4a0a2d8
base SHA: 1dbf67b4 (T2 landed)

## PHASE 0 — SURVEY + SIZE (complete)

### Startup
- pwd OK (under .claude/worktrees/agent-acdf67ab0b4a0a2d8), toplevel == worktree, status clean.
- bun install + pretest OK.
- Baseline `bun run test`: 23520 pass / 220 skip / 1 todo / **2 fail**.
  - The 2 fails are `TodoMVC §0/§1` (benchmarks/todomvc/dist timing — env/pretest ordering
    artifact, NOT type-system). Pre-existing & unrelated. The brief's "23521/0" reflects a
    different run ordering; dist files DO exist. Treating 23520/2(todomvc-env) as baseline.

### Maps feedback
- `.claude/maps/primary.map.md` read in full. Watermark `f0b3cb04`; HEAD `1dbf67b4` is +2 (T1+T2).
  Map is STALE for type-system.ts (T1/T2 functions not in the map). Verified the real loci by
  grep/Read. LOAD-BEARING finding: the "diagnostic-authoring" + "bare-variant inference" task-shape
  rows correctly pointed at type-system.ts decl-site scans + the `case state-decl`/`let-const-decl`
  structure; the T1/T2-specific functions (`resolveSqlRowType` :5622, `checkSqlRowWidthSubtype` :693,
  `checkPropContract` :9231, `resolveIterableRowElement` :5752, `checkRowFieldAccessInExpr` :9163)
  had to be grep-located (map names them only by the brief's hints, not the map body).

### Real flagship pattern (board.scrml — differs from the brief's simplification)
- `<loadRows> = []` (line 73) — NO annotation today. Brief wants `<loadRows>: LoadCardRow[] = []`.
- `@loadRows = data.loadRows` (line 85) is inside **function `refresh()` body**, NOT a markup `${}`
  block. Reassignment → ast-builder emits a `state-decl` (init="data.loadRows", initExpr present).
- `const data = loadBoardData(tok)` (line 79) inside `refresh()` — `data.loadRows` is member-access
  on a CALL result → needs T3c return-type inference.
- `for (let l of @loadRows)` loops (183/201/219) are in markup `${}` blocks → already routed via
  `resolveIterableRowElement` (T2a); they look up `@loadRows` in scope. After T3a/T3b, `@loadRows`
  binds `LoadCardRow[]` → `l: LoadCardRow` → `<LoadCard load=l>` checked by T2's prop contract.
- `<LoadCard load=l customerName=l.customer_name/>` passes BOTH props.

### LoadCardRow contract (recovered from T2 branch worktree-agent-a0c9dc58ba5f79970)
10 fields, matches load-card's read-set exactly:
  id:number, status:string, origin_city:string, origin_state:string, destination_city:string,
  destination_state:string, commodity:string, weight_lbs:number, pickup_at:string, rate_dollars:number
Board's projection SELECTs all 10 + extras (customer_id, deliver_by, customer_name) → width-superset
→ width-subtyping passes 0 violations.

### T3a — state-decl SQL-init typing (BOUNDED, small)
- `case "state-decl"` (type-system.ts ~:7191) starts `resolvedType = tAsIs()` and never consumes
  `sqlNode`. The ast-builder ALREADY attaches `sqlNode` to state-decl nodes for `<x> = ?{...}.all()`
  / `<x>: T = ?{...}.all()` / `@x = ?{...}.all()` (ast-builder.js:5716/5742/5824/5887).
- Fix: mirror the let/const path — early in `case "state-decl"`, if `n.sqlNode?.kind === "sql"`, set
  `resolvedType = resolveSqlRowType(sqlNode, span)`. Annotation still wins (handled below in T3b).

### T3b — width-subtyping at the cell decl/assignment boundary (BOUNDED)
- When a state cell carries a `:struct[]` (or `:struct`) contract annotation AND its initializer OR a
  later `@cell = <sql-row-source>` reassignment resolves to a SQL projection row (`Row[]`/`Row|not`),
  run `checkSqlRowWidthSubtype` element-wise → fire E-SQL-ROW-CONTRACT-MISMATCH on mismatch.
- Mechanism: new bounded helper `checkSqlRowAgainstCellContract(rowSourceType, contractType, span)`
  that (a) unwraps the contract array element to a struct, (b) unwraps the source via
  `unwrapSqlProjectionRow`, (c) runs `checkSqlRowWidthSubtype`. Fired at the state-decl site when
  BOTH the annotation resolves to a `:struct`/`:struct[]` and the init/reassign resolves to a sql-row.
- Bounded: SQL-row → declared `:struct`. General assignment unaffected (gated on sql-row provenance
  AND struct-contract, same gate as T2's checkPropContract).

### T3c — struct-return field-type propagation (THE HARD PART — sized BOUNDED)
SIZING VERDICT: **bounded, NO new interprocedural pass, NO annotated-fn behavior change.**
- `fnSignatures` (type-system.ts:5833) ALREADY pre-collects a `returnType` per fn; today un-annotated
  fns get `tAsIs()` (5867). `collectFnErrorTypes` (5838) ALREADY walks `n.body` and shares the
  `annotateNodes` closure with `resolveSqlRowType` + `typeRegistry`.
- Approach (narrowest that types the flagship chain):
  1. In `collectFnErrorTypes`, when `returnAnnot` is ABSENT (annotated fns untouched), call a new
     bounded `inferReturnTypeFromBody(fnNode)`:
       - First pass over `fnNode.body`: build a local `name -> ResolvedType` map for `const/let X =
         ?{...}.all()/.get()` SQL decls (via `resolveSqlRowType` with a throwaway error sink so the
         pre-pass does NOT double-emit W-SQL-ROW-UNTYPED — those fire at the real decl visit).
       - For each `return-stmt` whose `exprNode.kind === "object"`, build a struct type: each prop's
         value, if a bare `ident` resolving to a SQL-typed local, → that local's row type; everything
         else → asIs (conservative). Non-object returns → asIs arm.
       - Union across all returns (the auth early-return `{unauthorized:true}` makes the type
         `{unauthorized:bool} | {user:asIs, loadRows: Row[]}`).
  2. const-decl call-result resolution: at the `case "const-decl"`/`"let-decl"` site, when the
     initExpr is a `call` to a fn in `fnSignatures` (and no SQL/annotation already set the type), set
     `resolvedType` to the fn's `returnType`.
  3. member-access `data.loadRows`: today's T2a `checkRowFieldAccessInExpr` only fires E-TYPE-004; it
     does NOT thread a result type. For T3b's reassignment boundary I resolve the RHS `data.loadRows`
     type directly: a small `resolveSqlRowSourceFromExpr(exprNode, scopeChain)` that handles (a) bare
     ident bound to a sql-row, AND (b) `member(ident, field)` where the ident is bound to a struct
     (incl. union arm) whose field is a sql-row array. This is the connective tissue.
- BOUND: object-literal-return inference ONLY (no general return inference). Union is handled
  conservatively — `data.loadRows` resolves to `Row[]` because the field is present-and-sql-row in one
  arm; absent/asIs in the other arm does NOT downgrade (the field-present arm wins for the bounded
  sql-row flow). Do NOT over-fire on the union (the `{unauthorized}` arm has no `loadRows`, but we are
  resolving a specific member-access, not exhaustively type-checking the union).

### T3d — markup-block `?{}` typing (NOT on flagship critical path)
- Surveyed every `?{}` in examples/23-trucking-dispatch: ALL are inside FUNCTION BODIES (const X =
  ?{}.method() / return ?{}.method()), NONE as a markup-`${}` state-cell initializer. The flagship
  does NOT hit markup-block `?{}` typing. Keeping T3d minimal: T3a's state-decl wiring already covers
  `<x> = ?{...}` regardless of whether the state-decl lives in a markup block or a logic block (same
  node kind). No extra work needed; noted.

## BUILD ORDER
T3a (state-decl sqlNode) → T3c (return-type inference + call-result + member-access resolver) →
T3b (cell-boundary width-subtyping) → dogfood re-apply → R26 + full suite.


## BUILD COMPLETE

### Commits
- f858d202 — Phase-0 survey + sizing.
- a10624f0 — T3a/T3b/T3c machinery + 17 unit tests (pre-commit gate GREEN).
- (this commit) — flagship dogfood re-apply.

### T3c SIZING VERDICT (reported pre-build, confirmed in build)
BOUNDED. No new interprocedural pass; no annotated-fn behavior change. Reuses the
existing `fnSignatures.returnType` slot + the existing `collectFnErrorTypes`
body-walk + the shared `resolveSqlRowType` closure. `inferReturnTypeFromBody` is
INERT for every fn that does not flow a SQL row out via an object-literal return
(returns null → caller keeps `tAsIs()`). Surfaced one design subtlety during
build: the inferred `<fn-return>` struct is an over-approximation (one arm of a
union return), so T2a's E-TYPE-004 member-access check would FALSE-POSITIVE on
`data.error` (the `error` field is in a different return arm) — fixed by exempting
`<fn-return>`-named structs from E-TYPE-004 (they exist only to thread the row to
the cell boundary, not to enforce field access).

### PROOF — flagship chain types END-TO-END (production typer, probe reverted)
- `const data = loadBoardData(token)` → `data: struct <fn-return>` with
  `loadRows: <sql-row>[]` (T3c — `data.loadRows` resolves to `Row[]`).
- `@loadRows` bindType → `array of struct LoadCardRow` with real primitive field
  types (id:number, status:string, ...) — NOT asIs. The width-subtyping check
  ENGAGED at the cell boundary with 0 violations (board projection covers all 10
  LoadCardRow fields). `l: LoadCardRow` flows into `<LoadCard load=l/>`.
- Full flagship compile: EXIT 0, 0 E-SQL-ROW-CONTRACT-MISMATCH, 0 E-TYPE-004.
- Negative fixture (e2e unit test, missing column) fires E-SQL-ROW-CONTRACT-MISMATCH
  naming `rate_dollars`.

### CODEGEN UNCHANGED (definitive)
With the T3 machinery at HEAD but WITHOUT the dogfood, the entire flagship emitted
JS is BYTE-IDENTICAL to the T2 baseline (`diff -rq` empty). The ONLY emitted-JS
delta in the full dogfood build is the added `LoadCardRow` import in board (client
+ server) — a direct consequence of the dogfood's `import { LoadCardRow }`, NOT the
type-system machinery (a struct type emits no runtime code). `node --check` exit 0
on all emitted JS.

### T3d
NOT on flagship critical path (all flagship `?{}` are in function bodies, not
markup-`${}` state-cell initializers). T3a's state-decl sqlNode wiring already
covers `<x> = ?{}` regardless of markup-vs-logic block (same node kind). No extra
work; noted.
