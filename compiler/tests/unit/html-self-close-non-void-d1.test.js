/**
 * html-self-close-non-void-d1.test.js — S442 D1 (dpa-058 §3 D1, HIGH).
 *
 * A scrml source self-close (`<textarea/>`, `<div/>`) means "no children"
 * (§4.14 body forms). The browser's HTML parser, however, IGNORES a trailing
 * `/` on a non-void HTML-namespace element (HTML Living Standard parse error
 * `non-void-html-element-start-tag-with-trailing-solidus`: "The parser behaves
 * as if the U+002F (/) is not present"). Pre-fix, emit-html wrote
 * `<textarea … />`, and the textarea (an escapable raw text element) swallowed
 * the rest of the document as text — measured in Chromium: a form with a
 * textarea + select + 4 inputs parsed as `selects: 0, inputs: 0`.
 *
 * The fix (compiler/src/codegen/emit-html.ts + utils.ts:htmlParserHonorsSelfClose)
 * emits `/>` only where the parser honours it: HTML void elements, and
 * svg/math foreign content. Everything else gets an explicit end tag.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Window } from "happy-dom";
import { htmlParserHonorsSelfClose } from "../../src/codegen/utils.ts";

const FIXTURE_DIR = join(import.meta.dir, "__fixtures__/html-self-close-d1");

beforeAll(() => {
  if (!existsSync(FIXTURE_DIR)) mkdirSync(FIXTURE_DIR, { recursive: true });
});

afterAll(() => {
  if (existsSync(FIXTURE_DIR)) rmSync(FIXTURE_DIR, { recursive: true, force: true });
});

function compileHtml(name, src) {
  const inputPath = join(FIXTURE_DIR, name);
  writeFileSync(inputPath, src);
  const outDir = join(FIXTURE_DIR, "dist-" + name.replace(/\W/g, "_"));
  const result = compileScrml({ inputFiles: [inputPath], outputDir: outDir, write: true, log: () => {} });
  let html = "";
  for (const ent of readdirSync(outDir, { withFileTypes: true })) {
    if (ent.isFile() && ent.name.endsWith(".html")) html = readFileSync(join(outDir, ent.name), "utf-8");
  }
  const fatal = (result?.errors ?? []).filter((e) => e && e.severity !== "warning" && e.severity !== "info");
  return { html, fatal };
}

function mainOf(html) {
  const m = html.match(/<main>[\s\S]*?<\/main>/);
  return m ? m[0] : "";
}

const SELF_CLOSED_TEXTAREA = /<textarea[^>]*\/>/;

describe("S442 D1 — self-closed non-void HTML elements get an explicit end tag", () => {
  test("dPA reproducer: <textarea bind:value=@x/> followed by <p> is closed, <p> stays a sibling", () => {
    const { html } = compileHtml(
      "repro.scrml",
      `<program>\n\${ @x = "" }\n<main><textarea bind:value=@x/><p>after</p></main>\n</program>\n`,
    );
    const main = mainOf(html);
    expect(main).not.toMatch(SELF_CLOSED_TEXTAREA);
    expect(main).toMatch(/<textarea data-scrml-bind-value="[^"]+"><\/textarea><p>after<\/p>/);
  });

  test("Shape-2 render-by-tag `<bio> = <textarea/>` expands to a closed textarea", () => {
    const { html } = compileHtml(
      "shape2.scrml",
      `<program>\${ <bio req length(>=10)> = <textarea/> }<main><div><bio/></div><p>after</p></main></program>\n`,
    );
    const main = mainOf(html);
    expect((main.match(/<textarea/g) ?? []).length).toBe(1);
    expect(main).not.toMatch(SELF_CLOSED_TEXTAREA);
    expect(main).toMatch(/<textarea[^>]*><\/textarea><\/div><p>after<\/p>/);
  });

  test("Shape-2 render-by-tag inside a compound `<f><draft req> = <textarea/></>`", () => {
    const { html } = compileHtml(
      "shape2-compound.scrml",
      `<program>\${ <f><draft req> = <textarea/></> }<main><f><draft/></f><p>after</p></main></program>\n`,
    );
    const main = mainOf(html);
    expect(main).toContain("<textarea");
    expect(main).not.toMatch(SELF_CLOSED_TEXTAREA);
    expect(main).toMatch(/<\/textarea>/);
  });

  test("void elements stay void (`<input/>`, `<br/>`, `<hr/>`, `<img/>`) — no end tag", () => {
    const { html } = compileHtml(
      "void.scrml",
      `<program>\n<main><input name="a"/><br/><hr/><img src="x.png" alt="x"/><p>after</p></main>\n</program>\n`,
    );
    const main = mainOf(html);
    expect(main).toContain(`<input name="a" />`);
    expect(main).toContain(`<br />`);
    expect(main).toContain(`<hr />`);
    expect(main).toMatch(/<img [^>]*\/>/);
    expect(main).not.toMatch(/<\/(input|br|hr|img)>/);
  });

  test("`<div/>`, `<span/>`, `<title/>` and an unknown element get an explicit end tag", () => {
    const { html } = compileHtml(
      "nonvoid.scrml",
      `<program>\n<main><div/><span class="a"/><title/><my-widget/><p>after</p></main>\n</program>\n`,
    );
    const main = mainOf(html);
    expect(main).toContain(`<div></div>`);
    expect(main).toContain(`<span class="a"></span>`);
    expect(main).toContain(`<title></title>`);
    expect(main).toContain(`<my-widget></my-widget>`);
    expect(main).not.toMatch(/<(div|span|title|my-widget)\b[^>]*\/>/);
  });

  test("foreign content keeps `/>` (svg children, <svg/> itself); foreignObject children are HTML again", () => {
    const { html } = compileHtml(
      "svg.scrml",
      `<program>\n<main><svg viewBox="0 0 10 10"><path d="M0 0L10 10"/><circle r="2"/><foreignObject><div/></foreignObject></svg><svg/><p>after</p></main>\n</program>\n`,
    );
    const main = mainOf(html);
    expect(main).toContain(`<path d="M0 0L10 10" />`);
    expect(main).toContain(`<circle r="2" />`);
    expect(main).toContain(`<foreignObject><div></div></foreignObject>`);
    expect(main).toContain(`<svg />`);
  });

  test("parsed by an HTML parser, the elements after a self-closed <div> remain siblings", () => {
    const { html } = compileHtml(
      "parsed.scrml",
      `<program>\n\${ @x = "" }\n<main><form><textarea bind:value=@x/><select><option value="a">a</option></select><input name="i1"/><input name="i2"/></form><div/><p id="after">after</p></main>\n</program>\n`,
    );
    const win = new Window();
    // A non-global happy-dom Window can come up WITHOUT `SyntaxError` (GlobalWindow
    // and the VM path copy it in; seen locally on bun 1.3.14, S443). Inserting a
    // <select> runs querySelectorAll("option"), which builds `new window.SyntaxError`
    // eagerly, so the parse dies with "undefined is not a constructor" before any
    // assertion. The assertions are about parse structure, not happy-dom's errors.
    if (win.SyntaxError === undefined) win.SyntaxError = SyntaxError;
    const doc = win.document;
    doc.body.innerHTML = mainOf(html);
    expect(doc.querySelectorAll("select").length).toBe(1);
    expect(doc.querySelectorAll("input").length).toBe(2);
    expect(doc.getElementById("after")?.parentElement?.tagName).toBe("MAIN");
    expect(doc.querySelector("textarea")?.value).toBe("");
  });
});

describe("htmlParserHonorsSelfClose — the classifier", () => {
  test("the 13 HTML void elements (+ parser-void `param`) are honoured anywhere", () => {
    for (const t of ["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr", "param"]) {
      expect(htmlParserHonorsSelfClose(t, [])).toBe(true);
    }
  });

  test("raw-text / escapable-raw-text and ordinary non-void elements are NOT honoured in HTML", () => {
    for (const t of ["textarea", "title", "script", "style", "div", "span", "p", "select", "form", "my-widget", "Card"]) {
      expect(htmlParserHonorsSelfClose(t, ["main", "div"])).toBe(false);
    }
  });

  test("svg/math roots and their descendants are honoured; HTML integration points reset", () => {
    expect(htmlParserHonorsSelfClose("svg", ["main"])).toBe(true);
    expect(htmlParserHonorsSelfClose("math", [])).toBe(true);
    expect(htmlParserHonorsSelfClose("path", ["main", "svg", "g"])).toBe(true);
    expect(htmlParserHonorsSelfClose("foreignObject", ["svg"])).toBe(true);
    expect(htmlParserHonorsSelfClose("div", ["svg", "foreignObject"])).toBe(false);
    expect(htmlParserHonorsSelfClose("span", ["math", "mtext"])).toBe(false);
    expect(htmlParserHonorsSelfClose("mi", ["math", "mrow"])).toBe(true);
  });
});
