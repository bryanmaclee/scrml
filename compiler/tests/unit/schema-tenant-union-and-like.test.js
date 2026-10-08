/**
 * S450 — two `<schema>` tenant-floor rulings (bryan, S447 "stamp all"; ledger
 * scrml-support/user-voice-scrml.md §S447 "RULED — \"stamp all\"" item 4).
 *
 *   (i)  g-schema-commented-out-declaration-shadows-live-table — "commented-out
 *        `<schema>` copy: union over declarations + a loud diagnostic when same-name
 *        declarations disagree on `tenant_id` (new code)". The tenant floor reads the
 *        UNION of every same-name declaration (`extractDesiredSchema` `tenantTables`);
 *        same-name declarations that disagree on `tenant_id` are E-SCHEMA-015.
 *   (ii) g-schema-create-table-like-template-columns-not-declared — "`CREATE TABLE x
 *        (LIKE tmpl INCLUDING|EXCLUDING …)` = a template reference, fail closed
 *        (E-SCHEMA-014)". Inside a column list, `LIKE <name>` followed by `INCLUDING` |
 *        `EXCLUDING` | `,` | `)` is a template reference → E-SCHEMA-014 reason "like".
 *
 * Every REJECT case is silent (exit 0, no diagnostic) on the base (bc4bca1f).
 */
import { describe, test, expect, afterAll } from "bun:test";
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import {
  findRejectedCreateTableHeads,
  findTenantDeclarationDisagreements,
  schemaTableDeclarations,
} from "../../src/schema-differ.js";
import { extractDesiredSchema } from "../../src/codegen/db-authoritative.ts";

const _tmp = [];
afterAll(() => { for (const d of _tmp) { try { rmSync(d, { recursive: true, force: true }); } catch {} } });

const QUERY = `  \${
    @open = true
    function loadAssets() {
      const rows = ?{\`SELECT id, name, tenant_id FROM assets\`}.all()
      return rows
    }
  }`;

function compileApp(schemaText) {
  const dir = mkdtempSync(join(tmpdir(), "s450-schema-"));
  _tmp.push(dir);
  const db = join(dir, "app.db").replace(/\\/g, "/");
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
const errCodes = (r) => (r.errors ?? []).map((d) => d.code);
const schemaCodes = (r) => errCodes(r).filter((c) => /^E-SCHEMA-01[2-5]$/.test(c));
const tagged = (server) => /_scrml_tenant_scope\(await _scrml_sql/.test(server);

const WITH = "(id INTEGER PRIMARY KEY, name TEXT, tenant_id TEXT)";
const WITHOUT = "(id INTEGER PRIMARY KEY, name TEXT)";
const NOTES = "\n    CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)";

// ---------------------------------------------------------------------------
// (i) union + E-SCHEMA-015
// ---------------------------------------------------------------------------

describe("(i) same-name declarations that DISAGREE on tenant_id are E-SCHEMA-015", () => {
  const REJECTED = {
    // the shadow (first-wins, pre-ruling: tag=0, silent)
    "`--`-commented copy WITHOUT tenant_id before a live table WITH it":
      `    -- CREATE TABLE assets (id INTEGER)\n    CREATE TABLE assets ${WITH}`,
    "`/* */`-commented DSL copy WITHOUT tenant_id before a live raw table WITH it":
      `    /* assets { id: integer primary key } */\n    CREATE TABLE assets ${WITH}`,
    "`--`-commented DSL copy WITHOUT tenant_id before a live DSL table WITH it":
      "    -- assets { id: integer primary key }\n    assets {\n      id: integer primary key\n      tenant_id: text\n    }",
    // the over-scope a union alone would create (S446 review of #1209: SELECT * → [])
    "live table WITHOUT tenant_id, stale `--` copy WITH it after":
      `    CREATE TABLE assets ${WITHOUT}\n    -- old: CREATE TABLE assets ${WITH}`,
    "live table WITHOUT tenant_id, stale `/* */` copy WITH it after":
      `    CREATE TABLE assets ${WITHOUT}\n    /* CREATE TABLE assets ${WITH} */`,
    // live duplicates disagreeing (no comment involved)
    "two live raw declarations, case-insensitive names":
      `    CREATE TABLE assets ${WITHOUT}\n    CREATE TABLE ASSETS ${WITH}`,
    "a live DSL and a live raw declaration":
      `    assets {\n      id: integer primary key\n      name: text\n    }\n    CREATE TABLE assets ${WITH}`,
    // S450 fix round (S239 F1): a live head with a comment INSIDE it is read only by the
    // structured reader — it was keyed away behind a same-name legacy-readable copy.
    "A3: live head with a `/* */` inside, `--` copy WITHOUT tenant_id after (shadow)":
      `    CREATE TABLE assets /* live */ ${WITH}\n    -- CREATE TABLE assets ${WITHOUT}`,
    "A16: live head with a `--` comment between name and `(`, copy WITHOUT before (shadow)":
      `    -- CREATE TABLE assets ${WITHOUT}\n    CREATE TABLE assets -- live\n    ${WITH}`,
    "D1: live WITHOUT, head with a `/* */` inside, stale copy WITH after (over-scope)":
      `    CREATE TABLE assets /* live */ ${WITHOUT}\n    -- CREATE TABLE assets ${WITH}`,
    "D2: live WITHOUT, `--` comment in head, stale copy WITH before (over-scope)":
      `    -- CREATE TABLE assets ${WITH}\n    CREATE TABLE assets -- v2, tenant column dropped\n    ${WITHOUT}`,
    "B3: structured-only commented copy WITHOUT after a live WITH":
      `    CREATE TABLE assets ${WITH}\n    -- CREATE TABLE assets /*old*/ ${WITHOUT}`,
    "beside a second table":
      `    -- CREATE TABLE assets (id INTEGER)\n    CREATE TABLE assets ${WITH}${NOTES}`,
  };
  for (const [label, schema] of Object.entries(REJECTED)) {
    test(`REJECTED: ${label}`, () => {
      const { r } = compileApp(schema);
      expect(schemaCodes(r)).toEqual(["E-SCHEMA-015"]);
      const msg = (r.errors ?? []).find((d) => d.code === "E-SCHEMA-015").message;
      expect(msg).toMatch(/table `assets`/i);
      expect(msg).toContain("WITH it");
      expect(msg).toContain("WITHOUT it");
    });
  }

  test("the message says which declaration sits inside a comment", () => {
    const { r } = compileApp(`    CREATE TABLE assets ${WITHOUT}\n    -- old: CREATE TABLE assets ${WITH}`);
    const msg = (r.errors ?? []).find((d) => d.code === "E-SCHEMA-015").message;
    expect(msg).toMatch(/WITH it — `CREATE TABLE assets \(…\)` \(line \d+ of the `<schema>` body, inside a comment\)/);
    expect(msg).toMatch(/WITHOUT it — `CREATE TABLE assets \(…\)` \(line \d+ of the `<schema>` body\)/);
  });
});

describe("(i) declarations that AGREE on tenant_id are quiet; the floor reads their union", () => {
  test("a commented copy that AGREES (both WITH tenant_id) → no diagnostic, tenant-scoped", () => {
    const { r, server } = compileApp(`    -- CREATE TABLE assets (id INTEGER, tenant_id TEXT)\n    CREATE TABLE assets ${WITH}`);
    expect(r.errors ?? []).toEqual([]);
    expect(tagged(server)).toBe(true);
  });
  test("live + commented both WITHOUT tenant_id → unchanged: no diagnostic, not scoped", () => {
    const { r, server } = compileApp(`    -- CREATE TABLE assets (id INTEGER)\n    CREATE TABLE assets ${WITHOUT}`);
    expect(r.errors ?? []).toEqual([]);
    expect(tagged(server)).toBe(false);
  });
  test("a live head with a comment inside it, alone, is unchanged (scoped, no diagnostic)", () => {
    const a = compileApp(`    CREATE TABLE assets /* live */ ${WITH}`);
    expect(a.r.errors ?? []).toEqual([]);
    expect(tagged(a.server)).toBe(true);
    const b = compileApp(`    CREATE /*x*/ TABLE assets ${WITH}`);
    expect(b.r.errors ?? []).toEqual([]);
    expect(tagged(b.server)).toBe(true);
  });
  test("a string-embedded head is not a declaration (A10 control)", () => {
    const { r } = compileApp(`    CREATE TABLE notes (id INTEGER, body TEXT DEFAULT 'CREATE TABLE assets (id INTEGER)')\n    CREATE TABLE assets ${WITH}`);
    expect(r.errors ?? []).toEqual([]);
  });
  test("a single declaration is unchanged (WITH → scoped, WITHOUT → not)", () => {
    const a = compileApp(`    CREATE TABLE assets ${WITH}`);
    expect(a.r.errors ?? []).toEqual([]);
    expect(tagged(a.server)).toBe(true);
    const b = compileApp(`    CREATE TABLE assets ${WITHOUT}`);
    expect(b.r.errors ?? []).toEqual([]);
    expect(tagged(b.server)).toBe(false);
  });
  test("different tables never compare (assets WITH, notes WITHOUT)", () => {
    const { r } = compileApp(`    CREATE TABLE assets ${WITH}${NOTES}`);
    expect(r.errors ?? []).toEqual([]);
  });
});

describe("(i) reader level", () => {
  test("schemaTableDeclarations reads every declaration, duplicates and comments included", () => {
    const decls = schemaTableDeclarations(
      `-- CREATE TABLE assets (id INTEGER)\nCREATE TABLE assets ${WITH}\n/* assets { id: integer } */`,
    );
    expect(decls.map((d) => [d.key, d.form, d.tenant, d.commented])).toEqual([
      ["assets", "raw", false, true],
      ["assets", "raw", true, false],
      ["assets", "declarative", false, true],
    ]);
  });
  test("findTenantDeclarationDisagreements: disagree → one entry; agree → none", () => {
    const dis = findTenantDeclarationDisagreements(`CREATE TABLE assets ${WITHOUT}\n-- CREATE TABLE assets ${WITH}`);
    expect(dis.length).toBe(1);
    expect(dis[0].withTenant.length).toBe(1);
    expect(dis[0].withoutTenant.length).toBe(1);
    expect(findTenantDeclarationDisagreements(`-- CREATE TABLE assets ${WITH}\nCREATE TABLE assets ${WITH}`)).toEqual([]);
    expect(findTenantDeclarationDisagreements(`-- CREATE TABLE assets ${WITHOUT}\nCREATE TABLE assets ${WITHOUT}`)).toEqual([]);
  });
  test("a raw declaration with no readable column is not a declaration (as for the floor)", () => {
    expect(findTenantDeclarationDisagreements(`CREATE TABLE assets ()\nCREATE TABLE assets ${WITH}`)).toEqual([]);
  });

  const ast = (body) => ({ kind: "program", children: [{ kind: "state", stateType: "schema", children: [{ kind: "text", value: body }] }] });
  test("extractDesiredSchema: `tenantTables` is the union; `tables` (db-migrate) stays first-wins", () => {
    const x = extractDesiredSchema(ast(`-- CREATE TABLE assets (id INTEGER)\nCREATE TABLE assets ${WITH}`));
    const first = x.tables.find((t) => t.name === "assets");
    expect(first.columns.map((c) => c.name)).toEqual(["id"]);
    const union = x.tenantTables.find((t) => t.name === "assets");
    expect(union.columns.map((c) => c.name)).toEqual(["id", "name", "tenant_id"]);
  });
  test("extractDesiredSchema: a DSL table's union includes a raw same-name declaration", () => {
    const x = extractDesiredSchema(ast(`/* assets { id: integer primary key } */\nCREATE TABLE assets ${WITH}`));
    expect(x.tables.find((t) => t.name === "assets").columns.map((c) => c.name)).toEqual(["id"]);
    expect(x.tenantTables.find((t) => t.name === "assets").columns.map((c) => c.name))
      .toEqual(["id", "name", "tenant_id"]);
  });
});

// ---------------------------------------------------------------------------
// (ii) LIKE <template> → E-SCHEMA-014
// ---------------------------------------------------------------------------

const TMPL = `    CREATE TABLE tmpl ${WITH}\n`;

describe("(ii) a `LIKE <template>` item in a column list is E-SCHEMA-014", () => {
  const REJECTED = {
    "LIKE tmpl INCLUDING ALL": `${TMPL}    CREATE TABLE assets (LIKE tmpl INCLUDING ALL)`,
    "LIKE tmpl EXCLUDING CONSTRAINTS": `${TMPL}    CREATE TABLE assets (LIKE tmpl EXCLUDING CONSTRAINTS)`,
    "lowercase like tmpl including defaults": `${TMPL}    create table assets (like tmpl including defaults)`,
    "bare LIKE tmpl (closed by `)`)": `${TMPL}    CREATE TABLE assets (LIKE tmpl)`,
    "after a column (closed by `)`)": `${TMPL}    CREATE TABLE assets (extra TEXT, LIKE tmpl)`,
    "before a column (closed by `,`)": `${TMPL}    CREATE TABLE assets (LIKE tmpl, extra TEXT)`,
    "a qualified template": `${TMPL}    CREATE TABLE assets (LIKE public.tmpl INCLUDING ALL)`,
    "a quoted template": `${TMPL}    CREATE TABLE assets (LIKE "tmpl" INCLUDING ALL)`,
    "multi-line, two options": `${TMPL}    CREATE TABLE assets (\n      LIKE tmpl\n        INCLUDING DEFAULTS\n        EXCLUDING INDEXES\n    )`,
    // `like TEXT` is the same token shape as `LIKE tmpl` — by the ruling, the template
    // reference (base skipped it as one: no `like` column was ever declared).
    "an unquoted `like TEXT` item (the template-reference shape)":
      `    CREATE TABLE assets (id INTEGER PRIMARY KEY, like TEXT, tenant_id TEXT)`,
  };
  for (const [label, schema] of Object.entries(REJECTED)) {
    test(`REJECTED: ${label}`, () => {
      const { r } = compileApp(schema);
      expect(schemaCodes(r)).toEqual(["E-SCHEMA-014"]);
      expect((r.errors ?? []).find((d) => d.code === "E-SCHEMA-014").message).toContain("`LIKE <template>`");
    });
  }

  const ACCEPTED = {
    "a quoted column named like": `    CREATE TABLE assets (id INTEGER PRIMARY KEY, "like" TEXT, tenant_id TEXT)`,
    "a bracket-quoted column named like": `    CREATE TABLE assets (id INTEGER PRIMARY KEY, [like] TEXT, tenant_id TEXT)`,
    "a column named like with a type and a constraint": `    CREATE TABLE assets (id INTEGER PRIMARY KEY, like TEXT NOT NULL, tenant_id TEXT)`,
    "a column named like with a parenthesized type": `    CREATE TABLE assets (id INTEGER PRIMARY KEY, like VARCHAR(50), tenant_id TEXT)`,
    "a column whose name starts with like": `    CREATE TABLE assets (id INTEGER PRIMARY KEY, likeness TEXT, tenant_id TEXT)`,
    "LIKE inside a CHECK expression": `    CREATE TABLE assets (id INTEGER PRIMARY KEY, name TEXT CHECK (name LIKE 'a%'), tenant_id TEXT)`,
    "LIKE inside a `--` comment in the column list": `    CREATE TABLE assets (id INTEGER PRIMARY KEY, -- LIKE tmpl\n      name TEXT, tenant_id TEXT)`,
  };
  for (const [label, schema] of Object.entries(ACCEPTED)) {
    test(`ACCEPTED: ${label}`, () => {
      const { r, server } = compileApp(schema);
      expect(r.errors ?? []).toEqual([]);
      expect(tagged(server)).toBe(true);
    });
  }

  test("reader level: reason \"like\", kind not-a-declaration", () => {
    const hs = findRejectedCreateTableHeads("CREATE TABLE assets (LIKE tmpl INCLUDING ALL)");
    expect(hs.map((h) => [h.kind, h.reason, h.name])).toEqual([["not-a-declaration", "like", "assets"]]);
    expect(findRejectedCreateTableHeads(`CREATE TABLE assets (id INTEGER, "like" TEXT)`)).toEqual([]);
  });
  test("reader level: a commented-out LIKE head is not reported (the E-SCHEMA-012 exemption)", () => {
    expect(findRejectedCreateTableHeads("-- CREATE TABLE assets (LIKE tmpl)\nCREATE TABLE b (id INTEGER)")).toEqual([]);
  });
});
