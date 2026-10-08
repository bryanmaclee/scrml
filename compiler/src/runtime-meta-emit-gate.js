// SPEC §22.4.1 / §22.5.1 / §22.12 — the runtime `meta.emit(html)` gate (ruling S458 "a").
//
// Runtime `meta.emit(html)` output is held to the SAME closed rule as compile-time `emit()` output:
// plain markup, literal attribute values, no event-handler attributes, URL schemes judged per §5.2.
// A violation is refused, reported once to scrml's logging surface (§19.6.8 B5), and NOTHING is
// written. At run time every byte of the string is DATA (`meta.emit("<p>" + row.name + "</p>")`), so
// every attribute value is judged the way §5.2 rule 3 judges a data-supplied value.
//
// ONE READER. The string is parsed ONCE, inertly — as the content of an element of the insertion
// point's tag, created in a separate document with no browsing context (`createHTMLDocument`: nothing
// in it runs, no resource loads, no event fires). The gate walks THAT tree, and on success the SAME
// nodes are moved into the page — the string is never parsed a second time, so the checked tree is
// the inserted tree.
//
// This file is inlined into the client runtime verbatim (runtime-template.js, chunk 'metaemit',
// `export ` stripped) after the 'urlguard' chunk, whose scheme reader it calls
// (`_scrml_is_url_attr`, `_scrml_url_value_admitted` — runtime-url-guard.js; do NOT write a second
// URL reader here). `_SCRML_META_EMIT_KNOWN_ELEMENTS` is defined immediately before this file's source
// by runtime-template.js from the compiler's ONE element list (html-elements.js
// `standardMarkupElementNamesLowercase()`), the list compile-time `emit()` output is judged against;
// `_SCRML_CUSTOM_ELEMENT_NAME` likewise from html-elements.js `CUSTOM_ELEMENT_NAME_PATTERN`.
// Plain function and `const` declarations only; every top-level name carries the `_scrml_` /
// `_SCRML_` prefix the runtime reserves.

// Elements refused in runtime `meta.emit` output, by lowercased local name in ANY namespace (an
// `<svg><script>` is a script). Derived as:
//   - what compile-time `emit()` refuses: `script` (E-SCRIPT-001), `style` (E-STYLE-001);
//   - elements whose effect reaches beyond the emitted fragment, where a per-attribute §5.2 check of
//     the fragment cannot see what they do: `base` (re-bases every relative URL in the document),
//     `meta` (`http-equiv` refresh / cookies / policy), `link` (loads a stylesheet or resource into
//     the document); `iframe`, `frame`, `frameset`, `object`, `embed`, `applet`, `portal`,
//     `fencedframe` (a nested document or plugin whose content the gate never sees); and the SVG
//     animation elements `set`, `animate`, `animatecolor`, `animatemotion`, `animatetransform`, which
//     write ANOTHER element's attribute — a target an `href="#id"` may pick anywhere in the page.
// Every other element must ALSO be a standard HTML / SVG / MathML element or a custom element (below):
// the element test is an allow-list, this set only removes names from it.
const _SCRML_META_EMIT_REFUSED_ELEMENTS = new Set([
  "script", "style", "base", "meta", "link",
  "iframe", "frame", "frameset", "object", "embed", "applet", "portal", "fencedframe",
  "set", "animate", "animatecolor", "animatemotion", "animatetransform",
]);

// The three `on…` words that are not event handlers, matched by exact whole name (§5.2 rule 1). Every
// other attribute whose lowercased name begins with `on` is refused — the rule names the exceptions,
// never the events, so an event handler no list knows yet is refused too.
const _SCRML_META_EMIT_NON_EVENT_ON_WORDS = new Set(["one", "online", "onboarding"]);

// The compiler-owned attribute namespace (ruling S458 "your recs on all four", item 3): the
// runtime's own markers (`data-scrml-meta`, `data-scrml-outlet`, `data-scrml-each-mount`,
// `data-scrml-gated`, …) live under it, so an attribute whose name begins with it is refused —
// a prefix rule, never a list of marker names. Matched against the name the parse produced (the
// HTML tokenizer has already folded ASCII upper case and does not decode character references in
// attribute names), lowercased once more for names an SVG / MathML adjustment re-cased. Compile-time
// `emit()` output is held to the same prefix (meta-eval.ts `isCompilerOwnedAttrName`).
const _SCRML_META_EMIT_RESERVED_ATTR_PREFIX = "data-scrml-";

// The violation the tree rooted at `root` carries, as a short description naming the element and the
// attribute but NEVER the value (it is data, and may be sensitive) — or "" when it carries none.
// Walks every descendant, including a nested `<template>`'s content.
function _scrml_meta_emit_violation(root) {
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node.nodeType === 1) {
      const tag = String(node.localName || node.nodeName).toLowerCase();
      if (_SCRML_META_EMIT_REFUSED_ELEMENTS.has(tag)) return "a <" + tag + "> element";
      if (!_SCRML_META_EMIT_KNOWN_ELEMENTS.has(tag) && !_SCRML_CUSTOM_ELEMENT_NAME.test(tag)) {
        return "a <" + tag + "> element (not a standard HTML / SVG / MathML element or a custom element)";
      }
      const attrs = node.attributes;
      for (let i = 0; i < attrs.length; i++) {
        const name = String(attrs[i].name).toLowerCase();
        if (name.slice(0, 2) === "on" && !_SCRML_META_EMIT_NON_EVENT_ON_WORDS.has(name)) {
          return "an event-handler attribute " + name + "= on <" + tag + ">";
        }
        if (name === "srcdoc") return "a srcdoc= attribute on <" + tag + ">";
        if (name.slice(0, _SCRML_META_EMIT_RESERVED_ATTR_PREFIX.length) === _SCRML_META_EMIT_RESERVED_ATTR_PREFIX) {
          return "a " + name + "= attribute on <" + tag + "> (the data-scrml- attribute namespace is reserved " +
            "for the compiler's runtime markers)";
        }
        if (_scrml_is_url_attr(tag, name) && !_scrml_url_value_admitted(name, String(attrs[i].value))) {
          return "a " + name + "= URL on <" + tag + "> whose scheme is not admitted";
        }
      }
      if (tag === "template" && node.content) stack.push(node.content);
    } else if (node.nodeType !== 3 && node.nodeType !== 8 && node.nodeType !== 11) {
      return "a node of type " + node.nodeType;
    }
    for (let c = node.lastChild; c; c = c.previousSibling) stack.push(c);
  }
  return "";
}

// Parse `htmlString` inertly and judge it. `contextTag` is the local name of the element the nodes
// will be inserted into: the string is parsed as that element's content (the fragment-parsing context
// the ungated `placeholder.innerHTML = html` used), but inside a separate document with no browsing
// context — no script runs there and no image or other resource loads. Returns that inert container
// element, whose child nodes are the judged nodes, when the markup is admitted; `null` (after one
// report to the §19.6.8 logging surface) when it is not.
function _scrml_meta_emit_checked(scopeId, htmlString, contextTag) {
  const container = document.implementation.createHTMLDocument("").createElement(contextTag || "span");
  container.innerHTML = htmlString; // the same setter (and string conversion) the ungated path used
  const violation = _scrml_meta_emit_violation(container);
  if (violation === "") return container;
  const err = new Error(
    "refused meta.emit() output for ^{} block " + scopeId + ": it contains " + violation + " (SPEC " +
    "§22.4.1). Runtime meta.emit() admits plain markup only — no event-handler attributes, no srcdoc, " +
    "no data-scrml-* attribute (a compiler-reserved name), " +
    "and URL attributes with http:, https:, ftp:, mailto:, tel:, sms:, a relative URL, or a raster " +
    "data:image on an image source. Nothing was written.",
  );
  if (typeof _scrml_error_boundary_log === "function") {
    _scrml_error_boundary_log("meta-emit", err);
  } else if (typeof console !== "undefined" && typeof console.error === "function") {
    console.error("[scrml meta-emit] " + err.message);
  }
  return null;
}
