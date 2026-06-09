# Tranche 2 — Shape C: cross-file typed-prop contract + structural width-subtyping — change-id: typed-sql-row-tranche2-2026-06-08

Dispatched S175 (2026-06-08) to scrml-js-codegen-engineer, isolation:worktree, model opus, background. Agent a0c9dc58ba5f79970. Follows Tranche 1 (landed 45bea7c5). PHASE-0-GATED greenfield build (component prop type-checking does not exist today). Ratified S175 — Shape C (user-voice scrmlTS S175).

## DESIGN
A consumer authors a plain `:struct` = the fields its prop reads; a SQL projection row (Tranche-1 resolveSqlRowType output) STRUCTURALLY width-subtypes into the declared `:struct` prop contract. Named, exported/imported like any struct. Flagship dogfood: load-card.scrml `load: asIs` -> `load: LoadCardRow` (the 6 fields the card reads); board.scrml 13-col + load-detail.scrml wider rows both width-subtype in.

- T2a typed prop access: resolve a `:struct` prop annotation -> ResolvedType; type field access inside the component body (load.id -> number, load.bogus -> error).
- T2b call-site width-subtyping check: at `<LoadCard load=expr/>`, get expr's type (SQL row via ScopeEntry.resolvedType; each-binding element type — VERIFY flows), check width-subtype into the declared `:struct`; new diagnostic on mismatch.

WIDTH-SUBTYPING RULE (bounded): S width-subtype-assignable to declared `:struct` T iff for every field f:Tf in T, S has f with a type assignable to Tf; extra S fields allowed. BOUNDED to source=SQL-projection-row, target=declared `:struct` contract. General struct-to-struct stays NOMINAL (do not touch §14.8 generated-type nominality elsewhere). Structural-assignability helper is net-new, scoped to this rule.

SPEC: reverses the §14.8 nominal-isolation wall (§14.8.1/.4/.7) ONLY for this bounded case. Survey §14.8/§14.3/§15.11, place the amendment (propose; likely new §14.8.8 + cross-refs), state ratification S175 + the bounding, add the §34 code (e.g. E-SQL-ROW-CONTRACT-MISMATCH) same-landing.

OUT OF SCOPE: protected-column-projection leak (deferred-from-T1; data-flow/return-boundary follow-on); bare-row field-access enforcement; general structural struct typing.

## PHASE 0 (report before building; STOP if off)
1. T2a fire site (component-body field-access typing; PropDecl type -> ResolvedType -> bind prop into body scope).
2. T2b fire site (is component instantiation type-walked? where does the prop-value check fire? CONFIRM the row type + each-binding element-type flow reach it; if a type-flow is MISSING, thread if bounded or STOP).
3. `:struct` resolution + cross-file export/import.
4. SPEC placement + new §34 code.

## BUILD: T2a + T2b + bounded helper + SPEC + §34 code + flagship dogfood (LoadCardRow + migrate load prop) + tests (positive board/load-detail; negative missing-field -> new code; in-component load.id typed / load.bogus errors; bounded general-struct unaffected).

## COMMIT S83; no --no-verify. PHASE 3 R26 on 23-trucking-dispatch (migrated LoadCard clean, 0 contract-mismatch on legit sites, node --check 0, full suite green vs 23,503/0, negative fixture fires the code). DO NOT mark DONE without R26 + green.

## REPORT: WORKTREE_PATH, FINAL_SHA, FILES_TOUCHED, Phase-0 design (2 fire sites + helper + SPEC placement + code), flagship-migration proof, negative-test firing, R26 + full-suite delta, type-flow SCOPE corrections, MAPS feedback.
