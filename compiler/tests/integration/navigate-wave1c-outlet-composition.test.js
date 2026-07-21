/**
 * navigate-wave1c — Piece 1: marker-driven MPA shell composition into the
 * `<outlet>` region (SPEC §20.8.1 / §40.8, Option A ruling).
 *
 * Before Wave-1c the `<main>`-slot MPA composition (index.ts) and the `<outlet>`
 * soft-nav model (§20.8) were disconnected: `<outlet>` emitted a `<div>` and the
 * composition keyed only on `<main>`, so a real multi-file `pages/` build's route
 * pages carried NO `[data-scrml-outlet]` — cross-chunk soft-nav could never engage.
 *
 * Option A unifies them:
 *   1. `<outlet>` emits as `<main data-scrml-outlet tabindex="-1">` (was `<div>`).
 *   2. The composition is MARKER-driven: the slot is the first `[data-scrml-outlet]`
 *      element (falling back to a bare `<main>` for the static/hard-nav back-compat
 *      path). Route content composes INTO the outlet, preserving its wrapper, so the
 *      composed page carries `[data-scrml-outlet]` (the runtime swap selector) AND
 *      lists the shell chunk + the route chunk in script order.
 *   3. A shell declaring BOTH a `<main>` and an `<outlet>` is E-OUTLET-AND-MAIN
 *      (two `<main>` landmarks = invalid HTML + ambiguous slot).
 *
 * These are EMITTED-HTML + diagnostic assertions (no dev-server HTTP runtime).
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
  mkdtempSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

let TMP;
beforeAll(() => {
  TMP = mkdtempSync(join(tmpdir(), "nav-wave1c-outlet-"));
});
afterAll(() => {
  if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
});

function fx(root, relPath, source) {
  const abs = join(root, relPath);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, source);
  return abs;
}

// Compile a multi-file project directory (all *.scrml) and return the emitted
// HTML/artifacts read from disk + the compile errors.
function buildDir(caseId, files) {
  const ROOT = join(TMP, caseId);
  mkdirSync(ROOT, { recursive: true });
  const inputFiles = [];
  for (const [rel, src] of Object.entries(files)) inputFiles.push(fx(ROOT, rel, src));
  const outDir = join(ROOT, "dist");
  const result = compileScrml({ inputFiles, write: true, outputDir: outDir, log: () => {} });
  const read = (rel) => {
    const p = join(outDir, rel);
    return existsSync(p) ? readFileSync(p, "utf8") : null;
  };
  const errors = (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error");
  return { result, errors, outDir, read };
}

describe("§1 — `<outlet>` emits as `<main data-scrml-outlet tabindex=\"-1\">`", () => {
  test("a single-file `<program>` `<outlet/>` renders the outlet as a <main> landmark", () => {
    const { errors, read } = buildDir("single", {
      "app.scrml": `<program>\n  <h1>Shell</h1>\n  <outlet/>\n</program>\n`,
    });
    expect(errors).toEqual([]);
    const html = read("app.html");
    expect(html).not.toBeNull();
    // The outlet region is a <main> carrying the marker + programmatic focus.
    expect(html).toMatch(/<main\b[^>]*\bdata-scrml-outlet\b[^>]*>/);
    expect(html).toMatch(/<main\b[^>]*\btabindex="-1"[^>]*>/);
    // It is NOT a <div> anymore.
    expect(html).not.toMatch(/<div\b[^>]*\bdata-scrml-outlet\b/);
  });

  test("an author tabindex on `<outlet tabindex=0>` is respected (no synthetic -1)", () => {
    const { errors, read } = buildDir("single-tabindex", {
      "app.scrml": `<program>\n  <outlet tabindex="0"/>\n</program>\n`,
    });
    expect(errors).toEqual([]);
    const html = read("app.html");
    expect(html).toMatch(/<main\b[^>]*\bdata-scrml-outlet\b[^>]*>/);
    expect(html).toMatch(/tabindex="0"/);
    expect(html).not.toMatch(/tabindex="-1"/);
  });
});

describe("§2 — marker-driven composition: `<page>` bodies compose INTO the outlet", () => {
  const SHELL = `<program>\n  <h1>Shell</h1>\n  <nav><a href="/reports">Reports</a></nav>\n  <outlet/>\n  <footer>foot</footer>\n</program>\n`;
  const REPORTS = `<page>\n  <rows> = ["a", "b"]\n  <h2>Reports</h2>\n  <ul><each in=@rows><li>\${@.}</li></each></ul>\n</page>\n`;
  const ABOUT = `<page>\n  <count> = 0\n  <h2>About</h2>\n  <p>\${@count}</p>\n</page>\n`;

  test("the composed route page carries [data-scrml-outlet] wrapping the route body + shell chrome", () => {
    const { errors, read } = buildDir("compose", {
      "index.scrml": SHELL,
      "pages/reports.scrml": REPORTS,
      "pages/about.scrml": ABOUT,
    });
    expect(errors).toEqual([]);
    const reports = read("reports.html");
    expect(reports).not.toBeNull();
    // Shell chrome is present (composition happened, not standalone).
    expect(reports).toContain("<h1>Shell</h1>");
    expect(reports).toContain("<footer>foot</footer>");
    // The outlet region is present and the route body sits INSIDE it (the
    // route's <h2> appears after the outlet's <main> open tag).
    expect(reports).toMatch(/<main\b[^>]*\bdata-scrml-outlet\b[^>]*>/);
    const outletOpen = reports.search(/<main\b[^>]*\bdata-scrml-outlet\b[^>]*>/);
    const routeBody = reports.indexOf("<h2>Reports</h2>");
    const outletClose = reports.indexOf("</main>", outletOpen);
    expect(outletOpen).toBeGreaterThanOrEqual(0);
    expect(routeBody).toBeGreaterThan(outletOpen);
    expect(routeBody).toBeLessThan(outletClose);
  });

  test("the composed route page lists the SHELL chunk + the ROUTE chunk (multi-chunk shape)", () => {
    const { read } = buildDir("compose-chunks", {
      "index.scrml": SHELL,
      "pages/reports.scrml": REPORTS,
      "pages/about.scrml": ABOUT,
    });
    const reports = read("reports.html");
    const srcs = [...reports.matchAll(/<script\s+src="([^"]+)"><\/script>/g)].map((m) => m[1]);
    // The shell chunk (index.client.js) AND the route chunk (reports.client.js).
    expect(srcs.some((s) => /index\.client\.js/.test(s))).toBe(true);
    expect(srcs.some((s) => /reports\.client\.js/.test(s))).toBe(true);
  });
});

describe("§3 — bare `<main>` static back-compat (no outlet) still composes", () => {
  test("a `<main>` shell with no `<outlet>` composes route content into `<main>` (hard-nav MPA)", () => {
    const { errors, read } = buildDir("backcompat", {
      "index.scrml": `<program>\n  <h1>Static</h1>\n  <main>placeholder</main>\n  <footer>f</footer>\n</program>\n`,
      "pages/reports.scrml": `<page>\n  <h2>Reports</h2>\n  <p>content</p>\n</page>\n`,
    });
    expect(errors).toEqual([]);
    const reports = read("reports.html");
    expect(reports).toContain("<h1>Static</h1>");
    expect(reports).toContain("<h2>Reports</h2>");
    // No outlet marker (static shell), but composition still ran.
    expect(reports).not.toContain("data-scrml-outlet");
  });
});

describe("§4 — E-OUTLET-AND-MAIN: a shell with BOTH `<main>` and `<outlet>` errors", () => {
  test("`<main>` + sibling `<outlet>` fires E-OUTLET-AND-MAIN", () => {
    const { errors } = buildDir("both-sibling", {
      "app.scrml": `<program>\n  <main>x</main>\n  <outlet/>\n</program>\n`,
    });
    expect(errors.some((e) => e.code === "E-OUTLET-AND-MAIN")).toBe(true);
  });

  test("`<main><outlet/></main>` (nested) also fires E-OUTLET-AND-MAIN", () => {
    const { errors } = buildDir("both-nested", {
      "app.scrml": `<program>\n  <main><outlet/></main>\n</program>\n`,
    });
    expect(errors.some((e) => e.code === "E-OUTLET-AND-MAIN")).toBe(true);
  });

  test("an `<outlet>` alone (no author `<main>`) does NOT fire E-OUTLET-AND-MAIN", () => {
    const { errors } = buildDir("outlet-only", {
      "app.scrml": `<program>\n  <outlet/>\n</program>\n`,
    });
    expect(errors.some((e) => e.code === "E-OUTLET-AND-MAIN")).toBe(false);
  });

  test("a bare `<main>` alone (no outlet) does NOT fire E-OUTLET-AND-MAIN", () => {
    const { errors } = buildDir("main-only", {
      "app.scrml": `<program>\n  <main>x</main>\n</program>\n`,
    });
    expect(errors.some((e) => e.code === "E-OUTLET-AND-MAIN")).toBe(false);
  });
});
