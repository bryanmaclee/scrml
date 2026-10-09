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
// after the `_SCRML_EMIT_FORM_MEMBERS` declaration of dom-named-property-members.js (the only one the
// runtime carries — S460 N6) and
// markup-attr-allow-list.js (`_scrml_emit_attr_name_verdict`, `_scrml_emit_attr_value_verdict`,
// `_scrml_emit_named_value_verdict`, `_scrml_emit_is_form_control`, `_scrml_emit_fold_name`).
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
    parentNode: getter(N, "parentNode"),
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
    // The live prototype the named-property rule (S459 round 4 F2) asks `in` of, on top of the
    // generated HTMLFormElement member table. Captured here, at load; data cannot reach it.
    formProto: w.HTMLFormElement ? w.HTMLFormElement.prototype : null,
  };
  for (const k in dom) {
    if (dom[k] === null && k !== "templateContent" && k !== "formProto") return null;
  }
  return dom;
}
const _SCRML_META_EMIT_DOM = _scrml_meta_emit_dom();

// Is `el` (an element of the page) inside an HTML `<form>`? Walked up through the captured `parentNode`
// / `localName` / `namespaceURI` accessors — the page's own markup may name its elements anything.
function _scrml_meta_emit_inside_form(el) {
  const dom = _SCRML_META_EMIT_DOM;
  for (let p = dom.parentNode.call(el); p; p = dom.parentNode.call(p)) {
    if (dom.nodeType.call(p) !== 1) continue;
    if (dom.localName.call(p) === "form" && dom.namespaceURI.call(p) === _SCRML_EMIT_NS_HTML) return true;
  }
  return false;
}

// The violation the tree rooted at `root` carries, as a short description naming the element and the
// attribute but NEVER the value (it is data, and may be sensitive) — or "" when it carries none.
// Walks every descendant, including an HTML `<template>`'s content, reading ONLY through the captured
// accessors. `inPageForm`: the insertion point sits inside a page `<form>` (S459 round 4 F1) — then a
// form-associated control anywhere in the tree is refused (it would join that form's submission and
// named properties: an injected `<input type=hidden name=amount>` fed the page form's FormData, an
// injected `<button type=submit>` submitted it) — except inside an HTML `<template>`'s inert content
// (S460 N5). A named-property `id` / `name` (F2) is reported only
// when the walk finds nothing else, so a refusal names what such a shadowing would have hidden.
function _scrml_meta_emit_violation(root, inPageForm) {
  const dom = _SCRML_META_EMIT_DOM;
  const call = (fn, self, a, b) => fn.call(self, a, b);
  // `document: null`: no document table ships (S460 N6; why: `_scrml_emit_named_value_verdict`).
  const members = { document: null, form: _SCRML_EMIT_FORM_MEMBERS, formProto: dom.formProto };
  // [node, insideAForm, insideTemplateContent]. Template content is inert — it joins no form and no
  // radio group — so the page-form rule, the form half of the named-property rule and the radio-group
  // rule do not apply inside it (S460 N5); every other rule does.
  const stack = [];
  let shadowing = "";
  const pushChildren = (parent, inForm, inTemplate) => {
    const kids = [];
    for (let c = call(dom.firstChild, parent); c; c = call(dom.nextSibling, c)) kids.push(c);
    for (let k = kids.length - 1; k >= 0; k--) stack.push([kids[k], inForm, inTemplate]);
  };
  pushChildren(root, inPageForm === true, false);
  while (stack.length > 0) {
    const entry = stack.pop();
    const node = entry[0];
    let inForm = entry[1];
    const inTemplate = entry[2];
    const type = call(dom.nodeType, node);
    if (type === 1) {
      // Names are folded the way the HTML tokenizer folds them — ASCII only (a KELVIN SIGN stays
      // itself, as it does in the compile-time judge).
      const tag = _scrml_emit_fold_name(String(call(dom.localName, node)));
      const ns = call(dom.namespaceURI, node);
      if (_SCRML_META_EMIT_REFUSED_ELEMENTS.has(tag)) return "a <" + tag + "> element";
      const isCustom = _SCRML_CUSTOM_ELEMENT_NAME.test(tag);
      if (!_SCRML_META_EMIT_KNOWN_ELEMENTS.has(tag) && !isCustom) {
        return "a <" + tag + "> element (not a standard HTML / SVG / MathML element or a custom element)";
      }
      if (inPageForm === true && inTemplate !== true && _scrml_emit_is_form_control(ns, tag, isCustom)) {
        return "a <" + tag + "> element inserted inside a page <form> (a form control there would join " +
          "that form's submission)";
      }
      const attrs = call(dom.attributes, node);
      const n = call(dom.attrsLength, attrs);
      const read = [];
      let hasNameAttr = false;
      for (let i = 0; i < n; i++) {
        const a = call(dom.attrsItem, attrs, i);
        const name = _scrml_emit_fold_name(String(call(dom.attrName, a)));
        if (name === "name") hasNameAttr = true;
        read.push([name, String(call(dom.attrValue, a))]);
      }
      for (let i = 0; i < read.length; i++) {
        const name = read[i][0];
        const value = read[i][1];
        const nameVerdict = _scrml_emit_attr_name_verdict(ns, tag, name);
        if (nameVerdict !== "") return nameVerdict;
        const valueVerdict = _scrml_emit_attr_value_verdict(name, value, tag);
        if (valueVerdict !== "") return valueVerdict + " on <" + tag + ">";
        if (shadowing === "") {
          // Recorded, not returned: the walk goes on (see above).
          shadowing = _scrml_emit_named_value_verdict(ns, tag, name, value, hasNameAttr, inForm, isCustom, members);
        }
        if (_scrml_is_url_attr("", name) && !_scrml_url_value_admitted(name, value)) {
          return "a " + name + "= URL on <" + tag + "> whose scheme is not admitted";
        }
      }
      // A radio button outside any form joins the radio group of every form-less radio of the same
      // name in the page — checking it unchecks the page's (S460 N2a). Inside an emitted `<form>` its
      // group is that form's (a page form around the insertion point already refused it above).
      if (tag === "input" && ns === _SCRML_EMIT_NS_HTML && inForm !== true && inTemplate !== true) {
        let inputType = "";
        let groupName = "";
        for (let i = 0; i < read.length; i++) {
          if (read[i][0] === "type") inputType = _scrml_emit_fold_name(read[i][1]);
          if (read[i][0] === "name") groupName = read[i][1];
        }
        if (inputType === "radio" && groupName !== "") {
          return "a name= on an <input type=radio> outside any form (it would join a radio group of the page)";
        }
      }
      if (tag === "form" && ns === _SCRML_EMIT_NS_HTML) inForm = true;
      // Only an HTML `<template>` has a content fragment (the getter throws on an SVG / MathML element
      // named `template`, which is an ordinary element whose children are walked below).
      if (tag === "template" && ns === _SCRML_EMIT_NS_HTML && dom.templateContent !== null) {
        const content = call(dom.templateContent, node);
        if (content) stack.push([content, false, true]);
      }
    } else if (type === 11) {
      // a template's content fragment — its children are judged like any others
    } else if (type !== 3 && type !== 8) {
      return "a node of type " + type;
    }
    pushChildren(node, inForm, inTemplate);
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
// `inPageForm`: the insertion point is inside a page `<form>` (see `_scrml_meta_emit_violation`).
// Anything the reading throws (an accessor the environment applies differently) is a refusal too —
// reported, nothing written, never an exception out of `meta.emit`.
function _scrml_meta_emit_checked(scopeId, htmlString, contextTag, inPageForm) {
  const dom = _SCRML_META_EMIT_DOM;
  let violation = "";
  let container = null;
  try {
    const impl = dom.implementation.call(document);
    const inert = dom.createHTMLDocument.call(impl, "");
    container = dom.createElement.call(inert, contextTag || "span");
    dom.innerHTML.call(container, String(htmlString)); // the string conversion the ungated path used
    violation = _scrml_meta_emit_violation(container, inPageForm);
  } catch (e) {
    violation = "markup the gate could not read to the end (reading it threw)";
  }
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
  // The fallback span is appended to <body>, outside any form.
  const inPageForm = placeholder ? _scrml_meta_emit_inside_form(placeholder) : false;
  const judged = _scrml_meta_emit_checked(scopeId, htmlString, contextTag, inPageForm);
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
