/**
 * each-in-tier0-lift-bug72.browser.test.js — Bug 72 (S158).
 *
 * Runtime gate for the Tier-0 lift nested-<each> fix. Compile-clean is NOT
 * enough (the engine/match lesson): this test loads the emitted client.js AS-IS
 * in real module-init order, drives `@rows`, and asserts the inner `<each>`
 * ACTUALLY renders each row's cells into the DOM — proving the inner `@.`
 * resolved to the inner each's current value at runtime (SPEC §17.7.3).
 *
 * Reproducer shape:
 *   ${ for (row of @rows) { lift <tr><each in=row.cells><td>${@.}</td></each></tr> } }
 *
 * Models: nested-each-in-enclosing-scope.browser.test.js.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

// The reproducer: nested <each in=row.cells> inside a Tier-0 ${for...lift}.
const REPRO_SRC = `<program>
type Row:struct = { id: string, cells: string[] }
<rows>: Row[] = []
<table>
  <tbody>
    \${ for (row of @rows) {
      lift <tr><each in=row.cells><td>\${@.}</td></each></tr>
    } }
  </tbody>
</table>
</program>
`;

// Variant with a per-item @. ATTR value alongside the interpolation (the
// string-fallback leak the ast-builder branch closes). title=@. must render too.
const REPRO_ATTR_SRC = `<program>
type Row:struct = { id: string, cells: string[] }
<rows>: Row[] = []
<table>
  <tbody>
    \${ for (row of @rows) {
      lift <tr><each in=row.cells><td title=@.>\${@.}</td></each></tr>
    } }
  </tbody>
</table>
</program>
`;

const tmpRoot = resolve("/tmp", "scrml-each-tier0-lift-bug72");

function compileToOutputs(source, baseName) {
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
      html: existsSync(htmlPath) ? readFileSync(htmlPath, "utf8") : "",
      clientJs: existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "",
      runtimeJs: existsSync(runtimePath) ? readFileSync(runtimePath, "utf8") : "",
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("bug72 browser — nested <each> inside Tier-0 lift renders cells", () => {
  beforeEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
    GlobalRegistrator.register();
  });
  afterEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing to do */ }
  });

  function mount(source, baseName) {
    const { errors, html, clientJs, runtimeJs } = compileToOutputs(source, baseName);
    expect(errors.filter((e) => String(e.code || "").includes("CODEGEN-INVALID-JS"))).toEqual([]);
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
      // The lifted for-loop content mounts at the `data-scrml-logic` span. (happy-dom
      // relocates the bare span out of <tbody> — invalid HTML — so we query the
      // mount subtree, not `table td`.) The inner each builds <td>s under a
      // `data-scrml-each-mount` div inside each lifted <tr>.
      cells: () => [...document.querySelectorAll('[data-scrml-logic="_scrml_logic_1"] td')],
      cellText: () => [...document.querySelectorAll('[data-scrml-logic="_scrml_logic_1"] td')].map((n) => n.textContent.trim()),
      rows: () => [...document.querySelectorAll('[data-scrml-logic="_scrml_logic_1"] tr')],
    };
  }

  test("each row's cells render via the inner each (inner @. resolves at runtime)", () => {
    const app = mount(REPRO_SRC, "repro");
    // Drive the reactive @rows — the for-lift effect builds one <tr> per row,
    // each <tr>'s inner each builds one <td> per cell, the <td> text is @.
    app.set("rows", [
      { id: "r1", cells: ["a1", "a2", "a3"] },
      { id: "r2", cells: ["b1", "b2"] },
    ]);
    expect(app.rows().length).toBe(2);
    expect(app.cellText()).toEqual(["a1", "a2", "a3", "b1", "b2"]);
  });

  test("reactivity: mutating @rows re-renders the nested cell lists", () => {
    const app = mount(REPRO_SRC, "repro");
    app.set("rows", [{ id: "r1", cells: ["x", "y"] }]);
    expect(app.cellText()).toEqual(["x", "y"]);
    app.set("rows", [{ id: "r9", cells: ["zeta"] }]);
    expect(app.cellText()).toEqual(["zeta"]);
  });

  test("per-item @. ATTR value renders on each cell alongside the interpolation", () => {
    const app = mount(REPRO_ATTR_SRC, "repro-attr");
    app.set("rows", [{ id: "r1", cells: ["alpha", "beta"] }]);
    expect(app.cellText()).toEqual(["alpha", "beta"]);
    // title=@. lowered to the inner iter var, so each <td> carries its cell text
    // as its title attribute too.
    expect(app.cells().map((n) => n.getAttribute("title"))).toEqual(["alpha", "beta"]);
  });
});
