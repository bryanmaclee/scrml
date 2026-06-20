# sPA ss7 — meta-reflect-l22

**Launch:** `read spa.md ss7` · **Branch:** `spa/ss7` · **Worktree:** `../scrml-spa-ss7`

**Fill:** ~45% · `at-ceiling` (design forks `compiler.*`/`variantNames`/`serialize`/serializability routed to Bucket B)

## Shared ingestion
L22 meta layer: `reflect()`/`^{}` compile-time meta-eval + the happy-dom mount path for meta-heavy
samples. Shared loci: `meta-checker.ts` (reflect `.variants` build paths + meta-eval) and the
render-harness mount path. The reflect-variant shape bug and the rails-dev mount hang are both
reachable from `meta-checker` + the meta-eval/mount understanding. (Design forks
`compiler.*`/`variantNames`/`serialize` routed to Bucket B.)

## Core files
`compiler/src/meta-checker.ts` · `samples/gauntlet-r18/rails-dev.scrml` · `compiler/tests/e2e-render-map/render-harness.js`

## Items (least-ingestion-first)
1. **`g-reflect-variant-shape-inconsistent`** `[status=open]` LOW · tier low — `reflect()` returns enum `.variants` with inconsistent element shape across internal paths (string vs `{name}`). meta-checker.ts builds `.variants` THREE ways: :1463-1464 maps to bare strings; :2041/:2209 build `{name}` objects; type decl :264 admits the union `Array<string|{name:string}>`. Compile-time `^{}` `reflect(Status).variants` returns STRINGS (matching §14.4.2 `EnumType.variants`=name strings) so a consumer writing `${v.name}` silently gets undefined. status=open verified HEAD (:264 union confirmed).
   > **Brief seed:** Pick ONE canonical shape (strings, per §14.4.2) across all three reflect `.variants` paths in meta-checker.ts (:1463/:2041/:2209), or document the union explicitly. Strings is the standing-spec answer. R26 a consumer `${v.name}` case.
2. **`g-mount-hang-rails-dev`** `[status=open]` LOW · tier low — `rails-dev.scrml` hangs indefinitely at happy-dom mount (compiles fine). Compiles ~0.8s but HANGS at happy-dom mount (0% CPU = blocked not looping) — a real runtime mount-time await/effect that never resolves in happy-dom (likely a `^{}` meta-eval loop or never-resolving mount effect). render-map records HARNESS-TIMEOUT. stress-sample (gauntlet), low urgency; reason render-map needs subprocess isolation. status=open.
   > **Brief seed:** Root-cause the never-resolving mount-time await/effect in samples/gauntlet-r18/rails-dev.scrml under happy-dom (investigate the meta-eval path in meta-checker.ts). Bounded once the hanging construct is isolated; bisect the source to the blocking construct.

## Progress
`ss7.progress.md`. Land on `spa/ss7`; ping PA inbox when ready. Do not advance main / do not push.
