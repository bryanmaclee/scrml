/**
 * request-settle-state-peter-20.test.js — §6.7.7 `<request>` settled-state machine
 *
 * Peter #20 (GitHub #20, High): a body-form `<request id="R">${ @cell = serverFn() }</>`
 * exposed `<#R>.loading` / `.data` / `.error` / `.stale` per §6.7.7, but the emitted
 * client declared the `_scrml_request_R` state object and NEVER mutated it:
 *   - `.loading` stuck at initial `true` (never settled false);
 *   - `.error` always null even on HTTP 500 (so `if=<#R>.error` UI never rendered);
 *   - `.data` always null (the value went only to the assigned cell);
 *   - a non-2xx body was returned by the stub and written to the SUCCESS cell as if
 *     it were success data (a type violation / security-adjacent leak).
 * GITI-001 had deemed the request machinery "redundant" and emitted NONE — that
 * dropped the whole §6.7.7 settle machine.
 *
 * THE FIX (two seams):
 *   1. emit-client.ts post-server-fn-iife-wrap: when the reactive-assign target is
 *      a body-form `<request>` cell (reactive-deps.collectRequestBodyCells), emit
 *      the full loading/data/error/stale settle machine driving `_scrml_request_R`,
 *      not the plain cell-set IIFE.
 *   2. emit-functions.ts per-route stub: a non-2xx that is NOT a `{__scrml_error}`
 *      scrml-fail envelope THROWS (routes to `.error`), while a fail envelope stays
 *      a RETURNED value for the match/?/!{}/errorBoundary dispatch.
 *
 * Coverage:
 *   §A emit-shape — the settle machine + the stub ok-check + deps/refetch/cleanup.
 *   §B runtime — mount + stubbed fetch: 2xx success, raw non-2xx, `.stale` on
 *      re-fire via refetch(), and the non-2xx-as-success type violation closed.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

const tmpRoot = resolve(tmpdir(), "scrml-request-settle-peter-20");

function compile(src, baseName) {
  const tmpDir = resolve(tmpRoot, `c-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const tmpInput = resolve(tmpDir, `${baseName}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, src);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: false, outputDir: outDir });
    const out = result.outputs.get(tmpInput);
    return { errors: result.errors ?? [], clientJs: out ? out.clientJs : "", html: out ? out.html : "" };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

// A body-form <request> calling a server fn (escalates to a route via ?{}).
const REQ_SRC = `<program db="./app.db">
\${
    type User:struct = { id: number, name: string }
    <userData> : User | not = not
    function loadUser() : User | not {
        rows = ?{\`SELECT id, name FROM users LIMIT 1\`}
        return rows[0]
    }
}
<page>
    <request id="userReq">
        \${ @userData = loadUser() }
    </>
    <p id="loading">\${<#userReq>.loading}</>
    <div id="err" if=\${<#userReq>.error}>failed</>
    <p id="who" if=\${<#userReq>.data}>\${@userData?.name}</>
</page>
</program>
`;

// ---------------------------------------------------------------------------
// §A — emit shape
// ---------------------------------------------------------------------------

describe("§A: the §6.7.7 settle machine is emitted (state object is mutated)", () => {
  test("compiles clean", () => {
    const { errors } = compile(REQ_SRC, "req-emit");
    expect(errors).toEqual([]);
  });

  test("all four settled-state fields + refetch + mounted guard + seq are written", () => {
    const { clientJs } = compile(REQ_SRC, "req-emit-fields");
    // The state object is declared (hoisted) AND now MUTATED.
    expect(clientJs).toContain("var _scrml_request_userReq = _scrml_deep_reactive({ loading: true, data: null, error: null, stale: false });");
    expect(clientJs).toContain("async function _scrml_request_userReq_fetch()");
    expect(clientJs).toContain("_scrml_request_userReq.loading = true;");
    expect(clientJs).toContain("_scrml_request_userReq.error = null;");
    expect(clientJs).toContain("_scrml_request_userReq.loading = false;");
    expect(clientJs).toContain("_scrml_request_userReq.stale = false;");
    expect(clientJs).toContain("_scrml_request_userReq.data = _scrml_data;");
    expect(clientJs).toContain("_scrml_request_userReq.error = _scrml_e;");
    // stale: true only when prior data exists (a re-fire over existing data).
    expect(clientJs).toContain("if (_scrml_request_userReq.data !== null) { _scrml_request_userReq.stale = true; }");
    // refetch() is wired (§6.7.7 Properties) + a mounted-guard cleanup + seq guard.
    expect(clientJs).toContain("_scrml_request_userReq.refetch = _scrml_request_userReq_fetch;");
    expect(clientJs).toContain("var _scrml_request_userReq_seq = 0;");
    expect(clientJs).toContain("var _scrml_request_userReq_mounted = true;");
    expect(clientJs).toContain("_scrml_register_cleanup(function() { _scrml_request_userReq_mounted = false; });");
    expect(clientJs).toMatch(/if \(!_scrml_request_userReq_mounted \|\| _scrml_seq !== _scrml_request_userReq_seq\) return;/);
  });

  test("SUCCESS path sets the cell BEFORE .data and only inside the try (never on error)", () => {
    const { clientJs } = compile(REQ_SRC, "req-emit-order");
    // cell set precedes `.data` set (avoids a `<#R>.data`-gated cell-read window).
    expect(clientJs).toMatch(/_scrml_reactive_set\("userData", _scrml_data\);\s*\n\s*_scrml_request_userReq\.data = _scrml_data;/);
    // The cell-set does NOT appear in the catch arm (error must not write the cell).
    const catchArm = clientJs.slice(clientJs.indexOf("} catch (_scrml_e) {"));
    const catchBody = catchArm.slice(0, catchArm.indexOf("}\n  _scrml_request_userReq.loading = false;"));
    expect(catchBody).not.toContain('_scrml_reactive_set("userData"');
    expect(catchBody).toContain("_scrml_request_userReq.error = _scrml_e;");
  });

  test("emitted client parses as valid JS", () => {
    const { clientJs } = compile(REQ_SRC, "req-emit-parse");
    const stripped = clientJs.replace(/^\s*(import|\/\/ Requires)\s[^;\n]*;?/gm, "");
    expect(() => new Function(stripped)).not.toThrow();
  });
});

describe("§A: the per-route stub surfaces a non-2xx (non-envelope) as a rejection", () => {
  test("ok-check throws on a non-2xx that is NOT a {__scrml_error} envelope", () => {
    const { clientJs } = compile(REQ_SRC, "req-stub-okcheck");
    // §19.9.2 — a non-2xx WITHOUT the scrml fail envelope throws (routes to .error).
    expect(clientJs).toContain('if (!_scrml_resp.ok && !(_scrml_body_json !== null && typeof _scrml_body_json === "object" && _scrml_body_json.__scrml_error === true)) {');
    expect(clientJs).toContain('throw new Error("HTTP " + _scrml_resp.status);');
    // A scrml-fail envelope (HTTP 500) is NOT thrown — it is a returned value.
    expect(clientJs).toContain("return _scrml_body_json;");
  });
});

describe("§A: deps drive a reactive re-fetch effect (§6.7.7 re-execution)", () => {
  const DEPS_SRC = `<program db="./app.db">
\${
    type User:struct = { id: number, name: string }
    <userId> = 1
    <userData> : User | not = not
    function loadUser(id: number) : User | not {
        rows = ?{\`SELECT id, name FROM users WHERE id = 1\`}
        return rows[0]
    }
}
<page>
    <request id="userReq">
        \${ @userData = loadUser(@userId) }
    </>
    <p>\${<#userReq>.loading}</>
</page>
</program>
`;

  test("an inferred `@userId` dep wraps the fetch in a reactive effect", () => {
    const { errors, clientJs } = compile(DEPS_SRC, "req-deps-inferred");
    expect(errors).toEqual([]);
    expect(clientJs).toContain("_scrml_effect(function() {");
    expect(clientJs).toContain('_scrml_reactive_get("userId")');
    expect(clientJs).toContain("if (_scrml_request_userReq_mounted) _scrml_request_userReq_fetch();");
  });

  test("a no-dep request fires the fetch once on mount (bare call, no effect wrap)", () => {
    const { clientJs } = compile(REQ_SRC, "req-nodep");
    // The no-dep form ends with a bare `_scrml_request_userReq_fetch();` mount call.
    expect(clientJs).toMatch(/_scrml_register_cleanup\(function\(\) \{ _scrml_request_userReq_mounted = false; \}\);\s*\n_scrml_request_userReq_fetch\(\);/);
  });
});

// ---------------------------------------------------------------------------
// §B — runtime (mount + stubbed fetch)
// ---------------------------------------------------------------------------

beforeEach(async () => {
  try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
  GlobalRegistrator.register();
});
afterEach(async () => {
  try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing to do */ }
});

const tick = () => new Promise((res) => setTimeout(res, 0));

// Compile REQ_SRC, mount, and eval runtime+client with a controllable `fetch`.
// `respond` is a mutable function () => { ok, status, body } consulted per call.
function mountWithFetch(src, baseName, respond) {
  const tmpDir = resolve(tmpRoot, `m-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const tmpInput = resolve(tmpDir, `${baseName}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, src);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir });
    const html = readFileSync(resolve(outDir, `${baseName}.html`), "utf8");
    const clientJs = readFileSync(resolve(outDir, `${baseName}.client.js`), "utf8");
    const runtimeJs = readFileSync(resolve(outDir, result.runtimeFilename ?? "scrml-runtime.js"), "utf8");
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    const bodyHtml = bodyMatch ? bodyMatch[1] : html;
    document.body.innerHTML = bodyHtml.replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").trim();
    const fetchStub = async () => {
      const r = respond();
      return {
        ok: r.ok,
        status: r.status,
        json: async () => r.body,
      };
    };
    const exec = new Function(
      "window", "document", "fetch",
      `${runtimeJs}\n${clientJs}\n` +
      `if (typeof _scrml_run_dom_ready === "function") { _scrml_run_dom_ready(); }\n` +
      `globalThis.__req__ = _scrml_request_userReq;\n` +
      `globalThis.__get__ = _scrml_reactive_get;\n`,
    );
    exec(window, document, fetchStub);
    return { errors: result.errors ?? [], req: globalThis.__req__, get: globalThis.__get__ };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("§B: 2xx success — loading settles, data + cell populate, error stays absent", () => {
  test("the state machine settles the success end-state", async () => {
    const { req, get } = mountWithFetch(
      REQ_SRC, "rt-success",
      () => ({ ok: true, status: 200, body: { id: 7, name: "Ada" } }),
    );
    expect(req).toBeTruthy();
    await tick();
    await tick();
    expect(req.loading).toBe(false);          // was STUCK true pre-fix
    expect(req.error).toBe(null);
    expect(req.stale).toBe(false);
    expect(req.data).toEqual({ id: 7, name: "Ada" });   // was always null pre-fix
    expect(get("userData")).toEqual({ id: 7, name: "Ada" }); // cell hydrated from .data
  });
});

describe("§B: raw non-2xx — the type violation is CLOSED", () => {
  test("a 500 routes to .error and does NOT write the success cell", async () => {
    const { req, get } = mountWithFetch(
      REQ_SRC, "rt-error",
      () => ({ ok: false, status: 500, body: { error: "Internal server error", detail: "boom" } }),
    );
    await tick();
    await tick();
    expect(req.loading).toBe(false);          // was STUCK true pre-fix
    expect(req.error).toBeTruthy();           // was always null pre-fix (if=error never rendered)
    expect(req.stale).toBe(false);
    // §6.7.7 failure: .data retains prior (not / null on first mount) — NOT the 500 body.
    expect(req.data).toBe(null);
    // THE TYPE VIOLATION: the parsed error body must NOT land in the success cell.
    expect(get("userData")).toBe(null);
    expect(get("userData")).not.toEqual({ error: "Internal server error", detail: "boom" });
  });
});

describe("§B: .stale on re-fire (refetch over existing data)", () => {
  test("refetch() with prior data sets .stale true in-flight, false on settle", async () => {
    let gate = null;
    const first = { ok: true, status: 200, body: { id: 1, name: "one" } };
    // First settle resolves immediately; the second is held open on `gate`.
    let call = 0;
    const { req } = mountWithFetch(
      REQ_SRC, "rt-stale",
      () => {
        call++;
        return call === 1 ? first : { ok: true, status: 200, body: { id: 2, name: "two" }, __hold: true };
      },
    );
    await tick();
    await tick();
    expect(req.data).toEqual({ id: 1, name: "one" });
    expect(req.stale).toBe(false);
    // Re-fire: prior data exists, so .stale flips true while the new fetch is in flight.
    const p = req.refetch();
    // Synchronously after refetch() begins, before the awaited stub resolves:
    expect(req.stale).toBe(true);
    expect(req.loading).toBe(true);
    await p;
    await tick();
    // Settled: new data, stale back to false.
    expect(req.data).toEqual({ id: 2, name: "two" });
    expect(req.stale).toBe(false);
    expect(req.loading).toBe(false);
  });
});
