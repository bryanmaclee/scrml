/**
 * §4.17 (S462 Q21) — a `<pre>` / `<code>` raw body is DISPLAY TEXT.
 * change-id: s462-q21-raw-body-as-text.
 *
 * Ruling (user-voice-scrml.md S462 Q21, "I like a."): raw bodies are emitted with `<` and `>`
 * entity-encoded; `&` is NOT encoded; a nested `<code>` / `<pre>` element stays an element.
 * Pre-ruling the body was copied verbatim, so ANY active HTML written there ran in Chromium:
 * `<img onerror>`, `<svg onload>`, `<iframe srcdoc>` (both entity forms), `<link rel=stylesheet>`,
 * and a static component prop substituted into `<pre>${t}</pre>`
 * (g-raw-content-static-active-html-executes-s462). The runtime half is pinned by the
 * conformance cases under conformance/cases/raw-content/; this file pins the encoder and
 * every emitter path that writes a raw body.
 */

import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { encodeRawContentBody, isRawContentElement, rawContentDomLines, assertRawContentEncoded } from "../../src/raw-content-encode.ts";

function compile(source) {
  const dir = mkdtempSync(join(tmpdir(), "scrml-s462-q21-"));
  try {
    const file = join(dir, "app.scrml");
    writeFileSync(file, source);
    const r = compileScrml({ inputFiles: [file], write: false, log: () => {} });
    const errors = (r.errors ?? []).filter((e) => (e.severity ?? "error") === "error");
    const outs = [...(r.outputs?.values?.() ?? [])];
    return {
      codes: errors.map((e) => e.code),
      html: outs.map((o) => o.html ?? "").join("\n"),
      clientJs: outs.map((o) => o.clientJs ?? "").join("\n"),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const P = (body) => `<program>\n${body}\n</program>\n`;

describe("encodeRawContentBody — the one rule", () => {
  test("every < and > is encoded; & is left alone", () => {
    expect(encodeRawContentBody(`<img src=x onerror="a()">`)).toBe(`&lt;img src=x onerror="a()"&gt;`);
    expect(encodeRawContentBody(`a < b && c > d`)).toBe(`a &lt; b && c &gt; d`);
    expect(encodeRawContentBody(`&lt;b&gt; &amp; &#36;`)).toBe(`&lt;b&gt; &amp; &#36;`);
  });
  test("a body with no < or > is returned unchanged", () => {
    expect(encodeRawContentBody(`let x = 1; \${@y}`)).toBe(`let x = 1; \${@y}`);
    expect(encodeRawContentBody(``)).toBe(``);
  });
  test("a balanced, attribute-less nested <code> / <pre> stays an element; its text is encoded", () => {
    expect(encodeRawContentBody(`<code>let x = 1</code>`)).toBe(`<code>let x = 1</code>`);
    expect(encodeRawContentBody(`<code>a < b <i>x</i></code>`)).toBe(`<code>a &lt; b &lt;i&gt;x&lt;/i&gt;</code>`);
    expect(encodeRawContentBody(`<pre>x</pre>`)).toBe(`<pre>x</pre>`);
    expect(encodeRawContentBody(`<CODE>x</Code >`)).toBe(`<code>x</code>`);
    expect(encodeRawContentBody(`<code>a</code> and <code>b</code>`)).toBe(`<code>a</code> and <code>b</code>`);
  });
  test("a nested tag WITH attributes is text (corpus count 0)", () => {
    expect(encodeRawContentBody(`<code class="lang-js">x</code>`)).toBe(`&lt;code class="lang-js"&gt;x&lt;/code&gt;`);
    expect(encodeRawContentBody(`<code onclick="a()">x</code>`)).toBe(`&lt;code onclick="a()"&gt;x&lt;/code&gt;`);
  });
  test("an unpaired opener or closer is text", () => {
    expect(encodeRawContentBody(`<code>unclosed`)).toBe(`&lt;code&gt;unclosed`);
    expect(encodeRawContentBody(`stray</code>`)).toBe(`stray&lt;/code&gt;`);
    // a closer pairs only with the innermost open tag of the same name
    expect(encodeRawContentBody(`<code><pre>x</code></pre>`)).toBe(`&lt;code&gt;<pre>x&lt;/code&gt;</pre>`);
  });
  test("the output holds no element but the structural <code> / <pre>", () => {
    const hostile = [
      `<img src=x onerror=a()>`, `<svg onload=a()>`, `<iframe srcdoc="&lt;script&gt;a()&lt;/script&gt;">`,
      `<link rel=stylesheet href="data:text/css,x">`, `<code><img onerror=a()></code>`,
      `<code onmouseover=a()>x</code>`, `<code\nonclick=a()>x</code>`, `<xmp><!--</xmp><img onerror=a()>-->`,
      `<<code>>x<</code>>`, `<code/>x</code>`,
    ];
    for (const h of hostile) {
      const out = encodeRawContentBody(h);
      const tags = [...out.matchAll(/<[^>]*>?/g)].map((m) => m[0]);
      for (const t of tags) expect(t, `${h} -> ${out}`).toMatch(/^<\/?(code|pre)>$/);
    }
  });
  test("isRawContentElement: lowercase-first pre/code, never a component", () => {
    expect(isRawContentElement({ kind: "markup", tag: "pre" })).toBe(true);
    expect(isRawContentElement({ kind: "markup", tag: "cODE" })).toBe(true);
    expect(isRawContentElement({ kind: "markup", tag: "Pre" })).toBe(false);
    expect(isRawContentElement({ kind: "markup", tag: "preview" })).toBe(false);
    expect(isRawContentElement({ kind: "text", tag: "pre" })).toBe(false);
  });
  test("the DOM-sink form parses the encoded body through an inert <template>", () => {
    const lines = rawContentDomLines(`<img onerror=a()>`, "el", "t");
    expect(lines[0]).toBe(`const t = _scrml_g.document.createElement("template");`);
    expect(lines[1]).toContain(`t.innerHTML = "&lt;img onerror=a()&gt;";`);
    expect(lines[2]).toBe(`el.appendChild(t.content);`);
    // nothing to encode or decode — a plain text node
    expect(rawContentDomLines(`let x = \${@y}`, "el", "t")).toEqual([`el.appendChild(_scrml_g.document.createTextNode("let x = \${@y}"));`]);
    expect(rawContentDomLines(`a &amp; b`, "el", "t")).toHaveLength(3);
  });
});

describe("assertRawContentEncoded — the DOM sink's compile-time invariant", () => {
  test("accepts encoded text and the four structural tags", () => {
    for (const ok of [``, `a &lt; b`, `<code>x</code>`, `<pre><code>&lt;i&gt;</code></pre>`]) {
      expect(assertRawContentEncoded(ok)).toBe(ok);
    }
  });
  test("refuses any other < or >", () => {
    for (const bad of [`<img src=x onerror=a()>`, `a < b`, `x>`, `<code class="x">y</code>`, `<CODE>x</CODE>`, `<code >x</code>`, `</script>`]) {
      expect(() => assertRawContentEncoded(bad), bad).toThrow(/§4\.17 raw content/);
    }
  });
  test("rawContentDomLines asserts on the string it emits (an encoder that leaks `<` stops the compile)", () => {
    const leaky = (b) => b; // identity: leaves the author's tag text unencoded
    expect(() => rawContentDomLines(`<img onerror=a()>`, "el", "t", "", leaky)).toThrow(/§4\.17 raw content/);
    expect(() => rawContentDomLines(`<img onerror=a()>`, "el", "t")).not.toThrow();
  });
  test("fuzz: the real encoder never trips the assertion", () => {
    const alphabet = ["<", ">", "/", "code", "pre", "CODE", "Pre", " ", "\n", "&", "lt;", "=", "\"", "x", "img", "onerror", "<code>", "</code>", "<pre>", "</pre>"];
    let seed = 0x5462;
    const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    for (let i = 0; i < 20000; i++) {
      let s = "";
      const len = 1 + rnd(24);
      for (let j = 0; j < len; j++) s += alphabet[rnd(alphabet.length)];
      expect(() => rawContentDomLines(s, "el", "t")).not.toThrow();
      expect(() => assertRawContentEncoded(encodeRawContentBody(s))).not.toThrow();
    }
  });
});

describe("every emitter writes a raw body encoded", () => {
  const IMG = `<img src=x onerror="window.pwned=1">`;
  const ENC = `&lt;img src=x onerror="window.pwned=1"&gt;`;

  test("static HTML", () => {
    const { codes, html } = compile(P(`<pre>${IMG}</pre>\n<code>a < b</code>\n<pre><code>&lt;b&gt;</code></pre>`));
    expect(codes).toEqual([]);
    expect(html).toContain(`<pre>${ENC}</pre>`);
    expect(html).toContain(`<code>a &lt; b</code>`);
    expect(html).toContain(`<pre><code>&lt;b&gt;</code></pre>`);
    expect(html).not.toContain(`<img`);
  });

  test("the Chromium repros: svg onload, iframe srcdoc (both forms), link stylesheet", () => {
    const { codes, html } = compile(P([
      `<pre><svg onload="window.pwned=2"></svg></pre>`,
      `<pre><iframe srcdoc="&lt;script&gt;parent.pwned=3&lt;/script&gt;"></iframe></pre>`,
      `<pre><iframe srcdoc="&lt;img src=x onerror=parent.pwned=4&gt;"></iframe></pre>`,
      `<pre><link rel="stylesheet" href="data:text/css,body{background:red}"></pre>`,
    ].join("\n")));
    expect(codes).toEqual([]);
    expect(html).not.toMatch(/<(svg|iframe|link rel="stylesheet" href="data)/);
    expect(html).toContain(`<pre>&lt;svg onload="window.pwned=2"&gt;&lt;/svg&gt;</pre>`);
    expect(html).toContain(`<pre>&lt;iframe srcdoc="&lt;script&gt;parent.pwned=3&lt;/script&gt;"&gt;&lt;/iframe&gt;</pre>`);
  });

  test("a static component prop substituted into a raw body — encoded after substitution", () => {
    const { codes, html } = compile(P(`\${ const Box = <div props={ t: string }><pre>\${t}</pre></div> }\n<Box t="<img src=x onerror='window.pwned=5'>"/>`));
    expect(codes).toEqual([]);
    expect(html).toContain(`<pre>&lt;img src=x onerror='window.pwned=5'&gt;</pre>`);
    expect(html).not.toContain(`<img`);
  });

  test("an <if> body and ^{} emit() output", () => {
    const { codes, html } = compile(P(`<on> = true\n<if test=@on>\n  <pre>${IMG}</pre>\n</if>\n^{ emit("<pre><b>x</b></pre>") }`));
    expect(codes).toEqual([]);
    expect(html).toContain(`<pre>${ENC}</pre>`);
    expect(html).toContain(`<pre>&lt;b&gt;x&lt;/b&gt;</pre>`);
  });

  test("a <pre if=…> element", () => {
    const { codes, html } = compile(P(`<on> = true\n<pre if=@on>${IMG}</pre>`));
    expect(codes).toEqual([]);
    expect(html).toContain(ENC);
    expect(html).not.toContain(`<img`);
  });

  test("a <match> arm and an engine state-child (HTML strings in client JS)", () => {
    const { codes, clientJs } = compile(P([
      `\${ type K:enum = { A, B } }`, `<k> = K.A`,
      `<match for=K on=@k>`, `  <A><pre>M ${IMG}</pre></>`, `  <B><p>b</p></>`, `</match>`,
      `<engine for=K var=eng>`, `  <A> : <pre>E ${IMG}</pre>`, `  <B> : <p>b</p>`, `</engine>`,
    ].join("\n")));
    expect(codes).toEqual([]);
    expect(clientJs).toContain(JSON.stringify(`<pre>M ${ENC}</pre>`));
    expect(clientJs).toContain(JSON.stringify(`<pre>E ${ENC}</pre>`));
    expect(clientJs).not.toContain(`<img`);
  });

  test("an <each> row — DOM sink through an inert <template>, never a text node", () => {
    const { codes, clientJs } = compile(P(`<rows> = [1]\n<ul><each in=@rows as=r><li><pre>${IMG}</pre><pre><code>&lt;i&gt; a < b</code></pre></li></each></ul>`));
    expect(codes).toEqual([]);
    expect(clientJs).toContain(`.innerHTML = ${JSON.stringify(ENC)};`);
    expect(clientJs).toContain(`.innerHTML = ${JSON.stringify(`<code>&lt;i&gt; a &lt; b</code>`)};`);
    expect(clientJs).not.toContain(`createTextNode(${JSON.stringify(IMG)})`);
    expect(clientJs).not.toContain(`createElement("img")`);
  });

  test("a lifted component holding a raw body — DOM sink through an inert <template>", () => {
    const { codes, clientJs } = compile(P(`<f> = true\n\${ const Box = <div props={ t: string }><pre>\${t}</pre></div> }\n<div>\${ if (@f) { lift <Box t="<svg onload='window.pwned=3'>"/> } }</div>`));
    expect(codes).toEqual([]);
    expect(clientJs).toContain(`.innerHTML = ${JSON.stringify(`&lt;svg onload='window.pwned=3'&gt;`)};`);
    expect(clientJs).not.toContain(`createElement("svg")`);
  });

  test("a component holding a raw body inside an <each> row", () => {
    const { codes, clientJs } = compile(P(`<rows> = [1]\n\${ const Box = <div props={ t: string }><pre>\${t}</pre></div> }\n<ul><each in=@rows as=r><li><Box t="<img src=x onerror='a()'>"/></li></each></ul>`));
    expect(codes).toEqual([]);
    expect(clientJs).toContain(`.innerHTML = ${JSON.stringify(`&lt;img src=x onerror='a()'&gt;`)};`);
    expect(clientJs).not.toContain(`createElement("img")`);
  });
});

describe("the <script> / <style> refusal in a raw body is KEPT (defence in depth)", () => {
  test("a literal <script> start tag in <pre> is still E-SCRIPT-001", () => {
    expect(compile(P(`<pre><script>window.pwned=1</script></pre>`)).codes).toEqual(["E-SCRIPT-001"]);
  });
  test("a <match> arm holding an <each> row with <pre><script> is refused (was a silent accept)", () => {
    // g-match-arm-each-raw-body-script-silently-accepted-s462 — the arm's <each> is re-split at
    // codegen with the sub-split's errors discarded; emit-each now asks the raw-content backstop.
    const { codes, clientJs } = compile(P([
      `\${ type K:enum = { A, B } }`, `<k> = K.A`, `<items> = [1]`,
      `<match for=K on=@k>`,
      `  <A><ul><each in=@items as it><li><pre><script>window.pwned=1</script></pre></li></each></ul></>`,
      `  <B><p>b</p></>`, `</match>`,
    ].join("\n")));
    expect(codes).toEqual(["E-SCRIPT-001"]);
    expect(clientJs).not.toContain("window.pwned");
  });
  test("its entity-escaped display form is silent and displays as <script>", () => {
    const { codes, html } = compile(P(`<pre>&lt;script&gt;x&lt;/script&gt;</pre>`));
    expect(codes).toEqual([]);
    expect(html).toContain(`<pre>&lt;script&gt;x&lt;/script&gt;</pre>`);
  });
});
