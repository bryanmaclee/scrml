# Phase A1c Step C15 — progress log

**Worktree:** `/home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-a5bc55169af3dbf19`
**Branch:** `worktree-agent-a5bc55169af3dbf19`
**Started:** 2026-05-09 (S74+)
**Baseline:** 10,426 / 60 / 1 / 0 (post-C14, commit `a945313`)

## Append-only timeline

- **2026-05-09 startup** — fast-forwarded worktree to `main` HEAD (a945313 = C14 close); `bun install`; `bun run pretest`; `bun run test` PASS at 10,426 / 60 / 1 / 0 baseline confirmed. Mandatory pre-coding reading: BRIEF, ANTI-PATTERNS, kickstarter, primer §7, C12/C13/C14 SURVEYs, SPEC §21.8 + §51.0.D + §51.0.A. Q1-Q4 survey questions verified against source.
- **2026-05-09 SURVEY commit** (`4f0709d`) — Q1 (`_scrml_state` shared via classic-script global lex env), Q2 (placeholder marker only), Q3 (explicit auto-import shipped; implicit deferred), Q4 (plumb exportRegistry into runCG; codegen mirrors B14 PASS 10.B). VERDICT: SHIP narrow scope.
- **2026-05-09 plumbing commit** (`db69b7f`) — `CompileContext.exportRegistry` field added; `CgInput.exportRegistry` passes through; `api.js` runCG call passes `moduleResult.exportRegistry`. p3-follow allowlist: codegen/context.ts + codegen/index.ts (budget 2 each — type-shape mentions only). Baseline preserved: 10,426 / 60 / 1 / 0.
- **2026-05-09 emission helpers commit** (`d54c1c9`) — emit-engine.ts gains `collectCrossFileEngineMounts` + `emitCrossFileEngineMount` + `emitCrossFileEngineMountsForFile`. Wired into emit-client.ts:generateClientJs after C14 derived-engine substrate. p3-follow allowlist: codegen/emit-engine.ts (budget 2). Baseline preserved: 10,426 / 60 / 1 / 0.
- **2026-05-09 SHIP commit** (`f2cee91`) — Tests landed (`c15-cross-file-engine-mount.test.js` — 32 pass, 5 skip). Path-shape resilience added to walker (`lookupSourceMap` tries literal then absolute resolved path). GCP1 fix: extend Form-1 export suppression to include `<engine>` + `<machine>` markup blocks (alongside existing component + channel). p3-follow allowlist bumped: codegen/emit-engine.ts → budget 3. Baseline: **10,458 / 65 / 1 / 0** (+32 pass, +5 skip vs baseline; 0 regressions).
- **DEFERRED ITEMS** (carry forward to parser/TS extension dispatch — NOT C15 territory):
  - TS state-child rule= recognition (E-ENGINE-005 false-positive for new `<engine ... initial=...> <Variant rule=...>` form via full pipeline). C12/C13/C14 codegen tests bypass via `runUpToSYM`; C15 end-to-end via `compileScrml` is BLOCKED here.
  - B14 PASS 10.B path-shape fix (relative-vs-absolute exportRegistry key — `symbol-table.ts:4025` does `exportRegistry.get(binding.sourcePath)` with literal source string while production keys are absolute). C15's codegen walker has the same shape but worked around via `lookupSourceMap` try-relative-then-absolute pattern.
  - `<onTransition>` / `effect=` firing (parser blocker shared with C13/C14; sibling B17.2 in flight).
  - Engine state-child body rendering (parser blocker shared with C12/C13/C14).
  - Implicit auto-import per §21.8 line 12353 (just-the-type form). Explicit form per line 12354 is fully shipped.
  - Inside-component engine mount (B17 territory).
