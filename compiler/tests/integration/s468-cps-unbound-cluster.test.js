/**
 * s468 (s468-cps-unbound-cluster) — two CPS-split shapes that compiled clean and
 * failed when run (both measured on origin/main 5c43c3b8e):
 *
 *  1. g-cps-split-local-from-session-unbound-on-server-s467 (HIGH) — a CPS-split
 *     function that binds a local from `@session` (`const uid = @session.userId`)
 *     before its first server statement and uses it in a `?{}`. After #1435 the
 *     server batch read `uid` from the REQUEST (`_scrml_body["uid"]`) — the browser
 *     computed it from the client projection, so any HTTP request could claim any
 *     identity and the row was written as whoever the body named. §6.6.9: "`@session`
 *     is server-only identity and SHALL NEVER be marshalled from the client". Now
 *     E-RI-002, naming `session.userId`; the `session.userId` form compiles and
 *     writes the REAL session's id whatever the body claims (executed).
 *
 *  2. g-server-fn-calls-cps-split-fn-unbound-s467 (MED) — server code calling a
 *     same-file CPS-split function emitted `add(m)` into the server module with no
 *     `add` (ReferenceError on every request). A split function writes a reactive
 *     cell, and §12.4 (S451 R2) makes that E-ROUTE-002 with the call chain. Covered:
 *     a wholly-server caller, a transitive one, an inferred-server caller, a
 *     CPS-split caller's server batch, a callee that also has client callers. A
 *     client function calling a split function, and a server function calling a
 *     non-split server peer, still compile and run (executed).
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname, join } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync, readFileSync } from "fs";
import { Database } from "bun:sqlite";
import { compileScrml } from "../../src/api.js";

const T = 30_000;
const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
const TMP_ROOT = resolve(testDir, "_tmp_s468_cps_unbound");
let n = 0;
beforeAll(() => { if (!existsSync(TMP_ROOT)) mkdirSync(TMP_ROOT, { recursive: true }); });
afterAll(() => { if (existsSync(TMP_ROOT)) rmSync(TMP_ROOT, { recursive: true, force: true }); });

function compile(src) {
  const tag = `c${++n}`;
  const dir = resolve(TMP_ROOT, tag);
  const out = resolve(dir, "dist");
  mkdirSync(out, { recursive: true });
  const input = resolve(dir, `${tag}.scrml`);
  writeFileSync(input, src);
  const db = new Database(join(dir, "app.db"), { create: true });
  db.run("CREATE TABLE IF NOT EXISTS posts (id INTEGER PRIMARY KEY, author TEXT, body TEXT)");
  db.close();
  const r = compileScrml({ inputFiles: [input], write: true, outputDir: out, log: () => {} });
  const serverJsPath = join(out, `${tag}.server.js`);
  const clientJsPath = join(out, `${tag}.client.js`);
  return {
    errors: (r.errors ?? []).filter((e) => (e.severity ?? "error") === "error" && !/^[WI]-/.test(e.code ?? "")),
    serverJs: existsSync(serverJsPath) ? readFileSync(serverJsPath, "utf8") : "",
    clientJs: existsSync(clientJsPath) ? readFileSync(clientJsPath, "utf8") : "",
    serverJsPath,
    dir,
  };
}
const codes = (errs) => [...new Set(errs.map((e) => e.code))];
const rows = (dir) => {
  const db = new Database(join(dir, "app.db"));
  try { return db.query("SELECT author, body FROM posts ORDER BY id").all(); } finally { db.close(); }
};
async function routesOf(r) {
  const mod = await import(`file://${r.serverJsPath}?v=${Date.now()}-${Math.random()}`);
  return mod.routes;
}

// ---------------------------------------------------------------------------
// 1. a local computed from `@session` in the browser is never read from the request
// ---------------------------------------------------------------------------

const AUTH = (fn, call = `add("hi")`) => `<program db="./app.db" auth="required">
  <last> = ""
  function who() { return @session.userId }
  ${fn}
  <button id="go" onclick={ ${call} }>add</button>
  <p id="last">\${@last}</p>
</program>
`;
const INS = (author) => `?{\`INSERT INTO posts (author, body) VALUES (\${${author}}, \${name})\`}.run()`;

function expectIdentityRefused(r, local, fix) {
  expect(codes(r.errors)).toEqual(["E-RI-002"]);
  const msg = r.errors.map((e) => e.message).join("\n");
  expect(msg).toContain(`reads \`${local}\` from the request`);
  expect(msg).toContain("SHALL NEVER be marshalled from the client");
  if (fix) expect(msg).toContain(fix);
  expect(r.serverJs).toBe("");
}

describe("s468 — a CPS local derived from `@session` is refused (§6.6.9)", () => {
  test("the gap reproducer (`const uid = @session.userId` … `?{… ${uid}}` … `@last = uid`)", () => {
    const r = compile(AUTH(`function add(name: string) {
    const uid = @session.userId
    ${INS("uid")}
    @last = uid
  }`));
    expectIdentityRefused(r, "uid", "`const uid = session.userId`");
  });

  const shapes = {
    "a cell write before the local": [`@last = "x"\n    const uid = @session.userId\n    ${INS("uid")}`, "uid"],
    "through a local alias of `@session`": [`const s = @session\n    const o = { u: s.userId }\n    ${INS("o.u")}\n    @last = name`, "o"],
    "a function value read on the server (`const getU = () => @session.userId`)": [`const getU = () => @session.userId\n    ${INS("getU()")}\n    @last = name`, "getU"],
    "derived (`const uid = \"u:\" + @session.userId`)": [`const uid = "u:" + @session.userId\n    ${INS("uid")}\n    @last = name`, "uid"],
  };
  for (const [label, [body, local]] of Object.entries(shapes)) {
    test(label, () => {
      expectIdentityRefused(compile(AUTH(`function add(name: string) {\n    ${body}\n  }`)), local);
    });
  }

  test("through a file-level helper (`const uid = who()`) — refused (the helper is placed on the server, where `@session` is not read)", () => {
    const r = compile(AUTH(`function add(name: string) {\n    const uid = who()\n    ${INS("uid")}\n    @last = uid\n  }`));
    expect(codes(r.errors)).toEqual(["E-SESSION-AMBIENT-SERVER"]);
    expect(r.serverJs).toBe("");
  });

  test("written in a block-bodied callback (raw text) — refused (E-RI-002), no output", () => {
    const r = compile(AUTH(`function add(name: string) {\n    let n: string = ""\n    const xs = [1]\n    xs.forEach((x) => { n = @session.userId })\n    ${INS("n")}\n    @last = name\n  }`));
    expect(codes(r.errors)).toEqual(["E-RI-002"]);
    expect(r.errors.map((e) => e.message).join("\n")).toContain("reads `n` from the request");
    expect(r.serverJs).toBe("");
  });

  test("a same-named local in ANOTHER function does not refuse this one", () => {
    const r = compile(AUTH(`function other() { const uid = @session.userId\n    @last = uid }
  function add(name: string) {
    const uid = name + "!"
    ${INS("uid")}
    @last = uid
  }`));
    expect(r.errors).toEqual([]);
  });

  test("browser data carried to the server still compiles (`const tag = name + \"!\"`)", () => {
    const r = compile(AUTH(`function add(name: string) {
    const tag = name + "!"
    ${INS("tag")}
    @last = tag
  }`));
    expect(r.errors).toEqual([]);
    expect(r.serverJs).toContain('_scrml_body["tag"]');
  });

  test("`@session` read only in the browser part still compiles", () => {
    const r = compile(AUTH(`function add(name: string) {
    ${INS("name")}
    @last = @session.userId
  }`));
    expect(r.errors).toEqual([]);
  });

  test("the fix form (`const uid = session.userId`) writes the REAL session's id, whatever the body claims", async () => {
    if (typeof globalThis.document !== "undefined") return; // native Request only (Cookie header)
    const r = compile(AUTH(`function add(name: string) {
    const uid = session.userId
    ${INS("uid")}
    @last = uid
  }`));
    expect(r.errors).toEqual([]);
    expect(r.serverJs).not.toContain('_scrml_body["uid"]');
    const routes = await routesOf(r);
    const route = routes.find((x) => /__ri_route_add_\d+/.test(x.path));
    expect(route).toBeTruthy();
    const store = globalThis.__scrml_session_store;
    expect(store).toBeTruthy();
    const SID = `sid-${Math.random().toString(36).slice(2)}`;
    const TOKEN = `tok-${Math.random().toString(36).slice(2)}`;
    store.set(SID, { userId: "u-real", role: "user", csrfToken: TOKEN }, 3600);
    const resp = await route.handler(new Request(`http://localhost${route.path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: `__Host-scrml_sid=${SID}`, "X-CSRF-Token": TOKEN },
      body: JSON.stringify({ name: "hi", uid: "victim", session: { userId: "victim" } }),
    }));
    expect(resp.status).toBe(200);
    expect(rows(r.dir)).toEqual([{ author: "u-real", body: "hi" }]);
  }, T);
});

// ---------------------------------------------------------------------------
// 2. server code calling a CPS-split function is E-ROUTE-002 (§12.4 R2)
// ---------------------------------------------------------------------------

const SPLIT = `<last> = 0
  <x> = 0
  function add(n: number) {
    ?{\`INSERT INTO posts (author, body) VALUES ('a', \${n})\`}.run()
    @last = n
  }`;
const PROG = (rest, button = `<button id="go" onclick={ outer(3) }>go</button>`) => `<program db="./app.db">
  ${SPLIT}
  ${rest}
  ${button}
  <p>\${@last}</p>
</program>
`;

function expectRoute002(r, root, chain) {
  expect(codes(r.errors)).toEqual(["E-ROUTE-002"]);
  const msg = r.errors.map((e) => e.message).join("\n");
  expect(msg).toContain(`\`${root}\``);
  expect(msg).toContain("calls `add`, which is split across the client/server boundary");
  expect(msg).toContain("`@last`");
  expect(msg).toContain(`Call chain: ${chain}`);
  expect(r.serverJs).toBe("");
}

describe("s468 — server code calling a CPS-split function (§12.4 E-ROUTE-002)", () => {
  test("the gap reproducer: `server function outer(m) { add(m); return \"ok\" }`", () => {
    expectRoute002(compile(PROG(`server function outer(m: number) {
    add(m)
    return "ok"
  }`)), "outer", "outer -> add");
  });

  test("transitively, through a server-placed helper", () => {
    expectRoute002(compile(PROG(`function mid(m: number) { add(m) }
  server function outer(m: number) {
    mid(m)
    return "ok"
  }`)), "outer", "outer -> mid -> add");
  });

  test("an inferred server function (no `server` keyword)", () => {
    expectRoute002(compile(PROG(`function outer(m: number) {
    const r = ?{\`SELECT 1 AS v\`}.get()
    add(m)
    return r.v
  }`)), "outer", "outer -> add");
  });

  test("the server batch of a CPS-split caller", () => {
    expectRoute002(compile(PROG(`function g(m: number) {
    ?{\`INSERT INTO posts (author, body) VALUES ('g', \${m})\`}.run()
    add(m)
    @x = m
  }`, `<button id="go" onclick={ g(3) }>go</button>`)), "g", "g -> add");
  });

  test("the split function also has a client caller", () => {
    expectRoute002(compile(PROG(`server function outer(m: number) {
    add(m)
    return "ok"
  }`, `<button id="go" onclick={ outer(3) }>go</button>\n  <button id="go2" onclick={ add(4) }>go2</button>`)), "outer", "outer -> add");
  });

  test("a body-local function of the same name is not the split one", () => {
    const r = compile(PROG(`server function outer(m: number) {
    function add(k: number) { return k + 1 }
    return "" + add(m)
  }`));
    expect(r.errors).toEqual([]);
  });

  test("a CLIENT function calling a split function still compiles (the browser calls its wrapper)", () => {
    const r = compile(PROG(`function g(m: number) {
    add(m)
    @x = m
  }`, `<button id="go" onclick={ g(3) }>go</button>`));
    expect(r.errors).toEqual([]);
    expect(r.clientJs).toMatch(/await _scrml_cps_add_\d+\(m\)/);
  });

  test("a server function calling a NON-split server function still compiles and runs", async () => {
    const r = compile(PROG(`function put(n: number) {
    ?{\`INSERT INTO posts (author, body) VALUES ('p', \${n})\`}.run()
  }
  server function outer(m: number) {
    put(m)
    return "ok"
  }`));
    expect(r.errors).toEqual([]);
    const routes = await routesOf(r);
    const route = routes.find((x) => /__ri_route_outer_\d+/.test(x.path));
    const resp = await route.handler(new Request(`http://localhost${route.path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: "scrml_csrf=tok", "X-CSRF-Token": "tok" },
      body: JSON.stringify({ m: 7 }),
    }));
    expect(resp.status).toBe(200);
    expect(rows(r.dir)).toEqual([{ author: "p", body: "7" }]);
  }, T);
});
