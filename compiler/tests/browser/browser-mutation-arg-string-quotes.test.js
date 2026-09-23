/**
 * browser-mutation-arg-string-quotes.test.js — happy-dom RUNTIME acceptance for
 * string literals in §6.5.1 reactive-array-mutation arguments (and a C-style
 * `for` header).
 *
 * On main d6d6e55a the mutation recognizer dropped every string's quotes:
 *   - `@groups.splice(0, 1, { id: 1, name: "S" })` compiled clean and threw
 *     `ReferenceError: S is not defined` on click;
 *   - `@groups.push({ id: 2, name: "P" })` failed with a misleading E-SCOPE-001;
 *   - `@xs.push("S")` with `const S = …` in scope silently pushed the binding.
 *   - `for (let i = 0; i < "abc".length; i++)` compiled clean to `abc.length`.
 *
 * The emit-shape proof is compiler/tests/unit/mutation-arg-string-quotes.test.js;
 * this file drives click → handler → reactive set → DOM and asserts the VALUES.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { tmpdir } from "os";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

const tmpRoot = resolve(tmpdir(), "scrml-mutation-arg-string-quotes-browser");

function compileToOutputs(source, baseName = "app") {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const tmpDir = resolve(tmpRoot, `case-${uniq}`);
  const tmpInput = resolve(tmpDir, `${baseName}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir, log: () => {} });
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
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

function mount(compiled) {
  const { html, clientJs, runtimeJs } = compiled;
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html);
  document.body.innerHTML = (body ? body[1] : html).replace(/<script[^>]*>[\s\S]*?<\/script>/g, "");
  const errs = [];
  const origError = console.error;
  console.error = (...a) => { errs.push(a.map(String).join(" ")); };
  let threw = null;
  try {
    new Function(
      "window",
      "document",
      `${runtimeJs}\n` + captureInsideChunkScope(clientJs, `globalThis.__scrml_get__ = _scrml_reactive_get;\n`),
    )(window, document);
    document.dispatchEvent(new Event("DOMContentLoaded"));
  } catch (e) {
    threw = e;
  }
  return {
    threw,
    errs,
    restore: () => { console.error = origError; },
    get: (name) => globalThis.__scrml_get__(name),
    click: (id) => {
      document.getElementById(id).dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    },
    text: (sel) => [...document.querySelectorAll(sel)].map((e) => e.textContent.trim()),
  };
}

function run(source, fn) {
  const compiled = compileToOutputs(source);
  expect(compiled.errors.map((e) => `${e.code} ${e.message}`)).toEqual([]);
  const app = mount(compiled);
  try {
    expect(app.threw).toBeNull();
    fn(app);
    expect(app.errs).toEqual([]);
  } finally {
    app.restore();
  }
}

// The reported repro, verbatim.
const REPORTED = `<program>
  <groups> = [{ id: 1, name: "one" }]
  function a() { @groups.splice(0, 1, { id: 1, name: "S" }) }
  function b() { @groups.push({ id: 2, name: "P" }) }
  <ul><each in=@groups key=@.id as g><li>\${g.name}</li></each></ul>
  <button id="a" onclick=a()>a</button><button id="b" onclick=b()>b</button>
</program>
`;

describe("§6.5.1 mutation string args — runtime", () => {
  beforeEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
    GlobalRegistrator.register();
  });
  afterEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing */ }
  });

  test("reported repro: splice then push render the string values", () => {
    run(REPORTED, (app) => {
      expect(app.text("li")).toEqual(["one"]);
      app.click("a");
      expect(app.get("groups")).toEqual([{ id: 1, name: "S" }]);
      expect(app.text("li")).toEqual(["S"]);
      app.click("b");
      expect(app.get("groups")).toEqual([{ id: 1, name: "S" }, { id: 2, name: "P" }]);
      expect(app.text("li")).toEqual(["S", "P"]);
    });
  });

  test("a string that names an in-scope binding is pushed as the STRING, not the binding", () => {
    run(`<program>
  <xs> = []
  const S = "CAPTURED"
  function f() { @xs.push("S", S) }
  <button id="f" onclick=f()>f</button>
</program>
`, (app) => {
      app.click("f");
      expect(app.get("xs")).toEqual(["S", "CAPTURED"]);
    });
  });

  test("every mutator with string args: push / unshift / splice / fill / sort", () => {
    run(`<program>
  <xs> = ["m"]
  function f() {
    @xs.push("it's", 'say "hi"')
    @xs.unshift(\`t\${1 + 1}\`)
    @xs.splice(1, 0, "(", ")")
    @xs.sort((a, b) => a.localeCompare(b, "en"))
  }
  function g() { @xs.fill("z", 0, 2) }
  <button id="f" onclick=f()>f</button><button id="g" onclick=g()>g</button>
</program>
`, (app) => {
      app.click("f");
      const expected = ["t2", "(", ")", "m", "it's", 'say "hi"'].sort((a, b) => a.localeCompare(b, "en"));
      expect(app.get("xs")).toEqual(expected);
      app.click("g");
      expect(app.get("xs")).toEqual(["z", "z", ...expected.slice(2)]);
    });
  });

  test("top-level ${} logic block mutation with strings runs at init", () => {
    run(`<program>
  <xs> = ["a"]
  \${ @xs.push("blk", '(') }
  <p id="o">\${@xs.join("|")}</p>
</program>
`, (app) => {
      expect(app.get("xs")).toEqual(["a", "blk", "("]);
      expect(app.text("#o")).toEqual(["a|blk|("]);
    });
  });

  test("C-style for header with a string literal iterates by the STRING's length", () => {
    run(`<program>
  <n> = 0
  function g() { for (let i = 0; i < "abc".length; i++) { @n = @n + 1 } }
  <button id="g" onclick=g()>g</button>
</program>
`, (app) => {
      app.click("g");
      expect(app.get("n")).toBe(3);
    });
  });
});
