/**
 * Browser tests — a soft navigation SHALL leave the reader looking at a page
 * that is STYLED BY ITS OWN STYLESHEET (§20.8.2 step 2 + §20.8.5(6)), and a
 * navigation that never commits SHALL leave no history entry (§20.8.8 item 1).
 *
 * Reported against scrml.dev, the language's own documentation site: every
 * in-site click landed on a page of unstyled text, and only a hard reload
 * recovered. The compiler emits ONE STYLESHEET PER PAGE, so the incoming markup
 * arrives with none of the utilities it needs; the site shipped `hard` on all
 * 551 internal links to opt out of soft nav entirely.
 *
 * ── WHY THESE TESTS ARE SHAPED THE WAY THEY ARE ────────────────────────────
 *
 * The reporter's own gate asserted that a `window` stamp SURVIVED an in-site
 * click — i.e. that soft navigation HAPPENED — and reported 6/6 green while the
 * page rendered as unstyled text. It was validating the exact mechanism that was
 * breaking the page.
 *
 * So every assertion below reads a READER-VISIBLE OUTCOME: `getComputedStyle`
 * on an element the reader is looking at. NONE of them assert that a sync
 * function ran, that a <link> node exists, that a marker is present, or that a
 * sheet's href has some shape — every one of those goes green on a broken page.
 * If you add a test here, hold it to the same bar.
 *
 * ── WHAT IS REAL AND WHAT IS A HOST SHIM ───────────────────────────────────
 *
 * REAL: the fixture is compiled by `compileScrml` and served from disk over a
 * real HTTP server. The stylesheet urls, filenames and DEPTHS are the
 * compiler's own — `/` ships `app.css` while `/reference/auth` ships
 * `../app.css` FOR THE SAME FILE, which is precisely the topology that broke.
 * happy-dom really fetches each `<link rel="stylesheet">`, really parses it, and
 * really feeds `getComputedStyle`.
 *
 * SHIM 1 — the server must be `node:http`, NOT `Bun.serve`: happy-dom's internal
 * resource fetch uses node's http client and fails `Parse Error` against
 * `Bun.serve`.
 *
 * SHIM 2 — happy-dom (20.x) does not implement CSS CASCADE LAYERS: rules inside
 * `@layer { … }` parse but never match in `getComputedStyle`. The compiler emits
 * every authored rule inside `@layer global { … }`, so serving the bytes
 * verbatim would render EVERY page unstyled and the suite could not tell a
 * working swap from a broken one. The layers are therefore unwrapped IN THE
 * TRANSPORT (`unwrapCascadeLayers`). The urls, filenames and depths — the thing
 * under test — are untouched, and the rules the assertions read are the
 * compiler's own, not synthetic ones.
 *
 * SHIM 3 — classic `<script src>` execution is intercepted and run in one shared
 * eval scope (the established pattern from browser-navigate-cross-chunk.test.js;
 * happy-dom disables script file loading, and `(0,eval)` does not share
 * `const`/`let` across calls the way real classic scripts do). `<link>` appends
 * are NOT intercepted — those go to happy-dom and really load.
 *
 * NOTE: the browser suite is NOT in the pre-commit gate (unit/integration/
 * conformance); it runs pre-push / CI.
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync, rmSync } from "fs";
import { join, extname } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { SCRML_RUNTIME } from "../../src/runtime-template.js";

if (!globalThis.document) GlobalRegistrator.register();

// ---------------------------------------------------------------------------
// Fixture — a <program> shell with an <outlet/> and three routes at TWO dist
// depths. This is the reporter's shape, not a synthetic two-page pair.
//
//   dist/index.html            links index.css    + app.css
//   dist/learn.html            links learn.css    + app.css
//   dist/reference/auth.html   links auth.css     + ../app.css   <- same file,
//                                                                   other depth
// ---------------------------------------------------------------------------

// The colours each page's OWN sheet paints. Every assertion is one of these.
const HOME_TEXT  = "rgb(11, 11, 11)";
const LEARN_TEXT = "rgb(22, 22, 22)";
const AUTH_TEXT  = "rgb(33, 33, 33)";
const SHELL_TEXT = "rgb(44, 44, 44)";   // from app.css — the sheet at two depths
const HOME_ONLY_SHELL_BG = "rgb(99, 99, 99)";  // index.css paints a SHELL element
const AUTH_ONLY_SHELL_BG = "rgb(77, 77, 77)";  // auth.css  paints a SHELL element

const SHELL_SRC = `<program>
<header class="site-header"><h1 id="shell-h1">SHELL_HEADER</h1>
<a href="/" id="lk-home">Home</a>
<a href="/learn" id="lk-learn">Learn</a>
<a href="/reference/auth" id="lk-auth">Auth</a>
<a href="/gone" id="lk-gone">Gone</a>
<a href="/learn/" id="lk-learn-slash">Learn slash</a>
</header>
<outlet/>
<footer><p>SHELL_FOOTER</p></footer>
</program>

#{
  #shell-h1 { color: ${SHELL_TEXT}; }
}
`;

function pageSrc(cls, text, colour, extraCss) {
  return `<page>
<article><p class="${cls}" id="body-p">${text}</p></article>
</page>

#{
  .${cls} { color: ${colour}; }
${extraCss || ""}
}
`;
}

let ROOT_DIR = null;
let DIST = null;

function buildFixture() {
  ROOT_DIR = mkdtempSync(join(tmpdir(), "soft-nav-sheet-"));
  mkdirSync(join(ROOT_DIR, "pages", "reference"), { recursive: true });
  writeFileSync(join(ROOT_DIR, "app.scrml"), SHELL_SRC);
  writeFileSync(
    join(ROOT_DIR, "pages", "index.scrml"),
    pageSrc("home-only", "HOME_CONTENT", HOME_TEXT, `  #shell-h1 { background-color: ${HOME_ONLY_SHELL_BG}; }`),
  );
  writeFileSync(join(ROOT_DIR, "pages", "learn.scrml"), pageSrc("learn-only", "LEARN_CONTENT", LEARN_TEXT));
  writeFileSync(
    join(ROOT_DIR, "pages", "reference", "auth.scrml"),
    pageSrc("auth-only", "AUTH_CONTENT", AUTH_TEXT, `  #shell-h1 { background-color: ${AUTH_ONLY_SHELL_BG}; }`),
  );

  DIST = join(ROOT_DIR, "dist");
  const result = compileScrml({
    inputFiles: [
      join(ROOT_DIR, "app.scrml"),
      join(ROOT_DIR, "pages", "index.scrml"),
      join(ROOT_DIR, "pages", "learn.scrml"),
      join(ROOT_DIR, "pages", "reference", "auth.scrml"),
    ],
    outputDir: DIST,
    write: true,
    log: () => {},
  });
  if (result.errors.length > 0) {
    throw new Error("fixture failed to compile: " + JSON.stringify(result.errors));
  }
  // Guard the PREMISE of this whole file: if the compiler ever stops emitting
  // the shell sheet at two different depths, these tests silently stop covering
  // the defect. Fail loudly instead.
  const authHtml = readFileSync(join(DIST, "reference", "auth.html"), "utf8");
  const indexHtml = readFileSync(join(DIST, "index.html"), "utf8");
  if (!/href="\.\.\/app\.css"/.test(authHtml) || !/href="app\.css"/.test(indexHtml)) {
    throw new Error(
      "fixture premise broken: the shell stylesheet is no longer emitted at two depths " +
      "(expected `app.css` at / and `../app.css` at /reference/auth)",
    );
  }
}

// ---------------------------------------------------------------------------
// SHIM 2 — strip CSS cascade layers so happy-dom can match the compiler's rules.
// `@layer a, b;` statements are dropped; `@layer name { … }` blocks are replaced
// by their body. Balanced-brace scan; safe on machine-generated CSS.
// ---------------------------------------------------------------------------
function unwrapCascadeLayers(css) {
  let out = "";
  let i = 0;
  for (;;) {
    const at = css.indexOf("@layer", i);
    if (at === -1) { out += css.slice(i); return out; }
    out += css.slice(i, at);
    let j = at + "@layer".length;
    while (j < css.length && css[j] !== "{" && css[j] !== ";") j++;
    if (j >= css.length) return out;
    if (css[j] === ";") { i = j + 1; continue; }   // a plain @layer declaration
    let depth = 0;
    let k = j;
    for (; k < css.length; k++) {
      if (css[k] === "{") depth++;
      else if (css[k] === "}") { depth--; if (depth === 0) break; }
    }
    out += css.slice(j + 1, k);                    // the block body, unwrapped
    i = k + 1;
  }
}

// ---------------------------------------------------------------------------
// Static host. Mirrors a real static deploy's directory-index ladder, and adds
// the two failure shapes the history-entry tests need:
//   /gone   -> 404          (a soft nav that cannot commit)
//   /learn/ -> 301 /learn   (the directory-index redirect the reporter hit)
// ---------------------------------------------------------------------------
const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript" };

let server = null;
let BASE = "";
let requestLog = [];
// Artificial latency on stylesheet responses — the instrument for the
// "no unstyled flash" test. 0 for every other test.
let cssDelayMs = 0;

function startServer() {
  return new Promise((resolve) => {
    const s = createServer((req, res) => {
      const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
      requestLog.push(path);
      if (path === "/learn/") { res.writeHead(301, { location: "/learn" }); res.end(); return; }
      let file = join(DIST, path);
      if (path === "/" || path.endsWith("/")) file = join(DIST, path, "index.html");
      else if (!existsSync(file) || statSync(file).isDirectory()) {
        if (existsSync(file + ".html")) file = file + ".html";
        else if (existsSync(join(file, "index.html"))) file = join(file, "index.html");
      }
      if (!existsSync(file) || statSync(file).isDirectory()) {
        res.writeHead(404, { "content-type": "text/html" });
        res.end("<!DOCTYPE html><html><head><title>404</title></head><body>not found</body></html>");
        return;
      }
      const ext = extname(file);
      let body = readFileSync(file);
      if (ext === ".css") body = Buffer.from(unwrapCascadeLayers(body.toString("utf8")), "utf8");
      const send = () => {
        res.writeHead(200, { "content-type": MIME[ext] || "application/octet-stream" });
        res.end(body);
      };
      if (ext === ".css" && cssDelayMs > 0) setTimeout(send, cssDelayMs);
      else send();
    });
    s.listen(0, "127.0.0.1", () => resolve(s));
  });
}

// ---------------------------------------------------------------------------
// SHIM 3 — classic-script execution in one shared lexical scope.
// ---------------------------------------------------------------------------
let __loadRouteChunk = null;
let restoreAppend = null;
let chunkSources = null;

function chunkRegistry() {
  if (chunkSources) return chunkSources;
  chunkSources = {};
  for (const rel of ["app.client.js", "index.client.js", "learn.client.js", "reference/auth.client.js"]) {
    const p = join(DIST, rel);
    if (existsSync(p)) chunkSources[rel.split("/").pop()] = readFileSync(p, "utf8");
  }
  return chunkSources;
}

function installChunkLoader() {
  const head = document.head;
  const orig = head.appendChild.bind(head);
  restoreAppend = () => { head.appendChild = orig; };
  head.appendChild = function (node) {
    const src = node && node.getAttribute && node.getAttribute("src");
    if (node && String(node.tagName).toLowerCase() === "script" && src) {
      const name = src.split("/").pop();
      setTimeout(() => {
        const source = chunkRegistry()[name];
        try {
          if (source == null) throw new Error("no such chunk: " + name);
          __loadRouteChunk(source);
          if (typeof node.onload === "function") node.onload();
        } catch (e) {
          if (typeof node.onerror === "function") node.onerror();
        }
      }, 0);
      return node;   // deliberately NOT connected — happy-dom would refuse to load it
    }
    return orig(node);   // <link rel="stylesheet"> falls through and REALLY loads
  };
}

// Load a served page into the document exactly as a hard navigation would:
// real head (real stylesheet links), real body, real script markers, then the
// runtime + this page's chunks evaluated in one shared scope.
async function hardLoad(urlPath) {
  window.happyDOM.setURL(BASE + urlPath);
  const res = await fetch(BASE + urlPath);
  const html = await res.text();
  const headInner = (html.match(/<head[^>]*>([\s\S]*?)<\/head>/i) || ["", ""])[1];
  const bodyInner = (html.match(/<body[^>]*>([\s\S]*?)<\/body>/i) || ["", html])[1];
  const scriptSrcs = [...html.matchAll(/<script[^>]*src="([^"]+)"[^>]*>/g)].map((m) => m[1]);

  // The script tags stay in the head as INERT MARKERS: the runtime derives its
  // "already loaded" chunk set from them, keyed on resolved absolute url.
  document.head.innerHTML =
    headInner + scriptSrcs.map((s) => `<script src="${s}"></script>`).join("");
  document.body.innerHTML = bodyInner.replace(/<script[\s\S]*?<\/script>/gi, "");

  await waitForSheets();
  installChunkLoader();

  const reg = chunkRegistry();
  let code = SCRML_RUNTIME + "\n";
  for (const src of scriptSrcs) {
    const name = src.split("/").pop();
    if (reg[name]) code += reg[name] + "\n";
  }
  code += "globalThis.__scrml_test_route_loader = function (__chunkSrc) { eval(__chunkSrc); };\n";
  (0, eval)(code);
  __loadRouteChunk = globalThis.__scrml_test_route_loader;
  document.dispatchEvent(new Event("DOMContentLoaded"));
}

async function waitForSheets(ms = 4000) {
  const links = [...document.head.querySelectorAll('link[rel="stylesheet"]')];
  await Promise.all(links.map((l) => (l.sheet ? Promise.resolve() : new Promise((res) => {
    const done = () => res();
    l.addEventListener("load", done);
    l.addEventListener("error", done);
    setTimeout(done, ms);
  }))));
}

// Poll until `fn()` is truthy. A timeout throws with a NAMED reason rather than
// letting bun's 5 s default fire a bare `(fail)` marker (map invariant 56).
async function waitFor(fn, label, ms = 4000) {
  const started = Date.now();
  for (;;) {
    let value = false;
    try { value = fn(); } catch (e) { value = false; }
    if (value) return value;
    if (Date.now() - started > ms) throw new Error("timed out waiting for: " + label);
    await new Promise((r) => setTimeout(r, 5));
  }
}

function click(id) {
  const a = document.getElementById(id);
  if (!a) throw new Error("no such link: #" + id);
  a.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
}

const colourOf = (sel) => getComputedStyle(document.querySelector(sel)).color;
const bgOf = (sel) => getComputedStyle(document.querySelector(sel)).backgroundColor;
const bodyText = () => {
  const p = document.querySelector("#body-p");
  return p ? p.textContent : null;
};
const sheetCount = () => document.head.querySelectorAll('link[rel="stylesheet"]').length;

// ---------------------------------------------------------------------------
beforeAll(async () => {
  buildFixture();
  server = await startServer();
  BASE = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => {
  if (server) server.close();
  if (ROOT_DIR && existsSync(ROOT_DIR)) rmSync(ROOT_DIR, { recursive: true, force: true });
});

beforeEach(async () => {
  // A FRESH document per test — the shell boot registers a document-level
  // delegated click listener that would otherwise accumulate across tests and
  // double-fire (a happy-dom global-state leak).
  try { await GlobalRegistrator.unregister(); } catch (e) { /* not registered */ }
  GlobalRegistrator.register();
  restoreAppend = null;
  requestLog = [];
  cssDelayMs = 0;
});

afterEach(() => {
  if (restoreAppend) { restoreAppend(); restoreAppend = null; }
});

// ---------------------------------------------------------------------------
describe("§20.8.2 — a soft-navigated page renders with ITS OWN stylesheet", () => {
  test("HARD-LOAD CONTROL: each route is styled by its own sheet on a full load", async () => {
    await hardLoad("/");
    expect(bodyText()).toBe("HOME_CONTENT");
    expect(colourOf("#body-p")).toBe(HOME_TEXT);
    expect(colourOf("#shell-h1")).toBe(SHELL_TEXT);

    await hardLoad("/reference/auth");
    expect(bodyText()).toBe("AUTH_CONTENT");
    expect(colourOf("#body-p")).toBe(AUTH_TEXT);
    expect(colourOf("#shell-h1")).toBe(SHELL_TEXT);
  }, 30000);

  test("DOWN a level (/ -> /reference/auth): the reader sees the auth page's colour", async () => {
    await hardLoad("/");
    expect(colourOf("#body-p")).toBe(HOME_TEXT);

    click("lk-auth");
    await waitFor(() => bodyText() === "AUTH_CONTENT", "the auth route to swap in");

    // THE ASSERTION THAT MATTERS. Pre-fix this is HOME_TEXT (the outgoing page's
    // sheet is still the only one attached) or "" — never AUTH_TEXT.
    expect(colourOf("#body-p")).toBe(AUTH_TEXT);
    // …and the persistent shell is still styled by the sheet it shares with the
    // destination under a DIFFERENT relative spelling (app.css vs ../app.css).
    expect(colourOf("#shell-h1")).toBe(SHELL_TEXT);
  }, 30000);

  test("UP a level (/reference/auth -> /learn): the reader sees the learn page's colour", async () => {
    await hardLoad("/reference/auth");
    expect(colourOf("#body-p")).toBe(AUTH_TEXT);

    click("lk-learn");
    await waitFor(() => bodyText() === "LEARN_CONTENT", "the learn route to swap in");

    // The naive fix breaks in THIS direction: copying `learn.css` verbatim while
    // the live page is /reference/auth resolves it to /reference/learn.css.
    expect(colourOf("#body-p")).toBe(LEARN_TEXT);
    expect(colourOf("#shell-h1")).toBe(SHELL_TEXT);
  }, 30000);

  test("the destination's styles are live BEFORE its content is on screen (no unstyled flash)", async () => {
    await hardLoad("/");
    expect(bgOf("#shell-h1")).toBe(HOME_ONLY_SHELL_BG);

    // Hold every stylesheet response back. If the engine swaps without waiting,
    // there is a ~150 ms window in which the reader is looking at the auth
    // page's markup wearing the HOME page's styles — the flash. Sampling every
    // 5 ms cannot miss a window that wide.
    //
    // (A MutationObserver would be the obvious instrument and is NOT usable
    // here: happy-dom 20.8.9 delivers an observer's callback exactly ONCE per
    // observe() — verified directly — so a second mutation is silently dropped.)
    cssDelayMs = 150;
    let bgWhenContentFirstVisible = null;
    try {
      click("lk-auth");
      await waitFor(() => {
        const visible = /AUTH_CONTENT/.test(document.body.textContent || "");
        if (visible && bgWhenContentFirstVisible === null) {
          bgWhenContentFirstVisible = bgOf("#shell-h1");
        }
        return visible;
      }, "the auth route to become visible", 6000);
    } finally {
      cssDelayMs = 0;
    }

    // auth.css paints a SHELL element, so this reads the destination's styling
    // at the first instant the destination's content is on screen.
    expect(bgWhenContentFirstVisible).toBe(AUTH_ONLY_SHELL_BG);
    expect(colourOf("#body-p")).toBe(AUTH_TEXT);
  }, 30000);

  test("the outgoing page's rules stop applying to the shell after the swap", async () => {
    await hardLoad("/");
    // index.css paints the SHELL heading; the shell survives the swap, so if the
    // outgoing sheet is never retired the reader keeps seeing the home page's
    // styling on every subsequent route.
    expect(bgOf("#shell-h1")).toBe(HOME_ONLY_SHELL_BG);

    click("lk-learn");
    await waitFor(() => bodyText() === "LEARN_CONTENT", "the learn route to swap in");

    expect(bgOf("#shell-h1")).not.toBe(HOME_ONLY_SHELL_BG);
    expect(colourOf("#body-p")).toBe(LEARN_TEXT);
    expect(colourOf("#shell-h1")).toBe(SHELL_TEXT);
  }, 30000);

  test("navigating back and forth repeatedly neither unstyles the page nor accumulates sheets", async () => {
    await hardLoad("/");
    const initialSheets = sheetCount();

    for (let round = 0; round < 3; round++) {
      click("lk-auth");
      await waitFor(() => bodyText() === "AUTH_CONTENT", `round ${round}: auth to swap in`);
      expect(colourOf("#body-p")).toBe(AUTH_TEXT);

      click("lk-learn");
      await waitFor(() => bodyText() === "LEARN_CONTENT", `round ${round}: learn to swap in`);
      expect(colourOf("#body-p")).toBe(LEARN_TEXT);
    }

    expect(colourOf("#shell-h1")).toBe(SHELL_TEXT);
    // Each route needs exactly its own sheet + the shared shell sheet. Growing
    // past that means the engine re-attaches a sheet it already has — which is
    // what a string compare on `app.css` vs `../app.css` produces.
    expect(sheetCount()).toBe(initialSheets);
  }, 45000);
});

// ---------------------------------------------------------------------------
describe("§20.8.8 item 1 — a navigation that never commits leaves no history entry", () => {
  test("CONTROL: a navigation that DOES commit takes exactly one entry", async () => {
    await hardLoad("/");
    const before = history.length;

    click("lk-auth");
    await waitFor(() => bodyText() === "AUTH_CONTENT", "the auth route to swap in");

    expect(history.length).toBe(before + 1);
  }, 30000);

  test("a 404 target leaves the session history untouched", async () => {
    await hardLoad("/");
    const before = history.length;
    expect(bodyText()).toBe("HOME_CONTENT");

    click("lk-gone");
    await waitFor(() => requestLog.includes("/gone"), "the /gone fetch to be made");
    // Let the response settle and the hard-nav fallback run.
    await new Promise((r) => setTimeout(r, 60));

    // Pre-fix: the click pushed an entry for /gone BEFORE the fetch, then
    // hard-navigated on top of it — the entry named a url whose document was
    // never loaded, so the reader's first Back appeared to do nothing.
    expect(history.length).toBe(before);
  }, 30000);

  test("a redirecting target leaves the session history untouched", async () => {
    await hardLoad("/");
    const before = history.length;

    click("lk-learn-slash");
    await waitFor(() => requestLog.includes("/learn/"), "the /learn/ fetch to be made");
    await new Promise((r) => setTimeout(r, 60));

    // `/learn/` 301s to `/learn` — a plain directory-index redirect, which is
    // what any static host does for a route without a trailing slash. The
    // reporter measured history.length 5 -> 7 on ONE such click.
    expect(history.length).toBe(before);
  }, 30000);
});
