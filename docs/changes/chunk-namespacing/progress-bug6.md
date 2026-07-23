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

## 2026-07-23 — resume after transient API drop (ENOTIMP)

Worktree intact at `074f6ddc`. Banking the step-3 scaffold
`cell-accessor-rename.ts` (Acorn callee/reference rename pass, module→script
parse, back-to-front splice, shielded-position guard) as a checkpoint before
touching `index.ts`. e8fdd44c subset baseline + current-HEAD (76-fail) baseline
captured to scratchpad for the step-8 name-diff. Next: wire steps 1-2 (position
metadata + `_scrml_cs_*` prologue) into `codegen/index.ts`.

## 2026-07-23 — steps 1-3 landed (emit mechanism)

`codegen/index.ts`: added `CELL_SCOPE_ACCESSOR_POSITIONS` (arg0/arg01/arg2/
passthrough/ssrApply), `cellScopeWrapper`, `cellScopeKeyFn` (inlined key deriv,
mirrors core `_scrml_cell_key`), rewrote `buildCellScopePrologue` to emit
`_scrml_cs_*` wrappers + end-marker, rewrote `addCellScopePrologue` to split
header/body + run `renameCellAccessors` on the body BEFORE prepending the
prologue. Call site at ~1856 unchanged.

Verified on real emitted output (classic + esm):
- wide: prologue emits only the 4 used wrappers; 15 `_scrml_cs_*` body call
  sites; 0 `_scrml_cell_scope`; 0 leaked bare accessor calls. collision-scan: 0
  colliding tokens.
- ESM CRUX CONFIRMED: alpha.client.js imports the REAL accessors read-only
  (`_scrml_reactive_get`,…); imports ZERO `_scrml_cs_*` (own-decls); no shadow,
  no IIFE. Matches SCOPING §1.3 exactly.
- N4 preserved: `__scrml_engine_01nk4qam_phase_transitions` still namespaced.
Next: step 4 strip core (delete `_scrml_cell_scope`/`_scrml_cell_key`, move
`_scrml_cell_name` to conformance shim, trim banner) + gzip re-measure (STOP gate).

## 2026-07-23 — step 4 (strip core) DONE — gzip GREEN

Deleted `_scrml_cell_scope` + `_scrml_cell_key` + `_scrml_cell_name` from
`runtime-template.js` (replaced with a ONE-LINE pointer); moved the author-name
inverse into the conformance shim as `_conf_cell_name`
(`conformance/adapters/impl1-ts.ts`). `_scrml_ssr_seed_apply_scoped` stays in core.

MEASURED (whitespace-clean, deterministic): SPA runtime gzip = **16,330 B**
(< 16,384 budget by 54 B). §C10.1 GREEN (61 pass / 0 fail). gzip test GREEN
(19 pass / 0 fail).

SCOPING-vs-reality note: SCOPING §2.2 predicted zero-residue = 16,255. My clean
removal proves ZERO CODE residue — the core runtime diffs against base e8fdd44c
by EXACTLY ONE comment line, nothing else. gzip is 16,330 (73 B over base's
16,257) — that entire delta is the one-line pointer comment. The knife-edge is
real: base is only 127 B under budget, PRE-EXISTING (§6 HIGH, bryan's policy call).
