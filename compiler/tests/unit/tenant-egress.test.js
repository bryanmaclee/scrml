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
    SERVER_TENANT_HELPER +
      "\nexport { _scrml_tenant_tag, _scrml_tenant_tag_all, _scrml_tenant_redact, _scrml_tenant_opaque };\n",
  );
  return await import(file);
}

// Loaded ONCE at module scope: `describe` callbacks are synchronous, and this is
// a real dynamic `import()`.
const HELPER_STRICT = await loadHelperModule();

// SLOPPY-MODE loader (`new Function`). Faithful for every mode-INSENSITIVE
// property — which is all of them except the non-extensible-write pair.
// `_scrml_current_user` is stubbed so `_scrml_active_tenant` can resolve an
// ambient tenant.
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

// ---------------------------------------------------------------------------
// §14.8.10 fail-CLOSED at the runtime sink — refuse what the monitor cannot inspect
//
// dpa-039 arc B / B3. The shipped `_scrml_tenant_redact` opened with
//
//     if (typeof Response !== "undefined" && value instanceof Response) return value;
//
// BEFORE it read the tenant descriptor. That ordering meant a value the compiler
// had TAGGED as carrying tenant-scoped rows was handed to the client entirely
// uninspected the moment it sat inside a host-opaque carrier — the one fail-OPEN
// in this redactor, and the mirror image of the §14.8.10 contract, which is
// fail-closed everywhere else (an unpinned request sees zero rows).
//
// The descriptor is now read FIRST. Tagged + opaque REFUSES (throws, loudly);
// UNtagged + opaque still passes through untouched, because that is the shipped
// binary / PDF egress path (§12.5) and must not regress.
// ---------------------------------------------------------------------------
describe("§14.8.10 redact — a TAGGED host-opaque carrier is refused, not passed through", () => {
  const H = new Function(
    SERVER_TENANT_HELPER +
      "\nreturn { _scrml_tenant_tag, _scrml_tenant_tag_all, _scrml_tenant_redact, _scrml_tenant_opaque };",
  )();

  test("a TAGGED Response is REFUSED (was: returned verbatim, uninspected)", () => {
    const r = H._scrml_tenant_tag(new Response("secret rows"), "tenant_id", true);
    expect(() => H._scrml_tenant_redact(r, "A")).toThrow(/E-TENANT-RAW-EGRESS \(runtime\)/);
  });

  test("a TAGGED Response is refused for an UNPINNED request too (no null-key shortcut)", () => {
    const r = H._scrml_tenant_tag(new Response("secret rows"), "tenant_id", true);
    expect(() => H._scrml_tenant_redact(r, null)).toThrow(/E-TENANT-RAW-EGRESS \(runtime\)/);
  });

  test("a strip-ALL tagged Response is refused (the unresolvable-read fallback)", () => {
    const r = H._scrml_tenant_tag_all(new Response("secret rows"));
    expect(() => H._scrml_tenant_redact(r, "A")).toThrow(/E-TENANT-RAW-EGRESS \(runtime\)/);
  });

  test("a TAGGED Blob / stream / buffer is refused too — the carrier set is enumerated", () => {
    for (const opaque of [
      new Blob(["secret"]),
      new ReadableStream({ start(c) { c.close(); } }),
      new ArrayBuffer(8),
      new Uint8Array([1, 2, 3]),
    ]) {
      const t = H._scrml_tenant_tag(opaque, "tenant_id", true);
      expect(() => H._scrml_tenant_redact(t, "A")).toThrow(/E-TENANT-RAW-EGRESS \(runtime\)/);
    }
  });

  test("a TAGGED opaque carrier nested in an array is refused as well", () => {
    const rows = [
      { id: 1, tenant_id: "A" },
      new Response("secret"),
    ];
    H._scrml_tenant_tag(rows, "tenant_id", true);
    expect(() => H._scrml_tenant_redact(rows, "A")).toThrow(/E-TENANT-RAW-EGRESS \(runtime\)/);
  });

  test("REGRESSION GUARD: an UNTAGGED Response still passes through byte-identical", () => {
    // The shipped §12.5 binary / PDF egress path. Refusing this would be a
    // catastrophic over-fire, so it is pinned here explicitly.
    const resp = new Response("a legitimate binary body");
    expect(H._scrml_tenant_redact(resp, "A")).toBe(resp);
    expect(H._scrml_tenant_redact(resp, null)).toBe(resp);
  });

  test("REGRESSION GUARD: an UNTAGGED opaque value inside a plain object survives", () => {
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
// §14.8.10 fail-CLOSED at the TAG end — the descriptor write must be VERIFIED
//
// Found by running the arc-B adversarial population sweep against arc B's OWN
// B3 fix. `_scrml_tenant_opaque` enumerates five host-opaque carrier kinds; the
// question that matters is what happens to a TAGGED value of a kind NOT in that
// set. Thirteen such kinds were exercised (Map, Set, Date, Promise, RegExp,
// Error, URL, Headers, FormData, WeakMap, a class instance, a null-prototype
// object, and a FROZEN row). Twelve fail CLOSED — the redact finds a descriptor,
// cannot key on it, and drops the value. The thirteenth LEAKED.
//
// Mechanism, reproduced: attaching the descriptor is a plain property write, and
// a plain property write to a frozen / sealed / non-extensible object is a
// SILENT no-op outside strict mode. So the row was never tagged, the redact
// found nothing to key on, and a row of tenant B reached a request whose ambient
// tenant was A. The identical fail-OPEN B3 closed in the redact, one function
// earlier — the floor reporting a success it had not achieved.
//
// Not reachable from correct emission today: the tag wraps the RAW driver result
// of a `?{}` query and no author code can run between the await and the tag. So
// this is defence in depth, not a live leak — but the cost is one property read
// per row and the failure it prevents is silent cross-tenant disclosure.
// ---------------------------------------------------------------------------
describe("§14.8.10 tag — a descriptor that cannot be attached REFUSES, never silently no-ops", () => {
  // ⚑ STRICT MODE, deliberately, and the correction matters more than the code.
  // This block is the ONE place in the file whose outcome depends on which JS
  // mode the helper runs in: a write to a non-extensible object THROWS under
  // strict and silently NO-OPS under sloppy. The emitted `app.server.js` is an
  // ES module, so strict is what ships — and an earlier version of these cases
  // ran under `new Function` (sloppy), i.e. proved the refusal on the one mode
  // the bundle never runs in, while the file header claimed it exercised "the
  // EXACT runtime the server bundle ships." The instrument asserted a fidelity
  // it did not have. `_scrml_tenant_mark` now routes BOTH failure shapes to the
  // same refusal, and both limbs are pinned below, each under its own mode.
  const H = HELPER_STRICT;
  const REFUSAL = /E-TENANT-RAW-EGRESS \(runtime\)/;

  test("SLOPPY-mode limb: the silent no-op is caught by the verify-after-write", () => {
    // The `new Function` loader is the RIGHT instrument here and only here: it
    // is the only way to reach the no-op path at all, and without this case that
    // limb of `_scrml_tenant_mark` would be dead code no test ever entered.
    const S = new Function(
      SERVER_TENANT_HELPER + "\nreturn { _scrml_tenant_tag };",
    )();
    expect(() => S._scrml_tenant_tag(Object.freeze({ tenant_id: "B" }), "tenant_id", true))
      .toThrow(REFUSAL);
  });

  test("a FROZEN row refuses (was: untagged, then shipped to the wrong tenant)", () => {
    expect(() => H._scrml_tenant_tag(Object.freeze({ tenant_id: "B", secret: "s" }), "tenant_id", true))
      .toThrow(REFUSAL);
  });

  test("SEALED and preventExtensions refuse too — the cause is non-extensibility, not freezing", () => {
    expect(() => H._scrml_tenant_tag(Object.seal({ tenant_id: "B" }), "tenant_id", true)).toThrow(REFUSAL);
    expect(() => H._scrml_tenant_tag(Object.preventExtensions({ tenant_id: "B" }), "tenant_id", true))
      .toThrow(REFUSAL);
  });

  test("a frozen row inside an array refuses (the per-row write is verified too)", () => {
    expect(() => H._scrml_tenant_tag([Object.freeze({ tenant_id: "B" })], "tenant_id", true))
      .toThrow(REFUSAL);
  });

  test("the strip-all tag verifies its write as well", () => {
    expect(() => H._scrml_tenant_tag_all(Object.freeze({ tenant_id: "B" }))).toThrow(REFUSAL);
  });

  test("REGRESSION GUARD: ordinary driver rows tag and redact exactly as before", () => {
    const rows = [
      { id: 1, name: "a1", tenant_id: "A" },
      { id: 2, name: "b1", tenant_id: "B" },
    ];
    expect(H._scrml_tenant_redact(H._scrml_tenant_tag(rows, "tenant_id", true), "A"))
      .toEqual([{ id: 1, name: "a1" }]);
  });

  test("EVERY tagged non-carrier kind fails CLOSED — none reaches the client", () => {
    // The twelve that already failed closed, asserted as a set rather than on the
    // one member that happened to motivate the fix.
    const makers = [
      () => new Map([["tenant_id", "B"]]),
      () => new Set(["B"]),
      () => new Date(0),
      () => /x/,
      () => new Error("secret"),
      () => new URL("https://example.com/secret"),
      () => new Headers({ "x-tenant": "B" }),
      () => new FormData(),
      () => new WeakMap(),
      () => { class Row { constructor() { this.tenant_id = "B"; this.secret = "s"; } } return new Row(); },
      () => Object.assign(Object.create(null), { tenant_id: "B", secret: "s" }),
    ];
    for (const make of makers) {
      const tagged = H._scrml_tenant_tag(make(), "tenant_id", true);
      expect(H._scrml_tenant_redact(tagged, "A")).toBeNull();
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
