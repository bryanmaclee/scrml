# M6.6.b.3 — migrate `isLegacyArrowRulesBody` + `scanForOnIdleEntries` to native walker

## Scope
- Add `walkIsLegacyArrowRulesBody(engineBlock, source)` to `engine-statechild-walker.ts`.
- Add `walkOnIdleEntries(engineBlock)` to same module (returns `OnIdleEntry[]`).
- Swap symbol-table.ts call sites to discriminated-branch (native-if-available; legacy fallback).
- Add dual-pipeline parity tests.

## Baseline
- Worktree path: /home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-afcf75e2d99bfbbf9
- main HEAD after merge: d7dc86a1
- bun test baseline: 20027 pass / 0 fail / 171 skip / 1 todo / 758 files.

## Timeline

- 2026-05-23 — Startup verified; merged main (d7dc86a1) fast-forward; bun install + pretest clean.
- Phase 1 (commit a872b7d2): added `walkIsLegacyArrowRulesBody` + `walkOnIdleEntries` to
  `compiler/src/native-walker/engine-statechild-walker.ts`. Imports updated to include
  `OnIdleEntry` type from symbol-table.ts. +113 lines.
- Phase 2 (commit b1de146b): swapped symbol-table.ts call sites at PASS 11.
  - Step 3.5 (idle-watchdog scan): native-if-available branch added; legacy
    `scanForOnIdleEntries(rulesRaw)` retained as fallback.
  - :5154 legacy-arrow guard: native-if-available branch added; legacy
    `isLegacyArrowRulesBody(rulesRaw)` retained as fallback.
  - Import-site docblock updated to document the b.3 extension.
  - Verified bun test on m66-b2 + engine-a7-cross-feature: 38 pass / 0 fail.
- Phase 3 (commit pending): added 13 parity tests to
  `compiler/tests/unit/m66-b2-engine-statechild-walker.test.js` (6 for
  `walkIsLegacyArrowRulesBody`, 7 for `walkOnIdleEntries`). Full unit +
  integration + conformance gate: 14046 pass / 0 fail.

## Open seams (b.4 / M6.7)

1. `parseEngineStateChildren` fallback survives until M6.8 — synthetic-AST
   test harnesses (test files that construct an `engine-decl` directly without
   `_nativeEngineBlock`/`_source` bridge fields) still rely on it.
2. All three legacy helpers (`parseEngineStateChildren`,
   `isLegacyArrowRulesBody`, `scanForOnIdleEntries`) plus
   `parseRuleAttrValue` (pure helper, reused by the walker) remain exported
   from `engine-statechild-parser.ts`. The pure helper is required infrastructure;
   the other three retire when M6.8 lands synthetic-AST migration.
3. `_nativeEngineBlock` + `_source` bridge field stamping is in
   `collect-hoisted.js` (`synthEngineDecl`). M6.7 should make this the ONLY
   surface that produces `engine-decl` (sunset the synthetic-AST construction
   in test harnesses).
