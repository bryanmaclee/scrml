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

## Batch 3 — retire the full-pipeline `--parser=scrml-native` flag, the flip harness, and the flag-only walkers; sort the flag-driven tests

Code:
- compiler/src/api.js: TAB routing branch + native forbidden-JS branch + I-PARSER-NATIVE-SHADOW block removed; imports of nativeParseFile / the two walkers dropped. `parser` option kept ONLY to throw a retirement error on any non-null value (a caller asking for the native front end is told, not silently given the default one).
- compiler/src/commands/compile.js: `--parser` → retirement error (exit 1); help line + plumbing removed. compiler/src/cli.js: help line removed.
- DELETE compiler/src/native-walker/attrvalue-exprnode-walker.ts (226) + exprtext-backfill-walker.ts (200): their only caller was the flag branch in api.js.
- DELETE scripts/native-parser-flip-harness.ts (617): the M6 flip meter (patches the api.js flag; S402 meter ruled VOID).
- scripts/facts.ts: comment corrected (native-parser is a frozen impl#1 component; flag retired). Count definition unchanged.
- NEW compiler/tests/helpers/native-ast.js (nativeAst / liveAst / findNodes / withoutPositions / errorsOf) for the re-points.
- NEW compiler/tests/unit/parser-flag-retired.test.js (3 tests: api throws; null/absent accepted; CLI exits 1 with the message, both flag shapes).

### Bite checks (empirical, not assumed)
- emit-each's exprNode branch broken on purpose → native-each-promotion stayed GREEN. Finding: impl#1 NEVER routes an each-bearing body through the native parser (emit-match.ts and component-expander.ts both fall back to splitBlocks+buildAST on `<each`). The native `<each>` promotion and the emit-each `expr:""`+exprNode path were reachable only through the retired flag. Comments in native-each-promotion / engine-statechild-closer-stack corrected to say so.
- translate-stmt.js makeSqlStmt `kind:"sql"` broken on purpose → the new component-body SQL test (m65-b4) went RED on W-CG-001. Confirms a component body with `?{}` IS re-parsed natively in production and that test guards it.

### The 29 flag-driven files (pack grep) + 10 more found by `["scrml-native"` variable use
| file | disposition | reason |
|---|---|---|
| browser/each-as-tuple-destructure-d2c.browser | RE-POINT | loop → default only |
| browser/each-contextual-sigil-native.browser | DELETE | native-only render canary for `<each>` `@.`; impl#1 never routes each-bearing bodies natively; the `@.` lexer/bridge stays tested directly (parser-conformance-each-contextual-sigil §1–§3) |
| integration/import-host | RE-POINT | PARSERS → default; the native end-to-end case → `validateHostImports` on the `nativeParseFile` tree + a default-pipeline case. DIVERGENCE found: default fires only E-IMPORT-003 (no E-IMPORT-008) for an in-function `import:host` on a disabled project — filed, not fixed |
| integration/m6.4a-native-p2-form1 | RE-POINT | default pipeline; file-level export is never native in impl#1 |
| integration/m65-b4-sql-leak | RE-POINT | (1) native tree promotes bare + chained `?{}` to `kind:"sql"`; (2) NEW production-path case: component body with `?{}` (bite-verified); (3) default top-level shapes |
| integration/m6-5-parser-workarounds-noop-under-native | DELETE | M6 migration evidence only (workarounds are no-ops under the flag) |
| integration/tilde-snapshot-codegen-fix | KEEP | comment mention only |
| parser-conformance-corpus | RE-POINT | see batch 2 |
| parser-conformance/dual-pipeline-canary.js | DELETE | see batch 2 |
| parser-conformance-each-contextual-sigil | RE-POINT | see batch 2 |
| unit/class-dynamic-import-reject | RE-POINT | default pipeline decides this family on the native tree (production); native arm + native-only meta/quoted cases dropped; block-body diagnostic case → `nativeParseFile` |
| unit/defer-statement | RE-POINT | §8 live==native parity → default compile; native defer parse already tested directly in the file |
| unit/export-state-cell-reject | RE-POINT | native arm dropped (file-level export) |
| unit/forbidden-js-attr-callref-placement | RE-POINT | native arm dropped; default path runs nativeForbiddenJsAttrDiagnostics |
| unit/lifecycle-field-comment-leak | RE-POINT | parity describe dropped (fix is in live collectBracedBody) |
| unit/m67-c1-component-parity | RE-POINT | default only; direct `nativeParseFile` raw tests kept |
| unit/m67-c2-codegen-output-parity | RE-POINT | §1 → native tree (no cascade; state-decl{isServer} equals default's); §2–§4 default |
| unit/multistatement-line-call-drop | KEEP | comment mention only |
| unit/native-attrvalue-exprnode-population | DELETE | tests a walker whose only caller was the flag |
| unit/native-blockstub-verbatim-body | RE-POINT | native tree: raw arm bodies + lambda escape-hatch carry every statement; default emit |
| unit/native-each-promotion | RE-POINT | §1–§7, §11 direct kept; §8–§10 compile → default (see bite check) |
| unit/native-engine-substrate-instance-share | RE-POINT | native tree: machineDecls entries ARE the nodes engine-decl instances (outer + nested); default substrate emit |
| unit/native-exprtext-backfill | DELETE | tests a walker whose only caller was the flag |
| unit/native-lift-markup-closetag-span | RE-POINT | `nativeParseFile` clean per shape + existing tree tests; default compile |
| unit/native-map-literal-d2b | KEEP | direct lex/parseExpr/translateExpr |
| unit/native-reactive-write-deepset-mutation | RE-POINT | native tree: node kinds + structured fields equal the default parser's |
| unit/native-tablefor-struct-field-drop | RE-POINT | native type-decl raw byte-equals default's; default tableFor columns |
| unit/s441-declared-prose-body | RE-POINT | loop → default |
| unit/struct-fn-field-reject | RE-POINT | parity describe dropped |
| unit/async-await-reject | RE-POINT | native arm → `nativeParseFile` codes |
| unit/each-as-tuple-destructure-d2c | RE-POINT | loops → default; §2 direct native capture kept |
| unit/engine-statechild-closer-stack | RE-POINT | loop → default |
| unit/native-destructured-param-structuring | RE-POINT | native params structurally equal default's |
| unit/native-lex-regex-after-statement-closer | RE-POINT | native arm dropped; default decides on native lexer |
| unit/native-vardecl-type-annotation-thread | RE-POINT | native const/let typeAnnotation equals default's; E-CONTRACT-001 on default |
| unit/s441-coverage-invariant | RE-POINT | loops → default; native-only cases → `nativeParseFile` |
| unit/s441-review-fixes | RE-POINT | loops → default; native tail case → native tree |
| unit/s441-review-r4 | RE-POINT | loop → default; #7 → `nativeParseFile` |
| unit/s441-review-r5 | RE-POINT | loops → default; D / N1 / R1 native fail-closed cases → `nativeParseFile` |

Full gate after batch 3 (unit+integration+conformance+root glob): 29425 pass · 58 skip · 12 todo · 0 fail · 1419 files.

## Batch 4 — SPEC §22.12 + §34.1 intro, SPEC-INDEX, known-gaps

- §22.12: the S114 "M6 retirement scope (charter B)" list + "Retirement is **total**" paragraph replaced by a "Front-end status — M6 not pursued (S449)" paragraph: provenance S449 item 6, notes S249 "don't do M5/M6", names impl#1's default front end (BS + Acorn + BPP), the fixed sites where impl#1 runs the native parser, retires `--parser=scrml-native`, and says Approach C itself is unchanged and binds every implementation. Nothing else in §22.12 touched.
- §34.1 intro: "81 codes" → 82 live rows re-measured (31 expression-grammar · 49 statement-grammar incl. E-THROW/E-TRY · 2 I-NATIVE-BLOCK-*; E-MARKUP-VALUE-UNCLOSED struck); "79" → 80 hard-error codes; restated as impl#1 parse diagnostics emitted via the native parser on the paths impl#1 routes through it, informative for other implementations; the "replaces the legacy pipeline at the M5 swap" / "when M6 deletes the legacy pipeline" / "adopter-visible behind --parser" claims removed; catalog history kept. No row touched.
- SPEC-INDEX: §22 and §34 summary text updated to match; `regen-spec-index.ts` re-run (line numbers).
- known-gaps: closed g-parity-canary-outside-every-blocking-gate (HIGH) and g-native-parser-no-tare-mirror (LOW) — marker + heading flipped, reason line added. New section `## §S449-native-parser-prune` (append-only): bulk impl#1-frozen re-label of the 18 open native-locus gaps (pack said 24 with a looser filter), two touched-not-closed notes, the each-never-native finding, and one NEW LOW gap (g-import-host-in-function-default-front-end-omits-e-import-008).
- `bun scripts/state.ts --check` FAILS on the generated gap-count table and master-list recent-sessions — PRE-EXISTING at HEAD (verified by running --check against HEAD's two files). Left unregenerated on purpose: both are PA-owned shared generated blocks and siblings edit known-gaps in parallel; the PA regenerates at landing.
- Planning docs NOT moved: all four M5/M6 docs in compiler/native-parser/ are linked (docs/changes/**, handOffs/**, IMPLEMENTATION-ROADMAP, and code comments in parse-*-body.js / engine-statechild-walker.ts); README is the directory's README. Listed for the PA.

## Verification (final)

- `bun test compiler/tests/{unit,integration,conformance}`: BEFORE 27508 pass · 58 skip · 12 todo · 0 fail · 1411 files → AFTER 27189 pass · 58 skip · 12 todo · 0 fail · 1409 files. The −319 is exactly the flag-driven set's delta (31 files: 1048 tests at base → 729 at HEAD incl. the 3 new retirement tests) — removed native parity arms and the 3 deleted flag-only files; no default-pipeline arm was dropped.
- Root glob (CI `gate` step): 6600 tests · 25 skip · 12.77 s (base, same machine, idle) → 2239 tests · 0 skip · 1.90 s.
- Full `bun test compiler/tests/` (= `bun run test`): 31469 pass · 104 skip · 16 todo · 50 fail. Every one of the 50 also fails on a base-tree copy run the same way (`comm` of the two sorted fail sets: ZERO only-after). Browser tier alone: 48 fail = FAILURE-BASELINE.json's 48 names exactly (0 new, 0 gone). `scripts/browser-baseline.ts --check` refuses on BOTH base and HEAD ("parser disagrees with the harness", 1 marker short) — pre-existing harness issue, not this change. e2e-render-map tier alone: 259/0.
- Bite checks: `nativeParseFile` throwing → meta-eval 23 fail, component-expander 45, m6-3-emit-match-native-bareBody 6, f-component-004 7, parse-file 78, m65-b4 3 (production entry points stay covered). Native `kind:"sql"` broken → m65-b4 component-body W-CG-001 test fails. emit-each exprNode branch broken → nothing fails (impl#1 never reaches it; see batch 3).
- `s34-census --check-new --base 8b58ed588`: PASS. `facts.ts --check`: PASS after --write. SPEC-INDEX regenerated.
- `types-gate --check` (non-blocking tracking): 9 names gone, all in files this change does not touch (emit-control-flow / emit-each / emit-reactive-wiring / symbol-table / type-system) — pre-existing stale baseline, left for the PA.
- CI wall time saved (local, idle): root-glob gate step −10.9 s; tracking within-node step −4.6 s local (−6.0 s on CI per the pack's log); the 31 flag-driven unit/integration files −3.2 s (10.47 → 7.26 s). ≈ −19 s per CI run plus the same −10.9 s on every pre-commit.
