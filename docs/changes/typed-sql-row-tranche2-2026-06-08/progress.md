# Tranche 2 — Shape C: cross-file typed-prop contract + structural width-subtyping
# change-id: typed-sql-row-tranche2-2026-06-08

## PHASE 0 — SURVEY (2026-06-08)

WORKTREE: /home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-a0c9dc58ba5f79970
Base HEAD: 45bea7c5 (Tranche 1)
Baseline compile of examples/23-trucking-dispatch: EXIT 0 (clean).

### Architecture facts discovered (the brief is OFF on the T2b type-flow assumption)

1. **Pipeline order**: BS -> TAB -> CE (Stage 3.2) -> BPP -> PA -> RI -> TS (Stage 6).
   CE runs BEFORE TS and **inlines/expands** each component body at the call site,
   substituting prop refs with the caller's actual expr (text + ExprNode substitution).
   By TS time, `<LoadCard load=l/>` is the inlined `<a>` markup with `l.id`, `l.status`
   substituted for `load.id`, `load.status`. `component-def` is CONSUMED by CE; TS sees
   `case "component-def" -> tAsIs()` only on the rare un-expanded residual.

2. **`checkStructFieldAccess` (E-TYPE-004) EXISTS but is DORMANT** — defined+exported+
   unit-tested at type-system.ts:8945, but NOT wired into the live visitNode walk.
   It looks up `objName` in scope; if `resolvedType.kind==="struct"`, validates the field,
   fires E-TYPE-004 on unknown field. This is exactly the T2a tool — it just needs (a) the
   binding to carry the struct element type, and (b) a live wire-in on body exprs.

3. **TS does NOT type-check arbitrary expr field-access today** (only engine `self.field`).
   No general `typeOfExpr` resolver. So `load.bogus` errors nowhere today.

4. **The flagship dogfood call-site is NOT `<each in=@rows as load>`.**
   board.scrml uses `for (let l of @loadRows) { ... lift <div><LoadCard load=l/></div> }`.
   - `for-stmt`/`for-loop` binds the loop var `l` to **tAsIs()** (type-system.ts:8363) —
     does NOT carry `@loadRows`' element type.
   - `<each>` (each-block) ALSO binds `asName` to **tAsIs()** (type-system.ts:8459) —
     does NOT carry element type either. (The brief's `<each ... as x>` element-type flow
     does NOT exist; neither for-stmt nor each-block threads it.)

5. **The SQL projection-row type is LAUNDERED before reaching the call site.**
   board.scrml flow: `?{SELECT ...}.all()` (typed Row[] by Tranche 1, as a LOCAL `rows`
   in `loadBoardData()`) -> returned wrapped in a struct `{ user, loadRows: rows }` ->
   assigned to state cell `@loadRows` (declared `<loadRows> = []`, typed asIs[]) ->
   iterated `for (let l of @loadRows)`. The Row[] type is LOST at the struct-wrap return
   AND again at the asIs state cell. So even threading for-of element type yields `asIs`,
   NOT the projection row. **The SQL-row type does NOT flow to the LoadCard call site at all.**

6. **load-detail.scrml does NOT use LoadCard.** Brief claim ("board + load-detail rows both
   width-subtype into LoadCardRow") is factually wrong — LoadCard is used ONLY in board.scrml
   (3 sites). The "load-detail wider row" dogfood does not exist.

7. **Cross-file `:struct` resolution WORKS** (api.js importedTypesByFile + buildTypeRegistry).
   A `type LoadCardRow:struct = {...}` exported from load-card.scrml imports into board.scrml.

8. **load-card.scrml body reads 10 fields**, not the brief's 6: id, status, origin_city,
   origin_state, destination_city, destination_state, commodity, weight_lbs, pickup_at,
   rate_dollars. The contract MUST cover the full read-set or T2a wiring fires E-TYPE-004
   on commodity/weight_lbs/pickup_at/rate_dollars.

### VERDICT: PROCEED with SCOPE CORRECTION (not a hard STOP)

The width-subtyping HELPER + the SPEC amendment + the §34 code + T2a (typed prop access via
the dormant checkStructFieldAccess + element-type thread) are all buildable and coherent.

The T2b "call-site width-subtyping check at the LoadCard instantiation" CANNOT fire on the
flagship as-is because the SQL-row type is laundered through a struct-wrap return + an asIs
state cell + a for-of. To make T2b OBSERVABLE end-to-end we need a call site where the
projection Row type actually reaches the `<Comp prop=expr/>` instantiation in TS scope.

PLAN (revised, bounded, honest):
- BUILD the bounded structural width-subtyping helper (`isWidthSubtypeAssignable`), scoped to
  source=<sql-row> struct, target=declared :struct contract. General struct assignment NOMINAL.
- T2a: thread the SQL-row ELEMENT type through `for-of`/`each` when the iterated collection's
  type resolves to `Row[]` (array of <sql-row> struct), binding the loop var to the row struct;
  AND wire `checkStructFieldAccess` live on the body so `load.id` types / `load.bogus` -> E-TYPE-004.
  This is GATED on the bounded sql-row provenance (only sql-row struct element types bind non-asIs,
  preserving today's permissive bare-row access for non-contracted rows).
- T2b: at a component instantiation `<Comp prop=expr/>`, when (a) the component's prop is declared
  a `:struct` contract AND (b) `expr`'s resolved type is a <sql-row> struct (or Row[]'s element),
  run the bounded width-subtyping check; fire E-SQL-ROW-CONTRACT-MISMATCH on a missing/incompatible field.
- DOGFOOD: author `type LoadCardRow:struct = {...10 fields...}` in load-card.scrml, migrate
  `load: asIs` -> `load: LoadCardRow`. To make the board call-site's row type REACH the check,
  the board flow needs the projection type preserved to `l` — surfaced as a SCOPE item; the
  realistic in-window dogfood is the DEFINITION-file typed-prop-access (T2a) + a synthetic
  positive/negative fixture for T2b (a direct `?{...}.all()` -> `<each>` -> `<Comp>` where the
  Row[] type survives to the binding). FULL board end-to-end T2b requires struct-return field
  type propagation (return `{loadRows: rows}` carries rows: Row[]) — assess during build.

### SPEC placement (proposed)
- NEW **§14.8.8 "Cross-file projection-row contracts via structural width-subtyping"** after §14.8.7
  (which already forward-references "Tranche 2 ... separate, later addition"). States: ratified S175;
  the BOUNDED rule (sql-row struct -> declared :struct); reverses §14.8.1/§14.8.4/§14.8.7 nominal
  walls ONLY for this case; general struct assignment stays nominal.
- Cross-ref tail in §14.3 (Struct Types) + §15.11 (component props).
- §34: NEW row **E-SQL-ROW-CONTRACT-MISMATCH** (Error), placed next to W-SQL-ROW-UNTYPED (16516).

### §34 code (proposed)
`E-SQL-ROW-CONTRACT-MISMATCH` — Error. Fires when a SQL-projection-row value is passed to a
component prop / annotation declared as a `:struct` contract and the row does NOT width-subtype:
a required contract field is absent from the row, or a present field's type is not assignable.
Per-violation message names the missing/incompatible field + the contract type.

## BUILD (2026-06-08)

LANDED (per-commit):
1. Phase-0 survey (db520c48)
2. Bounded width-subtyping helper §14.8.8 (5086e183): checkSqlRowWidthSubtype +
   fieldTypeAssignable + fieldTypeEquals + isSqlProjectionRowStruct +
   unwrapSqlProjectionRow + SQL_ROW_TYPE_NAME. Source=<sql-row>, target=:struct.
3. T2a (25f38b66): resolveIterableRowElement threads sql-row element type to
   for-of/each loop var; checkRowFieldAccessInExpr (live, module-level) wired into
   checkLogicExprIdents -> E-TYPE-004 on unknown field. Gated on sql-row provenance.
4. T2b + dogfood (T2b commit): CE stamps __propContractChecks; TS checkPropContract
   runs the bounded check -> E-SQL-ROW-CONTRACT-MISMATCH. LoadCardRow :struct in
   load-card.scrml; load: asIs -> LoadCardRow.
5. Tests (brt3enbnp): 18 unit tests — helper + T2a e2e + checkRowFieldAccessInExpr
   + checkPropContract. All pass.
6. SPEC amendment (this commit): §14.8.8 + §34 E-SQL-ROW-CONTRACT-MISMATCH + cross-refs.

## SCOPE CORRECTIONS surfaced (the brief was OFF)

A. **T2b live-pipeline observability is BLOCKED by two PRE-EXISTING Tranche-1 boundaries,
   NOT by Tranche-2.** The brief assumed the board.scrml row type flows to the LoadCard
   call site. It does NOT:
   - (i) **function→markup laundering**: the SQL Row[] is typed only inside the server
     function `loadBoardData()`; it is returned wrapped in `{ user, loadRows: rows }`
     (struct-return drops the field's Row[] type) and stored in an `asIs` state cell
     `<loadRows> = []`. By the `for (let l of @loadRows)` call site, `l` is `asIs`.
   - (ii) **markup-block SQL decls are NOT row-typed**: a `const x = ?{...}.all()` inside a
     markup `${}` interpolation block does NOT get the projection-row type (no W-SQL-ROW-
     UNTYPED, no E-TYPE-004 — verified). Tranche-1 wired sql-row typing for function-body
     let/const-decls + the sql-node case; markup-embedded logic decls follow a path that
     does not lower the `?{}` to a `sqlNode`-bearing decl. This is Tranche-1 plumbing.
   Net: T2a fires end-to-end in FUNCTION bodies (proven). T2b's mechanism is correct and
   unit-proven (checkPropContract fires E-SQL-ROW-CONTRACT-MISMATCH given a row-typed
   binding) but cannot be observed through the live markup pipeline until BOTH Tranche-1
   boundaries are lifted (struct-return field-type propagation + markup-block SQL-row
   typing). Recommend a Tranche-3 follow-on. The dogfood migration (LoadCardRow + load:
   LoadCardRow) is non-breaking and DECLARES the contract; the check no-ops (correctly)
   on the laundered `l`.

B. **load-detail.scrml does NOT use LoadCard.** The brief's claim ("board + load-detail
   rows both width-subtype into LoadCardRow") is wrong — LoadCard is used ONLY in
   board.scrml (3 sites). The "load-detail wider row" width-subtyping is proven in the
   unit test (LOAD_DETAIL_ROW superset subtypes into LoadCardRow) but is not a live call site.

C. **The contract is the 10-field READ-SET**, not the brief's 6-field illustrative LoadCardRow.
   load-card.scrml reads id, status, origin_city, origin_state, destination_city,
   destination_state, commodity, weight_lbs, pickup_at, rate_dollars.

D. **Each-binding / for-of did NOT carry element type** (brief Phase-0 Q2) — confirmed
   missing; threaded for both (bounded to sql-row provenance).

E. **checkStructFieldAccess (E-TYPE-004) was DORMANT** — exported + unit-tested, never
   wired live. T2a adds the live wire-in via checkRowFieldAccessInExpr (a robust ExprNode
   walker, not the string-regex helper).
