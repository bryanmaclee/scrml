/**
 * §14.8.10 — tenant-row isolation floor: pure resolvers + the SHIPPED runtime
 * helper, exercised in isolation. The end-to-end compile + full-bundle execution
 * lives in tests/integration/tenant-row-isolation.test.js.
 *
 * ⚑ TWO LOADERS, AND THE DIFFERENCE IS LOAD-BEARING — this header used to claim
 * a fidelity it did not have. `loadHelper()` uses `new Function`, which is
 * SLOPPY mode. The emitted `app.server.js` carries top-level `import`/`export`,
 * so it is an ES module and therefore ALWAYS STRICT. For almost every property
 * asserted here the two modes agree and `loadHelper()` is a faithful instrument
 * — but for a write to a NON-EXTENSIBLE object they diverge completely (sloppy
 * no-ops, strict throws), and that is exactly the behaviour `_scrml_tenant_mark`
 * exists to catch. A test asserting it under `new Function` exercises the ONE
 * mode the bundle never runs in, while its header claims the opposite.
 *
 * So `loadHelperModule()` writes the shipped helper text to a real `.mjs` and
 * imports it, giving the SAME strict-mode semantics the server bundle has, and
 * the mode-sensitive assertions use it. Both limbs of the refusal are proven,
 * each under the mode that actually reaches it.
 */
import { describe, test, expect, afterAll } from "bun:test";
import { writeFileSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  buildTenantContext,
  schemaWriteHazards,
  resolveTenantScoping,
  rewriteSelectAddTenantId,
  classifyTenantWrite,
  rewriteInsertAddTenantId,
  detectTenantRawEgress,
  acrossTenantInsertMissingTenantColumn,
  tenantFloorViolation,
  wrapWithTenantScope,
  SERVER_TENANT_HELPER,
  TENANT_COLUMN,
} from "../../src/codegen/tenant-egress.ts";
import { SERVER_PROTECT_HELPER } from "../../src/codegen/protect-egress.ts";
import { normalizeSqlText } from "../../src/sql-projection.ts";

// A ProtectContext-shaped stub: schemaByTable drives tenant detection.
function protectCtx(schema) {
  return { protectedByTable: new Map(), schemaByTable: new Map(Object.entries(schema)) };
}
const ctxAssets = () => buildTenantContext(protectCtx({ assets: ["id", "name", "tenant_id"], config: ["k", "v"] }));

// STRICT-MODE loader — a real ES module, the same mode `app.server.js` runs in.
// Used for every assertion whose outcome depends on strictness.
const _helperTmp = [];
afterAll(() => { for (const d of _helperTmp) { try { rmSync(d, { recursive: true, force: true }); } catch {} } });
async function loadHelperModule() {
  const dir = mkdtempSync(join(tmpdir(), "scrml-tenant-helper-"));
  _helperTmp.push(dir);
  const file = join(dir, "helper.mjs");
  writeFileSync(
    file,
    "function _scrml_current_user(req) { return { tenantId: req.tenantId ?? null }; }\n" +
    SERVER_TENANT_HELPER +
      "\nexport { _scrml_tenant_scope, _scrml_tenant_mark, _scrml_tenant_redact, _scrml_tenant_opaque, _scrml_tenant_request_scope };\n",
  );
  return await import(file);
}

// Loaded ONCE at module scope: `describe` callbacks are synchronous, and this is
// a real dynamic `import()`.
const HELPER_STRICT = await loadHelperModule();

// SLOPPY-MODE loader (`new Function`). Faithful for every mode-INSENSITIVE
// property — which is all of them except the non-extensible-write pair.
// `_scrml_current_user` is stubbed (a request is `{ tenantId }`) so
// `_scrml_active_tenant` can resolve the request's tenant; `asTenant` runs a
// function as the request of that tenant (the per-request store the emitted
// route wrapper opens).
function loadHelper() {
  const fn = new Function(
    "function _scrml_current_user(req) { return { tenantId: req.tenantId ?? null }; }\n" +
    SERVER_TENANT_HELPER +
      "\nreturn { _scrml_tenant_scope, _scrml_tenant_scope_none, _scrml_tenant_redact, _scrml_active_tenant, _scrml_tenant_request_scope, _scrml_tenant_write_key };",
  );
  const H = fn();
  H.asTenant = (tenantId, f) => H._scrml_tenant_request_scope(f)({ tenantId });
  return H;
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
  const key0 = (ref = "assets") => [{ col: "__scrml_tenant_0", add: `${ref}.tenant_id AS __scrml_tenant_0` }];
  test("every plain read gets ONE reserved-alias key, always added (never the author's column)", () => {
    expect(resolveTenantScoping("SELECT * FROM assets", ctx)).toEqual({ kind: "read", table: "assets", keys: key0() });
    expect(resolveTenantScoping("SELECT id, name FROM assets", ctx)).toEqual({ kind: "read", table: "assets", keys: key0() });
    expect(resolveTenantScoping("SELECT id, tenant_id AS tid FROM assets a", ctx)).toEqual({ kind: "read", table: "assets", keys: key0("a") });
  });
  test("a read over a NON-tenant table → null (no floor)", () => {
    expect(resolveTenantScoping("SELECT k, v FROM config", ctx)).toBeNull();
  });
  test("tenant INACTIVE → always null (byte-identical)", () => {
    const empty = buildTenantContext(protectCtx({ users: ["id"] }));
    expect(resolveTenantScoping("SELECT id FROM assets", empty)).toBeNull();
  });
  test("per-row allow-listed functions stay a plain read", () => {
    const sc = resolveTenantScoping("SELECT id, lower(name) AS n, coalesce(name, '') AS m, CAST(id AS TEXT) AS s FROM assets WHERE upper(name) LIKE ${q}", ctx);
    expect(sc && sc.kind).toBe("read");
  });
  test("H3: an aggregate is refused by the ALLOW-list, whatever its name", () => {
    for (const q of [
      "SELECT COUNT(*) AS n FROM assets",
      "SELECT json_group_array(name) AS a FROM assets",
      "SELECT array_agg(name) AS a FROM assets",
      "SELECT string_agg(name, ',') AS a FROM assets",
      "SELECT json_agg(name) AS a FROM assets",
      "SELECT hex(name) AS h FROM assets",          // unknown, even if harmless
    ]) {
      expect(resolveTenantScoping(q, ctx)).toMatchObject({ kind: "agg", reason: "function" });
    }
  });
  test("L2: a window function is refused", () => {
    expect(resolveTenantScoping("SELECT id, lead(name) OVER (ORDER BY id) AS n FROM assets", ctx))
      .toMatchObject({ kind: "agg", reason: "window" });
  });
  test("DISTINCT / HAVING / GROUP BY not on tenant_id are refused", () => {
    expect(resolveTenantScoping("SELECT DISTINCT name FROM assets", ctx)).toMatchObject({ kind: "agg", reason: "aggregate" });
    expect(resolveTenantScoping("SELECT name FROM assets GROUP BY name", ctx)).toMatchObject({ kind: "agg", reason: "aggregate" });
  });
  test("H4: GROUP BY is read structurally — ORDER BY tenant_id does not exempt", () => {
    expect(resolveTenantScoping("SELECT tenant_id, count(*) AS n FROM assets GROUP BY cost ORDER BY tenant_id", ctx))
      .toMatchObject({ kind: "agg" });
    expect(resolveTenantScoping("SELECT tenant_id, count(*) AS n FROM assets GROUP BY tenant_id", ctx))
      .toEqual({ kind: "read", table: "assets", keys: key0() });
    expect(resolveTenantScoping("SELECT a.tenant_id, count(*) AS n FROM assets a GROUP BY a.tenant_id, a.name HAVING count(*) > 1", ctx))
      .toMatchObject({ kind: "read" });
  });
  test("H4: a JOIN groups by EVERY tenant source or is refused", () => {
    const two = buildTenantContext(protectCtx({ assets: ["id", "tenant_id"], orders: ["id", "asset_id", "tenant_id"] }));
    const q = "SELECT o.tenant_id, count(*) AS n FROM orders o JOIN assets a ON a.id = o.asset_id GROUP BY o.tenant_id";
    expect(resolveTenantScoping(q, two)).toMatchObject({ kind: "agg" });
    expect(resolveTenantScoping(q + ", a.tenant_id", two)).toMatchObject({ kind: "read" });
    // a bare tenant_id in a JOIN is ambiguous → not exempt
    expect(resolveTenantScoping("SELECT count(*) AS n FROM orders o JOIN assets a ON a.id = o.asset_id GROUP BY tenant_id", two))
      .toMatchObject({ kind: "agg" });
  });
  test("H1: a subquery / CTE / derived table / IN <table> is refused", () => {
    for (const q of [
      "WITH t AS (SELECT * FROM assets) SELECT * FROM t",
      "SELECT x.id FROM (SELECT id FROM assets) x",
      "SELECT k, v FROM config WHERE k IN (SELECT name FROM assets)",
      "SELECT id FROM assets WHERE id IN (SELECT asset_id FROM config)",   // any subquery, even non-tenant
      "SELECT k FROM config WHERE k IN assets",
    ]) {
      expect(resolveTenantScoping(q, ctx)).toMatchObject({ kind: "agg", reason: "subquery" });
    }
  });
  test("H1 (S452 r3): a comment is OUTSIDE the subset — refused whatever it hides", () => {
    for (const q of [
      "SELECT (/**/SELECT group_concat(name) FROM assets) AS names",
      "SELECT ( -- c\n SELECT group_concat(name) FROM assets) AS names",
      "SELECT k FROM config WHERE k IN (/* x */SELECT name FROM assets)",
    ]) {
      expect(resolveTenantScoping(q, ctx)).toMatchObject({ kind: "outside", table: "assets" });
    }
  });
  test("a set operation mentioning a tenant table is refused", () => {
    expect(resolveTenantScoping("SELECT id FROM assets UNION SELECT k FROM config", ctx)).toMatchObject({ kind: "agg", reason: "setop" });
  });
  test("L1: an author projection naming the reserved key alias is refused", () => {
    expect(resolveTenantScoping("SELECT id, 'A' AS __scrml_tenant_0 FROM assets", ctx)).toMatchObject({ kind: "agg", reason: "reserved" });
  });
  test("L3: a plain string literal is data — it neither refuses nor scopes", () => {
    expect(resolveTenantScoping("SELECT id FROM assets WHERE name != '(SELECT count(*) FROM assets)'", ctx))
      .toEqual({ kind: "read", table: "assets", keys: key0() });
    expect(resolveTenantScoping("SELECT k FROM config WHERE v = 'assets'", ctx)).toBeNull();
    // A comment carries a query OUT of the subset; outside it nothing is trusted
    // to be data, so naming a tenant table anywhere refuses (fail-closed)…
    expect(resolveTenantScoping("SELECT k FROM config -- assets", ctx)).toMatchObject({ kind: "outside" });
    // …and a body outside the subset that names no tenant table is not the floor's.
    expect(resolveTenantScoping("SELECT k FROM config -- other", ctx)).toBeNull();
  });
  test("a tenant table that is named but not a FROM source → zero rows (unresolvable)", () => {
    expect(resolveTenantScoping("SELECT assets FROM config", ctx)).toEqual({ kind: "unresolvable" });
  });
  test("a JOIN of two tenant tables keys EACH source through its own reserved alias (reading 3)", () => {
    const two = buildTenantContext(protectCtx({ assets: ["id", "tenant_id"], orders: ["id", "asset_id", "tenant_id"] }));
    const sc = resolveTenantScoping("SELECT o.id, a.id FROM orders o LEFT JOIN assets a ON a.id = o.asset_id", two);
    expect(sc).toEqual({
      kind: "read",
      table: "orders",
      keys: [
        { col: "__scrml_tenant_0", add: "o.tenant_id AS __scrml_tenant_0" },
        { col: "__scrml_tenant_1", add: "a.tenant_id AS __scrml_tenant_1" },
      ],
    });
  });
  test("a self-join keys BOTH occurrences", () => {
    const sc = resolveTenantScoping("SELECT p.id, c.id FROM assets p JOIN assets c ON c.id = p.id", ctx);
    expect(sc && sc.kind === "read" && sc.keys.map((k) => k.add)).toEqual([
      "p.tenant_id AS __scrml_tenant_0",
      "c.tenant_id AS __scrml_tenant_1",
    ]);
  });
});

// ---------------------------------------------------------------------------
// rewriteSelectAddTenantId — the deterministic projection-column add
// ---------------------------------------------------------------------------
describe("§14.8.10 rewriteSelectAddTenantId — projection-column add (NOT a WHERE-parse)", () => {
  const ctx = ctxAssets();
  const add = (q) => rewriteSelectAddTenantId(q, resolveTenantScoping(q, ctx));
  test("adds the reserved key just before FROM, preserving the WHERE + ${} params", () => {
    expect(add("SELECT id, name FROM assets WHERE id = ${x}"))
      .toBe("SELECT id, name, assets.tenant_id AS __scrml_tenant_0 FROM assets WHERE id = ${x}");
  });
  test("qualifies the key with the tenant table's alias in a multi-table FROM", () => {
    // (S455 `rel.f`: a qualified reference must name a DECLARED column — `uid` and `users`
    // are declared here; an undeclared one is E-TENANT-SQL-SUBSET, below)
    const ctx = buildTenantContext(protectCtx({ assets: ["id", "name", "uid", "tenant_id"], users: ["id", "name"] }));
    const add = (q) => rewriteSelectAddTenantId(q, resolveTenantScoping(q, ctx));
    expect(add("SELECT a.id, u.name FROM assets a JOIN users u ON a.uid = u.id"))
      .toBe("SELECT a.id, u.name, a.tenant_id AS __scrml_tenant_0 FROM assets a JOIN users u ON a.uid = u.id");
  });
  test("a FROM inside a string literal or a parenthesized call is not the clause", () => {
    expect(add("SELECT 'x FROM y' AS a, substr(name, 1) AS s FROM assets"))
      .toBe("SELECT 'x FROM y' AS a, substr(name, 1) AS s, assets.tenant_id AS __scrml_tenant_0 FROM assets");
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
  test("subset UPDATE / DELETE → filter-inject (S452 r3: the WHERE is parenthesized and ANDed with the tenant)", () => {
    expect(classifyTenantWrite("UPDATE assets SET name = ${n} WHERE id = ${i}", ctx)).toEqual({ kind: "filter-inject", table: "assets", op: "UPDATE" });
    expect(classifyTenantWrite("DELETE FROM assets WHERE id = ${i}", ctx)).toEqual({ kind: "filter-inject", table: "assets", op: "DELETE" });
  });
  test("UPDATE / DELETE the floor cannot constrain → hard-fail", () => {
    for (const q of [
      "UPDATE assets SET tenant_id = ${t} WHERE id = ${i}",
      "UPDATE assets SET name = ${n} FROM config WHERE id = 1",
      "UPDATE OR REPLACE assets SET id = 2 WHERE id = 1",
      "UPDATE assets AS a SET name = ${n}",
      "DELETE FROM assets WHERE id = 1 RETURNING name",
      "DELETE FROM assets WHERE id = 1 ORDER BY id LIMIT 1",
      "DELETE FROM assets WHERE id = hex(name)",
      "DELETE FROM assets WHERE id IN (SELECT asset_id FROM orders)",
    ]) {
      expect(classifyTenantWrite(q, ctx)).toMatchObject({ kind: "hard-fail" });
    }
  });
  test("REPLACE / INSERT OR REPLACE / ON CONFLICT / INSERT … SELECT / a subquery in VALUES → hard-fail", () => {
    for (const q of [
      "REPLACE INTO assets (id, name) VALUES (2, 'x')",
      "INSERT OR REPLACE INTO assets (id, name) VALUES (2, 'x')",
      "INSERT INTO assets (id, name) VALUES (2, 'x') ON CONFLICT (id) DO UPDATE SET name = 'x'",
      "INSERT INTO config (k) SELECT name FROM assets",
      "INSERT INTO assets (name) VALUES ((SELECT name FROM assets WHERE id = 2))",
      "INSERT INTO assets (name, TENANT_ID) VALUES ('forged', 'B')",
      "INSERT INTO assets (name) VALUES (${n}) RETURNING id",
    ]) {
      expect(classifyTenantWrite(q, ctx)).toMatchObject({ kind: "hard-fail" });
    }
  });
  test("a comment or a quoted name takes a write OUT of the subset (E-TENANT-SQL-SUBSET)", () => {
    for (const q of [
      "UPDATE/**/assets SET name = ${n}",
      'UPDATE "assets" SET name = ${n}',
      "INSERT/**/INTO assets (name) VALUES (${n})",
      'INSERT INTO assets (name, "tenant_id") VALUES (\'forged\', \'B\')',
      "INSERT INTO assets (name, [tenant_id]) VALUES ('forged', 'B')",
    ]) {
      expect(classifyTenantWrite(q, ctx)).toBeNull();
      expect(tenantFloorViolation(q, false, ctx)).toMatchObject({ code: "E-TENANT-SQL-SUBSET" });
    }
  });
  test("write to a NON-tenant table → null (no floor); a literal naming one is data", () => {
    expect(classifyTenantWrite("DELETE FROM config WHERE k = ${k}", ctx)).toBeNull();
    expect(classifyTenantWrite("DELETE FROM config WHERE k = 'assets'", ctx)).toBeNull();
  });
  test("a SELECT is not a write → null", () => {
    expect(classifyTenantWrite("SELECT id FROM assets", ctx)).toBeNull();
  });
});

describe("§14.8.10 acrossTenantInsertMissingTenantColumn — an opted-out INSERT names its tenant", () => {
  const ctx = ctxAssets();
  test("names tenant_id → allowed (null)", () => {
    expect(acrossTenantInsertMissingTenantColumn("INSERT INTO assets (name, tenant_id) VALUES (${n}, ${t})", ctx)).toBeNull();
  });
  test("omits tenant_id, or has no column list → the target table (refused)", () => {
    expect(acrossTenantInsertMissingTenantColumn("INSERT INTO assets (name) VALUES (${n})", ctx)).toBe("assets");
    expect(acrossTenantInsertMissingTenantColumn("INSERT INTO assets VALUES (${a}, ${b}, ${c})", ctx)).toBe("assets");
  });
  test("not an INSERT into a tenant table → null", () => {
    expect(acrossTenantInsertMissingTenantColumn("INSERT INTO config (k) VALUES (${k})", ctx)).toBeNull();
    expect(acrossTenantInsertMissingTenantColumn("SELECT * FROM assets", ctx)).toBeNull();
  });
});

describe("§14.8.10 S452 r4 — schemaWriteHazards reads triggers / rules / cascading FKs from <schema>", () => {
  const tenants = new Set(["assets", "orders"]);
  test("a trigger is attributed to its ON table; a rule to its TO table", () => {
    const h = schemaWriteHazards("CREATE TRIGGER t_upd AFTER UPDATE OF cost ON assets BEGIN UPDATE orders SET label = 'x'; END;\nCREATE RULE r1 AS ON DELETE TO orders DO INSTEAD NOTHING;", tenants);
    expect(h.get("assets")).toEqual(["trigger `t_upd`"]);
    expect(h.get("orders")).toEqual(["rule `r1`"]);
  });
  test("an FK action fires on writes to the REFERENCED table; NO ACTION / RESTRICT do not count", () => {
    const h = schemaWriteHazards(
      "CREATE TABLE orders (id INTEGER, asset_id INTEGER REFERENCES assets(id) ON DELETE CASCADE, tenant_id TEXT)\n" +
      "CREATE TABLE notes (id INTEGER, order_id INTEGER REFERENCES orders(id) ON DELETE RESTRICT ON UPDATE NO ACTION)", tenants);
    expect(h.get("assets")).toEqual(["a foreign key with `ON DELETE CASCADE` referencing it"]);
    expect(h.has("orders")).toBe(false);
  });
  test("a hazard the reader cannot attribute is charged to EVERY tenant table (fail-closed)", () => {
    const h = schemaWriteHazards("-- a TRIGGER we cannot parse\nFOREIGN KEY (a) REFERENCES (weird) ON DELETE SET NULL", tenants);
    expect(h.get("assets")?.length).toBeGreaterThan(0);
    expect(h.get("orders")?.length).toBeGreaterThan(0);
  });
  test("OR ABORT is SQLite-only: a Postgres / MySQL handle gets the plain injected statement", () => {
    const base = buildTenantContext(protectCtx({ assets: ["id", "name", "tenant_id"] }));
    const ctx = { ...base, driverFor: (id) => ({ _scrml_sql: "sqlite", _scrml_sql_pg: "postgres", _scrml_sql_my: "mysql" })[id] };
    const ins = "INSERT INTO assets (name) VALUES (${n})";
    expect(rewriteInsertAddTenantId(ins, "K()", ctx, "_scrml_sql")).toBe("INSERT OR ABORT INTO assets (name, tenant_id) VALUES (${n}, ${K()})");
    expect(rewriteInsertAddTenantId(ins, "K()", ctx, "_scrml_sql_pg")).toBe("INSERT INTO assets (name, tenant_id) VALUES (${n}, ${K()})");
    expect(rewriteInsertAddTenantId(ins, "K()", ctx, "_scrml_sql_my")).toBe("INSERT INTO assets (name, tenant_id) VALUES (${n}, ${K()})");
  });
  test("a schema with none → no hazards", () => {
    expect(schemaWriteHazards("CREATE TABLE assets (id INTEGER, tenant_id TEXT)", tenants).size).toBe(0);
  });
});

describe("§14.8.10 the write key — no active tenant is a NAMED refusal", () => {
  test("outside any request it throws E-TENANT-WRITE (runtime), naming the way out", () => {
    const H = loadHelper();
    expect(() => H._scrml_tenant_write_key()).toThrow(/E-TENANT-WRITE \(runtime\).*acrossTenants\(\)/s);
  });
  test("an unpinned request refuses too; a pinned one gets its tenant", () => {
    const H = loadHelper();
    expect(() => H.asTenant(null, () => H._scrml_tenant_write_key())).toThrow(/E-TENANT-WRITE/);
    expect(H.asTenant("A", () => H._scrml_tenant_write_key())).toBe("A");
  });
});

describe("normalizeSqlText — the ONE normalizer every tenant check reads", () => {
  test("comments and interpolations vanish; string literals keep their length but lose their words", () => {
    expect(normalizeSqlText("SELECT /* x */ id -- y\nFROM t WHERE a = ${v} AND b = 'it''s (SELECT)'"))
      .toBe("SELECT id FROM t WHERE a = AND b = '______________'");
  });
  test("a comment marker inside a string is data; quoted identifiers pass through", () => {
    expect(normalizeSqlText(`SELECT '--x', "a--b", [c/*d] FROM t`)).toBe(`SELECT '___', "a--b", [c/*d] FROM t`);
  });
});

describe("§14.8.10 rewriteInsertAddTenantId", () => {
  test("injects tenant_id column + the ambient value param", () => {
    const out = rewriteInsertAddTenantId("INSERT INTO assets (name) VALUES (${n})", "_scrml_current_user(_scrml_req).tenantId");
    expect(out).toBe("INSERT OR ABORT INTO assets (name, tenant_id) VALUES (${n}, ${_scrml_current_user(_scrml_req).tenantId})");
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
// The SHIPPED runtime helper — the SOURCE filter + the egress re-check (EXECUTED)
// ---------------------------------------------------------------------------
describe("§14.8.10 SERVER_TENANT_HELPER — the shipped source filter (eval'd)", () => {
  const rowsAB = () => [
    { id: 1, name: "a1", tenant_id: "A" },
    { id: 2, name: "a2", tenant_id: "A" },
    { id: 3, name: "b1", tenant_id: "B" },
  ];
  const wire = (v) => JSON.parse(JSON.stringify(v));

  test("scope(A) → only tenant-A rows; a floor-ADDED key column is removed after the filter", () => {
    const H = loadHelper();
    const out = H.asTenant("A", () => H._scrml_tenant_scope(rowsAB(), ["tenant_id"], ["tenant_id"]));
    expect(wire(out)).toEqual([{ id: 1, name: "a1" }, { id: 2, name: "a2" }]);
  });

  test("an author-projected key column is KEPT on the survivors", () => {
    const H = loadHelper();
    const out = H.asTenant("B", () => H._scrml_tenant_scope(rowsAB(), ["tenant_id"], []));
    expect(wire(out)).toEqual([{ id: 3, name: "b1", tenant_id: "B" }]);
  });

  test("an UNPINNED request (null tenant) → ZERO rows (fail-closed)", () => {
    const H = loadHelper();
    expect(H.asTenant(null, () => H._scrml_tenant_scope(rowsAB(), ["tenant_id"], []))).toEqual([]);
  });

  test("code OUTSIDE any request (boot, a background job) → ZERO rows (S452 reading 7)", () => {
    const H = loadHelper();
    expect(H._scrml_tenant_scope(rowsAB(), ["tenant_id"], [])).toEqual([]);
  });

  test("the request is found through an async hop (a peer server function awaited in the handler)", async () => {
    const H = loadHelper();
    const peer = async () => { await Promise.resolve(); return H._scrml_tenant_scope(rowsAB(), ["tenant_id"], []); };
    const out = await H._scrml_tenant_request_scope(async () => { await null; return peer(); })({ tenantId: "B" });
    expect(wire(out)).toEqual([{ id: 3, name: "b1", tenant_id: "B" }]);
  });

  test("filters IN PLACE: the driver's array is kept, and its `count` is corrected", () => {
    const H = loadHelper();
    const rows = rowsAB();
    rows.count = 3;
    const out = H.asTenant("A", () => H._scrml_tenant_scope(rows, ["tenant_id"], []));
    expect(out).toBe(rows);
    expect(out.length).toBe(2);
    expect(out.count).toBe(2);
  });

  test("a JOIN row is kept only if EVERY tenant source matches; NULL never matches (reading 3)", () => {
    const H = loadHelper();
    const joined = () => [
      { id: 1, _scrml_tenant_key_0: "A", _scrml_tenant_key_1: "A" },
      { id: 2, _scrml_tenant_key_0: "A", _scrml_tenant_key_1: "B" },   // foreign right side
      { id: 3, _scrml_tenant_key_0: "A", _scrml_tenant_key_1: null },  // LEFT JOIN, no match
      { id: 4, _scrml_tenant_key_0: "B", _scrml_tenant_key_1: "A" },
    ];
    const keys = ["_scrml_tenant_key_0", "_scrml_tenant_key_1"];
    const out = H.asTenant("A", () => H._scrml_tenant_scope(joined(), keys, keys));
    expect(wire(out)).toEqual([{ id: 1 }]);
  });

  test("scope_none (an unresolvable read) → zero rows whatever the tenant (reading 5)", () => {
    const H = loadHelper();
    expect(H.asTenant("A", () => H._scrml_tenant_scope_none(rowsAB()))).toEqual([]);
  });

  test("a non-array result of the wrong tenant → null; of the right tenant → the row", () => {
    const H = loadHelper();
    expect(H.asTenant("A", () => H._scrml_tenant_scope({ id: 3, tenant_id: "B" }, ["tenant_id"], []))).toBeNull();
    expect(wire(H.asTenant("B", () => H._scrml_tenant_scope({ id: 3, tenant_id: "B" }, ["tenant_id"], ["tenant_id"]))))
      .toEqual({ id: 3 });
  });

  test("the mark is Symbol-keyed → invisible to JSON.stringify", () => {
    const H = loadHelper();
    const out = H.asTenant("A", () => H._scrml_tenant_scope([{ id: 1, tenant_id: "A" }], ["tenant_id"], []));
    expect(JSON.stringify(out)).toBe('[{"id":1,"tenant_id":"A"}]');
    expect(out[0][Symbol.for("scrml.tenant.origin")]).toEqual({ tenant: "A" });
  });

  test("the egress re-check keeps rows admitted for the request tenant; drops them for another / none", () => {
    const H = loadHelper();
    const scoped = H.asTenant("A", () => H._scrml_tenant_scope(rowsAB(), ["tenant_id"], []));
    expect(H._scrml_tenant_redact(scoped, "A").length).toBe(2);
    expect(H._scrml_tenant_redact(scoped, "B")).toEqual([]);
    expect(H._scrml_tenant_redact(scoped, null)).toEqual([]);
  });

  test("UNscoped rows (acrossTenants / non-tenant) pass the egress re-check unchanged", () => {
    const H = loadHelper();
    expect(H._scrml_tenant_redact(rowsAB(), "A")).toEqual(rowsAB());
  });

  test("composition: the §14.8.9 protect descriptor Symbol survives the filter", () => {
    const H = loadHelper();
    const PROT = Symbol.for("scrml.protect.col:secret");
    const rows = [{ id: 1, name: "a1", secret: "s", tenant_id: "A" }];
    rows[0][PROT] = true;
    const out = H.asTenant("A", () => H._scrml_tenant_scope(rows, ["tenant_id"], ["tenant_id"]));
    expect(out[0][PROT]).toBe(true);
    expect("tenant_id" in out[0]).toBe(false);
  });

  test("_scrml_active_tenant is null-safe with no resolver and with no request", () => {
    const S = new Function(SERVER_TENANT_HELPER + "\nreturn { _scrml_active_tenant };")();
    expect(S._scrml_active_tenant({})).toBeNull();
    expect(S._scrml_active_tenant(null)).toBeNull();
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
    const t1 = H.asTenant("1", () => H._scrml_tenant_scope(intRows(), ["tenant_id"], ["tenant_id"]));
    expect(wire(t1)).toEqual([{ id: 1, name: "a1" }, { id: 2, name: "a2" }]);
    const t2 = H.asTenant("2", () => H._scrml_tenant_scope(intRows(), ["tenant_id"], ["tenant_id"]));
    expect(wire(t2)).toEqual([{ id: 3, name: "b1" }]);
    expect(H.asTenant(null, () => H._scrml_tenant_scope(intRows(), ["tenant_id"], []))).toEqual([]);
    // and the egress re-check agrees with the source filter on the coerced key.
    expect(H._scrml_tenant_redact(t1, 1).length).toBe(2);
  });

  test("COMPOSITION with §14.8.9 protect — the exact emitted lowering + sink, both shipped helpers", () => {
    // The emitted lowering:  _scrml_protect_tag(_scrml_tenant_scope(rows, keys, added), [cols])
    // The emitted sink:      _scrml_protect_redact(_scrml_tenant_redact(result, ambientTenant))
    const H = new Function(
      "function _scrml_current_user(req) { return { tenantId: req.tenantId ?? null }; }\n" +
      SERVER_PROTECT_HELPER + SERVER_TENANT_HELPER +
        "\nreturn { _scrml_protect_tag, _scrml_protect_redact, _scrml_tenant_scope, _scrml_tenant_redact, _scrml_tenant_request_scope };",
    )();
    const rows = [
      { id: 1, name: "ua", passwordHash: "secretA", tenant_id: "A" },
      { id: 2, name: "ub", passwordHash: "secretB", tenant_id: "B" },
    ];
    const lowered = H._scrml_tenant_request_scope(() =>
      H._scrml_protect_tag(H._scrml_tenant_scope(rows, ["tenant_id"], ["tenant_id"]), ["passwordHash"]))({ tenantId: "A" });
    const out = H._scrml_protect_redact(H._scrml_tenant_redact(lowered, "A"));
    // tenant B dropped at the source + floor-added tenant_id removed at the source +
    // passwordHash stripped at the sink.
    expect(out).toEqual([{ id: 1, name: "ua" }]);
  });
});

// ---------------------------------------------------------------------------
// wrapWithTenantScope — emitted wrap text
// ---------------------------------------------------------------------------
describe("§14.8.10 wrapWithTenantScope", () => {
  test("read scoping → `_scrml_tenant_scope(<rows>, [keyCols], [addedCols])`", () => {
    expect(wrapWithTenantScope("ROWS", { kind: "read", table: "assets", keys: [{ col: TENANT_COLUMN, add: TENANT_COLUMN }] }))
      .toBe('_scrml_tenant_scope(ROWS, ["tenant_id"], ["tenant_id"])');
    expect(wrapWithTenantScope("ROWS", { kind: "read", table: "assets", keys: [{ col: "tid", add: null }] }))
      .toBe('_scrml_tenant_scope(ROWS, ["tid"], [])');
  });
  test("unresolvable scoping → `_scrml_tenant_scope_none(<rows>)`", () => {
    expect(wrapWithTenantScope("ROWS", { kind: "unresolvable" })).toBe("_scrml_tenant_scope_none(ROWS)");
  });
  test("null / agg → no wrap", () => {
    expect(wrapWithTenantScope("ROWS", null)).toBe("ROWS");
    expect(wrapWithTenantScope("ROWS", { kind: "agg", table: "assets", reason: "aggregate" })).toBe("ROWS");
  });
});

// ---------------------------------------------------------------------------
// §14.8.10 fail-CLOSED at the egress re-check — refuse what the monitor cannot inspect
//
// dpa-039 arc B / B3. The shipped `_scrml_tenant_redact` opened with
//
//     if (typeof Response !== "undefined" && value instanceof Response) return value;
//
// BEFORE it read the tenant descriptor. That ordering meant a value the compiler
// had MARKED as tenant-scoped was handed to the client entirely uninspected the
// moment it sat inside a host-opaque carrier — the one fail-OPEN in this
// redactor. The mark is now read FIRST. Marked + opaque REFUSES (throws, loudly);
// UNmarked + opaque still passes through untouched, because that is the shipped
// binary / PDF egress path (§12.5) and must not regress.
//
// Under the S452 source filter a host-opaque value is never marked by correct
// emission (it carries no tenant key column, so `_scrml_tenant_scope` drops it),
// so these cases mark through `_scrml_tenant_mark` directly — defense in depth.
// ---------------------------------------------------------------------------
describe("§14.8.10 redact — a MARKED host-opaque carrier is refused, not passed through", () => {
  const H = new Function(
    SERVER_TENANT_HELPER +
      "\nreturn { _scrml_tenant_mark, _scrml_tenant_redact, _scrml_tenant_opaque, _scrml_tenant_scope };",
  )();
  const mark = (v) => { H._scrml_tenant_mark(v, { tenant: "A" }); return v; };

  test("a MARKED Response is REFUSED (was: returned verbatim, uninspected)", () => {
    expect(() => H._scrml_tenant_redact(mark(new Response("secret rows")), "A")).toThrow(/E-TENANT-RAW-EGRESS \(runtime\)/);
  });

  test("a MARKED Response is refused for an UNPINNED request too (no null-key shortcut)", () => {
    expect(() => H._scrml_tenant_redact(mark(new Response("secret rows")), null)).toThrow(/E-TENANT-RAW-EGRESS \(runtime\)/);
  });

  test("a MARKED Blob / stream / buffer is refused too — the carrier set is enumerated", () => {
    for (const opaque of [
      new Blob(["secret"]),
      new ReadableStream({ start(c) { c.close(); } }),
      new ArrayBuffer(8),
      new Uint8Array([1, 2, 3]),
    ]) {
      expect(() => H._scrml_tenant_redact(mark(opaque), "A")).toThrow(/E-TENANT-RAW-EGRESS \(runtime\)/);
    }
  });

  test("a MARKED opaque carrier nested in an array is refused as well", () => {
    const rows = [{ id: 1, tenant_id: "A" }, mark(new Response("secret"))];
    expect(() => H._scrml_tenant_redact(rows, "A")).toThrow(/E-TENANT-RAW-EGRESS \(runtime\)/);
  });

  test("the SOURCE filter never admits a host-opaque value (no tenant key column)", () => {
    expect(H._scrml_tenant_scope(new Response("secret rows"), ["tenant_id"], [])).toBeNull();
    expect(H._scrml_tenant_scope([new Blob(["x"])], ["tenant_id"], [])).toEqual([]);
  });

  test("REGRESSION GUARD: an UNMARKED Response still passes through byte-identical", () => {
    // The shipped §12.5 binary / PDF egress path. Refusing this would be a
    // catastrophic over-fire, so it is pinned here explicitly.
    const resp = new Response("a legitimate binary body");
    expect(H._scrml_tenant_redact(resp, "A")).toBe(resp);
    expect(H._scrml_tenant_redact(resp, null)).toBe(resp);
  });

  test("REGRESSION GUARD: an UNMARKED opaque value inside a plain object survives", () => {
    const blob = new Blob(["x"]);
    const out = H._scrml_tenant_redact({ file: blob, n: 1 }, "A");
    expect(out.file).toBe(blob);
    expect(out.n).toBe(1);
  });

  test("the opaque predicate is exactly the enumerated carrier set", () => {
    expect(H._scrml_tenant_opaque(new Response("x"))).toBe(true);
    expect(H._scrml_tenant_opaque(new Blob(["x"]))).toBe(true);
    expect(H._scrml_tenant_opaque(new ArrayBuffer(4))).toBe(true);
    expect(H._scrml_tenant_opaque(new Uint8Array(4))).toBe(true);
    expect(H._scrml_tenant_opaque(new DataView(new ArrayBuffer(4)))).toBe(true);
    expect(H._scrml_tenant_opaque({ a: 1 })).toBe(false);
    expect(H._scrml_tenant_opaque([1, 2])).toBe(false);
    expect(H._scrml_tenant_opaque(null)).toBe(false);
    expect(H._scrml_tenant_opaque("str")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §14.8.10 fail-CLOSED at the MARK — the descriptor write must be VERIFIED
//
// Found by the arc-B adversarial population sweep: attaching the descriptor is a
// plain property write, and a plain property write to a frozen / sealed /
// non-extensible object is a SILENT no-op outside strict mode (and a TypeError
// inside it). Not reachable from correct emission (the scope wraps the RAW driver
// result of a `?{}` query and no author code runs between the await and the
// scope) — defense in depth: the floor never reports a success it did not achieve.
// ---------------------------------------------------------------------------
describe("§14.8.10 mark — a descriptor that cannot be attached REFUSES, never silently no-ops", () => {
  // ⚑ STRICT MODE, deliberately: the emitted `app.server.js` is an ES module, so
  // strict is what ships. The sloppy-mode limb is pinned separately below.
  const H = HELPER_STRICT;
  const REFUSAL = /E-TENANT-RAW-EGRESS \(runtime\)/;
  const inA = (fn) => H._scrml_tenant_request_scope(fn)({ tenantId: "A" });

  test("SLOPPY-mode limb: the silent no-op is caught by the verify-after-write", () => {
    const S = new Function(SERVER_TENANT_HELPER + "\nreturn { _scrml_tenant_mark };")();
    expect(() => S._scrml_tenant_mark(Object.freeze({ tenant_id: "A" }), { tenant: "A" })).toThrow(REFUSAL);
  });

  test("a FROZEN admitted row refuses (never shipped unmarked)", () => {
    expect(() => inA(() => H._scrml_tenant_scope([Object.freeze({ tenant_id: "A" })], ["tenant_id"], [])))
      .toThrow(REFUSAL);
  });

  test("SEALED and preventExtensions refuse too — the cause is non-extensibility, not freezing", () => {
    expect(() => H._scrml_tenant_mark(Object.seal({ tenant_id: "A" }), { tenant: "A" })).toThrow(REFUSAL);
    expect(() => H._scrml_tenant_mark(Object.preventExtensions({ tenant_id: "A" }), { tenant: "A" })).toThrow(REFUSAL);
  });

  test("a FOREIGN frozen row is simply dropped (never marked, never kept)", () => {
    expect(inA(() => H._scrml_tenant_scope([Object.freeze({ tenant_id: "B" })], ["tenant_id"], []))).toEqual([]);
  });

  test("REGRESSION GUARD: ordinary driver rows scope and re-check exactly as before", () => {
    const rows = [
      { id: 1, name: "a1", tenant_id: "A" },
      { id: 2, name: "b1", tenant_id: "B" },
    ];
    const scoped = inA(() => H._scrml_tenant_scope(rows, ["tenant_id"], ["tenant_id"]));
    expect(JSON.parse(JSON.stringify(H._scrml_tenant_redact(scoped, "A")))).toEqual([{ id: 1, name: "a1" }]);
  });

  test("EVERY non-row kind fails CLOSED at the source — none is admitted", () => {
    const makers = [
      () => new Map([["tenant_id", "A"]]),
      () => new Set(["A"]),
      () => new Date(0),
      () => /x/,
      () => new Error("secret"),
      () => new URL("https://example.com/secret"),
      () => new Headers({ "x-tenant": "A" }),
      () => new FormData(),
      () => new WeakMap(),
    ];
    for (const make of makers) {
      expect(inA(() => H._scrml_tenant_scope(make(), ["tenant_id"], []))).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// §23.2 FOREIGN-OPENER LEVELS — E-TENANT-RAW-EGRESS must see every spelling
//
// Handed across from the arc-A sibling, which found the byte-identical defect in
// `protect-egress.ts`, and REPRODUCED here on its own terms before being fixed
// here — the consequence is different (a tenant ISOLATION escape, not a
// protected-column leak) and had to be established, not inherited.
//
// §23.2 defines the opener as `_` + ZERO OR MORE `=` + `{`, closed by `}` + the
// same run. The scan tested `_\{` — LEVEL 0 ONLY. `W-FOREIGN-001` actively
// steers authors AWAY from level 0, so the gate recognized exactly the spelling
// the compiler discourages and missed the ones it recommends.
//
// MEASURED before the fix, at exit 0 with zero errors:
//
//   const rows = ?{`SELECT id, name, tenant_id FROM assets`}.all()
//   let wire   = _={ JSON.stringify(rows) }=
//   return wire
//
// The foreign block flattens the TAGGED rows into a STRING, so
// `_scrml_tenant_redact` takes its `typeof value !== "object"` exit and returns
// it verbatim. EXECUTED with ambient tenant "A", the wire carried
// `{"id":2,"name":"THEIRS","tenant_id":"B"}`. Levels 1, 2 and 3 all compiled
// clean; only level 0 hard-failed.
// ---------------------------------------------------------------------------
describe("§14.8.10 detectTenantRawEgress — every §23.2 foreign-opener level, not just level 0", () => {
  const READ = "let r = ?{`SELECT id FROM assets`}.all(); ";
  const ctx = () => ctxAssets();

  for (const [label, open, close] of [
    ["level 0  _{ }", "_{", "}"],
    ["level 1  _={ }=", "_={", "}="],
    ["level 2  _=={ }==", "_=={", "}=="],
    ["level 3  _==={ }===", "_==={", "}==="],
  ]) {
    test(`${label} — a tenant read reaching it is a raw egress`, () => {
      const hit = detectTenantRawEgress(`${READ}let w = ${open} JSON.stringify(r) ${close}; return w`, ctx());
      expect(hit).not.toBeNull();
      expect(hit.egressKind).toContain("foreign-code block");
    });

    test(`${label} — \`.acrossTenants()\` still suppresses it (the sole loud opt-out)`, () => {
      const src = "let r = ?{`SELECT id FROM assets`}.all().acrossTenants(); " +
        `let w = ${open} JSON.stringify(r) ${close}; return w`;
      expect(detectTenantRawEgress(src, ctx())).toBeNull();
    });
  }

  test("NEGATIVE: an ordinary identifier ending in `_` does not look like an opener", () => {
    // The opener must be preceded by a non-identifier char, so `foo_{` is not one.
    expect(detectTenantRawEgress("let r = ?{`SELECT id FROM assets`}.all(); let foo_ = 1; return r", ctx()))
      .toBeNull();
  });

  test("NEGATIVE: a tenant read with NO raw egress at all stays clean", () => {
    expect(detectTenantRawEgress("let r = ?{`SELECT id FROM assets`}.all(); return r", ctx())).toBeNull();
  });

  test("NEGATIVE: a foreign block in a NON-tenant app is not a tenant egress", () => {
    const nonTenant = buildTenantContext(protectCtx({ notes: ["id", "body"] }));
    expect(detectTenantRawEgress("let r = ?{`SELECT id FROM notes`}.all(); let w = _={ r }=; return w", nonTenant))
      .toBeNull();
  });
});
