import { rewriteReactiveRefs, rewriteExprArrowBody, rewriteServerExprArrowBody } from "./rewrite.js";
import { rewriteBlockBody, emitMatchExpr, emitIfValueExpr, type EngineRewriteCtx } from "./emit-control-flow.ts";
import { emitExprField } from "./emit-expr.ts";
import { parseExprToNode } from "../expression-parser.ts";
import {
  maybeLowerCancelTimerCallRef,
  buildEngineBindingsMap,
  collectEngineVarNames,
  collectEnginesWithHooks,
  collectEnginesWithOnTimeout,
  collectEnginesWithIdleWatchdog,
  collectEnginesWithInternalRules,
  collectEnginesWithHistory,
  collectEnginesWithMessageArms,
  collectEngineMessageVariants,
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
  /**
   * Bug 58 (S140) — formFor synthesized submit binding. When set (to the
   * compound cell name, e.g. `"signup"`), the emitted submit handler sets
   * `@<cell>.submitted = true` before invoking the handler and passes the
   * collected `values` (the compound cell value) into it, per §41.14.3.
   */
  formForSubmitCell?: string;
  /**
   * §5.2.2 row 5 (bare-ref form) — `onclick=handler` (no parens, no `${...}`).
   * Wire the resolved handler reference DIRECTLY as the listener (no
   * `function(event){ fn(); }` wrapper). `handlerName` is the SOURCE name.
   */
  bareRefHandler?: boolean;
}

/** A logic binding recorded by HTML gen and consumed by client JS gen. */
interface LogicBinding {
  placeholderId?: string;
  expr?: string;
  reactiveRefs?: Set<string> | null;
  /**
   * §6.7.7 — set by emit-html.ts when the binding expr reads a `<#id>` ref whose
   * id names a `<request>` (its state is the reactive `_scrml_request_<id>`
   * deep-reactive Proxy). The binding carries no `@var` dep, so this flag forces
   * the `_scrml_effect`-wrapped reactive path (the Proxy auto-tracks the read).
   */
  hasRequestRef?: boolean;
  isConditionalDisplay?: boolean;
  isVisibilityToggle?: boolean;
  /** S105 B1 — reactive HTML Boolean attr (disabled/readonly/required). */
  isReactiveBoolAttr?: boolean;
  boolAttrName?: string;
  /** i81 — reactive HTML VALUE attr (class, style, title, data-… ). See binding-registry.ts. */
  isReactiveValueAttr?: boolean;
  valueAttrName?: string;
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
  kind?: "if-chain-branch" | "if-chain-else" | "errors-element" | "render-element";
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
   * render-expr-primitive — `<render of=X/>` element fields.
   * Required when `kind === "render-element"`. See binding-registry.ts.
   * Top-level `<render of=@cell/>` is wired here; arm-payload `<render of=err/>`
   * is wired per-arm by emit-variant-guard.ts (held value in arm-fn scope).
   */
  renderHeldAccessor?: string;
  renderHeldSubscribe?: string;
  renderVariantExprs?: Record<string, string>;

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

  /**
   * ss20 item-1 (g-if-guard-inner-effect-not-gated) — stamped by emit-html.ts
   * when this interpolation binding sits inside an `if=` DISPLAY-TOGGLE subtree
   * (NOT the clean-subtree mount/unmount path; NOT `show=`). Carries the
   * enclosing if='s guard fields (same shape the toggle binding stores). The
   * inner effect is gated on this predicate — lowered via the shared
   * computeDisplayToggleCondition helper, in lockstep with the toggle — so the
   * effect body short-circuits while the guard is false, preventing a
   * `null.field` crash on mount when the guarded cell starts absent.
   */
  ifGuard?: {
    condExpr?: string;
    condExprNode?: ExprNode;
    refs?: string[];
    varName?: string;
    dotPath?: string;
    /**
     * ss21 item-3 (g-if-chain-branch-display-null-interp) — set instead of the
     * single-`if=` fields when this interpolation sits inside an if-CHAIN branch
     * (if=/else-if=/else, a separate node kind whose if= attr is stripped before
     * the generic walk, so the ss20 single-`if=` push never fires). `own` is the
     * branch's own condition (undefined for the else); `priors` is every PRIOR
     * positive branch condition in source order. emit-event-wiring lowers them
     * via the SAME computeChainBranchCondition helper the chain controller uses,
     * so the gate is byte-identical to the branch's `_next === branchId`
     * visibility (priors-false AND own-true; else = all-priors-false) — lockstep
     * with the per-branch display toggle.
     */
    chainGuard?: { own?: any; priors?: any[] };
  };
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
    // render-expr-primitive — an arm-tagged `<render of=X/>` binding is
    // re-emitted PER-ARM by emit-variant-guard.ts:emitArmWireFunction, where
    // the held value X (the arm payload binding) is in scope. Skip it from
    // global emission (the held ident is undefined at module scope). A
    // top-level `<render of=@cell/>` has no `engineArm` and is handled by the
    // global path below.
    if (b.kind === "render-element") return false;
    // g-match-arm-reactive-attr-effects (S212) — an arm-tagged class:/attr-tpl
    // directive binding is re-emitted PER-ARM by emit-variant-guard.ts against
    // the arm `_root` (the directive's element is created fresh on each variant
    // innerHTML replace, so a module-init `document.querySelector` would cache a
    // detached/absent node). These bindings are registered by emit-html.ts ONLY
    // when in an arm context, so skipping them from global emission is correct.
    if (b.kind === "class-directive" || b.kind === "attr-template") return false;
    // Default reactive-text binding (kind === undefined) AND not a
    // conditional-display / mount-toggle / visibility variant → handled
    // per-arm. All other kinds remain in global emission (v1 limitation
    // for those out-of-scope surfaces).
    if (b.kind != null) return true;
    if (b.isConditionalDisplay) return true;
    if (b.isVisibilityToggle) return true;
    if (b.isReactiveBoolAttr) return true;
    if (b.isReactiveValueAttr) return true;
    if (b.isMountToggle) return true;
    return false;
  });

  const encodingCtx = ctx.encodingCtx;

  // ss20 item-1 — lower an `if=` DISPLAY-TOGGLE predicate to its JS condition
  // string. Shared by the display-toggle emission AND the inner-effect gating
  // (binding.ifGuard) so the toggle and the effects it guards stay in lockstep
  // (identical encoding + lowering — do not re-lower independently). Accepts the
  // toggle binding OR a stamped ifGuard sub-object (same field shape). Returns
  // null when neither a condExpr nor a varName is present.
  function computeDisplayToggleCondition(
    b: { condExpr?: string; condExprNode?: any; refs?: string[]; varName?: string; dotPath?: string },
  ): { conditionCode: string; subscribeVars: string[] } | null {
    if (b.condExpr) {
      // Bug 61 — thread synthCellKeys + derivedNames so `if=@form.isValid`
      // conditional-display reads route to the dotted synth cell.
      const compiled = emitExprField(b.condExprNode, b.condExpr, { mode: "client", derivedNames: ctx.derivedNames, synthCellKeys: ctx.synthCellKeys });
      return { conditionCode: `(${compiled})`, subscribeVars: b.refs ?? [] };
    } else if (b.varName) {
      const condVarName = b.varName;
      const encodedCondVar = encodingCtx && encodingCtx.enabled ? encodingCtx.encode(condVarName) : condVarName;
      let conditionCode: string;
      if (b.dotPath) {
        conditionCode = `(_scrml_reactive_get(${JSON.stringify(encodedCondVar)}).${b.dotPath.slice(condVarName.length + 1)})`;
      } else {
        conditionCode = `_scrml_reactive_get(${JSON.stringify(encodedCondVar)})`;
      }
      return { conditionCode, subscribeVars: [encodedCondVar] };
    }
    return null;
  }

  // ss21 item-3 (g-if-chain-branch-display-null-interp) — lower a SINGLE
  // if-chain branch condition to its JS condCode string. Extracted verbatim
  // from the §17.1.1 chain cascade below so the cascade's `_next` selection AND
  // the inner-effect visibility gate (binding.ifGuard.chainGuard) share ONE
  // lowering — byte-identical, lockstep with the per-branch display toggle. The
  // `.Variant`/`==`-aware emitExprField path matches the cascade exactly;
  // call-ref (`if=isHigh()`) is CALLED not read as a cell (g-attr-if-fn-chain-
  // head-call-misroute, S191). Returns null for the else (no condition) or an
  // unshaped condition — the caller substitutes "true" (cascade fall-through).
  function computeChainBranchCondition(condition: any): string | null {
    if (!condition) return null;
    if (condition.kind === "call-ref") {
      const condRaw = `${condition.name}(${(condition.args ?? []).join(", ")})`;
      let condNode: ExprNode | null = null;
      try {
        condNode = parseExprToNode(condRaw, "<if-chain-call-ref>", 0) as ExprNode | null;
      } catch {
        condNode = null;
      }
      return emitExprField(condNode, condRaw, {
        mode: "client",
        derivedNames: ctx.derivedNames,
        synthCellKeys: ctx.synthCellKeys,
      });
    } else if (condition.raw) {
      let condNode = (condition.exprNode ?? null) as ExprNode | null;
      if (!condNode) {
        try {
          condNode = parseExprToNode(condition.raw, "<if-chain-branch>", 0) as ExprNode | null;
        } catch {
          condNode = null;
        }
      }
      return emitExprField(condNode, condition.raw, {
        mode: "client",
        derivedNames: ctx.derivedNames,
        synthCellKeys: ctx.synthCellKeys,
      });
    } else if (condition.name) {
      const varName = condition.name.replace(/^@/, "");
      return `_scrml_reactive_get(${JSON.stringify(varName)})`;
    }
    return null;
  }

  // ss21 item-3 — lower an if-chain branch's VISIBILITY predicate (the gate for
  // its descendant `${...}` interpolation effects). A branch is visible iff all
  // PRIOR positive conditions are false AND (its own condition is true, or it is
  // the else). Byte-identical to the chain controller's `_next === branchId`
  // selection (same condCodes via computeChainBranchCondition). Returns null
  // when there is nothing to gate on (no priors + no own condition).
  function computeChainGuardCondition(cg: { own?: any; priors?: any[] }): string | null {
    const parts: string[] = (cg.priors ?? []).map(
      (c: any) => `!(${computeChainBranchCondition(c) ?? "true"})`,
    );
    if (cg.own !== undefined && cg.own !== null) {
      parts.push(`(${computeChainBranchCondition(cg.own) ?? "true"})`);
    }
    return parts.length > 0 ? parts.join(" && ") : null;
  }

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
  // §51.0.S (S155 batch 3) — message-plane routing inputs for `.advance`
  // calls inside event-handler bodies (the worked-example dispatch site:
  // `ondrop=@dragPhase.advance(.Drop(col))`).
  const enginesWithMessageArms = collectEnginesWithMessageArms(ctx.fileAST);
  const engineMessageVariants = collectEngineMessageVariants(ctx.fileAST);
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
            // §51.0.S (S155 batch 3) — message-plane routing inputs.
            enginesWithMessageArms: enginesWithMessageArms.size > 0 ? enginesWithMessageArms : null,
            engineMessageVariants: engineMessageVariants.size > 0 ? engineMessageVariants : null,
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
  //
  // §59 (D4) — `mapVarNames` is threaded UNCONDITIONALLY (not gated on the
  // engine presence that gates `engineRewriteCtx`): an event handler like
  // `onclick=@m.insert(k, v)` in a map-only file (no `<engine>`) still needs
  // the map interception. Merged into the extras spread so direct
  // `emitExprField(..., { ...engineExprCtxExtras })` calls below see it.
  const { collectMapVarNames, collectOrderedMapVarNames, collectRequestIds, collectSetVarNames } = require("./reactive-deps.ts");
  const mapVarNames: Set<string> = collectMapVarNames(ctx.fileAST);
  // §59.12 (D4) — value-native SET cell names (strict subset of mapVarNames), so
  // an event handler like `onclick=@s.add(k)` / `onclick=@s = @s.union(@t)`
  // lowers the set-native vocabulary. Threaded UNCONDITIONALLY, like mapVarNames.
  const setVarNames: Set<string> = collectSetVarNames(ctx.fileAST);
  // §6.7.7 / §60.4 — `<request>` id set so a `${<#id>.data}` / `if=<#id>.loading`
  // binding lowers its `<#id>` ref to the reactive `_scrml_request_<id>` object.
  const requestIds: Set<string> = collectRequestIds(ctx.fileAST);
  // §59.8 (S169) — the `@ordered`-typed subset, so a reassignment `@m = [...]`
  // inside an event handler (`onclick=rebuild()`) lowers the literal ordered.
  const orderedMapVarNames: Set<string> = collectOrderedMapVarNames(ctx.fileAST);
  const engineExprCtxExtras = {
    ...(engineRewriteCtx?.exprCtxExtras ?? {}),
    ...(mapVarNames.size > 0 ? { mapVarNames } : {}),
    ...(setVarNames.size > 0 ? { setVarNames } : {}),
    ...(orderedMapVarNames.size > 0 ? { orderedMapVarNames } : {}),
    ...(requestIds.size > 0 ? { requestIds } : {}),
  };

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
        //
        // S138 Bug 50 — emit-table-for's synth onchange uses `(evt) => { ... }`
        // (and other synth paths may too). When `binding.handlerExprNode` is
        // present, `emitExpr → emitLambda` handles it correctly. When it is
        // NOT present (synth attribute path that builds raw expr strings
        // without parsing through ast-builder), `emitExprField` falls through
        // to `rewriteExprWithDerived` which fires Pass 1 `rewritePresenceGuard`.
        // That pass treats `( ident ) => { body }` as a `given x => body`
        // presence-guard and rewrites it to `if (x !== null && x !== undefined)
        // { body }` — an if-STATEMENT that can't sit in object-literal property
        // position (`_scrml_change_handlers[id] = if (...) {...}` → SyntaxError).
        //
        // Mirror emit-expr.ts:emitEscapeHatch (Bug C 6nz 2026-04-20) which
        // documents this exact gotcha and uses `rewriteExprArrowBody` (which
        // skips Pass 1) for ArrowFunctionExpression escape-hatches. Apply the
        // same fix here for the fallback string path. Structured-node path
        // (when handlerExprNode is set) keeps emitExprField → emitLambda.
        if (binding.handlerExprNode) {
          handlerExpr = emitExprField(binding.handlerExprNode, binding.handlerExpr, {
            mode: "client",
            ...engineExprCtxExtras,
          });
        } else {
          handlerExpr = rewriteExprArrowBody(binding.handlerExpr, undefined);
        }
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
        const exprNode = binding.handlerExprNode as { kind?: string; target?: { kind?: string; name?: string } } | undefined;
        // S177 s169-map-inline-insert — an INLINE map-method assign
        // (`onclick=${@m = @m.insert(k, v)}` where `m` is a value-native map) MUST
        // route through emitExprField, NOT the string `rewriteBlockBody` path. The
        // string path re-emits the assign RHS VERBATIM (rewrite.ts
        // rewriteReactiveAssign), so `@m.insert(...)` becomes a bare
        // `_scrml_reactive_get("m").insert(...)` — but the runtime map is a plain
        // `{ entries, ordered, order }` with NO `.insert` method (insert is the
        // free fn `_scrml_map_insert(m, k, v)`), a TypeError at click. emitAssign
        // (emit-expr.ts) lowers the RHS through emitExpr with ctx.mapVarNames so
        // `@m.insert(...)` -> `_scrml_map_insert(_scrml_reactive_get("m"), ...)` —
        // byte-identical to the named-fn handler path. The NON-map `assign`
        // exclusion stays (engine `@phase = .X` writes keep the rewriteBlockBody
        // engine-assign-regex arm); only a map-var assign is re-routed.
        const isMapVarAssign =
          !!exprNode &&
          exprNode.kind === "assign" &&
          !!exprNode.target &&
          exprNode.target.kind === "ident" &&
          typeof exprNode.target.name === "string" &&
          exprNode.target.name.startsWith("@") &&
          mapVarNames.has(exprNode.target.name.slice(1));
        if (exprNode && ((exprNode.kind !== "assign" && exprNode.kind !== "lambda" && exprNode.kind !== "unary") || isMapVarAssign)) {
          // Single structured expression — use emitExprField so engine
          // `.advance(.X)` (and any other structured-only detection in
          // emit-expr.ts) routes correctly. Map-var assigns also take this path
          // (s169-map-inline-insert) so emitAssign's map-method RHS lowering fires.
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

      // §5.2.2 row 5 (bare-ref form) — `onclick=handler` (no parens, no
      // `${...}`). SPEC: "wire `handler` directly as the event listener
      // without wrapping." Use the resolved (`_scrml_<name>_N`) reference
      // DIRECTLY as the handler value — NO `function(event){ fn(); }` wrapper
      // (that is the call-ref `fn()` form below). The wired listener receives
      // the DOM event as its argument. handlerArgs are always empty for this
      // form (a bare identifier has no parenthesized args).
      if (binding.bareRefHandler) {
        handlerExpr = resolvedHandler;
        if (!byEventType.has(eventName)) byEventType.set(eventName, []);
        byEventType.get(eventName)!.push({ placeholderId, handlerExpr });
        continue;
      }

      // Bug 58 (S140) — formFor synthesized submit handler (§41.14.3).
      //
      // When the onsubmit binding was synthesized by `<formFor>` (carries the
      // compound cell name in `binding.formForSubmitCell`), the emitted handler
      // SHALL:
      //   1. preventDefault (submit is a delegable form event);
      //   2. set `@<cell>.submitted = true` BEFORE invoking the handler — this
      //      drives the §55 validity surface's `submitted` flag (the "show
      //      errors after first submit attempt" UX gate);
      //   3. invoke the handler with the collected `values` — the compound cell
      //      value `_scrml_reactive_get("<cell>")` — so the server/client fn
      //      receives `values: StructType` per its declared signature.
      // `resolvedHandler` already routes server fns through their `_scrml_fetch_*`
      // wrapper (fnNameMap), which itself takes `(values)`. Emitted shape:
      //   function(event) { event.preventDefault();
      //     _scrml_reactive_set("signup.submitted", true);
      //     _scrml_fetch_persistSignup_14(_scrml_reactive_get("signup")); }
      if (binding.formForSubmitCell) {
        const ffCell = binding.formForSubmitCell;
        const encodedCell = encodingCtx && encodingCtx.enabled ? encodingCtx.encode(ffCell) : ffCell;
        const submittedKey = `${encodedCell}.submitted`;
        const valuesArg = `_scrml_reactive_get(${JSON.stringify(encodedCell)})`;
        handlerExpr =
          `function(event) { event.preventDefault(); ` +
          `_scrml_reactive_set(${JSON.stringify(submittedKey)}, true); ` +
          `${resolvedHandler}(${valuesArg}); }`;
        if (!byEventType.has(eventName)) byEventType.set(eventName, []);
        byEventType.get(eventName)!.push({ placeholderId, handlerExpr });
        continue;
      }

      // S97 — reactive-method-call shape detection.
      //
      // The ATTR_CALL tokenization at tokenizer.ts:399-417 reads the LHS ident
      // greedily including `.` characters — so `onclick=@outer.advance(.X)`
      // produces ATTR_CALL with `name = "@outer.advance"`, `args = [".X"]`.
      // Pre-fix the call-ref emitter spliced these verbatim into the wrapper
      // (`function(event){ @outer.advance(...); }`) — invalid JS (`@` not a
      // legal identifier char). Affected ALL `@<var>.method(args)` shapes,
      // including `.advance(.Variant.history)` on engine vars (broken even
      // though emit-expr.ts:emitCall has the C13 dispatch arm for it).
      //
      // Fix: when handlerName starts with `@`, synthesize a structured
      // CallExpr (callee = MemberExpr chain from the dotted name; args =
      // pre-parsed argExprNodes) and emit via emitExprField. The structured
      // path then routes through emit-expr.ts:emitCall — for engine .advance
      // shapes this hits the C13 dispatch (including history-restore peel-off
      // on `.X.history` args); for non-engine method calls it produces
      // `_scrml_reactive_get("var").method(args)` via emitMember + emitCall.
      //
      // Guard: only fires when handlerArgExprNodes is complete (length matches
      // handlerArgs). Otherwise falls through to the legacy bare-call splice
      // (which was broken for `@` shapes anyway — no regression introduced).
      const _argNodes = binding.handlerArgExprNodes;
      const _isReactiveMethodCall =
        handlerName.startsWith("@") &&
        Array.isArray(_argNodes) &&
        _argNodes.length === (handlerArgs?.length ?? 0);

      if (_isReactiveMethodCall) {
        const synthSpan = binding.handlerExprNode?.span ?? { file: "", start: 0, end: 0, line: 1, col: 1 };
        const parts = handlerName.split(".");
        let callee: ExprNode = { kind: "ident", span: synthSpan, name: parts[0] };
        for (let i = 1; i < parts.length; i++) {
          callee = { kind: "member", span: synthSpan, object: callee, property: parts[i], optional: false };
        }
        const synthCall: ExprNode = {
          kind: "call",
          span: synthSpan,
          callee,
          args: _argNodes as ExprNode[],
          optional: false,
        };
        const preventLine = domEvent === "submit" ? "event.preventDefault(); " : "";
        const body = emitExprField(synthCall, "", {
          mode: "client",
          ...engineExprCtxExtras,
        });
        handlerExpr = `function(event) { ${preventLine}${body}; }`;
      } else {

      // Serialize the arguments from the call-ref attribute value.
      // Args from the parser are raw expression strings (e.g. '"apple"', 'userId', '9.99').
      // Object args with .kind need special handling.
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
      } // close S97 reactive-method-call else branch
    }

    if (!byEventType.has(eventName)) {
      byEventType.set(eventName, []);
    }
    byEventType.get(eventName)!.push({ placeholderId, handlerExpr });
  }

  // Emit wiring — delegable events use document.addEventListener with ancestor
  // walk; non-delegable events use Approach A querySelectorAll + forEach.
  //
  // §20.8.2 step 3 (navigate-wave1b) — the non-delegable (element-scoped)
  // wiring is ALSO collected into a re-runnable `_scrml_nav_rewire(root)`
  // registered as a soft-nav rehydrator. Delegable click/submit listeners live
  // on `document` and survive an <outlet> subtree swap on their own; the
  // element-scoped listeners do NOT (the swapped-in nodes are fresh), so they
  // are re-attached scoped to the swapped region on each soft navigation
  // (WITHOUT re-booting the shell). The initial boot still runs the ORIGINAL
  // inline `document.querySelectorAll` below unchanged (zero behavior change);
  // the rehydrator only fires from _scrml_rehydrate_region on a swap.
  const nonDelegatedRewire: string[] = [];

  // §20.8.2 step 3 (navigate-wave1b, finding #1) — the reactive-DISPLAY wiring
  // (`${@cell}` / inline match/if render effects) is ALSO collected here, scoped
  // to `root`, so a soft nav RE-BINDS the display to the swapped-in nodes (else
  // the swap renders frozen — the effects still point at the detached old nodes).
  // Every display effect (boot AND rehydrate) is created via
  // `_scrml_region_track(el, _scrml_effect(...))` so, when the element is in the shell
  // outlet, its disposer is tracked for teardown before the next swap (finding
  // #2 — no leak / no double-update). Shell display effects (outside the outlet)
  // fail the closest() check and persist.
  const reactiveRewire: string[] = [];
  // Emit a reactive-display block. A REACTIVE block (`rebind`) is emitted ONCE,
  // into the `_scrml_nav_rewire(root)` rehydrator (`root`-scoped): it runs at
  // boot via `_scrml_nav_rewire(document)` AND re-runs scoped to the swapped
  // region on a soft nav (finding #1) — a single emission, so occurrence counts
  // are unchanged from the pre-Wave-1b inline form. A STATIC one-shot render (no
  // effect, `rebind=false`) is emitted inline at boot ONLY: a soft nav's
  // swapped-in SSR HTML already carries the server-rendered value. `body` are the
  // inner statements — they reference `el` and use `_scrml_region_track(el, …)`
  // for the effect (so a nav away disposes it, finding #2).
  // Generalized: emit a `{ const el = <scope>.querySelector('<selector>'); if (el)
  // { <body> } }` block into the rehydrator (rebind, root-scoped) or inline at
  // boot (rebind=false, document-scoped). Used for EVERY element-scoped reactive
  // construct (display, display/visibility toggle, boolean-attr toggle, errors /
  // render anchors) so a soft nav re-binds it (finding #1) and its region-tracked
  // effect tears down (finding #2).
  const pushRebindableSel = (selector: string, body: string[], rebind = true): void => {
    const wrap = (scope: string, sink: string[], ind: string): void => {
      sink.push(`${ind}{`);
      sink.push(`${ind}  const el = ${scope}.querySelector('${selector}');`);
      sink.push(`${ind}  if (el) {`);
      for (const b of body) sink.push(`${ind}    ${b}`);
      sink.push(`${ind}  }`);
      sink.push(`${ind}}`);
    };
    if (rebind) wrap("(root || document)", reactiveRewire, "    ");
    else wrap("document", lines, "  ");
  };
  const pushRebindableDisplay = (placeholderId: string, body: string[], rebind = true): void =>
    pushRebindableSel(`[data-scrml-logic="${placeholderId}"]`, body, rebind);
  // Emit a region-tracked reactive-display effect as TWO statements — the bare
  // `_scrml_effect(function() { <inner> });` (its exact shape preserved for the
  // codegen-shape tests) followed by `_scrml_region_track(el, <dispose>);` so a
  // soft nav away disposes it (finding #2). `inner` is the effect body.
  const regionEffectLines = (inner: string): string[] => [
    `const _scrml_disp = _scrml_effect(function() { ${inner} });`,
    `_scrml_region_track(el, _scrml_disp);`,
  ];

  for (const [eventName, entries] of byEventType) {
    const domEvent = eventName.replace(/^on/, ""); // onclick → click
    // gate-found-invalid-js-fix-wave (S141): the handler-registry / dispatch-map
    // VARIABLE NAME is built from domEvent, which for a non-canonical event attr
    // (`on:click` → domEvent ":click"; `else-if` → "...-...") would emit an
    // invalid JS identifier (`const _scrml_:click_handlers = ...` → the gate's
    // E-CODEGEN-INVALID-LOGIC). Sanitize the identifier segment to [A-Za-z0-9_$]
    // (the DOM event string passed to addEventListener + the data-attribute
    // selector below still use the raw event name, which is legal there).
    const idEvent = domEvent.replace(/[^A-Za-z0-9_$]/g, "_");

    if (DELEGABLE_EVENTS.has(domEvent)) {
      // -----------------------------------------------------------------------
      // Approach D path: handler registry + delegated document listener
      // -----------------------------------------------------------------------
      const registryVarName = `_scrml_${idEvent}`;

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
      const mapVarName = `_scrml_${idEvent}_handlers`;

      // Emit the handler dispatch map
      lines.push(`  const ${mapVarName} = {`);
      for (const { placeholderId, handlerExpr } of entries) {
        lines.push(`    ${JSON.stringify(placeholderId)}: ${handlerExpr},`);
      }
      lines.push(`  };`);

      // Wire all handlers for this event type into `_scrml_nav_rewire(root)`
      // (§20.8.2 step 3) — a SINGLE emission that runs at boot via
      // `_scrml_nav_rewire(document)` AND re-attaches scoped to the swapped
      // `root` on a soft nav (the swapped-in nodes are fresh; delegable
      // click/submit live on `document` and survive on their own).
      nonDelegatedRewire.push(`    (root || document).querySelectorAll('[data-scrml-bind-${eventName}]').forEach(function(el) {`);
      nonDelegatedRewire.push(`      const _scrml_id = el.getAttribute('data-scrml-bind-${eventName}');`);
      nonDelegatedRewire.push(`      if (${mapVarName}[_scrml_id]) el.addEventListener(${JSON.stringify(domEvent)}, ${mapVarName}[_scrml_id]);`);
      nonDelegatedRewire.push(`    });`);
    }
  }

  // (The `_scrml_nav_rewire` rehydrator — non-delegable handlers + reactive
  // display — is emitted at the END of the boot body, after Step 9 has collected
  // the reactive-display rebind lines into `reactiveRewire`.)

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
      // inline-value-form-interp (§18.0 / §17.6) — VALUE-FORM CONTROL-FLOW
      // as the SOLE content of a markup `${...}` interpolation.
      //
      // A `${ match @x { .A :> v … } }` / `${ if c { a } else { b } }` is a
      // value EXPRESSION (a match/if-as-expression): render its SELECTED value
      // into the slot and re-render on its scrutinee/condition deps. emit-html.ts
      // allocated the slot + registered this binding carrying the raw control-
      // flow node; we lower it to the value-returning form here (the match IIFE
      // via emitMatchExpr / the if-cascade ternary via emitIfValueExpr) — the
      // inline analogue of the `const <d> = match …; ${@d}` derived-cell twin
      // (which lowers identically through emitMatchExpr), but without the
      // intermediate named cell.
      // -----------------------------------------------------------------
      if (binding.kind === "value-control-flow" && binding.controlFlowNode && placeholderId) {
        const cfNode = binding.controlFlowNode;
        // Thread the same engine/map/set/derived/server-fn context the other
        // interpolation lowerings use, so an arm/branch result that reads those
        // surfaces lowers identically.
        const cfOpts = {
          ...engineExprCtxExtras,
          engineBindings,
          derivedNames: ctx.derivedNames,
          synthCellKeys: ctx.synthCellKeys,
          serverFnNames,
        };
        let valueExpr: string | null = null;
        if (cfNode.kind === "match-stmt") {
          valueExpr = emitMatchExpr(cfNode, cfOpts);
        } else if (cfNode.kind === "if-stmt") {
          valueExpr = emitIfValueExpr(cfNode, cfOpts);
        }
        if (valueExpr != null) {
          // Reactive deps: scan the LOWERED value for reactive-cell reads. Inside
          // `_scrml_effect` those reads auto-subscribe, so we only need to decide
          // WHETHER the value is reactive at all (size > 0 → wrap in an effect).
          const refSet = new Set<string>();
          const reGet = /_scrml_reactive_get\("([^"]+)"\)/g;
          let _gm: RegExpExecArray | null;
          while ((_gm = reGet.exec(valueExpr)) !== null) refSet.add(_gm[1]);
          // Name-encoding parity with the other interp paths.
          if (encodingCtx && encodingCtx.enabled) {
            for (const ref of refSet) {
              const enc = encodingCtx.encode(ref);
              if (enc !== ref) {
                valueExpr = valueExpr.split(`_scrml_reactive_get("${ref}")`).join(`_scrml_reactive_get(${JSON.stringify(enc)})`);
              }
            }
          }
          const cfRenderFn = `_scrml_cf_${placeholderId.replace(/[^a-zA-Z0-9_]/g, "_")}`;
          // Rebindable (finding #1): the block is emitted inline (boot) AND into
          // the soft-nav rehydrator (scoped to the swapped region).
          const cfBody: string[] = [];
          if (refSet.size > 0) {
            // Reactive: define the value computation once, render it now, and
            // re-render under a region-tracked effect (re-runs the reads → tracks).
            cfBody.push(`const ${cfRenderFn} = function() { return ${valueExpr}; };`);
            cfBody.push(`_scrml_render_value(el, ${cfRenderFn}());`);
            cfBody.push(...regionEffectLines(`_scrml_render_value(el, ${cfRenderFn}());`));
          } else {
            // Static scrutinee/condition: one-shot render.
            cfBody.push(`_scrml_render_value(el, ${valueExpr});`);
          }
          // Only the reactive variant needs a rehydrator rebind; the static
          // one-shot is server-rendered in a swapped region.
          pushRebindableDisplay(placeholderId, cfBody, refSet.size > 0);
        }
        continue;
      }

      // -----------------------------------------------------------------
      // 6nz-F4 — RCDATA `.value` content bind (SPEC §24.3.1 companion).
      //
      // A reactive `${}` content interpolation inside a `<textarea>` cannot use
      // the `<span data-scrml-logic>` placeholder (inside RCDATA it is literal
      // text, not a mountable element). emit-html.ts stamped a
      // `data-scrml-rcdata="<placeholderId>"` selector on the element and
      // registered this binding carrying the ordered content parts. We reuse the
      // one-way read-side of the bind:value machinery (`_scrml_effect(() =>
      // el.value = <expr>)`, cf. emit-bindings.ts:608) — the concatenation of the
      // static text runs (as string literals) and the reactive expression parts.
      // The initial call sets `.value` on load; the effect re-runs on any reactive
      // read → the textarea stays in sync (edges 1/3/6). Static-only / const-folded
      // content never reaches here (emit-html routes it to inline text).
      // -----------------------------------------------------------------
      if (binding.kind === "rcdata-content" && placeholderId && Array.isArray(binding.rcdataParts)) {
        // Build the concatenation. Leading `""` forces String coercion so a
        // single numeric/boolean reactive part still assigns a string to `.value`.
        const concatTerms: string[] = [`""`];
        for (const part of binding.rcdataParts) {
          if (part.kind === "static") {
            if (part.text) concatTerms.push(JSON.stringify(part.text));
          } else {
            let partExpr = emitExprField(part.exprNode, part.expr, {
              mode: "client",
              derivedNames: ctx.derivedNames,
              synthCellKeys: ctx.synthCellKeys,
              ...engineExprCtxExtras,
            });
            // Name-encoding parity with the other interp paths: rewrite the
            // reactive-cell keys inside the lowered expression to their encoded
            // form (scan the lowered `_scrml_reactive_get("name")` reads).
            if (encodingCtx && encodingCtx.enabled) {
              const refSet = new Set<string>();
              const reGet = /_scrml_reactive_get\("([^"]+)"\)/g;
              let _gm: RegExpExecArray | null;
              while ((_gm = reGet.exec(partExpr)) !== null) refSet.add(_gm[1]);
              for (const ref of refSet) {
                const enc = encodingCtx.encode(ref);
                if (enc !== ref) {
                  partExpr = partExpr.split(`_scrml_reactive_get("${ref}")`).join(`_scrml_reactive_get(${JSON.stringify(enc)})`);
                }
              }
            }
            concatTerms.push(`(${partExpr})`);
          }
        }
        const valueExpr = concatTerms.join(" + ");
        lines.push(`  {`);
        lines.push(`    const el = document.querySelector('[data-scrml-rcdata="${placeholderId}"]');`);
        lines.push(`    if (el) {`);
        lines.push(`      const _scrml_set_rcdata = function() { el.value = ${valueExpr}; };`);
        lines.push(`      _scrml_set_rcdata();`);
        lines.push(`      _scrml_effect(function() { _scrml_set_rcdata(); });`);
        lines.push(`    }`);
        lines.push(`  }`);
        continue;
      }

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
        // §55.10 Level-1 wiring — the QUALIFIED cell name for the inline-override
        // lookup. `_scrml_message_for(tag, field, cellName)` keys Level-1 by
        // `cellName + "::" + validatorName`; emit-messages.ts registers the SAME
        // qualified path via `_scrml_messages_register_inline`. Per-field:
        // `binding.errorsKey` IS the cell (`signup.name`). Compound rollup:
        // `binding.errorsKey` is the COMPOUND prefix (`signup`); the per-field
        // cell name is `errorsKey + "." + fieldKey`, computed per iteration below.
        const inlineCellName: string = binding.errorsKey;

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
          // Body-override path bypasses messageFor (the developer owns the
          // markup), so `cellName` is accepted for a uniform call shape but
          // unused here.
          lines.push(`      const bodyFn_${suffix} = ${bodyFn};`);
          lines.push(`      const renderOne_${suffix} = function(errTag, field, cellName) {`);
          lines.push(`        const out = bodyFn_${suffix}(errTag);`);
          lines.push(`        return (out == null) ? "" : String(out);`);
          lines.push(`      };`);
        } else {
          // Default render — thread `cellName` as the 3rd arg so `_scrml_message_for`
          // consults the Level-1 per-(cell,validator) inline override before
          // falling through to Level-2 (registered) / Level-3 (shipped default).
          lines.push(`      const renderOne_${suffix} = function(errTag, field, cellName) {`);
          lines.push(`        return '<p class="scrml-error">' + messageForFn_${suffix}(errTag, field, cellName) + '</p>';`);
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
          // Rollup cell name = compound prefix + "." + iterated field key
          // (e.g. "signup" + "." + "name" → "signup.name"), matching the
          // per-(cell,validator) inline-override registration key.
          if (allFlag) {
            lines.push(`          for (const tag of arr) parts.push(renderOne_${suffix}(tag, fieldKey, ${JSON.stringify(inlineCellName)} + "." + fieldKey));`);
          } else {
            lines.push(`          parts.push(renderOne_${suffix}(arr[0], fieldKey, ${JSON.stringify(inlineCellName)} + "." + fieldKey));`);
          }
          lines.push(`        }`);
          lines.push(`        el.innerHTML = parts.join("");`);
        } else {
          // Per-field: src is an array of tags. `inlineCellName` IS the cell.
          lines.push(`        if (!Array.isArray(src) || src.length === 0) { el.innerHTML = ""; return; }`);
          if (allFlag) {
            lines.push(`        const parts = [];`);
            lines.push(`        for (const tag of src) parts.push(renderOne_${suffix}(tag, ${JSON.stringify(fieldName)}, ${JSON.stringify(inlineCellName)}));`);
            lines.push(`        el.innerHTML = parts.join("");`);
          } else {
            lines.push(`        el.innerHTML = renderOne_${suffix}(src[0], ${JSON.stringify(fieldName)}, ${JSON.stringify(inlineCellName)});`);
          }
        }
        lines.push(`      };`);
        // ss21 item-5 fix — drive the render from `_scrml_effect`, NOT a
        // `_scrml_reactive_subscribe` on the SOURCE errors cell. That cell is a
        // DERIVED cell (`<field>.errors`) and is never the target of a DIRECT
        // `_scrml_reactive_set` — `_scrml_reactive_set` fans dirtied derived
        // cells out only via `_scrml_trigger` (effects), never the legacy
        // `_scrml_subscribers` list, so a subscribe on it never fired and the
        // anchor DOM stayed stale after the field went valid. `_scrml_effect`
        // auto-tracks the `_scrml_derived_get` read (the derived name is tracked
        // even when the cell is clean, per the runtime's Bug 1 fix-D), so the
        // render re-runs when `_scrml_propagate_dirty` + `_scrml_trigger` wake it
        // on recompute — matching the render-element / disabled-gate /
        // reactive-textContent paths. The effect's initial run IS the first render.
        lines.push(`      _scrml_effect(function() { render_${suffix}(); });`);
        lines.push(`    }`);
        lines.push(`  }`);
        continue;
      }

      // -----------------------------------------------------------------
      // render-expr-primitive — top-level `<render of=@cell/>` element wiring
      // (SPEC §19.x). The held value lives in a reactive cell (NOT an arm
      // payload binding — those are wired per-arm by emit-variant-guard.ts).
      // The render fires the held value's per-variant `renders` markup at the
      // anchor + re-fires when the cell changes. SIDESTEPS the `__scrml_error`
      // envelope gate — dispatches on the held value's OWN `.variant`/`.data`.
      // -----------------------------------------------------------------
      if (binding.kind === "render-element" && binding.anchorId && binding.renderHeldAccessor) {
        const anchorId = binding.anchorId as string;
        let acc = binding.renderHeldAccessor as string;
        const variantExprs = (binding.renderVariantExprs ?? {}) as Record<string, string>;
        const subscribeName = binding.renderHeldSubscribe;
        // Apply encoded cell names when encoding is active (the accessor +
        // every per-variant expr read `_scrml_reactive_get("<cell>")`).
        let encodedSubscribe = subscribeName;
        if (encodingCtx && encodingCtx.enabled && typeof subscribeName === "string") {
          const enc = encodingCtx.encode(subscribeName);
          if (enc !== subscribeName) {
            acc = acc.split(`_scrml_reactive_get("${subscribeName}")`).join(`_scrml_reactive_get(${JSON.stringify(enc)})`);
            for (const k of Object.keys(variantExprs)) {
              variantExprs[k] = variantExprs[k].split(`_scrml_reactive_get("${subscribeName}")`).join(`_scrml_reactive_get(${JSON.stringify(enc)})`);
            }
            encodedSubscribe = enc;
          }
        }
        const suffix = anchorId.replace(/[^a-zA-Z0-9_]/g, "_");
        lines.push(`  // <render of=@cell/> element wiring (render-expr-primitive)`);
        lines.push(`  {`);
        lines.push(`    const el = document.querySelector('[data-scrml-render-anchor=${JSON.stringify(anchorId)}]');`);
        lines.push(`    if (el) {`);
        lines.push(`      const render_${suffix} = function() {`);
        lines.push(`        const _hv = (${acc});`);
        lines.push(`        const _rt = (typeof _hv === "object" && _hv !== null && typeof _hv.variant === "string") ? _hv.variant : _hv;`);
        lines.push(`        switch (_rt) {`);
        for (const [vName, vExpr] of Object.entries(variantExprs)) {
          lines.push(`          case ${JSON.stringify(vName)}: el.innerHTML = (${vExpr}); break;`);
        }
        lines.push(`        }`);
        lines.push(`      };`);
        lines.push(`      render_${suffix}();`);
        if (typeof encodedSubscribe === "string" && encodedSubscribe.length > 0) {
          lines.push(`      _scrml_reactive_subscribe(${JSON.stringify(encodedSubscribe)}, function() { render_${suffix}(); });`);
        }
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
          // §6.7.7 — `if=<#id>.loading` lowers (TAB) to varName `_scrml_input_<id>_`
          // with dotPath `_scrml_input_<id>_.loading`. When <id> names a `<request>`,
          // route to the reactive `_scrml_request_<id>` object (the deep-reactive
          // Proxy the `_scrml_effect` controller auto-tracks), NOT a nonexistent
          // reactive cell named `_scrml_input_<id>_`. Non-request ids fall through
          // to the §36 input-state registry below (handled by the dotPath form on a
          // genuine input ref is itself non-reactive by design — §36.6 — but the
          // mount toggle never fires for those since the registry value is stable).
          const reqRefMatch = condVarName.match(/^_scrml_input_([A-Za-z_$][A-Za-z0-9_$]*)_$/);
          if (reqRefMatch && requestIds.has(reqRefMatch[1])) {
            const reqId = reqRefMatch[1];
            const tail = binding.dotPath ? binding.dotPath.slice(condVarName.length + 1) : "";
            conditionCode = tail ? `(_scrml_request_${reqId}.${tail})` : `(_scrml_request_${reqId})`;
          } else {
            const encodedCondVar = encodingCtx && encodingCtx.enabled ? encodingCtx.encode(condVarName) : condVarName;
            if (binding.dotPath) {
              conditionCode = `(_scrml_reactive_get(${JSON.stringify(encodedCondVar)}).${binding.dotPath.slice(condVarName.length + 1)})`;
            } else {
              conditionCode = `_scrml_reactive_get(${JSON.stringify(encodedCondVar)})`;
            }
          }
        }

        if (conditionCode) {
          // M1 Phase 3 (navigate-wave1b) — the if= mount/unmount controller is a
          // STATEFUL MACHINE, so it is emitted into `_scrml_nav_rewire(root)`
          // (runs at boot with `document`, RE-INVOKED scoped to the swapped region
          // on a soft nav). Idempotent re-entry: the OLD controller's teardown
          // (unmount current + dispose effect) is region-tracked and drained by
          // `_scrml_teardown_region` BEFORE the swap, then this block re-runs with
          // FRESH closure state against the NEW region's marker — no double-mount,
          // no leaked scope. The marker lookup is narrowed to `(root||document)`;
          // when the marker is NOT in this region (a shell if= during a region
          // rehydrate), the whole controller is skipped so no dead effect stacks.
          reactiveRewire.push(`    {`);
          reactiveRewire.push(`      // if= mount/unmount controller — marker ${mid}, template ${tid}`);
          reactiveRewire.push(`      var _scrml_ifm_${suffix} = (typeof _scrml_find_if_marker === "function") ? _scrml_find_if_marker(${JSON.stringify(mid)}, (root || document)) : null;`);
          reactiveRewire.push(`      if (_scrml_ifm_${suffix}) {`);
          reactiveRewire.push(`        var _scrml_ifa_${suffix} = _scrml_ifm_${suffix}.parentElement || null;`);
          reactiveRewire.push(`        let _scrml_mr_${suffix} = null;`);
          reactiveRewire.push(`        let _scrml_ms_${suffix} = null;`);
          reactiveRewire.push(`        function _scrml_if_mount_${suffix}() {`);
          reactiveRewire.push(`          _scrml_ms_${suffix} = _scrml_create_scope();`);
          reactiveRewire.push(`          _scrml_mr_${suffix} = _scrml_mount_template(${JSON.stringify(mid)}, ${JSON.stringify(tid)}, (root || document));`);
          reactiveRewire.push(`        }`);
          reactiveRewire.push(`        function _scrml_if_unmount_${suffix}() {`);
          reactiveRewire.push(`          if (_scrml_mr_${suffix} !== null) {`);
          reactiveRewire.push(`            _scrml_unmount_scope(_scrml_mr_${suffix}, _scrml_ms_${suffix});`);
          reactiveRewire.push(`            _scrml_mr_${suffix} = null;`);
          reactiveRewire.push(`            _scrml_ms_${suffix} = null;`);
          reactiveRewire.push(`          }`);
          reactiveRewire.push(`        }`);
          reactiveRewire.push(`        if (${conditionCode}) _scrml_if_mount_${suffix}();`);
          reactiveRewire.push(`        var _scrml_ifd_${suffix} = _scrml_effect(function() {`);
          reactiveRewire.push(`          if (${conditionCode}) {`);
          reactiveRewire.push(`            if (_scrml_mr_${suffix} === null) _scrml_if_mount_${suffix}();`);
          reactiveRewire.push(`          } else {`);
          reactiveRewire.push(`            if (_scrml_mr_${suffix} !== null) _scrml_if_unmount_${suffix}();`);
          reactiveRewire.push(`          }`);
          reactiveRewire.push(`        });`);
          reactiveRewire.push(`        if (typeof _scrml_region_track === "function") _scrml_region_track(_scrml_ifa_${suffix}, function() { _scrml_if_unmount_${suffix}(); _scrml_ifd_${suffix}(); });`);
          reactiveRewire.push(`      }`);
          reactiveRewire.push(`    }`);
        }
        continue;
      }

      // S105 B1 — reactive Boolean HTML attribute (disabled/readonly/required).
      // Wire `_scrml_effect` that toggles attribute presence based on truthy
      // evaluation of the bound expression. Closes §41.14 formFor follow-on
      // (`disabled=!@form.isValid` on default submit button) and unlocks
      // general adopter use of `<input disabled=${@busy}>`, etc.
      if (binding.isReactiveBoolAttr && binding.boolAttrName) {
        const attrName = binding.boolAttrName;
        const dataAttr = `data-scrml-bind-bool-${attrName}`;
        if (binding.condExpr) {
          // Bug 61 — thread synthCellKeys so `disabled=!@form.isValid` (the
          // §41.14 default submit-button gate) routes `@form.isValid` to the
          // dotted synth cell instead of member access on the compound value
          // (`undefined` → `!undefined` → `true` → button stuck disabled).
          // derivedNames threaded alongside for parity (a derived cell read in
          // the same condition resolves via _scrml_derived_get).
          const compiled = emitExprField(binding.condExprNode, binding.condExpr, { mode: "client", derivedNames: ctx.derivedNames, synthCellKeys: ctx.synthCellKeys });
          const conditionCode = `(${compiled})`;
          const toggle = `if (${conditionCode}) { el.setAttribute(${JSON.stringify(attrName)}, ""); } else { el.removeAttribute(${JSON.stringify(attrName)}); }`;
          // Rebindable (findings #1/#2): re-binds the boolean-attr toggle scoped to
          // a swapped region; the effect is region-tracked for teardown.
          pushRebindableSel(`[${dataAttr}="${placeholderId}"]`, [
            toggle,
            ...regionEffectLines(toggle),
          ]);
        }
        continue;
      }

      // i81 — reactive VALUE attribute (class, style, title, data-…, id, alt).
      // Wire an `_scrml_effect` that SETS the attribute to the stringified value.
      // Counterpart to the bool-attr block above, deliberately a DIFFERENT
      // lowering: bool toggles presence on TRUTHINESS, value sets a string and
      // is removed only on ABSENCE.
      //
      // Semantics per SPEC §42.1.1 + §42.9 (NOT truthiness — this distinction is
      // the whole point):
      //   `not` → JS `null` (§42.9) → removeAttribute
      //   `""` / `0` / `false` / `[]` → DEFINED values (§42.1.1) → setAttribute
      // §42.1.1 states that treating `""`/`0`/`false`/`[]` as absence is a
      // SEMANTIC ERROR, so a truthiness test here would be spec-violating: it
      // would drop `class=""`, `data-count=(0)` and `data-open=(false)`.
      // The absence test is the SPEC's own `is not` lowering — `=== null ||
      // === undefined` — matching BOTH, per §42.9, because foreign code (`^{}`,
      // `?{}` SQL, server fns) may produce either.
      if (binding.isReactiveValueAttr && binding.valueAttrName) {
        const attrName = binding.valueAttrName;
        const dataAttr = `data-scrml-bind-attr-${attrName}`;
        if (binding.condExpr) {
          // synthCellKeys/derivedNames threaded exactly as the bool path does, so
          // `class=(@form.isValid ? "ok" : "bad")` routes dotted reads to the
          // synth cell rather than member-accessing the compound value.
          const compiled = emitExprField(binding.condExprNode, binding.condExpr, { mode: "client", derivedNames: ctx.derivedNames, synthCellKeys: ctx.synthCellKeys });
          const valueVar = `_scrml_v`;
          const apply =
            `{ const ${valueVar} = (${compiled}); ` +
            `if (${valueVar} === null || ${valueVar} === undefined) { el.removeAttribute(${JSON.stringify(attrName)}); } ` +
            `else { el.setAttribute(${JSON.stringify(attrName)}, String(${valueVar})); } }`;
          // Rebindable — re-binds the attr effect scoped to a swapped region and
          // is region-tracked for teardown (same contract as the bool path).
          pushRebindableSel(`[${dataAttr}="${placeholderId}"]`, [
            apply,
            ...regionEffectLines(apply),
          ]);
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

        // Build the condition expression string used for evaluation
        let conditionCode: string | undefined;
        let subscribeVars: string[] | undefined; // array of var names

        // FIX(IS-VARIANT-ATTR): The previous condition required `refs.length > 0` to
        // activate the condExpr path. This caused `is .Variant` expressions (which have
        // no @-prefixed reactive refs) to silently fall through, producing no output.
        // condExpr is valid even when refs is empty — emit the condition unconditionally.
        const _ddCond = computeDisplayToggleCondition(binding);
        if (_ddCond) {
          conditionCode = _ddCond.conditionCode;
          subscribeVars = _ddCond.subscribeVars;
        }

        // Rebindable (findings #1/#2): the if=/show= display toggle re-binds
        // scoped to a swapped region so it RE-EVALUATES against the new node, and
        // its region-tracked effect tears down on the next nav.
        if (conditionCode && subscribeVars !== undefined) {
          const dtBody: string[] = [];
          if (!hasTransition) {
            // No transition — simple display toggle (original behavior)
            dtBody.push(`el.style.display = ${conditionCode} ? "" : "none";`);
            dtBody.push(...regionEffectLines(`el.style.display = ${conditionCode} ? "" : "none";`));
          } else {
            // Transition-aware display toggle
            const enterClass = binding.transitionEnter ? `"scrml-enter-${binding.transitionEnter}"` : null;
            const exitClass = binding.transitionExit ? `"scrml-exit-${binding.transitionExit}"` : null;
            const fnName = `_scrml_transition_${placeholderId.replace(/[^a-zA-Z0-9_]/g, "_")}`;

            // Initial state — no animation on first render
            dtBody.push(`el.style.display = ${conditionCode} ? "" : "none";`);
            dtBody.push(`function ${fnName}() {`);
            dtBody.push(`  const _scrml_show = ${conditionCode};`);
            dtBody.push(`  if (_scrml_show) {`);
            if (enterClass) {
              dtBody.push(`    el.style.display = "";`);
              dtBody.push(`    el.classList.add(${enterClass});`);
              dtBody.push(`    el.addEventListener("animationend", function _scrml_ae() { el.classList.remove(${enterClass}); el.removeEventListener("animationend", _scrml_ae); }, { once: true });`);
            } else {
              dtBody.push(`    el.style.display = "";`);
            }
            dtBody.push(`  } else {`);
            if (exitClass) {
              dtBody.push(`    el.classList.add(${exitClass});`);
              dtBody.push(`    el.addEventListener("animationend", function _scrml_ae() { el.classList.remove(${exitClass}); el.style.display = "none"; el.removeEventListener("animationend", _scrml_ae); }, { once: true });`);
            } else {
              dtBody.push(`    el.style.display = "none";`);
            }
            dtBody.push(`  }`);
            dtBody.push(`}`);
            dtBody.push(`const _scrml_disp = _scrml_effect(${fnName});`);
            dtBody.push(`_scrml_region_track(el, _scrml_disp);`);
          }
          pushRebindableSel(`[${dataAttr}="${placeholderId}"]`, dtBody);
        }
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

      // ---------------------------------------------------------------------
      // errorBoundary (SPEC §19.6 + §19.6.8) — markup-context error catch.
      //
      // A `${...}` interpolation inside an `<errorBoundary>` subtree gets a
      // catch wrapper instead of a bare textContent write. Two paths fire here:
      //
      //   1. TYPED `!`-error (§19.6.3, PRIMARY) — the expr value is the scrml
      //      error envelope `{ __scrml_error, type, variant, data }`. Dispatch
      //      on `.variant`: the variant's own `renders` markup wins, else the
      //      boundary's `fallback=`, else (neither) re-propagate (§19.6.8 B3).
      //
      //   2. HOST-JS BACKSTOP (§19.6.8, C-hybrid) — the render is wrapped in a
      //      host-JS try/catch so a NON-`!` throw degrades to `fallback=` +
      //      loud log. Compiler-emitted host-JS — NOT scrml source try/catch
      //      (§19.9.8 unaffected). No silent swallow (§19.6.8 B5): logs loudly,
      //      and re-throws when there is no fallback so an enclosing boundary's
      //      backstop catches it (inner-catches-first, §19.6.4).
      //
      // Reactive deps (if any) re-run the same render under `_scrml_effect` so
      // a later reactive change re-evaluates the catch + dispatch.
      // ---------------------------------------------------------------------
      if (binding.boundaryId) {
        const rewrittenExpr = emitExprField(binding.exprNode, expr, { mode: "client", derivedNames: ctx.derivedNames, synthCellKeys: ctx.synthCellKeys });
        let ebExpr = rewrittenExpr;
        if (encodingCtx && encodingCtx.enabled) {
          for (const ref of varRefs) {
            const encoded = encodingCtx.encode(ref);
            if (encoded !== ref) {
              ebExpr = ebExpr.split(`_scrml_reactive_get("${ref}")`).join(`_scrml_reactive_get(${JSON.stringify(encoded)})`);
            }
          }
        }
        const bId = JSON.stringify(binding.boundaryId);
        const fallbackExpr = binding.boundaryFallbackExpr ?? '""';
        const hasFallback = binding.boundaryHasFallback === true;
        const variantRenders = binding.boundaryVariantRenders ?? {};
        const isAsync = exprUsesServerFn(expr, serverFnNames);
        const renderFn = `_eb_render_${placeholderId.replace(/[^a-zA-Z0-9_]/g, "_")}`;

        lines.push(`  {`);
        lines.push(`    const el = document.querySelector('[data-scrml-logic="${placeholderId}"]');`);
        lines.push(`    if (el) {`);
        lines.push(`      ${isAsync ? "async " : ""}function ${renderFn}() {`);
        lines.push(`        let _eb_result;`);
        lines.push(`        try {`);
        lines.push(`          _eb_result = ${isAsync ? "await " : ""}(${ebExpr});`);
        lines.push(`        } catch (_eb_err) {`);
        lines.push(`          _scrml_error_boundary_log(${bId}, _eb_err);`);
        if (hasFallback) {
          lines.push(`          el.innerHTML = (${fallbackExpr});`);
          lines.push(`          return;`);
        } else {
          lines.push(`          throw _eb_err; // §19.6.8 B3 — no fallback; propagate to enclosing boundary/host`);
        }
        lines.push(`        }`);
        // Typed !-error dispatch (§19.6.3).
        lines.push(`        if (_eb_result && typeof _eb_result === "object" && _eb_result.__scrml_error) {`);
        lines.push(`          _scrml_error_boundary_log(${bId}, _eb_result);`);
        const variantNames = Object.keys(variantRenders);
        if (variantNames.length > 0) {
          lines.push(`          switch (_eb_result.variant) {`);
          for (const vName of variantNames) {
            lines.push(`            case ${JSON.stringify(vName)}: el.innerHTML = (${variantRenders[vName]}); return;`);
          }
          lines.push(`          }`);
        }
        if (hasFallback) {
          lines.push(`          el.innerHTML = (${fallbackExpr}); // boundary fallback (§19.6.5)`);
          lines.push(`          return;`);
        } else {
          lines.push(`          throw _scrml_error_boundary_uncaught(_eb_result); // §19.6.8 B3 — no renders/fallback; propagate`);
        }
        lines.push(`        }`);
        // Success — plain text render.
        lines.push(`        el.textContent = _eb_result;`);
        lines.push(`      }`);
        // Initial render. When async, the IIFE awaits; reactive re-run wraps in effect.
        if (isAsync) {
          lines.push(`      ${renderFn}();`);
        } else {
          lines.push(`      ${renderFn}();`);
        }
        if (varRefs.length > 0) {
          lines.push(`      _scrml_effect(function() { ${renderFn}(); });`);
        }
        lines.push(`    }`);
        lines.push(`  }`);
        continue;
      }

      // GITI-005: `${serverFn()}` in markup needs async wiring — the call
      // returns a Promise; without await, textContent becomes "[object
      // Promise]" and the reactive-refs path below never fires (expression
      // has no @-refs). Emit an IIFE that awaits the rewritten expression
      // and assigns the resolved value. This is a one-shot render (no
      // reactivity on the fetch result); a future arc will add fine-grained
      // reactivity for server-fn returns.
      if (varRefs.length === 0 && exprUsesServerFn(expr, serverFnNames)) {
        const rewrittenExpr = emitExprField(binding.exprNode, expr, { mode: "client", derivedNames: ctx.derivedNames, synthCellKeys: ctx.synthCellKeys });

        lines.push(`  {`);
        lines.push(`    const el = document.querySelector('[data-scrml-logic="${placeholderId}"]');`);
        lines.push(`    if (el) {`);
        lines.push(`      (async () => { try { el.textContent = await (${rewrittenExpr}); } catch (_e) { el.textContent = ""; } })();`);
        lines.push(`    }`);
        lines.push(`  }`);
        continue;
      }

      // §6.7.7 — a `${<#id>.data}` request-state interpolation has NO `@var` dep
      // but IS reactive (the `_scrml_request_<id>` deep-reactive Proxy auto-tracks
      // the read inside `_scrml_effect`). `binding.hasRequestRef` forces this
      // effect-wrapped path; `requestIds` (in engineExprCtxExtras) routes the
      // `<#id>` ref to `_scrml_request_<id>` instead of the §36 input-state registry.
      if (varRefs.length > 0 || binding.hasRequestRef) {
        let rewrittenExpr = emitExprField(binding.exprNode, expr, { mode: "client", derivedNames: ctx.derivedNames, synthCellKeys: ctx.synthCellKeys, ...engineExprCtxExtras });

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

        // ss20 item-1 — when this interpolation sits inside an `if=` display-
        // toggle subtree, gate the effect on the SAME guard predicate the toggle
        // uses (computed via the shared helper → lockstep). The guarded cell may
        // be absent while the toggle hides the element; reading `.field` would
        // crash on mount. The guard reads its own reactive cell INSIDE the
        // effect, so a false→true flip re-runs the effect (deps are re-tracked
        // each run) and renders the real values. `show=` is never stamped, so it
        // keeps running its inner effects.
        // ss21 item-3 — if-chain branches (if=/else-if=/else, the separate node
        // kind whose if= attr is stripped before this generic interpolation
        // walk) carry `ifGuard.chainGuard` instead of the single-`if=` fields.
        // Their gate is the branch's VISIBILITY predicate, byte-identical to the
        // chain controller's `_next === branchId` (priors-false AND own-true;
        // else = all-priors-false) — lockstep with the per-branch display
        // toggle. Single-`if=` (ss20) keeps the computeDisplayToggleCondition
        // path; `show=` is never stamped, so it stays ungated.
        let _guardCond: string | null = null;
        if (binding.ifGuard?.chainGuard) {
          _guardCond = computeChainGuardCondition(binding.ifGuard.chainGuard);
        } else if (binding.ifGuard) {
          const _ifgCond = computeDisplayToggleCondition(binding.ifGuard);
          _guardCond = _ifgCond ? _ifgCond.conditionCode : null;
        }
        // Rebindable (finding #1): emitted inline (boot) AND into the soft-nav
        // rehydrator (scoped to the swapped region) via pushRebindableDisplay.
        // The display effect is region-tracked (_scrml_region_track) so a nav
        // away tears it down (finding #2).
        const dispBody: string[] = [];
        if (needsAsync) {
          const asyncRun = `(async () => { try { el.textContent = await (${rewrittenExpr}); } catch (_e) { el.textContent = ""; } })();`;
          if (_guardCond) {
            dispBody.push(`if (${_guardCond}) { ${asyncRun} }`);
            dispBody.push(...regionEffectLines(`if (!(${_guardCond})) return; ${asyncRun}`));
          } else {
            dispBody.push(asyncRun);
            dispBody.push(...regionEffectLines(`${asyncRun}`));
          }
        } else {
          // markup-as-value (§1.4/§7.4 Pillar 1): node-aware display. A markup-
          // typed value is a DOM node → render it into el; a string/primitive
          // keeps the byte-identical textContent path. _scrml_render_value
          // (core chunk) dispatches on `instanceof Node` at runtime.
          if (_guardCond) {
            dispBody.push(`if (${_guardCond}) { _scrml_render_value(el, ${rewrittenExpr}); }`);
            dispBody.push(...regionEffectLines(`if (!(${_guardCond})) return; _scrml_render_value(el, ${rewrittenExpr});`));
          } else {
            dispBody.push(`_scrml_render_value(el, ${rewrittenExpr});`);
            dispBody.push(...regionEffectLines(`_scrml_render_value(el, ${rewrittenExpr});`));
          }
        }
        pushRebindableDisplay(placeholderId, dispBody);
      } else if (binding.kind == null && typeof expr === "string" && expr.trim() !== "") {
        // Bug 5 Phase 1 (S107, 2026-05-19) — non-reactive non-server-fn
        // default-kind interpolation gets a one-shot textContent write at
        // DOMContentLoaded.
        //
        // Pre-S107: this branch was missing — `${VERSION}` / `${"literal"}`
        // all fell through, leaving the placeholder span empty + the
        // markup-as-value pillar L1 silently misfiring on its simplest shape.
        //
        // No `_scrml_effect` subscription (no reactive deps to track).
        // Server-fn case already handled at the earlier
        // `if (varRefs.length === 0 && exprUsesServerFn(...))` branch above.
        //
        // Kind-guard: this OUTER for-loop iterates ALL logicBindings — not
        // just default reactive-text. Chain branches (kind: "if-chain-*"),
        // errors-element, transitions, etc. each have their own dedicated
        // emission path in this function. They MAY fall through to here when
        // their own early-continue paths don't fire AND they don't have
        // @-refs / server-fns. Restricting to `binding.kind == null` keeps
        // the new wiring scoped to the default reactive-text shape (the only
        // shape that has the {placeholderId, expr, exprNode, reactiveRefs}
        // contract emitExprField expects).
        //
        // Phase 1 scope-out (deferred to Phase 2): tilde-keyword bodies +
        // multi-bare-expr placeholder dedup. The `~` rewriter at
        // emit-reactive-wiring.ts:372 hoists tilde vars to file-scope, but
        // the binding's stored `expr` is still raw `~`; emitExprField has no
        // tilde-context here, so emitting `el.textContent = ~;` would produce
        // invalid JS (bitwise-NOT with no operand). Skip wiring when `~`
        // appears as a standalone token. Phase 2 will thread tilde context
        // properly. Multi-bare-expr bodies (e.g. `${ "a"; "b" }`) currently
        // register multiple bindings for the same placeholderId — also a
        // pre-existing structural issue inherited from the reactive path;
        // Phase 2 dedup will close it. Until then, multi-emit-to-same-
        // placeholder is wasteful but valid JS, so Phase 1 tolerates it.
        const standaloneTildeRegex = /(^|[\s,(;{=])~(?=\s|$|[,;)}\]])/;
        if (standaloneTildeRegex.test(expr)) continue;

        const rewrittenExpr = emitExprField(binding.exprNode, expr, { mode: "client", derivedNames: ctx.derivedNames, synthCellKeys: ctx.synthCellKeys });
        // markup-as-value (§1.4/§7.4 Pillar 1): node-aware one-shot display.
        // A markup-typed value renders into el; a string/primitive keeps the
        // byte-identical textContent path via _scrml_render_value (core chunk).
        // Static one-shot (no effect) — inline only; a swapped region gets this
        // value server-rendered in its SSR HTML (rebind=false).
        pushRebindableDisplay(placeholderId, [`_scrml_render_value(el, ${rewrittenExpr});`], false);
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

      // M1 Phase 3 (navigate-wave1b) — the if-chain is a STATEFUL controller;
      // emit it into `_scrml_nav_rewire(root)` (boot with `document`, RE-INVOKED
      // scoped to the swapped region on a soft nav). A PRESENCE gate skips the
      // whole controller when the chain is not in `root` (a shell chain during a
      // region rehydrate). Idempotent re-entry: the old controller's teardown
      // (unmount active mount branches + dispose the effect) is region-tracked +
      // drained before the swap, then this re-runs with fresh state against the
      // new region. Marker lookup + wrapper query are narrowed to `(root||document)`.
      reactiveRewire.push("");
      reactiveRewire.push(`    // if-chain: ${chainId}`);
      reactiveRewire.push(`    {`);
      reactiveRewire.push(`      var _scrml_chain_${chainSlug}_anchor = null;`);
      reactiveRewire.push(`      var _scrml_chain_${chainSlug}_present = false;`);

      // Per-branch state declarations + presence/anchor resolution (scoped).
      for (const branch of allBranches) {
        const branchSlug = (branch.branchId ?? "").replace(/[^a-zA-Z0-9_]/g, "_");
        if (branch.branchMode === "mount") {
          reactiveRewire.push(`      var _scrml_chain_${branchSlug}_marker = (typeof _scrml_find_if_marker === "function") ? _scrml_find_if_marker(${JSON.stringify(branch.markerId)}, (root || document)) : null;`);
          reactiveRewire.push(`      if (_scrml_chain_${branchSlug}_marker) { _scrml_chain_${chainSlug}_present = true; if (!_scrml_chain_${chainSlug}_anchor) _scrml_chain_${chainSlug}_anchor = _scrml_chain_${branchSlug}_marker.parentElement || null; }`);
          reactiveRewire.push(`      let _scrml_chain_${branchSlug}_root = null;`);
          reactiveRewire.push(`      let _scrml_chain_${branchSlug}_scope = null;`);
        } else {
          // display-mode: resolve wrapper at startup (the emit-html-emitted
          // `<div data-scrml-chain-branch="<branchId>">`), scoped to root.
          reactiveRewire.push(`      const _scrml_chain_${branchSlug}_wrapper = (root || document).querySelector('[data-scrml-chain-branch="${branch.branchId}"]');`);
          reactiveRewire.push(`      if (_scrml_chain_${branchSlug}_wrapper) { _scrml_chain_${chainSlug}_present = true; if (!_scrml_chain_${chainSlug}_anchor) _scrml_chain_${chainSlug}_anchor = _scrml_chain_${branchSlug}_wrapper; }`);
        }
      }

      reactiveRewire.push(`      if (_scrml_chain_${chainSlug}_present) {`);
      reactiveRewire.push(`        let _scrml_chain_${chainSlug}_active = null;`);
      reactiveRewire.push(`        function _update_chain_${chainSlug}() {`);
      reactiveRewire.push(`          let _next = null;`);

      // Condition cascade — same as pre-Phase-2g shape.
      //
      // Lower each branch condition through the variant-aware ExprNode emitter
      // (`emitExprField`), NOT the raw-string `rewriteReactiveRefs` shortcut.
      // The shortcut leaves variant literals (`.Home`, `Step::Info`) + `==`/`!=`
      // RAW, which emits invalid JS for `else-if=(@step == Step::Info)` (the
      // gate's E-CODEGEN-INVALID-LOGIC). `emitExprField` lowers `.Variant` to its
      // string tag and `==`/`!=` to `_scrml_structural_eq(...)`, matching the
      // mount-toggle path at line ~804 above. Parse failures fall back to the
      // prior raw-string rewrite (regression-preserving).
      for (const branch of condBranches) {
        // ss21 item-3 — lowered via the shared computeChainBranchCondition
        // helper (extracted above). Identical `.Variant`/`==`/call-ref handling
        // as before; sharing the helper keeps this `_next` cascade byte-
        // identical to the descendant-effect visibility gate (lockstep).
        const condCode = computeChainBranchCondition(branch.condition) ?? "true";
        reactiveRewire.push(`          if (_next === null && (${condCode})) _next = "${branch.branchId}";`);
      }
      if (elseBranch) {
        reactiveRewire.push(`          if (_next === null) _next = "${elseBranch.branchId}";`);
      }

      // Idempotency guard.
      reactiveRewire.push(`          if (_next === _scrml_chain_${chainSlug}_active) return;`);

      // Deactivate previous active branch (if any).
      reactiveRewire.push(`          if (_scrml_chain_${chainSlug}_active !== null) {`);
      reactiveRewire.push(`            switch (_scrml_chain_${chainSlug}_active) {`);
      for (const branch of allBranches) {
        const branchSlug = (branch.branchId ?? "").replace(/[^a-zA-Z0-9_]/g, "_");
        reactiveRewire.push(`              case ${JSON.stringify(branch.branchId)}:`);
        if (branch.branchMode === "mount") {
          reactiveRewire.push(`                if (_scrml_chain_${branchSlug}_root !== null) {`);
          reactiveRewire.push(`                  _scrml_unmount_scope(_scrml_chain_${branchSlug}_root, _scrml_chain_${branchSlug}_scope);`);
          reactiveRewire.push(`                  _scrml_chain_${branchSlug}_root = null;`);
          reactiveRewire.push(`                  _scrml_chain_${branchSlug}_scope = null;`);
          reactiveRewire.push(`                }`);
        } else {
          reactiveRewire.push(`                if (_scrml_chain_${branchSlug}_wrapper) _scrml_chain_${branchSlug}_wrapper.style.display = "none";`);
        }
        reactiveRewire.push(`                break;`);
      }
      reactiveRewire.push(`            }`);
      reactiveRewire.push(`          }`);

      // Activate next branch.
      reactiveRewire.push(`          switch (_next) {`);
      for (const branch of allBranches) {
        const branchSlug = (branch.branchId ?? "").replace(/[^a-zA-Z0-9_]/g, "_");
        reactiveRewire.push(`            case ${JSON.stringify(branch.branchId)}:`);
        if (branch.branchMode === "mount") {
          reactiveRewire.push(`              _scrml_chain_${branchSlug}_scope = _scrml_create_scope();`);
          reactiveRewire.push(`              _scrml_chain_${branchSlug}_root = _scrml_mount_template(${JSON.stringify(branch.markerId)}, ${JSON.stringify(branch.templateId)}, (root || document));`);
        } else {
          reactiveRewire.push(`              if (_scrml_chain_${branchSlug}_wrapper) _scrml_chain_${branchSlug}_wrapper.style.display = "";`);
        }
        reactiveRewire.push(`              break;`);
      }
      reactiveRewire.push(`          }`);

      reactiveRewire.push(`          _scrml_chain_${chainSlug}_active = _next;`);
      reactiveRewire.push(`        }`);

      // Initial render + region-tracked reactive effect.
      reactiveRewire.push(`        _update_chain_${chainSlug}();`);
      reactiveRewire.push(`        var _scrml_chain_${chainSlug}_disp = _scrml_effect(_update_chain_${chainSlug});`);
      // Region teardown — unmount active mount branches + dispose the effect.
      reactiveRewire.push(`        if (typeof _scrml_region_track === "function") _scrml_region_track(_scrml_chain_${chainSlug}_anchor, function() {`);
      for (const branch of allBranches) {
        const branchSlug = (branch.branchId ?? "").replace(/[^a-zA-Z0-9_]/g, "_");
        if (branch.branchMode === "mount") {
          reactiveRewire.push(`          if (_scrml_chain_${branchSlug}_root !== null) { _scrml_unmount_scope(_scrml_chain_${branchSlug}_root, _scrml_chain_${branchSlug}_scope); _scrml_chain_${branchSlug}_root = null; _scrml_chain_${branchSlug}_scope = null; }`);
        }
      }
      reactiveRewire.push(`          _scrml_chain_${chainSlug}_disp();`);
      reactiveRewire.push(`        });`);
      reactiveRewire.push(`      }`);
      reactiveRewire.push(`    }`);
    }
  }

  // §20.8.2 step 3 — the element-scoped wiring function. `_scrml_nav_rewire(root)`
  // attaches this file's non-delegable handlers AND binds the reactive display
  // scoped to `root`. It is invoked ONCE at boot with `document` (wiring the whole
  // page), and REGISTERED as a soft-nav rehydrator so it re-runs scoped to the
  // swapped <outlet> subtree on each navigation (WITHOUT re-booting the shell) —
  // re-attaching handlers (finding #1) + re-binding display effects that
  // `_scrml_region_track` disposes on the next nav (finding #2). Delegable
  // click/submit listeners are wired inline above (boot-only, document-level) and
  // survive a swap on their own. Registration is guarded on
  // `_scrml_register_rehydrator` (the 'utilities' runtime chunk) so a page with no
  // navigate() call — chunk tree-shaken — simply never registers (boot wiring is
  // unaffected).
  if (nonDelegatedRewire.length > 0 || reactiveRewire.length > 0) {
    lines.push("");
    lines.push("  // --- element-scoped wiring (non-delegable handlers + reactive display); re-run on soft-nav ---");
    lines.push("  function _scrml_nav_rewire(root) {");
    for (const l of nonDelegatedRewire) lines.push(l);
    for (const l of reactiveRewire) lines.push(l);
    lines.push("  }");
    lines.push("  _scrml_nav_rewire(document);");
    lines.push('  if (typeof _scrml_register_rehydrator === "function") _scrml_register_rehydrator(_scrml_nav_rewire);');
  }

  lines.push("});");

  return lines;
}
