/* SPDX-License-Identifier: MIT
 * Phase A10 (S78, 2026-05-10) — Variant-guarded markup render helper.
 *
 * Per the SCOPE-AND-DECOMPOSITION.md §3.4 (Option C-prime, RATIFIED) and
 * PHASE-0-SURVEY §7.3 finalized signature.
 *
 * **What this is.** A factored helper that emits a *variant-guarded markup
 * render dispatcher* + per-arm render functions, given:
 *   - a `variantExprAccessor` that returns a JS expression evaluating the
 *     CURRENT variant (e.g. `_scrml_reactive_get("phase")` for an engine,
 *     or the rewritten `on=` expression for a future match-block-form);
 *   - an array of `arms`, each `{tag, payloadBindings, body}`, where `body`
 *     is the walkable AST subtree to render when the variant matches `tag`;
 *   - a `CompileContext` for `generateHtml` to populate the bindings registry.
 *
 * **What this is NOT.** This helper has NO knowledge of `<engine>` vs
 * `<match for=Type on=expr>`. It is variant-source-agnostic. The engine
 * consumer (`emit-engine.ts`) maps `engine-decl.engineMeta.stateChildren` →
 * `arms[]` and passes a `_scrml_reactive_get(varName)` accessor. A future
 * match-block-form consumer maps its own arm structure → `arms[]` and passes
 * the rewritten `on=` expression as accessor. Both feed THIS helper; THIS
 * helper has no idea which Tier called it. Consolidation is at the helper
 * level, not at the lowering level (per §3.4 / Pillar 5 honesty).
 *
 * **Tree-shake.** When ALL `arms[].body` are empty (after the structural-
 * element filter at the consumer's emission boundary), this helper returns
 * `{ dispatcherJs: "", renderFunctionsJs: "", mountElementHtml: "" }` so the
 * consumer can short-circuit and emit only the documented marker comment
 * (Q4 — retain mount-position marker as debug aid; zero runtime cost).
 *
 * **Re-wire on variant change (S78 follow-on, 2026-05-10).** Reactive
 * `${@cell}` interpolation inside arm bodies (and non-delegable event
 * handlers) is RE-WIRED across variant changes via per-arm wire functions.
 * The flow:
 *   1. Per arm, `emitArmRenderFunction` runs `generateHtml(arm.body, ctx)`
 *      inside a `pushArmContext("<varName>:<armTag>")` / `popArmContext()`
 *      pair. All logic + event bindings created in this scope are tagged
 *      with `binding.engineArm = "<varName>:<armTag>"`.
 *   2. `emit-event-wiring.ts` filters arm-tagged bindings out of its
 *      global DOMContentLoaded emission so they never bind a stale
 *      module-init `document.querySelector` handle.
 *   3. Per arm, this helper emits a `_<prefix>_<idPrefix>_wire_<tag>(_root)`
 *      function that queries within `_root`, sets up `el.textContent +
 *      _scrml_effect` for logic-bindings, attaches non-delegable event
 *      listeners, and returns a dispose function (closes over the
 *      collected `_scrml_effect` dispose handles + per-listener removers).
 *   4. The dispatcher saves the prior dispose, calls it before the
 *      `innerHTML` replace, then invokes the new arm's wire function and
 *      stores its dispose for the NEXT transition. Idempotent: re-rendering
 *      the same variant calls dispose-then-wire — no double subscription.
 *   5. A `DOMContentLoaded` block fires the dispatcher with the initial
 *      variant so the initial-arm body wires at module init (the
 *      subscribe-on-set semantic doesn't fire on initial subscribe; the
 *      DOMContentLoaded block bridges the gap).
 *
 * **In-scope reactive surfaces** (re-wired on variant change):
 *   - `${@cell}` interpolation (logic-bindings — the `<span data-scrml-logic>`
 *     placeholder + textContent + `_scrml_effect`)
 *   - Non-delegable event handlers (focus, blur, mouseenter, mouseleave,
 *     change, input, scroll, ...) emitted via `addEventListener` within
 *     the new arm's mount subtree.
 *
 * **Out-of-scope (post-MVP follow-on)** — these reactive surfaces inside
 * arm bodies share the same module-init binding pattern but are NOT
 * re-wired by this helper. They are documented limitations until the
 * follow-on dispatch:
 *   - `<errors of=...>` first-class element wiring
 *   - render-by-tag expansion (`<userName/>` → `bind:value`)
 *   - if-chain branches inside arm bodies
 *   - mount-toggle `if=` (clean-subtree path)
 *   - transitions (`transition:`, `in:`, `out:`)
 *   - `bind:value` / `bind:checked` / `bind:files` / `bind:group`
 *   - `<timer>` / `<poll>` lifecycle elements
 *   - `<request>` server-fn wiring
 *   - `<keyboard>` / `<mouse>` / `<gamepad>` input-state elements
 *
 * Delegable events (click, submit, keydown, ...) work fine across variant
 * changes — delegated at document level, no per-element listeners to
 * lose on innerHTML replace.
 *
 * @see docs/changes/phase-a10-engine-state-child-body-render/SCOPE-AND-DECOMPOSITION.md
 * @see docs/changes/phase-a10-engine-state-child-body-render/PHASE-0-SURVEY.md
 */

import type { CompileContext } from "./context.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * One arm of a variant-guarded render dispatch.
 *
 * - `tag` — the variant tag (e.g. `"Idle"`, `"Loading"`, `"Error"`).
 * - `payloadBindings` — names of payload bindings introduced by the arm
 *   opener (e.g. `["msg"]` for `<Error msg>`). Sourced from
 *   `EngineStateChildEntry.payloadBindings` if available; otherwise from
 *   bareword attrs on the matched markup node (excluding the well-known
 *   engine attrs `rule`, `history`, `internal:rule`, `effect`). Future
 *   match-block-form consumer will populate from its own opener parser.
 * - `body` — the walkable AST subtree to render. The consumer is
 *   responsible for filtering structural-element children
 *   (`<onTimeout>`, `<onTransition>`, `<onIdle>`, nested `<engine>`) at
 *   the emission boundary; this helper does NOT inspect tags inside `body`.
 */
export interface VariantArm {
  tag: string;
  payloadBindings: string[];
  body: any[];
  /**
   * A5-7 Wave 2.4 (§51.0.Q.1, Bug #2) — optional JS snippet emitted into
   * the dispatcher branch immediately AFTER the wire-fn call and dispose
   * assignment. Used by engine consumer (emit-engine.ts) to inject inner-
   * engine initialization / history-restore logic for composite arms.
   *
   * Snippet contract:
   *   - Runs in scope where `_mount` is the arm's mount element, `_payload`
   *     is the payload positional array (or null), `_tag` is the variant tag.
   *   - May reference module-scope helpers (`_scrml_engine_direct_set`,
   *     `_scrml_state`, history-map identifiers, etc.).
   *   - SHOULD NOT throw. Defensive — wrap risky operations.
   *
   * Empty / undefined when arm is non-composite. Used only by the engine
   * consumer; future match-block consumer may use it for its own purposes.
   */
  postMountJs?: string;
}

/**
 * Output of `emitVariantGuardedRender`. The consumer assembles these into
 * the file's emission stream.
 *
 * - `mountElementHtml` — the HTML element string the consumer should emit
 *   at the variant's source position so the DOM has a slot for the
 *   dispatcher to replace innerHTML on. Empty string when tree-shaken.
 * - `renderFunctionsJs` — `function _<prefix>_render_<tag>(...)` declarations
 *   per arm (joined with newlines). Empty string when tree-shaken.
 * - `dispatcherJs` — the `_scrml_reactive_subscribe`- or `_scrml_effect`-
 *   wrapped dispatcher block. Reads the variant via `variantExprAccessor()`,
 *   switches on the tag, calls the matching render function (passing payload
 *   positionals), tears down the prior arm's wiring, replaces the mount
 *   element's innerHTML, and calls the new arm's wire function to re-bind
 *   `${@cell}` interpolation + non-delegable event handlers. Empty string
 *   when tree-shaken.
 *
 *   Phase A10 re-wire (2026-05-10): the dispatcher block now ALSO emits a
 *   `let _<prefix>_<idPrefix>_dispose = null;` declaration above the
 *   subscribe/effect, plus a `document.addEventListener('DOMContentLoaded', ...)`
 *   block that fires the dispatcher with the initial variant value so the
 *   initial-arm body's wiring binds at module init.
 */
export interface VariantGuardOutput {
  mountElementHtml: string;
  renderFunctionsJs: string;
  dispatcherJs: string;
}

/**
 * Optional configuration passed by the consumer.
 *
 * - `idPrefix` — used in render-function names + the mount element's
 *   `data-scrml-variant-mount` attribute. Engines pass the engine's
 *   `varName` so names look like `_scrml_engine_<varName>_render_<Tag>`.
 *   Required (no default — keeps the helper variant-source-agnostic at
 *   the naming layer).
 * - `mountAttr` — the data-attribute name to stamp on the mount element.
 *   Defaults to `"data-scrml-engine-mount"`. The future match-block
 *   consumer should pass `"data-scrml-match-mount"`.
 * - `renderFnPrefix` — the prefix for render-function names. Defaults to
 *   `"_scrml_engine"`. Future match consumer passes `"_scrml_match"`.
 * - `variantSubscribeName` — when non-null, the dispatcher subscribes via
 *   `_scrml_reactive_subscribe(name, fn)` — fires only on `set`, not at
 *   init. When null, the dispatcher uses `_scrml_effect` (full dep
 *   tracking, fires at init too — caller must reconcile the init render
 *   with the consumer-emitted static initial HTML at the mount slot).
 *   Engines always pass `meta.varName`; future match-block consumer
 *   passes null when the `on=` expression is non-cell (then the helper
 *   tracks via `_scrml_effect`).
 */
export interface VariantGuardOptions {
  idPrefix: string;
  mountAttr?: string;
  renderFnPrefix?: string;
  variantSubscribeName?: string | null;
}

// ---------------------------------------------------------------------------
// Helper — emit one render function for one arm
// ---------------------------------------------------------------------------

/**
 * Emit `function _<prefix>_<idPrefix>_render_<tag>(<payloads...>) { ... }`.
 *
 * The body uses `generateHtml(armBody, ctx)` to lower the AST subtree to
 * an HTML string + register bindings in `ctx.registry`. Payload bindings
 * become function parameters; the body's references to those names resolve
 * as plain JS identifiers (per A1b PASS 1 scope-extension territory; if a
 * payload-binding scope-injection deferral surfaces during typing, that's
 * called out in the SCOPE doc as deferred — does NOT block emission shape).
 *
 * The returned function is a no-op-shaped IIFE producing a string: the
 * dispatcher captures the string and writes it to the mount element's
 * innerHTML.
 */
function emitArmRenderFunction(
  fnName: string,
  arm: VariantArm,
  ctx: CompileContext,
  armContextId: string | null,
): string {
  // Lazy import to avoid circular dep with emit-html.ts (which imports
  // helpers from various siblings). require() is the runtime escape hatch
  // used elsewhere in this codegen module set (see emit-reactive-wiring.ts
  // line 259 for prior art).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { generateHtml } = require("./emit-html.ts") as {
    generateHtml: (nodes: any[], ctx: CompileContext) => string;
  };

  // Phase A10 (S78, 2026-05-10) — push/pop arm context so logic + event
  // bindings emitted during this arm's HTML generation are tagged with
  // `engineArm = armContextId`. emit-event-wiring.ts filters tagged
  // bindings out of global emission; this helper's emitArmWireFunction
  // (called by emitVariantGuardedRender) re-emits per-arm wiring to be
  // invoked AFTER each variant change's innerHTML replace.
  if (armContextId && ctx.registry) ctx.registry.pushArmContext(armContextId);
  let html: string;
  try {
    html = generateHtml(arm.body, ctx);
  } finally {
    if (armContextId && ctx.registry) ctx.registry.popArmContext();
  }
  // JSON-encode the HTML so embedded quotes/newlines are safely escaped.
  const htmlLiteral = JSON.stringify(html);

  const params = arm.payloadBindings.join(", ");
  const lines: string[] = [];
  lines.push(`function ${fnName}(${params}) {`);
  // Payload bindings: each is a plain JS identifier in scope inside the
  // function body. The HTML literal references them via `${msg}` style
  // template-literal interpolation — but `generateHtml` produces a plain
  // string with `<span data-scrml-logic="...">` placeholders for `${expr}`
  // logic nodes, so most interpolation paths route through the bindings
  // registry. Bare identifier substitution in static text is the
  // exception: covered by the `${id}` fallback at the dispatcher level
  // when the body has no logic node and the payload appears in raw text.
  // Since `generateHtml` already covers the common path, the body simply
  // returns the HTML literal here.
  lines.push(`  return ${htmlLiteral};`);
  lines.push(`}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Helper — emit one wire function for one arm
// ---------------------------------------------------------------------------

/**
 * DELEGABLE_EVENTS — kept identical to `emit-event-wiring.ts` DELEGABLE_EVENTS.
 *
 * Delegable events fire on document-level listeners that walk up from
 * `event.target` via `data-scrml-bind-<event>` attribute, so they survive
 * an `innerHTML` replace inside the engine's mount slot — the new
 * placeholders carry valid attributes the document delegate dispatches
 * against. Therefore arm-tagged delegable events are NOT re-emitted by
 * `emitArmWireFunction`; they remain in `emit-event-wiring.ts` global
 * emission.
 *
 * Non-delegable events bind per-element via `addEventListener` on cached
 * handles; those handles point at detached DOM after a variant change.
 * Arm-tagged non-delegable events ARE re-emitted by `emitArmWireFunction`
 * so the listener attaches to the new arm's mount subtree.
 *
 * Keep this set in sync with `emit-event-wiring.ts:DELEGABLE_EVENTS`.
 */
const DELEGABLE_EVENTS = new Set<string>(["click", "submit"]);

/**
 * Emit `function <wireFnName>(_root) { ... }`.
 *
 * `_root` is the mount element AFTER the dispatcher's `innerHTML` replace.
 * The function:
 *   - looks up logic-binding placeholders inside `_root` and binds
 *     `_root.querySelector(...).textContent + _scrml_effect(...)` so
 *     `${@cell}` interpolation responds to subsequent cell changes;
 *   - looks up non-delegable event placeholders inside `_root` and
 *     attaches `addEventListener` for each;
 *   - returns a dispose function that calls each `_scrml_effect` dispose
 *     handle (returned by `_scrml_effect` per runtime-template.js:1788)
 *     and removes each event listener via `removeEventListener`.
 *
 * Idempotency: the dispatcher calls the prior arm's dispose BEFORE the
 * `innerHTML` replace and BEFORE invoking the new arm's wire fn. So the
 * runtime never has more than one arm's subscriptions active at a time;
 * re-rendering the same arm dispose-then-re-wires fresh.
 *
 * Tree-shake invariant: when no logic-binding and no non-delegable
 * event-binding are tagged with this `armContextId`, the function emits
 * a no-op shell `function name(_root) { return function() {}; }`. The
 * dispatcher calls it unconditionally for branch-uniform code, but the
 * runtime cost is one allocation per variant change — bounded.
 *
 * Out-of-scope reactive surfaces (per emitVariantGuardedRender JSDoc) are
 * NOT re-bound here — those bindings remain in global emission via the
 * filter in `emit-event-wiring.ts:emitEventWiring`. Documented v1
 * limitation; follow-on dispatch covers them.
 */
function emitArmWireFunction(
  wireFnName: string,
  armContextId: string,
  ctx: CompileContext,
): string {
  // Lazy import for the same circular-dep reasons as emitArmRenderFunction.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { emitExprField } = require("./emit-expr.ts") as {
    emitExprField: (
      exprNode: any,
      fallbackStr: string,
      ctx: { mode: string; derivedNames?: Set<string> },
    ) => string;
  };

  const registry = ctx.registry;
  // Snapshot bindings WITH this arm's context tag. The registry is shared
  // across all engines/arms in the file — filter is mandatory.
  const logicBindings = registry
    ? (registry.logicBindings as any[]).filter((b) => b.engineArm === armContextId)
    : [];
  const eventBindings = registry
    ? (registry.eventBindings as any[]).filter((b) => b.engineArm === armContextId)
    : [];

  // In-scope logic bindings: only the default reactive-text kind. Other
  // kinds (errors-element, if-chain-branch, if-chain-else, conditional
  // display, mount toggle, visibility toggle) fall through to global
  // emission — see `emit-event-wiring.ts` filter for the symmetric rule.
  const wireableLogic = logicBindings.filter((b) => {
    if (b.kind != null) return false;
    if (b.isConditionalDisplay) return false;
    if (b.isVisibilityToggle) return false;
    if (b.isMountToggle) return false;
    return typeof b.placeholderId === "string" && typeof b.expr === "string";
  });
  // In-scope event bindings: only non-delegable events.
  const wireableEvents = eventBindings.filter((b) => {
    const domEvent = (b.eventName || "").replace(/^on/, "");
    return !DELEGABLE_EVENTS.has(domEvent);
  });

  // No bindings to wire → no-op shell so the dispatcher branch stays uniform.
  if (wireableLogic.length === 0 && wireableEvents.length === 0) {
    return `function ${wireFnName}(_root) { return function() {}; }`;
  }

  const encodingCtx = ctx.encodingCtx;
  const lines: string[] = [];
  lines.push(`function ${wireFnName}(_root) {`);
  lines.push(`  const _disposers = [];`);

  // ---- Logic bindings: textContent + _scrml_effect ----
  for (const binding of wireableLogic) {
    const placeholderId = binding.placeholderId as string;
    const expr = binding.expr as string;
    let rewrittenExpr = emitExprField(binding.exprNode, expr, { mode: "client", derivedNames: ctx.derivedNames });
    // Apply encoded names when encoding is active — same pattern as
    // emit-event-wiring.ts:670-680.
    let varRefs: string[];
    if (binding.reactiveRefs !== undefined && binding.reactiveRefs !== null) {
      varRefs = Array.from(binding.reactiveRefs as Set<string>);
    } else {
      varRefs = [];
      const re = /@([A-Za-z_$][A-Za-z0-9_$]*)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(expr)) !== null) varRefs.push(m[1]);
    }
    if (encodingCtx && encodingCtx.enabled) {
      for (const ref of varRefs) {
        const encoded = encodingCtx.encode(ref);
        if (encoded !== ref) {
          rewrittenExpr = rewrittenExpr
            .split(`_scrml_reactive_get("${ref}")`)
            .join(`_scrml_reactive_get(${JSON.stringify(encoded)})`);
        }
      }
    }
    lines.push(`  {`);
    lines.push(`    const el = _root.querySelector('[data-scrml-logic=${JSON.stringify(placeholderId)}]');`);
    lines.push(`    if (el) {`);
    if (varRefs.length > 0) {
      // Reactive: bind initial value + subscribe via _scrml_effect (returns dispose).
      lines.push(`      el.textContent = ${rewrittenExpr};`);
      lines.push(`      _disposers.push(_scrml_effect(function() { el.textContent = ${rewrittenExpr}; }));`);
    } else {
      // No reactive deps — write once. No dispose needed.
      lines.push(`      el.textContent = ${rewrittenExpr};`);
    }
    lines.push(`    }`);
    lines.push(`  }`);
  }

  // ---- Event bindings: addEventListener + remover dispose ----
  // Reuse the same handlerExpr-shape logic as emit-event-wiring's main
  // event loop (Cases A/B/C for `handlerExpr`, plus the call-ref path).
  // Local lazy imports for the rewriters to avoid circular dependencies.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { rewriteBlockBody } = require("./emit-control-flow.ts") as {
    rewriteBlockBody: (raw: string) => string;
  };

  function buildHandlerExpr(binding: any): string {
    if (binding.handlerExpr) {
      // Detect fn(params) { body } shorthand.
      const fnMatch = String(binding.handlerExpr).match(/^\s*fn\s*\(/);
      if (fnMatch) {
        // Find matching close-paren of param list, then the brace body.
        const raw = binding.handlerExpr as string;
        const parenOpen = raw.indexOf("(");
        let depth = 1;
        let i = parenOpen + 1;
        while (i < raw.length && depth > 0) {
          if (raw[i] === "(") depth++;
          else if (raw[i] === ")") depth--;
          if (depth === 0) break;
          i++;
        }
        const parenClose = i;
        const params = raw.slice(parenOpen + 1, parenClose).trim();
        const afterParen = raw.slice(parenClose + 1).trimStart();
        if (afterParen.startsWith("{")) {
          const braceOpen = parenClose + 1 + (raw.slice(parenClose + 1).length - afterParen.length);
          let bd = 1;
          let j = braceOpen + 1;
          while (j < raw.length && bd > 0) {
            if (raw[j] === "{") bd++;
            else if (raw[j] === "}") bd--;
            if (bd === 0) break;
            j++;
          }
          const body = raw.slice(braceOpen + 1, j).trim();
          return `function(${params}) { ${rewriteBlockBody(body)}; }`;
        }
      }
      // Arrow function — use as-is via emitExprField rewrite.
      const isArrow =
        /^\s*\([^)]*\)\s*=>/.test(binding.handlerExpr) ||
        /^\s*[\w$_][\w$_0-9]*\s*=>/.test(binding.handlerExpr);
      if (isArrow) {
        return emitExprField(binding.handlerExprNode, binding.handlerExpr, { mode: "client" });
      }
      // Plain expression / statement — rewrite + wrap.
      const rewritten = rewriteBlockBody(binding.handlerExpr);
      const isBareRef = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(rewritten.trim());
      const body = isBareRef ? `${rewritten}()` : rewritten;
      return `function(event) { ${body}; }`;
    }
    // call-ref path: handler name + args. Server-fn name resolution via
    // fnNameMap is not available in this scope; rely on the ORIGINAL name
    // (which may be a server-fn — that's a documented limitation for the
    // arm-body case; the typical event-handler pattern is `fn`-shorthand
    // or arrow forms above). For safety, fall back to invoking the named
    // handler with the supplied args plus an `event` last positional when
    // no args were given.
    const handlerName = String(binding.handlerName);
    const argNodes = binding.handlerArgExprNodes;
    const args = (binding.handlerArgs || []).map((a: unknown, idx: number) => {
      if (typeof a === "string") return emitExprField(argNodes?.[idx], a, { mode: "client" });
      const node = a as Record<string, unknown> | null;
      if (node && (node as any).kind === "string-literal") return JSON.stringify((node as any).value);
      if (node && (node as any).kind === "number-literal") return String((node as any).value);
      if (node && (node as any).kind === "variable-ref") {
        return `_scrml_reactive_get(${JSON.stringify(((node as any).name || "").replace(/^@/, ""))})`;
      }
      if (node && typeof (node as any).value !== "undefined") return JSON.stringify((node as any).value);
      return String(a);
    }).join(", ");
    const callArgs = args.length === 0 ? "event" : args;
    const domEvent = String(binding.eventName || "").replace(/^on/, "");
    const preventLine = domEvent === "submit" ? "event.preventDefault(); " : "";
    // A5-6 Feature 1 (§51.0.M name= extension, S79). Mirror the
    // emit-event-wiring.ts call-ref recognition for non-delegable events
    // (e.g. `<input onfocus=cancelTimer("X")>` inside an arm body). Same
    // semantics: cancelTimer + arm context + string-literal first arg →
    // lower to `_scrml_engine_clear_named_timer(...)`.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { maybeLowerCancelTimerCallRef } = require("./emit-engine.ts") as {
      maybeLowerCancelTimerCallRef: (
        handlerName: string,
        handlerArgs: ReadonlyArray<unknown>,
        engineArm: string | null | undefined,
      ) => string | null;
    };
    const lowered = maybeLowerCancelTimerCallRef(
      handlerName, binding.handlerArgs || [], binding.engineArm as string | undefined,
    );
    if (lowered !== null) {
      return `function(event) { ${preventLine}${lowered}; }`;
    }
    return `function(event) { ${preventLine}${handlerName}(${callArgs}); }`;
  }

  for (const binding of wireableEvents) {
    const placeholderId = binding.placeholderId as string;
    const eventName = binding.eventName as string; // e.g. "onfocus"
    const domEvent = eventName.replace(/^on/, "");
    const handlerExpr = buildHandlerExpr(binding);
    const dataAttr = `data-scrml-bind-${eventName}`;
    lines.push(`  {`);
    lines.push(`    const el = _root.querySelector('[${dataAttr}=${JSON.stringify(placeholderId)}]');`);
    lines.push(`    const _h = ${handlerExpr};`);
    lines.push(`    if (el) {`);
    lines.push(`      el.addEventListener(${JSON.stringify(domEvent)}, _h);`);
    lines.push(`      _disposers.push(function() { el.removeEventListener(${JSON.stringify(domEvent)}, _h); });`);
    lines.push(`    }`);
    lines.push(`  }`);
  }

  // Dispose: tear down all _scrml_effect handles + event-listener removers.
  // Wrapped in try/catch per-disposer — defensive against partial failures
  // (a runtime dispose that throws shouldn't strand the others).
  lines.push(`  return function() { for (const _d of _disposers) { try { _d(); } catch (_e) {} } };`);
  lines.push(`}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a variant-guarded markup render dispatcher for the given arms.
 *
 * Tree-shake: when ALL `arms[].body` arrays are empty, returns the empty
 * triple. Consumer should short-circuit and emit only its mount-position
 * marker comment (Q4).
 *
 * **Dispatcher mechanism — `_scrml_reactive_subscribe`, NOT `_scrml_effect`.**
 * Choice rationale: `_scrml_effect` runs the body ONCE at module init (to
 * track deps) and again on every dep change. The init-time run would call
 * `_mount.innerHTML = render_<initial>()`, REPLACING the static initial-arm
 * HTML emitted by the consumer at the engine's source position. The
 * file-level `emit-reactive-wiring.ts` pass runs at module-init AFTER our
 * dispatcher and caches `document.querySelector(...)` handles for every
 * `data-scrml-logic` placeholder — handles which would already point at
 * detached DOM nodes from the dispatcher's init-time replace. Net effect:
 * no reactive `${@cell}` interp inside arm bodies works at all, even for
 * the initial arm.
 *
 * `_scrml_reactive_subscribe(varName, fn)` fires ONLY on subsequent `set`
 * calls — never at init. To wire the initial arm at module init, the
 * dispatcher emission ALSO emits a `DOMContentLoaded` block that fires
 * the dispatcher once with the initial variant value. Per-arm wire
 * functions handle re-binding `${@cell}` interpolation + non-delegable
 * event handlers AFTER each `innerHTML` replace, with prior-arm dispose
 * called before re-render for idempotency (no leaked subscriptions, no
 * double-bind on re-render of the same variant).
 */
export function emitVariantGuardedRender(
  variantExprAccessor: () => string,
  arms: VariantArm[],
  ctx: CompileContext,
  opts: VariantGuardOptions,
): VariantGuardOutput {
  const allEmpty = arms.every((a) => !a.body || a.body.length === 0);
  if (allEmpty) {
    return { mountElementHtml: "", renderFunctionsJs: "", dispatcherJs: "" };
  }

  const idPrefix = opts.idPrefix;
  const mountAttr = opts.mountAttr ?? "data-scrml-engine-mount";
  const renderFnPrefix = opts.renderFnPrefix ?? "_scrml_engine";

  // ---------------- Render functions ----------------
  const renderFnLines: string[] = [];
  for (const arm of arms) {
    if (!arm.body || arm.body.length === 0) {
      // Empty-body arm — emit a no-arg render that returns "".
      // Keeps dispatcher uniform without an extra branch.
      const fnName = `${renderFnPrefix}_${idPrefix}_render_${arm.tag}`;
      const lines: string[] = [];
      const params = arm.payloadBindings.join(", ");
      lines.push(`function ${fnName}(${params}) {`);
      lines.push(`  return "";`);
      lines.push(`}`);
      renderFnLines.push(lines.join("\n"));
      continue;
    }
    const fnName = `${renderFnPrefix}_${idPrefix}_render_${arm.tag}`;
    // Phase A10 (S78, 2026-05-10) — pass armContextId so
    // emitArmRenderFunction tags bindings with `engineArm = "<varName>:<armTag>"`.
    const armContextId = `${idPrefix}:${arm.tag}`;
    renderFnLines.push(emitArmRenderFunction(fnName, arm, ctx, armContextId));
  }
  const renderFunctionsJs = renderFnLines.join("\n\n");

  // ---------------- Per-arm wire functions ----------------
  // Phase A10 (S78, 2026-05-10) — for each arm, emit a wire function that
  // takes the mount root (the new innerHTML's owning element after the
  // dispatcher's innerHTML replace) and re-establishes reactive
  // subscriptions + non-delegable event listeners for placeholders inside
  // the arm body. Returns a dispose function that tears down the bindings.
  //
  // Emit ALL arm wire fns (even empty arms) so the dispatcher can
  // unconditionally call them — empty arms get a no-op wire fn returning
  // a no-op dispose. This keeps the dispatcher branch-uniform.
  const wireFnLines: string[] = [];
  for (const arm of arms) {
    const wireFnName = `${renderFnPrefix}_${idPrefix}_wire_${arm.tag}`;
    const armContextId = `${idPrefix}:${arm.tag}`;
    wireFnLines.push(emitArmWireFunction(wireFnName, armContextId, ctx));
  }
  const wireFunctionsJs = wireFnLines.join("\n\n");

  // ---------------- Mount element ----------------
  // Single-element slot the dispatcher writes innerHTML into. The Q4
  // marker comment is preserved by the consumer (engine emits it
  // adjacent to this element). Mount-attr identifies the variant cell
  // for debug + future re-binding work.
  //
  // NOTE: Consumers that want the initial-arm body to render at module
  // init time (so `${@cell}` interpolations are bound by file-level
  // reactive-wiring) should call `emitInitialArmHtmlForMount(arms,
  // initialTag, ctx)` separately and inject the result inside the mount
  // div via the file-level HTML pass. The helper here only emits the
  // empty mount slot; the consumer's HTML emission code is responsible
  // for placing the initial arm's body inside it.
  const mountElementHtml = `<div ${mountAttr}="${idPrefix}"></div>`;

  // ---------------- Dispatcher ----------------
  // Two wiring shapes — see VariantGuardOptions.variantSubscribeName JSDoc
  // above for the rationale.
  //
  //   Shape A (variantSubscribeName non-null) — `_scrml_reactive_subscribe`:
  //     Fires only on `set`, not at init. Initial-arm HTML emitted by the
  //     consumer at the mount slot is left intact, file-level reactive-
  //     wiring binds correctly to its placeholders, initial-arm interp is
  //     fully reactive. Used by engines (always pass `meta.varName`).
  //
  //   Shape B (variantSubscribeName null) — `_scrml_effect`:
  //     Fires at init too; auto-tracks deps. Caller must reconcile init
  //     render with consumer-emitted static initial HTML, OR accept that
  //     init render replaces the static HTML and breaks file-level
  //     reactive bindings. Reserved for future match-block-form consumer
  //     when `on=` is a non-cell expression.
  const subscribeName = opts.variantSubscribeName ?? null;
  const disposeVar = `_${renderFnPrefix}_${idPrefix}_dispose`;
  const dispatchFnName = `_${renderFnPrefix}_${idPrefix}_dispatch`;
  const dispatcherLines: string[] = [];

  // Phase A10 (S78, 2026-05-10) — module-scope dispose handle for the
  // currently-mounted arm. Holds the dispose fn returned by the arm's
  // wire function. null when no arm is currently wired (initial state, or
  // after teardown without re-render).
  dispatcherLines.push(`let ${disposeVar} = null;`);

  // The dispatcher body is factored into a named function so it can be
  // invoked from BOTH the variant-change subscriber AND the
  // DOMContentLoaded initial-fire block below.
  dispatcherLines.push(`function ${dispatchFnName}(_v) {`);
  dispatcherLines.push(`  const _mount = document.querySelector('[${mountAttr}="${idPrefix}"]');`);
  dispatcherLines.push(`  if (!_mount) return;`);
  // Variant tag extraction. Per C12 the variant is a STRING tag (e.g.
  // "Idle"). Future variant kinds (struct-discriminator, payload-bearing
  // tagged-union) MAY surface a `{tag, payload}`-shaped runtime value;
  // the helper handles both shapes defensively.
  dispatcherLines.push(`  const _tag = typeof _v === "string" ? _v : (_v && _v.tag);`);
  dispatcherLines.push(`  const _payload = (_v && typeof _v === "object" && Array.isArray(_v.payload)) ? _v.payload : null;`);
  // Tear down the prior arm's wiring before the innerHTML replace so
  // _scrml_effect callbacks don't fire against detached spans (memory
  // hygiene). Idempotent — calling dispose twice is a no-op (the runtime
  // sets `disposed = true` on first call).
  dispatcherLines.push(`  if (${disposeVar}) { ${disposeVar}(); ${disposeVar} = null; }`);

  // Switch on tag, call matching render fn + wire fn.
  for (let i = 0; i < arms.length; i++) {
    const arm = arms[i];
    const fnName = `${renderFnPrefix}_${idPrefix}_render_${arm.tag}`;
    const wireFnName = `${renderFnPrefix}_${idPrefix}_wire_${arm.tag}`;
    const head = i === 0 ? `if` : `else if`;
    // Pass payload positionals: _payload[0], _payload[1], ... — undefined
    // when the runtime variant is a bare string tag.
    const args = arm.payloadBindings
      .map((_, j) => `_payload && _payload[${j}]`)
      .join(", ");
    dispatcherLines.push(`  ${head} (_tag === ${JSON.stringify(arm.tag)}) {`);
    dispatcherLines.push(`    _mount.innerHTML = ${fnName}(${args});`);
    dispatcherLines.push(`    ${disposeVar} = ${wireFnName}(_mount);`);
    // A5-7 Wave 2.4 (§51.0.Q.1, Bug #2) — postMountJs injection point.
    // The engine consumer populates this for composite arms with inner-
    // engine init / history-restore logic. Branch-uniform skip when arm
    // is non-composite (postMountJs is undefined or empty). Indented to
    // match the if-block body for readability.
    if (typeof arm.postMountJs === "string" && arm.postMountJs.length > 0) {
      for (const ln of arm.postMountJs.split("\n")) {
        if (ln.length > 0) dispatcherLines.push(`    ${ln}`);
        else dispatcherLines.push("");
      }
    }
    dispatcherLines.push(`  }`);
  }
  // No default branch — when _tag does not match any arm, the mount keeps
  // its previous content. Conservative behavior; consumers that want a
  // fallback should add an arm with the appropriate tag.
  dispatcherLines.push(`}`);

  // Subscribe to variant changes — fires on set, not at init.
  if (subscribeName !== null) {
    // Shape A — subscribe-only, fires on set, not at init.
    dispatcherLines.push(`_scrml_reactive_subscribe(${JSON.stringify(subscribeName)}, ${dispatchFnName});`);
  } else {
    // Shape B — effect, fires at init too. Tracks deps via runtime
    // _scrml_effect_stack on the variantExprAccessor() read.
    dispatcherLines.push(`_scrml_effect(function() {`);
    dispatcherLines.push(`  ${dispatchFnName}(${variantExprAccessor()});`);
    dispatcherLines.push(`});`);
  }

  // Phase A10 (S78, 2026-05-10) — initial-fire at DOMContentLoaded so the
  // initial-arm body (already in static HTML at module init) gets its
  // `${@cell}` interpolation + non-delegable events wired. Without this
  // bridge the subscribe-only Shape A would never wire the initial arm
  // (subscribe doesn't fire on initial registration). Shape B's effect
  // fires at init so the DOMContentLoaded block is redundant for it but
  // harmless (the `if (${disposeVar}) dispose()` branch tears down the
  // first wire, then re-wires fresh — same result).
  if (subscribeName !== null) {
    dispatcherLines.push(`document.addEventListener('DOMContentLoaded', function() {`);
    dispatcherLines.push(`  ${dispatchFnName}(_scrml_reactive_get(${JSON.stringify(subscribeName)}));`);
    dispatcherLines.push(`});`);
  }

  const dispatcherJs = dispatcherLines.join("\n");

  // Combine renderFns + wireFns into a single block, ordered render-then-wire
  // for readability. Hoisting makes order semantically irrelevant in JS, but
  // the output is human-readable so we keep it organized.
  const combinedRenderFns = wireFunctionsJs
    ? `${renderFunctionsJs}\n\n${wireFunctionsJs}`
    : renderFunctionsJs;

  return {
    mountElementHtml,
    renderFunctionsJs: combinedRenderFns,
    dispatcherJs,
  };
}

// ---------------------------------------------------------------------------
// Helper — extract payload bindings from a state-child markup node's attrs
// ---------------------------------------------------------------------------

/**
 * Reserved attr names that are NOT payload bindings on engine state-child
 * openers (per `engine-statechild-parser.ts` recognition set). Used by
 * `extractPayloadBindingsFromAttrs` to identify bareword attrs that ARE
 * payload bindings.
 */
const ENGINE_STATE_CHILD_RESERVED_ATTRS = new Set<string>([
  "rule",
  "history",
  "internal:rule",
  "effect",
]);

/**
 * Extract payload binding names from a state-child markup node's attrs.
 *
 * Heuristic per Phase 0 probe (2026-05-10): bareword attrs (`{kind: "absent"}`
 * value) on engine state-child openers, EXCLUDING the well-known engine
 * attrs (`rule`, `history`, `internal:rule`, `effect`), are payload bindings.
 *
 * Example:
 *   `<Error msg rule=.Idle>` → attrs = [{name:"msg", value:{kind:"absent"}},
 *                                       {name:"rule", value:".Idle"}]
 *   payloadBindings = ["msg"]
 *
 * `EngineStateChildEntry.payloadBindings` is NOT currently populated by
 * `engine-statechild-parser.ts` (per intake — Phase A10 explicitly defers
 * payload-binding scope-injection). When the entry-side field arrives,
 * this helper can be retired in favor of `entry.payloadBindings`.
 */
export function extractPayloadBindingsFromAttrs(attrs: any[] | undefined): string[] {
  if (!Array.isArray(attrs)) return [];
  const out: string[] = [];
  for (const a of attrs) {
    if (!a || typeof a !== "object") continue;
    if (typeof a.name !== "string") continue;
    if (ENGINE_STATE_CHILD_RESERVED_ATTRS.has(a.name)) continue;
    // Bareword (kind: "absent") = payload binding.
    if (a.value && typeof a.value === "object" && a.value.kind === "absent") {
      out.push(a.name);
    }
  }
  return out;
}

/**
 * Tag-set of structural elements that appear inside an engine state-child
 * body but are NOT renderable markup. Used by `filterRenderableChildren`
 * to strip them before passing arm body to `generateHtml`.
 *
 * Per PHASE-0-SURVEY §8 R2: state-child bodies contain `<onTimeout>`,
 * `<onTransition>`, `<onIdle>`, nested `<engine>` siblings that aren't
 * rendered DOM but ARE part of `block.children`. Filter at the emission
 * boundary.
 */
const STATE_CHILD_STRUCTURAL_TAGS = new Set<string>([
  "onTimeout",
  "onTransition",
  "onIdle",
  "engine",
  "machine",
]);

/**
 * Emit the HTML for the initial-arm's body. Used by the file-level HTML
 * pass (emit-html.ts engine-decl case) to seed the mount slot with the
 * initial-variant body so file-level reactive-wiring can bind to its
 * placeholders at module init.
 *
 * Returns "" when no arm matches `initialTag` OR when the matched arm's
 * body is empty (tree-shake-safe). Consumer can concatenate the result
 * inside the mount slot's open/close tags directly.
 */
export function emitInitialArmHtmlForMount(
  arms: VariantArm[],
  initialTag: string | null,
  ctx: CompileContext,
  armContextId?: string,
): string {
  if (!initialTag) return "";
  const arm = arms.find((a) => a.tag === initialTag);
  if (!arm || !arm.body || arm.body.length === 0) return "";
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { generateHtml } = require("./emit-html.ts") as {
    generateHtml: (nodes: any[], ctx: CompileContext) => string;
  };
  // Phase A10 (S78, 2026-05-10) — push/pop arm context so bindings created
  // during initial-arm body generation are tagged. The dispatcher will
  // fire at DOMContentLoaded for the initial variant, calling the per-arm
  // wire function, which restores the wiring inside the mount.
  if (armContextId && ctx.registry) ctx.registry.pushArmContext(armContextId);
  try {
    return generateHtml(arm.body, ctx);
  } finally {
    if (armContextId && ctx.registry) ctx.registry.popArmContext();
  }
}

/**
 * Filter a state-child markup node's children to the renderable subset.
 *
 * Drops:
 *   - structural elements (`<onTimeout>`, `<onTransition>`, `<onIdle>`,
 *     nested `<engine>` / `<machine>`);
 *   - leading + trailing whitespace text nodes (cosmetic — keeps the
 *     emitted HTML tidy without changing semantics).
 *
 * Keeps:
 *   - all other markup, text, logic, comment, state-decl nodes.
 */
export function filterRenderableChildren(children: any[] | undefined): any[] {
  if (!Array.isArray(children)) return [];
  const out: any[] = [];
  for (const c of children) {
    if (!c || typeof c !== "object") continue;
    if (c.kind === "markup" && typeof c.tag === "string" && STATE_CHILD_STRUCTURAL_TAGS.has(c.tag)) continue;
    out.push(c);
  }
  // Trim leading whitespace-only text nodes for tidier emission.
  while (out.length > 0 && out[0].kind === "text" && /^\s*$/.test(String(out[0].value ?? out[0].text ?? ""))) {
    out.shift();
  }
  while (out.length > 0 && out[out.length - 1].kind === "text" && /^\s*$/.test(String(out[out.length - 1].value ?? out[out.length - 1].text ?? ""))) {
    out.pop();
  }
  return out;
}
