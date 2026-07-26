/**
 * §20.5 / §14.8.10 / §14.8.11 — the `<schema>`-only app's session principal must
 * actually reach a request.
 *
 * REGRESSION LOCK for the two defects RediLedger's S4 behavioral run found, both of
 * which left the db-authoritative tier NON-FUNCTIONAL end-to-end for the exact app
 * shape it targets (a `<schema>`-only app — no `<db>` block), while every existing
 * test stayed green:
 *
 *   C — a plain server `function` whose `?{}` reads `@currentUser` compiled to an
 *       RI-route handler that INTERPOLATED `_scrml_currentUser` but never BOUND it
 *       (one use site, zero definitions) → `ReferenceError` on every call. The §52
 *       Fork-3 serverLoad path and the SSR-seed path both bind it; this third shape
 *       did not. A second layer sat under it: `_needsSessionInfra` counted only
 *       Pattern-C CELL loads, so for this shape the `_scrml_current_user` RESOLVER
 *       was not emitted either.
 *
 *   D — `buildTenantContext` read ONLY the `<db>`-derived schema registry, so a
 *       `<schema>`-only app had an EMPTY tenant set → `_tenantActive` false →
 *       `_scrml_current_user` omitted the `tenantId` projection →
 *       `_scrml_active_tenant()` returned null on every request. Meanwhile §14.8.11
 *       gates on the `<schema>` `db-authoritative` MARKER and so engaged anyway,
 *       faithfully pinning `scrml.tenant = NULL` and leaving RLS matching nothing.
 *       SPEC §14.8.10 is explicit that (2) is the declaration: *"A table whose
 *       `<schema>` carries a `tenant_id` column IS tenant-scoped; the column's
 *       presence is the declaration."*
 *
 * WHY THIS FILE EXISTS AT ALL: the tier's own live-PG tests
 * (`db-authoritative-pg.test.js`, `db-migrate-pg.test.js`) open a transaction and
 * HAND-EXECUTE `SELECT set_config('scrml.tenant', …)` before asserting. That is a
 * faithful test of the DDL + RLS and it rightly passed throughout — but it never
 * issues a request, so it cannot observe a session-sourced tenant failing to
 * arrive, nor an unbound identity in a route handler. The DDL negative test proves
 * the floor exists; only the request path proves the app is standing on it.
 *
 * SCOPE (honest): these are EMISSION assertions — deterministic and cloud-safe.
 * The executed proof (the handler running to its SQL with no ReferenceError, and
 * the tenant GUC carrying a session-pinned value) was PA-verified locally against
 * real PG16 through the emitted handler. A full login-over-HTTP → cookie →
 * per-user-read round trip is the stronger form and is tracked as a follow-on
 * (`g-dbauth-no-request-path-test`); RediLedger offered their harness for it.
 */
import { describe, test, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

const _cleanup = [];
afterAll(() => { for (const d of _cleanup) { try { rmSync(d, { recursive: true, force: true }); } catch {} } });

function compileApp(src) {
  const dir = mkdtempSync(join(tmpdir(), "scrml-schema-tenant-"));
  _cleanup.push(dir);
  const file = join(dir, "app.scrml");
  writeFileSync(file, src);
  return compileScrml({ inputFiles: [file], write: false, log: () => {} });
}

function serverOf(result) {
  const out = [...(result.outputs?.values() ?? [])][0];
  return out?.serverJs ?? "";
}

// A `<schema>`-only app: NO `<db>` block — the ordinary shape when scrml owns the
// schema, and precisely the shape both defects were invisible to.
const SCHEMA_ONLY_APP = `<program db="postgres://localhost:5432/app">

  <schema>
    ledger_entries {
      id: text primary key
      tenant_id: text not null
      user_id: text not null
      amount: real not null
    } db-authoritative
  </schema>

  \${
    function totalSpend() {
      const rows = ?{
        select sum(amount) as total
        from ledger_entries
        where user_id = \${@currentUser.id}
      }
      return rows
    }
  }

  <page>
    <button onclick=totalSpend()>Total</button>
  </page>

</program>
`;

// Control: no tenant_id column, no @currentUser read. Neither mechanism should
// engage — the byte-identity guarantee both features promise for apps that opt out.
const PLAIN_APP = `<program db="postgres://localhost:5432/app">

  <schema>
    notes {
      id: text primary key
      body: text
    }
  </schema>

  \${
    function allNotes() {
      const rows = ?{ select id from notes }
      return rows
    }
  }

  <page>
    <button onclick=allNotes()>Notes</button>
  </page>

</program>
`;

describe("§20.5 defect C — the RI-route handler binds @currentUser", () => {
  const server = serverOf(compileApp(SCHEMA_ONLY_APP));

  test("the emitted server actually references _scrml_currentUser (guards the fixture)", () => {
    // If this fails the fixture stopped exercising the path and the two
    // assertions below would pass vacuously.
    expect(server).toContain("_scrml_currentUser");
  });

  test("every _scrml_currentUser USE has a binding — no dangling identifier", () => {
    const uses = (server.match(/_scrml_currentUser/g) ?? []).length;
    const binds = (server.match(/const _scrml_currentUser = _scrml_current_user\(/g) ?? []).length;
    expect(uses).toBeGreaterThan(0);
    expect(binds).toBeGreaterThan(0);
    // The defect was uses>0 with binds===0 — a guaranteed ReferenceError.
    expect(binds).toBeGreaterThanOrEqual(1);
  });

  test("the _scrml_current_user RESOLVER is emitted (the second layer of C)", () => {
    // `_needsSessionInfra` previously counted only Pattern-C cell loads, so a
    // server-function `?{}` reading @currentUser got the binding's callee omitted.
    expect(server).toContain("function _scrml_current_user(req)");
  });

  test("the binding precedes its use (handler-scope entry, per the §20.5 contract)", () => {
    const bindIdx = server.indexOf("const _scrml_currentUser = _scrml_current_user(");
    const useIdx = server.indexOf("_scrml_currentUser.id");
    expect(bindIdx).toBeGreaterThan(-1);
    expect(useIdx).toBeGreaterThan(-1);
    expect(bindIdx).toBeLessThan(useIdx);
  });
});

describe("§14.8.10 defect D — a <schema> tenant_id column IS the declaration", () => {
  const server = serverOf(compileApp(SCHEMA_ONLY_APP));

  test("_scrml_current_user projects tenantId for a <schema>-only app", () => {
    // The whole defect in one line: without the `<schema>` registry this read
    // `{ id, role, isAuth }` and the tier pinned scrml.tenant = null forever.
    expect(server).toMatch(/return \{ id: _s\.userId, role: _s\.role, isAuth: _s\.isAuth, tenantId: _s\.tenantId \}/);
  });

  test("the db-authoritative principal wrapper pins the tenant GUC from that projection", () => {
    // Proves the two halves are wired to the SAME value — the composition that
    // was silently broken (each half worked; together they pinned null).
    expect(server).toContain("set_config('scrml.tenant'");
    expect(server).toContain("_scrml_active_tenant(_scrml_req)");
    expect(server).toMatch(/_cu \? \(_cu\.tenantId \?\? null\) : null/);
  });
});

describe("control — an app with neither tenant_id nor @currentUser stays untouched", () => {
  const server = serverOf(compileApp(PLAIN_APP));

  test("no tenant projection, no currentUser binding, no principal wrapper", () => {
    expect(server).not.toContain("tenantId: _s.tenantId");
    expect(server).not.toContain("const _scrml_currentUser = _scrml_current_user(");
    expect(server).not.toContain("set_config('scrml.tenant'");
  });
});
