/**
 * g-expr-event-handler-dead-in-each.browser.test.js
 *
 * Regression gate for change-id `ss17-each-peritem-emitter-2026-06-25` ITEM 1
 * (g-expr-event-handler-dead-in-each, Family-A Half-2).
 *
 * BUG: a per-item `<each>` event handler written in `${...}` EXPRESSION form was
 * routed through the string rewriter (`rewriteIterValueExpr`) and emitted as a
 * bare STATEMENT body:
 *   - `onclick=${() => mark(@.id)}`        -> `() => _scrml_mark_N(it.id);`
 *     a DEAD arrow-expression statement — the arrow is created and discarded, the
 *     click is a silent no-op.
 *   - `onclick=${() => @clicked = @.id}`   -> `() => _scrml_reactive_get("clicked") = ...`
 *     the assignment LHS lowered to a GETTER -> `E-CODEGEN-INVALID-LOGIC` ("Assigning
 *     to rvalue") — the whole compile FAILED.
 *
 * FIX (emit-each.ts buildEachExprHandlerBody): converge the NON-engine `${...}`
 * handler onto the structured emitter (the same emitExprField the canonical
 * top-level buildHandlerExpr uses) so an arrow / fn-shorthand is INVOKED with the
 * event, a bare cell ref is invoked, and an assignment LHS lowers to
 * `_scrml_reactive_set`. Bug-73 live-keying still wraps the body so the iter var
 * resolves to the LIVE item at fire-time (adversarial reconcile case below).
 *
 * Control: the call-ref form `onclick=mark(@.id)` (a DIFFERENT valKind branch)
 * already invoked correctly and stays unchanged.
 *
 * Runtime gate (S140/S152 lesson): compile-clean is NOT enough — this loads the
 * emitted client.js AS-IS and drives real clicks, asserting cells actually update.
 *
 * Models: each-per-item-handler-live-keying-bug73.browser.test.js.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

const DOLLAR = "$";

// arrow-calls-fn + arrow-with-assignment + call-ref control, all reading the
// NON-key field @.label so a same-key reconcile exercises the live-keying. The
// three handlers live on buttons INSIDE one per-item root <div> (the each factory
// mounts a single root node per item — `_itemFrag.firstChild`).
const MIXED_SRC = `<program>
type Row:struct = { id: string, label: string }
<rows>: Row[] = []
<picked>: string = ""
<assigned>: string = ""
function mark(v: string) { @picked = v }
<ul>
  <each in=@rows>
    <div>
      <button class="call" onclick=${DOLLAR}{() => mark(@.label)}>${DOLLAR}{@.label}</button>
      <button class="assign" onclick=${DOLLAR}{() => @assigned = @.label}>a</button>
      <button class="callref" onclick=mark(@.label)>c</button>
    </div>
  </each>
</ul>
</program>
`;

// bare-cell-in-${} — `onclick=${@h}` where @h holds a callable. The handler must
// INVOKE the cell value with the event (was a dead `_scrml_reactive_get("h");`).
const BARE_CELL_SRC = `<program>
type Row:struct = { id: string, label: string }
<rows>: Row[] = []
<h>: string = ""
<ul>
  <each in=@rows>
    <button class="bare" onclick=${DOLLAR}{@h}>${DOLLAR}{@.label}</button>
  </each>
</ul>
</program>
`;

const tmpRoot = resolve("/tmp", "scrml-each-expr-handler-item1");

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
      errors: result.errors ?? [],
      html: existsSync(htmlPath) ? readFileSync(htmlPath, "utf8") : "",
      clientJs: existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "",
      runtimeJs: existsSync(runtimePath) ? readFileSync(runtimePath, "utf8") : "",
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("g-expr-event-handler-dead-in-each — item1 (Family-A Half-2)", () => {
  beforeEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
    GlobalRegistrator.register();
  });
  afterEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing to do */ }
  });

  function mount(source, baseName) {
    const { errors, html, clientJs, runtimeJs } = compileToOutputs(source, baseName);
    // The assignment-arrow form previously produced E-CODEGEN-INVALID-LOGIC — must be gone.
    expect(errors.filter((e) => String(e.code || "").includes("CODEGEN-INVALID-JS"))).toEqual([]);
    document.documentElement.innerHTML = html;
    const exec = new Function(
      "window",
      "document",
      `${runtimeJs}\n${clientJs}\n` +
        `globalThis.__scrml_get__ = _scrml_reactive_get;\n` +
        `globalThis.__scrml_set__ = (n, v) => _scrml_reactive_set(n, _scrml_deep_reactive(v));\n`,
    );
    exec(window, document);
    document.dispatchEvent(new Event("DOMContentLoaded"));
    const byClass = (c) => [...document.querySelectorAll(`button.${c}`)];
    return {
      set: (name, val) => globalThis.__scrml_set__(name, val),
      get: (name) => globalThis.__scrml_get__(name),
      byClass,
    };
  }

  test("arrow-calls-fn: click invokes the fn with the live item field", () => {
    const app = mount(MIXED_SRC, "arrow-call");
    app.set("rows", [
      { id: "a", label: "alpha" },
      { id: "b", label: "beta" },
    ]);
    const calls = app.byClass("call");
    expect(calls.length).toBe(2);
    calls[1].dispatchEvent(new Event("click"));
    expect(app.get("picked")).toBe("beta");
    calls[0].dispatchEvent(new Event("click"));
    expect(app.get("picked")).toBe("alpha");
  });

  test("arrow-with-assignment: compiles AND fires (was E-CODEGEN-INVALID-LOGIC)", () => {
    const app = mount(MIXED_SRC, "arrow-assign");
    app.set("rows", [
      { id: "a", label: "alpha" },
      { id: "b", label: "beta" },
    ]);
    const assigns = app.byClass("assign");
    assigns[0].dispatchEvent(new Event("click"));
    expect(app.get("assigned")).toBe("alpha");
    assigns[1].dispatchEvent(new Event("click"));
    expect(app.get("assigned")).toBe("beta");
  });

  test("control: the call-ref form still invokes correctly (unchanged)", () => {
    const app = mount(MIXED_SRC, "callref");
    app.set("rows", [{ id: "a", label: "alpha" }]);
    app.byClass("callref")[0].dispatchEvent(new Event("click"));
    expect(app.get("picked")).toBe("alpha");
  });

  test("adversarial: arrow handler uses the LIVE item after a same-key reconcile", () => {
    const app = mount(MIXED_SRC, "reconcile");
    app.set("rows", [
      { id: "a", label: "alpha" },
      { id: "b", label: "beta" },
    ]);
    const before = app.byClass("call");
    // Replace the WHOLE array — SAME ids, NEW labels (forces same-key node reuse).
    app.set("rows", [
      { id: "a", label: "GAMMA" },
      { id: "b", label: "DELTA" },
    ]);
    const after = app.byClass("call");
    // Same-key reconcile reused the nodes (a stale closure would still bite).
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
    after[1].dispatchEvent(new Event("click"));
    expect(app.get("picked")).toBe("DELTA"); // live, NOT the create-time "beta".
    // The assignment arrow on the reused node also follows the live item.
    app.byClass("assign")[0].dispatchEvent(new Event("click"));
    expect(app.get("assigned")).toBe("GAMMA");
  });

  test("bare cell ref ${@h}: invokes the cell value with the event", () => {
    const app = mount(BARE_CELL_SRC, "bare-cell");
    let hit = 0;
    let gotEvent = false;
    // @h holds a callable; _scrml_deep_reactive returns functions as-is.
    app.set("h", (event) => { hit += 1; gotEvent = !!event; });
    app.set("rows", [{ id: "a", label: "alpha" }]);
    app.byClass("bare")[0].dispatchEvent(new Event("click"));
    expect(hit).toBe(1);
    expect(gotEvent).toBe(true);
  });
});
