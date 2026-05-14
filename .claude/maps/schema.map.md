# schema.map.md
# project: scrmlts
# updated: 2026-05-13T23:00:00Z  commit: 71305fe

## TypeScript AST — `compiler/src/types/ast.ts` (~1,828 LOC)

Single source of truth for all AST node shapes. All nodes carry `id: number` and `span: Span`.

### Span  [ast.ts:19]
file: string, start: number, end: number, line: number, col: number

### AttrValue (union)  [ast.ts:40]
StringLiteralAttrValue | VariableRefAttrValue | CallRefAttrValue | ExprAttrValue | PropsBlockAttrValue | AbsentAttrValue

### AttrNode  [ast.ts:95]
name: string, value: AttrValue, span: Span

### TypedAttrDecl  [ast.ts:106]
name: string, typeExpr: string, optional: boolean, defaultValue: string | null, span: Span

### CSS Types  [ast.ts:120-156]
CSSReactiveRef: { name: string, expr: string | null }
CSSDeclaration: { prop, value, span, reactiveRefs?, isExpression? }
CSSRule = CSSPropertyRule | CSSSelectorRule

### ErrorArm  [ast.ts:163]
pattern: string, binding: string, handler: string, handlerExpr?: ExprNode, span: Span

### SQLChainedCall  [ast.ts:180]
method: string, args: string

### LiftTarget (union)  [ast.ts:193]
{ kind: "markup", node: ASTNode } | { kind: "expr", expr: string, exprNode?: ExprNode }

### MarkupNode  [ast.ts:212]
kind: "markup", tag: string, attrs: AttrNode[], children: ASTNode[], selfClosing: boolean,
closerForm: string, isComponent: boolean,
resolvedKind?: 'html-builtin'|'scrml-lifecycle'|'user-state-type'|'user-component'|'unknown',
resolvedCategory?: 'html'|'channel'|'engine'|'timer'|'poll'|'db'|'schema'|'request'|'errorBoundary'|'machine'|'user-component'|'user-state-type'|'unknown',
auth?: string, loginRedirect?: string, csrf?: string, sessionExpiry?: string

### ChannelDeclNode (extends MarkupNode)  [ast.ts:1152]
tag: "channel"  (always)
isExport?: boolean               — true when declared as `export <channel name="X">`
_p3aInlinedFrom?: string         — source file path when CHX inlined this from another file
_p3aSourceSpan?: Span            — original declaration span when inlined

### TextNode  [ast.ts:247]
kind: "text", value: string

### CommentNode  [ast.ts:254]
kind: "comment", value: string

### StateNode  [ast.ts:263]
kind: "state", stateType: string, attrs: AttrNode[], children: ASTNode[]

### StateConstructorDefNode  [ast.ts:277]
kind: "state-constructor-def", stateType: string, typedAttrs: TypedAttrDecl[], attrs: AttrNode[], children: ASTNode[]

### LogicNode  [ast.ts:292]
kind: "logic", body: LogicStatement[], imports: ImportDeclNode[], exports: ExportDeclNode[], typeDecls: TypeDeclNode[], components: ComponentDefNode[]

### SQLNode  [ast.ts:309]
kind: "sql", query: string, chainedCalls: SQLChainedCall[], nobatch?: boolean

### CSSInlineNode  [ast.ts:328]
kind: "css-inline", rules: CSSRule[]

### StyleNode  [ast.ts:337]
kind: "style", rules: CSSRule[], children: ASTNode[]

### ErrorEffectNode  [ast.ts:348]
kind: "error-effect", arms: ErrorArm[]

### MetaNode  [ast.ts:357]
kind: "meta", body: LogicStatement[], parentContext: string

### LetDeclNode  [ast.ts:368]
kind: "let-decl", name: string, ifExpr?, forExpr?, matchExpr?, initExpr?: ExprNode

### ConstDeclNode  [ast.ts:383]
kind: "const-decl", name: string, ifExpr?, forExpr?, matchExpr?, initExpr?: ExprNode

### TildeDeclNode  [ast.ts:401]
kind: "tilde-decl", name: string, initExpr?: ExprNode

### LinDeclNode  [ast.ts:413]
kind: "lin-decl", name: string, initExpr?: ExprNode

### ReactiveDeclNode  [ast.ts:424]
kind: "state-decl", name: string,
shape?: "plain"|"decl-with-spec"|"derived", structuralForm?: boolean, isConst?: boolean,
renderSpec?: RenderSpecNode | null, validators?: ValidatorEntry[], defaultExpr?: ExprNode | null,
pinned?: boolean, children?: ReactiveDeclNode[], typeAnnotation?: string, isShared?: boolean

### ValidatorEntry  [ast.ts:574]
name: string, args: ValidatorArg[] | null, span: Span, inlineOverride?: string | null

### ValidatorArg (union)  [ast.ts:614]
ExprNode | RelationalPredicateNode

### RelationalPredicateNode  [ast.ts:541]
kind: "relational-predicate", op: ">=" | "<=" | "<" | ">" | "=" | "!=", value: ExprNode, span: ExprSpan

### RenderSpecNode  [ast.ts:625]
kind: "render-spec", element: MarkupNode

### ReactiveNestedAssignNode  [ast.ts:680]
kind: "reactive-nested-assign", target: string, path: string[], valueExpr?: ExprNode

### ReactiveArrayMutationNode  [ast.ts:694]
kind: "reactive-array-mutation", target: string, method: string, args: string

### ReactiveExplicitSetNode  [ast.ts:705]
kind: "reactive-explicit-set", args: string

### FunctionDeclNode  [ast.ts:714]
kind: "function-decl", name, params: string[], body: LogicStatement[], fnKind: "function"|"fn",
isServer, canFail, errorType?, route?, method?, isHandleEscapeHatch?

### EngineDeclNode  [ast.ts:772]
kind: "engine-decl"; state-machine declaration with state-child body (see ast.ts for full shape)

### Control Flow  [ast.ts:833+]
IfStmtNode, IfExprNode, ForExprNode, ForStmtNode, WhileStmtNode, ReturnStmtNode, ThrowStmtNode,
SwitchStmtNode, TryStmtNode, MatchStmtNode, MatchArmInlineNode — standard control flow shapes

### WhenEffectNode  [ast.ts:1192]
kind: "when-effect"; reactive side-effect trigger

### ASTNode (discriminated union)  [ast.ts:1296]
30+ node kinds — see `export type ASTNode` for full list

### LogicStatement (union)  [ast.ts:1247]
All statement kinds usable inside logic/meta blocks

### FileAST  [ast.ts:1376]
filePath: string, nodes: ASTNode[], channelDecls?: ChannelDeclNode[], + pipeline-stamped fields

### TABOutput  [ast.ts:1409]
filePath, ast: FileAST, errors: TABErrorInfo[]

### AuthConfig / MiddlewareConfig  [ast.ts:1321+]
Auth and middleware configuration shapes stamped on program-tag MarkupNodes.
MiddlewareConfig fields: cors, log, ratelimit, headers, idempotencyStore?, idempotencyTTL?,
batchInListCap?, corsMaxAge?, channelReconnect?

## ExprNode Types — `compiler/src/types/ast.ts` (ExprSpan section ~1,407+)

ExprSpan: { start, end, line?, col? }
ExprNode (union): IdentExpr | LitExpr | ArrayExpr | ObjectExpr | SpreadExpr | UnaryExpr |
  BinaryExpr | AssignExpr | TernaryExpr | MemberExpr | IndexExpr | CallExpr | NewExpr |
  LambdaExpr | CastExpr | MatchExpr | SqlRefExpr | InputStateRefExpr | EscapeHatchExpr | ResetExpr

## Codegen IR — `compiler/src/codegen/ir.ts`

### HtmlIR  [ir.ts:22]   parts: string[]
### CssIR  [ir.ts:27]    userCss: string, tailwindCss: string
### ServerIR  [ir.ts:33]  lines: string[]
### ClientIR  [ir.ts:38]  lines: string[]
### FileIR  [ir.ts:43]    filePath: string, html: HtmlIR, css: CssIR, server: ServerIR, client: ClientIR

### TestIR-family  [ir.ts:132+]
AssertStmt: { kind, ... }, TestCase: { name, asserts, ... },
TestBindDecl: { name, ... }, TestGroup: { name, cases, ... }, TestIR: { groups, ... }

## Dependency Graph Types — `compiler/src/dependency-graph.ts`

### DGNode kinds
function | reactive | render | sql-query | import | meta | markup-read (NEW A-1.2 S88)

### MarkupReadDGNode  [dependency-graph.ts:123]
kind: "markup-read", nodeId: NodeId, sourceRenderNodeId: NodeId | null, ownerScope: string,
hasLift: boolean, span: Span

Purpose: per-interpolation markup-context read node; tracks where each reactive var is read from markup context.
Emission sub-waves: A-1.3 (text-interpolation/attr/bind/if), A-1.4 (call-ref/for-iterable/lift-template), A-1.5 (engine state-child/onTransition/onTimeout/onIdle). All active.

### DGEdgeKind  [dependency-graph.ts:58]
"calls" | "reads" | "writes" | "renders" | "awaits" | "invalidates" | "validator-reads" | "engine-derived-reads"

## Reachability Solver Types — `compiler/src/types/reachability.ts` (NEW S89 A-2.1, 247 LOC)

### RSInput  [reachability.ts:267]
depGraph: DependencyGraph, fileAST: FileAST, entryPoints?: ReachabilityEntryPoint[]

### RSOutput  [reachability.ts:299]
record: ReachabilityRecord, diagnostics: RSError[]

### ReachabilityRecord  [reachability.ts:98]
closures: Map<EntryPointId, RolePlayableSurface>, diagnostics: ReachabilityDiagnostic[]

### ChunkPlan  [reachability.ts:123]
initialChunk: ChunkContents, prefetchTier1: ChunkContents, prefetchTier2: ChunkContents, prefetchTierN: ChunkContents[]

### ChunkContents  (per PIPELINE.md Stage 7.6 verbatim)
componentNodeIds: Set<NodeId>, reactiveCellNodeIds: Set<NodeId>, serverFnNodeIds: Set<NodeId>, vendorUnitNames: Set<VendorUnitId>

### ReachabilityEntryPoint  [reachability.ts:195]
id: EntryPointId, role: RoleVariant

## Codegen Key Interfaces — `compiler/src/codegen/*.ts`

### CompileContext  [context.ts:23]
filePath, fileAST, routeMap, depGraph, protectedFields: Set<string>, authMiddleware, middlewareConfig,
csrfEnabled: boolean, encodingCtx: EncodingContext | null, mode: "browser"|"library", testMode: boolean,
dbVar: string, workerNames: string[], errors: CGError[], registry: BindingRegistry,
derivedNames: Set<string>, analysis: FileAnalysis | null, usedRuntimeChunks: Set<string>,
exportRegistry?: Map<string, Map<string, { kind, category, isComponent }>> | null

### CGError  [errors.ts:11]
code: string, message: string, span: CGSpan | object, severity: 'error' | 'warning'

## scrml:host Runtime Types — `compiler/runtime/stdlib/host.js` (S88)

### HostError
Variant constructor object: `HostError.Thrown(message, name) → { variant: "Thrown", data: { message, name } }`
variants: ["Thrown"]

### safeCall(thunk) → value | scrml-error-shape
Wraps a synchronous JS-host call; catches any throw and returns `{ __scrml_error: true, type: "HostError", variant: "Thrown", data }`.

### safeCallAsync(thunk) → Promise<value | scrml-error-shape>
Async sibling of safeCall; wraps an async thunk; resolves to error shape on rejection.

## Tags
#scrmlts #map #schema #ast #types #codegen #ir #s89 #markup-read-dg-node #approach-a #approach-a2 #reachability #safecall

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [domain.map.md](./domain.map.md)
