/**
 * Browser tests — soft navigation across a BUILD boundary
 * (g-soft-nav-cross-build-handler-id-collision-s469, SECURITY, §20.8.2 step 0).
 *
 * THE ATTACK (reviewer repro, S469). A tab left open across a deploy runs build A's
 * shell. It soft-navigates into build B's route page. Delegated handler ids restart
 * per compile, so B's harmless "Add row" button carries the same
 * `data-scrml-bind-onclick` id as one of A's shell buttons wired to `dangerDelete()`.
 * Before the fix, the soft-nav swapped B's outlet in, and a click on "Add row" ran
 * A's `dangerDelete()` (A's document listener resolved the colliding id against A's
 * table): `@deleted` 0 -> 1.
 *
 * THE FIX (fail closed). Every build carries a deterministic identity, stamped on
 * each page (`<html data-scrml-build>`) and admitted by each chunk
 * (`_scrml_build_admit`). The soft-nav pipeline compares the fetched page's identity
 * with the running build's BEFORE applying any of it; mismatch or missing -> hard
 * navigation. Independently (defence in depth) a delegated listener resolves ids
 * only inside a region stamped with its OWN build, and a chunk from another build
 * refuses to run at all.
 *
 * Harness: the cross-chunk harness (browser-navigate-cross-chunk.test.js) — the
 * runtime + shell chunk + a route-chunk loader closure share ONE eval scope (classic
 * script sharing), an injected <script> is intercepted and the REAL emitted chunk is
 * executed, fetch is mocked with the REAL emitted HTML. The live document mirrors the
 * served page: body markup AND the <html> element's attributes.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { compileScrml } from "../../src/api.js";
import { mkdirSync, writeFileSync, readFileSync, existsSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { chunkCellKey } from "../helpers/chunk-scope.js";

if (!globalThis.document) GlobalRegistrator.register();

// --- fixtures ----------------------------------------------------------------
// Build A — the OLD build the tab is running: three shell buttons wired to a
// destructive handler, plus a harmless route.
const A_SHELL = [
  "<program>",
  "  <deleted> = 0",
  "  ${ function dangerDelete() { @deleted = @deleted + 1 } }",
  "  <h1>Shell</h1>",
  '  <nav><a href="/reports">Reports</a></nav>',
  '  <button class="danger" onclick=dangerDelete()>delete 1</button>',
  '  <button class="danger" onclick=dangerDelete()>delete 2</button>',
  '  <button class="danger" onclick=dangerDelete()>delete 3</button>',
  "  <outlet/>",
  "</program>",
  "",
].join("\n");
const A_REPORTS = ["<page>", "  <h2>Old reports</h2>", "</page>", ""].join("\n");
// Build B — the NEW build: the shell lost its buttons, the route gained "Add row".
const B_SHELL = [
  "<program>",
  "  <h1>Shell</h1>",
  '  <nav><a href="/reports">Reports</a></nav>',
  "  <outlet/>",
  "</program>",
  "",
].join("\n");
const B_REPORTS = [
  "<page>",
  '  <rows> = ["a"]',
  "  <h2>Reports</h2>",
  '  <p id="total">total ${@rows.length}</p>',
  '  <button id="add" onclick=@rows = @rows.concat(["c"])>Add row</button>',
  "</page>",
  "",
].join("\n");

function build(label, shellSrc, reportsSrc) {
  const dir = mkdtempSync(join(tmpdir(), `nav-cross-build-${label}-`));
  mkdirSync(join(dir, "pages"), { recursive: true });
  // A project marker: chunk namespace tokens are project-root-relative (without one
  // they fall back to the absolute path, and two temp dirs would differ by path).
  writeFileSync(join(dir, "scrml.toml"), "");
  writeFileSync(join(dir, "index.scrml"), shellSrc);
  writeFileSync(join(dir, "pages", "reports.scrml"), reportsSrc);
  const outDir = join(dir, "dist");
  const result = compileScrml({
    inputFiles: [join(dir, "index.scrml"), join(dir, "pages", "reports.scrml")],
    write: true, outputDir: outDir, log: () => {},
  });
  const errors = (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error");
  const read = (rel) => (existsSync(join(outDir, rel)) ? readFileSync(join(outDir, rel), "utf8") : null);
  const indexHtml = read("index.html");
  const runtimeName = (indexHtml.match(/src="(scrml-runtime\.[^"]+\.js)"/) || [])[1];
  return {
    dir, errors, indexHtml,
    reportsHtml: read("reports.html"),
    runtimeJs: read(runtimeName),
    shellClientJs: read("index.client.js"),
    reportsClientJs: read("reports.client.js"),
  };
}

/** The build identity a page is stamped with (null when absent). */
function pageBuildId(html) {
  const m = /<html\b[^>]*\bdata-scrml-build="([^"]*)"/.exec(html || "");
  return m ? m[1] : null;
}

// --- harness (mirrors browser-navigate-cross-chunk.test.js) ------------------
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

let hardNavs = [];
// Mount the live page the way a browser would have it: the <html> element's
// attributes (where the build identity rides), the body markup (scripts stripped),
// a head marker for the shell chunk, then the runtime + shell chunk in one scope.
function mountShell(m) {
  const htmlOpen = /<html\b([^>]*)>/i.exec(m.indexHtml);
  if (htmlOpen) {
    for (const a of htmlOpen[1].matchAll(/([\w:-]+)(?:="([^"]*)")?/g)) {
      document.documentElement.setAttribute(a[1], a[2] ?? "");
    }
  }
  const bodyMatch = m.indexHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  document.body.innerHTML = (bodyMatch ? bodyMatch[1] : "").replace(/<script[\s\S]*?<\/script>/gi, "").trim();
  document.head.innerHTML = '<script src="index.client.js"></script>';
  loadedScripts = ["index.client.js"];
  (0, eval)(
    m.runtimeJs + "\n" + m.shellClientJs + "\n" +
    "globalThis.__scrml_test_route_loader = function(__chunkSrc) { eval(__chunkSrc); };\n",
  );
  __loadRouteChunk = globalThis.__scrml_test_route_loader;
  // happy-dom's location assignment is inert, so record the runtime's hard-nav
  // fallback instead (a classic-script global the runtime calls by name).
  hardNavs = [];
  globalThis._scrml_navigate = (p) => { hardNavs.push(p); };
  document.dispatchEvent(new Event("DOMContentLoaded"));
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

async function flush(cycles = 8) {
  for (let i = 0; i < cycles; i++) { await new Promise((r) => setTimeout(r, 1)); await Promise.resolve(); }
}

function click(el) {
  el.dispatchEvent(new Event("click", { bubbles: true }));
}

let A = null, B = null, A2 = null;
beforeEach(async () => {
  try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
  // A real http origin, so pathname / same-origin link classification behave as served.
  GlobalRegistrator.register({
    url: "http://localhost/",
    settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true, handleDisabledFileLoadingAsSuccess: true },
  });
  if (!A) {
    A = build("a", A_SHELL, A_REPORTS);
    B = build("b", B_SHELL, B_REPORTS);
    A2 = build("a2", A_SHELL, A_REPORTS);
  }
  loadedScripts = [];
});
afterEach(() => {
  if (restoreFetch) { globalThis.fetch = restoreFetch; restoreFetch = null; }
  if (restoreAppend) { restoreAppend(); restoreAppend = null; }
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  for (const a of [...document.documentElement.attributes]) document.documentElement.removeAttribute(a.name);
});

const deletedOf = () => globalThis._scrml_reactive_get(chunkCellKey(A.shellClientJs)("deleted"));

describe("cross-build soft navigation — the fixtures reproduce the collision shape", () => {
  test("both builds compile clean; B's 'Add row' id collides with one of A's dangerDelete ids", () => {
    expect(A.errors).toEqual([]);
    expect(B.errors).toEqual([]);
    const aIds = [...A.indexHtml.matchAll(/data-scrml-bind-onclick="([^"]+)"/g)].map((x) => x[1]);
    const addId = (/<button id="add" data-scrml-bind-onclick="([^"]+)"/.exec(B.reportsHtml) || [])[1];
    expect(aIds.length).toBe(3);
    expect(addId).toBeTruthy();
    expect(aIds).toContain(addId);
  });
});

describe("cross-build soft navigation — the attack is refused (fail closed)", () => {
  test("[g-soft-nav-cross-build-handler-id-collision-s469] soft-nav into another build's route hard-navigates; 'Add row' can never run dangerDelete()", async () => {
    mountShell(A);
    expect(deletedOf()).toBe(0);
    // Sanity: the shell's own danger button works (the handler is live).
    click(document.querySelector("button.danger"));
    expect(deletedOf()).toBe(1);

    installChunkLoader({ "reports.client.js": B.reportsClientJs });
    mockFetch({ "/reports": B.reportsHtml });
    globalThis._scrml_navigate_soft("/reports");
    await flush();

    // THE ATTACK: click "Add row" if it made it into the document. On main this
    // ran A's dangerDelete() (B's id collides with A's) — deleted 1 -> 2.
    const add = document.querySelector("#add");
    if (add) click(add);
    expect(deletedOf()).toBe(1);

    // Fail closed: a hard navigation to the target, nothing of B applied.
    expect(hardNavs).toEqual(["/reports"]);
    expect(loadedScripts).toEqual(["index.client.js"]); // B's chunk never ran
    const outlet = document.querySelector("[data-scrml-outlet]");
    expect(outlet.querySelector("#add")).toBeNull();
    expect(outlet.querySelector("h2")).toBeNull();
  });

  test("a fetched page with NO build identity hard-navigates (missing identity fails closed)", async () => {
    mountShell(A);
    const unstamped = A.reportsHtml.replace(/\s+data-scrml-build="[^"]*"/, "");
    expect(pageBuildId(unstamped)).toBeNull();
    installChunkLoader({ "reports.client.js": A.reportsClientJs });
    mockFetch({ "/reports": unstamped });
    const before = document.querySelector("[data-scrml-outlet]").innerHTML;
    globalThis._scrml_navigate_soft("/reports");
    await flush();
    expect(hardNavs).toEqual(["/reports"]);
    expect(document.querySelector("[data-scrml-outlet]").innerHTML).toBe(before);
    expect(loadedScripts).toEqual(["index.client.js"]);
  });

  test("a fetched page with a MISMATCHED identity (same markup, other build id) hard-navigates", async () => {
    mountShell(A);
    const forged = A.reportsHtml.replace(/data-scrml-build="[^"]*"/, 'data-scrml-build="zzzzzzzz"');
    installChunkLoader({ "reports.client.js": A.reportsClientJs });
    mockFetch({ "/reports": forged });
    globalThis._scrml_navigate_soft("/reports");
    await flush();
    expect(hardNavs).toEqual(["/reports"]);
    expect(document.querySelector("[data-scrml-outlet] h2")).toBeNull();
  });
});

describe("cross-build soft navigation — the other entry points take the same check", () => {
  test("back/forward (popstate) into a page that is now another build's hard-navigates", async () => {
    mountShell(A);
    installChunkLoader({ "reports.client.js": A.reportsClientJs });
    mockFetch({ "/reports": A.reportsHtml });
    globalThis._scrml_navigate_soft("/reports"); // same build: soft, wires popstate
    await flush();
    expect(hardNavs).toEqual([]);
    // A deploy lands; the history entry the user goes back to now serves build B.
    restoreFetch && (globalThis.fetch = restoreFetch);
    mockFetch({ "/": B.indexHtml });
    history.pushState({}, "", "/");
    window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    await flush();
    expect(hardNavs).toEqual(["/"]);
    click(document.querySelector("button.danger"));
    expect(deletedOf()).toBe(1); // A's shell is intact (and still the one that runs)
  });

  test("a boosted <a href> click into another build's page hard-navigates", async () => {
    mountShell(A);
    installChunkLoader({ "reports.client.js": B.reportsClientJs });
    mockFetch({ "/reports": B.reportsHtml });
    const link = document.querySelector('a[href="/reports"]');
    expect(link).not.toBeNull();
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    await flush();
    expect(hardNavs).toEqual(["/reports"]);
    expect(document.querySelector("#add")).toBeNull();
    expect(deletedOf()).toBe(0);
  });
});

describe("cross-build soft navigation — same build still soft-navigates (no regression)", () => {
  test("same-build cross-chunk soft-nav swaps in place, no hard nav, the route's handler runs and the shell's does not", async () => {
    mountShell(A);
    installChunkLoader({ "reports.client.js": A.reportsClientJs });
    mockFetch({ "/reports": A.reportsHtml });
    globalThis._scrml_navigate_soft("/reports");
    await flush();
    expect(hardNavs).toEqual([]);
    expect(document.querySelector("[data-scrml-outlet] h2").textContent).toBe("Old reports");
    expect(loadedScripts).toEqual(["index.client.js", "reports.client.js"]);
    // The swapped region carries the (same) build stamp.
    expect(document.querySelector("[data-scrml-outlet]").getAttribute("data-scrml-build")).toBe(pageBuildId(A.indexHtml));
    // Shell handlers still work after the swap.
    click(document.querySelector("button.danger"));
    expect(deletedOf()).toBe(1);
  });
});

describe("cross-build soft navigation — defence in depth (each layer holds on its own)", () => {
  test("a delegated listener ignores a colliding id inside a region stamped with ANOTHER build", () => {
    mountShell(A);
    // Bypass the soft-nav pipeline entirely: put B's route markup in the outlet,
    // stamped (as the swap stamps it) with B's identity.
    const outlet = document.querySelector("[data-scrml-outlet]");
    const bOutlet = /<main\b[^>]*data-scrml-outlet[^>]*>([\s\S]*?)<\/main>/.exec(B.reportsHtml)[1];
    outlet.innerHTML = bOutlet;
    outlet.setAttribute("data-scrml-build", pageBuildId(B.reportsHtml));
    click(document.querySelector("#add"));
    expect(deletedOf()).toBe(0);
    // ...while A's own buttons (in A's stamped region) still resolve.
    click(document.querySelector("button.danger"));
    expect(deletedOf()).toBe(1);
  });

  test("a chunk from another build refuses to run in this document (no listener, no cell writes)", () => {
    mountShell(A);
    const errs = [];
    const origErr = console.error;
    console.error = (...a) => { errs.push(a.join(" ")); };
    try {
      __loadRouteChunk(B.reportsClientJs);
    } finally {
      console.error = origErr;
    }
    expect(globalThis._scrml_build_rejected).toBe(pageBuildId(B.reportsHtml));
    expect(errs.join("\n")).toContain("E-CHUNK-BUILD-MISMATCH");
    // B's cell init never ran.
    expect(globalThis._scrml_reactive_get(chunkCellKey(B.reportsClientJs)("rows"))).toBeUndefined();
  });

  test("a chunk swapped under a matching page mid-deploy (page A, chunk B) is refused and the nav hard-navigates", async () => {
    mountShell(A);
    // The page fetched is A's (identity matches) but the chunk URL now serves B's
    // bytes — an unhashed chunk replaced between the HTML fetch and the script load.
    installChunkLoader({ "reports.client.js": B.reportsClientJs });
    mockFetch({ "/reports": A.reportsHtml });
    globalThis._scrml_navigate_soft("/reports");
    await flush();
    expect(hardNavs).toEqual(["/reports"]);
    expect(document.querySelector("[data-scrml-outlet] h2")).toBeNull();
  });
});

describe("build identity — deterministic and per-build", () => {
  test("two identical builds (different temp dirs) produce the same identity, byte-identical pages and chunks", () => {
    expect(pageBuildId(A.indexHtml)).toMatch(/^[0-9a-z]{8}$/);
    expect(pageBuildId(A2.indexHtml)).toBe(pageBuildId(A.indexHtml));
    expect(A2.indexHtml).toBe(A.indexHtml);
    expect(A2.shellClientJs).toBe(A.shellClientJs);
    expect(A2.reportsClientJs).toBe(A.reportsClientJs);
  });

  test("every page of one build carries the same identity, a different build carries a different one", () => {
    expect(pageBuildId(A.reportsHtml)).toBe(pageBuildId(A.indexHtml));
    expect(pageBuildId(B.reportsHtml)).toBe(pageBuildId(B.indexHtml));
    expect(pageBuildId(B.indexHtml)).not.toBe(pageBuildId(A.indexHtml));
  });

  test("each client chunk admits its own build's identity", () => {
    const id = pageBuildId(A.indexHtml);
    expect(A.shellClientJs).toContain(`_scrml_build_admit(${JSON.stringify(id)})`);
    expect(A.reportsClientJs).toContain(`_scrml_build_admit(${JSON.stringify(id)})`);
  });
});
