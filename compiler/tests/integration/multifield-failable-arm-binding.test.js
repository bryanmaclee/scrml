/**
 * gate-found-invalid-js-fix-wave (S141 follow-on) — multi-field `!{}` arm
 * binding + multi-arg `fail` must emit valid, consistent JS.
 *
 * ROOT CAUSE: the `!{}` failable arm parser (ast-builder.js) only captured the
 * FIRST binding ident inside `::Variant(a, b)`, leaving `, b ) -> ...` to leak
 * into the handler -> invalid JS (the gate's E-CODEGEN-INVALID-JS). Separately,
 * `fail Type::Variant(a, b)` emitted `data: a, b` (a bare comma list in
 * object-value position) -- also invalid JS. The enum CONSTRUCTOR canonically
 * shapes `.data` as a field-keyed object (`data: { a, b }`), so:
 *   - the arm parser now captures ALL comma-separated binding idents,
 *   - codegen destructures each from `result.data.<field>` (positional schema,
 *     binding-name fallback),
 *   - multi-arg `fail` emits `data: { field0: arg0, field1: arg1 }` matching the
 *     constructor.
 *
 * This shape is used heavily across stdlib (`::Thrown(message, name)` —
 * HostError from `scrml:host` safeCall/safeCallAsync).
 */

import { describe, test, expect } from "bun:test";
import { writeFileSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

const acorn = require("acorn");

function compileSource(src) {
  const dir = mkdtempSync(join(tmpdir(), "scrml-mf-arm-"));
  const file = join(dir, "app.scrml");
  writeFileSync(file, src);
  const result = compileScrml({ inputFiles: [file], write: false, validateEmit: true, log: () => {} });
  const out = result.outputs ? [...result.outputs.values()][0] : null;
  return { clientJs: out?.clientJs ?? "", errors: result.errors ?? [] };
}

describe("multi-field !{} arm binding + multi-arg fail (gate fix-wave)", () => {
  test("local enum: `fail T::Thrown(a, b)` + `!{ ::Thrown(a, b) -> a }` emits consistent field-keyed data + valid JS", () => {
    const src = `<program>
  \${
    type AppError:enum = {
      Thrown(message: string, name: string)
    }
    function risky() ! -> AppError {
      fail AppError::Thrown("boom", "Error")
    }
    function run() {
      const v = risky() !{
        | ::Thrown(message, name) -> message
      }
      return v
    }
  }
  <button onclick=run()>Run</button>
</program>`;
    const { clientJs, errors } = compileSource(src);
    const invalid = errors.filter((e) => e.code === "E-CODEGEN-INVALID-JS");
    expect(invalid).toHaveLength(0);
    expect(() => acorn.parse(clientJs, { ecmaVersion: 2022, sourceType: "module" })).not.toThrow();
    // fail emits a field-keyed object (matching the enum constructor's data shape).
    expect(clientJs).toContain('data: { message: "boom", name: "Error" }');
    // The arm destructures each field from .data.<field>.
    expect(clientJs).toContain(".data.message");
    expect(clientJs).toContain(".data.name");
    // The corrupted single-ident-parse leak must NOT appear.
    expect(clientJs).not.toContain(") - > ");
    expect(clientJs).not.toContain("= , ");
  });

  test("imported HostError: `safeCallAsync(...) !{ ::Thrown(message, name) -> ... }` emits valid async JS", () => {
    const src = `<program>
  \${
    import { safeCallAsync } from "scrml:host"
    function fetchData() {
      const ok = safeCallAsync(() => Promise.resolve(42)) !{
        | ::Thrown(message, name) -> 0
      }
      return ok
    }
  }
  <button onclick=fetchData()>Fetch</button>
</program>`;
    const { clientJs, errors } = compileSource(src);
    const invalid = errors.filter((e) => e.code === "E-CODEGEN-INVALID-JS");
    expect(invalid).toHaveLength(0);
    expect(() => acorn.parse(clientJs, { ecmaVersion: 2022, sourceType: "module" })).not.toThrow();
    expect(clientJs).toMatch(/async function _scrml_fetchData_\d+\s*\(/);
    expect(clientJs).toMatch(/= await safeCallAsync\b/);
    // Both binding names land (binding-name fallback when the imported schema is absent).
    expect(clientJs).toContain(".data.message");
    expect(clientJs).toContain(".data.name");
  });
});
