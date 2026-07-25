/**
 * §14.8.11 A1/S2 — wrapPrincipalTxn scope-awareness (regression for the S239 HIGH).
 *
 * The transform MUST wrap only `_scrml_sql` query sites that are lexically inside
 * a function with `_scrml_req` in scope (a server-fn handler, directly or via a
 * closure). It MUST NOT touch the compiler-emitted MODULE-LEVEL infra helpers —
 * the `_scrml_idempotency_*` shadow-table functions take no `_scrml_req`, query a
 * non-tenant bookkeeping table, and would (a) reference an undefined `_scrml_req`
 * and (b) run under the un-granted bounded role if wrapped.
 */
import { describe, test, expect, afterAll } from "bun:test";
import { writeFileSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { spawnSync } from "child_process";
import { wrapPrincipalTxn } from "../../src/codegen/db-authoritative.ts";

const _tmp = [];
afterAll(() => { for (const d of _tmp) { try { rmSync(d, { recursive: true, force: true }); } catch {} } });

// The VERBATIM compiler-emitted idempotency shadow-table helpers (module-level,
// no _scrml_req). Kept byte-faithful to emit-server.ts so the regression tracks
// the real emitted shape (including the CREATE TABLE via .unsafe and the
// try/catch INSERT/UPDATE tagged templates).
const IDEMPOTENCY_HELPERS = [
  "let _scrml_idempotency_table_ready = false;",
  "async function _scrml_idempotency_ensure_table() {",
  "  if (_scrml_idempotency_table_ready) return;",
  "  await _scrml_sql.unsafe(`CREATE TABLE IF NOT EXISTS _scrml_idempotency_keys (key TEXT PRIMARY KEY, response_body TEXT NOT NULL, response_status INTEGER NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)`);",
  "  _scrml_idempotency_table_ready = true;",
  "}",
  "async function _scrml_idempotency_lookup(key) {",
  "  if (!key) return null;",
  "  await _scrml_idempotency_ensure_table();",
  "  const now = Date.now();",
  "  const rows = await _scrml_sql`SELECT response_body, response_status, expires_at FROM _scrml_idempotency_keys WHERE key = ${key} LIMIT 1`;",
  "  if (!rows || rows.length === 0) return null;",
  "  const row = rows[0];",
  "  if (row.expires_at <= now) return null;",
  "  return { response_body: row.response_body, response_status: row.response_status };",
  "}",
  "async function _scrml_idempotency_store(key, body, status) {",
  "  if (!key) return;",
  "  await _scrml_idempotency_ensure_table();",
  "  const now = Date.now();",
  "  const expires = now + 1000;",
  "  try {",
  "    await _scrml_sql`INSERT INTO _scrml_idempotency_keys (key, response_body, response_status, created_at, expires_at) VALUES (${key}, ${body}, ${status}, ${now}, ${expires})`;",
  "  } catch (_e) {",
  "    await _scrml_sql`UPDATE _scrml_idempotency_keys SET response_body = ${body}, response_status = ${status}, created_at = ${now}, expires_at = ${expires} WHERE key = ${key}`;",
  "  }",
  "}",
].join("\n");

// A server-fn handler with a direct query AND a query inside an arrow IIFE
// (closure over the handler's _scrml_req — the real emitted shape).
const HANDLERS = [
  "async function _scrml_handler_list(_scrml_req) {",
  "  const rows = await _scrml_sql.unsafe(\"select id from invoices\");",
  "  const one = await (async () => {",
  "    return await _scrml_sql`select id from invoices where id = ${_scrml_req}`;",
  "  })();",
  "  return rows;",
  "}",
].join("\n");

const MODULE = [
  'import { SQL } from "bun";',
  'const _scrml_sql = new SQL("postgres://x/y");',
  IDEMPOTENCY_HELPERS,
  HANDLERS,
].join("\n\n");

function nodeCheck(src) {
  const dir = mkdtempSync(join(tmpdir(), "dbauth-wrap-"));
  _tmp.push(dir);
  const f = join(dir, "out.mjs");
  writeFileSync(f, src);
  return spawnSync("node", ["--check", f], { encoding: "utf8" });
}

describe("§14.8.11 wrapPrincipalTxn — scope-aware A1 wrapping", () => {
  const out = wrapPrincipalTxn(MODULE);

  test("the transformed module is syntactically valid (node --check)", () => {
    const r = nodeCheck(out);
    expect(r.status).toBe(0);
  });

  test("both handler query sites are wrapped in a principal .begin() txn", () => {
    // one for `.unsafe(select id …)`, one for the closure tagged-template.
    const begins = out.match(/_scrml_sql\.begin\(async \(tx\) => \{/g) || [];
    expect(begins.length).toBe(2);
    expect(out).toContain('return await tx.unsafe("select id from invoices")');
    expect(out).toContain("return await tx`select id from invoices where id = ${_scrml_req}`");
  });

  test("the module-level idempotency helpers are LEFT UNTOUCHED (no wrap, no undefined _scrml_req)", () => {
    // The three helpers appear verbatim — never wrapped, never role-dropped.
    expect(out).toContain(
      "await _scrml_sql.unsafe(`CREATE TABLE IF NOT EXISTS _scrml_idempotency_keys",
    );
    expect(out).toContain(
      "const rows = await _scrml_sql`SELECT response_body, response_status, expires_at FROM _scrml_idempotency_keys",
    );
    expect(out).toContain(
      "await _scrml_sql`INSERT INTO _scrml_idempotency_keys",
    );
    // `_scrml_active_tenant(_scrml_req)` appears EXACTLY once per wrapped handler
    // query (2), never inside an infra helper lacking _scrml_req.
    const tenantRefs = out.match(/_scrml_active_tenant\(_scrml_req\)/g) || [];
    expect(tenantRefs.length).toBe(2);
    // The idempotency region carries none of the A1 markers.
    const idemStart = out.indexOf("_scrml_idempotency_table_ready");
    const idemEnd = out.indexOf("async function _scrml_handler_list");
    const idemRegion = out.slice(idemStart, idemEnd);
    expect(idemRegion).not.toContain(".begin(async (tx)");
    expect(idemRegion).not.toContain("_scrml_active_tenant");
    expect(idemRegion).not.toContain("SET LOCAL ROLE");
  });

  test("the module-level handle declaration is not wrapped", () => {
    expect(out).toContain('const _scrml_sql = new SQL("postgres://x/y");');
  });
});
