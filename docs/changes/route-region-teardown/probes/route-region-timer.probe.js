/**
 * R26 empirical probe — a route-content `<timer>` across a cross-chunk soft nav.
 *
 *   bun test ./docs/changes/route-region-teardown/probes/route-region-timer.probe.js
 *
 * (the leading `./` is required — bun treats a bare path as a NAME filter, and
 * this file carries no `.test.`/`.spec.` token for it to match)
 *
 * NOT a suite member on purpose. `package.json`'s `test` script and every CI step
 * are scoped to `compiler/tests/`, and this filename carries no `.test.`/`.spec.`
 * token, so nothing picks it up automatically. It is the apparatus behind
 * SCOPING.md's "⛔ MEASURED S314-BUILD" numbers, kept runnable so the follow-on
 * dispatch can re-measure in one command instead of rebuilding the harness.
 *
 * It ASSERTS ALMOST NOTHING — it PRINTS a trace. That is deliberate: the point is
 * to read what the executed bundle actually does at each nav edge, and the
 * "correct" numbers change as the arc lands. The only hard assertion is the
 * shell-timer non-regression (case A), which must hold in every configuration.
 *
 * WHAT TO READ IN THE OUTPUT
 *   AT/reports   the route timer must be LIVE and ticking after the cross-chunk
 *                nav that loads its chunk. A DELTA of 0 here means the incoming
 *                chunk's module-init registration was drained by the OUTGOING
 *                region's teardown — dead on arrival (finding 3a).
 *   AT/about     `rtick` DELTA must be 0 AFTER the fix and is 6-ish before it.
 *                Non-zero = `g-route-timer-poll-not-stopped-on-soft-nav`, the leak.
 *   RE-ENTER     `rtick` DELTA must be non-zero once §20.8.8 step 3 is built.
 *                Zero = the route timer is dead on revisit (finding 3b).
 *   shell        must be non-zero at EVERY step. Zero = a shell timer was killed
 *                by a navigation, the fail-OPEN misclassification (case A).
 *
 * Measured on base `de2f2b24`: AT/reports LIVE · AT/about DELTA 6 (the leak) ·
 * RE-ENTER DELTA 5 · shell alive throughout.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { compileScrml } from "../../../../compiler/src/api.js";
import { mkdirSync, writeFileSync, readFileSync, existsSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

if (!globalThis.document) GlobalRegistrator.register();

// A real multi-file MPA: a shell with its OWN <timer> (case A — must survive), a
// route file with a <timer> (case B — the defect), and a timer-less second route
// to navigate to.
function buildMpa() {
  const dir = mkdtempSync(join(tmpdir(), "route-region-probe-"));
  mkdirSync(join(dir, "pages"), { recursive: true });
  writeFileSync(join(dir, "index.scrml"), [
    "<program>",
    "  <shellTick> = 0",
    "  <h1>Shell</h1>",
    '  <nav><a href="/reports">Reports</a><a href="/about">About</a></nav>',
    '  <p id="st">shell ${@shellTick}</p>',
    "  <timer interval=20>${ @shellTick = @shellTick + 1 }</timer>",
    "  <outlet/>",
    "</program>",
    "",
  ].join("\n"));
  writeFileSync(join(dir, "pages", "reports.scrml"), [
    "<page>",
    "  <rtick> = 0",
    "  <h2>Reports</h2>",
    '  <p id="rt">route ${@rtick}</p>',
    "  <timer interval=20>${ @rtick = @rtick + 1 }</timer>",
    "</page>",
    "",
  ].join("\n"));
  writeFileSync(join(dir, "pages", "about.scrml"), [
    "<page>", "  <n> = 0", "  <h2>About</h2>", "  <p>about ${@n}</p>", "</page>", "",
  ].join("\n"));
  const outDir = join(dir, "dist");
  const result = compileScrml({
    inputFiles: [
      join(dir, "index.scrml"),
      join(dir, "pages", "reports.scrml"),
      join(dir, "pages", "about.scrml"),
    ],
    write: true, outputDir: outDir, log: () => {},
  });
  const read = (rel) => (existsSync(join(outDir, rel)) ? readFileSync(join(outDir, rel), "utf8") : null);
  const runtimeName = (read("index.html").match(/src="(scrml-runtime\.[^"]+\.js)"/) || [])[1];
  return {
    dir,
    errors: (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error"),
    indexHtml: read("index.html"),
    reportsHtml: read("reports.html"),
    aboutHtml: read("about.html"),
    runtimeJs: read(runtimeName),
    shellClientJs: read("index.client.js"),
    reportsClientJs: read("reports.client.js"),
    aboutClientJs: read("about.client.js"),
  };
}

// happy-dom blocks injected-<script> loading, so intercept the append and execute
// the REAL emitted chunk in the runtime's own scope. The injected marker <script>
// STAYS in the document, which is what makes `_scrml_nav_missing_chunks` treat the
// chunk as already-loaded on a later nav — the exact condition that makes route
// re-entry skip module-init.
let __loadRouteChunk = null;
let restoreAppend = null;
let loadedScripts = [];
function installChunkLoader(chunkRegistry) {
  const head = document.head;
  const orig = head.appendChild.bind(head);
  restoreAppend = () => { head.appendChild = orig; };
  head.appendChild = function (node) {
    const src = node && node.getAttribute && node.getAttribute("src");
    if (node && String(node.tagName).toLowerCase() === "script" && src) {
      const base = src.split("/").pop();
      setTimeout(() => {
        try {
          __loadRouteChunk(chunkRegistry[base]);
          loadedScripts.push(base);
          const marker = document.createElement("script");
          marker.setAttribute("src", src);
          orig(marker);
          if (typeof node.onload === "function") node.onload();
        } catch (e) {
          if (typeof node.onerror === "function") node.onerror();
        }
      }, 0);
      return node;
    }
    return orig(node);
  };
}

// Runtime + shell chunk + a route-chunk loader closure share ONE lexical scope, so
// a later route chunk sees the runtime's top-level `const`s exactly as classic
// <script>s do in a real browser.
function mountShell(m) {
  const bodyMatch = m.indexHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  document.body.innerHTML = (bodyMatch ? bodyMatch[1] : "").replace(/<script[\s\S]*?<\/script>/gi, "").trim();
  document.head.innerHTML = '<script src="index.client.js"></script>';
  loadedScripts = ["index.client.js"];
  (0, eval)(
    m.runtimeJs + "\n" + m.shellClientJs + "\n" +
    "globalThis.__scrml_test_route_loader = function(__chunkSrc) { eval(__chunkSrc); };\n" +
    "globalThis.__probe_state = function(){ return _scrml_state; };\n" +
    "globalThis.__probe_region_cleanups = function(){ return typeof _scrml_region_cleanups !== 'undefined' ? _scrml_region_cleanups.length : -1; };\n" +
    "globalThis.__probe_timers = function(){ var o = {}; _scrml_timer_registry.forEach(function(m,k){ var t=[]; m.forEach(function(v,tk){ t.push(tk + ':' + (v.handle!=null?'LIVE':'dead')); }); o[k]=t; }); return o; };\n"
  );
  __loadRouteChunk = globalThis.__scrml_test_route_loader;
  document.dispatchEvent(new Event("DOMContentLoaded"));
}

async function flush(cycles = 10) {
  for (let i = 0; i < cycles; i++) { await new Promise((r) => setTimeout(r, 1)); await Promise.resolve(); }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

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

// Cells are chunk-namespaced (`<ns>$name`); resolve by suffix so the probe reads
// the real counter regardless of the chunk key space.
const get = (n) => {
  const s = globalThis.__probe_state();
  for (const k of Object.keys(s)) if (k === n || k.endsWith("$" + n)) return s[k];
  return undefined;
};

let M = null;
beforeEach(async () => {
  // A FRESH document per test — the shell boot registers document-level delegated
  // listeners that would otherwise accumulate (a happy-dom global-state leak).
  try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
  GlobalRegistrator.register();
  if (!M) M = buildMpa();
  loadedScripts = []; restoreFetch = null; restoreAppend = null;
});
afterEach(() => {
  if (restoreFetch) { globalThis.fetch = restoreFetch; restoreFetch = null; }
  if (restoreAppend) { restoreAppend(); restoreAppend = null; }
  document.body.innerHTML = ""; document.head.innerHTML = "";
});

describe("PROBE — route-region <timer> across a cross-chunk soft nav", () => {
  test("the MPA compiles clean", () => { expect(M.errors).toEqual([]); });

  test("trace: shell -> /reports -> /about -> /reports", async () => {
    mountShell(M);
    installChunkLoader({ "reports.client.js": M.reportsClientJs, "about.client.js": M.aboutClientJs });
    mockFetch({ "/reports": M.reportsHtml, "/about": M.aboutHtml });

    await wait(80);
    console.log("BOOT       shellTick=", get("shellTick"), "timers=", JSON.stringify(globalThis.__probe_timers()));

    globalThis._scrml_navigate_soft("/reports");
    await flush(); await wait(20);
    const rArrive = get("rtick");
    await wait(80);
    console.log("AT/reports rtick", rArrive, "->", get("rtick"), "(DELTA", get("rtick") - rArrive, ")",
      "timers=", JSON.stringify(globalThis.__probe_timers()),
      "regionCleanups=", globalThis.__probe_region_cleanups(),
      "loaded=", JSON.stringify(loadedScripts));

    globalThis._scrml_navigate_soft("/about");
    await flush(); await wait(20);
    const rLeave = get("rtick"); const sLeave = get("shellTick");
    await wait(120);
    console.log("AT/about   rtick", rLeave, "->", get("rtick"), "(DELTA", get("rtick") - rLeave, ")",
      " shellTick DELTA", get("shellTick") - sLeave,
      "timers=", JSON.stringify(globalThis.__probe_timers()));
    expect(get("shellTick") - sLeave).toBeGreaterThan(0); // case A — the ONLY hard assertion

    const sReenter = get("shellTick");
    globalThis._scrml_navigate_soft("/reports");
    await flush(); await wait(20);
    const rBack = get("rtick");
    await wait(120);
    console.log("RE-ENTER   rtick", rBack, "->", get("rtick"), "(DELTA", get("rtick") - rBack, ")",
      " shellTick DELTA", get("shellTick") - sReenter,
      "timers=", JSON.stringify(globalThis.__probe_timers()),
      "loaded=", JSON.stringify(loadedScripts));
    expect(get("shellTick") - sReenter).toBeGreaterThan(0); // case A again
  }, 20000);
});
