/**
 * S462 P0 (SECURITY) — SQL result over-sharing: the chain after a `?{}` query
 * was truncated, EXECUTED.
 *
 * SPEC §8.3: "The result of a `?{ }` context is a query result object." —
 * `.get()` is `Row | not`, `.all()` is `Row[]` (§44.3). Whatever is written
 * after the terminator is ordinary code over that value.
 *
 * THE DEFECT, MEASURED (base 1c1e9eee5): in statement position (`return`,
 * `const`/`let`, `lift`, `yield`, a bare statement) the parser took EVERY
 * `.name` after the block as a "chained call" and the lowering applied only the
 * first. `return ?{SELECT name, pw …}.get().name` served the WHOLE ROW — the
 * password hash went to the client. `.all().length` served every row, `.get()?.name`
 * and `.all()[0].name` lost their tail as a stray statement, and `d ?? ?{…}`
 * split the statement in two.
 *
 * THE FIX: the statement sites take the structured path only when the query and
 * its SQL chain are the WHOLE operand; otherwise the site parses as an
 * expression, whose `sql-ref` operand lowers exactly as the structured query and
 * whose tail applies to its value (as in JS).
 *
 * Each app is compiled, its server bundle imported under bun with a real
 * bun:sqlite database, and every route driven with a real Request; the RAW
 * response body is asserted. Every assertion on a body fails on the base.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { writeFileSync, readFileSync, mkdtempSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Database } from "bun:sqlite";
import { compileScrml } from "../../src/api.js";
import { patchAndImport, closeOpenedDbHandles, safeRmSync } from "../helpers/self-host-server-import.js";

const TIMEOUT = 30_000;
const SECRET = "HASH-SECRET-9f2c";

const FNS = `
      function getName(id) {
        return ?{\`SELECT name, pw FROM users WHERE id = \${id}\`}.get().name
      }
      function getNameConst(id) {
        const n = ?{\`SELECT name, pw FROM users WHERE id = \${id}\`}.get().name
        return n
      }
      function getNameLet(id) {
        let n = ?{\`SELECT name, pw FROM users WHERE id = \${id}\`}.get().name
        return n
      }
      function nameLen(id) {
        return ?{\`SELECT name, pw FROM users WHERE id = \${id}\`}.get().name.length
      }
      function count() {
        return ?{\`SELECT name, pw FROM users\`}.all().length
      }
      function names() {
        return ?{\`SELECT name, pw FROM users ORDER BY id\`}.all().map(u => u.name)
      }
      function joined() {
        return ?{\`SELECT name, pw FROM users ORDER BY id\`}.all().map(u => u.name).join(",")
      }
      function firstName() {
        return ?{\`SELECT name, pw FROM users ORDER BY id\`}.all()[0].name
      }
      function plusOne(id) {
        return ?{\`SELECT id, pw FROM users WHERE id = \${id}\`}.get().id + 1
      }
      function runChanges(id) {
        return ?{\`UPDATE users SET name = name WHERE id = \${id}\`}.run().changes
      }
`;
const CALLED = ["getName", "getNameConst", "getNameLet", "nameLen", "count", "names", "joined",
  "firstName", "plusOne", "runChanges"];

// A query that is an OPERAND (after `?`, `??`), is followed by `?.` or a word
// operator (`is not`), or whose tail call has nested parentheses: on the base
// these did not compile at all (the statement split in two — invalid JS, or a
// mis-read `?` / `is`; the chain reader stopped at the first `)`), so they are a
// separate app.
const OPERAND_FNS = `
      function missing(id) {
        return ?{\`SELECT name, pw FROM users WHERE id = \${id}\`}.get() is not
      }
      function viaTernary(id, flag) {
        return flag ? ?{\`SELECT name, pw FROM users WHERE id = \${id}\`}.get().name : "anon"
      }
      function viaNullish(id, d) {
        return d ?? ?{\`SELECT name, pw FROM users WHERE id = \${id}\`}.get().name
      }
      function optName(id) {
        return ?{\`SELECT name, pw FROM users WHERE id = \${id}\`}.get()?.name
      }
      function propName(id)! -> SqlError {
        const r = ?{\`SELECT name, pw FROM users WHERE id = \${id}\`}.get()?
        if (r is not) { return "none" }
        return r.name
      }
      function parenLambda() {
        return ?{\`SELECT name, pw FROM users ORDER BY id\`}.all().map((u) => u.name)
      }
`;
const OPERAND_CALLED = ["optName", "missing", "viaTernary", "viaNullish", "parenLambda", "propName"];

const app = (dbAttrs, fns, called) => `<program auth="none" db="./app.db">
  <schema>
    ?{\`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, pw TEXT)\`}
  </schema>
  <db src="./app.db" ${dbAttrs}>
    \${
${fns}
    }
  </db>
  <out> = ""
${called.map((f) => `  <button onclick={ @out = ${f}(1) !{ .Transport(_) :> { return } } }>${f}</button>`).join("\n")}
</program>
`;

const TMP = mkdtempSync(join(tmpdir(), "s462-sql-chain-"));
afterAll(async () => {
  await closeOpenedDbHandles();
  safeRmSync(TMP);
});

let seq = 0;
function compileApp(src) {
  const dir = join(TMP, `a${seq++}`);
  const outDir = join(dir, "dist");
  mkdirSync(outDir, { recursive: true });
  const file = join(dir, "app.scrml");
  writeFileSync(file, src);
  const result = compileScrml({ inputFiles: [file], write: true, outputDir: outDir, log: () => {} });
  return { dir, outDir, result };
}

async function serveApp(src) {
  const { dir, outDir, result } = compileApp(src);
  const fatal = (result.errors ?? []).filter((e) => !/^[WI]-/.test(e.code ?? ""));
  expect(fatal.map((e) => e.code + " " + e.message)).toEqual([]);
  const dbPath = join(dir, "app.db");
  const db = new Database(dbPath, { create: true });
  db.run("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT, pw TEXT)");
  db.run("INSERT INTO users (id, name, pw) VALUES (1, 'ada', ?), (2, 'bob', ?)", [SECRET, SECRET + "-2"]);
  db.close();
  const serverJsPath = join(outDir, "app.server.js");
  const serverJs = readFileSync(serverJsPath, "utf8");
  const clientJs = readFileSync(join(outDir, "app.client.js"), "utf8");
  const mod = await patchAndImport(serverJsPath, dbPath);
  const post = async (fnName, args) => {
    const route = mod.routes.find((r) => new RegExp(`/__ri_route_${fnName}_\\d+$`).test(r.path));
    expect(route).toBeTruthy();
    const res = await route.handler(new Request(`http://localhost${route.path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": "t", Cookie: "scrml_csrf=t" },
      body: JSON.stringify(args),
    }));
    return { status: res.status, body: await res.text() };
  };
  return { post, serverJs, clientJs, mod };
}

describe("S462 P0 — the chain after `?{}` applies to the query's value (no protect=)", () => {
  let a;
  beforeAll(async () => { a = await serveApp(app(`tables="users"`, FNS, CALLED)); }, TIMEOUT);

  const ok = (body) => ({ status: 200, body });

  test("`.get().name` serves ONLY the name — never the password hash", async () => {
    const r = await a.post("getName", { id: 1 });
    expect(r).toEqual(ok(JSON.stringify("ada")));
    expect(r.body).not.toContain(SECRET);
  }, TIMEOUT);
  test("`const n = ….get().name` serves only the name", async () => {
    const r = await a.post("getNameConst", { id: 1 });
    expect(r).toEqual(ok(JSON.stringify("ada")));
    expect(r.body).not.toContain(SECRET);
  }, TIMEOUT);
  test("`let n = ….get().name` serves only the name", async () => {
    expect(await a.post("getNameLet", { id: 2 })).toEqual(ok(JSON.stringify("bob")));
  }, TIMEOUT);
  test("`.get().name.length` is the name's length", async () => {
    expect(await a.post("nameLen", { id: 1 })).toEqual(ok("3"));
  }, TIMEOUT);
  test("`.all().length` is the row count", async () => {
    expect(await a.post("count", {})).toEqual(ok("2"));
  }, TIMEOUT);
  test("`.all().map(u => u.name)` serves only the names", async () => {
    const r = await a.post("names", {});
    expect(r).toEqual(ok(JSON.stringify(["ada", "bob"])));
    expect(r.body).not.toContain(SECRET);
  }, TIMEOUT);
  test("a method call after `.map(…)` applies too", async () => {
    expect(await a.post("joined", {})).toEqual(ok(JSON.stringify("ada,bob")));
  }, TIMEOUT);
  test("`.all()[0].name` serves only the first name", async () => {
    const r = await a.post("firstName", {});
    expect(r).toEqual(ok(JSON.stringify("ada")));
    expect(r.body).not.toContain(SECRET);
  }, TIMEOUT);
  test("`.get().id + 1` is arithmetic on the field", async () => {
    expect(await a.post("plusOne", { id: 1 })).toEqual(ok("2"));
  }, TIMEOUT);
  test("`.run().changes` applies `.changes` to `.run()`'s value (§8.5.1: no RunResult shim)", async () => {
    // `.run()` is `void` in scrml (§8.5.1) and the compiler synthesizes no
    // `{ changes }`; the member access is applied, so the value is absent — never
    // the driver's result array.
    expect(await a.post("runChanges", { id: 1 })).toEqual(ok("null"));
  }, TIMEOUT);
  test("no query text reaches the client bundle", () => {
    expect(a.clientJs).not.toContain("SELECT name, pw");
    expect(a.clientJs).not.toContain("_scrml_sql");
  });
});

describe("S462 P0 — a query that is an operand keeps its statement whole", () => {
  let a;
  beforeAll(async () => { a = await serveApp(app(`tables="users"`, OPERAND_FNS, OPERAND_CALLED)); }, TIMEOUT);
  const ok = (body) => ({ status: 200, body });

  test("`.get() is not` is a boolean", async () => {
    expect(await a.post("missing", { id: 1 })).toEqual(ok("false"));
    expect(await a.post("missing", { id: 99 })).toEqual(ok("true"));
  }, TIMEOUT);
  test("a query in a ternary arm keeps the statement whole", async () => {
    expect(await a.post("viaTernary", { id: 1, flag: true })).toEqual(ok(JSON.stringify("ada")));
    expect(await a.post("viaTernary", { id: 1, flag: false })).toEqual(ok(JSON.stringify("anon")));
  }, TIMEOUT);
  test("`.get()?.name` serves only the name; no row is `not`", async () => {
    const r = await a.post("optName", { id: 1 });
    expect(r).toEqual(ok(JSON.stringify("ada")));
    expect(r.body).not.toContain(SECRET);
    expect(await a.post("optName", { id: 99 })).toEqual(ok("null"));
  }, TIMEOUT);
  test("`const r = ?{…}.get()?` in a `!` function is server-placed; no row is `not`, not a crash", async () => {
    // Base: the statement split (`const tmp = ;`, E-CODEGEN-INVALID-LOGIC). With the
    // tail routed through the expression path the function must still be
    // server-placed (route inference reads the propagate-expr) and the propagation
    // test must not dereference a `not` success value.
    expect(a.clientJs).not.toContain("sql-ref unresolved");
    expect(await a.post("propName", { id: 1 })).toEqual(ok(JSON.stringify("ada")));
    expect(await a.post("propName", { id: 99 })).toEqual(ok(JSON.stringify("none")));
  }, TIMEOUT);
  test("a call with nested parentheses after the query (`.map((u) => …)`) is one call", async () => {
    const r = await a.post("parenLambda", {});
    expect(r).toEqual(ok(JSON.stringify(["ada", "bob"])));
    expect(r.body).not.toContain(SECRET);
  }, TIMEOUT);
  test("a query after `??` keeps the statement whole", async () => {
    expect(await a.post("viaNullish", { id: 1, d: "x" })).toEqual(ok(JSON.stringify("x")));
    const r = await a.post("viaNullish", { id: 1 });
    expect(r).toEqual(ok(JSON.stringify("ada")));
    expect(r.body).not.toContain(SECRET);
  }, TIMEOUT);
});

describe("S462 P0 — protect= with the chain applied (§14.8.9)", () => {
  const PFNS = `
      function getName(id) {
        return ?{\`SELECT name, pw FROM users WHERE id = \${id}\`}.get().name
      }
      function firstRow() {
        return ?{\`SELECT * FROM users ORDER BY id\`}.all()[0]
      }
      function rows() {
        return ?{\`SELECT * FROM users ORDER BY id\`}.all().slice(0, 1)
      }
      function wholeRow(id) {
        return ?{\`SELECT * FROM users WHERE id = \${id}\`}.get()
      }
`;
  let a;
  beforeAll(async () => {
    a = await serveApp(app(`tables="users" protect="pw"`, PFNS, ["getName", "firstRow", "rows", "wholeRow"]));
  }, TIMEOUT);

  test("`.get().name` serves only the name", async () => {
    expect(await a.post("getName", { id: 1 })).toEqual({ status: 200, body: JSON.stringify("ada") });
  }, TIMEOUT);
  test("a row that leaves through `.all()[0]` is still stripped", async () => {
    const r = await a.post("firstRow", {});
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ id: 1, name: "ada" });
    expect(r.body).not.toContain(SECRET);
  }, TIMEOUT);
  test("rows that leave through `.all().slice(…)` are still stripped", async () => {
    const r = await a.post("rows", {});
    expect(JSON.parse(r.body)).toEqual([{ id: 1, name: "ada" }]);
    expect(r.body).not.toContain(SECRET);
  }, TIMEOUT);
  test("the whole row (`.get()`) is stripped, as before", async () => {
    const r = await a.post("wholeRow", { id: 1 });
    expect(JSON.parse(r.body)).toEqual({ id: 1, name: "ada" });
    expect(r.body).not.toContain(SECRET);
  }, TIMEOUT);

  test("`.get().pw` — the protected column ALONE — is a compile error (E-PROTECT-006), never served", () => {
    const src = app(`tables="users" protect="pw"`, `
      function leak(id) {
        return ?{\`SELECT name, pw FROM users WHERE id = \${id}\`}.get().pw
      }
`, ["leak"]);
    const { result } = compileApp(src);
    expect((result.errors ?? []).map((e) => e.code)).toContain("E-PROTECT-006");
  });
});

describe("S462 P0 — a server cell initialized by `?{…}` + a tail (§8.11 / §52.6.5)", () => {
  // Base: `<firstName server> = ?{…}.get().name` built the structured load route
  // from the query alone — `/__serverLoad/firstName` served the WHOLE ROW
  // (`{"name":"ada","pw":"HASH-…"}`) and `/__serverLoad/count` every row.
  const CELLS = `<program auth="none" db="./app.db">
  <schema>
    ?{\`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, pw TEXT)\`}
  </schema>
  <firstName server> = ?{\`SELECT name, pw FROM users WHERE id = 1\`}.get().name
  <count server> = ?{\`SELECT name, pw FROM users\`}.all().length
  <p>\${@firstName} \${@count}</p>
</program>
`;
  let a;
  beforeAll(async () => { a = await serveApp(CELLS); }, TIMEOUT);

  test("every load route serves only the cells' values — never a row, never the hash", async () => {
    const bodies = {};
    for (const route of a.mod.routes) {
      if (!/__mountHydrate|__serverLoad/.test(route.path)) continue;
      const res = await route.handler(new Request(`http://localhost${route.path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": "t", Cookie: "scrml_csrf=t" },
        body: "{}",
      }));
      bodies[route.path] = await res.text();
    }
    expect(Object.keys(bodies).length).toBeGreaterThan(0);
    for (const body of Object.values(bodies)) expect(body).not.toContain(SECRET);
    const merged = Object.values(bodies).map((b) => JSON.parse(b)).reduce((m, v) => ({ ...m, ...v }), {});
    expect(merged).toEqual({ firstName: "ada", count: 2 });
  }, TIMEOUT);
});

describe("S465 fix round 1 — a `!{}` handler on a tailed `?{}` handles the QUERY (§19.8.3 / §44.3)", () => {
  // §44.3: "the `?{}` is a failable expression in every context". A tail
  // (`.name`, `.length`) applies to the query's SUCCESS value; the query itself
  // is still attempt-wrapped, so a query that fails to run reaches the handler's
  // arms as a SqlError variant. After f6f00bb3c the tailed site went through the
  // expression path and the handler was silently dropped: the failure THREW out of
  // the route (`SQLiteError: integer overflow`) and a partial handler compiled.
  // `abs(-9223372036854775808)` makes SQLite fail the query at run time.
  const FAIL = "AND abs(-9223372036854775808) > 0";
  const HFNS = `
      function constQf(id) {
        const n = ?{\`SELECT name, pw FROM users WHERE id = \${id} ${FAIL}\`}.get().name !{
          .QueryFailed(e) :> { return "qf" }
          .ConstraintViolation(e) :> { return "cv" }
          .ConnectionLost(e) :> { return "cl" }
          .BatchPrepareFailed(e) :> { return "bp" }
        }
        return n
      }
      function letWild(id) {
        let n = ?{\`SELECT name, pw FROM users WHERE id = \${id} ${FAIL}\`}.all().length !{
          _ :> { return "let-caught" }
        }
        return n
      }
      function returnWild(id) {
        return ?{\`SELECT name, pw FROM users WHERE id = \${id} ${FAIL}\`}.get().name !{
          _ :> { return "return-caught" }
        }
      }
      function reassignWild(id) {
        let n = 0
        n = ?{\`SELECT name, pw FROM users WHERE id = \${id} ${FAIL}\`}.all().length !{
          _ :> { return "reassign-caught" }
        }
        return n
      }
      function constOk(id) {
        const n = ?{\`SELECT name, pw FROM users WHERE id = \${id}\`}.get().name !{
          _ :> { return "unexpected" }
        }
        return n
      }
      function letOk() {
        let n = ?{\`SELECT name, pw FROM users\`}.all().length !{ _ :> { return -1 } }
        return n
      }
      function returnOk(id) {
        return ?{\`SELECT name, pw FROM users WHERE id = \${id}\`}.get()?.name !{ _ :> { return "unexpected" } }
      }
      function reassignOk() {
        let n = 0
        n = ?{\`SELECT name, pw FROM users\`}.all().map(u => u.name) !{ _ :> { return [] } }
        return n
      }
`;
  const HCALLED = ["constQf", "letWild", "returnWild", "reassignWild", "constOk", "letOk", "returnOk", "reassignOk"];
  let a;
  beforeAll(async () => { a = await serveApp(app(`tables="users"`, HFNS, HCALLED)); }, TIMEOUT);
  const ok = (body) => ({ status: 200, body });

  test("const: a failing query reaches the `.QueryFailed` arm", async () => {
    expect(await a.post("constQf", { id: 1 })).toEqual(ok(JSON.stringify("qf")));
  }, TIMEOUT);
  test("let: a failing query reaches the `_` arm", async () => {
    expect(await a.post("letWild", { id: 1 })).toEqual(ok(JSON.stringify("let-caught")));
  }, TIMEOUT);
  test("return: a failing query reaches the `_` arm", async () => {
    expect(await a.post("returnWild", { id: 1 })).toEqual(ok(JSON.stringify("return-caught")));
  }, TIMEOUT);
  test("reassign: a failing query reaches the `_` arm", async () => {
    expect(await a.post("reassignWild", { id: 1 })).toEqual(ok(JSON.stringify("reassign-caught")));
  }, TIMEOUT);
  test("on success the tail applies to the query's value — never the row", async () => {
    const c = await a.post("constOk", { id: 1 });
    expect(c).toEqual(ok(JSON.stringify("ada")));
    expect(c.body).not.toContain(SECRET);
    expect(await a.post("letOk", {})).toEqual(ok("2"));
    expect(await a.post("returnOk", { id: 2 })).toEqual(ok(JSON.stringify("bob")));
    expect(await a.post("returnOk", { id: 99 })).toEqual(ok("null"));
    const r = await a.post("reassignOk", {});
    expect(r).toEqual(ok(JSON.stringify(["ada", "bob"])));
    expect(r.body).not.toContain(SECRET);
  }, TIMEOUT);
  test("every handled query is evaluated through `_scrml_sql_attempt`", () => {
    expect((a.serverJs.match(/await _scrml_sql_attempt\(/g) ?? []).length).toBeGreaterThanOrEqual(HCALLED.length);
  });

  const PARTIAL = `!{
          .QueryFailed(e) :> { return "qf" }
        }`;
  for (const [form, body] of [
    ["const", `const n = ?{\`SELECT name, pw FROM users WHERE id = \${id}\`}.get().name ${PARTIAL}
        return n`],
    ["let", `let n = ?{\`SELECT name, pw FROM users WHERE id = \${id}\`}.all().length ${PARTIAL}
        return n`],
    ["return", `return ?{\`SELECT name, pw FROM users WHERE id = \${id}\`}.get().name ${PARTIAL}`],
    ["reassign", `let n = 0
        n = ?{\`SELECT name, pw FROM users WHERE id = \${id}\`}.all().length ${PARTIAL}
        return n`],
  ]) {
    test(`${form}: a partial handler on a tailed query is E-TYPE-080 (exhaustive against SqlError)`, () => {
      const src = app(`tables="users"`, `
      function f(id) {
        ${body}
      }
`, ["f"]);
      const { result } = compileApp(src);
      const e080 = (result.errors ?? []).find((e) => e.code === "E-TYPE-080");
      expect(e080).toBeTruthy();
      expect(e080.message).toContain("SqlError");
      expect(e080.message).toContain("ConstraintViolation");
    });
  }
  test("a bogus variant arm on a tailed query is E-TYPE-080 too", () => {
    const src = app(`tables="users"`, `
      function f(id) {
        const n = ?{\`SELECT name, pw FROM users WHERE id = \${id}\`}.get().name !{
          .Nonsense(e) :> { return "x" }
        }
        return n
      }
`, ["f"]);
    expect((compileApp(src).result.errors ?? []).map((e) => e.code)).toContain("E-TYPE-080");
  });
});
