# Iteration Landing 3 — `bun scrml promote --each` CLI impl

## Phase 0 — STARTUP + STOP gate

- 2026-05-26: Worktree verified at `/home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-a1ccdcc76384270d0`
- Branch: `worktree-agent-a1ccdcc76384270d0`, clean.
- `bun install` complete; `bun run pretest` populated samples.
- Read SPEC §56.10 (lines 29981-30100) IN FULL.
- Read SPEC §17.4 (Tier-0 source form) + §17.4a + §17.4b.
- Read SPEC §17.7 (Tier-1 target form).
- Read SPEC §56.5 (the `--match` precedent).
- Read promote.js (898L) entirely.
- Read lint-w-each-promotable.js (213L) entirely.
- Read promote-match.test.js + promote-safety-harness.test.js for shape.
- Probed the for-stmt AST shape: the `else` clause (§17.4a) is NOT carried on `for-stmt`; the else body's `lift` lands as a sibling `html-fragment` after the for-stmt in the parent. The `key x.id` clause is captured as part of the `iterable` string (e.g. `"@contacts key c . id"`).

**STOP gate disposition:** PROCEED. Notes:
- The else clause must be detected by source-text scan, not AST walk.
- The key clause must be extracted from the `iterable` field.
- `findIterationSites` is built in-promote.js from the same `walkForStmts` shape used by `lint-w-each-promotable.js`.

## Phase 1 — argv registration + stub-to-impl transition

## Phase 2-4 — impl complete (rewrite engine + sanity check + per-file orchestrator)

- Added to `compiler/src/commands/promote.js`:
  - `findIterationSites(file)` — typed-AST walker; returns for-stmt nodes
  - `parseForHeader(iterableRaw, variableRaw)` — extracts iter-var + iterable + key clause + C-style count parameters
  - `findTier0Wrapper(source, forStmt)` — locates the enclosing `${...}` span
  - `extractForBodyAndElse(source, forStmt, wrapBodyEnd)` — extracts body text + optional `else { ... }` clause (the else is NOT in the AST; source-text probe)
  - `countLiftsInBody(forStmt)` — for §56.10.2 row 6 multi-lift skip
  - `iterableIsCellRef(iterable)` — §56.10.2 row 5 literal-array/fn-call gate
  - `tryShorthandHeuristic(bodyText, iterVar)` — §56.10.3 single-expression heuristic
  - `rewriteOneIteration(source, forStmt, opts)` — site-level orchestrator
  - `applyEachRewrite(sourceText, sites, targetLine, opts)` — file-level orchestrator
  - `promoteEachOnFile(filePath, targetLine, opts, cwd)` — exported per-file entry
- `runPromote` routes `--each` to `promoteEachOnFile`; shorthand flag threaded through.
- printHelp updated with --each + --shorthand.

## Phase 5 — tests written (28 cases in 10 describe blocks)

`compiler/tests/unit/promote-each.test.js` — coverage:
- §1: core rewrites for §56.10.2 rows 1-4 (basic, key, else, count) — 4 tests
- §2: skip behaviors for §56.10.2 rows 5-7 (literal-array, fn-call, multi-lift) — 3 tests
- §3: :-shorthand application (default, opt-in, multi-element fail) — 3 tests
- §4: key= inference per §56.10.4 (preserve, omit, no __index__ auto-insert) — 3 tests
- §5: <empty> synthesis per §56.10.5 (with/without else) — 2 tests
- §6: idempotency + safety per §56.10.6 (re-run, mixed file) — 2 tests
- §7: format preservation per §56.10.7 (verbatim outside span) — 1 test
- §8: exit codes per §56.10.8 (0 no-sites, non-zero check+sites, ambiguous) — 3 tests
- §9: CLI surface (mutex with --match/--engine, --shorthand validation, --dry-run, dir-recurse, --help) — 6 tests
- §10: sanity-parse gate (rewritten source still compiles) — 1 test

Test results: 28 pass / 0 fail.
Full pre-commit gate: 14,627 pass / 0 fail / 88 skip / 1 todo (was 14,599 — added 28).

## Phase 6 — help-text status

§56.10.9 allows the help text to surface implementation-pending status until Landing 3 ships. Now Landing 3 IS shipping, so:
- printHelp marks --each as `SHIPPED S134`.
- No "Landing 3 implementation pending" stub message exists (the verb routes to real impl).
