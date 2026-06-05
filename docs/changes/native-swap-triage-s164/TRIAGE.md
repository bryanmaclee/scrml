# Native-Parser-Swap Flip-Failure Triage — S164 (631 remaining)

**Date:** 2026-06-04 · **HEAD at triage:** `e9d1f3cb` · **Method:** read-only diagnostic agent, every family reproduced with `bun compiler/bin/scrml.js compile <fixture>` (default exit 0 vs `--parser=scrml-native` fail/miscompile). Surface error codes were misleading on 3/7 families → grouped by **native parse-gap ROOT**, not error code.

**Status:** the top recommendation (lift-closetag) LANDED `649f4ef8`; F2 SQL in flight. This doc is the next-pick map for the autonomous swap-grind loop.

## Ranked family table

| Family | ~count | Native ROOT divergence | Native locus | single/multi | Size | Status |
|---|---|---|---|---|---|---|
| **lift `<markup>` close-tag** | ~50+ (16 files; promote-each 25) | non-self-closing markup as a value under-reaches; lexer reads `</li>`'s `/` as runaway regex-to-EOF | `lex-in-code.js` `/`-branch (+ translate-stmt sliceSource) | clean-single | S | **LANDED `649f4ef8`** |
| ~~F2 SQL `?{}` in server-fn~~ → **MULTI-ROOT (survey-STOP S164)** | ~27 | native DROPS `?{...}` SQL body in server fn → 0 `_scrml_sql` → E-PA-002 | **CORRECTED: NOT `parse-sql-body.js`** (that handles markup/block-position `?{}` fine) — chained-form is `translate-stmt.js` (deferred chained promotion) + `translate-expr.js translateSql` (sql-ref nodeId:-1) | **DECOMPOSED into 3 roots ↓** | M | **F2a LANDED `7e54f321`; 2 sub-roots queued** |
| ↳ **F2a chained `?{}.method()`** | ~4 ctx (ret/let/const/bare-expr) | chained form falls to makeBareExpr → sql-ref nodeId:-1 | `translate-stmt.js reconstructChainedSql` | clean-single | M | **LANDED `7e54f321`** (R26 6/6; within-node −761 net) |
| ↳ F2-generator `server function*` SQL | part of ~27 | native drops the WHOLE `function*` (absent from native AST); yield ?{} leg gated on it | native function* lift + yield-stmt arm (translate-stmt.js, none exists) | distinct root #1 | M | **QUEUED** |
| ↳ F2-match arm (F3 family) | part of ~27 | native `match action { "add" => {...} }` arm-parse FAILS (E-EXPR-MATCH-PATTERN / "unexpected Arrow") even with NO `?{}` | native string-literal-pattern + `=>` match-arm recognition | distinct root #2 | M | **QUEUED** (F3 family) |
| ↳ F2 assign-RHS `@x = ?{}.all()` | small | state-decl-routed / E-RI-002 — out-of-locus for translate-stmt | native state-decl SQL chained handling | distinct | S | QUEUED (F2 follow-on) |
| table-for struct-field-drop | ~21 (unit 11 + integ 10) | silent MISCOMPILE: `<tableFor>` emits only the FIRST struct `<th>` (drops rest); compiles clean, html DIFFERS | native struct-field/`<tableFor>` capture (first-field-only — same shape as mario PowerUp enum-body) | single-ish | M | NEXT after F2 |
| lifecycle-shape1 annotation | ~12 | native mis-parses `(.Draft to .Published)` bare-dot lifecycle annotation in typed decl → no tracker → no E-TYPE-001 enforcement (DEFAULT fires, native clean = missing-enforcement) | native typed-decl lifecycle-annotation parse | single | M | lower-leverage (missing-enforce; no emit move) |
| structural-in-logic-body (F7) | ~11 | DEFAULT fires E-STRUCTURAL-ELEMENT-MISPLACED / native clean: native body-parser accepts `<schema>`/`<engine>` inside `${...}` | `tag-frame.js`/body-parser gate | single | S/M | lower-leverage (missing-enforce) |
| ~~engine-body-render~~ → **§4.18 corpus-migration, NOT a native fix** | ~11 | the arm bodies use BARE text (`<Loading>loading</>`); native CORRECTLY fires `E-UNQUOTED-DISPLAY-TEXT` (§4.18.7 enforcement, S163 ruling) + drops it, while default is lenient. PA-verified: QUOTED arm-body text (`<Loading>"loading"</>`) is BYTE-IDENTICAL native==default — native handles quoted fine. | n/a (native is CORRECT) | — | **NOT a native dispatch** — these resolve via the deferred §4.18 corpus migration (bare→quoted in fixtures) or accepted-as-known-divergence until M6. Per the S163 §4.18 ruling. |
| enum-subset struct-constructor | ~22 (b4 12 + b2 10) | native can't parse `TypeName { field: val }` struct-constructor in expr position → E-EXPR-UNEXPECTED/E-STMT-MISSING-SEMICOLON | `parse-expr.js` primary/atom (no `Ident { … }` recognition) | **multi-ish** (parser + downstream type-res) | M/L | **AVOID single dispatch** (multi-stage) |
| r24-bug-31 if-as-expr/failable | ~12 | **MULTI-GAP**: (a) `<state>…</state>` block → E-MARKUP-002 close-mismatch; (b) `!{}` failable drops `::Variant` arms → E-TYPE-080 | `parse-stmt.js` (`<state>` block) + `!{}` arm parse | **multi-gap (2 roots)** | L | **AVOID** (decompose first) |
| compiler-api per-stage | ~14 | derivative — aggregates other family roots ("compiles without errors") | — | n/a | — | clears as upstream closes; don't dispatch |

## NOT native-parser gaps / flag-to-avoid-misdispatch
- **F8 stdlib `await import()` (13)** — RULED a stdlib-migration task (native stays strict no-`await` enforcer). NOT a parser change.
- **lifecycle-shape1 / structural-in-logic (F7)** — genuine native gaps but **missing-enforcement / inverse-shape** (default fires, native compiles clean); real parity work but lower-leverage (no adopter-corpus emit move). Schedule AFTER emit-producing families.
- **compiler-api** — derivative; clears as upstream parse gaps close.

## Recommended autonomous-loop order (emit-producing, clean-single first) — LIVE
1. ✅ lift close-tag — DONE `649f4ef8`
2. ✅ F2a chained `?{}.method()` — DONE `7e54f321` (F2 decomposed; the survey-STOP split it 3 ways)
3. ⏳ table-for struct-field-drop (silent miscompile) — IN FLIGHT (Phase-0: struct-def-vs-tableFor-expansion + STOP-if-general-struct-gap)
4. engine-body-render (silent miscompile; bare-text arm-body drop; single-ish)
5. F2-generator (`server function*` lift + yield-stmt arm) — QUEUED
6. F2-match arm (F3 family: string-literal pattern + `=>` recognition) — QUEUED
7. → re-measure + re-triage
8. (later) lifecycle / structural-in-logic missing-enforcement (lower-leverage)
9. (decompose-first) enum-subset struct-ctor; r24-bug-31 multi-gap

**LOCUS-RELIABILITY NOTE:** the triage's pointed loci have been WRONG twice (F2 → parse-sql-body.js but fix was translate-stmt.js; lift-closetag → parse-expr span but fix was lex-in-code.js). Every dispatch brief MUST treat the triage locus as a HYPOTHESIS the agent's Phase-0 verifies, not ground truth — the empirical SYMPTOM (default-clean/native-fail + the byte-diff) is reliable; the locus is not.

## Provenance (fixtures verified default-clean/native-fail, S164)
`/tmp/tri/*` (triage agent) + PA-reproduced: lift `v1.scrml` self-closing PASS / `v2.scrml` close-tag FAIL; F2 `f2b.scrml` (default 2 `_scrml_sql` / native 0 + E-PA-002). Each confirmed default exit 0; native failure/miscompile reproduced. Broken legacy samples (api-dashboard/expense-tracker — fail on default too) were excluded.
