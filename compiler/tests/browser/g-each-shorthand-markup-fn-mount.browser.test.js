/**
 * g-each-shorthand-markup-fn-mount.browser.test.js
 *
 * Regression gate for g-each-nested-markup-interp-stringifies residual-1: a
 * `:`-shorthand each body that is a CALL to a same-file markup-returning fn.
 *
 * BUG (reproduced on baseline efaf0850): `<li : badge(it.name)>` where
 * `fn badge(n){ return <span class="badge">${n}</span> }` emitted
 * `_scrml_el.textContent = String(badge(it.name))`, stringifying the returned
 * DOM node to the literal text `[object HTMLSpanElement]` — clean compile, zero
 * diagnostics. The longhand `<li>${badge(it.name)}</li>` form already MOUNTS
 * (S297); the shorthand emit site was a separate `textContent = String()` path
 * that never ran the `interpMayYieldNode` "callee returns markup" discriminant.
 *
 * FIX (emit-each.ts): the shorthand body routes through the same `<span
 * data-scrml-mv>` mount-or-text wrapper the longhand path uses, ONLY when the
 * expr is a call to a fn KNOWN (same file) to return markup. A string-returning
 * shorthand (`<li : plain(it)>`) stays the byte-identical bare `textContent =
 * String()` path (over-wrapping a string in a `<span>` would regress restricted
 * parents). Parity with g-each-peritem-nested-markup-fn-call.browser.test.js.
 *
 * Runtime gate: EXECUTED DOM (happy-dom), not textContent-of-source.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { chunkCellKey } from "../helpers/chunk-scope.js";

const DOLLAR = "$";

// residual-1 repro: :-shorthand body, same-file markup-returning fn call.
const SRC_LI = `<program>
type Row:struct = { id: string, name: string }
<rows>: Row[] = []
fn badge(n: string) { return <span class="badge">${DOLLAR}{n}</span> }
<ul>
  <each in=@rows as it key=it.id>
    <li : badge(it.name)>
  </each>
</ul>
</program>
`;

// REGRESSION GUARD: a STRING-returning shorthand call must stay a bare text
// node with NO data-scrml-mv wrapper (restricted-parent safety).
const SRC_STRING = `<program>
type Row:struct = { id: string, name: string }
<rows>: Row[] = []
fn plain(n: string) { return n }
<ul>
  <each in=@rows as it key=it.id>
    <li : plain(it.name)>
  </each>
</ul>
</program>
`;

const tmpRoot = resolve("/tmp", "scrml-each-shorthand-markup-fn");

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

describe("g-each-shorthand-markup-fn-mount — g-each-nested residual-1", () => {
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
      bodyText: () => document.body.textContent,
    };
  }

  test("shorthand <li : badge(it)>: markup-returning call mounts a real <span>, not [object HTMLSpanElement]", () => {
    const app = mount(SRC_LI, "li");
    app.set("rows", [
      { id: "a", name: "alpha" },
      { id: "b", name: "beta" },
    ]);
    expect(app.badgeCount()).toBe(2);
    expect(app.badges()).toEqual(["alpha", "beta"]);
    // Each badge lives inside its <li>.
    expect([...document.querySelectorAll("li span.badge")].length).toBe(2);
    // The bug's tell-tale must be ABSENT.
    expect(app.bodyText()).not.toContain("[object");
  });

  test("reconcile: same-key array REPLACE updates the mounted markup", () => {
    const app = mount(SRC_LI, "replace");
    app.set("rows", [{ id: "a", name: "alpha" }]);
    expect(app.badges()).toEqual(["alpha"]);
    app.set("rows", [{ id: "a", name: "OMEGA" }]);
    expect(app.badges()).toEqual(["OMEGA"]);
    expect(app.badgeCount()).toBe(1);
  });

  test("REGRESSION GUARD: a string-returning shorthand call stays a bare text node (no wrapper)", () => {
    const app = mount(SRC_STRING, "string");
    app.set("rows", [
      { id: "a", name: "alpha" },
      { id: "b", name: "beta" },
    ]);
    expect(document.body.textContent).toContain("alpha");
    expect(document.body.textContent).toContain("beta");
    // No markup wrapper introduced for a string-returning shorthand call.
    expect(app.clientJs).not.toContain("data-scrml-mv");
  });
});
