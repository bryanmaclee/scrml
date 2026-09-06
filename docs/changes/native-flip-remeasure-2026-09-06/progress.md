# progress — native-flip-remeasure-2026-09-06

## Startup verification (all PASS)
- pwd = /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-af85ddc5bd3d2c56e
- git rev-parse --show-toplevel == pwd
- git status clean
- HEAD == origin/main == f23388163592b9c80cff0bf7502300db85f5b20f; merge-base == origin/main
- bun install: 218 packages
- bun run pretest: exit 0, 34 artifacts in samples/compilation-tests/dist/

## Log
- [start] BRIEF.md archived verbatim.

## CONTROL established (verified by execution)
`bun test compiler/tests/` at HEAD f2338816, after `bun run pretest`:
- 31051 pass / 214 skip / 11 todo / **56 fail** / 1450 files / 386.81s
- 56 - 2 = **54**, matching the brief's main-measured `bun run test` figure.
  The 2 are the documented `envExcluded` pair in
  `compiler/tests/browser/FAILURE-BASELINE.json` (TodoMVC dist is gitignored;
  absent in a fresh worktree). CONTROL REPRODUCES.
- 48 of the remaining 54 are exactly `FAILURE-BASELINE.json.failures` (browser tier).

## Flip-site facts (verified by reading compiler/src/api.js)
`parser` has exactly TWO live consumers in api.js:
- `parser = null,` (options destructuring) — the default
- `const useNativeParser = parser === "scrml-native";` — the ROUTING decision
- `if (parser === "scrml-native") { ... I-PARSER-NATIVE-SHADOW ... }` — an INFO
  diagnostic appended to result.warnings (routing-confirmation only)
`useNativeParser` is referenced exactly once, in the `_buildAST` ternary.

=> Two distinct flips are possible and they are NOT equivalent:
   (routing)        useNativeParser := true         -> parse routing only
   (option-default) parser := "scrml-native"        -> routing + the INFO diagnostic
The harness implements both; `routing` is the default because the INFO
diagnostic perturbs every test that asserts on result.warnings, which is not
parser-attributable.

## Other facts
- `bun run test` DOES run the `pretest` lifecycle script (probed: bun 1.3.14
  prints PRETEST_RAN then TEST_RAN). So the flip must also cover
  `scripts/compile-test-samples.sh`, whose artifacts the browser tier reads.
- `compiler/tests/browser/todomvc-e2e.test.js` beforeAll COMPILES
  benchmarks/todomvc/dist, so the TodoMVC gate flips pass/fail by run ORDER.
  The harness excludes the FAILURE-BASELINE envExcluded names from both sides.

## MEASUREMENT — routing mode, full suite (verified by execution)
Harness run at HEAD c7d46179, `--mode=routing --tier compiler/tests/` (pretest ON both sides).

- CONTROL  : 54 failures  (this run; the TodoMVC envExcluded pair PASSED because
             the gitignored dist had been built by an earlier run)
- FLIPPED  : 1907 failures
- **NEW (flip-attributable): 1860**  ·  **GONE: 7**  ·  net +1853
- 358 distinct test files carry a NEW failure.
- api.js restored byte-identical (harness SHA-256 check + `git diff` empty).

### The 7 GONE are the headline's other half
All 7 are documented FAILURE-BASELINE.json failures in exactly two browser files:
`g-emit-lift-markup-text-interp.browser.test.js` (4) and
`g-each-peritem-markup-value-ternary.browser.test.js` (3) — both LIFT-MARKUP /
markup-nested-in-body cases. The native parser gets right what the flat
body-scanner gets wrong. That is the same class as the adopter bug that
motivated this dispatch.

### Age partition — this is the meter
Test surface as of the S170 reading (commit 9e306082, 2026-06-07):
- NEW failures in test FILES that did not exist then : 1382 (74%)
- NEW failures in files that existed, tests that did not: 62
- **NEW failures on the LIKE-FOR-LIKE surface: 416**   (vs S170's ~508)

So: raw count UP 3.7x; like-for-like count DOWN ~18%. The raw rise is
test-surface + language growth against a parser frozen since S222.

### corpus-bridge dominates the post-cut growth
`compiler/tests/conformance/corpus-bridge.test.js` alone = 271 NEW (14.6%).
Added 2026-06-29 (e86a76d0) — 22 days AFTER the S170 reading, so it is entirely
outside that baseline's scope. Its failures are `r.missing` non-empty: required
conformance diagnostics that DO NOT FIRE under the native parser.
**128 DISTINCT diagnostic codes fail to fire** (E-SCOPE-001 x6, E-REACTIVE-003 x5,
E-STRUCTURAL-ELEMENT-MISPLACED x4, E-MATCH-SUBSET-DEAD-ARM x4, E-TYPE-020 x4, ...).
That is the MISSING-FIELD emit-shape family re-expressed on the diagnostic axis:
downstream checks read AST fields the native bridge does not carry.

## MEASUREMENT — option-default mode, full suite (verified by execution)
`--mode=option-default --flip-only` reusing the same CONTROL artifacts:
- FLIPPED 1901 · **NEW 1854** · GONE 7.
- Set-diff vs routing mode: 7 routing-only + 1 option-default-only, all of them
  flake-shaped (temp-dir ENOENT, ESM chunk linkage, self-host compile).
  => the I-PARSER-NATIVE-SHADOW info diagnostic costs ~0 test failures, and the
  routing number IS comparable to S161/S170's option-default methodology
  (roadmap line 33: `api.js:630` `parser=null -> "scrml-native"`).
- api.js restored byte-identical again.

## Like-for-like decomposition (416)
by tier: unit 298 · integration 74 · browser 29 · conformance 12 · self-host 2 · commands 1
by signature: toEqual 143 · toBe 77 · toHaveLength 74 · toMatch 32 · toContain 21 ·
  not.toBeNull 16 · toBeGreaterThanOrEqual 12 · (thrown TypeErrors) ~13 · rest singletons
top files: fn-expr-member-assign 18 · error-handler-const-bind-r25-bug-49 12 ·
  r24-bug-31-if-as-expression-result-binding 12 · engine-body-render 11 ·
  structural-in-logic-body 11 · conf-compound-rollup-read-bug-61 8 ·
  arrow-object-literal-init-thunks 8 · arrow-object-literal-body 7 ...

CAVEAT on the family axis: the S170 buckets (MISSING-FIELD emit-shape ~296 /
engine-statechild ~116 / FIELD-SHAPE-other ~21 / each-match-promotion ~11 /
legacy-stage-probe ~14-18) came from a MANUAL re-triage, not a mechanical
classifier. My harness's mechanism axis reads off the assertion matcher, which
buckets most emit-shape failures as FIELD-SHAPE-other. The two decompositions are
NOT directly comparable and I did not force them to be.

## Harness fixes found while measuring
1. bun does NOT always print `(fail)` at column 0 — a browser test whose output
   interleaves gets an INDENTED `(fail)`. A `^\(fail\)` anchor silently
   under-counted by exactly 1 (53 parsed vs 54 reported). Regex now `^\s*\(fail\)`.
2. `--report` now RE-PARSES from `<label>.raw.txt` when present, so a parser fix
   can be applied to an old run instead of paying for another 7-minute pass.
3. `--tier` runs through `bash -c` so a multi-path / glob tier (the pre-commit
   gate scope) expands the way the hook's own invocation does.

## CONTRADICTION with the brief — "PARSE-FAILURE 0" does not generalise
The brief states the within-node AST-diff axis found PARSE-FAILURE 0 over 1012
files, and infers "the gap is bridge/promotion fidelity, not parsing."

Measured on the behavioural axis: **197 of the 1860 NEW failures (10.6%), across
56 test files, carry HARD native PARSE errors** (E-EXPR-* / E-STMT-* / E-LEX-*
codes — the native parser's own). The CONTROL produces ZERO such failures.
Raw code occurrences under the flip: E-EXPR-UNEXPECTED 559, E-STMT-MISSING-
SEMICOLON 427, E-STMT-UNEXPECTED-TOKEN 316, E-EXPR-UNCLOSED-BRACE 130,
E-STMT-RETURN-OUTSIDE-FUNCTION 119, ... (control: 23 occurrences total).

Both are true and they do not conflict: the 1012-file within-node CORPUS parses
clean. The behavioural suite compiles a much wider input set — inline fixture
strings authored inside test files, `compiler/self-host-v2/*.scrml`, stdlib —
and on THAT wider set the native parser hard-fails. PARSE-FAILURE 0 is a
statement about the corpus, not about the language.

### DEFECT TO FILE (not fixed — native-parser is transition-FROZEN)
`compiler/self-host-v2/lex.scrml` does not parse under the native parser.
Surfaced by `compiler/tests/integration/self-host-v2-lexer-slice5a.test.js`.
The error cascade starts at `E-EXPR-PARAM` / `E-STMT-EXPECT-FROM` /
`E-EXPR-UNEXPECTED ... KwFrom`, i.e. the native tokenizer's `from` keyword
handling. Filed, not fixed, per dispatch scope.

## Concentration — the dominant-lever phase is OVER
NEW (1860) across 358 files: top 1 file 15% · top 5 20% · top 10 25% ·
top 20 33% · top 50 50% · top 100 67% · top 200 88%.
LIKE-FOR-LIKE (416) across 135 files: top 1 **4%** · top 5 15% · top 10 24% ·
top 20 39% · top 50 69% · top 100 92%.

Compare S161: ONE unit (#2f each/match structural-promotion) was ~70% of 1,150
and closed in a single dispatch arc. There is no such lever left. The single
biggest contributor today is `corpus-bridge.test.js` at 15%, and it is not one
bug — it decomposes into 128 distinct diagnostic codes.

## Native-parser commit activity since the S170 reading (verified by git log)
7 commits to `compiler/native-parser/` since 2026-06-08, and they are incidental:
a repo rename sweep, an error-code rename, a URL-`//` comment fix, a legacy
arrow-body reject, GITI-032, the §17.1.2 `if=` widening, and a block-comment
skip landed 2026-09-04. NO transition work. So the like-for-like 508 -> 416
decline was NOT bought by native-parser fixes — it came from the legacy/
downstream side, which is what the finite-tail hypothesis predicts.
