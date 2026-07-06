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
import type { EngineRewriteCtx } from "./emit-control-flow.ts";
import { emitStringFromTree } from "../expression-parser.ts";
import { isRcdataElement } from "../html-elements.js";

// ---------------------------------------------------------------------------
// Bug 62 (S156, §51.0.G / §51.0.G.1 / §51.0.S) — engine `.advance(.X)` (state
// AND message plane) and `@engine = .X` direct-write inside a Tier-1 `<each>`
// per-item event handler.
//
// The per-item event-handler emission (renderTemplateAttrToJs case (2)) used
// to route the handler value through `rewriteIterValueExpr` ONLY — iter-scope
// lowering with NO engine awareness. So `@phase.advance(.Active)` and
// `@phase = .Active` survived RAW into the emitted handler body → invalid JS
// (`E-CODEGEN-INVALID-LOGIC: Unexpected character '@'`).
//
// This carrier threads the file's engine codegen context (built once in
// emitEachBodyRenderForFile from `ctx.fileAST`, mirroring emit-event-wiring.ts)
// down to the per-item handler emitter so engine transitions lower through the
// SAME canonical machinery the non-each path uses:
//   - `.advance(.X)` (call)   → parseExprToNode → emitExprField(C13 arm) →
//                               `_scrml_engine_advance(...)` (state plane) /
//                               `_scrml_engine_dispatch_message(...)` (message plane)
//   - `@engine = .X` (assign) → rewriteBlockBody(engineRewriteCtx) →
//                               `_scrml_engine_direct_set(...)`
// (`emitAssign` has NO engine-binding interception, so the assign form MUST
// take the rewriteBlockBody path — same split emit-event-wiring.ts uses.)
//
// Composition with iter-scope: the two rewrites target DISJOINT `@`-forms —
// `@.field` / `as`-name are iter-locals (lowered to `col`/`col.field` BEFORE
// the engine pass via rewriteContextualSigil), while `@engineVar` is a
// file-scope engine var (preserved through rewriteContextualSigil, which only
// matches `@.`). `@cell` reactive reads are left for emit-expr / rewriteBlockBody
// to lower (`_scrml_reactive_get`). When the file declares no engines the
// carrier is null and the handler path is byte-identical to pre-fix.
// ---------------------------------------------------------------------------
export interface EachEngineCtx {
  /** For the assign form (`@engine = .X`) — rewriteBlockBody write-guard ctx. */
  engineRewriteCtx: EngineRewriteCtx | null;
  /** For the advance form (`@engine.advance(.X)`) — EmitExprContext spread. */
  engineExprCtxExtras: Record<string, unknown>;
  /** Bare engine var names — cheap gate before parse / write-guard routing. */
  engineVarNames: Set<string> | null;
}

// ---------------------------------------------------------------------------
// SPEC §4.17 raw-content elements (`<pre>` / `<code>`). Inside a raw-content
// element body, `${...}` is NOT interpolation — the literal `$`, `{`, `}`
// characters pass through as text (§4.17 line 1101, normative). The block
// splitter captures the body as a single text run, so inside an `<each>` body a
// `<code>${@.id}</code>` child surfaces as a `text` node whose value is the
// verbatim `${@.id}`. The per-item text emit path MUST NOT run
// `rewriteContextualSigil` on such text (doing so half-rewrites `@.id` to
// `_scrml_each_item.id` and corrupts the §4.17 verbatim literal into
// `${_scrml_each_item.id}` — GITI-030). Mirrors `RAW_CONTENT_ELEMENTS` in
// block-splitter.js + `RAW_CONTENT_NAMES` in lint-w-interp-in-raw-content.js.
// ---------------------------------------------------------------------------
const RAW_CONTENT_ELEMENT_NAMES = new Set(["pre", "code"]);

// GITI-032 — recursively detect a `markup-value` leaf anywhere in a parsed
// ExprNode tree (markup-as-value in expression position, Pillar 1 §1.4/§7.4).
// Used to defer the per-item interpolation case the each path does not yet lower
// with iter-var scope (see the bare-expr branch in renderTemplateChildToJs).
function exprNodeHasMarkupValue(node: any): boolean {
  if (node === null || node === undefined || typeof node !== "object") return false;
  if (node.kind === "markup-value") return true;
  for (const key of Object.keys(node)) {
    const v = (node as Record<string, unknown>)[key];
    if (Array.isArray(v)) {
      for (const item of v) {
        if (exprNodeHasMarkupValue(item)) return true;
      }
    } else if (v && typeof v === "object") {
      if (exprNodeHasMarkupValue(v)) return true;
    }
  }
  return false;
}

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
  /**
   * §59.8 / §14.11 (S169) — the optional 2-name positional destructure
   * `as (k, v)` on a `<each in=@m.entries()>` opener. When present, the
   * iterated entry struct's fields bind positionally: `asNames[0] ← .key`,
   * `asNames[1] ← .value`. The iterated value remains the `{ key, value }`
   * struct; this is terseness sugar over `as e` + `e.key`/`e.value`. Null for
   * the single-name `as e` form (the common case) and when no `as` is present.
   */
  asNames: [string, string] | null;
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
  /**
   * g-each-over-arm-payload-binding-unbound (2026-06-17) — set at LIFT time by
   * emit-match's buildMatchArms / emit-engine's buildEngineArms when this
   * each-block's `in=` iterable is the ENCLOSING match-/engine-arm's PAYLOAD
   * BINDING (e.g. arm `.Loaded(rows)` → body `<each in=rows>`). After arm-body
   * flattening the each loses its arm association, so `collectEachBlocks`
   * (post-flatten) cannot see the binding; the each render fn is a top-level
   * no-arg fn and `const _items = rows;` would reference an UNBOUND name →
   * `ReferenceError` at mount. With this stamp, emitEachBodyRenderForFile
   * resolves the iterable from the reactive cell instead — the binding value
   * lives at `_scrml_reactive_get(cellName).data[fieldName]` when the current
   * variant is `variantTag`. ONE shared mechanism for match + engine arms
   * (emitted shape is identical). Null/absent for every non-arm-payload each.
   */
  armPayloadBinding?: {
    /** Reactive cell name driving the arm (match on= cell / engine var). */
    cellName: string;
    /** The variant tag whose payload carries this binding. */
    variantTag: string;
    /** The runtime data key (declared variant field name, position-resolved). */
    fieldName: string;
  } | null;
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
// g-each-over-arm-payload-binding-unbound (2026-06-17) — arm-payload stamp
// ---------------------------------------------------------------------------

/**
 * Walk an arm's renderable body subtree and stamp every `<each in=BINDING>`
 * whose `in=` iterable is a BARE reference to one of the arm's payload bindings
 * with `armPayloadBinding` (cell name + variant tag + runtime field name). This
 * is called at LIFT time — from emit-match's `buildMatchArms` and emit-engine's
 * `buildEngineArms` — where the arm-payload binding context IS known. After the
 * arm-body flatten the each-block loses its arm association (match: lifted into
 * `matchBlock.bodyChildren`; engine: lives in the state-child markup children),
 * so the post-flatten `collectEachBlocks` walker cannot recover it. The stamp
 * survives because it mutates the same node refs `collectEachBlocks` later finds.
 *
 * ONE shared mechanism for BOTH match-arm and engine-arm payload bindings — the
 * emitted shape (`_scrml_reactive_get(cell).data[field]` gated on the variant)
 * is identical. `cellName` is the reactive cell driving the arm (match's `on=`
 * cell / engine var). `payloadBindings[i]` is the local binding name and
 * `payloadFieldNames[i]` its position-resolved runtime data key (defaults to the
 * binding name when field-name resolution was unavailable). Iterables that are
 * NOT a bare payload-binding reference (e.g. `@cell`, `g.items`, a count) are
 * left untouched — they resolve through the existing module-scope paths.
 *
 * The match-side restamp gives lifted each-blocks a big synthetic id; the
 * engine-side each keeps its file-counter id. Either way the node ref is the
 * one `collectEachBlocks` returns, so the stamp is the right node.
 */
export function stampArmPayloadEaches(
  body: any,
  cellName: string,
  variantTag: string,
  payloadBindings: string[],
  payloadFieldNames: string[] | undefined,
): void {
  if (!cellName || !variantTag) return;
  if (!Array.isArray(payloadBindings) || payloadBindings.length === 0) return;
  // binding-name -> runtime field name (default: the binding name itself).
  const fieldFor = new Map<string, string>();
  for (let i = 0; i < payloadBindings.length; i++) {
    const local = payloadBindings[i];
    if (!local) continue;
    const field = (payloadFieldNames && payloadFieldNames[i]) ? payloadFieldNames[i] : local;
    fieldFor.set(local, field);
  }
  if (fieldFor.size === 0) return;

  const seen = new WeakSet<object>();
  function walk(node: any, insideNestedScope: boolean): void {
    if (!node || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const n of node) walk(n, insideNestedScope);
      return;
    }
    if (node.kind === "each-block") {
      // Only a TOP-LEVEL each (directly in the arm body, NOT nested inside
      // another each's per-item template) reads the arm payload from module
      // scope. A nested each's source references the OUTER each's iter var and
      // is emitted INLINE in the outer factory (where that binding IS in scope),
      // so it must NOT be redirected to the reactive cell.
      const eb = node as EachBlockAstNode;
      if (!insideNestedScope && eb.iterShape === "in") {
        const raw = String(eb.inExprRaw ?? "").trim();
        // The iterable must be a BARE identifier (the payload binding name).
        // `@cell`, `g.items`, `rows.filter(...)` etc. are NOT a bare binding ref
        // — leave them to the existing resolution paths.
        if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(raw) && fieldFor.has(raw)) {
          eb.armPayloadBinding = {
            cellName,
            variantTag,
            fieldName: fieldFor.get(raw)!,
          };
        }
      }
      // Descend into this each's per-item template under a NESTED scope (any
      // each found there is iter-scoped to THIS each, not the arm payload).
      if (Array.isArray(eb.templateChildren)) walk(eb.templateChildren, true);
      // <empty> body is NOT iter-scoped, but it is also not a payload-binding
      // iteration site; descend under the current scope for completeness.
      if (eb.emptyChild) walk(eb.emptyChild, insideNestedScope);
      if (Array.isArray(eb.bodyChildren)) walk(eb.bodyChildren, true);
      return;
    }
    // Recurse into known container fields. Arm bodies / nested markup are NOT a
    // new iteration scope, so `insideNestedScope` carries through unchanged.
    for (const key of ["children", "body", "bodyChildren", "nodes", "arms", "templateChildren"]) {
      if (Array.isArray((node as any)[key])) walk((node as any)[key], insideNestedScope);
    }
  }
  walk(body, false);
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
// ---------------------------------------------------------------------------
// g-each-peritem-markup-value-ternary (GITI-032 follow-on, 2026-06-25) — lower a
// markup-as-value (Pillar 1, SPEC §1.4 / §7.4) that appears in a per-item `<each>`
// interpolation (`${ @.active ? <span>ON ${@.label}</span> : "" }`).
//
// The match/engine arm paths lower a markup-value ternary via emitMarkupValueExpr
// (emit-expr.ts markup-value case). The each per-item path needs TWO extra things
// those paths do not: (a) `@.field` iter-scope must lower to the factory binding,
// and (b) the markup-value must re-render on a keyed reconcile (toggle / replace).
// Pre-fix the each path SKIPPED markup-values entirely (clean compile, non-render).
//
// Lowering (all contained in the each machinery — emit-lift's shared markup-value
// codegen is reused UNCHANGED):
//   1. deep-clone the exprNode (codegen must not mutate the shared AST), then walk
//      it: rewrite every `@.field` ident name -> `<iterVar>.field`, and SPLIT each
//      markup TEXT child carrying `${...}` into alternating text + logic(bare-expr)
//      children so emitCreateElementFromMarkup interpolates them (it renders a raw
//      text child's `${...}` literally — a pre-existing gap that also affects match
//      arms; here the split feeds it parsed, iter-scope-lowered interpolation nodes).
//   2. emit the ternary via emitExprField (the markup arm routes through
//      emitMarkupValueExpr -> a DOM-node IIFE; the string arm stays a string).
//   3. mount a stable per-item wrapper element + a live-keyed `_scrml_effect`
//      (maybeWrapEachPerItemEffect) that re-resolves the item by key, re-evaluates
//      the value, and replaceChildren() with the built node (or text / nothing).
//      The rebuild-on-reconcile is required because the CONDITION can flip
//      (active -> inactive removes the markup), so a single build cannot suffice.
// ---------------------------------------------------------------------------

/**
 * Split a markup-text string into alternating literal / `${expr}` parts.
 *
 * The `${expr}` terminator is found by `{`/`}` depth-counting, but braces INSIDE
 * a string literal (`"…"`, `'…'`, backtick) are DATA, not structure — so the
 * scan tracks an active string-delimiter and skips braces within it (respecting
 * `\`-escapes). Without this, a lone/unmatched brace in a string literal (e.g.
 * `${ @.k == "a" ? "}" : @.p }`) truncated the expr at the wrong `}` → the
 * emitter shipped malformed JS → E-CODEGEN-INVALID-LOGIC (GITI-033 review #1).
 * SHARED by `splitEachMarkupTextChildren` — that path is hardened identically.
 */
function splitMarkupTextInterp(value: string): Array<{ type: "text" | "expr"; v: string }> {
  const parts: Array<{ type: "text" | "expr"; v: string }> = [];
  let i = 0;
  const n = value.length;
  let buf = "";
  while (i < n) {
    if (value[i] === "$" && i + 1 < n && value[i + 1] === "{") {
      if (buf) { parts.push({ type: "text", v: buf }); buf = ""; }
      let depth = 1;
      let j = i + 2;
      let quote: string | null = null; // active string-literal delimiter, or null
      while (j < n && depth > 0) {
        const c = value[j];
        if (quote !== null) {
          // Inside a string literal — the matching UNESCAPED delimiter ends it;
          // braces here are data and do NOT move the structural depth.
          if (c === "\\") { j += 2; continue; }
          if (c === quote) quote = null;
          j++;
          continue;
        }
        if (c === '"' || c === "'" || c === "`") { quote = c; j++; continue; }
        if (c === "{") { depth++; j++; continue; }
        if (c === "}") { depth--; if (depth === 0) break; j++; continue; }
        j++;
      }
      parts.push({ type: "expr", v: value.slice(i + 2, j) });
      i = j + 1;
    } else {
      buf += value[i];
      i++;
    }
  }
  if (buf) parts.push({ type: "text", v: buf });
  return parts;
}

/**
 * Replace markup TEXT children carrying `${...}` with alternating text + logic
 * (bare-expr) children, iter-scope-lowering each interpolation interior so
 * `@.field` -> `<iterVar>.field`. emitCreateElementFromMarkup renders the logic
 * children as interpolated text nodes (the raw-text path would emit `${...}`
 * literally). On a parse failure the interior is kept as a literal (best effort).
 */
function splitEachMarkupTextChildren(children: any[], iterVarName: string): any[] {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { parseExprToNode } = require("../expression-parser.ts") as {
    parseExprToNode: (r: string, f: string, o: number) => any;
  };
  const out: any[] = [];
  for (const ch of children) {
    if (ch && ch.kind === "text" && typeof ch.value === "string" && ch.value.includes("${")) {
      for (const p of splitMarkupTextInterp(ch.value)) {
        if (p.type === "text") {
          if (p.v) out.push({ kind: "text", value: p.v });
        } else {
          const lowered = rewriteContextualSigil(p.v.replace(/@\s*\.\s*/g, "@."), iterVarName);
          let node: any = null;
          try { node = parseExprToNode(lowered, "", 0); } catch { node = null; }
          if (node && typeof node === "object" && node.kind !== "escape-hatch") {
            out.push({ kind: "logic", body: [{ kind: "bare-expr", exprNode: node }] });
          } else {
            // Unparseable interior — keep the (lowered) literal rather than drop it.
            out.push({ kind: "text", value: "${" + lowered + "}" });
          }
        }
      }
    } else {
      out.push(ch);
    }
  }
  return out;
}

/**
 * Recursively rewrite a (cloned) markup-value-bearing exprNode for the each
 * per-item scope: lower `@.field` ident names to the iter binding and split
 * markup-text `${...}` interpolations into parsed, iter-scope-lowered children.
 */
function rewriteEachScopeInExprNode(n: any, iterVarName: string): void {
  if (!n || typeof n !== "object") return;
  if (Array.isArray(n)) { for (const x of n) rewriteEachScopeInExprNode(x, iterVarName); return; }
  if (n.kind === "ident" && typeof n.name === "string" && n.name.includes("@")) {
    n.name = rewriteContextualSigil(n.name.replace(/@\s*\.\s*/g, "@."), iterVarName);
  }
  if (n.kind === "markup") {
    // GITI-033 innermost-scope (§17.7.3) — a NESTED `<each>` REBINDS `@.` to its
    // OWN item, so the enclosing per-item scope must NOT rewrite `@.` inside the
    // inner each's BODY. Rewrite only the each's SOURCE/key attributes (which DO
    // resolve in the enclosing scope, e.g. `in=@.files`), then STOP: the body's
    // `@.` is lowered later against the INNER iter var by renderTemplateChildToJs.
    // Descending here clobbered `<li>${@.}` → `${enclosingIterVar}` (every inner
    // row rendered the OUTER item instead of the inner one).
    const _tag = String((n as any).tag ?? (n as any).name ?? "");
    if (_tag === "each") {
      const _attrs = (n as any).attributes ?? (n as any).attrs;
      if (Array.isArray(_attrs)) rewriteEachScopeInExprNode(_attrs, iterVarName);
      return;
    }
    if (Array.isArray(n.children)) {
      n.children = splitEachMarkupTextChildren(n.children, iterVarName);
    }
  }
  for (const k of Object.keys(n)) {
    const v = (n as Record<string, unknown>)[k];
    if (v && typeof v === "object") rewriteEachScopeInExprNode(v, iterVarName);
  }
}

/**
 * Emit a per-item markup-value interpolation: a stable wrapper element + a
 * live-keyed effect that (re)builds the markup-value into it on reconcile.
 */
function emitEachPerItemMarkupValue(
  exprNode: any,
  iterVarName: string,
  fragmentVar: string,
  lines: string[],
  indent: string,
): void {
  // Deep-clone so the shared AST is not mutated (codegen may revisit it), then
  // lower iter-scope + split markup-text interpolations.
  const clone = JSON.parse(JSON.stringify(exprNode));
  rewriteEachScopeInExprNode(clone, iterVarName);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { emitExprField } = require("./emit-expr.ts") as {
    emitExprField: (n: any, fb: string, c: Record<string, unknown>) => string;
  };
  const valueExpr = emitExprField(clone, "", { mode: "client" });
  const wrapVar = `_scrml_each_mv_${nextLocalId()}`;
  const valVar = `_scrml_mv_v_${nextLocalId()}`;
  lines.push(`${indent}const ${wrapVar} = document.createElement("span");`);
  lines.push(`${indent}${wrapVar}.setAttribute("data-scrml-mv", "");`);
  lines.push(`${indent}${fragmentVar}.appendChild(${wrapVar});`);
  // The rebuild body re-evaluates the markup-value and swaps the wrapper's
  // content. A DOM node is appended directly; a non-empty string becomes a text
  // node; "" / absence renders nothing (the inactive ternary arm).
  const body = [
    `${indent}const ${valVar} = (${valueExpr});`,
    `${indent}${wrapVar}.replaceChildren();`,
    `${indent}if (${valVar} instanceof Node) ${wrapVar}.appendChild(${valVar});`,
    `${indent}else if (${valVar} !== null && ${valVar} !== undefined && ${valVar} !== "") ${wrapVar}.appendChild(document.createTextNode(String(${valVar})));`,
  ];
  for (const l of maybeWrapEachPerItemEffect(body, iterVarName, indent)) lines.push(l);
}

/**
 * Emit one `${expr}` interpolation (interior text already extracted) as a
 * per-item text node. Under an active reconcile ctx bound to THIS iter var it is
 * live-keyed (a stable text node + a per-item effect that re-resolves + re-reads
 * on reconcile — Bug 64 / R28-1c); otherwise a static string append. SHARED by
 * the `logic`-child branch AND the GITI-033 text-child `${...}`-split branch so
 * the two emit byte-identical interpolation JS (no fork).
 */
/**
 * 6nz-F4 edge 5 — does an each per-item element carry a `bind:value` binding?
 * When it does, the canonical two-way value binding wins and the RCDATA content
 * carve-out is suppressed (parity with the top-level bind:value-conflict ruling
 * W-RCDATA-BIND-VALUE-CONTENT-CONFLICT; the top-level path emits the warning).
 */
function eachHasBindValue(attrs: any[]): boolean {
  return attrs.some(
    (a) => a && (String(a.name ?? "") === "bind:value" || String(a.name ?? "") === "bind:valueAsNumber"),
  );
}

/**
 * 6nz-F4 edge 5 — build the `.value` concatenation expression for a `<textarea>`
 * (RCDATA element) reactive body in an `<each>` per-item template. Inside RCDATA
 * a child text node / interp is the element's VALUE, not mountable content, so
 * the per-item factory must set `elVar.value` from the concatenated content
 * rather than appending child text nodes. Returns the JS concatenation string,
 * or null when the body carries NO interpolation (pure-static text renders fine
 * as textarea content through the normal recursion) or an unsupported child
 * shape is present (bail to the normal path — no behavior change).
 */
function eachRcdataValueExpr(children: any[], iterVarName: string): string | null {
  const terms: string[] = [];
  let hasInterp = false;
  for (const child of children) {
    if (!child || typeof child !== "object") continue;
    if (child.kind === "text") {
      const txt = String((child as any).value ?? (child as any).text ?? "");
      if (txt.includes("${")) {
        for (const part of splitMarkupTextInterp(txt)) {
          if (part.type === "text") {
            if (part.v) terms.push(JSON.stringify(rewriteContextualSigil(part.v, iterVarName)));
          } else {
            terms.push(`String(${lowerEachExpr(part.v.replace(/\s*\.\s*/g, "."), iterVarName)})`);
            hasInterp = true;
          }
        }
      } else if (txt) {
        terms.push(JSON.stringify(rewriteContextualSigil(txt, iterVarName)));
      }
      continue;
    }
    if (child.kind === "comment") continue;
    if (
      child.kind === "logic" &&
      Array.isArray((child as any).body) &&
      (child as any).body.length === 1 &&
      (child as any).body[0]?.kind === "bare-expr"
    ) {
      const stmt = (child as any).body[0];
      // Markup-as-value in a textarea body is not a value-text case — bail.
      if (exprNodeHasMarkupValue(stmt.exprNode)) return null;
      const exprText = stmt.expr
        ? String(stmt.expr)
        : (stmt.exprNode ? emitStringFromTree(stmt.exprNode) : "");
      const inner = exprText.replace(/\s*\.\s*/g, ".");
      if (!inner) continue;
      terms.push(`String(${lowerEachExpr(inner, iterVarName)})`);
      hasInterp = true;
      continue;
    }
    // Unsupported child shape — bail to the normal recursion.
    return null;
  }
  if (!hasInterp) return null;
  return terms.length > 0 ? terms.join(" + ") : `""`;
}

function emitEachInterpExprToJs(
  inner: string,
  iterVarName: string,
  fragmentVar: string,
  lines: string[],
  indent: string,
): void {
  const rewritten = lowerEachExpr(inner, iterVarName);
  if (currentEachReconcileCtx() && currentEachReconcileCtx()!.iterVar === iterVarName) {
    const _tnVar = `_scrml_each_tn_${nextLocalId()}`;
    lines.push(`${indent}const ${_tnVar} = document.createTextNode("");`);
    lines.push(`${indent}${fragmentVar}.appendChild(${_tnVar});`);
    for (const _l of maybeWrapEachPerItemEffect(
      [`${indent}${_tnVar}.textContent = String(${rewritten});`], iterVarName, indent,
    )) lines.push(_l);
  } else {
    lines.push(`${indent}${fragmentVar}.appendChild(document.createTextNode(String(${rewritten})));`);
  }
}

function renderTemplateChildToJs(
  child: any,
  iterVarName: string,
  _iterIdxName: string,
  fragmentVar: string,
  lines: string[],
  indent: string,
  engineCtx: EachEngineCtx | null = null,
  parentIsRawContent: boolean = false,
): void {
  if (!child || typeof child !== "object") return;

  // Text children are typically whitespace-only — skip empty / WS-only runs.
  if (child.kind === "text") {
    const txt = String((child as any).value ?? (child as any).text ?? "");
    if (!txt.trim()) return;
    // SPEC §4.17 raw-content (`<pre>`/`<code>`) — emit the body VERBATIM. The
    // block splitter captured `${@.id}` as literal text (no logic node), so
    // running `rewriteContextualSigil` here would half-rewrite `@.id` to
    // `_scrml_each_item.id` and corrupt the §4.17 verbatim literal into the
    // nonsense `${_scrml_each_item.id}` (GITI-030). Top-level `<code>` already
    // ships the body verbatim; this keeps the per-item path parity-correct.
    if (parentIsRawContent) {
      lines.push(`${indent}${fragmentVar}.appendChild(document.createTextNode(${JSON.stringify(txt)}));`);
      return;
    }
    // GITI-033 — a lifted-markup TEXT child can carry `${...}` interpolations
    // VERBATIM (the ternary-markup / match-arm markup parser keeps `<li>${@.}` as
    // a literal text child, unlike the for-lift path which hands us a `logic`
    // node). Pre-fix this text branch ran `rewriteContextualSigil` over the whole
    // string and JSON.stringify'd it, so `${@.kind}` shipped into the DOM as the
    // literal text `${_scrml_each_item.kind}` (rendered, not interpolated). Split
    // the text into literal + `${expr}` segments and lower each interpolation to
    // a per-item (live-keyed) text node — the SAME emission as the `logic`-child
    // branch. Guarded on the `${` presence, so a `logic`-node interpolation (the
    // for-lift / Bug 72 path) never reaches here → that path stays byte-identical.
    if (txt.includes("${")) {
      for (const part of splitMarkupTextInterp(txt)) {
        if (part.type === "text") {
          if (part.v) {
            const litRw = rewriteContextualSigil(part.v, iterVarName);
            lines.push(`${indent}${fragmentVar}.appendChild(document.createTextNode(${JSON.stringify(litRw)}));`);
          }
        } else {
          // Collapse the BS-padded sigil-dot before lowering (mirrors the logic
          // branch's `inner` normalization) so `@ . kind` → `@.kind` lowers.
          emitEachInterpExprToJs(part.v.replace(/\s*\.\s*/g, "."), iterVarName, fragmentVar, lines, indent);
        }
      }
      return;
    }
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
    // g-each-peritem-if-predicate — a per-item `if=` conditional. Build the
    // element, then gate its append on the lowered predicate below (the each
    // render-fn re-runs on collection change, so the conditional re-evaluates).
    let ifCond: string | null = null;
    for (const attr of attrs) {
      if (attr && String(attr.name ?? "") === "if") {
        const v = attr.value;
        const raw = v && v.kind === "expr" ? String(v.raw ?? "")
          : v && v.kind === "variable-ref" ? String(v.name ?? "")
          : v && v.kind === "string-literal" ? JSON.stringify(String(v.value ?? "")) : "";
        if (raw) ifCond = lowerEachExpr(raw, iterVarName);
        continue;                                 // conditional, not a setAttribute
      }
      renderTemplateAttrToJs(attr, iterVarName, _iterIdxName, elVar, lines, indent, engineCtx);
    }

    // 6nz-F4 edge 5 — RCDATA (<textarea>) reactive body in an each per-item
    // template. Inside RCDATA a child text node IS the element's value, so the
    // per-item factory must set `elVar.value` from the concatenated body rather
    // than appending child text nodes (which would not track `.value` reliably).
    // Suppressed when a `bind:value` binding is present (that wins). Wrapped in
    // the per-item effect so it re-resolves on reconcile.
    const _rcdataValueExpr =
      isRcdataElement(tagName) &&
      !isShorthand &&
      !eachHasBindValue(attrs) &&
      Array.isArray((child as any).children) &&
      (child as any).children.length > 0
        ? eachRcdataValueExpr((child as any).children, iterVarName)
        : null;

    if (isShorthand && shorthandExpr !== null) {
      // `:`-shorthand body — single-expression body becomes textContent.
      // Rewrite `@.` to iterVar so `<li : @.name>` → `item.name`.
      const exprRewritten = rewriteContextualSigil(shorthandExpr, iterVarName);
      // Cast result to string for textContent assignment. Bug 64 (S159) —
      // live-keyed under a reconcile ctx so same-key reconcile reflects new data.
      for (const _l of maybeWrapEachPerItemEffect(
        [`${indent}${elVar}.textContent = String(${exprRewritten});`], iterVarName, indent,
      )) lines.push(_l);
    } else if (_rcdataValueExpr !== null) {
      // eachRcdataValueExpr already yields a string (each interp term is
      // String()-wrapped; static runs are JSON string literals), so no outer cast.
      for (const _l of maybeWrapEachPerItemEffect(
        [`${indent}${elVar}.value = ${_rcdataValueExpr};`], iterVarName, indent,
      )) lines.push(_l);
    } else if (Array.isArray((child as any).children) && (child as any).children.length > 0) {
      // Bare-body — recurse into children. SPEC §4.17 — when THIS element is a
      // raw-content element (`<pre>`/`<code>`), its captured text children must
      // emit verbatim (no `${...}` interpolation, no `@.`-sigil rewrite), so
      // flag the child recursion. The flag is local (a raw-content element has
      // a single text run and no further markup descent), so descendants of a
      // non-raw element correctly recurse with the flag cleared.
      const childIsRawContent =
        RAW_CONTENT_ELEMENT_NAMES.has(tagName.toLowerCase());
      const innerFragVar = `_scrml_frag_${nextLocalId()}`;
      lines.push(`${indent}const ${innerFragVar} = document.createDocumentFragment();`);
      for (const grand of (child as any).children) {
        renderTemplateChildToJs(grand, iterVarName, _iterIdxName, innerFragVar, lines, indent, engineCtx, childIsRawContent);
      }
      lines.push(`${indent}${elVar}.appendChild(${innerFragVar});`);
    }
    // self-closing: no body.

    if (ifCond) {
      lines.push(`${indent}if (${ifCond}) ${fragmentVar}.appendChild(${elVar});`);
    } else {
      lines.push(`${indent}${fragmentVar}.appendChild(${elVar});`);
    }
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
        // GITI-032 (deferred sub-case) — a markup-as-value NESTED in this
        // per-item interpolation (`${ @. == "a" ? <span>X</span> : "" }`). The
        // ast-builder gate now hands us a markup-value-bearing exprNode (was a
        // silently-dropped raw html-fragment pre-GITI-032). The match/engine arm
        // paths lower this via emitMarkupValueExpr, but the EACH per-item path
        // needs iter-var (`@.`) scope threaded INTO the markup-value DOM-build
        // (emitCreateElementFromMarkup does not yet rewrite `@.` to the iter
        // binding), so a full lowering is a separate follow-on. Until then,
        // PRESERVE the pre-GITI-032 clean-compile behavior (skip) rather than
        // emit a raw `String(< span > … )` that fails the E-CODEGEN-INVALID-LOGIC
        // gate. Surfaced as a deferred item; NOT a silent correctness change vs.
        // the prior behavior (which also did not render the markup).
        // g-each-peritem-markup-value-ternary (GITI-032 follow-on) — lower the
        // markup-as-value (build DOM, resolve `@.` to the item, live-key on
        // reconcile) instead of skipping. See emitEachPerItemMarkupValue.
        if (exprNodeHasMarkupValue((stmt as any).exprNode)) {
          emitEachPerItemMarkupValue((stmt as any).exprNode, iterVarName, fragmentVar, lines, indent);
          return;
        }
        // ExprNode-preference contract (mirrors emit-html.ts:1888 + the
        // `makeBareExpr` bridge comment in native-parser/translate-stmt.ts:
        // "codegen prefers exprNode"). The legacy ast-builder populates a
        // non-empty `expr` (tokenizer-rejoined text) AND an `exprNode`; the
        // native A1 bridge deliberately sets `expr: ""` and carries the live
        // expression in `exprNode` only. Prefer the non-empty `expr` when
        // present so the LEGACY path stays byte-identical; else fall back to
        // `emitStringFromTree(exprNode)` for the native shape.
        //
        // Uniformly apply the dot-normalization to the resolved string in
        // BOTH branches: the legacy `expr` text carries tokenizer spaces
        // around `.`, and `emitStringFromTree` re-emits the contextual sigil
        // `@.` as `@ .` (a space). `rewriteContextualSigil` only matches the
        // un-spaced `@.`, so collapsing `/\s*\.\s*/` → "." is required for
        // both the legacy `${@.}` form AND the native exprNode-derived form.
        const _exprText = stmt.expr
          ? String(stmt.expr)
          : (stmt.exprNode ? emitStringFromTree(stmt.exprNode) : "");
        inner = _exprText.replace(/\s*\.\s*/g, ".");
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
    // of the factory closure). lowerEachExpr ADDS §42 predicate lowering
    // (`is some`/`is not`/`not`) when present — g-each-peritem-if-predicate C1.
    // Bug 64 / R28-1c (S159) — inside a reconciled per-item factory this becomes
    // a LIVE-KEYED text node (re-resolve item by key on reconcile); outside a
    // reconcile ctx it is the static string append. Shared emitter (GITI-033).
    emitEachInterpExprToJs(inner, iterVarName, fragmentVar, lines, indent);
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
    // The item-local mount is created + appended ONCE (stable DOM node identity
    // across inner re-renders); the inner reconcile writes into it in place.
    lines.push(`${indent}const ${innerMountVar} = document.createElement("div");`);
    lines.push(`${indent}${innerMountVar}.setAttribute("data-scrml-each-mount", "each_${innerNode.id}");`);
    lines.push(`${indent}${fragmentVar}.appendChild(${innerMountVar});`);
    // g-nested-each-no-own-subscription (2026-06-21) — the inner each must own a
    // reactive subscription to ITS source so a post-mount cell update (the
    // load-on-demand case: `@shared` empty at outer-render, populated by a later
    // event) re-renders it. Pre-fix this branch read the source ONCE and ran the
    // reconcile ONCE inline (a bare IIFE) — NO subscription — so the inner list
    // froze at its outer-render-time value (EMPTY in the load-on-demand case).
    //
    // Fix (Approach C): wrap the source-read + reconcile in a PER-ITEM
    // `_scrml_effect`. This closure already binds BOTH the OUTER iter var (so a
    // source depending on the enclosing scope — `<each in=g.items>` — resolves)
    // AND the closure-captured `innerMountVar` (so the effect re-reconciles THIS
    // outer item's own mount — N outer items share the `each_<id>` data-attr, so
    // a single global renderer keyed by that id could not address them
    // individually). `_scrml_effect` un-pauses dependency tracking around its
    // body (runtime-template.js, S139 Bug 11), so the `_scrml_reactive_get(...)`
    // inside `innerItemsExpr` SUBSCRIBES correctly even though this effect is
    // created during the OUTER `_scrml_reconcile_list` pass (which pauses
    // tracking). Lifecycle is identical to the existing per-item text/class
    // effects: when the outer item is removed the effect is not explicitly
    // disposed but goes inert (its mount detached) — no NEW leak class. The
    // `return` in the empty-guard (from emitEachReconcileLines) short-circuits
    // ONLY this effect callback.
    //
    // g-nested-each-outer-key-reuse-inner-frozen (S212 Approach-C residual) — the
    // S212 effect read `innerItemsExpr` (`g.subitems`) off the CREATE-TIME OUTER
    // closure param, never re-resolved by key. So on a keyed reconcile that REUSES
    // the outer row node (same outer key) while the outer item's iterated field
    // changes (array-replace / push into `@.subitems`), the inner each stayed
    // FROZEN at the create-time outer value. Inject the OUTER-item live-keying
    // prelude (the SAME shape maybeWrapEachPerItemEffect uses for text/handlers) so
    // the source read hits the LIVE outer item: `_scrml_resolve_item` tracks the
    // OUTER mount's item slot, so the outer `_scrml_reconcile_list` re-fires this
    // inner effect, and the re-resolved `<outerIter>` re-reads the new field value.
    // The OUTER ctx is captured here (currentEachReconcileCtx() is still the OUTER
    // each's ctx — emitEachReconcileLines pushes the INNER ctx only inside the loop
    // below). _scrml_resolve_item already exists in runtime-template.js — no runtime
    // change. Null/mismatched ctx (defensive) emits the byte-identical S212 shape.
    const _outerCtx = currentEachReconcileCtx();
    lines.push(`${indent}_scrml_effect(() => {`);
    if (_outerCtx && _outerCtx.iterVar === iterVarName) {
      lines.push(`${indent}  let ${_outerCtx.iterVar} = _scrml_resolve_item(${_outerCtx.mountVar}, ${_outerCtx.keyVar});`);
      lines.push(`${indent}  if (${_outerCtx.iterVar} === null) return;`);
      for (const l of emitDestructureBindingLines(_outerCtx.destructure, _outerCtx.iterVar, `${indent}  `)) {
        lines.push(l);
      }
    }
    lines.push(`${indent}  const ${innerItemsVar} = ${innerItemsExpr};`);
    for (const l of emitEachReconcileLines(innerNode, innerIterVar, innerIdxName, innerMountVar, innerItemsVar, `${indent}  `, engineCtx)) {
      lines.push(l);
    }
    lines.push(`${indent}});`);
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
function rewriteIterValueExpr(text: string, iterVarName: string | null): string {
  if (!text || typeof text !== "string") return text;
  let expr = text.replace(/@\s*\.\s*/g, "@.");
  expr = rewriteContextualSigil(expr, iterVarName);
  expr = rewriteAtCellAccess(expr);
  return expr;
}

/**
 * Bug 62 (S156) — iter-scope-ONLY lowering, used to pre-rewrite an engine
 * handler expression BEFORE handing it to the engine-aware structured path
 * (parseExprToNode + emitExprField / rewriteBlockBody).
 *
 * Lowers the iter-local `@`-forms (`@.field` → `col.field`, `@.` → `col`) and
 * collapses the BS-padded sigil-dot, but deliberately does NOT run
 * `rewriteAtCellAccess`: the bare `@cell` / `@engineVar` forms MUST survive
 * here so (a) the engine var sigil is intact for C13 detection and (b) emit-expr
 * / rewriteBlockBody can lower `@cell` reads to `_scrml_reactive_get(...)`
 * downstream. (rewriteIterValueExpr eagerly rewrites `@cell` → `_scrml_reactive_get`,
 * which would clobber `@engineVar` before the engine pass could see it.)
 */
function rewriteIterScopeOnly(text: string, iterVarName: string): string {
  if (!text || typeof text !== "string") return text;
  const expr = text.replace(/@\s*\.\s*/g, "@.");
  return rewriteContextualSigil(expr, iterVarName);
}

/**
 * g-each-peritem-if-predicate-not-lowered — lower a per-item expression that may
 * carry a §42 absence predicate (`is some` / `is not` / `is not not` / `not`).
 * The text-based `rewriteIterValueExpr` lowers iter-scope (`@.field`→iterVar) +
 * `@cell`→reactive-get but does NOT lower predicates, so `String((x is some))`
 * leaks as invalid JS. When a predicate IS present, route the (iter-lowered)
 * text through the STRUCTURED emitter (parseExprToNode → emitExprField), which
 * lowers `is some` → `(v !== null && v !== undefined)` etc.; fall back to the
 * text path on a parse failure or when no predicate is present (common case —
 * avoids the parse round-trip + any emit-expr divergence).
 */
function lowerEachExpr(text: string, iterVarName: string): string {
  const preRewritten = rewriteIterValueExpr(text, iterVarName);
  // Route through the structured emitter when the text carries a §42 absence
  // predicate (`is some`/`is not`/`is given`/`not`) OR a bare `.Variant` enum
  // literal (leading-dot + uppercase, NOT preceded by an ident-char/`)`/`]`/`.`
  // so member access `card.id` / method-chain `foo().Bar` / `obj.Foo` are
  // EXCLUDED) — g-each-body-bare-variant-arg (S201): emit-expr.ts:295 lowers
  // `.InProgress` → its frozen string `"InProgress"`; the text path does not,
  // so a bare-variant leaked raw into the each-render-fn → E-CODEGEN-INVALID-LOGIC.
  if (!/\bis\s+(?:some|not|given)\b|(?:^|[^.\w@])not\s|(?:^|[^.\w$)\]])\.[A-Z]/.test(preRewritten)) return preRewritten;
  try {
    const { parseExprToNode } = require("../expression-parser.ts") as {
      parseExprToNode: (raw: string, filePath: string, offset: number) => unknown;
    };
    const node = parseExprToNode(preRewritten, "", 0);
    if (!node || typeof node !== "object") return preRewritten;
    const { emitExprField } = require("./emit-expr.ts") as {
      emitExprField: (n: unknown, fallback: string, ctx: Record<string, unknown>) => string;
    };
    return emitExprField(node, preRewritten, { mode: "client" });
  } catch (_e) {
    return preRewritten;
  }
}

/**
 * Detect the DOM event name for an event-handler attribute, or null when the
 * attribute is not an event handler.
 *   - `onclick`     → "click"   (canonical §5.2.2 form)
 *   - `on:dblclick` → "dblclick" (namespaced §5.2.3 form)
 * Conservative: `on` alone (no event suffix) and `on-...` are not events.
 */
/**
 * g-each-inline-component-prop-member-unsubstituted (Approach B, step 2/3).
 *
 * Build a JS template literal from a string-literal attr value that may carry
 * `${expr}` interpolations (`href="/x/${@.id}"`, an inlined component root
 * `class="pill ${cls(@.status)}"`). The per-item attr path previously emitted the
 * raw literal via JSON.stringify, so the `${}` shipped UNEVALUATED into the DOM.
 * Each `${...}` segment's interior is lowered via `lowerEachExpr` (iter-scope
 * rewrite + §42-predicate / bare-variant lowering); literal text is escaped for
 * the backtick context. Returns null when the value has no `${}` (caller keeps
 * the plain JSON.stringify set, byte-identical to pre-fix).
 */
function buildEachAttrTemplate(value: string, iterVarName: string): string | null {
  if (!value.includes("${")) return null;
  let tpl = "`";
  let i = 0;
  const n = value.length;
  while (i < n) {
    if (value[i] === "$" && i + 1 < n && value[i + 1] === "{") {
      // Find the matching `}` (brace-balanced).
      let depth = 1;
      let j = i + 2;
      while (j < n && depth > 0) {
        const c = value[j];
        if (c === "{") depth++;
        else if (c === "}") depth--;
        if (depth === 0) break;
        j++;
      }
      const inner = value.slice(i + 2, j);
      tpl += "${" + lowerEachExpr(inner, iterVarName) + "}";
      i = j + 1;
    } else {
      const c = value[i];
      if (c === "`") tpl += "\\`";
      else if (c === "\\") tpl += "\\\\";
      else tpl += c;
      i++;
    }
  }
  tpl += "`";
  return tpl;
}

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
 * g-expr-event-handler-dead-in-each (Family-A Half-2, 2026-06-25) — lower a
 * `${...}` event-handler expression into the INNER listener body statement(s)
 * that go inside the per-item `function(event) { ... }` wrapper.
 *
 * `preLowered` has iter-scope already lowered (`rewriteIterScopeOnly`: `@.field`
 * -> iterVar.field while `@cell` / `@engineVar` survive). Engine transitions are
 * intercepted by emitEngineHandlerBody BEFORE this; here we converge the
 * NON-engine fallback onto the structured emitter (the SAME emitExprField the
 * canonical top-level `buildHandlerExpr` in emit-variant-guard.ts uses), so:
 *   - arrow `(...)=>body` / `fn(params){body}`  -> the function IS the handler ->
 *     INVOKE with the DOM event: `(<fn>)(event);`. (Pre-fix the arrow was emitted
 *     as a DEAD expression statement -> the click was a silent no-op.)
 *   - bare ref `${@h}` / `${handler}`           -> invoke `<ref>(event);`.
 *   - assignment `${@cell = ...}`               -> `_scrml_reactive_set(...)` via
 *     the structured emitter (pre-fix the string-rewriter lowered the LHS to a
 *     GETTER -> `E-CODEGEN-INVALID-LOGIC: Assigning to rvalue`).
 *   - plain expr / call                          -> structured statement.
 *
 * Mirrors buildHandlerExpr's shape dispatch but is a deliberately PARALLEL impl:
 * the iter-scope pre-lowering is each-specific and the each caller supplies its
 * own `function(event){}` wrapper + Bug-73 live-keying prelude
 * (maybeWrapEachPerItemHandler), so sharing buildHandlerExpr (which returns the
 * whole listener function and closes over file-scope engine ctx) would contort
 * both sites. Function-name mangling (`mark` -> `_scrml_mark_N`) is applied by
 * the global post-fn-name-mangle pass (emit-client.ts), so call refs emit raw.
 */
function buildEachExprHandlerBody(preLowered: string, iterVarName: string): string {
  const raw = preLowered.trim();

  // fn-shorthand `fn(params) { body }` — parseExprToNode drops the block body
  // (it returns a bare `call` to `fn`), so detect + extract the param list and
  // body by hand (the same brace-walk buildHandlerExpr uses), then emit a real
  // function and invoke it with the event.
  if (/^fn\s*\(/.test(raw)) {
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
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { rewriteBlockBody } = require("./emit-control-flow.ts") as {
        rewriteBlockBody: (b: string, d: unknown, e: EngineRewriteCtx | null) => string;
      };
      return `(function(${params}) { ${rewriteBlockBody(body, null, null)}; })(event);`;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { parseExprToNode } = require("../expression-parser.ts") as {
    parseExprToNode: (r: string, f: string, o: number) => any;
  };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { emitExprField } = require("./emit-expr.ts") as {
    emitExprField: (n: any, fb: string, c: Record<string, unknown>) => string;
  };

  let node: any = null;
  try {
    node = parseExprToNode(raw, "", 0);
  } catch {
    node = null;
  }
  if (!node || typeof node !== "object") {
    // Unparseable — fall back to the legacy iter-scope text rewrite (lowers
    // `@cell` too) so the handler at least compiles; the structured cases above
    // cover every shape that previously mis-lowered.
    return `${rewriteIterValueExpr(preLowered, iterVarName)};`;
  }

  let lowered: string;
  try {
    lowered = emitExprField(node, raw, { mode: "client" });
  } catch {
    return `${rewriteIterValueExpr(preLowered, iterVarName)};`;
  }

  if (node.kind === "lambda") {
    // The arrow IS the handler — invoke it with the DOM event.
    return `(${lowered})(event);`;
  }
  if (node.kind === "ident") {
    // Bare handler reference (`${@h}` cell handler / `${localHandler}`).
    return `${lowered}(event);`;
  }
  // Plain expression / call / assignment → structured statement.
  return `${lowered};`;
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
  engineCtx: EachEngineCtx | null = null,
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
    // Bug 64 / R28-1c (S159) — was a BARE classList.toggle (sibling-gap #1: not
    // even field-mutation reactive). Now live-keyed so class: re-evaluates on
    // array-replace / reorder / in-place field mutation, matching Tier-0.
    for (const _l of maybeWrapEachPerItemEffect(
      [`${indent}${elVar}.classList.toggle(${JSON.stringify(className)}, !!(${cond}));`], iterVarName, indent,
    )) lines.push(_l);
    return;
  }

  // ---- (2) event handlers — inline addEventListener -----------------------
  const ev = eventNameForAttr(aName);
  if (ev !== null) {
    let handlerBody: string;
    if (valKind === "call-ref") {
      const fnName = String(val.name ?? "");
      // Bug 62 (S156) — engine `.advance(.X)` (e.g. `onclick=@phase.advance(.Active)`)
      // parses as a call-ref `{ name:"@phase.advance", args:[".Active"] }`. Reconstruct
      // the call text with iter-scope-lowered args and try the engine path; if it is
      // a recognised engine transition, lower it through the canonical C13 machinery
      // (`_scrml_engine_advance` / `_scrml_engine_dispatch_message`). Otherwise the
      // existing plain-call emission stands (no regression to `onclick=fn(@.id)`).
      const callText = `${fnName}(${serializeCallArgs(val, iterVarName)})`;
      const engineLowered = engineCtx ? emitEngineHandlerBody(callText, engineCtx) : null;
      // NON-engine fallback: lower the args through the STRUCTURED emitter so a
      // bare `.Variant` call-arg (`moveTo(card.id, .InProgress)`) becomes its
      // frozen string — g-each-body-bare-variant-arg (S201). The engine path
      // above keeps the RAW serializeCallArgs callText so emitEngineHandlerBody
      // still sees the intact `.X` for `.advance(.X)` variant detection.
      handlerBody = engineLowered !== null
        ? `${engineLowered};`
        : `${fnName}(${serializeCallArgsLowered(val, iterVarName)});`;
    } else if (valKind === "expr") {
      // `${...}` form — could be an arrow/lambda or a call/assign expression.
      // Bug 62 (S156) — engine direct-write `${@phase = .Active}` (AssignExpr) and
      // engine advance `${@phase.advance(.Active)}` (CallExpr) lower through the
      // canonical write-guard / C13 machinery. The engine path receives the
      // iter-scope-prelowered text (so any `@.field` / `as`-name in args resolves
      // to the factory binding while `@engineVar` survives for engine detection).
      const preLowered = rewriteIterScopeOnly(String(val.raw ?? ""), iterVarName);
      const engineLowered = engineCtx ? emitEngineHandlerBody(preLowered, engineCtx) : null;
      if (engineLowered !== null) {
        handlerBody = `${engineLowered};`;
      } else {
        // g-expr-event-handler-dead-in-each (Family-A Half-2) — route the
        // NON-engine `${...}` handler through the structured emitter so an arrow
        // / fn-shorthand is INVOKED (was a dead statement), a bare cell ref is
        // invoked, and an assignment LHS lowers to `_scrml_reactive_set` (was a
        // getter-on-LHS -> E-CODEGEN-INVALID-LOGIC). Bug-73 live-keying still wraps
        // this body below so the iter var resolves to the LIVE item at fire-time.
        handlerBody = buildEachExprHandlerBody(preLowered, iterVarName);
      }
    } else if (valKind === "variable-ref") {
      // `onclick=@handler` — reference a reactive/handler cell. Rewrite then
      // invoke with the event. (Not an engine transition — bare cell handler.)
      const ref = rewriteIterValueExpr(String(val.name ?? ""), iterVarName);
      handlerBody = `${ref}(event);`;
    } else {
      handlerBody = "/* each: unsupported event handler shape */";
    }
    // Bug 73 — per-item handler live-keying. If a reconcile ctx is active and
    // the handler reads the iter var, prepend a fire-time re-resolution prelude
    // so the handler runs against the LIVE item (not the create-time snapshot)
    // on same-key reconcile / in-place field mutation. Global handlers and
    // literal-only bodies stay plain (gated by the iter-scope token scan).
    // g-each-mount-form-submit-no-preventdefault (ss20) — mirror the registry /
    // top-level event-wiring path (emit-event-wiring.ts L658/L680): a per-item
    // `<form onsubmit=fn()>` inside an `<each>` must auto-inject
    // `event.preventDefault()` so Enter / submit-button does NOT reload the page.
    // LOCAL injection: the each path builds its own `function(event){...}` string
    // and does NOT share the registry handler-body builder, so there is no
    // double-inject risk. preventDefault is the FIRST statement — BEFORE the
    // Bug-73 live-keying prelude — so it fires even if the prelude early-returns
    // on a stale (reconciled-away) item.
    const preventLine = ev === "submit" ? "event.preventDefault(); " : "";
    const wrappedHandlerBody = maybeWrapEachPerItemHandler(handlerBody, iterVarName);
    lines.push(`${indent}${elVar}.addEventListener(${JSON.stringify(ev)}, function(event) { ${preventLine}${wrappedHandlerBody} });`);
    return;
  }

  // ---- bind: / ref= / transition: — deferred (needs reactive registry) ----
  if (aName.startsWith("bind:") || aName === "ref" || aName.startsWith("transition:") ||
      aName.startsWith("in:") || aName.startsWith("out:")) {
    lines.push(`${indent}// each: per-item directive attr "${aName}" deferred (Landing 2 scope: class:/events/interpolation/literals)`);
    return;
  }

  // ---- (3) ${...} interpolation / @.field value → setAttribute value ------
  // Bug 64 / R28-1c (S159) — per-item attr interpolation is live-keyed too so
  // an attr value bound to item data refreshes on reconcile (matches Tier-0).
  if (valKind === "expr") {
    const expr = lowerEachExpr(String(val.raw ?? ""), iterVarName);
    for (const _l of maybeWrapEachPerItemEffect(
      [`${indent}${elVar}.setAttribute(${JSON.stringify(aName)}, String(${expr}));`], iterVarName, indent,
    )) lines.push(_l);
    return;
  }
  if (valKind === "variable-ref") {
    const expr = lowerEachExpr(String(val.name ?? ""), iterVarName);
    for (const _l of maybeWrapEachPerItemEffect(
      [`${indent}${elVar}.setAttribute(${JSON.stringify(aName)}, String(${expr}));`], iterVarName, indent,
    )) lines.push(_l);
    return;
  }
  if (valKind === "call-ref") {
    const expr = rewriteIterValueExpr(`${String(val.name ?? "")}(${serializeCallArgs(val, iterVarName)})`, iterVarName);
    for (const _l of maybeWrapEachPerItemEffect(
      [`${indent}${elVar}.setAttribute(${JSON.stringify(aName)}, String(${expr}));`], iterVarName, indent,
    )) lines.push(_l);
    return;
  }

  // ---- (4) literal string / absent (bareword) attr ------------------------
  if (valKind === "string-literal") {
    // g-each-inline-component-prop-member-unsubstituted (Approach B, step 2/3):
    // a string-literal attr value with `${}` interp (`href="/x/${@.id}"`, an
    // inlined component root `class="pill ${cls(@.status)}"`) must be lowered to a
    // template literal, not JSON.stringify'd raw. Live-keyed (per-item effect) so
    // the attr re-evaluates on reconcile, matching the interpolation/text paths.
    const sv = String(val.value ?? "");
    const tpl = buildEachAttrTemplate(sv, iterVarName);
    if (tpl !== null) {
      for (const _l of maybeWrapEachPerItemEffect(
        [`${indent}${elVar}.setAttribute(${JSON.stringify(aName)}, ${tpl});`], iterVarName, indent,
      )) lines.push(_l);
      return;
    }
    lines.push(`${indent}${elVar}.setAttribute(${JSON.stringify(aName)}, ${JSON.stringify(sv)});`);
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

/**
 * g-each-body-bare-variant-arg (S201) — like serializeCallArgs, but routes each
 * RAW arg through lowerEachExpr so a bare `.Variant` enum literal
 * (`moveTo(id, .InProgress)`) lowers to its frozen string (`"InProgress"`) via
 * the structured emitter (emit-expr.ts:295) — the each-render-fn analog of the
 * Tier-0 / static-markup / `<match>`-arm bare-variant lowering, which the plain
 * serializeCallArgs (iter-scope text-rewrite only) omitted, leaking raw `.X`
 * into the handler → E-CODEGEN-INVALID-LOGIC. Per-arg (the fn name is never routed
 * through emit-expr, so no double-encoding). Used ONLY in the NON-engine
 * call-ref handler fallback; the engine path keeps the raw serializeCallArgs
 * callText so `.advance(.X)` variant detection (emitEngineHandlerBody) still
 * sees the intact bare-variant.
 */
function serializeCallArgsLowered(callRef: any, iterVarName: string): string {
  const args: any[] = Array.isArray(callRef?.args) ? callRef.args : [];
  return args
    .map((a) => lowerEachExpr(String(a ?? ""), iterVarName))
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
function rewriteContextualSigil(text: string, iterVarName: string | null): string {
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
  engineCtx: EachEngineCtx | null = null,
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
    renderTemplateChildToJs(grand, "/* no iter scope in <empty> */", "", fragmentVar, lines, "  ", engineCtx);
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
// Bug 64 / R28-1c (S159) — Tier-1 `<each>` per-item content reactivity on
// reconcile. Mirrors the Tier-0 (emit-lift.js) live-keyed model so BOTH tiers
// end on ONE per-item binding shape.
//
// `_scrml_reconcile_list` reuses DOM nodes for same-key items and bails the B2
// fast path without re-running the per-item factory, so per-item TEXT and class:
// bindings that closed over the create-time iter var showed stale content on
// array-replace / reorder. Worse, the Tier-1 class: lowered to a BARE
// `classList.toggle` with NO effect at all — not even field-mutation reactive.
//
// Fix: while emitting an each per-item factory body, a reconcile ctx is active
// on this stack. Per-item TEXT + class:/attr bindings then wrap in a live-keyed
// `_scrml_effect` that re-resolves the CURRENT item for the node's create-time
// key via `_scrml_resolve_item(<mount>, <keyVar>)`, rebinds the iter var, then
// evaluates the binding. The resolver read tracks the mount's item slot
// (reconcile triggers it → array-replace/reorder re-fire) and item-field reads
// through the Proxy subscribe the effect (→ in-place field mutation re-fires).
// ---------------------------------------------------------------------------

interface EachReconcileCtx {
  mountVar: string;   // the _scrml_reconcile_list container (resolve target)
  keyVar: string;     // the per-item create-time key local
  iterVar: string;    // the iteration variable name
  /**
   * §59.8 / §14.11 (S169) — the 2-name positional destructure `as (k, v)`, or
   * null. When set, every live-keyed re-resolution of `iterVar` re-derives the
   * two entry-struct field locals so the body's `${k}` / `${v}` references stay
   * live across reconcile. `[0] ← <iterVar>.key`, `[1] ← <iterVar>.value`.
   */
  destructure: [string, string] | null;
}

// Codegen is synchronous + single-threaded → a module-level stack is safe.
const _eachReconcileCtxStack: EachReconcileCtx[] = [];
function pushEachReconcileCtx(ctx: EachReconcileCtx): void { _eachReconcileCtxStack.push(ctx); }
function popEachReconcileCtx(): void { _eachReconcileCtxStack.pop(); }
function currentEachReconcileCtx(): EachReconcileCtx | null {
  const n = _eachReconcileCtxStack.length;
  return n > 0 ? _eachReconcileCtxStack[n - 1] : null;
}

/**
 * §59.8 / §14.11 (S169) — emit the 2-name positional-destructure binding lines
 * for the entry-struct iterated by `<each in=@m.entries() as (k, v)>`. The
 * iterated value (`iterVarName`) is the `{ key, value }` entry struct; `as (k, v)`
 * is sugar that derives two locals: `k ← <item>.key`, `v ← <item>.value`. These
 * lines are emitted right after the item is (re)bound — at create-time in the
 * factory and inside every live-keyed effect / handler prelude — so the body's
 * `${k}` / `${v}` references resolve and stay live across reconcile.
 *
 * Returns an empty array when `destructure` is null (single-name `as e` / no
 * `as` — byte-identical to the pre-S169 emission).
 */
function emitDestructureBindingLines(
  destructure: [string, string] | null,
  iterVarName: string,
  indent: string,
): string[] {
  if (!destructure) return [];
  const [kName, vName] = destructure;
  return [
    `${indent}const ${kName} = ${iterVarName}.key;`,
    `${indent}const ${vName} = ${iterVarName}.value;`,
  ];
}

/**
 * Wrap a per-item binding's JS body lines in a live-keyed `_scrml_effect` IF a
 * reconcile ctx is active for the iter var the binding reads; otherwise return
 * the body unchanged. The `iterVarName` argument must match the active ctx
 * (nested eaches push their own ctx; the binding belongs to the innermost).
 *
 * The wrapper rebinds the iter var to the live item (resolved by the node's
 * create-time key) before running the body, so the body's `<iter>.field` reads
 * hit the live Proxy. A `=== null` guard (canonical absence, SPEC §42.5) skips
 * the body when the key is gone.
 *
 * §59.8 / §14.11 (S169) — when the active ctx carries a 2-name destructure
 * `as (k, v)`, the two entry-struct field locals are re-derived from the freshly
 * resolved item INSIDE the effect, so `${k}` / `${v}` body references stay live.
 */
function maybeWrapEachPerItemEffect(bodyLines: string[], iterVarName: string, indent: string): string[] {
  const ctx = currentEachReconcileCtx();
  if (!ctx || ctx.iterVar !== iterVarName) return bodyLines;
  const out: string[] = [];
  out.push(`${indent}_scrml_effect(() => {`);
  out.push(`${indent}  let ${ctx.iterVar} = _scrml_resolve_item(${ctx.mountVar}, ${ctx.keyVar});`);
  out.push(`${indent}  if (${ctx.iterVar} === null) return;`);
  for (const l of emitDestructureBindingLines(ctx.destructure, ctx.iterVar, `${indent}  `)) {
    out.push(l);
  }
  // Re-indent body lines +2 so the wrapped statement nests cleanly inside the
  // effect (the caller passes them at the binding's own indent).
  for (const l of bodyLines) out.push("  " + l);
  out.push(`${indent}});`);
  return out;
}

// ---------------------------------------------------------------------------
// Bug 73 (sibling-gap #2 of Bug 64) — per-item EVENT HANDLER live-keying.
//
// A per-item handler emitted inside a reconcile factory closes over the
// CREATE-TIME iter var (`function(event) { fn(<iterVar>.field) }`). On a
// same-key reconcile (array-replace with a new same-key object / in-place field
// mutation) `_scrml_reconcile_list` REUSES the DOM node, so the handler keeps
// firing with the STALE create-time snapshot while the display binding (Bug 64)
// already shows live data. Fix: when the handler READS the iter var, prepend a
// fire-time re-resolution prelude (`let <iterVar> = _scrml_resolve_item(<mount>,
// <keyVar>); if (<iterVar> === null) return;`) so the handler body's
// `<iterVar>.field` reads hit the LIVE item at click time.
//
// Distinct from the DISPLAY effect helper above: a handler is NOT wrapped in
// `_scrml_effect` (it has no reactive subscription — it re-resolves only when
// the user fires it). The prelude is plain statements inside the existing
// `function(event) { ... }` listener body.
// ---------------------------------------------------------------------------

/**
 * Blank the CONTENTS of string / template / regex literals in `code` so a
 * subsequent identifier token-scan does not match an iter-var name that only
 * appears inside a literal (e.g. `log("it works")` must not match iterVar
 * `it`). Quotes/backticks/slashes are preserved as structure; only the bytes
 * between delimiters are replaced with spaces (length-preserving). This is a
 * lightweight lexer adequate for the handler-body strings codegen produces;
 * it is intentionally conservative (an unterminated literal blanks to EOL/EOF,
 * which is safe — over-blanking can only DROP a match, never invent one).
 */
function blankStringAndRegexLiterals(code: string): string {
  const out = code.split("");
  let i = 0;
  const n = code.length;
  // `prevSignificant` decides whether a `/` opens a regex (after `(`, `,`, `=`,
  // `return`, operators) or is division (after an ident / `)` / `]`). For the
  // scan's purpose a false "regex" only blanks more, so we keep it simple.
  let prevSignificant = "";
  while (i < n) {
    const ch = code[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      i++;
      while (i < n) {
        if (code[i] === "\\") { out[i] = " "; out[i + 1] = " "; i += 2; continue; }
        if (code[i] === quote) break;
        out[i] = " ";
        i++;
      }
      // leave the closing quote (if present) in place
      prevSignificant = quote;
      i++;
      continue;
    }
    if (ch === "/" && /[(,=:;{[!&|?+\-*%^~<>]/.test(prevSignificant === "" ? "(" : prevSignificant)) {
      // Regex literal start (best-effort). Blank until the unescaped closing `/`.
      i++;
      while (i < n) {
        if (code[i] === "\\") { out[i] = " "; out[i + 1] = " "; i += 2; continue; }
        if (code[i] === "/") break;
        out[i] = " ";
        i++;
      }
      prevSignificant = "/";
      i++;
      continue;
    }
    if (!/\s/.test(ch)) prevSignificant = ch;
    i++;
  }
  return out.join("");
}

function _escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Does `handlerBody` reference the iter var as a free identifier (outside string
 * / regex literal content)? Used to gate per-item handler re-resolution: only
 * handlers that READ the item need the live-keyed prelude; a global handler
 * (`onclick=reorder()`) or a literal-only body must stay plain.
 */
export function iterScopeReferencedInHandler(handlerBody: string, iterVarName: string): boolean {
  if (!iterVarName) return false;
  const blanked = blankStringAndRegexLiterals(handlerBody);
  return new RegExp("\\b" + _escapeForRegex(iterVarName) + "\\b").test(blanked);
}

/**
 * Tier-1 per-item handler wrap. When a reconcile ctx is active, its `iterVar`
 * matches `iterVarName`, and `handlerBody` reads the iter var, return the
 * fire-time re-resolution prelude + body; otherwise return `handlerBody`
 * unchanged. The prelude SHADOWS the create-time closure binding with a `let`
 * so the body's `<iterVar>.field` reads resolve to the LIVE item.
 *
 * §59.8 / §14.11 (S169) — for `as (k, v)`, the handler body reads the derived
 * locals `k` / `v` (NOT the entry-struct iterVar directly), so the gate also
 * fires when either destructure name appears, and the prelude re-derives them
 * from the freshly resolved item so the handler reads LIVE values at fire time.
 */
function maybeWrapEachPerItemHandler(handlerBody: string, iterVarName: string): string {
  const ctx = currentEachReconcileCtx();
  if (!ctx || ctx.iterVar !== iterVarName) return handlerBody;
  const readsIter = iterScopeReferencedInHandler(handlerBody, iterVarName);
  const readsDestructure =
    !!ctx.destructure &&
    (iterScopeReferencedInHandler(handlerBody, ctx.destructure[0]) ||
      iterScopeReferencedInHandler(handlerBody, ctx.destructure[1]));
  if (!readsIter && !readsDestructure) return handlerBody;
  const prelude = `let ${ctx.iterVar} = _scrml_resolve_item(${ctx.mountVar}, ${ctx.keyVar}); if (${ctx.iterVar} === null) return;`;
  const destructurePrelude = ctx.destructure
    ? ` const ${ctx.destructure[0]} = ${ctx.iterVar}.key; const ${ctx.destructure[1]} = ${ctx.iterVar}.value;`
    : "";
  return `${prelude}${destructurePrelude} ${handlerBody}`;
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
  engineCtx: EachEngineCtx | null = null,
): string[] {
  const lines: string[] = [];
  const lengthRef = `${itemsVar}.length`;

  // Empty-state path (when `<empty>` sub-element is present).
  if (node.emptyChild) {
    lines.push(`${indent}if (!${itemsVar} || ${lengthRef} === 0) {`);
    lines.push(`${indent}  ${mountVar}.replaceChildren();`);
    lines.push(`${indent}  const _emptyFrag = document.createDocumentFragment();`);
    const emptyLines: string[] = [];
    renderEmptyChildToJs(node.emptyChild, "_emptyFrag", emptyLines, `${indent}  `, engineCtx);
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
  // Bug 64 / R28-1c (S159) — capture this node's create-time key (the SAME
  // expression the keyFn above uses) so per-item text/class bindings can
  // re-resolve the LIVE item by key on every reconcile. Push a reconcile ctx so
  // those bindings (emitted by renderTemplate*ToJs below) become live-keyed.
  const _eachKeyVar = `_scrml_each_key_${nextLocalId()}`;
  lines.push(`${indent}    const ${_eachKeyVar} = ${keyFnBody};`);

  // §59.8 / §14.11 (S169) — `as (k, v)` positional destructure. When the each
  // carries two `as` names, the iterated entry struct's fields bind positionally
  // (`k ← <item>.key`, `v ← <item>.value`). Bind the two locals at create-time
  // (here) AND re-derive them inside every live-keyed effect / handler prelude
  // (via the ctx.destructure thread) so `${k}` / `${v}` stay live across
  // reconcile. The iterated value stays the `{ key, value }` struct.
  const destructure: [string, string] | null =
    Array.isArray(node.asNames) && node.asNames.length === 2
      ? [node.asNames[0], node.asNames[1]]
      : null;
  for (const l of emitDestructureBindingLines(destructure, iterVarName, `${indent}    `)) {
    lines.push(l);
  }
  pushEachReconcileCtx({ mountVar, keyVar: _eachKeyVar, iterVar: iterVarName, destructure });

  // Walk template children — produce DOM-build JS.
  const templateLines: string[] = [];
  for (const child of node.templateChildren) {
    renderTemplateChildToJs(child, iterVarName, iterIdxName, "_itemFrag", templateLines, `${indent}    `, engineCtx);
  }
  for (const l of templateLines) lines.push(l);
  popEachReconcileCtx();

  lines.push(`${indent}    return _itemFrag.firstChild;`);
  lines.push(`${indent}  }`);
  lines.push(`${indent});`);
  return lines;
}

// ---------------------------------------------------------------------------
// Bug 72 (S158) — nested `<each>` inside Tier-0 `${for…lift}` lifted markup.
//
// A `<each>` that appears as a CHILD of lifted markup
// (`lift <tr><each in=row.cells><td>${@.}</td></each></tr>`) arrives at codegen
// as a GENERIC `markup` node (`tag="each"`), NOT a structural `each-block`: the
// each-block transform lives in `buildAST`/`buildBlock` (fired only for the BS
// STRUCTURAL_RAW_BODY_ELEMENTS), while lift markup is parsed by `parseLiftTag`
// (ast-builder.js), which produces generic markup recursively and never
// promotes `<each>`. So emit-lift.js's `emitCreateElementFromMarkup` used to
// render the `<each>` as a LITERAL `<each>` DOM element and its `${@.}` body
// reached the bare-expr text-node path with NO iter-scope rewrite — the inner
// sigil leaked RAW (`createTextNode(String((@ .) ?? ""))`) → E-CODEGEN-INVALID-LOGIC.
//
// The inner `@.` is LEGITIMATE per SPEC §17.7.3 ("Nested `<each>` scopes resolve
// `@.` to the INNERMOST scope's current value") — this holds in ANY markup
// context, including markup lifted from a Tier-0 `for` loop (§17.4). So
// E-SYNTAX-064 correctly does NOT fire; the gap is purely codegen lowering.
//
// FIX (the each-nesting analog of the Bug 65 / 63fcba72 engine-ctx gap — reuse
// the SHARED machinery, no fork): convert the generic markup `<each>` to the
// each-block shape from its STRUCTURED attrs+children (no raw re-parse needed —
// `parseLiftTag` already produced structured attrs + a walkable child tree),
// then emit it INLINE via the SAME `emitEachReconcileLines` helper the
// renderTemplateChildToJs nested-each branch uses. The enclosing scope var is
// the Tier-0 `for`-loop variable (a plain closure-bound JS var), so the inner
// source (`row.cells`) resolves in that scope and the inner `@.` lowers to the
// inner each's iter var (`as`-alias or `_scrml_each_item`).
// ---------------------------------------------------------------------------

/**
 * Bug 72 (S158) — extract the raw iteration-source / `as` / `key` strings from
 * a markup `<each>` attribute's structured value. `parseLiftTag` builds the
 * value as a `variable-ref` (`{name}`), an `expr` (`{raw}`), or a
 * `string-literal` (`{value}`); fall back to `.raw`/`.name`/`.value` in that
 * order. Returns null when no usable text is present.
 */
function eachAttrRawText(attrVal: any): string | null {
  if (attrVal == null) return null;
  if (typeof attrVal === "string") return attrVal.trim() || null;
  const kind = attrVal.kind;
  if (kind === "variable-ref" && typeof attrVal.name === "string") return attrVal.name.trim() || null;
  if (kind === "expr" && typeof attrVal.raw === "string") return attrVal.raw.trim() || null;
  if (kind === "string-literal" && typeof attrVal.value === "string") return attrVal.value.trim() || null;
  if (typeof attrVal.raw === "string") return attrVal.raw.trim() || null;
  if (typeof attrVal.name === "string") return attrVal.name.trim() || null;
  if (typeof attrVal.value === "string") return attrVal.value.trim() || null;
  return null;
}

/**
 * Bug 72 (S158) — convert a generic markup `<each>` node (from `parseLiftTag`,
 * carrying structured `attrs` + `children`) into the structural `each-block`
 * shape the shared each-render machinery consumes. Mirrors the field set the
 * ast-builder `buildBlock` each-block dispatch produces (§17.7), but reads from
 * the already-structured attrs/children rather than re-splitting raw text.
 *
 * The `as name` form lives either as an `as` attribute OR (when `parseLiftTag`
 * keeps it inline) as a bareword in the header; markup attrs from lift already
 * split `in=`/`of=`/`as`/`key=`, so we read them by name.
 *
 * Returns null when the node is not a usable `<each>` (no `in=`/`of=` source).
 */
export function eachBlockFromMarkupNode(markupNode: any): EachBlockAstNode | null {
  if (!markupNode || typeof markupNode !== "object") return null;
  const tag = String(markupNode.tag ?? markupNode.tagName ?? markupNode.name ?? "");
  if (tag !== "each") return null;

  const attrs: any[] = markupNode.attributes ?? markupNode.attrs ?? [];
  let inExprRaw: string | null = null;
  let ofExprRaw: string | null = null;
  let asName: string | null = null;
  let keyExprRaw: string | null = null;
  for (const attr of attrs) {
    if (!attr || typeof attr.name !== "string") continue;
    const n = attr.name;
    if (n === "in") inExprRaw = eachAttrRawText(attr.value);
    else if (n === "of") ofExprRaw = eachAttrRawText(attr.value);
    else if (n === "key") keyExprRaw = eachAttrRawText(attr.value);
    else if (n === "as") asName = eachAttrRawText(attr.value);
  }

  let iterShape: "in" | "of" | null = null;
  if (inExprRaw && !ofExprRaw) iterShape = "in";
  else if (ofExprRaw && !inExprRaw) iterShape = "of";
  else if (inExprRaw && ofExprRaw) iterShape = "in"; // tie-break to in= (mirror ast-builder)
  if (iterShape === null) return null; // no iteration source — not renderable.

  // Split children into the per-item template + the optional <empty> sub-element
  // (mirror ast-builder: first markup child tag="empty" is the empty branch).
  const children: any[] = Array.isArray(markupNode.children) ? markupNode.children : [];
  let emptyChild: any | null = null;
  const templateChildren: any[] = [];
  for (const child of children) {
    if (!child) continue;
    // Skip whitespace-only text children (lift markup keeps formatting text).
    if (child.kind === "text") {
      const t = String(child.value ?? child.text ?? "");
      if (!t.trim()) continue;
    }
    const childTag = child.kind === "markup" ? String(child.tag ?? child.name ?? "") : "";
    if (childTag === "empty" && emptyChild === null) {
      emptyChild = child;
    } else {
      templateChildren.push(child);
    }
  }

  return {
    id: typeof markupNode.id === "number" ? markupNode.id : nextLocalId(),
    kind: "each-block",
    iterShape,
    inExprRaw,
    ofExprRaw,
    asName,
    keyExprRaw,
    bodyChildren: children,
    templateChildren,
    emptyChild,
    bodyRaw: "",
    span: markupNode.span ?? null,
  };
}

/**
 * Bug 72 (S158) — emit a nested `<each>` (given as a generic markup node from
 * lifted Tier-0 markup) INLINE into `fragmentVar`, resolving its iteration
 * source in the enclosing `for`-loop scope (`enclosingScopeVar`). Reuses the
 * SAME `emitEachReconcileLines` helper as the Tier-1 nested-each branch — the
 * inner `@.` lowers to the inner each's iter var (innermost-scope-wins per
 * §17.7.3), the inner source (`row.cells`) resolves against the for-loop var.
 *
 * Returns true when the node was a usable `<each>` and was emitted; false when
 * it was not an `<each>` (caller keeps its existing literal-markup emission).
 */
export function emitNestedEachFromMarkup(
  markupNode: any,
  enclosingScopeVar: string | null,
  fragmentVar: string,
  indent: string = "",
  engineCtx: EachEngineCtx | null = null,
): string[] | null {
  const eachBlock = eachBlockFromMarkupNode(markupNode);
  if (!eachBlock) return null;
  // Tree-shake: empty inner each (no template + no <empty>) renders nothing.
  if ((!Array.isArray(eachBlock.templateChildren) || eachBlock.templateChildren.length === 0) && !eachBlock.emptyChild) {
    return [];
  }

  const lines: string[] = [];
  // Resolve the inner iteration source IN THE ENCLOSING (for-loop) SCOPE.
  // `enclosingScopeVar` is the for-loop variable (a plain closure-bound JS var),
  // so a bare reference (`row.cells`) passes through unchanged and a `@.field`
  // form (when the lift is itself inside another each) lowers to that var.
  let innerItemsExpr: string;
  if (eachBlock.iterShape === "in") {
    innerItemsExpr = rewriteIterValueExpr(eachBlock.inExprRaw ?? "[]", enclosingScopeVar);
  } else {
    const ofResolved = rewriteIterValueExpr(eachBlock.ofExprRaw ?? "0", enclosingScopeVar);
    innerItemsExpr = `Array.from({length: Number(${ofResolved}) || 0}, (_v, _i) => _i)`;
  }

  // The inner each's iter var is its OWN `as` alias or the synthetic default —
  // distinct from the enclosing scope var so the inner `@.` binds to the inner
  // item (mirrors emitEachBodyRenderForFile / the Tier-1 nested-each branch).
  const innerIterVar = (typeof eachBlock.asName === "string" && eachBlock.asName.length > 0)
    ? eachBlock.asName
    : "_scrml_each_item";
  const innerIdxName = "_scrml_each_idx";
  const innerMountVar = `_scrml_each_mount_${nextLocalId()}`;
  const innerItemsVar = `_scrml_each_items_${nextLocalId()}`;
  // The item-local mount is created + appended ONCE (stable DOM node identity
  // across inner re-renders); the inner reconcile writes into it in place.
  lines.push(`${indent}const ${innerMountVar} = document.createElement("div");`);
  lines.push(`${indent}${innerMountVar}.setAttribute("data-scrml-each-mount", "each_${eachBlock.id}");`);
  lines.push(`${indent}${fragmentVar}.appendChild(${innerMountVar});`);
  // g-nested-each-no-own-subscription (2026-06-21) — Tier-0 `${for…lift}`-nested
  // sibling of the Tier-1 nested-each branch. Same fix: wrap the source-read +
  // reconcile in a per-item `_scrml_effect` so a post-mount `@cell` update
  // re-renders THIS item's inner list. The effect closure binds the enclosing
  // for-loop scope var AND the closure-captured `innerMountVar`; `_scrml_effect`
  // un-pauses tracking so a `_scrml_reactive_get(...)` inside `innerItemsExpr`
  // subscribes even though created during the outer reconcile. A purely
  // enclosing-scope source (`row.cells`, no `@cell`) tracks no reactive dep and
  // the effect simply runs once (byte-equivalent behavior to the pre-fix IIFE).
  // The empty-guard `return` short-circuits only this effect callback.
  lines.push(`${indent}_scrml_effect(() => {`);
  lines.push(`${indent}  const ${innerItemsVar} = ${innerItemsExpr};`);
  for (const l of emitEachReconcileLines(eachBlock, innerIterVar, innerIdxName, innerMountVar, innerItemsVar, `${indent}  `, engineCtx)) {
    lines.push(l);
  }
  lines.push(`${indent}});`);
  return lines;
}

/**
 * Bug 62 (S156) — build the per-file engine codegen context for `<each>`
 * per-item event-handler engine-transition lowering. Mirrors the context
 * construction in emit-event-wiring.ts (the canonical non-each path) so the
 * each handler routes `.advance(.X)` / `@engine = .X` through the IDENTICAL
 * machinery (no duplicated `.advance` lowering).
 *
 * Tree-shake: when the file declares no `<engine>`, `buildEngineBindingsMap`
 * returns null and every collect* helper returns an empty Set, so this returns
 * null and the handler path is byte-identical to the pre-fix emission.
 *
 * The collect* inputs MUST come from the SAME processed `fileAST` the codegen
 * stage feeds emit-event-wiring (engine vars are registered by the name
 * resolver upstream; a raw buildAST AST yields an empty engineVarNames set).
 *
 * Bug 65 (S157) — EXPORTED + SHARED with emit-lift.js so the Tier-0
 * `${for…lift}` path threads the IDENTICAL engine ctx (no duplicated lowering).
 */
export function buildEachEngineCtx(fileAST: any): EachEngineCtx | null {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const eng = require("./emit-engine.ts") as {
    buildEngineBindingsMap: (a: unknown) => Map<string, unknown> | null;
    collectEngineVarNames: (a: unknown) => Set<string>;
    collectEnginesWithHooks: (a: unknown) => Set<string>;
    collectEnginesWithOnTimeout: (a: unknown) => Set<string>;
    collectEnginesWithIdleWatchdog: (a: unknown) => Set<string>;
    collectEnginesWithInternalRules: (a: unknown) => Set<string>;
    collectEnginesWithHistory: (a: unknown) => Set<string>;
    collectEnginesWithMessageArms: (a: unknown) => Set<string>;
    collectEngineMessageVariants: (a: unknown) => Map<string, Set<string>>;
  };

  const engineBindings = eng.buildEngineBindingsMap(fileAST);
  const engineVarNames = eng.collectEngineVarNames(fileAST);
  // No engines in this file — null carrier, byte-identical pre-fix emission.
  if ((engineBindings == null || engineBindings.size === 0) && engineVarNames.size === 0) {
    return null;
  }

  const enginesWithHooks = eng.collectEnginesWithHooks(fileAST);
  const enginesWithOnTimeout = eng.collectEnginesWithOnTimeout(fileAST);
  const enginesWithIdleWatchdog = eng.collectEnginesWithIdleWatchdog(fileAST);
  const enginesWithInternalRules = eng.collectEnginesWithInternalRules(fileAST);
  const enginesWithHistory = eng.collectEnginesWithHistory(fileAST);
  // §51.0.S (message-plane routing) — same inputs the non-each path threads.
  const enginesWithMessageArms = eng.collectEnginesWithMessageArms(fileAST);
  const engineMessageVariants = eng.collectEngineMessageVariants(fileAST);

  const exprCtxExtras = {
    engineVarNames: engineVarNames.size > 0 ? engineVarNames : null,
    enginesWithHooks: enginesWithHooks.size > 0 ? enginesWithHooks : null,
    enginesWithOnTimeout: enginesWithOnTimeout.size > 0 ? enginesWithOnTimeout : null,
    enginesWithIdleWatchdog: enginesWithIdleWatchdog.size > 0 ? enginesWithIdleWatchdog : null,
    enginesWithInternalRules: enginesWithInternalRules.size > 0 ? enginesWithInternalRules : null,
    enginesWithHistory: enginesWithHistory.size > 0 ? enginesWithHistory : null,
    enginesWithMessageArms: enginesWithMessageArms.size > 0 ? enginesWithMessageArms : null,
    engineMessageVariants: engineMessageVariants.size > 0 ? engineMessageVariants : null,
    engineBindings: engineBindings,
  };

  const engineRewriteCtx: EngineRewriteCtx = {
    engineBindings: engineBindings as EngineRewriteCtx["engineBindings"],
    exprCtxExtras: exprCtxExtras as EngineRewriteCtx["exprCtxExtras"],
  };

  return {
    engineRewriteCtx,
    engineExprCtxExtras: exprCtxExtras as Record<string, unknown>,
    engineVarNames: engineVarNames.size > 0 ? engineVarNames : null,
  };
}

/**
 * Bug 62 (S156) — emit the engine-transition body for one `<each>` per-item
 * event handler when the (iter-scope-prelowered) handler text references an
 * engine var. Returns the lowered JS statement (NO trailing `;`), or null when
 * the handler is NOT an engine transition (caller keeps the existing
 * `rewriteIterValueExpr` path — no regression to non-engine handlers).
 *
 * `preRewritten` is the handler expression text with iter-scope already lowered
 * (`@.field` → `col.field`, `as`-name passthrough) and the BS-padded sigil-dot
 * collapsed; only `@engineVar` / `@cell` `@`-forms remain.
 *
 * Two engine shapes (mirrors emit-event-wiring.ts:412-486):
 *   - `@engine.advance(.X)` (CallExpr) → emitExprField(C13 arm) → state/message plane.
 *   - `@engine = .X` (AssignExpr)      → rewriteBlockBody(engineRewriteCtx) → write-guard.
 *
 * Bug 65 (S157) — EXPORTED + SHARED with emit-lift.js: the Tier-0
 * `${for…lift}` per-item handler reuses this SAME interceptor (no fork).
 */
export function emitEngineHandlerBody(preRewritten: string, engineCtx: EachEngineCtx): string | null {
  const engineVarNames = engineCtx.engineVarNames;
  if (!engineVarNames || engineVarNames.size === 0) return null;

  // Cheap gate: the handler must reference at least one bare engine var as
  // `@<engineVar>` (word-boundary so `@phaseX` does not match engine `phase`).
  let referencesEngineVar = false;
  for (const v of engineVarNames) {
    const re = new RegExp("@" + v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![A-Za-z0-9_$])");
    if (re.test(preRewritten)) { referencesEngineVar = true; break; }
  }
  if (!referencesEngineVar) return null;

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { parseExprToNode } = require("../expression-parser.ts") as {
    parseExprToNode: (raw: string, filePath: string, offset: number) => any;
  };
  let node: any;
  try {
    node = parseExprToNode(preRewritten, "", 0);
  } catch {
    return null; // unparseable — let the existing path emit (and the parse-gate report).
  }
  if (!node || typeof node !== "object") return null;

  // --- Assign form: `@engine = .X` (AssignExpr targeting an engine var) ------
  // emitAssign has NO engine-binding interception, so route through
  // rewriteBlockBody (the write-guard path) exactly as the non-each path does.
  if (
    node.kind === "assign" &&
    node.target && node.target.kind === "ident" &&
    typeof node.target.name === "string" && node.target.name.startsWith("@") &&
    engineVarNames.has(node.target.name.slice(1))
  ) {
    if (engineCtx.engineRewriteCtx == null) return null;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { rewriteBlockBody } = require("./emit-control-flow.ts") as {
      rewriteBlockBody: (body: string, derived: unknown, engineCtx: EngineRewriteCtx | null) => string;
    };
    return rewriteBlockBody(preRewritten, null, engineCtx.engineRewriteCtx);
  }

  // --- Advance form: `@engine.advance(.X)` (CallExpr, C13 §51.0.G shape) ------
  if (
    node.kind === "call" &&
    node.callee && node.callee.kind === "member" && !node.callee.optional &&
    node.callee.property === "advance" &&
    node.callee.object && node.callee.object.kind === "ident" &&
    typeof node.callee.object.name === "string" && node.callee.object.name.startsWith("@") &&
    engineVarNames.has(node.callee.object.name.slice(1))
  ) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { emitExprField } = require("./emit-expr.ts") as {
      emitExprField: (n: any, fallback: string, ctx: Record<string, unknown>) => string;
    };
    return emitExprField(node, preRewritten, { mode: "client", ...engineCtx.engineExprCtxExtras });
  }

  // References an engine var but is neither a recognised advance nor an
  // engine-var assignment (e.g. `@engine.foo` read inside a larger expression).
  // Defer to the existing path.
  return null;
}

export function emitEachBodyRenderForFile(
  fileAST: any,
  ctx: CompileContext,
): { renderFunctions: string[]; dispatchers: string[] } {
  const renderFunctions: string[] = [];
  const dispatchers: string[] = [];

  // Bug 62 (S156) — build the engine codegen context ONCE for this file so
  // per-item event handlers carrying engine transitions (`@engine.advance(.X)`
  // / `@engine = .X`) lower through the canonical machinery. Null when the file
  // declares no engines (tree-shaken — handler emission is byte-identical to
  // pre-fix in that case). Built from the SAME `ctx.fileAST` the codegen stage
  // feeds emit-event-wiring (the non-each path).
  const engineCtx = buildEachEngineCtx(ctx.fileAST ?? fileAST);

  // §59.8 (D4) — value-native MAP cell names so a `<each in=@m.entries()>`
  // iterable lowers the map methods to the `_scrml_map_*` runtime (the plain
  // map object has no `.entries`/`.keys`/`.values`/`.sorted` methods). Computed
  // once per file; empty Set when the file declares no maps (the iterable then
  // takes the byte-identical pre-D4 `rewriteAtCellAccess` path).
  const { collectMapVarNames, collectSetVarNames } = require("./reactive-deps.ts");
  const eachMapVarNames: Set<string> = collectMapVarNames(ctx.fileAST ?? fileAST);
  // §59.12 (D4) — value-native SET cell names (strict subset of eachMapVarNames).
  // A bare `<each in=@s>` yields the set's ELEMENTS (the map's keys, NOT the
  // markers), and `<each in=@s.elements()>` lowers `.elements()` → map `.keys()`.
  const eachSetVarNames: Set<string> = collectSetVarNames(ctx.fileAST ?? fileAST);

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
    if (node.iterShape === "in" && node.armPayloadBinding) {
      // g-each-over-arm-payload-binding-unbound (2026-06-17) — the iterable is
      // the enclosing match-/engine-arm's PAYLOAD BINDING. The arm render fn
      // receives it as a param, but THIS top-level no-arg render fn does not, so
      // the bare `const _items = rows;` would be UNBOUND → ReferenceError at
      // mount. Resolve from the reactive cell instead: the binding value lives
      // at `_scrml_reactive_get(cell).data[field]` when the current variant is
      // `variantTag`. The reactive-get also establishes the dep edge (same
      // dep-first-read invariant the `@cell` path relies on), so a later
      // arm-entry remount re-renders against the live payload. When the cell is
      // NOT currently the payload-carrying variant, fall back to `[]` (the each
      // mount is not in the DOM then anyway — the arm isn't rendered).
      const { cellName, variantTag, fieldName } = node.armPayloadBinding;
      const vVar = `_scrml_arm_v_${node.id}`;
      fnLines.push(`  const ${vVar} = _scrml_reactive_get(${JSON.stringify(cellName)});`);
      itemsExpr = `(${vVar} && typeof ${vVar} === "object" && ${vVar}.variant === ${JSON.stringify(variantTag)} && ${vVar}.data) ? ${vVar}.data[${JSON.stringify(fieldName)}] : []`;
    } else if (node.iterShape === "in") {
      const inExpr = node.inExprRaw ?? "[]";
      // Rewrite `@cell` to `_scrml_reactive_get("cell")` for V5-strict reactivity.
      // §59.8 (D4) — map-aware: `@m.entries()` etc. lower to `_scrml_map_*`.
      // §59.12 (D4) — set-aware: bare `@s` / `@s.elements()` → `_scrml_map_keys`.
      itemsExpr = rewriteMapAwareIterable(inExpr, eachMapVarNames, eachSetVarNames);
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
    for (const l of emitEachReconcileLines(node, iterVarName, iterIdxName, "_mount", "_items", "  ", engineCtx)) {
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

/**
 * §59.8 (D4) — Map-aware `<each in=…>` iterable rewrite. A map iterable such as
 * `@m.entries()` / `@m.keys()` / `@m.values()` / `@m.entries().sorted()` must
 * lower the map methods to the `_scrml_map_*` runtime (the plain map object has
 * NO `.entries` method — `rewriteAtCellAccess` alone would emit
 * `_scrml_reactive_get("m").entries()` → undefined at runtime).
 *
 * When `inExpr` references a known map cell (root `@m` ∈ `mapVarNames`), parse it
 * to an ExprNode and emit via `emitExprField` with `mapVarNames` threaded — that
 * reuses emit-expr's method-surface lowering (handles `.entries()`/`.sorted()`
 * chains correctly). Otherwise fall back to the plain `rewriteAtCellAccess`
 * regex path (byte-identical to pre-D4 for non-map iterables).
 */
function rewriteMapAwareIterable(
  inExpr: string,
  mapVarNames: Set<string>,
  setVarNames: Set<string> = new Set(),
): string {
  if (!inExpr || mapVarNames.size === 0) return rewriteAtCellAccess(inExpr);
  // §59.12 — a BARE set iterable `<each in=@s>` yields the set's ELEMENTS (the
  // map's keys). The bare `@s` ident alone lowers to the map OBJECT (not
  // iterable), so wrap it explicitly: `_scrml_map_keys(_scrml_reactive_get("s"))`.
  // (The `.elements()` form is handled by the structured emit below — it lowers
  // via emit-expr's set interception when setVarNames is threaded.)
  const bareSet = /^@([A-Za-z_$][A-Za-z0-9_$]*)$/.exec(inExpr.trim());
  if (bareSet && setVarNames.has(bareSet[1])) {
    return `_scrml_map_keys(_scrml_reactive_get(${JSON.stringify(bareSet[1])}))`;
  }
  // Cheap pre-filter: only attempt the structured path when the expression
  // mentions a known map/set cell (`@<name>`). Avoids parsing every iterable.
  let mentionsMap = false;
  for (const name of mapVarNames) {
    if (inExpr.includes("@" + name)) { mentionsMap = true; break; }
  }
  if (!mentionsMap) return rewriteAtCellAccess(inExpr);
  try {
    const { parseExprToNode } = require("../expression-parser.ts") as {
      parseExprToNode: (raw: string, filePath: string, offset: number) => any;
    };
    const node = parseExprToNode(inExpr, "", 0);
    if (!node) return rewriteAtCellAccess(inExpr);
    const { emitExprField } = require("./emit-expr.ts") as {
      emitExprField: (n: any, fallback: string, ctx: Record<string, unknown>) => string;
    };
    return emitExprField(node, inExpr, { mode: "client", mapVarNames, setVarNames });
  } catch {
    // Parse failure → conservative fallback (the iterable is then non-map or
    // a shape the parser can't structure; the regex path preserves behavior).
    return rewriteAtCellAccess(inExpr);
  }
}
