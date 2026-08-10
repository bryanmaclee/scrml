/**
 * browser-tare-forward-position.test.js — SPEC §6.8.4 `E-TARE-BEFORE-DECL`,
 * proved by EXECUTION on both sides of the rule.
 *
 * The defect: state declarations hoist (§6.9) but codegen emits module-init in
 * SOURCE ORDER, so a `tare(@x)` written above the cell's first write ran when
 * `_scrml_init_fns["x"]` was still empty. It promoted nothing, wrote no default
 * slot, and `reset(@x)` fell back to re-running the LAST write's expression —
 * INCREMENTING. Zero diagnostics. That is the precise behaviour §6.8.4 exists
 * to dissolve, re-created by the feature meant to fix it.
 *
 * A compile-time reject is only worth anything if the thing it rejects really
 * was broken and the thing it admits really does work, so this file RUNS both
 * bundles:
 *   - the forward-position program is refused at compile time, and the bundle
 *     it refuses is executed to show it really does increment (2, not 0);
 *   - the corrected program is executed to show it really does restore 0.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { captureInsideChunkScope, foldChunkAccessors } from "../helpers/chunk-scope.js";

const tmpRoot = resolve("/tmp", "scrml-tare-forward-position");

function compileToOutputs(source, baseName) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const tmpDir = resolve(tmpRoot, `case-${uniq}`);
  const tmpInput = resolve(tmpDir, `${baseName}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir });
  const htmlPath = resolve(outDir, `${baseName}.html`);
  const clientPath = resolve(outDir, `${baseName}.client.js`);
  const runtimePath = resolve(outDir, result.runtimeFilename ?? "scrml-runtime.js");
  return {
    tmpDir,
    errorCodes: (result.errors ?? [])
      .filter((e) => (e.severity ?? "error") === "error")
      .map((e) => e.code),
    html: existsSync(htmlPath) ? readFileSync(htmlPath, "utf8") : "",
    clientJs: existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "",
    runtimeJs: existsSync(runtimePath) ? readFileSync(runtimePath, "utf8") : "",
  };
}

function mount(compiled) {
  document.documentElement.innerHTML = compiled.html;
  const exec = new Function(
    "window",
    "document",
    `${compiled.runtimeJs}\n`
      + captureInsideChunkScope(compiled.clientJs, `globalThis.__scrml_get__ = _scrml_reactive_get;\n`),
  );
  let threw = null;
  try {
    exec(window, document);
    document.dispatchEvent(new Event("DOMContentLoaded"));
  } catch (e) {
    threw = e;
  }
  return {
    threw,
    get: (name) => globalThis.__scrml_get__(name),
    click: (id) => document.getElementById(id)
      .dispatchEvent(new window.MouseEvent("click", { bubbles: true })),
    text: (id) => document.getElementById(id).textContent,
  };
}

/** tare ABOVE the implicit cell's first write — must be refused. */
const FORWARD = `<program>
\${
    tare(@x)
    @x = 0
    @x = @x + 1
    function doReset() { reset(@x) }
}
<button id="rs" onclick=doReset()>reset</button>
<p id="t">T: \${@x}</p>
</program>`;

/** The same program with the tare moved below the baseline write. */
const CORRECTED = `<program>
\${
    @x = 0
    tare(@x)
    @x = @x + 1
    function doReset() { reset(@x) }
}
<button id="rs" onclick=doReset()>reset</button>
<p id="t">T: \${@x}</p>
</program>`;

describe("§6.8.4 forward-position tare — E-TARE-BEFORE-DECL (happy-dom)", () => {
  beforeEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
    GlobalRegistrator.register();
  });
  afterEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing */ }
  });

  test("the forward-position program is REFUSED — and the bundle it refuses really is wrong", () => {
    const compiled = compileToOutputs(FORWARD, "forward");
    try {
      expect(compiled.errorCodes).toContain("E-TARE-BEFORE-DECL");

      // The refusal is only worth anything if the thing being refused really
      // misbehaves, so EXECUTE the artifacts the compiler declines to bless
      // (the API still writes them; the CLI reports FAILED and ships nothing).
      // Before the rule existed this bundle was what shipped, silently.
      const app = mount(compiled);
      expect(app.threw).toBeNull();
      expect(app.get("x")).toBe(1);
      app.click("rs");
      // 2 — the tare no-opped, so reset re-ran `current + 1`. This is the exact
      // defect §6.8.4 exists to dissolve; the diagnostic above is what now
      // stands between an author and this value.
      expect(app.get("x")).toBe(2);
      // The promotion emitted ABOVE the init registration, which is why it had
      // nothing to promote. Fold the per-chunk `_scrml_cs_` accessor rename
      // first and pin the CALL sites (`("x")`) — a bare `_init_set(` also
      // matches the chunk prologue's wrapper DEFINITION, which sits above
      // everything and would make this assertion pass for the wrong reason.
      const js = foldChunkAccessors(compiled.clientJs);
      const tareAt = js.indexOf(`_scrml_tare("x")`);
      const initAt = js.indexOf(`_scrml_init_set("x"`);
      expect(tareAt).toBeGreaterThan(-1);
      expect(initAt).toBeGreaterThan(tareAt);
    } finally {
      if (existsSync(compiled.tmpDir)) rmSync(compiled.tmpDir, { recursive: true, force: true });
    }
  });

  test("the corrected program EXECUTES and restores 0 instead of incrementing", () => {
    const compiled = compileToOutputs(CORRECTED, "corrected");
    try {
      expect(compiled.errorCodes).toEqual([]);
      const app = mount(compiled);
      expect(app.threw).toBeNull();
      expect(app.get("x")).toBe(1);
      app.click("rs");
      // 0, not 2. Before the rule existed, moving the tare up one line silently
      // produced 2 here with no diagnostic at all.
      expect(app.get("x")).toBe(0);
      expect(app.text("t")).toBe("T: 0");
    } finally {
      if (existsSync(compiled.tmpDir)) rmSync(compiled.tmpDir, { recursive: true, force: true });
    }
  });
});
