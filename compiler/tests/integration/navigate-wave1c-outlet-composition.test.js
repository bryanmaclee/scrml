/**
 * navigate-wave1c PR-1 — marker-driven MPA shell composition + the ONE-LANDMARK
 * invariant (SPEC §20.8.1 / §40.8 / §34).
 *
 * Before this PR the `<main>`-slot MPA composition (codegen/index.ts) and the
 * `<outlet>` soft-nav model (§20.8) were disconnected: `<outlet>` emitted a
 * `<div>` and the composition keyed only on `<main>`, so an `<outlet>` shell's
 * route pages composed NOTHING — they emitted standalone, with zero shell
 * chrome, and carried no `[data-scrml-outlet]` for the runtime swap to address.
 *
 * THE RULING (S276):
 *
 *   Exactly one `<main>` landmark per composed document; the MARKER decides the
 *   route slot, never the tag.
 *
 * Four cases follow, and only ONE of them is an error:
 *
 *   1. `<outlet>` with no author `<main>`  -> `<main data-scrml-outlet tabindex="-1">`.
 *   2. `<main><outlet/></main>`            -> `<div data-scrml-outlet>`; the AUTHOR's
 *                                             `<main>` is the landmark. LEGAL.
 *   3. a route body carrying its own `<main>` -> the SLOT emits as
 *                                             `<div data-scrml-outlet>`; the ROUTE
 *                                             owns the landmark. LEGAL, in both the
 *                                             single-file (`<page>`-scoped) and the
 *                                             multi-file (`pages/*.scrml`) forms.
 *   4. a BARE / SIBLING author `<main>` alongside the `<outlet>` -> E-OUTLET-AND-MAIN.
 *      Two candidate slots, two landmarks, genuinely ambiguous.
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

/** The document's `<body>` content (composition happens inside `<body>`). */
function bodyOf(html) {
  const m = html && html.match(/<body[^>]*>([\s\S]*)<\/body>/);
  return m ? m[1] : (html ?? "");
}

/** How many `<main>` elements does this document's body carry? */
function mainCount(html) {
  return (bodyOf(html).match(/<main\b/g) || []).length;
}

/**
 * The open tag of the element carrying the `data-scrml-outlet` marker, matched
 * on the ATTRIBUTE NAME — the same thing the runtime's
 * `querySelector("[data-scrml-outlet]")` matches. Deliberately NOT
 * `/\bdata-scrml-outlet\b/`: `\b` matches on `-`, so that form also matches a
 * `data-scrml-outlet-debug` attribute (see §5).
 */
function markerOpenTag(html) {
  const m = bodyOf(html).match(/<([a-zA-Z][\w-]*)\b[^>]*?\sdata-scrml-outlet(?=[\s=>/])[^>]*>/);
  return m ? m[0] : null;
}

describe("§1 — the `<outlet>` region takes the `<main>` landmark when the document has none", () => {
  test("a `<program>` with only an `<outlet/>` renders the outlet AS the `<main>` landmark", () => {
    const { errors, read } = buildDir("single", {
      "app.scrml": `<program>\n  <h1>Shell</h1>\n  <outlet/>\n</program>\n`,
    });
    expect(errors).toEqual([]);
    const html = read("app.html");
    expect(html).not.toBeNull();
    // The outlet region is a <main> carrying the marker + programmatic focus.
    expect(markerOpenTag(html)).toMatch(/^<main\b/);
    expect(markerOpenTag(html)).toContain('tabindex="-1"');
    // ONE landmark.
    expect(mainCount(html)).toBe(1);
  });

  test("an author tabindex on `<outlet tabindex=0>` is respected (no synthetic -1)", () => {
    const { errors, read } = buildDir("single-tabindex", {
      "app.scrml": `<program>\n  <outlet tabindex="0"/>\n</program>\n`,
    });
    expect(errors).toEqual([]);
    const html = read("app.html");
    expect(markerOpenTag(html)).toMatch(/^<main\b/);
    expect(html).toMatch(/tabindex="0"/);
    expect(html).not.toMatch(/tabindex="-1"/);
  });
});

describe("§2 — marker-driven composition: `pages/*.scrml` bodies compose INTO the outlet", () => {
  const SHELL = `<program>\n  <h1>Shell</h1>\n  <nav><a href="/reports">Reports</a></nav>\n  <outlet/>\n  <footer>foot</footer>\n</program>\n`;
  const REPORTS = `<page>\n  <rows> = ["a", "b"]\n  <h2>Reports</h2>\n  <ul><each in=@rows><li>\${@.}</li></each></ul>\n</page>\n`;
  const ABOUT = `<page>\n  <count> = 0\n  <h2>About</h2>\n  <p>\${@count}</p>\n</page>\n`;

  test("the composed route page carries the marker wrapping the route body + shell chrome", () => {
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
    // The outlet region is present and the route body sits INSIDE it.
    const body = bodyOf(reports);
    const outletOpen = body.search(/<main\b[^>]*?\sdata-scrml-outlet(?=[\s=>/])/);
    const routeBody = body.indexOf("<h2>Reports</h2>");
    const outletClose = body.indexOf("</main>", outletOpen);
    expect(outletOpen).toBeGreaterThanOrEqual(0);
    expect(routeBody).toBeGreaterThan(outletOpen);
    expect(routeBody).toBeLessThan(outletClose);
    expect(mainCount(reports)).toBe(1);
  });

  test("an EMPTY outlet slot still composes (the normal soft-nav shape)", () => {
    // Regression: the shell slot is empty at emit time — route content composes
    // IN. The old `slotCloseIdx > slotOpenEndIdx` guard treated an empty slot as
    // "no slot" and silently skipped composition, emitting route pages with NO
    // shell chrome at all.
    const { errors, read } = buildDir("compose-empty-slot", {
      "index.scrml": `<program>\n  <h1>Shell</h1>\n  <outlet/>\n</program>\n`,
      "pages/about.scrml": `<page>\n  <h2>About</h2>\n</page>\n`,
    });
    expect(errors).toEqual([]);
    const about = read("about.html");
    expect(about).toContain("<h1>Shell</h1>");
    expect(about).toContain("<h2>About</h2>");
    expect(markerOpenTag(about)).not.toBeNull();
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
    expect(mainCount(reports)).toBe(1);
  });
});

describe("§4 — THE ONE-LANDMARK INVARIANT: the four ruling cases", () => {
  test("CASE 1 — `<outlet>` with no author `<main>`: clean, outlet IS the landmark", () => {
    const { errors, read } = buildDir("case1-bare-outlet", {
      "app.scrml": `<program>\n  <h1>S</h1>\n  <outlet/>\n</program>\n`,
    });
    expect(errors).toEqual([]);
    const html = read("app.html");
    expect(markerOpenTag(html)).toMatch(/^<main\b/);
    expect(mainCount(html)).toBe(1);
  });

  test("CASE 2 — `<main><outlet/></main>`: LEGAL; outlet demotes to a marked `<div>` inside the author `<main>`", () => {
    // This shape previously fired E-OUTLET-AND-MAIN. It must NOT: the author's
    // `<main>` WRAPS the outlet, so there is exactly one landmark and no
    // ambiguity about where route content goes.
    const { errors, read } = buildDir("case2-outlet-in-main", {
      "app.scrml": `<program>\n  <main><outlet/></main>\n</program>\n`,
    });
    expect(errors).toEqual([]);
    expect(errors.some((e) => e.code === "E-OUTLET-AND-MAIN")).toBe(false);
    const html = read("app.html");
    // The marker rides a <div>, not a second <main>.
    expect(markerOpenTag(html)).toMatch(/^<div\b/);
    expect(mainCount(html)).toBe(1);
    // And it sits INSIDE the author's <main>.
    const body = bodyOf(html);
    expect(body.indexOf("<main")).toBeLessThan(body.search(/<div\b[^>]*\sdata-scrml-outlet/));
  });

  test("CASE 3a — a `<page>`-scoped `<main>` (single-file) is ROUTE content, not a competing shell landmark", () => {
    // In a single-file program the `<page>` bodies emit INLINE into the same
    // document, so the route's `<main>` is already here — the slot must defer.
    const { errors, read } = buildDir("case3a-page-scoped-main", {
      "app.scrml":
        `<program>\n  <nav>chrome</nav>\n  <outlet/>\n  <page><main class="route">Route A</main></page>\n</program>\n`,
    });
    expect(errors).toEqual([]);
    expect(errors.some((e) => e.code === "E-OUTLET-AND-MAIN")).toBe(false);
    const html = read("app.html");
    expect(markerOpenTag(html)).toMatch(/^<div\b/);
    expect(mainCount(html)).toBe(1);
  });

  test("CASE 3b — a multi-file route body with its own `<main>` composes to EXACTLY ONE `<main>`", () => {
    // The silent one: the per-file check cannot see `pages/*.scrml`, so this
    // compiled clean AND emitted two nested `<main>` elements. Composition now
    // demotes the slot for the page that brings its own landmark — and only
    // that page.
    const { errors, read } = buildDir("case3b-multifile-route-main", {
      "app.scrml": `<program>\n  <h1>Shell</h1>\n  <outlet/>\n  <footer>f</footer>\n</program>\n`,
      "pages/reports.scrml": `<page>\n  <main class="route"><h2>Reports</h2></main>\n</page>\n`,
      "pages/about.scrml": `<page>\n  <h2>About</h2>\n</page>\n`,
    });
    expect(errors).toEqual([]);

    // The route that OWNS a <main>: the slot demoted to a marked <div>.
    const reports = read("reports.html");
    expect(reports).toContain("<h1>Shell</h1>");
    expect(mainCount(reports)).toBe(1);
    expect(markerOpenTag(reports)).toMatch(/^<div\b/);
    // Still the slot — the route body composed INSIDE the marked element.
    expect(reports).toContain('class="route"');

    // The sibling route with NO <main>: the slot keeps the landmark. The
    // demotion is per-page, not a whole-build switch.
    const about = read("about.html");
    expect(about).toContain("<h1>Shell</h1>");
    expect(mainCount(about)).toBe(1);
    expect(markerOpenTag(about)).toMatch(/^<main\b/);
  });

  test("CASE 4 — a BARE/SIBLING author `<main>` alongside the `<outlet>` fires E-OUTLET-AND-MAIN", () => {
    const { errors } = buildDir("case4-bare-sibling", {
      "app.scrml": `<program>\n  <main>x</main>\n  <outlet/>\n</program>\n`,
    });
    expect(errors.some((e) => e.code === "E-OUTLET-AND-MAIN")).toBe(true);
  });

  test("CASE 4 — the diagnostic names all three resolutions (wrap / remove / move into `<page>`)", () => {
    const { errors } = buildDir("case4-message", {
      "app.scrml": `<program>\n  <outlet/>\n  <main>x</main>\n</program>\n`,
    });
    const diag = errors.find((e) => e.code === "E-OUTLET-AND-MAIN");
    expect(diag).toBeDefined();
    expect(diag.message).toContain("<main><outlet/></main>");
    expect(diag.message).toContain("data-scrml-outlet");
    expect(diag.message).toContain("<page>");
  });

  test("negative — an `<outlet>` alone does NOT fire E-OUTLET-AND-MAIN", () => {
    const { errors } = buildDir("outlet-only", {
      "app.scrml": `<program>\n  <outlet/>\n</program>\n`,
    });
    expect(errors.some((e) => e.code === "E-OUTLET-AND-MAIN")).toBe(false);
  });

  test("negative — a bare `<main>` alone (no outlet) does NOT fire E-OUTLET-AND-MAIN", () => {
    const { errors } = buildDir("main-only", {
      "app.scrml": `<program>\n  <main>x</main>\n</program>\n`,
    });
    expect(errors.some((e) => e.code === "E-OUTLET-AND-MAIN")).toBe(false);
  });
});

describe("§5 — the slot is matched on the ATTRIBUTE NAME, not a `\\b`-delimited substring", () => {
  // codegen locates the slot textually; the runtime locates it with
  // `querySelector("[data-scrml-outlet]")`. If the two disagree about which
  // element is the slot, route content composes into one element while the
  // soft-nav swap targets another. Both decoys below beat the old
  // `/<(\w+)\b[^>]*\bdata-scrml-outlet\b[^>]*>/` form.

  test("a `data-scrml-outlet-debug` ATTRIBUTE NAME does not win the slot (`\\b` matches on `-`)", () => {
    const { errors, read } = buildDir("decoy-attr-name", {
      "app.scrml":
        `<program>\n  <h1>Shell</h1>\n  <div data-scrml-outlet-debug="1">DECOY</div>\n  <outlet/>\n  <footer>f</footer>\n</program>\n`,
      "pages/about.scrml": `<page>\n  <h2>About</h2>\n</page>\n`,
    });
    expect(errors).toEqual([]);
    const body = bodyOf(read("about.html"));
    // The route content composed into the REAL outlet, which follows the decoy.
    const real = body.search(/<main\b[^>]*?\sdata-scrml-outlet(?=[\s=>/])/);
    expect(real).toBeGreaterThanOrEqual(0);
    expect(body.indexOf("<h2>About</h2>")).toBeGreaterThan(real);
    // The decoy was left untouched — it did not become the slot.
    expect(body).toContain("DECOY");
    expect(body.indexOf("DECOY")).toBeLessThan(real);
  });

  test("a `data-testid=\"data-scrml-outlet\"` ATTRIBUTE VALUE does not win the slot (`[^>]*` spans values)", () => {
    const { errors, read } = buildDir("decoy-attr-value", {
      "app.scrml":
        `<program>\n  <h1>Shell</h1>\n  <div data-testid="data-scrml-outlet">DECOY</div>\n  <outlet/>\n  <footer>f</footer>\n</program>\n`,
      "pages/about.scrml": `<page>\n  <h2>About</h2>\n</page>\n`,
    });
    expect(errors).toEqual([]);
    const body = bodyOf(read("about.html"));
    const real = body.search(/<main\b[^>]*?\sdata-scrml-outlet(?=[\s=>/])/);
    expect(real).toBeGreaterThanOrEqual(0);
    expect(body.indexOf("<h2>About</h2>")).toBeGreaterThan(real);
    expect(body).toContain("DECOY");
    expect(body.indexOf("DECOY")).toBeLessThan(real);
  });
});
