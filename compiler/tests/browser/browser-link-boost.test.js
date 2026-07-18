/**
 * §20.8.3 Link-boost (i27) — behavioral drive through the delegated listener.
 *
 * Compiles a persistent-shell app (`<program>` + `<outlet>`) carrying an
 * internal `<a href>`, an internal `<a href hard>`, an external `<a href>`, and
 * a same-page `#hash` link, loads the emitted HTML + runtime + client body into
 * happy-dom, then dispatches REAL bubbling click events at the anchors and
 * asserts the delegated document listener's branch decisions:
 *
 *   - internal same-origin cross-page link → `_scrml_navigate_soft` fires with
 *     the resolved path, and the default (full-document) navigation is
 *     prevented (a soft, in-place swap — NOT a reload).
 *   - `<a hard>` / external / modified-click (ctrl) / same-page `#hash` → NO
 *     soft dispatch and the default is NOT prevented → the browser performs its
 *     native navigation (progressive enhancement / spec pass-through set).
 *
 * `_scrml_navigate_soft` / `_scrml_navigate` are stubbed to recorders so the
 * assertions observe the ROUTING decision without a live SSR fetch; the real
 * engine's swap pipeline is covered by the Wave-1b soft-nav tests.
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { compileScrml } from "../../src/api.js";
import { SCRML_RUNTIME } from "../../src/runtime-template.js";
import { writeFileSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (!globalThis.document) GlobalRegistrator.register();

const APP_URL = "https://app.test/dashboard";

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

// The 2-page shell: a persistent <program> shell + <outlet>, one boostable
// internal link, one `hard` opt-out, one external, one same-page #hash anchor.
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

let compiled;

beforeAll(() => {
  if (window.happyDOM && typeof window.happyDOM.setURL === "function") {
    window.happyDOM.setURL(APP_URL);
  }
  compiled = compileApp(APP_SRC);

  // Extract the shell body markup (drop the emitted <script> tags — we eval the
  // client body ourselves against the tree-shaken runtime).
  const bodyMatch = compiled.html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const bodyHtml = (bodyMatch ? bodyMatch[1] : compiled.html)
    .replace(/<script[^>]*>[\s\S]*?<\/script>/g, "")
    .trim();
  document.body.innerHTML = bodyHtml;

  // Boot: runtime + client body, then STUB the two nav entry points (reassign
  // the function-declaration bindings) so the delegated handler's late-bound
  // calls land in our recorders instead of a live pushState + SSR fetch.
  const code =
    `(function() {\n` +
    `${SCRML_RUNTIME}\n` +
    `${compiled.clientJs}\n` +
    `_scrml_navigate_soft = function(p){ (window.__soft = window.__soft || []).push(p); };\n` +
    `_scrml_navigate = function(p){ (window.__hard = window.__hard || []).push(p); };\n` +
    `})();`;
  eval(code);

  // Run the boot wiring (emit-reactive-wiring's `_scrml_link_ensure_click()` is
  // in the client body; DOMContentLoaded is the harness's standard boot signal).
  document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
});

function clickAnchor(id, init = {}) {
  window.__soft = [];
  window.__hard = [];
  const a = document.getElementById(id);
  expect(a).not.toBeNull();
  const ev = new window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init });
  a.dispatchEvent(ev);
  return { soft: window.__soft, hard: window.__hard, prevented: ev.defaultPrevented };
}

// ---------------------------------------------------------------------------
// §1 — internal link → soft-navigated (intercepted, no full reload)
// ---------------------------------------------------------------------------

describe("§1 — internal <a href> click is soft-navigated", () => {
  test("plain click on an internal link → _scrml_navigate_soft(\"/reports\") + default prevented", () => {
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
    const r = clickAnchor("hardlink");
    expect(r.soft).toEqual([]);
    expect(r.prevented).toBe(false);
  });

  test("external href → no soft dispatch, default NOT prevented", () => {
    const r = clickAnchor("ext");
    expect(r.soft).toEqual([]);
    expect(r.prevented).toBe(false);
  });

  test("ctrl-click on an internal link → no soft dispatch, default NOT prevented (new-tab)", () => {
    const r = clickAnchor("soft", { ctrlKey: true });
    expect(r.soft).toEqual([]);
    expect(r.prevented).toBe(false);
  });

  test("meta-click on an internal link → no soft dispatch (mac new-tab)", () => {
    const r = clickAnchor("soft", { metaKey: true });
    expect(r.soft).toEqual([]);
    expect(r.prevented).toBe(false);
  });

  test("same-page #hash anchor → no soft dispatch, default NOT prevented (native scroll)", () => {
    const r = clickAnchor("hash");
    expect(r.soft).toEqual([]);
    expect(r.prevented).toBe(false);
  });
});
