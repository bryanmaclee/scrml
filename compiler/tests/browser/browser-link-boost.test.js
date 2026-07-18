/**
 * §20.8.3 Link-boost (i27) — behavioral drive through the delegated listener.
 *
 * Compiles persistent-shell apps (`<program>` + `<outlet>`), loads the emitted
 * HTML + tree-shaken runtime + client body into happy-dom, then dispatches REAL
 * bubbling click events at anchors and asserts the delegated document listener's
 * branch decisions:
 *
 *   §1 internal same-origin cross-page link → `_scrml_navigate_soft` fires with
 *      the resolved path + the native navigation is prevented (soft swap).
 *   §2 `<a hard>` / external / modified-click / same-page `#hash` → NO soft
 *      dispatch, default NOT prevented → native navigation (pass-through set).
 *   §3 S239 HIGH regression — an author delegated `onclick` that calls
 *      `event.preventDefault()` runs BEFORE link-boost, so link-boost's
 *      `defaultPrevented` guard sees it and does NOT soft-nav (the listener
 *      REGISTRATION-ORDER fix: the compiled author onclick delegation registers
 *      before the compiled link-boost listener). This MUST use the REAL emitted
 *      client (both delegations), not a hand-registered listener, since it is a
 *      listener-ordering bug.
 *   §4 S239 LOW — an exact self-link (resolved target === current location, no
 *      hash) passes through to native (no re-fetch/re-swap of the live outlet).
 *
 * `_scrml_navigate_soft` / `_scrml_navigate` are stubbed to recorders so the
 * assertions observe the ROUTING decision without a live SSR fetch; the real
 * engine's swap pipeline is covered by the Wave-1b soft-nav tests. A fresh
 * happy-dom window per test isolates the shared `document`'s listener set.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { compileScrml } from "../../src/api.js";
import { writeFileSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function compileApp(src, base = "linkboost-app") {
  const tmp = mkdtempSync(join(tmpdir(), "lb-browser-"));
  const inFile = join(tmp, `${base}.scrml`);
  writeFileSync(inFile, src);
  const outDir = join(tmp, "dist");
  const result = compileScrml({ inputFiles: [inFile], outputDir: outDir });
  const html = readFileSync(join(outDir, `${base}.html`), "utf8");
  const clientJs = readFileSync(join(outDir, `${base}.client.js`), "utf8");
  let runtimeJs = "";
  for (const f of readdirSync(outDir)) {
    if (/^scrml-runtime\..*\.js$/.test(f)) runtimeJs += readFileSync(join(outDir, f), "utf8");
  }
  return { result, html, clientJs, runtimeJs };
}

/**
 * Compile `src`, load its emitted HTML + tree-shaken runtime + client body into
 * the (fresh) happy-dom window at `url`, stub the two nav entry points to
 * recorders, and fire the boot (DOMContentLoaded) so BOTH the author onclick
 * delegation AND the link-boost listener register — in their real emitted order.
 */
function loadApp(src, { url = "https://app.test/dashboard", base = "lb" } = {}) {
  if (window.happyDOM && typeof window.happyDOM.setURL === "function") {
    window.happyDOM.setURL(url);
  }
  const { result, html, clientJs, runtimeJs } = compileApp(src, base);
  expect((result.errors || []).map((e) => e && e.code).filter(Boolean)).toEqual([]);

  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const bodyHtml = (bodyMatch ? bodyMatch[1] : html)
    .replace(/<script[^>]*>[\s\S]*?<\/script>/g, "")
    .trim();
  document.body.innerHTML = bodyHtml;

  window.__soft = [];
  window.__hard = [];
  const code =
    `(function() {\n` +
    `${runtimeJs}\n` +
    `${clientJs}\n` +
    `_scrml_navigate_soft = function(p){ (window.__soft = window.__soft || []).push(p); };\n` +
    `_scrml_navigate = function(p){ (window.__hard = window.__hard || []).push(p); };\n` +
    `})();`;
  eval(code);

  document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
}

function clickAnchor(id, init = {}) {
  window.__soft = [];
  window.__hard = [];
  const a = document.getElementById(id);
  expect(a).not.toBeNull();
  const ev = new window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init });
  a.dispatchEvent(ev);
  return { soft: window.__soft, hard: window.__hard, prevented: ev.defaultPrevented };
}

beforeEach(async () => {
  try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
  GlobalRegistrator.register();
});
afterEach(async () => {
  try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing */ }
});

// A shell with the four canonical link shapes.
const APP_SRC =
  `<program>\n` +
  `  <nav>\n` +
  `    <a href="/reports" id="soft">Reports</a>\n` +
  `    <a href="/reports" hard id="hardlink">Reports (hard)</a>\n` +
  `    <a href="https://example.com/x" id="ext">External</a>\n` +
  `    <a href="#section" id="hash">Section</a>\n` +
  `  </nav>\n` +
  `  <outlet/>\n` +
  `</program>`;

// ---------------------------------------------------------------------------
// §1 — internal link → soft-navigated (intercepted, no full reload)
// ---------------------------------------------------------------------------

describe("§1 — internal <a href> click is soft-navigated", () => {
  test("plain click on an internal link → _scrml_navigate_soft(\"/reports\") + default prevented", () => {
    loadApp(APP_SRC);
    const r = clickAnchor("soft");
    expect(r.soft).toEqual(["/reports"]);
    expect(r.hard).toEqual([]);           // NOT a hard full-document navigation
    expect(r.prevented).toBe(true);       // the native navigation was intercepted
  });
});

// ---------------------------------------------------------------------------
// §2 — the pass-through set → NATIVE navigation (not intercepted)
// ---------------------------------------------------------------------------

describe("§2 — the §20.8.3 pass-through set navigates natively", () => {
  test("`<a hard>` opt-out → no soft dispatch, default NOT prevented", () => {
    loadApp(APP_SRC);
    const r = clickAnchor("hardlink");
    expect(r.soft).toEqual([]);
    expect(r.prevented).toBe(false);
  });

  test("external href → no soft dispatch, default NOT prevented", () => {
    loadApp(APP_SRC);
    const r = clickAnchor("ext");
    expect(r.soft).toEqual([]);
    expect(r.prevented).toBe(false);
  });

  test("ctrl-click on an internal link → no soft dispatch, default NOT prevented (new-tab)", () => {
    loadApp(APP_SRC);
    const r = clickAnchor("soft", { ctrlKey: true });
    expect(r.soft).toEqual([]);
    expect(r.prevented).toBe(false);
  });

  test("meta-click on an internal link → no soft dispatch (mac new-tab)", () => {
    loadApp(APP_SRC);
    const r = clickAnchor("soft", { metaKey: true });
    expect(r.soft).toEqual([]);
    expect(r.prevented).toBe(false);
  });

  test("same-page #hash anchor → no soft dispatch, default NOT prevented (native scroll)", () => {
    loadApp(APP_SRC);
    const r = clickAnchor("hash");
    expect(r.soft).toEqual([]);
    expect(r.prevented).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §3 — S239 HIGH: an author preventDefault() wins over link-boost
// ---------------------------------------------------------------------------

describe("§3 — author delegated onclick preventDefault() wins (S239 HIGH)", () => {
  // `onclick=intercept` is the BARE-REF form — emit-event-wiring wires the
  // handler DIRECTLY as the delegated listener target, so it receives the DOM
  // event and can call preventDefault(). The delegation registers inside the
  // author DOMContentLoaded block, and link-boost registers AFTER it, so the
  // author's preventDefault has already run when link-boost's guard checks.
  const AUTHOR_SRC =
    `<program>\n` +
    `  \${ function intercept(e) { e.preventDefault() } }\n` +
    `  <nav>\n` +
    `    <a href="/about" id="guarded" onclick=intercept>About</a>\n` +
    `    <a href="/reports" id="plain">Reports</a>\n` +
    `  </nav>\n` +
    `  <outlet/>\n` +
    `</program>`;

  test("author handler calls preventDefault() → link-boost does NOT soft-nav", () => {
    loadApp(AUTHOR_SRC, { base: "author-guard" });
    const r = clickAnchor("guarded");
    // The author's confirm-before-nav / validate-then-nav intent stands:
    // link-boost saw defaultPrevented and stepped aside — no soft navigation.
    expect(r.soft).toEqual([]);
    expect(r.hard).toEqual([]);
    // The author DID prevent the native navigation (their handler ran).
    expect(r.prevented).toBe(true);
  });

  test("control — a sibling link with NO author onclick still soft-navigates", () => {
    // Proves the app wiring is live (not that clicks are globally dead): the
    // ordering fix suppresses link-boost ONLY when the author preventDefault'd.
    loadApp(AUTHOR_SRC, { base: "author-guard" });
    const r = clickAnchor("plain");
    expect(r.soft).toEqual(["/reports"]);
    expect(r.prevented).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §4 — S239 LOW: an exact self-link passes through to native
// ---------------------------------------------------------------------------

describe("§4 — exact self-link is not re-swapped (S239 LOW)", () => {
  test("a no-hash <a href> resolving to the current URL → native (no soft re-swap)", () => {
    // Current location is /dashboard; the link points at /dashboard with no
    // hash → soft-nav would re-fetch + re-swap the outlet, wiping live state.
    const SELF_SRC =
      `<program>\n` +
      `  <nav><a href="/dashboard" id="self">Dashboard (self)</a></nav>\n` +
      `  <outlet/>\n` +
      `</program>`;
    loadApp(SELF_SRC, { url: "https://app.test/dashboard", base: "self-link" });
    const r = clickAnchor("self");
    expect(r.soft).toEqual([]);
    expect(r.prevented).toBe(false);
  });

  test("same path but a DIFFERENT query is still soft-navigated (real navigation)", () => {
    const QUERY_SRC =
      `<program>\n` +
      `  <nav><a href="/dashboard?tab=2" id="q">Tab 2</a></nav>\n` +
      `  <outlet/>\n` +
      `</program>`;
    loadApp(QUERY_SRC, { url: "https://app.test/dashboard", base: "query-link" });
    const r = clickAnchor("q");
    expect(r.soft).toEqual(["/dashboard?tab=2"]);
    expect(r.prevented).toBe(true);
  });
});
