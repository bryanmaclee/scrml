/**
 * SQL Batching Slice 5b Remainder — §8.10.7 guards
 *
 * Coverage:
 *   §1  E-PROTECT-003 fires when hoisted SELECT columns overlap protectedFields;
 *       LoopHoist is NOT recorded (fallback to unrewritten loop).
 *   §2  SELECT narrowed to non-protected columns → no E-PROTECT-003, hoist proceeds.
 *   §3  No protectAnalysis → overlap check is a safe no-op.
 *   §4  SELECT * → every protectedField of the target table counts as overlap.
 *   §5  verifyPostRewriteLift returns [] for hoists whose sqlTemplate contains
 *       no `lift(` (the normal case, by §8.10.1 construction).
 *   §6  verifyPostRewriteLift fires E-LIFT-001 defensively if a hoist's
 *       sqlTemplate does contain `lift(` (future-proofing §8.10.7).
 */

import { describe, test, expect } from "bun:test";
import { runBatchPlanner, verifyPostRewriteLift } from "../../src/batch-planner.ts";

// ---------------------------------------------------------------------------
// Helpers: hand-built for-stmt AST that analyzeForLoop accepts.
// ---------------------------------------------------------------------------

function mkForStmtWithSql(bodySql, opts = {}) {
  const terminator = opts.terminator ?? "get";
  return {
    kind: "for-stmt",
    id: opts.id ?? "for#0",
    variable: "x",
    iterable: "(let x of xs)",
    body: [
      {
        kind: "let-decl",
        init: "?{`" + bodySql + "`}." + terminator + "()",
      },
    ],
    span: { file: "/t.scrml", start: 0, end: 1, line: 1, col: 1 },
  };
}

function mkProtectAnalysis(tableName, protectedColumns) {
  return {
    views: new Map([
      [
        "sb#0",
        {
          stateBlockId: "sb#0",
          dbPath: "test.db",
          tables: new Map([
            [
              tableName,
              {
                tableName,
                protectedFields: new Set(protectedColumns),
              },
            ],
          ]),
        },
      ],
    ]),
  };
}

// ---------------------------------------------------------------------------
// §1
// ---------------------------------------------------------------------------

describe("§1 E-PROTECT-003 fires on column overlap, hoist refused", () => {
  test("SELECT includes protected column → E-PROTECT-003 + no hoist", () => {
    const forStmt = mkForStmtWithSql("SELECT id, email FROM users WHERE id = ${x.id}");
    const file = { ast: { nodes: [forStmt] } };
    const { batchPlan, errors } = runBatchPlanner({
      files: [file],
      depGraph: null,
      protectAnalysis: mkProtectAnalysis("users", ["email"]),
    });
    const protectErrs = errors.filter((e) => e.code === "E-PROTECT-003");
    expect(protectErrs.length).toBe(1);
    expect(protectErrs[0].message).toContain("email");
    expect(protectErrs[0].message).toContain("users");
    // hoist MUST NOT be recorded — fallback to unrewritten loop.
    expect(batchPlan.loopHoists).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §2
// ---------------------------------------------------------------------------

describe("§2 narrow SELECT avoids overlap → no E-PROTECT-003, and (S455) the loop is not hoisted", () => {
  test("SELECT id, name → no E-PROTECT-003; a table with protected columns is never hoisted", () => {
    // S455 (review P1): the hoisted pre-fetch bypasses the §14.8.9 row strip the
    // per-row query gets, so `secret AS s` reached the client. Fail closed: a read
    // over a table with ANY protected column keeps its per-iteration query.
    const forStmt = mkForStmtWithSql("SELECT id, name FROM users WHERE id = ${x.id}");
    const file = { ast: { nodes: [forStmt] } };
    const { batchPlan, errors } = runBatchPlanner({
      files: [file],
      depGraph: null,
      protectAnalysis: mkProtectAnalysis("users", ["email", "password"]),
    });
    const protectErrs = errors.filter((e) => e.code === "E-PROTECT-003");
    expect(protectErrs.length).toBe(0);
    expect(batchPlan.loopHoists.length).toBe(0);
    expect(batchPlan.diagnostics.some((d) => d.code === "D-BATCH-001" && /protected column/.test(d.reason))).toBe(true);
  });

  test("a table with NO protected column is hoisted while another table is protected", () => {
    const forStmt = mkForStmtWithSql("SELECT id, title FROM posts WHERE id = ${x.id}");
    const file = { ast: { nodes: [forStmt] } };
    const { batchPlan, errors } = runBatchPlanner({
      files: [file],
      depGraph: null,
      protectAnalysis: mkProtectAnalysis("users", ["email"]),
    });
    expect(errors.filter((e) => e.code === "E-PROTECT-003").length).toBe(0);
    expect(batchPlan.loopHoists.length).toBe(1);
    expect([...batchPlan.loopHoists[0].rowCacheColumns].sort()).toEqual(["id", "title"]);
  });
});

// ---------------------------------------------------------------------------
// §3
// ---------------------------------------------------------------------------

describe("§3 no protectAnalysis → safe no-op", () => {
  test("missing protectAnalysis → hoist proceeds without error", () => {
    const forStmt = mkForStmtWithSql("SELECT * FROM users WHERE id = ${x.id}");
    const file = { ast: { nodes: [forStmt] } };
    const { batchPlan, errors } = runBatchPlanner({
      files: [file],
      depGraph: null,
      // protectAnalysis deliberately absent
    });
    expect(errors.filter((e) => e.code === "E-PROTECT-003")).toEqual([]);
    expect(batchPlan.loopHoists.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// §4
// ---------------------------------------------------------------------------

describe("§4 SELECT * overlaps every protected column on target table", () => {
  test("SELECT * FROM users with protected email → E-PROTECT-003", () => {
    const forStmt = mkForStmtWithSql("SELECT * FROM users WHERE id = ${x.id}");
    const file = { ast: { nodes: [forStmt] } };
    const { batchPlan, errors } = runBatchPlanner({
      files: [file],
      depGraph: null,
      protectAnalysis: mkProtectAnalysis("users", ["email", "api_key"]),
    });
    const protectErrs = errors.filter((e) => e.code === "E-PROTECT-003");
    expect(protectErrs.length).toBe(1);
    expect(protectErrs[0].message).toContain("email");
    expect(protectErrs[0].message).toContain("api_key");
    expect(batchPlan.loopHoists).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §5
// ---------------------------------------------------------------------------

describe("§5 verifyPostRewriteLift — normal case returns []", () => {
  test("hoist with no lift in sqlTemplate → no errors", () => {
    const plan = {
      coalescedHandlers: new Map(),
      loopHoists: [
        {
          loopNode: "for#0",
          queryNode: "for#0#query",
          keyColumn: "id",
          keyExpr: "x.id",
          loopVar: "x",
          keyField: "id",
          sqlTemplate: "SELECT id, name FROM users WHERE id = ${x.id}",
          inSqlTemplate: "SELECT id, name FROM users WHERE id IN (__SCRML_BATCH_IN__)",
          terminator: "get",
          rowCacheColumns: new Set(["id", "name"]),
        },
      ],
      mountHydrate: null,
      nobatchSites: new Set(),
      diagnostics: [],
    };
    expect(verifyPostRewriteLift(plan)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §6
// ---------------------------------------------------------------------------

describe("§6 verifyPostRewriteLift — defensive E-LIFT-001 when template has lift()", () => {
  test("hoist whose sqlTemplate contains lift( → E-LIFT-001", () => {
    const plan = {
      coalescedHandlers: new Map(),
      loopHoists: [
        {
          loopNode: "for#0",
          queryNode: "for#0#query",
          keyColumn: "id",
          keyExpr: "x.id",
          loopVar: "x",
          keyField: "id",
          sqlTemplate: "SELECT lift(id), name FROM users WHERE id = ${x.id}",
          inSqlTemplate: "...",
          terminator: "get",
          rowCacheColumns: new Set(["id", "name"]),
        },
      ],
      mountHydrate: null,
      nobatchSites: new Set(),
      diagnostics: [],
    };
    const errs = verifyPostRewriteLift(plan);
    expect(errs.length).toBe(1);
    expect(errs[0].code).toBe("E-LIFT-001");
    expect(errs[0].message).toContain("§8.10.7");
  });
});
