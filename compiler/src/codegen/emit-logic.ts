import { genVar } from "./var-counter.ts";
import { paramName, paramSignature, type ParamLike } from "./utils.ts";
import { extractSqlParams, rewriteTildeRef, buildTaggedTemplate } from "./rewrite.js";
import { emitExpr, emitExprField, arrowBodyNeedsParens, arrowBodyStringNeedsParens, type EmitExprContext } from "./emit-expr.ts";
import { stripLeakedComments, isLeakedComment, splitBareExprStatements, splitMergedStatements } from "./compat/parser-workarounds.js";
import { emitIfStmt, emitForStmt, emitWhileStmt, emitDoWhileStmt, emitBreakStmt, emitContinueStmt, emitTryStmt, emitMatchExpr, emitSwitchStmt, rewriteBlockBody, splitMultiArmString, parseMatchArm, matchArmInlineToMatchArm, emitVariantBindingPrelude, hasPayloadBindingOrTaggedVariant, getVariantFieldSchema, type MatchArm } from "./emit-control-flow.ts";
import { isDestructurePattern, nameOrPatternText } from "./emit-destructure-pattern.ts";
import { emitLiftExpr, emitCreateElementFromMarkup } from "./emit-lift.js";
import { extractReactiveDeps, extractReactiveDepsFromExprNode, extractReactiveDepsTransitive, type FunctionBodyRegistry } from "./reactive-deps.ts";
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

interface EmitLogicOpts {
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
}

// ---------------------------------------------------------------------------
// Helper: emit a guarded-expr arm body
// ---------------------------------------------------------------------------

function emitArmBody(arm: LogicArm, errVar: string, machineBindings?: Map<string, { engineName: string; tableName: string; rules: any[]; auditTarget?: string | null }> | null): string {
  const handler = (arm.handler ?? "").trim();
  if (!handler) return "";
  // Block bodies `{ @var = expr; ... }` must go through rewriteBlockBody so that
  // reactive assignments (@var = expr) are emitted as _scrml_reactive_set() calls
  // rather than _scrml_reactive_get() on the left side of =.
  // When machineBindings is provided, machine-bound assignments emit transition guards (§51.5).
  if (handler.startsWith("{") && handler.endsWith("}")) {
    const inner = handler.slice(1, -1).trim();
    return inner ? rewriteBlockBody(inner, machineBindings ?? null) : "";
  }
  const rewritten = emitExprField(arm.handlerExpr, handler, _makeExprCtx({}));
  return rewritten.trim().endsWith(";") ? rewritten.trim() : rewritten.trim() + ";";
}

/**
 * Emit the `const <local> = <resultVar>.data[...]` binding line(s) for a
 * `!{}` failable arm (§19.4.3). The error envelope is
 * `{ __scrml_error, type, variant, data }`.
 *
 * - Single binding (`::Variant(e)` / `::Variant e`): the whole `.data` value
 *   binds to the one name — `const e = result.data;` (the established shape).
 * - Multi-field binding (`::Thrown(message, name)` — HostError, used heavily
 *   across stdlib): `.data` is a `{ field: value, ... }` object, so each
 *   binding name maps POSITIONALLY to the variant's declared payload field
 *   (`const message = result.data.message; const name = result.data.name;`),
 *   mirroring emitVariantBindingPrelude. When the field schema is unknown
 *   (e.g. an imported error type whose decl isn't in _variantFields), fall back
 *   to positional `.data[i]` index access so the emit is still valid JS rather
 *   than the pre-fix corrupted single-ident parse.
 */
function emitGuardedArmBinding(binding: string, variantName: string, resultVar: string): string[] {
  const names = binding.split(",").map((s) => s.trim()).filter((s) => s.length > 0 && s !== "_");
  if (names.length === 0) return [];
  if (names.length === 1) {
    return [`    const ${names[0]} = ${resultVar}.data;`];
  }
  const schema = getVariantFieldSchema(variantName);
  const out: string[] = [];
  for (let i = 0; i < names.length; i++) {
    if (names[i] === "_") continue;
    // `.data` is a field-keyed object for multi-field variants (the enum
    // constructor + the fixed fail-expr both emit `data: { field: value }`).
    // Resolve the field name positionally from the declared schema; when the
    // schema is unknown (e.g. an imported error type whose decl isn't in this
    // file's _variantFields), fall back to binding-name-as-field — the
    // canonical usages name the binding to MATCH the declared field
    // (`::Thrown(message, name)`), so `data.<bindingName>` is correct there.
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
    const variants = (entry.variants as Array<{ name: string }> | undefined) ?? [];
    const variantStrings = variants.map(v =>
      `{name: ${JSON.stringify(v.name)}}`
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
  const wrappedDefault = arrowBodyNeedsParens(defaultExpr) ? `(${defaultBody})` : defaultBody;
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

  // Prefer the structured `initExpr` (Phase 3 fast path); fall back to the
  // raw `init` string when only the legacy AST shape is available. Both
  // paths produce the same emitted JS via emitExprField. When neither is
  // present (e.g. tilde-only init or other rare shapes), skip — there's
  // nothing to re-evaluate.
  if (node.initExpr) {
    const initBody = emitExpr(node.initExpr, _makeExprCtx(opts));
    // GITI-014: paren-wrap object-literal bodies — `() => {a: 1}` mis-parses
    // as a block statement; `() => ({a: 1})` parses as the expression we want.
    const wrappedInit = arrowBodyNeedsParens(node.initExpr) ? `(${initBody})` : initBody;
    return `_scrml_init_set(${JSON.stringify(encodedName)}, () => ${wrappedInit});`;
  }
  const initStr: string = node.init ?? "";
  // M-7C-D-12 Track 3: post-OQ-5(a) the "no init present" sentinel string is "null"
  // (was "undefined" pre-S90). Both branches treat the cell as un-initializable —
  // there's no real expression to re-evaluate on reset.
  if (!initStr || initStr === "null") return null;
  // Use emitExprField with the raw fallback so derivedNames/server-mode
  // routing matches the main reactive-set arm.
  const initBody = emitExprField(node.initExpr, initStr, _makeExprCtx(opts));
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
        return `let ${_letDeclLhs}; // SQL-init for ${_letDeclLhs} — client cannot evaluate _scrml_sql (E-CG-006); use a server function.`;
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
        return `const ${_constDeclLhs} = null; // SQL-init for ${_constDeclLhs} — client cannot evaluate _scrml_sql (E-CG-006); use a server function.`;
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
        const serverCtx: EmitExprContext = { ..._makeExprCtx(opts), mode: "server" };
        const rhsStr = emitExpr(_effectiveInitExpr, serverCtx);
        return `broadcast({ __type: "__sync", __key: ${JSON.stringify(node.name)}, __val: (${rhsStr}) });`;
      }
      // Phase 3 fast path: when initExpr is present, skip all string splitting/merging
      if (node.initExpr) {
        const rewrittenInit = emitExpr(_effectiveInitExpr, _makeExprCtx(opts));
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
      const rewrittenInit = emitExprField(node.initExpr, initStr, _makeExprCtx(opts));
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
      return emitIfStmt(node, { derivedNames: opts.derivedNames, synthCellKeys: opts.synthCellKeys, declaredNames: opts.declaredNames, insideFunctionBody: opts.insideFunctionBody });

    case "for-stmt":
      // §32 array accumulator: when tilde context is active, switch to array-mode before
      // emitting the loop body so lift calls push rather than overwrite.
      if (opts.tildeContext) {
        return _emitForStmtWithTilde(node, opts);
      }
      // S96 Issue C — thread fnBodyRegistry so emitForStmt's reactive-iterable
      // predicate can detect transitive @-refs through fn-call iterables.
      return emitForStmt(node, { dbVar: opts.dbVar, declaredNames: opts.declaredNames, insideFunctionBody: opts.insideFunctionBody, fnBodyRegistry: opts.fnBodyRegistry });

    case "while-stmt":
      // §32 array accumulator: same pattern as for-stmt above.
      if (opts.tildeContext) {
        return _emitWhileStmtWithTilde(node, opts);
      }
      // R25-Bug-42 (S138): thread `boundary` so SQL-bearing yield/return
      // statements inside the loop body emit via the server case "sql" path
      // when the enclosing fn is server-bound.
      return emitWhileStmt(node, { declaredNames: opts.declaredNames, insideFunctionBody: opts.insideFunctionBody, boundary: opts.boundary });

    case "do-while-stmt":
      // R25-Bug-42 (S138): thread `boundary` so SQL-bearing yield/return
      // statements inside the loop body emit via the server case "sql" path.
      return emitDoWhileStmt(node, { declaredNames: opts.declaredNames, insideFunctionBody: opts.insideFunctionBody, boundary: opts.boundary });

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
      const calls: any[] = node.chainedCalls ?? [];
      const { sql, params, segments } = extractSqlParams(rawQuery);
      const db = opts.dbVar ?? "_scrml_sql";

      const taggedFromParams = (): string => {
        const renderedParams = params.map(
          (p: string) => emitExprField(null, p, _makeExprCtx(opts)),
        );
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
        if (params.length > 0) {
          const tagged = taggedFromParams();
          if (method === "get" || method === "first") {
            return `(await ${tagged})[0] ?? null;`;
          }
          return `await ${tagged};`;
        }

        // Branch B: SQL uses bare ? placeholders + explicit call.args.
        // Use sql.unsafe(rawSql, [argArray]) — unsafe() accepts a bound array.
        if (call.args && call.args.trim()) {
          const argList = emitExprField(null, call.args.trim(), _makeExprCtx(opts));
          if (method === "get" || method === "first") {
            return `(await ${db}.unsafe(${JSON.stringify(sql)}, [${argList}]))[0] ?? null;`;
          }
          return `await ${db}.unsafe(${JSON.stringify(sql)}, [${argList}]);`;
        }

        // Branch C: no params, no call.args. Bare tagged template.
        const taggedNoParams = `${db}\`${sql.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${")}\``;
        if (method === "get" || method === "first") {
          return `(await ${taggedNoParams})[0] ?? null;`;
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
      const enumType: string = node.enumType ?? "";
      const variant: string = node.variant ?? "";
      const rawArgs: string = (node.args ?? "").trim();
      // M-7C-D-12 Track 3: when fail() carries no payload, emit `data: null`
      // (was `data: undefined` pre-S90) per §42.5/§42.8 canonical absence.
      //
      // gate-found-invalid-js-fix-wave (S141): a MULTI-field payload
      // (`fail HostError::Thrown(message, name)`) must emit `data` as a
      // FIELD-KEYED OBJECT matching the enum CONSTRUCTOR's shape
      // (emit-client.ts:emitEnumVariantObjects emits `data: { message, name }`),
      // so the consuming `!{ ::Thrown(message, name) -> ... }` arm reads
      // `result.data.message` / `result.data.name`. The pre-fix path emitted
      // `data: arg0, arg1` (a bare comma list in object-value position) ->
      // invalid JS (the gate's E-CODEGEN-INVALID-JS). A SINGLE-arg payload keeps
      // the established raw-value shape (`data: value`), read whole by a
      // single-name arm binding.
      let data: string;
      if (rawArgs.length === 0) {
        data = "null";
      } else {
        const argParts = _splitTopLevelCommas(rawArgs);
        if (argParts.length <= 1) {
          data = emitExprField(node.argsExpr, rawArgs, _makeExprCtx(opts));
        } else {
          const schema = getVariantFieldSchema(variant);
          const props = argParts.map((a, i) => {
            const field = schema && i < schema.length ? schema[i] : `_${i}`;
            return `${field}: ${emitExprField(null, a.trim(), _makeExprCtx(opts))}`;
          });
          data = `{ ${props.join(", ")} }`;
        }
      }
      return `return { __scrml_error: true, type: ${JSON.stringify(enumType)}, variant: ${JSON.stringify(variant)}, data: ${data} };`;
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
            const armCode = emitArmBody(arm, errVar, opts.machineBindings ?? null);
            for (const line of armCode.split("\n")) lines.push(`    ${line}`);
            lines.push(`  }`);
          } else {
            const typeName = arm.pattern ?? "";
            const cond = `${errVar} instanceof ${typeName} || (${errVar} && ${errVar}.type === ${JSON.stringify(typeName)})`;
            lines.push(`  ${isFirst ? "if" : "else if"} (${cond}) {`);
            if (arm.binding && arm.binding !== "_") {
              lines.push(`    const ${arm.binding} = ${errVar};`);
            }
            const armCode = emitArmBody(arm, errVar, opts.machineBindings ?? null);
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

      lines.push(`let ${resultVar} = ${_autoAwait ? "await " : ""}${initExpr};`);
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
        /^(?:_scrml_reactive_set\s*\(|_scrml_engine_[a-zA-Z_$][a-zA-Z0-9_$]*\s*\(|_scrml_navigate\s*\(|_scrml_register_cleanup\s*\(|_scrml_effect\s*\(|_scrml_init_set\s*\()/.test(stmt);

      const emitArmAssign = (armBody: string): string[] => {
        const trimmed = armBody.trim();
        // M-7C-D-12 Track 3: empty-body arm produces `resultVar = null;` (was `= undefined;`)
        // per §42.5/§42.8 canonical scrml absence.
        if (!trimmed) return [`    ${resultVar} = null;`];
        if (trimmed.includes("\n")) {
          // Multi-statement handler: emit body as-is (authors should assign to
          // resultVar themselves for non-trivial bodies).
          return trimmed.split("\n").map((l) => `    ${l}`);
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
          return stmts.map((s) => `    ${s};`);
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
          const armCode = emitArmBody(arm, resultVar, opts.machineBindings ?? null);
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
          lines.push(`  else { return ${resultVar}; }`);
        }
      } else {
        lines.push(`  return ${resultVar};`);
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
      const encodedTarget = ctx ? ctx.encode(node.target) : node.target;
      const target = JSON.stringify(encodedTarget);
      const path = JSON.stringify(node.path ?? []);
      // M-7C-D-12 Track 3: fallback uses "null" not "undefined" per §42.5/§42.8.
      const value = emitExprField(node.valueExpr, node.value ?? "null", _makeExprCtx(opts));
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

      return [
        `_scrml_meta_effect(${metaScopeId}, function(meta) {`,
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

      const fnLines: string[] = [];
      fnLines.push(`function${generatorStar} ${fnName}(${paramSigs.join(", ")}) {`);

      // Function body has its own scope for declared names. C5: set
      // `insideFunctionBody` so init-thunk sidecar is suppressed for any
      // `@x = expr` reassignments (which are AST-shaped as state-decls but
      // are not declaration sites).
      const fnOpts: EmitLogicOpts = { ...opts, declaredNames: new Set<string>(), insideFunctionBody: true };
      const body: any[] = node.body ?? [];

      const bodyCodes = emitFnShortcutBody(body, fnOpts, node.fnKind, node.hasReturnType);
      for (const code of bodyCodes) {
        for (const line of code.split("\n")) {
          fnLines.push(`  ${line}`);
        }
      }

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
    const nestedCond = emitExprField(nestedIf.condExpr, (nestedIf.condition ?? "true").trim(), _makeExprCtx({}));
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
  const needsTagNormalization = hasPayloadBindingOrTaggedVariant(arms);
  const tagVar = needsTagNormalization ? genVar("tag") : tmpVar;
  if (needsTagNormalization) {
    lines.push(
      `const ${tagVar} = (${tmpVar} != null && typeof ${tmpVar} === "object") ? ${tmpVar}.variant : ${tmpVar};`,
    );
  }

  // Emit arms as if/else-if chain with tilde assignment
  let conditionIndex = 0;
  for (const arm of arms) {
    const bindingPrelude = arm.kind === "variant" ? emitVariantBindingPrelude(arm, tmpVar) : "";
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

    // Raw result: assign rewritten expression to tilde var
    if (arm.kind === "wildcard") {
      lines.push(`else {`);
      if (arm.binding) lines.push(`  const ${arm.binding} = ${tmpVar};`);
      lines.push(`  ${tildeVar} = ${emitExprField(null, arm.result, _makeExprCtx(opts))};`);
      lines.push(`}`);
    } else if (arm.kind === "not") {
      const prefix = conditionIndex === 0 ? "if" : "else if";
      lines.push(`${prefix} (${tmpVar} === null || ${tmpVar} === undefined) {`);
      lines.push(`  ${tildeVar} = ${emitExprField(null, arm.result, _makeExprCtx(opts))};`);
      lines.push(`}`);
      conditionIndex++;
    } else {
      const prefix = conditionIndex === 0 ? "if" : "else if";
      const cmp = arm.kind === "variant"
        ? `${tagVar} === "${arm.test}"`
        : `${tmpVar} === ${arm.test}`;
      lines.push(`${prefix} (${cmp}) {`);
      if (bindingPrelude) lines.push(`  ${bindingPrelude.trimEnd()}`);
      lines.push(`  ${tildeVar} = ${emitExprField(null, arm.result, _makeExprCtx(opts))};`);
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

  // Pre-scan: does `~` appear in any expression in this sequence?
  const tildeUsed = nodeListContainsTildeRef(nodes);

  if (!tildeUsed) {
    // No tilde references — use plain emission (no overhead, no behavior change)
    return nodes
      .map((n: any) => emitLogicNode(n, { ...opts, declaredNames }))
      .filter((s: string) => s.trim() !== "");
  }

  // Tilde context: a shared mutable object threaded through each emitLogicNode call.
  // `var` holds the current tilde variable name (null = no active tilde).
  const tildeCtx: { var: string | null; mode?: "single" | "array" } = { var: null };
  const optsWithTilde: EmitLogicOpts = { ...opts, tildeContext: tildeCtx, declaredNames };

  return nodes
    .map((n: any) => emitLogicNode(n, optsWithTilde))
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
