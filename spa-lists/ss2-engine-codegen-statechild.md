# sPA ss2 — engine-codegen-statechild

**Launch:** `read spa.md ss2` · **Branch:** `spa/ss2` · **Worktree:** `../scrml-spa-ss2`

**Fill:** ~28% · `at-ceiling` (headline `g-engine-name` arc RESOLVED S210 → Bucket C; b17 cases 1-3 → Bucket B)

## Shared ingestion
Engine codegen + derived-engine resolution: `emit-engine.ts`, `symbol-table.ts`
(`autoDeriveEngineVarName` export + engine var-derivation), `type-system.ts` engine arm. The
derived-engine autoderive crash keys on the engine codegen/resolution understanding. NOTE the headline
`g-engine-name` arc RESOLVED S210 (Bucket C); b17 cases 1-3 gated on the component-body parser
(Bucket B). This leaves a thin but real crash-fix here.

## Core files
`compiler/src/codegen/emit-engine.ts` · `compiler/src/symbol-table.ts` · `compiler/src/type-system.ts`

## Items (least-ingestion-first)
1. **`g-derived-engine-autoderive-crash`** `[status=open]` MED · tier med — `<engine for=@expr>` (derived-engine form) crashes compiler with `'autoDeriveEngineVarName is not defined'`. derived-engine decl (§51.0.J) throws a compiler-side `ReferenceError` (NOT a scrml diagnostic). `autoDeriveEngineVarName` IS a real symbol-table.ts export (§51.0.C lowercase-first, B14) → missing-import/out-of-scope CALL at the derived-engine codegen/resolution site. Reproduces on CLEAN main; ss3-surfaced S209 (two independent agents hit it incidentally); ss2 did NOT cover the derived-FORM crash. status=open.
   > **Brief seed:** Fix the out-of-scope `autoDeriveEngineVarName` call at the derived-engine codegen/resolution site (emit-engine.ts/symbol-table.ts). PA-repro first to verify scope + BUMP to HIGH if it fires on the common derived form. Convert the `ReferenceError` into either correct codegen or a proper scrml diagnostic.

## Progress
`ss2.progress.md`. Land on `spa/ss2`; ping PA inbox when ready. Do not advance main / do not push.
