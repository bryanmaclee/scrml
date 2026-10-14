/**
 * s466 — a server-placed function keeps its parameter defaults.
 *
 * SPEC §7.3.2: "When a parameter with a default is omitted at the call site, the
 * default value expression is evaluated at call time. Default values are
 * arbitrary expressions and may reference earlier parameters in the same
 * parameter list." §6.6.9 "Every read position counts (S464)": a client-cell read
 * "in a parameter default of the wholly server-escalated function is the same
 * not-transported read and SHALL be E-REACTIVE-003".
 *
 * BEFORE (gap g-server-function-param-default-calling-fn-returns-null-s464): the
 * route handler bound `const k = _scrml_body["k"]` and the in-process callable was
 * emitted `async function g(m, k)`, so `server fn g(m, k = "zz")` called as
 * `g("x")` answered `null`-ish (in process and over HTTP); the CPS client wrapper
 * and the SSE / `onserver:*` handlers dropped defaults the same way; and a
 * default calling an `@`-reading fn (`k = rd()`) was not a call edge, so `rd`
 * met no E-REACTIVE-003.
 *
 * AFTER: one lowering (`emitParamDefault`, emit-logic.ts; `serverParamDefaults`,
 * emit-server.ts) feeds every site. Over HTTP the default applies when the
 * argument's key is MISSING (an omitted argument — JSON drops it); a passed `not`
 * is a present `null` and stays `not`.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname, join } from "path";
import { writeFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { Database } from "bun:sqlite";
import { compileScrml } from "../../src/api.js";
import { patchAndImport, closeOpenedDbHandles, safeRmSync } from "../helpers/self-host-server-import.js";

const EXECUTED_TIMEOUT_MS = 30_000;
const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
const TMP_ROOT = resolve(testDir, "_tmp_s466_server_param_defaults");
let tmpCounter = 0;

beforeAll(() => { if (!existsSync(TMP_ROOT)) mkdirSync(TMP_ROOT, { recursive: true }); });
afterAll(async () => { await closeOpenedDbHandles(); safeRmSync(TMP_ROOT); });

// happy-dom-polluted globals strip the CSRF headers (see server-fn-calls-server-fn).
// The emitted-shape assertions still run there; the live round-trips skip.
const HAPPY_DOM = () => typeof globalThis.document !== "undefined";

function compileFiles(files, entry, name, seedFiles = {}) {
  const tag = `${name}-${++tmpCounter}`;
  const tmpDir = resolve(TMP_ROOT, tag);
  for (const [f, txt] of Object.entries(files)) {
    mkdirSync(dirname(join(tmpDir, f)), { recursive: true });
    writeFileSync(join(tmpDir, f), txt);
  }
  for (const [fileName, stmts] of Object.entries(seedFiles)) {
    const db = new Database(resolve(tmpDir, fileName), { create: true });
    for (const stmt of stmts) db.exec(stmt);
    db.close();
  }
  const outDir = join(tmpDir, "dist");
  const result = compileScrml({ inputFiles: [join(tmpDir, entry)], write: true, outputDir: outDir, log: () => {} });
  const errors = (result.errors ?? []).filter((e) => e.severity == null || e.severity === "error");
  const read = (base, ext) => {
    const p = join(outDir, `${base}.${ext}.js`);
    return existsSync(p) ? readFileSync(p, "utf-8") : "";
  };
  return { errors, outDir, tmpDir, read };
}

async function callRoute(serverJsPath, dbPath, routeName, body) {
  const mod = await patchAndImport(serverJsPath, dbPath);
  const route = Object.values(mod).find(
    (v) => v && typeof v === "object" && typeof v.path === "string" && v.path.includes(`__ri_route_${routeName}_`),
  );
  expect(route).toBeDefined();
  const TOKEN = "s466-csrf";
  const resp = await route.handler(new Request(`http://localhost${route.path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": TOKEN, "Cookie": `scrml_csrf=${TOKEN}` },
    body: JSON.stringify(body),
  }));
  return { status: resp.status, json: await resp.json() };
}

const prog = (decls, handler = "go()") => `<program db="./x.db">
\${
${decls}
}
<out> = ""
<button onclick=\${@out = ${handler}}>go</button>
<p>\${@out}</p>
</program>
`;

// ---------------------------------------------------------------------------
// The PA repro: a literal default on a `server fn`.
// ---------------------------------------------------------------------------

const LITERAL = prog(`  server fn g(m: string, k: string | not = "zz") -> string {
    if (k is not) { return "was-not" }
    return k + m
  }
  server fn viaPeer(m: string) -> string { return g(m) }
  function go() { return g("x") }`);

describe("s466 — a `server fn` literal default", () => {
  test("the route handler binds the default for a missing key; the peer callable keeps it", () => {
    const { errors, read } = compileFiles({ "app.scrml": LITERAL }, "app.scrml", "literal-shape");
    expect(errors).toEqual([]);
    const server = read("app", "server");
    expect(server).toContain(`const k = _scrml_g.Object.hasOwn(_scrml_body, "k") ? _scrml_body["k"] : ("zz");`);
    expect(server).toMatch(/async function g\(m, k = "zz"\) \{/);
    // A parameter without a default keeps the plain binding (byte-unchanged).
    expect(server).toContain(`const m = _scrml_body["m"];`);
  });

  test("over HTTP: omitted → default, passed → passed, passed `not` → stays `not`", async () => {
    if (HAPPY_DOM()) return;
    const { errors, outDir, tmpDir } = compileFiles({ "app.scrml": LITERAL }, "app.scrml", "literal-http");
    expect(errors).toEqual([]);
    const js = join(outDir, "app.server.js");
    const db = join(tmpDir, "x.db");
    expect((await callRoute(js, db, "g", { m: "x" })).json).toBe("zzx");
    expect((await callRoute(js, db, "g", { m: "x", k: "yy" })).json).toBe("yyx");
    expect((await callRoute(js, db, "g", { m: "x", k: null })).json).toBe("was-not");
  }, EXECUTED_TIMEOUT_MS);

  test("in process: a sibling server fn that omits the argument gets the default", async () => {
    if (HAPPY_DOM()) return;
    const { errors, outDir, tmpDir } = compileFiles({ "app.scrml": LITERAL }, "app.scrml", "literal-peer");
    expect(errors).toEqual([]);
    const r = await callRoute(join(outDir, "app.server.js"), join(tmpDir, "x.db"), "viaPeer", { m: "x" });
    expect(r.status).toBe(200);
    expect(r.json).toBe("zzx");
  }, EXECUTED_TIMEOUT_MS);
});

// ---------------------------------------------------------------------------
// A default calling a pure `fn`, a default reading an earlier parameter, and a
// module value — evaluated per call, left to right.
// ---------------------------------------------------------------------------

const CHAIN = prog(`  const LIM = 5
  fn dbl(n) { return n * 2 }
  server fn g(m: number, k: number = LIM, j: number = dbl(k)) -> number { return m + k + j }
  function go() { return g(1) }`);

describe("s466 — defaults that call a pure fn and read an earlier parameter", () => {
  test("bindings are emitted in parameter order and the bundle carries LIM and dbl", () => {
    const { errors, read } = compileFiles({ "app.scrml": CHAIN }, "app.scrml", "chain-shape");
    expect(errors).toEqual([]);
    const server = read("app", "server");
    const kAt = server.indexOf(`const k = _scrml_g.Object.hasOwn(_scrml_body, "k") ? _scrml_body["k"] : (LIM);`);
    const jAt = server.indexOf(`const j = _scrml_g.Object.hasOwn(_scrml_body, "j") ? _scrml_body["j"] : (dbl(k));`);
    expect(kAt).toBeGreaterThan(-1);
    expect(jAt).toBeGreaterThan(kAt);
    expect(server).toMatch(/^const LIM = 5;/m);
    expect(server).toMatch(/^function dbl\(n\) \{/m);
  });

  test("each request evaluates the omitted defaults afresh from its own arguments", async () => {
    if (HAPPY_DOM()) return;
    const { errors, outDir, tmpDir } = compileFiles({ "app.scrml": CHAIN }, "app.scrml", "chain-http");
    expect(errors).toEqual([]);
    const js = join(outDir, "app.server.js");
    const db = join(tmpDir, "x.db");
    expect((await callRoute(js, db, "g", { m: 1 })).json).toBe(16);            // 1 + 5 + 10
    expect((await callRoute(js, db, "g", { m: 1, k: 2 })).json).toBe(7);       // 1 + 2 + 4
    expect((await callRoute(js, db, "g", { m: 1, k: 2, j: 0 })).json).toBe(3); // nothing defaulted
  }, EXECUTED_TIMEOUT_MS);

  test("a `not` default lowers to the absence value, not the raw word `not`", () => {
    const { errors, read } = compileFiles({ "app.scrml": prog(`  server fn g(m: number, k: number | not = not) -> string {
    if (k is not) { return "absent" }
    return "has"
  }
  function go() { return g(1) }`) }, "app.scrml", "not-default");
    expect(errors).toEqual([]);
    const server = read("app", "server");
    expect(server).toContain(`const k = _scrml_g.Object.hasOwn(_scrml_body, "k") ? _scrml_body["k"] : (null);`);
    expect(server).not.toMatch(/=\s*not\b/);
  });
});

// ---------------------------------------------------------------------------
// The gap's original shape: a plain `function` with a default, called with no
// argument from a server function (it takes the server path and its peer).
// ---------------------------------------------------------------------------

describe("s466 — a server-placed plain `function` default (the gap's `inner()` → 6)", () => {
  const SRC = prog(`  fn a(n) { return n + 1 }
  function inner(k = a(5)) { return k }
  server function go() { return inner() }`);

  test("the peer callable keeps `k = a(5)` and the call answers 6", async () => {
    const { errors, outDir, tmpDir, read } = compileFiles({ "app.scrml": SRC }, "app.scrml", "inner");
    expect(errors).toEqual([]);
    expect(read("app", "server")).toMatch(/async function inner\(k = a\(5\)\) \{/);
    if (HAPPY_DOM()) return;
    const r = await callRoute(join(outDir, "app.server.js"), join(tmpDir, "x.db"), "go", {});
    expect(r.status).toBe(200);
    expect(r.json).toBe(6);
  }, EXECUTED_TIMEOUT_MS);
});

// ---------------------------------------------------------------------------
// A plain `function` escalated to the server by `?{}`.
// ---------------------------------------------------------------------------

describe("s466 — a `function` escalated by `?{}` keeps its default", () => {
  const SRC = prog(`  function save(n: number, k: number = 4) -> number {
    ?{\`INSERT INTO t (v) VALUES (\${n + k})\`}.run()
    return n + k
  }
  function go() { return save(1) }`);
  const SEED = { "x.db": ["CREATE TABLE t (v INTEGER)"] };

  test("the omitted argument is 4 on the server and in the row it writes", async () => {
    const { errors, outDir, tmpDir, read } = compileFiles({ "app.scrml": SRC }, "app.scrml", "sql-escalated", SEED);
    expect(errors).toEqual([]);
    expect(read("app", "server")).toContain(`const k = _scrml_g.Object.hasOwn(_scrml_body, "k") ? _scrml_body["k"] : (4);`);
    if (HAPPY_DOM()) return;
    const dbPath = join(tmpDir, "x.db");
    const r = await callRoute(join(outDir, "app.server.js"), dbPath, "save", { n: 1 });
    expect(r.status).toBe(200);
    expect(r.json).toBe(5);
    await closeOpenedDbHandles();
    const db = new Database(dbPath);
    expect(db.query("SELECT v FROM t").all()).toEqual([{ v: 5 }]);
    db.close();
  }, EXECUTED_TIMEOUT_MS);
});

// ---------------------------------------------------------------------------
// A CPS-split function: the CLIENT wrapper is the function the caller calls, so
// it applies the default (its client statements read the parameter too); the
// server batch handler keeps the default as the backstop for a missing key.
// ---------------------------------------------------------------------------

describe("s466 — a CPS-split function", () => {
  const SRC = `<program db="./x.db">
\${
  function add(name: string, qty: number = 3) {
    ?{\`INSERT INTO items (name, qty) VALUES (\${name}, \${qty})\`}.run()
    @last = qty
  }
}
<last> = 0
<button onclick=\${add("a")}>go</button>
<p>\${@last}</p>
</program>
`;
  const SEED = { "x.db": ["CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT, qty INTEGER)"] };

  test("the client wrapper declares `qty = 3`; the server batch binds the same default", async () => {
    const { errors, outDir, tmpDir, read } = compileFiles({ "app.scrml": SRC }, "app.scrml", "cps", SEED);
    expect(errors).toEqual([]);
    expect(read("app", "client")).toMatch(/async function _scrml_cps_add_\d+\(name, qty = 3\) \{/);
    expect(read("app", "server")).toContain(`const qty = _scrml_g.Object.hasOwn(_scrml_body, "qty") ? _scrml_body["qty"] : (3);`);
    if (HAPPY_DOM()) return;
    const dbPath = join(tmpDir, "x.db");
    const r = await callRoute(join(outDir, "app.server.js"), dbPath, "add", { name: "a" });
    expect(r.status).toBe(200);
    await closeOpenedDbHandles();
    const db = new Database(dbPath);
    expect(db.query("SELECT name, qty FROM items").all()).toEqual([{ name: "a", qty: 3 }]);
    db.close();
  }, EXECUTED_TIMEOUT_MS);
});

// ---------------------------------------------------------------------------
// An exported server fn, called from another file's server function and over
// its own route.
// ---------------------------------------------------------------------------

describe("s466 — an exported `server fn` called from another file", () => {
  const FILES = {
    "lib.scrml": `\${
  export server fn g(m: string, k: string = "zz") -> string { return k + m }
}
`,
    "app.scrml": prog(`  import { g } from "./lib.scrml"
  server function go() { return g("x") }`),
  };

  test("both the importer's call and the exporter's own route take the default", async () => {
    const { errors, outDir, tmpDir, read } = compileFiles(FILES, "app.scrml", "cross-file");
    expect(errors).toEqual([]);
    const lib = read("lib", "server");
    expect(lib).toContain(`const k = _scrml_g.Object.hasOwn(_scrml_body, "k") ? _scrml_body["k"] : ("zz");`);
    expect(lib).toMatch(/export function g\(m, k = "zz"\) \{/);
    if (HAPPY_DOM()) return;
    const db = join(tmpDir, "x.db");
    expect((await callRoute(join(outDir, "app.server.js"), db, "go", {})).json).toBe("zzx");
    expect((await callRoute(join(outDir, "lib.server.js"), db, "g", { m: "x" })).json).toBe("zzx");
  }, EXECUTED_TIMEOUT_MS);
});

// ---------------------------------------------------------------------------
// A `server function*` (SSE): an omitted argument is a missing query key.
// ---------------------------------------------------------------------------

describe("s466 — an SSE generator's default", () => {
  test("the query binding returns the default for a missing key", () => {
    const { errors, read } = compileFiles({ "app.scrml": `<program db="./x.db">
\${
  server function* countdown(from: number = 3) {
    for (let i = from; i > 0; i--) { yield i }
  }
}
<n> = 0
<p>\${@n}</p>
</program>
` }, "app.scrml", "sse");
    expect(errors).toEqual([]);
    expect(read("app", "server")).toContain(
      `const from = (() => { const _v = route.query["from"]; if (_v === null || _v === undefined) return 3;`,
    );
  });
});

// ---------------------------------------------------------------------------
// Fail-closed: a default is not an awaitable position, and it is a server read.
// ---------------------------------------------------------------------------

describe("s466 — refusals", () => {
  test("a default calling an `@`-reading fn: the callee is server-placed and meets E-REACTIVE-003", () => {
    const { errors } = compileFiles({ "app.scrml": `<program db="./x.db">
\${
  fn rd() { return @n }
  fn f(m, k = rd()) { return m + k }
  server fn go() { return f(1) }
}
<n> = 5
<out> = 0
<button onclick=\${@out = go()}>go</button>
<p>\${@out}</p>
</program>
` }, "app.scrml", "reads-cell-through-fn");
    expect(errors.map((e) => e.code)).toContain("E-REACTIVE-003");
  });

  test("a default reading `@n` directly is E-REACTIVE-003", () => {
    const { errors } = compileFiles({ "app.scrml": `<program db="./x.db">
\${
  server fn g(m: number, k: number = @n) -> number { return m + k }
  function go() { return g(1) }
}
<n> = 5
<out> = 0
<button onclick=\${@out = go()}>go</button>
<p>\${@out}</p>
</program>
` }, "app.scrml", "reads-cell-direct");
    expect(errors.map((e) => e.code)).toContain("E-REACTIVE-003");
  });

  test("a default calling a sibling server fn is refused once (E-SERVER-FN-IN-SYNC-CALLBACK), not shipped as a Promise", () => {
    const { errors } = compileFiles({ "app.scrml": prog(`  server fn h() -> string { return "hh" }
  server fn g(m: string, k: string = h()) -> string { return k + m }
  function go() { return g("x") }`) }, "app.scrml", "peer-in-default");
    const codes = errors.map((e) => e.code);
    expect(codes.filter((c) => c === "E-SERVER-FN-IN-SYNC-CALLBACK")).toHaveLength(1);
  });
});
