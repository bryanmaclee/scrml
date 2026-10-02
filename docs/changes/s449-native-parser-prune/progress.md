# s449-native-parser-prune — progress (append-only)

## Start (base 8b58ed588 == origin/main)

Baselines measured in this worktree before any edit:
- `bun test compiler/tests/{unit,integration,conformance}`: 27508 pass · 58 skip · 12 todo · 0 fail · 27578 tests · 1411 files · 284.5 s
- `bun test compiler/tests/*.test.js` (CI gate step "Root-level parser/native conformance"): 6575 pass · 25 skip · 0 fail · 6600 tests · 14 files · 11.80 s
  - per file: corpus 7.45 s (1081) · within-node 4.59 s (1066) · each-contextual-sigil 0.33 s · collect-hoisted 0.19 s · canary 0.16 s · markup 0.13 s · parser-conformance 0.12 s · stmt 0.08 s · expr 0.06 s · parse-file 0.05 s · lexer/url/match-* < 0.04 s
- `bun scripts/s34-census.ts`: STRUCK 35 · PINNED 388 · IMPL-SITES 320 · DECLARED-AHEAD 36 · RUNTIME-SURFACED 3 · FALSE-CLAIM 103

Re-measured from the pack: 39 .js + 37 .scrml + 5 .md tracked; dist/ absent in this worktree (gitignored).
Mirror consumers: `git grep` for `native-parser/*.scrml` / `native-parser/dist` finds only comments
(emit-library.ts, lint-ghost-patterns.js, three tests citing a mirror as the origin of a reproducer).
package.json `files` ships the directory (`compiler/native-parser/`) — the .js stays, so the entry stays.
CI: no step reads a mirror. s34-census.ts scans `.scrml` under compiler/native-parser as an impl tree —
re-run after deletion to confirm no bucket moves.

## Batch 1 — delete the 37 `.scrml` mirrors (20,308 lines)

Deleted every `compiler/native-parser/*.scrml`. Zero consumers (above). `dist/` was not present in this
worktree (gitignored; nothing to delete in git). s34-census after: IMPL-SITES 320→316, DECLARED-AHEAD
36→37, FALSE-CLAIM 103→106 (E-TYPE-021, E-ERROR-007 → BUILD-ARC; E-SSE-001 → HOME-NO-SHALL). Those
codes counted as "implemented" ONLY because a mirror `.scrml` named them (the census does not strip
comments in `.scrml`). The executable `.js` never emitted them, so the census is now more accurate,
not regressed. Flag for the PA: three §34 rows now read FALSE-CLAIM in the census triage.
