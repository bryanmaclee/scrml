/**
 * HTML Element Shape Registry — foundation for state type system.
 *
 * Every HTML element is a pre-defined state type with a hard-coded attribute
 * shape. This module provides the canonical registry of all supported HTML
 * elements, their valid attributes (with types), void element status, and
 * DOM rendering flag.
 *
 * Design notes:
 * - Per the spec draft (section 35.1), HTML elements ARE state types that
 *   happen to render to the DOM. <div> and <session> go through the same
 *   instantiation mechanism; the difference is that div's shape is pre-defined
 *   here while session's shape is user-defined.
 * - Global attributes (class, id, style, title, hidden, tabindex, etc.) are
 *   shared across all elements via GLOBAL_ATTRIBUTES.
 * - Element-specific attributes are merged with globals at registry build time.
 * - Attribute types use string names matching the scrml type system primitives:
 *   "string", "number", "boolean".
 *
 * Exports:
 *   getElementShape(tagName) → shape | null
 *   isHtmlElement(tagName)   → boolean
 *   getAllElementNames()      → string[]
 *   GLOBAL_ATTRIBUTES        → Map<string, {type, required, default}>
 */

// ---------------------------------------------------------------------------
// Attribute descriptor helper
// ---------------------------------------------------------------------------

/**
 * @param {string} type     — scrml type name: "string", "number", "boolean"
 * @param {boolean} required — whether the attribute is required at instantiation
 * @param {*} defaultValue   — default value if not provided (null = no default)
 * @returns {{ type: string, required: boolean, default: * }}
 */
function attr(type, required = false, defaultValue = null) {
  return { type, required, default: defaultValue };
}

// ---------------------------------------------------------------------------
// Global HTML attributes
//
// These are valid on every HTML element. Merged into each element shape.
// See: https://html.spec.whatwg.org/multipage/dom.html#global-attributes
// ---------------------------------------------------------------------------

export const GLOBAL_ATTRIBUTES = new Map([
  ["class",          attr("string")],
  ["id",             attr("string")],
  ["style",          attr("string")],
  ["title",          attr("string")],
  ["hidden",         attr("boolean")],
  ["tabindex",       attr("number")],
  ["dir",            attr("string")],
  ["lang",           attr("string")],
  ["accesskey",      attr("string")],
  ["autocapitalize", attr("string")],
  ["autofocus",      attr("boolean")],
  ["contenteditable", attr("string")],
  ["draggable",      attr("string")],
  ["enterkeyhint",   attr("string")],
  ["inputmode",      attr("string")],
  ["is",             attr("string")],
  ["itemid",         attr("string")],
  ["itemprop",       attr("string")],
  ["itemref",        attr("string")],
  ["itemscope",      attr("boolean")],
  ["itemtype",       attr("string")],
  ["nonce",          attr("string")],
  ["part",           attr("string")],
  ["popover",        attr("string")],
  ["role",           attr("string")],
  ["slot",           attr("string")],
  ["spellcheck",     attr("string")],
  ["translate",      attr("string")],
  // Event handler attributes — all string (JS expression)
  ["onclick",        attr("string")],
  ["onchange",       attr("string")],
  ["oninput",        attr("string")],
  ["onsubmit",       attr("string")],
  ["onfocus",        attr("string")],
  ["onblur",         attr("string")],
  ["onkeydown",      attr("string")],
  ["onkeyup",        attr("string")],
  ["onkeypress",     attr("string")],
  ["onmousedown",    attr("string")],
  ["onmouseup",      attr("string")],
  ["onmouseover",    attr("string")],
  ["onmouseout",     attr("string")],
  ["onmousemove",    attr("string")],
  ["onload",         attr("string")],
  ["onerror",        attr("string")],
  ["onscroll",       attr("string")],
  ["onresize",       attr("string")],
  // Drag and drop events
  ["ondragstart",    attr("string")],
  ["ondragend",      attr("string")],
  ["ondragover",     attr("string")],
  ["ondragenter",    attr("string")],
  ["ondragleave",    attr("string")],
  ["ondrop",         attr("string")],
  ["ondrag",         attr("string")],
  // Touch events
  ["ontouchstart",   attr("string")],
  ["ontouchmove",    attr("string")],
  ["ontouchend",     attr("string")],
  ["ontouchcancel",  attr("string")],
  // Clipboard events
  ["oncopy",         attr("string")],
  ["oncut",          attr("string")],
  ["onpaste",        attr("string")],
  // Pointer events
  ["onpointerdown",  attr("string")],
  ["onpointerup",    attr("string")],
  ["onpointermove",  attr("string")],
  // Misc
  ["oncontextmenu",  attr("string")],
  ["ondblclick",     attr("string")],
  ["onwheel",        attr("string")],
]);

// ---------------------------------------------------------------------------
// Element-specific attribute definitions
//
// Only element-specific attributes are listed here. Global attributes are
// merged in during registry construction.
// ---------------------------------------------------------------------------

const ELEMENT_DEFS = [
  // --- Flow content / containers ---
  { tag: "div",      isVoid: false, attrs: [], domInterface: "HTMLDivElement" },
  { tag: "span",     isVoid: false, attrs: [], domInterface: "HTMLSpanElement" },
  { tag: "p",        isVoid: false, attrs: [], domInterface: "HTMLParagraphElement" },
  { tag: "main",     isVoid: false, attrs: [], domInterface: "HTMLElement" },
  { tag: "section",  isVoid: false, attrs: [], domInterface: "HTMLElement" },
  { tag: "article",  isVoid: false, attrs: [], domInterface: "HTMLElement" },
  { tag: "aside",    isVoid: false, attrs: [], domInterface: "HTMLElement" },
  { tag: "nav",      isVoid: false, attrs: [], domInterface: "HTMLElement" },
  { tag: "header",   isVoid: false, attrs: [], domInterface: "HTMLElement" },
  { tag: "footer",   isVoid: false, attrs: [], domInterface: "HTMLElement" },

  // --- Headings ---
  { tag: "h1", isVoid: false, attrs: [], domInterface: "HTMLHeadingElement" },
  { tag: "h2", isVoid: false, attrs: [], domInterface: "HTMLHeadingElement" },
  { tag: "h3", isVoid: false, attrs: [], domInterface: "HTMLHeadingElement" },
  { tag: "h4", isVoid: false, attrs: [], domInterface: "HTMLHeadingElement" },
  { tag: "h5", isVoid: false, attrs: [], domInterface: "HTMLHeadingElement" },
  { tag: "h6", isVoid: false, attrs: [], domInterface: "HTMLHeadingElement" },

  // --- Links and media ---
  {
    tag: "a", isVoid: false, domInterface: "HTMLAnchorElement", attrs: [
      ["href",     attr("string")],
      ["target",   attr("string")],
      ["rel",      attr("string")],
      ["download", attr("string")],
      ["hreflang", attr("string")],
      ["type",     attr("string")],
      ["referrerpolicy", attr("string")],
      ["ping",     attr("string")],
    ],
  },
  {
    tag: "img", isVoid: true, domInterface: "HTMLImageElement", attrs: [
      ["src",      attr("string", true)],
      ["alt",      attr("string", true)],
      ["width",    attr("number")],
      ["height",   attr("number")],
      ["loading",  attr("string")],
      ["decoding", attr("string")],
      ["srcset",   attr("string")],
      ["sizes",    attr("string")],
      ["crossorigin", attr("string")],
      ["usemap",   attr("string")],
      ["ismap",    attr("boolean")],
      ["referrerpolicy", attr("string")],
    ],
  },

  // --- Form elements ---
  {
    tag: "input", isVoid: true, domInterface: "HTMLInputElement", attrs: [
      ["type",         attr("string", false, "text")],
      ["name",         attr("string")],
      ["value",        attr("string")],
      ["placeholder",  attr("string")],
      ["required",     attr("boolean")],
      ["disabled",     attr("boolean")],
      ["readonly",     attr("boolean")],
      ["checked",      attr("boolean")],
      ["min",          attr("string")],
      ["max",          attr("string")],
      ["step",         attr("string")],
      ["pattern",      attr("string")],
      ["maxlength",    attr("number")],
      ["minlength",    attr("number")],
      ["size",         attr("number")],
      ["autocomplete", attr("string")],
      ["list",         attr("string")],
      ["multiple",     attr("boolean")],
      ["accept",       attr("string")],
      ["capture",      attr("string")],
      ["form",         attr("string")],
      ["formaction",   attr("string")],
      ["formmethod",   attr("string")],
      ["formnovalidate", attr("boolean")],
      ["formtarget",   attr("string")],
      ["alt",          attr("string")],
      ["src",          attr("string")],
      ["width",        attr("number")],
      ["height",       attr("number")],
    ],
  },
  {
    tag: "button", isVoid: false, domInterface: "HTMLButtonElement", attrs: [
      ["type",         attr("string", false, "submit")],
      ["name",         attr("string")],
      ["value",        attr("string")],
      ["disabled",     attr("boolean")],
      ["form",         attr("string")],
      ["formaction",   attr("string")],
      ["formmethod",   attr("string")],
      ["formnovalidate", attr("boolean")],
      ["formtarget",   attr("string")],
      ["popovertarget", attr("string")],
      ["popovertargetaction", attr("string")],
    ],
  },
  {
    tag: "form", isVoid: false, domInterface: "HTMLFormElement", attrs: [
      ["action",       attr("string")],
      ["method",       attr("string")],
      ["enctype",      attr("string")],
      ["target",       attr("string")],
      ["novalidate",   attr("boolean")],
      ["autocomplete", attr("string")],
      ["name",         attr("string")],
      ["rel",          attr("string")],
      ["accept-charset", attr("string")],
    ],
  },
  {
    tag: "select", isVoid: false, domInterface: "HTMLSelectElement", attrs: [
      ["name",         attr("string")],
      ["required",     attr("boolean")],
      ["disabled",     attr("boolean")],
      ["multiple",     attr("boolean")],
      ["size",         attr("number")],
      ["form",         attr("string")],
      ["autocomplete", attr("string")],
    ],
  },
  {
    tag: "option", isVoid: false, domInterface: "HTMLOptionElement", attrs: [
      ["value",    attr("string")],
      ["selected", attr("boolean")],
      ["disabled", attr("boolean")],
      ["label",    attr("string")],
    ],
  },
  {
    tag: "textarea", isVoid: false, domInterface: "HTMLTextAreaElement", attrs: [
      ["name",         attr("string")],
      ["rows",         attr("number")],
      ["cols",         attr("number")],
      ["placeholder",  attr("string")],
      ["required",     attr("boolean")],
      ["disabled",     attr("boolean")],
      ["readonly",     attr("boolean")],
      ["maxlength",    attr("number")],
      ["minlength",    attr("number")],
      ["wrap",         attr("string")],
      ["form",         attr("string")],
      ["autocomplete", attr("string")],
    ],
  },
  {
    tag: "label", isVoid: false, domInterface: "HTMLLabelElement", attrs: [
      ["for", attr("string")],
    ],
  },

  // --- Table elements ---
  {
    tag: "table", isVoid: false, domInterface: "HTMLTableElement", attrs: [],
  },
  {
    tag: "tr", isVoid: false, domInterface: "HTMLTableRowElement", attrs: [],
  },
  {
    tag: "td", isVoid: false, domInterface: "HTMLTableCellElement", attrs: [
      ["colspan",  attr("number")],
      ["rowspan",  attr("number")],
      ["headers",  attr("string")],
    ],
  },
  {
    tag: "th", isVoid: false, domInterface: "HTMLTableCellElement", attrs: [
      ["colspan",  attr("number")],
      ["rowspan",  attr("number")],
      ["headers",  attr("string")],
      ["scope",    attr("string")],
      ["abbr",     attr("string")],
    ],
  },

  // --- List elements ---
  { tag: "ul", isVoid: false, attrs: [], domInterface: "HTMLUListElement" },
  {
    tag: "ol", isVoid: false, domInterface: "HTMLOListElement", attrs: [
      ["start",    attr("number")],
      ["reversed", attr("boolean")],
      ["type",     attr("string")],
    ],
  },
  {
    tag: "li", isVoid: false, domInterface: "HTMLLIElement", attrs: [
      ["value", attr("number")],
    ],
  },

  // --- Media elements ---
  {
    tag: "video", isVoid: false, domInterface: "HTMLVideoElement", attrs: [
      ["src",      attr("string")],
      ["poster",   attr("string")],
      ["width",    attr("number")],
      ["height",   attr("number")],
      ["controls", attr("boolean")],
      ["autoplay", attr("boolean")],
      ["loop",     attr("boolean")],
      ["muted",    attr("boolean")],
      ["preload",  attr("string")],
      ["playsinline", attr("boolean")],
      ["crossorigin", attr("string")],
    ],
  },
  {
    tag: "audio", isVoid: false, domInterface: "HTMLAudioElement", attrs: [
      ["src",      attr("string")],
      ["controls", attr("boolean")],
      ["autoplay", attr("boolean")],
      ["loop",     attr("boolean")],
      ["muted",    attr("boolean")],
      ["preload",  attr("string")],
      ["crossorigin", attr("string")],
    ],
  },
  {
    tag: "canvas", isVoid: false, domInterface: "HTMLCanvasElement", attrs: [
      ["width",  attr("number")],
      ["height", attr("number")],
    ],
  },

  // --- Void / self-closing elements ---
  { tag: "br", isVoid: true, attrs: [], domInterface: "HTMLBRElement" },
  {
    tag: "hr", isVoid: true, attrs: [], domInterface: "HTMLHRElement",
  },

  // --- SVG elements ---
  // SVG elements are valid HTML5 embedded content. They use the SVG namespace
  // but are registered here as pre-defined state types for the compiler.
  {
    tag: "svg", isVoid: false, domInterface: "SVGSVGElement", attrs: [
      ["xmlns",       attr("string")],
      ["viewBox",     attr("string")],
      ["width",       attr("string")],
      ["height",      attr("string")],
      ["fill",        attr("string")],
      ["stroke",      attr("string")],
      ["stroke-width", attr("string")],
      ["preserveAspectRatio", attr("string")],
    ],
  },
  {
    tag: "rect", isVoid: true, domInterface: "SVGRectElement", attrs: [
      ["x",           attr("string")],
      ["y",           attr("string")],
      ["width",       attr("string")],
      ["height",      attr("string")],
      ["rx",          attr("string")],
      ["ry",          attr("string")],
      ["fill",        attr("string")],
      ["stroke",      attr("string")],
      ["stroke-width", attr("string")],
      ["opacity",     attr("string")],
    ],
  },
  {
    tag: "circle", isVoid: true, domInterface: "SVGCircleElement", attrs: [
      ["cx",          attr("string")],
      ["cy",          attr("string")],
      ["r",           attr("string")],
      ["fill",        attr("string")],
      ["stroke",      attr("string")],
      ["stroke-width", attr("string")],
      ["opacity",     attr("string")],
    ],
  },
  {
    tag: "line", isVoid: true, domInterface: "SVGLineElement", attrs: [
      ["x1",          attr("string")],
      ["y1",          attr("string")],
      ["x2",          attr("string")],
      ["y2",          attr("string")],
      ["stroke",      attr("string")],
      ["stroke-width", attr("string")],
      ["stroke-dasharray", attr("string")],
      ["opacity",     attr("string")],
    ],
  },
  {
    tag: "path", isVoid: true, domInterface: "SVGPathElement", attrs: [
      ["d",           attr("string", true)],
      ["fill",        attr("string")],
      ["stroke",      attr("string")],
      ["stroke-width", attr("string")],
      ["stroke-linecap", attr("string")],
      ["stroke-linejoin", attr("string")],
      ["stroke-dasharray", attr("string")],
      ["opacity",     attr("string")],
    ],
  },
  {
    tag: "g", isVoid: false, domInterface: "SVGGElement", attrs: [
      ["transform",   attr("string")],
      ["fill",        attr("string")],
      ["stroke",      attr("string")],
      ["stroke-width", attr("string")],
      ["opacity",     attr("string")],
    ],
  },
  // SVG <text> — note: conflicts with HTML concept of "text node" but is a valid
  // SVG element. The tag name "text" in markup context is an SVG text element.
  {
    tag: "text", isVoid: false, domInterface: "SVGTextElement", attrs: [
      ["x",           attr("string")],
      ["y",           attr("string")],
      ["dx",          attr("string")],
      ["dy",          attr("string")],
      ["text-anchor", attr("string")],
      ["dominant-baseline", attr("string")],
      ["font-size",   attr("string")],
      ["font-family", attr("string")],
      ["fill",        attr("string")],
      ["transform",   attr("string")],
    ],
  },
  {
    tag: "polyline", isVoid: true, domInterface: "SVGPolylineElement", attrs: [
      ["points",      attr("string", true)],
      ["fill",        attr("string")],
      ["stroke",      attr("string")],
      ["stroke-width", attr("string")],
      ["opacity",     attr("string")],
    ],
  },
  {
    tag: "polygon", isVoid: true, domInterface: "SVGPolygonElement", attrs: [
      ["points",      attr("string", true)],
      ["fill",        attr("string")],
      ["stroke",      attr("string")],
      ["stroke-width", attr("string")],
      ["opacity",     attr("string")],
    ],
  },
];

// ---------------------------------------------------------------------------
// Registry construction
//
// Merge global attributes into each element shape and build the lookup Map.
// ---------------------------------------------------------------------------

/**
 * @typedef {{
 *   tag: string,
 *   attributes: Map<string, {type: string, required: boolean, default: *}>,
 *   isVoid: boolean,
 *   rendersToDom: true,
 * }} ElementShape
 */

/** @type {Map<string, ElementShape>} */
const REGISTRY = new Map();

for (const def of ELEMENT_DEFS) {
  /** @type {Map<string, {type: string, required: boolean, default: *}>} */
  const attributes = new Map(GLOBAL_ATTRIBUTES);

  // Merge element-specific attributes (override globals if name collision).
  for (const [name, descriptor] of def.attrs) {
    attributes.set(name, descriptor);
  }

  REGISTRY.set(def.tag, {
    tag: def.tag,
    attributes,
    isVoid: def.isVoid,
    rendersToDom: true,
    domInterface: def.domInterface ?? "HTMLElement",
  });
}

// ---------------------------------------------------------------------------
// <program> root element — not an HTML element, but a pre-defined state type
//
// Per §6 (approved decision): every scrml file starts with <program>.
// It's a state type with known attributes for DB connection, protection,
// table scope, HTML spec version, and worker naming.
// Unlike HTML elements, program does NOT render to DOM.
// ---------------------------------------------------------------------------

REGISTRY.set("program", {
  tag: "program",
  attributes: new Map([
    ...GLOBAL_ATTRIBUTES,
    ["db",            attr("string")],    // database connection path
    ["protect",       attr("string")],    // global protect list (comma-separated field names)
    ["tables",        attr("string")],    // tables in scope (comma-separated)
    ["html",          attr("string")],    // HTML spec version (default: latest)
    ["name",          attr("string")],    // worker program name (omit for main program)
    // Session/auth attributes (Option C hybrid — approved 2026-03-28)
    ["auth",          attr("string")],    // "required" | "optional" | absent (default: absent)
    ["loginRedirect", attr("string")],    // redirect path when auth fails (default: "/login")
    ["csrf",          attr("string")],    // "auto" | "off" (default: "off")
    ["sessionExpiry", attr("string")],    // session TTL (default: "1h")
    // §40.7 documentary attributes (HTML head metadata, Phase A1a 2026-05-05)
    // `title` is already in GLOBAL_ATTRIBUTES; the rest are program-specific.
    ["description",   attr("string")],    // <meta name="description">
    ["version",       attr("string")],    // <meta name="application-version">
    ["author",        attr("string")],    // <meta name="author">
    ["license",       attr("string")],    // <meta name="license">
  ]),
  isVoid: false,
  rendersToDom: false,
});

// ---------------------------------------------------------------------------
// <errorBoundary> — error rendering boundary for the Renderable Enum Variants
// error system.
//
// Wraps content that may produce error values from failable function calls.
// When an error value is returned inside an errorBoundary, the error's
// `renders` clause (from its enum variant) is displayed. If no renders clause
// exists, the optional `fallback` attribute's markup is used.
//
// Does NOT render to DOM — it's a compiler-level construct.
// ---------------------------------------------------------------------------

REGISTRY.set("errorboundary", {
  tag: "errorBoundary",
  attributes: new Map([
    ...GLOBAL_ATTRIBUTES,
    ["fallback", attr("string")],  // optional fallback markup
  ]),
  isVoid: false,
  rendersToDom: false,
});

// ---------------------------------------------------------------------------
// <auth> — sub-page role-gate element (SPEC §40.9.9 worked example, A-3.1).
//
// Per SCOPING §1.5 finding: SPEC §40.9.9 lines 17818-17820 reference
// `<auth role="admin">...</auth>` as if registered, but no compiler-side
// registration existed pre-A-3.1. This entry registers <auth> as a
// structural compile-time element (analogous to <errorBoundary>) — it
// gates rendering of its body markup on a closed-form role-predicate
// classified by A-3.3.
//
// Allowed attributes (per SCOPING §A-3.1.a):
//   role     — closed-form role predicate (e.g. "admin"). OQ-A3-A pins
//              the grammar (recommendation: single-variant + comma-OR).
//   check    — server-fn ref for runtime-fallback predicate
//              (`<auth check="hasPermission">`); per SPEC §40.9.5 line
//              17724 these are classified `closed_form: false` →
//              W-AUTH-RUNTIME-FALLBACK fires from A-2.5.
//   else     — fallback redirect path or markup (e.g. "/login"); per
//              SPEC §40.9.9 worked example.
//   redirect — alias for `else` when only a path is intended; OQ-A3-B
//              records as bare-string path (recommendation (a)).
//
// Does NOT render to DOM — A-3 / A-4 emit conditional render glue based
// on the per-role classification. rendersToDom: false matches the
// <errorBoundary> precedent for compiler-level structural elements.
// ---------------------------------------------------------------------------

REGISTRY.set("auth", {
  tag: "auth",
  attributes: new Map([
    ...GLOBAL_ATTRIBUTES,
    ["role",     attr("string")],   // closed-form role predicate (A-3.3 classifies)
    ["check",    attr("string")],   // server-fn ref for runtime-fallback path
    ["else",     attr("string")],   // fallback markup/redirect (SPEC §40.9.9)
    ["redirect", attr("string")],   // alias of `else` when only a path is meant
  ]),
  isVoid: false,
  rendersToDom: false,
});

// ---------------------------------------------------------------------------
// <errors> — first-class validation errors element (SPEC §55.8, L13, A1c C11).
//
// Renders error messages from a state cell's auto-synthesized `errors` array
// or compound rollup map. The element itself is a structural compiler-level
// construct — it expands to a placeholder `<span data-scrml-errors-anchor>`
// at codegen time, with runtime wiring that subscribes to the source errors
// cell and produces the rendered DOM.
//
// Required attribute `of=` references the source cell. Optional `all` flag
// renders the full error array (default: first error only).
// ---------------------------------------------------------------------------

REGISTRY.set("errors", {
  tag: "errors",
  attributes: new Map([
    ...GLOBAL_ATTRIBUTES,
    ["of",  attr("string", true)],   // required — references @cell or @compound.field
    ["all", attr("boolean")],        // optional flag — render full array
  ]),
  isVoid: false,        // self-closing form is canonical, but body-override arrow is legal
  rendersToDom: false,  // structural — codegen expands to a placeholder span
});

// ---------------------------------------------------------------------------
// <formFor> — type-driven form generation (SPEC §41.14, S102).
//
// Second general-position member of the §53.14 type-as-argument family
// (after parseVariant §41.13). Compile-time recognized at type-system stage
// (cross-ref §53.14.5) — the parser produces a regular markup node; the TS
// pass validates `for=` against the file's struct typeRegistry and rewrites
// the node into the equivalent Shape 2 + <errors of=> + <form action=>
// markup tree (§6.2 + §55 + §16 + §5.2.3 + §12.5).
//
// Attributes (per SPEC §41.14):
//   for=             — required struct-type identifier (E-FORMFOR-TYPE-NOT-STRUCT)
//   onsubmit=        — optional bare-form event handler (E-FORMFOR-ONSUBMIT-SIGNATURE)
//   as=              — optional @varName override for the synthesized compound cell
//   pick=            — optional array of field names to include (E-FORMFOR-PICK-INVALID-FIELD)
//   omit=            — optional array of field names to exclude (E-FORMFOR-OMIT-INVALID-FIELD)
//   partial=         — optional boolean; relaxes `req` validators when true
//   error-strategy=  — "per-field" (default) | "summary" | "both" (E-FORMFOR-ERROR-STRATEGY-INVALID)
//
// Slot children (per §41.14.4 + §16): each <slot name="<fieldName>">override
// markup customizes one field; `<slot name="submit">` customizes the submit
// button. Unknown slot names fire E-FORMFOR-SLOT-UNKNOWN.
//
// rendersToDom: false — codegen replaces this node with the synthesized
// markup tree; nothing renders FROM the formFor tag itself.
// ---------------------------------------------------------------------------

REGISTRY.set("formfor", {
  tag: "formFor",
  attributes: new Map([
    ...GLOBAL_ATTRIBUTES,
    ["for",            attr("string", true)],   // required — struct type identifier
    ["onsubmit",       attr("string")],         // optional — handler reference
    ["as",             attr("string")],         // optional — synth cell name override (@varName)
    ["pick",           attr("string")],         // optional — array literal of field names
    ["omit",           attr("string")],         // optional — array literal of field names
    ["partial",        attr("boolean")],        // optional — relax req validators
    ["error-strategy", attr("string")],         // optional — "per-field" | "summary" | "both"
  ]),
  isVoid: false,
  rendersToDom: false,
});

// ---------------------------------------------------------------------------
// <tableFor> — type-driven `<table>` rendering (SPEC §41.16, S105).
//
// Fourth general-position member of the §53.14 type-as-argument family
// (after parseVariant §41.13 + formFor §41.14 + schemaFor §41.15).
// Compile-time recognized at the type-system stage (cross-ref §53.14.5) —
// the parser produces a regular markup node; the TS pass validates the
// `for=` + `rows=` attributes against the file's struct typeRegistry and
// rewrites the node into a `<table>` + `<thead>` + `<tbody>` markup tree
// (per §41.16.11 Pillar 5 invariant).
//
// Attributes (per SPEC §41.16):
//   for=         — required struct-type identifier (E-TABLEFOR-TYPE-NOT-STRUCT)
//   rows=        — required @cell or expression yielding T[] (E-TABLEFOR-ROWS-MISSING)
//   pick=        — optional array of field names to include
//   omit=        — optional array of field names to exclude
//   selectable=  — optional @cell for selection surface (E-TABLEFOR-NO-PRIMARY-KEY)
//   selectedBy=  — optional PK field-name override (default "id")
//
// Children (per §41.16.3 + §41.16.9):
//   <column field="X" [header=...] [sortable] [align=...] [class=...]>
//   <empty>...fallback markup...</empty>
//
// rendersToDom: false — codegen replaces this node with the synthesized
// markup tree; nothing renders FROM the tableFor tag itself.
// ---------------------------------------------------------------------------

REGISTRY.set("tablefor", {
  tag: "tableFor",
  attributes: new Map([
    ...GLOBAL_ATTRIBUTES,
    ["for",         attr("string", true)],   // required — struct type identifier
    ["rows",        attr("string", true)],   // required — @cellOrExpr yielding T[]
    ["pick",        attr("string")],         // optional — array literal of field names
    ["omit",        attr("string")],         // optional — array literal of field names
    ["selectable",  attr("string")],         // optional — @cell for selection
    ["selectedBy",  attr("string")],         // optional — PK field-name override
  ]),
  isVoid: false,
  rendersToDom: false,
});

// ---------------------------------------------------------------------------
// <column> — per-column slot for tableFor (SPEC §41.16.3, S105).
//
// Recognized only inside `<tableFor>` elements; the type-system stage walks
// `<column>` children to capture per-column overrides. Outside `<tableFor>`,
// `<column>` is treated as a generic element (HTML doesn't define `<column>`;
// the spec-name allows it as a generic markup tag without special semantics).
//
// Attributes (per SPEC §41.16.3):
//   field=    — required struct-field name (E-TABLEFOR-COLUMN-FIELD-UNKNOWN)
//   header=   — optional header text override (mechanical default per §41.16.4)
//   sortable  — optional flag; opts column into sort surface
//   align=    — optional "left" | "right" | "center"
//   class=    — optional CSS class applied to both <th> and <td>
//   :let=     — optional parametric snippet `{(row) => ...}` for row-binding name
// ---------------------------------------------------------------------------

REGISTRY.set("column", {
  tag: "column",
  attributes: new Map([
    ...GLOBAL_ATTRIBUTES,
    ["field",     attr("string", true)],   // required
    ["header",    attr("string")],         // optional
    ["sortable",  attr("boolean")],        // optional flag
    ["align",     attr("string")],         // optional "left"|"right"|"center"
    [":let",      attr("string")],         // optional row-binding lambda
    // Tokenizer strips the leading `:`; the canonical `:let={...}` arrives as
    // `let` (Bug R28-2 / un-defer Bug 54). Recognize both forms.
    ["let",       attr("string")],
  ]),
  isVoid: false,
  rendersToDom: false,
});

// ---------------------------------------------------------------------------
// <empty> — empty-state slot for tableFor (SPEC §41.16.9, S105) AND for
// <each> (S130 — iteration Landing 1; per HU-1 Q4 ratification, `<empty>`
// is the canonical empty-state sub-element form for `<each in=...>` and
// `<each of=N>`).
//
// Recognized inside `<tableFor>` (renders inside an auto-wrapped
// `<tr><td colspan=N>...</td></tr>` when rows.length == 0), and inside
// `<each>` (renders when the iterated collection is empty or the count
// is 0). Outside those parent loci, `<empty>` is a structural-element
// misplacement (E-STRUCTURAL-ELEMENT-MISPLACED).
// ---------------------------------------------------------------------------

REGISTRY.set("empty", {
  tag: "empty",
  attributes: new Map([
    ...GLOBAL_ATTRIBUTES,
  ]),
  isVoid: false,
  rendersToDom: false,
});

// ---------------------------------------------------------------------------
// <each> — structural-element iteration (SPEC §17.X NEW per S130 HU-1
// ratifications; Phase 2 Landing 1 of 5).
//
// Two shapes (per Q6 ratification):
//   <each in=@collection [as name] [key=expr]>...</>   — collection iteration
//   <each of=N           [as name] [key=expr]>...</>   — count iteration
//
// `@.` is the contextual sigil for "the current iteration value" (current
// item in `in=` form; current index in `of=` form). The optional `as name`
// override binds the current iteration value to a meaningful name (aliased
// with `@.` inside the body) for nested-iteration disambiguation or
// readability.
//
// `key=` is the diff-keying expression. When omitted, the compiler infers
// from item shape: items with a `.id` field auto-infer `key=@.id`; otherwise
// emits W-EACH-KEY-001 info-lint. Override via explicit `key=expr` or
// suppress via `key=__index__`. For `<each of=N>` the default is `key=@.`
// (the index — stable positional).
//
// Body composition leverages SPEC §4.14 `:`-shorthand body (Q3
// RE-RATIFICATION — no new body-shorthand mechanism). Single-expression
// per-item bodies use `<li : @.name>` (with `:` INSIDE the opener,
// mandatory whitespace before, no closer); multi-element bodies use
// bare-body form.
//
// rendersToDom: false — codegen replaces this node with the synthesized
// iteration markup; nothing renders FROM the `<each>` tag itself.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// <render> — render-expression primitive (SPEC §19.x, render-expr-primitive-2026-06-15).
//
// Fires a HELD error-enum value's per-variant `renders` contract (§19.2) at
// the markup position where the value is held — the held-value counterpart to
// <errorBoundary> catching a LIVE `!`-call. Cohesive with <errors of=expr/>.
//
//   <render of=X/>   — X is an enum value (commonly a `<match>` arm payload
//                     binding, e.g. <Failed(err)> binding `err`).
//
// Self-closing, one attribute `of=<expr>` (the held value). It is a
// CONTRACT-FIRING primitive: it dispatches X to its enum's per-variant `renders`
// markup. It does NOT touch <errorBoundary> (stays pure catch) and does NOT
// generalize the `renders` grammar (stays error-enum-scoped). The exhaustiveness
// fence (every reachable variant must declare `renders`) reuses §19.6.6
// E-ERROR-005 logic via a dedicated diagnostic.
//
// rendersToDom: false — structural; codegen expands to a placeholder span +
// runtime per-variant dispatch (mirrors <errors>).
// ---------------------------------------------------------------------------

REGISTRY.set("render", {
  tag: "render",
  attributes: new Map([
    ...GLOBAL_ATTRIBUTES,
    ["of", attr("string", true)],   // required — the held enum value
  ]),
  isVoid: false,        // self-closing form is canonical
  rendersToDom: false,  // structural — codegen expands to a placeholder span
});

REGISTRY.set("each", {
  tag: "each",
  attributes: new Map([
    ...GLOBAL_ATTRIBUTES,
    ["in",   attr("string")],   // collection-iteration source (one-of-required with `of=`)
    ["of",   attr("string")],   // count-iteration source (one-of-required with `in=`)
    ["as",   attr("string")],   // optional iteration-variable override
    ["key",  attr("string")],   // optional diff-key override; absent → inferred
  ]),
  isVoid: false,
  rendersToDom: false,
});

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Look up an HTML element shape by tag name.
 *
 * @param {string} tagName — lowercase HTML tag name (e.g. "div", "input")
 * @returns {ElementShape|null} — the element shape, or null if not a known HTML element
 */
export function getElementShape(tagName) {
  return REGISTRY.get(tagName.toLowerCase()) ?? null;
}

/**
 * Check whether a tag name is a known HTML element (renders to DOM).
 * Note: `program` is a registered element but NOT an HTML element.
 *
 * @param {string} tagName
 * @returns {boolean}
 */
export function isHtmlElement(tagName) {
  const shape = REGISTRY.get(tagName.toLowerCase());
  return shape != null && shape.rendersToDom === true;
}

/**
 * Get all registered HTML element tag names.
 *
 * @returns {string[]}
 */
export function getAllElementNames() {
  return Array.from(REGISTRY.keys());
}
