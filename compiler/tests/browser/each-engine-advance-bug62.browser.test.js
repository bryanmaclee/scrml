/**
 * each-engine-advance-bug62.browser.test.js — Bug 62 (S156) happy-dom RUNTIME.
 *
 * Engine `.advance(.X)` (state AND message plane) and `@engine = .X` direct-
 * write inside a Tier-1 `<each>` per-item event handler were emitted RAW →
 * E-CODEGEN-INVALID-LOGIC (the each-render event-wiring path did not thread the
 * engine ctx). `node --check`-clean ≠ correct (S139/S140/S152): this test drives
 * an ACTUAL click on an each-rendered item and asserts the engine advanced — the
 * full DOM-event → handler → engine-runtime path.
 *
 * §1 — STATE plane: clicking an each-rendered <li> with onclick=@phase.advance(.Active)
 *      transitions the engine cell from "Idle" to "Active".
 * §2 — MESSAGE plane (§51.0.S.6): clicking an each-rendered <li> with
 *      onclick=@dragPhase.advance(.Drop(col)) runs the (state × message) arm
 *      body (mutates @tasks) AND transitions, with the `as`-name (col) payload.
 * §3 — ASSIGN form: clicking an each-rendered <li> with onclick=${@phase = .Active}
 *      direct-writes the engine cell through the write-guard.
 *
 * Mount harness mirrors each-body-interactivity-landing2.browser.test.js.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

const tmpRoot = resolve("/tmp", "scrml-each-engine-bug62");

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
    `${runtimeJs}\n${clientJs}\n` +
      `globalThis.__scrml_set__ = _scrml_reactive_set;\n` +
      `globalThis.__scrml_get__ = _scrml_reactive_get;\n`,
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
    mountEl: () => (function(){var w=document.createTreeWalker(document.body,NodeFilter.SHOW_COMMENT),n;while((n=w.nextNode())){if(String(n.data||'').trim().indexOf('scrml-each:')===0)return n.parentNode;}return null;})(),
  };
}

function phaseName(v) {
  return typeof v === "object" && v !== null ? v.variant : v;
}

// ---------------------------------------------------------------------------
// §1 — STATE plane: click each <li> → engine advances Idle → Active
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

<ul>
    <each in=@cols as col>
        <li onclick=@phase.advance(.Active)>\${col}</li>
    </each>
</ul>
</program>`;

describe("bug62 §1 — STATE-plane .advance in <each> handler (happy-dom click)", () => {
  beforeEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
    GlobalRegistrator.register();
  });
  afterEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing */ }
  });

  test("mounts into .Idle without throwing", () => {
    const app = mount(STATE_SRC, "bug62-state");
    expect(app.threw).toBeNull();
    expect(phaseName(app.get("phase"))).toBe("Idle");
  });

  test("clicking an each-rendered <li> advances the engine Idle → Active", () => {
    const app = mount(STATE_SRC, "bug62-state");
    const li = app.mountEl().querySelector("li");
    expect(li).not.toBeNull();
    expect(phaseName(app.get("phase"))).toBe("Idle");
    li.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    expect(phaseName(app.get("phase"))).toBe("Active");
  });
});

// ---------------------------------------------------------------------------
// §2 — MESSAGE plane (§51.0.S.6): click each <li> → arm body runs + transition
// ---------------------------------------------------------------------------
const MSG_SRC = `<program title="drag each s6">
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

<ul class="cols">
    <each in=@columns as col>
        <li class="col" onclick=@dragPhase.advance(.Drop(col))>\${col}</li>
    </each>
</ul>
</program>`;

describe("bug62 §2 — MESSAGE-plane .advance(.Drop(col)) in <each> (happy-dom click)", () => {
  beforeEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
    GlobalRegistrator.register();
  });
  afterEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing */ }
  });

  test("mounts into .Idle without throwing", () => {
    const app = mount(MSG_SRC, "bug62-msg");
    expect(app.threw).toBeNull();
    expect(phaseName(app.get("dragPhase"))).toBe("Idle");
  });

  test("from .Dragging, clicking the each <li> runs the (Dragging × Drop) arm body and transitions to .Idle", () => {
    const app = mount(MSG_SRC, "bug62-msg");
    // Move into .Dragging(7) so the (Dragging × Drop) arm is active.
    app.set("dragPhase", { variant: "Dragging", data: { id: 7 } });
    expect(phaseName(app.get("dragPhase"))).toBe("Dragging");
    expect(app.get("tasks")).toEqual(["a", "b"]);

    const li = app.mountEl().querySelector("li.col");
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
// §3 — ASSIGN form `${@engine = .X}`: click each <li> → direct-write
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

<ul>
    <each in=@cols as col>
        <li onclick=\${@phase = .Active}>\${col}</li>
    </each>
</ul>
</program>`;

describe("bug62 §3 — direct-write ${@engine = .X} in <each> (happy-dom click)", () => {
  beforeEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
    GlobalRegistrator.register();
  });
  afterEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing */ }
  });

  test("clicking an each-rendered <li> direct-writes the engine cell Idle → Active", () => {
    const app = mount(ASSIGN_SRC, "bug62-assign");
    expect(app.threw).toBeNull();
    expect(phaseName(app.get("phase"))).toBe("Idle");
    const li = app.mountEl().querySelector("li");
    expect(li).not.toBeNull();
    li.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    expect(phaseName(app.get("phase"))).toBe("Active");
  });
});
