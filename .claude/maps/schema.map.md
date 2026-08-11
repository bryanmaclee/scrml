# schema.map.md
# project: scrml
# updated: 2026-08-11T14:53:28-06:00  commit: 4f034e13
# generated-at: 4f034e13 (informational — not the currency anchor)
# ⚑ **WATERMARK CORRECTED THIS PASS.** Line 3 now carries `4f034e13`, an ancestor of `origin/main`,
# per the MAP-STAMP RULE at the top of primary.map.md. The stamp is the CURRENCY ANCHOR
# `scripts/state.ts` parses; **"content as of X" below carries the provenance.** The prior convention
# — freeze line 3 at the last walk's SHA to signal "not re-walked" — broke the instrument while
# communicating nothing this header does not already say.
#
# ⚑ **CONTENT AS OF `fe14c9b2` — CURRENCY RE-VERIFIED AT `4f034e13`, NOT RE-WALKED. NINE windows.**
# `git diff --name-only 8863d457..4f034e13 -- compiler/src/types` is **EMPTY**.
#
# ⚠ **AND THE OLD STAMP WAS ITSELF OFF-MAIN — THIS MAP IS THE WORST INSTANCE IN THE SET.** `fe14c9b2`
# is the tip of `wrap/s302`; `git merge-base --is-ancestor fe14c9b2 origin/main` returns FALSE. It sat
# on line 3 for roughly TEN sessions. The S331 pass looked straight at it and concluded *"the stamp
# stays honestly older"* — **right about AGE, and it never asked about ANCESTRY.** An honest older
# stamp is still worthless if it bounds nothing: every "zero diff since `fe14c9b2`" command written
# into this header was, strictly, unbounded. (The CONCLUSION survives — re-checked this pass from
# `8863d457`, which IS on main — but it survived by luck, not by the check.)
#
# This window's 28 changed source files added **no declared type**. Specifically: §6.6.19's structural
# walk is module-local functions returning `Array<Record<string, unknown>>` plus a `boolean` key
# predicate (`route-inference.ts:3677`/`:3730`); the §52.8 SSR lint changed `buildOneRenderer`'s return
# from `SsrEachRenderer | null` to `SsrEachRenderer | { fallback: string }` — **an INLINE union at the
# function signature, not a named exported shape** (`emit-ssr-render.ts`); the §6.7 lifecycle work added
# `DEFERRED_LIFECYCLE_BODY_TAGS: ReadonlySet<string>` (a module const in `collect.ts`) and a fifth
# `immediate` PARAMETER on `_scrml_timer_start` (`runtime-template.js`, untyped JS). None is a `FileAST`
# or `ast.ts` type. See domain.map.md / dependencies.map.md, not this file.
#
# Superseded header notes (S326/S328 stamp-correction prose for `97576f35`) are DELETED, not carried:
# the rule they were groping toward is now stated once, normatively, at the top of primary.map.md.

The compiler's "schema" is its own AST, not an application data model. Root catalog:
`compiler/src/types/ast.ts` (2104 lines, 114 exported interfaces/types, ~91 distinct `kind` discriminants — unchanged since fbb4d9fd/df2ac831; this window's schema-differ.js changes below added NO ast.ts shape, same as the S287 DB-authoritative tier before it). Read that file directly for the exhaustive list; this map groups it and calls out the load-bearing shapes.

**Currency:** `types/ast.ts` has gained NO new shape for four windows — every landing works through
existing node kinds, or through codegen-internal / schema-differ-internal shapes that are NOT
`ast.ts` types (the §38.6.2 constraint-drift record, the D-5 module-const candidate filter's reliance
on `ConstDeclNode`/`LetDeclNode.initExpr`, `LogicBinding.directiveIsFormValue`, and the S302
`ifRaw`/`ifCond` pair below), and now the #458 region shapes immediately below.

## Codegen-internal region shapes — NOT `ast.ts` types (NEW #458, at `97576f35`)

`compiler/src/codegen/code-segments.ts` exports two shapes that describe a region of EMITTED JS TEXT,
not a source AST node. They are here so a `grep interface` in `compiler/src/` does not come back
puzzled, and flagged as non-AST so nobody threads them through the node pipeline.

- **`BraceGroupKind = "object-literal" | "binding-pattern" | "unknown"`** (:91) — the verdict of
  `classifyBraceGroup(code, open, closeExclusive)`. **`"unknown"` is a first-class value with a
  contract, not a null case: the caller SHALL leave its existing behaviour unchanged for that region.**
- **`interface ObjectShorthandRegion`** (:93) — `{ start: number; end: number; kind: BraceGroupKind;
  names: string[] }`. `start` indexes the opening `{` **within the code segment** (NOT the whole
  buffer — offsets are segment-relative, which matters because the producer runs inside
  `rewriteCodeSegments`); `end` is one past the closing `}`; `names` are the bare identifiers between
  the braces in source order. Returned regions are non-overlapping and in source order.

Sole producer: `findObjectShorthandRegions(code)` (:213). Sole consumer: `emit-client.ts`'s
`rewriteCodeSegment` (:3038). See domain.map.md / dependencies.map.md for why only the
`object-literal` kind is acted on.

## §17.1.2 — `ifRaw` / `ifCond` on the three structural node kinds (S302)

**`engine-decl` / `match-block` / `each-block` carry NO `attrs` array.** They are not
`kind:"markup"`; `ast-builder.js` reconstructs each opener by regexing NAMED attributes out of the
header text, and an attribute nobody regexes for has nowhere to live. `if=` is therefore stored as a
PAIR of bare node fields, not as an attribute:

- **`ifRaw: string`** — the VERBATIM condition source (a raw slice, same shape as `inExprRaw` /
  `keyExprRaw` / `onExprRaw` / `armsRaw`).
- **`ifCond: AttrValue`** — the §5.2-PARSED attribute value: `{kind:"variable-ref"|"call-ref"|"expr",
  …}` plus `span`, `refs`, and (after `attrvalue-exprnode-walker.ts`) `exprNode`. **Byte-for-byte the
  object `<div if=…>` produces**, because `captureStructuralIfAttr` re-parses a synthetic opener
  through the same `tokenizeAttributes`+`parseAttributes` pipeline rather than classifying the value
  itself. That identity is what lets all four `if=` hosts share one lowering.

**ABSENT, not null, when the opener has no `if=`.** Both keys are omitted entirely — deliberately
NOT the null-when-absent convention the sibling opener fields use. The within-node parser-parity
canary compares FIELD SETS, and null-stamping every engine/match/each in the corpus registers as a
divergence at the ~2 nested-engine positions where live emits `text`/`comment` and native emits an
`engine-decl`, growing the allowlist for a field neither side disagrees about. Precedent on this same
node family: `engine-decl.bodyChildren`. Every consumer tests truthiness, so absent and null are
indistinguishable to them — the distinction exists only for the canary.

**The precise diagnostic anchor is `ifCond.span`; no separate attribute-NAME span is stamped.**

**Typing note worth knowing:** `engine-decl` is the only one of the three with an interface in
`types/ast.ts` (`EngineDeclNode` [910]). **`each-block` and `match-block` have NO `ast.ts` interface
at all** — they are ad-hoc object literals built in `ast-builder.js` (`:16230` and `:15276`/`:17447`).
A pass expecting a typed node for them finds nothing, and a field added to either is invisible to
`tsc`. Same class as `<outlet>` and the DB-authoritative shapes below.

## Root pipeline types
### FileAST  [types/ast.ts:1551]
filePath: string
nodes: ASTNode[]
imports: ImportDeclNode[]
exports: ExportDeclNode[]
components: ComponentDefNode[]
typeDecls: TypeDeclNode[]
channelDecls?: ChannelDeclNode[]
hasProgramRoot: boolean
authConfig: AuthConfig | null
middlewareConfig: MiddlewareConfig | null

### TABOutput  [types/ast.ts:1582]
Output shape of the TAB (Typed AST Builder) pipeline stage; wraps FileAST + TABErrorInfo[].

### ASTNode  [types/ast.ts:1471]  /  ASTNodeKind = ASTNode["kind"]  [1489]
Discriminated union over ~91 `kind` string literals — the single node-shape switch every codegen/emit-*.ts and type-system.ts pass dispatches on.

## Node-shape groups (by ast.ts region)

**Markup / structural** — MarkupNode [214], TextNode [249], CommentNode [256], HtmlFragmentNode [1169], ChannelDeclNode extends MarkupNode [1326] (tag:"channel"; isExport?; P3.A CHX-inline provenance fields).

**Declarations** — LetDeclNode [447], ConstDeclNode [462] (**both carry `initExpr?: ExprNode`, the STRUCTURED initializer — D-5 (S293) depends on it: `emit-server.ts`'s `emitReferencedModuleConstLines` SKIPS any candidate with no `initExpr`, and walks the ones that have it via `forEachIdentInExprNode` to prove every free identifier resolves at server module scope. A `const X = compute()` whose `compute` is not in the server bundle is skipped rather than emitted — a module-load ReferenceError is strictly worse than the call-time one, and the honest answer for that shape is a diagnostic, not a guess**), TildeDeclNode [480] (`~` linear-adjacent decl), LinDeclNode [492] (§35 linear types), ReactiveDeclNode [503] (the `@cell` declaration — carries `matchExpr` side-field for engine-adjacent typing), ImportDeclNode [1247] / ImportSpecifier [1235], UseDeclNode [1265] (`use foreign:` sidecar), ExportDeclNode [1279], TypeDeclNode [1298].

**State machine** — EngineDeclNode [910] (`kind:"engine-decl"`; **plus the optional `ifRaw`/`ifCond` §17.1.2 render gate, present only when the opener carried `if=` — see above**; engineName, governedType `for=`, rulesRaw + bodyChildren walkable body, sourceVar, varName/varNameOverride, initialVariant, plus acceptsType/subsetVariants/inlineMatchArmArrows annotations added across S154-S172).

**Control flow (statement)** — IfStmtNode [995], ForStmtNode [1044], WhileStmtNode [1062], ReturnStmtNode [1071] (carries `fnExprNode` — see the GITI-038 callout below), ThrowStmtNode [1085], SwitchStmtNode [1092], TryStmtNode [1101], MatchStmtNode [1120], MatchArmInlineNode [1138], BareExprNode [1156].

**Control flow (expression)** — IfExprNode [1006], ForExprNode [1017], MatchExprNode (statement-form) [1028] and the expression-layer MatchExpr [1904], TernaryExpr [1781], GuardedExprNode [1222] (`given`).

**Error/failure primitives** — FailExprNode [1196], PropagateExprNode [1210] (`?` propagation), ErrorArm [165], ErrorEffectNode [350].

**Reactive mutation** — ReactiveNestedAssignNode [757], ReactiveAssignNode [789], ReactiveArrayMutationNode [803], ReactiveExplicitSetNode [814].

**Functions / components** — FunctionDeclNode [823], ComponentDefNode [888], LambdaExpr [1858] / LambdaParam [1869].

**SQL / CSS / state bodies** — SQLNode [311], SQLChainedCall [182], SqlRefExpr [1977], CSSInlineNode [330], StyleNode [339], CSSDeclaration [133], CSSRule = CSSPropertyRule | CSSSelectorRule [144/146/154], CSSReactiveRef [125], StateNode [265], StateConstructorDefNode [279], LogicNode [294].

**Destructuring** — DestructureArrayPattern [426], DestructureObjectPattern [434], DestructureArrayElement [402], DestructureObjectProperty [408].

**Validators / lift / meta** — ValidatorEntry [679], RelationalPredicateNode [646], RenderSpecNode [730], LiftExprNode [1186], LiftTarget [195], MetaNode [359].

**Misc runtime-adjacent** — TransactionBlockNode [1352], CleanupRegistrationNode [1361], WhenEffectNode [1373], WhenMessageNode [1387], UploadCallNode [1398], AuthConfig [1503] (see the "duplicate AuthConfig shapes" note in auth.map.md), MiddlewareConfig [1515].

**Expression-layer types (ExprNode union, [types/ast.ts:2082])** — IdentExpr [1638], LitExpr [1660], ArrayExpr [1683], ObjectExpr [1690] / ObjectProp [1696], SpreadExpr [1702], UnaryExpr [1719], BinaryExpr [1747], AssignExpr [1769], TernaryExpr [1781], MemberExpr [1799], IndexExpr [1810], CallExpr [1820], NewExpr [1830], LambdaExpr [1858], CastExpr [1886], MatchExpr [1904], MapEntry [1929] / MapLitExpr [1956] (§59 value-native map/set), SqlRefExpr [1977], InputStateRefExpr [1991] (§36 `<#id>` reads), EscapeHatchExpr [2005] (`_{}` foreign block), ResetExpr [2046], MarkupValueExpr [2070].

## GITI-038 — `ReturnStmtNode.fnExprNode` (a returned function expression)
`return function name(){…}` / `return async function name(){…}` is parsed STRUCTURALLY, not stripped-and-hoisted. `ReturnStmtNode` [types/ast.ts:1071] carries an optional `fnExprNode?: FunctionDeclNode` field [types/ast.ts:1081] holding the returned closure as a full `function-decl` node — the SAME shape a top-level `FunctionDeclNode` uses. `RETURN_DECL_KW` (ast-builder.js) covers only `const`/`let`/`type`/`fn` — `function`/`async function` route through a recursive `parseOneStatement()` call.

**Contract: every AST pass that walks a `return-stmt` MUST also descend into `fnExprNode`** if it exists, treating it exactly like a nested `function-decl` statement — a `return-stmt`'s own `exprNode`/`expr` fields are EMPTY when `fnExprNode` is set. ~10 analysis passes route through it (route-inference.ts, type-system.ts, codegen/usage-analyzer.ts, component-expander.ts, meta-eval.ts, codegen/collect.ts, codegen/emit-logic.ts) — see dependencies.map.md for the Q1/Q2 async-classification split this feeds. **route-inference.ts's dead-function reachability walk is a sibling concern, not this contract** — S288 (#195/#200) clarified that a first-class function reference (not a call) also counts as reachable, and that reachability descends into nested closure bodies; see error.map.md's `W-DEAD-FUNCTION` note.

## GITI-039 — no new AST shape, a parse-time rejoin fix
No `ReturnStmtNode`/`ExprNode` shape changed. `ast-builder.js`'s `collectExpr`/`joinWithNewlines` (the token-collector for `${}` logic bodies) carries a `partSpans` parallel array so two adjacent markup-region parts whose spans are byte-adjacent rejoin with NO separator, preserving literal markup TEXT verbatim.

## §14.8.11 DB-authoritative tier — codegen-internal shapes, NOT a FileAST or ast.ts type

`schema-differ.js`'s `parseSchemaBlock(schemaBody)` return shape is the desired-state input BOTH
`diffSchema` (the SQLite/Postgres migration differ) and `commands/db-migrate.js` (via
`codegen/db-authoritative.ts`'s `extractDesiredSchema`) consume. It is a plain-object shape local to
this pipeline stage — like `ThemeContext`/`ProtectContext` below, it has no `ast.ts` entry and no
`kind` discriminant.

```
{ tables: TableDecl[], fns: SecdefFnDecl[] }   // fns is ADDITIVE — [] for a schema with no `fn`
```

### TableDecl  [schema-differ.js, `parseSchemaBlock`/`parseColumns`]
name: string
columns: ColumnDecl[]
dbAuthoritative?: boolean          // the §14.8.11 opt-in marker — bareword `db-authoritative` immediately after the table's closing `}`

### ColumnDecl  [schema-differ.js, `parseColumns`]
name: string
type: string                        // mapped SQLite affinity type
scrmlType: string                   // lowercased source token, preserved for cell-type-aware lowering
primaryKey / notNull / unique: boolean
immutable: boolean                  // §14.8.11.2 S3. A bareword mirroring `not null`/`unique`; the AUTHOR-WRITTEN half of immutability. Consumed ONLY by `generateDbAuthoritativeDDL`. Inert on a non-`db-authoritative` table (no bounded-role grant to narrow). **S288: no longer the WHOLE story — a `db-authoritative` table's PRIMARY KEY column(s) and `tenant_id` are ALSO effectively immutable whether or not this bareword is written, and there is deliberately no per-column opt-out. See `isEffectivelyImmutable` below.**
default: string | null              // §14.8.11.2 S288 — the RAW captured value, now via a BALANCED paren scan (see "Literal-lowering functions" below); lowered at emit time by `lowerDefaultToSql`, not stored pre-lowered
references: {table, column} | null
renameFrom: string | null
sharedCorePredicates: SharedCorePredicate[]   // §39.5.7 — req/length/pattern/min/max/gt/lt/gte/lte/eq/neq/oneOf/notIn. §39.5.8 S288: `oneOf`/`notIn` items are now lowered to SQL literals at emit time (see below), and a non-literal item is a COMPILE ERROR (`E-SCHEMA-010`), not a silent pass-through.

### SecdefFnDecl  [schema-differ.js, `parseFnDecl`]  — §14.8.11.2 S4
The parsed shape of a co-located `<schema>` `fn NAME(args) security definer owner(<role>) [returns
<type>] [requires cap("x")] { """ <plpgsql statements> """ }` declaration (M1-PROVISIONAL surface;
a later owner-ruled syntax pass finalizes it). Every identifier below is captured with a STRICT
`[A-Za-z_]\w*` pattern (parse-time defense complementing emit-time `quoteIdent`).
name: string
args: Array<{name: string, type: string}>
owner: string                       // MANDATORY — the bounded NOLOGIN role the SECDEF runs AS (distinct from `scrml_app`)
returns: string                     // defaults to "void"
cap: string | null                  // the `requires cap("x")` gate value, or null (no gate)
isSecurityDefiner: boolean          // advisory this pass — every P2 `fn` emits SECURITY DEFINER regardless
body: string                        // the raw plpgsql STATEMENTS only (no outer BEGIN/END — the emitter owns that envelope so the injected cap check is un-bypassable and always first)

## §14.8.11.2 S288 — auto-immutable PK/`tenant_id` + the literal-lowering functions (schema-differ.js)

**`isEffectivelyImmutable(col)`** — is a `db-authoritative` table's column immutable to the bounded
`scrml_app` role? True if the author WROTE `immutable`, **or** it is the table's PRIMARY KEY, **or**
its name is `tenant_id` (case-insensitive) — whether or not the bareword is present. **RULED S288
(bryan):** the same §14.8.10 reasoning that rejected a per-table tenant opt-in applies here — a
forgettable declaration guarding a security invariant is the wrong shape. Before this, a
WITHIN-tenant PRIMARY KEY UPDATE succeeded (only a CROSS-tenant re-point was RLS-blocked) — silently
re-pointing a row's identity under its own tenant is exactly the class the tier's audit-defensibility
claim rests on. **Consequence, stated normatively in SPEC §14.8.11.2: the prior guarantee "a
`db-authoritative` table with ZERO `immutable` columns emits BYTE-IDENTICAL to M1" is RETIRED** — such
a table always carries a PK, so it always takes the column-scoped GRANT path now. No per-column
opt-out; an author needing a mutable PK declines the `db-authoritative` marker for that table.
Consumed ONLY by `generateDbAuthoritativeDDL`'s `immutableCols`/`mutableCols` filters —
non-`db-authoritative` tables are entirely unaffected.

**Literal-lowering functions (§39.5.8 + `default()`), deliberately OPPOSITE dispositions for the
same residue:**
- `lowerArrayLiteralToSqlItems(arg)` / `lowerArrayItemToSqlLiteral(item)` / `splitTopLevelItems(inner)`
  — lower a `oneOf([…])`/`notIn([…])` item list from scrml literal form (either string-quote form,
  bare-variant `.Admin` per §41.15.6, numeric, boolean) to its SQL literal form (`'…'`-quoted
  strings, `.Admin` → `'Admin'`). ALL-OR-NOTHING: any unrecognized item (a bareword) returns the
  WHOLE list verbatim — belt-and-braces, since a compile-time caller now rejects a bareword before
  reaching here (see `findNonLiteralSetItems` next / `E-SCHEMA-010` in error.map.md).
- `lowerDefaultToSql(rawDefault)` — lowers `default(…)`'s value. A scrml STRING literal (either
  quote form) lowers to a SQL string literal — fixes `default("US")` emitting the SQL IDENTIFIER
  `DEFAULT ("US")`. A NON-literal (`default(now())`, `default(CURRENT_TIMESTAMP)`,
  `default(gen_random_uuid())`) passes through VERBATIM — here that is CORRECT, not a fallback,
  because a `default()` argument is legitimately a SQL EXPRESSION. This is the deliberate divergence
  from the `oneOf`/`notIn` position, where a non-literal is meaningless and now hard-errors.
- **`export function findNonLiteralSetItems(col)`** — the `E-SCHEMA-010` fire-site helper (see
  error.map.md), consumed from `gauntlet-phase1-checks.js`'s `checkSchemaDeclarations`.
- `findMatchingParen`/`scanMatchingParen` — now a TWO-PASS wrapper: quote-aware first (a `)` inside a
  string ARGUMENT no longer closes the predicate early — the pre-S288 silent-CHECK-drop defect,
  `oneOf(["x); DROP TABLE u; --"])` used to emit a column with NO CHECK AT ALL), falling back to a
  quote-BLIND scan when the quote-aware pass fails to close (load-bearing: a `pattern(/o'brien/)`
  regex literal can carry an unpaired apostrophe, which a quote-aware-ONLY pass would swallow).
  `parseColumns`'s `default(...)` capture is now this SAME balanced scan, not the old `[^)]+` regex
  (which stopped at the FIRST `)`, truncating `default(now())` into an unbalanced
  `DEFAULT (now() )` — a syntax error blocking 7/10 of a real adopter schema (adopter report, S4)).

**Residual, still-open edges surfaced by the S288 adversarial pass** (`g-schema-predicate-arg-
parse-edges`, MED, `docs/known-gaps.md`): `oneOf([])` on an empty array emits invalid SQL
(`CHECK (col IN ())`) rather than a compile rejection or `CHECK (false)`; `escapeSqlString` doubles
`'` but does not escape `\` — a latent MySQL-only trap (unreachable today — `db-migrate` hard-refuses
MySQL, "Phase 3").

## §38.6.2 / §39.5.5 — constraint-drift + foreign-key shapes (NEW this window, S290)

**`columnConstraintDrift(desiredCol, actualCol)`** — exported from `schema-differ.js` (:713).
Returns `{ notNull: boolean, unique: boolean, references: boolean, default: boolean }`: which of a
column's declared constraints differ from what the LIVE database reports for an EXISTING column.
§38.6.2's governing sentences always required this; the implementation only handled ADD / DROP /
RENAME COLUMN, so three of eight specified operations were never built and **every constraint change
on an existing column was silently ignored** (`g-db-migrate-ignores-constraint-drift-on-existing-
columns`). This is a conformance RESTORATION, not an amendment.

Two shape details are load-bearing:
- **PK-aware.** A PRIMARY KEY column is implicitly NOT NULL and implicitly UNIQUE, so both flags are
  forced false when either side is a PK — do not fight the driver over an implied constraint.
- **`default` is compared TOLERANTLY** via the private `sameDefaultText(a, b)` (:731): it drops a
  Postgres `::type` cast suffix, unwraps ONE quote layer (`'x'` or `"x"`), trims and case-folds.
  Drivers echo defaults back with their own quoting/casts, so a raw string compare would report
  permanent phantom drift — and a gate that cries wolf gets bypassed, then deleted.

Consumers: `diffSchema` emits `W-SCHEMA-CONSTRAINT-TIGHTENED` (Postgres — the DDL IS emitted, and
will correctly fail on non-conforming rows) or `W-SCHEMA-CONSTRAINT-DRIFT-UNAPPLIED` (SQLite — the
§38.6.3 rebuild is destructive and refused by default, so NOTHING is applied and the plan is
reported as WITHHELD). See error.map.md + migrations.map.md.

**`referencesHint(raw)`** — exported from `schema-differ.js` (:1756). Builds the "you wrote X, the
only form is Y" half of the `E-SCHEMA-011` message from the author's raw text.

**`ColumnDecl.references` is now two-valued at parse time.** `parseColumns` records a `references`
clause that does NOT match the single §39.5.5 production (`references <table>(<column>)`, table name
OUTSIDE the parens) into a `malformedReferences` collection rather than dropping it. Every other
shape — `references(owners.id)`, `references owners (id)`, `references owners.id` — used to compile
and migrate clean with NO `REFERENCES` clause and NO diagnostic. `gauntlet-phase1-checks.js` turns
that collection into `E-SCHEMA-011`. Supporting helper: `blankLiteralBodies(s)` (:232) blanks string
literals and strips `//` comments first, so `default('see references')` or a comment mentioning the
word cannot false-fire the detector.


### ActualTable / ActualColumn  [schema-differ.js, `readActualSchema`/`readActualSchemaPg`]
The LIVE-database-read counterpart `diffSchema` compares `TableDecl`/`ColumnDecl` against. Same
shape family, `sharedCorePredicates` always `[]` (not recoverable from `PRAGMA table_info()` /
`information_schema.columns` in v1 — CHECK-constraint text isn't exposed).

**`g-db-migrate-check-constraint-oneof-pattern` — RESOLVED S288** (`docs/known-gaps.md`). The
originally-reported three sub-bugs, verdicted against real Postgres 16 through the real CLI: (1) the
unquoted-bareword CHECK — FIXED (the literal-lowering functions above); (2) the false
`E-DBAUTH-NO-TENANT-COLUMN` pre-flight fire on a `tenant_id`-carrying table — tried 9 shapes, NOT
REPRODUCED (open a fresh gap with the exact table if it recurs — the main compiler's own parse was
always fine, only the differ's line-based scan was suspect); (3) a `pattern(/…{n}…/)` quantifier
brace fooling the marker/brace matcher — was ALREADY fixed by the P2 brace-depth `parseSchemaBlock`
rewrite, now regression-locked. If you touch `parseColumns`/`parseSharedCorePredicates`, the
regression tests in `compiler/tests/unit/schema-differ.test.js` (this window's +124 lines) are the
reproducer set to run first.

## §65 CSS-native model — NOT a dedicated FileAST shape
`<theme>` / `<defaults>` are recognized as ordinary MarkupNode instances via the structural-element registry (`compiler/src/attribute-registry.js:485` onchange, `:503` theme, `:516` defaults) — same pattern as `<endpoint>` (§61) and `<onchange>` (§38.13). No `ThemeDeclNode`/`EndpointDeclNode`/`OnchangeNode` type exists in ast.ts. Codegen-internal (non-FileAST) types for these features:
- `ThemeContext` — exported from `codegen/emit-theme-reset.ts:56`: `{ themeDecls: ThemeDecl[]; programNode; cellNames: Set<string> }`.
- `CSSVariableBridge` — `codegen/collect.ts`: the §25 reactive-CSS-var bridge descriptor.
- `ProtectContext`/`ProtectedColumns` (protect-egress.ts, §14.8.9), css-conflict-check.ts's internal `CssConflictFinding`, `RowChange` synthesis (channel-watches.ts, §38.13), `EndpointArmBinding`/`IfDisplayGuard` (codegen-internal, §61).
- `<program reset="none">`. `attribute-registry.js`'s `"program"` element carries a `reset` attrSpec — the §65.3.4 built-in-reset opt-out.

## `<outlet>` (§20.8) — also NOT a dedicated FileAST shape
Same structural-element-registry pattern as `<theme>`/`<defaults>`/`<onchange>` — no `OutletNode` type in ast.ts. Recognized/validated by symbol-table.ts PASS 15.5.

## Codegen-internal binding shapes (binding-registry.ts) — NOT ast.ts types

`LogicBinding` (`codegen/binding-registry.ts`, a pure data registry with no imports) is the
emit-time record every event/logic binding is registered as. Fields that decide EMISSION SHAPE, not
just wiring:

- `isReactiveValueAttr` / `valueAttrName` / `valueAttrIsFormValue` / `valueAttrKey` — the #81
  writer-ownership set, computed by `emit-html.ts`'s `analyzeWriterConflict`.
- **`directiveIsFormValue?: boolean` (NEW this window, i225)** — set ONLY when an `attr-template`
  binding is a `value="${…}"` on a form control (`<input>`/`<textarea>`/`<select>`) with NO sibling
  `bind:value`/`bind:valueAsNumber`. When set, `emit-variant-guard.ts` writes the caret-safe `.value`
  PROPERTY (`{ const _v = expr; if (el.value !== _v) el.value = _v; }`) instead of
  `setAttribute("value", …)`. **It must be computed at REGISTRATION in `emit-html.ts`**, where the
  element `tag` and the sibling `attrs` array are in scope — the arm wire fn only ever sees the
  pre-lowered binding, never the markup node. This mirrors the file-scope `isFormControlValue`
  decision in `emit-bindings.ts` (i174); the `!hasBindValue` half is deliberate, because a sibling
  `bind:value` is the sanctioned two-way owner and a second `.value` writer would compete with it.

`EachReconcileCtx` (`codegen/emit-each.ts`, module-level `_eachReconcileCtxStack`) — the LIVE stack
of enclosing `<each>`/for-lift contexts at emit time, carrying `{iterVar, destructure?, …}`. S293/S294
read it to build the per-item re-resolution preludes; the stack (not the AST) is what makes shadowing
decidable, since a name bound by a NEARER ctx must suppress re-resolving a same-named enclosing var.

## §20.5 session-establishment — new attributes/config fields, NOT a new FileAST node type
No `SessionDeclNode` exists — `session` is a reserved server-scope BUILTIN identifier. See auth.map.md for the three separate non-FileAST "auth config" shapes. **S288: `tenant-egress.ts`'s `buildTenantContext` now takes a second, optional arg (the `<schema>`-declared tables, from `extractDesiredSchema(fileAST).tables`) and unions them into `TenantContext.tenantScopedTables`** — previously it read ONLY the `<db>`-derived `ProtectContext.schemaByTable` registry, which left a `<schema>`-only app (no `<db>` block) with an EMPTY tenant set even though §14.8.10 says a `<schema>` table's `tenant_id` column presence IS the tenant declaration. See domain.map.md's §14.8.11 section for the full defect narrative (`g-dbauth-session-principal-not-wired`, RESOLVED S288).

## Type-system ResolvedType layer (type-system.ts, not ast.ts)
FunctionType [type-system.ts:423], MapType [:318] (with `.set?: boolean` for §59.12 value-native Set), PredicatedType [:468] (with `subsetVariants`), the `<fn-return>` over-approximation sentinel (`FN_RETURN_TYPE_NAME`, :754). NO `AnyType`/`null` member exists — `any` and `null` are not scrml types (§14.1.1 / null-does-not-exist axiom).

## Tags
#scrml #map #schema #ast #types #engine-decl #reactive-decl #css65 #theme #expr-node #file-ast #outlet #reset #link-boost #theme-context #css-var-bridge #giti-038 #giti-039 #return-stmt #fn-expr-node #session-establishment #colorless-async #dbauth #table-decl #column-decl #secdef-fn-decl #schema-differ #immutable-column #auto-immutable #is-effectively-immutable #e-schema-010 #lowering-functions #sql-literal-lowering #tenant-context-union #resolved-gaps #e-schema-011 #column-constraint-drift #references-hint #same-default-text #d5 #init-expr #logic-binding #directive-is-form-value #i225 #each-reconcile-ctx #if-cond #if-raw #structural-if #§17.1.2 #absent-not-null #parity-canary #field-set-comparison #untyped-structural-nodes #each-block #match-block #attr-value-identity #object-shorthand-region #brace-group-kind #codegen-internal-shape #not-an-ast-node #segment-relative-offsets #unknown-is-a-contract

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [error.map.md](./error.map.md)
- [domain.map.md](./domain.map.md)
- [auth.map.md](./auth.map.md)
- [dependencies.map.md](./dependencies.map.md)
- [migrations.map.md](./migrations.map.md)
