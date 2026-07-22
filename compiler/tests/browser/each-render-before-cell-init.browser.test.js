/**
 * each-render-before-cell-init.browser.test.js
 *
 * Regression gate for change-id `each-render-before-cell-init-2026-06-01`.
 *
 * BUG: the auto-generated `<each>` render fn (`_scrml_each_render_NN`) was
 * called synchronously at module-init BEFORE the source cell's
 * `_scrml_reactive_set(...)` ran. On that first call `_scrml_reactive_get(name)`
 * returns undefined (the cell isn't initialized yet), so the bare
 * `_scrml_reconcile_list(_mount, undefined, ...)` threw
 * `TypeError: ...newItems.length`. The compiled JS PARSED fine (node --check /
 * vm.Script pass) — it crashed at RUNTIME on first render: compile-clean,
 * runtime-dead ("scrml dev shows nothing").
 *
 * BLIND SPOT (why the #7 each browser tests missed it): every existing
 * `<each>` reproducer (each-body-interactivity-landing2, each-runtime-bug-57,
 * match-block-in-each) carries an `<empty>` block. emit-each.ts emits an
 * `if (!_items || _items.length === 0) { ...; return; }` guard ONLY for the
 * `<empty>` path — the `!_items` check masked the undefined-at-init crash. The
 * bug only fires for `<each>` with NO `<empty>` block. This test deliberately
 * uses NO `<empty>`, and loads the emitted client.js AS-IS in real module-init
 * order (no hand-ordered state-before-render).
 *
 * FIX (three-part, all asserted here):
 *  - emit-client.ts: the EACH dispatchers (`_scrml_each_render_NN()` +
 *    `_scrml_effect_static`) are emitted AFTER reactiveLines (the cell-init), so
 *    the FIRST render sees the real collection value.
 *  - emit-each.ts: the NO-`<empty>` render path now has an `if (!_items)` guard.
 *  - runtime-template.js: `_scrml_reconcile_list` tolerates undefined/non-array
 *    `newItems` as [].
 *
 * Models: each-body-interactivity-landing2.browser.test.js (compile -> happy-dom
 * mount via new Function + reactive-set side-channel).
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

// The bug shape: `<each in=@CELL>` over a SAME-PROGRAM cell, NO `<empty>` block.
const NONEMPTY_SRC = `<program>
type Item:struct = { id: string, name: string }
<items>: Item[] = [{ id: "a", name: "Alpha" }, { id: "b", name: "Beta" }]
<ul>
    <each in=@items key=@.id>
        <li>\${@.name}</li>
    </each>
</ul>
</program>
`;

const EMPTY_INIT_SRC = `<program>
type Item:struct = { id: string, name: string }
<items>: Item[] = []
<ul>
    <each in=@items key=@.id>
        <li>\${@.name}</li>
    </each>
</ul>
</program>
`;

const tmpRoot = resolve("/tmp", "scrml-each-init-order");

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

// ---------------------------------------------------------------------------
// §1 — codegen emit ordering: cell-init MUST precede the each-render dispatcher
// ---------------------------------------------------------------------------

describe("each-render-before-cell-init §1 — emit ordering (cell-init before dispatcher)", () => {
  test("compile succeeds with no errors (no <empty> block)", () => {
    const { errors } = compileToOutputs(NONEMPTY_SRC, "no-empty");
    expect(errors).toEqual([]);
  });

  test("the _scrml_reactive_set cell-init is emitted BEFORE the each-render dispatcher call", () => {
    const { clientJs } = compileToOutputs(NONEMPTY_SRC, "no-empty");
    const setIdx = clientJs.indexOf('_scrml_reactive_set("items"');
    const dispatchIdx = clientJs.search(/_scrml_each_render_\d+\(\);/);
    expect(setIdx).toBeGreaterThan(-1);
    expect(dispatchIdx).toBeGreaterThan(-1);
    // Root fix: cell-init precedes the synchronous initial render call.
    expect(setIdx).toBeLessThan(dispatchIdx);
  });

  test("the NO-<empty> render path carries an undefined guard (if (!_items))", () => {
    const { clientJs } = compileToOutputs(NONEMPTY_SRC, "no-empty");
    expect(clientJs).toMatch(/if \(!_items\) \{\s*_scrml_each_clear\(_mount\);\s*return;\s*\}/);
  });
});

// ---------------------------------------------------------------------------
// §2 — happy-dom drive: load client.js AS-IS (real module-init order), no crash
// ---------------------------------------------------------------------------

describe("each-render-before-cell-init §2 — real module-init order mounts without crashing", () => {
  beforeEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
    GlobalRegistrator.register();
  });
  afterEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing to do */ }
  });

  function mount(source, baseName) {
    const { html, clientJs, runtimeJs } = compileToOutputs(source, baseName);
    document.documentElement.innerHTML = html;
    // Load the emitted client.js AS-IS — DO NOT hand-order state-before-render.
    // The real module-init statement sequence is exercised exactly as shipped.
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
      mountEl: () => (function(){var w=document.createTreeWalker(document.body,NodeFilter.SHOW_COMMENT),n;while((n=w.nextNode())){if(String(n.data||'').trim().indexOf('scrml-each:')===0)return n.parentNode;}return null;})(),
    };
  }

  test("NON-EMPTY initial: mounting does NOT throw (was TypeError newItems.length)", () => {
    expect(() => mount(NONEMPTY_SRC, "no-empty")).not.toThrow();
  });

  test("NON-EMPTY initial: the FIRST render shows the initial items (ordering fix)", () => {
    const app = mount(NONEMPTY_SRC, "no-empty");
    const rows = app.mountEl().querySelectorAll("li");
    expect(rows.length).toBe(2);
    expect(rows[0].textContent.trim()).toBe("Alpha");
    expect(rows[1].textContent.trim()).toBe("Beta");
  });

  test("EMPTY initial: mounting does NOT throw and renders zero rows", () => {
    let app;
    expect(() => { app = mount(EMPTY_INIT_SRC, "empty-init"); }).not.toThrow();
    expect(app.mountEl().querySelectorAll("li").length).toBe(0);
  });

  test("populate-on-write re-renders (effect subscription fires after cell-init)", () => {
    const app = mount(EMPTY_INIT_SRC, "empty-init");
    expect(app.mountEl().querySelectorAll("li").length).toBe(0);
    app.set("items", [
      { id: "x", name: "Xenon" },
      { id: "y", name: "Yttrium" },
      { id: "z", name: "Zinc" },
    ]);
    const rows = app.mountEl().querySelectorAll("li");
    expect(rows.length).toBe(3);
    expect([...rows].map((n) => n.textContent.trim())).toEqual(["Xenon", "Yttrium", "Zinc"]);
  });

  test("NON-EMPTY initial then re-write re-renders the new set", () => {
    const app = mount(NONEMPTY_SRC, "no-empty");
    expect(app.mountEl().querySelectorAll("li").length).toBe(2);
    app.set("items", [{ id: "c", name: "Gamma" }]);
    const rows = app.mountEl().querySelectorAll("li");
    expect(rows.length).toBe(1);
    expect(rows[0].textContent.trim()).toBe("Gamma");
  });
});
