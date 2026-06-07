/**
 * browser-structural-compound-deepset.test.js — Bug B happy-dom RUNTIME acceptance.
 *
 * BUG (HIGH): a dotted-path deep-set `@a.ref = value` where `a` is a Variant C
 * STRUCTURAL COMPOUND cell (`<a> <ref>="" </>`) wrote the DERIVED COMPOSITE `a`
 * (`_scrml_reactive_set("a", _scrml_deep_set(...))`) instead of the backing LEAF
 * `a.ref`. The composite recomputes from the unchanged leaf on the next read, so
 * the write was silently clobbered — a lost mutation, NO diagnostic, default
 * pipeline. It failed EVEN FOR A SINGLE deep-set (distinct from the S167
 * multi-statement parser bug, which is about FLAT object cells).
 *
 * SPEC §6.3.2 (line 2229): `@formRes.name = "Alice"` writes to the field's
 * backing storage. So `@a.ref = "q"` must leave `@a.ref === "q"` at runtime.
 *
 * The flat-object sibling (browser-deepset-write-loss.test.js) explicitly noted
 * this STRUCTURAL COMPOUND case was out of scope for that dispatch and a separate
 * codegen bug. THIS test closes it: it drives the full DOM-event → handler →
 * reactive-set path on the ORIGINAL structural-compound reproducer and asserts the
 * field write ACTUALLY APPLIES at runtime, for both a single write and a multi-
 * statement last-write-wins sequence.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { execFileSync } from "child_process";
import { compileScrml } from "../../src/api.js";

const tmpRoot = resolve("/tmp", "scrml-structural-compound-deepset");

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
    `${runtimeJs}\n${clientJs}\n` +
      `globalThis.__scrml_get__ = _scrml_reactive_get;\n`,
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

// Structural compound `<a> <ref> = "" </>` — the ORIGINAL Bug B reproducer.
const MULTI_SRC = `<program>
<a>
    <ref> = ""
</>
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

describe("Bug B — structural-compound field write applies at RUNTIME (happy-dom)", () => {
  beforeEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
    GlobalRegistrator.register();
  });
  afterEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing */ }
  });

  test("compiles with no errors; emitted client JS is valid (node --check); writes target the leaf", () => {
    const compiled = compileToOutputs(MULTI_SRC, "multi");
    try {
      expect(compiled.errors).toEqual([]);
      expect(() => execFileSync("node", ["--check", compiled.clientPath])).not.toThrow();
      const m = compiled.clientJs.match(/function _scrml_multi_\d+\(\)\s*\{([\s\S]*?)\n\}/);
      expect(m).not.toBeNull();
      // The leaf-targeted writes, in source order.
      const seen = [...m[1].matchAll(/_scrml_reactive_set\("a\.ref",\s*"([^"]+)"\)/g)].map((mm) => mm[1]);
      expect(seen).toEqual(["p", "q"]);
      // The bug shape MUST be gone.
      expect(m[1]).not.toMatch(/_scrml_reactive_set\("a",\s*_scrml_deep_set/);
    } finally {
      if (existsSync(compiled.tmpDir)) rmSync(compiled.tmpDir, { recursive: true, force: true });
    }
  });

  test("mounts into initial state without throwing — @a.ref starts \"\"", () => {
    const compiled = compileToOutputs(MULTI_SRC, "multi");
    try {
      const app = mount(compiled);
      expect(app.threw).toBeNull();
      expect(app.get("c")).toBe(0);
      expect(app.get("a.ref")).toBe("");
      expect(app.get("a")).toEqual({ ref: "" });
    } finally {
      if (existsSync(compiled.tmpDir)) rmSync(compiled.tmpDir, { recursive: true, force: true });
    }
  });

  test("clicking the button leaves @a.ref === \"q\" (last-write-wins) — the field write APPLIES", () => {
    const compiled = compileToOutputs(MULTI_SRC, "multi");
    try {
      const app = mount(compiled);
      expect(app.threw).toBeNull();
      // Pre-fix: both @a.ref writes hit the composite `a` and were clobbered by
      // the derived recompute from the unchanged leaf `a.ref` → @a.ref stayed "".
      app.button().dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      expect(app.get("c")).toBe(2);
      expect(app.get("a.ref")).toBe("q");
      // The composite re-derives from the leaf.
      expect(app.get("a")).toEqual({ ref: "q" });
    } finally {
      if (existsSync(compiled.tmpDir)) rmSync(compiled.tmpDir, { recursive: true, force: true });
    }
  });

  test("a SINGLE compound deep-set applies (Bug B failed even for one write)", () => {
    const SRC = `<program>
<a>
    <ref> = ""
</>
function setIt() { @a.ref = "once" }
<button id="go" onclick=setIt()>go</button>
<p>\${@a.ref}</p>
</program>`;
    const compiled = compileToOutputs(SRC, "single");
    try {
      const app = mount(compiled);
      expect(app.threw).toBeNull();
      expect(app.get("a.ref")).toBe("");
      app.button().dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      expect(app.get("a.ref")).toBe("once");
      expect(app.get("a")).toEqual({ ref: "once" });
    } finally {
      if (existsSync(compiled.tmpDir)) rmSync(compiled.tmpDir, { recursive: true, force: true });
    }
  });
});
