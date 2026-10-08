/**
 * s457-executable-sinks-srcdoc-svg.browser.test.js — MOUNTED (happy-dom) acceptance for the S457
 * SVG animation sink (SPEC §5.2 rules 2/3, S457 bullets): `<a><set attributeName="href" to=…/></a>`
 * animates the link's href to the value, and a `javascript:` value runs on click (Chromium-confirmed).
 * The `to` / `values` write is a URL-attribute write: data with a non-admitted scheme becomes
 * `about:blank` plus one report, on the first write and on every reactive re-write.
 *
 * The page is compiled, the SHIPPED pruned runtime is mounted with the client chunk, and the DOM is
 * read. Positions: top level (expression form — previously DROPPED silently — and quoted form), an
 * `<each>` row, an `<animate values=…>` list, and a computed `attributeName` (fail closed).
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
  const tmpDir = mkdtempSync(join(tmpdir(), "s457-svgsink-"));
  const outDir = resolve(tmpDir, "out");
  mkdirSync(outDir, { recursive: true });
  const input = resolve(tmpDir, "app.scrml");
  writeFileSync(input, source);
  try {
    const r = compileScrml({ inputFiles: [input], write: true, outputDir: outDir, log: () => {} });
    const rd = (f) => (existsSync(resolve(outDir, f)) ? readFileSync(resolve(outDir, f), "utf8") : "");
    const errs = (r.errors ?? []).filter((e) => (e.severity ?? "error") === "error").map((e) => e.code);
    // §2.2.1 (S457 #1348) — a compile that reports an error writes NO artifact; there is
    // nothing to mount. The emitted client JS is read from the in-memory outputs instead.
    if (errs.length > 0) {
      const memClient = [...(r.outputs?.values?.() ?? [])].map((o) => o?.clientJs ?? "").join("\n");
      return { errs, logs: [], clientJs: memClient };
    }
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
      set: async (name, v) => {
        const o = console.error;
        console.error = (...a) => { logs.push(a.map(String).join(" ")); };
        try {
          globalThis.__set(name, v);
          await new Promise((res) => setTimeout(res, 10));
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

const setTo = () => document.querySelector("set")?.getAttribute("to");

test("<set attributeName=\"href\" to=${@u}> — the expression form is WRITTEN (was dropped) and guarded", async () => {
  const app = mount(`<program>\n<u> = "/start"\n<svg><a href="/x"><set attributeName="href" to=\${@u}/><text>t</text></a></svg>\n</program>\n`);
  await cycle(app, "u", setTo, "/start", "https://ok.example/");
});

test("<set attributeName=\"href\" to=\"${@u}\"> — the quoted form, reactive re-write", async () => {
  const app = mount(`<program>\n<u> = "/start"\n<svg><a href="/x"><set attributeName="href" to="\${@u}"/><text>t</text></a></svg>\n</program>\n`);
  await cycle(app, "u", setTo, "/start", "mailto:a@b.c", " JaVa\tScRiPt:alert(1)");
});

test("<animate attributeName=\"xlink:href\" values=\"${@u}\"> — every `;` entry is judged", async () => {
  const app = mount(`<program>\n<u> = "/a;/b"\n<svg><a href="/x"><animate attributeName="xlink:href" values="\${@u}"/><text>t</text></a></svg>\n</program>\n`);
  const read = () => document.querySelector("animate")?.getAttribute("values");
  await cycle(app, "u", read, "/a;/b", "https://a/;/c", "/safe;javascript:alert(1)");
});

test("<each> row — `<set attributeName=\"href\" to=it.url>` re-written when the list changes", async () => {
  const app = mount(`<program>
<items> = [{ id: 1, url: "/one" }]
<svg id="s"><each in=@items key=@.id as it><a href="/x"><set attributeName="href" to=it.url/><text>t</text></a></each></svg>
</program>
`);
  const read = () => document.querySelector("#s set")?.getAttribute("to");
  expect(app.errs).toEqual([]);
  expect(read()).toBe("/one");
  await app.set("items", [{ id: 1, url: EVIL }]);
  expect(read()).toBe("about:blank");
  expect(app.logs.some((l) => l.includes("url-guard"))).toBe(true);
  await app.set("items", [{ id: 1, url: "/two" }]);
  expect(read()).toBe("/two");
});

test("computed attributeName — fail closed: the value is judged as a URL", async () => {
  const app = mount(`<program>\n<n> = "href"\n<u> = "/start"\n<svg><a href="/x"><set attributeName=\${@n} to=\${@u}/><text>t</text></a></svg>\n</program>\n`);
  await cycle(app, "u", setTo, "/start", "/again");
});

test("control — attributeName names a non-URL attribute: the value is written unguarded", async () => {
  const app = mount(`<program>\n<w> = "10"\n<svg><rect width="5" height="5"><set attributeName="width" to=\${@w}/></rect></svg>\n</program>\n`);
  expect(app.errs).toEqual([]);
  expect(app.clientJs).not.toContain("_scrml_safe_url");
  expect(setTo()).toBe("10");
  await app.set("w", "javascript:20");
  expect(setTo()).toBe("javascript:20");
});

test("S457 review — an undeclared `onClick` / `ONCLICK` (no `props` block; S458 \"D1\": a declared prop never reaches the root) in `lift` and `<each>` is a listener: no handler text, the data never runs", async () => {
  const app = mount(`<program>
<items> = [{ id: 1, code: "window.__pwned = 1" }]
const Btn = <button>b</button>
const Up = <button>u</button>
<ul id="b">\${ for (const it of @items) { lift <li><Btn onClick=it.code/></li> } }</ul>
<ul id="u">\${ for (const it of @items) { lift <li><Up ONCLICK=\${it.code}/></li> } }</ul>
<ul id="e"><each in=@items key=@.id as it><li><Btn onClick=it.code/></li></each></ul>
</program>
`);
  expect(app.errs).toEqual([]);
  for (const sel of ["#b button", "#u button", "#e button"]) {
    const btn = document.querySelector(sel);
    expect(btn).not.toBeNull();
    expect(btn.hasAttribute("onclick")).toBe(false);
    // The listener calls the string (a TypeError, reported) — it never evaluates it as code.
    try { btn.click(); } catch {}
  }
  await new Promise((r) => setTimeout(r, 10));
  expect(globalThis.window.__pwned).toBeUndefined();
});

test("S457 review — an undeclared `srcdoc` (no `props` block) with data in `<each>` / `lift` is a compile error", () => {
  const app = mount(`<program>
<items> = [{ id: 1, d: "hello" }]
const Fr = <iframe></iframe>
<ul id="l">\${ for (const it of @items) { lift <li><Fr srcdoc=it.d/></li> } }</ul>
</program>
`);
  expect(app.errs).toContain("E-ATTR-INTERP-EXECUTABLE");
  expect(app.clientJs).not.toMatch(/setAttribute\("srcdoc",/);
});

test("S457 review — an undeclared `href` (no `props` block) in `lift` / `<each>` is written, and guarded", async () => {
  const app = mount(`<program>
<items> = [{ id: 1, url: "/one" }]
const Link = <a>l</a>
<ul id="l">\${ for (const it of @items) { lift <li><Link href=it.url/></li> } }</ul>
<ul id="e"><each in=@items key=@.id as it><li><Link href=it.url/></li></each></ul>
</program>
`);
  expect(app.errs).toEqual([]);
  expect(document.querySelector("#l a").getAttribute("href")).toBe("/one");
  expect(document.querySelector("#e a").getAttribute("href")).toBe("/one");
  await app.set("items", [{ id: 1, url: EVIL }]);
  expect(document.querySelector("#e a").getAttribute("href")).toBe("about:blank");
  expect(document.querySelector("#l a").getAttribute("href")).toBe("about:blank");
});
