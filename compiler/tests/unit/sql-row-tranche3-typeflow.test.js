/**
 * sql-row-tranche3-typeflow.test.js — typed-SQL-row Tranche 3 (the connecting
 * middle). SPEC §14.8.7 / §14.8.8 — end-to-end SQL-row type-flow: the row type
 * threads from a `?{}` SELECT, through a struct-return field and a call-site
 * member access, into a `:struct[]`-contracted state cell, where the §14.8.8
 * width-subtyping check engages at the CELL boundary.
 *
 * Four pieces under test:
 *   T3a — state-decl SQL-init typing: `<x> = ?{...}.all()` types the cell from
 *         the projection row (mirrors the let/const path).
 *   T3b — width-subtyping at the cell decl/assignment boundary:
 *         `checkSqlRowAgainstCellContract` fires E-SQL-ROW-CONTRACT-MISMATCH per
 *         unprojected/incompatible contract field. Same §14.8.8 rule T2 applies
 *         at the prop site, now at the cell boundary. `resolveSqlRowSourceFromExpr`
 *         + `unwrapStructContractElement` are the connective helpers.
 *   T3c — struct-return field-type propagation: an un-annotated fn returning an
 *         object literal carrying a SQL row gets an inferred `<fn-return>` struct
 *         so `data.loadRows` resolves to `Row[]` at the call site. The inferred
 *         struct is an OVER-APPROXIMATION (EXEMPT from E-TYPE-004 field access).
 *   E2E  — the flagship board.scrml chain types end-to-end via compileScrml.
 *
 * DIAGNOSTIC-STREAM PARTITION (memory: feedback_diagnostic_stream_partition):
 * E-SQL-ROW-CONTRACT-MISMATCH is Error-level -> result.errors; the cross-stream
 * helper searches BOTH streams defensively.
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { compileScrml } from "../../src/api.js";
import {
  checkSqlRowWidthSubtype,
  checkSqlRowAgainstCellContract,
  unwrapStructContractElement,
  resolveSqlRowSourceFromExpr,
  isSqlProjectionRowStruct,
  unwrapSqlProjectionRow,
  SQL_ROW_TYPE_NAME,
  FN_RETURN_TYPE_NAME,
  checkRowFieldAccessInExpr,
  tStruct,
  tArray,
  tUnion,
  tNot,
  tPrimitive,
  tAsIs,
  ScopeChain,
} from "../../src/type-system.ts";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

function compileSource(scrmlSource, tag) {
  const t = tag ?? `t3-${++tmpCounter}`;
  const tmpDir = resolve(testDir, `_tmp_t3_${t}`);
  const tmpInput = resolve(tmpDir, `${t}.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, scrmlSource);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: false, outputDir: resolve(tmpDir, "out") });
    return { errors: result.errors ?? [], warnings: result.warnings ?? [] };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
  }
}

function countCode({ errors, warnings }, code) {
  return [...errors, ...warnings].filter((d) => d.code === code).length;
}

const num = () => tPrimitive("number");
const str = () => tPrimitive("string");
function sqlRow(fields) {
  const m = new Map();
  for (const [k, v] of Object.entries(fields)) m.set(k, v);
  return tStruct(SQL_ROW_TYPE_NAME, m);
}
function fnReturn(fields) {
  const m = new Map();
  for (const [k, v] of Object.entries(fields)) m.set(k, v);
  return tStruct(FN_RETURN_TYPE_NAME, m);
}
function contractStruct(name, fields) {
  const m = new Map();
  for (const [k, v] of Object.entries(fields)) m.set(k, v);
  return tStruct(name, m);
}

const LOAD_CARD_ROW = contractStruct("LoadCardRow", {
  id: num(), status: str(),
  origin_city: str(), origin_state: str(),
  destination_city: str(), destination_state: str(),
  commodity: str(), weight_lbs: num(),
  pickup_at: str(), rate_dollars: num(),
});

const BOARD_ROW = sqlRow({
  id: num(), customer_id: num(),
  origin_city: str(), origin_state: str(),
  destination_city: str(), destination_state: str(),
  commodity: str(), weight_lbs: num(), rate_dollars: num(),
  pickup_at: str(), deliver_by: str(), status: str(),
  customer_name: str(),
});

describe("§14.8.8 T3b — unwrapStructContractElement", () => {
  test("a :struct[] contract unwraps to the per-row element struct", () => {
    const el = unwrapStructContractElement(tArray(LOAD_CARD_ROW));
    expect(el).not.toBeNull();
    expect(el.name).toBe("LoadCardRow");
  });

  test("a scalar :struct contract returns itself", () => {
    const el = unwrapStructContractElement(LOAD_CARD_ROW);
    expect(el).not.toBeNull();
    expect(el.name).toBe("LoadCardRow");
  });

  test("a non-struct / non-struct-array type -> null (no-op)", () => {
    expect(unwrapStructContractElement(tArray(num()))).toBeNull();
    expect(unwrapStructContractElement(num())).toBeNull();
    expect(unwrapStructContractElement(null)).toBeNull();
  });
});

describe("§14.8.8 T3b — checkSqlRowAgainstCellContract (cell boundary)", () => {
  const span = { file: "t.scrml", start: 0, end: 0, line: 1, col: 1 };

  test("Row[] source vs LoadCardRow[] contract (superset) — 0 violations, no error", () => {
    const errors = [];
    checkSqlRowAgainstCellContract("loadRows", tArray(BOARD_ROW), tArray(LOAD_CARD_ROW), span, errors);
    expect(errors.length).toBe(0);
  });

  test("Row[] missing a contracted field -> E-SQL-ROW-CONTRACT-MISMATCH naming the field", () => {
    const partial = sqlRow({
      id: num(), status: str(),
      origin_city: str(), origin_state: str(),
      destination_city: str(), destination_state: str(),
      commodity: str(), weight_lbs: num(), pickup_at: str(),
    });
    const errors = [];
    checkSqlRowAgainstCellContract("loadRows", tArray(partial), tArray(LOAD_CARD_ROW), span, errors);
    expect(errors.length).toBe(1);
    expect(errors[0].code).toBe("E-SQL-ROW-CONTRACT-MISMATCH");
    expect(errors[0].message).toContain("rate_dollars");
    expect(errors[0].message).toContain("loadRows");
  });

  test("a non-sql-row source -> no-op (general assignment stays unchecked)", () => {
    const errors = [];
    checkSqlRowAgainstCellContract("x", tArray(LOAD_CARD_ROW), tArray(LOAD_CARD_ROW), span, errors);
    expect(errors.length).toBe(0);
  });

  test("a non-struct contract -> no-op", () => {
    const errors = [];
    checkSqlRowAgainstCellContract("x", tArray(BOARD_ROW), tArray(num()), span, errors);
    expect(errors.length).toBe(0);
  });

  test("scalar Row | not source vs scalar :struct contract (the .get() shape)", () => {
    const errors = [];
    checkSqlRowAgainstCellContract("u", tUnion([BOARD_ROW, tNot()]), LOAD_CARD_ROW, span, errors);
    expect(errors.length).toBe(0);
  });
});

describe("§14.8.8 T3c — resolveSqlRowSourceFromExpr", () => {
  test("a bare ident bound to a sql-row resolves to the row type", () => {
    const sc = new ScopeChain();
    sc.bind("rows", { kind: "variable", resolvedType: tArray(BOARD_ROW) });
    const t = resolveSqlRowSourceFromExpr({ kind: "ident", name: "rows" }, sc);
    expect(t).not.toBeNull();
    expect(unwrapSqlProjectionRow(t)).not.toBeNull();
  });

  test("data.loadRows over a <fn-return> struct resolves to the field's Row[]", () => {
    const sc = new ScopeChain();
    const ret = fnReturn({ user: tAsIs(), loadRows: tArray(BOARD_ROW) });
    sc.bind("data", { kind: "variable", resolvedType: ret });
    const t = resolveSqlRowSourceFromExpr(
      { kind: "member", object: { kind: "ident", name: "data" }, property: "loadRows" },
      sc,
    );
    expect(t).not.toBeNull();
    expect(unwrapSqlProjectionRow(t)).not.toBeNull();
  });

  test("data.loadRows over a UNION return — the field-present sql-row arm wins", () => {
    const sc = new ScopeChain();
    const armA = fnReturn({ unauthorized: tPrimitive("boolean") });
    const armB = fnReturn({ user: tAsIs(), loadRows: tArray(BOARD_ROW) });
    sc.bind("data", { kind: "variable", resolvedType: tUnion([armA, armB]) });
    const t = resolveSqlRowSourceFromExpr(
      { kind: "member", object: { kind: "ident", name: "data" }, property: "loadRows" },
      sc,
    );
    expect(t).not.toBeNull();
    expect(unwrapSqlProjectionRow(t)).not.toBeNull();
  });

  test("a member access whose field is NOT a sql-row -> null (no-op)", () => {
    const sc = new ScopeChain();
    const ret = fnReturn({ user: tAsIs(), count: num() });
    sc.bind("data", { kind: "variable", resolvedType: ret });
    const t = resolveSqlRowSourceFromExpr(
      { kind: "member", object: { kind: "ident", name: "data" }, property: "count" },
      sc,
    );
    expect(t).toBeNull();
  });

  test("an unbound ident / unknown shape -> null", () => {
    const sc = new ScopeChain();
    expect(resolveSqlRowSourceFromExpr({ kind: "ident", name: "nope" }, sc)).toBeNull();
    expect(resolveSqlRowSourceFromExpr({ kind: "lit", value: 1 }, sc)).toBeNull();
  });
});

describe("§14.8.8 T3c — <fn-return> exemption from E-TYPE-004", () => {
  const span = { file: "t.scrml", start: 0, end: 0, line: 1, col: 1 };

  test("a field absent from a <fn-return> struct does NOT fire E-TYPE-004", () => {
    const sc = new ScopeChain();
    sc.bind("data", { kind: "variable", resolvedType: fnReturn({ user: tAsIs(), loadRows: tArray(BOARD_ROW) }) });
    const errors = [];
    checkRowFieldAccessInExpr(
      { kind: "member", object: { kind: "ident", name: "data" }, property: "error" },
      span, sc, errors,
    );
    expect(errors.length).toBe(0);
  });

  test("a real <sql-row> struct STILL fires E-TYPE-004 on an unknown field", () => {
    const sc = new ScopeChain();
    sc.bind("r", { kind: "variable", resolvedType: BOARD_ROW });
    const errors = [];
    checkRowFieldAccessInExpr(
      { kind: "member", object: { kind: "ident", name: "r" }, property: "bogus_col" },
      span, sc, errors,
    );
    expect(errors.length).toBe(1);
    expect(errors[0].code).toBe("E-TYPE-004");
  });
});

const DB_HEADER = `<program db="./shadow.db">
<db src="./shadow.db" protect="passwordHash" tables="users">
  \${
    function _bootstrap() {
      ?{\`CREATE TABLE loads (
        id INTEGER PRIMARY KEY,
        status TEXT NOT NULL,
        origin_city TEXT NOT NULL,
        origin_state TEXT NOT NULL,
        destination_city TEXT NOT NULL,
        destination_state TEXT NOT NULL,
        commodity TEXT NOT NULL,
        weight_lbs INTEGER,
        pickup_at TEXT,
        rate_dollars INTEGER
      )\`}.run()
    }
`;
const DB_FOOTER = `  }
</>
</>`;

describe("§14.8.8 T3 — end-to-end flagship-shaped chain", () => {
  test("full projection covers the contract -> 0 E-SQL-ROW-CONTRACT-MISMATCH", () => {
    const src = DB_HEADER + `
    type LoadRow:struct = {
      id: number, status: string,
      origin_city: string, origin_state: string,
      destination_city: string, destination_state: string,
      commodity: string, weight_lbs: number,
      pickup_at: string, rate_dollars: number,
    }

    function loadBoard() {
      const rows = ?{\`SELECT id, status, origin_city, origin_state,
        destination_city, destination_state, commodity, weight_lbs,
        pickup_at, rate_dollars FROM loads\`}.all()
      return { loadRows: rows }
    }

    <loadRows>: LoadRow[] = []

    function refresh() {
      const data = loadBoard()
      @loadRows = data.loadRows
    }
` + DB_FOOTER;
    const res = compileSource(src, "e2e-pass");
    expect(countCode(res, "E-SQL-ROW-CONTRACT-MISMATCH")).toBe(0);
  });

  test("projection MISSING a contracted column -> E-SQL-ROW-CONTRACT-MISMATCH at the cell boundary", () => {
    const src = DB_HEADER + `
    type LoadRow:struct = {
      id: number, status: string,
      origin_city: string, origin_state: string,
      destination_city: string, destination_state: string,
      commodity: string, weight_lbs: number,
      pickup_at: string, rate_dollars: number,
    }

    function loadBoard() {
      const rows = ?{\`SELECT id, status, origin_city, origin_state,
        destination_city, destination_state, commodity, weight_lbs,
        pickup_at FROM loads\`}.all()
      return { loadRows: rows }
    }

    <loadRows>: LoadRow[] = []

    function refresh() {
      const data = loadBoard()
      @loadRows = data.loadRows
    }
` + DB_FOOTER;
    const res = compileSource(src, "e2e-fail");
    expect(countCode(res, "E-SQL-ROW-CONTRACT-MISMATCH")).toBeGreaterThanOrEqual(1);
    const all = [...res.errors, ...res.warnings];
    const hit = all.find((d) => d.code === "E-SQL-ROW-CONTRACT-MISMATCH");
    expect(hit.message).toContain("rate_dollars");
  });
});
