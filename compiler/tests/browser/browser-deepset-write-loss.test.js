/**
 * browser-deepset-write-loss.test.js — high-deepset-write-loss (2026-06-06)
 * happy-dom RUNTIME acceptance.
 *
 * BUG (HIGH): consecutive dotted-path deep-set writes (`@obj.field = value`,
 * AST kind `reactive-nested-assign`) inside a `function` body were SILENTLY
 * DROPPED at codegen — any deep-set at body position 2+ vanished. The root cause
 * was collectExpr over-consumption (ast-builder.js): the depth-0 assignment
 * boundary only broke on `@ident =`, not on a deep-set's `@ident . path =`, so the
 * preceding collectExpr-RHS statement swallowed the whole dotted-path statement.
 *
 * `node --check`-clean ≠ correct (S139/S140/S152): the emit-shape proof lives in
 * compiler/tests/unit/deepset-write-loss-position.test.js. THIS test drives the
 * full DOM-event → handler → reactive-set path and asserts the MUTATIONS ACTUALLY
 * APPLY at runtime — every deep-set in a multi-statement body takes effect, with
 * last-write-wins ordering.
 *
 * FORM NOTE: this test uses a FLAT object cell `<a> = { ref: "" }`. The bug's
 * original reproducer used a STRUCTURAL COMPOUND (`<a>` `<ref> = ""` `</>`), which
 * codegen lowers to a DERIVED cell — and a deep-set on a derived cell does not
 * apply at runtime EVEN FOR A SINGLE write (the derived recompute overwrites it
 * from the unchanged leaf source cell). That is a SEPARATE, pre-existing codegen
 * bug (deep-set targets the derived composite key instead of the leaf source key),
 * out of scope for this dispatch and not introduced by the parser fix. The flat
 * object cell exercises the deep-set runtime cleanly, isolating the parser fix.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { execFileSync } from "child_process";
import { compileScrml } from "../../src/api.js";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

const tmpRoot = resolve("/tmp", "scrml-deepset-write-loss");

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
    clientPath,
    errors: (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error"),
    html: existsSync(htmlPath) ? readFileSync(htmlPath, "utf8") : "",
    clientJs: existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "",
    runtimeJs: existsSync(runtimePath) ? readFileSync(runtimePath, "utf8") : "",
  };
}

function mount(compiled) {
  const { html, clientJs, runtimeJs } = compiled;
  document.documentElement.innerHTML = html;
  const exec = new Function(
    "window",
    "document",
    `${runtimeJs}\n` + captureInsideChunkScope(clientJs, `globalThis.__scrml_get__ = _scrml_reactive_get;\n`),
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
    button: () => document.getElementById("go"),
  };
}

// Flat object cell — the deep-set applies cleanly at runtime (see FORM NOTE).
const MULTI_SRC = `<program>
<a> = { ref: "" }
<c> = 0
function multi() {
    @c = 1
    @a.ref = "p"
    @c = 2
    @a.ref = "q"
}
<button id="go" onclick=multi()>go</button>
<p>\${@c} \${@a.ref}</p>
</program>`;

describe("high-deepset-write-loss — multi-statement deep-set RUNTIME (happy-dom)", () => {
  beforeEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
    GlobalRegistrator.register();
  });
  afterEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing */ }
  });

  test("compiles with no errors and emitted client JS is valid (node --check)", () => {
    const compiled = compileToOutputs(MULTI_SRC, "multi");
    try {
      expect(compiled.errors).toEqual([]);
      // node --check on the actual emitted client.js — runtime validity gate.
      expect(() => execFileSync("node", ["--check", compiled.clientPath])).not.toThrow();
      // Emit-shape sanity: both deep-sets present in source order.
      const m = compiled.clientJs.match(/function _scrml_multi_\d+\(\)\s*\{([\s\S]*?)\n\}/);
      expect(m).not.toBeNull();
      const seen = [...m[1].matchAll(/_scrml_deep_set\(_scrml_reactive_get\("a"\), \["ref"\], "([^"]+)"\)/g)].map(
        (mm) => mm[1],
      );
      expect(seen).toEqual(["p", "q"]);
    } finally {
      if (existsSync(compiled.tmpDir)) rmSync(compiled.tmpDir, { recursive: true, force: true });
    }
  });

  test("mounts into initial state without throwing", () => {
    const compiled = compileToOutputs(MULTI_SRC, "multi");
    try {
      const app = mount(compiled);
      expect(app.threw).toBeNull();
      expect(app.get("c")).toBe(0);
      expect(app.get("a")).toEqual({ ref: "" });
    } finally {
      if (existsSync(compiled.tmpDir)) rmSync(compiled.tmpDir, { recursive: true, force: true });
    }
  });

  test("clicking the button applies ALL FOUR mutations — @a.ref ends at 'q', @c ends at 2 (last-write-wins)", () => {
    const compiled = compileToOutputs(MULTI_SRC, "multi");
    try {
      const app = mount(compiled);
      expect(app.threw).toBeNull();
      // Pre-fix: both @a.ref deep-sets were dropped at codegen, so @a.ref stayed ""
      // and only the scalar @c writes survived. Now every write applies in order.
      app.button().dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      expect(app.get("c")).toBe(2);
      expect(app.get("a")).toEqual({ ref: "q" });
      expect(app.get("a").ref).toBe("q");
    } finally {
      if (existsSync(compiled.tmpDir)) rmSync(compiled.tmpDir, { recursive: true, force: true });
    }
  });

  test("intermediate deep-set is not skipped — re-firing with only the first deep-set yields 'p'", () => {
    // Guards that the SURVIVING deep-set is the authored one (not a stale/last-only
    // collapse). A body with a single trailing deep-set after scalars must apply it.
    const SRC = `<program>
<a> = { ref: "" }
<c> = 0
function multi() {
    @c = 1
    @c = 2
    @a.ref = "p"
}
<button id="go" onclick=multi()>go</button>
</program>`;
    const compiled = compileToOutputs(SRC, "multi");
    try {
      const app = mount(compiled);
      expect(app.threw).toBeNull();
      app.button().dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      expect(app.get("c")).toBe(2);
      expect(app.get("a")).toEqual({ ref: "p" });
    } finally {
      if (existsSync(compiled.tmpDir)) rmSync(compiled.tmpDir, { recursive: true, force: true });
    }
  });
});
