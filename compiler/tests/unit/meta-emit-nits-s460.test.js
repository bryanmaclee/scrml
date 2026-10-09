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
