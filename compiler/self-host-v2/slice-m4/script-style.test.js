// script-style.test.js — s462-bootstrap-script-style-refusal: the bootstrap
// refuses `<script>` and `<style>` elements, as impl#1 does.
//
// The defect this closes (HIGH, Chromium-reproduced S462): the bootstrap
// compiled `<script>${@code}</script>` (data ran as JavaScript), `<script
// src=@u>` / SVG `<script href=@u>` (a data-chosen script loaded) and
// `<style>${@css}</style>` (CSS injection) with no diagnostic.
//
// Governing text, SPEC §4.17 (companion considerations): "`<script>` and
// `<style>` are NOT raw-content in scrml because scrml does not admit those
// elements at all. Both are rejected symmetrically at the block-splitter
// level: `<style>` triggers `E-STYLE-001` (CSS lives in `#{...}`), and
// `<script>` triggers `E-SCRIPT-001` … Each rejection recovers by scanning
// past the matching close tag (case-insensitive) or to EOF, so the rejected
// body does not cascade into unrelated parse errors. The match on the tag name
// is exact, not a prefix — `<noscript>` is an ordinary element and is
// unaffected."
//
// impl#1 locus mirrored: compiler/src/block-splitter.js, the markup-opener
// path (`tagName.toLowerCase() === "style"` / `=== "script"`).

import { describe, test, expect, beforeAll } from "bun:test";
import { loadM2, frontEnd } from "./harness.js";

let mods;
beforeAll(() => { ({ mods } = loadM2()); }, { timeout: 120000 });

const run = (src) => frontEnd(mods, [{ path: "c.scrml", src }]);
const codes = (src) => run(src).diags.map((d) => d.code);
const program = (body) => `<program>\n${body}\n</program>\n`;

describe("§4.17 — the gap's reproductions are refused", () => {
  test("`<script>${@code}</script>` is E-SCRIPT-001, nothing else", () => {
    expect(codes(program(`    let <code:string="window.pwned='SCRIPT'"/>\n    <script id="sc">\${@code}</script>`))).toEqual(["E-SCRIPT-001"]);
  });
  test("the SVG-namespace script `<svg><script>…</script></svg>` is a script", () => {
    expect(codes(program(`    let <code:string="x"/>\n    <svg><script>\${@code}</script></svg>`))).toEqual(["E-SCRIPT-001"]);
  });
  test("`<script src=@u>` and SVG `<script href=@u>`", () => {
    expect(codes(program(`    let <u:string="/evil.js"/>\n    <script src=@u></script>`))).toEqual(["E-SCRIPT-001"]);
    expect(codes(program(`    let <u:string="/evil.js"/>\n    <svg><script href=@u></script></svg>`))).toEqual(["E-SCRIPT-001"]);
  });
  test("`<style>${@css}</style>` is E-STYLE-001", () => {
    expect(codes(program(`    let <css:string="x"/>\n    <style>\${@css}</style>`))).toEqual(["E-STYLE-001"]);
  });
  test("a plain `<style>` block (well-formed CSS) is refused on the element, not the body", () => {
    expect(codes(program(`    <style>\n        .btn { color: red; }\n    </style>\n    <button class="btn">Go</button>`))).toEqual(["E-STYLE-001"]);
  });
  test("the diagnostics are Errors (§34)", () => {
    const ds = run(program(`    <script>a</script>\n    <style>b</style>`)).diags;
    expect(ds.map((d) => [d.code, d.severity])).toEqual([["E-SCRIPT-001", "Error"], ["E-STYLE-001", "Error"]]);
  });
});

describe("§4.17 — every opener position, the name matched exactly and case-insensitively", () => {
  test("any case of the name; the closer matched case-insensitively", () => {
    expect(codes(program(`    <SCRIPT>a</SCRIPT>\n    <Style>b</STYLE>\n    <p>x</p>`))).toEqual(["E-SCRIPT-001", "E-STYLE-001"]);
    expect(codes(program(`    <Script>alert(1)</sCrIpT>\n    <p>x</p>`))).toEqual(["E-SCRIPT-001"]);
  });
  test("a `renders` element and a nested element of one", () => {
    expect(codes(`<lnk u:string>\n</>\nrenders <script>alert(1)</script>\n\n${program(`    <lnk u="a"/>`)}`)).toEqual(["E-SCRIPT-001"]);
    expect(codes(`<lnk u:string>\n</>\nrenders <div><style>a{}</style></div>\n\n${program(`    <lnk u="a"/>`)}`)).toEqual(["E-STYLE-001"]);
  });
  test("outside `<program>`, and each occurrence once", () => {
    expect(codes(`<script>alert(1)</script>\n${program(`    <p>x</p>`)}`)).toEqual(["E-SCRIPT-001"]);
    expect(codes(program(`    <script>a</script>\n    <script>b</script>`))).toEqual(["E-SCRIPT-001", "E-SCRIPT-001"]);
  });
  test("the name is read as impl#1 reads it (`<script.x>`, `<script$x>` are `script`)", () => {
    expect(codes(program(`    <script.x>a</script>`))).toEqual(["E-SCRIPT-001"]);
    expect(codes(program(`    <script$x>a</script>`))).toEqual(["E-SCRIPT-001"]);
  });
  test("a declaration named `style` is the element too (impl#1 refuses it before reading the opener)", () => {
    expect(codes(program(`    let <style:string="x"/>\n    <p>\${@style}</p>`))).toContain("E-STYLE-001");
    expect(codes(program(`    let <style:string="x"/>\n    <p>\${@style}</p>`))).not.toContain("E-DECL-ILLEGAL-FIELD-NAME");
  });
});

describe("§4.17 recovery — the body is skipped whole, never read", () => {
  test("a brace-heavy JS body cascades into nothing; the markup after it still parses", () => {
    const r = run(program("    <script>if (a) { b() } else { c(`${d}`) }</script>\n    <p id=\"after\">ok</p>"));
    expect(r.diags.map((d) => d.code)).toEqual(["E-SCRIPT-001"]);
    const ast = JSON.stringify(r.asts);
    expect(ast).toContain("\"after\""); // the `<p id="after">` after the refused element
    expect(ast).not.toContain("else { c("); // the refused body is in no node
  });
  test("a bound attribute and an interpolated body are not analyzed (no undeclared-name report)", () => {
    expect(codes(program(`    <script src=@nowhere>\${@alsoNowhere}</script>`))).toEqual(["E-SCRIPT-001"]);
  });
  test("with no closer the skip runs to the end of the file (impl#1's recovery)", () => {
    const cs = codes(program(`    <script>alert(1)\n    <p>x</p>`));
    expect(cs[0]).toBe("E-SCRIPT-001");
    expect(cs).not.toContain("E-STYLE-001");
  });
});

describe("§4.17 — what stays legal", () => {
  test("`<noscript>` and a longer name (`<style-x>`) are ordinary elements", () => {
    expect(codes(program(`    <noscript>hi</noscript>`))).toEqual([]);
    expect(codes(program(`    <style-x>hi</style-x>`))).toEqual([]);
    expect(codes(program(`    <scripts>hi</scripts>`))).toEqual([]);
  });
  test("a `style=` attribute is not a `<style>` element", () => {
    expect(codes(program(`    <p style="color:red">x</p>`))).toEqual([]);
  });
  test("a `<*script/>` reference is not an element (impl#1 reads no name after `*`)", () => {
    expect(codes(program(`    <*script/>`))).not.toContain("E-SCRIPT-001");
  });
  test("`script` / `style` as text are text", () => {
    expect(codes(program(`    <p>a script and a style</p>`))).toEqual([]);
  });
});
