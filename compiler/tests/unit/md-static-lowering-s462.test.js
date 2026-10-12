/**
 * SPEC §67 phase 2 (S462) — a STATIC `<md>` body lowered at build time.
 * change-id: s462-md-phase2.
 *
 * Rulings (user-voice-scrml.md S462): Q21 "I like a." (what you type is what is shown) · `<md>`
 * F1 "a" (`${…}` is TEXT-ONLY) · F2 "yes a." (same closed set and §5.2 guard; `of=` built second)
 * · F3 "a works. one way to do it with lints to guide" · F4 "a" (ONE reader, `scrml:md`) · Q22
 * "c is good" (static `<md>` is strict: a second spelling is text plus its W-MD lint).
 *
 * This file pins the compile-time half: the block-splitter production (§67.2 — two exits, slots
 * taken not parsed), the reader call and the W-MD position mapping, the §67.6 closed element set
 * in the emitted HTML, heading ids, the E-MD-* codes, and the emitter paths (`if=`, `<each>`,
 * `<match>`, components). The runtime half — the DOM in happy-dom and Chromium, reactive slots,
 * hostile values, the URL guard — is md-static-s462.browser.test.js, md-static-chromium-s462
 * .browser.test.js and conformance/cases/md/.
 */

import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { encodeMdText, isMdPhrasingParent, sourceHasMdElement } from "../../src/md-lower.ts";

function compile(source) {
  const dir = mkdtempSync(join(tmpdir(), "scrml-s462-md2-"));
  try {
    const file = join(dir, "app.scrml");
    writeFileSync(file, source);
    const r = compileScrml({ inputFiles: [file], write: false, log: () => {} });
    const all = [...(r.errors ?? []), ...(r.warnings ?? [])];
    const errors = (r.errors ?? []).filter((e) => (e.severity ?? "error") === "error");
    const outs = [...(r.outputs?.values?.() ?? [])];
    return {
      codes: errors.map((e) => e.code),
      all,
      allCodes: all.map((e) => e.code),
      html: outs.map((o) => o.html ?? "").join("\n"),
      clientJs: outs.map((o) => o.clientJs ?? "").join("\n"),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const P = (body) => `<program>\n${body}\n</program>\n`;

/** The md host's emitted HTML (the first `<div …>` after the marker text). */
function body(html) {
  const m = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  return (m ? m[1] : html).replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").trim();
}

function mdBlock(source) {
  const bs = splitBlocks("/t/app.scrml", source);
  const find = (bl) => {
    for (const b of bl) {
      if (b && b.type === "markup" && b.name === "md") return b;
      const c = find(b?.children ?? []);
      if (c) return c;
    }
    return null;
  };
  return { md: find(bs.blocks), errors: bs.errors };
}

describe("§67.2 — the block-splitter production", () => {
  test("the body has two exits: a tag, a comment, `#{`, `?{` and `//` are markdown text", () => {
    const src = `<div><md>a <b>x</b> <!-- c --> #{ d } ?{ e } // f\n</md><p>after</p></div>`;
    const { md } = mdBlock(src);
    expect(md).not.toBeNull();
    expect(md.children).toEqual([]);
    const bodyText = src.slice(md.mdBody.start, md.mdBody.end);
    expect(bodyText).toBe("a <b>x</b> <!-- c --> #{ d } ?{ e } // f\n");
    expect(md.mdBody.slots).toEqual([]);
  });

  test("a `${…}` is TAKEN, not parsed: its balanced extent is a slot (strings, templates, comments)", () => {
    const src = '<div><md>x ${"}"} y ${`a${b}c`} z ${ f({ a: 1 }) /* } */ } w</md></div>';
    const { md } = mdBlock(src);
    const slots = md.mdBody.slots.map((s) => src.slice(s.start, s.end));
    expect(slots).toEqual(['${"}"}', "${`a${b}c`}", "${ f({ a: 1 }) /* } */ }"]);
    expect(md.mdBody.slots.every((s) => s.closed)).toBe(true);
  });

  test("the body ends at the first `</md>` (case-insensitive), whatever a slot holds (pin 3)", () => {
    const src = '<div><md>a ${ "</MD>" } b</md></div>';
    const { md } = mdBlock(src);
    expect(src.slice(md.mdBody.start, md.mdBody.end)).toBe('a ${ "');
    expect(md.mdBody.slots).toEqual([{ start: md.mdBody.start + 2, end: md.mdBody.end, closed: false }]);
  });

  test("a shell `${HOME:-/tmp}` is one balanced slot", () => {
    const src = "<div><md>```sh\necho ${HOME:-/tmp}\n```\n</md></div>";
    const { md } = mdBlock(src);
    expect(md.mdBody.slots.map((s) => src.slice(s.start, s.end))).toEqual(["${HOME:-/tmp}"]);
  });

  test("end of file before `</md>` is E-CTX-001", () => {
    const { errors } = mdBlock("<div><md>## open\n");
    expect(errors.map((e) => e.code)).toContain("E-CTX-001");
  });

  test("`<Md>` is a component reference, not the md element", () => {
    const { md } = mdBlock("<div><Md>x</Md></div>");
    expect(md).toBeNull();
  });
});

describe("§67.6 — the closed element set, content only as text", () => {
  test("a realistic body lowers to the CommonMark element tree inside a host div", () => {
    const r = compile(P(`<article>
    <md class="prose" id="guide">
        ## Filing a good bug report

        Before you file, **search the board**. Duplicates get *closed*.

        - Say what you *expected*.
        - Wrap the error in \`backticks\`.
        - Read the [triage guide](/docs/triage "Triage").

        1. one
        2. two

        > a quote

        ---

        | a | b |
        | :- | -: |
        | 1 | ~~2~~ |

        ![logo](/logo.png)
    </md>
</article>`));
    expect(r.codes).toEqual([]);
    const h = body(r.html);
    expect(h).toContain(`<div class="prose" id="guide">`);
    expect(h).toContain(`<h2 id="filing-a-good-bug-report">Filing a good bug report</h2>`);
    expect(h).toContain(`<p>Before you file, <strong>search the board</strong>. Duplicates get <em>closed</em>.</p>`);
    expect(h).toContain(`<ul>\n<li>Say what you <em>expected</em>.</li>\n<li>Wrap the error in <code>backticks</code>.</li>\n<li>Read the <a href="/docs/triage" title="Triage">triage guide</a>.</li>\n</ul>`);
    expect(h).toContain(`<ol>\n<li>one</li>\n<li>two</li>\n</ol>`);
    expect(h).toContain(`<blockquote>\n<p>a quote</p>\n</blockquote>`);
    expect(h).toMatch(/<hr\s*\/?>/);
    expect(h).toContain(`<table><thead><tr><th style="text-align:left">a</th><th style="text-align:right">b</th></tr></thead><tbody><tr><td style="text-align:left">1</td><td style="text-align:right"><del>2</del></td></tr></tbody></table>`);
    expect(h).toMatch(/<img src="\/logo.png" alt="logo"\s*\/?>/);
    expect(h).not.toContain("<md");
  });

  test("every text character is encoded: raw HTML, entities and `${` in code show as typed", () => {
    const r = compile(P(`<div>
    <md>
        Write <b>bold</b> or &copy; here.

        \`\`\`js
        if (a < b && c) { x = "\${y}" }
        \`\`\`
    </md>
</div>`));
    expect(r.codes).toEqual([]);
    const h = body(r.html);
    expect(h).toContain(`<p>Write &lt;b&gt;bold&lt;/b&gt; or &amp;copy; here.</p>`);
    expect(h).toContain(`<pre><code class="language-js">if (a &lt; b &amp;&amp; c) { x = &quot;&#36;{y}&quot; }\n</code></pre>`);
    expect(h).not.toContain("<b>");
    // the W-MD lints for the OUT constructs
    expect(r.allCodes).toContain("W-MD-RAW-HTML");
    expect(r.allCodes).toContain("W-MD-ENTITY");
  });

  test("encodeMdText encodes & < > \" and $", () => {
    expect(encodeMdText(`<a href="x">&$`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#36;");
  });

  test("an ordered list that starts at 3 writes `start`; a fence's info word becomes the language class", () => {
    const r = compile(P(`<div>
    <md>
        3. three
        4. four

        \`\`\`c++ extra words
        x
        \`\`\`
    </md>
</div>`));
    const h = body(r.html);
    expect(h).toContain(`<ol start="3">`);
    expect(h).toContain(`<code class="language-c++">`);
  });
});

describe("§67.4 — slots are text-only, placed by the reader, parsed after placement", () => {
  test("a slot in inline text is an ordinary reactive interpolation (never markdown)", () => {
    const r = compile(P(`<who> = "Ann"
<div>
    <md>
        ## Hello \${@who}

        **\${@who}** is here.
    </md>
</div>`));
    expect(r.codes).toEqual([]);
    const h = body(r.html);
    expect(h).toMatch(/<h2 id="hello-">Hello <span data-scrml-logic="[^"]+"><\/span><\/h2>/);
    expect(h).toMatch(/<p><strong><span data-scrml-logic="[^"]+"><\/span><\/strong> is here.<\/p>/);
    expect(r.clientJs).toContain("_scrml_render_value");
  });

  test("a slot in code is inert: restored as its source text, never parsed or scope-checked", () => {
    const r = compile(P(`<div>
    <md>
        Use \`\${undefinedName}\` like this:

        \`\`\`sh
        echo \${HOME:-/tmp}
        \`\`\`
    </md>
</div>`));
    expect(r.codes).toEqual([]);
    expect(r.allCodes).not.toContain("E-SCOPE-001");
    const h = body(r.html);
    expect(h).toContain(`<code>&#36;{undefinedName}</code>`);
    expect(h).toContain(`<code class="language-sh">echo &#36;{HOME:-/tmp}\n</code>`);
  });

  test("a slot outside code is scope-checked at its real source position", () => {
    const r = compile(P(`<div>
    <md>
        Hello \${missingName}
    </md>
</div>`));
    const e = r.all.find((x) => x.code === "E-SCOPE-001");
    expect(e).toBeDefined();
    const sp = e.span ?? e.tabSpan ?? {};
    expect(sp.line).toBe(4);
    expect(sp.col).toBe(17);
  });

  test("a slot in a destination makes it data-led: written through the §5.2 rule 3 guard", () => {
    const r = compile(P(`<id> = 7
<u> = "/x"
<div>
    <md>
        [queue](/users/\${@id}/queue) and [any](\${@u})
    </md>
</div>`));
    expect(r.codes).toEqual([]);
    expect(r.clientJs).toContain(`_scrml_safe_url(`);
    expect(r.clientJs).toContain(`["/users/", _scrml_cs_reactive_get("id"), "/queue"].join("")`);
    expect(body(r.html)).not.toMatch(/href="\/users/);
  });

  test("a slot in a link title / image alt is the attribute's text value", () => {
    const r = compile(P(`<t> = "T"
<div>
    <md>
        [a](/a "tip \${@t}") ![alt \${@t}](/i.png)
    </md>
</div>`));
    expect(r.codes).toEqual([]);
    expect(r.clientJs).toContain(`["tip ", _scrml_cs_reactive_get("t")].join("")`);
    expect(r.clientJs).toContain(`["alt ", _scrml_cs_reactive_get("t")].join("")`);
  });

  test("an atom never starts a block: a slot at a line start is paragraph text", () => {
    const r = compile(P(`<x> = "# not a heading"
<div>
    <md>
        \${@x}
    </md>
</div>`));
    expect(body(r.html)).toMatch(/<p><span data-scrml-logic="[^"]+"><\/span><\/p>/);
  });
});

describe("§67.11 — diagnostics", () => {
  test("a W-MD lint is a Warning at the construct's source position (the dedent mapped back)", () => {
    const r = compile(P(`<div>
    <md>
        Some text.

        * a star bullet
    </md>
</div>`));
    expect(r.codes).toEqual([]);
    const w = r.all.find((x) => x.code === "W-MD-BULLET-MARKER");
    expect(w).toBeDefined();
    expect(w.severity).toBe("warning");
    const sp = w.span ?? w.tabSpan ?? {};
    expect(sp.line).toBe(6);
    expect(sp.col).toBe(9);
  });

  test("Q22 strict: a second spelling renders as text plus its lint", () => {
    const r = compile(P(`<div>
    <md>
        __not strong__
    </md>
</div>`));
    expect(body(r.html)).toContain(`<p>__not strong__</p>`);
    expect(r.allCodes).toContain("W-MD-EMPHASIS-UNDERSCORE");
  });

  test("E-MD-URL-SCHEME: a literal javascript: / data:text/html destination is refused", () => {
    const r = compile(P(`<div>
    <md>
        [x](javascript:alert(1)) ![y](data:text/html,z) [ok](https://a.b) ![img](data:image/png;base64,AAAA)
    </md>
</div>`));
    expect(r.codes.filter((c) => c === "E-MD-URL-SCHEME").length).toBe(2);
  });

  test("E-MD-URL-SCHEME: a data-led destination whose literal prefix already commits to javascript:", () => {
    const r = compile(P(`<x> = "a"
<div>
    <md>
        [x](javascript:\${@x})
    </md>
</div>`));
    expect(r.codes).toContain("E-MD-URL-SCHEME");
  });

  test("E-MD-INTERP-UNCLOSED names <pre>", () => {
    const r = compile(P(`<div>
    <md>
        unclosed \${ a
    </md>
</div>`));
    const e = r.all.find((x) => x.code === "E-MD-INTERP-UNCLOSED");
    expect(e).toBeDefined();
    expect(String(e.message)).toContain("<pre>");
  });

  test("E-MD-INDENT-MIXED: a tab on one line, spaces on another", () => {
    const r = compile(P(`<div>
<md>
\tone
    two
</md>
</div>`));
    expect(r.codes).toContain("E-MD-INDENT-MIXED");
  });

  test("E-MD-IN-PHRASING: <md> inside p, span, a, button, h2", () => {
    for (const parent of ["p", "span", "a", "button", "h2"]) {
      const r = compile(P(`<div><${parent}><md>x</md></${parent}></div>`));
      expect(r.codes).toContain("E-MD-IN-PHRASING");
    }
    for (const parent of ["div", "section", "li", "article", "td"]) {
      const r = compile(P(`<div><${parent}><md>x</md></${parent}></div>`));
      expect(r.codes).not.toContain("E-MD-IN-PHRASING");
    }
    expect(isMdPhrasingParent("a")).toBe(true);
    expect(isMdPhrasingParent("A")).toBe(false);
  });

  test("E-MD-OF-BODY: of= with a body; `<md of=…/>` alone is E-MD-OF-NOMINAL until phase 3", () => {
    expect(compile(P(`<x> = "a"\n<div><md of=@x>body</md></div>`)).codes).toContain("E-MD-OF-BODY");
    expect(compile(P(`<x> = "a"\n<div><md of=@x/></div>`)).codes).toContain("E-MD-OF-NOMINAL");
  });

  test("E-MD-IN-LOGIC-NOMINAL: an <md> in lift markup or a markup value is refused by name, once", () => {
    const lifted = compile(P(`<items> = ["a"]
<ul>
\${
    for (const it of @items) {
        lift <li><md>
            **x**
        </md></li>
    }
}
</ul>`));
    expect(lifted.codes.filter((c) => c === "E-MD-IN-LOGIC-NOMINAL").length).toBe(1);
    expect(lifted.codes).not.toContain("E-MARKUP-001");
    const value = compile(P(`<on> = true
<div>\${ @on ? <div><md>
    **yes**
</md></div> : <p>no</p> }</div>`));
    expect(value.codes.filter((c) => c === "E-MD-IN-LOGIC-NOMINAL").length).toBe(1);
  });

  test("W-ATTR-001 for an attribute §67.2 does not admit; class/id/style reach the host", () => {
    const r = compile(P(`<div><md class="c" style="color:red" title="t">x</md></div>`));
    expect(r.allCodes).toContain("W-ATTR-001");
    expect(body(r.html)).toContain(`<div class="c" style="color:red">`);
    expect(body(r.html)).not.toContain(`title="t"`);
  });
});

describe("E-TYPE-026 is decided by provenance (review MED-A)", () => {
  test("a line starting `match ` in an <md> body or a <pre>/<code> raw body is text, not control flow", () => {
    const r = compile(P(`<div>
    <md>
        match the order to the invoice

        \`\`\`scrml
        match x {
        }
        \`\`\`
    </md>
</div>
<pre>
match y {
}
</pre>
<code>match z {</code>`));
    expect(r.codes).not.toContain("E-TYPE-026");
    expect(r.codes).toEqual([]);
  });
  test("markup text outside those still reports it", () => {
    const r = compile(P(`<div>
    match x {
    }
</div>`));
    expect(r.codes).toContain("E-TYPE-026");
  });
});

describe("a `${` in a code span never swallows text (review MED-B)", () => {
  // §67.4: "Where an atom is inert — inside a code span and inside a fenced code block …: the slot is
  // restored to its exact source text, so `${…}` is shown literally". The extent is found by lexing
  // (§4.18.1b), so a quote that reaches its line end unclosed is a lexing failure — the `${` has no
  // balancing `}` — never an extent stitched out of the prose after it.
  test("a code-span `${` in every inline position renders verbatim and is never scope-checked", () => {
    const r = compile(P(`<div>
    <md>
        # Head \`\${h}\` tail

        [link \`\${y}\` text](/u) and **bold \`\${z}\`** and \`\${ "}" }\` and \`\`\${w}\`\`

        - item \`\${i}\`
    </md>
</div>`));
    expect(r.codes).toEqual([]);
    expect(r.allCodes).not.toContain("E-SCOPE-001");
    const h = body(r.html);
    for (const s of ["h", "y", "z", "w", "i"]) expect(h).toContain(`<code>&#36;{${s}}</code>`);
    expect(h).toContain(`<code>&#36;{ &quot;}&quot; }</code>`);
  });

  test("an unclosed quote inside a code-span slot is E-MD-INTERP-UNCLOSED, and the prose after it stays text", () => {
    const r = compile(P(`<div>
    <md>
        A \`\${"}\` x.

        next } line
    </md>
</div>`));
    expect(r.allCodes).toContain("E-MD-INTERP-UNCLOSED");
    expect(r.allCodes).not.toContain("E-CTX-001");
    expect(body(r.html)).toContain("next } line");
  });

  test("an apostrophe inside a code-span slot is E-MD-INTERP-UNCLOSED, not a slot running to a later `}`", () => {
    const r = compile(P(`<div>
    <md>
        A \`\${it's}\` value.

        Later } here.
    </md>
</div>`));
    const e = r.all.find((x) => x.code === "E-MD-INTERP-UNCLOSED");
    expect(e).toBeDefined();
    expect(String(e.message)).toContain("<pre>");
    expect((e.span ?? e.tabSpan ?? {}).line).toBe(4);
    expect(body(r.html)).toContain("Later } here.");
  });

  test("the splitter: a quote closed on its line balances; one reaching the line end leaves the `${` unclosed", () => {
    const ok = '<div><md>x ${"}"} y ${ \'a\' } z</md></div>';
    const a = mdBlock(ok).md.mdBody.slots;
    expect(a.map((s) => ok.slice(s.start, s.end))).toEqual(['${"}"}', "${ 'a' }"]);
    const bad = '<div><md>A `${"}` x.\nnext } line\n</md></div>';
    const b = mdBlock(bad).md;
    expect(b.mdBody.slots).toEqual([{ start: bad.indexOf("${"), end: b.mdBody.end, closed: false }]);
  });
});

describe("§67.6 — heading ids", () => {
  test("slugs keep Unicode letters, dedupe page-wide against author ids and earlier headings", () => {
    const r = compile(P(`<div id="intro">author</div>
<div>
    <md>
        # Intro

        ## Intro

        ## 快速入门

        ## !!!
    </md>
    <md>
        ## Intro
    </md>
</div>`));
    const h = body(r.html);
    expect(h).toContain(`<h1 id="intro-1">Intro</h1>`);
    expect(h).toContain(`<h2 id="intro-2">Intro</h2>`);
    expect(h).toContain(`<h2 id="快速入门">快速入门</h2>`);
    expect(h).toContain(`<h2 id="section">!!!</h2>`);
    expect(h).toContain(`<h2 id="intro-3">Intro</h2>`);
  });

  test("component instances get distinct ids", () => {
    const r = compile(P(`const Card = <section props={ t: string }>
    <md>
        ## Card
    </md>
</section>
<Card t="a"/>
<Card t="b"/>`));
    expect(r.codes).toEqual([]);
    const h = body(r.html);
    expect(h).toContain(`<h2 id="card">Card</h2>`);
    expect(h).toContain(`<h2 id="card-1">Card</h2>`);
  });
});

describe("emitter positions", () => {
  test("inside an if= gate", () => {
    const r = compile(P(`<on> = true
<div if=@on>
    <md>
        ## Gated
    </md>
</div>`));
    expect(r.codes).toEqual([]);
    expect(body(r.html)).toContain(`<h2 id="gated">Gated</h2>`);
  });

  test("inside an <each> row: text nodes, soft breaks kept, slots per item", () => {
    const r = compile(P(`<rows> = [{ id: 1, name: "a" }]
<ul>
    <each in=@rows key=@.id>
        <li>
            <md>
                **Item** \${@.name} and
                more
            </md>
        </li>
    </each>
</ul>`));
    expect(r.codes).toEqual([]);
    expect(r.clientJs).toContain(`createTextNode("\\n")`);
    expect(r.clientJs).toContain(`createTextNode("Item")`);
  });

  test("inside a <match> arm (the codegen re-parse routes <md> to the live front end)", () => {
    const r = compile(P(`type Phase:enum = { Idle, Ready }
<phase>: Phase = .Ready
<match for=Phase on=@phase>
    <Idle><p>idle</p></>
    <Ready>
        <div>
            <md>
                ## Ready
            </md>
        </div>
    </>
</match>`));
    expect(r.codes).toEqual([]);
    expect(r.clientJs).toContain(`<h2 id=\\"ready\\">Ready</h2>`);
    expect(r.clientJs).not.toContain("<md>");
  });

  test("inside a component body: the markdown keeps its lines (blank lines, `#`)", () => {
    const r = compile(P(`const Note = <section props={ title: string }>
    <md>
        ### Note \${title}

        Body *text*.
    </md>
</section>
<Note title="one"/>`));
    expect(r.codes).toEqual([]);
    const h = body(r.html);
    expect(h).toContain(`<h3 id="note-">Note one</h3>`);
    expect(h).toContain(`<p>Body <em>text</em>.</p>`);
  });

  test("sourceHasMdElement — the re-parse routing test", () => {
    expect(sourceHasMdElement("<div><md>x</md></div>")).toBe(true);
    expect(sourceHasMdElement("<md of=@x/>")).toBe(true);
    expect(sourceHasMdElement("<mdx>")).toBe(false);
    expect(sourceHasMdElement("<Md>")).toBe(false);
  });
});

describe("the AST", () => {
  test("the lowered host carries `_mdHost`; text nodes carry the plain text in `_mdText`", () => {
    const ast = buildAST(splitBlocks("/t/a.scrml", P(`<div><md>a <b> & c</md></div>`))).ast;
    let host = null;
    const walk = (n) => {
      if (!n || typeof n !== "object") return;
      if (Array.isArray(n)) return n.forEach(walk);
      if (n._mdHost === true) host = n;
      for (const k of Object.keys(n)) if (k !== "span") walk(n[k]);
    };
    walk(ast);
    expect(host).not.toBeNull();
    expect(host.tag).toBe("div");
    const p = host.children.find((c) => c.kind === "markup" && c.tag === "p");
    expect(p.children[0]._mdText).toBe("a <b> & c");
    expect(p.children[0].value).toBe("a &lt;b&gt; &amp; c");
  });
});
