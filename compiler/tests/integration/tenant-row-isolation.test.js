/**
 * §14.8.10 — Server→client confidentiality: tenant-row isolation floor.
 *
 * Two layers:
 *   1. code-firing — each E-TENANT-* / I-TENANT-* fires on the right shape;
 *   2. runtime — the compiled bundle WIRES the redact at the egress sink, and the
 *      SHIPPED redact helper, EXECUTED, isolates rows (tenant A → only A + tenant_id
 *      stripped; unpinned → zero; untagged / `.acrossTenants()` → passthrough); plus
 *      a non-tenant app is byte-identical.
 *
 * The runtime half EXECUTES the shipped redact (not a grep of a marker — the S265
 * lesson). The end-to-end full-bundle-over-HTTP path is cloud-runner-infra-flaky, so
 * it is asserted directly here + was covered by the PA-side R26 (see conf-TENANT-FLOOR).
 */
import { describe, test, expect, afterAll } from "bun:test";
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { SERVER_TENANT_HELPER } from "../../src/codegen/tenant-egress.ts";

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
// LAYER 2 — the compiled bundle WIRES the redact + the SHIPPED helper ISOLATES rows
// ---------------------------------------------------------------------------
// Deterministic runtime pin. The end-to-end full-bundle-over-HTTP path proved
// cloud-runner-infra-flaky (three distinct harnesses each passed locally 17910/0 on
// the cloud Bun yet failed cloud-only — infra, not test logic; details in
// conf-TENANT-FLOOR.test.js). So the two runtime properties are asserted directly,
// EXECUTING the shipped redact (not a grep of a marker — the S265 lesson): (1) codegen
// WIRES the redact at the compiled artifact's egress sink; (2) the shipped helper,
// run, ISOLATES rows. (PA-side R26 exercised the true end-to-end path once, locally.)
describe("§14.8.10 runtime-half — the compiled bundle wires + the shipped redact isolates rows", () => {
  // Eval the SHIPPED helper block (the EXACT runtime the emitted server carries).
  const H = new Function(
    SERVER_TENANT_HELPER + "\nreturn { _scrml_tenant_tag, _scrml_tenant_redact };",
  )();
  const rows = () => [
    { id: 1, name: "a1", tenant_id: "A" },
    { id: 2, name: "a2", tenant_id: "A" },
    { id: 3, name: "b1", tenant_id: "B" },
  ];

  function compileServer(body) {
    const dir = mkdtempSync(join(tmpdir(), "scrml-tenant-exec-"));
    _cleanup.push(dir);
    const dbAbs = join(dir, "app.db");
    const file = join(dir, "app.scrml");
    writeFileSync(file, tenantProgram(body, dbAbs));
    const outDir = join(dir, "out");
    compileScrml({ inputFiles: [file], write: true, outputDir: outDir, log: () => {} });
    return readFileSync(join(outDir, "app.server.js"), "utf8");
  }

  test("(wiring) the scoped read's client-egress return is wrapped in the tenant redact", () => {
    const server = compileServer(
      `      function loadAssets() { let rows = ?{\`SELECT id, name FROM assets\`}.all(); return rows }`,
    );
    expect(/_scrml_tenant_redact\([^)]*_scrml_active_tenant/.test(server)).toBe(true);
    expect(server.includes("function _scrml_tenant_redact")).toBe(true);
    expect(server.includes("function _scrml_active_tenant")).toBe(true);
  });

  test("(a) tenant A → ONLY tenant-A rows, the floor-added tenant_id stripped", () => {
    const out = H._scrml_tenant_redact(H._scrml_tenant_tag(rows(), "tenant_id", true), "A");
    expect(out).toEqual([{ id: 1, name: "a1" }, { id: 2, name: "a2" }]);
    expect(out.every((r) => !("tenant_id" in r))).toBe(true);
  });

  test("(b) an absent ambient tenant (unpinned request) → ZERO rows (fail-closed)", () => {
    expect(H._scrml_tenant_redact(H._scrml_tenant_tag(rows(), "tenant_id", true), null)).toEqual([]);
  });

  test("(c) .acrossTenants() emits UNtagged rows → passthrough (all tenants)", () => {
    expect(H._scrml_tenant_redact(rows(), "A")).toEqual(rows());
  });

  test("tenant B → ONLY tenant-B rows", () => {
    expect(H._scrml_tenant_redact(H._scrml_tenant_tag(rows(), "tenant_id", true), "B"))
      .toEqual([{ id: 3, name: "b1" }]);
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
