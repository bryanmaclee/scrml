/* SPDX-License-Identifier: MIT
 *
 * engine-opener-effect-c1.browser.test.js — §51.0.H Form 3 (S148, Insight 33
 * Fork C1) happy-dom ACCEPTANCE.
 *
 * `node --check`-clean ≠ correct (S139). This drives the compiled flagship in
 * happy-dom and asserts the OBSERVABLE boot semantics:
 *   - the module boots with NO ReferenceError / throw,
 *   - the boot `effect=` runs exactly ONCE at module-init,
 *   - `@tasks` is loaded by the boot effect,
 *   - the engine transitions OUT of `.Loading` into `.Editing` (tasks present)
 *     / `.Empty` (no tasks) — the implicit init→initial edge's effect fired and
 *     performed its cross-variant write.
 *
 * Mirrors the in-test compile + happy-dom mount harness in each-runtime-bug-57.
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
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

const tmpRoot = resolve("/tmp", "scrml-c1-browser");

/**
 * Flagship factory. `taskCount` controls how many tasks loadTasks() returns so
 * we can assert BOTH cross-variant boot targets (.Editing when >0, .Empty when 0).
 * A module-scope `__bootCount` counter cell proves boot-ONCE.
 */
function flagshipSrc(taskCount) {
  const tasks = Array.from({ length: taskCount }, (_, i) =>
    `{ id: ${i + 1}, text: "t${i + 1}", completed_at: not }`,
  ).join(", ");
  return `<program title="C1 acceptance">
\${
  type Phase:enum = { Loading, Empty, Editing, Saving, Saved, ErrorState(msg: string) }
}
let __bootCount = 0
const loadTasks = () => { __bootCount = __bootCount + 1; return [${tasks}] }
<engine for=Phase initial=.Loading effect=\${
    @tasks = loadTasks()
    @phase = @tasks.length == 0 ? .Empty : .Editing
}>
  <Loading rule=(.Empty | .Editing | .ErrorState)>Loading…</>
  <Empty rule=.Saving>None.</>
  <Editing rule=.Saving>\${@tasks.length} tasks</>
  <Saving rule=(.Saved | .ErrorState)>Saving…</>
  <Saved rule=.Editing>Saved.</>
  <ErrorState msg rule=.Loading>\${msg}</>
</>
</program>`;
}

function compileOutputs(source, baseName = "c1-accept") {
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
      errors: (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error"),
      html: existsSync(htmlPath) ? readFileSync(htmlPath, "utf8") : "",
      clientJs: existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "",
      runtimeJs: existsSync(runtimePath) ? readFileSync(runtimePath, "utf8") : "",
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("C1 acceptance — opener effect= boots ONCE + transitions out of .Loading", () => {
  beforeEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
    GlobalRegistrator.register();
  });
  afterEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing to do */ }
  });

  /** Mount the compiled module in happy-dom; expose the cell accessors. */
  function mount(taskCount) {
    const { html, clientJs, runtimeJs, errors } = compileOutputs(flagshipSrc(taskCount));
    expect(errors).toEqual([]);
    document.documentElement.innerHTML = html;
    const exec = new Function(
      "window",
      "document",
      `${runtimeJs}\n` + captureInsideChunkScope(clientJs, `globalThis.__scrml_set__ = _scrml_reactive_set;\n` +
        `globalThis.__scrml_get__ = _scrml_reactive_get;\n` +
        `globalThis.__c1_bootCount__ = (typeof __bootCount !== "undefined") ? __bootCount : null;\n`),
    );
    let threw = null;
    try {
      exec(window, document);
      document.dispatchEvent(new Event("DOMContentLoaded"));
    } catch (e) {
      threw = e;
    }
    return {
      threw,
      get: (name) => globalThis.__scrml_get__(name),
      bootCount: () => globalThis.__c1_bootCount__,
      mountEl: () => document.querySelector('[data-scrml-engine-mount="phase"]'),
    };
  }

  test("boots without a thrown error / ReferenceError", () => {
    const m = mount(2);
    expect(m.threw).toBeNull();
  });

  test("the boot effect runs exactly ONCE at module-init (loadTasks called once)", () => {
    const m = mount(2);
    expect(m.bootCount()).toBe(1);
  });

  test("@tasks is loaded by the boot effect (length matches loadTasks output)", () => {
    const m = mount(3);
    const tasks = m.get("tasks");
    expect(Array.isArray(tasks)).toBe(true);
    expect(tasks.length).toBe(3);
  });

  test("engine transitions OUT of .Loading into .Editing when tasks are present", () => {
    const m = mount(2);
    // The boot effect's cross-variant write moved @phase off the .Loading
    // initial= variant. tasks.length > 0 → .Editing.
    expect(m.get("phase")).toBe("Editing");
    expect(m.get("phase")).not.toBe("Loading");
  });

  test("engine transitions OUT of .Loading into .Empty when no tasks", () => {
    const m = mount(0);
    expect(m.get("phase")).toBe("Empty");
    expect(m.get("phase")).not.toBe("Loading");
  });

  test("the mounted engine renders the post-boot variant (not the .Loading body)", () => {
    const m = mount(2);
    const el = m.mountEl();
    expect(el).not.toBeNull();
    // .Editing body is `${@tasks.length} tasks`; .Loading body is `Loading…`.
    // After boot the rendered body reflects the transitioned-to variant.
    const html = el.innerHTML;
    expect(html).not.toContain("Loading…");
    expect(html).toContain("tasks");
  });
});
