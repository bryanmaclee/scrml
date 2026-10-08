/**
 * S455 (S239 review on 0e253650) — §8.10 hoist fail-closed items.
 *
 *   I1  the SELECT-list end was found by a text regex (`FROM` inside a string
 *       literal split the list) → token-aware classifier (hoist-sql-shape.ts).
 *   P1  a hoisted read skipped the §14.8.9 row strip → a read over a table with
 *       any protected column (or one the protect analysis does not know) is not hoisted.
 *   P2  the IN-rewrite changed the answer for aggregates / GROUP BY / LIMIT / OR /
 *       UNION / a second `${}` → an ALLOW-LIST of hoistable shapes.
 *   P3  the iterable was evaluated twice; duplicate keys shared one row object.
 *   I2  a user column named `__scrml_batch_key` → not hoisted.
 * Runtime pins vs `.nobatch()`: conformance/cases/server-db/sql-hoisted-loop-allow-list-rt,
 * conformance/cases/protect/hoisted-loop-protected-table-not-hoisted-rt.
 */

import { describe, test, expect } from "bun:test";
import { classifyHoistableQuery } from "../../src/hoist-sql-shape.ts";
import { runBatchPlanner, HOIST_KEY_ALIAS } from "../../src/batch-planner.ts";
import { compileScrml } from "../../src/api.js";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const classify = (sql) => classifyHoistableQuery(sql, "it", HOIST_KEY_ALIAS);

// S456 — the pre-fetch joins a KEY TABLE of `(slot, key)` rows and SQL matches each
// row to its key with the per-iteration query's own `=` (hoist-sql-shape.ts
// HOIST_KEY_TABLE); it was `<key> IN (…)` + a JS Map keyed on the key VALUE, which
// missed a text key "7" that SQL matched to the INTEGER 7.
const KA = "__scrml_batch_k.__scrml_batch_key AS __scrml_batch_key";
const KT = "(SELECT column1 AS __scrml_batch_key, column2 AS __scrml_batch_val FROM (VALUES __SCRML_BATCH_VALUES__)) AS __scrml_batch_k";
const KV = "__scrml_batch_k.__scrml_batch_val";

describe("allow-list — hoisted shapes", () => {
  const ok = {
    "plain columns": ["SELECT id, body FROM notes WHERE id = ${it.id}", `SELECT id, body, ${KA} FROM notes, ${KT} WHERE id = ${KV}`],
    "star": ["SELECT * FROM notes WHERE id = ${it.id}", `SELECT *, ${KA} FROM notes, ${KT} WHERE id = ${KV}`],
    "alias + qualified": ["SELECT n.id AS note_id, n.body FROM notes n WHERE n.id = ${it.id}", `SELECT n.id AS note_id, n.body, ${KA} FROM notes n, ${KT} WHERE n.id = ${KV}`],
    "AND without ${} + ORDER BY": ["SELECT body FROM notes WHERE owner = ${it.id} AND kind <> 'y' AND body IS NOT NULL ORDER BY id DESC", `SELECT body, ${KA} FROM notes, ${KT} WHERE owner = ${KV} AND kind <> 'y' AND body IS NOT NULL ORDER BY id DESC`],
    "simple JOIN": ["SELECT n.body, t.label FROM notes n JOIN tags t ON t.note_id = n.id WHERE n.id = ${it.id}", `SELECT n.body, t.label, ${KA} FROM notes n JOIN tags t ON t.note_id = n.id, ${KT} WHERE n.id = ${KV}`],
    "IN literal list": ["SELECT body FROM notes WHERE id = ${it.id} AND kind IN ('x', 'z')", `SELECT body, ${KA} FROM notes, ${KT} WHERE id = ${KV} AND kind IN ('x', 'z')`],
  };
  for (const [name, [sql, inSql]] of Object.entries(ok)) {
    test(name, () => {
      const r = classify(sql);
      expect(r.reason).toBeUndefined();
      expect(r.inSqlTemplate).toBe(inSql);
    });
  }
});

describe("allow-list — NOT hoisted (the IN-rewrite would change the answer, or cannot be built)", () => {
  const refused = {
    "count(*)": "SELECT count(*) AS n FROM notes WHERE owner = ${it.id}",
    "max()": "SELECT max(id) AS m FROM notes WHERE owner = ${it.id}",
    "GROUP BY": "SELECT owner FROM notes WHERE owner = ${it.id} GROUP BY owner",
    "HAVING": "SELECT owner FROM notes WHERE owner = ${it.id} HAVING owner > 0",
    "DISTINCT": "SELECT DISTINCT body FROM notes WHERE owner = ${it.id}",
    "LIMIT": "SELECT body FROM notes WHERE owner = ${it.id} ORDER BY id LIMIT 1",
    "OFFSET": "SELECT body FROM notes WHERE owner = ${it.id} OFFSET 1",
    "OR": "SELECT body FROM notes WHERE owner = ${it.id} OR kind = 'y'",
    "UNION": "SELECT body FROM notes WHERE owner = ${it.id} UNION SELECT body FROM notes",
    "second ${}": "SELECT body FROM notes WHERE id = ${it.id} AND owner = ${it.owner}",
    "subquery": "SELECT body FROM notes WHERE id = ${it.id} AND owner IN (SELECT id FROM users)",
    "window": "SELECT body, row_number() OVER (ORDER BY id) AS r FROM notes WHERE id = ${it.id}",
    "function in SELECT": "SELECT lower(body) AS b FROM notes WHERE id = ${it.id}",
    "string literal in SELECT": "SELECT id, 'a FROM b' AS t, body FROM notes WHERE id = ${it.id}",
    "comment": "SELECT body FROM notes -- x\n WHERE id = ${it.id}",
    "alias collides with the reserved key alias": "SELECT body AS __scrml_batch_key FROM notes WHERE id = ${it.id}",
    "key not compared to the loop binder": "SELECT body FROM notes WHERE id = ${other.id}",
    "key not first in WHERE": "SELECT body FROM notes WHERE kind = 'x' AND id = ${it.id}",
  };
  for (const [name, sql] of Object.entries(refused)) {
    test(name, () => {
      const r = classify(sql);
      expect(typeof r.reason).toBe("string");
      expect(r.inSqlTemplate).toBeUndefined();
    });
  }
  test("I1: a FROM inside a string literal is a string token, not the clause boundary", () => {
    // Even were string literals admitted, the token walk never ends the list there.
    expect(classify("SELECT id, 'a FROM b' AS t, body FROM notes WHERE id = ${it.id}").reason).toMatch(/not a plain column/);
  });
});

function forLoop(sql) {
  return { ast: { nodes: [{ kind: "for-stmt", id: "l", variable: "x", iterable: "xs", body: [{ kind: "let-decl", name: "row", init: sql }] }] } };
}
const pa = (tables, declared) => ({
  views: new Map([["db", { tables: new Map(Object.entries(tables).map(([t, cols]) => [t, { tableName: t, protectedFields: new Set(cols) }])) }]]),
  ...(declared ? { declaredTables: new Set(declared) } : {}),
});

describe("P1 — protect fail-closed", () => {
  test("aliased protected column (`secret AS s`): not hoisted, no E-PROTECT-003", () => {
    const { batchPlan, errors } = runBatchPlanner({ files: [forLoop("?{`SELECT id, secret AS s FROM users WHERE id = ${x.id}`}.get()")], depGraph: null, protectAnalysis: pa({ users: ["secret"] }) });
    expect(batchPlan.loopHoists).toHaveLength(0);
    expect(errors.filter((e) => e.code === "E-PROTECT-003")).toHaveLength(0);
    expect(batchPlan.diagnostics.some((d) => /protected column/.test(d.reason))).toBe(true);
  });
  test("a table the protect analysis does not know (protect active): not hoisted", () => {
    const { batchPlan } = runBatchPlanner({ files: [forLoop("?{`SELECT id FROM v_users WHERE id = ${x.id}`}.get()")], depGraph: null, protectAnalysis: pa({ users: ["secret"] }, ["users"]) });
    expect(batchPlan.loopHoists).toHaveLength(0);
    expect(batchPlan.diagnostics.some((d) => /not a declared table/.test(d.reason))).toBe(true);
  });
  test("JOIN onto a protected table: not hoisted", () => {
    const { batchPlan } = runBatchPlanner({ files: [forLoop("?{`SELECT p.title FROM posts p JOIN users u ON u.id = p.user_id WHERE p.id = ${x.id}`}.get()")], depGraph: null, protectAnalysis: pa({ users: ["secret"] }, ["users", "posts"]) });
    expect(batchPlan.loopHoists).toHaveLength(0);
  });
  test("no protected column anywhere: hoisted", () => {
    const { batchPlan } = runBatchPlanner({ files: [forLoop("?{`SELECT id FROM posts WHERE id = ${x.id}`}.get()")], depGraph: null, protectAnalysis: pa({}, ["posts"]) });
    expect(batchPlan.loopHoists).toHaveLength(1);
  });
});

function serverJs(source) {
  const dir = mkdtempSync(join(tmpdir(), "scrml-s455-allow-"));
  const file = join(dir, "test.scrml");
  writeFileSync(file, source);
  try {
    const r = compileScrml({ inputFiles: [file], outputDir: null, write: false, log: () => {} });
    return [...(r.outputs?.values() ?? [])].map((o) => o.serverJs ?? "").join("\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("P3 — emission", () => {
  test("the iterable is evaluated once; keys and loop read the same items", () => {
    const js = serverJs([
      '<program db="test.db">',
      "${ server function f(items) {",
      "    let out = []",
      "    for (const it of items.splice(0, 1)) {",
      "        const row = ?{`SELECT body FROM notes WHERE id = ${it.id}`}.get()",
      "        out.push(row)",
      "    }",
      "    return out",
      "} }",
      "</>",
    ].join("\n"));
    expect(js.match(/items\.splice\(0, 1\)/g)).toHaveLength(1);
    expect(js).toMatch(/let (_scrml_batch_items_\d+) = \(items\.splice\(0, 1\)\);\n\s*if \(!_scrml_g\.Array\.isArray\(\1\)\) \1 = _scrml_g\.Array\.from\(\1\);/);
    expect(js).toMatch(/for \(const it of _scrml_batch_items_\d+\) \{/);
  });
  test(".all(): each lookup is a fresh array of row copies", () => {
    const js = serverJs([
      '<program db="test.db">',
      "${ server function f(items) {",
      "    let out = []",
      "    for (const it of items) {",
      "        const rows = ?{`SELECT body FROM notes WHERE id = ${it.id}`}.all()",
      "        out.push(rows)",
      "    }",
      "    return out",
      "} }",
      "</>",
    ].join("\n"));
    // S456: the per-iteration read returns a fresh array of row copies for its slot.
    expect(js).toContain("return (_hit ?? []).map((_r) => ({ ..._r }));");
    expect(js).toMatch(/const rows = \(await _scrml_batch_read_\d+\(it\.id\)\);/);
  });
});
