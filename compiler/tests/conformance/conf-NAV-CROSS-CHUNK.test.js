/**
 * CONF-NAV-CROSS-CHUNK | §20.8.1 / §20.8.2 / §20.8.7 / §40.8 — navigate-wave1c
 *
 * Cross-chunk soft navigation (Option A ruling): `<outlet>` is the marker-driven
 * shell-composition slot (emits `<main data-scrml-outlet>`), a shell with BOTH a
 * `<main>` and an `<outlet>` is E-OUTLET-AND-MAIN, and a soft-nav to a route in a
 * not-yet-loaded client chunk loads it in-place (hard-nav + W-NAV-CHUNK-LOAD-FAILED
 * on load failure).
 *
 * CODES-HALF   — POS: `<main>` + `<outlet>` fires E-OUTLET-AND-MAIN (error, in
 *                result.errors). NEG: outlet-only / main-only do NOT fire.
 * RUNTIME-HALF — DETERMINISTIC, executes the SHIPPED helpers in isolation (no
 *                HTTP, no happy-dom global): `_scrml_nav_missing_chunks` returns
 *                the not-loaded chunk (need\have) from a fetched doc's <script src>
 *                list; `_scrml_nav_chunk_failed` emits W-NAV-CHUNK-LOAD-FAILED +
 *                hard-navs. Plus: the `<outlet>` emits `<main data-scrml-outlet>`.
 *
 * Firing sites: symbol-table.ts PASS 15.5 (E-OUTLET-AND-MAIN) · runtime-template.js
 * (_scrml_nav_missing_chunks / _scrml_nav_chunk_failed).
 */
import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { SCRML_RUNTIME } from "../../src/runtime-template.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let _tmp = 0;

function compile(source, slug) {
  const name = `${slug}-${++_tmp}`;
  const tmpDir = resolve(testDir, `_tmp_${name}`);
  const tmpInput = resolve(tmpDir, `${name}.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: false, outputDir: resolve(tmpDir, "out"), log: () => {} });
    let html = null;
    for (const [fp, output] of result.outputs) if (fp.includes(name)) html = output.html ?? null;
    return { errors: result.errors ?? [], warnings: result.warnings ?? [], html };
  } finally {
    if (existsSync(tmpInput)) rmSync(tmpInput);
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

const outletAndMain = (r) => r.errors.find((e) => (e.code ?? "") === "E-OUTLET-AND-MAIN");

describe("CONF-NAV-CROSS-CHUNK — codes-half (E-OUTLET-AND-MAIN)", () => {
  test("POS: a shell with BOTH <main> and <outlet> fires E-OUTLET-AND-MAIN (error)", () => {
    const r = compile(`<program>\n  <main>x</main>\n  <outlet/>\n</program>`, "oam-pos");
    const e = outletAndMain(r);
    expect(e).toBeDefined();
    expect(e.severity).toBe("error");
    expect(r.errors).toContain(e);
    expect(e.message).toContain("<main>");
    expect(e.message).toContain("<outlet>");
  });

  test("POS: <main><outlet/></main> (nested) also fires E-OUTLET-AND-MAIN", () => {
    const r = compile(`<program>\n  <main><outlet/></main>\n</program>`, "oam-nested");
    expect(outletAndMain(r)).toBeDefined();
  });

  test("NEG: an <outlet> alone does NOT fire", () => {
    const r = compile(`<program>\n  <outlet/>\n</program>`, "oam-outlet-only");
    expect(outletAndMain(r)).toBeUndefined();
  });

  test("NEG: a bare <main> alone (static MPA) does NOT fire", () => {
    const r = compile(`<program>\n  <main>x</main>\n</program>`, "oam-main-only");
    expect(outletAndMain(r)).toBeUndefined();
  });
});

describe("CONF-NAV-CROSS-CHUNK — runtime-half (shipped helpers, executed in isolation)", () => {
  // Build the runtime's cross-chunk helpers bound to controlled stubs — no HTTP,
  // no happy-dom global. A fake document/window lets us EXECUTE (not grep) the
  // shipped `_scrml_nav_missing_chunks` / `_scrml_nav_chunk_failed`.
  // A "just enough" DOM/window stub so the runtime's top-level init (a one-time
  // <style> injection, listener setup) does not throw when eval'd headlessly. The
  // `script[src]` query is the only surface the cross-chunk helpers read.
  const stubEl = () => ({
    setAttribute() {}, appendChild() {}, remove() {}, style: {}, textContent: "",
    sheet: { insertRule() {} }, addEventListener() {}, getAttribute: () => null, dataset: {},
  });
  function mkDoc(scripts) {
    return {
      querySelectorAll: (sel) => (sel === "script[src]" ? scripts.map((src) => ({ getAttribute: () => src })) : []),
      querySelector: () => null,
      createElement: () => stubEl(),
      createTextNode: () => stubEl(),
      head: stubEl(), body: stubEl(), documentElement: stubEl(),
      addEventListener() {}, removeEventListener() {}, readyState: "complete",
    };
  }
  function runtimeHelpers({ liveScripts = [], hardNavTarget = { href: null } } = {}) {
    const fakeDocument = mkDoc(liveScripts);
    let _loc = "https://app.test/";
    const fakeWindow = {
      location: { get href() { return _loc; }, set href(v) { hardNavTarget.href = v; } },
      addEventListener() {}, removeEventListener() {}, scrollTo() {}, matchMedia: () => ({ matches: false, addEventListener() {} }),
    };
    const logs = [];
    const fakeConsole = { info: (m) => logs.push(m), warn: () => {}, error: () => {}, log: () => {} };
    const factory = new Function(
      "document", "window", "console", "URL",
      SCRML_RUNTIME +
        "\nreturn { missing: _scrml_nav_missing_chunks, failed: _scrml_nav_chunk_failed," +
        " token: function(){ return _scrml_nav_token; }, bump: function(){ return ++_scrml_nav_token; } };",
    );
    return { ...factory(fakeDocument, fakeWindow, fakeConsole, URL), logs, mkDoc };
  }

  test("_scrml_nav_missing_chunks returns the not-loaded route chunk (need \\ have), abs-resolved + deps-first", () => {
    const h = runtimeHelpers({ liveScripts: ["/index.client.abc.js"] });
    // The fetched target lists the shell chunk (already have) + the route chunk (missing).
    const targetDoc = h.mkDoc(["index.client.abc.js", "reports.client.def.js"]);
    const missing = h.missing(targetDoc, "/reports");
    expect(missing.length).toBe(1);
    expect(missing[0]).toContain("reports.client.def.js");
    // Resolved to an absolute URL against the target page.
    expect(missing[0]).toMatch(/^https?:\/\//);
  });

  test("_scrml_nav_missing_chunks returns [] when every target chunk is already loaded (same-chunk)", () => {
    const h = runtimeHelpers({ liveScripts: ["/index.client.abc.js"] });
    const targetDoc = h.mkDoc(["index.client.abc.js"]);
    expect(h.missing(targetDoc, "/about").length).toBe(0);
  });

  test("_scrml_nav_chunk_failed emits W-NAV-CHUNK-LOAD-FAILED (Info) + hard-navigates", () => {
    const hardNav = { href: null };
    const h = runtimeHelpers({ hardNavTarget: hardNav });
    const tok = h.token();
    h.failed("/reports", tok, "https://app.test/reports.client.def.js", "timeout");
    expect(h.logs.some((m) => String(m).includes("W-NAV-CHUNK-LOAD-FAILED"))).toBe(true);
    expect(hardNav.href).toBe("/reports"); // hard-nav fallback fired
  });

  test("a chunk failure under a SUPERSEDED token bails silently (no hard-nav, no log)", () => {
    const hardNav = { href: null };
    const h = runtimeHelpers({ hardNavTarget: hardNav });
    const stale = h.token();
    h.bump(); // a newer nav supersedes `stale`
    h.failed("/reports", stale, "x.js", "error");
    expect(h.logs.length).toBe(0);
    expect(hardNav.href).toBeNull();
  });
});

describe("CONF-NAV-CROSS-CHUNK — <outlet> emits the marker-driven slot", () => {
  test("<outlet/> compiles to <main data-scrml-outlet tabindex=\"-1\">", () => {
    const r = compile(`<program>\n  <h1>S</h1>\n  <outlet/>\n</program>`, "outlet-emit");
    expect(r.errors).toEqual([]);
    expect(r.html).toMatch(/<main\b[^>]*\bdata-scrml-outlet\b[^>]*>/);
    expect(r.html).toMatch(/<main\b[^>]*\btabindex="-1"/);
    expect(r.html).not.toMatch(/<div\b[^>]*\bdata-scrml-outlet/);
  });
});
