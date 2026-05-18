# schema.map.md
# project: scrmlts
# updated: 2026-05-18T00:00:00-06:00  commit: dae8ff1

## TypeScript AST — `compiler/src/types/ast.ts` (~1,858 LOC)

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

### ChannelDeclNode  [ast.ts:1152]
tag: "channel"  (always)
isExport?: boolean
_p3aInlinedFrom?: string
_p3aSourceSpan?: Span

### ASTNode (discriminated union)  [ast.ts:1312]
MarkupNode | TextNode | CommentNode | StateNode | StateConstructorDefNode | LogicNode |
SQLNode | CSSInlineNode | StyleNode | ErrorEffectNode | MetaNode | LogicStatement

### FileAST  [ast.ts:1392]
filePath: string, nodes: ASTNode[], imports, exports, components, typeDecls,
channelDecls?: ChannelDeclNode[], spans: Record<number, Span>, hasProgramRoot: boolean,
authConfig: AuthConfig | null, middlewareConfig: MiddlewareConfig | null

### TABOutput  [ast.ts:1424]
filePath, ast: FileAST, errors: TABErrorInfo[]

### TABErrorInfo  [ast.ts:1434]
code: string, message: string, tabSpan: Span, severity?: "error" | "warning"

### AuthConfig  [ast.ts:1337]
auth: string, loginRedirect: string

### MiddlewareConfig  [ast.ts:~1345]
cors, log, ratelimit, headers, idempotencyStore?, idempotencyTTL?, batchInListCap?, corsMaxAge?, channelReconnect?

### Logic statements, control flow, declarations
LetDeclNode, ConstDeclNode, TildeDeclNode, LinDeclNode, ReactiveDeclNode, FunctionDeclNode,
EngineDeclNode, IfStmtNode, IfExprNode, ForExprNode, ForStmtNode, WhileStmtNode,
ReturnStmtNode, ThrowStmtNode, SwitchStmtNode, TryStmtNode, MatchStmtNode, WhenEffectNode
(30+ named node kinds — see `export type ASTNode` for full union)

### ExprNode (union)  [ast.ts:1838]
IdentExpr | LitExpr | ArrayExpr | ObjectExpr | SpreadExpr | UnaryExpr | BinaryExpr |
AssignExpr | TernaryExpr | MemberExpr | IndexExpr | CallExpr | NewExpr | LambdaExpr |
CastExpr | MatchExpr | SqlRefExpr | InputStateRefExpr | EscapeHatchExpr | ResetExpr

## AuthGraph Types — `compiler/src/types/auth-graph.ts` (A-3, ~354 LOC)

### MarkupNodeId
type alias: number — stable AST node id for gate-bearing MarkupNodes

### AuthSiteKind  [auth-graph.ts:83]
"program-auth" | "page-auth" | "auth-role-block" | "channel-auth"

### RoleClassification  [auth-graph.ts:107]
| { closed_form: true;  gated_for_role: Set<RoleVariant> }
| { closed_form: false; gate_expr: ExprNode | null }

### AuthGate  [auth-graph.ts:127]
siteKind: AuthSiteKind, nodeId: MarkupNodeId, filePath: string, span: Span,
role: string | null, gateExpr: ExprNode | null, check: string | null,
redirect: string | null, classification: RoleClassification | null, rawPredicate: string

### RoleEnum  [auth-graph.ts:209]
name: string, variants: RoleVariant[], span: Span, filePath: string, isImplicitAnonymous: boolean

### AuthGraphDiagnostic  [auth-graph.ts:272]
code: "E-AUTH-GRAPH-001" | "E-AUTH-GRAPH-002" | "E-AUTH-GRAPH-003" | "E-AUTH-GRAPH-004" |
      "I-AUTH-REDIRECT-UNRESOLVED" | "W-AUTH-PAGE-INFERRED" | "W-AUTH-LOGIN-MISSING"
severity: "error" | "warning" | "info"
message: string, span: Span, filePath: string

### AuthGraph  [auth-graph.ts:305]
gates: Map<MarkupNodeId, AuthGate>, roleEnum: RoleEnum | null,
gateToEntryPoint: Map<MarkupNodeId, EntryPointId>, redirectTargets: Map<MarkupNodeId, string | null>,
errors: AuthGraphDiagnostic[]

### AuthGraphOutput  [auth-graph.ts:389]
graph: AuthGraph, errors: AuthGraphDiagnostic[]

## Reachability Solver Types — `compiler/src/types/reachability.ts` (S89 A-2.1, 360 LOC)

### ReachabilityRecord  [reachability.ts:98]
closures: Map<EntryPointId, RolePlayableSurface>, diagnostics: ReachabilityDiagnostic[]

### RolePlayableSurface  [reachability.ts:111]
byRole: Map<RoleVariant, ChunkPlan>

### ChunkPlan  [reachability.ts:123]
initialChunk: ChunkContents, prefetchTier1: ChunkContents, prefetchTier2: ChunkContents, prefetchTierN: ChunkContents[]

### ChunkContents  [reachability.ts:145]
componentNodeIds: Set<NodeId>, reactiveCellNodeIds: Set<NodeId>, serverFnNodeIds: Set<NodeId>, vendorUnitNames: Set<VendorUnitId>

### ReachabilityDiagnostic  [reachability.ts:177]
code: "E-CLOSURE-001" | "E-CLOSURE-002" | "W-AUTH-RUNTIME-FALLBACK"
severity: "error" | "info"

### RSError  [reachability.ts:329]
code: "E-CLOSURE-001" | "E-CLOSURE-002" | "W-AUTH-RUNTIME-FALLBACK"
severity: "error" | "warning" | "info"

### RSInput  [reachability.ts:271]
depGraph, routeMap?, authGraph?: AuthGraph | null, serverFnBoundary?, vendorUnitDeclarations?, roleEnum?, batchPlan?, files?

### RSOutput  [reachability.ts:309]
record: ReachabilityRecord, errors: RSError[]

### ReachabilityEntryPoint  [reachability.ts:199]
id: EntryPointId, filePath: string, routePath: string | null, shape: "page" | "spa-program", rootNodeId: NodeId

### RoleClassificationEntry  [reachability.ts:244]
gateNodeId: NodeId, role: RoleVariant, classification: "in" | "out" | "runtime-fallback", predicateSource?: string

## Reachability Component Types — `compiler/src/reachability/`

### ReactiveDepClosure  [component-2.ts:146]
Map<EntryPointId, Set<RSNodeId>> — output of computeReactiveDepClosure()

### ServerFnReachable  [component-3.ts:160]
serverFnIds: Set<NodeId>, calleeNodeIds: Set<NodeId>
ServerFnReachableByEntryPoint = Map<EntryPointId, ServerFnReachable>

### GateVisibility  [component-4.ts:114]
"in" | "out" | "runtime-fallback"
GateVisibilityIndex = Map<[MarkupNodeId, RoleVariant], GateVisibility>

### Component4Result  [component-4.ts:156]
byRole: Map<RoleVariant, Map<NodeId, Set<NodeId>>>, errors: RSError[], gateVisibilityIndex: GateVisibilityIndex

### VendorUnitsUsed  [component-5.ts:113]
Map<EntryPointId, Set<VendorUnitId>>

## Per-Route Artifact Splitter Types — `compiler/src/codegen/route-splitter.ts` (A-4)

### ChunkKey  [route-splitter.ts]
entryPointId: EntryPointId, role: RoleVariant, tier: "initial" | "tier1" | "tier2" | `tierN${number}`

### ChunkOutput  [route-splitter.ts]
key: ChunkKey, payloadJs: string, chunkHash: string, filename: string, byteSize: number

### ChunksManifest  [route-splitter.ts]
Map<ChunkKey, ChunkOutput>

### RouteInfo  [atom-emitter.ts]
routePath: string | null, shape: "page" | "spa-program"

### EmitPerRouteInput  [route-splitter.ts:255]
Includes: `chunkSizeBudgetBytes?: number` — Q-OPEN-5 soft budget override; falls back to CHUNK_LARGE_SOFT_BUDGET_BYTES (100,000) when absent/non-positive

## FNV-1a Hash Primitive — `compiler/src/codegen/fnv1a-hash.ts` (A-4.6)

FNV_OFFSET: 2166136261 (const — SPEC §47.1.3 normative)
FNV_PRIME: 16777619 (const — SPEC §47.1.3 normative)
fnv1aHash(input: string): string — FNV-1a 32-bit hash, output as 8-char base36, zero-padded

getCompilerIdentity(): string — reads package.json `version`, returns `"scrml-" + V`, cached; fallback `"scrml-unknown"` on read failure (Q-OPEN-4)

## Wire Format Types — `compiler/src/codegen/wire-format.ts` (228 LOC)

Exports (constants + function):
- `returnTypeAllowsAbsence(annot: string | undefined | null): boolean`
- `SERVER_WIRE_ENCODER_HELPER: string` — inline JS encoder helper (emitted at top of .server.js)
- `CLIENT_WIRE_DECODER_HELPER: string` — inline JS dual-decoder helper (emitted in client core chunk)

Wire envelope shape (canonical, SPEC §57): `{"__scrml_absent": true}`

## Codegen IR — `compiler/src/codegen/ir.ts`

### HtmlIR  parts: string[]
### CssIR   userCss: string, tailwindCss: string
### ServerIR  lines: string[]
### ClientIR  lines: string[]
### FileIR   filePath: string, html: HtmlIR, css: CssIR, server: ServerIR, client: ClientIR
### TestIR-family  AssertStmt, TestCase, TestBindDecl, TestGroup, TestIR

## Codegen Key Interfaces — `compiler/src/codegen/*.ts`

### CompileContext  [context.ts:24]
filePath, fileAST, routeMap, depGraph, protectedFields: Set<string>, authMiddleware, middlewareConfig,
csrfEnabled: boolean, encodingCtx: EncodingContext | null, mode: "browser"|"library", testMode: boolean,
dbVar: string, workerNames: string[], errors: CGError[], registry: BindingRegistry,
derivedNames: Set<string>, analysis: FileAnalysis | null, usedRuntimeChunks: Set<string>,
exportRegistry?: Map<string, Map<string, { kind, category, isComponent }>> | null,
reachabilityRecord?: ReachabilityRecord | null,
hasPrefetchableLinks: boolean  [A-4.4 — set by emit-html when internal `<a href>` resolves to RouteMap.pages],
hasInternalLinks: boolean      [Q-OPEN-6 — set by emit-html on any absolute-path string-literal `<a href>`, independent of resolution]

### CgInput  [codegen/index.ts:79]
files, routeMap?, depGraph?, protectAnalysis?, sourceMap?, embedRuntime?, mode?, testMode?,
emitMachineTests?, encoding?, batchPlan?, batchPlannerErrors?, exportRegistry?,
reachabilityRecord?, emitPerRoute?: boolean, chunkSizeBudgetBytes?: number  [Q-OPEN-5]

### CgFileOutput  [codegen/index.ts:143]
sourceFile, serverJs?, clientJs?, libraryJs?, html?, css?, testJs?, machineTestJs?,
workerBundles?: Map<string, string>, clientJsMap?, serverJsMap?

### CGError  [errors.ts:11]
code: string, message: string, span: CGSpan | object, severity: 'error' | 'warning' | 'info'
(severity includes 'info' since S92 — errors.ts line 15)

## scrml:host Runtime Types — `compiler/runtime/stdlib/host.js`

### HostError
Variant constructor: `HostError.Thrown(message, name) → { variant: "Thrown", data: { message, name } }`
### safeCall(thunk) → value | scrml-error-shape
### safeCallAsync(thunk) → Promise<value | scrml-error-shape>

## Native Parser Token Types — `compiler/native-parser/token.js` (M1.1-M1.4)

### Token  [token.js:181]
`{ kind: TokenKind, text: string, span: NativeSpan, ...payload }`
- RegexLit token also carries: `{ pattern: string, flags: string, raw: string }`
- TemplateChunk token carries the chunk text (no extra payload)
- TemplateInterpStart/TemplateInterpEnd are zero-payload boundary tokens

### NativeSpan  [span.js]
`{ start: number, end: number, line: number, col: number }`
(distinct from compiler/src/types/ast.ts Span which also carries `file: string`)

### TokenKind values  [token.js:5-123]
Grouped by category:

| Category | Values |
|----------|--------|
| Brackets | LParen, RParen, LBrace, RBrace, LBracket, RBracket |
| Punctuation | Semicolon, Comma, Dot, Ellipsis, Arrow, Colon, Question |
| Arithmetic | Plus, Minus, Star, Slash, Percent, StarStar |
| Assignment | Assign, PlusAssign, MinusAssign, StarAssign, SlashAssign |
| Comparison | Equal, NotEqual, StrictEqual, StrictNotEqual, LessThan, LessEqual, GreaterThan, GreaterEqual |
| Logical | LogicalAnd, LogicalOr, NullishCoalesce |
| Bitwise | BitAnd, BitOr, BitXor, BitNot, BitShiftLeft, BitShiftRight, BitShiftRightUnsigned |
| Unary | Increment, Decrement, Bang |
| JS keywords | KwIf, KwElse, KwFor, KwWhile, KwDoWhile, KwReturn, KwBreak, KwContinue, KwFunction, KwLet, KwConst, KwVar, KwClass, KwExtends, KwNew, KwImport, KwExport, KwFrom, KwAs, KwDefault, KwAsync, KwAwait, KwYield, KwTry, KwCatch, KwFinally, KwThrow, KwTrue, KwFalse, KwNull, KwUndefined, KwTypeof, KwInstanceof, KwIn, KwOf, KwVoid, KwDelete, KwThis, KwSuper |
| scrml extensions | KwIs, KwNot, KwMatch, KwLift, KwFail, KwRender, KwGiven, KwSome |
| Literals | NumberLit, StringLit, TemplateChunk, RegexLit (M1.4), BoolLit |
| Template interp | TemplateInterpStart, TemplateInterpEnd (M1.2) |
| Identifier | Ident |
| scrml syntax | BareVariant, ScrmlAt, SqlBlock, InputStateRef, Tilde, LogicEscapeOpen, LogicEscapeClose |
| Whitespace/Meta | Newline, Whitespace, EOF |

### QuoteKind  [token.js:125]
Single | Double | Backtick

### Functions  [token.js:181-195]
`makeToken(kind, text, span, payload?)` → Token
`makeIdentOrKeyword(text, span)` → Token (Ident or matching Kw* variant via JS_KEYWORDS lookup)
`makeEof(pos, line, col)` → Token

## Tags
#scrmlts #map #schema #ast #types #codegen #ir #s101 #v0.3.1 #auth-graph #wire-format #reachability #approach-a2 #approach-a3 #approach-a4 #route-splitter #fnv1a-hash #chunk-plan #q-open-4 #q-open-5 #q-open-6 #native-parser #token-catalog #m1-4

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [domain.map.md](./domain.map.md)
- [native-parser.map.md](./native-parser.map.md)
