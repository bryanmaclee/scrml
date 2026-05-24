# schema.map.md
# project: scrmlts
# updated: 2026-05-23T00:00:00Z  commit: 73dd816c

Authoritative AST type catalog: `compiler/src/types/ast.ts`. The M5 native-parser swap
must produce output coercible to `FileAST` / `TABOutput`. As of C1/C2 (S119),
`nativeParseFile` (compiler/native-parser/parse-file.js) IS that coercion and is routed
at the TAB seam behind `--parser=scrml-native`.

## Pipeline I/O Types

### TABOutput  [compiler/src/types/ast.ts:1520]
```
filePath: string
ast: FileAST
errors: TABErrorInfo[]
```

### FileAST  [compiler/src/types/ast.ts:1487] — top-level output of TAB stage
```
filePath: string
nodes: ASTNode[]                — top-level AST nodes
imports: ImportDeclNode[]
exports: ExportDeclNode[]
components: ComponentDefNode[]
typeDecls: TypeDeclNode[]
channelDecls?: ChannelDeclNode[]
spans: Record<number, Span>     — nodeId → Span table
hasProgramRoot: boolean
authConfig: AuthConfig | null   — populated by PRECG stage
middlewareConfig: MiddlewareConfig | null
hasResetExpr / hasEqualityExpr / hasChunkedMarkupTag / hasForStmt: boolean  — PGO flags
```

### AuthConfig  [ast.ts:1432]
`auth / loginRedirect / csrf / sessionExpiry: string`

### MiddlewareConfig  [ast.ts:1444]
`cors / log / ratelimit / headers / idempotencyStore / idempotencyTTL / batchInListCap / corsMaxAge / channelReconnect: string | null`

## Core AST Unions

### ASTNode  [ast.ts:1407] — top-level / markup-child node union
`markup | text | comment | state | state-constructor-def | logic | sql | css-inline | style | error-effect | meta | match-block | LogicStatement`

### LogicStatement  [ast.ts:1358] — ~40-kind sub-union inside logic bodies
`let-decl | const-decl | tilde-decl | lin-decl | reactive-decl | reactive-debounced-decl | reactive-nested-assign | reactive-array-mutation | reactive-explicit-set | reactive-assign (V-kill, S123) | function-decl | component-def | if-stmt | if-expr | for-expr | match-expr | for-stmt | while-stmt | return-stmt | throw-stmt | switch-stmt | try-stmt | match-stmt | match-arm-inline | bare-expr | lift-expr | fail-expr | propagate-expr | guarded-expr | import-decl | use-decl | export-decl | type-decl | transaction-block | cleanup-registration | when-effect | when-message | upload-call + block-ref nodes`

## Node Interfaces (selected)

### Span  [ast.ts:21]
`start / end / line / col: number; file?: string`

### AttrValue  [ast.ts:42] — 6-variant union
`StringLiteralAttrValue | VariableRefAttrValue | CallRefAttrValue | ExprAttrValue | PropsBlockAttrValue | AbsentAttrValue`

### ReactiveAssignNode  [ast.ts:764] — NEW S123 V-kill
```
kind: "reactive-assign"
target: string        — reactive variable name (without @)
value: string         — raw value expression text
valueExpr?: ExprNode  — structured ExprNode form
```
Replaces pre-S123 phantom state-decl synthesis for bare `@name = expr` inside fn/function/user `${...}`. SYM PASS 3 fires E-STATE-UNDECLARED when no structural `<name>` decl is in scope.

### Declaration nodes
`LetDeclNode [447] | ConstDeclNode [462] | TildeDeclNode [480] | LinDeclNode [492] | ReactiveDeclNode [503] | FunctionDeclNode [791] | ComponentDefNode [856] | EngineDeclNode [878] | TypeDeclNode [1235] | ImportDeclNode [1184] | ExportDeclNode [1216] | UseDeclNode [1202] | ChannelDeclNode [1263]`

### MatchBlockNode (synthesized by parse-file.js — S121 P5-7)
`{ kind: "match-block", forType, onExprRaw, armsRaw, bodyChildren, span }`

## ExprNode union  [ast.ts:1939] — 20 lowercase kinds

`IdentExpr | LitExpr | ArrayExpr | ObjectExpr | SpreadExpr | UnaryExpr | BinaryExpr | AssignExpr | TernaryExpr | MemberExpr | IndexExpr | CallExpr | NewExpr | LambdaExpr | CastExpr | MatchExpr | SqlRefExpr | InputStateRefExpr | EscapeHatchExpr | ResetExpr`

## Codegen I/O Types  [compiler/src/codegen/]

### FileIR  [codegen/ir.ts:43]
```
filePath: string; html: HtmlIR; css: CssIR; server: ServerIR; client: ClientIR
```

### CompileContext  [codegen/context.ts:24]
```
filePath / fileAST / routeMap / depGraph / protectedFields / authMiddleware /
middlewareConfig / csrfEnabled / encodingCtx / mode / testMode / dbVar /
workerNames / errors / registry / derivedNames / analysis / runtimeChunks: ...
```

### RewriteContext  [codegen/rewrite.ts:50]
```
errors?: any[]; derivedNames?: Set<string>; dbVar?: string; skipPresenceGuard?: boolean
```

### RuntimeChunkName  [codegen/runtime-chunks.ts]
Union of named runtime chunk keys ('core' | 'scope' | 'timers' | 'animation' | 'prefetch' | ...).
`CHUNK_DEPENDENCIES: { scope: ['timers', 'animation'] }` — 6nz Bug P (S123).
`applyChunkDependencies(chunks)` — fixed-point closure; called after detectRuntimeChunks.

## Symbol Table Types  [compiler/src/symbol-table.ts]

### ScopeKind
`"file" | "function" | "engine" | "component" | "compound" | "field"`

### CellKind
`"plain" | "bindable" | "markup-typed" | "compound-parent" | "engine"`

### EngineStateChildEntry  [symbol-table.ts:549]
```
tag: string; rule: EngineRuleForm; bodyRaw: string
isColonShorthand: boolean; rawOffset: number; historyAttr: boolean
internalRule: EngineRuleForm; onTimeoutElements: OnTimeoutEntry[]
innerEngines: NestedEngineEntry[]; effectRaw: string | null
onTransitionElements: OnTransitionEntry[]; payloadBindings: PayloadBinding[]
onIdleElements: OnIdleEntry[]  — exported by symbol-table.ts; consumed by native-walker
```
This shape is produced by `engine-statechild-walker.ts` (M6.6.b.2 primary path) or `engine-statechild-parser.ts` (legacy fallback for synthetic ASTs).

### SYMInput  [symbol-table.ts:855]
`{ filePath, ast: FileAST, exportRegistry? }`

### SYMResult  [symbol-table.ts:822]
`{ filePath, errors: SYMDiagnostic[], fileScope: Scope, stats: SYMStats }`

### Scope  [symbol-table.ts:792]
`{ kind: ScopeKind; parent: Scope | null; file: string; stateCells: Map<string,StateCellRecord>; importBindings: Map<string,ImportBindingRecord>; children: Scope[] }`

## Native-parser AST Catalogs

### Token  [compiler/native-parser/token.js]
`TokenKind` — Object.freeze enum; `CONTEXTUAL_KEYWORDS` = `{ "type": "type" }`.

### Stmt catalog  [ast-stmt.js] — 20 frozen StmtKind variants
Block, ExprStmt, Empty, VarDecl, If, While, DoWhile, For, ForIn, ForOf, Return, Break, Continue, Labeled, FunctionDecl, ClassDecl, Import, Export, Try, Throw, LinDecl, TypeDecl, TildeDecl.

### Expr catalog  [ast-expr.js] — 40 frozen ExprKind variants
Ident, NumberLit, StringLit, BoolLit, RegexLit, TemplateLit, AtCell, BareVariant, This, Super, Array, Object, Paren, Unary, Update, Binary, Logical, Assignment, Conditional, Sequence, Call, New, Member, TaggedTemplate, Arrow, Function, RestElement, AssignmentPattern, BlockStub; scrml-extension: NotValue, Tilde, Sql, InputStateRef, IsCheck, Match (+MatchArm/VariantPattern/WildcardPattern/IsPattern/MatchBinding), Render, Lift, Fail, Propagate, GuardedExpr, Yield, MarkupValue.

### Block catalog  [parse-markup.js]
BlockKinds: Markup, Text, Comment, Sql, Css, Meta, ErrorEffect, LogicEscape, DisplayTextLiteral, Test (`_{}`), ForeignCode (`^^{}`).

## Database Models
No application DB schema — scrml is a compiler. SQLite *.db files are throwaway test fixtures.

## Tags
#scrmlts #map #schema #ast #fileast #native-parser #codegen #m5-swap #bridge #match-block #v-kill #reactive-assign #symbol-table #runtime-chunks #engine-statechild-walker #m6-6-b2

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [domain.map.md](./domain.map.md)
