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
// S456 review F2 — a database DOWN AT BOOT: ordinary requests (no health probe) re-check
// under a bounded backoff, so the server serves once the database answers.
// ---------------------------------------------------------------------------

/** Only reads → REFERENCES the database (§8.1.1): never creates it, so it can be missing at boot. */
const REFERENCING = `<program db="./app.db">
  \${
    function count() {
      const rows = ?{${BT}SELECT n FROM t${BT}}.all()
      return rows.length
    }
  }
  <button onclick=\${ count() }>go</button>
</program>
`;

/** Build `src/app.scrml` in a fresh project; returns its root. */
async function buildProject(source) {
  const parent = mkdtempSync(join(tmpdir(), "s456-f2-"));
  const root = join(parent, "proj");
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "scrml.toml"), "");
  writeFileSync(join(root, "src", "app.scrml"), source);
  const build = Bun.spawn(["bun", CLI, "build", join(root, "src"), "-o", join(root, "dist")], {
    cwd: root, stdout: "pipe", stderr: "pipe", stdin: "ignore",
  });
  expect(await build.exited).toBe(0);
  return { parent, root };
}

describe("F7/F9 (S456 \"a, fix F7/F9 too\") — the startup check reads generated and hidden columns (pragma_table_xinfo)", () => {
  test("SQLite: a GENERATED tenant_id column and an fts4 languageid=\"tenant_id\" are reported", async () => {
    const dir = mkdtempSync(join(tmpdir(), "s456-xinfo-"));
    const data = mkdtempSync(join(tmpdir(), "s456-xinfo-data-"));
    const prev = process.env.SCRML_DATA_DIR;
    try {
      mkdirSync(join(dir, "src"), { recursive: true });
      writeFileSync(join(dir, "scrml.toml"), "");
      writeFileSync(join(dir, "src", "app.scrml"), APP("./app.db"));
      const r = compileScrml({ inputFiles: [join(dir, "src", "app.scrml")], outputDir: join(dir, "dist"), write: true, log: () => {} });
      expect((r.errors ?? []).filter((e) => e.severity === "error").map((e) => e.code)).toEqual([]);
      mkdirSync(join(data, "src"), { recursive: true });
      const db = new Database(join(data, "src", "app.db"), { create: true });
      db.run("CREATE TABLE assets (id INTEGER PRIMARY KEY, name TEXT, tenant_id TEXT)");
      db.run("CREATE TABLE gen (id INTEGER, tenant_id TEXT GENERATED ALWAYS AS ('A') VIRTUAL)");
      db.run(`CREATE VIRTUAL TABLE f4 USING fts4(body, languageid="tenant_id")`);
      // the pre-fix reading (`pragma_table_info`) sees neither
      const old = db.query("SELECT m.name AS name FROM sqlite_master m, pragma_table_info(m.name) p WHERE lower(p.name) = 'tenant_id'").all().map((x) => x.name);
      expect(old).toEqual(["assets"]);
      db.close();
      process.env.SCRML_DATA_DIR = data;
      const mod = await importFresh(join(dir, "dist", "app.server.js"));
      const found = await mod._scrml_tenant_startup_check.undeclared();
      expect(found.map((f) => f.table).sort()).toEqual(["f4", "gen"]);
    } finally {
      if (prev === undefined) delete process.env.SCRML_DATA_DIR; else process.env.SCRML_DATA_DIR = prev;
      rmSync(dir, { recursive: true, force: true });
      rmSync(data, { recursive: true, force: true });
    }
  });
});

describe("F2 — a database down at boot: the server serves once it comes up, with no health probe", () => {
  test("SQLite: missing at boot → 503 ('could not be checked'); created → a plain request gets 200", async () => {
    const { parent, root } = await buildProject(REFERENCING);
    const data = mkdtempSync(join(tmpdir(), "s456-f2-data-"));
    const port = await freePort();
    let err = "";
    const proc = Bun.spawn(["bun", join(root, "dist", "_server.js")], {
      cwd: root, stdout: "pipe", stderr: "pipe", stdin: "ignore",
      env: { ...process.env, PORT: String(port), SCRML_DATA_DIR: data },
    });
    (async () => { for await (const c of proc.stderr) err += new TextDecoder().decode(c); })();
    try {
      let first = null;
      for (const t0 = Date.now(); Date.now() - t0 < 15_000 && !first; await Bun.sleep(100)) {
        try { first = await fetch(`http://localhost:${port}/app.html`); } catch { /* not up yet */ }
      }
      expect(first?.status).toBe(503);
      expect(err).toContain("could not be checked — the connection or the catalogue query failed");
      expect(err).not.toContain('holds "');
      // the database comes up (seeded with a non-tenant table) — no health probe from here on
      mkdirSync(join(data, "src"), { recursive: true });
      const db = new Database(join(data, "src", "app.db"), { create: true });
      db.run("CREATE TABLE t (n INTEGER)");
      db.close();
      let status = 0;
      for (const t0 = Date.now(); Date.now() - t0 < 40_000 && status !== 200; await Bun.sleep(250)) {
        status = (await fetch(`http://localhost:${port}/app.html`)).status;
      }
      expect(status).toBe(200);
      expect(err).toContain("the undeclared-tenant-table check now passes; serving.");
      // one finding set is logged once, not on every re-check
      expect(err.split("could not be checked").length - 1).toBe(1);
    } finally {
      proc.kill();
      await proc.exited;
      rmSync(parent, { recursive: true, force: true });
      rmSync(data, { recursive: true, force: true });
    }
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

  test("F9 on Postgres: a GENERATED tenant_id column is in pg_attribute (attnum > 0, not dropped) and is reported", async () => {
    await check.unsafe("CREATE TABLE gen (id integer, tenant_id text GENERATED ALWAYS AS ('A') STORED)");
    const found = await mod._scrml_tenant_startup_check.undeclared();
    expect(found.map((f) => f.table)).toContain("public.gen");
    await check.unsafe("DROP TABLE gen");
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

  test("F2 on Postgres: the database does not exist at boot (Postgres starting after the app) → 503; created → a plain request gets 200", async () => {
    const DB2 = `${DB}_late`;
    const url2 = `postgres://${ROLE}:${PW}@localhost:5432/${DB2}`;
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB2}`).catch(() => {});
    const { parent, root } = await buildProject(APP(url2));
    const port = await freePort();
    let err = "";
    const proc = Bun.spawn(["bun", join(root, "dist", "_server.js")], {
      cwd: root, stdout: "pipe", stderr: "pipe", stdin: "ignore",
      env: { ...process.env, PORT: String(port) },
    });
    (async () => { for await (const c of proc.stderr) err += new TextDecoder().decode(c); })();
    try {
      let first = null;
      for (const t0 = Date.now(); Date.now() - t0 < 20_000 && !first; await Bun.sleep(100)) {
        try { first = await fetch(`http://localhost:${port}/app.html`); } catch { /* not up yet */ }
      }
      expect(first?.status).toBe(503);
      expect(err).toContain("could not be checked");
      expect(err).not.toContain(PW);
      await admin.unsafe(`CREATE DATABASE ${DB2} OWNER ${ROLE}`);
      let status = 0;
      for (const t0 = Date.now(); Date.now() - t0 < 45_000 && status !== 200; await Bun.sleep(250)) {
        status = (await fetch(`http://localhost:${port}/app.html`)).status;
      }
      expect(status).toBe(200);
    } finally {
      proc.kill();
      await proc.exited;
      rmSync(parent, { recursive: true, force: true });
      await admin.unsafe(`DROP DATABASE IF EXISTS ${DB2} WITH (FORCE)`).catch(() => {});
    }
  });
});
