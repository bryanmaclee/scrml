/**
 * Tier 2 N+1 Loop Hoist — Rewrite Tests (§8.10.2, Slice 5)
 *
 * Verifies that CG consumes BatchPlan.loopHoists and emits the rewritten
 * form (S456 shape — emit-control-flow.ts emitHoistedForStmt):
 *   let _items = (xs);
 *   const _slots = new Map();      // distinct key → slot
 *   const _bySlot = new Map();     // slot → row / rows
 *   const _fetch = async (_keys) => { chunks of ≤ cap keys; key-table SQL via .unsafe; marks keys loaded };
 *   let _failure = null; try { await _fetch(…) } catch (_e) { _failure = { error: _e } }
 *   const _read = async (_k) => { … };
 *   for (const x of _items) {
 *     let row = (await _read(x.id));   // was ?{...}.get()
 *     ...
 *   }
 *
 * Coverage:
 *   §1  for-of + .get() → pre-loop fetch + per-iteration read in body
 *   §2  .all() → slot → Row[] grouping with array-fallback read
 *   §3  positional placeholders ?1,?2,... preserved for bun:sqlite
 *   §4  original ?{...}.get() call is removed from emitted loop body
 *   §5  one key-table query per chunk, bound via .unsafe
 *   §6  empty iterable → no query (zero-length key list)
 *   §7  non-hoisted for-loop unchanged (regression guard)
 *   §9  §8.10.6 chunking (was an E-BATCH-002 throw)
 *   §10 key column appears in the emitted SELECT's WHERE
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

describe("§1 for-of + .get() → pre-loop fetch + per-iteration read", () => {
  test("emitted JS has slots/bySlot/fetch/read scaffolding + in-body read", () => {
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
    expect(js).toMatch(/for \(const _k of _scrml_batch_items_\d+\.map\(\(x\) => x\.id\)\) \{ if \(!_scrml_batch_slots_\d+\.has\(_k\)\) _scrml_batch_slots_\d+\.set\(_k, _scrml_batch_slots_\d+\.size\); \}/);
    expect(js).toMatch(/const _scrml_batch_bySlot_\d+ = new _scrml_g\.Map\(\);/);
    expect(js).toMatch(/const _scrml_batch_fetch_\d+ = async \(_keys\) => \{/);
    // S455: each read is its own copy of the row (as each per-row query returns).
    expect(js).toContain("return _hit ? { ..._hit } : null;");
    expect(js).toMatch(/let row = \(await _scrml_batch_read_\d+\(x\.id\)\);/);
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
    expect(js).toMatch(/const _group = _scrml_batch_bySlot_\d+\.get\(_s\); if \(_group\) _group\.push\(_r\);/);
    // The read falls back to [] not null
    expect(js).toContain("return (_hit ?? []).map((_r) => ({ ..._r }));");
    expect(js).toMatch(/let posts = \(await _scrml_batch_read_\d+\(u\.id\)\);/);
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
    // the VALUES rows `(slot, ?N)`: the slot is a compiler integer, the key a bound `?N`
    expect(js).toMatch(/"\(" \+ _scrml_batch_slots_\d+\.get\(_k\) \+ ", \?" \+ \(_i \+ 1\) \+ "\)"/);
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
    // Body contains the per-iteration read, not a query call
    expect(body).toContain("_scrml_batch_read_");
    expect(body).not.toMatch(/_scrml_db\.query\([^)]*WHERE id = \?1/);
  });
});

// ---------------------------------------------------------------------------
// §5
// ---------------------------------------------------------------------------

describe("§5 one key-table query per chunk, built before the loop", () => {
  test("the pre-loop query runs sql.unsafe(rawSql, chunk) — one round trip per chunk", () => {
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
    expect(js).toContain(`.replace("__SCRML_BATCH_VALUES__", _values), _chunk)`);
    // §44 / Bun.SQL: the dynamic key list goes through sql.unsafe(rawSql, paramArray).
    // Bun.SQL's SQLite branch does NOT support array binding via tagged-template ${arr},
    // so we keep manual `?N` placeholder construction and bind via .unsafe().
    expect(js).toMatch(/const _rows = await _scrml_sql\.unsafe\(.*?, _chunk\);/s);
  });
});

// ---------------------------------------------------------------------------
// §6
// ---------------------------------------------------------------------------

describe("§6 empty iterable → no query", () => {
  test("the chunk loop runs zero times for zero keys", () => {
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
    expect(js).toContain("for (let _at = 0; _at < _keys.length; _at += 32766) {");
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
    expect(js).not.toContain("_scrml_batch_");
    expect(js).not.toContain("__SCRML_BATCH_VALUES__");
  });
});

// ---------------------------------------------------------------------------
// §8
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// §9 §8.10.6 chunking (S456 — was an E-BATCH-002 throw above the cap)
// ---------------------------------------------------------------------------
// "If `xs.length` at runtime exceeds `SQLITE_MAX_VARIABLE_NUMBER`, the Tier 2 rewrite
// SHALL chunk the IN-list into segments of at most `SQLITE_MAX_VARIABLE_NUMBER` keys."
// Runtime pin: conformance/cases/server-db/sql-hoisted-loop-chunked-rt.

describe("§9 chunking at SQLITE_MAX_VARIABLE_NUMBER (§8.10.6)", () => {
  test("emitted JS fetches the keys in chunks of at most 32766, and never throws E-BATCH-002", () => {
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
    expect(js).toContain("for (let _at = 0; _at < _keys.length; _at += 32766) {");
    expect(js).toContain("const _chunk = _keys.slice(_at, _at + 32766);");
    expect(js).not.toContain("E-BATCH-002");
  });

  test("<program batch-in-list-cap=> sets the chunk size", () => {
    const src = [
      '<program db="test.db">',
      "${ server function recent(ids) {",
      "    for (let x of ids) {",
      "        let row = ?{`SELECT id FROM users WHERE id = ${x.id}`}.get()",
      "    }",
      "} }",
      "</>",
    ].join("\n");
    const js = serverJsOf(compile(src.replace('<program db="test.db">', '<program db="test.db" batch-in-list-cap="999">')));
    expect(js).toContain("for (let _at = 0; _at < _keys.length; _at += 999) {");
    expect(js).toContain("in chunks of at most 999 bound keys (§8.10.6)");
  });
});

// ---------------------------------------------------------------------------
// §10 key column flows into IN-list SELECT (renumbered from §8)
// ---------------------------------------------------------------------------

describe("§10 key column flows into the pre-fetch SELECT", () => {
  test("WHERE user_id = <key table> appears when key column is user_id", () => {
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
    expect(js).toContain("WHERE user_id = __scrml_batch_k.__scrml_batch_val");
  });
});
