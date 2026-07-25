/**
 * i174-formcontrol-value-property.browser.test.js
 *
 * Executed-DOM acceptance gate for GH adopter issue #174 (SPEC §5.5.4).
 *
 * DEFECT: a reactive template-string `value="${@cell}"` on a form control lowered
 * to `setAttribute("value", …)` inside a `_scrml_effect`. setAttribute writes only
 * the HTML *attribute* (the DEFAULT value); once the user types, the DOM `.value`
 * *property* diverges, and a programmatic `@cell = ""` re-runs setAttribute but the
 * visible field never clears. SPEC §5.5.4 makes `value=` on a form control the
 * exclusive owner of the `.value` PROPERTY; SPEC §5 makes emitting setAttribute for
 * a property-backed attribute a compiler defect.
 *
 *   §1 — emit-shape: the effect writes the `.value` PROPERTY, never setAttribute.
 *   §2 — type-then-clear canary (the exact adopter symptom): mount, simulate the
 *        user typing, run the clear handler (`@name = ""`), assert `.value === ""`.
 *   §3 — E-ATTR-WRITER-CONFLICT is unaffected (value= + bind:value still errors).
 *
 * Models: compiler/tests/browser/each-bind-value-i175.browser.test.js
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

// The adopter's exact repro (GH #174).
const REPRO_SRC = `<program>
  <name> = "alice"
  <div>
    <input type="text" value="\${@name}"/>
    <button onclick=\${@name = ""}>Clear</button>
  </div>
</program>
`;

const tmpRoot = resolve("/tmp", "scrml-i174-formvalue");

function compileToOutputs(source, baseName = "i174-formvalue") {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const tmpDir = resolve(tmpRoot, `case-${uniq}`);
  const tmpInput = resolve(tmpDir, `${baseName}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir });
    const htmlPath = resolve(outDir, `${baseName}.html`);
    const clientPath = resolve(outDir, `${baseName}.client.js`);
    const runtimePath = resolve(outDir, result.runtimeFilename ?? "scrml-runtime.js");
    return {
      errors: result.errors ?? [],
      warnings: result.warnings ?? [],
      html: existsSync(htmlPath) ? readFileSync(htmlPath, "utf8") : "",
      clientJs: existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "",
      runtimeJs: existsSync(runtimePath) ? readFileSync(runtimePath, "utf8") : "",
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// §1 — emit-shape
// ---------------------------------------------------------------------------

describe("i174 (browser) §1 — emitted wiring writes the .value PROPERTY", () => {
  test("compiles clean; effect writes .value, not setAttribute", () => {
    const { errors, clientJs } = compileToOutputs(REPRO_SRC);
    expect(errors).toEqual([]);
    // Property write inside the reactive effect, caret-safe inequality guard.
    expect(clientJs).toMatch(/\.value = _scrml_tpl_val_\d+/);
    expect(clientJs).toMatch(/\.value !== _scrml_tpl_val_\d+/);
    // The defect: setAttribute("value", …) must be gone.
    expect(clientJs).not.toContain('setAttribute("value"');
  });
});

// ---------------------------------------------------------------------------
// §2 — type-then-clear canary (the exact adopter symptom)
// ---------------------------------------------------------------------------

describe("i174 (browser) §2 — type-then-clear executed DOM", () => {
  beforeEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
    GlobalRegistrator.register();
  });
  afterEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing to do */ }
  });

  function mount() {
    const { html, clientJs, runtimeJs, errors } = compileToOutputs(REPRO_SRC);
    if (errors.length) throw new Error("compile errors: " + JSON.stringify(errors.map((e) => e.code)));
    document.documentElement.innerHTML = html;
    const exec = new Function(
      "window",
      "document",
      `${runtimeJs}\n${clientJs}\n` +
        `globalThis.__scrml_set__ = _scrml_reactive_set;\n` +
        `globalThis.__scrml_get__ = _scrml_reactive_get;\n`,
    );
    exec(window, document);
    document.dispatchEvent(new Event("DOMContentLoaded"));
    return {
      set: (name, val) => globalThis.__scrml_set__(name, val),
      get: (name) => globalThis.__scrml_get__(name),
      input: () => document.querySelector("input"),
      button: () => document.querySelector("button"),
    };
  }

  test("mounting does NOT throw", () => {
    expect(() => mount()).not.toThrow();
  });

  test("initial: input.value reflects the initial cell", () => {
    const app = mount();
    expect(app.input().value).toBe("alice");
  });

  test("CANARY: type into the field, then Clear — the visible field clears", () => {
    const app = mount();
    const input = app.input();
    expect(input.value).toBe("alice");

    // Simulate the user typing: the DOM .value PROPERTY diverges from the
    // attribute. Under the setAttribute defect the effect wrote the attribute,
    // which the browser now ignores, so the next clear could not reach .value.
    input.value = "user typed this";
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    expect(input.value).toBe("user typed this");

    // Run the real clear handler (`@name = ""`) via a button click.
    app.button().dispatchEvent(new window.Event("click", { bubbles: true }));

    // The exact adopter assertion: the visible field is now empty.
    expect(app.get("name")).toBe("");
    expect(input.value).toBe("");
  });

  test("programmatic @name write updates a dirty field's .value", () => {
    const app = mount();
    const input = app.input();
    input.value = "dirty";
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    app.set("name", "reset-by-code");
    expect(input.value).toBe("reset-by-code");
  });
});

// ---------------------------------------------------------------------------
// §3 — E-ATTR-WRITER-CONFLICT unaffected (writer-ownership floor, §5.5.4 Axiom ①)
// ---------------------------------------------------------------------------

describe("i174 (browser) §3 — writer-ownership floor still fires", () => {
  test("value=(expr) + bind:value on one form control STILL errors E-ATTR-WRITER-CONFLICT", () => {
    const src = `<program>
      <name> = "x"
      <disp> = "y"
      <input type="text" bind:value=@name value=(@disp)/>
    </program>`;
    const { errors, warnings } = compileToOutputs(src, "i174-conflict");
    const codes = [...errors, ...warnings].map((e) => e.code ?? "");
    expect(codes).toContain("E-ATTR-WRITER-CONFLICT");
  });
});
