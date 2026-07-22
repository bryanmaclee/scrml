/**
 * engine-gated-each-populate.browser.test.js
 *
 * Regression gate for change-id `engine-gated-each-populate-2026-06-01` (S153).
 *
 * BUG: an `<each>` whose mount lives inside a NON-`initial=` engine arm never
 * populated. The each-mount `<div data-scrml-each-mount="each_N">` is emitted
 * INSIDE the arm's render output (`_scrml_engine_phase_render_Browsing()`), so
 * at module-init it is absent from the DOM (the engine renders only the
 * `initial=` arm). Three coupled failure modes:
 *
 *   Mode 1 — dep never tracked. The each render fn returned at `if (!_mount)
 *   return;` BEFORE reading `_scrml_reactive_get("todos")`. `_scrml_effect_static`
 *   collects deps only on its FIRST run; at module-init the mount is absent so the
 *   first run short-circuited before the cell read → zero deps → the effect was
 *   permanently subscribed to nothing.
 *
 *   Mode 2 — no render on arm-entry. The engine dispatcher wrote the Browsing
 *   arm's innerHTML (so the each-mount div now exists) but nothing called the
 *   each render fn → the list stayed empty.
 *
 *   Mode 3 — runtime helpers tree-shaken out. `detectRuntimeChunks` did NOT
 *   descend into engine `bodyChildren`, so the each inside the non-initial arm
 *   never triggered the `reconciliation` / `deep_reactive` chunks. The emitted
 *   arm code called `_scrml_reconcile_list` / `_scrml_effect_static` /
 *   `_scrml_remount_each` against helpers that were absent → runtime
 *   ReferenceError on arm mount (compile-clean, node --check-clean).
 *
 * FIX (all asserted here):
 *  - emit-each.ts: dep-first read (const _items = ... BEFORE the mount query).
 *  - emit-each.ts + runtime + emit-variant-guard.ts: each-renderer registry
 *    (`_scrml_each_renderers`) + `_scrml_remount_each(armRoot)` called after the
 *    dispatcher writes+wires each arm.
 *  - emit-client.ts: chunk-walk descends into engine bodyChildren.
 *
 * BLIND SPOT this closes (S152 precedent): every prior `<each>` browser test
 * carried an `<empty>` guard that masked runtime gaps, and several were
 * emit-string-only. This test loads the emitted client.js AS-IS in real
 * module-init order and asserts the list actually populates in the DOM after the
 * arm is entered.
 *
 * Models: each-render-before-cell-init.browser.test.js.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

// repro-1: pre-populated @todos; button transitions Loading -> Browsing. Exercises
// Mode 2 (entry render) and Mode 3 (chunk shipping). The each is inside the
// Browsing (non-initial) arm with NO <empty> block.
const BUTTON_SRC = `<program>
type Phase:enum = { Loading, Browsing }
type Todo:struct = { id: string, name: string }
<todos>: Todo[] = [{ id: "1", name: "alpha" }, { id: "2", name: "beta" }]
<engine for=Phase initial=.Loading>
  <Loading rule=.Browsing>
    <button onclick=\${@phase = .Browsing}>Go</button>
  </>
  <Browsing rule=.Loading>
    <each in=@todos key=@.id>
      <li>\${@.name}</li>
    </each>
  </>
</>
</program>
`;

// repro-2: empty @todos; boot-only opener effect= loads todos + transitions to
// Browsing. Exercises Mode 1 (data written during Loading, then variant-swap) +
// Mode 2 + Mode 3.
const BOOT_SRC = `<program>
type Phase:enum = { Loading, Browsing }
type Todo:struct = { id: string, name: string }
<todos>: Todo[] = []
<engine for=Phase initial=.Loading effect=\${@todos = [{ id: "1", name: "alpha" }, { id: "2", name: "beta" }]; @phase = .Browsing}>
  <Loading rule=.Browsing>
    Loading...
  </>
  <Browsing rule=.Loading>
    <each in=@todos key=@.id>
      <li>\${@.name}</li>
    </each>
  </>
</>
</program>
`;

const tmpRoot = resolve("/tmp", "scrml-engine-gated-each");

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
// §1 — codegen emit shape: dep-first read + remount call + runtime helper ship
// ---------------------------------------------------------------------------

describe("engine-gated-each §1 — emit shape (dep-first read, remount call, helpers ship)", () => {
  test("both reproducers compile with no errors", () => {
    expect(compileToOutputs(BUTTON_SRC, "button").errors).toEqual([]);
    expect(compileToOutputs(BOOT_SRC, "boot").errors).toEqual([]);
  });

  test("each render fn reads the source cell BEFORE the mount guard (Mode 1 fix)", () => {
    const { clientJs } = compileToOutputs(BUTTON_SRC, "button");
    const getIdx = clientJs.indexOf('const _items = _scrml_reactive_get("todos");');
    const mountIdx = clientJs.indexOf("const _mount = _scrml_find_each_anchor(document,");
    expect(getIdx).toBeGreaterThan(-1);
    expect(mountIdx).toBeGreaterThan(-1);
    expect(getIdx).toBeLessThan(mountIdx);
  });

  test("the engine dispatcher invokes _scrml_remount_each after writing the Browsing arm (Mode 2 fix)", () => {
    const { clientJs } = compileToOutputs(BUTTON_SRC, "button");
    // The Browsing arm writes innerHTML then calls _scrml_remount_each(_mount).
    expect(clientJs).toMatch(/_mount\.innerHTML = _scrml_engine_phase_render_Browsing\(\);[\s\S]*?_scrml_remount_each\(_mount\);/);
  });

  test("the each renderer registers itself in _scrml_each_renderers", () => {
    const { clientJs } = compileToOutputs(BUTTON_SRC, "button");
    expect(clientJs).toMatch(/_scrml_each_renderers\["each_\d+"\] = _scrml_each_render_\d+;/);
  });

  test("the runtime ships reconcile_list + remount_each + registry + effect_static (Mode 3 fix)", () => {
    const { runtimeJs } = compileToOutputs(BUTTON_SRC, "button");
    expect(runtimeJs).toContain("function _scrml_reconcile_list");
    expect(runtimeJs).toContain("function _scrml_remount_each");
    expect(runtimeJs).toContain("const _scrml_each_renderers");
    expect(runtimeJs).toContain("function _scrml_effect_static");
  });
});

// ---------------------------------------------------------------------------
// §2 — happy-dom drive: load client.js AS-IS, list populates on arm entry
// ---------------------------------------------------------------------------

describe("engine-gated-each §2 — list populates on arm entry (real module-init order)", () => {
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
    // Load the emitted client.js AS-IS — DO NOT hand-order. The real module-init
    // statement sequence is exercised exactly as shipped.
    const exec = new Function(
      "window",
      "document",
      `${runtimeJs}\n${clientJs}\n` +
        `globalThis.__scrml_set__ = _scrml_reactive_set;\n` +
        `globalThis.__scrml_get__ = _scrml_reactive_get;\n` +
        `globalThis.__scrml_engine_direct_set__ = _scrml_engine_direct_set;\n` +
        `globalThis.__scrml_phase_transitions__ = __scrml_engine_phase_transitions;\n`,
    );
    exec(window, document);
    document.dispatchEvent(new Event("DOMContentLoaded"));
    return {
      set: (name, val) => globalThis.__scrml_set__(name, val),
      get: (name) => globalThis.__scrml_get__(name),
      // Drive an engine transition the same way the runtime direct-write hook does.
      directSet: (tag) =>
        globalThis.__scrml_engine_direct_set__("phase", tag, globalThis.__scrml_phase_transitions__),
      engineMount: () => document.querySelector('[data-scrml-engine-mount="phase"]'),
      rows: () => (function(){var w=document.createTreeWalker(document.body,NodeFilter.SHOW_COMMENT),n;while((n=w.nextNode())){if(String(n.data||'').trim().indexOf('scrml-each:')===0)return n.parentNode.querySelectorAll('li');}return [];})(),
    };
  }

  test("repro-1 (button): Loading shows no <li>; after transition to Browsing the list populates", () => {
    const app = mount(BUTTON_SRC, "button");
    // Initial = Loading arm: button rendered, no each-mount, no <li>.
    expect(app.engineMount().querySelector("button")).not.toBeNull();
    expect(app.rows().length).toBe(0);
    // Drive the transition (same path the onclick hook fires).
    app.directSet("Browsing");
    const rows = app.rows();
    expect(rows.length).toBe(2);
    expect([...rows].map((n) => n.textContent.trim())).toEqual(["alpha", "beta"]);
  });

  test("repro-2 (boot effect): boot opener loads todos + transitions; list populates", () => {
    const app = mount(BOOT_SRC, "boot");
    // The boot opener effect= runs at module-init: sets @todos then transitions
    // to Browsing, which mounts the each and remounts it. By the time mount()
    // returns (after DOMContentLoaded re-dispatch) the list is populated.
    const rows = app.rows();
    expect(rows.length).toBe(2);
    expect([...rows].map((n) => n.textContent.trim())).toEqual(["alpha", "beta"]);
  });

  test("ongoing reactivity: mutating @todos while Browsing is visible re-renders (Mode 1 dep established)", () => {
    const app = mount(BUTTON_SRC, "button");
    app.directSet("Browsing");
    expect(app.rows().length).toBe(2);
    // The effect dep on @todos was established at module-init (dep-first read).
    app.set("todos", [{ id: "z", name: "zeta" }]);
    const rows = app.rows();
    expect(rows.length).toBe(1);
    expect(rows[0].textContent.trim()).toBe("zeta");
  });

  test("idempotent re-entry: Loading -> Browsing -> Loading -> Browsing re-renders correctly", () => {
    const app = mount(BUTTON_SRC, "button");
    app.directSet("Browsing");
    expect(app.rows().length).toBe(2);
    app.directSet("Loading");
    // Back in Loading: button arm, no each rows.
    expect(app.engineMount().querySelector("button")).not.toBeNull();
    expect(app.rows().length).toBe(0);
    app.directSet("Browsing");
    // Re-entry re-renders the list with no duplicates.
    const rows = app.rows();
    expect(rows.length).toBe(2);
    expect([...rows].map((n) => n.textContent.trim())).toEqual(["alpha", "beta"]);
  });
});
