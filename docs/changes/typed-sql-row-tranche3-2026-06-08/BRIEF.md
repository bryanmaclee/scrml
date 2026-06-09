# Tranche 3 — end-to-end SQL-row type-flow (the "connecting middle") — change-id: typed-sql-row-tranche3-2026-06-08

Dispatched S175 (2026-06-08) to scrml-js-codegen-engineer, isolation:worktree, model opus, background. Agent acdf67ab0b4a0a2d8. Follows T1 (45bea7c5) + T2 (1dbf67b4). Ratified S175 = option (B) full struct-return type-flow (user-voice scrmlTS S175 cont). PHASE-0-GATED; T3c (return-type inference) is the HARD part — size it first, STOP if it balloons.

## GOAL: the flagship board.scrml chain types END-TO-END
rows: Row[] (T1) -> return {user, loadRows: rows} [T3c carries loadRows: Row[]] -> @loadRows = data.loadRows [<loadRows>: LoadCardRow[] cell; T3b width-subtypes Row[] into LoadCardRow[]] -> for l of @loadRows [l: LoadCardRow] -> <LoadCard load=l> [T2 prop OK].

## FOUR PIECES
- T3a: state-decl SQL-init typing — case state-decl (~:7191) doesn't consume sqlNode like let/const (~:6979); wire it (<x> = ?{...}.all() types the cell).
- T3b: width-subtyping at the cell decl/assignment boundary — when a cell is :struct-contract-annotated and its init/`@cell =` RHS is a SQL row/Row[], run checkSqlRowWidthSubtype (§14.8.8 helper ~:668) elementwise; fire E-SQL-ROW-CONTRACT-MISMATCH. Bounded.
- T3c (HARD): struct-return field-type propagation — un-annotated fn gets returnType=tAsIs() (~:5867); infer return type from return-stmt object literals ({user, loadRows: rows} -> struct {user, loadRows: Row[]}), UNION across returns (auth early-return {unauthorized} | {user, loadRows}), conservative on the union; call-site data.loadRows resolves via member-access. BOUND: don't change annotated-fn behavior; don't do full general return-type inference; propose narrowest form; STOP if it needs a new interprocedural pass.
- T3d: markup-block ?{} typing — extend resolveSqlRowType wiring to ?{} in markup ${} blocks IF the flagship hits it; else minimal.

## RE-APPLY DOGFOOD (reverted at T2): load-card.scrml load: asIs -> load: LoadCardRow (10-field contract; recover from T2 branch worktree-agent-a0c9dc58ba5f79970 or re-derive) + annotate board cell <loadRows>: LoadCardRow[] = []. Full chain must type; if projection !⊇ contract, the check SHOULD fire naming the missing field (feature working) — reconcile contract to read-set+projection.

## OUT OF SCOPE: protect-column leak (deferred); general return-type inference; codegen changes (compile-time typing only — verify emitted JS UNCHANGED).

## PHASE 0: survey + SIZE T3c, propose narrowest bounded form, STOP if it balloons / changes annotated-fn behavior. Report design before impl.

## COMMIT S83; no --no-verify. PHASE 3 R26 on 23-trucking-dispatch: @loadRows: LoadCardRow[] (not asIs), data.loadRows: Row[], width-subtyping ENGAGES (0 mismatch if projection ⊇ contract, or fires on real missing field), l: LoadCardRow into <LoadCard>; node --check 0; codegen UNCHANGED; full suite green vs 23,521/0; negative fixture fires. DO NOT mark DONE without the chain typing on the flagship + green.

## REPORT: WORKTREE_PATH, FINAL_SHA, FILES_TOUCHED, Phase-0 design + T3c sizing, end-to-end-chain proof (@loadRows type, data.loadRows type, check engaging), codegen-unchanged, R26 + full-suite delta, SCOPE corrections, MAPS feedback.
