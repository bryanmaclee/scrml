/**
 * s468-trigger5-helper-route — a server function that only server code calls is
 * not a public route.
 *
 * SPEC §13.4: "The callee SHALL NOT generate an additional HTTP route when called
 * from a server-escalated caller." … "If function A (server-escalated) calls
 * function B (server-escalated), and function B is also referenced from client
 * code, the compiler SHALL generate TWO representations of B: one inlined version
 * (used by A's server handler) and one fetch-based route handler (used by client
 * call sites of B)." §12.2 Trigger 5 places such a helper on the server.
 *
 * BEFORE (5c43c3b8e): `function helper(n) { return n * 2 }` called only by a
 * server function got its own `__ri_route_helper_*` route, a client fetch stub,
 * and `POST /_scrml/__ri_route_helper_1 {"n":5}` answered `200 10` — any client
 * could call the helper directly, with any arguments, skipping the caller.
 *
 * AFTER: such a function keeps only its in-process peer callable. A function that
 * client code also references (a call, a first-class value, markup), an exported
 * one, an explicit `server` / `route=` one, an SSE generator, and a CPS-split one
 * keep their route.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname, join } from "path";
import { writeFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { Database } from "bun:sqlite";
import { compileScrml } from "../../src/api.js";
import { perRunTmp } from "../helpers/per-run-tmp.js";
import { patchAndImport, closeOpenedDbHandles } from "../helpers/self-host-server-import.js";

const testDir = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(testDir, "../../src/cli.js");
const _tmp = perRunTmp(resolve(testDir, "_tmp_s468_trigger5_helper_route"));
const TMP_ROOT = _tmp.root;
const EXECUTED_TIMEOUT_MS = 60_000;
const HAPPY_DOM = () => typeof globalThis.document !== "undefined";
let counter = 0;

beforeAll(_tmp.setup);
afterAll(async () => { await closeOpenedDbHandles(); _tmp.teardown(); });

/** Compile `files` (name → source) in a fresh directory; `entry` is the main file. */
function compileFiles(files, entry, label) {
  const dir = resolve(TMP_ROOT, `${label}-${++counter}`);
  const out = resolve(dir, "dist");
  mkdirSync(out, { recursive: true });
  for (const [name, src] of Object.entries(files)) writeFileSync(resolve(dir, name), src);
  const db = new Database(resolve(dir, "x.db"), { create: true });
  db.exec("CREATE TABLE IF NOT EXISTS t (v INTEGER)");
  db.close();
  const inputFiles = Object.keys(files).map((n) => resolve(dir, n));
  const result = compileScrml({ inputFiles, write: true, outputDir: out, log: () => {} });
  const errors = (result.errors ?? []).filter((e) => e.severity == null || e.severity === "error");
  const base = entry.replace(/\.scrml$/, "");
  const read = (ext) => {
    const p = join(out, `${base}.${ext}.js`);
    return existsSync(p) ? readFileSync(p, "utf-8") : "";
  };
  return { errors, dir, out, client: read("client"), server: read("server"), serverJsPath: join(out, `${base}.server.js`) };
}
const compile = (src, label) => compileFiles({ "app.scrml": src }, "app.scrml", label);

/** The function names that own a route in an emitted module (`__ri_route_<name>_<n>`). */
const routesOf = (js) =>
  [...new Set((js.match(/__ri_route_[A-Za-z0-9_]+?(?=_\d+\b)/g) ?? []).map((r) => r.slice("__ri_route_".length)))].sort();

const prog = (logic, markup = `<button onclick=go()>s</button>`) => `<program db="./x.db">
\${
${logic}
}
<n> = 3
${markup}
</program>
`;

const REPRO = prog(`  function helper(n: int) -> int { return n * 2 }
  function save(n: int) {
    ?{\`INSERT INTO t (v) VALUES (\${n})\`}.run()
    const r = helper(n)
    return r
  }
  function go() { save(@n) }`);

const TOKEN = "s468-csrf";
const POST_HEADERS = { "Content-Type": "application/json", "X-CSRF-Token": TOKEN, "Cookie": `scrml_csrf=${TOKEN}` };

describe("s468 — a helper only server code calls (the gap reproducer)", () => {
  test("has no route and no client fetch stub; its in-process peer is emitted", () => {
    const { errors, client, server } = compile(REPRO, "repro");
    expect(errors).toEqual([]);
    expect(routesOf(server)).toEqual(["save"]);
    expect(routesOf(client)).toEqual(["save"]);
    expect(client).not.toMatch(/_scrml_fetch_helper/);
    expect(server).toMatch(/^async function helper\(n\) \{/m);
    expect(server).toContain("await helper(n)");
  });

  test("runtime (module): `routes` has no helper path; save answers 200 10", async () => {
    if (HAPPY_DOM()) return;
    const { errors, dir, serverJsPath } = compile(REPRO, "repro-mod");
    expect(errors).toEqual([]);
    const mod = await patchAndImport(serverJsPath, resolve(dir, "x.db"));
    const paths = mod.routes.map((r) => String(r.path));
    expect(paths.some((p) => p.includes("helper"))).toBe(false);
    const save = mod.routes.find((r) => String(r.path).includes("save"));
    const resp = await save.handler(new Request(`http://localhost${save.path}`, {
      method: "POST", headers: POST_HEADERS, body: JSON.stringify({ n: 5 }),
    }));
    expect(resp.status).toBe(200);
    expect(await resp.json()).toBe(10);
    // The module's own dispatcher does not answer the old helper path.
    expect(await mod.fetch(new Request("http://localhost/_scrml/__ri_route_helper_1", {
      method: "POST", headers: POST_HEADERS, body: JSON.stringify({ n: 5 }),
    }))).toBeNull();
  }, EXECUTED_TIMEOUT_MS);

  test("runtime (production server): POST to the helper path is 404, save is 200", async () => {
    if (HAPPY_DOM()) return;
    const dir = resolve(TMP_ROOT, `prod-${++counter}`);
    const src = join(dir, "src");
    const dist = join(dir, "dist");
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, "app.scrml"), REPRO);
    const db = new Database(join(src, "x.db"), { create: true });
    db.exec("CREATE TABLE t (v INTEGER)");
    db.close();
    const b = Bun.spawnSync(["bun", CLI, "build", src, "-o", dist], { stdout: "pipe", stderr: "pipe" });
    expect(b.exitCode).toBe(0);
    const serverJs = readFileSync(join(dist, "app.server.js"), "utf-8");
    expect(routesOf(serverJs)).toEqual(["save"]);
    const savePath = serverJs.match(/path: "(\/_scrml\/__ri_route_save_\d+)"/)[1];

    const probe = Bun.serve({ port: 0, fetch: () => new Response("") });
    const port = probe.port;
    probe.stop(true);
    const proc = Bun.spawn(["bun", "_server.js"], {
      cwd: dist, env: { ...process.env, PORT: String(port) }, stdout: "pipe", stderr: "pipe",
    });
    try {
      let out = "";
      const pump = async (s) => { for await (const c of s) out += new TextDecoder().decode(c); };
      pump(proc.stdout); pump(proc.stderr);
      const t0 = Date.now();
      while (!/scrml server listening/.test(out)) {
        if (Date.now() - t0 > 25_000) throw new Error(`_server.js did not come up:\n${out}`);
        await Bun.sleep(25);
      }
      const post = (p) => fetch(`http://127.0.0.1:${port}${p}`, {
        method: "POST", headers: POST_HEADERS, body: JSON.stringify({ n: 5 }),
      });
      const helperResp = await post("/_scrml/__ri_route_helper_1");
      expect(helperResp.status).toBe(404);
      const saveResp = await post(savePath);
      expect(saveResp.status).toBe(200);
      expect(await saveResp.json()).toBe(10);
    } finally {
      proc.kill();
      await proc.exited;
    }
  }, EXECUTED_TIMEOUT_MS);
});

describe("s468 — functions that keep their route", () => {
  test("a server helper ALSO called from client code keeps its route and stub (§13.4 two representations)", () => {
    const { errors, client, server } = compile(prog(`  function insertRow(v: int) { ?{\`INSERT INTO t (v) VALUES (\${v})\`}.run() }
  function save(n: int) {
    ?{\`INSERT INTO t (v) VALUES (\${n})\`}.run()
    insertRow(n + 1)
    return n
  }
  function go() { save(@n) }
  function direct() { insertRow(@n) }`, `<button onclick=go()>s</button><button onclick=direct()>d</button>`), "client-also");
    expect(errors).toEqual([]);
    expect(routesOf(server)).toEqual(["insertRow", "save"]);
    expect(client).toMatch(/_scrml_fetch_insertRow_\d+/);
    // …and the server caller still uses the in-process peer, not the route.
    expect(server).toMatch(/^async function insertRow\(v\) \{/m);
  });

  test("a helper called from client MARKUP keeps its route", () => {
    const { errors, server } = compile(prog(`  function helper(n: int) -> int { return n * 2 }
  function save(n: int) {
    ?{\`INSERT INTO t (v) VALUES (\${n})\`}.run()
    return helper(n)
  }
  function go() { save(@n) }`, `<button onclick=go()>s</button><button onclick=helper(@n)>h</button>`), "markup");
    expect(errors).toEqual([]);
    expect(routesOf(server)).toEqual(["helper", "save"]);
  });

  test("a helper a CLIENT function references as a first-class value keeps its route", () => {
    const { errors, client, server } = compile(prog(`  function helper(n: int) -> int { return n * 2 }
  function save(n: int) {
    ?{\`INSERT INTO t (v) VALUES (\${n})\`}.run()
    return helper(n)
  }
  function go() { save(@n) }
  function pick() { @n = [@n].map(helper)[0] }`, `<button onclick=go()>s</button><button onclick=pick()>p</button>`), "client-value");
    expect(errors).toEqual([]);
    expect(routesOf(server)).toContain("helper");
    expect(client).toMatch(/_scrml_fetch_helper_\d+/);
  });

  test("an exported helper keeps its route (another file's client code may call it)", () => {
    const { errors, server } = compile(prog(`  export function helper(n: int) -> int { return n * 2 }
  function save(n: int) {
    ?{\`INSERT INTO t (v) VALUES (\${n})\`}.run()
    return helper(n)
  }
  function go() { save(@n) }`), "exported");
    expect(errors).toEqual([]);
    expect(routesOf(server)).toContain("helper");
  });

  test("an explicitly `server`-annotated helper keeps its route", () => {
    const { errors, server } = compile(prog(`  server function helper(n: int) -> int { return n * 2 }
  function save(n: int) {
    ?{\`INSERT INTO t (v) VALUES (\${n})\`}.run()
    return helper(n)
  }
  function go() { save(@n) }`), "explicit-server");
    expect(errors).toEqual([]);
    expect(routesOf(server)).toEqual(["helper", "save"]);
  });

  test("a helper with a destructuring parameter keeps its route (and its refusal)", () => {
    // The peer callable does not lower a pattern parameter; the route handler's
    // output is what refuses the program today. Suppressing the route would
    // silently accept a helper whose bindings are dropped (`ok is not defined`).
    const { errors } = compile(prog(`  function g({ ok = 1 }) { return ok }
  function save(n: int) {
    ?{\`INSERT INTO t (v) VALUES (\${n})\`}.run()
    return g({})
  }
  function go() { save(@n) }`), "pattern-param");
    expect(errors.map((e) => e.code)).toContain("E-CODEGEN-INVALID-LOGIC");
  });

  test("a function no server code calls keeps its route", () => {
    const { errors, server } = compile(prog(`  function save(n: int) {
    ?{\`INSERT INTO t (v) VALUES (\${n})\`}.run()
    return n
  }
  function go() { save(@n) }`), "client-called");
    expect(errors).toEqual([]);
    expect(routesOf(server)).toEqual(["save"]);
  });
});

describe("s468 — the same rule for every server helper, not only Trigger 5", () => {
  test("a helper with its own `?{}` that only server code calls has no route; the write still happens", async () => {
    const SRC = prog(`  function insertRow(v: int) { ?{\`INSERT INTO t (v) VALUES (\${v})\`}.run() }
  function save(n: int) {
    ?{\`INSERT INTO t (v) VALUES (\${n})\`}.run()
    insertRow(n + 1)
    return n
  }
  function go() { save(@n) }`);
    const { errors, client, server, dir, serverJsPath } = compile(SRC, "sql-helper");
    expect(errors).toEqual([]);
    expect(routesOf(server)).toEqual(["save"]);
    expect(client).not.toMatch(/_scrml_fetch_insertRow/);
    if (HAPPY_DOM()) return;
    const mod = await patchAndImport(serverJsPath, resolve(dir, "x.db"));
    const save = mod.routes.find((r) => String(r.path).includes("save"));
    const resp = await save.handler(new Request(`http://localhost${save.path}`, {
      method: "POST", headers: POST_HEADERS, body: JSON.stringify({ n: 7 }),
    }));
    expect(resp.status).toBe(200);
    const db = new Database(resolve(dir, "x.db"));
    const rows = db.query("SELECT v FROM t ORDER BY v").all().map((r) => r.v);
    db.close();
    expect(rows).toEqual([7, 8]);
  }, EXECUTED_TIMEOUT_MS);

  test("a chain of helpers (save → a → b) has one route, save", () => {
    const { errors, client, server } = compile(prog(`  function b(n: int) -> int { return n + 1 }
  function a(n: int) -> int { return b(n) * 2 }
  function save(n: int) {
    ?{\`INSERT INTO t (v) VALUES (\${n})\`}.run()
    return a(n)
  }
  function go() { save(@n) }`), "chain");
    expect(errors).toEqual([]);
    expect(routesOf(server)).toEqual(["save"]);
    expect(client).not.toMatch(/_scrml_fetch_(a|b)_\d+/);
    expect(server).toMatch(/^async function a\(n\) \{/m);
    expect(server).toMatch(/^async function b\(n\) \{/m);
  });

  test("a helper reached only through a first-class reference in server code has no route", () => {
    const { errors, server } = compile(prog(`  function helper(n: int) -> int { return n * 2 }
  function save(n: int) {
    ?{\`INSERT INTO t (v) VALUES (\${n})\`}.run()
    const p = helper
    return p(n)
  }
  function go() { save(@n) }`), "server-value");
    expect(errors).toEqual([]);
    expect(routesOf(server)).toEqual(["save"]);
    expect(server).toMatch(/^async function helper\(n\) \{/m);
  });

  test("a helper a CPS-split function calls in its SERVER statements has no route (the client wrapper calls only the batch)", async () => {
    const SRC = prog(`  function helper(n: int) -> int { return n * 2 }
  function go() {
    ?{\`INSERT INTO t (v) VALUES (\${@n})\`}.run()
    const r = helper(@n)
    @n = r
  }`);
    const { errors, client, server, dir, serverJsPath } = compile(SRC, "cps");
    expect(errors).toEqual([]);
    expect(routesOf(server)).toEqual(["go"]);
    expect(client).not.toMatch(/\bhelper\b(?! \(compiler)|_scrml_fetch_helper/);
    expect(server).toMatch(/^async function helper\(n\) \{/m);
    if (HAPPY_DOM()) return;
    const mod = await patchAndImport(serverJsPath, resolve(dir, "x.db"));
    const go = mod.routes.find((r) => String(r.path).includes("go"));
    const resp = await go.handler(new Request(`http://localhost${go.path}`, {
      method: "POST", headers: POST_HEADERS, body: JSON.stringify({ n: 4 }),
    }));
    expect(resp.status).toBe(200);
  }, EXECUTED_TIMEOUT_MS);

  test("a comment naming the helper does not keep its route", () => {
    const { errors, server } = compile(`// helper is server-only\n` + REPRO, "comment");
    expect(errors).toEqual([]);
    expect(routesOf(server)).toEqual(["save"]);
  });
});
