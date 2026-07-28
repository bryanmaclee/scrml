/**
 * g-lift-per-item-if-directive-not-reactive-on-reconcile (MED, S293) — runtime gate.
 *
 * A per-item `if=<expr over the item>` (conditional display) in a Tier-0 reconciled
 * `${for…lift}` emitted a create-time display-toggle updater called ONCE, closing over
 * the create-time item, with no re-resolve. So on a same-key REPLACE (node reuse) the
 * reused node kept its create-time display while the item's predicate value changed —
 * stale visibility. Fix: when the predicate reads the item, drive the toggle from a
 * live-keyed effect (re-resolves the item + replays item-derived locals) so it
 * re-evaluates on reconcile (the effect also auto-tracks any @cell reads).
 *
 * This gate covers the TIER-0 for-lift path. (The Tier-1 <each> per-row `if=` shares
 * the staleness but uses a structural append-gate — a separate design decision.)
 *
 * Executed-DOM; visibility measured via inline style.display (the toggle target), not
 * textContent.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

const clone = (x) => JSON.parse(JSON.stringify(x));
const tmpRoot = resolve("/tmp", "scrml-gap-lift-if-directive");
function compileOut(source, baseName) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const tmpDir = resolve(tmpRoot, `case-${uniq}`);
  const tmpInput = resolve(tmpDir, `${baseName}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir });
  const html = readFileSync(resolve(outDir, `${baseName}.html`), "utf8");
  const clientJs = readFileSync(resolve(outDir, `${baseName}.client.js`), "utf8");
  const runtimeJs = readFileSync(resolve(outDir, result.runtimeFilename ?? "scrml-runtime.js"), "utf8");
  rmSync(tmpDir, { recursive: true, force: true });
  return { errors: result.errors ?? [], html, clientJs, runtimeJs };
}

describe("gap: lift per-item if= directive reactive on REPLACE", () => {
  beforeEach(async () => { try { await GlobalRegistrator.unregister(); } catch (_) {} GlobalRegistrator.register(); });
  afterEach(async () => { try { await GlobalRegistrator.unregister(); } catch (_) {} });

  function mount(source, baseName) {
    const { errors, html, clientJs, runtimeJs } = compileOut(source, baseName);
    expect(errors.filter((e) => String(e.code || "").includes("CODEGEN-INVALID-JS"))).toEqual([]);
    document.documentElement.innerHTML = html;
    const exec = new Function("window", "document",
      `${runtimeJs}\n` + captureInsideChunkScope(clientJs,
        `globalThis.__scrml_set__ = _scrml_reactive_set;\nglobalThis.__scrml_get__ = _scrml_reactive_get;\n`));
    exec(window, document);
    document.dispatchEvent(new Event("DOMContentLoaded"));
    return {
      set: (n, v) => globalThis.__scrml_set__(n, v),
      // visible = rows whose inline display is not "none"
      visible: () => [...document.querySelectorAll("#root .row")].filter((n) => n.style.display !== "none").map((n) => n.textContent.trim()),
    };
  }

  const A = [{ id: "a", name: "Alice", active: 1 }, { id: "b", name: "Bob", active: 1 }];

  const SRC = `<program>
type Row:struct = { id: string, name: string, active: (not to timestamp) }
<rows>: Row[] = []
<div id="root">
  \${ for (let e of @rows) {
    lift <div class="row" if=e.active is some>\${e.name}</div>;
  } }
</div>
</program>
`;
  test("for-lift if= over item field re-evaluates on same-key REPLACE", () => {
    const app = mount(SRC, "iffield");
    app.set("rows", clone(A));
    expect(app.visible()).toEqual(["Alice", "Bob"]);
    // same keys (index) reused; flip Bob inactive → Bob's row must hide
    app.set("rows", [{ id: "a", name: "Alice", active: 1 }, { id: "b", name: "Bob", active: null }]);
    expect(app.visible()).toEqual(["Alice"]); // was STALE ["Alice","Bob"] pre-fix
    // flip Bob back on
    app.set("rows", [{ id: "a", name: "Alice", active: 1 }, { id: "b", name: "Bob", active: 1 }]);
    expect(app.visible()).toEqual(["Alice", "Bob"]);
  });

  const SRC_LOCAL = `<program>
type Row:struct = { id: string, name: string, active: (not to timestamp) }
<rows>: Row[] = []
<div id="root">
  \${ for (let e of @rows) {
    let a = e.active;
    lift <div class="row" if=a is some>\${e.name}</div>;
  } }
</div>
</program>
`;
  test("for-lift if= over an item-derived local re-evaluates on REPLACE", () => {
    const app = mount(SRC_LOCAL, "iflocal");
    app.set("rows", clone(A));
    expect(app.visible()).toEqual(["Alice", "Bob"]);
    app.set("rows", [{ id: "a", name: "Alice", active: null }, { id: "b", name: "Bob", active: 1 }]);
    expect(app.visible()).toEqual(["Bob"]); // was STALE pre-fix
  });

  // control: a CELL-only predicate must still work (legacy subscription path)
  const SRC_CELL = `<program>
type Row:struct = { id: string, name: string }
<showAll>: (not to timestamp) = 1
<rows>: Row[] = []
<div id="root">
  \${ for (let e of @rows) {
    lift <div class="row" if=@showAll is some>\${e.name}</div>;
  } }
</div>
</program>
`;
  test("control: cell-only if=@showAll toggles all rows on cell change", () => {
    const app = mount(SRC_CELL, "ifcell");
    app.set("rows", [{ id: "a", name: "Alice" }, { id: "b", name: "Bob" }]);
    expect(app.visible()).toEqual(["Alice", "Bob"]);
    app.set("showAll", null);
    expect(app.visible()).toEqual([]);
    app.set("showAll", 1);
    expect(app.visible()).toEqual(["Alice", "Bob"]);
  });
});
