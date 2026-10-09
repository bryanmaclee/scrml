/**
 * meta-emit-nits-s460.test.js — SPEC §22.4.1 / §22.12, the S460 differential review of meta.emit
 * round 4. Compile-time `emit()` output (compileScrml) and runtime `meta.emit` output (the shipped
 * runtime text, executed in happy-dom). Both phases call the same shared judge
 * (markup-attr-allow-list.js).
 *
 *   N1 — reference by name: `usemap` on `<img>`, `name` and `id` on `<map>` are refused (an
 *        `<img usemap="#m">` resolves against every page `<map>` by name or id).
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Window } from "happy-dom";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join, resolve } from "path";
import { compileScrml } from "../../src/api.js";
import { SCRML_RUNTIME } from "../../src/runtime-template.js";

const FIXTURE_DIR = join(import.meta.dir, "__fixtures__/meta-emit-nits-s460");
beforeAll(() => { mkdirSync(FIXTURE_DIR, { recursive: true }); });
afterAll(() => { rmSync(FIXTURE_DIR, { recursive: true, force: true }); });

let seq = 0;
function compile(source) {
  const filePath = resolve(join(FIXTURE_DIR, `case-${++seq}.scrml`));
  writeFileSync(filePath, source);
  const result = compileScrml({ inputFiles: [filePath], outputDir: join(FIXTURE_DIR, "dist"), write: false, log: () => {} });
  const errors = (result.errors ?? []).filter((e) => e.severity !== "warning" && e.severity !== "info");
  return { codes: errors.map((e) => e.code), messages: errors.map((e) => e.message) };
}
const emitOf = (markup) => `<program>\n^{ emit(${JSON.stringify(markup)}) }\n</program>\n`;

/** A page with the meta placeholder at `slotHtml` (default: in the body, outside any form). */
function makePage(bodyHtml = '<span data-scrml-meta="m1">old</span>') {
  const win = new Window({ url: "http://localhost/" });
  const document = win.document;
  document.body.innerHTML = bodyHtml;
  const logs = [];
  const cons = { error: (...a) => logs.push(a.map(String).join(" ")), log() {}, warn() {}, info() {} };
  // eslint-disable-next-line no-new-func
  const rt = new Function("document", "window", "console",
    SCRML_RUNTIME + "\nreturn { _scrml_meta_emit };")(document, win, cons);
  const slot = () => document.querySelector('[data-scrml-meta="m1"]');
  return { win, document, rt, logs, slot };
}
const PAGE_FORM = '<form id="pf"><div><span data-scrml-meta="m1">old</span></div></form>';

const N1_REFUSED = [
  ["img usemap (resolves against a page map)", '<img usemap="#m" src="/a.png" alt="a">', "usemap="],
  ["map name (captures a page img usemap)", '<map name="pm"><area shape="rect" coords="0,0,1,1" href="/x" alt="a"></map>', "name="],
  ["map id (a map is found by id as well)", '<map id="pm"><area shape="rect" coords="0,0,1,1" href="/x" alt="a"></map>', "id="],
  ["USEMAP upper case", '<img USEMAP="#m" src="/a.png" alt="a">', "usemap="],
];
const N1_ADMITTED = [
  ["img without usemap", '<img src="/a.png" alt="a">'],
  ["a map with neither name nor id", '<map><area shape="rect" coords="0,0,1,1" href="/x" alt="a"></map>'],
  ["id on other elements stays global", '<p id="pm">p</p>'],
];

describe("S460 N1 — compile-time emit(): reference by name is refused", () => {
  for (const [label, markup, fragment] of N1_REFUSED) {
    test(`refused: ${label}`, () => {
      const r = compile(emitOf(markup));
      expect(r.codes).toContain("E-META-EVAL-002");
      expect(r.messages.some((m) => m.includes(fragment))).toBe(true);
    });
  }
  for (const [label, markup] of N1_ADMITTED) {
    test(`admitted: ${label}`, () => {
      expect(compile(emitOf(markup)).codes).toEqual([]);
    });
  }
});

describe("S460 N1 — runtime meta.emit: reference by name is refused", () => {
  for (const [label, html, fragment] of N1_REFUSED) {
    test(`refused: ${label}`, () => {
      const { rt, logs, slot } = makePage();
      rt._scrml_meta_emit("m1", html);
      expect(slot().innerHTML).toBe("old");
      expect(logs.length).toBe(1);
      expect(logs[0]).toContain(fragment);
      expect(logs[0]).not.toContain("#m");
      expect(logs[0]).not.toContain('"pm"');
    });
  }
  test("an emitted map name does not take over the page image's map", () => {
    const { rt, document } = makePage('<img usemap="#pm" src="/a.png" alt="p"><span data-scrml-meta="m1">old</span>');
    rt._scrml_meta_emit("m1", '<map name="pm"><area shape="rect" coords="0,0,9,9" href="/evil" alt="e"></map>');
    expect(document.querySelectorAll("map").length).toBe(0);
  });
  for (const [label, html] of N1_ADMITTED) {
    test(`admitted: ${label}`, () => {
      const { rt, logs, slot } = makePage();
      rt._scrml_meta_emit("m1", html);
      expect(logs).toEqual([]);
      expect(slot().innerHTML).not.toBe("old");
    });
  }
});

// N4 (ruling S460 "n4 b") — the compile-time form-member rule is dropped; the runtime keeps it.
const N4_FORMS = [
  ["contact form: name + email", '<form><input name="name"><input name="email" type="email"></form>'],
  ["field named title", '<form><input name="title"></form>'],
  ["field named action", '<form><input name="action"></form>'],
  ["button id=submit", '<form><button id="submit">b</button></form>'],
  ["field named lang inside a label", '<form><label>L <input name="lang"></label></form>'],
];
describe("S460 N4 — form-member field names: admitted at compile time, refused at run time", () => {
  for (const [label, markup] of N4_FORMS) {
    test(`compile time admits: ${label}`, () => {
      expect(compile(emitOf(markup)).codes).toEqual([]);
    });
    test(`run time refuses: ${label}`, () => {
      const { rt, logs, slot } = makePage();
      rt._scrml_meta_emit("m1", markup);
      expect(slot().innerHTML).toBe("old");
      expect(logs.length).toBe(1);
      expect(logs[0]).toContain("inside a form that names a member of the form");
    });
  }
  test("the document half still holds at compile time", () => {
    const r = compile(emitOf('<object id="body"></object>'));
    expect(r.codes).toContain("E-META-EVAL-002");
  });
});

// N5 — inert template content joins no form: the page-form rule does not apply inside it; every other
// rule does.
describe("S460 N5 — template content inside a page form", () => {
  const ADMITTED_IN_PAGE_FORM = [
    ["an input inside a template", '<template><input name="q"></template>'],
    ["a submit button inside a template", '<template><button type="submit">go</button></template>'],
    ["an img id naming a form member inside a template", '<template><img id="action" src="/a.png" alt="a"></template>'],
    ["a nested template", '<template><div><template><input name="q"></template></div></template>'],
  ];
  for (const [label, html] of ADMITTED_IN_PAGE_FORM) {
    test(`admitted: ${label}`, () => {
      const { rt, logs, slot, document } = makePage(PAGE_FORM);
      rt._scrml_meta_emit("m1", html);
      expect(logs).toEqual([]);
      expect(slot().innerHTML).toBe(html);
      // nothing joined the page form
      expect(document.getElementById("pf").elements.length).toBe(0);
    });
  }
  const STILL_REFUSED = [
    ["an event handler inside a template", '<template><img src=x onerror="window.__pwn=1"></template>', "onerror"],
    ["a javascript: URL inside a template", '<template><a href="javascript:window.__pwn=1">x</a></template>', "href= URL"],
    ["a control beside a template", '<template><p>t</p></template><input name="q">', "inside a page <form>"],
    ["a control in a template's sibling subtree", '<div><template></template><b><input name="q"></b></div>', "inside a page <form>"],
  ];
  for (const [label, html, fragment] of STILL_REFUSED) {
    test(`still refused: ${label}`, () => {
      const { rt, logs, slot } = makePage(PAGE_FORM);
      rt._scrml_meta_emit("m1", html);
      expect(slot().innerHTML).toBe("old");
      expect(logs.length).toBe(1);
      expect(logs[0]).toContain(fragment);
    });
  }
  test("outside a page form: a form-member name inside a template in an emitted form is admitted (inert)", () => {
    const { rt, logs, slot } = makePage();
    rt._scrml_meta_emit("m1", '<form><template><input name="action"></template></form>');
    expect(logs).toEqual([]);
    expect(slot().innerHTML).toBe('<form><template><input name="action"></template></form>');
  });
  test("compile time: the same template markup compiles clean", () => {
    expect(compile(emitOf('<template><input name="q"></template>')).codes).toEqual([]);
    expect(compile(emitOf('<form><template><input name="action"></template></form>')).codes).toEqual([]);
  });
});

// N2(a) — a form-less radio joins the page's form-less radio group of that name: refused at run time.
describe("S460 N2a — runtime meta.emit refuses a named radio outside any form", () => {
  const REFUSED_RADIO = [
    ["a named radio", '<input type="radio" name="plan" value="evil" checked>'],
    ["type in upper case", '<input type="RADIO" name="plan">'],
    ["nested in admitted markup", '<p><label>x <input type=radio name=plan></label></p>'],
    ["foster-parented out of an emitted form", '<table><form><input type="radio" name="plan"></form></table>'],
  ];
  for (const [label, html] of REFUSED_RADIO) {
    test(`refused: ${label}`, () => {
      const { rt, logs, slot } = makePage('<input type="radio" name="plan" id="pa" checked><span data-scrml-meta="m1">old</span>');
      rt._scrml_meta_emit("m1", html);
      expect(slot().innerHTML).toBe("old");
      expect(logs.length).toBe(1);
      expect(logs[0]).toContain("input type=radio");
      expect(logs[0]).not.toContain("plan");
    });
  }
  const ADMITTED_RADIO = [
    ["a radio group inside an emitted form", '<form><input type="radio" name="plan" value="a"><input type="radio" name="plan" value="b"></form>'],
    ["a radio with no name", '<input type="radio" value="a">'],
    ["a radio with an empty name", '<input type="radio" name="" value="a">'],
    ["a named checkbox (no group)", '<input type="checkbox" name="plan">'],
    ["a radio inside a template", '<template><input type="radio" name="plan"></template>'],
  ];
  for (const [label, html] of ADMITTED_RADIO) {
    test(`admitted: ${label}`, () => {
      const { rt, logs, document } = makePage('<input type="radio" name="plan" id="pa" checked><span data-scrml-meta="m1">old</span>');
      rt._scrml_meta_emit("m1", html);
      expect(logs).toEqual([]);
      expect(document.getElementById("pa").checked).toBe(true);
    });
  }
  test("compile time does not apply the radio rule (author markup; the source form around the ^{} is unknown)", () => {
    expect(compile(emitOf('<input type="radio" name="plan" value="a">')).codes).toEqual([]);
  });
});

// N6 — the runtime chunk carries the form member table only.
describe("S460 N6 — the runtime ships no document member table", () => {
  test("SCRML_RUNTIME carries _SCRML_EMIT_FORM_MEMBERS, not _SCRML_EMIT_DOCUMENT_MEMBERS / documentProto", () => {
    expect(SCRML_RUNTIME).toContain("const _SCRML_EMIT_FORM_MEMBERS = new Set([");
    expect(SCRML_RUNTIME).not.toContain("_SCRML_EMIT_DOCUMENT_MEMBERS");
    expect(SCRML_RUNTIME).not.toContain("documentProto");
  });
  test("document-named-property shapes are still refused at run time (by the name judge / element rule)", () => {
    const shapes = ['<img name="querySelector" src="/a.png" alt="a">', '<img id="body" name="x" src="/a.png" alt="a">',
      '<form name="cookie"></form>', '<object id="body"></object>', '<iframe name="x"></iframe>', '<embed name="x">'];
    for (const html of shapes) {
      const { rt, logs, slot } = makePage();
      rt._scrml_meta_emit("m1", html);
      expect(slot().innerHTML).toBe("old");
      expect(logs.length).toBe(1);
    }
  });
});
