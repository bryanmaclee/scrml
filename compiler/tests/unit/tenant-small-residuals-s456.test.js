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
import { parseSchemaBlock } from "../../src/schema-differ.js";

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
