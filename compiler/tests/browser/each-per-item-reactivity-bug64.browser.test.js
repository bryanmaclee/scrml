/**
 * each-per-item-reactivity-bug64.browser.test.js — Bug 64 + R28-1c (S159).
 *
 * Runtime gate (the load-bearing canary) for per-item CONTENT reactivity on
 * keyed-list reconcile. Compile-clean is NOT enough: this test loads the emitted
 * client.js AS-IS in real module-init order, drives the reactive collection, and
 * asserts that per-item TEXT + class: toggle reflect the CURRENT data for the
 * node's key after each of:
 *   - array-replace   (@lines = newArr — same ids, new field values)
 *   - field-mutation  (@lines[i].field = x — in-place)
 *   - reorder         (same keys, new order — content follows the key)
 * for BOTH tiers:
 *   - Tier-0  ${ for (line of @lines) { lift <li class:on=line.active>...</li> } }
 *   - Tier-1  <each in=@lines><li class:on=@.active>${@.label}</li></each>
 *
 * Plus: a per-item event handler still fires (closure intact), and a NO-CHANGE
 * reconcile preserves DOM node identity (Fast-path-B2 — no node re-create churn).
 *
 * Root cause (pre-fix): per-item bindings closed over the createFn's create-time
 * item; B2 reuse never re-ran createFn; Tier-1 class: had no effect at all.
 * Fix: bindings are live-keyed effects reading the live item BY KEY from the
 * reconcile map (_scrml_resolve_item).
 *
 * Models: each-in-tier0-lift-bug72.browser.test.js.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

// Tier-0 — reactive ${for...lift} with per-item text + class:on.
const TIER0_SRC = `<program>
type Line:struct = { id: string, label: string, active: boolean }
<lines>: Line[] = []
<ul>
  \${ for (line of @lines) {
    lift <li class:on=line.active>\${line.label}</li>
  } }
</ul>
</program>
`;

// Tier-1 — <each in=@lines> with per-item text + class:on.
const TIER1_SRC = `<program>
type Line:struct = { id: string, label: string, active: boolean }
<lines>: Line[] = []
<ul>
  <each in=@lines>
    <li class:on=@.active>\${@.label}</li>
  </each>
</ul>
</program>
`;

// Tier-1 with a per-item click handler — proves the handler still fires after
// reconcile and is wired per-item. The handler calls a top-level global JS sink
// (installed by the test) with the per-item label, so we observe BOTH that it
// fired AND that it carried the correct row's value. (A `${ @cell = x }` write
// inside a scrml `function` body is dropped by a PRE-EXISTING codegen gap — see
// NOTES — so we route through a global sink, not a reactive cell.)
const TIER1_HANDLER_SRC = `<program>
type Line:struct = { id: string, label: string, active: boolean }
<lines>: Line[] = []
<ul>
  <each in=@lines>
    <li onclick=${"$"}{ window.__sink(@.label) }>\${@.label}</li>
  </each>
</ul>
</program>
`;

const tmpRoot = resolve("/tmp", "scrml-each-per-item-bug64");

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

describe("bug64/r28-1c browser — per-item content reactivity on reconcile", () => {
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
      `${runtimeJs}\n` + captureInsideChunkScope(clientJs, `globalThis.__scrml_set_raw__ = _scrml_reactive_set;\n` +
        `globalThis.__scrml_get__ = _scrml_reactive_get;\n` +
        // Mirror real codegen: cell writes store a deep-reactive proxy
        // (\`_scrml_reactive_set(name, _scrml_deep_reactive(arr))\`), so field
        // reads/writes go through the reactive Proxy. Without this the test
        // would mutate raw objects (no set trap → no trigger). Must live INSIDE
        // the chunk scope like the others, or it writes the un-namespaced key.
        `globalThis.__scrml_set__ = (n, v) => _scrml_reactive_set(n, _scrml_deep_reactive(v));\n`),
    );
    exec(window, document);
    document.dispatchEvent(new Event("DOMContentLoaded"));
    // Both tiers mount their <li>s under the <ul> (Tier-1 via a
    // data-scrml-each-mount div; Tier-0 via a lifted logic span). Query <li>s
    // across the whole document to be tier-agnostic.
    const lis = () => [...document.querySelectorAll("li")];
    return {
      set: (name, val) => globalThis.__scrml_set__(name, val),
      get: (name) => globalThis.__scrml_get__(name),
      lis,
      text: () => lis().map((n) => n.textContent.trim()),
      onFlags: () => lis().map((n) => n.classList.contains("on")),
    };
  }

  // -- Tier-0 ----------------------------------------------------------------

  describe("Tier-0 ${for...lift}", () => {
    test("array-replace: same ids, new field values → text + class reflect new data", () => {
      const app = mount(TIER0_SRC, "t0-replace");
      app.set("lines", [
        { id: "a", label: "alpha", active: false },
        { id: "b", label: "beta", active: false },
      ]);
      expect(app.text()).toEqual(["alpha", "beta"]);
      expect(app.onFlags()).toEqual([false, false]);

      // Replace the WHOLE array — same ids (a, b), new labels + active flags.
      app.set("lines", [
        { id: "a", label: "GAMMA", active: true },
        { id: "b", label: "DELTA", active: false },
      ]);
      expect(app.text()).toEqual(["GAMMA", "DELTA"]);
      expect(app.onFlags()).toEqual([true, false]);
    });

    test("field-mutation: @lines[i].field = x → text + class update in place", () => {
      const app = mount(TIER0_SRC, "t0-field");
      app.set("lines", [
        { id: "a", label: "alpha", active: false },
        { id: "b", label: "beta", active: false },
      ]);
      const live = app.get("lines");
      live[0].label = "ALPHA2";
      live[0].active = true;
      expect(app.text()).toEqual(["ALPHA2", "beta"]);
      expect(app.onFlags()).toEqual([true, false]);
    });

    test("reorder: same keys, new order → content follows the key", () => {
      const app = mount(TIER0_SRC, "t0-reorder");
      app.set("lines", [
        { id: "a", label: "alpha", active: true },
        { id: "b", label: "beta", active: false },
      ]);
      expect(app.text()).toEqual(["alpha", "beta"]);
      // Reorder: b before a. Content must follow the KEY, not the DOM position.
      app.set("lines", [
        { id: "b", label: "beta", active: false },
        { id: "a", label: "alpha", active: true },
      ]);
      expect(app.text()).toEqual(["beta", "alpha"]);
      expect(app.onFlags()).toEqual([false, true]);
    });
  });

  // -- Tier-1 ----------------------------------------------------------------

  describe("Tier-1 <each>", () => {
    test("array-replace: same ids, new field values → text + class reflect new data", () => {
      const app = mount(TIER1_SRC, "t1-replace");
      app.set("lines", [
        { id: "a", label: "alpha", active: false },
        { id: "b", label: "beta", active: false },
      ]);
      expect(app.text()).toEqual(["alpha", "beta"]);
      expect(app.onFlags()).toEqual([false, false]);

      app.set("lines", [
        { id: "a", label: "GAMMA", active: true },
        { id: "b", label: "DELTA", active: false },
      ]);
      expect(app.text()).toEqual(["GAMMA", "DELTA"]);
      expect(app.onFlags()).toEqual([true, false]);
    });

    test("field-mutation: @lines[i].field = x → text + class update (closes sibling-gap #1)", () => {
      const app = mount(TIER1_SRC, "t1-field");
      app.set("lines", [
        { id: "a", label: "alpha", active: false },
        { id: "b", label: "beta", active: false },
      ]);
      const live = app.get("lines");
      live[1].label = "BETA2";
      live[1].active = true;
      expect(app.text()).toEqual(["alpha", "BETA2"]);
      // class: was a BARE toggle pre-fix (NO effect) — this is sibling-gap #1.
      expect(app.onFlags()).toEqual([false, true]);
    });

    test("reorder: same keys, new order → content follows the key", () => {
      const app = mount(TIER1_SRC, "t1-reorder");
      app.set("lines", [
        { id: "a", label: "alpha", active: true },
        { id: "b", label: "beta", active: false },
      ]);
      expect(app.text()).toEqual(["alpha", "beta"]);
      app.set("lines", [
        { id: "b", label: "beta", active: false },
        { id: "a", label: "alpha", active: true },
      ]);
      expect(app.text()).toEqual(["beta", "alpha"]);
      expect(app.onFlags()).toEqual([false, true]);
    });

    test("a per-item click handler still fires after reconcile", () => {
      const sink = [];
      window.__sink = (v) => sink.push(v);
      const app = mount(TIER1_HANDLER_SRC, "t1-handler");
      app.set("lines", [
        { id: "a", label: "alpha", active: false },
        { id: "b", label: "beta", active: false },
      ]);
      // Reconcile (no-op replace) — nodes reused via Fast-path-B2.
      app.set("lines", [
        { id: "a", label: "alpha", active: false },
        { id: "b", label: "beta", active: false },
      ]);
      const lis = app.lis();
      expect(lis.length).toBe(2);
      // The handler is still wired on the reused node and fires, carrying the
      // row's label to the sink.
      lis[1].dispatchEvent(new Event("click"));
      expect(sink).toEqual(["beta"]);
    });
  });

  // -- NEGATIVE: no-change reconcile preserves DOM node identity (Fast-path-B2) --

  describe("no-change reconcile preserves node identity (Fast-path-B2)", () => {
    test("Tier-1: a no-op replace reuses the SAME <li> nodes (no re-create churn)", () => {
      const app = mount(TIER1_SRC, "t1-identity");
      app.set("lines", [
        { id: "a", label: "alpha", active: false },
        { id: "b", label: "beta", active: false },
      ]);
      const before = app.lis();
      expect(before.length).toBe(2);
      // No-op reconcile — identical keys in identical order.
      app.set("lines", [
        { id: "a", label: "alpha", active: false },
        { id: "b", label: "beta", active: false },
      ]);
      const after = app.lis();
      expect(after.length).toBe(2);
      // SAME node references — Fast-path-B2 did not re-create nodes.
      expect(after[0]).toBe(before[0]);
      expect(after[1]).toBe(before[1]);
    });

    test("Tier-0: a no-op replace reuses the SAME <li> nodes (no re-create churn)", () => {
      const app = mount(TIER0_SRC, "t0-identity");
      app.set("lines", [
        { id: "a", label: "alpha", active: false },
        { id: "b", label: "beta", active: false },
      ]);
      const before = app.lis();
      expect(before.length).toBe(2);
      app.set("lines", [
        { id: "a", label: "alpha", active: false },
        { id: "b", label: "beta", active: false },
      ]);
      const after = app.lis();
      expect(after.length).toBe(2);
      expect(after[0]).toBe(before[0]);
      expect(after[1]).toBe(before[1]);
    });
  });
});
