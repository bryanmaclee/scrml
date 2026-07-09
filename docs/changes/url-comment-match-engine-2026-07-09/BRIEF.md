# BRIEF — url-comment-match-engine (2026-07-09)

Follow-on to the URL-`//` comment fix (url-comment-context, branch
`worktree-agent-a0e13210c8b100f41` @ `b9346b8b`): extend the URL-exemption to
`<match>` / `<engine>` arm PROSE.

## Base
Merge `worktree-agent-a0e13210c8b100f41` FIRST — it supplies
`block-splitter.js`'s `urlSlashesAt(source, slashPos)` helper + the
`findStructuralBodyEnd` raw-body capture. Without it a URL-bearing arm fails at
the block-splitter before reaching the arm re-tokenizer, so the bug can't be
reproduced.

## The bug (deferred item from the prior fix)
A URL in `<match>` / `<engine>` arm prose miscompiles. BS now captures the arm
body, but the arm RE-TOKENIZERS have their OWN `//` line-comment scanners that
eat to end-of-line, swallowing the arm's `</p>` / `</>` closer:
- `compiler/src/match-statechild-parser.ts` `skipMatchComment` (~L99) →
  `E-MATCH-PARSE-001` ("arm has no matching closer") + `E-MATCH-NOT-EXHAUSTIVE`.
- `compiler/src/engine-statechild-parser.ts` `skipCommentOrString` (~L1337) →
  `E-ENGINE-STATE-CHILD-MISSING` (the parallel site — CONFIRMED present).

## RULE 4 — SPEC governs
`//` is a UNIVERSAL comment valid in ALL scrml contexts per SPEC §27.1/§27.2
(verified in SPEC.md L17169-17184). Do NOT narrow `//` in match/engine arms.
Correct fix = the SAME SPEC-preserving URL-exemption the prior fix used: a `//`
that is a URL scheme separator (`://`) or inside a `url(...)` token is not a
comment; everything else stays a comment.

## Implementation
- Export `urlSlashesAt` from `block-splitter.js` (one source of truth).
- Import it into both arm parsers; apply in the `//` branch of each comment
  scanner — return the position unchanged (= "not a comment") when
  `urlSlashesAt` fires, so the URL is treated as ordinary prose.
- Tightly scoped to the arm-comment scanners; no §65/CSS or already-fixed BS
  sites touched.

## Tests + gate
- Integration test: `<match>` + `<engine>` with a URL in arm prose compile
  clean AND the URL survives to output; regression guards that a genuine `//`
  comment inside an arm body still strips.
- Full pre-commit gate (`bun test compiler/tests/{unit,integration,conformance}`)
  — 0 failures required.

## Landing HOLD
Do NOT land to main. Commit on the branch; the PA re-reviews and lands later.
