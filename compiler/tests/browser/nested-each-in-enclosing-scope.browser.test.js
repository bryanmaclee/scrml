/**
 * nested-each-in-enclosing-scope.browser.test.js
 *
 * Regression gate for change-id `each-in-enclosing-scope-2026-06-01` (S153), Bug A.
 *
 * BUG: a NESTED `<each>` (the primer §6.3 `as` alias pattern —
 *   `<each in=@groups as g> <each in=g.items> <li>${@.name}</li> </each> </each>`)
 * was lifted to a MODULE-SCOPE render fn `_scrml_each_render_12()` whose body
 * read `const _items = g.items;` — but `g` (the OUTER each's iter alias) is bound
 * ONLY inside the outer per-item factory, never at module scope. At module-init
 * `g` is undefined → runtime ReferenceError. The inner each was ALSO dropped from
 * the outer factory (renderTemplateChildToJs fell through to the unhandled-kind
 * comment). Compiles clean; runtime-dead.
 *
 * FIX (emit-each.ts): collectEachBlocks marks a nested each `isNested`;
 * emitEachBodyRenderForFile skips its module-scope render fn; renderTemplateChildToJs
 * gains an each-block branch that emits the inner each INLINE inside the outer
 * factory (item-local mount + inline reconcile, source `g.items` valid in the
 * factory scope where `g` is the closure param). Mirrors the R28-1b
 * <match>-in-<each> precedent.
 *
 * This test loads the emitted client.js AS-IS in real module-init order and
 * asserts the nested list ACTUALLY renders the items in the DOM (compile-clean
 * is NOT enough — the engine/match lesson).
 *
 * Models: engine-gated-each-populate.browser.test.js.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

// repro-1: one outer group whose items render as nested <li>s. The inner each's
// source `g.items` references the OUTER alias `g`, bound only in the outer factory.
const NESTED_SRC = `<program>
type Item:struct = { id: string, name: string }
type Group:struct = { id: string, items: Item[] }
<groups>: Group[] = [
  { id: "g1", items: [{ id: "a", name: "alpha" }, { id: "b", name: "beta" }] }
]
<ul>
  <each in=@groups as g key=g.id>
    <each in=g.items key=@.id>
      <li>\${@.name}</li>
    </each>
  </each>
</ul>
</program>
`;

// repro-2: two outer groups → confirms per-outer-item inner rendering + outer
// reactivity re-renders both inner lists.
const TWO_GROUP_SRC = `<program>
type Item:struct = { id: string, name: string }
type Group:struct = { id: string, items: Item[] }
<groups>: Group[] = [
  { id: "g1", items: [{ id: "a", name: "alpha" }] },
  { id: "g2", items: [{ id: "b", name: "beta" }, { id: "c", name: "gamma" }] }
]
<ul>
  <each in=@groups as g key=g.id>
    <each in=g.items key=@.id>
      <li>\${@.name}</li>
    </each>
  </each>
</ul>
</program>
`;

const tmpRoot = resolve("/tmp", "scrml-nested-each");

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
// §1 — emit shape: NO phantom module-scope render fn for the inner each
// ---------------------------------------------------------------------------

describe("nested-each §1 — emit shape (inline inner each, no phantom module-scope fn)", () => {
  test("compiles with no errors", () => {
    expect(compileToOutputs(NESTED_SRC, "nested").errors).toEqual([]);
  });

  test("the inner each source resolves in the OUTER factory scope (no bare module-scope g.items)", () => {
    const { clientJs } = compileToOutputs(NESTED_SRC, "nested");
    // The OLD defect emitted `const _items = g.items;` at module scope (g undefined).
    // After the fix the inner source is read into an item-local var INSIDE the
    // outer factory closure (after the outer factory `(g, ...) => {` opener).
    const factoryIdx = clientJs.indexOf("(g, _scrml_each_idx) => {");
    expect(factoryIdx).toBeGreaterThan(-1);
    const itemsIdx = clientJs.indexOf("= g.items;");
    expect(itemsIdx).toBeGreaterThan(-1);
    // The `g.items` read appears AFTER the outer factory opener (in-scope).
    expect(itemsIdx).toBeGreaterThan(factoryIdx);
  });

  test("no phantom module-scope inner-each render fn / dispatcher", () => {
    const { clientJs } = compileToOutputs(NESTED_SRC, "nested");
    // Exactly ONE module-scope each render fn (the OUTER each). The inner each
    // is inline; it gets no `function _scrml_each_render_<innerId>() {` of its own.
    const renderFnCount = (clientJs.match(/^function _scrml_each_render_\d+\(\) \{/gm) || []).length;
    expect(renderFnCount).toBe(1);
    // No unhandled-kind drop comment for the inner each.
    expect(clientJs).not.toContain('each: unhandled template child kind="each-block"');
  });

  test("emitted client.js parses (no E-CODEGEN-INVALID-LOGIC) via --validate-emit", () => {
    // The full compile already runs the Stage emit-validate gate when invoked
    // through the CLI; here we assert the compile-with-write surfaced no errors
    // (the gate would have populated result.errors with E-CODEGEN-INVALID-LOGIC).
    const { errors } = compileToOutputs(NESTED_SRC, "nested");
    expect(errors.filter((e) => String(e.code || "").includes("CODEGEN-INVALID-JS"))).toEqual([]);
    expect(errors.filter((e) => String(e.code || "").includes("SCOPE-001"))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §2 — happy-dom drive: nested list populates in real module-init order
// ---------------------------------------------------------------------------

describe("nested-each §2 — nested list populates (real module-init order)", () => {
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
      // All <li> nodes rendered ANYWHERE inside the outer each region. The outer
      // each (top-level) mounts as a comment fence in <ul>; its per-group rows are
      // the inner nested-each divs (nested eaches keep their runtime <div>). So the
      // outer fence's parent (<ul>) holds every rendered <li>. Locate it via the
      // fence comment (the only scrml-each: fence — inner eaches use div mounts).
      allRows: () => {
        const _w = document.createTreeWalker(document.body, NodeFilter.SHOW_COMMENT);
        let _n;
        while ((_n = _w.nextNode())) {
          if (String(_n.data || "").trim().indexOf("scrml-each:") === 0) return _n.parentNode.querySelectorAll("li");
        }
        return [];
      },
    };
  }

  test("repro-1 (one group): inner list renders alpha + beta", () => {
    const app = mount(NESTED_SRC, "nested");
    const rows = app.allRows();
    expect([...rows].map((n) => n.textContent.trim())).toEqual(["alpha", "beta"]);
  });

  test("repro-2 (two groups): each outer item renders its own inner list", () => {
    const app = mount(TWO_GROUP_SRC, "twogroup");
    const rows = app.allRows();
    // g1 → [alpha]; g2 → [beta, gamma]. Order follows outer then inner.
    expect([...rows].map((n) => n.textContent.trim())).toEqual(["alpha", "beta", "gamma"]);
  });

  test("outer reactivity: mutating @groups re-renders the nested lists", () => {
    const app = mount(NESTED_SRC, "nested");
    expect([...app.allRows()].map((n) => n.textContent.trim())).toEqual(["alpha", "beta"]);
    // Replace with a single group / single item — the outer effect re-runs,
    // re-building each outer item's inner list.
    app.set("groups", [{ id: "g9", items: [{ id: "z", name: "zeta" }] }]);
    expect([...app.allRows()].map((n) => n.textContent.trim())).toEqual(["zeta"]);
  });
});
