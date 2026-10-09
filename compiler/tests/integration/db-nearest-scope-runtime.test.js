/**
 * §8.1.1 (S451) — a `?{}` runs on its NEAREST enclosing database scope, AT RUNTIME.
 *
 * > "A `?{}` context resolves its database by walking up the ancestor tree from the
 * > `?{}` block's position to the closest database scope. Two elements are database
 * > scopes: a `<program>` with a `db=` attribute, and a `<db>` state block (its `src=`
 * > attribute). The NEAREST one wins, whichever of the two kinds it is."
 *
 * impl#1 used to open ONE handle per file (the first `<db src=>`, else the first
 * `<program db=>`) and run every `?{}` on it — a query silently read another
 * database's rows (g-impl1-db-resolution-not-nearest-s451, ruled a security fix).
 *
 * Each test compiles a program, seeds TWO real SQLite files whose `shared` table holds
 * a row naming its own database (`a.db` → "a", `b.db` → "b"), imports the compiled
 * server module and CALLS the route handler: the rows it returns say which database
 * the query actually ran on.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname, join } from "path";
import { writeFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { Database } from "bun:sqlite";
import { compileScrml } from "../../src/api.js";
import { safeRmSync } from "../helpers/self-host-server-import.js";

// Executed-DB tests (compile, then a real driver round-trip) and the hooks that build them
// declare their own budget: bun's 5 s default is too tight on the slow Windows CI runner
// (g-windows-executed-db-tests-5s-timeout-s460). Per test, never a raised global default.
const EXECUTED_DB_TIMEOUT_MS = 30_000;

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
const TMP_ROOT = resolve(testDir, "_tmp_db_nearest_scope");
const TEST_CSRF_TOKEN = "test-csrf-token-db-nearest-scope";
const opened = [];
let n = 0;

beforeAll(() => { if (!existsSync(TMP_ROOT)) mkdirSync(TMP_ROOT, { recursive: true }); });
afterAll(async () => {
  for (const mod of opened) { try { await mod.__closeAllSql?.(); } catch { /* best effort */ } }
  safeRmSync(TMP_ROOT);
});

function seed(dir, name) {
  const db = new Database(resolve(dir, `${name}.db`), { create: true });
  db.exec("CREATE TABLE shared (id INTEGER PRIMARY KEY, who TEXT NOT NULL)");
  db.exec(`INSERT INTO shared (who) VALUES ('${name}')`);
  db.close();
}

function compile(src, tag) {
  const dir = resolve(TMP_ROOT, `${tag}-${++n}`);
  mkdirSync(dir, { recursive: true });
  seed(dir, "a");
  seed(dir, "b");
  const input = resolve(dir, `${tag}.scrml`);
  writeFileSync(input, src);
  const out = resolve(dir, "dist");
  const result = compileScrml({ inputFiles: [input], write: true, outputDir: out, log: () => {} });
  const serverJsPath = join(out, `${tag}.server.js`);
  return {
    errors: (result.errors ?? []).filter((e) => !String(e.code ?? "").startsWith("W-") && e.severity !== "warning" && e.severity !== "info"),
    serverJsPath,
    text: existsSync(serverJsPath) ? readFileSync(serverJsPath, "utf-8") : "",
  };
}

/** Import the module with a disposal export closing EVERY handle it declares. */
async function load(serverJsPath) {
  const text = readFileSync(serverJsPath, "utf-8");
  const idents = [...text.matchAll(/^const (_scrml_sql(?:_\d+)?) = /gm)].map((m) => m[1]);
  const close = idents.map((id) => `try { await ${id}.close(); } catch {}`).join(" ");
  writeFileSync(serverJsPath, text + `\nexport const __closeAllSql = async () => { ${close} };\n`);
  const mod = await import(`file://${serverJsPath}?v=${Date.now()}-${Math.random()}`);
  opened.push(mod);
  return mod;
}

async function call(mod, fnName) {
  const route = Object.values(mod).find(
    (v) => v && typeof v === "object" && typeof v.path === "string" && v.path.includes(fnName),
  );
  expect(route).toBeDefined();
  const resp = await route.handler(new Request(`http://localhost${route.path}`, {
    method: route.method ?? "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": TEST_CSRF_TOKEN,
      "Cookie": `scrml_csrf=${TEST_CSRF_TOKEN}`,
    },
    body: JSON.stringify({}),
  }));
  expect(resp.status).toBe(200);
  return resp.json();
}

/** happy-dom (registered by the browser suite) filters the CSRF headers; see
 *  sql-server-fn-runtime.test.js. The emitted-handle assertions still run. */
const domPolluted = () => typeof globalThis.document !== "undefined";

const Q = "?{`SELECT who FROM shared`}.all()";

describe("§8.1.1 nearest database scope — which database a query hits at runtime", () => {
  test("shape 1: `?{}` inside `<program db=b>` nested in `<program db=a>` runs on b", async () => {
    const { errors, serverJsPath, text } = compile(`<program db="./a.db">
<program db="./b.db">
\${
  function inner() {
    return ${Q}
  }
}
<p>inner</p>
</program>
</program>
`, "nested-programs");
    expect(errors).toEqual([]);
    expect(text).not.toMatch(/_scrml_sqlite_referenced\("[^"]*a\.db"/);
    if (domPolluted()) return;
    const mod = await load(serverJsPath);
    expect(await call(mod, "inner")).toEqual([{ who: "b" }]);
  }, EXECUTED_DB_TIMEOUT_MS);

  test("shape 2: `?{}` inside `<db src=b>` under `<program db=a>` runs on b", async () => {
    const { errors, serverJsPath } = compile(`<program db="./a.db">
<db src="./b.db" tables="shared">
\${
  function inDb() {
    return ${Q}
  }
}
<p>x</p>
</>
</program>
`, "db-under-program");
    expect(errors).toEqual([]);
    if (domPolluted()) return;
    const mod = await load(serverJsPath);
    expect(await call(mod, "inDb")).toEqual([{ who: "b" }]);
  }, EXECUTED_DB_TIMEOUT_MS);

  test("shape 3: `?{}` directly in `<program db=a>` beside a `<db src=b>` block runs on a; the one inside runs on b", async () => {
    const { errors, serverJsPath, text } = compile(`<program db="./a.db">
\${
  function outer() {
    return ${Q}
  }
}
<db src="./b.db" tables="shared">
\${
  function inDb() {
    return ${Q}
  }
}
<p>x</p>
</>
</program>
`, "program-beside-db");
    expect(errors).toEqual([]);
    // Two databases → two handles, each declared once.
    expect([...text.matchAll(/^const _scrml_sql(?:_\d+)? = /gm)].length).toBe(2);
    if (domPolluted()) return;
    const mod = await load(serverJsPath);
    expect(await call(mod, "outer")).toEqual([{ who: "a" }]);
    expect(await call(mod, "inDb")).toEqual([{ who: "b" }]);
  }, EXECUTED_DB_TIMEOUT_MS);

  test("shape 4: `<db src=b>` under a `<program>` with no db= runs on b", async () => {
    const { errors, serverJsPath } = compile(`<program>
<db src="./b.db" tables="shared">
\${
  function inDb() {
    return ${Q}
  }
}
<p>x</p>
</>
</program>
`, "db-no-program-db");
    expect(errors).toEqual([]);
    if (domPolluted()) return;
    const mod = await load(serverJsPath);
    expect(await call(mod, "inDb")).toEqual([{ who: "b" }]);
  }, EXECUTED_DB_TIMEOUT_MS);

  test("single database (common case) is unchanged: one `_scrml_sql` handle, queries hit it", async () => {
    const { errors, serverJsPath, text } = compile(`<program db="./a.db">
\${
  function load() {
    return ${Q}
  }
}
<p>x</p>
</program>
`, "single-db");
    expect(errors).toEqual([]);
    expect([...text.matchAll(/^const (_scrml_sql(?:_\d+)?) = /gm)].map((m) => m[1])).toEqual(["_scrml_sql"]);
    if (domPolluted()) return;
    const mod = await load(serverJsPath);
    expect(await call(mod, "load")).toEqual([{ who: "a" }]);
  }, EXECUTED_DB_TIMEOUT_MS);

  test("two scopes naming the SAME database share one handle (one connection, one transaction guard)", async () => {
    const { errors, serverJsPath, text } = compile(`<program db="./a.db">
\${
  function outer() {
    return ${Q}
  }
}
<db src="a.db" tables="shared">
\${
  function inDb() {
    return ${Q}
  }
}
<p>x</p>
</>
</program>
`, "same-db-twice");
    expect(errors).toEqual([]);
    expect([...text.matchAll(/^const (_scrml_sql(?:_\d+)?) = /gm)].map((m) => m[1])).toEqual(["_scrml_sql"]);
    if (domPolluted()) return;
    const mod = await load(serverJsPath);
    expect(await call(mod, "outer")).toEqual([{ who: "a" }]);
    expect(await call(mod, "inDb")).toEqual([{ who: "a" }]);
  }, EXECUTED_DB_TIMEOUT_MS);

  test("MED-2: two `<db src=\":memory:\">` blocks are two databases — a table made in one is not in the other", async () => {
    const { errors, serverJsPath, text } = compile(`<program>
<db src=":memory:" tables="t1">
\${
  function makeOne() {
    ?{\`CREATE TABLE IF NOT EXISTS t1 (who TEXT)\`}.run()
    return ?{\`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name\`}.all()
  }
}
<p>a</p>
</>
<db src=":memory:" tables="t2">
\${
  function makeTwo() {
    ?{\`CREATE TABLE IF NOT EXISTS t2 (who TEXT)\`}.run()
    return ?{\`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name\`}.all()
  }
}
<p>b</p>
</>
</program>
`, "two-memory");
    expect(errors).toEqual([]);
    expect([...text.matchAll(/^const (_scrml_sql(?:_\d+)?) = /gm)].map((m) => m[1])).toEqual(["_scrml_sql", "_scrml_sql_1"]);
    if (domPolluted()) return;
    const mod = await load(serverJsPath);
    expect(await call(mod, "makeOne")).toEqual([{ name: "t1" }]);
    expect(await call(mod, "makeTwo")).toEqual([{ name: "t2" }]);
  }, EXECUTED_DB_TIMEOUT_MS);

  test("HIGH-1: a db-authoritative program's queries are principal-wrapped on EVERY handle, the authoritative one included", () => {
    const { errors, text } = compile(`<program db="postgres://localhost/app">
  <schema>
    invoices {
      id: text primary key
      tenant_id: text not null
      amount: real not null
    } db-authoritative
  </schema>

  function listInvoices() {
    const rows = ?{ select id, tenant_id, amount from invoices }
    rows
  }

  <db src="./b.db" tables="shared">
    \${
    function listShared() {
      const r = ?{ select who from shared }
      r
    }
    }
  </db>
</program>
`, "dbauth-two-dbs");
    expect(errors).toEqual([]);
    // The authoritative database is NOT the default handle (the first <db src> is).
    expect(text).toMatch(/^const _scrml_sql_1 = _scrml_db_guard\(new SQL\("postgres:\/\/localhost\/app"\)/m);
    const auth = text.slice(text.indexOf("_scrml_handler_listInvoices"), text.indexOf("_scrml_route_listInvoices"));
    expect(auth).toContain("_scrml_sql_1.begin(async (tx) =>");
    expect(auth).toContain("set_config('scrml.tenant'");
    expect(auth).toContain('tx.unsafe("SET LOCAL ROLE scrml_app")');
    // (§14.8.10 S452: the floor appends its reserved key column and filters the
    // transaction's rows at the source.)
    expect(auth).toContain('return await tx.unsafe("select id, tenant_id, amount, invoices.tenant_id AS __scrml_tenant_0 from invoices")');
    expect(auth).not.toMatch(/await _scrml_sql_1\.unsafe\("select/);
    // The other database's query is wrapped exactly as before (default handle).
    const other = text.slice(text.indexOf("_scrml_handler_listShared"), text.indexOf("_scrml_route_listShared"));
    expect(other).toContain("_scrml_sql.begin(async (tx) =>");
    expect(other).toContain('return await tx.unsafe("select who from shared")');
  });

  test("fail closed: an unscoped `?{}` in a two-database file never lowers onto the first database", () => {
    const { errors, text } = compile(`\${
  function loose() {
    return ${Q}
  }
}
<program db="./a.db">
<db src="./b.db" tables="shared">
<p>x</p>
</>
</program>
`, "unscoped-fail-closed");
    const codes = errors.map((e) => e.code);
    expect(codes).toContain("E-SQL-004");
    expect(codes).toContain("E-INTERNAL-DB-HANDLE-UNRESOLVED");
    const loose = text.slice(text.indexOf("_scrml_handler_loose"), text.indexOf("_scrml_route_loose"));
    expect(loose).not.toMatch(/await _scrml_sql(?:_\d+)?`SELECT who FROM shared`/);
  });

  test("a `?{}` outside every database scope, in a file with two databases, is E-SQL-004 (it used to run on the file's first `<db src>`)", () => {
    const { errors } = compile(`\${
  function loose() {
    return ${Q}
  }
}
<program db="./a.db">
<db src="./b.db" tables="shared">
<p>x</p>
</>
</program>
`, "unscoped");
    expect(errors.map((e) => e.code)).toContain("E-SQL-004");
  });
});
