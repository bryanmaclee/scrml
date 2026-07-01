/**
 * §52 (S233) — server-load request-context authority (SSR Forks 3+4). Change-id
 * server-load-authority-2026-06-30.
 *
 * Closes a CONFIRMED V1-security hole: an anonymous POST to
 * `/__serverLoad/<protectedVar>` previously returned every row (column-redacted
 * only). Three authority axes now STACK on the data route, none substituting:
 *   (1) route admission  — Fork 4 — `_scrml_serverload_auth` → 401 JSON
 *   (2) row selection    — Fork 3 — `WHERE user_id = ${@currentUser.id}`
 *   (3) column redaction — §14.8.9 — `_scrml_protect_tag` → `_scrml_protect_redact`
 *
 * `@currentUser` is the S233-ratified compiler-provided ambient identity cell
 * (id / role / isAuth), resolved server-side from the session middleware.
 *
 * Coverage:
 *   (a) the gate — an auth-required serverLoad handler calls _scrml_serverload_auth
 *       and returns 401 for an unauthenticated request (the closed hole)
 *   (b) the row-scope — `${@currentUser.id}` lowers to `_scrml_currentUser.id`,
 *       bound from the request session; the client POSTs no params (sql-load)
 *   (c) the stacking — §14.8.9 column redaction STILL wraps the row-scoped result
 *   (d) W-SERVERLOAD-UNGATED — fires on a route that opts out under an auth-aware app
 *   (e) W-SSR-PRERENDER-UNSCOPED — fires on an auth-scoped UNSCOPED cell (Tier-1)
 *   (f) per-var auth= (4c) — "none" overrides the default-inherit gate; "role:X"
 *       emits the role-gated 401/403 form
 *   (g) byte-identical — a non-auth / non-server-authority page emits no infra
 *   (h) shadow-safety — a USER `<currentUser>` cell is NOT the ambient
 */

import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { compileScrml } from "../../src/api.js";

// Full-pipeline compile (route-inference produces authMiddleware; the type pass
// fires the W-* nudges; codegen emits the gate + row-scope).
function compileFull(source) {
  const dir = mkdtempSync(join(tmpdir(), "server-load-authority-"));
  const file = join(dir, "app.scrml");
  writeFileSync(file, source);
  try {
    const result = compileScrml({ inputFiles: [file], write: false, log: () => {} });
    const out = result.outputs ? [...result.outputs.values()][0] : null;
    return {
      serverJs: out?.serverJs ?? "",
      clientJs: out?.clientJs ?? "",
      html: out?.html ?? "",
      warnings: result.warnings ?? [],
      errors: result.errors ?? [],
    };
  } finally {
    try { rmSync(dir, { recursive: true }); } catch { /* best effort */ }
  }
}

// Cross-stream diagnostic lookup — a W-/I- code partitions into result.warnings,
// but assert across BOTH streams so a partition change never silently passes.
function hasCode(res, code) {
  return [...res.warnings, ...res.errors].some((d) => d && d.code === code);
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

// Fork 3 + 4 — a per-user row-scoped Pattern-C cell with a protected column,
// under an auth-required page.
const ROW_SCOPED = `<program auth="required" db="sqlite:./app.db">
<db src="sqlite:./app.db" protect="ssn" tables="orders">
  \${
    ?{\`CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY, user_id TEXT, item TEXT, ssn TEXT)\`}.run()
    <orders server> = ?{\`SELECT * FROM orders WHERE user_id = \${@currentUser.id}\`}.all()
  }
  <main><ul><each in=@orders key=@.id><li : @.item></each></ul></main>
</db>
</program>`;

// Tier-1 server-authority cell (always SELECT * — unscoped) under auth-required.
const TIER1_AUTH = `<program auth="required" db="sqlite:./app.db">
<db src="sqlite:./app.db" tables="users">
  \${
    ?{\`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT)\`}.run()
    < Account authority="server" table="users">
      id: number
      name: string
    </>
    <Account> @accounts
  }
  <main><ul><each in=@accounts key=@.id><li : @.name></each></ul></main>
</db>
</program>`;

// Per-var auth="none" — explicitly public, opts out of the default-inherit gate.
const OPTOUT = `<program auth="required" db="sqlite:./app.db">
<db src="sqlite:./app.db" tables="catalog">
  \${
    ?{\`CREATE TABLE IF NOT EXISTS catalog (id INTEGER PRIMARY KEY, name TEXT)\`}.run()
    <products server auth="none"> = ?{\`SELECT * FROM catalog\`}.all()
  }
  <main><ul><each in=@products key=@.id><li : @.name></each></ul></main>
</db>
</program>`;

// Per-var auth="role:Admin" — role-granular gate (4c, completes §52.13.1).
const ROLE = `<program db="sqlite:./app.db">
<db src="sqlite:./app.db" tables="stats">
  \${
    ?{\`CREATE TABLE IF NOT EXISTS stats (id INTEGER PRIMARY KEY, v TEXT)\`}.run()
    <adminStats server auth="role:Admin"> = ?{\`SELECT * FROM stats\`}.all()
  }
  <main><ul><each in=@adminStats key=@.id><li : @.v></each></ul></main>
</db>
</program>`;

// A plain client-local page — no auth, no server-authority cell.
const PLAIN = `<program>
  <count> = 0
  <main><button onclick=\${@count = @count + 1}>\${@count}</button></main>
</program>`;

// A USER reactive cell named `currentUser` — the shadow case. NOT the ambient.
const USER_CELL_SHADOW = `<program>
  \${
    <currentUser> = not
    function setUser() { @currentUser = "alice" }
  }
  <main><button onclick=setUser()>\${@currentUser}</button></main>
</program>`;

// ---------------------------------------------------------------------------
// (a) the gate — the closed anonymous-POST hole
// ---------------------------------------------------------------------------

describe("server-load-authority (a): Fork-4 route gate closes the anon /__serverLoad hole", () => {
  test("the serverLoad handler calls _scrml_serverload_auth and returns 401 for an anon request", () => {
    const { serverJs } = compileFull(ROW_SCOPED);
    expect(serverJs).toContain("function _scrml_serverload_auth(req, requiredRole)");
    expect(serverJs).toContain('JSON.stringify({ error: "unauthenticated" })');
    expect(serverJs).toContain("status: 401");
    // the gate fires INSIDE the serverLoad handler (default-inherit from auth="required")
    expect(serverJs).toContain("const _scrml_authResult = _scrml_serverload_auth(_scrml_req, null);");
    expect(serverJs).toContain("if (_scrml_authResult) return _scrml_authResult;");
  });

  test("the session middleware resolves userId + role from the session store (impl-gap #2)", () => {
    const { serverJs } = compileFull(ROW_SCOPED);
    expect(serverJs).toContain("const _scrml_session_store = (globalThis.__scrml_session_store");
    expect(serverJs).toContain("userId: _rec ? (_rec.userId ?? null) : null,");
    expect(serverJs).toContain("role: _rec ? (_rec.role ?? null) : null,");
    expect(serverJs).toContain("function _scrml_current_user(req)");
    expect(serverJs).toContain("return { id: _s.userId, role: _s.role, isAuth: _s.isAuth };");
  });
});

// ---------------------------------------------------------------------------
// (b) the row-scope — @currentUser.id under the request (fail-closed for anon)
// ---------------------------------------------------------------------------

describe("server-load-authority (b): Fork-3 per-user row-scope", () => {
  test("`${@currentUser.id}` lowers to the server-bound _scrml_currentUser.id (not _scrml_body)", () => {
    const { serverJs } = compileFull(ROW_SCOPED);
    expect(serverJs).toContain("const _scrml_currentUser = _scrml_current_user(_scrml_req);");
    expect(serverJs).toContain("WHERE user_id = ${_scrml_currentUser.id}");
    // never the client-supplied request-body form for the ambient
    expect(serverJs).not.toContain('_scrml_body["currentUser"]');
  });

  test("the row-scoped query is a server-resolvable sql-load — no W-AUTH-004 (param-bearing) fire", () => {
    const res = compileFull(ROW_SCOPED);
    expect(hasCode(res, "W-AUTH-004")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (c) the stacking — §14.8.9 column redaction STILL applies on top
// ---------------------------------------------------------------------------

describe("server-load-authority (c): column ⟂ row ⟂ route stack (none substitutes)", () => {
  test("the protected column is tagged + redacted on top of the row-scoped query", () => {
    const { serverJs } = compileFull(ROW_SCOPED);
    // tag carries the protected column; the row-scope WHERE is inside the same query
    expect(serverJs).toContain('_scrml_protect_tag(await _scrml_sql`SELECT * FROM orders WHERE user_id = ${_scrml_currentUser.id}`, ["ssn"])');
    // redact wraps the result at the egress sink
    expect(serverJs).toContain("_scrml_protect_redact(_scrml_result)");
  });
});

// ---------------------------------------------------------------------------
// (d) W-SERVERLOAD-UNGATED
// ---------------------------------------------------------------------------

describe("server-load-authority (d): W-SERVERLOAD-UNGATED", () => {
  test("fires on a serverLoad route that opts out (auth=none) under an auth-aware app", () => {
    const res = compileFull(OPTOUT);
    expect(hasCode(res, "W-SERVERLOAD-UNGATED")).toBe(true);
  });

  test("does NOT fire when the route is gated (default-inherit auth=required)", () => {
    const res = compileFull(ROW_SCOPED);
    expect(hasCode(res, "W-SERVERLOAD-UNGATED")).toBe(false);
  });

  test("does NOT fire on a genuinely-public app (no auth anywhere)", () => {
    const res = compileFull(ROLE.replace('auth="role:Admin"', '')); // public Pattern-C, no auth
    expect(hasCode(res, "W-SERVERLOAD-UNGATED")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (e) W-SSR-PRERENDER-UNSCOPED
// ---------------------------------------------------------------------------

describe("server-load-authority (e): W-SSR-PRERENDER-UNSCOPED", () => {
  test("fires on an auth-scoped Tier-1 (unscoped SELECT *) — the cross-user SSR leak", () => {
    const res = compileFull(TIER1_AUTH);
    expect(hasCode(res, "W-SSR-PRERENDER-UNSCOPED")).toBe(true);
  });

  test("does NOT fire on a per-user row-scoped Pattern-C cell (`${@currentUser.id}`)", () => {
    const res = compileFull(ROW_SCOPED);
    expect(hasCode(res, "W-SSR-PRERENDER-UNSCOPED")).toBe(false);
  });

  test("does NOT fire on an explicitly-public cell (auth=none)", () => {
    const res = compileFull(OPTOUT);
    expect(hasCode(res, "W-SSR-PRERENDER-UNSCOPED")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (f) per-var auth= (4c)
// ---------------------------------------------------------------------------

describe("server-load-authority (f): per-var auth= (4c)", () => {
  test("auth=none overrides the enclosing auth=required → serverLoad route is NOT gated", () => {
    const { serverJs } = compileFull(OPTOUT);
    // the products handler exists but carries no auth gate
    const idx = serverJs.indexOf("async function _scrml_serverLoad_products_handler");
    expect(idx).toBeGreaterThan(-1);
    const handlerBody = serverJs.slice(idx, idx + 400);
    expect(handlerBody).not.toContain("_scrml_serverload_auth");
  });

  test("auth=role:X emits the role-gated form _scrml_serverload_auth(req, \"X\")", () => {
    const { serverJs } = compileFull(ROLE);
    expect(serverJs).toContain('_scrml_serverload_auth(_scrml_req, "Admin")');
    // the gate emits the 403 forbidden branch for a role mismatch
    expect(serverJs).toContain('JSON.stringify({ error: "forbidden" })');
    expect(serverJs).toContain("status: 403");
  });
});

// ---------------------------------------------------------------------------
// (g) byte-identical — a non-auth / non-server-authority page emits no infra
// ---------------------------------------------------------------------------

describe("server-load-authority (g): non-auth page emits no request-context infra", () => {
  test("a plain client-local page emits no session store / current_user / serverload_auth", () => {
    const { serverJs } = compileFull(PLAIN);
    expect(serverJs).not.toContain("_scrml_session_store");
    expect(serverJs).not.toContain("_scrml_current_user");
    expect(serverJs).not.toContain("_scrml_serverload_auth");
  });
});

// ---------------------------------------------------------------------------
// (h) shadow-safety — a user `<currentUser>` cell is NOT the ambient
// ---------------------------------------------------------------------------

describe("server-load-authority (h): a user <currentUser> cell shadows the ambient", () => {
  test("a user `<currentUser>` cell lowers as an ordinary reactive cell, not the ambient", () => {
    const { clientJs, serverJs } = compileFull(USER_CELL_SHADOW);
    // the client read of the user cell is the ordinary reactive accessor
    expect(clientJs).toContain('_scrml_reactive_get("currentUser")');
    // the ambient resolver is NOT emitted (no @currentUser ambient in this file)
    expect(serverJs).not.toContain("_scrml_current_user");
  });
});

// ---------------------------------------------------------------------------
// (i) single-fire per code — family diagnostic-noise guard (S234)
//
// The whole isServer-block warning family (W-AUTH-001 / W-SERVERLOAD-UNGATED /
// W-SSR-PRERENDER-UNSCOPED) emits from ONE `if (isServer)` block inside
// `annotateNodes` -> `visitNode`. `visitNode` has no per-node memoization, so a
// state-decl reachable via two walk paths WOULD double-fire the whole family.
// Empirically (S234) every server state-decl is visited EXACTLY once per
// compile, so each code fires ONCE per decl. This block LOCKS that: a future
// double-visit regression turns any of these counts to 2 and fails here.
//
// Count ACROSS both streams (a W-/I- code partitions into result.warnings, but
// asserting cross-stream means a partition change can never silently pass).
// ---------------------------------------------------------------------------

// A typed `server` cell with no detected initial load — the plain W-AUTH-001
// trigger (not Tier-1 authority, not a Pattern-C param-free sql-load).
const AUTH_NO_INIT = `<program auth="required" db="sqlite:./app.db">
<db src="sqlite:./app.db" tables="users">
  \${
    ?{\`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT)\`}.run()
    <account server>: string
  }
  <main><div>\${@account}</div></main>
</db>
</program>`;

function countCode(res, code) {
  return [...res.warnings, ...res.errors].filter((d) => d && d.code === code).length;
}

describe("server-load-authority (i): single-fire per code (family noise guard)", () => {
  test("W-AUTH-001 fires exactly ONCE on a single server decl (no double-visit)", () => {
    const res = compileFull(AUTH_NO_INIT);
    expect(countCode(res, "W-AUTH-001")).toBe(1);
  });

  test("W-SERVERLOAD-UNGATED fires exactly ONCE on a single opted-out decl", () => {
    const res = compileFull(OPTOUT);
    expect(countCode(res, "W-SERVERLOAD-UNGATED")).toBe(1);
  });

  test("W-SSR-PRERENDER-UNSCOPED fires exactly ONCE on a single Tier-1 decl", () => {
    const res = compileFull(TIER1_AUTH);
    expect(countCode(res, "W-SSR-PRERENDER-UNSCOPED")).toBe(1);
  });
});
