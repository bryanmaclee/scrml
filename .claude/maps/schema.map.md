# schema.map.md
# project: scrmlts
# updated: 2026-06-24  commit: 162564f3

Authoritative AST type source: `compiler/src/types/ast.ts` (~2054L, TypeScript).
IR types: `compiler/src/codegen/ir.ts` (253 lines).
Type-system internals: `compiler/src/type-system.ts` (~20232L — internal interfaces, not exported).
Symbol-table exports: `compiler/src/symbol-table.ts` (11280L — `MessageArmEntry`, `PayloadBinding`, `EngineStateChildEntry`).
Enum-subset shared recognizer: `compiler/src/enum-subset-refinement.ts` (143L — `EnumSubsetParse`, `parseEnumSubsetAnnotation`).

> **S174 — no new AST shapes.** The location-transparent `log()` builtin (§20.6) + the `any`-reject
> hard line (`E-TYPE-ANY-FORBIDDEN`, §14.1.1) add NO new FileAST node types. `log(...)` is recognized
> at codegen by callee-name (`emit-expr.ts`, an `IdentExpr`-callee `CallExpr` named `log`); the two new
> diagnostics (`W-LOG-SHADOWED`, `E-TYPE-ANY-FORBIDDEN`) are decl-site/use-site scans over EXISTING
> nodes (function-decl `name === "log"`; raw `typeAnnotation`/field-type strings). The only S174 type is
> the codegen-internal `LogLocSpan` interface in `log-loc.ts` (`{ filePath?, start?, line? }`) — a
> resolver input, not a FileAST shape. Likewise S173 (`E-EXPORT-001`, `W-TYPE-FN-FIELD`) added no shapes.
>
> **S175 — no new FileAST shapes either.** The typed-SQL-row arc (§14.8.7/§14.8.8) + the function-boundary
> rule (§14.3) scan EXISTING nodes + raw SQL/type text. NEW type-system-internal types (NOT FileAST):
> `FunctionType` (now a DISTINGUISHABLE `ResolvedType` kind via `tFunction()`, not opaque `asIs` — what makes
> the `E-STRUCT-FUNCTION-FIELD` reject precise) + the `<fn-return>` over-approximation sentinel
> (`FN_RETURN_TYPE_NAME`). NEW extractor I/O types in `sql-projection.ts` (`ProjectedColumn`/`SelectProjection`)
> and the existing `ColumnDef` gains a 3rd source (F-SCHEMA-001 `<schema>` DDL). The S173 `W-TYPE-FN-FIELD`
> Info-nudge was ESCALATED to the hard `E-STRUCT-FUNCTION-FIELD` Error (same `checkFunctionTypedStructFields` walk).
>
> **S177 — ONE new walkable AST field, no new node TYPES.** The g-formfor arc adds `match-block.armBodyChildren?: ASTNode[]` — a walkable per-arm body markup AST that ast-builder re-parses from `armsRaw` (Phase 2, `buildMatchArmBodyChildren` ast-builder.js:12128) ALONGSIDE the existing raw `armsRaw` text. It exists so the markup-EXPANSION passes (component-expander `walkAndExpand`, the type-system formFor/tableFor `walkAndSplice` walkers) can descend into `<match>` arm bodies the SAME way they descend into an engine-decl `bodyChildren` (`<formFor>`/`<tableFor>`/`<Component>` inside an arm were previously emitted RAW — silent non-render). Each wrapper carries a companion `_matchArmBodyForm` tag. Both are LIVE-pipeline-only fields (within-node-classifier STRIP_KEYS += `armBodyChildren`/`_matchArmBodyForm`, no native analogue). Codegen consumes them via the `armBodyChildren`-wrapper lookup in `buildMatchArms` (emit-match.ts:676-694) when an arm body hosts a formFor/component; plain + each-bearing arms keep the `armsRaw` re-parse path. r28-7b/r27-c6/bug-4/bug-48/bug-74/s169 add NO AST shapes (parser/codegen/type-flow fixes over existing nodes).
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

### ForeignBlock  [compiler/src/ast-builder.js:15896 — NEW S218 dpa-003]
kind: "foreign"; level: number; lang: string|null; raw: string; body: string; crossings: string[]; span: Span
**dpa-003 (S218) note:** The FIRST producer is `buildBlock case "foreign"` in ast-builder.js (~:15896). Emitted when Block Splitter recognizes a `_=*{ … }=*` opaque context (SPEC §23.2.2). Fields: `level` = count of `=` markers in the opener (`_{}`=0, `_={}`=1, …); `lang` = null at parse time, resolved downstream from the enclosing `<program lang=>` attribute by `checkForeignBlocks` (type-system.ts ~:18614); `raw` = verbatim interior (incl. optional header); `body` = verbatim foreign code (header stripped — what codegen splices); `crossings` = the `in:{ name, name }` named values that cross IN (NO free lexical capture). **NOT in FileAST types/ast.ts** — a live-pipeline-only node shape produced by ast-builder.js and consumed by emit-logic.ts (`case "foreign"` ~:2749) + route-inference.ts (server escalation) + type-system.ts (`checkForeignBlocks`). **Stamp pattern:** `foreignNode` is ATTACHED onto the enclosing decl/return node rather than appearing standalone: `let-decl.foreignNode`, `const-decl.foreignNode`, `return-stmt.foreignNode` (ast-builder.js ~:6947/:7054/:7705); emit-logic.ts routes through `case "foreign"` when `node.foreignNode?.kind === "foreign"`. A bare standalone `kind:"foreign"` statement (not bound, not returned) triggers E-FOREIGN-004 (type-system.ts). BLOCKREF_TYPES += `"foreign"` in tokenizer.ts (~:1166) so the block-ref placeholder is emitted for the logic token stream.

---

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
**S157 Bug 71 addition:** `matchExpr?: any` — structural match-expr side-field for derived `const <x> = match @cell { ... }` reactive cells; set by ast-builder.js dual-parse hook; used by the typer's exhaustiveness pass (`checkMatchDiagnostics`); ignored by codegen (the `init`/`initExpr` reactive emit path is unchanged).
**S168 cycles-prereq:** the sibling `ReactiveNestedAssignNode.path` was widened `string[]` → `(string | { index?: ExprNode; raw?: string })[]` for computed bracket-index COW path segments (ast.ts:769); **S170 Bug B** stamps the codegen-internal `_deepSetLeafKey`/`_deepSetResidualPath` on `ReactiveNestedAssignNode` (not declared in ast.ts — stamped by reactive-deps.ts at runCG).

### FunctionDeclNode extends BaseNode
kind: "function-decl"; name: string; params: FunctionParam[]; returnType?: string; body: LogicStatement[]; modifier: "fn"|"server"|"pure"|"function"|null; errorType?: string; ... +5 more fields
**S174 note:** a function-decl with `name === "log"` is the shadow target for `W-LOG-SHADOWED` (`checkLogShadowing` matches `FN_KINDS` = function-decl/fn-decl/function/fn). No new field — the check reads the existing `kind`/`name`.

### ComponentDefNode extends BaseNode
kind: "component-def"; name: string; props: TypedAttrDecl[]; body: ASTNode[]

### EngineDeclNode extends BaseNode
kind: "engine-decl"; name: string; stateChildren: ASTNode[]; initial?: string; derived?: ExprNode; ... +8 more fields
**S154 addition:** `acceptsType?: string | null` — raw enum-type identifier from `accepts=MsgType` engine-opener attribute (§51.0.S.2.2); recorded verbatim by parser (batch 1); resolved by SYM PASS 11 typer (batch 2); non-resolution fires `E-ENGINE-ACCEPTS-NOT-ENUM`.
**S172 addition:** `inlineMatchArmArrows?: { glyph, srcOffset }[]` — per-arm separator-glyph stamp for the `derived=match` raw-text body (no structured arm nodes); consumed by W-MATCH-ARROW-LEGACY + `migrate --fix`.

### TypeDeclNode extends BaseNode
kind: "type-decl"; name: string; typeKind: "struct"|"enum"|"alias"; body: string
**S173/S174/S175 note:** the raw `body` field-clause text is the scan input for `E-STRUCT-FUNCTION-FIELD` (S175, function-typed fields → `checkFunctionTypedStructFields`; ESCALATED from the S173 `W-TYPE-FN-FIELD` Info-nudge to a hard reject) and `E-TYPE-ANY-FORBIDDEN` (S174, `any`-token fields → `checkAnyTypeForbidden` `scanStructBodyRaw`). Both are raw-text scans; neither adds a field. (S175 also resolves a function-typed field to a distinguishable `FunctionType` via `resolveTypeExpr`, not `asIs`.)

### ChannelDeclNode extends MarkupNode
kind: "markup"; tag: "channel"; name: string; isExported: boolean; ... extends MarkupNode

### ImportDeclNode extends BaseNode
kind: "import-decl"; specifiers: ImportSpecifier[]; source: string; importKind: "value"|"type"|"side-effect"

### ExportDeclNode extends BaseNode
kind: "export-decl"; raw: string; exportedName: string|null; exportKind: string|null; reExportSource: string|null; isPure?: boolean; isServer?: boolean
**S173 note:** `E-EXPORT-001` rejects an export naming a reactive STATE CELL — the MOD-stage check cross-references `file.ast.exports` (these nodes) against `collectStateCellNames(fileAST)` (`kind:"state-decl"` bindings) in module-resolver.js `buildImportGraph`. No new field.

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
| armArrow | `":>"` \| `"=>"` \| `"->"` \| undefined | The arm separator glyph as written in source; set by `matchArrowGlyphAt()` at parse time; used by W-MATCH-ARROW-LEGACY emission in type-system.ts and by `rewriteMatchArmArrows()` in migrate.js. **Sibling raw-text stamp (S172):** the `derived=match` engine-decl locus has NO structured arm nodes (body is raw text), so its arm glyphs ride on `engine-decl.inlineMatchArmArrows[]` — `{ glyph, srcOffset }` per arm, stamped by ast-builder.js `scanInlineMatchArmArrows()` (~L1726), consumed by the SAME W-MATCH-ARROW-LEGACY lint + `migrate --fix` |

`->` arms are now STRUCTURED (were bare-expr). `->` stays as two PUNCT tokens at the lexer
level to protect the `fn ... -> ReturnType` return-arrow path.

---

## Expression Node Types  [compiler/src/types/ast.ts:1577+]

### ExprNode (union)
IdentExpr | LitExpr | ArrayExpr | ObjectExpr | UnaryExpr | BinaryExpr | AssignExpr | TernaryExpr |
MemberExpr | IndexExpr | CallExpr | NewExpr | LambdaExpr | CastExpr | MatchExpr | SqlRefExpr |
InputStateRefExpr | EscapeHatchExpr | ResetExpr | HtmlFragmentNode | LiftExprNode | FailExprNode |
PropagateExprNode | GuardedExprNode | MapLitExpr

Key expression shapes:
- PropagateExprNode: kind: "propagate-expr"; inner: ExprNode  (the `?` operator)
- GuardedExprNode: kind: "guarded-expr"; body: LogicStatement[]  (`!{}` form)
- FailExprNode: kind: "fail-expr"; enumType: string; variant: string; data?: ExprNode
- MapLitExpr: kind: "map-lit"; span; entries: MapEntry[]; diagnostics?: {code,message}[]  (§59.3 value-native map literal `[k: v, …]` / `[:]` empty; S169) [ast.ts:1925]
- MapEntry: key: ExprNode; value: ExprNode  (one `key: value` pair; source order; last-wins on dup) [ast.ts:1898]
- CallExpr named `log`: NOT a distinct node — an `IdentExpr`-callee `CallExpr` whose `callee.name === "log"`; emit-expr.ts (~L1630) recognizes it for the §20.6 `log()` builtin lowering (S174). No new union member.

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

### LogLocSpan  [compiler/src/codegen/log-loc.ts:32 — NEW S174, codegen-internal]
filePath?: string; start?: number; line?: number — input to `resolveLogLoc(span)` (→ "basename:line").
A resolver helper type for the `log()` builtin's compile-time `file:line` origin tag; NOT a FileAST node.
The byte `start` offset is authoritative (the call node's `span.line` is unreliable post-re-parse).

---

## CGError  [compiler/src/codegen/errors.ts]

code: string; message: string; span: CGSpan | object; severity: 'error' | 'warning' | 'info'

W-/I- prefix + severity:warning/info → result.warnings (non-fatal).
Everything else → result.errors (CLI exits 1).

---

## Protect-Analyzer PA Types  [compiler/src/protect-analyzer.ts]

### ColumnDef (exported)  [protect-analyzer.ts:72]
name: string; sqlType: string; nullable: boolean; isPrimaryKey: boolean

**S175 F-SCHEMA-001 note:** `ColumnDef[]` now has a THIRD source — `extractSchemaCreateTableStatements` (protect-analyzer.ts:471) synthesizes CREATE TABLE DDL from `<schema>` blocks (after (1) the live DB file and (2) the schema-differ; `generateCreateTable` is now exported from schema-differ.js). Feeds the typed-SQL-row generated-table resolution (§39/§14.8).

### TableTypeView (exported)
tableName: string; fullSchema: ColumnDef[]; clientSchema: ColumnDef[]; protectedFields: Set<string>

### DBTypeViews (exported)
stateBlockId: string; dbPath: string; tables: Map<string, TableTypeView>

### ProtectAnalysis (exported)
views: Map<string, DBTypeViews>

## SQL-Projection Extractor Types  [compiler/src/sql-projection.ts — NEW S175]

### ProjectedColumn (exported)  [sql-projection.ts:28]
name: string; sourceTable?: string (the `t` in `t.col`); alias?: string (the `AS` name)

### SelectProjection (exported)  [sql-projection.ts:47]
columns: ProjectedColumn[]; fromAliasMap: Map<string,string> (FROM/JOIN alias → table); plus degradation flags for the deferred long tail (`*` / CTE / UNION / subquery-in-FROM → under-determined → `asIs` + W-SQL-ROW-UNTYPED downstream)

> Consumed by `resolveSqlRowType` (type-system.ts:5676) to build the typed projection-row `StructType` joined against the generated table types. Pure extractor — no FileAST coupling.

---

## Type-System Internal Types  [compiler/src/type-system.ts — selected]

ResolvedType (union): PrimitiveType | StructType | EnumType | ArrayType | UnionType | AsIsType |
  UnknownType | NotType | SnippetType | StateType | ErrorType | HtmlElementType |
  CssClassType | FunctionType | MetaSpliceType | RefBindingType | PredicatedType | MachineType | MapType

> **S174 `any` note:** there is NO `AnyType` member in `ResolvedType` — `any` is not a scrml type. An
> `any`-token annotation currently falls through `resolveTypeExpr`'s unresolvable path to `AsIsType`/
> `UnknownType` silently; `checkAnyTypeForbidden` (type-system.ts:3720) catches the LITERAL `any` token
> BEFORE that collapse via a raw-text scan (`typeTextMentionsAnyToken`, :3678) and fires
> `E-TYPE-ANY-FORBIDDEN`. The sanctioned escape hatch is `AsIsType` (the named `asIs` opt-out).

> **S175 `FunctionType` note:** a function-typed annotation (`(...) -> Ret`, `fn()`) now resolves to a
> DISTINGUISHABLE `FunctionType` (kind: "function"; type-system.ts:324) via `tFunction()` (:830) +
> the `resolveTypeExpr` fn-type branch (:2400, gated by `isFunctionTypeAnnotation` :2087) — NOT a fall-through
> to `AsIsType`. This is what makes the `E-STRUCT-FUNCTION-FIELD` reject (§14.3/§15.11) fire precisely on a
> function-typed struct field. S175 also adds the `<fn-return>` over-approximation sentinel
> (`FN_RETURN_TYPE_NAME` :631) stamped on an inferred object-literal/SQL-row server-fn return
> (`inferReturnTypeFromBody` :5917); these inferred types are EXEMPT from the SQL-row contract reject.

### MapType  [compiler/src/type-system.ts:227]
kind: "map"; key: ResolvedType; value: ResolvedType; ordered: boolean
**S169 (§59 value-native maps):** built by `tMap(key, value, ordered)` [type-system.ts:622]; recognized from a `[K: V]` annotation by `resolveTypeExpr` via `findMapEntryColon` [type-system.ts:2129] + the `@ordered` postfix affix. Key §45-comparability enforced by `classifyMapKey`/`checkMapKeyComparability` (→ `E-MAP-KEY-NOT-COMPARABLE`/`E-MAP-KEY-IS-MAP`/`E-EQ-003`). `@m[k] = v` bracket-write gated by `E-MAP-BRACKET-WRITE`.

### PredicatedType  [compiler/src/type-system.ts:332]
kind: "predicated"; baseType: string; predicate: PredicateExpr
**S156 (d)-A addition:** `subsetVariants?: Set<string>` — materialized positive IN-SET for `Enum oneOf([.A,.B])` / `notIn([...])` refinements (§53.15.1); `notIn` is already complemented to `base \ excluded`; used by match exhaustiveness narrowing (§18.8.1 / §18.0.1) + emit-predicates.ts `.includes()` codegen + emit-schema-for.ts `CHECK IN` DDL.

### PredicateExpr (kind union — local mirror in emit-predicates.ts)
"comparison" | "property" | "named-shape" | "and" | "or" | "not" | "error" | **"variant-set"**
**S156 (d)-A addition:** `kind: "variant-set"` — enum-subset boundary check; fields: `variantMode?: "oneOf"|"notIn"`, `variants?: string[]` (resolved IN-SET). Lowered to `(["A","B"].includes(v))` by `predicateToJsExpr()`.

MachineType: states: Map<string, VariantDef>; initial: string; derived?: ResolvedType; ... +5 more fields
**S155 addition:** MachineType carries `cellMessageEnums?: Map<string, string>` — maps engine var name → the `acceptsType` enum name for `.advance` two-plane resolution (§51.0.G.1); threaded through `annotateNodes` so markup event-handler attr checking (Bug 63 S157) can gate on whether a `.advance` arg belongs to the message plane.

LinState: "unconsumed" | "consumed"
TildeState: "uninitialized" | "initialized"

---

## Emit-Each Internal Types  [compiler/src/codegen/emit-each.ts — S156-S159]

### EachEngineCtx  [emit-each.ts:73]
engineRewriteCtx: EngineRewriteCtx | null — for assign form (`@engine = .X`); passed to `rewriteBlockBody`
engineExprCtxExtras: Record<string, unknown> — for advance form (`.advance(.X)`); spread into `emitExprField` ctx
engineVarNames: Set<string> | null — cheap gate before parse/write-guard routing; null when no engines in file

Built once per file by `buildEachEngineCtx(fileAST)` at the top of `emitEachBodyRenderForFile`.
Exported; re-used by emit-lift.js `buildLiftEngineCtx`/`buildLiftEngineCtxFromExtras` (Bug 65, S157).

### EachReconcileCtx  [emit-each.ts:961]
mountVar: string — the `_scrml_reconcile_list` container var (the `_scrml_resolve_item` target)
keyVar: string — the per-item create-time key local (captured as `item?.id != null ? item.id : _scrml_idx`)
iterVar: string — the iteration variable name (matched by `maybeWrapEachPerItemEffect` and `maybeWrapEachPerItemHandler`)

**S158 (Bug 64/R28-1c):** Module-level stack `_eachReconcileCtxStack: EachReconcileCtx[]`. `pushEachReconcileCtx` is called inside `emitEachReconcileLines` after the `_scrml_reconcile_list(...)` call; `popEachReconcileCtx` after the createFn body. Sibling shape in emit-lift.js: `_scrml_lift_reconcile_ctx_stack` with `pushLiftReconcileCtx`/`popLiftReconcileCtx`.

**S159 (Bug 73):** The same `EachReconcileCtx` (read via `currentEachReconcileCtx()`) is also checked by `maybeWrapEachPerItemHandler` / `iterScopeReferencedInHandler` to decide whether to prepend the fire-time resolver prelude inside per-item event handler bodies. The Tier-0 sibling reads the Tier-0 stack via `currentLiftReconcileCtx()`.

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
#scrmlts #map #schema #ast #types #compiler #ir #protect-analyzer #match-arm #enum-subset #message-dispatch #predicated-type #each-reconcile-ctx #each-engine-ctx #s154 #s155 #s156 #s157 #s158 #s159 #s169 #s170 #value-native-maps #map-type #map-lit #bug64 #bug71 #bug73 #r28-1c #s172 #s173 #s174 #log-loc #logloc-span #no-any-hard-line #no-anytype #export-decl #s175 #function-type #fn-return-sentinel #e-struct-function-field #typed-sql-row #sql-projection #projected-column #select-projection #f-schema-001 #column-def #width-subtyping #s177 #arm-body-children #match-arm-body-form #g-formfor #walkable-arm-body #s218 #dpa-003 #foreignblock #foreign-node #foreign-code #inline-foreign #blockref-types-foreign #_-opaque-brace #e-foreign-003 #e-foreign-004 #e-foreign-005 #check-foreign-blocks #foreign-server-escalation

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [error.map.md](./error.map.md)
