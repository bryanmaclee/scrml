/* SPDX-License-Identifier: MIT
 *
 * S130 HU-1 iteration Landing 1 — `<each>` element codegen (SPEC §17.X NEW).
 *
 * Mirrors the engine-decl + match-block codegen pattern:
 *   - emitEachMountHtml(node, ctx)      — per-each static placeholder in HTML
 *   - emitEachBodyRenderForFile(...)    — per-each render function + dispatcher
 *
 * Per Q3 RE-RATIFICATION, per-item element openers admit SPEC §4.14
 * `:`-shorthand body for single-expression bodies. The template walk
 * inside `templateChildren` honors both bare-body and `:`-shorthand
 * per-item element shapes.
 *
 * Two iteration shapes per Q6 ratification:
 *   - <each in=@cell ...>  — collection iteration (subscribes to @cell)
 *   - <each of=N ...>      — count iteration (range emission; @. = index)
 *
 * The optional `<empty>` sub-element (per Q4 ratification) provides
 * fallback content rendered when the collection is empty or count is 0.
 *
 * The optional `as name` override (per Q6 ratification) binds the current
 * iteration value to a meaningful name in the body scope (aliased with @.).
 *
 * `key=` inference (per Q5 ratification):
 *   - Items with a `.id` field → auto-infer `key=item.id`
 *   - No-id items → W-EACH-KEY-001 info-lint at lint stage; runtime falls
 *     back to positional index
 *   - <each of=N> defaults to `key=@.` (the index itself)
 *   - Explicit `key=expr` overrides; `key=__index__` is the canonical
 *     suppress-lint sentinel for "positional intentional"
 *
 * Runtime primitives consumed (existing — runtime-template.js):
 *   - `_scrml_reconcile_list(container, items, keyFn, createFn)` — keyed
 *     list reconciliation
 *   - `_scrml_effect_static(fn)` — fire on dep change
 *   - `_scrml_reactive_get(name)` — read cell with auto-dep-tracking
 */

import type { CompileContext } from "./context.ts";

// ---------------------------------------------------------------------------
// AST shape (each-block) — mirrors ast-builder.js dispatch output
// ---------------------------------------------------------------------------

interface EachBlockAstNode {
  id: number;
  kind: "each-block";
  iterShape: "in" | "of" | null;
  inExprRaw: string | null;
  ofExprRaw: string | null;
  asName: string | null;
  keyExprRaw: string | null;
  bodyChildren: any[];      // full walkable body AST (includes <empty>)
  templateChildren: any[];  // bodyChildren minus the <empty> sub-element
  emptyChild: any | null;   // the <empty> sub-element node, or null
  bodyRaw: string;
  span: any;
  openerHadSpaceAfterLt?: boolean;
  /**
   * R28-1b-analogue (each-in-enclosing-scope, S153) — set by collectEachBlocks
   * when this each-block is nested inside ANOTHER each's per-item template
   * (templateChildren). A nested each's iteration source (e.g. `g.items`) and
   * its `@.`-body reference the OUTER each's iter var, which is bound ONLY inside
   * the outer per-item factory — never at module scope. So a nested each gets NO
   * module-scope render fn / dispatcher (emitEachBodyRenderForFile skips it); it
   * is emitted ENTIRELY INLINE inside the outer factory by renderTemplateChildToJs's
   * each-block branch. (Distinct from the match case, whose render fns ARE
   * item-agnostic and CAN stay module-scope — only the trigger is suppressed.)
   */
  isNested?: boolean;
  /** The OUTER each's iter var name (set alongside isNested). */
  enclosingEachIterVar?: string | null;
}

// ---------------------------------------------------------------------------
// Walker — collect each-block nodes from anywhere in the file AST
// ---------------------------------------------------------------------------

/**
 * Recursive walker that returns every each-block AST node in the file.
 * Each-blocks can appear inside pages, components, engine arm bodies,
 * match arm bodies, other each-blocks (nested iteration is legal — outer
 * `as name` makes inner `@.` disambiguate-able).
 */
export function collectEachBlocks(fileAST: any): EachBlockAstNode[] {
  const found: EachBlockAstNode[] = [];
  const seen = new WeakSet<object>();
  // `enclosingEachIterVar` carries the OUTER each's iter var when the walk is
  // currently INSIDE another each's per-item template (templateChildren). It is
  // null at file scope and inside an <empty> body (not iter-scoped). When an
  // each-block is reached with a non-null enclosing iter var, it is NESTED:
  // emitEachBodyRenderForFile must NOT emit a module-scope render fn for it
  // (its source + @. reference the outer iter var, bound only in the outer
  // factory). renderTemplateChildToJs's each-block branch emits it inline.
  function walk(node: any, enclosingEachIterVar: string | null): void {
    if (!node || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const n of node) walk(n, enclosingEachIterVar);
      return;
    }
    if (node.kind === "each-block") {
      // Stamp nesting state (idempotent across re-walks). A non-null enclosing
      // iter var means this each lives inside another each's per-item template.
      (node as EachBlockAstNode).enclosingEachIterVar = enclosingEachIterVar;
      (node as EachBlockAstNode).isNested =
        typeof enclosingEachIterVar === "string" && enclosingEachIterVar.length > 0;
      found.push(node as EachBlockAstNode);
      // Entering THIS each's per-item template establishes a NEW iter scope: any
      // each nested in templateChildren is iter-scoped to THIS each's iter var
      // (asName override or the synthetic default — mirrors emit-each.ts
      // iterVarName resolution + collectMatchBlocks at emit-match.ts:132).
      const innerIterVar =
        (typeof node.asName === "string" && node.asName.length > 0)
          ? node.asName
          : "_scrml_each_item";
      if (Array.isArray(node.templateChildren)) walk(node.templateChildren, innerIterVar);
      // <empty> body is NOT iter-scoped (renders when the collection is empty,
      // outside any per-item context) — descend with a null enclosing iter var.
      if (node.emptyChild) walk(node.emptyChild, null);
      // bodyChildren shares node refs with templateChildren (now seen-guarded);
      // descend with the OUTER enclosing var for any node reachable only here.
      if (Array.isArray(node.bodyChildren)) walk(node.bodyChildren, enclosingEachIterVar);
      return;
    }
    // Recurse into known container fields. Mirror engine-decl + match-block
    // descent shape. Arm bodies / if-bodies / engine bodies are NOT a new
    // iteration scope, so the enclosing each iter var carries through unchanged.
    for (const key of ["children", "body", "bodyChildren", "nodes", "arms", "templateChildren"]) {
      if (Array.isArray((node as any)[key])) walk((node as any)[key], enclosingEachIterVar);
    }
  }
  // Accept BOTH `fileAST.nodes` (test shape) AND `fileAST.ast.nodes`
  // (pipeline shape) — mirrors collectMatchBlocks pattern at
  // emit-match.ts:118.
  walk(fileAST.nodes ?? fileAST.ast?.nodes ?? fileAST.children ?? fileAST, null);
  return found;
}

// ---------------------------------------------------------------------------
// HTML mount slot emission
// ---------------------------------------------------------------------------

/**
 * Emit a static placeholder `<div data-scrml-each-mount="each_<id>"></div>`
 * at the `<each>`'s source position in HTML output. The runtime dispatcher
 * (emit-each-body-render below) writes the rendered iteration into this
 * slot on subscription fire.
 *
 * Returns "" when the each-block has no per-item template content (rare —
 * structurally requires at least one templateChild OR an emptyChild).
 */
export function emitEachMountHtml(node: EachBlockAstNode, _ctx: CompileContext): string {
  if (!node || node.kind !== "each-block") return "";
  // Tree-shake: empty each-block (no template, no empty) renders nothing.
  if ((!Array.isArray(node.templateChildren) || node.templateChildren.length === 0) && !node.emptyChild) {
    return "";
  }
  return `<div data-scrml-each-mount="each_${node.id}"></div>`;
}

// ---------------------------------------------------------------------------
// Per-item template rendering — converts the templateChildren AST into
// JS that builds DOM nodes for one item.
// ---------------------------------------------------------------------------

/**
 * Serialize a single template-child AST node into JS that constructs the
 * corresponding DOM element. Handles three opener shapes:
 *   1. Bare-body `<tag attrs>...</tag>` — recursively emits children.
 *   2. `:`-shorthand `<tag attrs : expr>` — emits one expression as
 *      textContent. (Captured by ast-builder as a markup node whose
 *      body is unparseable; we detect by checking node.raw for the
 *      `:`-shorthand opener pattern.)
 *   3. Self-closing `<tag attrs/>` — emits a leaf element.
 *
 * For the Landing-1 baseline this produces sufficient JS to render the
 * common cases shown in the HU canonical examples. Edge cases (nested
 * iteration, complex interpolation in attribute values) defer to the
 * generic markup-emit helpers in emit-html / emit-lift.
 *
 * `iterVarName` is the name the per-item iteration value is bound to in
 * the body scope (default "_scrml_each_item" + the `as name` override).
 * `iterIdxName` is the index variable (always "_scrml_each_idx").
 *
 * Per HU-1 Q6, `@.` is the contextual sigil for "the current iteration
 * value." Inside an `in=` form `@.` = current item; inside an `of=` form
 * `@.` = current index. The body-text rewrite step at the bottom of
 * this function substitutes `@.` and the optional `as name` with the
 * runtime-iteration-variable binding.
 */
function renderTemplateChildToJs(
  child: any,
  iterVarName: string,
  _iterIdxName: string,
  fragmentVar: string,
  lines: string[],
  indent: string,
): void {
  if (!child || typeof child !== "object") return;

  // Text children are typically whitespace-only — skip empty / WS-only runs.
  if (child.kind === "text") {
    const txt = String((child as any).value ?? (child as any).text ?? "");
    if (!txt.trim()) return;
    // Non-empty literal text: rewrite `@.` to iterVar, then emit as text node.
    const rewritten = rewriteContextualSigil(txt, iterVarName);
    lines.push(`${indent}${fragmentVar}.appendChild(document.createTextNode(${JSON.stringify(rewritten)}));`);
    return;
  }

  // Markup node — render via createElement.
  if (child.kind === "markup") {
    const tagName = String((child as any).tag ?? (child as any).name ?? "div");
    const raw = String((child as any).raw ?? "");

    // R25-Bug-40 — SPEC §4.14 `:`-shorthand body detection.
    //
    // Two recognition paths:
    //   (a) Authoritative: BS+ast-builder sets `closerForm:"shorthand"`
    //       and `shorthandBodyRaw` (the body expression text) on the
    //       markup AST node. Prefer this when present — no regex re-scan.
    //   (b) Fallback: regex scan over raw (`detectShorthandOpener` /
    //       `extractShorthandExpr`). Maintained for any pre-S136 caller
    //       path that may surface a markup node WITHOUT the explicit
    //       fields (e.g., a future native-parser route that doesn't
    //       populate shorthandBodyRaw on each-block templateChildren).
    const closerForm = (child as any).closerForm;
    const explicitBody = (child as any).shorthandBodyRaw;
    let isShorthand: boolean;
    let shorthandExpr: string | null;
    if (closerForm === "shorthand" && typeof explicitBody === "string") {
      isShorthand = true;
      shorthandExpr = explicitBody;
    } else {
      isShorthand = detectShorthandOpener(raw);
      shorthandExpr = isShorthand ? extractShorthandExpr(raw) : null;
    }

    const elVar = `_scrml_el_${nextLocalId()}`;
    lines.push(`${indent}const ${elVar} = document.createElement(${JSON.stringify(tagName)});`);

    // S130 HU-1 iteration Landing 2 — per-item element attribute codegen.
    //
    // Landing 1 copied EVERY attribute as an inert literal string
    // (`setAttribute(name, "")`), which silently dropped event handlers
    // (no addEventListener), `class:` bindings (no classList toggle), and
    // literalized `${...}` interpolations to the source text. Landing 2
    // emits real per-item wiring on the freshly-created element, mirroring
    // the lowering shapes the top-level codegen produces (emit-bindings.ts
    // class: toggle, emit-event-wiring.ts addEventListener) but INLINE on
    // `elVar` — the per-item factory builds DOM imperatively, so there is no
    // static-HTML placeholder + querySelector handoff. The each render fn
    // re-runs on collection change via `_scrml_effect_static`, so each item's
    // class:/interpolation re-evaluates against its current value per render
    // (same re-dispatch model the per-item match-block already uses).
    const attrs: any[] = (child as any).attributes ?? (child as any).attrs ?? [];
    for (const attr of attrs) {
      renderTemplateAttrToJs(attr, iterVarName, _iterIdxName, elVar, lines, indent);
    }

    if (isShorthand && shorthandExpr !== null) {
      // `:`-shorthand body — single-expression body becomes textContent.
      // Rewrite `@.` to iterVar so `<li : @.name>` → `item.name`.
      const exprRewritten = rewriteContextualSigil(shorthandExpr, iterVarName);
      // Cast result to string for textContent assignment.
      lines.push(`${indent}${elVar}.textContent = String(${exprRewritten});`);
    } else if (Array.isArray((child as any).children) && (child as any).children.length > 0) {
      // Bare-body — recurse into children.
      const innerFragVar = `_scrml_frag_${nextLocalId()}`;
      lines.push(`${indent}const ${innerFragVar} = document.createDocumentFragment();`);
      for (const grand of (child as any).children) {
        renderTemplateChildToJs(grand, iterVarName, _iterIdxName, innerFragVar, lines, indent);
      }
      lines.push(`${indent}${elVar}.appendChild(${innerFragVar});`);
    }
    // self-closing: no body.

    lines.push(`${indent}${fragmentVar}.appendChild(${elVar});`);
    return;
  }

  // Logic child `${...}` — emit as textNode of the expression value.
  // ast-builder produces logic nodes with .body[] of statements; for
  // single-expression `${expr}` the body has one bare-expr whose `expr`
  // field carries the (tokenizer-rejoined) expression text. Fall back to
  // raw scan if body[] is unavailable.
  if (child.kind === "logic") {
    let inner = "";
    const body: any[] = (child as any).body ?? [];
    if (body.length > 0 && body[0]) {
      const stmt = body[0];
      // bare-expr is the common shape; lift-expr / fail-expr / etc. exist
      // but are less common in iteration body context. For Landing 1
      // baseline, route bare-expr through; other shapes get a hint.
      if (stmt.kind === "bare-expr") {
        // `expr` is the tokenizer-rejoined text — strip the extra spaces
        // around `.` operators introduced by the tokenizer for readability.
        inner = String(stmt.expr ?? "").replace(/\s*\.\s*/g, ".");
      } else if (typeof stmt.raw === "string") {
        inner = stmt.raw;
      } else {
        inner = "";
      }
    } else if (typeof (child as any).raw === "string") {
      // Fallback to raw text — strip `${...}` framing if present.
      const raw = String((child as any).raw ?? "");
      const m = raw.match(/^\s*\$\{\s*([\s\S]*?)\s*\}\s*$/);
      inner = m ? m[1] : raw;
    }
    if (!inner) {
      lines.push(`${indent}// each: empty logic interpolation skipped`);
      return;
    }
    // Rewrite `@.` → iter var; rewrite `@cell` → reactive_get; pass through
    // bare idents (`contact.name` etc. — the iter var binding is the for-arg
    // of the factory closure).
    let rewritten = rewriteContextualSigil(inner, iterVarName);
    rewritten = rewriteAtCellAccess(rewritten);
    lines.push(`${indent}${fragmentVar}.appendChild(document.createTextNode(String(${rewritten})));`);
    return;
  }

  // R28-1b (S143) — block-form `<match>` that is a child of this each's body.
  // SPEC §17.7.3 + §18.0.1. Pre-fix this fell through to the unhandled-kind
  // comment (the per-item match was DROPPED) while a phantom module-scope
  // dispatcher referenced the per-item iter var at top level (undefined).
  //
  // emit-match.ts emits the render fns + wire fns (item-agnostic, module-scope)
  // and an ITEM-SCOPED dispatch fn `__scrml_match_match_<id>_dispatch(_mount, _v)`
  // (no module-scope trigger; see emit-variant-guard.ts itemScopedDispatch).
  // Here we render the match PER ITEM: create an item-local mount element,
  // append it to the item fragment, and dispatch on THIS item's discriminant
  // (`@.status` → `<iterVar>.status`, valid in the factory scope where the
  // iter var IS bound). The each render fn re-runs on collection change
  // (_scrml_effect_static), so every item re-dispatches against its current
  // value.
  if (child.kind === "match-block") {
    const matchId = (child as any).id;
    if (matchId == null) {
      lines.push(`${indent}// each: match-block missing id; cannot render per-item`);
      return;
    }
    // The item-scoped dispatch fn name mirrors emit-variant-guard.ts:
    //   `_${renderFnPrefix}_${idPrefix}_dispatch` with renderFnPrefix
    //   "_scrml_match" and idPrefix "match_<id>" → "__scrml_match_match_<id>_dispatch".
    const dispatchFnName = `__scrml_match_match_${matchId}_dispatch`;
    const mountAttr = "data-scrml-match-mount";
    const idPrefix = `match_${matchId}`;
    // Resolve the per-item discriminant expression from the match's `on=`.
    const discriminant = resolveMatchDiscriminantForItem(child, iterVarName);
    // Item-local mount element. Carries the same data-attr the module-scope
    // form uses (debug parity); the dispatch fn ignores the attr (mount is
    // passed in) but it makes the rendered DOM self-describing.
    const mountVar = `_scrml_match_mount_${nextLocalId()}`;
    lines.push(`${indent}const ${mountVar} = document.createElement("div");`);
    lines.push(`${indent}${mountVar}.setAttribute(${JSON.stringify(mountAttr)}, ${JSON.stringify(idPrefix)});`);
    lines.push(`${indent}${fragmentVar}.appendChild(${mountVar});`);
    // Per-item dispatch. The dispatch fn tears down any prior wiring on the
    // mount (per-mount dispose) and re-renders the arm for THIS item's value.
    lines.push(`${indent}${dispatchFnName}(${mountVar}, ${discriminant});`);
    return;
  }

  // each-in-enclosing-scope (S153) — a NESTED `<each>` that is a child of THIS
  // each's per-item template. SPEC §17.X + primer §6.3 (`as` alias pattern).
  //
  // The inner each's iteration source (e.g. `g.items`) and its `@.`-body
  // reference the OUTER each's iter var (`iterVarName` here), which is bound ONLY
  // inside this factory closure — never at module scope. So (unlike a top-level
  // each) the inner each gets NO module-scope render fn; collectEachBlocks marked
  // it `isNested` and emitEachBodyRenderForFile skipped it. We emit it ENTIRELY
  // INLINE here: create an item-local mount element, append it to the item
  // fragment, resolve the inner source IN THIS SCOPE (outer iter var bound), and
  // emit the inner reconcile via the SAME `emitEachReconcileLines` helper the
  // module-scope path uses. The inner factory's `@.` resolves to the INNER iter
  // var (innermost scope wins — emitEachReconcileLines passes the inner iter var
  // down to renderTemplateChildToJs). The outer factory re-runs per outer-
  // collection change (the outer each's `_scrml_effect_static`), so the inner
  // list re-renders for each outer item.
  //
  // Mirrors the R28-1b `<match>`-in-`<each>` precedent above (item-local mount +
  // inline per-item dispatch), adapted to an each whose render is non-item-
  // agnostic (the inner source depends on the outer iter var).
  if (child.kind === "each-block") {
    const innerNode = child as EachBlockAstNode;
    // Tree-shake: empty inner each (no template + no empty) renders nothing.
    if ((!Array.isArray(innerNode.templateChildren) || innerNode.templateChildren.length === 0) && !innerNode.emptyChild) {
      return;
    }
    // Resolve the inner iteration source IN THE OUTER FACTORY SCOPE. `iterVarName`
    // here is the OUTER each's iter var (the closure param), so `@.field` in the
    // inner source lowers to `<outerIterVar>.field` and a bare alias (`g.items`)
    // passes through unchanged. `@cell` → `_scrml_reactive_get("cell")`.
    let innerItemsExpr: string;
    if (innerNode.iterShape === "in") {
      innerItemsExpr = rewriteIterValueExpr(innerNode.inExprRaw ?? "[]", iterVarName);
    } else if (innerNode.iterShape === "of") {
      const ofResolved = rewriteIterValueExpr(innerNode.ofExprRaw ?? "0", iterVarName);
      innerItemsExpr = `Array.from({length: Number(${ofResolved}) || 0}, (_v, _i) => _i)`;
    } else {
      lines.push(`${indent}// each: nested each iter shape unresolved (neither in= nor of=); skipping`);
      return;
    }
    // The inner each's iter var is its OWN `as` alias or the synthetic default —
    // distinct from the outer iter var so the inner factory's `@.` binds to the
    // inner item. (Mirrors emitEachBodyRenderForFile iterVarName resolution.)
    const innerIterVar = (typeof innerNode.asName === "string" && innerNode.asName.length > 0)
      ? innerNode.asName
      : "_scrml_each_item";
    const innerIdxName = "_scrml_each_idx";
    // Item-local mount for the inner list. Carries the debug data-attr the
    // module-scope form uses (self-describing DOM); the inline reconcile writes
    // directly into it.
    const innerMountVar = `_scrml_each_mount_${nextLocalId()}`;
    const innerItemsVar = `_scrml_each_items_${nextLocalId()}`;
    lines.push(`${indent}const ${innerMountVar} = document.createElement("div");`);
    lines.push(`${indent}${innerMountVar}.setAttribute("data-scrml-each-mount", "each_${innerNode.id}");`);
    lines.push(`${indent}${fragmentVar}.appendChild(${innerMountVar});`);
    lines.push(`${indent}const ${innerItemsVar} = ${innerItemsExpr};`);
    // Inline empty-guard + reconcile. Wrap in a block so the empty-guard's
    // `return` (from emitEachReconcileLines) short-circuits ONLY the inner
    // list build, not the whole outer factory — an arrow-IIFE provides the
    // local function frame the `return` needs.
    lines.push(`${indent}(() => {`);
    for (const l of emitEachReconcileLines(innerNode, innerIterVar, innerIdxName, innerMountVar, innerItemsVar, `${indent}  `)) {
      lines.push(l);
    }
    lines.push(`${indent}})();`);
    return;
  }

  // Other node kinds — defer to a runtime-error hint so adopters see the
  // missing case (rather than silent skip).
  lines.push(`${indent}// each: unhandled template child kind="${(child as any).kind}"`);
}

// ---------------------------------------------------------------------------
// Per-item element attribute codegen (S130 HU-1 iteration Landing 2)
// ---------------------------------------------------------------------------

/**
 * Rewrite an attribute / handler-arg expression string into JS valid in the
 * each per-item factory scope (where `iterVarName` is bound):
 *   - `@.field` / `@.`  → `<iterVar>.field` / `<iterVar>` (SPEC §17.7.3 sigil)
 *   - bare `@cell`      → `_scrml_reactive_get("cell")` (file-scope reactive read)
 *
 * The BS tokenizer space-pads `.` operators in some positions
 * (`@.id` → `@ . id`); normalize the contextual-sigil dot before lowering so
 * `rewriteContextualSigil` (which matches `@.ident` without interior
 * whitespace) fires. Order matters: lower `@.` FIRST so `rewriteAtCellAccess`
 * does not mis-consume the contextual sigil's `@`.
 */
function rewriteIterValueExpr(text: string, iterVarName: string): string {
  if (!text || typeof text !== "string") return text;
  let expr = text.replace(/@\s*\.\s*/g, "@.");
  expr = rewriteContextualSigil(expr, iterVarName);
  expr = rewriteAtCellAccess(expr);
  return expr;
}

/**
 * Detect the DOM event name for an event-handler attribute, or null when the
 * attribute is not an event handler.
 *   - `onclick`     → "click"   (canonical §5.2.2 form)
 *   - `on:dblclick` → "dblclick" (namespaced §5.2.3 form)
 * Conservative: `on` alone (no event suffix) and `on-...` are not events.
 */
function eventNameForAttr(aName: string): string | null {
  if (aName.startsWith("on:")) {
    const ev = aName.slice(3);
    return ev.length > 0 ? ev : null;
  }
  if (aName.startsWith("on") && aName.length > 2) {
    // Exclude bind:/class: false hits (they never start with "on") and the
    // bare `on` directive. `onclick` → "click".
    return aName.slice(2);
  }
  return null;
}

/**
 * Lower one per-item element attribute to inline JS on the freshly-created
 * element `elVar`. Handles the four attribute classes that Landing 1 dropped:
 *   1. `class:NAME=expr`  → `elVar.classList.toggle("NAME", !!(expr))`
 *   2. event handlers     → `elVar.addEventListener(ev, fn)`
 *   3. `${...}` / `@.x`   → `elVar.setAttribute("name", String(expr))`
 *   4. literal strings    → `elVar.setAttribute("name", "literal")`
 * plus a defensive comment for directive attrs Landing 2 still defers
 * (`bind:`, `ref=`, `transition:` — these need the reactive-binding registry
 * + static-HTML placeholder model that the per-item factory does not share).
 *
 * `@.`/`@.field` and bare `@cell` are rewritten to the factory-scope binding
 * via `rewriteIterValueExpr`. The render fn re-runs on collection change
 * (`_scrml_effect_static`), so per-item class:/interpolation re-evaluate.
 */
function renderTemplateAttrToJs(
  attr: any,
  iterVarName: string,
  iterIdxName: string,
  elVar: string,
  lines: string[],
  indent: string,
): void {
  if (!attr || typeof attr !== "object") return;
  const aName = String(attr.name ?? "");
  if (!aName) return;
  const val = attr.value;
  const valKind = val && typeof val === "object" ? String(val.kind ?? "") : "";

  // ---- (1) class:NAME — conditional classList toggle ----------------------
  if (aName.startsWith("class:")) {
    const className = aName.slice("class:".length);
    if (!className) return;
    // Resolve the condition expression across the value kinds:
    //   variable-ref @.done  → `<iterVar>.done`
    //   call-ref isOk()      → `isOk()` (args rewritten)
    //   expr (@.n == 1)      → the raw expr (rewritten)
    //   string-literal "x"   → degenerate; treat as a constant truthy string
    let cond: string;
    if (valKind === "variable-ref") {
      cond = rewriteIterValueExpr(String(val.name ?? ""), iterVarName);
    } else if (valKind === "call-ref") {
      cond = `${String(val.name ?? "")}(${serializeCallArgs(val, iterVarName)})`;
      cond = rewriteIterValueExpr(cond, iterVarName);
    } else if (valKind === "expr") {
      cond = rewriteIterValueExpr(String(val.raw ?? ""), iterVarName);
    } else if (valKind === "string-literal") {
      cond = JSON.stringify(String(val.value ?? ""));
    } else {
      cond = "false";
    }
    if (!cond) cond = "false";
    lines.push(`${indent}${elVar}.classList.toggle(${JSON.stringify(className)}, !!(${cond}));`);
    return;
  }

  // ---- (2) event handlers — inline addEventListener -----------------------
  const ev = eventNameForAttr(aName);
  if (ev !== null) {
    let handlerBody: string;
    if (valKind === "call-ref") {
      const fnName = String(val.name ?? "");
      handlerBody = `${fnName}(${serializeCallArgs(val, iterVarName)});`;
    } else if (valKind === "expr") {
      // `${...}` form — could be an arrow/lambda or a call expression. Emit
      // the rewritten expression and invoke it if it is a function reference;
      // for a bare call expression the rewrite already produces a statement.
      const body = rewriteIterValueExpr(String(val.raw ?? ""), iterVarName);
      handlerBody = `${body};`;
    } else if (valKind === "variable-ref") {
      // `onclick=@handler` — reference a reactive/handler cell. Rewrite then
      // invoke with the event.
      const ref = rewriteIterValueExpr(String(val.name ?? ""), iterVarName);
      handlerBody = `${ref}(event);`;
    } else {
      handlerBody = "/* each: unsupported event handler shape */";
    }
    lines.push(`${indent}${elVar}.addEventListener(${JSON.stringify(ev)}, function(event) { ${handlerBody} });`);
    return;
  }

  // ---- bind: / ref= / transition: — deferred (needs reactive registry) ----
  if (aName.startsWith("bind:") || aName === "ref" || aName.startsWith("transition:") ||
      aName.startsWith("in:") || aName.startsWith("out:")) {
    lines.push(`${indent}// each: per-item directive attr "${aName}" deferred (Landing 2 scope: class:/events/interpolation/literals)`);
    return;
  }

  // ---- (3) ${...} interpolation / @.field value → setAttribute value ------
  if (valKind === "expr") {
    const expr = rewriteIterValueExpr(String(val.raw ?? ""), iterVarName);
    lines.push(`${indent}${elVar}.setAttribute(${JSON.stringify(aName)}, String(${expr}));`);
    return;
  }
  if (valKind === "variable-ref") {
    const expr = rewriteIterValueExpr(String(val.name ?? ""), iterVarName);
    lines.push(`${indent}${elVar}.setAttribute(${JSON.stringify(aName)}, String(${expr}));`);
    return;
  }
  if (valKind === "call-ref") {
    const expr = rewriteIterValueExpr(`${String(val.name ?? "")}(${serializeCallArgs(val, iterVarName)})`, iterVarName);
    lines.push(`${indent}${elVar}.setAttribute(${JSON.stringify(aName)}, String(${expr}));`);
    return;
  }

  // ---- (4) literal string / absent (bareword) attr ------------------------
  if (valKind === "string-literal") {
    lines.push(`${indent}${elVar}.setAttribute(${JSON.stringify(aName)}, ${JSON.stringify(String(val.value ?? ""))});`);
    return;
  }
  if (valKind === "absent" || val == null) {
    // Bareword attribute (e.g. `disabled`): presence-only.
    lines.push(`${indent}${elVar}.setAttribute(${JSON.stringify(aName)}, "");`);
    return;
  }

  // Unknown value kind — defensive literal copy with a hint.
  lines.push(`${indent}// each: per-item attr "${aName}" unhandled value kind="${valKind}"`);
}

/**
 * Serialize a call-ref attribute value's arguments into a comma-joined JS
 * argument list, rewriting `@.`/`@cell` to the factory-scope binding. Each arg
 * is a raw expression string from the parser (e.g. "@.id", "userId", "9.99").
 */
function serializeCallArgs(callRef: any, iterVarName: string): string {
  const args: any[] = Array.isArray(callRef?.args) ? callRef.args : [];
  return args
    .map((a) => rewriteIterValueExpr(String(a ?? ""), iterVarName))
    .join(", ");
}

// ---------------------------------------------------------------------------
// R28-1b — per-item match discriminant resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a block-form `<match on=...>`'s discriminant to a JS expression
 * valid in the each per-item factory scope (where `iterVarName` is bound).
 *
 * Mirrors emit-match.ts:resolveOnExpr lowering, but produces an expression
 * for INLINE per-item dispatch rather than a module-scope accessor:
 *   - `on=@.field` / `on=@.`  → `<iterVar>.field` / `<iterVar>` (the common
 *                               item-scoped form per SPEC §17.7.3 — `@.field`
 *                               and the `as`-bound `alias.field` are aliases)
 *   - `on=@cell`              → `_scrml_reactive_get("cell")` (item-independent
 *                               but legal — a file-scope cell read inside the
 *                               item factory; the each render fn re-runs on
 *                               cell change via the existing dep edge)
 *   - `on=${expr}` / other    → the inner/raw expression with `@.`/`@cell`
 *                               rewrites applied (best-effort)
 *
 * The BS tokenizer space-pads `.` operators (`@.status` → `@ . status`); the
 * rewrite tolerates surrounding whitespace.
 */
function resolveMatchDiscriminantForItem(matchBlock: any, iterVarName: string): string {
  const raw = String(matchBlock?.onExprRaw ?? "").trim();
  if (!raw) {
    // No explicit on= (auto-implied engine). Per-item-match against an engine
    // is not a meaningful shape inside an each; emit a defensive undefined so
    // the dispatch is a no-op rather than invalid JS.
    return "undefined";
  }
  // `${expr}` interpolation form — unwrap to the inner expression.
  let expr = raw;
  const dollarMatch = expr.match(/^\$\{([\s\S]*)\}$/);
  if (dollarMatch) expr = dollarMatch[1].trim();
  // The BS tokenizer space-pads `.` operators (`@.status` → `@ . status`).
  // Normalize the contextual-sigil dot so `rewriteContextualSigil` (which
  // matches `@.ident` without interior whitespace) lowers it. Conservative —
  // only collapses whitespace immediately around a `@`-led dot.
  expr = expr.replace(/@\s*\.\s*/g, "@.");
  // Lower `@.field` / `@.` to the iter var (item-scoped sigil), then lower any
  // remaining bare `@cell` to a reactive read. Order matters: `@.` first so
  // `rewriteAtCellAccess` does not mis-consume the contextual sigil.
  let out = rewriteContextualSigil(expr, iterVarName);
  out = rewriteAtCellAccess(out);
  return out;
}

// ---------------------------------------------------------------------------
// Contextual sigil resolution — `@.` → iterVar, `@.field` → iterVar.field
// ---------------------------------------------------------------------------

/**
 * Rewrite `@.` and `@.field` occurrences in a body / attribute / expression
 * string to reference the iteration variable. Per HU-1 Q6 ratification,
 * `@.` always means "the current iteration value" — inside an `in=` form
 * it's the current item, inside an `of=` form it's the current index.
 *
 * Examples:
 *   "@.name"        → "_scrml_each_item.name"   (or "contact.name" if `as contact`)
 *   "@."            → "_scrml_each_item"
 *   "Slot " + @."   → "Slot " + _scrml_each_item"  (string-concat preserved)
 *   "@.id == 0"     → "_scrml_each_item.id == 0"
 *
 * Conservative regex — replaces `@.` only when followed by a non-`@`-`{`
 * character (avoid clobbering `@x` cell access or `@.` inside string
 * literals; the latter is left in-place since string-literal handling
 * is beyond the scope of this regex pass).
 */
function rewriteContextualSigil(text: string, iterVarName: string): string {
  if (!text || typeof text !== "string") return text;
  // Match `@.` followed by optional dotted-ident chain. The `@.` followed by
  // end-of-string OR non-ident-char becomes the bare iter var.
  // Order matters: longest match first via greedy quantifier on `[A-Za-z0-9_]+`.
  // Match `@.identifier` first (greedy), then bare `@.`.
  return text.replace(/@\.([A-Za-z_$][A-Za-z0-9_$]*)/g, (_m, member) => `${iterVarName}.${member}`)
             .replace(/@\.(?![A-Za-z_$])/g, iterVarName);
}

// ---------------------------------------------------------------------------
// `:`-shorthand detection on per-item element openers
// ---------------------------------------------------------------------------

/**
 * Detect whether a markup opener uses the SPEC §4.14 `:`-shorthand body
 * form: `<tag attrs : expr>` with mandatory whitespace before `:` and
 * no closer.
 *
 * Returns true when the raw markup text contains a top-level ` : ` between
 * the last attribute and the closing `>` of the opener, with no matching
 * closer (`</...>`).
 */
function detectShorthandOpener(raw: string): boolean {
  if (!raw || typeof raw !== "string") return false;
  // Find opener end at top level (depth 0 outside quotes/braces).
  let depth = 0;
  let parenDepth = 0;
  let bracketDepth = 0;
  let inDQ = false;
  let inSQ = false;
  let openerEnd = -1;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (inDQ) { if (c === '"') inDQ = false; else if (c === "\\") i++; continue; }
    if (inSQ) { if (c === "'") inSQ = false; else if (c === "\\") i++; continue; }
    if (c === '"') { inDQ = true; continue; }
    if (c === "'") { inSQ = true; continue; }
    if (c === "{") { depth++; continue; }
    if (c === "}") { if (depth > 0) depth--; continue; }
    if (c === "(") { parenDepth++; continue; }
    if (c === ")") { if (parenDepth > 0) parenDepth--; continue; }
    if (c === "[") { bracketDepth++; continue; }
    if (c === "]") { if (bracketDepth > 0) bracketDepth--; continue; }
    if (c === ">" && depth === 0 && parenDepth === 0 && bracketDepth === 0) {
      openerEnd = i;
      break;
    }
  }
  if (openerEnd < 0) return false;
  const opener = raw.slice(0, openerEnd);
  // §4.14: `:`-shorthand requires whitespace BEFORE `:` (mandatory).
  // Look for ` :` followed by anything other than `:` (avoid `::` namespace).
  // Conservative — also require the `:` to NOT be inside a known
  // attribute-namespace prefix (`bind:`, `class:`, `on:`, `:let`).
  // Simple heuristic: a ` : ` (space-colon-space) at top level is the
  // canonical `:`-shorthand introducer.
  return / : /.test(opener);
}

/**
 * Extract the `:`-shorthand body expression text from a per-item opener.
 * Caller guarantees `detectShorthandOpener(raw)` returned true.
 */
function extractShorthandExpr(raw: string): string {
  if (!raw) return "";
  // Find the opener end at top level.
  let depth = 0;
  let parenDepth = 0;
  let bracketDepth = 0;
  let inDQ = false;
  let inSQ = false;
  let openerEnd = -1;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (inDQ) { if (c === '"') inDQ = false; else if (c === "\\") i++; continue; }
    if (inSQ) { if (c === "'") inSQ = false; else if (c === "\\") i++; continue; }
    if (c === '"') { inDQ = true; continue; }
    if (c === "'") { inSQ = true; continue; }
    if (c === "{") { depth++; continue; }
    if (c === "}") { if (depth > 0) depth--; continue; }
    if (c === "(") { parenDepth++; continue; }
    if (c === ")") { if (parenDepth > 0) parenDepth--; continue; }
    if (c === "[") { bracketDepth++; continue; }
    if (c === "]") { if (bracketDepth > 0) bracketDepth--; continue; }
    if (c === ">" && depth === 0 && parenDepth === 0 && bracketDepth === 0) {
      openerEnd = i;
      break;
    }
  }
  if (openerEnd < 0) return "";
  const opener = raw.slice(0, openerEnd);
  // Find ` : ` introducer.
  const m = opener.match(/ : ([\s\S]*)$/);
  if (!m) return "";
  return m[1].trim();
}

// ---------------------------------------------------------------------------
// Render <empty> sub-element to JS — bare-body markup walk.
// ---------------------------------------------------------------------------

function renderEmptyChildToJs(
  emptyChild: any,
  fragmentVar: string,
  lines: string[],
  indent: string,
): void {
  if (!emptyChild || typeof emptyChild !== "object") return;
  // R25-Bug-40 — SPEC §17.7.4 admits `<empty : "literal">` `:`-shorthand
  // form (overseer-3 separate finding). The shorthand body lives on the
  // <empty> AST node itself (closerForm:"shorthand" + shorthandBodyRaw),
  // not in its .children. Render the shorthand body as a textNode directly
  // into the empty fragment (no createElement for <empty> — it's a
  // structural sub-element, not a DOM element).
  if ((emptyChild as any).closerForm === "shorthand" && typeof (emptyChild as any).shorthandBodyRaw === "string") {
    const expr = (emptyChild as any).shorthandBodyRaw;
    // <empty> body is in outer (no-iter) scope; no `@.` substitution.
    // Rewrite bare `@cell` references via rewriteAtCellAccess for V5-strict.
    const rewritten = rewriteAtCellAccess(expr);
    lines.push(`${indent}${fragmentVar}.appendChild(document.createTextNode(String(${rewritten})));`);
    return;
  }
  const children = (emptyChild as any).children ?? [];
  if (!Array.isArray(children) || children.length === 0) return;
  // <empty> body is plain-markup free-text; no `@.` substitution needed
  // (empty-state can reference outer @cells but those use bare `@cell`
  // syntax, not contextual sigils).
  for (const grand of children) {
    renderTemplateChildToJs(grand, "/* no iter scope in <empty> */", "", fragmentVar, lines, "  ");
  }
}

// ---------------------------------------------------------------------------
// Iter var counter — local to a single emit
// ---------------------------------------------------------------------------

let _localIdCounter = 0;
function nextLocalId(): number {
  return ++_localIdCounter;
}
function resetLocalIdCounter(): void {
  _localIdCounter = 0;
}

// ---------------------------------------------------------------------------
// Key inference + extraction
// ---------------------------------------------------------------------------

/**
 * Resolve the `key=` expression for a given each-block. Per HU-1 Q5:
 *   - Explicit `key=expr` overrides everything.
 *   - `key=__index__` is the canonical sentinel for "positional" — emit `i`.
 *   - Otherwise, attempt to infer from item shape: if items have a `.id`
 *     field, infer `key=item.id` (where item = iterVarName). For
 *     `<each of=N>` the default is `key=i` (the index itself).
 *   - When inference fails (no `.id` evidence), the W-EACH-KEY-001 info-lint
 *     fires at the lint stage (sibling file). Runtime fallback is `i`.
 *
 * For Landing-1 baseline:
 *   - in= form: infer `item.id` unconditionally (the runtime
 *     `_scrml_reconcile_list` keyFn already does `item?.id != null ? item.id : i`
 *     as a runtime guard, so the default is naturally correct).
 *   - of= form: emit `i` (the index).
 *   - Explicit key=expr: emit the rewritten expression.
 */
function resolveKeyFnBody(
  node: EachBlockAstNode,
  iterVarName: string,
  iterIdxName: string,
): string {
  // Explicit key= override.
  if (node.keyExprRaw) {
    const trimmed = node.keyExprRaw.trim();
    if (trimmed === "__index__") return iterIdxName;
    // Rewrite `@.field` and bare `as name` references inside the expr.
    const rewritten = rewriteContextualSigil(trimmed, iterVarName);
    return rewritten;
  }
  // of= form: default key is the index.
  if (node.iterShape === "of") return iterIdxName;
  // in= form: default-infer from `.id` (with runtime fallback to the index).
  return `(${iterVarName}?.id != null ? ${iterVarName}.id : ${iterIdxName})`;
}

// ---------------------------------------------------------------------------
// Body render + dispatcher emission
// ---------------------------------------------------------------------------

/**
 * Emit one render function per each-block in the file. Returns the function
 * declarations + a list of dispatcher (subscription) statements.
 *
 * Each-block render shape (in= form):
 *
 *   function _scrml_each_render_N() {
 *     const items = _scrml_reactive_get("contacts");   // dep-read FIRST (S153)
 *     const mount = document.querySelector('[data-scrml-each-mount="each_N"]');
 *     if (!mount) return;                               // dep already tracked
 *     // Empty-state path: <empty> sub-element fires when items.length === 0.
 *     if (!items || items.length === 0) {
 *       mount.replaceChildren();
 *       const emptyFrag = document.createDocumentFragment();
 *       <emit empty child markup>
 *       mount.appendChild(emptyFrag);
 *       return;
 *     }
 *     // Reconcile with keyed list:
 *     _scrml_reconcile_list(
 *       mount,
 *       items,
 *       (item, i) => keyFn(item, i),
 *       (item, i) => {
 *         const frag = document.createDocumentFragment();
 *         <emit template per-item markup; @. → item, as name → item alias>
 *         return frag.firstChild;
 *       }
 *     );
 *   }
 *   _scrml_each_renderers["each_N"] = _scrml_each_render_N;   // arm-entry remount (S153)
 *   _scrml_each_render_N();
 *   _scrml_effect_static(_scrml_each_render_N);
 *
 * Of-form follows the same shape but emits a synthetic Array.from({length: N})
 * before passing into reconcile_list.
 *
 * Tree-shake: when the each-block has no template + no empty, skip emission.
 */
/**
 * Emit the empty-guard + `_scrml_reconcile_list(...)` call for one each-block,
 * given the JS var names that hold the resolved mount element + items array,
 * and the indentation to prefix each line with.
 *
 * Shared by TWO call sites so the reconcile shape stays in lockstep:
 *   1. emitEachBodyRenderForFile — module-scope render fn (mountVar="_mount",
 *      itemsVar="_items", indent="  ").
 *   2. renderTemplateChildToJs's each-block branch (nested each) — inline inside
 *      the OUTER each's per-item factory (mountVar/itemsVar are item-local vars,
 *      deeper indent). There is no module-scope render fn for a nested each, so
 *      the empty-guard re-render is part of the outer factory's per-item build.
 *
 * `lengthRef` is the expression for "is the collection empty" (`<itemsVar>.length`).
 */
function emitEachReconcileLines(
  node: EachBlockAstNode,
  iterVarName: string,
  iterIdxName: string,
  mountVar: string,
  itemsVar: string,
  indent: string,
): string[] {
  const lines: string[] = [];
  const lengthRef = `${itemsVar}.length`;

  // Empty-state path (when `<empty>` sub-element is present).
  if (node.emptyChild) {
    lines.push(`${indent}if (!${itemsVar} || ${lengthRef} === 0) {`);
    lines.push(`${indent}  ${mountVar}.replaceChildren();`);
    lines.push(`${indent}  const _emptyFrag = document.createDocumentFragment();`);
    const emptyLines: string[] = [];
    renderEmptyChildToJs(node.emptyChild, "_emptyFrag", emptyLines, `${indent}  `);
    for (const l of emptyLines) lines.push(l);
    lines.push(`${indent}  ${mountVar}.appendChild(_emptyFrag);`);
    lines.push(`${indent}  return;`);
    lines.push(`${indent}}`);
  } else {
    // No `<empty>` block: still guard against an undefined / not-yet-initialized
    // collection. For the module-scope path the source cell may not have run its
    // `_scrml_reactive_set` yet (cell-init order); for the nested path the outer
    // item's field may be undefined. Render empty in that case (re-runs later for
    // the module-scope path via the effect subscription; for the nested path the
    // outer factory re-runs per outer-collection change).
    lines.push(`${indent}if (!${itemsVar}) {`);
    lines.push(`${indent}  ${mountVar}.replaceChildren();`);
    lines.push(`${indent}  return;`);
    lines.push(`${indent}}`);
  }

  // Per-item template factory.
  // gate-found-invalid-js-fix-wave (S141): the keyFn index param + the keyFn
  // body's index reference MUST use the internal index name (`_scrml_each_idx`),
  // NOT the literal `i`. When the each-block aliases the item/index as `i`
  // (`<each of=N as i>`), `iterVarName === "i"`, so a keyFn signature of
  // `(i, i) => i` is an "Argument name clash" (invalid JS). Threading
  // `iterIdxName` keeps both params distinct for any alias.
  const keyFnBody = resolveKeyFnBody(node, iterVarName, iterIdxName);
  lines.push(`${indent}_scrml_reconcile_list(`);
  lines.push(`${indent}  ${mountVar},`);
  lines.push(`${indent}  ${itemsVar},`);
  lines.push(`${indent}  (${iterVarName}, ${iterIdxName}) => ${keyFnBody},`);
  lines.push(`${indent}  (${iterVarName}, ${iterIdxName}) => {`);
  lines.push(`${indent}    const _itemFrag = document.createDocumentFragment();`);

  // Walk template children — produce DOM-build JS.
  const templateLines: string[] = [];
  for (const child of node.templateChildren) {
    renderTemplateChildToJs(child, iterVarName, iterIdxName, "_itemFrag", templateLines, `${indent}    `);
  }
  for (const l of templateLines) lines.push(l);

  lines.push(`${indent}    return _itemFrag.firstChild;`);
  lines.push(`${indent}  }`);
  lines.push(`${indent});`);
  return lines;
}

export function emitEachBodyRenderForFile(
  fileAST: any,
  ctx: CompileContext,
): { renderFunctions: string[]; dispatchers: string[] } {
  const renderFunctions: string[] = [];
  const dispatchers: string[] = [];

  const eachBlocks = collectEachBlocks(fileAST);
  for (const node of eachBlocks) {
    // Tree-shake (rare): empty block.
    if ((!Array.isArray(node.templateChildren) || node.templateChildren.length === 0) && !node.emptyChild) {
      continue;
    }
    // each-in-enclosing-scope (S153): a NESTED each (inside another each's
    // per-item template) gets NO module-scope render fn / dispatcher — its
    // iteration source + `@.` reference the OUTER each's iter var, bound only
    // inside the outer per-item factory. renderTemplateChildToJs's each-block
    // branch emits it INLINE there. Emitting a module-scope render fn here would
    // produce `const _items = <outerIterVar>.field;` at top level (the outer var
    // is undefined → ReferenceError) — the exact defect this fix closes.
    if (node.isNested) {
      continue;
    }

    const renderFnName = `_scrml_each_render_${node.id}`;
    const iterVarName = node.asName ? node.asName : "_scrml_each_item";
    const iterIdxName = "_scrml_each_idx";

    resetLocalIdCounter(); // reset per-block so var names stay stable

    const fnLines: string[] = [];
    fnLines.push(`function ${renderFnName}() {`);

    // Resolve the iteration source FIRST — BEFORE querying the mount.
    //
    // engine-gated-each-populate (S153): the `_scrml_reactive_get(...)` dep-read
    // MUST execute on the first `_scrml_effect_static` run regardless of whether
    // the mount is present in the DOM. When this each lives inside a NON-`initial=`
    // engine arm, the each-mount div is absent at module-init (the engine renders
    // only the `initial=` arm), so a mount-first `if (!_mount) return;` short-
    // circuits BEFORE the cell read → ZERO deps tracked → the effect is permanently
    // subscribed to nothing and never re-fires when the arm later mounts.
    // Reading `_items` first establishes the dep edge unconditionally; we query the
    // mount AFTER and bail (dep already tracked) if it is not yet in the DOM.
    let itemsExpr: string;
    if (node.iterShape === "in") {
      const inExpr = node.inExprRaw ?? "[]";
      // Rewrite `@cell` to `_scrml_reactive_get("cell")` for V5-strict reactivity.
      itemsExpr = rewriteAtCellAccess(inExpr);
    } else if (node.iterShape === "of") {
      const ofExpr = node.ofExprRaw ?? "0";
      // The expression may be a literal (`10`) or a cell (`@daysLeft`).
      // Rewrite `@cell` → `_scrml_reactive_get("cell")`.
      const ofExprResolved = rewriteAtCellAccess(ofExpr);
      // Generate an integer range [0, 1, ..., N-1] via Array.from.
      itemsExpr = `Array.from({length: Number(${ofExprResolved}) || 0}, (_v, _i) => _i)`;
    } else {
      // Both / neither — surface at PASS / TS time; emit a no-op here.
      fnLines.push(`  // each: iter shape unresolved (neither in= nor of=); skipping render`);
      fnLines.push(`}`);
      renderFunctions.push(fnLines.join("\n"));
      continue;
    }

    // Dep-establishing read FIRST (see comment above).
    fnLines.push(`  const _items = ${itemsExpr};`);
    // Now query the mount; if it is not in the DOM yet (non-initial engine arm
    // pre-entry), bail — the dep above is already tracked, so a later arm-entry
    // remount (via `_scrml_remount_each`) will re-run this fn with the mount present.
    fnLines.push(`  const _mount = document.querySelector('[data-scrml-each-mount="each_${node.id}"]');`);
    fnLines.push(`  if (!_mount) return;`);

    // Empty-guard + per-item reconcile (shared with the nested-each inline path).
    for (const l of emitEachReconcileLines(node, iterVarName, iterIdxName, "_mount", "_items", "  ")) {
      fnLines.push(l);
    }
    fnLines.push(`}`);

    renderFunctions.push(fnLines.join("\n"));

    // Dispatcher: initial render + reactive subscription.
    // `_scrml_effect_static` re-runs the render on dep change; the
    // reactive-get inside the render establishes the dep edge.
    //
    // engine-gated-each-populate (S153): also register the renderer in the global
    // `_scrml_each_renderers` map keyed by the mount id. This lets the engine
    // dispatcher (and any other dynamic-HTML insertion site) re-invoke the
    // renderer when the each-mount enters the DOM on arm-entry — see
    // `_scrml_remount_each` in the runtime. The dep edge was already established
    // by the dep-first read at module-init (Part A), so re-running here re-renders
    // with the now-present mount without re-subscribing.
    dispatchers.push(`_scrml_each_renderers[${JSON.stringify(`each_${node.id}`)}] = ${renderFnName};`);
    dispatchers.push(`${renderFnName}();`);
    dispatchers.push(`_scrml_effect_static(${renderFnName});`);
  }

  return { renderFunctions, dispatchers };
}

// ---------------------------------------------------------------------------
// `@cell` access rewrite — V5-strict reactive resolution
// ---------------------------------------------------------------------------

/**
 * Rewrite bare `@cellName` references to `_scrml_reactive_get("cellName")`
 * for runtime resolution. Conservative — only rewrites the simple shape
 * `@ident` (no member access yet — `@cell.field` becomes
 * `_scrml_reactive_get("cell").field`).
 *
 * Skips `@.` (the contextual sigil — handled separately by
 * `rewriteContextualSigil`).
 */
function rewriteAtCellAccess(text: string): string {
  if (!text || typeof text !== "string") return text;
  // Order matters: handle `@ident` (excluding `@.`).
  return text.replace(/@([A-Za-z_$][A-Za-z0-9_$]*)/g, (_m, name) => `_scrml_reactive_get(${JSON.stringify(name)})`);
}
