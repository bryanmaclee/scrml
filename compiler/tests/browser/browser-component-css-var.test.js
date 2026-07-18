/**
 * browser-component-css-var.test.js — §25.5 / §65.3.1 component-scoped reactive
 * CSS custom-property bridge happy-dom EXECUTION acceptance.
 *
 * A component-scoped reactive CSS custom property — a `#{ prop: @cell }` (flat
 * declaration) inside a `const Card = <div…>` where `@cell` is a reactive cell —
 * previously emitted a client-top-level bridge targeting `_scrml_el`, an
 * undefined stub for a per-instance runtime element that does NOT exist
 * (components are compile-time INLINED). Result: `ReferenceError: _scrml_el is
 * not defined` at bundle load → the WHOLE client bundle halted.
 *
 * This test EXECUTES the emitted client bundle (not a grep — this is exactly the
 * class of bug a grep misses) and asserts:
 *   (a) the bundle loads with NO ReferenceError;
 *   (b) at MOUNT, `document.documentElement`'s `--scrml-accent` custom property
 *       is set and equals the cell's value (`#f00`) — the :root property that
 *       inherits into the component's inline `style="… var(--scrml-accent)"`;
 *   (c) after `_scrml_reactive_set("accent", "#00f")`, the effect updates
 *       `--scrml-accent` to the new value — the reactive CSS var works end-to-end.
 */

import { describe, test, expect } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

if (!globalThis.document) GlobalRegistrator.register();

const tmpRoot = resolve("/tmp", "scrml-component-css-var");

function compileToOutputs(source, baseName) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const tmpDir = resolve(tmpRoot, `case-${uniq}`);
  const tmpInput = resolve(tmpDir, `${baseName}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir });
  const clientPath = resolve(outDir, `${baseName}.client.js`);
  const runtimePath = resolve(outDir, result.runtimeFilename ?? "scrml-runtime.js");
  return {
    errors: (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error"),
    clientJs: existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "",
    runtimeJs: existsSync(runtimePath) ? readFileSync(runtimePath, "utf8") : "",
  };
}

function mount(compiled) {
  const { clientJs, runtimeJs } = compiled;
  // Reset :root to a clean state (the bridge writes onto document.documentElement).
  document.documentElement.style.removeProperty("--scrml-accent");
  document.body.innerHTML = "";
  const exec = new Function(
    "window",
    "document",
    `${runtimeJs}\n${clientJs}\n`
      + `globalThis.__scrml_get__ = _scrml_reactive_get;\n`
      + `globalThis.__scrml_set__ = _scrml_reactive_set;\n`,
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
    set: (name, val) => globalThis.__scrml_set__(name, val),
    // The bridge sets the custom property on :root (document.documentElement).
    accentVar: () => document.documentElement.style.getPropertyValue("--scrml-accent").trim(),
  };
}

/** A component-scoped reactive CSS var: a flat `#{ color: @accent }` in `const Card`. */
const CARD_SRC = `<program>
  <accent> = "#f00"
  const Card = <div props={}>
      #{ color: @accent; }
      <div class="body">hi</div>
  </>
  <Card/>
</program>`;

describe("§25.5 / §65.3.1 — component-scoped reactive CSS var — EXECUTED bundle", () => {
  test("the client bundle loads with NO ReferenceError (fix: no undefined _scrml_el target)", () => {
    const compiled = compileToOutputs(CARD_SRC, "component-css-var");
    expect(compiled.errors).toEqual([]);
    // The emitted bridge must never reference the undefined per-instance stub.
    expect(compiled.clientJs).not.toContain("_scrml_el");
    const app = mount(compiled);
    expect(app.threw).toBeNull();
  });

  test("at MOUNT, :root carries --scrml-accent = the cell's value (#f00)", () => {
    const app = mount(compileToOutputs(CARD_SRC, "component-css-var"));
    expect(app.threw).toBeNull();
    expect(app.accentVar()).toBe("#f00");
  });

  test("after _scrml_reactive_set('accent', '#00f'), the effect updates --scrml-accent (reactive end-to-end)", () => {
    const app = mount(compileToOutputs(CARD_SRC, "component-css-var"));
    expect(app.threw).toBeNull();
    expect(app.accentVar()).toBe("#f00");
    app.set("accent", "#00f");
    expect(app.accentVar()).toBe("#00f");
    // The bridge is a live subscription, not a one-shot — set back to the original.
    app.set("accent", "#f00");
    expect(app.accentVar()).toBe("#f00");
  });
});
