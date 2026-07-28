/**
 * g-each-peritem-nested-markup-fn-call.browser.test.js
 *
 * Regression gate for GH #161 follow-on (nested each-interp of a
 * markup-RETURNING fn call).
 *
 * BUG (reproduced on baseline 115e8b1b): a standalone interpolation NESTED
 * inside an `<each>` per-item element whose value is a function CALL that
 * returns markup — `<li>${badge(it.name)}</li>` where
 * `fn badge(n){ return <span class="badge">${n}</span> }` — was emitted as
 * `_scrml_each_tn.textContent = String(badge(it.name))`, stringifying the
 * returned DOM node to the literal text `[object HTMLSpanElement]`. Clean
 * compile, zero diagnostics — a Pillar 1 (SPEC §1.4 / §7.4 markup-as-value)
 * violation, silent wrong render.
 *
 * FIX (emit-each.ts): a nested standalone interp mounts via the `<span
 * data-scrml-mv>` mount-or-text wrapper ONLY when the interp value is genuinely
 * a DOM node — a call (or a ternary/match value-branch) to a fn KNOWN (same
 * file) to return markup. A string-returning call stays a bare text node (a
 * `<span>` inside `<option>`/`<textarea>` would be invalid HTML — over-wrapping
 * is a real regression).
 *
 * Runtime gate: asserts via EXECUTED DOM (happy-dom), not textContent-of-source.
 * Models: g-each-peritem-markup-value-ternary.browser.test.js.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { chunkCellKey } from "../helpers/chunk-scope.js";

const DOLLAR = "$";

// Nested inside <li>: the reported repro shape.
const SRC_LI = `<program>
type Row:struct = { id: string, name: string }
<rows>: Row[] = []
fn badge(n: string) { return <span class="badge">${DOLLAR}{n}</span> }
<ul>
  <each in=@rows as it key=it.id>
    <li>${DOLLAR}{badge(it.name)}</li>
  </each>
</ul>
</program>
`;

// Nested inside <tr><td>: a deeper nesting of the same shape.
const SRC_TD = `<program>
type Row:struct = { id: string, name: string }
<rows>: Row[] = []
fn badge(n: string) { return <span class="badge">${DOLLAR}{n}</span> }
<table>
  <tbody>
    <each in=@rows as it key=it.id>
      <tr><td>${DOLLAR}{badge(it.name)}</td></tr>
    </each>
  </tbody>
</table>
</program>
`;

// REGRESSION GUARD: a STRING-returning call must stay a bare text node.
const SRC_STRING = `<program>
type Row:struct = { id: string, name: string }
<rows>: Row[] = []
fn plain(n: string) { return n }
<ul>
  <each in=@rows as it key=it.id>
    <li>${DOLLAR}{plain(it.name)}</li>
  </each>
</ul>
</program>
`;

const tmpRoot = resolve("/tmp", "scrml-each-nested-markup-fn-call");

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

describe("g-each-peritem-nested-markup-fn-call — GH #161 follow-on", () => {
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
      `${runtimeJs}\n${clientJs}\n` +
        `globalThis.__scrml_get__ = _scrml_reactive_get;\n` +
        `globalThis.__scrml_set__ = (n, v) => _scrml_reactive_set(n, _scrml_deep_reactive(v));\n`,
    );
    exec(window, document);
    document.dispatchEvent(new Event("DOMContentLoaded"));
    const cellKey = chunkCellKey(clientJs);
    return {
      clientJs,
      set: (name, val) => globalThis.__scrml_set__(cellKey(name), val),
      badges: () => [...document.querySelectorAll("span.badge")].map((n) => n.textContent.trim()),
      badgeCount: () => document.querySelectorAll("span.badge").length,
      // The literal-stringified node the BUG produced.
      bodyText: () => document.body.textContent,
    };
  }

  test("nested <li>: markup-returning call mounts a real <span>, not [object HTMLSpanElement]", () => {
    const app = mount(SRC_LI, "li");
    app.set("rows", [
      { id: "a", name: "alpha" },
      { id: "b", name: "beta" },
    ]);
    // Real elements — the returned DOM node was appended, not stringified.
    expect(app.badgeCount()).toBe(2);
    expect(app.badges()).toEqual(["alpha", "beta"]);
    // The bug's tell-tale must be ABSENT.
    expect(app.bodyText()).not.toContain("[object");
  });

  test("nested <tr><td>: markup-returning call mounts a real <span>", () => {
    const app = mount(SRC_TD, "td");
    app.set("rows", [
      { id: "a", name: "alpha" },
      { id: "b", name: "beta" },
    ]);
    expect(app.badgeCount()).toBe(2);
    expect(app.badges()).toEqual(["alpha", "beta"]);
    // Each badge lives inside a <td>.
    const tdBadges = [...document.querySelectorAll("td span.badge")];
    expect(tdBadges.length).toBe(2);
    expect(app.bodyText()).not.toContain("[object");
  });

  test("reconcile: same-key array REPLACE updates the mounted markup", () => {
    const app = mount(SRC_LI, "replace");
    app.set("rows", [{ id: "a", name: "alpha" }]);
    expect(app.badges()).toEqual(["alpha"]);
    // SAME id, NEW name (forces same-key node reuse) — markup follows live data.
    app.set("rows", [{ id: "a", name: "OMEGA" }]);
    expect(app.badges()).toEqual(["OMEGA"]);
    expect(app.badgeCount()).toBe(1);
  });

  test("REGRESSION GUARD: a string-returning call stays a bare text node (no wrapper)", () => {
    const app = mount(SRC_STRING, "string");
    app.set("rows", [
      { id: "a", name: "alpha" },
      { id: "b", name: "beta" },
    ]);
    // The value renders as text...
    expect(document.body.textContent).toContain("alpha");
    expect(document.body.textContent).toContain("beta");
    // ...and the emitted client JS does NOT introduce a data-scrml-mv wrapper
    // for a string-returning call (the whole reason "is a call" was rejected in
    // favor of "callee returns markup").
    expect(app.clientJs).not.toContain("data-scrml-mv");
  });
});
