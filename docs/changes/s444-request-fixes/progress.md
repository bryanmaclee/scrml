# s444-request-fixes progress

- start: worktree /home/bryan/scrmlMaster/scrml/.claude/worktrees/agent-a4758775cb9f352c8, base c53b297a7 (== origin/main)
- baseline gate: 26679 pass / 72 skip / 12 todo / 0 fail

## Units (all committed)

1. g-request-deps-attr-ignored-both-forms: reproduced (url= one-shot; body deps=[@q,@ver] -> [q]; deps=[] -> inferred).
   Locus HELD (both readers). Fix: shared `readRequestDepsAttr` (reactive-deps.ts), null=absent / []=mount-only.
   Found while testing: every dep-driven re-fire effect (url deps=, api args=, body settle machine) ran the
   fetch TRACKED; the prologue's `.data` read subscribed the effect to its own result -> endless refetch loop
   (21 calls to the cap; example 32 = 51 calls to the cap on a Found decode). Fix: `_scrml_untracked(fetchFn)`.
   Tests: unit request-deps-attr-s444 (15); peter-20 assertion updated.
2. g-request-refetch-statement-dropped: reproduced (empty fn; later stmt dropped; leading form E-CODEGEN).
   Locus traced: block-splitter.js `<#` flushText split + ast-builder parseHandlerStatementListCore missing
   preprocessWorkerAndStateRefs. Tests: unit request-refetch-statement-s444 (11); bs-new-syntax pin updated.
3. g-request-body-client-wrapper-unawaited-one-shot: reproduced. Locus HELD (emit-client post-server-fn-iife-wrap
   matched only _scrml_fetch_/_scrml_cps_). Fix: also clientAsyncFactsOf().asyncFnNames by source name.
   Tests: unit request-body-client-wrapper-s444 (7).
4. Conformance: 6 lifecycle/request-*-rt cases (sqlEngine real).

## R26
examples/ + samples/ (948 sources) base vs branch: ONE artifact differs — examples/32-external-api client.js
(2 lines: api= args effect now `_scrml_untracked(...)`). Repro sources diffs all intended.

## Deferred (pre-existing, surfaced)
- multi-statement handler inside `${ for … lift <el onclick=${ a; b }> }` drops every statement after the first
  (no `<#` needed) — lift markup never gets a handlerBlock.
- `@` bare item in a multi-statement `<each>` row handler -> E-CODEGEN-INVALID-LOGIC.
- E-LIFECYCLE-022 / W-LIFECYCLE-013 have no emitter anywhere in compiler/src.
