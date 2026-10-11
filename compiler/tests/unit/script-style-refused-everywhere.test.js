/**
 * §4.17 (S462) — scrml does not admit `<script>` / `<style>` at ANY position.
 * change-id: s462-impl1-script-style-everywhere.
 *
 * Pre-S462 the refusal lived only on the block splitter's markup-opener path, and
 * every other place markup is parsed or built let the element through:
 *   - `lift <script>${@code}</script>` / `lift <script src=@u>` / `lift <style>…`
 *     lowered to `document.createElement("script"|"style")` — cell data ran as JS
 *     and a data-chosen URL loaded (Chromium-confirmed);
 *   - a markup VALUE, a `return <markup>`, a component body — same, or the element
 *     reached the served HTML verbatim;
 *   - an `<each>` body, a `<match>` arm, `${ <script>…</script> }` — silently dropped;
 *   - a `<pre>` / `<code>` raw body — a literal `<script>` reached the HTML and ran.
 *
 * Every position below must refuse with the block splitter's own codes, ONCE, and
 * write no artifact; the must-not-fire half pins the exact-name rule.
 */

import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { refusedElementCode, scanRawContentForRefusedTags, collectRefusedElements } from "../../src/element-refusal.ts";
import { emitCreateElementFromMarkup } from "../../src/codegen/emit-lift.js";
import { resetRefusedLowerings, drainRefusedLowerings } from "../../src/codegen/refused-lowering-errors.ts";

function compile(source) {
  const dir = mkdtempSync(join(tmpdir(), "scrml-s462-refuse-"));
  try {
    const file = join(dir, "app.scrml");
    writeFileSync(file, source);
    const r = compileScrml({ inputFiles: [file], write: false, log: () => {} });
    const errors = (r.errors ?? []).filter((e) => (e.severity ?? "error") === "error");
    const outs = [...(r.outputs?.values?.() ?? [])];
    const emitted = outs.map((o) => `${o.html ?? ""}\n${o.clientJs ?? ""}`).join("\n");
    return { errors, codes: errors.map((e) => e.code), emitted };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const P = (body) => `<program>\n${body}\n</program>\n`;

/** Exactly one refusal of `code`, no element in any emitted artifact. */
function expectRefusedOnce(source, code) {
  const { codes, emitted } = compile(source);
  expect(codes.filter((c) => c === code), `codes: ${JSON.stringify(codes)}`).toHaveLength(1);
  expect(emitted).not.toMatch(/createElement\("(script|style)"\)/i);
}

function expectNotRefused(source) {
  const { codes } = compile(source);
  expect(codes, `codes: ${JSON.stringify(codes)}`).not.toContain("E-SCRIPT-001");
  expect(codes).not.toContain("E-STYLE-001");
}

describe("(a) lift — the Chromium-confirmed forms", () => {
  test("lift <script>${@code}</script> — cell data as JS", () => {
    expectRefusedOnce(P(`<code> = "window.pwned=7"\n\${ lift <script>\${@code}</script> }`), "E-SCRIPT-001");
  });
  test("lift <script src=@u></script> — a data-chosen script URL", () => {
    expectRefusedOnce(P(`<u> = "/evil.js"\n\${ lift <script src=@u></script> }`), "E-SCRIPT-001");
  });
  test("lift <style>${@code}</style> — cell data as CSS", () => {
    expectRefusedOnce(P(`<code> = "body{}"\n\${ lift <style>\${@code}</style> }`), "E-STYLE-001");
  });
  test("case-insensitive: lift <SCRIPT> is the element, not a component", () => {
    const { codes } = compile(P(`\${ lift <SCRIPT>x</SCRIPT> }`));
    expect(codes).toEqual(["E-SCRIPT-001"]);
  });
  test("self-closing and nested lifted elements", () => {
    expectRefusedOnce(P(`\${ lift <script src="/x.js"/> }`), "E-SCRIPT-001");
    expectRefusedOnce(P(`\${ lift <div><span><script>x</script></span></div> }`), "E-SCRIPT-001");
  });
  test("for … lift and if … lift bodies", () => {
    expectRefusedOnce(P(`<items> = [1, 2]\n\${ for (const it of @items) { lift <li><script>x</script></li> } }`), "E-SCRIPT-001");
    expectRefusedOnce(P(`<f> = true\n\${ if (@f) { lift <style>p{}</style> } }`), "E-STYLE-001");
  });
  test("the refusal points at the element (line/col)", () => {
    const { errors } = compile(P(`<code> = "x"\n\${ lift <script>\${@code}</script> }`));
    expect(errors[0].span.line).toBe(3);
    expect(errors[0].span.col).toBe(9);
  });
});

describe("(b) positions that silently dropped the element", () => {
  test("<each> body", () => {
    expectRefusedOnce(P(`<items> = [1, 2]\n<ul><each in=@items as it><li><script>x</script></li></each></ul>`), "E-SCRIPT-001");
    expectRefusedOnce(P(`<items> = [1, 2]\n<ul><each in=@items as it><style>p{}</style></each></ul>`), "E-STYLE-001");
  });
  test("bare markup in a `${ }` logic block", () => {
    expectRefusedOnce(P(`\${ <script>x</script> }`), "E-SCRIPT-001");
    expectRefusedOnce(P(`\${ <div><p>a</p><style>p{}</style></div> }`), "E-STYLE-001");
  });
  test("an implied-lift `if` arm", () => {
    expectRefusedOnce(P(`<f> = true\n\${ if (@f) { <script>x</script> } }`), "E-SCRIPT-001");
  });
  test("a block <match> arm", () => {
    expectRefusedOnce(P(`\${ type Kind:enum = { A, B } }\n<k> = Kind.A\n<match for=Kind on=@k>\n<A><script>x</script></>\n<B><p>b</p></>\n</match>`), "E-SCRIPT-001");
  });
  test("an engine state-child body", () => {
    expectRefusedOnce(P(`\${ type S:enum = { Idle, Busy } }\n<engine for=S>\n<Idle><script>x</script></>\n<Busy><p>b</p></>\n</engine>`), "E-SCRIPT-001");
  });
});

describe("markup values, returns, components, slots", () => {
  test("markup as a value (ternary arm)", () => {
    const { errors } = compile(P(`<f> = true\n<x> = @f ? <script>a</script> : <b>b</b>\n<div>\${@x}</div>`));
    expect(errors.map((e) => e.code)).toEqual(["E-SCRIPT-001"]);
    expect(errors[0].span.line).toBe(3);
  });
  test("a function returning markup", () => {
    expectRefusedOnce(P(`\${ function mk() { return <script>a</script> } }\n<div>\${mk()}</div>`), "E-SCRIPT-001");
  });
  test("a component body (used)", () => {
    expectRefusedOnce(P(`\${ const C = <div><script>x</script></div> }\n<C/>`), "E-SCRIPT-001");
  });
  test("a component body (unused) is refused too", () => {
    expectRefusedOnce(P(`\${ const C = <style>p{}</style> }\n<p>x</p>`), "E-STYLE-001");
  });
  test("a slot fill at a component call site", () => {
    const { codes } = compile(P(`\${ const Pn = <div props={content: snippet}>\${render content()}</div> }\n<Pn><script slot="content">x</script></Pn>`));
    expect(codes).toContain("E-SCRIPT-001");
  });
});

describe("markup held in attributes, and more logic corners", () => {
  const SNIPPET_LIST = `\${ type Item:struct = { id: number, label: string } }\n\${ const List = <div props={ items: Item[], row: snippet(item: Item) }>\n  \${ for (i of items) { lift <div>\${render row(i)}</> }}\n</> }\n<items> = [{ id: 1, label: "a" }]`;
  test("a parametric snippet lambda attribute (rendered inside a for-lift)", () => {
    expectRefusedOnce(P(`${SNIPPET_LIST}\n<List items=@items row={ (item) => <script>window.pwned=1</script> }/>`), "E-SCRIPT-001");
  });
  test("a parametric snippet lambda attribute rendered at the top of the body", () => {
    expectRefusedOnce(P(`\${ type Item:struct = { id: number } }\n\${ const Card = <div props={ it: Item, foot: snippet(v: Item) }>\${render foot(it)}</div> }\n<x> = { id: 1 }\n<Card it=@x foot={ (v) => <script>x</script> }/>`), "E-SCRIPT-001");
  });
  test("a zero-arg snippet lambda attribute", () => {
    expectRefusedOnce(P(`\${ const Card = <div props={ head: snippet }>\${render head()}</div> }\n<Card head={ () => <style>p{}</style> }/>`), "E-STYLE-001");
  });
  test("a parametric snippet lambda that renders its markup is not refused", () => {
    expectNotRefused(P(`${SNIPPET_LIST}\n<List items=@items row={ (item) => <span>\${item.label}</span> }/>`));
  });
  test("a <tableFor> column `:let={(row) => …}` slot body", () => {
    const { errors } = compile(`\${\n  import { tableFor } from 'scrml:data'\n  type User:struct = { id: integer, name: string req }\n}\n<program>\n  <users> = [{ id: 1, name: "A" }]\n  <tableFor for=User rows=@users>\n    <column field="name" :let={(row) => <script>x</script>}/>\n  </tableFor>\n</program>\n`);
    expect(errors.map((e) => e.code)).toEqual(["E-SCRIPT-001"]);
    expect(errors[0].span.line).toBe(8);
  });
  test("an SVG-namespace <script> in lifted markup", () => {
    expectRefusedOnce(P(`\${ lift <svg><script>x</script></svg> }`), "E-SCRIPT-001");
  });
  test("a markup value inside a `${ }` interpolation reports at its file position", () => {
    const { errors } = compile(P(`<f> = true\n<div>\${ @f ? <style>p{}</style> : <b>b</b> }</div>`));
    expect(errors.map((e) => e.code)).toEqual(["E-STYLE-001"]);
    expect(errors[0].span.line).toBe(3);
    expect(errors[0].span.col).toBe(14);
  });
  test("logic nested inside lifted markup", () => {
    expectRefusedOnce(P(`<f> = true\n\${ lift <div>\${ if (@f) { lift <script>x</script> } }</div> }`), "E-SCRIPT-001");
  });
});

describe("(c) raw content — <pre> / <code> (S462 PA ruling, corpus count 0)", () => {
  test("a literal <script> in <pre> is refused", () => {
    expectRefusedOnce(P(`<pre><script>window.p=1</script></pre>`), "E-SCRIPT-001");
  });
  test("a literal <style> in <code> is refused", () => {
    expectRefusedOnce(P(`<code><style>body{}</style></code>`), "E-STYLE-001");
  });
  test("the refusal points inside the raw body", () => {
    const { errors } = compile(P(`<pre>line one\n  <SCRIPT src="/x.js"></SCRIPT></pre>`));
    expect(errors.map((e) => e.code)).toEqual(["E-SCRIPT-001"]);
    expect(errors[0].span.line).toBe(3);
    expect(errors[0].span.col).toBe(3);
  });
});

// S462 S239 review of b125d2786 — every repro ran in Chromium on that head.
describe("S462 review repros — raw content everywhere, expression-held markup", () => {
  const css = "body{color:rgb(255,0,0)}";
  const RCDATA = {
    textarea_attr: `<pre><textarea><a title="</textarea><script>window.pwned=1</script>">x</a></textarea></pre>`,
    textarea_comment: `<pre><textarea><!--</textarea><script>window.pwned=1</script>--></textarea></pre>`,
    xmp_comment: `<pre><xmp><!--</xmp><script>window.pwned=1</script>--></xmp></pre>`,
    title_attr: `<pre><title><b title="</title><script>window.pwned=1</script>"></b></title></pre>`,
    iframe_comment: `<pre><iframe><!--</iframe><script>window.pwned=1</script>--></iframe></pre>`,
    noembed_attr: `<pre><noembed><b title="</noembed><script>window.pwned=1</script>"></b></noembed></pre>`,
    noframes_comment: `<pre><noframes><!--</noframes><script>window.pwned=1</script>--></noframes></pre>`,
    code_xmp: `<code><xmp><!--</xmp><script>window.pwned=1</script>--></xmp></code>`,
    comment: `<pre><!--<script>window.pwned=1</script>--></pre>`,
    cdata: `<pre><![CDATA[<script>window.pwned=1</script>]]></pre>`,
  };
  for (const [name, body] of Object.entries(RCDATA)) {
    test(`HIGH 1 — raw body, fail-closed: ${name}`, () => expectRefusedOnce(P(body), "E-SCRIPT-001"));
  }
  test("HIGH 1 — raw body, fail-closed: noscript attr with <style>", () => {
    expectRefusedOnce(P(`<pre><noscript><b title="</noscript><style>${css}</style>"></b></noscript></pre>`), "E-STYLE-001");
  });
  test("HIGH 2 — a raw body inside a component definition (used and unused)", () => {
    expectRefusedOnce(P(`\${ const C = <div><pre><script>window.pwned=1</script></pre></div> }\n<C/>`), "E-SCRIPT-001");
    expectRefusedOnce(P(`\${ const C = <section><code><script>window.pwned=1</script></code></section> }\n<p>x</p>`), "E-SCRIPT-001");
    expectRefusedOnce(P(`\${ const C = <div><pre><style>${css}</style></pre></div> }\n<C/>`), "E-STYLE-001");
  });
  test("HIGH 3 — a raw body inside a <match> arm", () => {
    const M = (arm) => P(`\${ type K:enum = { A, B } }\n<k> = K.A\n<match for=K on=@k>\n  <A>${arm}</>\n  <B><p>b</p></>\n</match>`);
    expectRefusedOnce(M(`<pre><xmp><!--</xmp><script>window.pwned=1</script>--></xmp></pre>`), "E-SCRIPT-001");
    expectRefusedOnce(M(`<pre><style>${css}</style></pre>`), "E-STYLE-001");
    expectRefusedOnce(M(`<pre><script>window.pwned=1</script></pre>`), "E-SCRIPT-001");
  });
  test("HIGH 3 — a raw body inside an <each> body", () => {
    expectRefusedOnce(P(`<items> = [1]\n<div><each in=@items as it><pre><script>window.pwned=1</script></pre></each></div>`), "E-SCRIPT-001");
    expectRefusedOnce(P(`<items> = [1]\n<div><each in=@items as it><pre><style>${css}</style></pre></each></div>`), "E-STYLE-001");
  });
  test("a raw body in lifted markup and in a markup value", () => {
    expectRefusedOnce(P(`\${ lift <pre><xmp><!--</xmp><script>window.pwned=1</script>--></xmp></pre> }`), "E-SCRIPT-001");
    expectRefusedOnce(P(`<f> = true\n<div>\${ @f ? <pre><xmp><!--</xmp><script>window.pwned=1</script>--></xmp></pre> : <b/> }</div>`), "E-SCRIPT-001");
  });
  test("addendum — a raw body in ^{} emit() output", () => {
    expectRefusedOnce(P(`^{ emit("<pre><script>window.pwned=1</script></pre>") }`), "E-SCRIPT-001");
    expectRefusedOnce(P(`^{ emit("<pre><xmp><!--</xmp><script>window.pwned=1</script>--></xmp></pre>") }`), "E-SCRIPT-001");
    expectRefusedOnce(P(`^{ emit("<code><style>body{color:red}</style></code>") }`), "E-STYLE-001");
    expectNotRefused(P(`^{ emit("<pre>&lt;script&gt;</pre>") }`));
  });
  test("LOW 5 — markup held in a handler arrow is E-SCRIPT-001, not E-CODEGEN-INVALID-LOGIC", () => {
    const { codes } = compile(P(`<button onclick={() => <script>x</script>}>b</button>`));
    expect(codes).toEqual(["E-SCRIPT-001"]);
  });
  test("a handler arrow and a `<` comparison on a script-named cell are not refused", () => {
    expectNotRefused(P(`<n> = 0\n<button onclick={() => @n = @n + 1}>b</button>`));
    expectNotRefused(P(`<a> = 1\n<script_v> = 2\n<p>\${ @a < @script_v ? "y" : "n" }</p>`));
  });
});

describe("must NOT fire — the exact-name rule", () => {
  test("<noscript>, top-level and lifted", () => {
    expectNotRefused(P(`<noscript>enable js</noscript>\n\${ lift <noscript>n</noscript> }`));
  });
  test("names that merely start with script/style", () => {
    expectNotRefused(P(`\${ lift <scripts>n</scripts> }`));
    expectNotRefused(P(`\${ lift <style-x>n</style-x> }`));
    expectNotRefused(P(`\${ lift <script_x>n</script_x> }`));
    expectNotRefused(P(`<script-host>x</script-host>`));
  });
  test("lift <style-x> builds a style-x element, never a <style> (string-path name split)", () => {
    const { emitted } = compile(P(`\${ lift <style-x>n</style-x> }`));
    expect(emitted).toContain(`createElement("style-x")`);
    expect(emitted).not.toContain(`createElement("style")`);
  });
  test("the style= attribute", () => {
    expectNotRefused(P(`<div style="color:red">a</div>\n\${ lift <p style="color:blue">b</p> }`));
  });
  test("#{} CSS", () => {
    expectNotRefused(P(`#{ p { color: red; } }\n<p>x</p>`));
  });
  test("<script inside strings, comments, text and attribute values", () => {
    expectNotRefused(P(`<div title="<script>">x</div>\n<p>a &lt;script&gt; text</p>\n\${ const t = "<style>" }\n// <script> in a comment\n<!-- <script> -->`));
    expectNotRefused(P(`\${ <div>"<script>" <style-x>y</style-x></div> }`));
  });
  test("_{} foreign code", () => {
    expectNotRefused(`<foreign lang="ts" />\n\${\n  export fn f(x) {\n    const out = _={ in: { x }\n      const s = "<script>" + x;\n      return s;\n    }=\n    return out\n  }\n}\n`);
  });
});

describe("the shared rule (element-refusal.ts)", () => {
  test("refusedElementCode — exact, case-insensitive", () => {
    expect(refusedElementCode("script")).toBe("E-SCRIPT-001");
    expect(refusedElementCode("SCRIPT")).toBe("E-SCRIPT-001");
    expect(refusedElementCode("Style")).toBe("E-STYLE-001");
    for (const n of ["noscript", "scripts", "script_x", "style-x", "styles", "", undefined, null]) {
      expect(refusedElementCode(n)).toBe(null);
    }
  });

  test("scanRawContentForRefusedTags is fail-closed (S462 review — no tokenizer model)", () => {
    const hit = (s) => scanRawContentForRefusedTags(s).map((h) => `${h.code}@${h.offset}`);
    expect(hit("<script>x</script>")).toEqual(["E-SCRIPT-001@0"]);
    expect(hit("a <style\n>b")).toEqual(["E-STYLE-001@2"]);
    expect(hit("<script/>")).toEqual(["E-SCRIPT-001@0"]);
    expect(hit("<SCRIPT\t>")).toEqual(["E-SCRIPT-001@0"]);
    // refused wherever the text sits — comments, attribute values, RCDATA / RAWTEXT, CDATA:
    expect(hit("<!-- <script> -->")).toEqual(["E-SCRIPT-001@5"]);
    expect(hit("<a title=\"<script>\">x</a>")).toEqual(["E-SCRIPT-001@10"]);
    expect(hit("<a title='<style>'>x</a>")).toEqual(["E-STYLE-001@10"]);
    expect(hit("<textarea><a title=\"</textarea><script>x</script>\">")).toEqual(["E-SCRIPT-001@31"]);
    expect(hit("<xmp><!--</xmp><script>x</script>--></xmp>")).toEqual(["E-SCRIPT-001@15"]);
    expect(hit("<![CDATA[<script>x</script>]]>")).toEqual(["E-SCRIPT-001@9"]);
    expect(hit("text <script")).toEqual(["E-SCRIPT-001@5"]);
    // not a script / style start tag:
    expect(hit("&lt;script&gt;")).toEqual([]);
    expect(hit("</script>")).toEqual([]);
    expect(hit("<scripts> <script-x> <noscript> <stylesheet>")).toEqual([]);
    expect(hit("< script>")).toEqual([]);
  });

  test("collectRefusedElements walks every element node and neutralizes it", () => {
    const tree = { kind: "logic", body: [{ kind: "lift-expr", expr: { kind: "markup", node: {
      kind: "markup", tag: "SCRIPT", isComponent: true, attrs: [{ name: "src" }], children: [{ kind: "text", value: "x" }],
      span: { start: 5, end: 9, line: 1, col: 6 },
    } } }] };
    const sites = collectRefusedElements(tree);
    expect(sites.map((s) => s.code)).toEqual(["E-SCRIPT-001"]);
    expect(sites[0].node.tag).toBe("script");
    expect(sites[0].node.isComponent).toBe(false);
    expect(sites[0].node.attrs).toEqual([]);
    expect(sites[0].node.children).toEqual([]);
  });

  test("the builder refuses from parsed nodes; the block splitter keeps a marker", () => {
    const bs = splitBlocks("t.scrml", P(`<items> = [1]\n<ul><each in=@items as it><script>x</script></each></ul>`));
    expect(bs.errors.map((e) => e.code)).toEqual([]); // the <each> body is captured raw at BS
    const tab = buildAST(bs);
    expect(tab.errors.filter((e) => e.code === "E-SCRIPT-001")).toHaveLength(1);
  });
});

describe("codegen backstop", () => {
  test("emitCreateElementFromMarkup never builds a refused element and records the refusal", () => {
    resetRefusedLowerings();
    const lines = [];
    const v = emitCreateElementFromMarkup({ kind: "markup", tag: "script", attrs: [], children: [], span: { file: "x.scrml", start: 1, end: 2, line: 1, col: 2 } }, lines);
    expect(lines.join("\n")).not.toMatch(/createElement\("script"\)/);
    expect(lines.join("\n")).toContain(`const ${v} = _scrml_g.document.createComment("")`);
    expect(drainRefusedLowerings().map((e) => e.code)).toEqual(["E-SCRIPT-001"]);
  });

  test("a non-refused element is untouched", () => {
    resetRefusedLowerings();
    const lines = [];
    emitCreateElementFromMarkup({ kind: "markup", tag: "noscript", attrs: [], children: [], span: { start: 1, end: 2 } }, lines);
    expect(lines.join("\n")).toContain(`createElement("noscript")`);
    expect(drainRefusedLowerings()).toEqual([]);
  });
});
