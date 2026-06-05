# primary.map.md
# project: scrmlts
# updated: 2026-06-05T02:08:00Z  commit: f11db672

## Project Fingerprint
Language:   TypeScript / JavaScript (mixed; Bun runtime)
Framework:  Custom compiler pipeline (no web framework)
Runtime:    Bun >=1.3.13
Type:       CLI compiler + language toolchain (single-file full-stack web language compiler)
Size:       ~1400 source files (886+ test + 143+ compiler/src + 38 native-parser .js + stdlib + lsp)
Version:    v0.7.0 (project-tracked; compiler/package.json reads 0.2.0 — subpackage drift, ignore)

## Map Index

| Map                  | Status  | Contents                                                      |
|----------------------|---------|---------------------------------------------------------------|
| structure.map.md     | present | directory layout, entry points, S148-S160 source changes (engine-graph, source-map, _scrml_modules, dev watcher, Shape 4, S153 each-in-dynamic-context, S154 message-arm parser, S155 #14 typer+codegen, S156 Bug 62 engine-ctx + (d)-A enum-subset 4 batches, S157 Bug 60/63/65/67/68/70/71 + match-exhaustiveness, S158 Bug 64/R28-1c per-item-reactivity + Bug 72 nested-each-in-lift, S159 Bug 73 per-item-handler-live-keying + S154 ruling (a) HTML colon-shorthand content-model, S160 S154 ruling (b) inside-opener colon-shorthand canonical + ruling (c) no-RHS typed-decl Shape 4 generalized, **S162 native-parser each-promotion arc + @. lexer sigil + F3 same-line match-arm + deepened native-parser file table + native-parser-swap ~6-family orientation**); bare-variant inference helpers table with exact line numbers for R28-8 dispatch |
| dependencies.map.md  | present | 9 packages (3 runtime root + 2 compiler + 4 devDeps), internal graph (HEADER STALE — content not touched by S154-S162, last refreshed 4e1f9492) |
| schema.map.md        | present | ~47 AST node types + `acceptsType` on EngineDeclNode (S154) + `subsetVariants` on PredicatedType (S156) + MessageArmEntry + EnumSubsetParse (S155-S156) + `EachEngineCtx` + `EachReconcileCtx` (S156-S159: EachReconcileCtx.iterVar also used by Bug 73 handler-wrap gate) + `matchExpr` side-field on ReactiveDeclNode (S157 Bug 71) (HEADER STALE — content not touched by S162; native each-block/match-block synth shapes mirror live `each-block`/`MatchBlockNode`) |
| config.map.md        | present | 4 env vars, 3 config files (HEADER STALE — last refreshed 948d3f2f) |
| build.map.md         | present | 12 npm scripts, maintenance scripts, pre-commit hook (HEADER STALE — last refreshed 948d3f2f) |
| error.map.md         | present | 382+ error codes; +5 new S154-S156 codes; +1 S159 E-COLON-SHORTHAND-ON-VOID; +2 S160 codes (W-COLON-SHORTHAND-LEGACY-PLACEMENT info-level lint + E-REFINEMENT-NO-DEFAULT); E-DECL-NEEDS-INITIALIZER scope narrowed to const-derived only; E-TYPE-001 message extended with synthesizedFromNoRhs note; **S162 native each-block-promotion note on the E-CODEGEN each-in-match historical fix (the `markup tag="each"` parenthetical is now native-stale)** |
| test.map.md          | present | bun:test, ~886 .test.js files; +11 S154-S156 unit+browser+conformance tests; +14 S157-S158 unit+browser tests; +3 S159; +2 S160; **+5 S162** (native-each-promotion unit, native-match-arm-same-line, parser-conformance-each-contextual-sigil, each-contextual-sigil-native browser, parser-conformance-markup) |
| domain.map.md        | present | 12-stage pipeline + sidecar, 30+ domain concepts incl. S153 each-in-dynamic-context, S155 `accepts=`/message-dispatch/#14 plane, S156 Bug 62 engine-ctx threading, S157 Bug 65/60 + match-exhaustiveness, S158 Bug 64/R28-1c + Bug 72, S159 Bug 73 + S154 ruling (a); **S162 native-parser-swap orientation block (~6-family flip-failure table + F1-next) + each/match-promotion now CLOSED in native parser**; codegen each/match/engine emit map |
| api.map.md           | absent  | no HTTP route handlers in compiler source                     |
| state.map.md         | absent  | no client state management (compiler is a pure function)      |
| events.map.md        | absent  | no EventEmitter/pubsub detected in compiler source            |
| auth.map.md          | absent  | auth is a COMPILED FEATURE (auth-graph.ts), not compiler auth |
| style.map.md         | absent  | no design tokens or CSS framework in compiler source          |
| i18n.map.md          | absent  | no i18n detected                                              |
| infra.map.md         | absent  | no Dockerfile, CI workflows, or IaC detected                  |
| migrations.map.md    | absent  | no database migrations (runtime DBs are user-app concerns)    |
| jobs.map.md          | absent  | no job scheduler in compiler source                           |

## File Routing

| Query | Map |
|-------|-----|
| types / interfaces / AST node shapes | schema.map.md |
| error codes / CGError / diagnostic stream / fix-notes | error.map.md |
| environment variables / config keys | config.map.md |
| test patterns / fixtures / conformance / happy-dom canaries | test.map.md |
| build commands / pre-commit hook | build.map.md |
| directory layout / entry points / pipeline stages / per-session source changes / native-parser file table | structure.map.md |
| external packages (acorn, astring, MCP SDK, vscode-languageserver) | dependencies.map.md |
| domain concepts (pipeline stages, engine-graph, source-map, each/match emit, enum-subset, message-dispatch, per-item-reactivity, live-keyed, render-by-tag, match-exhaustiveness, colon-shorthand HTML content-model) | domain.map.md |
| native-parser-swap state / flip-failure families / which native file owns which family | domain.map.md "Native-Parser Swap Orientation" + structure.map.md "Native-Parser File Table (S162)" |
| `<each>` / `<match>` / engine codegen emit modules | domain.map.md "Codegen each/match/engine Emit Map" + structure.map.md S154-S162 |

## Task-Shape Routing (agents — read this section first)

This is a COMPILER repo. Task shapes are bug-fix / codegen / parser / new-feature / spec-amendment /
test-authoring / audit. Each shape lists maps in priority order — read in order until oriented.

**compiler-source bug fix (the dominant shape — most dispatches):**
1. `error.map.md` — find the offending code, its family, AND the "Fix Notes" for any prior fix on the same class (the S153 each-in-dynamic-context, S157 Bug 65/Bug 60, S158 Bug 64/R28-1c/Bug 72, S159 Bug 73 / S154 ruling (a) notes are pattern templates — read them before re-diagnosing)
2. `domain.map.md` — locate the responsible pipeline stage + its primary source file (Pipeline Source Files table) and any relevant invariant
3. `structure.map.md` — the "Key S154-S162 Source Changes" section gives exact file + function + line for recently-touched code; the codegen directory ownership line names the emit-* module
4. `test.map.md` — find the existing canary for the feature; a behavior fix WITHOUT a happy-dom test is the S140/S152 blind-spot trap — always add one

**codegen (`<each>` / `<match>` / engine / emit-* work — highest-churn area right now):**
1. `domain.map.md` — the **"Codegen `<each>` / `<match>` / engine Emit Map"** table (the single most load-bearing table for codegen work; names every emit module + its role + the S153-S159 runtime helpers and Bug 62/64/65/72/73 patterns)
2. `structure.map.md` — S154-S162 source-changes section: exact functions + line numbers in emit-each.ts / emit-lift.js / emit-control-flow.ts / emit-engine.ts / emit-html.ts / runtime-template.js / dependency-graph.ts / ast-builder.js / block-splitter.js / type-system.ts
3. `error.map.md` — E-CODEGEN-INVALID-JS fix notes + chunk-survival / dep-first-read / engine-ctx-threading / per-item-live-keyed / per-item-handler-live-keyed invariants (a codegen change that tree-shakes a needed chunk → ReferenceError; engine-ctx absence → silent wrong JS; per-item binding without reconcile-ctx wrap → stale content; per-item handler without live-keyed prelude → stale handler data)
4. `test.map.md` — happy-dom canary list; emit-string-only tests mask runtime miscompiles

**per-item reactivity / reconcile (`<each>` and `${for…lift}` live-keyed bindings AND handlers — Bug 64/R28-1c closed S158; Bug 73 closed S159):**
1. `domain.map.md` — Bug 64/R28-1c concept + Bug 73 concept + `_scrml_reconcile_list` key→item map + `_scrml_resolve_item` contract + `maybeWrapEachPerItemEffect`/`maybeWrapLiftPerItemEffect` (content) + `maybeWrapEachPerItemHandler`/`maybeWrapLiftPerItemHandler`/`maybeWrapLiftCallableHandler` (handlers) invariants
2. `schema.map.md` — `EachReconcileCtx` + `EachEngineCtx` shapes (EachReconcileCtx.iterVar used by both display and handler wrap gates)
3. `error.map.md` — Bug 64 fix note (three-layer: runtime + Tier-1 + Tier-0); Bug 73 fix note (fire-time prelude vs `_scrml_effect`; `iterScopeReferencedInHandler` gate; callable-direct shadow shape)
4. `structure.map.md` — S158-S159 changes: emit-each.ts (1742L), emit-lift.js (2318L), emit-control-flow.ts (2013L), runtime-template.js (3760L)

**parser / grammar fix — NATIVE-PARSER swap-grind (the active strategic line — drives `--parser=scrml-native` to default):**
1. `domain.map.md` — **"Native-Parser Swap Orientation"** block: the family flip-failure table (by locus + native file owner), which family is the NEXT dispatch (**B2 §51.0.S message-arm as of S164**), the CLOSED each/match-promotion precondition, AND the CLOSED F1 engine-substrate silent-miscompile (S163 machineDecls instance-share fix). Read this FIRST for any native-parser flip-failure work.
2. `structure.map.md` — **"Native-Parser File Table (S162)"** in the S162 source-changes section: every key `compiler/native-parser/*.js` file + one-line role + approximate size; names the locus file for each family (e.g. F1 → `parse-state-body.js` + `parse-markup.js` markup-classification; F3 → `parse-expr.js`; F5/F6/F9 → `parse-stmt.js`; F2 → `parse-sql-body.js`); plus the S162 changes (parse-file.js each-block promotion, tag-frame.js STRUCTURAL_ELEMENTS, lex-in-code.js `@.` sigil, parse-expr.js F3 arm-boundary). NOTE the `.js`/`.scrml` paired mirrors are FEATURE-stale (S162) — native fixes go in the `.js`; the `.scrml` is moot until a re-sync.
3. `error.map.md` — E-UNQUOTED-DISPLAY-TEXT (F1 spurious fire), E-ENGINE-STATE-CHILD-MISSING / E-ENGINE-ACCEPTS-NOT-ENUM / E-ENGINE-MSG-* / E-CTX-* / E-EXPR-* / E-STMT-* / E-STRUCTURAL-ELEMENT-MISPLACED / E-SYNTAX-064 families; the each-in-match historical-fix note (now native-stale)
4. `test.map.md` — parser-conformance within-node allowlist (live-pipeline vs native-parser parity); S162 native-each-promotion + native-match-arm-same-line + each-contextual-sigil conformance tests; the flip-harness re-measure tracks per-family counts

**parser / grammar fix — LIVE pipeline (block-splitter / ast-builder / engine-statechild-parser):**
1. `domain.map.md` — pipeline stage (BS/TAB) + engine-arm-parsing row; the each-block/match-block transform lives in `buildAST` (TAB), now ALSO mirrored in the native parser (S162); S159 `:`-shorthand HTML content-model concept; S160 ruling (b) inside-opener canonical concept
2. `structure.map.md` — engine-statechild-parser.ts S154 `parseMessageArms()` + S160 ruling (b) `legacyColonPlacement` detection; match-statechild-parser.ts S160 ruling (b) `legacyColonPlacement`; S153 `isColonShorthandOpener` change; native-walker S160 parity field; S158 ast-builder `_parseLiftAttrValue` bare-`@` branch; S159 ast-builder `buildBlock` synthesis; S160 ruling (c) ast-builder Shape 4 generalization + `TYPE_BOUNDARY_KEYWORDS`; block-splitter.js `shorthand && !selfClosing` reorder
3. `error.map.md` — E-ENGINE-STATE-CHILD-MISSING / E-ENGINE-ACCEPTS-NOT-ENUM / E-ENGINE-MSG-* / E-CTX-* / E-EXPR-* / E-STMT-* / E-SYNTAX-064 / E-COLON-SHORTHAND-ON-VOID / W-COLON-SHORTHAND-LEGACY-PLACEMENT / E-REFINEMENT-NO-DEFAULT families
4. `test.map.md` — parser-conformance within-node allowlist (live-pipeline vs native-parser parity); S159 html-colon-shorthand-content-model-s159.test.js; S160 colon-shorthand-inside-opener-s154b.test.js + typed-array-no-rhs-default.test.js

**bare-variant inference fix (R28-8 target — type-system.ts):**
1. `structure.map.md` — "Bare-variant inference helpers" table in S160 source-changes section: exact function names + definition lines (`inferBareVariantsInExpr` @7925, `inferBareVariantsForStructConstructor` @8153, `inferBareVariantsWithStructNav` @8199) + let/const-decl call site @~5820
2. `error.map.md` — E-VARIANT-AMBIGUOUS (the code fired when no type context exists for a bare variant); E-CONTRACT-001 (static literal fails predicate — fired via `resolveBareVariantAgainstType`); E-TYPE-063 (invalid variant in two-plane engine resolution)
3. `domain.map.md` — bare-variant inference domain concept (§14.10 + §14.10.7 struct-nav walker)
4. `schema.map.md` — `PredicatedType.subsetVariants` + ExprNode shapes that the walker descends

**enum-subset refinement work ((d)-A arc follow-up / Bug 69 / batch 5 if confirmed):**
1. `domain.map.md` — enum-subset refinement concept + three consumers (match exhaustiveness, predicate codegen, schemaFor DDL)
2. `structure.map.md` — S156 (d)-A batch descriptions; `enum-subset-refinement.ts` is the shared recognizer
3. `error.map.md` — E-MATCH-SUBSET-DEAD-ARM + E-CONTRACT-002 extension
4. `schema.map.md` — `PredicatedType.subsetVariants`, `EnumSubsetParse`, `parseEnumSubsetAnnotation` shapes

**match-exhaustiveness / match-as-expression (S157 arc follow-up):**
1. `domain.map.md` — match-as-expression exhaustiveness concept + E-SYNTAX-064 / E-CODEGEN suppression
2. `structure.map.md` — S157 match-exhaustiveness arc: ast-builder.js dual-parse hooks (Bug 71 derived, Bug 67 return-match); type-system.ts Bug 63 markup-attr `.advance` check
3. `error.map.md` — E-SYNTAX-064 promoted; E-TYPE-020 exhaustiveness path; E-TYPE-063 markup-attr advance; E-CODEGEN-INVALID-JS Bug 70 suppression
4. `schema.map.md` — `matchExpr` side-field on `ReactiveDeclNode` (Bug 71)

**`:` -shorthand canonicalization / migrate --fix (S160 ruling (b)):**
1. `error.map.md` — W-COLON-SHORTHAND-LEGACY-PLACEMENT fix note (two fire sites, info-level, `migrate --fix`)
2. `structure.map.md` — S160 ruling (b) source-changes: engine-statechild-parser.ts `legacyColonPlacement` detection; match-statechild-parser.ts same; symbol-table.ts two emission sites; commands/migrate.js `rewriteColonShorthandPlacement` export
3. `test.map.md` — colon-shorthand-inside-opener-s154b.test.js coverage (detection + rewrite output)

**no-RHS typed-decl / Shape 4 (S160 ruling (c)):**
1. `error.map.md` — E-REFINEMENT-NO-DEFAULT fix note; E-DECL-NEEDS-INITIALIZER scope narrowed; E-TYPE-001 synthesizedFromNoRhs note
2. `structure.map.md` — S160 ruling (c) source-changes: ast-builder.js TYPE_BOUNDARY_KEYWORDS + Shape 4 dispatch; type-system.ts `buildCellValueLifecycleMap` implicitNotLifecycle + `runRefinementNoRhsDefaultCheck`
3. `test.map.md` — typed-array-no-rhs-default.test.js coverage matrix

**new feature / spec-amendment:**
1. `domain.map.md` — invariants + concept lexicon (check language cohesion before proposing syntax)
2. `structure.map.md` — where the feature's stage lives
3. `schema.map.md` — AST node shapes (a new construct needs a node type)
4. `error.map.md` — code-family conventions for any new diagnostic

**test-authoring:**
1. `test.map.md` — runner, categories, patterns, cross-stream W-/I- helper requirement
2. `error.map.md` — the code under assertion (and which stream it lands in)

**audit / non-compliance:**
1. `non-compliance.report.md` — current findings + dispositions (Bug 69 NON-GAP tension flagged as uncertain)
2. `structure.map.md` — what's in-scope vs out-of-scope (archive/, handOffs/, samples/)

**Don't know which** (e.g., open-ended task brief from user):
1. Read `primary.map.md` (this file) in full
2. Read the Task-Shape Routing section above and self-classify
3. If genuinely unclear, surface to PA before consuming further context

## Use feedback loop

When this map's content was load-bearing for a dispatch outcome, the agent's final report should
note **"map content consulted: [list of map files]; load-bearing finding: [one sentence]"**. When
the map content was NOT useful, report **"maps consulted but not load-bearing"** so PA can diagnose
whether the wrong maps were named in the brief OR the map content is at the wrong granularity.
3-5 consecutive "not load-bearing" reports on the same task shape trigger a map-design review.

## Key Facts
- Entry point: `compiler/src/cli.js` → subcommand router; public API in `compiler/src/api.js` → `compileScrml()`; `--emit-engine-graph` flag (S149) writes `<base>.engine-graph.json` sidecar
- Pipeline: 12 ordered stages BS → TAB → NR → MOD → CE → PA → RI → TS → META → VSS → DG → CG; stage contracts at `compiler/PIPELINE.md`; engine-graph sidecar runs after CG via lazy getter in compile result
- Spec: `compiler/SPEC.md` (~31,500 lines, 58 sections + appendices); normative per pa.md Rule 4; §4.14 amended S159 (HTML `:`-shorthand content-model); §4.14 / §51.0.I / §18.0.1 amended S160 (inside-opener `:`-shorthand canonical); §6.2 Shape 4 amended S160 (no-RHS typed-decl defaults); **§4.15 / §24.4 amended S162 (e5b673dc) to register `<each>` as a structural element (joins `engine`/`match`/`page` in the reserved-name list + attr-catalog)**
- Error surface: CGError with `severity: 'error'|'warning'|'info'`; W-*/I-* → result.warnings (non-fatal); all else → result.errors (fatal, CLI exit 1); emitted-JS parse-gate (E-CODEGEN-INVALID-JS) is default-ON BUT suppressed when compilation already has a prior fatal error (Bug 70, api.js)
- `<each>` codegen is the highest-churn area: Bug 62 (S156) closed engine-ctx threading in emit-each.ts; Bug 65 (S157) CLOSED the SAME gap in emit-lift.js; Bug 64/R28-1c (S158) CLOSED per-item content reactivity (TEXT/class: bindings) on reconcile for both tiers; Bug 72 (S158) CLOSED nested `<each>` inside `${for…lift}`; Bug 73 (S159) CLOSED per-item EVENT HANDLER live-keying for both tiers — handlers prepend `_scrml_resolve_item` prelude at FIRE TIME (not `_scrml_effect`; no subscription). `iterScopeReferencedInHandler` (emit-each.ts, shared with emit-lift.js) gates the wrap — global handlers stay byte-identical. Read domain.map.md "Codegen Emit Map" before touching any of these files.
- S159 content-model rule: `<span : @label>` now correctly renders as `<span>${@label}</span>` (prior: empty `<span></span>` + false E-DG-002). `<input : @val>` fires `E-COLON-SHORTHAND-ON-VOID` (fatal). Three-part impl: ast-builder.js body-child synthesis (R1), block-splitter.js branch reorder (R4a), type-system.ts guard + E-SYNTAX-064 extension (R4b/R3).
- **S160 ruling (b)**: `<Idle : expr>` (inside-opener) is now the ONLY canonical form; `<Idle> : expr` (after-`>`) emits `W-COLON-SHORTHAND-LEGACY-PLACEMENT` (info-level). `bun scrml migrate --fix` rewrites via `rewriteColonShorthandPlacement()`. Both `engine-statechild-parser.ts` and `match-statechild-parser.ts` expose `legacyColonPlacement: boolean` per arm.
- **S160 ruling (c)**: `<x>: User` (no-RHS typed decl) synthesizes `not` init + implicit `(not to User)` lifecycle (§6.2 Shape 4 + §14.12.3). `<x>: number` → `0`. `<x>: bool` → `false`. `<x>: string` → `""`. `<x>: number(>0)` (refinement-violates canonical empty) → `E-REFINEMENT-NO-DEFAULT`. `const <x>: User` → E-DECL-NEEDS-INITIALIZER (preserved for derived cells). Lifecycle note added to E-TYPE-001 when the lifecycle was synthesized from no-RHS declaration.
- **R28-8 next dispatch**: `inferBareVariantsWithStructNav` (type-system.ts:8199), `inferBareVariantsInExpr` (type-system.ts:7925), `inferBareVariantsForStructConstructor` (type-system.ts:8153); primary call site is let/const-decl annotation path at ~line 5820 in `processFile`. See structure.map.md S160 "Bare-variant inference helpers" table for the full call-site map.
- S155 runtime contract: `_scrml_engine_dispatch_message(varName, msg, armTable, table, ...)` (runtime-template.js) dispatches `(state × message)` arms; calls `_scrml_engine_advance` for the target transition; handles §51.0.R idle reset on a handled message
- S158 runtime contract: `_scrml_reconcile_list` builds `container._scrml_item_by_key` key→item Map on every pass + calls `_scrml_trigger(container, "_scrml_items")`; `_scrml_resolve_item(container, key)` tracks item slot + returns live item via `_scrml_deep_reactive` or `null` (canonical absence — NOT `undefined`)
- S156 (d)-A runtime contract: `Enum oneOf([.A,.B])` / `notIn([...])` annotated cells carry `subsetVariants: Set<string>` in `PredicatedType`; boundary checks lower to `(["A","B"].includes(v))`; schemaFor fields lower to `CHECK IN ('A','B')`. Range form is forbidden (§53.15.1). `enum-subset-refinement.ts` is the shared dependency-free recognizer.
- S153 runtime contract: `_scrml_each_renderers` registry + `_scrml_remount_each(root)` (runtime-template.js) — each-mount inside a non-`initial=` engine arm registers at module-init and re-renders when the variant-swap dispatcher mounts its arm

### Native-Parser Swap — current state (S161 ratified / S163 engine-substrate fix / S164 re-measured)
- **The active strategic line**: drive `--parser=scrml-native` to DEFAULT, then DELETE legacy block-splitter (BS) + Acorn at M6 (direction-a, ratified S161; realistic v0.8 target). The native parser is `compiler/native-parser/` (paired `.js` bootstrap + `.scrml` self-host mirror; `--parser=scrml-native` flag). **The Phase-A default-flip is a STANDING USER DECISION — PA ships parity-closers, never "the flip."**
- **CLOSED — each/match structural promotion (was the HARD M5-swap precondition, S153)**: as of S162 the native parser promotes BOTH `<each>` → `each-block` (`isEachBlock`/`synthEachBlockNode`) AND `<match>` → `match-block` (`isMatchBlock`/`synthMatchBlockNode`). `@.` sigil lexed; emit-each honors the `exprNode` contract; `<each>` registered structural (§4.15/§24.4).
- **CLOSED — F1 engine-substrate silent-miscompile (S163, `a41df176` — the headline fix)**: the ~168 "engine arm-body" family's DOMINANT cause was NOT spurious `E-UNQUOTED`/arm-body classification (that was the S139-trap framing at survey level). Native silently DROPPED the entire §51.0 engine substrate (transition table, `_scrml_engine_direct_set` rule-validation, var-init, mount/body-render) — emitting `<engine>` as a dumb `_scrml_reactive_set` cell. **Root cause = a `machineDecls` TWO-INSTANCE object-identity defect** (nodes copy via `parse-file.js synthEngineNode` + a SEPARATE machineDecls copy via `collect-hoisted.js synthEngineDecl`; SYM stamped the nodes copy, codegen `collectC12EngineDecls` read the un-stamped machineDecls copy first → substrate dropped). **Fix (~40L):** native derives `machineDecls` from the mapped `nodes` instances (`collectMachineDeclsFromNodes` in parse-file.js) + maps `bodyChildren` to AST nodes; `collect-hoisted.js` no longer synthesizes engines. All 6 swept engine sub-features byte-identical native==default. **B1 (S163, `6ad8ca13`):** native `reset(@cell)` → `reset-expr` (translate-expr.js). **§4.18 ruling (S163):** native's `E-UNQUOTED-DISPLAY-TEXT` on bare display text in code-default arm bodies is SPEC-CORRECT (§4.18.7), NOT spurious — native enforces, LIVE stays lenient; corpus bare-text→`"..."` migration is deferred swap-prep backlog.
- **S164 flip re-measure: 674 flip-failures** (down from ~790 S162, 1,150 S161; engine-substrate + B1 killed ~116). ~8 environmental (6 ECONNREFUSED browser + 2 within-node SPAN-COORD) → ~666 genuine, 181 files, ~6 families (full table in domain.map.md "Native-Parser Swap Orientation"):
  - **B2 §51.0.S message-arm (~20, L-subset) — THE NEXT DISPATCH**: native `synthEngineDecl` has ZERO `accepts=` handling (acceptsType undefined vs live null); `native-walker/engine-statechild-walker.ts:516` hard-codes `messageArms: []`. Mirror live `parseMessageArms()` in `engine-statechild-parser.ts` (S154/S155 #14). Signatures: `E-ENGINE-ACCEPTS-NOT-ENUM` (4) + `E-ENGINE-MSG-UNKNOWN` (3) + engine-message-dispatch conf/browser.
  - **mario PowerUp payload-enum (NEW S163)** — native captures only `["Mushroom"]` (drops payload variants), mis-emits `PowerUp.Flower(3)` as `"Flower"(3)`; payload-bearing-enum native gap (mario residual 133 diff-lines).
  - **`effect=` opener (§51.0.H Form 3, small)** — native `synthEngineDecl` has no openerEffect read.
  - F2 SQL `?{}` in server-fn (~58) — `parse-sql-body.js` drops SQL body in top-level server fns.
  - F3 if-as-expr residual (small) — same-line match arms DONE S162 (`parse-expr.js isAtArmBoundary`); if-as-expr LOW.
  - F4 formFor expansion (~32) — native parse→bridge→form pass drops field-markup expansion.
  - F5 `const @name` derived-decl (~20) — `parse-stmt.js` rejects `@`-prefixed decl.
  - F6/F9 fn param / export-fn-body (~16) — `parse-stmt.js` / `parse-expr.js`.
  - F7 missing diagnostics (~15) — body-parser gates swallow `E-STRUCTURAL-ELEMENT-MISPLACED` etc.
  - F8 stdlib `await import()` (13) — RULED a stdlib-migration task (native stays strict no-`await` enforcer); NOT a native-parser change.
  - Other large signatures spread across families: `E-CODEGEN-INVALID-JS` (18), `E-TYPE-063` (15) + `E-VARIANT-AMBIGUOUS` (4) (native bare-variant resolution), `E-TYPE-001/-020` (14/14), `E-MATCH-NOT-EXHAUSTIVE` (7) + `E-MATCH-SUBSET-DEAD-ARM` (4).
- **`.js`/`.scrml` mirror staleness (S162)**: the `.scrml` self-host mirrors are FEATURE-stale, not merely predicate-drifted — whole machinery is missing vs the `.js`. S115 `.js`/`.scrml` lockstep is MOOT for native-parser fixes until a deliberate re-sync. Native fixes land in the `.js`; do not block on the `.scrml`.
- null/undefined: BOTH do not exist in scrml (`W-ABSENCE-IN-SCRML-SOURCE`); `""` / `0` / `false` ARE defined values; `async`/`await`/`switch`/`try`/`throw` are forbidden vocabulary
- type-system.ts is **17580 lines** (largest single source file); type-checking, linear types, validity-surface synthesis, enum-subset resolution, match-as-expr exhaustiveness, markup-attr `.advance` two-plane check, E-COLON-SHORTHAND-ON-VOID guard (S159), S160 ruling (c) implicit-lifecycle synthesis + `runRefinementNoRhsDefaultCheck`
- symbol-table.ts is **11341 lines**; engine state-child walkers, PASS 20 match exhaustiveness (incl. subset dead-arm), message-arm exhaustiveness (S155), W-COLON-SHORTHAND-LEGACY-PLACEMENT emission (S160 ruling (b)) at two sites
- ast-builder.js is **14180 lines**; S160 ruling (c): Shape 4 generalized no-RHS synthesis + `TYPE_BOUNDARY_KEYWORDS` stop-set
- Native parser files (largest): `parse-stmt.js` (3990L), `parse-expr.js` (3956L), `parse-markup.js` (2916L), `tag-frame.js` (2402L), `parse-file.js` (1600L+ — `collectMachineDeclsFromNodes` engine-substrate share, S163), `translate-stmt.js` (1686L), `translate-expr.js` (B1 reset-expr, S163), `collect-hoisted.js` (no longer synthesizes engines, S163). **B2 locus:** `synthEngineDecl` (`accepts=` read) + `native-walker/engine-statechild-walker.ts:516` (`messageArms`). See structure.map.md "Native-Parser File Table (S162)" for the full per-file role map.
- **Bug 69 / NON-GAP tension:** hand-off.md records a conflict: user said "fold Bug 69 in" (tableFor §41.16.6 subset reach) but the S156 CLOSE block called it NON-GAP. Confirm with user before scheduling (d)-A batch 5. See `non-compliance.report.md` Uncertain section.

## Tags
#scrmlts #map #primary #compiler #bun #v0.7.0 #each-in-dynamic-context #codegen #enum-subset #message-dispatch #per-item-reactivity #live-keyed #r28-1c #r28-8 #bug60 #bug62 #bug63 #bug64 #bug65 #bug70 #bug71 #bug72 #bug73 #colon-shorthand-html #colon-shorthand-canonical #shape4-no-rhs #native-parser #native-parser-swap #each-promotion #match-promotion #flip-failure-families #f1-engine-substrate-closed #b2-message-arm-next #machinedecls-instance-share #flip-674 #s148 #s149 #s150 #s151 #s152 #s153 #s154 #s155 #s156 #s157 #s158 #s159 #s160 #s161 #s162 #s163 #s164

## Links
- [structure.map.md](./structure.map.md)
- [dependencies.map.md](./dependencies.map.md)
- [schema.map.md](./schema.map.md)
- [config.map.md](./config.map.md)
- [build.map.md](./build.map.md)
- [error.map.md](./error.map.md)
- [test.map.md](./test.map.md)
- [domain.map.md](./domain.map.md)
- [non-compliance.report.md](./non-compliance.report.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
