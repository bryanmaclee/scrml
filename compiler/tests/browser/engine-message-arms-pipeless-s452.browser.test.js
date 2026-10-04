/* SPDX-License-Identifier: MIT
 *
 * S452 — engine message arms WITHOUT a leading `|`, happy-dom RUNTIME
 * (`g-impl1-engine-message-arm-pipeless-as-text-s452`).
 *
 * Before the fix, the pipe-less arms were read as render text: the arm source
 * was displayed literally and `@dragPhase.advance(.Drop(col))` lowered to a
 * plain state advance. This drives the COMPILED `onclick=@dragPhase.advance(…)`
 * call sites (real click events, not a direct helper call) and asserts the arm
 * fires — its effect runs with the state binding (`id`) and the message binding
 * (`col`) in scope — and the transition happens. The piped spelling runs the
 * same script as a control.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

const tmpRoot = resolve(tmpdir(), "scrml-msg-pipeless-s452-browser");

function compileOutputs(source) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const tmpDir = resolve(tmpRoot, `case-${uniq}`);
  const tmpInput = resolve(tmpDir, "drag.scrml");
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir, log: () => {} });
    const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");
    return {
      errors: (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error"),
      html: read(resolve(outDir, "drag.html")),
      clientJs: read(resolve(outDir, "drag.client.js")),
      runtimeJs: read(resolve(outDir, result.runtimeFilename ?? "scrml-runtime.js")),
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

function mount(source) {
  const { html, clientJs, runtimeJs, errors } = compileOutputs(source);
  expect(errors).toEqual([]);
  document.documentElement.innerHTML = html;
  const exec = new Function(
    "window",
    "document",
    `${runtimeJs}\n` + captureInsideChunkScope(clientJs,
      "globalThis.__s452_get__ = _scrml_reactive_get;\n"),
  );
  exec(window, document);
  document.dispatchEvent(new Event("DOMContentLoaded"));
  return {
    clientJs,
    get: (n) => globalThis.__s452_get__(n),
    click: (id) => document.getElementById(id).dispatchEvent(new window.MouseEvent("click", { bubbles: true })),
  };
}

const PIPED = `<program title="drag">
\${
  type DragPhase:enum = { Idle, Dragging(id: number) }
  type DragMsg:enum   = { Start(id: number), Drop(col: string), End }
}
<tasks> = ["a"]
<lastMove> = ""
const taskMovedTo = (tasks, id, col) => { @lastMove = String(id) + "->" + col; return tasks.concat([col]) }
<engine for=DragPhase initial=.Idle accepts=DragMsg>
  <Idle rule=.Dragging>
    | .Start(id) :> .Dragging(id)
    | _          :> @dragPhase
    <p class="state">idle</p>
  </>
  <Dragging(id) rule=.Idle>
    | .Drop(col) :> { @tasks = taskMovedTo(@tasks, id, col); .Idle }
    | .End       :> .Idle
    | _          :> @dragPhase
    <p class="state">dragging</p>
  </>
</>
<button id="start" onclick=@dragPhase.advance(.Start(7))>start</button>
<button id="drop" onclick=@dragPhase.advance(.Drop("done"))>drop</button>
</program>
`;
const PIPELESS = PIPED.replace(/^([ \t]*)\| /gm, "$1");

const variantOf = (v) => (v && typeof v === "object" ? v.variant : v);

describe("S452 pipe-less message arms — runtime (compiled .advance call sites, happy-dom)", () => {
  beforeEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
    GlobalRegistrator.register();
  });
  afterEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing */ }
  });

  for (const [label, src] of [["pipe-less", PIPELESS], ["piped (control)", PIPED]]) {
    test(`${label}: .advance(.Start(7)) then .advance(.Drop("done")) fire the arms and transition`, () => {
      expect(PIPELESS).not.toContain("| .");
      const m = mount(src);
      expect(m.clientJs).toContain("_dragPhase_msg_arms");
      // The arm source is never rendered as text.
      expect(document.body.textContent).not.toContain(":>");
      expect(variantOf(m.get("dragPhase"))).toBe("Idle");

      m.click("start");
      const dragging = m.get("dragPhase");
      expect(variantOf(dragging)).toBe("Dragging");
      expect(dragging.data.id).toBe(7);

      m.click("drop");
      // The (Dragging × Drop) arm body ran with id (state) and col (message).
      expect(m.get("lastMove")).toBe("7->done");
      expect(m.get("tasks")).toEqual(["a", "done"]);
      // …and its `.Idle` target transitioned the engine.
      expect(variantOf(m.get("dragPhase"))).toBe("Idle");
      expect(document.body.textContent).not.toContain(":>");
    });
  }
});
