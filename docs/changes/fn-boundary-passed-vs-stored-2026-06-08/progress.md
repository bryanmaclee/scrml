# Progress — fn-boundary-passed-vs-stored-2026-06-08

Change-id: fn-boundary-passed-vs-stored-2026-06-08
Three coupled S174-RATIFIED edits on the function-boundary surface.

## 2026-06-08 — Startup + Phase 0 survey (pre-build)
- Worktree base was 1dbf67b4 (missing T3); merged main → 95c25b67 (T3 baseline, 23,538 pass / 0 fail expected). bun install + pretest clean.
- MAPS read: primary.map.md in full. Watermark f0b3cb04; verified type-system.ts/SPEC.md current via grep/Read (T1/T2/T3 SQL-row arc landed; W-TYPE-FN-FIELD/checkFunctionTypedStructFields at type-system.ts:3456, wired :15873).

### Corpus scan (piece-1 / piece-2 reject gate)
- Compiled all 930 corpus .scrml (examples/ samples/compilation-tests/ stdlib/ compiler/self-host/) via compileScrml.
- **W-TYPE-FN-FIELD fires: ZERO.** Confirms the S174 recon "zero real-corpus cost" — callbacks live as component PROPS (W-COMPONENT-001, out-of-scope), not struct fields. NO migration needed for the reject.

### resolveTypeExpr fn-shape trace (the "int-for-fn silent hole")
- `fn(...)` / `(...) => T` → asIs WITH `isFunctionField=true` sidecar (set in parseStructBody:1447 + inline-struct branch:2531).
- `() -> void` thin-arrow → falls all the way through to plain tAsIs() with NO sidecar (ends in `d` not `)`, dodges every typed branch). Indistinguishable from a genuine asIs / typo'd type → the silent hole.
- FunctionType interface (:324) is in ResolvedType union (:396) but NEVER produced by resolveTypeExpr today.

### DESIGN (3 pieces, one coherent pass)
**Piece 1 — reject + wire FunctionType:**
- Add a FunctionType branch to resolveTypeExpr: when `isFunctionTypeAnnotation(trimmed)` (the existing recognizer :2073 — covers fn()/=>/thin-arrow, lifecycle-disambiguated), return a FunctionType node (closes the thin-arrow silent hole; all three shapes now resolve to a distinguishable function kind, not asIs).
- Escalate `checkFunctionTypedStructFields` → fire `E-STRUCT-FUNCTION-FIELD` (Error, no severity arg) instead of W-TYPE-FN-FIELD (Info). Same recognizer (isFunctionTypeAnnotation), same two field positions (named struct decl raw + inline-struct annotation), same lifecycle disambiguation. The field is REJECTED at declaration.
- SPEC §14.3:7468 — flip "currently resolved as opaque asIs ... OPEN (deferred)" → REJECTED via E-STRUCT-FUNCTION-FIELD (S174 ruling). §34: replace the W-TYPE-FN-FIELD row (:16544) with an E-STRUCT-FUNCTION-FIELD Error row. W-COMPONENT-001 (PROP side) STAYS.

**Piece 2 — name the rule (§15.11):**
- New subsection extending §15.11.5 "What Is Explicitly Rejected" + a forward-ref note in §15.11.4: name "a function may be PASSED (prop) or CALLED (handler/inline), but NEVER STORED as value data (struct field / state cell)." Cross-ref §14.3 (the STORED-reject = piece 1) + §14.1.1 limit-the-primitive axiom. Do NOT escalate W-COMPONENT-001 (passed stays warned). The rule unifies props-warn + fields-error as two faces of ONE rule.

**Piece 3 — Fork-3 identity/value cross-ref (§15.11.2):**
- Concise note at the §15.11.2 State-instance-mutability site (:8895-8899) reconciling the S168 acyclic-immutable-VALUES property (distributed across §6.5/§45/§59.5 — NO single axiom section) with the Clojure identity/value split (reactive IDENTITIES are mutable cells holding immutable values; immutability is on the TYPE DEFINITION not the instance). Short pointer from §45. Cite Clojure to RATIFY §15.11.2, not invent a new axiom. + scoped narrative design-insight in scrml-support/design-insights.md.

### FunctionType wiring SIZE: SMALL — one branch in resolveTypeExpr (no new pass). Reuses isFunctionTypeAnnotation. STOP-gate (corpus migration / wiring balloon) NOT triggered.

### Next: build piece 1 (code) → piece 1 (SPEC) → tests → piece 2 (SPEC) → piece 3 (SPEC + insight) → DD frontmatter flip → full suite + R26.

## 2026-06-08 — Build complete (all 3 pieces landed)
- Piece 1 CODE (90f9ddfc): tFunction() helper + FunctionType branch in resolveTypeExpr (one branch, no new pass) + checkFunctionTypedStructFields escalated W-TYPE-FN-FIELD(Info) -> E-STRUCT-FUNCTION-FIELD(Error). Test renamed warning->reject, all 11 green. Full unit+integration+conformance 0-fail.
- Piece 1 SPEC (133724aa): §14.3:7468 OPEN->REJECTED; §34 W-TYPE-FN-FIELD row -> E-STRUCT-FUNCTION-FIELD Error row (breadcrumb retained).
- Piece 2 SPEC (eb57ee6c): §15.11.5.1 NEW — named passed-vs-stored rule (2 faces of 1 rule); §15.11.4 forward-ref note. W-COMPONENT-001 NOT escalated.
- Piece 3 SPEC (b10f57f1): §15.11.2 Clojure identity/value reconciliation note + §45.1 pointer. No new axiom section.
- scrml-support (4baeff4): design-insight appended + recon DD frontmatter in-progress->current+RATIFIED-S175.

### Verification
- R26 examples/23-trucking-dispatch: E-STRUCT-FUNCTION-FIELD fires = 0 over 36 files (the 7 callbacks are component PROPS, the warned surface — reject correctly does not touch them).
- compile -o --validate-emit: exit 0, 36 files; independent node --check on all 67 emitted .js = 0 failures.
- CODEGEN UNCHANGED: git diff 95c25b67..HEAD touches ONLY SPEC.md + type-system.ts + the test + progress.md — no codegen/ or emit-* files.

### Transient note
- One pre-commit attempt (piece-1 SPEC) hit a transient exit-1 while a concurrent background commit hook (piece-1 code) was still finalizing — temp-DB/resource contention (S164 background-commit-race class). Re-run with --bail in isolation = exit 0 / 0 fail; commit succeeded on retry. NOT a real failure.
