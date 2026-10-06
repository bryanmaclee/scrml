/**
 * §14.8.10 (S456) — the BUILT SERVER refuses to serve while a database it opens holds a
 * `tenant_id` table outside the compiled tenant set.
 *
 * Ruling (user-voice-scrml.md S456, "b, startup check lands with it"): a table carrying
 * `tenant_id` that is not declared tenant-scoped (no `<schema>`, no `<db tables=>`) is
 * refused where the compiler can see it (E-TENANT-UNDECLARED — tenant-undeclared.test.js)
 * and checked at startup where it cannot: Postgres / anything unreadable at compile time
 * → the built server refuses to start (`/_scrml/health` 503) when the database holds a
 * `tenant_id` table outside the compiled tenant set.
 *
 * Mechanism: every server module with a database handle exports
 * `_scrml_tenant_startup_check` (codegen/tenant-startup-check.ts); `_server.js`
 * (commands/build.js `generateServerEntry`) runs every one before serving, answers 503
 * to every request while any finding stands, and re-runs the check on each
 * `/_scrml/health` probe.
 */

import { describe, test, expect, setDefaultTimeout, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, readFileSync, existsSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { Database } from "bun:sqlite";
import { SQL } from "bun";
import { compileScrml } from "../../src/api.js";
import { generateServerEntry, describeServerUnit } from "../../src/commands/build.js";
import { tenantStartupCheckLines } from "../../src/codegen/tenant-startup-check.ts";

// Builds a project, spawns a server: the 5 s default is too tight under a loaded run.
setDefaultTimeout(60_000);

const testDir = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(testDir, "../../src/cli.js");
const BT = "`";

const APP = (db) => `<program db="${db}">
  <schema>
    ?{${BT}CREATE TABLE assets (id INTEGER PRIMARY KEY, name TEXT, tenant_id TEXT)${BT}}
  </schema>
  \${
    function listAssets() {
      return ?{${BT}SELECT name FROM assets${BT}}.all()
    }
  }
  <button onclick=\${ listAssets() }>list</button>
</program>
`;

async function freePort() {
  const s = Bun.serve({ port: 0, fetch: () => new Response("") });
  const port = s.port;
  s.stop(true);
  return port;
}

const importFresh = (path) => import(`file://${path}?v=${Date.now()}-${Math.random()}`);

// ---------------------------------------------------------------------------
// The server entry and the module export
// ---------------------------------------------------------------------------

describe("_server.js wiring", () => {
  test("a module exporting the check is not a route; the entry imports it under an alias and gates on it", () => {
    const unit = describeServerUnit(
      "export const __ri_route_x_1 = { path: '/x', method: 'POST', handler: () => null };\n" +
      "export const _scrml_tenant_startup_check = { undeclared: async () => [] };\n",
      "app.server.js",
    );
    expect(unit.routeNames).toEqual(["__ri_route_x_1"]);
    expect(unit.tenantStartupCheck).toBe(true);
    const entry = generateServerEntry([unit]);
    expect(entry).toContain('import { __ri_route_x_1, _scrml_tenant_startup_check as _scrml_tc_0 } from "./app.server.js";');
    expect(entry).toContain("const _SCRML_TENANT_CHECKS = [_scrml_tc_0];");
    expect(entry).toContain('if (new URL(req.url).pathname !== "/_scrml/health" && (await _scrml_tenant_refusals(false)) > 0) {');
    expect(entry).toContain("const undeclared = await _scrml_tenant_refusals(true);");
  });

  test("a module without the export: no tenant gate, and the unit record is unchanged", () => {
    const unit = describeServerUnit("export const __ri_route_x_1 = { path: '/x', method: 'POST', handler: () => null };\n", "app.server.js");
    expect("tenantStartupCheck" in unit).toBe(false);
    expect(generateServerEntry([unit])).not.toContain("_scrml_tenant");
  });

  test("the module export bakes the compilation's tenant set (lowercased) and redacts a connection secret", () => {
    const lines = tenantStartupCheckLines(
      [{ ident: "_scrml_sql", driver: "postgres", connection: "postgres://app:s3cret@db:5432/prod" }],
      ["Assets", "orders"],
    ).join("\n");
    expect(lines).toContain('const _SCRML_TENANT_DECLARED = new Set(["assets","orders"]);');
    expect(lines).toContain("export const _scrml_tenant_startup_check = {");
    expect(lines).toContain('driver: "postgres"');
    expect(lines).not.toContain("s3cret");
    expect(tenantStartupCheckLines([], ["assets"])).toEqual([]);
  });

  test("a compiled server module exports the check over its handle", () => {
    const dir = mkdtempSync(join(tmpdir(), "s456-mod-"));
    try {
      writeFileSync(join(dir, "app.scrml"), APP("./app.db"));
      const r = compileScrml({ inputFiles: [join(dir, "app.scrml")], outputDir: join(dir, "dist"), write: true, log: () => {} });
      expect((r.errors ?? []).filter((e) => e.severity === "error").map((e) => e.code)).toEqual([]);
      const js = readFileSync(join(dir, "dist", "app.server.js"), "utf8");
      expect(js).toContain('const _SCRML_TENANT_DECLARED = new Set(["assets"]);');
      expect(js).toContain('{ handle: _scrml_sql, driver: "sqlite", label: "./app.db" },');
      // server-only: nothing of it reaches the client bundle
      const clientFiles = ["app.client.js"].map((f) => join(dir, "dist", f)).filter(existsSync);
      for (const f of clientFiles) expect(readFileSync(f, "utf8")).not.toContain("_scrml_tenant_startup_check");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// End to end on SQLite: `scrml build`, then run `_server.js` against a seeded database
// ---------------------------------------------------------------------------

describe("the built server refuses to serve while an undeclared tenant table exists (SQLite)", () => {
  let parent, root, data, proc, port, err;

  beforeAll(async () => {
    parent = mkdtempSync(join(tmpdir(), "s456-build-"));
    root = join(parent, "proj");
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "scrml.toml"), "");
    writeFileSync(join(root, "src", "app.scrml"), APP("./app.db"));
    const build = Bun.spawn(["bun", CLI, "build", join(root, "src"), "-o", join(root, "dist")], {
      cwd: root, stdout: "pipe", stderr: "pipe", stdin: "ignore",
    });
    expect(await build.exited).toBe(0);
    data = mkdtempSync(join(tmpdir(), "s456-data-"));
    mkdirSync(join(data, "src"), { recursive: true });
    const db = new Database(join(data, "src", "app.db"), { create: true });
    db.run("CREATE TABLE assets (id INTEGER PRIMARY KEY, name TEXT, tenant_id TEXT)");
    db.run("CREATE TABLE invoices (id INTEGER PRIMARY KEY, amount INTEGER, tenant_id TEXT)");
    db.run("INSERT INTO invoices (amount, tenant_id) VALUES (10, 'A'), (99, 'B')");
    db.close();
    port = await freePort();
    err = "";
    proc = Bun.spawn(["bun", join(root, "dist", "_server.js")], {
      cwd: root, stdout: "pipe", stderr: "pipe", stdin: "ignore",
      env: { ...process.env, PORT: String(port), SCRML_DATA_DIR: data },
    });
    (async () => { for await (const c of proc.stderr) err += new TextDecoder().decode(c); })();
  });

  afterAll(async () => {
    try { proc?.kill(); await proc?.exited; } catch { /* gone */ }
    rmSync(parent, { recursive: true, force: true });
    rmSync(data, { recursive: true, force: true });
  });

  test("503 on /_scrml/health and on every other request; the log names the table and the fix", async () => {
    let res = null;
    for (const t0 = Date.now(); Date.now() - t0 < 15_000 && !res; await Bun.sleep(100)) {
      try { res = await fetch(`http://localhost:${port}/_scrml/health`); } catch { /* not up yet */ }
    }
    expect(res?.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe("unavailable");
    expect(JSON.stringify(body)).not.toContain("invoices"); // the public route names no table
    expect((await fetch(`http://localhost:${port}/app.html`)).status).toBe(503);
    expect((await fetch(`http://localhost:${port}/__ri_route_listAssets_1`, { method: "POST" })).status).toBe(503);
    expect(err).toContain('E-DEPLOY-DB-TENANT-UNDECLARED: database ./app.db holds "invoices"');
    expect(err).toContain("declare the table in <schema> so the tenant floor scopes it");
    expect(err).toContain("rename the column");
    expect(err).not.toContain('holds "assets"'); // the declared table is not reported
  });

  test("renaming the column clears it: the next health probe re-checks, then the server serves", async () => {
    const db = new Database(join(data, "src", "app.db"));
    db.run("ALTER TABLE invoices RENAME COLUMN tenant_id TO org");
    db.close();
    const ok = await fetch(`http://localhost:${port}/_scrml/health`);
    expect(ok.status).toBe(200);
    expect((await ok.json()).status).toBe("ok");
    expect((await fetch(`http://localhost:${port}/app.html`)).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Live Postgres (local-only; a NAMED skip when none answers) — the Postgres branch
// ---------------------------------------------------------------------------

const SOCK = "/var/run/postgresql";
const PG_USER = process.env.PGUSER || process.env.USER || "postgres";
const SUFFIX = `${process.pid}`;
const ROLE = `scrml_s456_tu_${SUFFIX}`;
const PW = "scrml_s456_pw";
const DB = `scrml_s456_tu_${SUFFIX}`;
const PG_URL = `postgres://${ROLE}:${PW}@localhost:5432/${DB}`;

let PG_OK = false;
if (process.env.SCRML_PGTEST !== "0" && existsSync(`${SOCK}/.s.PGSQL.5432`)) {
  const probe = new SQL({ path: SOCK, database: "postgres", username: PG_USER });
  PG_OK = await probe.unsafe("SELECT 1").then(() => true).catch(() => false);
  await probe.close().catch(() => {});
}
if (!PG_OK) {
  // eslint-disable-next-line no-console
  console.log(`[tenant-undeclared-startup] SKIPPED — Postgres not reachable on ${SOCK} (or SCRML_PGTEST=0): the live Postgres startup check did NOT run.`);
  test.skip(`[SKIPPED: no Postgres on ${SOCK}] live S456 startup check (undeclared tenant table on Postgres)`, () => {});
}
const d = PG_OK ? describe : describe.skip;

d("the startup check on Postgres (live)", () => {
  let admin, check, dir, mod;

  beforeAll(async () => {
    admin = new SQL({ path: SOCK, database: "postgres", username: PG_USER });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB}`).catch(() => {});
    await admin.unsafe(`DROP ROLE IF EXISTS ${ROLE}`).catch(() => {});
    await admin.unsafe(`CREATE ROLE ${ROLE} LOGIN PASSWORD '${PW}'`);
    await admin.unsafe(`CREATE DATABASE ${DB} OWNER ${ROLE}`);
    check = new SQL(PG_URL);
    await check.unsafe("CREATE TABLE assets (id integer PRIMARY KEY, name text, tenant_id text)");
    await check.unsafe("CREATE TABLE plain (id integer PRIMARY KEY, label text)");
    dir = mkdtempSync(join(tmpdir(), "s456-pg-"));
    writeFileSync(join(dir, "app.scrml"), APP(PG_URL));
    const r = compileScrml({ inputFiles: [join(dir, "app.scrml")], outputDir: join(dir, "dist"), write: true, log: () => {} });
    expect((r.errors ?? []).filter((e) => e.severity === "error").map((e) => e.code)).toEqual([]);
    const file = join(dir, "dist", "app.server.js");
    writeFileSync(file, readFileSync(file, "utf8") + "\nexport const __closeSql = () => _scrml_sql.close();\n");
    mod = await importFresh(file);
  });

  afterAll(async () => {
    try { await mod?.__closeSql(); } catch { /* closed */ }
    try { await check?.close(); } catch { /* closed */ }
    try { await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`); } catch { /* gone */ }
    try { await admin?.unsafe(`DROP ROLE IF EXISTS ${ROLE}`); } catch { /* gone */ }
    try { await admin?.close(); } catch { /* closed */ }
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* gone */ }
  });

  test("only declared tenant tables: nothing to refuse", async () => {
    expect(await mod._scrml_tenant_startup_check.undeclared()).toEqual([]);
  });

  test("an undeclared tenant table (and a view carrying tenant_id) in any schema is reported, schema-qualified; the URI's password is not", async () => {
    await check.unsafe("CREATE TABLE invoices (id integer PRIMARY KEY, amount integer, TENANT_ID text)");
    await check.unsafe("CREATE SCHEMA ext");
    await check.unsafe("CREATE TABLE ext.notes (id integer, tenant_id text)");
    await check.unsafe("CREATE VIEW all_assets AS SELECT * FROM assets");
    const found = await mod._scrml_tenant_startup_check.undeclared();
    expect(found.map((f) => f.table).sort()).toEqual(["ext.notes", "public.all_assets", "public.invoices"]);
    for (const f of found) {
      expect(f.error).toBe(null);
      expect(f.db).not.toContain(PW);
    }
  });

  test("a partition of a declared table is not reported; renaming the column clears a finding", async () => {
    await check.unsafe("DROP VIEW all_assets");
    await check.unsafe("DROP TABLE ext.notes");
    await check.unsafe("ALTER TABLE invoices RENAME COLUMN tenant_id TO org");
    await check.unsafe("CREATE TABLE events (id integer, at date, tenant_id text) PARTITION BY RANGE (at)");
    await check.unsafe("CREATE TABLE events_2026 PARTITION OF events FOR VALUES FROM ('2026-01-01') TO ('2027-01-01')");
    const found = await mod._scrml_tenant_startup_check.undeclared();
    // `events` itself is undeclared (reported once, by its parent name); its partition is not
    expect(found.map((f) => f.table)).toEqual(["public.events"]);
  });
});
