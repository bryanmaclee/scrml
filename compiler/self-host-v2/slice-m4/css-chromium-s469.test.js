// css-chromium-s469.test.js — s469-boot-css round 2: what the bootstrap's `#{}` CSS DOES in a REAL
// browser (Chromium, via puppeteer). happy-dom cannot answer it: it ignores `@layer`, and it lets a
// scoped rule match the `@scope` root, which a real browser does not (inside `@scope` a selector is
// relative to `:scope` as a DESCENDANT — `.card { … }` never matches the component's own root;
// measured, Chromium 152).
//
// OPT-IN. It needs a Chromium binary, which CI and the pre-commit hook do not provide, so it runs only
// with SCRML_BROWSER_TESTS=1 (binary: $SCRML_CHROMIUM, else /usr/bin/chromium). Recorded run:
// docs/changes/s469-boot-css/progress.md ("Chromium run").
//
//   SCRML_BROWSER_TESTS=1 bun test slice-m4/css-chromium-s469.test.js      (from compiler/self-host-v2)
//
// Rulings: user-voice-scrml.md S469 (scrml-support 0908198) "Scope root — Yes, include the root" (a
// component's `#{}` styles its own root as well as its subtree, pinned by a real-browser check);
// §9.1 DQ-7 (the donut); §65.5 (component scope beats the program-global layer).

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadM2, frontEnd } from "./harness.js";

const ON = process.env.SCRML_BROWSER_TESTS === "1";
const BIN = process.env.SCRML_CHROMIUM || "/usr/bin/chromium";
const RUNTIME = join(import.meta.dir, "..", "slice-m1", "runtime", "runtime.js");

const suite = ON ? describe : describe.skip;

let mods, browser, server, dir;
beforeAll(async () => {
  if (!ON) return;
  if (!existsSync(BIN)) throw new Error(`SCRML_BROWSER_TESTS=1 but no Chromium at ${BIN} (set SCRML_CHROMIUM)`);
  ({ mods } = loadM2());
  dir = mkdtempSync(join(tmpdir(), "s469-css-chromium-"));
  copyFileSync(RUNTIME, join(dir, "scrml-runtime.js"));
  server = Bun.serve({ port: 0, fetch: (req) => {
    const p = new URL(req.url).pathname;
    if (p === "/favicon.ico") return new Response("", { status: 204 });
    const f = Bun.file(join(dir, p.slice(1)));
    return new Response(f, { headers: { "content-type": p.endsWith(".js") ? "text/javascript" : "text/html" } });
  } });
  const { default: puppeteer } = await import("puppeteer");
  browser = await puppeteer.launch({ executablePath: BIN, headless: true, args: ["--no-sandbox"] });
}, { timeout: 180000 });
afterAll(async () => {
  if (browser) await browser.close();
  if (server) server.stop(true);
  if (dir) rmSync(dir, { recursive: true, force: true });
});

let seq = 0;
/** Compile `src` (clean), serve it, open it; returns the page. */
async function open(src) {
  const r = frontEnd(mods, [{ path: "c.scrml", src }]);
  expect(r.diags.map((d) => `${d.code}: ${d.message}`)).toEqual([]);
  const name = `p${seq++}`;
  const out = mods.print.printProgram(r.core, `${name}.client.js`, "scrml-runtime.js");
  writeFileSync(join(dir, `${name}.html`), out.html);
  writeFileSync(join(dir, `${name}.client.js`), out.js);
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  page.on("requestfailed", (q) => errors.push("request failed: " + q.url()));
  await page.goto(`http://localhost:${server.port}/${name}.html`);
  try {
    await page.waitForFunction(() => document.body.children.length > 0, { timeout: 10000 });
  } catch (e) {
    throw new Error("the page never rendered: " + JSON.stringify(errors) + " " + (await page.content()).slice(-600));
  }
  expect(errors).toEqual([]);
  return page;
}
const style = (page, sel, prop) => page.evaluate((s, p) => getComputedStyle(document.querySelector(s))[p], sel, prop);

const CARDS = `<program>
    #{ .hit { color: rgb(255, 0, 0); } p { margin-left: 3px; } }
    <inner k:string/>
    renders <div class="hit inner" id="inner-root"><p class="hit" id="inner-p">\${k}</p></div>
    <card k:string/>
    renders <div class="card hit" id="card-root">
        #{
            .card { padding-top: 16px; }
            .card > h2 { color: rgb(0, 128, 0); }
            .hit { color: rgb(0, 0, 255); }
            * { outline-color: rgb(1, 2, 3); }
            .card::before { content: "b"; }
        }
        <h2 id="h2">\${k}</h2>
        <p class="hit" id="own">own</p>
        <inner k="i"/>
    </div>
    <main>
        <card k="c"/>
        <p class="hit" id="page">page</p>
    </main>
</program>
`;

suite("Chromium — a component's `#{}` styles its own root and subtree, inside the donut", () => {
  test("the root itself: `.card` / `.hit` / `*` / `::before` reach the component root", async () => {
    const page = await open(CARDS);
    expect(await style(page, "#card-root", "paddingTop")).toBe("16px");
    expect(await style(page, "#card-root", "color")).toBe("rgb(0, 0, 255)");
    expect(await style(page, "#card-root", "outlineColor")).toBe("rgb(1, 2, 3)");
    expect(await page.evaluate(() => getComputedStyle(document.querySelector("#card-root"), "::before").content)).toBe('"b"');
    await page.close();
  });
  test("the subtree: a child of the root; the component rule beats the program-global layer (§65.5)", async () => {
    const page = await open(CARDS);
    expect(await style(page, "#h2", "color")).toBe("rgb(0, 128, 0)");
    expect(await style(page, "#own", "color")).toBe("rgb(0, 0, 255)");
    await page.close();
  });
  test("the donut: a nested component's root and subtree are NOT the parent's; the page is not either", async () => {
    const page = await open(CARDS);
    // the global `.hit` (red) applies there; the card's `.hit` (blue) does not
    expect(await style(page, "#inner-root", "color")).toBe("rgb(255, 0, 0)");
    expect(await style(page, "#inner-p", "color")).toBe("rgb(255, 0, 0)");
    expect(await style(page, "#page", "color")).toBe("rgb(255, 0, 0)");
    expect(await style(page, "#inner-root", "outlineColor")).not.toBe("rgb(1, 2, 3)");
    // the program-global layer applies at all (happy-dom cannot show this)
    expect(await style(page, "#page", "marginLeft")).toBe("3px");
    await page.close();
  });
  test("a flat block's inline style, and the §25.7 bridge following a write", async () => {
    const page = await open(`<program>
    let <accent:string="teal"/>
    <chip k:string/>
    renders <span id="chip">#{ border-left-width: 4px; border-left-style: solid; }\${k}</span>
    #{ #x { color: @accent; } }
    <main>
        <chip k="c"/>
        <p id="x">x</p>
        <button id="go" onclick=(@accent = "rgb(1, 2, 3)")>go</button>
    </main>
</program>
`);
    expect(await style(page, "#chip", "borderLeftWidth")).toBe("4px");
    expect(await style(page, "#x", "color")).toBe("rgb(0, 128, 128)");
    await page.click("#go");
    expect(await style(page, "#x", "color")).toBe("rgb(1, 2, 3)");
    await page.close();
  });
});
