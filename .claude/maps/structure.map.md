# structure.map.md
# project: scrmlts
# updated: 2026-06-04T20:50:00Z  commit: 452a212b

## Entry Points
compiler/bin/scrml.js — CLI binary registered as `scrml`; thin Bun launcher
compiler/src/cli.js — subcommand router: compile / dev / build / migrate / promote / --help / --version; documents `--emit-engine-graph` flag (S149)
compiler/src/index.js — legacy thin wrapper; delegates pipeline to api.js; kept for backward compat
compiler/src/api.js — public compiler API: compileScrml(), scanDirectory(), bundleStdlibForRun(); plumbs engineGraphJson lazy getter into compile result (S149); `scandir` skip-dirs updated (S156); Bug 70 (S157): E-CODEGEN-INVALID-JS gate suppressed when compilation already has a prior fatal error (redundant-CODEGEN-on-bad-source false-alarm class)
compiler/src/codegen/index.ts — codegen subsystem entry; re-exports CgInput/CgOutput/runCG; imports srcmap-provenance, build-source-map, source-map (S149-S150)

## Directory Ownership

compiler/  — Bun workspace; the entire compiler toolchain plus tests
compiler/src/  — compiler pipeline source (33 .js + 107+ .ts files): block-splitter, ast-builder, tokenizer, type-system, auth-graph, dependency-graph, engine-graph (S149), component-expander (CE stage), engine-statechild-parser (custom raw-text engine-arm parser), runtime-template (client runtime JS source), etc.
compiler/src/codegen/  — 60+ emit-*.ts modules; errors.ts (CGError class + code catalog); ir.ts (IR shapes); emit-error-boundary.ts (+320L §19.6); emit-client.ts (_scrml_modules cross-file registry S152 #6; detectRuntimeChunks descends into engine bodyChildren + each-block bodyChildren, S153); emit-each.ts (Tier-1 `<each>` render fns + dep-first read + `_scrml_each_renderers` registration + Bug 62 engine-ctx threading, S153-S156; Bug 64/R28-1c S158: `EachReconcileCtx` stack + `maybeWrapEachPerItemEffect` + push/pop/current for live-keyed per-item TEXT/class: bindings; Bug 73 S159: `iterScopeReferencedInHandler` + `maybeWrapEachPerItemHandler` for live-keyed Tier-1 per-item EVENT HANDLERS); emit-lift.js (Tier-0 `${for…lift}`; Bug 65 S157 engine-ctx threading; Bug 64: push/pop reconcile ctx; Bug 72 S158 `tryEmitNestedLiftEach`; Bug 73 S159: `maybeWrapLiftPerItemHandler`/`maybeWrapLiftCallableHandler` + shared `_liftIterScopeReferenced`); emit-engine.ts (engine substrate codegen; S155 message-arm dispatch table); emit-match.ts (block-form match arms); emit-variant-guard.ts (engine/match arm-swap dispatcher; calls `_scrml_remount_each`, S153); build-source-map.ts + source-map.ts + srcmap-provenance.ts (source-map provenance subsystem, S149-S150); emit-html.ts (Bug 60 S157: `enclosingCompoundStack` + `lookupQualifiedStateCell` fallback for render-by-tag inside nested compound wrappers)
compiler/src/codegen/compat/  — compatibility shims for legacy pipeline shapes
compiler/src/commands/  — CLI subcommand implementations: build.js compile.js dev.js (per-file watcher rewrite, S152) generate.js init.js migrate.js promote.js serve.js
compiler/src/types/  — pure TypeScript declarations: ast.ts (1983L+ AST node shapes; S154 `acceptsType?` on EngineDeclNode), reachability.ts
compiler/src/reachability/  — reachability sub-passes (5 component passes, entry-points, gate-classifier, outer-fixpoint)
compiler/src/validators/  — attribute validation and lint passes: ast-walk.ts, attribute-allowlist.ts, attribute-interpolation.ts, lint-async-user-source.ts, lint-try-catch.ts, post-ce-invariant.ts
compiler/src/native-parser-canary/  — canary harness for native-parser pipeline parity checks
compiler/src/native-walker/  — walker utilities for native-parser output traversal; engine-statechild-walker.ts updated S154 to expose `messageArms` array + S160 ruling (b) to expose `legacyColonPlacement: false` default on state-child walk results
compiler/native-parser/  — bootstrap native parser (38 `.js` files + paired `.scrml` self-host mirrors); replaces block-splitter+ast-builder at M5-swap; activated via `--parser=scrml-native`. **S162 UPDATE: the native parser NOW promotes BOTH `<each>` → `each-block` (NEW unit A: `isEachBlock`/`synthEachBlockNode` in parse-file.js) AND `<match>` → `match-block` (already promoted via `isMatchBlock`/`synthMatchBlockNode`) to structural FileAST nodes — the S153 "does NOT promote" each/match precondition is CLOSED/RETIRED.** Remaining native-parser flip-failures are a DIFFERENT ~6-family set (F1-F9) — see the "Native-Parser File Table (S162)" below + domain.map.md "Native-Parser Swap Orientation". The `.scrml` mirrors are FEATURE-stale (S162) — native fixes go in the `.js`.
compiler/tests/  — 886+ .test.js files total across all categories
compiler/tests/unit/  — unit tests covering individual compiler passes; +13 S154-S158 files; +2 S159 files (per-item-handler-live-keying-bug73.test.js + html-colon-shorthand-content-model-s159.test.js); **+2 S160 files** (colon-shorthand-inside-opener-s154b.test.js + typed-array-no-rhs-default.test.js)
compiler/tests/integration/  — full compile-to-output verification tests
compiler/tests/browser/  — browser runtime tests via happy-dom (32 files; +5 S157-S159: each-per-item-reactivity-bug64, each-in-tier0-lift-bug72, render-by-tag-nested-compound-bug60, lift-engine-advance-bug65, each-per-item-handler-live-keying-bug73)
compiler/tests/conformance/  — conformance tests for E-/W-/I- code surface; +1 S155: conf-engine-message-dispatch-s155.test.js
compiler/tests/parser-conformance*.test.js  — 10 native-parser parity test files at tests/ root; parser-conformance-within-node-allowlist.json updated S156
compiler/tests/lsp/  — LSP protocol tests (completions, hover, code-actions, diagnostics, workspace)
compiler/tests/helpers/  — shared test utilities and compile harnesses
compiler/tests/fixtures/  — shared fixtures and multi-file app stubs; +1 S155: engine-message-dispatch-s6.scrml
compiler/tests/self-host/  — self-host compiler conformance tests
compiler/tests/commands/  — CLI subcommand integration tests
compiler/runtime/  — embedded client runtime JS (stdlib/idempotency.js; stdlib/ modules)
compiler/self-host/  — experimental scrml-native self-hosting compiler output (cg-parts/ + dist/)
compiler/samples/  — MCP v0 fixture sample app with routes/
stdlib/  — scrml standard library (server-side modules): auth, cron, crypto, data, format, fs, host, http, mcp, oauth, path, process, redis, regex, router, store, test, time
lsp/  — Language Server Protocol implementation (server.js, handlers.js, workspace.js, l4.js)
e2e/  — Playwright end-to-end tests (tests/, fixtures/, playwright.config.ts)
benchmarks/  — performance comparison suites (fullstack-react, fullstack-scrml, todomvc-* variants, sql-batching, llm-efficiency)
samples/  — compilation-test samples and gauntlet suites (individual files not enumerated)
docs/  — project documentation: changelog, known-gaps, tutorial, adopter guides, design-ratification logs
docs/changes/  — per-dispatch progress.md + BRIEF.md archives (~108+ change directories; +9 S154-S156 dispatch dirs; +4 S157-S158 dispatch dirs; +2 S159 dispatch dirs; **+2 S160 dispatch dirs**: s154b-colon-shorthand-inside-opener-2026-06-03, s154c-no-rhs-typed-defaults-2026-06-03)
docs/heads-up/  — design-ratification decision logs (spec-consolidation, iteration-design, lifecycle-annotation, const-deep-freeze)
docs/audits/  — historical audit artifacts and findings trackers
docs/articles/  — dev.to articles and outreach content
docs/website-viewer/  — C1 self-demo scrml app (viewer shell + real provenance, S151); app.scrml + pages/ + components/ + data/
scripts/  — maintenance scripts: regen-spec-index.ts, compile-test-samples.sh, git-hooks/
editors/  — editor extension stubs (VS Code etc.)
scratch/  — throwaway working files

## Key S154-S159 Source Changes (since watermark c665714c)

### S154 — #14 event-payload-transition (parser batch 1: engine-statechild-parser)
- compiler/src/engine-statechild-parser.ts (2418L at S154) — `accepts=MsgType` attribute recognized on `<engine>` opener; per-state message-arm lexer (`parseMessageArms()`) recognizes `| .Variant(bindings) :> body` form; produces `MessageArmEntry[]` array on each state-child result; `renderBodyStart` offset accounts for the message-arm prefix. Engine-decls with message arms wired into typer batch 2 via `EngineStateChildEntry.messageArms`.
- compiler/src/native-walker/engine-statechild-walker.ts — `messageArms` field exposed on state-child walk results to give the native-walker parity with the live-pipeline parser.
- compiler/src/types/ast.ts — `EngineDeclNode.acceptsType?: string | null` field added (§51.0.S.2.2); records raw identifier from `accepts=MsgType` opener attribute verbatim for typer resolution.

### S155 — #14 event-payload-transition (typer batch 2 + codegen batch 3)
- compiler/src/symbol-table.ts (11280L at S155) — SYM PASS 11 resolves `acceptsType` against `fileAst.typeDecls`; fires `E-ENGINE-ACCEPTS-NOT-ENUM` when the type is absent or non-`:enum`; PASS 20 block-form `<match>` exhaustiveness now carries `E-MATCH-SUBSET-DEAD-ARM`; per-state message-arm exhaustiveness fires `E-ENGINE-MSG-ARM-NOT-EXHAUSTIVE` and `E-ENGINE-MSG-WITHOUT-ACCEPTS`. Exports `MessageArmEntry` interface and `EngineStateChildEntry.messageArms`.
- compiler/src/type-system.ts (17070L at S155) — two-plane `.advance(.X)` resolution (§51.0.G.1): state-plane via `_scrml_engine_advance`, message-plane via `_scrml_engine_dispatch_message`; `parseEnumSubsetRefinement()` materializes `PredicatedType` with `subsetVariants: Set<string>` for `Role oneOf([.A,.B])` / `notIn([...])` (§53.15.1); three-zone exhaustiveness pass for enum-subset `<match>` (§18.8.1 / §18.0.1): in-subset arms, out-of-subset dead arms (→ `E-MATCH-SUBSET-DEAD-ARM`), absent arms; `E-ENGINE-MSG-UNKNOWN` fires when `.advance(.X)` targets a variant in NEITHER the state plane NOR the message plane.
- compiler/src/codegen/emit-engine.ts (4398L) — `emitEngineMessageArmTable()` (§51.0.S batch 3): emits per-engine `__scrml_engine_<varName>_arm_table` keyed by (from-state-tag, message-tag); `engineMessageArmTableName()`, `engineHasMessageArms()`, `collectEnginesWithMessageArms()`, `collectEngineMessageVariants()` exported for threading into emit-each and emit-event-wiring; `parseEnumVariantFieldsForType()` resolves payload-binding field names at codegen time.
- compiler/src/runtime-template.js (+78L at S155) — `_scrml_engine_dispatch_message(varName, msg, armTable, table, timersTable, idleEntry, internalTable, historyMap)` runtime helper (§51.0.S.2); resolves message tag + payload, dispatches to per-state arm fn, calls `_scrml_engine_advance` for the target transition, handles idle-reset on handled message.

### S156 — Bug 62 (`<each>` engine-ctx threading) + (d)-A enum-subset (4 batches)

#### Bug 62 — each-render engine-ctx threading
- compiler/src/codegen/emit-each.ts (1345L at S156) — **Bug 62 fix (the pattern-to-mirror for Bug 65)**:
  `buildEachEngineCtx(fileAST)` collects file-scope engine metadata ONCE (via `collectEnginesWithMessageArms` + `collectEngineMessageVariants` from emit-engine.ts) and threads an `EachEngineCtx` through every `renderTemplateAttrToJs` / `renderTemplateChildToJs` / `emitEachReconcileLines` call. Inside the per-item template lowering, `emitEngineHandlerBody(callText, engineCtx)` intercepts (A) `.advance(.X)` call-refs and (B) `@engine = .X` assign-refs and routes both to the correct plane (`_scrml_engine_advance` or `_scrml_engine_dispatch_message`) via `rewriteBlockBody` / `emitExprField`.
- compiler/src/codegen/emit-engine.ts — `collectEnginesWithMessageArms()` + `collectEngineMessageVariants()` exported specifically to feed `buildEachEngineCtx`; both are file-scope collectors used by emit-each + emit-event-wiring.

#### (d)-A — enum-subset refinement (§53.15.1/.2/.3 — four batches)
- compiler/src/enum-subset-refinement.ts (143L, **NEW FILE**) — shared pure recognizer for both match loci. `parseEnumSubsetAnnotation(expr, enumVariantsOf)` returns `EnumSubsetParse` (null | error | subset); enforces: no range form `.A .. .B` (§53.15.1 union-evolution hazard); no empty set; entries must be `.VariantName`; `notIn` is complemented to positive IN-SET. Dependency-free (no type-system.ts import) to allow circular-safe import by symbol-table.ts.
- compiler/src/type-system.ts — `parseEnumSubsetRefinement()` calls the shared recognizer; `makeEnumSubsetPredicatedType()` materializes a `PredicatedType` with `baseType: "enum"`, `subsetVariants: Set<string>` (already complemented for `notIn`), and a `predicate` of kind `"variant-set"`. Error markers lower to `E-CONTRACT-002` at declaration time.
- compiler/src/symbol-table.ts — PASS 20 `validateMatchBlock()` uses `parseEnumSubsetAnnotation` from the shared recognizer against its file-scope enum registry; dead arms (variant outside the subset) → `E-MATCH-SUBSET-DEAD-ARM`; same locus wired for constructor-form match (member-access) per batch 4.
- compiler/src/codegen/emit-predicates.ts (518L) — `predicateToJsExpr()` handles `kind: "variant-set"`: emits `(["A","B"].includes(valueExpr))` (string `.includes` — enum variants lower to plain strings at runtime; §53.15.2 boundary check).
- compiler/src/codegen/emit-schema-for.ts (516L) — `classifyFieldForSql()` handles `predicated` type with `subsetVariants`: emits `CHECK IN` over the subset's ordered variant names (§41.15.6 + §41.15.8a); preserves base-enum declaration order for stable DDL.

### S157 — match-exhaustiveness arc + Bug 60/63/65/67/68/70/71 (multi-bug pass)

#### Bug 65 — Tier-0 `${for…lift}` engine-ctx threading (S157)
- compiler/src/codegen/emit-lift.js (1861L at S156 → 2205L at S157) — **Bug 65 fix** (sibling of Bug 62): `buildLiftEngineCtx(fileAST)` delegates to `buildEachEngineCtx` via `require("./emit-each.ts")` to build the per-file engine ctx ONCE; `buildLiftEngineCtxFromExtras(extras)` is a thin re-pack adapter that assembles the same `EachEngineCtx` carrier shape from engine extras already threaded via emit-logic opts (avoids re-walking the AST); `tryLowerLiftEngineHandler(rawHandlerText, engineCtx)` delegates to `emitEngineHandlerBody` (emit-each.ts) — NO duplicated `.advance` lowering logic. Engine-ctx is threaded into `emitSetAttrs`, `emitCreateElementFromMarkup`, and all `emitLiftExpr` call sites. Tree-shaken when the file has no engine. `pushLiftReconcileCtx`/`popLiftReconcileCtx` wired into the `for`-loop `createFn` body for Bug 64 per-item reactivity (see S158 below for the Tier-0 side of Bug 64).
- compiler/src/codegen/emit-logic.ts (3884L) — Bug 65: `for-stmt` case in `emitLogicNode` now threads all engine extras (engineBindings, engineVarNames, enginesWithHooks, enginesWithOnTimeout, enginesWithIdleWatchdog, enginesWithInternalRules, enginesWithHistory, enginesWithMessageArms, engineMessageVariants) into `emitForStmt`; previously these were silently dropped → `_scrml_reactive_get(...).advance(...)` silent miscompile.

#### Bug 60 — render-by-tag nested compound field expansion (S157)
- compiler/src/codegen/emit-html.ts (2432L) — **Bug 60 fix**: `enclosingCompoundStack: string[]` tracks the active compound-parent namespace wrapper tag during the markup walk; when a self-closing tag `<field/>` fails a bare `lookupStateCell` but `enclosingCompoundStack` is non-empty, a fallback `lookupQualifiedStateCell(fileScope, [enclosing, tag])` resolves it as a nested field. The compound-parent block-form opener pushes onto the stack; its paired closer pops. Self-closing `<compound/>` form bypasses the push (it is a render-by-tag use, not a namespace wrapper).
- compiler/src/dependency-graph.ts (3354L) — **Bug 60 structural-read credit**: render-by-tag markup tag matches against `reactiveVarNodeIds` now credit the cell as a reader for E-DG-002 purposes, mirroring the each-block / engine-cell / match-block structural-read credits; clears the false-positive E-DG-002 class for cells consumed ONLY through render-by-tag.

#### Bug 72 — nested `<each>` inside Tier-0 `${for…lift}` (S158 fix, landed here)
- compiler/src/codegen/emit-lift.js — `tryEmitNestedLiftEach(eachMarkupNode, scopeVar, fragmentVar, engineCtx)` routes a `{kind:"markup", tag:"each"}` child through `emit-each.emitNestedEachFromMarkup`, emitting inline reconcile JS. Pre-fix: `parseLiftTag` (ast-builder.js) produces generic `markup` nodes recursively and never promotes `<each>` → the literal `<each>` DOM element was emitted and the inner `@.` sigil leaked raw → E-CODEGEN-INVALID-JS.
- compiler/src/ast-builder.js (13897L at S157) — `_parseLiftAttrValue` bare-`@` branch: a `PUNCT "@"` token (the `<each>`-contextual `@.` sigil) is now collected as a balanced `@...` token run and returned as an `{kind:"expr"}` value, keeping the lift on the structured `{kind:"markup"}` path. Pre-fix: the `@` fell through to `return null`, forcing the whole tag to the string-fallback path which lost the structured each routing.

#### Match-exhaustiveness arc (S157) — ast-builder.js + type-system.ts
- compiler/src/ast-builder.js — Bug 71 (S157): derived `const <x> = match @cell { ... }` exhaustiveness: dual-parse hook — `collectExpr()` first (reactive emit unchanged), then `parseOneMatchAsExpr` builds a structural match-expr on the same token range as a pure typer side-field; `annotateNodes`' state-decl walker visits it for exhaustiveness (E-TYPE-020). Bug 67: `return match expr { ... }` match-as-expr hook mirroring let/const hooks. Both hooks attach `matchExpr` to the AST node for the typer's exhaustiveness pass.
- compiler/src/type-system.ts (17374L at S157) — Bug 63: bare-variant `.advance(.V)` checking extended to markup event-handler attribute positions (`onclick=@phase.advance(.V)`); `handlerAttrToExprNode` synthesizes equivalent ExprNode for both bare call-ref and interpolation forms; routes both through `inferReactiveSiteBareVariants` → E-TYPE-063 on invalid variants / two-plane resolution for `accepts=`-bearing engines. Bug 67 (S157): `return match expr { ... }` → exhaustiveness via `checkMatchDiagnostics`. Bug 71 (S157): derived `const <x> = match @cell { ... }` → exhaustiveness check wired via dual-parse side-field. E-SYNTAX-064 (`@.` outside `<each>` body scope) upgraded from fall-through to explicit diagnostic at both the attr-walk site and the markup-attr-value walk site — suppresses the confusing E-CODEGEN-INVALID-JS downstream.

#### S157 emit-client.ts + api.js
- compiler/src/codegen/emit-client.ts (2427L) — minor Bug 64/65 binding-threading adjustments; no new exports.
- compiler/src/api.js (2456L) — Bug 70: E-CODEGEN-INVALID-JS gate (default-ON) is suppressed when compilation already has a prior fatal error (`hasPriorFatalError` check uses the same W-/I-/severity partition as the final result split); codegen-of-invalid-source is EXPECTED, not a compiler defect.

### S158 — Bug 64/R28-1c per-item content reactivity on reconcile + Bug 72 (see also S157 above)

#### Bug 64 / R28-1c — live-keyed per-item content reactivity
- compiler/src/codegen/emit-each.ts (1634L at S158) — **Bug 64 fix (Tier-1)**:
  `EachReconcileCtx { mountVar, keyVar, iterVar }` interface; module-level `_eachReconcileCtxStack: EachReconcileCtx[]`; `pushEachReconcileCtx`/`popEachReconcileCtx`/`currentEachReconcileCtx` functions. `maybeWrapEachPerItemEffect(bodyLines, iterVarName, indent)` checks the active ctx: when the iter var matches, wraps the body in a `_scrml_effect(() => { let iterVar = _scrml_resolve_item(mount, keyVar); if (iterVar === null) return; ... })` so TEXT and class: bindings re-resolve the live item each reconcile. Called at every per-item TEXT-binding and class: binding emission site in `renderTemplateChildToJs` and `renderTemplateAttrToJs`. `pushEachReconcileCtx` is pushed in `emitEachReconcileLines` after the `_scrml_reconcile_list(...)` call; popped after the createFn body.
- compiler/src/codegen/emit-control-flow.ts (2013L) — **Bug 64 fix (Tier-0 control-flow path)**: `pushLiftReconcileCtx` called inside the `for`-loop `createFn` builder with `{ wrapperVar, keyVar: keyVar, iterVar: varName }` (key captured as `item?.id != null ? item.id : _scrml_idx`, mirroring the `_scrml_reconcile_list` keyFn); `popLiftReconcileCtx` called after the createFn body. Engine ctx threaded into all `emitConsolidatedLift` / `emitLiftExpr` / `emitIfStmtWithContainer` / `emitForStmtWithContainer` calls inside the body.
- compiler/src/runtime-template.js (3760L) — **Bug 64 runtime support**: `_scrml_reconcile_list` now builds a fresh key→item `Map` on EVERY reconcile pass (`container._scrml_item_by_key`) and calls `_scrml_trigger(container, "_scrml_items")` (skipping the very first pass) to re-fire per-item effects after the map is rebuilt. `_scrml_resolve_item(container, key)` reads `container._scrml_item_by_key`, tracks `(container, "_scrml_items")` via `_scrml_track`, and returns the live item wrapped in `_scrml_deep_reactive` (so field reads through the Proxy subscribe the per-item effect); returns `null` (canonical absence, SPEC §42.5) when the key is gone.

### S159 — Bug 73 (per-item handler live-keying) + S154 ruling (a) HTML `:`-shorthand content-model

#### Bug 73 — Tier-1 + Tier-0 per-item EVENT HANDLER live-keying (sibling-gap #2 of Bug 64)
- compiler/src/codegen/emit-each.ts (1634L at S158 → **1742L** at S159) — **Bug 73 fix (Tier-1)**:
  `blankStringAndRegexLiterals(code)` lightweight lexer that blanks literal contents before identifier scan (prevents false matches on iter-var names inside string/regex literals).
  `iterScopeReferencedInHandler(handlerBody, iterVarName)` — exported token-scan gate: `\b<iterVar>\b` over blanked code; used by both tiers to decide whether a handler body reads the iter var.
  `maybeWrapEachPerItemHandler(handlerBody, iterVarName)` — when a reconcile ctx is active AND the handler reads `iterVarName`, prepends `let <iterVar> = _scrml_resolve_item(<mount>, <keyVar>); if (<iterVar> === null) return;` INSIDE the existing `function(event) { ... }` body (NOT wrapped in `_scrml_effect` — handlers have no reactive subscription; re-resolve only on fire). Called in `renderTemplateAttrToJs` at the event-handler branch after building `handlerBody`. Global handlers and literal-only bodies stay byte-identical to pre-fix.
- compiler/src/codegen/emit-lift.js (2205L at S157 → **2318L** at S159) — **Bug 73 fix (Tier-0)**:
  `_liftIterScopeReferenced(handlerBody, iterVarName)` — delegates to `iterScopeReferencedInHandler` (emit-each.ts, via `require`) with a plain word-boundary fallback if the export is unavailable.
  `maybeWrapLiftPerItemHandler(handlerBody)` — function-body handler shape (a): prepends the re-resolution prelude inside the handler body when the ctx is active and the body reads the iter var.
  `maybeWrapLiftCallableHandler(arrowText)` — callable-direct handler shape (b): inlines the arrow inside a wrapper `function(event) { let <iterVar> = _scrml_resolve_item(...); ... (<arrowText>)(event); }` so the wrapper's `let` lexically shadows the arrow's free `<iterVar>` reference. Returns null when no wrap applies (caller emits the arrow directly — byte-identical to pre-fix). Edge: if the arrow's param name collides with `iterVar`, the param shadows the `let` (harmless miss — documented, not special-cased).

#### S154 ruling (a) — HTML-element `:`-shorthand content-model rule (SPEC §4.14 / §34)
- compiler/SPEC.md — §4.14 amended: a NON-VOID lowercase HTML element with a `:`-shorthand body (`<span : @label>`) renders the expression as its single-expression body, byte-identical to `<span>${@label}</span>`. A VOID element (`<input>`, `<br>`, SVG `<rect>`, etc.) REJECTS `:`-shorthand with `E-COLON-SHORTHAND-ON-VOID`. §34 +1 row `E-COLON-SHORTHAND-ON-VOID`. SPEC.md total 31,494L. SPEC-INDEX.md sections-table regenerated.
- compiler/src/block-splitter.js (2950L) — **R4a**: the `shorthand && !selfClosing` branch is now placed BEFORE the `selfClosing || VOID_ELEMENTS.has(lowerTagName)` short-circuit (previously, a void element with a `:`-shorthand body like `<br : x>` was classified as self-closing and its body was swallowed). Now `<void : expr>` is correctly classified `closerForm:"shorthand"` so it reaches the type-system guard.
- compiler/src/ast-builder.js (13897L at S157 → **14003L** at S159) — **R1**: `buildBlock()` synthesizes the body child for a non-void, non-component, non-`@.`-sigil HTML element with a `:`-shorthand body. Synthesis re-parses a reconstructed `<tag>BODY</tag>` source through the same block-splitter+buildBlock path — guaranteeing byte-identity. Expression body → interpolated `${expr}` form; `"..."` display-text literal → unquoted display text (interior `${...}` preserved). `@.` contextual-sigil bodies (`<li : @.name>`) are EXCLUDED from synthesis (owned by emit-each; outside-each misuse still reaches E-SYNTAX-064).
- compiler/src/type-system.ts (17374L at S157 → **17436L** at S159) — **R4b**: `E-COLON-SHORTHAND-ON-VOID` guard: at the `markup` case of the type-check visitor, when `closerForm === "shorthand"` and `getElementShape(tag).isVoid === true`, fires `E-COLON-SHORTHAND-ON-VOID` (fatal). **R3**: `@.` contextual-sigil body outside an `<each>` scope — the existing E-SYNTAX-064 fire site extended to cover shorthand-body positions; a `<li : @.name>` written outside an `<each>` body now fires E-SYNTAX-064 instead of falling through to E-CODEGEN-INVALID-JS.

## Key S160 Source Changes (S154 rulings (b) and (c))

### S160 ruling (b) — inside-opener `:`-shorthand canonical; deprecate after-`>` placement (f7c540c8)

- compiler/src/engine-statechild-parser.ts (**2491L**) — S160: after-`>` colon placement (`<Idle> : expr`) is now detected as LEGACY and deprecated; inside-opener placement (`<Idle : expr>`) is canonical (§4.14 / §51.0.I / §18.0.1). Each parsed arm entry now carries `legacyColonPlacement: boolean` (true when the after-`>` form was used). `parseMessageArms()` extended to detect the same distinction. `openerStart` offset is recorded per arm for use by `rewriteColonShorthandPlacement()` in migrate.js.
- compiler/src/match-statechild-parser.ts (**631L**) — S160: `MatchArmEntry.legacyColonPlacement?: boolean` field added; the after-`>` `:` form is detected and marked; inside-opener `:` is canonical. `parseMatchArms()` exports the same `legacyColonPlacement` flag per arm.
- compiler/src/native-walker/engine-statechild-walker.ts — S160: `legacyColonPlacement: false` default added to the state-child walk result shape (native-parser always emits canonical inside-opener form; the field is present for interface parity with the live-pipeline parser).
- compiler/src/symbol-table.ts (**11341L**) — S160 ruling (b): emits **`W-COLON-SHORTHAND-LEGACY-PLACEMENT`** (info-level, W- prefix → result.warnings) at two sites: (1) PASS 11 / PASS 20 engine state-child scan when `sc.legacyColonPlacement === true` [symbol-table.ts:6035]; (2) PASS 20 match-block arm scan when `arm.legacyColonPlacement === true` [symbol-table.ts:11045]. Both fire for every arm using the legacy after-`>` placement; the lint includes a `migrate --fix` suggestion.
- compiler/src/commands/migrate.js (**2600L**) — S160 ruling (b) `--fix` rule: `rewriteColonShorthandPlacement(source, filePath)` exported function — AST-driven rewrite of every legacy after-`>` arm (engine `rulesRaw` + match `armsRaw`) to the canonical inside-opener form. Uses live front-end (splitBlocks + buildAST) + statechild parsers to locate arms; `rewriteColonPlacementInBody(body, legacyArms)` does the string-precise splice (string-/paren-/`${}`-aware scan of opener `>` boundary; splices ` : expr>` right-to-left). Powers the `W-COLON-SHORTHAND-LEGACY-PLACEMENT` `bun scrml migrate --fix` path.

### S160 ruling (c) — no-RHS typed-decl defaults (Shape 4 generalized) (d0d66d3e)

- compiler/src/ast-builder.js (14003L at S159 → **14180L**) — S160: Shape 4 generalized (§6.2). A no-RHS typed decl (`<x>: T`) synthesizes a canonical initial value based on type string:
  - Primitives with canonical empty: `int`/`integer`/`number` → `0`; `bool`/`boolean` → `false`; `string` → `""`.
  - Array form (`T[]`) → `[]` (pre-existing S152 behavior, unchanged).
  - Bare named type (`:struct`, `:enum`, opaque, date, timestamp) → `not` init + `implicitNotLifecycle: true` flag on the AST node; type-system synthesizes the `(not to T)` lifecycle.
  - Union admitting absence (`T | not`, `T?`) → `not` init, NO lifecycle (the type already includes absence).
  - Refinement-typed (`int(>0)`, `string(/.../)`  etc.) → synthesizes base canonical-empty (`0`, `""`, `[]`, etc.) + sets `refinementNoRhsBase` flag; type-system's `runRefinementNoRhsDefaultCheck()` validates.
  - `const` no-RHS (non-array) → E-DECL-NEEDS-INITIALIZER (preserved from S152; derived cells require an expression).
  - `TYPE_BOUNDARY_KEYWORDS` stop-set added to `collectTypeAnnotation` for the no-RHS path (§7.5 type-expr grammar has no statement keywords); prevents greedy swallow of next sibling statement into the type string when `=` is absent.
- compiler/src/type-system.ts (17436L at S159 → **17580L**) — S160 ruling (c):
  - `buildCellValueLifecycleMap` handles `implicitNotLifecycle === true` AST flag: synthesizes a `(not to T)` lifecycle spec via `parseLifecycleReturnAnnotation` with `synthesizedFromNoRhs: true` marker. Gives the walker the same discrimination + assignment + reset transitions as the explicit `<user>: (not to User) = not` form (§14.12.3).
  - `FnReturnLifecycleSpec.synthesizedFromNoRhs?: boolean` — new optional field; propagates the synthesis origin to the diagnostic message.
  - `checkLifecycleBindingAccess` — when `synthesizedFromNoRhs` is true, appends a synthesis note to the E-TYPE-001 message explaining the implicit lifecycle (§14.12.3 — "cell defaulted to `not` and acquired the lifecycle implicitly").
  - `runRefinementNoRhsDefaultCheck(lifecycleTopNodes, errors, fileSpan)` — **new function** (~line 17176): walks `refinementNoRhsBase`-flagged nodes; calls `evaluatePredicateOnLiteral` on the synthesized base canonical-empty; fires **`E-REFINEMENT-NO-DEFAULT`** (fatal) when the predicate is VIOLATED (e.g. `<x>: number(>0)` synthesizes `0`, which fails `>0`); silently accepts when SATISFIED or UNDETERMINABLE.
  - `runRefinementNoRhsDefaultCheck` invoked from the top of `processFile` at the post-lifecycle-map phase [type-system.ts:14101].

#### Bare-variant inference helpers — exact locations for R28-8 dispatch

The three helpers targeted by the R28-8 fix are in type-system.ts at the following lines (confirmed against HEAD `9f01f6cd`):

| Helper | Definition line | Role |
|--------|----------------|------|
| `inferBareVariantsInExpr` | **7925** | Flat walker — resolves bare-variant idents against a single context type; entry point for enum / union / asIs / null / primitive context shapes |
| `inferBareVariantsForStructConstructor` | **8153** | Companion — recovers struct field context from unannotated ctor form (`const bad = Post { role: .V }`); delegates to `inferBareVariantsWithStructNav` |
| `inferBareVariantsWithStructNav` | **8199** | Struct-nav walker — descends into nested object/array literals refining per-position type; falls back to `inferBareVariantsInExpr` for non-struct/non-array leaves |

**Primary call site for let/const-decl annotation path** — `~line 5820` (`if (letAnnot)` branch):
- `inferBareVariantsWithStructNav(initExprForScope, resolvedType, letSpan, errors)` — called when a `:Type` annotation is present.
- `inferBareVariantsForStructConstructor(...)` — called when annotation is absent but init looks like a struct constructor.
- `inferBareVariantsInExpr(initExprForScope, null, letSpan, errors)` — called as final fallback (no annotation, not a ctor).

Secondary call sites: reactive-decl annotation path ~line 6080; bare-expr statement path ~line 6263; `if`-condition path ~line 6773; `return`-expr path ~line 7030; call-arg path (`inferBareVariantsAtCallArgs`) ~line 9097.

## Key S162 Source Changes (native-parser each-promotion arc + swap re-measure)

The S162 native-parser arc CLOSED the each/match structural-promotion precondition and re-measured
the flip. All native-parser changes land in the `.js`; the paired `.scrml` self-host mirrors are
FEATURE-stale (S162 finding — whole machinery missing vs the `.js`, not mere predicate-drift; S115
`.js`/`.scrml` lockstep is moot for native fixes until a deliberate re-sync).

### S162 unit A — `<each>` promoted to a structural `each-block` FileAST node (39b1424a)
- compiler/native-parser/parse-file.js (**1600L**) — `isEachBlock(block)` predicate (name-authoritative gate; both `<each>` and `< each>` resolve) + `synthEachBlockNode(block, idGen, source, errors)` synthesize a live `each-block` ASTNode (`{ id, kind: "each-block", iterShape, inExprRaw, ofExprRaw, asName, bodyRaw, ... }` — mirrors ast-builder.js L11841 / L12091-L12105). Routed from `mapOneBlock` at the `kind === "Markup" && isEachBlock(block)` gate (parse-file.js:278), EXACTLY mirroring the pre-existing `isMatchBlock`/`synthMatchBlockNode` gate (parse-file.js:237). Adds colon-shorthand body + standalone-HTML body-child synthesis + `colonIntroducesDirectiveAttr` guard.
- compiler/native-parser/tag-frame.js (**2402L**) — `each: true` added to the frozen `STRUCTURAL_ELEMENTS` map (tag-frame.js:135), joining `engine`/`match`/`errors`/`onTransition`/`onTimeout`/`onIdle`/`page` (SPEC §4.15 / §24.4). `isStructuralElementName(name)` is the closed-name-set membership test.

### S162 unit C — `@.` contextual-sigil lexer recognition (d99403b1)
- compiler/native-parser/lex-in-code.js (**842L**) — new `@`-then-`.` lexer branch BEFORE the `@ident` branch (lex-in-code.js:351). `@.` is the `<each>` contextual iteration-value sigil: bare `@.` is the current item/index, `@.field` / `@.a.b` is a dotted member path. The branch consumes `@.` PLUS the optional dotted-ident chain as ONE `ScrmlAt` token; `name` carries everything after the `@` (`.field`), and translate-expr's AtCell arm prepends `@` to yield `ident{name:"@.field"}`. Completes native `<each>` parity (#2f unit C).

### S162 unit B — emit-each honors the exprNode contract for native per-item interp (178cc5dc)
- compiler/src/codegen/emit-each.ts — native per-item `${expr}` interpolation now honors the `exprNode` contract (mirrors emit-html.ts:1888), so the native-parser `each-block` output codegens per-item interp identically to the live-pipeline path. Also fixed the MK2.1 coupled-test.

### S162 F3 — same-line match-arm boundary detection (2af1e3dd)
- compiler/native-parser/parse-expr.js (**3956L**) — `isAtArmBoundary(ctx)` (parse-expr.js:3007) DROPPED the redundant NEWLINE/ASI gate. Boundary now = `ctx.inMatchArmBody === true` AND `peekStartsArmPattern(cursor)` (arrow-anchored + uppercase-gated). The `inMatchArmBody` flag is saved/set/restored around the arm-body parse (parse-expr.js:2733). Fixes same-line match arms under flip (swap family F3, partial — if-as-expr residual remains).

### S162 SPEC registry catch-up (e5b673dc)
- compiler/SPEC.md + compiler/SPEC-INDEX.md — §4.15 / §24.4 register `<each>` as a structural element (reserved-name list + attr-catalog), aligning the SPEC with the long-standing implementation and the S162 native promotion.

## Key S163 Source Changes (B1 reset-expr + F1 engine-substrate silent-miscompile CLOSED)

### S163 B1 — native `reset(@cell)` → live `reset-expr` node (6ad8ca13)
- `compiler/native-parser/translate-expr.js` — intercepts a bare-`reset`-callee CallExpr → builds the live `reset-expr` node (3 §6.8.2 shapes: 0-arg target is a §42 `not` literal; `@cell`; `@a.b.c` multi-level compound-nav). NOT the `LOGIC_SCOPE_GLOBAL_ALLOWLIST` allowlist shortcut (S139 trap). R26: native emits `_scrml_reset("coins")` byte-identical to default. +7 tests. Deferred: malformed-reset diagnostic surfacing under native (produces the node with the E-RESET-NO-ARG field but doesn't run the ast-builder surfacer; no parity regression).

### S163 F1 — engine-substrate silent-miscompile CLOSED (a41df176, the headline; ~40L)
**The bug:** native silently DROPPED the entire §51.0 engine substrate (transition table, `_scrml_engine_direct_set` rule-validation, var-init, mount/body-render) across ALL engine files — compiled clean, emitted `<engine>` as a dumb `_scrml_reactive_set` cell. **Root cause = a `machineDecls` TWO-INSTANCE object-identity defect:** native synthesized TWO `engine-decl` objects — a `nodes` copy via `parse-file.js synthEngineNode` AND a SEPARATE `machineDecls` copy via `collect-hoisted.js synthEngineDecl`. SYM stamped `_record`/`engineMeta` on the `nodes` copy ONLY; codegen `collectC12EngineDecls` reads `machineDecls`-FIRST → un-stamped → `isC12EngineDecl` false → substrate dropped. (Live shares ONE instance: `ast-builder.js:13616 machineDecls.push(node)`. `<match>` was fine — `collectMatchBlocks` walks nodes-only.)
- `compiler/native-parser/parse-file.js` — native now derives `machineDecls` from the mapped `nodes` instances via NEW `collectMachineDeclsFromNodes` (single shared instance, matching live); `bodyChildren` mapped to AST nodes so nested engines are structural + reachable.
- `compiler/native-parser/collect-hoisted.js` — `synthEngineDecl` REMOVED; `collect-hoisted.js` no longer synthesizes engines (the second-instance source).
- **PA-independent R26:** engine-modern-001 (7/7 `_scrml_engine_`, 4/4 transitions, 3/3 direct_set) + engine-009 nested (30/30) BYTE-IDENTICAL native==default; all 6 swept engine sub-features (basic/hierarchy/onTimeout/onIdle/history/effects) recover. mario's marioState substrate recovers; its residual is the SEPARATE PowerUp payload-enum bug (next).
- **§4.18 ruling (S163):** native's `E-UNQUOTED-DISPLAY-TEXT` (§4.18.7) on bare display text in code-default arm bodies is SPEC-CORRECT, NOT spurious — native enforces, LIVE stays lenient (doomed M6); corpus migration deferred.

### S164 flip re-measure
- **674 flip-failures** (down from ~790 S162, 1,150 S161; engine-substrate + B1 killed ~116). ~8 environmental → ~666 genuine across 181 files / ~6 families. **NEXT: B2 (§51.0.S message-arm).**

### Native-Parser File Table (S162) — swap-grind orientation

The native parser is `compiler/native-parser/` (38 `.js` files; paired `.scrml` mirrors are
FEATURE-stale — fix the `.js`). Key files by role + the swap-family each owns:

| File | Lines | Role | Owns family |
|------|-------|------|-------------|
| `parse-stmt.js` | 3990 | statement parser (decl / fn / export / control-flow) | F5 (`const @name` derived-decl), F6/F9 (fn param / export-fn-body) |
| `parse-expr.js` | 3956 | expression parser; match/if-as-expr; `isAtArmBoundary` arm-boundary | F3 (match/if-as-expr — same-line DONE S162) |
| `parse-markup.js` | 2916 | markup body parser; MK3.3 display-text detection; `classifyTagFrame`; emits `E-UNQUOTED-DISPLAY-TEXT` (§4.18.7) | **F1** markup-classification half |
| `tag-frame.js` | 2402 | TagKind classification; `STRUCTURAL_ELEMENTS`; `tagKindFor`; void-element registry | F1, F7 (structural-misplaced gating) |
| `translate-stmt.js` | 1686 | native-AST → live-shape statement translation | — |
| `parse-file.js` | 1600+ | top-level file parser; block→ASTNode mapping (`mapOneBlock`); each/match structural promotion (S162); **`collectMachineDeclsFromNodes` engine-substrate single-instance share + `synthEngineNode` `bodyChildren`→AST mapping (S163)** | each/match promotion; engine substrate (CLOSED S163) |
| `translate-expr.js` | 1050+ | native-AST → live-shape expression translation; AtCell `@.` arm; **bare-`reset`-callee → live `reset-expr` node (B1, S163)** | B1 reset-expr (DONE S163) |
| `collect-hoisted.js` | ~830 | hoisted-declaration collection pass; **`synthEngineDecl` REMOVED S163 (was the engine second-instance source)** | — |
| `synthEngineDecl` (in native engine synth path) | — | builds the engine-decl from `<engine>` openers; **has ZERO `accepts=` handling (acceptsType undefined vs live null) + no openerEffect read** | **B2 (§51.0.S message-arm — THE NEXT DISPATCH)**; `effect=` opener gap |
| `native-walker/engine-statechild-walker.ts:516` | — | walks engine state-children into `EngineStateChildEntry`; **hard-codes `messageArms: []`** | **B2 (§51.0.S message-arm)** |
| `lex-in-code.js` | 842 | code-default lexer; `@.` contextual-sigil branch (S162 unit C) + `@ident` | — |
| `display-text-literal.js` | 640 | display-text literal scanner; emits `E-UNQUOTED-DISPLAY-TEXT` | F1 (spurious-fire surface) |
| `ast-stmt.js` | 601 | native statement AST node constructors | — |
| `block-context.js` | 553 | block-context frame tracking | — |
| `parse-css-body.js` | 536 | CSS body parser | — |
| `parse-seam.js` | 427 | code↔markup seam parser | — |
| `parse-error-body.js` | 344 | `<errors>` block body parser | — |
| `token.js` / `token-cursor.js` / `cursor.js` | 273 / 102 / 59 | token + cursor primitives | — |
| `ast-expr.js` | 478 | native expression AST node constructors | — |
| `body-mode.js` | 227 | body-mode dispatch (code/markup/sql/css) | — |
| `parse-state-body.js` | 235 | engine/db/schema state-child classification (`tagKindFor`, `ENGINE_FORM_KEYWORDS`, `isStateBlock` exclusion) | F1 markup-classification (engine-substrate drop was the dominant F1 cause — CLOSED S163 via parse-file.js, not here) |
| `parse-sql-body.js` | 182 | SQL body parser (`?{}` server-fn SQL) | F2 (drops SQL body in top-level server fns) |
| `parse-mode.js` / `lex-mode.js` / `parse-ctx.js` | 114 / 34 / 124 | mode + parse-context state | — |

**B2 locus (the NEXT dispatch — §51.0.S engine message-arm, ~20 failures, L-subset):** native
`synthEngineDecl` has ZERO `accepts=MsgType` opener-attr handling (acceptsType undefined vs live null)
and `native-walker/engine-statechild-walker.ts:516` hard-codes `messageArms: []` — so `(state × message)`
arms are dropped and `accepts=`-bearing engines mis-fire `E-ENGINE-ACCEPTS-NOT-ENUM` (4) / `E-ENGINE-MSG-UNKNOWN`
(3). **The LIVE pattern to mirror is `engine-statechild-parser.ts parseMessageArms()`** (landed S154/S155 #14 —
`accepts=MsgType` capture + `(state × message)` arm recognition → `EngineStateChildEntry.messageArms`; SPEC
§51.0.S + §51.0.G.1 + §51.0.B `accepts=` row). Affects `engine-message-dispatch-s6.scrml` + the conf/browser
`engine-message-dispatch-s155` tests. **F1 engine-substrate (the ~168 dominant cause) is CLOSED S163** — see
"Key S163 Source Changes" above; the residual `E-UNQUOTED-DISPLAY-TEXT` §4.18.7 fire is SPEC-CORRECT (native
enforces, live lenient), NOT a native bug.

## Ignored / Generated Paths
node_modules/, compiler/node_modules/, dist/, compiler/dist/, compiler/native-parser/dist/,
compiler/self-host/dist/, stdlib/*/dist/, .git/, handOffs/,
benchmarks/todomvc-react/, benchmarks/todomvc-vue/, benchmarks/todomvc-svelte/

## Tags
#scrmlts #map #structure #compiler #cli #bun #engine-graph #source-map #each #each-in-dynamic-context #match #engine-statechild #cross-file-modules #enum-subset #message-dispatch #s154 #s155 #s156 #s157 #s158 #s159 #s160 #bug60 #bug62 #bug63 #bug64 #bug65 #bug70 #bug71 #bug72 #bug73 #r28-1c #r28-8 #per-item-reactivity #live-keyed #colon-shorthand-html #colon-shorthand-canonical #shape4-no-rhs #bare-variant-inference #native-parser #native-parser-swap #each-promotion #match-promotion #flip-failure-families #f1-engine-substrate-closed #b2-message-arm-next #engine-substrate-fix #b1-reset-expr #s161 #s162 #s163 #s164

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
