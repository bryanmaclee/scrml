/**
 * g-snippet-prop-in-is-some-guard.browser.test.js — S380 dog-food (silent,
 * compile-clean, browser-only) happy-dom acceptance regression.
 *
 * Bug: an optional snippet prop guarded by `if=(<snippet> is some)` lowered with
 * the snippet prop hard-substituted as literal `null`, so the guard became
 * `null !== null` (always false) and the FILLED slot's guarded region never
 * mounted. Compiles exit 0, zero diagnostics, wrong DOM — and it silently broke
 * the flagship `examples/12-snippets-slots.scrml` ("View All" actions vanished).
 *
 * Root: component-expander null-filled EVERY absent-at-call-site optional prop with
 * "null", including a snippet prop that was actually FILLED via `slot=`. Fix: for an
 * optional snippet prop that is present (slottedGroups / parametricSnippets), fill a
 * truthy sentinel so `... is some` is true; keep `null` only for a genuinely absent
 * optional (so the guard stays correctly false when the slot is NOT filled).
 *
 * Per R26 (S138): compile exits 0 and the OUTPUT was wrong — execution is the gate.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

const tmpRoot = resolve("/tmp", "scrml-snippet-is-some-guard");

beforeEach(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
  await GlobalRegistrator.register();
});
afterEach(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

function mount(source) {
  const tmpDir = resolve(tmpRoot, `case-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(outDir, { recursive: true });
  const input = resolve(tmpDir, "app.scrml");
  writeFileSync(input, source);
  try {
    const r = compileScrml({ inputFiles: [input], write: true, outputDir: outDir, log: () => {} });
    const rd = (f) => (existsSync(resolve(outDir, f)) ? readFileSync(resolve(outDir, f), "utf8") : "");
    const errs = (r.errors ?? []).filter((e) => (e.severity ?? "error") === "error");
    const html = rd("app.html");
    const body = (html.match(/<body[^>]*>([\s\S]*?)<\/body>/i) || [, html])[1].replace(/<script[^>]*>[\s\S]*?<\/script>/g, "");
    document.body.innerHTML = body;
    new Function("window", "document",
      `${rd(r.runtimeFilename ?? "scrml-runtime.js")}\n` + captureInsideChunkScope(rd("app.client.js"), ""),
    )(globalThis.window, globalThis.document);
    document.dispatchEvent(new window.Event("DOMContentLoaded", { bubbles: true }));
    return { errs, text: (sel) => (document.querySelector(sel) ? document.querySelector(sel).textContent.trim() : null) };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

const CARD = `const Card = <section props={ body: snippet, actions?: snippet }>
<div id="cb">\${render body()}</div>
<div id="ca" if=(actions is some)>\${render actions()}</div>
</section>`;

describe("g-snippet-prop-in-is-some-guard (S380 dog-food)", () => {
  test("a FILLED optional snippet makes `<snippet> is some` TRUE and mounts the guarded region", () => {
    const app = mount(`<program>
${CARD}
<Card>
<span slot="body">BODY</span>
<button slot="actions">ACT</button>
</Card>
</program>
`);
    expect(app.errs).toEqual([]);
    expect(app.text("#cb")).toBe("BODY");
    expect(app.text("#ca")).toBe("ACT"); // was ABSENT (null !== null)
  });

  test("an ABSENT optional snippet keeps `<snippet> is some` FALSE (guard not over-fired)", () => {
    const app = mount(`<program>
${CARD}
<Card>
<span slot="body">BODY</span>
</Card>
</program>
`);
    expect(app.errs).toEqual([]);
    expect(app.text("#cb")).toBe("BODY");
    expect(app.text("#ca")).toBe(null); // no actions slot → guard false → absent
  });
});
