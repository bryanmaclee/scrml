/**
 * CONF-TENANT-FLOOR | §14.8.10 — tenant-row isolation floor
 *
 * The conformance surface pin (merge-blocker) for the V1-minimal tenant floor.
 * BOTH halves:
 *   - codes-half: each E-TENANT-{AGG,WRITE,RAW-EGRESS} + I-TENANT-{STRIP,ACROSS}
 *     fires on its shape (and does NOT fire off-shape / in a non-tenant app);
 *   - runtime-half: the compiled bundle, EXECUTED against a real sqlite DB,
 *     strips cross-tenant rows (tenant A sees only A), fails closed when unpinned
 *     (zero rows), and passes all rows through under `.acrossTenants()`.
 *
 * Catalog (SPEC §34, §14.8.10): E-TENANT-AGG / E-TENANT-WRITE / E-TENANT-RAW-EGRESS
 * (Error); I-TENANT-STRIP / I-TENANT-ACROSS (Info). Firing sites: the source scan
 * in codegen/emit-server.ts (hard-fails), and the rewriter/sink drains
 * (I-TENANT-STRIP / I-TENANT-ACROSS); tag/redact runtime in codegen/tenant-egress.ts.
 */
import { describe, test, expect, afterAll, beforeAll } from "bun:test";
import { Database } from "bun:sqlite";
import { writeFileSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

const _tmp = [];
afterAll(() => { for (const d of _tmp) { try { rmSync(d, { recursive: true, force: true }); } catch {} } });

function tenantApp(body, dbAbs) {
  return `<program db="${dbAbs}">
  <schema>
    ?{\`CREATE TABLE assets (id INTEGER PRIMARY KEY, name TEXT, tenant_id TEXT)\`}
  </schema>
  <db src="${dbAbs}" tables="assets">
    \${
${body}
    }
  </db>
  <div><p>hi</p></div>
</program>`;
}

function compile(body) {
  const dir = mkdtempSync(join(tmpdir(), "conf-tenant-"));
  _tmp.push(dir);
  const dbAbs = join(dir, "app.db");
  const file = join(dir, "app.scrml");
  writeFileSync(file, tenantApp(body, dbAbs));
  const r = compileScrml({ inputFiles: [file], write: false, log: () => {} });
  return { r, dir };
}
const codes = (r) => new Set([...(r.errors ?? []), ...(r.warnings ?? [])].map((d) => d.code));

describe("CONF-TENANT-FLOOR (codes-half): each code fires on its shape", () => {
  test("I-TENANT-STRIP — a tenant-scoped read (never silent)", () => {
    const { r } = compile(`      function f() { let x = ?{\`SELECT id, name FROM assets\`}.all(); return x }`);
    expect(codes(r).has("I-TENANT-STRIP")).toBe(true);
  });
  test("E-TENANT-AGG — a bare aggregate over a tenant table", () => {
    const { r } = compile(`      function f() { let x = ?{\`SELECT COUNT(*) AS n FROM assets\`}.get(); return x }`);
    expect(codes(r).has("E-TENANT-AGG")).toBe(true);
  });
  test("E-TENANT-WRITE — an UPDATE against a tenant table", () => {
    const { r } = compile(`      function f() { let x = ?{\`UPDATE assets SET name = \${"z"} WHERE id = \${1}\`}.run(); return x }`);
    expect(codes(r).has("E-TENANT-WRITE")).toBe(true);
  });
  test("E-TENANT-RAW-EGRESS — a tenant read reaching a manual Response", () => {
    const { r } = compile(`      function f() { let x = ?{\`SELECT id FROM assets\`}.all(); return new Response(JSON.stringify(x)) }`);
    expect(codes(r).has("E-TENANT-RAW-EGRESS")).toBe(true);
  });
  test("I-TENANT-ACROSS — a `.acrossTenants()` opt-out (suppresses the hard-fail)", () => {
    const { r } = compile(`      function f() { let x = ?{\`DELETE FROM assets WHERE id = \${1}\`}.acrossTenants().run(); return x }`);
    expect(codes(r).has("I-TENANT-ACROSS")).toBe(true);
    expect(codes(r).has("E-TENANT-WRITE")).toBe(false);
  });
  test("off-shape: an INSERT omitting tenant_id is injected (no E-TENANT-WRITE)", () => {
    const { r } = compile(`      function f() { let x = ?{\`INSERT INTO assets (name) VALUES (\${"z"})\`}.run(); return x }`);
    expect(codes(r).has("E-TENANT-WRITE")).toBe(false);
  });
});

describe("CONF-TENANT-FLOOR (runtime-half): the executed bundle isolates rows", () => {
  // Fixed double-submit CSRF token. The emitted gate is pure double-submit
  // (`cookieToken.length>0 && cookieToken===headerToken`), so a matching
  // cookie+header pair passes deterministically for any value.
  const CSRF = "conf-tok";
  let _seq = 0;
  beforeAll(() => { globalThis.__scrml_session_stores = {}; globalThis.__scrml_session_store = new Map(); });

  // The runtime-half asserts the tenant REDACT, so it establishes the ambient
  // tenant DETERMINISTICALLY: seed the compiled bundle's OWN session store (found
  // by key-diff after import, robust to how `import.meta.dir` resolves the store
  // path) with a `{tenantId}` record — no session-establishing `pin` POST, no
  // CSRF-synchronizer round-trip, no `?t=` import query (all environment-fragile;
  // the session flow is §20.5's surface, not what this pins). `pin` stays in the
  // app only so the session store + middleware are emitted; the test never calls it.
  async function drive(tenant) {
    const dir = mkdtempSync(join(tmpdir(), "conf-tenant-exec-"));
    _tmp.push(dir);
    const dbAbs = join(dir, "app.db");
    const db = new Database(dbAbs);
    db.run("CREATE TABLE assets (id INTEGER PRIMARY KEY, name TEXT, tenant_id TEXT)");
    db.run("INSERT INTO assets (id, name, tenant_id) VALUES (1,'a1','A'),(2,'a2','A'),(3,'b1','B')");
    db.close();
    const body =
      `      function pin(t) { session.set("tenantId", t); return { ok: true } }\n` +
      `      function loadAssets() { let x = ?{\`SELECT id, name FROM assets\`}.all(); return x }\n` +
      `      function loadAcross() { let x = ?{\`SELECT id, name FROM assets\`}.all().acrossTenants(); return x }`;
    const file = join(dir, "app.scrml");
    writeFileSync(file, tenantApp(body, dbAbs));
    const outDir = join(dir, "out");
    compileScrml({ inputFiles: [file], write: true, outputDir: outDir, log: () => {} });
    const before = new Set(Object.keys(globalThis.__scrml_session_stores));
    const mod = await import(join(outDir, "app.server.js"));
    const sid = "sid-" + (++_seq);
    if (tenant != null) {
      const key = Object.keys(globalThis.__scrml_session_stores).find((k) => !before.has(k));
      globalThis.__scrml_session_stores[key].set(sid, { tenantId: tenant }, 3600);
    }
    const h = (n) => mod.routes.find((r) => r.path.includes(n)).handler;
    async function call(name, { cookies = "" } = {}) {
      const cookie = ["scrml_csrf=" + CSRF, cookies].filter(Boolean).join("; ");
      const req = new Request("http://localhost/_scrml/x", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": CSRF, Cookie: cookie },
        body: JSON.stringify({}),
      });
      const resp = await h(name)(req);
      return { json: await resp.json() };
    }
    return { call, sid };
  }

  test("tenant A → only A rows; unpinned → zero; acrossTenants → all", async () => {
    const { call, sid } = await drive("A");

    const a = await call("loadAssets", { cookies: "__Host-scrml_sid=" + sid });
    expect(a.json).toEqual([{ id: 1, name: "a1" }, { id: 2, name: "a2" }]); // A only, tenant_id stripped

    const anon = await call("loadAssets", {}); // no session cookie → ambient tenant absent
    expect(anon.json).toEqual([]); // fail-closed

    const across = await call("loadAcross", {});
    expect(across.json.map((r) => r.id).sort()).toEqual([1, 2, 3]); // all
  });
});
