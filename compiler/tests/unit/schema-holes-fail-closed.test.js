/**
 * S446 — the `<schema>` holes that fed the §14.8.10 tenant floor, closed fail-closed
 * (bryan RULED S440 #15: "fix in TS, fail closed").
 *
 *   1. g-schema-create-temp-table-silently-not-a-declaration — `CREATE TEMP TABLE …`
 *      declared nothing; beside a second table the floor was inert with NO
 *      diagnostic. → E-SCHEMA-014.
 *   2. g-schema-dsl-qualified-table-head-silently-stripped — `mydb.public.assets { … }`
 *      was accepted as `assets`; `a.assets` + `b.assets` collapsed, first-wins,
 *      dropping the `tenant_id` one. → E-SCHEMA-012 (and E-SCHEMA-013 for the same
 *      slide into any other glued token: `données {` was read as `es`).
 *   3. g-schema-commented-out-declaration-shadows-live-table — a commented-out
 *      `tenant_id`-less copy (raw or DSL) won first-wins. → the tenant floor reads
 *      EVERY same-name declaration, unioned (only adds floor).
 *   4. g-schema-no-column-list-heads-declare-nothing — `OF type` / `PARTITION OF` /
 *      `AS query` / `USING` / `INHERITS` / an unclosed column list declared no
 *      columns. → E-SCHEMA-014.
 *
 * Every compile-level REJECT / TAG case here is red on the base (8b87ce2e).
 */
import { describe, test, expect, afterAll } from "bun:test";
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { extractDesiredSchema } from "../../src/codegen/db-authoritative.ts";
import { findRejectedCreateTableHeads, findGluedDslTableHeads } from "../../src/schema-differ.js";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";

const _tmp = [];
afterAll(() => { for (const d of _tmp) { try { rmSync(d, { recursive: true, force: true }); } catch {} } });

const QUERY = `  \${
    @open = true
    function loadAssets() {
      const rows = ?{\`SELECT id, name, tenant_id FROM assets\`}.all()
      return rows
    }
  }`;

function compileApp(schemaText, dbUrl) {
  const dir = mkdtempSync(join(tmpdir(), "s446-schema-"));
  _tmp.push(dir);
  const db = dbUrl ?? join(dir, "app.db").replace(/\\/g, "/");
  const file = join(dir, "app.scrml");
  writeFileSync(file, `<program db="${db}">
  <schema>
${schemaText}
  </schema>
${QUERY}
  <page>
    <button onclick=loadAssets()>Load</button>
  </page>
</program>`);
  const outDir = join(dir, "out");
  const r = compileScrml({ inputFiles: [file], write: true, outputDir: outDir, log: () => {} });
  let server = "";
  try { server = readFileSync(join(outDir, "app.server.js"), "utf8"); } catch {}
  return { r, server };
}
const all = (r) => [...(r.errors ?? []), ...(r.warnings ?? [])].map((d) => d.code);
const schemaCodes = (r) => (r.errors ?? []).map((d) => d.code).filter((c) => /^E-SCHEMA-01[234]$/.test(c));
const tagged = (server) => /_scrml_tenant_tag\(await _scrml_sql/.test(server);

const C = "(id INTEGER PRIMARY KEY, name TEXT, tenant_id TEXT)";
const NOTES = "\n    CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)";
const DSL_ASSETS = "    assets {\n      id: integer primary key\n      name: text\n      tenant_id: text\n    }";

describe("gap 1 + gap 4 — a head that is not a plain table declaration is E-SCHEMA-014", () => {
  const REJECTED = {
    // gap 1 — table-kind modifiers, every case / spelling
    "TEMP": `    CREATE TEMP TABLE assets ${C}${NOTES}`,
    "TEMP alone (no W-SCHEMA-NO-TABLES-DECLARED cascade)": `    CREATE TEMP TABLE assets ${C}`,
    "temporary, lowercase": `    create temporary table assets ${C}${NOTES}`,
    "Mixed Case": `    Create Temp Table assets ${C}${NOTES}`,
    "TEMP IF NOT EXISTS": `    CREATE TEMP TABLE IF NOT EXISTS assets ${C}${NOTES}`,
    "temp if not exists, quoted name": `    create temp table if not exists "assets" ${C}${NOTES}`,
    "TEMP, backtick name": "    CREATE TEMP TABLE `assets` " + C + NOTES,
    "UNLOGGED": `    CREATE UNLOGGED TABLE assets ${C}${NOTES}`,
    "GLOBAL TEMPORARY": `    CREATE GLOBAL TEMPORARY TABLE assets ${C}${NOTES}`,
    "comments between CREATE / TEMP / TABLE": `    CREATE /* x */ TEMP -- y\n    TABLE assets ${C}${NOTES}`,
    "second statement after `;`": `    CREATE TABLE notes (id INTEGER PRIMARY KEY); CREATE TEMP TABLE assets ${C};`,
    // gap 4 — no column list the floors can read
    "VIRTUAL … USING fts5": `    CREATE VIRTUAL TABLE assets USING fts5(id, name, tenant_id)${NOTES}`,
    "OF type": `    CREATE TABLE assets OF asset_t${NOTES}`,
    "of type, lowercase": `    create table assets of asset_t${NOTES}`,
    "PARTITION OF": `    CREATE TABLE assets PARTITION OF parent DEFAULT${NOTES}`,
    "AS SELECT": `    CREATE TABLE assets AS SELECT 1 AS id, 'x' AS tenant_id${NOTES}`,
    "IF NOT EXISTS … AS": `    CREATE TABLE IF NOT EXISTS assets AS SELECT 1 AS tenant_id${NOTES}`,
    "quoted name … AS": `    CREATE TABLE "assets" AS SELECT 1 AS tenant_id${NOTES}`,
    "WITH (…) AS": `    CREATE TABLE assets WITH (fillfactor = 70) AS SELECT 1${NOTES}`,
    "INHERITS after the column list": `    CREATE TABLE parent ${C}\n    CREATE TABLE assets (extra TEXT) INHERITS (parent)${NOTES}`,
    "INHERITS after a comment": `    CREATE TABLE parent ${C}\n    CREATE TABLE assets (x TEXT) /* c */ INHERITS (parent)${NOTES}`,
    "an unclosed column list": `    CREATE TABLE assets (id INTEGER, tenant_id TEXT${NOTES}`,
    // string / comment awareness: a comment-lookalike in a literal does NOT hide a later head
    "after a '/*' in a quoted SQL default": `    CREATE TABLE notes (id INTEGER PRIMARY KEY, d TEXT DEFAULT '/* x')\n    CREATE TEMP TABLE assets ${C}`,
    "after a DSL default(\"/api/*\")": `    rules {\n      id: integer primary key\n      g: text default("/api/*")\n    }\n    CREATE TEMP TABLE assets ${C}`,
    "after a DSL default(\"--\")": `    m {\n      id: integer primary key\n      d: text default("--")\n    }\n    CREATE TEMPORARY TABLE assets ${C}`,
  };
  for (const [label, schema] of Object.entries(REJECTED)) {
    test(`REJECTED: ${label}`, () => {
      const { r } = compileApp(schema);
      expect(schemaCodes(r)).toEqual(["E-SCHEMA-014"]);
      expect(all(r)).not.toContain("W-SCHEMA-NO-TABLES-DECLARED");
    });
  }

  test("the message names the reason and the fix", () => {
    const m = (s) => compileApp(s).r.errors.find((d) => d.code === "E-SCHEMA-014").message;
    expect(m(`    CREATE TEMP TABLE assets ${C}`)).toContain("`TEMP`");
    expect(m(`    CREATE TEMP TABLE assets ${C}`)).toContain("CREATE TABLE assets (…columns…)");
    expect(m(`    CREATE TABLE assets OF t`)).toContain("no column list");
    expect(m(`    CREATE TABLE p ${C}\n    CREATE TABLE assets (x TEXT) INHERITS (p)`)).toContain("INHERITS");
  });

  test("a qualified modified head stays ONE error — E-SCHEMA-012, not also 014", () => {
    expect(findRejectedCreateTableHeads(`CREATE TEMP TABLE temp.assets ${C}`).map((h) => h.kind)).toEqual(["qualified"]);
  });

  const ACCEPTED = {
    "plain": `    CREATE TABLE assets ${C}`,
    "quoted": `    CREATE TABLE "assets" ${C}`,
    "bracketed, if not exists, lowercase": `    create table if not exists [assets] ${C}`,
    "WITHOUT ROWID / STRICT after the column list": `    CREATE TABLE assets ${C} WITHOUT ROWID${NOTES} STRICT`,
    "PARTITION BY + WITH after the column list": `    CREATE TABLE assets ${C} PARTITION BY RANGE (id) WITH (fillfactor = 70)`,
    "several statements with `;`": `    CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT); CREATE TABLE assets ${C};`,
    "`--` inside a quoted default": `    CREATE TABLE assets (id INTEGER PRIMARY KEY, d TEXT DEFAULT '-- x', name TEXT, tenant_id TEXT)${NOTES}`,
    "a TEMP head inside a quoted default": `    CREATE TABLE assets (id INTEGER PRIMARY KEY, name TEXT, d TEXT DEFAULT 'CREATE TEMP TABLE x (a)', tenant_id TEXT)`,
    "a `--`-commented TEMP head": `    CREATE TABLE assets ${C}\n    -- CREATE TEMP TABLE scratch (id INTEGER)`,
    "a `/* */`-commented CTAS": `    CREATE TABLE assets ${C}\n    /* CREATE TABLE snap AS SELECT * FROM assets */`,
    "INHERITS only inside a trailing comment": `    CREATE TABLE assets ${C} -- INHERITS (base) later\n    CREATE TABLE notes (id INTEGER PRIMARY KEY)`,
  };
  for (const [label, schema] of Object.entries(ACCEPTED)) {
    test(`ACCEPTED: ${label}`, () => {
      const { r, server } = compileApp(schema);
      expect(schemaCodes(r)).toEqual([]);
      expect(tagged(server)).toBe(true);
    });
  }
});

describe("E-SCHEMA-014 inside a SECURITY-DEFINER `fn` `\"\"\"` body — runtime plpgsql, NOT rejected (narrow)", () => {
  const PG = "postgres://u:p@127.0.0.1:1/x";
  const withFn = (fnText) => `    invoices {
      id: text primary key
      tenant_id: text not null
    } db-authoritative
${fnText}
${DSL_ASSETS}`;
  const realFn = (sql) => `    fn stage(id: uuid) security definer owner(invoice_admin) {
      """
      ${sql}
      """
    }`;

  test("TEMP / CTAS / PARTITION OF inside a parser-accepted fn body are silent", () => {
    for (const sql of [
      "CREATE TEMP TABLE staging ON COMMIT DROP AS SELECT * FROM invoices;",
      "CREATE TEMPORARY TABLE s2 (id INTEGER, tenant_id TEXT);",
      "CREATE TABLE archived PARTITION OF invoices DEFAULT;",
    ]) {
      const { r } = compileApp(withFn(realFn(sql)), PG);
      expect(schemaCodes(r)).toEqual([]);
    }
  });

  const STILL = {
    "a `--`-commented fn wrapper forges nothing": `    -- fn f() owner(r) {\n    CREATE TEMP TABLE assets2 ${C}\n    -- }`,
    "a `/* */`-commented fn wrapper forges nothing": `    /* fn f() owner(r) { """ */\n    CREATE TEMP TABLE assets2 ${C}\n    /* """ } */`,
    "a braceless fn: the head is in its modifier run, not a body": `    fn f() owner(r)\n    CREATE TEMP TABLE assets2 ${C}\n    notes { id: text primary key }`,
    "inside the fn braces but OUTSIDE the \"\"\" pair": `    fn f() owner(r) { """select 1""" CREATE TEMP TABLE assets2 ${C} }`,
    "a word-glued `xfn` is not a fn": `    xfn f() owner(r) {\n      """\n      CREATE TEMP TABLE assets2 ${C};\n      """\n    }`,
  };
  for (const [label, fnText] of Object.entries(STILL)) {
    test(`STILL REJECTED: ${label}`, () => {
      const { r } = compileApp(withFn(fnText), PG);
      expect(schemaCodes(r)).toContain("E-SCHEMA-014");
    });
  }

  test("E-SCHEMA-012 is NOT exempted in a fn body (unchanged, g-secdef-fn-body-ddl-false-positive)", () => {
    const { r } = compileApp(withFn(realFn("CREATE TABLE IF NOT EXISTS audit.snap (id uuid, tenant_id uuid);")), PG);
    expect(schemaCodes(r)).toEqual(["E-SCHEMA-012"]);
  });
});

describe("gap 2 — a DSL head slid into from a longer token is rejected, not renamed", () => {
  const T = "{\n      id: integer primary key\n      tenant_id: text\n    }";
  const CASES = {
    "two qualifiers": [`    mydb.public.assets ${T}`, "E-SCHEMA-012"],
    "spaces around the dot": [`    mydb . assets ${T}${NOTES}`, "E-SCHEMA-012"],
    "a comment before the dot": [`    mydb /* x */ . assets ${T}${NOTES}`, "E-SCHEMA-012"],
    "a quoted qualifier": [`    "mydb".assets ${T}${NOTES}`, "E-SCHEMA-012"],
    "after a DSL string holding `//`": [`    links {\n      id: integer primary key\n      u: text default("https://x")\n    }\n    a.assets ${T}`, "E-SCHEMA-012"],
    "non-ASCII letter (données → `es`)": [`    données ${T}\n${DSL_ASSETS}`, "E-SCHEMA-013"],
    "hyphen": [`    my-assets ${T}${NOTES}`, "E-SCHEMA-013"],
    "`$`": [`    app$assets ${T}${NOTES}`, "E-SCHEMA-013"],
  };
  for (const [label, [schema, code]] of Object.entries(CASES)) {
    test(`REJECTED (${code}): ${label}`, () => {
      const { r } = compileApp(schema);
      expect(schemaCodes(r)).toContain(code);
    });
  }

  test("a.assets + b.assets: BOTH reported, and the floor is ENGAGED (was: tag=0, exit 0, no diagnostic)", () => {
    const { r, server } = compileApp(
      `    a.assets {\n      id: integer primary key\n      name: text\n    }\n    b.assets {\n      id: integer primary key\n      tenant_id: text\n    }`,
    );
    expect(schemaCodes(r)).toEqual(["E-SCHEMA-012", "E-SCHEMA-012"]);
    expect(tagged(server)).toBe(true);
  });

  const ACCEPTED = {
    "adjacent tables `}assets {`": `    notes {\n      id: integer primary key\n    }assets {\n      id: integer primary key\n      name: text\n      tenant_id: text\n    }`,
    "a db-authoritative table before": `    notes {\n      id: integer primary key\n    } db-authoritative\n${DSL_ASSETS}`,
    "digits / underscore in names": `    t_2 {\n      id: integer primary key\n    }\n${DSL_ASSETS}`,
    "a `--`-commented qualified head": `    -- mydb.assets { id: integer primary key }\n${DSL_ASSETS}`,
    "a regex with `\\.` and `{2,}` in a column": `    hosts {\n      id: integer primary key\n      h: text pattern(/^[a-z]+\\.[a-z]{2,}$/)\n    }\n${DSL_ASSETS}`,
  };
  for (const [label, schema] of Object.entries(ACCEPTED)) {
    test(`ACCEPTED: ${label}`, () => {
      const { r, server } = compileApp(schema);
      expect(schemaCodes(r)).toEqual([]);
      expect(tagged(server)).toBe(true);
    });
  }

  test("reader level: a quoted SQL string holding `a.b{2}` is not a glued head", () => {
    expect(findGluedDslTableHeads("CREATE TABLE t (x TEXT CHECK (x ~ 'a.b{2}'))")).toEqual([]);
  });
});

describe("gap 3 — a commented-out declaration no longer shadows the live `tenant_id` table", () => {
  const SHAPES = {
    "raw `--` copy before raw live": `    -- CREATE TABLE assets (id INTEGER)\n    CREATE TABLE assets ${C}`,
    "raw `/* */` copy before raw live": `    /* CREATE TABLE assets (id INTEGER) */\n    CREATE TABLE assets ${C}`,
    "DSL `/* */` copy before raw live": `    /* assets { id: integer primary key } */\n    CREATE TABLE assets ${C}`,
    "multi-line DSL `/* */` copy before raw live": `    /* assets {\n      id: integer primary key\n    } */\n    CREATE TABLE assets ${C}`,
    "DSL `--` copy before DSL live": `    -- assets { id: integer primary key }\n${DSL_ASSETS}`,
    "case variant: `--` ASSETS before live assets": `    -- create table ASSETS (id integer)\n    CREATE TABLE assets ${C}`,
  };
  for (const [label, schema] of Object.entries(SHAPES)) {
    test(`TAGGED: ${label}`, () => {
      const { r, server } = compileApp(schema);
      expect(schemaCodes(r)).toEqual([]);
      expect(tagged(server)).toBe(true);
    });
  }

  test("the migrate view (`tables`) is UNCHANGED — first-wins; only the tenant view unions", () => {
    const ast = buildAST(splitBlocks("t.scrml", `<program db="./x.db">
  <schema>
    /* assets { id: integer primary key } */
    CREATE TABLE assets ${C}
  </schema>
</program>`)).ast;
    const d = extractDesiredSchema(ast);
    expect(d.tables.map((t) => t.name)).toEqual(["assets"]);
    expect(d.tables[0].rawDdl).toBeUndefined();          // the DSL (commented) copy still wins for migrate
    expect(d.tenantDecls.some((t) => t.columns.some((c) => c.name === "tenant_id"))).toBe(true);
    for (const t of d.tables) expect(d.tenantDecls).toContain(t);   // tables ⊆ tenantDecls
  });

  test("no over-fire: a table no declaration gives `tenant_id` stays unscoped", () => {
    const { server } = compileApp(`    -- CREATE TABLE assets (id INTEGER)\n    CREATE TABLE assets (id INTEGER PRIMARY KEY, name TEXT)`);
    expect(tagged(server)).toBe(false);
  });
});
