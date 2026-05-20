# schema.map.md
# project: scrmlts
# updated: 2026-05-20T13:42:44-06:00  commit: 78faa65

This is a compiler. There is no database schema or external API schema.
The "schemas" below are the compiler's internal data structures: the AST node
union, the codegen IR, the symbol table, and the auth-graph / reachability types.
scrml *source files* (`.scrml`) declare their own data via `<schema>` blocks,
struct/enum `<Type>` declarations, and `schemaFor()` — that is runtime DDL the
compiler emits, not a schema of this codebase.

## AST Node Types  [compiler/src/types/ast.ts — 1927 lines]

Discriminated union; every node has `kind` (string literal), `id`, `span`.
`ASTNode` (line 1381) is the top-level union; `LogicStatement` (1332) the
statement sub-union.

### Source Location
Span [ast.ts:21] — file, start, end (byte offsets), line, col

### Attribute values — `AttrValue` union [ast.ts:42]
StringLiteralAttrValue [50] · VariableRefAttrValue [56] · CallRefAttrValue [64]
ExprAttrValue [73] · PropsBlockAttrValue [82] · AbsentAttrValue [88]
AttrNode [97] · TypedAttrDecl [108]

### CSS nodes
CSSReactiveRef [125] · CSSDeclaration [133] · CSSRule [144] (= CSSPropertyRule [146] | CSSSelectorRule [154])

### Block / markup nodes
MarkupNode [214] · TextNode [249] · CommentNode [256] · StateNode [265]
StateConstructorDefNode [279] · LogicNode [294] · SQLNode [311]
CSSInlineNode [330] · StyleNode [339] · ErrorEffectNode [350] · MetaNode [359]
HtmlFragmentNode [1080]

### Declarations
LetDeclNode [421] · ConstDeclNode [436] · TildeDeclNode [454] · LinDeclNode [466]
ReactiveDeclNode [477] · FunctionDeclNode [765] · ComponentDefNode [830]
EngineDeclNode [852] · ImportDeclNode [1158] · UseDeclNode [1176]
ExportDeclNode [1190] · TypeDeclNode [1209] · ChannelDeclNode [1237]

### Reactive / render
RenderSpecNode [704] · ReactiveNestedAssignNode [731] · ReactiveArrayMutationNode [745]
ReactiveExplicitSetNode [756]

### Statements & expressions
IfStmtNode [913] · IfExprNode [924] · ForExprNode [935] · MatchExprNode [946]
ForStmtNode [955] · WhileStmtNode [973] · ReturnStmtNode [982] · ThrowStmtNode [989]
SwitchStmtNode [996] · TryStmtNode [1005] · MatchStmtNode [1024] · MatchArmInlineNode [1042]
BareExprNode [1060] · LiftExprNode [1090] · FailExprNode [1100] · PropagateExprNode [1114]
GuardedExprNode [1126]

### Validators / predicates
RelationalPredicateNode [620] · ValidatorEntry [653] · ValidatorArg [693] (= ExprNode | RelationalPredicateNode)

### Destructuring
DestructureArrayElement [376] · DestructureObjectProperty [382]
DestructureArrayPattern [400] · DestructureObjectPattern [408] · DestructurePattern [416]

### Misc
ImportSpecifier [1146] · TransactionBlockNode [1256] · CleanupRegistrationNode [1265]
WhenEffectNode [1277] · WhenMessageNode [1291] · UploadCallNode [1302]
ErrorArm [165] · SQLChainedCall [182] · LiftTarget [195]

## Codegen IR  [compiler/src/codegen/ir.ts — 253 lines]

### FileIR [ir.ts:43] — top-level IR for one compiled .scrml file
filePath: string
html: HtmlIR     — { parts: string[] }            [ir.ts:22]
css: CssIR       — { userCss: string, tailwindCss: string }  [ir.ts:27]
server: ServerIR — { lines: string[] }            [ir.ts:33]
client: ClientIR — { lines: string[] }            [ir.ts:38]

### Test IR (emitted for inline `scrml:test`)
AssertStmt [132] · TestCase [148] · TestBindDecl [171] · TestGroup [214] · TestIR [244]

## Symbol Table  [compiler/src/symbol-table.ts]

ImportBindingRecord [166]
ScopeKind [204] = "file" | "function" | "engine" | "component" | "compound" | "field"
CellKind [225] = "plain" | "bindable" | "markup-typed" | "compound-parent" | "engine"
EngineMetadata [252] · EngineRuleForm [343] · PayloadBinding [369]
OnTimeoutEntry [384] · OnIdleEntry [421] · NestedEngineEntry [443] · OnTransitionEntry [465]
EngineStateChildEntry [498] · StateCellRecord [595]
SynthProperty [692] = "isValid" | "errors" | "touched" | "submitted"
Scope [741] · SYMResult [771] · SYMDiagnostic [781] · SYMStats [791] · SYMInput [804]

## AuthGraph types  [compiler/src/types/auth-graph.ts — 405 lines]
MarkupNodeId [49] · EntryPointId [56] · RoleVariant [67]
AuthSiteKind [83] · RoleClassification [107]
AuthGate [127] · RoleEnum [209] · AuthGraphDiagnostic [284]
AuthGraph [318] · AuthGraphOutput [402]

## Reachability types  [compiler/src/types/reachability.ts — 373 lines]
NodeId [61] · EntryPointId [70] · RoleVariant [79] · VendorUnitId [85]
ReachabilityRecord [98] · RolePlayableSurface [111] · ChunkPlan [123] · ChunkContents [145]
ReachabilityDiagnostic [177] · ReachabilityEntryPoint [199] · PlayableSurface [222]
RoleClassificationEntry [244]
RSInput [271] · RSOutput [323] · RSError [343]

## Tags
#scrmlts #map #schema #ast #ir #compiler #types

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [domain.map.md](./domain.map.md)
