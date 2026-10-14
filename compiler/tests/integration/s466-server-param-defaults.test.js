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
// it applies the default (its client statements read the parameter too) and
// always sends the value; the server batch binds the plain value and never
// evaluates the default a second time (s466 fix round 1).
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

  test("the client wrapper declares `qty = 3`; the server batch binds the value it is sent", async () => {
    const { errors, outDir, tmpDir, read } = compileFiles({ "app.scrml": SRC }, "app.scrml", "cps", SEED);
    expect(errors).toEqual([]);
    expect(read("app", "client")).toMatch(/async function _scrml_cps_add_\d+\(name, qty = 3\) \{/);
    expect(read("app", "server")).toContain(`const qty = _scrml_body["qty"];`);
    if (HAPPY_DOM()) return;
    const dbPath = join(tmpDir, "x.db");
    const r = await callRoute(join(outDir, "app.server.js"), dbPath, "add", { name: "a", qty: 3 });
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

});

// ---------------------------------------------------------------------------
// s466 fix round 1 — every decision about a default is made ONCE
// (emit-logic.ts emitParamDefault; route-inference.ts for the identity reads),
// whatever site lowers it.
// ---------------------------------------------------------------------------

const codesOf = (errors) => errors.map((e) => e.code);

describe("s466 fix round 1 — items 1/2: a default that needs an await is E-PARAM-DEFAULT-AWAIT, once", () => {
  const SEED = { "x.db": ["CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT, qty INTEGER)"] };
  const CASES = [
    ["a `?{}` in a CPS-split function's default (client wrapper — no sql placeholder shipped)", `<program db="./x.db">
\${
  function add(name: string, qty: number = ?{\`select 3 as v\`}.get().v) {
    ?{\`INSERT INTO items (name, qty) VALUES (\${name}, \${qty})\`}.run()
    @last = qty
  }
}
<last> = 0
<button onclick=\${add("a")}>go</button>
<p>\${@last}</p>
</program>
`, "qty", "add", 3],
    ["a `?{}` in a server fn's default", prog(`  server fn sq(a: number, k = ?{\`select 1 as v\`}.get()) -> number { return 1 }
  function go() { return sq(1) }`), "k", "sq", 3],
    ["…and a peer calls that server fn (in-process callable)", prog(`  server fn sq(a: number, k = ?{\`select 1 as v\`}.get()) -> number { return 1 }
  server fn callsq() -> number { return sq(1) }
  function go() { return callsq() }`), "k", "sq", 3],
    ["`?{}` reached INDIRECTLY through a helper", prog(`  function one() { return ?{\`select 1 as v\`}.get().v }
  server fn sq(a: number, k: number = one()) -> number { return a + k }
  function go() { return sq(1) }`), "k", "sq", 4],
    ["a sibling server fn", prog(`  server fn h() -> string { return "hh" }
  server fn g(m: string, k: string = h()) -> string { return k + m }
  function go() { return g("x") }`), "k", "g", 4],
    ["an SSE generator's default", `<program db="./x.db">
\${
  server function* tick(n: number = ?{\`select 3 as v\`}.get().v) { yield n }
}
<p>x</p>
</program>
`, "n", "tick", 3],
  ];
  for (const [label, src, param, fn, line] of CASES) {
    test(label, () => {
      const { errors, read } = compileFiles({ "app.scrml": src }, "app.scrml", "await-" + param + fn, SEED);
      const codes = codesOf(errors);
      expect(codes.filter((c) => c === "E-PARAM-DEFAULT-AWAIT")).toHaveLength(1);
      // One root cause, one diagnostic: no callback-position code, no invalid-JS backstop.
      expect(codes).not.toContain("E-SERVER-FN-IN-SYNC-CALLBACK");
      expect(codes).not.toContain("E-ASYNC-STDLIB-IN-SYNC-CALLBACK");
      expect(codes).not.toContain("E-CODEGEN-INVALID-LOGIC");
      const e = errors.find((x) => x.code === "E-PARAM-DEFAULT-AWAIT");
      // Item 6: the message names the position and the fix, not a callback / `for` loop.
      expect(e.message).toContain(`parameter \`${param}\` of \`${fn}\``);
      expect(e.message).toContain("in the function body");
      expect(e.message).not.toContain("callback");
      // Item 7: anchored at the default, not the function's first line.
      expect(e.span.line).toBe(line);
      expect(read("app", "client")).not.toContain("sql-ref unresolved");
    });
  }
});

describe("s466 fix round 1 — item 6: one root cause is reported once", () => {
  test("a default calling an `@`-reading fn: E-REACTIVE-003 on the fn, no second default refusal", () => {
    const { errors } = compileFiles({ "app.scrml": `<program db="./x.db">
\${
  <n> = 1
  fn rd() -> number { return @n }
  server fn g2(m: number,
    k: number = rd()) -> number { return m + k }
  function go() { return g2(1) }
}
<out> = 0
<button onclick=\${@out = go()}>go</button>
<p>\${@out}</p>
</program>
` }, "app.scrml", "cascade");
    expect(codesOf(errors)).toEqual(["E-REACTIVE-003"]);
  });
});

describe("s466 fix round 1 — item 3: server identity in a default", () => {
  test("`session.userId` in a server fn's default is E-PARAM-DEFAULT-SERVER-IDENTITY (a body key would override it)", () => {
    const { errors } = compileFiles({ "app.scrml": `<program db="./x.db" auth="required">
\${
  server fn who2(m: string, uid = session.userId) -> string { return m + uid }
  function go() { return who2("b") }
}
<out> = ""
<button onclick=\${@out = go()}>go</button>
<p>\${@out}</p>
</program>
` }, "app.scrml", "session-default");
    expect(codesOf(errors)).toEqual(["E-PARAM-DEFAULT-SERVER-IDENTITY"]);
    const e = errors[0];
    expect(e.message).toContain("const uid = session.userId");
    expect(e.span.line).toBe(3);
  });

  test("`@currentUser` in a server fn's default is E-PARAM-DEFAULT-SERVER-IDENTITY", () => {
    const { errors } = compileFiles({ "app.scrml": `<program db="./x.db" auth="required">
\${
  server fn who3(m: string, u = @currentUser) -> string { return m }
  function go() { return who3("b") }
}
<out> = ""
<button onclick=\${@out = go()}>go</button>
<p>\${@out}</p>
</program>
` }, "app.scrml", "currentuser-default");
    expect(codesOf(errors)).toContain("E-PARAM-DEFAULT-SERVER-IDENTITY");
  });

  test("`@session.userId` in a server fn's default is the NAMED E-SESSION-AMBIENT-SERVER, not the internal backstop", () => {
    const { errors } = compileFiles({ "app.scrml": `<program db="./x.db" auth="required">
\${
  server fn who(m: string, uid: string = @session.userId) -> string { return m + uid }
  function go() { return who("a") }
}
<out> = ""
<button onclick=\${@out = go()}>go</button>
<p>\${@out}</p>
</program>
` }, "app.scrml", "at-session-default");
    const codes = codesOf(errors);
    expect(codes).toContain("E-SESSION-AMBIENT-SERVER");
    expect(codes).not.toContain("E-INTERNAL-SESSION-AMBIENT-SERVER");
    expect(errors.find((e) => e.code === "E-SESSION-AMBIENT-SERVER").span.line).toBe(3);
  });

  test("the fix the message names compiles: read it in the body", () => {
    const { errors } = compileFiles({ "app.scrml": `<program db="./x.db" auth="required">
\${
  server fn who2(m: string) -> string { const uid = session.userId
    return m + uid }
  function go() { return who2("b") }
}
<out> = ""
<button onclick=\${@out = go()}>go</button>
<p>\${@out}</p>
</program>
` }, "app.scrml", "session-body");
    expect(errors).toEqual([]);
  });
});

describe("s466 fix round 1 — item 4: a default that is not ONE expression is refused, never truncated", () => {
  const CASES = [
    ["`\"a\" foo`", `server fn tr(a: number, k = "a" foo) -> string { return k }`, "tr", "foo"],
    ["`1 2` (was re-spelled `12`)", `server fn tr2(a: number, k = 1 2) -> number { return k }`, "tr2", "2"],
    ["a struct literal head `Pt { … }`", `server fn st(a: number, p: Pt = Pt { x: a, y: 2 }) -> number { return p.x + p.y }`, "st", "{"],
  ];
  for (const [label, decl, fn, leftover] of CASES) {
    test(label, () => {
      const { errors } = compileFiles({ "app.scrml": prog(`  type Pt:struct = { x: number, y: number }
  ${decl}
  function go() { return ${fn}(1) }`) }, "app.scrml", "lost-" + fn);
      expect(codesOf(errors)).toEqual(["E-PARSE-001"]);
      expect(errors[0].message).toContain(`\`${fn}\``);
      expect(errors[0].message).toContain(leftover);
      expect(errors[0].span.line).toBe(4);
    });
  }
});

describe("s466 fix round 1 — item 5: every function's default is lowered, none spliced as scrml text", () => {
  test("a client `fn` / `function`: `not` and `.Green` lower", () => {
    const { errors, read } = compileFiles({ "app.scrml": `<program>
\${
  type Color:enum = { Red, Green }
  fn f(m: number, k: number | not = not, c: Color = .Green) -> string { if (k is not) { return "a" } return "b" }
  function h(m: number, k: number | not = not) -> string { if (k is not) { return "a" } return "b" }
}
<out> = ""
<button onclick=\${@out = f(1) + h(1)}>go</button>
<p>\${@out}</p>
</program>
` }, "app.scrml", "client-lowered");
    expect(errors).toEqual([]);
    const client = read("app", "client");
    expect(client).toMatch(/function _scrml_f_\d+\(m, k = null, c = "Green"\)/);
    expect(client).toMatch(/function _scrml_h_\d+\(m, k = null\)/);
    expect(client).not.toMatch(/=\s*not\b/);
  });

  test("an exported server fn (library member): `not` and `.Green` lower, and it runs", async () => {
    const FILES = {
      "lib.scrml": `\${
  export type Color:enum = { Red, Green }
  export server fn g(m: string, k: string | not = not, c: Color = .Green) -> string {
    if (k is not) { return "absent" + m }
    return k + m
  }
}
`,
      "app.scrml": prog(`  import { g } from "./lib.scrml"
  server fn viaImp(m: string) -> string { return g(m) }
  function go() { return viaImp("x") }`),
    };
    const { errors, outDir, tmpDir, read } = compileFiles(FILES, "app.scrml", "lib-lowered");
    expect(errors).toEqual([]);
    expect(read("lib", "server")).toMatch(/export function g\(m, k = null, c = "Green"\)/);
    if (HAPPY_DOM()) return;
    const db = join(tmpDir, "x.db");
    expect((await callRoute(join(outDir, "app.server.js"), db, "viaImp", { m: "x" })).json).toBe("absentx");
    expect((await callRoute(join(outDir, "lib.server.js"), db, "g", { m: "y" })).json).toBe("absenty");
  }, EXECUTED_TIMEOUT_MS);
});

describe("s466 fix round 1 — item 8: the SSE auth gate runs before any default", () => {
  test("`_scrml_auth_check` precedes the query bindings", () => {
    const { errors, read } = compileFiles({ "app.scrml": `<program db="./x.db" auth="required">
\${
  server function* countdown(from: number = 3) {
    for (let i = from; i > 0; i--) { yield i }
  }
}
<n> = 0
<p>\${@n}</p>
</program>
` }, "app.scrml", "sse-auth");
    expect(errors).toEqual([]);
    const server = read("app", "server");
    const gate = server.indexOf("_scrml_auth_check(_scrml_req)");
    const bind = server.indexOf("const from = (() =>");
    expect(gate).toBeGreaterThan(-1);
    expect(bind).toBeGreaterThan(gate);
  });
});


// ---------------------------------------------------------------------------
// s466 fix round 2 — identity defaults are decided by PLACEMENT (the default's
// value reaches server code), not by the CPS flag; `session` is the builtin only
// when the name is FREE (free-name.ts — one scope model).
// ---------------------------------------------------------------------------

describe("s466 fix round 2 — item 1: a server-trusted identity default is refused wherever its value reaches the server", () => {
  const CASES = [
    ["a CPS-split function (the default runs in the BROWSER, the server batch writes it)", {
      "app.scrml": `<program db="./x.db" auth="required">
\${
  function add(name: string, uid: string = session.userId) {
    ?{\`INSERT INTO items (name, qty) VALUES (\${name}, \${uid})\`}.run()
    @last = uid
  }
}
<last> = ""
<button onclick=\${add("a")}>go</button>
<p>\${@last}</p>
</program>
`,
    }, 3, "BROWSER"],
    ["an SSE generator", {
      "app.scrml": `<program db="./x.db" auth="required">
\${
  server function* feed(uid: string = session.userId) {
    yield uid
  }
}
<p>x</p>
</program>
`,
    }, 3, "server function"],
    ["a channel `onserver:*` handler", {
      "app.scrml": `<program db="./c.db" auth="required">
  <channel name="chat" auth="required" onserver:message=onMsg(msg)>
    <count> = 0
    function onMsg(msg, uid = session.userId) {
      broadcast({ got: msg, by: uid })
    }
  </channel>
  <p>x</p>
</program>
`,
    }, 4, "server function"],
    ["an exported server fn (its own route)", {
      "lib.scrml": `\${
  export server fn who(m: string, uid: string = session.userId) -> string { return m + uid }
}
`,
      "app.scrml": `<program db="./x.db" auth="required">
\${
  import { who } from "./lib.scrml"
  server fn viaImp(m: string) -> string { return who(m) }
  function go() { return viaImp("x") }
}
<out> = ""
<button onclick=\${@out = go()}>go</button>
<p>\${@out}</p>
</program>
`,
    }, 2, "server function"],
  ];
  const SEED = { "x.db": ["CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT, qty TEXT)"] };
  for (const [label, files, line, wording] of CASES) {
    test(label, () => {
      const { errors } = compileFiles(files, "app.scrml", "r2-id", SEED);
      expect(codesOf(errors)).toEqual(["E-PARAM-DEFAULT-SERVER-IDENTITY"]);
      expect(errors[0].span.line).toBe(line);
      expect(errors[0].message).toContain(wording);
    });
  }

  test("a CLIENT function's `session` default is E-SCOPE-012, as in its body", () => {
    const { errors } = compileFiles({ "app.scrml": `<program auth="required">
\${
  function f(m: string, k: string = session.userId) { @x = m + k }
}
<x> = ""
<button onclick=\${f("a")}>go</button>
<p>\${@x}</p>
</program>
` }, "app.scrml", "r2-client-session");
    expect(codesOf(errors)).toEqual(["E-SCOPE-012"]);
    expect(errors[0].span.line).toBe(3);
  });
});

describe("s466 fix round 2 — items 2/3: a name `session` bound by a parameter is not the builtin", () => {
  test("`fn mk(session)` stays a pure synchronous helper; a default calling it runs (id4)", async () => {
    const { errors, outDir, tmpDir, read } = compileFiles({ "app.scrml": prog(`  fn mk(session: string) -> string { return session + "!" }
  server fn a3(m: string, k: string = mk("z")) -> string { return k + m }
  function go() { return a3("q") }`) }, "app.scrml", "r2-id4");
    expect(errors).toEqual([]);
    const server = read("app", "server");
    expect(server).toMatch(/^function mk\(session\) \{/m);
    expect(server).not.toContain("__ri_route_mk");
    if (HAPPY_DOM()) return;
    const r = await callRoute(join(outDir, "app.server.js"), join(tmpDir, "x.db"), "a3", { m: "q" });
    expect(r.json).toBe("z!q");
  }, EXECUTED_TIMEOUT_MS);

  test("…and a body calling it (id5)", async () => {
    const { errors, outDir, tmpDir } = compileFiles({ "app.scrml": prog(`  fn mk(session: string) -> string { return session + "!" }
  server fn a3(m: string) -> string { return mk("z") + m }
  function go() { return a3("q") }`) }, "app.scrml", "r2-id5");
    expect(errors).toEqual([]);
    if (HAPPY_DOM()) return;
    const r = await callRoute(join(outDir, "app.server.js"), join(tmpDir, "x.db"), "a3", { m: "q" });
    expect(r.json).toBe("z!q");
  }, EXECUTED_TIMEOUT_MS);

  const LAM = (auth) => `<program db="./x.db"${auth}>
\${
  server fn lam(m: string, f = (session) => session.userId) -> string { return m + f({ userId: "u" }) }
  function go() { return lam("x") }
}
<out> = ""
<button onclick=\${@out = go()}>go2</button>
<p>\${@out}</p>
</program>
`;
  test("a lambda parameter named `session` in a default is not the builtin (sid `lam`): accepted and runs", async () => {
    const { errors, outDir, tmpDir } = compileFiles({ "app.scrml": LAM("") }, "app.scrml", "r2-sid");
    expect(errors).toEqual([]);
    if (HAPPY_DOM()) return;
    const r = await callRoute(join(outDir, "app.server.js"), join(tmpDir, "x.db"), "lam", { m: "x" });
    expect(r.json).toBe("xu");
  }, EXECUTED_TIMEOUT_MS);

  test("…and under auth=\"required\" the bundle LOADS (no cookie-session wrap for a lambda's own `session`)", async () => {
    const { errors, outDir } = compileFiles({ "app.scrml": LAM(' auth="required"') }, "app.scrml", "r2-sid-auth");
    expect(errors).toEqual([]);
    const server = readFileSync(join(outDir, "app.server.js"), "utf-8");
    expect(server).not.toContain("_scrml_session_cookie_wrap(_scrml_handler_lam");
    const mod = await import(`file://${join(outDir, "app.server.js")}?v=${Math.random()}`);
    expect(Array.isArray(mod.routes)).toBe(true);
  }, EXECUTED_TIMEOUT_MS);
});

describe("s466 fix round 2 — item 4: E-PARAM-DEFAULT-AWAIT names the way out", () => {
  const HB = (kw) => prog(`  ${kw} helper2(x: number) -> number { return x * 3 }
  server function gd(m: number, k: number = helper2(m)) -> number { return k }
  function go() { return gd(1) }`);

  test("a plain `function` async only by placement: the message says to declare it `fn`", () => {
    const { errors } = compileFiles({ "app.scrml": HB("function") }, "app.scrml", "r2-hb");
    expect(codesOf(errors)).toEqual(["E-PARAM-DEFAULT-AWAIT"]);
    expect(errors[0].message).toContain("declare it `fn` if it is pure");
    expect(errors[0].message).toContain("treated the same as one that omits the argument");
  });

  test("…and the `fn` form the message names compiles and runs", async () => {
    const { errors, outDir, tmpDir } = compileFiles({ "app.scrml": HB("fn") }, "app.scrml", "r2-hb-fn");
    expect(errors).toEqual([]);
    if (HAPPY_DOM()) return;
    const r = await callRoute(join(outDir, "app.server.js"), join(tmpDir, "x.db"), "gd", { m: 1 });
    expect(r.json).toBe(3);
  }, EXECUTED_TIMEOUT_MS);
});


// ---------------------------------------------------------------------------
// s466 fix round 3 — FAIL CLOSED. Every default check reads the ANALYSED tree
// (at-refs.ts `analyzedParamDefault`): a closed set of expression kinds, with
// `match` arms and template slots parsed. Anything else is refused.
// ---------------------------------------------------------------------------

describe("s466 fix round 3 — a `match` in a default is checked like any other code", () => {
  const MATCH_PROG = (arm, extra = "", auth = "") => `<program db="./x.db"${auth}>
\${
  <n> = 1
  server fn h() -> number { return 1 }
${extra}  server fn a1(m: string, k = match m { "a" => ${arm}
    else => 2 }) -> number { return k }
  function go() { return a1("a") }
}
<out> = 0
<button onclick=\${@out = go()}>go</button>
<p>\${@out}</p>
</program>
`;
  test("fo4: `session.userId` in an arm → E-PARAM-DEFAULT-SERVER-IDENTITY", () => {
    const { errors } = compileFiles({ "app.scrml": MATCH_PROG("session.userId", "", ' auth="required"') }, "app.scrml", "r3-fo4");
    expect(codesOf(errors)).toEqual(["E-PARAM-DEFAULT-SERVER-IDENTITY"]);
    expect(errors[0].span.line).toBe(5);
  });
  test("ma1: `@n` in an arm → E-REACTIVE-003 at the default", () => {
    const { errors } = compileFiles({ "app.scrml": MATCH_PROG("@n") }, "app.scrml", "r3-ma1");
    expect(codesOf(errors)).toEqual(["E-REACTIVE-003"]);
    expect(errors[0].span.line).toBe(5);
  });
  test("ma2: a peer call in an arm → E-PARAM-DEFAULT-AWAIT", () => {
    const { errors } = compileFiles({ "app.scrml": MATCH_PROG("h()") }, "app.scrml", "r3-ma2");
    expect(codesOf(errors)).toEqual(["E-PARAM-DEFAULT-AWAIT"]);
    expect(errors[0].message).toContain("calls `h`");
  });
  test("ma3: `?{}` in an arm → E-PARAM-DEFAULT-AWAIT (not an unnamed codegen failure)", () => {
    const { errors } = compileFiles({ "app.scrml": MATCH_PROG("?{`select 1 as v`}.get().v") }, "app.scrml", "r3-ma3");
    expect(codesOf(errors)).toEqual(["E-PARAM-DEFAULT-AWAIT"]);
    expect(errors[0].message).toContain("`?{}` query");
  });
  test("a pure `match` default compiles and runs (arms parsed, then checked)", async () => {
    const { errors, outDir, tmpDir } = compileFiles({ "app.scrml": prog(`  server fn pm(m: string, k = match m { "a" => 1
    else => 2 }) -> number { return k }
  function go() { return pm("a") }`) }, "app.scrml", "r3-pure-match");
    expect(errors).toEqual([]);
    if (HAPPY_DOM()) return;
    const js = join(outDir, "app.server.js");
    const db = join(tmpDir, "x.db");
    expect((await callRoute(js, db, "pm", { m: "a" })).json).toBe(1);
    expect((await callRoute(js, db, "pm", { m: "b" })).json).toBe(2);
    expect((await callRoute(js, db, "pm", { m: "a", k: 9 })).json).toBe(9);
  }, EXECUTED_TIMEOUT_MS);
  test("a match-arm binding shadows: `.Some(session) => session` is not the builtin", () => {
    const { errors } = compileFiles({ "app.scrml": `<program db="./x.db" auth="required">
\${
  type Opt:enum = { Some(v: string), None }
  server fn ps(o: Opt, k = match o { .Some(session) => session
    else => "none" }) -> string { return k }
  function go() { return ps(.None) }
}
<out> = ""
<button onclick=\${@out = go()}>go</button>
<p>\${@out}</p>
</program>
` }, "app.scrml", "r3-arm-binding");
    expect(codesOf(errors)).not.toContain("E-PARAM-DEFAULT-SERVER-IDENTITY");
  });
});

describe("s466 fix round 3 — anything outside the closed set is refused (E-PARAM-DEFAULT-UNSUPPORTED)", () => {
  test("a block-bodied function in a default", () => {
    const { errors } = compileFiles({ "app.scrml": prog(`  server fn bl(a: number, f = (x) => { return x + a }) -> number { return f(10) }
  function go() { return bl(1) }`) }, "app.scrml", "r3-block-fn");
    expect(codesOf(errors)).toEqual(["E-PARAM-DEFAULT-UNSUPPORTED"]);
    expect(errors[0].message).toContain("a function with a block body");
    expect(errors[0].span.line).toBe(3);
  });
  test("…but NOT in a client-only function (fix round 4: the refusal is server-scoped — §7.3.2 \"arbitrary expressions\")", () => {
    const { errors } = compileFiles({ "app.scrml": `<program>
\${
  function c(a: number, f = (x) => { return x + a }) { @out = f(1) }
}
<out> = 0
<button onclick=\${c(1)}>go</button>
<p>\${@out}</p>
</program>
` }, "app.scrml", "r3-block-fn-client");
    expect(errors).toEqual([]);
  });
  test("a regular-expression literal is a leaf, not unparsed code: accepted", () => {
    const { errors } = compileFiles({ "app.scrml": prog(`  server fn rx(a: string, r = /x,\\)=/g) -> string { return a + r.source }
  function go() { return rx("a") }`) }, "app.scrml", "r3-regex");
    expect(errors).toEqual([]);
  });
  test("a template literal's `\${…}` slots are parsed and checked (identity read inside)", () => {
    const { errors } = compileFiles({ "app.scrml": `<program db="./x.db" auth="required">
\${
  server fn tl(m: string, uid = \`u-\${session.userId}\`) -> string { return m + uid }
  function go() { return tl("a") }
}
<out> = ""
<button onclick=\${@out = go()}>go</button>
<p>\${@out}</p>
</program>
` }, "app.scrml", "r3-template");
    expect(codesOf(errors)).toEqual(["E-PARAM-DEFAULT-SERVER-IDENTITY"]);
  });
});

describe("s466 fix round 3 — LOW: a default may read only EARLIER parameters (§7.3.2)", () => {
  test("fo2: `uid = session.userId, session = \"x\"` → E-PARAM-DEFAULT-FORWARD-REF", () => {
    const { errors } = compileFiles({ "app.scrml": `<program db="./x.db" auth="required">
\${
  server fn f1(m: string, uid: string = session.userId, session: string = "x") -> string { return m + uid }
  function go() { return f1("a") }
}
<out> = ""
<button onclick=\${@out = go()}>go</button>
<p>\${@out}</p>
</program>
` }, "app.scrml", "r3-forward");
    expect(codesOf(errors)).toEqual(["E-PARAM-DEFAULT-FORWARD-REF"]);
    expect(errors[0].message).toContain("declared AFTER it");
  });
  test("a default reading its own parameter → E-PARAM-DEFAULT-FORWARD-REF", () => {
    const { errors } = compileFiles({ "app.scrml": prog(`  server fn self(m: number, k: number = k + 1) -> number { return m + k }
  function go() { return self(1) }`) }, "app.scrml", "r3-self");
    expect(codesOf(errors)).toEqual(["E-PARAM-DEFAULT-FORWARD-REF"]);
  });
  test("reading an EARLIER parameter is fine; a lambda parameter of a later name is its own binding", () => {
    const { errors } = compileFiles({ "app.scrml": prog(`  server fn ok(a: number, b: number = a * 2, f = (c) => c + 1, c: number = 3) -> number { return a + b + f(c) }
  function go() { return ok(1) }`) }, "app.scrml", "r3-earlier");
    expect(errors).toEqual([]);
  });
});


// ---------------------------------------------------------------------------
// s466 fix round 4.
// ---------------------------------------------------------------------------

describe("s466 fix round 4 — item 1: a server-placed default does not WRITE (the module must load)", () => {
  const CASES = [
    ["`k = (m = \"z\")`", `k = (m = "z")`],
    ["`k = m++`", `k = m++`],
    ["`k = (m += \"z\")`", `k = (m += "z")`],
    ["`k = [m = \"q\"][0]`", `k = [m = "q"][0]`],
  ];
  for (const [label, def] of CASES) {
    test(`${label} → E-PARAM-DEFAULT-UNSUPPORTED at compile time`, () => {
      const { errors } = compileFiles({ "app.scrml": prog(`  server fn t(m: string, ${def}) -> string { return String(k) + "|" + m }
  function go() { return t("a") }`) }, "app.scrml", "r4-assign");
      expect(codesOf(errors)).toEqual(["E-PARAM-DEFAULT-UNSUPPORTED"]);
      expect(errors[0].message).toMatch(/writes nothing/);
    });
  }

  test("every accepted server default here yields a server module that LOADS (import, not just a parse)", async () => {
    const SRCS = [
      LITERAL,
      CHAIN,
      prog(`  server fn pm(m: string, k = match m { "a" => 1
    else => 2 }) -> number { return k }
  function go() { return pm("a") }`),
      prog(`  server fn neg(m: number, k: number = -m, b = !m) -> number { return k }
  function go() { return neg(1) }`),
    ];
    let i = 0;
    for (const src of SRCS) {
      const { errors, outDir } = compileFiles({ "app.scrml": src }, "app.scrml", `r4-load-${++i}`);
      expect(errors).toEqual([]);
      const mod = await import(`file://${join(outDir, "app.server.js")}?v=${Math.random()}`);
      expect(Array.isArray(mod.routes)).toBe(true);
      expect(mod.routes.length).toBeGreaterThan(0);
    }
  }, EXECUTED_TIMEOUT_MS);
});

describe("s466 fix round 4 — item 2: a CLIENT-only default accepts what main accepted (no closed-set refusal)", () => {
  const CLI = `<program>
\${
  function cf(m: number, f = (x) => { return x + m }) -> number { return f(1) }
  fn pf(m: number, k = match m {
    1 => "one"
    else => "other" }) -> string { return k }
  function asg(m: number, k = (m = 5)) -> number { return k + m }
}
<out> = 0
<button onclick=\${@out = cf(1) + asg(1)}>go</button>
<p>\${pf(1)}</p>
</program>
`;
  test("a block-bodied lambda, a match and an assignment default compile — and the functions run", () => {
    const { errors, read } = compileFiles({ "app.scrml": CLI }, "app.scrml", "r4-client");
    expect(errors).toEqual([]);
    const client = read("app", "client");
    const grab = (name) => {
      const m = client.match(new RegExp(`function (_scrml_${name}_\\d+)\\(`));
      expect(m).not.toBeNull();
      const start = client.indexOf(m[0]);
      // the function text runs to its closing brace at column 0
      const end = client.indexOf("\n}\n", start) + 2;
      return { fnName: m[1], text: client.slice(start, end) };
    };
    const cf = grab("cf");
    const pf = grab("pf");
    const asg = grab("asg");
    const run = (fn, args) => new Function(`${fn.text}\nreturn ${fn.fnName}(${args});`)();
    expect(run(cf, "1")).toBe(2);
    expect(run(cf, "1, (x) => x * 10")).toBe(10);
    expect(run(pf, "1")).toBe("one");
    expect(run(pf, "2")).toBe("other");
    expect(run(asg, "1")).toBe(10);
  });
  test("…while the SAME block-bodied default on a SERVER function is still refused", () => {
    const { errors } = compileFiles({ "app.scrml": prog(`  server fn sf(m: number, f = (x) => { return x + m }) -> number { return f(1) }
  function go() { return sf(1) }`) }, "app.scrml", "r4-server-block");
    expect(codesOf(errors)).toEqual(["E-PARAM-DEFAULT-UNSUPPORTED"]);
  });
});

describe("s466 fix round 4 — item 3: a multi-line `match` default keeps its line breaks", () => {
  test("`.Red => 1⏎.Green => 2⏎else => 9` parses and runs", async () => {
    const { errors, outDir, tmpDir } = compileFiles({ "app.scrml": `<program db="./x.db">
\${
  type Color:enum = { Red, Green, Blue }
  server fn t(m: string, c: Color = .Green, k = match c {
    .Red => 1
    .Green => 2
    else => 9 }) -> string { return k + "|" + m }
  function go() { return t("a") }
}
<out> = ""
<button onclick=\${@out = go()}>go</button>
<p>\${@out}</p>
</program>
` }, "app.scrml", "r4-multiline-match");
    expect(errors).toEqual([]);
    const mod = await import(`file://${join(outDir, "app.server.js")}?v=${Math.random()}`);
    expect(Array.isArray(mod.routes)).toBe(true);
    if (HAPPY_DOM()) return;
    const js = join(outDir, "app.server.js");
    const db = join(tmpDir, "x.db");
    expect((await callRoute(js, db, "t", { m: "a" })).json).toBe("2|a");
    expect((await callRoute(js, db, "t", { m: "a", c: "Red" })).json).toBe("1|a");
  }, EXECUTED_TIMEOUT_MS);
});
