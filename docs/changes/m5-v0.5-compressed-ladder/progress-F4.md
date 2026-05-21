# Progress — M5-swap v0.6 Unit A4 / F4: retire the SpanTable

Append-only, timestamped.

## 2026-05-21T (start)
- Worktree: /home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-a8fd3099d280eb730
- Startup verification passed: merge main "Already up to date", tree clean,
  bun install OK. Baseline `bun run test` = 18282 pass / 0 fail / 169 skip
  (one earlier run had 2 flaky tmp-dir promote-test fails; clean re-run = 0 fail).
- Maps: read primary.map.md; schema.map.md + domain.map.md confirm `spans` on
  FileAST and `Span` interface at ast.ts:21.

## 2026-05-21T (Step 1 — verify zero consumers)
- Repo-wide grep (compiler/src, native-parser, tests, lsp, stdlib, scripts):
  - `SpanTable`/`spanTable`: producer code only (ast-builder.js x4) + derived
    docs (M5-divergence-ledger.md, M5-ast-bridge-scoping.md, collect-hoisted.scrml comment).
  - `.spans` field reads: ZERO in compiler/src stages. Only 4 test assertions
    across 3 files (conf-TAB-002, conf-TAB-023, tab.test.js) — all assert the
    table EXISTS / is non-empty; none feed span data into logic.
- SPEC.md: zero span-table references — no normative blocker.
- PIPELINE.md (derived stage-contract doc): documents `spans: SpanTable` in the
  FileAST output contract — updated to match retirement.
- Disposition CONFIRMED: clean RETIRE, zero behavioral consumers.

## 2026-05-21T (Step 2 — retire)
- ast-builder.js: removed doc-comment line, `buildSpanTable` fn + its header
  comment block, the call site + Map->object conversion loop, and the `spans`
  field on the FileAST literal.
- types/ast.ts: removed `spans: Record<number, Span>` field from FileAST.
  `Span` interface (line 21) RETAINED — still used by every node's inline `.span`.
- conf-TAB-002.test.js: removed the single `FileAST.spans` populated/non-empty
  test; inline-span walk tests (the genuine "spans never dropped" guarantor) kept.
- conf-TAB-023.test.js: removed 2 `ast.spans` existence assertions + the
  JSON.stringify(ast.spans) test; updated header comment.
- tab.test.js: removed 2 `ast.spans` existence/non-empty tests.
- PIPELINE.md: removed `spans: SpanTable` line from FileAST output contract.
