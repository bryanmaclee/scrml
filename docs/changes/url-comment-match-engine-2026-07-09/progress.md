# progress — url-comment-match-engine (2026-07-09)

## Status: COMPLETE (holding — do NOT land; PA re-reviews)

## Base
- Merged `worktree-agent-a0e13210c8b100f41` into this worktree branch (clean,
  `ort` strategy, disjoint from main). Merge commit `497dc6fa`. This supplies
  `urlSlashesAt` + `findStructuralBodyEnd` in `block-splitter.js`.

## SPEC verification (Rule 4)
- SPEC.md §27.1/§27.2 (L17169-17184) confirmed: `// is a single-line comment. It
  is valid in all scrml contexts.` CSS row lists both `/* */` and `//`. Fix does
  NOT narrow `//`; it exempts only genuine URLs (same as the BS half).

## Reproduce FIRST (canonical shapes)
Built repros from canonical samples (`match-002-block-form-arm-swap.scrml`,
`engine-modern-001-basic.scrml`). On the merged base, a URL in arm prose failed:
- MATCH  → `E-MATCH-PARSE-001` + `E-MATCH-NOT-EXHAUSTIVE`
- ENGINE → `E-ENGINE-STATE-CHILD-MISSING` (parallel site CONFIRMED)

## Fix
1. `compiler/src/block-splitter.js` — `export` on `urlSlashesAt` (no behaviour
   change). Commit `3e0e56b1`.
2. `compiler/src/match-statechild-parser.ts` — `import { urlSlashesAt }`; in
   `skipMatchComment`'s `//` branch, `if (urlSlashesAt(s, i)) return i;` before
   the eat-to-EOL scan. Commit `0a11f869`.
3. `compiler/src/engine-statechild-parser.ts` — `import { urlSlashesAt }`; in
   `skipCommentOrString`'s `//` branch, same guard. Commit `0a11f869`.

## Tests
- New: `compiler/tests/integration/url-comment-match-engine.test.js` — 4 tests:
  match URL prose, engine URL prose (both: no arm/state-child errors + URL
  survives to output), + 2 regression guards (genuine `//` comment in a
  match/engine arm body still strips). All pass.
- Post-fix repro: both loci compile with zero errors; URL survives to output;
  genuine comments still strip.

## Full pre-commit gate
- Ran via the pre-commit hook on commit `0a11f869`:
  **19707 pass · 65 skip · 0 fail** (190.43s, 1084 files). EXIT=0.
- Targeted pre-checks: `-t "match"` → 896 pass / 0 fail; `-t "engine"` → 849 pass
  / 0 fail; base url-comment suite (BS conf + integration + native) → 21 / 0 fail.

## Deferred
- None. Both named loci fixed; engine parallel site was present and is covered.
