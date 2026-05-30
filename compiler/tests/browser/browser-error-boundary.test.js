/**
 * errorBoundary (SPEC §19.6 + §19.6.8) — RUNTIME drive (happy-dom).
 *
 * The emit-shape regression half lives in
 * compiler/tests/conformance/conf-error-boundary.test.js. THIS file mounts the
 * compiled boundary in happy-dom and drives BOTH catch paths end-to-end — the
 * empirical runtime proof the dispatch brief mandates (S140 acceptance-gate
 * precedent: emit-string tests cannot prove the wiring actually works).
 *
 * Scenarios:
 *   (a) TYPED !-error (§19.6.3) — a `!`-call inside the boundary fails; the
 *       failing variant's own `renders` markup (NotFound) appears in the DOM,
 *       and a variant WITHOUT renders (Timeout) falls through to the boundary's
 *       `fallback=` markup (§19.6.5 priority).
 *   (b) HOST-JS BACKSTOP (§19.6.8 C-hybrid) — a NON-`!` throw during the
 *       subtree render is caught by the emitted try/catch; the boundary's
 *       `fallback=` is rendered + the error is LOGGED (not swallowed, B5); and
 *       sibling content OUTSIDE the boundary survives (§19.6.4).
 *   (c) NESTING (§19.6.4) — an inner boundary catches its own subtree's error
 *       before the outer boundary; the outer boundary's OTHER children survive.
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { SCRML_RUNTIME } from "../../src/runtime-template.js";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

if (!globalThis.document) GlobalRegistrator.register();

beforeEach(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
  await GlobalRegistrator.register();
});

/**
 * Compile `src`, mount the emitted HTML body + runtime + client.js in happy-dom,
 * dispatch DOMContentLoaded. `mutate` (optional) is a string of JS spliced into
 * the IIFE BEFORE the DOMContentLoaded dispatch — used to override a compiled
 * `!`-function so it throws a NON-`!` host error (driving the §19.6.8 backstop).
 * Returns the captured console.error log lines + reactive accessors.
 */
function mount(src, mutate = "") {
  const TMP = mkdtempSync(join(tmpdir(), "browser-error-boundary-"));
  const abs = join(TMP, "eb.scrml");
  writeFileSync(abs, src);
  const result = compileScrml({ inputFiles: [abs], outputDir: join(TMP, "dist"), write: false, log: () => {} });
  const realErrors = (result.errors || []).filter((e) => e && e.severity !== "warning");
  expect(realErrors).toEqual([]);

  const out = [...(result.outputs || new Map()).entries()][0]?.[1];
  const html = out?.html ?? "";
  const clientJs = out?.clientJs ?? "";
  if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });

  const bodyHtml = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || [])[1] || html;
  document.body.innerHTML = bodyHtml.replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").trim();

  // Capture loud logging (§19.6.8 B5 — backstop must NOT silently swallow).
  const logs = [];
  const realErr = console.error;
  console.error = (...args) => { logs.push(args.map(String).join(" ")); };

  const code = `(function() {\n${SCRML_RUNTIME}\n${clientJs}\n` +
    `${mutate}\n` +
    `window.__sg = _scrml_reactive_get;\n` +
    `window.__ss = _scrml_reactive_set;\n` +
    `})();`;
  try {
    eval(code);
    document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
  } finally {
    console.error = realErr;
  }

  return {
    logs,
    body: () => document.body.innerHTML,
    get: (n) => window.__sg(n),
  };
}

// Client `!`-function so the failure is synchronous (no CPS / server round-trip).
// NotFound carries a `renders` clause; Timeout does not (falls to fallback).
const TYPED_SRC = `type LoadError:enum = {
    NotFound(id: string)
        renders <div class="eb-notfound">Item \${id} not found</>
    Timeout
}

function loadItem(id: string)! LoadError {
    if (id == "missing") fail LoadError::NotFound(id)
    if (id == "slow") fail LoadError::Timeout
    return id
}

<page>
    <h1 class="eb-header">Header survives</>
    <errorBoundary fallback={<div class="eb-fallback">Boundary fallback shown</>}>
        \${loadItem("PLACEHOLDER")}
    </>
    <footer class="eb-footer">Footer survives</>
</page>
`;

describe("errorBoundary §19.6 — typed !-error catch (happy-dom)", () => {
  test("(a1) failing variant WITH renders shows the variant's own markup", () => {
    const api = mount(TYPED_SRC.replace("PLACEHOLDER", "missing"));
    const html = api.body();
    // NotFound has a `renders` clause → its markup wins over the fallback.
    expect(html).toContain("eb-notfound");
    expect(html).toContain("Item missing not found"); // ${id} payload substituted
    expect(html).not.toContain("Boundary fallback shown");
    // Sibling content outside the boundary survives (§19.6.4).
    expect(html).toContain("Header survives");
    expect(html).toContain("Footer survives");
    // The error was logged, not swallowed (§19.6.8 B5).
    expect(api.logs.some((l) => l.includes("errorBoundary") && l.includes("NotFound"))).toBe(true);
  });

  test("(a2) failing variant WITHOUT renders falls through to the boundary fallback", () => {
    const api = mount(TYPED_SRC.replace("PLACEHOLDER", "slow"));
    const html = api.body();
    // Timeout has no renders → boundary fallback (§19.6.5 priority order #2).
    expect(html).toContain("eb-fallback");
    expect(html).toContain("Boundary fallback shown");
    expect(html).not.toContain("eb-notfound");
    expect(html).toContain("Header survives");
    expect(html).toContain("Footer survives");
  });

  test("(a3) success path renders the value (boundary is transparent on success)", () => {
    const api = mount(TYPED_SRC.replace("PLACEHOLDER", "ok"));
    const html = api.body();
    expect(html).not.toContain("eb-fallback");
    expect(html).not.toContain("eb-notfound");
    expect(html).toContain("Header survives");
  });
});

describe("errorBoundary §19.6.8 — C-hybrid host-JS backstop (happy-dom)", () => {
  test("(b) a NON-! throw during render degrades to fallback + logs + siblings survive", () => {
    // Override the compiled loadItem so it THROWS a plain host error (NOT a
    // scrml `fail`). This is exactly the §19.6.8 case: an unexpected host throw
    // the typed `!`-path does not model. The backstop must catch it, render the
    // boundary fallback, and log loudly.
    const api = mount(
      TYPED_SRC.replace("PLACEHOLDER", "ok"),
      `_scrml_loadItem_3 = function() { throw new TypeError("boom from host"); };`,
    );
    const html = api.body();
    expect(html).toContain("eb-fallback");
    expect(html).toContain("Boundary fallback shown");
    // Siblings OUTSIDE the boundary are unaffected (§19.6.4).
    expect(html).toContain("Header survives");
    expect(html).toContain("Footer survives");
    // §19.6.8 B5 — NOT silently swallowed; the host throw is logged loudly.
    expect(api.logs.some((l) => l.includes("errorBoundary") && l.includes("non-!"))).toBe(true);
  });
});

const NESTED_SRC = `type LoadError:enum = {
    NotFound(id: string)
}

function loadItem(id: string)! LoadError {
    if (id == "missing") fail LoadError::NotFound(id)
    return id
}

<page>
    <errorBoundary fallback={<div class="eb-outer-fallback">Outer fallback</>}>
        <h2 class="eb-outer-child">Outer child survives</>
        <errorBoundary fallback={<div class="eb-inner-fallback">Inner fallback</>}>
            \${loadItem("missing")}
        </>
    </>
</page>
`;

describe("errorBoundary §19.6.4 — nesting: inner catches first (happy-dom)", () => {
  test("(c) inner boundary catches; outer's OTHER children survive", () => {
    const api = mount(NESTED_SRC);
    const html = api.body();
    // Inner boundary catches the failure → inner fallback shown.
    expect(html).toContain("eb-inner-fallback");
    expect(html).toContain("Inner fallback");
    // Outer boundary's OTHER child survives; outer fallback NOT triggered.
    expect(html).toContain("Outer child survives");
    expect(html).not.toContain("eb-outer-fallback");
    expect(html).not.toContain("Outer fallback");
  });
});
