/**
 * each-body-interactivity-landing2.browser.test.js
 *
 * Landing 2 acceptance gate for per-item `<each>` body interactivity
 * (SPEC §17.7.2 Shape 4 + §17.7.3). Landing 1 dropped per-item element event
 * handlers, `class:` bindings, and `${...}`/`@.field` attribute interpolation —
 * they emitted as inert `setAttribute(name, "")` / literalized source strings,
 * so a clicked per-item `<li>` did nothing and the conditional class never
 * toggled. This is the corpus-coverage gap that let the bug ship: no browser
 * test loaded `<each>` interactivity (the unit tier was emit-string-only).
 *
 * §1 — emit-regression: assert the EMITTED client.js wires class:/onclick/${}
 *      to real classList.toggle / addEventListener / setAttribute(String(expr)).
 * §2 — happy-dom drive: mount the reproducer, populate @items, CLICK a per-item
 *      <li>, assert the handler fired (item state flipped) AND the class toggled.
 *
 * Models: compiler/tests/browser/each-runtime-bug-57.test.js (each + happy-dom
 * mount via new Function + cell side-channel).
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

// The brief reproducer: per-item class: binding + event handler + ${} interp,
// with a toggle() that flips the clicked item's `done` flag in @items.
const REPRO_SRC = `<program>
type Item:struct = { id: string, name: string, done: boolean }
<items>: Item[] = []
function toggle(id) {
    @items = @items.map(x => x.id == id ? {...x, done: !x.done} : x)
}
<ul>
    <each in=@items key=@.id>
        <li class:done=@.done onclick=toggle(@.id) data-id=\${@.id}>
            \${@.name}
        </li>
        <empty>No items yet.</empty>
    </each>
</ul>
</program>
`;

const tmpRoot = resolve("/tmp", "scrml-each-l2");

function compileToOutputs(source, baseName = "each-l2") {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const tmpDir = resolve(tmpRoot, `case-${uniq}`);
  const tmpInput = resolve(tmpDir, `${baseName}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({
      inputFiles: [tmpInput],
      write: true,
      outputDir: outDir,
    });
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
// §1 — emit-regression (FAILS on Landing-1 baseline, PASSES post-fix)
// ---------------------------------------------------------------------------

describe("each-body-interactivity L2 §1 — emitted wiring", () => {
  test("compile succeeds with no errors (was E-SCOPE-001 on class:done=@.done)", () => {
    const { errors } = compileToOutputs(REPRO_SRC);
    expect(errors).toEqual([]);
  });

  test("class:done lowers to classList.toggle (not inert setAttribute)", () => {
    const { clientJs } = compileToOutputs(REPRO_SRC);
    expect(clientJs).toContain('.classList.toggle("done", !!(_scrml_each_item.done));');
    expect(clientJs).not.toContain('setAttribute("class:done"');
  });

  test("onclick lowers to addEventListener calling the handler with the item id", () => {
    const { clientJs } = compileToOutputs(REPRO_SRC);
    expect(clientJs).toMatch(/\.addEventListener\("click", function\(event\) \{ /);
    expect(clientJs).toMatch(/_scrml_toggle_\d+\(_scrml_each_item\.id\);/);
    expect(clientJs).not.toContain('setAttribute("onclick"');
  });

  test("${@.id} interpolation lowers to the VALUE (not the literal source string)", () => {
    const { clientJs } = compileToOutputs(REPRO_SRC);
    expect(clientJs).toContain('.setAttribute("data-id", String(_scrml_each_item.id));');
    expect(clientJs).not.toContain('setAttribute("data-id", "_scrml_each_item.id")');
  });
});

// ---------------------------------------------------------------------------
// §2 — happy-dom drive: click a per-item <li>, assert handler fired + class toggled
// ---------------------------------------------------------------------------

describe("each-body-interactivity L2 §2 — click drives the per-item handler", () => {
  beforeEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
    GlobalRegistrator.register();
  });
  afterEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing to do */ }
  });

  function mount() {
    const { html, clientJs, runtimeJs } = compileToOutputs(REPRO_SRC);
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
      mountEl: () => (function(){var w=document.createTreeWalker(document.body,NodeFilter.SHOW_COMMENT),n;while((n=w.nextNode())){if(String(n.data||'').trim().indexOf('scrml-each:')===0)return n.parentNode;}return null;})(),
    };
  }

  test("mounting does NOT throw", () => {
    expect(() => mount()).not.toThrow();
  });

  test("per-item element carries the interpolated data-id VALUE", () => {
    const app = mount();
    app.set("items", [{ id: "a", name: "Alpha", done: false }]);
    const li = app.mountEl().querySelector("li");
    expect(li).not.toBeNull();
    // data-id carries the item's id value, not the literal "@.id" / "_scrml_each_item.id".
    expect(li.getAttribute("data-id")).toBe("a");
  });

  test("class:done reflects the initial item flag", () => {
    const app = mount();
    app.set("items", [
      { id: "a", name: "Alpha", done: false },
      { id: "b", name: "Beta", done: true },
    ]);
    const rows = app.mountEl().querySelectorAll("li");
    expect(rows[0].classList.contains("done")).toBe(false);
    expect(rows[1].classList.contains("done")).toBe(true);
  });

  test("clicking a per-item <li> fires toggle() — item.done flips in @items", () => {
    const app = mount();
    app.set("items", [{ id: "a", name: "Alpha", done: false }]);
    const li = app.mountEl().querySelector("li");
    expect(li).not.toBeNull();
    // Pre-click: done is false.
    expect(app.get("items")[0].done).toBe(false);
    // CLICK — Landing 1 dropped the handler (no addEventListener), so this was
    // a no-op and the assertion below would fail.
    li.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    // The handler fired: the item's done flag flipped to true.
    expect(app.get("items")[0].done).toBe(true);
  });

  test("class:done evaluates per item on a STRUCTURAL reconcile (new keys -> create-fn)", () => {
    const app = mount();
    // Two items with distinct done flags — class:done evaluates per item at
    // create-fn time.
    app.set("items", [
      { id: "a", name: "Alpha", done: false },
      { id: "b", name: "Beta", done: true },
    ]);
    let rows = app.mountEl().querySelectorAll("li");
    expect(rows[0].classList.contains("done")).toBe(false);
    expect(rows[1].classList.contains("done")).toBe(true);
    // Replace with a NEW key (forces create-fn for the new row) — class:done
    // re-evaluates against the new item's flag.
    app.set("items", [{ id: "c", name: "Gamma", done: true }]);
    rows = app.mountEl().querySelectorAll("li");
    expect(rows.length).toBe(1);
    expect(rows[0].classList.contains("done")).toBe(true);
  });

  // DEFERRED (not a Landing-2 regression): in-place mutation of an EXISTING
  // keyed row's class:done. When `toggle()` reassigns @items via `.map()` the
  // item KEY (@.id) is unchanged, so the keyed reconcile fast-path
  // (runtime-template.js:1293 "S106 same-keys-same-order") reuses the DOM node
  // and does NOT re-run the create-fn (where class:done lives). The runtime
  // delegates per-row updates to per-row subscriptions
  // (_scrml_value_indexed_subscribers / _scrml_prop_subscribers), which neither
  // the Tier-1 <each> codegen NOR the Tier-0 ${for…lift} codegen currently
  // wires for `class:` on reused rows — verified empirically: the lift path has
  // the IDENTICAL behavior (handler fires + state flips, but the reused row's
  // class does not re-toggle). Closing this gap is a shared reconcile-reactivity
  // landing for BOTH paths, beyond Landing-2's "complete the attr-drop + fix
  // the E-SCOPE-001" scope. The test below pins the firing + state half (which
  // Landing 1 dropped entirely — no addEventListener at all).
  test("clicking a reused row fires the handler (state flips) — per-row class re-toggle deferred", () => {
    const app = mount();
    app.set("items", [{ id: "a", name: "Alpha", done: false }]);
    const li = app.mountEl().querySelector("li");
    expect(li.classList.contains("done")).toBe(false); // initial class correct
    expect(app.get("items")[0].done).toBe(false);
    li.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    // The handler wired (Landing 2) — clicking flips the item state.
    expect(app.get("items")[0].done).toBe(true);
  });
});
