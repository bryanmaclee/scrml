/**
 * sql-row-tranche2-width-subtype.test.js — typed-SQL-row Tranche 2 (Shape C).
 * SPEC §14.8.8 — cross-file typed-prop contract + structural width-subtyping.
 *
 * Two halves under test:
 *
 *   T2a (typed prop / loop-var access) — END-TO-END via compileScrml: a
 *   `for (let r of rows)` / `<each in=rows as r>` over a SQL-projection `Row[]`
 *   binds `r` to the row STRUCT, so `r.<knownCol>` types and `r.<unknownCol>`
 *   fires E-TYPE-004. Bounded to sql-row provenance — an `asIs` collection
 *   produces NO field check (Tranche-1 permissive bare access preserved).
 *
 *   The bounded WIDTH-SUBTYPING helper (`checkSqlRowWidthSubtype`) — unit-level:
 *   a SQL-projection row width-subtypes into a declared `:struct` contract iff
 *   the row carries every contract field with an assignable type (EXTRA row
 *   columns allowed). The board row (13 cols incl. customer_name) and the
 *   load-detail wider row both width-subtype into the 10-field LoadCardRow.
 *   A row missing a contracted field yields a `missing` violation (the
 *   E-SQL-ROW-CONTRACT-MISMATCH trigger). General struct-to-struct assignment
 *   is NOMINAL and never routes through the helper (the source must be a
 *   `<sql-row>` struct — `isSqlProjectionRowStruct`).
 *
 * DIAGNOSTIC-STREAM PARTITION (memory: feedback_diagnostic_stream_partition):
 * E-TYPE-004 / E-SQL-ROW-CONTRACT-MISMATCH are Error-level → result.errors.
 * The cross-stream helper searches BOTH streams defensively.
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { compileScrml } from "../../src/api.js";
import {
  checkSqlRowWidthSubtype,
  isSqlProjectionRowStruct,
  unwrapSqlProjectionRow,
  SQL_ROW_TYPE_NAME,
  tStruct,
  tArray,
  tUnion,
  tNot,
  tPrimitive,
  tAsIs,
  checkPropContract,
  checkRowFieldAccessInExpr,
  ScopeChain,
} from "../../src/type-system.ts";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

function compileSource(scrmlSource, tag) {
  const t = tag ?? `t2-${++tmpCounter}`;
  const tmpDir = resolve(testDir, `_tmp_t2_${t}`);
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

function hasCode({ errors, warnings }, code) {
  return [...errors, ...warnings].some((d) => d.code === code);
}

// Shared `< db>` header: a CREATE TABLE in a startup `?{}` builds the shadow
// schema (no on-disk .db needed). `users` has id INTEGER, email TEXT.
const DB_HEADER = `<program db="./shadow.db">
<db src="./shadow.db" protect="passwordHash" tables="users">
  \${
    function _bootstrap() {
      ?{\`CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        email TEXT NOT NULL,
        name TEXT,
        passwordHash TEXT NOT NULL
      )\`}.run()
    }
`;
const DB_FOOTER = `  }
</>
</>`;

// ---------------------------------------------------------------------------
// Helpers to build a SQL-projection-row StructType for the unit-level tests.
// The Tranche-1 row carries the compiler-internal name SQL_ROW_TYPE_NAME.
// ---------------------------------------------------------------------------
function sqlRow(fields) {
  const m = new Map();
  for (const [k, v] of Object.entries(fields)) m.set(k, v);
  return tStruct(SQL_ROW_TYPE_NAME, m);
}
function contractStruct(name, fields) {
  const m = new Map();
  for (const [k, v] of Object.entries(fields)) m.set(k, v);
  return tStruct(name, m);
}
const num = () => tPrimitive("number");
const str = () => tPrimitive("string");

// The flagship LoadCardRow contract (the 10 columns load-card.scrml reads).
const LOAD_CARD_ROW = contractStruct("LoadCardRow", {
  id: num(), status: str(),
  origin_city: str(), origin_state: str(),
  destination_city: str(), destination_state: str(),
  commodity: str(), weight_lbs: num(),
  pickup_at: str(), rate_dollars: num(),
});

// The board.scrml projection row (13 cols incl. customer_name; superset).
const BOARD_ROW = sqlRow({
  id: num(), customer_id: num(),
  origin_city: str(), origin_state: str(),
  destination_city: str(), destination_state: str(),
  commodity: str(), weight_lbs: num(), rate_dollars: num(),
  pickup_at: str(), deliver_by: str(), status: str(),
  customer_name: str(),
});

// A load-detail-style WIDER row (everything board has + extras).
const LOAD_DETAIL_ROW = sqlRow({
  id: num(), customer_id: num(),
  origin_address: str(), origin_city: str(), origin_state: str(),
  destination_address: str(), destination_city: str(), destination_state: str(),
  commodity: str(), weight_lbs: num(), rate_dollars: num(),
  pickup_at: str(), deliver_by: str(), status: str(),
  created_at: str(), updated_at: str(),
});

describe("§14.8.8 — bounded width-subtyping helper (Tranche 2)", () => {
  test("the board row (superset) width-subtypes into LoadCardRow — 0 violations", () => {
    expect(isSqlProjectionRowStruct(BOARD_ROW)).toBe(true);
    const v = checkSqlRowWidthSubtype(BOARD_ROW, LOAD_CARD_ROW);
    expect(v).toEqual([]);
  });

  test("the load-detail (wider) row also width-subtypes into LoadCardRow", () => {
    const v = checkSqlRowWidthSubtype(LOAD_DETAIL_ROW, LOAD_CARD_ROW);
    expect(v).toEqual([]);
  });

  test("a row MISSING a contracted field → one `missing` violation (E-SQL-ROW-CONTRACT-MISMATCH trigger)", () => {
    const partial = sqlRow({
      id: num(), status: str(),
      origin_city: str(), origin_state: str(),
      destination_city: str(), destination_state: str(),
      commodity: str(), weight_lbs: num(), pickup_at: str(),
      // rate_dollars MISSING.
    });
    const v = checkSqlRowWidthSubtype(partial, LOAD_CARD_ROW);
    expect(v.length).toBe(1);
    expect(v[0].field).toBe("rate_dollars");
    expect(v[0].reason).toBe("missing");
  });

  test("a row with an INCOMPATIBLE field type → one `incompatible` violation", () => {
    const wrong = sqlRow({
      id: str(), status: str(),  // id is string in the row but number in the contract.
      origin_city: str(), origin_state: str(),
      destination_city: str(), destination_state: str(),
      commodity: str(), weight_lbs: num(), pickup_at: str(), rate_dollars: num(),
    });
    const v = checkSqlRowWidthSubtype(wrong, LOAD_CARD_ROW);
    expect(v.length).toBe(1);
    expect(v[0].field).toBe("id");
    expect(v[0].reason).toBe("incompatible");
  });

  test("an `asIs` row field (graceful-degraded column) is assignable to any contract field — no violation", () => {
    const degraded = sqlRow({
      id: num(), status: str(),
      origin_city: str(), origin_state: str(),
      destination_city: str(), destination_state: str(),
      commodity: str(), weight_lbs: num(),
      pickup_at: tAsIs(),           // degraded column.
      rate_dollars: tAsIs(),        // degraded column.
    });
    const v = checkSqlRowWidthSubtype(degraded, LOAD_CARD_ROW);
    expect(v).toEqual([]);
  });

  test("an optional contract field (string | not) accepts a string row field", () => {
    const contract = contractStruct("WithOptional", {
      id: num(),
      note: tUnion([str(), tNot()]),
    });
    const row = sqlRow({ id: num(), note: str(), extra: str() });
    expect(checkSqlRowWidthSubtype(row, contract)).toEqual([]);
  });

  test("BOUNDED: a plain (non-sql-row) struct is NOT a projection row — provenance gate", () => {
    const plain = tStruct("PlainStruct", new Map([["id", num()]]));
    expect(isSqlProjectionRowStruct(plain)).toBe(false);
    // The general struct→struct path never calls the helper; the caller gates on
    // isSqlProjectionRowStruct. (The helper itself is structural, but it is only
    // reachable for a <sql-row> source — this asserts the provenance predicate.)
  });

  test("unwrapSqlProjectionRow peels Row[] and Row | not down to the row struct", () => {
    expect(unwrapSqlProjectionRow(tArray(BOARD_ROW))).toBe(BOARD_ROW);
    expect(unwrapSqlProjectionRow(tUnion([BOARD_ROW, tNot()]))).toBe(BOARD_ROW);
    expect(unwrapSqlProjectionRow(BOARD_ROW)).toBe(BOARD_ROW);
    // A non-row array is not unwrapped.
    expect(unwrapSqlProjectionRow(tArray(tPrimitive("number")))).toBe(null);
  });
});

describe("§14.8.8 T2a — typed loop-var row access (E-TYPE-004), end-to-end", () => {
  test("for-of over a typed Row[]: an unknown field fires E-TYPE-004", () => {
    const src = DB_HEADER + `
    function listEmails() {
      const rows = ?{\`SELECT id, email FROM users\`}.all()
      for (let r of rows) {
        const z = r.bogusField
      }
    }
` + DB_FOOTER;
    const r = compileSource(src, "t2a-unknown");
    expect(hasCode(r, "E-TYPE-004")).toBe(true);
    // Error-level → result.errors (not warnings).
    expect(r.errors.some((e) => e.code === "E-TYPE-004")).toBe(true);
  });

  test("for-of over a typed Row[]: a KNOWN field types cleanly (no E-TYPE-004)", () => {
    const src = DB_HEADER + `
    function listEmails() {
      const rows = ?{\`SELECT id, email FROM users\`}.all()
      for (let r of rows) {
        const a = r.id
        const b = r.email
      }
    }
` + DB_FOOTER;
    const r = compileSource(src, "t2a-known");
    expect(hasCode(r, "E-TYPE-004")).toBe(false);
  });

  test("BOUNDED: for-of over an asIs collection does NOT field-check (Tranche-1 permissive)", () => {
    const src = DB_HEADER + `
    function overArray() {
      const items = [1, 2, 3]
      for (let r of items) {
        const z = r.anythingGoes
      }
    }
` + DB_FOOTER;
    const r = compileSource(src, "t2a-bounded");
    expect(hasCode(r, "E-TYPE-004")).toBe(false);
  });
});

const _span = () => ({ file: "t2.scrml", start: 0, end: 0, line: 1, col: 1 });

describe("§14.8.8 T2b — call-site prop-contract check (checkPropContract → E-SQL-ROW-CONTRACT-MISMATCH)", () => {
  test("a SQL-row value missing a contracted field fires E-SQL-ROW-CONTRACT-MISMATCH", () => {
    const sc = new ScopeChain();
    // `l` is the per-item row binding (Row[] element) — typed the BOARD_ROW.
    sc.bind("l", { kind: "variable", resolvedType: BOARD_ROW });
    const typeReg = new Map([["LoadCardRow", LOAD_CARD_ROW]]);
    const errors = [];
    // BOARD_ROW carries all 10 LoadCardRow cols → no violation (the legit case).
    checkPropContract(
      { propName: "load", contractType: "LoadCardRow", valueExprNode: { kind: "ident", name: "l" }, span: _span() },
      sc, typeReg, errors, "t2.scrml",
    );
    expect(errors).toHaveLength(0);

    // A row missing `rate_dollars` → exactly one E-SQL-ROW-CONTRACT-MISMATCH.
    const partial = sqlRow({
      id: num(), status: str(),
      origin_city: str(), origin_state: str(),
      destination_city: str(), destination_state: str(),
      commodity: str(), weight_lbs: num(), pickup_at: str(),
    });
    sc.bind("p", { kind: "variable", resolvedType: partial });
    const errors2 = [];
    checkPropContract(
      { propName: "load", contractType: "LoadCardRow", valueExprNode: { kind: "ident", name: "p" }, span: _span() },
      sc, typeReg, errors2, "t2.scrml",
    );
    expect(errors2.length).toBe(1);
    expect(errors2[0].code).toBe("E-SQL-ROW-CONTRACT-MISMATCH");
    expect(errors2[0].message).toMatch(/rate_dollars/);
    expect(errors2[0].message).toMatch(/LoadCardRow/);
  });

  test("the per-ITEM row is unwrapped from a Row[] binding (caller iterates the array)", () => {
    const sc = new ScopeChain();
    sc.bind("rowsArr", { kind: "variable", resolvedType: tArray(BOARD_ROW) });
    const typeReg = new Map([["LoadCardRow", LOAD_CARD_ROW]]);
    const errors = [];
    checkPropContract(
      { propName: "load", contractType: "LoadCardRow", valueExprNode: { kind: "ident", name: "rowsArr" }, span: _span() },
      sc, typeReg, errors, "t2.scrml",
    );
    // The board row width-subtypes → no violation even via the array binding.
    expect(errors).toHaveLength(0);
  });

  test("BOUNDED: a NON-sql-row struct value → NO contract check (general assignment stays nominal)", () => {
    const sc = new ScopeChain();
    // A plain user struct that happens to have the SAME fields but is NOT a
    // sql-row → the bounded width-subtyping rule does NOT apply (no-op).
    const plain = tStruct("SomeUserStruct", new Map([["id", num()]]));
    sc.bind("u", { kind: "variable", resolvedType: plain });
    const typeReg = new Map([["LoadCardRow", LOAD_CARD_ROW]]);
    const errors = [];
    checkPropContract(
      { propName: "load", contractType: "LoadCardRow", valueExprNode: { kind: "ident", name: "u" }, span: _span() },
      sc, typeReg, errors, "t2.scrml",
    );
    // No E-SQL-ROW-CONTRACT-MISMATCH — the source is not a projection row.
    expect(errors).toHaveLength(0);
  });

  test("a contract that is NOT a struct (e.g. a primitive name) → no-op", () => {
    const sc = new ScopeChain();
    sc.bind("l", { kind: "variable", resolvedType: BOARD_ROW });
    const typeReg = new Map([["NotAStruct", tPrimitive("number")]]);
    const errors = [];
    checkPropContract(
      { propName: "load", contractType: "NotAStruct", valueExprNode: { kind: "ident", name: "l" }, span: _span() },
      sc, typeReg, errors, "t2.scrml",
    );
    expect(errors).toHaveLength(0);
  });
});

describe("§14.8.8 T2a — checkRowFieldAccessInExpr (the live E-TYPE-004 wire-in)", () => {
  test("a member access on a sql-row-typed ident, unknown field → E-TYPE-004", () => {
    const sc = new ScopeChain();
    sc.bind("r", { kind: "variable", resolvedType: BOARD_ROW });
    const errors = [];
    // member(object=ident(r), property="bogus")
    const expr = { kind: "member", object: { kind: "ident", name: "r" }, property: "bogus", span: _span() };
    checkRowFieldAccessInExpr(expr, _span(), sc, errors);
    expect(errors.length).toBe(1);
    expect(errors[0].code).toBe("E-TYPE-004");
    expect(errors[0].message).toMatch(/SQL projection row/);
    expect(errors[0].message).toMatch(/bogus/);
  });

  test("a member access on a sql-row-typed ident, KNOWN field → no error", () => {
    const sc = new ScopeChain();
    sc.bind("r", { kind: "variable", resolvedType: BOARD_ROW });
    const errors = [];
    const expr = { kind: "member", object: { kind: "ident", name: "r" }, property: "status", span: _span() };
    checkRowFieldAccessInExpr(expr, _span(), sc, errors);
    expect(errors).toHaveLength(0);
  });

  test("a member access on an asIs binding → no check (Tranche-1 permissive)", () => {
    const sc = new ScopeChain();
    sc.bind("r", { kind: "variable", resolvedType: tAsIs() });
    const errors = [];
    const expr = { kind: "member", object: { kind: "ident", name: "r" }, property: "whatever", span: _span() };
    checkRowFieldAccessInExpr(expr, _span(), sc, errors);
    expect(errors).toHaveLength(0);
  });
});
