/**
 * §4.17 — a `<pre>` / `<code>` written in `lift` / logic-context markup is a raw-content
 * element, exactly as at top level. change-id: s465-lift-pre-raw
 * (gap g-lift-pre-code-not-raw-content-s462).
 *
 * Pre-fix, `parseLiftTag` read the body from LOGIC tokens: `${@x}` interpolated, tag text
 * built live elements (`lift <pre><img src="x" onerror=…></pre>` ran the handler in
 * Chromium), and the `'` of `don't` opened a string token that swallowed the close tag and
 * the code after it. Now the body is ONE text child captured from source to the matching
 * close tag, written by the one raw-body rule (encodeRawContentBody via rawContentDomLines).
 * The runtime half is pinned by conformance/cases/raw-content/lift-raw-body-displays-as-text.
 */

import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { sealRawContentBody, unsealRawContentBody } from "../../src/raw-content-encode.ts";

function compile(source) {
  const dir = mkdtempSync(join(tmpdir(), "scrml-s465-lift-raw-"));
  try {
    const file = join(dir, "app.scrml");
    writeFileSync(file, source);
    const r = compileScrml({ inputFiles: [file], write: false, log: () => {} });
    const errors = (r.errors ?? []).filter((e) => (e.severity ?? "error") === "error");
    const outs = [...(r.outputs?.values?.() ?? [])];
    return {
      codes: errors.map((e) => e.code),
      clientJs: outs.map((o) => o.clientJs ?? "").join("\n"),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const P = (body) => `<program>\n<x> = "VAL"\n<f> = true\n${body}\n</program>\n`;
const LIFT = (markup) => P(`<div>\${ if (@f) { lift ${markup} } }</div>`);

describe("lift <pre>/<code> — the body is one raw text run", () => {
  test("tag text in the body builds no element; its `<` `>` are encoded", () => {
    const { codes, clientJs } = compile(LIFT(`<div><pre id="p"><img src="x" onerror="window.pwned=1"></pre></div>`));
    expect(codes).toEqual([]);
    expect(clientJs).not.toContain(`createElement("img")`);
    expect(clientJs).not.toContain(`setAttribute("onerror"`);
    expect(clientJs).toContain(`innerHTML = "&lt;img src=\\"x\\" onerror=\\"window.pwned=1\\"&gt;"`);
  });

  test("`${…}` in the body is literal text, not an interpolation", () => {
    const { codes, clientJs } = compile(LIFT(`<pre id="p">a \${@x} b</pre>`));
    expect(codes).toEqual([]);
    expect(clientJs).toContain(`createTextNode("a \${@x} b")`);
    expect(clientJs).not.toMatch(/_scrml_lift_el_\d+\.appendChild\(_scrml_g\.document\.createTextNode\(_scrml_g\.String\(\(_scrml_cs_reactive_get\("x"\)/);
  });

  test("a balanced bare <code> wrapper inside <pre> stays an element", () => {
    const { codes, clientJs } = compile(LIFT(`<pre id="p"><code>let y = 1 < 2</code></pre>`));
    expect(codes).toEqual([]);
    expect(clientJs).toContain(`innerHTML = "<code>let y = 1 &lt; 2</code>"`);
  });

  test("an apostrophe in the body does not open a string past the close tag", () => {
    const { codes, clientJs } = compile(LIFT(`<div><code id="c">don't stop</code><span id="s">\${@x}</span></div>`));
    expect(codes).toEqual([]);
    expect(clientJs).toContain(`createTextNode("don't stop")`);
    // The markup after the raw body is still parsed as markup.
    expect(clientJs).toContain(`createElement("span")`);
    expect(clientJs).toContain(`_scrml_cs_reactive_get("x")`);
  });

  test("whitespace, newlines and quotes are kept exactly", () => {
    const { codes, clientJs } = compile(LIFT(`<pre id="p">line1\n  "q" 'z' \`t\` /x/ </ pre></pre>`));
    expect(codes).toEqual([]);
    expect(clientJs).toContain(`innerHTML = "line1\\n  \\"q\\" 'z' \`t\` /x/ &lt;/ pre&gt;"`);
  });

  test("a body beginning with `=` (lexed with the opener's `>` as `>=`)", () => {
    const { codes, clientJs } = compile(LIFT(`<code id="c">=</code>`));
    expect(codes).toEqual([]);
    expect(clientJs).toContain(`createTextNode("=")`);
  });

  test("an empty body", () => {
    const { codes, clientJs } = compile(LIFT(`<pre id="p"></pre>`));
    expect(codes).toEqual([]);
    expect(clientJs).toContain(`createElement("pre")`);
  });

  test("the close tag matches case-insensitively, like the block splitter", () => {
    const { codes, clientJs } = compile(LIFT(`<pre id="p"><b>x</b></PRE>`));
    expect(codes).toEqual([]);
    expect(clientJs).not.toContain(`createElement("b")`);
    expect(clientJs).toContain(`innerHTML = "&lt;b&gt;x&lt;/b&gt;"`);
  });

  test("a `for … lift` row body", () => {
    const { codes, clientJs } = compile(P(`<ul>\${ for (const r of [1, 2]) { lift <li><pre class="p">row \${r} <b>x</b></pre></li> } }</ul>`));
    expect(codes).toEqual([]);
    expect(clientJs).not.toContain(`createElement("b")`);
    expect(clientJs).toContain(`innerHTML = "row \${r} &lt;b&gt;x&lt;/b&gt;"`);
  });

  test("a `return <pre>` markup value", () => {
    const { codes, clientJs } = compile(P(`<div>\${ fn mk() -> markup { return <pre id="p">r \${@x} <img src="x" onerror="window.pwned=2"></pre> } lift mk() }</div>`));
    expect(codes).toEqual([]);
    expect(clientJs).not.toContain(`createElement("img")`);
    expect(clientJs).toContain(`innerHTML = "r \${@x} &lt;img src=\\"x\\" onerror=\\"window.pwned=2\\"&gt;"`);
  });

  test("a ternary markup value", () => {
    const { codes, clientJs } = compile(P(`<div>\${ @f ? <pre id="p">a <i>b</i> \${@x}</pre> : <b>no</b> }</div>`));
    expect(codes).toEqual([]);
    expect(clientJs).not.toContain(`createElement("i")`);
    expect(clientJs).toContain(`innerHTML = "a &lt;i&gt;b&lt;/i&gt; \${@x}"`);
  });

  test("an uppercase-first <PRE> is a component reference, not raw content", () => {
    const { codes } = compile(LIFT(`<div><PRE>x</PRE></div>`));
    expect(codes).toContain("E-COMPONENT-035");
  });

  test("the <script> refusal still applies to a lifted raw body", () => {
    const { codes } = compile(LIFT(`<pre id="p"><script>window.pwned=3</script></pre>`));
    expect(codes).toContain("E-SCRIPT-001");
  });
});

describe("lift <pre>/<code> — the malformed-markup string path", () => {
  test("a raw body inside markup the tag parser declines builds no element", () => {
    // `</span>` does not close `<div>`: parseLiftTag declines; the string path runs.
    const { clientJs } = compile(LIFT(`<div id="s1"><pre><img src="x" onerror="window.pwned=4"></pre></span>`));
    expect(clientJs).not.toContain(`createElement("img")`);
    expect(clientJs).toContain(`innerHTML = "&lt;img src=\\"x\\" onerror=\\"window.pwned=4\\"&gt;"`);
  });

  test("a raw body inside an opener the tag parser rejects before reaching it", () => {
    const { clientJs } = compile(LIFT(`<div id="s2" %><pre>a \${@x} <img src="x" onerror="window.pwned=5"></pre></div>`));
    expect(clientJs).not.toContain(`createElement("img")`);
    expect(clientJs).toContain(`a \${@x} &lt;img`);
  });

  test("the seal used to carry a raw body through the string is lossless", () => {
    const bodies = ["", "a < b && c > d", "don't ${x} `t` \"q\" / \\ %41 \n\t", "\uD800 lone", "&lt;b&gt;"];
    for (const b of bodies) {
      const sealed = sealRawContentBody(b);
      expect(sealed).not.toMatch(/[<>\/${}'"`\s\\]/);
      expect(unsealRawContentBody(`  ${sealed} /`)).toBe(b);
    }
  });
});
