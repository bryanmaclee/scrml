/**
 * protect= Analyzer (PA) — Unit Tests
 *
 * Tests for src/protect-analyzer.js.
 *
 * Strategy:
 *   - All tests that require a real SQLite file create one using Bun's SQLite
 *     module in a temp path. The temp path is constructed per test (or per
 *     describe block) so tests are fully isolated.
 *   - FileAST inputs are constructed directly (no full pipeline run) because
 *     PA is defined to consume FileAST[] and must be testable in isolation.
 *   - Error-path tests verify error codes and message content; they do not
 *     assert the exact message text (which may change) but do assert the
 *     substring described in SPEC.md §11.5.
 *
 * Coverage:
 *   parse algorithm  — §11.1.1 four-step canonical algorithm
 *   happy paths      — no protect=, protect= with one table, protect= across tables
 *   E-PA-001         — src= file not found (no shadow DB possible)
 *   E-PA-002         — src= file not found, no CREATE TABLE in ?{} blocks
 *   E-PA-003         — SQLite open / introspection failure (corrupt file)
 *   E-PA-004         — tables= names a table absent from the db
 *   E-PA-005         — tables= absent; tables= parses to empty
 *   E-PA-006         — src= absent
 *   E-PA-007         — protect= field not found in any table (security error)
 *   multi-block      — two < db> blocks produce independent views entries
 *   deduplication    — two blocks sharing the same dbPath share the open
 *   no AST mutation  — input is not modified
 *   shadow DB        — file missing + CREATE TABLE in ?{} -> shadow DB, no error
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { runPA, PAError } from "../../src/protect-analyzer.js";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Temp-file helpers
// ---------------------------------------------------------------------------

/**
 * Create a fresh temp directory for a test suite. Returns the directory path.
 * The caller is responsible for cleanup via rmSync.
 */
function makeTempDir() {
  return mkdtempSync(join(tmpdir(), "scrml-pa-test-"));
}

/**
 * Create a SQLite database in dir with the given schema SQL.
 * Returns the absolute path to the created file.
 *
 * @param {string} dir
 * @param {string} filename
 * @param {string[]} schemaSQLStatements  — each element is one CREATE TABLE …
 * @returns {string}
 */
function createTestDb(dir, filename, schemaSQLStatements) {
  const dbPath = join(dir, filename);
  const db = new Database(dbPath);
  for (const sql of schemaSQLStatements) {
    db.run(sql);
  }
  db.close();
  return dbPath;
}

// ---------------------------------------------------------------------------
// FileAST construction helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal FileAST whose nodes array contains a single < db> state block.
 *
 * @param {string}  filePath  — the source file path (must be absolute)
 * @param {object}  attrMap   — { src, tables, protect } — absent keys produce no attr node
 * @param {number}  spanStart — the span.start offset of the block (default 0)
 * @returns {{ filePath: string, nodes: object[] }}
 */
function makeDbFileAST(filePath, attrMap, spanStart = 0, extraNodes = []) {
  const attrs = [];
  const dummySpan = { file: filePath, start: spanStart, end: spanStart + 20, line: 1, col: 1 };

  for (const [name, value] of Object.entries(attrMap)) {
    attrs.push({
      name,
      value: { kind: "string-literal", value },
      span: dummySpan,
    });
  }

  const blockSpan = { file: filePath, start: spanStart, end: spanStart + 100, line: 1, col: 1 };

  return {
    filePath,
    nodes: [
      ...extraNodes,
      {
        id: 1,
        kind: "state",
        stateType: "db",
        attrs,
        children: [],
        span: blockSpan,
      },
    ],
  };
}

/**
 * Unwrap the single entry from protectAnalysis.views for tests that have
 * exactly one < db> block in one file.
 *
 * @param {{ views: Map<string, object> }} pa
 * @returns {object}  DBTypeViews
 */
function singleView(pa) {
  expect(pa.views.size).toBe(1);
  return pa.views.values().next().value;
}

// ---------------------------------------------------------------------------
// §11.1.1 — Canonical parse algorithm
// ---------------------------------------------------------------------------

// We test the algorithm indirectly via the protect= and tables= processing
// path, but for clarity we also exercise edge cases by constructing minimal
// FileASTs that hit the parsing code.  Correct parsing is already exercised
// by the full happy-path tests below; this section focuses on edge-case
// tokenisation.

describe("§11.1.1 canonical parse algorithm — tables=", () => {
  let dir;
  let dbPath;

  beforeAll(() => {
    dir = makeTempDir();
    dbPath = createTestDb(dir, "parse-algo.sqlite", [
      "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL)",
    ]);
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("leading/trailing whitespace in tables= is trimmed", () => {
    const srcFile = join(dir, "test.scrml");
    const ast = makeDbFileAST(srcFile, {
      src: "parse-algo.sqlite",
      tables: "  users  ",
    });
    const { protectAnalysis, errors } = runPA({ files: [ast] });
    expect(errors).toHaveLength(0);
    expect(protectAnalysis.views.size).toBe(1);
    const view = singleView(protectAnalysis);
    expect(view.tables.has("users")).toBe(true);
  });

  test("consecutive commas in tables= produce empty tokens that are discarded", () => {
    // tables="users,,users" — the empty middle token is discarded
    // but "users" deduplication is not our concern; what matters is no error
    const srcFile = join(dir, "test2.scrml");
    const ast = makeDbFileAST(srcFile, {
      src: "parse-algo.sqlite",
      tables: "users,,users",
    });
    // We pass "users" twice — the second attempt to read the same schema is fine
    const { protectAnalysis, errors } = runPA({ files: [ast] });
    // No error: the empty token is silently discarded; "users" appears twice
    // but both reads succeed.
    const tableErrors = errors.filter(e => e.code !== "E-PA-005");
    expect(tableErrors).toHaveLength(0);
  });

  test("tables= empty string emits E-PA-005", () => {
    const srcFile = join(dir, "test3.scrml");
    const ast = makeDbFileAST(srcFile, {
      src: "parse-algo.sqlite",
      tables: "",
    });
    const { errors } = runPA({ files: [ast] });
    expect(errors.some(e => e.code === "E-PA-005")).toBe(true);
  });

  test("tables= only commas emits E-PA-005", () => {
    const srcFile = join(dir, "test4.scrml");
    const ast = makeDbFileAST(srcFile, {
      src: "parse-algo.sqlite",
      tables: ",,,",
    });
    const { errors } = runPA({ files: [ast] });
    expect(errors.some(e => e.code === "E-PA-005")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// E-PA-006 — src= absent
// ---------------------------------------------------------------------------

describe("E-PA-006 — src= absent", () => {
  let dir;

  beforeAll(() => { dir = makeTempDir(); });
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  test("emits E-PA-006 when src= is absent", () => {
    const srcFile = join(dir, "no-src.scrml");
    const ast = makeDbFileAST(srcFile, { tables: "users" });
    const { protectAnalysis, errors } = runPA({ files: [ast] });
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe("E-PA-006");
    expect(protectAnalysis.views.size).toBe(0);
  });

  test("E-PA-006 error span refers to the block span", () => {
    const srcFile = join(dir, "no-src2.scrml");
    const ast = makeDbFileAST(srcFile, { tables: "users" }, 42);
    const { errors } = runPA({ files: [ast] });
    expect(errors[0].span.start).toBe(42);
  });

  test("other blocks in the file are unaffected when one block has no src=", () => {
    // This test verifies fail-fast-per-block semantics: the bad block is
    // skipped; a good block in the same file still gets an entry.
    const dir2 = makeTempDir();
    try {
      const dbPath = createTestDb(dir2, "other.sqlite", [
        "CREATE TABLE items (id INTEGER PRIMARY KEY, label TEXT)",
      ]);
      const srcFile = join(dir2, "two-blocks.scrml");

      // Two blocks: one without src=, one complete.
      const badBlockSpan  = { file: srcFile, start: 0,  end: 50,  line: 1, col: 1 };
      const goodBlockSpan = { file: srcFile, start: 100, end: 200, line: 5, col: 1 };

      const ast = {
        filePath: srcFile,
        nodes: [
          {
            id: 1, kind: "state", stateType: "db",
            attrs: [
              { name: "tables", value: { kind: "string-literal", value: "items" }, span: badBlockSpan },
            ],
            children: [], span: badBlockSpan,
          },
          {
            id: 2, kind: "state", stateType: "db",
            attrs: [
              { name: "src",    value: { kind: "string-literal", value: "other.sqlite" }, span: goodBlockSpan },
              { name: "tables", value: { kind: "string-literal", value: "items" }, span: goodBlockSpan },
            ],
            children: [], span: goodBlockSpan,
          },
        ],
      };

      const { protectAnalysis, errors } = runPA({ files: [ast] });
      expect(errors.some(e => e.code === "E-PA-006")).toBe(true);
      expect(protectAnalysis.views.size).toBe(1); // only the good block
      const [id] = [...protectAnalysis.views.keys()];
      expect(id).toContain("::100"); // good block span.start
    } finally {
      rmSync(dir2, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// E-PA-005 — tables= absent
// ---------------------------------------------------------------------------

describe("E-PA-005 — tables= absent or empty", () => {
  let dir;
  let dbPath;

  beforeAll(() => {
    dir = makeTempDir();
    dbPath = createTestDb(dir, "db.sqlite", [
      "CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT)",
    ]);
  });
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  test("emits E-PA-005 when tables= is absent", () => {
    const srcFile = join(dir, "no-tables.scrml");
    const ast = makeDbFileAST(srcFile, { src: "db.sqlite" });
    const { protectAnalysis, errors } = runPA({ files: [ast] });
    expect(errors.some(e => e.code === "E-PA-005")).toBe(true);
    expect(protectAnalysis.views.size).toBe(0);
  });

  test("emits E-PA-005 when tables= parses to empty list", () => {
    const srcFile = join(dir, "empty-tables.scrml");
    const ast = makeDbFileAST(srcFile, { src: "db.sqlite", tables: "  ,  ,  " });
    const { errors } = runPA({ files: [ast] });
    expect(errors.some(e => e.code === "E-PA-005")).toBe(true);
  });

  test("src= is checked before tables= — both absent produces only E-PA-006", () => {
    // PA halts processing at the first failure per block. If src= is absent,
    // it must not also emit E-PA-005 for the same block.
    const srcFile = join(dir, "both-absent.scrml");
    const ast = makeDbFileAST(srcFile, {});
    const { errors } = runPA({ files: [ast] });
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe("E-PA-006");
  });
});

// ---------------------------------------------------------------------------
// E-PA-002 — src= file not found, no CREATE TABLE in ?{} blocks
// (E-PA-001 is retired: the "file missing" path now goes through the shadow DB
//  check first. E-PA-002 fires when shadow DB cannot be built.)
// ---------------------------------------------------------------------------

describe("E-PA-002 — src= file missing and no CREATE TABLE in ?{} blocks", () => {
  let dir;

  beforeAll(() => { dir = makeTempDir(); });
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  test("emits E-PA-002 when the database file does not exist and no CREATE TABLE is present", () => {
    const srcFile = join(dir, "app.scrml");
    const ast = makeDbFileAST(srcFile, {
      src: "nonexistent.sqlite",
      tables: "users",
    });
    const { protectAnalysis, errors } = runPA({ files: [ast] });
    // No E-PA-001 (retired), but E-PA-002 fires because no ?{} CREATE TABLE was found.
    expect(errors.some(e => e.code === "E-PA-002")).toBe(true);
    expect(protectAnalysis.views.size).toBe(0);
  });

  test("E-PA-002 message contains the resolved path and missing table name", () => {
    const srcFile = join(dir, "app2.scrml");
    const ast = makeDbFileAST(srcFile, {
      src: "missing.sqlite",
      tables: "users",
    });
    const { errors } = runPA({ files: [ast] });
    const e = errors.find(e => e.code === "E-PA-002");
    expect(e).toBeDefined();
    expect(e.message).toContain("missing.sqlite");
    expect(e.message).toContain("users");
  });
});

// ---------------------------------------------------------------------------
// E-PA-003 — SQLite introspection failure
// ---------------------------------------------------------------------------

describe("E-PA-003 — SQLite open failure", () => {
  let dir;

  beforeAll(() => { dir = makeTempDir(); });
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  test("emits E-PA-003 when the file exists but is not a valid SQLite database", () => {
    // Write a file with invalid SQLite magic bytes.
    const badDbPath = join(dir, "corrupt.sqlite");
    writeFileSync(badDbPath, "this is definitely not a sqlite file\n");

    const srcFile = join(dir, "app.scrml");
    const ast = makeDbFileAST(srcFile, {
      src: "corrupt.sqlite",
      tables: "users",
    });
    const { protectAnalysis, errors } = runPA({ files: [ast] });
    expect(errors.some(e => e.code === "E-PA-003")).toBe(true);
    expect(protectAnalysis.views.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// E-PA-004 — table not found in database
// ---------------------------------------------------------------------------

describe("E-PA-004 — table not found", () => {
  let dir;
  let dbPath;

  beforeAll(() => {
    dir = makeTempDir();
    dbPath = createTestDb(dir, "db.sqlite", [
      "CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL)",
    ]);
  });
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  test("emits E-PA-004 when a table name is absent from the database", () => {
    const srcFile = join(dir, "app.scrml");
    const ast = makeDbFileAST(srcFile, {
      src: "db.sqlite",
      tables: "users, ghost_table",
    });
    const { protectAnalysis, errors } = runPA({ files: [ast] });
    expect(errors.some(e => e.code === "E-PA-004")).toBe(true);
    // The block fails entirely — no views entry.
    expect(protectAnalysis.views.size).toBe(0);
  });

  test("E-PA-004 message contains the missing table name", () => {
    const srcFile = join(dir, "app2.scrml");
    const ast = makeDbFileAST(srcFile, {
      src: "db.sqlite",
      tables: "orders",
    });
    const { errors } = runPA({ files: [ast] });
    const e = errors.find(e => e.code === "E-PA-004");
    expect(e.message).toContain("orders");
  });

  test("errors are accumulated for all missing tables before returning", () => {
    const srcFile = join(dir, "app3.scrml");
    const ast = makeDbFileAST(srcFile, {
      src: "db.sqlite",
      tables: "ghost1, ghost2",
    });
    const { errors } = runPA({ files: [ast] });
    const e004 = errors.filter(e => e.code === "E-PA-004");
    expect(e004).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// E-PA-007 — protect= field not found in any table
// ---------------------------------------------------------------------------

describe("E-PA-007 — protect= field not matched", () => {
  let dir;
  let dbPath;

  beforeAll(() => {
    dir = makeTempDir();
    dbPath = createTestDb(dir, "auth.sqlite", [
      "CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL, passwordHash TEXT NOT NULL)",
    ]);
  });
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  test("emits E-PA-007 when a protect= field matches no column in any table", () => {
    const srcFile = join(dir, "auth.scrml");
    const ast = makeDbFileAST(srcFile, {
      src: "auth.sqlite",
      tables: "users",
      protect: "passwordhash",    // typo — real column is passwordHash
    });
    const { protectAnalysis, errors } = runPA({ files: [ast] });
    expect(errors.some(e => e.code === "E-PA-007")).toBe(true);
    expect(protectAnalysis.views.size).toBe(0); // block skipped
  });

  test("E-PA-007 message lists available columns", () => {
    const srcFile = join(dir, "auth2.scrml");
    const ast = makeDbFileAST(srcFile, {
      src: "auth.sqlite",
      tables: "users",
      protect: "typoField",
    });
    const { errors } = runPA({ files: [ast] });
    const e = errors.find(e => e.code === "E-PA-007");
    expect(e.message).toContain("typoField");
    // Message should list actual column names.
    expect(e.message).toContain("id");
    expect(e.message).toContain("email");
    expect(e.message).toContain("passwordHash");
  });

  test("multiple bad protect= fields each produce their own E-PA-007", () => {
    const srcFile = join(dir, "auth3.scrml");
    const ast = makeDbFileAST(srcFile, {
      src: "auth.sqlite",
      tables: "users",
      protect: "bad1, bad2",
    });
    const { errors } = runPA({ files: [ast] });
    const e007 = errors.filter(e => e.code === "E-PA-007");
    expect(e007).toHaveLength(2);
  });

  test("protect= field that matches in one of two tables is valid (no E-PA-007)", () => {
    // Schema with two tables; protect= names a field only in one table.
    const dir2 = makeTempDir();
    try {
      createTestDb(dir2, "multi.sqlite", [
        "CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, passwordHash TEXT)",
        "CREATE TABLE sessions (id INTEGER PRIMARY KEY, token TEXT)",
      ]);
      const srcFile = join(dir2, "app.scrml");
      const ast = makeDbFileAST(srcFile, {
        src: "multi.sqlite",
        tables: "users, sessions",
        protect: "passwordHash", // only in users, not in sessions
      });
      const { protectAnalysis, errors } = runPA({ files: [ast] });
      expect(errors.filter(e => e.code === "E-PA-007")).toHaveLength(0);
      expect(protectAnalysis.views.size).toBe(1);

      const view = singleView(protectAnalysis);
      const usersView = view.tables.get("users");
      const sessionsView = view.tables.get("sessions");

      expect(usersView.protectedFields.has("passwordHash")).toBe(true);
      expect(sessionsView.protectedFields.has("passwordHash")).toBe(false);
      // sessions clientSchema is unchanged (no column removed)
      expect(sessionsView.clientSchema).toHaveLength(sessionsView.fullSchema.length);
    } finally {
      rmSync(dir2, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Happy path — no protect=
// ---------------------------------------------------------------------------

describe("happy path — no protect= attribute", () => {
  let dir;
  let dbPath;

  beforeAll(() => {
    dir = makeTempDir();
    dbPath = createTestDb(dir, "shop.sqlite", [
      "CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT NOT NULL, price REAL)",
    ]);
  });
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  test("every < db> block gets a views entry even without protect=", () => {
    const srcFile = join(dir, "shop.scrml");
    const ast = makeDbFileAST(srcFile, {
      src: "shop.sqlite",
      tables: "products",
    });
    const { protectAnalysis, errors } = runPA({ files: [ast] });
    expect(errors).toHaveLength(0);
    expect(protectAnalysis.views.size).toBe(1);
  });

  test("fullSchema and clientSchema are identical when protect= is absent", () => {
    const srcFile = join(dir, "shop2.scrml");
    const ast = makeDbFileAST(srcFile, {
      src: "shop.sqlite",
      tables: "products",
    });
    const { protectAnalysis } = runPA({ files: [ast] });
    const view = singleView(protectAnalysis);
    const tv = view.tables.get("products");
    expect(tv.fullSchema).toHaveLength(tv.clientSchema.length);
    expect(tv.protectedFields.size).toBe(0);
  });

  test("fullSchema contains all columns with correct ColumnDef shape", () => {
    const srcFile = join(dir, "shop3.scrml");
    const ast = makeDbFileAST(srcFile, {
      src: "shop.sqlite",
      tables: "products",
    });
    const { protectAnalysis } = runPA({ files: [ast] });
    const tv = singleView(protectAnalysis).tables.get("products");

    expect(tv.fullSchema).toHaveLength(3); // id, name, price

    const idCol = tv.fullSchema.find(c => c.name === "id");
    expect(idCol).toBeDefined();
    expect(idCol.isPrimaryKey).toBe(true);
    expect(typeof idCol.sqlType).toBe("string");
    expect(typeof idCol.nullable).toBe("boolean");

    const nameCol = tv.fullSchema.find(c => c.name === "name");
    expect(nameCol.nullable).toBe(false); // NOT NULL
  });
});

// ---------------------------------------------------------------------------
// Happy path — with protect=
// ---------------------------------------------------------------------------

describe("happy path — with protect=", () => {
  let dir;

  beforeAll(() => {
    dir = makeTempDir();
    createTestDb(dir, "auth.sqlite", [
      "CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL, passwordHash TEXT NOT NULL, salt TEXT NOT NULL)",
    ]);
  });
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  test("protected fields are excluded from clientSchema", () => {
    const srcFile = join(dir, "auth.scrml");
    const ast = makeDbFileAST(srcFile, {
      src: "auth.sqlite",
      tables: "users",
      protect: "passwordHash, salt",
    });
    const { protectAnalysis, errors } = runPA({ files: [ast] });
    expect(errors).toHaveLength(0);

    const tv = singleView(protectAnalysis).tables.get("users");
    expect(tv.fullSchema).toHaveLength(4); // id, email, passwordHash, salt
    expect(tv.clientSchema).toHaveLength(2); // id, email

    expect(tv.clientSchema.some(c => c.name === "passwordHash")).toBe(false);
    expect(tv.clientSchema.some(c => c.name === "salt")).toBe(false);
    expect(tv.clientSchema.some(c => c.name === "id")).toBe(true);
    expect(tv.clientSchema.some(c => c.name === "email")).toBe(true);
  });

  test("protectedFields set contains the matched field names", () => {
    const srcFile = join(dir, "auth2.scrml");
    const ast = makeDbFileAST(srcFile, {
      src: "auth.sqlite",
      tables: "users",
      protect: "salt",
    });
    const { protectAnalysis } = runPA({ files: [ast] });
    const tv = singleView(protectAnalysis).tables.get("users");
    expect(tv.protectedFields.has("salt")).toBe(true);
    expect(tv.protectedFields.has("passwordHash")).toBe(false);
  });

  test("protect= with surrounding whitespace is trimmed correctly", () => {
    const srcFile = join(dir, "auth3.scrml");
    const ast = makeDbFileAST(srcFile, {
      src: "auth.sqlite",
      tables: "users",
      protect: "  passwordHash , salt  ",
    });
    const { protectAnalysis, errors } = runPA({ files: [ast] });
    expect(errors).toHaveLength(0);
    const tv = singleView(protectAnalysis).tables.get("users");
    expect(tv.protectedFields.has("passwordHash")).toBe(true);
    expect(tv.protectedFields.has("salt")).toBe(true);
  });

  test("protect= empty string produces empty protectedFields (no error)", () => {
    const srcFile = join(dir, "auth4.scrml");
    const ast = makeDbFileAST(srcFile, {
      src: "auth.sqlite",
      tables: "users",
      protect: "",
    });
    const { protectAnalysis, errors } = runPA({ files: [ast] });
    expect(errors).toHaveLength(0);
    const tv = singleView(protectAnalysis).tables.get("users");
    expect(tv.protectedFields.size).toBe(0);
    expect(tv.clientSchema).toHaveLength(tv.fullSchema.length);
  });
});

// ---------------------------------------------------------------------------
// StateBlockId construction
// ---------------------------------------------------------------------------

describe("StateBlockId construction", () => {
  let dir;

  beforeAll(() => {
    dir = makeTempDir();
    createTestDb(dir, "db.sqlite", [
      "CREATE TABLE t (id INTEGER PRIMARY KEY)",
    ]);
  });
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  test("StateBlockId is {filePath}::{span.start}", () => {
    const srcFile = join(dir, "app.scrml");
    const ast = makeDbFileAST(srcFile, { src: "db.sqlite", tables: "t" }, 77);
    const { protectAnalysis } = runPA({ files: [ast] });
    const id = [...protectAnalysis.views.keys()][0];
    expect(id).toBe(`${srcFile}::77`);
  });

  test("dbPath in DBTypeViews is the resolved canonical absolute path", () => {
    const srcFile = join(dir, "app2.scrml");
    const ast = makeDbFileAST(srcFile, { src: "db.sqlite", tables: "t" });
    const { protectAnalysis } = runPA({ files: [ast] });
    const view = singleView(protectAnalysis);
    expect(view.dbPath).toBe(join(dir, "db.sqlite"));
  });

  test("stateBlockId field on DBTypeViews matches the map key", () => {
    const srcFile = join(dir, "app3.scrml");
    const ast = makeDbFileAST(srcFile, { src: "db.sqlite", tables: "t" }, 5);
    const { protectAnalysis } = runPA({ files: [ast] });
    const [id, view] = [...protectAnalysis.views.entries()][0];
    expect(view.stateBlockId).toBe(id);
  });
});

// ---------------------------------------------------------------------------
// Multi-block and multi-file semantics
// ---------------------------------------------------------------------------

describe("multi-block and multi-file semantics", () => {
  let dir;

  beforeAll(() => {
    dir = makeTempDir();
    createTestDb(dir, "a.sqlite", [
      "CREATE TABLE alpha (id INTEGER PRIMARY KEY, secret TEXT)",
    ]);
    createTestDb(dir, "b.sqlite", [
      "CREATE TABLE beta (id INTEGER PRIMARY KEY, token TEXT)",
    ]);
  });
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  test("two blocks referencing different databases produce two independent entries", () => {
    const fileA = join(dir, "a.scrml");
    const fileB = join(dir, "b.scrml");

    const astA = makeDbFileAST(fileA, { src: "a.sqlite", tables: "alpha", protect: "secret" }, 0);
    const astB = makeDbFileAST(fileB, { src: "b.sqlite", tables: "beta" }, 0);

    const { protectAnalysis, errors } = runPA({ files: [astA, astB] });
    expect(errors).toHaveLength(0);
    expect(protectAnalysis.views.size).toBe(2);

    // Verify independence: fileA view has protection applied; fileB does not.
    const viewA = protectAnalysis.views.get(`${fileA}::0`);
    const viewB = protectAnalysis.views.get(`${fileB}::0`);

    expect(viewA).toBeDefined();
    expect(viewB).toBeDefined();

    expect(viewA.tables.get("alpha").protectedFields.has("secret")).toBe(true);
    expect(viewB.tables.get("beta").protectedFields.size).toBe(0);
  });

  test("two blocks sharing the same dbPath produce independent entries (no merging)", () => {
    // Two < db> blocks in two different source files that both reference a.sqlite
    // with different protect= lists. Per PIPELINE.md §PA invariant: no merging.
    const fileC = join(dir, "c.scrml");
    const fileD = join(dir, "d.scrml");

    const astC = makeDbFileAST(fileC, { src: "a.sqlite", tables: "alpha", protect: "secret" }, 0);
    const astD = makeDbFileAST(fileD, { src: "a.sqlite", tables: "alpha" }, 0);

    const { protectAnalysis, errors } = runPA({ files: [astC, astD] });
    expect(errors).toHaveLength(0);
    expect(protectAnalysis.views.size).toBe(2);

    const viewC = protectAnalysis.views.get(`${fileC}::0`);
    const viewD = protectAnalysis.views.get(`${fileD}::0`);

    expect(viewC.tables.get("alpha").protectedFields.has("secret")).toBe(true);
    expect(viewD.tables.get("alpha").protectedFields.size).toBe(0);
  });

  test("two blocks in the same file at different span offsets produce separate entries", () => {
    const fileE = join(dir, "e.scrml");

    const block1Span = { file: fileE, start: 0,   end: 80,  line: 1, col: 1 };
    const block2Span = { file: fileE, start: 200, end: 280, line: 10, col: 1 };

    const ast = {
      filePath: fileE,
      nodes: [
        {
          id: 1, kind: "state", stateType: "db",
          attrs: [
            { name: "src",    value: { kind: "string-literal", value: "a.sqlite" }, span: block1Span },
            { name: "tables", value: { kind: "string-literal", value: "alpha" },    span: block1Span },
          ],
          children: [], span: block1Span,
        },
        {
          id: 2, kind: "state", stateType: "db",
          attrs: [
            { name: "src",    value: { kind: "string-literal", value: "a.sqlite" }, span: block2Span },
            { name: "tables", value: { kind: "string-literal", value: "alpha" },    span: block2Span },
          ],
          children: [], span: block2Span,
        },
      ],
    };

    const { protectAnalysis, errors } = runPA({ files: [ast] });
    expect(errors).toHaveLength(0);
    expect(protectAnalysis.views.size).toBe(2);
    expect(protectAnalysis.views.has(`${fileE}::0`)).toBe(true);
    expect(protectAnalysis.views.has(`${fileE}::200`)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// No AST mutation
// ---------------------------------------------------------------------------

describe("no AST mutation", () => {
  let dir;

  beforeAll(() => {
    dir = makeTempDir();
    createTestDb(dir, "db.sqlite", [
      "CREATE TABLE items (id INTEGER PRIMARY KEY, label TEXT)",
    ]);
  });
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  test("PA does not mutate the input FileAST", () => {
    const srcFile = join(dir, "app.scrml");
    const ast = makeDbFileAST(srcFile, {
      src: "db.sqlite",
      tables: "items",
    });

    // Capture a deep snapshot before running PA.
    const snapshot = JSON.stringify(ast);

    runPA({ files: [ast] });

    expect(JSON.stringify(ast)).toBe(snapshot);
  });
});

// ---------------------------------------------------------------------------
// cross-table protect= field matching (§11.3 worked example)
// ---------------------------------------------------------------------------

describe("cross-table protect= field matching", () => {
  let dir;

  beforeAll(() => {
    dir = makeTempDir();
    createTestDb(dir, "shop.sqlite", [
      "CREATE TABLE users  (id INTEGER PRIMARY KEY, email TEXT, passwordHash TEXT)",
      "CREATE TABLE orders (id INTEGER PRIMARY KEY, total REAL, userId INTEGER)",
    ]);
  });
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  test("protect= id removes id from both tables that have it", () => {
    const srcFile = join(dir, "app.scrml");
    const ast = makeDbFileAST(srcFile, {
      src: "shop.sqlite",
      tables: "users, orders",
      protect: "id",
    });
    const { protectAnalysis, errors } = runPA({ files: [ast] });
    expect(errors).toHaveLength(0);

    const usersView  = singleView(protectAnalysis).tables.get("users");
    const ordersView = singleView(protectAnalysis).tables.get("orders");

    expect(usersView.protectedFields.has("id")).toBe(true);
    expect(ordersView.protectedFields.has("id")).toBe(true);
    expect(usersView.clientSchema.some(c => c.name === "id")).toBe(false);
    expect(ordersView.clientSchema.some(c => c.name === "id")).toBe(false);
  });

  test("protect= passwordHash only affects the table that has it", () => {
    const srcFile = join(dir, "app2.scrml");
    const ast = makeDbFileAST(srcFile, {
      src: "shop.sqlite",
      tables: "users, orders",
      protect: "passwordHash", // only in users, not in orders
    });
    const { protectAnalysis, errors } = runPA({ files: [ast] });
    expect(errors).toHaveLength(0);

    const view = singleView(protectAnalysis);
    const usersView  = view.tables.get("users");
    const ordersView = view.tables.get("orders");

    expect(usersView.protectedFields.has("passwordHash")).toBe(true);
    expect(ordersView.protectedFields.has("passwordHash")).toBe(false);
    // orders clientSchema is unchanged
    expect(ordersView.clientSchema).toHaveLength(ordersView.fullSchema.length);
  });
});

// ---------------------------------------------------------------------------
// Empty input / non-db state blocks are ignored
// ---------------------------------------------------------------------------

describe("non-db state blocks and empty input", () => {
  test("files array with no < db> blocks produces empty views", () => {
    const { protectAnalysis, errors } = runPA({ files: [] });
    expect(errors).toHaveLength(0);
    expect(protectAnalysis.views.size).toBe(0);
  });

  test("state blocks with stateType !== 'db' are ignored", () => {
    const srcFile = "/fake/app.scrml";
    const ast = {
      filePath: srcFile,
      nodes: [
        {
          id: 1, kind: "state", stateType: "session",
          attrs: [],
          children: [],
          span: { file: srcFile, start: 0, end: 50, line: 1, col: 1 },
        },
      ],
    };
    const { protectAnalysis, errors } = runPA({ files: [ast] });
    expect(errors).toHaveLength(0);
    expect(protectAnalysis.views.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Shadow DB — file missing but CREATE TABLE in ?{} blocks
// ---------------------------------------------------------------------------

/**
 * Build a minimal AST sql node representing a ?{} block.
 *
 * @param {string} filePath  - source file path
 * @param {string} query     - raw SQL text (may contain CREATE TABLE)
 * @param {number} spanStart - span start offset (default 2000)
 */
function makeSqlNode(filePath, query, spanStart = 2000) {
  const span = { file: filePath, start: spanStart, end: spanStart + query.length + 4, line: 3, col: 1 };
  return { id: 999, kind: "sql", query, chainedCalls: [], span };
}

describe("shadow DB — file missing but CREATE TABLE in ?{} blocks", () => {
  let dir;

  beforeAll(() => { dir = makeTempDir(); });
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  test("succeeds with shadow DB when CREATE TABLE is present in a ?{} block", () => {
    const srcFile = join(dir, "shadow-happy.scrml");
    const sqlNode = makeSqlNode(
      srcFile,
      "CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT)",
    );
    const ast = makeDbFileAST(srcFile, {
      src: "nonexistent.db",
      tables: "users",
    }, 0, [sqlNode]);

    const { protectAnalysis, errors } = runPA({ files: [ast] });

    // No E-PA-001 or E-PA-002 — shadow DB was used.
    expect(errors.some(e => e.code === "E-PA-001")).toBe(false);
    expect(errors.some(e => e.code === "E-PA-002")).toBe(false);
    expect(errors).toHaveLength(0);
    expect(protectAnalysis.views.size).toBe(1);
  });

  test("shadow DB schema has correct column definitions", () => {
    const srcFile = join(dir, "shadow-cols.scrml");
    const sqlNode = makeSqlNode(
      srcFile,
      "CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL, passwordHash TEXT NOT NULL)",
    );
    const ast = makeDbFileAST(srcFile, {
      src: "missing.db",
      tables: "users",
    }, 0, [sqlNode]);

    const { protectAnalysis, errors } = runPA({ files: [ast] });
    expect(errors).toHaveLength(0);
    expect(protectAnalysis.views.size).toBe(1);

    const view = protectAnalysis.views.values().next().value;
    const usersTable = view.tables.get("users");
    expect(usersTable).toBeDefined();
    const colNames = usersTable.fullSchema.map(c => c.name);
    expect(colNames).toContain("id");
    expect(colNames).toContain("email");
    expect(colNames).toContain("passwordHash");
  });

  test("emits E-PA-002 when one of the tables= names has no CREATE TABLE", () => {
    const srcFile = join(dir, "shadow-partial.scrml");
    // CREATE TABLE for users but NOT for orders
    const sqlNode = makeSqlNode(
      srcFile,
      "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)",
    );
    const ast = makeDbFileAST(srcFile, {
      src: "missing.db",
      tables: "users, orders",
    }, 0, [sqlNode]);

    const { protectAnalysis, errors } = runPA({ files: [ast] });
    expect(errors.some(e => e.code === "E-PA-002")).toBe(true);
    const e = errors.find(e => e.code === "E-PA-002");
    expect(e.message).toContain("orders");
    expect(protectAnalysis.views.size).toBe(0);
  });

  test("shadow DB succeeds with multiple tables when all have CREATE TABLE", () => {
    const srcFile = join(dir, "shadow-multi.scrml");
    const usersNode = makeSqlNode(
      srcFile,
      "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)",
    );
    const ordersNode = makeSqlNode(
      srcFile,
      "CREATE TABLE orders (id INTEGER PRIMARY KEY, total REAL, userId INTEGER)",
      3000,
    );
    const ast = makeDbFileAST(srcFile, {
      src: "missing.db",
      tables: "users, orders",
    }, 0, [usersNode, ordersNode]);

    const { protectAnalysis, errors } = runPA({ files: [ast] });
    expect(errors).toHaveLength(0);
    expect(protectAnalysis.views.size).toBe(1);
    const view = protectAnalysis.views.values().next().value;
    expect(view.tables.has("users")).toBe(true);
    expect(view.tables.has("orders")).toBe(true);
  });

  test("protect= validation works correctly with shadow DB", () => {
    const srcFile = join(dir, "shadow-protect.scrml");
    const sqlNode = makeSqlNode(
      srcFile,
      "CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, passwordHash TEXT)",
    );
    const ast = makeDbFileAST(srcFile, {
      src: "missing.db",
      tables: "users",
      protect: "passwordHash",
    }, 0, [sqlNode]);

    const { protectAnalysis, errors } = runPA({ files: [ast] });
    expect(errors).toHaveLength(0);
    expect(protectAnalysis.views.size).toBe(1);
    const view = protectAnalysis.views.values().next().value;
    const usersTable = view.tables.get("users");
    expect(usersTable.protectedFields.has("passwordHash")).toBe(true);
    expect(usersTable.clientSchema.map(c => c.name)).not.toContain("passwordHash");
    expect(usersTable.clientSchema.map(c => c.name)).toContain("email");
  });
});

// ---------------------------------------------------------------------------
// R28-4 — CREATE TABLE in a ?{} block NESTED below the top level
// ---------------------------------------------------------------------------
//
// Regression: `extractCreateTableStatements` previously recursed ONLY into
// `node.children`, so a `?{ CREATE TABLE … }` sitting under a `body` field —
// a top-level `${ … }` logic block's `body`, or a `function`/`fn` decl's `body`
// — was invisible to the shadow-DB scanner. E-PA-002 then fired spuriously
// while its own message told the adopter to "add a CREATE TABLE statement in a
// `?{}` block" (which they HAD done). The scanner now walks every child-bearing
// field. (R28-4, S147 — gauntlet R28; PA-confirmed reproduces; fixed PA-direct.)

describe("R28-4 — shadow DB finds CREATE TABLE nested below top level", () => {
  let dir;
  beforeAll(() => { dir = makeTempDir(); });
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  test("CREATE TABLE inside a top-level `${...}` logic block body is found (no E-PA-002)", () => {
    const srcFile = join(dir, "nested-logic.scrml");
    const sqlNode = makeSqlNode(
      srcFile,
      "CREATE TABLE widgets (id INTEGER PRIMARY KEY, secret TEXT NOT NULL)",
    );
    // The ?{} sql node lives under a `logic` node's `body`, NOT directly in
    // the file `nodes[]` and NOT under `children` — the exact shape the old
    // children-only walker missed.
    const logicNode = {
      id: 500, kind: "logic", body: [sqlNode],
      span: { file: srcFile, start: 1000, end: 1100, line: 2, col: 1 },
    };
    const ast = makeDbFileAST(srcFile, {
      src: "nonexistent-r284a.db",
      tables: "widgets",
      protect: "secret",
    }, 0, [logicNode]);

    const { protectAnalysis, errors } = runPA({ files: [ast] });
    expect(errors.some(e => e.code === "E-PA-002")).toBe(false);
    expect(errors).toHaveLength(0);
    expect(protectAnalysis.views.size).toBe(1);
  });

  test("CREATE TABLE inside a function-decl body (nested in a logic block) is found (no E-PA-002)", () => {
    const srcFile = join(dir, "nested-fn.scrml");
    const sqlNode = makeSqlNode(
      srcFile,
      "CREATE TABLE widgets (id INTEGER PRIMARY KEY, secret TEXT NOT NULL)",
    );
    const fnNode = {
      id: 501, kind: "function-decl", name: "setup", body: [sqlNode],
      span: { file: srcFile, start: 1000, end: 1200, line: 2, col: 1 },
    };
    const logicNode = {
      id: 502, kind: "logic", body: [fnNode],
      span: { file: srcFile, start: 990, end: 1210, line: 2, col: 1 },
    };
    const ast = makeDbFileAST(srcFile, {
      src: "nonexistent-r284b.db",
      tables: "widgets",
      protect: "secret",
    }, 0, [logicNode]);

    const { protectAnalysis, errors } = runPA({ files: [ast] });
    expect(errors.some(e => e.code === "E-PA-002")).toBe(false);
    expect(errors).toHaveLength(0);
    expect(protectAnalysis.views.size).toBe(1);
  });

  test("GUARD: genuinely-missing CREATE TABLE still fires E-PA-002 (no over-credit)", () => {
    const srcFile = join(dir, "nested-guard.scrml");
    // A logic block whose body has NO CREATE TABLE for `widgets`.
    const logicNode = {
      id: 503, kind: "logic", body: [makeSqlNode(srcFile, "SELECT 1")],
      span: { file: srcFile, start: 1000, end: 1100, line: 2, col: 1 },
    };
    const ast = makeDbFileAST(srcFile, {
      src: "nonexistent-r284c.db",
      tables: "widgets",
      protect: "secret",
    }, 0, [logicNode]);

    const { protectAnalysis, errors } = runPA({ files: [ast] });
    expect(errors.some(e => e.code === "E-PA-002")).toBe(true);
    expect(protectAnalysis.views.size).toBe(0);
  });
});
