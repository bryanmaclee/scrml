/**
 * §14.8.10 — tenant-row isolation floor: pure resolvers + the SHIPPED runtime
 * helper (eval'd), exercised in isolation. The end-to-end compile + full-bundle
 * execution lives in tests/integration/tenant-row-isolation.test.js.
 */
import { describe, test, expect } from "bun:test";
import {
  buildTenantContext,
  resolveTenantScoping,
  rewriteSelectAddTenantId,
  classifyTenantWrite,
  rewriteInsertAddTenantId,
  detectTenantRawEgress,
  wrapWithTenantTag,
  SERVER_TENANT_HELPER,
  TENANT_COLUMN,
} from "../../src/codegen/tenant-egress.ts";
import { SERVER_PROTECT_HELPER } from "../../src/codegen/protect-egress.ts";

// A ProtectContext-shaped stub: schemaByTable drives tenant detection.
function protectCtx(schema) {
  return { protectedByTable: new Map(), schemaByTable: new Map(Object.entries(schema)) };
}
const ctxAssets = () => buildTenantContext(protectCtx({ assets: ["id", "name", "tenant_id"], config: ["k", "v"] }));

// Eval the SHIPPED helper block so we exercise the EXACT runtime the server
// bundle ships (not a re-implementation). `_scrml_current_user` is stubbed so
// `_scrml_active_tenant` can resolve an ambient tenant.
function loadHelper() {
  const fn = new Function(
    SERVER_TENANT_HELPER +
      "\nreturn { _scrml_tenant_tag, _scrml_tenant_tag_all, _scrml_tenant_redact, _scrml_active_tenant };",
  );
  return fn();
}

// ---------------------------------------------------------------------------
// buildTenantContext — the `tenant_id` column convention IS the declaration
// ---------------------------------------------------------------------------
describe("§14.8.10 buildTenantContext — tenant_id column presence = declaration", () => {
  test("a table with a tenant_id column is tenant-scoped; one without is not", () => {
    const ctx = ctxAssets();
    expect(ctx.tenantScopedTables.has("assets")).toBe(true);
    expect(ctx.tenantScopedTables.has("config")).toBe(false);
  });
  test("no tenant_id column anywhere → EMPTY set (tenant inactive, zero overhead)", () => {
    const ctx = buildTenantContext(protectCtx({ users: ["id", "name"], config: ["k", "v"] }));
    expect(ctx.tenantScopedTables.size).toBe(0);
  });
  test("detection is case-insensitive on the column name", () => {
    const ctx = buildTenantContext(protectCtx({ orders: ["id", "TENANT_ID"] }));
    expect(ctx.tenantScopedTables.has("orders")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resolveTenantScoping — read classification
// ---------------------------------------------------------------------------
describe("§14.8.10 resolveTenantScoping — read scoping", () => {
  const ctx = ctxAssets();
  test("SELECT * over a tenant table → read, tenant_id already present (no floor-add)", () => {
    const sc = resolveTenantScoping("SELECT * FROM assets", ctx);
    expect(sc).toEqual({ kind: "read", floorAdd: false, tenantCol: "tenant_id", table: "assets" });
  });
  test("explicit projection WITHOUT tenant_id → read, floor-add", () => {
    const sc = resolveTenantScoping("SELECT id, name FROM assets", ctx);
    expect(sc).toEqual({ kind: "read", floorAdd: true, tenantCol: "tenant_id", table: "assets" });
  });
  test("explicit projection WITH tenant_id (aliased) → read, no floor-add, keyed on the alias", () => {
    const sc = resolveTenantScoping("SELECT id, tenant_id AS tid FROM assets", ctx);
    expect(sc).toEqual({ kind: "read", floorAdd: false, tenantCol: "tid", table: "assets" });
  });
  test("a read over a NON-tenant table → null (no floor)", () => {
    expect(resolveTenantScoping("SELECT k, v FROM config", ctx)).toBeNull();
  });
  test("aggregate without GROUP BY tenant_id → agg (E-TENANT-AGG)", () => {
    const sc = resolveTenantScoping("SELECT COUNT(*) AS n FROM assets", ctx);
    expect(sc).toEqual({ kind: "agg", table: "assets" });
  });
  test("aggregate WITH GROUP BY tenant_id → redactable read, not agg", () => {
    const sc = resolveTenantScoping("SELECT tenant_id, COUNT(*) AS n FROM assets GROUP BY tenant_id", ctx);
    expect(sc && sc.kind).toBe("read");
  });
  test("unresolvable read (CTE) mentioning a tenant table → strip-all (fail-closed)", () => {
    const sc = resolveTenantScoping("WITH t AS (SELECT * FROM assets) SELECT * FROM t", ctx);
    expect(sc).toEqual({ kind: "strip" });
  });
  test("unresolvable read NOT mentioning a tenant table → null (do not nuke non-tenant CTE)", () => {
    expect(resolveTenantScoping("WITH t AS (SELECT * FROM config) SELECT * FROM t", ctx)).toBeNull();
  });
  test("tenant INACTIVE → always null (byte-identical)", () => {
    const empty = buildTenantContext(protectCtx({ users: ["id"] }));
    expect(resolveTenantScoping("SELECT id FROM assets", empty)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// rewriteSelectAddTenantId — the deterministic projection-column add
// ---------------------------------------------------------------------------
describe("§14.8.10 rewriteSelectAddTenantId — projection-column add (NOT a WHERE-parse)", () => {
  const ctx = ctxAssets();
  test("adds tenant_id just before FROM, preserving the WHERE + ${} params", () => {
    const sc = resolveTenantScoping("SELECT id, name FROM assets WHERE id = ${x}", ctx);
    const out = rewriteSelectAddTenantId("SELECT id, name FROM assets WHERE id = ${x}", sc);
    expect(out).toBe("SELECT id, name, tenant_id FROM assets WHERE id = ${x}");
  });
  test("qualifies with the tenant table's alias in a multi-table FROM", () => {
    const sc = resolveTenantScoping("SELECT a.id, u.name FROM assets a JOIN users u ON a.uid = u.id", ctx);
    const out = rewriteSelectAddTenantId("SELECT a.id, u.name FROM assets a JOIN users u ON a.uid = u.id", sc);
    expect(out).toContain(", a.tenant_id FROM");
  });
  test("no-op when tenant_id already projected (floorAdd false)", () => {
    const sc = resolveTenantScoping("SELECT * FROM assets", ctx);
    expect(rewriteSelectAddTenantId("SELECT * FROM assets", sc)).toBe("SELECT * FROM assets");
  });
});

// ---------------------------------------------------------------------------
// classifyTenantWrite — inject-or-hard-fail
// ---------------------------------------------------------------------------
describe("§14.8.10 classifyTenantWrite — inject-or-hard-fail", () => {
  const ctx = ctxAssets();
  test("INSERT omitting tenant_id → insert-inject (OK)", () => {
    expect(classifyTenantWrite("INSERT INTO assets (name) VALUES (${n})", ctx)).toEqual({ kind: "insert-inject", table: "assets" });
  });
  test("INSERT already setting tenant_id → hard-fail (floor cannot verify the chosen tenant)", () => {
    expect(classifyTenantWrite("INSERT INTO assets (name, tenant_id) VALUES (${n}, ${t})", ctx)).toEqual({ kind: "hard-fail", table: "assets", op: "INSERT" });
  });
  test("multi-row INSERT → hard-fail (not safely injectable)", () => {
    expect(classifyTenantWrite("INSERT INTO assets (name) VALUES (${a}), (${b})", ctx)).toEqual({ kind: "hard-fail", table: "assets", op: "INSERT" });
  });
  test("UPDATE → hard-fail", () => {
    expect(classifyTenantWrite("UPDATE assets SET name = ${n} WHERE id = ${i}", ctx)).toEqual({ kind: "hard-fail", table: "assets", op: "UPDATE" });
  });
  test("DELETE → hard-fail", () => {
    expect(classifyTenantWrite("DELETE FROM assets WHERE id = ${i}", ctx)).toEqual({ kind: "hard-fail", table: "assets", op: "DELETE" });
  });
  test("write to a NON-tenant table → null (no floor)", () => {
    expect(classifyTenantWrite("DELETE FROM config WHERE k = ${k}", ctx)).toBeNull();
  });
  test("a SELECT is not a write → null", () => {
    expect(classifyTenantWrite("SELECT id FROM assets", ctx)).toBeNull();
  });
});

describe("§14.8.10 rewriteInsertAddTenantId", () => {
  test("injects tenant_id column + the ambient value param", () => {
    const out = rewriteInsertAddTenantId("INSERT INTO assets (name) VALUES (${n})", "_scrml_current_user(_scrml_req).tenantId");
    expect(out).toBe("INSERT INTO assets (name, tenant_id) VALUES (${n}, ${_scrml_current_user(_scrml_req).tenantId})");
  });
});

// ---------------------------------------------------------------------------
// detectTenantRawEgress — E-TENANT-RAW-EGRESS
// ---------------------------------------------------------------------------
describe("§14.8.10 detectTenantRawEgress — the E-PROTECT-004 sibling", () => {
  const ctx = ctxAssets();
  test("tenant read + a manual new Response in the same body → flagged", () => {
    const body = "let r = ?{`SELECT id FROM assets`}.all(); return new Response(JSON.stringify(r))";
    expect(detectTenantRawEgress(body, ctx)).not.toBeNull();
  });
  test("a `.acrossTenants()` anywhere in the body SUPPRESSES it", () => {
    const body = "let r = ?{`SELECT id FROM assets`}.all().acrossTenants(); return new Response(JSON.stringify(r))";
    expect(detectTenantRawEgress(body, ctx)).toBeNull();
  });
  test("tenant read but NO raw egress → not flagged (the floor strips normally)", () => {
    expect(detectTenantRawEgress("let r = ?{`SELECT id FROM assets`}.all(); return r", ctx)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The SHIPPED runtime helper — tag + redact on real rows (EXECUTED)
// ---------------------------------------------------------------------------
describe("§14.8.10 SERVER_TENANT_HELPER — the shipped tag/redact runtime (eval'd)", () => {
  const rowsAB = () => [
    { id: 1, name: "a1", tenant_id: "A" },
    { id: 2, name: "a2", tenant_id: "A" },
    { id: 3, name: "b1", tenant_id: "B" },
  ];

  test("tag(floorAdded) then redact(A) → only tenant-A rows, tenant_id stripped", () => {
    const H = loadHelper();
    const tagged = H._scrml_tenant_tag(rowsAB(), "tenant_id", true);
    const out = H._scrml_tenant_redact(tagged, "A");
    expect(out).toEqual([{ id: 1, name: "a1" }, { id: 2, name: "a2" }]);
  });

  test("redact with a NULL ambient tenant (unpinned) → ZERO rows (fail-closed)", () => {
    const H = loadHelper();
    const tagged = H._scrml_tenant_tag(rowsAB(), "tenant_id", true);
    expect(H._scrml_tenant_redact(tagged, null)).toEqual([]);
  });

  test("tag(floorAdded=false) → keeps tenant_id in output for the matching tenant", () => {
    const H = loadHelper();
    const tagged = H._scrml_tenant_tag(rowsAB(), "tenant_id", false);
    // floorAdded=false passes the surviving row through as-is (the descriptor
    // Symbol rides along but is JSON-invisible); compare the wire shape.
    const out = H._scrml_tenant_redact(tagged, "B");
    expect(JSON.parse(JSON.stringify(out))).toEqual([{ id: 3, name: "b1", tenant_id: "B" }]);
  });

  test("a single .get() row of the wrong tenant → null; of the right tenant → the row", () => {
    const H = loadHelper();
    const rowB = H._scrml_tenant_tag({ id: 3, name: "b1", tenant_id: "B" }, "tenant_id", true);
    expect(H._scrml_tenant_redact(rowB, "A")).toBeNull();
    const rowB2 = H._scrml_tenant_tag({ id: 3, name: "b1", tenant_id: "B" }, "tenant_id", true);
    expect(H._scrml_tenant_redact(rowB2, "B")).toEqual({ id: 3, name: "b1" });
  });

  test("strip-all tag → zero rows regardless of the ambient tenant", () => {
    const H = loadHelper();
    const tagged = H._scrml_tenant_tag_all(rowsAB());
    expect(H._scrml_tenant_redact(tagged, "A")).toEqual([]);
  });

  test("UNtagged rows (acrossTenants / non-tenant) pass through unchanged", () => {
    const H = loadHelper();
    const plain = rowsAB();
    expect(H._scrml_tenant_redact(plain, "A")).toEqual(rowsAB());
  });

  test("the descriptor is Symbol-keyed → invisible to JSON.stringify", () => {
    const H = loadHelper();
    const tagged = H._scrml_tenant_tag([{ id: 1, tenant_id: "A" }], "tenant_id", false);
    expect(JSON.parse(JSON.stringify(tagged))).toEqual([{ id: 1, tenant_id: "A" }]);
  });

  test("composition: preserves the §14.8.9 protect descriptor Symbol on survivors", () => {
    const H = loadHelper();
    const PROT = Symbol.for("scrml.protect.origin");
    const rows = [{ id: 1, name: "a1", secret: "s", tenant_id: "A" }];
    rows[0][PROT] = { cols: ["secret"], revealed: [] };
    const tagged = H._scrml_tenant_tag(rows, "tenant_id", true);
    const out = H._scrml_tenant_redact(tagged, "A");
    // tenant redact stripped the floor-added tenant_id but kept the protect Symbol
    // so a subsequent protect-redact still sees which column to strip.
    expect(out[0][PROT]).toEqual({ cols: ["secret"], revealed: [] });
    expect("tenant_id" in out[0]).toBe(false);
  });

  test("_scrml_active_tenant is null-safe when no _scrml_current_user resolver exists", () => {
    const H = loadHelper();
    expect(H._scrml_active_tenant({})).toBeNull();
  });

  test("INTEGER tenant_id column vs STRING session key — string-coerced match (S239 fix)", () => {
    // SQLite very commonly stores tenant_id as an INTEGER, while the session
    // scalar (`session.set("tenantId", …)` / `@currentUser.tenantId`) is a STRING
    // per §14.8.10. A strict `!==` (1 !== "1") would silently drop the CORRECT
    // tenant's rows (fail-closed footgun). Both sides are String()-coerced.
    const H = loadHelper();
    const intRows = () => [
      { id: 1, name: "a1", tenant_id: 1 },
      { id: 2, name: "a2", tenant_id: 1 },
      { id: 3, name: "b1", tenant_id: 2 },
    ];
    // ambient key is the STRING "1" — the tenant-1 (integer) rows SURVIVE.
    const t1 = H._scrml_tenant_redact(H._scrml_tenant_tag(intRows(), "tenant_id", true), "1");
    expect(t1).toEqual([{ id: 1, name: "a1" }, { id: 2, name: "a2" }]);
    // a wrong-tenant STRING key "2" → only the integer-2 row.
    const t2 = H._scrml_tenant_redact(H._scrml_tenant_tag(intRows(), "tenant_id", true), "2");
    expect(t2).toEqual([{ id: 3, name: "b1" }]);
    // unpinned (null) still → ZERO rows (fail-closed; the null-guard runs first).
    const anon = H._scrml_tenant_redact(H._scrml_tenant_tag(intRows(), "tenant_id", true), null);
    expect(anon).toEqual([]);
    // a single .get() integer row of the matching tenant survives; wrong → null.
    const okGet = H._scrml_tenant_redact(H._scrml_tenant_tag({ id: 1, name: "a1", tenant_id: 1 }, "tenant_id", true), "1");
    expect(okGet).toEqual({ id: 1, name: "a1" });
    const noGet = H._scrml_tenant_redact(H._scrml_tenant_tag({ id: 3, name: "b1", tenant_id: 2 }, "tenant_id", true), "1");
    expect(noGet).toBeNull();
  });

  test("COMPOSITION with §14.8.9 protect — the exact emitted sink, both shipped helpers", () => {
    // The emitted lowering:  _scrml_tenant_tag(_scrml_protect_tag(rows, [cols]), "tenant_id", true)
    // The emitted sink:      _scrml_protect_redact(_scrml_tenant_redact(result, ambientTenant))
    const H = new Function(
      SERVER_PROTECT_HELPER + SERVER_TENANT_HELPER +
        "\nreturn { _scrml_protect_tag, _scrml_protect_redact, _scrml_tenant_tag, _scrml_tenant_redact };",
    )();
    let rows = [
      { id: 1, name: "ua", passwordHash: "secretA", tenant_id: "A" },
      { id: 2, name: "ub", passwordHash: "secretB", tenant_id: "B" },
    ];
    rows = H._scrml_tenant_tag(H._scrml_protect_tag(rows, ["passwordHash"]), "tenant_id", true);
    const out = H._scrml_protect_redact(H._scrml_tenant_redact(rows, "A"));
    // tenant B dropped (isolation) + passwordHash stripped (protect) + floor-added
    // tenant_id stripped — all three at the composed sink.
    expect(out).toEqual([{ id: 1, name: "ua" }]);
  });
});

// ---------------------------------------------------------------------------
// wrapWithTenantTag — emitted wrap text
// ---------------------------------------------------------------------------
describe("§14.8.10 wrapWithTenantTag", () => {
  test("read scoping → `_scrml_tenant_tag(<inner>, \"tenant_id\", <floorAdd>)`", () => {
    expect(wrapWithTenantTag("ROWS", { kind: "read", floorAdd: true, tenantCol: TENANT_COLUMN, table: "assets" }))
      .toBe('_scrml_tenant_tag(ROWS, "tenant_id", true)');
  });
  test("strip scoping → `_scrml_tenant_tag_all(<inner>)`", () => {
    expect(wrapWithTenantTag("ROWS", { kind: "strip" })).toBe("_scrml_tenant_tag_all(ROWS)");
  });
  test("null / agg → no wrap", () => {
    expect(wrapWithTenantTag("ROWS", null)).toBe("ROWS");
    expect(wrapWithTenantTag("ROWS", { kind: "agg", table: "assets" })).toBe("ROWS");
  });
});
