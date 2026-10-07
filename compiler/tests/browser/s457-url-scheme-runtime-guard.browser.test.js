/**
 * s457-url-scheme-runtime-guard.browser.test.js — MOUNTED (happy-dom) acceptance for SPEC §5.2
 * rule 3 (bryan's S457 ruling "a now with c discussed for later"): a URL attribute whose scheme the
 * DATA supplies is judged on EVERY write, reactive re-writes included. A cell starts safe, is changed
 * to a `javascript:` URL (the attribute must become `about:blank` and one report must reach the
 * logging surface), then back to a safe URL (the attribute must follow it).
 *
 * The page is compiled, the SHIPPED pruned runtime (`result.runtimeFilename`) is mounted with the
 * client chunk, and the DOM is read — grepping the emission would not prove the guard is on the path
 * the browser takes. Positions: top level (expression and quoted forms), an `<each>` row, and an
 * expanded component instance.
 */

import { test, expect, beforeEach, afterEach, afterAll } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve, join } from "path";
import { tmpdir } from "os";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync, mkdtempSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

beforeEach(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
  await GlobalRegistrator.register();
});
afterEach(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});
afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

function mount(source) {
  const tmpDir = mkdtempSync(join(tmpdir(), "s457-urlguard-"));
  const outDir = resolve(tmpDir, "out");
  mkdirSync(outDir, { recursive: true });
  const input = resolve(tmpDir, "app.scrml");
  writeFileSync(input, source);
  try {
    const r = compileScrml({ inputFiles: [input], write: true, outputDir: outDir, log: () => {} });
    const rd = (f) => (existsSync(resolve(outDir, f)) ? readFileSync(resolve(outDir, f), "utf8") : "");
    const errs = (r.errors ?? []).filter((e) => (e.severity ?? "error") === "error").map((e) => e.code);
    const html = rd("app.html");
    const body = (html.match(/<body[^>]*>([\s\S]*?)<\/body>/i) || [, html])[1]
      .replace(/<script[^>]*>[\s\S]*?<\/script>/g, "");
    document.body.innerHTML = body;
    const logs = [];
    const origErr = console.error;
    console.error = (...a) => { logs.push(a.map(String).join(" ")); };
    try {
      new Function("window", "document",
        `${rd(r.runtimeFilename ?? "scrml-runtime.js")}\n` +
        captureInsideChunkScope(rd("app.client.js"),
          "globalThis.__get = _scrml_reactive_get;\nglobalThis.__set = _scrml_reactive_set;\n"),
      )(globalThis.window, globalThis.document);
      document.dispatchEvent(new window.Event("DOMContentLoaded", { bubbles: true }));
    } finally {
      console.error = origErr;
    }
    return {
      errs,
      logs,
      clientJs: rd("app.client.js"),
      /** Write a cell with console.error captured into `logs`. */
      set: async (name, v) => {
        const o = console.error;
        console.error = (...a) => { logs.push(a.map(String).join(" ")); };
        try {
          globalThis.__set(name, v);
          await new Promise((r) => setTimeout(r, 10));
        } finally { console.error = o; }
      },
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

const EVIL = "javascript:alert(1)";

async function cycle(app, cell, read, safeA, safeB, evilValue = EVIL) {
  expect(app.errs).toEqual([]);
  expect(read()).toBe(safeA);
  expect(app.logs.length).toBe(0);
  await app.set(cell, evilValue);
  expect(read()).toBe("about:blank");
  const reports = app.logs.filter((l) => l.includes("url-guard"));
  expect(reports.length).toBeGreaterThan(0);
  for (const l of reports) expect(l).not.toContain("alert(1)");
  await app.set(cell, safeB);
  expect(read()).toBe(safeB);
}

test("top level — expression form `href=${@u}`: safe → javascript: → safe", async () => {
  const app = mount(`<program>\n<u> = "/start"\n<a id="l" href=\${@u}>go</a>\n</program>\n`);
  await cycle(app, "u", () => document.getElementById("l").getAttribute("href"), "/start", "https://ok.example/");
});

test("top level — quoted form `href=\"${@u}\"`: safe → JaVa<TAB>ScRiPt: → safe", async () => {
  const app = mount(`<program>\n<u> = "/start"\n<a id="l" href="\${@u}">go</a>\n</program>\n`);
  await cycle(app, "u", () => document.getElementById("l").getAttribute("href"), "/start", "mailto:a@b.c", " JaVa\tScRiPt:alert(1)");
});

test("<img src=${@u}>: a raster data:image is admitted on an image source, data:text/html is not", async () => {
  const app = mount(`<program>\n<u> = "data:image/png;base64,AAAA"\n<img id="i" src=\${@u}/>\n</program>\n`);
  await cycle(app, "u", () => document.getElementById("i").getAttribute("src"), "data:image/png;base64,AAAA", "/pic.png", "data:text/html,<script>alert(1)</script>");
});

test("<each> row — `href=\"${it.url}\"` re-written when the list changes", async () => {
  const app = mount(`<program>
<items> = [{ id: 1, url: "/one" }]
<ul id="ul"><each in=@items key=@.id as it><li><a href="\${it.url}">x</a></li></each></ul>
</program>
`);
  const read = () => document.querySelector("#ul a")?.getAttribute("href");
  expect(app.errs).toEqual([]);
  expect(read()).toBe("/one");
  await app.set("items", [{ id: 1, url: EVIL }]);
  expect(read()).toBe("about:blank");
  expect(app.logs.some((l) => l.includes("url-guard"))).toBe(true);
  await app.set("items", [{ id: 1, url: "/two" }]);
  expect(read()).toBe("/two");
});

test("component instance — the expanded `<a href=${@u}>` inside a component body", async () => {
  const app = mount(`<program>
<u> = "/start"
const Lnk = <span><a id="c" href=\${@u}>c</a></span>
<Lnk/>
</program>
`);
  await cycle(app, "u", () => document.getElementById("c").getAttribute("href"), "/start", "/again");
});

test("control — a proven-relative `href=\"/u/${@u}\"` is not guarded and follows the data", async () => {
  const app = mount(`<program>\n<u> = "a"\n<a id="l" href="/u/\${@u}">go</a>\n</program>\n`);
  expect(app.clientJs).not.toContain("_scrml_safe_url");
  await app.set("u", "javascript:alert(1)");
  expect(document.getElementById("l").getAttribute("href")).toBe("/u/javascript:alert(1)");
});
