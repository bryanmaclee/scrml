/**
 * §52.8 SSR A-terminus, Dispatch 1 — server-side markup renderer.
 *
 * The B-substrate (S233, commit e72f058a) already runs the server-authority
 * queries at request time, applies the §14.8.9 protect-floor, and injects the
 * redacted rows as an inline `window.__scrml_ssr_state` seed. But the each-mount
 * divs in the composed HTML are STILL EMPTY (`<div data-scrml-each-mount=…></div>`)
 * — the per-row markup is built ONLY by the client runtime after JS loads, so a
 * view-source of the first paint shows no rows (the residual W-AUTH-002 tracks).
 *
 * This module lifts the per-row render to run SERVER-SIDE at HTML-composition
 * time: for each `<each>` that iterates a server-authority (seeded) cell, it
 * emits a plain string-building render function that turns the (already-redacted)
 * rows into an HTML fragment, keyed by the SAME `keyFn` the client's
 * `_scrml_reconcile_list` uses (emitted as a `data-scrml-key` attribute the NEXT
 * dispatch's DOM-adoption will match). The SSR compose handler fills each mount
 * div with its rendered rows, so the first paint already contains the data.
 *
 * Scope (Dispatch 1): the CONTENT-bearing subset — static markup, nested
 * elements, `:`-shorthand bodies, and interpolations that are SIMPLE FIELD READS
 * of the iteration item (`@.field`, `alias.field`, `@.a.b`). Behavioral
 * attributes with no first-paint content effect (`on*`, `ref`) are dropped (the
 * client re-wires them on its rebuild). Anything that conditionally changes WHICH
 * content appears (`if=`/`show=`, nested `<each>`/`<match>`), or requires
 * evaluating non-field logic server-side (function calls, `@cell` reads,
 * `class:`/`style:`/`bind` directives, computed members) makes the WHOLE each
 * fall back to the pre-existing client-only render (empty mount, no regression) —
 * the renderer NEVER ships wrong/partial markup. The client DOM-adoption
 * hydration (D2, S235 — runtime-template.js `_scrml_reconcile_list` adopts these
 * `data-scrml-key` rows in place) and the W-AUTH-002 retirement (S235) SHIPPED;
 * widening this conservative subset is the remaining follow-on
 * (g-ssr-render-subset-widen).
 *
 * Egress: this renderer feeds on `_scrml_ssr_state[<var>]`, which the B-substrate
 * already ran through `_scrml_protect_tag` → `_scrml_protect_redact`. A protected
 * column is therefore ABSENT from the row object, so a `${@.passwordHash}`
 * interpolation renders empty — no new confidentiality surface is introduced.
 */

import { escapeHtmlAttr, VOID_ELEMENTS } from "./utils.ts";
import { getNodes } from "./collect.ts";
import { CGError } from "./errors.ts";
import { emitStringFromTree } from "../expression-parser.ts";
import { isUserComponentMarkup } from "../component-expander.ts";
import { isGateableIfValue, IF_GATE_BYPASS_TAGS } from "./emit-html.ts";
import { lookupStateCell, getCellKind } from "../symbol-table.ts";
import { nsId } from "./chunk-namespace.ts";
import { quotedUrlAttrNeedsGuard, wrapUrlGuard } from "./url-attr-guard.ts";
import { URL_GUARD_RUNTIME_SOURCE } from "../runtime-template.js";
import { aliasHostGlobalsInRuntimeText } from "./host-global-alias.ts";

/**
 * The server-bundle runtime helper block for the SSR markup renderer. Injected
 * into the server module IFF at least one each-block is server-rendered. Emits
 * runtime HTML-escapers (`_scrml_esc` for text content, `_scrml_esc_attr` for
 * attribute values) and the mount-fill helper. Server-only — never reaches
 * client.js.
 */
export const SSR_RENDER_HELPER: string = [
  "",
  "// --- §52.8 SSR server-side markup render helpers (server-only first-paint fill) ---",
  "// Runtime HTML-escapers for interpolated row-field values. `null`/`undefined`",
  "// (an absent — e.g. §14.8.9-redacted — column) render as the empty string.",
  "function _scrml_esc(v) {",
  "  if (v === null || v === undefined) return \"\";",
  "  return _scrml_g.String(v)",
  "    .replace(/&/g, \"&amp;\").replace(/</g, \"&lt;\").replace(/>/g, \"&gt;\");",
  "}",
  "function _scrml_esc_attr(v) {",
  "  if (v === null || v === undefined) return \"\";",
  "  return _scrml_g.String(v)",
  "    .replace(/&/g, \"&amp;\").replace(/</g, \"&lt;\").replace(/>/g, \"&gt;\").replace(/\"/g, \"&quot;\");",
  "}",
  "// Fill one empty each-mount fence with its server-rendered rows. The mount is",
  "// the parse-safe comment fence `<!--scrml-each:N--><!--/scrml-each:N-->` emitted",
  "// by generateHtml (emit-each) — foster-safe under <table>/<select>. Inject the",
  "// rows immediately AFTER the START anchor (before the close fence) so the client",
  "// _scrml_reconcile_list adopts them as siblings between the anchors. An unmatched",
  "// id (mount not on this page, or an auth-omitted §14.8.9/§14.8.10 cell that was",
  "// never seeded → fill never called) leaves the fence empty; the client hydrates",
  "// post-mount. `mountId` is the chunk-namespaced each id (`<token>_<n>`).",
  "function _scrml_ssr_fill_mount(html, mountId, rowsHtml) {",
  "  const _start = '<!--scrml-each:' + mountId + '-->';",
  "  // FUNCTION replacer (not a string): a string replacement would honor the",
  "  // special patterns $&, $`, $', $$ — a row value containing e.g. $' would",
  "  // expand to the rest of the document and corrupt/duplicate the page HTML.",
  "  return html.replace(_start, () => _start + rowsHtml);",
  "}",
  "",
].join("\n");

/**
 * §5.2 rule 3 (S457) — the server copy of the runtime URL-attribute guard, for a server-rendered row
 * attribute such as `<a href="${@.url}">`: the first paint is real HTML the browser acts on before
 * the client bundle loads, so a `javascript:` URL from the row data must be blocked here too. It is
 * the SAME source the client runtime's 'urlguard' chunk inlines (`runtime-url-guard.js`), injected by
 * emit-server.ts after `SSR_RENDER_HELPER` only when a renderer emitted a `_scrml_safe_url(` call.
 * Server-side there is no `_scrml_error_boundary_log`; the guard's report falls back to
 * `console.error` (the server log).
 */
export const SSR_URL_GUARD_HELPER: string = [
  "",
  "// --- §5.2 URL-attribute scheme guard (server copy, first-paint rows; source: runtime-url-guard.js) ---",
  // S457 2a — the copy shares the bundle's module scope with user bindings: host globals via `_scrml_g`.
  aliasHostGlobalsInRuntimeText(URL_GUARD_RUNTIME_SOURCE),
].join("\n");

/**
 * A server-renderable each-block: the mount id, the seeded cell it iterates, the
 * emitted render-function name, and the render-function source lines.
 */
export interface SsrEachRenderer {
  /** Raw AST node id — ordering only. */
  id: number;
  /**
   * The CHUNK-NAMESPACED mount id (`"a1b2c3d4_9"`), i.e. exactly the token
   * `emitEachMountHtml` stamped into `<!--scrml-each:...-->`. Both are derived
   * from the one per-file namespace state, so the SSR fill and the client
   * emit cannot disagree about which fence they mean.
   */
  mountId: string;
  varName: string;
  fnName: string;
  fnLines: string[];
}

/** Internal bail sentinel — an unsupported construct makes the whole each fall back. */
class SsrUnsupported extends Error {}

/**
 * Resolve an interpolation/key expression TEXT to a JS expression that reads the
 * current iteration item (`_scrml_item`), or throw `SsrUnsupported`.
 *
 * Supported (safe, side-effect-free field reads only):
 *   - `@.`                — the whole item
 *   - `@.field` / `@.a.b` — a (dotted) field path off the item (contextual sigil)
 *   - `alias`             — the whole item (when `alias` is the `as` name)
 *   - `alias.field`       — a field path off the item
 *
 * Everything else (function calls, operators, `@cell` reads, method calls,
 * computed member access, string/number literals mixed in) is rejected — the
 * renderer cannot evaluate arbitrary logic server-side, so the each falls back.
 */
function resolveRowRead(exprText: string, iterVarName: string | null): string {
  // Collapse tokenizer whitespace around dots (`a . name` → `a.name`) and trim.
  const t = String(exprText ?? "").replace(/\s*\.\s*/g, ".").trim();
  if (!t) throw new SsrUnsupported("empty expression");

  const pathToRead = (path: string): string =>
    "_scrml_item" +
    path.split(".").map((seg) => `?.[${JSON.stringify(seg)}]`).join("");

  // `@.` contextual sigil — whole item or a dotted field path.
  if (t === "@.") return "_scrml_item";
  const sigil = /^@\.([A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*)$/.exec(t);
  if (sigil) return pathToRead(sigil[1]);

  // `alias` / `alias.field` — the `as` binding for the current item.
  if (iterVarName) {
    if (t === iterVarName) return "_scrml_item";
    const aliasHead = `${iterVarName}.`;
    if (t.startsWith(aliasHead)) {
      const rest = t.slice(aliasHead.length);
      if (/^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$/.test(rest)) {
        return pathToRead(rest);
      }
    }
  }

  throw new SsrUnsupported(`non-field-read expression: ${t}`);
}

/** Text of a logic-node's single `${...}` interpolation, preferring `.expr`. */
function interpText(logicNode: any): string {
  const body: any[] = logicNode?.body ?? [];
  if (body.length !== 1 || !body[0]) throw new SsrUnsupported("multi-statement interpolation");
  const stmt = body[0];
  if (stmt.kind !== "bare-expr") throw new SsrUnsupported(`non-expr interpolation: ${stmt.kind}`);
  if (typeof stmt.expr === "string" && stmt.expr.trim()) return stmt.expr;
  if (stmt.exprNode) return emitStringFromTree(stmt.exprNode);
  throw new SsrUnsupported("empty interpolation");
}

/**
 * Read an attribute value node to a JS string expression (parts joined at the
 * caller). A `${...}`-bearing value is split into literal + field-read segments;
 * a plain static value is emitted as a compile-time-escaped literal. Only
 * `string-literal` values are supported — a `variable-ref`/`expr` attr value is a
 * reactive binding the renderer cannot evaluate.
 */
function attrValueParts(valNode: any, iterVarName: string | null, tag = "", name = ""): string[] {
  if (valNode == null) return [JSON.stringify("")];
  if (typeof valNode !== "object" || valNode.kind !== "string-literal" || typeof valNode.value !== "string") {
    throw new SsrUnsupported("non-literal attribute value");
  }
  const raw = valNode.value;
  if (!raw.includes("${")) {
    // Static — compile-time escape once.
    return [JSON.stringify(escapeHtmlAttr(raw))];
  }
  // §5.2 rule 3 (S457) — a URL attribute whose literal prefix commits to no scheme
  // (`href="${@.url}"`): the row data supplies the scheme, so the WHOLE value is built raw,
  // passed through the guard, and escaped once — the guard must read the URL the browser
  // will parse, not its escaped spelling.
  if (name && quotedUrlAttrNeedsGuard(tag, name, raw)) {
    const segs: string[] = [];
    let j = 0;
    while (j < raw.length) {
      const open = raw.indexOf("${", j);
      if (open === -1) { segs.push(JSON.stringify(raw.slice(j))); break; }
      if (open > j) segs.push(JSON.stringify(raw.slice(j, open)));
      const close = raw.indexOf("}", open + 2);
      if (close === -1) throw new SsrUnsupported("unterminated interpolation in attribute");
      const inner = raw.slice(open + 2, close);
      if (inner.includes("${")) throw new SsrUnsupported("nested interpolation in attribute");
      segs.push(`_scrml_g.String(${resolveRowRead(inner, iterVarName)})`);
      j = close + 1;
    }
    return [`_scrml_esc_attr(${wrapUrlGuard("null", name, segs.join(" + "))})`];
  }
  // Split `${...}` interpolations out of the literal.
  const parts: string[] = [];
  let i = 0;
  while (i < raw.length) {
    const open = raw.indexOf("${", i);
    if (open === -1) {
      parts.push(JSON.stringify(escapeHtmlAttr(raw.slice(i))));
      break;
    }
    if (open > i) parts.push(JSON.stringify(escapeHtmlAttr(raw.slice(i, open))));
    const close = raw.indexOf("}", open + 2);
    if (close === -1) throw new SsrUnsupported("unterminated interpolation in attribute");
    const inner = raw.slice(open + 2, close);
    if (inner.includes("${")) throw new SsrUnsupported("nested interpolation in attribute");
    parts.push(`_scrml_esc_attr(_scrml_g.String(${resolveRowRead(inner, iterVarName)}))`);
    i = close + 1;
  }
  return parts;
}

/** Names of behavioral attributes with NO first-paint content effect — dropped. */
function isDroppableAttr(name: string): boolean {
  return /^on[A-Za-z]/.test(name) || name === "ref";
}

/**
 * Serialize one markup element's opening-tag attributes to JS string parts. A
 * conditional-visibility / directive / reactive attribute throws `SsrUnsupported`.
 */
function attrsToParts(attrs: any[], iterVarName: string | null, tag = ""): string[] {
  const parts: string[] = [];
  for (const attr of Array.isArray(attrs) ? attrs : []) {
    const name = attr && typeof attr.name === "string" ? attr.name : "";
    if (!name) continue;
    if (isDroppableAttr(name)) continue; // behavioral — client re-wires on rebuild
    // Conditional visibility, directive-form (`class:`/`style:`/`bind:`/`on:`),
    // or bind — these change WHICH markup shows / require runtime evaluation.
    if (
      name === "if" || name === "show" || name === "else" || name === "else-if" ||
      name === "bind" || name.includes(":") || name.startsWith("@")
    ) {
      throw new SsrUnsupported(`unsupported attribute: ${name}`);
    }
    parts.push(JSON.stringify(` ${name}="`));
    for (const p of attrValueParts(attr.value, iterVarName, tag, name)) parts.push(p);
    parts.push(JSON.stringify(`"`));
  }
  return parts;
}

/** Serialize a list of template children to JS string parts. */
function childrenToParts(children: any[], iterVarName: string | null): string[] {
  const parts: string[] = [];
  for (const child of Array.isArray(children) ? children : []) {
    for (const p of nodeToParts(child, iterVarName, false, null)) parts.push(p);
  }
  return parts;
}

/**
 * Serialize one template node to JS string parts, or throw `SsrUnsupported`.
 * When `isRoot`, `keyReadExpr` (a JS expr for this row's key) is injected as a
 * `data-scrml-key` attribute on the element (the DOM-adoption marker).
 */
function nodeToParts(
  node: any,
  iterVarName: string | null,
  isRoot: boolean,
  keyReadExpr: string | null,
): string[] {
  if (!node || typeof node !== "object") return [];

  // Text — skip whitespace-only runs (matches the client per-item factory); a
  // non-empty literal must be plain text (interpolations are separate logic
  // nodes), so a stray `@`/`${` means an unhandled shape → fall back.
  if (node.kind === "text") {
    const txt = String(node.value ?? node.text ?? "");
    if (!txt.trim()) return [];
    if (txt.includes("${") || txt.includes("@")) {
      throw new SsrUnsupported("interpolation-bearing text run");
    }
    return [JSON.stringify(escapeHtmlText(txt))];
  }

  // `${...}` interpolation — a single safe field read, HTML-escaped.
  if (node.kind === "logic") {
    return [`_scrml_esc(${resolveRowRead(interpText(node), iterVarName)})`];
  }

  // Markup element.
  if (node.kind === "markup") {
    const tag = String(node.tag ?? node.name ?? "");
    if (!tag) throw new SsrUnsupported("markup node without a tag");
    // P3-FOLLOW: route via the NR-authoritative predicate
    // (`resolvedKind === "user-component"`, with a backcompat fallback)
    // rather than reading the legacy routing boolean directly. A user
    // component cannot be serialized server-side — the each then falls
    // back to the client-only render (empty mount, no wrong markup).
    if (isUserComponentMarkup(node)) throw new SsrUnsupported(`component in row template: <${tag}>`);

    const parts: string[] = [JSON.stringify(`<${tag}`)];
    if (isRoot && keyReadExpr) {
      parts.push(JSON.stringify(` data-scrml-key="`));
      parts.push(`_scrml_esc_attr(_scrml_g.String(${keyReadExpr}))`);
      parts.push(JSON.stringify(`"`));
    }
    for (const p of attrsToParts(node.attrs ?? node.attributes ?? [], iterVarName, tag)) parts.push(p);
    parts.push(JSON.stringify(`>`));

    if (VOID_ELEMENTS.has(tag.toLowerCase())) {
      return parts; // no body, no close tag
    }

    // `:`-shorthand body → single expression as text content.
    if (node.closerForm === "shorthand" && typeof node.shorthandBodyRaw === "string") {
      parts.push(`_scrml_esc(${resolveRowRead(node.shorthandBodyRaw, iterVarName)})`);
    } else {
      for (const p of childrenToParts(node.children ?? [], iterVarName)) parts.push(p);
    }
    parts.push(JSON.stringify(`</${tag}>`));
    return parts;
  }

  // each-block / match-block / any other structural child — conditional /
  // nested-iteration content the renderer does not lift in Dispatch 1.
  throw new SsrUnsupported(`unsupported node kind in row template: ${node.kind}`);
}

/** Escape a literal text run for HTML text content (matches `_scrml_esc`). */
function escapeHtmlText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * The key expression for a row, mirroring emit-each's `resolveKeyFnBody` so the
 * server `data-scrml-key` markers match the client `_scrml_reconcile_list` keys:
 *   - explicit `key=__index__` → the index
 *   - explicit `key=expr`      → the (field-read-resolved) expression
 *   - `of=` form               → the index
 *   - default `in=` form       → `item.id` with a runtime fallback to the index
 * A non-field-read explicit key throws `SsrUnsupported` (keys are mandatory, so
 * the whole each falls back rather than emit a mismatched marker).
 */
function resolveKeyReadExpr(node: any): string {
  const keyRaw = typeof node.keyExprRaw === "string" ? node.keyExprRaw.trim() : "";
  const iterVarName = typeof node.asName === "string" && node.asName ? node.asName : null;
  if (keyRaw) {
    if (keyRaw === "__index__") return "_scrml_i";
    return resolveRowRead(keyRaw, iterVarName);
  }
  if (node.iterShape === "of") return "_scrml_i";
  return `(_scrml_item != null && _scrml_item.id != null ? _scrml_item.id : _scrml_i)`;
}

/**
 * The advice tail of `I-SSR-EACH-CLIENT-RENDERED` when the fallback is caused by
 * the ROW TEMPLATE being outside the §52.8 renderable subset.
 */
const ROW_TEMPLATE_ADVICE =
  "Bring the row template into the §52.8 SSR-renderable subset, or accept the client-only first paint.";

/**
 * The advice tail when the fallback is caused by an inert-`if=` enclosure. The
 * row template is irrelevant in that case — widening the renderable subset would
 * change nothing, so the row-template advice would send the author the wrong way.
 */
const INERT_IF_ADVICE =
  "`if=` REMOVES rather than hides (§17.1), so no descendant of an `if=` subtree can appear in the server HTML. " +
  "Move the `<each>` out of the `if=` subtree, use `show=` instead of `if=` (it keeps the DOM live and DOES server-render), " +
  "or accept the client-only first paint.";

/**
 * The advice tail for an AUTHOR-WRITTEN `<template>` tag. `show=` is not a
 * remedy here — a `<template>`'s content is inert by the HTML standard itself,
 * not by any scrml lowering — so the `if=` advice would be wrong.
 */
const AUTHOR_TEMPLATE_ADVICE =
  "A `<template>`'s content is inert by the HTML standard — it is a document fragment, not part of the tree, " +
  "until something clones it, so nothing inside one can be part of any first paint. " +
  "Move the `<each>` out of the `<template>`, or accept the client-only first paint.";

/** An enclosure that makes a descendant each-mount unpaintable at first paint. */
interface InertHost {
  /** Why, phrased to slot into the lint's "renders client-only … — <reason>." */
  reason: string;
  /** The advice tail — the remedy differs per host, so it travels with the reason. */
  advice: string;
}

/**
 * Does this node put its subtree somewhere the FIRST PAINT cannot reach?
 *
 * `if=` does not hide, it REMOVES: `emit-html.ts`'s `emitIfMountGate` emits
 * `<template id=…>` + `<!--scrml-if-marker:…-->`, and a `<template>`'s content is
 * NOT in the document tree until the client mount controller clones it. Anything
 * the SSR compose handler splices in there is therefore invisible at first paint,
 * however faithfully it was rendered. `show=` is the opposite (a `display`
 * toggle over LIVE DOM — its subtree IS first-paintable), which is exactly why
 * the same `<each>` paints under `show=` and comes up blank under `if=`.
 *
 * Returns the lint reason + its remedy, or `null` when the node's children stay
 * in the live tree.
 *
 * ⛔ THE MIRROR IS OF THE EMITTER'S **DISPATCH**, NOT MERELY OF ITS GATE
 * PREDICATE — and that distinction is a measured defect, not pedantry (S433 fix
 * round). `isGateableIfValue` answers "would the gate accept this value"; it says
 * nothing about whether control flow REACHES the gate. Several tags dispatch to
 * their own handler and `return` first, and on those `if=` is silently ignored —
 * the children stay LIVE. Claiming inert there SUPPRESSES A SERVER FIRST PAINT
 * THAT WORKED and emits a lint whose reason is false: REPRODUCED THROUGH
 * `compileScrml` for `<errorBoundary if=…>` and for a compound-parent wrapper —
 * fence LIVE, renderer suppressed, 0 rows in the composed first paint where the
 * same source without the `if=` painted 2. (⚠ `<page if=…>` looked identical but
 * is NOT a real instance: it hard-errors `E-PAGE-INVALID-ATTR`. That reproduction
 * came from a test harness which returns `buildAST(...).ast` and DISCARDS
 * buildAST's own diagnostics, so the fatal was invisible to it. It is still in
 * the bypass set on dispatch grounds; it is just not evidence.) Both bypass
 * families are excluded below — and they are tested
 * BEFORE every other host, because a tag that never reaches the `if=` gate never
 * reaches the generic element emitter either, so no question about what that
 * emitter WOULD have produced is meaningful until they are ruled out.
 *
 * The hosts, each mirrored from its emit site:
 *   - `if-chain` — EVERY branch AND the else are mount-deferred templates
 *     (`emit-html.ts`, the `node.kind === "if-chain"` block).
 *   - an AUTHOR-WRITTEN `<template>` tag — no `if=` needed and no scrml lowering
 *     involved: the generic markup path emits the literal tag and the children
 *     land in its content fragment. Same silent blank paint by a different route
 *     (MEASURED: renderer emitted, rows present in the composed bytes, 0 rows
 *     reachable from `document`). Checked AFTER the two bypasses: a compound-parent
 *     cell may be NAMED `template`, and then no `<template>` element exists at all.
 *   - `markup` carrying a gateable `if=`, EXCEPT a capital-initial tag (a
 *     component use-site owns its own mount lifecycle), a tag in
 *     `IF_GATE_BYPASS_TAGS`, or a compound-parent namespace wrapper.
 *   - a structural opener (`<each>` / `<match>` / `<engine>`) carrying `ifCond` —
 *     `emitGatedStructural` routes its whole mount HTML through the same gate.
 *
 * ⚠ DIRECTION OF SAFETY. A MISSED host costs a missed diagnosis — the
 * pre-existing conservative blank first paint, unchanged. A FALSE host costs a
 * deleted server first paint on working code. The two are not symmetric, so
 * every uncertain case resolves to `null`.
 *
 * @param fileScope the file's symbol table (`fileAST._scope`), or `null` when the
 *   AST was built without the SYM stage. Needed because emit-html's
 *   compound-parent wrapper dispatch — which also returns before the gate — is
 *   keyed on a per-FILE declaration, so no tag set can carry it. With a `null`
 *   scope that dispatch cannot fire in the emitter either, so skipping the test
 *   is faithful rather than merely convenient.
 */
function inertHostFor(node: any, fileScope: any): InertHost | null {
  if (!node || typeof node !== "object") return null;
  if (node.kind === "if-chain") {
    return {
      reason:
        "it is inside an `if=` / `else-if=` / `else` chain branch, whose subtree is emitted into an inert `<template>` (§17.1.1) and is not part of the first paint",
      advice: INERT_IF_ADVICE,
    };
  }
  if (node.kind === "markup") {
    // Default to `div`, exactly as `emitNode` does, so a tagless node can never
    // render a lint reading "`<if=…>`".
    const tag: string = node.tag ?? node.tagName ?? "div";
    // ⛔ THE BYPASS TESTS RUN FIRST — INCLUDING BEFORE THE `template` TEST BELOW,
    // AND THAT ORDER IS LOAD-BEARING, NOT TIDINESS. A tag that never reaches the
    // `if=` gate ALSO never reaches the generic element emitter that would put a
    // literal `<template>` in the output, so "is this an author `<template>`" is
    // only a meaningful question once both bypasses have been ruled out. Asking it
    // first made the predicate claim a host for a file that emits no `<template>`
    // element at all — measured below.
    //
    // The emitter never reaches the `if=` gate for these tags — `if=` has no
    // effect and whatever they emit stays LIVE. (That the predicate has no effect
    // there at all is a separate pre-existing defect —
    // g-if-has-no-effect-on-fifteen-dispatch-routes-that-return-before-the-mount-gate
    // — NOT this function's to fix, and pretending the subtree is inert would
    // break working pages. `W-ATTR-001` already names it on six of those routes.)
    if (IF_GATE_BYPASS_TAGS.has(tag)) return null;
    // Same bypass, dynamic: a block-form tag resolving to a `compound-parent`
    // cell is a TRANSPARENT namespace wrapper — emit-html walks its children and
    // returns before the gate. Mirrors that dispatch's own test.
    //
    // ⚑ AND THIS IS EXACTLY WHY IT MUST PRECEDE THE `template` TEST. The emitter's
    // compound-parent dispatch excludes `channel` / `errorBoundary` / `program` /
    // `errors` — but NOT `template`. So in a file that declares a compound-parent
    // cell NAMED `template`, `<template>…</template>` takes the transparent-wrapper
    // path: NO `<template>` element is emitted and the each's fence lands straight
    // in `<body>`, live. MEASURED three ways through `compileScrml` (S433 final
    // round): (A) compound-parent named `template` → no `<template>` in the html,
    // fence LIVE, and with the `template` test first the renderer was suppressed on
    // a false reason and the composed first paint carried 0 rows; (B) the identical
    // shape with the wrapper renamed `templateX` → renderer emitted, 2 rows — so the
    // NAME was the only delta; (C) `template` undeclared → correctly inert. Ordered
    // as it is now, (A) keeps its server render and (C) still falls through to the
    // author-`<template>` host below.
    if (fileScope && /^[a-z]/.test(tag) && !VOID_ELEMENTS.has(tag)) {
      try {
        const decl: any = lookupStateCell(fileScope, tag);
        if (decl && getCellKind(decl.declNode as any) === "compound-parent") return null;
      } catch {
        // A scope shape this lookup cannot read resolves to "not a wrapper" —
        // i.e. the each keeps its renderer. Fail toward NOT suppressing.
      }
    }
    // An author-written `<template>` that really is emitted as one: inert by the
    // HTML standard, `if=` or not.
    if (tag === "template") {
      return {
        reason:
          "it is inside an author-written `<template>` element, whose content is a document fragment and is not part of the first paint",
        advice: AUTHOR_TEMPLATE_ADVICE,
      };
    }
    const attrs: any[] = node.attributes ?? node.attrs ?? [];
    const ifAttr = Array.isArray(attrs) ? attrs.find((a: any) => a && a.name === "if") : undefined;
    if (ifAttr && isGateableIfValue(ifAttr.value) && !/^[A-Z]/.test(tag)) {
      return {
        reason: `it is enclosed by a \`<${tag} if=…>\` element, whose subtree is emitted into an inert \`<template>\` (§17.1) and is not part of the first paint`,
        advice: INERT_IF_ADVICE,
      };
    }
    return null;
  }
  // §17.1.2 structural hosts: the opener's own mount HTML is wrapped by the gate.
  if (isGateableIfValue((node as any).ifCond)) {
    return {
      reason:
        "it is enclosed by a structural opener carrying `if=`, whose mount HTML is emitted into an inert `<template>` (§17.1.2) and is not part of the first paint",
      advice: INERT_IF_ADVICE,
    };
  }
  return null;
}

/**
 * Build the server-side render function for ONE each-block, or a `{ fallback }`
 * descriptor naming WHY the template is outside the supported subset (the each
 * then falls back to the pre-existing client-only render — empty mount, no
 * regression). The reason string feeds the `I-SSR-EACH-CLIENT-RENDERED` info-lint
 * so the otherwise-silent fallback is loud to the adopter.
 */
function buildOneRenderer(node: any, varName: string): SsrEachRenderer | { fallback: string } {
  // Only a bare `@<seededVar>` in= iteration (no map/set/derived surface).
  if (node.iterShape !== "in") return { fallback: "the iteration shape is not `in=`" };
  // Isolate the single ROOT markup element (skip whitespace-only formatting text).
  const template: any[] = Array.isArray(node.templateChildren) ? node.templateChildren : [];
  const roots = template.filter(
    (c) => c && (c.kind !== "text" || String(c.value ?? c.text ?? "").trim()),
  );
  if (roots.length !== 1) {
    return {
      fallback: `the per-item template has ${roots.length} root elements (multi-root); the SSR renderer supports a single markup root`,
    };
  }
  if (roots[0].kind !== "markup") {
    return { fallback: `the per-item template root is a \`${roots[0].kind}\`, not a markup element` };
  }

  try {
    const iterVarName = typeof node.asName === "string" && node.asName ? node.asName : null;
    const keyReadExpr = resolveKeyReadExpr(node);
    const rowParts = nodeToParts(roots[0], iterVarName, true, keyReadExpr);
    if (rowParts.length === 0) return { fallback: "the row template produced no server-renderable content" };

    const mountId = nsId(node.id);
    const fnName = `_scrml_ssr_render_each_${mountId}`;
    const rowExpr = rowParts.join(" + ");
    const fnLines: string[] = [
      `// §52.8 SSR server-side render for < ${varName} > (each_${mountId})`,
      `function ${fnName}(_scrml_rows) {`,
      `  if (!_scrml_g.Array.isArray(_scrml_rows)) return "";`,
      `  let _scrml_h = "";`,
      `  for (let _scrml_i = 0; _scrml_i < _scrml_rows.length; _scrml_i++) {`,
      `    const _scrml_item = _scrml_rows[_scrml_i];`,
      `    _scrml_h += ${rowExpr};`,
      `  }`,
      `  return _scrml_h;`,
      `}`,
    ];
    return { id: node.id, mountId, varName, fnName, fnLines };
  } catch (e) {
    if (e instanceof SsrUnsupported) {
      return { fallback: e.message || "the row template is outside the SSR-renderable subset" };
    }
    throw e;
  }
}

/**
 * Enumerate the server-renderable each-blocks in a file: TOP-LEVEL (non-nested)
 * `<each in=@<seededVar>>` blocks that are NOT inside an inert `if=` `<template>`
 * and whose per-item template is within the supported subset. `seededVarNames` is
 * the set of cells the SSR compose handler bakes into `_scrml_ssr_state` (Tier-1 +
 * Pattern-C + coalesced callables).
 *
 * TWO independent disqualifiers, and they are not interchangeable:
 *   - `insideEach` — a NESTED each has no mount fence of its own to fill (it is
 *     built inline by the outer row factory), so it is not a candidate at all.
 *   - `inertHost` (g-ssr-each-under-if-blank-paint, S433) — the mount fence
 *     exists but sits inside an `if=`-lowered `<template>`, so filling it paints
 *     NOTHING. Before S433 `walk` threaded only `insideEach`, an if-enclosed each
 *     was classified as a top-level server-render mount, and the emitted renderer
 *     filled a fence no browser paints: a BLANK first paint at exit 0 with zero
 *     diagnostics, on the dominant guarded-list shape (`<div if=@loaded>` around
 *     a server-authority `<each>`). The each now takes the same client-render
 *     fallback the unrenderable-row-template case takes, and says so through
 *     `I-SSR-EACH-CLIENT-RENDERED`. Server-rendering the RESOLVABLE branch (so a
 *     guarded list paints at first paint) is deliberately NOT done here — that is
 *     the separate ruled arc (operator, S385: "(a) now, (b) as its own arc").
 */
export function buildSsrEachRenderers(
  fileAST: any,
  seededVarNames: Set<string>,
  errors?: CGError[],
  filePath?: string,
): SsrEachRenderer[] {
  if (!seededVarNames || seededVarNames.size === 0) return [];
  const out: SsrEachRenderer[] = [];
  const seenIds = new Set<number>();
  // The file's symbol table, read exactly as emit-html reads it (`emit-html.ts`
  // `const fileScope = fileAST?._scope ?? fileAST?.ast?._scope ?? null`) so the
  // compound-parent bypass test below and the emitter's own cannot disagree.
  const fileScope: any = fileAST?._scope ?? fileAST?.ast?._scope ?? null;

  const walk = (node: any, insideEach: boolean, inertHost: InertHost | null): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const n of node) walk(n, insideEach, inertHost);
      return;
    }
    if (node.kind === "each-block") {
      // §17.1.2 — an `if=` on the `<each>` OPENER gates the each's own mount
      // fence, so the fence itself lands inside the inert `<template>`. Same
      // consequence as an enclosing `if=`, one node closer.
      const ownHost: InertHost | null = isGateableIfValue((node as any).ifCond)
        ? {
            reason:
              "the `<each>` opener itself carries `if=`, so its mount fence is emitted into an inert `<template>` (§17.1.2) and is not part of the first paint",
            advice: INERT_IF_ADVICE,
          }
        : null;
      const eachHost = inertHost ?? ownHost;
      // Only a TOP-LEVEL each mounts to a static `data-scrml-each-mount` div; a
      // nested each is emitted inline in the outer factory (no mount to fill).
      if (!insideEach && typeof node.id === "number" && !seenIds.has(node.id)) {
        const inRaw = String(node.inExprRaw ?? "").trim();
        const m = /^@([A-Za-z_$][A-Za-z0-9_$]*)$/.exec(inRaw);
        if (m && seededVarNames.has(m[1])) {
          // A prerender CANDIDATE: a top-level `<each in=@cell>` over a seeded
          // server-authority cell. It either server-renders, or falls back to
          // client-only render — and that fallback was SILENT before this lint.
          seenIds.add(node.id);
          // g-ssr-each-under-if-blank-paint (S433) — an if-ENCLOSED mount is
          // checked BEFORE the row template, and it short-circuits: the mount is
          // inert at first paint, so a renderer for it renders into a
          // `<template>` nobody paints (silent blank first paint), and the row
          // template's renderability is irrelevant to the outcome. The enclosure
          // is therefore the reason the author needs to hear.
          const r: SsrEachRenderer | { fallback: string; advice?: string } = eachHost
            ? { fallback: eachHost.reason, advice: eachHost.advice }
            : buildOneRenderer(node, m[1]);
          if ("fallback" in r) {
            // §52.8: the each ships EMPTY in the first-paint HTML and populates
            // after hydration (no crawler/slow-connection first paint, no DOM
            // adoption). Info-level, never fatal — this SURFACES existing
            // conservative behaviour; it does not change what compiles. The
            // accept/decline WIDENING of this subset is the tracked follow-on
            // g-ssr-each-row-template-subset-blocks-all-prerender (ruling-gated).
            if (errors) {
              errors.push(
                new CGError(
                  "I-SSR-EACH-CLIENT-RENDERED",
                  `I-SSR-EACH-CLIENT-RENDERED: <each in=@${m[1]}> renders client-only for first paint — ${r.fallback}. ` +
                    `The list ships empty in the server HTML and populates after hydration (no first paint for crawlers or slow connections, no DOM adoption). ` +
                    ((r as any).advice ?? ROW_TEMPLATE_ADVICE),
                  (node.span ?? { file: filePath ?? "", start: 0, end: 0 }) as any,
                  "info",
                ),
              );
            }
          } else {
            out.push(r);
          }
        }
      }
      // Descend into this each's template under the nested flag (any each found
      // there is iter-scoped, not a top-level mount).
      for (const key of ["templateChildren", "bodyChildren", "emptyChild"]) {
        if ((node as any)[key] != null) walk((node as any)[key], true, eachHost);
      }
      return;
    }
    // An inert enclosure is STICKY: once a subtree is inside a `<template>`, no
    // depth of plain markup underneath brings it back into the first paint, so the
    // host is threaded down rather than re-tested at the each.
    const childHost = inertHost ?? inertHostFor(node, fileScope);
    for (const key of Object.keys(node)) {
      if (key === "span") continue;
      const v = (node as any)[key];
      if (v && typeof v === "object") walk(v, insideEach, childHost);
    }
  };

  walk(getNodes(fileAST), false, null);
  // Stable order (by mount id) so the emitted bundle is deterministic.
  out.sort((a, b) => a.id - b.id);
  return out;
}
