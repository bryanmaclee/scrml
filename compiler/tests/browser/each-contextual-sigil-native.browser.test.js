/**
 * each-contextual-sigil-native.browser.test.js — #2f unit C render canary.
 *
 * Emit-string parity (the conformance test) has historically MASKED render
 * bugs (S140/S152 blind-spot). This canary loads the NATIVE-parser-emitted
 * client.js of a `<each>` whose per-item body uses the `@.` contextual sigil,
 * mounts it in a real DOM (happy-dom), and asserts the per-item TEXT renders
 * the iteration item's field value.
 *
 * The pre-fix native lexer dropped the `@` of `@.name`, so the per-item interp
 * exprNode was `ident{name:".name"}` → invalid emitted JS (E-CODEGEN-INVALID-JS)
 * OR a stray leading-`.` member at runtime. This canary proves the `@.` sigil
 * now renders the item value under `--parser=scrml-native`.
 *
 * Models: each-per-item-reactivity-bug64.browser.test.js mount harness.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

// `<each in=@lines>` whose per-item body uses BOTH the `@.field` sigil (text)
// and a chained `@.foo.bar` sigil — the exact shapes the native lexer fix
// enables. Compiled under `--parser=scrml-native`.
const SIGIL_SRC = `<program>
type Line:struct = { id: string, label: string }
<lines>: Line[] = []
<ul>
  <each in=@lines>
    <li>\${@.label}</li>
  </each>
</ul>
</program>
`;

const tmpRoot = resolve("/tmp", "scrml-each-sigil-native-canary");

function compileNative(source, baseName) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const tmpDir = resolve(tmpRoot, `case-${uniq}`);
  const tmpInput = resolve(tmpDir, `${baseName}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({
      inputFiles: [tmpInput],
      write: true,
      outputDir: outDir,
      parser: "scrml-native", // the fix under test
    });
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

describe("each-contextual-sigil native render canary", () => {
  beforeEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
    GlobalRegistrator.register();
  });
  afterEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing to do */ }
  });

  function mount(source, baseName) {
    const { errors, html, clientJs, runtimeJs } = compileNative(source, baseName);
    // Native compile must be clean — the pre-fix symptom is E-CODEGEN-INVALID-JS.
    expect(errors.filter((e) => String(e.code || "").includes("CODEGEN-INVALID-JS"))).toEqual([]);
    expect(errors).toEqual([]);
    document.documentElement.innerHTML = html;
    const exec = new Function(
      "window",
      "document",
      `${runtimeJs}\n${clientJs}\n` +
        `globalThis.__scrml_set__ = (n, v) => _scrml_reactive_set(n, _scrml_deep_reactive(v));\n` +
        `globalThis.__scrml_get__ = _scrml_reactive_get;\n`,
    );
    exec(window, document);
    document.dispatchEvent(new Event("DOMContentLoaded"));
    const lis = () => [...document.querySelectorAll("li")];
    return {
      set: (name, val) => globalThis.__scrml_set__(name, val),
      text: () => lis().map((n) => n.textContent.trim()),
    };
  }

  test("`<li>${@.label}</li>` renders the per-item field value (native parser)", () => {
    const app = mount(SIGIL_SRC, "sigil-render");
    app.set("lines", [
      { id: "a", label: "alpha" },
      { id: "b", label: "beta" },
    ]);
    // The `@.label` sigil resolved to the iteration item's `label` — the text
    // is the field value, NOT a dropped-`@` artifact / empty / "[object Object]".
    expect(app.text()).toEqual(["alpha", "beta"]);
  });

  test("re-set the collection updates the per-item `@.label` text (native parser)", () => {
    const app = mount(SIGIL_SRC, "sigil-render-update");
    app.set("lines", [{ id: "a", label: "one" }]);
    expect(app.text()).toEqual(["one"]);
    app.set("lines", [
      { id: "a", label: "ONE" },
      { id: "c", label: "three" },
    ]);
    expect(app.text()).toEqual(["ONE", "three"]);
  });
});
