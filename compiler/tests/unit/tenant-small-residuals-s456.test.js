/**
 * g-tenant-small-residuals-s455 — items (b) and (c) (S456).
 *
 * (b) §14.8.10 statement-kind allow-list (S455 "your rec on the allow-list"): a `<schema>`
 *     admits *"`CREATE POLICY … AS RESTRICTIVE` (its body read in the tenant SQL subset …)"*.
 *     A comment between the head's tokens — `AS /* x *\/ RESTRICTIVE`, `AS --x⏎ RESTRICTIVE`,
 *     `ON /* c *\/ assets` — was charged twice (reproduced S456 on 2dd6d35d9): the comment
 *     text read as the AS mode ("its `AS` clause (`x`) could not be read"), and the AS clause
 *     read as policy body ("body outside the tenant SQL subset — a comment").
 * (c) `parseSchemaBlock` re-scanned to the end of the body for every head of an unbalanced
 *     block: `"a{"`×40k ≈ 13 s, `"fn f("`×40k ≈ 18 s (measured S456 on 2dd6d35d9). Now
 *     amortized linear, results unchanged (differential fuzz vs base: 550k bodies, 0 diffs —
 *     docs/changes/s456-tenant-identity-substrate/progress.md).
 */
import { describe, test, expect, setDefaultTimeout } from "bun:test";
import { findSchemaTenantHazards, schemaTenantTableNames } from "../../src/tenant-schema-hazards.ts";
import { parseSchemaBlock, schemaTableDeclarations, sqlLineCommentEnd } from "../../src/schema-differ.js";
import { tableRefsInSql } from "../../src/sql-table-refs.js";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

setDefaultTimeout(30_000);

const BT = "`";
const w = (s) => `?{${BT}${s}${BT}}`;
const T = "CREATE TABLE assets (id INTEGER PRIMARY KEY, name TEXT, tenant_id TEXT)";
const hazards = (stmt, dialect = "postgres") => {
  const body = `\n${w(T)}\n${w("CREATE TABLE other (id INTEGER)")}\n${w(stmt)}\n`;
  return findSchemaTenantHazards(body, schemaTenantTableNames([body]), undefined, dialect).map((h) => `${h.kind}: ${h.why}`);
};

describe("(b) a comment between CREATE POLICY head tokens is not part of the statement", () => {
  const USING = "USING (tenant_id = current_setting('app.tenant'))";
  test.each([
    ["AS /* x */ RESTRICTIVE", `CREATE POLICY p ON assets AS /* x */ RESTRICTIVE ${USING}`],
    ["AS --x⏎ RESTRICTIVE", `CREATE POLICY p ON assets AS --x\n RESTRICTIVE ${USING}`],
    ["a comment before AS", `CREATE POLICY p ON assets /* c */ AS RESTRICTIVE ${USING}`],
    ["a comment before the table", `CREATE POLICY p ON /* c */ assets AS RESTRICTIVE ${USING}`],
    ["a comment before USING", `CREATE POLICY p ON assets AS RESTRICTIVE -- c\n FOR SELECT ${USING}`],
    ["a non-tenant table", "CREATE POLICY p ON other AS /* x */ RESTRICTIVE USING (true)"],
  ])("%s — admitted", (_label, stmt) => {
    expect(hazards(stmt)).toEqual([]);
  });

  test("still charged: a comment INSIDE the policy body (the subset admits no comment there)", () => {
    expect(hazards(`CREATE POLICY p ON assets AS RESTRICTIVE USING (tenant_id /* c */ = current_setting('app.tenant'))`).join())
      .toContain("comment");
  });
  test("still charged: PERMISSIVE behind a comment, and RESTRICTIVE only inside a comment", () => {
    expect(hazards("CREATE POLICY p ON assets AS /* x */ PERMISSIVE USING (true)").join()).toContain("PERMISSIVE on `assets`");
    expect(hazards("CREATE POLICY p ON assets AS /* RESTRICTIVE */ PERMISSIVE USING (true)").join()).toContain("PERMISSIVE on `assets`");
    expect(hazards("CREATE POLICY p ON assets AS --RESTRICTIVE\n PERMISSIVE USING (true)").join()).toContain("PERMISSIVE on `assets`");
  });
  test("still charged: a call off the allow-list in a restrictive body behind a comment", () => {
    expect(hazards("CREATE POLICY p ON assets AS /* x */ RESTRICTIVE USING (evil(tenant_id))").join()).toContain("`evil`");
  });
  test("still charged: a comment whose extent differs between databases (nested `/*`) — fail-closed", () => {
    expect(hazards("CREATE POLICY p ON assets AS /* /* x */ RESTRICTIVE USING (true)").length).toBeGreaterThan(0);
  });
  test("still charged: a commented-out permissive policy (the comment-content reading is unchanged)", () => {
    expect(hazards("/* CREATE POLICY p ON assets USING (true) */").join()).toContain("PERMISSIVE");
  });
});

describe("(c) parseSchemaBlock is linear on unbalanced input, results unchanged", () => {
  const timed = (s) => { const t0 = performance.now(); const r = parseSchemaBlock(s); return { r, ms: performance.now() - t0 }; };
  test.each([
    ['"a{" x 40k', "a{".repeat(40000)],
    ['"fn f(" x 40k', "fn f(".repeat(40000)],
    ['\'a{ """ \' x 20k', 'a{ """ '.repeat(20000)],
    ['"a {{" x 20k', "a {{".repeat(20000)],
    ['"fn f(a: b) owner(r) " x 20k + "{"', "fn f(a: b) owner(r) ".repeat(20000) + "{"],
  ])("%s — under 3 s (base: 5–18 s)", (_label, s) => {
    const { r, ms } = timed(s);
    expect(r.tables).toEqual([]);
    expect(r.fns).toEqual([]);
    expect(ms).toBeLessThan(3000);
  });
  test("an unbalanced head before balanced ones still reads the later tables (per-head scan semantics kept)", () => {
    const r = parseSchemaBlock('x{ """ b{ c{ } """ d{ e: text } f{ ');
    expect(r.tables.map((t) => t.name)).toEqual(["c", "d"]);
    expect(parseSchemaBlock("a{ b{ c: text }").tables.map((t) => t.name)).toEqual(["b"]);
    expect(parseSchemaBlock("users { id: integer } a{").tables.map((t) => t.name)).toEqual(["users"]);
  });
  test("an fn decl after malformed fn heads sharing its modifier run", () => {
    const r = parseSchemaBlock('fn bad( fn f(a: integer) security definer owner(app_owner) returns integer requires cap("x") { """ SELECT 1; """ }');
    expect(r.fns.map((f) => [f.name, f.owner, f.returns, f.cap, f.isSecurityDefiner])).toEqual([["f", "app_owner", "integer", "x", true]]);
  });
});

// ---------------------------------------------------------------------------
// S456 review F1 (PA-reproduced, HIGH): Postgres ends a `--` comment at `\r` OR `\n`
// (scan.l `newline [\n\r]`); SQLite / MySQL only at `\n`. The lexer read every `--`
// comment through `\n`, so `AS --x\rPERMISSIVE …` hid a live PERMISSIVE (rc=0 on
// f746ff43b). Root fix: every `--` reader ends at the first `\r` / `\n`; a lone `\r`
// (extent differs by database) is charged in a tenant `<schema>` and is an unmodelled
// form to the declaration readers.
// ---------------------------------------------------------------------------
describe("F1 — a `--` comment ends at `\\r` or `\\n` (CR-only, CRLF, LF, mixed)", () => {
  const HEAD = (eol) => `CREATE POLICY p ON assets AS --x${eol}PERMISSIVE USING (true) /*\nRESTRICTIVE --*/`;
  test("sqlLineCommentEnd: the first of `\\r` / `\\n`", () => {
    expect(sqlLineCommentEnd("--a\rb\nc", 0)).toBe(3);
    expect(sqlLineCommentEnd("--a\r\nb", 0)).toBe(3);
    expect(sqlLineCommentEnd("--a\nb", 0)).toBe(3);
    expect(sqlLineCommentEnd("--abc", 0)).toBe(5);
  });
  test("policy head, CR-only: charged (the PA repro — PERMISSIVE is live on Postgres)", () => {
    expect(hazards(HEAD("\r")).length).toBeGreaterThan(0);
    expect(hazards(HEAD("\r")).join()).toContain("carriage return (");
  });
  test("policy head, CRLF and LF: the PERMISSIVE after the comment is charged as permissive (same extent everywhere)", () => {
    expect(hazards(HEAD("\r\n")).join()).toContain("PERMISSIVE on `assets`");
    expect(hazards(HEAD("\n")).join()).toContain("PERMISSIVE on `assets`");
    expect(hazards(HEAD("\r\n")).join()).not.toContain("carriage return");
  });
  test("policy head, CRLF / LF before RESTRICTIVE: admitted", () => {
    expect(hazards("CREATE POLICY p ON assets AS --x\r\nRESTRICTIVE USING (true)")).toEqual([]);
    expect(hazards("CREATE POLICY p ON assets AS --x\nRESTRICTIVE USING (true)")).toEqual([]);
  });
  test("policy head, mixed (`\\r\\n` then a lone `\\r`): charged", () => {
    expect(hazards("CREATE POLICY p ON assets AS --x\r\n--y\rPERMISSIVE USING (true) --\nRESTRICTIVE").length).toBeGreaterThan(0);
  });
  test("a lone `\\r` comment BETWEEN statements is charged too (text after it is SQL to one database only)", () => {
    expect(hazards("CREATE TABLE cfg (k TEXT) --x\r/*\nCREATE POLICY q ON assets USING (true) --*/").join()).toContain("carriage return (");
  });
  test("declaration readers: a `tenant_id` after a CR-terminated comment is read (CREATE column list, head, ALTER)", () => {
    const tenantOf = (stmt) => schemaTableDeclarations(`\n${w(stmt)}\n`).filter((d) => d.tenant).map((d) => d.key);
    expect(tenantOf("CREATE TABLE logs (id INTEGER --c\r, tenant_id TEXT\n)")).toContain("logs");
    expect(tenantOf("CREATE TABLE --c\rlogs (id INTEGER, tenant_id TEXT)")).toContain("logs");
    expect(tenantOf("CREATE TABLE logs (id INTEGER --c\r\n, tenant_id TEXT)")).toContain("logs");
    expect(tenantOf("CREATE TABLE logs (id INTEGER --c\n, tenant_id TEXT)")).toContain("logs");
    expect(schemaTenantTableNames([`\n${w("CREATE TABLE notes (id INTEGER)")}\n${w("ALTER TABLE notes ADD COLUMN x INT --c\r, ADD COLUMN tenant_id TEXT")}\n`])).toContain("notes");
  });
  test("table references in a query: a table after a CR-terminated comment is referenced", () => {
    expect(tableRefsInSql("SELECT * FROM a --x\rJOIN secret ON 1=1\n").tables).toContain("secret");
    expect(tableRefsInSql("SELECT * FROM a --x\nJOIN secret ON 1=1").tables).toContain("secret");
  });
  test("a tenant QUERY with a `--` comment (CR, CRLF, LF) that hides a tenant table is refused (the subset admits no comment)", () => {
    const dir = mkdtempSync(join(tmpdir(), "s456-f1-"));
    try {
      for (const eol of ["\r", "\r\n", "\n"]) {
        const src = `<program db="postgres://localhost/app">\n<schema>\nCREATE TABLE assets (id integer primary key, name text, tenant_id text);\nCREATE TABLE cfg (k text, name text);\n</>\n\${\n  function f() {\n    return ?{\`SELECT name FROM cfg --x${eol}JOIN assets ON 1=1\`}.all()\n  }\n}\n<button onclick=\${ f() }>x</button>\n</program>\n`;
        writeFileSync(join(dir, "a.scrml"), src);
        const r = compileScrml({ inputFiles: [join(dir, "a.scrml")], write: false, outputDir: join(dir, "o"), log: () => {} });
        expect((r.errors ?? []).map((e) => e.code)).toContain("E-TENANT-SQL-SUBSET");
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
