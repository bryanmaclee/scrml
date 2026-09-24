/**
 * Credentials in a `db=` / `<db src=>` driver URI never reach compiler output.
 * (s430-dev-db-stub F4 — security, P7 criterion 3.)
 *
 * Before the fix, `<db src="postgres://admin:S3cretPW@…">` with no DDL printed
 * the full URI three times per compile: twice in E-PA-002 (once inside a
 * copy-pasteable `scrml db-migrate --db …`) and once in the `Note(PA):` stderr
 * line on every in-memory-schema compile. E-SQL-005 and `scrml introspect`
 * echoed the value too.
 *
 *   §1  redactDbUri — the helper
 *   §2  protect-analyzer — E-PA-002 text + the Note(PA) stderr line
 *   §3  resolveDbDriver — both E-SQL-005 shapes
 *   §4  end-to-end CLI compile — the password appears nowhere in stdout/stderr
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { redactDbUri, redactCredentialsInText } from "../../src/db-uri-redact.ts";
import { runPA } from "../../src/protect-analyzer.js";
import { resolveDbDriver } from "../../src/codegen/db-driver.ts";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const PW = "S3cretPW";
const PG = `postgres://admin:${PW}@db.example:5432/app`;
const CLI = resolve(import.meta.dir, "../../src/cli.js");

function makeDbFileAST(filePath, attrMap, extraNodes = []) {
  const span = { file: filePath, start: 0, end: 100, line: 1, col: 1 };
  const attrs = Object.entries(attrMap).map(([name, value]) => ({
    name, value: { kind: "string-literal", value }, span,
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

/** Run fn with process.stderr.write captured; returns [result, capturedText]. */
function captureStderr(fn) {
  const orig = process.stderr.write;
  let buf = "";
  process.stderr.write = (chunk, ...rest) => { buf += String(chunk); return true; };
  try {
    return [fn(), buf];
  } finally {
    process.stderr.write = orig;
  }
}

describe("§1 redactDbUri", () => {
  test("user:password userinfo is replaced whole", () => {
    expect(redactDbUri(PG)).toBe("postgres://<redacted>@db.example:5432/app");
  });
  test("mysql and user-only userinfo", () => {
    expect(redactDbUri("mysql://root:pw@h/db")).toBe("mysql://<redacted>@h/db");
    expect(redactDbUri("postgres://alice@h/db")).toBe("postgres://<redacted>@h/db");
  });
  test("an unencoded @ or / inside the password cannot leak its tail", () => {
    const out = redactDbUri("postgres://u:pa@ss/w@rd@host:5432/db");
    expect(out).not.toContain("pa");
    expect(out).not.toContain("rd");
    expect(out).toBe("postgres://<redacted>@host:5432/db");
  });
  test("password= parameters are redacted", () => {
    expect(redactDbUri("postgres://h/db?sslmode=require&password=hunter2"))
      .toBe("postgres://h/db?sslmode=require&password=<redacted>");
    expect(redactDbUri("host=h password=hunter2 dbname=x")).toBe("host=h password=<redacted> dbname=x");
  });
  test("redactCredentialsInText — a source line with the URI inside markup", () => {
    const line = `  <db src="${PG}" tables="items">`;
    expect(redactCredentialsInText(line)).toBe(`  <db src="postgres://<redacted>@db.example:5432/app" tables="items">`);
    expect(redactCredentialsInText(`<p>see https://example.com/a</p>`)).toBe(`<p>see https://example.com/a</p>`);
  });
  test("plain SQLite targets pass through unchanged", () => {
    for (const s of ["./app.db", "sqlite:./app.db", ":memory:", "/abs/app.db", "app.db"]) {
      expect(redactDbUri(s)).toBe(s);
    }
  });
});

describe("§2 protect-analyzer never echoes a driver-URI password", () => {
  test("E-PA-002 (no DDL): no password in the message; the db-migrate remedy uses a placeholder", () => {
    const file = "/virtual/app.scrml";
    const [res, err] = captureStderr(() => runPA({ files: [makeDbFileAST(file, { src: PG, tables: "items" })] }));
    const e = res.errors.find((x) => x.code === "E-PA-002");
    expect(e).toBeDefined();
    expect(e.message).not.toContain(PW);
    expect(e.message).toContain("postgres://<redacted>@db.example:5432/app");
    expect(e.message).toContain("--db <your connection string>");
    expect(err).not.toContain(PW);
    for (const x of res.errors) expect(x.message).not.toContain(PW);
  });

  test("in-memory-schema compile: the Note(PA) stderr line is redacted", () => {
    const file = "/virtual/app2.scrml";
    const sql = makeSqlNode(file, "CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY)");
    const [res, err] = captureStderr(() =>
      runPA({ files: [makeDbFileAST(file, { src: PG, tables: "items" }, [sql])] }));
    expect(res.errors).toHaveLength(0);
    expect(err).toContain("Note(PA)");
    expect(err).toContain("postgres://<redacted>@db.example:5432/app");
    expect(err).not.toContain(PW);
  });
});

describe("§3 E-SQL-005 never echoes a password", () => {
  test("mongodb:// (unsupported prefix)", () => {
    const r = resolveDbDriver(`mongodb://admin:${PW}@m.example/app`);
    expect(r.ok).toBe(false);
    expect(r.error.message).not.toContain(PW);
    expect(r.error.message).toContain("mongodb://<redacted>@m.example/app");
  });
  test("unrecognized scheme (typo)", () => {
    const r = resolveDbDriver(`postgress://admin:${PW}@db.example/app`);
    expect(r.ok).toBe(false);
    expect(r.error.message).not.toContain(PW);
  });
});

describe("§4 end-to-end: `scrml compile` stdout + stderr never carry the password", () => {
  let dir;
  beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "scrml-redact-e2e-")); });
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  function compile(name, body) {
    const f = join(dir, name);
    writeFileSync(f, body);
    const r = Bun.spawnSync([process.execPath, CLI, "compile", f, "-o", join(dir, "dist-" + name)], {
      stdout: "pipe", stderr: "pipe",
    });
    return r.stdout.toString() + "\n" + r.stderr.toString();
  }

  test("E-PA-002 path (no DDL)", () => {
    const out = compile("nodl.scrml",
      `<program db="${PG}">\n  <db src="${PG}" tables="items">\n    \${\n      function n() {\n        return ?{\`SELECT id FROM items\`}.all()\n      }\n    }\n    <p>x</p>\n  </db>\n</program>\n`);
    expect(out).toContain("E-PA-002");
    expect(out).not.toContain(PW);
  });

  test("in-memory-schema path (DDL present)", () => {
    const out = compile("ddl.scrml",
      `<program db="${PG}">\n  <db src="${PG}" tables="items">\n    \${\n      function mk() {\n        ?{\`CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY)\`}.run()\n      }\n      function n() {\n        return ?{\`SELECT id FROM items\`}.all()\n      }\n    }\n    <p>x</p>\n  </db>\n</program>\n`);
    expect(out).toContain("Note(PA)");
    expect(out).not.toContain(PW);
  });

  test("E-SQL-005 path (mongodb:// on <program db=>)", () => {
    const out = compile("mongo.scrml",
      `<program db="mongodb://admin:${PW}@m.example/app">\n  \${\n    function n() {\n      return ?{\`SELECT 1\`}.all()\n    }\n  }\n  <p>x</p>\n</program>\n`);
    expect(out).toContain("E-SQL-005");
    expect(out).not.toContain(PW);
  });
});
