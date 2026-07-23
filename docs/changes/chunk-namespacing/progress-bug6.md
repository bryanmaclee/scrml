# progress — BUG-6 accessor-rename (S283 execution)

Append-only. Timestamps UTC. Branch `worktree-agent-a91ad13968b46ab5d`.
Plan: `BUG6-RENAME-SCOPING.md` §5 (8 steps). Brief: `BRIEF-bug6-rename.md`.

## 2026-07-23 — startup

pwd = `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a91ad13968b46ab5d`.
Startup gate passed: branch correct, tree clean at `096f2239`, `bun install` OK,
pretest populated `samples/compilation-tests/dist/`, `dist` symlinked from main
(ENV-GAP, NOT committed), `dist/scrml-runtime.js` resolves.

Baseline (pre-change) both BUG-6 tests confirmed RED:
- §C10.1 `c10-error-message-resolution.test.js` — core-only assembly contains
  `_scrml_message_for` (via `_scrml_cell_scope` in the core chunk). FAIL.
- gzip `v0-3-x-spa-tree-shake-phase-b.test.js` — SPA runtime **18,346 B gzip**
  vs budget 16,384. FAIL by +1,962. (Matches SCOPING §2.2 HEAD row.)

Read + verified against source (not assumed):
- `_scrml_cell_scope`/`_scrml_cell_key`/`_scrml_cell_name` live in
  `runtime-template.js:828-897`, inside the CORE chunk region (no dedicated
  chunk marker at line 794). Confirmed by the failing §C10.1.
- ESM crux SOUND: `analyzeChunk` (emit-client-esm.ts:150) collects top-level
  `const` declarators via `collectAssignmentTargets`, so `_scrml_cs_*` prologue
  consts are chunkOwnDecls → excluded from imports. `deriveTopLevelExportNames`
  (runtime-esm.ts:256) exports every top-level fn incl. `_scrml_ssr_seed_apply_scoped`,
  so the prologue's real-accessor refs import read-only. No shadow, no TDZ.
- Deleted `cell-namespace-pass.ts` Acorn machinery retrieved from `3b3f6442~1`
  (parse module→script fallback, generic walk, back-to-front splice).

## Plan deltas discovered during reads
- artifact-diff.mjs `unwrapChunkScope` + `fold` currently fold the OLD
  `_scrml_cell_scope(...)` prologue shape; MUST be updated for the new
  `_scrml_cs_*` prologue + `_scrml_cs_`→`_scrml_` call-site rename (step 8 gate).
- test helper `chunk-scope.js` `unwrapChunkScope`/`captureInsideChunkScope`/
  `chunkNamespaceToken` read the OLD prologue; MUST become rename-aware (step 5).
- Emitting a clean `// --- end chunk cell scope ---` end-marker gives every
  fold/unwrap a reliable delimiter.
