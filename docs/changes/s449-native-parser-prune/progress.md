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

## Batch 2 — within-node parity, its allowlist + classifier, the dual-pipeline canary, the CI step

- DELETE compiler/tests/parser-conformance-within-node.test.js (260) + parser-conformance-within-node-allowlist.json (6,736)
- DELETE compiler/src/native-parser-canary/within-node-classifier.ts (537) — its only importer was the within-node test
- DELETE compiler/tests/parser-conformance/dual-pipeline-canary.js (919) + parser-conformance-canary.test.js (990, unit tests of the canary's diff functions only) + parser-conformance/live-phantom-fixture.scrml (702, canary fixture)
- DELETE compiler/tests/parser-conformance.test.js (244) + parser-conformance/parsers.js (141) + parser-conformance/tier-diff.js (340): acorn compared against `scrmlNativeParserStub`, which returns acorn's output — it never exercised the native parser
- ci.yml `tracking`: "Within-node parser-parity" step removed (comment left in its place); header line updated
- Root glob after: 2239 pass · 0 skip · 0 fail · 11 files · 2.61 s (was 6600 tests · 25 skip · 11.80 s). The 25 skips were the canary's gap-ledger `test.skip`s.
- NOT touched (out of brief scope, listed for the PA): 15 tracked `scratch/m65b*.mjs` scripts import the deleted classifier / canary (allowlist regen + phase-0 probes). They are dead now; history keeps them.

### Root-level 14 — disposition
| file | disposition | reason |
|---|---|---|
| native-match-arm-same-line.test.js | KEEP | direct `lex`+`parseExpr` tests; `parseExpr` runs in production via nativeParseFile (`<match>` arm / component / `^{}` re-parse) |
| native-match-literal-arm.test.js | KEEP | same — `parseMatchArmPattern` literal arms |
| native-url-comment.test.js | KEEP | `urlSlashesAt` + `parseMarkup` — markup trampoline used by component re-parse |
| parser-conformance-canary.test.js | DELETE | tests only the dual-pipeline canary's diff/classify functions |
| parser-conformance-collect-hoisted.test.js | KEEP | `collectHoisted` runs inside every nativeParseFile call; curated live-parity block (§5) is a fixed-input correctness oracle, not a drift ledger |
| parser-conformance-corpus.test.js | RE-POINT | bench + `parseProgram` no-throw kept; dual-pipeline canary + aggregate + informational histogram removed; the canary's "no corpus file crashes the native pipeline" guarantee kept, asserted on `nativeParseFile` directly |
| parser-conformance-each-contextual-sigil.test.js | RE-POINT | §1–§3 direct lexer/bridge tests kept; §4 native==default compile parity → default-pipeline compile only |
| parser-conformance-expr.test.js | KEEP | `parseExpr` vs Acorn as correctness oracle + native-only shapes; production-reached |
| parser-conformance-lexer.test.js | KEEP | `lex.js` — the bootstrap lexer oracle AND production-reached |
| parser-conformance-markup.test.js | KEEP | `parseMarkup` and helpers — component re-parse; curated live-parity blocks (MK1.3 markup-bench, F1 tokens, P4-2) kept as fixed-input oracles |
| parser-conformance-parse-file.test.js | KEEP | `nativeParseFile` assembler — the production entry point |
| parser-conformance-stmt.test.js | KEEP | `parseProgram` — defer lint + forbidden-JS in production |
| parser-conformance.test.js | DELETE | acorn vs acorn-stub; never touched the native parser |
| parser-conformance-within-node.test.js | DELETE | the parity test the ruling names |
