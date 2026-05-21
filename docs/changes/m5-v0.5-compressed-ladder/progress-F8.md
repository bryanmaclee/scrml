# F8 — native-parser meta + error-effect payloads — progress

## 2026-05-21 — start
- Worktree: .claude/worktrees/agent-a8a6a74895491597a
- Merged main (0c84e407). Baseline test: 18057 pass / 169 skip / 1 todo / 2 fail
  (pre-existing flakes: value-indexed-subscribers throw-by-design + serve.test.js).

## Phase 0 — survey (COMPLETE)

### Native current state
- `.InMeta` + `.InErrorEffect` are SKETCH-DEPTH: `dispatchInMeta` / `dispatchInErrorEffect`
  both delegate to `scanBraceDelimitedSketch` (parse-markup.js ~L943-952). The block is
  emitted by `emitContextBlock` (parse-markup.js L296) with only `{kind, span, commentForm}`
  — no body / no arms.
- The model to follow: `.InLogicEscape` (emitContextBlock L312-324) captures `block.bodyText`
  + routes it through `parseLogicBodyBestEffort` -> native `Stmt[]` via `lex` + `parseProgram`.
  F7 extended the same pattern to `.InCss` (shapeCssBlock) + `.InSql` (shapeSqlBlock).
- `blockKindForContext` (parse-markup.js L131) already maps `.InMeta`->`Meta`,
  `.InErrorEffect`->`ErrorEffect`.

### Target (live) shapes — compiler/src/types/ast.ts
- MetaNode: `{ kind:"meta", body: LogicStatement[], parentContext: string, span }`
  (ast-builder.js `case "meta"` L11568 — body via tokenizeLogic+parseLogicBody;
   parentContext via mapParentContext, default "markup").
- ErrorEffectNode: `{ kind:"error-effect", arms: ErrorArm[], (body? for catch-form) }`.
- ErrorArm: `{ pattern, binding, handler, handlerExpr?, span }` (ast-builder.js
  `parseErrorTokens` L10194 — legacy `| ::Type bind -> handler` form; pattern is
  `"::Name"` / `".Variant"` / `"_"`).

### live -> native payload mapping
- Meta:   live `body: LogicStatement[]`  -> native `block.body: Stmt[]` (parseLogicBodyBestEffort)
          live `parentContext: string`   -> native `block.parentContext` ("markup" default at top level)
          live `kind:"meta"`             -> native `block.kind:"Meta"`
- ErrorEffect: live `arms: ErrorArm[]`   -> native `block.arms: {pattern,binding,handler,handlerExpr?,span}[]`
          live `kind:"error-effect"`     -> native `block.kind:"ErrorEffect"`

### kind-naming reconciliation — DECISION: downstream dual-mode (F2 precedent)
- Native block catalog is uniformly PascalCase (Markup/LogicEscape/Sql/Css/Meta/...).
  Renaming only Meta/ErrorEffect to lowercase would break native catalog consistency
  => emitter-align is NOT cleaner. Dual-mode downstream chosen.
- ~17 downstream `kind === "meta"` sites: meta-checker.ts (9: L450,640,705,1093,1140,
  1426,1478,1722,1939), meta-eval.ts:531, dependency-graph.ts (737,2668), component-
  expander.ts:1600, codegen/{emit-html.ts:1807, emit-library.ts:210/317/392,
  collect.ts:207/421, emit-client.ts:50}.
- 2 error-effect `case` sites: type-system.ts:5615, codegen/emit-logic.ts:2324.
- Approach: shared predicates `isMetaKind`/`isErrorEffectKind` in types/ast.ts;
  widen meta `if` tests; widen error-effect `case` arms (`case "ErrorEffect":`).

## Implementation — COMPLETE

### Native parser
- NEW `parse-error-body.{scrml,js}` — shapeErrorEffectBlock + parseErrorArms.
  Single-pass char scan over the `!{...}` body text producing ErrorArm[]
  ({pattern, binding, handler, span}). Mirrors live tokenizeError+parseErrorTokens.
- `parse-markup.{scrml,js}` emitContextBlock — added .InMeta + .InErrorEffect
  branches. Meta: bodyText capture + route through native M3 parser
  (.js: parseLogicBodyBestEffort; .scrml: lex + parseProgram) -> block.body:
  Stmt[]; block.parentContext = "markup". ErrorEffect: bodyText + shapeErrorEffectBlock.

### Downstream dual-mode (F2 precedent — chosen over emitter-align)
- NEW predicates `isMetaKind` / `isErrorEffectKind` in types/ast.ts.
- Meta `if` widening (isMetaKind): meta-checker.ts (9), meta-eval.ts (1),
  dependency-graph.ts (2), component-expander.ts (1), codegen/emit-html.ts (1),
  codegen/emit-library.ts (3), codegen/collect.ts (2), codegen/emit-client.ts (1)
  — 20 sites total.
- Error-effect `case` widening (`case "ErrorEffect":` fallthrough):
  type-system.ts (1), codegen/emit-logic.ts (1).
- NOT touched: BS-internal `block.type === "error-effect"` consumers
  (ast-builder.js, tokenizer.ts) — those read the block-splitter's `type`
  field, replaced wholesale by the M5 swap, not a native-parser kind surface.

### Conformance
- 20 F8 tests in parser-conformance-markup.test.js (F8 Meta + F8 ErrorEffect
  describes) — native payload assertions + live-buildAST parity.
- Meta parity at statement-count + parentContext granularity (native Stmt[]
  catalog vs live LogicStatement[] catalog differ — deep parity is M5-swap scope).
- Error-effect parity exact on pattern/binding; handler whitespace-normalized
  (live rejoins tokens with spaces, native keeps verbatim slice).

### Divergences surfaced (NOT bugs in F8)
- Live `parseErrorTokens` recognizes a no-pipe `::Type` arm but NOT a no-pipe
  bare `_` wildcard arm (the `_` token is only reached inside the leading-`|`
  branch). Native shaper is MORE permissive. Parity cases use the piped `| _`
  form; native unit test covers no-pipe `_`. The M5 swap would fix the live gap.
- Unterminated brace contexts (`^{`/`${`/`?{`/`#{` with no `}`) emit NO block
  in the native parser — EOF flush does not close an open context. Meta matches
  sibling-context behavior.

### Test delta
- Pre-commit gate (unit+integration+conformance): 13437 pass / 0 fail.
- Full `bun run test`: 18057 -> 18078 pass; 0 fail (the 2 baseline flakes
  — value-indexed-subscribers, serve.test.js — passed this run).
