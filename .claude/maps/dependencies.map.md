# dependencies.map.md
# project: scrml
# updated: 2026-07-31T03:18:23Z  commit: fe14c9b2
# NOTE (S302 pass): TARGETED — external deps RE-VERIFIED unchanged (no manifest diff in this window).
# Added: the `ifRaw`/`ifCond` five-consumer chain, the indirect-callee-resolver edges, and the
# `serverFnPeerAliasNames` thread. Everything else carries its prior walk.

## MANIFEST SHAPE — one manifest, allowlisted

There is exactly ONE package manifest in the repo (root `package.json`, v0.7.1); `compiler/package.json`
and `"workspaces": ["compiler"]` were deleted at `171f5f23`. `acorn` and `astring` live in the root
`dependencies`; `"private": true` is gone; a `files` ALLOWLIST governs what publishes. Any doc still
describing a `compiler/` workspace at v0.2.0 is stale.

## Runtime Dependencies — root package.json (v0.7.1, the SOLE manifest)
@modelcontextprotocol/sdk@1.29.0 — MCP server SDK for the scrml MCP integration
acorn@^8.16.0 — JS parser for escape-hatch (`_{}`) expressions + the E-CG-001 acorn-exact egress scan + the chunk-namespace cell-accessor-rename pass **(HOISTED this window from the deleted compiler manifest)**
astring@^1.9.0 — JS AST-to-source printer, paired with acorn for re-serializing escape-hatch nodes **(HOISTED this window)**
pg@^8.22.0 — bundled Postgres client; drives §38.13 realtime LISTEN bridge + `scrml introspect`
vscode-languageserver@^9.0.1 — LSP server protocol implementation
vscode-languageserver-textdocument@^1.0.11 — LSP text document utilities

## Dev / Build Dependencies — root package.json
@happy-dom/global-registrator@^20.8.9 — DOM environment for browser-suite Bun tests
happy-dom@^20.8.9 — fast in-process DOM used by compiler/tests/browser
@playwright/test@^1.49.0 — Playwright e2e framework (e2e/)
marked@^14.1.3 — Markdown parser used by docs/build.ts
puppeteer@^24.40.0 — headless browser support for e2e/docs tooling

## Published surface (`files` allowlist — new this window)
`compiler/bin/`, `compiler/src/`, `compiler/native-parser/`, `compiler/runtime/`, `stdlib/`,
`README.md`, `LICENSE`. It is an ALLOWLIST, not a denylist — **anything new is excluded by
default**. `stdlib/` is REQUIRED at runtime (`module-resolver.js`'s `STDLIB_ROOT` resolves
`../../stdlib`), not optional. Deliberately excluded: `compiler/tests` (20M), `self-host*`,
`samples/`, `examples/` (12M), `SPEC.md`/`PIPELINE.md` (docs live on scrml.dev).

## Editor-tooling Dev Dependencies — editors/vscode/package.json
vscode-textmate, vscode-oniguruma — bundled TextMate-grammar test harness (tokenize.js / regression-scan.js); not part of the compiler pre-commit gate, needs its own `npm i`.

## CI-only External Actions (not npm deps — GitHub Actions)
actions/checkout@v4, oven-sh/setup-bun@v2, anthropics/claude-code-action@v1 — see build.map.md / infra.map.md. **`ANTHROPIC_API_KEY` IS now set** (the daily `cloud-maps` run passes it), which retires the older "unset today" note; `MAPS_PAT` (a fine-grained PAT) is the checkout/PR identity for `cloud-maps.yml`.

## Runtime Engine
bun>=1.3.13 — required; no Node support (Bun-specific APIs used throughout: Bun.serve, bun:sqlite, Bun.$, Bun.SQL, Bun.hash). The DB-authoritative tier depends on `Bun.SQL`'s transaction API (`sql.begin`) and `bun:sqlite`'s `Database` for the `scrml db-migrate` apply loop — both already-bundled.

**Zero NEW external dependency this window.** Every landing (`sql-table-refs.js`, the D-4 dist-space
re-basing, the D-5 module-const emission, the §13.2 `on mount` async scope, the navigate-wave1c
cross-chunk loader, the per-item reconcile family, the `outline-*` Tailwind registrations) is
entirely first-party. The only manifest movement is the hoist + de-workspacing above.

## Internal Module Graph — compiler pipeline (compiler/src/api.js is the spine)

| Stage | Module(s) | Feeds |
|---|---|---|
| CLI dispatch | cli.js | commands/{compile,dev,build,serve,migrate,db-migrate,promote,generate,init,introspect,semdiff}.js — **11 verbs** |
| Split | block-splitter.js | ast-builder.js, native-parser/parse-file.js |
| Parse (live) | ast-builder.js, expression-parser.ts | type-system.ts, symbol-table.ts, codegen. **`expression-parser.ts` now also exports `forEachIdentInExprNode`**, consumed by `emit-server.ts`'s D-5 module-const resolvability check. |
| Parse (native, canary) | native-parser/*.js (paired w/ *.scrml) | native-walker/*, native-parser-canary/within-node-classifier.ts, lsp/handlers.js. **Parity obligation PAID this window** for `ifRaw`/`ifCond` — see the §17.1.2 chain below. |
| Tag-canonicalize (Stage 3.055 TC) | tag-canonicalizer.ts | landmark-tag.ts + api.js |
| Component expand | component-expander.ts | validators/post-ce-invariant.ts, attribute-interpolation.ts, attribute-allowlist.ts. **Every downstream consumer that keys on `node.id` depends on this stage's per-expansion clone (S299)** — `codegen/emit-each.ts` (fence ids / `_scrml_each_renderers`), `codegen/chunk-namespace.ts` (id-derived tokens). `_deepCloneAst` is INTERNAL (not exported); its two callers are `expandComponentNode` (:2601) and `_cloneChannelDecl` (:4552). |
| Protect / route infer | protect-analyzer.ts, route-inference.ts | codegen/protect-egress.ts, codegen/egress-field-scan.ts (E-CG-001). **protect-analyzer.ts is the SOLE `E-PA-*` fire site (7 codes); `E-PA-002`'s message leads with the `<schema>` + `scrml db-migrate` remedy (S292).** |
| **§12.2 Trigger 3 — server-only import escalates (NEW, S299)** | **route-inference.ts** — `ESCALATION_SERVER_ONLY_MODULES` (:656) / `isEscalationServerOnlyModule` (:674) / `buildPerFileEscalationServerOnlyBindings` (:3331) / `collectServerOnlyBindingModules` (:3397) -> `importTriggers` -> `directTriggers` (:4184) | `RouteInfo.escalationReasons` -> `codegen/emit-server.ts`. **DO NOT confuse `ESCALATION_SERVER_ONLY_MODULES` with the pre-existing `SERVER_ONLY_SCRML_MODULES` (:579) two hundred lines above it** — that one feeds the `api.js` STDLIB-EXPORT-SEED async backstop, where over-inclusion is safe; escalation inverts that. See domain.map.md. |
| Type check | type-system.ts, meta-checker.ts | dependency-graph.ts, auth-graph.ts. **`visitStructuralIfAttr` (:12688) must run BEFORE the `each:` scope push** — see the §17.1.2 chain below. |
| **Indirect callee resolution (#284, S303)** | **indirect-callee-resolver.ts** (NEW) | route-inference.ts `indirectInverseCallerMap` (:4707) → Step 5c only; `aliasNamesResolvingTo` → `serverFnPeerAliasNames` → emit-server/emit-logic/emit-control-flow/emit-expr. **`inverseCallerMap` must stay byte-identical.** See below. |
| Schema declaration checks | gauntlet-phase1-checks.js | `E-SCHEMA-010` (via `findNonLiteralSetItems`) + **NEW `E-SCHEMA-011`** (via `parseColumns`'s `malformedReferences` + `referencesHint`) — both helpers live in schema-differ.js |
| Reachability / batch | reachability-solver.ts, batch-planner.ts, cps-batch-planner.ts | codegen |
| Name/symbol resolve | name-resolver.ts, symbol-table.ts | codegen. symbol-table.ts PASS 15.5 owns the `<outlet>` placement pass. |
| Codegen dispatch | code-generator.js (= codegen/index.ts) | codegen/emit-*.ts. Also the `E-DBAUTH-SQLITE` compile-time gate (`annotateDbScopes`) and the §40.8.2 shell composition. **NOT the runtime-chunk gates — those are emit-client.ts.** |
| **Runtime-chunk tree-shake gates** | **codegen/emit-client.ts** (`detectRuntimeChunks` :273 pre-emit AST walk; `POST_EMIT_HELPER_CHUNK_GATES` :2167 post-emit reference scan) + **codegen/runtime-chunks.ts** (`CHUNK_DEPENDENCIES` :384, closed over at the END of `detectRuntimeChunks`) + compute-pgo-flags.ts (the `reset`/`equality`/for-stmt PGO inputs `detectRuntimeChunks` reads) | `ctx.usedRuntimeChunks` -> the assembled runtime slice. **This is the locus for any `ReferenceError: _scrml_* is not defined` in a shipped bundle.** See "Runtime-chunk gating" below. |
| **Coordinate space — SOURCE vs DIST (D-4, S296)** | **codegen/emit-server.ts** (`distRelativeServerSpecifier`, `isOutsideBase`, `distServerPathOf`) emits; **api.js** (`distServerKeyToSource` + `distDirOfSource` forward index, `serverImportTargetSource`) reverses; **codegen/emit-client-esm.ts** already computed client URLs in dist space | `checkServerImportInvariant` (`W-SERVER-IMPORT-UNEMITTED`) and `emitValueOnlyServerJsForDanglingImports` — BOTH reversal sites. See "Coordinate space" below. |
| **§13.2 async scope for `on mount` (GH #237)** | **codegen/scheduling.ts** (`scanEmittedCode`, `precedesBlockBrace`, `continuesEmittedStatement`, `splitEmittedStatements`, `liftEmittedStatementAwaits`, `emittedCodeCallsServerFn` — all NEW this window) | **codegen/emit-reactive-wiring.ts:536-537** — the sole consumer. A `_onMountEffect` body that calls a server fn is wrapped in `(async () => { … })().catch(_scrml_error_boundary_log)` with the same `injectPromiseAwait` policy the two already-correct paths use. |
| **D-5 server module-const closure** | **codegen/emit-server.ts** `emitReferencedModuleConstLines(fileAST, assembledBody)` | the assembled `.server.js` bundle, emitted AFTER the value exports and BEFORE `finalEmitted` is joined. ADDITIVE — the client bundle is byte-unchanged. |
| **#263 CLIENT module-`export const` closure (S301) — the §14.8-gated sibling** | **codegen/emit-client.ts** `emitReferencedModuleExportConstLines` + `collectClientReferencedIdents` + `stripExportDeclInit` + `collectTopLevelReassignedNames` + `_fnNodeIsServerBoundary` | the `.client.js` bundle. **The reference set is built from AST `IdentExpr` nodes ONLY — never string-literal contents, comments or member-property keys — with TWO PRUNED subtrees (a server-boundary function body; a server-scoped cell's init).** The blocked first attempt matched by TEXT and would have shipped an `export const` used only inside a `server fn` (which lowers to a fetch stub that never names it) to the browser. A name appearing in a fetch stub / literal / comment can therefore never widen the set **by construction**, not by filtering. Fail-closed elsewhere too: `stripExportDeclInit` SKIPS multi-declarator and destructuring forms rather than guessing. |
| **§17.1.2 structural `if=` (S302)** | **ast-builder.js** (capture) → **native-walker/attrvalue-exprnode-walker.ts** (exprNode) → **type-system.ts** (scope) → **dependency-graph.ts** (reader credit) → **codegen/emit-html.ts** (emit) | one attribute, five consumers, two native mirrors — the full table is below. |
| **§14.8.11 queried-table grants (S292)** | **sql-table-refs.js** (NEW — `tableRefsInSql`/`sqlBodiesInSource`/`tableRefsInSource`) -> **commands/db-migrate.js** (`parseProjectSchema` returns `{queriedTables, queriedPrivileges, undeterminedSql}`; `runPgApply`'s signature widened to carry the first two) -> **schema-differ.js** `diffSchema(options.queriedTables, options.queriedPrivileges)` | the `GRANT <privs> ON <table> TO scrml_app` branch for NON-db-authoritative tables the app's `?{}` bodies touch. See migrations.map.md. |
| DB-authoritative tier — §14.8.11/.1/.2 | schema-differ.js + codegen/db-authoritative.ts + codegen/sql-ident.ts + codegen/tenant-egress.ts + commands/db-migrate.js | codegen/index.ts wires `appDeclaresDbAuthoritative`/`wrapPrincipalTxn` into emit-server.ts's `generateServerJs`; emit-channel.ts imports `quoteIdent` (aliased `pgQuoteIdent`). See error.map.md / domain.map.md / schema.map.md / migrations.map.md. |
| Confidentiality — tenant-row floor (§14.8.10) | codegen/tenant-egress.ts (`buildTenantContext` — two-arg since S288, unioning `<schema>`-declared tables; `resolveTenantScoping`, `classifyTenantWrite`, `detectTenantRawEgress`, `rewriteSelectAddTenantId`, `rewriteInsertAddTenantId`, `_scrml_active_tenant`/`_scrml_active_caps`) | codegen/emit-server.ts: E-TENANT-WRITE/AGG/RAW-EGRESS + I-TENANT-STRIP/ACROSS |
| Client Router — landmark + shell composition (§20.8.1.1/§40.8.2) | codegen/emit-html.ts (`treeHasAuthorMain`) + codegen/index.ts (`findOutletMarkedOpenTag`/`findBareMainOpenTag`, `retagOpenTag`, `findMatchingCloseIdx`, **`computeDependencyClientScripts` — 4-arg since GH #235**) | TWO STAGES, one invariant, communicating ONLY through the emitted `data-scrml-outlet` marker. |
| **Client Router — cross-chunk soft nav (navigate-wave1c, §20.8.2/§20.8.7)** | **runtime-template.js** (`_scrml_nav_client_chunks`, `_scrml_nav_missing_chunks`, `_scrml_nav_load_chunks`, `_scrml_nav_chunk_failed`, `_SCRML_NAV_CHUNK_TIMEOUT_MS`, the `_scrml_chunk_loading` DEPTH COUNTER) + **codegen/emit-event-wiring.ts** (the IIFE + `_scrml_boot` boot dispatch) + **codegen/emit-variant-guard.ts** (the same eager-vs-DCL dispatch for engine/match arm wiring) | `W-NAV-CHUNK-LOAD-FAILED` (now IMPLEMENTED and cataloged — see error.map.md). |
| SSR auth-scoped omission + SQL-interp classifier (§52.15.5) | codegen/sql-lex.ts | imported by codegen/collect.ts AND codegen/rewrite.ts so they CANNOT diverge |
| Colorless-async classification | codegen/emit-library-shared.ts, codegen/scheduling.ts, codegen/emit-expr.ts | emit-library.ts, emit-server.ts, emit-tool.ts, emit-logic.ts, emit-control-flow.ts, emit-functions.ts |
| Batch-hoist / server-call fencing (§19.9.9.2) | codegen/emit-server.ts + codegen/scheduling.ts | full control-transfer set + filler-distance across control-flow guards |
| Reactive value= form-control write | codegen/emit-bindings.ts (file scope, i174) **+ codegen/emit-html.ts -> binding-registry.ts `directiveIsFormValue` -> codegen/emit-variant-guard.ts (arm bodies, i225, NEW this window)** | a reactive `value=` on `<input>`/`<textarea>`/`<select>` writes the `.value` PROPERTY, inequality-guarded so re-assigning the same string cannot reset the caret. Falls through to `setAttribute` when a sibling `bind:value`/`bind:valueAsNumber` owns it. |
| **Per-item reconcile family (S293/S294)** | **codegen/emit-lift.js** (`computeItemDerivedReplay`, `_collectDeclNodesInScope`) + **codegen/emit-each.ts** (`pickReferencedEnclosingCtxs`, `referencesFreeIdent`, `enclosingResolvePreludeLines`, `enclosingResolvePreludeForHandler`) | per-item text/class/attribute/if/event bindings re-resolve the live item BY KEY and replay item-derived locals on REPLACE. Shadow-safe: a nearer ctx's binding suppresses re-resolving a same-named enclosing var (a `let` redeclaration would be `E-CODEGEN-INVALID-LOGIC`). |
| Tailwind utility registry + lint | **tailwind-classes.js** (`registerColors`/`registerBorders`/`registerEffects`/`registerRing`/**`registerOutline` NEW D-3**/`registerGradient`/`registerTransform`/`registerTransition`…, `findUnsupportedTailwindShapes`, `findUnrecognizedClasses`, `validateArbitraryCss`) | `W-TAILWIND-001`, `W-TAILWIND-UNRECOGNIZED-CLASS`, `E-TAILWIND-001` — see error.map.md |
| Tool serve-harness | tool-program.ts, codegen/emit-tool.ts, codegen/emit-server.ts | §64.9 `serve=` listener-owning headless target |
| CSS emission / conflict check | codegen/emit-css.ts, codegen/emit-theme-reset.ts / codegen/css-conflict-check.ts | §65 Wave-1; E-STYLE-CONFLICT / W-STYLE-CONFLICT-POSSIBLE |
| Reactive-attr writer-ownership (#81) | codegen/emit-html.ts (`analyzeWriterConflict`) | `E-ATTR-WRITER-CONFLICT`, or a `LogicBinding` with `isReactiveValueAttr`/`valueAttrName`/`valueAttrKey` |
| Session establishment | compute-program-config.ts, route-inference.ts, codegen/emit-server.ts, codegen/emit-expr.ts | §20.5 `session.*` server builtin — see auth.map.md |
| Content-hash asset naming | api.js pre-pass (`fnv1aHash`, gated on `contentHashAssets`) | build.js's `generateServerEntry` |
| Validate emit | codegen/validate-emit.ts | final artifact sanity |
| Meta-eval | meta-eval.ts | `^{}` meta-block execution |

## `ifRaw` / `ifCond` — ONE attribute, FIVE consumers, TWO native mirrors (§17.1.2, S302)

The most useful thing to know about a structural `if=` is not where it is emitted — it is that
**every stage routes through the SAME function the markup `if=` path uses, deliberately, so a
structural predicate and a markup predicate are structurally incapable of diverging.** A private
re-implementation at any one of these is the defect this arc removed. Adding a second structural
attribute later means walking this exact list.

| # | Stage | Symbol | The rule |
|---|---|---|---|
| 1 | **Capture** | `ast-builder.js` `captureStructuralIfAttr` (:2705) + `structuralHeaderAnchor` (:2797) | Re-parses a SYNTHETIC `<x if=…>` opener through the SAME `tokenizeAttributes` + `parseAttributes` a markup opener uses. The value object is byte-for-byte what `<div if=…>` produces — that is what lets four hosts share one lowering. Offsets rebased −3 so diagnostics anchor in real source. |
| 2 | **ExprNode** | `native-walker/attrvalue-exprnode-walker.ts:208` | Populates `ifCond.exprNode` (and strips native's extra `sourceText`). |
| 3 | **Scope check** | `type-system.ts` `visitStructuralIfAttr` (:12688) → `visitAttr` | **Called BEFORE `scopeChain.push("each:…")`.** The opener predicate is evaluated OUTSIDE the per-item scope, so `if=item.ok` must NOT resolve against the row binding — reordering these two lines silently makes a wrong predicate compile clean. |
| 4 | **Reader credit (DG)** | `dependency-graph.ts` `creditFromAttrValue` (:2559), called for `ifCond` at :2930 | **`ifRaw` is deliberately NOT in the raw-scan lists** (:2964 / :3020 / :3088 carry that note). A private `/@ident/` scan over the raw text diverges in BOTH directions: it reads inside string literals (over-credit) and misses an `if=fn()` call-ref's `fnTransitiveReads` (under-credit). Without this consumer, a cell read ONLY by a structural gate false-fires `E-DG-002`. |
| 5 | **Emit** | `codegen/emit-html.ts` `emitGatedStructural` (:1498) → `emitIfMountGate` (:1421); kind test `isGateableIfValue` (:1472) | The sole `if=` lowering; the `E-IF-IN-DISPATCHED-ARM` guard fires here too (:1508). No `ifCond` field ⇒ byte-identical to the pre-§17.1.2 emitter. |
| — | **Native mirrors** | `native-parser/collect-hoisted.js` `readStructuralIfAttr` (:420); `native-parser/parse-file.js` (:762 match, :1081 each, `stripSourceTextFromValue` :1681) | A landing that adds an AST FIELD to a structural node owes these. An emit-time / runtime / CLI / message-only landing does not. |

**Field-shape invariant:** `ifRaw` and `ifCond` are **ABSENT, not null**, when the opener has no
`if=`. The within-node parser-parity canary compares FIELD SETS; null-stamping every
engine/match/each in the corpus surfaces as a divergence on the ~2 nested-engine positions where live
emits `text`/`comment` and native emits an `engine-decl`, growing the allowlist for a field neither
side actually disagrees about. Precedent on the same node family: `engine-decl.bodyChildren`.

**`ifCond` lives on the AST NODE, not in `engineMeta`.** That placement is load-bearing: it puts the
predicate out of reach of the JS-substrate emitters that build the engine's cell and rules, which is
what enforces §17.1.2.1's render-vs-lifecycle split structurally rather than by convention.

## Indirect callee resolution (#284, S303) — a SECOND call graph, on purpose

| Producer | Consumer | The rule |
|---|---|---|
| `indirect-callee-resolver.ts` — `resolveIndirectCallees` / `indirectResolvedCallees` / `aliasNamesResolvingTo` / `fnParamNameSet` / `dispatchTableNamesWithPeers` / `dispatchTablePeerMembers` | `route-inference.ts` (import :77) → `indirectInverseCallerMap` (:4707) → the Step 5c caller-context fixed point (:4774-4810) | **`inverseCallerMap` (:4466) stays BYTE-IDENTICAL** — it also drives `E-ROUTE-001` and the D4 `W-DEAD-FUNCTION` gate, and the S299 measurement of widening the shared walk was **72 corpus sites** of over-escalation. Indirect edges therefore get their own map, consulted by exactly one caller. |
| `indirectInverseCallerMap` | Step 5c placement | **ESCALATION-ONLY (FIX A, :4758).** SERVER indirect caller ⇒ promotion pressure. CLIENT indirect caller ⇒ **IGNORED** — counting it demotes a directly-server-called helper to client, and the server caller then references an undefined symbol → 500. |
| `markupReferencedNames` | the same fixed point (:4766) | **FIX B — a helper referenced from CLIENT MARKUP is EXCLUDED from indirect escalation.** Relocating it turns a synchronous render into a blanking async fetch. Its DIRECT-server-call escalation, if any, is baseline and left intact. |
| `aliasNamesResolvingTo` → `EmitLogicOpts.serverFnPeerAliasNames` | `emit-server.ts` → `emit-logic.ts` → `emit-control-flow.ts` (`_makeExprCtx`) → `emit-expr.ts` `EmitExprContext.serverFnPeerAliasNames` (:473), consumed :1488 + :3013 | The await-lowering half: `alias(...)` is awaited like the peer it aliases. NULL/empty ⇒ byte-identical pre-fix emission — every threading site is written that way, so a file with no alias peers is unaffected. |

| `dispatchTableNamesWithPeers` / `dispatchTablePeerMembers` (`IndirectResolution.tableBindings`) | `codegen/emit-server.ts:3043` / `:3045` | **A DIRECT dispatch call `t[k](...)` / `t.k(...)` has a MEMBER/INDEX callee, not a bare ident, so it is absent from `calledNames` entirely** — the alias path cannot see it. Two exports because they answer two different questions: `…NamesWithPeers` gates AWAIT-lowering (conservative: the table has ≥1 peer member; over-awaiting a sync value is a no-op, under-awaiting leaks a Promise), `…PeerMembers` gates EMISSION (a `{k: peer}` entry references the peer as a VALUE, so the callable must exist even if `t[k]()` is never called — otherwise a bare `ReferenceError`). Reassigned tables are dropped before either runs. |

Resolution is **SAME-FILE first**, falling back to the global name set only when no same-file binding
exists (mirrors the 5c-bis precedent). A DEAD value reference is not a call and creates **no** edge.

## Runtime-chunk gating — the tree-shake locus (READ BEFORE FIXING A BUNDLE ReferenceError)

Three files, one decision, and **none of them is `codegen/index.ts`**:

1. **`codegen/emit-client.ts` `detectRuntimeChunks(fileAST, ctx)` (:273)** — the PRE-EMIT AST walk.
   Registers a chunk when a walkable AST shape proves it is needed. Reads `compute-pgo-flags.ts`
   results for the `reset` / `equality` / for-stmt gates and `ctx.hasPrefetchableLinks`. Several
   emitters (`emit-control-flow.ts:625`, `emit-html.ts:3314/3890`, `route-splitter.ts`,
   `reactive-deps.ts`, `emit-synth-surface.ts`, `context.ts`) carry "both sites must agree" comments
   pointing back here — those are MIRRORS of the gate, not the gate.
2. **`codegen/emit-client.ts` `POST_EMIT_HELPER_CHUNK_GATES` (:2167)** — the POST-EMIT reference
   scan, for helpers no pre-emit AST walk can see (wiring minted from the binding registry at emit
   time). Entries match as **SUBSTRINGS** of an emitted line: a trailing `(` pins a CALL site, a
   bare name also catches a VALUE / `typeof` reference. Current table:
   `["_scrml_structural_eq(", "equality"]`, `["_scrml_reset(", "reset"]`,
   **`["_scrml_message_for", "messages"]` (NEW, GH #234)**. The scan runs BEFORE
   `cell-accessor-rename.ts`'s `_scrml_cs_` rename, which is why the bare-name entry is exact
   (`_scrml_cs_message_for` does not contain `_scrml_message_for` as a substring).
3. **`codegen/runtime-chunks.ts` `CHUNK_DEPENDENCIES` (:384)** — declarative cross-chunk edges,
   transitively closed at the END of `detectRuntimeChunks` before the chunk set is frozen.

**GH #234, the shape to recognize:** `<errors of=…/>` wiring (emit-event-wiring.ts) captures
`_scrml_message_for` as a VALUE behind `typeof` rather than calling it, so the call-form gate could
not match; the `messages` chunk that DEFINES it was gated only on a state-decl validator carrying an
inline override. The `typeof` guard did NOT save it: `_scrml_message_for` is a
`CELL_SCOPE_ACCESSOR`, so the post-hoc namespace rename rewrote BOTH occurrences — including the one
inside `typeof` — to `_scrml_cs_message_for`, whose wrapper the chunk prologue ALWAYS defines. The
guard therefore always took the true branch and the `ReferenceError` fired inside the wrapper body
at the top of `_scrml_boot`, aborting boot before any handler bound. Adopter symptom: a login form
issuing zero network requests while every server route was green.

## Coordinate space — SOURCE vs DIST (D-4, S296). The class, not just the bug.

**The dist tree is NOT a mirror of the source tree.** SPEC §47.9.5 strips a leading `pages/`
segment from `dirname(relative(outputBaseDir, source))`, so `pages/login.scrml` lands at
`dist/login.server.js`, NOT `dist/pages/login.server.js`. The strip applies to the DIRNAME only;
the basename is untouched.

- **Emission.** `emit-server.ts` previously swapped only the extension on `stmt.source`, which
  overshoots by exactly one segment for every importer under `pages/`: a source-space
  `../models/auth.scrml` became `../models/auth.server.js`, which from `dist/login.server.js` points
  ABOVE `dist/`. The compile stayed GREEN (a missing file is not a syntax error) and the bundle died
  at runtime with `Cannot find module`. Now `distRelativeServerSpecifier` expresses BOTH endpoints in
  post-strip dist space and takes the relative path between them, prefixing `./` when needed (a bare
  `models/auth.server.js` would be a node_modules lookup). Falls back to verbatim when
  `outputBaseDir` is absent or either endpoint is outside the base. On a project with no `pages/`
  segment the two spaces coincide and the emit is byte-identical.
- **Reversal.** `api.js` must reverse an emitted specifier back to a SOURCE path to look the target
  up in `cgResult.outputs` (source-keyed). The inverse transform is **AMBIGUOUS** — a dist
  `models/auth.server.js` could come from `models/auth.scrml` OR `pages/models/auth.scrml` — so
  reversal is a FORWARD INDEX, not an inverse: `distServerKeyToSource` maps every compiled source to
  the dist-relative `.server.js` it writes, through the same `pathFor` transform.
  `serverImportTargetSource` is two-tier (dist first, source as the legacy no-`outputBaseDir`
  fallback), mirroring emit-server's two emission modes one-for-one.
- **Why the guard was silent.** `W-SERVER-IMPORT-UNEMITTED` exists precisely to catch a runtime
  `Cannot find module`, and it stayed quiet on the D-4 reproducer because it validated in the ONE
  space where the path is always self-consistent. **The oracle inherited the implementation's
  coordinate assumption** (the S276 shape). `rewriteRelativeImportPaths`'s `.server.js`/`.client.js`
  skip is still correct, but its OLD justification ("they live at the same relative position as
  their source") was FALSE — the skip is correct only because the emitter now speaks dist space.

## §14.8.11 DB-authoritative tier — the `scrml db-migrate` command graph

`commands/db-migrate.js`'s `runDbMigrate(args)`: `parseArgs` (`--db`, `--dry-run`,
`--allow-destructive`) -> `parseProjectSchema` (live parse pipeline `splitBlocks`->`buildAST`, then
`extractDesiredSchema` per file, merging first-decl-wins; **NOW ALSO** unions
`tableRefsInSource(source)` across every file into `{queriedTables, queriedPrivileges,
undeterminedSql}`) -> the `E-DBAUTH-SQLITE` / `E-DBAUTH-NO-TENANT-COLUMN` pre-flights + an explicit
operator warning per `undeterminedSql` entry -> either `runPgApply({connectionString, desired,
dryRun, allowDestructive, queriedTables, queriedPrivileges})` or `runSqliteApply`. `printPlan(plan,
actualTableCount, warnings)` distinguishes an EMPTY plan from a WITHHELD one.

`schema-differ.js`'s `parseSchemaBlock` is the SHARED parser both `db-migrate` (via
`extractDesiredSchema`) and the pre-existing SQLite migrate path consume — brace-depth-aware,
returns `{tables, fns}` (`fns` is ADDITIVE, so all five pre-existing `.tables` consumers —
protect-analyzer.ts, channel-watches.ts, gauntlet-phase1-checks.js, codegen/index.ts,
db-authoritative.ts — are unaffected).

## Internal Module Graph — supporting layers

| Module | Role |
|---|---|
| **sql-table-refs.js (NEW S292)** | A bounded identifier SCANNER over `?{}` SQL bodies — **explicitly not a SQL parser**. `tableRefsInSql(sql)` / `sqlBodiesInSource(source)` / `tableRefsInSource(source)` return `{tables, privileges, undetermined}`. `TABLE_INTRODUCERS` pairs each clause with the privilege it implies (`PRIV_RANK` resolves `DELETE FROM`'s double match); `UNRESOLVABLE` enumerates the five deliberately-unhandled shapes (CTE, subquery in FROM/JOIN, LATERAL, dynamic EXECUTE). **A caller MUST NOT read an empty `tables` as "touches nothing"** — that is how the bug re-reproduces on a different table, and it fails closed at runtime as an opaque `permission denied`. Consumed ONLY by commands/db-migrate.js. |
| codegen/scheduling.ts | Colorless-async + batch-hoist scheduling, **plus (NEW this window) the emitted-JS scanner family**: `scanEmittedCode` tracks code / `'` / `"` / template-literal (incl. re-entrant `${}`) / `//` / block-comment modes, raises one depth counter on `(`/`[`/`{`, and reports depth-0 statement ends + depth-0 BLOCK brace groups (an object literal's closer is NOT a statement end). Consumed by emit-reactive-wiring.ts only. |
| codegen/db-authoritative.ts | `appDeclaresDbAuthoritative` (conditional-engagement gate), `wrapPrincipalTxn` (A1/S2 scope-aware txn wrapper, brace-scope-stack tracked so module-level infra helpers are never wrapped), `extractDesiredSchema` (+ `W-DBAUTH-MARKER-NEARMISS`). Unchanged this window. |
| codegen/sql-ident.ts | `quoteIdent(name)` — doubles an embedded `"`. The ONLY safe way to interpolate a DB identifier anywhere in the pipeline. Imported by schema-differ.js and codegen/emit-channel.ts (aliased `pgQuoteIdent`). Unchanged this window. |
| schema-differ.js | The differ + DB-authoritative DDL emitter. Exports: `parseSchemaBlock`, `readActualSchema`, **`columnConstraintDrift` (NEW)**, `diffSchema`, `generateCreateTable`, `DBAUTH_ROLE`/`DBAUTH_POLICY`/`DBAUTH_TENANT_GUC`/`DBAUTH_CAPS_GUC`, `generateBoundedRoleDDL`, `generateDbAuthoritativeDDL`, `generateScrmlHasCapDDL`, `generateSecdefDDL`, **`referencesHint` (NEW)**, `findNonLiteralSetItems`, `mapPgTypeToScrml`, `emitScrmlSchemaSource`. |
| codegen/chunk-namespace.ts | per-compilation-unit namespace for the runtime-global token space. Owns `nsId`/`nsName`/`nsCellKey`/`stripNsName`, `chunkNamespaceToken`, `resolveProjectRoot`, `buildCellOwnerMap`, and `assertChunkTokensDistinct` (a hard error, deliberately NOT `E-CG-010`). |
| codegen/cell-accessor-rename.ts | `renameCellAccessors` — the Acorn-parse + range-SPLICE pass rewriting every cell-accessor CALL to its `_scrml_cs_` chunk-local wrapper. The SOLE producer of `_scrml_cs_*`. **Runs at bundle assembly in index.ts, AFTER emit-client.ts's post-emit chunk scan** — that ordering is what makes the bare-name gate entry exact. |
| codegen/fnv1a-hash.ts | the shared FNV-1a 32-bit -> 8-char base36 primitive (§47.1.3). |
| codegen/runtime-chunks.ts | the runtime chunk catalog + `CHUNK_DEPENDENCIES`. |
| compute-pgo-flags.ts | the profile-guided flags `detectRuntimeChunks` reads for the `reset` / `equality` / for-stmt gates. Its header comments are the best in-tree narrative of what a missed gate costs. |
| codegen/sql-lex.ts | the pure LIVE-vs-INERT `${}` classifier (§52.15.5). One function feeds BOTH collect.ts and rewrite.ts. |
| codegen/tenant-egress.ts | the §14.8.10 tenant-row isolation floor; also owns `_scrml_active_tenant`/`_scrml_active_caps`. |
| codegen/index.ts | the codegen dispatcher; chunk-namespace WIRING; §40.8.2 shell composition (`computeDependencyClientScripts` is 4-arg since GH #235); the `E-DBAUTH-SQLITE` compile-time gate. |
| codegen/emit-html.ts | markup emission; `analyzeWriterConflict` (#81); `treeHasAuthorMain` (§20.8.1.1); **`directiveIsFormValue` computation for arm-body `value=` (i225)**. |
| codegen/binding-registry.ts | pure data registry, no imports. `LogicBinding` carries `isReactiveValueAttr`/`valueAttrName`/`valueAttrIsFormValue`/`valueAttrKey` and **`directiveIsFormValue` (NEW, i225)**. |
| codegen/emit-variant-guard.ts | `<match>`/`<engine>` arm wiring; consumes `directiveIsFormValue`; carries the navigate-wave1c eager-vs-DCL dispatch for arm wiring. |
| codegen/emit-event-wiring.ts | event-handler wiring; owns the `_scrml_boot` IIFE + boot dispatch. |
| codegen/route-splitter.ts | per-route chunk manifest serialization (`serializeChunksManifest`); several comments mirror the `detectRuntimeChunks` activation gates. |
| codegen/db-driver.ts | `resolveDbDriver(url)` -> `{driver, connectionString}`. |
| tailwind-classes.js | the Tailwind v3 utility registry + the three `*-TAILWIND-*` diagnostics. |
| module-resolver.js | resolves `scrml:*` stdlib imports (`STDLIB_ROOT` via `fileURLToPath` — hence `stdlib/` in the publish allowlist) + relative imports. |
| semdiff.ts | emit-identity Tier-0 compare; `canonicalizeChunkNamespaceToken` neutralizes per-path tokens. |
| expression-parser.ts | `parseExprToNode`, `exprNodeCollectCallees`, **`forEachIdentInExprNode` (consumed by D-5)**. |

## `escalationReasons` — the placement value that crosses the RI -> codegen seam (NEW section, S299)

The complete producer/consumer set at this HEAD. It is SHORT, which is the point: an
`EscalationReason` variant is a cross-module contract, not a local enum, and adding one touches every
row below.

| Role | Site | What it does |
|---|---|---|
| TYPE | `route-inference.ts:262` (`RouteInfo.escalationReasons: EscalationReason[]`) + the header contract at `:14` (*"empty if client"*) | the union. Kinds in use: `explicit-annotation`, `server-only-resource`, `protected-field`, `session-access`, `channel-*`, `middleware-handle`. |
| PRODUCER | `route-inference.ts:5512` (`escalationReasons: deduped`) | the main per-function assembly, deduped. |
| PRODUCER | `route-inference.ts:5230` | the middleware-handle arm (`_handleEsc?.deduped ?? [{kind:"middleware-handle"}]`). |
| CONSUMER | **`codegen/emit-server.ts:727`** (`isBodyOnlyEscalation`; the `escalationReasons` read is :728) | §12.6 library mode. **Gates on EVERY reason being `server-only-resource`** — the `.every()` that makes a NEW reason kind a breaking change: a fresh kind fails it and silently re-attaches an HTTP wrapper §12.6 says to drop. `:1777` carries the comment recording that expectation. |
| CONSUMER | `describeServerTrigger` (message rendering) | renders `server-only-resource` as "the server-only resource `<resourceType>`"; sorts `explicit-annotation` last, which is what makes `W-DEPRECATED-SERVER-MODIFIER` report a redundant `server` keyword correctly. |

**This is why S299's Trigger 3 reuses `server-only-resource` with `resourceType` = the module
specifier instead of adding a variant.** If you are about to add an `EscalationReason` kind, the
`.every()` at `emit-server.ts:727` is the thing to check first.

## Colorless-async (Seam-A / Phase-2 combinators, GITI-037/GITI-038) — unchanged this window
A plain (non-`?{}`) function calling a Promise-returning host primitive — directly, transitively, or
as a returned closure — is compiler-classified `async` and auto-awaited; there is no `async`/`await`
in scrml source (§13.1/§13.2). Seam-A Phase-1 unified the classifiers onto `computeAsyncFnNames`
with `E-ASYNC-STDLIB-IN-SYNC-CALLBACK` as the no-silent-leak backstop; the Phase-2 combinator
transform lives in `codegen/async-combinators.ts`; GITI-038 split Q1 (own-signature async) from Q2
(needs AST re-emission, `computeNestedAsyncFnHolders`); i87 gave `injectPromiseAwait` its
position-invariance. **GH #237 extends the same §13.2 obligation to a THIRD destination —
a desugared `on mount { … }` body, which is emitted at MODULE scope inside a SYNC IIFE where
`await` is illegal.** Before the fix, every server call in a mount block landed as a bare pending
Promise, so an `if (u is not) { redirect("/login") }` guard could never take its deny branch —
fail-OPEN. The sibling reactive-cell destination (`@you = loadMe(1)`) was already correct
(emit-client.ts lifts it into its own async IIFE).

## Defense-in-depth: stdlib async classification (api.js STDLIB-EXPORT-SEED)
A server-only `scrml:*` re-export whose `{kind, isAsync}` cannot be resolved FAILS CLOSED (defaults
to async). Mechanism unchanged. **What CHANGED at S299 is what may be reused from it: nothing.**
This backstop is driven by `route-inference.ts`'s `SERVER_ONLY_SCRML_MODULES` (:579), a set tuned for
a decision where OVER-inclusion is free. §12.2 Trigger 3 placement is driven by the separate
`ESCALATION_SERVER_ONLY_MODULES` (:656). Two sets, two safe-error directions, one file — see the
Trigger-3 row in the pipeline table and domain.map.md's section.

## stdlib module pairing (compiler/runtime/stdlib/*.js <-> stdlib/*/index.scrml)
21 modules: auth, compiler, cron, crypto, data, format, fs, host, http, math, mcp, oauth (+5
provider sub-modules), path, process, random, redis, regex, router, store, test, time. Each ships
BOTH a canonical `.scrml` source and a JS host shim. Unchanged this window — but `stdlib/` is now
part of the PUBLISHED package surface.

**Client-safety classification of those 21 (S299, §12.2 Trigger 3 — derived from BOTH the
`stdlib/<mod>/**.scrml` sources AND the shipped `compiler/runtime/stdlib/<mod>.js` shims):**

| Escalation-server-only (10) | Why |
|---|---|
| `scrml:auth` | `Bun.password` (argon2id) |
| `scrml:crypto` | `Bun.CryptoHasher`, `Bun.password` |
| `scrml:cron` | `Bun.cron` |
| `scrml:fs` | `node:fs` |
| `scrml:process` | `process.{argv,cwd,env,exit,platform,memoryUsage}` |
| `scrml:redis` | `import { redis, RedisClient } from "bun"` — **BARE `bun`, no colon** |
| `scrml:store` | `bun:sqlite` |
| `scrml:path` | `node:path` |
| `scrml:mcp` | `node:fs` / `node:path` / `node:url` (the host surface is in the `.js` shim, not the `.scrml`) |
| `scrml:oauth` | **no host reach at all** — transmits `client_secret`; module header says SERVER-SIDE ONLY |

**Verified NOT members** against both limbs — do not "fix" these back in without re-running the
derivation: `scrml:data` (pure transforms + compile-time type-as-argument primitives; 72 of the
corpus's 116 server-only-module import sites and it ships a real client implementation) and
`scrml:http` (fetch wrappers; `fetch` is browser-native and the module takes no credential of its
own). **A hand-maintained derived list rots silently** — that is the `docs/FACTS.md` lesson, and it
is why the two membership limbs are recorded next to the list in the source.

## Tags
#scrml #map #dependencies #trigger-3 #escalation-server-only #two-set-distinction #escalation-reasons #is-body-only-escalation #stdlib-client-safety #node-id-freshness #module-graph #stdlib #chunk-namespace #cell-accessor-rename #detect-runtime-chunks #post-emit-chunk-gates #runtime-chunks #chunk-dependencies #fnv1a #semdiff #pipeline #bun #acorn #sql-lex #tenant-egress #tenant-floor #theme-reset #content-hash #colorless-async #async-combinators #on-mount #gh237 #scheduling #writer-ownership #bind-value #i225 #directive-is-form-value #batch-hoist #session-establishment #outlet #one-landmark #shell-composition #esm-chunks #module-format #each-fence #dist-space #source-space #d4 #d5 #forward-index #server-import-unemitted #dbauth #db-migrate #sql-table-refs #queried-table-grants #quoteIdent #sql-ident #navigate-wave1c #chunk-loading-depth-counter #tailwind-outline #e-schema-011 #npm-publishable #no-workspaces #structural-if #§17.1.2 #if-cond #if-raw #five-consumers #absent-not-null #parity-canary #credit-from-attr-value #e-dg-002-false-fire #visit-structural-if-attr #scope-push-order #indirect-callee-resolver #indirect-inverse-caller-map #inverse-caller-map-byte-identical #escalation-only #fix-a #fix-b #server-fn-peer-alias-names #export-const-client-gate #ident-expr-precise #pruned-subtrees

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [structure.map.md](./structure.map.md)
- [schema.map.md](./schema.map.md)
- [error.map.md](./error.map.md)
- [domain.map.md](./domain.map.md)
- [auth.map.md](./auth.map.md)
- [migrations.map.md](./migrations.map.md)
- [build.map.md](./build.map.md)
