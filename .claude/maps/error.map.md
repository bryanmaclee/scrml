# error.map.md
# project: scrmlts
# updated: 2026-06-02T21:33:23-06:00  commit: 57edc794

scrml's own language error model is values-not-exceptions (SPEC §19.1 — no try/catch, no throw).
The compiler itself surfaces structured CGError objects to the caller; it never throws on bad input.

## Error Class

### CGError  [compiler/src/codegen/errors.ts:11]
code: string; message: string; span: CGSpan | object; severity: 'error' | 'warning' | 'info'
- W-/I- prefix OR severity:warning/info → result.warnings (non-fatal, CLI exits 0)
- All other codes → result.errors (fatal, CLI exits 1)
- Cross-stream helper required when asserting on W-*/I-* codes in tests (see diagnostic-stream-partition memory note)

## Error Code Families (379+ distinct codes in compiler source)

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
| E-CODEGEN-INVALID-JS | 1 | Emitted-JS parse-gate invariant (default-ON, S142): emitted JS fails `node --check`. S153 closed two false-fire classes: `<each>` w/ `@.` sigil in a block-form `<match>` arm (3429b385) + `<each>` in a component body (e6870f25) — both previously leaked unscoped `.name` / `@ . id` into emitted JS |
| E-COMPONENT-* | ~15 | Component definition/usage errors |
| E-CONTRACT-* | 4 | Server-fn contract errors: E-CONTRACT-001 (static literal fails predicate), E-CONTRACT-001-RT (runtime boundary), E-CONTRACT-002 (named shape not in registry; also: enum-subset error marker at decl-site, S156), E-CONTRACT-003 (predicate refs external reactive var) |
| E-CPS-* | 6 | CPS async planner errors (idempotency, multibatch reorder/machine-crossing) |
| E-CTRL-* | 6 | Control flow errors |
| E-CTX-* | 2 | Context errors (E-CTX-001: unclosed block; E-CTX-003: shorthand confusion) |
| E-DECL-NEEDS-INITIALIZER | 1 | (S152) — non-array typed-decl with no RHS; only `T[]` typed-array decls may omit RHS (default `[]` per §6.2 Shape 4) [ast-builder.js:4236] |
| E-DERIVED-* | 7 | Derived-value errors (circular-dep, engine-no-initial/rules/write, value-mutate) |
| E-DG-* | 2 | Dependency graph errors — E-DG-002 false-positive fix: credits lambda-body @var reads + `<match on=@cell>` block-form headers [dependency-graph.ts] |
| E-EACH-ITER-SHAPE | 1 | Each iteration shape errors: missing-or-both `of`/`in` attrs [ast-builder.js] |
| E-ENGINE-* | ~20 | Engine declaration errors (incl. E-ENGINE-010: `given` guard in type-level transitions block); +4 NEW S154-S155 codes (see Key New Codes below) |
| E-ENGINE-ACCEPTS-NOT-ENUM | 1 | **(S154-S155 NEW)** `<engine for=T accepts=MsgType>` — `MsgType` is not a declared `:enum` type (or is absent from typeDecls). Fired at SYM PASS 11 in symbol-table.ts [symbol-table.ts:5939] |
| E-ENGINE-MSG-WITHOUT-ACCEPTS | 1 | **(S155 NEW)** A state-child declares a message arm (`\| .V :>`) but the engine opener has no `accepts=` attribute. Fired at PASS 20 [symbol-table.ts:6512] |
| E-ENGINE-MSG-ARM-NOT-EXHAUSTIVE | 1 | **(S155 NEW)** A state-child has message arms but the set does not cover all `accepts=` enum variants and carries no wildcard `\| _ :>` arm. Fired at PASS 20 [symbol-table.ts:6543] |
| E-ENGINE-MSG-UNKNOWN | 1 | **(S155 NEW)** `.advance(.X)` targets a variant in NEITHER the state-transition plane NOR the message-dispatch plane [type-system.ts:8322] |
| E-ENGINE-STATE-CHILD-MISSING | 1 | Engine state-child closer un-findable. S153 (c89c1cb1) closed the `:`-shorthand-child false-fire class [engine-statechild-parser.ts] |
| E-ERRORS-* | 2 | `<errors>` element validation (E-ERRORS-001, E-ERRORS-002) |
| E-EXPR-* | 30 | Native-parser expression grammar codes (§34.1) |
| E-FORMFOR-* | 8 | formFor type validation errors |
| E-HISTORY-* | 1 | Engine history attribute error |
| E-IMPORT-* | 7 | Import resolution errors |
| E-INPUT-* | 5 | Input element errors |
| E-LIFECYCLE-* | ~12 | Lifecycle hook errors |
| E-LIN-* | 2 | Linear-type errors |
| E-MATCH-* | ~7 | Pattern match errors (E-MATCH-ARM-SEPARATOR: stray-comma arm separator §18.2; E-MATCH-SUBSET-DEAD-ARM: see below) |
| E-MATCH-SUBSET-DEAD-ARM | 1 | **(S156 (d)-A NEW)** A match arm names a variant excluded by the matched cell's `oneOf`/`notIn` enum-subset refinement — the arm can never be reached. Fired by both type-system.ts (full type-resolution, both match loci) and symbol-table.ts PASS 20 (string-based block-form pass, constructor-form + member-access, batch 4) [type-system.ts:9602; symbol-table.ts:10883] |
| E-META-* | 7 | Meta check/eval errors |
| E-MW-* | ~6 | Middleware errors |
| E-NAME-* | 1 | Name collision with reserved identifier |
| E-PA-* | ~7 | protect-analyzer errors — E-PA-002 false-positive fix: `extractCreateTableStatements` now generic cycle-safe deep-walk [protect-analyzer.ts] |
| E-PARSEVARIANT-* | ~3 | parseVariant API errors |
| E-REPLAY-* | 3 | Engine replay errors |
| E-RESET-* | 1 | Reset target errors |
| E-RI-* | ~3 | Route inference errors |
| E-SCOPE-001 | 1 | Identifier out of scope. S153 (e6870f25) closed the `<each>`-in-component-body false-fire class |
| E-SQL-* | ~8 | SQL context errors |
| E-STMT-* | 43 | Native-parser statement grammar codes (§34.1) |
| E-SWITCH-FORBIDDEN | 1 | `switch` keyword in scrml source |
| E-SYNTAX-* | ~10 | Syntax errors (E-SYNTAX-042..044: null/undefined in source) |
| E-TEST-* | 6 | Test block errors (E-TEST-001..006) |
| E-TIMEOUT-* | 2 | Engine timeout errors |
| E-TYPE-* | ~20 | Type system errors (E-TYPE-001 dormancy fix for object-literal lifecycle, S151 C4) |
| E-USE-* | ~5 | `use` declaration errors |
| E-VALIDATOR-* | ~5 | Validator circular-dep / inline-dynamic |
| E-WRITE-NOT-IN-LOGIC-CONTEXT | 1 | Write attempt outside logic context |
| W-ASSIGN-* | 1 | Assignment warnings |
| W-ATTR-* | 2 | Attribute warnings |
| W-AUTH-* | 5 | Auth warnings: W-AUTH-001, W-AUTH-LOGIN-MISSING, W-AUTH-PAGE-INFERRED, W-AUTH-RUNTIME-FALLBACK |
| W-AUTH-CONTENT-NOT-GATED | 1 | `<auth role="X">` gates JS-mount only, NOT served HTML content [auth-graph.ts:627] |
| W-BATCH-* | 1 | SQL batch warnings |
| W-CG-* | ~10 | Code generator warnings (W-CG-001: top-level suppression; chunk warnings) |
| W-DEPRECATED-* | 2 | Deprecation warnings |
| W-EACH-KEY-001 | 1 | Info-level lint: `<each in=@cell>` has no inferable per-item `.id` key [lint-w-each-key.js] |
| W-EACH-PROMOTABLE | 1 | Info-level lint: `${ for (let x of @cell) { lift ... } }` is promotable to `<each>` form [lint-w-each-promotable.js] |
| W-ENGINE-* | 2 | Engine warnings |
| W-EQ-* | 1 | Equality warnings |
| W-LIFECYCLE-* | 5 | Lifecycle warnings |
| W-LINT-001..024 | 24 | Ghost-pattern lint warnings [lint-ghost-patterns.js] |
| W-MATCH-* | 6 | Match warnings — W-MATCH-ARROW-LEGACY (S147): info-level, arm-context-scoped; W-MATCH-RULE-INERT; W-MATCH-VALUE-UNUSED |
| W-PROGRAM-* | 4 | Program-level warnings |
| W-PURE-REDUNDANT | 1 | Redundant `pure` modifier |
| W-STDLIB-* | 2 | stdlib shim/compiler-deferred warnings |
| W-TAILWIND-* | 2 | Tailwind class warnings |
| W-TRY-CATCH-IN-SCRML-SOURCE | 1 | try/catch used in scrml source |
| I-ASYNC-USER-SOURCE | 1 | Info: async pattern in user source |
| I-AUTH-REDIRECT-UNRESOLVED | 1 | Info: auth redirect target unresolved |
| I-FN-PROMOTABLE | 1 | Info: function eligible for promotion |
| I-MATCH-PROMOTABLE | 1 | Info: match eligible for engine promotion (§56) |
| I-PARSER-NATIVE-SHADOW | 1 | Info: native parser shadows live-pipeline result |

## Key New / Changed Codes Since Watermark c665714c (S154-S156)

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
**Bug 65 (next arc):** the identical gap exists at `emit-lift.js` (~line 529) — that file has no
engine-ctx threading; emit-each.ts is the exact template to mirror.

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

## Tags
#scrmlts #map #error #diagnostics #CGError #compiler #W-MATCH-ARROW-LEGACY #E-PA-002 #E-DG-002 #E-DECL-NEEDS-INITIALIZER #E-CODEGEN-INVALID-JS #E-ENGINE-STATE-CHILD-MISSING #E-SCOPE-001 #E-ENGINE-ACCEPTS-NOT-ENUM #E-ENGINE-MSG #E-MATCH-SUBSET-DEAD-ARM #W-EACH #each-in-dynamic-context #source-map #enum-subset #message-dispatch #bug62 #s152 #s153 #s154 #s155 #s156

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [schema.map.md](./schema.map.md)
