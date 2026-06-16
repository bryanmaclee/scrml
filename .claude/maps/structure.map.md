# structure.map.md
# project: scrmlts
# updated: 2026-06-16  commit: 76d03aa9

## Entry Points
compiler/bin/scrml.js — CLI binary registered as `scrml`; thin Bun launcher
compiler/src/cli.js — subcommand router: compile / dev / build / migrate / promote / --help / --version; documents `--emit-engine-graph` flag (S149)
compiler/src/index.js — legacy thin wrapper; delegates pipeline to api.js; kept for backward compat
compiler/src/api.js — public compiler API: compileScrml(), scanDirectory(), bundleStdlibForRun(); plumbs engineGraphJson lazy getter into compile result (S149); `scandir` skip-dirs updated (S156); Bug 70 (S157): E-CODEGEN-INVALID-JS gate suppressed when compilation already has a prior fatal error (redundant-CODEGEN-on-bad-source false-alarm class); **S176: `bundleStdlibForRun` (line 302) now recursively copies a shim's TRANSITIVE same-directory sibling-shim deps into `_scrml/` (lines 328-356) so e.g. `scrml:http`'s retry-jitter import of `scrml:random` resolves at runtime;** **S174: `production` compile option (§20.6.5 log() strip, default false) threaded to runCG (api.js:586/1931); imports the S170 exprtext-backfill walker (line 17, invoked 960)**
compiler/src/codegen/index.ts — codegen subsystem entry; re-exports CgInput/CgOutput/runCG; imports srcmap-provenance, build-source-map, source-map (S149-S150); **S174: imports `registerFileSource`/`resetLogLoc`/`fileDeclaresLog` from log-loc.ts (line 68) + `setLogProductionStrip`/`setLogShadowedInFile` from emit-expr.ts (line 69); `setLogProductionStrip(production)` at runCG (line 455); per-file `setLogShadowedInFile(fileDeclaresLog(fileAST))` (lines 587/760)**

## Directory Ownership

compiler/  — Bun workspace; the entire compiler toolchain plus tests
compiler/src/  — compiler pipeline source (33 .js + 110+ .ts files): block-splitter, ast-builder, tokenizer, type-system, auth-graph, dependency-graph, engine-graph (S149), component-expander (CE stage), engine-statechild-parser (custom raw-text engine-arm parser), runtime-template (client runtime JS source), **sql-projection.ts (NEW S175, 419L — SELECT-projection extractor for the typed-SQL-row arc: `extractSelectProjection(query)` → `SelectProjection` {columns / `t.col` qualified / `AS` aliases / FROM-JOIN alias map}; graceful degradation on the deferred long tail)**; **engine-varname.ts (NEW S192, 41L — the ONE canonical §51.0.C acronym-run var-name rule: `autoDeriveEngineVarName(typeName)` exported; imported by symbol-table.ts / type-system.ts / codegen/emit-machines.ts / ast-builder.js — collapses 4 divergent derivation sites into one)**; etc.
compiler/src/codegen/  — 60+ emit-*.ts modules; errors.ts (CGError class + code catalog); ir.ts (IR shapes); emit-error-boundary.ts (+320L §19.6); **log-loc.ts (NEW S174, 224L — location resolver for the `log()` builtin: `resolveLogLoc(span)`→"basename:line" from byte offset, `registerFileSource`/`resetLogLoc` per-compile cache, `fileDeclaresLog(fileAST)` shadow detector, `SERVER_LOG_HELPER` raw-string runtime chunk for `_scrml_log`/`_scrml_log_render`)**; emit-client.ts (_scrml_modules cross-file registry S152 #6; detectRuntimeChunks descends into engine bodyChildren + each-block bodyChildren, S153; S174: includes the `'log'` client chunk ONLY when an emitted line contains `_scrml_log(`); emit-server.ts (S174: prepends `SERVER_LOG_HELPER` to the server bundle ONLY when the final emitted JS contains a `_scrml_log(` call); emit-expr.ts (S174: `log(...)` call lowering ~L1630 — `_scrml_log(side, loc, ...args)` for the builtin / plain call for a shadowed `log` / `(void 0)` no-op under `_logProductionStrip`; `setLogShadowedInFile`/`setLogProductionStrip` toggles + `resolveLogLoc` import); emit-each.ts (Tier-1 `<each>` render fns + dep-first read + `_scrml_each_renderers` registration + Bug 62 engine-ctx threading, S153-S156; Bug 64/R28-1c S158: `EachReconcileCtx` stack + `maybeWrapEachPerItemEffect` + push/pop/current for live-keyed per-item TEXT/class: bindings; Bug 73 S159: `iterScopeReferencedInHandler` + `maybeWrapEachPerItemHandler` for live-keyed Tier-1 per-item EVENT HANDLERS); emit-lift.js (Tier-0 `${for…lift}`; Bug 65 S157 engine-ctx threading; Bug 64: push/pop reconcile ctx; Bug 72 S158 `tryEmitNestedLiftEach`; Bug 73 S159: `maybeWrapLiftPerItemHandler`/`maybeWrapLiftCallableHandler` + shared `_liftIterScopeReferenced`); emit-engine.ts (engine substrate codegen; S155 message-arm dispatch table); emit-match.ts (block-form match arms); emit-variant-guard.ts (engine/match arm-swap dispatcher; calls `_scrml_remount_each`, S153); build-source-map.ts + source-map.ts + srcmap-provenance.ts (source-map provenance subsystem, S149-S150); emit-html.ts (Bug 60 S157: `enclosingCompoundStack` + `lookupQualifiedStateCell` fallback for render-by-tag inside nested compound wrappers); **S196: `<render of=X/>` render-expression expansion [generateHtml ~L1041-1173] — resolves `of=` to the held value's JS accessor (a `<match>` arm-payload binding or an `@`-cell), builds a per-variant `switch(X.variant)` from `allVariantRenderExprs` + `emitBoundaryMarkupExpr` against the HELD value's `.data`, fills a `<span data-scrml-render-anchor>` innerHTML; emits E-RENDER-NO-OF codegen backstop [:1082]**
compiler/src/codegen/compat/  — compatibility shims for legacy pipeline shapes
compiler/src/commands/  — CLI subcommand implementations: build.js compile.js (S174: `--production`/`--prod` flag at compile.js:170 sets `production:true`, threaded to compileScrml — §20.6 log() strip) dev.js (per-file watcher rewrite, S152; S174: `POST /_scrml/log` client-log forwarding endpoint ~L459 for the §20.6.3 dev unified-view) generate.js init.js migrate.js promote.js serve.js
compiler/src/types/  — pure TypeScript declarations: ast.ts (2006L AST node shapes; S154 `acceptsType?` on EngineDeclNode; **S168 cycles-prereq: `ReactiveNestedAssignNode.path` widened `string[]` → `(string | { index?: ExprNode; raw?: string })[]` for computed bracket-index COW path segments**; S169: `MapLitExpr`/`MapEntry` ExprNode union members; **S174 log()/`any`-reject add NO new AST shapes — both are decl-site/use-site scans over existing nodes; log-loc.ts's `LogLocSpan` interface is codegen-internal, not a FileAST shape**), reachability.ts
compiler/src/reachability/  — reachability sub-passes (5 component passes, entry-points, gate-classifier, outer-fixpoint)
compiler/src/validators/  — attribute validation and lint passes: ast-walk.ts, attribute-allowlist.ts, attribute-interpolation.ts, lint-async-user-source.ts, lint-try-catch.ts, post-ce-invariant.ts
compiler/src/native-parser-canary/  — canary harness for native-parser pipeline parity checks; **within-node-classifier.ts (445L) — the within-node parity classifier; `STRIP_KEYS` set drops pipeline-internal-only node keys before comparison (S166: `bodyStart` added — native LogicEscape/Meta raw-slice host-start coordinate, no live analogue; **S188: `_notPrefixNegation` added — the LIVE-only diagnostic-support stamp `parseExprToNode` puts on a prefix-`not`-as-negation ExprNode to drive E-TYPE-045; native represents `not` as a `NotValue` atom and never stamps, so it's a live-pipeline-internal field, NOT a semantic divergence**)**
compiler/src/native-walker/  — walker utilities for native-parser output traversal; **engine-statechild-walker.ts** (S154 `messageArms` array + S160 ruling (b) `legacyColonPlacement: false` default; **S164 B2: imports `parseMessageArms`/`parseRuleAttrValue` from engine-statechild-parser.ts and populates `messageArms` from `parseMessageArms(bodyRaw).arms` — was hard-coded `[]`**); **NEW S164 attrvalue-exprnode-walker.ts** (`populateNativeAttrValueExprNodes` — stamps `exprNode`/`argExprNodes` on native attr-values by reusing the live `safeParseExprToNodeGlobal`, run from the api.js native branch); **NEW S170 exprtext-backfill-walker.ts** (`backfillNativeExprText` — stamps the legacy string `.expr`/`.init`/`.condition` from structured `exprNode`/`initExpr`/`condExpr` siblings so type-system regex-over-text passes work under native; run from api.js:960)
compiler/native-parser/  — bootstrap native parser (37 `.js` files + paired `.scrml` self-host mirrors); replaces block-splitter+ast-builder at M5-swap; activated via `--parser=scrml-native`. **S162 UPDATE: the native parser NOW promotes BOTH `<each>` → `each-block` (NEW unit A: `isEachBlock`/`synthEachBlockNode` in parse-file.js) AND `<match>` → `match-block` (already promoted via `isMatchBlock`/`synthMatchBlockNode`) to structural FileAST nodes — the S153 "does NOT promote" each/match precondition is CLOSED/RETIRED.** **S164-S165 UPDATE: §51.0.S message-arm (B2), native attr-value `exprNode`/`argExprNodes` population, F2-match string-literal arms, promote-each (3 §17.4 for-stmt gaps), R1 typed-`@cell` decl, and `server function*`+yield ALL LANDED — flip-failures 674→451.** **S166 UPDATE: bare-`function name()! -> Err` failable recognition + cross-file `${...}`-wrapped `export` raw-slice fix LANDED.** **S170 UPDATE: re-measured 605 native-only flip-failures on `df08f282` (default 0-fail / fully green) + landed fix-wave-1 (`5a346faa`: `on mount`/`on dismount`, `const @name` derived-decl [F5 CLOSED], deepset/array-mutation node-synth + destructured-param + var-decl typeAnnotation thread, NEW exprText-backfill walker) + fix-wave-2 (`cc69c62d`: BlockStub `verbatim` match-arm/lambda body recovery — the Mario fix, +17) → ~508 native-only flip-failures.** Remaining native-parser flip-failures are a reduced family set — see the "Native-Parser File Table" below + domain.map.md "Native-Parser Swap Orientation". The `.scrml` mirrors are FEATURE-stale (S162) — native fixes go in the `.js`.
compiler/tests/  — **957 .test.js files total at 5a51c1ca** (verified `find` count) across all categories (S173: +2; S174: log()/any-reject; S175: +5 typed-SQL-row; S176: +6 unknown-type-name/scalar-vocabulary; S177: +8; S179: +2; S180: +5; **S181: +2 [display-text-overquote.test.js, server-keyword-error-msg-canon.test.js]**)
compiler/tests/unit/  — unit tests covering individual compiler passes; +13 S154-S158 files; +2 S159 files (per-item-handler-live-keying-bug73.test.js + html-colon-shorthand-content-model-s159.test.js); **+2 S160 files** (colon-shorthand-inside-opener-s154b.test.js + typed-array-no-rhs-default.test.js); **+1 S167** (deepset-write-loss-position.test.js); **+1 S168** (cow-bracket-write-emit.test.js); **S170 unit:** structural-compound-deepset.test.js + data-set-algebra.test.js + 6 native-parser regression files + native-blockstub-verbatim-body.test.js. 2 prior tests LOCKING the Bug-B mistarget corrected to the SPEC-faithful leaf shape
compiler/tests/integration/  — full compile-to-output verification tests; **S166: m6.4a-native-p2-form1.test.js +§B — emitted-output regression for the native cross-file `export const Name = <markup>` raw-slice fix (`${...}`-wrapped export expands `<Badge/>` in consumer HTML; E-COMPONENT-020/035 GONE)**
compiler/tests/browser/  — browser runtime tests via happy-dom (33+ files; +5 S157-S159; **+1 S167: browser-deepset-write-loss**; **+1 S168: browser-cow-bracket-write**; **+1 S170: browser-structural-compound-deepset**)
compiler/tests/conformance/  — conformance tests for E-/W-/I- code surface; +1 S155: conf-engine-message-dispatch-s155.test.js
compiler/tests/parser-conformance*.test.js  — 10 native-parser parity test files at tests/ root; parser-conformance-within-node-allowlist.json updated S156
compiler/tests/lsp/  — LSP protocol tests (completions, hover, code-actions, diagnostics, workspace)
compiler/tests/helpers/  — shared test utilities and compile harnesses
compiler/tests/fixtures/  — shared fixtures and multi-file app stubs; +1 S155: engine-message-dispatch-s6.scrml
compiler/tests/self-host/  — self-host compiler conformance tests
compiler/tests/commands/  — CLI subcommand integration tests
compiler/runtime/  — embedded client runtime JS (stdlib/idempotency.js; stdlib/ modules; data.js set-algebra helpers S170)
compiler/self-host/  — experimental scrml-native self-hosting compiler output (cg-parts/ + dist/)
compiler/samples/  — MCP v0 fixture sample app with routes/
stdlib/  — scrml standard library (server-side modules; +S176 `math` pure + `random` capability-scoped non-det): auth, compiler, cron, crypto, data, format, fs, host, http, **math**, mcp, oauth, path, process, **random**, redis, regex, router, store, test, time (21 module dirs). `scrml:math` (S176) = pure scalar vocabulary (round/floor/ceil/abs/min/max/clamp/parseInt/parseFloat/toNumber/isNaN). `scrml:random` (S176) = capability-scoped NON-DET random()/randomInt() (E-FN-004 in `fn`, same class as the wall clock). `scrml:time.now()` (S176) = capability clock NON-DET. Each `stdlib/<m>/index.scrml` mirrors a `compiler/runtime/stdlib/<m>.js` shim.
lsp/  — Language Server Protocol implementation (server.js, handlers.js, workspace.js, l4.js)
e2e/  — Playwright end-to-end tests (tests/, fixtures/, playwright.config.ts)
benchmarks/  — performance comparison suites (fullstack-react, fullstack-scrml, todomvc-* variants, sql-batching, llm-efficiency)
examples/  — adopter-facing example apps (23-trucking-dispatch is the canonical large app; ~23 `any`→`asIs` migration sites landed there S174)
samples/  — compilation-test samples and gauntlet suites (individual files not enumerated)
docs/  — project documentation: changelog (per-session narrative SoT, DD3), known-gaps, tutorial, adopter guides, design-ratification logs
docs/changes/  — per-dispatch progress.md + BRIEF.md archives (~110+ change directories; +S166 native dispatch dirs; +S174 log-location-transparency + any-reject dispatch dirs)
docs/heads-up/  — design-ratification decision logs (spec-consolidation, iteration-design, lifecycle-annotation, const-deep-freeze)
docs/deep-dives/  — research artifacts (e.g. log-location-transparency-2026-06-07.md S174; set-warrant-and-shape-2026-06-06.md S170)
docs/audits/  — historical audit artifacts and findings trackers
docs/articles/  — dev.to articles and outreach content
docs/website-viewer/  — C1 self-demo scrml app (viewer shell + real provenance, S151); app.scrml + pages/ + components/ + data/
scripts/  — maintenance + state tooling: regen-spec-index.ts, compile-test-samples.sh, git-hooks/, state.ts (DD3 project-state tool, S172 — see build.map.md)
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
- compiler/src/codegen/emit-engine.ts (4398L) — `emitEngineMessageArmTable()` (§51.0.S batch 3): emits per-engine `__scrml_engine_<varName>_arm_table` keyed by (from-state-tag, message-tag); `engineMessageArmTableName()`, `engineHasMessageArms()`, `collectEnginesWithMessageArms()`, `collectEngineMessageVariants()` exported for threading into emit-each and emit-event-wiring; `parseEnumVariantFieldsForType()` resolves payload-binding field names at codegen time. **S198-S199 engine-hydration arc**: `emitEngineCellHydrationInit`/`...ForFile` (A-leg `initial=@cell` snapshot-once) + `emitEngineServerSourceHydration(meta)`/`...ForFile` [~:1746] (E-leg `server=@source` reactive server-authoritative — `_scrml_reactive_subscribe(rootCell)` → guard-free `_scrml_engine_hydrate_init`, null-safe dotted field-walk, skip-if-absent); both REUSE the shared runtime helper `_scrml_engine_hydrate_init` (no new runtime helper) and the guard-free construction hook (engine stays writable).
- compiler/src/runtime-template.js (+78L at S155) — `_scrml_engine_dispatch_message(varName, msg, armTable, table, timersTable, idleEntry, internalTable, historyMap)` runtime helper (§51.0.S.2); resolves message tag + payload, dispatches to per-state arm fn, calls `_scrml_engine_advance` for the target transition, handles idle-reset on handled message. **S198 (`7532bd8f`)**: NEW `_scrml_engine_hydrate_init(varName, snapshot, validTags, forType)` (~L3817) — the SHARED guard-free engine-hydration construction hook (bare reactive set, NEVER `_scrml_engine_direct_set`) + the decoder-boundary runtime guard `E-ENGINE-INITIAL-INVALID-VARIANT` (a non-`for=T`/absence value at construction throws); reused by BOTH the A-leg `initial=@cell` snapshot and the S199 E-leg `server=@source` reactive hydration.

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

## Key S181 Source Changes (W-DISPLAY-TEXT-OVERQUOTE inverse-footgun lint + deprecated-`server function` diagnostic reword)

Two landings (`0058c462` overquote-lint · `339f37c2` server-keyword diagnostic reword). Both
additive/reword-only; default pipeline output UNCHANGED (the new lint is emit-byte-identical; the
rewords touch only diagnostic/correction strings). No new AST node shapes. type-system.ts grew +244
lines (the new `checkDisplayTextOverquote` walk).

### W-DISPLAY-TEXT-OVERQUOTE — over-quoted display text in a nested plain-markup body (§4.18.7, `0058c462`)
- compiler/src/type-system.ts — NEW `checkDisplayTextOverquote(topNodes, errors, fileSpan)` (line 3949), wired in the TYPE pass at line 17006 (immediately after `checkAnyTypeForbidden`, over the shared `fnFieldTopNodes` node array). The INVERSE/mirror of `E-UNQUOTED-DISPLAY-TEXT`: it fires `W-DISPLAY-TEXT-OVERQUOTE` (info) when a `"..."` display-text literal is the SOLE significant content of a NESTED plain-markup HTML element (`getElementShape(tag) !== null` — HTML only, excludes components + scrml structural elements) inside a code-default body (engine state-child, markup-form match arm, `:`-shorthand body), where the nested element opens a FREE-TEXT body (§4.18.1) so the quotes render literally. Helpers: `isQuotedSoleLiteral` (rejects multi-literal bodies like `"a" and "b"` via an interior-unescaped-quote scan), `isPlainMarkupElement` (element-shape registry gate), `soleQuotedTextChild` (ignores whitespace-only text siblings), `walkBodyMarkup`/`walkTop` (descend every node), `scanRawArmText` (a whitespace-tolerant regex for the RAW arm/shorthand slices — `match-block.armsRaw`, `match-stmt` arm `result`, `shorthandBodyRaw` — that the structured `armBodyChildren` (S177) walk does not cover). It lives in the TYPE pass (full body-mode context) — NOT the lint-ghost regex pre-pass. Emit byte-identical.

### deprecated-`server function` diagnostic reword (no new code, `339f37c2`)
- compiler/src/codegen/emit-functions.ts — the E-FN-004 client-boundary correction `Move it to a server function ...` → `Move it to a server-side function or remove the client boundary.` (5 sites).
- compiler/src/codegen/scheduling.ts — the same E-CG-006 correction reworded `server function` → `server-side function` (3 sites).
- compiler/src/lint-ghost-patterns.js — the W-LINT-019 Solid-kickstarter `correction` Resource clause reworded: `server functions ${ server function fetch() {...} }` → `a server-side function ${ function fetch() {...} } (the server boundary is inferred per §12.2)`. Removes the last in-tree diagnostic still teaching the deprecated `server function` modifier (eliminated S180). Diagnostic-string-only; no code-number change, no behavior change.

## Key S177 Source Changes (g-formfor-in-arms + bug-tail batch + client stdlib-inliner)

Three landings (`b1931f02` bug-tail 6-fix + registry currency · `75f724af` formFor/component
expansion in engine state-children + match arms · `c48c4f71` client stdlib-inliner follows
sibling-shim imports + data.js/auth.js Math de-leak). All additive; default pipeline output
UNCHANGED except where a `<formFor>`/`<Component>` lives inside an engine state-child / match arm
(previously emitted RAW — silent non-render — now expands), an inline map-method assign in a handler
(now lowers through emitAssign), or a stdlib chunk imports a sibling shim (now inlined). type-system.ts
grew to ~20,232 lines; ast-builder.js to ~14,695; block-splitter.js to ~3,026; emit-match.ts to ~1,013;
component-expander.ts to ~3,879; runtime-template.js to ~4,595. ONE new walkable AST field
(`match-block.armBodyChildren`); no new node TYPES; no new error codes.

### g-formfor arc — formFor / component / tableFor expansion inside engine state-children + match arms (`75f724af`)
The markup-EXPANSION passes (CE `walkAndExpand`, type-system formFor/tableFor `walkAndSplice` walkers)
descended into `.children`/`.body` but NOT into an engine-decl's `bodyChildren` (state-child wrappers)
nor a match-block's per-arm body. A `<formFor>` / `<tableFor>` / `<Component>` placed inside an
`<engine>` state-child or a `<match>` arm was therefore left as a RAW tag in the emitted markup
(silent non-render; an empty `onsubmit=${}` formFor also → invalid JS). Closed end-to-end:
- compiler/src/ast-builder.js — NEW `match-block.armBodyChildren` (`buildMatchArmBodyChildren` ~line 12128): Phase-2 re-tokenizes `armsRaw` into a walkable per-arm body markup AST (parallel to the existing raw `armsRaw` codegen path), each wrapper tagged `_matchArmBodyForm: arm.bodyForm`. Falls back to the `armsRaw` re-parse when an arm can't be structurally re-parsed; each-bearing arms keep the codegen `armsRaw` path intact. The match-block id is assigned BEFORE arm-body ids so the arm bodies don't shift the match-block id downstream (g-formfor-in-match-arm, ~line 12106).
- compiler/src/type-system.ts — `walkAndSplice` (the formFor walker, line 15159) now recurses into an engine-decl's `bodyChildren` (`cBodyChildren`, line 15190, **r27-c6**) AND a match-block's `armBodyChildren` (`cArmBodyChildren`, line 15201, **g-formfor-in-match-arm**); the tableFor `walkAndSplice` (line 16395) gains the SAME two-array recursion (line 16423) — both had the `.children`-only blind spot.
- compiler/src/component-expander.ts — `walkAndExpand` (line 2710) recurses into an engine/match node's `bodyChildren` (state-children, line 2881) + a match-block's `armBodyChildren` (line 2883) via IN-PLACE wrapper-array mutation (lines 2856-2880: walks each `bodyChildren` wrapper's own `.children`, then re-enters `walkAndExpand([wrapper])` when the wrapper itself carries nested `bodyChildren`/`armBodyChildren`); cloning the engine/match node is avoided so the use-site sees the expanded arrays.
- compiler/src/codegen/emit-match.ts — `buildMatchArms` (line 522) consumes the expanded `armBodyChildren` wrapper (lookup at line 676-694) for a bare-body arm whose `bodyRaw` contains a `<formFor>`/`<tableFor>` or a PascalCase component opener (gate at line 676-678): the arm body is taken from the EXPANDED wrapper for this variant instead of re-parsing the raw `<formFor>` tag. Plain arms + each-bearing arms stay on the `armsRaw` re-parse path. Memoized on the match-block node (`__scrmlCachedArms`).
- compiler/src/native-parser-canary/within-node-classifier.ts — `STRIP_KEYS += "armBodyChildren"` (line 114) + `"_matchArmBodyForm"` (line 124): LIVE-only fields (no native analogue) dropped before the within-node parity comparison — resolved WITHOUT an allowlist rebump.

### bug-tail 6-fix batch + registry currency pass (`b1931f02`)
- **bug-74** — compiler/src/block-splitter.js `isGenuineShorthandBodyNotDirective(attrRaw, colonOff)` (line 1085): a `/>` self-closer combined with a `:`-shorthand body (`<span :@thing/>`) is `E-CLOSER-001` (line 2598-2600) — distinguishes a GENUINE shorthand body from the `:` directive form (the directive `:` is followed, after the colon, by a directive token). Closes the over/under-fire on `/>`+`:`-shorthand.
- **bug-4** — compiler/src/block-splitter.js refined `looksLikeCloser` (line 2973): the bare-`/` `E-SYNTAX-050` (no-bare-closer) now fires at EOF (`nextNonWs === ""`) OR before a NEW opener (`<` not followed by `/`), but NOT before an actual close tag (`</...`) — a `/` immediately before `</>`/`</tag>` is unambiguous literal markup text (`<li>… /</>`), not a malformed closer. Preserves the CONF-015 EOF contract (`<p>hello/`) while suppressing the slash-before-close-tag over-fire.
- **bug-48** — opener `>`-finder paren/bracket depth tracking: a `>` (or a `/>`) INSIDE a `(...)` / `[...]` in an `on=` expression (`on=@nums.filter(c => c == 1)`) was mis-read as the opener's end, truncating the captured `onExprRaw`. Fixed by porting `parenDepth`/`bracketDepth` tracking to the 3 opener-finders + 2 `on=`-capture loops in compiler/src/ast-builder.js (e.g. the match-block opener-end finder ~line 11956 + the `on=` capture ~line 12009) AND the codegen lowering: compiler/src/codegen/emit-match.ts `resolveOnExpr` (line 272) complex-on= → Shape-B effect-mode lowering (line 343-344, `@nums.filter(c => c == 1)`).
- **r28-7b** — compiler/src/type-system.ts schemaFor predicated-base-in-union recovery (line 15596): a `bio: string req length(<=200) | not` field has a PREDICATED-PRIMITIVE non-`not` member (not an enum subset), so the existing `_schemaForRecoverEnumSubset` returns null and the member stays `asIs` → a bogus `E-SCHEMAFOR-NO-SQL-MAPPING`. Fix recovers the leading primitive token from the raw clause and re-synthesizes `[resolvedPrimitive, not]` so the field rides the same nullable path as the bare `string | not` control (the predicate's CHECK constraints are parsed independently).
- **s169-map-inline-insert** — compiler/src/codegen/emit-event-wiring.ts (line 480-506): an INLINE map-method assign in a handler (`onclick=${@m = @m.insert(k, v)}`) is now routed through `emitExprField` → `emit-expr.ts:emitAssign` (so the map-method RHS lowering fires → `_scrml_map_insert`), NOT the string `rewriteBlockBody` path which left the free fn unresolved → TypeError at click. Single-structured-expression handler bodies use `emitExprField` (line 502-506) when `handlerExprNode` is set.

### client stdlib-inliner follows sibling-shim imports + Math de-leak (`c48c4f71`)
- compiler/src/runtime-template.js — `_loadStdlibChunk(name)` (line 47) now runs the loaded shim source through NEW `_inlineSiblingShimImports(source, shimDir, emitted)` (line 116, exported): a relative `./x.js` / `../x.js` sibling-shim import is INLINED transitively (recursion at line 146, dedup via the `emitted` set so a shim's own definition wins, line 118); an EXTERNAL import (`bun`, `bun:sqlite`, `node:*`, any bare specifier) is STRIPPED (line 128, loud-fail — referenced symbols become undefined rather than crashing the bundle). `_isSiblingShimSpecifier` (line ~175) gates the relative-`.js` test. Mirrors the api.js:302 server-side `bundleStdlibForRun` transitive copy (S176) on the CLIENT runtime-template side.
- compiler/runtime/stdlib/data.js (line 48) + compiler/runtime/stdlib/auth.js (line 38) — Math de-leaked through `scrml:math`: data.js's arithmetic imports `{ min, max, ceil } from "./math.js"`; auth.js imports `{ floor, max } from "./math.js"`. The single sanctioned `Math.*` touch point (S176 `scrml:math`) now also covers these two stdlib shims (http rode it S176); these are the transitive sibling-shim imports the new `_inlineSiblingShimImports` resolves at runtime.

## Key S175 Source Changes (typed-SQL-row arc — the flagship typed-data delivery + function-boundary rule)

Four landings deliver end-to-end SQL-row type-flow (the flagship) + escalate the function-boundary
rule. type-system.ts grew ~990 lines; all new diagnostics are additive type-pass checks; default
pipeline output UNCHANGED; no new AST node shapes (scans over existing nodes + raw SQL text).

### Tranche 1 — typed SQL projection rows + F-SCHEMA-001 (§14.8.7, `45bea7c5`)
- compiler/src/sql-projection.ts (**419L, NEW FILE**) — the SELECT-projection extractor. `extractSelectProjection(query)` → `SelectProjection` { `columns: ProjectedColumn[]` (each: name / `table.col` qualified-source / `AS` alias), `fromAliasMap` (FROM-JOIN alias → table) }. Helpers: `normalizeQuery`, `splitTopLevelCommas`, `parseFromClause`, `resolveProjectionEntry`, `sliceTopLevelFromRegion`, `findTopLevelFrom`. Graceful degradation: `*` wildcard / CTE / UNION / subquery-in-FROM return an under-determined projection that lowers to `asIs` + `W-SQL-ROW-UNTYPED` downstream.
- compiler/src/type-system.ts — `resolveSqlRowType(sqlNode, span, errorSink?)` (line 5676): resolves a `?{ SELECT ... }` host node to a `StructType` projection row by joining `extractSelectProjection` against the generated table types; emits `W-SQL-ROW-UNTYPED` (whole-row ~5710 / per-column ~5773) for the deferred long tail (throwaway errorSink during preflight prevents double-counting). `resolveTableView(table, view)` (line 5653) maps a FROM/JOIN table name to its generated struct. Read sites wired into let/const decl (7150), state-cell SQL init (7390), and the bare host expr (7941).
- compiler/src/protect-analyzer.ts (932L) — **F-SCHEMA-001**: `extractSchemaCreateTableStatements(nodes)` (line 471) synthesizes CREATE TABLE DDL from `<schema>` blocks as a THIRD `ColumnDef[]` source (after the live DB file + the differ), wired in `buildImportGraph`/analyzer at line 686-693 (§39, §14.8). `ColumnDef` interface (line 72), `fullSchema`/`clientSchema` (lines 82-83).
- compiler/src/schema-differ.js — `generateCreateTable(table, driver)` now `export`ed (line 366) so protect-analyzer's F-SCHEMA-001 path can synthesize DDL from a desired-table shape.

### Tranche 2 — SQL-row → `:struct` prop contract + width-subtyping (Shape C, §14.8.8, `1dbf67b4`)
- compiler/src/type-system.ts — `checkSqlRowWidthSubtype(row, contract)` (line 704): the bounded structural width-subtyping helper (for every contract field, the row must carry an assignable same-named field; EXTRA row columns OK; one-directional). `checkPropContract(chk, scopeChain, typeRegistry, errors, filePath)` (line 9491): T2b call-site check — fires **E-SQL-ROW-CONTRACT-MISMATCH** per unsatisfied field, fed by the `__propContractChecks` descriptor. `checkRowFieldAccessInExpr(exprNode, span, scopeChain, errors)` (line 9420) + `resolveIterableRowElement(iterableRaw)` (line 5812): T2a typed-loop-var row access — `r.<col>` resolves to the column type, `r.<unknown>` → E-TYPE-004.
- compiler/src/component-expander.ts (3813L) — `__propContractChecks` stamping (line 2429): when a component prop's declared type is a named `:struct` contract and the passed value is a SQL-projection row, the CE stage stamps a `{ propName, contractType, valueExprNode, span }` descriptor on the call site (line 2442/2460) for the type pass to width-check. Codegen IGNORES `__propContractChecks` (line 2421).

### Tranche 3 — end-to-end SQL-row type-flow (cell boundary + fn-return inference, §14.8.8, `95c25b67`)
- compiler/src/type-system.ts — `checkSqlRowAgainstCellContract(...)` (line 9629): T3b — width-subtypes a projection-row value INTO a `:struct`-typed state cell at the cell boundary (state-cell SQL init ~7548/7608), firing **E-SQL-ROW-CONTRACT-MISMATCH** per unsatisfied field. `inferReturnTypeFromBody(fnNode)` (line 5917): T3c — a server-fn whose body returns a projection row over-approximates its return type, stamping the `<fn-return>` sentinel (`FN_RETURN_TYPE_NAME`, line 631); these inferred over-approximations are EXEMPT from the contract reject (T3c exemption ~9692).

### Function-boundary rule — `E-STRUCT-FUNCTION-FIELD` (§14.3 / §15.11, `9e6156c4`)
- compiler/src/type-system.ts — `FunctionType` interface (line 324) + `tFunction()` constructor (line 830): a function-typed annotation now resolves to a DISTINGUISHABLE `FunctionType` (not opaque `asIs`) via the `resolveTypeExpr` fn-type branch (line 2400, gated by `isFunctionTypeAnnotation` line 2087). `checkFunctionTypedStructFields` (line 3497) escalated from the retired S173 W-TYPE-FN-FIELD nudge to a HARD `E-STRUCT-FUNCTION-FIELD` reject (line 3503-3508), wired at the type pass (line 15917). One reject per fn-typed field; recurses into array-element / nested inline-struct types. Lifecycle annotations `(A to B)`/`(A -> B)` are NOT function types (never reject).
- compiler/SPEC.md — NEW §14.8.8 (cross-file projection-row contracts via structural width-subtyping; the bounded exception to the §14.8.1 nominal wall + the width-subtyping rule + T2a/T2b/T3b worked example); NEW §15.11.5.1 (the passed-vs-stored rule, NAMED — `W-COMPONENT-001` passed-warned and `E-STRUCT-FUNCTION-FIELD` stored-error are two faces of one rule); §14.3 fn-field reject prose (E-STRUCT-FUNCTION-FIELD) + §15.11.2 typed read-only data-prop note + §15.11.2 Fork-3 identity/value note; §34 +2 rows (E-SQL-ROW-CONTRACT-MISMATCH, W-SQL-ROW-UNTYPED) + E-STRUCT-FUNCTION-FIELD. SPEC.md net +171 lines this session (182 added, 11 removed).

## Key S176 Source Changes (unrecognized-type-name reject + `pure`-deprecation + scrml:math / scrml:random / scrml:time.now())

Four landings: close the broad unknown-type-name leak the S174 `any`-reject deferred, deprecate the
`pure` modifier, and add the pure scalar + capability-scoped non-det scalar stdlib vocabulary
(DD1 Fork 1). All additive; default pipeline output UNCHANGED; no new AST node shapes. type-system.ts
grew to ~20,181 lines.

### Unrecognized-type-name reject — `E-TYPE-UNKNOWN-NAME` (§14.1.2, `46cffc83`)
- compiler/src/type-system.ts — `checkUnknownTypeNames(typeDecls, topNodes, typeRegistry, exemptTypeNames, errors, fileSpan)` (line 4232): SYMMETRIC to `checkAnyTypeForbidden` — both drive `forEachTypeAnnotationLocus` (line 3997) so they cover IDENTICAL loci; the difference is the per-leaf predicate. `forEachTypeNameLeaf` (line 3759, `emitMapKeys:false`) classifies each type-NAME leaf (position-aware — NOT the flat `any`-token atomize); `isUnrecognizedTypeNameAtom` (line 3726) tests the BUILT typeRegistry + the exempt set. REGISTRY-DEPENDENT: wired AFTER the imported-types seed at the type pass (line 16464) — vs `checkAnyTypeForbidden` at line 16425 which is registry-free. `exemptTypeNames` = import-specifier names (single-file-mode guard so the flagship `<loadRows>: LoadCardRow[]` doesn't RED-fire on a single-file compile) + machine names (a `@state: M` cell annotates with the machine name, which lives in the machineRegistry not the typeRegistry). Out of v1 scope (NOT scanned): db-block-scoped generated DB type names (live in the scope chain; zero corpus instances), native `.scrml` mirrors (no compile gate, S162), type-as-argument idents (`parseVariant(j, T)`, `formFor for=T`, `reflect(T)` — carry no `typeAnnotation`). Fires fatal **E-TYPE-UNKNOWN-NAME** pointing the author to define / import / spell-fix the type or use `asIs`. Closes the S174 deferred follow-on.
- compiler/SPEC.md — NEW §14.1.2 (unrecognized type names — every type must be a built-in / same-file decl / import / `asIs`); §34 +1 row `E-TYPE-UNKNOWN-NAME`.

### `pure`-modifier deprecation — `W-PURE-DEPRECATED` + Migration 3 (§33, `4a19a047`)
- compiler/src/type-system.ts — `W-PURE-DEPRECATED` (line 7597), gated on `isPure` at the fn-decl walk: fires info-level on ANY `pure`-modified declaration, SUPERSEDING the former narrower `W-PURE-REDUNDANT` (`pure fn` redundancy). The canonical pure form is `fn`. (`W-PURE-REDUNDANT` no longer fires.)
- compiler/src/commands/migrate.js — **Migration 3** (line 197): `[server ]pure[ server ](function|fn) NAME(` → `[server ]fn NAME(` (regex line 214, group-aware so `export pure function`/`server pure`/`pure server` all fall out; idempotent; anchored on the DECLARATION shape so prose mentions of "pure function" are untouched). Counted as `migrations.pure` (line 224); applied after Migrations 1+2 in the same pass; doc/help text updated (lines 12-13/150-158/2089-2090).
- compiler/SPEC.md — §33 DEPRECATED banner (the `pure` modifier is deprecated language-wide; `fn` is canonical pure); §34 row `W-PURE-DEPRECATED`.

### scrml:math + scrml:time.now() + scrml:random — scalar-vocabulary stdlib (DD1 Fork 1, `beb8a115` math+time / `35172d78` random)
- stdlib/math/index.scrml (**214L, NEW**) + compiler/runtime/stdlib/math.js (**66L, NEW**) — `scrml:math` (§41.18): PURE scalar vocabulary — `round`/`floor`/`ceil`/`abs`/`min`/`max`/`clamp`/`parseInt`/`parseFloat`/`toNumber`/`isNaN`. The centralized sanctioned touch point for `Math.*` (deterministic only — `Math.random` is NOT here, it lives in scrml:random as class-C IO). Usable inside a pure `fn`.
- stdlib/random/index.scrml (**88L, NEW**) + compiler/runtime/stdlib/random.js (**36L, NEW**) — `scrml:random` (§41.20): capability-scoped NON-DETERMINISTIC `random()` (float [0,1)) + `randomInt(min,max)` (closed-interval, BOTH bounds inclusive). The one place `Math.random()` is read. SAME capability class as the wall clock — calling either inside a `fn` body is **E-FN-004** (the generalized non-det gate, see error.map.md).
- stdlib/time/index.scrml (now 554L) + compiler/runtime/stdlib/time.js (now 276L) — gained `now()` (§41.19): capability-scoped NON-DET wall clock (the one sanctioned `Date.now()` touch); E-FN-004 inside a `fn`. (The pure `formatDate`/`formatTime`/`formatRelative`/`formatDuration` formatters predate this.)
- compiler/runtime/stdlib/http.js (lines 30-32/194) + stdlib/http/index.scrml (lines 29-31/275) — retry-jitter DE-LEAKED through `scrml:random` (`import { random } from './random.js'` / `'scrml:random'`): http no longer reaches `Math.random()` directly; the one place http reads host entropy now routes through the sanctioned non-det source (this transitive sibling-shim is what `bundleStdlibForRun`'s S176 recursive copy resolves at runtime).
- compiler/src/type-system.ts — **E-FN-004 GENERALIZED** (line 6589 `NONDET_STDLIB` registry + `collectNonDetStdlibBindings` line 6598 + fire at line 17511): the non-det-in-`fn` reject now ALSO fires on imported non-det stdlib bindings (bare `now()` / `random()` / `randomInt()`), not just hard-coded host member-expressions. Registry-driven — the next non-det primitive extends with a `"scrml:module": ["member"]` row.
- compiler/SPEC.md — NEW §41.18 (scrml:math), §41.19 (scrml:time.now()), §41.20 (scrml:random).

## Key S174 Source Changes (location-transparent `log()` builtin + `any`-reject hard line)

Two additive landings. The default pipeline output is UNCHANGED except where `log(...)` is actually used.
No native-parser change; no new AST node shapes.

### log() location-transparent logging builtin (§20.6, `916b8bb3`)
- compiler/src/codegen/log-loc.ts (**224L, NEW FILE**) — the location resolver + runtime chunk:
  `resolveLogLoc(span)` → "basename:line" computed from the call node's byte OFFSET against a `LineIndex` built once-per-file from the source registered via `registerFileSource(filePath, source)` (the node's own `span.line` is unreliable — codegen re-parse stamps `line:1`); `resetLogLoc()` clears the per-compile cache; `fileDeclaresLog(fileAST)` detects a user `log` decl (drives the shadow toggle); `SERVER_LOG_HELPER` is a `String.raw` runtime chunk exporting `_scrml_log_render(v,depth,seen)` (value-faithful renderer, §20.6.4) + `_scrml_log(side, loc, ...)`.
- compiler/src/codegen/emit-expr.ts (~1794L) — `log(...)` call lowering at the `node.callee.kind === "ident" && node.callee.name === "log"` branch (~L1630): (1) a user-declared `log` (`_logShadowedInFile` OR `ctx.declaredNames.has("log")`) → plain call (builtin steps aside; W-LOG-SHADOWED fires at the decl in the type pass, NOT here); (2) `_logProductionStrip` → `(void 0)` (0 bytes, no `_scrml_log` reference, no arg-eval residue); (3) the builtin → `_scrml_log(side, loc, ...args)` where `side = ctx.mode === "server" ? "server" : "client"` and `loc = resolveLogLoc(node.span.start>0 ? node.span : ctx.stmtSpan ?? node.span)`. Module toggles `setLogShadowedInFile(b)` + `setLogProductionStrip(b)`.
- compiler/src/codegen/index.ts — wires it: imports the log-loc + emit-expr toggles (lines 68-69); `setLogProductionStrip(production)` at runCG (line 455); per-file `setLogShadowedInFile(fileDeclaresLog(fileAST))` (lines 587/760).
- compiler/src/codegen/emit-server.ts — prepends `SERVER_LOG_HELPER` (from log-loc.ts, line 15) to the server bundle ONLY when the FINAL emitted JS contains a `_scrml_log(` call (lines 1766-1776; production-stripped / all-client-log builds emit no helper). Also: `_scrml_log_request` for the request-logging middleware (line 724, separate from the builtin).
- compiler/src/codegen/emit-client.ts — `detectRuntimeChunks` (~L1712) includes the `'log'` client chunk ONLY when an emitted line contains `_scrml_log(` (a shadowed or stripped build omits it → zero `_scrml_log` bytes in the prod bundle, F4=A).
- compiler/src/codegen/runtime-chunks.ts — the `'log'` chunk declared in the chunk catalog (line 138; §20.6 location-transparent logging runtime; gated on actual `_scrml_log(` usage, lines 230-236).
- compiler/src/codegen/emit-logic.ts (~3950L) — arm distinction between a user `log` decl (→ W-LOG-SHADOWED) and the bare builtin call (→ `_scrml_log`) at ~L703.
- compiler/src/runtime-template.js — the client-side `_scrml_log`/`_scrml_log_render` runtime (the client counterpart of `SERVER_LOG_HELPER`).
- compiler/src/type-system.ts — `checkLogShadowing(topNodes, errors, fileSpan)` (now line 3620): walks for a `function-decl`/`fn-decl`/`function`/`fn` node with `name === "log"` and fires info-level **W-LOG-SHADOWED** at its span (§20.6.7); wired at the type pass (now line 15920). (Lines shifted +189 by the S175 typed-SQL-row insertions in type-system.ts.)
- compiler/src/commands/compile.js — `--production`/`--prod` flag (line 170) sets `production:true` (line 103/172), threaded into the compile opts (line 279/409/431) and on to `compileScrml`.
- compiler/src/commands/dev.js — `POST /_scrml/log` endpoint (~L459) for the §20.6.3 dev unified-view: the compiled client `_scrml_log` POSTs each tagged client-side log here so the developer sees ONE terminal view (server `log()` already prints to this terminal). Payload `{ side:"client", loc, msg }`.
- compiler/src/api.js — `production = false` compile option (line 586; default false → production builds bit-identical guarantee §19.12.7); threaded to runCG (line 1931-1932).
- compiler/SPEC.md — NEW §20.6 (`log()` Built-in, Location-Transparent Logging; subsections .1 Signature, .2 Origin Tag, .3 Dev unified view, .4 Value rendering, .5 Production strip-to-zero, .6 Levels, .7 Shadowing, .8 Normative Statements); §34 +1 row `W-LOG-SHADOWED` (line 16437). Section count 59. SPEC.md total **31,883L**.

### `any`-reject hard line (`E-TYPE-ANY-FORBIDDEN`, §14.1.1, `f0b3cb04`)
- compiler/src/type-system.ts — **`typeTextMentionsAnyToken(typeText)`** (now line 3678): splits the raw type-annotation string on non-identifier chars and tests for a bare `any` atom (catches `any`/`any[]`/`any | not`/`[string: any]`/`{ payload: any }`; NOT a NAME containing the substring — `Company`/`manyThings`/a param literally named `any`). **`checkAnyTypeForbidden(typeDecls, topNodes, errors, fileSpan)`** (now line 3720): de-dupes by `start:end:where:typeText`, scans struct/error decl field types (`decl.raw` via `scanStructBodyRaw`), cell `typeAnnotation` strings (incl. inline-struct/array/map/union members), and fn-decl `params[]` types + return-type; fires fatal **E-TYPE-ANY-FORBIDDEN** pointing the author to `asIs`. Wired at the type pass (now line 15924), alongside `checkFunctionTypedStructFields` (now 15917, S173/S175) + `checkLogShadowing` (now 15920, S174). `any` is not a scrml type — "there is no any" (S174 user hard line); the named, greppable `asIs` is the only untyped escape hatch (analogous to TS `unknown`). `any`-token-SPECIFIC: an arbitrary undefined type name (`Frobnicate`) that ALSO resolves silently to `asIs` is a SEPARATE broader leak (deferred follow-on arc; `checkAnyTypeForbidden` does NOT attempt it).
- Corpus migration: ~23 `any`→`asIs` sites in examples/23-trucking-dispatch + samples + stdlib/http rode the same wrap commit.
- compiler/SPEC.md — §14.1.1 NEW no-any rule (lines 7431-7437: `asIs` is the sanctioned named opt-out, `any` rejected with E-TYPE-ANY-FORBIDDEN); §34 +1 row `E-TYPE-ANY-FORBIDDEN` (line 16458); §55.9/§36.4.2/§14.8 `any`→`asIs` currency (the §14.8 fix rides the wrap commit, no code).

## Key S173 Source Changes (E-EXPORT-001 reactive state-cell export reject + W-TYPE-FN-FIELD fn-typed struct field)

Two additive, zero-codegen diagnostics (`642950a2`). Default pipeline output UNCHANGED.

- compiler/src/module-resolver.js — **E-EXPORT-001** (§21.2): `collectStateCellNames(fileAST)` (line 97) + `exportedLocalNames(fileAST)` (line 136); the MOD-stage check in `buildImportGraph` (lines 295-313) rejects an `export` clause naming a plain (Shape-1) OR derived reactive STATE CELL (keyed on `kind:"state-decl"`, NOT name-case, so `export const Greeting` / `export <channel>` / exported engines stay legal). SHARED — both pipelines feed `file.ast.exports`. Fatal. Previously the export was SWALLOWED SILENTLY.
- compiler/src/type-system.ts — **W-TYPE-FN-FIELD** (§14.3, Info — **ESCALATED to E-STRUCT-FUNCTION-FIELD (Error) S175; see the S175 block above**): `isFunctionTypeAnnotation` predicate (now line 2087, deliberately conservative so lifecycle fields never mis-fire) + `checkFunctionTypedStructFields(typeDecls, topNodes, errors, fileSpan)` walk (now line 3497; recurses into array-element / nested inline-struct field types), wired at the type pass (now line 15917). S173 fired ONE info-level nudge; S175 fires the hard `E-STRUCT-FUNCTION-FIELD` reject from the SAME walk + the field type now resolves to a distinguishable `FunctionType` (`tFunction()`) not opaque `asIs`.

## Key S167 Source Changes (HIGH multi-statement deep-set / array-mutation write-loss — LIVE)

A single localized addition to the LIVE pipeline; no native-parser change, no codegen change, no SPEC change.

- compiler/src/ast-builder.js (~14180L → **~14231L**, +51) — `parseLogicBody` / `collectExpr` depth-0 statement-boundary block (~line 2747). **The bug (S167 HIGH Bug A):** a dotted-path reactive statement at depth 0 begins a NEW statement, but the existing assignment/compound/typed boundary checks only break when `peek(1)` is `=` / `+=` / `:`. A deep-set's `peek(1)` is `.` (the path opener), so no boundary fired — the PRECEDING statement's `collectExpr` greedily swallowed the whole dotted-path statement into its RHS and it was dropped at codegen. A deep-set / array-mutation survived ONLY as the FIRST statement of a function body; any at position 2+ vanished silently (exit 0, no diagnostic). **The fix:** a new recognizer in the same boundary block forward-scans the `(.ident)+` chain from `peek(1)` and breaks iff the chain TERMINATES as either a deep-set (a bare `=`, not `==`, after the chain → `reactive-nested-assign` §5.2.3) or a 1-segment array-mutation (`@arr.method(` where method ∈ `{push, pop, shift, unshift, splice, sort, reverse, fill}` → `reactive-array-mutation`). The `lastPart !== "="` / `!== "."` guards preserve RHS operand reads (`@y = @x.prop` collects `@x.prop` as the RHS value, not a swallowed statement). **Codegen UNTOUCHED** — the recognized statements route to the existing `reactive-nested-assign` / `reactive-array-mutation` builders. Real-corpus impact: `samples/gauntlet-r11-elixir-chat.scrml` `@messages.push(msg)` after a `let msg = {...}` decl is now emitted (was dropped). Tests: `deepset-write-loss-position.test.js` (16 / 87) + `browser-deepset-write-loss.test.js` (4 happy-dom). Full suite 23,075/0; within-node 1005/0 (+4 native-lag allowlist bump on r11-elixir-chat — native still folds `@arr.push` to bare-expr; correct-shadow, separate swap-grind item).
  - **Bug B — CLOSED S170 (`72aa6836`):** structural-compound deep-set (`<a><ref></>` where `a` lowers to a derived composite) emitted a write to `a` instead of the leaf `a.ref`, clobbered by the derived recompute — failed at runtime even for a SINGLE deep-set. A CODEGEN mistarget distinct from the S167 PARSER fix; fixed via the `reactive-deps.ts:stampCompoundDeepSetTargets` retarget — see "Key S170 Source Changes" above.

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

### S164 flip re-measure (mid-session) → S165 → S166 (current)
- **451 flip-failures at S165 close** (674 S164-start → 509 S164-close → 451 S165; from ~790 S162, 1,150 S161). Full-suite at S165: 23,054 pass / 0 fail / 912 files; within-node parity **1005/0**. **S166 landed two re-triage roots (bare-`function` failable + cross-file `${...}`-export) without a full flip re-measure — next dispatch re-runs the harness.** The native parser remains STRICTLY OPT-IN (`--parser=scrml-native`); default output UNCHANGED (no version bump S162-S166 — parity-closers are shadow-only). **The Phase-A default-flip is a STANDING USER DECISION; PA ships parity-closers, never the flip.** See "Key S164-late + S166 Source Changes" below + domain.map.md "Native-Parser Swap Orientation" for the next-pick family table.

## Key S164-late + S166 Source Changes (native-parser-swap parity-closers — 674→451 + S166 re-triage roots)

All land in the native `.js` (the `.scrml` mirrors are FEATURE-stale, S162). Default pipeline untouched.

### S164 B2 — §51.0.S engine message-arm parity (parser-level) (7cbad5dd) + exprNode population (c1566faa)
- **F1-narrow + B2 (`7cbad5dd`):** `parse-markup.js` recognizes the leading-`|` message-arm region (was spurious `E-UNQUOTED`). `collect-hoisted.js synthEngineDecl` reads `accepts=MsgType` → `acceptsType` (null-when-absent; live ast-builder.js:12622 parity). `native-walker/engine-statechild-walker.ts` imports `parseMessageArms` and populates `messageArms` from `parseMessageArms(bodyRaw).arms` (was `[]`). Native `engineMeta` byte-identical; within-node 1005/0; +5 tests.
- **native attr-value `exprNode`+`argExprNodes` population (`c1566faa`, cross-cutting):** NEW `compiler/src/native-walker/attrvalue-exprnode-walker.ts` exports `populateNativeAttrValueExprNodes` — descends the native FileAST, stamps `exprNode` (expr/variable-ref values) + `argExprNodes` (call-ref args) by reusing the live `safeParseExprToNodeGlobal` (now EXPORTED from ast-builder.js — the only S164 change to that file) with the SAME `(raw, span.start)` pairing the live path uses → emitted ExprNode byte-identical to live. Run from `api.js:945` inside the native `_buildAST` branch (native-path-ONLY). R26(A)+R26(B) byte-identical; **§51.0.S message-dispatch family FULLY native-parity end-to-end**; 12 handler files → 0 native `E-CODEGEN-INVALID-JS`. Residual: +34 SPAN-COORD benign (native attr-value span block-relative inside lift/each; emit byte-identical).

### S165 F2-match — string-literal match-arm patterns (2c2e5bb2, §18.16)
- `ast-expr.js` — `MatchArmPatternKind.Literal` + `makeLiteralPattern(litKind, raw, value, span)`.
- `parse-expr.js` — `StringLit` branch in `parseMatchArmPattern` → `makeStringLit` literal arm.
- `translate-expr.js` — `reconstructArmPattern` `Literal` case (reconstructs the source-text pattern).
- Fixes `match action { "add" => {...} }` arm-parse failures (was `E-EXPR-MATCH-PATTERN` / "unexpected Arrow").

### S165 promote-each — 3 §17.4 for-statement parity gaps (785f24d1)
- `translate-stmt.js` — `makeForStmtCStyle`/`makeForStmtInOf` synthesize the iterable-field text (incl. trailing §17.4b `key <expr>`); serialize `keyExpr`/`elseBody`.
- `parse-stmt.js` — §17.4b `key <expr>` clause (`keyExpr = parseAssignmentExpr`) + §17.4a `else` empty-state block (`parseForElseBody`) in the for-header.
- `ast-stmt.js` — `makeFor`/`makeForIn`/`makeForOf` carry `keyExpr`+`elseBody` params (null-when-absent).

### S165 R1 — typed `@cell` declaration `@name: Type = e` (89912bb9, enum-subset decomp)
- `parse-stmt.js` — `parseTypedAtStateDecl` recognizes `@name: Type = e` (typed at-state decl; was rejected as `@`-prefixed decl).

### S165 server-fn-star — `server function*` lift + yield-body translate (26a24b71, 2 roots)
- `parse-markup.js` — `BARE_DECL_RE` synced VERBATIM with live ast-builder.js:399 (admits the R25-Bug-42 generator form `server function*` / `fn*` / `function*` via `[*\s]`) so the `server function*` declaration LIFTS.
- `translate-stmt.js` — `Yield`-expression statement unwraps to `makeYieldStmt` (native parses `yield` as an ExprKind.Yield; the live shape needs a `yield-stmt`).

### S166 bare-`function` failable — `function name()! -> Err` recognition (76059024, re-triage #1)
- `parse-stmt.js` (**4255L**) — `parseFunctionDecl` (parse-stmt.js:1695) now consumes the trailing `!` failable marker + optional error-type annotation AFTER the param list and BEFORE the `-> ReturnType` annotation, ported VERBATIM from `parseScrmlFunctionDecl` (parse-stmt.js:1901). Two shapes: (1) `! -> ErrorType` arrow form (SPEC §19.4.1); (2) bare `! ErrorType` form (SPEC §41.14) with R25-Bug-36 continuation disambiguation — the IDENT must NOT be a function-decl attribute kw (`route`/`method`) AND the following token must be a well-formed decl-head continuation (`{` / attr-kw / `.idempotent` / `:` / `->` / `;` / EOF). Threads `{canFail,errorType}` as `makeFunctionDecl`'s **7th arg** (was 6 → metadata silently dropped to `canFail=false`); `fnKind` stays `"function"`. New native error `E-STMT-FN-ERROR-TYPE` on a malformed `! ->` (no ident after the arrow). Closes the bare-`function` failable parse gap (`fn`/`server`/`pure` already worked; defect surface ~31 failable-via-`function` test files).
- `ast-stmt.js` (605L) — `makeFunctionDecl(name, params, body, isAsync, isGenerator, span, modifiers)` already accepts the trailing optional `modifiers` object (`{ fnKind, isServer, isPure, isPinned, canFail, errorType }`, B6 M5-swap Wave 1); S166 is the parse-side caller now actually passing `{canFail,errorType}`.
- within-node parity 1005→991→1005: residual-preserving rebump of 27 class-budgets across 14 failable fixtures whose now-reachable bodies surface pre-existing native residuals (mostly SPAN-COORD/FIELD-SHAPE; a small MISSING-FIELD/EXTRA-FIELD/KIND-NAME cluster on examples/09-error-handling = native field-synthesis incompleteness on NOW-PARSED failable-body nodes — exposed-not-caused; banked native-completeness follow-up). Full suite 23,054/0.
- **BANKED (STOP-IF-DIVERGENT, not landed):** native empty `fail X::V(arg)` envelope (function + fn forms) + native `renders ${id}` interpolation break — separate families.

### S166 cross-file `${...}`-export raw-slice — `bodyStart` anchor (9d12d980, re-triage #2 ROOT-2)
**The bug:** native `synthExportDecl` sliced the export's raw source by subtracting `blockSpan.start` (the opener `$`/`^` char) from the HOST-absolute child Stmt span. For a `${...}`-wrapped `export const X = <markup>` the bodyText actually begins at `frame.openSpan.end` (one byte past `${`), so the subtraction over-shifted LEFT by the opener length → `hi` overshot `blockText.length` → the `hi <= len` guard failed → `raw=""` → cross-file CE path-b had no markup to register → spurious E-COMPONENT-020/035 at `<Badge/>` use-sites. Same off-by-opener class as M6.7-C1 `synthComponentDef`.
- `compiler/native-parser/collect-hoisted.js` (**900L**) — `synthExportDecl(stmt, stamp, blockText, blockSpan, bodyStart)` now computes `sliceBase = (typeof bodyStart === "number") ? bodyStart : blockSpan.start` and slices `lo/hi = stmt.span.{start,end} - sliceBase`. `walkStmts` carries `bodyStart` through the recursion and threads it into both `synthExportDecl` and `collectComponentDefs(... bodyStart)`; `synthComponentDef(... bodyStart)` accepts it for symmetry but `void`s it (its `init.span` is already bodyText-RELATIVE). The `blockSpan.start` fallback preserves the working file-top / synthesized-block path byte-unchanged.
- `compiler/native-parser/parse-markup.js` (**3109L**) — stamps `block.bodyStart` at the **4 body-attach sites**: the `${...}` InLogicEscape branch + the `^{...}` paired branch in `emitContextBlock` (where `bodyStart === frame.openSpan.end`, DISTINCT from `block.span.start`), and `synthLiftedLogicBlock` + `synthPairedLogicBlock` (where `bodyStart === span.start` = `anchorStart`, so the file-top path is byte-unchanged).
- `compiler/src/native-parser-canary/within-node-classifier.ts` (**445L**) — adds `bodyStart` to `STRIP_KEYS` (a native-parser-internal raw-slice coordinate the LIVE block tree has no analogue for; a retained `channelDecls` raw LogicEscape child can surface it into the FileAST — pipeline-internal metadata, NOT a semantic divergence). **Resolved WITHOUT an allowlist rebump.**
- **PA-independent verify:** native cross-file consumer compiles clean (E-COMPONENT-020/035 GONE), `<Badge/>` markup expands in consumer HTML, node --check OK; within-node 1005/0; cross-file integration 48/0; +1 emitted-output regression (m6.4a-native-p2-form1.test.js §B).
- **ROOT-1 BANKED (agent-reverted + deferred):** the exported-inner-decl-reaching-codegen emit-fix worked but surfaced a 58-fixture within-node divergence needing 2 prereqs — deep-shift promoted spans by `bodyStart` + the native FunctionDecl trailing-match-as-return + return-type-annotation drop (the latter reproduces on NON-exported fns too — a separate native gap).

### S164 earlier-landed families (already counted in the 674→509 drop)
- **lift `<markup>` close-tag (`649f4ef8`):** `lex-in-code.js` `/`-branch no longer reads `</li>`'s `/` as runaway regex-to-EOF (big lift family).
- **F2a chained `?{}.method()` (`7e54f321`):** `translate-stmt.js reconstructChainedSql` — chained-form SQL promotion in statement position (ret/let/const/bare-expr).
- **table-for struct-field-drop (`66301357`):** `parse-stmt.js typeBodyText`/`joinWithNewlines` preserve struct/enum field-separator newlines (was: `<tableFor>` emitted only the first struct `<th>`).

### Native-Parser File Table (S170) — swap-grind orientation

The native parser is `compiler/native-parser/` (37 `.js` files; paired `.scrml` mirrors are
FEATURE-stale — fix the `.js`). Key files by role + the swap-family each owns:

| File | Lines | Role | Owns family |
|------|-------|------|-------------|
| `parse-stmt.js` | 4482 | statement parser (decl / fn / export / control-flow); **S170 (`5a346faa`): `on mount`/`on dismount` lifecycle blocks (§6.7.1 desugar) + `const @name` → `parseConstAtStateDecl` derived-state-decl (F5 CLOSED)**; S166: `parseFunctionDecl` consumes the trailing `!` failable marker + `! -> Err`/bare `! Err` error-type, threads `{canFail,errorType}` as `makeFunctionDecl` 7th arg; S165: `parseTypedAtStateDecl` typed-`@cell` decl (R1); §17.4a `else` empty-state + §17.4b `key <expr>` clause in for-header; `typeBodyText`/`joinWithNewlines` struct-field newline preservation (table-for) | F6/F9 (fn param / export-fn-body) |
| `parse-expr.js` | 4368 | expression parser; match/if-as-expr; `isAtArmBoundary` arm-boundary; **S170 (`cc69c62d`): `parseBlockStub` stamps `stub.verbatim` (balanced `{...}` source slice; `finishArrow`/`parseFunctionExpr` stamp full-lambda verbatim; render-body scope-guard skips lift/markup arm bodies) — the Mario block-body recovery**; S165: `StringLit` branch in `parseMatchArmPattern` → `makeStringLit` literal arm (F2-match) | F3 (if-as-expr residual — same-line + string-lit arms DONE S162/S165) |
| `parse-markup.js` | 3109 | markup body parser; MK3.3 display-text detection; `classifyTagFrame`; emits `E-UNQUOTED-DISPLAY-TEXT` (§4.18.7); **S166: stamps `block.bodyStart` at 4 body-attach sites (LogicEscape/Meta `${...}`/`^{...}` + synthLifted/synthPaired) for the hoist-side raw-slice anchor (cross-file `${...}`-export fix)**; S165: `BARE_DECL_RE` synced with live (admits `server function*`/`fn*`/`function*` generator form); S164 F1-narrow: recognizes leading-`|` message-arm region (was spurious E-UNQUOTED) | **F1** markup-classification half; B2 (msg-arm region) |
| `tag-frame.js` | 2402 | TagKind classification; `STRUCTURAL_ELEMENTS`; `tagKindFor`; void-element registry; attr-value construction (~L1079/1095/1125/1130/1153) builds `{kind:"expr"\|"variable-ref",raw,refs,sourceText,span}` WITHOUT `exprNode` | F1, F7; **attr-value `exprNode` family CLOSED S164** — `exprNode`/`argExprNodes` are stamped POST-parse by `native-walker/attrvalue-exprnode-walker.ts` (run from api.js:945), NOT inside tag-frame.js; cross-cutting ~162 files now native-parity |
| `translate-stmt.js` | 2442 | native-AST → live-shape statement translation; **S170 (`5a346faa`): deepset/array-mutation node-synth (`reactive-nested-assign`/`reactive-array-mutation` → COW + trigger, routing through the S170 Bug-B-fixed emit-logic) + destructured-param structuring (E-SCOPE-001) + var-decl `typeAnnotation` thread (E-VARIANT-AMBIGUOUS → E-CONTRACT-001)**; S165: `makeForStmtCStyle`/`makeForStmtInOf` iterable-field synth + `keyExpr`/`elseBody` serialize (promote-each); `Yield`→`makeYieldStmt` unwrap + `reconstructChainedSql` (F2a chained `?{}.method()`) | — |
| `parse-file.js` | 1671 | top-level file parser; block→ASTNode mapping (`mapOneBlock`); each/match structural promotion (S162); `collectMachineDeclsFromNodes` engine-substrate single-instance share + `synthEngineNode` `bodyChildren`→AST mapping (S163) | each/match promotion; engine substrate (CLOSED S163) |
| `translate-expr.js` | 1251 | native-AST → live-shape expression translation; AtCell `@.` arm; bare-`reset`-callee → live `reset-expr` node (B1, S163); **S170 (`cc69c62d`): `reconstructArmBody` returns `body.verbatim` (was literal `"{}"` → dropped statements); `translateArrow`/`translateFunctionExpr` emit a full-lambda `EscapeHatchExpr` (reuses `emitEscapeHatch`) — the Mario match-arm/lambda-block fix**; S165: `reconstructArmPattern` `Literal` case (F2-match) | B1 reset-expr (DONE S163) |
| `collect-hoisted.js` | 900 | hoisted-declaration collection pass; **S166: `synthExportDecl`/`collectComponentDefs`/`walkStmts` thread `bodyStart` so the export raw-slice anchors to the bodyText host-start (`block.bodyStart`), fallback `blockSpan.start` — fixes `${...}`-wrapped cross-file export expansion (E-COMPONENT-020/035 gone)**; `synthEngineDecl` REMOVED S163 (was the engine second-instance source); S164 B2: `synthEngineDecl` (engine-decl synth path) now reads `accepts=MsgType` → `acceptsType` (null-when-absent, live ast-builder.js:12622 parity) | — |
| `synthEngineDecl` (collect-hoisted.js engine synth path) | — | builds the engine-decl from `<engine>` openers; S164 B2 LANDED: reads `accepts=MsgType` → `acceptsType` (null-when-absent, live parity); still no `effect=` openerEffect read | B2 (§51.0.S message-arm) **CLOSED S164**; `effect=` opener gap (OPEN, small) |
| `native-walker/engine-statechild-walker.ts:~520` | — | walks engine state-children into `EngineStateChildEntry`; S164 B2 LANDED: `messageArms` now from `parseMessageArms(bodyRaw).arms` (was hard-coded `[]`) | B2 (§51.0.S message-arm) **CLOSED S164** |
| `native-walker/exprtext-backfill-walker.ts` | 200 | **NEW S170 (`5a346faa`):** `backfillNativeExprText(ast)` post-parse walker stamps the legacy string `.expr`/`.init`/`.condition` fields from the structured `exprNode`/`initExpr`/`condExpr` siblings so the type-system's regex-over-text passes work under native (mirrors the S164 attrvalue walker; run from api.js:960). NOT in the native-parser/* tree. | GROUP W (lifecycle/enum-subset text-pass parity) |
| `lex-in-code.js` | 867 | code-default lexer; `@.` contextual-sigil branch (S162 unit C) + `@ident`; S164 lift `<markup>` close-tag fix (`/`-branch no longer reads `</li>` as runaway regex-to-EOF) | — |
| `display-text-literal.js` | 640 | display-text literal scanner; emits `E-UNQUOTED-DISPLAY-TEXT` | F1 (spurious-fire surface) |
| `ast-stmt.js` | 605 | native statement AST node constructors; **S166: `makeFunctionDecl` 7th-arg `modifiers` object carries `{canFail,errorType}` (B6 shape, now populated by parse-stmt.js)**; S165: `makeFor`/`makeForIn`/`makeForOf` carry `keyExpr`+`elseBody` params (promote-each §17.4a/b) | — |
| `block-context.js` | 553 | block-context frame tracking | — |
| `parse-css-body.js` | 536 | CSS body parser | — |
| `parse-seam.js` | 427 | code↔markup seam parser | — |
| `parse-error-body.js` | 344 | `<errors>` block body parser | — |
| `token.js` / `token-cursor.js` / `cursor.js` | 273 / 102 / 59 | token + cursor primitives | — |
| `ast-expr.js` | 493 | native expression AST node constructors; S165: `MatchArmPatternKind.Literal` + `makeLiteralPattern` (F2-match) | — |
| `body-mode.js` | 227 | body-mode dispatch (code/markup/sql/css) | — |
| `parse-state-body.js` | 235 | engine/db/schema state-child classification (`tagKindFor`, `ENGINE_FORM_KEYWORDS`, `isStateBlock` exclusion) | F1 markup-classification (engine-substrate drop was the dominant F1 cause — CLOSED S163 via parse-file.js, not here) |
| `parse-sql-body.js` | 182 | SQL body parser (`?{}` server-fn SQL) | F2 (drops SQL body in top-level server fns) |
| `parse-mode.js` / `lex-mode.js` / `parse-ctx.js` | 114 / 34 / 124 | mode + parse-context state | — |

**B2 §51.0.S engine message-arm — CLOSED S164** (`7cbad5dd` + `c1566faa`): `collect-hoisted.js synthEngineDecl`
reads `accepts=MsgType` → `acceptsType`; `native-walker/engine-statechild-walker.ts` populates `messageArms`
from `parseMessageArms(bodyRaw).arms` (live `engine-statechild-parser.ts parseMessageArms()` is the mirrored
oracle — SPEC §51.0.S + §51.0.G.1 + §51.0.B `accepts=` row); `attrvalue-exprnode-walker.ts` stamps the
attr-value `exprNode`/`argExprNodes` so the full §51.0.S message-dispatch family is native-parity end-to-end.
**F1 engine-substrate (the ~168 dominant cause) is CLOSED S163**; the residual `E-UNQUOTED-DISPLAY-TEXT`
§4.18.7 fire is SPEC-CORRECT (native enforces, live lenient), NOT a native bug — corpus bare-text→`"..."`
migration is deferred swap-prep backlog.

**S166 re-triage roots — CLOSED:** bare-`function name()! -> Err` failable (`parse-stmt.js parseFunctionDecl`
7th-arg `{canFail,errorType}` thread) + cross-file `${...}`-wrapped `export const X = <markup>` raw-slice
(`collect-hoisted.js synthExportDecl` anchors to `block.bodyStart`, stamped by `parse-markup.js`; `bodyStart`
added to within-node-classifier STRIP_KEYS). The S166 triage is `docs/changes/native-swap-retriage-s166/TRIAGE.md`.

**Next-pick families (open at S165, 451 flip-failures — re-measure: S166 closed two roots without a re-run —
see domain.map.md "Native-Parser Swap Orientation" for the full table):** F2 SQL `?{}` assign-RHS /
state-decl-routed (small) · F4 formFor expansion (~32) · F5 `const @name` derived-decl (~20, `parse-stmt.js`
rejects `@`-prefixed decl) · F6/F9 fn-param / export-fn-body · F7 missing diagnostics (body-parser gates
swallow `E-STRUCTURAL-ELEMENT-MISPLACED`) · `effect=` opener (§51.0.H Form 3, small — `synthEngineDecl` has no
openerEffect read) · mario PowerUp payload-enum (native drops payload variants) · enum-subset
struct-constructor `Type { field: val }` in expr position (multi-stage, AVOID single dispatch) · r24-bug-31
if-as-expr/`<state>` block (multi-gap, AVOID). F8 stdlib `await import()` is a stdlib-migration task, NOT a
native-parser change. The full S164 triage is `docs/changes/native-swap-triage-s164/TRIAGE.md`.

## Key S179 Source Changes (E-ROUTE-003/004 enforcement + I-FN-PROMOTABLE inferred-server skip + E-FN-001 broadening)

- **compiler/src/type-system.ts** — `checkRouteSerializability` [type-system.ts:3604]: PARAM direction fires NEW **E-ROUTE-004** [~3780/3795] + RETURN direction now fires **E-ROUTE-003** (was SPEC-text-only) [~3809/3818]. Both share the same walk (struct fields / union members / map values / array elements); `asIs` fields are allowed as escape hatch; SSE generators skip the return-direction check. Wired at type-system.ts:16809 alongside the prior RI-based wiring. `checkLiftInFn`: now skips an inferred-server fn (body-content-escalated without the `server` keyword) for the E-SYNTAX-002 lift-in-fn check [type-system.ts:14385/14525] — the keyword is absent but the fn IS server.
- **compiler/src/lint-i-fn-promotable.js** — `runIFnPromotable` [line 84] receives NEW `inferredServerKeys` param (a `Set<string>` of `"${filePath}::${span.start}"` keys for functions RI escalated to server by body-content triggers); `isStructurallyEligible` [line 242] skips any function whose key is in the set — promoting it to `fn` would silently strip server semantics. Built in api.js from the RI route map [api.js:1791].
- **compiler/src/api.js** — I-FN-PROMOTABLE invocation [api.js:1778-1811] now builds `inferredServerKeys` from the RI route result map (all records with `boundary:"server"` that lack `node.isServer===true`) and passes it to `runIFnPromotable`. E-FN-001 broadening: no api.js change required (the type-system fix is self-contained).

## Key S180 Source Changes (server-keyword-eliminate arc: T7/T8 triggers + D1 keyword→inferred-boundary + Migration 4)

### D1 — `server` keyword non-load-bearing in codegen (`0dd50a7d`)
- **compiler/src/codegen/emit-client.ts** — wire-chunk gate [~line 749]: keyed on the INFERRED server boundary from the route record instead of `node.isServer` (the keyword flag). A keyword-free inferred-server function (escalated by T7/T8) now correctly receives the server wire-chunk. Comment at line 264 explains the change.
- **compiler/src/codegen/mcp-descriptors.ts** — MCP RPC discovery [~line 845/862]: `isServerBoundary(node)` now also checks the RI route-map boundary in addition to `node.isServer === true`, so MCP tool discovery covers inferred-server functions lacking the explicit `server` keyword.
- **compiler/src/type-system.ts** — `checkLiftInFn` skip for inferred-server (see S179 above; landed in D1 because it was discovered during the keyword-non-load-bearing audit).

### D2 — T7/T8 escalation triggers + W-DEPRECATED-SERVER-MODIFIER (`bf4e51c4`)
- **compiler/src/route-inference.ts** — **Trigger 7** (channel-cell-write / broadcast() / disconnect() → server): `extractChannelBroadcastReasons(fnNode, channelCells)` [~line 1375] scans the function body for LHS writes to a channel-scoped reactive cell + `broadcast`/`disconnect` call-patterns; returns `channel-broadcast` reasons. Folded into the inferred-boundary computation at [~line 2544-2568]. SPEC §38.4/§38.6 relaxed: `broadcast()`/`disconnect()` now legal in any channel-scope function. **Trigger 8** (reserved-name `handle` → middleware): a function named `handle` gets `middleware-handle` reason [~line 2576-2578], escalating to middleware boundary (§39.3.2). `isSSE = isServer && isGenerator` codified at [line 3375]. **W-DEPRECATED-SERVER-MODIFIER** Step D5 [~line 3089/3097/3130/3197]: after computing `allReasons`, if the function has `isServer===true` AND `allReasons.length>0`, fires Info-level W-DEPRECATED-SERVER-MODIFIER. Suppressed for `handle`-named functions [line 3097] and SSE `function*` generators.
- **compiler/src/ast-builder.js** — channel-scope cell registry threaded to route-inference for Trigger 7 detection; minor span adjustments for W-DEPRECATED bare-decl location [D3.1 `862cdcb6`].

### D3 — Migration 4 (`e1d4f88c` + `862cdcb6` D3.1)
- **compiler/src/commands/migrate.js** — **Migration 4** [line 626]: diagnostic-driven `server function NAME(` → `function NAME(` strip. Harness `runMigration4Harness(source, filePath)` [~line 662] compiles the file, extracts W-DEPRECATED-SERVER-MODIFIER diagnostics, and returns them. `applyMigration4(source, filePath)` [~line 734] iterates the diagnostics: at each `span.start`, forward-scan for `server function NAME(` (handling `pure`/`async` prefixes), strip the `server ` prefix in-place, right-to-left for span stability. `function*` generators excluded. Fail-closed (compile failure → no edit). **D3.1** (`862cdcb6`): lift-suppression — W-DEPRECATED-SERVER-MODIFIER does NOT fire on a `server function` that lacks independent triggers (the non-triggered case); Migration 4 makes no edit there. Bare-decl span fix in ast-builder.js [D3.1] so the `span.start` for function-level `server function NAME(` correctly anchors to the declaration keyword.

### D4a — example migration (`7f641010`)
- **examples/03/07/08/09/14/15/17/19/20 + examples/23-trucking-dispatch/channels/*.scrml** — `server function` declarations migrated to plain `function` (T7/T8 now supply the server boundary via the channel-scope or route triggers). 13 example files + 4 trucking-dispatch channel files.
- **compiler/tests/parser-conformance-within-node-allowlist.json** — reconciled for channel-file shape changes introduced by the example migration.

## Key S182 Source Changes (engine `effect=` diagnostics — E-ENGINE-EFFECT-NOT-INTERPOLATED + dedup engine-var double-fire)

One substantive landing (`aba5392f`). Diagnostic/parser-only — ZERO codegen change; default pipeline
output unchanged for canonical `${...}` engines. No new AST node shapes (parser adds two
diagnostic-support boolean flags on the engine-decl).

### E-ENGINE-EFFECT-NOT-INTERPOLATED fire + parser `effectMalformed` threading (`aba5392f`)
- compiler/src/symbol-table.ts (+95) — NEW `fireEngineEffectNotInterpolated(decl, locus, subject, badSlice, errors, filePath)` [line 5447] pushes `E-ENGINE-EFFECT-NOT-INTERPOLATED` (severity error) at BOTH loci: the `<engine>` opener boot-effect (SYM PASS 10.A, `locus:"opener"`, §51.0.H Form 3) and a state-child `effect=` (SYM PASS 17, `locus:"state-child"`, §51.0.H Form 1) — driven by the parser `openerEffectMalformed` / `effectMalformed` flags. Previously a bare value was captured as null and SILENTLY tree-shaken. ALSO Fix 2: the E-ENGINE-VAR-DUPLICATE / E-ENGINE-003 double-fire is now de-duped via a symmetric gate `isLegacyMachine = engineDecl.legacyMachineKeyword === true` [line 5395] — canonical `<engine>` fires E-ENGINE-VAR-DUPLICATE only; legacy `<machine>` fires E-ENGINE-003 only (exactly one code per form).
- compiler/src/ast-builder.js (+39) — markup branch captures the opener `effect=` value and stamps `openerEffectMalformed` / `openerEffectBadSlice` on the engine-decl when the value is bare / non-`${...}` / empty-braces.
- compiler/src/engine-statechild-parser.ts (+24) — state-child `effect=` parse: recognizes the attribute and sets the `effectMalformed` flag on the state-child result when the value is not the required `${...}` logic-block form.
- compiler/src/type-system.ts (+25) — engine `effect=` threading adjustments paired with the SYM fire (legacy `<machine>` E-ENGINE-003 ownership half of the symmetric dedup gate).
- compiler/src/native-walker/engine-statechild-walker.ts (+21) — NEW `isMalformedEffect(attrs)` parity helper mirrors the live `effectMalformed` flag (state-child §51.0.H Form 1) so the dual-pipeline parity test holds: `effect=` present but value is `absent` / non-`expr`-kind / empty `${ }` → malformed.
- compiler/src/native-parser-canary/within-node-classifier.ts (+11) — `STRIP_KEYS += "openerEffectMalformed" + "openerEffectBadSlice"` (LIVE-only diagnostic-support fields; the native parser has no opener `effect=` read — that opener-effect native gap stays OPEN — so it never carries these; pipeline-internal metadata, NOT a semantic divergence). Resolved WITHOUT an allowlist rebump.

## Key S183 Source Changes (formFor/tableFor unimported hard-error + tailwind dynamic-class precision + fn/pure canonicity reframe)

Three substantive landings (`10d94a29` formFor/tableFor unimported hard-error · `88a3ac48` tailwind
dynamic-class-prefix lint precision · `5d502d59` fn/pure canonicity reframe — docs/string/comment-only).
All additive diagnostic / lint-precision / prose; ZERO codegen change; no new AST node shapes.

### E-FORMFOR-NOT-IMPORTED / E-TABLEFOR-NOT-IMPORTED — unimported L22-element detection seam (`10d94a29`)
- compiler/src/type-system.ts — NEW shared helper `scanForUnimportedTypeDataElement(nodes, tagCamel, code, specRef, errors, defaultSpan)` [type-system.ts:15830]. It is the `else`-arm of the two expansion gates: when `formForLocals.size === 0` the formFor expansion walker never runs, so the scan fires `E-FORMFOR-NOT-IMPORTED` (call [type-system.ts:7272], §41.14.1); symmetric `tableForLocals.size === 0` fires `E-TABLEFOR-NOT-IMPORTED` (call [type-system.ts:7422], §41.16.1). The helper mirrors the expansion walker's exact descent (`children` / `body` / `bodyChildren` / `armBodyChildren`) and a literal-tag predicate (`tag === tagCamel || tag === tagLower`); it does NOT recurse into an offending node's own children (mirrors the walker's `continue`). One `TSError` per offending node (fan-out), severity Error. Previously the unimported element fell through to emit-html as a literal `<formFor>`/`<tableFor>` tag and silently rendered nothing. +6 tests + a coupled date/timestamp fixture import-fix.

### W-TAILWIND-001 / W-TAILWIND-UNRECOGNIZED-CLASS dynamic-class-fragment skip (`88a3ac48`)
- compiler/src/tailwind-classes.js — NEW `findInterpolationRanges(value)` [tailwind-classes.js:2109] returns the `[start, end]` byte ranges of every `${...}` interpolation in a class-attribute value; NEW `tokenTouchesInterpolation(tokenStart, tokenEnd, interpolationRanges)` [tailwind-classes.js:2152] tests whether a class token is glued to / overlaps any such range. Both lint scan loops now skip interpolation-touching tokens: `findUnrecognizedClasses` (W-TAILWIND-UNRECOGNIZED-CLASS, range built [tailwind-classes.js:2202], gate [tailwind-classes.js:2221]) and `findUnsupportedTailwindShapes` (W-TAILWIND-001, range built [tailwind-classes.js:2353], gate [tailwind-classes.js:2370]). A dynamic-class fragment like `bg-${color}-500` no longer false-fires. SPEC §26.5.1. Closes g-tailwind-dynamic-class-prefix. No new error codes (precision fix on existing lints).

### fn/pure canonicity reframe (`5d502d59`) — docs/string/comment-only, ZERO behavior change
- compiler/src/lint-i-fn-promotable.js — I-FN-PROMOTABLE message reworded "ergonomic shorthand for pure function" → "the canonical pure form". compiler/src/ast-builder.js + compiler/src/type-system.ts comments reframe `fn` as THE canonical pure form and `pure function` as the deprecated synonym (W-PURE-DEPRECATED, unchanged). SPEC §48.11/§33/§34/§56 prose. NO new codes; emit byte-identical.

## Key S186 Source Changes (channel codegen — reconnect bare-int [Bug1] + onserver/onclient handler wiring [Bug2])

One fix commit (`658cb1a9`; change-id channel-codegen-fixes-2026-06-12, FINAL_SHA `2dda0642`).
Channels §38 dog-food fixes. NO new error codes (Bug 1 reuses E-SCOPE-001 via an exempt; Bug 2 reuses
E-CG-002 / §12.2 Trigger-7); NO new AST node TYPES. ONE new exported codegen symbol
(`collectChannelAttrHandlerNames`) + one new `FunctionRoute` field (`isChannelWsHandler`) + one new
route-inference reason kind (`channel-ws-handler`). 5 source files (+303/-31): emit-channel.ts (+169),
emit-server.ts (+71), route-inference.ts (+73), type-system.ts (+13), emit-functions.ts (+8). +11 tests
(full suite 23,946 → 23,957 / 0 fail / 221 skip).

### Bug 1 — reconnect bare-int (g-channel-reconnect-bare-int, LOW) — `658cb1a9`
- compiler/src/type-system.ts — the `visitAttr` scope-check [type-system.ts:10399-10410] now EXEMPTS `reconnect` (§38.3) and `channel-reconnect` (§38.3.1) from the E-SCOPE-001 check (mirrors the existing `ref` guard). These are spec-typed `integer (ms)` attributes whose bare-integer value (`<channel reconnect=2000>` / `<program channel-reconnect=500>`, §38.2) parses to a `variable-ref` whose `name` is the digit string ("2000") → the scope-check would FALSE-FIRE E-SCOPE-001 on it. Targeted: `<input value=42>` still scope-checks (and errors) — no over-relax.

### Bug 2 — onserver/onclient handler wiring (g-channel-handler-wiring, MED) — `658cb1a9`
- compiler/src/codegen/emit-channel.ts — NEW `channelAttrToCall(attr)` [emit-channel.ts:306] lowers a channel lifecycle-handler attribute value to a JS call-expression across the `call-ref` / `call` (pre-joined-string legacy) / `variable-ref` (bare `onclient:open=onOpen`) / `string-literal` shapes; NEW `channelAttrParam(attr)` [emit-channel.ts:327] binds the §38.6.1 `messageParam`. `onserver:message` → server `message()` JSON.parse → handler(msg); `onclient:open/close/error` → client `ws.on{open,close,error}`. NEW EXPORTED `collectChannelAttrHandlerNames(...)` [emit-channel.ts:546] collects every channel-attr handler NAME (call-ref / call / variable-ref) for route-inference to force-classify (Bug 2b).
- compiler/src/route-inference.ts — NEW reason kind `channel-ws-handler` [route-inference.ts:110]; NEW `FunctionRoute.isChannelWsHandler?: boolean` field [route-inference.ts:272]. A function whose name is collected by `collectChannelAttrHandlerNames` pushes a `channel-ws-handler` trigger [route-inference.ts:2618] REGARDLESS of body content. At route assembly [route-inference.ts:3427-3474]: `_isChannelWsHandler` suppresses the generated HTTP route name (`isServer && !_isChannelWsHandler`) and stamps `isChannelWsHandler` on the route record; the dedup-reason emit [route-inference.ts:3776] emits one channel-ws-handler reason per function. NORMATIVE: `onclient` stays CLIENT (§38.10 wins over §12.2 Trigger-7, per §38.10.2); `onserver` force-escalates as a plain callable server fn with a DEAD HTTP route + client fetch stub SUPPRESSED. Normal channel publishers keep their route + fetch.
- compiler/src/codegen/emit-server.ts — `onserver:*` WS attribute handlers diverted to the plain-function emit path [emit-server.ts:388-400], invoked from `_scrml_ws_handlers` (NOT an HTTP RPC route) [emit-server.ts:1582-1627]. The canonical §38.6.1 `onserver:message` form broadcasts from the parsed message; `message(ws, raw) { ...; handleMessage(msg); }`.
- compiler/src/codegen/emit-functions.ts — the no-route E-CG-002 emit path now `continue`s past a route flagged `isChannelWsHandler === true` [emit-functions.ts:505] so an onserver WS handler (legitimately route-less) emits as an ordinary `function name(params) { ... }` BEFORE the no-route E-CG-002 check instead of false-firing it.

NOTE (S186 dog-food, follow-up SCOPE at docs/changes/s186-dogfood-followups-2026-06-12/): Bug 1 + Bug 2 RESOLVED; 5 NEW open gaps filed (g-channel-onserver-cell-read MED [SPEC-silent server-cell-read design Q], g-channel-spec-38-9-stale LOW, g-channel-topic-forward-ref LOW, g-schemafor-pa-unrecognized MED, g-markup-const-consumes-cell-decl LOW).

## Key S185 Source Changes (errarm re-fail-from-arm 2-layer + E-VALIDATOR-INLINE-COLON validator inline-msg paren-canon)

Two fix commits (`37abb1d2` errarm re-fail-from-arm 2-layer + validator inline-msg paren-canon + 2 gaps ·
`a4726dd3` E-VALIDATOR-INLINE-COLON clear diagnostic). One NEW §34 code (E-VALIDATOR-INLINE-COLON);
the errarm arc added NO new code (reuses E-ERROR-001 + E-SCOPE-001). File counts at HEAD:
ast-builder.js ~15,018 (+217); type-system.ts ~21,185 (+40 net); emit-logic.ts ~4,007 (+117 net);
emit-control-flow.ts ~2,035 (+40).

### errarm re-fail-from-arm (2-layer) — parser hooks (`37abb1d2`)
- compiler/src/ast-builder.js — NEW `_parseFailExprString(text, filePath, startOffset)` builds a `fail-expr` node from an arm-result string (text → a `fail LoadError::Malformed(msg)`-style node carrying `argsExpr`); used so the typer routes the arm to NS-1 (E-ERROR-001 if the enclosing function is non-`!`) and the codegen `fail-expr` emitter lowers it to a function-exiting error envelope. Attached as `arm.failExpr` at two parser sites: `parseErrorTokens` / `parseOneMatchAsExpr` (`!{}` error-arm + match-expr arms — `if (failNode) armNode.failExpr = failNode`), AND a `?`-propagate hook on the const-decl path (`const x = parseVariant(…) !{ … }` re-fail / re-wrap routing). The §19.5.2 re-fail-from-arm shape now escapes the (always-`!`, per NS-1) enclosing function exactly like a statement-position `fail`.

### errarm re-fail-from-arm (2-layer) — typer scope + NS-1 recurse (`37abb1d2`)
- compiler/src/type-system.ts — guarded-expr arm scope-check now SKIPS the `fail`-keyword ident walker (routing the `fail` token through `checkLogicExprIdents` fired a SPURIOUS E-SCOPE-001 on the keyword); instead it scope-checks ONLY the arm `failExpr.argsExpr` against the arm's child scope (binds the arm payload `bindName`s as `variable`/`tAsIs()` into the `error-arm` scope, then `checkLogicExprIdents(failArgsExpr, …)`). The NS-1 `visitStmt` recurse-keys list is extended with `failExpr` + `matchExpr` (the structural match-expr side-field) so the NS-1 walk reaches the match-arm-inline `failExpr` nodes and fires E-ERROR-001 when the enclosing function is non-`!`.

### errarm re-fail-from-arm (2-layer) — codegen fail-expr emitter (`37abb1d2`)
- compiler/src/codegen/emit-logic.ts — NEW shared `emitFailExpr(node, opts)` lowers a `fail-expr` node to a `return { __scrml_error, … }` error envelope (a `return` inside the always-`!` enclosing function, so the re-failed error escapes exactly like statement-position `fail`). Used by `emitArmBody` (`!{}` arms: `if (arm.failExpr) return emitFailExpr(arm.failExpr, opts)`), the match-expr-decl arm path (`a.failExpr ? emitFailExpr(...) : tildeVar = …`), and the bare `fail-expr` node case in `emitLogicNode`. The `FailExprLike` shape (`failExpr?`) added to the LogicArm typedef.
- compiler/src/codegen/emit-control-flow.ts — `MatchArm.failExpr` field added (`failExpr?: any | null`), threaded through ALL arm-kind constructors (wildcard / not / string / variant — each reads `node.failExpr ?? null`). `emitMatchExpr` emits the fail-arm envelope: `arm.failExpr ? { ${bindingPrelude}${emitLogicNode(arm.failExpr, boundary)} }` so the enclosing function returns the §19.5.2 error envelope (server/client boundary-aware).

### E-VALIDATOR-INLINE-COLON — validator inline-message colon-form reject + recovery (`a4726dd3`)
- compiler/src/ast-builder.js — NEW `tryRecoverColonInlineMessage(afterValidatorIdx)` helper inside `scanStructuralDeclLookahead`: detects a validator-name + `:`-string inside a state-cell decl opener (the INVALID colon form `<name req:"…">` / `<name length(>=2):"…">`). On detection it (1) pushes E-VALIDATOR-INLINE-COLON naming the §55.10-normative PAREN form as the fix, and (2) RECOVERS by registering the cell with the message as the paren-form inline override — so the colon form no longer corrupts `@`-cell registration (pre-fix the cell mis-reported as undeclared via a MISLEADING downstream E-SCOPE-001). Two call sites: `recoveredCall` (post-call-arg path, after a validator's `(…)` args) + `recoveredBare` (bare-validator path). E-VALIDATOR-INLINE-COLON is the ONLY diagnostic on the decl now (no E-SCOPE-001 cascade). SPEC §34 row + §55.10 Level-1 resolution-chain example migrated `req:"…"` → `req("…")`; §41.12 cross-ref.

## Key S184 Source Changes (lifecycle-field comment-leak + E-TYPE-001 double-fire + ghost-lint snippet-fill exemptions + Shape-1 variant-lifecycle initializer + payload-binding Gaps 1+2)

Six fix commits (`32b9a4a7` comment-leak · `3587af46` E-TYPE-001 double-fire + W-LINT-007 ghost FP ·
`cf954570` Shape-1 cell variant-progression lifecycle initializer · `bc692eca` ghost-lint canonical-form
exemptions · `7fe7044f` payload-binding Gaps 1+2; plus `809044c3` doc migration). ALL behavior/
diagnostic-scope fixes — NO new §34 error codes, no new AST node TYPES. File counts at HEAD:
type-system.ts ~21,151; ast-builder.js ~14,801; emit-match.ts ~1,039; lint-ghost-patterns.js ~1,390;
lint-w-each-promotable.js ~227.

### lifecycle-field comment-leak — COMMENT-skip in `collectBracedBody` (`32b9a4a7`)
- compiler/src/ast-builder.js — `collectBracedBody` (line 3346) now skips trailing COMMENT tokens before its body-text reconstruction (gate at lines 3361-3374: `if (lastTok.kind === "COMMENT") continue;`). Pre-fix a trailing `//`-comment token's `.text` leaked into a struct-field type-expr, producing a spurious **E-STRUCT-FUNCTION-FIELD** false-positive on a lifecycle field carrying an inline comment. `parseLogicBody` already skipped COMMENT in its own loops (lines 2798, 4164, 4476, 7531, 8181); this closes the `collectBracedBody` parallel gap. Diagnostic-scope fix; no codegen change.

### E-TYPE-001 double-fire + W-LINT-007 ghost false-positive (`3587af46`)
- compiler/src/type-system.ts — `statementText` (line 18844, dup at 20028) gains a `normalizeKey` whitespace-normalizer (`s.replace(/\s*\.\s*/g, ".").replace(/\s+/g, " ").trim()`, lines 18848-18849): the structurally-emitted and raw renderings of the same access now collapse to ONE dedup fragment via `seenKeys`, killing the **E-TYPE-001** double-fire on a lifecycle statement.
- compiler/src/lint-ghost-patterns.js — paired W-LINT-007 ghost false-positive suppression for the same lifecycle shape.

### Shape-1 cell variant-progression lifecycle initializer (`cf954570`)
- compiler/src/type-system.ts — NEW `inferEnumFromVariantLifecycleAnnotation(annotation, typeRegistry)` (line 19782): given a `pre ~> post` variant-lifecycle annotation, recovers the UNIQUE enum whose variant set contains both `{pre, post}` via `parseLifecycleReturnAnnotation` + a registry scan. Returns `{enum}` (one match), `{ambiguous:true}` (≥2 matches → leave asIs so the no-context diagnostic fires), or `null` (no match). Wired at the state-decl initializer enum-inference seam (line 8758): when a typed `@cell` annotated with a variant-progression has a bare `.A` initializer and `resolvedType` is `asIs`/`unknown`, `bvCtxType` is recovered from the annotation's variant NAMES — fixing the spurious **E-VARIANT-AMBIGUOUS** on the canonical Shape-1 initializer (S184 user ruling: option (i) INFER). Mirrors the fn-return path (names no enum) rather than the struct-field path (named enum).
- compiler/src/type-system.ts — NEW `forEachTypeNameLeaf` already present (S174); the variant-lifecycle work reuses the existing leaf-walker family, no new walker. (No structural change beyond the new helper + the one seam.)

### ghost-lint canonical-form exemptions — §16.6 snippet-fill (`bc692eca`)
- compiler/src/lint-ghost-patterns.js — NEW `bracedBodyOpensParenArrowLambda(source, braceOffset)` (line 613) peeks whether a `{`-body opens a `(p) =>` arrow-lambda; NEW `isSnippetFillAttrAssign(source, matchEnd)` (line 654) and `isSnippetFillLambdaParam(source, parenOffset)` (line 678) both delegate to it. Wired into 3 lint scan loops (gates at lines 759, 848, 1162): the §16.6 snippet-fill `prop={ (p) => <markup> }` form is now exempt from **W-LINT-007** (ghost), **W-LINT-004**, and **W-LINT-021** false-positives — the braced arrow-lambda body is a canonical snippet fill, not a ghost pattern.

### payload-binding Gaps 1+2 — `!{}` multi-field + `<match>` block-form arm payloads (`7fe7044f`)
- compiler/src/type-system.ts — Gap 1: an `!{}` error-arm `arm.binding` is now comma-SPLIT (multi-field payload, lines 9354-9355: `for (const rawName of arm.binding.split(","))`) so each payload field binds into the arm's handler scope. Gap 2: NEW `case "match-block"` scope-walker arm (line 10253) + NEW helper `extractMatchArmPayloadBindingsByVariant(armsRaw)` (line 199): parses `armsRaw` via `parseMatchArms`, builds a per-variant `Map<variant, bindings[]>` (PAREN-form `<Done(count)>` comma-split payloads + SPACE-form), then for each `armBodyChildren` wrapper pushes a `match-arm:<variant>` scope and binds the variant's payload names (`asIs`) so block-form match-arm bodies can reference `<Done count>`-style payload bindings without an undefined-symbol diagnostic.
- compiler/src/codegen/emit-match.ts — codegen companion: block-form match-arm `payloadBindings` (line 636) now ALSO reads SPACE-form `entry.attrs` bareword bindings (lines 646-654), not only the comma-joined `payloadBindingsRaw` PAREN form (lines 638-644) — so a `<Done count>` block-form arm lowers its `count` binding into the emitted arm fn.

### `_tableForSynth` skip in W-EACH-PROMOTABLE (`bc692eca`)
- compiler/src/lint-w-each-promotable.js — the W-EACH-PROMOTABLE walker now skips any `_tableForSynth`-marked generated for-stmt (line 211: `if (forStmt._tableForSynth) return;`). A `<tableFor>` expands to a synthesized `for (row of @x) { lift <tr/> }` carrying `_tableForSynth: true` (emit-table-for.ts); the lint must not nag the author to "promote" a for-statement the COMPILER generated. Closes the false-positive on tableFor-synth iteration.

## Key S189 Source Changes (given-rebind reject + channel-cell-write client-side RULING A + schemaFor PA source + §6.9 reactive-cell hoist)

Four arcs across the parser, route-inference, protect-analyzer, and type-system; +2 NEW §34
codes (E-SYNTAX-045, E-CHANNEL-SERVER-CELL-READ). SPEC §12.2/§34/§38.6.1/§38.9/§38.3.1 +
SPEC-INDEX updated; SPEC now 32,256 lines. `a00624f5`.

### E-SYNTAX-045 — given-rebind reject at both given-guard parse sites (`a00624f5`)
- compiler/src/ast-builder.js — NEW `E-SYNTAX-045` reject for the `given <name> = <expr> :> { ... }` rebind shape, fired at BOTH given-guard parse sites: the logic-position site (~line 6682) and the markup-position site (~line 10899), each immediately adjacent to the existing E-SYNTAX-044 property-path reject. `given` narrows in place — it never rebinds a name to a new expression. The detector keys on `peek().kind === "PUNCT" && peek().text === "="` (bare `=`); `==`/`=>`/`:>` tokenize as OPERATOR so equality and both guard separators never false-fire. Recovery consumes the `= <rhs>` up to the separator (`:>`/`=>`) or body `{`, keeping `name` as a narrowed variable so the remainder of the guard still parses. Fix-it teaches `let <name> = <expr>` then `given <name> :> { ... }`, or `given <existingVar> :> { ... }`.

### E-CHANNEL-SERVER-CELL-READ + Trigger 7a drop — channel-cell-write client-side RULING A (`a00624f5`)
- compiler/src/route-inference.ts — §12.2 RULING A (change-id `channel-cell-write-client-side-A-2026-06-12`), two faces:
  - **Trigger 7a DROPPED**: `detectChannelBroadcastReason` (~line 1433, Trigger 7b) no longer escalates a channel-CELL WRITE to the server — it is now `broadcast()`/`disconnect()`-only. A channel-cell WRITE stays CLIENT (channel cells are client-held, §38.4). `onclient` still wins client (§38.10); `onserver` still escalates as a plain server callable.
  - **E-CHANNEL-SERVER-CELL-READ (NEW)**: new `detectServerContextChannelCellRead(body, channelCells)` walker (~line 1525) scans a server-context channel fn's body for a READ of a channel-declared cell, structurally via `forEachIdentInExprNode` over each statement's ExprNode fields (`initExpr`/`exprNode`/`valueExpr`). Visits `@`-prefixed IdentExpr reads, does NOT scan string-literal content (avoids the F-RI-001 class), does NOT descend nested `function-decl` bodies; a `state-decl` LHS write-target is not a read but a `@<cell>` on its RHS is. Fired once per offending fn at ~line 3423 (called ~3420), naming the cell. Server has no value for a client-held cell so the read is `undefined` at runtime → silent crash; this is the reject.

### schemaFor CREATE TABLE — protect-analyzer PA table-def source (`a00624f5`)
- compiler/src/protect-analyzer.ts — NEW `extractSchemaForCreateTableStatements(nodes)` (~line 605) + helpers `paPluralizeStructName(structName)` (~line 545) + `splitStructFieldsTopLevel(body)` (~line 559). Wired as a 4th, lowest-precedence ColumnDef source in `runPA` (~line 911, `schemaForCreateTableMap`): a `${ schemaFor(Struct) }` inside a `<schema>` block is recognized as a CREATE TABLE def source — the table name is the pluralized struct name, columns are the top-level-split struct fields. Closes the S186 `g-schemafor-pa-unrecognized` follow-up. No diagnostic — a recognition source.

### §6.9 reactive-cell hoist — type-system annotation ordering (`a00624f5`)
- compiler/src/type-system.ts — NEW `preBindReactiveStateCells(nodes)` (~line 10589, called ~line 10609) runs in `annotateNodes` immediately AFTER `preBindExportedNames` (~10520/10554). Seeds file-scope reactive cells into the scope chain BEFORE the main annotation walk so an attribute forward-ref to a later-declared reactive cell resolves (mirrors `preBindExportedNames`' `if (!scopeChain.lookup(name))` guard ~10647). No diagnostic — a resolution-ordering pre-pass.

## Key S188 Source Changes (g-not-negation-enforce E-TYPE-045 broadened + cluster-A E-ATTR-UNQUOTED-OPERATOR + g-division-in-ternary-arm)

Three arcs over the live pipeline + type system; +1 NEW code (E-ATTR-UNQUOTED-OPERATOR) +
E-TYPE-045 enforcement broadened to all positions + the bare form. All deltas are in the
compiler source; SPEC §5.2/§17.1/§34/§42.10 updated to match. `1ad740b4`.

### E-TYPE-045 broadened — lowering-choke-point stamp + TS-J harvest (`1ad740b4`)
- compiler/src/expression-parser.ts — `preprocessForAcorn(raw, opts?, detector?)` gained a third `detector?: { notPrefixNegation: boolean }` out-param. Inside the `not`-lowering block, BOTH substitutions (`not(...)`→`!(...)` at the `(?<![A-Za-z0-9_$@])not[ \t]*\(` site, and bare `not <operand>`→`!<operand>` at the keyword-excluded operand site) compare before/after and set `detector.notPrefixNegation = true` when the substitution fired. `detector` is undefined for pure-lowering callers (rewriteExpr / rewriteNotKeyword direct-call unit tests) → behaviour unchanged. `parseExprToNode` is now a thin wrapper: it builds `_notDetector = { notPrefixNegation:false }`, calls the renamed inner `_parseExprToNodeInner(raw, filePath, offset, opts, _notDetector)`, and when the detector fired stamps `(_node)._notPrefixNegation = true` on the returned ExprNode. Single source of truth: every expression flows through this fn once, covering ALL positions + BOTH forms.
- compiler/src/type-system.ts — NEW `harvestNotPrefixNegation(nodes, errors, filePath)` (~line 15233; the fire helper + visit walk; the E-TYPE-045 push is at ~15270): a generic `WeakSet`-guarded structural walk over the whole FileAST object graph; when an object carries `_notPrefixNegation === true` AND `typeof obj.kind === 'string'` it fires E-TYPE-045 once at `obj.span`, with a `firedSpans` Set dedup by `file:start:end` (defeats the aliased condition-string vs re-parsed condExpr double-fire). Wired in `processFile` (~line 17880, `if (allNodes.length > 0) harvestNotPrefixNegation(allNodes, errors, filePath)`). RETIRED: `checkNotPrefixNegation` (the old if/while-only paren-only string scan, ~old line 10984) — its `annotateNodes` call site (the if/while condition handler) is removed; only `checkIsExpressions` remains there.
- compiler/src/native-parser-canary/within-node-classifier.ts — `STRIP_KEYS += '_notPrefixNegation'` (~line 138): the LIVE-only diagnostic-support stamp is dropped before the within-node parity comparison (native represents `not` structurally as a `NotValue` atom and never goes through the stamp).

### g-not-negation-enforce attr-bare hole — tokenizer + ast-builder (`1ad740b4`)
- compiler/src/tokenizer.ts — NEW `isPrefixNotOperandAhead(raw, pos)` (~line 289): after the keyword `not` in an unquoted attr value, returns true ONLY when (after inline `[ \t]` whitespace — never bridging a newline, per 6nz-s/S127) the next char begins a negation operand (`@` / identifier-start / `(`). In `tokenizeAttributes`, the `ident === 'not' && isPrefixNotOperandAhead(...)` branch (~line 678+) reads the whole `not <operand>` run in expression-mode (paren/brace/bracket/string-tracked, up to the attr boundary) and emits a single ATTR_EXPR — so `<p if=not @y>` / `show=not obj.ok` routes through the parseExprToNode choke-point, gets stamped, and fires E-TYPE-045 via the harvest. Bare `if=not` with NO operand stays ATTR_IDENT (the valid absence VALUE).
- compiler/src/ast-builder.js — `parseAttributes` post-loop (~line 2192): a stray-attr-pair detector for the compound-shred form `<p if=@x && not @y>` (the tokenizer shreds `@x && not @y` into `if`=@x + stray barewords `&&`(dropped)/`not`/`@y`). When attr `a` is `{name:'not', value:{kind:'absent'}}` immediately followed by attr `b` whose name is an `@`-ref or bare ident with an absent value, it fires E-TYPE-045 at `a.span` (naming the §5.5.2 parenthesize-compound rule) and `attrs.splice(ai, 2)` drops the stray pair (no misleading E-SCOPE-001 on the stranded operand). A real attribute literally named `not` (`<p not=@y>`) is NOT matched (it carries a non-absent value).

### cluster-A E-ATTR-UNQUOTED-OPERATOR — tokenizer + block-splitter + ast-builder (`1ad740b4`)
- compiler/src/tokenizer.ts — NEW `isConditionAttrName(name)` (~line 319; `if`/`show`/`else-if` — NOT event handlers, NOT `class:`/`bind:`/`style:`, NOT a non-existent `while=`) + NEW `attrConditionOperatorAhead(raw, pos)` (~line 354): at the boundary after the first atomic ident of a condition attr, returns the offending operator string (`>=` intercepted BEFORE the outer tag-close test; spaced bare `>`; `< <= == != && || + - * /`; ternary `?`) else null. A new ATTR_OP_REJECT token (payload `{name, value, op}`, declared in the token-kind doc-comment ~line 30) captures the whole operator run in expression-mode.
- compiler/src/block-splitter.js — `splitBlocks` opener scanner gains (1) a depth-0 `>=` early non-close guard (~line 951: a `>` immediately followed by `=` is never an opener terminator — keep scanning so the `>=`+RHS flows into attrRaw to be captured as ATTR_OP_REJECT, instead of the `>` closing the tag early and surfacing E-CTX-001) and (2) ternary `?`-depth tracking (`ternaryDepth` ~line 902): a bare depth-0 `?` opens a ternary (~line 1042), and the matching `:` (while `ternaryDepth > 0`, ~line 1001) is consumed as the value-arm separator rather than mistaken for a `:`-shorthand body introducer. A second `>=` skip lives in the Shape-1 state-decl `=`-peek (~line 1196) so `>=` isn't mis-read as a state-decl `=` signal.
- compiler/src/ast-builder.js — `parseAttributes` `else if (valTok.kind === 'ATTR_OP_REJECT')` branch (~line 2050): JSON-parses the `{name,value,op}` payload and fires E-ATTR-UNQUOTED-OPERATOR ONCE (naming the operator + steering to `if=(expr)` / `if="expr"`), then recovers `value = { kind: 'absent' }` so the rejected condition doesn't cascade into a misleading E-CTX-001 / E-SCOPE-001.

### g-division-in-ternary-arm — ast-builder collectExpr ternaryDepth guard (`1ad740b4`)
- compiler/src/ast-builder.js — `parseLogicBody`/`collectExpr` (~line 2858+): the S25 typed-reactive boundary break `if (isTypedReactive && tok.kind === 'AT_IDENT' && lastPart !== '=') break` (~line 3069) is now guarded with `ternaryDepth === 0`. A NEW `ternaryDepth` counter (declared ~line 2864; incremented on a depth-0 `?`, decremented on the matching depth-0 `:` while `> 0`, tracked ~line 3289 alongside the existing brace-depth) prevents a ternary consequent's `@cell :` (`cond ? @cell : alt`) from being mis-read as a typed-reactive decl start (`@name: Type`) — which truncated the init at the consequent and emitted invalid JS (E-CODEGEN-INVALID-JS). `?.`/`??` tokenize as OPERATOR (not PUNCT `?`) so optional-chaining/nullish-coalescing don't perturb the count.


## Key S190 Source Changes (Cluster C decl-boundary mis-split + §51.0.J derived-engine expression form + §51.9 steer)

Three arcs; +1 NEW §34 code (E-DECL-RHS-INTERP-WRAPPED) + E-ENGINE-004 message resteered;
SPEC §6.2/§34/§51.0.J/§52.1 + PRIMER §13.7 updated. Full suite 24100/0. `1e17213e`.

### Cluster C — decl-boundary mis-split (E-DECL-RHS-INTERP-WRAPPED + markup-const sibling-swallow, `11c648c7`)
Two coupled parser fixes in ast-builder.js; block-splitter blast-radius from the S190 operator-aware opener scanner:
- compiler/src/ast-builder.js — Bug 1 (g-derived-rhs-interp-wrapped): NEW `E-DECL-RHS-INTERP-WRAPPED` fired at `tryParseStructuralDecl` when a `const`/plain/typed decl RHS is wrapped in a `${  }` logic block. Rejects the wrapping (user ruling: reject not unwrap-accept); recovers by unwrapping the expression to suppress the misleading orphan-`$` E-SCOPE-001 cascade. SPEC §6.2 "RHS is a bare expression" subsection + §34 row. Bug 2 (g-markup-const-consumes-cell-decl, re-tagged LOW→MED): `collectExpr` gains a `markupRootClosed` boundary flag — once the top-level markup element of a markup-const RHS fully closes (`angleDepth===0` after `</...>` or `/>`, deferred to the `>` for self-closers), a subsequent depth-0 token triggers a break so following siblings (cell decls, derived decls, bindable decls, fns) are no longer vacuumed into the markup's raw body. A `</>` double-decrement guard prevents the root-close signal from firing on an inner self-closer before the root. Both fixes close g-derived-rhs-interp-wrapped and g-markup-const-consumes-cell-decl. +19 regression tests in cluster-c-decl-boundary.test.js.

### §51.0.J derived-engine EXPRESSION form (`f0030049`)
Implements the §51.0.J derived-engine expression form end-to-end (was half-built + mis-routed to legacy §51.9 projection → E-ENGINE-004):
- compiler/src/ast-builder.js — `derived=` value classification (S190): the opener scanner captures the FULL raw value after `derived=` then classifies into one of three shapes: (a) bare-ident `derived=@var` (legacy projection), (b) inline-match `derived=match @var { .A => .X; .B => .Y }` (§51.0.J modern inline-match), (c) arbitrary expression `derived=@miles > 500 ? .High : .Low` (§51.0.J modern expr). New operator-awareness in the opener scanner (`>=` non-close guard + ternary `?`-depth tracking) is tightly gated to `derived=<expr>` only — non-derived attrs unaffected. Parses the expression to a `derivedExprNode` via `safeParseExprToNodeGlobal`. Strip trailing self-close `/` so `derived=@x/` reads as `@x`.
- compiler/src/block-splitter.js — operator-aware inside `derived=<expr>`: a `>` immediately followed by `=` or a depth-tracked ternary `?`/`:` inside the `derived=` value does not prematurely close the opener tag.
- compiler/src/symbol-table.ts — three `derivedExpr.kind` discriminants: `"legacy-source-var"` (pre-S190 `derived=@var` with sourceVar, no change to B16 light-up), `"inline-match"` (§51.0.J: upstream + matchBody), `"expr"` (§51.0.J: exprText + exprNode + `upstreams` — all `@cell` identifiers enumerated from the ExprNode). B16 (NO-RULES / NO-INITIAL / NO-WRITE / CIRCULAR) fires for `inline-match` and `expr` kinds (NOT `legacy-source-var`). NO-RULES extended to a state-child `rule=` attribute. `derivedExprNode` threaded through for upstream enumeration.
- compiler/src/type-system.ts — modern forms (`inline-match` + `expr`) skip `validateDerivedMachines` (§51.9 legacy-projection path); the engine decl is resolved as an ordinary (non-§51.9) `MachineType` with empty rules so downstream codegen takes the C14 `_scrml_derived_*` substrate path. §51.9 message resteered (wrap commit `1e17213e`): E-ENGINE-004 now steers a plain-cell `derived=@var` source to the modern §51.0.J `derived=match @var { ... }` form (was machine-source-only guidance).
- compiler/src/codegen/emit-engine.ts — reactive recompute via C14 `_scrml_derived_*` substrate: for `kind:"expr"`, the lowered expression source replaces the legacy projection body; `__scrml_derived_v` captures the expression value, guarded with a runtime `null`/`undefined` check that throws `E-DERIVED-ENGINE-INITIAL-UNDEFINED-RT` if the initial expression yields no defined variant (per §51.0.J + §34). +2 boundary cases added to c14-derived-engines.test.js in the wrap commit.
- compiler/src/dependency-graph.ts — per-upstream DG edges for `kind:"expr"`: draws one dep-edge per `upstreams` entry (each `@cell` the expression reads), so a change in ANY referenced cell recomputes the variant AND cycle detection sees the full edge set.

### §51.9 steer + §52.1 cross-ref (`1e17213e`)
- compiler/src/type-system.ts — E-ENGINE-004 message amended: when a plain-cell `derived=@var` source is detected, the error now steers to the modern §51.0.J `derived=match @var { ... }` form (kept the §51.9.3 machine-source guidance alongside). No SPEC or codegen change.
- compiler/SPEC.md — NEW §52.1 cross-ref distinguishing the shared-state axis (§51.0.A engine-singleton-as-typed-global-store) from the authority axis (§52); closes the S178 placement-TBD residual.

## Key S191 Source Changes (Tailwind composing-utility families §26.7.x + if=fn() condition routing)

Two arcs; ZERO new §34 codes (Tailwind = additive registry families recognized by the existing
W-TAILWIND-UNRECOGNIZED-CLASS lint; if=fn() = a codegen routing fix). SPEC §26.7/§26.7.1/§26.7.2/§26.7.3 + §5.1 updated. `7f2092cf`.

### Tailwind composing-utility families (§26.7.x) — Approach C inline-`var()`-fallback model (`ed3fa5ee` Phase1 / `f5b71e61` Phase2 / `ddf5919d` Phase3 / `004007fb` Phase4)
**THE biggest prior map gap (dev agents flagged its absence 3×).** All composing families now COMPLETE.
- compiler/src/tailwind-classes.js — five `register*()` builders (invoked in registry build at [:3008-:3012]) + four `*_COMPOSE` shorthand consts implement the **Approach C** model: each composing-family utility emits a shared composing shorthand built from `var()` references AND sets one `--tw-*` custom property; **every `var()` reference carries its own inline fallback so NO global `*, ::before, ::after` preflight defaults block is emitted** (preserves the §26.1/§26.2 "only what's used" minimalism axiom — comment markers at [:558/:638-640/:772-773/:899-900]).
  - **ring / ring-offset / shadow (§26.7, Phase 1):** `registerRing()` [:584] + `ringShadowSetter(width)` [:576] + `const BOX_SHADOW_COMPOSE` [:567] — `box-shadow: var(--tw-ring-offset-shadow, …), var(--tw-ring-shadow, …), var(--tw-shadow, …)`. `ring-color` defaults to `currentColor` (scrml divergence from Tailwind v3 blue-500/50, §26.7). Arbitrary `ring-[<len>]` / `ring-[<color>]` kind-dispatched at [:1753-:1788]; `shadow-{size}` sets `--tw-shadow` [:1086].
  - **gradient (§26.7.1, Phase 2):** `registerGradient()` [:719] — `bg-gradient-to-{dir}` → `background-image: linear-gradient(<dir>, var(--tw-gradient-stops, …))`; `from-`/`via-`/`to-` color stops set `--tw-gradient-from`/`-via`/`-to`/`-stops` with transparent-twin defaults [:697-:716]. Arbitrary stops at [:1794].
  - **transform (§26.7.2, Phase 3):** `registerTransform()` [:825] + `const TRANSFORM_COMPOSE` [:792] — `transform: translate(var(--tw-translate-x,0), …) rotate(…) skewX(…) skewY(…) scaleX(var(--tw-scale-x,1)) scaleY(…)`; named + directional translate/scale/rotate/skew utilities each set one `--tw-*` axis var. Arbitrary directional at [:1726].
  - **filter + backdrop-filter (§26.7.3, Phase 4):** `registerFilters()` [:974] + `registerBackdrop()` [:1030] + `const FILTER_COMPOSE` [:912] + `const BACKDROP_COMPOSE` [:918] — `filter:`/`backdrop-filter:` (+ `-webkit-backdrop-filter:`) shorthands compose blur/brightness/contrast/grayscale/hue-rotate/invert/saturate/sepia/(drop-shadow|opacity); each `var()` carries an EMPTY inline fallback (`var(--tw-blur,)`) so an unset function contributes nothing. Arbitrary filter at [:1806].

### if=fn() condition routing — bare-call conditionals route as reactive conditionals, not event bindings (`98bdb760` + `90fd7412`)
- compiler/src/codegen/emit-html.ts — TWO seams now accept a `call-ref` (bare `fn()`) condition value:
  - **call-ref attr-value branch [:1773]** (`g-attr-if-fn-call-misroute`, S191) — when `val.kind === "call-ref"` and `name === "if" || "show"`, the bare call is routed as a reactive conditional (emits `data-scrml-bind-if`/`data-scrml-bind-show` placeholder + `registry.addLogicBinding`), NOT a nonexistent `if`/`show` DOM event binding; mirrors the `val.kind === "expr"` paren-form path (`if=(fn())`). `@`-prefixed args are harvested into `condRefs` (advisory; dynamic `_scrml_effect` tracking covers the rest). §5.1 line 1352.
  - **clean-subtree if= handler [:1413]** (`g-attr-if-fn-display-not-mount`, S191) — a bare-call clean-subtree `if=` condition gets the SAME mount/unmount controller as `if=(fn())`/`if=@var` (not the display-toggle fallback), so `if=fn()` ≡ `if=(fn())`. Gate broadened at [:1394] (`call-ref` added alongside `variable-ref`/`expr`).
- compiler/src/codegen/emit-event-wiring.ts — `_update_chain_<id>()` chain-condition emitter [:1267] now handles a `call-ref` chain-head / else-if condition [:1282] (`g-attr-if-fn-chain-head-call-misroute`, S191): a bare-CALL `if=isHigh()` is CALLED (call string built → `parseExprToNode` → `emitExprField`), not read as a cell (the call-ref carries `.name`/`.args` but no `.raw`, so it would otherwise fall to the variable-ref path → `_scrml_reactive_get("isHigh")` → branch never activates).

## Key S192 Source Changes (engine var-name canonicalization + bug-12-vkill read-side `E-STATE-UNDECLARED` fire)

Three arcs; +2 NEW §34 codes (`W-CONST-AT-DEPRECATED` Info + `E-STATE-UNDECLARED` Error relocated to TS
post-CE); +1 NEW compiler/src module (`engine-varname.ts`). ZERO codegen change. ZERO new AST node
shapes. 8 new test files (984 total). `0cafe665`.

### engine-varname.ts — NEW shared module (sym-cell-registration-completeness-2026-06-13, §51.0.C)
**Root problem:** `autoDeriveEngineVarName` was implemented 4 divergent ways across SYM / type-system
§51.9 / codegen / ast-builder that disagreed on acronym-leading and multi-word names (`URL` → `uRL` /
`URL` / `url`; `MarioState` registered verbatim on the legacy path). The divergence produced a SYM
register/read mismatch that silently blocked the §6.1.2 read-side `E-STATE-UNDECLARED` fire (bug-12-vkill).

- **compiler/src/engine-varname.ts (NEW, 41L)** — exports `autoDeriveEngineVarName(typeName: string): string`.
  Implements the §51.0.C acronym-run rule via ONE idempotent regex (`ENGINE_VARNAME_RE`):
  lowercase the leading uppercase-run, keeping the letter that starts the next CamelCase word as uppercase.
  Examples: `MarioState`→`marioState`, `UIState`→`uiState`, `URL`→`url`, `HTTPClient`→`httpClient`.
  Now the SINGLE source of truth imported by all 4 former divergent sites.
- **compiler/src/symbol-table.ts** — SYM cell-registration:
  - `autoDeriveEngineVarName` imported (line 5150, re-exported from here for backward compat); used at
    `varName = autoDeriveEngineVarName(engineDecl.engineName/governedType)` [lines 5500/5502] in the
    engine-decl walker.
  - NEW `walkRegisterRefBindings(nodes, fileScope, visited)` [PASS 1.d, lines 5358+]: registers
    `ref=@name` element-ref bindings as lightweight scope records (`_cellKind:"ref"`) so `lookupStateCell`
    no longer returns null for ref-bound cells — closes the Class-C read-side census null-set. First-writer-
    wins / dev-intent-wins; registers at FILE scope (runtime `_scrml_reactive_set` is file-global).
  - NEW `W-CONST-AT-DEPRECATED` fires at lines 8688/8711 (Info-level, §6.6.1 / §34): the legacy
    `const @x = expr` derived-cell form (structuralForm:false) is deprecated; steers to `const <x> = expr`.
    Deprecation-cycle shape: warn-window → reserved `E-CONST-AT-DEPRECATED` end-of-window (mirrors W-PURE-DEPRECATED).
- **compiler/src/type-system.ts** — read-side `E-STATE-UNDECLARED` fire relocated POST-CE [line 6240]:
  - Previously the SYM-stage prototype could not see CE-inlined channel cells / `<each>` row locals /
    engine boot cells; TS runs post-CE and owns a COMPLETE `@name` resolution table (scopeChain).
  - Walker at ~line 6240: a `@name` ident-read that resolves to NEITHER a reactive cell / loop-local /
    import binding fires `E-STATE-UNDECLARED` [line 6282] (Error, §6.1.2 + §6.2).
  - Exemptions: `@.` / `@.field` (each contextual sigil, E-SYNTAX-064 path), `@_internal` (underscore
    convention), `@TypeName` (declared type — `typeRegistry.has(atBase)`), `@fnName` (known fn — guard).
  - NEW `W-CONST-AT-DEPRECATED` wired in the type pass [line 8688]: state-decl walker checks
    `shape:"derived" && isConst:true && structuralForm:false` → fires Info nudge + points to `scrml migrate --fix`.
  - `engineNameToProjectedVar(name)` [line 5263] now simply delegates to `autoDeriveEngineVarName(name)`.
- **compiler/src/ast-builder.js** — imports `autoDeriveEngineVarName` [line 54]; uses the ONE canonical
  rule at engine-decl parse sites [lines 13817/13894/13902/13904] in place of the former local derivation.
- **compiler/src/codegen/emit-machines.ts** — imports `autoDeriveEngineVarName` [line 20]; uses it
  at derived-decl emission fallback [line 282] in place of the former local derivation.

### migrate.js — Migration 4b: `const @name` → `const <name>` (`W-CONST-AT-DEPRECATED`)
- **compiler/src/commands/migrate.js** — **Migration 4b** [line 174, the §6.6.1 const-at form]:
  `const @name = ...` / `const @name: T = ...` → `const <name> = ...` / `const <name>: T = ...`.
  Regex anchored on a LINE-LEADING `const @ident` so comment / prose mentions of `` `const @x` ``
  are NOT rewritten. Applied automatically (non-`--fix`, non-`--program-shape`; same tier as Migrations
  1–3 [whitespace-after-`<` / `<machine>` keyword / `pure` modifier]). Counted as `migrations.constAt`
  in the report. Help text + doc updated [lines 14-15 / 181 / 249-256 / 2364 / 2899].

### S192 New Test Files (8 new; 984 total test files at HEAD)
| File | Tests | What it covers |
|------|-------|----------------|
| unit/const-at-deprecated-lint.test.js | 15 | W-CONST-AT-DEPRECATED lint fires on `const @x`; canonical `const <x>` clean |
| unit/v-kill-readside-undeclared.test.js | 6 | E-STATE-UNDECLARED fires on genuine `@typo` reads; in-scope cells exempt |
| unit/ref-binding-sym-registration.test.js | 6 | `ref=@name` registers into SYM scope; `@name` read no longer undeclared |
| unit/state-block-bare-write-decl-lint.test.js | 10 | state-block bare-write lint coverage |
| unit/engine-binding-b14.test.js | 49 | engine var-name canonicalization (B14 — acronym-run, multi-word, legacy-machine forms) |
| unit/native-reactive-write-deepset-mutation.test.js | — | native reactive deepset/mutation parity |
| tests/unit/cluster-c-decl-boundary.test.js | — | (pre-existing extended by S192 wrap) |
| tests/parser-conformance-canary.test.js | — | parser-conformance canary extended |

## Key S194 Source Changes (§52 server-authority — auto-persist RETRACTED + Tier-1 read-authority codegen)

Three commits (`fdcd7fcc` G1 retract → `fff841ca` §52↔§38 bridge → `a78272e5` Tier-1 read-authority
codegen). §52 is now a READ-authority layer only (SELECT * load + SSR residual); the WRITE is always the
dev's own `?{}` server fn. +1 NEW §34 disposition (`W-AUTH-002` narrowed to the §52.8 SSR residual; was the
Tier-1 interim "not yet wired" warning). NO new error-CODE strings; the new code-path is codegen + recogniser.
SPEC §52.6.2/.3/.4 retracted auto-persist (Q1=C/Q2=WF) + NEW §52.6.6 + NEW §52.6.7 + SPEC-ISSUE-026 RESOLVED.
`a78272e5`.

### emit-sync.ts — DELETE auto-persist/optimistic machinery; ADD Tier-1 read-authority load (`fdcd7fcc` + `a78272e5`)
- **compiler/src/codegen/emit-sync.ts (173L)** — under the Q1=C ruling, `emitServerSyncStub` AND
  `emitOptimisticUpdate` are DELETED (the §52.6 auto-persist + optimistic-update machinery; were 5 refs at
  `0cafe665`, now ZERO — only an explanatory comment block [:124-125] names their removal). An assignment to a
  `<var server>` cell is the ordinary reactive set; the persist is the dev's `?{}` (§52.6.2/§52.6.6).
  - NEW `emitServerAuthorityLoad(varName, table)` [:104] — emits the Tier-1 client-side load IIFE:
    `const _r = await fetch("/__serverLoad/<var>", { method:"POST", ... })` → assigns the `SELECT * FROM <table>`
    rows into `@<var>` on mount (§52.6.1, symmetric to `/__mountHydrate`). `emitInitialLoad` [:58] (Tier-2 init
    load) + `emitUnifiedMountHydrate` [:157] unchanged.

### collect.ts — Tier-1 instance collector + disjoint Tier-2 var-decl collector (`a78272e5`)
- **compiler/src/codegen/collect.ts** — NEW `collectServerAuthorityTypes(fileAST)` [:588] returns the Tier-1
  cells (the `serverAuthorityTable`-bearing state-decls — the §52.3.5 server-authority TYPE instances).
  `collectServerVarDecls(fileAST)` [:546] now EXCLUDES the Tier-1 cells (comment [:557]) so the two collectors
  are DISJOINT (Tier-2 plain `<var server>` vs Tier-1 typed server-authority instances).

### emit-server.ts — synthetic `/__serverLoad/<var>` SELECT* route + server-file emission gate (`a78272e5`)
- **compiler/src/codegen/emit-server.ts** — `_serverAuthorityInstances = collectServerAuthorityTypes(fileAST)`
  [:531]; `_hasServerAuthorityCells` [:532] now also FIRES the server-file emission gate (a file with only Tier-1
  cells still emits a server bundle). Per Tier-1 instance, a synthetic POST route `/__serverLoad/<var>` [:1591-:1615]
  runs `const _scrml_rows = await _scrml_sql\`SELECT * FROM <table>\`;` server-side and returns the rows as JSON
  (the read-authority handler; the `_scrml_sql` tag is the §52 / Bug-3a DB-scope identifier).

### emit-reactive-wiring.ts — wires the per-instance Tier-1 read-authority load (`a78272e5`)
- **compiler/src/codegen/emit-reactive-wiring.ts** — imports `collectServerAuthorityTypes` [:12] +
  `emitServerAuthorityLoad` [:16]; the wiring pass [:618-:628] calls `emitServerAuthorityLoad(varName, table)`
  per Tier-1 instance to wire its mount-time `/__serverLoad/<var>` load. The DELETED sync-stub / optimistic calls
  are gone.

### ast-builder.js — §52.3.5 server-authority TYPE-decl + INSTANCE recogniser (gated on `authority="server"`)
- **compiler/src/ast-builder.js** — NEW `tryParseServerAuthorityDecl(startTok, nameTok)` [:4765], called from
  `tryParseStructuralDecl` [recognition hook ~:4994]. The §52.3.5 Tier-1 shape lives inside a `${…}` logic block
  and was PREVIOUSLY swallowed as `kind:"html-fragment"` raw text. THE GATE/DISCRIMINATOR is `authority="server"`
  in the opener [:4847] (SPEC §52.3.3 mandates it together with `table=`; empirically unique to §52.3.5). Two
  sub-shapes: **T** (type-decl `< Name authority="server" table="…"> field:Type </>` → registers the type in
  `_serverAuthorityTypes`) and **I** (instance `< Name> @var [= placeholder]` of a known server-auth type → builds
  a `state-decl` node carrying `isServer:true`, `stateType:Name`, `serverAuthorityTable:table` for collect.ts +
  emit-sync). Pure lookahead — declines (returns null) on any non-`authority="server"` shape, so §54.2 substates /
  §35.2 constructors / local states are UNTOUCHED.

### type-system.ts — W-AUTH-001 suppressed for Tier-1; W-AUTH-002 narrowed to the §52.8 SSR residual
- **compiler/src/type-system.ts** — `W-AUTH-001` ("server @var with no detected initial load", §52.11) [:9042]
  is now SUPPRESSED for a Tier-1 server-authority instance (`_isTier1AuthInstance` = a non-empty
  `serverAuthorityTable`, [:9037-:9040]) — its initial load is compiler-generated (the SELECT *), so the Tier-2
  loader-nudge does not apply. `W-AUTH-002` [:7972] is NARROWED: a `authority="server" table=` state type now gets
  its SELECT * load on mount; W-AUTH-002 surfaces ONLY the remaining read-authority residual — SSR pre-render is
  not yet wired, so instances load client-side after first paint (a brief placeholder flash) rather than into the
  initial server-rendered HTML (§52.8, a tracked follow-on). The WRITE is always the dev's `?{}` (§52.6.2).

### SPEC + SPEC-INDEX (`fdcd7fcc` + `fff841ca` + `a78272e5`)
- **compiler/SPEC.md (~32,647 lines at HEAD)** — §52.6.2/.6.3/.6.4 retracted the auto-persist route + auto-rollback
  (Q1=C/Q2=WF deep-dive ruling — "the persist write is the dev's `?{}`"); NEW **§52.6.6** [:29112] "Write Function
  Convention for Tier 2 `<var server>`"; NEW **§52.6.7** [:29151] "Interaction with §38 Channels — Server-Initiated
  Fan-Out" (P1 bridge — server fan-out = explicit composition of a §52.6.2 `?{}` persist + a `broadcast()` in the
  SAME server fn; NO `broadcast=` attribute, NO auto-fan-out); **SPEC-ISSUE-026 RESOLVED** [:29360] (partial-authority
  expressions fall out cleanly under the read-authority model — no special compiler handling).
- **compiler/SPEC-INDEX.md** — regenerated; the §52 row now reads "READ-authority + reactive-wiring layer (load +
  SSR + E-AUTH) — the persist write is the dev's explicit `?{}` at BOTH tiers (§52.6.2 auto-persist RETRACTED; §52.6.6
  dev write-fn convention; SPEC-ISSUE-026 RESOLVED)".

## Key S198-S199 Source Changes (engine-hydration arc — A-leg `initial=@cell` snapshot-once + E-leg `server=@source` reactive server-authoritative)

The engine-hydration arc seeds an `<engine for=T>` instance from a RUNTIME cell instead of the
static `initial=.Literal`. Two legs landed across S198-S199; both route through ONE guard-free
construction hook and a SHARED runtime helper (`_scrml_engine_hydrate_init`) — no transition guard
(`rule=` does not apply to construction), engine stays WRITABLE (dev writes route through
`_scrml_engine_direct_set` unchanged). Authority: `docs/changes/engine-hydration-initial-cell-2026-06-15/BRIEF.md`
(A-leg) + `docs/changes/engine-server-authority-2026-06-16/BRIEF.md` (E-leg).

**A-leg — `initial=@cell` (S198, `7532bd8f`, Approach F):** SNAPSHOT-ONCE at engine construction.
- compiler/src/ast-builder.js — recognize `initial=@cell`; capture `engineDecl.initialCell` (bare cell name).
- compiler/src/symbol-table.ts — `EngineMetadata.initialCell`; `E-ENGINE-INITIAL-BOTH-FORMS` (mutual-exclusion with `initial=.Literal`); existence fires `E-ENGINE-INITIAL-CELL-UNDECLARED` (reuses E-STATE class), type-mismatch fires `E-ENGINE-INITIAL-CELL-TYPE`.
- compiler/src/codegen/emit-engine.ts — NEW `emitEngineCellHydrationInit` / `emitEngineCellHydrationInitsForFile` — deferred AFTER `reactiveLines` (the Phase-0 ordering fix; mirrors the `eachDispatchers` deferral). Snapshots the cell value at construction, routes through guard-free `_scrml_engine_hydrate_init`.
- compiler/src/codegen/emit-client.ts — wires the A-leg `emitEngineCellHydrationInitsForFile(fileAST)` into the client stage.
- compiler/src/runtime-template.js — NEW `_scrml_engine_hydrate_init(varName, snapshot, validTags, forType)` (~L3817): guard-free construction set (bare reactive set, never `_scrml_engine_direct_set`) + the decoder-boundary runtime guard `E-ENGINE-INITIAL-INVALID-VARIANT` (a non-`for=T`/absence value at construction throws — the ratified graft).
- compiler/src/dependency-graph.ts — credits the `initialCell` as a reader (prevents a false E-DG-002 "declared, never read").
- SPEC §51.0 (initial=@cell attr-table row + construction-not-transition semantic) + §34 codes. Native-parser re-sync to emit `initialCell` is parity backlog (live canonical; within-node allowlist bumped +1 MISSING-FIELD per engine-decl).

**E-leg — `server=@source` (S199, `2e3aa6a4`):** REACTIVE server-authoritative — HYDRATES GUARD-FREE on EVERY source change (the server is the authority asserting truth). `server` here is the §52 AUTHORITY sense (a value-bearing decl-attr); dotted field-access path supported (`server=@driver.current_status`). Phase 0+1 (parser+SYM) recovered from agent crash; Phase 2-4 PA-direct, user-authorized.
- compiler/src/ast-builder.js — `server=@source` captured as `engineDecl.serverSource` via `/\bserver\s*=\s*@(IDENT(?:\.IDENT)*)\b/` (dotted path preserved as the full string).
- compiler/src/symbol-table.ts — `EngineMetadata.serverSource`; mutual-exclusion `E-ENGINE-SERVER-WITH-DERIVED` (forbidden with `derived=`) / `E-ENGINE-SERVER-WITH-INITIAL-CELL` (forbidden with `initial=@cell`); existence + type-compat REUSE the A-leg codes (`E-ENGINE-INITIAL-CELL-UNDECLARED` / `-TYPE`, BARE-ROOT only — field-access passes conservatively); `W-ENGINE-SERVER-SOURCE-NOT-AUTHORITATIVE` info nudge when the source cell is not itself a §52 read-authority cell (mechanism works, semantics is the dev's claim); `W-ENGINE-INITIAL-MISSING` SUPPRESSED when `serverSource` is set (the placeholder is intentional — unresolved source waits at `initial=.Literal`/first-state until it resolves).
- compiler/src/codegen/emit-engine.ts — NEW `emitEngineServerSourceHydration(meta)` / `emitEngineServerSourceHydrationsForFile(fileAST)` [~:1746]: a reactive IIFE — `_scrml_reactive_subscribe(rootCell, __scrml_eleg_h)` → `_scrml_engine_hydrate_init` GUARD-FREE on every change (REUSES the A-leg runtime helper — NO new runtime helper). Splits the dotted source path: ROOT cell is subscribed, the field tail is a null-safe walk (`__v = (__v == null) ? null : __v["seg"]`). Skip-if-absent (`if (__v == null) return;` — unresolved source sits at the `initial=.Literal` placeholder; NOT a throw). §38 server-push composes for free (a pushed source-cell change fires the same subscription → same re-hydrate). Initial call `__scrml_eleg_h()` runs once for the SSR-already-resolved case.
- compiler/src/codegen/emit-client.ts — imports + wires `emitEngineServerSourceHydrationsForFile(fileAST)` (stage `emit-engine-server-source-hydrations`); emitted AFTER `emitReactiveWiring`, alongside the A-leg, under `// --- engine server-authoritative reactive hydration (§52, E-leg) ---`.
- compiler/src/dependency-graph.ts — credits the ROOT cell of the dotted source path as a reader (`serverSource.split(".")[0]` → `creditReader` + `emitMarkupReadEdge`) — fixes a false E-DG-002 the HOS dog-food surfaced.
- compiler/src/native-parser-canary/within-node-classifier.ts — `serverSource` added to `STRIP_KEYS` [~:160] — a LIVE-only codegen-support field (the native parser does NOT yet recognize the `server=@source` form, same swap-class as `derivedExprNode`); stripped from the parity comparison, NOT a semantic divergence (both routes render identically).
- SPEC §51.0.E (NEW server-form subsection + forward-ref fix) + §51.0 attr-table row + §34 (+3 codes; 2 reused-code rows extended) + §52.4.4 reciprocal statement; SPEC-INDEX regenerated (61 rows). Supersedes g-engine-server-flag-silent-swallow for the `server=@source` form. Persist-back is the dev's explicit `?{}` (§52.6.2).

**HOS engine showcase (S199, `4f6aa2e8`):** the trucking corpus now dog-foods the E-leg — `examples/23-trucking-dispatch/pages/driver/hos.scrml` + `components/driver-card.scrml` declare `<engine for=HOSStatus server=@source>` (the "engines-everywhere" mandate). Smoke test + within-node allowlist updated; the engine-example gap the v1 corpus missed.

**gap-184 kickstarter modernization (S199, `d6608255`):** `docs/articles/llm-kickstarter-v2-2026-05-04.md` §11.1 engine recipe modernized to the current engine forms; underlying BS bug filed in `docs/known-gaps.md`.

## Key S196 Source Changes (render-expression primitive `<render of=X/>` + render-expr prereq steer)

Two commits. `<render of=X/>` (`471cbb34`, change-id `render-expr-primitive-2026-06-15`) is a NEW scrml STRUCTURAL element (parallel to `<errors>` / `<each>`) that fires a HELD enum value's per-variant `renders` markup (§19.2) at the markup position where the value is held — the held-value counterpart to `<errorBoundary>` catching a LIVE `!`-call (closes g-held-error-display; RATIFIED S195 a/c). The prereq commit (`fcdec43c`, change-id `render-expr-prereq-bugs-2026-06-15`) lands the four error-display seams that gated the build. SPEC: NEW §19.15 (5 subsections) + §19.2 amend + §4.15/§24.4 register `<render>` + §34/§19.13 ×3 codes. Full suite 24,321/0. Build attempts 1+2 (agents aae6f659, a0c27a50) crashed ENVIRONMENTALLY after Layers 1-3; Layers 1+2 salvaged to recovery branches, Layer 3 codegen recovered from the uncommitted draft, PA-direct finish (user-authorized). Authority: `docs/changes/render-expr-primitive-2026-06-15/BRIEF.md` + `BRIEF-recovery.md` + `…/render-expr-prereq-bugs-2026-06-15/BRIEF.md`. Follow-on g-render-not-enum-asis-miss (LOW — non-enum `of=` on an `asIs` cell is an inert no-op, not fenced).

- compiler/src/html-elements.js — NEW `REGISTRY.set("render", { tag:"render", attributes: GLOBAL + ["of" required], isVoid:false, rendersToDom:false })` (~L799). Registered as a scrml structural element exactly mirroring `<errors>`/`<each>`/`<empty>`; self-closing canonical, `rendersToDom:false` (structural — codegen expands to a placeholder span).
- compiler/src/attribute-registry.js — NEW `ELEMENT_ATTR_REGISTRY.set("render", { allowedAttrs: ["of": `supportsInterpolation:false`] })` (~L403). The `of=` value is a bare scrml-native reference (commonly a `<match>` arm payload binding) — NO `${...}` interpolation. Mirrors the `<errors of=expr/>` attribute shape.
- compiler/src/type-system.ts — the render-expression EXHAUSTIVENESS FENCE in `annotateNodes`: E-RENDER-NO-OF [:7692], E-RENDER-NO-CLAUSE [:7729] (REUSES §19.6.6 E-ERROR-005 per-variant logic), E-RENDER-NOT-ENUM [:7744] (conservative on `asIs` — no false fire). Match-arm payload bindings now resolve to concrete variant-field types so the fence reads the held enum. Also: E-MATCH-ARM-MARKUP-IN-VALUE in `checkMatchDiagnostics` [:13446] (the `fcdec43c` prereq steer — a JS-style value-`match` arm whose body is a MARKUP element; arm-body visit SKIPPED once it fires [skip logic :9907]). Contract-FIRING, never view-GENERATING.
- compiler/src/codegen/emit-html.ts — `<render of=X/>` expansion [generateHtml ~L1041-1173]: resolves `of=` → the held value's runtime JS accessor (arm-payload binding or `@`-cell), builds `variantRenderExprs` from `allVariantRenderExprs` (~L637) + `emitBoundaryMarkupExpr`, emits a per-variant `switch(X.variant)` filling a `<span data-scrml-render-anchor=...>` innerHTML against the HELD value's `.data` (NOT `_eb_result.data`). E-RENDER-NO-OF codegen backstop [:1082]. SIDESTEPS the `__scrml_error` gate (new fire site, never pretends held=thrown). `<errorBoundary>` codegen UNCHANGED.
- compiler/src/codegen/binding-registry.ts — `LogicBinding.kind` gains `"render-element"` (~L101); NEW `renderHeldAccessor` / `renderHeldSubscribe` fields (~L227) — the `<span data-scrml-render-anchor>` HTML anchor + the held-value accessor for reactive re-fire.
- compiler/src/codegen/emit-event-wiring.ts — `LogicBinding` interface mirror (`render-element` kind + `renderHeldAccessor`/`renderHeldSubscribe`); top-level `<render of=@cell/>` reactive wiring (subscribe → re-render the anchor on cell change).
- compiler/src/codegen/emit-variant-guard.ts — `emitArmWireFunction` dispatches arm-payload `<render of=err/>` bindings (`kind === "render-element"` + `renderHeldAccessor`): the payload binding is a wire-fn parameter and is in scope; a variant change re-runs render+wire (re-evaluates the held value).
- compiler/src/codegen/rewrite.ts + block-splitter.js + match-statechild-parser.ts + codegen/emit-match.ts — the `fcdec43c` render-expr prereq seams (error-display gating bugs surfaced by the corpus-wave-1a rewrites; see error.map.md "S196" + test.map.md "S196 New Test Files").
- compiler/SPEC.md + compiler/SPEC-INDEX.md — NEW §19.15 (`<render of=X/>` Render-Expression; .1 Syntax, .2 Semantics, .3 Exhaustiveness fence, .4 What it does NOT do, .5 Codegen) + §19.2 `renders`-clause amend + §4.15/§24.4 register `<render>` + §34/§19.13 ×3 E-RENDER codes + §18.0 E-MATCH-ARM-MARKUP-IN-VALUE row.

## Key S195 Source Changes (GAP-A: §24 void elements self-terminate in `<match>`/`<each>` arm bodies)

A two-stage arm-closer scanner fix (`f563bc89`, change-id `match-arm-void-element-scanner-2026-06-15`,
agent worktree-agent-aded0e07766634224 / 0a04cf2d). A BARE void HTML element (`<input>`, `<br>`,
`<img>`, … — the §24 void set) used as a DIRECT child of a `<match for=T on=@x>` (or `<each>`) arm
body was mis-consumed by the arm-closer scanner at TWO pipeline stages: the bare void opener was pushed
onto the body tag-stack / incremented the arm-close nesting depth, so the arm's own `</>` / `</Variant>`
(or the outer `</match>`) closer was mis-read as the void's closer, the stack never unwound, and the
scan ran to EOF → a misleading **E-CTX-001** "Unclosed `<match>`" / **E-MATCH-PARSE-001**. The
self-closed form `<input/>` already short-circuited (`isSelfClosing`); both scanners now treat bare void
openers as self-terminating leaves too (parity with plain markup). NO new diagnostic code, NO SPEC
change (§24 + §4.14 + §18.0.1 already imply void = self-terminating leaf). Full suite 24285/0; +13 unit
tests / 46 expects; benefits `<each>` bodies via the shared BS scanner. Unblocks form-bearing `<match>`
arms (the 09-error-handling errors-as-states corpus rewrite). PA-independent A/B verify: the bare-input
repro fires E-CTX-001 on the pre-fix compiler (`cd822f7a`) and compiles clean on this fix.

- compiler/src/block-splitter.js — `findStructuralBodyEnd(source, startPos, outerTagName)` (the generic
  tag-stack scanner for `STRUCTURAL_RAW_BODY_ELEMENTS` = match / each bodies): the `tagStack.push(openerName)`
  gate (~line 691) gained a `&& !VOID_ELEMENTS.has(openerName)` clause, so a bare void opener no longer
  pushes onto the body tag-stack. `readTagName` already lowercased `openerName`, so the `VOID_ELEMENTS`
  lookup is case-correct; the self-closed `<input/>` form still short-circuits via `isSelfClosing` above.
- compiler/src/match-statechild-parser.ts — NEW local `const VOID_ELEMENTS = new Set([...])` (~line 54;
  the §24 set, kept local because this file is otherwise import-free, parallel to the engine-statechild
  scanner). `parseMatchArms` → `findArmCloser` opener branch (~line 397): reads the opener tag name into
  `openerTagName` (lowercased) + `isVoidOpener`, and `if (!isVoidOpener) depth++` at the opener's `>`
  (mirrors the self-closing `/>` branch). ALSO fixes a LATENT flush-closer bug: the old `p = q` inside
  the scan loop then `if (p < q) continue` ALWAYS fell through to the trailing `p++` (since `p === q`),
  dropping the byte after an opener `>` — which SKIPPED the `<` of a closer flush against the opener `>`
  (e.g. `<input></Editing>`). Now resumes at `q` with a `foundOpenerEnd` flag and `continue`s
  unconditionally; EOF inside the opener leaves `p === len` so `findArmCloser` returns null (the caller
  fires E-MATCH-PARSE-001 for the genuinely-malformed arm).

## Ignored / Generated Paths
node_modules/, compiler/node_modules/, dist/, compiler/dist/, compiler/native-parser/dist/,
compiler/self-host/dist/, stdlib/*/dist/, .git/, handOffs/,
benchmarks/todomvc-react/, benchmarks/todomvc-vue/, benchmarks/todomvc-svelte/

## Tags
#scrmlts #map #structure #compiler #cli #bun #engine-graph #source-map #each #each-in-dynamic-context #match #engine-statechild #cross-file-modules #enum-subset #message-dispatch #s154 #s155 #s156 #s157 #s158 #s159 #s160 #bug60 #bug62 #bug63 #bug64 #bug65 #bug70 #bug71 #bug72 #bug73 #r28-1c #r28-8 #per-item-reactivity #live-keyed #colon-shorthand-html #colon-shorthand-canonical #shape4-no-rhs #bare-variant-inference #native-parser #native-parser-swap #each-promotion #match-promotion #flip-failure-families #f1-engine-substrate-closed #engine-substrate-fix #b1-reset-expr #b2-message-arm-closed #native-exprnode-walker #f2-match #promote-each #typed-atcell #server-fn-star #bare-function-failable #cross-file-export-bodystart #flip-605 #flip-508 #deepset-write-loss #reactive-nested-assign #reactive-array-mutation #s161 #s162 #s163 #s164 #s165 #s166 #s167 #s168 #s169 #value-native-maps #map-type #cycles-prereq #set-algebra #scrml-data #bug-b-structural-compound-deepset #stamp-compound-deepset-targets #on-mount-dismount #const-at-derived-decl #f5-closed #deepset-node-synth #exprtext-backfill-walker #blockstub-verbatim-body #mario-match-arm-fix #s170 #s173 #e-export-001 #w-type-fn-field #s174 #log-builtin #log-loc #location-transparent-logging #w-log-shadowed #e-type-any-forbidden #no-any-hard-line #production-strip #production-flag #s175 #typed-sql-row #sql-projection #width-subtyping #e-sql-row-contract-mismatch #w-sql-row-untyped #e-struct-function-field #function-boundary #passed-vs-stored #f-schema-001 #fn-return-inference #flagship-typed-data #s176 #e-type-unknown-name #unrecognized-type-name #w-pure-deprecated #pure-deprecation #migration-3 #scrml-math #scrml-random #scrml-time-now #capability-scoped #non-deterministic #e-fn-004 #transitive-shim-copy #s177 #g-formfor #markup-expansion-in-arms #arm-body-children #r27-c6 #r28-7b #bug-4 #bug-48 #bug-74 #e-closer-001 #schemafor-predicated-base #s169-map-inline-insert #inline-sibling-shim-imports #client-stdlib-inliner #math-de-leak #s179 #e-route-003 #e-route-004 #wire-serializability #i-fn-promotable-inferred-server #e-fn-001 #s180 #server-keyword-eliminate #w-deprecated-server-modifier #migration-4 #trigger-7 #trigger-8 #channel-broadcast #handle-middleware #inferred-boundary #sse-route #emit-client-inferred #mcp-descriptors-inferred #s181 #w-display-text-overquote #display-text-overquote #inverse-footgun #e-unquoted-display-text #check-display-text-overquote #server-keyword-reword #e-cg-006 #w-lint-019 #s182 #e-engine-effect-not-interpolated #engine-effect #effect-interpolated #engine-var-dedup #e-engine-003 #s183 #e-formfor-not-imported #e-tablefor-not-imported #scan-for-unimported-type-data-element #formfor-unimported #tablefor-unimported #w-tailwind-001 #w-tailwind-unrecognized-class #find-interpolation-ranges #token-touches-interpolation #dynamic-class-prefix #g-tailwind-dynamic-class-prefix #fn-pure-canonicity #i-fn-promotable-reword #s184 #lifecycle-field-comment-leak #collect-braced-body-comment-skip #e-struct-function-field-fp #e-type-001-double-fire #statement-text-normalize #w-lint-007-ghost-fp #shape-1-variant-lifecycle-initializer #infer-enum-from-variant-lifecycle-annotation #e-variant-ambiguous #snippet-fill-exemption #braced-body-opens-paren-arrow-lambda #w-lint-004 #w-lint-021 #payload-binding-gaps #extract-match-arm-payload-bindings-by-variant #match-block-arm-payload-scope #error-arm-multi-field #table-for-synth-skip #w-each-promotable #s186 #channel-codegen #g-channel-reconnect-bare-int #g-channel-handler-wiring #onserver #onclient #channel-ws-handler #is-channel-ws-handler #collect-channel-attr-handler-names #channel-attr-to-call #reconnect-bare-int #e-scope-001-exempt #s185 #errarm-refail #fail-from-arm #re-fail-from-arm #parse-fail-expr-string #emit-fail-expr #match-arm-fail-expr #ns1-recurse-failexpr #e-validator-inline-colon #validator-inline-msg-paren #try-recover-colon-inline-message #colon-form-reject #s19-5-2 #s188 #g-not-negation-enforce #e-type-045 #prefix-not-negation #not-prefix-detector #harvest-not-prefix-negation #lowering-choke-point #cluster-A #e-attr-unquoted-operator #attr-condition-operator-ahead #is-condition-attr-name #is-prefix-not-operand-ahead #attr-op-reject #unquoted-condition-atomic-only #g-division-in-ternary-arm #ternary-depth-guard #typed-reactive-boundary #s189 #given-rebind-reject #e-syntax-045 #given-narrows-in-place #channel-cell-write-client-side #ruling-a #e-channel-server-cell-read #detect-server-context-channel-cell-read #trigger-7a-drop #channel-cell-client-held #for-each-ident-in-expr-node #schemafor-create-table-pa #extract-schemafor-create-table-statements #pa-pluralize-struct-name #split-struct-fields-top-level #pre-bind-reactive-state-cells #reactive-cell-hoist #section-6-9 #annotation-ordering #s190 #cluster-c #e-decl-rhs-interp-wrapped #markup-root-closed #markup-const-sibling-swallow #g-derived-rhs-interp-wrapped #g-markup-const-consumes-cell-decl #derived-engine-expression-form #derived-expr-node #derived-expr-kind #inline-match-derived #expr-derived #legacy-source-var #b16-no-rules #b16-no-initial #b16-no-write #b16-circular #derived-upstream-enum #e-engine-004-steer #c14-derived-substrate #e-derived-engine-initial-undefined-rt #dependency-graph-derived-edges #section-51-0-j #section-51-9 #section-52-1 #s191 #tailwind-composing-families #approach-c #inline-var-fallback #no-preflight-block #register-ring #register-gradient #register-transform #register-filters #register-backdrop #box-shadow-compose #transform-compose #filter-compose #backdrop-compose #ring-shadow-setter #section-26-7 #section-26-7-1 #section-26-7-2 #section-26-7-3 #if-fn-condition #call-ref-conditional #g-attr-if-fn-call-misroute #g-attr-if-fn-display-not-mount #g-attr-if-fn-chain-head-call-misroute #update-chain-call-ref #reactive-conditional-not-event #section-5-1 #s194 #server-authority #tier-1-read-authority #tier-2-server-var #auto-persist-retracted #q1-c #q2-wf #emit-server-authority-load #server-load-route #select-star-load #collect-server-authority-types #try-parse-server-authority-decl #authority-server-gate #server-authority-instance #server-authority-table #w-auth-001-suppressed #w-auth-002-ssr-residual #ssr-pre-render-residual #section-52-6 #section-52-6-2 #section-52-6-6 #section-52-6-7 #spec-issue-026 #server-write-fn-convention #channel-fan-out-composition #broadcast-explicit-composition #emit-sync-stub-deleted #optimistic-update-deleted #read-authority-only #s195 #gap-a #void-element-self-terminating #match-arm-void #each-arm-void #find-structural-body-end #find-arm-closer #void-elements-set #arm-closer-scanner #flush-closer-fix #e-ctx-001-unclosed-match #e-match-parse-001 #s196 #render-expression #render-of #render-element #render-held-accessor #all-variant-render-exprs #emit-boundary-markup-expr #e-render-no-of #e-render-no-clause #e-render-not-enum #e-match-arm-markup-in-value #held-error-display #g-held-error-display-closed #errors-as-states #section-19-15 #section-4-15 #section-24-4 #section-18-0 #structural-element #data-scrml-render-anchor #limit-the-primitive

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
