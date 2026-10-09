/**
 * s457 — `scrml dev` runs the §14.8.10 undeclared-tenant-table startup check, with the SAME
 * gate `scrml build`'s `_server.js` runs.
 *
 * Ruling (user-voice-scrml.md S456, "b, startup check lands with it"): a table carrying
 * `tenant_id` that is not declared tenant-scoped is refused where the compiler can see it and
 * CHECKED AT STARTUP where it cannot. The check is part of the tenant floor, not of one
 * command — and an undeclared tenant table fails open (its rows reach every request
 * unscoped) under `scrml dev` exactly as under a built server.
 *
 * Before: only `_server.js` (commands/build.js) carried the gate, as emitted text; `scrml
 * dev`'s `loadServerRoutes` skipped every module's `_scrml_tenant_startup_check` export, so a
 * dev server answered 200 over a database holding an undeclared `tenant_id` table, and had
 * no `/_scrml/health` at all.
 *
 * Now the gate is ONE text (codegen/tenant-startup-check.ts `TENANT_GATE_LINES`): `_server.js`
 * emits it verbatim, `scrml dev` runs it in-process (`createTenantGate`).
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Database } from "bun:sqlite";
import { compileScrml } from "../../src/api.js";
import { generateServerEntry, describeServerUnit } from "../../src/commands/build.js";
import {
  loadServerRoutes,
  buildServeConfig,
  noteCompileResult,
  getRegisteredTenantGate,
  devTenantGateResponse,
} from "../../src/commands/dev.js";
import { TENANT_GATE_LINES, createTenantGate } from "../../src/codegen/tenant-startup-check.ts";

// Executed-DB tests (compile, then a real driver round-trip) and the hooks that build them
// declare their own budget: bun's 5 s default is too tight on the slow Windows CI runner
// (g-windows-executed-db-tests-5s-timeout-s460). Per test, never a raised global default.
const EXECUTED_DB_TIMEOUT_MS = 30_000;

const BT = "`";

describe("one gate, two hosts", () => {
  test("`_server.js` carries TENANT_GATE_LINES verbatim — the text `scrml dev` runs", () => {
    const unit = describeServerUnit(
      "export const __ri_route_x_1 = { path: '/x', method: 'POST', handler: () => null };\n" +
      "export const _scrml_tenant_startup_check = { undeclared: async () => [] };\n",
      "app.server.js",
    );
    const entry = generateServerEntry([unit]);
    expect(entry).toContain("const _SCRML_TENANT_CHECKS = [_scrml_tc_0];\n" + TENANT_GATE_LINES.join("\n") + "\n");
  });

  test("a finding refuses every request (503) and the health route names only a count", async () => {
    const errs = [];
    const origError = console.error;
    console.error = (m) => errs.push(String(m));
    try {
      const gate = createTenantGate([{ undeclared: async () => [{ db: "./app.db", table: "invoices", error: null }] }]);
      const res = await devTenantGateResponse(gate, "/app.html");
      expect(res.status).toBe(503);
      expect(await res.text()).toBe("Service Unavailable");
      const health = await devTenantGateResponse(gate, "/_scrml/health");
      expect(health.status).toBe(503);
      const body = await health.json();
      expect(body.status).toBe("unavailable");
      expect(body.reason).toBe("1 undeclared tenant table(s) or unchecked database(s) — see the server log");
      expect(JSON.stringify(body)).not.toContain("invoices");
    } finally {
      console.error = origError;
    }
    expect(errs.join("\n")).toContain('E-DEPLOY-DB-TENANT-UNDECLARED: database ./app.db holds "invoices"');
  });

  test("a check that throws is refused (fail-closed); a clean one serves", async () => {
    const origError = console.error;
    console.error = () => {};
    try {
      const broken = createTenantGate([{ undeclared: async () => { throw new Error("no such host"); } }]);
      expect((await devTenantGateResponse(broken, "/x")).status).toBe(503);
    } finally {
      console.error = origError;
    }
    const clean = createTenantGate([{ undeclared: async () => [] }]);
    expect(await devTenantGateResponse(clean, "/x")).toBeNull();
    const health = await devTenantGateResponse(clean, "/_scrml/health");
    expect(health.status).toBe(200);
    expect((await health.json()).status).toBe("ok");
  });
});

// ---------------------------------------------------------------------------
// End to end in-process: a REAL compiled module, mounted the way `scrml dev` mounts it
// (`loadServerRoutes` + `buildServeConfig().fetch`), over a SQLite database the compile
// never opens (`<program db=>`), seeded with an undeclared `tenant_id` table.
// ---------------------------------------------------------------------------

describe("scrml dev's app server refuses while an undeclared tenant table exists (SQLite)", () => {
  let root, dist, db, fetchApp;
  const origError = console.error;
  const logged = [];

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), "s457-dev-tenant-"));
    writeFileSync(join(root, "scrml.toml"), "");
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "app.scrml"), `<program db="./app.db">
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
`);
    db = join(root, "src", "app.db");
    const seed = new Database(db, { create: true });
    seed.run("CREATE TABLE assets (id INTEGER PRIMARY KEY, name TEXT, tenant_id TEXT)");
    seed.run("CREATE TABLE invoices (id INTEGER PRIMARY KEY, amount INTEGER, tenant_id TEXT)");
    seed.close();
    dist = join(root, "dist");
    const r = compileScrml({ inputFiles: [join(root, "src", "app.scrml")], outputDir: dist, write: true, log: () => {} });
    expect((r.errors ?? []).filter((e) => (e.severity ?? "error") === "error").map((e) => e.code)).toEqual([]);
    noteCompileResult({ errors: [] });
    console.error = (m) => logged.push(String(m));
    await loadServerRoutes(dist);
    const config = buildServeConfig({ port: 0 }, dist);
    fetchApp = (path) => config.fetch(new Request(`http://localhost${path}`), null);
  }, EXECUTED_DB_TIMEOUT_MS);

  afterAll(async () => {
    console.error = origError;
    // Leave the module registry with no gate for any later test in this process.
    const empty = mkdtempSync(join(tmpdir(), "s457-dev-empty-"));
    await loadServerRoutes(empty);
    rmSync(empty, { recursive: true, force: true });
    // Windows keeps the loaded server module's SQLite file locked for the life of the
    // process (EBUSY); the test preload's per-process temp root removes it at exit.
    try {
      rmSync(root, { recursive: true, force: true });
    } catch (e) {
      if (!(process.platform === "win32" && e?.code === "EBUSY")) throw e;
    }
  });

  test("the module's check is mounted as a gate, not a route; every request answers 503", async () => {
    expect(getRegisteredTenantGate()).not.toBeNull();
    expect((await fetchApp("/app.html")).status).toBe(503);
    const health = await fetchApp("/_scrml/health");
    expect(health.status).toBe(503);
    expect(JSON.stringify(await health.json())).not.toContain("invoices");
    expect(logged.join("\n")).toContain('E-DEPLOY-DB-TENANT-UNDECLARED: database ./app.db holds "invoices"');
    expect(logged.join("\n")).not.toContain('holds "assets"');
  }, EXECUTED_DB_TIMEOUT_MS);

  test("renaming the column clears it: the health probe re-checks, then the app is served", async () => {
    const fix = new Database(db);
    fix.run("ALTER TABLE invoices RENAME COLUMN tenant_id TO org");
    fix.close();
    const health = await fetchApp("/_scrml/health");
    expect(health.status).toBe(200);
    expect((await health.json()).status).toBe("ok");
    expect((await fetchApp("/app.html")).status).toBe(200);
  }, EXECUTED_DB_TIMEOUT_MS);
});
