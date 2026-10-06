/**
 * Tier 2 N+1 Loop Hoist — Rewrite Tests (§8.10.2, Slice 5)
 *
 * Verifies that CG consumes BatchPlan.loopHoists and emits the rewritten
 * form:
 *   const _keys = xs.map(x => x.id);
 *   const _rows = _scrml_db.query("WHERE id IN (...)").all(...keys);
 *   const _byKey = new Map(_rows.map(r => [r.id, r]));
 *   for (const x of xs) {
 *     let row = _byKey.get(x.id) ?? null;   // was ?{...}.get()
 *     ...
 *   }
 *
 * Coverage:
 *   §1  for-of + .get() → pre-loop IN fetch + Map.get lookup in body
 *   §2  .all() → Map<key, Row[]> with array-fallback lookup
 *   §3  positional placeholders ?1,?2,... preserved for bun:sqlite
 *   §4  original ?{...}.get() call is removed from emitted loop body
 *   §5  deterministic var names (genVar produces incrementing suffixes)
 *   §6  empty iterable → empty rows (short-circuit avoids prepare)
 *   §7  non-hoisted for-loop unchanged (regression guard)
 *   §8  key column appears in the emitted SELECT's WHERE IN
 */

import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function compile(source) {
  const dir = mkdtempSync(join(tmpdir(), "scrml-t2-"));
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

// ---------------------------------------------------------------------------
// §1
// ---------------------------------------------------------------------------

describe("§1 for-of + .get() → pre-loop IN fetch + Map lookup", () => {
  test("emitted JS has keys/rows/byKey scaffolding + in-body lookup", () => {
    const src = [
      '<program db="test.db">',
      "${ server function recent(ids) {",
      "    for (let x of ids) {",
      "        let row = ?{`SELECT id, name FROM users WHERE id = ${x.id}`}.get()",
      "    }",
      "} }",
      "</>",
    ].join("\n");
    const js = serverJsOf(compile(src));
    // S455: the iterable is evaluated once into `_scrml_batch_items_N`; keys + loop read it.
    expect(js).toMatch(/let _scrml_batch_items_\d+ = \(ids\);/);
    expect(js).toMatch(/_scrml_batch_keys_\d+ = _scrml_batch_items_\d+\.map\(x => x\.id\)/);
    expect(js).toMatch(/_scrml_batch_rows_\d+/);
    expect(js).toMatch(/_scrml_batch_byKey_\d+ = new Map\(\)/);
    // S455: each lookup is its own copy of the row (as each per-row query returns).
    expect(js).toMatch(/_scrml_batch_byKey_\d+\.has\(x\.id\) \? \{ \.\.\._scrml_batch_byKey_\d+\.get\(x\.id\) \} : null/);
  });
});

// ---------------------------------------------------------------------------
// §2
// ---------------------------------------------------------------------------

describe("§2 .all() → Map<key, Row[]> with array-fallback lookup", () => {
  test("group-by emission + array lookup", () => {
    const src = [
      '<program db="test.db">',
      "${ server function postsPerUser(users) {",
      "    for (let u of users) {",
      "        let posts = ?{`SELECT title FROM posts WHERE user_id = ${u.id}`}.all()",
      "    }",
      "} }",
      "</>",
    ].join("\n");
    const js = serverJsOf(compile(src));
    // .all() terminator uses the grouping emission
    expect(js).toMatch(/_scrml_batch_byKey_\d+\.get\(_k\) \?\? \[\]/);
    // Body lookup falls back to [] not null
    expect(js).toMatch(/_scrml_batch_byKey_\d+\.get\(u\.id\) \?\? \[\]/);
  });
});

// ---------------------------------------------------------------------------
// §3
// ---------------------------------------------------------------------------

describe("§3 positional placeholders ?1, ?2 preserved", () => {
  test("placeholder list generated with 1-indexed `?N` tokens", () => {
    const src = [
      '<program db="test.db">',
      "${ server function recent(ids) {",
      "    for (let x of ids) {",
      "        let row = ?{`SELECT * FROM users WHERE id = ${x.id}`}.get()",
      "    }",
      "} }",
      "</>",
    ].join("\n");
    const js = serverJsOf(compile(src));
    expect(js).toContain(`"?" + (_i + 1)`);
    expect(js).toContain(".join(\", \")");
  });
});

// ---------------------------------------------------------------------------
// §4
// ---------------------------------------------------------------------------

describe("§4 original `?{...}.get()` call is removed from loop body", () => {
  test("no _scrml_db.query call inside the for-body for the hoisted SQL", () => {
    const src = [
      '<program db="test.db">',
      "${ server function recent(ids) {",
      "    for (let x of ids) {",
      "        let row = ?{`SELECT id FROM users WHERE id = ${x.id}`}.get()",
      "    }",
      "} }",
      "</>",
    ].join("\n");
    const js = serverJsOf(compile(src));
    // Find the substring inside the for-body and verify no per-iter query
    const forIdx = js.search(/for \(const x of _scrml_batch_items_\d+\) \{/);
    const closeIdx = js.indexOf("}", forIdx);
    expect(forIdx).toBeGreaterThan(-1);
    const body = js.slice(forIdx, closeIdx);
    // Body contains the map lookup, not a query call
    expect(body).toContain("_scrml_batch_byKey_");
    expect(body).not.toMatch(/_scrml_db\.query\([^)]*WHERE id = \?1/);
  });
});

// ---------------------------------------------------------------------------
// §5
// ---------------------------------------------------------------------------

describe("§5 single `WHERE IN (...)` query built before the loop", () => {
  test("the pre-loop query runs sql.unsafe(rawSql, keys) — one round trip", () => {
    const src = [
      '<program db="test.db">',
      "${ server function recent(ids) {",
      "    for (let x of ids) {",
      "        let row = ?{`SELECT id FROM users WHERE id = ${x.id}`}.get()",
      "    }",
      "} }",
      "</>",
    ].join("\n");
    const js = serverJsOf(compile(src));
    expect(js).toContain("__SCRML_BATCH_IN__");
    // §44 / Bun.SQL: dynamic IN-list emission goes through sql.unsafe(rawSql, paramArray).
    // Bun.SQL's SQLite branch does NOT support array binding via tagged-template ${arr},
    // so we keep manual `?N` placeholder construction and bind via .unsafe().
    expect(js).toMatch(/_scrml_sql\.unsafe\(.*?_scrml_batch_keys_\d+\)/s);
    expect(js).toContain("_scrml_sql.unsafe(");
  });
});

// ---------------------------------------------------------------------------
// §6
// ---------------------------------------------------------------------------

describe("§6 empty iterable short-circuit → skips prepare", () => {
  test("keys.length === 0 short-circuit emitted", () => {
    const src = [
      '<program db="test.db">',
      "${ server function recent(ids) {",
      "    for (let x of ids) {",
      "        let row = ?{`SELECT * FROM users WHERE id = ${x.id}`}.get()",
      "    }",
      "} }",
      "</>",
    ].join("\n");
    const js = serverJsOf(compile(src));
    expect(js).toMatch(/_scrml_batch_keys_\d+\.length === 0 \? \[\]/);
  });
});

// ---------------------------------------------------------------------------
// §7
// ---------------------------------------------------------------------------

describe("§7 regression: non-hoisted for-loop unchanged", () => {
  test("plain for-loop with no SQL does not get the batch scaffolding", () => {
    const src = [
      '<program db="test.db">',
      "${ server function double(nums) {",
      "    for (let n of nums) {",
      "        console.log(n)",
      "    }",
      "} }",
      "</>",
    ].join("\n");
    const js = serverJsOf(compile(src));
    expect(js).not.toContain("_scrml_batch_keys_");
    expect(js).not.toContain("__SCRML_BATCH_IN__");
  });
});

// ---------------------------------------------------------------------------
// §8
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// §9 E-BATCH-002 runtime guard
// ---------------------------------------------------------------------------

describe("§9 E-BATCH-002: runtime guard on SQLITE_MAX_VARIABLE_NUMBER (§8.10.6)", () => {
  test("emitted JS includes a keys.length > 32766 check that throws E-BATCH-002", () => {
    const src = [
      '<program db="test.db">',
      "${ server function recent(ids) {",
      "    for (let x of ids) {",
      "        let row = ?{`SELECT id FROM users WHERE id = ${x.id}`}.get()",
      "    }",
      "} }",
      "</>",
    ].join("\n");
    const js = serverJsOf(compile(src));
    expect(js).toMatch(/_scrml_batch_keys_\d+\.length > 32766/);
    expect(js).toContain("E-BATCH-002");
    expect(js).toContain("SQLITE_MAX_VARIABLE_NUMBER");
  });

  test("guard is placed before the sql.unsafe() bind call", () => {
    const src = [
      '<program db="test.db">',
      "${ server function recent(ids) {",
      "    for (let x of ids) {",
      "        let row = ?{`SELECT id FROM users WHERE id = ${x.id}`}.get()",
      "    }",
      "} }",
      "</>",
    ].join("\n");
    const js = serverJsOf(compile(src));
    const guardIdx = js.indexOf("E-BATCH-002");
    // §44 emission: dynamic IN-list binds via sql.unsafe(rawSql, paramArray).
    const bindIdx = js.search(/_scrml_sql\.unsafe\(.*?_scrml_batch_keys_\d+\)/s);
    expect(guardIdx).toBeGreaterThan(-1);
    expect(bindIdx).toBeGreaterThan(guardIdx);
  });
});

// ---------------------------------------------------------------------------
// §10 key column flows into IN-list SELECT (renumbered from §8)
// ---------------------------------------------------------------------------

describe("§10 key column flows into the IN-list SELECT", () => {
  test("WHERE user_id IN (...) appears when key column is user_id", () => {
    const src = [
      '<program db="test.db">',
      "${ server function postsFor(users) {",
      "    for (let u of users) {",
      "        let posts = ?{`SELECT id, title FROM posts WHERE user_id = ${u.id}`}.all()",
      "    }",
      "} }",
      "</>",
    ].join("\n");
    const js = serverJsOf(compile(src));
    expect(js).toContain("WHERE user_id IN (__SCRML_BATCH_IN__)");
  });
});
