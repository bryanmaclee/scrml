# schema.map.md
# project: scrml
# updated: 2026-09-04T14:07:46Z  commit: 10a4b045
# generated-at: 10a4b045 — **THE SAME SHA AS LINE 3, BY CONSTRUCTION.** At this watermark
# `merge-base HEAD origin/main` == `origin/main` == **`10a4b045`**, and that is the watermark.
# ⛑ **`HEAD` AGREED WITH IT WHEN THESE FIGURES WERE MEASURED AND DOES NOT AGREE NOW, BY CONSTRUCTION —
# stating it the other way would repeat the exact defect this pass filed as N15.** Every measurement
# below was taken with `HEAD` == `10a4b045`; the pass then committed ITSELF onto branch
# `worktree-agent-a0256c43fbd4d5a40`, so `HEAD` is now that commit and is one ahead. That commit is
# `--name-only` **EMPTY** over `compiler/ scripts/ conformance/ stdlib/ lsp/ .github/ package.json`
# (it touches `.claude/maps/` only), so no figure below is affected. **The watermark deliberately
# tracks the merge-base, NOT `HEAD`:** a branch tip is squash-merged onto `main` under a DIFFERENT
# SHA, and stamping one is the S326/S328/S331 orphaned-stamp hazard.
# MAP-STAMP RULE run at WRITE time, all three commands:
# `BASE=$(git merge-base HEAD origin/main)` -> `10a4b045`; `git diff --name-only BASE..HEAD --
# compiler/ scripts/ conformance/ stdlib/ lsp/ .github/ package.json` -> **EMPTY**;
# `git merge-base --is-ancestor 10a4b045 origin/main` -> **exit 0**. Inbound check (invariant 48) also
# run: `git merge-base --is-ancestor 8e278c73 10a4b045` -> **exit 0**.
#
# ━━━━━━━ S397 wrap-6c — **STAMP ADVANCED. `8e278c73` -> `10a4b045`.** ━━━━━━━
#
# **THE WATERMARK AND THE WALKED WINDOW END AT THE SAME COMMIT.** The source delta walked is
# `8e278c73..10a4b045` (10 commits, PRs #825-#834, ONE operator), and `10a4b045` is the merge-base
# AND `origin/main` — unlike S395 (stamp vs unpushed branch tip) and S396 (watermark ahead of the
# last source-bearing commit). ⚠ **This pass's OWN commit then advances `HEAD` past the watermark,
# exactly as every pass's does; see the note above line 14. That is the rule working, not a gap.**
#
# **THE COMPLETE SOURCE DELTA WAS WALKED — the partial-pass rule is SATISFIED, not waived.**
# `git diff --name-only 8e278c73..10a4b045` over `compiler/src` · `compiler/native-parser` ·
# `stdlib` · `scripts` · `lsp` · `conformance` is **FOUR `compiler/src` files and they are all in
# `codegen/`**, every one read in full, plus 8 conformance files (4 NEW cases):
#   · `compiler/src/codegen/emit-logic.ts`  (+371/-63) — **#830** (`8d3c7936`) the §32.2.1 WRITE half
#   · `compiler/src/codegen/emit-expr.ts`   (+166/-16) — **#832** (`c11db440`) the fail-closed `~` floor
#   · `compiler/src/codegen/index.ts`       (+38)      — **#832** the sink's reset + TWO drains
#   · `compiler/src/codegen/log-loc.ts`     (+32)      — **#832** `resolveSpanLineCol` (NEW export)
# `.github/` · `scripts/` · `stdlib/` · `lsp/` · `package.json` · `bun.lock` · `compiler/native-parser/`
# are all `--name-only` **EMPTY**. `compiler/src/types/` EMPTY for the FIFTEENTH window.
# `compiler/SPEC.md` **37,647 -> 37,798 (+151)**; `SPEC-INDEX.md` re-generated.
#
# ⛑ **THE HEADLINE FINDING IS A ROUTER HOLE, AND IT WAS MEASURED BY THREE DISPATCHES FAILING THE SAME
# WAY.** Three separate S397 dispatches working the `~` / §32 surface reported that
# `primary.map.md` gave them **no routing**. A fourth falsified the STRONGER version of that claim:
# `domain.map.md` carries **17** `~`/§32 hits and always did. So the real defect was narrower and
# worse — **the material existed and the ROUTER could not reach it.** `primary.map.md` now carries a
# `~`/§32 Task-Shape Routing row, and it splits the surface into **THREE AXES** because conflating
# two of them cost this session a wrong-locus round. See that row before touching anything `~`.
#
# ⚑ **TWO STANDING TRAPS ON THIS SURFACE, BOTH RE-VERIFIED BY EXECUTION AT THIS WATERMARK:**
#   (1) **`E-TILDE-001` / `E-TILDE-002` CANNOT FIRE.** The `tilde-init` / `tilde-ref` node kinds have
#       **FOUR consumers** in `type-system.ts` (`:18426` comment · `:18435` · `:18744` · `:18750`) and
#       **ZERO producers** anywhere in `compiler/src/` or `compiler/native-parser/` — measured, the
#       grep returns exactly those four lines and nothing else. The apparent producers are hand-built
#       object literals in `compiler/tests/unit/type-system.test.js:1751+`. Any §32 reasoning that
#       assumes enforcement is reasoning about a checker that does not run.
#   (2) **scrml's AST has NO UNIFORM BINDER REPRESENTATION**, and `ast-builder.js` builds most of it
#       with ES6 SHORTHAND so a regex keyed on `field:` cannot see it. Details in schema.map.md.
#
# ⚑ **S397 — A BRIEFED PREMISE WAS FALSIFIED *BY THE WINDOW IT DESCRIBED*, WHICH IS A DIFFERENT
# FAILURE FROM THE S396 ONE TWO BANNERS DOWN (that one was wrong when written; this one WENT wrong).**
# The dispatching brief said SPEC's verbatim INVALID §32 examples "all compile at exit 0". **FALSIFIED BY EXECUTION
# at this watermark:** §32.5's own `${ process(~) }` now compiles to **exit 1** with
# `E-CG-TILDE-UNRESOLVED` at a CORRECT `1:11`. The premise was true at `8e278c73` and #832 changed it.
# What survives is the sharper statement: the code that fires is the CODEGEN floor, not the §32.5
# TYPE-SYSTEM code the SPEC names — so `g-tilde-lin-enforcement-does-not-fire-on-spec-own-examples`
# is now PARTIALLY overtaken and its "ZERO diagnostics" headline is stale for at least that probe.
#
#
# ━━━━━━━ S396 wrap-6c — **STAMP ADVANCED. `ad7b65dc` -> `8e278c73`.** ━━━━━━━
#
# ⚠ **TWO SHAs, AND THE DISTINCTION IS LOAD-BEARING — DO NOT COLLAPSE THEM.** The **SOURCE DELTA**
# this pass walked is `ad7b65dc..2d8dd8cb` (7 commits, 4 changed source files). The **WATERMARK** is
# `8e278c73`, which is further along: `2d8dd8cb..8e278c73` is the wrap commit (#824) and is
# `--name-only` **EMPTY** over `compiler/ scripts/ conformance/ stdlib/ lsp/ .github/ package.json`.
# Every measurement below therefore holds at the watermark unchanged — the stamp is advanced to the
# CURRENT `origin/main` rather than left on the last source-bearing commit, because the MAP-STAMP
# RULE takes the merge-base, not the last interesting commit.
#
# **THE COMPLETE SOURCE DELTA WAS WALKED, SO THE PARTIAL-PASS RULE IS SATISFIED RATHER THAN WAIVED.**
# `git diff --name-only ad7b65dc..2d8dd8cb` over `compiler/src` · `compiler/native-parser` · `stdlib` ·
# `scripts` · `lsp` · `conformance` is **FOUR source files**, and every one was read in full:
#   · `compiler/src/route-inference.ts` + `compiler/src/codegen/collect.ts` — **#818** (`c4c55c50`)
#   · `conformance/normalize.ts` — **#822** (`ae2741e7`)
#   · `compiler/src/commands/dev.js` — **#823** (`2d8dd8cb`)
# Also in the window: 3 test files changed, **2 NEW conformance cases**, and `docs/FACTS.md`.
# `.github/` is `--name-only` **EMPTY**, so `ci.yml` is byte-identical and the blocking `gate` job is
# FLAT at **14 total steps (12 `- name:` + 2 `- uses:`)** — stated both ways deliberately, because
# "14" and "12" are each correct under a different counting base and a bare number invites the
# ambiguity. Re-counted at this SHA by parse, not carried.
#
# **NO SCHEMA CHANGE THIS WINDOW.** No type, model, `.proto` or corpus SCHEMA file changed between
# `ad7b65dc` and `2d8dd8cb`; the two new conformance cases use the existing `expect` shape. Carried forward
# VERIFIED-UNCHANGED.
#

The compiler's "schema" is its own AST, not an application data model. Root catalog:
`compiler/src/types/ast.ts` (2104 lines, 114 exported interfaces/types, ~91 distinct `kind` discriminants — unchanged since fbb4d9fd/df2ac831; this window's schema-differ.js changes below added NO ast.ts shape, same as the S287 DB-authoritative tier before it). Read that file directly for the exhaustive list; this map groups it and calls out the load-bearing shapes.

**Currency (S397, `10a4b045`):** ⛑ **`compiler/src/types/ast.ts` is `--name-only` EMPTY for the
FIFTEENTH consecutive window and NO exported type moved anywhere in the compiler — AND THIS MAP IS
STILL NOT STAMP-ADVANCED ON THAT ZERO, because a load-bearing CODEGEN-INTERNAL shape changed.**
`EmitLogicOpts.tildeContext` went from `{ var; mode? }` to a four-field object with `armBodyStmts:
ReadonlySet` and `liftVar` (#830) — see its section below. ⚑ **THE LESSON IS THE INSTRUMENT, NOT THE
SHAPE: `git diff --name-only -- compiler/src/types/` IS NOT A SUFFICIENT CURRENCY PROBE FOR THIS
MAP.** Every landing for fifteen windows has worked through existing node kinds or through
codegen-internal / schema-differ-internal shapes that are not `ast.ts` types, so the probe that
gates this map has returned EMPTY every time while the map's actual subject matter kept moving.
The zero is real and it means almost nothing.
existing node kinds, or through codegen-internal / schema-differ-internal shapes that are NOT
`ast.ts` types (the §38.6.2 constraint-drift record, the D-5 module-const candidate filter's reliance
on `ConstDeclNode`/`LetDeclNode.initExpr`, `LogicBinding.directiveIsFormValue`, and the S302
`ifRaw`/`ifCond` pair below), and now the #458 region shapes immediately below.

## Codegen-internal region shapes — NOT `ast.ts` types (NEW #458, at `97576f35`)

`compiler/src/codegen/code-segments.ts` exports two shapes that describe a region of EMITTED JS TEXT,
not a source AST node. They are here so a `grep interface` in `compiler/src/` does not come back
puzzled, and flagged as non-AST so nobody threads them through the node pipeline.

- **`BraceGroupKind = "object-literal" | "binding-pattern" | "unknown"`** (:91) — the verdict of
  `classifyBraceGroup(code, open, closeExclusive)`. **`"unknown"` is a first-class value with a
  contract, not a null case: the caller SHALL leave its existing behaviour unchanged for that region.**
- **`interface ObjectShorthandRegion`** (:93) — `{ start: number; end: number; kind: BraceGroupKind;
  names: string[] }`. `start` indexes the opening `{` **within the code segment** (NOT the whole
  buffer — offsets are segment-relative, which matters because the producer runs inside
  `rewriteCodeSegments`); `end` is one past the closing `}`; `names` are the bare identifiers between
  the braces in source order. Returned regions are non-overlapping and in source order.

Sole producer: `findObjectShorthandRegions(code)` (:213). Sole consumer: `emit-client.ts`'s
`rewriteCodeSegment` (:3038). See domain.map.md / dependencies.map.md for why only the
`object-literal` kind is acted on.

## `EmitLogicOpts.tildeContext` — the §32 `~` context object (CHANGED SHAPE, S397 #830)

**A codegen-internal shape, NOT an `ast.ts` type.** Declared on `EmitLogicOpts` in
`compiler/src/codegen/emit-logic.ts:118+`. It is here because its shape CHANGED this window in a way
that silently invalidates any consumer written against the old one.

```
tildeContext?: {
  var: string | null;              // the ENCLOSING `~` READ/INIT slot
  mode?: "single" | "array";       // "array" = loop accumulation (.push)
  armBodyStmts?: ReadonlySet<any>; // NEW S397 — DIRECT statements of this if-expr's arm bodies
  liftVar?: string;                // NEW S397 — the ARM'S RESULT variable
}
```

⚑ **`var` AND `liftVar` WERE ONE FIELD BEFORE S397, AND THE CONFLATION IS THE ENTIRE HISTORIC DEFECT
CLASS.** `var` = *"what `~` reads"*; `liftVar` = *"where `lift` writes"*. When they were the same
field, a bare statement minting into it stole the `lift` target, and an in-arm `~` read resolved to
the arm's `null`-seeded result var instead of the enclosing accumulator. **A consumer that still
treats `tildeContext.var` as the arm's result is reading the WRONG SLOT and will compile clean.**

⚑ **`armBodyStmts` IS A `ReadonlySet` OF STATEMENT OBJECTS — MEMBERSHIP IS BY IDENTITY, NOT BY SHAPE
OR BY POSITION.** It is deliberately not a boolean: a flag on this shared object propagates into every
child emitter, so the §32.2.1 carve-out was opt-OUT and three consecutive review rounds each found the
same defect in a construct nobody had enumerated. Identity does not propagate (a nested block's
children are different objects), so there are **ZERO strip sites**. Predicate: `_isDirectArmBodyStmt`.
⚠ **`armBodyStmts` does NOT mean "`var` holds the arm's result"**, and the doc comment on the type says
so explicitly because that misreading is what the field exists to prevent.

⚠ **Only `emitIfExprDecl` mints the 4-field form.** `emitForExprDecl` and `emitMatchExprDecl`
deliberately mint the pre-S395 `{ var, mode }` shape — §32.2.1 carves out §17.6.2 if-as-expression arm
bodies only, and a comprehension body (§17.7) or `match` arm (§18) is not covered by any ruling.
**That asymmetry is intentional; do not normalise it.** Full semantics in domain.map.md's `~` section.

## ⛔ scrml's AST HAS NO UNIFORM BINDER REPRESENTATION — and a `field:` regex cannot see most of it

**THIS BIT FOUR SEPARATE S397 DISPATCHES, WHICH IS WHY IT IS A SECTION AND NOT A FOOTNOTE.** There is
no single "binder" node, no shared interface, and no consistent field name. A binding appears as at
least five structurally different things:

| form | field | shape | example / site |
|---|---|---|---|
| structured parameter list | `params` | array of param objects | `fn` / `function` declarations |
| single bare name | `variable` | a bare `string` | `for-stmt` (`ast-builder.js:8817`, shorthand) |
| **raw paren TEXT** | `binding` | **ONE string, not a list** — `"x, cb"` | `match-arm-block` (`ast-builder.js:10079`); re-parsed downstream by `parseBindingList` (`codegen/emit-control-flow.ts:1173`) |
| product-pattern arms | `productPatterns` | array | §18.19 multi-scrutinee (`ast-builder.js:9920`, shorthand) |
| iteration variable(s) | `asName` / `asNames` | bareword string / 2-name array | `each-block` (`ast-builder.js:17016-17017`, shorthand) |
| variant payload | `payloadBindings` | array | `match-arm-block` (`ast-builder.js:10075`, shorthand) |

⛔ **AND THE GREP TRAP, WHICH IS THE PART THAT ACTUALLY COSTS TIME: `ast-builder.js` BUILDS MOST OF
THESE WITH ES6 SHORTHAND, SO A REGEX KEYED ON `binding:` / `variable:` / `asName:` CANNOT SEE THEM.**
MEASURED at this watermark: `grep -n 'binding:' compiler/src/ast-builder.js` returns **7** sites;
`grep -c 'binding'` returns **77**. The shorthand sites (`binding,` on its own line — `:13812`,
`:15236`, `:15313`, `:15369`, `:18729`) are invisible to the first probe and are the majority.
**Grep the bare identifier, then filter — never the `key:` form.** Same trap for `variable,`
(`:8817`, `:10860`, `:13357`), `productPatterns,`, `payloadBindings,`, `asName,` / `asNames,`.

⚑ **The `binding: "x, cb"` case deserves its own warning**: it is the raw paren-interior text with
whitespace collapsed, reconstructed at `ast-builder.js:10069` specifically so codegen can re-parse it.
**A consumer that treats it as a name gets `"x, cb"` as one identifier.** The AST does not hold the
list; `parseBindingList` derives it.

⚠ **This is a description, not a complaint.** Nothing here says the representation SHOULD be unified —
that is a design question nobody has ruled on. What it says is: **there is no single place to look, so
a walk or lint that handles "bindings" must enumerate all six forms, and the enumeration is not
discoverable by grepping for a field name.**


## §17.1.2 — `ifRaw` / `ifCond` on the three structural node kinds (S302)

**`engine-decl` / `match-block` / `each-block` carry NO `attrs` array.** They are not
`kind:"markup"`; `ast-builder.js` reconstructs each opener by regexing NAMED attributes out of the
header text, and an attribute nobody regexes for has nowhere to live. `if=` is therefore stored as a
PAIR of bare node fields, not as an attribute:

- **`ifRaw: string`** — the VERBATIM condition source (a raw slice, same shape as `inExprRaw` /
  `keyExprRaw` / `onExprRaw` / `armsRaw`).
- **`ifCond: AttrValue`** — the §5.2-PARSED attribute value: `{kind:"variable-ref"|"call-ref"|"expr",
  …}` plus `span`, `refs`, and (after `attrvalue-exprnode-walker.ts`) `exprNode`. **Byte-for-byte the
  object `<div if=…>` produces**, because `captureStructuralIfAttr` re-parses a synthetic opener
  through the same `tokenizeAttributes`+`parseAttributes` pipeline rather than classifying the value
  itself. That identity is what lets all four `if=` hosts share one lowering.

**ABSENT, not null, when the opener has no `if=`.** Both keys are omitted entirely — deliberately
NOT the null-when-absent convention the sibling opener fields use. The within-node parser-parity
canary compares FIELD SETS, and null-stamping every engine/match/each in the corpus registers as a
divergence at the ~2 nested-engine positions where live emits `text`/`comment` and native emits an
`engine-decl`, growing the allowlist for a field neither side disagrees about. Precedent on this same
node family: `engine-decl.bodyChildren`. Every consumer tests truthiness, so absent and null are
indistinguishable to them — the distinction exists only for the canary.

**The precise diagnostic anchor is `ifCond.span`; no separate attribute-NAME span is stamped.**

**Typing note worth knowing:** `engine-decl` is the only one of the three with an interface in
`types/ast.ts` (`EngineDeclNode` [910]). **`each-block` and `match-block` have NO `ast.ts` interface
at all** — they are ad-hoc object literals built in `ast-builder.js` (`:16230` and `:15276`/`:17447`).
A pass expecting a typed node for them finds nothing, and a field added to either is invisible to
`tsc`. Same class as `<outlet>` and the DB-authoritative shapes below.

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

**Declarations** — LetDeclNode [447], ConstDeclNode [462] (**both carry `initExpr?: ExprNode`, the STRUCTURED initializer — D-5 (S293) depends on it: `emit-server.ts`'s `emitReferencedModuleConstLines` SKIPS any candidate with no `initExpr`, and walks the ones that have it via `forEachIdentInExprNode` to prove every free identifier resolves at server module scope. A `const X = compute()` whose `compute` is not in the server bundle is skipped rather than emitted — a module-load ReferenceError is strictly worse than the call-time one, and the honest answer for that shape is a diagnostic, not a guess**), TildeDeclNode [480] (`~` linear-adjacent decl), LinDeclNode [492] (§35 linear types), ReactiveDeclNode [503] (the `@cell` declaration — carries `matchExpr` side-field for engine-adjacent typing), ImportDeclNode [1247] / ImportSpecifier [1235], UseDeclNode [1265] (`use foreign:` sidecar), ExportDeclNode [1279], TypeDeclNode [1298].

**State machine** — EngineDeclNode [910] (`kind:"engine-decl"`; **plus the optional `ifRaw`/`ifCond` §17.1.2 render gate, present only when the opener carried `if=` — see above**; engineName, governedType `for=`, rulesRaw + bodyChildren walkable body, sourceVar, varName/varNameOverride, initialVariant, plus acceptsType/subsetVariants/inlineMatchArmArrows annotations added across S154-S172).

**Control flow (statement)** — IfStmtNode [995], ForStmtNode [1044], WhileStmtNode [1062], ReturnStmtNode [1071] (carries `fnExprNode` — see the GITI-038 callout below), ThrowStmtNode [1085], SwitchStmtNode [1092], TryStmtNode [1101], MatchStmtNode [1120], MatchArmInlineNode [1138], BareExprNode [1156].

**Control flow (expression)** — IfExprNode [1006], ForExprNode [1017], MatchExprNode (statement-form) [1028] and the expression-layer MatchExpr [1904], TernaryExpr [1781], GuardedExprNode [1222] (`given`).

**Error/failure primitives** — FailExprNode [1196], PropagateExprNode [1210] (`?` propagation), ErrorArm [165], ErrorEffectNode [350].

**Reactive mutation** — ReactiveNestedAssignNode [757], ReactiveAssignNode [789], ReactiveArrayMutationNode [803], ReactiveExplicitSetNode [814].

**Functions / components** — FunctionDeclNode [823], ComponentDefNode [888], LambdaExpr [1858] / LambdaParam [1869].

**SQL / CSS / state bodies** — SQLNode [311], SQLChainedCall [182], SqlRefExpr [1977], CSSInlineNode [330], StyleNode [339], CSSDeclaration [133], CSSRule = CSSPropertyRule | CSSSelectorRule [144/146/154], CSSReactiveRef [125], StateNode [265], StateConstructorDefNode [279], LogicNode [294].

**Destructuring** — DestructureArrayPattern [426], DestructureObjectPattern [434], DestructureArrayElement [402], DestructureObjectProperty [408].

**Validators / lift / meta** — ValidatorEntry [679], RelationalPredicateNode [646], RenderSpecNode [730], LiftExprNode [1186], LiftTarget [195], MetaNode [359].

**Misc runtime-adjacent** — TransactionBlockNode [1352], CleanupRegistrationNode [1361], WhenEffectNode [1373], WhenMessageNode [1387], UploadCallNode [1398], AuthConfig [1503] (see the "duplicate AuthConfig shapes" note in auth.map.md), MiddlewareConfig [1515].

**Expression-layer types (ExprNode union, [types/ast.ts:2082])** — IdentExpr [1638], LitExpr [1660], ArrayExpr [1683], ObjectExpr [1690] / ObjectProp [1696], SpreadExpr [1702], UnaryExpr [1719], BinaryExpr [1747], AssignExpr [1769], TernaryExpr [1781], MemberExpr [1799], IndexExpr [1810], CallExpr [1820], NewExpr [1830], LambdaExpr [1858], CastExpr [1886], MatchExpr [1904], MapEntry [1929] / MapLitExpr [1956] (§59 value-native map/set), SqlRefExpr [1977], InputStateRefExpr [1991] (§36 `<#id>` reads), EscapeHatchExpr [2005] (`_{}` foreign block), ResetExpr [2046], MarkupValueExpr [2070].

## GITI-038 — `ReturnStmtNode.fnExprNode` (a returned function expression)
`return function name(){…}` / `return async function name(){…}` is parsed STRUCTURALLY, not stripped-and-hoisted. `ReturnStmtNode` [types/ast.ts:1071] carries an optional `fnExprNode?: FunctionDeclNode` field [types/ast.ts:1081] holding the returned closure as a full `function-decl` node — the SAME shape a top-level `FunctionDeclNode` uses. `RETURN_DECL_KW` (ast-builder.js) covers only `const`/`let`/`type`/`fn` — `function`/`async function` route through a recursive `parseOneStatement()` call.

**Contract: every AST pass that walks a `return-stmt` MUST also descend into `fnExprNode`** if it exists, treating it exactly like a nested `function-decl` statement — a `return-stmt`'s own `exprNode`/`expr` fields are EMPTY when `fnExprNode` is set. ~10 analysis passes route through it (route-inference.ts, type-system.ts, codegen/usage-analyzer.ts, component-expander.ts, meta-eval.ts, codegen/collect.ts, codegen/emit-logic.ts) — see dependencies.map.md for the Q1/Q2 async-classification split this feeds. **route-inference.ts's dead-function reachability walk is a sibling concern, not this contract** — S288 (#195/#200) clarified that a first-class function reference (not a call) also counts as reachable, and that reachability descends into nested closure bodies; see error.map.md's `W-DEAD-FUNCTION` note.

## GITI-039 — no new AST shape, a parse-time rejoin fix
No `ReturnStmtNode`/`ExprNode` shape changed. `ast-builder.js`'s `collectExpr`/`joinWithNewlines` (the token-collector for `${}` logic bodies) carries a `partSpans` parallel array so two adjacent markup-region parts whose spans are byte-adjacent rejoin with NO separator, preserving literal markup TEXT verbatim.

## §14.8.11 DB-authoritative tier — codegen-internal shapes, NOT a FileAST or ast.ts type

`schema-differ.js`'s `parseSchemaBlock(schemaBody)` return shape is the desired-state input BOTH
`diffSchema` (the SQLite/Postgres migration differ) and `commands/db-migrate.js` (via
`codegen/db-authoritative.ts`'s `extractDesiredSchema`) consume. It is a plain-object shape local to
this pipeline stage — like `ThemeContext`/`ProtectContext` below, it has no `ast.ts` entry and no
`kind` discriminant.

```
{ tables: TableDecl[], fns: SecdefFnDecl[] }   // fns is ADDITIVE — [] for a schema with no `fn`
```

### TableDecl  [schema-differ.js, `parseSchemaBlock`/`parseColumns`]
name: string
columns: ColumnDecl[]
dbAuthoritative?: boolean          // the §14.8.11 opt-in marker — bareword `db-authoritative` immediately after the table's closing `}`

### ColumnDecl  [schema-differ.js, `parseColumns`]
name: string
type: string                        // mapped SQLite affinity type
scrmlType: string                   // lowercased source token, preserved for cell-type-aware lowering
primaryKey / notNull / unique: boolean
immutable: boolean                  // §14.8.11.2 S3. A bareword mirroring `not null`/`unique`; the AUTHOR-WRITTEN half of immutability. Consumed ONLY by `generateDbAuthoritativeDDL`. Inert on a non-`db-authoritative` table (no bounded-role grant to narrow). **S288: no longer the WHOLE story — a `db-authoritative` table's PRIMARY KEY column(s) and `tenant_id` are ALSO effectively immutable whether or not this bareword is written, and there is deliberately no per-column opt-out. See `isEffectivelyImmutable` below.**
default: string | null              // §14.8.11.2 S288 — the RAW captured value, now via a BALANCED paren scan (see "Literal-lowering functions" below); lowered at emit time by `lowerDefaultToSql`, not stored pre-lowered
references: {table, column} | null
renameFrom: string | null
sharedCorePredicates: SharedCorePredicate[]   // §39.5.7 — req/length/pattern/min/max/gt/lt/gte/lte/eq/neq/oneOf/notIn. §39.5.8 S288: `oneOf`/`notIn` items are now lowered to SQL literals at emit time (see below), and a non-literal item is a COMPILE ERROR (`E-SCHEMA-010`), not a silent pass-through.

### SecdefFnDecl  [schema-differ.js, `parseFnDecl`]  — §14.8.11.2 S4
The parsed shape of a co-located `<schema>` `fn NAME(args) security definer owner(<role>) [returns
<type>] [requires cap("x")] { """ <plpgsql statements> """ }` declaration (M1-PROVISIONAL surface;
a later owner-ruled syntax pass finalizes it). Every identifier below is captured with a STRICT
`[A-Za-z_]\w*` pattern (parse-time defense complementing emit-time `quoteIdent`).
name: string
args: Array<{name: string, type: string}>
owner: string                       // MANDATORY — the bounded NOLOGIN role the SECDEF runs AS (distinct from `scrml_app`)
returns: string                     // defaults to "void"
cap: string | null                  // the `requires cap("x")` gate value, or null (no gate)
isSecurityDefiner: boolean          // advisory this pass — every P2 `fn` emits SECURITY DEFINER regardless
body: string                        // the raw plpgsql STATEMENTS only (no outer BEGIN/END — the emitter owns that envelope so the injected cap check is un-bypassable and always first)

## §14.8.11.2 S288 — auto-immutable PK/`tenant_id` + the literal-lowering functions (schema-differ.js)

**`isEffectivelyImmutable(col)`** — is a `db-authoritative` table's column immutable to the bounded
`scrml_app` role? True if the author WROTE `immutable`, **or** it is the table's PRIMARY KEY, **or**
its name is `tenant_id` (case-insensitive) — whether or not the bareword is present. **RULED S288
(bryan):** the same §14.8.10 reasoning that rejected a per-table tenant opt-in applies here — a
forgettable declaration guarding a security invariant is the wrong shape. Before this, a
WITHIN-tenant PRIMARY KEY UPDATE succeeded (only a CROSS-tenant re-point was RLS-blocked) — silently
re-pointing a row's identity under its own tenant is exactly the class the tier's audit-defensibility
claim rests on. **Consequence, stated normatively in SPEC §14.8.11.2: the prior guarantee "a
`db-authoritative` table with ZERO `immutable` columns emits BYTE-IDENTICAL to M1" is RETIRED** — such
a table always carries a PK, so it always takes the column-scoped GRANT path now. No per-column
opt-out; an author needing a mutable PK declines the `db-authoritative` marker for that table.
Consumed ONLY by `generateDbAuthoritativeDDL`'s `immutableCols`/`mutableCols` filters —
non-`db-authoritative` tables are entirely unaffected.

**Literal-lowering functions (§39.5.8 + `default()`), deliberately OPPOSITE dispositions for the
same residue:**
- `lowerArrayLiteralToSqlItems(arg)` / `lowerArrayItemToSqlLiteral(item)` / `splitTopLevelItems(inner)`
  — lower a `oneOf([…])`/`notIn([…])` item list from scrml literal form (either string-quote form,
  bare-variant `.Admin` per §41.15.6, numeric, boolean) to its SQL literal form (`'…'`-quoted
  strings, `.Admin` → `'Admin'`). ALL-OR-NOTHING: any unrecognized item (a bareword) returns the
  WHOLE list verbatim — belt-and-braces, since a compile-time caller now rejects a bareword before
  reaching here (see `findNonLiteralSetItems` next / `E-SCHEMA-010` in error.map.md).
- `lowerDefaultToSql(rawDefault)` — lowers `default(…)`'s value. A scrml STRING literal (either
  quote form) lowers to a SQL string literal — fixes `default("US")` emitting the SQL IDENTIFIER
  `DEFAULT ("US")`. A NON-literal (`default(now())`, `default(CURRENT_TIMESTAMP)`,
  `default(gen_random_uuid())`) passes through VERBATIM — here that is CORRECT, not a fallback,
  because a `default()` argument is legitimately a SQL EXPRESSION. This is the deliberate divergence
  from the `oneOf`/`notIn` position, where a non-literal is meaningless and now hard-errors.
- **`export function findNonLiteralSetItems(col)`** — the `E-SCHEMA-010` fire-site helper (see
  error.map.md), consumed from `gauntlet-phase1-checks.js`'s `checkSchemaDeclarations`.
- `findMatchingParen`/`scanMatchingParen` — now a TWO-PASS wrapper: quote-aware first (a `)` inside a
  string ARGUMENT no longer closes the predicate early — the pre-S288 silent-CHECK-drop defect,
  `oneOf(["x); DROP TABLE u; --"])` used to emit a column with NO CHECK AT ALL), falling back to a
  quote-BLIND scan when the quote-aware pass fails to close (load-bearing: a `pattern(/o'brien/)`
  regex literal can carry an unpaired apostrophe, which a quote-aware-ONLY pass would swallow).
  `parseColumns`'s `default(...)` capture is now this SAME balanced scan, not the old `[^)]+` regex
  (which stopped at the FIRST `)`, truncating `default(now())` into an unbalanced
  `DEFAULT (now() )` — a syntax error blocking 7/10 of a real adopter schema (adopter report, S4)).

**Residual, still-open edges surfaced by the S288 adversarial pass** (`g-schema-predicate-arg-
parse-edges`, MED, `docs/known-gaps.md`): `oneOf([])` on an empty array emits invalid SQL
(`CHECK (col IN ())`) rather than a compile rejection or `CHECK (false)`; `escapeSqlString` doubles
`'` but does not escape `\` — a latent MySQL-only trap (unreachable today — `db-migrate` hard-refuses
MySQL, "Phase 3").

## §38.6.2 / §39.5.5 — constraint-drift + foreign-key shapes (NEW this window, S290)

**`columnConstraintDrift(desiredCol, actualCol)`** — exported from `schema-differ.js` (:713).
Returns `{ notNull: boolean, unique: boolean, references: boolean, default: boolean }`: which of a
column's declared constraints differ from what the LIVE database reports for an EXISTING column.
§38.6.2's governing sentences always required this; the implementation only handled ADD / DROP /
RENAME COLUMN, so three of eight specified operations were never built and **every constraint change
on an existing column was silently ignored** (`g-db-migrate-ignores-constraint-drift-on-existing-
columns`). This is a conformance RESTORATION, not an amendment.

Two shape details are load-bearing:
- **PK-aware.** A PRIMARY KEY column is implicitly NOT NULL and implicitly UNIQUE, so both flags are
  forced false when either side is a PK — do not fight the driver over an implied constraint.
- **`default` is compared TOLERANTLY** via the private `sameDefaultText(a, b)` (:731): it drops a
  Postgres `::type` cast suffix, unwraps ONE quote layer (`'x'` or `"x"`), trims and case-folds.
  Drivers echo defaults back with their own quoting/casts, so a raw string compare would report
  permanent phantom drift — and a gate that cries wolf gets bypassed, then deleted.

Consumers: `diffSchema` emits `W-SCHEMA-CONSTRAINT-TIGHTENED` (Postgres — the DDL IS emitted, and
will correctly fail on non-conforming rows) or `W-SCHEMA-CONSTRAINT-DRIFT-UNAPPLIED` (SQLite — the
§38.6.3 rebuild is destructive and refused by default, so NOTHING is applied and the plan is
reported as WITHHELD). See error.map.md + migrations.map.md.

**`referencesHint(raw)`** — exported from `schema-differ.js` (:1756). Builds the "you wrote X, the
only form is Y" half of the `E-SCHEMA-011` message from the author's raw text.

**`ColumnDecl.references` is now two-valued at parse time.** `parseColumns` records a `references`
clause that does NOT match the single §39.5.5 production (`references <table>(<column>)`, table name
OUTSIDE the parens) into a `malformedReferences` collection rather than dropping it. Every other
shape — `references(owners.id)`, `references owners (id)`, `references owners.id` — used to compile
and migrate clean with NO `REFERENCES` clause and NO diagnostic. `gauntlet-phase1-checks.js` turns
that collection into `E-SCHEMA-011`. Supporting helper: `blankLiteralBodies(s)` (:232) blanks string
literals and strips `//` comments first, so `default('see references')` or a comment mentioning the
word cannot false-fire the detector.


### ActualTable / ActualColumn  [schema-differ.js, `readActualSchema`/`readActualSchemaPg`]
The LIVE-database-read counterpart `diffSchema` compares `TableDecl`/`ColumnDecl` against. Same
shape family, `sharedCorePredicates` always `[]` (not recoverable from `PRAGMA table_info()` /
`information_schema.columns` in v1 — CHECK-constraint text isn't exposed).

**`g-db-migrate-check-constraint-oneof-pattern` — RESOLVED S288** (`docs/known-gaps.md`). The
originally-reported three sub-bugs, verdicted against real Postgres 16 through the real CLI: (1) the
unquoted-bareword CHECK — FIXED (the literal-lowering functions above); (2) the false
`E-DBAUTH-NO-TENANT-COLUMN` pre-flight fire on a `tenant_id`-carrying table — tried 9 shapes, NOT
REPRODUCED (open a fresh gap with the exact table if it recurs — the main compiler's own parse was
always fine, only the differ's line-based scan was suspect); (3) a `pattern(/…{n}…/)` quantifier
brace fooling the marker/brace matcher — was ALREADY fixed by the P2 brace-depth `parseSchemaBlock`
rewrite, now regression-locked. If you touch `parseColumns`/`parseSharedCorePredicates`, the
regression tests in `compiler/tests/unit/schema-differ.test.js` (this window's +124 lines) are the
reproducer set to run first.

## §65 CSS-native model — NOT a dedicated FileAST shape
`<theme>` / `<defaults>` are recognized as ordinary MarkupNode instances via the structural-element registry (`compiler/src/attribute-registry.js:485` onchange, `:503` theme, `:516` defaults) — same pattern as `<endpoint>` (§61) and `<onchange>` (§38.13). No `ThemeDeclNode`/`EndpointDeclNode`/`OnchangeNode` type exists in ast.ts. Codegen-internal (non-FileAST) types for these features:
- `ThemeContext` — exported from `codegen/emit-theme-reset.ts:56`: `{ themeDecls: ThemeDecl[]; programNode; cellNames: Set<string> }`.
- `CSSVariableBridge` — `codegen/collect.ts`: the §25 reactive-CSS-var bridge descriptor.
- `ProtectContext`/`ProtectedColumns` (protect-egress.ts, §14.8.9), css-conflict-check.ts's internal `CssConflictFinding`, `RowChange` synthesis (channel-watches.ts, §38.13), `EndpointArmBinding`/`IfDisplayGuard` (codegen-internal, §61).
- `<program reset="none">`. `attribute-registry.js`'s `"program"` element carries a `reset` attrSpec — the §65.3.4 built-in-reset opt-out.

## `<outlet>` (§20.8) — also NOT a dedicated FileAST shape
Same structural-element-registry pattern as `<theme>`/`<defaults>`/`<onchange>` — no `OutletNode` type in ast.ts. Recognized/validated by symbol-table.ts PASS 15.5.

## Codegen-internal binding shapes (binding-registry.ts) — NOT ast.ts types

`LogicBinding` (`codegen/binding-registry.ts`, a pure data registry with no imports) is the
emit-time record every event/logic binding is registered as. Fields that decide EMISSION SHAPE, not
just wiring:

- `isReactiveValueAttr` / `valueAttrName` / `valueAttrIsFormValue` / `valueAttrKey` — the #81
  writer-ownership set, computed by `emit-html.ts`'s `analyzeWriterConflict`.
- **`directiveIsFormValue?: boolean` (NEW this window, i225)** — set ONLY when an `attr-template`
  binding is a `value="${…}"` on a form control (`<input>`/`<textarea>`/`<select>`) with NO sibling
  `bind:value`/`bind:valueAsNumber`. When set, `emit-variant-guard.ts` writes the caret-safe `.value`
  PROPERTY (`{ const _v = expr; if (el.value !== _v) el.value = _v; }`) instead of
  `setAttribute("value", …)`. **It must be computed at REGISTRATION in `emit-html.ts`**, where the
  element `tag` and the sibling `attrs` array are in scope — the arm wire fn only ever sees the
  pre-lowered binding, never the markup node. This mirrors the file-scope `isFormControlValue`
  decision in `emit-bindings.ts` (i174); the `!hasBindValue` half is deliberate, because a sibling
  `bind:value` is the sanctioned two-way owner and a second `.value` writer would compete with it.

`EachReconcileCtx` (`codegen/emit-each.ts`, module-level `_eachReconcileCtxStack`) — the LIVE stack
of enclosing `<each>`/for-lift contexts at emit time, carrying `{iterVar, destructure?, …}`. S293/S294
read it to build the per-item re-resolution preludes; the stack (not the AST) is what makes shadowing
decidable, since a name bound by a NEARER ctx must suppress re-resolving a same-named enclosing var.

## §20.5 session-establishment — new attributes/config fields, NOT a new FileAST node type
No `SessionDeclNode` exists — `session` is a reserved server-scope BUILTIN identifier. See auth.map.md for the three separate non-FileAST "auth config" shapes. **S288: `tenant-egress.ts`'s `buildTenantContext` now takes a second, optional arg (the `<schema>`-declared tables, from `extractDesiredSchema(fileAST).tables`) and unions them into `TenantContext.tenantScopedTables`** — previously it read ONLY the `<db>`-derived `ProtectContext.schemaByTable` registry, which left a `<schema>`-only app (no `<db>` block) with an EMPTY tenant set even though §14.8.10 says a `<schema>` table's `tenant_id` column presence IS the tenant declaration. See domain.map.md's §14.8.11 section for the full defect narrative (`g-dbauth-session-principal-not-wired`, RESOLVED S288).

## Type-system ResolvedType layer (type-system.ts, not ast.ts)
FunctionType [type-system.ts:~470], MapType [:328] (with `.set?: boolean` for §59.12 value-native Set), PredicatedType (with `subsetVariants`), the `<fn-return>` over-approximation sentinel (`FN_RETURN_TYPE_NAME`). NO `AnyType`/`null` member exists — `any` and `null` are not scrml types (§14.1.1 / null-does-not-exist axiom). **`:line` figures in this row shifted ~+10 when #665 inserted the split; the shapes are unchanged.**

### §7.5 / §14.7 — the `asIs` / `unknown` SPLIT (NEW #665, S365, dpa-036 call 1)

**The one-sentence rule, and it is the whole point of the split:** `asIs` means **a developer signed
for it** (§14.7's named escape hatch — silent by design, because a human took responsibility);
`unknown` means **the compiler did not look, or looked and could not tell** — an inference gap that
**nobody signed for**. Before S365 those were ONE value: inference gave up by returning `tAsIs()`,
so a hole in the type checker was spelled exactly like a deliberate opt-out, and *absence of a
diagnostic* and *success* were the same observation.

All three new types are **module-private to `type-system.ts` (no `export`)**, which is why the
"no exported type added" check above still passes.

### AsIsType  [type-system.ts:345]
```
kind: "asIs"
constraint: ResolvedType | null
bareVariantBase?: ResolvedType   // R28-8 / §14.10 sidecar — the field's TRUE base type when a
                                 // trailing validator (`category: Category req`) defeated the
                                 // registry lookup. ADDITIVE: does not change the `asIs` kind
                                 // any other `structType.fields` consumer reads.
isFunctionField?: boolean        // §59.4 / §45.2 — annotation was unambiguously FUNCTION-SHAPED
                                 // but lowered to `asIs`. Routes a map KEY to `E-EQ-003` rather
                                 // than the general `E-MAP-KEY-NOT-COMPARABLE`.
```
Pre-existing for many windows. **Do not confuse the `asIs` KIND with the S365 split** — the split
is what got carved OUT of it.

### UnknownType  [type-system.ts:387]
```
kind: "unknown"
reason: UnknownReason            // REQUIRED. No optional, no default.
```
⚠ **`tUnknown(reason)` [:1307] has NO zero-argument overload and NO default parameter, deliberately.
An `unknown` that cannot say what defeated it has decayed back into an `asIs`.** If you find
yourself wanting `tUnknown()`, the call site does not yet know enough to be honest.

### UnknownReason  [type-system.ts:409] — a discriminated union, three honest sources
```
| { readonly source: "inference-gap"; readonly gap: InferenceGap }
| { readonly source: "forward-ref";   readonly typeName: string }
| { readonly source: "not-a-node" }
```
- `inference-gap` — expression inference RAN and could not type the node. **This is the loud,
  counted case: it is what `W-TYPE-031-UNPROVEN` reports** (error.map.md).
- `forward-ref` — a type NAME registered before its declaration resolves (`buildTypeRegistry`
  pass 1). Transient BY CONSTRUCTION; a later pass overwrites it. **Not a defect, do not gate on it.**
- `not-a-node` — the caller handed the resolver something that is not an AST node. A defensive
  sentinel, **not a judgement about any program**.

### InferenceGap  [type-system.ts:421]
```
readonly nodeKind: ExprNode["kind"]   // NOT `string`, and there is no default
readonly detail:  string              // adopter-facing refinement — names a CONSTRUCT, never an
                                      // internal identifier (`lit` is not one thing, so a boolean
                                      // literal reports `bool literal`)
```
**You cannot construct an `InferenceGap` without naming a REAL `ExprNode` kind. That type — not a
convention — is what keeps the gap honest as the language grows.**

### InferenceResult  [type-system.ts:440] — the return type of `inferExprType` [:569]
```
| { readonly ok: true;  readonly type: ResolvedType }
| { readonly ok: false; readonly gap:  InferenceGap }
```
Constructors: `inferenceOk(type)` [:444], `inferenceGap(nodeKind, detail)` [:448].

⚑ **THE RATIFIED DECAY-STOPPER, and it is why every `inferExprType` caller had to change:**
inference no longer returns a bare `ResolvedType`, because a bare `ResolvedType` gave callers **no
way to distinguish "I typed this" from "I gave up and here is the hatch."** Callers must destructure
`ok`, so the failure branch cannot be reached by accident.

⚑ **THE COMPANION PROPERTY IS A COMPILE-TIME ONE, AND IT ONLY WORKS BECAUSE `scripts/types-gate.ts`
LANDED IN THE SAME PR.** `inferExprType` ends in a `never` fallthrough, which makes "a new `ExprNode`
member that nobody taught inference about" a **TYPE ERROR** rather than a silent `asIs`. bun runs
`.ts` transpile-only, so before #665 that guarantee was decorative: nine sibling exhaustive switches
in `expression-parser.ts` were ALREADY failing on `MarkupValueExpr` and nothing had ever noticed.
**Building a tenth `never` fallthrough without arming a checker would have reproduced the defect
rather than closed it.** build.map.md · test.map.md.

**Assignability is UNCHANGED and still permissive on both members** [`:1183-1186`]: `asIs` OR
`unknown` on EITHER side is assignable (graceful-degrade column, or an inference gap). The split
changed what the compiler can SAY, not what it accepts.

## Tags
#scrml #map #schema #ast #types #asis-unknown-split #inference-result #inference-gap #unknown-reason #w-type-031-unproven #types-gate #never-fallthrough #engine-decl #reactive-decl #css65 #theme #expr-node #file-ast #outlet #reset #link-boost #theme-context #css-var-bridge #giti-038 #giti-039 #return-stmt #fn-expr-node #session-establishment #colorless-async #dbauth #table-decl #column-decl #secdef-fn-decl #schema-differ #immutable-column #auto-immutable #is-effectively-immutable #e-schema-010 #lowering-functions #sql-literal-lowering #tenant-context-union #resolved-gaps #e-schema-011 #column-constraint-drift #references-hint #same-default-text #d5 #init-expr #logic-binding #directive-is-form-value #i225 #each-reconcile-ctx #if-cond #if-raw #structural-if #§17.1.2 #absent-not-null #parity-canary #field-set-comparison #untyped-structural-nodes #each-block #match-block #attr-value-identity #object-shorthand-region #brace-group-kind #codegen-internal-shape #not-an-ast-node #segment-relative-offsets #unknown-is-a-contract #zero-exported-type-added #types-dir-flat-11-windows #unknown-has-no-reason-on-main #asis-kind-is-not-the-split #asis-split-NOT-on-main #inference-result-NOT-on-main #types-zero-diff-13 #no-new-exported-type #exported-functions-not-types #synth-cell-keys-are-strings #not-type-enforced #no-named-interface-for-bsresults #structural-shape-consumption #types-zero-diff-fourteenth
#tildecontext-shape #liftvar-vs-var #armbodystmts-readonlyset #no-uniform-binder #es6-shorthand-defeats-field-regex #binding-is-raw-paren-text #parsebindinglist #types-dir-empty-is-not-a-currency-probe

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [error.map.md](./error.map.md)
- [domain.map.md](./domain.map.md)
- [auth.map.md](./auth.map.md)
- [dependencies.map.md](./dependencies.map.md)
- [migrations.map.md](./migrations.map.md)
