/**
 * meta-emit-reserved-attr-s459.test.js — SPEC §22.4.1 / §22.12, ruling S458 "your recs on all
 * four" item 3: the `data-scrml-` attribute namespace is compiler-owned (runtime markers
 * `data-scrml-meta`, `-outlet`, `-each-mount`, `-gated`, …). A `data-scrml-*` attribute in
 * compile-time `emit()` output is refused with E-META-EVAL-002 by the same reader that judges the
 * rest of emit() output (meta-eval.ts `checkEmittedNodes`). The runtime `meta.emit` half is pinned
 * in runtime-meta-emit-gate-s458.test.js (executes the shipped runtime).
 *
 * The rule is a PREFIX over attribute names as the HTML tokenizer reads them: ASCII case folded,
 * character references in a name NOT decoded.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join, resolve } from "path";
import { compileScrml } from "../../src/api.js";

const FIXTURE_DIR = join(import.meta.dir, "__fixtures__/meta-emit-reserved-attr-s459");
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

describe("S458 item 3 — data-scrml-* in compile-time emit() output is E-META-EVAL-002", () => {
  const REFUSED = [
    ["a data-scrml-* attribute", '<p data-scrml-meta="m">p</p>', "data-scrml-meta"],
    ["upper case", '<p DATA-SCRML-OUTLET="m">p</p>', "DATA-SCRML-OUTLET"],
    ["mixed case", '<p Data-Scrml-Gated="m">p</p>', "Data-Scrml-Gated"],
    ["no value", "<p data-scrml-gated>p</p>", "data-scrml-gated"],
    ["self-closing, no value", "<p data-scrml-z/>", "data-scrml-z"],
    ["after a /", '<p/data-scrml-each-mount="m">p</p>', "data-scrml-each-mount"],
    ["nested element", '<ul><li><b data-scrml-x="1">b</b></li></ul>', "data-scrml-x"],
    ["on svg", '<svg><rect data-scrml-x="1"></rect></svg>', "data-scrml-x"],
    // PA-ruled S459 consequence: bare `data-scrml` is the component CSS scope root.
    ["bare data-scrml (component scope root)", '<div data-scrml="Card"><p>x</p></div>', "data-scrml"],
    ["bare DATA-SCRML, no value", "<div DATA-SCRML>x</div>", "DATA-SCRML"],
  ];
  for (const [label, markup, name] of REFUSED) {
    test(`refused: ${label}`, () => {
      const r = compile(emitOf(markup));
      expect(r.codes).toContain("E-META-EVAL-002");
      const m = r.messages.find((x) => x.includes("`data-scrml` attribute namespace"));
      expect(m).toBeDefined();
      expect(m).toContain(`'${name}'`);
    });
  }

  test("an unquoted data-scrml-* value is refused for its NAME (one diagnostic, the reserved-name one)", () => {
    const r = compile(emitOf("<p data-scrml-x=y>p</p>"));
    expect(r.codes).toContain("E-META-EVAL-002");
    expect(r.messages.filter((m) => m.includes("E-META-EVAL-002")).length).toBe(1);
    expect(r.messages[0]).toContain("reserved");
  });
});

describe("S458 item 3 — ordinary data-* attributes still pass", () => {
  test("data-x / data-scrmlx / aria-label compile clean and reach the HTML", () => {
    const r = compile(emitOf('<p data-x="1" data-scrmlx="3" aria-label="4">ok</p>'));
    expect(r.codes).toEqual([]);
    expect(r.html).toContain('data-x="1"');
    expect(r.html).toContain('data-scrmlx="3"');
    expect(r.html).toContain('aria-label="4"');
  });

  test("a compiler marker in the SAME page is not the author's (the runtime-meta placeholder is unaffected)", () => {
    const r = compile("<program>\n<x> = 0\n<div>\n^{\n  meta.get(\"x\")\n  meta.emit(\"<p data-k=\\\"v\\\">r</p>\")\n}\n</div>\n</program>\n");
    expect(r.codes).toEqual([]);
    expect(r.html).toContain("data-scrml-meta=");
  });
});

describe("PA-ruled S459: meta descriptive attrs; http-equiv refused", () => {
  test("<meta name content> / charset / property / media compile clean (the corpus sample's shape)", () => {
    const r = compile(emitOf('<meta name="robots" content="index, follow"/><meta charset="utf-8"/>' +
      '<meta property="og:title" content="T"/><meta name="theme-color" media="(prefers-color-scheme: dark)" content="#000"/>'));
    expect(r.codes).toEqual([]);
    expect(r.html).toContain('name="robots"');
    expect(r.html).toContain('property="og:title"');
  });

  test("http-equiv is refused outright (meta refresh is a navigation sink)", () => {
    const r = compile(emitOf('<meta http-equiv="refresh" content="0;url=https://x"/>'));
    expect(r.codes).toContain("E-META-EVAL-002");
    expect(r.messages.some((m) => m.includes("http-equiv="))).toBe(true);
  });

  test("content is scoped to <meta> — on any other element it is not on the list", () => {
    const r = compile(emitOf('<p content="x">p</p>'));
    expect(r.codes).toContain("E-META-EVAL-002");
  });

  // S459 round 4 F5: `<meta>` creates no named property, so its `name` value shadows nothing — the
  // round-3 lowercase-token rule (which refused `Description`, `DC.title`) is dropped.
  test("<meta name> values are not judged: any spelling compiles clean", () => {
    for (const v of ["twitter:card", "Description", "DC.title", "msapplication-TileColor", "querySelector"]) {
      expect(compile(emitOf(`<meta name="${v}" content="x"/>`)).codes).toEqual([]);
    }
  });
});
