/**
 * request-body-client-wrapper-s444.test.js — a `<request>` body that calls a CLIENT function
 * which reaches a server function gets the §6.7.7 settle machine.
 *
 * g-request-body-client-wrapper-unawaited-one-shot (S444, HIGH). `function wrap(q) { return
 * suggest(q) }` (suggest: a server fn) is emitted `async` by the client async coloring, but the
 * emit-client `post-server-fn-iife-wrap` pass — the only place the body-form settle machine is
 * built — matched only `_scrml_fetch_*` / `_scrml_cps_*` stub callees. So
 * `<request id="hunt">${ @hits = wrap(@q) }</>` emitted a module-init
 * `_scrml_reactive_set("hits", _scrml_wrap_8(…))`: a PROMISE in the cell, no fetch fn, no seq,
 * no dep effect, and `<#hunt>.loading` stuck `true`. The same pass also left a plain
 * module-init `<hits> = wrap("ab")` holding a Promise.
 *
 * The fix keys the pass on the same async coloring (`clientAsyncFactsOf`), so any
 * async-colored callee is the fetch. SPEC §6.7.7 ("The `<request>` body calls a server
 * function", EC-2 sequence number SHALL) and §13.2 (the author writes no asynchrony).
 *
 * Coverage: §A emission · §B runtime (settle + dep re-fire + non-request decl).
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";
import { hostView, rebindHostAlias } from "../helpers/host-view.js";

const tmpRoot = resolve(tmpdir(), "scrml-request-wrapper-s444");

function compile(src, baseName) {
  const tmpDir = resolve(tmpRoot, `c-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const tmpInput = resolve(tmpDir, `${baseName}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, src);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: false, outputDir: outDir });
    const out = result.outputs.get(tmpInput);
    const fatal = (result.errors ?? []).filter((e) => e.severity !== "warning" && e.severity !== "info" && !/^[WI]-/.test(e.code ?? ""));
    return { fatal, clientJs: out ? out.clientJs : "" };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

function src({ body, extraFns = "", declInit = "not" }) {
  return `<program db="./app.db">
\${
    type User:struct = { id: number, name: string }
    <userId> = 1
    <userData> : User | not = ${declInit}
    function loadUser(id: number) : User | not {
        rows = ?{\`SELECT id, name FROM users WHERE id = \${id}\`}
        return rows[0]
    }
    function wrap(id: number) : User | not {
        return loadUser(id)
    }
${extraFns}
}
<page>
${body}
    <p id="who">\${@userData?.name}</>
</page>
</program>
`;
}

const WRAP_SRC = src({ body: `    <request id="userReq">\n        \${ @userData = wrap(@userId) }\n    </>\n    <p id="loading">\${<#userReq>.loading}</>` });
const CHAIN_SRC = src({
  extraFns: "    function outer(id: number) : User | not {\n        return wrap(id)\n    }",
  body: `    <request id="userReq">\n        \${ @userData = outer(@userId) }\n    </>\n    <p id="loading">\${<#userReq>.loading}</>`,
});
const DECL_SRC = src({ declInit: "wrap(1)", body: "" });

describe("§A: emission", () => {
  test("a client-wrapper body gets the full settle machine, awaiting the wrapper", () => {
    const { fatal, clientJs } = compile(WRAP_SRC, "wrap");
    expect(fatal).toEqual([]);
    expect(clientJs).toMatch(/async function _scrml_wrap_\d+\(id\)/);
    expect(clientJs).toContain("async function _scrml_request_userReq_fetch()");
    expect(clientJs).toContain("var _scrml_request_userReq_seq = 0;");
    expect(clientJs).toMatch(/var _scrml_data = await _scrml_wrap_\d+\(_scrml_cs_reactive_get\("userId"\)\);/);
    expect(clientJs).toContain("_scrml_request_userReq.data = _scrml_data;");
    expect(clientJs).toContain('var _scrml_deps = [_scrml_cs_reactive_get("userId")];');
    // The Promise-into-cell shape is gone.
    expect(clientJs).not.toMatch(/_scrml_cs_reactive_set\("userData", _scrml_wrap_\d+\(/);
  });

  test("a transitive chain (outer -> wrap -> server fn) is the fetch too", () => {
    const { fatal, clientJs } = compile(CHAIN_SRC, "chain");
    expect(fatal).toEqual([]);
    expect(clientJs).toMatch(/var _scrml_data = await _scrml_outer_\d+\(_scrml_cs_reactive_get\("userId"\)\);/);
    expect(clientJs).not.toMatch(/_scrml_cs_reactive_set\("userData", _scrml_outer_\d+\(/);
  });

  test("a non-request module-init decl over a client wrapper is awaited, not a Promise", () => {
    const { fatal, clientJs } = compile(DECL_SRC, "decl");
    expect(fatal).toEqual([]);
    expect(clientJs).toMatch(/\(async \(\) => _scrml_cs_reactive_set\("userData", await _scrml_wrap_\d+\(1\)\)\)\(\)\.catch\(/);
  });

  test("a direct server-fn body is unchanged (control)", () => {
    const direct = src({ body: `    <request id="userReq">\n        \${ @userData = loadUser(@userId) }\n    </>` });
    const { clientJs } = compile(direct, "direct");
    expect(clientJs).toMatch(/var _scrml_data = await _scrml_fetch_loadUser_\d+\(_scrml_cs_reactive_get\("userId"\)\);/);
  });
});

// ---------------------------------------------------------------------------
// §B — runtime
// ---------------------------------------------------------------------------

beforeEach(async () => {
  try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
  GlobalRegistrator.register();
});
afterEach(async () => {
  try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing to do */ }
});

const tick = () => new Promise((res) => setTimeout(res, 0));
async function settle() { for (let i = 0; i < 6; i++) await tick(); }

function mount(source, baseName, withRequest) {
  const tmpDir = resolve(tmpRoot, `m-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const tmpInput = resolve(tmpDir, `${baseName}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  const calls = [];
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir });
    const html = readFileSync(resolve(outDir, `${baseName}.html`), "utf8");
    const clientJs = readFileSync(resolve(outDir, `${baseName}.client.js`), "utf8");
    const runtimeJs = readFileSync(resolve(outDir, result.runtimeFilename ?? "scrml-runtime.js"), "utf8");
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    document.body.innerHTML = (bodyMatch ? bodyMatch[1] : html).replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").trim();
    const fetchStub = async (url, init) => {
      calls.push(url);
      if (calls.length > 20) return new Promise(() => {});
      const n = calls.length;
      return { ok: true, status: 200, json: async () => ({ id: n, name: "u" + n }) };
    };
    const exec = new Function(
      "window", "document", "fetch", "__scrml_host__",
      `${rebindHostAlias(runtimeJs)}\n` + captureInsideChunkScope(clientJs,
        `if (typeof _scrml_run_dom_ready === "function") { _scrml_run_dom_ready(); }\n` +
        (withRequest ? `globalThis.__req__ = _scrml_request_userReq;\n` : `globalThis.__req__ = null;\n`) +
        `globalThis.__get__ = _scrml_reactive_get;\n` +
        `globalThis.__set__ = _scrml_reactive_set;\n`),
    );
    // The emitted code reaches host globals through the alias `_scrml_g` (S457 2a): the
    // stubs reach it through a view of the global object, not by shadowing.
    exec(window, document, fetchStub, hostView({ window, document, fetch: fetchStub }));
    return { req: globalThis.__req__, get: globalThis.__get__, set: globalThis.__set__, calls };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("§B: runtime", () => {
  test("mount settles: loading false, .data + cell hold the VALUE (not a Promise)", async () => {
    const { req, get, calls } = mount(WRAP_SRC, "rt-wrap", true);
    await settle();
    expect(calls.length).toBe(1);
    expect(req.loading).toBe(false);             // was stuck true
    expect(req.data).toEqual({ id: 1, name: "u1" });
    const cell = get("userData");
    expect(cell && typeof cell.then).not.toBe("function");
    expect(cell).toEqual({ id: 1, name: "u1" });
  });

  test("the inferred @userId dep re-fires the wrapper fetch", async () => {
    const { req, set, calls } = mount(WRAP_SRC, "rt-wrap-dep", true);
    await settle();
    set("userId", 2);
    await settle();
    expect(calls.length).toBe(2);
    expect(req.data).toEqual({ id: 2, name: "u2" });
    expect(req.loading).toBe(false);
  });

  test("a non-request decl over a client wrapper settles to the value", async () => {
    const { get } = mount(DECL_SRC, "rt-decl", false);
    await settle();
    const cell = get("userData");
    expect(cell && typeof cell.then).not.toBe("function");
    expect(cell).toEqual({ id: 1, name: "u1" });
  });
});
