/**
 * CONF-FORM-select-coerce | §5.4 (D-FORM-5)
 *
 * Catalog: no error code — this is an EMISSION-shape conformance case.
 * Normative: SPEC §5.4 — "When `bind:value` is used on a `<select>` element and
 * the bound `@variable` is declared with an inferrable type that is not `string`,
 * the compiler SHALL emit a type coercion in the generated `onchange` handler":
 *   - number (or any numeric refinement): Number(event.target.value)
 *   - boolean:                            event.target.value === "true"
 *   - enum:                               (EnumTypeName_toEnum[...] ?? ...)
 *   - string / unannotated:               no coercion (raw event.target.value)
 *
 * A <select> carries no `type=` attr, so the element-attr numeric path
 * (type=number|range) never fires — the coercion must be driven by the bound
 * CELL's declared type.
 *
 * Firing site: compiler/src/codegen/emit-bindings.ts emitBindDirectiveBody
 * (bind:value branch, <select> cell-type coercion). Runtime write-back is
 * harness-gated, so these cases assert the emitted coercion SHAPE in client JS.
 */
import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let _tmp = 0;

function compile(source, slug) {
  const name = `${slug}-${++_tmp}`;
  const tmpDir = resolve(testDir, `_tmp_${name}`);
  const tmpInput = resolve(tmpDir, `${name}.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: false, outputDir: resolve(tmpDir, "out") });
    let clientJs = "";
    for (const out of (result.outputs ?? new Map()).values()) {
      if (out && out.clientJs) clientJs += out.clientJs;
    }
    return { errors: result.errors ?? [], clientJs };
  } finally {
    if (existsSync(tmpInput)) rmSync(tmpInput);
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("CONF-FORM-select-coerce: §5.4 <select> bind:value coercion by cell type", () => {
  test("number cell: onchange write-back wraps event.target.value in Number()", () => {
    const src = `<program>
<choice>: number = 1
<select bind:value=@choice>
<option value="1">One</>
<option value="2">Two</>
</select>
</>
`;
    const { errors, clientJs } = compile(src, "select-num");
    expect(errors.filter(e => e.code && e.code.startsWith("E-")).length).toBe(0);
    expect(clientJs).toContain('_scrml_reactive_set("choice", Number(event.target.value))');
  });

  test("boolean cell: onchange write-back coerces via event.target.value === \"true\"", () => {
    const src = `<program>
<flag>: boolean = false
<select bind:value=@flag>
<option value="true">Yes</>
<option value="false">No</>
</select>
</>
`;
    const { errors, clientJs } = compile(src, "select-bool");
    expect(errors.filter(e => e.code && e.code.startsWith("E-")).length).toBe(0);
    expect(clientJs).toContain('_scrml_reactive_set("flag", event.target.value === "true")');
  });

  test("string cell (unannotated): no coercion — raw event.target.value written", () => {
    const src = `<program>
<pick> = "a"
<select bind:value=@pick>
<option value="a">A</>
<option value="b">B</>
</select>
</>
`;
    const { errors, clientJs } = compile(src, "select-str");
    expect(errors.filter(e => e.code && e.code.startsWith("E-")).length).toBe(0);
    expect(clientJs).toContain('_scrml_reactive_set("pick", event.target.value)');
    expect(clientJs).not.toContain('_scrml_reactive_set("pick", Number(event.target.value))');
    expect(clientJs).not.toContain('_scrml_reactive_set("pick", event.target.value === "true")');
  });
});
