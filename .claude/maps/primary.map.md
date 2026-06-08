# primary.map.md
# project: scrmlts
# updated: 2026-06-08T17:30:00Z  commit: f0b3cb04

## Project Fingerprint
Language:   TypeScript / JavaScript (mixed; Bun runtime)
Framework:  Custom compiler pipeline (no web framework)
Runtime:    Bun >=1.3.13
Type:       CLI compiler + language toolchain (single-file full-stack web language compiler)
Size:       ~1400 source files (923 test .test.js by find + ~148 compiler/src [114 .ts incl. native-walker/exprtext-backfill-walker.ts + codegen/log-loc.ts + 34 .js] + 37 native-parser .js + stdlib + lsp)
Version:    v0.7.0 (project-tracked; compiler/package.json reads 0.2.0 — subpackage drift, ignore)

## Map Index

| Map                  | Status  | Contents                                                      |
|----------------------|---------|---------------------------------------------------------------|
| structure.map.md     | present | directory layout, entry points, S148-S174 source changes (engine-graph, source-map, _scrml_modules, dev watcher, Shape 4, S153-S160 colon-shorthand/each-in-dynamic-context arc, S162-S170 native-parser-swap arc, S167-S170 deep-set write-loss/cycles-prereq/value-native-maps/Bug-B/set-algebra; **S173 E-EXPORT-001 module-resolver + W-TYPE-FN-FIELD type-system; S174 NEW `codegen/log-loc.ts` (224L, location-transparent `log()` resolver) + emit-expr/emit-server/emit-client/emit-logic/index/runtime-chunks log wiring + type-system `checkLogShadowing`/`checkAnyTypeForbidden` + `--production`/`--prod` compile flag + dev.js `POST /_scrml/log` forwarding endpoint**); Native-Parser File Table now S170 with current line counts + the next-pick set; bare-variant inference helpers table with exact line numbers for R28-8 dispatch |
| dependencies.map.md  | present | 9 packages (3 runtime root + 2 compiler + 4 devDeps), internal graph (HEADER STALE — content not touched by S154-S174, last refreshed 4e1f9492) |
| schema.map.md        | present | ~47 AST node types + `acceptsType` on EngineDeclNode (S154) + `subsetVariants` on PredicatedType (S156) + MessageArmEntry + EnumSubsetParse (S155-S156) + `EachEngineCtx` + `EachReconcileCtx` (S156-S159) + `matchExpr` side-field on ReactiveDeclNode (S157 Bug 71) + `MapLitExpr`/`MapEntry` ExprNode + `MapType` ResolvedType (§59, S169) + native `makeFunctionDecl` modifiers `{canFail,errorType}` (S166); **S172 `inlineMatchArmArrows` engine-decl stamp; S173/S174 add NO new AST shapes — E-EXPORT-001/W-TYPE-FN-FIELD (S173) + W-LOG-SHADOWED/E-TYPE-ANY-FORBIDDEN (S174) are decl-site/use-site scans over EXISTING nodes; the only S174 type is the codegen-internal `LogLocSpan` interface (log-loc.ts:32, resolver input not a FileAST shape); NO `AnyType` member in ResolvedType (`any` is not a scrml type)** |
| config.map.md        | present | 4 env vars, 3 config files (HEADER STALE — last refreshed 948d3f2f) |
| build.map.md         | present | 12 npm scripts, maintenance scripts, pre-commit hook; **S174: new "`scrml compile` Flags" table including `--production`/`--prod` (§20.6.5 log() strip)** |
| error.map.md         | present | 386+ error codes; S154-S160 codes (+E-COLON-SHORTHAND-ON-VOID, +W-COLON-SHORTHAND-LEGACY-PLACEMENT, +E-REFINEMENT-NO-DEFAULT, +4 engine-message codes, +E-MATCH-SUBSET-DEAD-ARM); S169 +7 §59 value-native-map codes (IMPLEMENTED, fire sites live); S170 NO new codes (Bug B mistarget + native parity resolutions); **S173: +2 (E-EXPORT-001 Error §21.2 reactive state-cell export reject [module-resolver.js:301]; W-TYPE-FN-FIELD Info §14.3 fn-typed struct field [type-system.ts:3310]); S174: +2 (W-LOG-SHADOWED Info §20.6.7 user-`log` shadow nudge [type-system.ts:3431]; E-TYPE-ANY-FORBIDDEN Error §14.1.1 literal `any`-token reject [type-system.ts:3531]) + S174 Key New Codes block** |
| test.map.md          | present | bun:test, 913+ .test.js files; +5 S162; +4 S164 native; +1 S166; +2 S167; +8 S168; +13 S169; +~10 S170; +2 S173 (E-EXPORT-001 export-reject + W-TYPE-FN-FIELD); S174 log()-builtin / any-reject coverage; full suite 23405/0 at S170 fix-wave-2 (HEADER may lag — verify) |
| domain.map.md        | present | 12-stage pipeline + sidecar, 30+ domain concepts incl. S153-S160 colon-shorthand/each-in-dynamic-context, S162-S170 native-parser-swap orientation block (re-measured 605→~508), S168 cycles-prereq, S169 §59 value-native-map IMPLEMENTED, S170 Bug B + set-algebra; **S173 E-EXPORT-001/W-TYPE-FN-FIELD concept rows; S174 `log()` location-transparent builtin concept (compile-certain side + dev unified-view + production-strip) + `W-LOG-SHADOWED` shadowing concept + `E-TYPE-ANY-FORBIDDEN` no-any-hard-line concept + invariants**; codegen each/match/engine emit map (+log-loc.ts + log() lowering sites) |
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
| build commands / pre-commit hook / **compile flags (`--production`)** | build.map.md |
| directory layout / entry points / pipeline stages / per-session source changes / native-parser file table | structure.map.md |
| external packages (acorn, astring, MCP SDK, vscode-languageserver) | dependencies.map.md |
| domain concepts (pipeline stages, engine-graph, source-map, each/match emit, enum-subset, message-dispatch, per-item-reactivity, live-keyed, render-by-tag, match-exhaustiveness, colon-shorthand HTML content-model, **`log()` location-transparent builtin, no-`any` hard line**) | domain.map.md |
| `log()` builtin / location-transparent logging / `W-LOG-SHADOWED` / `--production` strip | domain.map.md "log() builtin" concept + structure.map.md "Key S174 Source Changes" + error.map.md W-LOG-SHADOWED |
| `any`-reject / `E-TYPE-ANY-FORBIDDEN` / no-`any` hard line / `asIs` escape hatch | error.map.md E-TYPE-ANY-FORBIDDEN + structure.map.md "Key S174 Source Changes" + domain.map.md `any`-reject invariant |
| reactive state-cell export reject / `E-EXPORT-001` | error.map.md E-EXPORT-001 + structure.map.md "Key S173 Source Changes" |
| native-parser-swap state / flip-failure families / which native file owns which family | domain.map.md "Native-Parser Swap Orientation" + structure.map.md "Native-Parser File Table (S170)" |
| `<each>` / `<match>` / engine codegen emit modules | domain.map.md "Codegen each/match/engine Emit Map" + structure.map.md S154-S174 |

## Task-Shape Routing (agents — read this section first)

This is a COMPILER repo. Task shapes are bug-fix / codegen / parser / new-feature / spec-amendment /
test-authoring / audit. Each shape lists maps in priority order — read in order until oriented.

**compiler-source bug fix (the dominant shape — most dispatches):**
1. `error.map.md` — find the offending code, its family, AND the "Fix Notes" for any prior fix on the same class (the S153-S160 colon-shorthand / each-in-dynamic-context / Bug 60-73 notes are pattern templates — read them before re-diagnosing)
2. `domain.map.md` — locate the responsible pipeline stage + its primary source file (Pipeline Source Files table) and any relevant invariant
3. `structure.map.md` — the "Key S154-S174 Source Changes" sections give exact file + function + line for recently-touched code; the codegen directory ownership line names the emit-* module
4. `test.map.md` — find the existing canary for the feature; a behavior fix WITHOUT a happy-dom test is the S140/S152 blind-spot trap — always add one

**codegen (`<each>` / `<match>` / engine / emit-* work — highest-churn area):**
1. `domain.map.md` — the **"Codegen `<each>` / `<match>` / engine Emit Map"** table (names every emit module + role + the S153-S159 runtime helpers and Bug 62/64/65/72/73 patterns; S174 adds `log-loc.ts` + the `log()` lowering sites in emit-expr/emit-server/emit-client)
2. `structure.map.md` — S154-S174 source-changes sections: exact functions + line numbers in emit-each.ts / emit-lift.js / emit-control-flow.ts / emit-engine.ts / emit-html.ts / **log-loc.ts / emit-expr.ts (log lowering ~L1630)** / runtime-template.js / dependency-graph.ts / ast-builder.js / block-splitter.js / type-system.ts
3. `error.map.md` — E-CODEGEN-INVALID-JS fix notes + chunk-survival / dep-first-read / engine-ctx-threading / per-item-live-keyed invariants
4. `test.map.md` — happy-dom canary list; emit-string-only tests mask runtime miscompiles

**diagnostic-authoring (a new lint / error code, the S173-S174 shape):**
1. `error.map.md` — the code-family conventions + the partition rule (W-/I- prefix OR severity:warning/info → result.warnings; everything else → result.errors/exit 1) + the S173 (E-EXPORT-001/W-TYPE-FN-FIELD) and S174 (W-LOG-SHADOWED/E-TYPE-ANY-FORBIDDEN) "Key New Codes" blocks as templates — both are decl-site/use-site scans wired in the type pass (type-system.ts ~15003-15010) or MOD stage (module-resolver.js); they add NO new AST shape and NO codegen
2. `structure.map.md` — "Key S173/S174 Source Changes": the exact `check*` function + line + wiring site
3. `schema.map.md` — confirm whether the diagnostic needs a new node shape (S173/S174 did NOT — they scan existing nodes / raw strings)
4. `test.map.md` — cross-stream W-/I- helper requirement (a `result.errors.filter(...)` on a W-/I- code silently passes)

**`log()` / location-transparent logging work (S174 — §20.6):**
1. `domain.map.md` — the `log()` builtin concept row (compile-certain `side` from `ctx.mode`/§12.4 placement; `loc` from byte offset via log-loc.ts; dev unified-view via dev.js `POST /_scrml/log`; production-strip via `--production`; the `'log'` runtime chunk gated on actual `_scrml_log(` usage) + the `W-LOG-SHADOWED` shadowing concept
2. `structure.map.md` — "Key S174 Source Changes" → log() block: `log-loc.ts` (224L NEW: `resolveLogLoc`/`registerFileSource`/`resetLogLoc`/`fileDeclaresLog`/`SERVER_LOG_HELPER`) + emit-expr.ts lowering (~L1630, three branches: shadowed→plain call / `_logProductionStrip`→`(void 0)` / builtin→`_scrml_log(side, loc, ...)`) + emit-server.ts/emit-client.ts/runtime-chunks.ts chunk gating + index.ts toggles (455/587/760) + dev.js endpoint (~L459) + compile.js/api.js `production` flag
3. `error.map.md` — W-LOG-SHADOWED fix note (fires at the DECLARATION in the type pass, NOT codegen; `log` is not reserved; reserved for `E-LOG-SHADOWED` promotion) + the log-loc resolution fix note (byte-offset, not `span.line`)
4. `build.map.md` — the `--production`/`--prod` compile flag (strips ALL `log()` to 0 bytes, §20.6.5 F4=A)

**`any`-reject / type-token policy work (S174 — §14.1.1):**
1. `error.map.md` — E-TYPE-ANY-FORBIDDEN family row + the S174 Key New Codes block: `any`-token-SPECIFIC, fires BEFORE the silent `asIs` collapse; an arbitrary undefined type name resolving to `asIs` is a SEPARATE deferred follow-on
2. `structure.map.md` — "Key S174 Source Changes" → `any`-reject block: `typeTextMentionsAnyToken` (type-system.ts:3489, splits on non-identifier chars + tests for bare `any` atom) + `checkAnyTypeForbidden` (type-system.ts:3531, scans struct/cell/fn-param/return-type positions) + wiring (type-system.ts:15010)
3. `domain.map.md` — the `any`-reject invariant (there is no `any`; `asIs` is the named greppable escape hatch, analogous to TS `unknown`)
4. `schema.map.md` — NO `AnyType` member in `ResolvedType` (the `any` token currently falls through to `AsIsType`/`UnknownType`; the check catches it first)

**parser / grammar fix — NATIVE-PARSER swap-grind (the active strategic line — drives `--parser=scrml-native` to default):**
1. `domain.map.md` — **"Native-Parser Swap Orientation"** block: the family flip-failure table re-measured 605 on `df08f282` → ~508 after the two S170 waves (default BS+Acorn 0-fail / fully green; native is opt-in). CLOSED: each/match promotion (S162), F1 engine-substrate (S163), B1 reset-expr (S163), §51.0.S message-arm + exprNode (S164), lift close-tag/F2a/table-for (S164), F2-match/promote-each/R1/server-fn-star (S165), bare-`function` failable + cross-file `${...}`-export (S166), S170 fix-wave-1 (`on mount`/`on dismount`, `const @name` F5-CLOSED, deepset/array-mutation node-synth, exprtext-backfill walker) + fix-wave-2 (BlockStub `verbatim` Mario fix). OPEN next-pick: F4 formFor · F2 server-fn `?{}` body-drop · F6/F9 · `effect=` opener · mario PowerUp payload-enum · F7. Read FIRST + re-run the flip harness before picking.
2. `structure.map.md` — **"Native-Parser File Table (S170)"** + the S162-S170 source-changes sections: every native file + role + CURRENT line counts + locus per open family
3. `api.js` routing — `--parser=scrml-native` is STRICTLY OPT-IN (default `null`); native `_buildAST` branch calls `nativeParseFile` then `populateNativeAttrValueExprNodes` (945) + `backfillNativeExprText` (960). **The default flip has NOT happened — PA ships parity-closers, never the flip (standing user decision).**
4. `error.map.md` — native parity resolutions (E-SCOPE-001 destructured params, E-VARIANT-AMBIGUOUS→E-CONTRACT-001) + the §4.18.7 E-UNQUOTED-DISPLAY-TEXT SPEC-correct-not-spurious ruling
5. `test.map.md` — parser-conformance within-node allowlist (1005/0); the flip-harness is the family-level gate — re-run it to re-rank before picking a family

**parser / grammar fix — LIVE pipeline (block-splitter / ast-builder / engine-statechild-parser):**
1. `domain.map.md` — pipeline stage (BS/TAB) + engine-arm-parsing row; S159 `:`-shorthand HTML content-model; S160 ruling (b) inside-opener canonical; S167 deep-set write-loss boundary recognizer; S168 cycles-prereq COW bracket-write
2. `structure.map.md` — S153-S168 LIVE-pipeline source changes (engine-statechild-parser.ts, match-statechild-parser.ts, ast-builder.js, block-splitter.js, type-system.ts)
3. `error.map.md` — E-ENGINE-* / E-CTX-* / E-EXPR-* / E-STMT-* / E-SYNTAX-064 / E-COLON-SHORTHAND-ON-VOID / W-COLON-SHORTHAND-LEGACY-PLACEMENT / E-REFINEMENT-NO-DEFAULT families
4. `test.map.md` — parser-conformance within-node allowlist (live-pipeline vs native parity)

**bare-variant inference fix (R28-8 target — type-system.ts):**
1. `structure.map.md` — "Bare-variant inference helpers" table: `inferBareVariantsInExpr` @7925, `inferBareVariantsForStructConstructor` @8153, `inferBareVariantsWithStructNav` @8199 + let/const-decl call site @~5820
2. `error.map.md` — E-VARIANT-AMBIGUOUS / E-CONTRACT-001 / E-TYPE-063
3. `domain.map.md` — bare-variant inference domain concept (§14.10 + §14.10.7)
4. `schema.map.md` — `PredicatedType.subsetVariants` + ExprNode shapes the walker descends

**value-native map work (§59 — IMPLEMENTED S169; bug-fix / extension on the map type):**
1. `error.map.md` — the 7 §59 codes + fire sites (key-comparability type-system.ts ~2069/~2086, bracket-write ~7705, literal scanners, iteration-order lint)
2. `structure.map.md` — "Key S169 Source Changes (value-native maps §59)": exact file + function + line per phase (D0-D4)
3. `schema.map.md` — `MapType` (ResolvedType) + `MapLitExpr`/`MapEntry` (ExprNode) shapes
4. `domain.map.md` — value-native-map row + the cycles-prereq groundwork row
5. `test.map.md` — "S169 New Test Files"

**set-algebra / `scrml:data` work (S170 — type DEFERRED, helpers shipped):**
1. `domain.map.md` — "set-algebra helpers" concept row (`union`/`intersection`/`difference`/`member` + `_data_value_canonical` value-correctness keystone + `unique` struct-unsafety fix; NO `set` type)
2. `structure.map.md` — "Key S170 Source Changes" → set-algebra block (data.js + `.scrml` mirror)
3. `test.map.md` — `data-set-algebra.test.js` (16, value-correct over structs)

**new feature / spec-amendment:**
1. `domain.map.md` — invariants + concept lexicon (check language cohesion before proposing syntax)
2. `structure.map.md` — where the feature's stage lives
3. `schema.map.md` — AST node shapes (a new construct needs a node type; note S173/S174 diagnostics did NOT)
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
- Entry point: `compiler/src/cli.js` → subcommand router; public API in `compiler/src/api.js` → `compileScrml()`; `--emit-engine-graph` flag (S149) writes `<base>.engine-graph.json` sidecar; **`--production`/`--prod` flag (S174) strips `log()` to 0 bytes (§20.6.5)**
- Pipeline: 12 ordered stages BS → TAB → NR → MOD → CE → PA → RI → TS → META → VSS → DG → CG; stage contracts at `compiler/PIPELINE.md`; engine-graph sidecar runs after CG via lazy getter in compile result
- Spec: `compiler/SPEC.md` (**31,883 lines, 59 numbered sections** + appendices); normative per pa.md Rule 4; §4.14/§51.0.I/§18.0.1/§6.2 amended S159-S160 (colon-shorthand + Shape 4); §4.15/§24.4 amended S162; **§59 Value-Native Maps IMPLEMENTED S169; §59.12 set bullet reconciled S170 (type DEFERRED, helpers shipped); §21.2 E-EXPORT-001 + §14.3 W-TYPE-FN-FIELD S173; NEW §20.6 (`log()` Location-Transparent Logging, subsections .1-.8) + §34 `W-LOG-SHADOWED` row S174; NEW §14.1.1 no-`any` rule + §34 `E-TYPE-ANY-FORBIDDEN` row + §55.9/§36.4.2/§14.8 `any`→`asIs` currency S174 (the §14.8 fix rides the wrap commit, no code)**
- Error surface: CGError with `severity: 'error'|'warning'|'info'`; W-*/I-* → result.warnings (non-fatal); all else → result.errors (CLI exit 1); emitted-JS parse-gate (E-CODEGEN-INVALID-JS) is default-ON BUT suppressed when compilation already has a prior fatal error (Bug 70, api.js)
- `<each>` codegen is the highest-churn area: Bug 62 (S156) engine-ctx threading in emit-each.ts; Bug 65 (S157) SAME gap in emit-lift.js; Bug 64/R28-1c (S158) per-item content reactivity on reconcile (both tiers); Bug 72 (S158) nested `<each>` inside `${for…lift}`; Bug 73 (S159) per-item EVENT HANDLER live-keying (both tiers). Read domain.map.md "Codegen Emit Map" before touching any of these files.
- **S173 two new diagnostics — additive, zero-codegen (`642950a2`)**: **E-EXPORT-001** (Error, §21.2) rejects exporting a plain (Shape-1) OR derived reactive STATE CELL — previously swallowed SILENTLY (no export in emitted JS; cross-file import → garbage). SHARED MOD-stage check, keyed on `kind:"state-decl"` so `export const Greeting` / `export <channel>` / exported engines stay legal. `collectStateCellNames`+`exportedLocalNames`+`buildImportGraph` [module-resolver.js:97/136/295-313]. **W-TYPE-FN-FIELD** (Info, §14.3) nudges a function-typed struct field (currently resolved as opaque `asIs`; first-class support is an OPEN deferred question). `checkFunctionTypedStructFields` [type-system.ts:3310] wired at the type pass [type-system.ts:15003].
- **S174 location-transparent `log()` builtin — NEW §20.6 (`916b8bb3`)**: `log(...args)` lowers to `_scrml_log(side, loc, ...args)` where `side` ("server"/"client") is COMPILER-CERTAIN per call site (from `ctx.mode`, per-statement-accurate incl. inside CPS-split fns — the §12.4 placement) and `loc` ("basename:line") is resolved at COMPILE time from the call node's BYTE OFFSET (NOT `span.line`, which is unreliable post-re-parse) via NEW `codegen/log-loc.ts` `resolveLogLoc` (224L; + `registerFileSource`/`resetLogLoc`/`fileDeclaresLog`/`SERVER_LOG_HELPER`). Args render value-faithfully (`_scrml_log_render`, §20.6.4 — NOT `JSON.stringify`; value cycles forbidden by §59.5 so it terminates). **Dev unified view (§20.6.3 F2=B):** server `log()` → `scrml dev` terminal; client `log()` → `POST /_scrml/log` (dev.js ~L459) + browser console. **Production strip (§20.6.5 F4=A):** `--production`/`--prod` (compile.js:170) → `log(...)` lowers to `(void 0)` (0 bytes, no `_scrml_log` reference). The `'log'` runtime chunk (`SERVER_LOG_HELPER` prepended in emit-server.ts ~L1766; client chunk in runtime-chunks.ts:138; gated on actual `_scrml_log(` usage) is omitted from shadowed/stripped builds. Wiring: emit-expr.ts (~L1630 three branches) + index.ts (455/587/760 toggles via `setLogProductionStrip`/`setLogShadowedInFile(fileDeclaresLog(...))`) + api.js (`production` opt, 586/1931).
- **S174 `W-LOG-SHADOWED` (Info, §20.6.7)**: a user-declared in-scope `log` (the canonical no-op debugging stub `function log(...)`, or any local/import named `log`) WINS — the builtin steps aside (`log(...)` emitted as a plain call, no origin tag, no forwarding). `log` is NOT a reserved identifier (declaring `function log` is legal — this is a lint, not E-RESERVED-IDENTIFIER). Fired at the SHADOWING DECLARATION by `checkLogShadowing` [type-system.ts:3431] (the type pass has the wired diagnostic stream; codegen's `EmitExprContext.errors` is not reliably populated — emit-expr.ts only suppresses the builtin lowering via `_logShadowedInFile`). Reserved for promotion to `E-LOG-SHADOWED` end-of-window.
- **S174 `any`-reject hard line — `E-TYPE-ANY-FORBIDDEN` (Error, §14.1.1, `f0b3cb04`)**: the literal type-token `any` in ANY type-annotation position (struct/error field, state-cell `typeAnnotation`, fn/function param + return-type). `any` is not a scrml type — "there is no any" (S174 user hard line; TS's type-check opt-out has no scrml equivalent). The sanctioned untyped escape hatch is `asIs` (named, greppable, analogous to TS `unknown`). Today `any` falls through `resolveTypeExpr` to `asIs`/`unknown` SILENTLY; `typeTextMentionsAnyToken` [type-system.ts:3489] (splits the raw type string on non-identifier chars, tests for a bare `any` atom — catches `any`/`any[]`/`any | not`/`[string: any]`/`{ payload: any }`, NOT a NAME containing the substring like `Company`/`manyThings`) catches it BEFORE that collapse. `checkAnyTypeForbidden` [type-system.ts:3531] wired at the type pass [type-system.ts:15010]. `any`-token-SPECIFIC — an arbitrary undefined type name (`Frobnicate`) ALSO resolving to `asIs` is a SEPARATE broader leak (deferred follow-on). Corpus migration: ~23 `any`→`asIs` sites in examples/23-trucking-dispatch + samples + stdlib/http rode the wrap.
- **S170 Bug B — structural-compound deep-set retarget (`72aa6836`, LIVE/codegen, CLOSED — last open HIGH)**: `@a.ref = v` on a Variant-C structural compound emitted a write to the COMPOSITE key `a` that the derived recompute clobbered (lost mutation, NO diagnostic, failed even for ONE write). Fix: `reactive-deps.ts:stampCompoundDeepSetTargets` (~L739) stamps `_deepSetLeafKey`/`_deepSetResidualPath`; `emit-logic.ts` (~L3025) retargets to the leaf cell. SPEC §6.3.2. known-gaps HIGH 1→0.
- **S169 §59 Value-Native Maps — IMPLEMENTED end-to-end**: a `[KeyT:ValT]` map compiles on the default pipeline + has native literal parity. Reads bracket (`@m[k]` → `V | not`), writes method (`E-MAP-BRACKET-WRITE` on `@m[k]=v`), keys structural-`==`-identified. 7 §34/§59 codes have fire sites. The cycles-prereq (`8d9db4e1`, S168) is its enabling groundwork.
- **S168 cycles-prereq COW-all bracket-write (`8d9db4e1`, LIVE)**: a bracket-index WRITE `@arr[i] = x` routes through copy-on-write (`reactive-nested-assign` → `_scrml_deep_set` with a HETEROGENEOUS path); bracket READS stay verbatim. `_scrml_structural_eq` gained a WeakMap/WeakSet cycle guard. The build prerequisite for value-native maps.
- **S167 deep-set write-loss fix (HIGH Bug A, LIVE)**: consecutive dotted-path deep-set / array-mutation writes inside a `function` body were SILENTLY DROPPED at codegen unless they were the FIRST statement. Fixed in ast-builder.js `parseLogicBody`/`collectExpr` (~L2747) via a forward-scan statement-boundary recognizer. Codegen UNCHANGED.
- **S172 derived=match arm-arrow deprecation (`d7de8a60`, lint+migrate, LIVE/lint-only)**: the §51.0.J `derived=match` engine arms joined the §18.2 `:>` deprecation; raw-text body → ast-builder.js `scanInlineMatchArmArrows()` stamps `engine-decl.inlineMatchArmArrows[]`; type-system.ts fires W-MATCH-ARROW-LEGACY; migrate.js `--fix` rewrites.
- **S172 `scripts/state.ts` DD3 project-state tool**: `bun scripts/state.ts` prints state-at-HEAD; `--write` regenerates `@generated:*` sections; `--check` is the currency gate (maps-staleness is WARN-only, so this 6c refresh does not gate the wrap). Step 6d generator.

### Native-Parser Swap — current state (S161 ratified / S163 engine-substrate fix / S164-S170 parity-closer grind)
- **The active strategic line**: drive `--parser=scrml-native` to DEFAULT, then DELETE legacy block-splitter (BS) + Acorn at M6 (direction-a, ratified S161; realistic v0.8 target). **The Phase-A default-flip is a STANDING USER DECISION — PA ships parity-closers, never "the flip."**
- **CLOSED — each/match structural promotion (S162)**, **F1 engine-substrate silent-miscompile (S163, `a41df176`, machineDecls two-instance object-identity defect)**, **B1 reset-expr (S163)**, **§51.0.S message-arm + exprNode (S164)**, **F2-match / promote-each / R1 typed-`@cell` / server-fn-star (S165)**, **bare-`function` failable + cross-file `${...}`-export (S166)**.
- **Flip re-measure: 605 native-only flip-failures on `df08f282` (S170 baseline) → ~508 after the two S170 waves** (was 451 S165-close; the 605 is a FRESH full re-measure on the new baseline counting the current corpus / opt-in `--parser=scrml-native` against the default 0-fail / fully-green pipeline). Default output UNCHANGED across S162-S174 (every closer is shadow-only). Full suite at S170 fix-wave-2: 23405 pass / 0 fail. Remaining families (full table in domain.map.md "Native-Parser Swap Orientation"):
  - **LANDED S164:** §51.0.S message-arm (B2) `7cbad5dd` + native attr-value `exprNode`/`argExprNodes` `c1566faa` (family FULLY closed) · lift `<markup>` close-tag `649f4ef8` · F2a chained `?{}.method()` `7e54f321` · table-for struct-field-drop `66301357`.
  - **LANDED S165:** F2-match string-literal arms `2c2e5bb2` · promote-each 3 §17.4 for-stmt gaps `785f24d1` · R1 typed-`@cell` decl `89912bb9` · server-fn-star `function*`+yield `26a24b71`.
  - **LANDED S166:** bare-`function` failable `76059024` — native `parseFunctionDecl` (parse-stmt.js:1695) consumes the trailing `!` failable marker + error-type annotation (`! -> Err` arrow form §19.4.1 + bare `! Err` form §41.14 with R25-Bug-36 continuation disambiguation), ported verbatim from `parseScrmlFunctionDecl`, and threads `{canFail,errorType}` as `makeFunctionDecl`'s 7th arg (was 6 → metadata silently dropped). fnKind stays `"function"`. Closes the bare-`function` failable parse gap (`fn`/`server`/`pure` already worked; ~31 failable-via-`function` test files). New native error `E-STMT-FN-ERROR-TYPE` on a malformed `! ->`. · cross-file `${...}`-export raw-slice `9d12d980` — native `synthExportDecl` (collect-hoisted.js) anchors the raw slice to `block.bodyStart` (the LogicEscape inner-body host-start = `frame.openSpan.end`, one byte past `${`) instead of `block.span.start` (the opener `$`); over-shifting LEFT by the opener length made `hi` overshoot `blockText.length` → `raw=""` → cross-file CE registry empty → spurious E-COMPONENT-020/035. parse-markup.js stamps `block.bodyStart` at 4 body-attach sites (the `${...}`/`^{...}` branches in `emitContextBlock` + `synthLiftedLogicBlock`/`synthPairedLogicBlock` where `bodyStart === span.start`); `walkStmts`→`synthExportDecl`/`collectComponentDefs` thread `bodyStart` (fallback `blockSpan.start` preserves the working file-top path); within-node-classifier.ts adds `bodyStart` to STRIP_KEYS (native-internal raw-slice coordinate, no live analogue — resolved WITHOUT an allowlist rebump). Same off-by-opener class as M6.7-C1 `synthComponentDef`.
  - **LANDED S170 fix-wave-1 `5a346faa`:** GROUP P — `on mount`/`on dismount` lifecycle desugar (§6.7.1, parse-stmt.js; ~52 incl. cross-file cascade) + `const @name` → `parseConstAtStateDecl` derived-state-decl (F5 CLOSED; the brief's `parseBindingIdent` was empirically wrong — live treats `const @name` as a DERIVED state-decl). GROUP T — deepset/array-mutation node-synth (native emits live `reactive-nested-assign`/`reactive-array-mutation` → COW + trigger, routing through the S170 Bug-B-fixed emit-logic) + destructured-param structuring (false E-SCOPE-001 closed) + var-decl `typeAnnotation` thread (E-VARIANT-AMBIGUOUS → E-CONTRACT-001). GROUP W — NEW `src/native-walker/exprtext-backfill-walker.ts` `backfillNativeExprText` stamps `.expr`/`.init`/`.condition` from structured `exprNode`/`initExpr`/`condExpr` siblings (INERTNESS VERIFIED 295/297 byte-identical; 2 deltas a NET-POSITIVE latent `const token;` fix). FIX 3 (arrow-shorthand fn body) correctly NOT implemented (invalid scrml — live REJECTS); FIX 4 (`export <cell>`) deferred pending SPEC ruling. +24 native-parser tests; within-node allowlist surgically reconciled (34 over-budget → current; PARSE-FAILURE:0/NESTED-SHAPE:0).
  - **LANDED S170 fix-wave-2 `cc69c62d` (the Mario fix):** native `reconstructArmBody` returned literal `"{}"` for block-bodied match arms (dropping their statements — the dominant ~1463-file corpus form; Mario's MUSHROOM click fired but never transitioned Small→Big) + same gap dropped lambda callback block bodies. Fix: `parse-expr.js parseBlockStub` stamps `stub.verbatim` (balanced `{...}` slice; render-body scope-guard skips lift/markup arm bodies) + `translate-expr.js reconstructArmBody` returns `body.verbatim`, `translateArrow`/`translateFunctionExpr` emit a full-lambda `EscapeHatchExpr` (mirrors live expression-parser.ts:2152-2192). +17 closures, ZERO new failures, full suite 23405/0, +5 statement-survival canary tests. DEFERRED (pre-existing, NOT introduced): code-position match-BLOCK promotion for render arm bodies · engine-write-guard routing for match-as-statement over an engine cell · single-word bare-display-text silent-drop tokenizer bug (filed).
  - **NEXT DISPATCH (re-run flip harness to re-rank):** F4 formFor expansion (~32, was largest open) / F2 top-level server-fn `?{}` body-drop + assign-RHS `@x = ?{}.all()` / F6/F9 fn-param/export-fn-body / `effect=` opener (small) / mario PowerUp payload-enum / F7 missing-diagnostics (lower-leverage). **F5 `const @name` CLOSED S170.**
  - **S166 BANKED (STOP-IF-DIVERGENT, not landed):** native empty `fail X::V(arg)` envelope (function + fn forms) · native `renders ${id}` interpolation break · ROOT-1 exported-inner-decl reaching codegen (emit-fix worked but surfaced a 58-fixture within-node divergence; 2 prereqs — deep-shift promoted spans by `bodyStart` + the native FunctionDecl trailing-match-as-return + return-type-annotation drop, which reproduces on NON-exported fns too, a separate native gap).
  - **mario PowerUp payload-enum (NEW S163)** — native captures only `["Mushroom"]` (drops payload variants), mis-emits `PowerUp.Flower(3)` as `"Flower"(3)`; payload-bearing-enum native gap (mario residual 133 diff-lines).
  - **`effect=` opener (§51.0.H Form 3, small)** — native `synthEngineDecl` has no openerEffect read.
  - F2 SQL `?{}` in server-fn (~58) — `parse-sql-body.js` drops SQL body in top-level server fns.
  - F3 if-as-expr residual (small) — same-line match arms DONE S162 + string-literal arms DONE S165 (F2-match); if-as-expr residual LOW.
  - F4 formFor expansion (~32) — native parse→bridge→form pass drops field-markup expansion.
  - ~~F5 `const @name` derived-decl~~ — **CLOSED S170** (`parseConstAtStateDecl`, parse-stmt.js).
  - F6/F9 fn param / export-fn-body (~16) — `parse-stmt.js` / `parse-expr.js`.
  - F7 missing diagnostics (~15) — body-parser gates swallow `E-STRUCTURAL-ELEMENT-MISPLACED` etc.
  - F8 stdlib `await import()` (13) — RULED a stdlib-migration task (native stays strict no-`await` enforcer); NOT a native-parser change.
  - Other large signatures spread across the remaining ~508 (re-measure for current counts): `E-CODEGEN-INVALID-JS`, `E-TYPE-063` + `E-VARIANT-AMBIGUOUS` (native bare-variant resolution), `E-TYPE-001/-020`, `E-MATCH-NOT-EXHAUSTIVE` + `E-MATCH-SUBSET-DEAD-ARM`.
- **`.js`/`.scrml` mirror staleness (S162)**: the `.scrml` self-host mirrors are FEATURE-stale, not merely predicate-drifted — whole machinery is missing vs the `.js`. S115 `.js`/`.scrml` lockstep is MOOT for native-parser fixes until a deliberate re-sync. Native fixes land in the `.js`; do not block on the `.scrml`.
- null/undefined: BOTH do not exist in scrml (`W-ABSENCE-IN-SCRML-SOURCE`); `""` / `0` / `false` ARE defined values; `async`/`await`/`switch`/`try`/`throw` are forbidden vocabulary. **`any` does NOT exist either (S174 hard line, `E-TYPE-ANY-FORBIDDEN`) — `asIs` is the only named untyped escape hatch.**
- type-system.ts is **~18216 lines** (largest single source file); type-checking, linear types, validity-surface synthesis, enum-subset resolution, match-as-expr exhaustiveness, markup-attr `.advance` two-plane check, E-COLON-SHORTHAND-ON-VOID guard (S159), S160 ruling (c) implicit-lifecycle synthesis + `runRefinementNoRhsDefaultCheck`, §59 map key-comparability (S169), **`checkFunctionTypedStructFields` (S173, :3310), `checkLogShadowing` (S174, :3431), `checkAnyTypeForbidden`/`typeTextMentionsAnyToken` (S174, :3531/:3489) — all decl-site/use-site scans wired in the type pass at :15003/:15006/:15010**
- symbol-table.ts is **11341 lines**; engine state-child walkers, PASS 20 match exhaustiveness, message-arm exhaustiveness (S155), W-COLON-SHORTHAND-LEGACY-PLACEMENT emission (S160) at two sites
- ast-builder.js is **~14311 lines**; S160 ruling (c) Shape 4 generalized no-RHS synthesis; S167 deep-set write-loss boundary recognizer; S168 cycles-prereq `collectAtPathSegments`
- module-resolver.js — **S173 E-EXPORT-001** reactive state-cell export reject (`collectStateCellNames`+`exportedLocalNames`+`buildImportGraph`, :97/136/295-313)
- **codegen/log-loc.ts (NEW S174, 224L)** — location-transparent `log()` resolver: `resolveLogLoc(span)`→"basename:line" from byte offset, `registerFileSource`/`resetLogLoc` per-compile cache, `fileDeclaresLog(fileAST)` shadow detector, `SERVER_LOG_HELPER` runtime chunk (`_scrml_log`/`_scrml_log_render`). Consumed by emit-expr.ts (lowering), emit-server.ts (helper prepend), index.ts (toggles)
- Native parser files (largest, S170 line counts): `parse-stmt.js` (4482L), `parse-expr.js` (4368L), `parse-markup.js` (3109L), `tag-frame.js` (2402L), `translate-stmt.js` (2442L), `parse-file.js` (1671L), `translate-expr.js` (1251L), `collect-hoisted.js` (900L), `ast-stmt.js` (605L), `ast-expr.js` (493L). NEW S170 walker `src/native-walker/exprtext-backfill-walker.ts` (200L, run from api.js:960); native attr-value `exprNode`/`argExprNodes` stamped by `src/native-walker/attrvalue-exprnode-walker.ts` (api.js:945). See structure.map.md "Native-Parser File Table (S170)".
- **Bug 69 / NON-GAP tension:** hand-off.md records a conflict: user said "fold Bug 69 in" (tableFor §41.16.6 subset reach) but the S156 CLOSE block called it NON-GAP. Confirm with user before scheduling (d)-A batch 5. See `non-compliance.report.md` Uncertain section.

## Tags
#scrmlts #map #primary #compiler #bun #v0.7.0 #each-in-dynamic-context #codegen #enum-subset #message-dispatch #per-item-reactivity #live-keyed #r28-1c #r28-8 #bug60 #bug62 #bug63 #bug64 #bug65 #bug70 #bug71 #bug72 #bug73 #colon-shorthand-html #colon-shorthand-canonical #shape4-no-rhs #native-parser #native-parser-swap #each-promotion #match-promotion #flip-failure-families #f1-engine-substrate-closed #b2-message-arm-closed #machinedecls-instance-share #native-exprnode-walker #f2-match #promote-each #typed-atcell #server-fn-star #bare-function-failable #cross-file-export-bodystart #deepset-write-loss #reactive-nested-assign #reactive-array-mutation #cycles-prereq #cow-all-bracket-write #structural-eq-cycle-guard #value-native-maps #value-native-maps-implemented #spec-section-59 #e-map-bracket-write #map-type #map-lit #each-tuple-destructure #union-not-normalization #within-node-1005 #bug-a-deepset-write-loss #bug-b-structural-compound-deepset #stamp-compound-deepset-targets #set-algebra #scrml-data #value-canonical #unique-struct-unsafety-fix #on-mount-dismount #const-at-derived-decl #f5-closed #deepset-node-synth #exprtext-backfill-walker #blockstub-verbatim-body #mario-match-arm-fix #flip-605 #flip-508 #s148 #s149 #s150 #s151 #s152 #s153 #s154 #s155 #s156 #s157 #s158 #s159 #s160 #s161 #s162 #s163 #s164 #s165 #s166 #s167 #s168 #s169 #s170 #s172 #s173 #e-export-001 #w-type-fn-field #s174 #log-builtin #log-loc #location-transparent-logging #w-log-shadowed #e-type-any-forbidden #no-any-hard-line #production-strip #production-flag

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
