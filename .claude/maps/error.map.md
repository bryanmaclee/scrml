# error.map.md
# project: scrmlts
# updated: 2026-06-10T21:00:00Z  commit: d70f6bd8

scrml's own language error model is values-not-exceptions (SPEC §19.1 — no try/catch, no throw).
The compiler itself surfaces structured CGError objects to the caller; it never throws on bad input.

## Error Class

### CGError  [compiler/src/codegen/errors.ts:11]
code: string; message: string; span: CGSpan | object; severity: 'error' | 'warning' | 'info'
- W-/I- prefix OR severity:warning/info → result.warnings (non-fatal, CLI exits 0)
- All other codes → result.errors (fatal, CLI exits 1)
- Cross-stream helper required when asserting on W-*/I-* codes in tests (see diagnostic-stream-partition memory note)

## Error Code Families (388+ codes in compiler source; +7 §59 value-native map codes IMPLEMENTED S169 + 2 S173 (E-EXPORT-001 §21.2, W-TYPE-FN-FIELD §14.3 — W-TYPE-FN-FIELD RETIRED/ESCALATED to E-STRUCT-FUNCTION-FIELD S175) + 2 S174 (W-LOG-SHADOWED §20.6.7, E-TYPE-ANY-FORBIDDEN §14.1.1) + 3 NEW S175 (E-STRUCT-FUNCTION-FIELD §14.3/§15.11, E-SQL-ROW-CONTRACT-MISMATCH §14.8.8, W-SQL-ROW-UNTYPED §14.8.7) + 1 NEW S176 (E-TYPE-UNKNOWN-NAME §14.1.2) + W-PURE-REDUNDANT → W-PURE-DEPRECATED rename §33 + E-FN-004 generalized to imported non-det stdlib bindings — fire sites live end-to-end) + 1 NEW S179 (E-ROUTE-004 §12.5.3 non-serializable server-fn PARAM; E-ROUTE-003 same section now ENFORCED (was SPEC-only); I-FN-PROMOTABLE now skips inferred-server fns; E-FN-001 broadened to kind-agnostic structured-sqlNode so `return ?{}` fires) + S177 ZERO new codes (refinements only: E-CLOSER-001 now fires on a `/>`+`:`-shorthand body via `isGenuineShorthandBodyNotDirective` bug-74; E-SYNTAX-050 bare-`/` no longer over-fires before a close tag bug-4; a bogus E-SCHEMAFOR-NO-SQL-MAPPING on a predicated-primitive-in-union field is prevented r28-7b)

| Family | Count | Description |
|--------|-------|-------------|
| E-ATTR-* | ~15 | Attribute validation errors |
| E-AUTH-* | ~8 | Auth graph + role resolution errors |
| E-AUTH-GRAPH-* | 4 | Auth graph structural errors (E-AUTH-GRAPH-001..004) |
| E-BATCH-* | 2 | SQL batch planner errors |
| E-BS-* | 1 | Block-splitter sentinel (E-BS-000) |
| E-CG-* | ~15 | Code generator errors (E-CG-001..015) |
| E-CHANNEL-* | ~10 | Channel declaration errors |
| E-CLOSURE-* | 2 | Closure scope errors |
| E-CODEGEN-INVALID-JS | 1 | Emitted-JS parse-gate invariant (default-ON, S142): emitted JS fails `node --check`. S153 closed two false-fire classes; S157 Bug 70: gate SUPPRESSED when compilation already has a prior fatal error (api.js `hasPriorFatalError` check) — codegen-of-invalid-source after an E-SYNTAX-064 is EXPECTED, not a compiler defect |
| E-COLON-SHORTHAND-ON-VOID | 1 | **(S159 NEW — §4.14 / §34)** A void HTML element (`input`, `br`, `hr`, SVG `rect`/`circle`/`line`/`path`/`polyline`/`polygon`, etc.) carries a `:`-shorthand body (`<input : @val>`). A void element has no content model; bind via an ATTRIBUTE instead (e.g. `<input bind:value=@x/>`). Fired by type-system.ts `markup` visitor when `closerForm === "shorthand"` and `getElementShape(tag).isVoid === true` [type-system.ts:5004]. Fatal. |
| E-COMPONENT-* | ~15 | Component definition/usage errors |
| E-CONTRACT-* | 4 | Server-fn contract errors: E-CONTRACT-001 (static literal fails predicate), E-CONTRACT-001-RT (runtime boundary), E-CONTRACT-002 (named shape not in registry; also: enum-subset error marker at decl-site, S156), E-CONTRACT-003 (predicate refs external reactive var) |
| E-CPS-* | 6 | CPS async planner errors (idempotency, multibatch reorder/machine-crossing) |
| E-CTRL-* | 6 | Control flow errors |
| E-CTX-* | 2 | Context errors (E-CTX-001: unclosed block; E-CTX-003: shorthand confusion) |
| E-DECL-NEEDS-INITIALIZER | 1 | (S152/S160) — `const <x>: T` derived cell with no RHS (§6.2); S160 ruling (c): plain reactive no-RHS typed decls synthesize canonical-empty/`not` init and NO LONGER fire this code; the code survives ONLY for the `const`-derived sub-case [ast-builder.js] |
| E-DERIVED-* | 7 | Derived-value errors (circular-dep, engine-no-initial/rules/write, value-mutate) |
| E-DG-* | 2 | Dependency graph errors — E-DG-002 false-positive fix: credits lambda-body @var reads + `<match on=@cell>` block-form headers [dependency-graph.ts]; Bug 60 (S157): render-by-tag tag-name structural-read credit added (cells consumed ONLY through render-by-tag no longer fire E-DG-002); S159: `<span : @label>` body synthesis in ast-builder.js clears the prior false-fire for cells consumed via `:`-shorthand |
| E-EACH-ITER-SHAPE | 1 | Each iteration shape errors: missing-or-both `of`/`in` attrs [ast-builder.js] |
| E-ENGINE-* | ~20 | Engine declaration errors (incl. E-ENGINE-010: `given` guard in type-level transitions block); +4 NEW S154-S155 codes (see Key New Codes below) |
| E-ENGINE-ACCEPTS-NOT-ENUM | 1 | **(S154-S155 NEW)** `<engine for=T accepts=MsgType>` — `MsgType` is not a declared `:enum` type (or is absent from typeDecls). Fired at SYM PASS 11 in symbol-table.ts [symbol-table.ts:5939] |
| E-ENGINE-MSG-WITHOUT-ACCEPTS | 1 | **(S155 NEW)** A state-child declares a message arm (`\| .V :>`) but the engine opener has no `accepts=` attribute. Fired at PASS 20 [symbol-table.ts:6512] |
| E-ENGINE-MSG-ARM-NOT-EXHAUSTIVE | 1 | **(S155 NEW)** A state-child has message arms but the set does not cover all `accepts=` enum variants and carries no wildcard `\| _ :>` arm. Fired at PASS 20 [symbol-table.ts:6543] |
| E-ENGINE-MSG-UNKNOWN | 1 | **(S155 NEW)** `.advance(.X)` targets a variant in NEITHER the state-transition plane NOR the message-dispatch plane [type-system.ts:8322] |
| E-ENGINE-STATE-CHILD-MISSING | 1 | Engine state-child closer un-findable. S153 (c89c1cb1) closed the `:`-shorthand-child false-fire class [engine-statechild-parser.ts] |
| E-ERRORS-* | 2 | `<errors>` element validation (E-ERRORS-001, E-ERRORS-002) |
| E-EXPORT-001 | 1 | **(S173 NEW — SPEC §21.2)** A plain (Shape-1) OR derived reactive STATE CELL is named in an `export` clause. A state cell is not in the Form-2 exportable set (type / function / fn / const / let); a reactive cell holds per-instance runtime state, so exporting it has no cross-file meaning. Previously the export was SWALLOWED SILENTLY (emitted JS had no export; a cross-file import resolved to garbage). SHARED MOD-stage check — covers both pipelines (legacy ast-builder + native collect-hoisted both feed `file.ast.exports`). Fix-it: export a function returning it, a `const` of its current value, or wrap the cell in a component and export that. Fired in `buildImportGraph` via `collectStateCellNames`/`exportedLocalNames` [module-resolver.js:301]. Fatal. |
| E-EXPR-* | 30 | Native-parser expression grammar codes (§34.1) |
| E-FN-004 | 1 | **(EXISTING; GENERALIZED S176 — SPEC §41.19/§41.20, Error)** A pure `fn` body calls a NON-DETERMINISTIC primitive (reads host state). Historically identifier-keyed on HOST member-expressions (`Date.now`, `Math.random`, `crypto.randomUUID`) [type-system.ts:17481]. S176 generalized it to also fire on an IMPORTED non-det stdlib BINDING: a bare `now()` from `scrml:time` (§41.19) or `random()`/`randomInt()` from `scrml:random` (§41.20) inside a `fn` body. Registry-driven (`NONDET_STDLIB = { 'scrml:time': ['now'], 'scrml:random': ['random','randomInt'] }` [type-system.ts:6589]) — `collectNonDetStdlibBindings` [type-system.ts:6598] resolves each import to its local name (handles `as` rename) + an origin label, threaded into the fn-purity walker so it fires ONLY on those bindings (a user's own `function now() {}` is never in the set) [fire at type-system.ts:17511]. `function`/`server function` bodies are NOT pure and never fire. Next non-det primitive extends by adding a registry row. Fatal. |
| E-FORMFOR-* | 8 | formFor type validation errors |
| E-HISTORY-* | 1 | Engine history attribute error |
| E-IMPORT-* | 7 | Import resolution errors |
| E-INPUT-* | 5 | Input element errors |
| E-LIFECYCLE-* | ~12 | Lifecycle hook errors |
| E-LIN-* | 2 | Linear-type errors |
| E-MAP-BRACKET-WRITE | 1 | **(S169 IMPLEMENTED — SPEC §59.7)** A bracket-WRITE `@m[k] = v` is attempted on a map-typed cell (at any nesting level). Map reads are bracket-native (`@m[k]` → `V \| not`); map writes are method-native. The cycles-prereq COW bracket-write lowering (`8d9db4e1`) is array/object-shaped and would corrupt the map representation, so the typer gates a map-receiver bracket-write before the COW lowering. Fix-it: use `.insert(k, v)`. Fired in the `reactive-nested-assign` case [type-system.ts:~7705]. Fatal. |
| E-MAP-KEY-IS-MAP | 1 | **(S169 IMPLEMENTED — SPEC §59.4/§59.12)** A map (or `@ordered` map) is used as a map KEY type — out for v1 (an `@ordered` map's `==` is order-sensitive, which would break the §59.5 hash-consistency keystone). Fired by `classifyMapKey`→`checkMapKeyComparability` [type-system.ts:~2069]. Fatal. |
| E-MAP-KEY-NOT-COMPARABLE | 1 | **(S169 IMPLEMENTED — SPEC §59.4)** A value-native map key type is not §45-comparable (general code; cross-refs `E-EQ-003` for a function-containing key type). Map keys are identified by structural `==`. Fired by `classifyMapKey`→`checkMapKeyComparability` [type-system.ts:~2086]. Fatal. |
| E-MAP-LITERAL-MALFORMED | 1 | **(S169 IMPLEMENTED — SPEC §59.3)** A map literal has a bracket-depth-1 entry-colon with a missing key/value, a trailing colon, or an entry-count error. Fired by the legacy `preprocessMapLiterals` scanner [expression-parser.ts:~1447] AND the native `parseArrayLiteral` map fork [native-parser/parse-expr.js:~3548]. Fatal. |
| E-MATCH-* | ~7 | Pattern match errors (E-MATCH-ARM-SEPARATOR: stray-comma arm separator §18.2; E-MATCH-SUBSET-DEAD-ARM: see below) |
| E-MATCH-SUBSET-DEAD-ARM | 1 | **(S156 (d)-A NEW)** A match arm names a variant excluded by the matched cell's `oneOf`/`notIn` enum-subset refinement — the arm can never be reached. Fired by both type-system.ts (full type-resolution, both match loci) and symbol-table.ts PASS 20 (string-based block-form pass, constructor-form + member-access, batch 4) [type-system.ts:9602; symbol-table.ts:10883] |
| E-META-* | 7 | Meta check/eval errors |
| E-MW-* | ~6 | Middleware errors |
| E-NAME-* | 1 | Name collision with reserved identifier |
| E-PA-* | ~7 | protect-analyzer errors — E-PA-002 false-positive fix: `extractCreateTableStatements` now generic cycle-safe deep-walk [protect-analyzer.ts] |
| E-PARSEVARIANT-* | ~3 | parseVariant API errors |
| E-REFINEMENT-NO-DEFAULT | 1 | **(S160 NEW — §6.2 / §34)** A no-RHS refinement-typed cell (`<x>: number(>0)`) whose synthesized base canonical-empty (`0`) VIOLATES the predicate (fails `>0`). The type has no predicate-satisfying canonical empty and cannot be auto-defaulted; an explicit initializer is required. Fired by `runRefinementNoRhsDefaultCheck()` in type-system.ts after lifecycle-map build [type-system.ts:~17287]. Fatal. |
| E-REPLAY-* | 3 | Engine replay errors |
| E-RESET-* | 1 | Reset target errors |
| E-RI-* | ~3 | Route inference errors |
| E-SCOPE-001 | 1 | Identifier out of scope. S153 (e6870f25) closed the `<each>`-in-component-body false-fire class |
| E-SQL-* | ~8 | SQL context errors |
| E-STMT-* | 43 | Native-parser statement grammar codes (§34.1) |
| E-SWITCH-FORBIDDEN | 1 | `switch` keyword in scrml source |
| E-SYNTAX-* | ~11 | Syntax errors (E-SYNTAX-042..044: null/undefined in source; **E-SYNTAX-064 NEW S157**: `@.` contextual sigil used outside an `<each>` body scope — replaces the false E-SCOPE-001 / confusing E-CODEGEN-INVALID-JS on that class; S159 R3: extended to shorthand-body positions) |
| E-SYNTAX-064 | 1 | **(S157 NEW/PROMOTED; S159 R3 extended)** `@.` or `@.field` used outside an `<each>` body scope (§17.7.3). Fired at three sites: (1) TS markup-attr-value walk when `value.name` starts with `@.` and `!inEachBodyScope()` [type-system.ts:7434]; (2) TS `visitAttr` for variable-ref attr values [type-system.ts:6643]; (3) S159 R3: `:`-shorthand body positions outside any `<each>` body scope (e.g. `<li : @.name>` not inside an `<each>`) [type-system.ts:5016+]. Replaces the cascade to E-SCOPE-001 or E-CODEGEN-INVALID-JS on the same class. |
| E-SQL-ROW-CONTRACT-MISMATCH | 1 | **(S175 NEW — SPEC §14.8.8, Error)** A SQL **projection row** (a Tranche-1 typed `?{ SELECT ... }` row, §14.8.7) is passed to a developer-declared `:struct` prop contract — or assigned to a `:struct`-typed state cell — and FAILS the bounded **width-subtyping** rule: it is missing a contracted field, or projects one with an incompatible type. One diagnostic per unsatisfied field, naming the field + the contract type. Width-subtyping is one-directional (the contract is a lower bound; EXTRA projected columns are allowed) and applies ONLY projection-row → declared `:struct` (general struct-to-struct stays NOMINAL §14.8.1; a plain user struct whose fields coincide is NOT width-subtype-assignable). `asIs` fields (graceful-degraded columns or a named opt-out) are assignable; union targets accept any-member (covers optional `T \| not`). Fired at the prop call-site by `checkPropContract` [type-system.ts:9491] (from the `__propContractChecks` descriptor stamped by component-expander.ts) and at the cell boundary by `checkSqlRowAgainstCellContract` [type-system.ts:9629]; both delegate the field check to `checkSqlRowWidthSubtype` [type-system.ts:704]. Fatal. |
| W-SQL-ROW-UNTYPED | 1 | **(S175 NEW — SPEC §14.8.7, Info)** The result of a `?{ SELECT ... }` SQL query could NOT be fully typed as a projection row, so it (or one of its columns) degrades to `asIs`. Fires for the deferred long-tail SELECT shapes (`*` wildcard → whole-row `asIs`; CTE / UNION / subquery-in-FROM / a column whose source table or column is unknown → that column only `asIs`, rest stays typed — graceful per-column degradation). Names the untyped column(s). Severity `info` → result.warnings (non-fatal). Emitted by `resolveSqlRowType` [type-system.ts:5676] (two sites: ~5710 whole-row, ~5773 per-column); a throwaway error-sink is used during preflight so the lint is NOT double-counted. |
| E-TEST-* | 6 | Test block errors (E-TEST-001..006) |
| E-TIMEOUT-* | 2 | Engine timeout errors |
| E-TYPE-* | ~20 | Type system errors (E-TYPE-001 dormancy fix for object-literal lifecycle, S151 C4); **E-TYPE-063** used by Bug 63 (S157) for invalid `.advance(.V)` variant at markup handler-attr position; **S160**: E-TYPE-001 message extended with synthesis note when lifecycle was implied by a no-RHS typed decl (§14.12.3) |
| E-STRUCT-FUNCTION-FIELD | 1 | **(S175 NEW — SPEC §14.3 / §15.11, Error; ESCALATED from the retired S173 W-TYPE-FN-FIELD)** A struct field is declared with a FUNCTION type (`onClick: () -> void`, `cb: fn()`, `handler: (x: int) => string`). HARD REJECT at declaration. A function is NOT value data — it has no structural equality (§45.2), is not serializable, cannot be a map key (§59.4) — so it SHALL NOT be STORED as a field on a value-shaped collection (the limit-the-primitive axiom §14.1.1; the **STORED** face of the passed-vs-stored rule §15.11.5.1). A function may still be PASSED (a component prop, `W-COMPONENT-001`) or CALLED (event handler, inline), but never STORED. Fix-it: model behavior with an enum tag the consumer matches on, or an engine (§51.0). The field's type resolves to a distinguishable `FunctionType` (NOT opaque `asIs`) via `tFunction()` / `resolveTypeExpr` so the reject fires precisely on a function-typed field. Disambiguation: a lifecycle annotation `(A to B)` / `(A -> B)` (arrow WRAPPED in outer parens) is NOT a function type and never rejected — only the param-paren-then-arrow shape `(...) -> RetType` is. One diagnostic per function-typed field; recurses into array-element / nested inline-struct field types. Fired by `checkFunctionTypedStructFields` [type-system.ts:3497] via the conservative `isFunctionTypeAnnotation` predicate [type-system.ts:2087], wired at the type pass [type-system.ts:15917]. Fatal. |
| E-TYPE-ANY-FORBIDDEN | 1 | **(S174 NEW — SPEC §14.1.1 / §34)** The literal type-token `any` appears in a type-annotation position (struct/error field type, state-cell `typeAnnotation`, `fn`/`function` parameter or return type). `any` is not a scrml type — there is no `any` (S174 user hard line; TypeScript's type-checking opt-out has no scrml equivalent). The sanctioned untyped escape hatch is `asIs` — a deliberate, named, greppable opt-out (analogous to TS `unknown`, NOT `any`). Today `any` falls through `resolveTypeExpr`'s unresolvable path to `asIs`/`unknown` with NO diagnostic — silently masquerading as the sanctioned `asIs`; this catches the LITERAL `any` atom BEFORE that collapse. `any`-token-SPECIFIC via `typeTextMentionsAnyToken` (splits the raw type string on non-identifier chars, tests for a bare `any` atom) — catches `any`/`any[]`/`any \| not`/`[string: any]`/`{ payload: any }`; does NOT mis-fire on a NAME merely containing the substring (`Company`, `manyThings`, a param literally named `any`). An arbitrary undefined type name (`Frobnicate`) that ALSO resolves silently to `asIs` was a SEPARATE broader leak — **CLOSED S176 by `E-TYPE-UNKNOWN-NAME` (§14.1.2), the symmetric companion check on the SAME loci**. Fired by `checkAnyTypeForbidden` [type-system.ts:3720], wired at the type pass [type-system.ts:15924]. Fatal. |
| E-TYPE-UNKNOWN-NAME | 1 | **(S176 NEW — SPEC §14.1.2 / §34, Error)** A type-NAME leaf in any type-annotation position is UNRECOGNIZED — no type with that name is a built-in, declared in this file (incl. forward refs), or imported. Closes the broader silent-`asIs` leak the S174 §14.1.1 `any`-reject deferred (a typo'd / undefined PascalCase name like `Frobnicate` / `LaodCardRow` previously collapsed to `asIs` with ZERO diagnostic). SYMMETRIC to `checkAnyTypeForbidden` — both drive off `forEachTypeAnnotationLocus` so they cover IDENTICAL loci; the difference is the per-leaf predicate. Position-aware leaf classification via `forEachTypeNameLeaf` (NOT the flat `any`-token atomize — an unknown name is only a candidate in a name-LEAF position; a variant literal in `oneOf([.A])`, a predicate arg, or a field NAME is not classified; `emitMapKeys:false`). REGISTRY-DEPENDENT, so it MUST run AFTER the imported-types seed [wired type-system.ts:16464, vs the any-check at :16425]; an `importSpecifierNames` + machine-name `exemptTypeNames` set guards single-file-mode imported names + machine-typed cells (`@state: M`) from RED-firing. Out of v1 scope: db-block-scoped explicit annotations, native `.scrml` mirrors, type-as-argument idents (carry no `typeAnnotation`). Per-leaf `isUnrecognizedTypeNameAtom` [type-system.ts:3726]; `checkUnknownTypeNames` [type-system.ts:4232]. Fix-it: define / import the type, fix the spelling, or use `asIs`. Fatal. |
| E-USE-* | ~5 | `use` declaration errors |
| E-VALIDATOR-* | ~5 | Validator circular-dep / inline-dynamic |
| E-WRITE-NOT-IN-LOGIC-CONTEXT | 1 | Write attempt outside logic context |
| W-ASSIGN-* | 1 | Assignment warnings |
| W-ATTR-* | 2 | Attribute warnings |
| W-AUTH-* | 5 | Auth warnings: W-AUTH-001, W-AUTH-LOGIN-MISSING, W-AUTH-PAGE-INFERRED, W-AUTH-RUNTIME-FALLBACK |
| W-AUTH-CONTENT-NOT-GATED | 1 | `<auth role="X">` gates JS-mount only, NOT served HTML content [auth-graph.ts:627] |
| W-BATCH-* | 1 | SQL batch warnings |
| W-CG-* | ~10 | Code generator warnings (W-CG-001: top-level suppression; chunk warnings) |
| W-COLON-SHORTHAND-LEGACY-PLACEMENT | 1 | **(S160 NEW — §4.14 / §51.0.I / §18.0.1)** An engine state-child or `<match>` arm uses the legacy after-`>` colon placement (`<Idle> : expr`) instead of the canonical inside-opener form (`<Idle : expr>`). Info-level (W- prefix → result.warnings). Emitted at two sites in symbol-table.ts: engine state-child scan [symbol-table.ts:6035] and match-arm scan [symbol-table.ts:11045]. Includes `migrate --fix` suggestion; `rewriteColonShorthandPlacement()` in migrate.js applies the AST-driven rewrite. |
| W-DEPRECATED-* | 2 | Deprecation warnings |
| W-EACH-KEY-001 | 1 | Info-level lint: `<each in=@cell>` has no inferable per-item `.id` key [lint-w-each-key.js] |
| W-EACH-PROMOTABLE | 1 | Info-level lint: `${ for (let x of @cell) { lift ... } }` is promotable to `<each>` form [lint-w-each-promotable.js] |
| W-ENGINE-* | 2 | Engine warnings |
| W-EQ-* | 1 | Equality warnings |
| W-LIFECYCLE-* | 5 | Lifecycle warnings |
| W-LINT-001..024 | 24 | Ghost-pattern lint warnings [lint-ghost-patterns.js] |
| W-LOG-SHADOWED | 1 | **(S174 NEW — SPEC §20.6.7, Info)** A user-declared in-scope binding named `log` (the canonical no-op debugging stub `function log(...)`, or any local/import named `log`) shadows the location-transparent `log()` builtin (§20.6). The builtin steps aside and `log(...)` is emitted as an ordinary call to the user's `log` — the `[server\|client]`/`file:line` origin tag and dev unified-view forwarding are NOT applied. Surfaces so the author knows the builtin is inactive for that name. `log` is NOT a reserved identifier (declaring `function log` is legal — this lint, not `E-RESERVED-IDENTIFIER`). Severity `info` → result.warnings (non-fatal). Reserved for promotion to `E-LOG-SHADOWED` end-of-window once shadowing declarations migrate. Fired at the shadowing DECLARATION by `checkLogShadowing` [type-system.ts:3620], wired at the type pass [type-system.ts:15920]; emit-expr.ts independently suppresses the builtin lowering (`_logShadowedInFile` via `fileDeclaresLog`). |
| W-MAP-DUPLICATE-LITERAL-KEY | 1 | **(S169 IMPLEMENTED — SPEC §59.3/§59.11, Info)** A map literal has two depth-1 entries whose keys are §45-equal (`[ "DAL": 3, "DAL": 5 ]`); the later entry wins (last-wins, matching `.insert` overwrite). Info → result.warnings. Fired by both literal scanners [expression-parser.ts:~1485 / native-parser/parse-expr.js:~3619]. |
| W-MAP-ITERATION-ORDER | 1 | **(S169 IMPLEMENTED — SPEC §59.8/§59.11, Info)** A non-`@ordered` map is iterated (`<each in=@m.keys()/.values()/.entries()>`) without `.sorted()` in a position where order may matter; names `.sorted()` / `@ordered`. Info → result.warnings. Fired by `runWMapIterationOrder` [lint-w-map-iteration-order.js:~149], wired at api.js. |
| W-MAP-STRUCT-KEY-LITERAL | 1 | **(S169 IMPLEMENTED — SPEC §59.3/§59.11, Info)** A struct/enum-key map literal (`[ {a:1}: {b:2} ]`) appears in v1 — the grammar admits it but v1 codegen requires the `.insert` form for struct/enum keys (parse-accepted, codegen-deferred). Info. Fired by both literal scanners [expression-parser.ts:~1475 / native-parser/parse-expr.js:~3608]. |
| W-MATCH-* | 6 | Match warnings — W-MATCH-ARROW-LEGACY (S147): info-level, arm-context-scoped; **S172 (ratified S171): extended to the `derived=match` engine-decl arm locus (§51.0.J) — fires from type-system.ts ~L7931 via the raw-text `inlineMatchArmArrows[]` stamp**; W-MATCH-RULE-INERT; W-MATCH-VALUE-UNUSED |
| W-PROGRAM-* | 4 | Program-level warnings |
| W-PURE-DEPRECATED | 1 | **(S176 — SUPERSEDES W-PURE-REDUNDANT; SPEC §33 DEPRECATED banner / §34)** The `pure` modifier is DEPRECATED language-wide; `fn` is the canonical pure form. Fires on ANY `pure function`/`pure fn`/`server pure`/`pure server` declaration (was the narrower `pure fn` redundancy nudge). Info → result.warnings (non-fatal; not yet a hard reject). Gated on `isPure` at the fn-decl walk [type-system.ts:7597]. Auto-fixed by `scrml migrate` Migration 3 (`pure ... function NAME(` → `fn NAME(`, `server pure`/`pure server` → `server fn`). |
| W-STDLIB-* | 2 | stdlib shim/compiler-deferred warnings |
| W-TAILWIND-* | 2 | Tailwind class warnings |
| W-TRY-CATCH-IN-SCRML-SOURCE | 1 | try/catch used in scrml source |
| ~~W-TYPE-FN-FIELD~~ | 0 | **(S173 — RETIRED S175.)** Was the Info-level fn-typed-struct-field nudge. S175 ratified the function-boundary rule (§14.3, limit-the-primitive axiom): a function is NOT value data, so storing one on a struct field is now a HARD REJECT — escalated to **E-STRUCT-FUNCTION-FIELD** (Error). The W- code no longer fires anywhere in `compiler/src/` (grep-confirmed absent S175). See E-STRUCT-FUNCTION-FIELD below. |
| I-ASYNC-USER-SOURCE | 1 | Info: async pattern in user source |
| I-AUTH-REDIRECT-UNRESOLVED | 1 | Info: auth redirect target unresolved |
| I-FN-PROMOTABLE | 1 | Info: function eligible for promotion |
| I-MATCH-PROMOTABLE | 1 | Info: match eligible for engine promotion (§56) |
| I-PARSER-NATIVE-SHADOW | 1 | Info: native parser shadows live-pipeline result |

## Key New / Changed Codes Since Watermark c665714c (S154-S160)

### S154 — #14 event-payload-transition (parser batch 1)
No new diagnostics; existing codes extended. `accepts=MsgType` is recorded verbatim on the AST; the typer batch 2 (S155) owns the resolution diagnostic.

### S155 — #14 event-payload-transition (typer batch 2 + codegen batch 3)
- **E-ENGINE-ACCEPTS-NOT-ENUM** — `accepts=MsgType` resolves to an unknown or non-`:enum` type. SYM PASS 11, symbol-table.ts. Fatal.
- **E-ENGINE-MSG-WITHOUT-ACCEPTS** — state-child has message arms but engine has no `accepts=`. SYM PASS 20, symbol-table.ts. Fatal.
- **E-ENGINE-MSG-ARM-NOT-EXHAUSTIVE** — message-arm set does not cover all `accepts=` enum variants and has no wildcard. SYM PASS 20, symbol-table.ts. Fatal.
- **E-ENGINE-MSG-UNKNOWN** — `.advance(.X)` variant is in neither the state-transition plane nor the message-dispatch plane. type-system.ts. Fatal.

### S156 — Bug 62 + (d)-A enum-subset (4 batches)
- **E-MATCH-SUBSET-DEAD-ARM** — dead arm inside a `<match>` on a subset-refined cell. Batch 2: type-system.ts (type-resolution path, both match loci). Batch 4: symbol-table.ts PASS 20 (string-based path, constructor-form + member-access). Both fire independently when the matched cell's type has `subsetVariants`. Fatal.
- **E-CONTRACT-002** (extended use) — enum-subset refinement error markers (range form, empty list, malformed entries) lower to E-CONTRACT-002 at declaration time via `checkEnumSubsetErrorMarkers()` in type-system.ts. Reuses the contract family rather than introducing a dedicated code.
- Bug 62 fix: NO new error code. The root cause was silent wrong-JS generation (`.advance(.X)` lowered without engine-ctx → stale JS); the fix is in emit-each.ts codegen path, not diagnostic emission.

### S157 — match-exhaustiveness arc + multi-bug pass
- **E-SYNTAX-064** (promoted from implicit to explicit) — `@.` contextual sigil outside an `<each>` body scope. Previously fell through to confusing E-SCOPE-001 (base-name `@` unresolved) or E-CODEGEN-INVALID-JS (downstream JS parse failure). Now fires E-SYNTAX-064 explicitly at the TS pass (two sites in type-system.ts). Fatal.
- **Bug 70** (no new code) — E-CODEGEN-INVALID-JS gate in api.js: suppressed when a prior fatal error already exists (`hasPriorFatalError` check). No new diagnostic; changes when the existing gate fires.
- **Bug 63** (no new code) — markup event-handler attribute `.advance(.V)` variant checking extended to use existing E-TYPE-063 (invalid variant in two-plane resolution). Same code family as the statement-path check.
- Bug 65/72/60/71/67 fixes: NO new error codes. Bug 65 = silent miscompile (fix is engine-ctx threading in emit-lift.js). Bug 72 = E-CODEGEN-INVALID-JS (now prevented at codegen rather than detected post-emit). Bug 60 = missing render-by-tag expansion (no diagnostic path). Bug 71/67 = missing exhaustiveness (now correctly fires E-TYPE-020 via the existing match exhaustiveness path).

### S158 — Bug 64 / R28-1c per-item content reactivity + Bug 72 completion
- Bug 64/R28-1c: NO new error codes. The failure mode was stale content (no compiler error). Fix is purely codegen + runtime (EachReconcileCtx stack + _scrml_resolve_item).
- Bug 72 completion: see S157 — fully closed between S157 (ast-builder bare-@ branch) and the runtime-template / emit-each changes landing here.

### S159 — Bug 73 (per-item handler live-keying) + S154 ruling (a) HTML `:`-shorthand content-model
- **E-COLON-SHORTHAND-ON-VOID** (NEW) — void HTML element carries `:`-shorthand body; rejected because void elements have no content model (§4.14 / §34). Fired by type-system.ts `markup` visitor [type-system.ts:5004]. Fatal. `<input bind:value=@x/>` is the correct pattern.
- **E-SYNTAX-064** (extended — S159 R3) — now also fires at `:`-shorthand body positions where the body references `@.` outside any `<each>` body scope. E.g. `<li : @.name>` written as a top-level element (not inside `<each>`) fires E-SYNTAX-064 rather than falling through to E-CODEGEN-INVALID-JS.
- Bug 73: NO new error code. The failure mode was stale handler data (no compiler error — the handler silently fired against the create-time snapshot). Fix is purely codegen (`maybeWrapEachPerItemHandler` / `maybeWrapLiftPerItemHandler` / `maybeWrapLiftCallableHandler`).

### S160 — S154 rulings (b) and (c)

**Ruling (b) — inside-opener `:`-shorthand canonical; deprecate after-`>` placement:**
- **W-COLON-SHORTHAND-LEGACY-PLACEMENT** (NEW, info-level) — an engine state-child or `<match>` arm uses the deprecated after-`>` colon placement (`<Idle> : expr`) instead of the canonical inside-opener form (`<Idle : expr>`). Fires at two sites in symbol-table.ts: engine state-child PASS 11/20 when `sc.legacyColonPlacement === true` [symbol-table.ts:6035]; match-arm PASS 20 when `arm.legacyColonPlacement === true` [symbol-table.ts:11045]. W- prefix → result.warnings (non-fatal). `bun scrml migrate --fix` rewrites via `rewriteColonShorthandPlacement()` in migrate.js (AST-driven, string-/paren-/`${}`-aware).
- Both parsers (`engine-statechild-parser.ts`, `match-statechild-parser.ts`) now expose `legacyColonPlacement: boolean` on every arm entry. `native-walker/engine-statechild-walker.ts` exposes `legacyColonPlacement: false` for interface parity (native parser always emits canonical form).

**Ruling (c) — no-RHS typed-decl defaults (Shape 4 generalized):**
- **E-REFINEMENT-NO-DEFAULT** (NEW) — a no-RHS refinement-typed cell (`<x>: number(>0)`) cannot be auto-defaulted because its synthesized base canonical-empty (`0`) violates the predicate. Fired by `runRefinementNoRhsDefaultCheck()` in type-system.ts [type-system.ts:~17287]. Fatal. When the predicate is SATISFIED (`>=0` with `0`) or UNDETERMINABLE (named-shape predicate), no error fires.
- **E-DECL-NEEDS-INITIALIZER** (scope narrowed) — S160 ruling (c) narrows this code to the `const`-derived no-RHS sub-case only. Plain reactive no-RHS typed decls (`<x>: User`) now synthesize canonical-empty or `not` init instead of firing this code.
- **E-TYPE-001** (message extended) — when the `(not to T)` lifecycle on a cell was SYNTHESIZED from a no-RHS typed declaration (the developer wrote no annotation), the E-TYPE-001 message now appends a synthesis note (§14.12.3): "This `(not to T)` lifecycle was SYNTHESIZED from the no-RHS typed declaration `<x>: T` (Shape 4, §6.2): the type has no canonical empty, so the cell defaulted to `not` and acquired the lifecycle implicitly." Controlled by `FnReturnLifecycleSpec.synthesizedFromNoRhs?: boolean` propagated from `buildCellValueLifecycleMap`.

### S169 — SPEC §59 Value-Native Maps (+7 codes, IMPLEMENTED end-to-end)

The map type `[KeyT: ValT]` compiles end-to-end on the default pipeline + has native-parser literal
parity. The 7 codes below now have FIRE SITES (were SPEC-text-only at S168 — banner flipped
Nominal→Implemented at `8963ae52`). `grep` finds each fire site in `compiler/src/` (see the loci in the
family table above). Phases: D0 union-not normalization, D1 type-system, D2a legacy parser, D2b native
parser, D2c `<each as (k,v)>` sugar, D3 runtime, D4 codegen.

- **E-MAP-BRACKET-WRITE** (Error, §59.7) — `@m[k] = v` bracket-write on a map-typed cell at any nesting level (`@outer[k1][k2] = v` too). Reads are bracket (`@m[k]` → `V | not`); writes are method. The cycles-prereq (`8d9db4e1`) routes `@name[i] = x` through the COW `_scrml_deep_set` array/object path; on a map cell that would corrupt the representation, so the typer gates a map-receiver bracket-write BEFORE the COW lowering in the `reactive-nested-assign` case [type-system.ts:~7676-7705]. Fix-it names `.insert(k, v)`. This is the prereq↔§59 interaction.
- **E-MAP-KEY-NOT-COMPARABLE** (Error, §59.4) — map key type is not §45-comparable (general; cross-refs `E-EQ-003` for a function-containing key type). `classifyMapKey`→`checkMapKeyComparability` [type-system.ts:~2036/~2055/~2086].
- **E-MAP-KEY-IS-MAP** (Error, §59.4/§59.12) — a map (or `@ordered` map) used as a key type; out for v1 [type-system.ts:~2069].
- **E-MAP-LITERAL-MALFORMED** (Error, §59.3) — a map literal with a depth-1 entry-colon missing a key/value, a trailing colon, or an entry-count error. Legacy `preprocessMapLiterals` scanner [expression-parser.ts:~1447] + native `parseArrayLiteral` map fork [native-parser/parse-expr.js:~3548].
- **W-MAP-ITERATION-ORDER** (Info, §59.8) — non-`@ordered` map iterated without `.sorted()` where order may matter; → result.warnings. `runWMapIterationOrder` [lint-w-map-iteration-order.js:~149] wired at api.js.
- **W-MAP-STRUCT-KEY-LITERAL** (Info, §59.3) — struct/enum-key map literal (`[ {a:1}: {b:2} ]`) parse-accepted, codegen-deferred to the `.insert` form in v1 [expression-parser.ts:~1475 / native-parser/parse-expr.js:~3608].
- **W-MAP-DUPLICATE-LITERAL-KEY** (Info, §59.3) — two depth-1 literal entries with §45-equal keys; last-wins [expression-parser.ts:~1485 / native-parser/parse-expr.js:~3619].
- `E-EQ-003` + `E-EQ-001` are REUSED (no new row): a function-containing key type → `E-EQ-003` (fired from `checkMapKeyComparability` [type-system.ts:~2078]); a cross-type map-vs-non-map `==` → `E-EQ-001` (§45.3/§59.9).

### S173 — two new diagnostics (additive, zero-codegen)

- **W-TYPE-FN-FIELD** (S173, Info, §14.3 — **RETIRED/ESCALATED S175**) — was the function-typed struct field nudge. S175 ratified the function-boundary rule and escalated it to a HARD REJECT: **E-STRUCT-FUNCTION-FIELD** (Error). The W- code no longer fires (grep-confirmed absent in `compiler/src/` S175). The same `checkFunctionTypedStructFields` walk now fires the Error; the conservative `isFunctionTypeAnnotation` predicate (so lifecycle fields never mis-fire) was retained. See the S175 section below.
- **E-EXPORT-001** (NEW, Error, §21.2) — reactive state-cell export discriminator. Exporting a plain (Shape-1) OR derived reactive state cell is now a fatal error; previously the export was swallowed silently (no export in emitted JS; cross-file import resolved to garbage). The check is keyed on the `kind:"state-decl"` binding (NOT name-case), so `export const Greeting` (component-as-const), `export <channel>`, and exported engines stay legal. SHARED MOD-stage check — runs for both pipelines (legacy ast-builder + native collect-hoisted both feed `file.ast.exports`). `collectStateCellNames` [module-resolver.js:97] + `exportedLocalNames` [module-resolver.js:136] + the check in `buildImportGraph` [module-resolver.js:295-313]. Fix-it: export a function returning the value, a `const` of its current value, or wrap the cell in a component and export that (wrapping-component idiom).

### S174 — log() location-transparent builtin (§20.6) + `any`-reject hard line (§14.1.1)

Two additive diagnostics. Both are decl-site/use-site scans in type-system.ts wired alongside the
S173 `checkFunctionTypedStructFields` walk (lines 15003/15006/15010).

- **W-LOG-SHADOWED** (NEW, Info, §20.6.7 — `916b8bb3`) — a user-declared in-scope binding named `log` shadows the location-transparent `log()` builtin (§20.6). The builtin steps aside; `log(...)` lowers to an ordinary call to the user's `log` (no `[server|client]`/`file:line` origin tag, no dev unified-view forwarding). `log` is NOT a reserved identifier — `function log(...)` (the canonical no-op debugging stub) is legal; this is a lint, not `E-RESERVED-IDENTIFIER`. Fired at the SHADOWING DECLARATION by `checkLogShadowing` [type-system.ts:3620] (`FN_KINDS` = function-decl/fn-decl/function/fn with `name === "log"`), wired at the type pass [type-system.ts:15920]. The lint lives in the type pass (which has the wired diagnostic stream) — codegen's `EmitExprContext.errors` is not reliably populated; emit-expr.ts independently suppresses the builtin lowering via `_logShadowedInFile` (set from `fileDeclaresLog(fileAST)` in log-loc.ts, toggled at index.ts:587/760). Severity `info` → result.warnings (non-fatal). Reserved for promotion to `E-LOG-SHADOWED` end-of-window.
- **E-TYPE-ANY-FORBIDDEN** (NEW, Error, §14.1.1 — `f0b3cb04`) — the literal type-token `any` in a type-annotation position. `any` is not a scrml type — there is no `any` (S174 user hard line). The sanctioned untyped escape hatch is `asIs` (named, greppable, analogous to TS `unknown`). The recognizer `typeTextMentionsAnyToken` [type-system.ts:3678] splits the raw type string on non-identifier chars and tests for a bare `any` atom — catches `any`/`any[]`/`any | not`/`[string: any]`/`{ payload: any }` while NOT mis-firing on a NAME containing the substring (`Company`, `manyThings`, a param literally named `any`). Positions scanned: struct/error decl field types (`decl.raw`), cell `typeAnnotation` strings (incl. inline-struct/array/map/union members), fn-decl `params[]` types + return-type. `checkAnyTypeForbidden` [type-system.ts:3720] de-dupes by `start:end:where:typeText`, span-bearing decl-site scan; mirrors `checkFunctionTypedStructFields`/`checkMapKeyComparability` shape (`resolveTypeExpr` is span-free/error-free so the scan runs over RAW type text). Wired at the type pass [type-system.ts:15924]. `any`-token-SPECIFIC — an arbitrary undefined type name (`Frobnicate`) that ALSO resolves silently to `asIs` was a SEPARATE broader leak, now **CLOSED S176 by `E-TYPE-UNKNOWN-NAME` (§14.1.2)** — the symmetric companion check over the identical `forEachTypeAnnotationLocus` loci (registry-dependent, wired after the imported-types seed). Corpus migration: ~23 `any`→`asIs` sites in examples/23-trucking-dispatch + samples + stdlib/http rode the same wrap. Fatal.

### S175 — typed-SQL-row arc (3 codes) + function-boundary escalation

The flagship typed-data delivery (`45bea7c5` Tranche 1 / `1dbf67b4` Tranche 2 / `95c25b67` Tranche 3 / `9e6156c4` function-boundary). Additive type-pass diagnostics; default pipeline output UNCHANGED. New file `sql-projection.ts` (SELECT-projection extractor). No new AST node shapes (scans over existing nodes + raw SQL text).

- **E-STRUCT-FUNCTION-FIELD** (NEW, Error, §14.3 / §15.11 — `9e6156c4`) — ESCALATION of the retired S173 `W-TYPE-FN-FIELD` from Info-nudge to hard reject. A function-typed struct field (`onClick: () -> void`, `cb: fn()`, `handler: (x:int) => string`) is REJECTED at declaration. Rationale (the limit-the-primitive axiom §14.1.1 + the named passed-vs-stored rule §15.11.5.1): a function is not value data — no structural equality (§45.2), not serializable, not a map key (§59.4) — so it must never be STORED on a value-shaped collection. PASSED (prop, `W-COMPONENT-001`) / CALLED (handler) stay legal. The field type now resolves to a distinguishable `FunctionType` via `tFunction()` (NOT opaque `asIs`) so the reject fires precisely. Lifecycle annotations `(A to B)`/`(A -> B)` (arrow wrapped in outer parens) are NOT function types and never reject — only the param-paren-then-arrow `(...) -> Ret` shape is, gated by the conservative `isFunctionTypeAnnotation` [type-system.ts:2087]. One diagnostic per fn-typed field; recurses into array-element / nested inline-struct types. `checkFunctionTypedStructFields` [type-system.ts:3497], wired at the type pass [type-system.ts:15917]. Fatal.
- **E-SQL-ROW-CONTRACT-MISMATCH** (NEW, Error, §14.8.8 — `1dbf67b4`/`95c25b67`) — a SQL projection row passed to a `:struct` prop contract (T2b) or assigned to a `:struct`-typed cell (T3b) that fails the bounded structural **width-subtyping** rule (missing a contracted field, or projecting it with an incompatible type). One diagnostic per unsatisfied field. Width-subtyping is one-directional (contract = lower bound; EXTRA columns OK) and applies ONLY projection-row → declared `:struct` (general struct assignment stays NOMINAL §14.8.1 — a plain user struct that happens to match a row's columns is NOT width-subtype-assignable). `asIs` fields are assignable; a union target accepts any-member (covers optional `T | not`). `checkPropContract` [type-system.ts:9491] at the call-site (fed by `__propContractChecks` from component-expander.ts) + `checkSqlRowAgainstCellContract` [type-system.ts:9629] at the cell boundary; both delegate to `checkSqlRowWidthSubtype` [type-system.ts:704]. Fatal.
- **W-SQL-ROW-UNTYPED** (NEW, Info, §14.8.7 — `45bea7c5`) — a `?{ SELECT ... }` query (or one column) could not be fully typed and degrades to `asIs`. Deferred long-tail: `*` wildcard → whole-row `asIs`; CTE / UNION / subquery-in-FROM / unknown source-table-or-column → that column only `asIs` (rest stays typed — graceful per-column degradation). Names the untyped column(s). `resolveSqlRowType` [type-system.ts:5676] (whole-row ~5710 / per-column ~5773); a throwaway error-sink during preflight prevents double-counting. Severity `info` → result.warnings (non-fatal).

NOTE — the typed-SQL-row read-site machinery (no NEW codes, reuses E-TYPE-004): a projection-row binding (loop var over a `Row[]`, or unwrapped `Row | not`) is typed as the row struct so `r.<projected-col>` resolves to the column type and `r.<unknown>` fires **E-TYPE-004** (T2a). Driven by `resolveIterableRowElement` [type-system.ts:5812] + `checkRowFieldAccessInExpr` [type-system.ts:9420]. A T3c server-fn whose body returns a projection row over-approximates via `inferReturnTypeFromBody` [type-system.ts:5917] stamping the `<fn-return>` sentinel type (`FN_RETURN_TYPE_NAME` :631) — those inferred over-approximations are EXEMPT from the contract reject (they may legitimately narrow at the call site).

### S176 — unrecognized-type-name reject + `pure`-modifier deprecation + non-det stdlib (§14.1.2 / §33 / §41.18-41.20)

Closer-arc on the S174 `any`-reject + the DD1-Fork-1 scalar-vocabulary work. All additive type-pass diagnostics; default pipeline output UNCHANGED. No new AST node shapes.

- **E-TYPE-UNKNOWN-NAME** (NEW, Error, §14.1.2 — `46cffc83`) — closes the BROAD unknown-type-name leak the S174 §14.1.1 `any`-reject explicitly deferred ("an arbitrary undefined type name (`Frobnicate`) that ALSO resolves silently to `asIs` is a SEPARATE broader leak"). Every type-NAME leaf in EVERY type-annotation position must resolve to a built-in / a same-file decl (incl. forward ref) / an import / the `asIs` escape hatch; an unrecognized name now RED-fires instead of silently collapsing to `asIs`. SYMMETRIC to `checkAnyTypeForbidden` by construction (both drive `forEachTypeAnnotationLocus` → identical loci); the difference is the per-leaf predicate. Position-aware leaf walk `forEachTypeNameLeaf` [type-system.ts:3759] (`emitMapKeys:false` — a name leaf only; NOT the flat `any`-atomize) → `isUnrecognizedTypeNameAtom` [type-system.ts:3726] tests the registry + exempt set. REGISTRY-DEPENDENT: wired AFTER the imported-types seed [type-system.ts:16464] (vs `checkAnyTypeForbidden` at :16425 which is registry-free). `checkUnknownTypeNames` [type-system.ts:4232]; `exemptTypeNames` = import-specifier names (single-file-mode guard so the flagship `<loadRows>: LoadCardRow[]` doesn't RED-fire on a single-file compile) + machine names (`@state: M` annotates with the machine name, which lives in the machineRegistry not the typeRegistry). Out of v1 scope (NOT scanned): db-block-scoped generated DB type names (live in the scope chain, zero corpus instances), native `.scrml` mirrors, type-as-argument idents (`parseVariant(j, T)`, `formFor for=T` — carry no `typeAnnotation`). Fatal.
- **W-PURE-DEPRECATED** (NEW, Info, §33 DEPRECATED banner / §34 — `4a19a047`) — SUPERSEDES the former `W-PURE-REDUNDANT`. The `pure` modifier is DEPRECATED language-wide; the canonical pure form is `fn`. Fires on ANY `pure`-modified declaration (was the narrower `pure fn`-redundancy nudge), gated on `isPure` at the fn-decl walk [type-system.ts:7597]. Info → result.warnings (non-fatal; not yet a hard reject). Auto-fixed by `scrml migrate` Migration 3 [commands/migrate.js:197-216]: regex anchored on the DECLARATION shape (`[server ]pure[ server ](function|fn) NAME(` → `[server ]fn NAME(`) so prose mentions of "pure function" are untouched; idempotent. `W-PURE-REDUNDANT` no longer fires.
- **E-FN-004 GENERALIZED** (existing code, broadened §41.19/§41.20 — `beb8a115`/`35172d78`) — the non-deterministic-call-in-`fn` reject now ALSO covers imported non-det stdlib bindings (bare `now()` from `scrml:time`, `random()`/`randomInt()` from `scrml:random`), not just the hard-coded host member-expressions (`Date.now`/`Math.random`/`crypto.randomUUID`). Registry-driven via `collectNonDetStdlibBindings` [type-system.ts:6598] off `NONDET_STDLIB` [type-system.ts:6589]; fires only on resolved import bindings so a user's own `function now() {}` is never flagged. See the table row above.

### S177 — bug-tail refinements + g-formfor (ZERO new codes)

All S177 diagnostic-surface changes are REFINEMENTS to existing codes (no new code numbers, no
new table rows). Default pipeline output UNCHANGED.

- **E-CLOSER-001** (refined fire condition, `b1931f02`, bug-74) — a `/>` self-closer combined with a `:`-shorthand body (`<span :@thing/>`) now fires E-CLOSER-001. NEW `isGenuineShorthandBodyNotDirective(attrRaw, colonOff)` [block-splitter.js:1085] distinguishes a GENUINE shorthand body from the directive-`:` form (presence override at block-splitter.js:2598-2600); the directive `:` is followed, after the colon, by a directive token and does NOT fire.
- **E-SYNTAX-050** (narrowed over-fire, `b1931f02`, bug-4) — the bare-`/` no-bare-closer error now fires at EOF (`<p>hello/`) OR before a NEW opener, but NO LONGER before an actual close tag. `looksLikeCloser` [block-splitter.js:2973] gained a `nextIsCloseTag` guard (`<` immediately followed by `/`): a `/` directly before `</>`/`</tag>` is unambiguous literal markup text (`<li>… /</>`). The CONF-015 EOF contract still fires; only the slash-before-close-tag over-fire is suppressed.
- **E-SCHEMAFOR-NO-SQL-MAPPING** (false-fire prevented, `b1931f02`, r28-7b) — a `<schemaFor>` over a field whose type is a PREDICATED-PRIMITIVE base in a nullable union (`bio: string req length(<=200) | not`) no longer mis-fires this code. The non-`not` member stayed `asIs` (the enum-subset recovery returns null for a predicated primitive), so `classifyFieldForSql([asIs, not])` yielded no mapping → bogus error. Fix [type-system.ts:15596] recovers the leading primitive token from the raw clause and re-synthesizes `[resolvedPrimitive, not]` so the field rides the bare-`string | not` nullable path; the predicate's CHECK constraints (`length(...)`) are parsed independently.
- **bug-48** (no diagnostic — parser/codegen miscompile prevented, `b1931f02`) — a `>` / `/>` INSIDE a `(...)`/`[...]` in an `on=` expression (`on=@nums.filter(c => c == 1)`) was mis-read as the opener's end → truncated `onExprRaw` → invalid emitted JS. Fixed by paren/bracket depth tracking in ast-builder.js opener-finders + `on=`-capture loops + the emit-match `resolveOnExpr` complex-`on=` Shape-B lowering. See structure.map.md "Key S177 Source Changes".
- **g-formfor** (no diagnostic — silent non-render prevented, `75f724af`) — a `<formFor>`/`<tableFor>`/`<Component>` inside an `<engine>` state-child or `<match>` arm was emitted RAW (silent non-render; an empty `onsubmit=${}` formFor also → invalid JS); now the markup-expansion passes recurse into `bodyChildren`/`armBodyChildren`. See domain.map.md "markup-expansion-in-arms" + structure.map.md "Key S177 Source Changes".
- **s169-map-inline-insert** (no diagnostic — runtime TypeError prevented, `b1931f02`) — an INLINE map-method assign in a handler (`onclick=${@m = @m.insert(k,v)}`) was routed through the string `rewriteBlockBody` path, leaving `_scrml_map_insert` unresolved → TypeError at click; now routed through `emitExprField → emitAssign` so the map-method RHS lowering fires [emit-event-wiring.ts:480-506].

## Fix Notes

### E-TYPE-001 dormancy (S151 C4 / R28-5)
Object-literal lifecycle contexts in `type-system.ts` were missing E-TYPE-001 emission paths.
Fixed in `type-system.ts` — object-literal construction now correctly triggers lifecycle type checks.

### Source-map line-lie (S149-S150)
Prior implementation emitted `0:0` stubs for all mappings (a lying synthetic source map).
S149 (B2): `build-source-map.ts` now uses `srcmap-provenance.ts` sentinel marks injected by
emit functions to record USE-SITE spans. `srcmapMark()` injects `#scrmlmap#` tokens; `buildSourceMap()`
scans them via `findSrcmapMarks()`, resolves to real source positions, and strips marks via
`stripSrcmapMarks()` before output.
S150 (line-lie close): honest-synthetic validation — synthetic mappings validated at resolution
time; map entries that cannot resolve to a real source line are marked synthetic in the output.

### log() location resolution (S174 — `916b8bb3`)
`log-loc.ts` `resolveLogLoc(span)` → "basename:line": the `log()` call node's own `span.line` is
UNRELIABLE (codegen re-parse stamps `line:1`), so the line is computed from the node's byte OFFSET
(`span.start`) against a `LineIndex` built once-per-file from the source registered via
`registerFileSource(filePath, source)`. emit-expr.ts prefers `node.span` when its `start > 0`, else
falls back to `ctx.stmtSpan` (the enclosing statement span keeps the real offset through re-parse).
`resetLogLoc()` clears the per-compile source/index cache at runCG start.

### Inline ?{} SQL CPS-split (S152)
`emit-control-flow.ts` — inline `?{}` SQL inside a conditional branch was not being CPS-split;
the branch body lacked the `await _scrml_sql...` wrapping IIFE. Fixed; coupled match-server-emit
path also corrected (match arms containing SQL on the server side).

### `<each>` render-before-cell-init crash (S152 HIGH)
`emit-each.ts` — `emitEachBodyRenderForFile()` emits a render fn that runs synchronously at
module-init. When the source cell is declared in the same file, `_scrml_reactive_set` runs
AFTER the render fn (module-init order). The bare `_scrml_reconcile_list(_mount, undefined, ...)`
threw `TypeError: ...newItems.length`. Fix: guard `if (!_items) { _mount.replaceChildren(); return; }`
before reconcile; `_scrml_effect_static` subscription re-runs the fn once cell-init fires.

### `<each>`-in-dynamic-context sweep (S153) — every place an `<each>` lives inside a dynamic mount

**engine-gated `<each>` never populates (54d54d4d, the req2 blocker)** — an `<each>` whose mount
lives in a non-`initial=` engine arm is absent from the DOM at module-init; the render hit
`if (!_mount) return;` BEFORE reading `@cell` → `_scrml_effect_static`'s one-shot dep pass recorded
no dependency → never re-fired. Three coupled codegen modes: (A) `emit-each.ts` reads `_items`
BEFORE the `!_mount` early-return (always tracks the dep); (B) `emit-variant-guard.ts` + runtime —
`_scrml_each_renderers` registry + `_scrml_remount_each(root)` helper the arm-swap dispatcher calls
after innerHTML+wire; (C) `emit-client.ts` `detectRuntimeChunks` descends into engine `bodyChildren`
(was tree-shaking the reconcile/effect chunks out → ReferenceError).

**`<each>` in a block-form `<match>` arm emits invalid JS (3429b385, was E-CODEGEN-INVALID-JS)** —
match arms are raw text (`armsRaw`); `emit-match` re-parsed via `nativeParseFile` → a generic
`markup tag="each"`, NOT an `each-block` (the each-block transform lives in `buildAST`, not the
native parser) → rendered inline with `@.` unscoped (`.name` leak). Fix: each-bearing arms re-parse
via `splitBlocks`+`buildAST`; `restampEachBlockIds` namespaces ids; lifted each-blocks attach to
`matchBlock.bodyChildren` so `collectEachBlocks` emits the render fn with the `@.` rewrite;
`__scrmlCachedArms` memoizes across the two passes.

> **S162 native-stale note:** the parenthetical above ("the each-block transform lives in `buildAST`, not the native parser") described the native parser's state at S153. As of S162 (unit A, 39b1424a) the native parser DOES promote `<each>` → `each-block` (`isEachBlock`/`synthEachBlockNode` in parse-file.js) and `<match>` → `match-block`. The historical FIX (re-parse via `splitBlocks`+`buildAST`) remains as-was, but `nativeParseFile` no longer leaves a generic `markup tag="each"`. See primary.map.md "Native-Parser Swap Orientation" + structure.map.md "Native-Parser File Table (S162)".

**`:`-shorthand child inside an engine arm breaks state-child parsing (c89c1cb1, was
E-ENGINE-STATE-CHILD-MISSING)** — a §4.14 `:`-shorthand child (`<li : @.name>`) inside an engine
state-child broke closer-pairing. Fix: attr-aware `isColonShorthandOpener` (whitespace-preceded
depth-0 non-string `:`; tracks string/paren/brace/bracket/`${}` so `bind:`/`on:`/`style="x:y"`/
`${a?b:c}` aren't mis-detected) wired into all 3 finders, mirroring the void/self-close exclusions.

**`<each>` over an enclosing-scope binding (e6870f25, was E-SCOPE-001 / E-CODEGEN-INVALID-JS)** —
two bugs, one root (file-scope each emission can't see enclosing scope): (A) nested `<each>` (the
`as` pattern) — the inner each was lifted to module-scope reading `group.items` (undefined) →
ReferenceError; fix = inline emission in the outer factory via shared `emitEachReconcileLines`.
(B) `<each>` in a component body — `@.id` E-SCOPE-001 + `.name` leak; 3 roots in
`component-expander.ts` (native parser doesn't promote each/match → legacy `splitBlocks`+`buildAST`
re-parse fallback; `substituteProps` missed each-block string fields; tokenized `@ . id` collapse).

### Bug 62 — `<each>` engine-ctx threading (S156)
`emit-each.ts` — per-item event handlers in `<each>` templates that contained `.advance(.X)` or
`@engine = .X` were lowered WITHOUT engine awareness: `rewriteBlockBody` had no reference to the
file's engine metadata (the `EngineRewriteCtx`) so the call resolved to `undefined(...)` → silent
wrong JS. Fix: `buildEachEngineCtx(fileAST)` is called ONCE at the top of `emitEachBodyRenderForFile`,
collects all file-scope engines with message arms + their message-variant sets, builds a minimal
`EachEngineCtx` carrying the engine var names, a spread of `emitExprField` context extras, and the
`engineRewriteCtx`. This ctx is threaded through all `renderTemplateAttrToJs` / `renderTemplateChildToJs`
/ `emitEachReconcileLines` calls; `emitEngineHandlerBody(preRewritten, ctx)` intercepts (A) call-ref
`.advance(.X)` forms and (B) assign-ref `@engine = .X` forms and routes both to the correct plane.

### Bug 65 — `${for…lift}` engine-ctx threading (S157 — CLOSED)
`emit-lift.js` — the IDENTICAL gap as Bug 62 in the Tier-0 path. `buildLiftEngineCtx(fileAST)`
delegates to `buildEachEngineCtx` via `require()`. `buildLiftEngineCtxFromExtras(extras)` is a thin
re-pack adapter that uses engine extras already threaded via emit-logic opts (no AST re-walk).
`tryLowerLiftEngineHandler(rawHandlerText, engineCtx)` delegates to `emitEngineHandlerBody` (emit-each).
`emit-logic.ts` for-stmt case threads all engine extras (previously silently dropped) into `emitForStmt`.
The failure mode (pre-fix) was a SILENT miscompile: `_scrml_reactive_get("phase").advance("Active")`
→ `.advance` on a bare string → `TypeError` on click. `node --check` passed. `compileScrml()` exits 0.

### Bug 60 — render-by-tag nested compound field expansion (S157 — CLOSED)
`emit-html.ts` — `<signupForm><userName/></>` where `userName` is a field of a compound-parent
`signupForm` cell. Bare `lookupStateCell(tag)` returned undefined for the nested field because
compound-parent cells register their children under qualified paths (`signupForm.userName`), not
bare names. Fix: `enclosingCompoundStack: string[]` tracks the active compound wrapper tag during
the markup walk; fallback `lookupQualifiedStateCell(fileScope, [enclosing, tag])` resolves nested
fields. `dependency-graph.ts`: render-by-tag tag names (lowercase, matching `reactiveVarNodeIds`)
now credit the cell as a reader for E-DG-002 purposes.

### Bug 72 — nested `<each>` inside Tier-0 `${for…lift}` (S158 — CLOSED)
`emit-lift.js` + `ast-builder.js` — A `<each>` child of lifted markup arrives as generic `markup`
node (ast-builder's `parseLiftTag` never promotes to `each-block`). Pre-fix: rendered as literal
`<each>` DOM tag + inner `@.` leaked raw → E-CODEGEN-INVALID-JS. Two parts:
(1) `ast-builder.js` `_parseLiftAttrValue`: bare `PUNCT "@"` token now collected as balanced
`@...` token run → `{kind:"expr"}` value; keeps the lift on the structured `{kind:"markup"}` path.
(2) `emit-lift.js` `tryEmitNestedLiftEach`: routes `{kind:"markup", tag:"each"}` child through
`emitNestedEachFromMarkup` (emit-each.ts) → inline reconcile JS. Inner `@.` correctly lowers to
the inner each's iter var (§17.7.3 innermost-scope-wins).

### Bug 64 / R28-1c — per-item content reactivity on reconcile (S158 — CLOSED)
`_scrml_reconcile_list` reuses DOM nodes for same-key items (B2 fast-path bail). Per-item TEXT
and class: bindings that closed over the create-time iter var showed STALE content on array-replace
/ reorder. Fix has three layers:
(1) **Runtime** (`runtime-template.js`): `_scrml_reconcile_list` builds `container._scrml_item_by_key`
key→item Map on every pass; calls `_scrml_trigger(container, "_scrml_items")` (skip first pass) to
re-fire per-item effects. `_scrml_resolve_item(container, key)` tracks `(container, "_scrml_items")`,
returns live item via `_scrml_deep_reactive` or `null`.
(2) **Tier-1** (`emit-each.ts`): `EachReconcileCtx` stack; `maybeWrapEachPerItemEffect(lines, iterVar, indent)`:
when a reconcile ctx is active for the iter var, wraps binding body in a `_scrml_effect` that
calls `_scrml_resolve_item` + null-guard before running the body.
(3) **Tier-0** (`emit-lift.js`, `emit-control-flow.ts`): `_scrml_lift_reconcile_ctx_stack` +
`pushLiftReconcileCtx`/`popLiftReconcileCtx` wired into the `for`-loop `createFn` body. Key
captured as `item?.id != null ? item.id : _scrml_idx` (mirrors `_scrml_reconcile_list` keyFn).
`maybeWrapLiftPerItemEffect` wraps per-item bindings identically. Both tiers end on ONE live-keyed
per-item binding shape.

### Bug 73 — per-item EVENT HANDLER live-keying (S159 — CLOSED)
Sibling-gap #2 of Bug 64. Per-item event handlers in BOTH tiers closed over the CREATE-TIME iter
var. On same-key reconcile the handler fired with stale data even after Bug 64 fixed display bindings.
Fix is DISTINCT from Bug 64: handlers do NOT use `_scrml_effect` (no reactive subscription); instead,
a fire-time re-resolution prelude is prepended inside the existing `function(event) { ... }` body.

**Tier-1 (emit-each.ts):**
`iterScopeReferencedInHandler(handlerBody, iterVarName)` — gates the wrap by token-scanning the
handler body (string/regex literals blanked via `blankStringAndRegexLiterals` to prevent false
matches on iter-var names inside literals). `maybeWrapEachPerItemHandler(handlerBody, iterVarName)`:
when a reconcile ctx is active AND the scan finds the iter var, prepends:
  `let <iterVar> = _scrml_resolve_item(<mount>, <keyVar>); if (<iterVar> === null) return;`
Global handlers and literal-only bodies stay byte-identical (scan returns false → no prelude).

**Tier-0 (emit-lift.js):**
`maybeWrapLiftPerItemHandler(handlerBody)` — function-body handler shape (a): same prelude pattern.
`maybeWrapLiftCallableHandler(arrowText)` — callable-direct shape (b): produces a FULL wrapper
`function(event) { let <iterVar> = _scrml_resolve_item(...); if (...) return; (<arrowText>)(event); }`
so the wrapper's `let` lexically shadows the arrow's free `<iterVar>` reference. Returns null when
no wrap applies (byte-identical to pre-fix). Both shapes gate on the shared `_liftIterScopeReferenced`
(delegates to `iterScopeReferencedInHandler` from emit-each.ts via `require()`).

### S154 ruling (a) — HTML `:`-shorthand content-model (S159 — CLOSED)
`<span : @label>` previously parsed but emitted an empty `<span></span>` (expression dropped) and
the cell false-fired `E-DG-002` ("declared but never consumed"). Three-part fix:
(1) `ast-builder.js` (`buildBlock`): non-void, non-component, non-`@.`-sigil HTML elements with a
`:`-shorthand body now get body children synthesized via re-parse of `<tag>BODY</tag>` — byte-identical
to the explicit bare-body form. Expression body → `${expr}` interpolation; `"..."` display-text
literal → unquoted display text (interior `${...}` preserved). Synthesis skips void, component, and
`@.`-sigil bodies (those paths have separate owners or E-COLON-SHORTHAND-ON-VOID / E-SYNTAX-064).
(2) `block-splitter.js`: the `shorthand && !selfClosing` branch is placed BEFORE the void/self-closing
short-circuit so `<void : expr>` reaches the type-system guard rather than being silently classified
self-closing.
(3) `type-system.ts`: `E-COLON-SHORTHAND-ON-VOID` guard (fatal) at the markup visitor; R3 extension
of E-SYNTAX-064 to `@.`-sigil shorthand bodies outside an `<each>` scope.

### S154 ruling (b) — inside-opener `:`-shorthand canonical; after-`>` deprecated (S160)
`engine-statechild-parser.ts` + `match-statechild-parser.ts` — both parsers now detect the after-`>`
placement (`<Idle> : expr`) as legacy and mark each arm entry with `legacyColonPlacement: true`. The
inside-opener form (`<Idle : expr>`) is canonical (§4.14 / §51.0.I / §18.0.1). `symbol-table.ts`
emits `W-COLON-SHORTHAND-LEGACY-PLACEMENT` (info-level) for every legacy arm (two sites: engine +
match). `commands/migrate.js` `rewriteColonShorthandPlacement(source, filePath)` — AST-driven
`--fix` rule: drives the live front-end, locates legacy arms via parser `legacyColonPlacement` flags,
applies `rewriteColonPlacementInBody` string-precise splice right-to-left (string-/paren-/`${}`-aware
opener-`>` boundary scan). Fail-safe: re-finds the original body at its recorded offset before splicing.

### S154 ruling (c) — no-RHS typed-decl defaults / Shape 4 generalized (S160)
`ast-builder.js` — Shape 4 generalized (§6.2). A plain reactive no-RHS typed decl (`<x>: T`)
now synthesizes a canonical initial value rather than firing `E-DECL-NEEDS-INITIALIZER`:
- Primitives: `int`/`integer`/`number` → `0`; `bool`/`boolean` → `false`; `string` → `""`.
- Arrays (`T[]`) → `[]` (pre-existing S152 behavior).
- Bare named types (named `:struct`, `:enum`, opaque, date, timestamp) → `not` init + `implicitNotLifecycle: true` flag.
- Unions admitting absence (`T | not`, `T?`) → `not` init, NO lifecycle flag.
- Refinement-typed (`int(>0)`) → synths base canonical-empty + `refinementNoRhsBase` flag.
- `const` no-RHS (non-array) → E-DECL-NEEDS-INITIALIZER (preserved — derived cells need an expression).
`TYPE_BOUNDARY_KEYWORDS` stop-set added to `collectTypeAnnotation` for the no-RHS scan path, preventing
greedy swallow of the next sibling statement into the type string.
`type-system.ts` — `buildCellValueLifecycleMap`: handles `implicitNotLifecycle` → synthesizes `(not to T)`
spec with `synthesizedFromNoRhs: true`; `checkLifecycleBindingAccess`: extends E-TYPE-001 message
with synthesis note; `runRefinementNoRhsDefaultCheck()`: fires `E-REFINEMENT-NO-DEFAULT` when predicate
is VIOLATED on synthesized base canonical-empty (invoked from `processFile` at lifecycle-map phase).

### (d)-A enum-subset refinement (S156, 4 batches)
**Batch 1 (type-system.ts):** `parseEnumSubsetRefinement()` calls the shared `parseEnumSubsetAnnotation()`
from `enum-subset-refinement.ts`; `makeEnumSubsetPredicatedType()` materializes a `PredicatedType` with
`subsetVariants: Set<string>` (already complemented for `notIn`). Error markers (range form, empty set,
malformed entries) are deferred as `predicate.kind === "error"` and lowered to E-CONTRACT-002 at
declaration-site validation.

**Batch 2 (symbol-table.ts PASS 20 + type-system.ts match exhaustiveness):** Both match exhaustiveness
loci (block-form `<match>` in PASS 20; constructor-form + member-access in type-system.ts) now narrow
to the `subsetVariants` set instead of the full base-enum set. Arms naming excluded variants →
`E-MATCH-SUBSET-DEAD-ARM`; arms naming in-subset variants are required for exhaustiveness.

**Batch 3 (emit-predicates.ts + emit-schema-for.ts):** `predicateToJsExpr()` handles `kind: "variant-set"`:
emits `(["A","B"].includes(valueExpr))`; `classifyFieldForSql()` handles `predicated` type with
`subsetVariants`: emits `{ kind: "bare-enum", ..., enumSubset: true }` so the DDL walker emits
`CHECK (col IN ('Admin','Editor'))` in base-enum declaration order.

**Batch 4 (symbol-table.ts PASS 20 reach — constructor-form + member-access):** E-MATCH-SUBSET-DEAD-ARM
enforcement extended to the constructor-form match path and member-access match path in PASS 20,
so both `<match on=@role>` block-form AND inline `match @role { .Admin => ... }` patterns enforce
the subset. Closes Bug 66 (both loci must agree per §18.8.1 / §18.0.1).

### Bug B — structural-compound deep-set codegen mistarget (S170 — CLOSED, no new code)
`72aa6836`. A LIVE-pipeline CODEGEN mistarget (NOT a new diagnostic — the bug emitted WRONG JS with
NO error). `@a.ref = v` on a Variant-C structural compound (`<a><ref>=""</>`, where `a` lowers to a
`_scrml_derived_declare` composite reading the leaf `a.ref`) emitted a `reactive-nested-assign` write to
the COMPOSITE key `a`; the derived recompute then silently clobbered the write (lost mutation, exit 0,
failed at runtime even for a SINGLE write). Distinct root from Bug A (S167 `75431e9e` — that was a PARSER
boundary bug dropping deep-sets at statement position 2+; Bug B is the CODEGEN target selection).
**Fix:** `reactive-deps.ts:stampCompoundDeepSetTargets` (~L739, run once-per-file at `runCG`) stamps the
node with `_deepSetLeafKey` (deepest backing LEAF cell) + `_deepSetResidualPath`; `emit-logic.ts`
(~L3025-3035) retargets the write to the leaf cell (single-segment → `_scrml_reactive_set("a.ref", v)`;
residual/computed → COW `_scrml_deep_set` into the leaf). FLAT object cells UNCHANGED. SPEC §6.3.2. This
closes the LAST open HIGH (Bug A S167 + Bug B S170 → known-gaps HIGH 1→0). The diagnostic surface is
unchanged; the watch is that 2 prior tests had LOCKED the mistarget as expected output (corrected per Rule-4).

### Native-parser S170 parity resolutions (E-SCOPE-001 / E-VARIANT-AMBIGUOUS — opt-in `--parser=scrml-native`)
`5a346faa` (fix-wave-1). Under `--parser=scrml-native` these previously FALSE-fired and are now resolved:
- **E-SCOPE-001** on destructured parameter names — native now structures destructured params (GROUP T,
  translate-stmt.js), so the destructure-introduced names resolve.
- **E-VARIANT-AMBIGUOUS → E-CONTRACT-001** — native now threads the var-decl `typeAnnotation` (GROUP T), so
  a bare variant on an annotated decl resolves against the declared type (matching the live path) instead
  of firing E-VARIANT-AMBIGUOUS for lack of type context.
- The GROUP W `exprtext-backfill-walker.ts` backfills `.expr`/`.init`/`.condition` from the structured
  `exprNode`/`initExpr`/`condExpr` siblings so the type-system's regex-over-text lifecycle/enum-subset
  passes (which read the string fields) fire correctly under native. The DEFAULT pipeline is unaffected.
The fix-wave-2 `cc69c62d` BlockStub `verbatim`-body recovery cleared a class of native `E-CODEGEN-INVALID-JS`
(empty `"{}"` arm/lambda bodies that dropped statements → downstream invalid JS). Default output unchanged.

## Error Handling Patterns
- All compile errors returned as CGError[] in result.errors or result.warnings
- Caller checks result.errors.length to determine if compilation succeeded
- No exceptions thrown for source-level errors; exceptions only for internal compiler bugs
- `compileScrml()` in api.js is the single error-surface boundary

## Global Error Boundaries
No client-level JS error boundaries in the compiler itself.
The emitted scrml app gets `errorBoundary` support via `emit-error-boundary.ts` (§19.6).
errorBoundary compile support: `compiler/src/codegen/emit-error-boundary.ts` (320L) — extracts
fallback markup + per-variant renders; paired with host-JS try/catch backstop (§19.6.8 C-hybrid).
The backstop routes caught diagnostics to scrml's logging surface — the adopter-callable backing for
which is the `log()` builtin (§20.6, S174); it is defense-in-depth, NOT a substitute for typed
`!`-coverage (E-ERROR-005 static exhaustiveness still required).

## Tags
#scrmlts #map #error #diagnostics #CGError #compiler #W-MATCH-ARROW-LEGACY #E-PA-002 #E-DG-002 #E-DECL-NEEDS-INITIALIZER #E-CODEGEN-INVALID-JS #E-ENGINE-STATE-CHILD-MISSING #E-SCOPE-001 #E-ENGINE-ACCEPTS-NOT-ENUM #E-ENGINE-MSG #E-MATCH-SUBSET-DEAD-ARM #E-SYNTAX-064 #E-COLON-SHORTHAND-ON-VOID #W-COLON-SHORTHAND-LEGACY-PLACEMENT #E-REFINEMENT-NO-DEFAULT #W-EACH #each-in-dynamic-context #source-map #enum-subset #message-dispatch #bug60 #bug62 #bug63 #bug64 #bug65 #bug70 #bug71 #bug72 #bug73 #r28-1c #per-item-reactivity #shape4-no-rhs #s152 #s153 #s154 #s155 #s156 #s157 #s158 #s159 #s160 #s167 #s168 #s169 #s170 #colon-shorthand-html #colon-shorthand-canonical #value-native-maps #e-map-bracket-write #bug-b-structural-compound-deepset #set-algebra #native-parser-parity #E-VARIANT-AMBIGUOUS #E-CONTRACT-001 #s173 #e-export-001 #w-type-fn-field #s174 #w-log-shadowed #e-type-any-forbidden #log-builtin #no-any-hard-line #log-loc #production-strip #s175 #e-struct-function-field #e-sql-row-contract-mismatch #w-sql-row-untyped #typed-sql-row #width-subtyping #sql-projection #f-schema-001 #function-boundary #passed-vs-stored #s176 #e-type-unknown-name #unrecognized-type-name #w-pure-deprecated #pure-deprecation #e-fn-004 #non-deterministic #scrml-time-now #scrml-random #scrml-math #s177 #bug-4 #bug-74 #e-closer-001 #e-syntax-050 #bare-slash-closer #r28-7b #e-schemafor-no-sql-mapping #s169-map-inline-insert #g-formfor

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [schema.map.md](./schema.map.md)
