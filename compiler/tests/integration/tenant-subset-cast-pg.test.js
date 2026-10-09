/**
 * S455 "a" + the S455 review of ee1a80bc, on POSTGRES — LIVE, local-only (skipped when
 * no Postgres answers on /var/run/postgresql, or with SCRML_PGTEST=0; same probe as
 * sql-shared-connection-tx-pg.test.js).
 *
 *   - ruling:user-voice-scrml.md S455 "a": the ONE shared tenant SQL subset admits
 *     `::<built-in type>`. A tenant query `SELECT …, id::int AS n FROM assets` now
 *     compiles (it was E-TENANT-SQL-SUBSET) — and it is STILL filtered at the source:
 *     a request pinned to tenant A receives only A's rows.
 *   - the function allow-list is the database's BUILT-INS: on Postgres `julianday(…)`
 *     is not a built-in (a user function of that name is code — the reviewer executed
 *     a user `raise(int)` that read every tenant), so a tenant query calling it is refused.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { SQL } from "bun";

import { compileScrml } from "../../src/api.js";

// Executed-DB tests (compile, then a real driver round-trip) and the hooks that build them
// declare their own budget: bun's 5 s default is too tight on the slow Windows CI runner
// (g-windows-executed-db-tests-5s-timeout-s460). Per test, never a raised global default.
const EXECUTED_DB_TIMEOUT_MS = 30_000;

const SOCK = "/var/run/postgresql";
const PG_USER = process.env.PGUSER || process.env.USER || "postgres";
const SUFFIX = `${process.pid}`;
const ROLE = `scrml_s455_cast_${SUFFIX}`;
const PW = "scrml_s455_pw";
const DB = `scrml_s455_cast_${SUFFIX}`;
const PG_URL = `postgres://${ROLE}:${PW}@localhost:5432/${DB}`;

let PG_OK = false;
if (process.env.SCRML_PGTEST !== "0" && existsSync(`${SOCK}/.s.PGSQL.5432`)) {
  const probe = new SQL({ path: SOCK, database: "postgres", username: PG_USER });
  PG_OK = await probe.unsafe("SELECT 1").then(() => true).catch(() => false);
  await probe.close().catch(() => {});
}
if (!PG_OK) {
  // eslint-disable-next-line no-console
  console.log(`[tenant-subset-cast-pg] SKIPPED — Postgres not reachable on ${SOCK} (or SCRML_PGTEST=0): the live S455 "a" / rel.f gate did NOT run.`);
  // a NAMED skip, so the report shows the gate did not run (never a vacuous pass)
  test.skip(`[SKIPPED: no Postgres on ${SOCK}] live S455 tenant-subset gate (::int filtered at source; julianday / ::evil_t / assets.evil refused)`, () => {});
}
const d = PG_OK ? describe : describe.skip;

const BT = "`";
const APP = (query) => `<program db="${PG_URL}">
  <schema>
    ?{${BT}CREATE TABLE assets (id integer PRIMARY KEY, name text, tenant_id text)${BT}}
  </schema>
  \${
    function pinTenant(t: string) {
      session.set("userId", "u-" + t)
      session.set("tenantId", t)
      return "ok"
    }
    function mine() {
      return ?{${BT}${query}${BT}}.all()
    }
  }
  <button onclick=\${ pinTenant("A") }>x</button>
  <button onclick=\${ mine() }>x</button>
</program>
`;

const CSRF = "tenant-cast-pg-csrf";
let dir, admin, check;
const opened = [];

async function load(name, query) {
  const file = join(dir, `${name}.scrml`);
  writeFileSync(file, APP(query));
  const out = join(dir, `out-${name}`);
  const r = compileScrml({ inputFiles: [file], outputDir: out, write: true, log: () => {} });
  const errs = (r.errors ?? []).filter((e) => !/^[WI]-/.test(e.code ?? "") && e.severity !== "warning");
  return { errs, out, file: join(out, `${name}.server.js`) };
}
async function routesOf(serverPath) {
  const js = readFileSync(serverPath, "utf8");
  writeFileSync(serverPath, js + "\nexport const __closeSql = () => _scrml_sql.close();\n");
  const mod = await import(`file://${serverPath}?v=${Date.now()}-${Math.random()}`);
  opened.push(mod.__closeSql);
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

d("S455 \"a\" on Postgres — `::int` in a tenant query is accepted and still filtered at the source (live)", () => {
  beforeAll(async () => {
    admin = new SQL({ path: SOCK, database: "postgres", username: PG_USER });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB}`).catch(() => {});
    await admin.unsafe(`DROP ROLE IF EXISTS ${ROLE}`).catch(() => {});
    await admin.unsafe(`CREATE ROLE ${ROLE} LOGIN PASSWORD '${PW}'`);
    await admin.unsafe(`CREATE DATABASE ${DB} OWNER ${ROLE}`);
    check = new SQL(PG_URL);
    await check.unsafe("CREATE TABLE assets (id integer PRIMARY KEY, name text, tenant_id text)");
    await check.unsafe("INSERT INTO assets VALUES (1, 'A-asset', 'A'), (2, 'B-secret-asset', 'B')");
    dir = mkdtempSync(join(tmpdir(), "s455-cast-pg-"));
  }, EXECUTED_DB_TIMEOUT_MS);
  afterAll(async () => {
    for (const c of opened) { try { await c(); } catch { /* closed */ } }
    try { await check?.close(); } catch { /* closed */ }
    try { await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`); } catch { /* gone */ }
    try { await admin?.unsafe(`DROP ROLE IF EXISTS ${ROLE}`); } catch { /* gone */ }
    try { await admin?.close(); } catch { /* closed */ }
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* gone */ }
  });

  test("pinned to A: `SELECT name, id::int AS n FROM assets` returns only A's row", async () => {
    const app = await load("cast", "SELECT name, id::int AS n FROM assets ORDER BY id");
    expect(app.errs.map((e) => e.code)).toEqual([]);
    const js = readFileSync(app.file, "utf8");
    expect(js).toContain("_scrml_tenant_scope(");
    const routes = await routesOf(app.file);
    const pin = await req(routes.pinTenant, "", { t: "A" });
    const cookie = pin.headers.getSetCookie().map((c) => /(?:__Host-)?scrml_sid=[^;]+/.exec(c)).find(Boolean)?.[0] ?? "";
    const res = await req(routes.mine, cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ name: "A-asset", n: 1 }]);
  }, EXECUTED_DB_TIMEOUT_MS);

  test("on Postgres a SQLite built-in name (`julianday`) in a tenant query is refused — not a Postgres built-in", async () => {
    const app = await load("jd", "SELECT name, julianday(name) AS j FROM assets");
    expect(app.errs.map((e) => e.code)).toContain("E-TENANT-AGG");
  });

  test("`rel.f` (S239 r2 of 7761b813): with a user `evil(assets)` in the database, `SELECT assets.evil FROM assets` reads every tenant — refused at compile", async () => {
    await check.unsafe(`CREATE FUNCTION evil(assets) RETURNS text LANGUAGE sql AS $$ SELECT string_agg(name, ',') FROM assets $$`);
    const leak = await check.unsafe("SELECT assets.evil FROM assets WHERE assets.tenant_id = 'A'");
    expect(leak[0].evil).toContain("B-secret-asset");                 // the database does run it
    const app = await load("relf", "SELECT assets.evil FROM assets");
    expect(app.errs.map((e) => e.code)).toContain("E-TENANT-SQL-SUBSET");
  }, EXECUTED_DB_TIMEOUT_MS);

  test("a `::` cast to a type that is not built in is refused", async () => {
    const app = await load("evil", "SELECT name, id::evil_t AS n FROM assets");
    expect(app.errs.map((e) => e.code)).toContain("E-TENANT-SQL-SUBSET");
  });
});
