/**
 * §20.8.3 Link-boost (i27) — `<a href>` default soft-nav + `hard` opt-out.
 *
 * The residual of adopter bug #27, built on top of the landed soft-nav engine
 * (Waves 1a/1b). This suite pins the COMPILE-TIME contract:
 *
 *   1. A `<program>` shell WITH an `<outlet>` emits the delegated click-boot
 *      call `_scrml_link_ensure_click()` into its client body, and pulls the
 *      soft-nav 'utilities' chunk (the click handler + `_scrml_navigate_soft`)
 *      into the emitted runtime.
 *   2. An app with NO `<outlet>` emits NEITHER the boot call NOR the handler —
 *      link-boost is gated on the shell/outlet structural signal.
 *   3. The `hard` opt-out attribute is a first-class recognized `<a>` attribute
 *      (html-elements.js), a bare `<a href hard>` survives to the DOM, and the
 *      emitted handler reads `hasAttribute("hard")`.
 *   4. The emitted click handler carries the full §20.8.3 guard set
 *      (modified-click / target / download / rel=external / non-http scheme /
 *      cross-origin / hash-same-page).
 *
 * The behavioral drive (a real click through the delegated listener → soft-nav
 * fires / native passes through) lives in tests/browser/browser-link-boost.test.js.
 */

import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { SCRML_RUNTIME } from "../../src/runtime-template.js";
import { getElementShape } from "../../src/html-elements.js";
import { writeFileSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function compileToClient(src, base = "lb") {
  const tmp = mkdtempSync(join(tmpdir(), "link-boost-"));
  const inFile = join(tmp, `${base}.scrml`);
  writeFileSync(inFile, src);
  const outDir = join(tmp, "dist");
  const result = compileScrml({ inputFiles: [inFile], outputDir: outDir });
  let clientJs = "";
  try { clientJs = readFileSync(join(outDir, `${base}.client.js`), "utf8"); } catch { /* none */ }
  let html = "";
  try { html = readFileSync(join(outDir, `${base}.html`), "utf8"); } catch { /* none */ }
  let runtimeJs = "";
  try {
    for (const f of readdirSync(outDir)) {
      if (/^scrml-runtime\..*\.js$/.test(f)) runtimeJs += readFileSync(join(outDir, f), "utf8");
    }
  } catch { /* none */ }
  return { result, clientJs, html, runtimeJs };
}

function errorCodes(result) {
  return (result.errors || []).map((e) => e && e.code).filter(Boolean);
}

// ---------------------------------------------------------------------------
// §1 — boot-call emission gated on the shell <outlet>
// ---------------------------------------------------------------------------

describe("§1 — link-boost click-delegation is emitted for a soft-nav shell", () => {
  test("a <program> shell WITH an <outlet> emits _scrml_link_ensure_click() + ships the handler", () => {
    const src =
      `<program>\n` +
      `  <nav><a href="/about">About</a></nav>\n` +
      `  <outlet/>\n` +
      `</program>`;
    const { result, clientJs, runtimeJs } = compileToClient(src, "shell");
    expect(errorCodes(result)).toEqual([]);
    // The per-file client body carries the one-time boot call.
    expect(clientJs).toContain("_scrml_link_ensure_click()");
    // The runtime (utilities chunk) carries the delegated handler + wiring +
    // the soft-nav engine the handler dispatches into.
    expect(runtimeJs).toContain("function _scrml_link_ensure_click(");
    expect(runtimeJs).toContain("function _scrml_link_click_handler(");
    expect(runtimeJs).toContain("function _scrml_navigate_soft(");
  });
});

// ---------------------------------------------------------------------------
// §2 — NOT emitted for a no-outlet app (byte-clean gate)
// ---------------------------------------------------------------------------

describe("§2 — link-boost is NOT emitted for an app with no <outlet>", () => {
  test("a shell with links but NO <outlet> emits neither the boot call nor the handler", () => {
    const src =
      `<program>\n` +
      `  <nav><a href="/about">About</a></nav>\n` +
      `  <p>no swap region</p>\n` +
      `</program>`;
    const { result, clientJs, runtimeJs } = compileToClient(src, "noshell");
    expect(errorCodes(result)).toEqual([]);
    expect(clientJs).not.toContain("_scrml_link_ensure_click()");
    // No outlet → the utilities chunk is not pulled in by link-boost, so the
    // handler is tree-shaken out of the emitted runtime.
    expect(runtimeJs).not.toContain("function _scrml_link_click_handler(");
  });
});

// ---------------------------------------------------------------------------
// §3 — the `hard` opt-out attribute: registered + survives to the DOM
// ---------------------------------------------------------------------------

describe("§3 — `hard` opt-out attribute", () => {
  test("`hard` is a registered boolean attribute on <a>", () => {
    const anchor = getElementShape("a");
    expect(anchor).not.toBeNull();
    expect(anchor.attributes.has("hard")).toBe(true);
    expect(anchor.attributes.get("hard").type).toBe("boolean");
  });

  test("a bare `<a href hard>` survives verbatim to the emitted DOM (no strip, no warning)", () => {
    const src =
      `<program>\n` +
      `  <nav><a href="/reports" hard>Reports</a></nav>\n` +
      `  <outlet/>\n` +
      `</program>`;
    const { result, html } = compileToClient(src, "hardattr");
    expect(errorCodes(result)).toEqual([]);
    const anchors = html.match(/<a [^>]*>/g) || [];
    const reportsLink = anchors.find((a) => a.includes("/reports"));
    expect(reportsLink).toBeDefined();
    expect(reportsLink).toMatch(/\bhard\b/);
  });

  test("the emitted handler opts a `hard` link out via hasAttribute(\"hard\")", () => {
    expect(SCRML_RUNTIME).toContain('a.hasAttribute("hard")');
  });
});

// ---------------------------------------------------------------------------
// §4 — the emitted handler carries the full §20.8.3 guard set
// ---------------------------------------------------------------------------

describe("§4 — the §20.8.3 guard set is present in the emitted handler", () => {
  const guards = [
    ["modified-click (meta/ctrl/shift/alt)", /e\.metaKey \|\| e\.ctrlKey \|\| e\.shiftKey \|\| e\.altKey/],
    ["primary button only", /e\.button !== 0/],
    ["nearest <a href> via closest", /closest\("a\[href\]"\)/],
    ["hard opt-out", /a\.hasAttribute\("hard"\)/],
    ["target !== _self", /target !== "_self"/],
    ["download opt-out", /a\.hasAttribute\("download"\)/],
    ["rel=external opt-out", /" external "/],
    ["http(s) scheme only", /proto !== "http:" && proto !== "https:"/],
    ["cross-origin → native", /a\.origin !== window\.location\.origin/],
    ["pure hash / same-page anchor", /rawHref\.charAt\(0\) === "#"/],
    ["preventDefault + soft dispatch", /_scrml_navigate_soft\(a\.pathname \+ a\.search \+ a\.hash\)/],
  ];
  for (const [label, re] of guards) {
    test(`guard present: ${label}`, () => {
      expect(SCRML_RUNTIME).toMatch(re);
    });
  }

  test("the handler is delegated on the document (survives outlet swaps, wired once)", () => {
    expect(SCRML_RUNTIME).toContain('document.addEventListener("click", _scrml_link_click_handler)');
    expect(SCRML_RUNTIME).toContain("_scrml_link_click_wired");
  });
});
