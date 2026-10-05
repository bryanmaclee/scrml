/**
 * §14.8.10 — the tenant floor's tenant set is the COMPILATION's (S455).
 *
 * SPEC §14.8.10: *"A table whose `<schema>` carries a `tenant_id` column IS
 * tenant-scoped; the column's presence is the declaration"*, and the invariant —
 * *"a row belonging to tenant A is never observed by code serving a request whose
 * ambient tenant is B, and so never reaches that request"*.
 *
 * Two pre-existing holes, EXECUTED on e014f20ce (progress.md) against a real
 * bun:sqlite file with two seeded tenants, the emitted server module imported and
 * its handlers called with A pinned:
 *
 *   ITEM 1  app.scrml declares `assets (…, tenant_id)` in `<schema>`; admin.scrml
 *           (same database, no `<schema>`) reads `SELECT name FROM assets`. The floor
 *           built its set PER FILE, so admin's read was emitted unfiltered:
 *             return await _scrml_sql`SELECT name FROM assets`;
 *           → pinned A received B's row.
 *   ITEM 2  `CREATE TABLE notes (id, body)` + `ALTER TABLE notes ADD COLUMN tenant_id`
 *           in `<schema>`: only CREATE column lists / DSL heads were read, so `notes`
 *           was not scoped (pinned A received B's note) and a view over it passed the
 *           E-TENANT-SCHEMA-HAZARD checker.
 *
 * The fix: ONE compilation-wide set (`compilationTenantSet`, tenant-egress.ts),
 * computed once by the api.js TENANT-SCHEMA stage and shared with CG; and the shared
 * recognizer (`schemaTableDeclarations`, schema-differ.js) reads `ALTER TABLE`.
 */
import { describe, test, expect, afterAll } from "bun:test";
import { writeFileSync, mkdtempSync, rmSync, readFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { Database } from "bun:sqlite";
import { compileScrml } from "../../src/api.js";
import { schemaTableDeclarations, findTenantDeclarationDisagreements } from "../../src/schema-differ.js";
import { schemaTenantTableNames, findSchemaTenantHazards } from "../../src/tenant-schema-hazards.ts";
import { compilationTenantSet, buildTenantContext } from "../../src/codegen/tenant-egress.ts";

const _tmp = [];
afterAll(() => { for (const d of _tmp) { try { rmSync(d, { recursive: true, force: true }); } catch {} } });

const BT = "`";
const w = (s) => `?{${BT}${s}${BT}}`;
const EMPTY_PROTECT = { protectedByTable: new Map(), schemaByTable: new Map() };

const PIN = `    function pinTenant(t: string) {
      session.set("userId", "u-" + t)
      session.set("tenantId", t)
      return "ok"
    }`;

const APP = `<program db="app.db">
  <schema>
    ${w("CREATE TABLE assets (id INTEGER PRIMARY KEY, name TEXT, tenant_id TEXT)")}
  </schema>
  \${
${PIN}
    function appAssets() {
      return ?{${BT}SELECT name FROM assets ORDER BY id${BT}}.all()
    }
  }
  <button onclick=\${ pinTenant("A") }>x</button>
  <button onclick=\${ appAssets() }>x</button>
</program>
`;
const ADMIN = `<program db="app.db">
  \${
${PIN}
    function adminAssets() {
      return ?{${BT}SELECT name FROM assets ORDER BY id${BT}}.all()
    }
    function adminAll() {
      return ?{${BT}SELECT name FROM assets ORDER BY name${BT}}.acrossTenants().all()
    }
  }
  <button onclick=\${ pinTenant("A") }>x</button>
  <button onclick=\${ adminAssets() }>x</button>
  <button onclick=\${ adminAll() }>x</button>
</program>
`;
const NOTES = `<program db="app.db">
  <schema>
    ${w("CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)")}
    ${w("ALTER TABLE notes ADD COLUMN tenant_id TEXT")}
  </schema>
  \${
${PIN}
    function notesOut() {
      return ?{${BT}SELECT body FROM notes ORDER BY id${BT}}.all()
    }
  }
  <button onclick=\${ pinTenant("A") }>x</button>
  <button onclick=\${ notesOut() }>x</button>
</program>
`;

const SEED = [
  "CREATE TABLE assets (id INTEGER PRIMARY KEY, name TEXT, tenant_id TEXT)",
  "INSERT INTO assets VALUES (1, 'A-asset', 'A'), (2, 'B-secret-asset', 'B')",
  "CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)",
  "ALTER TABLE notes ADD COLUMN tenant_id TEXT",
  "INSERT INTO notes VALUES (1, 'A-note', 'A'), (2, 'B-secret-note', 'B')",
];

function project(files) {
  const dir = mkdtempSync(join(tmpdir(), "tenant-floor-project-"));
  _tmp.push(dir);
  const paths = Object.entries(files).map(([name, src]) => {
    const p = join(dir, name);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, src);
    return p;
  });
  const db = new Database(join(dir, "app.db"), { create: true });
  for (const s of SEED) db.exec(s);
  db.close();
  const out = join(dir, "out");
  const result = compileScrml({ inputFiles: paths, write: true, outputDir: out, log: () => {} });
  return { dir, out, result };
}
const fatal = (r) => (r.errors ?? []).filter((e) => !/^[WI]-/.test(e.code ?? ""));
const diagsIn = (r, file, code) =>
  [...(r.errors ?? []), ...(r.warnings ?? [])].filter((d) => d.code === code &&
    String(d.span?.file ?? d.file ?? d.filePath ?? "").endsWith(file));

const CSRF = "tenant-floor-project-csrf";
async function routesOf(out, serverJs) {
  const mod = await import(`${join(out, serverJs)}?v=${Date.now()}-${Math.random()}`);
  const routes = {};
  for (const r of mod.routes) routes[r.path.replace(/^.*__ri_route_/, "").replace(/_\d+$/, "")] = r;
  return routes;
}
async function req(route, cookie = "", body = {}) {
  return route.handler(new Request(`https://localhost${route.path}`, {
    method: route.method,
    headers: { "Content-Type": "application/json", Cookie: `scrml_csrf=${CSRF}${cookie ? `; ${cookie}` : ""}`, "X-CSRF-Token": CSRF },
    body: JSON.stringify(body),
  }));
}
async function pinned(routes, tenant) {
  const res = await req(routes.pinTenant, "", { t: tenant });
  return res.headers.getSetCookie().map((c) => /(?:__Host-)?scrml_sid=[^;]+/.exec(c)).find(Boolean)[0];
}
async function call(routes, name, cookie) {
  const res = await req(routes[name], cookie);
  expect(res.status).toBe(200);
  return await res.json();
}

// ---------------------------------------------------------------------------
// ITEM 1 — the floor reads the compilation's tenant set
// ---------------------------------------------------------------------------
describe("item 1 — a file whose reads touch a table tenant-scoped in ANOTHER compiled file is filtered", () => {
  test("EXECUTED: admin.scrml (no <schema>) pinned A reads only A's rows; .acrossTenants() still reads all", async () => {
    const p = project({ "app.scrml": APP, "admin.scrml": ADMIN });
    expect(fatal(p.result)).toEqual([]);
    const server = readFileSync(join(p.out, "admin.server.js"), "utf8");
    expect(server).toContain('_scrml_tenant_scope(await _scrml_sql`SELECT name, assets.tenant_id AS __scrml_tenant_0 FROM assets ORDER BY id`');
    expect(server).not.toContain("return await _scrml_sql`SELECT name FROM assets ORDER BY id`;");
    // the scoping is never silent, in the file that reads (exactly as if declared locally)
    expect(diagsIn(p.result, "admin.scrml", "I-TENANT-STRIP").length).toBeGreaterThan(0);
    expect(diagsIn(p.result, "admin.scrml", "I-TENANT-ACROSS").length).toBeGreaterThan(0);
    const admin = await routesOf(p.out, "admin.server.js");
    const a = await pinned(admin, "A");
    expect(await call(admin, "adminAssets", a)).toEqual([{ name: "A-asset" }]);
    expect(await call(admin, "adminAssets", "")).toEqual([]);               // unpinned → zero rows
    expect((await call(admin, "adminAll", a)).map((r) => r.name)).toEqual(["A-asset", "B-secret-asset"]);
    const app = await routesOf(p.out, "app.server.js");
    expect(await call(app, "appAssets", await pinned(app, "B"))).toEqual([{ name: "B-secret-asset" }]);
  });

  test("a write in the other file is held to the floor too (an INSERT naming tenant_id is E-TENANT-WRITE)", () => {
    const writer = `<program db="app.db">
  \${
    function forge() {
      ?{${BT}INSERT INTO assets (name, tenant_id) VALUES ('x', 'B')${BT}}.run()
      return "ok"
    }
  }
  <button onclick=\${ forge() }>x</button>
</program>
`;
    const p = project({ "app.scrml": APP, "writer.scrml": writer });
    expect(fatal(p.result).map((e) => e.code)).toContain("E-TENANT-WRITE");
  });

  test("a kind=\"tool\" program compiled with the declaring file is scoped (outside a request → zero rows)", () => {
    const tool = `<program kind="tool" db="app.db">
  function main(args) -> int {
    let rows = ?{${BT}SELECT name FROM assets${BT}}.all()
    print("rows:" + rows.length)
    return 0
  }
</program>
`;
    const p = project({ "app.scrml": APP, "tool.scrml": tool });
    expect(fatal(p.result)).toEqual([]);
    const run = Bun.spawnSync(["bun", join(p.out, "tool.js")], { cwd: p.dir });
    expect(run.stdout.toString().trim()).toBe("rows:0");
  });

  test("the stated LIMIT: admin.scrml compiled SEPARATELY is not part of this compilation (unchanged)", () => {
    const p = project({ "admin.scrml": ADMIN });
    const server = readFileSync(join(p.out, "admin.server.js"), "utf8");
    expect(server).toContain("await _scrml_sql`SELECT name FROM assets ORDER BY id`");
    expect(server).not.toContain("_scrml_tenant_scope(");
  });

  test("a compilation with no tenant table anywhere is untouched (no floor, no tenant runtime)", () => {
    const plain = ADMIN.replace(/\.acrossTenants\(\)/, "");
    const p = project({ "admin.scrml": plain, "other.scrml": plain.replace(/adminAssets|adminAll/g, (m) => `${m}2`) });
    for (const f of ["admin.server.js", "other.server.js"]) {
      expect(readFileSync(join(p.out, f), "utf8")).not.toContain("_scrml_tenant_");
    }
  });
});

describe("compilationTenantSet / buildTenantContext — one set, shared", () => {
  const fileWith = (body) => ({ filePath: "/x.scrml", nodes: [{ kind: "state", stateType: "schema", children: [{ kind: "text", value: body }] }] });
  test("the union over every file, any database; case-insensitive membership", () => {
    const s = compilationTenantSet([
      fileWith(`\n${w("CREATE TABLE Assets (id INTEGER, tenant_id TEXT)")}\n`),
      fileWith(`\n${w("CREATE TABLE config (k TEXT)")}\n`),
      fileWith(`\n${w("ALTER TABLE notes ADD COLUMN tenant_id TEXT")}\n`),
    ], EMPTY_PROTECT);
    expect([...s.tables].sort()).toEqual(["assets", "notes"]);
    expect(s.tables.has("ASSETS")).toBe(true);
  });
  test("the <db tables=> registry half contributes", () => {
    const s = compilationTenantSet([], { protectedByTable: new Map(), schemaByTable: new Map([["orders", ["id", "TENANT_ID"]]]) });
    expect([...s.tables]).toEqual(["orders"]);
  });
  test("buildTenantContext unions a file's own set with the compilation's (a stale set can never narrow it)", () => {
    const ctx = buildTenantContext(EMPTY_PROTECT, [{ name: "local", columns: [{ name: "tenant_id" }] }], "", undefined,
      { tables: new Set(["assets"]) });
    expect([...ctx.tenantScopedTables].sort()).toEqual(["assets", "local"]);
    expect(buildTenantContext(EMPTY_PROTECT, [], "").tenantScopedTables.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ITEM 2 — `ALTER TABLE … tenant_id` is a declaration
// ---------------------------------------------------------------------------
const tenantOf = (...stmts) => [...schemaTenantTableNames(["\n" + stmts.map((s) => (s.startsWith("--") ? s : w(s))).join("\n") + "\n"])].sort();

describe("item 2 — the shared recognizer reads ALTER TABLE", () => {
  test("ADD COLUMN / ADD (no COLUMN) / IF NOT EXISTS / several actions / quoted names / qualified / IF EXISTS", () => {
    expect(tenantOf("CREATE TABLE notes (id INTEGER)", "ALTER TABLE notes ADD COLUMN tenant_id TEXT")).toEqual(["notes"]);
    expect(tenantOf("ALTER TABLE notes ADD tenant_id TEXT")).toEqual(["notes"]);
    expect(tenantOf("ALTER TABLE notes ADD COLUMN IF NOT EXISTS tenant_id text")).toEqual(["notes"]);
    expect(tenantOf("ALTER TABLE notes ADD COLUMN a INT, ADD COLUMN tenant_id TEXT")).toEqual(["notes"]);
    expect(tenantOf(`ALTER TABLE "notes" ADD COLUMN "tenant_id" TEXT`)).toEqual(["notes"]);
    expect(tenantOf("ALTER TABLE public.notes ADD COLUMN TENANT_ID TEXT")).toEqual(["notes"]);
    expect(tenantOf("ALTER TABLE IF EXISTS notes ADD COLUMN tenant_id TEXT")).toEqual(["notes"]);
    expect(tenantOf("ALTER TABLE ONLY notes ADD COLUMN tenant_id TEXT")).toEqual(["notes", "only"]);
  });
  test("RENAME COLUMN x TO tenant_id and MySQL CHANGE give the table the column", () => {
    expect(tenantOf("ALTER TABLE notes RENAME COLUMN owner TO tenant_id")).toEqual(["notes"]);
    expect(tenantOf("ALTER TABLE notes CHANGE owner tenant_id VARCHAR(64)")).toEqual(["notes"]);
  });
  test("a commented-out ALTER counts (comment-agnostic, like the CREATE reads)", () => {
    expect(tenantOf("CREATE TABLE notes (id INTEGER)", "-- ALTER TABLE notes ADD COLUMN tenant_id TEXT")).toEqual(["notes"]);
  });
  test("a `;` inside a string or a comment does not end the statement early (fail-closed extent)", () => {
    expect(tenantOf("ALTER TABLE notes ADD COLUMN a TEXT DEFAULT ';', ADD COLUMN tenant_id TEXT")).toEqual(["notes"]);
  });
  test("`ALTER COLUMN` (an action of the same statement) and a keyword inside a string or comment are not a statement end", () => {
    expect(tenantOf("ALTER TABLE notes ALTER COLUMN body SET DEFAULT 'x', ADD COLUMN tenant_id TEXT")).toEqual(["notes"]);
    // the string's own `ALTER TABLE x` is ALSO read as a head (literal-agnostic, over-inclusive) — never fewer
    expect(tenantOf("ALTER TABLE notes ADD COLUMN a TEXT DEFAULT 'CREATE ALTER TABLE x', ADD COLUMN tenant_id TEXT")).toEqual(["notes", "x"]);
    // `notes` is NOT cut short by the commented ALTER; the commented ALTER itself also counts (comment-agnostic)
    expect(tenantOf("ALTER TABLE notes /* was: ALTER TABLE y */ ADD COLUMN tenant_id TEXT")).toEqual(["notes", "y"]);
  });
  // S455 review F1 (executed on 2ab1bd7b): a quote / comment form the reader did not model
  // ended the statement early — a `CREATE` inside `[org create]`, `$$ … $$`, a MySQL `#`
  // comment — and the `tenant_id` after it was missed: `notes` unscoped, A read B's note.
  test("F1: an unmodelled quote / comment form never cuts the statement short (ALTER)", () => {
    expect(tenantOf("CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT, [org create] TEXT)",
      "ALTER TABLE notes RENAME COLUMN [org create] TO tenant_id")).toEqual(["notes"]);
    expect(tenantOf("ALTER TABLE notes ADD COLUMN a TEXT DEFAULT $$ CREATE $$, ADD COLUMN tenant_id TEXT")).toEqual(["notes"]);
    expect(tenantOf("ALTER TABLE notes ADD COLUMN x INT # create a column\n, ADD COLUMN tenant_id TEXT")).toEqual(["notes"]);
    expect(tenantOf("ALTER TABLE notes ADD COLUMN a TEXT DEFAULT E'\\' ALTER TABLE z ', ADD COLUMN tenant_id TEXT")).toContain("notes");
    expect(tenantOf("ALTER TABLE notes ADD COLUMN a TEXT DEFAULT 'it\\'s; CREATE', ADD COLUMN tenant_id TEXT")).toContain("notes");
    expect(tenantOf("ALTER TABLE notes ADD COLUMN a TEXT DEFAULT { x }, ADD COLUMN tenant_id TEXT")).toEqual(["notes"]);
  });
  test("F1: the CREATE column list — `$$)$$` closing it early, or `$$($$` never closing it", () => {
    expect(tenantOf("CREATE TABLE notes (id INTEGER, x TEXT DEFAULT $$)$$, tenant_id TEXT)")).toEqual(["notes"]);
    expect(tenantOf("CREATE TABLE notes (id INTEGER, x TEXT DEFAULT $$($$, tenant_id TEXT)")).toEqual(["notes"]);
    expect(tenantOf("CREATE TABLE notes (id INTEGER, [x)] TEXT, tenant_id TEXT)")).toEqual(["notes"]);
    // a modelled statement is still read exactly — no unmodelled form, no widening
    expect(tenantOf("CREATE TABLE notes (id INTEGER, x TEXT DEFAULT ')')")).toEqual([]);
  });
  test("F1 EXECUTED: the `[org create]` repro — `notes` is tenant-scoped and filtered at the source", async () => {
    const src = NOTES
      .replace("CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)", "CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT, [org create] TEXT)")
      .replace("ALTER TABLE notes ADD COLUMN tenant_id TEXT", "ALTER TABLE notes RENAME COLUMN [org create] TO tenant_id");
    // was: compiled clean with a bare `SELECT body FROM notes` (A read B's note). RENAME COLUMN
    // is an admitted ALTER TABLE action (S455 "your rec on the allow-list"), so it compiles —
    // scoped.
    const p = project({ "notes.scrml": src });
    expect(fatal(p.result)).toEqual([]);
    const r = await routesOf(p.out, "notes.server.js");
    expect(await call(r, "notesOut", await pinned(r, "A"))).toEqual([{ body: "A-note" }]);
  });
  test("F1 EXECUTED: a `$$ CREATE $$` default before `ADD COLUMN tenant_id` — scoped at the source; the hazard set agrees", async () => {
    // a replacer FUNCTION: in a replacement STRING `$$` means a single `$`
    const src = NOTES.replace("ALTER TABLE notes ADD COLUMN tenant_id TEXT",
      () => "ALTER TABLE notes ADD COLUMN memo TEXT DEFAULT $$ CREATE $$, ADD COLUMN tenant_id TEXT");
    const p = project({ "notes.scrml": src });
    expect(fatal(p.result)).toEqual([]);
    expect(readFileSync(join(p.out, "notes.server.js"), "utf8"))
      .toContain("_scrml_tenant_scope(await _scrml_sql`SELECT body, notes.tenant_id AS __scrml_tenant_0 FROM notes ORDER BY id`");
    const r = await routesOf(p.out, "notes.server.js");
    expect(await call(r, "notesOut", await pinned(r, "A"))).toEqual([{ body: "A-note" }]);
    const withView = src.replace("</schema>", `  ${w("CREATE VIEW all_notes AS SELECT * FROM notes")}\n  </schema>`);
    expect(fatal(project({ "notes.scrml": withView }).result).map((e) => e.code)).toContain("E-TENANT-SCHEMA-HAZARD");
  });
  test("an ALTER that does not name tenant_id declares nothing; the next statement is not read as its own", () => {
    expect(tenantOf("CREATE TABLE notes (id INTEGER)", "ALTER TABLE notes ADD COLUMN extra TEXT")).toEqual([]);
    expect(tenantOf("ALTER TABLE notes ADD COLUMN extra TEXT", "CREATE TABLE orders (id INTEGER, tenant_id TEXT)")).toEqual(["orders"]);
    expect(tenantOf("CREATE TABLE palter (x INTEGER)", "CREATE TABLE notes (tenant_idx INTEGER)")).toEqual([]);
  });
  test("DELIBERATE OVER-INCLUSION: `tenant_id` anywhere in the ALTER (a DROP, a string) scopes the table", () => {
    expect(tenantOf("ALTER TABLE notes DROP COLUMN tenant_id")).toEqual(["notes"]);
    expect(tenantOf("ALTER TABLE notes ADD COLUMN kind TEXT DEFAULT 'tenant_id'")).toEqual(["notes"]);
  });
  test("schemaTableDeclarations: every declaration of the table carries tenant_id; the ALTER is listed (form alter)", () => {
    const body = `\n${w("CREATE TABLE notes (id INTEGER, body TEXT)")}\n-- CREATE TABLE notes (id INTEGER)\n${w("ALTER TABLE notes ADD COLUMN tenant_id TEXT")}\n`;
    const decls = schemaTableDeclarations(body);
    expect(decls.map((d) => `${d.form}:${d.key}:${d.tenant}`)).toEqual(["raw:notes:true", "raw:notes:true", "alter:notes:true"]);
    expect(decls[0].columns.map((c) => c.name)).toEqual(["id", "body", "tenant_id"]);
  });
  test("E-SCHEMA-015 is QUIET for a CREATE without tenant_id + the ALTER that adds it (they agree)", () => {
    const body = `\n${w("CREATE TABLE notes (id INTEGER, body TEXT)")}\n${w("ALTER TABLE notes ADD COLUMN tenant_id TEXT")}\n`;
    expect(findTenantDeclarationDisagreements(body)).toEqual([]);
  });
  test("the E-TENANT-SCHEMA-HAZARD checker sees the ALTER-added tenant table (a view over it is refused)", () => {
    const body = `\n${w("CREATE TABLE notes (id INTEGER, body TEXT)")}\n${w("ALTER TABLE notes ADD COLUMN tenant_id TEXT")}\n${w("CREATE VIEW all_notes AS SELECT * FROM notes")}\n`;
    const hs = findSchemaTenantHazards(body, schemaTenantTableNames([body]));
    expect(hs.map((h) => `${h.kind}:${h.object}`)).toEqual(["view:all_notes"]);
    // and the ALTER itself (naming its own target) is not charged
    expect(findSchemaTenantHazards(`\n${w("CREATE TABLE notes (id INTEGER)")}\n${w("ALTER TABLE notes ADD COLUMN tenant_id TEXT")}\n`, ["notes"])).toEqual([]);
  });

  test("EXECUTED: reads of `notes` are filtered; pinned A sees only A's note", async () => {
    const p = project({ "notes.scrml": NOTES });
    expect(fatal(p.result)).toEqual([]);
    expect(readFileSync(join(p.out, "notes.server.js"), "utf8"))
      .toContain('_scrml_tenant_scope(await _scrml_sql`SELECT body, notes.tenant_id AS __scrml_tenant_0 FROM notes ORDER BY id`');
    const r = await routesOf(p.out, "notes.server.js");
    expect(await call(r, "notesOut", await pinned(r, "A"))).toEqual([{ body: "A-note" }]);
  });
  test("compile: a hazard over `notes` is refused (E-TENANT-SCHEMA-HAZARD), and so is one in another file", () => {
    const withView = NOTES.replace("</schema>", `  ${w("CREATE VIEW all_notes AS SELECT * FROM notes")}\n  </schema>`);
    expect(fatal(project({ "notes.scrml": withView }).result).map((e) => e.code)).toContain("E-TENANT-SCHEMA-HAZARD");
    const other = `<program db="app.db">
  <schema>
    ${w("CREATE TABLE config (k TEXT)")}
    ${w("CREATE TRIGGER t AFTER INSERT ON config BEGIN UPDATE notes SET body = 'x'; END")}
  </schema>
  <p>x</p>
</program>
`;
    expect(fatal(project({ "notes.scrml": NOTES, "other.scrml": other }).result).map((e) => e.code)).toContain("E-TENANT-SCHEMA-HAZARD");
  });
});
