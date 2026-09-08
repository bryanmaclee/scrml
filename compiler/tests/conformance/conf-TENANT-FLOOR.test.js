/**
 * CONF-TENANT-FLOOR | §14.8.10 — tenant-row isolation floor
 *
 * The conformance surface pin (merge-blocker) for the V1-minimal tenant floor.
 * BOTH halves:
 *   - codes-half: each E-TENANT-{AGG,WRITE,RAW-EGRESS} + I-TENANT-{STRIP,ACROSS}
 *     fires on its shape (and does NOT fire off-shape / in a non-tenant app);
 *   - runtime-half (deterministic): the COMPILED bundle wires the redact at the
 *     client-egress sink, and the SHIPPED redact helper, EXECUTED, isolates rows
 *     (tenant A → only A + tenant_id stripped; unpinned → zero; untagged /
 *     `.acrossTenants()` → passthrough). NB the end-to-end full-bundle-over-HTTP
 *     path is cloud-runner-infra-flaky (3 distinct harnesses each passed locally
 *     17910/0 on the cloud Bun yet failed cloud-only — infra, not test logic), so
 *     the two runtime properties are pinned directly here; the full HTTP execution
 *     lives in the (non-gate) integration suite.
 *
 * Catalog (SPEC §34, §14.8.10): E-TENANT-AGG / E-TENANT-WRITE / E-TENANT-RAW-EGRESS
 * (Error); I-TENANT-STRIP / I-TENANT-ACROSS (Info). Firing sites: the source scan
 * in codegen/emit-server.ts (hard-fails), and the rewriter/sink drains
 * (I-TENANT-STRIP / I-TENANT-ACROSS); tag/redact runtime in codegen/tenant-egress.ts.
 */
import { describe, test, expect, afterAll } from "bun:test";
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { SERVER_TENANT_HELPER } from "../../src/codegen/tenant-egress.ts";

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

// ---------------------------------------------------------------------------
// THE UNCOVERED CELL (dpa-039 arc B): a `<schema>`-only app — NO `<db>` block.
//
// `tenantApp` above pairs its `<schema>` WITH a `<db src= tables=>`, so every
// case in this file drives the floor 100% from the `<db>`-derived registry
// (`protectAnalysis.views`, which `runPA` populates ONLY per `<db>` block). The
// `<schema>` leg — the one SPEC §14.8.10 actually names, *"A table whose
// `<schema>` carries a `tenant_id` column IS tenant-scoped; the column's
// presence is the declaration"* — was never exercised HERE. That is how a
// silently-inert tenant floor shipped for the raw-DDL + no-`<db>` app at exit 0.
//
// A `<schema>` body has TWO spellings and they were NOT equally covered:
// `schemaOnlyApp` builds both, because the DSL spelling already worked (its lock
// is tests/integration/schema-only-tenant-principal.test.js, S288, 7/0) while
// the RAW-DDL spelling did not. Keeping both here is what makes the raw case
// discriminating rather than merely present: with the fix reverted the DSL cell
// stays GREEN and only the raw cell goes red.
// ---------------------------------------------------------------------------
const SCHEMA_SPELLINGS = {
  dsl: {
    tenant: `    assets {\n      id: integer primary key\n      name: text\n      tenant_id: text\n    }`,
    plain: `    assets {\n      id: integer primary key\n      name: text\n    }`,
  },
  raw: {
    tenant: `    CREATE TABLE assets (id INTEGER PRIMARY KEY, name TEXT, tenant_id TEXT)`,
    plain: `    CREATE TABLE assets (id INTEGER PRIMARY KEY, name TEXT)`,
  },
};

function compileSchemaOnly(schemaText, body) {
  const dir = mkdtempSync(join(tmpdir(), "conf-tenant-schemaonly-"));
  _tmp.push(dir);
  const dbAbs = join(dir, "app.db");
  const file = join(dir, "app.scrml");
  writeFileSync(file, `<program db="${dbAbs}">
  <schema>
${schemaText}
  </schema>
  \${
${body}
  }
  <page>
    <button onclick=loadAssets()>Load</button>
  </page>
</program>`);
  const outDir = join(dir, "out");
  const r = compileScrml({ inputFiles: [file], write: true, outputDir: outDir, log: () => {} });
  return { r, server: readFileSync(join(outDir, "app.server.js"), "utf8") };
}

const readFn = (projection) =>
  `    function loadAssets() {\n` +
  `      const rows = ?{\`SELECT ${projection} FROM assets\`}.all()\n` +
  `      return rows\n` +
  `    }`;

describe("CONF-TENANT-FLOOR (declaration-source half): a `<schema>`-only app, BOTH spellings", () => {
  for (const spelling of ["dsl", "raw"]) {
    test(`${spelling} \`<schema>\`, NO \`<db>\` block — the floor is ACTIVE, not silently inert`, () => {
      const { r, server } = compileSchemaOnly(
        SCHEMA_SPELLINGS[spelling].tenant,
        readFn("id, name, tenant_id"),
      );
      // It must COMPILE — the fix teaches the declaration form; it does not
      // reject the input.
      expect(r.errors ?? []).toEqual([]);
      // The read is tagged at query-lowering …
      expect(/_scrml_tenant_tag\(await _scrml_sql/.test(server)).toBe(true);
      // … the redact is wired at the client-egress sink, keyed on the ambient
      // tenant …
      expect(/_scrml_tenant_redact\([^)]*_scrml_active_tenant/.test(server)).toBe(true);
      // … the helper + resolver ship …
      expect(server.includes("function _scrml_tenant_redact")).toBe(true);
      expect(server.includes("function _scrml_active_tenant")).toBe(true);
      // … and the redaction is NEVER silent.
      expect(codes(r).has("I-TENANT-STRIP")).toBe(true);
    });

    test(`${spelling} \`<schema>\` with NO tenant_id column — the floor stays OFF (no over-fire)`, () => {
      const { r, server } = compileSchemaOnly(
        SCHEMA_SPELLINGS[spelling].plain,
        readFn("id, name"),
      );
      expect(server.includes("_scrml_tenant_tag")).toBe(false);
      expect(server.includes("_scrml_tenant_redact")).toBe(false);
      expect(codes(r).has("I-TENANT-STRIP")).toBe(false);
    });
  }
});

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

describe("CONF-TENANT-FLOOR (runtime-half): the compiled bundle wires + the shipped redact isolates rows", () => {
  // Eval the SHIPPED helper block (the EXACT runtime the emitted server carries),
  // the same cloud-green pattern the unit suite uses — no full-bundle HTTP.
  const H = new Function(
    SERVER_TENANT_HELPER + "\nreturn { _scrml_tenant_tag, _scrml_tenant_redact };",
  )();
  const rows = () => [
    { id: 1, name: "a1", tenant_id: "A" },
    { id: 2, name: "a2", tenant_id: "A" },
    { id: 3, name: "b1", tenant_id: "B" },
  ];

  function compileServer(body) {
    const dir = mkdtempSync(join(tmpdir(), "conf-tenant-exec-"));
    _tmp.push(dir);
    const dbAbs = join(dir, "app.db");
    const file = join(dir, "app.scrml");
    writeFileSync(file, tenantApp(body, dbAbs));
    const outDir = join(dir, "out");
    compileScrml({ inputFiles: [file], write: true, outputDir: outDir, log: () => {} });
    return readFileSync(join(outDir, "app.server.js"), "utf8");
  }

  test("(1) codegen WIRES the redact at the egress sink; the helper + resolver are emitted", () => {
    const server = compileServer(
      `      function loadAssets() { let x = ?{\`SELECT id, name FROM assets\`}.all(); return x }\n` +
      `      function loadAcross() { let x = ?{\`SELECT id, name FROM assets\`}.all().acrossTenants(); return x }`,
    );
    // the scoped read's client-egress return is wrapped in the tenant redact, keyed
    // on the ambient @currentUser.tenantId — and the redact helper + resolver ship.
    expect(/_scrml_tenant_redact\([^)]*_scrml_active_tenant/.test(server)).toBe(true);
    expect(server.includes("function _scrml_tenant_redact")).toBe(true);
    expect(server.includes("function _scrml_active_tenant")).toBe(true);
  });

  test("(2) the shipped redact ISOLATES rows: A→only A (tenant_id stripped); unpinned→zero; untagged→passthrough", () => {
    // a floor-tagged (projection-added tenant_id) result → keep only the ambient
    // tenant's rows, strip the floor-added tenant_id column from the survivors.
    expect(H._scrml_tenant_redact(H._scrml_tenant_tag(rows(), "tenant_id", true), "A"))
      .toEqual([{ id: 1, name: "a1" }, { id: 2, name: "a2" }]);
    // fail-closed: an absent ambient tenant (unpinned request) → zero rows.
    expect(H._scrml_tenant_redact(H._scrml_tenant_tag(rows(), "tenant_id", true), null)).toEqual([]);
    // .acrossTenants() emits UNtagged rows → the redact passes them through unchanged.
    expect(H._scrml_tenant_redact(rows(), "A")).toEqual(rows());
  });
});

// ---------------------------------------------------------------------------
// W-SCHEMA-NO-TABLES-DECLARED (dpa-039 arc B, item B2) — the standing detector
// for an INERT `<schema>`.
//
// The defect this file's other half fixes was not "one spelling was missing".
// It was that a `<schema>` could declare NOTHING the compiler recognized and the
// tenant isolation floor would then emit nothing, with no diagnostic, at exit 0.
// Teaching one more spelling does not close that class — the NEXT unrecognized
// body would be silent in exactly the same way. This code is the detector for
// that class, and these cases pin the boundary of its trigger.
//
// ⚑ THE NEGATIVE CASES ARE THE POINT. A gate that goes red for reasons no change
// caused gets bypassed and then deleted, so every shape that legitimately
// declares no table is asserted SILENT here, individually: both real
// declaration forms, all three comment syntaxes, the §41.15 `schemaFor`
// delegation body (18 corpus files — the largest cry-wolf population), a
// §14.8.11.2 SECURITY-DEFINER `fn`-only block, and an empty block.
// ---------------------------------------------------------------------------
function compileSchemaBody(schemaText, { pg = false, preamble = "" } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "conf-schema-inert-"));
  _tmp.push(dir);
  const dbVal = pg ? "postgres://localhost:5432/app" : join(dir, "app.db");
  const file = join(dir, "app.scrml");
  writeFileSync(file, `${preamble}<program db="${dbVal}">
  <schema>
${schemaText}
  </schema>
  <page>
    <p>hi</p>
  </page>
</program>`);
  return compileScrml({ inputFiles: [file], write: false, log: () => {} });
}
const CODE_INERT = "W-SCHEMA-NO-TABLES-DECLARED";

describe("CONF-TENANT-FLOOR — W-SCHEMA-NO-TABLES-DECLARED: an inert `<schema>` is LOUD", () => {
  test("FIRES: a table head with a stray `:` declares nothing (the real corpus defect)", () => {
    // Found by census in scrml's OWN corpus:
    // compiler/tests/commands/migrate-program-shape-fixtures/schema-anchor.scrml.
    // `users: { … }` matches neither `tableName { … }` nor `CREATE TABLE …`.
    const r = compileSchemaBody("    users: { id: integer, name: text }");
    expect(codes(r).has(CODE_INERT)).toBe(true);
    // Warning, not Error — the build still succeeds.
    expect((r.errors ?? []).map((d) => d.code)).not.toContain(CODE_INERT);
  });

  test("FIRES: prose in a `<schema>` declares nothing", () => {
    const r = compileSchemaBody("    a users table with an id and a name");
    expect(codes(r).has(CODE_INERT)).toBe(true);
  });

  test("FIRES: an index-only body declares no TABLE", () => {
    const r = compileSchemaBody("    CREATE INDEX idx_users_name ON users (name)");
    expect(codes(r).has(CODE_INERT)).toBe(true);
  });

  test("SILENT: the declarative DSL form", () => {
    const r = compileSchemaBody("    users {\n      id: integer primary key\n      name: text\n    }");
    expect(codes(r).has(CODE_INERT)).toBe(false);
  });

  test("SILENT: the raw-DDL form (else the detector would cry wolf on the very shape B1 taught)", () => {
    const r = compileSchemaBody("    CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");
    expect(codes(r).has(CODE_INERT)).toBe(false);
  });

  test("SILENT: a comment-only body, in all three comment syntaxes", () => {
    for (const body of [
      "    -- the ops team owns these tables",
      "    // the ops team owns these tables",
      "    /* the ops team owns these tables */",
    ]) {
      expect(codes(compileSchemaBody(body)).has(CODE_INERT)).toBe(false);
    }
  });

  test("SILENT: an EMPTY `<schema>` — nothing was declared, so nothing was disabled", () => {
    expect(codes(compileSchemaBody("")).has(CODE_INERT)).toBe(false);
    expect(codes(compileSchemaBody("    \n    ")).has(CODE_INERT)).toBe(false);
  });

  test("SILENT: a §41.15 `schemaFor(T)` delegation body — the largest cry-wolf population", () => {
    // 18 of the 91 corpus files carrying a `<schema>` are this shape. The body is
    // a NON-TEXT child expanded by a later stage, so it reads as empty at the
    // check; firing here would redden every one of them.
    const r = compileSchemaBody("    ${ schemaFor(User) }", {
      preamble:
        "${\n  import { schemaFor } from 'scrml:data'\n\n" +
        "  type User:struct = {\n    email: string req\n    name:  string req\n  }\n}\n\n",
    });
    expect(codes(r).has(CODE_INERT)).toBe(false);
  });

  test("SILENT: a §14.8.11.2 SECURITY-DEFINER `fn`-only body carries no table BY CONSTRUCTION", () => {
    const r = compileSchemaBody(
      '    fn bump(id: text) security definer owner(app_owner) returns void { """ UPDATE t SET n = n + 1; """ }',
      { pg: true },
    );
    expect(codes(r).has(CODE_INERT)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// E-TENANT-RAW-EGRESS x the §23.2 foreign-opener LEVELS — end to end.
//
// The codes-half above pins E-TENANT-RAW-EGRESS on a `new Response` body only.
// The `_{}` limb of the same code was pinned at LEVEL 0 ONLY, which is the one
// spelling `W-FOREIGN-001` steers authors away from — so the gate was proven on
// the discouraged spelling and unproven on the recommended ones.
//
// REPRODUCED at exit 0 before the fix: levels 1/2/3 compiled with ZERO errors
// while the foreign block flattened the TAGGED rows to a string, past the
// redact's `typeof value !== "object"` exit, and shipped another tenant's row.
// ---------------------------------------------------------------------------
function compileForeign(bodyExpr) {
  const dir = mkdtempSync(join(tmpdir(), "conf-tenant-foreign-"));
  _tmp.push(dir);
  const dbAbs = join(dir, "app.db");
  const file = join(dir, "app.scrml");
  // `lang="js"` so the ONLY diagnostic under test is the tenant one
  // (a foreign block with no ancestor `lang=` is E-FOREIGN-003, §23.2.1).
  writeFileSync(file, `<program db="${dbAbs}" lang="js">
  <schema>
    assets {
      id: integer primary key
      name: text
      tenant_id: text
    }
  </schema>
  \${
    function leak() {
      const rows = ?{\`SELECT id, name, tenant_id FROM assets\`}.all()
      let wire = ${bodyExpr}
      return wire
    }
  }
  <page>
    <button onclick=leak()>Go</button>
  </page>
</program>`);
  return compileScrml({ inputFiles: [file], write: false, log: () => {} });
}

describe("CONF-TENANT-FLOOR — E-TENANT-RAW-EGRESS sees EVERY §23.2 foreign-opener level", () => {
  for (const [label, open, close] of [
    ["level 0", "_{", "}"],
    ["level 1", "_={", "}="],
    ["level 2", "_=={", "}=="],
    ["level 3", "_==={", "}==="],
  ]) {
    test(`${label} — a tenant-scoped read into ${open} … ${close} fails CLOSED`, () => {
      const r = compileForeign(`${open} JSON.stringify(rows) ${close}`);
      expect(codes(r).has("E-TENANT-RAW-EGRESS")).toBe(true);
    });
  }

  test("the opt-out still works at a non-zero level (no cry-wolf on deliberate cross-tenant)", () => {
    const dir = mkdtempSync(join(tmpdir(), "conf-tenant-foreign-across-"));
    _tmp.push(dir);
    const dbAbs = join(dir, "app.db");
    const file = join(dir, "app.scrml");
    writeFileSync(file, `<program db="${dbAbs}" lang="js">
  <schema>
    assets {
      id: integer primary key
      name: text
      tenant_id: text
    }
  </schema>
  \${
    function report() {
      const rows = ?{\`SELECT id, name, tenant_id FROM assets\`}.all().acrossTenants()
      let wire = _={ JSON.stringify(rows) }=
      return wire
    }
  }
  <page>
    <button onclick=report()>Go</button>
  </page>
</program>`);
    const r = compileScrml({ inputFiles: [file], write: false, log: () => {} });
    expect(codes(r).has("E-TENANT-RAW-EGRESS")).toBe(false);
  });

  test("a NON-tenant app with the same foreign block is untouched", () => {
    const dir = mkdtempSync(join(tmpdir(), "conf-tenant-foreign-plain-"));
    _tmp.push(dir);
    const dbAbs = join(dir, "app.db");
    const file = join(dir, "app.scrml");
    writeFileSync(file, `<program db="${dbAbs}" lang="js">
  <schema>
    notes {
      id: integer primary key
      body: text
    }
  </schema>
  \${
    function dump() {
      const rows = ?{\`SELECT id, body FROM notes\`}.all()
      let wire = _={ JSON.stringify(rows) }=
      return wire
    }
  }
  <page>
    <button onclick=dump()>Go</button>
  </page>
</program>`);
    const r = compileScrml({ inputFiles: [file], write: false, log: () => {} });
    expect(codes(r).has("E-TENANT-RAW-EGRESS")).toBe(false);
  });
});
