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
import { emitStringFromTree } from "../expression-parser.ts";
import { isUserComponentMarkup } from "../component-expander.ts";

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
  "  return String(v)",
  "    .replace(/&/g, \"&amp;\").replace(/</g, \"&lt;\").replace(/>/g, \"&gt;\");",
  "}",
  "function _scrml_esc_attr(v) {",
  "  if (v === null || v === undefined) return \"\";",
  "  return String(v)",
  "    .replace(/&/g, \"&amp;\").replace(/</g, \"&lt;\").replace(/>/g, \"&gt;\").replace(/\"/g, \"&quot;\");",
  "}",
  "// Fill one empty each-mount fence with its server-rendered rows. The mount is",
  "// the parse-safe comment fence `<!--scrml-each:N--><!--/scrml-each:N-->` emitted",
  "// by generateHtml (emit-each) — foster-safe under <table>/<select>. Inject the",
  "// rows immediately AFTER the START anchor (before the close fence) so the client",
  "// _scrml_reconcile_list adopts them as siblings between the anchors. An unmatched",
  "// id (mount not on this page, or an auth-omitted §14.8.9/§14.8.10 cell that was",
  "// never seeded → fill never called) leaves the fence empty; the client hydrates",
  "// post-mount. `mountId` is the numeric each id.",
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
 * A server-renderable each-block: the mount id, the seeded cell it iterates, the
 * emitted render-function name, and the render-function source lines.
 */
export interface SsrEachRenderer {
  id: number;
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
function attrValueParts(valNode: any, iterVarName: string | null): string[] {
  if (valNode == null) return [JSON.stringify("")];
  if (typeof valNode !== "object" || valNode.kind !== "string-literal" || typeof valNode.value !== "string") {
    throw new SsrUnsupported("non-literal attribute value");
  }
  const raw = valNode.value;
  if (!raw.includes("${")) {
    // Static — compile-time escape once.
    return [JSON.stringify(escapeHtmlAttr(raw))];
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
    parts.push(`_scrml_esc_attr(String(${resolveRowRead(inner, iterVarName)}))`);
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
function attrsToParts(attrs: any[], iterVarName: string | null): string[] {
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
    for (const p of attrValueParts(attr.value, iterVarName)) parts.push(p);
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
      parts.push(`_scrml_esc_attr(String(${keyReadExpr}))`);
      parts.push(JSON.stringify(`"`));
    }
    for (const p of attrsToParts(node.attrs ?? node.attributes ?? [], iterVarName)) parts.push(p);
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
 * Build the server-side render function for ONE each-block, or return null when
 * the template is outside the supported subset (the each then falls back to the
 * pre-existing client-only render — empty mount, no regression).
 */
function buildOneRenderer(node: any, varName: string): SsrEachRenderer | null {
  // Only a bare `@<seededVar>` in= iteration (no map/set/derived surface).
  if (node.iterShape !== "in") return null;
  // Isolate the single ROOT markup element (skip whitespace-only formatting text).
  const template: any[] = Array.isArray(node.templateChildren) ? node.templateChildren : [];
  const roots = template.filter(
    (c) => c && (c.kind !== "text" || String(c.value ?? c.text ?? "").trim()),
  );
  if (roots.length !== 1 || roots[0].kind !== "markup") return null;

  try {
    const iterVarName = typeof node.asName === "string" && node.asName ? node.asName : null;
    const keyReadExpr = resolveKeyReadExpr(node);
    const rowParts = nodeToParts(roots[0], iterVarName, true, keyReadExpr);
    if (rowParts.length === 0) return null;

    const fnName = `_scrml_ssr_render_each_${node.id}`;
    const rowExpr = rowParts.join(" + ");
    const fnLines: string[] = [
      `// §52.8 SSR server-side render for < ${varName} > (each_${node.id})`,
      `function ${fnName}(_scrml_rows) {`,
      `  if (!Array.isArray(_scrml_rows)) return "";`,
      `  let _scrml_h = "";`,
      `  for (let _scrml_i = 0; _scrml_i < _scrml_rows.length; _scrml_i++) {`,
      `    const _scrml_item = _scrml_rows[_scrml_i];`,
      `    _scrml_h += ${rowExpr};`,
      `  }`,
      `  return _scrml_h;`,
      `}`,
    ];
    return { id: node.id, varName, fnName, fnLines };
  } catch (e) {
    if (e instanceof SsrUnsupported) return null;
    throw e;
  }
}

/**
 * Enumerate the server-renderable each-blocks in a file: TOP-LEVEL (non-nested)
 * `<each in=@<seededVar>>` blocks whose per-item template is within the supported
 * subset. `seededVarNames` is the set of cells the SSR compose handler bakes into
 * `_scrml_ssr_state` (Tier-1 + Pattern-C + coalesced callables).
 */
export function buildSsrEachRenderers(
  fileAST: any,
  seededVarNames: Set<string>,
): SsrEachRenderer[] {
  if (!seededVarNames || seededVarNames.size === 0) return [];
  const out: SsrEachRenderer[] = [];
  const seenIds = new Set<number>();

  const walk = (node: any, insideEach: boolean): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const n of node) walk(n, insideEach);
      return;
    }
    if (node.kind === "each-block") {
      // Only a TOP-LEVEL each mounts to a static `data-scrml-each-mount` div; a
      // nested each is emitted inline in the outer factory (no mount to fill).
      if (!insideEach && typeof node.id === "number" && !seenIds.has(node.id)) {
        const inRaw = String(node.inExprRaw ?? "").trim();
        const m = /^@([A-Za-z_$][A-Za-z0-9_$]*)$/.exec(inRaw);
        if (m && seededVarNames.has(m[1])) {
          const renderer = buildOneRenderer(node, m[1]);
          if (renderer) {
            out.push(renderer);
            seenIds.add(node.id);
          }
        }
      }
      // Descend into this each's template under the nested flag (any each found
      // there is iter-scoped, not a top-level mount).
      for (const key of ["templateChildren", "bodyChildren", "emptyChild"]) {
        if ((node as any)[key] != null) walk((node as any)[key], true);
      }
      return;
    }
    for (const key of Object.keys(node)) {
      if (key === "span") continue;
      const v = (node as any)[key];
      if (v && typeof v === "object") walk(v, insideEach);
    }
  };

  walk(getNodes(fileAST), false);
  // Stable order (by mount id) so the emitted bundle is deterministic.
  out.sort((a, b) => a.id - b.id);
  return out;
}
