// raw-content.test.js — s468-bootstrap-failopen-gaps: SPEC §4.17 raw-content
// elements (`<pre>`, `<code>`) in the bootstrap.
//
// Governing text, SPEC §4.17:
//  - "The element names `pre` and `code` (matched case-insensitively) are
//    raw-content elements. After the opening tag is parsed (including any
//    attributes per §5), the block splitter SHALL scan the body as a single
//    text run terminated only by the matching close tag." No `${…}`, tag,
//    `</>`, sigil, `//` comment or `<!-- -->` skip is recognized inside.
//  - "A raw-content body is display text: `<` and `>` are entity-encoded on
//    output (S462 Q21) … nothing in a raw-content body builds an element" —
//    except "A nested `<code>…</code>` or `<pre>…</pre>` pair with NO attributes
//    stays an element … Only a BALANCED pair qualifies"; "A nested tag that
//    carries any attribute (`<code class="lang-js">`) is text".
//  - "Raw content does not admit `<script>` or `<style>` (S462) … The rule is
//    FAIL-CLOSED and does not model the HTML tokenizer: every case-insensitive
//    `<script` / `<style` start-tag text ANYWHERE in a raw-content body —
//    inside an attribute value, an `<!-- … -->` comment, a CDATA section, or an
//    RCDATA / RAWTEXT element … included — SHALL be `E-SCRIPT-001` /
//    `E-STYLE-001` … The name is exact: `<script` / `<style` followed by
//    whitespace, `/`, `>` or the end of the body".
//  - §5.2: "Text that only looks like an attribute inside a raw-content body
//    (`<pre>`, `<code>`, §4.17) is display text and is not judged."
//
// The gap (g-bootstrap-raw-content-not-fail-closed-s462): the bootstrap parsed
// a raw body as markup — the four `element-refusal/raw-*` conformance cases
// were not refused, `<img onerror="…">` there was judged as a handler, and
// `a < b` / `</pre>` inside `<code>` were parse errors.

import { describe, test, expect, beforeAll, afterEach } from "bun:test";
import { loadM2, frontEnd } from "./harness.js";
import { loadProgram, expectNoPageErrors } from "../slice-m1/load-program.js";

let mods;
beforeAll(() => { ({ mods } = loadM2()); }, { timeout: 120000 });
afterEach(() => expectNoPageErrors());

const run = (src) => frontEnd(mods, [{ path: "r.scrml", src }]);
const codes = (src) => run(src).diags.map((d) => d.code);
const clean = (src) => {
  const r = run(src);
  expect(r.diags.map((d) => `${d.code}: ${d.message}`)).toEqual([]);
  expect(mods.check.checkCore(r.core)).toEqual([]);
  return r.core;
};
const P = (main, decls = "") => `<program>\n${decls}\n    <main>\n${main}\n    </main>\n</program>\n`;
const $ = (sel) => document.querySelector(sel);
const printed = (core) => mods.print.printProgram(core, "r.client.js", "scrml-runtime.js").html;

describe("§4.17 — `<script` / `<style` start-tag text anywhere in a raw body is refused (fail closed)", () => {
  // the four conformance cases (conformance/cases/element-refusal/raw-*) the bootstrap failed
  for (const [name, body, code] of [
    ["inside a comment (raw-comment-script-pos)", `<!--<script>window.pwned = 1</script>-->`, "E-SCRIPT-001"],
    ["in a `<noscript>` attribute (raw-noscript-attr-style-pos)", `<noscript><b title="</noscript><style>body { color: red }</style>"></b></noscript>`, "E-STYLE-001"],
    ["in a `<textarea>` attribute (raw-textarea-attr-breakout-pos)", `<textarea><a title="</textarea><script>window.pwned = 1</script>">x</a></textarea>`, "E-SCRIPT-001"],
    ["in an `<xmp>` comment (raw-xmp-comment-breakout-pos)", `<xmp><!--</xmp><script>window.pwned = 1</script>--></xmp>`, "E-SCRIPT-001"],
    ["a literal start tag (pre-raw-script-pos)", `<script>window.pwned = 7</script>`, "E-SCRIPT-001"],
    ["any case, `/` after the name, at the end of the body", `<SCRIPT/>`, "E-SCRIPT-001"],
  ]) {
    test(name, () => {
      const r = run(P(`        <p>page</p>\n        <pre>${body}</pre>`));
      expect(r.diags.map((d) => d.code)).toEqual([code]);
      expect(r.diags[0].message).toContain("raw content");
    });
  }
  test("`<code>` too, and every hit is reported (two tags → two reports)", () => {
    expect(codes(P(`        <code><style>a{}</style> <script></script></code>`))).toEqual(["E-STYLE-001", "E-SCRIPT-001"]);
  });
  test("near names are not the tags: an end tag, `<scripts>`, `<script-x>`, `<stylesheet>`, the entity form (raw-content-display-neg)", () => {
    clean(P(`        <pre>&lt;script&gt;x&lt;/script&gt;</pre>\n        <code>&lt;style&gt;</code>\n        <pre></script> <scripts> <script-x> <stylesheet></pre>`));
  });
});

describe("§4.17 — a raw body is display text: no scrml token, no element", () => {
  test("`${…}`, a tag, `a < b`, `//`, `<!-- -->`, `</>` and a quoted `on…=` inside are text — none is parsed or judged", async () => {
    const body = `<img src=x onerror="window.pwned=1"> a < b \${x} // c <!-- k --> </> ?{q}`;
    const core = clean(P(`        <pre id="p">${body}</pre>`));
    await loadProgram(core, "raw-text", []);
    expect($("#p").textContent).toBe(body);
    expect($("#p").children.length).toBe(0);
    expect(window.pwned).toBeUndefined();
    // the page holds the text encoded — no `<img` element anywhere in it
    expect(printed(core)).toContain("&lt;img src=x onerror=");
  });
  test("`&` is NOT encoded: an author entity decodes and displays as its character; `<` / `>` are encoded (Core View.RawText)", async () => {
    const core = clean(P(`        <pre id="e">&lt;b&gt;bold?&lt;/b&gt; a &amp;&amp; b &#36;{x}</pre>`));
    expect(printed(core)).toContain(`<pre id="e">&lt;b&gt;bold?&lt;/b&gt; a &amp;&amp; b &#36;{x}</pre>`);
    await loadProgram(core, "raw-entities", []);
    expect($("#e").textContent).toBe("<b>bold?</b> a && b ${x}");
    expect($("#e").children.length).toBe(0);
  });
  test("a balanced attribute-less `<code>` pair stays an element (the `<pre><code>` wrapper); its body is text", async () => {
    await loadProgram(clean(P(`        <pre id="w"><code>let a = <b>1</b></code></pre>`)), "raw-wrapper", []);
    const code = $("#w > code");
    expect(code).not.toBeNull();
    expect(code.textContent).toBe("let a = <b>1</b>");
    expect(code.children.length).toBe(0);
  });
  test("a nested tag WITH an attribute is text; an unpaired opener is text", async () => {
    await loadProgram(clean(P(`        <pre id="a"><code class="k">x</code></pre>\n        <pre id="u">a <code> b</pre>`)), "raw-nested-text", []);
    expect($("#a").children.length).toBe(0);
    expect($("#a").textContent).toBe(`<code class="k">x</code>`);
    expect($("#u").textContent).toBe("a <code> b");
  });
  test("the body ends at the first `</pre>` / `</code>` (any case); the opener's own attributes are still attributes", async () => {
    await loadProgram(clean(P(`        <pre id="c" class="k">x </code> y</PRE>`)), "raw-close", []);
    expect($("#c").getAttribute("class")).toBe("k");
    expect($("#c").textContent).toBe("x </code> y");
  });
  test("an attribute of the raw element itself IS judged (§5 attributes): a quoted handler on `<pre>` is refused", () => {
    expect(codes(P(`        <pre onclick="x()">t</pre>`))).toEqual(["E-ATTR-QUOTED-HANDLER"]);
  });
  test("an unclosed raw element → E-PARSE-UNCLOSED (the body runs to the end of the file)", () => {
    expect(codes(`<program>\n    <main>\n        <pre>never closed\n    </main>\n</program>\n`)).toContain("E-PARSE-UNCLOSED");
  });
  test("in a declaration's renders and an `<each>` row", async () => {
    const decls = `    <rows:Row[]=([{ id: 1 }])/>\n    <snip t:string/>\n    renders <pre class="s">\${t} <b>x</b></pre>`;
    const core = clean(`type Row:struct = { id: int }\n` + P(`        <snip t="a"/>\n        <each in=@rows key=@.id as r><code class="e"><i>i</i></code></each>`, decls));
    await loadProgram(core, "raw-positions", []);
    expect($("pre.s").textContent).toBe("${t} <b>x</b>");
    expect($("code.e").textContent).toBe("<i>i</i>");
  });
});
