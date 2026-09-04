/**
 * §39.4 boolean-column SQL-boundary coercion — g-sqlite-bool-column-crosses-the-sql-boundary-as-numeric.
 *
 * Filed S383-bryan (MED), bryan-endorsed direction ("coerce at the `?{}` decode
 * boundary keyed on the declared column type"). Fixed S400-peter.
 *
 * A column declared `boolean` in `<schema>` stores as SQLite INTEGER (§39.4), so a
 * `?{ SELECT … }` read returned it as numeric 1/0 — the compiler emitted ZERO
 * coercion, so `@.active is true` was silently false and `${@.active}` rendered
 * "1". The fix resolves the boolean OUTPUT columns of a resolvable SELECT (reusing
 * the protect-egress `extractSelectProjection`) and wraps the lowered result with
 * `_scrml_coerce_bool_cols` / `_scrml_coerce_bool_row` at the decode boundary.
 *
 * These assert the EMITTED server code (deterministic — no sqlite/CWD roundtrip).
 * End-to-end runtime behaviour (route handler returns `active: true`, nullable
 * NULL preserved, integer columns untouched) was PA-verified separately at S400.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "bool-coerce-")); });
afterAll(() => { if (TMP) rmSync(TMP, { recursive: true, force: true }); });

// Compile a db program whose server fn body is `fnBody`, return the emitted
// server.js text.
function serverJs(name, schemaCols, fnBody) {
  const dir = join(TMP, name);
  mkdirSync(dir, { recursive: true });
  const fp = join(dir, "app.scrml");
  writeFileSync(fp, `<program db="./b.db">
<schema>
    table flags {
${schemaCols}
    }
</>
<db src="./b.db" tables="flags">
    \${
        <rows> = []
        function q() { ${fnBody} }
        on mount { @rows = q() }
    }
    <h1>x \${@rows}</h1>
</db>
</program>`);
  const outDir = join(dir, "dist");
  const result = compileScrml({ inputFiles: [fp], write: true, outputDir: outDir, log: () => {} });
  expect((result.errors || []).map(e => e.code)).toEqual([]);
  const sf = readdirSync(outDir).find(f => f.endsWith(".server.js"));
  return readFileSync(join(outDir, sf), "utf8");
}

const BOOL_SCHEMA = "        id: integer primary key\n        active: boolean not null\n        n: integer";

describe("§39.4 boolean-column coercion at the ?{} decode boundary (g-sqlite-bool-column-crosses-the-sql-boundary-as-numeric)", () => {
  test(".all() over a boolean column wraps the result with _scrml_coerce_bool_cols(..., [\"active\"])", () => {
    const js = serverJs("all", BOOL_SCHEMA, "return ?{`SELECT id, active FROM flags`}.all()");
    expect(js).toContain("_scrml_coerce_bool_cols(");
    expect(js).toContain('["active"]');
    // the runtime helper is injected on use
    expect(js).toContain("function _scrml_coerce_bool_cols(");
  });

  test(".get() over a boolean column uses the single-row helper _scrml_coerce_bool_row", () => {
    const js = serverJs("get", BOOL_SCHEMA, "return ?{`SELECT id, active FROM flags WHERE id = 1`}.get()");
    expect(js).toContain("_scrml_coerce_bool_row(");
    expect(js).toContain('["active"]');
  });

  test("SELECT * resolves the boolean column through star expansion", () => {
    const js = serverJs("star", BOOL_SCHEMA, "return ?{`SELECT * FROM flags`}.all()");
    expect(js).toContain("_scrml_coerce_bool_cols(");
    expect(js).toContain('["active"]');
  });

  test("a SELECT with NO boolean output column emits NO coercion (byte-clean)", () => {
    const js = serverJs("nobool", BOOL_SCHEMA, "return ?{`SELECT id, n FROM flags`}.all()");
    expect(js).not.toContain("_scrml_coerce_bool");
  });

  test("an app with NO boolean-declared column never injects the helper (no-op / no regression)", () => {
    const js = serverJs(
      "noschema-bool",
      "        id: integer primary key\n        label: text\n        n: integer",
      "return ?{`SELECT id, label FROM flags`}.all()",
    );
    expect(js).not.toContain("_scrml_coerce_bool");
  });
});
