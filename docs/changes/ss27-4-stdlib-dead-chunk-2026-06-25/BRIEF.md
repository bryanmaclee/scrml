# Dispatch BRIEF — ss27-4: g-stdlib-runtime-chunk-dead-weight (LOW, runtime-minimality)

**Agent:** scrml-js-codegen-engineer · **isolation:** worktree · **opus** · **change-id:** ss27-4-stdlib-dead-chunk-2026-06-25 · land-on `spa/ss27` (sPA file-delta) · base origin/main `cf9f1109`.

A client-SAFE stdlib module (e.g. `scrml:format` / `scrml:data` / `scrml:math`) imported and used ONLY inside a server fn still ships its `stdlib-<name>` runtime chunk to the CLIENT bundle — dead weight (defined-but-unused `_scrml_stdlib.<mod>`). No correctness impact; pure runtime-minimality.

[STARTUP-VERIFICATION + PATH-DISCIPLINE — standard block: pwd starts `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`; toplevel==WORKTREE_ROOT, remote scrml.git; status clean; `bun install`; `bun run pretest`. Edits via Bash on worktree-absolute paths; NEVER `cd` into main; never Edit/Write tool; never `--no-verify`. One logical fix = one commit, coupled code+test.]

## Locus
`compiler/src/codegen/emit-client.ts` → `detectRuntimeChunks(fileAST, ctx)` (def **L261**, called **L1308** via `clientStage(ctx, "detect-runtime-chunks", ...)`). It walks the AST and registers runtime chunks from `scrml:NAME` imports. It registers a chunk from the IMPORT presence, NOT from whether any CLIENT code references the binding — so a server-only-used client-safe module still gets its chunk shipped.

## Context (cross-branch — flag for PA)
ss19 #5 (on branch `spa/ss19`, NOT on your base cf9f1109) extended `pruneUnusedClientImports` to strip the server-only stdlib IMPORT LINE. That's a DIFFERENT region of emit-client.ts (~L2113) than detectRuntimeChunks (~L261). Your fix is the CHUNK; #5's was the import line. On your base BOTH still ship (since #5 isn't merged). **Fix ONLY the chunk tree-shaking here; do NOT touch the import-line path.** The PA reconciles spa/ss19 + spa/ss27 emit-client.ts (different regions → expected auto-merge) at re-integration — note this in your report.

## Fix
In `detectRuntimeChunks` (or where the registered chunks are finalized), tree-shake a stdlib runtime chunk for a `scrml:NAME` module whose bound name(s) are NOT referenced anywhere in the CLIENT-emitted code (only server-classified usage). Use the server-classification / client-reference signal already available (the same notion ss19 #5 used for the import line — find it). Server-only stdlib modules (auth/store/crypto — never client-safe) are already handled; this is specifically the client-SAFE-module-used-server-only residual. Do NOT strip a chunk a client reference still needs.

## Verify (R26 + adversarial)
1. Construct a repro: import a client-safe stdlib (e.g. `scrml:format`), use it ONLY inside a server fn → client bundle no longer contains the `stdlib-format` chunk / `_scrml_stdlib.format` definition; client.js parses + loads clean.
2. Adversarial — don't over-strip: same module used in CLIENT code → chunk PRESERVED. A server-only module (scrml:store) → behavior unchanged.
3. Add a regression test (grep existing detect-runtime-chunks / stdlib-chunk tests). Full `bun run test` GREEN, 0 regressions (report baseline + after).

## Scope / report
ONLY the client-safe-chunk tree-shake. Report: commit SHA · red→green · client bundle before/after (chunk absent) · over-strip adversarial · the cross-branch emit-client.ts note (ss19 #5 region vs yours) · git status clean + agent branch + tip SHA.
