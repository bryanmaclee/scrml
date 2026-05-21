# schema.map.md
# project: scrmlts
# updated: 2026-05-21T09:04:37-06:00  commit: 092fa90a

This is a compiler. There is no database schema or external API schema.
The "schemas" below are the compiler's internal data structures: the AST node
union, the codegen IR, the symbol table, the auth-graph / reachability types,
the native-parser's Expr + Stmt ASTs, the engine catalog, and the markup-layer
state-shape (TagFrame / BodyMode / DisplayTextLiteral).
scrml *source files* (`.scrml`) declare their own data via `<schema>` blocks,
struct/enum `<Type>` declarations, and `schemaFor()` — that is runtime DDL the
compiler emits, not a schema of this codebase.

## AST Node Types — live pipeline  [compiler/src/types/ast.ts — 1927 lines]

Discriminated union; every node has `kind` (string literal), `id`, `span`.
`ASTNode` (line 1381) is the top-level union; `LogicStatement` (1332) the
statement sub-union. UNCHANGED since commit 78faa65; verified at 092fa90a.

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

## Native-Parser Expr AST  [compiler/native-parser/ast-expr.{scrml,js}]

The expression-AST catalog the scrml-native parser produces. SEPARATE from the
live ast.ts union above — consumed only by native-parser tests, not the pipeline.

### ExprKind  [ast-expr.js:5 — Object.freeze enum, 39 variants at HEAD]
Primary literals:   Ident · NumberLit · StringLit · BoolLit · RegexLit · TemplateLit
scrml extensions (M1): AtCell · BareVariant
Keyword atoms (M2.3): This · Super
Composite:          Array · Object · Paren
Operators (M2.2):   Unary · Update · Binary · Logical · Assignment · Conditional · Sequence
Call/member (M2.3): Call · New · Member · TaggedTemplate · Arrow · Function
Pattern/body-stub:  RestElement · AssignmentPattern · BlockStub
scrml-extension exprs (M2.4 — D5 MUST ADD, 9 forms):
                    NotValue · Tilde · Sql · InputStateRef · IsCheck · Match ·
                    Render · Lift · Fail
Async / generator (M4.1 — D5 MUST PARSE; promoted from M3.3 statement-position-only):
                    Await · Yield
Markup-as-value (MK4 — S114 NEW): MarkupValue (markup expression in JS context;
                    `const card = <div/>`, `renders <p>...</p>`, `lift <wrapper>...</wrapper>`)

### Sub-kind enums
ArrayElementKind   [ast-expr.js:70] = Item · Spread · Hole
ObjectPropertyKind [ast-expr.js:76] = KeyValue · Shorthand · Spread · Method
IsCheckOp          [ast-expr.js:89] = Not · Some · Given · NotNot · Variant (§42 / §18.17)
MatchArmPatternKind [ast-expr.js ~97] = Variant · Wildcard · IsPattern (§18.2)

### Node constructors  [ast-expr.js — `make*` pure constructors]
makeIdent · makeNumberLit · makeStringLit · makeBoolLit · makeRegexLit ·
makeTemplateLit · makeTemplateQuasi · makeAtCell · makeBareVariant · makeThis ·
makeSuper · makeArray · makeObject · makeParen · makeArrayItem · makeArraySpread ·
makeArrayHole · makeObjectKeyValue · makeObjectShorthand · makeObjectSpread ·
makeObjectMethod · makeUnary · makeUpdate · makeBinary · makeLogical ·
makeAssignment · makeConditional · makeSequence · makeCall · makeNew · makeMember ·
makeArrow · makeFunction · makeTaggedTemplate · makeRestElement ·
makeAssignmentPattern · makeBlockStub · (M2.4) makeNotValue · makeTilde · makeSql ·
makeInputStateRef · makeIsCheck · makeMatch · makeMatchArm · makeRender · makeLift ·
makeFail · (M4.1) makeAwait · makeYield · (MK4) makeMarkupValue · isExpr (predicate)

## Native-Parser Stmt AST  [compiler/native-parser/ast-stmt.{scrml,js}]

NEW at S113 (M3). Statement-level AST catalog; consumed by `parse-stmt`.

### StmtKind  [ast-stmt.js:17 — Object.freeze enum]
M3.1 (substrate):       Block · ExprStmt · Empty · VarDecl
M3.2 (control-flow):    If · While · DoWhile · For · ForIn · ForOf · Return ·
                        Break · Continue · Labeled
M3.3 (decl + module + legacy try/throw):
                        FunctionDecl · ClassDecl · Import · Export · Try · Throw

### Sub-kind enums
VarDeclKind         [46]   = Let · Const · Var
ClassMemberKind     [60]   = Method · Property (ESTree MethodDefinition / PropertyDefinition)
MethodKind          [67]   = Constructor · Method · Get · Set
ImportSpecifierKind [79]   = Named · Default · Namespace
BindingKind         [94]   = Ident · ObjectPat · ArrayPat   (M3.1 real binding patterns;
                            M4.2 = K6 unified: parseParamTarget now builds REAL
                            ObjectPattern/ArrayPattern; the M3.1 literal stand-ins retired)
BindingPropertyKind [104]  — object-destructuring property discriminator
BindingElementKind  [114]  — array-destructuring element discriminator

### Node constructors  [ast-stmt.js — `make*` pure constructors]
makeBlock · makeExprStmt · makeEmpty · makeVarDecl · makeVarDeclarator ·
makeIf · makeWhile · makeDoWhile · makeFor · makeForIn · makeForOf ·
makeReturn · makeBreak · makeContinue · makeLabeled ·
makeFunctionDecl · makeClassDecl · makeImport · makeExport · makeTry · makeThrow ·
makeMethodDef · makePropertyDef ·
makeImportNamed · makeImportDefault · makeImportNamespace · makeExportSpecifier ·
makeCatchClause · makeBindingIdent · makeObjectPattern · makeArrayPattern ·
makeAssignmentPattern

## Native-Parser Token catalog  [compiler/native-parser/token.{scrml,js}]

TokenKind     [token.js:5]   — Object.freeze enum, nested-by-category; all JS-subset
                               token kinds (keywords, idents, numerics, punctuation,
                               operators) + scrml extensions + (M1.2) TemplateInterpStart
                               / TemplateInterpEnd + RegexLit token.
                               S114 (K3/K4/K5): +11 compound-assign TokenKinds (PercentAssign /
                               StarStarAssign / BitShiftLeftAssign / BitShiftRightAssign /
                               BitShiftRightUnsignedAssign / BitAndAssign / BitOrAssign /
                               BitXorAssign / LogicalAndAssign / LogicalOrAssign /
                               NullishCoalesceAssign) + OptionalChain + Hash + DoubleColon.
QuoteKind     [token.js:125] — Single · Double · Backtick
JS_KEYWORDS   [token.js:131] — keyword-string → TokenKind lookup table
Constructors: makeToken · makeIdentOrKeyword (own-property guard per K7 fix) · makeEof
Span          [span.js]      — { start, end, line, col } struct; pure-data construction

## Native-Parser Engine declarations (state-shape, Pillar 5b)

All declared as `<engine>` in the `.scrml` canonical; the `.js` shadow carries
the live JS-host mirror. See domain.map.md for the composed-engines architecture.

LexMode      [lex-mode.scrml:112]   — JS-lexer context engine; initial `.InCode`;
  7 state-children: InCode · InTemplateBody · InSingleString · InDoubleString ·
  InLineComment · InBlockComment · InRegexBody. `.InTemplateBody` is a COMPOSITE
  state-child nesting `<engine for=LexMode var=innerLexMode>` (§51.0.Q.1).
BracketStack [bracket-stack.scrml]  — bracket-depth + opener-frame engine; variants
  `.Balanced` / `.OpenAt(depth, opener, span)`; live frame stack in the `.js` shadow.
ErrorRecovery[error-recovery.scrml] — parse-error recovery engine; 3 state-children:
  ParsingNormally · AccumulatingSkipped · ReSynchronized; full rule= matrix.
ParseMode    [parse-mode.scrml:92]  — JS expression/statement context engine; initial
  `.TopLevel`; state-children incl. TopLevel · InExpression · InArrayLiteral ·
  InObjectLiteral · InFunctionBody · InClassBody · InArguments · `.InBlock` (M3).
  `.InObjectLiteral` is COMPOSITE (nests an inner `<engine for=ParseMode var=innerParseMode>`).
BlockContext [block-context.scrml:155] — MARKUP-LAYER context-grid engine; initial
  `.TopLevel`; 10 state-children: TopLevel · InMarkupTag · InLogicEscape · InCss ·
  InSql · InErrorEffect · InMeta · InTest · InForeignCode · plus InProgramBody (§40.8
  `default-logic` body — distinct third mode). `.InMarkupTag` nests a BodyMode engine
  (K1 forward-ref RESOLVED at MK3.1). K9 RESOLVED S114 — circular import with
  parse-ctx broken via delegation-frame.scrml leaf extraction.
TagFrame     [tag-frame.scrml]      — markup `<tag>` tree engine; 3 state-children:
  `.Closed` · `.OpenExpectingChildren(name, kind, depth, span, bodyMode)` ·
  `.OpenSelfClosed(name, kind, span)`. Payload-bearing per the `bracket-stack`
  `.OpenAt` precedent. Carries `TagKind` (Html / Component / ScrmlStructural /
  StateOpener) + `TagClass` payload — the structural registry is §4.15 + §24.4.
BodyMode     [body-mode.scrml]      — markup-tag body mode engine; 2 state-children:
  `.FreeText` · `.CodeDefault` (§4.18.1). Populated via `tag-frame.bodyMode` payload
  at body recognition. Also exports `ProgramBodyMode` enum + `isProgramBodyElementName`
  for the §40.8 `default-logic` third mode (NOT classified by §4.18).
DisplayTextLiteral [display-text-literal.scrml] — display-text literal scanner engine;
  3 state-children: `.Outside` · `.InLiteralText` · `.InInterpolation` (§4.18.3-§4.18.4).
  Literal escape set: `\"` / `\\` / `\${` (NOTE: §4.18.3 says "only two" but §4.18.4
  adds the third — see non-compliance.report.md; native parser implements the correct
  3-escape union).

## Native-Parser Seam layer  [MK4 — NEW S114]

parse-seam.{scrml,js} — DelegationFrame stack surface:
  DelegationFrameKind = MarkupToJS · JSToMarkup
  makeDelegationFrame(kind, openSpan, closeCondition) → DelegationFrame
  pushDelegationFrame / popDelegationFrame — ctx.delegationStack mutation
  topDelegationFrame / delegationDepth / inDelegation — read helpers
  Cross-seam error attribution: `diag.delegationFrame = { kind, openSpan, via }`
    on every diagnostic forwarded across the seam boundary.

delegation-frame.{scrml,js} — leaf module (K9 RESOLVED S114); zero native-parser
  imports. Exports: delegationKinds / closeConditionKinds + makers
  (closeOnBraceDepth / closeOnTagFrameBalanced / closeOnAttrTerminator /
  closeOnShorthandEol) + push / pop / top / depth / inDelegationFrame.

## Native-Parser parse-context object  [compiler/native-parser/parse-ctx.{scrml,js}]

`makeParseContext()` [parse-ctx.js:20] — the shared seam substrate; EXTENDS M1's
`makeLexContext` (adds an AST node sink + a delegation-frame stack).
Helpers: appendNode · nodeCount · appendBlock · makeBlockNode · makeDelegationFrame
· pushDelegationFrame · popDelegationFrame · topDelegationFrame · delegationDepth
· inDelegation. Close-condition constructors: closeOnBraceDepth ·
closeOnTagFrameBalanced · closeOnAttrTerminator · closeOnShorthandEol.

`makeParseStmtContext()` [parse-stmt.js:147] — M3's statement-parser-side context
(token-cursor + diagnostics + `functionDepth` for return-legality tracking +
`inAsync`/`inGenerator` slots for M4.1 await/yield context).

## Native-Parser TagKind / TagClass calc  [compiler/native-parser/tag-frame.{scrml,js}]

TagKind        [tag-frame.js:56]  — opener-classifier enum:
  Html · Component · ScrmlStructural · StateOpener
TagClass       [tag-frame.js:73]  — additional MK2.3 classification axis
TagFrameKind   [tag-frame.js:86]  — internal frame-state discriminator
STRUCTURAL_ELEMENTS [tag-frame.js:121] — §4.15 / §24.4 registry: engine, match, errors,
  onTransition, onTimeout, onIdle, channel, page, auth, ...
tokenizeOpener / recognizeOpener / classifyTag / firstChildElementClass — the
pipeline an `<ident ...>` opener flows through to compute TagKind + TagClass.

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
#scrmlts #map #schema #ast #ir #compiler #types #native-parser #expr-ast #stmt-ast #tag-frame #body-mode #mk4 #seam

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [domain.map.md](./domain.map.md)
- [structure.map.md](./structure.map.md)
