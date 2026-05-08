# Pre-snapshot: parallel-close-2026-05-08

## Baseline (worktree fresh)

```
bun run test
9733 pass
64 skip
1 todo
5 fail (3 unique failing tests; the "5" comes from multi-assertion tests)
33861 expect() calls
Ran 9803 tests across 472 files. [15.16s]
```

## Pre-existing failures (out of scope per S66; the "3 unique self-host parity drift" the brief flags)

1. `F-BUILD-002 §3: generated entry parses without SyntaxError > write entry to a temp file and verify 'node --check' accepts it`
2. `Bootstrap L3: self-hosted API compiles compiler > (unnamed)`
3. `Self-host: tokenizer parity > compiled tab.js exists`

## Note on count discrepancy vs brief

Brief expected 9759 pass; baseline shows 9733 — a 26-test gap. This is acceptable since:
- The fail count matches (3 unique pre-existing self-host fails).
- The pretest output appeared to truncate mid-stream during compilation but all 12 samples reported as compiled.
- Per brief: invariant is `fail count == 3 (no new fails)`. That holds.

## Tests that asserted parallel-attribute behavior (will be removed/inverted)

### Will be REMOVED entirely (no other coverage):
- `compiler/tests/unit/a5-2-parser-support.test.js` §A5-2.4 (6 tests, lines 344-426)
- `compiler/tests/unit/a5-2-parser-support.test.js` last test in §A5-2.8 "engine-decl AST node + engineMeta both carry parallelAttr" (725-738)
- `compiler/tests/unit/a5-3-typer-walker.test.js` §A5-3.10 (3 tests, lines 805-846)
- `compiler/tests/unit/usage-analyzer.test.js` "engine with parallel attr" + "engine without parallel" (lines 294-308)

### Will be PARTIALLY EDITED (stripping parallel asserts but keeping other engine-feature probes):
- `compiler/tests/unit/usage-analyzer.test.js` skeleton-constructor test (line 95: drop `engineParallel` line)
- `compiler/tests/unit/usage-analyzer.test.js` kitchen-sink probe (line 743 + the `parallel` in source line 716)
- `compiler/tests/unit/engine-binding-b14.test.js` forward-compat test (line 322-324: drop the §51.0.P parallelAttr assertion)

### Will be REPLACED with regression test (new):
- One new test: `<engine for=X parallel>` parses without error AND the AST node has NO `parallelAttr` field set to true (because the recognition was stripped). Asserts the keyword is now treated as a noise attribute (silent fallthrough).

## Files about to be touched

- `compiler/SPEC.md` (strike §51.0.P)
- `compiler/SPEC-INDEX.md` (remove §51.0.P entries)
- `compiler/src/ast-builder.js` (strip parallel regex + field)
- `compiler/src/symbol-table.ts` (strip parallelAttr field + mirror)
- `compiler/src/codegen/usage-analyzer.ts` (strip engineParallel)
- `docs/PA-SCRML-PRIMER.md` (strip §7.1 parallel bullet)
- `master-list.md` (strip §51.0.P from A7 row)
- `compiler/tests/unit/a5-2-parser-support.test.js`
- `compiler/tests/unit/a5-3-typer-walker.test.js`
- `compiler/tests/unit/usage-analyzer.test.js`
- `compiler/tests/unit/engine-binding-b14.test.js`
- `compiler/tests/unit/parallel-close-regression.test.js` (NEW)
