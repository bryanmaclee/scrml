/**
 * runtime-meta-emit-gate-s458.test.js — SPEC §22.4.1 / §22.5.1 / §22.12, ruling S458 "a".
 *
 * Runtime `meta.emit(html)` output is held to the same closed rule as compile-time `emit()`
 * output: plain markup, no event-handler attributes, no `srcdoc`, URL schemes judged per §5.2.
 * A violation is refused, reported ONCE to the §19.6.8 logging surface, and NOTHING is written.
 * Admitted markup is inserted exactly as the ungated `innerHTML` path inserted it.
 *
 * Every test here EXECUTES the shipped runtime text (SCRML_RUNTIME) in happy-dom.
 */

import { describe, test, expect } from "bun:test";
import { Window } from "happy-dom";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { SCRML_RUNTIME } from "../../src/runtime-template.js";
import { CHUNK_DEPENDENCIES, applyChunkDependencies, RUNTIME_CHUNKS } from "../../src/codegen/runtime-chunks.ts";
import { standardMarkupElementNamesLowercase } from "../../src/html-elements.js";
import { compileScrml } from "../../src/api.js";

function makePage(initial = "old") {
  const win = new Window({ url: "http://localhost/" });
  const document = win.document;
  document.body.innerHTML = '<span data-scrml-meta="m1">' + initial + "</span>";
  const logs = [];
  const cons = { error: (...a) => logs.push(a.map(String).join(" ")), log() {}, warn() {}, info() {} };
  // eslint-disable-next-line no-new-func
  const rt = new Function("document", "window", "console",
    SCRML_RUNTIME + "\nreturn { _scrml_meta_emit, _scrml_meta_effect };")(document, win, cons);
  const slot = () => document.querySelector('[data-scrml-meta="m1"]');
  return { win, document, rt, logs, slot };
}

/** What the pre-S458 ungated path (`placeholder.innerHTML = html`) produced, in a fresh page. */
function ungated(html) {
  const win = new Window({ url: "http://localhost/" });
  const span = win.document.createElement("span");
  win.document.body.appendChild(span);
  span.innerHTML = html;
  return span.innerHTML;
}

const REFUSED = [
  ["img onerror", '<img src=x onerror="window.__pwn=1">', "onerror"],
  ["javascript: href", '<a href="javascript:window.__pwn=1">go</a>', "javascript"],
  ["iframe srcdoc", '<iframe srcdoc="<script>window.__pwn=1</script>"></iframe>', "__pwn"],
  ["svg animate href", '<svg><a><animate attributeName="href" to="javascript:window.__pwn=1"/></a></svg>', "__pwn"],
  ["script", "<script>window.__pwn=1</script>", "__pwn"],
  ["p onclick", '<p onclick="window.__pwn=1">p</p>', "__pwn"],
  ["entity-encoded javascript&#58;", '<a href="javascript&#58;window.__pwn=1">go</a>', "__pwn"],
  ["mixed-case ONERROR", '<img src=x ONERROR="window.__pwn=1">', "__pwn"],
  ["tab-split java\\tscript:", '<a href="java\tscript:window.__pwn=1">go</a>', "__pwn"],
  ["srcdoc on any element", '<div srcdoc="SECRETX"></div>', "SECRETX"],
  ["svg script", "<svg><script>window.__pwn=1</script></svg>", "__pwn"],
  ["nested template content", '<template><img src=x onerror="window.__pwn=1"></template>', "__pwn"],
  ["onbegin (handler no list knows)", '<svg><rect onbegin="window.__pwn=1"/></svg>', "__pwn"],
  ["form action javascript:", '<form action="javascript:window.__pwn=1"><button>b</button></form>', "__pwn"],
  ["button formaction", '<button formaction="javascript:window.__pwn=1">b</button>', "__pwn"],
  ["object", '<object data="https://x.example/a.swf"></object>', "x.example"],
  ["embed", '<embed src="https://x.example/a">', "x.example"],
  ["base", '<base href="https://x.example/">', "x.example"],
  ["link", '<link rel="stylesheet" href="https://x.example/a.css">', "x.example"],
  ["meta refresh", '<meta http-equiv="refresh" content="0;url=https://x.example/">', "x.example"],
  ["style element", "<style>body{display:none}</style>", "display"],
  ["svg set", '<svg><set attributeName="fill" to="red"/></svg>', "red"],
  ["data:text/html src", '<img src="data:text/html,<script>1</script>">', "text/html"],
  ["non-standard element", "<Counter>SECRETX</Counter>", "SECRETX"],
  // S458 "your recs on all four" item 3 — the data-scrml- attribute namespace is compiler-owned.
  ["data-scrml-* attribute", '<p data-scrml-meta="SECRETX">p</p>', "SECRETX"],
  ["data-scrml-* upper case", '<p DATA-SCRML-OUTLET="SECRETX">p</p>', "SECRETX"],
  ["data-scrml-* no value", "<p data-scrml-gated>SECRETX</p>", "SECRETX"],
  ["data-scrml-* after a /", '<p/data-scrml-each-mount="SECRETX">p</p>', "SECRETX"],
  ["data-scrml-* unquoted", "<p data-scrml-x=SECRETX>p</p>", "SECRETX"],
  ["data-scrml-* on svg (foreign content)", '<svg><rect Data-Scrml-X="SECRETX"/></svg>', "SECRETX"],
  ["data-scrml-* nested", '<ul><li><b data-scrml-x="SECRETX">b</b></li></ul>', "SECRETX"],
  // PA-ruled S459 consequence: bare `data-scrml` is the component CSS scope root.
  ["bare data-scrml", '<div data-scrml="Card"><p>SECRETX</p></div>', "SECRETX"],
  ["bare DATA-SCRML, no value", "<div DATA-SCRML>SECRETX</div>", "SECRETX"],
  // S459 round 3 — the attribute test is CLOSED (markup-attr-allow-list.js): a name not on the list is
  // refused, whatever it is.
  ["unknown attribute", '<p online="SECRETX">p</p>', "SECRETX"],
  ["custom element's own attribute", '<my-widget a="SECRETX">c</my-widget>', "SECRETX"],
  ["near-miss x-data-scrml-y", '<p x-data-scrml-y="SECRETX">p</p>', "SECRETX"],
  ["entity in a NAME (literal name, not on the list)", '<p data&#45;scrml-x="SECRETX">p</p>', "SECRETX"],
  ["is= (customized built-in)", '<p is="x-SECRETX">p</p>', "SECRETX"],
  ["form= retargets a page form", '<button form="SECRETX">b</button>', "SECRETX"],
  ["https formaction", '<button formaction="https://SECRETX.example/">b</button>', "SECRETX"],
  ["form action https", '<form action="https://SECRETX.example/"><input></form>', "SECRETX"],
  ["ping", '<a href="/x" ping="https://SECRETX.example/">a</a>', "SECRETX"],
  ["xml:base", '<svg xml:base="https://SECRETX.example/"><a href="x"><text>t</text></a></svg>', "SECRETX"],
  ["popovertarget", '<button popovertarget="SECRETX">b</button>', "SECRETX"],
  ["img name= (document named property)", '<img src="/a.png" name="SECRETX">', "SECRETX"],
  ["id in the reserved _scrml namespace", '<p id="_scrml_error_boundary_log">SECRETX</p>', "SECRETX"],
  ["name naming a form member (belt and braces)", '<form><input name="action" value="SECRETX"></form>', "SECRETX"],
  // S459 review HIGH — DOM clobbering shapes (Chromium-verified in the round-3 harness; here: refused,
  // nothing written, ONE log).
  ["clobber lastChild", '<form><input name="lastChild"><img src=x onerror="window.__pwn=40"></form>', "__pwn"],
  ["clobber previousSibling", '<img src=x onerror="window.__pwn=41"><form><input name="previousSibling"></form>', "__pwn"],
  ["clobber attributes (action)", '<form action="javascript:window.__pwn=42"><input name="attributes"><button>go</button></form>', "__pwn"],
  ["clobber attributes (onclick)", '<form onclick="window.__pwn=43"><input name="attributes"><button type=button>go</button></form>', "__pwn"],
  // S459 round 4 F1 — a label's `for` acts on the page's `#id`.
  ["label for= (acts on a page element by id)", '<label for="SECRETX">free stuff</label>', "SECRETX"],
  // S459 round 4 F2 — named properties of an EMITTED form / of document.
  ["input name=name inside an emitted form", '<form><input name="name" value="SECRETX"></form>', "SECRETX"],
  ["img id= a form member inside an emitted form", '<form><img id="elements" src="/a.png" alt="SECRETX"></form>', "SECRETX"],
  ["custom element id= a form member inside an emitted form", '<form><x-f id="method">SECRETX</x-f></form>', "SECRETX"],
  // S459 round 4 — ASCII-only name folding: a KELVIN SIGN attribute name is not `k`.
  ["KELVIN SIGN attribute name (not folded to k)", '<svg><g K="SECRETX"></g></svg>', "SECRETX"],
];

describe("S458 'a' — runtime meta.emit refuses, writes nothing, logs once", () => {
  for (const [label, html, secret] of REFUSED) {
    test(`refused: ${label}`, () => {
      const { rt, logs, slot, win } = makePage("old");
      rt._scrml_meta_emit("m1", html);
      expect(slot().innerHTML).toBe("old");
      expect(logs.length).toBe(1);
      expect(logs[0]).toContain("meta-emit");
      expect(logs[0]).toContain("Nothing was written");
      // The report never echoes the refused VALUE (it is data).
      expect(logs[0]).not.toContain(secret === "onerror" ? "window.__pwn" : secret);
      expect(win.__pwn).toBeUndefined();
    });
  }

  test("a refusal leaves no fallback node either (no placeholder in the page)", () => {
    const { rt, document } = makePage("old");
    rt._scrml_meta_emit("nosuch", '<img src=x onerror="1">');
    expect(document.querySelector('[data-scrml-meta="nosuch"]')).toBeNull();
  });
});

const ADMITTED = [
  "plain text",
  "<p>text <b>bold</b> <i>it</i></p>",
  '<ul><li class="a">one</li><li id="b">two</li></ul>',
  '<div data-k="v" data-scope="_scrml_meta_1">x</div>',
  '<a href="https://example.com/a?b=1">abs</a><a href="/users/1">rel</a><a href="page">rel2</a><a href="#top">frag</a>',
  '<a href="mailto:a@b.c">m</a><a href="tel:+1">t</a>',
  '<img src="data:image/png;base64,AAAA" alt="x">',
  '<p style="color: red" title="t" aria-label="l" role="note" lang="en" dir="ltr" tabindex="0">s</p>',
  "<my-widget class=\"w\" data-a=\"1\">c</my-widget>",
  '<form><label>Q <input id="q" name="q" type="text" placeholder="p" required></label>' +
    '<select name="s"><option value="1" selected>1</option></select><textarea name="t" rows="2"></textarea>' +
    '<button type="submit" name="go" value="1">go</button></form>',
  '<table><tr><th scope="col" colspan="2">h</th></tr><tr><td rowspan="1">d</td></tr></table>',
  '<img src="/a.png" srcset="/a.png 1x, /b.png 2x" alt="a" width="10" height="10" loading="lazy">',
  '<svg viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg"><path d="M0 0L10 10" stroke="red" stroke-width="2" fill="none"></path><use href="#x"></use></svg>',
  // (MathML attributes are pinned in Chromium, not here: happy-dom parses <math> children in the HTML namespace.)
  '<details open><summary>s</summary>d</details><ol start="3" reversed><li value="3">x</li></ol>',
  '<svg viewBox="0 0 1 1"><circle r="1"></circle><foreignObject><p>x</p></foreignObject></svg>',
  "<math><mi>x</mi></math>",
  "<!-- note --><p>after</p>",
  "",
  "<p>Count: 3</p>",
  // Parsed in the insertion point's context, as the ungated innerHTML path parsed it: table parts
  // outside a table lose their tags there, and do here too.
  "<tr><td>a</td></tr>",
  "<td>b</td>",
  "<body><p>x</p></body>",
  "<title>t</title><p>y</p>",
  "<p>unclosed <b>bold",
  "a &amp; b &lt;c&gt;",
  // Ordinary data-* (data-scrmlx is not in the compiler-owned data-scrml namespace) and aria-*.
  '<p data-x="1" data-scrmlx="2" aria-label="l">ok</p>',
  // S459 round 4 F2 — a plain element takes any id / name; a control outside a form names nothing.
  '<h2 id="title">T</h2><div id="hidden">a</div><section id="focus">b</section><p id="constructor">c</p>',
  '<input name="name"><input name="action">',
  '<img id="title" src="/a.png" alt="a">',
  // F1 — a label without `for`; `<output for>` names its inputs only.
  '<label>Name <input name="n"></label><output for="a b">1</output>',
];

describe("S458 'a' — admitted markup is inserted exactly as the ungated path inserted it", () => {
  for (const html of ADMITTED) {
    test(`admitted: ${JSON.stringify(html).slice(0, 60)}`, () => {
      const { rt, logs, slot } = makePage("old");
      rt._scrml_meta_emit("m1", html);
      expect(logs).toEqual([]);
      expect(slot().innerHTML).toBe(ungated(html));
    });
  }

  test("a repeated emit replaces the previous content", () => {
    const { rt, slot } = makePage("old");
    rt._scrml_meta_emit("m1", "<p>1</p>");
    rt._scrml_meta_emit("m1", "<p>2</p>");
    expect(slot().innerHTML).toBe("<p>2</p>");
  });

  test("no placeholder: the fallback span is appended with the admitted nodes", () => {
    const { rt, document } = makePage("old");
    rt._scrml_meta_emit("m9", "<b>x</b>");
    const el = document.querySelector('[data-scrml-meta="m9"]');
    expect(el).not.toBeNull();
    expect(el.innerHTML).toBe("<b>x</b>");
  });

  test("meta.emit from a runtime ^{} effect goes through the gate", () => {
    const { rt, logs, slot } = makePage("old");
    rt._scrml_meta_effect("m1", (meta) => { meta.emit('<p onclick="x()">p</p>'); });
    expect(slot().innerHTML).toBe("old");
    expect(logs.length).toBe(1);
    rt._scrml_meta_effect("m1", (meta) => { meta.emit("<p>ok</p>"); });
    expect(slot().innerHTML).toBe("<p>ok</p>");
  });
});

/** A page whose meta placeholder sits inside a page `<form id="pf">` (S459 round 4 F1). */
function makeFormPage() {
  const win = new Window({ url: "http://localhost/" });
  const document = win.document;
  document.body.innerHTML = '<form id="pf"><div><span data-scrml-meta="m1">old</span></div></form>';
  const logs = [];
  const cons = { error: (...a) => logs.push(a.map(String).join(" ")), log() {}, warn() {}, info() {} };
  // eslint-disable-next-line no-new-func
  const rt = new Function("document", "window", "console",
    SCRML_RUNTIME + "\nreturn { _scrml_meta_emit };")(document, win, cons);
  const slot = () => document.querySelector('[data-scrml-meta="m1"]');
  return { win, document, rt, logs, slot };
}

describe("S459 round 4 F1 — an insertion point inside a page <form> admits no form control", () => {
  const CONTROLS = [
    ["hidden input (would feed the page form's FormData)", '<input type="hidden" name="amount" value="999999">'],
    ["submit button (would submit the page form)", '<button type="submit">go</button>'],
    ["select", '<select name="s"><option>1</option></select>'],
    ["textarea", '<textarea name="t"></textarea>'],
    ["output", "<output>1</output>"],
    ["fieldset", "<fieldset>f</fieldset>"],
    ["a control nested in admitted markup", '<p>text <b><input name="q"></b></p>'],
    ["a custom element (may be form-associated once upgraded)", "<x-field>f</x-field>"],
    ["an emitted form's control (still inside the page form)", '<form><input name="q"></form>'],
  ];
  for (const [label, html] of CONTROLS) {
    test(`refused: ${label}`, () => {
      const { rt, logs, slot, document } = makeFormPage();
      rt._scrml_meta_emit("m1", html);
      expect(slot().innerHTML).toBe("old");
      expect(logs.length).toBe(1);
      expect(logs[0]).toContain("inside a page <form>");
      expect(logs[0]).not.toContain("999999");
      expect(win2FormData(document)).toEqual([]);
    });
  }
  test("non-control markup inside a page form is admitted", () => {
    const { rt, logs, slot } = makeFormPage();
    rt._scrml_meta_emit("m1", '<p class="hint">Enter <b>your</b> name</p><label>Q</label>');
    expect(logs).toEqual([]);
    expect(slot().innerHTML).toBe('<p class="hint">Enter <b>your</b> name</p><label>Q</label>');
  });
  test("an img id naming a member of the page form is refused there (it would shadow pf.<member>)", () => {
    const { rt, logs, slot } = makeFormPage();
    rt._scrml_meta_emit("m1", '<img id="action" src="/a.png" alt="a">');
    expect(slot().innerHTML).toBe("old");
    expect(logs.length).toBe(1);
  });
  test("the same controls outside a form are admitted", () => {
    const { rt, logs, slot } = makePage("old");
    rt._scrml_meta_emit("m1", '<input type="hidden" name="amount" value="1"><button type="submit">go</button>');
    expect(logs).toEqual([]);
    expect(slot().innerHTML).toBe(ungated('<input type="hidden" name="amount" value="1"><button type="submit">go</button>'));
  });
});

/** Entries of `new FormData(#pf)` — empty when nothing joined the page form. */
function win2FormData(document) {
  const pf = document.getElementById("pf");
  const out = [];
  for (const el of pf.querySelectorAll("input,select,textarea,button")) if (el.name) out.push(el.name);
  return out;
}

describe("S459 round 4 F3 — a non-HTML <template> is an ordinary element; the gate never throws", () => {
  for (const html of ["<svg><template><circle r=\"1\"></circle></template></svg>", "<math><template><mi>x</mi></template></math>"]) {
    test(`no exception: ${html}`, () => {
      const { rt, logs, slot } = makePage("old");
      expect(() => rt._scrml_meta_emit("m1", html)).not.toThrow();
      // Admitted (its children judged as ordinary children) — or, if the environment's parser gave
      // the gate something it could not read, refused with ONE report. Never an exception.
      // (Read through childNodes: happy-dom's own serializer throws on a foreign-namespace `template`.)
      const first = slot().firstChild;
      if (first && first.nodeType === 3 && first.data === "old") expect(logs.length).toBe(1);
      else expect(logs).toEqual([]);
    });
  }
  test("a refused child of a non-HTML template is still refused", () => {
    const { rt, logs, slot } = makePage("old");
    rt._scrml_meta_emit("m1", '<svg><template><a href="javascript:window.__pwn=1"><text>x</text></a></template></svg>');
    expect(slot().innerHTML).toBe("old");
    expect(logs.length).toBe(1);
  });
});

describe("S458 'a' — one element list, one URL reader, chunk wiring", () => {
  test("the runtime element allow-list is html-elements.js's list (not a hand copy)", () => {
    const fn = new Function(SCRML_RUNTIME + "\nreturn [..._SCRML_META_EMIT_KNOWN_ELEMENTS];");
    expect(fn()).toEqual(standardMarkupElementNamesLowercase());
  });

  test("the metaemit chunk calls the urlguard reader and defines no URL reader of its own", () => {
    const src = RUNTIME_CHUNKS.metaemit;
    expect(src).toContain("_scrml_meta_emit_checked");
    expect(src).toContain("_scrml_url_value_admitted(");
    expect(src).not.toContain("function _scrml_read_url_scheme");
    expect(src).not.toContain("_SCRML_SAFE_URL_SCHEMES = ");
  });

  test("CHUNK_DEPENDENCIES: meta pulls metaemit, metaemit pulls urlguard", () => {
    expect(CHUNK_DEPENDENCIES.meta).toContain("metaemit");
    expect(CHUNK_DEPENDENCIES.metaemit).toContain("urlguard");
    const s = applyChunkDependencies(new Set(["core", "meta"]));
    expect(s.has("metaemit")).toBe(true);
    expect(s.has("urlguard")).toBe(true);
  });

  test("compiled: a runtime ^{} program ships the gate; a counter does not", () => {
    const tmp = mkdtempSync(join(tmpdir(), "meta-emit-gate-"));
    try {
      const build = (name, src) => {
        const dir = join(tmp, name);
        const file = join(tmp, name + ".scrml");
        writeFileSync(file, src);
        const r = compileScrml({ inputFiles: [file], outputDir: dir, write: true, log: () => {} });
        expect(r.errors.length).toBe(0);
        return readFileSync(join(dir, r.runtimeFilename), "utf8");
      };
      const meta = build("meta", "<count> = 0\n<div>\n  ^{\n    meta.emit(`<p>Count: ${meta.get(\"count\")}</p>`)\n  }\n</div>\n");
      expect(meta).toContain("function _scrml_meta_emit_checked");
      expect(meta).toContain("function _scrml_url_value_admitted");
      const counter = build("counter", "<count> = 0\n\n<button onclick={ @count = @count + 1 }>\n  count is ${@count}\n</button>\n");
      expect(counter).not.toContain("_scrml_meta_emit_checked");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
