/**
 * select-row-value-indexed-regression.test.js
 *
 * S103 Phase 3 select-row chip-away — integration regression. Verifies that
 * the value-indexed predicate-bind dispatch produces CORRECT DOM after a
 * select-row sequence (the OLD row's edit span is removed, the NEW row's edit
 * span is mounted — §17.1 render gate since S469, a display toggle before). Mirrors TodoMVC's `if=@editingId == todo.id`
 * shape.
 *
 * The risk this guards against: a subtle ordering bug in
 * _scrml_notify_value_indexed (e.g. firing the NEW bucket BEFORE the OLD
 * bucket, or skipping the OLD bucket when keys collide) would cause stale
 * "editing" display state. End-to-end DOM verification is the only way to
 * catch this — unit tests verify counters; this test verifies DOM.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

const tmpRoot = resolve(tmpdir(), "scrml-select-row-regression");

beforeEach(async () => {
  try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
  GlobalRegistrator.register();
});

afterEach(async () => {
  try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing to do */ }
});

// Minimal fixture: a list with an if= bind that matches the STRICTEST
// predicate-shape (`@editingId == item.id`), plus a counterpart that uses
// `!=` (which the detector REJECTS, falling back to LEGACY). Both should
// produce correct DOM after select-row.
const FIXTURE = `<program title="select-row regression">
<items> = [{id: 1}, {id: 2}, {id: 3}]
<editingId> = not

<ul>\${
  for (item of @items) {
    lift <li data-id=\${item.id}>
      <span class="view" if=(@editingId != item.id)>view-\${item.id}</span>
      <span class="edit" if=(@editingId == item.id)>edit-\${item.id}</span>
    </li>
  }
}</ul>
</program>`;

function compileFixture() {
  const tmpDir = resolve(tmpRoot, `case-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const tmpInput = resolve(tmpDir, "fixture.scrml");
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, FIXTURE);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir });
    if (result.errors && result.errors.length > 0) {
      throw new Error("compile errors: " + JSON.stringify(result.errors));
    }
    const html = readFileSync(resolve(outDir, "fixture.html"), "utf-8");
    const clientJs = readFileSync(resolve(outDir, "fixture.client.js"), "utf-8");
    const runtimeJs = readFileSync(resolve(outDir, result.runtimeFilename ?? "scrml-runtime.js"), "utf-8");
    return { html, clientJs, runtimeJs };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("select-row value-indexed regression", () => {
  test("compiled output uses _scrml_reactive_subscribe_when for == predicate", () => {
    const { clientJs } = compileFixture();
    // The == predicate bind uses the value-indexed registration
    // (Step 2b wiring + S103 detector).
    expect(clientJs).toMatch(/_scrml_cs_reactive_subscribe_when\("editingId",\s*item\.id/);
    // S103 follow-on: the != predicate ALSO uses value-indexed registration.
    // Runtime dispatch is identical for == and != (subscribers fire on
    // transitions to/from valueKey regardless of predicate polarity); the
    // bind function recomputes truthiness internally. Both halves of the
    // TodoMVC select-row hot path now narrow to O(2) per write.
    expect(clientJs.match(/_scrml_cs_reactive_subscribe_when\("editingId",\s*item\.id/g)?.length).toBe(2);
    // LEGACY _scrml_reactive_subscribe SHOULD NOT appear for editingId in
    // this fixture anymore — both bind shapes migrate.
    expect(clientJs).not.toMatch(/_scrml_reactive_subscribe\("editingId"/);
  });

  test("select-row sequence produces correct DOM (== narrowed bind)", () => {
    const { html, clientJs, runtimeJs } = compileFixture();
    document.documentElement.innerHTML = html;
    // The runtime-chunks detector did not flag `==`/`!=` inside lift if=
    // for this minimal fixture (pre-existing edge case; orthogonal to S103
    // Phase 3 work), so the equality chunk is tree-shaken from the runtime.
    // The emitted client.js still calls _scrml_structural_eq — stub it here
    // so the regression test can run end-to-end. Primitives use === fast-path
    // per emitBinary (emit-expr.ts:555).
    const stubEq = `function _scrml_structural_eq(a, b) { if (a === b) return true; if (a == null || b == null) return false; return JSON.stringify(a) === JSON.stringify(b); }\n`;
    // BUG-6: splice the setter capture INSIDE the chunk scope so it binds the
    // chunk's SCOPED `_scrml_cs_reactive_set` (keys under the chunk token),
    // matching the DOM bindings' namespaced cell keys. `_scrml_state` stays a
    // shared global, reachable after the chunk body.
    const cjWithSet = captureInsideChunkScope(clientJs, `globalThis.__scrml_set__ = _scrml_reactive_set;`);
    const exec = new Function(
      "window",
      "document",
      `${runtimeJs}\n${stubEq}${cjWithSet}\n` +
      `globalThis.__scrml_state__ = _scrml_state;\n`
    );
    exec(window, document);
    document.dispatchEvent(new Event("DOMContentLoaded"));

    // Helpers — find the "edit-N" and "view-N" spans by data-id.
    function spans() {
      const out = {};
      for (const li of document.querySelectorAll("li[data-id]")) {
        const id = li.getAttribute("data-id");
        const view = li.querySelector("span.view");
        const edit = li.querySelector("span.edit");
        out[id] = {
          view: view ? "on" : "off",
          edit: edit ? "on" : "off",
        };
      }
      return out;
    }

    // Initial state: editingId = null. NO row is in edit mode.
    // §17.1 (S469): `if=` is a render gate — "on" = the span is in the row, "off" = it
    // is NOT in the DOM (a placeholder comment holds its place). It was a display
    // toggle before S469 (the hidden span stayed in the row).
    let s = spans();
    expect(s["1"].view).toBe("on");      // view visible (1 != null)
    expect(s["1"].edit).toBe("off");  // edit hidden (1 == null is false)
    expect(s["2"].view).toBe("on");
    expect(s["2"].edit).toBe("off");

    // Select row 2 for editing.
    globalThis.__scrml_set__("editingId", 2);
    s = spans();
    expect(s["1"].view).toBe("on");      // row 1 unaffected
    expect(s["1"].edit).toBe("off");
    expect(s["2"].view).toBe("off");  // row 2 enters edit mode: view hides
    expect(s["2"].edit).toBe("on");      // row 2 enters edit mode: edit shows
    expect(s["3"].view).toBe("on");      // row 3 unaffected
    expect(s["3"].edit).toBe("off");

    // Switch edit to row 3.
    globalThis.__scrml_set__("editingId", 3);
    s = spans();
    expect(s["1"].view).toBe("on");      // row 1 unaffected
    expect(s["1"].edit).toBe("off");
    expect(s["2"].view).toBe("on");      // row 2 LEAVES edit mode: view back on
    expect(s["2"].edit).toBe("off");  // row 2 edit hidden again
    expect(s["3"].view).toBe("off");  // row 3 enters edit mode
    expect(s["3"].edit).toBe("on");

    // Clear edit (editingId = null).
    globalThis.__scrml_set__("editingId", null);
    s = spans();
    expect(s["1"].view).toBe("on");      // all rows back to view mode
    expect(s["1"].edit).toBe("off");
    expect(s["2"].view).toBe("on");
    expect(s["2"].edit).toBe("off");
    expect(s["3"].view).toBe("on");
    expect(s["3"].edit).toBe("off");
  });

  test("no-op write (editingId = X then = X) is idempotent", () => {
    const { html, clientJs, runtimeJs } = compileFixture();
    document.documentElement.innerHTML = html;
    // Same equality-chunk-stub as the previous test (see that test for rationale).
    const stubEq = `function _scrml_structural_eq(a, b) { if (a === b) return true; if (a == null || b == null) return false; return JSON.stringify(a) === JSON.stringify(b); }\n`;
    // BUG-6: capture the scoped setter inside the chunk scope (see prior test).
    const cjWithSet = captureInsideChunkScope(clientJs, `globalThis.__scrml_set__ = _scrml_reactive_set;`);
    const exec = new Function(
      "window",
      "document",
      `${runtimeJs}\n${stubEq}${cjWithSet}\n`
    );
    exec(window, document);
    document.dispatchEvent(new Event("DOMContentLoaded"));

    globalThis.__scrml_set__("editingId", 2);
    globalThis.__scrml_set__("editingId", 2); // no-op
    const row2 = document.querySelector('li[data-id="2"]');
    expect(row2.querySelector("span.edit")).not.toBeNull();
    expect(row2.querySelector("span.view")).toBeNull();
  });
});
