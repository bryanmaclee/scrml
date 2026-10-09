/**
 * meta-emit-round4-s459.test.js — SPEC §22.4.1 / §22.12, S459 round 4 (review LAND-WITH-NITS, PA
 * decisions). COMPILE-TIME `emit()` output; the runtime half executes the shipped runtime in
 * runtime-meta-emit-gate-s458.test.js. Both phases call the same shared judge
 * (markup-attr-allow-list.js) and the same §5.2 URL reader (runtime-url-guard.js).
 *
 *   F1 — `for` on `<label>` is refused (a label click is a click on the page's `#id`); `<output for>`
 *        is admitted.
 *   F2 — the id/name belt is scoped to elements that create NAMED PROPERTIES of `document` or a form;
 *        a plain element takes any id / name.
 *   F4 — URL values in emit() output are judged by the runtime's §5.2 reader.
 *   F5 — `<meta name>` values are not judged (meta creates no named property).
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join, resolve } from "path";
import { compileScrml } from "../../src/api.js";
import { _SCRML_EMIT_DOCUMENT_MEMBERS, _SCRML_EMIT_FORM_MEMBERS } from "../../src/dom-named-property-members.js";
import { _scrml_emit_named_value_verdict, _SCRML_EMIT_NS_HTML, _SCRML_EMIT_NS_SVG } from "../../src/markup-attr-allow-list.js";

const FIXTURE_DIR = join(import.meta.dir, "__fixtures__/meta-emit-round4-s459");
beforeAll(() => { mkdirSync(FIXTURE_DIR, { recursive: true }); });
afterAll(() => { rmSync(FIXTURE_DIR, { recursive: true, force: true }); });

let seq = 0;
function compile(source) {
  const filePath = resolve(join(FIXTURE_DIR, `case-${++seq}.scrml`));
  writeFileSync(filePath, source);
  const result = compileScrml({ inputFiles: [filePath], outputDir: join(FIXTURE_DIR, "dist"), write: false, log: () => {} });
  const errors = (result.errors ?? []).filter((e) => e.severity !== "warning" && e.severity !== "info");
  const out = [...(result.outputs?.values?.() ?? [])];
  return {
    codes: errors.map((e) => e.code),
    messages: errors.map((e) => e.message),
    html: out.map((o) => o.html ?? "").join("\n"),
  };
}
const emitOf = (markup) => `<program>\n^{ emit(${JSON.stringify(markup)}) }\n</program>\n`;

const REFUSED = [
  // F1
  ["label for=", '<label for="danger">x</label>', "for="],
  // F2 — named properties of document. (The form half is not a compile-time rule since S460 "n4 b":
  // those shapes are in ADMITTED below and stay refused at run time — meta-emit-nits-s460.test.js.)
  ["object id= a document member", '<object id="title"></object>', "member of document"],
  ["img name= a document member", '<img name="querySelector" src="/a.png" alt="a">', "name="],
  ["id in the reserved _scrml namespace (any element)", '<div id="_scrml_x">x</div>', "_scrml"],
  // F4 — the runtime's URL judge
  ["href javascript:", '<a href="javascript:alert(1)">x</a>', "href= URL"],
  ["href with a leading space", '<a href=" javascript:alert(1)">x</a>', "href= URL"],
  ["href java<LF>script:", '<a href="java\nscript:alert(1)">x</a>', "href= URL"],
  ["svg xlink:href javascript:", '<svg><a xlink:href="javascript:alert(1)"><text>x</text></a></svg>', "xlink:href= URL"],
  ["mathml href javascript:", '<math><mi href="javascript:alert(1)">x</mi></math>', "href= URL"],
  ["video poster javascript:", '<video poster="javascript:alert(1)"></video>', "poster= URL"],
  ["srcset javascript: candidate", '<img srcset="/a.png 1x, javascript:alert(1) 2x" alt="a">', "srcset= URL"],
  ["srcset svg data: candidate", '<img srcset="data:image/svg+xml,x 1x" alt="a">', "srcset= URL"],
  ["img src data:text/html", '<img src="data:text/html,x" alt="a">', "src= URL"],
];

describe("S459 round 4 — refused in compile-time emit() output (E-META-EVAL-002)", () => {
  for (const [label, markup, fragment] of REFUSED) {
    test(label, () => {
      const r = compile(emitOf(markup));
      expect(r.codes).toContain("E-META-EVAL-002");
      expect(r.messages.some((m) => m.includes(fragment))).toBe(true);
    });
  }
});

const ADMITTED = [
  ["a label without for", "<label>Name</label>"],
  ["output for", '<output for="a b">1</output>'],
  ["h2 id=title (a plain element takes any id)", '<h2 id="title">T</h2>'],
  ["div id=hidden / section id=focus / p id=constructor", '<div id="hidden">a</div><section id="focus">b</section><p id="constructor">c</p>'],
  ["input name=name outside a form", '<input name="name">'],
  ["img id=title outside a form", '<img id="title" src="/a.png" alt="a">'],
  // S460 "n4 b" — compile-time emit() output is the author's markup: form-member field names are admitted.
  ["input name=action inside an emitted form", '<form><input name="action"></form>'],
  ["a contact form: name / email / title / submit", '<form><label>N <input name="name"></label><input name="email" type="email"><input name="title"><button id="submit">b</button></form>'],
  ["img id=elements inside an emitted form", '<form><img id="elements" src="/a.png" alt="a"></form>'],
  ["custom element id=method inside an emitted form", '<form><x-field id="method"></x-field></form>'],
  ["a form member name inside a <template> in an emitted form", '<form><template><input name="action"></template></form>'],
  ["a form with ordinary control names",'<form><input name="q" id="q"><select name="s"><option value="1">1</option></select><button type="submit" name="go">go</button></form>'],
  ["meta name=Description / DC.title / msapplication-TileColor", '<meta name="Description" content="x"/><meta name="DC.title" content="x"/><meta name="msapplication-TileColor" content="#000"/>'],
  ["https / relative / mailto / fragment hrefs", '<a href="https://e.com/">a</a><a href="/r">b</a><a href="mailto:a@b.c">c</a><a href="#t">d</a>'],
  ["srcset of http(s) / relative candidates", '<img srcset="/a.png 1x, https://e.com/b.png 2x" alt="a">'],
  ["raster data: image src", '<img src="data:image/png;base64,AAAA" alt="a">'],
  ["an entity in a URL is text here (the compiler escapes &): relative", '<a href="&#106;avascript:x">x</a>'],
];

describe("S459 round 4 — admitted in compile-time emit() output", () => {
  for (const [label, markup] of ADMITTED) {
    test(label, () => {
      const r = compile(emitOf(markup));
      expect(r.codes).toEqual([]);
    });
  }

  test("the admitted markup reaches the HTML", () => {
    const r = compile(emitOf('<h2 id="title">T</h2><meta name="Description" content="x"/>'));
    expect(r.html).toContain('<h2 id="title">T</h2>');
    expect(r.html).toContain('name="Description"');
  });
});

describe("S459 round 4 — the shared named-property judge", () => {
  const M = { document: _SCRML_EMIT_DOCUMENT_MEMBERS, form: _SCRML_EMIT_FORM_MEMBERS };
  const H = _SCRML_EMIT_NS_HTML;
  test("generated tables carry the members the review named", () => {
    for (const n of ["querySelector", "implementation", "body", "title", "__proto__", "constructor"]) {
      expect(_SCRML_EMIT_DOCUMENT_MEMBERS.has(n)).toBe(true);
    }
    for (const n of ["action", "elements", "lastChild", "attributes", "name", "submit", "__proto__"]) {
      expect(_SCRML_EMIT_FORM_MEMBERS.has(n)).toBe(true);
    }
  });
  test("document named properties: name on embed/form/iframe/img/object; id on object; id on img only with a name", () => {
    for (const t of ["embed", "form", "iframe", "img", "object"]) {
      expect(_scrml_emit_named_value_verdict(H, t, "name", "body", false, false, false, M)).not.toBe("");
    }
    expect(_scrml_emit_named_value_verdict(H, "object", "id", "body", false, false, false, M)).not.toBe("");
    expect(_scrml_emit_named_value_verdict(H, "img", "id", "body", false, false, false, M)).toBe("");
    expect(_scrml_emit_named_value_verdict(H, "img", "id", "body", true, false, false, M)).not.toBe("");
    expect(_scrml_emit_named_value_verdict(H, "img", "name", "photo", false, false, false, M)).toBe("");
  });
  test("form named properties need a form; plain elements and foreign content never", () => {
    expect(_scrml_emit_named_value_verdict(H, "input", "name", "action", false, false, false, M)).toBe("");
    expect(_scrml_emit_named_value_verdict(H, "input", "name", "action", true, true, false, M)).not.toBe("");
    expect(_scrml_emit_named_value_verdict(H, "div", "id", "action", false, true, false, M)).toBe("");
    expect(_scrml_emit_named_value_verdict(H, "my-el", "id", "action", false, true, true, M)).not.toBe("");
    expect(_scrml_emit_named_value_verdict(_SCRML_EMIT_NS_SVG, "a", "id", "action", false, true, false, M)).toBe("");
  });
  test("S460: a phase that carries no table judges that half fail-closed", () => {
    // run time: document: null — every document-named-property shape is refused, any value
    const RT = { document: null, form: _SCRML_EMIT_FORM_MEMBERS };
    expect(_scrml_emit_named_value_verdict(H, "img", "name", "photo", false, false, false, RT)).not.toBe("");
    expect(_scrml_emit_named_value_verdict(H, "object", "id", "anything", false, false, false, RT)).not.toBe("");
    // ... and every other shape is judged exactly as with the table
    expect(_scrml_emit_named_value_verdict(H, "img", "id", "photo", false, false, false, RT)).toBe("");
    expect(_scrml_emit_named_value_verdict(H, "div", "id", "body", false, false, false, RT)).toBe("");
    expect(_scrml_emit_named_value_verdict(H, "input", "name", "action", false, true, false, RT)).not.toBe("");
    expect(_scrml_emit_named_value_verdict(H, "input", "name", "q", false, true, false, RT)).toBe("");
    // compile time: form: null, inForm always false — the form half is never asked
    const CT = { document: _SCRML_EMIT_DOCUMENT_MEMBERS, form: null };
    expect(_scrml_emit_named_value_verdict(H, "input", "name", "action", false, false, false, CT)).toBe("");
    expect(_scrml_emit_named_value_verdict(H, "img", "name", "body", false, false, false, CT)).not.toBe("");
  });
  test("a live prototype extends the table (run time)", () => {
    const proto = { onlyInThisBrowser: 1 };
    expect(_scrml_emit_named_value_verdict(H, "input", "name", "onlyInThisBrowser", false, true, false, M)).toBe("");
    expect(_scrml_emit_named_value_verdict(H, "input", "name", "onlyInThisBrowser", false, true, false,
      { ...M, formProto: proto })).not.toBe("");
  });
});
