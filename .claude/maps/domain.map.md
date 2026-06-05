# domain.map.md
# project: scrmlts
# updated: 2026-06-04T20:50:00Z  commit: 452a212b

The domain is the scrml COMPILER pipeline. scrml is a single-file, full-stack reactive web
language compiled by this TypeScript/JS toolchain running on Bun. The compiler converts `.scrml`
source files into `*.server.js` + `*.client.js` + `*.html` + `*.css` outputs.

## Core Concepts

| Concept | Definition |
|---------|-----------|
| `.scrml` file | Single-file source combining markup, logic, styles, SQL, auth, types, and tests |
| Pipeline | 12 ordered stages: BS → TAB → NR → MOD → CE → PA → RI → TS → META → VSS → DG → CG |
| BS (Block Splitter) | Stage 1: tokenizes `.scrml` into typed blocks (markup/logic/sql/css/etc.) — `block-splitter.js` |
| TAB (Tokenizer+AST Builder) | Stage 2: builds FileAST from block stream — `tokenizer.ts` + `ast-builder.js`; the `each-block`/`match-block` structural transform lives HERE (in `buildAST`) for the live pipeline — AND, as of S162, is now MIRRORED in the native parser (`synthEachBlockNode`/`synthMatchBlockNode` in parse-file.js) so `--parser=scrml-native` promotes both too |
| NR (Name Resolver) | Stage 3: resolves reactive decls, engine vars, component refs — `name-resolver.ts` |
| MOD (Module Resolver) | Stage 3.1: builds import graph, detects circular imports, produces export registry — `module-resolver.js` |
| CE (Component Expander) | Stage 3.2: expands component references via same-file + cross-file registries — `component-expander.ts`; re-parses synthesized component bodies, falling back to legacy `splitBlocks`+`buildAST` when the body contains `<each>`/`<match>` (S153) |
| PA (Pre-Analysis) | Stage 4: structural validation, attribute allowlists — `attribute-registry.js` + validators/ |
| RI (Route Inference) | Stage 5: infers server routes from page structure — `route-inference.ts` |
| TS (Type System) | Stage 6: type checking, validity surface synthesis, engine type verification — `type-system.ts` (17436L) |
| META (Meta Check+Eval) | Stage 6.5: validates phase separation, evaluates `^{}` compile-time blocks — `meta-checker.ts` + `meta-eval.ts` |
| VSS (Validity Surface Synthesis) | Stage 6.7: synthesizes `@x.isValid` / `@x.errors` / `@x.touched` / `@x.submitted` accessor cells |
| DG (Dependency Graph) | Stage 7: builds reactive dependency DAG, detects cycles — `dependency-graph.ts` |
| CG (Code Generator) | Stage 8: emits server.js + client.js + html + css from IR — `code-generator.js` + codegen/ |
| FileAST | Compiler's internal AST representation for one .scrml file — `types/ast.ts` (1983L+) |
| CGError | Structured diagnostic: code + message + span + severity — `codegen/errors.ts` |
| V5-strict | Access model: `@x` is read, `@x = v` is write; compiler tracks every read/write site |
| reactive-decl | A V5-strict reactive variable (`@name`): server-side cell with compile-time dependency tracking |
| engine | State machine declared in scrml (`<engine>`/`EngineDeclNode`); Tier 2 abstraction over reactive cells |
| engine state-child | A state arm of an engine declared as a markup child; closer-pairing handled by the custom raw-text parser `engine-statechild-parser.ts` (NOT block-splitter) |
| `:`-shorthand child (§4.14) | `<tag : expr>` form (e.g. `<li : @.name>`); correctly excluded from engine-arm closer-depth via `isColonShorthandOpener` (S153) — a `:`-shorthand opener has no closer, so it must not be pushed onto `lowerDepth` (else it absorbs the state-child `</>` → E-ENGINE-STATE-CHILD-MISSING) |
| `:`-shorthand HTML content-model (§4.14 / S159) | For a NON-VOID lowercase HTML element, `<span : @label>` renders as `<span>${@label}</span>` — byte-identical to the bare-body form. ast-builder.js synthesizes the body child via re-parse of `<tag>BODY</tag>`. For a VOID HTML element (`<input>`, `<br>`, SVG geometry), `:`-shorthand is REJECTED with `E-COLON-SHORTHAND-ON-VOID`. Component `:`-shorthand and `@.`-sigil per-item `:`-shorthand are EXCLUDED from synthesis (separate owners). Resolves the prior empty-`<span></span>` emission gap + `E-DG-002` false-fire for cells consumed via `:`-shorthand. |
| engine opener `effect=` | §51.0.H Form 3 boot-only opener effect; fires once at engine init; emitted by `emitEngineOpenerEffect()` in emit-engine.ts (S148 C1) |
| `accepts=MsgType` (§51.0.S.2.2) | Engine-opener attribute naming the message-vocabulary `:enum`; parsed batch 1 (engine-statechild-parser.ts, S154); resolved batch 2 (symbol-table.ts SYM PASS 11, S155); codegen batch 3 (emit-engine.ts `emitEngineMessageArmTable`, S155) |
| message-arm (§51.0.S) | Per-state `| .Variant(bindings) :> body` arms inside an engine state-child; parsed to `MessageArmEntry[]` by batch 1; two-plane dispatch: state-transitions via `_scrml_engine_advance`, message-dispatch via `_scrml_engine_dispatch_message` (runtime-template.js S155) |
| engine-graph sidecar | Static "what-comes-next" JSON artifact per engine; written to `<base>.engine-graph.json` via `--emit-engine-graph`; produced by `buildEngineGraphJson()` in `engine-graph.ts` (S149) |
| EngineGraph | Exported type from engine-graph.ts: `{ engines: EngineGraphEngine[] }`; honest-empty `{ engines: [] }` when no engines |
| errorBoundary | Markup-context error catch (§19.6): typed `!`-error path + host-JS try/catch backstop; implemented in `emit-error-boundary.ts` |
| `lin` (linear type) | Value that must be consumed exactly once; enforced by compiler across all branches — `LinDeclNode` |
| `~` (tilde-decl) | Deferred-init mutable slot; must be initialized before read — `TildeDeclNode` |
| channel | Server-push WebSocket channel declared in markup; `<channel name="X">` — `ChannelDeclNode` |
| SSE (§37) | Server-Sent Events; client-stub wiring via `EventSource` — `emit-client.ts` GITI-026 |
| `_scrml_modules` registry | §21.3 cross-file CLIENT module-loading (known-gaps #6, S152); idempotent global object in runtime-template.js; exporter appends `_scrml_modules[key] = { ... }` footer; importer reads via `const { x } = _scrml_modules[key]`; key derived by `moduleRegistryKey()` from absolute path + outputBaseDir |
| source-map provenance | Real per-line `.js.map` produced by build-source-map.ts + srcmap-provenance.ts; emit fns inject `#scrmlmap#` sentinel marks; buildSourceMap() resolves them to use-site spans and strips marks before output (S149 B2; S150 line-lie close) |
| Shape 4 typed-array default | §6.2 Shape 4 (S152): `<name>: T[]` with no RHS defaults to `[]`; non-array typed decl with no RHS → E-DECL-NEEDS-INITIALIZER. (Open design Q parked S153: scalar/struct zero-default — should `<x>: int`→`0`, `<x>: string`→`""`?) |
| `<each>` cell-init order | (S152 HIGH): `<each>` body render fn runs synchronously at module-init BEFORE same-file cell `_scrml_reactive_set`; guard `if (!_items)` added; `_scrml_effect_static` re-runs after cell-init fires |
| `<each>` dep-first read | (S153): the render fn reads `_items` (the dependency) BEFORE the `if (!_mount) return;` early-return so `_scrml_effect_static`'s one-shot dep pass records the dep even when the mount is absent at module-init (the engine-gated case) |
| `_scrml_each_renderers` / `_scrml_remount_each` | (S153): runtime registry + remount helper in runtime-template.js. An `<each>` whose mount lives in a non-`initial=` engine arm is absent from the DOM at module-init; its render fn registers itself keyed `each_${id}`; when the arm later mounts, the variant-swap dispatcher (emit-variant-guard.ts) calls `_scrml_remount_each(armRoot)` which `querySelectorAll('[data-scrml-each-mount]')` and re-invokes each registered renderer directly (no new dep edge). Idempotent across engine re-entry |
| each-in-block-form-match | (S153): each-bearing `<match>` arms re-parse via `splitBlocks`+`buildAST` (native parser leaves a generic `markup tag="each"`); lifted each-blocks attach to `matchBlock.bodyChildren`; `restampEachBlockIds` namespaces ids; `__scrmlCachedArms` memoizes across passes — emit-match.ts |
| each-over-enclosing-scope | (S153): nested `<each>` (the `as` pattern) emits inline in the outer factory via shared `emitEachReconcileLines` (was lifted to module-scope reading undefined enclosing var → ReferenceError); each-in-component-body fixed via the 3 component-expander roots |
| `<each>` engine-ctx threading (Bug 62) | (S156): `buildEachEngineCtx(fileAST)` in emit-each.ts collects per-file engine metadata once (engines with message arms, message-variant sets) and threads `EachEngineCtx` through every per-item template attr/child lowering so `@engine.advance(.X)` / `@engine = .X` inside `<each>` templates lower correctly to the state or message plane. Bug 65 (S157) is the SAME fix applied at the Tier-0 `${for…lift}` path in emit-lift.js — CLOSED (see below). |
| `${for…lift}` engine-ctx threading (Bug 65) | (S157 — CLOSED): `buildLiftEngineCtx(fileAST)` + `buildLiftEngineCtxFromExtras(extras)` in emit-lift.js delegate to `buildEachEngineCtx` (emit-each.ts) so both tiers share one implementation. Engine extras are threaded via emit-logic opts into `emitForStmt` → `emitConsolidatedLift` / `emitCreateElementFromMarkup`. Also: `tryLowerLiftEngineHandler` delegates to `emitEngineHandlerBody` (emit-each) — no duplicated `.advance` logic. |
| per-item content reactivity (Bug 64 / R28-1c) | (S158 — CLOSED): `_scrml_reconcile_list` reuses DOM nodes for same-key items; per-item TEXT + class: bindings that close over the create-time iter var showed STALE content on array-replace/reorder. Fix: `EachReconcileCtx` stack in emit-each.ts + `_scrml_lift_reconcile_ctx_stack` in emit-lift.js + control-flow.ts push of ctx inside `createFn`. `maybeWrapEachPerItemEffect`/`maybeWrapLiftPerItemEffect` wrap per-item bindings in a live-keyed `_scrml_effect` that calls `_scrml_resolve_item(mount, keyVar)` to get the CURRENT item for the node's create-time key. `_scrml_resolve_item` in runtime-template.js tracks `(container, "_scrml_items")` so `_scrml_trigger(container, "_scrml_items")` (fired by `_scrml_reconcile_list` on each pass after first) re-fires these effects; field reads through `_scrml_deep_reactive` proxy subscribe to field-level mutations. |
| per-item EVENT HANDLER live-keying (Bug 73) | (S159 — CLOSED): Sibling-gap #2 of Bug 64. Per-item event handlers in BOTH tiers closed over the CREATE-TIME iter var. On same-key reconcile the display binding (Bug 64) showed live data but the handler still fired against the stale create-time snapshot. Fix is DISTINCT from Bug 64: handlers do NOT subscribe (`_scrml_effect`); the fix prepends a fire-time re-resolution prelude inside the existing `function(event) { ... }` body. Tier-1 (emit-each.ts): `iterScopeReferencedInHandler` token-scan gates the wrap (string/regex literals blanked); `maybeWrapEachPerItemHandler` prepends `let <iterVar> = _scrml_resolve_item(<mount>, <keyVar>); if (<iterVar> === null) return;`. Tier-0 (emit-lift.js): `maybeWrapLiftPerItemHandler` (function-body shape) + `maybeWrapLiftCallableHandler` (callable-direct shape — inlines the arrow inside a wrapper whose `let` lexically shadows the arrow's free reference). Global handlers and literal-only bodies stay byte-identical. |
| nested `<each>` in Tier-0 lift (Bug 72) | (S158 — CLOSED): a `<each>` child of lifted markup arrives at codegen as a generic `markup` node (ast-builder's `parseLiftTag` never promotes to `each-block`). Pre-fix: rendered as literal `<each>` DOM tag + inner `@.` leaked raw → E-CODEGEN-INVALID-JS. Fix: `tryEmitNestedLiftEach` in emit-lift.js routes through `emitNestedEachFromMarkup` (emit-each.ts). Also: `_parseLiftAttrValue` in ast-builder.js now handles `PUNCT "@"` token by collecting the balanced `@...` token run as an `{kind:"expr"}` value, keeping the lift on the structured markup path. |
| render-by-tag nested compound (Bug 60) | (S157 — CLOSED): `<signupForm><userName/></>` — self-tag `<userName/>` failed lookup because bare `lookupStateCell` can't see it; it lives under the compound parent namespace. Fix: `enclosingCompoundStack: string[]` in emit-html.ts tracks the active compound wrapper tag; fallback `lookupQualifiedStateCell(fileScope, [enclosing, tag])` resolves the nested field and emits the render-by-tag expansion. Dependency-graph.ts structural-read credit added for render-by-tag tag names (E-DG-002 false-positive cleared). |
| `given` guard | §42.2.3 presence guard: `given ident [, ident]* => { body }`; produces `kind: "given-guard"` AST node; standalone form `:>` ratified S148 as Insight-33 extension |
| formFor | Type-driven form generation from struct definition (§41.14) — `emit-form-for.ts` |
| schemaFor | Type-driven schema emission (§41 family) — `emit-schema-for.ts`; S156 (d)-A batch 3 adds enum-subset `CHECK IN` lowering (§41.15.6 + §41.15.8a): a `Role oneOf([.Admin,.Editor])` field column emits `CHECK (col IN ('Admin','Editor'))` in declaration order |
| tableFor | Type-driven table rendering (§41 family) — `emit-table-for.ts` |
| native-parser | scrml-native replacement for BS+TAB; `compiler/native-parser/` (38 `.js` files + FEATURE-stale `.scrml` mirrors); `--parser=scrml-native`. The ACTIVE strategic line: drive to default → delete legacy BS+Acorn at M6 (direction-a, ratified S161). **S162: the S153 "does NOT promote each/match" HARD precondition is CLOSED** — native NOW promotes BOTH `<each>` → `each-block` (NEW: `isEachBlock`/`synthEachBlockNode`) AND `<match>` → `match-block` (`isMatchBlock`/`synthMatchBlockNode`, pre-existing). Remaining flip-failures are a DIFFERENT ~6-family set — see "Native-Parser Swap Orientation" below |
| library mode | Compile mode that emits ES module exports JS + server JS without HTML/runtime (SPEC §12.6); `emit-library.ts`; suppresses `.server.js` for body-content-escalated fns |
| arm separator `:>` | Canonical match / `!{}`-handler / `given`-guard arm separator (SPEC §18.2 / §34, S147-S148); `=>` and `->` are deprecated aliases; all three parse, build, and emit identically during the deprecation window |
| W-MATCH-ARROW-LEGACY | Info-level diagnostic emitted at every match arm or `!{}`-handler arm using a deprecated `=>` or `->` separator; suggests `bun scrml migrate --fix` for AST-driven rewrite |
| per-file watcher | `commands/dev.js` (S152): Bun `fs.watch` per-file (not recursive-dir) to avoid inotify exhaustion; degrades gracefully on ENOSPC limit |
| enum-subset refinement (§53.15.1) | `Role oneOf([.Admin,.Editor])` / `Role notIn([.Guest])` type annotation form (S156 (d)-A); parsed by shared `parseEnumSubsetAnnotation()` in `enum-subset-refinement.ts`; materialized as `PredicatedType` with `subsetVariants: Set<string>` (already complemented for `notIn`) in type-system.ts; three consumers: (1) match exhaustiveness narrowed to subset variants (§18.8.1 / §18.0.1); (2) `["A","B"].includes(v)` boundary check codegen in emit-predicates.ts; (3) `CHECK IN` subset in schemaFor emit-schema-for.ts. Range form `.A .. .B` is explicitly forbidden (reintroduces SPARK RPP02 union-evolution hazard) |
| `E-MATCH-SUBSET-DEAD-ARM` | Dead arm diagnostic (S156 (d)-A): a `<match>` arm names a variant outside the declared subset — it can never be reached. Emitted by both type-system.ts (full type-resolution pass) and symbol-table.ts PASS 20 (string-based exhaustiveness pass via shared recognizer) |
| `_scrml_engine_dispatch_message` | Runtime helper (S155, runtime-template.js): resolves `(state × message)` dispatch table; calls per-state arm fn (receives `stateData, msgData`); routes result to `_scrml_engine_advance`; implements §51.0.R handled-message idle-reset |
| `_scrml_reconcile_list` key→item map | (S158): `container._scrml_item_by_key: Map<key, item>` built on EVERY reconcile pass (including fast-path B2 same-order bail); `_scrml_trigger(container, "_scrml_items")` re-fires per-item effects after map rebuild. This is the runtime side of Bug 64 / R28-1c. |
| `_scrml_resolve_item(container, key)` | (S158, runtime-template.js): reads `container._scrml_item_by_key`, tracks `(container, "_scrml_items")` via `_scrml_track`, returns live item wrapped in `_scrml_deep_reactive` (null when key gone — canonical absence §42.5). Used by live-keyed per-item effects emitted by `maybeWrapEachPerItemEffect` / `maybeWrapLiftPerItemEffect`; AND by per-item event handler re-resolution (Bug 73) emitted by `maybeWrapEachPerItemHandler` / `maybeWrapLiftPerItemHandler`. |
| match-as-expression exhaustiveness (S157) | `const x = match @cell { ... }` (let/const/return positions) now hooks into the exhaustiveness pass: ast-builder.js dual-parse inserts a structural `matchExpr` side-field; type-system.ts `checkMatchDiagnostics` runs on it (E-TYPE-020). Also: derived `const <x> = match @cell { ... }` reactive cell (Bug 71). |
| E-SYNTAX-064 / redundant-CODEGEN suppression | (S157 + S159 R3): `@.` outside an `<each>` body scope now fires E-SYNTAX-064 (both the attr-walk site in the TS pass and the markup-attr-value walk site, S157; additionally `:`-shorthand body positions, S159 R3) instead of leaking to E-CODEGEN-INVALID-JS. api.js suppresses E-CODEGEN-INVALID-JS when compilation already has a prior fatal error (Bug 70). |

## Business Invariants (from SPEC + code)
- `null` and `undefined` do NOT exist in scrml source; both → `not` (SPEC §42; `W-ABSENCE-IN-SCRML-SOURCE`)
- Client JS MUST NOT contain SQL execution calls, server env access, or other server-only constructs (E-CG-006)
- `<auth role="X">` gates JS-mount only, NOT served HTML content (W-AUTH-CONTENT-NOT-GATED, GITI-027A)
- Every reactive write site must be in a logic context (E-WRITE-NOT-IN-LOGIC-CONTEXT)
- `lin`-typed values must be consumed exactly once across all code paths
- `async`/`await` are forbidden in scrml source (E-ASYNC-NOT-IN-SCRML, E-AWAIT-NOT-IN-SCRML); CPS is the canonical async surface
- `switch`/`try`/`throw` are forbidden scrml vocabulary (E-SWITCH-FORBIDDEN, E-THROW-NOT-IN-SCRML, E-TRY-NOT-IN-SCRML)
- Engine state-children are canonical state-machine representations; nested engines are permitted
- Match / `!{}`-handler / `given`-guard arm separator is `:>`; `=>` / `->` are deprecated aliases — new code SHALL use `:>` (SPEC §18.2 / §34)
- Typed-array decl with no RHS defaults to `[]` (§6.2 Shape 4); non-array typed decl with no RHS is E-DECL-NEEDS-INITIALIZER
- An `<each>`/`<match>` body render must remain reachable from the file's runtime-chunk walk even when the mount lives only inside an engine/match arm `bodyChildren` (S153 — else the reconcile/effect chunks are tree-shaken → ReferenceError)
- The each render's reactive dependency must be recorded at module-init regardless of mount presence (read `_items` before the `!_mount` early-return) so a later arm-mount re-render has a live subscription (S153)
- An `<each>` template's event handlers that contain `.advance(.X)` or `@engine = .X` MUST go through the engine-ctx lowering path (`emitEngineHandlerBody`) in emit-each.ts — direct lowering without ctx produces stale `undefined`-call JS (Bug 62 root cause; Bug 65 was the same gap in emit-lift.js — CLOSED S157)
- `oneOf`/`notIn` enum-subset refinements: range form `.A .. .B` is forbidden (§53.15.1); the argument must be an explicit enumerated set; `notIn` is complemented to positive IN-SET at resolution time (both loci read the same positive set)
- Per-item TEXT / class: / attr bindings in both Tier-1 `<each>` and Tier-0 `${for…lift}` MUST be wrapped in a live-keyed `_scrml_effect` via `maybeWrapEachPerItemEffect` / `maybeWrapLiftPerItemEffect` so same-key reconcile (array-replace, reorder) does not show stale content (Bug 64 / R28-1c — CLOSED S158)
- Per-item EVENT HANDLERS in both tiers that READ the iter var MUST go through the live-keyed prelude (`maybeWrapEachPerItemHandler` / `maybeWrapLiftPerItemHandler`) so same-key reconcile fires with live item data, not the create-time snapshot (Bug 73 — CLOSED S159). Handlers do NOT use `_scrml_effect`. The wrap is gated by `iterScopeReferencedInHandler` — global handlers (no iter-var read) stay byte-identical.
- `_scrml_resolve_item(container, key)` returns `null` (NOT `undefined`) when the key is gone — canonical compiled-output absence is `null` per SPEC §42.5; the W-CG-UNDEFINED-INTERPOLATION lint forbids `undefined` in emitted JS
- E-CODEGEN-INVALID-JS is SUPPRESSED when the compilation already has a prior fatal error (Bug 70); the gate's contract is "emits valid JS for VALID source" — firing it on top of an earlier error is misleading
- A void HTML element (`isVoid:true` in the §24 registry) REJECTS `:`-shorthand body with `E-COLON-SHORTHAND-ON-VOID` (§4.14 / S159); a non-void HTML element's `:`-shorthand body is synthesized as its single-expression body at ast-builder.js `buildBlock` time — byte-identical to `<tag>${expr}</tag>` (§4.14)

## Domain Events / Diagnostic Codes (key runtime lifecycle)
W-AUTH-CONTENT-NOT-GATED — emitted when `<auth role>` is used without content gating (GITI-027A)
W-MATCH-ARROW-LEGACY — emitted (info-level) at every match / `!{}`-handler arm using deprecated `=>` or `->` separator (S147, SPEC §18.2 / §34)
W-EACH-PROMOTABLE — emitted (info-level) at `${ for (let x of @cell) { lift ... } }` sites eligible for `<each>` promotion (S130 HU-1, Stage 6.4c)
W-EACH-KEY-001 — emitted (info-level) at `<each in=@cell>` sites where items have no inferable `.id` key (S130 HU-1, Stage 6.4d)
E-DECL-NEEDS-INITIALIZER — emitted at non-array typed-decl with no RHS (S152 §6.2 Shape 4)
E-ENGINE-STATE-CHILD-MISSING — engine state-child closer un-findable; S153 fixed the `:`-shorthand-child false-fire class
E-ENGINE-ACCEPTS-NOT-ENUM — (S155) `<engine for=T>` declares `accepts=MsgType` but `MsgType` is absent or non-`:enum` [symbol-table.ts SYM PASS 11]
E-ENGINE-MSG-WITHOUT-ACCEPTS — (S155) a state-child declares a message arm (`| .Variant :>`) but the engine has no `accepts=` [symbol-table.ts PASS 20]
E-ENGINE-MSG-ARM-NOT-EXHAUSTIVE — (S155) a state declares message arms but the set does not cover all `accepts=` enum variants and has no wildcard arm [symbol-table.ts PASS 20]
E-ENGINE-MSG-UNKNOWN — (S155) `.advance(.X)` targets a variant that is in NEITHER the state-transition plane NOR the message-dispatch plane [type-system.ts]
E-MATCH-SUBSET-DEAD-ARM — (S156 (d)-A batch 2+4) a match arm names a variant excluded by the matched cell's `oneOf`/`notIn` subset refinement — it is unreachable [type-system.ts + symbol-table.ts PASS 20]
E-COLON-SHORTHAND-ON-VOID — (S159 NEW) `:`-shorthand body on a void HTML element; void elements have no content model [type-system.ts:5004]. Fatal.
E-SYNTAX-064 — (S157 Bug 70/73; S159 R3 extended) `@.` contextual sigil used outside an `<each>` body scope; fired at the TS attr-walk site, the markup-attr-value walk site, AND (S159) `:`-shorthand body positions [type-system.ts:6643 + 7434 + 5016+]
I-MATCH-PROMOTABLE — info diagnostic suggesting match → engine promotion (§56)
I-FN-PROMOTABLE — info diagnostic suggesting function promotion

## Pipeline Source Files (stage → primary file)

| Stage | File |
|-------|------|
| BS | compiler/src/block-splitter.js |
| TAB | compiler/src/tokenizer.ts + compiler/src/ast-builder.js |
| NR | compiler/src/name-resolver.ts |
| MOD | compiler/src/module-resolver.js |
| CE | compiler/src/component-expander.ts |
| PA | compiler/src/gauntlet-phase1-checks.js + validators/ |
| RI | compiler/src/route-inference.ts |
| TS | compiler/src/type-system.ts |
| META | compiler/src/meta-checker.ts + compiler/src/meta-eval.ts |
| DG | compiler/src/dependency-graph.ts |
| CG | compiler/src/code-generator.js + compiler/src/codegen/ |
| Engine-arm parsing | compiler/src/engine-statechild-parser.ts (custom raw-text closer-pairing + message-arm lexer, S154) |
| SYM analysis | compiler/src/symbol-table.ts (11280L; PASS 11 `accepts=` resolution; PASS 20 match exhaustiveness incl. subset dead-arm, S155-S156) |
| Enum-subset shared recognizer | compiler/src/enum-subset-refinement.ts (143L NEW, S156) |
| Sidecar | compiler/src/engine-graph.ts (--emit-engine-graph, S149) |

## Codegen `<each>` / `<match>` Emit Map (S152-S159 — read before any each/match or engine codegen)

| File | Role |
|------|------|
| compiler/src/codegen/emit-each.ts (**1742L**) | Tier-1 `<each>` render fns; `collectEachBlocks`, `emitEachBodyRenderForFile`, `emitEachMountHtml`, shared `emitEachReconcileLines`; dep-first read + `_scrml_each_renderers` registration (S153); Bug 62 (S156): `buildEachEngineCtx` + `EachEngineCtx` threading; Bug 64 (S158): `EachReconcileCtx` stack + `maybeWrapEachPerItemEffect` + push/pop/current for live-keyed per-item TEXT/class: bindings; Bug 73 (S159): `blankStringAndRegexLiterals` + `iterScopeReferencedInHandler` (exported, shared with emit-lift.js) + `maybeWrapEachPerItemHandler` for live-keyed Tier-1 per-item EVENT HANDLERS; `emitNestedEachFromMarkup` (exported, used by emit-lift.js Bug 72) |
| compiler/src/codegen/emit-lift.js (**2318L**) | Tier-0 `${for…lift}` path; Bug 65 (S157): engine-ctx threading via `buildLiftEngineCtx`/`buildLiftEngineCtxFromExtras`/`tryLowerLiftEngineHandler`; Bug 64 (S158): `pushLiftReconcileCtx`/`popLiftReconcileCtx` + `maybeWrapLiftPerItemEffect`; Bug 72 (S158): `tryEmitNestedLiftEach` routes nested `<each>` through `emitNestedEachFromMarkup`; Bug 73 (S159): `maybeWrapLiftPerItemHandler` (function-body shape) + `maybeWrapLiftCallableHandler` (callable-direct shadow shape) + `_liftIterScopeReferenced` (delegates to emit-each.ts `iterScopeReferencedInHandler` via `require()`) |
| compiler/src/codegen/emit-control-flow.ts (2013L) | Tier-0 for-loop `createFn` key capture + `pushLiftReconcileCtx`/`popLiftReconcileCtx` (Bug 64 S158); engine-ctx threading into `emitConsolidatedLift`/`emitLiftExpr`/`emitIfStmtWithContainer`/`emitForStmtWithContainer` |
| compiler/src/codegen/emit-match.ts | block-form `<match>` arm emission; each-bearing arms re-parse via splitBlocks+buildAST; `restampEachBlockIds`, `__scrmlCachedArms` (S153) |
| compiler/src/codegen/emit-engine.ts (4398L) | Engine substrate codegen; S155: `emitEngineMessageArmTable()`, `engineMessageArmTableName()`, `engineHasMessageArms()`, `collectEnginesWithMessageArms()`, `collectEngineMessageVariants()` exported for threading into emit-each and emit-event-wiring; `parseEnumVariantFieldsForType()` resolves payload-binding field names at codegen time |
| compiler/src/codegen/emit-html.ts (2432L) | HTML emit; Bug 60 (S157): `enclosingCompoundStack` + `lookupQualifiedStateCell` fallback for render-by-tag inside compound wrappers |
| compiler/src/codegen/emit-variant-guard.ts | shared engine/match arm-swap dispatcher; calls `_scrml_remount_each` after arm innerHTML+wire (S153) |
| compiler/src/codegen/emit-client.ts (2427L) | `detectRuntimeChunks` descends into engine + each-block `bodyChildren` so reconcile/effect/remount chunks survive tree-shaking (S153) |
| compiler/src/codegen/emit-predicates.ts (518L) | §53 predicate boundary-check codegen; S156 (d)-A: `kind: "variant-set"` case emits `(["A","B"].includes(v))` |
| compiler/src/codegen/emit-schema-for.ts (516L) | schemaFor SQL DDL emission; S156 (d)-A batch 3: enum-subset `predicated` type emits `CHECK IN (ordered subset names)` |
| compiler/src/codegen/emit-logic.ts (3884L) | Bug 65 (S157): `for-stmt` case now threads all engine extras (engineBindings, engineVarNames, enginesWithHooks, enginesWithOnTimeout, enginesWithIdleWatchdog, enginesWithInternalRules, enginesWithHistory, enginesWithMessageArms, engineMessageVariants) into `emitForStmt` |
| compiler/src/runtime-template.js (3760L) | `_scrml_each_renderers` registry + `_scrml_remount_each` helper (S153); `_scrml_engine_dispatch_message` (S155); `_scrml_reconcile_list` + `container._scrml_item_by_key` key→item map + `_scrml_trigger(container, "_scrml_items")` (Bug 64 S158); `_scrml_resolve_item(container, key)` returns live item via `_scrml_deep_reactive` or null (Bug 64 S158; also consumed by Bug 73 handler re-resolution prelude); `_scrml_effect_static`, `_scrml_modules` |
| compiler/src/dependency-graph.ts (3354L) | Bug 60 (S157): render-by-tag structural-read credit for E-DG-002 (markup tag name matches reactive var → `creditReader`) |
| compiler/src/component-expander.ts | each-in-component-body: legacy re-parse fallback + substituteProps each-block string fields + tokenized-sigil collapse (S153) |
| compiler/src/engine-statechild-parser.ts (2418L) | `:`-shorthand-child closer-pairing fix (S153); `accepts=` + message-arm lexer `parseMessageArms()` (S154) |
| compiler/src/enum-subset-refinement.ts (143L NEW) | Shared pure `parseEnumSubsetAnnotation()` recognizer; used by type-system.ts + symbol-table.ts to agree on the §53.15.1 grammar |
| compiler/src/ast-builder.js (**14003L**) | Bug 72 (S158): `_parseLiftAttrValue` bare-`@` branch collects `@.` token run as expr value; Bug 71 (S157): derived `const <x> = match` dual-parse hook; Bug 67 (S157): `return match` hook; S159 R1: `buildBlock()` body-child synthesis for non-void HTML `:`-shorthand bodies |
| compiler/src/block-splitter.js (**2950L**) | S159 R4a: `shorthand && !selfClosing` branch placed BEFORE void/self-closing short-circuit so `<void : expr>` reaches the type-system guard |
| compiler/src/type-system.ts (**17436L**) | Bug 63 (S157): markup event-handler attr `.advance` two-plane checking; E-SYNTAX-064 emitted for `@.` outside each body scope; Bug 67/71: match-as-expr exhaustiveness wired; S159 R4b: `E-COLON-SHORTHAND-ON-VOID` guard + R3 `@.`-shorthand-body E-SYNTAX-064 extension |

## Native-Parser Swap Orientation (S161 ratified / S164 re-measured) — READ FIRST for any native-parser flip-failure work

**Strategic line:** drive `--parser=scrml-native` to DEFAULT, then DELETE legacy block-splitter (BS) +
Acorn at M6 (direction-a, ratified S161; realistic v0.8 multi-session target). The native parser is
`compiler/native-parser/` — paired `.js` bootstrap + `.scrml` self-host mirror. Fix the `.js`; the `.scrml`
mirrors are FEATURE-stale (S162 — whole machinery missing, not mere predicate-drift; S115 lockstep moot until
a deliberate re-sync). **The Phase-A default-flip itself is a STANDING USER DECISION — PA ships parity-closers
feeding it, never "the flip."**

**each/match promotion — CLOSED (S162):** the former HARD M5-swap precondition (native "does NOT promote
`<each>`/`<match>` to structural nodes", S153) is RETIRED. Native now promotes BOTH: `<match>` → `match-block`
(`isMatchBlock`/`synthMatchBlockNode`) and `<each>` → `each-block` (`isEachBlock`/`synthEachBlockNode` in
parse-file.js). `@.` contextual sigil lexed; emit-each honors the `exprNode` contract; SPEC §4.15/§24.4
register `<each>` structural.

**F1 engine-substrate silent-miscompile — CLOSED (S163, the headline fix):** the ~168 "engine arm-body"
family's DOMINANT cause was NOT spurious `E-UNQUOTED` or arm-body classification (that was the S139-trap
framing at survey level — files compiled CLEAN but silently miscompiled). Native silently DROPPED the entire
§51.0 engine substrate (transition table, `_scrml_engine_direct_set` rule-validation, var-init, mount/body-
render) across ALL engine files — emitting `<engine>` as a dumb `_scrml_reactive_set` cell. **Root cause = a
`machineDecls` TWO-INSTANCE object-identity defect:** native synthesized two `engine-decl` objects (nodes copy
via `parse-file.js synthEngineNode` + a SEPARATE machineDecls copy via `collect-hoisted.js synthEngineDecl`);
SYM stamped `_record`/`engineMeta` on the nodes copy, codegen `collectC12EngineDecls` read the un-stamped
machineDecls copy FIRST → `isC12EngineDecl` false → substrate dropped. **Fix (a41df176, ~40L):** native derives
`machineDecls` from the mapped `nodes` instances (`collectMachineDeclsFromNodes` in parse-file.js) + maps
`bodyChildren` to AST nodes (nested engines); `collect-hoisted.js` no longer synthesizes engines. All 6 swept
engine sub-features (basic/hierarchy/onTimeout/onIdle/history/effects) now BYTE-IDENTICAL native==default.
**B1 (S163, 6ad8ca13):** native `reset(@cell)` → `reset-expr` (translate-expr.js intercepts bare-`reset` callee
→ live `reset-expr` node; 3 §6.8.2 shapes). **§4.18 ruling (S163):** native's `E-UNQUOTED-DISPLAY-TEXT` fire on
bare display text in an engine/match/`:`-shorthand arm body is SPEC-CORRECT (§4.18.7), NOT spurious — native is
the canonical enforcer, LIVE stays lenient (doomed at M6); corpus bare-text→`"..."` migration is deferred
swap-prep backlog.

**S164 flip re-measure: 674 flip-failures (down from ~790 S162, 1,150 S161) — engine-substrate + B1 killed ~116.**
~8 are environmental (6 ECONNREFUSED browser + 2 within-node SPAN-COORD); ~666 genuine across ~6 families + 181 files.

| Family | ~Count | Size | Locus (native file) | Status |
|--------|--------|------|---------------------|--------|
| ~~F1 engine substrate-drop~~ | ~~~168~~ | — | parse-file.js / collect-hoisted.js | **CLOSED S163** (machineDecls instance-share fix; 6 sub-features byte-identical) |
| **B2 §51.0.S message-arm** | ~20 | L-subset | `synthEngineDecl` (zero `accepts=` handling) + `native-walker/engine-statechild-walker.ts:516` (hard-codes `messageArms: []`) | **THE NEXT DISPATCH** — `E-ENGINE-ACCEPTS-NOT-ENUM` (4) + `E-ENGINE-MSG-UNKNOWN` (3) + engine-message-dispatch conf/browser; mirror live `parseMessageArms()` in `engine-statechild-parser.ts` (S154) |
| mario PowerUp payload-enum | ~few | — | native enum-body capture | NEW S163 — native captures only `["Mushroom"]` (drops payload variants), mis-emits `PowerUp.Flower(3)` as `"Flower"(3)`; payload-bearing-enum native gap (mario residual 133 diff-lines) |
| `effect=` opener (§51.0.H Form 3) | small | S | `synthEngineDecl` (no openerEffect read) | OPEN — small separate gap |
| F2 SQL `?{}` in server-fn | ~58 | — | `parse-sql-body.js` | OPEN — drops SQL body in top-level server fns |
| F3 if-as-expr residual | small | — | `parse-expr.js` | same-line match arms DONE S162; if-as-expr residual (LOW) |
| F4 formFor expansion | ~32 | — | native parse → bridge → form pass | OPEN — drops field-markup expansion |
| F5 `const @name` derived-decl | ~20 | — | `parse-stmt.js` | OPEN — rejects `@`-prefixed decl |
| F6/F9 fn param / export-fn-body | ~16 | — | `parse-stmt.js` / `parse-expr.js` | OPEN |
| F7 missing diagnostics | ~15 | — | body-parser gates (`tag-frame.js` etc.) | OPEN — swallow `E-STRUCTURAL-ELEMENT-MISPLACED` etc. |
| F8 stdlib `await import()` | 13 | — | — (NOT a native-parser change) | RULED a stdlib-migration task; native stays strict no-`await` enforcer |

Other large flip-failure signatures in the 674 (native mis-parse → wrong/downstream diagnostic, spread across
families): `E-CODEGEN-INVALID-JS` (18, downstream invalid JS), `E-TYPE-063` (15) + `E-VARIANT-AMBIGUOUS` (4)
(native bare-variant resolution gap), `E-TYPE-001` (14) + `E-TYPE-020` (14) (lifecycle / exhaustiveness),
`E-MATCH-NOT-EXHAUSTIVE` (7) + `E-MATCH-SUBSET-DEAD-ARM` (4) (match family).

**B2 (NEXT) detail:** §51.0.S engine message dispatch — `accepts=MsgType` opener attr + `(state × message)`
arm form. Native `synthEngineDecl` has ZERO `accepts=` handling (acceptsType undefined vs live null);
`native-walker/engine-statechild-walker.ts:516` hard-codes `messageArms: []`. The LIVE pattern to mirror is
`engine-statechild-parser.ts parseMessageArms()` (landed S154/S155 #14: `accepts=MsgType` capture +
`(state × message)` arm recognition → `EngineStateChildEntry.messageArms`). Affects `engine-message-dispatch-s6.scrml`
+ the conf/browser `engine-message-dispatch-s155` tests. See structure.map.md "Native-Parser File Table".

## Tags
#scrmlts #map #domain #compiler #pipeline #reactive #state-machine #scrml #match-arrow #engine-graph #source-map #cross-file-modules #each #each-in-dynamic-context #engine-statechild #enum-subset #message-dispatch #bug60 #bug62 #bug63 #bug64 #bug65 #bug70 #bug71 #bug72 #bug73 #r28-1c #per-item-reactivity #live-keyed #colon-shorthand-html #s149 #s151 #s152 #s153 #s154 #s155 #s156 #s157 #s158 #s159 #native-parser #native-parser-swap #each-promotion #match-promotion #flip-failure-families #f1-engine-substrate-closed #b2-message-arm-next #engine-substrate-fix #machinedecls-instance-share #s160 #s161 #s162 #s163 #s164

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [schema.map.md](./schema.map.md)
- [error.map.md](./error.map.md)
