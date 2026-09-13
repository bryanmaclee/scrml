# s414-loop-head-truncation — progress

## 2026-09-13T15:55:17Z — start
Worktree: /c/Users/pjoli/Documents/GitHub/scrml/.claude/worktrees/agent-a6bfe61870b03ff5a
Base: origin/main 2f03b3c6 (clean, merge-base == origin/main)
bun install OK (puppeteer chrome download fails pre-existing; PUPPETEER_SKIP_DOWNLOAD=true clean)
Next: measure conformance baseline BEFORE change; reproduce the three defect cases.

## 2026-09-13 — repro + fix landed in ast-builder
- Conformance baseline MEASURED BEFORE any change: `bun test compiler/tests/conformance/`
  → **1608 pass / 30 skip / 0 fail, 1638 tests across 133 files**. The brief's "905/905"
  does not match anything this suite prints; reporting the measured figure.
- Reproduced all three defect cases on 2f03b3c6 exactly as briefed (silent exit-0 empty
  loop for `while`/`if`; E-CODEGEN-INVALID-LOGIC for the `&&` shape).
- Corpus population: **0 hits across 2,553 tracked `.scrml` files** — confirms the
  dispatcher. Control: the scanner HIT on 5 synthetic positives (`<`, `&&`, `is`, `??`,
  the `if` half) and no-hit on 10 negatives incl. the regex-body and double-parens forms.
- LOCUS HELD: `collectIfCondition()`'s `if (depth === 0 && parts.length > 0) break;`.
- Fix: `continuesConditionHead()` + a `recovering` flag; fires
  E-CONDITION-HEAD-UNPARENTHESIZED once, then keeps collecting to a depth-0 `{`/`;`/
  statement keyword. All three defect cases now emit a CORRECT loop; all 10 controls
  byte-identical to HEAD.
- ⚑ SURFACING NOTE (pre-existing, out of scope): a bare-`${…}` file with no `<program>`
  shell DROPS ast-builder logic-body errors from `result.errors` — the shipped
  E-FOR-UNPARENTHESIZED-HEAD behaves identically there. The diagnostic fires and
  partitions into `result.errors` under a `<program>` shell in every mode.
- Next: tests, then SPEC §34/§49/§50 + SPEC-INDEX regen.

## 2026-09-13 — tests + SPEC + full verification
- `compiler/tests/unit/loop-head-truncated-at-first-close-paren.test.js` — 23 tests, 23 pass.
  ⚑ BITE PROVEN: run against the pre-fix collector (working file swapped via a scratchpad
  copy — NO `git stash`), **8 fail / 15 pass** — every diagnostic and recovery case fails
  pre-fix, every control passes pre-fix. The code has a real producer.
- Diagnostic cases use the `<program>` shell (the shape in which ast-builder logic-body
  errors reach `result.errors`); recovery/artifact cases use the library harness.
- SPEC: §34 catalog row (styled on the E-FOR-UNPARENTHESIZED-HEAD row), §49.2.3 normative
  note, §50.2.3 corollary + cross-reference, `provenance:` marker at both sections.
- Regen gates: `regen-spec-index.ts --check` OK · `facts.ts --check` OK (FACTS.md
  regenerated: SPEC lines 37,947→37,970; compiler/src 253,027→253,113; test files
  1,450→1,451) · `s34-census.ts --check-new` PASS (1 new row, provenance resolves).
  `state.ts --write` touched only master-list.md's recent-sessions rollup with UNRELATED
  s413 drift — REVERTED to keep this change focused (ci.yml does not gate state.ts).

### Verification
- conformance: **1608 pass / 30 skip / 0 fail (1638 across 133 files)** — IDENTICAL before
  and after. (`docs/FACTS.md` "conformance cases | 905" is the CASE-DIRECTORY count and is
  also unchanged; it is not a test pass/fail figure.)
- unit: **18,583 pass / 17 skip / 1 fail (18,607 across 963 files)**. The 1 fail is the
  known Windows-local flake and is ROOT-CAUSED, not waved off: it is a DIFFERENT test on
  each run (`giti-035-sse-generator-seed-clobber` then `giti-016-match-identifier-contextual`),
  each failing at exactly ~5053 ms — bun's 5 s per-test timeout on an
  `execSync("node --check …")` subprocess under 963-file concurrency. Both pass in
  ISOLATION (12/12 and 24/24).
- corpus-compile-floor --check PASS (1 tracked baselined failure, pre-existing,
  E-ERROR-009/examples/09) · conflict-marker-gate PASS (8188 files) · snippet-gate
  110/110 · delta-lint PASS.
- types-gate --check cannot run on this Windows clone: it resolves
  `node_modules/.bin/tsc` with no extension and Windows ships `tsc.exe`/`tsc.bunx`.
  Pre-existing environment limitation; this change touches no `.ts` file, so the gate is
  unaffected by construction.
- ⚑ `E-DG-002` appears in `warnings` for the defect programs — it fires IDENTICALLY on the
  legal control (`while (n + 1 < 4)`), so it is incidental to the probe program shape, not
  introduced here. Measured, not assumed.

### Deferred
- The bare-`${…}` (no `<program>` shell) file shape drops ast-builder logic-body errors
  from `result.errors`. PRE-EXISTING and not this gap: the shipped
  E-FOR-UNPARENTHESIZED-HEAD is dropped there too (measured). Worth its own gap entry.
- master-list.md's `state.ts` recent-sessions rollup is stale by one s413 entry.

## 2026-09-13 — FIX ROUND (adversarial review found three; two fixed, one measured)

Both must-fixes reproduced here by execution before touching anything.

### MUST FIX 1 — recovery was DELETING source (fixed)
`if (a) && (b) n = 1` + `n = n + 5` + `return n` emitted
`function f(a,b){ let n=0; if (a && b) { return n; } }` — `n = 1` and `n = n + 5` GONE,
`return n` captured as the braceless body. The baseline HARD-REJECTED that program
(E-CODEGEN-INVALID-LOGIC), so the first cut introduced a NEW silent-data-loss path.
Root: recovery stopped only at `{` / `;` / a statement keyword — an IDENT stopped
nothing and there was no ASI/alternation check.
Fix: recovery is now bounded by "two value-ish tokens cannot both belong to one
expression" — `conditionHeadTokenEndsValue` + `conditionHeadTokenCanFollowValue`
(a WHITELIST, so the fail-direction is stop-early, never swallow-source). It is
STRONGER than a pure newline/ASI rule, which would not have caught this: `n = 1` is
on the SAME LINE as `(b)`.
After: `if (a && b) { n = 1 } n = n + 5; return n;` — every statement survives, the
diagnostic still fires, and the compiler's "statement boundary not detected" console
print no longer triggers on this path. (⚑ That print is a bare `console` write in
neither `result.errors` nor `result.warnings` — a detector no probe can read. NOT
fixed here; flagged.)

### MUST FIX 2 — `is` falsely rejected a user identifier (fixed by REMOVAL)
`function f(is) { if (n < 3) is(n) }` compiles on base; the first cut fired
E-CONDITION-HEAD-UNPARENTHESIZED + E-EQ-005 and DELETED the `is(n)` call.
⚑ THE SUGGESTED NARROWING TO A KEYWORD-ONLY ARM DOES NOT WORK — MEASURED, not assumed.
I restored a KEYWORD-only arm with a tracer: it FIRED on `is(n)` and reproduced the
defect exactly. The lexer classifies `is` context-free as KEYWORD (`tokenizer.ts`
KEYWORDS) and only `match` has a demotion pass, so a user's `is` identifier IS a
KEYWORD token. Per the coordinator's own instruction for that outcome, `is` is REMOVED
from the continuation set entirely. The set is now all-PUNCT, which is the invariant.

### MEASURE-DO-NOT-FIX — the `export` re-parse swallow
Site: `ast-builder.js` ~:12058 — `_subErrors` from the `export function` synth re-parse
are collected but only `E-FN-EQUALS-BODY` is surfaced; the comment's premise ("the
outer parse re-reports them") is FALSE for ast-builder parse-path errors.
Matrix INDEPENDENTLY RE-MEASURED here (not taken on trust) — the axis is `export`,
NOT the `<program>` shell; my original test banner said the shell and was WRONG, now
corrected in the banner:
                top-level   function   export function
  bare `${}`      FIRES       FIRES      SILENT
  `<program>`     FIRES       FIRES      SILENT
The shipped S308 `E-FOR-UNPARENTHESIZED-HEAD` is swallowed identically.

**ANSWER — if those errors surfaced, 22 of 2,553 tracked `.scrml` files would NEWLY
report an error** (1 file, `samples/gauntlet-s19-phase4/nested-comments.scrml`, throws
today and was skipped; so 22 of 2,552 measurable). Codes:
  - 17 files  E-THROW-NOT-IN-SCRML
  -  7 files  E-TRY-NOT-IN-SCRML
  -  1 file   E-STMT-MISSING-SEMICOLON
⚑ **NOT FREE — this is a MIGRATION needing a ruling.** The 22 include TEN SHIPPED
STDLIB MODULES (`stdlib/auth/flows`, `auth/index`, `crypto/index`, `fs/index`,
`test/index`, `compiler/meta-checker`, `oauth/{discord,github,google,microsoft}`) and
the native parser `compiler/native-parser/parse-markup.scrml`, plus `dashboard/app`
and three `examples/23-trucking-dispatch` pages. Neither
E-CONDITION-HEAD-UNPARENTHESIZED nor E-FOR-UNPARENTHESIZED-HEAD appears in the corpus
— consistent with the zero-population finding.
**Method:** the re-parse site was TEMPORARILY instrumented to record swallowed
`_subErrors` on a side channel; a file "newly reports" when the swallowed set contains
a code its reported set lacks. Instrumentation REVERTED; `grep S414_PROBE` = 0 and the
tree is clean. The export path is UNCHANGED in this round.
**CONTROL (proves the instrument can fire):** 2 positives — an `export function`
carrying E-CONDITION-HEAD-UNPARENTHESIZED, and one carrying the shipped
E-FOR-UNPARENTHESIZED-HEAD — both reported NEWLY-REPORTS. 2 negatives — the same body
NOT exported (already reported → no new code) and a clean `export function` (nothing
swallowed) — both reported no-change.

### Also corrected
§50.2.2 → §50.2.1 everywhere it reached (§50.2.2 is Operator Precedence; the grammar
productions are §50.2.1), INCLUDING the user-facing error string, the §34 row's
section column and body, the §49.2.3 prose, and the test banner.

### Re-verification
- New test file: 23 → **30 tests, 30 pass** (7 added: 4 no-eat incl. a runtime, 3 `is`).
- ⚑ THREE-WAY BITE PROOF (file-copy swaps, NO `git stash`):
  - vs BASE `origin/main`      → **12 fail / 18 pass** (all original defect+recovery
    cases, plus the no-eat cases — that program has no artifact on base).
  - vs THE BROKEN CUT `90b6e451` → **5 fail / 25 pass** — exactly the two new
    regressions (statement-eating ×2, `is` ×3). The other no-eat tests pass there,
    correctly: the broken cut did fire the diagnostic and did handle the braced twin.
  - vs HEAD                     → 30 / 30.
- `while-braceless-body-stays-in-the-loop.test.js` + `braceless-control-head-regex-literal.test.js`
  + the new file together: **70 pass / 0 fail**.
- conformance: **1608 pass / 30 skip / 0 fail** — unchanged from the branch-point baseline.
- unit: **18,589 pass / 17 skip / 2 fail (18,614 across 963 files)**. Both fails are the
  known `node --check` co-run timeout class (5041 ms / 5070 ms); both pass in ISOLATION
  (24/24 together). Different files fail on different runs — not deterministic.
- regen-spec-index --check OK · facts --check OK (FACTS.md regenerated) ·
  s34-census --check-new PASS · corpus-compile-floor PASS · conflict-marker PASS ·
  snippet-gate 110/110 · delta-lint PASS.
