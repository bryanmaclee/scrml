import { rewriteReactiveRefs } from "./rewrite.js";
import { rewriteBlockBody, type EngineRewriteCtx } from "./emit-control-flow.ts";
import { emitExprField } from "./emit-expr.ts";
import {
  maybeLowerCancelTimerCallRef,
  buildEngineBindingsMap,
  collectEngineVarNames,
  collectEnginesWithHooks,
  collectEnginesWithOnTimeout,
  collectEnginesWithIdleWatchdog,
  collectEnginesWithInternalRules,
  collectEnginesWithHistory,
} from "./emit-engine.ts";
import type { ExprNode } from "../types/ast.ts";
import type { EncodingContext } from "./type-encoding.ts";
import type { CompileContext } from "./context.ts";

/** An event binding recorded by HTML gen and consumed by client JS gen. */
interface EventBinding {
  placeholderId: string;
  eventName: string;
  handlerName: string;
  handlerArgs?: unknown[];
  /** Raw expression handler from ${...} attribute values (e.g. "() => fn(arg)"). */
  handlerExpr?: string;
  /** Phase 3: structured ExprNode form of `handlerExpr`. */
  handlerExprNode?: ExprNode;
  /** Phase 4: structured ExprNode for each handler arg. */
  handlerArgExprNodes?: ExprNode[];
  /**
   * Phase A10 (S78, 2026-05-10) — engine arm context tag.
   * Set when this event binding was emitted while the registry was inside
   * an engine arm context. Format `"<engineVarName>:<armTag>"` (e.g.
   * `"phase:Showing"`). Non-delegable events tagged with `engineArm` are
   * EXCLUDED from global emission here and re-emitted PER-ARM by
   * `emit-variant-guard.ts:emitArmWireFunction` so the listener is
   * re-attached after each variant change's innerHTML replace.
   * Delegable events (click, submit) are kept in global emission even
   * when arm-tagged because document-level delegation survives the
   * innerHTML replace. See emit-variant-guard.ts JSDoc for the full re-wire
   * mechanism.
   */
  engineArm?: string;
}

/** A logic binding recorded by HTML gen and consumed by client JS gen. */
interface LogicBinding {
  placeholderId?: string;
  expr?: string;
  reactiveRefs?: Set<string> | null;
  isConditionalDisplay?: boolean;
  isVisibilityToggle?: boolean;
  /** Phase 2 if/show split: mount/unmount semantics. See binding-registry.ts. */
  isMountToggle?: boolean;
  templateId?: string;
  markerId?: string;
  varName?: string;
  condExpr?: string;
  /** Phase 3: structured ExprNode form of `condExpr`. */
  condExprNode?: ExprNode;
  refs?: string[];
  dotPath?: string;
  transitionEnter?: string;
  transitionExit?: string;
  /** Phase 3: structured ExprNode form of `expr`. */
  exprNode?: ExprNode;
  /**
   * Phase 2g: chain-binding fields. See binding-registry.ts and emit-html.ts
   * chain handler. `kind` discriminates positive (`if-chain-branch`) vs else
   * (`if-chain-else`). `branchMode` decides per-branch whether the chain
   * controller mounts/unmounts via _scrml_mount_template/_scrml_unmount_scope
   * (clean) or toggles wrapper.style.display (dirty fallback).
   *
   * A1c C11: `errors-element` discriminates the `<errors of=expr/>` first-class
   * element binding (SPEC §55.8 / L13).
   */
  kind?: "if-chain-branch" | "if-chain-else" | "errors-element";
  chainId?: string;
  branchId?: string;
  branchIndex?: number;
  branchMode?: "mount" | "display";
  condition?: any;

  /**
   * A1c C11 — `<errors of=expr/>` element binding fields.
   * Required when `kind === "errors-element"`. See binding-registry.ts.
   */
  anchorId?: string;
  errorsKey?: string;
  isCompoundRollup?: boolean;
  allFlag?: boolean;
  fieldName?: string;
  bodyExpr?: string;
  bodyExprNode?: ExprNode;

  /**
   * Phase A10 (S78, 2026-05-10) — engine arm context tag.
   * Set when this logic binding was emitted while the registry was inside
   * an engine arm context. Format `"<engineVarName>:<armTag>"` (e.g.
   * `"phase:Showing"`). Default reactive-text bindings (kind === undefined)
   * tagged with `engineArm` are EXCLUDED from global emission here and
   * re-emitted PER-ARM by `emit-variant-guard.ts:emitArmWireFunction` so
   * the textContent + _scrml_effect re-bind to the new placeholder element
   * after each variant change's innerHTML replace. Out-of-scope kinds
   * (errors-element, if-chain-branch, if-chain-else, mount-toggle,
   * conditional-display) keep their existing global emission as a v1
   * documented limitation — see emit-variant-guard.ts JSDoc out-of-scope
   * list for follow-on work.
   */
  engineArm?: string;
}

/**
 * Emit event handler wiring and reactive display wiring.
 *
 * Event handler wiring: Uses data-scrml-bind-* attributes to find elements
 * and attach event listeners. Requires fnNameMap to resolve original function
 * names to their generated names.
 *
 * Approach D (Hybrid Delegation): Splits event handling into two codegen paths:
 *
 * 1. DELEGABLE events (click, submit): Emit a handler registry object and a
 *    single document.addEventListener per event type. The listener walks
 *    event.target up to document checking data-scrml-bind-<eventName>, then
 *    dispatches from the registry. This reduces N individual element listeners
 *    to 1 delegated listener per delegable event type.
 *
 * 2. NON-DELEGABLE events (focus, blur, scroll, change, input, mouseenter,
 *    mouseleave, etc.): Keep Approach A batch querySelectorAll + forEach +
 *    addEventListener per element. These events either do not bubble or have
 *    semantics where delegation is incorrect.
 *
 * bind:value, bind:checked, class:, if= wiring is unchanged — these retain
 * per-element querySelector because reactive subscriptions need persistent
 * element references.
 *
 * @param {{
 *   eventBindings: EventBinding[],
 *   logicBindings: LogicBinding[],
 *   fnNameMap: Map<string, string>,
 * }} params
 * @returns {string[]} lines — JS lines to append to the client module
 */

/**
 * Events that bubble reliably and are safe to delegate to document.
 * All other event types use Approach A (querySelectorAll + forEach).
 */
const DELEGABLE_EVENTS = new Set(["click", "submit"]);

/**
 * Find the matching closing brace/paren/bracket starting at `openPos`.
 * Returns the index of the closing character, or -1 if not found.
 */
function findMatchingClose(str: string, openPos: number): number {
  const open = str[openPos];
  const close = open === "{" ? "}" : open === "(" ? ")" : "]";
  let depth = 1;
  let i = openPos + 1;
  while (i < str.length) {
    const ch = str[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      i++;
      while (i < str.length && str[i] !== ch) {
        if (str[i] === "\\") i++;
        i++;
      }
    } else if (ch === open) {
      depth++;
    } else if (ch === close) {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

/**
 * If `raw` is a `fn(params) { body }` expression (the scrml fn shorthand),
 * return { params, body } with the body content extracted.
 * Returns null if it is not a fn() expression.
 *
 * This lets the caller rewrite only the body with rewriteBlockBody and then
 * construct a proper `function(params) { rewritten_body }` without double-wrapping.
 */
function parseFnExpression(raw: string): { params: string; body: string } | null {
  // Match: optional whitespace, then `fn` keyword, then `(`
  const m = raw.match(/^\s*fn\s*(\()/);
  if (!m) return null;

  // Find the closing paren of the parameter list
  const parenOpen = raw.indexOf("(", m.index! + (m[0].length - 1));
  const parenClose = findMatchingClose(raw, parenOpen);
  if (parenClose < 0) return null;
  const params = raw.slice(parenOpen + 1, parenClose).trim();

  // Find the opening brace of the body
  const afterParen = raw.slice(parenClose + 1).trimStart();
  if (!afterParen.startsWith("{")) return null;
  const braceOpen = parenClose + 1 + (raw.slice(parenClose + 1).length - afterParen.length);
  const braceClose = findMatchingClose(raw, braceOpen);
  if (braceClose < 0) return null;
  const body = raw.slice(braceOpen + 1, braceClose).trim();

  return { params, body };
}

/**
 * If `raw` is an arrow function `(params) => body` or `param => body`,
 * return true. These can be used directly as event handler values without
 * wrapping in `function(event) { ... }`.
 */
function isArrowFunction(raw: string): boolean {
  return /^\s*\([^)]*\)\s*=>/.test(raw) ||
         /^\s*[\w$_][\w$_0-9]*\s*=>/.test(raw);
}

/**
 * Build a set of server-function names (user-level names) from fnNameMap.
 * A server fn is identified by the `_scrml_fetch_<name>_N` or `_scrml_cps_<name>_N`
 * prefix of its generated mangled name — both are produced only in emitFunctions
 * for nodes whose route boundary is "server" (see emit-functions.ts).
 *
 * Used by the reactive-display wiring to detect `${serverFn()}` interpolations
 * and emit an async-await wrapper so the awaited value (not the Promise) lands
 * as the element's textContent. Bug GITI-005 (giti inbound 2026-04-20).
 */
function buildServerFnNames(fnNameMap: Map<string, string>): Set<string> {
  const out = new Set<string>();
  for (const [original, generated] of fnNameMap) {
    if (/^_scrml_(fetch|cps)_/.test(generated)) out.add(original);
  }
  return out;
}

/**
 * Return true if an expression contains a top-level call to any server fn
 * whose name is in `serverFnNames`. Conservative textual check — a simple
 * "<name>(" pattern (with word boundary) is sufficient because server fn
 * names are post-mangling rewritten in expressions, but this check runs on
 * the pre-rewrite scrml string (which contains the original names).
 */
function exprUsesServerFn(expr: string, serverFnNames: Set<string>): boolean {
  if (!expr || serverFnNames.size === 0) return false;
  for (const name of serverFnNames) {
    // Match name followed by optional whitespace and `(` — not preceded by a
    // property-access `.` (so we don't match `obj.name(` as a server-fn call).
    const re = new RegExp(`(?<![.\\w$])${name.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\s*\\(`, "");
    if (re.test(expr)) return true;
  }
  return false;
}

export function emitEventWiring(ctx: CompileContext, fnNameMap: Map<string, string>): string[] {
  const allEventBindings = ctx.registry.eventBindings as EventBinding[];
  const allLogicBindings = ctx.registry.logicBindings as LogicBinding[];

  // Phase A10 (S78, 2026-05-10) — re-wire-on-variant-change.
  //
  // Filter out arm-tagged bindings that emit-variant-guard.ts:emitArmWireFunction
  // is re-emitting per-arm. The filter is precise:
  //
  //   * Logic bindings: skip global ONLY when `engineArm` is set AND the
  //     binding is the default reactive-text kind (`kind === undefined`,
  //     not a conditional-display / mount-toggle / visibility variant).
  //     Out-of-scope kinds (errors-element, if-chain-branch, if-chain-else,
  //     isMountToggle, isConditionalDisplay, isVisibilityToggle) keep their
  //     global emission — see emit-variant-guard.ts JSDoc out-of-scope list.
  //
  //   * Event bindings: skip global ONLY when `engineArm` is set AND the
  //     event is non-delegable. Delegable events (click, submit) survive
  //     innerHTML replace via document-level delegation, so they stay in
  //     the global delegation registry regardless of arm tag.
  const eventBindings = allEventBindings.filter((b) => {
    if (!b.engineArm) return true;
    const domEvent = (b.eventName || "").replace(/^on/, "");
    // Delegable events stay in global registry; non-delegable arm-tagged
    // events are re-emitted by emitArmWireFunction.
    return DELEGABLE_EVENTS.has(domEvent);
  });
  const logicBindings = allLogicBindings.filter((b) => {
    if (!b.engineArm) return true;
    // Default reactive-text binding (kind === undefined) AND not a
    // conditional-display / mount-toggle / visibility variant → handled
    // per-arm. All other kinds remain in global emission (v1 limitation
    // for those out-of-scope surfaces).
    if (b.kind != null) return true;
    if (b.isConditionalDisplay) return true;
    if (b.isVisibilityToggle) return true;
    if (b.isMountToggle) return true;
    return false;
  });

  const encodingCtx = ctx.encodingCtx;
  const serverFnNames = buildServerFnNames(fnNameMap);
  const lines: string[] = [];

  const hasEvents = eventBindings && eventBindings.length > 0;
  const hasLogic = logicBindings && logicBindings.length > 0;
  if (!hasEvents && !hasLogic) {
    return lines;
  }

  // Bug #6 (s83-a7, §51.0.F + §51.0.G + §51.0.H + §51.0.N + §51.0.O + §51.0.Q.1)
  // — build engine context once for this file so event-handler bodies
  // containing `@engineVar = .X` (direct write) AND `@engineVar.advance(.X)`
  // (loud advance) route through the canonical write-guard path. Without
  // this, event handlers — the most common user-facing surface for engine
  // transitions — silently bypass rule= enforcement, <onTransition> hooks,
  // internal:rule= dispatch, history capture, and history-restore.
  //
  // Tree-shake: when the file has no `<engine>` declarations,
  // `buildEngineBindingsMap` returns null and every collect* helper returns
  // an empty Set. The threaded EngineRewriteCtx is then a no-op object.
  const engineBindings = buildEngineBindingsMap(ctx.fileAST);
  const engineVarNames = collectEngineVarNames(ctx.fileAST);
  const enginesWithHooks = collectEnginesWithHooks(ctx.fileAST);
  const enginesWithOnTimeout = collectEnginesWithOnTimeout(ctx.fileAST);
  const enginesWithIdleWatchdog = collectEnginesWithIdleWatchdog(ctx.fileAST);
  const enginesWithInternalRules = collectEnginesWithInternalRules(ctx.fileAST);
  const enginesWithHistory = collectEnginesWithHistory(ctx.fileAST);
  const engineRewriteCtx: EngineRewriteCtx | null =
    engineBindings != null || engineVarNames.size > 0
      ? {
          engineBindings: engineBindings,
          exprCtxExtras: {
            engineVarNames: engineVarNames.size > 0 ? engineVarNames : null,
            enginesWithHooks: enginesWithHooks.size > 0 ? enginesWithHooks : null,
            enginesWithOnTimeout: enginesWithOnTimeout.size > 0 ? enginesWithOnTimeout : null,
            enginesWithIdleWatchdog: enginesWithIdleWatchdog.size > 0 ? enginesWithIdleWatchdog : null,
            enginesWithInternalRules: enginesWithInternalRules.size > 0 ? enginesWithInternalRules : null,
            enginesWithHistory: enginesWithHistory.size > 0 ? enginesWithHistory : null,
            // §51.0.F (Option A) — forward engine binding-info so nested
            // expression contexts (lambda body / ternary RHS / call args /
            // compound exprs) inside event-handler bodies route engine
            // writes through `emit-expr.ts:emitAssign`'s engine-routing
            // dispatch.
            engineBindings: engineBindings,
          },
        }
      : null;
  // Convenience EmitExprContext spread for direct emitExprField calls below
  // (Case B arrow functions etc. that don't pass through rewriteBlockBody).
  const engineExprCtxExtras = engineRewriteCtx?.exprCtxExtras ?? {};

  lines.push("");
  lines.push("// --- Event handler wiring (compiler-generated) ---");
  lines.push("document.addEventListener('DOMContentLoaded', function() {");

  // -------------------------------------------------------------------------
  // Step 8: Wire event handlers from HTML bindings to generated functions
  //
  // Approach D: Split by delegability.
  //   - Delegable (click, submit): handler registry + document.addEventListener
  //     with ancestor walk. One listener per delegable event type.
  //   - Non-delegable: Approach A querySelectorAll + forEach per event type.
  // -------------------------------------------------------------------------

  // Group event bindings by event type (e.g. "onclick", "onsubmit", "onchange")
  const byEventType = new Map<string, Array<{placeholderId: string; handlerExpr: string}>>();

  for (const binding of eventBindings) {
    const { placeholderId, eventName, handlerName, handlerArgs } = binding;
    const domEvent = eventName.replace(/^on/, ""); // onclick → click

    let handlerExpr: string;

    if (binding.handlerExpr) {
      // Raw expression from ${...} attribute value — use as the handler body.
      // Three cases:
      //
      // Case A: fn() { body } — scrml fn shorthand. The fn keyword rewrites to
      //   `function`, but wrapping the result in `function(event) { function() {...}; }`
      //   produces an unnamed function declaration statement — a JS syntax error.
      //   Instead, extract the body, rewrite it with rewriteBlockBody (so @var = expr
      //   becomes _scrml_reactive_set, etc.), and construct function(params) { body }.
      //
      // Case B: Arrow function `(p) => expr` or `p => expr`. Already callable.
      //   Use rewriteExpr on the whole thing and place it directly as the handler.
      //
      // Case C: Plain expression / statement. Rewrite with rewriteBlockBody and
      //   wrap in `function(event) { ... }` so it's a valid callable handler value.

      const fnParsed = parseFnExpression(binding.handlerExpr);
      if (fnParsed !== null) {
        // Case A: fn(params) { body } — rewrite the body, construct function directly.
        // Bug #6 (s83-a7): thread engineCtx so `@engineVar = .X` + `.advance(.X)`
        // inside the body route through the canonical write-guard path.
        const rewrittenBody = rewriteBlockBody(fnParsed.body, null, engineRewriteCtx);
        handlerExpr = `function(${fnParsed.params}) { ${rewrittenBody}; }`;
      } else if (isArrowFunction(binding.handlerExpr)) {
        // Case B: Arrow function — rewrite reactive refs in the expression but
        // do not add an outer wrapper. Bug #6 (s83-a7): thread engine ctx into
        // the EmitExprContext so `.advance(.X)` calls inside the arrow body
        // dispatch to `_scrml_engine_advance` via the C13 detection arm.
        handlerExpr = emitExprField(binding.handlerExprNode, binding.handlerExpr, {
          mode: "client",
          ...engineExprCtxExtras,
        });
      } else {
        // Case C: Plain expression or statement body. Rewrite and wrap.
        // Bug #6 (s83-a7): thread engineCtx — this is the canonical
        // `onclick=${@phase = .Loading}` pattern that must route through
        // the engine write-guard.
        //
        // The C13 `.advance(.X)` detection in `emit-expr.ts:emitCall` operates
        // on STRUCTURED ExprNodes; the string-fallback path
        // (`rewriteExprWithDerived`) does NOT detect `.advance` on engine
        // vars. So when `binding.handlerExprNode` is present AND the body is
        // a single non-assignment expression (a CallExpr like
        // `@engineVar.advance(.X)` is the canonical case), prefer the
        // structured emit path so the C13 detection arm fires.
        // AssignExprs (`@phase = .X`) keep the `rewriteBlockBody` path so
        // the engine assign-regex arm (also added by Bug #6) catches them
        // and dispatches to `emitEngineWriteGuard` — `emitAssign` itself
        // does NOT have engine-binding interception.
        //
        // S97 — `unary` is also excluded so postfix `@count++` / `@count--`
        // (UnaryExpr in the AST) routes through `rewriteBlockBody` and the
        // extended `rewriteReactiveAssign` (rewrite.ts) lowers
        // `_scrml_reactive_get("X")++` → `_scrml_reactive_set("X", _scrml_reactive_get("X") + 1)`.
        // Without this exclusion, `emitUnary` emits the raw `getter()++`
        // which is invalid JS (can't increment a function-call return value).
        const exprNode = binding.handlerExprNode as { kind?: string } | undefined;
        if (exprNode && exprNode.kind !== "assign" && exprNode.kind !== "lambda" && exprNode.kind !== "unary") {
          // Single structured expression — use emitExprField so engine
          // `.advance(.X)` (and any other structured-only detection in
          // emit-expr.ts) routes correctly.
          const body = emitExprField(binding.handlerExprNode, binding.handlerExpr, {
            mode: "client",
            ...engineExprCtxExtras,
          });
          handlerExpr = `function(event) { ${body}; }`;
        } else {
          const rewritten = rewriteBlockBody(binding.handlerExpr, null, engineRewriteCtx);
          // If the expression is a bare identifier (function reference without call parens),
          // append () to actually invoke it. onclick=${advance} should call advance(), not
          // just reference it as a dead expression statement.
          const isBareRef = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(rewritten.trim());
          const body = isBareRef ? `${rewritten}()` : rewritten;
          handlerExpr = `function(event) { ${body}; }`;
        }
      }
    } else {
      // call-ref path: resolve handler name and serialize arguments
      // Resolve the handler: check fnNameMap first, fall back to original name
      const resolvedHandler = fnNameMap.get(handlerName) || handlerName;

      // Serialize the arguments from the call-ref attribute value.
      // Args from the parser are raw expression strings (e.g. '"apple"', 'userId', '9.99').
      // Object args with .kind need special handling.
      const _argNodes = binding.handlerArgExprNodes;
      const argsStr = (handlerArgs ?? []).map((a: unknown, idx: number) => {
        if (typeof a === "string") return emitExprField(_argNodes?.[idx], a, { mode: "client" });
        const node = a as Record<string, unknown>;
        if (node && node.kind === "string-literal") return JSON.stringify(node.value);
        if (node && node.kind === "number-literal") return String(node.value);
        if (node && node.kind === "variable-ref") return `_scrml_reactive_get(${JSON.stringify(((node.name as string) || "").replace(/^@/, ""))})`;
        if (node && typeof node.value !== "undefined") return JSON.stringify(node.value);
        return String(a);
      }).join(", ");

      // For submit events on forms, auto-inject event.preventDefault()
      const preventLine = domEvent === "submit" ? "event.preventDefault(); " : "";
      // A5-6 Feature 1 (§51.0.M name= extension, S79). When the call-ref is
      // `cancelTimer("X")` AND this binding is arm-tagged (`engineArm` set
      // by Phase A10's `pushArmContext` during arm-body codegen), lower it
      // to `_scrml_engine_clear_named_timer("<varName>", "<armTag>", "X")`.
      // The (varName, armTag) is extracted from `binding.engineArm` (format:
      // `"<varName>:<armTag>"`). Outside an arm context the call-ref falls
      // through to the ordinary path (which runtime-fails with `cancelTimer
      // is not defined` — v1 doesn't promote that to a compile-time
      // diagnostic; v2 follow-up may add `E-CANCEL-TIMER-MISPLACED`).
      const cancelTimerLowered = maybeLowerCancelTimerCallRef(
        handlerName, handlerArgs ?? [], binding.engineArm,
      );
      if (cancelTimerLowered !== null) {
        handlerExpr = `function(event) { ${preventLine}${cancelTimerLowered}; }`;
      } else {
        // SPEC §5.2.2 normative: `onclick=fn()` SHALL emit
        // `function(event) { fn(); }` — `fn` is invoked with the user's
        // declared args (none for bare-call zero-args). The wrapper STILL
        // takes `event` as its parameter (so it satisfies the listener
        // signature), but does NOT forward it into `fn`. The escape-hatch
        // for "needs event" is `onclick=${(e) => fn(e)}` per §5.2.2 line 1123.
        //
        // S96 Bug 14 fix — pre-fix code at this site cited "tutorial §1.5:
        // passes the native event implicitly" + a locked test
        // (event-handler-args-e2e.test.js §4 "threads event"). Tutorial is
        // not normative (Rule 4); locked test was locking spec-divergent
        // behavior. User explicitly chose option-1-spec-wins. Tutorial §1.5
        // also needs alignment.
        handlerExpr = `function(event) { ${preventLine}${resolvedHandler}(${argsStr}); }`;
      }
    }

    if (!byEventType.has(eventName)) {
      byEventType.set(eventName, []);
    }
    byEventType.get(eventName)!.push({ placeholderId, handlerExpr });
  }

  // Emit wiring — delegable events use document.addEventListener with ancestor
  // walk; non-delegable events use Approach A querySelectorAll + forEach.
  for (const [eventName, entries] of byEventType) {
    const domEvent = eventName.replace(/^on/, ""); // onclick → click

    if (DELEGABLE_EVENTS.has(domEvent)) {
      // -----------------------------------------------------------------------
      // Approach D path: handler registry + delegated document listener
      // -----------------------------------------------------------------------
      const registryVarName = `_scrml_${domEvent}`;

      // Emit the handler registry object
      lines.push(`  const ${registryVarName} = {`);
      for (const { placeholderId, handlerExpr } of entries) {
        lines.push(`    ${JSON.stringify(placeholderId)}: ${handlerExpr},`);
      }
      lines.push(`  };`);

      // Emit a single document.addEventListener with ancestor walk
      lines.push(`  document.addEventListener(${JSON.stringify(domEvent)}, function(event) {`);
      lines.push(`    let t = event.target;`);
      lines.push(`    while (t && t !== document) {`);
      lines.push(`      const id = t.getAttribute(${JSON.stringify("data-scrml-bind-" + eventName)});`);
      lines.push(`      if (id && ${registryVarName}[id]) { ${registryVarName}[id](event); return; }`);
      lines.push(`      t = t.parentElement;`);
      lines.push(`    }`);
      lines.push(`  });`);
    } else {
      // -----------------------------------------------------------------------
      // Approach A path: batch querySelectorAll + forEach per event type
      // -----------------------------------------------------------------------
      const mapVarName = `_scrml_${domEvent}_handlers`;

      // Emit the handler dispatch map
      lines.push(`  const ${mapVarName} = {`);
      for (const { placeholderId, handlerExpr } of entries) {
        lines.push(`    ${JSON.stringify(placeholderId)}: ${handlerExpr},`);
      }
      lines.push(`  };`);

      // Emit one querySelectorAll to wire all handlers for this event type
      lines.push(`  document.querySelectorAll('[data-scrml-bind-${eventName}]').forEach(function(el) {`);
      lines.push(`    const _scrml_id = el.getAttribute('data-scrml-bind-${eventName}');`);
      lines.push(`    if (${mapVarName}[_scrml_id]) el.addEventListener(${JSON.stringify(domEvent)}, ${mapVarName}[_scrml_id]);`);
      lines.push(`  });`);
    }
  }

  // -------------------------------------------------------------------------
  // Step 9: Wire reactive display for logic placeholders
  // -------------------------------------------------------------------------
  if (logicBindings && logicBindings.length > 0) {
    lines.push("");
    lines.push("  // --- Reactive display wiring ---");

    // ---------------------------------------------------------------------
    // A1c C11 — `<errors of=expr/>` first-class element runtime wiring
    // (SPEC §55.8, L13). Emitted ONCE per compilation when at least one
    // errors-element binding exists. Defines the local `_scrml_render_errors`
    // helper which subscribes to the source errors cell and re-renders on
    // change. Per-binding wiring follows the same loop as other bindings.
    //
    // C10 sibling note: `_scrml_message_for(tag, fieldName)` is C10's helper
    // (4-level message resolution chain, §55.10). Until C10 lands, this code
    // emits a stub fallback in the binding's own scope — `messageForFn` —
    // which prefers an existing global `_scrml_message_for` if defined and
    // falls back to a local stub returning `String(tag.tag)`. PA reconciles
    // when C10's `_scrml_message_for` lands; consumer code is unaffected.
    // ---------------------------------------------------------------------

    for (const binding of logicBindings) {
      const { placeholderId, expr } = binding;

      // -----------------------------------------------------------------
      // A1c C11 — `<errors of=expr/>` element wiring per binding.
      // -----------------------------------------------------------------
      if (binding.kind === "errors-element" && binding.anchorId && binding.errorsKey) {
        // Encode the source errors cell key (compound or per-field). The
        // suffix `.errors` is appended *after* encoding because the C8
        // emission writes encoded keys like `signup.errors` (encoded as a
        // single unit) — but in practice the type-encoding context encodes
        // base names (`signup`, `signup.name`) and the `.errors` suffix is
        // appended by emit-synth-surface AFTER encoding. To match, we encode
        // `${errorsKey}.errors` as a single string. Since C8 calls
        // `encodeKey(${qualifiedName}.errors)` to build the key, we mirror.
        const sourceErrorsKey = `${binding.errorsKey}.errors`;
        const encodedSourceKey = encodingCtx && encodingCtx.enabled
          ? encodingCtx.encode(sourceErrorsKey)
          : sourceErrorsKey;

        const anchorId = binding.anchorId;
        const isRollup = binding.isCompoundRollup === true;
        const allFlag = binding.allFlag === true;
        const fieldName = binding.fieldName ?? "";

        // Compile the body-override arrow function if present. Reactive ref
        // rewrite + emit through emitExprField so any `@vars` resolve.
        let bodyFn: string | null = null;
        if (binding.bodyExpr) {
          bodyFn = emitExprField(binding.bodyExprNode, binding.bodyExpr, { mode: "client" });
        }

        const suffix = anchorId.replace(/[^a-zA-Z0-9_]/g, "_");
        lines.push(`  // <errors of=...> element wiring (C11)`);
        lines.push(`  {`);
        lines.push(`    const el = document.querySelector('[data-scrml-errors-anchor=${JSON.stringify(anchorId)}]');`);
        lines.push(`    if (el) {`);
        // Local messageFor — prefers a global C10 implementation, falls back
        // to a stub returning the tag string.
        lines.push(`      const messageForFn_${suffix} = (typeof _scrml_message_for === "function")`);
        lines.push(`        ? _scrml_message_for`);
        lines.push(`        : function (errTag, _field) {`);
        lines.push(`            if (errTag == null) return "";`);
        lines.push(`            if (typeof errTag === "object" && errTag.tag != null) return String(errTag.tag);`);
        lines.push(`            return String(errTag);`);
        lines.push(`          };`);
        // Body-override factory — when absent, the default render shape per
        // SPEC line 25190.
        if (bodyFn !== null) {
          lines.push(`      const bodyFn_${suffix} = ${bodyFn};`);
          lines.push(`      const renderOne_${suffix} = function(errTag, field) {`);
          lines.push(`        const out = bodyFn_${suffix}(errTag);`);
          lines.push(`        return (out == null) ? "" : String(out);`);
          lines.push(`      };`);
        } else {
          lines.push(`      const renderOne_${suffix} = function(errTag, field) {`);
          lines.push(`        return '<p class="scrml-error">' + messageForFn_${suffix}(errTag, field) + '</p>';`);
          lines.push(`      };`);
        }
        // Render function: reads source errors, iterates per (allFlag,
        // isRollup), produces innerHTML. Empty source → empty innerHTML
        // (no DOM). Per SPEC line 25193-25195.
        lines.push(`      const render_${suffix} = function() {`);
        lines.push(`        const src = _scrml_derived_get(${JSON.stringify(encodedSourceKey)});`);
        if (isRollup) {
          // Compound rollup: src is an object map {field: [tags]}.
          lines.push(`        if (!src || typeof src !== "object") { el.innerHTML = ""; return; }`);
          lines.push(`        const entries = Object.entries(src);`);
          lines.push(`        const parts = [];`);
          lines.push(`        for (const [fieldKey, arr] of entries) {`);
          lines.push(`          if (!Array.isArray(arr) || arr.length === 0) continue;`);
          if (allFlag) {
            lines.push(`          for (const tag of arr) parts.push(renderOne_${suffix}(tag, fieldKey));`);
          } else {
            lines.push(`          parts.push(renderOne_${suffix}(arr[0], fieldKey));`);
          }
          lines.push(`        }`);
          lines.push(`        el.innerHTML = parts.join("");`);
        } else {
          // Per-field: src is an array of tags.
          lines.push(`        if (!Array.isArray(src) || src.length === 0) { el.innerHTML = ""; return; }`);
          if (allFlag) {
            lines.push(`        const parts = [];`);
            lines.push(`        for (const tag of src) parts.push(renderOne_${suffix}(tag, ${JSON.stringify(fieldName)}));`);
            lines.push(`        el.innerHTML = parts.join("");`);
          } else {
            lines.push(`        el.innerHTML = renderOne_${suffix}(src[0], ${JSON.stringify(fieldName)});`);
          }
        }
        lines.push(`      };`);
        // Initial render + reactive subscription. Subscribe to the SOURCE
        // errors cell (which is itself a derived cell from C7/C8). When the
        // upstream changes, _scrml_reactive_set re-fires subscribers; we
        // pull the latest derived value and re-render.
        lines.push(`      render_${suffix}();`);
        lines.push(`      _scrml_reactive_subscribe(${JSON.stringify(encodedSourceKey)}, function() { render_${suffix}(); });`);
        lines.push(`    }`);
        lines.push(`  }`);
        continue;
      }

      // -----------------------------------------------------------------
      // Phase 2b: if= mount/unmount (clean-subtree path)
      //
      // The HTML emitter produced a <template id="TID"> wrapping the
      // would-be element + a <!--scrml-if-marker:MID--> placeholder
      // comment. The controller below watches the condition and calls
      // _scrml_mount_template / _scrml_unmount_scope on each transition.
      // -----------------------------------------------------------------
      if (binding.isMountToggle && binding.templateId && binding.markerId) {
        const tid = binding.templateId;
        const mid = binding.markerId;
        const suffix = (placeholderId || mid).replace(/[^a-zA-Z0-9_]/g, "_");

        // Build the condition expression (same shape as the display-toggle path).
        let conditionCode: string | undefined;
        if (binding.condExpr) {
          const compiled = emitExprField(binding.condExprNode, binding.condExpr, { mode: "client" });
          conditionCode = `(${compiled})`;
        } else if (binding.varName) {
          const condVarName = binding.varName;
          const encodedCondVar = encodingCtx && encodingCtx.enabled ? encodingCtx.encode(condVarName) : condVarName;
          if (binding.dotPath) {
            conditionCode = `(_scrml_reactive_get(${JSON.stringify(encodedCondVar)}).${binding.dotPath.slice(condVarName.length + 1)})`;
          } else {
            conditionCode = `_scrml_reactive_get(${JSON.stringify(encodedCondVar)})`;
          }
        }

        if (conditionCode) {
          lines.push(`  {`);
          lines.push(`    // if= mount/unmount controller — marker ${mid}, template ${tid}`);
          lines.push(`    let _scrml_mr_${suffix} = null;`);
          lines.push(`    let _scrml_ms_${suffix} = null;`);
          lines.push(`    function _scrml_if_mount_${suffix}() {`);
          lines.push(`      _scrml_ms_${suffix} = _scrml_create_scope();`);
          lines.push(`      _scrml_mr_${suffix} = _scrml_mount_template(${JSON.stringify(mid)}, ${JSON.stringify(tid)});`);
          lines.push(`    }`);
          lines.push(`    function _scrml_if_unmount_${suffix}() {`);
          lines.push(`      if (_scrml_mr_${suffix} !== null) {`);
          lines.push(`        _scrml_unmount_scope(_scrml_mr_${suffix}, _scrml_ms_${suffix});`);
          lines.push(`        _scrml_mr_${suffix} = null;`);
          lines.push(`        _scrml_ms_${suffix} = null;`);
          lines.push(`      }`);
          lines.push(`    }`);
          // Initial mount on first render if condition is true.
          lines.push(`    if (${conditionCode}) _scrml_if_mount_${suffix}();`);
          // Reactive update — _scrml_effect subscribes to all reactives in the body.
          lines.push(`    _scrml_effect(function() {`);
          lines.push(`      if (${conditionCode}) {`);
          lines.push(`        if (_scrml_mr_${suffix} === null) _scrml_if_mount_${suffix}();`);
          lines.push(`      } else {`);
          lines.push(`        if (_scrml_mr_${suffix} !== null) _scrml_if_unmount_${suffix}();`);
          lines.push(`      }`);
          lines.push(`    });`);
          lines.push(`  }`);
        }
        continue;
      }

      // Conditional display (if=) — toggle element visibility
      // Visibility toggle (show=) — same display-toggle codegen, different selector
      // With optional transition:fade/slide/fly, in:fade, out:slide directives
      // Phase 1 (2026-04-29): both flags route to display-toggle. Phase 2 will
      // split isConditionalDisplay (if=) off to mount/unmount codegen.
      if (binding.isConditionalDisplay || binding.isVisibilityToggle) {
        const hasTransition = binding.transitionEnter || binding.transitionExit;
        const dataAttr = binding.isVisibilityToggle ? "data-scrml-bind-show" : "data-scrml-bind-if";

        lines.push(`  {`);
        lines.push(`    const el = document.querySelector('[${dataAttr}="${placeholderId}"]');`);
        lines.push(`    if (el) {`);

        // Build the condition expression string used for evaluation
        let conditionCode: string | undefined;
        let subscribeVars: string[] | undefined; // array of var names

        // FIX(IS-VARIANT-ATTR): The previous condition required `refs.length > 0` to
        // activate the condExpr path. This caused `is .Variant` expressions (which have
        // no @-prefixed reactive refs) to silently fall through, producing no output.
        // condExpr is valid even when refs is empty — emit the condition unconditionally.
        if (binding.condExpr) {
          const compiled = emitExprField(binding.condExprNode, binding.condExpr, { mode: "client" });
          conditionCode = `(${compiled})`;
          subscribeVars = binding.refs ?? [];
        } else if (binding.varName) {
          const condVarName = binding.varName;
          const encodedCondVar = encodingCtx && encodingCtx.enabled ? encodingCtx.encode(condVarName) : condVarName;
          if (binding.dotPath) {
            conditionCode = `(_scrml_reactive_get(${JSON.stringify(encodedCondVar)}).${binding.dotPath.slice(condVarName.length + 1)})`;
          } else {
            conditionCode = `_scrml_reactive_get(${JSON.stringify(encodedCondVar)})`;
          }
          subscribeVars = [encodedCondVar];
        }

        if (conditionCode && subscribeVars !== undefined) {
          if (!hasTransition) {
            // No transition — simple display toggle (original behavior)
            lines.push(`      el.style.display = ${conditionCode} ? "" : "none";`);
            lines.push(`      _scrml_effect(function() { el.style.display = ${conditionCode} ? "" : "none"; });`);
          } else {
            // Transition-aware display toggle
            const enterClass = binding.transitionEnter ? `"scrml-enter-${binding.transitionEnter}"` : null;
            const exitClass = binding.transitionExit ? `"scrml-exit-${binding.transitionExit}"` : null;

            // Initial state — no animation on first render
            lines.push(`      el.style.display = ${conditionCode} ? "" : "none";`);

            // Build the transition toggle function
            lines.push(`      function _scrml_transition_${placeholderId.replace(/[^a-zA-Z0-9_]/g, "_")}() {`);
            lines.push(`        const _scrml_show = ${conditionCode};`);
            lines.push(`        if (_scrml_show) {`);
            if (enterClass) {
              lines.push(`          el.style.display = "";`);
              lines.push(`          el.classList.add(${enterClass});`);
              lines.push(`          el.addEventListener("animationend", function _scrml_ae() { el.classList.remove(${enterClass}); el.removeEventListener("animationend", _scrml_ae); }, { once: true });`);
            } else {
              lines.push(`          el.style.display = "";`);
            }
            lines.push(`        } else {`);
            if (exitClass) {
              lines.push(`          el.classList.add(${exitClass});`);
              lines.push(`          el.addEventListener("animationend", function _scrml_ae() { el.classList.remove(${exitClass}); el.style.display = "none"; el.removeEventListener("animationend", _scrml_ae); }, { once: true });`);
            } else {
              lines.push(`          el.style.display = "none";`);
            }
            lines.push(`        }`);
            lines.push(`      }`);

            lines.push(`      _scrml_effect(_scrml_transition_${placeholderId.replace(/[^a-zA-Z0-9_]/g, "_")});`);
          }
        }

        lines.push(`    }`);
        lines.push(`  }`);
        continue;
      }

      // Extract all @var references from the expression.
      //
      // Phase 4: prefer reactiveRefs (pre-annotated by emit-html.js using the
      // string-literal-aware extractReactiveDeps). Fall back to inline regex scan
      // for backward compatibility with bindings created without annotation.
      let varRefs: string[];
      if (binding.reactiveRefs !== undefined && binding.reactiveRefs !== null) {
        // Use pre-annotated deps — string-literal-aware, filtered to known reactive vars
        varRefs = Array.from(binding.reactiveRefs);
      } else {
        // Fallback: regex scan of the raw expression string
        // This path handles bindings created without reactiveRefs annotation.
        varRefs = [];
        const varRefRegex = /@([A-Za-z_$][A-Za-z0-9_$]*)/g;
        let match;
        while ((match = varRefRegex.exec(expr)) !== null) {
          varRefs.push(match[1]);
        }
      }

      // GITI-005: `${serverFn()}` in markup needs async wiring — the call
      // returns a Promise; without await, textContent becomes "[object
      // Promise]" and the reactive-refs path below never fires (expression
      // has no @-refs). Emit an IIFE that awaits the rewritten expression
      // and assigns the resolved value. This is a one-shot render (no
      // reactivity on the fetch result); a future arc will add fine-grained
      // reactivity for server-fn returns.
      if (varRefs.length === 0 && exprUsesServerFn(expr, serverFnNames)) {
        const rewrittenExpr = emitExprField(binding.exprNode, expr, { mode: "client", derivedNames: ctx.derivedNames });

        lines.push(`  {`);
        lines.push(`    const el = document.querySelector('[data-scrml-logic="${placeholderId}"]');`);
        lines.push(`    if (el) {`);
        lines.push(`      (async () => { try { el.textContent = await (${rewrittenExpr}); } catch (_e) { el.textContent = ""; } })();`);
        lines.push(`    }`);
        lines.push(`  }`);
        continue;
      }

      if (varRefs.length > 0) {
        let rewrittenExpr = emitExprField(binding.exprNode, expr, { mode: "client", derivedNames: ctx.derivedNames });

        // When encoding is active, replace _scrml_reactive_get("name") with encoded names
        if (encodingCtx && encodingCtx.enabled) {
          for (const ref of varRefs) {
            const encoded = encodingCtx.encode(ref);
            if (encoded !== ref) {
              rewrittenExpr = rewrittenExpr.split(`_scrml_reactive_get("${ref}")`).join(`_scrml_reactive_get(${JSON.stringify(encoded)})`);
            }
          }
        }

        // If the reactive expression ALSO contains a server fn, wrap in async
        // so the Promise is awaited (mixed case: @var + serverFn()). The effect
        // re-runs on @var change; each re-run re-fires the server call.
        const needsAsync = exprUsesServerFn(expr, serverFnNames);

        lines.push(`  {`);
        lines.push(`    const el = document.querySelector('[data-scrml-logic="${placeholderId}"]');`);
        lines.push(`    if (el) {`);
        if (needsAsync) {
          lines.push(`      (async () => { try { el.textContent = await (${rewrittenExpr}); } catch (_e) { el.textContent = ""; } })();`);
          lines.push(`      _scrml_effect(function() { (async () => { try { el.textContent = await (${rewrittenExpr}); } catch (_e) { el.textContent = ""; } })(); });`);
        } else {
          lines.push(`      el.textContent = ${rewrittenExpr};`);
          lines.push(`      _scrml_effect(function() { el.textContent = ${rewrittenExpr}; });`);
        }
        lines.push(`    }`);
        lines.push(`  }`);
      }
    }
  }

  // --- §17.1.1: if-chain wiring (Phase 2g per-branch mount/unmount + display dispatch) ---
  //
  // For each chain, the controller emits:
  //   - Per-branch state variables (mount-mode: root + scope handles; display-mode:
  //     wrapper element reference resolved via querySelector).
  //   - A function `_update_chain_<id>()` that picks the active branchId by
  //     evaluating positive branch conditions in source order, falls back to else
  //     if present, then dispatches mount/unmount or display-toggle per branch
  //     based on the compile-time `branchMode` field. Idempotent: if active
  //     hasn't changed, returns early.
  //   - Initial render call + _scrml_effect subscription for reactive updates.
  //
  // Reuses Phase 2c B1 helpers (_scrml_create_scope, _scrml_mount_template,
  // _scrml_unmount_scope) verbatim. No new runtime helpers.
  if (logicBindings && logicBindings.length > 0) {
    // Group chain branches by chainId.
    const chains = new Map<string, LogicBinding[]>();
    for (const binding of logicBindings) {
      if (binding.kind === "if-chain-branch" || binding.kind === "if-chain-else") {
        const chainId = binding.chainId!;
        if (!chains.has(chainId)) chains.set(chainId, []);
        chains.get(chainId)!.push(binding);
      }
    }

    for (const [chainId, chainBindings] of chains) {
      const chainSlug = chainId.replace(/[^a-zA-Z0-9_]/g, "_");
      const condBranches = chainBindings.filter((b) => b.kind === "if-chain-branch");
      const elseBranch = chainBindings.find((b) => b.kind === "if-chain-else");
      const allBranches: LogicBinding[] = [...condBranches];
      if (elseBranch) allBranches.push(elseBranch);

      lines.push("");
      lines.push(`  // if-chain: ${chainId}`);
      lines.push(`  {`);
      lines.push(`    let _scrml_chain_${chainSlug}_active = null;`);

      // Per-branch state declarations.
      for (const branch of allBranches) {
        const branchSlug = (branch.branchId ?? "").replace(/[^a-zA-Z0-9_]/g, "_");
        if (branch.branchMode === "mount") {
          lines.push(`    let _scrml_chain_${branchSlug}_root = null;`);
          lines.push(`    let _scrml_chain_${branchSlug}_scope = null;`);
        } else {
          // display-mode: resolve wrapper at startup. The wrapper is the
          // emit-html-emitted `<div data-scrml-chain-branch="<branchId>">`
          // (Step 1 dirty-branch path).
          lines.push(`    const _scrml_chain_${branchSlug}_wrapper = document.querySelector('[data-scrml-chain-branch="${branch.branchId}"]');`);
        }
      }

      lines.push(`    function _update_chain_${chainSlug}() {`);
      lines.push(`      let _next = null;`);

      // Condition cascade — same as pre-Phase-2g shape.
      for (const branch of condBranches) {
        let condCode: string;
        if (branch.condition?.raw) {
          condCode = rewriteReactiveRefs(branch.condition.raw);
        } else if (branch.condition?.name) {
          const varName = branch.condition.name.replace(/^@/, "");
          condCode = `_scrml_reactive_get(${JSON.stringify(varName)})`;
        } else {
          condCode = "true";
        }
        lines.push(`      if (_next === null && (${condCode})) _next = "${branch.branchId}";`);
      }
      if (elseBranch) {
        lines.push(`      if (_next === null) _next = "${elseBranch.branchId}";`);
      }

      // Idempotency guard.
      lines.push(`      if (_next === _scrml_chain_${chainSlug}_active) return;`);

      // Deactivate previous active branch (if any).
      lines.push(`      if (_scrml_chain_${chainSlug}_active !== null) {`);
      lines.push(`        switch (_scrml_chain_${chainSlug}_active) {`);
      for (const branch of allBranches) {
        const branchSlug = (branch.branchId ?? "").replace(/[^a-zA-Z0-9_]/g, "_");
        lines.push(`          case ${JSON.stringify(branch.branchId)}:`);
        if (branch.branchMode === "mount") {
          lines.push(`            if (_scrml_chain_${branchSlug}_root !== null) {`);
          lines.push(`              _scrml_unmount_scope(_scrml_chain_${branchSlug}_root, _scrml_chain_${branchSlug}_scope);`);
          lines.push(`              _scrml_chain_${branchSlug}_root = null;`);
          lines.push(`              _scrml_chain_${branchSlug}_scope = null;`);
          lines.push(`            }`);
        } else {
          lines.push(`            if (_scrml_chain_${branchSlug}_wrapper) _scrml_chain_${branchSlug}_wrapper.style.display = "none";`);
        }
        lines.push(`            break;`);
      }
      lines.push(`        }`);
      lines.push(`      }`);

      // Activate next branch.
      lines.push(`      switch (_next) {`);
      for (const branch of allBranches) {
        const branchSlug = (branch.branchId ?? "").replace(/[^a-zA-Z0-9_]/g, "_");
        lines.push(`        case ${JSON.stringify(branch.branchId)}:`);
        if (branch.branchMode === "mount") {
          lines.push(`          _scrml_chain_${branchSlug}_scope = _scrml_create_scope();`);
          lines.push(`          _scrml_chain_${branchSlug}_root = _scrml_mount_template(${JSON.stringify(branch.markerId)}, ${JSON.stringify(branch.templateId)});`);
        } else {
          lines.push(`          if (_scrml_chain_${branchSlug}_wrapper) _scrml_chain_${branchSlug}_wrapper.style.display = "";`);
        }
        lines.push(`          break;`);
      }
      lines.push(`      }`);

      lines.push(`      _scrml_chain_${chainSlug}_active = _next;`);
      lines.push(`    }`);

      // Initial render + reactive effect.
      lines.push(`    _update_chain_${chainSlug}();`);
      lines.push(`    _scrml_effect(_update_chain_${chainSlug});`);
      lines.push(`  }`);
    }
  }

  lines.push("});");

  return lines;
}
