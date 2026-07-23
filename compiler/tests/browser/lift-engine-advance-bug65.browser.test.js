/**
 * lift-engine-advance-bug65.browser.test.js — Bug 65 (S157) happy-dom RUNTIME.
 *
 * Tier-0 SIBLING of Bug 62. Engine `.advance(.X)` (state AND message plane) and
 * `@engine = .X` direct-write inside a Tier-0 `${ for (…) { lift <el on…> } }`
 * per-item handler were lowered with NO engine codegen ctx →
 * `_scrml_reactive_get("phase").advance("Active")` against the bare variant
 * STRING → TypeError on click. The miscompile is `node --check`-CLEAN, so an
 * emit-string test would MISS it entirely — this is the load-bearing canary:
 * it drives an ACTUAL click on a for-lift-rendered <li> and asserts the engine
 * variant advanced (the full DOM-event → handler → engine-runtime path).
 *
 * §0 — the runtime bundle defines `_scrml_engine_advance` (the lowered target).
 * §1 — STATE plane: clicking a for-lift <li> with onclick=@phase.advance(.Active)
 *      transitions the engine cell "Idle" → "Active".
 * §2 — MESSAGE plane (§51.0.S.6): clicking a for-lift <li> with
 *      onclick=@dragPhase.advance(.Drop(col)) runs the (state × message) arm body
 *      (mutates @tasks) AND transitions, with the `col` iter-var payload.
 * §3 — ASSIGN form: clicking a for-lift <li> with onclick=${@phase = .Active}
 *      direct-writes the engine cell through the write-guard.
 *
 * Mount harness mirrors each-engine-advance-bug62.browser.test.js (Tier-0 form:
 * the for-lift list mounts into the logic-target span, so the <li> is found by
 * tag rather than by the each-mount marker).
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

const tmpRoot = resolve("/tmp", "scrml-lift-engine-bug65");

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
      errors: (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error"),
      html: existsSync(htmlPath) ? readFileSync(htmlPath, "utf8") : "",
      clientJs: existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "",
      runtimeJs: existsSync(runtimePath) ? readFileSync(runtimePath, "utf8") : "",
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

function mount(source, baseName) {
  const { html, clientJs, runtimeJs, errors } = compileToOutputs(source, baseName);
  expect(errors).toEqual([]);
  document.documentElement.innerHTML = html;
  const exec = new Function(
    "window",
    "document",
    `${runtimeJs}\n` + captureInsideChunkScope(clientJs, `globalThis.__scrml_set__ = _scrml_reactive_set;\n` +
      `globalThis.__scrml_get__ = _scrml_reactive_get;\n` +
      `globalThis.__scrml_runtime_has_advance__ = (typeof _scrml_engine_advance === "function");\n`),
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
    set: (name, val) => globalThis.__scrml_set__(name, val),
    get: (name) => globalThis.__scrml_get__(name),
    runtimeHasAdvance: () => globalThis.__scrml_runtime_has_advance__,
    // The for-lift list mounts into the logic-target span; the <li> lands in the DOM.
    li: (sel = "li") => document.querySelector(sel),
  };
}

function phaseName(v) {
  return typeof v === "object" && v !== null ? v.variant : v;
}

// ---------------------------------------------------------------------------
// §1 — STATE plane: click for-lift <li> → engine advances Idle → Active
// ---------------------------------------------------------------------------
const STATE_SRC = `<program>
\${
    type Phase:enum = { Idle, Active }
    <cols>: string[] = ["a", "b", "c"]
}

<engine for=Phase initial=.Idle>
    <Idle rule=.Active>"idle"</>
    <Active rule=.Idle>"active"</>
</>

<ul>\${ for (col of @cols) { lift <li onclick=@phase.advance(.Active)>\${col}</li> } }</ul>
</program>`;

describe("bug65 §1 — STATE-plane .advance in ${for…lift} handler (happy-dom click)", () => {
  beforeEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
    GlobalRegistrator.register();
  });
  afterEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing */ }
  });

  test("the runtime bundle defines _scrml_engine_advance (the lowered target)", () => {
    const app = mount(STATE_SRC, "bug65-state");
    expect(app.threw).toBeNull();
    expect(app.runtimeHasAdvance()).toBe(true);
  });

  test("mounts into .Idle without throwing", () => {
    const app = mount(STATE_SRC, "bug65-state");
    expect(app.threw).toBeNull();
    expect(phaseName(app.get("phase"))).toBe("Idle");
  });

  test("clicking a for-lift-rendered <li> advances the engine Idle → Active", () => {
    const app = mount(STATE_SRC, "bug65-state");
    const li = app.li();
    expect(li).not.toBeNull();
    expect(phaseName(app.get("phase"))).toBe("Idle");
    li.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    expect(phaseName(app.get("phase"))).toBe("Active");
  });
});

// ---------------------------------------------------------------------------
// §2 — MESSAGE plane (§51.0.S.6): click for-lift <li> → arm body runs + transition
// ---------------------------------------------------------------------------
const MSG_SRC = `<program title="drag for-lift s6">
\${
  type DragPhase:enum = { Idle, Dragging(id: number) }
  type DragMsg:enum   = { Start(id: number), Drop(col: string), End }
}

<tasks> = ["a", "b"]
<lastDrop> = ""
<columns>: string[] = ["done"]
const taskMovedTo = (tasks, id, col) => { @lastDrop = String(id) + "->" + col; return tasks.concat([col]) }

<engine for=DragPhase initial=.Idle accepts=DragMsg>
  <Idle rule=.Dragging>
    | .Start(id) :> .Dragging(id)
    | _          :> @dragPhase
  </>
  <Dragging(id) rule=.Idle>
    | .Drop(col) :> { @tasks = taskMovedTo(@tasks, id, col); .Idle }
    | .End       :> .Idle
    | _          :> @dragPhase
  </>
</>

<ul class="cols">\${ for (col of @columns) { lift <li class="col" onclick=@dragPhase.advance(.Drop(col))>\${col}</li> } }</ul>
</program>`;

describe("bug65 §2 — MESSAGE-plane .advance(.Drop(col)) in ${for…lift} (happy-dom click)", () => {
  beforeEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
    GlobalRegistrator.register();
  });
  afterEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing */ }
  });

  test("mounts into .Idle without throwing", () => {
    const app = mount(MSG_SRC, "bug65-msg");
    expect(app.threw).toBeNull();
    expect(phaseName(app.get("dragPhase"))).toBe("Idle");
  });

  test("from .Dragging, clicking the for-lift <li> runs the (Dragging × Drop) arm body and transitions to .Idle", () => {
    const app = mount(MSG_SRC, "bug65-msg");
    // Move into .Dragging(7) so the (Dragging × Drop) arm is active.
    app.set("dragPhase", { variant: "Dragging", data: { id: 7 } });
    expect(phaseName(app.get("dragPhase"))).toBe("Dragging");
    expect(app.get("tasks")).toEqual(["a", "b"]);

    const li = app.li("li.col");
    expect(li).not.toBeNull();
    li.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

    // Arm body effect ran with BOTH planes in scope: id (state, 7) + col (msg, "done").
    expect(app.get("tasks")).toEqual(["a", "b", "done"]);
    expect(app.get("lastDrop")).toBe("7->done");
    // Arm resolved .Idle → transitioned.
    expect(phaseName(app.get("dragPhase"))).toBe("Idle");
  });
});

// ---------------------------------------------------------------------------
// §3 — ASSIGN form `${@engine = .X}`: click for-lift <li> → direct-write
// ---------------------------------------------------------------------------
const ASSIGN_SRC = `<program>
\${
    type Phase:enum = { Idle, Active }
    <cols>: string[] = ["a", "b"]
}

<engine for=Phase initial=.Idle>
    <Idle rule=.Active>"idle"</>
    <Active rule=.Idle>"active"</>
</>

<ul>\${ for (col of @cols) { lift <li onclick=\${@phase = .Active}>\${col}</li> } }</ul>
</program>`;

describe("bug65 §3 — direct-write ${@engine = .X} in ${for…lift} (happy-dom click)", () => {
  beforeEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
    GlobalRegistrator.register();
  });
  afterEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing */ }
  });

  test("clicking a for-lift-rendered <li> direct-writes the engine cell Idle → Active", () => {
    const app = mount(ASSIGN_SRC, "bug65-assign");
    expect(app.threw).toBeNull();
    expect(phaseName(app.get("phase"))).toBe("Idle");
    const li = app.li();
    expect(li).not.toBeNull();
    li.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    expect(phaseName(app.get("phase"))).toBe("Active");
  });
});
