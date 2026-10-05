/**
 * §14.8.10 — `<schema>` BODIES are read in the tenant SQL subset
 * (ruling:user-voice-scrml.md S455 "yes, both", part 2).
 *
 * In a compilation with a tenant-scoped table, a view / trigger / rule / policy body —
 * and a `CREATE TABLE … AS` query — must lie inside the SAME token-level SQL subset the
 * S452 r3 query floor reads tenant queries in (`codegen/tenant-sql-subset.ts`
 * `lexTenantSubset`): the closed token set, the function allow-list, and for a trigger
 * the subset's statement leaders. Anything outside it is E-TENANT-SCHEMA-HAZARD, kind
 * "body outside the tenant SQL subset", naming the first offending token. It replaces the
 * hand-rolled body reader (`readRegion`) that seven S239 review rounds beat one spelling
 * at a time (docs/changes/s455-tenant-schema-hazard + s455-tenant-floor-project-set).
 *
 * It also CLOSES the `rel.f` residual of #1317: Postgres reads `rel.f` as the CALL
 * `f(rel)` when `f` is not a column of `rel` (attribute notation), so inside a body a
 * qualified reference is admitted only to a column the compilation's `<schema>`
 * declares on the relation it resolves to; anything else is refused (fail-closed).
 */
import { describe, test, expect, afterAll } from "bun:test";
import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import {
  findSchemaTenantHazards,
  schemaTenantTableNames,
  schemaHazardMessage,
  schemaColumnKnowledge,
} from "../../src/tenant-schema-hazards.ts";
import { lexTenantSubset, analyzeTenantSql } from "../../src/codegen/tenant-sql-subset.ts";
import { compileScrml } from "../../src/api.js";

const OUTSIDE = "body outside the tenant SQL subset";
const BT = "`";
const w = (s) => (s.startsWith("--") || s.startsWith("/*") || /^\w+ \{/.test(s) ? s : `?{${BT}${s}${BT}}`);
const body = (...stmts) => "\n" + stmts.map((s) => `    ${w(s)}`).join("\n") + "\n  ";
const ASSETS = "CREATE TABLE assets (id INTEGER PRIMARY KEY, name TEXT, cost INTEGER, tenant_id TEXT)";
const CONFIG = "CREATE TABLE config (k TEXT PRIMARY KEY, v TEXT)";
const OTHER = "CREATE TABLE other (id INTEGER, label TEXT)";
const OTHER_E = "CREATE TABLE other (id INTEGER, label TEXT, evil TEXT)";
const LOGS = "CREATE TABLE logs (id INTEGER, msg TEXT, ts TIMESTAMP)";
const hazards = (...stmts) => {
  const b = body(ASSETS, ...stmts);
  return findSchemaTenantHazards(b, schemaTenantTableNames([b]));
};
const kinds = (hs) => hs.map((h) => `${h.kind}:${h.object}${h.unattributable ? ":unattributable" : ""}`);
const charged = (label, cases) => {
  for (const c of cases) {
    const stmts = Array.isArray(c) ? c : [c];
    test(`${label} — charged: ${stmts[stmts.length - 1].slice(0, 90)}`, () => expect(hazards(...stmts).length).toBeGreaterThan(0));
  }
};
const clean = (label, cases) => {
  for (const c of cases) {
    const stmts = Array.isArray(c) ? c : [c];
    test(`${label} — clean: ${stmts[stmts.length - 1].slice(0, 90)}`, () => expect(kinds(hazards(...stmts))).toEqual([]));
  }
};

describe("the subset lexer is shared: `;` is a separator ONLY for a trigger statement list", () => {
  test("a query never admits `;` (one statement); the opt-in admits it as a token", () => {
    expect(lexTenantSubset("SELECT 1; SELECT 2").ok).toBe(false);
    const r = lexTenantSubset("BEGIN SELECT 1; END", { statementSeparator: true });
    expect(r.ok).toBe(true);
    expect(r.toks.map((t) => t.text)).toEqual(["BEGIN", "SELECT", "1", ";", "END"]);
  });
  test("every other character stays outside with the option on", () => {
    for (const s of ['SELECT "a"', "SELECT a::text", "SELECT a[1]", "SELECT $$x$$", "SELECT 1 -- c", "SELECT E'x'"]) {
      expect(lexTenantSubset(s, { statementSeparator: true }).ok).toBe(false);
    }
  });
  test("the query floor is unchanged: a `;` query on a tenant table is still E-TENANT-SQL-SUBSET", () => {
    const a = analyzeTenantSql("SELECT name FROM assets; DELETE FROM assets", (n) => n === "assets", ["assets"]);
    expect(a.kind).toBe("refuse");
    expect(a.code).toBe("E-TENANT-SQL-SUBSET");
  });
});

describe("every S455 review-round repro is still refused", () => {
  charged("#1313 round 1 (H1 / H2 / VIEW)", [
    [CONFIG, "CREATE TRIGGER t_cfg AFTER INSERT ON config BEGIN UPDATE assets SET name = 'pwned'; END"],
    ["CREATE VIEW va AS SELECT id, name FROM assets", "CREATE TRIGGER t_v INSTEAD OF UPDATE ON va BEGIN UPDATE assets SET name = NEW.name WHERE id = NEW.id; END"],
    ["CREATE VIEW all_assets AS SELECT * FROM assets"],
    ["CREATE TABLE notes (id INTEGER, k TEXT REFERENCES assets(id) ON DELETE CASCADE)"],
  ]);
  charged("#1313 review HIGH — keyword-spelled columns", [
    [CONFIG, "CREATE TABLE audit (v TEXT, end TEXT)", "CREATE TRIGGER t_cfg AFTER INSERT ON config BEGIN INSERT INTO audit (v, end) SELECT name, 'x' FROM assets; END"],
    [CONFIG, "CREATE TABLE audit (v TEXT)", `CREATE TRIGGER t AFTER INSERT ON config BEGIN INSERT INTO audit (v, "end") SELECT name, 'x' FROM assets; END`],
    [CONFIG, "CREATE TRIGGER t AFTER INSERT ON config BEGIN UPDATE config SET v = 1; END junk UPDATE config SET v = 2"],
    [CONFIG, "CREATE TRIGGER t AFTER INSERT ON config BEGIN BEGIN UPDATE config SET v = 1; END; UPDATE assets SET cost = 0; END"],
  ]);
  charged("#1313 — quoted callee, query_to_xml, E-strings, backslash, `${…}`", [
    [CONFIG, `CREATE VIEW v AS SELECT "query_to_xml"('sel' || 'ect 1', true, false, '') AS x FROM config`],
    ["CREATE VIEW v AS SELECT lower('select * from assets') AS x"],
    [CONFIG, "CREATE VIEW v AS SELECT E'it\\'s' AS a FROM config"],
    [CONFIG, "CREATE VIEW v AS SELECT 'a\\' AS a FROM config"],
    [CONFIG, "CREATE VIEW v AS SELECT * FROM ${t}"],
    [CONFIG, "CREATE TRIGGER t AFTER INSERT ON config FOR EACH ROW EXECUTE FUNCTION f()"],
    ["CREATE EVENT TRIGGER et ON ddl_command_start EXECUTE FUNCTION g()"],
  ]);
  charged("#1317 — table functions, FROM inside a call, subscripts, user types, qualified callees", [
    [LOGS, "CREATE VIEW v AS SELECT * FROM evil(1)"],
    [LOGS, "CREATE VIEW v AS SELECT * FROM logs JOIN evil(1) ON true"],
    [LOGS, "CREATE VIEW v AS WITH c AS (SELECT * FROM evil()) SELECT * FROM c"],
    [LOGS, "CREATE TRIGGER t AFTER INSERT ON logs BEGIN UPDATE logs SET msg = 'x' FROM evil(1); END"],
    [LOGS, "CREATE VIEW v AS SELECT * FROM logs WHERE match(msg)"],
    [LOGS, "CREATE TRIGGER tl AFTER INSERT ON logs BEGIN SELECT substring('a' FROM evil(1)); END"],
    [LOGS, "CREATE TRIGGER tl AFTER INSERT ON logs BEGIN SELECT trim(BOTH FROM evil(NEW.msg)); END"],
    [LOGS, "CREATE TRIGGER tl AFTER INSERT ON logs BEGIN SELECT lower(substring(NEW.msg FROM evil.fn(1))); END"],
    [OTHER, "CREATE VIEW v AS SELECT arr[evil()] FROM other"],
    [OTHER, "CREATE TRIGGER t AFTER INSERT ON other BEGIN SELECT (ARRAY[1])[dblink_exec('a','b')]; END"],
    [OTHER, "CREATE VIEW v AS SELECT 'x'::evil_t FROM other"],
    [OTHER, "CREATE VIEW v AS SELECT evil_t 'x' FROM other"],
    [OTHER, "CREATE TRIGGER t AFTER INSERT ON other BEGIN SELECT CAST(NEW.id AS evil_t); END"],
    [OTHER, "CREATE VIEW v AS SELECT pg_catalog.lower(label) FROM other"],
    ["CREATE POLICY p ON assets AS RESTRICTIVE USING (evil(tenant_id))"],
    ["CREATE POLICY p ON assets AS RESTRICTIVE FOR INSERT TO scrml_app WITH CHECK (dblink_exec('a','b') IS NULL)"],
    ["CREATE POLICY p ON assets AS RESTRICTIVE USING ((ARRAY[1])[evil()] = 1)"],
    ["CREATE TABLE t2 AS SELECT dblink_exec('a','b')"],
    ["(SELECT dblink_exec('dbname=app','DELETE FROM ass'||'ets'))"],
  ]);
});

describe("`rel.f` (the #1317 residual) — a qualified reference must name a DECLARED column", () => {
  test("the residual itself: `SELECT o.evil FROM other o` is refused, naming the token", () => {
    const hs = hazards(OTHER, "CREATE VIEW v AS SELECT o.evil FROM other o");
    expect(kinds(hs)).toEqual([`${OUTSIDE}:v:unattributable`]);
    expect(hs[0].why).toContain("`o.evil`");
    expect(hs[0].why).toContain("`f(rel)`");
  });
  test("…and admitted when `evil` IS a declared column (then Postgres reads the column, not a call)", () => {
    expect(hazards(OTHER_E, "CREATE VIEW v AS SELECT o.evil FROM other o")).toEqual([]);
  });
  charged("refused", [
    [OTHER, "CREATE VIEW v AS SELECT id IS DISTINCT FROM 1, o.evil FROM other o"],          // not a FROM clause
    [OTHER_E, "CREATE VIEW v AS WITH other AS (SELECT 1 AS id) SELECT o.evil FROM other o"], // a CTE shadows the table
    [OTHER, "CREATE VIEW v AS SELECT id FROM other UNION SELECT o.evil FROM other o"],
    [OTHER, "CREATE POLICY p ON assets AS RESTRICTIVE USING (assets.evil)"],
    [OTHER_E, "CREATE VIEW v AS SELECT x.evil FROM (SELECT id FROM other) x"],              // a derived table's own columns
    [OTHER_E, "CREATE VIEW v AS WITH c AS (SELECT id FROM other) SELECT c.evil FROM c"],    // a CTE's own columns
    ["CREATE TABLE c (id INT, evil TEXT)", "CREATE VIEW v AS WITH RECURSIVE c AS (SELECT 1 AS id UNION SELECT c.evil FROM c) SELECT id FROM c"],
    [OTHER_E, "CREATE VIEW v AS SELECT other.evil FROM (SELECT id FROM other) other"],
    [OTHER_E, "ALTER TABLE other RENAME COLUMN evil TO e2", "CREATE VIEW v AS SELECT other.evil FROM other"],
    [CONFIG, "CREATE TRIGGER t AFTER INSERT ON config BEGIN SELECT NEW.evil; END"],
    [CONFIG, "CREATE TABLE audit (k TEXT PRIMARY KEY, n INT)", "CREATE TRIGGER t AFTER INSERT ON config BEGIN INSERT INTO audit (k, n) VALUES (NEW.k, 1) ON CONFLICT (k) DO UPDATE SET n = excluded.evil; END"],
    ["-- CREATE TABLE other (id INT, evil TEXT)", OTHER, "CREATE VIEW v AS SELECT o.evil FROM other o"],          // a commented-out copy declares nothing
    [OTHER, "/* /* */ ALTER TABLE other ADD COLUMN evil TEXT; */", "CREATE VIEW v AS SELECT o.evil FROM other o"], // live only in the SQLite comment model
    [OTHER, "CREATE VIEW v AS SELECT id FROM other", "CREATE VIEW v2 AS SELECT v.evil FROM v"],
    [OTHER, "CREATE VIEW v AS SELECT id ISNULL FROM other", "CREATE VIEW v2 AS SELECT v.isnull FROM v"],              // `a ISNULL` names no column
    [OTHER, "CREATE VIEW v AS SELECT main.other.id FROM other"],                                                       // three-part
    [OTHER, "CREATE VIEW v AS SELECT (o).evil FROM other o"],                                                          // field selection
    [OTHER, "CREATE VIEW v AS SELECT q.id FROM other o"],                                                              // unbound qualifier
    [OTHER, "CREATE TABLE snap AS SELECT o.evil FROM other o"],                                                        // a CTAS query is a body
    [OTHER, "CREATE INDEX i ON other ((other.evil))"],                                                                 // expression region: own.f
    ["CREATE TABLE z (a INT CHECK (z.evil > 0))"],
  ]);
  clean("admitted", [
    [OTHER_E, "CREATE VIEW v AS SELECT o.evil FROM other o"],
    [OTHER, "CREATE VIEW v AS SELECT o.id FROM public.other o"],                       // a qualified RELATION in FROM
    [OTHER_E, "ALTER TABLE other RENAME COLUMN evil TO e2", "CREATE VIEW v AS SELECT other.e2 FROM other"],
    [OTHER, "ALTER TABLE other ADD COLUMN extra TEXT", "CREATE VIEW v AS SELECT o.extra FROM other o"],
    [OTHER, "CREATE VIEW v AS SELECT id, label AS lab FROM other", "CREATE VIEW v2 AS SELECT v.lab, v.id FROM v"],
    [OTHER, "CREATE VIEW v AS SELECT * FROM other", "CREATE VIEW v2 AS SELECT v.label FROM v"],
    [OTHER, "CREATE VIEW v AS SELECT x.id FROM (SELECT * FROM other) x"],
    [OTHER, "CREATE VIEW v AS WITH c AS (SELECT id FROM other) SELECT c.id FROM c"],
    [OTHER, "CREATE VIEW v AS WITH c (a, b) AS (SELECT id, label FROM other) SELECT c.a, c.b FROM c"],
    [CONFIG, "CREATE TABLE audit (k TEXT PRIMARY KEY, n INT)", "CREATE TRIGGER t AFTER INSERT ON config BEGIN INSERT INTO audit (k, n) VALUES (NEW.k, 1) ON CONFLICT (k) DO UPDATE SET n = excluded.n + 1; END"],
    ["CREATE POLICY p ON assets AS RESTRICTIVE USING (assets.tenant_id = current_setting('app.tenant', true))"],
    ["CREATE TABLE z (a INT CHECK (z.a > 0))"],
    ["assets2 { id: integer primary key\n label: text }", "CREATE VIEW v AS SELECT a.label FROM assets2 a"],          // a DSL table's columns
    [OTHER, "CREATE TABLE snap AS SELECT o.id, o.label FROM other o"],
  ]);
});

describe("a trigger body is `BEGIN`, SELECT / INSERT / UPDATE / DELETE statements, `END`", () => {
  test("a statement hidden after an early `END;` is not read as body — it is refused (the over-read class)", () => {
    const hs = hazards(CONFIG, "CREATE TRIGGER t AFTER INSERT ON config BEGIN SELECT 1; END; ALTER ROLE scrml_app BYPASSRLS; END");
    expect(kinds(hs)).toEqual([`${OUTSIDE}:t:unattributable`]);
    expect(hs[0].why).toContain("a statement led by `END`");
  });
  charged("leaders", [
    [CONFIG, "CREATE TRIGGER t AFTER INSERT ON config BEGIN WITH x AS (SELECT 1) SELECT * FROM x; END"],
    [CONFIG, "CREATE TRIGGER t AFTER INSERT ON config BEGIN SELECT 1;; END"],
    [CONFIG, "CREATE TRIGGER t AFTER INSERT ON config BEGIN PRAGMA foreign_keys = 0; END"],
    [CONFIG, "CREATE TRIGGER t AFTER INSERT ON config FOR EACH ROW UPDATE config SET v = 'x'"],
  ]);
  clean("leaders", [
    [CONFIG, "CREATE TABLE audit (m TEXT)", "CREATE TRIGGER t AFTER INSERT ON config BEGIN INSERT INTO audit (m) VALUES (NEW.k); UPDATE audit SET m = CASE WHEN m IS NULL THEN 'x' END; DELETE FROM audit WHERE m = ''; SELECT RAISE(ABORT, 'no') WHERE NEW.k = ''; END"],
  ]);
});

describe("ordinary bodies stay clean (no false positive)", () => {
  const ORGS = "CREATE TABLE organizations (id INTEGER PRIMARY KEY, name TEXT NOT NULL)";
  const USERS = "CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL, full_name TEXT, created_at TEXT)";
  const PLANS = "CREATE TABLE plans (id INTEGER PRIMARY KEY, code TEXT, price_cents INTEGER)";
  const AUDIT = "CREATE TABLE audit_log (id INTEGER PRIMARY KEY, entity TEXT, old_value TEXT, new_value TEXT, at TEXT)";
  clean("SaaS", [
    [PLANS, "CREATE VIEW plan_summary AS SELECT p.code, COALESCE(p.price_cents, 0) AS price, CASE WHEN p.price_cents = 0 THEN 'free' ELSE 'paid' END AS tier FROM plans p"],
    [ORGS, USERS, "CREATE VIEW org_counts AS SELECT o.id, o.name, count(u.id) AS n FROM organizations o LEFT JOIN users u ON u.full_name = o.name GROUP BY o.id, o.name"],
    [PLANS, "CREATE VIEW paid_plans AS SELECT code FROM plans WHERE price_cents > (SELECT min(price_cents) FROM plans)"],
    [ORGS, USERS, "CREATE VIEW named_orgs AS SELECT o.id FROM organizations o WHERE EXISTS (SELECT 1 FROM users u WHERE u.full_name = o.name)"],
    [USERS, AUDIT, "CREATE TRIGGER users_audit AFTER UPDATE ON users BEGIN INSERT INTO audit_log (entity, old_value, new_value, at) VALUES ('user', OLD.email, NEW.email, datetime('now')); END"],
    [USERS, "CREATE TRIGGER users_touch AFTER UPDATE ON users FOR EACH ROW WHEN NEW.email <> OLD.email BEGIN UPDATE users SET full_name = coalesce(NEW.full_name, '') WHERE id = NEW.id; END"],
    ["CREATE POLICY iso ON assets AS RESTRICTIVE FOR ALL TO scrml_app USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true))"],
    ["CREATE POLICY iso ON assets AS RESTRICTIVE USING (tenant_id = CAST(current_setting('app.tenant_id', true) AS uuid))"],
    [PLANS, "CREATE VIEW mid_plans AS SELECT code FROM plans WHERE price_cents BETWEEN 100 AND 1000 AND code LIKE 'pro%' AND code NOT IN ('legacy', 'old')"],
    [ORGS, USERS, "CREATE VIEW all_names AS SELECT name FROM organizations UNION ALL SELECT full_name FROM users"],
    [PLANS, "CREATE VIEW cheap AS WITH c AS (SELECT code, price_cents FROM plans WHERE price_cents < 500) SELECT c.code FROM c"],
    [PLANS, "CREATE VIEW plan_stats AS SELECT count(*) FILTER (WHERE price_cents = 0) AS free FROM plans"],
    [USERS, "CREATE VIEW user_norm AS SELECT id, lower(trim(email)) AS e, upper(substr(full_name, 1, 1)) AS initial FROM users"],
  ]);
});

describe("deliberate new refusals — forms outside the closed token set (S455 \"yes, both\")", () => {
  // Each was accepted by the hand-rolled reader; each is outside the subset the floor reads
  // queries in. The message names the offending token so the author can rewrite it.
  for (const [label, stmts, token] of [
    ["a `::` cast (write `CAST(x AS t)`)", [OTHER, "CREATE VIEW v AS SELECT id::text FROM other"], "::"],
    ["a `::` cast in a restrictive policy", ["CREATE POLICY iso ON assets AS RESTRICTIVE USING (tenant_id = current_setting('app.tenant_id', true)::uuid)"], "::"],
    ["a comment inside a body", [OTHER, "CREATE VIEW v AS SELECT id -- the id\n FROM other"], "--"],
    ["a quoted identifier inside a body", [OTHER, `CREATE VIEW v AS SELECT "id" FROM other`], '"'],
    ["a subscript / array literal", [OTHER, "CREATE VIEW v AS SELECT arr[2] FROM other"], "["],
  ]) {
    test(label, () => {
      const b = body(ASSETS, ...stmts);
      const hs = findSchemaTenantHazards(b, schemaTenantTableNames([b]));
      expect(hs.map((h) => h.kind)).toEqual([OUTSIDE]);
      expect(hs[0].why).toContain(`first offending token \`${token}`);
    });
  }
  test("the message names the declaration, the subset, the offending token and its line", () => {
    const b = body(ASSETS, OTHER, "CREATE VIEW v AS SELECT id::text FROM other");
    const [h] = findSchemaTenantHazards(b, schemaTenantTableNames([b]));
    const m = schemaHazardMessage(h, b);
    expect(m.startsWith("E-TENANT-SCHEMA-HAZARD: the body of the view `v`")).toBe(true);
    expect(m).toContain("is outside the tenant SQL subset");
    expect(m).toContain("first offending token `::`");
    expect(m).toContain("(line 4)");
    expect(m).toContain("`CAST(x AS t)` for `x::t`");
    expect(m).toContain("§14.8.10");
  });
  test("a view outside the subset is unattributable: a view over it is charged too", () => {
    const hs = hazards(OTHER, `CREATE VIEW v AS SELECT "id" FROM other`, "CREATE VIEW v2 AS SELECT * FROM v");
    expect(kinds(hs)).toEqual([`${OUTSIDE}:v:unattributable`, "view:v2"]);
  });
  test("a compilation with NO tenant table is unaffected", () => {
    const b = body(OTHER, "CREATE VIEW v AS SELECT id::text, o.evil FROM other o -- c");
    expect(findSchemaTenantHazards(b, schemaTenantTableNames([b]))).toEqual([]);
  });
});

describe("schemaColumnKnowledge — fail-closed column knowledge", () => {
  test("live CREATE / DSL / ALTER ADD; renamed-away and dropped columns removed; commented copies ignored", () => {
    const b = body("CREATE TABLE t (a INT, b TEXT, c TEXT)", "ALTER TABLE t ADD COLUMN d INT", "ALTER TABLE t RENAME COLUMN b TO bb",
      "ALTER TABLE t DROP COLUMN c", "-- CREATE TABLE t (a INT, zz TEXT)");
    expect([...schemaColumnKnowledge([b]).get("t")].sort()).toEqual(["a", "bb", "d"]);
  });
  test("two declarations of one table keep only their common columns", () => {
    const k = schemaColumnKnowledge([body("CREATE TABLE t (a INT, b INT)"), body("CREATE TABLE t (a INT, c INT)")]);
    expect([...k.get("t")]).toEqual(["a"]);
  });
  test("a column only one comment model sees is not known", () => {
    const k = schemaColumnKnowledge([body("CREATE TABLE t (a INT)", "/* /* */ ALTER TABLE t ADD COLUMN evil TEXT; */")]);
    expect([...k.get("t")]).toEqual(["a"]);
  });
});

// ---------------------------------------------------------------------------
// End to end — the TENANT-SCHEMA stage, compilation-wide column knowledge
// ---------------------------------------------------------------------------
const _tmp = [];
afterAll(() => { for (const d of _tmp) { try { rmSync(d, { recursive: true, force: true }); } catch {} } });
function compileFiles(files) {
  const dir = mkdtempSync(join(tmpdir(), "tenant-body-subset-"));
  _tmp.push(dir);
  const paths = Object.entries(files).map(([name, src]) => {
    const p = join(dir, name);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, src);
    return p;
  });
  return compileScrml({ inputFiles: paths, write: true, outputDir: join(dir, "out"), log: () => {} });
}
const prog = (...stmts) => `<program db="app.db">
  <schema>
${stmts.map((s) => `    ${w(s)}`).join("\n")}
  </schema>
  \${
    function mine() {
      return ?{${BT}SELECT id, name FROM assets${BT}}.all()
    }
  }
  <button onclick=\${ mine() }>mine</button>
</program>
`;
const hazardMsgs = (r) => (r.errors ?? []).filter((e) => e.code === "E-TENANT-SCHEMA-HAZARD").map((e) => e.message);

describe("end to end", () => {
  test("`SELECT o.evil FROM other o` in a tenant compilation is a compile error", () => {
    const r = compileFiles({ "app.scrml": prog(ASSETS, OTHER, "CREATE VIEW v AS SELECT o.evil FROM other o") });
    const m = hazardMsgs(r);
    expect(m).toHaveLength(1);
    expect(m[0]).toContain("is outside the tenant SQL subset");
    expect(m[0]).toContain("`o.evil`");
  });
  test("an ordinary non-tenant view and trigger compile clean", () => {
    const r = compileFiles({ "app.scrml": prog(ASSETS, CONFIG, "CREATE TABLE audit (id INTEGER PRIMARY KEY, msg TEXT)",
      "CREATE TRIGGER t_cfg_audit AFTER INSERT ON config BEGIN INSERT INTO audit (msg) VALUES (NEW.k); END",
      "CREATE VIEW cfg_view AS SELECT c.k, c.v FROM config c") });
    expect(hazardMsgs(r)).toEqual([]);
  });
  test("column knowledge is compilation-wide: a view in one file may name a column another file declares", () => {
    const app = prog(ASSETS, OTHER);
    const admin = `<program db="app.db">
  <schema>
    ${w("CREATE VIEW labels AS SELECT o.label FROM other o")}
  </schema>
</program>
`;
    expect(hazardMsgs(compileFiles({ "app.scrml": app, "admin.scrml": admin }))).toEqual([]);
    const evil = admin.replace("o.label", "o.evil");
    expect(hazardMsgs(compileFiles({ "app.scrml": app, "admin.scrml": evil }))).toHaveLength(1);
  });
});
