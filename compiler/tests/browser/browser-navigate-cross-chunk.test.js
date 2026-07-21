/**
 * Browser tests — navigate-wave1c CROSS-CHUNK soft navigation (#27, §20.8.2).
 *
 * The Wave-1c prize: a soft-nav to a route whose client chunk is NOT already
 * loaded now LOADS the chunk in-place and swaps the <outlet> — no full reload,
 * no runtime re-boot. This drives the REAL emitted artifacts of a multi-file
 * `pages/` MPA (a shell `<program>` + two `pages/` routes that land in SEPARATE
 * client chunks), executed in happy-dom:
 *   - the shell page boots (runtime + shell chunk) at global scope;
 *   - a soft-nav to a cross-chunk route fetches the target's COMPOSED SSR HTML
 *     (shell chrome + route body in `[data-scrml-outlet]`, listing shell-chunk +
 *     route-chunk), loads the missing route chunk, swaps + rehydrates.
 *
 * happy-dom blocks injected-<script> file loading, so a route chunk's <script>
 * append is intercepted and the REAL emitted chunk JS is executed at global
 * scope (deterministic — the shipped helper runs; no HTTP). This is the R26
 * empirical execution: the emitted bundle RUNS, not a text grep.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { compileScrml } from "../../src/api.js";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

if (!globalThis.document) GlobalRegistrator.register();

// --- compile a real cross-chunk MPA to disk, return the emitted artifacts -----
function buildMpa() {
  const dir = mkdtempSync(join(tmpdir(), "nav-cross-chunk-"));
  mkdirSync(join(dir, "pages"), { recursive: true });
  writeFileSync(
    join(dir, "index.scrml"),
    [
      "<program>",
      "  <count> = 0",
      "  ${ function inc() { @count = @count + 1 } }",
      "  <h1>Shell</h1>",
      '  <nav><a href="/reports">Reports</a><a href="/about">About</a><a href="/machine">Machine</a></nav>',
      // A REACTIVE shell cell + display + mutator OUTSIDE the outlet — the
      // finding-#5 shell-cell-survival subject (must survive a cross-chunk nav).
      '  <p id="shellcount">shell ${@count}</p>',
      '  <button id="shellinc" onclick=inc()>inc</button>',
      "  <outlet/>",
      "  <footer>foot</footer>",
      "</program>",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(dir, "pages", "reports.scrml"),
    [
      "<page>",
      '  <rows> = ["a", "b"]',
      "  <h2>Reports</h2>",
      "  <p>total ${@rows.length}</p>",
      "  <ul><each in=@rows><li>${@.}</li></each></ul>",
      "  <button onclick=@rows = @rows.concat([\"c\"])>Add</button>",
      "</page>",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(dir, "pages", "about.scrml"),
    ["<page>", "  <n> = 0", "  <h2>About</h2>", "  <p>count ${@n}</p>", "</page>", ""].join("\n"),
  );
  // An ENGINE route (its own chunk) — the cross-chunk engine/match execution case.
  writeFileSync(
    join(dir, "pages", "machine.scrml"),
    [
      "<page>",
      "${",
      "  type Phase:enum = { Idle, Running }",
      "}",
      "  <engine for=Phase initial=.Idle>",
      "    <Idle rule=.Running>idle-arm</Idle>",
      "    <Running rule=.Idle>running-arm</Running>",
      "  </engine>",
      '  <button id="mbtn" onclick=@phase = .Running>go</button>',
      "</page>",
      "",
    ].join("\n"),
  );
  const outDir = join(dir, "dist");
  const result = compileScrml({ inputFiles: [
    join(dir, "index.scrml"), join(dir, "pages", "reports.scrml"),
    join(dir, "pages", "about.scrml"), join(dir, "pages", "machine.scrml"),
  ], write: true, outputDir: outDir, log: () => {} });
  const errors = (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error");
  const read = (rel) => (existsSync(join(outDir, rel)) ? readFileSync(join(outDir, rel), "utf8") : null);
  const runtimeName = (read("index.html").match(/src="(scrml-runtime\.[^"]+\.js)"/) || [])[1];
  return {
    dir, errors,
    indexHtml: read("index.html"),
    reportsHtml: read("reports.html"),
    runtimeJs: read(runtimeName),
    shellClientJs: read("index.client.js"),
    reportsClientJs: read("reports.client.js"),
    machineHtml: read("machine.html"),
    machineClientJs: read("machine.client.js"),
    read,
  };
}

// A real browser loads classic <script>s into ONE shared global lexical env, so a
// later route chunk sees the runtime's top-level `const`s. `(0,eval)` does NOT
// share `const`/`let` across separate calls, so we eval runtime + shell + a
// route-chunk LOADER CLOSURE in ONE scope; the closure's DIRECT `eval` runs a
// route chunk in that same scope (faithful classic-script sharing).
let __loadRouteChunk = null;

// Install a deterministic chunk loader: intercept a <script src> append, execute
// the matching emitted chunk in the shared runtime scope, and fire load/error.
// `failSet` basenames simulate a load failure (fires onerror → hard-nav fallback).
let restoreAppend = null;
function installChunkLoader(chunkRegistry, failSet) {
  const head = document.head;
  const orig = head.appendChild.bind(head);
  restoreAppend = () => { head.appendChild = orig; };
  head.appendChild = function (node) {
    const src = node && node.getAttribute && node.getAttribute("src");
    if (node && String(node.tagName).toLowerCase() === "script" && src) {
      const base = src.split("/").pop();
      setTimeout(() => {
        if (failSet && failSet.has(base)) {
          if (typeof node.onerror === "function") node.onerror();
          return;
        }
        try {
          __loadRouteChunk(chunkRegistry[base]); // direct eval in the runtime scope
          loadedScripts.push(base);
          if (typeof node.onload === "function") node.onload();
        } catch (e) {
          if (typeof node.onerror === "function") node.onerror();
        }
      }, 0);
      return node; // do NOT connect (avoid happy-dom's disabled-loader throw)
    }
    return orig(node);
  };
}

let loadedScripts = [];

// Build the live shell page: outlet-bearing body (scripts stripped) + a shell
// <script src> marker in the head so `have` = {index.client.js}. Runtime + shell
// chunk + the route-chunk loader closure are eval'd in ONE shared scope (the
// shell boots; the closure lets a later route chunk share the runtime's scope).
function mountShell(m) {
  const bodyMatch = m.indexHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  document.body.innerHTML = (bodyMatch ? bodyMatch[1] : "").replace(/<script[\s\S]*?<\/script>/gi, "").trim();
  document.head.innerHTML = '<script src="index.client.js"></script>';
  loadedScripts = ["index.client.js"];
  const combined =
    m.runtimeJs + "\n" + m.shellClientJs + "\n" +
    "globalThis.__scrml_test_route_loader = function(__chunkSrc) { eval(__chunkSrc); };\n";
  (0, eval)(combined);
  __loadRouteChunk = globalThis.__scrml_test_route_loader;
  // The shell chunk's boot defers to DOMContentLoaded (an ordinary initial load —
  // _scrml_chunk_loading is false); fire it so the shell's own event wiring +
  // reactive display (the shell button + `${@count}`) is registered, mirroring a
  // real page load. Route chunks boot eagerly on injection (the flag), not here.
  document.dispatchEvent(new Event("DOMContentLoaded"));
}

async function flush(cycles = 8) {
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

let M = null;
beforeEach(async () => {
  // A FRESH document per test — the shell boot registers document-level delegated
  // click/submit listeners that would otherwise ACCUMULATE across tests (a
  // happy-dom global-state leak), double-firing a subsequent test's clicks.
  try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
  GlobalRegistrator.register();
  if (!M) M = buildMpa();
  loadedScripts = [];
  restoreFetch = null;
  restoreAppend = null;
});
afterEach(() => {
  if (restoreFetch) { globalThis.fetch = restoreFetch; restoreFetch = null; }
  if (restoreAppend) { restoreAppend(); restoreAppend = null; }
  document.body.innerHTML = "";
  document.head.innerHTML = "";
});

describe("navigate-wave1c — cross-chunk soft navigation loads the chunk + swaps", () => {
  test("the emitted cross-chunk MPA compiles clean + composes an outlet-bearing route page", () => {
    const m = M;
    expect(m.errors).toEqual([]);
    // The composed route page carries [data-scrml-outlet] + shell chrome + BOTH chunks.
    expect(m.reportsHtml).toMatch(/<main\b[^>]*\bdata-scrml-outlet\b/);
    expect(m.reportsHtml).toContain("<h1>Shell</h1>");
    expect(m.reportsHtml).toMatch(/index\.client\.js/);
    expect(m.reportsHtml).toMatch(/reports\.client\.js/);
  });

  test("a soft-nav to a cross-chunk route loads the chunk, swaps the outlet, keeps the shell live", async () => {
    const m = M;
    mountShell(m);
    // Shell is live (booted).
    expect(document.querySelector("h1").textContent).toBe("Shell");
    const outletBefore = document.querySelector("[data-scrml-outlet]");
    expect(outletBefore).not.toBeNull();

    installChunkLoader({ "reports.client.js": m.reportsClientJs }, null);
    // The composed route HTML the server would return for /reports (outlet-bearing,
    // lists both chunks) — use the REAL emitted reports.html.
    mockFetch({ "/reports": m.reportsHtml });

    globalThis._scrml_navigate_soft("/reports");
    await flush();

    // Soft swap: the outlet now holds the route content (the <h2>Reports</h2> + list).
    const outlet = document.querySelector("[data-scrml-outlet]");
    expect(outlet.querySelector("h2").textContent).toBe("Reports");
    expect(outlet.querySelectorAll("li").length).toBe(2);
    // The shell SURVIVED — same H1 node, no full reload / re-boot.
    expect(document.querySelector("h1").textContent).toBe("Shell");
  });

  test("the swapped route's reactivity works AFTER the cross-chunk swap (@cell + <each> re-render)", async () => {
    const m = M;
    mountShell(m);
    installChunkLoader({ "reports.client.js": m.reportsClientJs }, null);
    mockFetch({ "/reports": m.reportsHtml });
    globalThis._scrml_navigate_soft("/reports");
    await flush();

    // The route chunk registered its reactive wiring; mutate its cell → re-render.
    expect(document.querySelectorAll("[data-scrml-outlet] li").length).toBe(2);
    globalThis._scrml_reactive_set("rows", ["x", "y", "z", "w"]);
    await flush();
    expect(document.querySelectorAll("[data-scrml-outlet] li").length).toBe(4);
    // The `${@rows.length}` interpolation re-bound too.
    const total = document.querySelector("[data-scrml-outlet] p");
    expect(total && total.textContent).toContain("4");
  });

  test("a chunk-load FAILURE falls back to a hard navigation (does NOT frozen-swap)", async () => {
    const m = M;
    mountShell(m);
    const outletBefore = document.querySelector("[data-scrml-outlet]").innerHTML;
    // The route chunk fails to load → runtime hard-nav fallback (W-NAV-CHUNK-LOAD-FAILED).
    installChunkLoader({ "reports.client.js": m.reportsClientJs }, new Set(["reports.client.js"]));
    mockFetch({ "/reports": m.reportsHtml });

    expect(() => globalThis._scrml_navigate_soft("/reports")).not.toThrow();
    await flush();

    // happy-dom's window.location assignment is inert → the outlet is LEFT AS-IS
    // (never frozen-swapped with unhydrated cross-chunk content).
    const outlet = document.querySelector("[data-scrml-outlet]");
    expect(outlet.querySelector("h2")).toBeNull();
    expect(outlet.innerHTML).toBe(outletBefore);
  });
});

describe("navigate-wave1c — an ENGINE route loaded cross-chunk renders + transitions", () => {
  // The target route (its own chunk) carries an `<engine for=Phase>`. Its dispatcher
  // subscribes at module-init (tier-1, runs on chunk load) and the initial arm is
  // SSR-rendered; the eager `_fire()` runs before the swap (no mount yet → no-op),
  // so this asserts the REAL post-swap path: initial arm present, transition works.
  test("first cross-chunk visit: the initial arm renders after the swap, and a variant transition re-renders", async () => {
    const m = M;
    expect(m.errors).toEqual([]);
    expect(m.machineClientJs).not.toBeNull();
    mountShell(m);
    installChunkLoader({ "machine.client.js": m.machineClientJs }, null);
    mockFetch({ "/machine": m.machineHtml });

    globalThis._scrml_navigate_soft("/machine");
    await flush();

    const outlet = document.querySelector("[data-scrml-outlet]");
    // The engine mount + initial (.Idle) arm are in the swapped-in region.
    expect(outlet.querySelector('[data-scrml-engine-mount="phase"]')).not.toBeNull();
    expect(outlet.textContent).toContain("idle-arm");
    expect(outlet.textContent).not.toContain("running-arm");
    // The shell survived (no reload / re-boot).
    expect(document.querySelector("h1").textContent).toBe("Shell");

    // Drive a variant transition via the route's own button (its click handler was
    // wired by the eager chunk boot). The tier-1 subscription re-renders the arm.
    const btn = document.querySelector("[data-scrml-outlet] #mbtn");
    expect(btn).not.toBeNull();
    btn.dispatchEvent(new Event("click", { bubbles: true }));
    await flush();

    const after = document.querySelector("[data-scrml-outlet]");
    expect(after.textContent).toContain("running-arm");
    expect(after.textContent).not.toContain("idle-arm");
  });
});

describe("navigate-wave1c — finding #5: a MUTATED reactive shell cell survives a cross-chunk nav", () => {
  test("the injected route chunk's eager boot + seed-apply does NOT reset a mutated shell cell", async () => {
    const m = M;
    mountShell(m);
    // The shell cell starts at 0; mutate it via the shell button (outside the outlet).
    expect(globalThis._scrml_reactive_get("count")).toBe(0);
    const shellBtn = document.querySelector("#shellinc");
    expect(shellBtn).not.toBeNull();
    shellBtn.dispatchEvent(new Event("click", { bubbles: true }));
    shellBtn.dispatchEvent(new Event("click", { bubbles: true }));
    expect(globalThis._scrml_reactive_get("count")).toBe(2);
    // The shell display (outside the outlet) reflects the mutation.
    expect(document.querySelector("#shellcount").textContent).toContain("2");

    // Cross-nav to a DIFFERENT chunk (reports) — the injected reports.client.js
    // runs its module-init seed-apply; the reports seed carries NO shell keys, so
    // the mutated shell cell must survive (finding #5, the seed-clobber class).
    installChunkLoader({ "reports.client.js": m.reportsClientJs }, null);
    mockFetch({ "/reports": m.reportsHtml });
    globalThis._scrml_navigate_soft("/reports");
    await flush();

    // The route swapped in (proves the cross-chunk nav happened, not a no-op).
    expect(document.querySelector("[data-scrml-outlet] h2").textContent).toBe("Reports");
    // The mutated shell cell KEPT its value; the shell display still shows it.
    expect(globalThis._scrml_reactive_get("count")).toBe(2);
    expect(document.querySelector("#shellcount").textContent).toContain("2");
  });
});
