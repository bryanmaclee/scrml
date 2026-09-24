/**
 * protect-analyzer — which database did the schema read come from?
 * (s430-dev-db-stub, adopter-reported)
 *
 * The report: `scrml dev` left ZERO-BYTE `.db` stubs beside the compiled
 * sources, and every later `compile` failed with
 *   E-PA-004: Table `delta_log` was not found in the database.
 * — a message that named neither the file it had opened nor that the file was
 * empty, so the adopter could not see that a relative `src=` had resolved to a
 * stub instead of the real store one directory up.
 *
 * Pinned here:
 *   §1  E-PA-004 names the RESOLVED ABSOLUTE PATH, the `src=` it came from, and
 *       the directory it was resolved against.
 *   §2  an EMPTY database (no tables — the 0/1-byte stub, or a real but
 *       tableless file) is called out explicitly and front-loaded, so the
 *       120-character `dev`/`build` terminal slice still shows it; a database
 *       with tables is not. (F5)
 *   §3  reading a schema never creates or changes anything on disk: an absent
 *       `src=` stays absent; an existing file — rollback-journal OR WAL mode —
 *       keeps its bytes and gains no `-wal`/`-shm`/`-journal` side files; the
 *       read handle refuses writes; and a LIVE writer's un-checkpointed schema
 *       is still seen. (F1, F3)
 *   §4  the shadow schema is per block: two `<db>` blocks on one `src=` with
 *       different `tables=` each see their own tables. (F2)
 *   §5  the driver-URI description never carries the URI. (F3)
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { runPA, openSchemaReadHandle, describeDbSource } from "../../src/protect-analyzer.js";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync, realpathSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function makeDbFileAST(filePath, attrMap, extraNodes = []) {
  const span = { file: filePath, start: 0, end: 100, line: 1, col: 1 };
  const attrs = Object.entries(attrMap).map(([name, value]) => ({
    name,
    value: { kind: "string-literal", value },
    span,
  }));
  return {
    filePath,
    nodes: [...extraNodes, { id: 1, kind: "state", stateType: "db", attrs, children: [], span }],
  };
}

function makeSqlNode(filePath, query) {
  const span = { file: filePath, start: 2000, end: 2000 + query.length + 4, line: 3, col: 1 };
  return { id: 999, kind: "sql", query, chainedCalls: [], span };
}

function createDb(path, statements) {
  const db = new Database(path);
  for (const s of statements) db.run(s);
  db.close();
}

function sideFiles(p) {
  return ["-wal", "-shm", "-journal"].filter((suf) => existsSync(p + suf));
}

let root;
let srcDir;

beforeEach(() => {
  // The adopter's layout: the real store at the project root, the sources one
  // level down in src/.
  root = realpathSync(mkdtempSync(join(tmpdir(), "scrml-pa-dbsrc-")));
  srcDir = join(root, "src");
  mkdirSync(srcDir);
  createDb(join(root, "app.db"), ["CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)"]);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("§1 E-PA-004 names the database it read", () => {
  test("the message carries the resolved absolute path, the src= and the base directory", () => {
    // A non-empty database beside the source that lacks the table.
    createDb(join(srcDir, "app.db"), ["CREATE TABLE other (id INTEGER PRIMARY KEY)"]);
    const file = join(srcDir, "app.scrml");
    const { errors } = runPA({ files: [makeDbFileAST(file, { src: "./app.db", tables: "items" })] });

    const e = errors.find((x) => x.code === "E-PA-004");
    expect(e).toBeDefined();
    expect(e.message).toContain("`items`");
    expect(e.message).toContain(`\`${join(srcDir, "app.db")}\``);
    expect(e.message).toContain('`src="./app.db"`');
    expect(e.message).toContain(`\`${srcDir}\``);
  });

  test("the path is resolved against the SOURCE file's directory, not the process CWD", () => {
    createDb(join(srcDir, "app.db"), ["CREATE TABLE other (id INTEGER PRIMARY KEY)"]);
    const file = join(srcDir, "app.scrml");
    const { errors } = runPA({ files: [makeDbFileAST(file, { src: "app.db", tables: "items" })] });
    const e = errors.find((x) => x.code === "E-PA-004");
    // Current behaviour, stated in the diagnostic so the adopter can see it.
    // Whether this is the RIGHT base is an open ruling (no SPEC sentence) —
    // this test pins only that the message tells the truth about what was read.
    expect(e.message).not.toContain(`\`${join(root, "app.db")}\``);
    expect(e.message).toContain(join(srcDir, "app.db"));
  });
});

describe("§2 an empty database is called out (F5)", () => {
  const e004 = (src) => {
    const file = join(srcDir, "app.scrml");
    const { errors } = runPA({ files: [makeDbFileAST(file, { src, tables: "items" })] });
    return errors.find((x) => x.code === "E-PA-004");
  };

  test("zero-byte file: EMPTY (ZERO-BYTE) before the path, the stub explained", () => {
    writeFileSync(join(srcDir, "app.db"), "");
    const e = e004("./app.db");
    expect(e).toBeDefined();
    const idxEmpty = e.message.indexOf("EMPTY (ZERO-BYTE) database");
    const idxPath = e.message.indexOf(join(srcDir, "app.db"));
    expect(idxEmpty).toBeGreaterThan(-1);
    expect(idxPath).toBeGreaterThan(idxEmpty);
    expect(e.message).toContain("no tables at all (the file is zero bytes)");
    // `dev` / `build` print the first 120 characters after the code prefix.
    expect(e.message.replace(/^E-PA-004: /, "").slice(0, 120)).toContain("EMPTY");
  });

  test("1-byte file (SQLite also opens it as an empty db): EMPTY, and the size is stated", () => {
    writeFileSync(join(srcDir, "app.db"), "x");
    const e = e004("./app.db");
    expect(e).toBeDefined();
    expect(e.message).toContain("the EMPTY database");
    expect(e.message).not.toContain("ZERO-BYTE");
    expect(e.message).toContain("(the file is 1 byte)");
  });

  test("a real but tableless database (4096-byte WAL header): EMPTY — size is not the predicate", () => {
    const p = join(srcDir, "app.db");
    const d = new Database(p);
    d.run("PRAGMA journal_mode=WAL");
    d.close();
    const e = e004("./app.db");
    expect(e).toBeDefined();
    expect(e.message).toContain("the EMPTY database");
    expect(e.message).toMatch(/\(the file is \d+ bytes\)/);
  });

  test("a database WITH tables (just not this one) does not claim to be empty", () => {
    createDb(join(srcDir, "app.db"), ["CREATE TABLE other (id INTEGER PRIMARY KEY)"]);
    const e = e004("./app.db");
    expect(e.message).not.toContain("EMPTY");
    expect(e.message).not.toContain("ZERO-BYTE");
  });

  test("a 2+-byte non-database file is E-PA-003 (SQLite refuses it), never an E-PA-004 empty callout", () => {
    writeFileSync(join(srcDir, "app.db"), Buffer.alloc(300, 0));
    const file = join(srcDir, "app.scrml");
    const { errors } = runPA({ files: [makeDbFileAST(file, { src: "./app.db", tables: "items" })] });
    expect(errors.some((x) => x.code === "E-PA-004")).toBe(false);
    expect(errors.some((x) => x.code === "E-PA-003")).toBe(true);
  });
});

describe("§3 reading a schema never creates or changes anything on disk (F1, F3)", () => {
  test("absent src= + CREATE TABLE in ?{} (shadow path): the file is not created", () => {
    const file = join(srcDir, "app.scrml");
    const sql = makeSqlNode(file, "CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY, name TEXT)");
    const { errors } = runPA({ files: [makeDbFileAST(file, { src: "./app.db", tables: "items" }, [sql])] });
    expect(errors).toHaveLength(0);
    expect(existsSync(join(srcDir, "app.db"))).toBe(false);
  });

  test("absent src= with no CREATE TABLE (E-PA-002 path): the file is not created", () => {
    const file = join(srcDir, "app.scrml");
    const { errors } = runPA({ files: [makeDbFileAST(file, { src: "./app.db", tables: "items" })] });
    expect(errors.some((x) => x.code === "E-PA-002")).toBe(true);
    expect(existsSync(join(srcDir, "app.db"))).toBe(false);
  });

  test("rollback-journal database: bytes unchanged, no side files", () => {
    const real = join(root, "app.db");
    const before = readFileSync(real);
    const file = join(srcDir, "app.scrml");
    const { errors } = runPA({ files: [makeDbFileAST(file, { src: "../app.db", tables: "items" })] });
    expect(errors).toHaveLength(0);
    expect(Buffer.compare(readFileSync(real), before)).toBe(0);
    expect(sideFiles(real)).toEqual([]);
  });

  test("WAL-mode database with no writer: schema read, bytes unchanged, NO -wal/-shm left behind (F1)", () => {
    const p = join(srcDir, "wal.db");
    const d = new Database(p);
    d.run("PRAGMA journal_mode=WAL");
    d.run("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)");
    d.close();
    expect(sideFiles(p)).toEqual([]); // the writer's clean close removed them
    const before = readFileSync(p);
    const file = join(srcDir, "app.scrml");
    const { protectAnalysis, errors } = runPA({ files: [makeDbFileAST(file, { src: "./wal.db", tables: "items" })] });
    expect(errors).toHaveLength(0);
    expect(protectAnalysis.views.size).toBe(1);
    expect(sideFiles(p)).toEqual([]);
    expect(Buffer.compare(readFileSync(p), before)).toBe(0);
    expect(readdirSync(srcDir).sort()).toEqual(["wal.db"]);
  });

  test("WAL-mode database with a LIVE writer: un-checkpointed schema is still seen", () => {
    const p = join(srcDir, "live.db");
    const live = new Database(p);
    live.run("PRAGMA journal_mode=WAL");
    live.run("PRAGMA wal_autocheckpoint=0");
    live.run("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)");
    try {
      expect(existsSync(`${p}-wal`)).toBe(true);
      const file = join(srcDir, "app.scrml");
      const { errors } = runPA({ files: [makeDbFileAST(file, { src: "./live.db", tables: "items" })] });
      expect(errors).toHaveLength(0);
    } finally {
      live.close();
    }
  });

  test("the schema-read handle refuses writes — no-WAL path", () => {
    const real = join(root, "app.db");
    const before = readFileSync(real);
    const h = openSchemaReadHandle(real);
    try {
      expect(() => h.run("CREATE TABLE intruder (x)")).toThrow();
    } finally {
      h.close();
    }
    expect(Buffer.compare(readFileSync(real), before)).toBe(0);
    expect(sideFiles(real)).toEqual([]);
  });

  test("the schema-read handle refuses writes — live-WAL path", () => {
    const p = join(srcDir, "live2.db");
    const live = new Database(p);
    live.run("PRAGMA journal_mode=WAL");
    live.run("PRAGMA wal_autocheckpoint=0");
    live.run("CREATE TABLE items (id INTEGER PRIMARY KEY)");
    try {
      const h = openSchemaReadHandle(p);
      try {
        expect(() => h.run("CREATE TABLE intruder (x)")).toThrow();
      } finally {
        h.close();
      }
      const n = live.query("SELECT count(*) AS n FROM sqlite_master WHERE name = 'intruder'").get().n;
      expect(n).toBe(0);
    } finally {
      live.close();
    }
  });

  test("a zero-byte stub is read, not grown: it stays zero bytes after the failed read", () => {
    const stub = join(srcDir, "app.db");
    writeFileSync(stub, "");
    const file = join(srcDir, "app.scrml");
    runPA({ files: [makeDbFileAST(file, { src: "./app.db", tables: "items" })] });
    expect(readFileSync(stub).length).toBe(0);
    expect(sideFiles(stub)).toEqual([]);
  });
});

describe("§4 the shadow schema is per block, not per path (F2)", () => {
  function twoBlockFile(file, tablesA, tablesB, sqlNodes) {
    const mk = (id, start, tables) => {
      const span = { file, start, end: start + 100, line: 1, col: 1 };
      return {
        id, kind: "state", stateType: "db", children: [], span,
        attrs: [
          { name: "src", value: { kind: "string-literal", value: "./absent.db" }, span },
          { name: "tables", value: { kind: "string-literal", value: tables }, span },
        ],
      };
    };
    return { filePath: file, nodes: [...sqlNodes, mk(1, 0, tablesA), mk(2, 500, tablesB)] };
  }

  test("same file, same src=, different tables=: both blocks resolve, no false E-PA-004", () => {
    const file = join(srcDir, "two.scrml");
    const sqls = [
      makeSqlNode(file, "CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, email TEXT)"),
      makeSqlNode(file, "CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY, total INTEGER)"),
    ];
    const { protectAnalysis, errors } = runPA({ files: [twoBlockFile(file, "users", "orders", sqls)] });
    expect(errors.filter((x) => x.code === "E-PA-004")).toEqual([]);
    expect(errors).toHaveLength(0);
    expect(protectAnalysis.views.size).toBe(2);
  });

  test("two files, same src=, each with its own DDL: the second is not served the first's schema", () => {
    const f1 = join(srcDir, "a.scrml");
    const f2 = join(srcDir, "b.scrml");
    const a = makeDbFileAST(f1, { src: "./absent.db", tables: "users" },
      [makeSqlNode(f1, "CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY)")]);
    const b = makeDbFileAST(f2, { src: "./absent.db", tables: "orders" },
      [makeSqlNode(f2, "CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY)")]);
    const { protectAnalysis, errors } = runPA({ files: [a, b] });
    expect(errors).toHaveLength(0);
    expect(protectAnalysis.views.size).toBe(2);
  });
});

describe("§5 describeDbSource never carries a driver URI (F3)", () => {
  test("driver branch: neither the URI nor its password appears in where/detail", () => {
    const uri = "postgres://admin:S3cretPW@db.example:5432/app";
    const d = describeDbSource(uri, uri, "/some/dir", true);
    const text = d.where + " " + d.detail;
    expect(text).not.toContain("S3cretPW");
    expect(text).not.toContain("db.example");
    expect(text).toContain("in-memory schema");
  });

  test("absent-file branch names the path and says it was not read", () => {
    const d = describeDbSource("/nope/x.db", "./x.db", "/nope", false);
    expect(d.where).toContain("in-memory schema");
    expect(d.detail).toContain("`/nope/x.db` does not exist");
  });
});
