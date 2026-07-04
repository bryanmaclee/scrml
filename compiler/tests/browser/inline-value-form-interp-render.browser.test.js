/**
 * inline-value-form-interp-render.browser.test.js — RENDER + REACTIVITY gate for
 * inline value-form control-flow as the SOLE content of a markup `${...}`
 * interpolation (SPEC §18.0 JS-style value-`match` / §17.6 if-as-expression).
 * change-id: inline-value-form-interp-render-2026-06-30.
 *
 * Bug (CLASS-WIDE — both forms, render-level):
 *   - `${ match @x { .A :> "a"  .B :> "b" } }` rendered EMPTY: the match got NO
 *     `data-scrml-logic` slot and emit-reactive-wiring emitted the match as a
 *     value-DISCARDING file-scope IIFE.
 *   - `${ if @n > 3 { "big" } else { "small" } }` ALSO rendered EMPTY: it got a
 *     slot but the bare-expr-only binding loop never wired it, so the branch
 *     values were discarded and the slot stayed empty.
 *
 * Fix (codegen, class-wide): emit-html.ts detects a value-form match/if as the
 * sole interp content, allocates the slot + a `value-control-flow` logic-binding;
 * emit-event-wiring.ts lowers it to the value-returning form (emit-control-flow.ts
 * emitMatchExpr IIFE / emitIfValueExpr ternary) and emits `_scrml_render_value` +
 * a reactive `_scrml_effect`. The derived-cell twin (`const <d> = match …; ${@d}`)
 * is unchanged.
 *
 * `node --check` is NOT sufficient — the bug is render-level + the reactivity is
 * the load-bearing new behavior. Model: markup-value-render.browser.test.js.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import {
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
  mkdirSync,
} from "fs";
import { compileScrml } from "../../src/api.js";

const tmpRoot = resolve("/tmp", "scrml-ivf-render");

function compileToOutputs(source, baseName = "ivf") {
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
    const runtimePath = resolve(
      outDir,
      result.runtimeFilename ?? "scrml-runtime.js",
    );
    return {
      errors: result.errors ?? [],
      html: existsSync(htmlPath) ? readFileSync(htmlPath, "utf8") : "",
      clientJs: existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "",
      runtimeJs: existsSync(runtimePath)
        ? readFileSync(runtimePath, "utf8")
        : "",
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("inline value-form control-flow interp — RENDER + REACTIVITY (happy-dom)", () => {
  beforeEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
    GlobalRegistrator.register();
  });

  afterEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing to do */ }
  });

  function mount(source) {
    const { html, clientJs, runtimeJs, errors } = compileToOutputs(source);
    expect(errors.filter(e => e.code === "E-CODEGEN-INVALID-LOGIC")).toEqual([]);
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
      slot: () => document.querySelector("[data-scrml-logic]"),
    };
  }

  test("(match) `${ match @x { .List :> \"list view\" .Grid :> \"grid view\" } }` renders the selected arm + reactively flips", () => {
    const src = `type View:enum = .List | .Grid
<x>: View = .List
<p>\${ match @x { .List :> "list view"  .Grid :> "grid view" } }</p>`;
    const app = mount(src);
    const el = app.slot();
    expect(el).not.toBeNull();
    // @x = .List → the .List arm value.
    expect(el.textContent).toBe("list view");
    expect(el.textContent).not.toContain("[object");
    // Reactive flip of the scrutinee → re-render the slot.
    app.set("x", "Grid");
    expect(el.textContent).toBe("grid view");
    app.set("x", "List");
    expect(el.textContent).toBe("list view");
  });

  test("(if) `${ if @n > 3 { \"big\" } else { \"small\" } }` renders the selected branch + reactively flips", () => {
    const src = `<n>: int = 5
<p>\${ if @n > 3 { "big" } else { "small" } }</p>`;
    const app = mount(src);
    const el = app.slot();
    expect(el).not.toBeNull();
    // @n = 5 → "big".
    expect(el.textContent).toBe("big");
    // Reactive flip of the condition → "small".
    app.set("n", 1);
    expect(el.textContent).toBe("small");
    app.set("n", 9);
    expect(el.textContent).toBe("big");
  });

  test("(else-if chain) `${ if @n > 8 { \"hi\" } else if @n > 3 { \"mid\" } else { \"lo\" } }` cascades + reactively re-renders", () => {
    const src = `<n>: int = 5
<p>\${ if @n > 8 { "hi" } else if @n > 3 { "mid" } else { "lo" } }</p>`;
    const app = mount(src);
    const el = app.slot();
    expect(el).not.toBeNull();
    expect(el.textContent).toBe("mid"); // 5 → mid
    app.set("n", 10);
    expect(el.textContent).toBe("hi");
    app.set("n", 1);
    expect(el.textContent).toBe("lo");
  });

  test("(match arm reads a cell) re-renders on EITHER the scrutinee OR the read cell", () => {
    const src = `type Mode:enum = .Show | .Hide
<mode>: Mode = .Show
<count>: int = 7
<p>\${ match @mode { .Show :> @count  .Hide :> "hidden" } }</p>`;
    const app = mount(src);
    const el = app.slot();
    expect(el.textContent).toBe("7");
    // Mutate the arm-result cell — the active (.Show) arm reads @count → re-render.
    app.set("count", 42);
    expect(el.textContent).toBe("42");
    // Flip the scrutinee → the .Hide arm (does not read @count).
    app.set("mode", "Hide");
    expect(el.textContent).toBe("hidden");
  });

  test("(derived-cell twin — NON-REGRESSION) `const <label> = match …; ${@label}` still renders + reacts", () => {
    const src = `type View:enum = .List | .Grid
<x>: View = .List
const <label> = match @x { .List :> "list view"  .Grid :> "grid view" }
<p>\${@label}</p>`;
    const app = mount(src);
    const el = app.slot();
    expect(el).not.toBeNull();
    expect(el.textContent).toBe("list view");
    app.set("x", "Grid");
    expect(el.textContent).toBe("grid view");
  });

  test("(numeric-valued arms) a value-match returning numbers renders + reacts", () => {
    const src = `type Size:enum = .Small | .Large
<size>: Size = .Small
<p>\${ match @size { .Small :> 1  .Large :> 100 } }</p>`;
    const app = mount(src);
    const el = app.slot();
    expect(el.textContent).toBe("1");
    app.set("size", "Large");
    expect(el.textContent).toBe("100");
  });

  test("(ADVERSARIAL — plain `${@cell}` unchanged) primitive interp keeps the text path", () => {
    const src = `<count>: int = 5
<p>\${@count}</p>`;
    const app = mount(src);
    const el = app.slot();
    expect(el).not.toBeNull();
    expect(el.querySelector("span")).toBeNull();
    expect(el.textContent).toBe("5");
    app.set("count", 99);
    expect(el.textContent).toBe("99");
  });
});
