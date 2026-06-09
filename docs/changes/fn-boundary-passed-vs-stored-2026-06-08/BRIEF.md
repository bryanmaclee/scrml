# Function-boundary pass — name-the-rule + 4A (E-STRUCT-FUNCTION-FIELD) + Fork-3 doc tail — change-id: fn-boundary-passed-vs-stored-2026-06-08

Dispatched S175 (2026-06-08) to scrml-js-codegen-engineer, isolation:worktree, model opus, background. Agent af4be02fa27b5eae3. Three coupled S174-RATIFIED edits in one SPEC+type-system pass. PHASE-0-GATED.

## (1) 4A — reject fn-typed struct fields + wire FunctionType
Escalate checkFunctionTypedStructFields (ts:3456-3467, called ~:15873) W-TYPE-FN-FIELD (info) → hard E-STRUCT-FUNCTION-FIELD (Error); the field is rejected at declaration (S174 axiom). Wire FunctionType (iface :324, union :396) through resolveTypeExpr for struct-field resolution (closes int-for-fn silent hole; lets reject fire precisely; reuse isFunctionTypeAnnotation :2073; mind lifecycle disambig :2050-2067). SPEC §14.3 (:7468) flip "opaque asIs / OPEN deferred" → REJECTED. §34 add E-STRUCT-FUNCTION-FIELD; W-TYPE-FN-FIELD (:16544) retire/repoint for fields. W-COMPONENT-001 (prop side) SEPARATE + STAYS. Tests: fires on fn-typed field; lifecycle (A to B) does NOT; int-for-fn closed.

## (2) name-the-rule (passed-vs-stored), SPEC §15.11
"a function may be PASSED (prop/param) or CALLED (handler), but never STORED as value data (struct field / state cell)." §15.11 new §15.11.x or extend §15.11.5 + forward-ref §15.11.4. Cross-ref §14.3 (field-reject = STORED-rejection) + S174 axiom. Do NOT escalate W-COMPONENT-001 (PASSED hatch stays warned). Recon DD (passed-vs-stored-function-boundary-2026-06-08.md) = authority; flip its frontmatter in-progress→current/RATIFIED.

## (3) Fork-3 doc tail — identity/value (Clojure)
Clarify immutability axiom (S168, immutable VALUES) ↔ §15.11.2 State Projection (Clojure identity/value: reactive IDENTITIES hold immutable values; "immutability is on the TYPE DEFINITION not the instance" ~:8779) never contradict. NO single axiom section — property distributed §6.5/§45/§59.5/§15.11.2. Concise cross-ref note at §15.11.2 + a design-insight (scrml-support/design-insights.md). Cite Clojure to RATIFY §15.11.2, not litigate.

## CORPUS: scan examples/samples/stdlib/self-host for fn-typed STRUCT FIELDS; S174 = "zero real-corpus cost" (callbacks are PROPS not fields) — confirm; migrate any (enum/engine) WITH the reject. Don't touch fn-typed PROPS.

## OUT OF SCOPE: escalate W-COMPONENT-001; E-ROUTE arg-direction (g-route-arg-fn); W-COMPONENT-001 vestigial (g-component-001-coverage).

## PHASE 0: survey checkFunctionTypedStructFields + resolveTypeExpr FunctionType wiring (size it; STOP if new pass) + §34/§15.11/§14.3 placement + recon verdict + corpus scan. Report before impl.

## COMMIT S83; no --no-verify. PHASE 3: full suite green vs 23,538/0; R26 23-trucking-dispatch clean; node --check 0; codegen UNCHANGED. DO NOT mark DONE without green.

## REPORT: WORKTREE_PATH, FINAL_SHA, FILES_TOUCHED, Phase-0 design, E-STRUCT-FUNCTION-FIELD fires (+ lifecycle does NOT), rule §15.11 placement, Fork-3 cross-ref, corpus migration, suite delta + R26, codegen-unchanged, MAPS.
