/**
 * g-each-peritem-markup-value-ternary.browser.test.js
 *
 * Regression gate for change-id `ss17-each-peritem-emitter-2026-06-25` ITEM 2
 * (g-each-peritem-markup-value-ternary, GITI-032 follow-on).
 *
 * BUG: a markup-as-value (Pillar 1, SPEC §1.4 / §7.4) in a per-item `<each>`
 * interpolation — `${ @.active ? <span>ON ${@.label}</span> : "" }` — emitted ONLY
 * a skip comment. Clean compile, but the markup was silently NOT rendered.
 *
 * FIX (emit-each.ts emitEachPerItemMarkupValue): lower the markup-value (build the
 * DOM, resolve `@.field` to the item binding, split markup-text `${...}` into real
 * interpolation) and mount a stable per-item wrapper + a live-keyed effect that
 * re-evaluates + replaceChildren on reconcile.
 *
 * Runtime gate (S140/S152 lesson): asserts the markup ACTUALLY renders for active
 * items, is ABSENT for inactive items, nested `@.` refs resolve, and the markup
 * updates on an in-place toggle + a same-key array-replace.
 *
 * Models: g-nested-each-no-own-subscription.browser.test.js.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

const DOLLAR = "$";

const SRC = `<program>
type Row:struct = { id: string, label: string, active: bool }
<rows>: Row[] = []
<ul>
  <each in=@rows as it key=it.id>
    <li>${DOLLAR}{ @.active ? <span class="badge">ON ${DOLLAR}{@.label}</span> : "" }</li>
  </each>
</ul>
</program>
`;

const tmpRoot = resolve("/tmp", "scrml-each-markup-value-item2");

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

describe("g-each-peritem-markup-value-ternary — item2 (GITI-032 follow-on)", () => {
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
    // The skip comment must be GONE (real lowering replaced it).
    expect(clientJs).not.toContain("not yet lowered (GITI-032 follow-on)");
    document.documentElement.innerHTML = html;
    const exec = new Function(
      "window",
      "document",
      `${runtimeJs}\n` + captureInsideChunkScope(clientJs, `globalThis.__scrml_get__ = _scrml_reactive_get;\n` +
        `globalThis.__scrml_set__ = (n, v) => _scrml_reactive_set(n, _scrml_deep_reactive(v));\n`),
    );
    exec(window, document);
    document.dispatchEvent(new Event("DOMContentLoaded"));
    return {
      set: (name, val) => globalThis.__scrml_set__(name, val),
      get: (name) => globalThis.__scrml_get__(name),
      badges: () => [...document.querySelectorAll("span.badge")].map((n) => n.textContent.trim()),
      badgeCount: () => document.querySelectorAll("span.badge").length,
    };
  }

  test("markup renders for active items, absent for inactive, @. refs resolve", () => {
    const app = mount(SRC, "render");
    app.set("rows", [
      { id: "a", label: "alpha", active: true },
      { id: "b", label: "beta", active: false },
      { id: "c", label: "gamma", active: true },
    ]);
    // Only the two active rows render a badge, and the @.label interpolation resolves.
    expect(app.badges()).toEqual(["ON alpha", "ON gamma"]);
    expect(app.badgeCount()).toBe(2);
  });

  test("adversarial: in-place active toggle re-renders the markup-value", () => {
    const app = mount(SRC, "toggle");
    app.set("rows", [
      { id: "a", label: "alpha", active: false },
      { id: "b", label: "beta", active: true },
    ]);
    expect(app.badges()).toEqual(["ON beta"]);
    const live = app.get("rows");
    // Activate "a" in place — its badge should appear.
    live[0].active = true;
    expect(app.badges()).toEqual(["ON alpha", "ON beta"]);
    // Deactivate "b" in place — its badge should disappear.
    live[1].active = false;
    expect(app.badges()).toEqual(["ON alpha"]);
  });

  test("adversarial: same-key array-replace updates the markup-value label", () => {
    const app = mount(SRC, "replace");
    app.set("rows", [{ id: "a", label: "alpha", active: true }]);
    expect(app.badges()).toEqual(["ON alpha"]);
    // SAME id, NEW label (forces same-key node reuse) — the badge follows live data.
    app.set("rows", [{ id: "a", label: "OMEGA", active: true }]);
    expect(app.badges()).toEqual(["ON OMEGA"]);
    // SAME id, now inactive — the badge disappears on the reused node.
    app.set("rows", [{ id: "a", label: "OMEGA", active: false }]);
    expect(app.badgeCount()).toBe(0);
  });
});
