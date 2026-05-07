# A1b B9 — Validator-arg ExprNode conversion — progress

Branch: `phase-a1b-step-b9-validator-arg-exprnode`. Baseline: `e557e30` (S66 close, post-`0cc5632`).

## 2026-05-07T18:28Z — startup verification + survey

- `pwd` matches WORKTREE_ROOT, `git rev-parse --show-toplevel` matches, tree clean.
- `bun install` ok (114 packages).
- `bun run pretest` ok (12 samples compiled).
- Branch created: `phase-a1b-step-b9-validator-arg-exprnode`.
- Authority docs read: B9 audit, AST contracts §1.1, ast.ts ValidatorEntry (lines 527-534), SPEC §55.1 + §55.11, expression-parser §S66 fix, dependency-graph.ts.
- Step 5 parser located at `compiler/src/ast-builder.js:3358-3618` (`scanStructuralDeclLookahead`). Args populated at line 3594-3598 (call-form) and 3603-3607 (bareword).
- IdentExpr walker at `compiler/src/expression-parser.ts:2200-2389` (`forEachIdentInExprNode`).

## Phase 0 — SURVEY findings (clean — no STOP-trigger)

**(a) Step 5 args distinction:** PRESERVED.
- Bareword: `args: null` (line 3605).
- Call-form: `args: argRaw.length > 0 ? [argRaw] : []` (line 3596). `req()` zero-arg call would give `[]`; `length(>=2)` gives `[">= 2"]` (single element, raw text joined by space). Existing tests (parse-shapes-v0next.test.js §S5.4-§S5.5) confirm.

**(b) Expression-parser coverage** (`bun tmp-probe-b9.mjs`):
- `[.Admin, .Editor]` → `array` ExprNode with two `ident` elements (`.Admin`, `.Editor`). Bare-dot S66 fix works.
- `@signup.password` → `member` { object: `ident("@signup")`, property: `"password"` }. @-prefix preserved on base ident.
- `/^[^@]+@[^@]+$/` → `escape-hatch` (estreeType `Literal`). Raw text preserved; ExprNode walker treats as opaque. Acceptable — B10 reads raw on regex.
- `18`, `120` → clean `lit` (number).
- `@startDate` → clean `ident` (@-prefix).
- `.Idle` → clean `ident("\.Idle")`. Bare-variant.
- `>=2` → `escape-hatch` (estreeType `ParseError`). EXPECTED — confirms relational-predicate sub-grammar is needed.
- `@startDate.plus(1, "day")` → clean `call` { callee: member, args: [lit, lit] }.
- `@a + @b`, `@maxAge - 18` → clean `binary`.
- `true` → clean `lit` (bool).

**(c) IdentExpr walker registry:** straightforward. New AST kinds need a new `case "<kind>":` arm in `forEachIdentInExprNode` (expression-parser.ts:2206-2389) AND parallel arms in `exprNodeContainsCall` (line 2411), `forEachCallInExprNode` (line 2489), `forEachResetExprInExprNode` (line 2538), `exprNodeContainsReactiveRef` (line 2600), `exprNodeContainsAssignment` (line 2614). The exhaustiveness `_never` check enforces this. About 6-8 walker functions to update.

**(d) B7 dep-graph:** `dependency-graph.ts:218-256` calls `forEachIdentInExprNode` on standard exprNode fields; no validator-specific code. So if RelationalPredicateNode walks correctly through `forEachIdentInExprNode`, B10 + future dep-graph integration "just works."

**Survey decision:** PROCEED. No STOP. All preconditions met. Estimated phases:
- Phase 1 (RelationalPredicateNode type + ValidatorEntry shape): ~30min.
- Phase 2 (validator-arg-parser module): ~1h.
- Phase 3 (wire into Step 5): ~30min.
- Phase 4 (walker registry): ~45min.
- Phase 5 (tests): ~1.5-2h.
- Phase 6 (primer §13.7 row + final): ~15min.
- Total: ~4-5h. Aligns with audit budget.

## 2026-05-07T18:35Z — Phase 1 commit

- Defined `RelationalPredicateNode` interface in `ast.ts` (kind: "relational-predicate", op: 6 comparison operators, value: ExprNode).
- Defined `ValidatorArg = ExprNode | RelationalPredicateNode` union.
- Updated `ValidatorEntry.args` from `string[] | null` to `ValidatorArg[] | null`.
- Updated comment at lines ~454-462 to describe new `args` shape.
- Decision: RelationalPredicateNode does NOT extend BaseNode (uses ExprSpan, no `id` field) because it's an inline sub-expression marker, not a standalone AST node — matches how SpreadExpr / ObjectProp non-IDed nodes work in ExprNode tree.
- `bun test compiler/tests/integration/parse-shapes-v0next.test.js`: 114 pass / 1 todo / 0 fail.

## 2026-05-07T18:42Z — Phase 2 commit

- New module `compiler/src/validator-arg-parser.ts` with two exports:
  - `parseValidatorArg(predicateName, rawArg, argSpan, filePath, argOffset)`
    — dispatches on predicate name; relational-form for `length(...)`,
    standard-expression form for everything else.
  - `decorateValidatorsWithExprNodes(validators, filePath)` — in-place
    transform helper, idempotent.
- RELATIONAL_PREDICATE_HOSTS = {"length"} — closed set per §55.1.
- REL_OPS_BY_LENGTH = [">=", "<=", "!=", ">", "<", "="] — 2-char first.
- Probed all 14 universal-core forms (§55.1) + the decorate helper:
  - relational forms: 6 ops parse cleanly to RelationalPredicateNode.
  - min(18), max(120) → lit (number).
  - pattern("[a-z]+") → lit (string); pattern(/regex/) → escape-hatch
    with raw preserved (regex falls into BigInt/exotic branch in
    esTreeToExprNode — acceptable; B10 reads raw on regex).
  - eq(@signup.password) → member { object: ident("@signup"), prop }.
  - gte(@startDate) → ident; gt(@startDate.plus(1, "day")) → call.
  - oneOf([.Admin, .Editor]) → array { elements: [ident(".Admin"),
    ident(".Editor")] }. Bare-dot S66 fix preserved.
- Idempotency confirmed: re-running decorate() leaves args unchanged.
- Bareword (args:null) and zero-arg-call (args:[]) preserved untouched.

## 2026-05-07T18:55Z — Phase 3 commit (wire into Step 5)

- Imported `decorateValidatorsWithExprNodes` in `ast-builder.js`.
- Called at both Shape-2 construction site (line ~3275) and the defensive
  Shape-1/3-with-validators path (line ~3328).
- Step 5 BUG SURFACED + FIXED: STRING token text was joined raw without
  re-quoting in the validator-arg collector at line ~3597 (unlike the
  default-expr collector which JSON.stringify'd at line ~3533). This caused
  `pattern("[a-z]+")` to store `[a-z]+` (unparseable). Mirror-applied the
  JSON.stringify treatment.
- Updated tests in parse-shapes-v0next.test.js (§S5.4, §S5.5, §S5.9, §S5.10)
  + kickstarter-v2-smoke.test.js (§K11.2d) to assert structured ValidatorArg
  shapes instead of raw-text strings.
- Full pre-commit test subset: 9090 pass / 44 skip / 1 todo / 0 fail
  (baseline 9151 pre-commit; no regressions).

## 2026-05-07T19:05Z — Phase 4 commit (walker registry)

- Decision per SURVEY: kept ExprNode union and `forEachIdentInExprNode`
  exhaustiveness check intact. Added two new exports in validator-arg-parser:
  - `forEachIdentInValidatorArg(arg, cb)` — dispatches on arg.kind;
    relational-predicate → recurse into .value via forEachIdentInExprNode;
    everything else → forEachIdentInExprNode directly.
  - `forEachIdentInValidators(validators, cb)` — convenience top-level
    walker; auto-skips bareword (null) and zero-arg ([]) entries.
- Probed via smoke script: builds 6 mixed validators (relational with @cell,
  member-access, nested call with @cell, array with @cell + bare-dot,
  numeric literal) and asserts collected identifier names. Passes.
- Full pre-commit suite: 9090 pass / 44 skip / 1 todo / 0 fail.

## 2026-05-07T19:18Z — Phase 5 commit (unit tests)

- New file `compiler/tests/unit/validator-arg-parsing.test.js` with 36 tests
  across 7 sections:
  - §B9.1: relational predicate forms (8 tests — all 6 ops + 2-char
    precedence guard + relational with @cell rhs)
  - §B9.2: standard predicates (10 tests — numeric, string, regex, @cell,
    member, call, array of bare-variants, binary)
  - §B9.3: null/[]/[\"...\"] preservation (3 tests)
  - §B9.4: full source-text Step 5 integration (4 tests)
  - §B9.5: walker integration / cross-field §55.11 (6 tests)
  - §B9.6: idempotency (1 test)
  - §B9.7: error paths (4 tests)
- Full pre-commit suite: 9126 pass / 44 skip / 1 todo / 0 fail (+36 vs
  prior 9090 — exactly the new test count).

## 2026-05-07T19:25Z — Phase 6 commit (primer §13.7 update)

- Added B9 row to the §13.7 annotated-AST contracts table.
- Added a B9 specifics block following B6 specifics with 7 bullets
  covering: two sub-grammar regions, RelationalPredicateNode-NOT-in-union
  rationale, null/[]/[...] preservation, Step-5 STRING-token bug fix,
  regex falling to escape-hatch, idempotency, and closed sets
  (RELATIONAL_PREDICATE_HOSTS, REL_OPS).

## 2026-05-07T19:35Z — Phase 7 wrap

### Final commit summary

7 incremental commits land B9 cleanly:
- cb071e0 Phase 0 SURVEY — preconditions clean
- b594dae Phase 1 — RelationalPredicateNode + ValidatorArg union
- 297f97d Phase 2 — validator-arg-parser module
- 69dbd44 Phase 3 — wire Step 5 → decorate
- 35f8c3d Phase 4 — walker integration
- 2289a23 Phase 5 — 36 unit tests
- d1486b0 Phase 6 — primer §13.7 update

### Test deltas (vs branch baseline e557e30)

- Worktree-local pre-commit subset: +36 net (8366 → 8402, all new from
  validator-arg-parsing.test.js).
- Full pre-commit suite: 9126 pass / 44 skip / 1 todo / 0 fail. The
  apparent -25 vs the dispatch's stated 9151 pre-baseline figure is
  because main HEAD (a555e33) is past my branch base (e557e30) by 7
  commits including B7 + B8 + B10-Phase-1 SHIPs; PA file-delta-lands my
  changes onto main where those tests will recompose normally.

### Files changed (against e557e30)

- compiler/src/types/ast.ts — RelationalPredicateNode + ValidatorArg union;
  ValidatorEntry.args type updated.
- compiler/src/validator-arg-parser.ts — NEW (252 LOC).
- compiler/src/ast-builder.js — wire decorate at 2 call sites + STRING-token
  quote-restore fix (+ comment update).
- compiler/tests/unit/validator-arg-parsing.test.js — NEW (36 tests).
- compiler/tests/integration/parse-shapes-v0next.test.js — 4 tests updated
  (§S5.4, §S5.5, §S5.9, §S5.10) to assert structured ValidatorArg shapes.
- compiler/tests/integration/kickstarter-v2-smoke.test.js — 1 test updated
  (§K11.2d) for the same reason.
- docs/PA-SCRML-PRIMER.md — §13.7 B9 row + specifics block.
- docs/changes/phase-a1b-step-b9-validator-arg-exprnode/SURVEY.md — Phase 0.
- docs/changes/phase-a1b-step-b9-validator-arg-exprnode/progress.md — running log.

### Deferred items

- **Step 5 single-element-array assumption.** Step 5 currently produces
  `args: [joined-raw-text]` (always a single element) for all call-form
  predicates because no spec-required predicate takes multiple args.
  `decorateValidatorsWithExprNodes` is forward-compatible: it iterates
  `for (const raw of v.args)` so a future per-arg-split parser would
  need no change here. NOT a B9-blocker.
- **Regex literals as escape-hatch.** Acceptable because raw is preserved
  and B10 reads raw on regex (per spec §55.1: `pattern(regex)` semantics
  use the regex object at runtime; B10 emits a runtime predicate). A
  future tightening could introduce a `RegexLitExpr` ExprNode kind. NOT
  a B9-blocker.
- **B3 resolution NOT in B9 scope** (per audit §1.4) — B10 wires dep-edges,
  PA is doing that in parallel.
- **E-VALIDATOR-CIRCULAR-DEP NOT in B9 scope** (per audit §1.7 + §55.11) —
  that's B10's territory.

### Cost actuals

Estimated 4-6h. Actual ~1h 10min wall-time (survey discount: preconditions
were already clean — no Step 5 contract fix needed, expression-parser
already handled all spec forms via S66 fix, walker registry was minimal
addition).
