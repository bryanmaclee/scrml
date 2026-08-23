/**
 * §38 transition keyframes SHALL be reachable after a §20.8.2 SOFT navigation.
 *
 * Regression pin for the soft-nav hole opened when the always-shipped
 * `'transitions'` runtime chunk (an inline `<style>` injection, refused by
 * `headers="strict"`'s `default-src 'self'`) was retired in favour of emitting
 * the keyframes into the compiled stylesheet.
 *
 * A soft navigation swaps the target route's markup into the SHELL's live
 * document; `_scrml_nav_sync_head` syncs `<title>`, `meta[name=description]`
 * and `link[rel=canonical]` — NOT stylesheets. So a page-scoped `anim.css` is
 * never loaded, and a swapped-in `scrml-enter-fade` names an animation nothing
 * defines. Soft nav is the DEFAULT path (`_scrml_link_click_handler` intercepts
 * every same-origin `<a href>`), so that is every navigation in the app.
 * The fix: the `<program>` shell entry's stylesheet carries the APP-WIDE union
 * of transition types, and every composed page document already links it.
 *
 * This test lives in the UNIT tier ON PURPOSE. The whole
 * `Transition directives (transition-001-basic)` browser group is in
 * `compiler/tests/browser/FAILURE-BASELINE.json` and fails on every tree, so
 * that tier could not have caught the regression and cannot prove the fix.
 *
 * It EXECUTES, it does not grep:
 *   - a real two-page MPA is compiled to disk with `compileScrml({ write: true })`;
 *   - the stylesheets installed into the live document are exactly the ones the
 *     emitted `index.html` links — read from its `<link rel="stylesheet">` hrefs
 *     and loaded from dist, the browser's fetch modelled faithfully. Nothing
 *     that `index.html` does not link is ever installed;
 *   - the REAL emitted runtime + shell chunk boot, `_scrml_navigate_soft` runs,
 *     the route chunk loads, the outlet swaps and rehydrates;
 *   - the route's own `if=` toggle is CLICKED so the emitted if-controller
 *     applies `scrml-enter-fade` itself;
 *   - the assertion is CSSOM: happy-dom parses the installed sheets, so
 *     `getComputedStyle(el).animation` is non-empty only when a matching rule is
 *     actually live in the document.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { compileScrml } from "../../src/api.js";
import { mkdirSync, writeFileSync, readFileSync, existsSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

if (!globalThis.document) GlobalRegistrator.register();

// --- compile a real shell + transition-bearing route to disk -----------------
function buildMpa() {
  const dir = mkdtempSync(join(tmpdir(), "transition-soft-nav-"));
  mkdirSync(join(dir, "pages"), { recursive: true });
  writeFileSync(
    join(dir, "index.scrml"),
    [
      "<program>",
      "  <h1>Shell</h1>",
      '  <nav><a href="/anim">Anim</a></nav>',
      "  <outlet/>",
      "</program>",
      "",
    ].join("\n"),
  );
  // The shell itself declares NO transition — the keyframes exist in this build
  // only because a ROUTE uses them. That is the whole point: the union has to
  // travel to the document the route gets swapped INTO.
  writeFileSync(
    join(dir, "pages", "anim.scrml"),
    [
      "<page>",
      "  <shown> = false",
      '  <button id="tog" onclick=@shown = true>show</button>',
      '  <p id="fx" if=@shown transition:fade>hello</p>',
      "</page>",
      "",
    ].join("\n"),
  );
  const outDir = join(dir, "dist");
  const result = compileScrml({
    inputFiles: [join(dir, "index.scrml"), join(dir, "pages", "anim.scrml")],
    write: true,
    outputDir: outDir,
    log: () => {},
  });
  const errors = (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error");
  const read = (rel) => (existsSync(join(outDir, rel)) ? readFileSync(join(outDir, rel), "utf8") : null);
  const indexHtml = read("index.html");
  const runtimeName = (indexHtml.match(/src="(scrml-runtime\.[^"]+\.js)"/) || [])[1];
  return {
    outDir, errors, indexHtml, read,
    animHtml: read("anim.html"),
    runtimeJs: read(runtimeName),
    shellClientJs: read("index.client.js"),
    animClientJs: read("anim.client.js"),
  };
}

// Install exactly the stylesheets a document LINKS, reading their bytes from
// dist — the browser's `<link rel="stylesheet">` fetch, modelled. happy-dom does
// not fetch link hrefs, so the sheet text is attached via a <style> carrying the
// originating href; the SELECTION of which sheets exist is the artifact's, not
// the test's.
function installLinkedStylesheets(m, html) {
  const installed = [];
  for (const tag of html.match(/<link\b[^>]*rel="stylesheet"[^>]*>/g) || []) {
    const href = (tag.match(/href="([^"]+)"/) || [])[1];
    if (!href) continue;
    const css = m.read(href);
    if (css == null) continue;
    const el = document.createElement("style");
    el.setAttribute("data-from-link", href);
    el.textContent = css;
    document.head.appendChild(el);
    installed.push(href);
  }
  return installed;
}

// --- shared-scope chunk loading (classic <script> semantics) -----------------
// A real browser loads classic <script>s into ONE shared lexical env, so a route
// chunk sees the runtime's top-level bindings. That sharing is reproduced INSIDE
// an IIFE — never at global scope: this file runs in the pre-commit gate
// alongside tests whose negative controls assert that runtime identifiers are
// NOT defined globally (esm-script-tag-module-format.test.js), and a global eval
// of the runtime would silently satisfy them.
let __loadRouteChunk = null;
let restoreAppend = null;
function installChunkLoader(registry) {
  const head = document.head;
  const orig = head.appendChild.bind(head);
  restoreAppend = () => { head.appendChild = orig; };
  head.appendChild = function (node) {
    const src = node && node.getAttribute && node.getAttribute("src");
    if (node && String(node.tagName).toLowerCase() === "script" && src) {
      const base = src.split("/").pop();
      setTimeout(() => {
        try {
          __loadRouteChunk(registry[base]);
          if (typeof node.onload === "function") node.onload();
        } catch (e) {
          if (typeof node.onerror === "function") node.onerror();
        }
      }, 0);
      return node; // not connected — happy-dom's loader is disabled
    }
    return orig(node);
  };
}

function mountShell(m) {
  const bodyMatch = m.indexHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  document.body.innerHTML = (bodyMatch ? bodyMatch[1] : "").replace(/<script[\s\S]*?<\/script>/gi, "").trim();
  document.head.innerHTML = '<script src="index.client.js"></script>';
  const installed = installLinkedStylesheets(m, m.indexHtml);
  const combined =
    "(function(){\n" + m.runtimeJs + "\n" + m.shellClientJs + "\n" +
    // Exported OUT of the IIFE by name so the harness can drive them; the
    // runtime's own identifiers stay inside.
    "globalThis.__scrml_test_route_loader = function(__chunkSrc) { eval(__chunkSrc); };\n" +
    "globalThis.__scrml_test_navigate_soft = _scrml_navigate_soft;\n" +
    "})();";
  // eslint-disable-next-line no-eval
  eval(combined);
  __loadRouteChunk = globalThis.__scrml_test_route_loader;
  document.dispatchEvent(new Event("DOMContentLoaded"));
  return installed;
}

async function flush(cycles = 10) {
  for (let i = 0; i < cycles; i++) { await new Promise((r) => setTimeout(r, 1)); await Promise.resolve(); }
}

let restoreFetch = null;
function mockFetch(routes) {
  restoreFetch = globalThis.fetch;
  globalThis.fetch = (input) =>
    new Promise((resolve, reject) => {
      const path = typeof input === "string" ? input : (input && input.url) || "";
      setTimeout(() => {
        const html = routes[path];
        if (html === undefined) { const e = new Error("network"); e.name = "TypeError"; return reject(e); }
        resolve({ ok: true, status: 200, redirected: false, url: path, text: async () => html });
      }, 0);
    });
}

/** Every `@keyframes` name currently reachable in the LIVE document (CSSOM). */
function liveKeyframeNames() {
  const names = [];
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch (e) { continue; }
    for (const rule of rules) {
      if (rule && typeof rule.name === "string" && rule.cssText.startsWith("@keyframes")) names.push(rule.name);
    }
  }
  return names;
}

let M = null;
beforeEach(() => {
  if (!M) M = buildMpa();
  restoreFetch = null;
  restoreAppend = null;
});
afterEach(() => {
  if (restoreFetch) { globalThis.fetch = restoreFetch; restoreFetch = null; }
  if (restoreAppend) { restoreAppend(); restoreAppend = null; }
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  // Leave no test-only globals behind for the rest of the `bun test` process.
  delete globalThis.__scrml_test_route_loader;
  delete globalThis.__scrml_test_navigate_soft;
  __loadRouteChunk = null;
});

describe("§38 transition keyframes survive a §20.8.2 soft navigation", () => {
  test("the MPA compiles clean and the route page owns the transition directive", () => {
    expect(M.errors).toEqual([]);
    expect(M.indexHtml).toMatch(/data-scrml-outlet/);
    expect(M.animHtml).toMatch(/data-scrml-outlet/);
  });

  test("the shell document the app first loads carries the app-wide keyframes", () => {
    const installed = mountShell(M);
    // Only what index.html links — the route's own stylesheet is NOT among them.
    expect(installed).toContain("index.css");
    expect(installed).not.toContain("anim.css");
    // ...yet the fade keyframes are live, because the shell entry emits the union.
    expect(liveKeyframeNames()).toContain("scrml-fade-in");
    expect(liveKeyframeNames()).toContain("scrml-fade-out");
  });

  test("after a real soft nav the swapped-in element's enter class RESOLVES to a live animation", async () => {
    mountShell(M);
    installChunkLoader({ "anim.client.js": M.animClientJs });
    mockFetch({ "/anim": M.animHtml });

    globalThis.__scrml_test_navigate_soft("/anim");
    await flush();

    const outlet = document.querySelector("[data-scrml-outlet]");
    const tog = outlet.querySelector("#tog");
    expect(tog).toBeTruthy(); // the route really swapped in

    // The emitted if-controller mounts #fx and applies scrml-enter-fade itself.
    tog.dispatchEvent(new Event("click", { bubbles: true }));
    await flush(2);

    const fx = document.querySelector("#fx");
    expect(fx).toBeTruthy();
    expect(fx.className).toContain("scrml-enter-fade");

    // THE ASSERTION: the class resolves against a rule that is live in THIS
    // document. Before the fix the rule lived only in the never-loaded anim.css,
    // so this computed value was empty and the animation silently did nothing.
    const animation = getComputedStyle(fx).animation;
    expect(animation).toContain("scrml-fade-in");
    expect(liveKeyframeNames()).toContain("scrml-fade-in");
  });
});
