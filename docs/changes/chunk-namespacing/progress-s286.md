# progress — S286 chunk-ns BUG-6 FINISH-TO-GREEN

Append-only. Branch `worktree-agent-a4e2f7f2c4e0d4141` (ff-merged to `e78f3b65`).

## Startup (2026-07-24)
- Worktree provisioned off `fe1ad047` (current main) NOT `e78f3b65`. ff-merged my branch to
  `e78f3b65` (48 commits of rename work; `fe1ad047` is its ancestor). Rename files now present.
- `bun install` + `bun run pretest` OK. `dist` symlinked from main (ENV-GAP).
- Baseline (my branch): 85 fail / 21048 pass (unit+int+conf). Matches brief.
- **KEY FINDING**: ran all 32 failing files against pre-rename baseline `fe1ad047` (scratch worktree):
  ALL GREEN (565 pass / 0 fail). So EVERY one of the 85 fails is RENAME-CAUSED. The progress-bug6.md
  "61 pre-existing" was measured vs the older `096f2239` baseline; main has since fixed those.

## Model (empirically verified — S265 execute-don't-grep)
Rename is behavior-preserving (proven: probe-engine.mjs — bare read("phase")=undefined, keyed
read("000lmhgk$phase")="Loading"). The 85 fails are TEST-HARNESS namespace-blindness + a few
over-migrated emit-unit expectations. Fix taxonomy:
- A. makeEvaluator/read-set by BARE cell name → key through `chunkCellKey(clientJs)`.
- B. fold-then-execute (RangeError self-recursion) / happy-dom bare-read → don't fold executed JS; key reads.
- C. text-assert on namespaced clientJs/html → `foldChunkNamespacing` at the READ site only.
- D. emit-unit over-migrated (emitExpr/emitEngineTimersTable/runtime-template asserting `_scrml_cs_`) → revert to raw `_scrml_`.
- E. byte-identity across two tokens → `normalizeChunkToken` both sides.
- F. no-runtime lowering IIFE (`return _scrml_lex_90` outside IIFE) → `unwrapChunkScope`.
- G. giti-009 compile-errors → investigate.
- H. chunk-namespacing.test.js N2/N3/N4 pinned → investigate (arc's own identity tests).

## Done
(appended per phase)

## Next
Fix files by class, run per-file, commit incrementally.
