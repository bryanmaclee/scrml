/**
 * markup-value-render.browser.test.js — RENDER-level gate for markup-as-value
 * `${...}` interpolation (markup-as-first-class-value, Pillar 1, SPEC §1.4/§7.4,
 * PRIMER §6.4/§6.6.17). change-id: markup-value-in-expression-2026-06-17.
 *
 * Bug (render layer): markup-as-value COMPILED (the prior codegen dispatch built a
 * real DOM node via createElement + appendChild) but the OUTER display wiring
 * assigned the node to `el.textContent`, so the DOM showed the literal string
 * "[object HTMLSpanElement]" instead of the markup. Verified across all 4 forms
 * (the control (d) too) — markup-as-value had NEVER rendered.
 *
 * Fix: a node-aware display helper `_scrml_render_value(el, v)` in the core runtime
 * chunk — `if (v instanceof Node) el.replaceChildren(v); else el.textContent =
 * (v == null ? "" : String(v))`. The `${...}` interpolation-display emit sites
 * (reactive + one-shot, compiler/src/codegen/emit-event-wiring.ts) now call it.
 *
 * The companion unit test (compiler/tests/unit/g-markup-value-in-expression.test.js)
 * asserts the CODEGEN shape. This suite asserts the RENDER: mount each form in
 * happy-dom and assert the DOM shows the rendered markup (a real <span> with its
 * text), NOT "[object HTMLSpanElement]". `node --check` is not sufficient — the bug
 * is render-level.
 *
 * Model: compiler/tests/browser/each-runtime-bug-57.test.js (real compile +
 * result.runtimeFilename + happy-dom mount via new Function + DOMContentLoaded).
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

const tmpRoot = resolve("/tmp", "scrml-mv-render");

/**
 * Compile `source` via the real compile path (write:true) and return the
 * emitted html, client.js, and content-hashed runtime bundle.
 */
function compileToOutputs(source, baseName = "mv") {
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

describe("markup-value-in-expression — RENDER (happy-dom)", () => {
  beforeEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
    GlobalRegistrator.register();
  });

  afterEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing to do */ }
  });

  /**
   * Mount the compiled module in happy-dom and expose the cell side-channel so a
   * test can drive reactive cells. Mirrors each-runtime-bug-57.test.js.
   */
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
      // The interpolation placeholder is a `<span data-scrml-logic=...>` nested
      // inside the authored `<div>`. The rendered markup ends up as a child of it.
      placeholder: () => document.querySelector("[data-scrml-logic]"),
    };
  }

  // The render-level bug signature. If ANY form regresses to textContent-of-node,
  // the placeholder's textContent CONTAINS "[object" (e.g. "[object HTMLSpanElement]").
  function assertNoObjectString(el) {
    expect(el).not.toBeNull();
    expect(el.textContent).not.toContain("[object");
  }

  test("(a) inline ternary — `${ @n > 0 ? <span>pos</span> : <span>neg</span> }` renders the chosen <span>", () => {
    const src = `<n> = 0
<div>\${ @n > 0 ? <span>pos</span> : <span>neg</span> }</div>`;
    const app = mount(src);
    const el = app.placeholder();
    assertNoObjectString(el);
    // @n = 0 → the `neg` arm renders a real <span>neg</span> node.
    expect(el.querySelector("span")).not.toBeNull();
    expect(el.textContent).toBe("neg");
    // Reactive flip → the `pos` arm renders.
    app.set("n", 1);
    expect(el.querySelector("span")).not.toBeNull();
    expect(el.textContent).toBe("pos");
    expect(el.textContent).not.toContain("[object");
  });

  test("(b) derived-cell ternary — `const <badge> = @n > 0 ? <span>pos</span> : <span>neg</span>` then `${@badge}` renders the node", () => {
    const src = `<n> = 0
const <badge> = @n > 0 ? <span>pos</span> : <span>neg</span>
<div>\${@badge}</div>`;
    const app = mount(src);
    const el = app.placeholder();
    assertNoObjectString(el);
    expect(el.querySelector("span")).not.toBeNull();
    expect(el.textContent).toBe("neg");
    app.set("n", 1);
    expect(el.querySelector("span")).not.toBeNull();
    expect(el.textContent).toBe("pos");
    expect(el.textContent).not.toContain("[object");
  });

  test("(c) fn-return markup — `fn label(n) -> markup { return <span>${n}</span> }` then `${ label(@n) }` renders the node", () => {
    const src = `\${ fn label(n: int) -> markup { return <span>\${n}</span> } }
<n> = 7
<div>\${ label(@n) }</div>`;
    const app = mount(src);
    const el = app.placeholder();
    assertNoObjectString(el);
    // The returned <span> carries the interpolated n.
    expect(el.querySelector("span")).not.toBeNull();
    expect(el.textContent).toBe("7");
    app.set("n", 42);
    expect(el.querySelector("span")).not.toBeNull();
    expect(el.textContent).toBe("42");
    expect(el.textContent).not.toContain("[object");
  });

  test("(d) plain markup-typed derived (control) — `const <x> = <span>${@n}</span>` then `${@x}` renders the node", () => {
    const src = `<n> = 3
const <x> = <span>\${@n}</span>
<div>\${@x}</div>`;
    const app = mount(src);
    const el = app.placeholder();
    assertNoObjectString(el);
    expect(el.querySelector("span")).not.toBeNull();
    expect(el.textContent).toBe("3");
    expect(el.textContent).not.toContain("[object");
  });

  test("STRING interpolation regression — `${@count}` still renders its text (string path unchanged)", () => {
    const src = `<count> = 5
<div>\${@count}</div>`;
    const app = mount(src);
    const el = app.placeholder();
    expect(el).not.toBeNull();
    // A primitive value keeps the textContent path — no node child, plain text.
    expect(el.querySelector("span")).toBeNull();
    expect(el.textContent).toBe("5");
    expect(el.textContent).not.toContain("[object");
    // Reactive update still drives the text.
    app.set("count", 99);
    expect(el.textContent).toBe("99");
  });

  test("STRING interpolation regression — literal string value renders verbatim", () => {
    const src = `<label> = "hello world"
<div>\${@label}</div>`;
    const app = mount(src);
    const el = app.placeholder();
    expect(el).not.toBeNull();
    expect(el.querySelector("span")).toBeNull();
    expect(el.textContent).toBe("hello world");
  });
});
