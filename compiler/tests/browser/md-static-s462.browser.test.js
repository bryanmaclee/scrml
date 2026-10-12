/**
 * SPEC §67 phase 2 (S462) — a static `<md>` EXECUTED in happy-dom.
 * change-id: s462-md-phase2.
 *
 * Each case compiles a realistic `<md>` page, mounts the emitted body, runs the PRUNED runtime
 * the build ships plus the client bundle, and reads the LIVE DOM:
 *   - the tree under the host is exactly the §67.6 closed element set (MD-SAFE);
 *   - `${…}` slots are text-only and reactive (ruling S462 `<md>` F1 "a");
 *   - a `${HOME:-/tmp}` in a fence compiles and shows literally (§67.2 / §67.4: inert in code);
 *   - hostile slot values (`**x**`, `<img onerror>`, `[a](javascript:…)`, `\n## heading`) render as
 *     text, never as structure, and nothing runs;
 *   - a data-led `href` whose value is `javascript:` is written `about:blank` (§5.2 rule 3);
 *   - `<md>` in an `if=` gate, an `<each>` row, a `<match>` arm and a component body.
 * The Chromium twin is md-static-chromium-s462.browser.test.js.
 */

import { describe, test, expect } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

if (!globalThis.document) GlobalRegistrator.register();

const tmpRoot = resolve(tmpdir(), "scrml-md-static-s462");

function compileAndMount(source, baseName = "app") {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const tmpDir = resolve(tmpRoot, `case-${uniq}`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  const tmpInput = resolve(tmpDir, `${baseName}.scrml`);
  writeFileSync(tmpInput, source);
  const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir, log: () => {} });
  const errors = (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error").map((e) => e.code);
  if (errors.length > 0) return { errors };
  const html = readFileSync(resolve(outDir, `${baseName}.html`), "utf8");
  const clientJs = readFileSync(resolve(outDir, `${baseName}.client.js`), "utf8");
  const runtimeJs = readFileSync(resolve(outDir, result.runtimeFilename ?? "scrml-runtime.js"), "utf8");
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const bodyHtml = (bodyMatch ? bodyMatch[1] : html).replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").trim();
  globalThis.__md_pwned = 0;
  document.body.innerHTML = bodyHtml;
  const exec = new Function(
    "window",
    "document",
    `${runtimeJs}\n` + captureInsideChunkScope(
      clientJs,
      `globalThis.__md_set = typeof _scrml_cs_reactive_set === "function" ? _scrml_cs_reactive_set : _scrml_reactive_set;\n`,
    ),
  );
  exec(window, document);
  document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
  return { errors, clientJs, html };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const set = (name, v) => globalThis.__md_set(name, v);

/** The §67.6 element set (plus `div`, the host). */
const MD_ELEMENTS = new Set([
  "div", "p", "em", "strong", "del", "blockquote", "ul", "ol", "li", "hr", "br", "pre", "code",
  "table", "thead", "tbody", "tr", "th", "td", "h1", "h2", "h3", "h4", "h5", "h6", "a", "img",
]);
const MD_ATTRS = {
  div: ["class", "id", "style"], ol: ["start"], th: ["style"], td: ["style"],
  h1: ["id"], h2: ["id"], h3: ["id"], h4: ["id"], h5: ["id"], h6: ["id"],
  code: ["class"], a: ["href", "title"], img: ["src", "alt", "title"],
};

/**
 * A compact serialization of an md subtree: elements as `tag[attr=v]{children}`, text as `"…"`.
 * A slot's binding placeholder (`span[data-scrml-logic]`, the §7.4.2 interpolation site) and the
 * compiler's binding attributes are transparent — they are the interpolation, not md output.
 */
function tree(node) {
  if (node.nodeType === 3) return JSON.stringify(node.nodeValue);
  if (node.nodeType !== 1) return "";
  const tag = node.tagName.toLowerCase();
  // adjacent text nodes are one run (the HTML parser merges them; a DOM builder may not)
  const kids = [];
  let run = null;
  for (const c of node.childNodes) {
    if (c.nodeType === 3) { run = (run ?? "") + c.nodeValue; continue; }
    if (run !== null) { kids.push(JSON.stringify(run)); run = null; }
    const s = tree(c);
    if (s !== "") kids.push(s);
  }
  if (run !== null) kids.push(JSON.stringify(run));
  if (tag === "span" && node.hasAttribute("data-scrml-logic")) return kids.join(",");
  const attrs = [...node.attributes]
    .filter((a) => !a.name.startsWith("data-scrml"))
    .map((a) => `${a.name}=${a.value}`)
    .sort();
  return `${tag}${attrs.length ? "[" + attrs.join(" ") + "]" : ""}{${kids.join(",")}}`;
}

/** Every element under `root` is in the closed set with only its listed attributes. */
function assertClosedSet(root) {
  const walk = (el) => {
    const tag = el.tagName.toLowerCase();
    if (tag === "span" && el.hasAttribute("data-scrml-logic")) {
      for (const c of el.children) walk(c);
      return;
    }
    expect(MD_ELEMENTS.has(tag)).toBe(true);
    for (const a of el.attributes) {
      if (a.name.startsWith("data-scrml")) continue;
      expect([tag, a.name, (MD_ATTRS[tag] ?? []).includes(a.name)]).toEqual([tag, a.name, true]);
    }
    for (const c of el.children) walk(c);
  };
  walk(root);
}

describe("§67.6 — the live DOM is the closed element set", () => {
  test("a realistic page renders the expected tree", async () => {
    const r = compileAndMount(`<program>
<article>
    <md id="doc" class="prose">
        ## Filing a good bug report

        Before you file, **search the board**. Duplicates get *closed*.

        - Say what you *expected*.
        - Paste the error in \`backticks\`.

        1. one
        2. two

        > quoted

        | a | b |
        | :- | -: |
        | 1 | 2 |

        \`\`\`sh
        echo \${HOME:-/tmp}
        \`\`\`

        Line one\\
        line two ~~gone~~ [docs](/docs "Docs") ![logo](/l.png)
    </md>
</article>
</program>`);
    expect(r.errors).toEqual([]);
    await flush();
    const host = document.getElementById("doc");
    assertClosedSet(host);
    expect(tree(host)).toBe(
      `div[class=prose id=doc]{"\\n",` +
      `h2[id=filing-a-good-bug-report]{"Filing a good bug report"},"\\n",` +
      `p{"Before you file, ",strong{"search the board"},". Duplicates get ",em{"closed"},"."},"\\n",` +
      `ul{"\\n",li{"Say what you ",em{"expected"},"."},"\\n",li{"Paste the error in ",code{"backticks"},"."},"\\n"},"\\n",` +
      `ol{"\\n",li{"one"},"\\n",li{"two"},"\\n"},"\\n",` +
      `blockquote{"\\n",p{"quoted"},"\\n"},"\\n",` +
      `table{thead{tr{th[style=text-align:left]{"a"},th[style=text-align:right]{"b"}}},tbody{tr{td[style=text-align:left]{"1"},td[style=text-align:right]{"2"}}}},"\\n",` +
      `pre{code[class=language-sh]{"echo \${HOME:-/tmp}\\n"}},"\\n",` +
      `p{"Line one",br{},"\\nline two ",del{"gone"}," ",a[href=/docs title=Docs]{"docs"}," ",img[alt=logo src=/l.png]{}},"\\n"}`,
    );
  });
});

describe("§67.4 — slots are text-only and reactive", () => {
  test("a slot updates when its cell changes; the structure never does", async () => {
    const r = compileAndMount(`<program>
<who> = "Ann"
<div id="w">
    <md>
        ## Hello \${@who}

        **\${@who}** wrote this.
    </md>
</div>
</program>`);
    expect(r.errors).toEqual([]);
    await flush();
    const host = document.querySelector("#w > div");
    expect(host.querySelector("h2").textContent).toBe("Hello Ann");
    expect(host.querySelector("strong").textContent).toBe("Ann");
    set("who", "Bob");
    await flush();
    expect(host.querySelector("h2").textContent).toBe("Hello Bob");
    expect(host.querySelector("strong").textContent).toBe("Bob");
    assertClosedSet(host);
  });

  test("hostile values render as text, never as structure, and nothing runs", async () => {
    const r = compileAndMount(`<program>
<v> = "start"
<div id="w">
    <md>
        Value: \${@v}

        **bold \${@v}** and [link \${@v}](/x)
    </md>
</div>
</program>`);
    expect(r.errors).toEqual([]);
    await flush();
    const host = document.querySelector("#w > div");
    const before = tree(host);
    const hostile = [
      "**x**",
      `<img src=x onerror="globalThis.__md_pwned=1">`,
      "[a](javascript:globalThis.__md_pwned=2)",
      "line\n## heading\n- item",
      "<script>globalThis.__md_pwned=3</script>",
    ];
    for (const v of hostile) {
      set("v", v);
      await flush();
      const p = host.querySelector("p");
      expect(p.textContent).toBe("Value: " + v);
      expect(host.querySelectorAll("img, script, h1, h2, h3, li, ul").length).toBe(0);
      expect(host.querySelectorAll("a").length).toBe(1);
      expect(host.querySelector("a").getAttribute("href")).toBe("/x");
      expect(host.querySelector("strong").textContent).toBe("bold " + v);
      assertClosedSet(host);
    }
    // the shape is the shape the literal text gave, value aside
    expect(tree(host).replace(/"[^"]*"/g, "T")).toBe(before.replace(/"[^"]*"/g, "T"));
    await flush();
    expect(globalThis.__md_pwned).toBe(0);
  });

  test("a data-led href holding `javascript:` is written about:blank (§5.2 rule 3)", async () => {
    const r = compileAndMount(`<program>
<u> = "/safe"
<div id="w">
    <md>
        [go](\${@u}) and [user](/users/\${@u})
    </md>
</div>
</program>`);
    expect(r.errors).toEqual([]);
    await flush();
    const links = () => [...document.querySelectorAll("#w a")];
    expect(links()[0].getAttribute("href")).toBe("/safe");
    set("u", "javascript:globalThis.__md_pwned=9");
    await flush();
    expect(links()[0].getAttribute("href")).toBe("about:blank");
    // a literal prefix that proves a relative path cannot be turned into a scheme
    expect(links()[1].getAttribute("href")).toBe("/users/javascript:globalThis.__md_pwned=9");
    set("u", "https://example.com/");
    await flush();
    expect(links()[0].getAttribute("href")).toBe("https://example.com/");
  });
});

describe("emitter positions", () => {
  test("if= gate, <each> rows, a <match> arm and a component body", async () => {
    const r = compileAndMount(`<program>
type Phase:enum = { Idle, Ready }
<phase>: Phase = .Idle
<on> = false
<rows> = [{ id: 1, name: "**a**" }, { id: 2, name: "<b>b</b>" }]
const Card = <section class="card" props={ title: string }>
    <md>
        ### \${title}

        Card *body*.
    </md>
</section>
<div id="gate" if=@on>
    <md>
        ## Gated
    </md>
</div>
<ul id="rows">
    <each in=@rows key=@.id>
        <li>
            <md>
                **Row** \${@.name} and
                more
            </md>
        </li>
    </each>
</ul>
<div id="arm">
    <match for=Phase on=@phase>
        <Idle><p>idle</p></>
        <Ready>
            <div>
                <md>
                    ## Ready *now*
                </md>
            </div>
        </>
    </match>
</div>
<Card title="One"/>
<Card title="Two"/>
<button id="flip" onclick=\${ @on = true; @phase = .Ready }>go</button>
</program>`);
    expect(r.errors).toEqual([]);
    await flush();
    // each rows: text nodes; the soft break is kept; the value is text
    const lis = [...document.querySelectorAll("#rows li")];
    expect(lis.length).toBe(2);
    expect(lis[0].querySelector("strong").textContent).toBe("Row");
    expect(lis[0].querySelector("p").textContent).toBe("Row **a** and\nmore");
    expect(lis[1].querySelector("p").textContent).toBe("Row <b>b</b> and\nmore");
    expect(document.querySelectorAll("#rows b").length).toBe(0);
    for (const li of lis) assertClosedSet(li.querySelector("div"));
    // components: one heading per instance, distinct ids
    const cards = [...document.querySelectorAll("section.card")];
    expect(cards.map((c) => c.querySelector("h3").textContent)).toEqual(["One", "Two"]);
    expect(new Set(cards.map((c) => c.querySelector("h3").id)).size).toBe(2);
    expect(cards[0].querySelector("p").innerHTML).toBe("Card <em>body</em>.");
    // gate + arm
    expect(document.querySelector("#gate h2")).toBeNull();
    document.getElementById("flip").click();
    await flush();
    await flush();
    expect(document.querySelector("#gate h2")?.textContent).toBe("Gated");
    expect(document.querySelector("#arm h2")?.innerHTML).toBe("Ready <em>now</em>");
    assertClosedSet(document.querySelector("#arm h2").parentElement);
  });
});

// S465 review round 2, finding 1 — a component's `<md>` TEXT slot used inside an `<each>` row.
// The component body re-parses through the legacy BS+TAB path (it holds an `<md>`), whose
// bare-expr carries its source text in `expr`; the CE substituted only `exprNode`, and the row
// emitter reads a non-empty `expr` first, so every row emitted `String(t)` — a ReferenceError,
// an empty list, exit 0. Each case below reads the LIVE rows.
describe("review round 2 — a component's <md> text slot inside <each>", () => {
  test("a literal prop", async () => {
    const r = compileAndMount(`<program>
<rows> = [{ id: 1 }, { id: 2 }]
const Row = <div props={ t: string }>
    <md>
        **\${t}** done
    </md>
</div>
<div id="w">
    <each in=@rows key=@.id>
        <Row t="literal"/>
    </each>
</div>
</program>`);
    expect(r.errors).toEqual([]);
    expect(r.clientJs).not.toMatch(/String\(t\)/);
    await flush();
    const ps = [...document.querySelectorAll("#w p")];
    expect(ps.map((p) => p.innerHTML)).toEqual(["<strong>literal</strong> done", "<strong>literal</strong> done"]);
  });

  test("a row-bound prop is the row's value, is text, and follows the rows", async () => {
    const r = compileAndMount(`<program>
<rows> = [{ id: 1, t: "**a**" }, { id: 2, t: "<img src=x onerror=globalThis.__md_pwned=1>" }]
const Row = <div props={ t: string }>
    <md>
        **\${t}** done
    </md>
</div>
<div id="w">
    <each in=@rows key=@.id>
        <Row t=@.t/>
    </each>
</div>
</program>`);
    expect(r.errors).toEqual([]);
    await flush();
    const strongs = () => [...document.querySelectorAll("#w strong")].map((s) => s.textContent);
    expect(strongs()).toEqual(["**a**", "<img src=x onerror=globalThis.__md_pwned=1>"]);
    expect(document.querySelectorAll("#w img").length).toBe(0);
    expect(globalThis.__md_pwned).toBe(0);
    set("rows", [{ id: 3, t: "c" }]);
    await flush();
    expect(strongs()).toEqual(["c"]);
  });

  test("two slots in one component", async () => {
    const r = compileAndMount(`<program>
<rows> = [{ id: 1, a: "x", b: "y" }]
const Row = <div props={ a: string, b: string }>
    <md>
        \${a} *and* \${b}
    </md>
</div>
<div id="w">
    <each in=@rows key=@.id>
        <Row a=@.a b="lit"/>
    </each>
</div>
</program>`);
    expect(r.errors).toEqual([]);
    await flush();
    expect(document.querySelector("#w p").innerHTML).toBe("x <em>and</em> lit");
  });

  test("a heading and a list item", async () => {
    const r = compileAndMount(`<program>
<rows> = [{ id: 1, t: "One", u: "first" }, { id: 2, t: "Two", u: "second" }]
const Row = <section props={ t: string, u: string }>
    <md>
        ## \${t}

        - item \${u}
        - plain
    </md>
</section>
<div id="w">
    <each in=@rows key=@.id>
        <Row t=@.t u=@.u/>
    </each>
</div>
</program>`);
    expect(r.errors).toEqual([]);
    await flush();
    expect([...document.querySelectorAll("#w h2")].map((h) => h.textContent)).toEqual(["One", "Two"]);
    expect([...document.querySelectorAll("#w li")].map((li) => li.textContent)).toEqual(["item first", "plain", "item second", "plain"]);
    for (const s of document.querySelectorAll("#w section")) assertClosedSet(s.querySelector("h2").parentElement);
  });

  test("a nested component carries the prop through", async () => {
    const r = compileAndMount(`<program>
<rows> = [{ id: 1, t: "deep" }]
const Inner = <div props={ v: string }>
    <md>
        inner **\${v}**
    </md>
</div>
const Outer = <article props={ t: string }>
    <Inner v=t/>
</article>
<div id="w">
    <each in=@rows key=@.id>
        <Outer t=@.t/>
    </each>
</div>
</program>`);
    expect(r.errors).toEqual([]);
    await flush();
    expect(document.querySelector("#w article p")?.innerHTML).toBe("inner <strong>deep</strong>");
  });

  test("the same defect outside <md>: a template literal in a component body (legacy re-parse)", async () => {
    const r = compileAndMount(`<program>
<rows> = [{ id: 1 }]
const Row = <div props={ t: string }>
    <p><b>\${t}</b> \${\`[\${t}]\`}</p>
</div>
<div id="w">
    <each in=@rows key=@.id>
        <Row t="lit"/>
    </each>
</div>
</program>`);
    expect(r.errors).toEqual([]);
    await flush();
    // (the inter-interpolation space is the row emitter's existing whitespace rule, not this defect)
    expect(document.querySelector("#w p b")?.textContent).toBe("lit");
    expect(document.querySelector("#w p")?.textContent).toMatch(/^lit ?\[lit\]$/);
  });
});
