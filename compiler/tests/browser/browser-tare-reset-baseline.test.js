/**
 * browser-tare-reset-baseline.test.js — SPEC §6.8.4 `tare(@cell)` RUNTIME
 * acceptance in happy-dom.
 *
 * This is the EXECUTION proof, and it is deliberately not an emit-shape test.
 * A marker in the emitted text is not evidence a client-runtime feature works:
 * the S265 theme-switch feature shipped DOA with its marker present because the
 * bundle threw a load-time ReferenceError. Every assertion here runs the real
 * bundle, dispatches a real click, and reads the cell back out of the live
 * store.
 *
 * The defect §6.8.4 answers: an IMPLICITLY declared cell (`@x = 0`, no `<x>`
 * declaration) written twice registers a reset init-thunk per write, and the
 * runtime registry is last-write-wins — so `reset(@x)` re-runs `current + 1`
 * and INCREMENTS instead of restoring the baseline.
 *
 * No structural rule can fix that, which is why `tare` exists rather than a
 * compiler analysis: these two programs are structurally identical and want
 * OPPOSITE answers —
 *
 *     @x = 0                                        reset -> 0      (FIRST write)
 *     @x = @x + 1
 *
 *     @config = base()                              reset -> merged (LAST write)
 *     @config = merge(base(), overrides())
 *
 * — so the discriminator is author INTENT, and the author expresses it by
 * placing the `tare()` call. Both shapes are asserted below.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

const tmpRoot = resolve("/tmp", "scrml-tare-reset-baseline");

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
    click: (id) => document.getElementById(id)
      .dispatchEvent(new window.MouseEvent("click", { bubbles: true })),
  };
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

/** The motivating defect, WITHOUT tare: reset increments. */
const COUNTER_NO_TARE = `<program>
\${
    @x = 0
    @x = @x + 1
    function doReset() { reset(@x) }
}
<button id="rst" onclick=doReset()>reset</button>
</program>`;

/** The same program WITH tare after the first write: reset restores 0. */
const COUNTER_TARED = `<program>
\${
    @x = 0
    tare(@x)
    @x = @x + 1
    function doReset() { reset(@x) }
}
<button id="rst" onclick=doReset()>reset</button>
</program>`;

/** The opposite intent — the LAST write is the baseline. */
const CONFIG_MERGE = `<program>
\${
    @config = base()
    @config = merge(base(), overrides())
    tare(@config)

    function base() { return { theme: "light", size: 1 } }
    function overrides() { return { theme: "dark" } }
    function merge(a, b) { return { theme: b.theme, size: a.size } }
    function scramble() { @config = { theme: "scrambled", size: 99 } }
    function doReset() { reset(@config) }
}
<p id="shown">\${@config.theme}</p>
<button id="scramble" onclick=scramble()>scramble</button>
<button id="rst" onclick=doReset()>reset</button>
</program>`;

/**
 * The two-argument form, and the THUNK-not-snapshot proof: the default reads
 * `@factor`, `@factor` changes AFTER the tare, and the reset must observe the
 * NEW value (§6.8.1 — "evaluated AT RESET TIME … stores the expression, not a
 * snapshot").
 */
const EXPLICIT_DEFAULT = `<program>
<factor> = 10
\${
    @n = 1
    tare(@n, @factor * 2)
    @n = 999

    function bumpFactor() { @factor = 50 }
    function doReset() { reset(@n) }
}
<button id="bump" onclick=bumpFactor()>bump</button>
<button id="rst" onclick=doReset()>reset</button>
</program>`;

// ---------------------------------------------------------------------------

describe("§6.8.4 tare(@cell) — RUNTIME (happy-dom)", () => {
  beforeEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
    GlobalRegistrator.register();
  });
  afterEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing */ }
  });

  test("the defect: without tare, a double-written implicit cell INCREMENTS on reset", () => {
    const compiled = compileToOutputs(COUNTER_NO_TARE, "counter_plain");
    try {
      expect(compiled.errors).toEqual([]);
      const app = mount(compiled);
      expect(app.threw).toBeNull();
      // Both writes ran at module-init: 0, then 0 + 1.
      expect(app.get("x")).toBe(1);
      // The SECOND write's thunk (`() => current + 1`) is the one that survived,
      // so reset re-runs it: 1 + 1. This is the behaviour §6.8.4 exists to give
      // the author a way to override — asserted so the contrast below is real.
      app.click("rst");
      expect(app.get("x")).toBe(2);
    } finally {
      if (existsSync(compiled.tmpDir)) rmSync(compiled.tmpDir, { recursive: true, force: true });
    }
  });

  test("counter: tare after the FIRST write makes reset restore 0", () => {
    const compiled = compileToOutputs(COUNTER_TARED, "counter_tared");
    try {
      expect(compiled.errors).toEqual([]);
      const app = mount(compiled);
      expect(app.threw).toBeNull();
      expect(app.get("x")).toBe(1);
      app.click("rst");
      expect(app.get("x")).toBe(0);
      // Idempotent: the default slot is not consumed by a reset.
      app.click("rst");
      expect(app.get("x")).toBe(0);
    } finally {
      if (existsSync(compiled.tmpDir)) rmSync(compiled.tmpDir, { recursive: true, force: true });
    }
  });

  test("config: tare after the LAST write makes reset restore the merged value", () => {
    const compiled = compileToOutputs(CONFIG_MERGE, "config_merge");
    try {
      expect(compiled.errors).toEqual([]);
      const app = mount(compiled);
      expect(app.threw).toBeNull();
      expect(app.get("config")).toEqual({ theme: "dark", size: 1 });
      app.click("scramble");
      expect(app.get("config")).toEqual({ theme: "scrambled", size: 99 });
      expect(document.getElementById("shown").textContent).toBe("scrambled");
      app.click("rst");
      // The MERGED value, not `base()` — the same source shape as the counter,
      // the opposite answer, chosen purely by where the author put the tare.
      expect(app.get("config")).toEqual({ theme: "dark", size: 1 });
      // …and the reset propagates through the reactive display, not just the store.
      expect(document.getElementById("shown").textContent).toBe("dark");
    } finally {
      if (existsSync(compiled.tmpDir)) rmSync(compiled.tmpDir, { recursive: true, force: true });
    }
  });

  test("tare(@cell, <expr>) stores a THUNK — the default re-evaluates at reset time", () => {
    const compiled = compileToOutputs(EXPLICIT_DEFAULT, "explicit_default");
    try {
      expect(compiled.errors).toEqual([]);
      const app = mount(compiled);
      expect(app.threw).toBeNull();
      expect(app.get("n")).toBe(999);
      expect(app.get("factor")).toBe(10);

      // Reset now: the default expression `@factor * 2` evaluates against the
      // CURRENT factor (10).
      app.click("rst");
      expect(app.get("n")).toBe(20);

      // Change the upstream cell, then reset again. A SNAPSHOT would still
      // yield 20; a THUNK yields 100. §6.8.1 requires the thunk.
      app.click("bump");
      expect(app.get("factor")).toBe(50);
      app.click("rst");
      expect(app.get("n")).toBe(100);
    } finally {
      if (existsSync(compiled.tmpDir)) rmSync(compiled.tmpDir, { recursive: true, force: true });
    }
  });
});
