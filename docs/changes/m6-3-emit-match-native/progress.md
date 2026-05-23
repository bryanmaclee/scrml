# Progress: m6-3-emit-match-native

M6 Wave 1, Unit M6.3 per `docs/deep-dives/m6-joint-retirement-cutover-plan-2026-05-23.md`.

Migrate `compiler/src/codegen/emit-match.ts:513` from the lazy `splitBlocks` + `buildAST`
synth-source re-invocation to a static native-parser import (`nativeParseFile` from
`compiler/native-parser/parse-file.js`).

## Synth-source shape

Per-arm `entry.bodyRaw` — the text body of one `<Variant>...</>` arm inside the match-block.
The wrapper filePath label is `<match:${matchBlock.id}:${tag}>` and is opaque (used only as a
span-attribution string, not as actual source). The arm body is markup that can include nested
tags + `${...}` interpolation + event handlers. The downstream consumer reads
`result.ast.nodes` only.

`nativeParseFile(filePath, source)` mirrors `buildAST` exactly — returns
`{ filePath, ast: FileAST, errors }` where `ast.nodes` is the live ASTNode array. The synth
source shape (markup-with-logic-interp) is squarely within `parseMarkup`'s remit (which is
what `nativeParseFile` composes internally for the BlockKind=Markup case).

## Steps

- [done] Start at $(pwd) — commit 30c8db90
- [done] Path-discipline trap: initial edits leaked into main worktree; reverted main and
  re-applied to worktree-explicit path. NO main-worktree leak in final state.
- [done] Migrate emit-match.ts:513 — replace `splitBlocks` + `buildAST` with
  `nativeParseFile` — commit 72e82003
- [done] Add +6 unit tests covering each match-form arm shape — commit 1c5fe8d2
- [done] Full suite green (unit 11585 / integration 1876 / conformance 383 / 0 regressions)

## Test results

| Suite | Pre | Post | Delta |
|-------|-----|------|-------|
| unit | 11579 | 11585 | +6 (new tests) |
| integration | 1876 | 1876 | 0 |
| conformance | 383 | 383 | 0 |
| fails | 0 | 0 | 0 |
