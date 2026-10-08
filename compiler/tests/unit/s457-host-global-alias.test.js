/**
 * s457-host-global-alias.test.js
 *
 * g-user-fn-named-host-global-hijacks-compiler-refs-s457 (HIGH) — S457 ruling 2a.
 *
 * A compiler reference to a host global and a user's reference to a same-named
 * user function were both FREE names in the emitted JS, so nothing could tell
 * them apart:
 *
 *   - a user `function fetch` + any server function made the client's
 *     `_scrml_fetch_with_csrf_retry` call the user's function for every server
 *     call (the scope-aware rename renamed the compiler's `fetch(path, …)` too);
 *   - a user `function document` turned the click dispatcher's
 *     `t !== document` into `t !== _scrml_document_7`;
 *   - a user top-level `const location = …` is emitted under its own name in the
 *     chunk scope and captured every compiler `location` reference there;
 *   - a server function called by another is a module-scope `async function <name>`
 *     in the server bundle, so `server function Response` shadowed `Response` for
 *     every route.
 *
 * Now every compiler reference spells the global through `_scrml_g` (the global
 * object, captured once — codegen/host-global-alias.ts): `_scrml_g.fetch(…)`,
 * `_scrml_g.document`, `new _scrml_g.Response(…)`.
 *
 * §1 the helpers at their own locus (text in, text out).
 * §2 the invariant, statically: compiler-emitted code holds NO free host-global
 *    reference — over every example program, every artifact kind.
 * §3 executed in happy-dom: a user function (and a user top-level const) named
 *    after each host global leaves every handler kind AND the server-call path
 *    working; a fetch mock installed after load is still the one called.
 * §4 executed server: a server function named after a host global, called by
 *    another server function, leaves the route working.
 */

import { describe, test, expect, afterAll } from "bun:test";
import { resolve, join } from "path";
import { writeFileSync, readFileSync, rmSync, mkdirSync, readdirSync, existsSync } from "fs";
import { tmpdir } from "os";
import * as acorn from "acorn";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { compileScrml } from "../../src/api.js";
import { SCRML_RUNTIME } from "../../src/runtime-template.js";
import {
  HOST_GLOBAL_ALIAS,
  HOST_GLOBAL_ALIAS_DECL,
  HOST_GLOBAL_NAMES,
  withHostGlobalAlias,
  aliasHostGlobalsInRuntimeText,
} from "../../src/codegen/host-global-alias.ts";
import { aliasFreeGlobalRefs, renameUserFnRefsScoped } from "../../src/codegen/fn-name-rename.ts";
import { SERVER_URL_SHAPE_HELPER } from "../../src/codegen/emit-predicates.ts";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

const REPO = resolve(import.meta.dir, "../../..");

// ---------------------------------------------------------------------------
// §1 — the helpers
// ---------------------------------------------------------------------------

describe("§1 the alias helpers", () => {
  test("the runtime declares the alias first, before any other runtime binding", () => {
    const firstDecl = SCRML_RUNTIME.match(/^(?:const|let|var|function)\s+[\w$]+.*$/m)?.[0];
    expect(firstDecl.startsWith(`const ${HOST_GLOBAL_ALIAS} = globalThis;`)).toBe(true);
  });

  test("withHostGlobalAlias declares the alias once, after the header comments", () => {
    const js = "// header 1\n// header 2\n\nconst x = new _scrml_g.Map();\n";
    const out = withHostGlobalAlias(js);
    expect(out).toBe(`// header 1\n// header 2\n${HOST_GLOBAL_ALIAS_DECL}\n\nconst x = new _scrml_g.Map();\n`);
    expect(withHostGlobalAlias(out)).toBe(out); // idempotent
  });

  test("withHostGlobalAlias keeps a #! line first and leaves an alias-free module alone", () => {
    expect(withHostGlobalAlias("#!/usr/bin/env bun\n_scrml_g.process.exit(0);\n"))
      .toBe(`#!/usr/bin/env bun\n${HOST_GLOBAL_ALIAS_DECL}\n_scrml_g.process.exit(0);\n`);
    const plain = "const a = 1; // mentions _scrml_g_x and o._scrml_g\n";
    expect(withHostGlobalAlias(plain)).toBe(plain);
  });

  test("aliasFreeGlobalRefs rewrites only FREE references", () => {
    const names = new Set(["URL", "String", "console", "globalThis", "Set"]);
    const code = [
      "const S = new Set([1]);",
      "function f(String) { return String(1); }", // a parameter shadows
      "function g(v) { try { new URL(v); return true; } catch (e) { return false; } }",
      "const o = { console, n: 1 };",             // shorthand
      "const r = a.URL + b.String;",              // member names are not references
      "const t = typeof console !== 'undefined' && globalThis.x;",
    ].join("\n");
    expect(aliasFreeGlobalRefs(code, names, "_scrml_g")).toBe([
      "const S = new _scrml_g.Set([1]);",
      "function f(String) { return String(1); }",
      "function g(v) { try { new _scrml_g.URL(v); return true; } catch (e) { return false; } }",
      "const o = { console: _scrml_g.console, n: 1 };",
      "const r = a.URL + b.String;",
      "const t = typeof _scrml_g.console !== 'undefined' && _scrml_g.x;",
    ].join("\n"));
  });

  test("the rename pass never touches an aliased reference (a member access)", () => {
    const map = new Map([["fetch", "_scrml_fetch_6"], ["document", "_scrml_document_7"]]);
    const code = "await _scrml_g.fetch(path, {});\nwhile (t && t !== _scrml_g.document) {}\nfetch(2);";
    expect(renameUserFnRefsScoped(code, map))
      .toBe("await _scrml_g.fetch(path, {});\nwhile (t && t !== _scrml_g.document) {}\n_scrml_fetch_6(2);");
  });

  test("the server copy of the URL judge reaches its globals through the alias", () => {
    expect(SERVER_URL_SHAPE_HELPER).toContain("new _scrml_g.URL(");
    expect(freeHostGlobals(SERVER_URL_SHAPE_HELPER)).toEqual([]);
    expect(() => aliasHostGlobalsInRuntimeText("function (")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// shared — free host-global references in a JS text
// ---------------------------------------------------------------------------

/** Names of FREE references to host globals in `js` (a scope walk over the parse). */
function freeHostGlobals(js) {
  const hits = [];
  // aliasFreeGlobalRefs rewrites exactly the free references; diff it to find them.
  const marker = "__FREE_HOST_GLOBAL__";
  const out = aliasFreeGlobalRefs(js, HOST_GLOBAL_NAMES, marker);
  if (out === null) throw new Error("artifact does not parse");
  for (const m of out.matchAll(new RegExp(`${marker}(?:\\.([A-Za-z_$][\\w$]*))?`, "g"))) hits.push(m[1] ?? "globalThis");
  return hits;
}

/** The host globals a free reference may legitimately name: the alias declaration, and any the author wrote. */
function unexplained(js, source) {
  return freeHostGlobals(js).filter((n) => {
    if (n === "globalThis" && js.includes(HOST_GLOBAL_ALIAS_DECL)) return false;
    return !new RegExp(`(?<![\\w$])${n}(?![\\w$])`).test(source);
  });
}

// ---------------------------------------------------------------------------
// §2 — the invariant: no free host-global reference in compiler-emitted code
// ---------------------------------------------------------------------------

describe("§2 compiler output holds no free host-global reference (static, every example)", () => {
  const exampleDir = join(REPO, "examples");
  const sources = readdirSync(exampleDir).filter((f) => f.endsWith(".scrml")).map((f) => join(exampleDir, f));

  test("the example population is what it claims", () => {
    expect(sources.length).toBeGreaterThanOrEqual(25);
  });

  for (const src of sources) {
    test(`${src.slice(REPO.length + 1)}`, () => {
      const source = readFileSync(src, "utf8");
      const result = compileScrml({ inputFiles: [src], write: false, log: () => {} });
      let checked = 0;
      for (const [, out] of result.outputs ?? new Map()) {
        const artifacts = [out.clientJs, out.serverJs, out.libraryJs, out.toolJs, ...Object.values(out.workerBundles ?? {})];
        for (const js of artifacts) {
          if (typeof js !== "string" || js.length === 0) continue;
          checked++;
          expect({ file: src, free: unexplained(js, source) }).toEqual({ file: src, free: [] });
        }
      }
      // A failed compile emits nothing to check; the example corpus compiles.
      if ((result.errors ?? []).some((e) => !e.severity || e.severity === "error")) return;
      expect(checked).toBeGreaterThan(0);
    });
  }
});

// ---------------------------------------------------------------------------
// §3 — executed client
// ---------------------------------------------------------------------------

function compileOne(source, tag) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const name = `s457hga-${tag}-${uniq}`;
  const dir = resolve(tmpdir(), `scrml-${name}`);
  mkdirSync(dir, { recursive: true });
  const input = resolve(dir, `${name}.scrml`);
  writeFileSync(input, source);
  try {
    // write: true so the emitted-artifact gate (§2.2.1) runs too.
    const result = compileScrml({ inputFiles: [input], write: true, outputDir: resolve(dir, "dist"), log: () => {} });
    const errors = (result.errors ?? []).filter((e) => !e.severity || e.severity === "error");
    const out = result.outputs?.get(input) ?? [...(result.outputs ?? new Map()).values()][0] ?? {};
    return { errors, clientJs: out.clientJs ?? "", serverJs: out.serverJs ?? "", html: out.html ?? "" };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function compileAndLoad(source, tag) {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
  GlobalRegistrator.register();
  const { errors, clientJs, html } = compileOne(source, tag);
  if (errors.length > 0) throw new Error(`compile errors: ${errors.map((e) => e.code + ": " + e.message).join(", ")}`);
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  document.body.innerHTML = (bodyMatch ? bodyMatch[1] : html).replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").trim();
  const code =
    `(function() {\n${SCRML_RUNTIME}\n` +
    // Exported through the alias: the program may bind \`window\` / \`globalThis\` itself.
    captureInsideChunkScope(clientJs, `_scrml_g._scrml_test_get = _scrml_reactive_get;\n`) +
    `\n})();`;
  // eslint-disable-next-line no-eval
  (0, eval)(code);
  document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
  return { clientJs, get: (n) => globalThis._scrml_test_get(n) };
}

/** Install a server-route fetch mock AFTER load: `_scrml_g.fetch` is read at each call. */
function mockServer(value) {
  const calls = [];
  globalThis.fetch = async (path) => {
    calls.push(String(path));
    return new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  return calls;
}

const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); };

// Every handler kind bumps @count by a distinct amount (a dead one shows as a
// wrong total), and a server call. `decl` is the user's binding named N.
const clientProgram = (decl, use) => `<program>
<count> = 0
<srv> = 0
<items> = [{ id: 1 }, { id: 2 }]

${decl}
function bump(amountQ) { @count = @count + ${use("amountQ")} }
server function getN() { return 5 }
function load() { @srv = getN() }

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
  <button id="b-srv" onclick=load()>srv</button>
  <p id="out">\${@count}</p>
  <p id="srv">\${@srv}</p>
</div>
</program>
`;

async function driveClient(source, tag) {
  const { clientJs, get } = await compileAndLoad(source, tag);
  const calls = mockServer(5);
  document.getElementById("b-callref").click();
  document.getElementById("b-inline").click();
  document.getElementById("b-closure").click();
  document.getElementById("f").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  document.getElementById("in").dispatchEvent(new Event("input", { bubbles: true }));
  document.querySelector(".row").click();
  document.getElementById("b-srv").click();
  await settle();
  return { clientJs, count: get("count"), srv: get("srv"), outText: document.getElementById("out").textContent, calls };
}

const ALL = [...HOST_GLOBAL_NAMES];

describe("§3 a user function named after a host global leaves every handler and the server call working (executed)", () => {
  test("the reported repro: `function fetch` — the server call goes to the host fetch, not the user's function", async () => {
    const r = await driveClient(clientProgram("function fetch(x) { return x }", (a) => `fetch(${a})`), "fetch");
    expect(r.clientJs).toContain("await _scrml_g.fetch(path, {");
    expect(r.calls.length).toBe(1);
    expect(r.calls[0]).toMatch(/^\/_scrml\/__ri_route_getN_/);
    expect(r.srv).toBe(5);
    expect(r.count).toBe(63);
  });

  test("the reported repro: `function document` — the click dispatcher still stops at the document", async () => {
    const r = await driveClient(clientProgram("function document(x) { return x }", (a) => `document(${a})`), "document");
    expect(r.clientJs).toContain("while (t && t !== _scrml_g.document) {");
    expect(r.clientJs).not.toMatch(/_scrml_document_\d+\)?\s*\{/);
    expect(r.count).toBe(63);
  });

  for (const n of ALL) {
    test(`function ${n}`, async () => {
      const r = await driveClient(clientProgram(`function ${n}(x) { return x }`, (a) => `${n}(${a})`), `fn-${n}`);
      expect({ n, count: r.count, out: r.outText, srv: r.srv, calls: r.calls.length })
        .toEqual({ n, count: 63, out: "63", srv: 5, calls: 1 });
    });
  }
});

describe("§3b a user top-level const named after a host global captures no compiler reference (executed)", () => {
  // `const eval` cannot be emitted at all (a strict-mode binding error, refused at the
  // emitted-artifact gate before and after this change); a `function eval` is mangled.
  for (const n of ALL.filter((x) => x !== "eval")) {
    test(`const ${n}`, async () => {
      const r = await driveClient(clientProgram(`const ${n} = 1`, (a) => `${a} * ${n}`), `const-${n}`);
      expect({ n, count: r.count, out: r.outText, srv: r.srv, calls: r.calls.length })
        .toEqual({ n, count: 63, out: "63", srv: 5, calls: 1 });
    });
  }
});

describe("§3c user code is untouched: an author's own global reference stays bare", () => {
  test("`document.title` and `Math.max` written by the author are emitted as written", () => {
    const { errors, clientJs } = compileOne(`<program>
<t> = ""
function grab() { @t = document.title + Math.max(1, 2) }
<div><button onclick=grab()>g</button><p>\${@t}</p></div>
</program>
`, "user");
    expect(errors).toEqual([]);
    expect(clientJs).toContain("document.title + Math.max(1, 2)");
    expect(clientJs).not.toContain("_scrml_g.document.title");
  });
});

// ---------------------------------------------------------------------------
// §4 — executed server
// ---------------------------------------------------------------------------

const serverProgram = (n) => `<program>
<v> = 0
server function ${n}(x) { return x }
server function getN() { return ${n}(5) }
function go() { @v = getN() }
<div><button onclick=go()>g</button><p>\${@v}</p></div>
</program>
`;

let modCounter = 0;
async function runGetN(serverJs, tag) {
  // A server route runs on Bun's own Request / Response, not happy-dom's.
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
  const dir = resolve(tmpdir(), `scrml-s457hga-srv-${tag}-${Date.now().toString(36)}-${++modCounter}`);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "app.server.js");
  writeFileSync(file, serverJs);
  try {
    const mod = await import(file + `?n=${modCounter}`);
    const route = mod.routes.find((r) => r.path.includes("_getN_"));
    const res = await route.handler(new Request("http://localhost" + route.path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: "scrml_csrf=t", "X-CSRF-Token": "t" },
      body: "{}",
    }));
    return { status: res.status, body: await res.text() };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("§4 a server function named after a host global (a module-scope peer callable) leaves the route working (executed)", () => {
  test("`globalThis` is a reserved server binding (E-CG-016): the alias reads it", () => {
    const { errors } = compileOne(serverProgram("globalThis"), "srv-globalThis");
    expect(errors.map((e) => e.code)).toContain("E-CG-016");
  });

  test("the reported shape: `server function Response` — the route still answers", async () => {
    const { errors, serverJs } = compileOne(serverProgram("Response"), "srv-Response");
    expect(errors).toEqual([]);
    expect(serverJs).toContain("async function Response(");
    expect(serverJs).toContain(HOST_GLOBAL_ALIAS_DECL);
    expect(await runGetN(serverJs, "Response")).toEqual({ status: 200, body: "5" });
  });

  // Every host global but the two reserved server bindings (`fetch` is the
  // WinterCG handler export; `globalThis` is read by the alias) and `eval`, which
  // cannot name a binding in a module at all (strict mode) — refused at the
  // emitted-artifact gate, before and after this change.
  test("`server function eval` is refused (a module cannot bind `eval`)", () => {
    const { errors } = compileOne(serverProgram("eval"), "srv-eval");
    expect(errors.map((e) => e.code)).toContain("E-CODEGEN-INVALID-LOGIC");
  });

  for (const n of ALL.filter((x) => x !== "fetch" && x !== "globalThis" && x !== "eval")) {
    test(`server function ${n}`, async () => {
      const { errors, serverJs } = compileOne(serverProgram(n), `srv-${n}`);
      expect(errors).toEqual([]);
      expect(unexplained(serverJs, serverProgram(n))).toEqual([]);
      expect({ n, ...(await runGetN(serverJs, n)) }).toEqual({ n, status: 200, body: "5" });
    });
  }
});

// happy-dom replaces Request / Response / fetch globally; leaving it registered
// breaks later files that run a server route in the same process.
afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});
