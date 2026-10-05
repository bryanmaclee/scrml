/**
 * §14.8.10 — E-TENANT-SCHEMA-HAZARD (S455, ruling:user-voice-scrml.md S455 "go, comp-time schema").
 *
 * The tenant floor scopes each QUERY. It cannot scope SQL the database runs on its
 * own — a trigger or rule body, a view's definition, a foreign-key action. Four
 * review rounds (S452 r1–r4) patched per-statement classification and the reviewer
 * found the next spelling each time; the r4 residuals, REPRODUCED on bade5cb9d
 * against a real bun:sqlite file with two seeded tenants (progress.md):
 *
 *   H1   `CREATE TRIGGER t_cfg AFTER INSERT ON config BEGIN UPDATE assets …; END`
 *        → tenant A's INSERT INTO config rewrote BOTH tenants' assets.
 *   H2   `CREATE VIEW va AS SELECT id, name FROM assets` + an INSTEAD OF UPDATE
 *        trigger on `va` → A's `UPDATE va … WHERE id = 2` rewrote B's row.
 *   M1   `assets.cfg REFERENCES config(k) ON DELETE CASCADE` → compiled clean
 *        (inert on SQLite only because the server never enables foreign keys).
 *   VIEW `CREATE VIEW all_assets AS SELECT * FROM assets` → A read B's rows.
 *
 * The boundary is now the SCHEMA: such a declaration is a compile error where it
 * is declared, whatever the program's queries do. These tests pin the checker
 * (`compiler/src/tenant-schema-hazards.ts`), its GCP1 wiring, and the codegen
 * supplement for a table only the `<db>` registry makes tenant-scoped.
 */
import { describe, test, expect, afterAll } from "bun:test";
import { writeFileSync, mkdtempSync, rmSync, mkdirSync, symlinkSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { Database } from "bun:sqlite";
import {
  findSchemaTenantHazards,
  schemaTenantTableNames,
  schemaHazardMessage,
} from "../../src/tenant-schema-hazards.ts";
import { compileScrml } from "../../src/api.js";

const BT = "`";
const w = (s) => `?{${BT}${s}${BT}}`;
const body = (...stmts) => "\n" + stmts.map((s) => `    ${s.startsWith("--") || s.startsWith("/*") || /^\w+ \{/.test(s) ? s : w(s)}`).join("\n") + "\n  ";
const ASSETS = "CREATE TABLE assets (id INTEGER PRIMARY KEY, name TEXT, cost INTEGER, tenant_id TEXT)";
const ORDERS = "CREATE TABLE orders (id INTEGER PRIMARY KEY, asset_id INTEGER, label TEXT, tenant_id TEXT)";
const CONFIG = "CREATE TABLE config (k TEXT PRIMARY KEY, v TEXT)";
const hazards = (...stmts) => {
  const b = body(...stmts);
  return findSchemaTenantHazards(b, schemaTenantTableNames([b]));
};
const kinds = (hs) => hs.map((h) => `${h.kind}:${h.object}${h.unattributable ? ":unattributable" : ""}`);

describe("schemaTenantTableNames — the §14.8.10 tenant_id convention, read like the floor", () => {
  test("raw and DSL declarations; any declaration carrying tenant_id scopes the table", () => {
    expect([...schemaTenantTableNames([body(ASSETS, CONFIG, "notes { id: integer primary key\n tenant_id: text }")])].sort())
      .toEqual(["assets", "notes"]);
  });
  test("no tenant table → the checker charges nothing, whatever the schema declares", () => {
    expect(hazards(CONFIG, "CREATE VIEW v AS SELECT * FROM config",
      "CREATE TRIGGER t AFTER INSERT ON config FOR EACH ROW EXECUTE FUNCTION f()")).toEqual([]);
  });
});

describe("(1) triggers", () => {
  test("H1 — a trigger on a NON-tenant table whose body writes a tenant table", () => {
    const hs = hazards(ASSETS, CONFIG, "CREATE TRIGGER t_cfg AFTER INSERT ON config BEGIN UPDATE assets SET name = 'pwned'; END");
    expect(kinds(hs)).toEqual(["trigger:t_cfg"]);
    expect(hs[0].tables).toEqual(["assets"]);
    expect(hs[0].why).toContain("its body names `assets`");
  });
  test("a trigger declared ON a tenant table (any body)", () => {
    const hs = hazards(ASSETS, "CREATE TRIGGER t_upd BEFORE UPDATE ON assets BEGIN SELECT 1; END");
    expect(kinds(hs)).toEqual(["trigger:t_upd"]);
    expect(hs[0].why).toContain("declared on the tenant-scoped table `assets`");
  });
  test("H2 — an INSTEAD OF trigger on a view over a tenant table (the view is charged too)", () => {
    const hs = hazards(ASSETS, "CREATE VIEW va AS SELECT id, name FROM assets",
      "CREATE TRIGGER t_v INSTEAD OF UPDATE ON va BEGIN UPDATE assets SET name = NEW.name WHERE id = NEW.id; END");
    expect(kinds(hs)).toEqual(["view:va", "trigger:t_v", "trigger:t_v"]);
    expect(hs[1].why).toContain("declared on `va`, a view over a tenant-scoped table");
  });
  test("a trigger body that only READS a tenant table into a shared one is charged (it copies every tenant's rows)", () => {
    const hs = hazards(ASSETS, CONFIG, "CREATE TABLE audit (msg TEXT)",
      "CREATE TRIGGER t_copy AFTER INSERT ON config BEGIN INSERT INTO audit (msg) SELECT name FROM assets; END");
    expect(kinds(hs)).toEqual(["trigger:t_copy"]);
  });
  test("a CASE … END inside the body does not end it early", () => {
    const hs = hazards(ASSETS, CONFIG,
      "CREATE TRIGGER t AFTER INSERT ON config BEGIN UPDATE config SET v = CASE WHEN 1 THEN 'a' END; UPDATE assets SET cost = 0; END");
    expect(kinds(hs)).toEqual(["trigger:t"]);
  });
  test("MySQL `FOR EACH ROW <statement>` body", () => {
    expect(kinds(hazards(ASSETS, CONFIG, "CREATE TRIGGER t AFTER INSERT ON config FOR EACH ROW UPDATE assets SET cost = 0")))
      .toEqual(["trigger:t"]);
  });
});

describe("(2) Postgres rules", () => {
  test("a rule whose action writes a tenant table", () => {
    expect(kinds(hazards(ASSETS, CONFIG, "CREATE RULE r AS ON INSERT TO config DO ALSO UPDATE assets SET name = 'x'")))
      .toEqual(["rule:r"]);
  });
  test("a rule declared ON a tenant table", () => {
    expect(kinds(hazards(ASSETS, "CREATE OR REPLACE RULE r2 AS ON DELETE TO assets DO INSTEAD NOTHING"))).toEqual(["rule:r2"]);
  });
});

describe("(3) foreign keys with CASCADE / SET NULL / SET DEFAULT, either end tenant-scoped", () => {
  test("M1 — the tenant table is the CHILD (a non-tenant parent's delete fans out across tenants)", () => {
    const hs = hazards(CONFIG, "CREATE TABLE assets (id INTEGER PRIMARY KEY, cfg TEXT REFERENCES config(k) ON DELETE CASCADE, tenant_id TEXT)");
    expect(hs.map((h) => h.kind)).toEqual(["foreign key"]);
    expect(hs[0].object).toContain("on `assets`");
    expect(hs[0].object).toContain("ON DELETE CASCADE");
  });
  test("the tenant table is the PARENT (SET NULL / SET DEFAULT / ON UPDATE CASCADE; table-level and ALTER TABLE forms)", () => {
    expect(hazards(ASSETS, "CREATE TABLE notes (id INTEGER, aid INTEGER REFERENCES assets(id) ON DELETE SET NULL)")).toHaveLength(1);
    expect(hazards(ASSETS, "CREATE TABLE notes (id INTEGER, aid INTEGER, FOREIGN KEY (aid) REFERENCES assets(id) ON UPDATE SET DEFAULT)")).toHaveLength(1);
    expect(hazards(ASSETS, "ALTER TABLE notes ADD CONSTRAINT fk FOREIGN KEY (aid) REFERENCES assets(id) ON UPDATE CASCADE")).toHaveLength(1);
  });
  test("RESTRICT / NO ACTION / no action, and cascades between non-tenant tables, are not hazards", () => {
    expect(hazards(ASSETS, "CREATE TABLE notes (aid INTEGER REFERENCES assets(id) ON DELETE RESTRICT ON UPDATE NO ACTION)")).toEqual([]);
    expect(hazards(ASSETS, "CREATE TABLE notes (aid INTEGER REFERENCES assets(id))")).toEqual([]);
    expect(hazards(ASSETS, CONFIG, "CREATE TABLE notes (k TEXT REFERENCES config(k) ON DELETE CASCADE)")).toEqual([]);
  });
  test("an action the checker cannot tie to a declaring table is charged (unattributable)", () => {
    const hs = hazards(ASSETS, "REFERENCES config(k) ON DELETE CASCADE");
    expect(hs.map((h) => h.unattributable)).toEqual([true]);
    expect(hs[0].tables).toEqual(["assets"]);
  });
});

describe("(4) views", () => {
  test("VIEW — a view that reads a tenant table", () => {
    const hs = hazards(ASSETS, "CREATE VIEW all_assets AS SELECT * FROM assets");
    expect(kinds(hs)).toEqual(["view:all_assets"]);
  });
  test("through another view, and materialized / temp / IF NOT EXISTS / column-list spellings", () => {
    expect(kinds(hazards(ASSETS, "CREATE VIEW v1 AS SELECT id FROM assets", "CREATE VIEW v2 AS SELECT * FROM v1")))
      .toEqual(["view:v1", "view:v2"]);
    expect(kinds(hazards(ASSETS, "CREATE MATERIALIZED VIEW mv AS SELECT count(*) FROM assets"))).toEqual(["view:mv"]);
    expect(kinds(hazards(ASSETS, "CREATE TEMP VIEW IF NOT EXISTS tv (a) AS SELECT id FROM main.assets"))).toEqual(["view:tv"]);
  });
  test("a tenant table named only inside a string literal still counts (query_to_xml)", () => {
    const hs = hazards(ASSETS, "CREATE VIEW v AS SELECT lower('select * from assets') AS x");
    expect(kinds(hs)).toEqual(["view:v"]);
  });
  test("a view over non-tenant tables only is fine", () => {
    expect(hazards(ASSETS, CONFIG, "CREATE VIEW cfg_view AS SELECT k, lower(v) AS v FROM config")).toEqual([]);
  });
});

describe("fail-closed — what the checker cannot attribute is charged, never treated as safe", () => {
  test("a Postgres trigger body is a function the checker cannot read", () => {
    const hs = hazards(ASSETS, CONFIG, "CREATE TRIGGER t AFTER INSERT ON config FOR EACH ROW EXECUTE FUNCTION f()");
    expect(kinds(hs)).toEqual(["trigger:t:unattributable"]);
    expect(hs[0].why).toContain("function `f`");
  });
  test("a view / trigger calling a function off the floor's allow-list", () => {
    expect(kinds(hazards(ASSETS, CONFIG, "CREATE VIEW v AS SELECT json_extract(v, '$.a') FROM config"))).toEqual(["view:v:unattributable"]);
    expect(kinds(hazards(ASSETS, CONFIG, "CREATE TRIGGER t AFTER INSERT ON config BEGIN SELECT my_fn(NEW.k); END")))
      .toEqual(["trigger:t:unattributable"]);
  });
  test("a `${…}` interpolation inside a declaration, or as a whole statement", () => {
    expect(kinds(hazards(ASSETS, CONFIG, "CREATE VIEW v AS SELECT * FROM ${t}"))).toEqual(["view:v:unattributable"]);
    expect(kinds(hazards(ASSETS, "${ddl}"))).toEqual(["statement:`${…}`:unattributable"]);
  });
  test("quoted, bracketed, backticked and schema-qualified names are read", () => {
    expect(kinds(hazards(ASSETS, CONFIG, `CREATE TRIGGER "t" AFTER INSERT ON "config" BEGIN UPDATE "assets" SET name = 'x'; END`))).toEqual(["trigger:t"]);
    expect(kinds(hazards(ASSETS, "CREATE TRIGGER t2 AFTER DELETE ON main.assets BEGIN SELECT 1; END"))).toEqual(["trigger:t2"]);
    expect(kinds(hazards(ASSETS, "CREATE VIEW [v3] AS SELECT * FROM [assets]"))).toEqual(["view:v3"]);
    const bare = "\n    CREATE TABLE assets (id INTEGER, tenant_id TEXT)\n    CREATE VIEW `v4` AS SELECT * FROM `assets`\n";
    expect(kinds(findSchemaTenantHazards(bare, schemaTenantTableNames([bare])))).toEqual(["view:v4"]);
  });
  test("an unclosed BEGIN, an unreadable ON target, a function / DO body, an event trigger", () => {
    expect(kinds(hazards(ASSETS, CONFIG, "CREATE TRIGGER t AFTER INSERT ON config BEGIN UPDATE config SET v = 1;"))).toEqual(["trigger:t:unattributable"]);
    expect(hazards(ASSETS, "CREATE TRIGGER t AFTER INSERT ON (config) BEGIN SELECT 1; END").every((h) => h.unattributable)).toBe(true);
    expect(kinds(hazards(ASSETS, "CREATE FUNCTION f() RETURNS int AS $$ SELECT 1; $$ LANGUAGE sql"))).toEqual(["function:f:unattributable"]);
    expect(hazards(ASSETS, "DO $$ BEGIN PERFORM 1; END $$")).toHaveLength(1);
    expect(kinds(hazards(ASSETS, "CREATE EVENT TRIGGER et ON ddl_command_start EXECUTE FUNCTION g()"))).toEqual(["trigger:et:unattributable"]);
  });
  test("other statements that move tenant rows: CREATE TABLE … AS SELECT, a virtual table over one, a rename", () => {
    expect(kinds(hazards(ASSETS, "CREATE TABLE snap AS SELECT * FROM assets"))).toEqual(["statement:CREATE TABLE snap"]);
    expect(kinds(hazards(ASSETS, "CREATE VIRTUAL TABLE docs USING fts5(name, content='assets')"))).toEqual(["statement:CREATE VIRTUAL TABLE docs"]);
    expect(hazards(ASSETS, "ALTER TABLE assets RENAME TO archive")).toHaveLength(1);
  });
  test("bare DDL with no `;` between statements: one statement does not run into the next", () => {
    const bare = "\n    CREATE TABLE links (id INTEGER PRIMARY KEY, g TEXT)\n    CREATE TABLE assets (id INTEGER PRIMARY KEY, tenant_id TEXT)\n" +
      "    CREATE VIEW cfg AS SELECT id FROM links\n    notes {\n      aid: integer references assets(id)\n    }\n";
    expect(findSchemaTenantHazards(bare, schemaTenantTableNames([bare]))).toEqual([]);
    const bad = "\n    CREATE TABLE assets (id INTEGER PRIMARY KEY, tenant_id TEXT)\n    CREATE VIEW v AS SELECT id FROM assets\n    CREATE TABLE links (id INTEGER)\n";
    expect(kinds(findSchemaTenantHazards(bad, schemaTenantTableNames([bad])))).toEqual(["view:v"]);
  });
  test("statements that do not move tenant rows are quiet: an index, ADD COLUMN, a DSL reference", () => {
    expect(hazards(ASSETS, "CREATE UNIQUE INDEX ix ON assets (name)", "ALTER TABLE assets ADD COLUMN extra TEXT")).toEqual([]);
    expect(hazards("assets { id: integer primary key\n tenant_id: text }", "config { k: text references assets(id) }")).toEqual([]);
  });
});

// S455 review (S239 of defab9de8, PA-reproduced): SQLite does not reserve `end`, `begin`,
// `execute`, `rename`, …, so a column NAMED like a keyword must never close or skip a parse.
// Executed by the reviewer on defab9de8: the `audit (v, end)` trigger compiled clean and
// tenant A's INSERT INTO config copied BOTH tenants' asset names into `audit`.
describe("keyword-spelled identifiers never end or skip a parse (S455 review HIGH)", () => {
  const AUDIT_END = "CREATE TABLE audit (v TEXT, end TEXT)";
  test("the reviewer's repro: an `end` column inside the trigger body", () => {
    const hs = hazards(ASSETS, CONFIG, AUDIT_END,
      "CREATE TRIGGER t_cfg AFTER INSERT ON config BEGIN INSERT INTO audit (v, end) SELECT name, 'x' FROM assets; END");
    expect(hs.map((h) => `${h.kind}:${h.object}`)).toContain("trigger:t_cfg");
  });
  test("quoted and unquoted `end` / `begin` / `case` columns, and `END` in a CASE expression", () => {
    for (const body of [
      `INSERT INTO audit (v, "end") SELECT name, 'x' FROM assets;`,
      `INSERT INTO audit (begin) SELECT name FROM assets;`,
      `INSERT INTO audit ("case") SELECT name FROM assets;`,
      `UPDATE audit SET v = CASE WHEN 1 THEN 'a' END; UPDATE audit SET v = (SELECT name FROM assets);`,
      `UPDATE audit SET end = 1; UPDATE audit SET v = (SELECT name FROM assets);`,
    ]) {
      const hs = hazards(ASSETS, CONFIG, `CREATE TRIGGER t AFTER INSERT ON config BEGIN ${body} END`);
      expect(hs.length).toBeGreaterThan(0);
    }
  });
  test("a `begin` / `execute` column in the WHEN clause does not start the body early", () => {
    expect(hazards(ASSETS, CONFIG, "CREATE TRIGGER t AFTER INSERT ON config WHEN NEW.begin = 1 BEGIN UPDATE assets SET cost = 0; END"))
      .toHaveLength(1);
    const hs = hazards(ASSETS, CONFIG, "CREATE TRIGGER t AFTER INSERT ON config WHEN NEW.execute = 1 BEGIN UPDATE assets SET cost = 0; END");
    expect(kinds(hs)).toEqual(["trigger:t"]);
  });
  test("an `end` column in a trigger that touches only non-tenant tables is quiet (no false positive)", () => {
    expect(hazards(ASSETS, CONFIG, AUDIT_END,
      "CREATE TRIGGER t AFTER INSERT ON config BEGIN INSERT INTO audit (v, end) VALUES (NEW.k, 'x'); END")).toEqual([]);
  });
  test("a nested BEGIN … END; block does not cut the body short (read to the last END)", () => {
    const hs = hazards(ASSETS, CONFIG,
      "CREATE TRIGGER t AFTER INSERT ON config BEGIN BEGIN UPDATE config SET v = 1; END; UPDATE assets SET cost = 0; END");
    expect(hs.some((h) => h.kind === "trigger" && h.object === "t")).toBe(true); // the body is read to its LAST END
  });
  test("an END that does not end the CREATE is not a close — the trigger is charged unclosed, never passed", () => {
    const hs = hazards(ASSETS, CONFIG, "CREATE TRIGGER t AFTER INSERT ON config BEGIN UPDATE config SET v = 1; END junk UPDATE config SET v = 2");
    expect(hs.map((h) => `${h.object}:${h.unattributable}`)).toEqual(["t:true"]);
    // …and a following declaration is still read on its own
    const hs2 = hazards(ASSETS, CONFIG, "CREATE TRIGGER t AFTER INSERT ON config BEGIN UPDATE config SET v = 1; END", "CREATE VIEW vw AS SELECT * FROM assets");
    expect(kinds(hs2)).toEqual(["view:vw"]);
  });
  test("a column named `rename` is not a table rename; `RENAME TO` is", () => {
    expect(hazards(ASSETS, "ALTER TABLE assets ADD COLUMN rename TEXT")).toEqual([]);
    expect(hazards(ASSETS, "ALTER TABLE assets RENAME COLUMN name TO title")).toEqual([]);
    expect(hazards(ASSETS, "ALTER TABLE assets RENAME TO archive")).toHaveLength(1);
  });
  test("a view whose columns are spelled `end` / `as` / `begin` is read to its end", () => {
    expect(kinds(hazards(ASSETS, CONFIG, "CREATE VIEW v (end, begin) AS SELECT k AS end, v AS begin FROM config UNION SELECT name, name FROM assets")))
      .toEqual(["view:v"]);
  });
  test("a QUOTED callee is a call (`\"query_to_xml\"(…)`)", () => {
    expect(kinds(hazards(ASSETS, CONFIG, `CREATE VIEW v AS SELECT "query_to_xml"('sel' || 'ect 1', true, false, '') AS x FROM config`)))
      .toEqual(["view:v:unattributable"]);
  });
});

describe("string forms the lexer does not model exactly are charged (S455 review)", () => {
  test("a Postgres E'…' string, or a backslash inside a quote, inside SQL", () => {
    expect(hazards(ASSETS, CONFIG, "CREATE VIEW v AS SELECT E'it\\'s' AS a FROM config").some((h) => h.object === "a quoted literal")).toBe(true);
    expect(hazards(ASSETS, CONFIG, "CREATE VIEW v AS SELECT 'a\\' AS a FROM config").some((h) => h.object === "a quoted literal")).toBe(true);
  });
  test("plain standard strings are fine", () => {
    expect(hazards(ASSETS, CONFIG, "CREATE VIEW v AS SELECT 'it''s' AS a, 'e' AS b FROM config")).toEqual([]);
  });
});

// PA decision (S455 review, closed wins): Postgres ORs PERMISSIVE policies — the default
// when `AS` is omitted — with the §14.8.11 tier's `scrml_tenant_iso`, so a permissive policy
// on a tenant table widens isolation. Only an explicit `AS RESTRICTIVE` (ANDed) is exempt.
describe("row-security POLICY on a tenant table: only AS RESTRICTIVE is exempt", () => {
  const USING = "USING (tenant_id = current_setting('scrml.tenant', true))";
  test("AS RESTRICTIVE (any case) is quiet", () => {
    expect(hazards(ASSETS, `CREATE POLICY p ON assets AS RESTRICTIVE FOR SELECT ${USING}`)).toEqual([]);
    expect(hazards(ASSETS, `CREATE POLICY p ON assets as restrictive ${USING}`)).toEqual([]);
    expect(hazards(ASSETS, `CREATE POLICY "p q" ON public.assets As Restrictive ${USING}`)).toEqual([]);
  });
  test("AS PERMISSIVE → charged, the message says to write AS RESTRICTIVE", () => {
    const b = body(ASSETS, "CREATE POLICY open_all ON assets AS PERMISSIVE USING (true)");
    const hs = findSchemaTenantHazards(b, ["assets"]);
    expect(kinds(hs)).toEqual(["permissive policy:open_all"]);
    expect(schemaHazardMessage(hs[0], b)).toContain("write `AS RESTRICTIVE`");
  });
  test("no AS clause → PERMISSIVE by default → charged", () => {
    const hs = hazards(ASSETS, `CREATE POLICY p ON assets FOR SELECT ${USING}`);
    expect(kinds(hs)).toEqual(["permissive policy:p"]);
    expect(hs[0].why).toContain("the default when `AS` is omitted");
  });
  test("an unreadable AS clause (quoted keyword) or target → charged unattributable", () => {
    expect(kinds(hazards(ASSETS, `CREATE POLICY p ON assets AS "restrictive" ${USING}`))).toEqual(["permissive policy:p:unattributable"]);
    expect(kinds(hazards(ASSETS, `CREATE POLICY p USING (true)`))).toEqual(["permissive policy:p:unattributable"]);
  });
  test("a policy on a table without tenant_id is not charged", () => {
    expect(hazards(ASSETS, CONFIG, "CREATE POLICY p ON config USING (true)")).toEqual([]);
  });
});

describe("comments — read three ways, the union is charged", () => {
  test("a comment inside the declaration does not hide it", () => {
    expect(kinds(hazards(ASSETS, "CREATE /* x */ VIEW v AS SELECT * FROM assets"))).toEqual(["view:v"]);
  });
  test("a commented-out declaration still counts (as the S452 r4 limb did)", () => {
    expect(kinds(hazards(ASSETS, "-- CREATE VIEW v AS SELECT * FROM assets"))).toEqual(["view:v"]);
    expect(kinds(hazards(ASSETS, "/*! CREATE VIEW m AS SELECT * FROM assets */"))).toEqual(["view:m"]);
  });
  test("nested-comment dialect differences (Postgres nests, SQLite does not)", () => {
    expect(kinds(hazards(ASSETS, "/* /* */ CREATE VIEW v2 AS SELECT * FROM assets; */"))).toEqual(["view:v2"]);
  });
  test("a semicolon inside a string or a dollar-quoted literal does not end a view", () => {
    expect(kinds(hazards(ASSETS, "CREATE VIEW v AS SELECT ';' AS s, id FROM assets"))).toEqual(["view:v"]);
    expect(kinds(hazards(ASSETS, "CREATE VIEW v AS SELECT $$;$$ AS s, id FROM assets"))).toEqual(["view:v"]);
  });
});

describe("the message names the code, the object, the tenant table and the hazard kind", () => {
  test("one message", () => {
    const b = body(ASSETS, CONFIG, "CREATE TRIGGER t_cfg AFTER INSERT ON config BEGIN UPDATE assets SET name = 'x'; END");
    const [h] = findSchemaTenantHazards(b, ["assets"]);
    const m = schemaHazardMessage(h, b);
    expect(m.startsWith("E-TENANT-SCHEMA-HAZARD:")).toBe(true);
    expect(m).toContain("a trigger `t_cfg`");
    expect(m).toContain("the tenant-scoped table `assets`");
    expect(m).toContain("line 4 of the `<schema>` body"); // the body opens with a newline
    expect(m).toContain("§14.8.10");
  });
  test("an unattributable hazard names every tenant table and says it was charged", () => {
    const b = body(ASSETS, ORDERS, CONFIG, "CREATE TRIGGER t AFTER INSERT ON config FOR EACH ROW EXECUTE FUNCTION f()");
    const [h] = findSchemaTenantHazards(b, schemaTenantTableNames([b]));
    const m = schemaHazardMessage(h, b);
    expect(m).toContain("every tenant-scoped table (`assets`, `orders`)");
    expect(m).toContain("unattributable — charged, never treated as safe");
  });
});

// ---------------------------------------------------------------------------
// End to end — compiled, seeded with two tenants, executed.
// ---------------------------------------------------------------------------
const _tmp = [];
afterAll(() => { for (const d of _tmp) { try { rmSync(d, { recursive: true, force: true }); } catch {} } });
const CSRF = "tenant-schema-hazard-csrf";

function compileApp(ddl, seed, logic, buttons) {
  const dir = mkdtempSync(join(tmpdir(), "tenant-schema-hazard-"));
  _tmp.push(dir);
  const src = `<program db="app.db">
  <schema>
${ddl.map((d) => `    ${w(d)}`).join("\n")}
  </schema>
  \${
    function pinTenant(t: string) {
      session.set("userId", "u-" + t)
      session.set("tenantId", t)
      return "ok"
    }
${logic}
  }
${buttons.map((n) => `  <button onclick=\${ ${n}() }>x</button>`).join("\n")}
  <button onclick=\${ pinTenant("A") }>p</button>
</program>
`;
  writeFileSync(join(dir, "app.scrml"), src);
  const db = new Database(join(dir, "app.db"), { create: true });
  for (const s of [...ddl, ...seed]) db.exec(s);
  db.close();
  const result = compileScrml({ inputFiles: [join(dir, "app.scrml")], write: true, outputDir: join(dir, "out"), log: () => {} });
  return { dir, result };
}
const fatalCodes = (r) => (r.errors ?? []).filter((e) => !/^[WI]-/.test(e.code ?? "")).map((e) => e.code);
const SEED = ["INSERT INTO assets (id, name, cost, tenant_id) VALUES (1, 'A-secret-asset', 10, 'A'), (2, 'B-secret-asset', 500, 'B')"];
const run = (name, sql) => `    function ${name}() {\n      ?{${BT}${sql}${BT}}.run()\n      return "ok"\n    }`;
const read = (name, sql) => `    function ${name}() {\n      return ?{${BT}${sql}${BT}}.all()\n    }`;

describe("end to end — each r4 reproducer is refused at compile with E-TENANT-SCHEMA-HAZARD", () => {
  const cases = {
    H1: [[ASSETS, "CREATE TABLE config (k TEXT, v TEXT)", "CREATE TRIGGER t_cfg AFTER INSERT ON config BEGIN UPDATE assets SET name = 'pwned-by-trigger'; END"],
      run("go", "INSERT INTO config (k, v) VALUES ('a', 'b')"), "trigger `t_cfg`"],
    H2: [[ASSETS, "CREATE VIEW va AS SELECT id, name FROM assets", "CREATE TRIGGER t_v INSTEAD OF UPDATE ON va BEGIN UPDATE assets SET name = NEW.name WHERE id = NEW.id; END"],
      run("go", "UPDATE va SET name = 'pwned-by-A' WHERE id = 2"), "trigger `t_v`"],
    M1: [[CONFIG, "CREATE TABLE assets (id INTEGER PRIMARY KEY, name TEXT, cost INTEGER, cfg TEXT REFERENCES config(k) ON DELETE CASCADE, tenant_id TEXT)"],
      run("go", "DELETE FROM config WHERE k = 'c'"), "ON DELETE CASCADE"],
    // S455 review HIGH (executed by the reviewer on defab9de8: compiled clean, A read B's names)
    END_COLUMN: [[ASSETS, "CREATE TABLE config (k TEXT, v TEXT)", "CREATE TABLE audit (v TEXT, end TEXT)",
      "CREATE TRIGGER t_cfg AFTER INSERT ON config BEGIN INSERT INTO audit (v, end) SELECT name, 'x' FROM assets; END"],
      run("go", "INSERT INTO config (k, v) VALUES ('a', 'b')"), "trigger `t_cfg`"],
    VIEW: [[ASSETS, "CREATE VIEW all_assets AS SELECT * FROM assets"],
      read("go", "SELECT id, name, tenant_id FROM all_assets ORDER BY id"), "view `all_assets`"],
  };
  for (const [k, [ddl, logic, named]] of Object.entries(cases)) {
    test(k, () => {
      const seed = k === "M1" ? [] : SEED;
      const { result } = compileApp(ddl, seed, logic, ["go"]);
      expect(fatalCodes(result)).toContain("E-TENANT-SCHEMA-HAZARD");
      const msgs = (result.errors ?? []).filter((e) => e.code === "E-TENANT-SCHEMA-HAZARD").map((e) => e.message);
      expect(msgs.some((m) => m.includes(named))).toBe(true);
      expect(result.errors.find((e) => e.code === "E-TENANT-SCHEMA-HAZARD").span.line).toBeGreaterThan(1);
    });
  }
});

describe("end to end — a schema whose triggers / FKs / views touch only non-tenant tables compiles AND runs", () => {
  test("two tenants: the trigger fires, the view reads, and A still sees only A's assets", async () => {
    const ddl = [ASSETS, CONFIG, "CREATE TABLE audit (id INTEGER PRIMARY KEY, msg TEXT)",
      "CREATE TABLE notes (id INTEGER PRIMARY KEY, k TEXT REFERENCES config(k) ON DELETE CASCADE, body TEXT)",
      "CREATE TRIGGER t_cfg_audit AFTER INSERT ON config BEGIN INSERT INTO audit (msg) VALUES (NEW.k); END",
      "CREATE VIEW cfg_view AS SELECT k, v FROM config", "CREATE INDEX ix_assets_name ON assets (name)"];
    const logic = [run("go", "INSERT INTO config (k, v) VALUES ('a', 'b')"), read("mine", "SELECT id, name FROM assets ORDER BY id"),
      read("cv", "SELECT k, v FROM cfg_view"), read("au", "SELECT msg FROM audit")].join("\n");
    const { dir, result } = compileApp(ddl, SEED, logic, ["go", "mine", "cv", "au"]);
    expect(fatalCodes(result)).toEqual([]);
    const mod = await import(`${join(dir, "out", "app.server.js")}?v=${Date.now()}`);
    const routes = {};
    for (const r of mod.routes) routes[r.path.replace(/^.*__ri_route_/, "").replace(/_\d+$/, "")] = r;
    const req = (name, cookie = "", b = {}) => routes[name].handler(new Request(`https://localhost${routes[name].path}`, {
      method: routes[name].method,
      headers: { "Content-Type": "application/json", Cookie: `scrml_csrf=${CSRF}${cookie ? `; ${cookie}` : ""}`, "X-CSRF-Token": CSRF },
      body: JSON.stringify(b),
    }));
    const pinRes = await req("pinTenant", "", { t: "A" });
    const a = pinRes.headers.getSetCookie().map((c) => /(?:__Host-)?scrml_sid=[^;]+/.exec(c)).find(Boolean)[0];
    expect(await (await req("go", a)).json()).toBe("ok");
    expect(await (await req("mine", a)).json()).toEqual([{ id: 1, name: "A-secret-asset" }]);
    expect(await (await req("cv", a)).json()).toEqual([{ k: "a", v: "b" }]);
    expect(await (await req("au", a)).json()).toEqual([{ msg: "a" }]);
  });
});

// S455 review round 2b (PA-reproduced on c85602108: exit 0, floor active, A's go() rewrote
// B's row): a `${ schemaFor(Assets) }` tenant table was invisible to the first cut — GCP1
// read the schema BEFORE TS expanded schemaFor, and emit-server skipped every table the
// expanded `<schema>` declared on the ASSUMPTION GCP1 had reported it. The rule is now one
// stage (TENANT-SCHEMA, after TS + ME, before CG). Every way a table enters the tenant set,
// each with a trigger AND a view over it.
describe("every way a table becomes tenant-scoped — a trigger and a view over it are both refused", () => {
  const TRIG = "CREATE TRIGGER t_cfg AFTER INSERT ON config BEGIN UPDATE assets SET name = 'pwned'; END";
  const VIEW = "CREATE VIEW va AS SELECT * FROM assets";
  const compileSrc = (src) => {
    const dir = mkdtempSync(join(tmpdir(), "tenant-schema-path-"));
    _tmp.push(dir);
    writeFileSync(join(dir, "app.scrml"), src);
    return compileScrml({ inputFiles: [join(dir, "app.scrml")], write: false, outputDir: join(dir, "out"), log: () => {} });
  };
  const hazardMsgs = (r) => (r.errors ?? []).filter((e) => e.code === "E-TENANT-SCHEMA-HAZARD").map((e) => e.message);
  const expectBoth = (r) => {
    const m = hazardMsgs(r);
    expect(m.some((x) => x.includes("trigger `t_cfg`"))).toBe(true);
    expect(m.some((x) => x.includes("view `va`"))).toBe(true);
  };
  const prog = (pre, schemaLines, extra = "") => `${pre}<program db="./app.db">
  <schema>
${schemaLines.map((l) => `    ${l}`).join("\n")}
  </schema>
${extra}  <p>x</p>
</program>
`;
  const STRUCT = "${ import { schemaFor } from 'scrml:data'\n   type Assets:struct = { id: number, name: string, tenant_id: string } }\n";
  test("a raw CREATE TABLE", () => expectBoth(compileSrc(prog("", [w(ASSETS), w(CONFIG), w(TRIG), w(VIEW)]))));
  test("a DSL head", () => expectBoth(compileSrc(prog("", ["assets {\n      id: integer primary key\n      name: text\n      tenant_id: text\n    }", w(CONFIG), w(TRIG), w(VIEW)]))));
  test("`${ schemaFor(T) }` (expanded by TS — the round-2b repro)", () => expectBoth(compileSrc(prog(STRUCT, ["${ schemaFor(Assets) }", w(CONFIG), w(TRIG), w(VIEW)]))));
  test("`schemaFor(T, { omit })` and `{ pick }` keeping tenant_id", () => {
    expectBoth(compileSrc(prog(STRUCT, ['${ schemaFor(Assets, { omit: ["name"] }) }', w(CONFIG), w(TRIG), w(VIEW)])));
    expectBoth(compileSrc(prog(STRUCT, ['${ schemaFor(Assets, { pick: ["id", "tenant_id"] }) }', w(CONFIG), w(TRIG), w(VIEW)])));
  });
  test("`schemaFor(T, { omit: [\"tenant_id\"] })` is NOT tenant-scoped — nothing charged", () => {
    expect(hazardMsgs(compileSrc(prog(STRUCT, ['${ schemaFor(Assets, { omit: ["tenant_id"] }) }', w(CONFIG), w(TRIG), w(VIEW)])))).toEqual([]);
  });
  test("a commented-out declaration that agrees (the floor reads the union)", () => {
    expectBoth(compileSrc(prog("", ["-- CREATE TABLE assets (id INTEGER, name TEXT, tenant_id TEXT)", w(ASSETS), w(CONFIG), w(TRIG), w(VIEW)])));
  });
  test("a second `<schema>` block (E-SCHEMA-002 also fires; the hazard still does)", () => {
    const src = `<program db="./app.db">
  <schema>
    ${w(ASSETS)}
  </schema>
  <schema>
    ${w(CONFIG)}
    ${w(TRIG)}
    ${w(VIEW)}
  </schema>
  <p>x</p>
</program>
`;
    const r = compileSrc(src);
    expectBoth(r);
  });
});

// S455 review rounds 3–4 (both PA-reproduced). Round 3: a per-FILE tenant set let a
// trigger in admin.scrml's <schema> over app.scrml's tenant table compile clean. Round 4: a
// per-DATABASE set keyed on the lexical `db=` string was beaten by every alias the runtime
// resolves — a symlinked directory, a symlinked file, two roots under SCRML_DATA_DIR,
// `sqlite:app.db?mode=rwc`. PA decision (fail-closed; a list of "these are different"
// enumerates forever): ONE tenant set for the compilation — the union over every file
// compiled together, whatever database it names.
describe("compilation scope — one tenant set over every file compiled together, any database", () => {
  const compileFiles = (files, links = {}) => {
    const dir = mkdtempSync(join(tmpdir(), "tenant-schema-proj-"));
    _tmp.push(dir);
    for (const [link, target] of Object.entries(links)) {
      mkdirSync(dirname(join(dir, link)), { recursive: true });
      // A platform without symlink rights (Windows CI) still runs the case: the charge
      // does not depend on resolving the database at all.
      try { symlinkSync(target, join(dir, link)); } catch { /* not resolvable here — fine */ }
    }
    const paths = Object.entries(files).map(([name, src]) => {
      const p = join(dir, name);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, src);
      return p;
    });
    return compileScrml({ inputFiles: paths, write: false, outputDir: join(dir, "out"), log: () => {} });
  };
  const app = (db) => `<program db="${db}">
  <schema>
    ${w(ASSETS)}
    ${w("CREATE TABLE config (k TEXT, v TEXT)")}
  </schema>
  \${
    function go() {
      ?{${BT}INSERT INTO config (k, v) VALUES ('a', 'b')${BT}}.run()
      return "ok"
    }
  }
  <button onclick=\${ go() }>go</button>
</program>
`;
  const admin = (db) => `<program db="${db}">
  <schema>
    ${w("CREATE TABLE config (k TEXT, v TEXT)")}
    ${w("CREATE TRIGGER t_cfg AFTER INSERT ON config BEGIN UPDATE assets SET name = 'pwned'; END")}
    ${w("CREATE VIEW va AS SELECT * FROM assets")}
  </schema>
  <p>admin</p>
</program>
`;
  const msgs = (r) => (r.errors ?? []).filter((e) => e.code === "E-TENANT-SCHEMA-HAZARD").map((e) => e.message);
  const both = (r) => {
    const m = msgs(r);
    expect(m.some((x) => x.includes("trigger `t_cfg`"))).toBe(true);
    expect(m.some((x) => x.includes("view `va`"))).toBe(true);
  };
  test("round 3: two files, one database — the trigger AND the view in admin.scrml are refused", () => {
    both(compileFiles({ "app.scrml": app("./app.db"), "admin.scrml": admin("./app.db") }));
  });
  test("round 4 alias: a symlinked directory (`./lnk/app.db`, lnk -> .)", () => {
    both(compileFiles({ "app.scrml": app("./app.db"), "admin.scrml": admin("./lnk/app.db") }, { lnk: "." }));
  });
  test("round 4 alias: a symlinked file (`ops/app.db -> ../app.db`)", () => {
    both(compileFiles({ "app.scrml": app("./app.db"), "admin.scrml": admin("./ops/app.db") }, { "ops/app.db": "../app.db" }));
  });
  test("round 4 alias: two project roots, both `./app.db` (the SCRML_DATA_DIR Docker/Fly shape)", () => {
    both(compileFiles({ "web/app.scrml": app("./app.db"), "worker/admin.scrml": admin("./app.db") }));
  });
  test("round 4 alias: `sqlite:app.db?mode=rwc`", () => {
    both(compileFiles({ "app.scrml": app("./app.db"), "admin.scrml": admin("sqlite:app.db?mode=rwc") }));
  });
  test("network URIs naming different databases → charged", () => {
    both(compileFiles({ "app.scrml": app("postgres://h/one"), "admin.scrml": admin("postgres://h/two") }));
  });
  test("ACCEPTED OVER-INCLUSION: two genuinely different SQLite files compiled together are still charged", () => {
    both(compileFiles({ "app.scrml": app("./app.db"), "admin.scrml": admin("./admin.db") }));
  });
  test("compiled SEPARATELY, admin.scrml alone declares no tenant table → not charged (the stated Limit)", () => {
    expect(msgs(compileFiles({ "admin.scrml": admin("./app.db") }))).toEqual([]);
  });
});

describe("a `${…}` anywhere in SQL is charged, as SPEC says (S455 review round 2b LOW)", () => {
  test("in a foreign-key action", () => {
    expect(hazards(ASSETS, "CREATE TABLE notes (aid INTEGER REFERENCES assets(id) ON DELETE ${ACT})").length).toBeGreaterThan(0);
  });
  test("inside a string literal in a trigger body", () => {
    expect(hazards(ASSETS, CONFIG, "CREATE TRIGGER t AFTER INSERT ON config BEGIN INSERT INTO config (k) VALUES ('${nm()}'); END").length)
      .toBeGreaterThan(0);
  });
});

describe("performance — linear in literal size (the quadratic was schema-differ parseSchemaBlock, shared with the floor)", () => {
  test("a 200 KB string literal is checked quickly", () => {
    const big = "x".repeat(200_000);
    const t0 = performance.now();
    hazards(ASSETS, CONFIG, `CREATE VIEW v AS SELECT '${big}' AS s FROM config`);
    expect(performance.now() - t0).toBeLessThan(1500);
  });
});

describe("end to end — a table tenant-scoped only by the <db> registry is charged", () => {
  test("a `<schema>` view over a live-database tenant table → E-TENANT-SCHEMA-HAZARD (GCP1 cannot see that table)", () => {
    const dir = mkdtempSync(join(tmpdir(), "tenant-schema-hazard-dbreg-"));
    _tmp.push(dir);
    writeFileSync(join(dir, "app.scrml"), `<program db="app.db">
  <schema>
    ${w(CONFIG)}
    ${w("CREATE VIEW all_assets AS SELECT * FROM assets")}
  </schema>
  <db src="app.db" tables="assets">
    \${
      function mine() {
        return ?{${BT}SELECT id, name FROM assets${BT}}.all()
      }
    }
  </db>
  <div><p>hi</p></div>
</program>
`);
    const db = new Database(join(dir, "app.db"), { create: true });
    db.exec("CREATE TABLE assets (id INTEGER PRIMARY KEY, name TEXT, tenant_id TEXT)");
    db.exec(CONFIG);
    db.close();
    const result = compileScrml({ inputFiles: [join(dir, "app.scrml")], write: true, outputDir: join(dir, "out"), log: () => {} });
    const hz = (result.errors ?? []).filter((e) => e.code === "E-TENANT-SCHEMA-HAZARD");
    expect(hz).toHaveLength(1);
    expect(hz[0].message).toContain("view `all_assets`");
  });
});
