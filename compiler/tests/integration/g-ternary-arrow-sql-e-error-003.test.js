/**
 * g-ternary-arrow-sql-e-error-003 (2026-06-27) — the ternary-body SIBLING of
 * g-arrow-expr-body-sql-parser-truncate (ss50 item-1, commit 2fca8075).
 *
 * REPRO:
 *   const ins = (x) => x ? ?{`SELECT id FROM items WHERE id = ${x}`}.all() : []
 *
 * ROOT CAUSE. A concise arrow whose body is a TERNARY with a `?{}` SQL block in
 * an arm hits the depth-0 BLOCK_REF statement-boundary break in `collectExpr`
 * (ast-builder.js) with `lastTok` = the ternary `?` (a PUNCT), NOT the `=>`
 * operator — so the ss50 `_lastIsArrowGlyph` guard (which only suppresses the
 * break for the `=>`-direct concise body) does not apply. Pre-fix the break
 * orphaned the SQL as a sibling node and left `( x ) => x ?` — a text ending in
 * `?` that the const/let-decl `?`-propagate hook then mis-read as a
 * `propagate-expr`, so the typer surfaced the WRONG diagnostic: E-ERROR-003
 * ("`?` propagation operator used in a non-`!` function") instead of the
 * canonical E-SQL-009 (SQL-in-arrow forbidden — issue #12 Option-B).
 *
 * FIX (ast-builder.js collectExpr — the SAME locus ss50 item-1 used; NOT the
 * tokenizer, whose output `IDENT(x) PUNCT(?) BLOCK_REF(sql) …` is already
 * correct). A new `sawArrowGlyphAtDepth0` latch records that the expression's
 * top-level body is a concise arrow (a depth-0 `=>`); the BLOCK_REF break is
 * then ALSO suppressed when `lastTok` is a ternary `?` PUNCT inside such an arrow
 * body. The full arrow text (incl. the `?{`…`}`) is captured into the same
 * escape-hatch the `=>`-direct / block-body forms produce, where the post-AST
 * detectSqlInConciseArrowBody pass (api.js / detect-sql-in-arrow.ts) fires a
 * single clean E-SQL-009. The arrow-context gate keeps a statement-level
 * propagation-then-SQL (`foo()?` then a separate `?{}` statement — no depth-0
 * `=>`) intact, so genuine `?` propagation still diagnoses as E-ERROR-003.
 *
 * Option-B is RATIFIED: SQL-in-arrow is FORBIDDEN; the fix makes the DIAGNOSTIC
 * correct (E-SQL-009), it does NOT make SQL-in-ternary-arrow work / lower.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname, join } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { Database } from "bun:sqlite";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
const TMP_ROOT = resolve(testDir, "_tmp_ternary_arrow_sql");
let counter = 0;

beforeAll(() => {
  if (!existsSync(TMP_ROOT)) mkdirSync(TMP_ROOT, { recursive: true });
});
afterAll(() => {
  if (existsSync(TMP_ROOT)) rmSync(TMP_ROOT, { recursive: true, force: true });
});

function compileSrc(src, tag) {
  const dir = resolve(TMP_ROOT, `${tag}-${++counter}`);
  mkdirSync(dir, { recursive: true });
  const input = join(dir, "app.scrml");
  writeFileSync(input, src);
  const db = new Database(join(dir, "m.db"), { create: true });
  db.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, label TEXT)");
  db.close();
  const result = compileScrml({ inputFiles: [input], write: true, outputDir: join(dir, "dist") });
  return { codes: (result.errors ?? []).map((e) => e.code), errors: result.errors ?? [] };
}

const WRAP = (body) => `<program db="m.db">
<db src="m.db" tables="items">
  \${
${body}
  }
  <button onclick=doit()>go</button>
</>
</program>`;

describe("g-ternary-arrow-sql-e-error-003 — SQL `?{}` in a ternary arm of a concise arrow body", () => {
  // The core regression: ternary CONSEQUENT carries the SQL.
  test("consequent-arm `?{}` → E-SQL-009 (NOT E-ERROR-003, NOT E-CODEGEN-INVALID-LOGIC)", () => {
    const { codes, errors } = compileSrc(
      WRAP(`    function doit() {
      const ins = (x) => x ? ?{\`SELECT id FROM items WHERE id = \${x}\`}.all() : []
      return { ins: ins }
    }`),
      "ternary-consequent",
    );
    expect(codes).toContain("E-SQL-009");
    // The whole point of this bug: the WRONG diagnostic must be gone.
    expect(codes).not.toContain("E-ERROR-003");
    expect(codes).not.toContain("E-CODEGEN-INVALID-LOGIC");
    // Exactly ONE E-SQL-009 (the concise pass + emit-server site stay disjoint).
    expect(codes.filter((c) => c === "E-SQL-009").length).toBe(1);
    const msg = errors.find((e) => e.code === "E-SQL-009")?.message ?? "";
    expect(msg).toContain("server function");
  });

  // The ALTERNATE arm carries the SQL (the `?{}` is after the `:`).
  test("alternate-arm `?{}` → E-SQL-009 (NOT E-ERROR-003)", () => {
    const { codes } = compileSrc(
      WRAP(`    function doit() {
      const ins = (x) => x ? [] : ?{\`SELECT id FROM items WHERE id = \${x}\`}.all()
      return { ins: ins }
    }`),
      "ternary-alternate",
    );
    expect(codes).toContain("E-SQL-009");
    expect(codes).not.toContain("E-ERROR-003");
    expect(codes).not.toContain("E-CODEGEN-INVALID-LOGIC");
    expect(codes.filter((c) => c === "E-SQL-009").length).toBe(1);
  });

  // The return-form concise arrow (mirrors ss50 item-1's return case).
  test("return-form ternary arrow `?{}` → E-SQL-009 (NOT E-ERROR-003)", () => {
    const { codes } = compileSrc(
      WRAP(`    function makeIns() {
      return (x) => x ? ?{\`SELECT id FROM items WHERE id = \${x}\`}.all() : []
    }
    function doit() { makeIns()(1) }`),
      "ternary-return",
    );
    expect(codes).toContain("E-SQL-009");
    expect(codes).not.toContain("E-ERROR-003");
    expect(codes).not.toContain("E-CODEGEN-INVALID-LOGIC");
    expect(codes.filter((c) => c === "E-SQL-009").length).toBe(1);
  });
});

describe("g-ternary-arrow-sql-e-error-003 — no-regression guards", () => {
  // A plain SQL-free ternary in a concise arrow body must compile clean: the
  // break-suppression must not change the parse of an ordinary ternary arrow.
  test("SQL-free ternary arrow `(x) => x ? a : b` compiles clean", () => {
    const { codes } = compileSrc(
      WRAP(`    function doit() {
      const pick = (x) => x ? 1 : 0
      return { n: pick(1) }
    }`),
      "ternary-sql-free",
    );
    expect(codes).not.toContain("E-SQL-009");
    expect(codes).not.toContain("E-ERROR-003");
    expect(codes.filter((c) => !c?.startsWith("W-"))).toEqual([]);
  });

  // GENUINE `?` propagation in a non-failable function must STILL fire E-ERROR-003
  // — the arrow-context gate must not disable the propagation path.
  test("genuine `?` propagation in a non-`!` function still fires E-ERROR-003", () => {
    const { codes } = compileSrc(
      WRAP(`    function helper()! -> {Err} { fail .Boom }
    function doit() {
      const r = helper()?
      return { r: r }
    }`),
      "genuine-propagation",
    );
    expect(codes).toContain("E-ERROR-003");
    expect(codes).not.toContain("E-SQL-009");
  });

  // ss50 item-1: the `=>`-direct concise-body SQL-in-arrow must STILL fire a
  // single clean E-SQL-009 (the existing guard must remain intact).
  test("ss50 `=>`-direct concise SQL-in-arrow still fires E-SQL-009 (single)", () => {
    const { codes } = compileSrc(
      WRAP(`    function doit() {
      const ins = (x) => ?{\`INSERT INTO items (id) VALUES (\${x})\`}.run()
      ins(1)
    }`),
      "ss50-direct",
    );
    expect(codes).toContain("E-SQL-009");
    expect(codes).not.toContain("E-CODEGEN-INVALID-LOGIC");
    expect(codes.filter((c) => c === "E-SQL-009").length).toBe(1);
  });

  // A statement-level `?{}` (the canonical legal shape) must not false-fire
  // E-SQL-009 just because an arrow appears elsewhere in the same fn body.
  test("statement-level `?{}` with an unrelated arrow nearby compiles clean", () => {
    const { codes } = compileSrc(
      WRAP(`    function doit() {
      const rows = ?{\`SELECT id FROM items\`}.all()
      const ids = rows.map((r) => r.id)
      return { ids: ids }
    }`),
      "stmt-level-sql",
    );
    expect(codes).not.toContain("E-SQL-009");
    expect(codes).not.toContain("E-ERROR-003");
    expect(codes.filter((c) => !c?.startsWith("W-"))).toEqual([]);
  });
});
