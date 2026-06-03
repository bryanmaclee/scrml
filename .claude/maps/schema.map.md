# schema.map.md
# project: scrmlts
# updated: 2026-06-02T21:33:23-06:00  commit: 57edc794

Authoritative AST type source: `compiler/src/types/ast.ts` (1983L+, TypeScript).
IR types: `compiler/src/codegen/ir.ts` (253 lines).
Type-system internals: `compiler/src/type-system.ts` (17070L — internal interfaces, not exported).
Symbol-table exports: `compiler/src/symbol-table.ts` (11280L — `MessageArmEntry`, `PayloadBinding`, `EngineStateChildEntry`).
Enum-subset shared recognizer: `compiler/src/enum-subset-refinement.ts` (143L — `EnumSubsetParse`, `parseEnumSubsetAnnotation`).

---

## Core AST Node Types  [compiler/src/types/ast.ts]

### Span
start: number; end: number; line?: number; col?: number; file?: string

### AttrValue (union)
StringLiteralAttrValue | VariableRefAttrValue | CallRefAttrValue | ExprAttrValue | PropsBlockAttrValue | AbsentAttrValue

### AttrNode
name: string; value: AttrValue; span: Span

### BaseNode (base interface for all AST nodes)
kind: string; span: Span; id?: number

### MarkupNode extends BaseNode
kind: "markup"; tag: string; attrs: AttrNode[]; children: ASTNode[]; closerForm: string; angleDepth: number; ... +8 more fields

### TextNode extends BaseNode
kind: "text"; value: string

### StateNode extends BaseNode
kind: "state"; statetype: string; attrs: AttrNode[]; children: ASTNode[]

### StateConstructorDefNode extends BaseNode
kind: "state-def"; name: string; attrs: TypedAttrDecl[]; body: ASTNode[]

### LogicNode extends BaseNode
kind: "logic"; body: LogicStatement[]; exports: ExportDeclNode[]; ... +3 more fields

### SQLNode extends BaseNode
kind: "sql"; query: string; params: ExprNode[]; chain: SQLChainedCall[]; ... +5 more fields

### LetDeclNode extends BaseNode
kind: "let-decl"; name: string; typeAnnotation?: string; init?: ExprNode; isOptional: boolean

### ConstDeclNode extends BaseNode
kind: "const-decl"; name: string; typeAnnotation?: string; init: ExprNode

### TildeDeclNode extends BaseNode
kind: "tilde-decl"; name: string; init?: ExprNode

### LinDeclNode extends BaseNode
kind: "lin-decl"; name: string; typeAnnotation?: string; init: ExprNode

### ReactiveDeclNode extends BaseNode
kind: "reactive-decl"; name: string; typeAnnotation?: string; init?: ExprNode; renderSpec?: RenderSpecNode; ... +12 more fields

### FunctionDeclNode extends BaseNode
kind: "function-decl"; name: string; params: FunctionParam[]; returnType?: string; body: LogicStatement[]; modifier: "fn"|"server"|"pure"|"function"|null; errorType?: string; ... +5 more fields

### ComponentDefNode extends BaseNode
kind: "component-def"; name: string; props: TypedAttrDecl[]; body: ASTNode[]

### EngineDeclNode extends BaseNode
kind: "engine-decl"; name: string; stateChildren: ASTNode[]; initial?: string; derived?: ExprNode; ... +8 more fields
**S154 addition:** `acceptsType?: string | null` — raw enum-type identifier from `accepts=MsgType` engine-opener attribute (§51.0.S.2.2); recorded verbatim by parser (batch 1); resolved by SYM PASS 11 typer (batch 2); non-resolution fires `E-ENGINE-ACCEPTS-NOT-ENUM`.

### TypeDeclNode extends BaseNode
kind: "type-decl"; name: string; typeKind: "struct"|"enum"|"alias"; body: string

### ChannelDeclNode extends MarkupNode
kind: "markup"; tag: "channel"; name: string; isExported: boolean; ... extends MarkupNode

### ImportDeclNode extends BaseNode
kind: "import-decl"; specifiers: ImportSpecifier[]; source: string; importKind: "value"|"type"|"side-effect"

### ExportDeclNode extends BaseNode
kind: "export-decl"; raw: string; exportedName: string|null; exportKind: string|null; reExportSource: string|null; isPure?: boolean; isServer?: boolean

### FileAST
filePath: string; nodes: ASTNode[]; imports: ImportDeclNode[]; exports: ExportDeclNode[]; components: ComponentDefNode[]; typeDecls: TypeDeclNode[]; channelDecls: ChannelDeclNode[]; ... +8 more fields

### AuthConfig  [compiler/src/types/ast.ts:1458]
roles: string[]; loginPage?: string; defaultRole?: string

### MiddlewareConfig  [compiler/src/types/ast.ts:1470]
name: string; path: string; exports: string[]

---

## Match / Error-Handler Arm Node Fields (S147 addition)  [compiler/src/ast-builder.js]

Match arm nodes (`match-arm-inline`, `match-arm-block`) and `!{}`-handler arm objects now carry:

| Field | Type | Description |
|-------|------|-------------|
| armArrow | `":>"` \| `"=>"` \| `"->"` \| undefined | The arm separator glyph as written in source; set by `matchArrowGlyphAt()` at parse time; used by W-MATCH-ARROW-LEGACY emission in type-system.ts and by `rewriteMatchArmArrows()` in migrate.js |

`->` arms are now STRUCTURED (were bare-expr). `->` stays as two PUNCT tokens at the lexer
level to protect the `fn ... -> ReturnType` return-arrow path.

---

## Expression Node Types  [compiler/src/types/ast.ts:1577+]

### ExprNode (union)
IdentExpr | LitExpr | ArrayExpr | ObjectExpr | UnaryExpr | BinaryExpr | AssignExpr | TernaryExpr |
MemberExpr | IndexExpr | CallExpr | NewExpr | LambdaExpr | CastExpr | MatchExpr | SqlRefExpr |
InputStateRefExpr | EscapeHatchExpr | ResetExpr | HtmlFragmentNode | LiftExprNode | FailExprNode |
PropagateExprNode | GuardedExprNode

Key expression shapes:
- PropagateExprNode: kind: "propagate-expr"; inner: ExprNode  (the `?` operator)
- GuardedExprNode: kind: "guarded-expr"; body: LogicStatement[]  (`!{}` form)
- FailExprNode: kind: "fail-expr"; enumType: string; variant: string; data?: ExprNode

---

## IR Types  [compiler/src/codegen/ir.ts]

### HtmlIR
head: string[]; body: string[]; scripts: string[]; styles: string[]

### ServerIR
functions: string[]; exports: string[]; middleware: string[]

### ClientIR
init: string[]; effects: string[]; handlers: string[]; runtime: string[]

### FileIR
filePath: string; html: HtmlIR; server: ServerIR; client: ClientIR; css: CssIR; errors: CGError[]

### TestIR  [compiler/src/codegen/ir.ts:244]
cases: TestCase[]; binds: TestBindDecl[]

### TestBindDecl  [compiler/src/codegen/ir.ts:171]
name: string; serverFnName: string; span: Span

---

## CGError  [compiler/src/codegen/errors.ts]

code: string; message: string; span: CGSpan | object; severity: 'error' | 'warning' | 'info'

W-/I- prefix + severity:warning/info → result.warnings (non-fatal).
Everything else → result.errors (CLI exits 1).

---

## Protect-Analyzer PA Types  [compiler/src/protect-analyzer.ts]

### ColumnDef (exported)
name: string; sqlType: string; nullable: boolean; isPrimaryKey: boolean

### TableTypeView (exported)
tableName: string; fullSchema: ColumnDef[]; clientSchema: ColumnDef[]; protectedFields: Set<string>

### DBTypeViews (exported)
stateBlockId: string; dbPath: string; tables: Map<string, TableTypeView>

### ProtectAnalysis (exported)
views: Map<string, DBTypeViews>

---

## Type-System Internal Types  [compiler/src/type-system.ts — selected]

ResolvedType (union): PrimitiveType | StructType | EnumType | ArrayType | UnionType | AsIsType |
  UnknownType | NotType | SnippetType | StateType | ErrorType | HtmlElementType |
  CssClassType | FunctionType | MetaSpliceType | RefBindingType | PredicatedType | MachineType

### PredicatedType  [compiler/src/type-system.ts:332]
kind: "predicated"; baseType: string; predicate: PredicateExpr
**S156 (d)-A addition:** `subsetVariants?: Set<string>` — materialized positive IN-SET for `Enum oneOf([.A,.B])` / `notIn([...])` refinements (§53.15.1); `notIn` is already complemented to `base \ excluded`; used by match exhaustiveness narrowing (§18.8.1 / §18.0.1) + emit-predicates.ts `.includes()` codegen + emit-schema-for.ts `CHECK IN` DDL.

### PredicateExpr (kind union — local mirror in emit-predicates.ts)
"comparison" | "property" | "named-shape" | "and" | "or" | "not" | "error" | **"variant-set"**
**S156 (d)-A addition:** `kind: "variant-set"` — enum-subset boundary check; fields: `variantMode?: "oneOf"|"notIn"`, `variants?: string[]` (resolved IN-SET). Lowered to `(["A","B"].includes(v))` by `predicateToJsExpr()`.

MachineType: states: Map<string, VariantDef>; initial: string; derived?: ResolvedType; ... +5 more fields

LinState: "unconsumed" | "consumed"
TildeState: "uninitialized" | "initialized"

---

## Symbol-Table Exported Types  [compiler/src/symbol-table.ts — S154-S155 additions]

### PayloadBinding  [symbol-table.ts:494]
`{ kind: "positional"; name: string }` | `{ kind: "named"; field: string; name: string }`
Used in `MessageArmEntry.payloadBindings` and state-child opener bindings (§51.0.B.1 / §18.7).

### MessageArmEntry  [symbol-table.ts:516]
variantName: string — PascalCase variant ident (no dot) OR `"_"` for wildcard arm (§51.0.S.2.4)
isWildcard: boolean
payloadBindingsRaw: string — raw text inside `(...)` payload binding
payloadBindings: PayloadBinding[] — structured parsed bindings
armArrow: `":>"` | `"=>"` | `"->"` — separator glyph (deprecated aliases fire W-MATCH-ARROW-LEGACY)
bodyRaw: string — arm body verbatim (brace-delimited block OR bare target expression)
isBlock: boolean — true iff bodyRaw is `{ ... }` form

### EngineStateChildEntry  [symbol-table.ts:682 — abridged, non-obvious fields]
tag: string; rule: EngineRuleForm; internalRule?: EngineRuleForm
**S154 addition:** `messageArms: MessageArmEntry[]` — parsed message arms for this state-child; empty array when no arms declared; carries arms unconditionally regardless of `accepts=` presence (validation is a batch-2 typer concern, not batch-1 parse concern)

---

## Enum-Subset Recognizer Types  [compiler/src/enum-subset-refinement.ts — NEW S156]

### EnumSubsetParse (union)
`null` — not an enum-subset annotation (falls through to caller's existing path)
`{ kind: "error"; baseEnum: string; mode: "oneOf"|"notIn"; message: string }` — recognized form but illegal arg (range form / empty set / malformed entry); lowered to E-CONTRACT-002 at decl-site
`{ kind: "subset"; baseEnum: string; mode: "oneOf"|"notIn"; variants: string[]; label: string|null }` — valid subset; `variants` is the resolved positive IN-SET (notIn already complemented)

### parseEnumSubsetAnnotation(expr, enumVariantsOf) → EnumSubsetParse
Whitespace-tolerant parser for `"EnumName oneOf([.A,.B])"` / `"notIn([.C])"` annotation strings.
`enumVariantsOf: (enumName: string) => string[] | null` — lookup from caller's registry (type-system passes type-registry-backed lookup; symbol-table passes file-scope enum registry). Dependency-free module (no type-system.ts import) to allow circular-safe import by symbol-table.ts.

---

## Tags
#scrmlts #map #schema #ast #types #compiler #ir #protect-analyzer #match-arm #enum-subset #message-dispatch #predicated-type #s154 #s155 #s156

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [error.map.md](./error.map.md)
