# schema.map.md
# project: scrml
# updated: 2026-07-26T07:00:00Z  commit: f8a138e9

The compiler's "schema" is its own AST, not an application data model. Root catalog:
`compiler/src/types/ast.ts` (2104 lines, 114 exported interfaces/types, ~91 distinct `kind` discriminants — unchanged since fbb4d9fd/df2ac831; the S287 DB-authoritative tier below added NO ast.ts shape). Read that file directly for the exhaustive list; this map groups it and calls out the load-bearing shapes.

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

**Declarations** — LetDeclNode [447], ConstDeclNode [462], TildeDeclNode [480] (`~` linear-adjacent decl), LinDeclNode [492] (§35 linear types), ReactiveDeclNode [503] (the `@cell` declaration — carries `matchExpr` side-field for engine-adjacent typing), ImportDeclNode [1247] / ImportSpecifier [1235], UseDeclNode [1265] (`use foreign:` sidecar), ExportDeclNode [1279], TypeDeclNode [1298].

**State machine** — EngineDeclNode [910] (`kind:"engine-decl"`; engineName, governedType `for=`, rulesRaw + bodyChildren walkable body, sourceVar, varName/varNameOverride, initialVariant, plus acceptsType/subsetVariants/inlineMatchArmArrows annotations added across S154-S172).

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

**Contract: every AST pass that walks a `return-stmt` MUST also descend into `fnExprNode`** if it exists, treating it exactly like a nested `function-decl` statement — a `return-stmt`'s own `exprNode`/`expr` fields are EMPTY when `fnExprNode` is set. ~10 analysis passes route through it (route-inference.ts, type-system.ts, codegen/usage-analyzer.ts, component-expander.ts, meta-eval.ts, codegen/collect.ts, codegen/emit-logic.ts) — see dependencies.map.md for the Q1/Q2 async-classification split this feeds.

## GITI-039 — no new AST shape, a parse-time rejoin fix
No `ReturnStmtNode`/`ExprNode` shape changed. `ast-builder.js`'s `collectExpr`/`joinWithNewlines` (the token-collector for `${}` logic bodies) carries a `partSpans` parallel array so two adjacent markup-region parts whose spans are byte-adjacent rejoin with NO separator, preserving literal markup TEXT verbatim.

## §14.8.11 DB-authoritative tier — codegen-internal shapes, NOT a FileAST or ast.ts type (NEW S287)

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
immutable: boolean                  // §14.8.11.2 S3 — NEW S287. A bareword mirroring `not null`/`unique`; consumed ONLY by `generateDbAuthoritativeDDL`, which narrows the bounded role's table-level UPDATE grant to the mutable columns. Inert on a non-`db-authoritative` table (no bounded-role grant to narrow).
default: string | null
references: {table, column} | null
renameFrom: string | null
sharedCorePredicates: SharedCorePredicate[]   // §39.5.7 — req/length/pattern/min/max/gt/lt/gte/lte/eq/neq/oneOf/notIn

### SecdefFnDecl  [schema-differ.js, `parseFnDecl`]  — NEW S287, §14.8.11.2 S4
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

### ActualTable / ActualColumn  [schema-differ.js, `readActualSchema`/`readActualSchemaPg`]
The LIVE-database-read counterpart `diffSchema` compares `TableDecl`/`ColumnDecl` against. Same
shape family, `sharedCorePredicates` always `[]` (not recoverable from `PRAGMA table_info()` /
`information_schema.columns` in v1 — CHECK-constraint text isn't exposed).

**Known parser gap riding this shape** (`g-db-migrate-check-constraint-oneof-pattern`, MED, open,
`docs/known-gaps.md`): a `ColumnDecl` whose source line carries `oneOf([...])` or `pattern(/…/)`
trips `parseColumns`'/`parseSharedCorePredicates`' line-based scan — the DIFFER's parse, not the
main compiler's (`type-system.ts` parses these fine) — and the table false-fails the
`E-DBAUTH-NO-TENANT-COLUMN` pre-flight even when it DOES declare `tenant_id`. If you touch
`parseColumns`/`parseSharedCorePredicates`, this is the reproducer.

## §65 CSS-native model — NOT a dedicated FileAST shape
`<theme>` / `<defaults>` are recognized as ordinary MarkupNode instances via the structural-element registry (`compiler/src/attribute-registry.js:485` onchange, `:503` theme, `:516` defaults) — same pattern as `<endpoint>` (§61) and `<onchange>` (§38.13). No `ThemeDeclNode`/`EndpointDeclNode`/`OnchangeNode` type exists in ast.ts. Codegen-internal (non-FileAST) types for these features:
- `ThemeContext` — exported from `codegen/emit-theme-reset.ts:56`: `{ themeDecls: ThemeDecl[]; programNode; cellNames: Set<string> }`.
- `CSSVariableBridge` — `codegen/collect.ts`: the §25 reactive-CSS-var bridge descriptor.
- `ProtectContext`/`ProtectedColumns` (protect-egress.ts, §14.8.9), css-conflict-check.ts's internal `CssConflictFinding`, `RowChange` synthesis (channel-watches.ts, §38.13), `EndpointArmBinding`/`IfDisplayGuard` (codegen-internal, §61).
- `<program reset="none">`. `attribute-registry.js`'s `"program"` element carries a `reset` attrSpec — the §65.3.4 built-in-reset opt-out.

## `<outlet>` (§20.8) — also NOT a dedicated FileAST shape
Same structural-element-registry pattern as `<theme>`/`<defaults>`/`<onchange>` — no `OutletNode` type in ast.ts. Recognized/validated by symbol-table.ts PASS 15.5.

## §20.5 session-establishment — new attributes/config fields, NOT a new FileAST node type
No `SessionDeclNode` exists — `session` is a reserved server-scope BUILTIN identifier. See auth.map.md for the three separate non-FileAST "auth config" shapes.

## Type-system ResolvedType layer (type-system.ts, not ast.ts)
FunctionType [type-system.ts:423], MapType [:318] (with `.set?: boolean` for §59.12 value-native Set), PredicatedType [:468] (with `subsetVariants`), the `<fn-return>` over-approximation sentinel (`FN_RETURN_TYPE_NAME`, :754). NO `AnyType`/`null` member exists — `any` and `null` are not scrml types (§14.1.1 / null-does-not-exist axiom).

## Tags
#scrml #map #schema #ast #types #engine-decl #reactive-decl #css65 #theme #expr-node #file-ast #outlet #reset #link-boost #theme-context #css-var-bridge #giti-038 #giti-039 #return-stmt #fn-expr-node #session-establishment #colorless-async #dbauth #table-decl #column-decl #secdef-fn-decl #schema-differ #immutable-column

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [error.map.md](./error.map.md)
- [domain.map.md](./domain.map.md)
- [auth.map.md](./auth.map.md)
- [dependencies.map.md](./dependencies.map.md)
- [migrations.map.md](./migrations.map.md)
