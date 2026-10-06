/**
 * S456 — §8.10 Tier 2 loop hoisting: the four divergences the S239 review of #1325
 * executed (gap g-impl1-hoist-batching-divergences-s455), each restored toward
 * §8.10.3 "The rewritten loop is observationally equivalent to the un-rewritten loop
 * on all side-effect orderings."
 *
 *   (1) key matching — rows are matched to keys by SQL's own `=` (a key table), not by
 *       JS identity on the key value (hoist-sql-shape.ts HOIST_KEY_TABLE);
 *   (2) writes between iterations — a body that may write is not hoisted
 *       (hoist-write-scan.ts, D-BATCH-001);
 *   (3) pre-fetch failure timing — held and raised by the first read that runs;
 *   (4) §8.10.6 chunking — at most `batch-in-list-cap` keys per pre-fetch statement.
 * Plus: the pre-fetch is SQLite SQL, so a non-SQLite database is not hoisted.
 *
 * Runtime pins (real bun:sqlite, each cell == `.nobatch()`):
 *   conformance/cases/server-db/sql-hoisted-loop-{key-affinity,write-between-iterations,
 *   prefetch-failure-timing,chunked}-rt. This file pins the HOIST DECISION for those
 *   sources (a runtime pin cannot tell a correct hoist from no hoist) and the pieces.
 */

import { describe, test, expect } from "bun:test";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { compileScrml } from "../../src/api.js";
import { classifyHoistableQuery, HOIST_VALUES_PLACEHOLDER, HOIST_VAL_ALIAS } from "../../src/hoist-sql-shape.ts";
import { HOIST_KEY_ALIAS, runBatchPlanner } from "../../src/batch-planner.ts";
import { sqlIsPlainRead } from "../../src/hoist-write-scan.ts";

const CASES = join(import.meta.dir, "..", "..", "..", "conformance", "cases", "server-db");

function compile(source) {
  const dir = mkdtempSync(join(tmpdir(), "scrml-s456-"));
  const file = join(dir, "test.scrml");
  writeFileSync(file, source);
  try {
    const r = compileScrml({ inputFiles: [file], outputDir: null, write: false, log: () => {} });
    const serverJs = [...(r.outputs?.values() ?? [])].map((o) => o.serverJs ?? "").join("\n");
    return { r, serverJs, hoists: (serverJs.match(/§8\.10 Tier 2 loop hoist/g) ?? []).length, reasons: r.batchPlan.diagnostics.map((d) => d.reason) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const caseSource = (name) => readFileSync(join(CASES, name, "case.scrml"), "utf8");

/** A program whose one server function loops over `items` with `body` (the loop body). */
function program(body, { before = "", db = "./app.db" } = {}) {
  return [
    `<program db="${db}">`,
    "    <schema>",
    "        notes {",
    "            id: integer primary key",
    "            body: text",
    "        }",
    "    </schema>",
    before,
    "    function f(items) {",
    "        let out = []",
    "        for (const it of items) {",
    "            const row = ?{`SELECT body FROM notes WHERE id = ${it.id}`}.get()",
    body,
    "        }",
    "        return out",
    "    }",
    "    <p>x</p>",
    "</program>",
  ].join("\n");
}

describe("the hoist decision for the S456 runtime cases", () => {
  test("(1) key-affinity: all three loops hoisted", () => {
    const c = compile(caseSource("sql-hoisted-loop-key-affinity-rt"));
    expect(c.hoists).toBe(3);
    // the hoist emits no `undefined` (W-CG-UNDEFINED-INTERPOLATION, §42 absence canon)
    const codes = [...(c.r.errors ?? []), ...(c.r.warnings ?? [])].map((d) => d.code);
    expect(codes).not.toContain("W-CG-UNDEFINED-INTERPOLATION");
  });
  test("(2) write-between-iterations: no loop hoisted, each with a D-BATCH-001 near-miss naming the call", () => {
    const c = compile(caseSource("sql-hoisted-loop-write-between-iterations-rt"));
    expect(c.hoists).toBe(0);
    expect(c.reasons.filter((r) => /cannot prove does not write the database/.test(r))).toHaveLength(3);
    expect(c.reasons.some((r) => r.includes("`bump(…)`"))).toBe(true);
    expect(c.reasons.some((r) => r.includes("`bumpTwice(…)`"))).toBe(true);
  });
  test("(3) prefetch-failure-timing: all three loops hoisted", () => {
    expect(compile(caseSource("sql-hoisted-loop-prefetch-failure-timing-rt")).hoists).toBe(3);
  });
  test("(4) chunked: both loops hoisted, chunk size from batch-in-list-cap", () => {
    const c = compile(caseSource("sql-hoisted-loop-chunked-rt"));
    expect(c.hoists).toBe(2);
    expect(c.serverJs).toContain("for (let _at = 0; _at < _keys.length; _at += 2) {");
    expect(c.serverJs).not.toContain("E-BATCH-002");
  });
});

describe("(2) the write scan — hoist only a body PROVEN not to write", () => {
  test("control: a call to a local function that does not write keeps the hoist", () => {
    const c = compile(program("            out.push(shout(row))", { before: "    function shout(r) {\n        return r\n    }" }));
    expect(c.hoists).toBe(1);
  });
  test("control: a local function that only READS keeps the hoist", () => {
    const c = compile(program("            out.push(count())", { before: "    function count() {\n        return ?{`SELECT count(*) AS n FROM notes`}.get()\n    }" }));
    expect(c.hoists).toBe(1);
  });
  test("control: built-ins (Math, JSON, console, String, new Map) keep the hoist", () => {
    const c = compile(program("            out.push(Math.max(1, 2))\n            console.log(JSON.stringify(row))\n            out.push(String(it.id))\n            const m = new Map()"));
    expect(c.hoists).toBe(1);
  });
  test("a call to a function whose body writes is not hoisted", () => {
    const c = compile(program("            touch(it.id)", { before: "    function touch(id) {\n        ?{`DELETE FROM notes WHERE id = ${id}`}.run()\n    }" }));
    expect(c.hoists).toBe(0);
    expect(c.reasons.some((r) => r.includes("`touch(…)`"))).toBe(true);
  });
  test("a write through a function that the called function calls is not hoisted", () => {
    const c = compile(program("            outer(it.id)", { before: "    function inner(id) {\n        ?{`UPDATE notes SET body = 'x' WHERE id = ${id}`}.run()\n    }\n    function outer(id) {\n        inner(id)\n    }" }));
    expect(c.hoists).toBe(0);
  });
  test("a write through a function value (callback) is not hoisted", () => {
    const c = compile(program("            const ids = [it.id]\n            ids.forEach(touch)", { before: "    function touch(id) {\n        ?{`UPDATE notes SET body = 'x' WHERE id = ${id}`}.run()\n    }" }));
    expect(c.hoists).toBe(0);
  });
  test("a write function stored in an object outside the loop: method calls in the loop are not hoisted", () => {
    const c = compile(program("            repo.save(it.id)", { before: "    function touch(id) {\n        ?{`UPDATE notes SET body = 'x' WHERE id = ${id}`}.run()\n    }\n    const repo = { save: touch }" }));
    expect(c.hoists).toBe(0);
  });
  test("a non-built-in method on a local object is not hoisted (it may be a writer)", () => {
    const c = compile(program("            helper.save(it.id)", { before: "    const helper = { save: (id) => id }" }));
    expect(c.hoists).toBe(0);
    expect(c.reasons.some((r) => r.includes("`helper.save(…)`"))).toBe(true);
  });
  test("a writer passed by value in ANOTHER file of the compilation blocks member calls in this file's loop", () => {
    const loopFile = (extra) => ({
      filePath: "/a.scrml",
      nodes: [{
        kind: "function-decl", name: "f", params: ["xs", "opts"], body: [{
          kind: "for-stmt", id: "loop", variable: "x", iterable: "xs", body: [
            { kind: "let-decl", name: "row", init: "?{`SELECT body FROM notes WHERE id = ${x.id}`}.get()" },
            { kind: "bare-expr", expr: "opts . push ( row )" },
          ],
        }],
      }, ...extra],
    });
    const writerFile = {
      filePath: "/b.scrml",
      nodes: [
        { kind: "function-decl", name: "touch", params: ["id"], body: [{ kind: "sql", query: "UPDATE notes SET body = 'x' WHERE id = ${id}", chainedCalls: [{ method: "run", args: "" }] }] },
        { kind: "const-decl", name: "holder", init: "{ push : touch }" },
      ],
    };
    expect(runBatchPlanner({ files: [loopFile([])], depGraph: null }).batchPlan.loopHoists).toHaveLength(1);
    const both = runBatchPlanner({ files: [loopFile([]), writerFile], depGraph: null }).batchPlan;
    expect(both.loopHoists).toHaveLength(0);
    expect(both.diagnostics.some((d) => d.reason.includes("`opts.push(…)`"))).toBe(true);
  });
  test("a value returned by a function imported from OUTSIDE the compilation may carry a writer", () => {
    const fileWith = (importNode, extra = []) => ({
      filePath: "/p/a.scrml",
      nodes: [importNode, { kind: "const-decl", name: "repo", init: "makeRepo ( )" }, {
        kind: "function-decl", name: "f", params: ["xs"], body: [{
          kind: "for-stmt", id: "loop", variable: "x", iterable: "xs", body: [
            { kind: "let-decl", name: "row", init: "?{`SELECT body FROM notes WHERE id = ${x.id}`}.get()" },
            { kind: "bare-expr", expr: "repo . add ( row )" },
          ],
        }],
      }, ...extra],
    });
    // a host `.js` module: its factory is not analysed — `repo.add` may write
    const external = { kind: "import-decl", raw: "import { makeRepo } from './repo.js'", names: ["makeRepo"], source: "./repo.js" };
    const ext = runBatchPlanner({ files: [fileWith(external)], depGraph: null }).batchPlan;
    expect(ext.loopHoists).toHaveLength(0);
    expect(ext.diagnostics.some((d) => d.reason.includes("`repo.add(…)`"))).toBe(true);
    // a `.scrml` module in the compilation is analysed: its factory builds no writer
    const internal = { kind: "import-decl", raw: "import { makeRepo } from './b.scrml'", names: ["makeRepo"], source: "./b.scrml" };
    const moduleB = { filePath: "/p/b.scrml", nodes: [{ kind: "function-decl", name: "makeRepo", params: [], body: [{ kind: "return-stmt", expr: "{ add : ( r ) => r }" }] }] };
    expect(runBatchPlanner({ files: [fileWith(internal), moduleB], depGraph: null }).batchPlan.loopHoists).toHaveLength(1);
  });
  test("an undeclared global call (fetch) is not hoisted", () => {
    const c = compile(program("            fetch(\"/x\")"));
    expect(c.hoists).toBe(0);
    expect(c.reasons.some((r) => r.includes("`fetch(…)`"))).toBe(true);
  });
  test("a `transaction { }` in the body is not hoisted", () => {
    const c = compile(program("            transaction {\n                ?{`UPDATE notes SET body = 'x' WHERE id = ${it.id}`}.run()\n            }"));
    expect(c.hoists).toBe(0);
  });
  test("sqlIsPlainRead: a lone SELECT is a read; anything else (or unreadable) is a write", () => {
    expect(sqlIsPlainRead("SELECT id FROM t WHERE id = ${x}")).toBe(true);
    expect(sqlIsPlainRead("  select a from t where b = 'update'")).toBe(true);
    for (const w of ["UPDATE t SET a = 1", "INSERT INTO t VALUES (1)", "DELETE FROM t", "SELECT a INTO b FROM t",
      "SELECT a FROM t; DELETE FROM t", "WITH x AS (DELETE FROM t RETURNING *) SELECT * FROM x", "SELECT a FROM t FOR UPDATE", "PRAGMA x"]) {
      expect(sqlIsPlainRead(w)).toBe(false);
    }
  });
});

describe("the pre-fetch is SQLite SQL — a non-SQLite database is not hoisted", () => {
  test("a Postgres db= keeps the per-iteration query, with a D-BATCH-001 reason", () => {
    const c = compile(program("            out.push(row)", { db: "postgres://u:p@localhost:5432/app" }));
    expect(c.hoists).toBe(0);
    expect(c.reasons.some((r) => /not a literal SQLite target \(postgres\)/.test(r))).toBe(true);
  });
  test("a SQLite db= is hoisted", () => {
    expect(compile(program("            out.push(row)")).hoists).toBe(1);
  });
});

describe("(1) the key table matches with the per-iteration query's own `=` (executed on bun:sqlite)", () => {
  // Every column affinity + a NOCASE collation; each key against each column, the
  // classifier's own pre-fetch template vs the per-iteration query.
  const db = new Database(":memory:");
  db.run("CREATE TABLE n (id INTEGER PRIMARY KEY, body TEXT, nm TEXT COLLATE NOCASE, b BLOB, r REAL, num NUMERIC)");
  db.run("INSERT INTO n VALUES (7, 'hello', 'Abc', '7', 7.0, 7), (9, 'nine', 'xyz', 9, 9.5, '9x')");
  const keys = ["7", 7, "x", "07", " 7", "7.0", 9.5, "9.5", "abc", "ABC", "9x", "hello", 1, 0];
  for (const col of ["id", "body", "nm", "b", "r", "num"]) {
    test(`column ${col}`, () => {
      const shape = classifyHoistableQuery(`SELECT body FROM n WHERE ${col} = \${it.k}`, "it", HOIST_KEY_ALIAS);
      expect(shape.reason).toBeUndefined();
      const values = keys.map((_, i) => `(${i}, ?${i + 1})`).join(", ");
      const hoisted = db.query(shape.inSqlTemplate.replace(HOIST_VALUES_PLACEHOLDER, values)).all(...keys)
        .map((r) => [r[HOIST_KEY_ALIAS], r.body]).sort();
      const perRow = [];
      keys.forEach((k, i) => { for (const r of db.query(`SELECT body FROM n WHERE ${col} = ?1`).all(k)) perRow.push([i, r.body]); });
      expect(hoisted).toEqual(perRow.sort());
    });
  }
  test("a SELECT * row carries the key-table columns, which the emitter strips", () => {
    const shape = classifyHoistableQuery("SELECT * FROM n WHERE id = ${it.k}", "it", HOIST_KEY_ALIAS);
    const row = db.query(shape.inSqlTemplate.replace(HOIST_VALUES_PLACEHOLDER, "(0, ?1)")).get(7);
    expect(Object.keys(row)).toContain(HOIST_VAL_ALIAS);
    const js = compile(program("            out.push(row)").replace("SELECT body FROM notes", "SELECT * FROM notes")).serverJs;
    expect(js).toContain(`delete _r["${HOIST_KEY_ALIAS}"]; delete _r["${HOIST_VAL_ALIAS}"];`);
  });
  test("the query may not name the pre-fetch's reserved names", () => {
    expect(typeof classifyHoistableQuery("SELECT body FROM n __scrml_batch_k WHERE id = ${it.k}", "it", HOIST_KEY_ALIAS).reason).toBe("string");
    expect(typeof classifyHoistableQuery("SELECT __scrml_batch_val FROM n WHERE id = ${it.k}", "it", HOIST_KEY_ALIAS).reason).toBe("string");
  });
});

describe("(3) failure timing + a changed key — emission", () => {
  test("unhandled: the pre-fetch failure is held, and thrown by the read", () => {
    const js = compile(program("            out.push(row)")).serverJs;
    expect(js).toMatch(/try \{ await _scrml_batch_fetch_\d+\(\[\.\.\._scrml_batch_slots_\d+\.keys\(\)\], 0\); \} catch \(_e\) \{ _scrml_batch_failure_\d+ = \{ error: _e \}; \}/);
    expect(js).toMatch(/if \(_scrml_batch_failure_\d+\) throw _scrml_batch_failure_\d+\.error;/);
    // a key the body changed after the pre-fetch is fetched when its read runs
    expect(js).toMatch(/await _scrml_batch_fetch_\d+\(\[_k\], _s\);/);
  });
});

describe("verify-only gaps closed by #1325 (S456 evidence: reproduced at f0925b6e4, gone at 9c556dc74+)", () => {
  test("g-hoisted-loop-write-to-an-outer-let-emits-a-tdz: an outer `let` written in a hoisted loop is assigned, not re-declared", () => {
    const c = compile([
      '<program db="n.db">',
      "<schema>",
      "    users { id: integer primary key",
      "            name: text }",
      "</>",
      "server function recent(ids) {",
      "    let n = 0",
      "    for (const x of ids) {",
      "        let row = ?{`SELECT name FROM users WHERE id = ${x.id}`}.get()",
      "        n = n + 1",
      "    }",
      "    return n",
      "}",
      "<p>x</p>",
      "</>",
    ].join("\n"));
    expect(c.hoists).toBe(1);
    expect(c.serverJs).toMatch(/\n\s*n = n \+ 1;/);
    expect(c.serverJs).not.toContain("const n = n + 1");
  });
  test("g-nplus1-hoist-keys-map-by-unselected-column: a key column the SELECT does not return is still matched", () => {
    // `SELECT body … WHERE id = …` — `id` is not selected; each row is tagged with its key slot instead
    const c = compile(program("            out.push(row)"));
    expect(c.hoists).toBe(1);
    expect(c.serverJs).toContain("SELECT body, __scrml_batch_k.__scrml_batch_key AS __scrml_batch_key FROM notes, ");
  });
});
