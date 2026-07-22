/**
 * each-runtime-bug-57.test.js — Bug 57 (HIGH silent-miscompile) regression.
 *
 * Bug: a Tier-1 `<each>`-only file (no Tier-0 `${for…lift}`) compiled to a
 * client bundle that CALLS `_scrml_reconcile_list(...)` + `_scrml_effect_static`
 * but a runtime bundle that NEVER DEFINED `_scrml_reconcile_list` →
 * `ReferenceError: _scrml_reconcile_list is not defined` on the first
 * `_scrml_each_render_N()`. Compile exited 0 and `node --check` passed because
 * the call site is syntactically valid; the gap was purely tree-shaking.
 *
 * Root cause: `compiler/src/codegen/emit-client.ts` `detectRuntimeChunks`
 * chunk-selection walk had NO `case "each-block"`. The only
 * `chunks.add("reconciliation")` was gated inside `case "for-stmt"`, so a
 * `<each>`-only file never pulled the `reconciliation` chunk (which defines
 * `_scrml_reconcile_list` + `_scrml_lis`).
 *
 * Fix: add `case "each-block"` adding `chunks.add("reconciliation")` +
 * `chunks.add("deep_reactive")` (the latter for `_scrml_effect_static`).
 *
 * This suite is the acceptance gate the bug slipped through: the pre-existing
 * `<each>` test tier was emit-string-only and never checked the runtime
 * bundle. Two parts:
 *   §1 — Targeted emit-regression: compile a Tier-1-`<each>`-only file via the
 *        real compile path and assert the EMITTED RUNTIME BUNDLE DEFINES
 *        `function _scrml_reconcile_list` AND the client CALLS it. FAILS on the
 *        pre-fix baseline (bundle missing the definition); PASSES after.
 *   §2 — happy-dom runtime drive: mount the emitted module, populate
 *        `@contacts`, assert rows render + reconcile on data change and the
 *        `<empty>` body renders when the list is empty — with NO ReferenceError.
 *
 * Models: `compiler/tests/unit/14-mario-runtime-sim.test.js` (real compile +
 * read `result.runtimeFilename` + happy-dom mount via `new Function`) and
 * `compiler/tests/browser/browser-match-block.test.js` (Tier-1 markup-form
 * runtime drive).
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

// Minimal Tier-1-`<each>`-only repro (BRIEF.md). No Tier-0 `${for…lift}`, so
// the ONLY `reconciliation` trigger is the each-block. `<empty>` exercises the
// empty-state path; `key=@.id` + `<li : @.name>` exercise the reconcile path.
const EACH_ONLY_SRC = `<program>
type Contact:struct = { id: string, name: string }
<contacts>: Contact[] = []
<ul>
    <each in=@contacts key=@.id>
        <li : @.name>
        <empty>none</>
    </each>
</ul>
</program>
`;

const tmpRoot = resolve("/tmp", "scrml-bug57");

/**
 * Compile `source` via the real compile path (write:true) and return the
 * emitted html, client.js, and the content-hashed runtime bundle (read via
 * `result.runtimeFilename`, the same channel 14-mario-runtime-sim uses).
 */
function compileToOutputs(source, baseName = "each-only") {
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

// ---------------------------------------------------------------------------
// §1 — Targeted emit-regression (FAILS pre-fix, PASSES post-fix)
// ---------------------------------------------------------------------------

describe("Bug 57 §1 — `<each>`-only runtime bundle defines _scrml_reconcile_list", () => {
  test("compile succeeds with no errors", () => {
    const { errors } = compileToOutputs(EACH_ONLY_SRC);
    expect(errors).toEqual([]);
  });

  test("client.js CALLS _scrml_reconcile_list (the each render emits the call)", () => {
    const { clientJs } = compileToOutputs(EACH_ONLY_SRC);
    expect(clientJs).toContain("_scrml_reconcile_list(");
    expect(clientJs).toContain("_scrml_effect_static(");
  });

  test("runtime bundle DEFINES function _scrml_reconcile_list (the bug — tree-shaken pre-fix)", () => {
    const { runtimeJs } = compileToOutputs(EACH_ONLY_SRC);
    // Pre-fix this assertion FAILS: the `reconciliation` chunk was never
    // pulled for a `<each>`-only file, so the runtime bundle never defined
    // the helper the client calls → ReferenceError at runtime.
    expect(runtimeJs).toContain("function _scrml_reconcile_list");
  });

  test("runtime bundle DEFINES function _scrml_effect_static (the dispatcher helper)", () => {
    const { runtimeJs } = compileToOutputs(EACH_ONLY_SRC);
    expect(runtimeJs).toContain("function _scrml_effect_static");
  });

  test("no dangling call: every helper the client calls is defined in client+runtime", () => {
    const { clientJs, runtimeJs } = compileToOutputs(EACH_ONLY_SRC);
    const combined = `${runtimeJs}\n${clientJs}`;
    // The two helpers Bug 57 left dangling. A defined-set check guards against
    // regressing to "called but never defined".
    for (const helper of ["_scrml_reconcile_list", "_scrml_effect_static"]) {
      expect(combined).toContain(`function ${helper}`);
    }
  });
});

// ---------------------------------------------------------------------------
// §2 — happy-dom runtime drive (asserts NO ReferenceError + reconcile behavior)
// ---------------------------------------------------------------------------

describe("Bug 57 §2 — `<each>` renders + reconciles in happy-dom", () => {
  beforeEach(async () => {
    // Re-register per test to avoid cross-file "already registered" errors.
    try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
    GlobalRegistrator.register();
  });

  afterEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing to do */ }
  });

  /**
   * Mount the compiled module in happy-dom. Evaluates runtime + client in a
   * `new Function` scope (mirrors 14-mario-runtime-sim) and exposes the cell
   * accessors via a side-channel so the test can drive `@contacts`.
   */
  function mount() {
    const { html, clientJs, runtimeJs } = compileToOutputs(EACH_ONLY_SRC);
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
      // Approach A-unified: the each mounts as a comment fence `<!--scrml-each:N-->`;
      // rows render as SIBLINGS in the each's real parent (<ul>). Locate that parent
      // via the fence comment (comments are invisible to querySelector).
      mountEl: () => {
        const _w = document.createTreeWalker(document.body, NodeFilter.SHOW_COMMENT);
        let _n;
        while ((_n = _w.nextNode())) {
          if (String(_n.data || "").trim().indexOf("scrml-each:") === 0) return _n.parentNode;
        }
        return null;
      },
    };
  }

  test("mounting does NOT throw ReferenceError (the Bug 57 symptom)", () => {
    // Pre-fix, the first `_scrml_each_render_N()` threw
    // `ReferenceError: _scrml_reconcile_list is not defined`. The whole mount
    // (which runs the dispatcher) must complete cleanly.
    expect(() => mount()).not.toThrow();
  });

  test("empty list renders the `<empty>` body (\"none\")", () => {
    const app = mount();
    // `@contacts` initializes to `[]` → the empty-state path renders "none".
    const mountEl = app.mountEl();
    expect(mountEl).not.toBeNull();
    expect(mountEl.textContent).toContain("none");
    // No `<li>` rows in the empty state.
    expect(mountEl.querySelectorAll("li").length).toBe(0);
  });

  test("populating @contacts renders one <li> per item with the name", () => {
    const app = mount();
    app.set("contacts", [
      { id: "a", name: "Ada" },
      { id: "b", name: "Babbage" },
    ]);
    const rows = app.mountEl().querySelectorAll("li");
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toBe("Ada");
    expect(rows[1].textContent).toBe("Babbage");
  });

  test("reconcile on data change — adding an item adds a row, removing removes it", () => {
    const app = mount();
    app.set("contacts", [{ id: "a", name: "Ada" }]);
    expect(app.mountEl().querySelectorAll("li").length).toBe(1);

    // Add a second item.
    app.set("contacts", [
      { id: "a", name: "Ada" },
      { id: "b", name: "Babbage" },
    ]);
    expect(app.mountEl().querySelectorAll("li").length).toBe(2);

    // Remove back to one.
    app.set("contacts", [{ id: "b", name: "Babbage" }]);
    const rows = app.mountEl().querySelectorAll("li");
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toBe("Babbage");
  });

  test("emptying a populated list swaps back to the `<empty>` body", () => {
    const app = mount();
    app.set("contacts", [{ id: "a", name: "Ada" }]);
    expect(app.mountEl().querySelectorAll("li").length).toBe(1);
    app.set("contacts", []);
    const mountEl = app.mountEl();
    expect(mountEl.querySelectorAll("li").length).toBe(0);
    expect(mountEl.textContent).toContain("none");
  });
});
