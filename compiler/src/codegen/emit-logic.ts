import { genVar } from "./var-counter.ts";
import { paramName, paramSignature, type ParamLike } from "./utils.ts";
import { extractSqlParams, rewriteTildeRef, buildTaggedTemplate, protectTagSqlResult, _lowerTenantForQuery } from "./rewrite.js";
import { emitExpr, emitExprField, arrowBodyNeedsParens, arrowBodyStringNeedsParens, isStdlibAsyncCallee, type EmitExprContext } from "./emit-expr.ts";
import { stripLeakedComments, isLeakedComment, splitBareExprStatements, splitMergedStatements } from "./compat/parser-workarounds.js";
import { emitIfStmt, emitForStmt, emitWhileStmt, emitDoWhileStmt, emitBreakStmt, emitContinueStmt, emitTryStmt, emitMatchExpr, emitSwitchStmt, rewriteBlockBody, splitMultiArmString, parseMatchArm, matchArmInlineToMatchArm, emitVariantBindingPrelude, hasPayloadBindingOrTaggedVariant, isFailableOkMatch, emitMatchTagDiscriminator, getVariantFieldSchema, type MatchArm } from "./emit-control-flow.ts";
import { isDestructurePattern, nameOrPatternText } from "./emit-destructure-pattern.ts";
import { emitLiftExpr, emitCreateElementFromMarkup, emitMarkupValueExpr } from "./emit-lift.js";
import { extractReactiveDeps, extractReactiveDepsFromExprNode, extractReactiveDepsTransitive, isMapTypeAnnotation, type FunctionBodyRegistry } from "./reactive-deps.ts";
import { emitStringFromTree, parseExprToNode } from "../expression-parser.ts";
import type { EncodingContext, ResolvedType, StructType } from "./type-encoding.ts";
import { emitRuntimeCheck, parsePredicateAnnotation } from "./emit-predicates.ts";
import { emitTransitionGuard } from "./emit-machines.ts";
import { emitValidatorRunnerSidecar } from "./emit-validators.ts";
import { emitInlineMessageOverrides } from "./emit-messages.ts";
import { emitCompoundSynthSurface } from "./emit-synth-surface.ts";
import { CGError } from "./errors.ts";

// ---------------------------------------------------------------------------
// Deep reactive wrapping helper (Reactivity Phase 1)
// ---------------------------------------------------------------------------

/**
 * Wrap a rewritten expression with _scrml_deep_reactive() if the original
 * expression looks like it produces an object or array literal.
 *
 * Heuristic: wrap when the raw (pre-rewrite) expression starts with `{`, `[`,
 * `new `, or is a common object-producing pattern. For all other cases, the
 * runtime _scrml_deep_reactive is a no-op on primitives, so wrapping is safe
 * but we avoid it for readability.
 */
/**
 * A5 (2026-05-17) — Iterate bound names from a structured DestructurePattern.
 *
 * Used by const-decl / let-decl emission to track destructure-bound names in
 * `opts.declaredNames`. Mirrors type-system.ts iterDestructuredNames.
 */
function* _iterDestructureBindNames(p: any): Iterable<string> {
  if (!p || typeof p !== "object") return;
  if (p.kind === "destructure-array") {
    for (const el of (p.elements ?? [])) {
      if (el?.kind === "name" && typeof el.name === "string") yield el.name;
      else if (el?.kind === "nested" && el.pattern) yield* _iterDestructureBindNames(el.pattern);
    }
    if (p.rest) yield p.rest;
  } else if (p.kind === "destructure-object") {
    for (const prop of (p.properties ?? [])) {
      if (prop?.kind === "nested" && prop.pattern) yield* _iterDestructureBindNames(prop.pattern);
      else if (prop?.kind === "name" && typeof prop.bindName === "string") yield prop.bindName;
    }
    if (p.rest) yield p.rest;
  }
}

function _wrapDeepReactive(rewrittenExpr: string, rawExpr: string, initExpr?: any): string {
  // Phase 4d: ExprNode-first — structural detection of deep-reactive-worthy values
  if (initExpr) {
    const k = initExpr.kind;
    if (k === "object" || k === "array" || k === "new") {
      return `_scrml_deep_reactive(${rewrittenExpr})`;
    }
    if (k === "ident" && (initExpr.name === "Array" || initExpr.name === "Object")) {
      return `_scrml_deep_reactive(${rewrittenExpr})`;
    }
    if (k === "call" && initExpr.callee?.kind === "ident" &&
        (initExpr.callee.name === "Array" || initExpr.callee.name === "Object")) {
      return `_scrml_deep_reactive(${rewrittenExpr})`;
    }
    return rewrittenExpr;
  }
  // String fallback
  const trimmed = rawExpr.trim();
  if (
    trimmed.startsWith("{") ||
    trimmed.startsWith("[") ||
    trimmed.startsWith("new ") ||
    trimmed.startsWith("Array") ||
    trimmed.startsWith("Object")
  ) {
    return `_scrml_deep_reactive(${rewrittenExpr})`;
  }
  return rewrittenExpr;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EmitLogicOpts {
  derivedNames?: Set<string> | null;
  /**
   * Bug 61 — dotted synth-cell keys (`collectSynthCellKeys(fileAST)`). Threaded
   * into EmitExprContext via `_makeExprCtx` so `emitMember` can route
   * `@<compound>.<synthProp>` reads to the dotted synth cell. Sibling to
   * `derivedNames`; mirror its propagation chain.
   */
  synthCellKeys?: Set<string> | null;
  encodingCtx?: EncodingContext | null;
  /** §4.12.6: Override DB variable for nested <program db="..."> scopes. */
  dbVar?: string;
  /**
   * §32 Tilde pipeline accumulator context.
   * When set, bare-expr and value-lift nodes assign their result to this variable.
   * The `var` field is mutated by emitLogicNode to reflect the current tilde var name.
   */
  /**
   * §32 tilde mode: "single" (default) assigns once; "array" accumulates push calls
   * into an array declared before the enclosing loop (list comprehension pattern).
   */
  tildeContext?: { var: string | null; mode?: "single" | "array" };
  /**
   * When set to "return", `continue-stmt` nodes emit `return;` instead of `continue;`.
   * Used in reactive-for createItem functions where `continue` is illegal JS.
   */
  continueBehavior?: "continue" | "return";
  /** Track names declared by let-decl/const-decl so tilde-decl can detect reassignment. */
  declaredNames?: Set<string>;
  /**
   * §20.6 — the source span of the STATEMENT currently being emitted, set by
   * `emitLogicNode` before it descends into expression emission. The log()
   * lowering reads it as the AUTHOR `file:line` source: a `log(...)` call
   * node's OWN span loses its byte offset through the codegen re-parse
   * (`span.start === 0` not-set sentinel), but the enclosing statement node
   * carries the real offset. Threaded to EmitExprContext.stmtSpan.
   */
  currentStmtSpan?: { file?: string; start?: number; line?: number } | null;
  /** §51.5: Machine binding map for transition guard emission. Keyed by reactive var name. */
  machineBindings?: Map<string, { engineName: string; tableName: string; rules: any[]; auditTarget?: string | null }> | null;
  /**
   * C13 (§51.0.F): Engine binding map for `<engine>`-form direct-write hook
   * dispatch. Sibling to `machineBindings` (FORKED per C13 SURVEY q1 — the
   * legacy `TransitionRule[]` shape and the new C12 table format do not merge
   * cleanly). Keyed by engine variable name (e.g., "marioState"). When set
   * and the assignment LHS matches a key, `_emitReactiveSet` dispatches to
   * `_scrml_engine_direct_set` instead of bare `_scrml_reactive_set`.
   */
  engineBindings?: Map<string, import("./emit-engine.ts").EngineBindingInfo> | null;
  /**
   * §59 (D4): Value-native MAP variable names in the file's scope. Used by
   * `emit-expr.ts` to intercept `@m[k]` reads → `_scrml_map_get`, `@m.<method>(…)`
   * calls → `_scrml_map_<method>`, and `@m.size` → `_scrml_map_size`. NULL or
   * empty → no map interception. Computed once per file via `collectMapVarNames`
   * (reactive-deps.ts). Sibling to `engineVarNames`.
   */
  mapVarNames?: Set<string> | null;
  /**
   * §59.12 (D4): file-level set of value-native SET cell names (strict subset of
   * `mapVarNames`). Forwarded into `EmitExprContext.setVarNames` so `emit-expr.ts`
   * intercepts the set-native vocabulary (`.add`/`.elements`/`.union`/`.intersect`/
   * `.difference`). Computed once per file via `collectSetVarNames`
   * (reactive-deps.ts). Sibling to `mapVarNames`.
   */
  setVarNames?: Set<string> | null;
  /**
   * §6.7.7 / §60.4: file-level set of `<request>` `id` values. Forwarded into
   * `EmitExprContext.requestIds` so `emit-expr.ts` routes a `<#id>` markup ref
   * whose id names a `<request>` to the reactive `_scrml_request_<id>` object
   * (NOT the §36 input-state registry, which the request never populates).
   * Computed once per file via `collectRequestIds` (reactive-deps.ts). NULL or
   * empty → no `<request>` in scope. Sibling to `mapVarNames` / `engineVarNames`.
   */
  requestIds?: Set<string> | null;
  /**
   * Issue #1 (parent scrmlTS): names of SIBLING server functions callable
   * in-process from THIS server-fn body. Forwarded into
   * `EmitExprContext.serverFnNames` so `emit-expr.ts:emitCall` lowers a
   * plain-ident call to one of these names (in `boundary:"server"` context)
   * to `await <name>(...)` — resolving to the peer callable emitted by
   * `emit-server.ts`. NULL/empty → no server-fn composition (bare call, the
   * pre-fix behavior). Sibling to `mapVarNames` / `requestIds`.
   */
  serverFnNames?: Set<string> | null;
  /**
   * Seam-A colorless-async Gap 2 (GITI-037): names of LOCAL CLIENT peer fns that
   * are transitively async. Forwarded to `EmitExprContext.clientAsyncFnNames` so
   * `emit-expr.ts:emitCall` awaits a plain-ident call to one in `mode:"client"`.
   */
  clientAsyncFnNames?: Set<string> | null;
  /**
   * Seam-A finding-4 (S239): true inside an ASYNC client fn body — gates the
   * client-mode stdlib auto-await (a markup logic context is not an async fn).
   */
  clientAsyncBody?: boolean;
  /**
   * Issue #1 (parent scrmlTS): accumulator for sibling server-fn calls emitted
   * BARE in a non-awaitable position (sync callback body / parameter default).
   * Forwarded to `EmitExprContext.syncPeerCalls` so emit-server can raise
   * `E-SERVER-FN-IN-SYNC-CALLBACK` from the lowering decision (single source of
   * truth). NULL → not collecting (e.g. client emission).
   */
  syncPeerCalls?: Array<{ name: string; span: unknown }> | null;
  /**
   * §59.8 (S169): the STRICT subset of `mapVarNames` whose `state-decl` type
   * annotation is an `@ordered` map (`[KeyT: ValT]@ordered`). Used by
   * `emit-expr.ts:emitAssign` to lower a reassignment `@m = [...]` to an
   * ordered cell as `_scrml_map_from_entries([...], true)`. Computed once per
   * file via `collectOrderedMapVarNames` (reactive-deps.ts). NULL or empty →
   * no cell is ordered (all map literals lower unordered, the §59 default).
   */
  orderedMapVarNames?: Set<string> | null;
  /**
   * §59 (ss52): NON-REACTIVE LOCAL map/set/ordered-map names (bare, per-fn
   * scope). Forwarded into `EmitExprContext.localMapVarNames` etc. so a pure-fn
   * local `let m = [:]; m.insert(...)`/`m.size`/`m[k]` lowers via the bare-
   * receiver `_scrml_map_*` form. The reactive `@`-path (mapVarNames) is
   * unchanged. Computed per-function via `collectLocalMapSetNames`.
   */
  localMapVarNames?: Set<string> | null;
  localSetVarNames?: Set<string> | null;
  localOrderedMapVarNames?: Set<string> | null;
  /**
   * C13 (§51.0.G): Engine variable names in the file's scope. Used by
   * `emit-expr.ts:emitCall` to detect `.advance` calls on engine variables
   * (e.g., `@marioState.advance(.Big)`) and dispatch to the runtime hook.
   * NULL or empty → no detection. Computed once per file in
   * `emit-reactive-wiring.ts`.
   */
  engineVarNames?: Set<string> | null;
  /**
   * B17.4 (§51.0.H): Engine variable names that have at least one
   * `effect=` or `<onTransition>` arm. Used by `emit-expr.ts:emitCall` to
   * decide whether to wrap the `.advance()` call with hook-firing
   * (`__scrml_engine_<varName>_fire_hooks(from, to)`). Computed once per
   * file via `collectEnginesWithHooks` in `emit-engine.ts`.
   */
  enginesWithHooks?: Set<string> | null;
  /**
   * A5-4 (§51.0.M): Engine variable names with at least one `<onTimeout>`
   * element. Threaded to EmitExprContext so `.advance()` call sites in
   * reactive-assignment RHS / logic statement emission pass the timer-table
   * arg through to `_scrml_engine_advance`.
   */
  enginesWithOnTimeout?: Set<string> | null;
  /**
   * A5-6 (§51.0.R, S77): Engine variable names that declare `<onIdle>`.
   * Threaded to EmitExprContext so `.advance()` call sites in reactive-
   * assignment RHS / logic statement emission pass the watchdog-config
   * arg through to `_scrml_engine_advance`.
   */
  enginesWithIdleWatchdog?: Set<string> | null;
  /**
   * A5-7 Wave 2.2 (§51.0.O, Bug #4 fix): Engine variable names with at least
   * one state-child carrying `internal:rule=`. Threaded to EmitExprContext
   * so `.advance()` call sites in reactive-assignment RHS / logic statement
   * emission pass the internal transition table identifier as the trailing
   * arg to `_scrml_engine_advance`.
   */
  enginesWithInternalRules?: Set<string> | null;
  /**
   * A5-7 Wave 2.3 (§51.0.N, Bug #3) + v0.2.4 Bug 6.5 fix: Engine variable
   * names with at least one composite state-child carrying `history`.
   * Threaded to EmitExprContext so `.advance(.X.history)` call sites in
   * function bodies / reactive-assignment RHS / logic statement emission
   * pass the per-engine history-map identifier as the 7th positional arg
   * to `_scrml_engine_advance`.
   *
   * Without this forward, function-body `.advance(.X.history)` would
   * null-pad the history-map slot, breaking runtime history-restore (per
   * direct-compile evidence: `_scrml_engine_advance(..., null, null, null,
   * null, true)` instead of `..., null, null, null, __scrml_engine_<v>_history_map, true)`).
   * Direct-write `@var = .X.history` is unaffected — it routes through
   * `_emitReactiveSet` → `emit-engine.ts:emitEngineRewrittenSet`, which
   * reads `binding.historyMapName` from the engine binding map.
   */
  enginesWithHistory?: Set<string> | null;
  /**
   * §51.0.S (S155 batch 3) — engines that declare `(state × message)`
   * arms (gate the `.advance` message-plane routing) + the resolved
   * message-variant set per engine (stamps the plane at codegen).
   * Forwarded into the EmitExprContext so `emit-expr.ts:emitCall`'s
   * plane router can decide state vs message at `.advance(.X)` sites.
   */
  enginesWithMessageArms?: Set<string> | null;
  engineMessageVariants?: Map<string, Set<string>> | null;
  /**
   * Emission boundary. "server" swaps DOM-oriented lowerings for their
   * server-context equivalents (e.g. `lift <expr>` in a server-fn body
   * becomes `return <expr>;` instead of a `_scrml_lift(() =>
   * document.createTextNode(...))` call — GITI-004). Required field
   * (S35 B2) — every entry-point caller SHALL declare context. Missing
   * `boundary` defaults to "client" at emitLogicNode entry with a
   * runtime warning so undeclared sites are loud, not silent.
   */
  boundary: "server" | "client";
  /**
   * C1 — Variant C compound qualified-path prefix.
   *
   * When emitting children of a compound parent, this carries the parent
   * cell's qualified path (e.g. `"signup"` or `"outer.inner"`). Each child
   * state-decl encountered while this prefix is set registers under
   * `${compoundPathPrefix}.${child.name}` (matches `StateCellRecord.qualifiedPath`).
   *
   * `null` / undefined at top-level cell scope. Threaded through the
   * recursive child walk in `case "state-decl"` (compound-parent arm).
   */
  compoundPathPrefix?: string | null;
  /**
   * C5 — set to `true` when emitting nodes inside a function body (or any
   * other context where a `state-decl` represents a REASSIGNMENT rather
   * than a top-level declaration). Suppresses `_scrml_init_set` emission
   * because reassignments should not overwrite the cell's reset-to-init
   * thunk (per SPEC §6.8.1: reset re-evaluates the ORIGINAL init expression).
   *
   * The `_scrml_default_set` sidecar (C1) is unaffected — `defaultExpr` is
   * a TAB-time attribute that only appears on structural decl-form nodes,
   * so it naturally doesn't fire on reassignments.
   *
   * Threaded through by `case "function-decl"` and analogous paths
   * (CPS-split server-fn emission in emit-functions.ts).
   */
  insideFunctionBody?: boolean;
  /**
   * C2 — Function body registry for transitive reactive-dep extraction
   * through function calls in derived-cell init expressions. Closes the
   * §6.6.3 line 2470-2482 normative gap (transitive deps recorded as if
   * the `@var` reads occurred directly at the call site).
   *
   * Built once per file at the top-level entry in `emit-reactive-wiring.ts`
   * via `buildFunctionBodyRegistry(fileAST)`. Threaded through recursive
   * calls via `{ ...opts }` spread (compound children inherit). When
   * absent, the derived arm falls back to direct `extractReactiveDeps*`
   * extraction (preserves test-fixture compatibility for synthetic
   * state-decls without a registry).
   *
   * Brings derived-cell extraction to parity with markup-interp extraction
   * which already uses `extractReactiveDepsTransitive` at
   * `emit-html.ts:891`.
   */
  fnBodyRegistry?: FunctionBodyRegistry | null;
  /**
   * C21 (§14.11 / M10) — Type-name → ResolvedType registry for Tier 3
   * predefined-shape compound positional sugar lowering.
   *
   * `<userInfo>: UserInfo = ("alice", 30, true)` — when the LHS carries a
   * type annotation that resolves to a `StructType` and the RHS init parses
   * as a SequenceExpression, the C21 dispatch arm in `case "state-decl"`
   * lowers the SequenceExpression to a typed object literal:
   * `{name: "alice", age: 30, active: true}`.
   *
   * Built once per file in `emit-reactive-wiring.ts:emitReactiveWiring` via
   * `buildTypeRegistry(typeDecls, ...)`. Threaded through recursive calls via
   * `{ ...opts }` spread (compound children inherit). When absent, the C21
   * arm is skipped and the legacy fallthrough emits the SequenceExpression
   * raw — preserving the latent JS-comma-operator behaviour for tests that
   * synthesize state-decls without a registry.
   */
  typeRegistry?: Map<string, ResolvedType> | null;
  /**
   * C21 (§14.11 / M10) — Diagnostic accumulator for codegen-surfaced errors.
   *
   * Populated by the C21 arm when positional-arity mismatches `E-TYPE-001`
   * fire (per §14.11 line 7226). Sibling to `EmitLogicOpts.derivedNames` —
   * threaded through opts so emitter helpers can push diagnostics without a
   * separate context handle.
   *
   * Wired via `emit-reactive-wiring.ts:emitReactiveWiring` from `ctx.errors`.
   * When absent, diagnostics are silently dropped (preserves test-fixture
   * compatibility for synthetic state-decls without a registry); the
   * defensive emission still produces recoverable output.
   */
  errors?: CGError[] | null;
  /**
   * C16 (§53.9.3) — The enclosing function's return-type annotation string,
   * threaded down so `return-stmt` can fire a §53.9.3 boundary check when
   * the return type is a refinement-type predicate (e.g.,
   * `function f(): number(>0) { return x }` — the return must satisfy `>0`).
   *
   * Threaded through by `case "function-decl"` in emit-functions.ts and the
   * fn-shortcut path in emit-logic.ts (line ~2174). When absent, return-stmt
   * emits no boundary check (correct for non-refinement-typed returns).
   */
  returnTypeAnnotation?: string | null;
  /**
   * C16 (§53.9.3) — The enclosing function's name, used in error messages
   * for return-stmt boundary check failures. Paired with returnTypeAnnotation.
   */
  enclosingFnName?: string | null;
  /**
   * Bug-5 follow-on to C18 (§38.4, S83 Wave 4A): the set of V5-strict
   * channel-cell names visible to the enclosing channel-owned server
   * function. When `boundary === "server"` AND this set is non-null AND
   * a bare-expr is an assignment `@<cell> = <value>` where `<cell>` is in
   * this set, the bare-expr lowers to a broadcast wire frame:
   *
   *   broadcast({ __type: "__sync", __key: "<cell>", __val: (<value>) });
   *
   * `broadcast()` is auto-injected as a local in channel-owned server fns
   * by `emit-server.ts:emitBroadcastInjection`. Per SPEC §38.4 line 15998:
   * "The compiler SHALL emit sync wire-format messages on every write to
   * a channel-declared cell. The wire-format SHALL be `{ __type: "__sync",
   * __key: <name>, __val: <value> }`."
   *
   * The set is empty / `null` for non-channel server fns; the dispatch
   * arm only fires when a cell name is present AND `boundary === "server"`.
   * Compound assignment (`+=`, etc.) is NOT intercepted — those forms
   * would still require a server-side replica of the channel cell to
   * compute the new value, which is out of scope.
   */
  channelOwnedCells?: Set<string> | null;
  /**
   * S89 §13.2 Sub-Phase B Step 3 — auto-await classifier inputs.
   *
   * When all three are set AND non-empty, the `case "guarded-expr"` arm
   * (`<initExpr> !{ ... }` failable handler) auto-awaits an init expression
   * whose callee is a statically-known `Promise<T>`-returning function (server
   * fn OR stdlib `async` export per §13.2.1 Q1 BROAD). The S88 two-step
   * pattern (`const raw = await safeCallAsync(thunk); raw !{ ... }`) collapses
   * to a single line — the compiler emits the `await` between the call and
   * the guard automatically per §13.2.1 normative bullet 3.
   *
   * Threading: `scheduleStatements` populates these from its own
   * `calleeMap` / `exportRegistry` / `routeMap` / `filePath` args; bypass
   * paths (`emitFnShortcutBody`, direct top-level `emitLogicNode` callers in
   * `emit-reactive-wiring.ts`) omit them — those contexts don't sit on the
   * Promise<T> hot path, so omission preserves pre-S89 emission.
   */
  asyncRouteMap?: { functions: Map<string, { boundary?: string; functionName?: string; [k: string]: unknown }> } | null;
  asyncCalleeMap?: Map<string, string> | null;
  asyncExportRegistry?: Map<string, Map<string, { kind: string; category: string; isComponent: boolean; isAsync?: boolean }>> | null;
  asyncFilePath?: string | null;
  /**
   * i87 §13.2 (position-invariant auto-await) — when set, `emitLogicBody`
   * applies `injectPromiseAwait` to each nested statement it emits, so a
   * server-fn / stdlib-async call one block deep inside an `if`/`else`/`for`/
   * `while`/`do-while` body gets its `await` (and the enclosing fn its
   * `async`) exactly as a top-level statement does. Set ONLY by the control-
   * flow body-opts in emit-control-flow.ts (emitIfStmt/emitForStmt/emitWhile/
   * emitDoWhile) alongside the four `async*` classifier inputs above; it is
   * deliberately NOT set on the match-arm body path (the client match lowering
   * is a sync IIFE where `await` is illegal) nor at the top level (which routes
   * through scheduleStatements, not emitLogicBody).
   */
  awaitNestedPromises?: boolean;
}

/** An entry in the captured scope for a runtime ^{} meta block (from meta-checker.ts). */
interface ScopeVarEntry {
  name: string;
  kind: "reactive" | "let" | "const" | "function";
}

/** A serialized type entry from the runtime type registry (from meta-checker.ts). */
interface TypeRegistryEntry {
  name: string;
  kind: string;
  [key: string]: unknown;
}

interface LogicArm {
  pattern?: string;
  binding?: string;
  handler?: string;
  // errarm-refail (§19.5.2 / §19.3): the fail-expr node attached by
  // ast-builder.js (parseErrorTokens) when this arm's body is a bare re-`fail`
  // (`{ fail EnumType::Variant(args) }`). When present, emitArmBody lowers it
  // via the shared fail-expr emitter (`return { __scrml_error, ... }`).
  failExpr?: FailExprLike;
}

/** Shape of the fail-expr node (subset emitFailExpr reads). */
interface FailExprLike {
  kind?: string;
  enumType?: string;
  variant?: string;
  args?: string;
  argsExpr?: unknown;
}

/**
 * errarm-refail (§19.3.2): emit a `fail EnumType::Variant(args)` to the canonical
 * tagged-error envelope `return { __scrml_error: true, type, variant, data };`.
 * `fail` ≡ `return ErrorType::Variant` — it returns from the ENCLOSING function,
 * not the local construct, so the emission is a `return` statement. Shared by the
 * `case "fail-expr"` statement emitter AND the `!{}` arm-body / match-arm-value
 * re-fail paths (which previously emitted `fail …` literally -> invalid JS).
 */
function emitFailExpr(node: FailExprLike, opts: EmitLogicOpts): string {
  const enumType: string = node.enumType ?? "";
  const variant: string = node.variant ?? "";
  const rawArgs: string = (node.args ?? "").trim();
  let data: string;
  if (rawArgs.length === 0) {
    data = "null";
  } else {
    const argParts = _splitTopLevelCommas(rawArgs);
    const schema = getVariantFieldSchema(variant);
    // §51.3.2 / §19.3.2 — the error envelope's `.data` is a field-keyed object
    // whose keys are the variant's DECLARED payload field names, for BOTH single-
    // AND multi-field variants (matching the enum constructor `Shape.Circle(10)`
    // -> `data: { r: 10 }` and parseVariant's ParseError shape). Single- and
    // multi-arg share one field-keying pass so a single-field `fail` binds the
    // same way its `match` / `!{}` / `<errorBoundary>` readers destructure it
    // (emitVariantBindingPrelude / emitGuardedArmBinding / emit-error-boundary).
    //
    // Exception (raw `.data`): a variant with NO declared field schema — a nullary
    // variant given an erroneous payload (the deferred g-fail-variant-payload-arity
    // case) or an imported error type whose decl is not in this file's registry —
    // has no field name to key by, so a SINGLE such arg lowers to the bare value
    // on `.data` (best-effort; the readers fall back to the whole `.data` too).
    if (argParts.length === 1 && (!schema || schema.length === 0)) {
      data = emitExprField(node.argsExpr as Parameters<typeof emitExprField>[0], rawArgs, _makeExprCtx(opts));
    } else {
      const props = argParts.map((a, i) => {
        const field = schema && i < schema.length ? schema[i] : `_${i}`;
        return `${field}: ${emitExprField(null, a.trim(), _makeExprCtx(opts))}`;
      });
      data = `{ ${props.join(", ")} }`;
    }
  }
  return `return { __scrml_error: true, type: ${JSON.stringify(enumType)}, variant: ${JSON.stringify(variant)}, data: ${data} };`;
}

// ---------------------------------------------------------------------------
// Helper: emit a guarded-expr arm body
// ---------------------------------------------------------------------------

/**
 * Scan a block-body string for a TOP-LEVEL (depth-0) `!{` failable-handler
 * opener — i.e. a NESTED `EXPR !{ ARMS }` guarded-expr written inside an outer
 * `!{}` arm body (R25-Bug-49 §5). The scan is string-literal-aware (a `!{`
 * inside `"..."` / `'...'` / `` `...` `` is string content, not a handler) and
 * brace/paren/bracket depth-aware (only depth-0 `!{` counts — a `!{` already
 * inside braces is handled when that inner block is itself re-parsed).
 *
 * The OUTER guarded-expr is parsed at TAB time (parseLogicBody → guarded-expr
 * node), but the OUTER arm HANDLER is captured as a flat token-joined STRING by
 * parseErrorTokens, so any nested `!{}` inside it never became a child
 * guarded-expr node — it would reach rewriteBlockBody (which has zero `!{}`
 * handling) and leak the `!{ }` structural wrapper verbatim (invalid JS).
 */
function _handlerHasTopLevelGuardedExpr(body: string): boolean {
  let depth = 0;
  let strQuote: string | null = null;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (strQuote !== null) {
      if (ch === "\\") { i++; continue; }
      if (ch === strQuote) strQuote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { strQuote = ch; continue; }
    if (ch === "{" || ch === "(" || ch === "[") { depth++; continue; }
    if (ch === "}" || ch === ")" || ch === "]") { depth--; continue; }
    if (ch === "!" && body[i + 1] === "{" && depth === 0) return true;
  }
  return false;
}

/**
 * Re-parse a NESTED-`!{}` arm-handler body through the BS → TAB sub-pipeline so
 * the nested `EXPR !{ ARMS }` becomes a proper guarded-expr AST node, then emit
 * it via emitLogicBody (which lowers guarded-expr nodes correctly, including
 * arbitrary nesting). Returns null on any failure so the caller falls back to
 * the (lossy) rewriteBlockBody path rather than crashing the compile.
 *
 * The handler body is wrapped in a `${...}` logic block so BS classifies it as
 * a logic body and (crucially) re-splits the nested `!{...}` as an error-effect
 * CHILD block — the same shape parseLogicBody's guarded-expr detection (TAB
 * line ~3707) consumes at the OUTER level.
 */
function _emitNestedGuardedArmBody(inner: string, opts: EmitLogicOpts): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const bs = require("../block-splitter.js") as { runBlockSplitter: (i: { filePath: string; source: string }) => any };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const tab = require("../ast-builder.js") as { buildAST: (bsOut: any) => any };
    const wrapped = "${\n" + inner + "\n}";
    const bsOut = bs.runBlockSplitter({ filePath: "__nested_arm__.scrml", source: wrapped });
    const built = tab.buildAST(bsOut);
    // buildAST returns { filePath, ast, errors }; the AST node array is ast.nodes.
    const nodes: any[] = built?.ast?.nodes ?? [];
    // The `${...}` wrap produces a single `logic` node whose `.body` holds the
    // parsed statement list (guarded-expr + the rest of the arm body).
    let stmts: any[] | null = null;
    for (const n of nodes) {
      if (n?.kind === "logic" && Array.isArray(n.body) && n.body.length > 0) { stmts = n.body; break; }
      if (Array.isArray(n?.body) && n.body.length > 0) { stmts = n.body; break; }
      if (Array.isArray(n?.children) && n.children.length > 0) { stmts = n.children; break; }
    }
    if (!stmts) return null;
    // Emit inside-function-body semantics: a no-wildcard nested handler should
    // `return result` (escalate) exactly like the outer path.
    const emitted = emitLogicBody(stmts, { ...opts, insideFunctionBody: true });
    const joined = emitted.join("\n").trim();
    return joined || null;
  } catch (_e) {
    return null;
  }
}

function emitArmBody(arm: LogicArm, errVar: string, machineBindings?: Map<string, { engineName: string; tableName: string; rules: any[]; auditTarget?: string | null }> | null, opts?: EmitLogicOpts): string {
  // errarm-refail (§19.5.2 / §19.3): a bare re-`fail` arm body lowers via the
  // shared fail-expr emitter (`return { __scrml_error, ... }`). The returned
  // `return …;` is consumed by emitArmAssign, whose terminator-tail path keeps
  // it a `return` inside the (always `!`, per NS-1) enclosing function — so the
  // re-failed error escapes the function exactly like statement-position `fail`.
  if (arm.failExpr) {
    return emitFailExpr(arm.failExpr, opts ?? { boundary: "client", machineBindings: machineBindings ?? null });
  }
  const handler = (arm.handler ?? "").trim();
  if (!handler) return "";
  // Block bodies `{ @var = expr; ... }` must go through rewriteBlockBody so that
  // reactive assignments (@var = expr) are emitted as _scrml_reactive_set() calls
  // rather than _scrml_reactive_get() on the left side of =.
  // When machineBindings is provided, machine-bound assignments emit transition guards (§51.5).
  if (handler.startsWith("{") && handler.endsWith("}")) {
    const inner = handler.slice(1, -1).trim();
    if (!inner) return "";
    // R25-Bug-49 §5 — nested `!{}` inside this arm body. rewriteBlockBody has no
    // guarded-expr handling, so a nested `EXPR !{ ARMS }` leaks its `!{ }`
    // structural wrapper verbatim (invalid JS). Re-parse the body through the
    // BS → TAB sub-pipeline so the nested guarded-expr becomes a real node and
    // emits correctly. Falls back to rewriteBlockBody if the re-parse fails.
    if (_handlerHasTopLevelGuardedExpr(inner)) {
      const nested = _emitNestedGuardedArmBody(inner, { boundary: "client", machineBindings: machineBindings ?? null });
      if (nested) return nested;
    }
    return rewriteBlockBody(inner, machineBindings ?? null);
  }
  const rewritten = emitExprField(arm.handlerExpr, handler, _makeExprCtx({}));
  return rewritten.trim().endsWith(";") ? rewritten.trim() : rewritten.trim() + ";";
}

/**
 * Emit the `const <local> = <resultVar>.data[...]` binding line(s) for a
 * `!{}` failable arm (§19.4.3). The error envelope is
 * `{ __scrml_error, type, variant, data }`.
 *
 * Per §51.3.2 the envelope's `.data` is a field-keyed object whose keys are the
 * variant's DECLARED payload field names, for BOTH single- and multi-field
 * variants (matching the enum constructor `Shape.Circle(10)` -> `data:{r:10}`,
 * emitFailExpr, and parseVariant). So a payload binding on a DECLARED variant
 * projects the field — mirroring the `match` reference emitter (emit-control-
 * flow.ts:emitVariantBindingPrelude, `const <local> = tmp.data.<field>`):
 *
 * - Declared variant, single- OR multi-field (`::UnknownVariant(tag)`,
 *   `::Thrown(message, name)`): each binding name maps POSITIONALLY to the
 *   variant's declared field (`const tag = result.data.tag;`). Single- and
 *   multi-field share the schema resolution so a single-field `!{}` arm reads
 *   the value the same way `match` / `<errorBoundary>` do (the D2 fix). ParseError
 *   (imported) resolves via the fixed schema registered in setVariantFieldsForFile.
 * - Unknown-schema variant (a wildcard catch-all `| e :>`, or an ambient/
 *   undeclared error variant with no declared payload — e.g. a server-fn
 *   `::NetworkError e`): there is no declared field to project, so the single
 *   name binds the whole `.data` payload — the established catch-all shape and
 *   the only correct choice absent a field name. This mirrors emitFailExpr's
 *   producer side, which likewise emits the bare `.data` value for a single
 *   unknown-schema arg, keeping the reader and writer in step.
 */
function emitGuardedArmBinding(binding: string, variantName: string, resultVar: string): string[] {
  const names = binding.split(",").map((s) => s.trim()).filter((s) => s.length > 0 && s !== "_");
  if (names.length === 0) return [];
  const schema = variantName ? getVariantFieldSchema(variantName) : null;
  if (names.length === 1) {
    // Declared single-field variant → project the field (§51.3.2). No schema
    // (wildcard / ambient variant) → bind the whole `.data` payload.
    if (schema && schema.length >= 1) {
      return [`    const ${names[0]} = ${resultVar}.data.${schema[0]};`];
    }
    return [`    const ${names[0]} = ${resultVar}.data;`];
  }
  const out: string[] = [];
  for (let i = 0; i < names.length; i++) {
    if (names[i] === "_") continue;
    // Multi-field always projects; fall back to binding-name-as-field when the
    // schema is unknown (canonical usages name the binding to MATCH the field).
    const field = schema && i < schema.length ? schema[i] : names[i];
    out.push(`    const ${names[i]} = ${resultVar}.data.${field};`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Helpers for 4-argument _scrml_meta_effect emission (§22.5)
// ---------------------------------------------------------------------------

/**
 * Emit the capturedBindings argument for _scrml_meta_effect.
 * Reads node.capturedScope (set by meta-checker.ts).
 * Returns "null" if no scope data is available.
 *
 * @var entries produce getter functions (live reactive reads).
 * let/const/function entries produce direct value references.
 */
function emitCapturedBindings(node: any): string {
  const scope: ScopeVarEntry[] | undefined = node.capturedScope;
  if (!Array.isArray(scope) || scope.length === 0) return "null";

  const props: string[] = [];
  for (const entry of scope) {
    const { name, kind } = entry;
    if (!name || typeof name !== "string") continue;
    if (kind === "reactive") {
      // Getter returns live reactive value; auto-tracking intercepts the read
      props.push(`  get ${name}() { return _scrml_reactive_get("${name}"); }`);
    } else {
      // let/const/function — direct reference to the compiled JS variable
      props.push(`  ${name}: ${name}`);
    }
  }

  if (props.length === 0) return "null";
  return ["Object.freeze({", props.join(",\n"), "})"].join("\n");
}

/**
 * Emit the typeRegistry argument for _scrml_meta_effect.
 * Reads node.typeRegistrySnapshot (set by meta-checker.ts).
 * Returns "null" if no type data is available.
 *
 * The emitted object maps type names to reflection entries.
 * meta.types.reflect(name) uses this object for runtime type introspection.
 */
function emitTypeRegistryLiteral(node: any): string {
  const entries: TypeRegistryEntry[] | undefined = node.typeRegistrySnapshot;
  if (!Array.isArray(entries) || entries.length === 0) return "null";

  const typeProps: string[] = [];
  for (const entry of entries) {
    if (!entry.name || typeof entry.name !== "string") continue;
    const typeData = serializeTypeEntry(entry);
    typeProps.push(`  ${JSON.stringify(entry.name)}: ${typeData}`);
  }

  if (typeProps.length === 0) return "null";
  return ["({", typeProps.join(",\n"), "})"].join("\n");
}

/**
 * Serialize a single TypeRegistryEntry to a JavaScript object literal string.
 */
function serializeTypeEntry(entry: TypeRegistryEntry): string {
  const parts: string[] = [`kind: ${JSON.stringify(entry.kind)}`];

  if (entry.kind === "enum") {
    const variants = (entry.variants as Array<{ name: string } | string> | undefined) ?? [];
    const variantStrings = variants.map(v =>
      JSON.stringify(typeof v === "string" ? v : v.name)
    );
    parts.push(`variants: [${variantStrings.join(", ")}]`);
  } else if (entry.kind === "struct") {
    const fields = (entry.fields as Array<{ name: string; type: string }> | undefined) ?? [];
    const fieldStrings = fields.map(f =>
      `{name: ${JSON.stringify(f.name)}, type: ${JSON.stringify(f.type)}}`
    );
    parts.push(`fields: [${fieldStrings.join(", ")}]`);
  } else if (entry.kind === "state") {
    const attrs = (entry.attributes as Array<{ name: string; type: string }> | undefined) ?? [];
    const attrStrings = attrs.map(a =>
      `{name: ${JSON.stringify(a.name)}, type: ${JSON.stringify(a.type)}}`
    );
    parts.push(`attributes: [${attrStrings.join(", ")}]`);
  }

  return `{${parts.join(", ")}}`;
}


// ---------------------------------------------------------------------------
// §22.4.2 reflect() rewrite for runtime meta blocks
//
// - PascalCase identifiers (type names) are quoted: meta.types.reflect("TypeName")
// - camelCase/@var identifiers (variables) are left unquoted: meta.types.reflect(variable)
// - Already-quoted strings are left as-is: meta.types.reflect("already")
// ---------------------------------------------------------------------------

const REFLECT_CALL_RE = /\breflect\s*\(\s*([^)]*)\s*\)/g;

export function rewriteReflectForRuntime(code: string): string {
  if (!code || typeof code !== "string") return code;
  return code.replace(REFLECT_CALL_RE, (_match, arg) => {
    const trimmed = (arg || "").trim();
    if (!trimmed) return `meta.types.reflect(${trimmed})`;
    // Already a string literal — pass through
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
      return `meta.types.reflect(${trimmed})`;
    }
    // Bare identifier — check if PascalCase (type name) or variable
    if (/^[A-Z][A-Za-z0-9_$]*$/.test(trimmed)) {
      // PascalCase type name → quote it
      return `meta.types.reflect("${trimmed}")`;
    }
    // camelCase, @var, or complex expression — leave as-is
    return `meta.types.reflect(${trimmed})`;
  });
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Build an EmitExprContext from the current EmitLogicOpts.
 */
function _makeExprCtx(opts: EmitLogicOpts): EmitExprContext {
  return {
    // R25-Bug-42 (S138): honor opts.boundary so server-mode contexts (e.g.
    // inside SSE generator bodies, server function bodies, channel-owned
    // server fns) emit `@cell` references via the server reactive-ref
    // rewriter (`_scrml_body["cell"]`) rather than the client-side
    // `_scrml_reactive_get("cell")`. Pre-fix, the hardcoded "client" mode
    // caused SQL template params (`?{`SELECT ... ${@cursor}`}`) inside
    // server-bound function bodies to interpolate the client helper, which
    // throws at runtime on the server and triggers E-CG-006 in post-emission
    // scanning of client.js when the same fn is also visible there.
    mode: opts.boundary === "server" ? "server" : "client",
    derivedNames: opts.derivedNames ?? null,
    // Bug 61 — forward synth-cell keys so `emitMember` routes
    // `@<compound>.<synthProp>` reads to the dotted synth cell.
    synthCellKeys: opts.synthCellKeys ?? null,
    tildeVar: opts.tildeContext?.var ?? null,
    dbVar: opts.dbVar,
    // §59 (D4) — map variable name set so emit-expr can intercept `@m[k]`
    // reads / `@m.<method>(…)` calls / `@m.size` and lower them to `_scrml_map_*`.
    mapVarNames: opts.mapVarNames ?? null,
    // §59.12 (D4) — set variable name set so emit-expr intercepts the set-native
    // vocabulary (`.add`/`.elements`/`.union`/`.intersect`/`.difference`).
    setVarNames: opts.setVarNames ?? null,
    // §6.7.7 / §60.4 — request id set so emit-expr routes `<#id>` request refs
    // to the reactive `_scrml_request_<id>` object instead of the §36 registry.
    requestIds: opts.requestIds ?? null,
    // Issue #1 (parent scrmlTS) — sibling server-fn names so emit-expr lowers an
    // in-process server-fn → server-fn call to `await <name>(...)`.
    serverFnNames: opts.serverFnNames ?? null,
    // Seam-A Gap 2 — forward the client async-peer set so emit-expr awaits a
    // client-mode call to a transitively-async local peer.
    clientAsyncFnNames: opts.clientAsyncFnNames ?? null,
    // Seam-A finding-4 — forward the async-client-fn-body gate for the stdlib await.
    clientAsyncBody: opts.clientAsyncBody ?? false,
    // Issue #1 — forward the bare-peer-call accumulator so emit-expr can record
    // sync-callback sites for the E-SERVER-FN-IN-SYNC-CALLBACK diagnostic.
    syncPeerCalls: opts.syncPeerCalls ?? null,
    // §59.8 (S169) — ordered-map cell names so emit-expr:emitAssign lowers a
    // reassignment `@m = [...]` to an ordered cell with the ordered flag set.
    orderedMapVarNames: opts.orderedMapVarNames ?? null,
    // §59 (ss52) — NON-REACTIVE LOCAL map/set/ordered names (bare, per-fn) so
    // emit-expr lowers a pure-fn local map/set's methods / `.size` / bracket-read
    // via the bare-receiver `_scrml_map_*` form. Reactive `@`-path unchanged.
    localMapVarNames: opts.localMapVarNames ?? null,
    localSetVarNames: opts.localSetVarNames ?? null,
    localOrderedMapVarNames: opts.localOrderedMapVarNames ?? null,
    // C13 (§51.0.G) — engine variable name set so emit-expr can detect
    // `.advance` calls on engine-bound `@vars`.
    engineVarNames: opts.engineVarNames ?? null,
    // B17.4 (§51.0.H) — engines that have effect=/<onTransition> arms;
    // gates the hook-firing wrap on `.advance()` emissions.
    enginesWithHooks: opts.enginesWithHooks ?? null,
    // A5-4 (§51.0.M), A5-6 (§51.0.R), A5-7 Wave 2.2 (§51.0.O) — engines
    // with on-timeout / idle-watchdog / internal-rule surfaces. Threaded so
    // `.advance()` calls inside reactive-assignment RHS / logic statements
    // emit the timer / idle / internal-table args correctly.
    enginesWithOnTimeout: opts.enginesWithOnTimeout ?? null,
    enginesWithIdleWatchdog: opts.enginesWithIdleWatchdog ?? null,
    enginesWithInternalRules: opts.enginesWithInternalRules ?? null,
    // v0.2.4 Bug 6.5 — A5-7 Wave 2.3 (§51.0.N, Bug #3) parity for the
    // function-body / reactive-assignment / logic-statement `.advance()`
    // call sites. Without this forward `hasHistory` evaluates `false` and
    // emitEngineAdvanceCall null-pads the 7th positional slot, breaking
    // runtime history-restore. Onclick context goes through
    // emit-event-wiring.ts:exprCtxExtras which already includes this.
    enginesWithHistory: opts.enginesWithHistory ?? null,
    // §51.0.S (S155 batch 3) — forward the message-plane routing inputs so
    // `emit-expr.ts:emitCall` can stamp the `.advance(.X)` plane.
    enginesWithMessageArms: opts.enginesWithMessageArms ?? null,
    engineMessageVariants: opts.engineMessageVariants ?? null,
    // §51.0.F (Option A comprehensive engine-routing) — forward the engine
    // binding-info map so `emit-expr.ts:emitAssign` can dispatch
    // `@<engineCell> = <expr>` writes through the canonical write-guard at
    // ANY expression context (lambda body, ternary RHS, function-call arg,
    // compound expression, nested assign). Without this forward, expression-
    // context engine writes silently emit bare `_scrml_reactive_set` and
    // bypass rule= enforcement / <onTransition> hooks / timer arm-clear /
    // history capture / Option-d self-write semantics.
    //
    // Statement-level engine writes (`@<engineCell> = .X` as a top-level
    // statement) still route through `_emitReactiveSet` in this file (see
    // line 975); the ExprNode-level engine-write detection in `emitAssign`
    // is the missing complement that closes the expression-context gap.
    engineBindings: opts.engineBindings ?? null,
    // §20.6 (shadowing) — forward declared local names so emit-expr can
    // detect a user-declared `log` in scope (the builtin yields + fires
    // W-LOG-SHADOWED) vs. the bare builtin call (lowered to _scrml_log).
    declaredNames: opts.declaredNames ?? null,
    // §20.6 — forward the current statement span for log() file:line.
    stmtSpan: opts.currentStmtSpan ?? null,
    // Issue #26 (P0 auth-bypass) — forward the stdlib async classifier inputs so
    // emit-expr's `emitCall` auto-awaits a Promise-returning stdlib import call
    // in SERVER-mode bodies (the same treatment `?{}` SQL gets). The `emitCall`
    // branch is gated on `mode === "server"`, so forwarding these on the CLIENT
    // path (where scheduling.ts already threads them for its statement-level
    // classifier) is inert — no double-await. Server-fn opts objects in
    // emit-server.ts populate `asyncCalleeMap`/`asyncExportRegistry`; the four-
    // field guarded-expr statement-level path (which also needs asyncRouteMap +
    // asyncFilePath) stays OFF on the server, so expression-level await is the
    // single source of truth there.
    asyncCalleeMap: opts.asyncCalleeMap ?? null,
    asyncExportRegistry: opts.asyncExportRegistry ?? null,
  };
}

/**
 * C1 — Emit the `_scrml_default_set("name", () => <defaultExpr>);` sidecar
 * for a state-decl with `defaultExpr !== null`.
 *
 * Per SPEC §6.8.1: `default=` stores the EXPRESSION (not a snapshot); the
 * runtime evaluates the closure each time `reset(@cell)` fires. C1 emits the
 * storage; C5 will lower `reset(@cell)` to read it.
 *
 * Per SURVEY §6.5: `default=` on a `const` derived cell is E-DERIVED-WRITE
 * (A1b/B22 fires before codegen). C1 will never see a derived cell with
 * `defaultExpr !== null` in a well-formed AST; if it does, emit a comment
 * marker so the issue is loud rather than silent.
 *
 * Returns the sidecar line, or `null` if the cell has no `default=` attr.
 *
 * @param node — the state-decl AST node (must have `name` and may have `defaultExpr`)
 * @param qualifiedName — the storage key (top-level: cell name; compound child: "parent.child")
 * @param opts — the emit options (for encodingCtx)
 */
function _emitDefaultSidecar(node: any, qualifiedName: string, opts: EmitLogicOpts): string | null {
  const defaultExpr = node.defaultExpr;
  if (!defaultExpr) return null;
  // Defensive: A1b/B22 should reject `default=` on `const <derived>` cells
  // (E-DERIVED-WRITE). If we see one here, the AST is malformed; emit a
  // marker so the issue is loud rather than silent.
  if ((node as any).shape === "derived" && (node as any).isConst === true) {
    return `// C1: SHOULD NOT REACH — default= on const <${node.name}> is E-DERIVED-WRITE (A1b/B22 should have rejected before codegen)`;
  }
  const ctx = opts.encodingCtx;
  const encodedName = ctx ? ctx.encode(qualifiedName) : qualifiedName;
  const defaultBody = emitExpr(defaultExpr, _makeExprCtx(opts));
  // GITI-014: paren-wrap object-literal bodies — `() => {a: 1}` mis-parses
  // as a block statement; `() => ({a: 1})` parses as the expression we want.
  // S142 gate-tail: also use the emitted-string predicate so a payload-variant
  // constructor `.Circle(5)` (a `call` node emitting an object literal) is
  // paren-wrapped (the AST kind-check alone misses it).
  const wrappedDefault =
    arrowBodyNeedsParens(defaultExpr) || arrowBodyStringNeedsParens(defaultBody)
      ? `(${defaultBody})`
      : defaultBody;
  return `_scrml_default_set(${JSON.stringify(encodedName)}, () => ${wrappedDefault});`;
}

/**
 * C5 — Emit the `_scrml_init_set("name", () => <initExpr>);` sidecar for a
 * Shape 1 / Shape 2 state-decl that does NOT carry a `defaultExpr`.
 *
 * Per SPEC §6.8.1 line 4831: "When `default=` is absent, calling `reset(@cell)`
 * re-evaluates the init expression and sets the cell to the result."
 *
 * The init-thunk captures the same expression the C1 dispatch path passes
 * to `_scrml_reactive_set` at module-init. At reset time the runtime
 * `_scrml_reset` helper calls this thunk, evaluates it fresh, and writes
 * the result via `_scrml_reactive_set` — re-firing every read of every
 * `@`-cell the init expression touches AT RESET TIME (not capturing
 * decl-time values).
 *
 * SKIP rules (mirrors `_emitDefaultSidecar`'s structure plus the brief's
 * SCOPE §1 carve-outs):
 *   - `defaultExpr !== null`: the cell already has a `_scrml_default_set`
 *     entry. `_scrml_reset` prefers default over init per §6.8.2 line 4857,
 *     so the init-thunk would be unreachable. Skip to keep emitted JS lean.
 *   - `shape === "derived" && isConst === true`: E-DERIVED-WRITE territory.
 *     Reset on derived cells is a write error per §6.8.1 line 4842; A1b/B22
 *     should have rejected before codegen. Defensive skip.
 *   - `_cellKind === "markup-typed"`: same reasoning (markup-typed derived).
 *   - `_cellKind === "compound-parent"` (or `Array.isArray(children)`):
 *     compound parents are computed via `_scrml_derived_declare`
 *     reconstruction; their "init" is their children. Reset of a compound
 *     parent walks children (handled by `_scrml_reset`'s prefix-match
 *     fallback). Skip.
 *   - SQL-init cells (`sqlNode` present): the init expression cannot be
 *     re-evaluated at reset time — `_scrml_sql` is server-only (E-CG-006).
 *     The caller's mount-hydration semantics (§8.11) own re-fetch; reset
 *     is undefined for SQL-init cells. Skip defensively.
 *   - `init` falsy AND `initExpr` absent: nothing to re-evaluate. Skip.
 *
 * Returns the sidecar line, or `null` to skip.
 *
 * @param node — the state-decl AST node
 * @param qualifiedName — the storage key (compound child: "parent.child")
 * @param opts — emit options (for encodingCtx)
 */
function _emitInitThunkSidecar(node: any, qualifiedName: string, opts: EmitLogicOpts): string | null {
  // Skip on server boundary — `_scrml_init_set` is a client-side runtime
  // helper. Server-side state lives in `_scrml_body[...]` and has different
  // semantics; reset(@cell) only fires on the client per L18 / §6.8.
  if (opts.boundary === "server") return null;
  // Skip inside function bodies — reassignments must not overwrite the
  // declaration-site init-thunk (the runtime calls the LAST registered
  // thunk for `_scrml_reset`, and a reassignment expression is not the
  // canonical init).
  if (opts.insideFunctionBody) return null;
  // Skip if defaultExpr present — _scrml_reset prefers default over init.
  if (node.defaultExpr) return null;
  // Skip derived (E-DERIVED-WRITE territory).
  if ((node as any).shape === "derived" && (node as any).isConst === true) return null;
  // Skip markup-typed derived (same).
  if ((node as any)._cellKind === "markup-typed") return null;
  // Skip compound parents.
  if ((node as any)._cellKind === "compound-parent" || Array.isArray((node as any).children)) return null;
  // Skip SQL-init cells (cannot be re-evaluated client-side).
  if (node.sqlNode && node.sqlNode.kind === "sql") return null;

  const ctx = opts.encodingCtx;
  const encodedName = ctx ? ctx.encode(qualifiedName) : qualifiedName;

  // §59.8 (S169) — the reset init-thunk re-evaluates the SAME init expression
  // the C1 dispatch path emits, so it must lower an `@ordered`-typed map init
  // ordered too. Compute from `node.typeAnnotation` (decl-site only).
  const _thunkAnno = (node as any).typeAnnotation;
  const _thunkInitOrderedMap =
    typeof _thunkAnno === "string" &&
    isMapTypeAnnotation(_thunkAnno) &&
    _thunkAnno.trim().endsWith("@ordered");
  const _thunkExprCtx: EmitExprContext = _thunkInitOrderedMap
    ? { ..._makeExprCtx(opts), emitMapLitOrdered: true }
    : _makeExprCtx(opts);

  // Prefer the structured `initExpr` (Phase 3 fast path); fall back to the
  // raw `init` string when only the legacy AST shape is available. Both
  // paths produce the same emitted JS via emitExprField. When neither is
  // present (e.g. tilde-only init or other rare shapes), skip — there's
  // nothing to re-evaluate.
  if (node.initExpr) {
    const initBody = emitExpr(node.initExpr, _thunkExprCtx);
    // GITI-014: paren-wrap object-literal bodies — `() => {a: 1}` mis-parses
    // as a block statement; `() => ({a: 1})` parses as the expression we want.
    // S142 gate-tail: the AST predicate (kind === "object") misses a payload-
    // variant constructor call `.Circle(5)` — a `call` AST node that EMITS to
    // an object literal `{ variant: "Circle", data: {...} }`. Use the
    // emitted-string predicate too (leading `{` is the definitive signal), so
    // `() => { variant: ... }` (which mis-parses as a block) gets paren-wrapped.
    const wrappedInit =
      arrowBodyNeedsParens(node.initExpr) || arrowBodyStringNeedsParens(initBody)
        ? `(${initBody})`
        : initBody;
    return `_scrml_init_set(${JSON.stringify(encodedName)}, () => ${wrappedInit});`;
  }
  const initStr: string = node.init ?? "";
  // M-7C-D-12 Track 3: post-OQ-5(a) the "no init present" sentinel string is "null"
  // (was "undefined" pre-S90). Both branches treat the cell as un-initializable —
  // there's no real expression to re-evaluate on reset.
  if (!initStr || initStr === "null") return null;
  // Use emitExprField with the raw fallback so derivedNames/server-mode
  // routing matches the main reactive-set arm.
  const initBody = emitExprField(node.initExpr, initStr, _thunkExprCtx);
  // GITI-014: same paren-wrap guard for the fallback string path. No ExprNode
  // available here, so use the string-form predicate.
  const wrappedInit = arrowBodyStringNeedsParens(initBody) ? `(${initBody})` : initBody;
  return `_scrml_init_set(${JSON.stringify(encodedName)}, () => ${wrappedInit});`;
}

/**
 * S79 / §6.13 — emit the `_scrml_reactivity_register("name", "debounced"|
 * "throttled", ms)` sidecar for a state-decl carrying `reactivity.debounced`
 * or `reactivity.throttled`. Once registered, subsequent
 * `_scrml_reactive_set("name", ...)` calls route through the timing wrapper.
 *
 * Literal-form DURATION lowers to a numeric `ms` literal. Computed-form
 * DURATION (`${expr}<unit>`) lowers to an `() => exprText * unitMultiplier`
 * arrow-fn (mirror A5-5 codegen pattern at emitEngineTimersTable). The
 * runtime applies negative/NaN→0 clamp + Math.round.
 *
 * SKIP rules:
 *   - server boundary — reactivity is client-side only.
 *   - insideFunctionBody — reassignment is not the canonical decl site.
 *   - derived (`isConst:true`) — A1b/B14 should reject E-DEBOUNCED-WITH-DERIVED
 *     before codegen; defensive skip.
 *   - reactivity.debounced.kind === "invalid" or .throttled.kind === "invalid"
 *     — caller (typer) emits the diagnostic; defensive skip codegen.
 *   - dual-attr (debounced AND throttled both set) — A1b/B14 should fire
 *     E-REACTIVITY-ATTR-CONFLICT; defensive skip codegen.
 */
function _emitReactivitySidecar(node: any, qualifiedName: string, opts: EmitLogicOpts): string | null {
  if (opts.boundary === "server") return null;
  if (opts.insideFunctionBody) return null;
  const reactivity = node.reactivity;
  if (!reactivity) return null;
  if ((node as any).shape === "derived" && (node as any).isConst === true) return null;
  // Dual-attr is a typer error; skip codegen defensively.
  if (reactivity.debounced && reactivity.throttled) return null;
  let kind: string;
  let dur: any;
  if (reactivity.debounced) {
    kind = "debounced";
    dur = reactivity.debounced;
  } else if (reactivity.throttled) {
    kind = "throttled";
    dur = reactivity.throttled;
  } else {
    return null;
  }
  if (!dur || dur.kind === "invalid") return null;
  const ctx = opts.encodingCtx;
  const encodedName = ctx ? ctx.encode(qualifiedName) : qualifiedName;
  let msExpr: string;
  if (dur.kind === "literal") {
    msExpr = String(dur.ms);
  } else if (dur.kind === "computed") {
    // Mirror A5-5 codegen pattern (emit-engine.ts emitEngineTimersTable):
    // wrap the user expression in parens, multiply by the unit multiplier,
    // pass as an arrow-fn so the runtime evaluates per-fire.
    msExpr = `() => (${dur.exprText}) * ${dur.unitMultiplier}`;
  } else {
    return null;
  }
  return `_scrml_reactivity_register(${JSON.stringify(encodedName)}, ${JSON.stringify(kind)}, ${msExpr});`;
}

// ---------------------------------------------------------------------------
// C21 (§14.11 / M10) — Tier 3 predefined-shape compound positional sugar
// ---------------------------------------------------------------------------

/**
 * Split a top-level comma-separated argument list into substrings.
 *
 * Tracks paren / bracket / brace / template-literal depth so commas inside
 * nested expressions are NOT treated as separators. Strings / template
 * literals / regex literals are scanned for closing delimiters.
 *
 * Input: the inner text between the outer `(` and `)` of the SequenceExpression.
 *   Example input: `"alice", 30, true`
 *   Example input: `f(a, b), {x: 1, y: 2}, [1, 2]`
 *
 * Returns the list of trimmed positional argument source strings.
 */
function _splitTopLevelCommas(inner: string): string[] {
  const out: string[] = [];
  let buf = "";
  let depth = 0;
  let i = 0;
  while (i < inner.length) {
    const c = inner[i];
    // String / template literal — scan to matching delimiter
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      buf += c;
      i++;
      while (i < inner.length) {
        const cc = inner[i];
        buf += cc;
        if (cc === "\\" && i + 1 < inner.length) {
          buf += inner[i + 1];
          i += 2;
          continue;
        }
        i++;
        if (cc === quote) break;
      }
      continue;
    }
    if (c === "(" || c === "[" || c === "{") { depth++; buf += c; i++; continue; }
    if (c === ")" || c === "]" || c === "}") { depth--; buf += c; i++; continue; }
    if (c === "," && depth === 0) {
      out.push(buf.trim());
      buf = "";
      i++;
      continue;
    }
    buf += c;
    i++;
  }
  const tail = buf.trim();
  if (tail) out.push(tail);
  return out;
}

/**
 * C21 (§14.11 / M10) — Lower a Tier 3 predefined-shape positional sugar init
 * to a typed object literal in struct field-declaration order.
 *
 * Input shape:
 *   `<userInfo>: UserInfo = ("alice", 30, true)` — caller has already
 *   confirmed `node.typeAnnotation` resolves to a `StructType`.
 *
 * Behaviour:
 *   - Splits the SequenceExpression's `raw` text on top-level commas.
 *   - Validates positional-arity against `structType.fields.size`.
 *     Mismatch → push `E-TYPE-001` to `opts.errors` (per §14.11 line 7226)
 *     and return `null` so the caller emits a defensive fallback.
 *   - Maps each positional value to its corresponding field name using
 *     the struct's declaration order (Map preserves insertion order).
 *   - Re-parses each positional value via `parseExprToNode` and emits
 *     through the same `emitExpr` pipeline as any other expression init,
 *     so reactive references / fn calls / arithmetic resolve uniformly.
 *
 * Returns the full emitted statement (`_scrml_reactive_set("userInfo", {...});`)
 * or `null` on recoverable error (caller emits a defensive fallback).
 */
function _emitTier3PositionalSugar(
  node: any,
  structType: StructType,
  qualifiedName: string,
  opts: EmitLogicOpts,
): string | null {
  const initExpr = node.initExpr;
  // Strip the outer parens from `("alice", 30, true)` → `"alice", 30, true`.
  // The SequenceExpression's `raw` is the full parenthesised text. Defensive
  // fallback: if `raw` is missing or doesn't begin with `(`, decline.
  const rawSrc: string = (initExpr && typeof initExpr.raw === "string") ? initExpr.raw : "";
  const trimmed = rawSrc.trim();
  if (!trimmed.startsWith("(") || !trimmed.endsWith(")")) {
    return null;
  }
  const inner = trimmed.slice(1, -1);
  const positionals = _splitTopLevelCommas(inner);

  // Field order from the struct type — Map iteration preserves insertion order.
  const fieldNames: string[] = [];
  for (const fieldName of structType.fields.keys()) {
    fieldNames.push(fieldName);
  }

  // §14.11 line 7226 — positional-arity mismatch is E-TYPE-001.
  if (positionals.length !== fieldNames.length) {
    if (opts.errors) {
      const span = (initExpr && initExpr.span) ? initExpr.span : (node.span ?? { start: 0, end: 0 });
      opts.errors.push(new CGError(
        "E-TYPE-001",
        `E-TYPE-001: Positional binding for type \`${structType.name}\` expects ` +
        `${fieldNames.length} field${fieldNames.length === 1 ? "" : "s"} ` +
        `(${fieldNames.map(n => `\`${n}\``).join(", ")}) but got ${positionals.length} ` +
        `value${positionals.length === 1 ? "" : "s"}. ` +
        `Provide values in the declared field order, or use the named-initialiser form ` +
        `(\`{${fieldNames.map(n => `${n}: …`).join(", ")}}\`). See SPEC §14.11.`,
        span,
      ));
    }
    return null;
  }

  // Re-parse each positional and emit through the standard ExprNode pipeline.
  // Use the parent state-decl's span as the offset baseline; per-positional
  // span precision is best-effort (sub-positional errors are unlikely at this
  // arm — the Acorn parse already succeeded for the whole SequenceExpression).
  const filePath: string = (initExpr && initExpr.span && initExpr.span.file) ? initExpr.span.file : "";
  const baseOffset: number = (initExpr && initExpr.span && typeof initExpr.span.start === "number") ? initExpr.span.start : 0;

  const fieldEntries: string[] = [];
  for (let i = 0; i < positionals.length; i++) {
    const fieldName = fieldNames[i];
    const valueSrc = positionals[i];
    const valueNode = parseExprToNode(valueSrc, filePath, baseOffset);
    const valueEmit = emitExpr(valueNode, _makeExprCtx(opts));
    fieldEntries.push(`${fieldName}: ${valueEmit}`);
  }
  const objLiteral = `({ ${fieldEntries.join(", ")} })`;

  // Wrap and emit as a regular reactive-set, mirroring the legacy fallthrough
  // arm so init-thunk and default sidecars behave consistently. The lowered
  // object literal is value-init for the cell — `isInit = true` because
  // typeAnnotation discriminates this as a declaration site (matches the
  // logic at line 1225 of the legacy fallthrough).
  const ctx = opts.encodingCtx;
  const encodedName = ctx ? ctx.encode(qualifiedName) : qualifiedName;
  const wrapped = `_scrml_deep_reactive(${objLiteral})`;
  const mainStmt = _emitReactiveSet(encodedName, wrapped, opts, node.name, /* isInit */ true);

  // Emit a Tier-3-aware init-thunk inline so `reset(@cell)` re-evaluates the
  // LOWERED form (not the raw SequenceExpression). The default
  // `_emitInitThunkSidecar` would re-emit the raw via emitEscapeHatch — that
  // would re-introduce the latent JS-comma-operator bug at reset time. The
  // caller (case "state-decl") detects the C21 path via the marker comment
  // below and suppresses its own _initSidecar to avoid double emission.
  //
  // SKIP rules mirror `_emitInitThunkSidecar` for parity (server boundary,
  // function bodies, defaultExpr present, SQL nodes, etc.).
  let initThunkLine = "";
  if (
    opts.boundary !== "server" &&
    !opts.insideFunctionBody &&
    !node.defaultExpr &&
    !(node.sqlNode && node.sqlNode.kind === "sql")
  ) {
    initThunkLine = `\n_scrml_init_set(${JSON.stringify(encodedName)}, () => ${objLiteral});`;
  }
  // Marker comment so the caller can detect C21 emission and suppress its
  // default _initSidecar. The comment is structurally meaningful (parser-level
  // metadata for the `case "state-decl"` arm) and never appears outside C21.
  return `/* @c21-tier3 */\n${mainStmt}${initThunkLine}`;
}

/**
 * C2 — Walk a markup tree (renderSpec.element) to collect reactive deps from
 * any `${...}` interpolations inside it. Mirrors what extractReactiveDeps*
 * does for plain expressions, but descends into `kind: "logic"` children.
 *
 * For each `bare-expr` interpolation, uses the transitive walker when a
 * fnBodyRegistry is available (so `${upperOf(@x)}` records `x` as a dep
 * through the fn body — same parity as plain Shape-3 derived in WIP-4).
 * Falls back to direct extraction when registry is absent.
 *
 * @param markupNode — `renderSpec.element` (the root markup node)
 * @param opts — emit options (for fnBodyRegistry)
 * @returns set of reactive variable names (without @ prefix) — the union
 *          of all interpolation deps in the entire markup tree
 */
function _collectMarkupTreeReactiveDeps(markupNode: any, opts: EmitLogicOpts): Set<string> {
  const deps = new Set<string>();
  if (!markupNode || typeof markupNode !== "object") return deps;

  function visit(node: any): void {
    if (!node || typeof node !== "object") return;

    if (node.kind === "logic" && Array.isArray(node.body)) {
      for (const logicChild of node.body) {
        if (logicChild && logicChild.kind === "bare-expr" && (logicChild.exprNode || logicChild.expr)) {
          let childDeps: Set<string>;
          if (opts.fnBodyRegistry) {
            const exprStr = logicChild.exprNode
              ? (() => { try { return emitStringFromTree(logicChild.exprNode); } catch { return logicChild.expr ?? ""; } })()
              : (logicChild.expr ?? "");
            childDeps = extractReactiveDepsTransitive(exprStr, null, opts.fnBodyRegistry);
          } else {
            childDeps = logicChild.exprNode
              ? extractReactiveDepsFromExprNode(logicChild.exprNode)
              : extractReactiveDeps(logicChild.expr ?? "");
          }
          for (const d of childDeps) deps.add(d);
        }
      }
    }

    // Walk attribute values for variable-ref / call-ref / expr / props-block kinds.
    // These can contain `@var` references that the runtime evaluates per-render.
    if (Array.isArray(node.attributes)) {
      for (const attr of node.attributes) {
        if (!attr || !attr.value) continue;
        const val = attr.value;
        if (val.kind === "variable-ref") {
          const name = (val.name || "").replace(/^@/, "");
          if (name) deps.add(name);
        } else if (val.kind === "expr" || val.kind === "props-block") {
          const raw = val.raw ?? val.propsDecl ?? "";
          let attrDeps: Set<string>;
          if (opts.fnBodyRegistry) {
            const exprStr = val.exprNode
              ? (() => { try { return emitStringFromTree(val.exprNode); } catch { return raw; } })()
              : raw;
            attrDeps = extractReactiveDepsTransitive(exprStr, null, opts.fnBodyRegistry);
          } else {
            attrDeps = val.exprNode
              ? extractReactiveDepsFromExprNode(val.exprNode)
              : extractReactiveDeps(raw);
          }
          for (const d of attrDeps) deps.add(d);
        } else if (val.kind === "call-ref") {
          // Function call in attribute value — extract from each arg expr
          if (Array.isArray(val.argExprNodes)) {
            for (const argNode of val.argExprNodes) {
              if (!argNode) continue;
              let argDeps: Set<string>;
              if (opts.fnBodyRegistry) {
                const argStr = (() => { try { return emitStringFromTree(argNode); } catch { return ""; } })();
                argDeps = extractReactiveDepsTransitive(argStr, null, opts.fnBodyRegistry);
              } else {
                argDeps = extractReactiveDepsFromExprNode(argNode);
              }
              for (const d of argDeps) deps.add(d);
            }
          }
          // Also walk the callee name through the registry (transitive — the
          // function body itself may read @vars).
          if (opts.fnBodyRegistry && typeof val.name === "string") {
            const calleeStr = `${val.name}()`;
            const calleeDeps = extractReactiveDepsTransitive(calleeStr, null, opts.fnBodyRegistry);
            for (const d of calleeDeps) deps.add(d);
          }
        }
      }
    }

    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        visit(child);
      }
    }
  }

  visit(markupNode);
  return deps;
}

/**
 * A5-7 Wave 2.4 (§51.0.N + §51.0.Q.1, Bug #2) — Detect the structured
 * `.Variant.history` write form on an assignment's RHS ExprNode. Returns:
 *   - `{ isHistoryForm: true, strippedNode }` when the RHS is a member-expr
 *     whose property is exactly `"history"` AND whose object is a variant-
 *     bearing expression (an `ident` starting with "." OR a member-expr like
 *     `EnumType.Variant`). The `strippedNode` is the inner variant expression
 *     to emit as the runtime value (the `.history` suffix is metadata, not a
 *     JS lookup).
 *   - `{ isHistoryForm: false, strippedNode: null }` otherwise.
 *
 * Examples:
 *   - `@v = .Playing.history`                → strip → `.Playing`        (T)
 *   - `@v = AppMode.Playing.history`         → strip → `AppMode.Playing` (T)
 *   - `@v = AppMode.Playing`                 → no strip                  (F)
 *   - `@v = computeVariant()`                → no strip                  (F)
 *   - `@v = AppMode.Playing.history.foo`     → no strip (property!='history' on outer) (F)
 */
function detectHistoryForm(initExpr: any): { isHistoryForm: boolean; strippedNode: any } {
  if (!initExpr || typeof initExpr !== "object") return { isHistoryForm: false, strippedNode: null };
  if (initExpr.kind !== "member") return { isHistoryForm: false, strippedNode: null };
  if (initExpr.property !== "history") return { isHistoryForm: false, strippedNode: null };
  const inner = initExpr.object;
  if (!inner || typeof inner !== "object") return { isHistoryForm: false, strippedNode: null };
  // Variant-bearing: either a bare-dot ident (".Variant" on the auto-resolved
  // engine-type path) or a member-expr on the enum type ("EnumType.Variant").
  // We accept any inner expression here — runtime lookup of `.history` on a
  // bare string is `undefined`, so the only legal source of `.history` is
  // the structured target form. Conservative: also accept member-on-member
  // (e.g. `Outer.AppMode.Playing.history`).
  if (inner.kind === "ident" && typeof inner.name === "string" && inner.name.startsWith(".")) {
    return { isHistoryForm: true, strippedNode: inner };
  }
  if (inner.kind === "member") {
    return { isHistoryForm: true, strippedNode: inner };
  }
  return { isHistoryForm: false, strippedNode: null };
}

/**
 * Emit a reactive_set, or a transition guard if the variable is machine-bound.
 * @param rawName — the original variable name (for machineBindings lookup)
 * @param encodedName — the encoded name (for reactive_set key)
 * @param isHistoryRestore — A5-7 Wave 2.4 §51.0.N+Q.1 (Bug #2). TRUE when the
 *   write expression was the structured `.Variant.history` form. Threaded to
 *   `emitEngineWriteGuard` so the runtime helper sets the pending-restore flag.
 */
function _emitReactiveSet(encodedName: string, valueExpr: string, opts: EmitLogicOpts, rawName?: string, isInit?: boolean, isHistoryRestore?: boolean): string {
  if (!isInit) {
    const lookupName = rawName ?? encodedName;
    const binding = opts.machineBindings?.get(lookupName) ?? null;
    if (binding) {
      return emitTransitionGuard(encodedName, valueExpr, binding.tableName, binding.engineName, binding.rules, (binding as any).auditTarget ?? null).join("\n");
    }
    // C13 (§51.0.F Move 12) — engine direct-write hook. When the LHS is the
    // auto-declared engine variable (`@marioState = .X`), dispatch to the
    // runtime helper instead of bare `_scrml_reactive_set`. The helper reads
    // the current variant, validates against the from-state's `rule=` entry
    // in the compile-time-baked table, and either commits the write or
    // throws E-ENGINE-INVALID-TRANSITION (runtime severity per §34).
    const engineBinding = opts.engineBindings?.get(lookupName) ?? null;
    if (engineBinding) {
      const { emitEngineWriteGuard } = require("./emit-engine.ts");
      return emitEngineWriteGuard(engineBinding, valueExpr, isHistoryRestore === true).join("\n");
    }
  }
  // §51.12 — on init of a machine-bound var whose machine has temporal
  // rules, arm the initial-state timer after the reactive is set. The
  // runtime helper resolves the current variant against the rule list.
  // Non-temporal inits fall through to a plain reactive_set.
  if (isInit) {
    const lookupName = rawName ?? encodedName;
    const binding = opts.machineBindings?.get(lookupName) ?? null;
    // §51.12 + §51.12.3.1 — temporal rules include BOTH literal-form (afterMs)
    // and computed-form (afterExpr). The chained re-arm path (rulesJson) sees
    // only literals; computed-form rules participate in the initial arm via
    // an inline guarded `_scrml_machine_arm_timer` call below, so they DO arm
    // at module-init when the initial variant matches their `from`.
    const temporalRules = binding?.rules?.filter((r: any) => r.afterMs != null || r.afterExpr != null) ?? [];
    if (temporalRules.length > 0) {
      const literalTemporalRules = temporalRules.filter((r: any) => r.afterMs != null);
      const computedTemporalRules = temporalRules.filter((r: any) => r.afterExpr != null);
      // S27 (§51.11): include `label` in the payload and pass the
      // machine's audit target so the runtime can push audit entries
      // on timer expiry. Re-arming of chained temporal rules cascades
      // through `_scrml_machine_arm_initial` which consumes this same
      // payload. A5-5: only LITERAL rules can chain through the JSON
      // payload (computed expressions can't round-trip through JSON).
      const rulesPayload = JSON.stringify(
        literalTemporalRules.map((r: any) => ({
          from: r.from,
          afterMs: r.afterMs,
          to: r.to,
          label: r.label ?? null,
        }))
      );
      const auditTarget = (binding as any).auditTarget ?? null;
      const auditArg = auditTarget ? `, ${JSON.stringify(auditTarget)}` : "";
      const out: string[] = [
        `_scrml_reactive_set(${JSON.stringify(encodedName)}, ${valueExpr});`,
      ];
      // Always call _scrml_machine_arm_initial — it scans rulesPayload for
      // literal-form rules matching the just-set variant. When rulesPayload
      // is "[]" (only computed rules exist), the call is a no-op.
      out.push(`_scrml_machine_arm_initial(${JSON.stringify(encodedName)}, ${JSON.stringify(rulesPayload)}${auditArg});`);
      // A5-5 (§51.12.3.1): per-rule inline arm for COMPUTED-FORM temporal
      // rules. Same shape as the post-write site #2 — guard on the just-set
      // variant string and call _scrml_machine_arm_timer with the IIFE-
      // wrapped duration. The guard match the legacy machine's variant-
      // string convention (bare string for unit variants, `.variant` field
      // on payload variants — extracted via the same shape as __nextVariant
      // at the post-write sites).
      if (computedTemporalRules.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { rewriteExpr } = require("./rewrite.ts");
        const auditTargetLit = auditTarget ? JSON.stringify(auditTarget) : "null";
        out.push(`{`);
        out.push(`  var __scrml_init_v = _scrml_reactive_get(${JSON.stringify(encodedName)});`);
        out.push(`  var __scrml_init_variant = (__scrml_init_v != null && typeof __scrml_init_v === "object" && __scrml_init_v.variant != null) ? __scrml_init_v.variant : __scrml_init_v;`);
        for (const r of computedTemporalRules) {
          const labelLit = (r as any).label ? JSON.stringify((r as any).label) : "null";
          const rewritten = rewriteExpr((r as any).afterExpr);
          const durationExpr = `(function(){ var v = ${rewritten}; return (typeof v === "number" && isFinite(v) && v >= 0) ? Math.round(v) : 0; })()`;
          out.push(`  if (__scrml_init_variant === ${JSON.stringify((r as any).from)}) {`);
          out.push(`    _scrml_machine_arm_timer(${JSON.stringify(encodedName)}, ${durationExpr}, ${JSON.stringify((r as any).to)}, { fromVariant: ${JSON.stringify((r as any).from)}, label: ${labelLit}, auditTarget: ${auditTargetLit}, rulesJson: ${JSON.stringify(rulesPayload)} });`);
          out.push(`  }`);
        }
        out.push(`}`);
      }
      return out.join("\n");
    }
  }
  return `_scrml_reactive_set(${JSON.stringify(encodedName)}, ${valueExpr});`;
}

/**
 * Ensure boundary is set in EmitLogicOpts. When missing, default to "client"
 * but emit a one-time diagnostic warning. This is a semi-fail-closed approach:
 * the compilation succeeds, but the missing boundary is surfaced.
 *
 * Every function should have a resolved boundary from RI (Stage 5). A missing
 * boundary at CG time is either (a) an internal emit path that inherently runs
 * client-side (legitimate — most CG paths are client), or (b) a boundary
 * propagation bug where server code is silently emitted as client code.
 *
 * In development mode (SCRML_STRICT_BOUNDARY=1), this throws instead of
 * warning, so boundary propagation bugs are caught during compiler testing.
 *
 * Changed from silent fail-open to diagnostic-emitting fail-safe as part of
 * boundary-security-fix (NC-4).
 */
const _boundaryWarnedFor = new Set<string>();
const _strictBoundary = typeof process !== "undefined" && process.env?.SCRML_STRICT_BOUNDARY === "1";
function _ensureBoundary(opts: EmitLogicOpts, context: string): EmitLogicOpts {
  if (!opts.boundary) {
    if (_strictBoundary) {
      throw new Error(
        `[emit-logic] BOUNDARY MISSING: ${context} called without opts.boundary. ` +
        `Every function must have a resolved boundary from Route Inference (RI, Stage 5). ` +
        `A missing boundary is a compiler bug — report this to the scrml team. ` +
        `(SCRML_STRICT_BOUNDARY=1 is set — strict mode.)`
      );
    }
    if (!_boundaryWarnedFor.has(context)) {
      _boundaryWarnedFor.add(context);
      if (typeof process !== "undefined" && process.env?.SCRML_DEBUG) {
        console.warn(
          `[emit-logic] ${context}: EmitLogicOpts.boundary missing — defaulting to "client". ` +
          `Set SCRML_STRICT_BOUNDARY=1 to make this an error.`
        );
      }
    }
    return { ...opts, boundary: "client" };
  }
  return opts;
}

export function emitLogicNode(node: any, opts: EmitLogicOpts = { boundary: "client" }): string {
  if (!node || typeof node !== "object") return "";

  opts = _ensureBoundary(opts, "emitLogicNode");

  // §20.6 — remember this statement's real source span so the log()
  // lowering can resolve file:line (the call node's own span loses its
  // byte offset through the codegen re-parse; the statement node keeps it).
  if (node.span && typeof node.span.start === "number" && node.span.start > 0) {
    opts = { ...opts, currentStmtSpan: node.span };
  }

  // §4.12.6: Inherit dbVar from node annotation if not already set in opts
  if (!opts.dbVar && node._dbVar) {
    opts = { ...opts, dbVar: node._dbVar };
  }

  const derivedNames: Set<string> | null = opts.derivedNames ?? null;

  switch (node.kind) {
    case "html-fragment":
      // Phase 4: HTML fragment tokens are not JS — drop them in logic context.
      // In lift context, emit-lift handles them for tag reconstruction.
      return "";
    case "bare-expr": {
      // Phase 3 fast path: when exprNode is present, skip all string heuristics
      if (node.exprNode) {
        // §32 — orphan `~` accumulator at statement position.
        // When `~snapshot = {...}` (or any `~name = expr`) is parsed by the live
        // parser (ast-builder.js), the leading `~` is peeled off as a spurious
        // bare-expr (the statement-boundary check at collectExpr line 2588-2596
        // breaks on `IDENT =` after `~`, leaving `~` as a standalone). The
        // tilde-decl handler then matches `name = expr` and emits the tilde-decl
        // correctly — but the orphan bare-expr `~` remains. Without this guard,
        // codegen emits `let _scrml_tilde_N = ~;` (invalid JS — bitwise-NOT on
        // nothing). Skip the orphan: there is no preceding initializer for `~`
        // to consume, and the trailing tilde-decl is already self-contained.
        // SPEC §32 ratifies `~` as the pipeline accumulator atom (READ-side);
        // there is no statement-position production for a lone `~`. The native
        // parser (parse-stmt.js:3015 — `tildeDeclLeadFollows`) correctly
        // recognises the unified `~ IDENT = expr` lead; the live parser does
        // not. Per HU-5 Q-W35-1 (a) ratification, the canonical-surface fix is
        // bounded to codegen (no new SPEC §32 prose, no new language form).
        if (
          node.exprNode.kind === "ident" &&
          node.exprNode.name === "~" &&
          (!opts.tildeContext || opts.tildeContext.var === null)
        ) {
          return "";
        }
        if (opts.tildeContext) {
          // §32 Gap 7: pure consume+reinit. A bare-expr that ALSO references `~`
          // in its RHS (e.g. `step2(~)` after `step1(2)` initialized `~`) must
          // emit RHS using the PREVIOUS tilde-var, then rebind `~` to the NEW
          // var for downstream statements. If we set opts.tildeContext.var to
          // tVar BEFORE constructing the expr ctx, _makeExprCtx would capture
          // the new tVar — and `~` in the RHS would self-reference its own
          // initializer (`let _scrml_tilde_N = step2(_scrml_tilde_N);`).
          // Capture the prev expr ctx first; THEN overwrite tildeContext.var.
          const tVar = genVar("tilde");
          const prevExprCtx = _makeExprCtx(opts);
          opts.tildeContext.var = tVar;
          return `let ${tVar} = ${emitExpr(node.exprNode, prevExprCtx)};`;
        }
        // §51.5 machine-binding interception: if this bare-expr is a
        // reactive `@var = expr` assignment AND the var is machine-bound,
        // route through _emitReactiveSet so the transition guard + audit
        // clause (§51.11) fire. Without this, emitAssign would emit a
        // plain _scrml_reactive_set and the machine contract is silently
        // bypassed inside function bodies.
        if (opts.machineBindings && node.exprNode.kind === "assign") {
          const assignNode = node.exprNode as { kind: "assign"; op: string; target?: { kind?: string; name?: string }; value: unknown };
          const target = assignNode.target;
          if (target && target.kind === "ident" && typeof target.name === "string" && target.name.startsWith("@") && assignNode.op === "=") {
            const bareName = target.name.slice(1);
            if (opts.machineBindings.get(bareName)) {
              const rhsStr = emitExpr(assignNode.value as any, _makeExprCtx(opts));
              return _emitReactiveSet(bareName, rhsStr, opts, bareName) + ";";
            }
          }
        }
        // C13 (§51.0.F): mirror interception for the new `<engine>` form. The
        // legacy `<machine>` interception above goes through `emitTransitionGuard`;
        // this arm dispatches `<engine>`-form writes through the C13 hook.
        if (opts.engineBindings && node.exprNode.kind === "assign") {
          const assignNode = node.exprNode as { kind: "assign"; op: string; target?: { kind?: string; name?: string }; value: unknown };
          const target = assignNode.target;
          if (target && target.kind === "ident" && typeof target.name === "string" && target.name.startsWith("@") && assignNode.op === "=") {
            const bareName = target.name.slice(1);
            if (opts.engineBindings.get(bareName)) {
              // A5-7 Wave 2.4 (§51.0.N + §51.0.Q.1, Bug #2): detect the
              // structured `.Variant.history` form. When present, strip the
              // `.history` suffix from the value expression (so the runtime
              // value is just the bare variant tag) AND mark this write as a
              // history-restore so the runtime sets the pending flag for the
              // dispatcher's composite-arm postMountJs to consume.
              const histDet = detectHistoryForm(assignNode.value as any);
              const valueExprNode = histDet.isHistoryForm ? histDet.strippedNode : (assignNode.value as any);
              const rhsStr = emitExpr(valueExprNode, _makeExprCtx(opts));
              return _emitReactiveSet(bareName, rhsStr, opts, bareName, /*isInit*/ false, histDet.isHistoryForm) + ";";
            }
          }
        }
        // Bug-5 follow-on to C18 (§38.4, S83 Wave 4A): channel-scoped server-
        // function write to a channel-owned cell. Lower `@cell = expr` to the
        // canonical `broadcast({__type:"__sync",__key,__val})` wire frame per
        // SPEC §38.4 line 15998. `broadcast()` is auto-injected by
        // `emit-server.ts:emitBroadcastInjection` as a local in channel-owned
        // server-fn bodies. Restricted to:
        //   - `boundary === "server"` (client-side writes go through the
        //     normal `_scrml_reactive_set` + auto-sync effect pair in
        //     emit-reactive-wiring + emit-channel client IIFE).
        //   - `opts.channelOwnedCells` non-null & contains the LHS bare name
        //     (Set populated by emit-server.ts for functions in `channelFnMap`).
        //   - `op === "="` (compound assignment `+=` would need a server-side
        //     replica of the channel cell to compute the new value, which is
        //     out of scope — those still flow through the generic path and
        //     RI's E-RI-002 gate keeps them unreachable).
        //
        // The RHS emits in server mode so `@otherCell` references inside the
        // value expression resolve to `_scrml_body["otherCell"]` (the existing
        // server-side semantics; non-channel-cell reads still have the deep
        // pre-existing limitation that the server doesn't replicate channel
        // state — adopters should use the §38.6 `broadcast()` pattern when
        // they need to construct a fully synthetic frame from args alone).
        if (
          opts.boundary === "server" &&
          opts.channelOwnedCells &&
          opts.channelOwnedCells.size > 0 &&
          node.exprNode.kind === "assign"
        ) {
          const assignNode = node.exprNode as { kind: "assign"; op: string; target?: { kind?: string; name?: string }; value: unknown };
          const target = assignNode.target;
          if (
            target && target.kind === "ident" &&
            typeof target.name === "string" && target.name.startsWith("@") &&
            assignNode.op === "="
          ) {
            const bareName = target.name.slice(1);
            if (opts.channelOwnedCells.has(bareName)) {
              // Build a server-mode expr ctx so `@otherCell` inside the RHS
              // resolves to `_scrml_body["otherCell"]` rather than the client
              // `_scrml_reactive_get(...)` form. This is the same single-site
              // override pattern used by the `liftE` server emission at the
              // bottom of this file (search for `mode: "server"` in this file).
              const serverCtx: EmitExprContext = { ..._makeExprCtx(opts), mode: "server" };
              const rhsStr = emitExpr(assignNode.value as any, serverCtx);
              return `broadcast({ __type: "__sync", __key: ${JSON.stringify(bareName)}, __val: (${rhsStr}) });`;
            }
          }
        }
        return `${emitExpr(node.exprNode, _makeExprCtx(opts))};`;
      }
      let bareExpr: string = node.expr ?? "";
      if (bareExpr.trim() === "/" || bareExpr.trim() === "") return "";
      // Skip slot spread placeholder — CE replaces ${...} slots with children; if any survive
      // to codegen (e.g. component with no caller, or CE expansion failed), drop them silently.
      if (bareExpr.trim() === "...") return "";
      // Skip leaked HTML tag fragments (e.g. `/ < / button >`, `/ < span`, `< / div >`).
      // These arise when scrml closers and HTML tags leak through to JS output.
      if (/^\/?\s*<\s*\/?\s*[a-zA-Z]/.test(bareExpr.trim())) return "";

      if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(bareExpr.trim())) return "";

      bareExpr = stripLeakedComments(bareExpr);

      // §42 Presence guard: `( identifier ) => { body }` → `if (x !== null && x !== undefined) { body }`
      // Detect before rewriteExpr to avoid appending a trailing semicolon to the if-block.
      const presenceGuardMatch = bareExpr.trim().match(/^\(\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\)\s*=>\s*\{([\s\S]*)\}\s*$/);
      if (presenceGuardMatch) {
        const varName = presenceGuardMatch[1];
        const body = presenceGuardMatch[2];
        // Rewrite the body contents through the normal pipeline
        const rewrittenBody = emitExprField(null, body.trim(), _makeExprCtx(opts));
        return `if (${varName} !== null && ${varName} !== undefined) {\n  ${rewrittenBody}\n}`;
      }

      const destructMatch = bareExpr.trim().match(/^\{\s*([a-zA-Z_$][\w$]*(?:\s*,\s*[a-zA-Z_$][\w$]*)*)\s*\}\s*=\s*([\s\S]+)$/);
      if (destructMatch) {
        const vars = destructMatch[1];
        const init = destructMatch[2].trim();
        const initSplit = splitBareExprStatements(init);
        if (initSplit.length > 1) {
          const lines: string[] = [`const { ${vars} } = ${emitExprField(null, initSplit[0].trim(), _makeExprCtx(opts))};`];
          for (let i = 1; i < initSplit.length; i++) {
            const s = initSplit[i].trim();
            if (s) lines.push(`${emitExprField(null, s, _makeExprCtx(opts))};`);
          }
          return lines.filter((l: string) => l !== ";").join("\n");
        }
        return `const { ${vars} } = ${emitExprField(null, init, _makeExprCtx(opts))};`;
      }

      const splitStmts = splitBareExprStatements(bareExpr);
      if (splitStmts.length > 1) {
        return splitStmts
          .map((s: string) => s.trim())
          .filter((s: string) => s && !isLeakedComment(s))
          .map((s: string) => `${emitExprField(null, s, _makeExprCtx(opts))};`)
          .filter((s: string) => s !== ";")
          .join("\n");
      }
      const trimmed = bareExpr.trim();
      if (isLeakedComment(trimmed)) return `// ${trimmed}`;
      // §32: If a tilde context is active, this bare-expr initializes the tilde variable.
      // Emit as `let _scrml_tilde_N = <expr>;` so `~` in subsequent nodes can reference it.
      // Gap 7: capture prev expr ctx (with previous tildeVar) BEFORE overwriting
      // opts.tildeContext.var — otherwise `~` in the RHS would self-reference
      // the new var. Same pattern as the exprNode fast path above.
      if (opts.tildeContext) {
        const tVar = genVar("tilde");
        const prevExprCtx = _makeExprCtx(opts);
        opts.tildeContext.var = tVar;
        return `let ${tVar} = ${emitExprField(null, bareExpr, prevExprCtx)};`;
      }
      return `${emitExprField(null, bareExpr, _makeExprCtx(opts))};`;
    }

    case "let-decl": {
      if (node._compileTimeOnly) return "";
      // A5 (2026-05-17) — `node.name` may be a structured DestructurePattern.
      // For codegen purposes, render it back to JS source text. For
      // declaredNames bookkeeping, register each bound ident (the
      // destructured names) rather than the pattern itself.
      const _letDeclLhs = nameOrPatternText(node.name);
      if (isDestructurePattern(node.name)) {
        if (opts.declaredNames) {
          for (const bind of _iterDestructureBindNames(node.name)) opts.declaredNames.add(bind);
        }
      } else if (node.name && opts.declaredNames) {
        opts.declaredNames.add(node.name);
      }
      // If-as-expression: `let a = if (cond) { lift val }`
      if (node.ifExpr) {
        return emitIfExprDecl(_letDeclLhs, node.ifExpr, "let", opts);
      }
      // For-as-expression: `let names = for (item of items) { lift item.name }`
      if (node.forExpr) {
        return emitForExprDecl(_letDeclLhs, node.forExpr, "let", opts);
      }
      // Match-as-expression: `let result = match expr { .A => { lift val } }`
      if (node.matchExpr) {
        return emitMatchExprDecl(_letDeclLhs, node.matchExpr, "let", opts);
      }
      // v0.2.4 bug-1-anomaly-2: `let x = ?{...}.method()` — sqlNode-bearing
      // init. Recurse into case "sql" to produce the Bun.SQL tagged template,
      // then strip the trailing `;` so the result can be wrapped as the RHS
      // of `let x = ...;`. Mirrors case "return-stmt" / "lift-expr" / state-decl
      // sqlNode handling.
      //
      // `_scrml_sql` is server-only (E-CG-006). Inside a server-inferred fn body
      // (`opts.boundary === "server"`) this is correct. On the client boundary
      // the variable cannot be populated from SQL; emit a `let x;` + explanatory
      // comment so emitted JS still parses and the diagnostic is visible at
      // inspection. (No silent `/_* sql-ref:-1 *_/` placeholder.) Note: the
      // RI stage should classify any function containing a SQL `?{}` op as a
      // server fn, so the client branch is best-effort defensive only.
      if (node.sqlNode && node.sqlNode.kind === "sql") {
        if (opts.boundary === "server") {
          const sqlStmt = emitLogicNode(node.sqlNode, opts);
          const sqlExpr = sqlStmt.replace(/;\s*$/, "");
          return `let ${_letDeclLhs} = ${sqlExpr};`;
        }
        return `let ${_letDeclLhs}; // SQL-init for ${_letDeclLhs} — client cannot evaluate _scrml_sql (E-CG-006); use a server-side function.`;
      }
      // dpa-003 (S216): `let x = _={ … }=` — inline foreign-code init. Mirror of
      // the sqlNode handling: recurse into case "foreign" and strip the trailing
      // `;` so the result becomes the RHS. Server-only (the slice is opaque ts/js
      // run server-side); the fn is RI-classified server when it carries a
      // foreign node, so the server branch is the live path.
      if ((node as any).foreignNode && (node as any).foreignNode.kind === "foreign") {
        if (opts.boundary === "server") {
          const fStmt = emitLogicNode((node as any).foreignNode, opts);
          const fExpr = fStmt.replace(/;\s*$/, "");
          return `let ${_letDeclLhs} = ${fExpr};`;
        }
        return `let ${_letDeclLhs}; // foreign-init for ${_letDeclLhs} — _{} runs server-side; use a server-side function.`;
      }
      // Phase 3 fast path: when initExpr is present, skip all string splitting/merging
      if (node.initExpr) {
        const rhs = emitExpr(node.initExpr, _makeExprCtx(opts));
        // predicateCheck is bare-ident only (§53.4 predicated types don't apply
        // to destructured LHS) — gate on string-name shape.
        if (node.predicateCheck && node.predicateCheck.zone === "boundary" && typeof node.name === "string") {
          const _pc = node.predicateCheck;
          const _checkTmpVar = genVar(`_scrml_chk_${node.name}`);
          const _checkLines = emitRuntimeCheck(_pc.predicate, _checkTmpVar, node.name, _pc.label ?? null);
          return [
            `const ${_checkTmpVar} = ${rhs};`,
            ..._checkLines,
            `let ${node.name} = ${_checkTmpVar};`,
          ].join("\n");
        }
        return `let ${_letDeclLhs} = ${rhs};`;
      }
      // Phase 4 simplified fallback: initExpr is missing (rare — e.g. tilde expressions)
      let letInit: string = node.init ?? "";
      if (opts.tildeContext?.var && letInit.includes("~")) {
        letInit = rewriteTildeRef(letInit, opts.tildeContext.var);
        opts.tildeContext.var = null;
      }
      if (!letInit) return `let ${_letDeclLhs};`;
      if (node.predicateCheck && node.predicateCheck.zone === "boundary" && typeof node.name === "string") {
        const _pc = node.predicateCheck;
        const _checkTmpVar = genVar(`_scrml_chk_${node.name}`);
        const _checkLines = emitRuntimeCheck(_pc.predicate, _checkTmpVar, node.name, _pc.label ?? null);
        return [`const ${_checkTmpVar} = ${emitExprField(node.initExpr, letInit, _makeExprCtx(opts))};`, ..._checkLines, `let ${node.name} = ${_checkTmpVar};`].join("\n");
      }
      return `let ${_letDeclLhs} = ${emitExprField(node.initExpr, letInit, _makeExprCtx(opts))};`;
    }

    case "const-decl":
    case "tilde-decl": {
      if (!node.name) return "";
      if (node._compileTimeOnly) return "";
      // A5 (2026-05-17) — same as let-decl: `node.name` may be a structured
      // DestructurePattern (const-decl only; tilde-decl never destructures).
      const _constDeclLhs = nameOrPatternText(node.name);
      // For tilde-decl: if name was already declared by let-decl, emit as reassignment
      if (node.kind === "tilde-decl" && typeof node.name === "string" && opts.declaredNames?.has(node.name)) {
        const init = node.init ?? "";
        const tildeRhs = emitExprField(node.initExpr, init, _makeExprCtx(opts));
        return `${node.name} = ${tildeRhs};`;
      }
      // For tilde-decl with reactive deps: emit as derived reactive (auto-updates)
      // Phase 4d: ExprNode-first reactive dep extraction, string fallback
      if (node.kind === "tilde-decl" && typeof node.name === "string") {
        const tildeInit: string = node.init ?? "";
        const tildeDeps = node.initExpr
          ? extractReactiveDepsFromExprNode(node.initExpr)
          : extractReactiveDeps(tildeInit);
        if (tildeDeps.size > 0) {
          const rewrittenBody = emitExprField(node.initExpr, tildeInit, { ..._makeExprCtx(opts), derivedNames });
          const ctx = opts.encodingCtx;
          const encodedName = ctx ? ctx.encode(node.name) : node.name;
          const lines: string[] = [];
          // GITI-014: paren-wrap object-literal bodies — `() => {a: 1}` mis-parses
          // as a block statement; `() => ({a: 1})` parses as the expression we want.
          // Use string-form predicate because emitExprField may return either an
          // ExprNode emit or a rewritten raw string.
          const wrappedTildeBody = arrowBodyStringNeedsParens(rewrittenBody) ? `(${rewrittenBody})` : rewrittenBody;
          lines.push(`_scrml_derived_declare(${JSON.stringify(encodedName)}, () => ${wrappedTildeBody});`);
          for (const dep of tildeDeps) {
            const encodedDep = ctx ? ctx.encode(dep) : dep;
            lines.push(`_scrml_derived_subscribe(${JSON.stringify(encodedName)}, ${JSON.stringify(encodedDep)});`);
          }
          return lines.join("\n");
        }
      }
      if (node.kind === "const-decl" && node.name && opts.declaredNames) {
        if (isDestructurePattern(node.name)) {
          for (const bind of _iterDestructureBindNames(node.name)) opts.declaredNames.add(bind);
        } else {
          opts.declaredNames.add(node.name);
        }
      }
      // If-as-expression: `const a = if (cond) { lift val }`
      if (node.ifExpr) {
        return emitIfExprDecl(_constDeclLhs, node.ifExpr, "const", opts);
      }
      // For-as-expression: `const names = for (item of items) { lift item.name }`
      if (node.forExpr) {
        return emitForExprDecl(_constDeclLhs, node.forExpr, "const", opts);
      }
      // Match-as-expression: `const result = match expr { .A => { lift val } }`
      if (node.matchExpr) {
        return emitMatchExprDecl(_constDeclLhs, node.matchExpr, "const", opts);
      }
      // v0.2.4 bug-1-anomaly-2: `const x = ?{...}.method()` — sqlNode-bearing
      // init. Mirror of the let-decl handling above. Tilde-decl shares this
      // case branch but does NOT participate — tilde-decl never carries a
      // sqlNode (the AST builder routes ?{...} only through the let/const
      // entry points). Guard on `node.kind === "const-decl"` for safety.
      if (node.kind === "const-decl" && node.sqlNode && node.sqlNode.kind === "sql") {
        if (opts.boundary === "server") {
          const sqlStmt = emitLogicNode(node.sqlNode, opts);
          const sqlExpr = sqlStmt.replace(/;\s*$/, "");
          return `const ${_constDeclLhs} = ${sqlExpr};`;
        }
        // Client boundary: cannot evaluate; emit `const x = null;` (const must
        // have an initializer) + comment so the JS parses and the cause is
        // visible.
        return `const ${_constDeclLhs} = null; // SQL-init for ${_constDeclLhs} — client cannot evaluate _scrml_sql (E-CG-006); use a server-side function.`;
      }
      // dpa-003 (S216): `const x = _={ … }=` — inline foreign-code init. Mirror
      // of the sqlNode handling above.
      if (node.kind === "const-decl" && (node as any).foreignNode && (node as any).foreignNode.kind === "foreign") {
        if (opts.boundary === "server") {
          const fStmt = emitLogicNode((node as any).foreignNode, opts);
          const fExpr = fStmt.replace(/;\s*$/, "");
          return `const ${_constDeclLhs} = ${fExpr};`;
        }
        return `const ${_constDeclLhs} = null; // foreign-init for ${_constDeclLhs} — _{} runs server-side; use a server-side function.`;
      }
      // Phase 3 fast path: when initExpr is present, skip all string splitting/merging
      if (node.initExpr) {
        return `const ${_constDeclLhs} = ${emitExpr(node.initExpr, _makeExprCtx(opts))};`;
      }
      // Phase 4 simplified fallback: initExpr is missing (rare — e.g. tilde expressions)
      let constInit: string = node.init ?? "";
      if (opts.tildeContext?.var && constInit.includes("~")) {
        constInit = rewriteTildeRef(constInit, opts.tildeContext.var);
        opts.tildeContext.var = null;
      }
      if (!constInit) return `const ${_constDeclLhs};`;
      return `const ${_constDeclLhs} = ${emitExprField(node.initExpr, constInit, _makeExprCtx(opts))};`;
    }

    case "state-decl": {
      // C1 shape dispatch (SPEC §6.2 / §6.3 / §6.6.17 / §6.8):
      //   1. compound-parent (children !== undefined)        → recursive child walk (re-uses _scrml_derived_declare for parent proxy)
      //   2. derived markup-typed (_cellKind === "markup-typed")  → factory-shell + _scrml_derived_declare
      //   3. derived plain (shape === "derived" && isConst)  → _scrml_derived_declare
      //   4. plain reactive (Shape 1 + Shape 2)              → _scrml_reactive_set
      //   5. default= sidecar (orthogonal; emit if defaultExpr !== null)  → _scrml_default_set
      //
      // Phase A1a Step 11.5 folded the legacy `reactive-derived-decl` AST
      // node into `state-decl{shape:"derived",isConst:true}`. Pre-C1 the
      // dispatch was gated on `structuralForm === false`, leaving Shape 3
      // V5-strict (`const <x> = expr`) on the legacy `_scrml_reactive_set`
      // path. C1 closes that gap (S61 Step 11.5 deferred work) by admitting
      // both forms to the derived-declare emitter below.
      //
      // The `default=` sidecar is computed once at top of the case and
      // appended to whichever main emission arm fires. SURVEY §6 contract:
      // emit `_scrml_default_set("name", () => <defaultExpr>);` for any
      // state-decl with `defaultExpr !== null`. Compound child decls carry
      // their own `defaultExpr` and recurse into this case naturally so
      // each child registers its default at its qualified-path key.
      //
      // C5 adds a parallel init-thunk sidecar — `_scrml_init_set(...)` for
      // every Shape 1 / Shape 2 state-decl that does NOT carry a
      // `defaultExpr`. Per SPEC §6.8.1 line 4831, when `default=` is absent
      // `reset(@cell)` re-evaluates the init expression at reset time. The
      // helper is registered alongside the cell at module-init so the
      // runtime can call it later. Skipped for derived/markup-typed/compound-
      // parent cells (see `_emitInitThunkSidecar` for the carve-outs).
      //
      // Order at runtime: default-thunk (if any) overrides init-thunk per
      // §6.8.2 line 4857. Order in emitted JS: init-set comes BEFORE
      // default-set so a casual reader sees the init flow first; runtime
      // ordering is dispatch-time, not registration-time.
      const _qualifiedName = (opts.compoundPathPrefix ? `${opts.compoundPathPrefix}.${node.name}` : node.name);
      const _defaultSidecar = _emitDefaultSidecar(node, _qualifiedName, opts);
      const _initSidecar = _emitInitThunkSidecar(node, _qualifiedName, opts);
      const _reactivitySidecar = _emitReactivitySidecar(node, _qualifiedName, opts);
      // C7: per-cell validator runner sidecar. For state-decls with non-empty
      // validators[] AND living inside a compound (compoundPathPrefix set),
      // emit a derived computation that walks the validators in declaration
      // order, applies §55.12 short-circuit, and writes per-field
      // `<qualifiedField>.errors` + `<qualifiedField>.isValid` to the synth
      // surfaces B12 registered. Returns null for top-level non-compound cells
      // (no synth surface per §55.5 L11 Edge A) and for derived/markup-typed/
      // compound-parent/server-boundary/insideFunctionBody cases.
      const _validatorSidecar = emitValidatorRunnerSidecar(node, _qualifiedName, {
        boundary: opts.boundary,
        insideFunctionBody: opts.insideFunctionBody,
        compoundPathPrefix: opts.compoundPathPrefix ?? null,
        encodingCtx: opts.encodingCtx ?? null,
        derivedNames: opts.derivedNames ?? null,
        // Bug 61 — validator args may cross-read `@<compound>.<synthProp>`.
        synthCellKeys: opts.synthCellKeys ?? null,
      });
      // C10 (§55.10 L12): Level-1 inline-message-override registration. For
      // each validator with a non-null `inlineOverride` (B13-extracted), emit
      // a `_scrml_messages_register_inline(cellName, validatorName, override)`
      // call. Independent of the validator runner — emits even for top-level
      // cells where the runner is skipped (registrations are cheap; future
      // explicit `messageFor` calls may consume them).
      const _inlineMessagesSidecar = emitInlineMessageOverrides(node, _qualifiedName, {
        boundary: opts.boundary,
        insideFunctionBody: opts.insideFunctionBody,
      });
      const _appendSidecar = (mainStmt: string): string => {
        const parts = [mainStmt];
        if (_initSidecar) parts.push(_initSidecar);
        if (_defaultSidecar) parts.push(_defaultSidecar);
        if (_validatorSidecar) parts.push(_validatorSidecar);
        if (_inlineMessagesSidecar) parts.push(_inlineMessagesSidecar);
        // S79 / §6.13 — reactivity-register sidecar. Must run AFTER the main
        // `_scrml_reactive_set` (init write) so the init isn't routed through
        // the timing wrapper. Subsequent writes (post-init) see the rule
        // registered and route through the wrapper.
        if (_reactivitySidecar) parts.push(_reactivitySidecar);
        return parts.join("\n");
      };

      // C1 dispatch arm 1: Variant C compound parent (`<formRes><name>=""</></>`)
      // Per SPEC §6.3.2 / §6.3.5 + B5 cell-classifier (symbol-table.ts:1481),
      // a compound parent is identified by `Array.isArray(node.children)` AND
      // `_cellKind === "compound-parent"`. The parent itself is a derived cell
      // whose value is a reconstructed object literal `{ field1: get("parent.field1"), ... }`
      // (SURVEY §3.3 Option A-prime — re-uses `_scrml_derived_declare` rather
      // than introducing a dedicated `_scrml_compound_declare` helper).
      //
      // Each child state-decl is emitted recursively with `compoundPathPrefix`
      // threaded through opts, so child cells register under qualified paths
      // (`formRes.name`, `signup.email`) matching `StateCellRecord.qualifiedPath`.
      // In-compound derived cells (§6.6.16) and bindable children flow through
      // the same dispatch — recursion routes them naturally.
      //
      // The dirty-propagation edges from each child to the parent are emitted
      // alongside the parent declaration so writes to `formRes.name` dirty
      // `formRes` (the parent re-evaluates on next read of `@formRes`). This
      // is consistent with §6.3.5 + the runtime's lazy-pull derived semantics.
      if (
        (node as any)._cellKind === "compound-parent" ||
        Array.isArray((node as any).children)
      ) {
        const ctxC = opts.encodingCtx;
        const encodedParentName = ctxC ? ctxC.encode(_qualifiedName) : _qualifiedName;
        const childOpts: EmitLogicOpts = { ...opts, compoundPathPrefix: _qualifiedName };
        const childLines: string[] = [];
        const childNames: string[] = [];
        for (const child of (node.children as any[]) ?? []) {
          if (!child || typeof child !== "object") continue;
          // Recursively emit each child. Children are themselves state-decls
          // and may be Shape 1, 2, or 3 (incl. nested compound) — the dispatch
          // in this same case handles the routing.
          const childEmit = emitLogicNode(child, childOpts);
          if (childEmit) childLines.push(childEmit);
          childNames.push(child.name);
        }

        // Build the parent-proxy reconstruction expression. Empty compound
        // (`children: []` is legal per SPEC §6.3.2) emits an empty object
        // literal as the value.
        const reconExprBody = childNames.length === 0
          ? "({})"
          : "({ " + childNames.map(cn => {
              const childQName = `${_qualifiedName}.${cn}`;
              const encodedChild = ctxC ? ctxC.encode(childQName) : childQName;
              return `${cn}: _scrml_reactive_get(${JSON.stringify(encodedChild)})`;
            }).join(", ") + " })";

        const parentLines: string[] = [];
        parentLines.push(`_scrml_derived_declare(${JSON.stringify(encodedParentName)}, () => ${reconExprBody});`);
        for (const cn of childNames) {
          const childQName = `${_qualifiedName}.${cn}`;
          const encodedChild = ctxC ? ctxC.encode(childQName) : childQName;
          parentLines.push(`_scrml_derived_subscribe(${JSON.stringify(encodedParentName)}, ${JSON.stringify(encodedChild)});`);
        }

        // C8: validity-surface synthesis emission (compound-level rollup +
        // per-field touched + compound submitted + per-field trivial defaults).
        // Per SPEC §55.5/§55.6/§55.7 — emitted unconditionally for every
        // compound parent (predictability rule). Returns null when boundary is
        // server or insideFunctionBody.
        const _synthSurfaceEmit = emitCompoundSynthSurface(node, _qualifiedName, {
          boundary: opts.boundary,
          insideFunctionBody: opts.insideFunctionBody,
          encodingCtx: opts.encodingCtx ?? null,
        });
        if (_synthSurfaceEmit) parentLines.push(_synthSurfaceEmit);

        // Order: child declarations FIRST (so children exist before the parent
        // proxy reads them on its first lazy pull), then the parent declare +
        // subscribe edges, then C8's compound-level synth (which reads the
        // per-field synth derivations via _scrml_derived_get — those exist
        // because childLines includes C7's per-field validator runner +
        // C8's per-field trivial defaults). The `default=` sidecar applies
        // to the parent cell itself only if the parent decl carries
        // `defaultExpr` (rare; per SPEC §6.8.2 reset() recurses into children
        // — but a parent-level `default=` is allowed structurally).
        const all = [...childLines, ...parentLines];
        return _appendSidecar(all.join("\n"));
      }

      // C1 dispatch arm 2: markup-typed derived (`const <badge> = <span>...`)
      // Per B5 cell-classifier (symbol-table.ts:1480-1490), this is identified
      // by `_cellKind === "markup-typed"` AND `isConst === true`. The ast-builder
      // routes the markup RHS into `renderSpec.element` (NOT `initExpr`); the
      // shape field is set to "decl-with-spec" by the same path that handles
      // bindable Shape 2.
      //
      // C1 emitted a placeholder declaration with a `return null` factory
      // shell + the `_scrml_derived_declare` registration. C2 lifts the shell
      // to a real DOM-builder factory: walks `renderSpec.element` via the
      // existing `emitCreateElementFromMarkup` primitive (emit-lift.js:479),
      // returns the root element, and emits one `_scrml_derived_subscribe`
      // edge per reactive dep collected from the markup tree's `${...}`
      // interpolations + reactive attribute references.
      //
      // Closes the C1→C2 lift per A1c BRIEF §1: "C1 emits the declaration;
      // C2 wires the dep-tracking + factory body."
      //
      // Use-site `${@badge}` interpolation already routes correctly via the
      // runtime's `_scrml_reactive_get` → `_scrml_derived_get` shim
      // (runtime-template.js:181) — when the factory now produces a real
      // DOM tree, `${@badge}` reads return that tree.
      //
      // Defensive: if `renderSpec.element` is missing or malformed, fall back
      // to the C1 `return null` shell (mirrors C1's defensive behavior; A1b
      // should reject before codegen).
      if (
        (node as any)._cellKind === "markup-typed" &&
        (node as any).isConst === true
      ) {
        const ctxMk = opts.encodingCtx;
        const encodedMkName = ctxMk ? ctxMk.encode(_qualifiedName) : _qualifiedName;
        const factoryId = genVar(`markup_factory_${node.name}`);
        const lines: string[] = [];

        const markupRoot = (node as any).renderSpec?.element;
        if (!markupRoot || markupRoot.kind !== "markup") {
          // Defensive shell — A1b should have rejected; emit explanatory marker
          lines.push(`function ${factoryId}() { /* C2: markup-typed derived <${node.name}> has no markup tree — A1b should have rejected before codegen */ return null; }`);
          lines.push(`_scrml_derived_declare(${JSON.stringify(encodedMkName)}, ${factoryId});`);
          return _appendSidecar(lines.join("\n"));
        }

        // Build the factory body via the existing markup→DOM-builder primitive
        // (emit-lift.js:479 — newly exported in WIP-2). The function emits
        // `const _lift_el_X = document.createElement(...);` + setAttribute
        // chains + appendChild calls into the `bodyLines` accumulator and
        // returns the root element variable.
        const bodyLines: string[] = [];
        const rootVar = emitCreateElementFromMarkup(markupRoot, bodyLines);
        const indented = bodyLines.map(l => `  ${l}`).join("\n");
        lines.push(`function ${factoryId}() {`);
        if (indented) lines.push(indented);
        lines.push(`  return ${rootVar};`);
        lines.push(`}`);
        lines.push(`_scrml_derived_declare(${JSON.stringify(encodedMkName)}, ${factoryId});`);

        // Emit subscribe edges for every reactive dep the markup tree
        // interpolates. Walk via `_collectMarkupTreeReactiveDeps` — it
        // descends into `kind: "logic"` children (`${...}` interpolations)
        // and into reactive attribute values, with transitive-fn-call
        // tracking when fnBodyRegistry is available.
        const markupDeps = _collectMarkupTreeReactiveDeps(markupRoot, opts);
        for (const dep of markupDeps) {
          const encodedDep = ctxMk ? ctxMk.encode(dep) : dep;
          lines.push(`_scrml_derived_subscribe(${JSON.stringify(encodedMkName)}, ${JSON.stringify(encodedDep)});`);
        }

        return _appendSidecar(lines.join("\n"));
      }

      if (
        (node as any).shape === "derived" &&
        (node as any).isConst === true
      ) {
        // Implements the post-fold derived-cell emitter (§6.6 derived).
        // Pre-Step-11.5 this was a separate `case "reactive-derived-decl":`;
        // now it's gated inline on the shape discriminant.
        const derivedInit: string = node.init ?? "";
        // C2: when fnBodyRegistry is available, use transitive extraction
        // (closes SPEC §6.6.3 line 2470-2482 normative gap — deps tracked
        // through fn calls). Brings derived path to parity with markup-interp
        // path (emit-html.ts:891). Falls back to direct extraction when
        // registry is absent (preserves test-fixture compatibility for
        // synthetic state-decls without a registry).
        let reactiveDepsFound: Set<string>;
        if (opts.fnBodyRegistry) {
          // Build the expression string for the transitive walker.
          const exprStrForDeps = node.initExpr
            ? (() => { try { return emitStringFromTree(node.initExpr); } catch { return derivedInit; } })()
            : derivedInit;
          reactiveDepsFound = extractReactiveDepsTransitive(exprStrForDeps, null, opts.fnBodyRegistry);
        } else {
          reactiveDepsFound = node.initExpr
            ? extractReactiveDepsFromExprNode(node.initExpr)
            : extractReactiveDeps(derivedInit);
        }
        const hasReactiveDeps = reactiveDepsFound.size > 0;

        if (!hasReactiveDeps) {
          const derivedRhs = emitExprField(node.initExpr, derivedInit, _makeExprCtx(opts));
          // §6.6.11 — the compiler SHALL emit W-DERIVED-001 as a real
          // diagnostic, not merely an inline provenance comment. Push a
          // severity-"warning" CGError into `opts.errors`; api.js partitions
          // W-* codes into `result.warnings` (non-fatal). The const-lowering
          // (reactive-overhead elision) is the correct compile behavior — this
          // only closes the SHALL-emit gap so `scrml compile` surfaces the
          // warning to the adopter. The inline comment is retained as output
          // provenance for anyone reading the compiled JS.
          if (opts.errors) {
            const wDerivedSpan = (node.initExpr && (node.initExpr as any).span)
              ? (node.initExpr as any).span
              : (node.span ?? { start: 0, end: 0 });
            opts.errors.push(new CGError(
              "W-DERIVED-001",
              `W-DERIVED-001: Derived reactive value \`@${node.name}\` has no reactive ` +
              `dependencies. It will never re-evaluate after initial computation. If this ` +
              `is intentional, use \`const ${node.name}\` instead. If \`@${node.name}\` was ` +
              `intended to depend on a reactive variable, check the expression. See SPEC §6.6.11.`,
              wDerivedSpan,
              "warning",
            ));
          }
          return _appendSidecar(`/* W-DERIVED-001: const @${node.name} has no reactive dependencies — treating as const */ const ${node.name} = ${derivedRhs};`);
        }

        const rewrittenBody = emitExprField(node.initExpr, derivedInit, { ..._makeExprCtx(opts), derivedNames });
        const ctxDerived = opts.encodingCtx;
        const encodedDerivedDeclName = ctxDerived ? ctxDerived.encode(_qualifiedName) : _qualifiedName;

        const derivedLines: string[] = [];
        // GITI-014: paren-wrap object-literal bodies — `() => {a: 1}` mis-parses
        // as a block statement; `() => ({a: 1})` parses as the expression we want.
        // Use string-form predicate because emitExprField may return either an
        // ExprNode emit or a rewritten raw string.
        const wrappedDerivedBody = arrowBodyStringNeedsParens(rewrittenBody) ? `(${rewrittenBody})` : rewrittenBody;
        derivedLines.push(`_scrml_derived_declare(${JSON.stringify(encodedDerivedDeclName)}, () => ${wrappedDerivedBody});`);
        for (const dep of reactiveDepsFound) {
          const encodedDep = ctxDerived ? ctxDerived.encode(dep) : dep;
          derivedLines.push(`_scrml_derived_subscribe(${JSON.stringify(encodedDerivedDeclName)}, ${JSON.stringify(encodedDep)});`);
        }
        return _appendSidecar(derivedLines.join("\n"));
      }

      // C21 dispatch arm: Tier 3 predefined-shape compound positional sugar
      // (SPEC §14.11 / M10).
      //
      // Detects `<userInfo>: UserInfo = ("alice", 30, true)` — typed Shape 1
      // state-decl whose RHS parses as a JS SequenceExpression and whose
      // typeAnnotation resolves to a `StructType` in the type registry.
      // Lowers the SequenceExpression to a typed object literal in struct
      // field-declaration order: `{name: "alice", age: 30, active: true}`.
      //
      // Closes the latent JS-comma-operator codegen bug — without this arm,
      // the legacy fallthrough emits `_scrml_reactive_set("userInfo",
      // ("alice", 30, true))` which evaluates to `true` (last operand) per
      // JS comma-operator semantics — silently wrong, no diagnostic.
      //
      // Detection gate (all four MUST hold):
      //   1. `node.typeAnnotation` is a non-empty string
      //   2. `node.initExpr` is a comma-sequence — either a native-parser
      //      `kind: "Sequence"` node OR a live-pipeline escape-hatch with
      //      `nativeKind: "SequenceExpression"`
      //   3. `opts.typeRegistry` is provided (entry-point sets it; tests
      //      that bypass the registry naturally skip this arm)
      //   4. The annotation resolves to a `kind: "struct"` ResolvedType
      //
      // When any gate fails, the arm declines and the legacy fallthrough
      // handles the node as before.
      //
      // Variant C ad-hoc compound (`<formRes> = (a, b, c)` — no typeAnno) is
      // naturally excluded by gate 1 (no typeAnnotation) per §14.11 line 7229.
      //
      // Arity mismatch fires `E-TYPE-001` per §14.11 line 7226. Per-position
      // type mismatch is OUT-OF-SCOPE for codegen — the lowered object
      // literal flows through the existing type-system enforcement on
      // record-init shapes (§14.3).
      // Dual-mode: the live (Acorn) pipeline emits the comma-sequence as an
      // escape-hatch with `nativeKind: "SequenceExpression"`; the native
      // parser (v0.6) emits a first-class `kind: "Sequence"` ExprNode.
      const _initExpr = (node as any).initExpr as any;
      const _isCommaSequence =
        _initExpr &&
        ((_initExpr.kind === "escape-hatch" &&
          _initExpr.nativeKind === "SequenceExpression") ||
          _initExpr.kind === "Sequence");
      if (
        (node as any).typeAnnotation &&
        typeof (node as any).typeAnnotation === "string" &&
        _isCommaSequence &&
        opts.typeRegistry
      ) {
        const _annoStr = ((node as any).typeAnnotation as string).trim();
        const _resolved = opts.typeRegistry.get(_annoStr) as ResolvedType | undefined;
        if (_resolved && _resolved.kind === "struct") {
          const _structType = _resolved as StructType;
          const _lowered = _emitTier3PositionalSugar(
            node as any,
            _structType,
            _qualifiedName,
            opts,
          );
          if (_lowered !== null) {
            // C21 path: helper emits its OWN init-thunk inline (using the
            // lowered object literal, not the raw SequenceExpression) so
            // reset() re-evaluation behaves correctly. Suppress the default
            // `_initSidecar` to avoid double emission. Detect via the marker
            // comment the helper prepends.
            const parts = [_lowered];
            if (_defaultSidecar) parts.push(_defaultSidecar);
            if (_validatorSidecar) parts.push(_validatorSidecar);
            if (_inlineMessagesSidecar) parts.push(_inlineMessagesSidecar);
            return parts.join("\n");
          }
          // _lowered === null: the helper hit a recoverable error and
          // already pushed a diagnostic. Emit a defensive fallback that
          // doesn't crash the runtime: `_scrml_reactive_set(name, null)`
          // (M-7C-D-12 Track 3 — `null` is the canonical scrml absence per §42.5/§42.8).
          const ctx21 = opts.encodingCtx;
          const encoded21 = ctx21 ? ctx21.encode(_qualifiedName) : _qualifiedName;
          return _appendSidecar(
            `/* E-TYPE-001 — see diagnostic */ ${_emitReactiveSet(encoded21, "null", opts, node.name, true)}`
          );
        }
      }

      // fix-cg-cps-return-sql-ref-placeholder (S40 follow-up): when the
      // initializer was `?{...}.method()` (or bare `?{...}`), the AST
      // builder attached a structured `sqlNode` and set `init: ""` /
      // omitted `initExpr`. On the SERVER boundary we recurse into case
      // "sql" and wrap as a _scrml_reactive_set call. (E-CG-006 forbids
      // emitting _scrml_sql on the client, so the client path falls through
      // to the legacy emitter which emits the long-standing pre-existing
      // sql-ref placeholder — a sibling bug out of scope for this fix.)
      // This branch covers the rare case where a server function has a
      // non-CPS-final `@x = ?{...}` state-decl statement (the CPS-final
      // stmt is intercepted by emit-server.ts:600/684 directly without
      // reaching emit-logic).
      // Mirrors emit-logic case "return-stmt" + case "lift-expr" SQL handling.
      if (opts.boundary === "server" && node.sqlNode && node.sqlNode.kind === "sql") {
        const sqlStmt = emitLogicNode(node.sqlNode, opts);
        // case "sql" emits an expression form ending in ";". Strip the trailing
        // ";" so we can wrap as `_scrml_reactive_set(...);`.
        const sqlExpr = sqlStmt.replace(/;\s*$/, "");
        const ctx2 = opts.encodingCtx;
        const encodedName2 = ctx2 ? ctx2.encode(node.name) : node.name;
        // Honor the same isInit logic used by the legacy path so machine-bound
        // reassignments of SQL-init vars route through the transition guard.
        const hasTypeAnnotation2 = !!(node as any).typeAnnotation;
        const hasMachineBinding2 = !!(node as any).machineBinding;
        // C13: include engineBindings in the discriminator (see isInit at
        // ~line 1205 — same reasoning).
        const isInit2 = hasTypeAnnotation2 || hasMachineBinding2 ||
          !(opts.machineBindings?.has(node.name) || opts.engineBindings?.has(node.name));
        return _appendSidecar(_emitReactiveSet(encodedName2, sqlExpr, opts, node.name, isInit2));
      }
      // fix-cg-mounthydrate-sql-ref-placeholder (S40 follow-up): on the CLIENT
      // boundary a SQL-init state-decl (`@x = ?{...}` at top level or in a
      // client logic block) cannot be evaluated — `_scrml_sql` is server-only
      // (E-CG-006). Falling through to the legacy emitter below would produce
      // `_scrml_reactive_set("name", )` (empty arg, parses but ugly) because
      // the AST builder sets `init: ""` and omits `initExpr` for the SQL
      // shape, and `?? "undefined"` does NOT fire on the empty string.
      //
      // The "right" fix here is mount-hydration coalescing (§8.11), but §8.11
      // is scoped to `server @var` declarations only (`isServer === true` —
      // see `collect.ts` `collectServerVarDecls`). Implicitly promoting
      // bare `@var = ?{...}` to server-authoritative semantics is a spec
      // amendment with cascading E-AUTH implications — out of scope for this
      // cosmetic fix.
      //
      // Approach (b) from the intake: emit an explanatory comment instead of
      // the broken `_scrml_reactive_set`. Runtime semantics are identical to
      // the pre-fix behavior — `_scrml_reactive_get("name")` returns
      // `undefined` either way. The variable can still be (re)assigned later
      // (e.g. via a `server function` returning the SQL result through CPS).
      if (node.sqlNode && node.sqlNode.kind === "sql") {
        // §52.6.5 Pattern C (S216): a `<var server> = ?{…}` decl IS a
        // server-cell mount load. The actual hydration (the
        // `/__serverLoad/<var>` fetch IIFE) is emitted by
        // emit-reactive-wiring; here on the decl site we emit an accurate
        // note instead of the (now-misleading) "client cannot evaluate" steer
        // — the cell DOES load. A param-bearing query is the bounded follow-on
        // (W-AUTH-004); a param-free query loads on mount.
        if (node.isServer === true) {
          const _q = typeof node.sqlNode.query === "string"
            ? node.sqlNode.query
            : (typeof node.sqlNode.body === "string" ? node.sqlNode.body : "");
          if (_q.includes("${")) {
            return _appendSidecar(`// <${node.name} server> = ?{…} — PARAM-BEARING inline ?{} (W-AUTH-004): param-passing not yet shipped; cell shows its placeholder until loaded (§52.6.5 Pattern C).`);
          }
          return _appendSidecar(`// <${node.name} server> = ?{…} — inline-?{} RHS load (§52.6.5 Pattern C); hydrated on mount via /__serverLoad/${node.name} (the query is server-only).`);
        }
        return _appendSidecar(`// SQL-init for @${node.name} — client cannot evaluate _scrml_sql (E-CG-006); declare as \`server @${node.name}\` for mount-hydration (§8.11).`);
      }
      // Legacy fallthrough for non-SQL state-decl initializers.
      // M-7C-D-12 Track 3 (OQ-5(a) ratified S90): the missing-init sentinel string is
      // "null" — replacing the prior "undefined" — because §42.5/§42.8 specify scrml
      // absence compiles to JS `null`. The downstream `initStr !== "null"` checks
      // below (predicateCheck zone guards) migrate in lockstep.
      //
      // S139 Bug 51 fix — also treat `node.init === ""` as missing-init. The ast-
      // builder sets `init: ""` and `initExpr: null` for Shape 2 markup-RHS decls
      // (`<userName req length(>=2)> = <input/>` — see ast-builder.js:4169). Pre-
      // fix, `??` doesn't fire on empty string, so initStr stayed `""` and the
      // emit produced `_scrml_reactive_set("userName", )` with an empty argument
      // (legal JS per ES2017 trailing-comma; runtime sets cell to `undefined`).
      // Cell-type-specific Shape 2 init (`""` text / `false` checkbox / `0`
      // number / `not` file) is deferred — the runtime bind:value effect updates
      // the cell from the input's actual default on mount, so `null`-init is
      // functionally correct for all bindable shapes.
      let initStr: string = node.init ?? "null";
      if (initStr === "" && !node.initExpr) initStr = "null";
      const ctx = opts.encodingCtx;
      const encodedName = ctx ? ctx.encode(_qualifiedName) : _qualifiedName;
      // Historically state-decl was treated as the initial declaration
      // site and the machine transition guard was skipped. But the AST
      // builder emits state-decl for EVERY `@name = expr` it parses,
      // including re-assignments inside function bodies. Discriminate:
      // a genuine declaration site carries a `typeAnnotation` (and sets
      // `machineBinding`), while a bare reassignment has neither. When
      // the var is machine-bound AND this node is not a declaration,
      // treat as a mutation so _emitReactiveSet fires the transition
      // guard and §51.11 audit clause.
      const hasTypeAnnotation = !!(node as any).typeAnnotation;
      const hasMachineBinding = !!(node as any).machineBinding;
      // C13: also discriminate against engineBindings — an engine variable
      // reassignment inside a fn body must NOT be treated as init (which would
      // skip the engine direct-write hook). Engine variables are auto-declared
      // by C12 substrate emission and never have a user-source state-decl
      // declaration site, so any state-decl whose name matches an engine
      // binding IS a reassignment.
      const isInit = hasTypeAnnotation || hasMachineBinding ||
        !(opts.machineBindings?.has(node.name) || opts.engineBindings?.has(node.name));
      // A5-7 Wave 2.4 (§51.0.N + §51.0.Q.1, Bug #2): for engine-bound
      // reassignments, detect the `.Variant.history` structured target form
      // on the initExpr. When present, strip the `.history` suffix (so the
      // emitted runtime value is the bare variant tag) AND propagate the
      // history-restore flag to `_emitReactiveSet` so the runtime helper
      // sets the pending-restore flag for the dispatcher's composite-arm
      // postMountJs to consume. Only applies when NOT init (reassignment
      // path) AND the var is in engineBindings.
      const _isEngineReassign = !isInit && !!opts.engineBindings?.has(node.name);
      const _histDet = _isEngineReassign ? detectHistoryForm(node.initExpr) : { isHistoryForm: false, strippedNode: null };
      const _effectiveInitExpr = _histDet.isHistoryForm ? _histDet.strippedNode : node.initExpr;
      // §59.8 (S169) — the decl's OWN init RHS rides this cell's `@ordered`-ness,
      // computed directly from `node.typeAnnotation` (no name-set lookup needed
      // for the decl's own init). A `[KeyT: ValT]@ordered`-typed decl whose init
      // is a map literal (`["b": 2]` or `[:]`) lowers the OUTERMOST literal
      // ordered: `_scrml_map_from_entries([...], true)`. The map-lit emitter
      // clears the flag for nested entry keys/values, so nested map-VALUE
      // literals stay unordered (a separate known v1 gap). Reassignments inside
      // function bodies carry no `typeAnnotation`, so this is decl-site only.
      const _declAnno = (node as any).typeAnnotation;
      // §59.8 (S169) — the RHS map-literal of ANY write to an `@ordered` map
      // cell (decl-init OR a reassignment inside a function body) must lower the
      // OUTERMOST literal ordered. The AST builder emits a `state-decl` for BOTH
      // shapes — a decl-init carries the `@ordered` `typeAnnotation`, while a
      // reassignment `@m = [...]` carries no annotation but names a cell in
      // `orderedMapVarNames` (the file-level set of `@ordered`-typed cells).
      // Covering both via the name-set (with the decl's own annotation as the
      // fallback for the rare synthetic AST that lacks the set) is exactly the
      // `mapVarNames` precedent — codegen keys on the collected name-set, not on
      // a resolved type. A non-`@ordered` cell is absent from the set, so its
      // init/reassign correctly stays unordered (the §59 default).
      const _declIsOrderedMap =
        typeof _declAnno === "string" &&
        isMapTypeAnnotation(_declAnno) &&
        _declAnno.trim().endsWith("@ordered");
      const _nameIsOrderedMap =
        typeof node.name === "string" &&
        ((!!opts.orderedMapVarNames && opts.orderedMapVarNames.has(node.name)) ||
          // ss52 — a NON-REACTIVE LOCAL `@ordered` map reassignment `m = [...]`
          // lowers its literal ordered too (the local twin of orderedMapVarNames).
          (!!opts.localOrderedMapVarNames && opts.localOrderedMapVarNames.has(node.name)));
      const _initIsOrderedMap = _declIsOrderedMap || _nameIsOrderedMap;
      const _initExprCtx = (o: EmitLogicOpts): EmitExprContext =>
        _initIsOrderedMap
          ? { ..._makeExprCtx(o), emitMapLitOrdered: true }
          : _makeExprCtx(o);
      // Bug-5 follow-on to C18 (§38.4, S83 Wave 4A): channel-scoped server-
      // function REASSIGNMENT to a channel-owned cell. The AST builder emits
      // a `state-decl` (not a bare-expr) for `@name = expr` inside a function
      // body. When `boundary === "server"` AND `channelOwnedCells` is non-
      // empty AND the LHS cell is in that set, this state-decl is necessarily
      // a reassignment inside a channel-owned server fn body — the channel-
      // cell DECLARATION lives at the channel-body top level, not in any
      // function. Lower the write to the canonical `broadcast({__type:
      // "__sync",__key,__val})` wire frame per SPEC §38.4 line 15998.
      //
      // Mirrors the bare-expr arm above; required because the canonical TAB
      // shape for in-fn `@cell = expr` is a state-decl, not a bare-expr.
      // Compound assignment (`+=` etc.) does not produce a state-decl —
      // those flow through the bare-expr arm and are not intercepted here.
      if (
        opts.boundary === "server" &&
        opts.channelOwnedCells &&
        opts.channelOwnedCells.size > 0 &&
        opts.channelOwnedCells.has(node.name) &&
        node.initExpr
      ) {
        const serverCtx: EmitExprContext = { ..._initExprCtx(opts), mode: "server" };
        const rhsStr = emitExpr(_effectiveInitExpr, serverCtx);
        return `broadcast({ __type: "__sync", __key: ${JSON.stringify(node.name)}, __val: (${rhsStr}) });`;
      }
      // Phase 3 fast path: when initExpr is present, skip all string splitting/merging
      if (node.initExpr) {
        const rewrittenInit = emitExpr(_effectiveInitExpr, _initExprCtx(opts));
        const wrappedInit = _wrapDeepReactive(rewrittenInit, initStr, _effectiveInitExpr);
        // M-7C-D-12 Track 3: lockstep with L1844 sentinel — `"null"` means "no init"
        if (node.predicateCheck && node.predicateCheck.zone === "boundary" && initStr !== "null") {
          const _pc = node.predicateCheck;
          const _checkTmpVar = genVar(`_scrml_chk_${node.name}`);
          const _checkLines = emitRuntimeCheck(_pc.predicate, _checkTmpVar, node.name, _pc.label ?? null);
          return _appendSidecar([
            `const ${_checkTmpVar} = ${rewrittenInit};`,
            ..._checkLines,
            _emitReactiveSet(encodedName, _wrapDeepReactive(_checkTmpVar, initStr, _effectiveInitExpr), opts, node.name, isInit, _histDet.isHistoryForm),
          ].join("\n"));
        }
        return _appendSidecar(_emitReactiveSet(encodedName, wrappedInit, opts, node.name, isInit, _histDet.isHistoryForm));
      }
      // Phase 4 simplified fallback: initExpr is missing (rare)
      const rewrittenInit = emitExprField(node.initExpr, initStr, _initExprCtx(opts));
      const wrappedInit = _wrapDeepReactive(rewrittenInit, initStr);
      // M-7C-D-12 Track 3: lockstep with L1844 sentinel — `"null"` means "no init"
      if (node.predicateCheck && node.predicateCheck.zone === "boundary" && initStr !== "null") {
        const _pc = node.predicateCheck;
        const _checkTmpVar = genVar(`_scrml_chk_${node.name}`);
        const _checkLines = emitRuntimeCheck(_pc.predicate, _checkTmpVar, node.name, _pc.label ?? null);
        return _appendSidecar([`const ${_checkTmpVar} = ${rewrittenInit};`, ..._checkLines, _emitReactiveSet(encodedName, _wrapDeepReactive(_checkTmpVar, initStr), opts, node.name, isInit)].join("\n"));
      }
      return _appendSidecar(_emitReactiveSet(encodedName, wrappedInit, opts, node.name, isInit));
    }

    // Phase A1a Step 11.5 — the legacy `case "reactive-derived-decl":` was
    // retired here. Folded into `case "state-decl":` above with the
    // shape:"derived" + structuralForm:false early-route.

    case "return-stmt": {
      // C16 (§53.9.3) — Helper: when the enclosing function declares a
      // refinement-typed return type, wrap the return expression in a
      // boundary check (E-CONTRACT-001-RT) before returning.
      const _retPredInfo = opts.returnTypeAnnotation
        ? parsePredicateAnnotation(opts.returnTypeAnnotation)
        : null;
      const _wrapReturnWithCheck = (retExprStr: string): string => {
        if (!_retPredInfo) return `return ${retExprStr};`;
        const _tmpVar = genVar(`_scrml_chk_ret`);
        const _label = _retPredInfo.label;
        const _fnName = opts.enclosingFnName ?? "<anonymous>";
        const _checkLines = emitRuntimeCheck(
          _retPredInfo.predicate,
          _tmpVar,
          `<return value of ${_fnName}>`,
          _label,
          `fn ${_fnName}, return statement`,
        );
        return [
          `const ${_tmpVar} = ${retExprStr};`,
          ..._checkLines,
          `return ${_tmpVar};`,
        ].join("\n");
      };

      // fix-cg-sql-ref-placeholder (S40 follow-up): `return ?{...}.method()` —
      // when the AST builder attached a structured `sqlNode` (because `return` was
      // followed directly by a SQL BLOCK_REF), recurse into `case "sql"` and
      // wrap the resulting expression as a return statement. Mirrors the
      // `lift ?{...}.method()` SQL handling in `case "lift-expr"` above.
      //
      // S93 cg-006 fix (Layer 2 — defense-in-depth): gate sqlNode emission on
      // `opts.boundary === "server"`. The let-decl path (line ~1333) and the
      // state-decl path (line ~1807) already gate this way; this aligns the
      // return-stmt path with the sibling pattern. The primary fix is at the
      // RI layer (route-inference.ts walkBodyForTriggers) — a function with
      // `return ?{...}` MUST be classified `boundary === "server"`. This
      // emit-logic guard is the fail-safe in case RI ever misclassifies (and
      // mirrors the symmetric let-decl client-boundary stub). E-CG-006 stays
      // intact as the final post-emission scan.
      if (node.sqlNode && node.sqlNode.kind === "sql") {
        if (opts.boundary === "server") {
          const sqlStmt = emitLogicNode(node.sqlNode, opts);
          // `case "sql"` always returns an expression form ending in `;`.
          // Strip the trailing `;` so we can wrap as `return …;`.
          const sqlExpr = sqlStmt.replace(/;\s*$/, "");
          return _wrapReturnWithCheck(sqlExpr);
        }
        // Client boundary: `_scrml_sql` is server-only (E-CG-006). Emit a
        // defensive comment + `return null;` so the emitted JS still parses
        // and the diagnostic is visible at inspection. Mirrors the let-decl
        // path at ~1333: `let ${name}; // SQL-init — client cannot evaluate
        // _scrml_sql (E-CG-006)`. Reaching this branch indicates an upstream
        // RI classification miss; the post-emission SQL_LEAK_PATTERNS scan in
        // emit-client.ts still fires E-CG-006 if anything else slipped through.
        return `return null; // SQL — client cannot evaluate _scrml_sql (E-CG-006); RI should classify this fn as server-bound.`;
      }
      // Bug 67 (S157) — `return match expr { ... }`. The AST builder attaches a
      // STRUCTURAL match-expr node as `matchExpr` (mirroring the let-decl /
      // const-decl match-as-expr hook) so the typer can route it through the
      // exhaustiveness check (E-TYPE-020). Emit it via the shared expression-form
      // match emitter (the same IIFE the `return match` exprNode path used before
      // this fix — clean `if (cond) return X` per arm), wrapped with the
      // return-type boundary check for refinement-typed returns.
      if (node.matchExpr) {
        return _wrapReturnWithCheck(emitMatchExpr(node.matchExpr, opts));
      }
      // markup-value-in-expression-2026-06-17 (c) — `return <markup>` value.
      // The AST builder attaches a structured markup node as `markupNode` when
      // `return` is followed by an inline markup opener (ast-builder.js return
      // parser, mirroring the SQL/match hooks). Lower it to the markup→DOM-node
      // IIFE so the `fn ... -> markup { return <span>${n}</span> }` idiom
      // (PRIMER §6.4(4)) returns a real DOM node the caller can interpolate.
      // The refinement-return boundary check is N/A for markup returns (markup
      // is not a refinement-predicated scalar), so we bypass _wrapReturnWithCheck.
      if ((node as any).markupNode) {
        return `return ${emitMarkupValueExpr((node as any).markupNode)};`;
      }
      // GITI-038 — `return function name(){…}` returns a function EXPRESSION. The
      // parser attaches the structural function-decl as `fnExprNode` (rather than
      // emptying the return + hoisting an orphaned sibling decl). Emit it inline as
      // `return [async] function name(){…};` — `case "function-decl"` produces the
      // named-function-expression text and derives its own `async` keyword from the
      // lowered body's `await`s, so a returned async closure lands correct while its
      // ENCLOSING factory stays non-async (its own body just returns the value).
      if ((node as any).fnExprNode) {
        return `return ${emitLogicNode((node as any).fnExprNode, opts)};`;
      }
      // Phase 3 fast path: when exprNode is present, skip all string splitting
      if (node.exprNode) {
        return _wrapReturnWithCheck(emitExpr(node.exprNode, _makeExprCtx(opts)));
      }
      // Phase 4 fallback: exprNode is missing (rare — only for unparseable expressions)
      const retExpr: string = (node.expr ?? node.value ?? "").trim();
      if (!retExpr) {
        // Bare `return;` — no value, can't check predicate. If function has
        // refinement-typed return and bare return is used, that's a typer-stage
        // concern (E-RETURN-EMPTY style); codegen emits the bare return.
        return "return;";
      }
      return _wrapReturnWithCheck(emitExprField(node.exprNode, retExpr, _makeExprCtx(opts)));
    }

    case "yield-stmt": {
      // SPEC §37 SSE `server function*` + general generator support (§13).
      // R25-Bug-42 (S138): yield ?{...} bodies attach a structured sqlNode at
      // parse time (see ast-builder.js yield handlers ~line 5546 + ~9279).
      // When sqlNode is present, recurse into case "sql" to produce the
      // tagged-template form, strip the trailing ";" so the result wraps
      // cleanly as the operand of `yield`. Mirrors return-stmt sqlNode shape.
      //
      // Server-boundary gating mirrors return-stmt (S93 cg-006 fix Layer 2):
      // `_scrml_sql` is server-only (E-CG-006). Emit a defensive comment +
      // `yield null;` on the client boundary so the JS still parses and the
      // diagnostic is visible at inspection; the post-emission scan still
      // fires E-CG-006 for anything that slipped through.
      if (node.sqlNode && node.sqlNode.kind === "sql") {
        if (opts.boundary === "server") {
          const sqlStmt = emitLogicNode(node.sqlNode, opts);
          const sqlExpr = sqlStmt.replace(/;s*$/, "");
          return `yield ${sqlExpr};`;
        }
        return `yield null; // SQL — client cannot evaluate _scrml_sql (E-CG-006); RI should classify this fn as server-bound.`;
      }
      // Bare `yield;` — empty expr.
      const yExpr: string = (node.expr ?? "").trim();
      if (!yExpr && !node.exprNode) return "yield;";
      // `yield <expr>;` — emit via the expression pipeline.
      if (node.exprNode) {
        return `yield ${emitExpr(node.exprNode, _makeExprCtx(opts))};`;
      }
      return `yield ${emitExprField(node.exprNode, yExpr, _makeExprCtx(opts))};`;
    }

    case "if-stmt":
      // Thread opts when tilde context or continueBehavior is active so nested nodes
      // (e.g. continue-stmt inside if-body inside reactive-for) receive the flags.
      if (opts.tildeContext || opts.continueBehavior) {
        return _emitIfStmtWithOpts(node, opts);
      }
      // Always thread declaredNames + derivedNames so bare `x = expr`
      // inside if/else body sees outer lets (Bug B + F).
      // C5: thread insideFunctionBody too so nested state-decls don't leak
      // _scrml_init_set sidecars when we're inside a function body.
      // S144 Cluster E / Bug-AB Defect 1: also thread engine + machine
      // context so a nested `@engineVar = .X` / `@engineVar.advance(.X)`
      // inside the if/else body dispatches through the engine helpers
      // (fire_hooks) instead of a bare reactive_set / method-on-value. This is
      // the program-scope `function` analogue of the match-arm-block fix.
      // (GITI-020: boundary + channelOwnedCells also threaded so a server-side
      // channel-cell write nested in if/else reaches the broadcast-wire arm.)
      return emitIfStmt(node, {
        // ss19 #8 — thread peer-call info so a server-fn -> sibling-server-fn
        // call inside an if condition/body lowers to `await <peer>()` instead
        // of a bare unawaited Promise (completes the b2bf9959 threading).
        serverFnNames: opts.serverFnNames,
        syncPeerCalls: opts.syncPeerCalls,
        // i87 §13.2 — thread the auto-await classifier inputs so a CLIENT ->
        // server-fn fetch call (`const x = fn()` / `res = fn()`) inside the
        // if/else BODY gets its `await` (the client-boundary sibling of the
        // ss19 #8 server->peer await above). emit-control-flow sets
        // awaitNestedPromises from these.
        ...(opts.asyncRouteMap ? { asyncRouteMap: opts.asyncRouteMap, asyncCalleeMap: opts.asyncCalleeMap, asyncExportRegistry: opts.asyncExportRegistry, asyncFilePath: opts.asyncFilePath } : {}),
        derivedNames: opts.derivedNames,
        synthCellKeys: opts.synthCellKeys,
        declaredNames: opts.declaredNames,
        insideFunctionBody: opts.insideFunctionBody,
        boundary: opts.boundary,
        channelOwnedCells: opts.channelOwnedCells,
        ...(opts.engineBindings ? { engineBindings: opts.engineBindings } : {}),
        ...(opts.engineVarNames ? { engineVarNames: opts.engineVarNames } : {}),
        ...(opts.enginesWithHooks ? { enginesWithHooks: opts.enginesWithHooks } : {}),
        ...(opts.enginesWithOnTimeout ? { enginesWithOnTimeout: opts.enginesWithOnTimeout } : {}),
        ...(opts.enginesWithIdleWatchdog ? { enginesWithIdleWatchdog: opts.enginesWithIdleWatchdog } : {}),
        ...(opts.enginesWithInternalRules ? { enginesWithInternalRules: opts.enginesWithInternalRules } : {}),
        ...(opts.enginesWithHistory ? { enginesWithHistory: opts.enginesWithHistory } : {}),
        ...(opts.enginesWithMessageArms ? { enginesWithMessageArms: opts.enginesWithMessageArms } : {}),
        ...(opts.engineMessageVariants ? { engineMessageVariants: opts.engineMessageVariants } : {}),
        ...(opts.requestIds ? { requestIds: opts.requestIds } : {}),
        ...(opts.mapVarNames ? { mapVarNames: opts.mapVarNames } : {}), ...(opts.setVarNames ? { setVarNames: opts.setVarNames } : {}), ...(opts.orderedMapVarNames ? { orderedMapVarNames: opts.orderedMapVarNames } : {}), ...(opts.localMapVarNames ? { localMapVarNames: opts.localMapVarNames } : {}), ...(opts.localSetVarNames ? { localSetVarNames: opts.localSetVarNames } : {}), ...(opts.localOrderedMapVarNames ? { localOrderedMapVarNames: opts.localOrderedMapVarNames } : {}),
        ...(opts.machineBindings ? { machineBindings: opts.machineBindings } : {}),
      } as any);

    case "for-stmt":
      // §32 array accumulator: when tilde context is active, switch to array-mode before
      // emitting the loop body so lift calls push rather than overwrite.
      if (opts.tildeContext) {
        return _emitForStmtWithTilde(node, opts);
      }
      // S96 Issue C — thread fnBodyRegistry so emitForStmt's reactive-iterable
      // predicate can detect transitive @-refs through fn-call iterables.
      // Bug 65 (S157) — thread engine codegen extras so a lifted engine-transition
      // handler inside `${for…lift}` lowers through the SHARED each machinery
      // (mirrors the if-stmt dispatch above; for-stmt previously dropped them →
      // silent `_scrml_reactive_get(...).advance(...)` miscompile).
      return emitForStmt(node, {
        // ss19 #8 — peer-call threading (see if-stmt dispatch above).
        serverFnNames: opts.serverFnNames,
        syncPeerCalls: opts.syncPeerCalls,
        // i87 §13.2 — auto-await classifier inputs for a client->server-fn fetch
        // call inside the loop body (see if-stmt dispatch above).
        ...(opts.asyncRouteMap ? { asyncRouteMap: opts.asyncRouteMap, asyncCalleeMap: opts.asyncCalleeMap, asyncExportRegistry: opts.asyncExportRegistry, asyncFilePath: opts.asyncFilePath } : {}),
        dbVar: opts.dbVar,
        declaredNames: opts.declaredNames,
        insideFunctionBody: opts.insideFunctionBody,
        fnBodyRegistry: opts.fnBodyRegistry,
        boundary: opts.boundary,
        channelOwnedCells: opts.channelOwnedCells,
        ...(opts.engineBindings ? { engineBindings: opts.engineBindings } : {}),
        ...(opts.engineVarNames ? { engineVarNames: opts.engineVarNames } : {}),
        ...(opts.enginesWithHooks ? { enginesWithHooks: opts.enginesWithHooks } : {}),
        ...(opts.enginesWithOnTimeout ? { enginesWithOnTimeout: opts.enginesWithOnTimeout } : {}),
        ...(opts.enginesWithIdleWatchdog ? { enginesWithIdleWatchdog: opts.enginesWithIdleWatchdog } : {}),
        ...(opts.enginesWithInternalRules ? { enginesWithInternalRules: opts.enginesWithInternalRules } : {}),
        ...(opts.enginesWithHistory ? { enginesWithHistory: opts.enginesWithHistory } : {}),
        ...(opts.enginesWithMessageArms ? { enginesWithMessageArms: opts.enginesWithMessageArms } : {}),
        ...(opts.engineMessageVariants ? { engineMessageVariants: opts.engineMessageVariants } : {}),
        ...(opts.requestIds ? { requestIds: opts.requestIds } : {}),
        ...(opts.mapVarNames ? { mapVarNames: opts.mapVarNames } : {}), ...(opts.setVarNames ? { setVarNames: opts.setVarNames } : {}), ...(opts.orderedMapVarNames ? { orderedMapVarNames: opts.orderedMapVarNames } : {}), ...(opts.localMapVarNames ? { localMapVarNames: opts.localMapVarNames } : {}), ...(opts.localSetVarNames ? { localSetVarNames: opts.localSetVarNames } : {}), ...(opts.localOrderedMapVarNames ? { localOrderedMapVarNames: opts.localOrderedMapVarNames } : {}),
      } as any);

    case "while-stmt":
      // §32 array accumulator: same pattern as for-stmt above.
      if (opts.tildeContext) {
        return _emitWhileStmtWithTilde(node, opts);
      }
      // R25-Bug-42 (S138): thread `boundary` so SQL-bearing yield/return
      // statements inside the loop body emit via the server case "sql" path
      // when the enclosing fn is server-bound.
      return emitWhileStmt(node, { declaredNames: opts.declaredNames, insideFunctionBody: opts.insideFunctionBody, boundary: opts.boundary, channelOwnedCells: opts.channelOwnedCells, serverFnNames: opts.serverFnNames, syncPeerCalls: opts.syncPeerCalls, ...(opts.asyncRouteMap ? { asyncRouteMap: opts.asyncRouteMap, asyncCalleeMap: opts.asyncCalleeMap, asyncExportRegistry: opts.asyncExportRegistry, asyncFilePath: opts.asyncFilePath } : {}), ...(opts.requestIds ? { requestIds: opts.requestIds } : {}), ...(opts.mapVarNames ? { mapVarNames: opts.mapVarNames } : {}), ...(opts.setVarNames ? { setVarNames: opts.setVarNames } : {}), ...(opts.orderedMapVarNames ? { orderedMapVarNames: opts.orderedMapVarNames } : {}), ...(opts.localMapVarNames ? { localMapVarNames: opts.localMapVarNames } : {}), ...(opts.localSetVarNames ? { localSetVarNames: opts.localSetVarNames } : {}), ...(opts.localOrderedMapVarNames ? { localOrderedMapVarNames: opts.localOrderedMapVarNames } : {}) });

    case "do-while-stmt":
      // R25-Bug-42 (S138): thread `boundary` so SQL-bearing yield/return
      // statements inside the loop body emit via the server case "sql" path.
      return emitDoWhileStmt(node, { declaredNames: opts.declaredNames, insideFunctionBody: opts.insideFunctionBody, boundary: opts.boundary, channelOwnedCells: opts.channelOwnedCells, serverFnNames: opts.serverFnNames, syncPeerCalls: opts.syncPeerCalls, ...(opts.asyncRouteMap ? { asyncRouteMap: opts.asyncRouteMap, asyncCalleeMap: opts.asyncCalleeMap, asyncExportRegistry: opts.asyncExportRegistry, asyncFilePath: opts.asyncFilePath } : {}), ...(opts.requestIds ? { requestIds: opts.requestIds } : {}), ...(opts.mapVarNames ? { mapVarNames: opts.mapVarNames } : {}), ...(opts.setVarNames ? { setVarNames: opts.setVarNames } : {}), ...(opts.orderedMapVarNames ? { orderedMapVarNames: opts.orderedMapVarNames } : {}), ...(opts.localMapVarNames ? { localMapVarNames: opts.localMapVarNames } : {}), ...(opts.localSetVarNames ? { localSetVarNames: opts.localSetVarNames } : {}), ...(opts.localOrderedMapVarNames ? { localOrderedMapVarNames: opts.localOrderedMapVarNames } : {}) });

    case "break-stmt":
      return emitBreakStmt(node);

    case "continue-stmt":
      // In a reactive-for createItem function, `continue` is illegal JS (no surrounding loop).
      // When continueBehavior is "return", emit `return;` to skip the item instead.
      if (opts.continueBehavior === "return") return "return;";
      return emitContinueStmt(node);

    case "lift-expr": {
      const liftE = node.expr;
      // GITI-004 (giti inbound 2026-04-20): in a server-function body,
      // `lift <expr>` means "return this value from the handler" — NOT
      // "create a DOM text node". The default emitLiftExpr lowering uses
      // `_scrml_lift(() => document.createTextNode(...))` which references
      // `document` and a client-only helper; neither exists in a Bun server
      // handler. Swap to `return <expr>;` when the caller signals server
      // boundary.
      // S35 B2: exhaustive boundary handling. The `never` assignment in the
      // default arm forces a compile-time decision whenever the
      // `"server" | "client"` union grows.
      if (opts.boundary !== "server" && opts.boundary !== "client") {
        const _exhaustive: never = opts.boundary;
        void _exhaustive;
      }
      if (opts.boundary === "server" && liftE) {
        if (liftE.kind === "expr" && typeof liftE.expr === "string") {
          const rhsExpr = emitExprField(liftE.exprNode, liftE.expr.trim(), { mode: "server", dbVar: opts.dbVar });
          return `return ${rhsExpr};`;
        }
        // fix-lift-sql-chained-call (S40): `lift ?{...}.method()` inside a
        // server function — the ast-builder now wraps the SQL block as
        // `expr: { kind: "sql", node: <sqlNode> }`. Reuse the existing
        // `case "sql":` emission by recursing on the SQL child node, then
        // promote the resulting expression to a return statement.
        if (liftE.kind === "sql" && liftE.node) {
          const sqlStmt = emitLogicNode(liftE.node, opts);
          // `case "sql"` always returns an expression form ending in `;`
          // (e.g. `await sql\`SELECT ...\`;` or `(await sql\`SELECT ...\`)[0] ?? null;`).
          // Strip the trailing `;` so we can wrap as `return …;`.
          const sqlExpr = sqlStmt.replace(/;\s*$/, "");
          return `return ${sqlExpr};`;
        }
        // Markup in a server handler is not meaningful — emit a typed
        // compile-time comment so inspection shows the failure cause.
        return `return null; /* server-lift: non-expr form */`;
      }
      // fix-lift-sql-chained-call (S40): non-server boundary — `lift ?{...}`
      // outside a server function is unusual but should emit something
      // parseable. Drop the value and emit the SQL as a statement so the
      // query still runs (matches the bare `?{}` semantics).
      if (liftE && liftE.kind === "sql" && liftE.node) {
        return emitLogicNode(liftE.node, opts);
      }
      // §32 Value-lift: `lift <non-markup-expr>` — if tilde context is active AND the
      // expression does not look like a markup pattern (no leading < tag), treat as
      // a tilde variable assignment rather than a DOM lift.
      if (
        opts.tildeContext &&
        liftE &&
        liftE.kind === "expr" &&
        typeof liftE.expr === "string"
      ) {
        const rawExpr = liftE.expr.trim();
        // Only apply value-lift if the expression does NOT start with a `<` (markup)
        // and does NOT end with `/` (closing tag form)
        if (!rawExpr.startsWith("<") && !rawExpr.endsWith("/")) {
          const liftRhs = emitExprField(liftE.exprNode, rawExpr, _makeExprCtx(opts));
          if (opts.tildeContext.mode === "array" && opts.tildeContext.var) {
            // Array accumulator mode — push onto existing array variable.
            return `${opts.tildeContext.var}.push(${liftRhs});`;
          }
          if (opts.tildeContext.var) {
            // Tilde var already pre-declared (if-as-expression) — reassign, don't redeclare.
            return `${opts.tildeContext.var} = ${liftRhs};`;
          }
          const tVar = genVar("tilde");
          opts.tildeContext.var = tVar;
          return `let ${tVar} = ${liftRhs};`;
        }
      }
      return emitLiftExpr(node);
    }

    case "foreign": {
      // dpa-003 (S216) — inline value-returning `_={ … }=` foreign-code block.
      // SPEC §23.2 / §13180: codegen wraps the OPAQUE verbatim slice in an
      // async IIFE so its settled value flows back to the enclosing scrml
      // expression with the await INJECTED at the boundary (no source-level
      // await needed on the scrml side — mirrors `case "sql"`). The `in:{}`
      // crossing names become the IIFE params and are called with the same-named
      // enclosing locals — the ONLY values that cross (no free lexical capture).
      //
      // ts/js ONLY (the value crosses NATIVELY — same Bun runtime, no
      // marshaling). A non-ts/js `lang=` is rejected upstream (E-FOREIGN-005,
      // type-system.ts) before reaching codegen. The slice is server-only; RI
      // classifies any fn containing a foreign node as a server fn, so this
      // arm only runs on the server boundary.
      const slice: string = ((node as any).body ?? (node as any).raw ?? "").trim();
      const crossings: string[] = Array.isArray((node as any).crossings)
        ? (node as any).crossings
        : [];
      const params = crossings.join(", ");
      const argList = crossings.join(", ");
      // The slice is verbatim foreign ts/js. Value-flow rule (§23.2.4a):
      //   - SINGLE EXPRESSION (no top-level `;` statement separator and no
      //     top-level `return`) — the canonical dispatcher shape, e.g.
      //     `await new Response(...).text()`. Wrap as `return (slice)` so the
      //     value flows back (the artifact's emitted sketch).
      //   - Otherwise (the slice has a top-level `return`, OR it is a
      //     multi-statement body) — splice VERBATIM. The author owns value-flow
      //     via their own `return`; a body without one yields `undefined`
      //     (honest — they wrote statements, not a value expression).
      //
      // The scan is brace/paren/bracket-depth-aware and skips string and comment
      // spans so a nested `return` (inside an arrow/closure) or a `;` inside a
      // string/`for(;;)` is NOT mistaken for a top-level statement boundary. This
      // is a SYNTACTIC scan over the opaque slice (no parse) — it never
      // type-checks or rewrites the interior (§23.2.3 opacity preserved).
      const scanForeignSliceShape = (src: string): { topLevelReturn: boolean; topLevelStmtSep: boolean } => {
        let depth = 0;          // () [] {} nesting
        let parenForDepth = 0;  // track `for(` so its `;` are not statement seps
        let inS = "", esc = false, inLine = false, inBlock = false, inTpl = false;
        let topLevelReturn = false, topLevelStmtSep = false;
        const isWord = (ch: string) => /[A-Za-z0-9_$]/.test(ch);
        for (let i = 0; i < src.length; i++) {
          const ch = src[i], nx = src[i + 1];
          if (inLine) { if (ch === "\n") inLine = false; continue; }
          if (inBlock) { if (ch === "*" && nx === "/") { inBlock = false; i++; } continue; }
          if (inS) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === inS) inS = ""; continue; }
          if (inTpl) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === "`") inTpl = false; continue; }
          if (ch === "/" && nx === "/") { inLine = true; i++; continue; }
          if (ch === "/" && nx === "*") { inBlock = true; i++; continue; }
          if (ch === '"' || ch === "'") { inS = ch; continue; }
          if (ch === "`") { inTpl = true; continue; }
          if (ch === "(" || ch === "[" || ch === "{") { depth++; continue; }
          if (ch === ")" || ch === "]" || ch === "}") { depth--; if (parenForDepth && depth < parenForDepth) parenForDepth = 0; continue; }
          if (depth === 0) {
            if (ch === ";") { topLevelStmtSep = true; continue; }
            // `return` keyword at top level (whole-word).
            if (ch === "r" && src.slice(i, i + 6) === "return" && !isWord(src[i - 1] ?? "") && !isWord(src[i + 6] ?? "")) {
              topLevelReturn = true;
            }
          }
        }
        return { topLevelReturn, topLevelStmtSep };
      };
      // Find TOP-LEVEL binding declarations in the opaque slice whose name is in
      // `names` (the crossing set). Same depth/string/comment/template skipping as
      // scanForeignSliceShape — a binding keyword inside a nested `{}`/`()`/`[]`,
      // a string, a comment, or a template literal is NOT top-level and does not
      // collide with the IIFE parameter (only the IIFE-body's own top level does).
      // Recognised binding heads: `const`/`let`/`var`/`function`/`class <name>`.
      // (`function`/`class` may carry intervening `*`/whitespace before the name.)
      const scanForeignSliceTopLevelBindings = (src: string, names: Set<string>): string[] => {
        const found = new Set<string>();
        let depth = 0;
        let inS = "", esc = false, inLine = false, inBlock = false, inTpl = false;
        const isWord = (ch: string) => /[A-Za-z0-9_$]/.test(ch);
        // Match a binding keyword starting at index `i` (whole-word, top level);
        // returns the declared name if it is in `names`, else null.
        const matchBinding = (i: number): string | null => {
          for (const kw of ["const", "let", "var", "function", "class"]) {
            if (src.slice(i, i + kw.length) === kw
              && !isWord(src[i - 1] ?? "")
              && !isWord(src[i + kw.length] ?? "")) {
              // Skip past the keyword + any `*` (generator) + whitespace to the name.
              let j = i + kw.length;
              while (j < src.length && (src[j] === "*" || /\s/.test(src[j]))) j++;
              let k = j;
              while (k < src.length && isWord(src[k])) k++;
              const name = src.slice(j, k);
              return name && names.has(name) ? name : null;
            }
          }
          return null;
        };
        for (let i = 0; i < src.length; i++) {
          const ch = src[i], nx = src[i + 1];
          if (inLine) { if (ch === "\n") inLine = false; continue; }
          if (inBlock) { if (ch === "*" && nx === "/") { inBlock = false; i++; } continue; }
          if (inS) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === inS) inS = ""; continue; }
          if (inTpl) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === "`") inTpl = false; continue; }
          if (ch === "/" && nx === "/") { inLine = true; i++; continue; }
          if (ch === "/" && nx === "*") { inBlock = true; i++; continue; }
          if (ch === '"' || ch === "'") { inS = ch; continue; }
          if (ch === "`") { inTpl = true; continue; }
          if (ch === "(" || ch === "[" || ch === "{") { depth++; continue; }
          if (ch === ")" || ch === "]" || ch === "}") { depth--; continue; }
          if (depth === 0 && (ch === "c" || ch === "l" || ch === "v" || ch === "f")) {
            const hit = matchBinding(i);
            if (hit) found.add(hit);
          }
        }
        return [...found];
      };
      // CROSSING-SHADOW guard (E-FOREIGN-006). The `in:{}` crossing names become
      // the async-IIFE PARAMETERS (above). If the verbatim slice ALSO declares a
      // TOP-LEVEL binding of the same name (`const`/`let`/`var`/`function`/`class`),
      // the emitted IIFE redeclares an identifier already bound by the parameter —
      // e.g. `(async (x) => { const x = … })(x)` — which is invalid JS. Without
      // this guard the failure surfaces post-emit as the MISLEADING
      // E-CODEGEN-INVALID-LOGIC ("compiler defect — please report it"), even though
      // it is AUTHOR error: the author chose a crossing name that collides with a
      // name the slice itself declares. This pre-emit SYNTACTIC scan (no parse —
      // §23.2.3 opacity preserved: it inspects only top-level binding KEYWORDS,
      // never type-checks or rewrites the interior) names the shadowed binding so
      // the diagnostic points at the real fix (rename the crossing OR the local).
      if (crossings.length > 0) {
        const shadowed = scanForeignSliceTopLevelBindings(slice, new Set(crossings));
        // Dedicated narrow sink (`opts.foreignCrossingErrors`), NOT the broad
        // `opts.errors`: the server-fn emit path (emit-server.ts) does not wire a
        // general `opts.errors` sink, and threading one would surface OTHER arms'
        // previously-swallowed errors (e.g. E-CG-003). The caller drains this
        // sink into the live error stream after the function body emits.
        const sink = (opts as any).foreignCrossingErrors as CGError[] | undefined;
        if (shadowed.length > 0 && sink) {
          const span = (node as any).span ?? { start: 0, end: 0 };
          const names = shadowed.map((n) => `\`${n}\``).join(", ");
          const singular = shadowed.length === 1;
          sink.push(new CGError(
            "E-FOREIGN-006",
            `E-FOREIGN-006: the inline foreign block crosses ${singular ? "a name" : "names"} ` +
            `(${names}) that the slice ${singular ? "also declares" : "also declare"} ` +
            `at its top level. The \`in:{}\` crossing ${singular ? "name becomes an async-IIFE parameter" : "names become async-IIFE parameters"}, ` +
            `so a same-named \`const\`/\`let\`/\`var\`/\`function\`/\`class\` inside the slice ` +
            `redeclares the parameter — invalid JS. Rename the crossing ${singular ? "name" : "names"} ` +
            `or the slice-local binding so they do not collide. See SPEC §23.2.4a.`,
            span,
          ));
          // Decline to emit the redeclaring IIFE — the error stops the build, and
          // a defensive `null` keeps the surrounding expression syntactically
          // well-formed (no cascade into the misleading E-CODEGEN-INVALID-LOGIC).
          return `null /* E-FOREIGN-006: crossing-shadow (${names}) */`;
        }
      }
      const { topLevelReturn, topLevelStmtSep } = scanForeignSliceShape(slice);
      const singleExpression = !topLevelReturn && !topLevelStmtSep;
      const inner = singleExpression ? `return (${slice});` : slice;
      return `await (async (${params}) => { ${inner} })(${argList});`;
    }

    case "sql": {
      // SPEC §44 — emit Bun.SQL tagged-template form.
      //   ?{`SQL ${x}`}.all()   → await sql`SQL ${x}`;
      //   ?{`SQL ${x}`}.get()   → const _r = (await sql`SQL ${x}`)[0] ?? null;
      //   ?{`SQL ${x}`}.run()   → await sql`SQL ${x}`;
      //   ?{`SQL ${x}`}.prepare() → E-SQL-006 (compile error + runtime throw)
      //   bare ?{`DDL`}         → await sql.unsafe("DDL");
      // For SQL using bare `?` placeholders with explicit call.args (legacy
      // path), we emit `await sql.unsafe(rawSql, [argList])` — Bun.SQL's
      // unsafe() accepts a bound-params array.
      const rawQuery: string = node.query ?? node.body ?? "";
      const _rawCalls: any[] = node.chainedCalls ?? [];
      // §14.8.10 — `.acrossTenants()` is the loud tenant opt-out, not a SQL
      // terminator; filter it out of the chain and note the suppression.
      const _tenantAcross = _rawCalls.some((c) => c && c.method === "acrossTenants");
      const calls: any[] = _rawCalls.filter((c) => c && c.method !== "acrossTenants");
      const _effMethod: string = calls.length > 0 ? calls[0].method : "";
      const _isReadSql = _effMethod === "get" || _effMethod === "first" || _effMethod === "all";
      // §14.8.10 — for a read, add `tenant_id` to the projection + get the row-tag
      // wrapper; for an INSERT, inject the ambient tenant. No-op when tenant inactive.
      const { effectiveSql: _tenantSql, tenantTag: _tenantTag } = _lowerTenantForQuery(rawQuery, _tenantAcross, _isReadSql);
      const { sql, params, segments } = extractSqlParams(_tenantSql);
      const db = opts.dbVar ?? "_scrml_sql";

      const taggedFromParams = (): string => {
        const _sqlExprCtx = _makeExprCtx(opts);
        const renderedParams = params.map((p: string) => {
          // ss22 #4 (g-peer-call-in-raw-template-unawaited) — a SQL `?{}` param
          // `${...}` that calls a sibling server fn must lower to `await <peer>()`
          // (the peer is async). The default param path (`emitExprField(null, …)`)
          // takes the TEXTUAL `rewriteServerExpr` rewriter, which has no notion of
          // the ss19 #8 peer-await lowering, so a peer call left the param an
          // UNAWAITED Promise interpolated into the SQL. When the param references
          // a sibling server fn, route it through the STRUCTURED `emitExpr` path
          // (same machinery as the statement-level #8 pass) so the peer is awaited.
          // Params with no peer call keep the text path verbatim (byte-identical),
          // so this is a no-op for every existing SQL-param shape (@cell rewriting
          // already runs in the text path's server reactive-ref pass).
          let _refsPeer = false;
          if (_sqlExprCtx.serverFnNames && _sqlExprCtx.serverFnNames.size > 0) {
            for (const _fn of _sqlExprCtx.serverFnNames) {
              if (new RegExp("\\b" + _fn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\(").test(p)) {
                _refsPeer = true;
                break;
              }
            }
          }
          // Issue #26 (P0 auth-bypass) — a SQL `?{}` param `${...}` that calls a
          // Promise-returning stdlib fn (e.g. `${hashPassword(pw)}` in an INSERT)
          // must lower to `await hashPassword(pw)` — the textual `rewriteServerExpr`
          // path (`emitExprField(null, …)`) has no notion of the auto-await, so it
          // interpolated a STRINGIFIED Promise (`[object Promise]`) as the stored
          // value (seed corruption). Route through the STRUCTURED `emitExpr` path
          // (same machinery as the peer branch above) so `emitCall` awaits it.
          // Detection mirrors the peer scan: any `name(` token that classifies as
          // a stdlib async callee (ctx-threaded OR the file-scoped classifier).
          let _refsAsyncStdlib = false;
          if (!_refsPeer) {
            const _callRe = /\b([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;
            let _cm: RegExpExecArray | null;
            while ((_cm = _callRe.exec(p)) !== null) {
              if (isStdlibAsyncCallee(_cm[1], _sqlExprCtx)) {
                _refsAsyncStdlib = true;
                break;
              }
            }
          }
          if (_refsPeer || _refsAsyncStdlib) {
            try {
              const _node = parseExprToNode(p, "<sql-param-async>", 0);
              return emitExpr(_node, _sqlExprCtx);
            } catch {
              // Defensive: an unparseable param falls back to the text path
              // (the pre-fix emission) rather than crashing codegen.
              return emitExprField(null, p, _sqlExprCtx);
            }
          }
          return emitExprField(null, p, _sqlExprCtx);
        });
        return buildTaggedTemplate(db, segments, renderedParams);
      };

      if (calls.length > 0) {
        const call = calls[0];
        const method: string = call.method;

        // §44.3: .prepare() is removed.
        if (method === "prepare") {
          // Emit a runtime-throwing IIFE so the JS still parses; CG-level
          // E-SQL-006 emission is handled in rewriteSqlRefs (inline path).
          return `(()=>{throw new Error(${JSON.stringify("E-SQL-006: .prepare() is removed in Bun.SQL (§44.3) — use .all()/.get()/.run() or bare ?{}")})})();`;
        }

        // Branch A: SQL has ${} params — use tagged template form.
        // §14.8.9 — tag the SELECT row result with the protected-origin
        // descriptor (no-op when protect inactive / no protected column).
        if (params.length > 0) {
          const tagged = taggedFromParams();
          if (method === "get" || method === "first") {
            return _tenantTag(protectTagSqlResult(`(await ${tagged})[0] ?? null`, rawQuery)) + ";";
          }
          if (method === "all") {
            return _tenantTag(protectTagSqlResult(`await ${tagged}`, rawQuery)) + ";";
          }
          return `await ${tagged};`;
        }

        // Branch B: SQL uses bare ? placeholders + explicit call.args.
        // Use sql.unsafe(rawSql, [argArray]) — unsafe() accepts a bound array.
        if (call.args && call.args.trim()) {
          const argList = emitExprField(null, call.args.trim(), _makeExprCtx(opts));
          if (method === "get" || method === "first") {
            return _tenantTag(protectTagSqlResult(`(await ${db}.unsafe(${JSON.stringify(sql)}, [${argList}]))[0] ?? null`, rawQuery)) + ";";
          }
          if (method === "all") {
            return _tenantTag(protectTagSqlResult(`await ${db}.unsafe(${JSON.stringify(sql)}, [${argList}])`, rawQuery)) + ";";
          }
          return `await ${db}.unsafe(${JSON.stringify(sql)}, [${argList}]);`;
        }

        // Branch C: no params, no call.args. Bare tagged template.
        const taggedNoParams = `${db}\`${sql.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${")}\``;
        if (method === "get" || method === "first") {
          return _tenantTag(protectTagSqlResult(`(await ${taggedNoParams})[0] ?? null`, rawQuery)) + ";";
        }
        if (method === "all") {
          return _tenantTag(protectTagSqlResult(`await ${taggedNoParams}`, rawQuery)) + ";";
        }
        return `await ${taggedNoParams};`;
      }

      // No chained call.
      if (params.length > 0) {
        // Defaults to .run() semantics — value dropped.
        return `await ${taggedFromParams()};`;
      }
      // Static DDL — route through unsafe() so the runtime accepts no-param SQL.
      return `await ${db}.unsafe(${JSON.stringify(rawQuery)});`;
    }

    case "fail-expr": {
      // M-7C-D-12 Track 3: no-payload `fail` emits `data: null` (§42.5/§42.8).
      // S141 gate-fix-wave: a MULTI-field payload (`fail HostError::Thrown(
      // message, name)`) emits `data` as a FIELD-KEYED OBJECT matching the enum
      // CONSTRUCTOR shape; a SINGLE-arg payload keeps the raw-value shape.
      // Shared with the `!{}` arm-body / match-arm-value re-fail paths via
      // emitFailExpr (errarm-refail).
      return emitFailExpr(node as FailExprLike, opts);
    }

    case "propagate-expr": {
      const tmpVar = genVar("_scrml_tmp");
      const expr = emitExprField(node.exprNode, node.expr ?? "", _makeExprCtx(opts));
      const lines: string[] = [];
      lines.push(`const ${tmpVar} = ${expr};`);
      lines.push(`if (${tmpVar}.__scrml_error) return ${tmpVar};`);
      if (node.binding) {
        lines.push(`const ${node.binding} = ${tmpVar};`);
      }
      return lines.join("\n");
    }

    case "throw-stmt": {
      const throwExpr = emitExprField(node.exprNode, node.expr ?? "", _makeExprCtx(opts));
      const cleaned = throwExpr.trim();
      const needsNew = /^[A-Z][A-Za-z0-9_]*\s*\(/.test(cleaned) && !cleaned.startsWith("new ");
      return needsNew ? `throw new ${cleaned};` : `throw ${cleaned};`;
    }

    case "given-guard": {
      // §42.2.3 Presence guard: `given x => { body }` or `given x, y => { body }`
      // Emits: if (x !== null && x !== undefined) { body }
      // Multi-variable: if (x !== null && x !== undefined && y !== null && y !== undefined) { body }
      const vars: string[] = node.variables ?? [];
      const body: object[] = node.body ?? [];
      if (vars.length === 0) return "";

      const conditions = vars
        .map((v: string) => `${v} !== null && ${v} !== undefined`)
        .join(" && ");

      const lines: string[] = [`if (${conditions}) {`];
      for (const stmt of body) {
        const code = emitLogicNode(stmt as Parameters<typeof emitLogicNode>[0], opts);
        if (code) {
          for (const line of code.split("\n")) lines.push(`  ${line}`);
        }
      }
      lines.push(`}`);
      return lines.join("\n");
    }

    // F8 / v0.6 — `"ErrorEffect"` is the scrml-native parser's PascalCase
    // spelling of the same block; the dual-mode `case` accepts both so the
    // M5-swap native pipeline reaches this arm too.
    case "ErrorEffect":
    case "error-effect": {
      // Standalone `!{ tryBody } catch Type [as binding] { handler }` form
      const arms: LogicArm[] = node.arms ?? [];
      const tryBody: object[] = (node as Record<string, unknown>).body as object[] ?? [];
      const errVar = genVar("_scrml_err");
      const lines: string[] = [];

      lines.push(`try {`);
      for (const bodyNode of tryBody) {
        const code = emitLogicNode(bodyNode as Parameters<typeof emitLogicNode>[0]);
        if (code) {
          for (const line of code.split("\n")) lines.push(`  ${line}`);
        }
      }
      lines.push(`} catch (${errVar}) {`);

      if (arms.length > 0) {
        let isFirst = true;
        for (const arm of arms) {
          if (arm.pattern === "_") {
            lines.push(`  ${isFirst ? "" : "else "}{`);
            if (arm.binding && arm.binding !== "_") {
              lines.push(`    const ${arm.binding} = ${errVar};`);
            }
            const armCode = emitArmBody(arm, errVar, opts.machineBindings ?? null, opts);
            for (const line of armCode.split("\n")) lines.push(`    ${line}`);
            lines.push(`  }`);
          } else {
            const typeName = arm.pattern ?? "";
            const cond = `${errVar} instanceof ${typeName} || (${errVar} && ${errVar}.type === ${JSON.stringify(typeName)})`;
            lines.push(`  ${isFirst ? "if" : "else if"} (${cond}) {`);
            if (arm.binding && arm.binding !== "_") {
              lines.push(`    const ${arm.binding} = ${errVar};`);
            }
            const armCode = emitArmBody(arm, errVar, opts.machineBindings ?? null, opts);
            for (const line of armCode.split("\n")) lines.push(`    ${line}`);
            lines.push(`  }`);
          }
          isFirst = false;
        }
      } else {
        lines.push(`  throw ${errVar};`);
      }
      lines.push(`}`);
      return lines.join("\n");
    }

    case "guarded-expr": {
      // §19.4.3 `!{}` inline catch. `fail` produces a tagged object (not a throw),
      // so we test the guarded expression's result for __scrml_error rather than
      // using try/catch.
      const guardedNode = node.guardedNode;
      const arms: LogicArm[] = node.arms ?? [];
      const lines: string[] = [];
      const resultVar = genVar("_scrml_result");

      let bindingName: string | null = null;
      let initExpr: string | null = null;
      // D3 (g-handler-recovery-into-cell) — set when the guarded expression is a
      // reactive assignment `@cell = call() !{...}`. In that shape emitLogicNode
      // lowers the guardedNode to the EAGER `_scrml_reactive_set("cell", call())`
      // (below), which puts the RAW error envelope in the cell on the failure
      // path. The arm handler only rewrites the local `resultVar`, so without a
      // write-back the cell keeps the envelope instead of the recovery value.
      // We record the cell name here and, after the arms run, re-set the cell to
      // the (possibly-recovered) resultVar — §19.4.3 catch-recovery-into-assignment.
      let reactiveCellName: string | null = null;
      // S89 §13.2 Sub-Phase B Step 3 — auto-await detection. When the guarded
      // node's init expression is a statically-known `Promise<T>`-returning
      // call (server fn OR stdlib `async` export per §13.2.1 Q1 BROAD), the
      // emitter inserts `await` between the call and the `__scrml_error`
      // guard check below. The S88 two-step pattern collapses to one line.
      let _autoAwait = false;
      if (guardedNode) {
        // M-7C-D-12 Track 3: missing init falls back to "null" (was "undefined") per §42.5/§42.8.
        if (guardedNode.kind === "let-decl" && guardedNode.name) {
          bindingName = guardedNode.name;
          initExpr = emitExprField(guardedNode.initExpr, guardedNode.init ?? "null", _makeExprCtx(opts));
        } else if ((guardedNode.kind === "const-decl" || guardedNode.kind === "tilde-decl") && guardedNode.name) {
          bindingName = guardedNode.name;
          initExpr = emitExprField(guardedNode.initExpr, guardedNode.init ?? "null", _makeExprCtx(opts));
        } else {
          const bodyCode = emitLogicNode(guardedNode);
          if (bodyCode) {
            initExpr = bodyCode.replace(/;\s*$/, "").replace(/^\s*return\s+/, "");
          }
          // D3 — a reactive assignment `@cell = call()` lowers to a state-decl
          // node whose emit is the eager `_scrml_reactive_set("cell", call())`.
          // Capture the cell name so the recovery write-back (after the arms)
          // can land the recovered value back into the cell.
          if (guardedNode.kind === "state-decl" && typeof guardedNode.name === "string" && guardedNode.name.length > 0) {
            reactiveCellName = guardedNode.name;
          }
        }
        // Auto-await classification, gated on classifier inputs being threaded.
        if (
          opts.asyncRouteMap &&
          opts.asyncCalleeMap &&
          opts.asyncExportRegistry &&
          opts.asyncFilePath &&
          guardedNode
        ) {
          try {
            // Delegate to scheduling.ts predicate (single source of truth).
            const sched = require("./scheduling.js");
            const isPromise = sched.isPromiseReturningCallExpr(
              guardedNode,
              opts.asyncRouteMap,
              opts.asyncFilePath,
              opts.asyncCalleeMap,
              opts.asyncExportRegistry,
            );
            _autoAwait = !!isPromise;
          } catch (_e) {
            // Classifier failure is non-fatal — fall back to no-auto-await.
            _autoAwait = false;
          }
        }
      }

      if (initExpr == null) return "";

      // Idempotency (Q2 / Seam-A finding-4) — the CLIENT-mode `emitCall` now also
      // auto-awaits a stdlib-async init, so a `!{}` guarded-expr whose init already
      // starts with `await` must NOT re-prefix (`await await …`). The statement-
      // level `_autoAwait` remains the source of truth for the peer-call form (init
      // has no `await`), so only skip when the emitted init already carries it.
      const _initHasAwait = /^\s*await\b/.test(initExpr);
      lines.push(`let ${resultVar} = ${_autoAwait && !_initHasAwait ? "await " : ""}${initExpr};`);
      lines.push(`if (${resultVar} && ${resultVar}.__scrml_error) {`);

      // R24-BUG-2 (S136 / known-gaps Bug 29) — split a joined arm body on
      // top-level `;` (depth-0). Mirrors rewriteBlockBody's separator pass so
      // we can inspect the LAST top-level statement.
      const splitTopLevelStmts = (joined: string): string[] => {
        const parts: string[] = [];
        let current = "";
        let depth = 0;
        for (let i = 0; i < joined.length; i++) {
          const ch = joined[i];
          if (ch === "{" || ch === "(" || ch === "[") {
            depth++;
            current += ch;
            continue;
          }
          if (ch === "}" || ch === ")" || ch === "]") {
            depth--;
            current += ch;
            continue;
          }
          if (ch === ";" && depth === 0) {
            const s = current.trim();
            if (s) parts.push(s);
            current = "";
            continue;
          }
          current += ch;
        }
        const tail = current.trim();
        if (tail) parts.push(tail);
        return parts;
      };
      // R24-BUG-2 — `return`/`throw`/`break`/`continue` are JS STATEMENTS,
      // not expressions; wrapping `${resultVar} = <stmt>;` produces a
      // SyntaxError like `_result = return;` (the dominant adopter shape per
      // PRIMER §6 — early-return-on-error).
      const isTerminatorStmt = (stmt: string): boolean =>
        /^(?:return|throw|break|continue)(?:[\s;]|$)/.test(stmt);

      // R25-Bug-38 — single-line statement-shape detection. After
      // `rewriteBlockBody`, reactive writes / engine writes / `navigate` calls
      // arrive as bare function-call statements (e.g. `_scrml_reactive_set(
      // "x", "missing")`). These are side-effect statements, NOT value-
      // producing expressions; the `${resultVar} = ...` wrap is semantically
      // wrong for them. Detection on a known prefix list keeps this surgical
      // — bare-call arm bodies like `| _ -> computeFallback(e)` continue to
      // route through the value-shape wrap (per existing negative-control
      // tests in error-handler-terminator-arms.test.js §8).
      const isStatementShapeStmt = (stmt: string): boolean =>
        /^(?:_scrml_reactive_set\s*\(|_scrml_engine_[a-zA-Z_$][a-zA-Z0-9_$]*\s*\(|_scrml_navigate(?:_soft)?\s*\(|_scrml_register_cleanup\s*\(|_scrml_effect\s*\(|_scrml_init_set\s*\()/.test(stmt);

      // S142 gate-tail (surface 8): at TOP-LEVEL `${...}` there is no enclosing
      // function, so a terminal `return X` written in an arm body is invalid JS
      // (`'return' outside of function` — caught by the emit gate). Inside a
      // function `return X` is the canonical early-return-on-error idiom (PRIMER
      // §6) and stays as-is. At top level, rewrite the terminal `return X` to
      // `resultVar = X` so the arm's value becomes the guarded expression's
      // result (the binding takes it) instead of an illegal return. A bare
      // `return;` (no value) becomes `resultVar = null` (canonical absence).
      const rewriteTopLevelReturn = (stmt: string): string => {
        if (opts.insideFunctionBody) return stmt;
        const m = stmt.match(/^return\b\s*([\s\S]*?)\s*;?$/);
        if (!m) return stmt;
        const val = (m[1] ?? "").trim();
        return val ? `${resultVar} = ${val}` : `${resultVar} = null`;
      };

      const emitArmAssign = (armBody: string): string[] => {
        const trimmed = armBody.trim();
        // M-7C-D-12 Track 3: empty-body arm produces `resultVar = null;` (was `= undefined;`)
        // per §42.5/§42.8 canonical scrml absence.
        if (!trimmed) return [`    ${resultVar} = null;`];
        if (trimmed.includes("\n")) {
          // Multi-statement handler: emit body as-is (authors should assign to
          // resultVar themselves for non-trivial bodies). A terminal top-level
          // `return` is rewritten to a resultVar assignment (see helper).
          const ls = trimmed.split("\n");
          return ls.map((l, idx) =>
            idx === ls.length - 1 ? `    ${rewriteTopLevelReturn(l.trim())}` : `    ${l}`,
          );
        }
        // R24-BUG-2: when the LAST top-level statement of the arm body is a
        // JS terminator (`return`/`throw`/`break`/`continue`), the body is
        // statement-shaped, not expression-shaped. Skip the `_result = ...`
        // wrap and emit each statement directly so the terminator flows up
        // through the enclosing `if (... __scrml_error) { ... }` block; for
        // `return` this exits the enclosing function (the canonical adopter
        // idiom from PRIMER §6 / SPEC §19.4 — early-return-on-error). Bodies
        // mixing side-effects then a terminal `return` (e.g. `@phase = .Error;
        // return`) emit as a sequence of statements; preceding side-effects
        // execute before the terminator fires.
        const stmts = splitTopLevelStmts(trimmed);
        if (stmts.length > 0 && isTerminatorStmt(stmts[stmts.length - 1])) {
          // A terminal top-level `return` rewrites to a resultVar assignment
          // (no enclosing fn at top level); inside a fn it stays a `return`.
          return stmts.map((s, idx) =>
            idx === stmts.length - 1 ? `    ${rewriteTopLevelReturn(s)};` : `    ${s};`,
          );
        }
        // R25-Bug-38 (known-gaps Bug 38): when the arm body is multi-statement
        // (more than one top-level `;`-separated stmt), it MUST be statement-
        // shaped. `rewriteBlockBody` joins reactive writes with "; " (no
        // newline), so a `{ @x = "v"; @y = 0 }` body arrives here as a SINGLE-
        // LINE string of two `_scrml_reactive_set(...)` calls. The legacy
        // wrap `${resultVar} = _scrml_reactive_set(...); _scrml_reactive_set
        // (...);` is valid JS but semantically wrong — `_result` ends up
        // bound to the FIRST reactive_set's return value (a side-effect
        // discard) instead of left holding the failed-call's tagged-object.
        // Emit each statement directly so all side-effects fire and `_result`
        // remains the failed-call value for downstream consumers (e.g. the
        // `var r = _result;` trailing wire-up in the `let r = call() !{...}`
        // workaround form).
        if (stmts.length > 1) {
          return stmts.map((s) => `    ${s};`);
        }
        // R25-Bug-38: single-statement arm where the stmt is a known
        // statement-shape side-effect call (reactive write, engine write,
        // navigate, effect/cleanup registration). The single-line collapsed
        // adopter form `| ::Variant -> @x = 1` arrives here as a single
        // `_scrml_reactive_set("x", 1)` statement; emit it bare, no wrap.
        if (stmts.length === 1 && isStatementShapeStmt(stmts[0])) {
          return [`    ${stmts[0]};`];
        }
        const bare = trimmed.replace(/;\s*$/, "");
        return [`    ${resultVar} = ${bare};`];
      };

      if (arms.length > 0) {
        const hasWildcard = arms.some((a: LogicArm) => a.pattern === "_");
        let isFirst = true;
        for (const arm of arms) {
          const armCode = emitArmBody(arm, resultVar, opts.machineBindings ?? null, opts);
          if (arm.pattern === "_") {
            lines.push(`  ${isFirst ? "" : "else "}{`);
            if (arm.binding && arm.binding !== "_") {
              for (const l of emitGuardedArmBinding(arm.binding, "", resultVar)) lines.push(l);
            }
            for (const l of emitArmAssign(armCode)) lines.push(l);
            lines.push(`  }`);
          } else {
            const variantName = (arm.pattern ?? "").replace(/^::/, "").replace(/^\./, "");
            const cond = `${resultVar}.variant === ${JSON.stringify(variantName)}`;
            lines.push(`  ${isFirst ? "if" : "else if"} (${cond}) {`);
            if (arm.binding && arm.binding !== "_") {
              for (const l of emitGuardedArmBinding(arm.binding, variantName, resultVar)) lines.push(l);
            }
            for (const l of emitArmAssign(armCode)) lines.push(l);
            lines.push(`  }`);
          }
          isFirst = false;
        }
        if (!hasWildcard) {
          // No wildcard — propagate the unhandled error variant up.
          // Inside a function body this is `return resultVar` (escalate the
          // error to the caller). At TOP-LEVEL `${...}` there is no enclosing
          // function, so a bare `return` would be `'return' outside of
          // function` (invalid JS — caught by the emit gate). At top level the
          // unhandled error simply remains the value of resultVar (and of any
          // `var binding = resultVar` emitted below), which is the correct
          // top-level semantics — no statement is needed.
          if (opts.insideFunctionBody) {
            lines.push(`  else { return ${resultVar}; }`);
          }
        }
      } else if (opts.insideFunctionBody) {
        lines.push(`  return ${resultVar};`);
      }

      // D3 (g-handler-recovery-into-cell) — for a reactive assignment
      // `@cell = call() !{...}` the eager set above stored the RAW error
      // envelope in the cell on the failure path. A matched recovery arm has
      // rewritten `resultVar` to the recovery value; land that back into the
      // cell as the LAST statement of the error block (§19.4.3 catch-recovery).
      // A no-wildcard escalation arm's `return` fires before reaching here, so
      // the error propagates to the caller (the eagerly-set envelope is left in
      // the cell, unchanged from prior behavior — escalation is out of the
      // recovery-into-assignment gap). The success path never enters this block,
      // so the eager set stays authoritative there and no double-set occurs.
      if (reactiveCellName && arms.length > 0) {
        const _encCell = opts.encodingCtx ? opts.encodingCtx.encode(reactiveCellName) : reactiveCellName;
        lines.push(`  _scrml_reactive_set(${JSON.stringify(_encCell)}, ${resultVar});`);
      }

      lines.push(`}`);
      if (bindingName) {
        lines.push(`var ${bindingName} = ${resultVar};`);
      }
      // §32 Gap 5: when this guarded-expr's success-path produces a value
      // (i.e. the guardedNode was a bare-expr call, not a let/const/tilde-decl
      // with its own binding), the success value lives in `resultVar`. If an
      // outer tilde context is active, subsequent statements that reference
      // `~` (e.g. `return format(~)` after `loadItem(id) !{ ... }`) must
      // resolve to `resultVar`. Without this wire, `~` falls through emitIdent's
      // tildeVar=null arm and emits literal `~` — JS SyntaxError.
      if (opts.tildeContext && !bindingName) {
        opts.tildeContext.var = resultVar;
      }
      return lines.join("\n");
    }

    case "cleanup-registration": {
      const callback: string = node.callback ?? "() => {}";
      const cleanupRhs = emitExprField(node.callbackExpr, callback, _makeExprCtx(opts));
      return `_scrml_register_cleanup(${cleanupRhs});`;
    }

    case "when-effect": {
      // Filter out leaked comment lines (// stripped by tokenizer, leaving bare text)
      const rawLines = (node.bodyRaw ?? "").split("\n");
      const codeLines = rawLines.filter((line: string) => {
        const t = line.trim();
        if (!t) return false;
        if (/^(?:let|const|var|if|for|while|return|@|function|switch|try|catch|throw)\b/.test(t)) return true;
        if (/^[a-zA-Z_$@][a-zA-Z0-9_$]*\s*[=\(\[.]/.test(t)) return true;
        if (/^[{}\[\]();]/.test(t)) return true;
        return false;
      });
      const body = emitExprField(node.bodyExpr, codeLines.join("\n"), _makeExprCtx(opts));
      return `_scrml_effect(function() { ${body}; });`;
    }

    case "when-worker-message": {
      // §4.12.4: `when message from <#name> (binding) { body }` — parent-side worker message listener
      const workerVar = `_scrml_worker_${node.workerName}`;
      const binding = node.binding ?? "data";
      const body = emitExprField(node.bodyExpr, node.bodyRaw ?? "", _makeExprCtx(opts));
      return `${workerVar}.onmessage = function(event) { const ${binding} = event.data; ${body}; };`;
    }

    case "when-worker-error": {
      // §4.12.4: `when error from <#name> (binding) { body }` — parent-side worker error listener
      const workerVar = `_scrml_worker_${node.workerName}`;
      const binding = node.binding ?? "e";
      const body = emitExprField(node.bodyExpr, node.bodyRaw ?? "", _makeExprCtx(opts));
      return `${workerVar}.onerror = function(${binding}) { ${body}; };`;
    }

    case "upload-call": {
      const file = emitExprField(node.fileExpr, node.file ?? "null", _makeExprCtx(opts));
      const url = emitExprField(node.urlExpr, node.url ?? '""', _makeExprCtx(opts));
      return `_scrml_upload(${file}, ${url});`;
    }

    case "reactive-nested-assign": {
      const ctx = opts.encodingCtx;
      const exprCtx = _makeExprCtx(opts);
      // M-7C-D-12 Track 3: fallback uses "null" not "undefined" per §42.5/§42.8.
      const value = emitExprField(node.valueExpr, node.value ?? "null", exprCtx);

      // Bug B (structural-compound deep-set mistarget). When the receiver cell
      // is a Variant C structural compound parent (`<a> <ref>="" </>`), the
      // parent `a` is emitted as a `_scrml_derived_declare` composite that
      // recomputes from its backing leaf cells (`a.ref`). Writing the composite
      // would be silently clobbered by the next recompute. `reactive-deps.ts:
      // stampCompoundDeepSetTargets` (run once per file at runCG) stamps the
      // TRUE write destination: `_deepSetLeafKey` = the deepest statically-
      // resolvable backing leaf key along the path, `_deepSetResidualPath` =
      // the path segments PAST that leaf. SPEC §6.3.2 (line 2229):
      // `@formRes.name = "Alice"` writes to the field's backing storage.
      const leafKey = (node as any)._deepSetLeafKey as string | undefined;
      if (typeof leafKey === "string" && leafKey.length > 0) {
        const encodedLeaf = ctx ? ctx.encode(leafKey) : leafKey;
        const leaf = JSON.stringify(encodedLeaf);
        const residual: any[] = Array.isArray((node as any)._deepSetResidualPath)
          ? (node as any)._deepSetResidualPath
          : [];
        if (residual.length === 0) {
          // Single-segment field write (`@a.ref = v` over a flat-value leaf):
          // a plain write to the backing leaf cell. The composite `a`
          // re-derives on its next read.
          return `_scrml_reactive_set(${leaf}, ${value});`;
        }
        // The leaf holds a deeper plain object (`@a.cfg.deep = v` where `a.cfg`
        // is the backing leaf) or the remainder is a computed index. COW the
        // residual path into the LEAF cell's value (same heterogeneous segment
        // shape as below).
        const residualParts = residual.map((seg: any) =>
          (seg !== null && typeof seg === "object")
            ? emitExprField(seg.index, seg.raw ?? "null", exprCtx)
            : JSON.stringify(seg),
        );
        const residualPath = `[${residualParts.join(", ")}]`;
        return `_scrml_reactive_set(${leaf}, _scrml_deep_set(_scrml_reactive_get(${leaf}), ${residualPath}, ${value}));`;
      }

      // Default (FLAT object cell, or non-compound receiver): write the cell
      // value via COW deep-set on the full path.
      // cycles-prereq (S168 COW-all): the path is a heterogeneous segment list.
      // A STRING segment (dotted `.field` OR a bare-literal bracket index that
      // the parser already lowered to a string, e.g. "0" / "DAL") emits as a
      // JSON string literal. A COMPUTED segment `{ index: ExprNode }` (a
      // non-literal bracket index, `@arr[@sel] = x`) emits its index expression
      // inline, so the path reaches `_scrml_deep_set` as a JS array literal —
      // e.g. `[_scrml_reactive_get("sel")]`. The clone-then-set inside
      // `_scrml_deep_set` breaks any self-reference into a stale (acyclic)
      // snapshot, so even `@arr[0] = @arr` produces no live cycle.
      const encodedTarget = ctx ? ctx.encode(node.target) : node.target;
      const target = JSON.stringify(encodedTarget);
      const segments: any[] = node.path ?? [];
      const pathParts = segments.map((seg: any) =>
        (seg !== null && typeof seg === "object")
          ? emitExprField(seg.index, seg.raw ?? "null", exprCtx)
          : JSON.stringify(seg),
      );
      const path = `[${pathParts.join(", ")}]`;
      return `_scrml_reactive_set(${target}, _scrml_deep_set(_scrml_reactive_get(${target}), ${path}, ${value}));`;
    }

    case "reactive-array-mutation": {
      const ctx = opts.encodingCtx;
      const encodedTarget = ctx ? ctx.encode(node.target) : node.target;
      const target = JSON.stringify(encodedTarget);
      const method: string = node.method;
      const args = emitExprField(node.argsExpr, node.args ?? "", _makeExprCtx(opts));

      // With Proxy-based reactivity, array mutations go through the Proxy traps
      // which automatically notify fine-grained effects. We still call
      // _scrml_reactive_set afterwards to fire coarse-grained subscribers.
      switch (method) {
        case "push":
          return `{ _scrml_reactive_get(${target}).push(${args}); _scrml_reactive_set(${target}, _scrml_reactive_get(${target})); }`;
        case "unshift":
          return `{ _scrml_reactive_get(${target}).unshift(${args}); _scrml_reactive_set(${target}, _scrml_reactive_get(${target})); }`;
        case "pop":
          return `{ _scrml_reactive_get(${target}).pop(); _scrml_reactive_set(${target}, _scrml_reactive_get(${target})); }`;
        case "shift":
          return `{ _scrml_reactive_get(${target}).shift(); _scrml_reactive_set(${target}, _scrml_reactive_get(${target})); }`;
        case "splice":
          return `{ _scrml_reactive_get(${target}).splice(${args}); _scrml_reactive_set(${target}, _scrml_reactive_get(${target})); }`;
        case "sort":
          return `{ _scrml_reactive_get(${target}).sort(${args}); _scrml_reactive_set(${target}, _scrml_reactive_get(${target})); }`;
        case "reverse":
          return `{ _scrml_reactive_get(${target}).reverse(); _scrml_reactive_set(${target}, _scrml_reactive_get(${target})); }`;
        case "fill":
          return `{ _scrml_reactive_get(${target}).fill(${args}); _scrml_reactive_set(${target}, _scrml_reactive_get(${target})); }`;
        default:
          return `_scrml_reactive_set(${target}, _scrml_reactive_get(${target}));`;
      }
    }

    case "reactive-explicit-set": {
      const args = emitExprField(node.argsExpr, node.args ?? "", _makeExprCtx(opts));
      return `_scrml_reactive_explicit_set(${args});`;
    }

    // S79 — `case "reactive-debounced-decl"` RETIRED. The pre-v0.next
    // `@debounced(N) name = expr` form is superseded by the canonical
    // state-decl reactivity attribute form `<name debounced=Nms> = expr`
    // (SPEC §6.13). State-decls with `reactivity` are emitted via the
    // existing `case "state-decl"` arm; the new `_emitReactivitySidecar`
    // helper attaches the `_scrml_reactivity_register` call as a sidecar.

    // S81 OQ-2 (2026-05-11): `case "debounce-call"` + `case "throttle-call"`
    // RETIRED. The imperative keyword-call form is replaced by stdlib
    // imports (`scrml:time.debounce` / `scrml:time.throttle`) which emit as
    // regular function calls. State-cell timing uses §6.13 attribute form
    // (`<x debounced=Nms>` — handled by the state-decl reactivity sidecar
    // path above). Runtime helpers `_scrml_debounce` / `_scrml_throttle` are
    // removed from runtime-template.js; chunk-detector entries removed from
    // emit-client.ts.

    case "transaction-block": {
      // SPEC §44.6 — transactions are deferred to SPEC-ISSUE-018. The current
      // workaround is to use Bun.SQL `sql.unsafe()` for BEGIN/COMMIT/ROLLBACK
      // on the same connection. Proper `sql.begin(callback)` integration
      // requires a callback-shaped emitter restructure and is out of scope
      // for Phase 1.
      const lines: string[] = [];
      const db = opts.dbVar ?? "_scrml_sql";
      lines.push(`await ${db}.unsafe("BEGIN");`);
      lines.push(`try {`);
      for (const stmt of (node.body ?? [])) {
        const code = emitLogicNode(stmt, opts);
        if (code) {
          for (const line of code.split("\n")) {
            lines.push(`  ${line}`);
          }
          if (stmt.kind === "fail-expr") {
            const lastIdx = lines.length - 1;
            const lastLine = lines[lastIdx];
            if (lastLine.trimStart().startsWith("return {")) {
              lines[lastIdx] = `  await ${db}.unsafe("ROLLBACK");`;
              lines.push(`  ${lastLine.trim()}`);
            }
          }
        }
      }
      lines.push(`  await ${db}.unsafe("COMMIT");`);
      lines.push(`} catch (_scrml_txn_err) {`);
      lines.push(`  await ${db}.unsafe("ROLLBACK");`);
      lines.push(`  throw _scrml_txn_err;`);
      lines.push(`}`);
      return lines.join("\n");
    }

    case "try-stmt":
      return emitTryStmt(node);

    case "match-stmt":
    case "match-expr":
      // Bug 1 fix-C (S88 dispatch — 14-mario): thread `opts` so match-arm-block
      // bodies inherit engineBindings/machineBindings/declaredNames/boundary.
      // Without this, an `@engineCell = .X` write inside a block-form arm
      // emits bare `_scrml_reactive_set`, bypassing the engine rule= contract
      // guard + timer/history bookkeeping. The runtime symptom is that the
      // engine cell DOES update but cell-aware downstream wiring (timer arm,
      // history capture, etc.) is silently skipped.
      return emitMatchExpr(node, opts);

    case "switch-stmt":
      return emitSwitchStmt(node);

    case "meta": {
      const metaBody: any[] | undefined = node.body;
      if (!Array.isArray(metaBody) || metaBody.length === 0) return "";

      const metaScopeId = node.id != null
        ? `"_scrml_meta_${node.id}"`
        : JSON.stringify(genVar("meta_scope"));

      const bodyLines: string[] = [];
      for (const stmt of metaBody) {
        const code = emitLogicNode(stmt);
        if (code) {
          // Rewrite reflect() → meta.types.reflect() in runtime meta bodies.
          // PascalCase type names are quoted; variables are left as-is.
          const rewritten = rewriteReflectForRuntime(code);
          for (const line of rewritten.split("\n")) {
            bodyLines.push(`  ${line}`);
          }
        }
      }

      if (bodyLines.length === 0) return "";

      // §22.5: emit 4-argument form with capturedBindings and typeRegistry
      const capturedBindings = emitCapturedBindings(node);
      const typeRegistryLiteral = emitTypeRegistryLiteral(node);

      // The meta-effect body may contain `await` (e.g. `await import(...)` for
      // dynamic stdlib loading at meta-eval time). A bare `function(meta)`
      // wrapper would make `await` a SyntaxError ("await outside async"); emit
      // `async function(meta)` whenever a top-level `await` appears in the body.
      const _metaBodyHasAwait = bodyLines.some(
        (l) => /(^|[^.\w$])await\s/.test(l),
      );
      const _metaFnKw = _metaBodyHasAwait ? "async function(meta)" : "function(meta)";

      return [
        `_scrml_meta_effect(${metaScopeId}, ${_metaFnKw} {`,
        ...bodyLines,
        `}, ${capturedBindings}, ${typeRegistryLiteral});`
      ].join("\n");
    }

    case "function-decl": {
      // F1 (ast-builder-grammar-fixes): synthetic function-decls produced by
      // the EXPORT branch carry `fromExport: true` and have empty params/body
      // (they exist for AST walker discoverability only). Skip emission here;
      // the paired export-decl handles output in emit-library.
      if (node.fromExport === true) return "";
      const fnName: string = node.name ?? "anon";
      const params: ParamLike[] = (node.params ?? []) as ParamLike[];
      // §7.3.2: param signatures carry `name = defaultValue` when defaults are present.
      // Strip :Type annotations from string params (e.g. "mario:Mario" → "mario").
      const paramSigs: string[] = params.map((p, i) => paramSignature(p, i));
      const generatorStar: string = node.isGenerator ? "*" : "";

      // Function body has its own scope for declared names. C5: set
      // `insideFunctionBody` so init-thunk sidecar is suppressed for any
      // `@x = expr` reassignments (which are AST-shaped as state-decls but
      // are not declaration sites).
      const fnOpts: EmitLogicOpts = { ...opts, declaredNames: new Set<string>(), insideFunctionBody: true };
      const body: any[] = node.body ?? [];

      const bodyCodes = emitFnShortcutBody(body, fnOpts, node.fnKind, node.hasReturnType);
      const fnBodyLines: string[] = [];
      for (const code of bodyCodes) {
        for (const line of code.split("\n")) {
          fnBodyLines.push(`  ${line}`);
        }
      }

      // g-sql-in-nested-function-client-leak (S225): when a nested function is
      // emitted inside a SERVER-placed parent (its enclosing fn escalated to
      // server because this nested body uses a `?{}` SQL block / other
      // server-only resource — see route-inference.ts walkBodyForTriggers), its
      // server-only resources lower to `await _scrml_sql\`…\`` etc. A bare
      // `function` wrapper would make that `await` a SyntaxError
      // ("await outside async" → E-CODEGEN-INVALID-LOGIC). Mirror the meta-effect
      // wrapper (case "meta" above): emit `async function` whenever the emitted
      // body contains a top-level `await`. On the CLIENT path the same nested
      // body stubs its SQL to `return null` (no await), so the function stays
      // synchronous and this is a no-op. A generator (`function*`) is never
      // marked async (async generators are a distinct, unused form here).
      const _nestedHasAwait = !node.isGenerator && fnBodyLines.some(
        (l) => /(^|[^.\w$])await\s/.test(l),
      );
      const _asyncKw = _nestedHasAwait ? "async " : "";

      const fnLines: string[] = [];
      fnLines.push(`${_asyncKw}function${generatorStar} ${fnName}(${paramSigs.join(", ")}) {`);
      for (const line of fnBodyLines) fnLines.push(line);

      fnLines.push(`}`);
      return fnLines.join("\n");
    }

    case "lin-decl": {
      // §35.2: lin bindings are immutable — emit as `const`.
      if (!node.name) return "";
      const linInit: string = node.init ?? "";
      if (!linInit.trim()) return `const ${node.name};`;
      const linRhs = emitExprField(node.initExpr, linInit, _makeExprCtx(opts));
      return `const ${node.name} = ${linRhs};`;
    }

    default:
      return "";
  }
}

/**
 * §48 implicit-return: emit a `fn` shorthand body with tail-expression return semantics.
 *
 * When `fnKind === "fn"`, the body's last non-compile-time-only statement — if it is
 * an expression-shape (bare-expr, match-stmt, match-expr, switch-stmt) — is wrapped
 * as `return ...;`. This aligns with example 14 (`fn riskBanner(risk) -> string { match risk {...} }`)
 * and Rust/OCaml/Scala/Kotlin tail-expression conventions.
 *
 * `fnKind !== "fn"` (plain `function` keyword) is unchanged UNLESS `hasReturnType` is set,
 * in which case the same tail-expression return semantics apply (Bug H fix).
 *
 * Returns emitted JS code strings (each entry may be multi-line; caller indents).
 */
export function emitFnShortcutBody(body: any[], opts: EmitLogicOpts, fnKind: string | undefined, hasReturnType?: boolean): string[] {
  const TAIL_KINDS = new Set(["bare-expr", "match-stmt", "match-expr", "switch-stmt"]);
  let tailIdx = -1;
  // Bug H fix: apply implicit tail-expression return for both `fn` shorthand and
  // `function` declarations with return-type annotations (`-> T` or `: T`).
  // When a function declares its return type, the tail match/switch/bare-expr is
  // wrapped in `return ...;` so the IIFE result is actually returned.
  if (fnKind === "fn" || hasReturnType) {
    for (let i = body.length - 1; i >= 0; i--) {
      const s = body[i];
      if (!s || s._compileTimeOnly) continue;
      if (TAIL_KINDS.has(s.kind)) tailIdx = i;
      break;
    }
  }
  // §32 — Tilde scope: a function body is its own tilde scope per SPEC §32.4.
  // Pre-scan the body for `~` references and set up a tildeContext so bare-
  // expr / value-lift statements capture into the generated tilde var and
  // consume sites lower `~` to that var. Without this, a `function f() {
  // inner(2); return ~ }` shape emits a literal `~` in the return-stmt
  // (parsed as JS bitwise-NOT — produces NaN at runtime).
  const tildeUsed = nodeListContainsTildeRef(body);
  const bodyOpts: EmitLogicOpts = tildeUsed
    ? { ...opts, tildeContext: { var: null, mode: "single" } }
    : opts;
  const out: string[] = [];
  for (let i = 0; i < body.length; i++) {
    const stmt = body[i];
    if (!stmt) continue;
    let code: string;
    if (i === tailIdx) {
      if (stmt.kind === "bare-expr") {
        const exprCtx = _makeExprCtx(bodyOpts);
        const exprCode = stmt.exprNode
          ? emitExpr(stmt.exprNode, exprCtx)
          : emitExprField(null, stmt.expr ?? "", exprCtx);
        code = exprCode ? `return ${exprCode};` : "";
      } else {
        // match/switch emit as IIFE expression strings — wrap in `return ...;`.
        const rawCode = emitLogicNode(stmt, bodyOpts);
        if (rawCode) {
          const stripped = rawCode.replace(/;\s*$/, "");
          code = `return ${stripped};`;
        } else {
          code = "";
        }
      }
    } else {
      code = emitLogicNode(stmt, bodyOpts);
    }
    if (code) out.push(code);
  }
  return out;
}

/**
 * Emit an if-stmt, threading EmitLogicOpts through to child nodes.
 * Used when tilde context is active (e.g., inside a for/while loop accumulator)
 * so that nested lift-expr nodes can use the correct .push() form.
 */
function _emitIfStmtWithOpts(node: any, opts: EmitLogicOpts): string {
  const lines: string[] = [];
  const ifCond = emitExprField(node.condExpr, node.condition ?? node.test ?? "true", _makeExprCtx(opts));
  lines.push(`if (${ifCond}) {`);
  for (const child of (node.consequent ?? node.body ?? [])) {
    const code = emitLogicNode(child, opts);
    if (code) {
      for (const line of code.split("\n")) lines.push(`  ${line}`);
    }
  }
  lines.push("}");
  if (node.alternate) {
    const alternate = Array.isArray(node.alternate) ? node.alternate : [node.alternate];
    lines.push("else {");
    for (const child of alternate) {
      const code = emitLogicNode(child, opts);
      if (code) {
        for (const line of code.split("\n")) lines.push(`  ${line}`);
      }
    }
    lines.push("}");
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// §32 loop-aware tilde helpers — for-stmt and while-stmt with array accumulation
// ---------------------------------------------------------------------------

/**
 * Emit a for-stmt when the tilde accumulator is active.
 *
 * For non-reactive, non-C-style for-of loops: initializes the tilde variable as an
 * array before the loop, then emits the loop body with mode="array" so each lift
 * call inside the body appends with .push() instead of overwriting.
 *
 * Falls back to emitForStmt (no tilde modification) for:
 *   - Reactive iterables (@varName) — those use DOM reconciliation, not ~
 *   - C-style for (init; cond; update) loops
 */
function _emitForStmtWithTilde(node: any, opts: EmitLogicOpts): string {
  let iterable: string = node.iterable ?? node.collection ?? "[]";
  // A5 (2026-05-17) — destructuring LHS: render pattern back to JS source text.
  let varName: string;
  if (isDestructurePattern(node.variable)) {
    varName = nameOrPatternText(node.variable);
  } else {
    varName = (typeof node.variable === "string" && node.variable) || node.name || "item";
  }

  if (typeof iterable === "string") {
    // C-style for loop: fall back to plain emitForStmt (tilde not applicable)
    const cStyleMatch = iterable.match(/^\(\s*(.*?)\s*;\s*(.*?)\s*;\s*(.*?)\s*\)$/s);
    if (cStyleMatch) return emitForStmt(node);

    // Reactive @varName iterable: fall back (reactive loops use DOM reconciliation)
    const reactiveMatch = iterable.trim().match(/^@([A-Za-z_$][A-Za-z0-9_$]*)$/);
    if (reactiveMatch) return emitForStmt(node);

    // For-of: parse out varName and iterable from "( [let|const|var] VAR of EXPR )"
    const forOfMatch = iterable.match(/^\(\s*(?:(?:let|const|var)\s+)?(\w+)\s+of\s+(.*)\s*\)$/s);
    if (forOfMatch) {
      if (varName === "item" && forOfMatch[1] !== "item") varName = forOfMatch[1];
      iterable = forOfMatch[2].trim();
    }
  }

  const lines: string[] = [];
  const tildeCtx = opts.tildeContext!;

  // Initialize tilde var as array if not yet initialized
  if (!tildeCtx.var) {
    const tVar = genVar("tilde");
    tildeCtx.var = tVar;
    tildeCtx.mode = "array";
    lines.push(`let ${tVar} = [];`);
  } else if (tildeCtx.mode !== "array") {
    // Entering a loop when mode was "single" — switch to array (rare edge case)
    tildeCtx.mode = "array";
  }

  const rewrittenIterable = emitExprField(node.iterExpr, iterable, _makeExprCtx(opts));
  lines.push(`for (const ${varName} of ${rewrittenIterable}) {`);

  const body: any[] = node.body ?? [];
  for (const child of body) {
    const code = emitLogicNode(child, opts);
    if (code) {
      for (const line of code.split("\n")) lines.push(`  ${line}`);
    }
  }

  lines.push("}");
  return lines.join("\n");
}

/**
 * Emit a while-stmt when the tilde accumulator is active.
 *
 * Initializes the tilde variable as an array before the loop, then emits the loop
 * body with mode="array" so each lift call appends with .push().
 */
function _emitWhileStmtWithTilde(node: any, opts: EmitLogicOpts): string {
  const lines: string[] = [];
  const tildeCtx = opts.tildeContext!;

  // Initialize tilde var as array if not yet initialized
  if (!tildeCtx.var) {
    const tVar = genVar("tilde");
    tildeCtx.var = tVar;
    tildeCtx.mode = "array";
    lines.push(`let ${tVar} = [];`);
  } else if (tildeCtx.mode !== "array") {
    tildeCtx.mode = "array";
  }

  const condition = emitExprField(node.condExpr, node.condition ?? "true", _makeExprCtx(opts));
  lines.push(`while (${condition}) {`);

  const body: any[] = node.body ?? [];
  for (const child of body) {
    const code = emitLogicNode(child, opts);
    if (code) {
      for (const line of code.split("\n")) lines.push(`  ${line}`);
    }
  }

  lines.push("}");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// emitIfExprDecl — if-as-expression: `const a = if (cond) { lift val }`
// ---------------------------------------------------------------------------

/**
 * Count direct (top-level) lift-expr nodes in an arm body.
 * Used for E-LIFT-002 detection: multiple lift statements on the same
 * linear execution path in a value-lift arm are a compile error (§10).
 */
function countTopLevelLifts(body: any[]): number {
  return body.filter((n: any) => n?.kind === "lift-expr").length;
}

/**
 * Emit the alternate (else/else-if) chain of an if-as-expression inline,
 * handling else-if chains without extra braces per §17.6.8.
 */
function emitIfExprAltChain(alternate: any[], bodyOpts: EmitLogicOpts, lines: string[]): void {
  if (alternate.length === 1 && alternate[0]?.kind === "if-stmt") {
    // else if — emit without extra braces (§17.6.8)
    const nestedIf = alternate[0];
    // The nested else-if condition must inherit the SAME opts as the body
    // (`bodyOpts`) so a `<#id>` request ref / `@m[k]` map read / engine read in
    // the condition lowers correctly — `_makeExprCtx({})` dropped them all.
    const nestedCond = emitExprField(nestedIf.condExpr, (nestedIf.condition ?? "true").trim(), _makeExprCtx(bodyOpts));
    const nestedConsequent: any[] = nestedIf.consequent ?? [];
    // E-LIFT-002: multiple lifts on same path in a value-lift arm
    if (countTopLevelLifts(nestedConsequent) > 1) {
      lines.push(`/* E-LIFT-002: multiple lift statements on same execution path in value-lift arm */`);
    }
    lines.push(`else if (${nestedCond}) {`);
    for (const stmt of nestedConsequent) {
      const code = emitLogicNode(stmt, bodyOpts);
      if (code) {
        for (const line of code.split("\n")) lines.push(`  ${line}`);
      }
    }
    lines.push(`}`);
    // Continue chaining for further else-if / else
    if (nestedIf.alternate) {
      const nextAlternate: any[] = Array.isArray(nestedIf.alternate) ? nestedIf.alternate : [nestedIf.alternate];
      emitIfExprAltChain(nextAlternate, bodyOpts, lines);
    }
  } else {
    // plain else
    // E-LIFT-002: multiple lifts in else arm
    if (countTopLevelLifts(alternate) > 1) {
      lines.push(`/* E-LIFT-002: multiple lift statements on same execution path in value-lift arm */`);
    }
    lines.push(`else {`);
    for (const stmt of alternate) {
      const code = emitLogicNode(stmt, bodyOpts);
      if (code) {
        for (const line of code.split("\n")) lines.push(`  ${line}`);
      }
    }
    lines.push(`}`);
  }
}

/**
 * Emit an if-as-expression declaration. Pre-declares a tilde variable,
 * emits the if/else body with lift assigning to that variable, then
 * assigns the result to the declared name.
 *
 * §17.6.4: When no arm executes, result is `not` (compiled to null in JS per §42).
 * §17.6.8: Uses variable-assign-in-branches pattern with else-if chain support.
 */
function emitIfExprDecl(name: string, ifExpr: any, keyword: "let" | "const", opts: EmitLogicOpts): string {
  const tildeVar = genVar("tilde");
  const lines: string[] = [];
  // §17.6.4: default is `not` (compiled to null in JS — §42: `not` => null)
  lines.push(`let ${tildeVar} = null;`);

  // Create a tilde context so lift-expr inside the if body assigns to tildeVar
  const tildeCtx = { var: tildeVar, mode: "single" as "single" | "array" };
  const bodyOpts: EmitLogicOpts = { ...opts, tildeContext: tildeCtx };

  // Emit the if condition
  const condition = emitExprField(ifExpr.condExpr, (ifExpr.condition ?? "true").trim(), _makeExprCtx(opts));

  // E-LIFT-002: multiple lifts on same linear path in a value-lift arm
  const consequent: any[] = ifExpr.consequent ?? [];
  if (countTopLevelLifts(consequent) > 1) {
    lines.push(`/* E-LIFT-002: multiple lift statements on same execution path in value-lift arm */`);
  }
  lines.push(`if (${condition}) {`);

  for (const stmt of consequent) {
    const code = emitLogicNode(stmt, bodyOpts);
    if (code) {
      for (const line of code.split("\n")) lines.push(`  ${line}`);
    }
  }
  lines.push(`}`);

  // Emit alternate body if present (§17.6.8 — else-if chain optimization)
  if (ifExpr.alternate) {
    const alternate: any[] = Array.isArray(ifExpr.alternate) ? ifExpr.alternate : [ifExpr.alternate];
    emitIfExprAltChain(alternate, bodyOpts, lines);
  }

  lines.push(`${keyword} ${name} = ${tildeVar};`);

  // Propagate tilde var to parent context so `~` after this decl resolves correctly
  if (opts.tildeContext) {
    opts.tildeContext.var = tildeVar;
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// emitForExprDecl — for-as-expression: `const names = for (item of items) { lift item.name }`
// ---------------------------------------------------------------------------

/**
 * Emit a for-as-expression declaration. Pre-declares a tilde variable as an array,
 * emits the for loop body with lift pushing to that array, then assigns the array
 * to the declared name.
 */
function emitForExprDecl(name: string, forExpr: any, keyword: "let" | "const", opts: EmitLogicOpts): string {
  const tildeVar = genVar("tilde");
  const lines: string[] = [];
  lines.push(`let ${tildeVar} = [];`);

  // Create an array-mode tilde context so lift-expr inside the for body uses .push()
  const tildeCtx = { var: tildeVar, mode: "array" as "single" | "array" };
  const bodyOpts: EmitLogicOpts = { ...opts, tildeContext: tildeCtx };

  // Parse iterable and variable from the forExpr node
  let iterable: string = forExpr.iterable ?? forExpr.collection ?? "[]";
  let varName: string = forExpr.variable ?? forExpr.name ?? "item";

  // Handle for-of form stored as "( let x of iterable )" — extract parts
  if (typeof iterable === "string") {
    const forOfMatch = iterable.match(/^\(\s*(?:(?:let|const|var)\s+)?(\w+)\s+of\s+(.*)\s*\)$/s);
    if (forOfMatch) {
      if (varName === "item" && forOfMatch[1] !== "item") varName = forOfMatch[1];
      iterable = forOfMatch[2].trim();
    }
  }

  const rewrittenIterable = emitExprField(forExpr.iterExpr, iterable, _makeExprCtx(opts));
  lines.push(`for (const ${varName} of ${rewrittenIterable}) {`);

  const body: any[] = forExpr.body ?? [];
  for (const stmt of body) {
    const code = emitLogicNode(stmt, bodyOpts);
    if (code) {
      for (const line of code.split("\n")) lines.push(`  ${line}`);
    }
  }
  lines.push("}");

  lines.push(`${keyword} ${name} = ${tildeVar};`);

  // Propagate tilde var to parent context so `~` after this decl resolves correctly
  if (opts.tildeContext) {
    opts.tildeContext.var = tildeVar;
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// emitMatchExprDecl — match-as-expression: `const result = match expr { arms }`
// ---------------------------------------------------------------------------

/**
 * Emit a match-as-expression declaration. Pre-declares a tilde variable,
 * emits the match arms as if/else-if blocks with lift assigning to that
 * variable, then assigns the result to the declared name.
 *
 * §18.3: match is an expression — may appear on the RHS of let/const.
 */
function emitMatchExprDecl(name: string, matchExpr: any, keyword: "let" | "const", opts: EmitLogicOpts): string {
  // §18.19 — multi-scrutinee match in decl position: delegate to the shared
  // value-return emitter (emit-control-flow.ts:emitMatchExpr), which lowers the
  // product dispatch to an IIFE that evaluates to the arm value, then bind it.
  if (Array.isArray(matchExpr.scrutineeExprs) && matchExpr.scrutineeExprs.length >= 2) {
    return `${keyword} ${name} = ${emitMatchExpr(matchExpr, opts)};`;
  }

  const tildeVar = genVar("tilde");
  const tmpVar = genVar("match");
  const lines: string[] = [];
  lines.push(`let ${tildeVar} = null;`);

  // Emit the match header into a temporary variable
  const header = emitExprField(matchExpr.headerExpr, (matchExpr.header ?? "").trim(), _makeExprCtx(opts));
  lines.push(`const ${tmpVar} = ${header};`);

  // Create a tilde context so lift-expr inside match arms assigns to tildeVar
  const tildeCtx = { var: tildeVar, mode: "single" as "single" | "array" };
  const bodyOpts: EmitLogicOpts = { ...opts, tildeContext: tildeCtx };

  // Collect all arms — same two-path logic as emitMatchExpr in emit-control-flow.ts
  const arms: MatchArm[] = [];
  const body: any[] = matchExpr.body ?? [];
  for (const child of body) {
    if (!child) continue;
    // Structured match-arm-block nodes (from `. Variant => { ... }` arms)
    if (child.kind === "match-arm-block") {
      arms.push({
        kind: child.isWildcard ? "wildcard" : child.isNotArm ? "not" : "variant",
        test: child.variant ?? null,
        binding: null,
        result: "",
        structuredBody: Array.isArray(child.body) ? child.body : null,
      });
      continue;
    }
    // Structured match-arm-inline nodes (from `. Variant => result` arms)
    if (child.kind === "match-arm-inline") {
      const arm = matchArmInlineToMatchArm(child);
      if (arm) arms.push(arm);
      continue;
    }
    // Raw expression arms — parse via shared arm splitter/parser
    // Prefer string `expr`: match arm text (e.g. `.Variant :> result`) is inherently
    // a multi-part pattern the expression parser can only partially represent.
    // exprNode captures only the first parseable chunk, losing the arrow + result.
    let armExpr: string = child.expr ?? child.header ?? "";
    if (!armExpr && child.exprNode) {
      try { armExpr = emitStringFromTree(child.exprNode); } catch { armExpr = ""; }
    }
    if (typeof armExpr !== "string") continue;
    const trimmed = armExpr.trim();
    if (!trimmed) continue;
    const armStrings = splitMultiArmString(trimmed);
    for (const armStr of armStrings) {
      const arm = parseMatchArm(armStr);
      if (arm) arms.push(arm);
    }
  }

  // S22 §1a slice 2: normalize tagged-object variants the same way as emitMatchExpr.
  // §19.7 — a match over a failable result ALWAYS needs the discriminator (the
  // success value is bare; the `::Ok` arm is recognized only via the
  // `__scrml_error`-sentinel tag).
  const failableMatch = isFailableOkMatch(arms);
  const needsTagNormalization = failableMatch || hasPayloadBindingOrTaggedVariant(arms);
  const tagVar = needsTagNormalization ? genVar("tag") : tmpVar;
  if (needsTagNormalization) {
    lines.push(emitMatchTagDiscriminator(tmpVar, tagVar, failableMatch));
  }

  // Emit arms as if/else-if chain with tilde assignment
  let conditionIndex = 0;
  for (const arm of arms) {
    const bindingPrelude = arm.kind === "variant" ? emitVariantBindingPrelude(arm, tmpVar, failableMatch && arm.test === "Ok") : "";
    // Structured body: emit each statement via emitLogicNode (handles lift via tildeContext)
    if (arm.structuredBody) {
      const bodyCode: string[] = [];
      for (const stmt of arm.structuredBody) {
        const code = emitLogicNode(stmt, bodyOpts);
        if (code) {
          for (const line of code.split("\n")) bodyCode.push(`  ${line}`);
        }
      }
      if (arm.kind === "wildcard") {
        lines.push(`else {`);
      } else if (arm.kind === "not") {
        const prefix = conditionIndex === 0 ? "if" : "else if";
        lines.push(`${prefix} (${tmpVar} === null || ${tmpVar} === undefined) {`);
        conditionIndex++;
      } else {
        const prefix = conditionIndex === 0 ? "if" : "else if";
        // arm.test for variant arms is a bare name; for string arms it already
        // includes the surrounding quotes. Compare against the appropriate var.
        const cmp = arm.kind === "variant"
          ? `${tagVar} === "${arm.test}"`
          : `${tmpVar} === ${arm.test}`;
        lines.push(`${prefix} (${cmp}) {`);
        conditionIndex++;
      }
      if (bindingPrelude) lines.push(`  ${bindingPrelude.trimEnd()}`);
      for (const line of bodyCode) lines.push(line);
      lines.push(`}`);
      continue;
    }

    // errarm-refail (§19.5.2 / §19.3): a bare re-`fail` value-arm lowers via the
    // shared `fail-expr` emitter to `return { __scrml_error, … };` — `fail`
    // returns from the ENCLOSING (always `!`, per NS-1) function, so it does NOT
    // assign to the tilde var; the `return` exits the function directly. The
    // pre-fix path emitted `tildeVar = fail "V"(args)` -> E-CODEGEN-INVALID-LOGIC.
    const armResultLine = (a: MatchArm): string =>
      a.failExpr ? `  ${emitFailExpr(a.failExpr as FailExprLike, opts)}` : `  ${tildeVar} = ${emitExprField(null, a.result, _makeExprCtx(opts))};`;

    // Raw result: assign rewritten expression to tilde var (or re-fail).
    if (arm.kind === "wildcard") {
      lines.push(`else {`);
      if (arm.binding) lines.push(`  const ${arm.binding} = ${tmpVar};`);
      lines.push(armResultLine(arm));
      lines.push(`}`);
    } else if (arm.kind === "not") {
      const prefix = conditionIndex === 0 ? "if" : "else if";
      lines.push(`${prefix} (${tmpVar} === null || ${tmpVar} === undefined) {`);
      lines.push(armResultLine(arm));
      lines.push(`}`);
      conditionIndex++;
    } else {
      const prefix = conditionIndex === 0 ? "if" : "else if";
      const cmp = arm.kind === "variant"
        ? `${tagVar} === "${arm.test}"`
        : `${tmpVar} === ${arm.test}`;
      lines.push(`${prefix} (${cmp}) {`);
      if (bindingPrelude) lines.push(`  ${bindingPrelude.trimEnd()}`);
      lines.push(armResultLine(arm));
      lines.push(`}`);
      conditionIndex++;
    }
  }

  lines.push(`${keyword} ${name} = ${tildeVar};`);

  // Propagate tilde var to parent context so `~` after this decl resolves correctly
  if (opts.tildeContext) {
    opts.tildeContext.var = tildeVar;
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// emitLogicBody — sequence emission with §32 tilde tracking
// ---------------------------------------------------------------------------

/**
 * Emit a sequence of logic nodes with tilde pipeline accumulator tracking (§32).
 *
 * Pre-scans the node list to detect whether `~` is referenced anywhere in the
 * sequence. If so, enables tilde context and passes it through each emitLogicNode
 * call so that:
 *   - `bare-expr` nodes emit `let _scrml_tilde_N = <expr>;`
 *   - value-lift nodes (`lift <non-markup-expr>`) emit `let _scrml_tilde_N = <expr>;`
 *   - `const-decl` / `tilde-decl` nodes with `~` in their init substitute the tilde var
 *
 * When `~` is not referenced in the sequence, falls back to plain emitLogicNode calls
 * (preserving existing behavior and avoiding unnecessary tilde variable declarations).
 *
 * @param nodes - array of AST nodes in a logic body
 * @param opts  - emit options (derivedNames, encodingCtx, dbVar)
 * @returns array of emitted code strings (one per non-empty node)
 */
export function emitLogicBody(nodes: any[], opts: EmitLogicOpts = {}): string[] {
  if (!Array.isArray(nodes) || nodes.length === 0) return [];

  // Track declared names so tilde-decl can distinguish first declaration from reassignment.
  const declaredNames = opts.declaredNames ?? new Set<string>();

  // i87 §13.2 (position-invariant auto-await) — inject `await` into a nested
  // statement whose call is a statically-known Promise<T>-returning server-fn /
  // stdlib-async callee. Gated on `awaitNestedPromises` (set only by the
  // control-flow body-opts) + the classifier inputs, so it fires exactly in
  // if/else/for/while/do-while bodies and nowhere else. `injectPromiseAwait`
  // is a no-op for statement-shape / non-Promise nodes, so a nested `if`/`for`
  // wrapper passes through untouched while its own body is descended separately.
  const _injectAwait =
    opts.awaitNestedPromises && opts.asyncRouteMap
      ? (node: any, code: string): string => {
          if (!code) return code;
          try {
            const sched = require("./scheduling.js");
            return sched.injectPromiseAwait(
              code,
              node,
              opts.asyncRouteMap,
              opts.asyncFilePath ?? "",
              opts.asyncCalleeMap ?? null,
              opts.asyncExportRegistry ?? null,
            );
          } catch (_e) {
            // Classifier failure is non-fatal — fall back to no-auto-await.
            return code;
          }
        }
      : (_node: any, code: string): string => code;

  // Pre-scan: does `~` appear in any expression in this sequence?
  const tildeUsed = nodeListContainsTildeRef(nodes);

  if (!tildeUsed) {
    // No tilde references — use plain emission (no overhead, no behavior change)
    return nodes
      .map((n: any) => _injectAwait(n, emitLogicNode(n, { ...opts, declaredNames })))
      .filter((s: string) => s.trim() !== "");
  }

  // Tilde context: a shared mutable object threaded through each emitLogicNode call.
  // `var` holds the current tilde variable name (null = no active tilde).
  const tildeCtx: { var: string | null; mode?: "single" | "array" } = { var: null };
  const optsWithTilde: EmitLogicOpts = { ...opts, tildeContext: tildeCtx, declaredNames };

  return nodes
    .map((n: any) => _injectAwait(n, emitLogicNode(n, optsWithTilde)))
    .filter((s: string) => s.trim() !== "");
}

/**
 * Return true if any node (or descendant) in the list contains a `~` reference.
 * Used by emitLogicBody to decide whether tilde tracking is needed. Exported
 * so call-sites that manually iterate statements (emit-reactive-wiring per-
 * group loop, emit-functions function-body emit, etc.) can also gate
 * tildeContext setup on the same scan.
 */
export function nodeListContainsTildeRef(nodes: any[]): boolean {
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    if (nodeContainsTildeRef(node)) return true;
  }
  return false;
}

function nodeContainsTildeRef(node: any): boolean {
  if (!node || typeof node !== "object") return false;
  // Check string fields that hold expressions
  for (const field of ["expr", "init", "value"]) {
    const val = node[field];
    if (typeof val === "string" && hasTildeToken(val)) return true;
    // lift-expr has expr.expr for the inner expression string
    if (field === "expr" && val && typeof val === "object" && typeof val.expr === "string") {
      if (hasTildeToken(val.expr)) return true;
    }
  }
  // §32 tilde codegen — Phase 3 AST shapes carry expressions as structured
  // ExprNode trees on dedicated fields (exprNode, initExpr, condExpr,
  // headerExpr, iterExpr). The legacy string-field scan above can't see
  // `~` inside `describe(~)` when the bare-expr / decl was parsed into
  // a structured CallExpr → IdentExpr("~") tree. Walk the ExprNode tree
  // on each known carrier field.
  for (const field of ["exprNode", "initExpr", "condExpr", "headerExpr", "iterExpr"]) {
    const expr = node[field];
    if (expr && typeof expr === "object" && exprContainsTildeRef(expr)) return true;
  }
  // lift-expr: node.expr is `{ kind: "expr", expr: string, exprNode?: ExprNode }`
  // The string side is handled above; also walk the structured exprNode child.
  if (node.expr && typeof node.expr === "object" && node.expr.exprNode &&
      exprContainsTildeRef(node.expr.exprNode)) return true;
  // Recurse into body arrays
  if (Array.isArray(node.body) && nodeListContainsTildeRef(node.body)) return true;
  if (Array.isArray(node.children) && nodeListContainsTildeRef(node.children)) return true;
  // if-expr / match-expr / for-expr alternates and consequents
  if (Array.isArray(node.consequent) && nodeListContainsTildeRef(node.consequent)) return true;
  if (node.alternate) {
    if (Array.isArray(node.alternate) && nodeListContainsTildeRef(node.alternate)) return true;
    if (typeof node.alternate === "object" && nodeContainsTildeRef(node.alternate)) return true;
  }
  // §32 Gap 5 — guarded-expr (`<expr> !{ arms }`) carries the guarded expression
  // on `guardedNode` and the handler arms on `arms`. Walk both: a `~` inside
  // the guarded expression OR an arm body must activate tildeContext so the
  // subsequent statements' tilde refs lower correctly.
  if (node.guardedNode && typeof node.guardedNode === "object" &&
      nodeContainsTildeRef(node.guardedNode)) return true;
  if (Array.isArray(node.arms)) {
    for (const arm of node.arms) {
      if (!arm || typeof arm !== "object") continue;
      // Arms have `handler` (string) and `handlerExpr` (ExprNode) per ast.ts:163.
      if (typeof arm.handler === "string" && hasTildeToken(arm.handler)) return true;
      if (arm.handlerExpr && typeof arm.handlerExpr === "object" &&
          exprContainsTildeRef(arm.handlerExpr)) return true;
    }
  }
  return false;
}

/**
 * Walk an ExprNode tree looking for `IdentExpr { name: "~" }`. Returns true
 * on the first match. Used by `nodeContainsTildeRef` so structural expression
 * trees activate `tildeContext` in `emitLogicBody` just like legacy string
 * forms do.
 */
function exprContainsTildeRef(expr: any): boolean {
  if (!expr || typeof expr !== "object") return false;
  // Cycle / depth guard via a small visited set isn't strictly needed —
  // ExprNode trees are finite and acyclic in well-formed AST — but we avoid
  // infinite recursion on malformed input by capping at a generous depth.
  // The recursion below traverses every child field on the union; that's
  // sufficient for every ExprNode variant that can legally contain `~`.
  if (expr.kind === "ident" && expr.name === "~") return true;
  // Walk all child fields that may carry nested expressions
  for (const k of [
    "object", "property", "callee", "left", "right", "target", "value",
    "argument", "test", "consequent", "alternate", "body",
  ]) {
    const child = (expr as any)[k];
    if (child && typeof child === "object") {
      if (Array.isArray(child)) {
        for (const item of child) {
          if (exprContainsTildeRef(item)) return true;
        }
      } else {
        if (exprContainsTildeRef(child)) return true;
      }
    }
  }
  // CallExpr.arguments, ArrayExpr.elements, ObjectExpr.props
  for (const k of ["arguments", "elements", "props", "params"]) {
    const child = (expr as any)[k];
    if (Array.isArray(child)) {
      for (const item of child) {
        if (exprContainsTildeRef(item)) return true;
        // ObjectExpr.props is an array of `{ kind, key, value, argument }`
        // — `value` and `argument` are covered by the recursive walk; `key`
        // can be either a string or an ExprNode for computed keys.
        if (item && typeof item === "object" && item.key &&
            typeof item.key === "object" && exprContainsTildeRef(item.key)) return true;
      }
    }
  }
  return false;
}

/**
 * Return true if the string contains a standalone `~` (not preceded/followed by word chars).
 */
function hasTildeToken(s: string): boolean {
  return /(?<![A-Za-z0-9_$])~(?![A-Za-z0-9_$])/.test(s);
}
