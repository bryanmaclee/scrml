# s465-docs-currency — progress

- 2026-10-12T07:15Z — startup verification PASS: worktree `agent-a6ed7781f549de04f`, remote `bryanmaclee/scrml`,
  branch `s465-docs-currency` reset to `origin/main` = `41af4153a` (brief named `1c1e9eee`; main advanced),
  merge-base == origin/main. `bun install` OK; `bun run pretest` OK, `samples/compilation-tests/dist/` present.
- 2026-10-12T07:18Z — BEFORE counts (grep):
  - `docs/PA-SCRML-PRIMER.md`: `is some` = 9 occurrences (8 lines); in-place / pseudo-rebind `given` guard code
    forms = 7 (L641 table `given u = expr {}`, L655 `given u :>`, L666 match arm `given u :>`, L958 `given x :> …`
    ×2, L1088 `given seen = @visited.has(n) {…}`, L1104 `given _ = @seen[key] {…}`), plus prose naming `given` as a
    presence discriminator at L701, L720.
  - `docs/articles/llm-kickstarter-v2-2026-05-04.md`: `is some` = 15 occurrences (12 lines); in-place `given`
    guard forms = 3 (L356, L1144, L1171), plus prose at L1143.
- 2026-10-12T07:19Z — commit 1: archive BRIEF.md + this file. Docs-only diff (`docs/` only) — pre-commit suite
  skipped per the brief's docs-only allowance.
