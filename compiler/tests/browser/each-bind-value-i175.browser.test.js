/**
 * each-bind-value-i175.browser.test.js
 *
 * Executed-DOM acceptance gate for per-item `bind:value` value-side wiring
 * inside `<each>` (GH adopter issue #175, SPEC §5.4). Before i175 a per-item
 * `<input bind:value=@cell>` emitted only a `// deferred` comment — no value
 * binding, no write-back — so the input was inert. This suite drives the
 * compiled output in happy-dom:
 *
 *   §1 — emit-regression: the OUTER-cell bind is wired (value + write-back +
 *        live-keyed effect); the deferred comment is gone.
 *   §2 — two-way canary: a programmatic `@msg` write updates input.value, AND
 *        an input event updates `@msg` (and fans out to sibling inputs).
 *   §3 — disposal on list-shrink: a per-item read-back effect goes inert once
 *        its item is removed (no write to a detached node — no leak).
 *
 * Models: compiler/tests/browser/each-body-interactivity-landing2.browser.test.js
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

const REPRO_SRC = `<program>
type Item:struct = { id: string, name: string }
<items>: Item[] = []
<msg>: string = ""
<ul>
    <each in=@items key=@.id>
        <li>
            <input bind:value=@msg />
        </li>
        <empty>No items yet.</empty>
    </each>
</ul>
</program>
`;

const tmpRoot = resolve("/tmp", "scrml-each-bind-i175");

function compileToOutputs(source, baseName = "each-bind-i175") {
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
// §1 — emit-regression
// ---------------------------------------------------------------------------

describe("each bind:value i175 (browser) §1 — emitted wiring", () => {
  test("compiles with no errors and wires the outer-cell value side", () => {
    const { errors, clientJs } = compileToOutputs(REPRO_SRC);
    expect(errors).toEqual([]);
    expect(clientJs).toContain('.value = _scrml_reactive_get("msg");');
    expect(clientJs).toMatch(/\.addEventListener\("input", \(event\) => _scrml_reactive_set\("msg", event\.target\.value\)\)/);
    expect(clientJs).not.toContain('"bind:value" deferred (Landing 2 scope');
  });
});

// ---------------------------------------------------------------------------
// §2 / §3 — happy-dom drive
// ---------------------------------------------------------------------------

describe("each bind:value i175 (browser) §2/§3 — executed DOM", () => {
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
      mountEl: () => (function () { var w = document.createTreeWalker(document.body, NodeFilter.SHOW_COMMENT), n; while ((n = w.nextNode())) { if (String(n.data || "").trim().indexOf("scrml-each:") === 0) return n.parentNode; } return null; })(),
    };
  }

  test("mounting does NOT throw", () => {
    expect(() => mount()).not.toThrow();
  });

  test("two-way: programmatic @msg write updates input.value", () => {
    const app = mount();
    app.set("items", [{ id: "a", name: "Alpha" }]);
    const input = app.mountEl().querySelector("input");
    expect(input).not.toBeNull();
    // Programmatic write to the outer cell → the input's read-back effect fires.
    app.set("msg", "hello");
    expect(input.value).toBe("hello");
  });

  test("two-way: an input event updates @msg", () => {
    const app = mount();
    app.set("items", [{ id: "a", name: "Alpha" }]);
    const input = app.mountEl().querySelector("input");
    input.value = "typed-by-user";
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    expect(app.get("msg")).toBe("typed-by-user");
  });

  test("two-way fans out: editing one input mirrors to sibling per-item inputs", () => {
    const app = mount();
    app.set("items", [{ id: "a", name: "Alpha" }, { id: "b", name: "Beta" }]);
    const inputs = app.mountEl().querySelectorAll("input");
    expect(inputs.length).toBe(2);
    inputs[0].value = "shared";
    inputs[0].dispatchEvent(new window.Event("input", { bubbles: true }));
    expect(app.get("msg")).toBe("shared");
    // The other item's read-back effect (subscribed to @msg) updates it too.
    expect(inputs[1].value).toBe("shared");
  });

  // Disposal on the RECONCILE path (list shrink 2 -> 1, which runs
  // _scrml_reconcile_list). The removed row's read-back effect is live-keyed via
  // _scrml_resolve_item, so the post-reconcile `_scrml_trigger(container,
  // "_scrml_items")` re-runs it, it resolves `=== null` for the gone key, early-
  // returns, and DROPS its @msg dep — going inert with the item (no write to the
  // detached node). The surviving row stays fully reactive.
  //
  // NOTE (pre-existing, out of i175 scope): a shrink to EMPTY when the `<each>`
  // has an `<empty>` fallback takes the empty-guard branch (`replaceChildren()`),
  // which bypasses `_scrml_reconcile_list` entirely — so the per-item trigger
  // never fires and per-item effects are not re-run to inert. This is a shared
  // each-runtime reconcile-reactivity boundary affecting ALL per-item effects
  // (text / class: / attr), documented as DEFERRED by
  // each-body-interactivity-landing2.browser.test.js — not a bind:value-specific
  // regression. The reconcile-path disposal below is the semantics i175 owns.
  test("disposal on shrink: a removed item's read-back effect goes inert (no leak)", () => {
    const app = mount();
    app.set("items", [{ id: "a", name: "Alpha" }, { id: "b", name: "Beta" }]);
    app.set("msg", "before");
    const inputs = app.mountEl().querySelectorAll("input");
    expect(inputs.length).toBe(2);
    const doomed = inputs[1];   // id=b — removed on the shrink below
    const survivor = inputs[0]; // id=a — stays
    expect(doomed.value).toBe("before");
    // Shrink to a NON-empty list → _scrml_reconcile_list runs, removing row b.
    app.set("items", [{ id: "a", name: "Alpha" }]);
    expect(app.mountEl().querySelectorAll("input").length).toBe(1);
    expect(doomed.isConnected).toBe(false);
    // Update the outer cell. The removed node's effect went inert on the shrink
    // reconcile → it must NOT resurrect its value.
    expect(() => app.set("msg", "AFTER")).not.toThrow();
    expect(doomed.value).toBe("before"); // stale-but-inert, not "AFTER"
    // The surviving row is still fully reactive.
    expect(survivor.value).toBe("AFTER");
  });

  test("re-grow after shrink: new rows bind fresh to the current @msg", () => {
    const app = mount();
    app.set("items", [{ id: "a", name: "Alpha" }]);
    app.set("msg", "x1");
    app.set("items", []);
    app.set("msg", "x2");
    app.set("items", [{ id: "c", name: "Gamma" }]);
    const input = app.mountEl().querySelector("input");
    expect(input).not.toBeNull();
    expect(input.value).toBe("x2");
  });
});
