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
 *   §2  a zero-byte database is called out explicitly (front-loaded, so the
 *       120-character `dev`/`build` terminal slice still shows it); a non-empty
 *       database is not.
 *   §3  reading a schema never creates a database file: an absent `src=` stays
 *       absent on both the shadow path and the E-PA-002 path, and an existing
 *       file is opened read-only (bytes unchanged).
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { runPA } from "../../src/protect-analyzer.js";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync, realpathSync } from "node:fs";
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

describe("§2 a zero-byte database is called out", () => {
  test("zero-byte file → the message says ZERO-BYTE before the path, and explains the stub", () => {
    writeFileSync(join(srcDir, "app.db"), "");
    const file = join(srcDir, "app.scrml");
    const { errors } = runPA({ files: [makeDbFileAST(file, { src: "./app.db", tables: "items" })] });

    const e = errors.find((x) => x.code === "E-PA-004");
    expect(e).toBeDefined();
    const idxZero = e.message.indexOf("ZERO-BYTE database");
    const idxPath = e.message.indexOf(join(srcDir, "app.db"));
    expect(idxZero).toBeGreaterThan(-1);
    expect(idxPath).toBeGreaterThan(idxZero);
    expect(e.message).toContain("ZERO BYTES");
    // `dev` / `build` print the first 120 characters of the message after the
    // code prefix — the zero-byte fact must survive that slice.
    expect(e.message.replace(/^E-PA-004: /, "").slice(0, 120)).toContain("ZERO-BYTE");
  });

  test("a non-empty database does not claim to be zero bytes", () => {
    createDb(join(srcDir, "app.db"), ["CREATE TABLE other (id INTEGER PRIMARY KEY)"]);
    const file = join(srcDir, "app.scrml");
    const { errors } = runPA({ files: [makeDbFileAST(file, { src: "./app.db", tables: "items" })] });
    const e = errors.find((x) => x.code === "E-PA-004");
    expect(e.message).not.toContain("ZERO-BYTE");
    expect(e.message).not.toContain("ZERO BYTES");
  });
});

describe("§3 reading a schema never creates a database file", () => {
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

  test("an existing database is opened read-only: its bytes are unchanged", () => {
    const real = join(root, "app.db");
    const before = readFileSync(real);
    const file = join(srcDir, "app.scrml");
    const { errors } = runPA({ files: [makeDbFileAST(file, { src: "../app.db", tables: "items" })] });
    expect(errors).toHaveLength(0);
    expect(Buffer.compare(readFileSync(real), before)).toBe(0);
    // Read-only open leaves no journal / WAL side files either.
    expect(existsSync(`${real}-wal`)).toBe(false);
    expect(existsSync(`${real}-journal`)).toBe(false);
  });

  test("a zero-byte stub is read, not grown: it stays zero bytes after the failed read", () => {
    const stub = join(srcDir, "app.db");
    writeFileSync(stub, "");
    const file = join(srcDir, "app.scrml");
    runPA({ files: [makeDbFileAST(file, { src: "./app.db", tables: "items" })] });
    expect(readFileSync(stub).length).toBe(0);
  });
});
