# domain.map.md
# project: scrmlts
# updated: 2026-06-02T21:33:23-06:00  commit: 57edc794

The domain is the scrml COMPILER pipeline. scrml is a single-file, full-stack reactive web
language compiled by this TypeScript/JS toolchain running on Bun. The compiler converts `.scrml`
source files into `*.server.js` + `*.client.js` + `*.html` + `*.css` outputs.

## Core Concepts

| Concept | Definition |
|---------|-----------|
| `.scrml` file | Single-file source combining markup, logic, styles, SQL, auth, types, and tests |
| Pipeline | 12 ordered stages: BS → TAB → NR → MOD → CE → PA → RI → TS → META → VSS → DG → CG |
| BS (Block Splitter) | Stage 1: tokenizes `.scrml` into typed blocks (markup/logic/sql/css/etc.) — `block-splitter.js` |
| TAB (Tokenizer+AST Builder) | Stage 2: builds FileAST from block stream — `tokenizer.ts` + `ast-builder.js`; the `each-block`/`match-block` structural transform lives HERE (in `buildAST`), NOT in the native parser |
| NR (Name Resolver) | Stage 3: resolves reactive decls, engine vars, component refs — `name-resolver.ts` |
| MOD (Module Resolver) | Stage 3.1: builds import graph, detects circular imports, produces export registry — `module-resolver.js` |
| CE (Component Expander) | Stage 3.2: expands component references via same-file + cross-file registries — `component-expander.ts`; re-parses synthesized component bodies, falling back to legacy `splitBlocks`+`buildAST` when the body contains `<each>`/`<match>` (S153) |
| PA (Pre-Analysis) | Stage 4: structural validation, attribute allowlists — `attribute-registry.js` + validators/ |
| RI (Route Inference) | Stage 5: infers server routes from page structure — `route-inference.ts` |
| TS (Type System) | Stage 6: type checking, validity surface synthesis, engine type verification — `type-system.ts` (17070L) |
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
| `<each>` engine-ctx threading (Bug 62) | (S156): `buildEachEngineCtx(fileAST)` in emit-each.ts collects per-file engine metadata once (engines with message arms, message-variant sets) and threads `EachEngineCtx` through every per-item template attr/child lowering so `@engine.advance(.X)` / `@engine = .X` inside `<each>` templates lower correctly to the state or message plane. **Bug 65 (next arc):** the identical gap exists at the Tier-0 `${for…lift}` path in `emit-lift.js` (~line 529) — that file has NO engine-ctx threading yet; emit-each.ts is the template to mirror |
| `given` guard | §42.2.3 presence guard: `given ident [, ident]* => { body }`; produces `kind: "given-guard"` AST node; standalone form `:>` ratified S148 as Insight-33 extension |
| formFor | Type-driven form generation from struct definition (§41.14) — `emit-form-for.ts` |
| schemaFor | Type-driven schema emission (§41 family) — `emit-schema-for.ts`; S156 (d)-A batch 3 adds enum-subset `CHECK IN` lowering (§41.15.6 + §41.15.8a): a `Role oneOf([.Admin,.Editor])` field column emits `CHECK (col IN ('Admin','Editor'))` in declaration order |
| tableFor | Type-driven table rendering (§41 family) — `emit-table-for.ts` |
| native-parser | In-progress scrml-native replacement for BS+TAB; `compiler/native-parser/`; activated via `--parser=scrml-native`. HARD M5-swap precondition (S153, witnessed twice): does NOT promote `<each>`/`<match>` to structural each-block/match-block nodes — when it becomes default it MUST, or every each/match breaks |
| library mode | Compile mode that emits ES module exports JS + server JS without HTML/runtime (SPEC §12.6); `emit-library.ts`; suppresses `.server.js` for body-content-escalated fns |
| arm separator `:>` | Canonical match / `!{}`-handler / `given`-guard arm separator (SPEC §18.2 / §34, S147-S148); `=>` and `->` are deprecated aliases; all three parse, build, and emit identically during the deprecation window |
| W-MATCH-ARROW-LEGACY | Info-level diagnostic emitted at every match arm or `!{}`-handler arm using a deprecated `=>` or `->` separator; suggests `bun scrml migrate --fix` for AST-driven rewrite |
| per-file watcher | `commands/dev.js` (S152): Bun `fs.watch` per-file (not recursive-dir) to avoid inotify exhaustion; degrades gracefully on ENOSPC limit |
| enum-subset refinement (§53.15.1) | `Role oneOf([.Admin,.Editor])` / `Role notIn([.Guest])` type annotation form (S156 (d)-A); parsed by shared `parseEnumSubsetAnnotation()` in `enum-subset-refinement.ts`; materialized as `PredicatedType` with `subsetVariants: Set<string>` (already complemented for `notIn`) in type-system.ts; three consumers: (1) match exhaustiveness narrowed to subset variants (§18.8.1 / §18.0.1); (2) `["A","B"].includes(v)` boundary check codegen in emit-predicates.ts; (3) `CHECK IN` subset in schemaFor emit-schema-for.ts. Range form `.A .. .B` is explicitly forbidden (reintroduces SPARK RPP02 union-evolution hazard) |
| `E-MATCH-SUBSET-DEAD-ARM` | Dead arm diagnostic (S156 (d)-A): a `<match>` arm names a variant outside the declared subset — it can never be reached. Emitted by both type-system.ts (full type-resolution pass) and symbol-table.ts PASS 20 (string-based exhaustiveness pass via shared recognizer) |
| `_scrml_engine_dispatch_message` | Runtime helper (S155, runtime-template.js): resolves `(state × message)` dispatch table; calls per-state arm fn (receives `stateData, msgData`); routes result to `_scrml_engine_advance`; implements §51.0.R handled-message idle-reset |

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
- An `<each>` template's event handlers that contain `.advance(.X)` or `@engine = .X` MUST go through the engine-ctx lowering path (`emitEngineHandlerBody`) in emit-each.ts — direct lowering without ctx produces stale `undefined`-call JS (Bug 62 root cause)
- `oneOf`/`notIn` enum-subset refinements: range form `.A .. .B` is forbidden (§53.15.1); the argument must be an explicit enumerated set; `notIn` is complemented to positive IN-SET at resolution time (both loci read the same positive set)

## Domain Events / Diagnostic Codes (key runtime lifecycle)
W-AUTH-CONTENT-NOT-GATED — emitted when `<auth role>` is used without content gating (GITI-027A)
W-MATCH-ARROW-LEGACY — emitted (info-level) at every match / `!{}`-handler arm using deprecated `=>` or `->` separator (S147, SPEC §18.2 / §34)
W-EACH-PROMOTABLE — emitted (info-level) at `${ for (let x of @cell) { lift ... } }` sites eligible for `<each>` promotion (S130 HU-1, Stage 6.4c)
W-EACH-KEY-001 — emitted (info-level) at `<each in=@cell>` sites where items have no inferable `.id` key (S130 HU-1, Stage 6.4d)
E-DECL-NEEDS-INITIALIZER — emitted at non-array typed-decl with no RHS (S152 §6.2 Shape 4)
E-ENGINE-STATE-CHILD-MISSING — engine state-child closer un-findable; S153 fixed the `:`-shorthand-child phantom-opener class
E-ENGINE-ACCEPTS-NOT-ENUM — (S155) `<engine for=T>` declares `accepts=MsgType` but `MsgType` is absent or non-`:enum` [symbol-table.ts SYM PASS 11]
E-ENGINE-MSG-WITHOUT-ACCEPTS — (S155) a state-child declares a message arm (`| .Variant :>`) but the engine has no `accepts=` [symbol-table.ts PASS 20]
E-ENGINE-MSG-ARM-NOT-EXHAUSTIVE — (S155) a state declares message arms but the set does not cover all `accepts=` enum variants and has no wildcard arm [symbol-table.ts PASS 20]
E-ENGINE-MSG-UNKNOWN — (S155) `.advance(.X)` targets a variant that is in NEITHER the state-transition plane NOR the message-dispatch plane [type-system.ts]
E-MATCH-SUBSET-DEAD-ARM — (S156 (d)-A batch 2+4) a match arm names a variant excluded by the matched value's `oneOf`/`notIn` subset refinement — it is unreachable [type-system.ts + symbol-table.ts PASS 20 (constructor-form + member-access)]
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

## Codegen `<each>` / `<match>` Emit Map (S152-S156 — read before any each/match or engine codegen)

| File | Role |
|------|------|
| compiler/src/codegen/emit-each.ts (1345L) | Tier-1 `<each>` render fns; `collectEachBlocks`, `emitEachBodyRenderForFile`, `emitEachMountHtml`, shared `emitEachReconcileLines`; dep-first read + `_scrml_each_renderers` registration (S153); Bug 62 (S156): `buildEachEngineCtx` + `EachEngineCtx` threading so `.advance(.X)`/`@engine=.X` in per-item templates lower correctly |
| compiler/src/codegen/emit-lift.js (1861L) | Tier-0 `${for…lift}` path — **NOT updated for engine-ctx threading (Bug 65 next arc)**; emit-each.ts is the pattern template for the fix |
| compiler/src/codegen/emit-match.ts | block-form `<match>` arm emission; each-bearing arms re-parse via splitBlocks+buildAST; `restampEachBlockIds`, `__scrmlCachedArms` (S153) |
| compiler/src/codegen/emit-engine.ts (4398L) | Engine substrate codegen; S155: `emitEngineMessageArmTable()`, `engineMessageArmTableName()`, `engineHasMessageArms()`, `collectEnginesWithMessageArms()`, `collectEngineMessageVariants()` |
| compiler/src/codegen/emit-variant-guard.ts | shared engine/match arm-swap dispatcher; calls `_scrml_remount_each` after arm innerHTML+wire (S153) |
| compiler/src/codegen/emit-client.ts | `detectRuntimeChunks` descends into engine + each-block `bodyChildren` so reconcile/effect/remount chunks survive tree-shaking (S153) |
| compiler/src/codegen/emit-predicates.ts (518L) | §53 predicate boundary-check codegen; S156 (d)-A: `kind: "variant-set"` case emits `(["A","B"].includes(v))` |
| compiler/src/codegen/emit-schema-for.ts (516L) | schemaFor SQL DDL emission; S156 (d)-A batch 3: enum-subset `predicated` type emits `CHECK IN (ordered subset names)` |
| compiler/src/runtime-template.js | `_scrml_each_renderers` registry + `_scrml_remount_each` helper (S153); `_scrml_engine_dispatch_message` (S155); `_scrml_reconcile_list`, `_scrml_effect_static`, `_scrml_modules` |
| compiler/src/component-expander.ts | each-in-component-body: legacy re-parse fallback + substituteProps each-block string fields + tokenized-sigil collapse (S153) |
| compiler/src/engine-statechild-parser.ts (2418L) | `:`-shorthand-child closer-pairing fix (S153); `accepts=` + message-arm lexer `parseMessageArms()` (S154) |
| compiler/src/enum-subset-refinement.ts (143L NEW) | Shared pure `parseEnumSubsetAnnotation()` recognizer; used by type-system.ts + symbol-table.ts to agree on the §53.15.1 grammar |

## Tags
#scrmlts #map #domain #compiler #pipeline #reactive #state-machine #scrml #match-arrow #engine-graph #source-map #cross-file-modules #each #each-in-dynamic-context #engine-statechild #enum-subset #message-dispatch #bug62 #bug65 #s149 #s151 #s152 #s153 #s154 #s155 #s156

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [schema.map.md](./schema.map.md)
- [error.map.md](./error.map.md)
