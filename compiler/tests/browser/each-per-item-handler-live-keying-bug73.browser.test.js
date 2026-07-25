/**
 * each-per-item-handler-live-keying-bug73.browser.test.js — Bug 73 (S159).
 *
 * Sibling-gap #2 of Bug 64. Bug 64 (S158) made per-item DISPLAY bindings
 * live-keyed on reconcile; Bug 73 closes the matching gap for per-item EVENT
 * HANDLERS. Pre-fix, a per-item handler closed over the CREATE-TIME iter var, so
 * on a same-key reconcile (array-replace with a new same-key object / in-place
 * field mutation) the displayed text updated to live data (Bug 64) while the
 * handler fired with the STALE create-time snapshot.
 *
 * Runtime gate (load-bearing canary): compile-clean is NOT enough. This test
 * loads the emitted client.js AS-IS in real module-init order, drives the
 * reactive collection through a SAME-KEY NEW-VALUE replace + an in-place field
 * mutation, then dispatchEvent's a click on the REUSED node and asserts the
 * handler received the LIVE field value (NOT the create-time one). Covers BOTH
 * tiers (Tier-1 <each> + Tier-0 ${for...lift}).
 *
 * NEGATIVE case: a GLOBAL handler (onclick=reorder()/bump() — reads no item) on
 * a node whose key was removed STILL fires (proves no false-wrap / no spurious
 * null-skip from the iter-scope token scan).
 *
 * NB the Bug 64 handler browser test (each-per-item-reactivity-bug64) does a
 * NO-OP replace that does NOT exercise the divergence (the sink gets the same
 * value under both stale and live). This test does a same-key-NEW-value replace
 * so the stale closure FAILS and the live re-resolution PASSES.
 *
 * Models: each-per-item-reactivity-bug64.browser.test.js.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

const DOLLAR = "$";

// Tier-1 — <each> with a per-item handler that reads a NON-key field (label).
// The handler routes the LIVE label to a global sink so we observe both that it
// fired AND which row's CURRENT value it carried.
const TIER1_HANDLER_SRC = `<program>
type Line:struct = { id: string, label: string }
<lines>: Line[] = []
<ul>
  <each in=@lines>
    <li onclick=${DOLLAR}{ window.__sink(@.label) }>${DOLLAR}{@.label}</li>
  </each>
</ul>
</program>
`;

// Tier-0 — ${for...lift} with a per-item handler reading a NON-key field.
const TIER0_HANDLER_SRC = `<program>
type Line:struct = { id: string, label: string }
<lines>: Line[] = []
<ul>
  ${DOLLAR}{ for (line of @lines) {
    lift <li onclick=${DOLLAR}{ window.__sink(line.label) }>${DOLLAR}{line.label}</li>
  } }
</ul>
</program>
`;

// Tier-1 NEGATIVE — a GLOBAL handler that reads NO item. After a removal the
// node for the gone key is unmounted, but a node for a surviving key (whose
// handler reads no item) must STILL fire its global bump().
const TIER1_GLOBAL_SRC = `<program>
type Line:struct = { id: string, label: string }
<lines>: Line[] = []
<hits> = 0
function bump() {
  @hits = @hits + 1
}
<ul>
  <each in=@lines>
    <li onclick=bump()>${DOLLAR}{@.label}</li>
  </each>
</ul>
</program>
`;

// Tier-0 NEGATIVE — global handler in a lifted row.
const TIER0_GLOBAL_SRC = `<program>
type Line:struct = { id: string, label: string }
<lines>: Line[] = []
<hits> = 0
function bump() {
  @hits = @hits + 1
}
<ul>
  ${DOLLAR}{ for (line of @lines) {
    lift <li onclick=bump()>${DOLLAR}{line.label}</li>
  } }
</ul>
</program>
`;

const tmpRoot = resolve("/tmp", "scrml-each-per-item-handler-bug73");

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

describe("bug73 browser — per-item handler live-keying on reconcile", () => {
  beforeEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
    GlobalRegistrator.register();
  });
  afterEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing to do */ }
  });

  function mount(source, baseName) {
    const { errors, html, clientJs, runtimeJs } = compileToOutputs(source, baseName);
    expect(errors.filter((e) => String(e.code || "").includes("CODEGEN-INVALID-JS"))).toEqual([]);
    document.documentElement.innerHTML = html;
    const exec = new Function(
      "window",
      "document",
      `${runtimeJs}\n` + captureInsideChunkScope(clientJs, `globalThis.__scrml_get__ = _scrml_reactive_get;\n` +
        `globalThis.__scrml_set__ = (n, v) => _scrml_reactive_set(n, _scrml_deep_reactive(v));\n`),
    );
    exec(window, document);
    document.dispatchEvent(new Event("DOMContentLoaded"));
    const lis = () => [...document.querySelectorAll("li")];
    return {
      set: (name, val) => globalThis.__scrml_set__(name, val),
      get: (name) => globalThis.__scrml_get__(name),
      lis,
      text: () => lis().map((n) => n.textContent.trim()),
    };
  }

  // -- POSITIVE: handler fires with LIVE field value after same-key reconcile --

  describe("Tier-1 <each> — handler reads live item field", () => {
    test("array-replace (same ids, NEW values): handler carries LIVE label, not stale", () => {
      const sink = [];
      window.__sink = (v) => sink.push(v);
      const app = mount(TIER1_HANDLER_SRC, "t1-replace-handler");
      app.set("lines", [
        { id: "a", label: "alpha" },
        { id: "b", label: "beta" },
      ]);
      expect(app.text()).toEqual(["alpha", "beta"]);
      const before = app.lis();

      // Replace the WHOLE array — SAME ids (a, b), NEW labels.
      app.set("lines", [
        { id: "a", label: "GAMMA" },
        { id: "b", label: "DELTA" },
      ]);
      // Bug 64: display follows live data.
      expect(app.text()).toEqual(["GAMMA", "DELTA"]);
      const after = app.lis();
      // Same-key reconcile reused the nodes (so a stale closure would still bite).
      expect(after[0]).toBe(before[0]);
      expect(after[1]).toBe(before[1]);

      // Bug 73: the handler on the REUSED node fires with the LIVE label.
      after[1].dispatchEvent(new Event("click"));
      expect(sink).toEqual(["DELTA"]); // NOT "beta" (the create-time snapshot).
      after[0].dispatchEvent(new Event("click"));
      expect(sink).toEqual(["DELTA", "GAMMA"]);
    });

    test("in-place field mutation: handler carries the mutated label", () => {
      const sink = [];
      window.__sink = (v) => sink.push(v);
      const app = mount(TIER1_HANDLER_SRC, "t1-field-handler");
      app.set("lines", [
        { id: "a", label: "alpha" },
        { id: "b", label: "beta" },
      ]);
      const live = app.get("lines");
      live[1].label = "BETA2";
      expect(app.text()).toEqual(["alpha", "BETA2"]);
      app.lis()[1].dispatchEvent(new Event("click"));
      expect(sink).toEqual(["BETA2"]); // live field-mutation, not "beta".
    });
  });

  describe("Tier-0 ${for...lift} — handler reads live item field", () => {
    test("array-replace (same ids, NEW values): handler carries LIVE label, not stale", () => {
      const sink = [];
      window.__sink = (v) => sink.push(v);
      const app = mount(TIER0_HANDLER_SRC, "t0-replace-handler");
      app.set("lines", [
        { id: "a", label: "alpha" },
        { id: "b", label: "beta" },
      ]);
      expect(app.text()).toEqual(["alpha", "beta"]);
      const before = app.lis();

      app.set("lines", [
        { id: "a", label: "GAMMA" },
        { id: "b", label: "DELTA" },
      ]);
      expect(app.text()).toEqual(["GAMMA", "DELTA"]);
      const after = app.lis();
      expect(after[0]).toBe(before[0]);
      expect(after[1]).toBe(before[1]);

      after[1].dispatchEvent(new Event("click"));
      expect(sink).toEqual(["DELTA"]); // NOT "beta".
      after[0].dispatchEvent(new Event("click"));
      expect(sink).toEqual(["DELTA", "GAMMA"]);
    });

    test("in-place field mutation: handler carries the mutated label", () => {
      const sink = [];
      window.__sink = (v) => sink.push(v);
      const app = mount(TIER0_HANDLER_SRC, "t0-field-handler");
      app.set("lines", [
        { id: "a", label: "alpha" },
        { id: "b", label: "beta" },
      ]);
      const live = app.get("lines");
      live[0].label = "ALPHA2";
      expect(app.text()).toEqual(["ALPHA2", "beta"]);
      app.lis()[0].dispatchEvent(new Event("click"));
      expect(sink).toEqual(["ALPHA2"]); // live, not "alpha".
    });
  });

  // -- NEGATIVE: a GLOBAL handler (reads NO item) is NOT wrapped and STILL fires
  //    on a surviving node after a key removal. Proves the iter-scope token scan
  //    does not false-wrap a global handler (which would null-skip spuriously).

  describe("global handler (no item read) — not wrapped, still fires after removal", () => {
    test("Tier-1: bump() on a surviving node fires after a key was removed", () => {
      const app = mount(TIER1_GLOBAL_SRC, "t1-global");
      app.set("lines", [
        { id: "a", label: "alpha" },
        { id: "b", label: "beta" },
      ]);
      expect(app.lis().length).toBe(2);
      expect(app.get("hits")).toBe(0);
      // Remove key "b" — node for "a" survives (reused).
      app.set("lines", [{ id: "a", label: "alpha" }]);
      const lis = app.lis();
      expect(lis.length).toBe(1);
      lis[0].dispatchEvent(new Event("click"));
      expect(app.get("hits")).toBe(1); // global handler fired (no null-skip).
    });

    test("Tier-0: bump() on a surviving node fires after a key was removed", () => {
      const app = mount(TIER0_GLOBAL_SRC, "t0-global");
      app.set("lines", [
        { id: "a", label: "alpha" },
        { id: "b", label: "beta" },
      ]);
      expect(app.lis().length).toBe(2);
      expect(app.get("hits")).toBe(0);
      app.set("lines", [{ id: "a", label: "alpha" }]);
      const lis = app.lis();
      expect(lis.length).toBe(1);
      lis[0].dispatchEvent(new Event("click"));
      expect(app.get("hits")).toBe(1);
    });
  });
});
