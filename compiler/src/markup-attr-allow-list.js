// SPEC §22.4.1 / §22.12 — the ONE attribute judge for markup a `^{}` block emits: compile-time
// `emit()` / `emit.raw()` output (meta-eval.ts `checkEmittedNodes`) and runtime `meta.emit(html)`
// output (runtime-meta-emit-gate.js). S459 round 3 (PA addendum 3, items 2 + 3).
//
// THE TEST IS CLOSED. An attribute is admitted only when its name is on the list below for the
// element's namespace (and, for the HTML per-element names, for that element); every other name is
// refused — an attribute no list knows yet (a new event handler, a new navigation or resource
// attribute) is refused, never let through. This replaces the earlier deny-list (`on*`, `srcdoc`,
// `data-scrml*`), which admitted everything it did not name. The lists name presentation, structure,
// accessibility and form-value attributes that never run text as script and never load or navigate
// on their own; the URL-valued names they admit (`href`, `src`, `srcset`, `cite`, `poster`,
// `xlink:href`, `itemid`, `itemtype`, `usemap`) are ADDITIONALLY judged by scheme per §5.2 by the
// caller (runtime: `_scrml_url_value_admitted` on the parsed value; compile time: the §5.2 sink check
// over the spliced nodes, which reads the literal text).
//
// Deliberately NOT on the lists (refused): every `on*` event handler; `srcdoc`; `is` (instantiates a
// page-registered customized built-in); `nonce` / `integrity`; `ping`; `xml:base` (re-bases relative
// URLs); `action`, `method`, `enctype`, `target` on `<form>`, and `form`, `formaction`, `formmethod`,
// `formenctype`, `formtarget`, `formnovalidate` (data must not redirect or retarget a submission — of
// the emitted form or, through `form=`, of a form already on the page); `popovertarget`,
// `popovertargetaction`, `commandfor`, `command`, `anchor` (act on an element elsewhere in the page by
// id); the SVG animation attributes `attributename`, `to`, `from`, `by`, `begin` (their elements are
// refused anyway); and the compiler-owned `data-scrml` / `data-scrml-*` namespace (ruling S458 "your
// recs on all four" item 3 + PA-ruled S459 consequence: the component CSS scope root and the runtime
// markers).
//
// Names are compared as the HTML tokenizer leaves them: ASCII upper case folded to lower case (the
// tokenizer does not decode character references in a name). SVG's camelCase attributes (`viewBox`)
// are listed lowercased; callers fold before asking.
//
// This file is BOTH a compiler module (imported by meta-eval.ts) and runtime source (inlined verbatim,
// `export ` stripped, into the 'metaemit' chunk by runtime-template.js), so it holds only `const`
// tables and plain functions, every top-level name `_scrml_` / `_SCRML_` prefixed, no imports.

// Admitted on every element of every namespace.
export const _SCRML_EMIT_GLOBAL_ATTRS = new Set([
  "accesskey", "autocapitalize", "autocorrect", "autofocus", "class", "contenteditable", "dir",
  "draggable", "enterkeyhint", "exportparts", "hidden", "id", "inert", "inputmode", "itemid",
  "itemprop", "itemref", "itemscope", "itemtype", "lang", "part", "popover", "role", "slot",
  "spellcheck", "style", "tabindex", "title", "translate", "writingsuggestions",
  "xml:lang", "xml:space", "xmlns", "xmlns:xlink",
]);

// HTML per-element names: attribute → the (lowercased) HTML elements it is admitted on.
export const _SCRML_EMIT_HTML_ELEMENT_ATTRS = {
  abbr: ["td", "th"],
  accept: ["input"],
  "accept-charset": ["form"],
  alt: ["img", "area", "input"],
  autocomplete: ["form", "input", "select", "textarea"],
  autoplay: ["audio", "video"],
  checked: ["input"],
  cite: ["blockquote", "q", "del", "ins"],
  cols: ["textarea"],
  colspan: ["td", "th"],
  controls: ["audio", "video"],
  coords: ["area"],
  crossorigin: ["img", "audio", "video"],
  datetime: ["time", "del", "ins"],
  decoding: ["img"],
  default: ["track"],
  dirname: ["input", "textarea"],
  disabled: ["button", "fieldset", "input", "optgroup", "option", "select", "textarea"],
  download: ["a", "area"],
  fetchpriority: ["img"],
  for: ["label", "output"],
  headers: ["td", "th"],
  height: ["img", "video", "canvas", "input", "source"],
  high: ["meter"],
  href: ["a", "area"],
  hreflang: ["a", "area"],
  ismap: ["img"],
  kind: ["track"],
  label: ["option", "optgroup", "track"],
  list: ["input"],
  loading: ["img"],
  loop: ["audio", "video"],
  low: ["meter"],
  max: ["input", "meter", "progress"],
  maxlength: ["input", "textarea"],
  media: ["source"],
  min: ["input", "meter"],
  minlength: ["input", "textarea"],
  multiple: ["input", "select"],
  muted: ["audio", "video"],
  name: ["button", "fieldset", "input", "output", "select", "textarea", "map", "details"],
  novalidate: ["form"],
  open: ["details", "dialog"],
  optimum: ["meter"],
  pattern: ["input"],
  placeholder: ["input", "textarea"],
  playsinline: ["video"],
  poster: ["video"],
  preload: ["audio", "video"],
  readonly: ["input", "textarea"],
  referrerpolicy: ["a", "area", "img"],
  rel: ["a", "area"],
  required: ["input", "select", "textarea"],
  reversed: ["ol"],
  rows: ["textarea"],
  rowspan: ["td", "th"],
  scope: ["th"],
  selected: ["option"],
  shape: ["area"],
  size: ["input", "select"],
  sizes: ["img", "source"],
  span: ["col", "colgroup"],
  src: ["img", "audio", "video", "source", "track", "input"],
  srclang: ["track"],
  srcset: ["img", "source"],
  start: ["ol"],
  step: ["input"],
  type: ["a", "button", "input", "ol", "source", "menu"],
  usemap: ["img"],
  value: ["button", "data", "input", "li", "meter", "option", "progress"],
  width: ["img", "video", "canvas", "input", "source", "col", "colgroup"],
  wrap: ["textarea"],
};

// SVG names (any SVG element; their elements are judged separately). Lowercased.
export const _SCRML_EMIT_SVG_ATTRS = new Set([
  "alignment-baseline", "baseline-shift", "baseprofile", "clip", "clip-path", "clip-rule",
  "clippathunits", "color", "color-interpolation", "color-interpolation-filters", "cursor", "cx", "cy",
  "d", "diffuseconstant", "direction", "display", "divisor", "dominant-baseline", "dx", "dy",
  "edgemode", "elevation", "fill", "fill-opacity", "fill-rule", "filter", "filterunits",
  "flood-color", "flood-opacity", "focusable", "font-family", "font-size", "font-size-adjust",
  "font-stretch", "font-style", "font-variant", "font-weight", "fr", "fx", "fy", "gradienttransform",
  "gradientunits", "height", "href", "image-rendering", "in", "in2", "k", "k1", "k2", "k3", "k4",
  "kernelmatrix", "kernelunitlength", "lengthadjust", "letter-spacing", "lighting-color",
  "limitingconeangle", "marker-end", "marker-mid", "marker-start", "markerheight", "markerunits",
  "markerwidth", "mask", "maskcontentunits", "maskunits", "mode", "numoctaves", "offset", "opacity",
  "operator", "order", "orient", "overflow", "paint-order", "pathlength", "patterncontentunits",
  "patterntransform", "patternunits", "pointer-events", "points", "pointsatx", "pointsaty",
  "pointsatz", "preservealpha", "preserveaspectratio", "primitiveunits", "r", "radius", "refx",
  "refy", "result", "rotate", "rx", "ry", "scale", "seed", "shape-rendering", "spacing",
  "specularconstant", "specularexponent", "spreadmethod", "startoffset", "stddeviation",
  "stitchtiles", "stop-color", "stop-opacity", "stroke", "stroke-dasharray", "stroke-dashoffset",
  "stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "stroke-opacity", "stroke-width",
  "surfacescale", "systemlanguage", "tablevalues", "targetx", "targety", "text-anchor",
  "text-decoration", "text-rendering", "textlength", "transform", "transform-origin", "type",
  "unicode-bidi", "values", "vector-effect", "version", "viewbox", "visibility", "width",
  "word-spacing", "writing-mode", "x", "x1", "x2", "xchannelselector", "xlink:href", "xlink:title",
  "y", "y1", "y2", "ychannelselector", "z",
]);

// MathML names (any MathML element). Lowercased.
export const _SCRML_EMIT_MATHML_ATTRS = new Set([
  "accent", "accentunder", "align", "arg", "close", "columnalign", "columnlines", "columnspacing",
  "columnspan", "depth", "display", "displaystyle", "encoding", "equalcolumns", "equalrows", "fence",
  "form", "frame", "framespacing", "height", "href", "intent", "largeop", "linethickness", "lspace",
  "mathbackground", "mathcolor", "mathsize", "mathvariant", "maxsize", "minsize", "movablelimits",
  "notation", "open", "rowalign", "rowlines", "rowspacing", "rowspan", "rspace", "scriptlevel",
  "separator", "separators", "side", "stretchy", "symmetric", "voffset", "width",
]);

export const _SCRML_EMIT_NS_HTML = "http://www.w3.org/1999/xhtml";
export const _SCRML_EMIT_NS_SVG = "http://www.w3.org/2000/svg";
export const _SCRML_EMIT_NS_MATHML = "http://www.w3.org/1998/Math/MathML";

// Fold ASCII upper case to lower case — the HTML tokenizer's only change to an attribute name.
export function _scrml_emit_fold_name(name) {
  return String(name).replace(/[A-Z]/g, (c) => c.toLowerCase());
}

// The compiler-owned namespace: `data-scrml` itself (the component CSS scope root) and every
// `data-scrml-*` name (the runtime markers). `lowerName` is already folded.
export function _scrml_emit_reserved_attr_name(lowerName) {
  return lowerName === "data-scrml" || lowerName.slice(0, 11) === "data-scrml-";
}

// The ONE attribute judge. `ns` is the element's namespace URI (one of the three above; anything else
// is judged as HTML), `tag` its lowercased local name, `name` the attribute name as written / parsed.
// Returns "" when the name is admitted, else a short reason naming the attribute (never its value).
export function _scrml_emit_attr_name_verdict(ns, tag, name) {
  const lowerName = _scrml_emit_fold_name(name);
  if (_scrml_emit_reserved_attr_name(lowerName)) {
    return "a " + lowerName + "= attribute on <" + tag + "> (the data-scrml attribute namespace is " +
      "reserved for the compiler's own markers)";
  }
  if (lowerName.slice(0, 5) === "data-" && lowerName.length > 5) return "";
  if (lowerName.slice(0, 5) === "aria-" && lowerName.length > 5) return "";
  if (_SCRML_EMIT_GLOBAL_ATTRS.has(lowerName)) return "";
  if (ns === _SCRML_EMIT_NS_SVG) {
    if (_SCRML_EMIT_SVG_ATTRS.has(lowerName)) return "";
  } else if (ns === _SCRML_EMIT_NS_MATHML) {
    if (_SCRML_EMIT_MATHML_ATTRS.has(lowerName)) return "";
  } else if (Object.prototype.hasOwnProperty.call(_SCRML_EMIT_HTML_ELEMENT_ATTRS, lowerName)
    && _SCRML_EMIT_HTML_ELEMENT_ATTRS[lowerName].indexOf(String(tag).toLowerCase()) !== -1) {
    return "";
  }
  if (lowerName.slice(0, 2) === "on") return "an event-handler attribute " + lowerName + "= on <" + tag + ">";
  return (/^[aeiou]/.test(lowerName) ? "an " : "a ") + lowerName + "= attribute on <" + tag + "> (not on the admitted attribute list for " +
    "emitted markup)";
}

// The value half of the judge (names already admitted): an `id` / `name` whose value begins with the
// compiler-reserved prefix `_scrml` / `__scrml` (§47.1.1) is refused — such an element would become a
// `window._scrml…` named property, which the runtime's own `typeof _scrml_x === "function"` probes
// would then find. Returns "" or a reason naming the attribute (never its value).
export function _scrml_emit_attr_value_verdict(name, value) {
  const lowerName = _scrml_emit_fold_name(name);
  if ((lowerName === "id" || lowerName === "name") && /^_{1,2}scrml/i.test(String(value).trim())) {
    return "a " + lowerName + "= value in the compiler-reserved _scrml / __scrml namespace";
  }
  return "";
}

// The namespace of a child element named `childTag` (lowercased) whose parent is in namespace
// `parentNs` with local name `parentTag` — the HTML tree builder's rule, for callers (compile time)
// that judge a tree no parser built: `<svg>` opens SVG, `<math>` opens MathML, and an SVG
// `foreignObject` / `desc` / `title` or a MathML `annotation-xml` (text/html) / token element returns
// to HTML.
export function _scrml_emit_child_ns(parentNs, parentTag, childTag) {
  if (parentNs === _SCRML_EMIT_NS_SVG) {
    if (parentTag === "foreignobject" || parentTag === "desc" || parentTag === "title") {
      return childTag === "svg" ? _SCRML_EMIT_NS_SVG : childTag === "math" ? _SCRML_EMIT_NS_MATHML : _SCRML_EMIT_NS_HTML;
    }
    return _SCRML_EMIT_NS_SVG;
  }
  if (parentNs === _SCRML_EMIT_NS_MATHML) {
    if (parentTag === "annotation-xml" || parentTag === "mi" || parentTag === "mo" || parentTag === "mn"
      || parentTag === "ms" || parentTag === "mtext") {
      return childTag === "svg" ? _SCRML_EMIT_NS_SVG : childTag === "math" ? _SCRML_EMIT_NS_MATHML : _SCRML_EMIT_NS_HTML;
    }
    return _SCRML_EMIT_NS_MATHML;
  }
  return childTag === "svg" ? _SCRML_EMIT_NS_SVG : childTag === "math" ? _SCRML_EMIT_NS_MATHML : _SCRML_EMIT_NS_HTML;
}
