/**
 * s457-user-fn-name-hygiene.test.js
 *
 * g-user-function-named-id-breaks-click-dispatch-s457 (HIGH).
 *
 * A user `function id(x)` killed every click handler on the page, at exit 0: the
 * client `post-fn-name-mangle` pass was a scope-blind regex over the whole client
 * buffer, and the click dispatcher's OWN local
 *
 *     const id = t.getAttribute("data-scrml-bind-onclick");
 *     if (id && _scrml_click[id]) { ... }
 *
 * was rewritten to `_scrml_click[_scrml_id_3]`. The rename is now scope-aware
 * (codegen/fn-name-rename.ts): only a reference that no enclosing scope binds —
 * i.e. one that means the user's top-level function — is renamed.
 *
 * §1 is the pass at its own locus (pure text in, text out).
 * §2 compiles real programs and EXECUTES them in happy-dom: for every name the
 *    corpus sweep found the old pass could hit inside compiler-emitted code, a
 *    user function of that name must leave every handler kind working.
 */

import { describe, test, expect, afterAll } from "bun:test";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { compileScrml } from "../../src/api.js";
import { SCRML_RUNTIME } from "../../src/runtime-template.js";
import { renameUserFnRefsScoped } from "../../src/codegen/fn-name-rename.ts";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

// ---------------------------------------------------------------------------
// §1 — the pass
// ---------------------------------------------------------------------------

describe("§1 renameUserFnRefsScoped — only free references are renamed", () => {
  const map = new Map([["id", "_scrml_id_3"], ["get", "_scrml_get_4"], ["total", "_scrml_fetch_total_5"]]);

  test("THE BUG: a compiler local named like a user fn is left alone", () => {
    const code = [
      "function _scrml_id_3(x) { return x; }",
      "document.addEventListener(\"click\", function(event) {",
      "  const id = t.getAttribute(\"data-scrml-bind-onclick\");",
      "  if (id && _scrml_click[id]) { _scrml_click[id](event); return; }",
      "});",
      "_scrml_render(id(1));",
    ].join("\n");
    const out = renameUserFnRefsScoped(code, map);
    expect(out).toContain("if (id && _scrml_click[id]) { _scrml_click[id](event); return; }");
    expect(out).not.toContain("_scrml_click[_scrml_id_3]");
    // The free reference at the bottom IS the user's function.
    expect(out).toContain("_scrml_render(_scrml_id_3(1));");
  });

  test("a lambda parameter shadows a server fn of the same name (g-lambda-param-renamed-to-fetch-stub)", () => {
    const out = renameUserFnRefsScoped("const r = nums.map((total) => total * 2);\nconst s = nums.map(total);", map);
    expect(out).toContain("nums.map((total) => total * 2)");
    // Passed by reference, the free name still means the server fn's stub.
    expect(out).toContain("nums.map(_scrml_fetch_total_5)");
  });

  test("a destructured binding shadows; its uses resolve to it", () => {
    const out = renameUserFnRefsScoped("function run() { const { get } = src; return get(1); }\nget(2);", map);
    expect(out).toContain("const { get } = src; return get(1);");
    expect(out).toContain("_scrml_get_4(2);");
  });

  test("shorthand properties expand to key: encoded (key preserved)", () => {
    const out = renameUserFnRefsScoped("const api = { get, n: 1, ...x };", map);
    expect(out).toBe("const api = { get: _scrml_get_4, n: 1, ...x };");
  });

  test("member names, object keys and labels are never references", () => {
    const code = "a.id(1);\nconst o = { id: 1 };\nid: for (;;) { break id; }";
    expect(renameUserFnRefsScoped(code, map)).toBe(code);
  });

  test("hoisting: a var or function declared later in the same function still binds", () => {
    const out = renameUserFnRefsScoped("function f() { id(1); var id = g; }\nfunction h() { id(1); function id() {} }", map);
    expect(out).not.toContain("_scrml_id_3");
  });

  // S458 re-review (c) — a free reference to the user's function is renamed in
  // EVERY position (a member root too): left as written, `id.name` beside a user
  // `function id` dangled after the rename. Host-global names keep the legacy
  // call-like positions (g-user-fn-named-host-global-hijacks-compiler-refs-s457).
  test("every free reference is renamed, a member root included: `id.x`, `id(`, `id;`, `id,`", () => {
    const out = renameUserFnRefsScoped("x = id.name;\nf(id, 1);\ng(id);\nh = id;", map);
    expect(out).toBe("x = _scrml_id_3.name;\nf(_scrml_id_3, 1);\ng(_scrml_id_3);\nh = _scrml_id_3;");
  });

  test("a host-global name keeps the legacy positions: `document.x` is not renamed, `document(` is", () => {
    const m2 = new Map([["document", "_scrml_document_4"]]);
    const out = renameUserFnRefsScoped("x = document.title;\ndocument(1);", m2);
    expect(out).toBe("x = document.title;\n_scrml_document_4(1);");
  });

  test("string literals and comments are untouched", () => {
    const code = 'const s = "id(1)"; // id(2)\nconst t = `id(3) ${id(4)}`;';
    expect(renameUserFnRefsScoped(code, map)).toBe('const s = "id(1)"; // id(2)\nconst t = `id(3) ${_scrml_id_3(4)}`;');
  });

  test("an `await` in a not-yet-async function still parses (offsets preserved)", () => {
    const out = renameUserFnRefsScoped("function f() { const id = 1; return await id; }\nid(1);", map);
    expect(out).toBe("function f() { const id = 1; return await id; }\n_scrml_id_3(1);");
  });

  test("a body that does not parse returns null (the caller keeps the regex pass)", () => {
    expect(renameUserFnRefsScoped("id(1; {", map)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// §2 — executed
// ---------------------------------------------------------------------------

function compileToOutputs(source) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const name = `s457hyg-${uniq}`;
  const tmpDir = resolve(tmpdir(), `scrml-${name}`);
  const tmpInput = resolve(tmpDir, `${name}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir });
    const clientPath = resolve(outDir, `${name}.client.js`);
    const htmlPath = resolve(outDir, `${name}.html`);
    return {
      errors: result.errors ?? [],
      clientJs: existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "",
      html: existsSync(htmlPath) ? readFileSync(htmlPath, "utf8") : "",
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function compileAndLoad(source) {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
  GlobalRegistrator.register();
  const { errors, clientJs, html } = compileToOutputs(source);
  if (errors.length > 0) {
    throw new Error(`compile errors: ${errors.map((e) => e.code + ": " + e.message).join(", ")}`);
  }
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  document.body.innerHTML = (bodyMatch ? bodyMatch[1] : html).replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").trim();
  const code =
    `(function() {\n${SCRML_RUNTIME}\n` +
    captureInsideChunkScope(clientJs, `window._scrml_reactive_get = _scrml_reactive_get;\nwindow._scrml_reactive_set = _scrml_reactive_set;\n`) +
    `\n})();`;
  // eslint-disable-next-line no-eval
  eval(code);
  document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
  return { clientJs, get: (n) => window._scrml_reactive_get(n), set: (n, v) => window._scrml_reactive_set(n, v) };
}

// Every handler kind, each one bumping @count by a different amount, so a dead
// handler shows up as a wrong total. The user function N is declared and used —
// from inside user function bodies, which no compiler scope encloses.
const program = (n) => `<program>
<count> = 0
<items> = [{ id: 1 }, { id: 2 }]
<text> = ""

function ${n}(x) { return x }
function bump(amountQ) { @count = @count + ${n}(amountQ) }

<div>
  <button id="b-callref" onclick=bump(1)>a</button>
  <button id="b-inline" onclick={ bump(2) }>b</button>
  <button id="b-closure" onclick=\${() => bump(4)}>c</button>
  <form id="f" onsubmit=bump(8)><button>s</button></form>
  <input id="in" oninput=bump(16)/>
  <ul>
    <each in=@items as it>
      <li><button class="row" onclick=bump(32)>r</button></li>
    </each>
  </ul>
  <p id="out">\${@count}</p>
</div>
</program>
`;

// The names the s457 corpus sweep found the old pass rewriting inside
// compiler-emitted code (dispatcher, wiring, each rows, boot), plus the
// brief's enumeration.
const NAMES = [
  "id", "t", "el", "root", "i", "item", "key", "value", "name", "d", "e", "k", "n", "r", "s", "u", "v",
  "c", "f", "l", "body", "path", "method", "raw", "data", "error", "errors", "current", "row", "src",
  "tag", "arr", "entries", "field", "close", "destroy", "resolve", "status", "token", "match",
];

describe("§2 a user function named like a compiler local leaves every handler working (executed)", () => {
  test("the reported repro: `function id` — the click dispatcher keeps its own local", async () => {
    const { clientJs, get } = await compileAndLoad(program("id"));
    expect(clientJs).toMatch(/if \(id && _scrml_click\[id\]\) \{ _scrml_click\[id\]\(event\); return; \}/);
    expect(clientJs).not.toMatch(/_scrml_click\[_scrml_id_\d+\]/);
    document.getElementById("b-callref").click();
    expect(get("count")).toBe(1);
  });

  for (const n of NAMES) {
    test(`function ${n}: every handler kind fires`, async () => {
      const { get } = await compileAndLoad(program(n));
      document.getElementById("b-callref").click();
      document.getElementById("b-inline").click();
      document.getElementById("b-closure").click();
      document.getElementById("f").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      document.getElementById("in").dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector(".row").click();
      expect(get("count")).toBe(1 + 2 + 4 + 8 + 16 + 32);
      expect(document.getElementById("out").textContent).toBe(String(63));
    });
  }
});

// ---------------------------------------------------------------------------
// §3 — capture: a compiler binding that ENCLOSES user text must not capture a
//      same-named user function (executed)
// ---------------------------------------------------------------------------
//
// The reverse direction of §2. The rename now leaves a scope-bound name alone,
// so a compiler binding wrapped AROUND user text — the display wiring's element
// local, the rewire root, an each row's item list / mount / fragment, an arm
// wire fn's internals — would bind a user function of the same name. Those
// bindings are spelled in the reserved `_scrml_` namespace (§47.1.1), so no
// user name can reach them. Enumerated over the corpus by resolving every
// encoded user-function reference against its enclosing scopes.

const captureProgram = (n) => `\${
  type Shape:enum = { Circle(r: number), Square(s: number) }
}
<program>
<count> = 2
<on> = true
<items> = [{ id: 1 }, { id: 2 }]
<shape>: Shape = Shape.Circle(7)

function ${n}(x) { return x }

<div>
  <p id="disp">\${${n}(@count)}</p>
  <p id="attr" title="t-\${${n}(@count)}">a</p>
  <p id="ifp" if=(${n}(@on))>shown \${${n}(@count)}</p>
  <ul id="rows"><each in=@items as it><li>\${${n}(it.id)}</li></each></ul>
  <div id="arm"><match on=@shape>
    <Circle(r)><span>\${${n}(r)}</span></>
    <Square(s)><span>sq</span></>
  </match></div>
</div>
</program>
`;

const CAPTURE_NAMES = [
  "el", "root", "_items", "_mount", "_itemFrag", "_root", "_disposers", "_eb_result", "_next",
  "_stateData", "_msgData", "fromVariant", "toVariant", "_h", "_d", "_v", "_hv", "_rt",
];

describe("§3 a user function named like an ENCLOSING compiler binding is not captured (executed)", () => {
  for (const n of CAPTURE_NAMES) {
    test(`function ${n}: display, attribute, if=, each row and match arm all call the user function`, async () => {
      const { set } = await compileAndLoad(captureProgram(n));
      expect(document.getElementById("disp").textContent).toBe("2");
      expect(document.getElementById("attr").getAttribute("title")).toBe("t-2");
      expect(document.getElementById("ifp")?.textContent).toBe("shown 2");
      expect([...document.querySelectorAll("#rows li")].map((e) => e.textContent)).toEqual(["1", "2"]);
      expect(document.getElementById("arm").textContent.trim()).toBe("7");
      set("count", 5);
      expect(document.getElementById("disp").textContent).toBe("5");
      expect(document.getElementById("attr").getAttribute("title")).toBe("t-5");
    });
  }
});

// happy-dom replaces Request / Response / fetch globally; leaving it registered
// breaks later files that run a server route in the same process.
afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});
