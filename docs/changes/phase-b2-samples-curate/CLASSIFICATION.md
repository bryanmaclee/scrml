# CLASSIFICATION — phase-b2-samples-curate

Change-id: `phase-b2-samples-curate` (sPA ss11 item 8). Generated 2026-06-20.

Phase-1 mechanical compile-sweep over `samples/compilation-tests/*.scrml` (excl. gitignored `dist/`).
Partition rule: CLI exit 0 = PASS (`still-compiles`); exit 1 = FAIL (>=1 fatal `error [E-...]`). Warnings / lints / info (incl. non-fatal `warning [E-DG-002]`) are exit 0 and do NOT count as failures.

## Counts

| Partition | Count |
|-----------|-------|
| **Total** | 805 |
| PASS (still-compiles) | 628 |
| FAIL (triage set) | 177 |

PASS files are left untouched (no churn on green). The FAIL set below is the Phase-2 triage scope.

## Phase-2 disposition summary (the 177-file FAIL set)

The FAIL set is NOT all curation targets. Two structural sub-partitions matter:

**Sidecar / header intent.** Each gauntlet-s19 `.scrml` is paired with a `.expected.json` sidecar; gauntlet-s20 files use a `// EXPECTED: E-...` header convention. Many FAIL files are **negative tests** whose intent is to fail-to-compile (`expectedOutcome: error`). A negative test that correctly produces an error is doing its job — it is NOT a curation target.

| Bucket | Count | Disposition |
|--------|-------|-------------|
| **Negative tests (correctly failing)** | ~114 | KEEP as-is. `expectedOutcome:error` (sidecar) or `// EXPECTED: E-` (header) → the sample is supposed to fail. 69 actual-code MATCH the pinned `expectedCodes`; the rest expected `["UNKNOWN"]` or drifted to a different specific code (diagnostic-drift, not sample-curation — surfaced in NOTES). Includes 3 mis-detected ones documented below. |
| **Positive-test fails (real triage)** | 63 | The curation scope. `expectedOutcome:clean`/`warning` or no negative marker, yet fails. Sub-classified below. |

**Positive-test triage (the 63):**

| Disposition | Count | Meaning |
|-------------|-------|---------|
| **EDIT/REWRITE — applied, recompiles clean** | 27 | Legacy/deprecated FORM migrated to canonical; intent preserved; exit 0 after fix. |
| **DROP candidate** | 9 | Tests a RETIRED/REMOVED/SPEC-forbidden shape with no current analog, or a dead gauntlet friction artifact. Listed in `DROP-DRYRUN.md`. NOTHING deleted. |
| **BLOCKED-ON-COMPILER** | 26 | Sample is CORRECT canonical scrml per SPEC; the failure is a compiler bug/limitation. Editing would mask the bug (Rule 2/3). KEPT as-is; surfaced to PA. Listed below. |
| **Reclassified NEGATIVE (mis-detected)** | 1 | `channel-shared-state-001` — comment deliberately preserves the RETIRED `@shared` modifier "for documentation"; correctly fails E-CHANNEL-SHARED-MODIFIER. KEEP. |

### EDIT/REWRITE applied (27 — all exit 0)

REWRITE → `<each>` (§17.7) [10]: `reactive-encoded-001`, `channel-basic-001`, `channel-multiple-001`, `sql-all-001`, `sql-in-for-loop-001` (raw `for`-in-markup, E-CONTROL-FLOW-IN-MARKUP); `phase4-for-markup-044`, `phase3-for-arith-iterable-090`, `phase1-const-array-type-005`, `phase1-let-multiline-008`, `phase1-fn-multiline-011` (legacy `<li for/lift>` markup-for, E-CTX-001/E-SCOPE-001).

EDIT [17]: `_helper-types` (+cascade `phase1-export-reexport-008`, `phase1-import-aliased-002`), `phase1-lin-match-arms-012`, `test-008-test-enum` (typed match-subject param, E-TYPE-025); `match-as-expression`, `match-colon-arrow` (drop `<page route=>`, E-PAGE-ROUTE-ATTR-FORBIDDEN); `phase1-type-enum-inside-program-013`, `phase1-import-named-001` (type bare variants, E-VARIANT-AMBIGUOUS); `phase1-reactive-inside-component-018` (structural `<localCount>`, E-STATE-UNDECLARED); `phase1-import-stdlib-scrml-005` (`scrml:utils`→`scrml:format`, E-IMPORT-006); `phase4-if-attr-else-043` (`else if`→`else-if=`, E-CTRL-003); `phase4-attr-special-chars-077` (single-quote attr→`&quot;`, E-ATTR-001); `phase1-lin-lift-014` (`function`→`fn` for `lift`, E-SYNTAX-002); `phase1-fn-inside-meta-016` (`fn`→`function` in `^{}`, E-PARSE-002); `phase2-if-triple-equals-007` (`===`→`==`, E-EQ-004; +sidecar currency); `meta-conditional-markup` (close malformed emit-string tags, E-META-EVAL-002).

### BLOCKED-ON-COMPILER (26 — KEPT; sample correct per SPEC, compiler bug/limitation)

| File | Code | Why the sample is correct |
|------|------|---------------------------|
| `phase1-navigate-bare-001`, `phase1-navigate-explicit-hard-002`, `phase1-navigate-server-003` | E-SCOPE-001 | `navigate()` is a compiler-recognized built-in "valid inside any function in any context" (§20.1). Scope resolver does not whitelist it. |
| `phase2-animationframe-in-element-091` | E-SCOPE-001 | `animationFrame()` is a compiler-recognized built-in (§6.7.9). Minimal repro of the §6.7.9 worked example also fails. |
| `helpers/dnd-setup`, `modern-007-dnd-with-helpers` | E-SCOPE-001 | `cleanup()` is a built-in (§6.7.3). |
| `sql-transaction-001` | E-SCOPE-001 | `transaction` block is a built-in (§8.5.3). |
| `phase1-fn-anonymous-010` | E-SCOPE-001 | Anonymous `fn(x){}` expression bound to `const` is canonical (§48.2.1); parser does not recognize it in expr position. |
| `error-004-in-logic`, `phase1-let-bare-001`, `phase2-for-lift-else-empty-049`, `phase3-arith-in-match-arm-cond-118`, `phase3-assign-expr-chained-080`, `meta-type-registry-001`, `match-001-nested-with-call` | E-CODEGEN-INVALID-JS | Compiler emits unparseable JS for trivially-valid scrml (e.g. `phase1-let-bare-001` is `let counter=0; counter=counter+1; ${counter}`). §2.2.1: emitting unparseable JS is a compiler defect, full stop. |
| `phase2-match-given-in-arm-104`, `phase2-match-optional-039`, `phase3-match-given-arm-075` | E-MATCH-012 | `match` on `T \| not` with a `not` arm present still fires "lacks a `not` arm"; `=>`→`:>` migration does not help. Checker does not recognize `not`/`given` arms over union-`not`. |
| `gauntlet-s79-signup-form`, `gauntlet-s79-theme-settings` | E-TYPE-025 | `match @formState` / `match @theme` on a typed reactive enum cell (`<formState> = FormState.Editing`) with markup-`lift` arms. Minimal repro compiles; the markup-lift-arm + reactive-enum combination breaks type inference. Explicit `<formState>: FormState` annotation makes it WORSE (E-CODEGEN-INVALID-JS). |
| `component-scoped-css`, `css-scope-01`, `css-flat-and-scoped-001`, `gauntlet-r10-ts-components` | E-COMPONENT-021 | Component body uses the `${...}` children-slot; CE Phase 1 "supports self-closing and simple open-tag component definitions only" and cannot re-parse the slot. The `${...}` children slot is valid scrml. |
| `phase1-use-named-012` | E-COMPONENT-035 | Cross-file component import via `use scrml:chart { LineChart }` — "not yet supported in this consumption shape" (F-COMPONENT-001 deep-dive). |
| `meta-compile-time-pure-001` | E-META-EVAL-001 | `reflect(Theme).variants[i].name` is the SPEC-mandated shape (§22.5.4: `variants: [{ name: "..." }]`); compile-time `reflect()` returns variants WITHOUT `.name`, diverging from §22.5.4. |

## FAIL set by top error code

| Error code | Count |
|------------|-------|
| E-SCOPE-001 | 20 |
| E-CODEGEN-INVALID-JS | 17 |
| E-TYPE-025 | 9 |
| E-LIN-002 | 6 |
| E-CTX-001 | 6 |
| E-CONTROL-FLOW-IN-MARKUP | 6 |
| E-MATCH-012 | 4 |
| E-ERROR-007 | 4 |
| E-EQ-004 | 4 |
| E-COMPONENT-021 | 4 |
| E-LIN-001 | 3 |
| E-FN-003 | 3 |
| E-VARIANT-AMBIGUOUS | 2 |
| E-TYPE-031 | 2 |
| E-TYPE-026 | 2 |
| E-SYNTAX-044 | 2 |
| E-SYNTAX-042 | 2 |
| E-SYNTAX-010 | 2 |
| E-SYNTAX-002 | 2 |
| E-SWITCH-FORBIDDEN | 2 |
| E-PAGE-ROUTE-ATTR-FORBIDDEN | 2 |
| E-IMPORT-006 | 2 |
| E-IMPORT-004 | 2 |
| E-ERROR-001 | 2 |
| E-CTRL-003 | 2 |
| E-CTRL-001 | 2 |
| E-COMPONENT-035 | 2 |
| E-COMPONENT-010 | 2 |
| E-ATTR-013 | 2 |
| E-ATTR-001 | 2 |
| E-USE-005 | 1 |
| E-USE-002 | 1 |
| E-USE-001 | 1 |
| E-TYPE-063 | 1 |
| E-TYPE-062 | 1 |
| E-TYPE-045 | 1 |
| E-TYPE-041 | 1 |
| E-TYPE-024 | 1 |
| E-TYPE-023 | 1 |
| E-TYPE-020 | 1 |
| E-SYNTAX-011 | 1 |
| E-STRUCT-FUNCTION-FIELD | 1 |
| E-STATE-UNDECLARED | 1 |
| E-SCOPE-010 | 1 |
| E-RI-002 | 1 |
| E-PARSE-002 | 1 |
| E-MU-001 | 1 |
| E-META-EVAL-002 | 1 |
| E-META-EVAL-001 | 1 |
| E-META-009 | 1 |
| E-META-008 | 1 |
| E-META-007 | 1 |
| E-META-006 | 1 |
| E-META-005 | 1 |
| E-META-001 | 1 |
| E-LOOP-007 | 1 |
| E-LOOP-006 | 1 |
| E-LOOP-005 | 1 |
| E-LOOP-002 | 1 |
| E-LOOP-001 | 1 |
| E-LIN-003 | 1 |
| E-IMPORT-005 | 1 |
| E-IMPORT-003 | 1 |
| E-IMPORT-002 | 1 |
| E-FN-008 | 1 |
| E-FN-005 | 1 |
| E-FN-004 | 1 |
| E-FN-002 | 1 |
| E-FN-001 | 1 |
| E-ERROR-006 | 1 |
| E-ERROR-002 | 1 |
| E-EQ-003 | 1 |
| E-EQ-002 | 1 |
| E-EQ-001 | 1 |
| E-CTRL-011 | 1 |
| E-CTRL-005 | 1 |
| E-CTRL-002 | 1 |
| E-COMPONENT-012 | 1 |
| E-COMPONENT-011 | 1 |
| E-CHANNEL-SHARED-MODIFIER | 1 |
| E-CG-006 | 1 |
| E-AUTH-002 | 1 |
| E-ATTR-011 | 1 |
| E-ATTR-010 | 1 |
| E-ATTR-002 | 1 |

## FAIL list (file -> top error code)

Sorted by error code then path.

- `samples/compilation-tests/gauntlet-s19-phase4-markup/phase4-attr-component-sql-071.scrml` — `E-ATTR-001`
- `samples/compilation-tests/gauntlet-s19-phase4-markup/phase4-attr-special-chars-077.scrml` — `E-ATTR-001`
- `samples/compilation-tests/gauntlet-s19-phase4-markup/phase4-attr-boolean-as-string-017.scrml` — `E-ATTR-002`
- `samples/compilation-tests/gauntlet-s19-phase4-markup/phase4-bind-non-reactive-033.scrml` — `E-ATTR-010`
- `samples/compilation-tests/gauntlet-s19-phase4-markup/phase4-bind-unsupported-attr-034.scrml` — `E-ATTR-011`
- `samples/compilation-tests/gauntlet-s19-phase4-markup/phase4-class-bad-rhs-038.scrml` — `E-ATTR-013`
- `samples/compilation-tests/gauntlet-s19-phase4-markup/phase4-class-bare-ident-039.scrml` — `E-ATTR-013`
- `samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-server-reactive-derived-from-local-009.scrml` — `E-AUTH-002`
- `samples/compilation-tests/gauntlet-r10-zig-buildconfig.scrml` — `E-CG-006`
- `samples/compilation-tests/gauntlet-s20-channels/channel-shared-state-001.scrml` — `E-CHANNEL-SHARED-MODIFIER`
- `samples/compilation-tests/error-004-in-logic.scrml` — `E-CODEGEN-INVALID-JS`
- `samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-const-no-init-002.scrml` — `E-CODEGEN-INVALID-JS`
- `samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-let-bare-001.scrml` — `E-CODEGEN-INVALID-JS`
- `samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-with-keyword-001.scrml` — `E-CODEGEN-INVALID-JS`
- `samples/compilation-tests/gauntlet-s19-phase2-control-flow/phase2-for-else-no-lift-050.scrml` — `E-CODEGEN-INVALID-JS`
- `samples/compilation-tests/gauntlet-s19-phase2-control-flow/phase2-for-lift-else-empty-049.scrml` — `E-CODEGEN-INVALID-JS`
- `samples/compilation-tests/gauntlet-s19-phase2-control-flow/phase2-return-top-level-080.scrml` — `E-CODEGEN-INVALID-JS`
- `samples/compilation-tests/gauntlet-s19-phase2-control-flow/phase2-while-break-missing-label-066.scrml` — `E-CODEGEN-INVALID-JS`
- `samples/compilation-tests/gauntlet-s19-phase3-operators/phase3-arith-in-match-arm-cond-118.scrml` — `E-CODEGEN-INVALID-JS`
- `samples/compilation-tests/gauntlet-s19-phase3-operators/phase3-assign-expr-chained-080.scrml` — `E-CODEGEN-INVALID-JS`
- `samples/compilation-tests/gauntlet-s19-phase3-operators/phase3-assign-expr-declaration-083.scrml` — `E-CODEGEN-INVALID-JS`
- `samples/compilation-tests/gauntlet-s19-phase3-operators/phase3-assign-expr-to-const-081.scrml` — `E-CODEGEN-INVALID-JS`
- `samples/compilation-tests/gauntlet-s19-phase3-operators/phase3-is-none-bare-008.scrml` — `E-CODEGEN-INVALID-JS`
- `samples/compilation-tests/gauntlet-s19-phase4-markup/phase4-component-lowercase-ghost-058.scrml` — `E-CODEGEN-INVALID-JS`
- `samples/compilation-tests/gauntlet-s19-phase4-markup/phase4-extract-keyword-051.scrml` — `E-CODEGEN-INVALID-JS`
- `samples/compilation-tests/gauntlet-s20-meta/meta-type-registry-001.scrml` — `E-CODEGEN-INVALID-JS`
- `samples/compilation-tests/match-001-nested-with-call.scrml` — `E-CODEGEN-INVALID-JS`
- `samples/compilation-tests/gauntlet-s19-phase4-markup/phase4-component-missing-prop-053.scrml` — `E-COMPONENT-010`
- `samples/compilation-tests/gauntlet-s19-phase4-markup/phase4-slot-in-lift-062.scrml` — `E-COMPONENT-010`
- `samples/compilation-tests/gauntlet-s19-phase4-markup/phase4-component-extra-prop-054.scrml` — `E-COMPONENT-011`
- `samples/compilation-tests/gauntlet-s19-phase4-markup/phase4-component-props-dup-055.scrml` — `E-COMPONENT-012`
- `samples/compilation-tests/component-scoped-css.scrml` — `E-COMPONENT-021`
- `samples/compilation-tests/css-scope-01.scrml` — `E-COMPONENT-021`
- `samples/compilation-tests/gauntlet-r10-ts-components.scrml` — `E-COMPONENT-021`
- `samples/compilation-tests/gauntlet-s20-styles/css-flat-and-scoped-001.scrml` — `E-COMPONENT-021`
- `samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-use-named-012.scrml` — `E-COMPONENT-035`
- `samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-use-vendor-013.scrml` — `E-COMPONENT-035`
- `samples/compilation-tests/gauntlet-s19-phase2-control-flow/phase2-for-lift-outside-logic-109.scrml` — `E-CONTROL-FLOW-IN-MARKUP`
- `samples/compilation-tests/gauntlet-s20-channels/channel-basic-001.scrml` — `E-CONTROL-FLOW-IN-MARKUP`
- `samples/compilation-tests/gauntlet-s20-channels/channel-multiple-001.scrml` — `E-CONTROL-FLOW-IN-MARKUP`
- `samples/compilation-tests/gauntlet-s20-sql/sql-all-001.scrml` — `E-CONTROL-FLOW-IN-MARKUP`
- `samples/compilation-tests/gauntlet-s20-sql/sql-in-for-loop-001.scrml` — `E-CONTROL-FLOW-IN-MARKUP`
- `samples/compilation-tests/gauntlet-s20-validation/reactive-encoded-001.scrml` — `E-CONTROL-FLOW-IN-MARKUP`
- `samples/compilation-tests/gauntlet-s19-phase2-control-flow/phase2-else-attr-orphan-018.scrml` — `E-CTRL-001`
- `samples/compilation-tests/gauntlet-s19-phase2-control-flow/phase2-if-attr-chain-after-unrelated-099.scrml` — `E-CTRL-001`
- `samples/compilation-tests/gauntlet-s19-phase2-control-flow/phase2-else-if-orphan-019.scrml` — `E-CTRL-002`
- `samples/compilation-tests/gauntlet-s19-phase2-control-flow/phase2-else-attr-double-020.scrml` — `E-CTRL-003`
- `samples/compilation-tests/gauntlet-s19-phase4-markup/phase4-if-attr-else-043.scrml` — `E-CTRL-003`
- `samples/compilation-tests/gauntlet-s19-phase2-control-flow/phase2-if-and-else-same-elem-021.scrml` — `E-CTRL-005`
- `samples/compilation-tests/gauntlet-s19-phase2-control-flow/phase2-for-in-jsobj-053.scrml` — `E-CTRL-011`
- `samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-const-array-type-005.scrml` — `E-CTX-001`
- `samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-fn-multiline-011.scrml` — `E-CTX-001`
- `samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-let-multiline-008.scrml` — `E-CTX-001`
- `samples/compilation-tests/gauntlet-s19-phase4-markup/phase4-for-markup-044.scrml` — `E-CTX-001`
- `samples/compilation-tests/gauntlet-s19-phase4-markup/phase4-tag-mismatched-closer-007.scrml` — `E-CTX-001`
- `samples/compilation-tests/gauntlet-s19-phase4-markup/phase4-void-with-content-014.scrml` — `E-CTX-001`
- `samples/compilation-tests/gauntlet-s19-phase3-operators/phase3-eq-cross-type-022.scrml` — `E-EQ-001`
- `samples/compilation-tests/gauntlet-s19-phase3-operators/phase3-eq-not-rewrite-019.scrml` — `E-EQ-002`
- `samples/compilation-tests/gauntlet-s19-phase3-operators/phase3-eq-function-field-119.scrml` — `E-EQ-003`
- `samples/compilation-tests/gauntlet-s19-phase2-control-flow/phase2-if-triple-equals-007.scrml` — `E-EQ-004`
- `samples/compilation-tests/gauntlet-s19-phase3-operators/phase3-eq-strict-rewrite-017.scrml` — `E-EQ-004`
- `samples/compilation-tests/gauntlet-s19-phase3-operators/phase3-neq-strict-rewrite-018.scrml` — `E-EQ-004`
- `samples/compilation-tests/gauntlet-s20-error-ux/err-eq-004-triple-eq.scrml` — `E-EQ-004`
- `samples/compilation-tests/gauntlet-s19-phase2-control-flow/phase2-fail-in-non-failable-077.scrml` — `E-ERROR-001`
- `samples/compilation-tests/gauntlet-s20-error-test/fail-in-non-failable-001.scrml` — `E-ERROR-001`
- `samples/compilation-tests/gauntlet-s19-phase2-control-flow/phase2-failable-unhandled-call-078.scrml` — `E-ERROR-002`
- `samples/compilation-tests/gauntlet-s19-phase2-control-flow/phase2-throw-statement-075.scrml` — `E-ERROR-006`
- `samples/compilation-tests/gauntlet-s19-phase2-control-flow/phase2-try-catch-073.scrml` — `E-ERROR-007`
- `samples/compilation-tests/gauntlet-s19-phase2-control-flow/phase2-try-finally-074.scrml` — `E-ERROR-007`
- `samples/compilation-tests/gauntlet-s20-error-test/try-catch-001.scrml` — `E-ERROR-007`
- `samples/compilation-tests/gauntlet-s20-error-ux/err-error-007-try.scrml` — `E-ERROR-007`
- `samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-fn-prohibition-sql-004.scrml` — `E-FN-001`
- `samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-fn-prohibition-dom-005.scrml` — `E-FN-002`
- `samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-fn-call-non-pure-function-015.scrml` — `E-FN-003`
- `samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-fn-prohibition-outer-mutation-006.scrml` — `E-FN-003`
- `samples/compilation-tests/gauntlet-s20-error-ux/err-fn-001-impure.scrml` — `E-FN-003`
- `samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-fn-prohibition-nondet-007.scrml` — `E-FN-004`
- `samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-fn-prohibition-async-008.scrml` — `E-FN-005`
- `samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-fn-lift-past-boundary-022.scrml` — `E-FN-008`
- `samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-import-circular-020.scrml` — `E-IMPORT-002`
- `samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-import-inside-function-007.scrml` — `E-IMPORT-003`
- `samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-import-default-003.scrml` — `E-IMPORT-004`
- `samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-import-not-exported-004.scrml` — `E-IMPORT-004`
- `samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-import-bare-npm-006.scrml` — `E-IMPORT-005`
- `samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-import-stdlib-scrml-005.scrml` — `E-IMPORT-006`
- `samples/compilation-tests/gauntlet-s20-error-ux/err-import-001-not-found.scrml` — `E-IMPORT-006`
- `samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-lin-not-consumed-002.scrml` — `E-LIN-001`
- `samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-lin-param-not-consumed-010.scrml` — `E-LIN-001`
- `samples/compilation-tests/gauntlet-s20-error-ux/err-lin-001-unused.scrml` — `E-LIN-001`
- `samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-lin-closure-double-008.scrml` — `E-LIN-002`
- `samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-lin-double-consume-003.scrml` — `E-LIN-002`
- `samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-lin-loop-outer-006.scrml` — `E-LIN-002`
- `samples/compilation-tests/gauntlet-s19-phase2-control-flow/phase2-while-lin-consume-inside-069.scrml` — `E-LIN-002`
- `samples/compilation-tests/gauntlet-s20-meta/meta-lin-double-consume-001.scrml` — `E-LIN-002`
- `samples/compilation-tests/lin-002-double-use.scrml` — `E-LIN-002`
- `samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-lin-branch-asymmetric-004.scrml` — `E-LIN-003`
- `samples/compilation-tests/gauntlet-s19-phase2-control-flow/phase2-break-outside-loop-056.scrml` — `E-LOOP-001`
- `samples/compilation-tests/gauntlet-s19-phase2-control-flow/phase2-continue-outside-loop-057.scrml` — `E-LOOP-002`
- `samples/compilation-tests/gauntlet-s19-phase2-control-flow/phase2-while-break-crosses-fn-068.scrml` — `E-LOOP-005`
- `samples/compilation-tests/gauntlet-s19-phase2-control-flow/phase2-while-duplicate-label-067.scrml` — `E-LOOP-006`
- `samples/compilation-tests/gauntlet-s19-phase2-control-flow/phase2-while-as-expr-bare-063.scrml` — `E-LOOP-007`
- `samples/compilation-tests/gauntlet-s19-phase2-control-flow/phase2-match-given-in-arm-104.scrml` — `E-MATCH-012`
- `samples/compilation-tests/gauntlet-s19-phase2-control-flow/phase2-match-optional-039.scrml` — `E-MATCH-012`
- `samples/compilation-tests/gauntlet-s19-phase3-operators/phase3-match-given-arm-075.scrml` — `E-MATCH-012`
- `samples/compilation-tests/gauntlet-s19-phase3-operators/phase3-match-optional-no-arms-076.scrml` — `E-MATCH-012`
- `samples/compilation-tests/gauntlet-s20-meta/meta-bun-eval-001.scrml` — `E-META-001`
- `samples/compilation-tests/gauntlet-s20-meta/meta-phase-sep-005.scrml` — `E-META-005`
- `samples/compilation-tests/gauntlet-s20-meta/meta-lift-006.scrml` — `E-META-006`
- `samples/compilation-tests/gauntlet-s20-meta/meta-sql-runtime-007.scrml` — `E-META-007`
- `samples/compilation-tests/gauntlet-s20-meta/meta-reflect-outside-008.scrml` — `E-META-008`
- `samples/compilation-tests/gauntlet-s20-meta/meta-nested-deep-001.scrml` — `E-META-009`
- `samples/compilation-tests/gauntlet-s20-meta/meta-compile-time-pure-001.scrml` — `E-META-EVAL-001`
- `samples/compilation-tests/meta-conditional-markup.scrml` — `E-META-EVAL-002`
- `samples/compilation-tests/gauntlet-s19-phase3-operators/phase3-assign-expr-undeclared-082.scrml` — `E-MU-001`
- `samples/compilation-tests/match-as-expression.scrml` — `E-PAGE-ROUTE-ATTR-FORBIDDEN`
- `samples/compilation-tests/match-colon-arrow.scrml` — `E-PAGE-ROUTE-ATTR-FORBIDDEN`
- `samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-fn-inside-meta-016.scrml` — `E-PARSE-002`
- `samples/compilation-tests/gauntlet-r10-bun-admin.scrml` — `E-RI-002`
- `samples/compilation-tests/gauntlet-r10-solid-spreadsheet.scrml` — `E-SCOPE-001`
- `samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-fn-anonymous-010.scrml` — `E-SCOPE-001`
- `samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-navigate-bare-001.scrml` — `E-SCOPE-001`
- `samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-navigate-explicit-hard-002.scrml` — `E-SCOPE-001`
- `samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-navigate-server-003.scrml` — `E-SCOPE-001`
- `samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-using-keyword-001.scrml` — `E-SCOPE-001`
- `samples/compilation-tests/gauntlet-s19-phase2-control-flow/phase2-animationframe-in-element-091.scrml` — `E-SCOPE-001`
- `samples/compilation-tests/gauntlet-s19-phase2-control-flow/phase2-animationframe-non-fn-094.scrml` — `E-SCOPE-001`
- `samples/compilation-tests/gauntlet-s19-phase2-control-flow/phase2-animationframe-no-scope-092.scrml` — `E-SCOPE-001`
- `samples/compilation-tests/gauntlet-s19-phase2-control-flow/phase2-animationframe-zero-args-093.scrml` — `E-SCOPE-001`
- `samples/compilation-tests/gauntlet-s19-phase2-control-flow/phase2-partial-match-in-lift-043.scrml` — `E-SCOPE-001`
- `samples/compilation-tests/gauntlet-s19-phase3-operators/phase3-for-arith-iterable-090.scrml` — `E-SCOPE-001`
- `samples/compilation-tests/gauntlet-s20-error-ux/err-scope-001-undeclared.scrml` — `E-SCOPE-001`
- `samples/compilation-tests/gauntlet-s20-meta/meta-reflect-unknown-003.scrml` — `E-SCOPE-001`
- `samples/compilation-tests/gauntlet-s20-sql/sql-transaction-001.scrml` — `E-SCOPE-001`
- `samples/compilation-tests/helpers/dnd-setup.scrml` — `E-SCOPE-001`
- `samples/compilation-tests/meta-004-clean-config.scrml` — `E-SCOPE-001`
- `samples/compilation-tests/meta-005-nested-meta.scrml` — `E-SCOPE-001`
- `samples/compilation-tests/meta-010-reflect-with-config.scrml` — `E-SCOPE-001`
- `samples/compilation-tests/modern-007-dnd-with-helpers.scrml` — `E-SCOPE-001`
- `samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-let-duplicate-binding-010.scrml` — `E-SCOPE-010`
- `samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-reactive-inside-component-018.scrml` — `E-STATE-UNDECLARED`
- `samples/compilation-tests/gauntlet-s19-phase3-operators/phase3-optchain-method-call-039.scrml` — `E-STRUCT-FUNCTION-FIELD`
- `samples/compilation-tests/gauntlet-s19-phase2-control-flow/phase2-switch-fallthrough-072.scrml` — `E-SWITCH-FORBIDDEN`
- `samples/compilation-tests/gauntlet-s19-phase2-control-flow/phase2-switch-statement-071.scrml` — `E-SWITCH-FORBIDDEN`
- `samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-lin-lift-014.scrml` — `E-SYNTAX-002`
- `samples/compilation-tests/gauntlet-s19-phase2-control-flow/phase2-while-lift-in-fn-062.scrml` — `E-SYNTAX-002`
- `samples/compilation-tests/gauntlet-s19-phase2-control-flow/phase2-match-arm-after-else-extra-101.scrml` — `E-SYNTAX-010`
- `samples/compilation-tests/gauntlet-s19-phase2-control-flow/phase2-match-else-not-last-029.scrml` — `E-SYNTAX-010`
- `samples/compilation-tests/gauntlet-s19-phase2-control-flow/phase2-match-guard-clause-035.scrml` — `E-SYNTAX-011`
- `samples/compilation-tests/gauntlet-s19-phase3-operators/phase3-eq-null-forbidden-020.scrml` — `E-SYNTAX-042`
- `samples/compilation-tests/gauntlet-s19-phase3-operators/phase3-eq-undefined-forbidden-021.scrml` — `E-SYNTAX-042`
- `samples/compilation-tests/gauntlet-s19-phase2-control-flow/phase2-given-property-path-090.scrml` — `E-SYNTAX-044`
- `samples/compilation-tests/gauntlet-s19-phase3-operators/phase3-given-property-path-096.scrml` — `E-SYNTAX-044`
- `samples/compilation-tests/gauntlet-s19-phase2-control-flow/phase2-match-non-exhaustive-026.scrml` — `E-TYPE-020`
- `samples/compilation-tests/gauntlet-s19-phase2-control-flow/phase2-match-duplicate-arm-030.scrml` — `E-TYPE-023`
- `samples/compilation-tests/gauntlet-s19-phase2-control-flow/phase2-match-on-struct-037.scrml` — `E-TYPE-024`
- `samples/compilation-tests/gauntlet-s19-phase1-decls/_helper-types.scrml` — `E-TYPE-025`
- `samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-export-reexport-008.scrml` — `E-TYPE-025`
- `samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-import-aliased-002.scrml` — `E-TYPE-025`
- `samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-lin-match-arms-012.scrml` — `E-TYPE-025`
- `samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-lin-match-arms-asymmetric-013.scrml` — `E-TYPE-025`
- `samples/compilation-tests/gauntlet-s19-phase2-control-flow/phase2-match-on-asIs-103.scrml` — `E-TYPE-025`
- `samples/compilation-tests/gauntlet-s79-signup-form.scrml` — `E-TYPE-025`
- `samples/compilation-tests/gauntlet-s79-theme-settings.scrml` — `E-TYPE-025`
- `samples/compilation-tests/test-008-test-enum.scrml` — `E-TYPE-025`
- `samples/compilation-tests/gauntlet-s19-phase2-control-flow/phase2-match-in-markup-direct-040.scrml` — `E-TYPE-026`
- `samples/compilation-tests/gauntlet-s20-error-ux/err-type-026-match-in-markup.scrml` — `E-TYPE-026`
- `samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-const-type-mismatch-004.scrml` — `E-TYPE-031`
- `samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-let-type-mismatch-004.scrml` — `E-TYPE-031`
- `samples/compilation-tests/gauntlet-s19-phase3-operators/phase3-not-assign-to-non-optional-026.scrml` — `E-TYPE-041`
- `samples/compilation-tests/gauntlet-s19-phase3-operators/phase3-not-prefix-negation-027.scrml` — `E-TYPE-045`
- `samples/compilation-tests/gauntlet-s19-phase3-operators/phase3-is-non-enum-004.scrml` — `E-TYPE-062`
- `samples/compilation-tests/gauntlet-s19-phase3-operators/phase3-is-unknown-variant-005.scrml` — `E-TYPE-063`
- `samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-use-inside-logic-014.scrml` — `E-USE-001`
- `samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-use-after-markup-015.scrml` — `E-USE-002`
- `samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-use-bad-prefix-016.scrml` — `E-USE-005`
- `samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-import-named-001.scrml` — `E-VARIANT-AMBIGUOUS`
- `samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-type-enum-inside-program-013.scrml` — `E-VARIANT-AMBIGUOUS`
