# schema.map.md
# project: scrml
# updated: 2026-07-19T21:52:34-06:00  commit: df2ac831

The compiler's "schema" is its own AST, not an application data model. Root catalog:
`compiler/src/types/ast.ts` (2104 lines, 114 exported interfaces/types, ~91 distinct `kind` discriminants — line count +7 this window, GITI-038's `ReturnStmtNode.fnExprNode` field, see below; unchanged otherwise since fbb4d9fd). Read that file directly for the exhaustive list; this map groups it and calls out the load-bearing shapes.

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

**Control flow (statement)** — IfStmtNode [995], ForStmtNode [1044], WhileStmtNode [1062], ReturnStmtNode [1071] (gained `fnExprNode` this window — see the GITI-038 callout below), ThrowStmtNode [1085], SwitchStmtNode [1092], TryStmtNode [1101], MatchStmtNode [1120], MatchArmInlineNode [1138], BareExprNode [1156].

**Control flow (expression)** — IfExprNode [1006], ForExprNode [1017], MatchExprNode (statement-form) [1028] and the expression-layer MatchExpr [1904], TernaryExpr [1781], GuardedExprNode [1222] (`given`).

**Error/failure primitives** — FailExprNode [1196], PropagateExprNode [1210] (`?` propagation), ErrorArm [165], ErrorEffectNode [350].

**Reactive mutation** — ReactiveNestedAssignNode [757], ReactiveAssignNode [789], ReactiveArrayMutationNode [803], ReactiveExplicitSetNode [814].

**Functions / components** — FunctionDeclNode [823], ComponentDefNode [888], LambdaExpr [1858] / LambdaParam [1869].

**SQL / CSS / state bodies** — SQLNode [311], SQLChainedCall [182], SqlRefExpr [1977], CSSInlineNode [330], StyleNode [339], CSSDeclaration [133], CSSRule = CSSPropertyRule | CSSSelectorRule [144/146/154], CSSReactiveRef [125], StateNode [265], StateConstructorDefNode [279], LogicNode [294].

**Destructuring** — DestructureArrayPattern [426], DestructureObjectPattern [434], DestructureArrayElement [402], DestructureObjectProperty [408].

**Validators / lift / meta** — ValidatorEntry [679], RelationalPredicateNode [646], RenderSpecNode [730], LiftExprNode [1186], LiftTarget [195], MetaNode [359].

**Misc runtime-adjacent** — TransactionBlockNode [1352], CleanupRegistrationNode [1361], WhenEffectNode [1373], WhenMessageNode [1387], UploadCallNode [1398], AuthConfig [1503] (unchanged this window — see the "duplicate AuthConfig shapes" note below), MiddlewareConfig [1515].

**Expression-layer types (ExprNode union, [types/ast.ts:2082])** — IdentExpr [1638], LitExpr [1660], ArrayExpr [1683], ObjectExpr [1690] / ObjectProp [1696], SpreadExpr [1702], UnaryExpr [1719], BinaryExpr [1747], AssignExpr [1769], TernaryExpr [1781], MemberExpr [1799], IndexExpr [1810], CallExpr [1820], NewExpr [1830], LambdaExpr [1858], CastExpr [1886], MatchExpr [1904], MapEntry [1929] / MapLitExpr [1956] (§59 value-native map/set), SqlRefExpr [1977], InputStateRefExpr [1991] (§36 `<#id>` reads), EscapeHatchExpr [2005] (`_{}` foreign block), ResetExpr [2046], MarkupValueExpr [2070].

## GITI-038 (NEW this window) — `ReturnStmtNode.fnExprNode` (a returned function expression)
`return function name(){…}` / `return async function name(){…}` is parsed STRUCTURALLY, not stripped-and-hoisted. `ReturnStmtNode` [types/ast.ts:1071] gained an optional `fnExprNode?: FunctionDeclNode` field [types/ast.ts:1081] carrying the returned closure as a full `function-decl` node — the SAME shape a top-level `FunctionDeclNode` uses (`kind:"function-decl"`). Prior behavior (`RETURN_DECL_KW` in ast-builder.js stripped `function` from the return, emptying it and hoisting the function as an orphaned unreachable sibling) is what caused the GITI-038 miscompile. `RETURN_DECL_KW` now covers only `const`/`let`/`type`/`fn` — `function`/`async function` route through a recursive `parseOneStatement()` call instead (ast-builder.js ~8329).

**Contract: every AST pass that walks a `return-stmt` MUST also descend into `fnExprNode`** if it exists, treating it exactly like a nested `function-decl` statement — a `return-stmt`'s own `exprNode`/`expr` fields are EMPTY when `fnExprNode` is set (the return value IS the function). This window's fix routed ~10 analysis passes through it (round-2 completeness fix after the S239 gate caught the round-1 gap as a live server/client-split regression):
- `route-inference.ts` — `collectFunctionNodes` collects `fnExprNode` as its own analysis entry (marked `_returnedInline` so it is exempt from the `W-DEAD-FUNCTION` dead-code pass — a returned closure is used BY POSITION, not by a named caller); `walkBodyForTriggers` re-enters `visitNode` on it so a server-only resource inside the closure escalates the enclosing route instead of leaking to the client bundle.
- `type-system.ts` — `annotateNodes`'s return-stmt handler visits `fnExprNode` for scope/type analysis; `checkLinear`'s return-stmt handler walks it for §35 linear/must-use analysis.
- `codegen/usage-analyzer.ts` — `walkUsage` recurses into `fnExprNode` so a helper called ONLY inside the returned closure isn't a `W-DEAD-FUNCTION` false positive.
- `component-expander.ts` — `substitutePropsInLogicStmt`'s return-stmt case now ALSO substitutes props inside `fnExprNode` (the `{...n}` spread alone would carry it unsubstituted).
- `meta-eval.ts` — `serializeNode`'s return-stmt case serializes `fnExprNode` as a named function expression (else `^{}` compile-time meta-evaluation silently dropped the returned closure).
- `codegen/collect.ts` — `isServerOnlyNode` scans `fnExprNode`'s direct body (E-CG-006 defense-in-depth) so a server-only resource (`?{}` SQL / env read) inside the returned closure fails loud instead of client-emitting a `return null` stub.
- `codegen/emit-logic.ts` — `emitLogicNode`'s `return-stmt` case emits `fnExprNode` inline via `case "function-decl"` (which derives its OWN `async` keyword from the lowered body's `await`s — the returned closure can be async while the enclosing factory stays sync). See dependencies.map.md for the Q1/Q2 async-classification split this feeds.

## GITI-039 (NEW this window) — no new AST shape, a parse-time rejoin fix
No `ReturnStmtNode`/`ExprNode` shape changed. `ast-builder.js`'s `collectExpr`/`joinWithNewlines` (the token-collector for `${}` logic bodies) gained a `partSpans` parallel array carrying each collected token's source span WHEN it was collected inside a markup region (`angleDepth > 0`, else `null`). Two adjacent markup-region parts whose spans are byte-adjacent (`prev.end === cur.start`) now rejoin with NO separator, preserving literal markup TEXT verbatim (`a.txt` stays `a.txt`, not `a . txt`). A `null`-span (pure-expression, `angleDepth === 0`) part falls through to the pre-existing line-based separator, so pure-expression rejoin stays byte-identical (verified S239, 948-sample). A companion fix scopes the `;` statement-boundary break to `angleDepth === 0` — inside a markup region a `;` is literal text, not a statement terminator.

## §65 CSS-native model — NOT a dedicated FileAST shape
`<theme>` / `<defaults>` are recognized as ordinary MarkupNode instances via the structural-element registry (`compiler/src/attribute-registry.js:485` onchange, `:503` theme, `:516` defaults) — same pattern as `<endpoint>` (§61) and `<onchange>` (§38.13). No `ThemeDeclNode`/`EndpointDeclNode`/`OnchangeNode` type exists in ast.ts as of this watermark; theme-body-parser.ts + symbol-table.ts + type-system.ts consume the raw markup body directly. Codegen-internal (non-FileAST) types for these features:
- `ThemeContext` — exported from `codegen/emit-theme-reset.ts:56`: `{ themeDecls: ThemeDecl[]; programNode; cellNames: Set<string> }`, the single-walk gather of `<theme>` decls + the `<program>` node + declared reactive/derived cell names that feeds every §65 lowering path. (`ThemeDecl`/`ThemeToken` are file-local shapes typing the `kind:"theme-decl"` node theme-body-parser.ts produces.)
- `CSSVariableBridge` — `codegen/collect.ts`: the §25 reactive-CSS-var bridge descriptor (`{ varName, customProp, isExpression, expr, refs }`). Its `scoped` field was REMOVED in #98/`bf316828` — reactive CSS custom props are no longer per-instance scoped.
- `ProtectContext`/`ProtectedColumns` (protect-egress.ts:47/101, §14.8.9), css-conflict-check.ts's internal `CssConflictFinding` (E-STYLE-CONFLICT/W-STYLE-CONFLICT-POSSIBLE), `RowChange` synthesis (channel-watches.ts, §38.13, pipeline-internal not an AST node), `EndpointArmBinding`/`IfDisplayGuard` (codegen-internal, §61).
- `<program reset="none">`. `compiler/src/attribute-registry.js`'s `"program"` element carries a `reset` attrSpec (`allowedValues: ["none"]`, `supportsInterpolation:false`) — the §65.3.4 built-in-reset opt-out. Consumed by `emitResetLayer` in `codegen/emit-theme-reset.ts` (also owns `<theme>` token → `:root` custom-property lowering §65.3.2/§25.7, and `themeVariantAttr` — the `data-scrml-theme-<cell>` name shared by the runtime theme-switch reflection in emit-client.ts and the emitted variant selector in emit-css.ts). See domain.map.md / error.map.md for `E-THEME-TOKEN-UNKNOWN`.

## `<outlet>` (§20.8) — also NOT a dedicated FileAST shape
Same structural-element-registry pattern as `<theme>`/`<defaults>`/`<onchange>` — no `OutletNode` type in ast.ts. Recognized/validated by symbol-table.ts PASS 15.5 (E-OUTLET-DUPLICATE / E-OUTLET-OUTSIDE-SHELL / W-OUTLET-ABSENT-SOFT-NAV-DISABLED). §20.8.3 link-boost (the delegated `<a href>` click-interception that makes internal links actually soft-navigate by default) — runtime side in `compiler/src/runtime-template.js`, boot-call emission gated on `fileHasOutlet(fileAST)` in `compiler/src/codegen/emit-client.ts`. Not a new AST shape either — `hard` is a plain boolean `<a>` attribute (html-elements.js).

## §20.5 session-establishment — new attributes/config fields, NOT a new FileAST node type
No `SessionDeclNode` exists — `session` is a reserved server-scope BUILTIN identifier (bound into scope by type-system.ts's `annotateNodes` when `boundary === "server"`, see auth.map.md), not a declaration form. Three DIFFERENT non-FileAST "auth config" shapes carry the new `session-secure=` attribute (`"true"`\|`"false"`, closed value set, registered on BOTH `<program>` and `<page>` in attribute-registry.js + html-elements.js) — these are three SEPARATE interfaces, not one shared type, a pre-existing architecture (not introduced this window):
- `compute-program-config.ts`'s own `AuthConfig` [:28] — gained `sessionSecure: string` (the raw `"true"`/`"false"` attribute value; ProgramConfig-level, consumed by route-inference.ts).
- `route-inference.ts`'s `AuthMiddleware` interface [:294] — gained `sessionSecure?: boolean` (coerced boolean, `authConfig.sessionSecure !== "false"`; optional so pre-existing test constructions default to the safe secure mode).
- `types/ast.ts`'s own `AuthConfig` [:1503] (the FileAST-level copy, `{auth, loginRedirect, csrf, sessionExpiry}`) did NOT gain a `sessionSecure` field this window — see auth.map.md for which shape codegen actually reads.

## Type-system ResolvedType layer (type-system.ts, not ast.ts)
FunctionType [type-system.ts:423], MapType [:318] (with `.set?: boolean` for §59.12 value-native Set), PredicatedType [:468] (with `subsetVariants`), the `<fn-return>` over-approximation sentinel (`FN_RETURN_TYPE_NAME`, :754). NO `AnyType`/`null` member exists — `any` and `null` are not scrml types (§14.1.1 / null-does-not-exist axiom). Unchanged this window.

## Tags
#scrml #map #schema #ast #types #engine-decl #reactive-decl #css65 #theme #expr-node #file-ast #outlet #reset #link-boost #theme-context #css-var-bridge #giti-038 #giti-039 #return-stmt #fn-expr-node #session-establishment #colorless-async

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [error.map.md](./error.map.md)
- [domain.map.md](./domain.map.md)
- [auth.map.md](./auth.map.md)
- [dependencies.map.md](./dependencies.map.md)
