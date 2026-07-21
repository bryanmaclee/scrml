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

/**
 * Strip INERT content — anything present in the document text but NOT rendered
 * as live DOM on initial paint:
 *
 *   - `<template>` bodies: the compiler parks `if=`-guarded subtrees there
 *     (`<main if=@hide>` becomes `<template …><main>…</main></template>`), so
 *     a `<main>` inside one is NOT a landmark until the guard mounts it.
 *   - `<script>` / `<style>` bodies: JS/CSS text, not markup. A client chunk
 *     that builds `"<main>…"` as a string is not a rendered landmark either.
 *   - comments.
 *
 * This is the oracle's whole job. Counting `<main` textually over the raw body
 * — which is what this helper used to do — makes a `<template>` occurrence
 * indistinguishable from a live landmark, and that blind spot is precisely why
 * 16 green tests failed to catch a document emitting ZERO rendered landmarks.
 */
function strippedBody(html) {
  return bodyOf(html)
    .replace(/<template\b[^>]*>[\s\S]*?<\/template>/gi, "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");
}

/**
 * How many RENDERED `<main>` landmarks does this document carry? The invariant
 * is "exactly one `<main>` landmark per composed document", and a landmark is
 * live DOM — so inert content is stripped before counting.
 */
function mainCount(html) {
  // `/gi`, NOT `/g`. HTML element names are ASCII case-insensitive, so `<MAIN>`
  // is a landmark to a browser. A case-SENSITIVE oracle shares the exact blind
  // spot the implementation had (`=== "main"`) and scores a document emitting
  // `<main data-scrml-outlet></main> <MAIN>m</MAIN>` — two live landmarks — as
  // a compliant 1. That is the S276 failure mode a second time: an oracle
  // written from the same assumption as the code cannot see the bug class.
  return (strippedBody(html).match(/<main\b/gi) || []).length;
}

/**
 * All diagnostics of one code, so a test can pin HOW MANY fired and WHERE.
 * `.some(e => e.code === …)` is one bit wide: it passes when the code fires
 * twice, or on the wrong node — which is how the degenerate-span defect
 * (every new diagnostic reporting L1:C1) shipped through a green suite.
 */
function diagsOf(errors, code) {
  return errors.filter((e) => e.code === code);
}

/**
 * Open-vs-close tag balance for a tag within the rendered body. The composition
 * splices text around a slot's open/close tags, so an off-by-one close tag
 * silently reparents or destroys sibling content. Every composed fixture
 * asserts balance.
 */
function tagBalance(html, tag) {
  const body = strippedBody(html);
  const opens = (body.match(new RegExp(`<${tag}\\b(?![^>]*/>)`, "gi")) || []).length;
  const closes = (body.match(new RegExp(`</${tag}\\s*>`, "gi")) || []).length;
  return { opens, closes, balanced: opens === closes };
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

// ---------------------------------------------------------------------------
// The blocks below were added by the S276 PA-direct fix round. Every one of
// them is a shape the first two dispatches did NOT have a fixture for — which
// is why a green suite shipped two BLOCKING regressions. The defects were all
// found adversarially, not by the suite; these pin them.
// ---------------------------------------------------------------------------

describe("§6 — the composed document stays BALANCED (the slot close is depth-counted)", () => {
  // The slot close was found with `indexOf('</' + slotTag + '>')`. That is safe
  // only while the slot is always `<main>` (unnestable per HTML5) AND always
  // empty at emit time. Both stopped being true: the slot demotes to `<div>`
  // (cases 2/3) and `<outlet>` accepts placeholder children. A `<div>` slot
  // holding a `<div>` then terminated on the INNER close, splicing the route
  // body above the real close tag — reparenting later siblings out of their
  // container and silently dropping the slot's remaining children, with a
  // clean compile and no diagnostic.

  test("an `<outlet>` carrying PLACEHOLDER CHILDREN composes balanced", () => {
    const { errors, read } = buildDir("splice-outlet-children", {
      "index.scrml":
        `<program>\n  <main>\n    <outlet><div class="ph">skeleton</div><p>TAIL</p></outlet>\n  </main>\n</program>\n`,
      "pages/about.scrml": `<page>\n  <h2>About</h2>\n</page>\n`,
    });
    expect(errors).toEqual([]);
    const about = read("about.html");
    expect(about).not.toBeNull();
    expect(tagBalance(about, "div").balanced).toBe(true);
    expect(tagBalance(about, "main").balanced).toBe(true);
    expect(mainCount(about)).toBe(1);
    // The route body REPLACES the slot's children, so the placeholder is gone —
    // and, critically, has not leaked OUTSIDE the slot where the runtime swap
    // (`querySelector("[data-scrml-outlet]")`) could never clear it.
    expect(about).not.toContain("TAIL");
    expect(about).toContain("About");
  });

  test("a DEMOTED `<div>` slot containing `<div>`s keeps following siblings inside their container", () => {
    const { errors, read } = buildDir("splice-div-slot", {
      "index.scrml":
        `<program>\n  <div class="layout">\n    <outlet><main>ph</main><div>b</div></outlet>\n    <footer>foot</footer>\n  </div>\n</program>\n`,
      "pages/reports.scrml": `<page>\n  <h2>R</h2>\n</page>\n`,
    });
    expect(errors).toEqual([]);
    const reports = read("reports.html");
    expect(reports).not.toBeNull();
    expect(tagBalance(reports, "div").balanced).toBe(true);
    // The stray close previously terminated `.layout`, hoisting `<footer>` out.
    expect(reports).toContain("foot");
  });

  test("an AUTHOR-WRITTEN `data-scrml-outlet` marker with children composes balanced", () => {
    const { errors, read } = buildDir("splice-author-marker", {
      "index.scrml":
        `<program>\n  <h1>Shell</h1>\n  <div data-scrml-outlet>\n    <div>alpha</div>\n    <div>beta</div>\n  </div>\n  <footer>foot</footer>\n</program>\n`,
      "pages/reports.scrml": `<page>\n  <h2>R</h2>\n</page>\n`,
    });
    expect(errors).toEqual([]);
    const reports = read("reports.html");
    expect(reports).not.toBeNull();
    expect(tagBalance(reports, "div").balanced).toBe(true);
    expect(reports).toContain("foot");
  });
});

describe("§7 — the landmark decision is DOCUMENT-scoped, not invocation-scoped", () => {
  // `generateHtml` is RE-ENTERED with `arm.body` for engine/match arm bodies.
  // Scoping "does the document have an author `<main>`?" to that invocation's
  // subtree made an `<outlet>` inside an arm blind to a `<main>` wrapping the
  // whole match — it took the `<main>` landmark, and the arm dispatcher then
  // injects it INSIDE the author `<main>`: nested `<main>` on initial paint, in
  // the shape CASE 2 blesses as legal.
  //
  // NOTE the assertion target: an arm body is lowered into the CLIENT CHUNK,
  // not the static HTML. A `.html`-only oracle is structurally blind here.

  test("an `<outlet>` inside a match ARM, wrapped by an author `<main>`, demotes to a `<div>`", () => {
    const { errors, read } = buildDir("arm-scoped-landmark", {
      "app.scrml":
        `<program>\n` +
        `    \${\n        type Phase:enum = { A, B }\n        <phase>: Phase = .A\n    }\n` +
        `    <main>\n        <h1>Shell</h1>\n` +
        `        <match for=Phase on=@phase>\n` +
        `            <A>\n                <outlet/>\n            </>\n` +
        `            <B>\n                <p>b</p>\n            </>\n` +
        `        </match>\n    </main>\n</program>\n`,
    });
    expect(errors).toEqual([]);
    const clientJs = read("app.client.js");
    expect(clientJs).not.toBeNull();
    // The arm's marker must be a <div>: the author <main> owns the landmark.
    expect(clientJs).toMatch(/<div data-scrml-outlet/);
    expect(clientJs).not.toMatch(/<main data-scrml-outlet/);
  });
});

describe("§8 — shell-boundary scoping + the bare-`<main>` static path", () => {
  test("a NESTED `<program>`'s outlet does not exempt the OUTER shell's sibling `<main>` (CASE 4 still fires)", () => {
    // The open-mains path leaked across the shell boundary, so the inner
    // shell's outlet marked the outer `<main>` as "wrapping" and silenced a
    // textbook case-4 shell.
    const { errors } = buildDir("nested-program-case4", {
      "app.scrml":
        `<program>\n  <main>\n    <program><outlet/></program>\n  </main>\n  <outlet/>\n</program>\n`,
    });
    expect(errors.some((e) => e.code === "E-OUTLET-AND-MAIN")).toBe(true);
  });

  // A nested `<program>` is "a completely isolated compilation unit [that] does
  // NOT inherit any lexical bindings from its parent `<program>`" (SPEC §4.12.1).
  // Route scope inherited from an OUTER `<page>` is exactly such an inheritance,
  // so it must stop at the shell boundary — the twin of the open-mains reset
  // asserted by the test above. The k01/k02 pair below is minimal: identical
  // inner shell, identical inner violation, differing ONLY in whether the
  // wrapper is a `<div>` or a `<page>`. Both must fire; before the fix k02 was
  // silent, because `inRouteScope` latched true for the whole `<page>` subtree
  // and the inner shell's `<main>` was never collected at all.
  const INNER_SHELL_CASE4 = (wrapper) =>
    `<program>\n  <outlet/>\n  <${wrapper}>\n    <program name="w"><outlet/><main>inner bare</main></program>\n  </${wrapper}>\n</program>\n`;

  test("k01 — a nested `<program>` inside a `<div>`: the INNER shell's case-4 fires (guard)", () => {
    const { errors } = buildDir("nested-program-in-div-case4", {
      "app.scrml": INNER_SHELL_CASE4("div"),
    });
    const d = diagsOf(errors, "E-OUTLET-AND-MAIN");
    // Exactly one: the INNER `<main>`. The outer shell owns no shell-scope
    // `<main>` at all (the inner one re-parents to the inner shell), so a count
    // of 2 here would mean the shell attribution itself had broken.
    expect(d.length).toBe(1);
    expect(d[0].span.line).toBe(4);
  });

  test("k02 — a nested `<program>` inside a `<page>`: route scope RESETS at the shell boundary (§4.12.1)", () => {
    const { errors } = buildDir("nested-program-in-page-case4", {
      "app.scrml": INNER_SHELL_CASE4("page"),
    });
    const d = diagsOf(errors, "E-OUTLET-AND-MAIN");
    expect(d.length).toBe(1);
    expect(d[0].span.line).toBe(4);
  });

  test("a `<page>`-scoped `<main>` NOT inside a nested shell still does not fire (case 3 preserved)", () => {
    // The guard on the fix above: resetting route scope at a `<program>`
    // boundary must not leak into resetting it at a plain element boundary.
    // Without a nested shell, a `<main>` under a `<page>` is route content and
    // stays exempt no matter how deeply it is wrapped.
    const { errors } = buildDir("page-main-nested-in-div", {
      "app.scrml":
        `<program>\n  <outlet/>\n  <page>\n    <div><section><main>route</main></section></div>\n  </page>\n</program>\n`,
    });
    expect(diagsOf(errors, "E-OUTLET-AND-MAIN").length).toBe(0);
  });

  test("an EMPTY bare `<main></main>` slot composes (it is still a slot)", () => {
    // Behaviour CHANGED by this PR (the `>` -> `>=` slot-bounds fix): before it,
    // an empty bare `<main></main>` shell silently no-op'd composition and the
    // route pages emitted standalone with no shell chrome at all. Pinned here
    // because the PR's own comments claimed this path was untouched.
    const { errors, read } = buildDir("empty-bare-main", {
      "index.scrml": `<program>\n<h1>Shell</h1>\n<main></main>\n<footer>f</footer>\n</program>\n`,
      "pages/about.scrml": `<page>\n<h2>About</h2>\n</page>\n`,
    });
    expect(errors).toEqual([]);
    const about = read("about.html");
    expect(about).not.toBeNull();
    expect(mainCount(about)).toBe(1);
    expect(about).toContain("About");
    expect(about).toContain("<footer>f");
  });

  test("an UPPERCASE `<MAIN>` bare slot composes (tag match is case-insensitive)", () => {
    // Also changed by this PR: the pre-existing bare-slot regex was
    // case-sensitive. Strictly an improvement, but unclaimed and untested.
    const { errors, read } = buildDir("uppercase-bare-main", {
      "index.scrml": `<program>\n<h1>Shell</h1>\n<MAIN>ph</MAIN>\n</program>\n`,
      "pages/about.scrml": `<page>\n<h2>About</h2>\n</page>\n`,
    });
    expect(errors).toEqual([]);
    const about = read("about.html");
    expect(about).not.toBeNull();
    expect(about).toContain("About");
    expect(about).toContain("Shell");
  });
});

describe("§9 — an outlet PLACEHOLDER `<main>` is not the document's landmark", () => {
  // `treeHasAuthorMain` counts every `<main>` in the tree, including one inside
  // an `<outlet>` body. Composition DISCARDS the slot's children, so such a
  // `<main>` never reaches the composed document — counting it demoted the slot
  // and left every composed route with ZERO landmarks (base emitted one).
  // The correction lives at composition time, which is the only place that
  // knows whether the placeholder survives.

  test("a placeholder `<main>` inside the `<outlet>` does NOT demote the composed slot", () => {
    const { errors, read } = buildDir("outlet-placeholder-main", {
      "app.scrml":
        `<program>\n<header>HDR</header>\n<outlet><main>PLACEHOLDER-MAIN</main></outlet>\n<footer>FTR</footer>\n</program>\n`,
      "pages/r.scrml": `<page>\n<h1>ROUTE-NO-MAIN</h1>\n</page>\n`,
    });
    expect(errors).toEqual([]);
    const r = read("r.html");
    expect(r).not.toBeNull();
    expect(mainCount(r)).toBe(1);
    expect(tagBalance(r, "main").balanced).toBe(true);
    // The placeholder is replaced by the route body, not carried through.
    expect(r).not.toContain("PLACEHOLDER-MAIN");
    expect(r).toContain("ROUTE-NO-MAIN");
  });

  test("but a placeholder that actually RENDERS (no route composes in) keeps the slot demoted", () => {
    // Single-file shell, no `pages/` — nothing replaces the placeholder, so it
    // is a real rendered `<main>` and the slot must stay a `<div>`. This is the
    // shape that makes "just skip `<outlet>` bodies" the wrong fix.
    const { errors, read } = buildDir("outlet-placeholder-renders", {
      "app.scrml":
        `<program>\n<h1>Solo</h1>\n<outlet><main>PLACEHOLDER-MAIN</main></outlet>\n</program>\n`,
    });
    expect(errors).toEqual([]);
    const app = read("app.html");
    expect(app).not.toBeNull();
    expect(mainCount(app)).toBe(1);
    expect(markerOpenTag(app)).toMatch(/^<div\b/);
    expect(app).toContain("PLACEHOLDER-MAIN");
  });
});

// ---------------------------------------------------------------------------
// §10 — the COLLECTOR'S REACH. SYM PASS 15.5 (`collectOutlets`, symbol-table.ts)
// used to descend a hand-listed edge set; its emit-side twin `treeHasAuthorMain`
// (codegen/emit-html.ts) has always been a TOTAL walk. So the two disagreed
// about which `<main>` elements exist, and every shape below compiled CLEAN
// while emit demoted the slot on account of a `<main>` the collector could not
// see — leaving documents with ZERO rendered landmarks.
//
// The missed edges were `armBodyChildren` (match block-form arms),
// `bodyChildren` (engine state-children AND `<each>` bodies) and
// `templateChildren`. The header comment claimed coverage of "arms[].body",
// an edge name those node kinds do not carry.
//
// The collector is now a total walk too. These pin BOTH halves: the diagnostic
// fires, AND (for the legal shapes) the emitted document carries exactly one
// rendered landmark.
// ---------------------------------------------------------------------------

/** A `${...}` logic block declaring the enum + cell the match fixtures drive. */
const PHASE_DECLS = `\${\n  type Phase:enum = { A, B }\n  <phase>: Phase = .A\n}`;
/** Engines auto-declare their own cell from `for=`/`initial=` — type only. */
const PHASE_TYPE_ONLY = `\${\n  type Phase:enum = { A, B }\n}`;

describe("§10 — `<main>` / `<outlet>` inside match arms + engine state-children", () => {
  // Every assertion below pins the diagnostic COUNT and the reported LINE, not
  // just "the code appears somewhere". The one-bit `.some(…)` form is what let
  // the degenerate-span defect ship: all of these reported L1:C1 (the
  // `<program>` open tag) while passing a green suite.

  test("a `<main>` in a NON-INITIAL match block-form arm fires E-OUTLET-AND-MAIN once, at the match", () => {
    // The zero-landmark case in its purest form: arm `<B>` does not render on
    // first paint, but emit's total walk saw its `<main>` and demoted the slot,
    // so the composed document carried NO landmark at all. Verified pre-fix:
    // codes=[] and rendered mainCount === 0.
    const { errors } = buildDir("arm-main-fires", {
      "app.scrml":
        `<program>\n${PHASE_DECLS}\n<outlet/>\n<match for=Phase on=@phase>\n` +
        `<A>\n<p>a</p>\n</>\n<B>\n<main>arm main</main>\n</>\n</match>\n</program>\n`,
    });
    const d = diagsOf(errors, "E-OUTLET-AND-MAIN");
    expect(d).toHaveLength(1);
    // L7 is the `<match>` opener. The `<main>` itself is at L12, but a
    // match-arm subtree is sub-parsed and its spans are never rebased to file
    // coordinates, so the pass falls back to the nearest enclosing node with a
    // real span. L7 puts the author on the right construct; L1 did not.
    expect(d[0].span.line).toBe(7);
  });

  test("a `<main>` in an ENGINE STATE-CHILD fires E-OUTLET-AND-MAIN once, on the `<main>` itself", () => {
    // Engine state-child bodies hang off `bodyChildren[i].children[j]` — an edge
    // the allow-list never carried. Landmark count here is state-DEPENDENT:
    // 1 in the initial state, 0 after any transition. Still case 4.
    // Engine state-child spans ARE rebased, so this one is exact.
    const { errors } = buildDir("engine-main-fires", {
      "app.scrml":
        `<program>\n${PHASE_TYPE_ONLY}\n<outlet/>\n<engine for=Phase initial=.A>\n` +
        `<A rule=.B><main>engine main</main></>\n<B rule=.A><p>b</p></>\n</engine>\n</program>\n`,
    });
    const d = diagsOf(errors, "E-OUTLET-AND-MAIN");
    expect(d).toHaveLength(1);
    expect(d[0].span.line).toBe(7);
    expect(d[0].span.col).toBe(12);
  });

  test("a SECOND `<outlet>` in a match arm counts toward E-OUTLET-DUPLICATE, exactly once", () => {
    // The V1 count ruling is STATIC across all edges: two outlets in mutually
    // exclusive arms are still a duplicate. The pass header recorded that ruling
    // verbatim while the walk did not implement it. Exactly ONE fires — the
    // first outlet is canonical and stays silent.
    const { errors } = buildDir("arm-outlet-dup", {
      "app.scrml":
        `<program>\n${PHASE_DECLS}\n<outlet/>\n<match for=Phase on=@phase>\n` +
        `<A>\n<outlet/>\n</>\n<B>\n<p>b</p>\n</>\n</match>\n</program>\n`,
    });
    const d = diagsOf(errors, "E-OUTLET-DUPLICATE");
    expect(d).toHaveLength(1);
    expect(d[0].span.line).toBe(7);
  });

  test("a SECOND `<outlet>` in an engine state-child counts toward E-OUTLET-DUPLICATE, exactly once", () => {
    // Pre-fix this compiled clean AND emitted TWO rendered
    // `<main data-scrml-outlet>` landmarks — both outlets took the landmark
    // because neither walker could see the other.
    const { errors } = buildDir("engine-outlet-dup", {
      "app.scrml":
        `<program>\n${PHASE_TYPE_ONLY}\n<outlet/>\n<engine for=Phase initial=.A>\n` +
        `<A rule=.B><outlet/></>\n<B rule=.A><p>b</p></>\n</engine>\n</program>\n`,
    });
    const d = diagsOf(errors, "E-OUTLET-DUPLICATE");
    expect(d).toHaveLength(1);
    expect(d[0].span.line).toBe(7);
    expect(d[0].span.col).toBe(12);
  });

  test("a SECOND `<outlet>` in an `<each>` body counts toward E-OUTLET-DUPLICATE, exactly once", () => {
    // Found by probe while verifying the brief's premise: `<each>` bodies hang
    // off `bodyChildren`/`templateChildren` (ast-builder.js) — a THIRD missed
    // edge name beyond the two the dispatch was scoped around, and the reason
    // the fix is a total walk rather than three appended edge names.
    const { errors } = buildDir("each-outlet-dup", {
      "app.scrml":
        `<program>\n<rows> = ["a"]\n<outlet/>\n<each in=@rows><outlet/></each>\n</program>\n`,
    });
    const d = diagsOf(errors, "E-OUTLET-DUPLICATE");
    expect(d).toHaveLength(1);
    expect(d[0].span.line).toBe(4);
  });

  test("REGRESSION GUARD — a COMPONENT-mounted `<main>` stays legal and yields exactly ONE landmark", () => {
    // Row 4 of the ruling table and the one shape that must NOT fire. A
    // component's `<main>` is not in the SYM AST at all (raw text pre-expansion),
    // so the placement pass cannot see it — BY DESIGN, per SPEC §20.8.1.1. The
    // component's `<main>` takes the landmark, the slot demotes to a `<div>`,
    // and the document carries exactly one. Firing here would reject a program
    // that compiles to valid, accessible HTML.
    const { errors, read } = buildDir("component-main-legal", {
      "app.scrml":
        `<program>\n` +
        `const Shell = <div class="shell">\n<main class="cmp">\${children}</main>\n</>\n` +
        `<outlet/>\n<Shell><p>inside</p></Shell>\n</program>\n`,
    });
    expect(errors.some((e) => e.code === "E-OUTLET-AND-MAIN")).toBe(false);
    expect(errors.some((e) => String(e.code).startsWith("E-OUTLET-"))).toBe(false);
    const html = read("app.html");
    expect(html).not.toBeNull();
    // Assert the COUNT, not merely the absence of a diagnostic.
    expect(mainCount(html)).toBe(1);
    expect(tagBalance(html, "main").balanced).toBe(true);
  });
});

describe("§10b — the landmark tag test is CASE-INSENSITIVE, but not naively", () => {
  // HTML element names are ASCII case-insensitive, and the compiler passes an
  // unrecognized capitalized tag through to the output verbatim — so `<MAIN>`
  // really reaches the document and really is a landmark to a browser. Both
  // walkers used `=== "main"` and could not see it; `mainCount` used `/g` and
  // scored the resulting two-landmark document as a compliant 1.
  //
  // The guard matters as much as the fix: in scrml a CAPITALIZED tag is a
  // COMPONENT reference, and ast-builder classifies component-vs-element by
  // capitalization ALONE, so `<MAIN>` and a user's `<Main/>` both arrive with
  // `isComponent: true`. A bare `toLowerCase()` test rejects legal programs.
  // The discriminator is NR's `resolvedKind` (src/landmark-tag.ts).

  test("`<MAIN>` alongside an `<outlet>` fires E-OUTLET-AND-MAIN once", () => {
    const { errors } = buildDir("uppercase-main-fires", {
      "app.scrml": `<program>\n<outlet/>\n<MAIN>m</MAIN>\n</program>\n`,
    });
    const d = diagsOf(errors, "E-OUTLET-AND-MAIN");
    expect(d).toHaveLength(1);
    expect(d[0].span.line).toBe(3);
  });

  test("a DEFINED component named `Main` is NOT the landmark (no false positive)", () => {
    // Legal, working program: compiles clean, emits exactly one landmark (the
    // outlet's). A naive case-insensitive tag test fires E-OUTLET-AND-MAIN here
    // and, on the emit side, demotes the slot so the document renders ZERO.
    const { errors, read } = buildDir("component-named-main", {
      "app.scrml":
        `<program>\nconst Main = <div class="cmp">c</>\n<outlet/>\n<Main/>\n</program>\n`,
    });
    expect(errors).toEqual([]);
    const html = read("app.html");
    expect(mainCount(html)).toBe(1);
    // The slot keeps the landmark — nothing else claims it.
    expect(markerOpenTag(html)).toMatch(/^<main\b/i);
  });

  test("a component named `Main` that CONTAINS a `<main>` still resolves to one landmark", () => {
    // Component expansion is the case-3 family per SPEC §20.8.1.1: the
    // component's `<main>` takes the landmark and the slot demotes. No
    // diagnostic, exactly one landmark.
    const { errors, read } = buildDir("component-main-inner", {
      "app.scrml":
        `<program>\nconst Main = <div class="cmp"><main>inner</main></>\n<outlet/>\n<Main/>\n</program>\n`,
    });
    expect(errors).toEqual([]);
    const html = read("app.html");
    expect(mainCount(html)).toBe(1);
    expect(markerOpenTag(html)).toMatch(/^<div\b/i);
  });
});

describe("§10c — KNOWN GAPS (pre-existing, filed, deliberately not asserted green)", () => {
  // These two shapes are BROKEN on base and on tip alike. They are recorded
  // here as skips rather than as passing assertions on purpose: a green test
  // pinning today's broken output turns the eventual fix RED and reads to a
  // future maintainer as intent. (S276 precedent — a test titled "…(nested)
  // ALSO fires" locked in an overreach exactly that way.)

  test.skip("GAP: an `<each>` NESTED IN A MATCH ARM is absent from the AST at PASS 15.5", () => {
    // `<program>… <outlet/> <match><B><each in=@rows><main>m</main></each></></match>`
    // compiles silent and the slot stays `<main data-scrml-outlet>`. BOTH
    // walkers miss it, so they agree — on the wrong answer. `<each>` at top
    // level, in an engine state-child, and in another `<each>` all DO fire, so
    // this is an AST-completeness / pass-ordering gap, not a walker gap.
  });

  test.skip("GAP: an `if=`-guarded `<main>` wrapping the outlet renders ZERO landmarks", () => {
    // `<main if=@show><outlet/></main>` emits an entirely EMPTY body — the
    // whole subtree INCLUDING the slot is entombed in a `<template>`, so there
    // is no addressable `[data-scrml-outlet]` in live DOM at all. `<page>` +
    // `<main if=>` likewise demotes the slot and renders zero landmarks.
  });
});

describe("§11 — the invariant itself, asserted on emitted HTML", () => {
  // The S276 review found a test oracle that counted `<main` over the raw body
  // and so shared the implementation's blind spot, letting an entire
  // zero-landmark class through 16 green tests. `mainCount` strips
  // `<template>` / `<script>` / `<style>` / comments before counting, so it
  // counts RENDERED landmarks only — re-verified above before reuse here.
  //
  // Every LEGAL shape in this suite must land on exactly one. A shape that
  // fires a diagnostic is exempt (it never reaches an emitted document).

  const legalShapes = {
    "outlet alone": {
      files: { "app.scrml": `<program>\n<h1>S</h1>\n<outlet/>\n</program>\n` },
      doc: "app.html",
    },
    "author `<main>` WRAPPING the outlet (case 2)": {
      files: { "app.scrml": `<program>\n<main><outlet/></main>\n</program>\n` },
      doc: "app.html",
    },
    "`<page>`-scoped `<main>`, single-file (case 3a)": {
      files: {
        "app.scrml":
          `<program>\n<nav>chrome</nav>\n<outlet/>\n<page><main class="route">R</main></page>\n</program>\n`,
      },
      doc: "app.html",
    },
    "multi-file route bringing its own `<main>` (case 3b)": {
      files: {
        "index.scrml": `<program>\n<h1>Shell</h1>\n<outlet/>\n</program>\n`,
        "pages/reports.scrml": `<page>\n<main class="route"><h2>R</h2></main>\n</page>\n`,
      },
      doc: "reports.html",
    },
    "multi-file route with NO `<main>` (slot keeps the landmark)": {
      files: {
        "index.scrml": `<program>\n<h1>Shell</h1>\n<outlet/>\n</program>\n`,
        "pages/about.scrml": `<page>\n<h2>About</h2>\n</page>\n`,
      },
      doc: "about.html",
    },
    "bare `<main>` static back-compat, no outlet": {
      files: {
        "index.scrml": `<program>\n<h1>Static</h1>\n<main>ph</main>\n</program>\n`,
        "pages/reports.scrml": `<page>\n<h2>R</h2>\n</page>\n`,
      },
      doc: "reports.html",
    },
    "outlet with placeholder children, composed": {
      files: {
        "index.scrml": `<program>\n<main>\n<outlet><div class="ph">sk</div></outlet>\n</main>\n</program>\n`,
        "pages/about.scrml": `<page>\n<h2>About</h2>\n</page>\n`,
      },
      doc: "about.html",
    },
    "component-mounted `<main>` (row 4 — legal, no diagnostic)": {
      files: {
        "app.scrml":
          `<program>\n` +
          `const Shell = <div class="shell">\n<main class="cmp">\${children}</main>\n</>\n` +
          `<outlet/>\n<Shell><p>inside</p></Shell>\n</program>\n`,
      },
      doc: "app.html",
    },
  };

  for (const [name, { files, doc }] of Object.entries(legalShapes)) {
    test(`exactly ONE rendered <main> — ${name}`, () => {
      const id = "inv-" + name.replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, 40);
      const { errors, read } = buildDir(id, files);
      // Legal shape: it must compile clean, otherwise it is exempt for the
      // wrong reason and this row is not testing what it claims to test.
      expect(errors).toEqual([]);
      const html = read(doc);
      expect(html).not.toBeNull();
      expect(mainCount(html)).toBe(1);
      expect(tagBalance(html, "main").balanced).toBe(true);
    });
  }
});
