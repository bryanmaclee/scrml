# schema.map.md
# project: scrmlTS
# updated: 2026-05-08T00:00:00Z  commit: f59bbcc

## TypeScript AST — `compiler/src/types/ast.ts` (1,722 LOC)

This is the canonical AST contract. Every pass downstream of TAB consumes/produces these nodes.
~80 `kind` discriminators across `ASTNode` (logic + markup statements) and `ExprNode` (expressions).

### Core / shared
Span                          — { file: string; start: number; end: number; line: number; col: number }.
ExprSpan                      — structurally identical to Span; used by ExprNode subtree.
AttrValue (union)             — StringLiteralAttrValue | VariableRefAttrValue | CallRefAttrValue | ExprAttrValue | PropsBlockAttrValue | AbsentAttrValue.
AttrNode                      — { name: string; value: AttrValue; span: Span }.
TypedAttrDecl                 — typed attribute decl inside state constructor defs (name, typeExpr, optional, defaultValue, span).
SQLChainedCall                — { method: string; args: string } — chained `.run()`, `.all()`, `.get()` on SQL blocks.
LiftTarget (union)            — `{ kind: "markup"; node: ASTNode }` | `{ kind: "expr"; expr: string; exprNode?: ExprNode }`.

### Markup + control
MarkupNode                    — generic HTML element/component-instance node (`kind: "markup"`); has `tag`, `attrs`, `children`, `isComponent`, `resolvedKind?`, `resolvedCategory?`.
TextNode                      — `kind: "text"`.
CommentNode                   — `kind: "comment"`.
ChannelDeclNode (extends MarkupNode) — `kind: "markup"` with `tag === "channel"`; carries `isExport?`, `_p3aInlinedFrom?`, `_p3aSourceSpan?`.
HtmlFragmentNode              — `kind: "html-fragment"`; raw HTML pass-through inside logic contexts.
StyleNode                     — `kind: "style"`; contains CSS rules + child nodes.
CSSInlineNode                 — `kind: "css-inline"`; inline CSS `#{ ... }` block.
CSSRule (union)               — CSSPropertyRule | CSSSelectorRule.
CSSReactiveRef                — { name: string; expr: string | null } — reactive ref captured inside CSS values.
CSSDeclaration                — { prop; value; span; reactiveRefs?; isExpression? }.
RenderSpecNode                — `kind: "render-spec"`; wraps a MarkupNode as the bindable render-spec for Shape 2 state-decl.

### Decls
LetDeclNode                   — `kind: "let-decl"`; `{ name; ifExpr?; forExpr?; matchExpr?; initExpr? }`.
ConstDeclNode                 — `kind: "const-decl"`; same shape as LetDeclNode.
TildeDeclNode                 — `kind: "tilde-decl"`; `{ name; initExpr? }` (must-use `~` variable).
LinDeclNode                   — `kind: "lin-decl"`; `{ name; initExpr? }` (§35.2 linear type).
ReactiveDeclNode              — `kind: "state-decl"`; the central reactive cell AST node.
  shape?:          "plain" | "decl-with-spec" | "derived"
  structuralForm?: boolean   — true = `<NAME>` form; false = legacy `@name` form
  isConst?:        boolean   — true = const-derived cell
  renderSpec?:     RenderSpecNode | null  — Shape 2 only
  validators?:     ValidatorEntry[]       — Shape 2 predicate list (B9 structured)
  defaultExpr?:    ExprNode | null        — from `default=<expr>` attr (§6.8, L18)
  pinned?:         boolean                — from `pinned` bareword attr (§6.10)
  children?:       ReactiveDeclNode[]     — Variant C compound children (§6.3.2)
  typeAnnotation?: string                 — `:T` typed annotation (§6.2, §53)
  isShared?:       boolean                — `@shared` modifier (§37.4)
  initExpr?:       ExprNode              — Shape 1/3 RHS
ReactiveDebouncedDeclNode     — `kind: "reactive-debounced-decl"`; `{ name; delay: number; initExpr? }`.
ReactiveNestedAssignNode      — `kind: "reactive-nested-assign"`; `{ target; path: string[]; valueExpr? }`.
ReactiveArrayMutationNode     — `kind: "reactive-array-mutation"`; `{ target; method; args: string }`.
ReactiveExplicitSetNode       — `kind: "reactive-explicit-set"`; `{ args: string }` escape hatch.
StateNode                     — `kind: "state"`; state instantiation (`< statetype attrs>children</>`)
StateConstructorDefNode       — `kind: "state-constructor-def"`; typed attr declarations.
FunctionDeclNode              — `kind: "function-decl"`; `{ name; params; body; fnKind; isServer; isGenerator?; canFail; errorType?; route?; method?; isHandleEscapeHatch? }`.
ComponentDefNode              — `kind: "component-def"`; `{ name; raw }`.

### Logic structure
LogicNode                     — `kind: "logic"`; contains `body`, `imports`, `exports`, `typeDecls`, `components`.
ImportDeclNode                — `kind: "import-decl"`; `{ raw; names; specifiers?; source; isDefault }`.
ImportSpecifier               — `{ imported; local; pinned: boolean }` — per-item specifier (B4 pinned modifier).
UseDeclNode                   — `kind: "use-decl"`; `{ raw; names; source }`.
ExportDeclNode                — `kind: "export-decl"`; `{ raw; exportedName; exportKind; reExportSource; isPure?; isServer? }`.
TypeDeclNode                  — `kind: "type-decl"`; `{ name; typeKind; raw }`.

### Control flow
IfStmtNode                    — `kind: "if-stmt"`; `{ condExpr?; consequent; alternate }`.
IfExprNode                    — `kind: "if-expr"`; same shape (if-as-expression).
ForExprNode                   — `kind: "for-expr"`; `{ variable; iterExpr?; body }`.
MatchExprNode                 — `kind: "match-expr"`; `{ headerExpr?; body }`.
ForStmtNode                   — `kind: "for-stmt"`; `{ variable; iterExpr?; body; cStyleParts? }`.
WhileStmtNode                 — `kind: "while-stmt"`; `{ condExpr?; body }`.
ReturnStmtNode                — `kind: "return-stmt"`; `{ exprNode? }`.
ThrowStmtNode                 — `kind: "throw-stmt"`; `{ exprNode? }`.
SwitchStmtNode                — `kind: "switch-stmt"`; `{ headerExpr?; body }`.
TryStmtNode                   — `kind: "try-stmt"`; `{ header; body; catchNode?; finallyNode? }`.
MatchStmtNode                 — `kind: "match-stmt"`; `{ headerExpr?; body }`.
MatchArmInlineNode            — `kind: "match-arm-inline"`; `{ test; binding?; result; resultExpr? }` — Form 1b (B20 payload-binding parser added S69).

### Effects + expressions
BareExprNode                  — `kind: "bare-expr"`; `{ exprNode? }` (deprecated `expr?` removed from TS surface S40).
HtmlFragmentNode              — `kind: "html-fragment"`; `{ content: string }`.
LiftExprNode                  — `kind: "lift-expr"`; `{ expr: LiftTarget }`.
FailExprNode                  — `kind: "fail-expr"`; `{ enumType; variant; args }`.
PropagateExprNode             — `kind: "propagate-expr"`; `{ binding: string | null; exprNode? }`.
GuardedExprNode               — `kind: "guarded-expr"`; `{ guardedNode; arms: ErrorArm[] }`.
ErrorEffectNode               — `kind: "error-effect"`; `{ arms: ErrorArm[] }`.
ErrorArm                      — `{ pattern; binding; handler; handlerExpr?; span }`.
MetaNode                      — `kind: "meta"`; `{ body; parentContext }`.
SQLNode                       — `kind: "sql"`; `{ query; chainedCalls; nobatch? }`.
TransactionBlockNode          — `kind: "transaction-block"`; `{ body }`.
CleanupRegistrationNode       — `kind: "cleanup-registration"`; `{ callback; callbackExpr? }`.
WhenEffectNode                — `kind: "when-effect"`; `{ dependencies; bodyRaw; bodyExpr? }`.
WhenMessageNode               — `kind: "when-message"`; `{ binding; bodyRaw; bodyExpr? }` (§4.12.4 worker).
UploadCallNode                — `kind: "upload-call"`; `{ file; fileExpr?; url; urlExpr? }`.
DebounceCallNode              — `kind: "debounce-call"`; `{ fn; fnExpr?; delay }`.
ThrottleCallNode              — `kind: "throttle-call"`; `{ fn; fnExpr?; delay }`.

### Validator types (Phase A1b B9-B10)
ValidatorEntry                — `{ name: string; args: ValidatorArg[] | null; span: Span; inlineOverride?: string | null }`.
  args null     = bareword form (`<x req>`).
  args []       = zero-arg call (`<x req()>`).
  args [...]    = parsed args; element is ExprNode or RelationalPredicateNode.
  inlineOverride: set by B13 walker (`walkRejectDerivedWithValidatorsAndExtractOverride` in symbol-table.ts).
ValidatorArg (union)          — `ExprNode | RelationalPredicateNode`.
RelationalPredicateNode       — NOT in ExprNode union; `kind: "relational-predicate"`; `{ span: ExprSpan; op: ">=" | "<=" | "<" | ">" | "=" | "!="; value: ExprNode }`.
  Used only for `length(>=N)` form per §55.1.
  dep-graph walker `forEachIdentInExprNode` special-cases this kind.

### ExprNode union (`compiler/src/types/ast.ts` lines ~1700+)
IdentExpr            — `kind: "ident"`; `{ name }` (includes `@name` for reactive refs, `"~"` for pipeline).
LitExpr              — `kind: "lit"`; `{ raw; value; litType }` (litType: number|string|template|bool|null|undefined|not).
ArrayExpr            — `kind: "array"`; `{ elements: (ExprNode | SpreadExpr)[] }`.
ObjectExpr           — `kind: "object"`; `{ props: ObjectProp[] }`.
SpreadExpr           — `kind: "spread"`; `{ argument: ExprNode }`.
UnaryExpr            — `kind: "unary"`; `{ op; argument; prefix }`.
BinaryExpr           — `kind: "binary"`; `{ op; left; right }` — includes scrml-specific `is`, `is-not`, `is-some`, `is-not-not`.
AssignExpr           — `kind: "assign"`; `{ op; target; value }`.
TernaryExpr          — `kind: "ternary"`; `{ condition; consequent; alternate }`.
MemberExpr           — `kind: "member"`; `{ object; property: string; optional }`.
IndexExpr            — `kind: "index"`; `{ object; index; optional }`.
CallExpr             — `kind: "call"`; `{ callee; args; optional }`.
NewExpr              — `kind: "new"`; `{ callee; args }`.
LambdaExpr           — `kind: "lambda"`; `{ params: LambdaParam[]; body; isAsync; fnStyle }`.
CastExpr             — `kind: "cast"`; `{ expression; targetType: string }`.
MatchExpr            — `kind: "match-expr"`; `{ subject; rawArms: string[] }` (inline match value-return form).
SqlRefExpr           — `kind: "sql-ref"`; `{ nodeId: number }`.
InputStateRefExpr    — `kind: "input-state-ref"`; `{ name }`.
EscapeHatchExpr      — `kind: "escape-hatch"`; `{ estreeType; raw }` (fallback for unmapped ESTree nodes).
ResetExpr            — `kind: "reset-expr"`; `{ target: ExprNode; diagnostic? }` — language-level `reset(@cell)` keyword (§6.8.2, L18, A1a Step 9).

### File-level types
FileAST               — `{ filePath; nodes; imports; exports; components; typeDecls; channelDecls?; spans; hasProgramRoot; authConfig; middlewareConfig }`.
TABOutput             — `{ filePath; ast: FileAST; errors: TABErrorInfo[] }`.
TABErrorInfo          — `{ code; message; tabSpan: Span; severity? }`.
AuthConfig            — `{ auth; loginRedirect; csrf; sessionExpiry }`.
MiddlewareConfig      — `{ cors; log; csrf; ratelimit; headers }`.

### Symbol Table types — `compiler/src/symbol-table.ts`
Scope                 — per-scope registry; `{ kind: ScopeKind; stateCells: Map<string, StateCellRecord>; importBindings: Map<string, ImportBindingRecord>; parent? }`.
ScopeKind             — `"file" | "function" | "compound" | "engine" | "component" | "field"` (B12 adds "field").
StateCellRecord       — back-pointer on each registered `state-decl` node.
ImportBindingRecord   — `{ localName; exportedName; sourcePath; pinned: boolean; ... }`.

### validator-catalog types — `compiler/src/validator-catalog.ts`
PredicateArgKind      — union: `relational-predicate | numeric | regex | comparable-with-cell | any-equatable-with-cell | array-of-cell-type | inline-message-override`.
CellTypeRequirement   — `"any" | "string" | "number" | "array" | ...`.
PredicateSignature    — `{ name; arity; argKinds: PredicateArgKind[] | null; applicableTo: CellTypeRequirement }`.
UNIVERSAL_CORE_PREDICATES — readonly array of 14 PredicateSignature entries per §55.1: req, is some, length, min, max, gt, lt, gte, lte, pattern, oneOf, notIn, eq, neq.

### multi-statement-scan types — `compiler/src/multi-statement-scan.ts`
SemicolonHit          — `{ offset: number }` — top-level semicolon position result.

### derived-mutation-ops exports — `compiler/src/derived-mutation-ops.ts`
ARRAY_MUTATING_METHODS    — ReadonlySet of 9 method names (push/pop/shift/unshift/splice/reverse/sort/fill/copyWithin).
COMPOUND_ASSIGNMENT_OPS   — ReadonlySet of 14 compound-assignment operators.
isDerivedMutatingAssignOp(op) → boolean.
isArrayMutatingMethod(name)   → boolean.

### engine-statechild-parser types — `compiler/src/engine-statechild-parser.ts`
EngineStateChildEntry — state-child entry extracted from `engine-decl.rulesRaw`; carries `tag`, `ruleForm?`, `bodyRaw`, `isLegacy`, `span`.
EngineRuleForm        — union of §51.0.F target-only forms: single variant, multi-variant `(A | B)`, etc.

## Non-mapped runtime annotations (non-enumerable, stamped by SYM passes)
`_scope`             — Scope back-pointer on scope-introducing AST nodes and FileAST (B1).
`_record`            — StateCellRecord back-pointer on each registered `state-decl` (B1).
`_resolvedStateCell` — StateCellRecord | null on IdentExpr nodes for `@name` reads (B3).
`_cellKind`          — "plain" | "bindable" | "markup-typed" | "compound-parent" (B5).
`_isBindable`        — boolean (B5).

## Tags
#scrmlTS #map #schema #ast #types #exprnode #validator-arg #relational-predicate #synth-surface #reset-expr #engine-statechild #multi-statement-scan #derived-mutation-ops #s67 #s68 #s69 #a1b-complete

## Links
- [primary.map.md](./primary.map.md)
- [domain.map.md](./domain.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
