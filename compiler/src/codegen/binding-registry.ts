/**
 * @module codegen/binding-registry
 *
 * BindingRegistry — explicit typed contract between HTML gen (analysis) and JS gen (emission).
 *
 * Currently the coupling between generateHtml() and generateClientJs() is
 * implicit: index.js creates two mutable arrays, passes them to generateHtml()
 * which populates them as a side effect, then passes the populated arrays to
 * generateClientJs(). This is the "implicit coupling" anti-pattern.
 *
 * BindingRegistry makes this contract explicit:
 * - Populated during HTML generation via addEventBinding() / addLogicBinding()
 * - Read-only during client JS emission via .eventBindings / .logicBindings
 *
 * Event bindings: { placeholderId, eventName, handlerName, handlerArgs, handlerExpr? }
 *   Recorded when HTML gen encounters a call-ref attribute (onclick=handler())
 *   or an expr attribute on an event (onclick=${() => fn(arg)}).
 *   Used by client JS gen to wire event listeners.
 *
 * Logic bindings: { placeholderId, expr, reactiveRefs?, isConditionalDisplay?, varName?, condExpr?, refs? }
 *   Recorded when HTML gen encounters:
 *   - A logic node embedded in markup (reactive display placeholder)
 *   - A variable-ref attribute value for if= (conditional display — simple var)
 *   - An expr attribute value for if= (conditional display — boolean expression)
 *   Used by client JS gen to wire reactive updates and conditional visibility.
 *
 *   Phase 4 addition: reactiveRefs (Set<string> | undefined)
 *     Pre-annotated by emit-html.js using extractReactiveDeps from reactive-deps.js.
 *     Contains the set of reactive variable names (without @ prefix) that the
 *     expression depends on. String-literal-aware — @var inside quoted strings is
 *     NOT included. When present, emit-event-wiring.js reads from this set instead
 *     of regex-scanning the expr string. When absent, the wiring falls back to regex.
 *
 *   If= expression support:
 *     condExpr (string | undefined) — raw expression string from if="..." or if=!@var
 *     refs (string[] | undefined)   — reactive variable names extracted from condExpr
 *     When condExpr + refs are present, emit-event-wiring subscribes to all refs and
 *     evaluates the compiled expression (with @var → _scrml_reactive_get("var")).
 *     When only varName is present, uses simple single-var display toggle (backward compat).
 *
 *   Phase 2g addition: if-chain branches and else
 *     Chain bindings carry a discriminator `kind`:
 *       - "if-chain-branch" — a positive branch (if= or else-if=)
 *       - "if-chain-else"   — the else branch
 *     Plus chain-shared fields: chainId, branchId, branchIndex (positive branches only),
 *     branchMode ("mount" | "display"), templateId? + markerId? (mount mode), and
 *     condition?/refs? (positive branches; condition.raw or condition.name yields
 *     the chain controller's per-branch test).
 *     placeholderId/expr are NOT used by chain bindings — they remain optional on
 *     the LogicBinding interface for backward compat with existing pre-Phase-2g bindings.
 */

/** An event binding recorded by HTML gen and consumed by client JS gen. */
export interface EventBinding {
  placeholderId: string;
  eventName: string;
  handlerName: string;
  handlerArgs: unknown[];
  /** Phase 4: structured ExprNode for each handler arg. */
  handlerArgExprNodes?: import("../types/ast.ts").ExprNode[];
  /** Raw expression handler from ${...} attribute values (e.g. "() => fn(arg)"). */
  handlerExpr?: string;
  /**
   * Bug 58 (S140) — formFor synthesized submit binding.
   *
   * Set on the onsubmit `call-ref` binding synthesized by `<formFor>` to the
   * compound cell name (e.g. `"signup"`). When present, the emitted submit
   * handler sets `@<cell>.submitted = true` BEFORE invoking the handler and
   * invokes the handler with the collected `values` (the compound cell value),
   * both per SPEC §41.14.3. Absent on hand-authored onsubmit bindings.
   */
  formForSubmitCell?: string;
  /**
   * Phase A10 (S78, 2026-05-10) — engine arm context tag.
   *
   * Set when this event binding was emitted while the registry was inside
   * an engine arm context (`pushArmContext(engineVarName, armTag)`). The
   * value is `"<engineVarName>:<armTag>"` (e.g. `"phase:Showing"`). Consumers
   * (`emit-event-wiring.ts`) skip arm-tagged bindings from global emission
   * because they are emitted PER-ARM by `emit-variant-guard.ts:emitArmWireFunction`,
   * which re-runs the wiring inside a function called from the engine
   * dispatcher AFTER each variant change's `innerHTML` replace.
   *
   * Absent on top-level / program-scope bindings.
   */
  engineArm?: string;
  /**
   * §5.2.2 row 5 (bare-ref form) — `onclick=handler` (no parentheses, no
   * `${...}`). Set when the event attribute value is a bare identifier
   * referencing a declared handler. Per SPEC §5.2.2: "`onclick=handler`
   * (no parentheses) SHALL wire `handler` directly as the event listener
   * without wrapping." `handlerName` holds the SOURCE name (e.g. `"bump"`);
   * `emit-event-wiring.ts` resolves it through `fnNameMap` to the encoded
   * `_scrml_<name>_N` and uses that reference DIRECTLY as the handler value
   * — NO `function(event){ fn(); }` wrapper (that is the OTHER, call-ref
   * `fn()` form). The wired listener receives the DOM event as its argument.
   * Absent on call-ref (`fn()`) and expression (`${}`) bindings.
   */
  bareRefHandler?: boolean;
}

/** A logic binding recorded by HTML gen and consumed by client JS gen. */
export interface LogicBinding {
  /**
   * Discriminator. Absent → conventional reactive/conditional binding (uses
   * placeholderId + expr). "if-chain-branch" → positive chain branch. "if-chain-else" →
   * else branch of an if-chain. "render-by-tag" → A1c C3 render-by-tag expansion site
   * (`<userName/>` in markup body resolves to a Shape 2 bindable cell, expanded inline
   * to the cell's renderSpec.element; this binding records the cell+renderSpec metadata
   * so C4 can emit the bind:value/bind:checked/bind:files/bind:group dispatch per
   * SPEC §5.4.1). "errors-element" → A1c C11 `<errors of=expr/>` first-class
   * element (SPEC §55.8 / L13). Records the source `errors` cell key + iteration
   * shape (per-field array vs compound rollup map) + optional body-override
   * arrow-function expression. emit-event-wiring consumes and emits subscribe +
   * per-iteration render.
   */
  kind?: "if-chain-branch" | "if-chain-else" | "render-by-tag" | "errors-element" | "render-element" | "class-directive" | "attr-template" | "bind-directive" | "value-control-flow" | "rcdata-content";

  /**
   * 6nz-F4 — RCDATA content-model carve-out (SPEC §24.3.1 companion, SPEC.md:1141).
   * Set when `kind === "rcdata-content"`. A reactive `${}` content interpolation
   * inside an RCDATA element (`<textarea>`) must NOT emit a
   * `<span data-scrml-logic>` placeholder — inside RCDATA the span is literal
   * text, not a mountable element (the F4 bug). Instead the element's concatenated
   * content is bound to its `.value` reactively (the one-way read-side of the
   * bind:value machinery). `rcdataParts` carries the ordered content parts:
   * static text runs (const-known / literal) and reactive expression parts.
   * emit-event-wiring locates the element via `data-scrml-rcdata="<placeholderId>"`
   * and wires `el.value = <concatenation>` inside an `_scrml_effect`.
   */
  rcdataParts?: Array<
    | { kind: "static"; text: string }
    | { kind: "expr"; expr: string; exprNode: any }
  >;

  // Conventional reactive / conditional binding fields.
  // Required for `kind === undefined` bindings (the default).
  // NOT used by chain bindings (kind === "if-chain-branch" | "if-chain-else").
  placeholderId?: string;
  expr?: string;
  reactiveRefs?: Set<string>;

  /**
   * inline-value-form-interp (§18.0 / §17.6) — set when `kind === "value-control-flow"`.
   *
   * A markup `${...}` interpolation whose SOLE content is a value-producing
   * control-flow construct — a JS-style `match expr { .A :> v … }` over a
   * scrutinee, or an `if cond { a } else { b }` cascade — is a value EXPRESSION
   * (a match/if-as-expression), not a discarded statement. `controlFlowNode`
   * carries the raw `match-stmt` / `if-stmt` AST node; emit-event-wiring lowers
   * it to the value-returning form (emit-control-flow.ts: `emitMatchExpr` IIFE /
   * `emitIfValueExpr` ternary cascade), renders the selected value into the
   * `placeholderId` slot via `_scrml_render_value`, and (when the lowered value
   * reads any reactive cell) wires an `_scrml_effect` so the slot re-renders on
   * scrutinee/condition change — the inline analogue of the derived-cell twin
   * (`const <d> = match …; ${@d}`) without the intermediate named cell.
   */
  controlFlowNode?: any;
  /**
   * §6.7.7 — the binding expr reads a `<#id>` ref whose id names a `<request>`
   * (reactive `_scrml_request_<id>` deep-reactive Proxy). Forces the
   * `_scrml_effect`-wrapped path in emit-event-wiring even with no `@var` dep.
   */
  hasRequestRef?: boolean;
  isConditionalDisplay?: boolean;
  isVisibilityToggle?: boolean;

  /**
   * S105 B1 — reactive Boolean HTML attribute binding.
   *
   * When set, the binding wires a reactive `${expr}` to a known HTML Boolean
   * attribute (`disabled`, `readonly`, `required` in v0.3; extensible).
   * `boolAttrName` carries the attribute name (e.g. `"disabled"`). The
   * runtime path emits an `_scrml_effect` that toggles the attribute's
   * presence (`setAttribute(name, "")` on truthy / `removeAttribute(name)`
   * on falsy).
   *
   * Closes the §41.14 formFor follow-on (`disabled=!@form.isValid` on the
   * default submit button); also unlocks general adopter use of
   * `<input disabled=${@busy}>`, `<input readonly=${@locked}>`, etc.
   */
  isReactiveBoolAttr?: boolean;
  boolAttrName?: string;

  /**
   * i81 — reactive VALUE attribute binding (`class=`, `style=`, `title=`,
   * `data-*`, `id=`, `alt=`, …).
   *
   * The counterpart to `isReactiveBoolAttr`, and a DIFFERENT lowering — do not
   * conflate the two. A BOOLEAN attr toggles *presence* (truthiness →
   * `setAttribute(name, "")` / `removeAttribute(name)`). A VALUE attr sets a
   * *string* (`setAttribute(name, String(v))`), and its removal is driven by
   * ABSENCE, not falsiness. `valueAttrName` carries the attribute name.
   *
   * Semantics (SPEC §42.1.1 + §42.9 — NOT truthiness):
   *   `not` (→ JS `null`) / `undefined`  → `removeAttribute(name)`
   *   `""` / `0` / `false` / `[]`        → `setAttribute(name, String(v))`
   * `""`, `0`, `false`, `[]` are DEFINED values in scrml, not absence; §42.1.1
   * declares treating them as absence a SEMANTIC ERROR. The absence test is the
   * SPEC's own `is not` lowering, `(v === null || v === undefined)` (§42.9 —
   * both, because foreign code may produce either).
   *
   * Closes issue #81: before this, the `val.kind === "expr"` dispatch chain in
   * emit-html.ts ended after the bool-attr branch with no final `else`, so a
   * dynamic value attribute outside `<each>` matched nothing and was SILENTLY
   * dropped from the emitted HTML (clean compile, 0 diagnostics).
   */
  isReactiveValueAttr?: boolean;
  valueAttrName?: string;

  /**
   * Phase 2c: when set, the `if=` binding uses mount/unmount semantics
   * (template-clone on true, scope-destroy + DOM-remove on false) instead of
   * display-toggle. The compile-time emitter populates `templateId` and
   * `markerId` so the runtime can locate the <template> source and the
   * <!--scrml-if-marker:N--> insertion point.
   */
  isMountToggle?: boolean;
  templateId?: string;
  markerId?: string;

  /**
   * Phase 2g: chain-binding fields.
   * Required when `kind === "if-chain-branch"` or `kind === "if-chain-else"`.
   *
   *   chainId      — stable id for the chain group (e.g. "_scrml_if_chain_3").
   *   branchId     — stable id for this branch (e.g. "_scrml_if_chain_3_b0" or
   *                  "_scrml_if_chain_3_else"). Used by the chain controller to
   *                  identify the active branch and to look up its per-branch state.
   *   branchIndex  — 0-based index of positive branches (if + else-if siblings).
   *                  Absent on the else branch.
   *   branchMode   — "mount" (clean — emits <template> + scrml-if-marker; controller
   *                  mount/unmount via _scrml_mount_template / _scrml_unmount_scope) or
   *                  "display" (dirty — emits per-branch wrapper with style="display:none";
   *                  controller toggles wrapper.style.display).
   *   condition    — chain branch condition AST node (variable-ref or expr). Absent on
   *                  the else branch. The chain controller in emit-event-wiring uses
   *                  condition.raw (expr) or condition.name (variable-ref) to emit the
   *                  per-branch test.
   *   refs         — reactive variable names referenced by `condition` (without @ prefix).
   *                  Used by the chain controller for reactive subscription. Absent on
   *                  the else branch.
   */
  chainId?: string;
  branchId?: string;
  branchIndex?: number;
  branchMode?: "mount" | "display";
  condition?: any;
  refs?: string[];

  /**
   * A1c C3 — render-by-tag expansion fields.
   * Required when `kind === "render-by-tag"`.
   *
   *   cellName        — the source-level cell name (`"userName"`, `"agree"`, …) — what
   *                     C4 binds reactively. Same as the resolved tag name at the
   *                     `<cellName/>` use site.
   *   renderSpecTag   — the expanded element's tag (`"input"`, `"textarea"`, `"select"`).
   *                     Drives §5.4.1 bind-dispatch (text-shape `<input>` → bind:value;
   *                     `<input type="checkbox"/>` → bind:checked; etc).
   *   renderSpecAttrs — the renderSpec.element's attributes array (kept verbatim from
   *                     the cell's decl-site). C4 reads `type=...` etc to refine the
   *                     bind: flavour. Validator-derived HTML attrs are NOT included
   *                     here; they're emitted to the DOM directly via the markup AST.
   *   declValidators  — the cell's validator entries (B9 contract). C4/C7+ may consume
   *                     for validity-surface wiring. Optional; absent in test fixtures
   *                     that bypass SYM.
   */
  cellName?: string;
  renderSpecTag?: string;
  renderSpecAttrs?: any[];
  declValidators?: any[];

  /**
   * A1c C11 — `<errors of=expr/>` element fields.
   * Required when `kind === "errors-element"`.
   *
   *   anchorId        — the placeholder anchor id stamped into the
   *                     `<span data-scrml-errors-anchor="...">` HTML hookpoint.
   *                     The runtime locates the anchor via this id and replaces
   *                     its `innerHTML` on each render.
   *   errorsKey       — the source errors cell's storage key WITHOUT the trailing
   *                     `.errors` suffix. e.g. `of=@signup.name` → `"signup.name"`,
   *                     `of=@signup` → `"signup"`. emit-event-wiring appends
   *                     `.errors` and applies encodingCtx.encode().
   *   isCompoundRollup — `true` when `of=` is a compound (no dot path past the
   *                      compound-root) so the source `errors` is an object map
   *                      `{field: [tags]}`. `false` for per-field (`errors` is an
   *                      array of tags).
   *   allFlag         — `true` when the `all` attribute is present on the element.
   *                     Default false → render first error only.
   *   fieldName       — for per-field iteration, the source field name (passed as
   *                     the second arg to `_scrml_message_for(tag, fieldName)`).
   *                     For compound rollup, undefined — `messageFor` is called
   *                     per-(field, tag) pair using the iterated key.
   *   bodyExpr        — raw arrow-function-shaped body when the element has a
   *                     body-override (`${(err) => <markup>}`). Replaces the
   *                     default `<p class="scrml-error">` render. Optional.
   *   bodyExprNode    — structured ExprNode form of `bodyExpr`. Optional.
   */
  anchorId?: string;
  errorsKey?: string;
  isCompoundRollup?: boolean;
  allFlag?: boolean;
  fieldName?: string;
  bodyExpr?: string;
  bodyExprNode?: any;

  /**
   * render-expr-primitive — `<render of=X/>` element fields (SPEC §19.x).
   * Required when `kind === "render-element"`.
   *
   *   anchorId            — the placeholder anchor id stamped into the
   *                         `<span data-scrml-render-anchor="...">` HTML
   *                         hookpoint. The runtime locates the anchor via this
   *                         id and replaces its `innerHTML` with the held
   *                         value's variant `renders` markup.
   *   renderHeldAccessor  — the JS expression that yields the HELD enum value at
   *                         runtime. For a `<match>`/engine arm payload binding
   *                         (`<render of=err/>`) this is the plain JS identifier
   *                         (`err`) — in scope inside the arm render/wire fn the
   *                         binding is tagged with via `engineArm`. For an
   *                         `@cell` (`<render of=@phase/>`) this is
   *                         `_scrml_reactive_get("phase")` (or a dotted walk for
   *                         `@compound.field`).
   *   renderHeldSubscribe — for the `@cell` form, the root cell name to
   *                         `_scrml_reactive_subscribe` on so the render re-fires
   *                         when the held value changes. Undefined for a local
   *                         arm-payload binding (the arm dispatcher re-runs the
   *                         render fn on variant change, re-firing the render).
   *   renderVariantExprs  — variant name -> JS string expr producing that
   *                         variant's `renders` markup, with the held value's
   *                         `.data` substituted as the payload source. Built via
   *                         the same `compileBoundaryMarkup` + `emitBoundaryMarkupExpr`
   *                         the `<errorBoundary>` path uses (firing-site + data-arg
   *                         differ; SIDESTEPS the `__scrml_error` envelope gate).
   */
  renderHeldAccessor?: string;
  renderHeldSubscribe?: string;
  renderVariantExprs?: Record<string, string>;

  /**
   * g-match-arm-reactive-attr-effects (S212) — class:/attr-template directive
   * fields, registered ONLY when the directive sits inside a `<match>` arm body
   * (the registry has an active arm context). Required when
   * `kind === "class-directive"` or `kind === "attr-template"`.
   *
   * The top-level (non-arm) path wires these directly from the markup AST in
   * emit-bindings.ts (via collectMarkupNodes). collectMarkupNodes never descends
   * into match arm bodies (they live in armsRaw/bodyChildren, not node.children),
   * so an arm-body class:/attr-tpl placeholder was emitted into the arm-render
   * HTML string with NO `_scrml_effect` to resolve it — a dead binding. These
   * fields let emitArmWireFunction (emit-variant-guard.ts) re-emit the same
   * `_scrml_effect` wiring per-mount against the arm `_root`, mirroring how the
   * text-logic / event bindings are re-wired on variant change.
   *
   *   directiveSelector — the `[data-scrml-...="<id>"]` querySelector the wire fn
   *                       runs against `_root` to find the directive's element.
   *   className         — for `class-directive`: the class name to toggle.
   *   attrName          — for `attr-template`: the attribute name to set.
   *   directiveJsExpr   — the lowered JS expression (already
   *                       `_scrml_reactive_get(...)`-rewritten). class-directive:
   *                       the boolean condition. attr-template: the template
   *                       literal producing the attribute string value.
   *   directiveRefs     — reactive cell names referenced by directiveJsExpr (sans
   *                       `@`). Non-empty → emit the `_scrml_effect`; empty →
   *                       apply once at mount (no reactive subscription).
   */
  directiveSelector?: string;
  className?: string;
  attrName?: string;
  directiveJsExpr?: string;
  directiveRefs?: string[];

  /**
   * Family-A convergence (HALF 1, 2026-06-23) — `bind:*` directive fields,
   * registered ONLY when the bind: sits inside a `<match>` arm / `<engine>`
   * state-child body (the registry has an active arm context). Required when
   * `kind === "bind-directive"`.
   *
   * Same drop-class as the S212 class-/attr-template directives: the top-level
   * emit-bindings.ts pass walks `collectMarkupNodes`, which never descends into
   * arm bodies, so a `bind:value=@cell` on an input inside an arm body emitted
   * its `data-scrml-bind-value` placeholder with NO querySelector + listener +
   * `_scrml_effect` wiring — typed input was silently dropped
   * (`g-bindvalue-wiring-dropped-in-match-arm`, HIGH).
   *
   * Unlike class:/attr-template (whose lowered JS expr is pre-computed at
   * registration time), the bind:* lowering is element-shape-dependent (enum
   * <select> coercion, numeric coercion, §53.7.2 predicate gating) and needs
   * the markup node + the file-level enum/type maps. So this binding carries
   * the raw `bindAttr` + `bindNode` references; `emitArmWireFunction`
   * (emit-variant-guard.ts) feeds them to the shared `emitBindDirectiveBody`
   * (emit-bindings.ts) with a `_root`-rooted acquire + a `_disposers` effect
   * sink — the exact same lowering the top-level path uses.
   *
   *   bindAttr — the `bind:*` Attr node (carries `_bindId`, `.value`, `_flatBindKey`).
   *   bindNode — the markup element the directive sits on (carries `tag` + `attributes`
   *              for the <select>/numeric/type dispatch).
   */
  bindAttr?: any;
  bindNode?: any;
  /**
   * The per-render `bindId` (the `data-scrml-bind-*` placeholder id) emitted
   * into the arm-body HTML alongside this binding. Pinned at registration
   * time because the engine renders a state-child body through generateHtml
   * more than once (static initial-mount HTML + arm render fn), each minting
   * a fresh id — `attr._bindId` is sticky from the first render and would
   * diverge from the HTML this binding belongs to. emitArmWireFunction passes
   * this as the acquire-selector override.
   */
  bindIdForArm?: string;

  /**
   * Phase A10 (S78, 2026-05-10) — engine arm context tag.
   *
   * Set when this logic binding was emitted while the registry was inside
   * an engine arm context (`pushArmContext(engineVarName, armTag)`). Value
   * is `"<engineVarName>:<armTag>"` (e.g. `"phase:Showing"`). Consumers
   * (`emit-event-wiring.ts`) skip arm-tagged bindings from global emission
   * because they are emitted PER-ARM by `emit-variant-guard.ts:emitArmWireFunction`.
   *
   * Absent on top-level / program-scope bindings.
   */
  engineArm?: string;

  /**
   * errorBoundary (SPEC §19.6 + §19.6.8) — boundary-context fields.
   *
   * Set when this logic binding's `${...}` interpolation sits inside an
   * `<errorBoundary>` subtree. emit-event-wiring.ts consumes these to emit the
   * markup-context error dispatch + the C-hybrid host-JS backstop instead of a
   * plain `el.textContent = expr` write:
   *
   *   - boundaryId             — the boundary's stable id (the
   *                              `data-scrml-error-boundary` attr value). Used
   *                              for diagnostics / logging context (§19.6.8 B5).
   *   - boundaryFallbackExpr   — JS string expression for the boundary's
   *                              `fallback=` markup HTML (from
   *                              emitBoundaryMarkupExpr). "" when no `fallback`.
   *   - boundaryVariantRenders — map of error-variant name -> JS string
   *                              expression for that variant's `renders` markup
   *                              HTML (§19.2). The typed path (§19.6.3) prefers a
   *                              variant's own renders over the fallback. Each
   *                              expression references `_eb_result.data` for
   *                              payload-field substitution.
   *   - boundaryHasFallback    — whether the boundary declares a `fallback=`.
   *                              When false and no variant renders matches, the
   *                              error re-propagates (§19.6.8 B3) — at runtime
   *                              the backstop re-throws so an enclosing
   *                              boundary's backstop catches it.
   */
  boundaryId?: string;
  boundaryFallbackExpr?: string;
  boundaryVariantRenders?: Record<string, string>;
  boundaryHasFallback?: boolean;

  /**
   * ss20 item-1 (g-if-guard-inner-effect-not-gated) — stamped by emit-html.ts
   * when this `${...}` interpolation binding sits inside an `if=` DISPLAY-TOGGLE
   * subtree (NOT the clean-subtree mount/unmount path; NOT `show=`). Carries the
   * enclosing if='s guard fields (same shape the toggle binding stores:
   * condExpr/condExprNode for `if=(...)`/`if=fn()`, or varName/dotPath for
   * `if=@var`). emit-event-wiring lowers it via the shared
   * computeDisplayToggleCondition helper (lockstep with the toggle) and gates
   * the inner effect on it — the effect body short-circuits while the guard is
   * false, preventing a `null.field` crash on mount when the guarded cell starts
   * absent.
   */
  ifGuard?: {
    condExpr?: string;
    condExprNode?: any;
    refs?: string[];
    varName?: string;
    dotPath?: string;
    /**
     * ss21 item-3 (g-if-chain-branch-display-null-interp) — set instead of the
     * single-`if=` fields when this `${...}` interpolation sits inside an
     * if-CHAIN branch (if=/else-if=/else). `own` is the branch's own condition
     * (undefined for the else); `priors` is every prior positive branch
     * condition. emit-event-wiring lowers these to the branch's `_next ===
     * branchId` visibility predicate (priors-false AND own-true; else =
     * all-priors-false), byte-identical to the chain controller — so the inner
     * effect short-circuits while the branch is HIDDEN, preventing a
     * `null.field` crash on mount when the guarded cell starts absent.
     */
    chainGuard?: { own?: any; priors?: any[] };
  };
}

export class BindingRegistry {
  private _eventBindings: EventBinding[];
  private _logicBindings: LogicBinding[];
  /**
   * Phase A10 (S78, 2026-05-10) — engine arm context stack.
   *
   * Each entry is a string `"<engineVarName>:<armTag>"` (e.g. `"phase:Showing"`).
   * `addEventBinding` / `addLogicBinding` stamp the top of the stack onto
   * each new entry's `engineArm` field, allowing downstream emitters to
   * discriminate program-scope bindings from arm-body bindings.
   *
   * Stack-shaped (not single-slot) to support nested engines per §51.0.Q
   * — though arm-body emission currently does not recurse into nested
   * engine bodies for re-wiring (nested engine has its own dispatcher).
   * The innermost arm context is the one stamped (top of stack).
   */
  private _armContextStack: string[];

  constructor() {
    this._eventBindings = [];
    this._logicBindings = [];
    this._armContextStack = [];
  }

  /**
   * Record an event binding — emitted by HTML gen when a call-ref or expr
   * attribute is encountered on an event attribute (onclick, onsubmit, etc.).
   *
   * Phase A10: stamps `engineArm` from the top of the arm-context stack
   * when non-empty.
   */
  addEventBinding(entry: EventBinding): void {
    if (this._armContextStack.length > 0 && entry.engineArm == null) {
      entry.engineArm = this._armContextStack[this._armContextStack.length - 1];
    }
    this._eventBindings.push(entry);
  }

  /**
   * Record a logic binding — emitted by HTML gen when a reactive display placeholder
   * or conditional display binding is encountered.
   *
   * Phase A10: stamps `engineArm` from the top of the arm-context stack
   * when non-empty.
   */
  addLogicBinding(entry: LogicBinding): void {
    if (this._armContextStack.length > 0 && entry.engineArm == null) {
      entry.engineArm = this._armContextStack[this._armContextStack.length - 1];
    }
    this._logicBindings.push(entry);
  }

  /**
   * Phase A10 (S78, 2026-05-10) — push an engine arm context onto the
   * stack. Subsequent `addEventBinding` / `addLogicBinding` calls stamp
   * the pushed context onto each new entry's `engineArm` field. The
   * caller MUST `popArmContext()` on the symmetric path; missing pops
   * leak context to siblings (which would mistakenly skip global wiring
   * emission for them).
   *
   * Used by `emit-variant-guard.ts:emitArmRenderFunction` and
   * `emit-engine.ts:emitEngineMountHtml` (via `emitInitialArmHtmlForMount`)
   * to scope the bindings created during arm-body HTML generation.
   *
   * Format: `"<engineVarName>:<armTag>"` (e.g. `"phase:Showing"`).
   */
  pushArmContext(armId: string): void {
    this._armContextStack.push(armId);
  }

  /**
   * Phase A10 — pop the topmost engine arm context. Symmetric with
   * `pushArmContext`. Does nothing when the stack is empty (defensive;
   * paired calls are guaranteed by the helper sites).
   */
  popArmContext(): void {
    this._armContextStack.pop();
  }

  /**
   * A5-6 Feature 1 (S79) — read the topmost arm context, or null if not
   * inside an engine state-child arm. Used by `emit-expr.ts:emitCall` to
   * recognize `cancelTimer("X")` calls and lower them to
   * `_scrml_engine_clear_named_timer("<varName>", "<armTag>", "X")`.
   * Format: `"<engineVarName>:<armTag>"` (matches `pushArmContext`).
   */
  get currentArmContext(): string | null {
    if (this._armContextStack.length === 0) return null;
    return this._armContextStack[this._armContextStack.length - 1] ?? null;
  }

  /** All event bindings. Read-only during emission. */
  get eventBindings(): EventBinding[] {
    return this._eventBindings;
  }

  /** All logic bindings. Read-only during emission. */
  get logicBindings(): LogicBinding[] {
    return this._logicBindings;
  }

  /**
   * Factory: create a BindingRegistry pre-populated with event and logic bindings.
   * Primarily used by tests that construct binding arrays directly.
   */
  static from(eventBindings: EventBinding[] = [], logicBindings: LogicBinding[] = []): BindingRegistry {
    const reg = new BindingRegistry();
    for (const eb of eventBindings) reg.addEventBinding(eb);
    for (const lb of logicBindings) reg.addLogicBinding(lb);
    return reg;
  }
}
