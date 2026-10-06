/**
 * §14.8.11 (S455 "a", g-tenant-pg-overload-hijack-s455) — `scrml build` states the
 * Postgres deploy requirement `REVOKE CREATE ON SCHEMA public FROM PUBLIC` once per
 * build whose program declares ≥1 `db-authoritative` table.
 *
 * Why it is a deploy requirement and not a compile check: Postgres resolves a function
 * call by exact argument type across the whole search_path, and the compiler's
 * allow-lists are name-level — a planted `public.lower(integer)` wins over
 * `pg_catalog.lower(text)` inside an admitted tenant query. The compiler cannot see
 * overloads, so the build tells the deployer. It never connects to a database.
 *
 * Pinned:
 *   - `compileScrml(...).dbAuthoritative` is true exactly when a db-authoritative table
 *     is declared (the same recognizer as emit-server's principal-wrapper gate).
 *   - `pgSchemaCreateRequirementLines` is empty unless that flag is true.
 *   - `scrml build` prints the requirement once on a db-authoritative Postgres program
 *     (server and static targets), and not at all for a Postgres program with no
 *     db-authoritative table or a SQLite program.
 *   - A db-authoritative table on SQLite never reaches the report: E-DBAUTH-SQLITE
 *     fails the build first.
 */

import { describe, test, expect, setDefaultTimeout } from "bun:test";
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { compileScrml } from "../../src/api.js";
import { pgSchemaCreateRequirementLines } from "../../src/commands/build.js";

setDefaultTimeout(60_000);

const testDir = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(testDir, "../../src/cli.js");
const REVOKE = "REVOKE CREATE ON SCHEMA public FROM PUBLIC";

const app = (db, marker) => `<program db="${db}">
  <schema>
    widgets { id: text primary key  tenant_id: text not null  name: text not null }${marker}
  </>
  function names() {
    return ?{\`SELECT name FROM widgets\`}.all()
  }
  <n> = 0
  <button onclick=\${@n = names().length}>go</button>
</program>
`;

const PG_DBAUTH = app("postgres://localhost/app", " db-authoritative");
const PG_PLAIN = app("postgres://localhost/app", "");
const SQLITE_PLAIN = app("app.db", "");
const SQLITE_DBAUTH = app("app.db", " db-authoritative");

function project(source) {
  const root = mkdtempSync(join(tmpdir(), "s455-pg-revoke-"));
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "scrml.toml"), "");
  writeFileSync(join(root, "src", "app.scrml"), source);
  return root;
}

function compile(source) {
  const root = project(source);
  try {
    return compileScrml({
      inputFiles: [join(root, "src", "app.scrml")],
      write: false,
      outputDir: join(root, "dist"),
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function build(source, extraArgs = []) {
  const root = project(source);
  try {
    const proc = Bun.spawnSync(
      ["bun", CLI, "build", join(root, "src"), "-o", join(root, "dist"), ...extraArgs],
      { cwd: root, stdout: "pipe", stderr: "pipe" },
    );
    return {
      code: proc.exitCode,
      stdout: proc.stdout.toString(),
      stderr: proc.stderr.toString(),
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const occurrences = (text, needle) => text.split(needle).length - 1;

describe("compileScrml dbAuthoritative", () => {
  test("true for a db-authoritative table on Postgres", () => {
    const r = compile(PG_DBAUTH);
    expect(r.errors).toEqual([]);
    expect(r.dbAuthoritative).toBe(true);
  });

  test("false for a Postgres program with no db-authoritative table", () => {
    const r = compile(PG_PLAIN);
    expect(r.errors).toEqual([]);
    expect(r.dbAuthoritative).toBe(false);
  });

  test("false for a SQLite program", () => {
    const r = compile(SQLITE_PLAIN);
    expect(r.errors).toEqual([]);
    expect(r.dbAuthoritative).toBe(false);
  });

  test("a db-authoritative table on SQLite fails E-DBAUTH-SQLITE (never reaches the report)", () => {
    const r = compile(SQLITE_DBAUTH);
    expect(r.errors.map((e) => e.code)).toContain("E-DBAUTH-SQLITE");
  });
});

describe("pgSchemaCreateRequirementLines", () => {
  test("empty unless the program is db-authoritative", () => {
    expect(pgSchemaCreateRequirementLines(undefined)).toEqual([]);
    expect(pgSchemaCreateRequirementLines(false)).toEqual([]);
  });

  test("states the requirement and the reason", () => {
    const text = pgSchemaCreateRequirementLines(true).join("\n");
    expect(occurrences(text, REVOKE)).toBe(1);
    expect(text).toContain("SPEC §14.8.11");
    expect(text).toContain("search_path");
    expect(text).toContain("overload");
  });
});

describe("scrml build report", () => {
  test("a db-authoritative Postgres program prints the requirement once", () => {
    const r = build(PG_DBAUTH);
    expect(r.code).toBe(0);
    expect(occurrences(r.stdout, REVOKE)).toBe(1);
    expect(r.stdout).toContain("Postgres deploy requirement (SPEC §14.8.11)");
    // A report line, never a diagnostic: nothing about it on stderr.
    expect(r.stderr).not.toContain(REVOKE);
  });

  test("--target static prints it too", () => {
    const r = build(PG_DBAUTH, ["--target", "static"]);
    expect(r.code).toBe(0);
    expect(occurrences(r.stdout, REVOKE)).toBe(1);
  });

  test("a Postgres program with no db-authoritative table prints nothing about it", () => {
    const r = build(PG_PLAIN);
    expect(r.code).toBe(0);
    expect(r.stdout + r.stderr).not.toContain(REVOKE);
  });

  test("a SQLite program prints nothing about it", () => {
    const r = build(SQLITE_PLAIN);
    expect(r.code).toBe(0);
    expect(r.stdout + r.stderr).not.toContain(REVOKE);
  });
});
