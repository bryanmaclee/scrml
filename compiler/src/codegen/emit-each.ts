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
  function walk(node: any): void {
    if (!node || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const n of node) walk(n);
      return;
    }
    if (node.kind === "each-block") {
      found.push(node as EachBlockAstNode);
      // Recurse into bodyChildren / templateChildren so nested each-blocks
      // inside per-item template surface too. <empty> sub-element can't
      // legally contain a nested each — but recurse anyway for resilience.
      if (Array.isArray(node.bodyChildren)) walk(node.bodyChildren);
      if (Array.isArray(node.templateChildren)) walk(node.templateChildren);
      if (node.emptyChild) walk(node.emptyChild);
      return;
    }
    // Recurse into known container fields. Mirror engine-decl + match-block
    // descent shape.
    for (const key of ["children", "body", "bodyChildren", "nodes", "arms", "templateChildren"]) {
      if (Array.isArray((node as any)[key])) walk((node as any)[key]);
    }
  }
  // Accept BOTH `fileAST.nodes` (test shape) AND `fileAST.ast.nodes`
  // (pipeline shape) — mirrors collectMatchBlocks pattern at
  // emit-match.ts:118.
  walk(fileAST.nodes ?? fileAST.ast?.nodes ?? fileAST.children ?? fileAST);
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

    // Apply known attributes (best-effort). For Landing-1, copy literal
    // string-valued attributes; defer interpolation-bearing attrs to a
    // future enhancement. Attribute rewrite for `@.` substitution lands
    // identically to body-text rewrite.
    const attrs: any[] = (child as any).attributes ?? (child as any).attrs ?? [];
    for (const attr of attrs) {
      if (!attr || typeof attr !== "object") continue;
      const aName = String(attr.name ?? "");
      if (!aName) continue;
      const aValRaw = String(attr.value?.value ?? attr.value?.raw ?? attr.raw ?? "");
      const rewrittenVal = rewriteContextualSigil(aValRaw, iterVarName);
      lines.push(`${indent}${elVar}.setAttribute(${JSON.stringify(aName)}, ${JSON.stringify(rewrittenVal)});`);
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

  // Other node kinds — defer to a runtime-error hint so adopters see the
  // missing case (rather than silent skip).
  lines.push(`${indent}// each: unhandled template child kind="${(child as any).kind}"`);
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
 *     const mount = document.querySelector('[data-scrml-each-mount="each_N"]');
 *     if (!mount) return;
 *     const items = _scrml_reactive_get("contacts");
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
 *   _scrml_each_render_N();
 *   _scrml_effect_static(_scrml_each_render_N);
 *
 * Of-form follows the same shape but emits a synthetic Array.from({length: N})
 * before passing into reconcile_list.
 *
 * Tree-shake: when the each-block has no template + no empty, skip emission.
 */
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

    const renderFnName = `_scrml_each_render_${node.id}`;
    const iterVarName = node.asName ? node.asName : "_scrml_each_item";
    const iterIdxName = "_scrml_each_idx";

    resetLocalIdCounter(); // reset per-block so var names stay stable

    const fnLines: string[] = [];
    fnLines.push(`function ${renderFnName}() {`);
    fnLines.push(`  const _mount = document.querySelector('[data-scrml-each-mount="each_${node.id}"]');`);
    fnLines.push(`  if (!_mount) return;`);

    // Resolve the iteration source.
    let itemsExpr: string;
    let lengthRef: string;
    if (node.iterShape === "in") {
      const inExpr = node.inExprRaw ?? "[]";
      // Rewrite `@cell` to `_scrml_reactive_get("cell")` for V5-strict reactivity.
      itemsExpr = rewriteAtCellAccess(inExpr);
      lengthRef = "_items.length";
    } else if (node.iterShape === "of") {
      const ofExpr = node.ofExprRaw ?? "0";
      // The expression may be a literal (`10`) or a cell (`@daysLeft`).
      // Rewrite `@cell` → `_scrml_reactive_get("cell")`.
      const ofExprResolved = rewriteAtCellAccess(ofExpr);
      // Generate an integer range [0, 1, ..., N-1] via Array.from.
      itemsExpr = `Array.from({length: Number(${ofExprResolved}) || 0}, (_v, _i) => _i)`;
      lengthRef = "_items.length";
    } else {
      // Both / neither — surface at PASS / TS time; emit a no-op here.
      fnLines.push(`  // each: iter shape unresolved (neither in= nor of=); skipping render`);
      fnLines.push(`}`);
      renderFunctions.push(fnLines.join("\n"));
      continue;
    }

    fnLines.push(`  const _items = ${itemsExpr};`);

    // Empty-state path (when `<empty>` sub-element is present).
    if (node.emptyChild) {
      fnLines.push(`  if (!_items || ${lengthRef} === 0) {`);
      fnLines.push(`    _mount.replaceChildren();`);
      fnLines.push(`    const _emptyFrag = document.createDocumentFragment();`);
      const emptyLines: string[] = [];
      renderEmptyChildToJs(node.emptyChild, "_emptyFrag", emptyLines, "    ");
      for (const l of emptyLines) fnLines.push(l);
      fnLines.push(`    _mount.appendChild(_emptyFrag);`);
      fnLines.push(`    return;`);
      fnLines.push(`  }`);
    }

    // Per-item template factory.
    // gate-found-invalid-js-fix-wave (S141): the keyFn index param + the
    // keyFn body's index reference MUST use the internal index name
    // (`_scrml_each_idx`), NOT the literal `i`. When the each-block aliases the
    // item/index as `i` (`<each of=N as i>`), `iterVarName === "i"`, so a keyFn
    // signature of `(i, i) => i` is an "Argument name clash" (invalid JS — the
    // gate's E-CODEGEN-INVALID-JS). Threading `iterIdxName` keeps both params
    // distinct for any alias.
    const keyFnBody = resolveKeyFnBody(node, iterVarName, iterIdxName);
    fnLines.push(`  _scrml_reconcile_list(`);
    fnLines.push(`    _mount,`);
    fnLines.push(`    _items,`);
    fnLines.push(`    (${iterVarName}, ${iterIdxName}) => ${keyFnBody},`);
    fnLines.push(`    (${iterVarName}, ${iterIdxName}) => {`);
    fnLines.push(`      const _itemFrag = document.createDocumentFragment();`);

    // Walk template children — produce DOM-build JS.
    const templateLines: string[] = [];
    for (const child of node.templateChildren) {
      renderTemplateChildToJs(child, iterVarName, iterIdxName, "_itemFrag", templateLines, "      ");
    }
    for (const l of templateLines) fnLines.push(l);

    fnLines.push(`      return _itemFrag.firstChild;`);
    fnLines.push(`    }`);
    fnLines.push(`  );`);
    fnLines.push(`}`);

    renderFunctions.push(fnLines.join("\n"));

    // Dispatcher: initial render + reactive subscription.
    // `_scrml_effect_static` re-runs the render on dep change; the
    // reactive-get inside the render establishes the dep edge.
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
