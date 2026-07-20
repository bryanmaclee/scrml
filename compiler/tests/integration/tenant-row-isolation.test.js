/**
 * §14.8.10 — Server→client confidentiality: tenant-row isolation floor.
 *
 * Two layers:
 *   1. code-firing — each E-TENANT-* / I-TENANT-* fires on the right shape;
 *   2. FULL-BUNDLE EXECUTION — a compiled server bundle is loaded, seeded against
 *      a real sqlite DB, and its route handlers are driven with real Requests:
 *      a request pinned to tenant A sees ONLY tenant-A rows (the floor-added
 *      tenant_id stripped); an unpinned request sees ZERO rows (fail-closed);
 *      `.acrossTenants()` sees all; a non-tenant app is byte-identical.
 *
 * This EXECUTES the emitted code (not a grep of the emitted text) — the standing
 * lesson (S265): a client/server feature's empirical verify must run the bundle.
 */
import { describe, test, expect, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { writeFileSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

const _cleanup = [];
afterAll(() => { for (const d of _cleanup) { try { rmSync(d, { recursive: true, force: true }); } catch {} } });

// Diagnostics across both streams (errors + warnings; W-/I- info is partitioned
// into result.warnings by api.js).
function allDiag(result) {
  return [...(result.errors ?? []), ...(result.warnings ?? [])];
}
function hasCode(result, code) {
  return allDiag(result).some((d) => d.code === code);
}

function tenantProgram(dbBody, dbAbs) {
  return `<program db="${dbAbs}">

  <schema>
    ?{\`CREATE TABLE assets (id INTEGER PRIMARY KEY, name TEXT, tenant_id TEXT)\`}
  </schema>

  <db src="${dbAbs}" tables="assets">
    \${
${dbBody}
    }
  </db>

  <div><p>hi</p></div>
</program>`;
}

function compile(dbBody) {
  const dir = mkdtempSync(join(tmpdir(), "scrml-tenant-"));
  _cleanup.push(dir);
  const dbAbs = join(dir, "app.db");
  const file = join(dir, "app.scrml");
  writeFileSync(file, tenantProgram(dbBody, dbAbs));
  const result = compileScrml({ inputFiles: [file], write: false, log: () => {} });
  return result;
}

// ---------------------------------------------------------------------------
// LAYER 1 — the codes fire on their shapes
// ---------------------------------------------------------------------------
describe("§14.8.10 codes-half — each E-/I-TENANT fires on the right shape", () => {
  test("a tenant-scoped read → I-TENANT-STRIP (never silent)", () => {
    const r = compile(`      function loadAssets() { let rows = ?{\`SELECT id, name FROM assets\`}.all(); return rows }`);
    expect(hasCode(r, "I-TENANT-STRIP")).toBe(true);
  });
  test("UPDATE against a tenant table → E-TENANT-WRITE", () => {
    const r = compile(`      function f() { let x = ?{\`UPDATE assets SET name = \${"z"} WHERE id = \${1}\`}.run(); return x }`);
    expect(hasCode(r, "E-TENANT-WRITE")).toBe(true);
  });
  test("DELETE against a tenant table → E-TENANT-WRITE", () => {
    const r = compile(`      function f() { let x = ?{\`DELETE FROM assets WHERE id = \${1}\`}.run(); return x }`);
    expect(hasCode(r, "E-TENANT-WRITE")).toBe(true);
  });
  test("aggregate over a tenant table without a discriminator → E-TENANT-AGG", () => {
    const r = compile(`      function f() { let x = ?{\`SELECT COUNT(*) AS n FROM assets\`}.get(); return x }`);
    expect(hasCode(r, "E-TENANT-AGG")).toBe(true);
  });
  test("aggregate WITH GROUP BY tenant_id is redactable → NO E-TENANT-AGG (I-TENANT-STRIP instead)", () => {
    const r = compile(`      function f() { let x = ?{\`SELECT tenant_id, COUNT(*) AS n FROM assets GROUP BY tenant_id\`}.all(); return x }`);
    expect(hasCode(r, "E-TENANT-AGG")).toBe(false);
    expect(hasCode(r, "I-TENANT-STRIP")).toBe(true);
  });
  test("a tenant read reaching a manual Response → E-TENANT-RAW-EGRESS", () => {
    const r = compile(`      function f() { let rows = ?{\`SELECT id, name FROM assets\`}.all(); return new Response(JSON.stringify(rows)) }`);
    expect(hasCode(r, "E-TENANT-RAW-EGRESS")).toBe(true);
  });
  test("an INSERT omitting tenant_id is injected → NO E-TENANT-WRITE", () => {
    const r = compile(`      function f() { let x = ?{\`INSERT INTO assets (name) VALUES (\${"z"})\`}.run(); return x }`);
    expect(hasCode(r, "E-TENANT-WRITE")).toBe(false);
  });
  test(".acrossTenants() suppresses E-TENANT-WRITE and fires I-TENANT-ACROSS", () => {
    const r = compile(`      function f() { let x = ?{\`DELETE FROM assets WHERE id = \${1}\`}.acrossTenants().run(); return x }`);
    expect(hasCode(r, "E-TENANT-WRITE")).toBe(false);
    expect(hasCode(r, "I-TENANT-ACROSS")).toBe(true);
  });
  test("the INSERT injection binds the ambient tenant into the column-set", () => {
    const r = compile(`      function f() { let x = ?{\`INSERT INTO assets (name) VALUES (\${"z"})\`}.run(); return x }`);
    const out = [...r.outputs.values()][0];
    expect(out.serverJs).toContain("INSERT INTO assets (name, tenant_id) VALUES (${\"z\"}, ${_scrml_current_user(_scrml_req).tenantId})");
  });
});

// ---------------------------------------------------------------------------
// LAYER 2 — FULL-BUNDLE EXECUTION (the guaranteeing security property)
// ---------------------------------------------------------------------------
describe("§14.8.10 runtime-half — the compiled bundle strips cross-tenant rows", () => {
  const CSRF = "tok-test";

  async function buildAndDrive() {
    const dir = mkdtempSync(join(tmpdir(), "scrml-tenant-exec-"));
    _cleanup.push(dir);
    const dbAbs = join(dir, "app.db");
    // Seed the DB the bundle's `new SQL("sqlite:<dbAbs>")` will read.
    const db = new Database(dbAbs);
    db.run("CREATE TABLE assets (id INTEGER PRIMARY KEY, name TEXT, tenant_id TEXT)");
    db.run("INSERT INTO assets (id, name, tenant_id) VALUES (1,'a1','A'),(2,'a2','A'),(3,'b1','B')");
    db.close();

    const body =
      `      function pin(t) { session.set("tenantId", t); return { ok: true } }\n` +
      `      function loadAssets() { let rows = ?{\`SELECT id, name FROM assets\`}.all(); return rows }\n` +
      `      function loadAcross() { let rows = ?{\`SELECT id, name FROM assets\`}.all().acrossTenants(); return rows }`;
    const file = join(dir, "app.scrml");
    writeFileSync(file, tenantProgram(body, dbAbs));
    const outDir = join(dir, "out");
    compileScrml({ inputFiles: [file], write: true, outputDir: outDir, log: () => {} });

    const mod = await import(join(outDir, "app.server.js") + "?t=" + Date.now());
    const handler = (name) => mod.routes.find((r) => r.path.includes(name)).handler;

    async function call(name, { body = {}, cookies = "" } = {}) {
      const cookie = ["scrml_csrf=" + CSRF, cookies].filter(Boolean).join("; ");
      const req = new Request("http://localhost/_scrml/x", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": CSRF, "Cookie": cookie },
        body: JSON.stringify(body),
      });
      const resp = await handler(name)(req);
      return { json: await resp.json(), setCookie: resp.headers.get("Set-Cookie") || "" };
    }
    return { call };
  }

  test("(a) a request pinned to tenant A sees ONLY tenant-A rows (tenant_id stripped)", async () => {
    const { call } = await buildAndDrive();
    const pin = await call("pin", { body: { t: "A" } });
    const sid = (pin.setCookie.match(/(__Host-scrml_sid=[^;]+)/) || [])[1] || "";
    const rows = await call("loadAssets", { cookies: sid });
    expect(rows.json).toEqual([{ id: 1, name: "a1" }, { id: 2, name: "a2" }]);
    // the floor-added tenant_id never crosses the wire.
    expect(rows.json.every((r) => !("tenant_id" in r))).toBe(true);
  });

  test("(b) an unpinned (anonymous) request sees ZERO rows (fail-closed)", async () => {
    const { call } = await buildAndDrive();
    const rows = await call("loadAssets", {});
    expect(rows.json).toEqual([]);
  });

  test("(c) .acrossTenants() sees ALL tenants' rows", async () => {
    const { call } = await buildAndDrive();
    const rows = await call("loadAcross", {});
    expect(rows.json.map((r) => r.id).sort()).toEqual([1, 2, 3]);
  });

  test("a request pinned to tenant B sees ONLY tenant-B rows", async () => {
    const { call } = await buildAndDrive();
    const pin = await call("pin", { body: { t: "B" } });
    const sid = (pin.setCookie.match(/(__Host-scrml_sid=[^;]+)/) || [])[1] || "";
    const rows = await call("loadAssets", { cookies: sid });
    expect(rows.json).toEqual([{ id: 3, name: "b1" }]);
  });
});

// ---------------------------------------------------------------------------
// (d) NON-TENANT byte-identity — the zero-overhead property
// ---------------------------------------------------------------------------
describe("§14.8.10 non-tenant apps carry zero tenant-floor overhead", () => {
  test("a non-tenant app emits NO tenant-floor machinery", () => {
    const dir = mkdtempSync(join(tmpdir(), "scrml-nontenant-"));
    _cleanup.push(dir);
    const dbAbs = join(dir, "app.db");
    const src = `<program db="${dbAbs}">
  <schema>
    ?{\`CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)\`}
  </schema>
  <db src="${dbAbs}" tables="notes">
    \${
      function loadNotes() { let rows = ?{\`SELECT id, body FROM notes\`}.all(); return rows }
    }
  </db>
  <div><p>hi</p></div>
</program>`;
    const file = join(dir, "app.scrml");
    writeFileSync(file, src);
    const result = compileScrml({ inputFiles: [file], write: false, log: () => {} });
    const out = [...result.outputs.values()][0];
    expect(out.serverJs).not.toContain("_scrml_tenant_");
    expect(out.serverJs).not.toContain("_scrml_active_tenant");
    expect(out.serverJs).not.toContain("tenant_id");
    expect(hasCode(result, "I-TENANT-STRIP")).toBe(false);
  });
});
