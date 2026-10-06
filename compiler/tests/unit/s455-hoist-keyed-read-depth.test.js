/**
 * S455 — §8.10 Tier 2 loop hoist: the keyed read is rewritten AT ANY DEPTH of the
 * loop body, or the loop is not hoisted; the pre-fetch keys on a projected alias.
 *
 * Root (emit-control-flow `substituteHoistedSqlInBody`): the Batch Planner's
 * detector walks every object / array child of the loop body, but the body
 * rewrite recursed only through a node's `body` array. A read inside an `if`
 * (`consequent` / `alternate`) was never replaced — the pre-fetch ran and the read
 * itself was emitted with no server boundary (a `null` read, "client cannot evaluate"),
 * so every row read `not` on success. Related, same rewrite:
 *   - a keywordless `row = ?{…}` re-declared `row` (the body lowered without the
 *     enclosing declared names, and the `_bareAssign` form lost its sqlNode);
 *   - the Map was keyed on `_r["<keyColumn>"]`, absent when the SELECT list does not
 *     carry the key bare (`SELECT body`, `id AS x`, `n.id`);
 *   - `.get()` kept the LAST row per key, not the first.
 * Runtime pins: conformance/cases/server-db/sql-hoisted-loop-*-rt and
 * sql-handled-hoisted-loop-nested-read-rt.
 */

import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { runBatchPlanner, HOIST_KEY_ALIAS } from "../../src/batch-planner.ts";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function compile(source) {
  const dir = mkdtempSync(join(tmpdir(), "scrml-s455-hoist-"));
  const file = join(dir, "test.scrml");
  writeFileSync(file, source);
  try {
    return compileScrml({ inputFiles: [file], outputDir: null, write: false, log: () => {} });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function serverJsOf(result) {
  return [...(result.outputs?.values() ?? [])].map((o) => o.serverJs ?? "").join("\n");
}

function program(fnBody) {
  return [
    '<program db="test.db">',
    "${ server function f(items) {",
    "    let out = []",
    fnBody,
    "    return out",
    "} }",
    "</>",
  ].join("\n");
}

const Q = "?{`SELECT id, body FROM notes WHERE id = ${it.id}`}.get()";
// The per-iteration read (S456: by slot, through the loop's read function, which
// returns its own copy of the row — S455 review P3).
const LOOKUP = /\(await _scrml_batch_read_\d+\(it\.id\)\)/;
const ASSIGN = /\n\s*row = \(await _scrml_batch_read_\d+\(it\.id\)\);/;
// The key-table pre-fetch pieces (hoist-sql-shape.ts HOIST_KEY_TABLE).
const KA = `__scrml_batch_k.${HOIST_KEY_ALIAS} AS ${HOIST_KEY_ALIAS}`;
const KT = `(SELECT column1 AS ${HOIST_KEY_ALIAS}, column2 AS __scrml_batch_val FROM (VALUES __SCRML_BATCH_VALUES__)) AS __scrml_batch_k`;
const KV = "__scrml_batch_k.__scrml_batch_val";

describe("a nested keyed read is rewritten to the Map lookup", () => {
  const shapes = {
    "inside if": `for (const it of items) {\n if (it.on) {\n const row = ${Q}\n out.push(row)\n }\n }`,
    "inside else": `for (const it of items) {\n if (it.off) {\n out.push(1)\n } else {\n const row = ${Q}\n out.push(row)\n }\n }`,
    "inside else-if": `for (const it of items) {\n if (it.off) {\n out.push(1)\n } else if (it.on) {\n const row = ${Q}\n out.push(row)\n }\n }`,
    "inside nested if": `for (const it of items) {\n if (it.on) {\n if (it.id > 0) {\n const row = ${Q}\n out.push(row)\n }\n }\n }`,
    "handled, inside if": `for (const it of items) {\n if (it.on) {\n const row = ${Q} !{ _ :> not }\n out.push(row)\n }\n }`,
  };
  for (const [name, body] of Object.entries(shapes)) {
    test(name, () => {
      const result = compile(program(body));
      const js = serverJsOf(result);
      expect(js).toContain("§8.10 Tier 2 loop hoist");
      expect(js).toMatch(LOOKUP);
      expect(js).not.toContain("client cannot evaluate");
      // the per-iteration query is gone
      expect(js).not.toMatch(/_scrml_sql`SELECT id, body FROM notes WHERE id = /);
    });
  }

  test("a handled nested site reads an unloaded key through the attempt", () => {
    const js = serverJsOf(compile(program(shapes_handled())));
    // S456 fix round F1: a key the pre-fetch did not load is read ALONE through the attempt,
    // so its own failure is the SqlError envelope the site's arms match on.
    expect(js).toMatch(/const _failed = await _scrml_sql_attempt\(\(_keys\) => _scrml_batch_fetch_\d+\(_keys\), \[_k\], \(\) => null\);/);
    expect(js).toContain("if (_failed) return _failed;");
  });
  function shapes_handled() {
    return `for (const it of items) {\n if (it.on) {\n const row = ${Q} !{ _ :> not }\n out.push(row)\n }\n }`;
  }
});

describe("a reassignment of an existing binding stays an assignment", () => {
  test("keywordless `row = ?{…}` on a loop-local `let row`", () => {
    const js = serverJsOf(compile(program(`for (const it of items) {\n let row = not\n row = ${Q}\n out.push(row)\n }`)));
    expect(js).toContain("§8.10 Tier 2 loop hoist");
    expect(js).toMatch(ASSIGN);
    expect(js).not.toMatch(/const row = \(await _scrml_batch_read/);
  });
  test("keywordless `row = ?{…}` on a `let row` declared OUTSIDE the loop", () => {
    const js = serverJsOf(compile(program(`let row = not\n for (const it of items) {\n row = ${Q}\n out.push(row)\n }`)));
    expect(js).toMatch(ASSIGN);
    expect(js).not.toMatch(/const row = \(await _scrml_batch_read/);
  });
  test("handled `row = ?{…} !{…}` assigns the guarded value (no `var row`)", () => {
    const js = serverJsOf(compile(program(`for (const it of items) {\n let row = not\n if (it.on) {\n row = ${Q} !{ _ :> not }\n }\n out.push(row)\n }`)));
    expect(js).toContain("§8.10 Tier 2 loop hoist");
    expect(js).not.toMatch(/var row = /);
    expect(js).toMatch(/\n\s*row = _scrml__scrml_result_\d+;/);
  });
});

describe("a site the rewrite cannot replace leaves the loop un-hoisted", () => {
  test("`return ?{…}.get()` inside an if — per-iteration query, never `return null`", () => {
    const src = [
      '<program db="test.db">',
      "${ server function f(items) {",
      "    for (const it of items) {",
      "        if (it.on) {",
      `            return ${Q}`,
      "        }",
      "    }",
      "    return not",
      "} }",
      "</>",
    ].join("\n");
    const js = serverJsOf(compile(src));
    expect(js).not.toContain("§8.10 Tier 2 loop hoist");
    expect(js).not.toContain("client cannot evaluate");
    expect(js).toMatch(/return \(await _scrml_sql`SELECT id, body FROM notes WHERE id = \$\{it\.id\}`\)\[0\] \?\? null;/);
  });
});

describe("the pre-fetch keys on a projected slot alias and keeps the first row per key", () => {
  test("SELECT body (key not selected): slot projected, read, and stripped", () => {
    const js = serverJsOf(compile(program(`for (const it of items) {\n const row = ?{\`SELECT body FROM notes WHERE id = \${it.id}\`}.get()\n out.push(row)\n }`)));
    expect(js).toContain(`"SELECT body, ${KA} FROM notes, ${KT} WHERE id = ${KV}"`);
    expect(js).toContain(`const _s = _r["${HOIST_KEY_ALIAS}"]; delete _r["${HOIST_KEY_ALIAS}"]; delete _r["__scrml_batch_val"];`);
    expect(js).toMatch(/if \(!_scrml_batch_bySlot_\d+\.has\(_s\)\) _scrml_batch_bySlot_\d+\.set\(_s, _r\);/);
  });
  test(".all() groups on the slot", () => {
    const js = serverJsOf(compile(program(`for (const it of items) {\n const rows = ?{\`SELECT title FROM posts WHERE user_id = \${it.id}\`}.all()\n out.push(rows)\n }`)));
    expect(js).toContain(`"SELECT title, ${KA} FROM posts, ${KT} WHERE user_id = ${KV}"`);
    expect(js).toMatch(/const _group = _scrml_batch_bySlot_\d+\.get\(_s\); if \(_group\) _group\.push\(_r\); else _scrml_batch_bySlot_\d+\.set\(_s, \[_r\]\);/);
  });

  function plan(sql) {
    const file = {
      ast: { nodes: [{ kind: "for-stmt", id: "loop-1", variable: "x", iterable: "xs", body: [{ kind: "let-decl", name: "row", init: sql }] }] },
    };
    return runBatchPlanner({ files: [file], depGraph: null }).batchPlan;
  }
  test("planner: the qualified key column is compared to the key table as written", () => {
    const p = plan("?{`SELECT n.body FROM notes n WHERE n.id = ${x.id}`}.get()");
    expect(p.loopHoists).toHaveLength(1);
    expect(p.loopHoists[0].keyAlias).toBe(HOIST_KEY_ALIAS);
    expect(p.loopHoists[0].inSqlTemplate).toBe(`SELECT n.body, ${KA} FROM notes n, ${KT} WHERE n.id = ${KV}`);
  });
  test("planner: a subquery in the SELECT list is not hoisted (D-BATCH-001)", () => {
    const p = plan("?{`SELECT (SELECT count(*) FROM tags) AS c FROM notes WHERE id = ${x.id}`}.get()");
    expect(p.loopHoists).toHaveLength(0);
    expect(p.diagnostics.some((d) => d.code === "D-BATCH-001" && /not a plain column/.test(d.reason))).toBe(true);
  });
  test("planner: a FROM inside parentheses before the outer FROM is not hoisted", () => {
    const p = plan("?{`SELECT extract(year FROM d) AS y FROM notes WHERE id = ${x.id}`}.get()");
    expect(p.loopHoists).toHaveLength(0);
  });
});
