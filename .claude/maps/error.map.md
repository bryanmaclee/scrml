# error.map.md
# project: scrmlTS
# updated: 2026-05-08T00:00:00Z  commit: f59bbcc

## Error Code System

The compiler does NOT define error codes as JS classes — it uses a flat string-code-based diagnostic system. Codes are emitted as part of diagnostic objects shaped roughly as `{ code: "E-XYZ-NNN" | "W-XYZ-NNN", message, span, ... }`.

A grep over `compiler/src/**` for `E-[A-Z][A-Z0-9-]+` yields **~240+ unique error codes** and **~42 unique warning codes**. The full normative catalog lives in **SPEC §34 (Error Codes)** plus per-section error subsections (e.g. §49.9, §53.11, §51.x, §55.11). For any specific code's authoritative semantics, grep SPEC.md first.

## Custom Error Types (JS-level)
The compiler throws plain `Error` instances with the diagnostic code embedded in the message; very few custom `class ... extends Error` exist. No structured exception hierarchy.

## Error Code Families (representative — not exhaustive)

E-ATTR-*           — attribute validation (allowlist, interpolation, boolean/typed).
E-AUTH-*           — auth-related compile errors.
E-BATCH-*          — batch-planner violations.
E-BPP-*            — body-pre-parser failures (legacy; some shifted to TAB after S58 reorg).
E-BS-*             — block-splitter failures.
E-CG-*             — codegen failures.
E-CELL-*           — render-spec / cell shape errors:
                     `E-CELL-NO-RENDER-SPEC` — Shape 2 cell missing render-spec (B6, PASS 5).
                     `E-CELL-RENDER-SPEC-NOT-BINDABLE` — Shape 2 render-spec element not in bindable set (B6, PASS 5).
E-CHANNEL-*        — channel placement/modifier errors:
                     `E-CHANNEL-INSIDE-PROGRAM` — `<channel>` declared inside `<program>` body (B19, PASS 15).
                     `E-CHANNEL-SHARED-MODIFIER` — `@shared` modifier on `<channel>` (B19, PASS 15, L4 lock).
E-COMPONENT-ENGINE-SCOPE — `<engine>` decl inside component-def body (B17, PASS 13; E-COMPONENT-ENGINE-SCOPE).
E-CONTRACT-*       — §53 inline type predicate violations:
                     `E-CONTRACT-001` — constraint violated at compile time.
                     `E-CONTRACT-002` — named shape not found in registry.
                     `E-CONTRACT-003` — predicate references external reactive variable.
E-DERIVED-*        — derived-cell errors:
                     `E-DERIVED-VALUE-MUTATE` — in-place mutation of derived cell (§6.6.18). SYM PASS 6 (B8). Three forms: method-call, property-assignment/compound-assign, delete.
                     `E-DERIVED-CIRCULAR-DEP` — circular dependency in derived-cell DAG (§6.6.10, §31.5). DG stage B7.
                     `E-DERIVED-ENGINE-*` — family from B16; derived engines forbidden in certain contexts.
                     `E-DERIVED-WITH-VALIDATORS` — validator on a const-derived (Shape 3) cell (B13, PASS 9).
E-ENGINE-*         — engine/state-machine errors (§51.x):
                     `E-ENGINE-004` — transition rule references unknown variant name.
                     `E-ENGINE-010` — 'given' guard in type-level transitions block (not permitted).
                     `E-ENGINE-INVALID-TRANSITION` — invalid transition form in `rule=` attr (B15 PASS 11).
                     `E-ENGINE-INITIAL-MISSING` — `initial=` attribute absent on `<engine>` (B15 PASS 11).
E-HISTORY-NO-INNER-ENGINE — history attribute requires composite state-child with inner `<engine>` (§34, A5-1 S68).
E-INTERNAL-RULE-NOT-COMPOSITE — `internal:rule=` on non-composite state-child (§34, A5-1 S68).
E-IMPORT-*         — import/module errors:
                     `E-IMPORT-PINNED-INVALID` — `pinned` modifier on non-engine import (B4, PASS 3).
E-NAME-*           — name resolution errors:
                     `E-NAME-COLLIDES-STATE` — local decl name shadows registered state-cell name (B2, PASS 2).
E-MULTI-STATEMENT-HANDLER — multi-statement (`;` at top-level) event-handler attribute value (B18, PASS L19; SPEC §5.2.3 + §4.14; §34). Fires in two contexts: markup event-handler attrs + engine state-child :-shorthand bodies.
E-RESET-INVALID-TARGET — `reset(expr)` where expr is not a valid cell-ref target (B22, PASS 14; SPEC §6.8.2).
E-SQL-*            — SQL-context errors (e.g. `E-SQL-005` — URI/dialect mismatch; `E-SQL-008` — unbalanced braces).
E-STATE-*          — state-machine purity / transition errors:
                     `E-STATE-PINNED-FORWARD-REF` — forward reference to `pinned` state cell or import binding (B4).
                     `E-STATE-TRANSITION-ILLEGAL` (S33), `E-STATE-TERMINAL-MUTATION` (S33).
E-SWITCH-FORBIDDEN — switch statement forbidden in pure contexts (A+ verdict #1, S65).
E-SYNTHESIZED-WRITE — assignment to auto-synthesized validity surface property (§6.11, §55.7); deferred to A1c codegen.
E-TYPE-031         — validator arg type mismatch family (§55.1 line 24295). SYM PASS 7 (B10). Four shapes:
                     (1) bareword-only predicate given arg; (2) predicate given too many args; (3) predicate given wrong arg type (relational vs expr); (4) arity mismatch.
E-TYPE-063         — bare-variant reference used but enum type cannot be inferred (B20, §14.10).
E-VALIDATOR-CIRCULAR-DEP — circular dependency in validator-dep graph (§55.11, §31.4). DG stage B10 Phase 3.
E-VARIANT-AMBIGUOUS — bare-variant `(.Variant)` matched multiple known enum types; cannot infer (B20, §14.10).

## Warning Code Families

W-ASSIGN-001                       — assignment lint.
W-ATTR-001 / W-ATTR-002            — attribute lints.
W-AUTH-001                         — auth lint.
W-BATCH-001                        — batch-planner lint.
W-CASE-001                         — case lint.
W-CG-001                           — codegen lint.
W-COMPONENT-001                    — component lint.
W-DEPLOY-001                       — deployment hint.
W-DEPRECATED-001 / W-DEPRECATED    — deprecation warnings.
W-DERIVED-001                      — derived-cell warning (§6.6.11 — derived with no `@variable` refs, never re-evaluates).
W-EQ-001                           — equality lint (gauntlet-phase3-eq-checks.js).
W-LIFECYCLE-002 / W-LIFECYCLE-007  — lifecycle warnings.
W-LIFECYCLE-CANDIDATE              — A+ verdict #2 lint (S65) — lifecycle-candidate flag tightening.
W-LINT-001 … W-LINT-015            — generic lint catalog (15 slots populated).
W-MATCH-001 / W-MATCH-003          — match-expression lints.
W-MATCH-TRANSITIONS-ACCRUING       — state-machine match warning (Tier C, deferred).
W-PROGRAM-001 / W-PROGRAM-TITLE-NESTED — `<program>` block lints.
W-PURE-REDUNDANT                   — pure annotation lint (§48).
W-SCHEMA-002                       — schema lint.
W-TAILWIND-001                     — Tailwind utility-class lint.
W-WHITESPACE-001                   — whitespace lint.

## Info Diagnostic Codes

I-MATCH-PROMOTABLE — info-level lint (§56). Three shapes:
  - `exhaustive` — all variants covered; `bun scrml promote --match` can auto-lift.
  - `near-miss`  — partial coverage; add missing arms first, then promote.
  - `compound`   — compound condition branches; needs manual restructuring.
  Emitted by `runIMatchPromotable` in `lint-i-match-promotable.js` (post-TS pass in api.js).

## Error Handling Patterns

- Diagnostic objects collected per-pass and surfaced from `api.js` as `result.diagnostics` (no exceptions for user-facing errors).
- `throw new Error(...)` is reserved for compiler-internal invariant violations / programmer errors.
- VP-1 (validator-1) post-CE: `compiler/src/validators/post-ce-invariant.ts` enforces post-component-expansion shape invariants.
- W-1 lint pass: `compiler/src/lint-ghost-patterns.js` (ghost-pattern detection).
- Gauntlet phase checks: `gauntlet-phase1-checks.js` + `gauntlet-phase3-eq-checks.js`.
- I-MATCH-PROMOTABLE lint: `lint-i-match-promotable.js` (post-TS, info-only).
- LSP surfaces same diagnostic shape as `Diagnostic` objects to the editor.

## Global Error Boundaries
None — the compiler is a pure pipeline that returns diagnostics to the caller. The CLI prints diagnostics and exits non-zero on `severity === "error"`.

## Recent Error-Code Activity (S64 → S69)

- **S64 (Phase A1b B2):** E-NAME-COLLIDES-STATE landed (commit `0dee2f7`).
- **S64 (Stage 0c.A):** function-overload deletion + E-FUNCTION-OVERLOAD removed.
- **S65 (A+ verdict):** E-SWITCH-FORBIDDEN + W-LIFECYCLE-CANDIDATE tightening landed.
- **S65 (Tier A):** I-MATCH-PROMOTABLE info diagnostic introduced (§56).
- **S66 (A1b B4):** E-IMPORT-PINNED-INVALID + E-STATE-PINNED-FORWARD-REF landed.
- **S66 (A1b B6):** E-CELL-NO-RENDER-SPEC + E-CELL-RENDER-SPEC-NOT-BINDABLE landed (PASS 5).
- **S67 (A1b B7):** E-DERIVED-CIRCULAR-DEP SHIPPED in `dependency-graph.ts`. DFS; blocks codegen.
- **S67 (A1b B8):** E-DERIVED-VALUE-MUTATE SHIPPED in SYM PASS 6 (`symbol-table.ts`, backed by `derived-mutation-ops.ts`).
- **S67 (A1b B10 Phase 2):** E-TYPE-031 family SHIPPED in SYM PASS 7 (`walkValidatorTypeCheck`).
- **S67 (A1b B10 Phase 3):** E-VALIDATOR-CIRCULAR-DEP SHIPPED in `dependency-graph.ts`.
- **S68 (A1b B11):** SYM PASS 8 synth-cell registry (E-SYNTHESIZED-WRITE remains deferred, but infra in place).
- **S68 (A1b B13):** E-DERIVED-WITH-VALIDATORS SHIPPED in SYM PASS 9 (`walkRejectDerivedWithValidatorsAndExtractOverride`). Level-1 inline-override extraction: `ValidatorEntry.inlineOverride` field populated.
- **S68 (A1b B14):** Engine binding fires; auto-declared variable + MOD engine-aware exportRegistry landed (PASS 10.A/10.B).
- **S68 (A1b B15):** E-ENGINE-INVALID-TRANSITION + E-ENGINE-INITIAL-MISSING SHIPPED (PASS 11, backed by `engine-statechild-parser.ts`).
- **S68 (A1b B16):** E-DERIVED-ENGINE-* family SHIPPED (PASS 12; cycle detection via B7 reuse).
- **S68 (A1b B17):** E-COMPONENT-ENGINE-SCOPE SHIPPED (PASS 13).
- **S68 (A5-1 SPEC):** E-HISTORY-NO-INNER-ENGINE + E-INTERNAL-RULE-NOT-COMPOSITE added to §34 (SPEC-only; no compiler implementation yet).
- **S69 (A1b B18):** E-MULTI-STATEMENT-HANDLER SHIPPED. New helper `multi-statement-scan.ts`. Two fire-sites: markup event-handler attr + engine state-child :-shorthand. 55 tests.
- **S69 (A1b B19):** E-CHANNEL-INSIDE-PROGRAM + E-CHANNEL-SHARED-MODIFIER SHIPPED (PASS 15).
- **S69 (A1b B20):** E-VARIANT-AMBIGUOUS + E-TYPE-063 SHIPPED (bare-variant inference §14.10, PASS B20).
- **S69 (A1b B21):** Refinement-type three-zone §53 (boundary-zone hook recording + trusted-zone scope upgrade). No new error codes; classifyPredicateZone extension.
- **S69 (A1b B22):** E-RESET-INVALID-TARGET SHIPPED (PASS 14; reset(@cell) target-shape multi-level compound-nav accept).

## Open Follow-Ups
- **E-SYNTHESIZED-WRITE (§55.7, §6.11):** registry infra in place (B11/B12); fire-site deferred to A1c codegen.
- **E-HISTORY-NO-INNER-ENGINE / E-INTERNAL-RULE-NOT-COMPOSITE:** SPEC §34 rows added (A5-1 S68); compiler implementation pending Phase A7 dispatch.
- **GITI-006 (low-priority, S34→S69 carry-forward):** markup `${@var.path}` emits a module-top bare read that throws on async-initialized reactives.
- **ComponentDefNode classifier bug (S29-flagged, still present at S69):** `ast-builder.js:3634` classifies any uppercase-named `const/let` as component-def regardless of RHS.

## Tags
#scrmlTS #map #error #diagnostics #spec-section-34 #l21 #s67 #s68 #s69 #a1b-complete #a-plus-verdict #i-match-promotable #b7 #b8 #b9 #b10 #b11 #b12 #b13 #b14 #b15 #b16 #b17 #b18 #b19 #b20 #b21 #b22 #e-derived-circular-dep #e-validator-circular-dep #e-type-031 #e-derived-value-mutate #e-multi-statement-handler #e-channel-inside-program #e-reset-invalid-target #e-variant-ambiguous

## Links
- [primary.map.md](./primary.map.md)
- [domain.map.md](./domain.map.md)
- [SPEC.md §34](../../compiler/SPEC.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
