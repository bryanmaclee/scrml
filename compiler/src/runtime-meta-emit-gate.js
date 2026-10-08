// SPEC §22.4.1 / §22.5.1 / §22.12 — the runtime `meta.emit(html)` gate (ruling S458 "a"; S459 round 3).
//
// Runtime `meta.emit(html)` output is held to the SAME closed rule as compile-time `emit()` output:
// admitted elements, admitted attribute NAMES (markup-attr-allow-list.js — the one attribute judge
// both phases use), URL schemes judged per §5.2. A violation is refused, reported once to scrml's
// logging surface (§19.6.8 B5), and NOTHING is written. At run time every byte of the string is DATA
// (`meta.emit("<p>" + row.name + "</p>")`), so every attribute value is judged the way §5.2 rule 3
// judges a data-supplied value.
//
// ONE READER. The string is parsed ONCE, inertly — as the content of an element of the insertion
// point's tag, created in a separate document with no browsing context (`createHTMLDocument`: nothing
// in it runs, no resource loads, no event fires). The gate walks THAT tree, and on success the SAME
// nodes are moved into the page — the string is never parsed a second time, so the checked tree is
// the inserted tree.
//
// UNFORGEABLE READS (S459 round 3, review HIGH). The tree the gate walks was SHAPED BY THE DATA, and the
// DOM lets markup shadow properties: on an `HTMLFormElement` ([LegacyOverrideBuiltIns]) a control named
// `lastChild`, `previousSibling` or `attributes` replaces those properties, and a `name=` / `id=` can
// shadow `document.*` members. A gate that reads `node.lastChild` / `node.attributes` therefore judged a
// tree the data chose for it (four payloads were inserted unread and ran). So NOTHING here reads a
// property of a node, of `document`, or of an attribute map: every read goes through an accessor or
// method taken from the PROTOTYPE at chunk load (`Object.getOwnPropertyDescriptor(Node.prototype,
// "firstChild").get`, …) and applied with `.call` — those cannot be shadowed by anything in the data.
// Chunk load runs before any `meta.emit`, so the captured functions are the platform's own.
//
// This file is inlined into the client runtime verbatim (runtime-template.js, chunk 'metaemit',
// `export ` stripped) after the 'urlguard' chunk, whose scheme reader it calls (`_scrml_is_url_attr`,
// `_scrml_url_value_admitted` — runtime-url-guard.js; do NOT write a second URL reader here), and
// after markup-attr-allow-list.js (`_scrml_emit_attr_name_verdict`, `_scrml_emit_attr_value_verdict`).
// `_SCRML_META_EMIT_KNOWN_ELEMENTS` is defined immediately before this file's source by
// runtime-template.js from the compiler's ONE element list (html-elements.js
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

// The platform's own accessors, taken from the prototypes once, at chunk load (see UNFORGEABLE READS).
// `null` where there is no DOM (the chunk is then inert: `_scrml_meta_emit_insert` returns at once).
function _scrml_meta_emit_dom() {
  const w = typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : null);
  if (!w || typeof w.Node !== "function" || typeof w.Element !== "function" || typeof w.Document !== "function") {
    return null;
  }
  const getter = (proto, name) => {
    for (let p = proto; p; p = Object.getPrototypeOf(p)) {
      const d = Object.getOwnPropertyDescriptor(p, name);
      if (d && typeof d.get === "function") return d.get;
    }
    return null;
  };
  const setter = (proto, name) => {
    for (let p = proto; p; p = Object.getPrototypeOf(p)) {
      const d = Object.getOwnPropertyDescriptor(p, name);
      if (d && typeof d.set === "function") return d.set;
    }
    return null;
  };
  const method = (proto, name) => {
    for (let p = proto; p; p = Object.getPrototypeOf(p)) {
      const d = Object.getOwnPropertyDescriptor(p, name);
      if (d && typeof d.value === "function") return d.value;
    }
    return null;
  };
  const N = w.Node.prototype;
  const E = w.Element.prototype;
  const D = w.Document.prototype;
  // DOMImplementation's prototype: the global constructor's, or (where the environment does not expose
  // the constructor) the prototype of the real `document.implementation`, read once at load through the
  // captured Document getter — `document` itself is unforgeable.
  const implGetter = getter(D, "implementation");
  let implProto = w.DOMImplementation ? w.DOMImplementation.prototype : null;
  if (!implProto && implGetter && typeof document !== "undefined") {
    const impl = implGetter.call(document);
    implProto = impl ? Object.getPrototypeOf(impl) : null;
  }
  const dom = {
    firstChild: getter(N, "firstChild"),
    nextSibling: getter(N, "nextSibling"),
    nodeType: getter(N, "nodeType"),
    appendChild: method(N, "appendChild"),
    removeChild: method(N, "removeChild"),
    localName: getter(E, "localName"),
    namespaceURI: getter(E, "namespaceURI"),
    attributes: getter(E, "attributes"),
    setAttribute: method(E, "setAttribute"),
    innerHTML: setter(E, "innerHTML") || (w.HTMLElement ? setter(w.HTMLElement.prototype, "innerHTML") : null),
    attrsLength: w.NamedNodeMap ? getter(w.NamedNodeMap.prototype, "length") : null,
    attrsItem: w.NamedNodeMap ? method(w.NamedNodeMap.prototype, "item") : null,
    attrName: w.Attr ? getter(w.Attr.prototype, "name") : null,
    attrValue: w.Attr ? getter(w.Attr.prototype, "value") : null,
    templateContent: w.HTMLTemplateElement ? getter(w.HTMLTemplateElement.prototype, "content") : null,
    implementation: implGetter,
    querySelector: method(D, "querySelector"),
    createElement: method(D, "createElement"),
    body: getter(D, "body") || (w.HTMLDocument ? getter(w.HTMLDocument.prototype, "body") : null),
    createHTMLDocument: implProto ? method(implProto, "createHTMLDocument") : null,
    // `id=` / `name=` values that would shadow a member of an `HTMLFormElement` (its own members and
    // every inherited Node / Element / HTMLElement member) — derived from the live prototype, not a
    // list (UNFORGEABLE READS, belt and braces).
    formProto: w.HTMLFormElement ? w.HTMLFormElement.prototype : null,
  };
  for (const k in dom) if (dom[k] === null && k !== "templateContent" && k !== "formProto") return null;
  return dom;
}
const _SCRML_META_EMIT_DOM = _scrml_meta_emit_dom();

// Does an `id` / `name` VALUE name a member of `HTMLFormElement` (and so, inside a form, shadow that
// member — `<input name="action">` makes `form.action` the input)? Read with `in` on the captured
// prototype, which data cannot reach.
function _scrml_meta_emit_shadows_member(value) {
  const proto = _SCRML_META_EMIT_DOM && _SCRML_META_EMIT_DOM.formProto;
  return proto !== null && proto !== undefined && value !== "" && (value in proto);
}

// The violation the tree rooted at `root` carries, as a short description naming the element and the
// attribute but NEVER the value (it is data, and may be sensitive) — or "" when it carries none.
// Walks every descendant, including a nested `<template>`'s content, reading ONLY through the captured
// accessors. A DOM-member `id` / `name` (UNFORGEABLE READS, belt and braces) is reported only when the
// walk finds nothing else.
function _scrml_meta_emit_violation(root) {
  const dom = _SCRML_META_EMIT_DOM;
  const call = (fn, self, a, b) => fn.call(self, a, b);
  const stack = [];
  let shadowing = "";
  for (let c = call(dom.firstChild, root); c; c = call(dom.nextSibling, c)) stack.push(c);
  stack.reverse();
  while (stack.length > 0) {
    const node = stack.pop();
    const type = call(dom.nodeType, node);
    if (type === 1) {
      const tag = String(call(dom.localName, node)).toLowerCase();
      const ns = call(dom.namespaceURI, node);
      if (_SCRML_META_EMIT_REFUSED_ELEMENTS.has(tag)) return "a <" + tag + "> element";
      if (!_SCRML_META_EMIT_KNOWN_ELEMENTS.has(tag) && !_SCRML_CUSTOM_ELEMENT_NAME.test(tag)) {
        return "a <" + tag + "> element (not a standard HTML / SVG / MathML element or a custom element)";
      }
      const attrs = call(dom.attributes, node);
      const n = call(dom.attrsLength, attrs);
      for (let i = 0; i < n; i++) {
        const a = call(dom.attrsItem, attrs, i);
        const name = String(call(dom.attrName, a)).toLowerCase();
        const value = String(call(dom.attrValue, a));
        const nameVerdict = _scrml_emit_attr_name_verdict(ns, tag, name);
        if (nameVerdict !== "") return nameVerdict;
        const valueVerdict = _scrml_emit_attr_value_verdict(name, value, tag);
        if (valueVerdict !== "") return valueVerdict + " on <" + tag + ">";
        if ((name === "id" || name === "name") && shadowing === "" && _scrml_meta_emit_shadows_member(value)) {
          // Recorded, not returned: the walk goes on, so a refusal names what the shadowing would have
          // hidden (an `onerror` past a `name="lastChild"`) — the evidence that the walk was not fooled.
          shadowing = "a " + name + "= value on <" + tag + "> that names a DOM member (it would shadow " +
            "that member of an enclosing form)";
        }
        if (_scrml_is_url_attr("", name) && !_scrml_url_value_admitted(name, value)) {
          return "a " + name + "= URL on <" + tag + "> whose scheme is not admitted";
        }
      }
      if (tag === "template" && dom.templateContent !== null) {
        const content = call(dom.templateContent, node);
        if (content) stack.push(content);
      }
    } else if (type === 11) {
      // a template's content fragment — its children are judged like any others
    } else if (type !== 3 && type !== 8) {
      return "a node of type " + type;
    }
    const kids = [];
    for (let c = call(dom.firstChild, node); c; c = call(dom.nextSibling, c)) kids.push(c);
    for (let k = kids.length - 1; k >= 0; k--) stack.push(kids[k]);
  }
  return shadowing;
}

// Report one refusal to the §19.6.8 logging surface.
function _scrml_meta_emit_report(scopeId, violation) {
  const err = new Error(
    "refused meta.emit() output for ^{} block " + scopeId + ": it contains " + violation + " (SPEC " +
    "§22.4.1, §22.12). Runtime meta.emit() admits the same closed markup as compile-time emit(): " +
    "standard elements, attributes on the admitted list (no event handlers, no data-scrml or " +
    "data-scrml-* name), and URL attributes with http:, https:, ftp:, mailto:, tel:, sms:, a relative " +
    "URL, or a raster data:image on an image source. Nothing was written.",
  );
  if (typeof _scrml_error_boundary_log === "function") {
    _scrml_error_boundary_log("meta-emit", err);
  } else if (typeof console !== "undefined" && typeof console.error === "function") {
    console.error("[scrml meta-emit] " + err.message);
  }
}

// Parse `htmlString` inertly as the content of a `contextTag` element in a document with no browsing
// context and judge it. Returns that inert container when admitted; `null` (after one report) when not.
function _scrml_meta_emit_checked(scopeId, htmlString, contextTag) {
  const dom = _SCRML_META_EMIT_DOM;
  const impl = dom.implementation.call(document);
  const inert = dom.createHTMLDocument.call(impl, "");
  const container = dom.createElement.call(inert, contextTag || "span");
  dom.innerHTML.call(container, String(htmlString)); // the string conversion the ungated path used
  const violation = _scrml_meta_emit_violation(container);
  if (violation === "") return container;
  _scrml_meta_emit_report(scopeId, violation);
  return null;
}

// `meta.emit(html)`: judge, then move the judged nodes to the block's placeholder (created at the end
// of `<body>` when the block has none), replacing what it held. Every DOM read and write here goes
// through the captured accessors too: `document.querySelector` itself can be shadowed by a `name=`.
function _scrml_meta_emit_insert(scopeId, htmlString) {
  const dom = _SCRML_META_EMIT_DOM;
  if (typeof document === "undefined") return;
  if (dom === null) {
    // A document but none of the platform accessors the gate reads through: it cannot judge, so it
    // writes nothing — and says so (fail closed, never silent).
    _scrml_meta_emit_report(scopeId, "markup this environment gives the gate no unforgeable DOM accessors to read");
    return;
  }
  let placeholder = dom.querySelector.call(document, '[data-scrml-meta="' + scopeId + '"]');
  const contextTag = placeholder ? String(dom.localName.call(placeholder)) : "span";
  const judged = _scrml_meta_emit_checked(scopeId, htmlString, contextTag);
  if (judged === null) return;
  if (!placeholder) {
    placeholder = dom.createElement.call(document, "span");
    dom.setAttribute.call(placeholder, "data-scrml-meta", scopeId);
    dom.appendChild.call(dom.body.call(document), placeholder);
  }
  for (let c = dom.firstChild.call(placeholder); c; c = dom.firstChild.call(placeholder)) {
    dom.removeChild.call(placeholder, c);
  }
  for (let c = dom.firstChild.call(judged); c; c = dom.firstChild.call(judged)) {
    dom.appendChild.call(placeholder, c);
  }
}
