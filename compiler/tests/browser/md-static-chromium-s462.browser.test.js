/**
 * SPEC §67 phase 2 (S462) — a static `<md>` page in a REAL browser (Playwright Chromium).
 * change-id: s462-md-phase2.
 *
 * The happy-dom twin (md-static-s462.browser.test.js) pins the tree and the reactivity; this file
 * repeats the safety-relevant half in Chromium, whose HTML parser and URL handling are the real
 * ones: the emitted page is loaded from disk, inputs are real clicks, and execution is detected by
 * a page-global flag and by any dialog. It pins:
 *   - the static HTML parses to the §67.6 tree (no element is reparented, nothing from the body is
 *     an element: `<b>` / `<img onerror>` typed in the body are text);
 *   - a fence holding `${HOME:-/tmp}` shows it literally;
 *   - hostile slot values (`**x**`, `<img onerror>`, `[a](javascript:…)`, `\n## heading`) render as
 *     text and nothing runs;
 *   - a data-led href set to `javascript:` is written `about:blank`, and clicking it runs nothing.
 *
 * Skipped (with a note) when Chromium cannot be launched on this machine.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { resolve } from "path";
import { writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { pathToFileURL } from "url";
import { compileScrml } from "../../src/api.js";

let chromium = null;
try {
  ({ chromium } = await import("playwright"));
} catch {
  chromium = null;
}

let browser = null;
let launchError = null;

beforeAll(async () => {
  if (!chromium) { launchError = "playwright not installed"; return; }
  try {
    browser = await chromium.launch();
  } catch (e) {
    launchError = String(e?.message ?? e).split("\n")[0];
  }
});

afterAll(async () => {
  if (browser) await browser.close();
});

const tmpRoot = resolve(tmpdir(), "scrml-md-chromium-s462");

function build(source) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const dir = resolve(tmpRoot, `case-${uniq}`);
  const outDir = resolve(dir, "out");
  mkdirSync(dir, { recursive: true });
  const input = resolve(dir, "app.scrml");
  writeFileSync(input, source);
  const r = compileScrml({ inputFiles: [input], write: true, outputDir: outDir, log: () => {} });
  const errors = (r.errors ?? []).filter((e) => (e.severity ?? "error") === "error").map((e) => e.code);
  return { errors, url: pathToFileURL(resolve(outDir, "app.html")).href };
}

async function open(url) {
  const page = await browser.newPage();
  const dialogs = [];
  page.on("dialog", async (d) => { dialogs.push(d.message()); await d.dismiss(); });
  await page.goto(url);
  await page.waitForLoadState("load");
  return { page, dialogs };
}

/** The compact tree serializer (same as the happy-dom twin), evaluated in the page. */
const TREE_FN = `(root) => {
  const tree = (node) => {
    if (node.nodeType === 3) return JSON.stringify(node.nodeValue);
    if (node.nodeType !== 1) return "";
    const tag = node.tagName.toLowerCase();
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
    const attrs = [...node.attributes].filter((a) => !a.name.startsWith("data-scrml")).map((a) => a.name + "=" + a.value).sort();
    return tag + (attrs.length ? "[" + attrs.join(" ") + "]" : "") + "{" + kids.join(",") + "}";
  };
  return tree(root);
}`;

const ready = () => browser !== null;

describe("Chromium — static <md>", () => {
  test("the page parses to the §67.6 tree; typed HTML and a shell fence show as text", async () => {
    if (!ready()) { console.warn(`[md-chromium] skipped: ${launchError}`); return; }
    const { errors, url } = build(`<program>
<article>
    <md id="doc">
        ## Typed <b>HTML</b> &amp; entities

        Text with <img src=x onerror="window.__md_pwned=1"> in it.

        \`\`\`sh
        echo \${HOME:-/tmp} && test "$a" < b
        \`\`\`

        - [docs](/docs)
    </md>
</article>
</program>`);
    expect(errors).toEqual([]);
    const { page, dialogs } = await open(url);
    const t = await page.evaluate(`(${TREE_FN})(document.getElementById("doc"))`);
    expect(t).toBe(
      `div[id=doc]{"\\n",` +
      `h2[id=typed-bhtmlb-amp-entities]{"Typed <b>HTML</b> &amp; entities"},"\\n",` +
      `p{"Text with <img src=x onerror=\\"window.__md_pwned=1\\"> in it."},"\\n",` +
      `pre{code[class=language-sh]{"echo \${HOME:-/tmp} && test \\"$a\\" < b\\n"}},"\\n",` +
      `ul{"\\n",li{a[href=/docs]{"docs"}},"\\n"},"\\n"}`,
    );
    expect(await page.evaluate(`document.querySelectorAll("#doc img, #doc b").length`)).toBe(0);
    expect(await page.evaluate(`window.__md_pwned ?? 0`)).toBe(0);
    expect(dialogs).toEqual([]);
    await page.close();
  });

  test("review MED-B: a `${` in a code span shows literally (§67.4 inert) beside a live slot", async () => {
    if (!ready()) { console.warn(`[md-chromium] skipped: ${launchError}`); return; }
    const { errors, url } = build(`<program>
<who> = "Ann"
<article>
    <md id="doc">
        ## Use \`\${x}\` here

        Write \`\${name}\` or \`\`\${ "}" }\`\` — hello \${@who}.
    </md>
</article>
</program>`);
    expect(errors).toEqual([]);
    const { page, dialogs } = await open(url);
    const t = await page.evaluate(`(${TREE_FN})(document.getElementById("doc"))`);
    expect(t).toContain(`h2[id=use-x-here]{"Use ",code{"\${x}"}," here"}`);
    expect(t).toContain(`code{"\${name}"}`);
    expect(t).toContain(`code{"\${ \\"}\\" }"}`);
    expect(await page.evaluate(`document.getElementById("doc").textContent.includes("hello Ann.")`)).toBe(true);
    expect(dialogs).toEqual([]);
    await page.close();
  });

  test("dog-food: a published-draft article (samples/md-article-browser-language.scrml) renders as its markdown", async () => {
    if (!ready()) { console.warn(`[md-chromium] skipped: ${launchError}`); return; }
    const { readFileSync } = await import("fs");
    const sample = readFileSync(resolve(import.meta.dir, "../../../samples/md-article-browser-language.scrml"), "utf8");
    const { errors, url } = build(sample);
    expect(errors).toEqual([]);
    const { page, dialogs } = await open(url);
    const r = await page.evaluate(`(() => {
      const host = document.querySelector("article > div");
      const n = (s) => host.querySelectorAll(s).length;
      return {
        counts: [n("p"), n("em"), n("strong"), n("h2"), n("h3"), n("code"), n("blockquote"), n("ul"), n("li"), n("a")],
        sql: [...host.querySelectorAll("code")].map((c) => c.textContent).find((t) => t.includes("SELECT")),
        input: [...host.querySelectorAll("code")].map((c) => c.textContent).includes("<input>"),
        outside: host.querySelectorAll("*:not(p):not(em):not(strong):not(h2):not(h3):not(code):not(blockquote):not(ul):not(li):not(a)").length,
      };
    })()`);
    // the same element counts CommonMark (marked) gives this text
    expect(r.counts).toEqual([27, 5, 4, 5, 6, 35, 2, 1, 3, 3]);
    expect(r.sql).toBe("?{SELECT * FROM users WHERE id = ${@id}}.get()");
    expect(r.input).toBe(true);
    expect(r.outside).toBe(0);
    expect(dialogs).toEqual([]);
    await page.close();
  });

  test("hostile slot values are text; a data-led javascript: href is about:blank and runs nothing", async () => {
    if (!ready()) { console.warn(`[md-chromium] skipped: ${launchError}`); return; }
    const LT = "String.fromCharCode(60)";
    const { errors, url } = build(`<program>
<v> = "start"
<u> = "/safe"
<div id="w">
    <md>
        Value: \${@v}

        **\${@v}** and [go](\${@u})
    </md>
</div>
<button id="b1" onclick=\${ @v = "**x** [a](javascript:alert(1))" }>1</button>
<button id="b2" onclick=\${ @v = ${LT} + "img src=x onerror=alert(2)>" }>2</button>
<button id="b3" onclick=\${ @v = "line" + String.fromCharCode(10) + "## heading" + String.fromCharCode(10) + "- item" }>3</button>
<button id="b4" onclick=\${ @u = "javascript:alert(4)" }>4</button>
<button id="b5" onclick=\${ @u = "JaVaScRiPt:alert(5)" }>5</button>
</program>`);
    expect(errors).toEqual([]);
    const { page, dialogs } = await open(url);
    const para = () => page.evaluate(`document.querySelector("#w p").textContent`);
    const structure = () => page.evaluate(`document.querySelectorAll("#w img, #w h1, #w h2, #w li, #w ul, #w script").length`);
    expect(await para()).toBe("Value: start");

    await page.click("#b1");
    expect(await para()).toBe("Value: **x** [a](javascript:alert(1))");
    expect(await page.evaluate(`document.querySelectorAll("#w a").length`)).toBe(1);
    expect(await page.evaluate(`document.querySelector("#w strong").textContent`)).toBe("**x** [a](javascript:alert(1))");

    await page.click("#b2");
    expect(await para()).toBe("Value: <img src=x onerror=alert(2)>");
    expect(await structure()).toBe(0);

    await page.click("#b3");
    expect(await para()).toBe("Value: line\n## heading\n- item");
    expect(await structure()).toBe(0);

    expect(await page.evaluate(`document.querySelector("#w a").getAttribute("href")`)).toBe("/safe");
    await page.click("#b4");
    expect(await page.evaluate(`document.querySelector("#w a").getAttribute("href")`)).toBe("about:blank");
    await page.click("#b5");
    expect(await page.evaluate(`document.querySelector("#w a").getAttribute("href")`)).toBe("about:blank");
    await page.click("#w a");
    await page.waitForTimeout(100);
    expect(dialogs).toEqual([]);
    await page.close();
  });
});
