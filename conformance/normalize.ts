/**
 * DOM normalization pipeline (D3 (b)-runtime conformance — DD OQ1, RATIFIED S231).
 *
 * The contract is "two arbitrarily-different impls must agree on the normalized
 * final rendered DOM at the scrml-SEMANTIC level." impl#1 emits marker spans,
 * `data-scrml-*` attrs, counter-IDs, and a runtime `<script>`; impl#2 may emit
 * a text node / comment marker / different wrapper. This module dissolves that
 * impl-private surface so the compare holds the line at the semantic level and
 * nowhere below it.
 *
 * ONE pipeline, TWO modes (DD OQ1 Option C):
 *   - normalizeDom(bodyEl)  — whole-tree canonical serialization (the contract;
 *                             total coverage; honors the "final DOM" wording).
 *   - runAnchored(root, []) — anchored per-selector assertions (the authoring
 *                             surface + brittleness escape; impl-neutral BY
 *                             CONSTRUCTION — only asserts on author-addressable
 *                             nodes, never on runtime wrappers).
 * Both share the strip/canonicalize rules; anchored simply skips whole-tree
 * unwrap-and-compare and asserts on what the author WROTE (ids/classes/tags).
 *
 * HARD INVARIANT (step 1, enforced by the adapter): operate on the POST-run
 * LIVE DOM, never the static `.html` (interpolation slots are empty until
 * hydration). This module is fed `document.body` AFTER the client JS ran.
 *
 * v1.0 scope: `<body>` content; textContent, author attributes, tag structure,
 * presence/absence/count, input value/checked as reflected in the DOM.
 * Deferred (v1.next): `<head>`, computed CSS/class visual state, listener
 * equivalence, shadow DOM, SVG/MathML namespaces, attribute-VALUE ordering,
 * significant inline whitespace between inline elements, HTML entity canon.
 */

// Structural DOM shape both happy-dom + browser nodes satisfy. Kept loose on
// purpose — this is impl-neutral test infra, not a typed DOM consumer.
type DomNode = any;

const NODE_ELEMENT = 1;
const NODE_TEXT = 3;
const NODE_COMMENT = 8;

// Sanctioned transparent-wrapper tag-set for the unwrap step (OQ1 step 4). The
// guard is bounded: a wrapper is dissolved ONLY when it is in this set AND has
// zero remaining attributes AND was a binding anchor — so it can never eat an
// author's `<span class="x">`.
const TRANSPARENT_WRAPPER_TAGS = new Set(["span"]);

// HTML void elements — serialized as `<tag>` (canonical; never `<tag/>`).
const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

// Boolean attributes — serialized in bare form (`checked`, not `checked="checked"`).
const BOOLEAN_ATTRS = new Set([
  "checked", "selected", "disabled", "readonly", "required",
  "multiple", "hidden", "autofocus", "novalidate", "open",
]);

function isScrmlMarkerAttr(name: string): boolean {
  return name.toLowerCase().startsWith("data-scrml-");
}

function isRuntimeScriptSrc(src: string): boolean {
  // The runtime/client bundle scripts impl#1 injects into <body>. An inline
  // runtime script (no src) is also impl-private. Author <script> is out of
  // v1.0 scope, so for now every <body> <script> is dropped.
  // `\.client\.` (not `\.client\.js`) also matches the adopter-#82
  // content-addressed bundle name `<base>.client.<hash>.js`.
  return src === "" || /scrml-runtime|\.client\./.test(src);
}

// ---- normalized intermediate tree (built from the live DOM, never mutated) ---

type NText = { kind: "text"; text: string };
type NEl = { kind: "el"; tag: string; attrs: Record<string, string | true>; children: NNode[] };
type NNode = NText | NEl;

/**
 * Walk a live DOM node's children → a normalized node list, applying OQ1 steps
 * 2 (strip markers), 3 (strip runtime scripts), 4 (unwrap transparent wrappers).
 * Unwrapping splices a qualifying wrapper's children into the parent list.
 */
function buildNormalized(node: DomNode): NNode[] {
  const out: NNode[] = [];
  const kids = node.childNodes;
  for (let i = 0; i < kids.length; i++) {
    const k = kids[i];

    if (k.nodeType === NODE_COMMENT) {
      // Strip scrml runtime comment markers (and, v1.0, all comments — they
      // carry no scrml-semantic content the contract asserts on).
      continue;
    }

    if (k.nodeType === NODE_TEXT) {
      out.push({ kind: "text", text: k.textContent != null ? k.textContent : "" });
      continue;
    }

    if (k.nodeType !== NODE_ELEMENT) continue;

    const tag = (k.tagName || "").toLowerCase();

    if (tag === "script") {
      const src = (k.getAttribute && k.getAttribute("src")) || "";
      if (isRuntimeScriptSrc(src)) continue;
      // (no author-script path in v1.0 — falls through to drop)
      continue;
    }

    // Collect attributes; strip data-scrml-*; record whether this element was a
    // binding anchor (needed for the unwrap guard).
    const attrs: Record<string, string | true> = {};
    let wasBindingAnchor = false;
    const attrList = k.attributes;
    for (let a = 0; a < attrList.length; a++) {
      const at = attrList[a];
      const name = (at.name || "").toLowerCase();
      if (isScrmlMarkerAttr(name)) {
        wasBindingAnchor = true;
        continue;
      }
      if (BOOLEAN_ATTRS.has(name)) attrs[name] = true;
      else attrs[name] = at.value != null ? String(at.value) : "";
    }

    const children = buildNormalized(k);
    const remainingAttrCount = Object.keys(attrs).length;

    if (wasBindingAnchor && TRANSPARENT_WRAPPER_TAGS.has(tag) && remainingAttrCount === 0) {
      // Unwrap: this is a marker-only transparent wrapper (impl#1's binding
      // anchor). Splice its children up — impl#2's text-node/comment binding
      // becomes equal here.
      for (const c of children) out.push(c);
      continue;
    }

    out.push({ kind: "el", tag, attrs, children });
  }
  return out;
}

function escapeAttrValue(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function serializeAttrs(attrs: Record<string, string | true>): string {
  // Canonicalize: lowercase names (already lowered), sort lexically, boolean →
  // bare form.
  const names = Object.keys(attrs).sort();
  let s = "";
  for (const n of names) {
    const v = attrs[n];
    if (v === true) s += " " + n;
    else s += " " + n + '="' + escapeAttrValue(v) + '"';
  }
  return s;
}

function serializeChildren(children: NNode[]): string {
  let s = "";
  for (const c of children) {
    if (c.kind === "text") {
      // Collapse whitespace runs → single space (OQ1 step 5). Drop text nodes
      // that are entirely whitespace (inter-element source formatting). NOTE
      // (v1.next): significant single spaces between two INLINE elements are
      // also dropped by this rule — a documented pilot limitation.
      const collapsed = c.text.replace(/\s+/g, " ");
      if (collapsed.trim() === "") continue;
      s += collapsed;
    } else {
      s += serializeEl(c);
    }
  }
  return s;
}

function serializeEl(el: NEl): string {
  const open = "<" + el.tag + serializeAttrs(el.attrs) + ">";
  if (VOID_TAGS.has(el.tag)) return open;
  return open + serializeChildren(el.children) + "</" + el.tag + ">";
}

/**
 * Whole-tree canonical serialization of a post-run `<body>` (OQ1 Option C
 * default mode). Returns the normalized inner-body string — strip + unwrap +
 * canonicalize applied.
 */
export function normalizeDom(bodyEl: DomNode): string {
  return serializeChildren(buildNormalized(bodyEl));
}

// ---- anchored per-selector assertions (the authoring surface) ---------------

export interface AnchoredAssertion {
  selector: string;
  /** Assert collapsed textContent of the first match. */
  text?: string;
  /** Assert the number of matches. */
  count?: number;
  /** Assert author attribute values on the first match. */
  attr?: Record<string, string>;
  /**
   * Assert the LIVE `.value` DOM property of the first match — the form-control
   * value as reflected in the DOM (v1.0 scope, per this module's contract: "input
   * value/checked as reflected in the DOM"). Distinct from `text`: a `<textarea>`
   * whose `.value` is set by client JS keeps its original child text nodes, so
   * `textContent` does NOT track `.value` — the 6nz-F4 RCDATA `.value` bind can
   * only be asserted through this field.
   */
  value?: string;
}

function collapseWs(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Run anchored assertions against a post-run live DOM root (impl-neutral by
 * construction — only addresses author ids/classes/tags). Returns a failure
 * list (empty = pass).
 */
export function runAnchored(
  root: DomNode,
  assertions: AnchoredAssertion[],
): { pass: boolean; failures: string[] } {
  const failures: string[] = [];
  for (const a of assertions) {
    if (typeof a.count === "number") {
      const n = root.querySelectorAll(a.selector).length;
      if (n !== a.count) {
        failures.push("selector " + a.selector + ": expected count " + a.count + ", got " + n);
      }
      continue;
    }
    const el = root.querySelector(a.selector);
    if (!el) {
      failures.push("selector " + a.selector + ": no match");
      continue;
    }
    if (typeof a.text === "string") {
      const got = collapseWs(el.textContent || "");
      const want = collapseWs(a.text);
      if (got !== want) {
        failures.push('selector ' + a.selector + ': text expected "' + want + '", got "' + got + '"');
      }
    }
    if (a.attr) {
      for (const k of Object.keys(a.attr)) {
        const got = el.getAttribute(k);
        if (got !== a.attr[k]) {
          failures.push('selector ' + a.selector + ": attr " + k + ' expected "' + a.attr[k] + '", got "' + got + '"');
        }
      }
    }
    if (typeof a.value === "string") {
      const got = (el as { value?: unknown }).value;
      if (got !== a.value) {
        failures.push('selector ' + a.selector + ': value expected "' + a.value + '", got "' + String(got) + '"');
      }
    }
  }
  return { pass: failures.length === 0, failures };
}
