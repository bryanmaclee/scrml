/**
 * §14.8.11 M2 — `scrml db-migrate` unit tests (no live DB required).
 *
 * Covers the pure/near-pure surfaces of the migration-apply seam:
 *   - the argv parser (parseArgs)
 *   - the ledger object-authorship classifier (classifyStatement)
 *   - desired-schema extraction from a parsed fileAST (extractDesiredSchema)
 *   - the reconcile plan a project produces, incl. the no-bare-DROP-TABLE fence
 *   - a basic SQLite apply smoke (Fork 5 — general <schema>-apply)
 */

import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Database } from "bun:sqlite";
import { parseArgs, classifyStatement, runDbMigrate } from "../../src/commands/db-migrate.js";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { extractDesiredSchema } from "../../src/codegen/db-authoritative.ts";
import { parseSchemaBlock, diffSchema } from "../../src/schema-differ.js";

function astOf(src) {
  return buildAST(splitBlocks("test.scrml", src)).ast;
}

const DBAUTH_PROJECT = `<program db="postgres://x">
  <schema>
    invoices {
      id: uuid primary key
      tenant_id: uuid not null
      amount: decimal not null
    } db-authoritative
    audit {
      id: integer primary key
      note: text
    }
  </schema>
</program>
`;

// ==========================================================================
// argv parser
// ==========================================================================
describe("db-migrate: parseArgs", () => {
  test("positional input + --db value", () => {
    const r = parseArgs(["./app", "--db", "postgres://m@h/db"]);
    expect(r.input).toBe("./app");
    expect(r.dbUrl).toBe("postgres://m@h/db");
    expect(r.dryRun).toBe(false);
    expect(r.allowDestructive).toBe(false);
    expect(r.help).toBe(false);
  });

  test("--db=<url> inline form", () => {
    const r = parseArgs(["app.scrml", "--db=sqlite:./x.db"]);
    expect(r.input).toBe("app.scrml");
    expect(r.dbUrl).toBe("sqlite:./x.db");
  });

  test("--dry-run and --allow-destructive flags", () => {
    const r = parseArgs(["app.scrml", "--db", "u", "--dry-run", "--allow-destructive"]);
    expect(r.dryRun).toBe(true);
    expect(r.allowDestructive).toBe(true);
  });

  test("--help / -h", () => {
    expect(parseArgs(["--help"]).help).toBe(true);
    expect(parseArgs(["-h"]).help).toBe(true);
  });

  test("order independence (flags before positional)", () => {
    const r = parseArgs(["--dry-run", "--db", "u", "app.scrml"]);
    expect(r.input).toBe("app.scrml");
    expect(r.dbUrl).toBe("u");
    expect(r.dryRun).toBe(true);
  });
});

// ==========================================================================
// ledger authorship classifier
// ==========================================================================
describe("db-migrate: classifyStatement (ledger authorship)", () => {
  const cases = [
    [`CREATE TABLE "invoices" ( "id" uuid PRIMARY KEY )`, "table", "invoices"],
    [`CREATE TABLE IF NOT EXISTS "_scrml_migrations" (id bigserial)`, "table", "_scrml_migrations"],
    [`DO $$ BEGIN CREATE ROLE scrml_app NOLOGIN NOBYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`, "role", "scrml_app"],
    [`GRANT SELECT, INSERT, UPDATE, DELETE ON "invoices" TO scrml_app;`, "grant", "invoices"],
    [`ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;`, "alter", "invoices"],
    [`DROP POLICY IF EXISTS scrml_tenant_iso ON "invoices";`, "drop-policy", "scrml_tenant_iso ON invoices"],
    [`CREATE POLICY scrml_tenant_iso ON "invoices" USING (true);`, "policy", "scrml_tenant_iso ON invoices"],
    [`DROP TABLE IF EXISTS "legacy";`, "drop-table", "legacy"],
  ];
  for (const [stmt, kind, name] of cases) {
    test(`${kind} — ${name}`, () => {
      const r = classifyStatement(stmt);
      expect(r.kind).toBe(kind);
      expect(r.name).toBe(name);
    });
  }
});

// ==========================================================================
// desired-schema extraction from a fileAST
// ==========================================================================
describe("db-migrate: extractDesiredSchema", () => {
  test("collects every <schema> table with its db-authoritative flag", () => {
    const { tables } = extractDesiredSchema(astOf(DBAUTH_PROJECT));
    const byName = Object.fromEntries(tables.map((t) => [t.name, t]));
    expect(Object.keys(byName).sort()).toEqual(["audit", "invoices"]);
    expect(byName.invoices.dbAuthoritative).toBe(true);
    expect(byName.audit.dbAuthoritative).toBeFalsy();
  });

  test("a file with no <schema> yields zero tables", () => {
    const { tables } = extractDesiredSchema(astOf(`<program>\n  <page>\n    <h1>hi</h1>\n  </page>\n</program>\n`));
    expect(tables).toEqual([]);
  });
});

// ==========================================================================
// the reconcile plan (desired vs actual)
// ==========================================================================
describe("db-migrate: reconcile plan", () => {
  test("db-authoritative table → CREATE TABLE + the S1/S6 DDL on postgres", () => {
    const desired = extractDesiredSchema(astOf(DBAUTH_PROJECT));
    const { sql } = diffSchema(desired, { tables: [] }, { driver: "postgres" });
    const joined = sql.join("\n");
    expect(joined).toContain('CREATE TABLE "invoices"');
    expect(joined).toContain("CREATE ROLE scrml_app NOLOGIN NOBYPASSRLS");
    expect(joined).toContain('ALTER TABLE "invoices" FORCE ROW LEVEL SECURITY');
    expect(joined).toContain("CREATE POLICY scrml_tenant_iso");
    // The plain `audit` table gets NO db-authoritative DDL.
    expect(joined).not.toContain('ON "audit"');
  });

  test("fence: an actual-but-not-desired table is NOT dropped by default", () => {
    const desired = parseSchemaBlock(`users { id: integer primary key }`);
    const actual = { tables: [{ name: "legacy", columns: [{ name: "id", type: "INTEGER", primaryKey: true, notNull: false, default: null }] }] };
    const { sql, warnings } = diffSchema(desired, actual, { driver: "postgres" });
    expect(sql.join("\n")).not.toContain("DROP TABLE");
    expect(warnings.some((w) => w.includes("W-SCHEMA-DESTRUCTIVE-DROP"))).toBe(true);
  });

  test("fence: --allow-destructive re-enables the DROP TABLE", () => {
    const desired = parseSchemaBlock(`users { id: integer primary key }`);
    const actual = { tables: [{ name: "legacy", columns: [{ name: "id", type: "INTEGER", primaryKey: true, notNull: false, default: null }] }] };
    const { sql } = diffSchema(desired, actual, { driver: "postgres", allowDestructive: true });
    expect(sql.some((s) => s.includes("DROP TABLE") && s.includes('"legacy"'))).toBe(true);
  });
});

// ==========================================================================
// SQLite apply smoke (Fork 5 — general <schema>-does-something-at-deploy)
// ==========================================================================
describe("db-migrate: SQLite apply smoke", () => {
  test("runDbMigrate creates the <schema> tables in a fresh SQLite file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "scrml-m2-sqlite-"));
    const dbPath = join(dir, "app.db");
    const project = join(dir, "app.scrml");
    writeFileSync(
      project,
      `<program db="${dbPath}">\n  <schema>\n    widgets {\n      id: integer primary key\n      name: text not null\n    }\n  </schema>\n</program>\n`,
    );
    try {
      await runDbMigrate([project, "--db", dbPath]);
      const db = new Database(dbPath);
      const names = db.query("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
      db.close();
      expect(names).toContain("widgets");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a db-authoritative table against a SQLite target fails closed (E-DBAUTH-SQLITE)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "scrml-m2-sqlite-"));
    const dbPath = join(dir, "app.db");
    const project = join(dir, "app.scrml");
    writeFileSync(project, DBAUTH_PROJECT.replace('db="postgres://x"', `db="${dbPath}"`));
    const { exitCode } = await captureRun([project, "--db", dbPath]);
    expect(exitCode).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  });
});

// ==========================================================================
// db-authoritative marker near-miss (MED) + the recognized-set echo
// ==========================================================================
describe("db-migrate: db-authoritative marker near-miss (MED)", () => {
  test("extractDesiredSchema warns W-DBAUTH-MARKER-NEARMISS on a mis-cased marker", () => {
    const src = `<program db="postgres://x">\n  <schema>\n    invoices {\n      id: uuid primary key\n      tenant_id: uuid not null\n    } DB-AUTHORITATIVE\n  </schema>\n</program>\n`;
    const { tables, warnings } = extractDesiredSchema(astOf(src));
    // The mis-cased marker is NOT recognized (silent downgrade) …
    expect(tables[0].dbAuthoritative).toBeFalsy();
    // … but the near-miss is surfaced.
    expect(warnings.some((w) => w.includes("W-DBAUTH-MARKER-NEARMISS"))).toBe(true);
  });

  test("the exact lowercase marker is recognized with no near-miss warning", () => {
    const { tables, warnings } = extractDesiredSchema(astOf(DBAUTH_PROJECT));
    expect(tables.find((t) => t.name === "invoices").dbAuthoritative).toBe(true);
    expect(warnings.some((w) => w.includes("NEARMISS"))).toBe(false);
  });

  test("db-migrate ECHOES the recognized db-authoritative set to stderr", async () => {
    const dir = mkdtempSync(join(tmpdir(), "scrml-m2-echo-"));
    const dbPath = join(dir, "app.db");
    const project = join(dir, "app.scrml");
    // A plain SQLite project (no db-auth) → the echo says "(none)".
    writeFileSync(
      project,
      `<program db="${dbPath}">\n  <schema>\n    widgets {\n      id: integer primary key\n    }\n  </schema>\n</program>\n`,
    );
    const { stderr } = await captureRun([project, "--db", dbPath]);
    expect(stderr).toContain("db-authoritative tables: (none)");
    rmSync(dir, { recursive: true, force: true });
  });
});

// ==========================================================================
// E-DBAUTH-NO-TENANT-COLUMN pre-flight (LOW)
// ==========================================================================
describe("db-migrate: E-DBAUTH-NO-TENANT-COLUMN pre-flight (LOW)", () => {
  test("a db-authoritative table with no tenant_id fails closed BEFORE connecting", async () => {
    const dir = mkdtempSync(join(tmpdir(), "scrml-m2-notenant-"));
    const project = join(dir, "app.scrml");
    writeFileSync(
      project,
      `<program db="postgres://x">\n  <schema>\n    ledger {\n      id: uuid primary key\n      amount: decimal not null\n    } db-authoritative\n  </schema>\n</program>\n`,
    );
    // A postgres:// URL that would never accept a connection — the pre-flight must
    // exit(1) BEFORE any connection attempt.
    const { exitCode, stderr } = await captureRun([project, "--db", "postgres://nope@127.0.0.1:1/none"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("E-DBAUTH-NO-TENANT-COLUMN");
    expect(stderr).toContain("ledger");
    rmSync(dir, { recursive: true, force: true });
  });
});

/**
 * Run runDbMigrate while capturing process.exit + console.error/log. Returns
 * `{ exitCode, stderr, stdout }`. process.exit is trapped by throwing a sentinel.
 */
async function captureRun(argv) {
  const origExit = process.exit;
  const origErr = console.error;
  const origLog = console.log;
  let exitCode = null;
  let stderr = "";
  let stdout = "";
  // @ts-ignore
  process.exit = (code) => { exitCode = code; throw new Error("__exit__"); };
  console.error = (...a) => { stderr += a.join(" ") + "\n"; };
  console.log = (...a) => { stdout += a.join(" ") + "\n"; };
  try {
    await runDbMigrate(argv);
  } catch (e) {
    if (e.message !== "__exit__") throw e;
  } finally {
    process.exit = origExit;
    console.error = origErr;
    console.log = origLog;
  }
  return { exitCode, stderr, stdout };
}
