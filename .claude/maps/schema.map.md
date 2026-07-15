# schema.map.md
# project: scrml
# updated: 2026-07-14T18:58:34-06:00  commit: f079d0a9

The compiler's "schema" is its own AST, not an application data model. Root catalog:
`compiler/src/types/ast.ts` (2097 lines, 114 exported interfaces/types, ~91 distinct `kind` discriminants; unchanged since fbb4d9fd). Read that file directly for the exhaustive list; this map groups it and calls out the load-bearing shapes.

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

**Control flow (statement)** — IfStmtNode [995], ForStmtNode [1044], WhileStmtNode [1062], ReturnStmtNode [1071], ThrowStmtNode [1078], SwitchStmtNode [1085], TryStmtNode [1094], MatchStmtNode [1113], MatchArmInlineNode [1131], BareExprNode [1149].

**Control flow (expression)** — IfExprNode [1006], ForExprNode [1017], MatchExprNode (statement-form) [1028] and the expression-layer MatchExpr [1897], TernaryExpr [1774], GuardedExprNode [1215] (`given`).

**Error/failure primitives** — FailExprNode [1189], PropagateExprNode [1203] (`?` propagation), ErrorArm [165], ErrorEffectNode [350].

**Reactive mutation** — ReactiveNestedAssignNode [757], ReactiveAssignNode [789], ReactiveArrayMutationNode [803], ReactiveExplicitSetNode [814].

**Functions / components** — FunctionDeclNode [823], ComponentDefNode [888], LambdaExpr [1851] / LambdaParam [1862].

**SQL / CSS / state bodies** — SQLNode [311], SQLChainedCall [182], SqlRefExpr [1970], CSSInlineNode [330], StyleNode [339], CSSDeclaration [133], CSSRule = CSSPropertyRule | CSSSelectorRule [144/146/154], CSSReactiveRef [125], StateNode [265], StateConstructorDefNode [279], LogicNode [294].

**Destructuring** — DestructureArrayPattern [426], DestructureObjectPattern [434], DestructureArrayElement [402], DestructureObjectProperty [408].

**Validators / lift / meta** — ValidatorEntry [679], RelationalPredicateNode [646], RenderSpecNode [730], LiftExprNode [1179], LiftTarget [195], MetaNode [359].

**Misc runtime-adjacent** — TransactionBlockNode [1345], CleanupRegistrationNode [1354], WhenEffectNode [1366], WhenMessageNode [1380], UploadCallNode [1391], AuthConfig [1496], MiddlewareConfig [1508].

## Expression-layer types (ExprNode union, [types/ast.ts:2075])
IdentExpr [1631], LitExpr [1653], ArrayExpr [1676], ObjectExpr [1682] / ObjectProp [1689], SpreadExpr [1695], UnaryExpr [1712], BinaryExpr [1740], AssignExpr [1762], TernaryExpr [1774], MemberExpr [1792], IndexExpr [1803], CallExpr [1813], NewExpr [1823], LambdaExpr [1851], CastExpr [1879], MatchExpr [1897], MapEntry [1922] / MapLitExpr [1949] (§59 value-native map/set), SqlRefExpr [1970], InputStateRefExpr [1984] (§36 `<#id>` reads), EscapeHatchExpr [1998] (`_{}` foreign block), ResetExpr [2063], MarkupValueExpr [2075].

## §65 CSS-native model — NOT a dedicated FileAST shape
`<theme>` / `<defaults>` are recognized as ordinary MarkupNode instances via the structural-element registry (`compiler/src/attribute-registry.js:474` onchange, `:492` theme, `:505` defaults — shifted +20 lines this window vs. the fbb4d9fd watermark) — same pattern as `<endpoint>` (§61) and `<onchange>` (§38.13). No `ThemeDeclNode`/`EndpointDeclNode`/`OnchangeNode` type exists in ast.ts as of this watermark; theme-body-parser.ts + symbol-table.ts + type-system.ts consume the raw markup body directly. Codegen-internal (non-FileAST) types for these features: `ProtectContext`/`ProtectedColumns` (protect-egress.ts:47/101, §14.8.9), css-conflict-check.ts's internal `CssConflictFinding` (E-STYLE-CONFLICT/W-STYLE-CONFLICT-POSSIBLE), `RowChange` synthesis (channel-watches.ts, §38.13, pipeline-internal not an AST node), `EndpointArmBinding`/`IfDisplayGuard` (codegen-internal, §61).

## `<outlet>` (§20.8) — also NOT a dedicated FileAST shape
Same structural-element-registry pattern as `<theme>`/`<defaults>`/`<onchange>` — no `OutletNode` type in ast.ts. Landed this window (soft-navigation Wave-1a/1b); recognized/validated by symbol-table.ts PASS 15.5 (E-OUTLET-DUPLICATE / E-OUTLET-OUTSIDE-SHELL / W-OUTLET-ABSENT-SOFT-NAV-DISABLED).

## Type-system ResolvedType layer (type-system.ts, not ast.ts)
FunctionType [type-system.ts:423], MapType [:318] (with `.set?: boolean` for §59.12 value-native Set), PredicatedType [:468] (with `subsetVariants`), the `<fn-return>` over-approximation sentinel (`FN_RETURN_TYPE_NAME`, :754). NO `AnyType`/`null` member exists — `any` and `null` are not scrml types (§14.1.1 / null-does-not-exist axiom). type-system.ts grew substantially this window (+2013/-95 lines) but these core exported shapes are unchanged.

## Tags
#scrml #map #schema #ast #types #engine-decl #reactive-decl #css65 #theme #expr-node #file-ast #outlet

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [error.map.md](./error.map.md)
- [domain.map.md](./domain.map.md)
