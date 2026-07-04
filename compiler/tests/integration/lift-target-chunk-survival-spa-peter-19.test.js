/* SPDX-License-Identifier: MIT
 *
 * GitHub #19 (Peter) — SPA `_scrml_lift_target` tree-shaken → ReferenceError on
 * first dynamic <each> insert.  change-id: peter-19-spa-lift-target-tree-shake
 *
 * Root cause (reporter-confirmed): `runtime-chunks.ts` uses the marker
 * `function _scrml_lift` as the START of the `lift` chunk. Pre-fix, the shared
 * ambient `let _scrml_lift_target = null;` sat on the line BEFORE that marker,
 * so it belonged to the PREVIOUS chunk. In an SPA / embed build the previous
 * chunk is tree-shaken while `lift` is kept → the declaration vanishes. The
 * first dynamic list insert calls the per-item factory
 * (`_scrml_lift(() => ...)`), which reads `_scrml_lift_target` and throws
 * `_scrml_lift_target is not defined`. Initial render + removal never call
 * `_scrml_lift`, so only insertion breaks.
 *
 * Fix: relocate the decl to INSIDE the `lift` chunk (after the function, still
 * module scope — generated client code assigns it via bare
 * `_scrml_lift_target = ...`). This end-to-end guard compiles a lift-using SPA
 * under `embedRuntime` (the tree-shaken inline-runtime shape) and asserts the
 * kept `lift` chunk carries BOTH the function AND its ambient decl, that the
 * emitted client is valid JS, and that a live dynamic insert does not throw.
 *
 * The unit-level chunk-boundary assertion lives in
 * compiler/tests/unit/runtime-tree-shaking.test.js.
 */

import { describe, test, expect, beforeAll, beforeEach, afterEach } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import vm from "vm";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// A `${ for … lift }` reconciled list is the canonical dynamic-list-insert
// mechanism: it emits `_scrml_reconcile_list` + per-item `_scrml_lift(() => ...)`
// factories, exactly the runtime path GitHub #19 breaks on insert.
const SRC = `<program>
\${ @items = [1, 2, 3, 4, 5] }
\${
  for (let item of @items) {
    if (item % 2 == 0) {
      lift <li>\${item}</li>
    }
  }
}
</program>
`;

function compileEmbedSpa() {
  const tmp = mkdtempSync(join(tmpdir(), "peter19-"));
  const srcFile = join(tmp, "app.scrml");
  const outDir = join(tmp, "dist");
  writeFileSync(srcFile, SRC);
  const result = compileScrml({
    inputFiles: [srcFile],
    outputDir: outDir,
    write: false,
    embedRuntime: true, // SPA / embed build → tree-shaken inline runtime
    log: () => {},
  });
  const errors = (result.errors ?? []).filter(
    (e) => e.severity == null || e.severity === "error",
  );
  const entry = [...result.outputs.values()][0] ?? {};
  rmSync(tmp, { recursive: true, force: true });
  return { errors, clientJs: entry.clientJs ?? "", html: entry.html ?? "" };
}

describe("GitHub #19 — SPA lift-target chunk survival (END-TO-END)", () => {
  let out;
  beforeAll(() => { out = compileEmbedSpa(); });

  test("compiles with NO codegen errors", () => {
    expect(out.errors).toEqual([]);
  });

  test("the lift path IS exercised — embed client includes function _scrml_lift + a call site", () => {
    // Guards the repro: if this ever stops emitting _scrml_lift the decl-survival
    // test below would pass vacuously. The `${for…lift}` reconcile path lifts the
    // list wrapper into the ambient target via `_scrml_lift(_scrml_list_wrapper_N)`.
    expect(out.clientJs).toContain("function _scrml_lift");
    expect(out.clientJs).toContain("_scrml_lift(_scrml_list_wrapper");
  });

  test("the _scrml_lift_target ambient decl SURVIVES the SPA tree-shake (GitHub #19)", () => {
    // Pre-fix this was absent from the embed client (it lived in the tree-shaken
    // previous chunk), so the first insert threw `_scrml_lift_target is not
    // defined`. The fix moves it into the kept `lift` chunk.
    expect(out.clientJs).toContain("let _scrml_lift_target = null;");
  });

  test("emitted embed client is syntactically valid JS", () => {
    expect(() => new vm.Script(out.clientJs)).not.toThrow();
  });
});

describe("GitHub #19 — dynamic insert does not throw ReferenceError (happy-dom)", () => {
  beforeEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
    GlobalRegistrator.register();
  });
  afterEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing to do */ }
  });

  test("mount + first dynamic insert lifts new items without ReferenceError", () => {
    const { clientJs, html } = compileEmbedSpa();
    document.documentElement.innerHTML = html;
    let threw = null;
    try {
      // embedRuntime inlines the runtime into clientJs — one script body.
      const exec = new Function(
        "window",
        "document",
        `${clientJs}\nglobalThis.__scrml_set__ = _scrml_reactive_set;`,
      );
      exec(window, document);
      document.dispatchEvent(new Event("DOMContentLoaded"));
      // First dynamic INSERT: appending even items drives the reconciler to
      // call the per-item `_scrml_lift(() => ...)` factory (reads the ambient).
      globalThis.__scrml_set__("items", [1, 2, 3, 4, 5, 6, 7, 8]);
    } catch (e) {
      threw = e;
    }
    expect(threw).toBeNull();
    // Even items 2,4,6,8 lifted → four <li> rendered.
    expect(document.querySelectorAll("li").length).toBe(4);
  });
});
