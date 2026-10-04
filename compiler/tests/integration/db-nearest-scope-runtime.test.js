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
  });

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
  });

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
  });

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
  });

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
  });

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
