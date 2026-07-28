/**
 * e-pa-002-db-migrate-remedy.test.js — F-2: `E-PA-002` must steer the adopter at
 * `scrml db-migrate`, not at hand-rebuilding the schema.
 *
 * The adopter finding (examples/23-trucking-dispatch/FRICTION.md): when the `<db
 * src=>` file did not exist, `E-PA-002`'s remedy list offered only "create the
 * database file first" / "add a CREATE TABLE statement in a `?{}` block". Neither
 * names the tool that already knows how to materialize the DB from `<schema>`, so
 * the adopter's next move was to bootstrap the database BY HAND with raw
 * `CREATE TABLE` SQL against `bun:sqlite` — rebuilding by hand the exact artifact
 * the compiler generates.
 *
 * This is a MESSAGE-STRING contract only. The fire condition is deliberately NOT
 * changed here (whether a build-time DB-existence check should hard-fail at all is
 * a separate open ruling), so the second describe block pins the fire condition
 * against the pre-existing behaviour.
 */

import { describe, test, expect } from "bun:test";
import { runPA } from "../../src/protect-analyzer.ts";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "path";

function paFor(scrmlSource, filePath) {
  const fp = resolve(filePath);
  const bs = splitBlocks(fp, scrmlSource);
  const ast = buildAST(bs).ast;
  return runPA({ files: [{ filePath: fp, nodes: ast.nodes }] });
}

function epa002(scrmlSource, filePath) {
  return paFor(scrmlSource, filePath).errors.find((e) => e.code === "E-PA-002");
}

// A scratch dir OUTSIDE the repo for the synthetic source paths. The files are
// never written — PA only resolves `src=` against `dirname(filePath)` — but the
// dir must be stable so the expected `--db` target in the message is predictable.
const FAKE_DIR = join(tmpdir(), "_f2remedy");

// A `<db>` pointing at a file that does not exist, with no `<schema>` and no
// `?{}` CREATE TABLE — the canonical E-PA-002 shape.
const MISSING_DB_SRC = `<db src="./nope-f2.db" tables="drivers">
  \${
    function _noop() { }
  }
</>`;

describe("F-2 — E-PA-002 names `scrml db-migrate` as the first remedy", () => {
  test("the message names the `scrml db-migrate` command", () => {
    const e = epa002(MISSING_DB_SRC, join(FAKE_DIR, "app.scrml"));
    expect(e).toBeDefined();
    expect(e.message).toContain("scrml db-migrate");
  });

  test("the suggested command carries the resolved --db target, so it is copy-pasteable", () => {
    const e = epa002(MISSING_DB_SRC, join(FAKE_DIR, "app.scrml"));
    expect(e.message).toContain(`scrml db-migrate . --db ${join(FAKE_DIR, "nope-f2.db")}`);
  });

  test("the message points at `<schema>` as the DDL source", () => {
    const e = epa002(MISSING_DB_SRC, join(FAKE_DIR, "app.scrml"));
    expect(e.message).toContain("<schema>");
  });

  test("the message does NOT teach the deprecated whitespace opener", () => {
    // W-WHITESPACE-001: the with-space opener is deprecated and becomes
    // E-WHITESPACE-001 in P3. A remedy that hands the adopter a form the compiler
    // will later reject is a diagnostic defect in its own right.
    const e = epa002(MISSING_DB_SRC, join(FAKE_DIR, "app.scrml"));
    expect(e.message).not.toContain("< schema>");
  });

  test("the message steers AWAY from hand-building the DB (the observed adopter workaround)", () => {
    const e = epa002(MISSING_DB_SRC, join(FAKE_DIR, "app.scrml"));
    expect(e.message).toContain("bun:sqlite");
    expect(e.message).toContain("do NOT hand-write the schema");
  });

  test("the pre-existing explanation is retained, not replaced", () => {
    const e = epa002(MISSING_DB_SRC, join(FAKE_DIR, "app.scrml"));
    expect(e.message).toContain("nope-f2.db");
    expect(e.message).toContain("drivers");
    expect(e.message).toContain("no CREATE TABLE statement");
    expect(e.message).toContain("add a CREATE TABLE statement in a `?{}`");
  });

  test("the plural branch agrees with itself (tables / create them)", () => {
    const src = `<db src="./nope-f2m.db" tables="drivers, loads">
  \${
    function _noop() { }
  }
</>`;
    const e = epa002(src, join(FAKE_DIR, "multi.scrml"));
    expect(e).toBeDefined();
    expect(e.message).toContain("declare tables `drivers, loads`");
    expect(e.message).toContain("to create them.");
    expect(e.message).toContain("scrml db-migrate");
  });

  test("the singular branch agrees with itself (table / create it)", () => {
    const e = epa002(MISSING_DB_SRC, join(FAKE_DIR, "app.scrml"));
    expect(e.message).toContain("declare table `drivers`");
    expect(e.message).toContain("to create it.");
  });

  test("the driver-URI branch also names db-migrate and keeps its phase-2 note", () => {
    const src = `<db src="postgres://localhost:5432/dispatch" tables="drivers">
  \${
    function _noop() { }
  }
</>`;
    const e = epa002(src, join(FAKE_DIR, "pg.scrml"));
    expect(e).toBeDefined();
    expect(e.message).toContain("scrml db-migrate . --db postgres://localhost:5432/dispatch");
    expect(e.message).toContain("introspection lands in a future phase");
  });
});

// ---------------------------------------------------------------------------
// FIRE CONDITION UNCHANGED — F-2 is a message-only change. Every suppression
// path that worked before must still suppress, and the genuine failure must
// still fire. This is the guard against "improving" the message into a
// behaviour change.
// ---------------------------------------------------------------------------

describe("F-2 — E-PA-002 fire condition is untouched", () => {
  test("still FIRES when the db file is missing and no DDL source exists", () => {
    const { errors } = paFor(MISSING_DB_SRC, join(FAKE_DIR, "app.scrml"));
    expect(errors.some((e) => e.code === "E-PA-002")).toBe(true);
  });

  test("still SUPPRESSED by a `<schema>` block (F-SCHEMA-001 path)", () => {
    const src = `<schema>
    drivers {
        id:    integer primary key
        name:  text not null
    }
</>
<db src="./nope-f2s.db" tables="drivers">
  \${
    function _noop() { }
  }
</>`;
    const { errors } = paFor(src, join(FAKE_DIR, "schema.scrml"));
    expect(errors.some((e) => e.code === "E-PA-002")).toBe(false);
  });

  test("still SUPPRESSED by a `?{}`-harvested CREATE TABLE", () => {
    const src = `<db src="./nope-f2q.db" tables="drivers">
  \${
    function _bootstrap() {
      ?{\`CREATE TABLE drivers (id INTEGER PRIMARY KEY, name TEXT)\`}.run()
    }
  }
</>`;
    const { errors } = paFor(src, join(FAKE_DIR, "harvest.scrml"));
    expect(errors.some((e) => e.code === "E-PA-002")).toBe(false);
  });

  test("still SUPPRESSED when the db file genuinely exists on disk", () => {
    const dir = mkdtempSync(join(tmpdir(), "f2-live-"));
    try {
      const dbPath = join(dir, "live.db");
      const db = new Database(dbPath);
      db.run("CREATE TABLE drivers (id INTEGER PRIMARY KEY, name TEXT)");
      db.close();
      const src = `<db src="./live.db" tables="drivers">
  \${
    function _noop() { }
  }
</>`;
      const { errors } = paFor(src, join(dir, "app.scrml"));
      expect(errors.some((e) => e.code === "E-PA-002")).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
