/**
 * ss19 #12 (g-sql-in-arrow-body-invalid-js) — a `?{}` SQL block inside an
 * arrow / lambda body must raise a PRECISE, actionable diagnostic, NOT the
 * generic E-CODEGEN-INVALID-LOGIC ("this is a compiler defect ... please report it").
 *
 * REPRO (/tmp/ryan-verify/08-arrow-sql.scrml):
 *   function doit() {
 *     const ins = (x) => { ?{`INSERT INTO items (id) VALUES (${x})`}.run() }
 *     ins(1)
 *   }
 *
 * ROOT CAUSE. SQL `?{}` blocks are lowered at the STATEMENT level of a server-
 * function body (the per-statement sqlNode pass). An arrow / lambda body parses
 * as an OPAQUE escape-hatch whose raw text is emitted VERBATIM
 * (rewriteServerExprArrowBody) — the `?{...}` never reaches the SQL-lowering
 * pass, so it leaks into the emitted JS as invalid syntax. Pre-fix this surfaced
 * as E-CODEGEN-INVALID-LOGIC, telling the user to report a compiler bug for what is
 * actually a fixable source shape.
 *
 * FIX (Option B — diagnostic; correct lowering would require the unimplemented
 * structured-lambda-block-body feature + async propagation + caller-await, well
 * beyond this bug's locus). emit-server.ts detects a `?{`...`}` SQL block inside
 * an arrow / function-expression escape-hatch and raises E-SQL-009 with a
 * migration hint. The fatal error also suppresses the emitted-JS parse gate
 * (api.js Bug 70), so exactly ONE actionable diagnostic surfaces.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { resolve, dirname, join } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { Database } from "bun:sqlite";
import { compileScrml } from "../../src/api.js";
import { conciseArrowBodyHasSql } from "../../src/codegen/detect-sql-in-arrow.ts";

const testDir = dirname(new URL(import.meta.url).pathname);
const TMP_ROOT = resolve(testDir, "_tmp_sql_in_arrow");
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

describe("ss19 #12 — SQL inside an arrow body diagnoses precisely (not a compiler-defect leak)", () => {
  test("block-body arrow with ?{} → E-SQL-009, NOT E-CODEGEN-INVALID-LOGIC", () => {
    const { codes, errors } = compileSrc(
      WRAP(`    function doit() {
      const ins = (x) => { ?{\`INSERT INTO items (id) VALUES (\${x})\`}.run() }
      ins(1)
    }`),
      "block-arrow",
    );
    expect(codes).toContain("E-SQL-009");
    // The whole point: the generic "report a compiler bug" diagnostic must NOT
    // fire — the cause is a fixable source shape, surfaced by E-SQL-009 alone.
    expect(codes).not.toContain("E-CODEGEN-INVALID-LOGIC");
    const msg = errors.find((e) => e.code === "E-SQL-009")?.message ?? "";
    // The message must be actionable (name the move-to-server-function fix).
    expect(msg).toContain("server function");
  });

  test("migration: hoisting the SQL into a server function compiles clean", () => {
    const { codes } = compileSrc(
      WRAP(`    function ins(x) { ?{\`INSERT INTO items (id) VALUES (\${x})\`}.run() }
    function doit() { ins(1) }`),
      "migrated",
    );
    expect(codes.filter((c) => !c?.startsWith("W-"))).toEqual([]);
  });

  test("no false positive: ?{} at the STATEMENT level of a regular fn still works", () => {
    const { codes } = compileSrc(
      WRAP(`    function doit() {
      const rows = ?{\`SELECT id FROM items\`}.all()
      return { rows: rows }
    }`),
      "regular-fn",
    );
    expect(codes).not.toContain("E-SQL-009");
    expect(codes.filter((c) => !c?.startsWith("W-"))).toEqual([]);
  });

  test("no false positive: a SQL-free arrow callback compiles clean", () => {
    const { codes } = compileSrc(
      WRAP(`    function doit() {
      const rows = ?{\`SELECT id FROM items\`}.all()
      const ids = rows.map((r) => r.id)
      return { ids: ids }
    }`),
      "sql-free-arrow",
    );
    expect(codes).not.toContain("E-SQL-009");
    expect(codes.filter((c) => !c?.startsWith("W-"))).toEqual([]);
  });
});

/**
 * Issue #12 blast radius (S215-class adversarial completion). The S220 emit-server
 * detection caught BLOCK-body arrows only; a CONCISE / curried arrow body that
 * contains a `?{}` is missed there — these otherwise leak as E-CODEGEN-INVALID-LOGIC
 * (and, when the fn does not escalate to server, into the CLIENT bundle). The
 * post-AST detectSqlInConciseArrowBody pass (wired at TAB, api.js) closes the gap
 * by text-scanning the arrow's retained `.init` / `.expr` / `.raw` source.
 *
 * Case-A note (g-detect-sql-case-a-prune, 2026-06-27): the concise-direct (S5) and
 * concise-return (S11) shapes USED to be caught by a separate "Case A" sibling-pair
 * detector, because pre-ss50 the parser orphaned the `?{}` as a sibling `sql` node
 * (leaving the arrow's `.raw` without the SQL signature). The ss50 item-1 parser
 * fix (commit 2fca8075) now captures the full `?{}` into the arrow escape-hatch
 * `.raw`, so the SINGLE text-scan ("Case B") catches every shape below — including
 * S5/S11. Case A was proven dead (0 fires across the full suite + corpus) and
 * removed; these cases assert S5/S11 STILL error, now via the text scan.
 */
describe("ss19 #12 blast radius — CONCISE / curried arrow bodies diagnose precisely", () => {
  const cases = [
    ["concise-direct",       `    function doit() {\n      const ins = (x) => ?{\`INSERT INTO items (id) VALUES (\${x})\`}.run()\n      ins(1)\n    }`],
    ["concise-return",       `    function makeIns() {\n      return (x) => ?{\`INSERT INTO items (id) VALUES (\${x})\`}.run()\n    }\n    function doit() { makeIns()(1) }`],
    ["curried-nested",       `    function doit() {\n      const f = (a) => (b) => { ?{\`INSERT INTO items (id) VALUES (\${b})\`}.run() }\n      f(1)(2)\n    }`],
    ["curried-multistmt",    `    function doit() {\n      const f = (a) => (b) => { log(a); ?{\`INSERT INTO items (id) VALUES (\${b})\`}.run() }\n      f(1)(2)\n    }`],
    ["concise-in-map",       `    function doit() {\n      [1,2,3].map(x => ?{\`INSERT INTO items (id) VALUES (\${x})\`}.run())\n    }`],
  ];
  for (const [tag, body] of cases) {
    test(`${tag}: ?{} in a concise arrow body → E-SQL-009, NOT E-CODEGEN-INVALID-LOGIC`, () => {
      const { codes, errors } = compileSrc(WRAP(body), tag);
      expect(codes).toContain("E-SQL-009");
      expect(codes).not.toContain("E-CODEGEN-INVALID-LOGIC");
      // Exactly ONE E-SQL-009 (the concise pass + emit-server site stay disjoint).
      expect(codes.filter((c) => c === "E-SQL-009").length).toBe(1);
      const msg = errors.find((e) => e.code === "E-SQL-009")?.message ?? "";
      expect(msg).toContain("server function");
    });
  }

  test("no false positive: a SQL-free curried arrow compiles clean", () => {
    const { codes } = compileSrc(
      WRAP(`    function doit() {
      const add = (a) => (b) => a + b
      return { n: add(1)(2) }
    }`),
      "sql-free-curried",
    );
    expect(codes).not.toContain("E-SQL-009");
    expect(codes.filter((c) => !c?.startsWith("W-"))).toEqual([]);
  });

  // Unit-level guard on the body-extent scanner (the anchored SQL-opener check).
  describe("conciseArrowBodyHasSql — body-extent + anchored opener", () => {
    test("concise SQL body → true", () => {
      expect(conciseArrowBodyHasSql("( x ) => ?{`SELECT`}.all()")).toBe(true);
    });
    test("braced body (emit-server owns it) → false", () => {
      expect(conciseArrowBodyHasSql("( x ) => { ?{`SELECT`} }")).toBe(false);
    });
    test("SQL-free concise arrow → false", () => {
      expect(conciseArrowBodyHasSql("( x ) => x + 1")).toBe(false);
    });
    test("anchored: a non-opener `?{` in the body must NOT match a real opener PAST the body extent", () => {
      // A bare `.test(text.slice(k))` would over-reach the `;`-bounded body and
      // match the trailing opener → false E-SQL-009. The anchored check returns false.
      expect(conciseArrowBodyHasSql("( x ) => g(x?{a:1}:0) ; const q = ?{`SELECT`}")).toBe(false);
    });
    test("a real opener genuinely INSIDE the body (after a non-opener `?{`) → true", () => {
      expect(conciseArrowBodyHasSql("( x ) => ( x?{a:1}:?{`SELECT`}.all() )")).toBe(true);
    });
  });

  test("no false positive: a SQL-free concise arrow ADJACENT to a valid statement-level ?{}", () => {
    // A SQL-free concise arrow immediately followed by a legitimate statement-level
    // `?{}` must NOT fire E-SQL-009. (This was the orphaned-sibling shape the removed
    // Case A keyed on; the surviving text scan correctly leaves it clean because the
    // arrow's own retained text contains no `?{`…` opener.)
    const { codes } = compileSrc(
      WRAP(`    function doit() {
      const inc = (x) => x + 1
      ?{\`INSERT INTO items (id) VALUES (1)\`}.run()
      return { n: inc(1) }
    }`),
      "concise-arrow-adjacent-sql",
    );
    expect(codes).not.toContain("E-SQL-009");
    expect(codes.filter((c) => !c?.startsWith("W-"))).toEqual([]);
  });
});
